/** Sprint 3 — T1/T2: HTTP controller acceptance contracts (SAD 4.3.2–4.3.6). */
"use strict";

const request = require("supertest");
const { app } = require("../app");
const { signToken } = require("../utils/jwtUtils");

const operatorToken = (gateId) =>
  signToken({ userId: `operator-${gateId}`, role: "operator", gateId });
const adminToken = () => signToken({ userId: "admin-1", role: "admin" });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("S3-T1 — entry and exit HTTP controllers", () => {
  test("creates an entry and returns a ticket, assigned spot, zone, and QR payload", async () => {
    const response = await request(app)
      .post("/api/entry/vehicles")
      .set(auth(operatorToken("Entry-1")))
      .send({ plateNumber: "KA01AB1234", vehicleType: "4W", gateId: "Entry-1" })
      .expect(201);

    expect(response.body).toEqual(
      expect.objectContaining({
        ticketId: expect.any(String),
        spotId: expect.any(String),
        zone: "4W",
        qrPayload: expect.any(String),
      }),
    );
  });

  test("rejects an entry request from a token scoped to the other entry gate", async () => {
    await request(app)
      .post("/api/entry/vehicles")
      .set(auth(operatorToken("Entry-2")))
      .send({ plateNumber: "KA01AB1234", vehicleType: "4W", gateId: "Entry-1" })
      .expect(403);
  });

  test("rejects unauthenticated entry requests", async () => {
    await request(app)
      .post("/api/entry/vehicles")
      .send({ plateNumber: "KA01AB1234", vehicleType: "4W", gateId: "Entry-1" })
      .expect(401);
  });

  test("returns 409 when the requested vehicle zone is full", async () => {
    const response = await request(app)
      .post("/api/entry/vehicles")
      .set(auth(operatorToken("Entry-1")))
      .send({ plateNumber: "KA01AB9999", vehicleType: "2W", gateId: "Entry-1" })
      .expect(409);

    expect(response.body.error).toEqual(
      expect.objectContaining({ code: expect.any(String), message: expect.any(String) }),
    );
  });

  test("looks up an active vehicle by ticket ID", async () => {
    const response = await request(app)
      .get("/api/exit/lookup/TKT-S3-001")
      .set(auth(operatorToken("Exit-1")))
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ ticketId: "TKT-S3-001", plateNumber: expect.any(String) }),
    );
  });

  test("returns 404 when the ticket does not identify an active vehicle", async () => {
    await request(app)
      .get("/api/exit/lookup/DOES-NOT-EXIST")
      .set(auth(operatorToken("Exit-1")))
      .expect(404);
  });

  test("searches active vehicles by plate number", async () => {
    const response = await request(app)
      .get("/api/exit/search")
      .query({ plateNumber: "KA01AB1234" })
      .set(auth(operatorToken("Exit-2")))
      .expect(200);

    expect(response.body.records ?? response.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ plateNumber: "KA01AB1234" })]),
    );
  });

  test("settles a ticket exit and returns fare, exact duration, breakdown, and receipt", async () => {
    const response = await request(app)
      .post("/api/exit/process")
      .set(auth(operatorToken("Exit-1")))
      .send({ ticketId: "TKT-S3-001", gateId: "Exit-1" })
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        fare: expect.any(Number),
        durationSeconds: expect.any(Number),
        penaltyApplied: false,
        breakdown: expect.any(Object),
        receiptId: expect.any(String),
      }),
    );
  });

  test("settles a lost-ticket exit by plate and indicates the penalty", async () => {
    const response = await request(app)
      .post("/api/exit/process")
      .set(auth(operatorToken("Exit-2")))
      .send({ plateNumber: "KA02CD5678", gateId: "Exit-2" })
      .expect(200);

    expect(response.body.penaltyApplied).toBe(true);
    expect(response.body.breakdown).toEqual(expect.objectContaining({ lostTicketPenalty: expect.any(Number) }));
  });

  test("rejects a repeated exit with 409 and does not settle the vehicle twice", async () => {
    const body = { ticketId: "TKT-S3-EXITED", gateId: "Exit-1" };
    await request(app).post("/api/exit/process").set(auth(operatorToken("Exit-1"))).send(body).expect(200);
    await request(app).post("/api/exit/process").set(auth(operatorToken("Exit-1"))).send(body).expect(409);
  });
});

