"use strict";

const { randomUUID } = require("node:crypto");
const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("./fareService");
const { getFareConfig } = require("./fareConfigService");
const { writeAuditEntry } = require("./auditService");
const { simulatedHoursBetween } = require("../utils/simulatedTime");
const { roundMoney } = require("../utils/money");
const { normalizePlate: canonicalPlate } = require("../utils/plate");

function serviceError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizePlate(plateNumber) {
  const normalized = canonicalPlate(plateNumber);
  if (!normalized) {
    throw serviceError("plateNumber must be a non-empty string", "INVALID_REQUEST", 400);
  }
  return normalized;
}

async function lookupByTicket(ticketId) {
  if (typeof ticketId !== "string" || !ticketId.trim()) {
    throw serviceError("ticketId must be a non-empty string", "INVALID_REQUEST", 400);
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

/**
 * Read-only fare preview used by the exit console after scanning a ticket.
 * It applies exactly the same rules as processExit (including the lost-ticket
 * penalty) but never mutates the transaction.
 */
async function quoteExit({
  ticketId,
  plateNumber,
  exitTimestamp = new Date(),
  useSimulationOverride = false,
} = {}) {
  const exitTime = new Date(exitTimestamp);
  if (!Number.isFinite(exitTime.getTime())) {
    throw serviceError("exitTimestamp must be a valid date", "INVALID_REQUEST", 400);
  }

  const lostTicket = !(typeof ticketId === "string" && ticketId.trim());
  if (lostTicket && !canonicalPlate(plateNumber)) {
    throw serviceError("A ticketId or plateNumber is required", "INVALID_REQUEST", 400);
  }

  let transaction;
  try {
    if (!lostTicket) transaction = await lookupByTicket(ticketId);
    else transaction = (await searchByPlate(plateNumber))[0];
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

  const billingEnd = transaction.parkingEndTimestamp
    ? new Date(transaction.parkingEndTimestamp)
    : exitTime;
  const durationMilliseconds =
    billingEnd.getTime() - new Date(transaction.entryTimestamp).getTime();
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    throw serviceError(
      "Exit timestamp cannot be before entry timestamp",
      "INVALID_REQUEST",
      400,
    );
  }
  const durationHours = simulatedHoursBetween(transaction.entryTimestamp, billingEnd);
  const fareConfig = await getFareConfig(transaction.vehicleType, {
    useSimulationOverride,
  });
  const fareDetails = calculateFareDetails(
    transaction.entryTimestamp,
    billingEnd,
    transaction.vehicleType,
    { lostTicket },
    fareConfig,
  );

  return {
    ticketId: transaction.ticketId,
    plateNumber: transaction.plateNumber,
    vehicleType: transaction.vehicleType,
    spotId: String(transaction.spotId),
    entryGateId: transaction.entryGateId,
    entryTimestamp: transaction.entryTimestamp,
    exitTimestamp: billingEnd,
    durationSeconds: durationHours * 3600,
    durationHours,
    lostTicket,
    fare: roundMoney(fareDetails.total),
    breakdown: {
      baseFare: roundMoney(fareDetails.baseFare),
      ...(fareDetails.lostTicketPenalty
        ? { lostTicketPenalty: fareDetails.lostTicketPenalty }
        : {}),
      ...(fareDetails.overstayPenalty
        ? { overstayPenalty: fareDetails.overstayPenalty }
        : {}),
    },
  };
}

async function processExit({
  ticketId,
  plateNumber,
  gateId,
  operatorId,
  exitTimestamp = new Date(),
  useSimulationOverride = false,
} = {}) {
  if (!gateId || !operatorId) {
    throw serviceError("gateId and operatorId are required", "INVALID_REQUEST", 400);
  }
  const exitTime = new Date(exitTimestamp);
  if (!Number.isFinite(exitTime.getTime())) {
    throw serviceError("exitTimestamp must be a valid date", "INVALID_REQUEST", 400);
  }

  let transaction;
  const lostTicket = !(typeof ticketId === "string" && ticketId.trim());
  if (lostTicket && !canonicalPlate(plateNumber)) {
    throw serviceError("A ticketId or plateNumber is required", "INVALID_REQUEST", 400);
  }
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

  // Parking time stops when the car joins the exit queue, not when the
  // operator gets around to taking payment.
  const billingEnd = transaction.parkingEndTimestamp
    ? new Date(transaction.parkingEndTimestamp)
    : exitTime;
  const durationMilliseconds =
    billingEnd.getTime() - new Date(transaction.entryTimestamp).getTime();
  if (!Number.isFinite(durationMilliseconds) || durationMilliseconds < 0) {
    throw serviceError(
      "Exit timestamp cannot be before entry timestamp",
      "INVALID_REQUEST",
      400,
    );
  }
  const durationHours = simulatedHoursBetween(transaction.entryTimestamp, billingEnd);
  const durationSeconds = durationHours * 3600;
  const fareConfig = await getFareConfig(transaction.vehicleType, {
    useSimulationOverride,
  });
  const fareDetails = calculateFareDetails(
    transaction.entryTimestamp,
    billingEnd,
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
        exitTimestamp: billingEnd,
        durationSeconds,
        fare: roundMoney(fareDetails.total),
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
      {
        _id: settledTransaction.spotId,
        status: "reserved",
        // Only free the spot if it still belongs to this transaction. A newly
        // parked car (which owns the spot from the moment it claims it) is
        // never touched.
        currentTransactionId: settledTransaction._id,
      },
      { $set: { status: "free", currentTransactionId: null } },
      { returnDocument: "after" },
    );
  } catch (error) {
    // Do not report a completed exit while its spot remains unavailable. The
    // compare-and-set prevents this compensation from undoing another exit.
    await Transaction.findOneAndUpdate(
      { _id: settledTransaction._id, status: "completed", exitTimestamp: billingEnd },
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
    action: "VEHICLE_EXIT",
    actorId: operatorId,
    actorRole: "operator",
    details: {
      transactionId: String(settledTransaction._id),
      ticketId: settledTransaction.ticketId,
      plateNumber: settledTransaction.plateNumber,
      spotId: String(settledTransaction.spotId),
      gateId,
      fare: fareDetails.total,
      durationSeconds,
      durationHours,
      penaltyApplied: lostTicket,
    },
  });

  return {
    receiptId: randomUUID(),
    ticketId: settledTransaction.ticketId,
    spotId: String(settledTransaction.spotId),
    plateNumber: settledTransaction.plateNumber,
    entryTimestamp: settledTransaction.entryTimestamp,
    exitTimestamp: billingEnd,
    durationSeconds,
    durationHours,
    fare: roundMoney(fareDetails.total),
    penaltyApplied: lostTicket,
    breakdown: {
      baseFare: roundMoney(fareDetails.baseFare),
      ...(fareDetails.lostTicketPenalty
        ? { lostTicketPenalty: fareDetails.lostTicketPenalty }
        : {}),
      ...(fareDetails.overstayPenalty
        ? { overstayPenalty: fareDetails.overstayPenalty }
        : {}),
    },
  };
}

module.exports = { lookupByTicket, searchByPlate, quoteExit, processExit };
