/** Sprint 2 — T4: JWT authentication and server-side gate authorization. */
"use strict";

jest.mock("../utils/jwtUtils", () => ({ verifyToken: jest.fn() }));

const { verifyToken } = require("../utils/jwtUtils");
const { authenticateToken, requireGate, requireRole } = require("../middleware/authMiddleware");

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe("auth middleware", () => {
  beforeEach(() => jest.clearAllMocks());

  test("rejects requests without a Bearer token", () => {
    const req = { headers: {} };
    const res = response();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(next).not.toHaveBeenCalled();
    expect(verifyToken).not.toHaveBeenCalled();
  });

  test("rejects expired, malformed, or tampered tokens", () => {
    verifyToken.mockImplementation(() => { throw new Error("invalid token"); });
    const req = { headers: { authorization: "Bearer invalid.jwt.token" } };
    const res = response();
    const next = jest.fn();

    authenticateToken(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(next).not.toHaveBeenCalled();
  });

  test("attaches verified claims and continues for a valid token", () => {
    const claims = { userId: "operator-1", role: "operator", gateId: "Entry-1" };
    verifyToken.mockReturnValue(claims);
    const req = { headers: { authorization: "Bearer valid.jwt.token" } };
    const next = jest.fn();

    authenticateToken(req, response(), next);

    expect(req.user).toEqual(claims);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test.each([["Entry-1"], ["Entry-2"], ["Exit-1"], ["Exit-2"]])("allows the operator assigned to %s", (gateId) => {
    const req = { user: { role: "operator", gateId } };
    const next = jest.fn();
    const res = response();

    requireGate(gateId)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test("rejects a valid operator token scoped to a different gate", () => {
    const req = { user: { role: "operator", gateId: "Entry-1" } };
    const res = response();
    const next = jest.fn();

    requireGate("Entry-2")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(next).not.toHaveBeenCalled();
  });

  test("does not let an admin token impersonate a gate-scoped operator", () => {
    const req = { user: { role: "admin" } };
    const res = response();
    const next = jest.fn();

    requireGate("Entry-1")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test("blocks an operator from admin-only routes even when the token is valid", () => {
    const req = { user: { role: "operator", gateId: "Exit-1" } };
    const res = response();
    const next = jest.fn();

    requireRole("admin")(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(next).not.toHaveBeenCalled();
  });

  test("allows an admin through an admin-only role guard", () => {
    const req = { user: { role: "admin" } };
    const next = jest.fn();

    requireRole("admin")(req, response(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
