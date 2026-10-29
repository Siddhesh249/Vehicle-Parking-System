import { act, render, screen } from "@testing-library/react";
import { createRealtimeHub } from "../realtime/realtimeHub.js";
import { createSocketConnection } from "../realtime/socketConnection.js";
import { fakeSocket } from "../realtime/testSocket.js";
import LotMap from "./LotMap.jsx";

const initialSpots = [
  { id: "2W-01", zone: "2W", status: "free" },
  { id: "2W-02", zone: "2W", status: "free" },
  { id: "4W-01", zone: "4W", status: "free" },
];
const makeApi = () => ({
  getLotStatus: jest.fn().mockResolvedValue({ spots: initialSpots, occupancy: {} }),
});
const statusOf = (spotId) => screen.getByText(spotId).closest("li");

// A realtime source the test drives by hand.
function manualRealtime() {
  const source = { handlers: null, unsubscribe: jest.fn() };
  source.subscribe = (handlers) => {
    source.handlers = handlers;
    return source.unsubscribe;
  };
  return source;
}

describe("S3-T4 — live lot map (VPS-F-021, VPS-F-022)", () => {
  test("loads the initial lot map from GET /api/lot/status", async () => {
    const api = makeApi();
    render(<LotMap api={api} realtime={manualRealtime()} />);

    expect(await screen.findByText("2W-01")).toBeInTheDocument();
    expect(api.getLotStatus).toHaveBeenCalledTimes(1);
    expect(statusOf("2W-01")).toHaveTextContent(/free/i);
  });

  test("updates the correct spot label when a spot:update event arrives", async () => {
    const realtime = manualRealtime();
    render(<LotMap api={makeApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() => realtime.handlers.onUpdate({ spotId: "2W-02", status: "reserved" }));

    expect(statusOf("2W-02")).toHaveTextContent(/reserved/i);
    expect(statusOf("2W-01")).toHaveTextContent(/free/i);
    expect(statusOf("4W-01")).toHaveTextContent(/free/i);

    act(() => realtime.handlers.onUpdate({ spotId: "2W-02", status: "free" }));
    expect(statusOf("2W-02")).toHaveTextContent(/free/i);
  });

  test("replaces stale lot state with lot:snapshot, and a snapshot beats a late REST response", async () => {
    const realtime = manualRealtime();
    render(<LotMap api={makeApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() =>
      realtime.handlers.onSnapshot([
        { id: "2W-01", zone: "2W", status: "reserved" },
        { id: "4W-01", zone: "4W", status: "reserved" },
      ]),
    );

    expect(statusOf("2W-01")).toHaveTextContent(/reserved/i);
    expect(statusOf("4W-01")).toHaveTextContent(/reserved/i);
    expect(screen.queryByText("2W-02")).not.toBeInTheDocument();
  });

  test("shows the connection state in text", async () => {
    const realtime = manualRealtime();
    render(<LotMap api={makeApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    act(() => realtime.handlers.onStatus("connected"));
    expect(screen.getByText(/live updates on/i)).toBeInTheDocument();
    act(() => realtime.handlers.onStatus("disconnected"));
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });

  test("stays in sync after reconnects through the real socket client, without duplicate listeners", async () => {
    const socket = fakeSocket();
    const realtime = createRealtimeHub(
      createSocketConnection({ getToken: () => "jwt-1", createSocket: () => socket }),
    );
    const { unmount } = render(<LotMap api={makeApi()} realtime={realtime} />);
    await screen.findByText("2W-01");

    act(() => socket.trigger("connect"));
    act(() => socket.trigger("disconnect"));
    act(() => socket.trigger("connect")); // reconnect
    act(() =>
      socket.trigger("lot:snapshot", {
        spots: [
          { id: "2W-01", zone: "2W", status: "reserved" },
          { id: "2W-02", zone: "2W", status: "free" },
          { id: "4W-01", zone: "4W", status: "free" },
        ],
      }),
    );
    act(() => socket.trigger("spot:update", { spotId: "4W-01", status: "reserved" }));

    expect(statusOf("2W-01")).toHaveTextContent(/reserved/i);
    expect(statusOf("4W-01")).toHaveTextContent(/reserved/i);
    expect(socket.emitted.filter(([event]) => event === "identify")).toHaveLength(2);
    expect(socket.listeners["spot:update"]).toHaveLength(1);
    expect(socket.listeners["lot:snapshot"]).toHaveLength(1);

    unmount();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(Object.keys(socket.listeners)).toHaveLength(0);
  });
});
