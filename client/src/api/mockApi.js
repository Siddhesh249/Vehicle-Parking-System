// In-memory mock of the SAD 4.3 REST contract. Swap for the real fetch client in Sprint 3.
// Errors are rejected as { status, code?, message }, matching the standard error envelope.

const RATE_PER_HOUR = { "2W": 10, "4W": 20 };
const LOST_TICKET_PENALTY = 100;
const HOUR_MS = 3600 * 1000;

const fail = (status, message, code) => Promise.reject({ status, code, message });
const round2 = (n) => Math.round(n * 100) / 100;

export function createMockApi({ delayMs = 150 } = {}) {
  const wait = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const now = () => Date.now();

  const spots = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `2W-${String(i + 1).padStart(2, "0")}`, zone: "2W", status: "free" })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `4W-${String(i + 1).padStart(2, "0")}`, zone: "4W", status: "free" })),
  ];
  const records = [];
  const audit = [];
  let ticketSeq = 0;
  let receiptSeq = 0;

  const log = (action, actorRole = "operator") =>
    audit.unshift({ action, actorRole, createdAt: new Date(now()).toISOString() });

  const park = ({ ticketId, plateNumber, vehicleType, entryTimestamp, gateId }) => {
    const spot = spots.find((s) => s.zone === vehicleType && s.status === "free");
    if (!spot) return null;
    spot.status = "reserved";
    const record = { ticketId, plateNumber, vehicleType, spotId: spot.id, zone: vehicleType, entryTimestamp, entryGateId: gateId, status: "active" };
    records.push(record);
    return record;
  };

  // Demo vehicles that have been parked a while, so exit fares are non-zero.
  park({ ticketId: "TKT-DEMO-001", plateNumber: "KA01AB1234", vehicleType: "4W", entryTimestamp: new Date(now() - 2.5 * HOUR_MS).toISOString(), gateId: "Entry-1" });
  park({ ticketId: "TKT-DEMO-002", plateNumber: "KA02CD5678", vehicleType: "2W", entryTimestamp: new Date(now() - 4 * HOUR_MS).toISOString(), gateId: "Entry-2" });

  const active = () => records.filter((r) => r.status === "active");
  const publicRecord = ({ ticketId, plateNumber, vehicleType, entryTimestamp }) => ({ ticketId, plateNumber, vehicleType, entryTimestamp });

  const lotStatus = () => {
    const byZone = {};
    for (const zone of ["2W", "4W"]) {
      const inZone = spots.filter((s) => s.zone === zone);
      byZone[zone] = { occupied: inZone.filter((s) => s.status === "reserved").length, total: inZone.length };
    }
    const occupied = spots.filter((s) => s.status === "reserved").length;
    return { totalPct: Math.round((occupied / spots.length) * 100), byZone, history: [] };
  };

  return {
    async getLotStatus() {
      await wait();
      const { totalPct, byZone } = lotStatus();
      return { spots: spots.map(({ id, zone, status }) => ({ id, zone, status })), occupancy: { totalPct, byZone } };
    },

    async createEntry({ plateNumber, vehicleType, gateId }) {
      await wait();
      if (!plateNumber || !RATE_PER_HOUR[vehicleType]) return fail(400, "Plate number and a valid vehicle type are required");
      if (active().some((r) => r.plateNumber === plateNumber)) return fail(409, "This vehicle is already parked", "ALREADY_PARKED");
      ticketSeq += 1;
      const stamp = new Date(now()).toISOString().slice(0, 10).replace(/-/g, "");
      const ticketId = `TKT-${stamp}-${String(ticketSeq).padStart(3, "0")}`;
      const record = park({ ticketId, plateNumber, vehicleType, entryTimestamp: new Date(now()).toISOString(), gateId });
      if (!record) return fail(409, `No ${vehicleType} spots available`, "LOT_FULL");
      log("VEHICLE_ENTRY");
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
      const record = active().find((r) => (ticketId ? r.ticketId === ticketId : r.plateNumber === plateNumber));
      if (!record) return fail(404, "Vehicle not found");
      const durationSeconds = Math.round((now() - new Date(record.entryTimestamp).getTime()) / 1000);
      // First hour free, then the hourly rate on the exact fractional duration (no rounding of time).
      const baseFare = round2(Math.max(0, durationSeconds / 3600 - 1) * RATE_PER_HOUR[record.vehicleType]);
      const penaltyApplied = !ticketId;
      const breakdown = { baseFare, ...(penaltyApplied ? { lostTicketPenalty: LOST_TICKET_PENALTY } : {}) };
      const fare = round2(baseFare + (penaltyApplied ? LOST_TICKET_PENALTY : 0));
      receiptSeq += 1;
      record.status = "completed";
      record.fare = fare;
      record.exitTimestamp = new Date(now()).toISOString();
      spots.find((s) => s.id === record.spotId).status = "free";
      log("VEHICLE_EXIT");
      return { fare, durationSeconds, penaltyApplied, breakdown, receiptId: `RCP-${String(receiptSeq).padStart(4, "0")}` };
    },

    async getOccupancy() {
      await wait();
      return lotStatus();
    },

    async getRevenue() {
      await wait();
      const byZone = { "2W": 0, "4W": 0 };
      for (const r of records) if (r.status === "completed") byZone[r.zone] = round2(byZone[r.zone] + r.fare);
      return { total: round2(byZone["2W"] + byZone["4W"]), byDay: [], byZone };
    },

    async getTransactions({ plate } = {}) {
      await wait();
      const wanted = plate ? plate.trim().toUpperCase() : "";
      const list = records
        .filter((r) => !wanted || r.plateNumber.includes(wanted))
        .map(({ ticketId, plateNumber, vehicleType, status, entryGateId, fare }) => ({ ticketId, plateNumber, vehicleType, status, entryGateId, fare }));
      return { records: list };
    },

    async getAuditLog() {
      await wait();
      return { entries: audit.map((e) => ({ ...e })) };
    },
  };
}

export const mockApi = createMockApi();
