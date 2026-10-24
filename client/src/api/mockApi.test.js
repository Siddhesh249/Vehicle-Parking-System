import { createMockApi } from "./mockApi.js";

describe("mock API (SAD 4.3 shapes)", () => {
  test("entry allots a spot in the matching zone and marks it reserved", async () => {
    const api = createMockApi({ delayMs: 0 });
    const ticket = await api.createEntry({ plateNumber: "KA09ZZ0001", vehicleType: "2W", gateId: "Entry-1" });

    expect(ticket).toEqual({
      ticketId: expect.stringMatching(/^TKT-\d{8}-001$/),
      spotId: expect.stringMatching(/^2W-/),
      zone: "2W",
      qrPayload: ticket.ticketId,
    });
    const lot = await api.getLotStatus();
    expect(lot.spots.find((s) => s.id === ticket.spotId).status).toBe("reserved");
  });

  test("rejects with 409 LOT_FULL once a zone is exhausted", async () => {
    const api = createMockApi({ delayMs: 0 });
    const lot = await api.getLotStatus();
    const free2W = lot.spots.filter((s) => s.zone === "2W" && s.status === "free").length;
    for (let i = 0; i < free2W; i += 1) {
      await api.createEntry({ plateNumber: `KA10AA${1000 + i}`, vehicleType: "2W", gateId: "Entry-1" });
    }
    await expect(
      api.createEntry({ plateNumber: "KA10AA9999", vehicleType: "2W", gateId: "Entry-2" }),
    ).rejects.toMatchObject({ status: 409, code: "LOT_FULL" });
  });

  test("exit by ticket charges only the hourly fare, frees the spot, and logs the exit", async () => {
    const api = createMockApi({ delayMs: 0 });
    const receipt = await api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" });

    expect(receipt.penaltyApplied).toBe(false);
    expect(receipt.fare).toBe(30); // 2.5h parked, first hour free, 4W at 20/h
    expect(receipt.receiptId).toMatch(/^RCP-/);
    await expect(api.lookupTicket("TKT-DEMO-001")).rejects.toMatchObject({ status: 404 });
    expect((await api.getAuditLog()).entries[0].action).toBe("VEHICLE_EXIT");
  });

  test("exit by plate (lost ticket) adds the penalty", async () => {
    const api = createMockApi({ delayMs: 0 });
    const receipt = await api.processExit({ plateNumber: "KA02CD5678", gateId: "Exit-2" });

    expect(receipt.penaltyApplied).toBe(true);
    expect(receipt.breakdown.lostTicketPenalty).toBe(100);
    expect(receipt.fare).toBe(130); // 4h parked, 2W at 10/h = 30, plus 100 penalty
  });
});
