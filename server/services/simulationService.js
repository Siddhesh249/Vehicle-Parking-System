"use strict";

const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { allocateSpot } = require("./allocationService");
const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const {
  realMillisecondsForSimulatedHours,
  simulatedHoursBetween,
} = require("../utils/simulatedTime");

const MAX_RATE_PER_MINUTE = 600;
const TICK_MS = 1000;
const VALID_VEHICLE_TYPES = new Set(["2W", "4W"]);
const ENTRY_GATES = ["Entry-1", "Entry-2"];
const EXIT_GATES = ["Exit-1", "Exit-2"];
const MAX_QUEUE_PER_GATE = 8;
const MAX_COMPLETED_HISTORY = 120;
const fareOverrides = new Map();

/**
 * Developer-only demo traffic. Every generated "bot" behaves like a real
 * customer: it queues at an entry gate, waits for the entry operator to issue a
 * ticket, parks for a known simulated duration, then queues at an exit gate
 * where the exit operator scans its ticket and collects payment. That keeps the
 * whole demo driven by the five real consoles instead of forging transactions.
 */
const bots = new Map();

let timer = null;
let running = false;
let ratePerMinute = 0;
let startedAt = null;
let lastTickAt = null;
let arrivalCarry = 0;
let generatedArrivals = 0;
let successfulAllocations = 0;
let fullLotArrivals = 0;
let queueOverflow = 0;
let completedExits = 0;
let revenueCollected = 0;
let lastError = null;
let tickInProgress = false;
let promotionListener = null;

/** Registered by app.js so promoted cars also refresh every connected lot map. */
function setPromotionListener(listener) {
  promotionListener = typeof listener === "function" ? listener : null;
}

function randomPlateNumber() {
  return `BOT${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`;
}

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Most demo cars park for a few simulated hours. A slice parks long enough to
// cross the overstay threshold, so the admin feed has something to show.
function randomStayHours() {
  const roll = Math.random();
  if (roll < 0.08) return 8 + Math.random() * 4;
  if (roll < 0.35) return 4 + Math.random() * 3;
  return 0.5 + Math.random() * 3.5;
}

function rounds(value) {
  return Math.round(value * 100) / 100;
}

function entryQueue(gateId) {
  return [...bots.values()]
    .filter((bot) => bot.status === "waiting_entry" && bot.entryGateId === gateId)
    .sort((a, b) => a.arrivedAt - b.arrivedAt);
}

function exitQueue(gateId) {
  return [...bots.values()]
    .filter((bot) => bot.status === "waiting_exit" && bot.exitGateId === gateId)
    .sort((a, b) => a.exitQueuedAt - b.exitQueuedAt);
}

function pruneCompleted() {
  const completed = [...bots.values()]
    .filter((bot) => bot.status === "completed" || bot.status === "rejected")
    .sort((a, b) => (a.settledAt ?? a.arrivedAt) - (b.settledAt ?? b.arrivedAt));
  while (completed.length > MAX_COMPLETED_HISTORY) {
    const oldest = completed.shift();
    bots.delete(oldest.id);
  }
}

function publicEntryBot(bot) {
  return {
    botId: bot.id,
    plateNumber: bot.plateNumber,
    vehicleType: bot.vehicleType,
    arrivedAt: new Date(bot.arrivedAt).toISOString(),
    waitSeconds: Math.max(0, Math.round((Date.now() - bot.arrivedAt) / 1000)),
  };
}

function publicExitBot(bot) {
  return {
    botId: bot.id,
    hasTicket: !bot.lostTicket,
    queuedAt: new Date(bot.exitQueuedAt).toISOString(),
    waitSeconds: Math.max(0, Math.round((Date.now() - bot.exitQueuedAt) / 1000)),
  };
}

/** Move parked cars whose simulated stay has elapsed onto an exit queue. */
function promoteParkedBots() {
  const now = Date.now();
  const promoted = [];
  for (const bot of bots.values()) {
    if (bot.status !== "parked") continue;
    if (now < bot.exitAtMs) continue;
    bot.status = "waiting_exit";
    bot.exitGateId = randomItem(EXIT_GATES);
    bot.exitQueuedAt = now;
    // The parking timer hit at exitAtMs; bill from there, not from when the
    // 1-second tick (or an operator poll) actually noticed it.
    const parkingEnd = new Date(bot.exitAtMs);
    bot.parkingEndTimestamp = parkingEnd;

    // The parking timer stops here: bill up to this instant, and free the spot
    // immediately so the next car can use it while payment is pending.
    if (mongoose.connection.readyState === 1) {
      const transactionId = bot.transactionId;
      const spotId = bot.spotId;
      if (transactionId) {
        void Transaction.updateOne(
          { _id: transactionId, status: "active" },
          { $set: { parkingEndTimestamp: parkingEnd } },
        ).catch(() => {});
      }
      if (spotId && transactionId) {
        void Spot.updateOne(
          {
            _id: spotId,
            status: "reserved",
            currentTransactionId: transactionId,
          },
          { $set: { status: "free", currentTransactionId: null } },
        ).catch(() => {});
      }
    }
    promoted.push(bot);
  }

  if (promoted.length && promotionListener) {
    try {
      promotionListener(promoted);
    } catch {
      // A broadcast failure must not stop the fleet from moving.
    }
  }
  return promoted;
}

