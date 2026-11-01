"use strict";

const { randomUUID } = require("node:crypto");
const Spot = require("../models/Spot");
const Vehicle = require("../models/Vehicle");
const Transaction = require("../models/Transaction");
const { writeAuditEntry } = require("./auditService");

const ENTRY_GATES = new Set(["Entry-1", "Entry-2"]);
const allocationQueues = new Map();

function inputError(message) {
  const error = new TypeError(message);
  error.code = "INVALID_INPUT";
  error.statusCode = 400;
  return error;
}

function alreadyParkedError() {
  const error = new Error("This vehicle already has an active parking transaction");
  error.code = "ALREADY_PARKED";
  error.statusCode = 409;
  return error;
}

async function releaseClaimedSpot(spotId) {
  await Spot.findOneAndUpdate(
    { _id: spotId, status: "reserved" },
    { $set: { status: "free", currentTransactionId: null } },
    { returnDocument: "after" },
  );
}

/**
 * Allocate a free spot for a vehicle.
 *
 * The spot claim uses findOneAndUpdate with a status predicate so two requests
 * cannot both reserve the same free spot. The entry timestamp is generated on
 * the server when the service receives the request; callers cannot supply it.
 */
async function allocateSpotInOrder({ plateNumber, vehicleType, gateId, operatorId }, entryTimestamp) {
  if (typeof plateNumber !== "string" || !plateNumber.trim()) {
    throw inputError("plateNumber is required");
  }
  if (!["2W", "4W"].includes(vehicleType)) {
    throw inputError("vehicleType must be either '2W' or '4W'");
  }
  if (!ENTRY_GATES.has(gateId)) {
    throw inputError("gateId must be Entry-1 or Entry-2");
  }
  if (!operatorId) {
    throw inputError("operatorId is required");
  }

  const normalizedPlate = plateNumber.trim().toUpperCase();


  const spot = await Spot.findOneAndUpdate(
    { zone: vehicleType, status: "free" },
    { $set: { status: "reserved" } },
    { returnDocument: "after", sort: { spotNumber: 1 }, runValidators: true },
  );

  if (!spot) {
    const error = new Error("No free parking spot is available for this vehicle type");
    error.code = "LOT_FULL";
    error.statusCode = 409;
    throw error;
  }

  const ticketId = `TKT-${entryTimestamp.toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
  let transaction;

  try {
    await Vehicle.findOneAndUpdate(
      { plateNumber: normalizedPlate },
      {
        $set: { vehicleType },
        $setOnInsert: { plateNumber: normalizedPlate },
      },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    transaction = await Transaction.create({
      ticketId,
      plateNumber: normalizedPlate,
      vehicleType,
      spotId: spot._id,
      entryGateId: gateId,
      entryOperatorId: operatorId,
      entryTimestamp,
      status: "active",
    });
  } catch (error) {
    // Release the claim if creating the vehicle or transaction fails. A unique
    // partial index on active transactions turns a concurrent duplicate entry
    // into this recoverable path.
    await releaseClaimedSpot(spot._id);
    if (error && error.code === 11000) throw alreadyParkedError();
    throw error;
  }

  await writeAuditEntry({
    action: "VEHICLE_ENTRY",
    actorId: operatorId,
    actorRole: "operator",
    details: {
      transactionId: String(transaction._id),
      ticketId,
      plateNumber: normalizedPlate,
      vehicleType,
      spotId: String(spot._id),
      gateId,
    },
  });

  return {
    ticketId,
    transactionId: transaction?._id,
    spotId: String(spot._id),
    spotNumber: spot.spotNumber,
    zone: spot.zone || vehicleType,
    entryTimestamp,
    qrPayload: JSON.stringify({
      ticketId,
      plateNumber: normalizedPlate,
      vehicleType,
      spotId: String(spot._id),
    }),
  };
}

/**
 * Queue same-zone requests in the order they reach this service. The project
 * runs one local Node process; this preserves server-received FCFS ordering
 * while MongoDB's atomic free-spot claim remains the cross-request safety net.
 */
function allocateSpot(input = {}) {
  const receivedAt = new Date();
  const queueKey = input.vehicleType;
  const previous = allocationQueues.get(queueKey) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => allocateSpotInOrder(input, receivedAt));
  const tail = current.then(() => undefined, () => undefined);

  allocationQueues.set(queueKey, tail);
  tail.finally(() => {
    if (allocationQueues.get(queueKey) === tail) allocationQueues.delete(queueKey);
  });

  return current;
}

module.exports = { allocateSpot };
