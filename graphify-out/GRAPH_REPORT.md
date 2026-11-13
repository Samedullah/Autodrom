# Graph Report - Autodrom-main  (2026-11-13)

## Corpus Check
- 40 files · ~63,690 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 887 nodes · 1845 edges · 48 communities (28 shown, 20 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 218 edges (avg confidence: 0.84)
- Token cost: 127,864 input · 0 output

## Community Hubs (Navigation)
- Vehicle Models & GLB Docs
- Economy & VehicleSpec
- Project README & Gameplay
- Remote Cars & Lamp Bloom
- Package Dependencies
- Track Worlds (Spa etc.)
- Sky Atmosphere
- Entry Page & Debug API
- Game UI & Menus
- Dev Server & Trust Model
- Model Attribution
- Engine Audio
- Chassis Core Types
- Tire Debug Profiles
- Drivetrain Physics
- DriveEngine Input & Collisions
- Chassis Grip Model
- Multiplayer & Deployment Docs
- Tire Smoke & Speed Gates
- Scene Load & Disposal
- TypeScript Config
- Headless Physics Sim
- Lighting & Render Settings
- Android Tests
- Camera Motion Springs
- Tuning Actions
- Tire Smoke Particles
- Steering & Tire Response
- Stance Panel
- Android Launcher Icon
- Android Main Activity
- Android Splash Image
- Capacitor Splash Branding
- Cloudflare Deployment
- Render Deployment
- #game container
- #interface container
- Inline loading screen
- /src/main.ts module entry

## God Nodes (most connected - your core abstractions)
1. `Araç modeli ve teknik veri notları` - 92 edges
2. `DriveEngine` - 89 edges
3. `DriveEngine` - 54 edges
4. `GLB/ brand/model folder layout` - 43 edges
5. `GameInterface` - 37 edges
6. `Chassis` - 35 edges
7. `Wheel rotation/steer pivot detection (3DWheel, bone_wheel_*_steer)` - 29 edges
8. `VehicleSpec` - 29 edges
9. `MultiplayerClient` - 27 edges
10. `Autodrom — Drive & Build README` - 21 edges

## Surprising Connections (you probably didn't know these)
- `BMW M3 E36` --semantically_similar_to--> `BMW M3 E36 (user model, id m3-e36)`  [AMBIGUOUS] [semantically similar]
  public/assets/models/VEHICLE-RESEARCH.md → TRIPO-PLAN.md
- `Araç modeli ve teknik veri notları` --references--> `VehicleSpec`  [INFERRED]
  public/assets/models/VEHICLE-RESEARCH.md → src/data.ts
- `Headless Node physics sim` --references--> `Chassis`  [EXTRACTED]
  CLAUDE.md → src/chassis.ts
- `RPM-to-playback-position audio` --rationale_for--> `VehicleAudio`  [EXTRACTED]
  CLAUDE.md → src/vehicleAudio.ts
- `BMW M3 GTR (NFS MW model, 2001 ALMS race specs)` --semantically_similar_to--> `BMW M3 GTR (user model, id bmw-m3-gtr)`  [INFERRED] [semantically similar]
  public/assets/models/VEHICLE-RESEARCH.md → TRIPO-PLAN.md

## Import Cycles
- 2-file cycle: `src/spa.ts -> src/world.ts -> src/spa.ts`

## Hyperedges (group relationships)
- **Default engine audio clip set** — public_assets_audio_cars_default_readme_engine_idle_ogg, public_assets_audio_cars_default_readme_engine_load_ogg, public_assets_audio_cars_default_readme_tire_skid_ogg, public_assets_audio_cars_default_readme_rpm_position_mapping, public_assets_audio_cars_default_readme_rev_limiter_pulse [EXTRACTED 1.00]
- **Split frontend/backend multiplayer deployment** — multiplayer_render_deployment, multiplayer_cloudflare_static_deployment, multiplayer_vite_multiplayer_url, multiplayer_cors_origin [EXTRACTED 1.00]
- **GLB vehicle loading pipeline** — public_assets_models_readme_manifest_json, public_assets_models_readme_lazy_glb_loading, public_assets_models_vehicle_research_model_fitting, public_assets_models_vehicle_research_wheel_pivot_detection, public_assets_models_vehicle_research_procedural_fallback, readme_modelpath [INFERRED 0.85]
- **Per-frame driving physics pipeline** — src_engine_driveengine, src_drivetrain_drivetrain, src_chassis_chassis, src_cameramotion [EXTRACTED 1.00]
- **Car registration across catalog, manifest and server** — src_data_vehicles, public_assets_models_manifest, server_index, src_vehicle_installgeneratedmodel [EXTRACTED 1.00]

## Communities (48 total, 20 thin omitted)

### Community 0 - "Vehicle Models & GLB Docs"
Cohesion: 0.05
Nodes (85): Araç GLB modelleri README, GLB/ brand/model folder layout, models manifest.json, Araç modeli ve teknik veri notları, Audi RS 4 (B7 reference), BMW M2, BMW M3 CSL E46, BMW M3 E36 (+77 more)

### Community 1 - "Economy & VehicleSpec"
Cohesion: 0.05
Nodes (22): VehicleSpec, calculatePayout(), IncomeClock, approach(), disposeObject(), DriveEngine, DrivingControl, EngineCallbacks (+14 more)

### Community 2 - "Project README & Gameplay"
Cohesion: 0.05
Nodes (48): models, Autodrom — Drive & Build README, Third-person 3D car tycoon game, City and highway (otoban) environments, Kontroller (W/S, A/D, Q/E gears, Space handbrake, Esc), Reverse/neutral/1–6 gear shifting, LocalStorage save (money, cars, map, graphics), Catalog modelPath auto-loading of GLB (+40 more)

### Community 3 - "Remote Cars & Lamp Bloom"
Cohesion: 0.07
Nodes (46): three, BLUR_PASSES, GLOW_LAYER, availableModels(), BRAKE_GLOW, buildModelSuspension(), CachedModel, contactShadowMap() (+38 more)

### Community 4 - "Package Dependencies"
Cohesion: 0.05
Nodes (32): dependencies, @capacitor/android@^8.5.3, @capacitor/core@^8.5.3, socket.io@^4.8.4, socket.io-client@^4.8.4, three@^0.180.0, devDependencies, @capacitor/cli@^8.5.3 (+24 more)

### Community 5 - "Track Worlds (Spa etc.)"
Cohesion: 0.08
Nodes (38): batchStaticMeshes(), BUSHIDO_PEAK_CONFIG, createBushidoPeakWorld(), createNurburgringWorld(), createSpaWorld(), createTrackWorld(), cutOutTransparency(), nextFrame() (+30 more)

### Community 6 - "Sky Atmosphere"
Cohesion: 0.06
Nodes (23): Atmosphere, DAYLIGHT, setSkyUniforms(), SkyColors, skyMaterial(), clock(), CYCLE_OPTIONS, DebugInfo (+15 more)

### Community 7 - "Entry Page & Debug API"
Cohesion: 0.08
Nodes (33): index.html (Autodrom entry page), #game container, #interface container, activateVehicle(), closeDevCodePanel(), debugPanel, engine, gameHost (+25 more)

### Community 8 - "Game UI & Menus"
Cohesion: 0.07
Nodes (8): checked(), disposeSceneResources(), escapeHtml(), GameInterface, normalizeSearch(), PreviewStage, selected(), specBar()

### Community 9 - "Dev Server & Trust Model"
Cohesion: 0.09
Nodes (14): children, allowedOrigins, cleanName(), cleanVehicle(), httpServer, io, manifestPath, MAP_IDS (+6 more)

### Community 10 - "Model Attribution"
Cohesion: 0.12
Nodes (22): 3D model attribution, BMW E36 M3 (Martin Trafas), BMW M3 GTR - NFS MW (Q.SARDOR), CC BY 4.0, Martin Trafas (Bexxie), Q.SARDOR, Sketchfab, Circuit de Spa-Francorchamps 1992 (Dave Love) (+14 more)

### Community 11 - "Engine Audio"
Cohesion: 0.13
Nodes (9): Default car audio clips README, engine-idle.ogg, engine-load.ogg (850→7050 RPM sweep), tire-skid.ogg, Third-person chase camera, speed/gear/RPM HUD, drift marks, AUDIO_FILES, SoundLayer, VehicleAudio (+1 more)

### Community 12 - "Chassis Core Types"
Cohesion: 0.14
Nodes (16): ChassisBody, ChassisInput, ChassisOutput, TireIndex, aeroDownforceG(), AeroProfile, Gear, SUN_OFFSET (+8 more)

### Community 13 - "Tire Debug Profiles"
Cohesion: 0.14
Nodes (14): SingleTireTelemetry, TIRE_PROFILES, TireDebugState, TireEditTarget, TireProfileId, TireTuningParams, PROFILE_LIST, SLIDER_SPECS (+6 more)

### Community 14 - "Drivetrain Physics"
Cohesion: 0.15
Nodes (18): airDragCoefficient(), approach(), AxleStepResult, clampMagnitude(), DrivetrainInput, DrivetrainOutput, GEAR_BREAKAWAY_BOOST, GEAR_SPEED (+10 more)

### Community 16 - "Chassis Grip Model"
Cohesion: 0.12
Nodes (4): camberLongMultiplier(), Chassis, DriveLayout, StanceConfig

### Community 17 - "Multiplayer & Deployment Docs"
Cohesion: 0.15
Nodes (8): ATTRIBUTION.md, config, Autodrom Project, Autodrom multiplayer MVP, Cloudflare Durable Objects alternative, Room server (Socket.IO), Socket.IO, Vite

### Community 18 - "Tire Smoke & Speed Gates"
Cohesion: 0.17
Nodes (4): advanceSmokeBuild(), approach(), smokeDensity(), groundHeightAt()

### Community 19 - "Scene Load & Disposal"
Cohesion: 0.15
Nodes (4): disposeObject(), LampBloom, MotionBlur, modelDownloadProgress()

### Community 20 - "TypeScript Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals (+8 more)

### Community 21 - "Headless Physics Sim"
Cohesion: 0.23
Nodes (8): Headless Node physics sim, aeroProfileOf(), driveLayoutOf(), Drivetrain, estimateFrontWeightShare(), estimateVehicleMassKg(), longitudinalGrip(), rearDriveShare()

### Community 22 - "Lighting & Render Settings"
Cohesion: 0.23
Nodes (6): lightingFor(), pixelRatioLimit(), renderPixelRatio(), shadowHalfExtent(), shadowMapResolution(), setVehicleMaterialQuality()

### Community 24 - "Camera Motion Springs"
Cohesion: 0.29
Nodes (6): CameraMotion, CameraMotionInput, clamp(), smoothstep(), Spring, stepSpring()

### Community 27 - "Steering & Tire Response"
Cohesion: 0.36
Nodes (5): approach(), camberLatMultiplier(), clamp(), nonlinearTireResponse(), smoothstep()

### Community 28 - "Stance Panel"
Cohesion: 0.32
Nodes (4): stancePanel, toggleStancePanel(), StancePresetId, setVehicleSuspension()

### Community 30 - "Android Launcher Icon"
Cohesion: 0.40
Nodes (5): Default Capacitor logo (blue X on grid), Placeholder template app branding, Default Capacitor logo (blue X on white grid), Android launcher icon (xxxhdpi), Unbranded placeholder icon (no Autodrom branding)

### Community 33 - "Android Splash Image"
Cohesion: 0.67
Nodes (3): Capacitor default logo (blue gradient X mark), Unbranded Capacitor template splash (white background), Android landscape xxxhdpi splash screen

### Community 34 - "Capacitor Splash Branding"
Cohesion: 0.67
Nodes (3): Capacitor logo (blue X mark on white), Capacitor Android wrapper, Android splash.png (default Capacitor splash)

## Ambiguous Edges - Review These
- `BMW M3 E36` → `BMW M3 E36 (user model, id m3-e36)`  [AMBIGUOUS]
  public/assets/models/VEHICLE-RESEARCH.md · relation: semantically_similar_to
- `BMW M3 F80` → `vehicle.ts`  [AMBIGUOUS]
  public/assets/models/VEHICLE-RESEARCH.md · relation: conceptually_related_to

## Knowledge Gaps
- **21 isolated node(s):** `Capacitor logo (blue X mark on white)`, `Capacitor Android wrapper`, `Default Capacitor logo (blue X on white grid)`, `Unbranded placeholder icon (no Autodrom branding)`, `Cloudflare static deployment` (+16 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 245 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Araç modeli ve teknik veri notları` connect `Vehicle Models & GLB Docs` to `Project README & Gameplay`, `Economy & VehicleSpec`, `Model Attribution`, `Remote Cars & Lamp Bloom`?**
  _High betweenness centrality (0.153) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `Araç modeli ve teknik veri notları` (e.g. with `On-demand GLB loading` and `VehicleSpec`) actually correct?**
  _`Araç modeli ve teknik veri notları` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Capacitor logo (blue X mark on white)`, `Capacitor Android wrapper`, `Default Capacitor logo (blue X on white grid)` to the rest of the system?**
  _21 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Vehicle Models & GLB Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.054336468129571575 - nodes in this community are weakly interconnected._
- **Why does `DriveEngine` connect `DriveEngine Input & Collisions` to `Economy & VehicleSpec`, `Project README & Gameplay`, `Remote Cars & Lamp Bloom`, `Package Dependencies`, `Track Worlds (Spa etc.)`, `Entry Page & Debug API`, `Engine Audio`, `Chassis Core Types`, `Chassis Grip Model`, `Tire Smoke & Speed Gates`, `Scene Load & Disposal`, `Headless Physics Sim`, `Lighting & Render Settings`, `Camera Motion Springs`, `Tuning Actions`, `Stance Panel`, `Car Reset & Map Switch`?**
  _High betweenness centrality (0.135) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `BMW M3 E36` and `BMW M3 E36 (user model, id m3-e36)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **What is the exact relationship between `BMW M3 F80` and `vehicle.ts`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._