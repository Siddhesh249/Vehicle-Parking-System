/**
 * Sprint 1 — T2: Mongoose Schema Validation Unit Tests
 *
 * Tests schema-level constraints (required fields, enum values, defaults and
 * bounds) against the isolated MongoDB test database configured for Jest.
 *
 * SRS refs  : SAD 3.6 (data model), VPS-F-001..005, VPS-F-010..016, VPS-F-033..034
 * Sprint ref: Sprint 1, Track T2 (Sumukh)
 */

"use strict";

const mongoose = require("mongoose");
const { connectTestDatabase, disconnectTestDatabase } = require("./testDatabase");

// ── Models (imported after connection is ready in beforeAll) ──────────────────
// These modules do not exist yet — the tests are written against the contracts
// specified in the SAD (Section 3.6) and SRS. When the implementation lands,
// the imports below must resolve correctly for the tests to pass.
let Vehicle, User, Spot, Transaction, AuditLog, FareTierConfig;

beforeAll(async () => {
  await connectTestDatabase();

  // Lazy-require after the connection is open so Mongoose can register models.
  try {
    Vehicle = require("../models/Vehicle");
    User = require("../models/User");
    Spot = require("../models/Spot");
    Transaction = require("../models/Transaction");
    AuditLog = require("../models/AuditLog");
    FareTierConfig = require("../models/FareTierConfig");
  } catch {
    // Models not implemented yet (TDD phase)
  }
});