function spawnBot() {
  const entryGateId = randomItem(ENTRY_GATES);
  if (entryQueue(entryGateId).length >= MAX_QUEUE_PER_GATE) {
    queueOverflow += 1;
    return;
  }

  const bot = {
    id: randomUUID(),
    plateNumber: randomPlateNumber(),
    vehicleType: Math.random() < 0.65 ? "2W" : "4W",
    entryGateId,
    status: "waiting_entry",
    arrivedAt: Date.now(),
    intendedStayHours: rounds(randomStayHours()),
    lostTicket: Math.random() < 0.12,
  };
  bots.set(bot.id, bot);
}

function runTick() {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const now = Date.now();
    if (running && lastTickAt !== null) {
      arrivalCarry += (ratePerMinute * (now - lastTickAt)) / 60000;
      const due = Math.floor(arrivalCarry);
      arrivalCarry -= due;
      for (let index = 0; index < due; index += 1) {
        generatedArrivals += 1;
        spawnBot();
      }
    }
    lastTickAt = running ? now : null;
    promoteParkedBots();
    pruneCompleted();
    // Startup-adopted demo cars only need the timer until they head to an exit.
    if (!running && !hasParkedBots()) stopTimer();
  } finally {
    tickInProgress = false;
  }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(runTick, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function validateRate(requestedRate) {
  if (
    typeof requestedRate !== "number" ||
    !Number.isFinite(requestedRate) ||
    requestedRate <= 0 ||
    requestedRate > MAX_RATE_PER_MINUTE
  ) {
    const error = new TypeError(
      `ratePerMinute must be greater than 0 and at most ${MAX_RATE_PER_MINUTE}`,
    );
    error.code = "INVALID_SIMULATION_RATE";
    error.statusCode = 400;
    throw error;
  }
  return requestedRate;
}

function resetCounters() {
  generatedArrivals = 0;
  successfulAllocations = 0;
  fullLotArrivals = 0;
  queueOverflow = 0;
  completedExits = 0;
  revenueCollected = 0;
  lastError = null;
  arrivalCarry = 0;
}

function arrivalsForWindow({ ratePerMinute: rate, elapsedMs } = {}) {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) {
    throw new TypeError("ratePerMinute must be a non-negative finite number");
  }
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new TypeError("elapsedMs must be a non-negative finite number");
  }
  return Math.floor((rate * elapsedMs) / 60000);
}

function startSimulation({ ratePerMinute: requestedRate } = {}) {
  validateRate(requestedRate);
  running = true;
  ratePerMinute = requestedRate;
  startedAt = Date.now();
  lastTickAt = startedAt;
  resetCounters();
  ensureTimer();
  return { status: "running" };
}

/** Change the traffic rate without restarting the fleet or losing counters. */
function setSimulationRate({ ratePerMinute: requestedRate } = {}) {
  validateRate(requestedRate);
  if (!running) return startSimulation({ ratePerMinute: requestedRate });
  ratePerMinute = requestedRate;
  lastTickAt = Date.now();
  return { status: "running", ratePerMinute };
}

function stopSimulation() {
  running = false;
  startedAt = null;
  ratePerMinute = 0;
  lastTickAt = null;
  arrivalCarry = 0;
  stopTimer();
  promoteParkedBots();
  return { status: "stopped" };
}

function hasLiveBots() {
  return [...bots.values()].some(
    (bot) =>
      bot.status === "waiting_entry" ||
      bot.status === "parked" ||
      bot.status === "waiting_exit",
  );
}

function hasParkedBots() {
  return [...bots.values()].some((bot) => bot.status === "parked");
}

