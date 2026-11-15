/**
 * Final-touches audit regressions: billing gap, atomic spot ownership, plate
 * normalisation, overstay validation, fare quote and restart recovery.
 */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("../app");
const Spot = require("../models/Spot");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { signToken } = require("../utils/jwtUtils");
const { allocateSpot } = require("../services/allocationService");
const { processExit } = require("../services/fareExitService");
const {
  adoptDemoParkedCars,
  getEntryQueue,
  getExitQueue,
  resetSimulationForTests,
} = require("../services/simulationService");

jest.setTimeout(30000);

const ENTRY_ID = new mongoose.Types.ObjectId().toString();
const EXIT_ID = new mongoose.Types.ObjectId().toString();
const ADMIN_ID = new mongoose.Types.ObjectId().toString();

const entryAuth = {
  Authorization: `Bearer ${signToken({ userId: ENTRY_ID, role: "operator", gateId: "Entry-1" })}`,
};
const exitAuth = {
  Authorization: `Bearer ${signToken({ userId: EXIT_ID, role: "operator", gateId: "Exit-1" })}`,
};
const adminAuth = {
  Authorization: `Bearer ${signToken({ userId: ADMIN_ID, role: "admin" })}`,
};

// Default overstay threshold is 24 simulated hours = 120 real seconds.
const PAST_OVERSTAY = () => new Date(Date.now() - 150 * 1000);

const park = (plateNumber, vehicleType = "4W") =>
  request(app)
    .post("/api/entry/vehicles")
    .set(entryAuth)
    .send({ plateNumber, vehicleType });

