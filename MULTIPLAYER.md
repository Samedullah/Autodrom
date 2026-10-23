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
Deployments must run this Node server (or provide an equivalent Socket.IO
endpoint); static hosting alone cannot provide multiplayer rooms.

Room data is held in memory and disappears when the server restarts. The room
server validates packet shape and bounds but does not authenticate users or
verify vehicle ownership. Do not use client-reported positions for competitive
results or shared rewards without adding server-authoritative simulation.
