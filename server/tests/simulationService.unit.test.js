"use strict";

const simulationService = require("../services/simulationService");
const { allocateSpot } = require("../services/allocationService");

jest.mock("../services/allocationService", () => ({ allocateSpot: jest.fn() }));

describe("Sprint 4 T2 simulation backend", () => {
  afterEach(() => {
    jest.useRealTimers();
    simulationService.resetSimulationForTests();
    jest.clearAllMocks();
  });

  test("exposes generator controls and rate calculation", () => {
    expect(simulationService).toEqual(
      expect.objectContaining({
        startSimulation: expect.any(Function),
        stopSimulation: expect.any(Function),
        getSimulationState: expect.any(Function),
        arrivalsForWindow: expect.any(Function),
      }),
    );
  });

  test.each([
    [60, 1000, 1],
    [60, 5000, 5],
    [120, 2000, 4],
    [6, 60000, 6],
    [600, 250, 2],
  ])("calculates %i arrivals over %ims", (ratePerMinute, elapsedMs, expected) => {
    expect(simulationService.arrivalsForWindow({ ratePerMinute, elapsedMs })).toBe(
      expected,
    );
  });

  test("rejects invalid rates and elapsed windows", () => {
    expect(() =>
      simulationService.arrivalsForWindow({ ratePerMinute: -1, elapsedMs: 1000 }),
    ).toThrow();
    expect(() =>
      simulationService.arrivalsForWindow({ ratePerMinute: "fast", elapsedMs: 1000 }),
    ).toThrow();
    expect(() =>
      simulationService.arrivalsForWindow({ ratePerMinute: 60, elapsedMs: -1 }),
    ).toThrow();
  });

  test("starts and stops the generator with the requested runtime rate", () => {
    expect(simulationService.getSimulationState().running).toBe(false);
    expect(simulationService.startSimulation({ ratePerMinute: 60 })).toEqual({
      status: "running",
    });
    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({ running: true, ratePerMinute: 60 }),
    );
    expect(simulationService.stopSimulation()).toEqual({ status: "stopped" });
    expect(simulationService.getSimulationState().running).toBe(false);
  });

  test("counts full-lot arrivals once instead of retrying missed arrivals", async () => {
    jest.useFakeTimers();
    const fullLot = Object.assign(new Error("lot full"), { code: "LOT_FULL" });
    allocateSpot.mockRejectedValue(fullLot);

    simulationService.startSimulation({ ratePerMinute: 60 });
    await jest.advanceTimersByTimeAsync(1000);

    const gateId = ["Entry-1", "Entry-2"].find(
      (gate) => simulationService.getEntryQueue(gate).bot,
    );
    const { botId } = simulationService.getEntryQueue(gateId).bot;
    await expect(
      simulationService.admitEntryBot({ botId, gateId, operatorId: "operator-1" }),
    ).rejects.toMatchObject({ code: "LOT_FULL" });

    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({
        generatedArrivals: 1,
        successfulAllocations: 0,
        fullLotArrivals: 1,
        waitingEntry: 0,
      }),
    );

    await jest.advanceTimersByTimeAsync(1000);
    expect(allocateSpot).toHaveBeenCalledTimes(1);
    expect(simulationService.getSimulationState().generatedArrivals).toBe(2);
  });

  test("a parked bot moves to an exit queue when its stay elapses", async () => {
    jest.useFakeTimers();
    allocateSpot.mockResolvedValue({
      ticketId: "TKT-SIM-2",
      transactionId: "transaction-2",
      spotId: "spot-2",
      spotNumber: "4W-001",
      zone: "4W",
      entryTimestamp: new Date(),
    });
    simulationService.startSimulation({ ratePerMinute: 60 });
    await jest.advanceTimersByTimeAsync(1000);

    const gateId = ["Entry-1", "Entry-2"].find(
      (gate) => simulationService.getEntryQueue(gate).bot,
    );
    const bot = simulationService.getEntryQueue(gateId).bot;
    const ticket = await simulationService.admitEntryBot({
      botId: bot.botId,
      gateId,
      operatorId: "operator-1",
    });
    expect(simulationService.getSimulationState().parked).toBe(1);

    // Longest demo stay is below 12 simulated hours (60 real seconds).
    await jest.advanceTimersByTimeAsync(61000);

    const exitGate = ["Exit-1", "Exit-2"].find(
      (gate) => simulationService.getExitQueue(gate).bot,
    );
    const queued = simulationService.getExitQueue(exitGate);
    expect(queued.bot).toBeTruthy();
    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({ parked: 0, waitingExit: 1 }),
    );

    const details = simulationService.inspectExitBot({
      botId: queued.bot.botId,
      gateId: exitGate,
    });
    expect(details).toEqual(
      expect.objectContaining({
        plateNumber: bot.plateNumber,
        hasTicket: expect.any(Boolean),
        ticketId: details.hasTicket ? ticket.ticketId : null,
      }),
    );

    simulationService.markBotSettled({
      ticketId: ticket.ticketId,
      plateNumber: bot.plateNumber,
      fare: 42,
    });
    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({
        waitingExit: 0,
        completedExits: 1,
        revenueCollected: 42,
      }),
    );
    jest.useRealTimers();
  });

  test("rejects a rate above the supported maximum", () => {
    expect(() => simulationService.startSimulation({ ratePerMinute: 601 })).toThrow();
  });

  test("stores a validated in-memory fare-tier override", () => {
    simulationService.setFareOverride({
      vehicleType: "4W",
      firstHourFree: false,
      tiers: [
        { afterHours: 0, ratePerHour: 25 },
        { afterHours: 2, ratePerHour: 40 },
      ],
      lostTicketPenalty: 150,
    });
    expect(simulationService.getFareOverride("4W")).toEqual({
      "4W": {
        firstHourFree: false,
        tiers: [
          { afterHours: 0, ratePerHour: 25 },
          { afterHours: 2, ratePerHour: 40 },
        ],
        lostTicketPenalty: 150,
        overstayPenalty: undefined,
      },
    });
  });

  test("rejects unordered or negative fare tiers", () => {
    expect(() =>
      simulationService.setFareOverride({
        vehicleType: "2W",
        tiers: [
          { afterHours: 2, ratePerHour: 10 },
          { afterHours: 1, ratePerHour: 20 },
        ],
      }),
    ).toThrow();
  });

  test("the entry operator's ticket request sends the bot to the allocation service", async () => {
    jest.useFakeTimers();
    allocateSpot.mockResolvedValue({
      ticketId: "TKT-SIM-1",
      transactionId: "transaction-1",
      spotId: "spot-1",
      spotNumber: "2W-001",
      zone: "2W",
      entryTimestamp: new Date(),
    });
    simulationService.startSimulation({ ratePerMinute: 60 });
    await jest.advanceTimersByTimeAsync(1000);

    const gateId = ["Entry-1", "Entry-2"].find(
      (gate) => simulationService.getEntryQueue(gate).bot,
    );
    const bot = simulationService.getEntryQueue(gateId).bot;
    const ticket = await simulationService.admitEntryBot({
      botId: bot.botId,
      gateId,
      operatorId: "operator-1",
    });

    expect(allocateSpot).toHaveBeenCalledTimes(1);
    expect(allocateSpot).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicleType: expect.stringMatching(/^(2W|4W)$/),
        gateId,
        operatorId: "operator-1",
        plateNumber: expect.stringMatching(/^BOT[A-F0-9]{7}$/),
      }),
    );
    expect(ticket).toEqual(
      expect.objectContaining({
        ticketId: "TKT-SIM-1",
        intendedStayHours: expect.any(Number),
      }),
    );
    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({ parked: 1, successfulAllocations: 1, waitingEntry: 0 }),
    );
    jest.useRealTimers();
  });
});
