import { createHttpApi } from "./httpClient.js";
import { clearSession, getToken, saveSession } from "./session.js";

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup({ token = "jwt-123", response = reply(200, {}), ...options } = {}) {
  const fetchImpl = jest.fn().mockResolvedValue(response);
  const api = createHttpApi({ fetchImpl, getToken: () => token, ...options });
  return { api, fetchImpl };
}

describe("S3-T4 — real API transport", () => {
  test("sends the stored bearer token with protected REST requests", async () => {
    const { api, fetchImpl } = setup();
    await api.getLotStatus();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/lot/status");
    expect(init.headers.Authorization).toBe("Bearer jwt-123");
  });

  test("reads the token the session saved for this tab by default", async () => {
    saveSession({ token: "from-session", role: "operator", gateId: "Entry-1" });
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, {}));
    await createHttpApi({ fetchImpl }).getLotStatus();

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer from-session");
    clearSession();
    expect(getToken()).toBeNull();
  });

  test("login sends credentials without a token and does not treat 401 as an expired session", async () => {
    const onUnauthorized = jest.fn();
    const { api, fetchImpl } = setup({
      response: reply(401, { error: { code: "INVALID_CREDENTIALS", message: "Invalid credentials" } }),
      onUnauthorized,
    });

    await expect(api.login({ username: "a", password: "b" })).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid credentials",
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/auth/login");
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ username: "a", password: "b" });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  test("maps API error envelopes into recoverable UI errors", async () => {
    const { api } = setup({
      response: reply(409, { error: { code: "LOT_FULL", message: "No 2W spots available" } }),
    });

    await expect(
      api.createEntry({ plateNumber: "KA01", vehicleType: "2W", gateId: "Entry-1" }),
    ).rejects.toMatchObject({ status: 409, code: "LOT_FULL", message: "No 2W spots available" });
  });

  test("reports an unreachable server with a plain-language message", async () => {
    const api = createHttpApi({
      fetchImpl: jest.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      getToken: () => "t",
    });

    await expect(api.getAuditLog()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringMatching(/cannot reach the server/i),
    });
  });

  test("signals an expired session on a 401 from a protected route", async () => {
    const onUnauthorized = jest.fn();
    const { api } = setup({
      response: reply(401, { error: { code: "UNAUTHORIZED", message: "Invalid or expired token" } }),
      onUnauthorized,
    });

    await expect(api.getOccupancy()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["createEntry", [{ plateNumber: "KA01", vehicleType: "4W", gateId: "Entry-1" }], "POST", "/api/entry/vehicles"],
    ["lookupTicket", ["TKT 1/2"], "GET", "/api/exit/lookup/TKT%201%2F2"],
    ["searchPlate", ["KA01AB1234"], "GET", "/api/exit/search?plateNumber=KA01AB1234"],
    ["processExit", [{ ticketId: "T1", gateId: "Exit-1" }], "POST", "/api/exit/process"],
    ["getOccupancy", [], "GET", "/api/admin/analytics/occupancy"],
    ["getRevenue", [], "GET", "/api/admin/analytics/revenue"],
    ["getTransactions", [{ plate: "KA01" }], "GET", "/api/admin/transactions?plate=KA01"],
    ["getTransactions", [], "GET", "/api/admin/transactions"],
    ["getAuditLog", [], "GET", "/api/admin/audit-log"],
  ])("%s calls %s %s", async (method, args, httpMethod, url) => {
    const { api, fetchImpl } = setup();
    await api[method](...args);

    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(init.method).toBe(httpMethod);
  });

  test("normalises list responses to the shapes the consoles expect", async () => {
    const plates = setup({ response: reply(200, { records: [{ ticketId: "T1" }] }) });
    await expect(plates.api.searchPlate("KA01")).resolves.toEqual([{ ticketId: "T1" }]);

    const bareArray = setup({ response: reply(200, [{ ticketId: "T2" }]) });
    await expect(bareArray.api.searchPlate("KA01")).resolves.toEqual([{ ticketId: "T2" }]);
    await expect(bareArray.api.getTransactions()).resolves.toEqual({ records: [{ ticketId: "T2" }] });
    await expect(bareArray.api.getAuditLog()).resolves.toEqual({ entries: [{ ticketId: "T2" }] });
  });
});
