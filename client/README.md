# Vehicle Parking System client

The React/Vite client provides separate Entry-1, Entry-2, Exit-1, Exit-2, and
Admin console views. During Sprint 2, the screens deliberately use an in-memory
mock API that mirrors the server's allocation, lookup, exit-receipt, and tiered
fare contracts. Sprint 3 adds a real HTTP + Socket.io client behind the same
interface, selected with `VITE_API_MODE` (default: mock).

## Commands

```bash
npm run dev
npm test
npm run lint
npm run build
```

Run the app at the route for a console, such as `/entry-1` or `/admin`.

## Talking to the backend (Sprint 3)

By default the client runs on the in-memory mock, so it works without a server. To use the
real API and live Socket.io updates:

1. Start MongoDB and the server (`server/README.md`) so it listens on `127.0.0.1:5000`.
2. In `client/`, copy `.env.example` to `.env` and set `VITE_API_MODE=real`.
3. `npm run dev`, open `/login`, and sign in with an account from the seed script.

`vite.config.js` proxies `/api` and `/socket.io` to the server. The session (token, role, gate) is
stored per browser tab in `sessionStorage`, so different tabs can be different gates.

Where things live: `src/api/httpClient.js` (REST), `src/realtime/` (Socket.io connection and a
hub that shares one connection per page), `src/hooks/useLiveLot.js` (lot state from REST + events),
`src/components/Charts.jsx` (Recharts admin charts).