describe("S3-T2 — admin and overstay HTTP controllers", () => {
  test("rejects operator tokens on all admin-only read and write routes", async () => {
    const headers = auth(operatorToken("Exit-1"));
    const responses = await Promise.all([
      request(app).get("/api/admin/analytics/occupancy").set(headers),
      request(app).get("/api/admin/analytics/revenue").set(headers),
      request(app).get("/api/admin/transactions").set(headers),
      request(app).get("/api/admin/audit-log").set(headers),
      request(app).put("/api/admin/config/fare-tiers").set(headers).send({}),
      request(app).put("/api/admin/config/spots").set(headers).send({}),
      request(app).post("/api/admin/vehicles/vehicle-1/force-release").set(headers),
    ]);

    expect(responses.map(({ status }) => status)).toEqual(Array(7).fill(403));
  });

  test.each([
    ["occupancy", () => request(app).get("/api/admin/analytics/occupancy")],
    ["revenue", () => request(app).get("/api/admin/analytics/revenue")],
    ["transactions", () => request(app).get("/api/admin/transactions")],
    ["audit log", () => request(app).get("/api/admin/audit-log")],
  ])("admin can read %s", async (_name, makeRequest) => {
    const response = await makeRequest().set(auth(adminToken())).expect(200);
    expect(response.body).toBeDefined();
  });

  test("accepts a valid fare-tier configuration and rejects malformed tiers", async () => {
    await request(app)
      .put("/api/admin/config/fare-tiers")
      .set(auth(adminToken()))
      .send({ vehicleType: "4W", tiers: [{ afterHours: 1, rate: 20 }, { afterHours: 3, rate: 30 }] })
      .expect(200);

    await request(app)
      .put("/api/admin/config/fare-tiers")
      .set(auth(adminToken()))
      .send({ vehicleType: "4W", tiers: [{ afterHours: -1, rate: "free" }] })
      .expect(400);
  });

  test("updates spot counts for a valid zone and rejects invalid counts", async () => {
    await request(app)
      .put("/api/admin/config/spots")
      .set(auth(adminToken()))
      .send({ zone: "2W", count: 12 })
      .expect(200);

    await request(app)
      .put("/api/admin/config/spots")
      .set(auth(adminToken()))
      .send({ zone: "unknown", count: -1 })
      .expect(400);
  });

  test("accepts a gate operator overstay notification and returns its notification ID", async () => {
    const response = await request(app)
      .post("/api/overstay/notify")
      .set(auth(operatorToken("Exit-1")))
      .send({ vehicleId: "vehicle-overstay-1", gateId: "Exit-1" })
      .expect(200);

    expect(response.body.notificationId).toEqual(expect.any(String));
  });

  test("rejects an overstay notification for a different gate", async () => {
    await request(app)
      .post("/api/overstay/notify")
      .set(auth(operatorToken("Exit-2")))
      .send({ vehicleId: "vehicle-overstay-1", gateId: "Exit-1" })
      .expect(403);
  });

  test("admin force-release frees a vehicle spot and reports the overstay penalty", async () => {
    const response = await request(app)
      .post("/api/admin/vehicles/vehicle-overstay-1/force-release")
      .set(auth(adminToken()))
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({ spotId: expect.any(String), penaltyApplied: true }),
    );
  });

  test("returns 404 when notifying or force-releasing an unknown vehicle", async () => {
    await request(app)
      .post("/api/overstay/notify")
      .set(auth(operatorToken("Exit-1")))
      .send({ vehicleId: "missing", gateId: "Exit-1" })
      .expect(404);

    await request(app)
      .post("/api/admin/vehicles/missing/force-release")
      .set(auth(adminToken()))
      .expect(404);
  });
});
