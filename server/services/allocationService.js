"use strict";

const { randomUUID } = require("node:crypto");
const Spot = require("../models/Spot");
const Vehicle = require("../models/Vehicle");
const Transaction = require("../models/Transaction");

const ENTRY_GATES = new Set(["Entry-1", "Entry-2"]);

function inputError(message) {
  const error = new TypeError(message);
  error.code = "INVALID_INPUT";
  error.statusCode = 400;
  return error;
}

/**
 * Allocate a free spot for a vehicle.
 *
 * The spot claim uses findOneAndUpdate with a status predicate so two requests
 * cannot both reserve the same free spot. The entry timestamp is generated on
 * the server when the service receives the request; callers cannot supply it.
 */
async function allocateSpot({ plateNumber, vehicleType, gateId, operatorId }) {
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
  // Capture arrival time before database work so latency cannot reorder FCFS timestamps.
  const entryTimestamp = new Date();

  const spot = await Spot.findOneAndUpdate(
    { zone: vehicleType, status: "free" },
    { $set: { status: "reserved" } },
    { new: true, sort: { spotNumber: 1 }, runValidators: true },
  );

  if (!spot) {
    const error = new Error("No free parking spot is available for this vehicle type");
    error.code = "LOT_FULL";
    error.statusCode = 409;
    throw error;
  }

  try {
    await Vehicle.findOneAndUpdate(
      { plateNumber: normalizedPlate },
      {
        $set: { vehicleType },
        $setOnInsert: { plateNumber: normalizedPlate },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );

    // The timestamp is server-generated and cannot be supplied by the client.
    const ticketId = `TKT-${entryTimestamp.toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const transaction = await Transaction.create({
      ticketId,
      plateNumber: normalizedPlate,
      vehicleType,
      spotId: spot._id,
      entryGateId: gateId,
      entryOperatorId: operatorId,
      entryTimestamp,
      status: "active",
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
  } catch (error) {
    // Release the claim if creating the vehicle or transaction fails.
    await Spot.findOneAndUpdate(
      { _id: spot._id, status: "reserved" },
      { $set: { status: "free", currentTransactionId: null } },
      { new: true },
    );
    throw error;
  }
}

module.exports = { allocateSpot };
