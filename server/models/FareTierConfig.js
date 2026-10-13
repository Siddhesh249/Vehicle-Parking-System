"use strict";

const mongoose = require("mongoose");

const tierSchema = new mongoose.Schema(
  {
    afterHours: {
      type: Number,
      required: true,
      min: 0,
    },
    ratePerHour: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const fareTierConfigSchema = new mongoose.Schema(
  {
    vehicleType: {
      type: String,
      required: true,
      enum: ["2W", "4W"],
      unique: true,
    },
    firstHourFree: {
      type: Boolean,
      default: true,
    },
    tiers: {
      type: [tierSchema],
      required: true,
      validate: {
        validator(tiers) {
          if (!Array.isArray(tiers) || tiers.length === 0) return false;
          return tiers.every(
            (tier, index) =>
              Number.isFinite(tier.afterHours) &&
              Number.isFinite(tier.ratePerHour) &&
              (index === 0 || tier.afterHours > tiers[index - 1].afterHours)
          );
        },
        message: "Fare tiers must be non-empty and ordered by increasing hours",
      },
    },
    lostTicketPenalty: {
      type: Number,
      default: function () {
        return this.vehicleType === "2W" ? 50 : 100;
      },
      min: 0,
    },
    overstayPenalty: {
      type: Number,
      default: function () {
        return this.vehicleType === "2W" ? 100 : 200;
      },
      min: 0,
    },
  },
  { timestamps: true }
);

fareTierConfigSchema.index({ vehicleType: 1 }, { unique: true });

module.exports =
  mongoose.models.FareTierConfig ||
  mongoose.model("FareTierConfig", fareTierConfigSchema);
