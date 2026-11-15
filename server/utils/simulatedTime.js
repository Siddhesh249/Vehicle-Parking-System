"use strict";

/**
 * The demo runs on a compressed clock: by default five real seconds represent
 * one simulated parking hour. Timestamps stay real so Socket.io/UI timers can
 * count smoothly, while every fare, duration and overstay calculation uses
 * simulated hours.
 */
const DEFAULT_REAL_SECONDS_PER_SIMULATED_HOUR = 5;

function realSecondsPerSimulatedHour(value = process.env.SIMULATED_HOUR_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_REAL_SECONDS_PER_SIMULATED_HOUR;
  }
  return parsed;
}

function realMillisecondsPerSimulatedHour(value) {
  return realSecondsPerSimulatedHour(value) * 1000;
}

function realMillisecondsForSimulatedHours(hours, value) {
  return Number(hours) * realMillisecondsPerSimulatedHour(value);
}

function simulatedHoursBetween(start, end, value) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError("Both timestamps must be valid dates");
  }
  return Math.max(0, (endMs - startMs) / realMillisecondsPerSimulatedHour(value));
}

function simulatedSecondsBetween(start, end, value) {
  return simulatedHoursBetween(start, end, value) * 3600;
}

function timeScaleInfo() {
  const seconds = realSecondsPerSimulatedHour();
  return {
    realSecondsPerHour: seconds,
    hoursPerRealSecond: 1 / seconds,
  };
}

module.exports = {
  DEFAULT_REAL_SECONDS_PER_SIMULATED_HOUR,
  realSecondsPerSimulatedHour,
  realMillisecondsPerSimulatedHour,
  realMillisecondsForSimulatedHours,
  simulatedHoursBetween,
  simulatedSecondsBetween,
  timeScaleInfo,
};
