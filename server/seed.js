"use strict";

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const User = require("./models/User");
const Spot = require("./models/Spot");
const Vehicle = require("./models/Vehicle");
const Transaction = require("./models/Transaction");
const AuditLog = require("./models/AuditLog");
const FareTierConfig = require("./models/FareTierConfig");
const SystemConfig = require("./models/SystemConfig");
const { hashPassword } = require("./utils/passwordUtils");
const { getMongoUri } = require("./utils/database");
const { calculateFare } = require("./services/fareService");
const { getOverstayThresholdHours } = require("./services/overstayConfigService");
const { realMillisecondsForSimulatedHours } = require("./utils/simulatedTime");
const { roundMoney } = require("./utils/money");

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || "password123";

// The four fixed gate accounts plus the single admin account described in the
// SRS role model. Local demo credentials only; never reuse these elsewhere.
const SEED_ACCOUNTS = [
  { username: "entry1", role: "operator", gateId: "Entry-1" },
  { username: "entry2", role: "operator", gateId: "Entry-2" },
  { username: "exit1", role: "operator", gateId: "Exit-1" },
  { username: "exit2", role: "operator", gateId: "Exit-2" },
  { username: "admin", role: "admin" },
];

const DEFAULT_SPOT_COUNTS = { "2W": 6, "4W": 10 };

const DEMO_ACTIVE_ENTRIES = [
  {
    ticketId: "TKT-DEMO-1001",
    plateNumber: "KA01AB1234",
    vehicleType: "2W",
    entryGateId: "Entry-1",
    entryOperator: "entry1",
    hoursAgo: 0.6,
  },
  {
    ticketId: "TKT-DEMO-1002",
    plateNumber: "KA02CD5678",
    vehicleType: "4W",
    entryGateId: "Entry-2",
    entryOperator: "entry2",
    hoursAgo: 1.2,
  },
  {
    ticketId: "TKT-DEMO-1003",
    plateNumber: "KA03EF9012",
    vehicleType: "4W",
    entryGateId: "Entry-1",
    entryOperator: "entry1",
    hoursAgo: 2.1,
  },
  {
    ticketId: "TKT-DEMO-1004",
    plateNumber: "KA04GH3456",
    vehicleType: "2W",
    entryGateId: "Entry-2",
    entryOperator: "entry2",
    hoursAgo: 2.8,
  },
  {
    ticketId: "TKT-DEMO-1005",
    plateNumber: "KA11JK7788",
    vehicleType: "4W",
    entryGateId: "Entry-2",
    entryOperator: "entry2",
    hoursAgo: 3.4,
  },
  {
    ticketId: "TKT-DEMO-1006",
    plateNumber: "KA12LM9900",
    vehicleType: "2W",
    entryGateId: "Entry-1",
    entryOperator: "entry1",
    hoursAgo: 4.2,
  },
];

// A realistic day of lot occupancy by hour (0-23), scaled per sample day.
// Peaks stay below the 16-spot capacity so history never reads over 100%.
const DEMO_OCCUPANCY_PATTERN = [
  8, 7, 6, 5, 5, 7, 9, 11, 13, 15, 16, 15, 13, 14, 16, 16, 15, 14, 12, 11, 10, 9, 9, 8,
];
// Oldest first; lower scales on quieter days keep the bars varied.
// Oldest first; today's scale is lower because the seed only reaches "now".
const DEMO_DAILY_SCALES = [0.92, 1.0, 0.84, 1.0, 0.92, 1.0, 0.4];

const round2 = (value) => Math.round(value * 100) / 100;

// Small deterministic PRNG so each seed produces the same shape of history.
function createRandom(seed = 20261115) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a believable week of completed parking sessions. A minute-by-minute
 * simulation keeps occupancy under the lot capacity, while entry/exit times and
 * fares vary enough for both admin charts to look like real operations.
 */
function buildCompletedDemoEntries(now) {
  const random = createRandom();
  const entries = [];
  let index = 0;

  DEMO_DAILY_SCALES.forEach((scale, dayIndex) => {
    const daysAgo = DEMO_DAILY_SCALES.length - 1 - dayIndex;
    const dayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo),
    );
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const maxExit = daysAgo === 0 ? new Date(now.getTime() - 60 * 1000) : dayEnd;
    if (maxExit <= dayStart) return;

    const active = [];
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const at = dayStart.getTime() + minute * 60 * 1000;
      if (at >= maxExit.getTime()) break;

      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (active[i] <= at) active.splice(i, 1);
      }

      const hour = Math.floor(minute / 60);
      const desired = Math.max(0, Math.round(DEMO_OCCUPANCY_PATTERN[hour] * scale));
      if (active.length >= desired) continue;
      // Turn cars over gradually instead of filling every empty slot at once.
      if (random() > 0.055) continue;

      const targetDuration = 7 + random() * 6;
      const exitMs = Math.min(at + targetDuration * 60 * 60 * 1000, maxExit.getTime());
      const durationHours = round2((exitMs - at) / (60 * 60 * 1000));
      if (durationHours < 2) continue;

      const vehicleType = random() < 0.58 ? "4W" : "2W";
      const lostTicket = random() < 0.08;
      const fareEntry = new Date(
        exitMs - realMillisecondsForSimulatedHours(durationHours),
      );
      const fare = roundMoney(
        calculateFare(fareEntry, new Date(exitMs), vehicleType, { lostTicket }),
      );
      const entryGateId = random() < 0.5 ? "Entry-1" : "Entry-2";
      const exitGateId = random() < 0.5 ? "Exit-1" : "Exit-2";
      const sequence = index;
      index += 1;
      entries.push({
        ticketId: `TKT-DEMO-H${String(sequence).padStart(4, "0")}`,
        plateNumber: `KA${String(10 + (sequence % 90)).padStart(2, "0")}HD${String(
          sequence,
        ).padStart(3, "0")}`,
        vehicleType,
        entryGateId,
        exitGateId,
        entryOperator: entryGateId === "Entry-1" ? "entry1" : "entry2",
        exitOperator: exitGateId === "Exit-1" ? "exit1" : "exit2",
        entryTimestamp: new Date(at),
        exitTimestamp: new Date(exitMs),
        durationHours,
        fare,
        lostTicket,
      });
      active.push(exitMs);
    }
  });

  return entries;
}

