"use strict";

const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const Spot = require("../models/Spot");
const Transaction = require("../models/Transaction");
const AuditLog = require("../models/AuditLog");
const FareTierConfig = require("../models/FareTierConfig");
const SystemConfig = require("../models/SystemConfig");

const MAX_ROWS = 250;

/**
 * Raw collection browser for the Admin dashboard. The Admin already has root
 * visibility over the system, but credentials are never returned: the users
 * projection strips passwordHash (and lock bookkeeping is kept for diagnostics).
 */
const COLLECTIONS = [
  {
    name: "spots",
    model: Spot,
    sort: { zone: 1, spotNumber: 1 },
  },
  {
    name: "vehicles",
    model: Vehicle,
    sort: { createdAt: -1 },
  },
  {
    name: "transactions",
    model: Transaction,
    sort: { entryTimestamp: -1 },
  },
  {
    name: "auditlogs",
    model: AuditLog,
    sort: { createdAt: -1 },
  },
  {
    name: "users",
    model: User,
    projection: { passwordHash: 0 },
    sort: { createdAt: 1 },
  },
  {
    name: "faretierconfigs",
    model: FareTierConfig,
    sort: { vehicleType: 1 },
  },
  {
    name: "systemconfigs",
    model: SystemConfig,
    sort: { key: 1 },
  },
];

function serializableRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value instanceof Date) return [key, value.toISOString()];
      if (value && typeof value === "object" && typeof value.toHexString === "function") {
        return [key, value.toHexString()];
      }
      return [key, value];
    }),
  );
}

/** Snapshot of every collection, bounded so one huge log cannot freeze the UI. */
async function getDatabaseSnapshot() {
  const collections = {};
  const counts = {};
  const truncated = {};

  await Promise.all(
    COLLECTIONS.map(async ({ name, model, projection, sort }) => {
      const [rows, total] = await Promise.all([
        model
          .find({}, projection ?? {})
          .sort(sort)
          .limit(MAX_ROWS)
          .lean(),
        model.estimatedDocumentCount(),
      ]);
      collections[name] = rows.map(serializableRow);
      counts[name] = total;
      truncated[name] = total > rows.length;
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    rowLimit: MAX_ROWS,
    counts,
    truncated,
    collections,
  };
}

module.exports = { getDatabaseSnapshot, MAX_ROWS };
