# Server domain models and fare calculation

This folder contains the first domain layer for the Vehicle Parking System.

## Models

- `models/User.js` stores login identity, role, operator gate assignment, and account-lockout state. Operators must have one of the four configured gates; admins do not need a gate assignment. Password hashes are excluded from ordinary query results.
- `models/Spot.js` represents a parking space in the `2W` or `4W` zone. Spot numbers are unique and a new spot defaults to `free`.
- `models/Transaction.js` records a vehicle's entry ticket, plate, spot, gate/operator IDs, and optional exit/fare details. Ticket IDs are unique; transactions default to `active`.
- `models/AuditLog.js` stores timestamped security and parking actions with the actor's ID and role.
- `models/FareTierConfig.js` stores independent rate tables and penalties for two-wheelers and four-wheelers. Hour thresholds must be unique and increasing.

All models use Mongoose schemas and export the registered model when one already exists, avoiding model re-registration errors in tests or hot reloads.

## Fare calculation

`services/fareService.js` exports `calculateFare(entryTimestamp, exitTimestamp, vehicleType, options, customConfig)` and `DEFAULT_FARE_CONFIG`.

- The default first hour is free.
- Rates are prorated by elapsed time; fractional hours are not rounded up.
- The `2W` and `4W` schedules are independent.
- `options.lostTicket` and `options.overstay` add the corresponding configured penalties.
- Invalid dates, exit times before entry, unknown vehicle types, negative rates, and duplicate tier thresholds are rejected.

Example:

```js
const { calculateFare } = require("./services/fareService");

const fare = calculateFare(
  new Date("2026-10-02T10:00:00Z"),
  new Date("2026-10-02T12:30:00Z"),
  "4W"
);
console.log(fare); // 30
```

## Tests

From the `server` directory, install dependencies and run:

```powershell
npm ci
npm test
```

The schema tests require a reachable MongoDB test database. The repository's GitHub Actions workflow provisions MongoDB for CI. Do not put database credentials in committed files; use environment variables or a local `.env` file.