async function ensureSpots(zone, count) {
  const existing = await Spot.find({ zone }, { spotNumber: 1 }).lean();
  const taken = new Set(existing.map(({ spotNumber }) => spotNumber));
  const missing = [];
  for (let n = 1; missing.length < count - existing.length; n += 1) {
    const spotNumber = `${zone}-${String(n).padStart(3, "0")}`;
    if (!taken.has(spotNumber)) missing.push(spotNumber);
  }
  if (missing.length) {
    await Spot.insertMany(missing.map((spotNumber) => ({ spotNumber, zone })));
  }
  return Spot.countDocuments({ zone });
}

async function removeOldDemoData() {
  const oldDemo = await Transaction.find(
    { ticketId: { $regex: "^TKT-DEMO-" } },
    { spotId: 1, status: 1 },
  ).lean();
  const oldSpotIds = oldDemo
    .filter((transaction) => transaction.status === "active")
    .map((transaction) => transaction.spotId);

  await Transaction.deleteMany({ ticketId: { $regex: "^TKT-DEMO-" } });

  if (oldSpotIds.length) {
    const stillActive = await Transaction.find(
      { status: "active", spotId: { $in: oldSpotIds } },
      { spotId: 1 },
    ).lean();
    const stillReserved = new Set(
      stillActive.map((transaction) => String(transaction.spotId)),
    );
    const spotsToFree = oldSpotIds.filter((spotId) => !stillReserved.has(String(spotId)));
    if (spotsToFree.length) {
      await Spot.updateMany(
        { _id: { $in: spotsToFree }, status: "reserved" },
        { $set: { status: "free", currentTransactionId: null } },
      );
    }
  }

  await AuditLog.collection.deleteMany({
    "details.ticketId": { $regex: "^TKT-DEMO-" },
  });
}

