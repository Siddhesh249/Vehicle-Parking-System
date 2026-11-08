/**
 * Sprint 4 hardening — admin configuration reads/writes and automatic
 * overstay visibility (VPS-F-040, VPS-F-055, VPS-F-056, PRJ-SR-005).
 */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("../../app");
const Spot = require("../../models/Spot");
const Transaction = require("../../models/Transaction");
const { signToken } = require("../../utils/jwtUtils");
const { scanOverstays } = require("../../services/overstayService");

jest.setTimeout(30000);

const ADMIN_ID = new mongoose.Types.ObjectId().toString();
const OPERATOR_ID = new mongoose.Types.ObjectId().toString();

const adminToken = () => signToken({ userId: ADMIN_ID, role: "admin" });
const operatorToken = (gateId = "Entry-1") =>
  signToken({ userId: OPERATOR_ID, role: "operator", gateId });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("Sprint 4 — admin configuration and overstay feed", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "2W-002", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
      { spotNumber: "4W-002", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("returns the effective fare configuration for both vehicle types", async () => {
    const response = await request(app)
      .get("/api/admin/config/fare-tiers")
      .set(auth(adminToken()))
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        "2W": expect.objectContaining({
          firstHourFree: true,
          tiers: expect.arrayContaining([
            expect.objectContaining({ afterHours: 1, rate: 10 }),
          ]),
          lostTicketPenalty: 50,
          overstayPenalty: 100,
        }),
        "4W": expect.objectContaining({
          tiers: expect.arrayContaining([
            expect.objectContaining({ afterHours: 6, rate: 50 }),
          ]),
          lostTicketPenalty: 100,
          overstayPenalty: 200,
        }),
      }),
    );
  });

  test("persists fare tiers, first-hour policy and penalties for later reads", async () => {
    await request(app)
      .put("/api/admin/config/fare-tiers")
      .set(auth(adminToken()))
      .send({
        vehicleType: "4W",
        firstHourFree: false,
        tiers: [
          { afterHours: 0, rate: 15 },
          { afterHours: 4, rate: 25 },
        ],
        lostTicketPenalty: 125,
        overstayPenalty: 250,
      })
      .expect(200);

    const response = await request(app)
      .get("/api/admin/config/fare-tiers")
      .set(auth(adminToken()))
      .expect(200);

    expect(response.body["4W"]).toEqual({
      firstHourFree: false,
      tiers: [
        { afterHours: 0, rate: 15 },
        { afterHours: 4, rate: 25 },
      ],
      lostTicketPenalty: 125,
      overstayPenalty: 250,
    });
  });

  test("reports per-zone spot counts and applies a new count", async () => {
    await expect(
      request(app).get("/api/admin/config/spots").set(auth(adminToken())).expect(200),
    ).resolves.toEqual(expect.objectContaining({ body: { "2W": 2, "4W": 2 } }));

    const updated = await request(app)
      .put("/api/admin/config/spots")
      .set(auth(adminToken()))
      .send({ zone: "2W", count: 4 })
      .expect(200);

    expect(updated.body).toEqual({ updated: true, zone: "2W", count: 4 });
    await expect(Spot.countDocuments({ zone: "2W" })).resolves.toBe(4);
  });

  test("does not remove a reserved spot when shrinking a zone", async () => {
    await Spot.findOneAndUpdate(
      { spotNumber: "2W-002" },
      { $set: { status: "reserved" } },
    );

    await request(app)
      .put("/api/admin/config/spots")
      .set(auth(adminToken()))
      .send({ zone: "2W", count: 1 })
      .expect(200);

    const remaining = await Spot.find({ zone: "2W" }).lean();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].spotNumber).toBe("2W-002");

    await request(app)
      .put("/api/admin/config/spots")
      .set(auth(adminToken()))
      .send({ zone: "2W", count: 0 })
      .expect(409);
  });

  test("keeps the new admin reads and overstay feed admin-only", async () => {
    const routes = [
      request(app).get("/api/admin/config/fare-tiers"),
      request(app).get("/api/admin/config/spots"),
      request(app).get("/api/admin/overstays"),
    ];
    const responses = await Promise.all(
      routes.map((call) => call.set(auth(operatorToken()))),
    );
    expect(responses.map(({ status }) => status)).toEqual([403, 403, 403]);
  });

  test("lists vehicles that crossed the overstay threshold without an operator action", async () => {
    const spot = await Spot.findOne({ spotNumber: "4W-001" });
    await Spot.updateOne({ _id: spot._id }, { $set: { status: "reserved" } });
    await Transaction.create({
      ticketId: "TKT-AUTO-OVERSTAY",
      plateNumber: "KA09OV0001",
      vehicleType: "4W",
      spotId: spot._id,
      entryGateId: "Entry-1",
      entryOperatorId: OPERATOR_ID,
      entryTimestamp: new Date(Date.now() - 3 * 60 * 60 * 1000),
      status: "active",
    });

    const response = await request(app)
      .get("/api/admin/overstays")
      .set(auth(adminToken()))
      .expect(200);

    expect(response.body.overstays).toEqual([
      expect.objectContaining({
        ticketId: "TKT-AUTO-OVERSTAY",
        plateNumber: "KA09OV0001",
        gateId: "Entry-1",
        autoFlagged: true,
        duration: expect.any(Number),
      }),
    ]);
  });

  test("scans and persists the overstay flag exactly once", async () => {
    const spot = await Spot.findOne({ spotNumber: "4W-002" });
    const transaction = await Transaction.create({
      ticketId: "TKT-SCAN-ONCE",
      plateNumber: "KA09OV0002",
      vehicleType: "4W",
      spotId: spot._id,
      entryGateId: "Entry-2",
      entryOperatorId: OPERATOR_ID,
      entryTimestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
      status: "active",
    });

    const firstScan = await scanOverstays();
    expect(firstScan).toEqual([
      expect.objectContaining({
        vehicleId: String(transaction._id),
        ticketId: "TKT-SCAN-ONCE",
      }),
    ]);
    await expect(scanOverstays()).resolves.toEqual([]);
    await expect(Transaction.findById(transaction._id).lean()).resolves.toEqual(
      expect.objectContaining({ isOverstay: true }),
    );
  });
});
