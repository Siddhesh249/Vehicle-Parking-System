#!/usr/bin/env bash
# Start the complete Vehicle Parking System: MongoDB check, seed, backend,
# frontend, and the browser. Ctrl+C stops both application processes.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

SERVER_PORT="${PORT:-5000}"
CLIENT_PORT="${CLIENT_PORT:-5173}"
APP_HOST="${APP_HOST:-localhost}"
API_URL="http://127.0.0.1:${SERVER_PORT}"
APP_URL="http://${APP_HOST}:${CLIENT_PORT}"
SERVER_LOG="${TMPDIR:-/tmp}/vps-server.log"
CLIENT_LOG="${TMPDIR:-/tmp}/vps-client.log"
SERVER_PID=""
CLIENT_PID=""

log() { printf '\n\033[1;31m[run]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[run] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

cleanup() {
  local status="${1:-0}"
  trap - EXIT INT TERM
  if [[ -n "$CLIENT_PID" ]] && kill -0 "$CLIENT_PID" 2>/dev/null; then
    kill "$CLIENT_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  wait "$CLIENT_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  exit "$status"
}
trap 'status=$?; cleanup "$status"' EXIT
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

port_in_use() {
  (ss -ltn 2>/dev/null || true) | awk '{print $4}' | grep -qE "[:.]$1$"
}

wait_for_health() {
  for _ in $(seq 1 120); do
    if curl -fsS "$API_URL/api/health" 2>/dev/null | grep -q '"database":"connected"'; then
      return 0
    fi
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.5
  done
  return 1
}

wait_for_client() {
  for _ in $(seq 1 120); do
    if curl -fsS "$APP_URL" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$CLIENT_PID" ]] && ! kill -0 "$CLIENT_PID" 2>/dev/null; then
      return 1
    fi
    sleep 0.5
  done
  return 1
}

open_browser() {
  if [[ "${NO_BROWSER:-0}" == "1" ]]; then
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 &
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$APP_URL" >/dev/null 2>&1 &
  else
    log "Open ${APP_URL} in your browser (no browser opener was found)."
  fi
}

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js 24 LTS and try again."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install npm and try again."
command -v curl >/dev/null 2>&1 || fail "curl is required to health-check the local services."

log "Checking dependencies"
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -d server/node_modules ]]; then npm ci --prefix server; fi
if [[ ! -d client/node_modules ]]; then npm ci --prefix client; fi

log "Checking MongoDB"
if ! (
  cd server
  node - <<'NODE'
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { getMongoUri } = require("./utils/database");
mongoose
  .connect(getMongoUri(), { serverSelectionTimeoutMS: 4000, connectTimeoutMS: 4000 })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
NODE
); then
  fail "MongoDB is not reachable. Start MongoDB (or set MONGO_URI in server/.env) and retry."
fi

if port_in_use "$SERVER_PORT"; then
  fail "Port ${SERVER_PORT} is already in use. Stop the other process or set PORT."
fi
if port_in_use "$CLIENT_PORT"; then
  fail "Port ${CLIENT_PORT} is already in use. Stop the other process or set CLIENT_PORT."
fi

log "Seeding demo accounts and parking spots (idempotent)"
npm --prefix server run seed

log "Starting the API on ${API_URL}"
(
  cd server
  NODE_ENV=development PORT="$SERVER_PORT" CLIENT_URL="$APP_URL" exec node index.js
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

if ! wait_for_health; then
  cat "$SERVER_LOG" >&2 || true
  fail "The backend did not become healthy. See ${SERVER_LOG}."
fi

log "Starting the frontend on ${APP_URL}"
(
  cd client
  VITE_API_MODE=real API_PROXY_TARGET="$API_URL" \
    exec node ./node_modules/vite/bin/vite.js \
    --host 127.0.0.1 --port "$CLIENT_PORT" --strictPort
) >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

if ! wait_for_client; then
  cat "$CLIENT_LOG" >&2 || true
  fail "The frontend did not start. See ${CLIENT_LOG}."
fi

log "Parkwise is running"
printf '  App:      %s\n' "$APP_URL"
printf '  API:      %s/api/health\n' "$API_URL"
printf '  Accounts: entry1, entry2, exit1, exit2, admin (password: %s)\n' "${SEED_PASSWORD:-password123}"
printf '  Logs:     %s and %s\n' "$SERVER_LOG" "$CLIENT_LOG"
printf '  Press Ctrl+C to stop both services.\n'

open_browser

while kill -0 "$SERVER_PID" 2>/dev/null && kill -0 "$CLIENT_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  cat "$SERVER_LOG" >&2 || true
  fail "The backend exited unexpectedly."
fi

cat "$CLIENT_LOG" >&2 || true
fail "The frontend exited unexpectedly."
