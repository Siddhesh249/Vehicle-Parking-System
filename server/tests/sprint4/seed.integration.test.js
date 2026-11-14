/** Sprint 4 polish: the demo seed starts with believable sample activity. */
"use strict";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../../models/User");
const Spot = require("../../models/Spot");
const Transaction = require("../../models/Transaction");
const AuditLog = require("../../models/AuditLog");
const {
  seedDatabase,
  DEMO_ACTIVE_ENTRIES,
  DEMO_COMPLETED_ENTRIES,
} = require("../../seed");

jest.setTimeout(30000);

describe("demo seed data", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("creates accounts, spots, active timers, completed revenue and audit history", async () => {
    const result = await seedDatabase({ password: "password123" });

    expect(result.accounts).toBe(5);
    expect(result.spotCounts).toEqual({ "2W": 6, "4W": 10 });
    expect(result.demo).toEqual({
      active: DEMO_ACTIVE_ENTRIES.length,
      completed: DEMO_COMPLETED_ENTRIES.length,
      auditEntries: DEMO_ACTIVE_ENTRIES.length + DEMO_COMPLETED_ENTRIES.length * 2,
    });
    await expect(User.countDocuments()).resolves.toBe(5);
    await expect(Spot.countDocuments()).resolves.toBe(16);
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length,
    );
    await expect(Transaction.countDocuments({ status: "completed" })).resolves.toBe(
      DEMO_COMPLETED_ENTRIES.length,
    );
    await expect(AuditLog.countDocuments()).resolves.toBe(result.demo.auditEntries);
    await expect(
      Transaction.countDocuments({ status: "active", isOverstay: true }),
    ).resolves.toBe(0);
  });

  test("is idempotent when re-run", async () => {
    const result = await seedDatabase({ password: "password123" });

    expect(result.demo.active).toBe(DEMO_ACTIVE_ENTRIES.length);
    expect(result.demo.completed).toBe(DEMO_COMPLETED_ENTRIES.length);
    await expect(User.countDocuments()).resolves.toBe(5);
    await expect(Spot.countDocuments()).resolves.toBe(16);
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length,
    );
    await expect(Transaction.countDocuments({ status: "completed" })).resolves.toBe(
      DEMO_COMPLETED_ENTRIES.length,
    );
  });

  test("resetDemo clears stale parked cars and revenue before reseeding", async () => {
    await seedDatabase({ password: "password123" });
    const spot = await Spot.findOne({ zone: "4W" }).lean();
    const user = await User.findOne({ username: "admin" }).lean();
    const stray = await Transaction.create({
      ticketId: "TKT-STALE-9999",
      plateNumber: "KA99ST0001",
      vehicleType: "4W",
      spotId: spot._id,
      entryGateId: "Entry-1",
      entryOperatorId: user._id,
      entryTimestamp: new Date(Date.now() - 3600 * 1000),
      exitTimestamp: new Date(),
      fare: 1_400_000,
      status: "completed",
    });

    const result = await seedDatabase({ password: "password123", resetDemo: true });

    expect(result.resetDemo).toBe(true);
    await expect(Transaction.findById(stray._id)).resolves.toBeNull();
    await expect(Transaction.countDocuments()).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length + DEMO_COMPLETED_ENTRIES.length,
    );
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length,
    );
  });
});
