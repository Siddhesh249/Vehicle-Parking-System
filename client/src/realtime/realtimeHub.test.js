import { createRealtimeHub } from "./realtimeHub.js";

function setup() {
  const disconnect = jest.fn();
  let handlers;
  const connect = jest.fn((h) => {
    handlers = h;
    return disconnect;
  });
  return { hub: createRealtimeHub(connect), connect, disconnect, push: (name, v) => handlers[name](v) };
}

describe("realtime hub", () => {
  test("opens one connection for many subscribers and fans events out to all", () => {
    const { hub, connect, push } = setup();
    const a = { onUpdate: jest.fn() };
    const b = { onUpdate: jest.fn() };
    hub.subscribe(a);
    hub.subscribe(b);
    push("onUpdate", { spotId: "2W-01", status: "free" });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(a.onUpdate).toHaveBeenCalledWith({ spotId: "2W-01", status: "free" });
    expect(b.onUpdate).toHaveBeenCalledWith({ spotId: "2W-01", status: "free" });
  });

  test("closes the connection only when the last subscriber leaves, and can reopen", () => {
    const { hub, connect, disconnect } = setup();
    const offA = hub.subscribe({});
    const offB = hub.subscribe({});

    offA();
    expect(disconnect).not.toHaveBeenCalled();
    offB();
    expect(disconnect).toHaveBeenCalledTimes(1);

    hub.subscribe({});
    expect(connect).toHaveBeenCalledTimes(2);
  });

  test("tells a late subscriber the current connection status", () => {
    const { hub, push } = setup();
    hub.subscribe({});
    push("onStatus", "connected");

    const late = { onStatus: jest.fn() };
    hub.subscribe(late);
    expect(late.onStatus).toHaveBeenCalledWith("connected");
  });
});
