"use strict";

const FareTierConfig = require("../models/FareTierConfig");
const Spot = require("../models/Spot");
const { writeAuditEntry } = require("./auditService");

const ZONES = ["2W", "4W"];
const MAX_SPOTS_PER_ZONE = 500;

function serviceError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw serviceError("tiers must be a non-empty array", "INVALID_TIERS", 400);
  }
  tiers.forEach((tier, index) => {
    if (!tier || !isNonNegativeNumber(tier.afterHours) || !isNonNegativeNumber(tier.rate)) {
      throw serviceError(
        "Each tier needs a non-negative numeric afterHours and rate",
        "INVALID_TIERS",
        400,
      );
    }
    if (index > 0 && tier.afterHours <= tiers[index - 1].afterHours) {
      throw serviceError(
        "Tiers must be ordered by strictly increasing afterHours",
        "INVALID_TIERS",
        400,
      );
    }
  });
}

/** Replace the fare tier table for one vehicle type (VPS-F-055). */
async function updateFareTiers({ vehicleType, tiers } = {}, actor) {
  if (!ZONES.includes(vehicleType)) {
    throw serviceError("vehicleType must be either '2W' or '4W'", "INVALID_TIERS", 400);
  }
  validateTiers(tiers);

  const storedTiers = tiers.map(({ afterHours, rate }) => ({ afterHours, ratePerHour: rate }));
  await FareTierConfig.findOneAndUpdate(
    { vehicleType },
    { $set: { tiers: storedTiers }, $setOnInsert: { vehicleType } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  await writeAuditEntry({
    action: "FARE_CONFIG_UPDATED",
    actorId: actor.userId,
    actorRole: actor.role,
    details: { vehicleType, tiers: storedTiers },
  });
  return { updated: true };
}

function nextSpotNumbers(zone, existingNumbers, needed) {
  const taken = new Set(existingNumbers);
  const numbers = [];
  for (let n = 1; numbers.length < needed; n += 1) {
    const spotNumber = `${zone}-${String(n).padStart(3, "0")}`;
    if (!taken.has(spotNumber)) numbers.push(spotNumber);
  }
  return numbers;
}

/**
 * Grow or shrink a zone to the requested number of spots (VPS-F-056). Only
 * free spots are removed, and the delete re-checks status so a spot claimed
 * by an entry gate in the meantime is never deleted from under a vehicle.
 */
async function updateSpotCount({ zone, count } = {}, actor) {
  if (!ZONES.includes(zone)) {
    throw serviceError("zone must be either '2W' or '4W'", "INVALID_REQUEST", 400);
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_SPOTS_PER_ZONE) {
    throw serviceError(
      `count must be an integer between 0 and ${MAX_SPOTS_PER_ZONE}`,
      "INVALID_REQUEST",
      400,
    );
  }

  const existing = await Spot.find({ zone }, { spotNumber: 1, status: 1 }).lean();
  const previousCount = existing.length;

  if (count > previousCount) {
    const spotNumbers = nextSpotNumbers(
      zone,
      existing.map(({ spotNumber }) => spotNumber),
      count - previousCount,
    );
    try {
      await Spot.insertMany(spotNumbers.map((spotNumber) => ({ spotNumber, zone })));
    } catch (error) {
      if (error && error.code === 11000) {
        throw serviceError("Spot configuration changed concurrently; retry", "CONFLICT", 409);
      }
      throw error;
    }
  } else if (count < previousCount) {
    const toRemove = previousCount - count;
    const freeSpots = existing
      .filter(({ status }) => status === "free")
      .sort((a, b) => b.spotNumber.localeCompare(a.spotNumber));
    if (freeSpots.length < toRemove) {
      throw serviceError(
        `Only ${freeSpots.length} free ${zone} spots can be removed`,
        "SPOTS_OCCUPIED",
        409,
      );
    }
    await Spot.deleteMany({
      _id: { $in: freeSpots.slice(0, toRemove).map(({ _id }) => _id) },
      status: "free",
    });
  }

  const finalCount = await Spot.countDocuments({ zone });
  await writeAuditEntry({
    action: "SPOT_CONFIG_UPDATED",
    actorId: actor.userId,
    actorRole: actor.role,
    details: { zone, previousCount, requestedCount: count, count: finalCount },
  });
  return { updated: true, zone, count: finalCount };
}

module.exports = { updateFareTiers, updateSpotCount };
