/**
 * Sprint 1 — T3: Fare Calculation Pure Function Unit Tests
 *
 * calculateFare(entryTimestamp, exitTimestamp, vehicleType, tierConfig?) is a
 * pure function with NO database or HTTP dependency. Every test here runs with
 * a mocked/default tier config so the logic is fully testable in isolation.
 *
 * Default tier assumptions (matching the SRS sample config):
 *   First hour: FREE (for both 2W and 4W)
 *   4W rates:   ₹20/hr for hours 1–3, ₹30/hr for hours 3–6, ₹50/hr after 6h
 *   2W rates:   ₹10/hr for hours 1–3, ₹15/hr for hours 3–6, ₹25/hr after 6h
 *   Lost-ticket penalty: ₹100 (4W), ₹50 (2W)
 *   Overstay penalty:   ₹200 (4W), ₹100 (2W)
 *
 * SRS refs  : VPS-F-032, VPS-F-033, VPS-F-034, VPS-F-035
 * Sprint ref: Sprint 1, Track T3 (Sumukh)
 */

"use strict";

const { calculateFare } = require("../services/fareService");

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Build a Date pair offset by the given number of minutes from a fixed anchor.
 * Anchor: 2026-10-02T10:00:00Z (arbitrary; only the diff matters for fare calc)
 */
function makeTimes(durationMinutes) {
  const entry = new Date("2026-10-02T10:00:00.000Z");
  const exit = new Date(entry.getTime() + durationMinutes * 60 * 1000);
  return { entry, exit };
}

