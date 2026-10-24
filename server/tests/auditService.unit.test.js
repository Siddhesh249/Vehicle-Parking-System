/** Sprint 2 — T3: append-only audit writer (VPS-F-060..062, PRJ-SR-006). */
"use strict";

jest.mock("../models/AuditLog", () => ({ create: jest.fn() }));

const AuditLog = require("../models/AuditLog");
const auditService = require("../services/auditService");

describe("audit service", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes one timestamped action with actor identity, role, and details per call", async () => {
    const entry = { _id: "audit-1", action: "VEHICLE_ENTRY" };
    AuditLog.create.mockResolvedValue(entry);

    await expect(auditService.writeAuditEntry({
      action: "VEHICLE_ENTRY", actorId: "operator-1", actorRole: "operator", details: { ticketId: "TKT-1" },
    })).resolves.toBe(entry);

    expect(AuditLog.create).toHaveBeenCalledTimes(1);
    expect(AuditLog.create).toHaveBeenCalledWith({
      action: "VEHICLE_ENTRY", actorId: "operator-1", actorRole: "operator", details: { ticketId: "TKT-1" },
    });
  });

  test.each([
    ["VEHICLE_ENTRY", "operator"], ["VEHICLE_EXIT", "operator"],
    ["SPOT_FORCE_RELEASE", "admin"], ["OVERSTAY_FLAGGED", "operator"],
  ])("accepts state-changing audit action %s from %s actor", async (action, actorRole) => {
    AuditLog.create.mockResolvedValue({ action });
    await expect(auditService.writeAuditEntry({ action, actorId: "actor-1", actorRole })).resolves.toEqual({ action });
  });

  test("does not expose update or delete operations that could rewrite the audit trail", () => {
    expect(auditService).not.toHaveProperty("updateAuditEntry");
    expect(auditService).not.toHaveProperty("deleteAuditEntry");
    expect(auditService).not.toHaveProperty("removeAuditEntry");
  });

  test("does not claim a write succeeded when persistence rejects", async () => {
    AuditLog.create.mockRejectedValue(new Error("database unavailable"));
    await expect(auditService.writeAuditEntry({
      action: "VEHICLE_EXIT", actorId: "operator-1", actorRole: "operator",
    })).rejects.toThrow("database unavailable");
  });
});
