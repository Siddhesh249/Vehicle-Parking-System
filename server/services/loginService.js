"use strict";

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { signToken } = require("../utils/jwtUtils");
const { comparePassword } = require("../utils/passwordUtils");

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

async function writeAudit(user, action) {
  if (!user) return;
  await AuditLog.create({
    action,
    actorId: user._id,
    actorRole: user.role,
    details: { username: user.username },
  });
}

function authError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function login(username, password) {
  const user = await User.findOne({ username }).select("+passwordHash");
  if (!user) throw authError("Invalid credentials");

  const now = new Date();
  if (user.isLocked && user.lockUntil && user.lockUntil > now) {
    throw authError("Account locked. Try again later.", 423);
  }
  if (user.isLocked || user.lockUntil) {
    user.isLocked = false;
    user.lockUntil = undefined;
    user.failedLoginAttempts = 0;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    user.failedLoginAttempts += 1;
    let action = "LOGIN_FAIL";
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.failedLoginAttempts = MAX_FAILED_ATTEMPTS;
      user.isLocked = true;
      user.lockUntil = new Date(Date.now() + LOCKOUT_MS);
      action = "ACCOUNT_LOCKED";
    }
    await user.save();
    await writeAudit(user, action);
    if (action === "ACCOUNT_LOCKED") {
      throw authError("Account locked. Try again later.", 423);
    }
    throw authError("Invalid credentials");
  }

  user.failedLoginAttempts = 0;
  user.isLocked = false;
  user.lockUntil = undefined;
  await user.save();
  await writeAudit(user, "LOGIN_SUCCESS");

  const claims = { userId: user._id.toString(), role: user.role };
  if (user.gateId) claims.gateId = user.gateId;
  return {
    token: signToken(claims),
    role: user.role,
    ...(user.gateId ? { gateId: user.gateId } : {}),
  };
}

module.exports = { login, MAX_FAILED_ATTEMPTS, LOCKOUT_MS };