describe("Vehicle schema", () => {
  test("normalizes plate numbers and saves a supported vehicle type", async () => {
    const doc = await Vehicle.create({ plateNumber: " ka01ab1234 ", vehicleType: "4W" });
    expect(doc.plateNumber).toBe("KA01AB1234");
    expect(doc.vehicleType).toBe("4W");
  });

  test("rejects a missing plate number", async () => {
    await expect(Vehicle.create({ vehicleType: "2W" })).rejects.toThrow(
      mongoose.Error.ValidationError,
    );
  });

  test("rejects an unsupported vehicle type", async () => {
    await expect(
      Vehicle.create({ plateNumber: "KA01AB1234", vehicleType: "3W" }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });
});

afterAll(async () => {
  await disconnectTestDatabase();
});

afterEach(async () => {
  // Wipe all collections between tests to prevent cross-test pollution.
  if (mongoose.connection.readyState === 1) {
    const cols = mongoose.connection.collections;
    await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// User schema  (VPS-F-001..005, PRJ-SR-002/003)
// ─────────────────────────────────────────────────────────────────────────────
describe("User schema", () => {
  test("saves a valid gate-operator document", async () => {
    const doc = await User.create({
      username: "entry1_op",
      passwordHash: "$2b$10$fakehashvalue",
      role: "operator",
      gateId: "Entry-1",
    });
    expect(doc._id).toBeDefined();
    expect(doc.username).toBe("entry1_op");
    expect(doc.role).toBe("operator");
    expect(doc.gateId).toBe("Entry-1");
  });

  test("saves a valid admin document (no gateId required)", async () => {
    const doc = await User.create({
      username: "admin",
      passwordHash: "$2b$10$fakehashvalue",
      role: "admin",
    });
    expect(doc.role).toBe("admin");
    expect(doc.gateId).toBeUndefined();
  });

  test("rejects a document with missing required username", async () => {
    await expect(
      User.create({ passwordHash: "$2b$10$fake", role: "operator", gateId: "Entry-1" }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects a document with missing required passwordHash", async () => {
    await expect(
      User.create({ username: "op2", role: "operator", gateId: "Entry-1" }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid role value", async () => {
    await expect(
      User.create({
        username: "bad_role",
        passwordHash: "$2b$10$fake",
        role: "superuser", // not in the enum
        gateId: "Entry-1",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid gateId value for operators", async () => {
    // gateId must be one of Entry-1, Entry-2, Exit-1, Exit-2 per SRS 2.3
    await expect(
      User.create({
        username: "bad_gate",
        passwordHash: "$2b$10$fake",
        role: "operator",
        gateId: "Gate-99",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("defaults failedLoginAttempts to 0", async () => {
    const doc = await User.create({
      username: "fresh_user",
      passwordHash: "$2b$10$fake",
      role: "operator",
      gateId: "Exit-2",
    });
    expect(doc.failedLoginAttempts).toBe(0);
  });

  test("defaults isLocked to false", async () => {
    const doc = await User.create({
      username: "unlocked_user",
      passwordHash: "$2b$10$fake",
      role: "operator",
      gateId: "Entry-2",
    });
    expect(doc.isLocked).toBe(false);
  });

  test("stores a lockUntil timestamp when set", async () => {
    const lockTime = new Date(Date.now() + 5 * 60 * 1000);
    const doc = await User.create({
      username: "locked_user",
      passwordHash: "$2b$10$fake",
      role: "operator",
      gateId: "Exit-1",
      isLocked: true,
      lockUntil: lockTime,
    });
    expect(doc.isLocked).toBe(true);
    expect(doc.lockUntil.getTime()).toBe(lockTime.getTime());
  });

  test("rejects an operator document with missing gateId (PRJ-SR-004)", async () => {
    // Gate operators must be bound to a specific physical gate
    await expect(
      User.create({
        username: "operator_no_gate",
        passwordHash: "$2b$10$fake",
        role: "operator",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("enforces unique usernames", async () => {
    await User.create({
      username: "dup_user",
      passwordHash: "$2b$10$fake",
      role: "operator",
      gateId: "Entry-1",
    });
    await expect(
      User.create({
        username: "dup_user",
        passwordHash: "$2b$10$other",
        role: "operator",
        gateId: "Entry-2",
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Spot schema  (VPS-F-011, VPS-F-012 — zone must match vehicle type)
// ─────────────────────────────────────────────────────────────────────────────
describe("Spot schema", () => {
  test("saves a valid 4W spot with status 'free'", async () => {
    const doc = await Spot.create({ spotNumber: "4W-001", zone: "4W", status: "free" });
    expect(doc.spotNumber).toBe("4W-001");
    expect(doc.zone).toBe("4W");
    expect(doc.status).toBe("free");
  });

  test("saves a valid 2W spot with status 'reserved'", async () => {
    const doc = await Spot.create({
      spotNumber: "2W-005",
      zone: "2W",
      status: "reserved",
    });
    expect(doc.zone).toBe("2W");
    expect(doc.status).toBe("reserved");
  });

  test("defaults status to 'free'", async () => {
    const doc = await Spot.create({ spotNumber: "2W-010", zone: "2W" });
    expect(doc.status).toBe("free");
  });

  test("enforces unique spotNumber (VPS-F-011)", async () => {
    await Spot.create({ spotNumber: "4W-099", zone: "4W", status: "free" });
    await expect(
      Spot.create({ spotNumber: "4W-099", zone: "4W", status: "free" }),
    ).rejects.toThrow();
  });

  test("rejects an invalid zone value", async () => {
    await expect(Spot.create({ spotNumber: "X-001", zone: "3W" })).rejects.toThrow(
      mongoose.Error.ValidationError,
    );
  });

  test("rejects an invalid status value", async () => {
    await expect(
      Spot.create({ spotNumber: "4W-002", zone: "4W", status: "occupied" }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects a missing spotNumber", async () => {
    await expect(Spot.create({ zone: "4W" })).rejects.toThrow(
      mongoose.Error.ValidationError,
    );
  });

  test("rejects a missing zone", async () => {
    await expect(Spot.create({ spotNumber: "4W-003" })).rejects.toThrow(
      mongoose.Error.ValidationError,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction schema  (VPS-F-010, VPS-F-037)
// ─────────────────────────────────────────────────────────────────────────────
describe("Transaction schema", () => {
  test("saves a complete active entry transaction", async () => {
    const now = new Date();
    const doc = await Transaction.create({
      ticketId: "TKT-20261002-001",
      plateNumber: "KA01AB1234",
      vehicleType: "4W",
      spotId: new mongoose.Types.ObjectId(),
      entryGateId: "Entry-1",
      entryOperatorId: new mongoose.Types.ObjectId(),
      entryTimestamp: now,
      status: "active",
    });
    expect(doc.ticketId).toBe("TKT-20261002-001");
    expect(doc.plateNumber).toBe("KA01AB1234");
    expect(doc.vehicleType).toBe("4W");
    expect(doc.status).toBe("active");
  });

  test("saves a completed exit transaction with fare details", async () => {
    const entry = new Date("2026-10-02T10:00:00Z");
    const exit = new Date("2026-10-02T12:30:00Z");
    const doc = await Transaction.create({
      ticketId: "TKT-20261002-002",
      plateNumber: "KA02CD5678",
      vehicleType: "2W",
      spotId: new mongoose.Types.ObjectId(),
      entryGateId: "Entry-2",
      entryOperatorId: new mongoose.Types.ObjectId(),
      entryTimestamp: entry,
      exitGateId: "Exit-1",
      exitOperatorId: new mongoose.Types.ObjectId(),
      exitTimestamp: exit,
      durationSeconds: 9000,
      fare: 30,
      penaltyApplied: false,
      status: "completed",
    });
    expect(doc.status).toBe("completed");
    expect(doc.fare).toBe(30);
    expect(doc.durationSeconds).toBe(9000);
  });

  test("rejects missing required ticketId", async () => {
    await expect(
      Transaction.create({
        plateNumber: "KA03EF9012",
        vehicleType: "4W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Entry-1",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "active",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid vehicleType", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-BAD-001",
        plateNumber: "KA04GH3456",
        vehicleType: "3W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Entry-1",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "active",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid status value", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-BAD-002",
        plateNumber: "KA05IJ7890",
        vehicleType: "2W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Entry-2",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "pending",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects missing required plateNumber (VPS-F-010)", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-NO-PLATE-001",
        vehicleType: "4W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Entry-1",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "active",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects missing required spotId (VPS-F-010)", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-NO-SPOT-001",
        plateNumber: "KA01AB9999",
        vehicleType: "4W",
        entryGateId: "Entry-1",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "active",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects invalid entryGateId", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-BAD-GATE-001",
        plateNumber: "KA01AB9999",
        vehicleType: "4W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Gate-99",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        status: "active",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects invalid exitGateId", async () => {
    await expect(
      Transaction.create({
        ticketId: "TKT-BAD-GATE-002",
        plateNumber: "KA01AB9999",
        vehicleType: "4W",
        spotId: new mongoose.Types.ObjectId(),
        entryGateId: "Entry-1",
        entryOperatorId: new mongoose.Types.ObjectId(),
        entryTimestamp: new Date(),
        exitGateId: "Exit-99",
        exitOperatorId: new mongoose.Types.ObjectId(),
        exitTimestamp: new Date(),
        status: "completed",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("defaults status to 'active'", async () => {
    const doc = await Transaction.create({
      ticketId: "TKT-DEFAULT-STATUS",
      plateNumber: "KA01CD1234",
      vehicleType: "2W",
      spotId: new mongoose.Types.ObjectId(),
      entryGateId: "Entry-2",
      entryOperatorId: new mongoose.Types.ObjectId(),
      entryTimestamp: new Date(),
    });
    expect(doc.status).toBe("active");
  });

  test("enforces unique ticketId", async () => {
    const shared = {
      ticketId: "TKT-DUP-001",
      plateNumber: "KA06KL1234",
      vehicleType: "4W",
      spotId: new mongoose.Types.ObjectId(),
      entryGateId: "Entry-1",
      entryOperatorId: new mongoose.Types.ObjectId(),
      entryTimestamp: new Date(),
      status: "active",
    };
    await Transaction.create(shared);
    await expect(
      Transaction.create({ ...shared, plateNumber: "KA07MN5678" }),
    ).rejects.toThrow();
  });

  test("allows vehicle history but enforces only one active transaction per plate", async () => {
    const shared = {
      plateNumber: "KA08OP1234",
      vehicleType: "4W",
      spotId: new mongoose.Types.ObjectId(),
      entryGateId: "Entry-1",
      entryOperatorId: new mongoose.Types.ObjectId(),
      entryTimestamp: new Date(),
    };
    await Transaction.create({ ...shared, ticketId: "TKT-ACTIVE-001", status: "active" });
    await expect(
      Transaction.create({ ...shared, ticketId: "TKT-ACTIVE-002", status: "active" }),
    ).rejects.toThrow();
    await expect(
      Transaction.create({ ...shared, ticketId: "TKT-HISTORY-001", status: "completed" }),
    ).resolves.toMatchObject({ status: "completed" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuditLog schema  (VPS-F-060..062, PRJ-SR-006)
// ─────────────────────────────────────────────────────────────────────────────
describe("AuditLog schema", () => {
  test("saves a valid audit log entry", async () => {
    const doc = await AuditLog.create({
      action: "VEHICLE_ENTRY",
      actorId: new mongoose.Types.ObjectId(),
      actorRole: "operator",
      details: { ticketId: "TKT-20261002-001", spotId: "4W-001" },
    });
    expect(doc._id).toBeDefined();
    expect(doc.action).toBe("VEHICLE_ENTRY");
    expect(doc.actorRole).toBe("operator");
  });

  test("timestamps are auto-generated", async () => {
    const doc = await AuditLog.create({
      action: "LOGIN_SUCCESS",
      actorId: new mongoose.Types.ObjectId(),
      actorRole: "admin",
    });
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  test("rejects missing required action field", async () => {
    await expect(
      AuditLog.create({
        actorId: new mongoose.Types.ObjectId(),
        actorRole: "operator",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects missing required actorRole field", async () => {
    await expect(
      AuditLog.create({
        action: "VEHICLE_EXIT",
        actorId: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects missing required actorId field", async () => {
    await expect(
      AuditLog.create({
        action: "VEHICLE_ENTRY",
        actorRole: "operator",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid actorRole", async () => {
    await expect(
      AuditLog.create({
        action: "LOGIN_FAIL",
        actorId: new mongoose.Types.ObjectId(),
        actorRole: "developer",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects an invalid action enum value", async () => {
    await expect(
      AuditLog.create({
        action: "UNKNOWN_ACTION_NAME",
        actorId: new mongoose.Types.ObjectId(),
        actorRole: "admin",
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects application-level updates and deletes to preserve append-only history", async () => {
    await expect(
      AuditLog.updateOne({}, { $set: { action: "VEHICLE_EXIT" } }),
    ).rejects.toThrow("append-only");
    await expect(AuditLog.deleteMany({})).rejects.toThrow("append-only");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FareTierConfig schema  (VPS-F-033, VPS-F-034, VPS-F-055)
// ─────────────────────────────────────────────────────────────────────────────
describe("FareTierConfig schema", () => {
  test("saves a valid 4W fare tier config", async () => {
    const doc = await FareTierConfig.create({
      vehicleType: "4W",
      firstHourFree: true,
      tiers: [
        { afterHours: 1, ratePerHour: 20 },
        { afterHours: 3, ratePerHour: 30 },
        { afterHours: 6, ratePerHour: 50 },
      ],
      lostTicketPenalty: 100,
      overstayPenalty: 200,
    });
    expect(doc.vehicleType).toBe("4W");
    expect(doc.firstHourFree).toBe(true);
    expect(doc.tiers).toHaveLength(3);
    expect(doc.tiers[0].ratePerHour).toBe(20);
  });

  test("saves a valid 2W fare tier config", async () => {
    const doc = await FareTierConfig.create({
      vehicleType: "2W",
      firstHourFree: true,
      tiers: [
        { afterHours: 1, ratePerHour: 10 },
        { afterHours: 3, ratePerHour: 15 },
      ],
      lostTicketPenalty: 50,
      overstayPenalty: 100,
    });
    expect(doc.vehicleType).toBe("2W");
    expect(doc.tiers[1].ratePerHour).toBe(15);
  });

  test("rejects an invalid vehicleType", async () => {
    await expect(
      FareTierConfig.create({
        vehicleType: "3W",
        tiers: [{ afterHours: 1, ratePerHour: 20 }],
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects a negative ratePerHour in tiers", async () => {
    await expect(
      FareTierConfig.create({
        vehicleType: "4W",
        tiers: [{ afterHours: 1, ratePerHour: -5 }],
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects a negative lostTicketPenalty", async () => {
    await expect(
      FareTierConfig.create({
        vehicleType: "2W",
        tiers: [{ afterHours: 1, ratePerHour: 10 }],
        lostTicketPenalty: -10,
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("rejects a negative overstayPenalty", async () => {
    await expect(
      FareTierConfig.create({
        vehicleType: "4W",
        tiers: [{ afterHours: 1, ratePerHour: 20 }],
        overstayPenalty: -50,
      }),
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  test("enforces unique vehicleType (one config doc per vehicle type)", async () => {
    await FareTierConfig.create({
      vehicleType: "4W",
      tiers: [{ afterHours: 1, ratePerHour: 20 }],
    });
    await expect(
      FareTierConfig.create({
        vehicleType: "4W",
        tiers: [{ afterHours: 1, ratePerHour: 25 }],
      }),
    ).rejects.toThrow();
  });
});
