# Local MongoDB setup

This workstation runs MongoDB locally in Docker for the Vehicle Parking System.

## Current container

- Container: `vehicle-parking-mongodb`
- Image: `mongo:8.0` (currently MongoDB `8.0.32`)
- Host binding: `127.0.0.1:27017 -> container:27017`
- Data volume: `mongodb_data` mounted at `/data/db`
- Root username: `admin`
- Root password: `VPS`

The credentials and port were verified from the running container configuration on
2026-10-17. Do not commit credentials or machine-specific values to source
control. `server/.env` is intentionally ignored by Git.

## Server configuration

`server/.env` contains the local connection settings:

```dotenv
MONGO_USER=admin
MONGO_PASSWORD=VPS
MONGO_HOST=127.0.0.1
MONGO_PORT=27017
MONGO_DB=vehicle_parking
MONGO_AUTH_DB=admin
PORT=5000
CLIENT_URL=http://localhost:5173
```

The server builds this connection string:

```text
mongodb://admin:VPS@127.0.0.1:27017/vehicle_parking?authSource=admin
```

## Checks and useful commands

From the repository root:

```bash
docker ps --filter name=vehicle-parking-mongodb
docker start vehicle-parking-mongodb
docker stop vehicle-parking-mongodb
docker logs vehicle-parking-mongodb
```

Start the backend with:

```bash
cd server
npm start
```

The API should be available at `http://127.0.0.1:5000`; its health endpoint is
`http://127.0.0.1:5000/api/health`.

## Important test note

The server tests currently default to `vps_app` and `authSource=vehicle_parking`
when environment variables are not exported. Those defaults do not match this
machine's Docker root account (`admin` with `authSource=admin`). Run tests with
the values from `server/.env` exported if a test needs the live database, for
example:

```bash
set -a
source server/.env
set +a
cd server
npm test
```

Some tests are written to try an in-memory MongoDB first and then fall back to a
live MongoDB connection. If a test still hangs, use Jest's per-test timeout or
inspect the test's database setup; installing npm packages alone will not repair
an authentication or test-lifecycle problem.