async function upsertDemoVehicle(plateNumber, vehicleType) {
  await Vehicle.findOneAndUpdate(
    { plateNumber },
    {
      $set: { vehicleType },
      $setOnInsert: { plateNumber },
    },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

async function seedDemoData(users, now, overstayThresholdHours) {
  let activeCreated = 0;
  let completedCreated = 0;
  const completedEntries = buildCompletedDemoEntries(now);

  for (const demo of DEMO_ACTIVE_ENTRIES) {
    const alreadyParked = await Transaction.findOne({
      plateNumber: demo.plateNumber,
      status: "active",
    }).lean();
    if (alreadyParked) continue;

    const spot = await Spot.findOneAndUpdate(
      { zone: demo.vehicleType, status: "free" },
      { $set: { status: "reserved" } },
      { sort: { spotNumber: 1 }, returnDocument: "after" },
    );
    if (!spot) continue;

    const entryTimestamp = new Date(
      now.getTime() - realMillisecondsForSimulatedHours(demo.hoursAgo),
    );
    await upsertDemoVehicle(demo.plateNumber, demo.vehicleType);
    const transaction = await Transaction.create({
      ticketId: demo.ticketId,
      plateNumber: demo.plateNumber,
      vehicleType: demo.vehicleType,
      spotId: spot._id,
      entryGateId: demo.entryGateId,
      entryOperatorId: users.get(demo.entryOperator)._id,
      entryTimestamp,
      status: "active",
      isOverstay: demo.hoursAgo >= overstayThresholdHours,
    });
    await Spot.updateOne(
      { _id: spot._id },
      { $set: { currentTransactionId: transaction._id } },
    );
    activeCreated += 1;
  }

  for (const demo of completedEntries) {
    const spot = await Spot.findOne({ zone: demo.vehicleType }).lean();
    if (!spot) continue;

    await upsertDemoVehicle(demo.plateNumber, demo.vehicleType);
    await Transaction.create({
      ticketId: demo.ticketId,
      plateNumber: demo.plateNumber,
      vehicleType: demo.vehicleType,
      spotId: spot._id,
      entryGateId: demo.entryGateId,
      entryOperatorId: users.get(demo.entryOperator)._id,
      entryTimestamp: demo.entryTimestamp,
      exitGateId: demo.exitGateId,
      exitOperatorId: users.get(demo.exitOperator)._id,
      exitTimestamp: demo.exitTimestamp,
      durationSeconds: demo.durationHours * 3600,
      fare: demo.fare,
      penaltyApplied: demo.lostTicket,
      status: "completed",
      isOverstay: false,
    });
    completedCreated += 1;
  }

  const auditEntries = [];
  for (const demo of DEMO_ACTIVE_ENTRIES.slice(0, activeCreated)) {
    auditEntries.push({
      action: "VEHICLE_ENTRY",
      actorId: users.get(demo.entryOperator)._id,
      actorRole: "operator",
      details: {
        ticketId: demo.ticketId,
        plateNumber: demo.plateNumber,
        vehicleType: demo.vehicleType,
        gateId: demo.entryGateId,
      },
    });
  }
  for (const demo of completedEntries.slice(0, completedCreated)) {
    auditEntries.push({
      action: "VEHICLE_ENTRY",
      actorId: users.get(demo.entryOperator)._id,
      actorRole: "operator",
      details: {
        ticketId: demo.ticketId,
        plateNumber: demo.plateNumber,
        vehicleType: demo.vehicleType,
        gateId: demo.entryGateId,
      },
    });
    auditEntries.push({
      action: "VEHICLE_EXIT",
      actorId: users.get(demo.exitOperator)._id,
      actorRole: "operator",
      details: {
        ticketId: demo.ticketId,
        plateNumber: demo.plateNumber,
        gateId: demo.exitGateId,
      },
    });
  }
  if (auditEntries.length) await AuditLog.insertMany(auditEntries);

  return {
    active: activeCreated,
    completed: completedCreated,
    auditEntries: auditEntries.length,
  };
}

/**
 * Demo launches should not inherit yesterday's parked cars or revenue. This
 * wipes the operational collections and lets the seed recreate a clean, average
 * lot. Accounts are kept so credentials stay stable.
 */
async function resetDemoState() {
  await Promise.all([
    Transaction.deleteMany({}),
    // AuditLog blocks deleteMany at the model layer; a demo reset is the one
    // place that intentionally bypasses it.
    AuditLog.collection.deleteMany({}),
    Vehicle.deleteMany({}),
    Spot.deleteMany({}),
    FareTierConfig.deleteMany({}),
    SystemConfig.deleteMany({}),
  ]);
}

async function seedDatabase({
  password = DEFAULT_PASSWORD,
  includeDemo = true,
  resetDemo = process.env.SEED_RESET_DEMO === "true",
} = {}) {
  const passwordHash = await hashPassword(password);
  const users = new Map();

  for (const { username, role, gateId } of SEED_ACCOUNTS) {
    const set = {
      passwordHash,
      role,
      failedLoginAttempts: 0,
      isLocked: false,
    };
    const unset = { lockUntil: 1 };
    if (gateId) set.gateId = gateId;
    else unset.gateId = 1;

    const user = await User.findOneAndUpdate(
      { username },
      { $set: set, $unset: unset },
      {
        upsert: true,
        returnDocument: "after",
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    users.set(username, user);
  }

  if (resetDemo) await resetDemoState();

  const spotCounts = {};
  for (const [zone, count] of Object.entries(DEFAULT_SPOT_COUNTS)) {
    spotCounts[zone] = await ensureSpots(zone, count);
  }

  await removeOldDemoData();

  let demo = { active: 0, completed: 0, auditEntries: 0 };
  if (includeDemo) {
    demo = await seedDemoData(users, new Date(), await getOverstayThresholdHours());
  }

  return { accounts: SEED_ACCOUNTS.length, spotCounts, demo, resetDemo };
}

async function main() {
  await mongoose.connect(getMongoUri());
  const result = await seedDatabase({
    includeDemo: process.env.SEED_DEMO_DATA !== "false",
  });
  if (process.env.SEED_RESET_DEMO === "true") {
    console.log(
      "Operational demo data reset (transactions, audit log, vehicles, spots).",
    );
  }
  console.log(
    `Seeded ${result.accounts} accounts and spots: ${result.spotCounts["2W"]} 2W, ${result.spotCounts["4W"]} 4W`,
  );
  if (process.env.SEED_DEMO_DATA === "false") {
    console.log("Sample data disabled (SEED_DEMO_DATA=false).");
  } else {
    console.log(
      `Sample data: ${result.demo.active} active vehicles, ${result.demo.completed} completed transactions, ${result.demo.auditEntries} audit entries`,
    );
  }
  console.log(`Local demo password: ${DEFAULT_PASSWORD}`);
}

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (error) => {
      console.error("Seed failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = {
  seedDatabase,
  SEED_ACCOUNTS,
  DEFAULT_SPOT_COUNTS,
  DEMO_ACTIVE_ENTRIES,
  DEMO_DAILY_SCALES,
  buildCompletedDemoEntries,
};
