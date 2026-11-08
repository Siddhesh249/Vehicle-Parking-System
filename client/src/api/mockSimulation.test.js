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

  const status = async () => {
    const pending = api.getSimulationStatus();
    await jest.advanceTimersByTimeAsync(0);
    return pending;
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
    expect(state.successfulAllocations + state.fullLotArrivals).toBe(5);
  });

  test("counts turned-away arrivals once the lot is full", async () => {
    await api.startSimulation({ ratePerMinute: 600 });
    await jest.advanceTimersByTimeAsync(10000);

    const state = await status();
    expect(state.generatedArrivals).toBe(100);
    expect(state.fullLotArrivals).toBeGreaterThan(0);
  });

  test("synthetic arrivals show up in the lot and the audit log", async () => {
    await api.startSimulation({ ratePerMinute: 30 });
    await jest.advanceTimersByTimeAsync(2000);
    await api.stopSimulation();

    const audit = api.getAuditLog();
    await jest.advanceTimersByTimeAsync(0);
    expect(
      (await audit).entries.filter((e) => e.action === "VEHICLE_ENTRY"),
    ).toHaveLength(1);
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
    const receipt = await api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" });
    expect(receipt.fare).toBe(150);
    // The 2W demo bike (4h, no ticket) still uses the 2W defaults: 20 + 15 + 50 penalty.
    const bike = await api.processExit({ plateNumber: "KA02CD5678", gateId: "Exit-2" });
    expect(bike.fare).toBe(85);
  });

  test("can turn off the free first hour", async () => {
    const api = createMockApi({ delayMs: 0 });
    await api.setSimulationFareTiers({
      vehicleType: "4W",
      firstHourFree: false,
      tiers: [{ afterHours: 0, ratePerHour: 10 }],
    });
    const receipt = await api.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" });
    expect(receipt.fare).toBe(25); // 2.5h at 10/h
  });

  test("does not leak into other mock instances", async () => {
    const first = createMockApi({ delayMs: 0 });
    await first.setSimulationFareTiers({
      vehicleType: "4W",
      tiers: [{ afterHours: 1, ratePerHour: 999 }],
    });
    const second = createMockApi({ delayMs: 0 });
    expect(
      (await second.processExit({ ticketId: "TKT-DEMO-001", gateId: "Exit-1" })).fare,
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
    await expect(api.setSimulationFareTiers(config)).rejects.toMatchObject({ status: 400 });
  });
});
