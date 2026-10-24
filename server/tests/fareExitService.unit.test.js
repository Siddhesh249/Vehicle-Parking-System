/** Sprint 2 — T2: ticket/plate lookup and exit settlement (VPS-F-030..037). */
"use strict";

jest.mock("../models/Transaction", () => ({
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
}));
jest.mock("../models/Spot", () => ({ findOneAndUpdate: jest.fn() }));
jest.mock("../services/fareService", () => ({ calculateFareDetails: jest.fn() }));
jest.mock("../services/fareConfigService", () => ({ getFareConfig: jest.fn() }));

const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFareDetails } = require("../services/fareService");
const { getFareConfig } = require("../services/fareConfigService");
const {
  lookupByTicket,
  searchByPlate,
  processExit,
} = require("../services/fareExitService");

function activeTransaction(overrides = {}) {
  return {
    _id: "tx-1",
    ticketId: "TKT-1",
    plateNumber: "KA01AB1234",
    vehicleType: "4W",
    spotId: "spot-1",
    entryGateId: "Entry-1",
    entryOperatorId: "entry-op",
    entryTimestamp: new Date("2026-10-02T10:00:00.000Z"),
    status: "active",
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Fare/Exit Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Spot.findOneAndUpdate.mockResolvedValue({ _id: "spot-1", status: "free" });
    getFareConfig.mockResolvedValue(undefined);
  });

  test("looks up an active transaction by ticket ID", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);

    await expect(lookupByTicket("TKT-1")).resolves.toBe(transaction);
    expect(Transaction.findOne).toHaveBeenCalledWith({
      ticketId: "TKT-1",
      status: "active",
    });
  });

  test("normalizes a plate and returns only its active transaction(s)", async () => {
    const transactions = [activeTransaction()];
    Transaction.findOne.mockResolvedValue(transactions[0]);

    await expect(searchByPlate(" ka01ab1234 ")).resolves.toEqual(transactions);
    expect(Transaction.findOne).toHaveBeenCalledWith({
      plateNumber: "KA01AB1234",
      status: "active",
    });
  });

  test("settles a ticket exit, computes exact duration, frees the spot, and stores receipt details", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);
    calculateFareDetails.mockReturnValue({ baseFare: 30, total: 30 });
    const exitTimestamp = new Date("2026-10-02T11:30:00.000Z");
    Transaction.findOneAndUpdate.mockResolvedValue({
      ...transaction,
      status: "completed",
    });

    const receipt = await processExit({
      ticketId: "TKT-1",
      gateId: "Exit-1",
      operatorId: "exit-op",
      exitTimestamp,
    });

    expect(calculateFareDetails).toHaveBeenCalledWith(
      transaction.entryTimestamp,
      exitTimestamp,
      "4W",
      { lostTicket: false },
      undefined,
    );
    expect(Transaction.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "tx-1", status: "active" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "completed", fare: 30 }),
      }),
      expect.objectContaining({ new: true }),
    );
    expect(Spot.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "spot-1", status: "reserved" },
      { $set: { status: "free", currentTransactionId: null } },
      { new: true },
    );
    expect(receipt).toEqual(
      expect.objectContaining({
        fare: 30,
        durationSeconds: 5400,
        penaltyApplied: false,
        breakdown: { baseFare: 30 },
        receiptId: expect.any(String),
      }),
    );
  });

  test("uses plate fallback and applies the lost-ticket penalty", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);
    calculateFareDetails.mockReturnValue({
      baseFare: 30,
      lostTicketPenalty: 100,
      total: 130,
    });
    Transaction.findOneAndUpdate.mockResolvedValue({
      ...transaction,
      status: "completed",
    });

    const receipt = await processExit({
      plateNumber: "ka01ab1234",
      gateId: "Exit-2",
      operatorId: "exit-op",
      exitTimestamp: new Date("2026-10-02T12:00:00Z"),
    });

    expect(Transaction.findOne).toHaveBeenCalledWith({
      plateNumber: "KA01AB1234",
      status: "active",
    });
    expect(calculateFareDetails).toHaveBeenCalledWith(
      transaction.entryTimestamp,
      expect.any(Date),
      "4W",
      { lostTicket: true },
      undefined,
    );
    expect(receipt.penaltyApplied).toBe(true);
    expect(receipt.breakdown).toEqual({ baseFare: 30, lostTicketPenalty: 100 });
  });

  test("rejects when neither ticket ID nor plate number identifies an active vehicle", async () => {
    Transaction.findOne.mockResolvedValue(null);

    await expect(lookupByTicket("missing")).rejects.toMatchObject({
      code: "VEHICLE_NOT_FOUND",
      statusCode: 404,
    });
  });

  test("does not release a spot or charge again after the transaction has exited", async () => {
    Transaction.findOne.mockResolvedValue(null);

    await expect(
      processExit({ ticketId: "TKT-1", gateId: "Exit-1", operatorId: "exit-op" }),
    ).rejects.toMatchObject({ code: "ALREADY_EXITED", statusCode: 409 });
    expect(Spot.findOneAndUpdate).not.toHaveBeenCalled();
    expect(calculateFareDetails).not.toHaveBeenCalled();
  });

  test("rejects a concurrent settlement that has already changed the transaction status", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);
    Transaction.findOneAndUpdate.mockResolvedValue(null);
    calculateFareDetails.mockReturnValue({ baseFare: 30, total: 30 });

    await expect(
      processExit({ ticketId: "TKT-1", gateId: "Exit-1", operatorId: "exit-op" }),
    ).rejects.toMatchObject({ code: "ALREADY_EXITED", statusCode: 409 });
    expect(Spot.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
