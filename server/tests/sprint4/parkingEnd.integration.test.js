/**
 * Refinement: parking time and billing stop when a car joins the exit queue.
 * The freed spot may already be reused, so a late settlement must not touch it.
 */
"use strict";

const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const Spot = require("../../models/Spot");
const Transaction = require("../../models/Transaction");
const { processExit, quoteExit } = require("../../services/fareExitService");
const { listOverstays } = require("../../services/overstayService");

jest.setTimeout(30000);

describe("parking ends when the car joins the exit queue", () => {
  let mongo;
  const operatorId = new mongoose.Types.ObjectId().toString();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  async function parkedCar({ plateNumber, entryMsAgo, parkingEndMsAgo }) {
    const spot = await Spot.create({
      spotNumber: `4W-${plateNumber.slice(-3)}`,
      zone: "4W",
      status: "reserved",
    });
    const entryTimestamp = new Date(Date.now() - entryMsAgo);
    const transaction = await Transaction.create({
      ticketId: `TKT-${plateNumber}`,
      plateNumber,
      vehicleType: "4W",
      spotId: spot._id,
      entryGateId: "Entry-1",
      entryOperatorId: operatorId,
      entryTimestamp,
      status: "active",
      parkingEndTimestamp: new Date(Date.now() - parkingEndMsAgo),
    });
    await Spot.updateOne(
      { _id: spot._id },
      { $set: { currentTransactionId: transaction._id } },
    );
    return { spot, transaction };
  }

  test("bills only up to the exit-queue time, not to when payment happens", async () => {
    // 60s ago = 12 simulated hours at 5s/hour, but parking ended after 10s (2h).
    const { spot, transaction } = await parkedCar({
      plateNumber: "KA20CAP001",
      entryMsAgo: 60000,
      parkingEndMsAgo: 50000,
    });

    const quote = await quoteExit({ ticketId: transaction.ticketId });
    expect(quote.durationHours).toBeCloseTo(2, 1);
    expect(quote.fare).toBeCloseTo(20, 2);

    const receipt = await processExit({
      ticketId: transaction.ticketId,
      gateId: "Exit-1",
      operatorId,
      exitTimestamp: new Date(),
    });

    expect(receipt.durationHours).toBeCloseTo(2, 1);
    expect(receipt.fare).toBeCloseTo(20, 2);
    expect(receipt.exitTimestamp).toEqual(transaction.parkingEndTimestamp);

    const freed = await Spot.findById(spot._id).lean();
    expect(freed.status).toBe("free");
    expect(freed.currentTransactionId).toBeNull();
  });

  test("does not free a spot that has since been assigned to a newer car", async () => {
    const { spot, transaction } = await parkedCar({
      plateNumber: "KA20CAP002",
      entryMsAgo: 20000,
      parkingEndMsAgo: 15000,
    });
    const newerTransactionId = new mongoose.Types.ObjectId();
    await Spot.updateOne(
      { _id: spot._id },
      { $set: { status: "reserved", currentTransactionId: newerTransactionId } },
    );

    await processExit({
      ticketId: transaction.ticketId,
      gateId: "Exit-1",
      operatorId,
    });

    const current = await Spot.findById(spot._id).lean();
    expect(current.status).toBe("reserved");
    expect(String(current.currentTransactionId)).toBe(String(newerTransactionId));
  });

  test("excludes cars already waiting at an exit gate from the overstay feed", async () => {
    await parkedCar({
      plateNumber: "KA20CAP003",
      entryMsAgo: 120000,
      parkingEndMsAgo: 90000,
    });

    const overstays = await listOverstays();
    expect(overstays.find((row) => row.plateNumber === "KA20CAP003")).toBeUndefined();
  });
});