// ─────────────────────────────────────────────────────────────────────────────
// First-hour-free rule  (VPS-F-033)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — first hour free", () => {
  test("4W: exactly 0 minutes → ₹0", () => {
    const { entry, exit } = makeTimes(0);
    expect(calculateFare(entry, exit, "4W")).toBe(0);
  });

  test("4W: 30 minutes (within first hour) → ₹0", () => {
    const { entry, exit } = makeTimes(30);
    expect(calculateFare(entry, exit, "4W")).toBe(0);
  });

  test("4W: exactly 60 minutes (boundary of free hour) → ₹0", () => {
    const { entry, exit } = makeTimes(60);
    expect(calculateFare(entry, exit, "4W")).toBe(0);
  });

  test("4W: 45 minutes → ₹0", () => {
    const { entry, exit } = makeTimes(45);
    expect(calculateFare(entry, exit, "4W")).toBe(0);
  });

  test("2W: 59 minutes → ₹0", () => {
    const { entry, exit } = makeTimes(59);
    expect(calculateFare(entry, exit, "2W")).toBe(0);
  });

  test("2W: exactly 60 minutes → ₹0", () => {
    const { entry, exit } = makeTimes(60);
    expect(calculateFare(entry, exit, "2W")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 charges  (1h–3h window)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — tier-1 charges (hours 1–3)", () => {
  test("4W: 90 minutes (0.5h charged @ ₹20/hr) → ₹10", () => {
    const { entry, exit } = makeTimes(90);
    expect(calculateFare(entry, exit, "4W")).toBe(10);
  });

  test("4W: 120 minutes (1h charged @ ₹20/hr) → ₹20", () => {
    const { entry, exit } = makeTimes(120);
    expect(calculateFare(entry, exit, "4W")).toBe(20);
  });

  test("4W: 180 minutes (2h charged @ ₹20/hr) → ₹40", () => {
    const { entry, exit } = makeTimes(180);
    expect(calculateFare(entry, exit, "4W")).toBe(40);
  });

  test("2W: 90 minutes (0.5h charged @ ₹10/hr) → ₹5", () => {
    const { entry, exit } = makeTimes(90);
    expect(calculateFare(entry, exit, "2W")).toBe(5);
  });

  test("2W: 180 minutes (2h charged @ ₹10/hr) → ₹20", () => {
    const { entry, exit } = makeTimes(180);
    expect(calculateFare(entry, exit, "2W")).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 charges  (3h–6h window)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — tier-2 charges (hours 3–6)", () => {
  test("4W: 4.5h = 1h@free + 2h@₹20 + 1.5h@₹30 = ₹85", () => {
    const { entry, exit } = makeTimes(270); // 4.5 * 60
    expect(calculateFare(entry, exit, "4W")).toBe(85);
  });

  test("4W: exactly 6h = 1h@free + 2h@₹20 + 3h@₹30 = ₹130", () => {
    const { entry, exit } = makeTimes(360);
    expect(calculateFare(entry, exit, "4W")).toBe(130);
  });

  test("2W: 4.5h = 1h@free + 2h@₹10 + 1.5h@₹15 = ₹42.5", () => {
    const { entry, exit } = makeTimes(270);
    expect(calculateFare(entry, exit, "2W")).toBe(42.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3 charges  (beyond 6h)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — tier-3 charges (beyond 6h)", () => {
  test("4W: 7h = 1h@free + 2h@₹20 + 3h@₹30 + 1h@₹50 = ₹180", () => {
    const { entry, exit } = makeTimes(420);
    expect(calculateFare(entry, exit, "4W")).toBe(180);
  });

  test("4W: 8h = 1h@free + 2h@₹20 + 3h@₹30 + 2h@₹50 = ₹230", () => {
    const { entry, exit } = makeTimes(480);
    expect(calculateFare(entry, exit, "4W")).toBe(230);
  });

  test("2W: 7h = 1h@free + 2h@₹10 + 3h@₹15 + 1h@₹25 = ₹90", () => {
    const { entry, exit } = makeTimes(420);
    expect(calculateFare(entry, exit, "2W")).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2W vs 4W produce different fares for identical durations  (VPS-F-034)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — independent 2W vs 4W rate tables (VPS-F-034)", () => {
  test("same 2h duration yields different fares for 2W and 4W", () => {
    const { entry, exit } = makeTimes(120);
    const fare4W = calculateFare(entry, exit, "4W");
    const fare2W = calculateFare(entry, exit, "2W");
    expect(fare4W).not.toBe(fare2W);
    expect(fare4W).toBeGreaterThan(fare2W);
  });

  test("same 4h duration yields different fares for 2W and 4W", () => {
    const { entry, exit } = makeTimes(240);
    const fare4W = calculateFare(entry, exit, "4W");
    const fare2W = calculateFare(entry, exit, "2W");
    expect(fare4W).toBeGreaterThan(fare2W);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exact fractional duration — no rounding  (VPS-F-033)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — no rounding on fractional durations (VPS-F-033)", () => {
  test("4W: 61 minutes (1 minute of chargeable time @ ₹20/hr) → ₹0.333...", () => {
    const { entry, exit } = makeTimes(61);
    const fare = calculateFare(entry, exit, "4W");
    // 1 minute = 1/60 hour; 1/60 * 20 = 0.3333...
    expect(fare).toBeCloseTo(20 / 60, 5);
    // Must NOT be rounded to a whole number
    expect(Number.isInteger(fare)).toBe(false);
  });

  test("2W: 61 minutes → ₹0.1666...", () => {
    const { entry, exit } = makeTimes(61);
    const fare = calculateFare(entry, exit, "2W");
    expect(fare).toBeCloseTo(10 / 60, 5);
  });

  test("4W: 150 minutes = 1.5h chargeable = ₹30 exactly (clean mid-tier value)", () => {
    // 1h free + 1.5h @ ₹20/hr = ₹30
    const { entry, exit } = makeTimes(150);
    expect(calculateFare(entry, exit, "4W")).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lost-ticket penalty  (VPS-F-035)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — lost-ticket penalty (VPS-F-035)", () => {
  test("4W: lost ticket adds ₹100 on top of fare", () => {
    const { entry, exit } = makeTimes(120); // base fare = ₹20
    const withTicket = calculateFare(entry, exit, "4W", { lostTicket: false });
    const withoutTicket = calculateFare(entry, exit, "4W", { lostTicket: true });
    expect(withoutTicket - withTicket).toBe(100);
  });

  test("2W: lost ticket adds ₹50 on top of fare", () => {
    const { entry, exit } = makeTimes(120); // base fare = ₹10
    const withTicket = calculateFare(entry, exit, "2W", { lostTicket: false });
    const withoutTicket = calculateFare(entry, exit, "2W", { lostTicket: true });
    expect(withoutTicket - withTicket).toBe(50);
  });

  test("no penalty when lostTicket is false", () => {
    const { entry, exit } = makeTimes(90);
    const fare = calculateFare(entry, exit, "4W", { lostTicket: false });
    const fareNoFlag = calculateFare(entry, exit, "4W");
    expect(fare).toBe(fareNoFlag);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Custom tier config  (VPS-F-055 — admin-configurable tiers)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — custom tier config", () => {
  const customConfig = {
    "4W": {
      firstHourFree: true,
      tiers: [
        { afterHours: 1, ratePerHour: 40 },
        { afterHours: 3, ratePerHour: 60 },
      ],
      lostTicketPenalty: 150,
    },
    "2W": {
      firstHourFree: true,
      tiers: [
        { afterHours: 1, ratePerHour: 20 },
        { afterHours: 3, ratePerHour: 30 },
      ],
      lostTicketPenalty: 75,
    },
  };

  test("4W: 2h with custom ₹40/hr tier-1 rate → ₹40", () => {
    const { entry, exit } = makeTimes(120);
    expect(calculateFare(entry, exit, "4W", {}, customConfig)).toBe(40);
  });

  test("2W: 2h with custom ₹20/hr tier-1 rate → ₹20", () => {
    const { entry, exit } = makeTimes(120);
    expect(calculateFare(entry, exit, "2W", {}, customConfig)).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overstay penalty  (VPS-F-042, VPS-F-043)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — overstay penalty (VPS-F-042, VPS-F-043)", () => {
  test("4W: overstay flag adds ₹200 penalty on top of computed fare", () => {
    const { entry, exit } = makeTimes(120); // base fare = ₹20
    const normalFare = calculateFare(entry, exit, "4W", { overstay: false });
    const overstayFare = calculateFare(entry, exit, "4W", { overstay: true });
    expect(overstayFare - normalFare).toBe(200);
  });

  test("2W: overstay flag adds ₹100 penalty on top of computed fare", () => {
    const { entry, exit } = makeTimes(120); // base fare = ₹10
    const normalFare = calculateFare(entry, exit, "2W", { overstay: false });
    const overstayFare = calculateFare(entry, exit, "2W", { overstay: true });
    expect(overstayFare - normalFare).toBe(100);
  });

  test("both lost-ticket AND overstay flags apply cumulatively", () => {
    const { entry, exit } = makeTimes(120); // base fare 4W = ₹20
    const baseFare = calculateFare(entry, exit, "4W");
    const bothPenaltiesFare = calculateFare(entry, exit, "4W", {
      lostTicket: true,
      overstay: true,
    });
    // 4W: +100 lost ticket + 200 overstay = +300 total penalty
    expect(bothPenaltiesFare - baseFare).toBe(300);
  });

  test("no penalty when overstay is false or omitted", () => {
    const { entry, exit } = makeTimes(120);
    const fareOmitted = calculateFare(entry, exit, "4W");
    const fareExplicitFalse = calculateFare(entry, exit, "4W", { overstay: false });
    expect(fareExplicitFalse).toBe(fareOmitted);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier boundary precision  (hours 1, 3, 6 exact thresholds)
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — exact tier boundaries", () => {
  test("4W: exactly 180 minutes (boundary between tier 1 and tier 2) → ₹40", () => {
    const { entry, exit } = makeTimes(180); // 1h free + 2h @ ₹20 = ₹40
    expect(calculateFare(entry, exit, "4W")).toBe(40);
  });

  test("4W: 181 minutes (1 minute into tier 2 @ ₹30/hr) → ₹40 + (1/60 * 30) = ₹40.5", () => {
    const { entry, exit } = makeTimes(181);
    expect(calculateFare(entry, exit, "4W")).toBeCloseTo(40.5, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases and input validation
// ─────────────────────────────────────────────────────────────────────────────
describe("calculateFare — edge cases", () => {
  test("throws when exit is before entry", () => {
    const entry = new Date("2026-10-02T12:00:00Z");
    const exit = new Date("2026-10-02T10:00:00Z");
    expect(() => calculateFare(entry, exit, "4W")).toThrow();
  });

  test("throws on an invalid vehicleType", () => {
    const { entry, exit } = makeTimes(90);
    expect(() => calculateFare(entry, exit, "3W")).toThrow();
  });

  test("returns a number (not a string or undefined)", () => {
    const { entry, exit } = makeTimes(90);
    expect(typeof calculateFare(entry, exit, "4W")).toBe("number");
    expect(typeof calculateFare(entry, exit, "2W")).toBe("number");
  });
});
