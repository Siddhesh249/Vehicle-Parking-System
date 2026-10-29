import { createMockApi } from "./mockApi.js";

describe("mock realtime (same interface as the Socket.io connection)", () => {
  test("sends a snapshot on connect and broadcasts spot updates for entry and exit", async () => {
    const api = createMockApi({ delayMs: 0 });
    const handlers = { onSnapshot: jest.fn(), onUpdate: jest.fn(), onStatus: jest.fn() };
    const disconnect = api.realtime.connect(handlers);

    expect(handlers.onStatus).toHaveBeenCalledWith("connected");
    expect(handlers.onSnapshot.mock.calls[0][0]).toEqual(
      expect.arrayContaining([{ id: "4W-01", zone: "4W", status: "reserved" }]),
    );

    const ticket = await api.createEntry({ plateNumber: "KA09ZZ0001", vehicleType: "2W", gateId: "Entry-1" });
    expect(handlers.onUpdate).toHaveBeenLastCalledWith({ spotId: ticket.spotId, status: "reserved" });

    await api.processExit({ ticketId: ticket.ticketId, gateId: "Exit-1" });
    expect(handlers.onUpdate).toHaveBeenLastCalledWith({ spotId: ticket.spotId, status: "free" });

    disconnect();
    await api.createEntry({ plateNumber: "KA09ZZ0002", vehicleType: "2W", gateId: "Entry-1" });
    expect(handlers.onUpdate).toHaveBeenCalledTimes(2);
  });

  test("admin analytics include chart data", async () => {
    const api = createMockApi({ delayMs: 0 });
    const occupancy = await api.getOccupancy();
    const revenue = await api.getRevenue();

    expect(occupancy.history.at(-1).totalPct).toBe(occupancy.totalPct);
    expect(revenue.byDay).toHaveLength(7);
  });
});
