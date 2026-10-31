/**
 * Sprint 4 — S4-T1: multi-gate concurrent allocation load test (VPS-NF-002).
 *
 * This is a k6 scenario, not a Jest test. It fires simultaneous entry requests
 * across Entry-1 and Entry-2 and fails if two vehicles end up in the same spot.
 *
 * Prerequisites:
 *   - A running backend and MongoDB, seeded with operators/spots.
 *   - k6 installed (https://grafana.com/docs/k6/latest/set-up/install-k6/).
 *
 * Run:
 *   k6 run loadtest/entry-concurrency.js
 *   VUS=100 BASE_URL=http://127.0.0.1:5000 k6 run loadtest/entry-concurrency.js
 *
 * The teardown reads the admin transaction log for this run and verifies that
 * every successful allocation has a unique spotId.
 */
import http from "k6/http";
import { check, fail } from "k6";
import { Counter, Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:5000";
const VUS = Number(__ENV.VUS || 50);
const PASSWORD = __ENV.SEED_PASSWORD || "password123";

const entryRequestOk = new Rate("entry_request_ok");
const entriesCreated = new Counter("entries_created");

export const options = {
  scenarios: {
    concurrent_entries: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "30s",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    entry_request_ok: ["rate==1"],
  },
};

function login(username) {
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(response, { [`login ${username} succeeds`]: (res) => res.status === 200 });
  return response.json("token");
}

export function setup() {
  return {
    entry1: login(__ENV.ENTRY1_USER || "entry1"),
    entry2: login(__ENV.ENTRY2_USER || "entry2"),
    admin: login(__ENV.ADMIN_USER || "admin"),
    startedAt: new Date().toISOString(),
  };
}

export default function (data) {
  const gateNumber = (__VU % 2) + 1;
  const token = gateNumber === 1 ? data.entry1 : data.entry2;
  const vehicleType = __VU % 4 < 2 ? "4W" : "2W";
  const nonce = String(Date.now()).slice(-6);
  const plateNumber = `K6${String(__VU).padStart(2, "0")}${String(__ITER).padStart(2, "0")}${nonce}`;

  const response = http.post(
    `${BASE_URL}/api/entry/vehicles`,
    JSON.stringify({
      plateNumber,
      vehicleType,
      gateId: `Entry-${gateNumber}`,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    },
  );

  const accepted = response.status === 201;
  const lotFull = response.status === 409 && response.json("error.code") === "LOT_FULL";
  const ok = check(response, {
    "entry is accepted or correctly reports a full lot": () => accepted || lotFull,
    "accepted entry returns a ticket and spot": (res) =>
      !accepted || Boolean(res.json("ticketId") && res.json("spotId")),
  });

  entryRequestOk.add(ok);
  if (accepted) entriesCreated.add(1);
}

export function teardown(data) {
  const response = http.get(
    `${BASE_URL}/api/admin/transactions?from=${encodeURIComponent(data.startedAt)}`,
    { headers: { Authorization: `Bearer ${data.admin}` } },
  );

  if (response.status !== 200) {
    fail(`could not read the transaction log for the load test (${response.status})`);
  }

  const records = response.json("records") || [];
  const runRecords = records.filter(
    (record) =>
      typeof record.plateNumber === "string" && record.plateNumber.startsWith("K6"),
  );
  const spotOwners = new Map();
  const duplicates = [];

  for (const record of runRecords) {
    const spotId = String(record.spotId);
    if (spotOwners.has(spotId)) {
      duplicates.push(spotId);
    } else {
      spotOwners.set(spotId, record.plateNumber);
    }
  }

  if (duplicates.length > 0) {
    fail(`duplicate spot assignments detected: ${duplicates.join(", ")}`);
  }
}
