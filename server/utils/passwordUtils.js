"use strict";

const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 10;

async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new TypeError("Password must be a non-empty string");
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, hash) {
  if (typeof password !== "string" || typeof hash !== "string" || !hash) {
    return false;
  }
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, comparePassword };
