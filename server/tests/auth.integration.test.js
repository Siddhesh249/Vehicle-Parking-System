/**
 * Sprint 1 — T5: Authentication API Integration Tests (POST /api/auth/login)
 *
 * Exercises the HTTP authentication endpoint end-to-end using Supertest against
 * the Express application and MongoDB database:
 * - Successful operator and admin logins (200 OK)
 * - Gate-scoping claim emission in response
 * - Invalid credentials rejection (401 Unauthorized)
 * - Request validation failures (400 Bad Request)
 * - Account lockout trigger after 5 consecutive failed attempts (423 Locked)
 * - Persistence of lockout state in MongoDB
 * - Security requirements: credentials never leaked in responses
 *
 * SRS refs  : SAD 4.3.1, VPS-F-001, VPS-F-002, VPS-F-003, VPS-F-004, VPS-F-005,
 *             PRJ-SR-002, PRJ-SR-003, PRJ-SR-004
 * Sprint ref: Sprint 1, Track T5 (Sinchana)
 */

"use strict";

const request = require("supertest");
const mongoose = require("mongoose");
const { app } = require("../app");

let MongoMemoryServer;
try {
  MongoMemoryServer = require("mongodb-memory-server").MongoMemoryServer;
} catch {
  MongoMemoryServer = null;
}

// ── Models & Utils ───────────────────────────────────────────────────────────
let User;
let hashPassword;
let verifyToken;

let mongod;

beforeAll(async () => {
  if (MongoMemoryServer) {
    try {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    } catch {
      mongod = null;
    }
  }

  if (mongoose.connection.readyState !== 1) {
    const user = encodeURIComponent(process.env.MONGO_USER || "vps_app");
    const password = encodeURIComponent(process.env.MONGO_PASSWORD || "VPS");
    const host = process.env.MONGO_HOST || "127.0.0.1";
    const port = process.env.MONGO_PORT || "27017";
    const db = (process.env.MONGO_DB || "vehicle_parking") + "_test";
    const authDb = encodeURIComponent(
      process.env.MONGO_AUTH_DB || "vehicle_parking"
    );
    const uri =
      process.env.MONGO_URI ||
      `mongodb://${user}:${password}@${host}:${port}/${db}?authSource=${authDb}`;
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 1000,
        connectTimeoutMS: 1000,
      });
    } catch {
      // Offline fallback
    }
  }

  try {
    User = require("../models/User");
  } catch {
    // Model not implemented yet (TDD phase)
  }

  try {
    const pwdUtils = require("../utils/passwordUtils");
    hashPassword = pwdUtils.hashPassword;
  } catch {
    hashPassword = async (p) => `$2b$10$mockhashfor_${p}`;
  }

  try {
    const jwtUtils = require("../utils/jwtUtils");
    verifyToken = jwtUtils.verifyToken;
  } catch {
    verifyToken = () => ({});
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
  }
});

afterEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const cols = mongoose.connection.collections;
    await Promise.all(Object.values(cols).map((c) => c.deleteMany({})));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — Successful Authentication (200 OK)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login — successful authentication", () => {
  test("authenticates operator and returns 200 with token, role, and gateId (SAD 4.3.1)", async () => {
    const hashed = await hashPassword("OpPassword123!");
    await User.create({
      username: "entry1_op",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "entry1_op",
        password: "OpPassword123!",
      })
      .expect(200);

    expect(response.body.token).toBeDefined();
    expect(typeof response.body.token).toBe("string");
    expect(response.body.role).toBe("operator");
    expect(response.body.gateId).toBe("Entry-1");
  });

  test("authenticates admin and returns 200 with token, role: 'admin', and no gateId", async () => {
    const hashed = await hashPassword("AdminPass123!");
    await User.create({
      username: "admin_user",
      passwordHash: hashed,
      role: "admin",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "admin_user",
        password: "AdminPass123!",
      })
      .expect(200);

    expect(response.body.token).toBeDefined();
    expect(response.body.role).toBe("admin");
    expect(response.body.gateId).toBeUndefined();
  });

  test("issued token in HTTP response can be verified and matches user claims", async () => {
    const hashed = await hashPassword("VerifyPass123!");
    const userDoc = await User.create({
      username: "exit1_op",
      passwordHash: hashed,
      role: "operator",
      gateId: "Exit-1",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "exit1_op",
        password: "VerifyPass123!",
      })
      .expect(200);

    const decoded = verifyToken(response.body.token);
    expect(decoded.userId).toBe(userDoc._id.toString());
    expect(decoded.role).toBe("operator");
    expect(decoded.gateId).toBe("Exit-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — Invalid Credentials (401 Unauthorized)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login — invalid credentials", () => {
  test("returns 401 when password does not match (SAD 4.3.1)", async () => {
    const hashed = await hashPassword("CorrectPass123!");
    await User.create({
      username: "user_wrong_pass",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-2",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "user_wrong_pass",
        password: "IncorrectPassword",
      })
      .expect(401);

    expect(response.body.token).toBeUndefined();
    expect(response.body.error || response.body.message).toMatch(
      /invalid credentials/i
    );
  });

  test("returns 401 when username does not exist in the database", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "unknown_user_999",
        password: "SomePassword123!",
      })
      .expect(401);

    expect(response.body.token).toBeUndefined();
    expect(response.body.error || response.body.message).toMatch(
      /invalid credentials/i
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — Request Validation (400 Bad Request)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login — request body validation", () => {
  test("returns 400 when username field is missing", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ password: "PasswordOnly" })
      .expect(400);
  });

  test("returns 400 when password field is missing", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({ username: "UsernameOnly" })
      .expect(400);
  });

  test("returns 400 when body is empty", async () => {
    await request(app)
      .post("/api/auth/login")
      .send({})
      .expect(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login — Account Lockout (423 Locked) (VPS-F-003)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login — account lockout threshold (423 Locked)", () => {
  test("5th consecutive failed login triggers 423 Locked (SAD 4.3.1, VPS-F-003)", async () => {
    const hashed = await hashPassword("TargetPass123!");
    await User.create({
      username: "lockout_http_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
      failedLoginAttempts: 0,
    });

    // Attempts 1 to 4 should return 401
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({
          username: "lockout_http_user",
          password: `WrongPass${i}`,
        })
        .expect(401);
    }

    // 5th attempt must return 423 Locked
    const fifthResponse = await request(app)
      .post("/api/auth/login")
      .send({
        username: "lockout_http_user",
        password: "WrongPass5",
      })
      .expect(423);

    expect(fifthResponse.body.error || fifthResponse.body.message).toMatch(
      /account locked/i
    );

    // Verify DB state
    const userInDb = await User.findOne({ username: "lockout_http_user" });
    expect(userInDb.isLocked).toBe(true);
    expect(userInDb.failedLoginAttempts).toBe(5);
    expect(userInDb.lockUntil).toBeDefined();
  });

  test("returns 423 when attempting to log in to an already locked account even with correct password", async () => {
    const hashed = await hashPassword("CorrectPass123!");
    const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // locked for 30 minutes
    await User.create({
      username: "prelocked_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Exit-2",
      failedLoginAttempts: 5,
      isLocked: true,
      lockUntil: lockUntil,
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "prelocked_user",
        password: "CorrectPass123!",
      })
      .expect(423);

    expect(response.body.error || response.body.message).toMatch(
      /account locked/i
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security Controls (PRJ-SR-003, VPS-F-004)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login — security controls", () => {
  test("response body never exposes password or passwordHash", async () => {
    const hashed = await hashPassword("SecurePass123!");
    await User.create({
      username: "secure_op",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    const response = await request(app)
      .post("/api/auth/login")
      .send({
        username: "secure_op",
        password: "SecurePass123!",
      })
      .expect(200);

    expect(response.body.password).toBeUndefined();
    expect(response.body.passwordHash).toBeUndefined();
    expect(response.text).not.toContain("SecurePass123!");
    expect(response.text).not.toContain(hashed);
  });
});
