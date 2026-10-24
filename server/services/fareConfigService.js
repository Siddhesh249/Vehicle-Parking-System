"use strict";

const FareTierConfig = require("../models/FareTierConfig");

/**
 * Return the persisted rate table for a vehicle type, if an administrator has
 * configured one. Callers retain the fare service defaults when no document
 * exists, which keeps first-run deployments usable before configuration is
 * seeded.
 */
async function getFareConfig(vehicleType) {
  const configured = await FareTierConfig.findOne({ vehicleType }).lean();
  if (!configured) return undefined;

  return {
    [vehicleType]: {
      firstHourFree: configured.firstHourFree,
      tiers: configured.tiers,
      lostTicketPenalty: configured.lostTicketPenalty,
      overstayPenalty: configured.overstayPenalty,
    },
  };
}

module.exports = { getFareConfig };