function getSimulationState() {
  promoteParkedBots();
  pruneCompleted();
  if (running) ensureTimer();
  else if (!hasLiveBots()) stopTimer();

  const parked = [...bots.values()].filter((bot) => bot.status === "parked");
  const waitingExit = [...bots.values()].filter((bot) => bot.status === "waiting_exit");
  const occupied = parked.length + waitingExit.length;
  const now = new Date();
  const overstayReady = parked.filter(
    (bot) => simulatedHoursBetween(bot.entryTimestamp, now) >= 24,
  ).length;

  return {
    running,
    ratePerMinute,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    generatedArrivals,
    successfulAllocations,
    fullLotArrivals,
    queueOverflow,
    completedExits,
    revenueCollected: rounds(revenueCollected),
    waitingEntry: entryQueue("Entry-1").length + entryQueue("Entry-2").length,
    parked: parked.length,
    waitingExit: waitingExit.length,
    lostTicketExits: waitingExit.filter((bot) => bot.lostTicket).length,
    overstayCandidates: overstayReady,
    occupied,
    botsInFleet: bots.size,
    lastError,
    gates: {
      "Entry-1": { waiting: entryQueue("Entry-1").length },
      "Entry-2": { waiting: entryQueue("Entry-2").length },
      "Exit-1": { waiting: exitQueue("Exit-1").length },
      "Exit-2": { waiting: exitQueue("Exit-2").length },
    },
  };
}

function getEntryQueue(gateId) {
  promoteParkedBots();
  const queue = entryQueue(gateId);
  return {
    gateId,
    queueLength: queue.length,
    bot: queue.length ? publicEntryBot(queue[0]) : null,
    waiting: queue.map(publicEntryBot),
  };
}

function getExitQueue(gateId) {
  promoteParkedBots();
  const queue = exitQueue(gateId);
  return {
    gateId,
    queueLength: queue.length,
    bot: queue.length ? publicExitBot(queue[0]) : null,
  };
}

function botNotFound() {
  const error = new Error("No simulated vehicle is waiting at this gate");
  error.code = "BOT_NOT_FOUND";
  error.statusCode = 404;
  return error;
}

function findBot(botId, status, gateId, gateField) {
  promoteParkedBots();
  const bot = bots.get(botId);
  if (!bot || bot.status !== status || bot[gateField] !== gateId) {
    throw botNotFound();
  }
  return bot;
}

/**
 * The entry operator pressed "Generate ticket": now the vehicle gets a real
 * spot and a transaction, exactly like a manually registered car.
 */
async function admitEntryBot({ botId, gateId, operatorId } = {}) {
  const bot = findBot(botId, "waiting_entry", gateId, "entryGateId");

  try {
    const result = await allocateSpot({
      plateNumber: bot.plateNumber,
      vehicleType: bot.vehicleType,
      gateId,
      operatorId,
    });
    bot.status = "parked";
    bot.ticketId = result.ticketId;
    bot.transactionId = String(result.transactionId ?? "");
    bot.spotId = result.spotId;
    bot.spotNumber = result.spotNumber;
    bot.entryTimestamp = result.entryTimestamp;
    bot.admittedAt = Date.now();
    bot.exitAtMs =
      new Date(result.entryTimestamp).getTime() +
      realMillisecondsForSimulatedHours(bot.intendedStayHours);
    successfulAllocations += 1;
    lastError = null;
    ensureTimer();
    return {
      ...result,
      botId: bot.id,
      intendedStayHours: bot.intendedStayHours,
      plannedExitAt: new Date(bot.exitAtMs).toISOString(),
    };
  } catch (error) {
    if (error?.code === "LOT_FULL") {
      // A full lot turns the car away; it does not stay in the queue forever.
      bots.delete(bot.id);
      fullLotArrivals += 1;
    } else {
      lastError = error?.message || "Could not admit the simulated vehicle";
    }
    throw error;
  }
}

/** Details revealed when the exit operator scans the waiting car's ticket. */
function inspectExitBot({ botId, gateId } = {}) {
  const bot = findBot(botId, "waiting_exit", gateId, "exitGateId");
  return {
    botId: bot.id,
    hasTicket: !bot.lostTicket,
    lostTicket: bot.lostTicket,
    ticketId: bot.lostTicket ? null : bot.ticketId,
    plateNumber: bot.plateNumber,
    vehicleType: bot.vehicleType,
    entryGateId: bot.entryGateId,
    entryTimestamp: bot.entryTimestamp,
    queuedAt: new Date(bot.exitQueuedAt).toISOString(),
    parkingEndTimestamp: new Date(bot.parkingEndTimestamp).toISOString(),
    waitSeconds: Math.max(0, Math.round((Date.now() - bot.exitQueuedAt) / 1000)),
    intendedStayHours: bot.intendedStayHours,
  };
}

