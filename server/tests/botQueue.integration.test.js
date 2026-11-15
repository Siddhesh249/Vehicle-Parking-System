/**
 * Sprint 4 — demo traffic fleet: operator queues, production guard and the
 * admin raw database browser.
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
const {
  startSimulation,
  stopSimulation,
  resetSimulationForTests,
} = require("../services/simulationService");

jest.setTimeout(30000);

const USER_ID = new mongoose.Types.ObjectId().toString();
const tokenFor = (role, gateId) =>
  signToken({
    userId: USER_ID,
    role,
    ...(gateId ? { gateId } : {}),
  });
const auth = (role, gateId) => ({ Authorization: `Bearer ${tokenFor(role, gateId)}` });

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("S4 — demo traffic fleet and database browser", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    resetSimulationForTests();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
      { spotNumber: "4W-002", zone: "4W" },
    ]);
    await User.create({
      username: "admin",
      passwordHash: "not-a-real-hash",
      role: "admin",
      failedLoginAttempts: 0,
      isLocked: false,
    });
  });

  afterEach(() => {
    stopSimulation();
  });

  afterAll(async () => {
    resetSimulationForTests();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("bots wait for the entry operator, who can issue a real ticket", async () => {
    await request(app)
      .post("/api/dev/simulate/start")
      .send({ ratePerMinute: 600 })
      .expect(200);
    await wait(1200);

    const queues = await Promise.all(
      ["Entry-1", "Entry-2"].map((gateId) =>
        request(app)
          .get("/api/dev/simulate/queue/entry")
          .set(auth("operator", gateId))
          .expect(200),
      ),
    );
    const available = queues.find((response) => response.body.bot);
    expect(available).toBeTruthy();

    const gateId = available.body.gateId;
    const bot = available.body.bot;
    expect(bot.plateNumber).toMatch(/^BOT/);

    const ticket = await request(app)
      .post("/api/dev/simulate/queue/entry/admit")
      .set(auth("operator", gateId))
      .send({ botId: bot.botId })
      .expect(201);

    expect(ticket.body.ticketId).toBeTruthy();
    expect(ticket.body.intendedStayHours).toBeGreaterThan(0);

    const transaction = await Transaction.findOne({
      ticketId: ticket.body.ticketId,
      status: "active",
    }).lean();
    expect(transaction).toBeTruthy();
    expect(transaction.plateNumber).toBe(bot.plateNumber);

    const status = await request(app).get("/api/dev/simulate/status").expect(200);
    expect(status.body).toEqual(
      expect.objectContaining({
        successfulAllocations: 1,
        parked: 1,
      }),
    );
  });

  test("live rate changes keep the fleet and reset nothing", async () => {
    await request(app)
      .post("/api/dev/simulate/start")
      .send({ ratePerMinute: 60 })
      .expect(200);
    const response = await request(app)
      .put("/api/dev/simulate/rate")
      .send({ ratePerMinute: 120 })
      .expect(200);
    expect(response.body).toEqual({ status: "running", ratePerMinute: 120 });
  });

  test("effective fare config can be read and cleared for the override editor", async () => {
    const before = await request(app).get("/api/dev/simulate/fare-tiers").expect(200);
    expect(before.body["4W"].tiers.length).toBeGreaterThan(0);

    await request(app)
      .put("/api/dev/simulate/fare-tiers")
      .send({
        vehicleType: "4W",
        tiers: [{ afterHours: 1, ratePerHour: 99 }],
      })
      .expect(200);
    const overridden = await request(app).get("/api/dev/simulate/fare-tiers").expect(200);
    expect(overridden.body["4W"].tiers).toEqual([{ afterHours: 1, rate: 99 }]);

    await request(app).delete("/api/dev/simulate/fare-tiers").expect(200);
    const restored = await request(app).get("/api/dev/simulate/fare-tiers").expect(200);
    expect(restored.body["4W"].tiers).toEqual(before.body["4W"].tiers);
  });

  test("the admin can browse raw collections without password hashes", async () => {
    const response = await request(app)
      .get("/api/admin/database")
      .set(auth("admin"))
      .expect(200);

    expect(response.body.collections.spots).toHaveLength(3);
    expect(response.body.collections.users[0]).toEqual(
      expect.objectContaining({ username: "admin" }),
    );
    expect(response.body.collections.users[0]).not.toHaveProperty("passwordHash");
  });

  test("operators cannot read the raw database", async () => {
    await request(app)
      .get("/api/admin/database")
      .set(auth("operator", "Entry-1"))
      .expect(403);
  });

  test("the bot queue and database routes disappear in production", async () => {
    const previous = process.env.NODE_ENV;
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "production-test-secret";
    const entryAuth = auth("operator", "Entry-1");
    const adminAuth = auth("admin");
    process.env.NODE_ENV = "production";
    try {
      await request(app).get("/api/dev/simulate/queue/entry").set(entryAuth).expect(404);
      await request(app).get("/api/admin/database").set(adminAuth).expect(200);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
});
