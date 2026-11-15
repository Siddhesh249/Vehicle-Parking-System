"use strict";

const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("./fareService");
const { getFareConfig } = require("./fareConfigService");
const { writeAuditEntry } = require("./auditService");
const { getOverstayThresholdHours } = require("./overstayConfigService");
const { roundMoney } = require("../utils/money");
const { ADMIN_EXIT_GATE } = require("../utils/gates");
const {
  realMillisecondsForSimulatedHours,
  simulatedHoursBetween,
  simulatedSecondsBetween,
} = require("../utils/simulatedTime");

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

function serviceError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

/**
 * Resolve a parked vehicle by its active transaction ID or ticket ID. Values
 * that are not ObjectIds are matched on ticketId only, so arbitrary input
 * yields a 404 instead of a cast error.
 */
async function findActiveTransaction(vehicleId) {
  if (typeof vehicleId !== "string" || !vehicleId.trim()) {
    throw serviceError("vehicleId is required", "INVALID_REQUEST", 400);
  }
  const id = vehicleId.trim();
  const matchers = [{ ticketId: id }];
  if (OBJECT_ID_PATTERN.test(id)) matchers.push({ _id: id });

  const transaction = await Transaction.findOne({ status: "active", $or: matchers });
  if (!transaction) {
    throw serviceError("Active vehicle not found", "VEHICLE_NOT_FOUND", 404);
  }
  return transaction;
}

function alertFor(transaction, now, thresholdHours) {
  const durationHours = simulatedHoursBetween(transaction.entryTimestamp, now);
  return {
    vehicleId: String(transaction._id),
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    vehicleType: transaction.vehicleType,
    gateId: transaction.entryGateId,
    entryTimestamp: transaction.entryTimestamp,
    duration: durationHours * 3600,
    durationHours,
    isOverstay: Boolean(transaction.isOverstay) || durationHours >= thresholdHours,
  };
}

/**
 * Find every active transaction that has crossed the configured overstay
 * threshold, or was explicitly flagged by an operator (VPS-F-040). This is a
 * read-only view used by the admin dashboard and its periodic refresh.
 */
async function listOverstays({ now = new Date(), thresholdHours } = {}) {
  const effectiveThreshold =
    thresholdHours === undefined
      ? await getOverstayThresholdHours()
      : Number(thresholdHours);
  const cutoff = new Date(
    now.getTime() - realMillisecondsForSimulatedHours(effectiveThreshold),
  );
  const transactions = await Transaction.find({
    status: "active",
    parkingEndTimestamp: null,
    $or: [{ isOverstay: true }, { entryTimestamp: { $lte: cutoff } }],
  }).sort({ entryTimestamp: 1 });

  return transactions.map((transaction) => ({
    ...alertFor(transaction, now, effectiveThreshold),
    autoFlagged: !transaction.isOverstay,
  }));
}

/**
 * Mark newly overstaying vehicles in MongoDB and return one alert per vehicle.
 * Called by the server's background scanner; returning only the newly flagged
 * rows keeps Socket.io notifications from repeating on every scan.
 */
async function scanOverstays({ now = new Date(), thresholdHours } = {}) {
  const effectiveThreshold =
    thresholdHours === undefined
      ? await getOverstayThresholdHours()
      : Number(thresholdHours);
  const cutoff = new Date(
    now.getTime() - realMillisecondsForSimulatedHours(effectiveThreshold),
  );
  const candidates = await Transaction.find({
    status: "active",
    parkingEndTimestamp: null,
    isOverstay: false,
    entryTimestamp: { $lte: cutoff },
  });

  const newlyFlagged = [];
  for (const candidate of candidates) {
    const flagged = await Transaction.findOneAndUpdate(
      { _id: candidate._id, status: "active", isOverstay: false },
      { $set: { isOverstay: true } },
      { returnDocument: "after" },
    );
    if (flagged) newlyFlagged.push(alertFor(flagged, now, effectiveThreshold));
  }
  return newlyFlagged;
}

function notOverstayedError() {
  return serviceError(
    "This vehicle has not exceeded the overstay threshold",
    "NOT_OVERSTAYED",
    409,
  );
}

/**
 * A vehicle counts as overstayed when it was already flagged (by the scanner or
 * a previous notification) or its parked time has reached the configured
 * threshold at `until`.
 */
