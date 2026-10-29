/** Sprint 3 — T3: Socket.io authentication, snapshots, and mutation broadcasts. */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: createClient } = require("socket.io-client");
const { app, server } = require("../app");
const Spot = require("../models/Spot");
const { signToken } = require("../utils/jwtUtils");

jest.setTimeout(60000);

const ENTRY_OPERATOR_ID = new mongoose.Types.ObjectId().toString();
const EXIT_OPERATOR_ID = new mongoose.Types.ObjectId().toString();
const ADMIN_ID = new mongoose.Types.ObjectId().toString();
const auth = (token) => ({ Authorization: `Bearer ${token}` });

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      3000,
    );
    socket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function waitForConnection(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

async function connectAndIdentify(url, token) {
  const socket = createClient(url, { forceNew: true, transports: ["websocket"] });
  await waitForConnection(socket);
  const snapshot = waitFor(socket, "lot:snapshot");
  const acknowledgement = await new Promise((resolve) =>
    socket.emit("identify", { token }, resolve),
  );
  return { socket, acknowledgement, snapshot: await snapshot };
}

describe("S3-T3 — Socket.io server event contracts (SAD 4.3.8)", () => {
  let mongo;
  let baseUrl;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("identifies a valid client, assigns its role room, and sends a full lot snapshot", async () => {
    const { socket, acknowledgement, snapshot } = await connectAndIdentify(
      baseUrl,
      signToken({ userId: ENTRY_OPERATOR_ID, role: "operator", gateId: "Entry-1" }),
    );
    try {
      expect(acknowledgement).toEqual({ ok: true, role: "operator", gateId: "Entry-1" });
      expect(snapshot).toEqual(
        expect.objectContaining({
          spots: expect.arrayContaining([
            expect.objectContaining({ spotNumber: "2W-001", zone: "2W", status: "free" }),
            expect.objectContaining({ spotNumber: "4W-001", zone: "4W", status: "free" }),
          ]),
          occupancy: expect.objectContaining({ occupied: 0, totalSpots: 2 }),
        }),
      );
    } finally {
      socket.close();
    }
  });

  test("rejects a missing socket token without sending a snapshot", async () => {
    const socket = createClient(baseUrl, { forceNew: true, transports: ["websocket"] });
    await waitForConnection(socket);
    const identifyError = waitFor(socket, "identify:error");
    const acknowledgement = await new Promise((resolve) =>
      socket.emit("identify", {}, resolve),
    );
    try {
      expect(acknowledgement).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "UNAUTHORIZED" }),
        }),
      );
      await expect(identifyError).resolves.toEqual(
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
    } finally {
      socket.close();
    }
  });

  test("broadcasts matching reserved and free spot updates for entry and exit mutations", async () => {
    const { socket } = await connectAndIdentify(
      baseUrl,
      signToken({ userId: ADMIN_ID, role: "admin" }),
    );
    try {
      const reserved = waitFor(socket, "spot:update");
      const refreshedLot = waitFor(socket, "lot:snapshot");
      const entry = await request(app)
        .post("/api/entry/vehicles")
        .set(
          auth(
            signToken({ userId: ENTRY_OPERATOR_ID, role: "operator", gateId: "Entry-1" }),
          ),
        )
        .send({ plateNumber: "KA01AB1234", vehicleType: "4W" })
        .expect(201);
      await expect(reserved).resolves.toEqual({
        spotId: entry.body.spotId,
        status: "reserved",
      });
      await expect(refreshedLot).resolves.toEqual(
        expect.objectContaining({
          spots: expect.arrayContaining([
            expect.objectContaining({ id: entry.body.spotId, status: "reserved" }),
          ]),
          occupancy: expect.objectContaining({ occupied: 1, totalSpots: 2 }),
        }),
      );

      const freed = waitFor(socket, "spot:update");
      const receipt = await request(app)
        .post("/api/exit/process")
        .set(
          auth(
            signToken({ userId: EXIT_OPERATOR_ID, role: "operator", gateId: "Exit-1" }),
          ),
        )
        .send({ ticketId: entry.body.ticketId })
        .expect(200);
      await expect(freed).resolves.toEqual({
        spotId: receipt.body.spotId,
        status: "free",
      });
    } finally {
      socket.close();
    }
  });

  test("sends overstay alerts only to admins and broadcasts force-release as a free spot", async () => {
    const admin = await connectAndIdentify(
      baseUrl,
      signToken({ userId: ADMIN_ID, role: "admin" }),
    );
    const operator = await connectAndIdentify(
      baseUrl,
      signToken({ userId: EXIT_OPERATOR_ID, role: "operator", gateId: "Exit-1" }),
    );
    let operatorReceivedAlert = false;
    operator.socket.on("overstay:alert", () => {
      operatorReceivedAlert = true;
    });
    try {
      const entry = await request(app)
        .post("/api/entry/vehicles")
        .set(
          auth(
            signToken({ userId: ENTRY_OPERATOR_ID, role: "operator", gateId: "Entry-1" }),
          ),
        )
        .send({ plateNumber: "KA02CD5678", vehicleType: "4W" })
        .expect(201);

      const alert = waitFor(admin.socket, "overstay:alert");
      const notice = await request(app)
        .post("/api/overstay/notify")
        .set(
          auth(
            signToken({ userId: EXIT_OPERATOR_ID, role: "operator", gateId: "Exit-1" }),
          ),
        )
        .send({ vehicleId: entry.body.ticketId, gateId: "Exit-1" })
        .expect(200);
      await expect(alert).resolves.toEqual({
        vehicleId: notice.body.vehicleId,
        ticketId: entry.body.ticketId,
        plateNumber: "KA02CD5678",
        gateId: "Exit-1",
        duration: expect.any(Number),
      });

      const freed = waitFor(admin.socket, "spot:update");
      await request(app)
        .post(`/api/admin/vehicles/${entry.body.ticketId}/force-release`)
        .set(auth(signToken({ userId: ADMIN_ID, role: "admin" })))
        .expect(200);
      await expect(freed).resolves.toEqual({ spotId: entry.body.spotId, status: "free" });
      expect(operatorReceivedAlert).toBe(false);
    } finally {
      admin.socket.close();
      operator.socket.close();
    }
  });
});
