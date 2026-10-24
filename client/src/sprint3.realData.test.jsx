/** Sprint 3 — T4: real API transport and Socket.io-driven client state. */
import { describe, test } from "@jest/globals";

describe("S3-T4 — real-data client integration (VPS-F-021, VPS-F-022)", () => {
  test.todo("sends the stored bearer token with protected REST requests");
  test.todo("maps API error envelopes into recoverable UI errors");
  test.todo("loads the initial lot map from GET /api/lot/status");
  test.todo("updates the correct spot label when a spot:update event arrives");
  test.todo("replaces stale lot state with lot:snapshot after connect or reconnect");
  test.todo("keeps lot state synchronized after reconnect without duplicate listeners");
  test.todo("refreshes admin occupancy, revenue, and audit data from real API responses");
});
