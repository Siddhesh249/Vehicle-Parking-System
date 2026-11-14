import { createMockApi } from "./mockApi.js";

describe("mock simulation generator (VPS-DEV-001)", () => {
  let api;
  beforeEach(() => {
    jest.useFakeTimers();
    api = createMockApi({ delayMs: 0 });
  });
  afterEach(async () => {
    await api.stopSimulation();
    jest.useRealTimers();
  });

  const settle = async (promise) => {
    // Two sequential mock calls (scan -> processExit) each schedule a zero-delay
    // timer, so advance a tiny window rather than exactly 0.
    await jest.advanceTimersByTimeAsync(5);
    return promise;
  };
  const status = () => settle(api.getSimulationStatus());
  const firstQueue = async (phase) => {
    const gates = phase === "entry" ? ["Entry-1", "Entry-2"] : ["Exit-1", "Exit-2"];
    for (const gateId of gates) {
      const queue = await settle(
        phase === "entry" ? api.getEntryQueue({ gateId }) : api.getExitQueue({ gateId }),
      );
      if (queue.bot) return { queue, gateId };
    }
    return { queue: null, gateId: null };
  };
  const admitOne = async () => {
    const { queue, gateId } = await firstQueue("entry");
    expect(queue?.bot).toBeTruthy();
    return settle(api.admitEntryBot({ botId: queue.bot.botId, gateId }));
  };

  test.each([0, -5, 601, "ten", undefined])("rejects the rate %p", async (rate) => {
    await expect(api.startSimulation({ ratePerMinute: rate })).rejects.toMatchObject({
      status: 400,
      code: "INVALID_SIMULATION_RATE",
    });
    expect((await status()).running).toBe(false);
  });

  test("generates arrivals at the configured rate and reports the counters", async () => {
    await expect(api.startSimulation({ ratePerMinute: 60 })).resolves.toEqual({
      status: "running",
    });
    await jest.advanceTimersByTimeAsync(5000);

    const state = await status();
    expect(state).toMatchObject({
      running: true,
      ratePerMinute: 60,
      generatedArrivals: 5,
    });
    // Bots wait for an entry operator, so none is parked yet.
    expect(state.successfulAllocations).toBe(0);
    expect(state.waitingEntry).toBe(5);
  });

  test("caps each gate queue and counts overflow instead of unbounded growth", async () => {
    await api.startSimulation({ ratePerMinute: 600 });
    await jest.advanceTimersByTimeAsync(10000);

    const state = await status();
    expect(state.generatedArrivals).toBe(100);
    expect(state.queueOverflow).toBeGreaterThan(0);
    expect(state.waitingEntry).toBeLessThanOrEqual(16);
  });

  test("a bot only parks after the entry operator issues a ticket", async () => {
    await api.startSimulation({ ratePerMinute: 30 });
    await jest.advanceTimersByTimeAsync(2000);
    await api.stopSimulation();

    expect((await status()).successfulAllocations).toBe(0);
    const ticket = await admitOne();
    expect(ticket.ticketId).toBeTruthy();

    const audit = await settle(api.getAuditLog());
    expect(audit.entries.filter((e) => e.action === "VEHICLE_ENTRY")).toHaveLength(1);
    expect((await status()).successfulAllocations).toBe(1);
    expect((await status()).parked).toBe(1);
  });

  test("a parked bot checks out at an exit gate and payment is collected", async () => {
    await api.startSimulation({ ratePerMinute: 120 });
    await jest.advanceTimersByTimeAsync(2000);
    await api.stopSimulation();
    await admitOne();

    // Every demo stay is shorter than 12 simulated hours (60 real seconds).
    await jest.advanceTimersByTimeAsync(61000);

    const { queue, gateId } = await firstQueue("exit");
    expect(queue?.bot).toBeTruthy();

    const scanned = await settle(api.scanExitBot({ botId: queue.bot.botId, gateId }));
    expect(scanned.quote.fare).toBeGreaterThanOrEqual(0);
    if (scanned.lostTicket) {
      expect(scanned.quote.breakdown.lostTicketPenalty).toBeGreaterThan(0);
    }

    const receipt = await settle(api.settleExitBot({ botId: queue.bot.botId, gateId }));
    expect(receipt.fare).toBeGreaterThanOrEqual(0);

    const finalState = await status();
    expect(finalState.completedExits).toBe(1);
    expect(finalState.revenueCollected).toBe(receipt.fare);
    expect(finalState.waitingExit).toBe(0);
  });

  test("stop halts the generator and restart resets the counters", async () => {
    await api.startSimulation({ ratePerMinute: 60 });
    await jest.advanceTimersByTimeAsync(3000);
    await expect(api.stopSimulation()).resolves.toEqual({ status: "stopped" });
    await jest.advanceTimersByTimeAsync(5000);
    expect(await status()).toMatchObject({
      running: false,
      ratePerMinute: 0,
      generatedArrivals: 3,
    });

    await api.startSimulation({ ratePerMinute: 60 });
    expect(await status()).toMatchObject({ running: true, generatedArrivals: 0 });
  });
});

