# Test Execution Summary / Log

**Project:** Vehicle Parking System (Group 14)  
**Sprint:** 4 — Hardening, Simulation Console & Load Test  
**Report owner:** Siddhesh (S4-T5)  
**Last updated:** 2026-11-14

## 1. Execution environment

- CI platform: GitHub Actions
- Server tests: Jest, Supertest and MongoDB service / MongoDB Memory Server
- Client tests: Jest and React Testing Library
- Load test: Grafana k6
- CI workflow: `.github/workflows/ci.yml`

## 2. Sprint 4 task status

| Task  | Scope                                 | Evidence / status                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4-T1 | Concurrent allocation load test       | GitHub Actions run [41316712137](https://github.com/Siddhesh249/Vehicle-Parking-System/actions/runs/41316712137) passed, and the final local k6 run on this branch also passed with zero duplicate spot assignments (see section 4).                                                                                 |
| S4-T2 | Simulation Console backend            | `simulationService.unit.test.js` and `simulateRoutes.integration.test.js` pass in the final server run.                                                                                                                                                                                                              |
| S4-T3 | Simulation Console UI                 | Delivered through PR #44 and the merged simulation UI work: the developer-only `/dev/simulate` route, live counters, fare override and lot map. Covered by `SimulationConsole.test.jsx`, `SimulationConsoleRoute.test.jsx`, `SimulationStats.test.jsx`, `FareOverrideForm.test.jsx` and `AppAccessibility.test.jsx`. |
| S4-T4 | Full regression and five-session demo | `fiveSessionDemo.integration.test.js` passes, and the complete server and client suites pass in the final run recorded below.                                                                                                                                                                                        |
| S4-T5 | Test Execution Summary / Log          | This report is the S4-T5 deliverable.                                                                                                                                                                                                                                                                                |

## 3. Baseline CI results before the fixes

Source: GitHub Actions run [41316712137](https://github.com/Siddhesh249/Vehicle-Parking-System/actions/runs/41316712137), commit `11783d1f5e22dff9cea8f42672e0092a6ae06fe6`.

### Server — unit and integration tests

- Test suites: 18 passed, 1 failed (19 total).
- Tests: 236 passed, 3 failed (239 total).
- Passed suites included schemas, fare calculation, allocation, fare/exit, authentication, controllers, realtime, end-to-end, simulation service and simulation routes.
- The three failures were in `tests/sprint4/testExecutionSummary.test.js`, because this report did not yet exist.

### Client — unit tests

- Test suites: 13 passed, 2 failed (15 total).
- Tests: 73 passed, 1 failed (74 total).
- The failures were the missing `SimulationConsole.jsx` module and the missing direct `/dev/simulate` page heading.

### k6 — S4-T1 concurrent allocation

- Job: passed.
- The workflow accepted the concurrent entry requests or correctly reported a full lot.
- The teardown did not report duplicate spot assignments.

## 4. Final verification on `feat/sprint4-final-completion`

Run locally on 2026-11-14 through `bash test.sh` (formatting, server tests, client tests, lint, production build and k6).

### Formatting, lint and build

- Prettier: pass.
- ESLint (client): pass.
- Client production build with `VITE_API_MODE=real`: pass.

### Server — Jest + Supertest

- Test suites: 25 passed, 0 failed (25 total).
- Tests: 273 passed, 0 failed (273 total).

### Client — Jest + React Testing Library

- Test suites: 21 passed, 0 failed (21 total).
- Tests: 144 passed, 0 failed (144 total).

### Demo traffic and UI refinement pass

- Entry and exit consoles now drive an operator-assisted bot fleet: bots wait for
  a ticket, park for their intended stay, then queue at an exit gate for a scan
  and payment. Covered by `simulationService.unit.test.js`,
  `botQueue.integration.test.js` and the client bot-panel tests.
- The app now opens on the sign-in page with one-click demo credential fill.
- Parking time and billing stop when a car joins the exit queue, the freed spot
  can be reused immediately, and the admin database access is covered by
  `parkingEnd.integration.test.js` and `botQueue.integration.test.js`.
- `run.sh` resets operational demo data before seeding, so revenue and overstay
  flags start from a clean average state.

### k6 — S4-T1 concurrent allocation

- 50 virtual users made one entry attempt each against a seeded lot.
- Checks: 103 passed, 0 failed (100%).
- Accepted entries: 16; the remaining 34 requests were correctly rejected because the lot was full.
- `entry_request_ok`: 100% — every request returned a correct success or full-lot result.
- Teardown reported zero duplicate spot assignments.

## 5. Defects and exit-criteria status

Resolved defects:

1. S4-T3: the Simulation Console UI module and direct developer route are present and covered by client tests.
2. S4-T5: this report exists and is checked by `tests/sprint4/testExecutionSummary.test.js`.

**Exit criteria:** signed off on the final candidate branch. The complete server and client suites pass, the k6 concurrent allocation check passes with zero duplicate spot assignments, and the five-session demo/regression evidence is green.

**Sign-off:** Sprint 4 completion verified on `feat/sprint4-final-completion` on 2026-11-14.
