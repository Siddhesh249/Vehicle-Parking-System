/** Sprint 2 — T1: allocation service contract (VPS-F-010..014). */
"use strict";

jest.mock("../models/Spot", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../models/Vehicle", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../models/Transaction", () => ({ create: jest.fn() }));

const Spot = require("../models/Spot");
const Vehicle = require("../models/Vehicle");
const Transaction = require("../models/Transaction");
const { allocateSpot } = require("../services/allocationService");

const input = (overrides = {}) => ({
  plateNumber: "ka01ab1234",
  vehicleType: "4W",
  gateId: "Entry-1",
  operatorId: "operator-1",
  ...overrides,
  test("uses a server-received timestamp instead of a client-supplied timestamp", async () => {
    const receivedAt = new Date("2026-10-23T12:00:00.000Z");
    jest.useFakeTimers().setSystemTime(receivedAt);
    Spot.findOneAndUpdate.mockResolvedValue({ _id: "spot-3", zone: "4W" });
    Vehicle.findOneAndUpdate.mockResolvedValue({ plateNumber: "KA01AB1234", vehicleType: "4W" });
    Transaction.create.mockResolvedValue({ _id: "tx-3", ticketId: "ticket-3" });

    try {
      const result = await allocateSpot(input({
        entryTimestamp: new Date("2000-01-01T00:00:00.000Z"),
      }));

      expect(Transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ entryTimestamp: receivedAt }),
      );
      expect(result.entryTimestamp).toEqual(receivedAt);
    } finally {
      jest.useRealTimers();
    }
  });

});

describe("allocateSpot", () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([["2W"], ["4W"]])("atomically claims only a free spot in the %s zone", async (vehicleType) => {
    const claimedSpot = { _id: "spot-1", spotNumber: "A1", zone: vehicleType };
    Spot.findOneAndUpdate.mockResolvedValue(claimedSpot);
    Vehicle.findOneAndUpdate.mockResolvedValue({ plateNumber: "KA01AB1234", vehicleType });
    Transaction.create.mockResolvedValue({ _id: "tx-1", ticketId: "ticket-1" });

    const result = await allocateSpot(input({ vehicleType }));

    expect(Spot.findOneAndUpdate).toHaveBeenCalledWith(
      { zone: vehicleType, status: "free" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "reserved" }) }),
      expect.objectContaining({ new: true }),
    );
    expect(result).toEqual(expect.objectContaining({
      ticketId: expect.any(String), spotId: "spot-1", zone: vehicleType, qrPayload: expect.any(String),
    }));
    expect(Transaction.create).toHaveBeenCalledWith(expect.objectContaining({
      plateNumber: "KA01AB1234", vehicleType, spotId: "spot-1", entryGateId: "Entry-1", entryOperatorId: "operator-1",
    }));
  });

  test("returns a lot-full error and creates no transaction when no free matching spot exists", async () => {
    Spot.findOneAndUpdate.mockResolvedValue(null);

    await expect(allocateSpot(input({ vehicleType: "2W" }))).rejects.toMatchObject({ code: "LOT_FULL", statusCode: 409 });
    expect(Transaction.create).not.toHaveBeenCalled();
  });

  test("normalizes the plate number and persists the vehicle before creating its parking transaction", async () => {
    Spot.findOneAndUpdate.mockResolvedValue({ _id: "spot-2", zone: "2W" });
    Vehicle.findOneAndUpdate.mockResolvedValue({ plateNumber: "KA01AB1234", vehicleType: "2W" });
    Transaction.create.mockResolvedValue({ _id: "tx-2", ticketId: "ticket-2" });

    await allocateSpot(input({ vehicleType: "2W" }));

    expect(Vehicle.findOneAndUpdate).toHaveBeenCalledWith(
      { plateNumber: "KA01AB1234" },
      expect.objectContaining({ $set: { vehicleType: "2W" }, $setOnInsert: { plateNumber: "KA01AB1234" } }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  test("processes same-zone allocations in call order and claims a different spot each time", async () => {
    Spot.findOneAndUpdate
      .mockResolvedValueOnce({ _id: "spot-1", zone: "4W" })
      .mockResolvedValueOnce({ _id: "spot-2", zone: "4W" });
    Vehicle.findOneAndUpdate.mockResolvedValue({ plateNumber: "KA01AB1234", vehicleType: "4W" });
    Transaction.create
      .mockResolvedValueOnce({ _id: "tx-1", ticketId: "ticket-1" })
      .mockResolvedValueOnce({ _id: "tx-2", ticketId: "ticket-2" });

    const first = await allocateSpot(input());
    const second = await allocateSpot(input({ plateNumber: "ka02cd5678", gateId: "Entry-2" }));

    expect(first.spotId).toBe("spot-1");
    expect(second.spotId).toBe("spot-2");
    expect(Spot.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});
