import { io } from "socket.io-client";
import { getToken as getStoredToken } from "../api/session.js";

const toSpots = (payload) =>
  (Array.isArray(payload) ? payload : (payload?.spots ?? [])).map((spot) => ({
    id: spot.id ?? spot.spotId,
    zone: spot.zone,
    status: spot.status,
  }));

// Socket.io client for the SAD 4.3.8 events. `connect(handlers)` returns a disconnect function;
// the mock realtime source exposes the same interface.
export function createSocketConnection({
  url,
  getToken = getStoredToken,
  createSocket = (target, options) => io(target, options),
} = {}) {
  return function connect({ onSnapshot, onUpdate, onOverstay, onStatus } = {}) {
    if (!getToken()) {
      onStatus?.("signed-out");
      return () => {};
    }

    const socket = createSocket(url, { autoConnect: false });

    // Listeners are registered once per socket. A reconnect only re-sends `identify`, so
    // there are never duplicate listeners, and the server's fresh lot:snapshot replaces
    // whatever state was missed while offline.
    socket.on("connect", () => {
      onStatus?.("connected");
      socket.emit("identify", { token: getToken() });
    });
    socket.on("disconnect", () => onStatus?.("disconnected"));
    socket.on("connect_error", () => onStatus?.("disconnected"));
    socket.on("lot:snapshot", (payload) => onSnapshot?.(toSpots(payload)));
    socket.on("spot:update", (payload) =>
      onUpdate?.({ spotId: payload.spotId ?? payload.id, status: payload.status }),
    );
    socket.on("overstay:alert", (payload) => onOverstay?.(payload));

    socket.connect();
    return () => {
      socket.off();
      socket.disconnect();
    };
  };
}
