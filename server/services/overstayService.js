"use strict";

const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("./fareService");
const { getFareConfig } = require("./fareConfigService");
const { writeAuditEntry } = require("./auditService");

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

function secondsBetween(start, end) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 1000;
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
    { new: true, runValidators: true },
  );
  if (!settled) {
    throw serviceError("Vehicle has already exited", "ALREADY_EXITED", 409);
  }

  try {
    await Spot.findOneAndUpdate(
      { _id: settled.spotId, status: "reserved" },
      { $set: { status: "free", currentTransactionId: null } },
      { new: true },
    );
  } catch (error) {
    await Transaction.findOneAndUpdate(
      { _id: settled._id, status: "completed", exitTimestamp: now },
      {
        $set: { status: "active", penaltyApplied: false },
        $unset: { exitTimestamp: 1, durationSeconds: 1, fare: 1 },
      },
      { new: true },
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

module.exports = { notifyOverstay, forceRelease };
