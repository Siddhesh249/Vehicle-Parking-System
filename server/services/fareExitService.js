"use strict";

const { randomUUID } = require("node:crypto");
const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("./fareService");
const { getFareConfig } = require("./fareConfigService");

function serviceError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizePlate(plateNumber) {
  if (typeof plateNumber !== "string" || !plateNumber.trim()) {
    throw new TypeError("plateNumber must be a non-empty string");
  }
  return plateNumber.trim().toUpperCase();
}

async function lookupByTicket(ticketId) {
  if (typeof ticketId !== "string" || !ticketId.trim()) {
    throw new TypeError("ticketId must be a non-empty string");
  }
  const transaction = await Transaction.findOne({
    ticketId: ticketId.trim(),
    status: "active",
  });
  if (!transaction) {
    throw serviceError("Active vehicle not found", "VEHICLE_NOT_FOUND", 404);
  }
  return transaction;
}

async function searchByPlate(plateNumber) {
  const normalizedPlate = normalizePlate(plateNumber);
  const transaction = await Transaction.findOne({
    plateNumber: normalizedPlate,
    status: "active",
  });
  if (!transaction) {
    throw serviceError("Active vehicle not found", "VEHICLE_NOT_FOUND", 404);
  }
  return [transaction];
}

async function processExit({
  ticketId,
  plateNumber,
  gateId,
  operatorId,
  exitTimestamp = new Date(),
} = {}) {
  if (!gateId || !operatorId) {
    throw new TypeError("gateId and operatorId are required");
  }
  const exitTime = new Date(exitTimestamp);
  if (!Number.isFinite(exitTime.getTime())) {
    throw new TypeError("exitTimestamp must be a valid date");
  }

  let transaction;
  const lostTicket = !(typeof ticketId === "string" && ticketId.trim());
  try {
    if (!lostTicket) transaction = await lookupByTicket(ticketId);
    else {
      const matches = await searchByPlate(plateNumber);
      transaction = matches[0];
    }
  } catch (error) {
    if (error.code === "VEHICLE_NOT_FOUND") {
      throw serviceError(
        "Vehicle has already exited or was not found",
        "ALREADY_EXITED",
        409,
      );
    }
    throw error;
  }

  const durationMilliseconds =
    exitTime.getTime() - new Date(transaction.entryTimestamp).getTime();
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    throw new RangeError("Exit timestamp cannot be before entry timestamp");
  }
  const durationSeconds = durationMilliseconds / 1000;
  const fareConfig = await getFareConfig(transaction.vehicleType);
  const fareDetails = calculateFareDetails(
    transaction.entryTimestamp,
    exitTime,
    transaction.vehicleType,
    {
      lostTicket,
    },
    fareConfig,
  );

  // The conditional update is the exit-side concurrency guard. Only one gate
  // can change an active transaction to completed; every losing request gets a
  // conflict instead of issuing a second receipt.
  const settledTransaction = await Transaction.findOneAndUpdate(
    { _id: transaction._id, status: "active" },
    {
      $set: {
        status: "completed",
        exitGateId: gateId,
        exitOperatorId: operatorId,
        exitTimestamp: exitTime,
        durationSeconds,
        fare: fareDetails.total,
        penaltyApplied: lostTicket,
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!settledTransaction) {
    throw serviceError(
      "Vehicle has already exited or was not found",
      "ALREADY_EXITED",
      409,
    );
  }

  try {
    await Spot.findOneAndUpdate(
      { _id: settledTransaction.spotId, status: "reserved" },
      { $set: { status: "free", currentTransactionId: null } },
      { returnDocument: "after" },
    );
  } catch (error) {
    // Do not report a completed exit while its spot remains unavailable. The
    // compare-and-set prevents this compensation from undoing another exit.
    await Transaction.findOneAndUpdate(
      { _id: settledTransaction._id, status: "completed", exitTimestamp: exitTime },
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

  return {
    receiptId: randomUUID(),
    ticketId: settledTransaction.ticketId,
    spotId: String(settledTransaction.spotId),
    plateNumber: settledTransaction.plateNumber,
    entryTimestamp: settledTransaction.entryTimestamp,
    exitTimestamp: exitTime,
    durationSeconds,
    fare: fareDetails.total,
    penaltyApplied: lostTicket,
    breakdown: {
      baseFare: fareDetails.baseFare,
      ...(fareDetails.lostTicketPenalty
        ? { lostTicketPenalty: fareDetails.lostTicketPenalty }
        : {}),
      ...(fareDetails.overstayPenalty
        ? { overstayPenalty: fareDetails.overstayPenalty }
        : {}),
    },
  };
}

module.exports = { lookupByTicket, searchByPlate, processExit };
