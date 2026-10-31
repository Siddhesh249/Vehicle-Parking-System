/**
 * Sprint 4 — S4-T2: synthetic arrival generator contract (VPS-DEV-001/002).
 *
 * These tests define the service API the Simulation Console backend must
 * expose. They intentionally fail until `server/services/simulationService.js`
 * is implemented.
 */
"use strict";

const simulationService = require("../../services/simulationService");

describe("S4-T2 — simulation service", () => {
  test("exposes start, stop, and rate-calculation helpers", () => {
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
  ])(
    "generates ratePerMinute=%i over %ims as %i arrival(s)",
    (ratePerMinute, elapsedMs, expected) => {
      expect(simulationService.arrivalsForWindow({ ratePerMinute, elapsedMs })).toBe(
        expected,
      );
    },
  );

  test("rejects invalid traffic rates", () => {
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

  test("reports a stopped state before the generator is started", () => {
    expect(simulationService.getSimulationState()).toEqual(
      expect.objectContaining({ running: false }),
    );
  });
});
