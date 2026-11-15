"use strict";

const FareTierConfig = require("../models/FareTierConfig");
const { getFareOverride } = require("./simulationService");

/**
 * Return the persisted rate table for a vehicle type, if an administrator has
 * configured one. Callers retain the fare service defaults when no document
 * exists, which keeps first-run deployments usable before configuration is
 * seeded.
 */
async function getFareConfig(vehicleType, { useSimulationOverride = false } = {}) {
  // The developer fare override is unauthenticated demo tooling, so it may only
  // price simulated cars. Real vehicles always use the stored admin tariff.
  if (useSimulationOverride) {
    const simulationOverride = getFareOverride(vehicleType);
    if (simulationOverride) return simulationOverride;
  }

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
