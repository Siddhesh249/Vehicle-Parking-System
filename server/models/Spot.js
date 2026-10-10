"use strict";

const mongoose = require("mongoose");

const spotSchema = new mongoose.Schema(
  {
    spotNumber: {
      type: String,
      required: [true, "Spot number is required"],
      trim: true,
      unique: true,
    },
    zone: {
      type: String,
      required: [true, "Spot zone is required"],
      enum: ["2W", "4W"],
    },
    status: {
      type: String,
      enum: ["free", "reserved"],
      default: "free",
      required: true,
    },
    currentTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      default: null,
    },
  },
  { timestamps: true }
);

spotSchema.index({ spotNumber: 1 }, { unique: true });
spotSchema.index({ zone: 1, status: 1 });

module.exports = mongoose.models.Spot || mongoose.model("Spot", spotSchema);
