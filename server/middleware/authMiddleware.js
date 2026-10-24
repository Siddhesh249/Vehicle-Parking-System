"use strict";

const { verifyToken } = require("../utils/jwtUtils");

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

/** Verify the Bearer JWT and attach its claims to req.user (PRJ-SR-004). */
function authenticateToken(req, res, next) {
  const header = (req.headers && req.headers.authorization) || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return sendError(res, 401, "UNAUTHORIZED", "Authentication token is required");
  }

  try {
    req.user = verifyToken(token);
  } catch {
    return sendError(res, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  return next();
}

/** Allow only operators whose token is scoped to the given gate (PRJ-SR-005). */
function requireGate(gateId) {
  return (req, res, next) => {
    const user = req.user;
    if (!user || user.role !== "operator" || user.gateId !== gateId) {
      return sendError(res, 403, "FORBIDDEN", `Access restricted to ${gateId} operator`);
    }
    return next();
  };
}

/** Allow only users holding one of the given roles. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(res, 403, "FORBIDDEN", "Insufficient permissions");
    }
    return next();
  };
}

module.exports = { authenticateToken, requireGate, requireRole };
