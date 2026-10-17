"use strict";

const jwt = require("jsonwebtoken");

function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production");
  }
  return "vps-local-development-secret-change-before-deployment";
}

function signToken(payload, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Token payload must be an object");
  }
  return jwt.sign(payload, getSecret(), { expiresIn: "8h", ...options });
}

function verifyToken(token) {
  if (typeof token !== "string" || !token) {
    throw new TypeError("A token is required");
  }
  return jwt.verify(token, getSecret());
}

module.exports = { signToken, verifyToken };
