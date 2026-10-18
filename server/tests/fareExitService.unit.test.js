/** Sprint 2 — T2: ticket/plate lookup and exit settlement (VPS-F-030..037). */
"use strict";

jest.mock("../models/Transaction", () => ({ findOne: jest.fn() }));
jest.mock("../models/Spot", () => ({ findByIdAndUpdate: jest.fn() }));
jest.mock("../services/fareService", () => ({ calculateFare: jest.fn() }));

const Transaction = require("../models/Transaction");
const Spot = require("../models/Spot");
const { calculateFare } = require("../services/fareService");
const { lookupByTicket, searchByPlate, processExit } = require("../services/fareExitService");

function activeTransaction(overrides = {}) {
  return {
    _id: "tx-1", ticketId: "TKT-1", plateNumber: "KA01AB1234", vehicleType: "4W",
    spotId: "spot-1", entryGateId: "Entry-1", entryOperatorId: "entry-op",
    entryTimestamp: new Date("2026-10-02T10:00:00.000Z"), status: "active", save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Fare/Exit Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Spot.findByIdAndUpdate.mockResolvedValue({ _id: "spot-1", status: "free" });
  });

  test("looks up an active transaction by ticket ID", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);

    await expect(lookupByTicket("TKT-1")).resolves.toBe(transaction);
    expect(Transaction.findOne).toHaveBeenCalledWith({ ticketId: "TKT-1", status: "active" });
  });

  test("normalizes a plate and returns only its active transaction(s)", async () => {
    const transactions = [activeTransaction()];
    Transaction.findOne.mockResolvedValue(transactions[0]);

    await expect(searchByPlate(" ka01ab1234 ")).resolves.toEqual(transactions);
    expect(Transaction.findOne).toHaveBeenCalledWith({ plateNumber: "KA01AB1234", status: "active" });
  });

  test("settles a ticket exit, computes exact duration, frees the spot, and stores receipt details", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);
    calculateFare.mockReturnValue(30);
    const exitTimestamp = new Date("2026-10-02T11:30:00.000Z");

    const receipt = await processExit({ ticketId: "TKT-1", gateId: "Exit-1", operatorId: "exit-op", exitTimestamp });

    expect(calculateFare).toHaveBeenCalledWith(transaction.entryTimestamp, exitTimestamp, "4W", { lostTicket: false });
    expect(transaction).toEqual(expect.objectContaining({
      status: "completed", exitGateId: "Exit-1", exitOperatorId: "exit-op", exitTimestamp,
      durationSeconds: 5400, fare: 30, penaltyApplied: false,
    }));
    expect(transaction.save).toHaveBeenCalledTimes(1);
    expect(Spot.findByIdAndUpdate).toHaveBeenCalledWith("spot-1", {
      $set: { status: "free", currentTransactionId: null },
    });
    expect(receipt).toEqual(expect.objectContaining({ fare: 30, durationSeconds: 5400, penaltyApplied: false, receiptId: expect.any(String) }));
  });

  test("uses plate fallback and applies the lost-ticket penalty", async () => {
    const transaction = activeTransaction();
    Transaction.findOne.mockResolvedValue(transaction);
    calculateFare.mockReturnValue(130);

    const receipt = await processExit({ plateNumber: "ka01ab1234", gateId: "Exit-2", operatorId: "exit-op", exitTimestamp: new Date("2026-10-02T12:00:00Z") });

    expect(Transaction.findOne).toHaveBeenCalledWith({ plateNumber: "KA01AB1234", status: "active" });
    expect(calculateFare).toHaveBeenCalledWith(transaction.entryTimestamp, expect.any(Date), "4W", { lostTicket: true });
    expect(receipt.penaltyApplied).toBe(true);
  });

  test("rejects when neither ticket ID nor plate number identifies an active vehicle", async () => {
    Transaction.findOne.mockResolvedValue(null);

    await expect(lookupByTicket("missing")).rejects.toMatchObject({ code: "VEHICLE_NOT_FOUND", statusCode: 404 });
  });

  test("does not release a spot or charge again after the transaction has exited", async () => {
    Transaction.findOne.mockResolvedValue(null);

    await expect(processExit({ ticketId: "TKT-1", gateId: "Exit-1", operatorId: "exit-op" }))
      .rejects.toMatchObject({ code: "ALREADY_EXITED", statusCode: 409 });
    expect(Spot.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(calculateFare).not.toHaveBeenCalled();
  });
});
