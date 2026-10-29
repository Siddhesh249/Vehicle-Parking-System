/** Sprint 3 — T4: real API transport and Socket.io-driven client state. */
import { act, render, screen, waitFor } from "@testing-library/react";
import { createHttpApi } from "./api/httpClient.js";
import { createRealtimeHub } from "./realtime/realtimeHub.js";
import { createSocketConnection } from "./realtime/socketConnection.js";
import { fakeSocket } from "./realtime/testSocket.js";
import AdminConsole from "./components/AdminConsole.jsx";
import LotMap from "./components/LotMap.jsx";

const initialSpots = [
  { id: "2W-01", zone: "2W", status: "free" },
  { id: "4W-01", zone: "4W", status: "free" },
];
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const statusOf = (spotId) => screen.getByText(spotId).closest("li");

function manualRealtime() {
  const source = { handlers: null, unsubscribe: jest.fn() };
  source.subscribe = (handlers) => {
    source.handlers = handlers;
    return source.unsubscribe;
  };
  return source;
}

const makeLotApi = () => ({
  getLotStatus: jest.fn().mockResolvedValue({ spots: initialSpots, occupancy: {} }),
});

describe("S3-T4 — real-data client integration (VPS-F-021, VPS-F-022)", () => {
  test("sends the stored bearer token with protected REST requests", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { spots: [] }));
    await createHttpApi({ fetchImpl, getToken: () => "jwt-1" }).getLotStatus();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/lot/status");
    expect(init.headers.Authorization).toBe("Bearer jwt-1");
  });

  test("maps API error envelopes into recoverable UI errors", async () => {
    const api = createHttpApi({
      getToken: () => "jwt-1",
      fetchImpl: jest
        .fn()
        .mockResolvedValue(
          reply(409, { error: { code: "LOT_FULL", message: "No 2W spots available" } }),
        ),
    });

    await expect(
      api.createEntry({ plateNumber: "KA01", vehicleType: "2W", gateId: "Entry-1" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "LOT_FULL",
      message: "No 2W spots available",
    });
  });

  test("loads the initial lot map from GET /api/lot/status", async () => {
    const api = makeLotApi();
    render(<LotMap api={api} realtime={manualRealtime()} />);

    expect(await screen.findByText("2W-01")).toBeInTheDocument();
    expect(api.getLotStatus).toHaveBeenCalledTimes(1);
  });

  test("updates the correct spot label when a spot:update event arrives", async () => {
    const realtime = manualRealtime();
    render(<LotMap api={makeLotApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() => realtime.handlers.onUpdate({ spotId: "4W-01", status: "reserved" }));

    expect(statusOf("4W-01")).toHaveTextContent(/reserved/i);
    expect(statusOf("2W-01")).toHaveTextContent(/free/i);
  });

  test("replaces stale lot state with lot:snapshot after connect or reconnect", async () => {
    const realtime = manualRealtime();
    render(<LotMap api={makeLotApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() =>
      realtime.handlers.onSnapshot([
        { id: "2W-01", zone: "2W", status: "reserved" },
        { id: "4W-01", zone: "4W", status: "reserved" },
      ]),
    );

    expect(statusOf("2W-01")).toHaveTextContent(/reserved/i);
    expect(statusOf("4W-01")).toHaveTextContent(/reserved/i);
  });

  test("keeps lot state synchronized after reconnect without duplicate listeners", async () => {
    const socket = fakeSocket();
    const realtime = createRealtimeHub(
      createSocketConnection({ getToken: () => "jwt-1", createSocket: () => socket }),
    );
    const { unmount } = render(<LotMap api={makeLotApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() => socket.trigger("connect"));
    act(() => socket.trigger("disconnect"));
    act(() => socket.trigger("connect"));
    act(() =>
      socket.trigger("lot:snapshot", {
        spots: [
          { id: "2W-01", spotNumber: "2W-001", zone: "2W", status: "reserved" },
          { id: "4W-01", spotNumber: "4W-001", zone: "4W", status: "free" },
        ],
      }),
    );

    expect(await screen.findByText("2W-001")).toBeInTheDocument();
    expect(statusOf("2W-001")).toHaveTextContent(/reserved/i);
    expect(socket.listeners["lot:snapshot"]).toHaveLength(1);
    expect(socket.listeners["spot:update"]).toHaveLength(1);

    unmount();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  test("refreshes admin occupancy, revenue, and audit data from real API responses", async () => {
    const api = {
      getOccupancy: jest
        .fn()
        .mockResolvedValueOnce({ totalPct: 20, byZone: {}, history: [] })
        .mockResolvedValue({ totalPct: 80, byZone: {}, history: [] }),
      getRevenue: jest.fn().mockResolvedValue({ total: 0, byDay: [], byZone: {} }),
      getTransactions: jest.fn().mockResolvedValue({ records: [] }),
      getAuditLog: jest.fn().mockResolvedValue({ entries: [] }),
    };
    const realtime = manualRealtime();
    render(<AdminConsole api={api} realtime={realtime} />);
    expect(await screen.findByText("20%")).toBeInTheDocument();

    act(() => realtime.handlers.onUpdate({ spotId: "2W-01", status: "reserved" }));

    expect(await screen.findByText("80%")).toBeInTheDocument();
    await waitFor(() => expect(api.getAuditLog).toHaveBeenCalledTimes(2));
  });
});
