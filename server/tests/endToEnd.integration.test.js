/** Sprint 3 — T5: cross-module integration acceptance scenarios (STP 5.1, 6.3). */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("../app");
const Spot = require("../models/Spot");
const Transaction = require("../models/Transaction");
const AuditLog = require("../models/AuditLog");
const { signToken } = require("../utils/jwtUtils");

jest.setTimeout(60000);

const entryToken = signToken({
  userId: new mongoose.Types.ObjectId().toString(),
  role: "operator",
  gateId: "Entry-1",
});
const exitToken = signToken({
  userId: new mongoose.Types.ObjectId().toString(),
  role: "operator",
  gateId: "Exit-1",
});
const adminToken = signToken({
  userId: new mongoose.Types.ObjectId().toString(),
  role: "admin",
});
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("S3-T5 — integrated parking API workflows", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("persists a complete entry-to-exit workflow and releases the allocated spot", async () => {
    const entry = await request(app)
      .post("/api/entry/vehicles")
      .set(auth(entryToken))
      .send({ plateNumber: "KA01AB1234", vehicleType: "4W" })
      .expect(201);
    const active = await Transaction.findOne({ ticketId: entry.body.ticketId }).lean();
    expect(active).toEqual(
      expect.objectContaining({ status: "active", spotId: expect.any(Object) }),
    );
    await expect(Spot.findById(entry.body.spotId).lean()).resolves.toEqual(
      expect.objectContaining({ status: "reserved" }),
    );

    const exit = await request(app)
      .post("/api/exit/process")
      .set(auth(exitToken))
      .send({ ticketId: entry.body.ticketId })
      .expect(200);
    expect(exit.body).toEqual(
      expect.objectContaining({ ticketId: entry.body.ticketId, penaltyApplied: false }),
    );
    await expect(Transaction.findById(active._id).lean()).resolves.toEqual(
      expect.objectContaining({ status: "completed", fare: expect.any(Number) }),
    );
    await expect(Spot.findById(entry.body.spotId).lean()).resolves.toEqual(
      expect.objectContaining({ status: "free", currentTransactionId: null }),
    );
  });

  test("applies and persists the lost-ticket penalty for a plate lookup exit", async () => {
    await request(app)
      .post("/api/entry/vehicles")
      .set(auth(entryToken))
      .send({ plateNumber: "KA02CD5678", vehicleType: "2W" })
      .expect(201);
    const receipt = await request(app)
      .post("/api/exit/process")
      .set(auth(exitToken))
      .send({ plateNumber: "KA02CD5678" })
      .expect(200);
    expect(receipt.body).toEqual(
      expect.objectContaining({
        penaltyApplied: true,
        breakdown: expect.objectContaining({ lostTicketPenalty: expect.any(Number) }),
      }),
    );
    await expect(
      Transaction.findOne({ plateNumber: "KA02CD5678" }).lean(),
    ).resolves.toEqual(
      expect.objectContaining({ status: "completed", penaltyApplied: true }),
    );
  });

  test("enforces gate and admin boundaries across integrated routes", async () => {
    await request(app)
      .post("/api/entry/vehicles")
      .set(auth(exitToken))
      .send({ plateNumber: "KA03EF9012", vehicleType: "4W" })
      .expect(403);
    await request(app).get("/api/admin/transactions").set(auth(exitToken)).expect(403);
    await request(app).get("/api/admin/transactions").set(auth(adminToken)).expect(200);
  });

  test("records an overstay notification and force-release audit entry while applying its penalty", async () => {
    const entry = await request(app)
      .post("/api/entry/vehicles")
      .set(auth(entryToken))
      .send({ plateNumber: "KA04GH3456", vehicleType: "4W" })
      .expect(201);
    await request(app)
      .post("/api/overstay/notify")
      .set(auth(exitToken))
      .send({ vehicleId: entry.body.ticketId, gateId: "Exit-1" })
      .expect(200);
    const release = await request(app)
      .post(`/api/admin/vehicles/${entry.body.ticketId}/force-release`)
      .set(auth(adminToken))
      .expect(200);
    expect(release.body).toEqual(expect.objectContaining({ penaltyApplied: true }));
    await expect(
      AuditLog.find({
        action: { $in: ["OVERSTAY_FLAGGED", "SPOT_FORCE_RELEASE"] },
      }).lean(),
    ).resolves.toHaveLength(2);
  });
});
