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
const REAL_SECONDS_PER_SIMULATED_HOUR = 5;
const SIMULATED_HOUR_MS = REAL_SECONDS_PER_SIMULATED_HOUR * 1000;
const DEFAULT_OVERSTAY_THRESHOLD_HOURS = 24;
const MOCK_PASSWORD = "password123";
const MOCK_ACCOUNTS = [
  { username: "entry1", role: "operator", gateId: "Entry-1" },
  { username: "entry2", role: "operator", gateId: "Entry-2" },
  { username: "exit1", role: "operator", gateId: "Exit-1" },
  { username: "exit2", role: "operator", gateId: "Exit-2" },
  { username: "admin", role: "admin" },
];

const simulatedHours = (startMs, endMs = Date.now()) =>
  Math.round(
    Math.max(0, (endMs - startMs) / 1000 / REAL_SECONDS_PER_SIMULATED_HOUR) * 100,
  ) / 100;

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

// Demo-only trend data so the admin charts have something to draw. The hourly
// occupancy pattern looks like a real day (quiet at night, busy midday).
function sampleHistory(currentPct, nowMs) {
  const pattern = [
    58,
    53,
    49,
    44,
    39,
    34,
    29,
    25,
    21,
    18,
    20,
    27,
    36,
    48,
    59,
    67,
    63,
    56,
    51,
    47,
    43,
    39,
    35,
    currentPct,
  ];
  const points = pattern.length;
  return pattern.map((totalPct, i) => ({
    timestamp: new Date(nowMs - (points - 1 - i) * HOUR_MS).toISOString(),
    totalPct,
  }));
}

const SAMPLE_DAILY_REVENUE = [6100, 8400, 5200, 9200, 6800, 7600];

