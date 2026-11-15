/** Sprint 4 polish: the demo seed starts with believable sample activity. */
"use strict";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../../models/User");
const Spot = require("../../models/Spot");
const Transaction = require("../../models/Transaction");
const AuditLog = require("../../models/AuditLog");
const { getOccupancy, getRevenue } = require("../../services/analyticsService");
const { seedDatabase, DEMO_ACTIVE_ENTRIES, DEMO_DAILY_SCALES } = require("../../seed");

jest.setTimeout(60000);

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
    expect(result.demo.active).toBe(DEMO_ACTIVE_ENTRIES.length);
    expect(result.demo.completed).toBeGreaterThan(80);
    expect(result.demo.auditEntries).toBe(
      DEMO_ACTIVE_ENTRIES.length + result.demo.completed * 2,
    );
    await expect(User.countDocuments()).resolves.toBe(5);
    await expect(Spot.countDocuments()).resolves.toBe(16);
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length,
    );
    await expect(Transaction.countDocuments({ status: "completed" })).resolves.toBe(
      result.demo.completed,
    );
    await expect(AuditLog.countDocuments()).resolves.toBe(result.demo.auditEntries);
    await expect(
      Transaction.countDocuments({ status: "active", isOverstay: true }),
    ).resolves.toBe(0);
  });

  test("the seeded week gives both admin charts realistic variation", async () => {
    await seedDatabase({ password: "password123" });

    const revenue = await getRevenue();
    expect(revenue.byDay).toHaveLength(DEMO_DAILY_SCALES.length);
    expect(revenue.total).toBeGreaterThan(30_000);
    const dailyTotals = revenue.byDay.map((day) => day.total);
    for (const total of dailyTotals) {
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(11_000);
    }
    expect(dailyTotals.filter((total) => total > 3_000).length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...dailyTotals) - Math.min(...dailyTotals)).toBeGreaterThan(2_000);

    const occupancy = await getOccupancy();
    const busyHours = occupancy.history.filter((point) => point.occupied > 0);
    expect(busyHours.length).toBeGreaterThan(4);
    expect(occupancy.history.at(-1).pct).toBe(occupancy.totalPct);
  });

  test("is idempotent when re-run", async () => {
    const result = await seedDatabase({ password: "password123" });

    expect(result.demo.active).toBe(DEMO_ACTIVE_ENTRIES.length);
    expect(result.demo.completed).toBeGreaterThan(80);
    await expect(User.countDocuments()).resolves.toBe(5);
    await expect(Spot.countDocuments()).resolves.toBe(16);
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      DEMO_ACTIVE_ENTRIES.length,
    );
    await expect(Transaction.countDocuments({ status: "completed" })).resolves.toBe(
      result.demo.completed,
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
      result.demo.active + result.demo.completed,
    );
    await expect(Transaction.countDocuments({ status: "active" })).resolves.toBe(
      result.demo.active,
    );
  });
});
