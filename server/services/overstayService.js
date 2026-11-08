"use strict";

const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("./fareService");
const { getFareConfig } = require("./fareConfigService");
const { writeAuditEntry } = require("./auditService");

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;
const DEFAULT_OVERSTAY_THRESHOLD_MINUTES = 120;

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

function secondsBetween(start, end) {
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

function overstayThresholdMinutes(value = process.env.OVERSTAY_THRESHOLD_MINUTES) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_OVERSTAY_THRESHOLD_MINUTES;
  return parsed;
}

function alertFor(transaction, now) {
  return {
    vehicleId: String(transaction._id),
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    vehicleType: transaction.vehicleType,
    gateId: transaction.entryGateId,
    entryTimestamp: transaction.entryTimestamp,
    duration: secondsBetween(transaction.entryTimestamp, now),
  };
}

/**
 * Find every active transaction that has crossed the configured overstay
 * threshold, or was explicitly flagged by an operator (VPS-F-040). This is a
 * read-only view used by the admin dashboard and its periodic refresh.
 */
async function listOverstays({
  now = new Date(),
  thresholdMinutes = overstayThresholdMinutes(),
} = {}) {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
  const transactions = await Transaction.find({
    status: "active",
    $or: [{ isOverstay: true }, { entryTimestamp: { $lte: cutoff } }],
  }).sort({ entryTimestamp: 1 });

  return transactions.map((transaction) => ({
    ...alertFor(transaction, now),
    autoFlagged: !transaction.isOverstay,
  }));
}

/**
 * Mark newly overstaying vehicles in MongoDB and return one alert per vehicle.
 * Called by the server's background scanner; returning only the newly flagged
 * rows keeps Socket.io notifications from repeating on every scan.
 */
async function scanOverstays({
  now = new Date(),
  thresholdMinutes = overstayThresholdMinutes(),
} = {}) {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
  const candidates = await Transaction.find({
    status: "active",
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
    if (flagged) newlyFlagged.push(alertFor(flagged, now));
  }
  return newlyFlagged;
}

/** Flag an overstaying vehicle and record the gate's notification (VPS-F-040, VPS-F-041). */
async function notifyOverstay({ vehicleId, gateId, operator, now = new Date() }) {
  const transaction = await findActiveTransaction(vehicleId);

  await Transaction.updateOne(
    { _id: transaction._id, status: "active" },
    { $set: { isOverstay: true } },
  );

  const durationSeconds = secondsBetween(transaction.entryTimestamp, now);
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
    },
  });

  return {
    notificationId: String(entry._id),
    vehicleId: String(transaction._id),
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    gateId,
    durationSeconds,
  };
}

/**
 * Settle an overstaying vehicle with the overstay penalty and free its spot
 * (VPS-F-042, VPS-F-043). Mirrors processExit's compare-and-set so a force
 * release and a gate exit racing each other settle the vehicle only once.
 */
async function forceRelease({ vehicleId, admin, now = new Date() }) {
  const transaction = await findActiveTransaction(vehicleId);

  const durationSeconds = secondsBetween(transaction.entryTimestamp, now);
  const fareConfig = await getFareConfig(transaction.vehicleType);
  const fareDetails = calculateFareDetails(
    transaction.entryTimestamp,
    now,
    transaction.vehicleType,
    { overstay: true },
    fareConfig,
  );

  const settled = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: "active" },
    {
      $set: {
        status: "completed",
        exitTimestamp: now,
        durationSeconds,
        fare: fareDetails.total,
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
      { _id: settled.spotId, status: "reserved" },
      { $set: { status: "free", currentTransactionId: null } },
      { returnDocument: "after" },
    );
  } catch (error) {
    await Transaction.findOneAndUpdate(
      { _id: settled._id, status: "completed", exitTimestamp: now },
      {
        $set: { status: "active", penaltyApplied: false },
        $unset: { exitTimestamp: 1, durationSeconds: 1, fare: 1 },
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
    },
  });

  return {
    spotId: String(settled.spotId),
    penaltyApplied: true,
    ticketId: settled.ticketId,
    plateNumber: settled.plateNumber,
    durationSeconds,
    fare: fareDetails.total,
    breakdown: {
      baseFare: fareDetails.baseFare,
      overstayPenalty: fareDetails.overstayPenalty,
    },
  };
}

module.exports = {
  notifyOverstay,
  forceRelease,
  listOverstays,
  scanOverstays,
  overstayThresholdMinutes,
  DEFAULT_OVERSTAY_THRESHOLD_MINUTES,
};
