// In-memory mock of the SAD 4.3 REST contract, used when VITE_API_MODE is not "real".
// Errors are rejected as { status, code?, message }, matching the standard error envelope.

const FARE_CONFIG = {
  "2W": {
    tiers: [
      { afterHours: 1, ratePerHour: 10 },
      { afterHours: 3, ratePerHour: 15 },
      { afterHours: 6, ratePerHour: 25 },
    ],
    lostTicketPenalty: 50,
  },
  "4W": {
    tiers: [
      { afterHours: 1, ratePerHour: 20 },
      { afterHours: 3, ratePerHour: 30 },
      { afterHours: 6, ratePerHour: 50 },
    ],
    lostTicketPenalty: 100,
  },
};
const HOUR_MS = 3600 * 1000;

const fail = (status, message, code) => Promise.reject({ status, code, message });
const round2 = (n) => Math.round(n * 100) / 100;

function calculateBaseFare(durationSeconds, vehicleType, config = FARE_CONFIG) {
  const durationHours = durationSeconds / 3600;
  const { tiers, firstHourFree } = config[vehicleType];
  const freeHours = firstHourFree === false ? 0 : 1;
  if (durationHours <= freeHours) return 0;

  return round2(
    tiers.reduce((fare, tier, index) => {
      const nextThreshold = tiers[index + 1]?.afterHours ?? Infinity;
      const chargedHours = Math.max(
        0,
        Math.min(durationHours, nextThreshold) - Math.max(freeHours, tier.afterHours),
      );
      return fare + chargedHours * tier.ratePerHour;
    }, 0),
  );
}

// Demo-only trend data so the admin charts have something to draw.
function sampleHistory(currentPct, nowMs) {
  return [38, 44, 52, 61, 58, 66, 72, currentPct].map((totalPct, i, all) => ({
    timestamp: new Date(nowMs - (all.length - 1 - i) * HOUR_MS).toISOString(),
    totalPct,
  }));
}

function sampleRevenueByDay(todayTotal, nowMs) {
  return [420, 560, 380, 610, 530, 700, todayTotal].map((total, i, all) => ({
    date: new Date(nowMs - (all.length - 1 - i) * 24 * HOUR_MS)
      .toISOString()
      .slice(0, 10),
    total,
  }));
}

