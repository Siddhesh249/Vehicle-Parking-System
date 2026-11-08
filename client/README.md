# Vehicle Parking System client

The React/Vite client provides separate Entry-1, Entry-2, Exit-1, Exit-2, and
Admin console views plus the developer-only Simulation Console. It can run
against the in-memory mock API or the real HTTP + Socket.io backend.

## Commands

```bash
npm run dev
npm test
npm run lint
npm run build
```

Run the app at the route for a console, such as `/entry-1` or `/admin`.
The Simulation Console is at `/dev/simulate` and is intentionally absent from
the role navigation.

## Talking to the backend

The default mode is the in-memory mock, so the UI works without a server. To use
the real API and live Socket.io updates:

1. Start MongoDB and the server (`server/README.md`) so it listens on `127.0.0.1:5000`.
2. Seed the demo accounts and initial spots with `npm --prefix server run seed`.
3. Set `VITE_API_MODE=real` in `client/.env`, or start through the repository
   root launcher (`./run.sh`) which sets it for you.
4. Open `/login` and sign in as `entry1`, `entry2`, `exit1`, `exit2`, or
   `admin`. The local seed password is `password123` unless `SEED_PASSWORD` was set.

`vite.config.js` proxies `/api` and `/socket.io` to the server. The session
(token, role, gate) is stored per browser tab in `sessionStorage`, so different
tabs can be different gates.

## What is where

- `src/api/httpClient.js` — REST transport for every SAD 4.3 endpoint.
- `src/api/mockApi.js` — in-memory mock with the same method contract.
- `src/api/session.js` — per-tab session storage.
- `src/realtime/` — Socket.io connection and the hub that shares one connection per page.
- `src/hooks/useLiveLot.js` — lot state from REST + realtime events.
- `src/hooks/usePanel.js` — loading/error/refresh state for admin panels.
- `src/components/` — gate consoles, admin dashboard, charts, configuration, and Simulation Console.
- `src/utils/` — money/duration formatting and chart-data adapters.

## Admin configuration

The Admin dashboard can edit:

- Fare tiers, first-hour policy, lost-ticket penalty, and overstay penalty per vehicle type.
- Two-wheeler and four-wheeler spot counts (occupied spots are never deleted).

Changes are persisted by the backend and apply to subsequent exits without a
frontend or server restart.
