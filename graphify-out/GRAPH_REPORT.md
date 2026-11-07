# Graph Report - Autodrom-main  (2026-11-05)

## Corpus Check
- Corpus is ~33,977 words - fits in a single context window. You may not need a graph.

## Summary
- 555 nodes · 1166 edges · 25 communities (12 shown, 13 thin omitted)
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 176 edges (avg confidence: 0.84)
- Token cost: 141,113 input · 0 output

## Community Hubs (Navigation)
- Vehicle Catalog & GLB Models
- Game Overview & Gameplay
- Engine Core & Dependencies
- Driving Physics & Specs
- DriveEngine Runtime
- Game UI & Menus
- Build & Package Config
- Multiplayer Design
- Model Attribution & Tripo Plan
- Engine Audio
- Multiplayer Client
- World Generation
- TypeScript Config
- Android Tests
- Vehicle Preview Stage
- Dev Server Script
- Android Main Activity
- Model Manifest

## God Nodes (most connected - your core abstractions)
1. `Araç modeli ve teknik veri notları` - 91 edges
2. `DriveEngine` - 55 edges
3. `DriveEngine` - 54 edges
4. `GLB/ brand/model folder layout` - 43 edges
5. `GameInterface` - 35 edges
6. `Wheel rotation/steer pivot detection (3DWheel, bone_wheel_*_steer)` - 29 edges
7. `MultiplayerClient` - 27 edges
8. `Autodrom — Drive & Build README` - 21 edges
9. `VehicleSpec` - 19 edges
10. `handleAction()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `BMW M3 E36` --semantically_similar_to--> `BMW M3 E36 (user model, id m3-e36)`  [AMBIGUOUS] [semantically similar]
  public/assets/models/VEHICLE-RESEARCH.md → TRIPO-PLAN.md
- `Procedural fallback for broken/missing GLB` --semantically_similar_to--> `Offline procedural vehicle visuals and maps`  [INFERRED] [semantically similar]
  public/assets/models/VEHICLE-RESEARCH.md → README.md
- `BMW M3 GTR (NFS MW model, 2001 ALMS race specs)` --semantically_similar_to--> `BMW M3 GTR (user model, id bmw-m3-gtr)`  [INFERRED] [semantically similar]
  public/assets/models/VEHICLE-RESEARCH.md → TRIPO-PLAN.md
- `tire-skid.ogg` --conceptually_related_to--> `Third-person chase camera, speed/gear/RPM HUD, drift marks`  [INFERRED]
  public/assets/audio/cars/default/README.md → README.md
- `BMW M3 GTR (user model, id bmw-m3-gtr)` --references--> `models manifest.json`  [EXTRACTED]
  TRIPO-PLAN.md → public/assets/models/README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Multiplayer snapshot sync flow** — multiplayer_visual_peers, multiplayer_snapshot_relay_15hz, multiplayer_remote_smoothing, multiplayer_room_server, multiplayer_socket_io [EXTRACTED 1.00]
- **GLB vehicle loading pipeline** — public_assets_models_readme_manifest_json, public_assets_models_readme_lazy_glb_loading, public_assets_models_vehicle_research_model_fitting, public_assets_models_vehicle_research_wheel_pivot_detection, public_assets_models_vehicle_research_procedural_fallback, readme_modelpath [INFERRED 0.85]
- **Default engine audio clip set** — public_assets_audio_cars_default_readme_engine_idle_ogg, public_assets_audio_cars_default_readme_engine_load_ogg, public_assets_audio_cars_default_readme_tire_skid_ogg, public_assets_audio_cars_default_readme_rpm_position_mapping, public_assets_audio_cars_default_readme_rev_limiter_pulse [EXTRACTED 1.00]

## Communities (25 total, 13 thin omitted)

### Community 0 - "Vehicle Catalog & GLB Models"
Cohesion: 0.05
Nodes (85): Araç GLB modelleri README, GLB/ brand/model folder layout, models manifest.json, Araç modeli ve teknik veri notları, Audi RS 4 (B7 reference), BMW M2, BMW M3 CSL E46, BMW M3 E36 (+77 more)

### Community 1 - "Game Overview & Gameplay"
Cohesion: 0.05
Nodes (62): index.html (Autodrom entry page), #game container, #interface container, Autodrom — Drive & Build README, Third-person 3D car tycoon game, City and highway (otoban) environments, Kontroller (W/S, A/D, Q/E gears, Space handbrake, Esc), Reverse/neutral/1–6 gear shifting (+54 more)

### Community 2 - "Engine Core & Dependencies"
Cohesion: 0.07
Nodes (40): three@^0.180.0, three, disposeObject(), DrivingControl, EngineCallbacks, Gear, GEAR_LAUNCH_SPEED_KMH, GEAR_SPEED (+32 more)

### Community 3 - "Driving Physics & Specs"
Cohesion: 0.07
Nodes (7): VehicleSpec, IncomeClock, approach(), DriveEngine, pixelRatioLimit(), renderPixelRatio(), shadowMapResolution()

### Community 4 - "DriveEngine Runtime"
Cohesion: 0.09
Nodes (6): DriveEngine, pixelRatioLimit(), renderPixelRatio(), shadowMapResolution(), GameSettings, setVehicleWheelSpin()

### Community 5 - "Game UI & Menus"
Cohesion: 0.09
Nodes (7): Telemetry, checked(), escapeHtml(), GameInterface, normalizeSearch(), selected(), specBar()

### Community 6 - "Build & Package Config"
Cohesion: 0.08
Nodes (28): config, dependencies, @capacitor/android@^8.5.3, @capacitor/core@^8.5.3, socket.io@^4.8.4, socket.io-client@^4.8.4, devDependencies, @capacitor/cli@^8.5.3 (+20 more)

### Community 7 - "Multiplayer Design"
Cohesion: 0.09
Nodes (15): Autodrom multiplayer MVP, Node room server (port 3001), Socket.IO, Vite, cleanName(), cleanVehicle(), httpServer, io (+7 more)

### Community 8 - "Model Attribution & Tripo Plan"
Cohesion: 0.13
Nodes (21): 3D model attribution, BMW E36 M3 (by Martin Trafas / Bexxie), BMW M3 GTR - NFS MW (by Q.SARDOR), CC BY 4.0 license, Martin Trafas (Bexxie), Q.SARDOR, Sketchfab, BMW M3 GTR (NFS MW model, 2001 ALMS race specs) (+13 more)

### Community 9 - "Engine Audio"
Cohesion: 0.13
Nodes (9): Default car audio clips README, engine-idle.ogg, engine-load.ogg (850→7050 RPM sweep), tire-skid.ogg, Third-person chase camera, speed/gear/RPM HUD, drift marks, AUDIO_FILES, SoundLayer, VehicleAudio (+1 more)

### Community 11 - "World Generation"
Cohesion: 0.25
Nodes (18): addCityBuildings(), addCityHighwayConnector(), addCityTrees(), addDashMarks(), addDistrictProps(), addHighwayScenery(), addRoadRibbon(), addSpeedGates() (+10 more)

### Community 12 - "TypeScript Config"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals (+7 more)

## Ambiguous Edges - Review These
- `vehicle.ts` → `BMW M3 F80`  [AMBIGUOUS]
  public/assets/models/VEHICLE-RESEARCH.md · relation: conceptually_related_to
- `BMW M3 E36 (user model, id m3-e36)` → `BMW M3 E36`  [AMBIGUOUS]
  public/assets/models/VEHICLE-RESEARCH.md · relation: semantically_similar_to

## Knowledge Gaps
- **3 isolated node(s):** `Third-person 3D car tycoon game`, `Q.SARDOR`, `Martin Trafas (Bexxie)`
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 133 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Araç modeli ve teknik veri notları` connect `Vehicle Catalog & GLB Models` to `Model Attribution & Tripo Plan`, `Game Overview & Gameplay`, `Engine Core & Dependencies`?**
  _High betweenness centrality (0.214) - this node is a cross-community bridge._
- **Are the 42 inferred relationships involving `GLB/ brand/model folder layout` (e.g. with `Audi RS 4 (B7 reference)` and `BMW M2`) actually correct?**
  _`GLB/ brand/model folder layout` has 42 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Third-person 3D car tycoon game`, `Q.SARDOR`, `Martin Trafas (Bexxie)` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Vehicle Catalog & GLB Models` be split into smaller, more focused modules?**
  _Cohesion score 0.054336468129571575 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Engine Core & Dependencies` to `Game Overview & Gameplay`, `World Generation`, `Build & Package Config`?**
  _High betweenness centrality (0.128) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `vehicle.ts` and `BMW M3 F80`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `BMW M3 E36 (user model, id m3-e36)` and `BMW M3 E36`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._