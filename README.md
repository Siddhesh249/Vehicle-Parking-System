# Vehicle Parking System

## 1. What this project is

A Software Engineering course project (Group 14, Problem Statement No. 10) titled **Vehicle Parking System**, built on the **MERN stack** (MongoDB, Express, React, Node.js).

**Team:** Siddhesh Dattatray Koditkar (PES2UG24CS502), Sumukh M Gowda (PES2UG24CS537), Sparsha Arun (PES2UG24CS513), Sinchana Kulkarni (PES2UG24CS504).

## 2. Quick start

Prerequisites: Node.js 24 LTS, npm, MongoDB running locally, and `curl`. k6 is optional unless you want the load test.

```bash
# Starts MongoDB readiness check, seeds accounts/spots, starts the API and
# frontend, then opens the app in your browser. Ctrl+C stops both processes.
./run.sh

# Runs every check in one go: formatting, server Jest, client Jest, lint,
# production build, and the k6 concurrency test when k6 + MongoDB are present.
./test.sh
```

The app opens at **http://localhost:5173**. The API listens on **http://127.0.0.1:5000** and the health check is **http://127.0.0.1:5000/api/health**.

| Account | Role          | Gate    | Password      |
| ------- | ------------- | ------- | ------------- |
| entry1  | Gate operator | Entry-1 | `password123` |
| entry2  | Gate operator | Entry-2 | `password123` |
| exit1   | Gate operator | Exit-1  | `password123` |
| exit2   | Gate operator | Exit-2  | `password123` |
| admin   | Admin         | —       | `password123` |

Set `SEED_PASSWORD` before seeding to use a different local demo password. The seed is idempotent and safe to re-run.

The developer-only Simulation Console is at **http://localhost:5173/dev/simulate**. It is reachable only by direct URL, never from a gate or admin navigation.

## 3. The core idea, in one paragraph

A parking lot has multiple entry gates and multiple exit gates, each staffed by a Gate Operator. A car pulls up to an entry gate, the operator logs its details, and the system allots it a spot (in a two-wheeler or four-wheeler zone) — atomically, so two gates can never grab the same spot. When the car leaves, the exit operator looks the vehicle up (ideally by a ticket ID generated at entry, or by plate number if the ticket is lost — with a penalty in that case) and the system computes an exact, tiered fare. An Admin/Manager, separate from the operators, sees live analytics (revenue, occupancy) and the full raw database that operators are explicitly _not_ allowed to see, and is the only one who can force a stuck/overstayed vehicle's spot to free up.

## 4. The one architectural idea that shapes everything

**There is no real networking, hardware, or deployment in this project.** It is a single Node/Express + Socket.io backend and one MongoDB instance. "Multiple gates" and "multiple terminals" are simulated by opening **multiple browser tabs on one machine**, each logged in as a different user (two entry operators, two exit operators, one admin). Every tab is a live Socket.io client of the same backend, so an action in one tab (a spot gets allotted, an overstay gets flagged) shows up instantly in every other tab. This is the intended demo mechanism: open 5 tabs, log into each as a different role, and watch the system stay in sync live across all of them.

This constraint is why concurrency-safe, atomic database writes matter so much here — multiple "gates" hitting the same backend at once is the normal case, not an edge case.

## 5. Roles — deliberately just two, plus one non-role

- **Gate Operator** — logs in with credentials scoped to exactly one physical gate (Entry-1, Entry-2, Exit-1, or Exit-2; four fixed accounts total). Handles the entry/exit flow for that gate only. Cannot see historical database records, analytics, or other gates' activity.
- **Admin / Manager** — one root-access account. Sees live occupancy, revenue/occupancy analytics, and the full transaction/audit log. Is notified by operators about overstays and is the only one who can force-release a spot. Configures fare tiers and spot counts.
- **Simulation Console (NOT a user role)** — see section 9. This was a deliberate design call: don't invent a fake "root/hacker-man" persona for demo controls, because a real parking lot admin would never have a "spawn more traffic" button. Keeping it out of the role model keeps the SRS honest and the FR list uncluttered.

## 6. Entry flow

1. Vehicle arrives at an entry gate; operator logs plate number and vehicle type (2W/4W).
2. System finds an available spot in the matching zone and allots it via an **atomic** database operation — this is the mechanism that prevents two simultaneous entry requests from ever getting the same spot.
3. Multiple simultaneous requests across gates are served strictly **first-come-first-served** by server-received timestamp.
4. If the zone is full, the vehicle is turned away — no waitlist, no queueing beyond FCFS ordering of allocation requests.
5. On successful allocation, a **unique Ticket ID** is generated and shown to the operator (with a QR-style visual). This isn't for a real scanner — there's no camera or hardware — it exists purely as a fast lookup key at exit, replacing a second manual plate-number entry.

## 7. Exit flow & fare rules

1. Operator looks the vehicle up by Ticket ID (fast path) or by plate number (fallback — this is the "lost ticket" case, since without the ID a manual DB search is the only recourse).
2. Losing the ticket triggers a **penalty**, added to the computed fare — the ticket ID's value _is_ that it lets you skip this.
3. Fare is computed on the **exact** duration (down to the second/decimal — no rounding): **first hour free**, then hourly charges that **increase every 2–3 hours**. Two-wheelers and four-wheelers have **independently configurable** rate tables.
4. On confirmed exit, the spot is immediately marked free (live, across all tabs) and the finalized transaction (plate, times, duration, fare, gate, operator) is permanently recorded.

