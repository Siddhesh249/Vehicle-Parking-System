import { createSocketConnection } from "./socketConnection.js";
import { fakeSocket } from "./testSocket.js";

function setup(token = "jwt-1") {
  const socket = fakeSocket();
  const handlers = {
    onSnapshot: jest.fn(),
    onUpdate: jest.fn(),
    onOverstay: jest.fn(),
    onStatus: jest.fn(),
  };
  const connect = createSocketConnection({
    getToken: () => token,
    createSocket: () => socket,
  });
  const disconnect = connect(handlers);
  return { socket, handlers, disconnect };
}

describe("S3-T4 — Socket.io client", () => {
  test("identifies with the stored token on connect and again after every reconnect", () => {
    const { socket, handlers } = setup();
    expect(socket.connect).toHaveBeenCalledTimes(1);

    socket.trigger("connect");
    socket.trigger("disconnect");
    socket.trigger("connect");

    expect(socket.emitted).toEqual([
      ["identify", { token: "jwt-1" }],
      ["identify", { token: "jwt-1" }],
    ]);
    expect(handlers.onStatus.mock.calls.map(([s]) => s)).toEqual([
      "connected",
      "disconnected",
      "connected",
    ]);
  });

  test("keeps exactly one listener per event across reconnects (no duplicates)", () => {
    const { socket } = setup();
    for (let i = 0; i < 3; i += 1) socket.trigger("connect");

    for (const event of ["lot:snapshot", "spot:update", "overstay:alert", "connect"]) {
      expect(socket.listeners[event]).toHaveLength(1);
    }
  });

  test("passes spot updates and snapshots through in the client's shape", () => {
    const { socket, handlers } = setup();
    socket.trigger("spot:update", { spotId: "4W-01", status: "reserved" });
    socket.trigger("lot:snapshot", {
      spots: [{ spotId: "2W-01", spotNumber: "2W-001", zone: "2W", status: "free" }],
    });
    socket.trigger("lot:snapshot", [{ id: "4W-02", zone: "4W", status: "reserved" }]);
    socket.trigger("overstay:alert", {
      vehicleId: "v1",
      ticketId: "TKT-1",
      plateNumber: "KA01",
      gateId: "Exit-1",
      duration: 9000,
    });

    expect(handlers.onUpdate).toHaveBeenCalledWith({
      spotId: "4W-01",
      status: "reserved",
    });
    expect(handlers.onSnapshot).toHaveBeenNthCalledWith(1, [
      { id: "2W-01", spotNumber: "2W-001", zone: "2W", status: "free" },
    ]);
    expect(handlers.onSnapshot).toHaveBeenNthCalledWith(2, [
      { id: "4W-02", zone: "4W", status: "reserved" },
    ]);
    expect(handlers.onOverstay).toHaveBeenCalledWith({
      vehicleId: "v1",
      ticketId: "TKT-1",
      plateNumber: "KA01",
      gateId: "Exit-1",
      duration: 9000,
    });
  });

  test("disconnecting removes every listener and closes the socket", () => {
    const { socket, disconnect } = setup();
    disconnect();

    expect(socket.off).toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(Object.keys(socket.listeners)).toHaveLength(0);
  });

  test("does not connect without a token", () => {
    const createSocket = jest.fn();
    const onStatus = jest.fn();
    createSocketConnection({ getToken: () => null, createSocket })({ onStatus });

    expect(createSocket).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith("signed-out");
  });
});