describe("mock fare override (VPS-DEV-002)", () => {
  // Freeze the compressed demo clock so the demo vehicles keep their exact
  // 2.5h/4h ages while the async mock delay is flushed.
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
  });
  afterEach(() => jest.useRealTimers());

  const settle = async (promise) => {
    await jest.advanceTimersByTimeAsync(0);
    return promise;
  };

  test("changes the fare for later exits, for that vehicle type only", async () => {
    const api = createMockApi({ delayMs: 0 });
    await expect(
      api.setSimulationFareTiers({
        vehicleType: "4W",
        tiers: [{ afterHours: 1, ratePerHour: 100 }],
        lostTicketPenalty: 10,
      }),
    ).resolves.toEqual({ updated: true, vehicleType: "4W" });

    // Demo 4W car parked 2.5h: first hour free, then 1.5h at the new rate.
    const receipt = await settle(
      api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" }),
    );
    expect(receipt.fare).toBe(150);
    // The 2W demo bike (4h, no ticket) still uses the 2W defaults: 20 + 15 + 50 penalty.
    const bike = await settle(
      api.processExit({ plateNumber: "KA02CD5678", gateId: "Exit-2" }),
    );
    expect(bike.fare).toBe(85);
  });

  test("can turn off the free first hour", async () => {
    const api = createMockApi({ delayMs: 0 });
    await api.setSimulationFareTiers({
      vehicleType: "4W",
      firstHourFree: false,
      tiers: [{ afterHours: 0, ratePerHour: 10 }],
    });
    const receipt = await settle(
      api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" }),
    );
    expect(receipt.fare).toBe(25); // 2.5h at 10/h
  });

  test("clearing the override restores the effective rate table", async () => {
    const api = createMockApi({ delayMs: 0 });
    await api.setSimulationFareTiers({
      vehicleType: "4W",
      tiers: [{ afterHours: 1, ratePerHour: 999 }],
    });
    await expect(api.clearSimulationFareTiers()).resolves.toEqual({ cleared: "all" });
    const receipt = await settle(
      api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" }),
    );
    expect(receipt.fare).toBe(30);
  });

  test("does not leak into other mock instances", async () => {
    const first = createMockApi({ delayMs: 0 });
    await first.setSimulationFareTiers({
      vehicleType: "4W",
      tiers: [{ afterHours: 1, ratePerHour: 999 }],
    });
    const second = createMockApi({ delayMs: 0 });
    expect(
      (await settle(second.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" })))
        .fare,
    ).toBe(30);
  });

  test.each([
    [{ vehicleType: "3W", tiers: [{ afterHours: 1, ratePerHour: 5 }] }],
    [{ vehicleType: "4W", tiers: [] }],
    [
      {
        vehicleType: "4W",
        tiers: [
          { afterHours: 3, ratePerHour: 5 },
          { afterHours: 2, ratePerHour: 6 },
        ],
      },
    ],
    [{ vehicleType: "4W", tiers: [{ afterHours: 1, ratePerHour: -1 }] }],
  ])("rejects an invalid override %#", async (config) => {
    const api = createMockApi({ delayMs: 0 });
    await expect(api.setSimulationFareTiers(config)).rejects.toMatchObject({
      status: 400,
    });
  });
});
