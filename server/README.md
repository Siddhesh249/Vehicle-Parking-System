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

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login` |
| Lot | `GET /api/lot/status` |
| Entry | `POST /api/entry/vehicles` |
| Exit | `GET /api/exit/lookup/:ticketId`, `GET /api/exit/search`, `POST /api/exit/process` |
| Overstay | `POST /api/overstay/notify`, `GET /api/admin/overstays` |
| Admin analytics | `GET /api/admin/analytics/occupancy`, `GET /api/admin/analytics/revenue` |
| Admin records | `GET /api/admin/transactions`, `GET /api/admin/audit-log` |
| Admin config | `GET/PUT /api/admin/config/fare-tiers`, `GET/PUT /api/admin/config/spots` |
| Admin override | `POST /api/admin/vehicles/:id/force-release` |
| Developer simulation | `GET /api/dev/simulate/status`, `POST /api/dev/simulate/start`, `POST /api/dev/simulate/stop`, `PUT /api/dev/simulate/fare-tiers` |

All protected routes require a Bearer JWT. Gate operators are scoped server-side
to exactly one gate. Admin routes and the overstay feed reject operator tokens.
The simulation routes return 404 in production or when `DISABLE_SIMULATION=true`.

Socket.io events are `identify` (client → server), `lot:snapshot`, `spot:update`,
and `overstay:alert` (server → the authenticated/admin rooms).

## Fare calculation

`services/fareService.js` exports `calculateFare(entryTimestamp, exitTimestamp, vehicleType, options, customConfig)` and `DEFAULT_FARE_CONFIG`.

- The default first hour is free.
- Rates are prorated by elapsed time; fractional hours are not rounded up.
- The `2W` and `4W` schedules are independent.
- `options.lostTicket` and `options.overstay` add the corresponding configured penalties.
- Invalid dates, exit times before entry, unknown vehicle types, negative rates, and duplicate tier thresholds are rejected.

`fareConfigService.js` loads a persisted `FareTierConfig` when one exists, then a
runtime simulation override, so admin and developer changes affect subsequent
exit calculations. The defaults remain the safe fallback until the initial rate
tables are configured.

## Overstay detection

Active transactions are automatically flagged once
`OVERSTAY_THRESHOLD_MINUTES` (default `120`) has elapsed. `index.js` scans every
`OVERSTAY_SCAN_INTERVAL_MS` (default `30000`) and broadcasts newly detected
overstays to the Admin room. Operators can still send an explicit notification.
Only the Admin can force-release the vehicle; that settlement applies the
configured overstay penalty.

## Seeding a local demo

Run `npm run seed` once against the configured database. It creates the four fixed gate
accounts (`entry1`, `entry2`, `exit1`, `exit2`), the `admin` account, and the initial
6 two-wheeler / 10 four-wheeler spots. The local password is `password123` unless
`SEED_PASSWORD` is set; the script is idempotent.

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
