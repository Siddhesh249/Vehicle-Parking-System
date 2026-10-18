const demoVehicle = {
  ticketId: "TKT-20261018-001",
  plateNumber: "KA01AB1234",
  vehicleType: "4W",
  entryTimestamp: "2026-10-18T10:00:00.000Z",
};

/** Sprint 2 UI preview data. Sprint 3 replaces these methods with HTTP calls. */
export const mockApi = {
  async createEntry({ vehicleType }) {
    return {
      ticketId: demoVehicle.ticketId,
      spotId: vehicleType === "2W" ? "2W-014" : "4W-006",
      zone: vehicleType,
      qrPayload: demoVehicle.ticketId,
    };
  },
  async lookupTicket(ticketId) {
    if (!ticketId) throw new Error("Enter a ticket ID to search.");
    return { ...demoVehicle, ticketId };
  },
  async searchPlate(plateNumber) {
    return [{ ...demoVehicle, plateNumber }];
  },
  async processExit({ ticketId, plateNumber }) {
    return {
      fare: 30,
      durationSeconds: 5400,
      penaltyApplied: !ticketId && Boolean(plateNumber),
      breakdown: { baseFare: 30 },
      receiptId: "RCP-20261018-001",
    };
  },
  async getOccupancy() {
    return {
      totalPct: 62,
      byZone: { "2W": { occupied: 18, total: 30 }, "4W": { occupied: 25, total: 40 } },
      history: [],
    };
  },
  async getRevenue() {
    return { total: 18450, byDay: [], byZone: { "2W": 5250, "4W": 13200 } };
  },
  async getTransactions() {
    return { records: [{ ...demoVehicle, status: "active" }] };
  },
  async getAuditLog() {
    return { entries: [{ action: "VEHICLE_ENTRY", actorRole: "operator", createdAt: "2026-10-18T10:00:00.000Z" }] };
  },
};
