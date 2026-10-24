"use strict";

const { randomUUID } = require("node:crypto");
const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFare } = require("./fareService");

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

async function processExit({ ticketId, plateNumber, gateId, operatorId, exitTimestamp = new Date() } = {}) {
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
      throw serviceError("Vehicle has already exited or was not found", "ALREADY_EXITED", 409);
    }
    throw error;
  }

  const durationMilliseconds = exitTime.getTime() - new Date(transaction.entryTimestamp).getTime();
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    throw new RangeError("Exit timestamp cannot be before entry timestamp");
  }
  const durationSeconds = durationMilliseconds / 1000;
  const fare = calculateFare(transaction.entryTimestamp, exitTime, transaction.vehicleType, {
    lostTicket,
  });

  transaction.status = "completed";
  transaction.exitGateId = gateId;
  transaction.exitOperatorId = operatorId;
  transaction.exitTimestamp = exitTime;
  transaction.durationSeconds = durationSeconds;
  transaction.fare = fare;
  transaction.penaltyApplied = lostTicket;
  await transaction.save();
  await Spot.findByIdAndUpdate(transaction.spotId, {
    $set: { status: "free", currentTransactionId: null },
  });

  return {
    receiptId: randomUUID(),
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    entryTimestamp: transaction.entryTimestamp,
    exitTimestamp: exitTime,
    durationSeconds,
    fare,
    penaltyApplied: lostTicket,
  };
}

module.exports = { lookupByTicket, searchByPlate, processExit };
