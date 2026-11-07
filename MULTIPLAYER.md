# Autodrom multiplayer MVP

The first multiplayer pass supports small, code-based free-drive rooms with up
to eight players. Players' cars are visual peers: each browser continues to run
its own driving physics, while the server relays position snapshots at 15 Hz.
Remote positions and yaw are smoothed locally. Player-to-player collision,
accounts, shared garage saves, ranking, and authoritative anti-cheat are not part
of this MVP.

## Run locally

1. Run `npm run dev` (this starts both Vite and the room server).
2. Open the Vite address in two browser tabs or devices on the same network.
   Use **ONLINE** to create a room, then join it with the six-character code.

The Vite development server forwards Socket.IO traffic to port 3001. For a
production-style local run, run `npm run build` and then `npm run server`; the
Node server serves `dist/` and the multiplayer endpoint from the same origin.
## Cloudflare and other static deployments

The browser connects to the same origin by default. That works for local
development and when `npm run server` serves both the built game and Socket.IO.
Cloudflare Workers/Pages static asset deployments do not start
`server/index.js`; the Worker can serve the game while `/socket.io` has no
Socket.IO server behind it. The `wrangler` package in this repository is only a
development dependency: there is no Worker entry point or Wrangler deployment
configuration here.

For the smallest production setup, run `npm run server` on a persistent Node.js
host (with the project's files and dependencies installed) and set
`PORT` to the port provided by that host. Then set the build environment
variable `VITE_MULTIPLAYER_URL` to the public HTTPS origin of that Node service,
for example `https://autodrom-multiplayer.example.com`, when building the game
for Cloudflare. Rebuild and redeploy the static game after setting it. Socket.IO
uses its normal `/socket.io` path on that origin, including WebSocket upgrade.
The host must allow inbound WebSocket traffic. Set `CORS_ORIGIN` on the Node
host to the exact game origin (for example `https://autodrom.example.com`);
multiple origins can be comma-separated. If unset, the server allows any
origin, which is convenient for local development.

For a Render web service, use `npm ci && npm run build` as the build command
and `npm start` as the start command. The start script launches this Node
server; it binds to `0.0.0.0` and reads Render's `PORT`. In Render, set
`CORS_ORIGIN` to the exact Cloudflare site origin, such as
`https://autodrom.pages.dev` or your custom domain (scheme included, no path).
In the Cloudflare build environment, set `VITE_MULTIPLAYER_URL` to the Render
service origin, such as `https://autodrom-multiplayer.onrender.com`, then
redeploy the game. These are different settings: CORS belongs on Render, while
the client URL must be present when the frontend is built.

Alternatively, replace the Node Socket.IO room server with a Cloudflare-native
implementation using Durable Objects and WebSockets. That requires a separate
server-side implementation of the room lifecycle and message protocol; simply
deploying these static assets to Workers does not provide it.

Room data is held in memory and disappears when the server restarts. The room
server validates packet shape and bounds but does not authenticate users or
verify vehicle ownership. Do not use client-reported positions for competitive
results or shared rewards without adding server-authoritative simulation.
