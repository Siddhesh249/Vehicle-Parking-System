/**
 * Sprint 4 — S4-T2: Simulation Console HTTP contract (SAD 4.3.7, VPS-DEV-001/002).
 *
 * The developer-only simulation endpoints control the synthetic arrival
 * generator. They are not part of an operator or admin login flow.
 */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { app } = require("../../app");
const Spot = require("../../models/Spot");

jest.setTimeout(30000);

describe("S4-T2 — simulation routes", () => {
  let mongo;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
      { spotNumber: "4W-002", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    await request(app).post("/api/dev/simulate/stop");
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("starts the generator at the requested arrivals-per-minute rate", async () => {
    const response = await request(app)
      .post("/api/dev/simulate/start")
      .send({ ratePerMinute: 60 })
      .expect(200);

    expect(response.body).toEqual({ status: "running" });
  });

  test("stopping the generator reports that it is no longer running", async () => {
    const response = await request(app).post("/api/dev/simulate/stop").send().expect(200);

    expect(response.body).toEqual({ status: "stopped" });
  });

  test("rejects an invalid traffic rate instead of starting the generator", async () => {
    await request(app)
      .post("/api/dev/simulate/start")
      .send({ ratePerMinute: -5 })
      .expect(400);

    await request(app)
      .post("/api/dev/simulate/start")
      .send({ ratePerMinute: "ten" })
      .expect(400);
  });
});
