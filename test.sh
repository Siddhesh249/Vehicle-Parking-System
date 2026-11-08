#!/usr/bin/env bash
# Run every project check in one go: formatting, server Jest, client Jest,
# lint, production build, and the Sprint 4 k6 concurrency test when available.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LOAD_PORT="${LOADTEST_PORT:-5100}"
LOAD_MONGO_URI="${LOADTEST_MONGO_URI:-mongodb://127.0.0.1:27017/vehicle_parking_loadtest}"
LOAD_LOG="${TMPDIR:-/tmp}/vps-loadtest-server.log"
LOAD_PID=""

log() { printf '\n\033[1;31m[test]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[test] SKIP:\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[test] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  local status="${1:-0}"
  trap - EXIT INT TERM
  if [[ -n "$LOAD_PID" ]] && kill -0 "$LOAD_PID" 2>/dev/null; then
    kill "$LOAD_PID" 2>/dev/null || true
  fi
  wait "$LOAD_PID" 2>/dev/null || true
  exit "$status"
}
trap 'status=$?; cleanup "$status"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

command -v node >/dev/null 2>&1 || fail "Node.js is required."
command -v npm >/dev/null 2>&1 || fail "npm is required."

log "Checking dependencies"
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -d server/node_modules ]]; then npm ci --prefix server; fi
if [[ ! -d client/node_modules ]]; then npm ci --prefix client; fi

log "Formatting check"
npm run format:check

log "Server unit and integration tests (Jest + Supertest)"
npm run test:server

log "Client unit tests (Jest + React Testing Library)"
npm run test:client

log "Client lint"
npm run lint

log "Client production build (real API mode)"
VITE_API_MODE=real npm run build --prefix client

run_load_test() {
  if [[ "${SKIP_LOADTEST:-0}" == "1" ]]; then
    warn "k6 load test skipped because SKIP_LOADTEST=1."
    return 0
  fi
  if ! command -v k6 >/dev/null 2>&1; then
    if [[ "${REQUIRE_LOADTEST:-0}" == "1" ]]; then
      fail "k6 is not installed; install k6 or unset REQUIRE_LOADTEST."
    fi
    warn "k6 is not installed, so the Sprint 4 concurrency test was skipped."
    return 0
  fi

  log "Preparing an isolated load-test database"
  if ! (
    cd server
    MONGO_URI="$LOAD_MONGO_URI" node - <<'NODE'
const mongoose = require("mongoose");
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 4000,
    connectTimeoutMS: 4000,
  })
  .then(() => mongoose.connection.dropDatabase())
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
NODE
  ); then
    if [[ "${REQUIRE_LOADTEST:-0}" == "1" ]]; then
      fail "MongoDB is not reachable at ${LOAD_MONGO_URI}."
    fi
    warn "MongoDB is not reachable, so the k6 concurrency test was skipped."
    return 0
  fi

  log "Seeding the load-test database"
  (
    cd server
    MONGO_URI="$LOAD_MONGO_URI" SEED_PASSWORD=password123 node seed.js
  )

  if (ss -ltn 2>/dev/null || true) | awk '{print $4}' | grep -qE "[:.]${LOAD_PORT}$"; then
    fail "Load-test port ${LOAD_PORT} is already in use. Set LOADTEST_PORT."
  fi

  log "Starting a temporary API on port ${LOAD_PORT}"
  (
    cd server
    NODE_ENV=development \
      PORT="$LOAD_PORT" \
      MONGO_URI="$LOAD_MONGO_URI" \
      JWT_SECRET="vps-local-loadtest-secret" \
      exec node index.js
  ) >"$LOAD_LOG" 2>&1 &
  LOAD_PID=$!

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:${LOAD_PORT}/api/health" 2>/dev/null |
      grep -q '"database":"connected"'; then
      break
    fi
    if ! kill -0 "$LOAD_PID" 2>/dev/null; then
      cat "$LOAD_LOG" >&2 || true
      fail "The load-test API exited before becoming healthy."
    fi
    sleep 0.5
  done

  if ! curl -fsS "http://127.0.0.1:${LOAD_PORT}/api/health" >/dev/null 2>&1; then
    cat "$LOAD_LOG" >&2 || true
    fail "The load-test API did not become healthy."
  fi

  log "k6 concurrent allocation test (S4-T1, VPS-NF-002)"
  BASE_URL="http://127.0.0.1:${LOAD_PORT}" VUS="${VUS:-50}" \
    k6 run loadtest/entry-concurrency.js

  kill "$LOAD_PID" 2>/dev/null || true
  wait "$LOAD_PID" 2>/dev/null || true
  LOAD_PID=""
}

run_load_test

log "All checks completed successfully."