The Admin dashboard can edit the fare tiers, first-hour policy, lost-ticket/overstay penalties, and per-zone spot counts at runtime. Changes apply to subsequent exits without a redeploy.

## 8. Overstay handling

- A vehicle is flagged "overstayed" once its parked duration crosses the configurable threshold (`OVERSTAY_THRESHOLD_MINUTES`, default 120 minutes). The Admin dashboard refreshes the automatic overstay feed every 30 seconds, and the server broadcasts a new alert to connected admin tabs on its own periodic scan.
- The operator can also **notify the Admin** explicitly; that notification is broadcast immediately.
- Only the **Admin** can force-release the spot.
- A force-release **automatically applies an overstay penalty** to the fare.

## 9. Simulation Console (developer-only)

- Generates synthetic arrivals at 1–600 per minute across both entry gates.
- Applies runtime fare-tier overrides, so a demo can show a changed fare without editing the database or restarting the server.
- Is excluded from the Gate Operator and Admin role navigation. In production (`NODE_ENV=production`) or when `DISABLE_SIMULATION=true`, its routes return 404.
- Its k6 load-test companion is `loadtest/entry-concurrency.js`.

## 10. Frontend look and feel

- Minimalist. Red-and-white theme with red accents. Explicitly **not** animation-heavy — "just a pretty visual."
- The parking lot is shown as a live grid of spots, green = free, red = reserved, split visually into 2W and 4W zones. Every spot also has a text status label, so status is never conveyed by colour alone.
- All open sessions (both entry consoles, both exit consoles, admin dashboard) show an **identical, live-updating** view — the Socket.io broadcast requirement and the main "wow" moment for a demo.
- Admin dashboard additionally has revenue-over-time and occupancy-over-time charts, a searchable full transaction/audit log, overstay alerts with force-release, and fare/spot configuration — none of which operators can see.

## 11. Configuration

| Variable                     | Where         | Default                 | Purpose                                        |
| ---------------------------- | ------------- | ----------------------- | ---------------------------------------------- |
| `MONGO_URI`                  | `server/.env` | local `vehicle_parking` | MongoDB connection string                      |
| `PORT`                       | `server/.env` | `5000`                  | API port                                       |
| `CLIENT_URL`                 | `server/.env` | `http://localhost:5173` | Allowed browser origin                         |
| `JWT_SECRET`                 | `server/.env` | dev fallback            | JWT signing secret; required in production     |
| `OVERSTAY_THRESHOLD_MINUTES` | environment   | `120`                   | Automatic overstay threshold                   |
| `OVERSTAY_SCAN_INTERVAL_MS`  | environment   | `30000`                 | Background overstay scan interval              |
| `DISABLE_SIMULATION`         | environment   | unset                   | Set `true` to hide developer simulation routes |
| `VITE_API_MODE`              | client env    | `mock`                  | `real` talks to the backend; `mock` is offline |
| `CLIENT_PORT` / `PORT`       | `./run.sh`    | `5173` / `5000`         | Ports used by the convenience launcher         |

Copy `server/.env.example` to `server/.env` for a custom local setup. Never commit `.env` files or real credentials.

## 12. Manual development commands

The repository has separate `client` and `server` npm packages, plus root scripts for running the project checks together. Install dependencies once, then run the complete suite from the repository root:

```bash
npm ci
npm ci --prefix server
npm ci --prefix client
npm test
```

`npm test` runs the server Jest suite followed by the client React Testing Library suite. The server suite uses a separate database named `<MONGO_DB>_test` (default `vehicle_parking_test`) and clears its collections between tests. If a local MongoDB is not reachable, the suite falls back to `mongodb-memory-server`. Set `MONGO_URI` in `server/.env` when the local MongoDB uses a URI different from the defaults.

To run the real HTTP + Socket.io application without the launcher:

```bash
npm --prefix server run seed
npm --prefix server run dev
```

Then set `VITE_API_MODE=real` in `client/.env` and run `npm --prefix client run dev` (see `client/README.md`).

The server JWT secret is read from `JWT_SECRET`. The development fallback is for local tests only; production startup must provide a secret. The client defaults to the in-memory mock so UI work can run without a backend; `VITE_API_MODE=real` switches it to the real REST and Socket.io transport.

## 13. Test suites

- **Server**: Jest + Supertest, MongoDB Memory Server / isolated test database, Socket.io integration tests, Sprint 4 five-session demo test.
- **Client**: Jest + React Testing Library for all consoles, live lot map, realtime hub, HTTP transport, admin configuration, simulation console, and accessibility-oriented component behaviour.
- **Load/concurrency**: k6 (`loadtest/entry-concurrency.js`) fires 50+ simultaneous entry requests and fails on any duplicate `spotId`. `./test.sh` runs it against an isolated `vehicle_parking_loadtest` database.

`DOCS/Test_Execution_Summary.md` records the final execution result and Sprint 4 sign-off.
