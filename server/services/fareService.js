"use strict";

const DEFAULT_FARE_CONFIG = {
  "4W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, ratePerHour: 20 },
      { afterHours: 3, ratePerHour: 30 },
      { afterHours: 6, ratePerHour: 50 },
    ],
    lostTicketPenalty: 100,
    overstayPenalty: 200,
  },
  "2W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, ratePerHour: 10 },
      { afterHours: 3, ratePerHour: 15 },
      { afterHours: 6, ratePerHour: 25 },
    ],
    lostTicketPenalty: 50,
    overstayPenalty: 100,
  },
};

function getDurationHours(entryTimestamp, exitTimestamp) {
  const entry = new Date(entryTimestamp).getTime();
  const exit = new Date(exitTimestamp).getTime();

  if (!Number.isFinite(entry) || !Number.isFinite(exit)) {
    throw new TypeError("Entry and exit timestamps must be valid dates");
  }
  if (exit < entry) {
    throw new RangeError("Exit timestamp cannot be before entry timestamp");
  }

  return (exit - entry) / (60 * 60 * 1000);
}

function calculateBaseFare(durationHours, config) {
  const freeUntil = config.firstHourFree ? 1 : 0;
  if (durationHours <= freeUntil) return 0;

  const tiers = [...config.tiers].sort(
    (a, b) => a.afterHours - b.afterHours
  );
  if (tiers.length === 0) {
    throw new TypeError("At least one fare tier is required");
  }

  let fare = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const nextThreshold =
      index + 1 < tiers.length ? tiers[index + 1].afterHours : Infinity;
    const start = Math.max(freeUntil, tier.afterHours);
    const end = Math.min(durationHours, nextThreshold);

    if (end > start) {
      fare += (end - start) * tier.ratePerHour;
    }
  }

  // When the first tier begins after the free interval, do not charge the gap.
  // Configurations used by this project start at hour 1 (or hour 0 when free time is disabled).
  return fare;
}

/**
 * Calculate a parking fee using elapsed hours without rounding fractional time.
 * options: { lostTicket?: boolean, overstay?: boolean }
 * customConfig: optional map keyed by "2W" and "4W".
 */
function calculateFare(
  entryTimestamp,
  exitTimestamp,
  vehicleType,
  options = {},
  customConfig = DEFAULT_FARE_CONFIG
) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_FARE_CONFIG, vehicleType)) {
    throw new TypeError("vehicleType must be either '2W' or '4W'");
  }

  const durationHours = getDurationHours(entryTimestamp, exitTimestamp);
  const config = customConfig[vehicleType] || DEFAULT_FARE_CONFIG[vehicleType];
  if (!config || !Array.isArray(config.tiers)) {
    throw new TypeError("A valid fare configuration is required");
  }

  let fare = calculateBaseFare(durationHours, config);
  if (options.lostTicket) {
    fare += Number(config.lostTicketPenalty ?? DEFAULT_FARE_CONFIG[vehicleType].lostTicketPenalty);
  }
  if (options.overstay) {
    fare += Number(config.overstayPenalty ?? DEFAULT_FARE_CONFIG[vehicleType].overstayPenalty);
  }

  return fare;
}

module.exports = { calculateFare, DEFAULT_FARE_CONFIG };