export function createMockApi({ delayMs = 150 } = {}) {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const now = () => Date.now();

  const spots = [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `2W-${String(i + 1).padStart(2, "0")}`,
      zone: "2W",
      status: "free",
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `4W-${String(i + 1).padStart(2, "0")}`,
      zone: "4W",
      status: "free",
    })),
  ];
  const records = [];
  const audit = [];
  let ticketSeq = 0;
  let receiptSeq = 0;

  // Same-tab stand-in for the Socket.io spot:update broadcast.
  const listeners = new Set();
  const emit = (spotId, status) =>
    listeners.forEach((listener) => listener({ spotId, status }));

  // Runtime fare overrides (Simulation Console) change this copy, not the shared defaults.
  const fareConfig = JSON.parse(JSON.stringify(FARE_CONFIG));

  const nextTicketId = () => {
    ticketSeq += 1;
    const stamp = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
    return `TKT-${stamp}-${String(ticketSeq).padStart(3, "0")}`;
  };

  // Synthetic arrival generator state (VPS-DEV-001).
  const sim = {
    timer: null,
    rate: 0,
    startedAt: null,
    generated: 0,
    ok: 0,
    full: 0,
    carry: 0,
  };

  const syntheticArrival = () => {
    sim.generated += 1;
    const record = park({
      ticketId: nextTicketId(),
      plateNumber: `SIM${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
      vehicleType: Math.random() < 0.65 ? "2W" : "4W",
      entryTimestamp: new Date(now()).toISOString(),
      gateId: Math.random() < 0.5 ? "Entry-1" : "Entry-2",
    });
    if (!record) {
      sim.full += 1;
      return;
    }
    sim.ok += 1;
    log("VEHICLE_ENTRY");
    emit(record.spotId, "reserved");
  };

  const log = (action, actorRole = "operator") =>
    audit.unshift({ action, actorRole, createdAt: new Date(now()).toISOString() });

  const park = ({ ticketId, plateNumber, vehicleType, entryTimestamp, gateId }) => {
    const spot = spots.find((s) => s.zone === vehicleType && s.status === "free");
    if (!spot) return null;
    spot.status = "reserved";
    const record = {
      ticketId,
      plateNumber,
      vehicleType,
      spotId: spot.id,
      zone: vehicleType,
      entryTimestamp,
      entryGateId: gateId,
      status: "active",
    };
    records.push(record);
    return record;
  };

  // Demo vehicles that have been parked a while, so exit fares are non-zero.
  park({
    ticketId: "TKT-DEMO-001",
    plateNumber: "KA01AB1234",
    vehicleType: "4W",
    entryTimestamp: new Date(now() - 2.5 * HOUR_MS).toISOString(),
    gateId: "Entry-1",
  });
  park({
    ticketId: "TKT-DEMO-002",
    plateNumber: "KA02CD5678",
    vehicleType: "2W",
    entryTimestamp: new Date(now() - 4 * HOUR_MS).toISOString(),
    gateId: "Entry-2",
  });

  const active = () => records.filter((r) => r.status === "active");
  const publicRecord = ({ ticketId, plateNumber, vehicleType, entryTimestamp }) => ({
    ticketId,
    plateNumber,
    vehicleType,
    entryTimestamp,
  });

  const lotStatus = () => {
    const byZone = {};
    for (const zone of ["2W", "4W"]) {
      const inZone = spots.filter((s) => s.zone === zone);
      byZone[zone] = {
        occupied: inZone.filter((s) => s.status === "reserved").length,
        total: inZone.length,
      };
    }
    const occupied = spots.filter((s) => s.status === "reserved").length;
    return { totalPct: Math.round((occupied / spots.length) * 100), byZone, history: [] };
  };

  return {
    async getLotStatus() {
      await wait();
      const { totalPct, byZone } = lotStatus();
      return {
        spots: spots.map(({ id, zone, status }) => ({ id, zone, status })),
        occupancy: { totalPct, byZone },
      };
    },

    async createEntry({ plateNumber, vehicleType, gateId }) {
      await wait();
      if (!plateNumber || !FARE_CONFIG[vehicleType])
        return fail(400, "Plate number and a valid vehicle type are required");
      if (active().some((r) => r.plateNumber === plateNumber))
        return fail(409, "This vehicle is already parked", "ALREADY_PARKED");
      const ticketId = nextTicketId();
      const record = park({
        ticketId,
        plateNumber,
        vehicleType,
        entryTimestamp: new Date(now()).toISOString(),
        gateId,
      });
      if (!record) return fail(409, `No ${vehicleType} spots available`, "LOT_FULL");
      log("VEHICLE_ENTRY");
      emit(record.spotId, "reserved");
      return { ticketId, spotId: record.spotId, zone: record.zone, qrPayload: ticketId };
    },

    async lookupTicket(ticketId) {
      await wait();
      const record = active().find((r) => r.ticketId === ticketId);
      return record ? publicRecord(record) : fail(404, "Vehicle not found");
    },

    async searchPlate(plateNumber) {
      await wait();
      const matches = active().filter((r) => r.plateNumber === plateNumber);
      return matches.length ? matches.map(publicRecord) : fail(404, "Vehicle not found");
    },

    async processExit({ ticketId, plateNumber }) {
      await wait();
      const record = active().find((r) =>
        ticketId ? r.ticketId === ticketId : r.plateNumber === plateNumber,
      );
      if (!record) return fail(404, "Vehicle not found");
      const durationSeconds = Math.round(
        (now() - new Date(record.entryTimestamp).getTime()) / 1000,
      );
      // Mirrors the backend's first-hour-free, tiered, exact-duration policy.
      const baseFare = calculateBaseFare(durationSeconds, record.vehicleType, fareConfig);
      const penaltyApplied = !ticketId;
      const lostTicketPenalty = fareConfig[record.vehicleType].lostTicketPenalty;
      const breakdown = { baseFare, ...(penaltyApplied ? { lostTicketPenalty } : {}) };
      const fare = round2(baseFare + (penaltyApplied ? lostTicketPenalty : 0));
      receiptSeq += 1;
      record.status = "completed";
      record.fare = fare;
      record.exitTimestamp = new Date(now()).toISOString();
      spots.find((s) => s.id === record.spotId).status = "free";
      log("VEHICLE_EXIT");
      emit(record.spotId, "free");
      return {
        fare,
        durationSeconds,
        penaltyApplied,
        breakdown,
        receiptId: `RCP-${String(receiptSeq).padStart(4, "0")}`,
      };
    },

    async notifyOverstay({ vehicleId, gateId }) {
      await wait();
      const record = active().find(
        (r) => r.ticketId === vehicleId || r.plateNumber === vehicleId,
      );
      if (!record) return fail(404, "Active vehicle not found", "VEHICLE_NOT_FOUND");
      log("OVERSTAY_FLAGGED");
      return {
        notificationId: `NOTICE-${record.ticketId}`,
        vehicleId: record.ticketId,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        gateId,
      };
    },

    async getOccupancy() {
      await wait();
      const status = lotStatus();
      return { ...status, history: sampleHistory(status.totalPct, now()) };
    },

    async getRevenue() {
      await wait();
      const byZone = { "2W": 0, "4W": 0 };
      for (const r of records)
        if (r.status === "completed") byZone[r.zone] = round2(byZone[r.zone] + r.fare);
      const total = round2(byZone["2W"] + byZone["4W"]);
      return { total, byDay: sampleRevenueByDay(total, now()), byZone };
    },

    async getTransactions({ plate } = {}) {
      await wait();
      const wanted = plate ? plate.trim().toUpperCase() : "";
      const list = records
        .filter((r) => !wanted || r.plateNumber.includes(wanted))
        .map(({ ticketId, plateNumber, vehicleType, status, entryGateId, fare }) => ({
          ticketId,
          plateNumber,
          vehicleType,
          status,
          entryGateId,
          fare,
        }));
      return { records: list };
    },

    async getAuditLog() {
      await wait();
      return { entries: audit.map((e) => ({ ...e })) };
    },

    async forceRelease(vehicleId) {
      await wait();
      const record = active().find(
        (r) => r.ticketId === vehicleId || r.spotId === vehicleId,
      );
      if (!record) return fail(404, "Active vehicle not found", "VEHICLE_NOT_FOUND");
      record.status = "completed";
      record.exitTimestamp = new Date(now()).toISOString();
      record.penaltyApplied = true;
      spots.find((s) => s.id === record.spotId).status = "free";
      log("SPOT_FORCE_RELEASE", "admin");
      emit(record.spotId, "free");
      return {
        spotId: record.spotId,
        penaltyApplied: true,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
      };
    },

    // Simulation Console (SAD 4.3.7). No artificial delay, so the generator timing stays exact.
    async startSimulation({ ratePerMinute } = {}) {
      if (
        typeof ratePerMinute !== "number" ||
        !(ratePerMinute > 0) ||
        ratePerMinute > 600
      ) {
        return fail(
          400,
          "ratePerMinute must be greater than 0 and at most 600",
          "INVALID_SIMULATION_RATE",
        );
      }
      if (sim.timer) clearInterval(sim.timer);
      Object.assign(sim, {
        rate: ratePerMinute,
        startedAt: now(),
        generated: 0,
        ok: 0,
        full: 0,
        carry: 0,
      });
      sim.timer = setInterval(() => {
        sim.carry += sim.rate / 60;
        const due = Math.floor(sim.carry);
        sim.carry -= due;
        for (let i = 0; i < due; i += 1) syntheticArrival();
      }, 1000);
      return { status: "running" };
    },

    async stopSimulation() {
      if (sim.timer) clearInterval(sim.timer);
      Object.assign(sim, { timer: null, rate: 0, startedAt: null, carry: 0 });
      return { status: "stopped" };
    },

    async getSimulationStatus() {
      await wait();
      return {
        running: sim.timer !== null,
        ratePerMinute: sim.rate,
        startedAt: sim.startedAt ? new Date(sim.startedAt).toISOString() : null,
        generatedArrivals: sim.generated,
        successfulAllocations: sim.ok,
        fullLotArrivals: sim.full,
        lastError: null,
      };
    },

    async setFareOverride(config = {}) {
      const { vehicleType, tiers, firstHourFree, lostTicketPenalty } = config;
      if (!fareConfig[vehicleType])
        return fail(400, "vehicleType must be either '2W' or '4W'");
      const valid =
        Array.isArray(tiers) &&
        tiers.length > 0 &&
        tiers.every(
          (t, i) =>
            Number.isFinite(t.afterHours) &&
            t.afterHours >= 0 &&
            (i === 0 || t.afterHours > tiers[i - 1].afterHours) &&
            Number.isFinite(t.ratePerHour) &&
            t.ratePerHour >= 0,
        );
      if (!valid) {
        return fail(
          400,
          "Fare tiers need increasing afterHours and non-negative ratePerHour values",
        );
      }
      fareConfig[vehicleType] = {
        ...fareConfig[vehicleType],
        tiers: tiers.map(({ afterHours, ratePerHour }) => ({ afterHours, ratePerHour })),
        firstHourFree: firstHourFree !== false,
        ...(lostTicketPenalty !== undefined ? { lostTicketPenalty } : {}),
      };
      return { updated: true, vehicleType };
    },

    // Same interface as the Socket.io connection: connect(handlers) returns a disconnect function.
    realtime: {
      connect({ onSnapshot, onUpdate, onStatus } = {}) {
        const listener = ({ spotId, status }) => onUpdate?.({ spotId, status });
        listeners.add(listener);
        onStatus?.("connected");
        onSnapshot?.(spots.map(({ id, zone, status }) => ({ id, zone, status })));
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

export const mockApi = createMockApi();
