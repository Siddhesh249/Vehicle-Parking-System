"use strict";

const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: [true, "Audit action is required"],
      enum: [
        "VEHICLE_ENTRY",
        "VEHICLE_EXIT",
        "LOGIN_SUCCESS",
        "LOGIN_FAIL",
        "ACCOUNT_LOCKED",
        "SPOT_FORCE_RELEASE",
        "FARE_CONFIG_UPDATED",
        "OVERSTAY_FLAGGED",
      ],
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Actor ID is required"],
    },
    actorRole: {
      type: String,
      required: [true, "Actor role is required"],
      enum: ["operator", "admin"],
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      trim: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
