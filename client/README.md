# Vehicle Parking System client

The React/Vite client provides separate Entry-1, Entry-2, Exit-1, Exit-2, and
Admin console views. During Sprint 2, the screens deliberately use an in-memory
mock API that mirrors the server's allocation, lookup, exit-receipt, and tiered
fare contracts. Real HTTP and Socket.io integration remains Sprint 3 work.

## Commands

```bash
npm run dev
npm test
npm run lint
npm run build
```

Run the app at the route for a console, such as `/entry-1` or `/admin`.
