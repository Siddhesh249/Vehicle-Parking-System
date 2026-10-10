"use strict";

const mongoose = require("mongoose");

const GATE_IDS = ["Entry-1", "Entry-2", "Exit-1", "Exit-2"];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
      unique: true,
      minlength: 3,
      maxlength: 64,
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false,
    },
    role: {
      type: String,
      required: true,
      enum: ["operator", "admin"],
    },
    gateId: {
      type: String,
      enum: GATE_IDS,
      required: function () {
        return this.role === "operator";
      },
    },
    failedLoginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockUntil: {
      type: Date,
      default: undefined,
    },
  },
  { timestamps: true }
);

userSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
