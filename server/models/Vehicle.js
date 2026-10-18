"use strict";

const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    plateNumber: {
      type: String,
      required: [true, "Plate number is required"],
      trim: true,
      uppercase: true,
      unique: true,
      maxlength: 16,
    },
    vehicleType: {
      type: String,
      required: [true, "Vehicle type is required"],
      enum: ["2W", "4W"],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.models.Vehicle || mongoose.model("Vehicle", vehicleSchema);