async function assertOverstayed(transaction, until) {
  if (transaction.isOverstay) return;
  const thresholdHours = await getOverstayThresholdHours();
  if (simulatedHoursBetween(transaction.entryTimestamp, until) < thresholdHours) {
    throw notOverstayedError();
  }
}

/** Flag an overstaying vehicle and record the gate's notification (VPS-F-040, VPS-F-041). */
async function notifyOverstay({ vehicleId, gateId, operator, now = new Date() }) {
  const transaction = await findActiveTransaction(vehicleId);
  await assertOverstayed(transaction, now);

  await Transaction.updateOne(
    { _id: transaction._id, status: "active" },
    { $set: { isOverstay: true } },
  );

  const durationSeconds = simulatedSecondsBetween(transaction.entryTimestamp, now);
  const durationHours = durationSeconds / 3600;
  const entry = await writeAuditEntry({
    action: "OVERSTAY_FLAGGED",
    actorId: operator.userId,
    actorRole: operator.role,
    details: {
      transactionId: String(transaction._id),
      ticketId: transaction.ticketId,
      plateNumber: transaction.plateNumber,
      gateId,
      durationSeconds,
      durationHours,
    },
  });

  return {
    notificationId: String(entry._id),
    vehicleId: String(transaction._id),
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    gateId,
    durationSeconds,
    durationHours,
  };
}

/**
 * Settle an overstaying vehicle with the overstay penalty and free its spot
 * (VPS-F-042, VPS-F-043). Mirrors processExit's compare-and-set so a force
 * release and a gate exit racing each other settle the vehicle only once.
 */
async function forceRelease({
  vehicleId,
  admin,
  now = new Date(),
  useSimulationOverride = false,
}) {
  const transaction = await findActiveTransaction(vehicleId);

  // If the car already left its spot for the exit queue, bill to that moment.
  const billingEnd = transaction.parkingEndTimestamp
    ? new Date(transaction.parkingEndTimestamp)
    : now;
  // Only an overstayed vehicle may be force-released (VPS-F-042), so the
  // penalty can never be charged to a car that is still within its time.
  await assertOverstayed(transaction, billingEnd);
  const durationSeconds = simulatedSecondsBetween(transaction.entryTimestamp, billingEnd);
  const durationHours = durationSeconds / 3600;
  const fareConfig = await getFareConfig(transaction.vehicleType, {
    useSimulationOverride,
  });
  const fareDetails = calculateFareDetails(
    transaction.entryTimestamp,
    billingEnd,
    transaction.vehicleType,
    { overstay: true },
    fareConfig,
  );

  const settled = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: "active" },
    {
      $set: {
        status: "completed",
        exitGateId: ADMIN_EXIT_GATE,
        exitOperatorId: admin.userId,
        exitTimestamp: billingEnd,
        durationSeconds,
        fare: roundMoney(fareDetails.total),
        penaltyApplied: true,
        isOverstay: true,
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!settled) {
    throw serviceError("Vehicle has already exited", "ALREADY_EXITED", 409);
  }

  try {
    await Spot.findOneAndUpdate(
      {
        _id: settled.spotId,
        status: "reserved",
        currentTransactionId: settled._id,
      },
      { $set: { status: "free", currentTransactionId: null } },
      { returnDocument: "after" },
    );
  } catch (error) {
    await Transaction.findOneAndUpdate(
      {
        _id: settled._id,
        status: "completed",
        exitTimestamp: billingEnd,
      },
      {
        $set: { status: "active", penaltyApplied: false },
        $unset: {
          exitGateId: 1,
          exitOperatorId: 1,
          exitTimestamp: 1,
          durationSeconds: 1,
          fare: 1,
        },
      },
      { returnDocument: "after" },
    );
    throw error;
  }

  await writeAuditEntry({
    action: "SPOT_FORCE_RELEASE",
    actorId: admin.userId,
    actorRole: admin.role,
    details: {
      transactionId: String(settled._id),
      ticketId: settled.ticketId,
      spotId: String(settled.spotId),
      fare: fareDetails.total,
      durationHours,
    },
  });

  return {
    spotId: String(settled.spotId),
    penaltyApplied: true,
    ticketId: settled.ticketId,
    plateNumber: settled.plateNumber,
    durationSeconds,
    durationHours,
    fare: roundMoney(fareDetails.total),
    breakdown: {
      baseFare: roundMoney(fareDetails.baseFare),
      overstayPenalty: fareDetails.overstayPenalty,
    },
  };
}

module.exports = { notifyOverstay, forceRelease, listOverstays, scanOverstays };
