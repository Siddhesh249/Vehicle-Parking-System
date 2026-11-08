/**
 * Sprint 4 — S4-T2/S4-T3: runtime fare overrides from the Simulation Console
 * affect real exit calculations without a restart (VPS-DEV-002).
 */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("../../app");
const Spot = require("../../models/Spot");
const Transaction = require("../../models/Transaction");
const { signToken } = require("../../utils/jwtUtils");
const {
  clearFareOverrides,
  stopSimulation,
} = require("../../services/simulationService");

jest.setTimeout(30000);

const ENTRY_OPERATOR_ID = new mongoose.Types.ObjectId().toString();
const EXIT_OPERATOR_ID = new mongoose.Types.ObjectId().toString();

const tokenFor = (role, gateId) =>
  signToken({
    userId: role === "admin" ? EXIT_OPERATOR_ID : ENTRY_OPERATOR_ID,
    role,
    gateId,
  });
const auth = (role, gateId) => ({ Authorization: `Bearer ${tokenFor(role, gateId)}` });

describe("S4-T2 — simulation fare-tier override", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    clearFareOverrides();
    stopSimulation();
    await Spot.create([{ spotNumber: "4W-001", zone: "4W", status: "reserved" }]);
  });

  afterAll(async () => {
    clearFareOverrides();
    stopSimulation();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("rejects malformed overrides before they can affect live fares", async () => {
    await request(app)
      .put("/api/dev/simulate/fare-tiers")
      .send({
        vehicleType: "4W",
        tiers: [
          { afterHours: 4, ratePerHour: 10 },
          { afterHours: 2, ratePerHour: 20 },
        ],
      })
      .expect(400);
  });

  test("applies an override to the next exit without restarting the server", async () => {
    await request(app)
      .put("/api/dev/simulate/fare-tiers")
      .send({
        vehicleType: "4W",
        firstHourFree: false,
        tiers: [{ afterHours: 0, ratePerHour: 7 }],
        lostTicketPenalty: 0,
        overstayPenalty: 0,
      })
      .expect(200);

    const spot = await Spot.findOne({ spotNumber: "4W-001" });
    await Transaction.create({
      ticketId: "TKT-OVERRIDE-1",
      plateNumber: "KA08SIM0001",
      vehicleType: "4W",
      spotId: spot._id,
      entryGateId: "Entry-1",
      entryOperatorId: ENTRY_OPERATOR_ID,
      entryTimestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
      status: "active",
    });

    const receipt = await request(app)
      .post("/api/exit/process")
      .set(auth("operator", "Exit-1"))
      .send({ ticketId: "TKT-OVERRIDE-1" })
      .expect(200);

    expect(receipt.body.fare).toBeCloseTo(14, 3);
    expect(receipt.body.breakdown.baseFare).toBeCloseTo(14, 3);
    expect(receipt.body.breakdown).not.toHaveProperty("lostTicketPenalty");
  });

  test("exposes the current generator state for the console", async () => {
    const response = await request(app).get("/api/dev/simulate/status").expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        running: false,
        ratePerMinute: 0,
        generatedArrivals: expect.any(Number),
        successfulAllocations: expect.any(Number),
        fullLotArrivals: expect.any(Number),
      }),
    );
  });

  test("keeps developer simulation endpoints unavailable in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await request(app).get("/api/dev/simulate/status").expect(404);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
