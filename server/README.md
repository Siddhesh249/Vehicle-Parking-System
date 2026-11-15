# Vehicle Parking System server

Express + Mongoose + Socket.io backend for the Vehicle Parking System.

## Models

- `models/Vehicle.js` stores normalized, unique plate numbers and their `2W` or `4W` type.
- `models/User.js` stores login identity, role, operator gate assignment, and account-lockout state. Operators must have one of the four configured gates; admins do not need a gate assignment. Password hashes are excluded from ordinary query results.
- `models/Spot.js` represents a parking space in the `2W` or `4W` zone. Spot numbers are unique and a new spot defaults to `free`.
- `models/Transaction.js` records a vehicle's entry ticket, plate, spot, gate/operator IDs, and optional exit/fare details. Ticket IDs are unique; transactions default to `active`. A partial unique index allows history but only one active transaction per plate.
- `models/AuditLog.js` stores timestamped security and parking actions with the actor's ID and role. It rejects update/delete operations to preserve append-only history.
- `models/FareTierConfig.js` stores independent rate tables and penalties for two-wheelers and four-wheelers. Hour thresholds must be unique and increasing.

All models use Mongoose schemas and export the registered model when one already exists, avoiding model re-registration errors in tests or hot reloads.

## Services and routes

| Area                 | Endpoints                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                 | `POST /api/auth/login`                                                                                                                                                                                    |
| Lot                  | `GET /api/lot/status`                                                                                                                                                                                     |
| Entry                | `POST /api/entry/vehicles`                                                                                                                                                                                |
| Exit                 | `GET /api/exit/lookup/:ticketId`, `GET /api/exit/search`, `POST /api/exit/process`                                                                                                                        |
| Overstay             | `POST /api/overstay/notify`, `GET /api/admin/overstays`                                                                                                                                                   |
| Admin analytics      | `GET /api/admin/analytics/occupancy`, `GET /api/admin/analytics/revenue`                                                                                                                                  |
| Admin records        | `GET /api/admin/transactions`, `GET /api/admin/audit-log`, `GET /api/admin/database`                                                                                                                      |
| Admin config         | `GET/PUT /api/admin/config/fare-tiers`, `GET/PUT /api/admin/config/spots`                                                                                                                                 |
| Admin override       | `POST /api/admin/vehicles/:id/force-release`                                                                                                                                                              |
| Developer simulation | `GET /api/dev/simulate/status`, `POST /api/dev/simulate/start`, `POST /api/dev/simulate/stop`, `PUT /api/dev/simulate/rate`, `GET/PUT/DELETE /api/dev/simulate/fare-tiers`                                |
| Demo bot queues      | `GET /api/dev/simulate/queue/entry`, `POST /api/dev/simulate/queue/entry/admit`, `GET /api/dev/simulate/queue/exit`, `POST /api/dev/simulate/queue/exit/scan`, `POST /api/dev/simulate/queue/exit/settle` |

All protected routes require a Bearer JWT. Gate operators are scoped server-side
to exactly one gate. Admin routes and the overstay feed reject operator tokens.
The simulation routes return 404 in production or when `DISABLE_SIMULATION=true`.

Socket.io events are `identify` (client → server), `lot:snapshot`, `spot:update`,
and `overstay:alert` (server → the authenticated/admin rooms).

## Demo bot fleet

`services/simulationService.js` keeps an in-memory fleet of demo customers. A
tick spawns arrivals at the configured rate (up to 8 waiting per gate), parks
each car only when the signed-in entry operator calls the admit route, and moves
it to an exit queue after its intended simulated stay. At that moment the spot
is freed (with a transaction ownership check so a newly parked car is never
released) and billing is frozen. The exit operator scans the bot to get a fare
quote and then settles it through the ordinary `processExit` path, so
transactions, audit entries and revenue are real. The `markBotSettled` hook
also retires a bot when an admin force-releases it.

`services/databaseService.js` powers `GET /api/admin/database`: it returns up to
250 rows from each collection for the admin's read-only database browser. The
users projection strips `passwordHash`.

## Fare calculation

`services/fareService.js` exports `calculateFare(entryTimestamp, exitTimestamp, vehicleType, options, customConfig)` and `DEFAULT_FARE_CONFIG`.

- The default first hour is free.
- Rates are prorated by elapsed time; fractional hours are not rounded up.
- The demo clock uses `SIMULATED_HOUR_SECONDS` (default `5`), so five real
  seconds are billed as one hour. Fares, overstay checks and UI timers all use
  this same simulated clock.
- A transaction's optional `parkingEndTimestamp` freezes billing and overstay
  checks when the car leaves its spot for the exit queue, even if payment is
  collected later.
- The `2W` and `4W` schedules are independent.
- `options.lostTicket` and `options.overstay` add the corresponding configured penalties.
- Invalid dates, exit times before entry, unknown vehicle types, negative rates, and duplicate tier thresholds are rejected.

`fareConfigService.js` loads a persisted `FareTierConfig` when one exists, then a
runtime simulation override, so admin and developer changes affect subsequent
exit calculations. The defaults remain the safe fallback until the initial rate
tables are configured.

## Overstay detection

The Admin configures the overstay threshold in hours (`GET/PUT
/api/admin/config/overstay`). The default is 24 simulated hours (2 real minutes
on the demo clock). It must be at least the highest fare-tier
threshold, and the same rule is enforced when fare tiers are edited. Active
transactions are automatically flagged once that simulated duration has
elapsed. `index.js` scans every `OVERSTAY_SCAN_INTERVAL_MS` (default `5000`)
and broadcasts newly detected overstays to the Admin room. Exit operators can
also click a blinking overstay spot in the lot map to notify the Admin. Only the
Admin can force-release the vehicle; that settlement applies the configured
overstay penalty.

## Seeding a local demo

Run `npm run seed` once against the configured database. It creates the four fixed gate
accounts (`entry1`, `entry2`, `exit1`, `exit2`), the `admin` account, the initial
6 two-wheeler / 10 four-wheeler spots, and sample activity: six active vehicles
with live timers (all below the 24-hour overstay threshold at launch), a week of
completed sessions for the revenue and occupancy charts, and audit history. The local password is
`password123` unless
`SEED_PASSWORD` is set; the script is idempotent. Set `SEED_DEMO_DATA=false` to
seed only accounts/spots, which the isolated k6 database does. Set
`SEED_RESET_DEMO=true` to clear operational collections, fare/system config and
recreate the clean demo lot; `run.sh` does this by default so revenue and
overstay flags do not carry over between demo sessions.

## Running and tests

```bash
npm start          # node index.js
npm run dev        # node --watch index.js
npm test           # Jest + Supertest
```

From the repository root, `./run.sh` starts the complete app and `./test.sh`
runs every check including the k6 concurrency test. The server Jest config loads
`server/.env` and connects to `<MONGO_DB>_test`, keeping test writes away from
the application database. If no local MongoDB is reachable, the test harness
falls back to `mongodb-memory-server`. The root test script starts Jest with the
Node VM module support required by MongoDB driver 7.
