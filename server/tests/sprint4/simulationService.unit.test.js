"use strict";

const simulationService = require("../../services/simulationService");
const { allocateSpot } = require("../../services/allocationService");

jest.mock("../../services/allocationService", () => ({ allocateSpot: jest.fn() }));

describe("Sprint 4 T2 simulation backend", () => {
  afterEach(() => {
    simulationService.stopSimulation();
    simulationService.clearFareOverrides();
    jest.clearAllMocks();
  });

  test("exposes generator controls and rate calculation", () => {
    expect(simulationService).toEqual(expect.objectContaining({
      startSimulation: expect.any(Function),
      stopSimulation: expect.any(Function),
      getSimulationState: expect.any(Function),
      arrivalsForWindow: expect.any(Function),
    }));
  });

  test.each([[60,1000,1],[60,5000,5],[120,2000,4],[6,60000,6],[600,250,2]])(
    "calculates %i arrivals over %ims", (ratePerMinute, elapsedMs, expected) => {
      expect(simulationService.arrivalsForWindow({ ratePerMinute, elapsedMs })).toBe(expected);
    }
  );

  test("rejects invalid rates and elapsed windows", () => {
    expect(() => simulationService.arrivalsForWindow({ ratePerMinute: -1, elapsedMs: 1000 })).toThrow();
    expect(() => simulationService.arrivalsForWindow({ ratePerMinute: "fast", elapsedMs: 1000 })).toThrow();
    expect(() => simulationService.arrivalsForWindow({ ratePerMinute: 60, elapsedMs: -1 })).toThrow();
  });

  test("starts and stops the generator with the requested runtime rate", () => {
    expect(simulationService.getSimulationState().running).toBe(false);
    expect(simulationService.startSimulation({ ratePerMinute: 60 })).toEqual({ status: "running" });
    expect(simulationService.getSimulationState()).toEqual(expect.objectContaining({ running: true, ratePerMinute: 60 }));
    expect(simulationService.stopSimulation()).toEqual({ status: "stopped" });
    expect(simulationService.getSimulationState().running).toBe(false);
  });

  test("rejects a rate above the supported maximum", () => {
    expect(() => simulationService.startSimulation({ ratePerMinute: 601 })).toThrow();
  });

  test("stores a validated in-memory fare-tier override", () => {
    simulationService.setFareOverride({
      vehicleType: "4W",
      firstHourFree: false,
      tiers: [{ afterHours: 0, ratePerHour: 25 }, { afterHours: 2, ratePerHour: 40 }],
      lostTicketPenalty: 150,
    });
    expect(simulationService.getFareOverride("4W")).toEqual({
      "4W": {
        firstHourFree: false,
        tiers: [{ afterHours: 0, ratePerHour: 25 }, { afterHours: 2, ratePerHour: 40 }],
        lostTicketPenalty: 150,
        overstayPenalty: undefined,
      },
    });
  });

  test("rejects unordered or negative fare tiers", () => {
    expect(() => simulationService.setFareOverride({
      vehicleType: "2W",
      tiers: [{ afterHours: 2, ratePerHour: 10 }, { afterHours: 1, ratePerHour: 20 }],
    })).toThrow();
  });

  test("generator sends synthetic arrivals to the allocation service", async () => {
    jest.useFakeTimers();
    allocateSpot.mockResolvedValue({ ticketId: "SIM-1" });
    simulationService.startSimulation({ ratePerMinute: 60 });
    await jest.advanceTimersByTimeAsync(1000);
    expect(allocateSpot).toHaveBeenCalledTimes(1);
    expect(allocateSpot).toHaveBeenCalledWith(expect.objectContaining({
      vehicleType: expect.stringMatching(/^(2W|4W)$/),
      gateId: expect.stringMatching(/^Entry-[12]$/),
      plateNumber: expect.stringMatching(/^SIM/),
    }));
    jest.useRealTimers();
  });
});
