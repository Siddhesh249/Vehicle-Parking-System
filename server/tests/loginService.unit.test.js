/**
 * Sprint 1 — T5: Login Logic Unit Tests
 *
 * Tests the core authentication and login business logic in isolation:
 * - Credential validation against User records
 * - Password verification using bcrypt
 * - JWT issuance with role and gate-scoping claims
 * - Failed login attempt tracking
 * - Account lockout threshold after 5 consecutive failures
 * - Lockout cooldown expiry handling
 * - Audit logging of auth actions (LOGIN_SUCCESS, LOGIN_FAIL, ACCOUNT_LOCKED)
 *
 * SRS refs  : VPS-F-001, VPS-F-002, VPS-F-003, VPS-F-004, VPS-F-005,
 *             PRJ-SR-002, PRJ-SR-003, PRJ-SR-004, PRJ-SR-006, SAD 4.3.1
 * Sprint ref: Sprint 1, Track T5 (Sinchana)
 */

"use strict";

const mongoose = require("mongoose");
let MongoMemoryServer;
try {
  MongoMemoryServer = require("mongodb-memory-server").MongoMemoryServer;
} catch {
  MongoMemoryServer = null;
}

// ── Service & Model imports ──────────────────────────────────────────────────
// These modules do not exist yet — tests are written against the contracts
// in the SAD (Section 4.3.1) and SRS. When Sprint 1-T5 implementation lands,
// the imports below will resolve.
let login;
let User, AuditLog;
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
      // Offline fallback: allows test registration
    }
  }

  try {
    const authService = require("../services/loginService");
    login = authService.login || authService;
  } catch {
    try {
      const authService = require("../services/authService");
      login = authService.login || authService;
    } catch {
      // Not implemented yet (TDD phase)
    }
  }

  try {
    User = require("../models/User");
    AuditLog = require("../models/AuditLog");
  } catch {
    // Models not implemented yet (TDD phase)
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
// Gate-Scoped Operator Login (VPS-F-001, PRJ-SR-004, VPS-F-005)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — operator authentication & gate scoping", () => {
  test("authenticates operator with valid credentials and returns token, role, and gateId", async () => {
    const hashed = await hashPassword("ValidPass123!");
    await User.create({
      username: "entry1_operator",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    const result = await login("entry1_operator", "ValidPass123!");

    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
    expect(typeof result.token).toBe("string");
    expect(result.role).toBe("operator");
    expect(result.gateId).toBe("Entry-1");
  });

  test("issued token contains valid payload with userId, role, and gateId claims", async () => {
    const hashed = await hashPassword("OperatorPass123!");
    const userDoc = await User.create({
      username: "exit2_operator",
      passwordHash: hashed,
      role: "operator",
      gateId: "Exit-2",
    });

    const result = await login("exit2_operator", "OperatorPass123!");
    const decoded = verifyToken(result.token);

    expect(decoded.userId).toBe(userDoc._id.toString());
    expect(decoded.role).toBe("operator");
    expect(decoded.gateId).toBe("Exit-2");
  });

  test("gateId strictly corresponds to the operator's assigned physical gate", async () => {
    const gates = ["Entry-1", "Entry-2", "Exit-1", "Exit-2"];
    for (const gate of gates) {
      const hashed = await hashPassword("Pass123!");
      await User.create({
        username: `op_${gate}`,
        passwordHash: hashed,
        role: "operator",
        gateId: gate,
      });

      const result = await login(`op_${gate}`, "Pass123!");
      expect(result.gateId).toBe(gate);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Root Login (VPS-F-002, VPS-F-005)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — admin authentication", () => {
  test("authenticates admin with valid root credentials and returns role: 'admin'", async () => {
    const hashed = await hashPassword("AdminRootPass123!");
    await User.create({
      username: "admin_root",
      passwordHash: hashed,
      role: "admin",
    });

    const result = await login("admin_root", "AdminRootPass123!");

    expect(result).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.role).toBe("admin");
    // Admin has root access, not bound to any physical gate
    expect(result.gateId).toBeUndefined();
  });

  test("admin token does not contain a gateId claim", async () => {
    const hashed = await hashPassword("AdminRootPass123!");
    await User.create({
      username: "admin",
      passwordHash: hashed,
      role: "admin",
    });

    const result = await login("admin", "AdminRootPass123!");
    const decoded = verifyToken(result.token);

    expect(decoded.role).toBe("admin");
    expect(decoded.gateId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Credential Validation & Password Hashing (PRJ-SR-003, VPS-F-004)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — credential validation & password security", () => {
  test("rejects login when password does not match stored hash", async () => {
    const hashed = await hashPassword("RealPassword123!");
    await User.create({
      username: "test_op",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    await expect(login("test_op", "WrongPassword")).rejects.toThrow(
      /invalid credentials/i
    );
  });

  test("rejects login when username does not exist", async () => {
    await expect(login("nonexistent_user", "AnyPassword")).rejects.toThrow(
      /invalid credentials/i
    );
  });

  test("never returns plaintext password or passwordHash in the login response", async () => {
    const plainPass = "SuperSecretPass123!";
    const hashed = await hashPassword(plainPass);
    await User.create({
      username: "safe_op",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    const result = await login("safe_op", plainPass);

    expect(result.password).toBeUndefined();
    expect(result.passwordHash).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(plainPass);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failed Attempt Tracking & Lockout Threshold (VPS-F-003)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — failed attempt counter & 5-attempt lockout threshold", () => {
  test("increments failedLoginAttempts by 1 on each incorrect password attempt", async () => {
    const hashed = await hashPassword("SecretPass!");
    await User.create({
      username: "counter_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
      failedLoginAttempts: 0,
    });

    await expect(login("counter_user", "Bad1")).rejects.toThrow();
    let user = await User.findOne({ username: "counter_user" });
    expect(user.failedLoginAttempts).toBe(1);

    await expect(login("counter_user", "Bad2")).rejects.toThrow();
    user = await User.findOne({ username: "counter_user" });
    expect(user.failedLoginAttempts).toBe(2);
  });

  test("does not lock account when failedLoginAttempts is below 5", async () => {
    const hashed = await hashPassword("SecretPass!");
    await User.create({
      username: "subthreshold_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
      failedLoginAttempts: 3,
    });

    await expect(login("subthreshold_user", "BadPass")).rejects.toThrow();
    const user = await User.findOne({ username: "subthreshold_user" });
    expect(user.failedLoginAttempts).toBe(4);
    expect(user.isLocked).toBe(false);
  });

  test("locks account on the 5th consecutive failed attempt (isLocked: true, lockUntil set)", async () => {
    const hashed = await hashPassword("SecretPass!");
    await User.create({
      username: "lockout_target",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
      failedLoginAttempts: 4,
      isLocked: false,
    });

    await expect(login("lockout_target", "BadPass5")).rejects.toThrow(
      /account locked/i
    );

    const user = await User.findOne({ username: "lockout_target" });
    expect(user.failedLoginAttempts).toBe(5);
    expect(user.isLocked).toBe(true);
    expect(user.lockUntil).toBeDefined();
    expect(user.lockUntil.getTime()).toBeGreaterThan(Date.now());
  });

  test("rejects login immediately when account is locked even with correct password", async () => {
    const hashed = await hashPassword("CorrectPassword123!");
    const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // locked for 15 mins
    await User.create({
      username: "already_locked",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-2",
      failedLoginAttempts: 5,
      isLocked: true,
      lockUntil: lockUntil,
    });

    await expect(login("already_locked", "CorrectPassword123!")).rejects.toThrow(
      /account locked/i
    );
  });

  test("resets failedLoginAttempts to 0 upon a successful login", async () => {
    const hashed = await hashPassword("MyPass123!");
    await User.create({
      username: "recover_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Exit-1",
      failedLoginAttempts: 3,
      isLocked: false,
    });

    const result = await login("recover_user", "MyPass123!");
    expect(result.token).toBeDefined();

    const user = await User.findOne({ username: "recover_user" });
    expect(user.failedLoginAttempts).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lockout Cooldown Expiry (VPS-F-003)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — lockout cooldown expiry", () => {
  test("allows login if lockUntil cooldown period has expired", async () => {
    const hashed = await hashPassword("ExpiredLockPass123!");
    const pastTime = new Date(Date.now() - 60 * 1000); // 1 minute in the past
    await User.create({
      username: "expired_lock_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
      failedLoginAttempts: 5,
      isLocked: true,
      lockUntil: pastTime,
    });

    const result = await login("expired_lock_user", "ExpiredLockPass123!");
    expect(result).toBeDefined();
    expect(result.token).toBeDefined();

    const user = await User.findOne({ username: "expired_lock_user" });
    expect(user.isLocked).toBe(false);
    expect(user.failedLoginAttempts).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log Recording (VPS-F-003, PRJ-SR-006)
// ─────────────────────────────────────────────────────────────────────────────
describe("login — audit logging", () => {
  test("records LOGIN_SUCCESS audit entry on successful authentication", async () => {
    const hashed = await hashPassword("AuditPass123!");
    const userDoc = await User.create({
      username: "audit_success_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-1",
    });

    await login("audit_success_user", "AuditPass123!");

    const log = await AuditLog.findOne({
      actorId: userDoc._id,
      action: "LOGIN_SUCCESS",
    });
    expect(log).toBeDefined();
    expect(log.actorRole).toBe("operator");
  });

  test("records LOGIN_FAIL audit entry on invalid password", async () => {
    const hashed = await hashPassword("CorrectPass!");
    const userDoc = await User.create({
      username: "audit_fail_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Exit-1",
    });

    try {
      await login("audit_fail_user", "WrongPass");
    } catch {
      // Expected auth error
    }

    const log = await AuditLog.findOne({
      actorId: userDoc._id,
      action: "LOGIN_FAIL",
    });
    expect(log).toBeDefined();
    expect(log.actorRole).toBe("operator");
  });

  test("records ACCOUNT_LOCKED audit entry on 5th consecutive failure", async () => {
    const hashed = await hashPassword("SecretPass!");
    const userDoc = await User.create({
      username: "audit_lock_user",
      passwordHash: hashed,
      role: "operator",
      gateId: "Entry-2",
      failedLoginAttempts: 4,
    });

    try {
      await login("audit_lock_user", "BadPass5");
    } catch {
      // Expected lockout error
    }

    const log = await AuditLog.findOne({
      actorId: userDoc._id,
      action: "ACCOUNT_LOCKED",
    });
    expect(log).toBeDefined();
    expect(log.actorRole).toBe("operator");
  });
});