/**
 * For manual lookups: if this car is a bot already waiting at an exit, bill it
 * up to the moment it joined the queue instead of the current time.
 */
function findBotExitTime({ ticketId, plateNumber, transactionId } = {}) {
  promoteParkedBots();
  const normalizedPlate =
    typeof plateNumber === "string" ? plateNumber.trim().toUpperCase() : null;
  for (const bot of bots.values()) {
    if (bot.status !== "waiting_exit") continue;
    const matches =
      (ticketId && bot.ticketId === ticketId) ||
      (transactionId && bot.transactionId === transactionId) ||
      (normalizedPlate && bot.plateNumber === normalizedPlate);
    if (matches) return new Date(bot.parkingEndTimestamp ?? bot.exitQueuedAt);
  }
  return null;
}

/** Called after an exit is settled (by an operator or an admin force-release). */
function markBotSettled({ ticketId, plateNumber, fare } = {}) {
  const normalizedPlate =
    typeof plateNumber === "string" ? plateNumber.trim().toUpperCase() : null;
  for (const bot of bots.values()) {
    if (bot.status !== "waiting_exit" && bot.status !== "parked") continue;
    const matches =
      (ticketId && bot.ticketId === ticketId) ||
      (normalizedPlate && bot.plateNumber === normalizedPlate);
    if (!matches) continue;
    bot.status = "completed";
    bot.settledAt = Date.now();
    bot.fare = typeof fare === "number" ? fare : (bot.fare ?? 0);
    completedExits += 1;
    revenueCollected += bot.fare || 0;
    return bot;
  }
  return null;
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
      throw new TypeError(
        "Fare tiers need increasing afterHours and non-negative ratePerHour values",
      );
    }
    previous = afterHours;
    return { afterHours, ratePerHour };
  });

  for (const key of ["lostTicketPenalty", "overstayPenalty"]) {
    if (
      config[key] !== undefined &&
      (typeof config[key] !== "number" ||
        !Number.isFinite(config[key]) ||
        config[key] < 0)
    ) {
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
  return config
    ? {
        [vehicleType]: {
          ...config,
          tiers: config.tiers.map((tier) => ({ ...tier })),
        },
      }
    : undefined;
}

function clearFareOverrides(vehicleType) {
  if (vehicleType) fareOverrides.delete(vehicleType);
  else fareOverrides.clear();
  return { cleared: vehicleType ?? "all" };
}

function resetSimulationForTests() {
  stopSimulation();
  bots.clear();
  resetCounters();
  fareOverrides.clear();
}

/**
 * Adopt the cars that the seed left parked, so a fresh demo is alive before the
 * traffic generator is started. Each one heads to an exit gate within 5–20s.
 */
async function adoptDemoParkedCars({ minSeconds = 5, maxSeconds = 20 } = {}) {
  if (mongoose.connection.readyState !== 1) return { adopted: 0 };
  const transactions = await Transaction.find({
    status: "active",
    parkingEndTimestamp: null,
    ticketId: /^TKT-DEMO-1/,
  }).lean();

  const now = Date.now();
  let adopted = 0;
  for (const transaction of transactions) {
    const id = `demo-${transaction._id}`;
    if (bots.has(id)) continue;
    bots.set(id, {
      id,
      plateNumber: transaction.plateNumber,
      vehicleType: transaction.vehicleType,
      entryGateId: transaction.entryGateId,
      status: "parked",
      arrivedAt: new Date(transaction.entryTimestamp).getTime(),
      intendedStayHours:
        Math.round(
          simulatedHoursBetween(transaction.entryTimestamp, new Date(now)) * 100,
        ) / 100,
      lostTicket: false,
      ticketId: transaction.ticketId,
      transactionId: String(transaction._id),
      spotId: String(transaction.spotId),
      entryTimestamp: transaction.entryTimestamp,
      exitAtMs: now + (minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000,
    });
    adopted += 1;
  }

  if (adopted) ensureTimer();
  return { adopted };
}

module.exports = {
  startSimulation,
  setSimulationRate,
  stopSimulation,
  getSimulationState,
  arrivalsForWindow,
  getEntryQueue,
  getExitQueue,
  admitEntryBot,
  inspectExitBot,
  findBotExitTime,
  markBotSettled,
  setPromotionListener,
  adoptDemoParkedCars,
  setFareOverride,
  getFareOverride,
  clearFareOverrides,
  resetSimulationForTests,
  MAX_RATE_PER_MINUTE,
};
