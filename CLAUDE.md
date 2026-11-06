# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Autodrom is a browser-based third-person 3D car tycoon game (Three.js + TypeScript + Vite), with an optional Socket.IO multiplayer room server and a Capacitor Android wrapper. UI text, docs and commit messages are in Turkish.

## Commands

```bash
npm install
npm run dev       # server/dev.js: starts the room server (port 3001) AND Vite on 0.0.0.0; Vite proxies /socket.io to 3001
npm run build     # tsc -b && vite build -> dist/  (tsc is the only type check / lint; there are no JS tests)
npm run server    # production-style: Node serves dist/ + Socket.IO on one origin (PORT env, default 3001); run build first
npm run preview   # vite preview of dist/ (no multiplayer)
npx cap sync android   # copy dist/ into the Android project (capacitor.config.ts, webDir: dist)
```

The only tests are the Capacitor template tests under `android/app/src/{test,androidTest}` (run via Gradle in `android/`).

## Architecture

`index.html` provides `#game` and `#interface`; `src/main.ts` is the composition root and owns all mutable game state (save, settings, current map, active vehicle, current screen). Modules do not talk to each other directly; `main.ts` wires them with callbacks:

- `DriveEngine` (`src/engine.ts`) owns the Three.js scene, driving physics, camera, skids/tire smoke, speed gates and the income loop. It reports back through `EngineCallbacks` (`onIncome`, `onMissionComplete`, `onTelemetry`, `onEscape`, ...). It builds the map via `buildWorld()` (`src/world.ts`), car meshes via `src/vehicle.ts`, sound via `VehicleAudio`, and renders remote players from `MultiplayerClient`.
- `GameInterface` (`src/ui.ts`) renders HUD, menus, store/garage and its own 3D preview (`PreviewStage`). It receives a `UiSnapshot` and emits `UiAction`s, handled by `handleAction()` in `main.ts`.
- `src/data.ts` is the single source of truth for the vehicle catalog (`VEHICLES`, `VehicleSpec`, optional `realSpecs`) and `ECONOMY` constants. `src/economy.ts` computes driving income (speed × catalog price, paid on a 3 s clock). `src/save.ts` validates and persists save/settings in LocalStorage.

### Vehicle models

Every car first gets a procedural visual (`createVehicleVisual`), then `installGeneratedModel` asynchronously swaps in the GLB at `spec.modelPath` — but only if `spec.id` is listed in `public/assets/models/manifest.json`. Models load on demand and are cached/cloned (SkeletonUtils clone, because some GLBs have skinned meshes). Loading fits length, centers and grounds the model, and detects wheel/steering pivot nodes by name; per-car quirks live in `VehicleSpec` fields such as `modelRotationY` and `modelExcludeNodes`. A missing or broken GLB silently falls back to the procedural car.

`manifest.json` is also read by `server/index.js`: any multiplayer `vehicleId` not in it is replaced with the first manifest entry. **When adding a car, add it to both `src/data.ts` and `manifest.json`.** GLBs live under `public/assets/models/GLB/<BRAND>/<model>/`. `public/assets/models/VEHICLE-RESEARCH.md` documents each model's node/wheel structure and spec sources; `ATTRIBUTION.md` holds required CC BY credits.

### Multiplayer

See `MULTIPLAYER.md`. Rooms (max 8, six-character codes) live in server memory. Each client runs its own physics; the server only relays ~15 Hz position snapshots, and `DriveEngine` smooths remote position/yaw. The server sanitizes names and validates packet shape/bounds but has no auth — never trust client positions for rewards or rankings. Static hosting cannot provide multiplayer; the Node server must run.

### Audio

`src/vehicleAudio.ts` plays clips from `public/assets/audio/cars/default/`, mapping RPM to a playback position in the load-sweep recording rather than pitch-shifting; missing clips are skipped.
