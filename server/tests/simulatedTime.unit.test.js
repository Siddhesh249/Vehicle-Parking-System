/** Demo clock: five real seconds equal one simulated parking hour by default. */
"use strict";

const {
  DEFAULT_REAL_SECONDS_PER_SIMULATED_HOUR,
  realSecondsPerSimulatedHour,
  realMillisecondsForSimulatedHours,
  simulatedHoursBetween,
  simulatedSecondsBetween,
  timeScaleInfo,
} = require("../utils/simulatedTime");
const { calculateFare } = require("../services/fareService");

const previous = process.env.SIMULATED_HOUR_SECONDS;

afterEach(() => {
  if (previous === undefined) delete process.env.SIMULATED_HOUR_SECONDS;
  else process.env.SIMULATED_HOUR_SECONDS = previous;
});

describe("simulated demo clock", () => {
  test("defaults to five real seconds per simulated hour", () => {
    delete process.env.SIMULATED_HOUR_SECONDS;
    expect(DEFAULT_REAL_SECONDS_PER_SIMULATED_HOUR).toBe(5);
    expect(realSecondsPerSimulatedHour()).toBe(5);
    expect(timeScaleInfo()).toEqual({
      realSecondsPerHour: 5,
      hoursPerRealSecond: 0.2,
    });
  });

  test("converts real elapsed time into simulated hours and seconds", () => {
    delete process.env.SIMULATED_HOUR_SECONDS;
    const start = new Date("2026-11-08T10:00:00Z");
    const end = new Date(start.getTime() + 26 * 1000); // 5.2 simulated hours

    expect(simulatedHoursBetween(start, end)).toBeCloseTo(5.2, 10);
    expect(simulatedSecondsBetween(start, end)).toBeCloseTo(5.2 * 3600, 6);
    expect(realMillisecondsForSimulatedHours(5.2) / 1000).toBeCloseTo(26, 10);
  });

  test("fares use simulated hours, so a 26-second stay is billed as 5.2 hours", () => {
    delete process.env.SIMULATED_HOUR_SECONDS;
    const entry = new Date("2026-11-08T10:00:00Z");
    const exit = new Date(entry.getTime() + 26 * 1000);
    // 4W: 1h free + 2h @20 + 2.2h @30 = 106
    expect(calculateFare(entry, exit, "4W")).toBeCloseTo(106, 6);
  });

  test("honours a configured clock override for tests and alternate demos", () => {
    process.env.SIMULATED_HOUR_SECONDS = "10";
    expect(realSecondsPerSimulatedHour()).toBe(10);
    expect(simulatedHoursBetween(new Date(0), new Date(10 * 1000))).toBeCloseTo(1, 10);
  });
});
