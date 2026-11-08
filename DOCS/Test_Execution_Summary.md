# Test Execution Summary / Log

**Project:** Vehicle Parking System (Group 14)  
**Sprint:** 4 — Hardening, Simulation Console & Load Test  
**Report owner:** Siddhesh (S4-T5)  
**Last updated:** 2026-11-02

## 1. Execution environment

- CI platform: GitHub Actions
- Server tests: Jest, Supertest and MongoDB service / MongoDB Memory Server
- Client tests: Jest and React Testing Library
- Load test: Grafana k6
- CI workflow: `.github/workflows/ci.yml`

## 2. Sprint 4 task status

| Task | Scope | Evidence / status |
|---|---|---|
| S4-T1 | Concurrent allocation load test | GitHub Actions run [41316712137](https://github.com/Siddhesh249/Vehicle-Parking-System/actions/runs/41316712137): k6 job passed. Its checks and teardown completed without a duplicate spot assignment being reported. |
| S4-T2 | Simulation Console backend | In the same run, `simulationService.unit.test.js` and `simulateRoutes.integration.test.js` passed. |
| S4-T3 | Simulation Console UI | UI component and direct developer route were missing in the baseline run. The implementation is now included in PR #44; final CI verification is pending. |
| S4-T4 | Full regression and five-session demo | `fiveSessionDemo.integration.test.js` passed in baseline run 41316712137. Full regression is not signed off while the S4-T3/S4-T5 checks are unresolved. |
| S4-T5 | Test Execution Summary / Log | This report is the S4-T5 deliverable. |

## 3. Baseline CI results before the current fixes

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

## 4. Fixes included for re-verification

PR #44 adds:
- The developer-only Simulation Console UI at `/dev/simulate`.
- Start/stop controls and arrivals-per-minute validation.
- HTTP and mock API methods used by the console.
- Contribution and branch workflow documentation.

The workflow triggered by PR #44 must be checked after completion. This report deliberately distinguishes the measured baseline from the pending post-fix result.

## 5. Defect and exit-criteria status

Known baseline defects:
1. S4-T3: Simulation Console UI module and direct route were missing. Fix submitted in PR #44; CI confirmation pending.
2. S4-T5: Test Execution Summary / Log was missing. This document addresses the missing deliverable; the server test must be rerun.

**Exit criteria:** NOT YET SIGNED OFF. The baseline run is not fully green. Final sign-off requires the complete server and client CI suites to pass, the k6 concurrent allocation check to pass with zero duplicate spot assignments, and the five-session demo/regression evidence to be confirmed on the final candidate commit.

**Sign-off:** Pending final post-fix CI and demo verification. No claim of full Sprint 4 completion is made until that evidence is available.
