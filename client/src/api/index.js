import { createRealtimeHub } from "../realtime/realtimeHub.js";
import { createSocketConnection } from "../realtime/socketConnection.js";
import { createHttpApi } from "./httpClient.js";
import { mockApi } from "./mockApi.js";
import { clearSession } from "./session.js";

// __API_MODE__ is injected by vite.config.js from VITE_API_MODE ("real" or "mock", default mock).
// It is undefined under Jest, which therefore always runs against the mock.
export const apiMode = typeof __API_MODE__ === "undefined" ? "mock" : __API_MODE__;

const useReal = apiMode === "real";

export const api = useReal ? createHttpApi({ onUnauthorized: clearSession }) : mockApi;
export const realtime = createRealtimeHub(
  useReal ? createSocketConnection() : mockApi.realtime.connect,
);
