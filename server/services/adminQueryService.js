"use strict";

const Transaction = require("../models/Transaction");
const AuditLog = require("../models/AuditLog");

const GATE_IDS = ["Entry-1", "Entry-2", "Exit-1", "Exit-2"];
const MAX_RESULTS = 500;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

function invalidQuery(message) {
  const error = new TypeError(message);
  error.code = "INVALID_REQUEST";
  error.statusCode = 400;
  return error;
}

// Query values are user-controlled; accepting only strings keeps arrays and
// operator objects out of the Mongo filter.
function optionalString(value, name) {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw invalidQuery(`${name} must be a single value`);
  return value.trim();
}

function parseDate(value, name) {
  const text = optionalString(value, name);
  if (text === undefined) return undefined;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw invalidQuery(`${name} must be a valid date`);
  return date;
}

function dateRangeFilter(from, to) {
  const start = parseDate(from, "from");
  const end = parseDate(to, "to");
  if (start && end && start > end) throw invalidQuery("from must not be after to");
  if (!start && !end) return undefined;
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
}

/** Raw transaction records filtered by plate, entry date range and gate (VPS-F-054). */
async function listTransactions({ plate, from, to, gate } = {}) {
  const filter = {};

  const plateNumber = optionalString(plate, "plate");
  if (plateNumber) filter.plateNumber = plateNumber.toUpperCase();

  const gateId = optionalString(gate, "gate");
  if (gateId) {
    if (!GATE_IDS.includes(gateId)) throw invalidQuery(`gate must be one of ${GATE_IDS.join(", ")}`);
    filter.$or = [{ entryGateId: gateId }, { exitGateId: gateId }];
  }

  const entryRange = dateRangeFilter(from, to);
  if (entryRange) filter.entryTimestamp = entryRange;

  const records = await Transaction.find(filter)
    .sort({ entryTimestamp: -1 })
    .limit(MAX_RESULTS)
    .lean();
  return { records };
}

/** Audit trail filtered by action, actor and date range, newest first (VPS-F-060, VPS-F-061). */
async function listAuditEntries({ action, actor, from, to } = {}) {
  const filter = {};

  const actionName = optionalString(action, "action");
  if (actionName) {
    if (!AuditLog.schema.path("action").enumValues.includes(actionName)) {
      throw invalidQuery("action is not a recognised audit action");
    }
    filter.action = actionName;
  }

  const actorId = optionalString(actor, "actor");
  if (actorId) {
    if (!OBJECT_ID_PATTERN.test(actorId)) throw invalidQuery("actor must be a user ID");
    filter.actorId = actorId;
  }

  const createdRange = dateRangeFilter(from, to);
  if (createdRange) filter.createdAt = createdRange;

  const entries = await AuditLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(MAX_RESULTS)
    .lean();
  return { entries };
}

module.exports = { listTransactions, listAuditEntries };
