"use strict";

const AuditLog = require("../models/AuditLog");

/**
 * Append one entry to the audit trail (VPS-F-060..062, PRJ-SR-006).
 *
 * The audit log is append-only: this module deliberately exposes no update or
 * delete operation. Persistence errors are propagated so callers never treat a
 * failed write as recorded.
 */
async function writeAuditEntry({ action, actorId, actorRole, details, ipAddress }) {
  const entry = { action, actorId, actorRole };
  if (details !== undefined) entry.details = details;
  if (ipAddress !== undefined) entry.ipAddress = ipAddress;
  return AuditLog.create(entry);
}

module.exports = Object.freeze({ writeAuditEntry });
