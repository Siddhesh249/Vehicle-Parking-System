import { getToken as getStoredToken } from "./session.js";

// Rejections look like { status, code, message } (an Error, so `message` always works),
// matching the server's { error: { code, message } } envelope (SAD 4.4).
export function apiError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function toQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

const asList = (payload, key) =>
  Array.isArray(payload) ? { [key]: payload } : (payload ?? { [key]: [] });

// Real REST client with the same methods as the mock API (SAD 4.3).
export function createHttpApi({
  baseUrl = "/api",
  fetchImpl = (...args) => globalThis.fetch(...args),
  getToken = getStoredToken,
  onUnauthorized,
} = {}) {
  async function request(path, { method = "GET", body, query, auth = true } = {}) {
    const headers = { Accept: "application/json" };
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}${toQuery(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw apiError(
        0,
        "NETWORK_ERROR",
        "Cannot reach the server. Check your connection and try again.",
      );
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // Empty or non-JSON body.
    }

    if (!response.ok) {
      if (response.status === 401 && auth) onUnauthorized?.();
      const detail = payload?.error ?? {};
      throw apiError(
        response.status,
        detail.code,
        detail.message || `Request failed (${response.status})`,
      );
    }
    return payload;
  }

  return {
    login: ({ username, password }) =>
      request("/auth/login", {
        method: "POST",
        body: { username, password },
        auth: false,
      }),

    getLotStatus: () => request("/lot/status"),
    createEntry: (entry) => request("/entry/vehicles", { method: "POST", body: entry }),

    lookupTicket: (ticketId) => request(`/exit/lookup/${encodeURIComponent(ticketId)}`),
    searchPlate: async (plateNumber) => {
      const payload = await request("/exit/search", { query: { plateNumber } });
      return payload?.records ?? payload ?? [];
    },
    processExit: (exit) => request("/exit/process", { method: "POST", body: exit }),
    notifyOverstay: ({ vehicleId, gateId }) =>
      request("/overstay/notify", { method: "POST", body: { vehicleId, gateId } }),

    getOccupancy: () => request("/admin/analytics/occupancy"),
    getRevenue: () => request("/admin/analytics/revenue"),
    getTransactions: async ({ plate } = {}) =>
      asList(await request("/admin/transactions", { query: { plate } }), "records"),
    getAuditLog: async () => asList(await request("/admin/audit-log"), "entries"),
    forceRelease: (vehicleId) =>
      request(`/admin/vehicles/${encodeURIComponent(vehicleId)}/force-release`, {
        method: "POST",
      }),
  };
}