function sampleRevenueByDay(todayTotal, nowMs) {
  return [...SAMPLE_DAILY_REVENUE, todayTotal].map((total, i, all) => ({
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
  const simulationOverrides = {};

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
  let overstayThresholdHours = DEFAULT_OVERSTAY_THRESHOLD_HOURS;

  // Same-tab stand-in for the Socket.io spot:update / lot:snapshot broadcasts.
  const listeners = new Set();
  const snapshotListeners = new Set();
  const emit = (spotId, status) =>
    listeners.forEach((listener) => listener({ spotId, status }));
  const snapshotPayload = () => ({
    spots: spots.map(spotView),
    timeScale: {
      realSecondsPerHour: REAL_SECONDS_PER_SIMULATED_HOUR,
      hoursPerRealSecond: 1 / REAL_SECONDS_PER_SIMULATED_HOUR,
    },
    overstayThresholdHours,
  });
  const emitSnapshot = () =>
    snapshotListeners.forEach((listener) => listener(snapshotPayload()));

  const nextTicketId = () => {
    ticketSeq += 1;
    const stamp = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
    return `TKT-${stamp}-${String(ticketSeq).padStart(3, "0")}`;
  };

  // Operator-driven bot fleet (VPS-DEV-001). Bots queue at gates and only park
  // when the entry operator issues a ticket; parked bots later queue at an exit
  // gate where the exit operator scans and settles them.
  const sim = {
    timer: null,
    rate: 0,
    startedAt: null,
    lastTickAt: null,
    carry: 0,
    generated: 0,
    ok: 0,
    full: 0,
    overflow: 0,
    completed: 0,
    revenue: 0,
    bots: new Map(),
  };

  const MAX_BOT_QUEUE = 8;
  const randomEntryGate = () => (Math.random() < 0.5 ? "Entry-1" : "Entry-2");
  const randomExitGate = () => (Math.random() < 0.5 ? "Exit-1" : "Exit-2");
  const randomStayHours = () => {
    const roll = Math.random();
    if (roll < 0.08) return 8 + Math.random() * 4;
    if (roll < 0.35) return 4 + Math.random() * 3;
    return 0.5 + Math.random() * 3.5;
  };
  const round2 = (value) => Math.round(value * 100) / 100;
  const botsIn = (status, gateField, gateId) =>
    [...sim.bots.values()]
      .filter((bot) => bot.status === status && bot[gateField] === gateId)
      .sort((a, b) => (a.arrivedAt ?? a.exitQueuedAt) - (b.arrivedAt ?? b.exitQueuedAt));

  const spawnBot = () => {
    const entryGateId = randomEntryGate();
    if (botsIn("waiting_entry", "entryGateId", entryGateId).length >= MAX_BOT_QUEUE) {
      sim.overflow += 1;
      return;
    }
    const id = `BOT-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    sim.bots.set(id, {
      botId: id,
      plateNumber: `BOT${Math.random().toString(36).slice(2, 9).toUpperCase()}`,
      vehicleType: Math.random() < 0.65 ? "2W" : "4W",
      entryGateId,
      status: "waiting_entry",
      arrivedAt: now(),
      intendedStayHours: round2(randomStayHours()),
      lostTicket: Math.random() < 0.12,
    });
  };

  const promoteBots = () => {
    const time = now();
    let changed = false;
    for (const bot of sim.bots.values()) {
      if (bot.status === "parked" && time >= bot.exitAtMs) {
        bot.status = "waiting_exit";
        bot.exitGateId = randomExitGate();
        bot.exitQueuedAt = time;
        const record = active().find((entry) => entry.ticketId === bot.ticketId);
        if (record && !record.parkingEndTimestamp) {
          record.parkingEndTimestamp = new Date(bot.exitAtMs).toISOString();
        }
        const spot = spots.find((candidate) => candidate.id === record?.spotId);
        if (spot && spot.currentTransactionId === bot.ticketId) {
          spot.status = "free";
          spot.currentTransactionId = null;
        }
        changed = true;
      }
    }
    if (changed) {
      emitSnapshot();
    }
  };

  const settleMockBot = ({ ticketId, plateNumber, fare } = {}) => {
    const wantedPlate = String(plateNumber ?? "").toUpperCase();
    for (const bot of sim.bots.values()) {
      if (bot.status !== "waiting_exit" && bot.status !== "parked") continue;
      if (
        (ticketId && bot.ticketId === ticketId) ||
        (wantedPlate && bot.plateNumber === wantedPlate)
      ) {
        bot.status = "completed";
        bot.fare = fare ?? bot.fare ?? 0;
        bot.settledAt = now();
        sim.completed += 1;
        sim.revenue = round2(sim.revenue + (bot.fare || 0));
        return;
      }
    }
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
      entryOperatorId: { username: gateId === "Entry-1" ? "entry1" : "entry2" },
      status: "active",
      isOverstay: false,
    };
    spot.currentTransactionId = ticketId;
    records.push(record);
    return record;
  };

  // Demo vehicles that have been parked a while, so exit fares are non-zero.
  park({
    ticketId: "TKT-DEMO-001",
    plateNumber: "KA01AB1234",
    vehicleType: "4W",
    entryTimestamp: new Date(now() - 2.5 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-1",
  });
  park({
    ticketId: "TKT-DEMO-002",
    plateNumber: "KA02CD5678",
    vehicleType: "2W",
    entryTimestamp: new Date(now() - 4 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-2",
  });
  park({
    ticketId: "TKT-DEMO-003",
    plateNumber: "KA03OV9012",
    vehicleType: "4W",
    entryTimestamp: new Date(now() - 7.5 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-1",
  });
  park({
    ticketId: "TKT-DEMO-004",
    plateNumber: "KA04GH3456",
    vehicleType: "2W",
    entryTimestamp: new Date(now() - 1.2 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-2",
  });
  park({
    ticketId: "TKT-DEMO-005",
    plateNumber: "KA05MN7788",
    vehicleType: "4W",
    entryTimestamp: new Date(now() - 3.4 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-1",
  });
  park({
    ticketId: "TKT-DEMO-006",
    plateNumber: "KA06PQ9900",
    vehicleType: "2W",
    entryTimestamp: new Date(now() - 5.2 * SIMULATED_HOUR_MS).toISOString(),
    gateId: "Entry-2",
  });

  const active = () => records.filter((r) => r.status === "active");
  const publicRecord = ({ ticketId, plateNumber, vehicleType, entryTimestamp }) => ({
    ticketId,
    plateNumber,
    vehicleType,
    entryTimestamp,
  });

  const maxTierHours = () =>
    Math.max(
      ...["2W", "4W"].flatMap((zone) =>
        fareConfig[zone].tiers.map((tier) => Number(tier.afterHours) || 0),
      ),
    );

  const spotView = (spot) => {
    const record =
      spot.status === "reserved"
        ? active().find(
            (entry) =>
              entry.ticketId === spot.currentTransactionId && !entry.parkingEndTimestamp,
          )
        : null;
    const durationHours = record
      ? simulatedHours(new Date(record.entryTimestamp).getTime())
      : null;
    return {
      id: spot.id,
      zone: spot.zone,
      status: spot.status,
      vehicle: record
        ? {
            transactionId: record.ticketId,
            ticketId: record.ticketId,
            plateNumber: record.plateNumber,
            vehicleType: record.vehicleType,
            entryTimestamp: record.entryTimestamp,
            durationHours,
            isOverstay:
              Boolean(record.isOverstay) || durationHours >= overstayThresholdHours,
          }
        : null,
    };
  };

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
      .filter((record) => {
        if (record.parkingEndTimestamp) return false;
        const hours = simulatedHours(new Date(record.entryTimestamp).getTime());
        return record.isOverstay || hours >= overstayThresholdHours;
      })
      .map((record) => {
        const durationHours = simulatedHours(new Date(record.entryTimestamp).getTime());
        return {
          vehicleId: record.ticketId,
          ticketId: record.ticketId,
          plateNumber: record.plateNumber,
          vehicleType: record.vehicleType,
          gateId: record.entryGateId,
          entryTimestamp: record.entryTimestamp,
          duration: durationHours * 3600,
          durationHours,
          isOverstay: true,
          autoFlagged: !record.isOverstay,
        };
      });

  const api = {
    async login({ username, password }) {
      await wait();
      const account = MOCK_ACCOUNTS.find(
        (candidate) => candidate.username === String(username ?? "").trim(),
      );
      if (!account || password !== MOCK_PASSWORD) {
        return fail(401, "Invalid username or password", "INVALID_CREDENTIALS");
      }
      return {
        token: `mock-token-${account.username}`,
        role: account.role,
        ...(account.gateId ? { gateId: account.gateId } : {}),
      };
    },

    async getLotStatus() {
      await wait();
      const { totalPct, byZone, occupied, total } = lotStatus();
      return {
        spots: spots.map(spotView),
        occupancy: { totalPct, occupied, totalSpots: total, byZone },
        timeScale: {
          realSecondsPerHour: REAL_SECONDS_PER_SIMULATED_HOUR,
          hoursPerRealSecond: 1 / REAL_SECONDS_PER_SIMULATED_HOUR,
        },
        overstayThresholdHours,
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
      const ticketId = nextTicketId();
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
      emitSnapshot();
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
      const billingEnd = record.parkingEndTimestamp
        ? new Date(record.parkingEndTimestamp).getTime()
        : now();
      const durationSeconds =
        simulatedHours(new Date(record.entryTimestamp).getTime(), billingEnd) * 3600;
      // Mirrors the backend's first-hour-free, tiered, exact-duration policy.
      const baseFare = calculateBaseFare(durationSeconds, record.vehicleType, fareConfig);
      const penaltyApplied = !ticketId;
      const lostTicketPenalty = fareConfig[record.vehicleType].lostTicketPenalty;
      const breakdown = { baseFare, ...(penaltyApplied ? { lostTicketPenalty } : {}) };
      const fare = round2(baseFare + (penaltyApplied ? lostTicketPenalty : 0));
      receiptSeq += 1;
      record.status = "completed";
      record.fare = fare;
      record.exitTimestamp = new Date(billingEnd).toISOString();
      record.exitGateId = gateId;
      record.exitOperatorId = { username: gateId === "Exit-1" ? "exit1" : "exit2" };
      const parkedSpot = spots.find((s) => s.id === record.spotId);
      if (parkedSpot && parkedSpot.currentTransactionId === record.ticketId) {
        parkedSpot.status = "free";
        parkedSpot.currentTransactionId = null;
      }
      log("VEHICLE_EXIT");
      emit(record.spotId, "free");
      emitSnapshot();
      settleMockBot({ ticketId: record.ticketId, plateNumber: record.plateNumber, fare });
      return {
        fare,
        durationSeconds,
        durationHours: durationSeconds / 3600,
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
      const durationSeconds =
        simulatedHours(new Date(record.entryTimestamp).getTime()) * 3600;
      emitSnapshot();
      return {
        notificationId: `NOTICE-${record.ticketId}`,
        vehicleId: record.ticketId,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        gateId,
        durationSeconds,
        durationHours: durationSeconds / 3600,
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
      let liveTotal = 0;
      for (const record of records) {
        if (record.status === "completed") liveTotal += record.fare || 0;
      }
      const byDay = sampleRevenueByDay(round2(5900 + liveTotal), now());
      const total = round2(byDay.reduce((sum, day) => sum + day.total, 0));
      const twoWheeler = round2(total * 0.44);
      return {
        total,
        byDay,
        byZone: { "2W": twoWheeler, "4W": round2(total - twoWheeler) },
      };
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
      const otherZone = vehicleType === "2W" ? "4W" : "2W";
      const highestTier = Math.max(
        ...normalized.map((tier) => tier.afterHours),
        ...fareConfig[otherZone].tiers.map((tier) => tier.afterHours),
      );
      if (highestTier > overstayThresholdHours) {
        return fail(
          400,
          `Overstay threshold (${overstayThresholdHours} hours) must be at least the highest fare tier (${highestTier} hours).`,
          "INVALID_FARE_TIERS",
        );
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

    async getOverstayConfig() {
      await wait();
      return {
        thresholdHours: overstayThresholdHours,
        minimumHours: maxTierHours(),
        defaultHours: Math.max(DEFAULT_OVERSTAY_THRESHOLD_HOURS, maxTierHours()),
      };
    },

    async updateOverstayConfig({ thresholdHours }) {
      await wait();
      const hours = Number(thresholdHours);
      const minimumHours = maxTierHours();
      if (!Number.isFinite(hours) || hours <= 0) {
        return fail(
          400,
          "thresholdHours must be greater than 0",
          "INVALID_OVERSTAY_THRESHOLD",
        );
      }
      if (hours < minimumHours) {
        return fail(
          400,
          `Overstay threshold cannot be lower than the highest fare tier (${minimumHours} hours)`,
          "INVALID_OVERSTAY_THRESHOLD",
        );
      }
      overstayThresholdHours = hours;
      emitSnapshot();
      return { updated: true, thresholdHours: hours, minimumHours };
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
      emitSnapshot();
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
      const billingEnd = record.parkingEndTimestamp
        ? new Date(record.parkingEndTimestamp).getTime()
        : now();
      record.status = "completed";
      record.exitTimestamp = new Date(billingEnd).toISOString();
      record.penaltyApplied = true;
      const durationSeconds =
        simulatedHours(new Date(record.entryTimestamp).getTime(), billingEnd) * 3600;
      const fareDetails = calculateBaseFare(
        durationSeconds,
        record.vehicleType,
        fareConfig,
      );
      record.fare = round2(fareDetails + fareConfig[record.vehicleType].overstayPenalty);
      const parkedSpot = spots.find((s) => s.id === record.spotId);
      if (parkedSpot && parkedSpot.currentTransactionId === record.ticketId) {
        parkedSpot.status = "free";
        parkedSpot.currentTransactionId = null;
      }
      log("SPOT_FORCE_RELEASE", "admin");
      emit(record.spotId, "free");
      emitSnapshot();
      settleMockBot({
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        fare: record.fare,
      });
      return {
        spotId: record.spotId,
        penaltyApplied: true,
        ticketId: record.ticketId,
        plateNumber: record.plateNumber,
        durationSeconds,
        durationHours: durationSeconds / 3600,
        fare: record.fare,
        breakdown: {
          baseFare: fareDetails,
          overstayPenalty: fareConfig[record.vehicleType].overstayPenalty,
        },
      };
    },

    // Simulation Console (SAD 4.3.7). No artificial delay, so bot timing stays exact.
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
        lastTickAt: now(),
        generated: 0,
        ok: 0,
        full: 0,
        overflow: 0,
        completed: 0,
        revenue: 0,
        carry: 0,
      });
      sim.timer = setInterval(() => {
        const time = now();
        sim.carry += (sim.rate * (time - (sim.lastTickAt ?? time))) / 60000;
        sim.lastTickAt = time;
        const due = Math.floor(sim.carry);
        sim.carry -= due;
        for (let i = 0; i < due; i += 1) {
          sim.generated += 1;
          spawnBot();
        }
        promoteBots();
      }, 1000);
      return { status: "running" };
    },

    async setSimulationRate({ ratePerMinute } = {}) {
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
      if (!sim.timer) return api.startSimulation({ ratePerMinute });
      sim.rate = ratePerMinute;
      sim.lastTickAt = now();
      return { status: "running", ratePerMinute };
    },

    async stopSimulation() {
      if (sim.timer) clearInterval(sim.timer);
      promoteBots();
      Object.assign(sim, { timer: null, rate: 0, startedAt: null, carry: 0 });
      return { status: "stopped" };
    },

    async getSimulationStatus() {
      await wait();
      promoteBots();
      const parked = [...sim.bots.values()].filter((bot) => bot.status === "parked");
      const waitingExit = [...sim.bots.values()].filter(
        (bot) => bot.status === "waiting_exit",
      );
      return {
        running: sim.timer !== null,
        ratePerMinute: sim.rate,
        startedAt: sim.startedAt ? new Date(sim.startedAt).toISOString() : null,
        generatedArrivals: sim.generated,
        successfulAllocations: sim.ok,
        fullLotArrivals: sim.full,
        queueOverflow: sim.overflow,
        completedExits: sim.completed,
        revenueCollected: sim.revenue,
        waitingEntry:
          botsIn("waiting_entry", "entryGateId", "Entry-1").length +
          botsIn("waiting_entry", "entryGateId", "Entry-2").length,
        parked: parked.length,
        waitingExit: waitingExit.length,
        lostTicketExits: waitingExit.filter((bot) => bot.lostTicket).length,
        occupied: parked.length + waitingExit.length,
        lastError: null,
        gates: {
          "Entry-1": {
            waiting: botsIn("waiting_entry", "entryGateId", "Entry-1").length,
          },
          "Entry-2": {
            waiting: botsIn("waiting_entry", "entryGateId", "Entry-2").length,
          },
          "Exit-1": { waiting: botsIn("waiting_exit", "exitGateId", "Exit-1").length },
          "Exit-2": { waiting: botsIn("waiting_exit", "exitGateId", "Exit-2").length },
        },
      };
    },

    async getEntryQueue({ gateId = "Entry-1" } = {}) {
      await wait();
      promoteBots();
      const queue = botsIn("waiting_entry", "entryGateId", gateId);
      const next = queue[0];
      return {
        gateId,
        queueLength: queue.length,
        bot: next
          ? {
              botId: next.botId,
              plateNumber: next.plateNumber,
              vehicleType: next.vehicleType,
              arrivedAt: new Date(next.arrivedAt).toISOString(),
              waitSeconds: Math.max(0, Math.round((now() - next.arrivedAt) / 1000)),
            }
          : null,
      };
    },

    async admitEntryBot({ botId, gateId = "Entry-1" } = {}) {
      await wait();
      promoteBots();
      const bot = sim.bots.get(botId);
      if (!bot || bot.status !== "waiting_entry" || bot.entryGateId !== gateId) {
        return fail(404, "No simulated vehicle is waiting at this gate", "BOT_NOT_FOUND");
      }
      const ticketId = nextTicketId();
      const record = park({
        ticketId,
        plateNumber: bot.plateNumber,
        vehicleType: bot.vehicleType,
        entryTimestamp: new Date(now()).toISOString(),
        gateId,
      });
      if (!record) {
        sim.bots.delete(botId);
        sim.full += 1;
        return fail(409, `No ${bot.vehicleType} spots available`, "LOT_FULL");
      }
      bot.status = "parked";
      bot.ticketId = ticketId;
      bot.transactionId = ticketId;
      bot.spotId = record.spotId;
      bot.entryTimestamp = record.entryTimestamp;
      bot.exitAtMs = now() + bot.intendedStayHours * SIMULATED_HOUR_MS;
      sim.ok += 1;
      log("VEHICLE_ENTRY");
      emit(record.spotId, "reserved");
      emitSnapshot();
      return {
        ticketId,
        spotId: record.spotId,
        spotNumber: record.spotId,
        zone: record.zone,
        qrPayload: ticketId,
        botId,
        intendedStayHours: bot.intendedStayHours,
        plannedExitAt: new Date(bot.exitAtMs).toISOString(),
      };
    },

    async getExitQueue({ gateId = "Exit-1" } = {}) {
      await wait();
      promoteBots();
      const queue = botsIn("waiting_exit", "exitGateId", gateId);
      const next = queue[0];
      return {
        gateId,
        queueLength: queue.length,
        bot: next
          ? {
              botId: next.botId,
              hasTicket: !next.lostTicket,
              queuedAt: new Date(next.exitQueuedAt).toISOString(),
              waitSeconds: Math.max(0, Math.round((now() - next.exitQueuedAt) / 1000)),
            }
          : null,
      };
    },

    async scanExitBot({ botId, gateId = "Exit-1" } = {}) {
      await wait();
      promoteBots();
      const bot = sim.bots.get(botId);
      if (!bot || bot.status !== "waiting_exit" || bot.exitGateId !== gateId) {
        return fail(404, "No simulated vehicle is waiting at this gate", "BOT_NOT_FOUND");
      }
      const record = active().find((entry) => entry.ticketId === bot.ticketId);
      if (!record) return fail(409, "Vehicle has already exited", "ALREADY_EXITED");
      const billingEnd = record.parkingEndTimestamp
        ? new Date(record.parkingEndTimestamp).getTime()
        : now();
      const durationSeconds =
        simulatedHours(new Date(record.entryTimestamp).getTime(), billingEnd) * 3600;
      const baseFare = calculateBaseFare(durationSeconds, record.vehicleType, fareConfig);
      const lostTicket = bot.lostTicket;
      const penalty = lostTicket ? fareConfig[record.vehicleType].lostTicketPenalty : 0;
      return {
        botId,
        hasTicket: !lostTicket,
        lostTicket,
        ticketId: lostTicket ? null : bot.ticketId,
        plateNumber: bot.plateNumber,
        vehicleType: bot.vehicleType,
        entryGateId: record.entryGateId,
        entryTimestamp: record.entryTimestamp,
        queuedAt: new Date(bot.exitQueuedAt).toISOString(),
        quote: {
          ticketId: bot.ticketId,
          plateNumber: bot.plateNumber,
          vehicleType: bot.vehicleType,
          entryTimestamp: record.entryTimestamp,
          durationSeconds,
          durationHours: durationSeconds / 3600,
          lostTicket,
          fare: round2(baseFare + penalty),
          breakdown: {
            baseFare,
            ...(lostTicket ? { lostTicketPenalty: penalty } : {}),
          },
        },
      };
    },

    async settleExitBot({ botId, gateId = "Exit-1" } = {}) {
      const scan = await api.scanExitBot({ botId, gateId });
      const receipt = await api.processExit({
        ticketId: scan.hasTicket ? scan.ticketId : undefined,
        plateNumber: scan.plateNumber,
        gateId,
      });
      return receipt;
    },

    async getSimulationFareConfig() {
      return api.getFareConfig();
    },

    async clearSimulationFareTiers() {
      for (const [vehicleType, previous] of Object.entries(simulationOverrides)) {
        fareConfig[vehicleType] = clone(previous);
        delete simulationOverrides[vehicleType];
      }
      return { cleared: "all" };
    },

    async setSimulationFareTiers(config = {}) {
      const { vehicleType, tiers, firstHourFree, lostTicketPenalty, overstayPenalty } =
        config;
      if (!["2W", "4W"].includes(vehicleType)) {
        return fail(
          400,
          "vehicleType must be either '2W' or '4W'",
          "INVALID_FARE_OVERRIDE",
        );
      }
      let normalized;
      try {
        normalized = normalizeTiers(tiers);
      } catch (error) {
        return fail(400, error.message, "INVALID_FARE_OVERRIDE");
      }
      if (!simulationOverrides[vehicleType]) {
        simulationOverrides[vehicleType] = clone(fareConfig[vehicleType]);
      }
      fareConfig[vehicleType] = {
        ...fareConfig[vehicleType],
        firstHourFree: firstHourFree !== false,
        tiers: normalized,
        ...(lostTicketPenalty === undefined
          ? {}
          : { lostTicketPenalty: Number(lostTicketPenalty) }),
        ...(overstayPenalty === undefined
          ? {}
          : { overstayPenalty: Number(overstayPenalty) }),
      };
      return { updated: true, vehicleType };
    },

    async getDatabase() {
      await wait();
      const vehicles = [];
      const seen = new Set();
      for (const record of records) {
        if (seen.has(record.plateNumber)) continue;
        seen.add(record.plateNumber);
        vehicles.push({
          _id: `veh-${record.plateNumber}`,
          plateNumber: record.plateNumber,
          vehicleType: record.vehicleType,
        });
      }
      const collections = {
        spots: spots.map((spot) => ({
          _id: spot.id,
          spotNumber: spot.id,
          zone: spot.zone,
          status: spot.status,
        })),
        vehicles,
        transactions: records.map((record) => ({
          _id: record.ticketId,
          ticketId: record.ticketId,
          plateNumber: record.plateNumber,
          vehicleType: record.vehicleType,
          spotId: record.spotId,
          entryGateId: record.entryGateId,
          entryTimestamp: record.entryTimestamp,
          exitGateId: record.exitGateId,
          exitTimestamp: record.exitTimestamp,
          fare: record.fare,
          status: record.status,
        })),
        auditlogs: audit.map((entry, index) => ({
          _id: `audit-${index}`,
          action: entry.action,
          actorRole: entry.actorRole,
          createdAt: entry.createdAt,
        })),
        users: MOCK_ACCOUNTS.map((account) => ({
          _id: `user-${account.username}`,
          username: account.username,
          role: account.role,
          gateId: account.gateId,
          isLocked: false,
        })),
        faretierconfigs: Object.entries(fareConfig).map(([vehicleType, config]) => ({
          _id: `fare-${vehicleType}`,
          vehicleType,
          firstHourFree: config.firstHourFree,
          tiers: config.tiers,
          lostTicketPenalty: config.lostTicketPenalty,
          overstayPenalty: config.overstayPenalty,
        })),
        systemconfigs: [
          {
            _id: "overstay-threshold",
            key: "overstayThresholdHours",
            value: overstayThresholdHours,
          },
        ],
      };
      const counts = Object.fromEntries(
        Object.entries(collections).map(([name, rows]) => [name, rows.length]),
      );
      return {
        generatedAt: new Date(now()).toISOString(),
        rowLimit: 250,
        counts,
        truncated: Object.fromEntries(
          Object.keys(collections).map((name) => [name, false]),
        ),
        collections,
      };
    },

    // Same interface as the Socket.io connection: connect(handlers) returns a disconnect function.
    realtime: {
      connect({ onSnapshot, onUpdate, onStatus } = {}) {
        const listener = ({ spotId, status }) => onUpdate?.({ spotId, status });
        const snapshotListener = (payload) => onSnapshot?.(payload);
        listeners.add(listener);
        snapshotListeners.add(snapshotListener);
        onStatus?.("connected");
        onSnapshot?.(snapshotPayload());
        return () => {
          listeners.delete(listener);
          snapshotListeners.delete(snapshotListener);
        };
      },
    },
  };
  return api;
}

export const mockApi = createMockApi();
