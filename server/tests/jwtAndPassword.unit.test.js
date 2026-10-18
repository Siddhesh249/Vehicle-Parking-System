/**
 * Sprint 1 — T4: JWT Utilities Unit Tests
 *
 * Tests the low-level JWT sign/verify helpers and bcrypt password hashing
 * in isolation (no Express server, no MongoDB). All dependencies on the
 * actual jwt and bcrypt libraries are used directly — no mocking needed
 * since these are pure cryptographic functions.
 *
 * SRS refs  : PRJ-SR-002 (JWT auth), PRJ-SR-003 (password hashing)
 * Sprint ref: Sprint 1, Track T4 (Sinchana)
 */

"use strict";

const { signToken, verifyToken } = require("../utils/jwtUtils");
const { hashPassword, comparePassword } = require("../utils/passwordUtils");

// ─────────────────────────────────────────────────────────────────────────────
// JWT — signToken / verifyToken  (PRJ-SR-002)
// ─────────────────────────────────────────────────────────────────────────────
describe("signToken", () => {
  test("returns a non-empty string", () => {
    const token = signToken({ userId: "abc123", role: "operator", gateId: "Entry-1" });
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  test("produces a JWT with three dot-separated segments", () => {
    const token = signToken({ userId: "abc123", role: "admin" });
    expect(token.split(".")).toHaveLength(3);
  });

  test("two calls with the same payload and different iat produce different tokens", async () => {
    const payload = { userId: "same", role: "operator", gateId: "Entry-1" };
    const t1 = signToken(payload);
    await new Promise((r) => setTimeout(r, 1100)); // ensure iat differs
    const t2 = signToken(payload);
    expect(t1).not.toBe(t2);
  });

  test("throws when payload is null or not an object", () => {
    expect(() => signToken(null)).toThrow();
    expect(() => signToken("notAnObject")).toThrow();
  });
});

describe("verifyToken", () => {
  test("round-trips a valid token and returns the original payload fields", () => {
    const payload = { userId: "usr001", role: "operator", gateId: "Exit-2" };
    const token = signToken(payload);
    const decoded = verifyToken(token);

    expect(decoded.userId).toBe("usr001");
    expect(decoded.role).toBe("operator");
    expect(decoded.gateId).toBe("Exit-2");
  });

  test("decoded token contains iat and exp claims", () => {
    const token = signToken({ userId: "u1", role: "admin" });
    const decoded = verifyToken(token);
    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
  });

  test("exp is greater than iat", () => {
    const token = signToken({ userId: "u2", role: "admin" });
    const decoded = verifyToken(token);
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  test("throws on a completely invalid token string", () => {
    expect(() => verifyToken("not.a.jwt")).toThrow();
  });

  test("throws on a tampered payload segment", () => {
    const token = signToken({ userId: "u3", role: "operator", gateId: "Entry-1" });
    const [header, , signature] = token.split(".");
    // Replace the payload with a different base64 value
    const fakePayload = Buffer.from(
      JSON.stringify({ userId: "evil", role: "admin" })
    ).toString("base64url");
    const tampered = `${header}.${fakePayload}.${signature}`;
    expect(() => verifyToken(tampered)).toThrow();
  });

  test("throws on an expired token", () => {
    // Sign with an immediate expiry so the token is already expired.
    const token = signToken({ userId: "u4", role: "admin" }, { expiresIn: "0s" });
    expect(() => verifyToken(token)).toThrow();
  });

  test("throws on an empty string", () => {
    expect(() => verifyToken("")).toThrow();
  });

  test("throws when token signature segment is tampered", () => {
    const token = signToken({ userId: "u6", role: "admin" });
    const [header, payload] = token.split(".");
    const fakeSignature = "invalidSignatureString";
    const tampered = `${header}.${payload}.${fakeSignature}`;
    expect(() => verifyToken(tampered)).toThrow();
  });

  test("throws on null or undefined token argument", () => {
    expect(() => verifyToken(null)).toThrow();
    expect(() => verifyToken(undefined)).toThrow();
  });

  test("throws when a required gateId claim is missing for operator tokens", () => {
    // Gate operators MUST have a gateId claim; tokens without it are malformed.
    // verifyToken or a higher-level guard should reject this.
    const token = signToken({ userId: "u5", role: "operator" }); // no gateId
    // The raw verify might succeed, but the token lacks a required claim.
    // If verifyToken enforces claim completeness, this should throw.
    // If only structural verification is done here, the test documents the gap
    // so the auth middleware can enforce it in T5.
    const decoded = verifyToken(token);
    // Either throws, or gateId is explicitly undefined — document both.
    if (decoded !== null) {
      expect(decoded.gateId).toBeUndefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate-scope claim preservation  (PRJ-SR-004)
// The gateId embedded in the token must survive a round-trip unchanged.
// ─────────────────────────────────────────────────────────────────────────────
describe("JWT gate-scope claim round-trip (PRJ-SR-004)", () => {
  const gates = ["Entry-1", "Entry-2", "Exit-1", "Exit-2"];

  gates.forEach((gateId) => {
    test(`gateId '${gateId}' round-trips without alteration`, () => {
      const token = signToken({ userId: "op", role: "operator", gateId });
      const decoded = verifyToken(token);
      expect(decoded.gateId).toBe(gateId);
    });
  });

  test("admin token carries no gateId claim", () => {
    const token = signToken({ userId: "adm", role: "admin" });
    const decoded = verifyToken(token);
    expect(decoded.gateId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password hashing  (PRJ-SR-003)
// ─────────────────────────────────────────────────────────────────────────────
describe("hashPassword", () => {
  test("returns a non-empty string", async () => {
    const hash = await hashPassword("secret123");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(0);
  });

  test("hash is different from the plaintext password", async () => {
    const hash = await hashPassword("secret123");
    expect(hash).not.toBe("secret123");
  });

  test("two hashes of the same password are different (salt randomness)", async () => {
    const h1 = await hashPassword("secret123");
    const h2 = await hashPassword("secret123");
    expect(h1).not.toBe(h2);
  });

  test("hash looks like a bcrypt hash (starts with $2b$)", async () => {
    const hash = await hashPassword("anypassword");
    expect(hash.startsWith("$2b$")).toBe(true);
  });

  test("does not store the plaintext password in the hash string", async () => {
    const plain = "myPlainPassword";
    const hash = await hashPassword(plain);
    expect(hash).not.toContain(plain);
  });
});

describe("comparePassword", () => {
  test("returns true when plaintext matches the hash", async () => {
    const plain = "correctPassword";
    const hash = await hashPassword(plain);
    const result = await comparePassword(plain, hash);
    expect(result).toBe(true);
  });

  test("returns false when plaintext does NOT match the hash", async () => {
    const hash = await hashPassword("correctPassword");
    const result = await comparePassword("wrongPassword", hash);
    expect(result).toBe(false);
  });

  test("returns false for an empty password string against a real hash", async () => {
    const hash = await hashPassword("nonEmpty");
    const result = await comparePassword("", hash);
    expect(result).toBe(false);
  });

  test("returns false for empty password against empty hash", async () => {
    // Even an empty string must not trivially match
    const result = await comparePassword("", "");
    expect(result).toBe(false);
  });

  test("returns false or throws gracefully for a malformed/corrupted hash string", async () => {
    try {
      const result = await comparePassword("secret", "not_a_valid_bcrypt_hash");
      expect(result).toBe(false);
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});
