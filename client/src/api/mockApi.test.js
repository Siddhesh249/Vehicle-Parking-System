import { createMockApi } from "./mockApi.js";

describe("mock API (SAD 4.3 shapes)", () => {
  test("entry allots a spot in the matching zone and marks it reserved", async () => {
    const api = createMockApi({ delayMs: 0 });
    const ticket = await api.createEntry({
      plateNumber: "KA09ZZ0001",
      vehicleType: "2W",
      gateId: "Entry-1",
    });

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
      await api.createEntry({
        plateNumber: `KA10AA${1000 + i}`,
        vehicleType: "2W",
        gateId: "Entry-1",
      });
    }
    await expect(
      api.createEntry({
        plateNumber: "KA10AA9999",
        vehicleType: "2W",
        gateId: "Entry-2",
      }),
    ).rejects.toMatchObject({ status: 409, code: "LOT_FULL" });
  });

  test("exit by ticket charges only the hourly fare, frees the spot, and logs the exit", async () => {
    const api = createMockApi({ delayMs: 0 });
    const receipt = await api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" });

    expect(receipt.penaltyApplied).toBe(false);
    expect(receipt.fare).toBeCloseTo(30, 1); // 2.5h parked, first hour free, 4W at 20/h
    expect(receipt.receiptId).toMatch(/^RCP-/);
    await expect(api.lookupTicket("TKT-DEMO-001")).rejects.toMatchObject({ status: 404 });
    expect((await api.getAuditLog()).entries[0].action).toBe("VEHICLE_EXIT");
  });

  test("exit by plate (lost ticket) adds the penalty", async () => {
    const api = createMockApi({ delayMs: 0 });
    const receipt = await api.processExit({
      plateNumber: "KA02CD5678",
      gateId: "Exit-2",
    });

    expect(receipt.penaltyApplied).toBe(true);
    expect(receipt.breakdown.lostTicketPenalty).toBe(50);
    expect(receipt.fare).toBeCloseTo(85, 1); // 4h parked: 2h at 10/h + 1h at 15/h, plus 50 penalty
  });

  test("supports the admin fare and spot configuration contract", async () => {
    const api = createMockApi({ delayMs: 0 });

    expect(await api.getSpotConfig()).toEqual({ "2W": 6, "4W": 10 });
    await expect(api.updateSpotCount({ zone: "2W", count: 4 })).resolves.toEqual({
      updated: true,
      zone: "2W",
      count: 4,
    });
    expect(await api.getSpotConfig()).toEqual({ "2W": 4, "4W": 10 });

    await api.updateFareTiers({
      vehicleType: "4W",
      firstHourFree: false,
      tiers: [{ afterHours: 0, rate: 12 }],
      lostTicketPenalty: 0,
      overstayPenalty: 0,
    });
    expect((await api.getFareConfig())["4W"]).toEqual({
      firstHourFree: false,
      tiers: [{ afterHours: 0, rate: 12 }],
      lostTicketPenalty: 0,
      overstayPenalty: 0,
    });
  });

  test("enforces the overstay threshold against the highest fare tier", async () => {
    const api = createMockApi({ delayMs: 0 });

    expect(await api.getOverstayConfig()).toEqual(
      expect.objectContaining({ thresholdHours: 24, minimumHours: 6 }),
    );
    await expect(api.updateOverstayConfig({ thresholdHours: 5 })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_OVERSTAY_THRESHOLD",
    });
    await expect(api.updateOverstayConfig({ thresholdHours: 30 })).resolves.toEqual(
      expect.objectContaining({ thresholdHours: 30 }),
    );
  });

  test("a fresh demo starts with green parked cars and no overstays", async () => {
    const api = createMockApi({ delayMs: 0 });
    const overstays = await api.getOverstays();

    expect(overstays).toEqual([]);
  });

  test("plates that differ only in spaces, hyphens or case are one vehicle", async () => {
    const api = createMockApi({ delayMs: 0 });
    await api.createEntry({
      plateNumber: "ka 01-ab 7777",
      vehicleType: "2W",
      gateId: "Entry-1",
    });

    await expect(
      api.createEntry({
        plateNumber: "KA01AB7777",
        vehicleType: "2W",
        gateId: "Entry-1",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const [found] = await api.searchPlate("Ka-01 AB-7777");
    expect(found.plateNumber).toBe("KA01AB7777");
  });

  test("turning the free first hour off bills from minute zero", async () => {
    const api = createMockApi({ delayMs: 0 });
    const config = await api.getFareConfig();
    await api.updateFareTiers({
      vehicleType: "2W",
      firstHourFree: false,
      tiers: [{ afterHours: 1, rate: 10 }],
      lostTicketPenalty: config["2W"].lostTicketPenalty,
      overstayPenalty: config["2W"].overstayPenalty,
    });
    const entry = await api.createEntry({
      plateNumber: "KA02FF0001",
      vehicleType: "2W",
      gateId: "Entry-1",
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const quote = await api.quoteExit({ ticketId: entry.ticketId });
    expect(quote.breakdown.baseFare).toBeGreaterThan(0);
    expect(quote.lostTicket).toBe(false);
  });

  test("overstay notification and force-release require an overstayed vehicle", async () => {
    const api = createMockApi({ delayMs: 0 });
    const entry = await api.createEntry({
      plateNumber: "KA03OS0001",
      vehicleType: "4W",
      gateId: "Entry-1",
    });

    await expect(
      api.notifyOverstay({ vehicleId: entry.ticketId, gateId: "Exit-1" }),
    ).rejects.toMatchObject({ status: 409, code: "NOT_OVERSTAYED" });
    await expect(api.forceRelease(entry.ticketId)).rejects.toMatchObject({
      status: 409,
      code: "NOT_OVERSTAYED",
    });
  });
});
