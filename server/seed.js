"use strict";

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const User = require("./models/User");
const Spot = require("./models/Spot");
const Vehicle = require("./models/Vehicle");
const Transaction = require("./models/Transaction");
const AuditLog = require("./models/AuditLog");
const { hashPassword } = require("./utils/passwordUtils");
const { getMongoUri } = require("./utils/database");
const { calculateFare } = require("./services/fareService");
const { getOverstayThresholdHours } = require("./services/overstayConfigService");
const { realMillisecondsForSimulatedHours } = require("./utils/simulatedTime");

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
    hoursAgo: 2.2,
  },
  {
    ticketId: "TKT-DEMO-1002",
    plateNumber: "KA02CD5678",
    vehicleType: "4W",
    entryGateId: "Entry-2",
    entryOperator: "entry2",
    hoursAgo: 3.7,
  },
  {
    ticketId: "TKT-DEMO-1003",
    plateNumber: "KA03EF9012",
    vehicleType: "4W",
    entryGateId: "Entry-1",
    entryOperator: "entry1",
    hoursAgo: 6.5,
  },
  {
    ticketId: "TKT-DEMO-1004",
    plateNumber: "KA04GH3456",
    vehicleType: "2W",
    entryGateId: "Entry-2",
    entryOperator: "entry2",
    hoursAgo: 7.8,
  },
];

const DEMO_COMPLETED_ENTRIES = [
  {
    ticketId: "TKT-DEMO-2001",
    plateNumber: "KA05DEMO01",
    vehicleType: "4W",
    entryGateId: "Entry-1",
    exitGateId: "Exit-1",
    entryOperator: "entry1",
    exitOperator: "exit1",
    daysAgo: 6,
    durationHours: 3.5,
    lostTicket: false,
  },
  {
    ticketId: "TKT-DEMO-2002",
    plateNumber: "KA06DEMO02",
    vehicleType: "2W",
    entryGateId: "Entry-2",
    exitGateId: "Exit-2",
    entryOperator: "entry2",
    exitOperator: "exit2",
    daysAgo: 5,
    durationHours: 4.5,
    lostTicket: true,
  },
  {
    ticketId: "TKT-DEMO-2003",
    plateNumber: "KA07DEMO03",
    vehicleType: "4W",
    entryGateId: "Entry-1",
    exitGateId: "Exit-2",
    entryOperator: "entry1",
    exitOperator: "exit2",
    daysAgo: 4,
    durationHours: 7.2,
    lostTicket: false,
  },
  {
    ticketId: "TKT-DEMO-2004",
    plateNumber: "KA08DEMO04",
    vehicleType: "2W",
    entryGateId: "Entry-2",
    exitGateId: "Exit-1",
    entryOperator: "entry2",
    exitOperator: "exit1",
    daysAgo: 3,
    durationHours: 2.4,
    lostTicket: false,
  },
  {
    ticketId: "TKT-DEMO-2005",
    plateNumber: "KA09DEMO05",
    vehicleType: "4W",
    entryGateId: "Entry-1",
    exitGateId: "Exit-1",
    entryOperator: "entry1",
    exitOperator: "exit1",
    daysAgo: 1,
    durationHours: 5.6,
    lostTicket: false,
  },
  {
    ticketId: "TKT-DEMO-2006",
    plateNumber: "KA10DEMO06",
    vehicleType: "2W",
    entryGateId: "Entry-2",
    exitGateId: "Exit-2",
    entryOperator: "entry2",
    exitOperator: "exit2",
    daysAgo: 0,
    durationHours: 1.8,
    lostTicket: true,
  },
];

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

  for (const demo of DEMO_COMPLETED_ENTRIES) {
    const spot = await Spot.findOne({ zone: demo.vehicleType }).lean();
    if (!spot) continue;

    const exitTimestamp = new Date(now.getTime() - demo.daysAgo * 24 * 60 * 60 * 1000);
    const entryTimestamp = new Date(
      exitTimestamp.getTime() - realMillisecondsForSimulatedHours(demo.durationHours),
    );
    const fare = calculateFare(entryTimestamp, exitTimestamp, demo.vehicleType, {
      lostTicket: demo.lostTicket,
    });

    await upsertDemoVehicle(demo.plateNumber, demo.vehicleType);
    await Transaction.create({
      ticketId: demo.ticketId,
      plateNumber: demo.plateNumber,
      vehicleType: demo.vehicleType,
      spotId: spot._id,
      entryGateId: demo.entryGateId,
      entryOperatorId: users.get(demo.entryOperator)._id,
      entryTimestamp,
      exitGateId: demo.exitGateId,
      exitOperatorId: users.get(demo.exitOperator)._id,
      exitTimestamp,
      durationSeconds: demo.durationHours * 3600,
      fare,
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
  for (const demo of DEMO_COMPLETED_ENTRIES.slice(0, completedCreated)) {
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

async function seedDatabase({ password = DEFAULT_PASSWORD, includeDemo = true } = {}) {
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

  const spotCounts = {};
  for (const [zone, count] of Object.entries(DEFAULT_SPOT_COUNTS)) {
    spotCounts[zone] = await ensureSpots(zone, count);
  }

  await removeOldDemoData();

  let demo = { active: 0, completed: 0, auditEntries: 0 };
  if (includeDemo) {
    demo = await seedDemoData(users, new Date(), await getOverstayThresholdHours());
  }

  return { accounts: SEED_ACCOUNTS.length, spotCounts, demo };
}

async function main() {
  await mongoose.connect(getMongoUri());
  const result = await seedDatabase({
    includeDemo: process.env.SEED_DEMO_DATA !== "false",
  });
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
  DEMO_COMPLETED_ENTRIES,
};
