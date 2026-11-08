// In-memory mock of the SAD 4.3 REST contract, used when VITE_API_MODE is not "real".
// Errors are rejected as { status, code?, message }, matching the standard error envelope.

const DEFAULT_FARE_CONFIG = {
  "2W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, ratePerHour: 10 },
      { afterHours: 3, ratePerHour: 15 },
      { afterHours: 6, ratePerHour: 25 },
    ],
    lostTicketPenalty: 50,
    overstayPenalty: 100,
  },
  "4W": {
    firstHourFree: true,
    tiers: [
      { afterHours: 1, ratePerHour: 20 },
      { afterHours: 3, ratePerHour: 30 },
      { afterHours: 6, ratePerHour: 50 },
    ],
    lostTicketPenalty: 100,
    overstayPenalty: 200,
  },
};
const HOUR_MS = 3600 * 1000;
const DEFAULT_OVERSTAY_THRESHOLD_SECONDS = 2 * 60 * 60;

const fail = (status, message, code) => Promise.reject({ status, code, message });
const round2 = (n) => Math.round(n * 100) / 100;
const clone = (value) => JSON.parse(JSON.stringify(value));

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new TypeError("At least one fare tier is required");
  }
  let previous = -Infinity;
  return tiers.map((tier) => {
    const afterHours = Number(tier?.afterHours);
    const ratePerHour = Number(tier?.ratePerHour ?? tier?.rate);
    if (
      !Number.isFinite(afterHours) ||
      afterHours < 0 ||
      afterHours <= previous ||
      !Number.isFinite(ratePerHour) ||
      ratePerHour < 0
    ) {
      throw new TypeError("Fare tiers need increasing afterHours and non-negative rates");
    }
    previous = afterHours;
    return { afterHours, ratePerHour };
  });
}

function calculateBaseFare(durationSeconds, vehicleType, config) {
  const durationHours = durationSeconds / 3600;
  const vehicleConfig = config[vehicleType];
  const freeUntil = vehicleConfig.firstHourFree ? 1 : 0;
  if (durationHours <= freeUntil) return 0;

  return round2(
    vehicleConfig.tiers.reduce((fare, tier, index) => {
      const nextThreshold =
        vehicleConfig.tiers[index + 1]?.afterHours ?? Number.POSITIVE_INFINITY;
      const chargedHours = Math.max(
        0,
        Math.min(durationHours, nextThreshold) - Math.max(freeUntil, tier.afterHours),
      );
      return fare + chargedHours * tier.ratePerHour;
    }, 0),
  );
}

