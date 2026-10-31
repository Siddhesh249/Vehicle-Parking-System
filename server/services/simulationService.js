"use strict";

const { randomUUID } = require("node:crypto");
const { Types } = require("mongoose");
const { allocateSpot } = require("./allocationService");

const MAX_RATE_PER_MINUTE = 600;
const TICK_MS = 1000;
const VALID_VEHICLE_TYPES = new Set(["2W", "4W"]);
const fareOverrides = new Map();

let timer = null;
let startedAt = null;
let ratePerMinute = 0;
let emittedArrivals = 0;
let lastError = null;

function arrivalsForWindow({ ratePerMinute: rate, elapsedMs } = {}) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw new TypeError("ratePerMinute must be a non-negative finite number");
  }
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new TypeError("elapsedMs must be a non-negative finite number");
  }
  return Math.floor((rate * elapsedMs) / 60000);
}

function getSimulationState() {
  return {
    running: timer !== null,
    ratePerMinute,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    emittedArrivals,
    lastError,
  };
}

async function generateArrival() {
  const vehicleType = Math.random() < 0.65 ? "2W" : "4W";
  const gateId = Math.random() < 0.5 ? "Entry-1" : "Entry-2";
  const plateNumber = `SIM${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 5).toUpperCase()}`;

  try {
    await allocateSpot({
      plateNumber,
      vehicleType,
      gateId,
      operatorId: new Types.ObjectId().toString(),
    });
    emittedArrivals += 1;
    lastError = null;
  } catch (error) {
    // A full lot is an expected simulation outcome, not a generator failure.
    if (error.code !== "LOT_FULL") lastError = error.message;
  }
}

function scheduleTick() {
  if (timer) clearInterval(timer);
  timer = setInterval(async () => {
    if (!startedAt) return;
    const elapsedMs = Date.now() - startedAt;
    const targetArrivals = arrivalsForWindow({ ratePerMinute, elapsedMs });
    const pending = Math.max(0, targetArrivals - emittedArrivals);
    for (let index = 0; index < pending; index += 1) {
      await generateArrival();
    }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function startSimulation({ ratePerMinute: requestedRate } = {}) {
  if (
    typeof requestedRate !== "number" ||
    !Number.isFinite(requestedRate) ||
    requestedRate <= 0 ||
    requestedRate > MAX_RATE_PER_MINUTE
  ) {
    const error = new TypeError(`ratePerMinute must be greater than 0 and at most ${MAX_RATE_PER_MINUTE}`);
    error.code = "INVALID_SIMULATION_RATE";
    error.statusCode = 400;
    throw error;
  }

  ratePerMinute = requestedRate;
  startedAt = Date.now();
  emittedArrivals = 0;
  lastError = null;
  scheduleTick();
  return { status: "running" };
}

function stopSimulation() {
  if (timer) clearInterval(timer);
  timer = null;
  startedAt = null;
  ratePerMinute = 0;
  return { status: "stopped" };
}

function validateFareOverride(config) {
  if (!config || !VALID_VEHICLE_TYPES.has(config.vehicleType)) {
    throw new TypeError("vehicleType must be either '2W' or '4W'");
  }
  if (!Array.isArray(config.tiers) || config.tiers.length === 0) {
    throw new TypeError("tiers must be a non-empty array");
  }
  let previous = -1;
  const tiers = config.tiers.map((tier) => {
    const afterHours = tier?.afterHours;
    const ratePerHour = tier?.ratePerHour ?? tier?.rate;
    if (
      typeof afterHours !== "number" ||
      !Number.isFinite(afterHours) ||
      afterHours < 0 ||
      afterHours <= previous ||
      typeof ratePerHour !== "number" ||
      !Number.isFinite(ratePerHour) ||
      ratePerHour < 0
    ) {
      throw new TypeError("Fare tiers need increasing afterHours and non-negative ratePerHour values");
    }
    previous = afterHours;
    return { afterHours, ratePerHour };
  });

  for (const key of ["lostTicketPenalty", "overstayPenalty"]) {
    if (config[key] !== undefined && (
      typeof config[key] !== "number" || !Number.isFinite(config[key]) || config[key] < 0
    )) {
      throw new TypeError(`${key} must be a non-negative finite number`);
    }
  }

  return {
    firstHourFree: config.firstHourFree !== false,
    tiers,
    lostTicketPenalty: config.lostTicketPenalty,
    overstayPenalty: config.overstayPenalty,
  };
}

function setFareOverride(config) {
  const validated = validateFareOverride(config);
  fareOverrides.set(config.vehicleType, validated);
  return { updated: true, vehicleType: config.vehicleType };
}

function getFareOverride(vehicleType) {
  const config = fareOverrides.get(vehicleType);
  return config ? { [vehicleType]: { ...config, tiers: config.tiers.map((tier) => ({ ...tier })) } } : undefined;
}

function clearFareOverrides() {
  fareOverrides.clear();
}

module.exports = {
  startSimulation,
  stopSimulation,
  getSimulationState,
  arrivalsForWindow,
  setFareOverride,
  getFareOverride,
  clearFareOverrides,
  MAX_RATE_PER_MINUTE,
};
