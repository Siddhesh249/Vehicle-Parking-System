# Test Execution Summary / Log

- **Project:** Vehicle Parking System (Group 14)
- **Sprint:** 4 — Hardening, Simulation Console & Load Test
- **Candidate:** `release/v1.0.0` (final stable release)
- **Report owner:** Siddhesh (S4-T5)
- **Last updated:** 2026-11-08
- **Status:** PASS — final candidate signed off

## 1. Execution environment

- Local platform: Linux, Node.js 24.21.0, npm 11.19.0
- Server tests: Jest, Supertest, MongoDB plus MongoDB Memory Server fallback
- Client tests: Jest and React Testing Library
- Load test: Grafana k6 v2.3.0 against an isolated `vehicle_parking_loadtest` database
- CI definition: `.github/workflows/ci.yml` (server tests, formatting, k6 load test, client tests, lint, build)

## 2. Final result summary

| Suite / check                     | Command                                            | Result                                                                          |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| Server unit and integration tests | `npm run test:server`                              | **21 suites passed, 252 tests passed, 0 failed**                                |
| Client unit tests                 | `npm run test:client`                              | **16 suites passed, 91 tests passed, 0 failed**                                 |
| Client lint                       | `npm run lint`                                     | **Passed, 0 errors / 0 warnings**                                               |
| Formatting                        | `npm run format:check`                             | **Passed**                                                                      |
| Client production build           | `VITE_API_MODE=real npm run build --prefix client` | **Passed**                                                                      |
| k6 concurrent allocation (S4-T1)  | `k6 run loadtest/entry-concurrency.js` (50 VUs)    | **Passed: 103/103 checks, 16 successful entries, 0 duplicate spot assignments** |
| One-command regression            | `./test.sh`                                        | **Passed end to end**                                                           |
| Runtime smoke start               | `./run.sh`                                         | **API health connected, client served, admin login returned a valid token**     |

The k6 run intentionally produced 34 `409 LOT_FULL` responses because only 16
spots exist and 50 entry requests were fired simultaneously. Those responses are
correct business behaviour; the script's threshold accepts either a successful
allocation or an explicit full-lot response. Its teardown read the admin
transaction log and found **zero duplicate spot assignments** for the run.

## 3. Sprint 4 task status

| Task  | Scope                                     | Evidence / status                                                                                                                                                                                                                               |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-T1 | Concurrent allocation load test           | `loadtest/entry-concurrency.js` passed with 50 VUs, 100% checks, and zero duplicate `spotId` assignments (VPS-NF-002).                                                                                                                          |
| S4-T2 | Simulation Console backend                | Synthetic arrival generator, runtime rate control, runtime fare overrides, status endpoint, and production/disabling guard are implemented and covered by unit + integration tests (VPS-DEV-001/002).                                           |
| S4-T3 | Simulation Console UI + final polish      | `/dev/simulate` renders from direct URL only, starts/stops traffic, shows arrival counters, and edits runtime fare tiers. Red/white theme, text-labelled spot states, focus styling, and labelled controls verified by RTL tests (VPS-DEV-003). |
| S4-T4 | Regression, bug triage, five-session demo | Full server/client regression green. `fiveSessionDemo.integration.test.js` verifies both entry consoles, both exit consoles, and the admin dashboard receive identical spot updates within the 2-second target (VPS-F-021, VPS-NF-001).         |
| S4-T5 | Test Execution Summary / Log              | This report records the final executed results, defects, and exit-criteria sign-off.                                                                                                                                                            |

## 4. Coverage highlights

- **Authentication and RBAC:** login, lockout, expired/tampered JWT, gate scoping, admin-only routes, socket identification, admin overstay feed isolation.
- **Entry and allocation:** zone matching, atomic claim, lot-full handling, duplicate-active-vehicle protection, server-received FCFS ordering, concurrent sessions.
- **Exit and fare:** ticket lookup, plate fallback, lost-ticket penalty, exact fractional duration, tier boundaries, independent 2W/4W tables, runtime overrides.
- **Admin:** occupancy/revenue analytics, transaction and audit search, fare-tier reads/writes, spot-count growth/shrink rules, overstay feed, force-release with overstay penalty.
- **Realtime:** `lot:snapshot` on connect, `spot:update` on entry/exit/force-release, admin-only `overstay:alert`, reconnect convergence.
- **Client:** all five consoles, login, live lot map, charts, overstay alerts, admin configuration, simulation console, error/empty/loading states, accessibility labels.
- **Data integrity:** append-only audit log, unique active transaction per plate, unique ticket IDs, occupied spots never deleted by configuration changes.

## 5. Defects and fixes completed in this candidate

The baseline Sprint 4 report identified incomplete S4-T3 and S4-T5 work and a
formatting failure. All were resolved:

1. Simulation Console UI now includes live generator state, counters, rate validation, and runtime fare-tier overrides.
2. Admin configuration UI and API reads were completed for fare tiers, penalties, first-hour policy, and spot counts.
3. Automatic overstay detection and an admin overstay feed/broadcast were completed.
4. Standard JSON envelopes were added for unknown routes, malformed JSON, and oversized payloads.
5. `server/app.js` formatting and repository-wide Prettier coverage were fixed.
6. The test harness can fall back to an in-memory MongoDB if no local instance is available.
7. `run.sh` and `test.sh` provide one-command start and one-command full verification.

No critical or high-severity defects remain open. No duplicate allocation,
incorrect fare, cross-gate access, or cross-role access was observed in the final
server, client, or k6 runs.

## 6. Exit criteria

- [x] All High-priority test cases from the SRS/STP RTM pass.
- [x] Zero critical defects remain open.
- [x] No High-priority RTM item is unresolved.
- [x] Full server Jest suite passes.
- [x] Full client Jest suite passes.
- [x] Lint, formatting, and production build pass.
- [x] k6 concurrent allocation check passes with zero duplicate spot assignments.
- [x] Five-session live synchronization is verified automatically.

**Exit criteria: MET.**

**Sign-off:** Siddhesh Dattatray Koditkar (Project Lead & Development Lead),
2026-11-08. This candidate is approved as the first stable release of the
Vehicle Parking System.