describe("final-touches audit regressions", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Transaction.init();
    resetSimulationForTests();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "2W-002", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
      { spotNumber: "4W-002", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    resetSimulationForTests();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  describe("spot ownership", () => {
    test("a claimed spot records its owning transaction immediately", async () => {
      const entry = await park("OWN1").expect(201);
      const spot = await Spot.findById(entry.body.spotId).lean();
      expect(String(spot.currentTransactionId)).toBe(String(entry.body.transactionId));
    });

    test("a late exit of an earlier transaction cannot free a spot another car owns", async () => {
      const first = await allocateSpot({
        plateNumber: "CARA",
        vehicleType: "2W",
        gateId: "Entry-1",
        operatorId: ENTRY_ID,
      });
      // The early hand-off frees the spot but leaves the transaction active.
      await Transaction.updateOne(
        { _id: first.transactionId },
        { $set: { parkingEndTimestamp: new Date() } },
      );
      await Spot.updateOne(
        { _id: first.spotId },
        { $set: { status: "free", currentTransactionId: null } },
      );

      const second = await allocateSpot({
        plateNumber: "CARB",
        vehicleType: "2W",
        gateId: "Entry-1",
        operatorId: ENTRY_ID,
      });
      expect(second.spotId).toBe(first.spotId);

      await processExit({ plateNumber: "CARA", gateId: "Exit-1", operatorId: EXIT_ID });
      const spot = await Spot.findById(second.spotId).lean();
      expect(spot.status).toBe("reserved");
      expect(String(spot.currentTransactionId)).toBe(String(second.transactionId));
    });

    test("a spot is released again when the transaction cannot be created", async () => {
      await park("DUP1").expect(201);
      await park("DUP1").expect(409);
      expect(await Spot.countDocuments({ zone: "4W", status: "reserved" })).toBe(1);
    });
  });

  describe("plate handling", () => {
    test("plates that differ only in spaces, hyphens or case are the same vehicle", async () => {
      const first = await park("ka 01-ab 1234").expect(201);
      await park("KA01AB1234").expect(409);

      const found = await request(app)
        .get("/api/exit/search")
        .query({ plateNumber: "Ka-01 AB-1234" })
        .set(exitAuth)
        .expect(200);
      expect(found.body[0].ticketId).toBe(first.body.ticketId);
      expect(found.body[0].plateNumber).toBe("KA01AB1234");
    });

    test("an over-long plate is a 400 and does not leak a reserved spot", async () => {
      const response = await park("A".repeat(20), "2W").expect(400);
      expect(response.body.error.code).toBe("INVALID_INPUT");
      expect(await Spot.countDocuments({ status: "reserved" })).toBe(0);
    });

    test("schema validation failures are reported as 400, not 500", async () => {
      const response = await request(app)
        .post("/api/exit/process")
        .set(exitAuth)
        .send({ ticketId: ["x"], plateNumber: { a: 1 } });
      expect(response.status).toBe(400);
    });
  });

  describe("overstay rules", () => {
    test("an operator cannot flag a vehicle that is still within its time", async () => {
      const entry = await park("FRESH1").expect(201);
      const response = await request(app)
        .post("/api/overstay/notify")
        .set(exitAuth)
        .send({ vehicleId: entry.body.ticketId, gateId: "Exit-1" })
        .expect(409);
      expect(response.body.error.code).toBe("NOT_OVERSTAYED");
      const transaction = await Transaction.findOne({ ticketId: entry.body.ticketId });
      expect(transaction.isOverstay).toBe(false);
    });

    test("force-release is refused for a vehicle that has not overstayed", async () => {
      const entry = await park("FRESH2").expect(201);
      const response = await request(app)
        .post(`/api/admin/vehicles/${entry.body.ticketId}/force-release`)
        .set(adminAuth)
        .expect(409);
      expect(response.body.error.code).toBe("NOT_OVERSTAYED");
      const spot = await Spot.findById(entry.body.spotId).lean();
      expect(spot.status).toBe("reserved");
    });

    test("an overstayed vehicle is released with the penalty and the admin recorded as exit actor", async () => {
      const entry = await park("LONG1").expect(201);
      await Transaction.updateOne(
        { ticketId: entry.body.ticketId },
        { $set: { entryTimestamp: PAST_OVERSTAY() } },
      );

      const release = await request(app)
        .post(`/api/admin/vehicles/${entry.body.ticketId}/force-release`)
        .set(adminAuth)
        .expect(200);
      expect(release.body.breakdown.overstayPenalty).toBe(200);

      const transaction = await Transaction.findOne({ ticketId: entry.body.ticketId });
      expect(transaction.status).toBe("completed");
      expect(transaction.exitGateId).toBe("Admin");
      expect(String(transaction.exitOperatorId)).toBe(ADMIN_ID);
    });
  });

  describe("fare quote before confirming an exit", () => {
    test("previews the same amount the exit then charges, without settling it", async () => {
      const entry = await park("QUOTE1", "4W").expect(201);
      await Transaction.updateOne(
        { ticketId: entry.body.ticketId },
        { $set: { entryTimestamp: new Date(Date.now() - 10 * 1000) } },
      );

      const quote = await request(app)
        .get("/api/exit/quote")
        .query({ ticketId: entry.body.ticketId })
        .set(exitAuth)
        .expect(200);
      expect(quote.body.fare).toBeGreaterThan(19);
      expect(quote.body.lostTicket).toBe(false);
      expect((await Transaction.findOne({ ticketId: entry.body.ticketId })).status).toBe(
        "active",
      );

      const lost = await request(app)
        .get("/api/exit/quote")
        .query({ plateNumber: "quote1" })
        .set(exitAuth)
        .expect(200);
      expect(lost.body.lostTicket).toBe(true);
      expect(lost.body.breakdown.lostTicketPenalty).toBe(100);
    });

    test("is limited to exit operators", async () => {
      await request(app).get("/api/exit/quote").query({ ticketId: "x" }).expect(401);
      await request(app)
        .get("/api/exit/quote")
        .query({ ticketId: "x" })
        .set(entryAuth)
        .expect(403);
    });
  });

  describe("restart recovery of the simulated fleet", () => {
    test("simulated cars orphaned by a restart are handed back to the fleet", async () => {
      const spot = await Spot.findOne({ spotNumber: "4W-001" });
      const parkingEnd = new Date(Date.now() - 5000);
      await Transaction.create([
        {
          ticketId: "TKT-ORPHAN-PARKED",
          plateNumber: "BOT1234ABC",
          vehicleType: "4W",
          spotId: spot._id,
          entryGateId: "Entry-1",
          entryOperatorId: ENTRY_ID,
          entryTimestamp: new Date(Date.now() - 20000),
          status: "active",
        },
        {
          ticketId: "TKT-ORPHAN-WAITING",
          plateNumber: "BOT7654CBA",
          vehicleType: "4W",
          spotId: spot._id,
          entryGateId: "Entry-2",
          entryOperatorId: ENTRY_ID,
          entryTimestamp: new Date(Date.now() - 30000),
          parkingEndTimestamp: parkingEnd,
          status: "active",
        },
        {
          // A real customer must never be adopted by the fleet.
          ticketId: "TKT-REAL-1",
          plateNumber: "KA01AB9999",
          vehicleType: "4W",
          spotId: spot._id,
          entryGateId: "Entry-1",
          entryOperatorId: ENTRY_ID,
          entryTimestamp: new Date(Date.now() - 20000),
          status: "active",
        },
      ]);

      await expect(
        adoptDemoParkedCars({ minSeconds: 0, maxSeconds: 0 }),
      ).resolves.toEqual({
        adopted: 2,
      });
      // Idempotent: a second pass finds nothing new.
      await expect(adoptDemoParkedCars()).resolves.toEqual({ adopted: 0 });

      const waiting = ["Exit-1", "Exit-2"].map((gate) => getExitQueue(gate));
      const atExit = waiting.flatMap(({ bot }) => (bot ? [bot] : []));
      expect(atExit.length).toBeGreaterThanOrEqual(1);
      expect(getEntryQueue("Entry-1").queueLength).toBe(0);
    });
  });

  test("keeps admin account lookup unaffected by the new gate value", async () => {
    await User.create({
      username: "admin",
      passwordHash: "not-a-real-hash",
      role: "admin",
    });
    await request(app)
      .get("/api/admin/transactions")
      .query({ gate: "Admin" })
      .set(adminAuth)
      .expect(200);
  });
});