export function publicFareConfig(config, vehicleType) {
  const entry = config[vehicleType];
  return {
    firstHourFree: entry.firstHourFree,
    tiers: entry.tiers.map(({ afterHours, ratePerHour }) => ({
      afterHours,
      rate: ratePerHour,
    })),
    lostTicketPenalty: entry.lostTicketPenalty,
    overstayPenalty: entry.overstayPenalty,
  };
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
  const fareConfig = clone(DEFAULT_FARE_CONFIG);

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
  let simulationRunning = false;
  let simulationRate = 0;

  // Same-tab stand-in for the Socket.io spot:update broadcast.
  const listeners = new Set();
  const emit = (spotId, status) =>
    listeners.forEach((listener) => listener({ spotId, status }));

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
      entryOperatorId: { username: gateId === "Entry-1" ? "entry1" : "entry2" },
      status: "active",
      isOverstay: false,
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
        pct: round2(
          (inZone.filter((s) => s.status === "reserved").length / inZone.length) * 100,
        ),
      };
    }
    const occupied = spots.filter((s) => s.status === "reserved").length;
    return {
      totalPct: Math.round((occupied / spots.length) * 100),
      occupied,
      total: spots.length,
      byZone,
      history: [],
    };
  };

  const overstayRows = () =>
    active()
      .filter(
        (record) =>
          record.isOverstay ||
          (now() - new Date(record.entryTimestamp).getTime()) / 1000 >=
            DEFAULT_OVERSTAY_THRESHOLD_SECONDS,
      )
      .map((record) => ({
        vehicleId: record.ticketId,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        vehicleType: record.vehicleType,
        gateId: record.entryGateId,
        entryTimestamp: record.entryTimestamp,
        duration: Math.max(
          0,
          Math.round((now() - new Date(record.entryTimestamp).getTime()) / 1000),
        ),
        autoFlagged: !record.isOverstay,
      }));

  return {
    async getSimulationStatus() {
      await wait();
      return {
        running: simulationRunning,
        ratePerMinute: simulationRate,
        generatedArrivals: 0,
        successfulAllocations: 0,
        fullLotArrivals: 0,
        lastError: null,
      };
    },
    async startSimulation({ ratePerMinute }) {
      await wait();
      if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0 || ratePerMinute > 600) {
        return fail(
          400,
          "Rate must be between 1 and 600 arrivals per minute",
          "INVALID_SIMULATION_RATE",
        );
      }
      simulationRunning = true;
      simulationRate = ratePerMinute;
      return { status: "running" };
    },
    async stopSimulation() {
      await wait();
      simulationRunning = false;
      simulationRate = 0;
      return { status: "stopped" };
    },
    async setSimulationFareTiers(config) {
      await wait();
      if (!["2W", "4W"].includes(config?.vehicleType)) {
        return fail(
          400,
          "vehicleType must be either '2W' or '4W'",
          "INVALID_FARE_OVERRIDE",
        );
      }
      try {
        const tiers = normalizeTiers(config.tiers);
        fareConfig[config.vehicleType] = {
          ...fareConfig[config.vehicleType],
          firstHourFree: config.firstHourFree !== false,
          tiers,
          ...(config.lostTicketPenalty === undefined
            ? {}
            : { lostTicketPenalty: Number(config.lostTicketPenalty) }),
          ...(config.overstayPenalty === undefined
            ? {}
            : { overstayPenalty: Number(config.overstayPenalty) }),
        };
      } catch (error) {
        return fail(400, error.message, "INVALID_FARE_OVERRIDE");
      }
      return { updated: true, vehicleType: config.vehicleType };
    },
    async getLotStatus() {
      await wait();
      const { totalPct, byZone, occupied, total } = lotStatus();
      return {
        spots: spots.map(({ id, zone, status }) => ({ id, zone, status })),
        occupancy: { totalPct, occupied, totalSpots: total, byZone },
      };
    },

    async createEntry({ plateNumber, vehicleType, gateId }) {
      await wait();
      const normalizedPlate = String(plateNumber ?? "")
        .trim()
        .toUpperCase();
      if (!normalizedPlate || !fareConfig[vehicleType])
        return fail(400, "Plate number and a valid vehicle type are required");
      if (active().some((r) => r.plateNumber === normalizedPlate))
        return fail(409, "This vehicle is already parked", "ALREADY_PARKED");
      ticketSeq += 1;
      const stamp = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
      const ticketId = `TKT-${stamp}-${String(ticketSeq).padStart(3, "0")}`;
      const record = park({
        ticketId,
        plateNumber: normalizedPlate,
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
      const wanted = String(plateNumber ?? "")
        .trim()
        .toUpperCase();
      const matches = active().filter((r) => r.plateNumber === wanted);
      return matches.length ? matches.map(publicRecord) : fail(404, "Vehicle not found");
    },

    async processExit({ ticketId, plateNumber, gateId }) {
      await wait();
      const record = active().find((r) =>
        ticketId
          ? r.ticketId === ticketId
          : r.plateNumber ===
            String(plateNumber ?? "")
              .trim()
              .toUpperCase(),
      );
      if (!record) return fail(404, "Vehicle not found");
      const durationSeconds = Math.max(
        0,
        Math.round((now() - new Date(record.entryTimestamp).getTime()) / 1000),
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
      record.exitGateId = gateId;
      record.exitOperatorId = { username: gateId === "Exit-1" ? "exit1" : "exit2" };
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
      record.isOverstay = true;
      log("OVERSTAY_FLAGGED");
      return {
        notificationId: `NOTICE-${record.ticketId}`,
        vehicleId: record.ticketId,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        gateId,
        durationSeconds: Math.max(
          0,
          Math.round((now() - new Date(record.entryTimestamp).getTime()) / 1000),
        ),
      };
    },

    async getOverstays() {
      await wait();
      return overstayRows();
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

    async getFareConfig() {
      await wait();
      return {
        "2W": publicFareConfig(fareConfig, "2W"),
        "4W": publicFareConfig(fareConfig, "4W"),
      };
    },

    async updateFareTiers({ vehicleType, tiers, firstHourFree, ...penalties }) {
      await wait();
      if (!["2W", "4W"].includes(vehicleType)) {
        return fail(400, "vehicleType must be either '2W' or '4W'", "INVALID_TIERS");
      }
      let normalized;
      try {
        normalized = normalizeTiers(tiers);
      } catch (error) {
        return fail(400, error.message, "INVALID_TIERS");
      }
      fareConfig[vehicleType] = {
        ...fareConfig[vehicleType],
        firstHourFree:
          typeof firstHourFree === "boolean"
            ? firstHourFree
            : fareConfig[vehicleType].firstHourFree,
        tiers: normalized,
        ...(penalties.lostTicketPenalty === undefined
          ? {}
          : { lostTicketPenalty: Number(penalties.lostTicketPenalty) }),
        ...(penalties.overstayPenalty === undefined
          ? {}
          : { overstayPenalty: Number(penalties.overstayPenalty) }),
      };
      return { updated: true, vehicleType };
    },

    async getSpotConfig() {
      await wait();
      const counts = { "2W": 0, "4W": 0 };
      for (const spot of spots) counts[spot.zone] += 1;
      return counts;
    },

    async updateSpotCount({ zone, count }) {
      await wait();
      if (!["2W", "4W"].includes(zone)) {
        return fail(400, "zone must be either '2W' or '4W'", "INVALID_REQUEST");
      }
      if (!Number.isInteger(count) || count < 0 || count > 500) {
        return fail(400, "count must be an integer between 0 and 500", "INVALID_REQUEST");
      }
      const inZone = spots.filter((s) => s.zone === zone);
      if (count < inZone.length) {
        const free = inZone
          .filter((s) => s.status === "free")
          .sort((a, b) => b.id.localeCompare(a.id));
        const toRemove = inZone.length - count;
        if (free.length < toRemove) {
          return fail(
            409,
            `Only ${free.length} free ${zone} spots can be removed`,
            "SPOTS_OCCUPIED",
          );
        }
        for (const spot of free.slice(0, toRemove)) {
          spots.splice(spots.indexOf(spot), 1);
        }
      } else if (count > inZone.length) {
        const taken = new Set(spots.map((s) => s.id));
        let next = 1;
        for (let added = 0; added < count - inZone.length; added += 1) {
          let id = `${zone}-${String(next).padStart(2, "0")}`;
          while (taken.has(id)) {
            next += 1;
            id = `${zone}-${String(next).padStart(2, "0")}`;
          }
          next += 1;
          taken.add(id);
          spots.push({ id, zone, status: "free" });
        }
      }
      return { updated: true, zone, count: spots.filter((s) => s.zone === zone).length };
    },

    async getTransactions({ plate } = {}) {
      await wait();
      const wanted = plate ? plate.trim().toUpperCase() : "";
      const list = records
        .filter((r) => !wanted || r.plateNumber.includes(wanted))
        .map(
          ({
            ticketId,
            plateNumber,
            vehicleType,
            status,
            entryGateId,
            exitGateId,
            entryOperatorId,
            exitOperatorId,
            fare,
            entryTimestamp,
            exitTimestamp,
          }) => ({
            ticketId,
            plateNumber,
            vehicleType,
            status,
            entryGateId,
            exitGateId,
            entryOperatorId,
            exitOperatorId,
            fare,
            entryTimestamp,
            exitTimestamp,
          }),
        );
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
      const durationSeconds = Math.max(
        0,
        Math.round((now() - new Date(record.entryTimestamp).getTime()) / 1000),
      );
      const fareDetails = calculateBaseFare(
        durationSeconds,
        record.vehicleType,
        fareConfig,
      );
      record.fare = round2(fareDetails + fareConfig[record.vehicleType].overstayPenalty);
      spots.find((s) => s.id === record.spotId).status = "free";
      log("SPOT_FORCE_RELEASE", "admin");
      emit(record.spotId, "free");
      return {
        spotId: record.spotId,
        penaltyApplied: true,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        durationSeconds,
        fare: record.fare,
        breakdown: {
          baseFare: fareDetails,
          overstayPenalty: fareConfig[record.vehicleType].overstayPenalty,
        },
      };
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
