/**
 * Sprint 4 — S4-T4: five-session demo/regression acceptance (VPS-F-021, VPS-NF-001).
 *
 * Represents the manual five-tab demonstration as one automated system test:
 * both entry consoles, both exit consoles, and the admin dashboard must stay
 * synchronized through a complete entry-to-exit cycle.
 */
"use strict";

const mongoose = require("mongoose");
const request = require("supertest");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { io: createClient } = require("socket.io-client");
const { app, server } = require("../../app");
const Spot = require("../../models/Spot");
const { signToken } = require("../../utils/jwtUtils");

jest.setTimeout(60000);

const USERS = {
  "Entry-1": { userId: new mongoose.Types.ObjectId().toString(), role: "operator" },
  "Entry-2": { userId: new mongoose.Types.ObjectId().toString(), role: "operator" },
  "Exit-1": { userId: new mongoose.Types.ObjectId().toString(), role: "operator" },
  "Exit-2": { userId: new mongoose.Types.ObjectId().toString(), role: "operator" },
  Admin: { userId: new mongoose.Types.ObjectId().toString(), role: "admin" },
};

const tokenFor = (name) => {
  const user = USERS[name];
  return signToken(
    user.role === "admin"
      ? { userId: user.userId, role: "admin" }
      : { userId: user.userId, role: "operator", gateId: name },
  );
};
const auth = (name) => ({ Authorization: `Bearer ${tokenFor(name)}` });

function waitForConnection(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function waitFor(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function connectAndIdentify(url, name) {
  const socket = createClient(url, { forceNew: true, transports: ["websocket"] });
  await waitForConnection(socket);
  const snapshot = waitFor(socket, "lot:snapshot");
  const acknowledgement = await new Promise((resolve) =>
    socket.emit("identify", { token: tokenFor(name) }, resolve),
  );
  return { socket, acknowledgement, snapshot: await snapshot };
}

describe("S4-T4 — five simultaneous sessions stay synchronized", () => {
  let mongo;
  let baseUrl;
  let sessions;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    sessions = await Promise.all(
      ["Entry-1", "Entry-2", "Exit-1", "Exit-2", "Admin"].map((name) =>
        connectAndIdentify(baseUrl, name),
      ),
    );
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    await Spot.create([
      { spotNumber: "2W-001", zone: "2W" },
      { spotNumber: "4W-001", zone: "4W" },
    ]);
  });

  afterAll(async () => {
    for (const { socket } of sessions || []) socket.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  test("all five sessions see the same entry and exit spot updates within 2 seconds", async () => {
    for (const { acknowledgement } of sessions) {
      expect(acknowledgement).toEqual(expect.objectContaining({ ok: true }));
    }

    const reservedUpdates = sessions.map(({ socket }) => waitFor(socket, "spot:update"));
    const entry = await request(app)
      .post("/api/entry/vehicles")
      .set(auth("Entry-1"))
      .send({ plateNumber: "KA77DEMO1", vehicleType: "4W" })
      .expect(201);
    const reserved = await Promise.all(reservedUpdates);

    for (const update of reserved) {
      expect(update).toEqual({ spotId: entry.body.spotId, status: "reserved" });
    }

    const freedUpdates = sessions.map(({ socket }) => waitFor(socket, "spot:update"));
    const exit = await request(app)
      .post("/api/exit/process")
      .set(auth("Exit-1"))
      .send({ ticketId: entry.body.ticketId })
      .expect(200);
    const freed = await Promise.all(freedUpdates);

    for (const update of freed) {
      expect(update).toEqual({ spotId: exit.body.spotId, status: "free" });
    }
  });
});
