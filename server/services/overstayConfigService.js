"use strict";

const FareTierConfig = require("../models/FareTierConfig");
const SystemConfig = require("../models/SystemConfig");
const { DEFAULT_FARE_CONFIG } = require("./fareService");
const { writeAuditEntry } = require("./auditService");

const ZONES = ["2W", "4W"];
const OVERSTAY_THRESHOLD_KEY = "overstayThresholdHours";
const DEFAULT_OVERSTAY_THRESHOLD_HOURS = 24;
const MAX_OVERSTAY_THRESHOLD_HOURS = 100000;

function serviceError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function maxTierHours(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return 0;
  return tiers.reduce((maximum, tier) => {
    const hours = Number(tier?.afterHours);
    return Number.isFinite(hours) ? Math.max(maximum, hours) : maximum;
  }, 0);
}

async function effectiveMaxTierByZone() {
  const configured = await FareTierConfig.find({
    vehicleType: { $in: ZONES },
  }).lean();
  const byType = new Map(configured.map((config) => [config.vehicleType, config]));
  const result = {};
  for (const zone of ZONES) {
    const stored = byType.get(zone);
    const tiers = stored?.tiers?.length ? stored.tiers : DEFAULT_FARE_CONFIG[zone].tiers;
    result[zone] = maxTierHours(tiers);
  }
  return result;
}

async function minimumOverstayThresholdHours() {
  const maximums = await effectiveMaxTierByZone();
  return Math.max(...ZONES.map((zone) => maximums[zone]));
}

async function getOverstayThresholdHours() {
  const minimumHours = await minimumOverstayThresholdHours();
  const fallbackHours = Math.max(DEFAULT_OVERSTAY_THRESHOLD_HOURS, minimumHours);
  const stored = await SystemConfig.findOne({
    key: OVERSTAY_THRESHOLD_KEY,
  }).lean();
  const storedHours = Number(stored?.value);
  if (!Number.isFinite(storedHours) || storedHours <= 0) return fallbackHours;
  return Math.max(storedHours, minimumHours);
}

async function getOverstayConfig() {
  const minimumHours = await minimumOverstayThresholdHours();
  return {
    thresholdHours: await getOverstayThresholdHours(),
    minimumHours,
    defaultHours: Math.max(DEFAULT_OVERSTAY_THRESHOLD_HOURS, minimumHours),
  };
}

async function updateOverstayThreshold({ thresholdHours } = {}, actor) {
  const hours = Number(thresholdHours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_OVERSTAY_THRESHOLD_HOURS) {
    throw serviceError(
      `thresholdHours must be greater than 0 and at most ${MAX_OVERSTAY_THRESHOLD_HOURS}`,
      "INVALID_OVERSTAY_THRESHOLD",
      400,
    );
  }

  const minimumHours = await minimumOverstayThresholdHours();
  if (hours + 1e-9 < minimumHours) {
    throw serviceError(
      `Overstay threshold cannot be lower than the highest fare tier (${minimumHours} hours)`,
      "INVALID_OVERSTAY_THRESHOLD",
      400,
    );
  }

  await SystemConfig.findOneAndUpdate(
    { key: OVERSTAY_THRESHOLD_KEY },
    { $set: { value: hours }, $setOnInsert: { key: OVERSTAY_THRESHOLD_KEY } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );

  await writeAuditEntry({
    action: "OVERSTAY_CONFIG_UPDATED",
    actorId: actor.userId,
    actorRole: actor.role,
    details: { thresholdHours: hours, minimumHours },
  });

  return { updated: true, thresholdHours: hours, minimumHours };
}

/**
 * A fare table may not extend beyond the configured overstay threshold. This
 * keeps the rule "overstay starts after every billable tier has started"
 * enforced server-side for both admin configuration paths.
 */
async function assertFareTableRespectsOverstayThreshold({ vehicleType, tiers }) {
  const maximums = await effectiveMaxTierByZone();
  maximums[vehicleType] = maxTierHours(tiers);
  const requiredHours = Math.max(...ZONES.map((zone) => maximums[zone]));
  const thresholdHours = await getOverstayThresholdHours();

  if (thresholdHours + 1e-9 < requiredHours) {
    throw serviceError(
      `Overstay threshold (${thresholdHours} hours) must be at least the highest fare tier (${requiredHours} hours). Raise the overstay threshold or lower the fare tiers.`,
      "INVALID_FARE_TIERS",
      400,
    );
  }
  return requiredHours;
}

module.exports = {
  OVERSTAY_THRESHOLD_KEY,
  DEFAULT_OVERSTAY_THRESHOLD_HOURS,
  MAX_OVERSTAY_THRESHOLD_HOURS,
  getOverstayConfig,
  getOverstayThresholdHours,
  minimumOverstayThresholdHours,
  updateOverstayThreshold,
  assertFareTableRespectsOverstayThreshold,
};
