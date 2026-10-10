"use strict";

const mongoose = require("mongoose");

const GATE_IDS = ["Entry-1", "Entry-2", "Exit-1", "Exit-2"];

const transactionSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: [true, "Ticket ID is required"],
      unique: true,
      trim: true,
    },
    plateNumber: {
      type: String,
      required: [true, "Plate number is required"],
      trim: true,
      uppercase: true,
      maxlength: 16,
    },
    vehicleType: {
      type: String,
      required: true,
      enum: ["2W", "4W"],
    },
    spotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Spot",
      required: [true, "Parking spot is required"],
    },
    entryGateId: {
      type: String,
      required: true,
      enum: GATE_IDS.filter((gate) => gate.startsWith("Entry")),
    },
    entryOperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    entryTimestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
    exitGateId: {
      type: String,
      enum: GATE_IDS.filter((gate) => gate.startsWith("Exit")),
    },
    exitOperatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    exitTimestamp: Date,
    durationSeconds: {
      type: Number,
      min: 0,
    },
    fare: {
      type: Number,
      min: 0,
    },
    penaltyApplied: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active",
      required: true,
    },
    isOverstay: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

transactionSchema.index({ ticketId: 1 }, { unique: true });
transactionSchema.index({ plateNumber: 1, status: 1 });
transactionSchema.index({ status: 1, entryTimestamp: 1 });

module.exports =
  mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
