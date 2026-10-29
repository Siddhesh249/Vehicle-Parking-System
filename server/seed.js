"use strict";

require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");
const User = require("./models/User");
const Spot = require("./models/Spot");
const { hashPassword } = require("./utils/passwordUtils");
const { getMongoUri } = require("./utils/database");

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

async function seedDatabase({ password = DEFAULT_PASSWORD } = {}) {
  const passwordHash = await hashPassword(password);

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

    await User.findOneAndUpdate(
      { username },
      { $set: set, $unset: unset },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
  }

  const spotCounts = {};
  for (const [zone, count] of Object.entries(DEFAULT_SPOT_COUNTS)) {
    spotCounts[zone] = await ensureSpots(zone, count);
  }

  return { accounts: SEED_ACCOUNTS.length, spotCounts };
}

async function main() {
  await mongoose.connect(getMongoUri());
  const result = await seedDatabase();
  console.log(
    `Seeded ${result.accounts} accounts and spots: ${result.spotCounts["2W"]} 2W, ${result.spotCounts["4W"]} 4W`,
  );
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

module.exports = { seedDatabase, SEED_ACCOUNTS, DEFAULT_SPOT_COUNTS };
