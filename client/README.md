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
Opening `/` or `/login` shows the sign-in page first; demo buttons pre-fill each
gate account, but the credentials still go through the normal login API.
The Simulation Console is at `/dev/simulate` and is intentionally absent from
the role navigation. It is also compiled out of production builds; `./run.sh`
opens it in a second tab during local demos.

## Talking to the backend

The default mode is the in-memory mock, so the UI works without a server. To use
the real API and live Socket.io updates:

1. Start MongoDB and the server (`server/README.md`) so it listens on `127.0.0.1:5000`.
2. Seed the demo accounts and initial spots with `npm --prefix server run seed`.
3. Set `VITE_API_MODE=real` in `client/.env`, or start through the repository
   root launcher (`./run.sh`) which sets it for you.
4. Open the app and sign in as `entry1`, `entry2`, `exit1`, `exit2`, or
   `admin`. The demo buttons fill the local seed credentials (`password123`
   unless `SEED_PASSWORD` / `VITE_DEMO_PASSWORD` was set).

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
- `src/components/` — gate consoles, bot queue panels, admin dashboard, charts, configuration, database browser, and Simulation Console.
- `src/utils/` — money/duration formatting and chart-data adapters.

## Admin configuration

The Admin dashboard can edit:

- Fare tiers, first-hour policy, lost-ticket penalty, and overstay penalty per vehicle type.
- Two-wheeler and four-wheeler spot counts (occupied spots are never deleted).
- The overstay threshold in hours. It cannot be lower than the highest fare tier.

Changes are persisted by the backend and apply to subsequent exits without a
frontend or server restart.

## Demo traffic

The Simulation Console (`/dev/simulate`) starts a bot fleet. Bots queue at entry
gates and are only parked when an entry operator presses **Generate ticket**.
When a bot's intended stay ends it frees its spot, moves to an exit gate and its
billing clock stops; the exit operator scans the ticket (or handles a lost
ticket), sees the frozen fare quote, and presses **Payment collected**. The
consoles poll their gate queue every 1.5 seconds, so all five tabs stay in sync
during the demo. `./run.sh` reseeds a clean demo state on each launch, so revenue
and overstays do not carry over from a previous session.

The Admin dashboard also has a raw **Database** panel: pick a collection tab to
see every column, with rows scrolling inside a fixed-height table.

The demo clock is compressed: five real seconds represent one billed hour. The
lot map shows occupied spots in green with a live hours timer. Overstayed spots
blink red; on an exit console, clicking one notifies the Admin and shows
“Notification sent to admin.”
