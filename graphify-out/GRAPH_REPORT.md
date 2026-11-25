# Graph Report - Autodrom-main  (2026-11-25)

## Corpus Check
- 81 files · ~68,004 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 87 file(s) not represented in the graph (top: .glb 67, .xml 10, (none) 4)

## Summary
- 952 nodes · 1961 edges · 79 communities (46 shown, 33 thin omitted)
- Extraction: 86% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 264 edges (avg confidence: 0.84)
- Token cost: 98,013 input · 0 output

## Community Hubs (Navigation)
- Drive Engine Core (dup)
- README Game Features
- Geometry & Track Builders
- Main Bootstrap & Debug
- Drivetrain Physics
- Game UI Interface
- Android Icon/Splash Art
- Drive Loop & Collisions
- Vehicle Catalog A
- Vehicle Catalog B
- Lamp Bloom & Vehicle Visuals
- Model Attribution & Plans
- Multiplayer Client
- Model Manifest & Cars
- Multiplayer Server
- Chassis Steering Model
- Render Pipeline
- TS Config
- Package Manifest
- Axle Grip Parameters
- Tire Profiles & Tuning
- Map Lighting & Stance
- Vehicle Data Notes
- Sky & Environment Colors
- Android Tests
- Engine Audio
- Atmosphere Sky Bake
- Debug Panel
- Remote Cars & Smoke
- Tire Smoke
- Rain & Lightning
- Weather Environment
- Camera Spring Motion
- Stance Controls
- Shop Preview Stage
- Vehicle Materials
- Runtime Dependencies
- Lens Raindrops
- Procedural Car Builder
- Body-Kit Cars & BoP
- Tire Debug Panel
- Model Load & Dispose
- Tire Tuning Actions
- Stance Presets
- Static Mesh Merging
- NPM Scripts
- Remote Vehicle Types
- Reversed Model Cars
- Capacitor Config
- Multiplayer Design Notes
- Vision GT Concepts
- Dev Runner Script
- Android MainActivity
- Splash xxxhdpi (cached)
- Capacitor Splash (cached)
- Launcher xxhdpi (cached)
- Launcher xxxhdpi (cached)
- Cloudflare Deploy
- Render Deploy
- BMW M2
- BMW M3 F80
- Honda Civic EK9
- Koenigsegg Regera
- McLaren 720S
- McLaren P1 GTR
- Nissan GT-R NISMO
- Subaru S206
- Game Container
- Interface Container
- Loading Screen
- Main Module Entry

## God Nodes (most connected - your core abstractions)
1. `DriveEngine` - 89 edges
2. `DriveEngine` - 54 edges
3. `Sources table (Kaynaklar)` - 48 edges
4. `Wheel rotation pivot system` - 37 edges
5. `GameInterface` - 35 edges
6. `Chassis` - 32 edges
7. `MultiplayerClient` - 27 edges
8. `VehicleSpec` - 26 edges
9. `handleAction()` - 22 edges
10. `Android Screen Density Buckets (mdpi-xxxhdpi, land/port)` - 22 edges

## Surprising Connections (you probably didn't know these)
- `tire-skid.ogg` --conceptually_related_to--> `Third-person chase camera, speed/gear/RPM HUD, drift marks`  [INFERRED]
  public/assets/audio/cars/default/README.md → README.md
- `Tripo 3D araç modeli planı` --conceptually_related_to--> `Offline procedural vehicle visuals and maps`  [INFERRED]
  TRIPO-PLAN.md → README.md
- `BMW M3 E36 (user model, id m3-e36)` --references--> `BMW E36 M3 (Martin Trafas)`  [EXTRACTED]
  TRIPO-PLAN.md → public/assets/models/ATTRIBUTION.md
- `BMW M3 GTR (user model, id bmw-m3-gtr)` --references--> `BMW M3 GTR - NFS MW (Q.SARDOR)`  [EXTRACTED]
  TRIPO-PLAN.md → public/assets/models/ATTRIBUTION.md
- `BMW M3 GTR (user model, id bmw-m3-gtr)` --references--> `models manifest.json`  [EXTRACTED]
  TRIPO-PLAN.md → public/assets/models/README.md

## Import Cycles
- 2-file cycle: `src/spa.ts -> src/world.ts -> src/spa.ts`

## Hyperedges (group relationships)
- **Split frontend/backend multiplayer deployment** — multiplayer_render_deployment, multiplayer_cloudflare_static_deployment, multiplayer_vite_multiplayer_url, multiplayer_cors_origin [EXTRACTED 1.00]
- **Default engine audio clip set** — public_assets_audio_cars_default_readme_engine_idle_ogg, public_assets_audio_cars_default_readme_engine_load_ogg, public_assets_audio_cars_default_readme_tire_skid_ogg, public_assets_audio_cars_default_readme_rpm_position_mapping, public_assets_audio_cars_default_readme_rev_limiter_pulse [EXTRACTED 1.00]
- **GLB loading and presentation pipeline** — public_assets_models_manifest, public_assets_models_vehicle_research_lazy_glb_loading, public_assets_models_vehicle_research_procedural_fallback, public_assets_models_vehicle_research_model_normalization, public_assets_models_vehicle_research_shop_camera_fit, public_assets_models_vehicle_research_wheel_pivot_system [INFERRED 0.85]
- **Catalog price and real spec separation** — public_assets_models_vehicle_research_vehicle_catalog, public_assets_models_vehicle_research_real_specs, public_assets_models_vehicle_research_turkey_price_try, public_assets_models_vehicle_research_game_price [EXTRACTED 1.00]
- **Body-kit models using factory base specs** — public_assets_models_vehicle_research_bmw_m3_e92_lbw, public_assets_models_vehicle_research_bmw_m3_e46_m2_motoring, public_assets_models_vehicle_research_bmw_m4_md4, public_assets_models_vehicle_research_bmw_m4_varis, public_assets_models_vehicle_research_factory_base_reference [EXTRACTED 1.00]
- **Splash screen density/orientation variants** — android_app_src_main_res_drawable_land_hdpi_splash, android_app_src_main_res_drawable_land_mdpi_splash, android_app_src_main_res_drawable_land_xhdpi_splash, android_app_src_main_res_drawable_land_xxhdpi_splash, android_app_src_main_res_drawable_port_hdpi_splash, android_app_src_main_res_drawable_port_mdpi_splash, android_app_src_main_res_drawable_port_xhdpi_splash, android_app_src_main_res_drawable_port_xxhdpi_splash, android_app_src_main_res_drawable_port_xxxhdpi_splash [INFERRED 0.95]
- **Launcher icon variants (square, round, adaptive foreground)** — android_app_src_main_res_mipmap_hdpi_ic_launcher, android_app_src_main_res_mipmap_mdpi_ic_launcher, android_app_src_main_res_mipmap_xhdpi_ic_launcher, android_app_src_main_res_mipmap_hdpi_ic_launcher_round, android_app_src_main_res_mipmap_mdpi_ic_launcher_round, android_app_src_main_res_mipmap_xhdpi_ic_launcher_round, android_app_src_main_res_mipmap_xxhdpi_ic_launcher_round, android_app_src_main_res_mipmap_xxxhdpi_ic_launcher_round, android_app_src_main_res_mipmap_hdpi_ic_launcher_foreground, android_app_src_main_res_mipmap_mdpi_ic_launcher_foreground, android_app_src_main_res_mipmap_xhdpi_ic_launcher_foreground, android_app_src_main_res_mipmap_xxhdpi_ic_launcher_foreground, android_app_src_main_res_mipmap_xxxhdpi_ic_launcher_foreground [INFERRED 0.95]

## Communities (79 total, 33 thin omitted)

### Community 0 - "Drive Engine Core (dup)"
Cohesion: 0.05
Nodes (15): IncomeClock, approach(), disposeObject(), DriveEngine, DrivingControl, EngineCallbacks, Gear, GEAR_LAUNCH_SPEED_KMH (+7 more)

### Community 1 - "README Game Features"
Cohesion: 0.05
Nodes (56): Autodrom — Drive & Build README, Third-person 3D car tycoon game, City and highway (otoban) environments, Kontroller (W/S, A/D, Q/E gears, Space handbrake, Esc), Reverse/neutral/1–6 gear shifting, LocalStorage save (money, cars, map, graphics), Catalog modelPath auto-loading of GLB, Three.js (+48 more)

### Community 2 - "Geometry & Track Builders"
Cohesion: 0.08
Nodes (43): three, toFloatAttribute(), toFloatGeometry(), Drop, batchStaticMeshes(), BUSHIDO_PEAK_CONFIG, createBushidoPeakWorld(), createNurburgringWorld() (+35 more)

### Community 3 - "Main Bootstrap & Debug"
Cohesion: 0.10
Nodes (29): activateVehicle(), closeDevCodePanel(), engine, gameHost, handleAction(), hideLoading(), isMobileViewport(), lastTelemetry (+21 more)

### Community 4 - "Drivetrain Physics"
Cohesion: 0.10
Nodes (27): VehicleSpec, aeroProfileOf(), airDragCoefficient(), approach(), AxleStepResult, clampMagnitude(), DriveLayout, driveLayoutOf() (+19 more)

### Community 5 - "Game UI Interface"
Cohesion: 0.10
Nodes (6): checked(), escapeHtml(), GameInterface, normalizeSearch(), selected(), specBar()

### Community 6 - "Android Icon/Splash Art"
Cohesion: 0.13
Nodes (28): Android Screen Density Buckets (mdpi-xxxhdpi, land/port), Autodrom App Branding (placeholder; Capacitor default not customized), Capacitor Default Logo (blue gradient crossed-bar X mark), Splash landscape hdpi, Splash landscape mdpi, Splash landscape xhdpi, Splash landscape xxhdpi, Splash portrait hdpi (+20 more)

### Community 8 - "Vehicle Catalog A"
Cohesion: 0.08
Nodes (25): Aston Martin Valkyrie, Audi RS 4 (B7 reference), BMW M3 CSL E46, BMW M3 E92, Bugatti Chiron Super Sport 300+, Koenigsegg CC850, Lamborghini Gallardo LP560-4 Spyder, Lamborghini Huracan LP 610-4 LB Works (+17 more)

### Community 9 - "Vehicle Catalog B"
Cohesion: 0.08
Nodes (22): BMW M4 GTS, BMW M4 (Duke Dynamics MD4), BMW M4 Varis, BMW M5 E60, Bugatti La Voiture Noire, Ferrari LaFerrari, Koenigsegg One:1, Mercedes-AMG GT3 (2016) (+14 more)

### Community 10 - "Lamp Bloom & Vehicle Visuals"
Cohesion: 0.09
Nodes (22): BLOOM_LEVELS, GLOW_LAYER, applyBrakeLevel(), BRAKE_GLOW, brakeLampCenters(), CachedModel, contactShadowMap(), createContactShadow() (+14 more)

### Community 11 - "Model Attribution & Plans"
Cohesion: 0.13
Nodes (20): BMW E36 M3 (Martin Trafas), BMW M3 GTR - NFS MW (Q.SARDOR), CC BY 4.0, Sketchfab, Circuit de Spa-Francorchamps 1992 (Dave Love), Araç GLB modelleri README, GLB/ brand/model folder layout, models manifest.json (+12 more)

### Community 13 - "Model Manifest & Cars"
Cohesion: 0.12
Nodes (19): models, BMW M3 E36, BMW M3 E36 (1993), BMW M3 E46, BMW M3 E46 (M2 Motoring), Dodge Viper SRT-10 ACR-X, Ferrari F12berlinetta, Nissan 370Z (+11 more)

### Community 14 - "Multiplayer Server"
Cohesion: 0.11
Nodes (13): allowedOrigins, cleanName(), cleanVehicle(), httpServer, io, manifestPath, MAP_IDS, mimeTypes (+5 more)

### Community 15 - "Chassis Steering Model"
Cohesion: 0.18
Nodes (11): approach(), camberLatMultiplier(), ChassisBody, ChassisInput, ChassisOutput, clamp(), nonlinearTireResponse(), smoothstep() (+3 more)

### Community 16 - "Render Pipeline"
Cohesion: 0.15
Nodes (3): LampBloom, MotionBlur, modelDownloadProgress()

### Community 17 - "TS Config"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleResolution, noEmit, noUnusedLocals (+8 more)

### Community 18 - "Package Manifest"
Cohesion: 0.17
Nodes (13): devDependencies, @types/three@^0.180.0, typescript@~5.9.3, vite@^7.1.9, wrangler@^4.152.0, name, private, type (+5 more)

### Community 20 - "Tire Profiles & Tuning"
Cohesion: 0.17
Nodes (12): SingleTireTelemetry, TIRE_PROFILES, TireEditTarget, TireProfileId, TireTuningParams, PROFILE_LIST, SLIDER_SPECS, SliderBinding (+4 more)

### Community 21 - "Map Lighting & Stance"
Cohesion: 0.24
Nodes (5): lightingFor(), shadowHalfExtent(), shadowMapResolution(), setVehicleSuspension(), setVehicleWheelSpin()

### Community 22 - "Vehicle Data Notes"
Cohesion: 0.18
Nodes (11): BMW M3 GTR, bmw_m3_gtr_-_nfs_mw.glb, BMW M4 Competition, Vehicle Model and Technical Data Notes, Game price (price), realSpecs field, Source BMW_G82, Source BMW_M3_GTR_RACE (+3 more)

### Community 23 - "Sky & Environment Colors"
Cohesion: 0.18
Nodes (12): SkyColors, applyWetness(), color(), EnvironmentLighting, FLASH_COLOR, KEY_COLORS, LIGHTNING_GAP, OVERCAST_DAY (+4 more)

### Community 25 - "Engine Audio"
Cohesion: 0.23
Nodes (8): Default car audio clips README, engine-idle.ogg, engine-load.ogg (850→7050 RPM sweep), tire-skid.ogg, Third-person chase camera, speed/gear/RPM HUD, drift marks, AUDIO_FILES, SoundLayer, VehicleAudioState

### Community 26 - "Atmosphere Sky Bake"
Cohesion: 0.24
Nodes (4): Atmosphere, DAYLIGHT, setSkyUniforms(), skyMaterial()

### Community 27 - "Debug Panel"
Cohesion: 0.21
Nodes (5): clock(), CYCLE_OPTIONS, DebugInfo, DebugPanel, EnvironmentState

### Community 28 - "Remote Cars & Smoke"
Cohesion: 0.23
Nodes (3): advanceSmokeBuild(), smokeDensity(), groundHeightAt()

### Community 29 - "Tire Smoke"
Cohesion: 0.20
Nodes (3): disposeObject(), createPuffTexture(), TireSmoke

### Community 30 - "Rain & Lightning"
Cohesion: 0.20
Nodes (3): LightningBolt, RainField, GameSettings

### Community 31 - "Weather Environment"
Cohesion: 0.24
Nodes (3): Environment, sunDirectionAt(), debugPanel

### Community 32 - "Camera Spring Motion"
Cohesion: 0.29
Nodes (6): CameraMotion, CameraMotionInput, clamp(), smoothstep(), Spring, stepSpring()

### Community 33 - "Stance Controls"
Cohesion: 0.31
Nodes (4): stancePanel, toggleStancePanel(), StanceConfig, StancePresetId

### Community 35 - "Vehicle Materials"
Cohesion: 0.33
Nodes (9): setVehicleMaterialQuality(), applyVarnishQuality(), classify(), Kind, luminance(), materialsOf(), refineVehicleMaterials(), setVarnishQualityDefault() (+1 more)

### Community 36 - "Runtime Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, @capacitor/android@^8.5.3, @capacitor/core@^8.5.3, socket.io@^4.8.4, socket.io-client@^4.8.4, three@^0.180.0, @capacitor/android, @capacitor/core (+1 more)

### Community 38 - "Procedural Car Builder"
Cohesion: 0.28
Nodes (9): createLampGlow(), createVehicleVisual(), createWheel(), emptyLights(), findModelLights(), lampMaterial(), makeMaterial(), panel() (+1 more)

### Community 39 - "Body-Kit Cars & BoP"
Cohesion: 0.29
Nodes (7): BMW M3 E92 Liberty Walk, BMW M3 E92 Liberty Walk V2, BMW M4 GT3 EVO, Balance of Performance (BoP), Source BMW_GT3_EVO, Source LIBERTYWALK_M3_E92, Uncertainties (Belirsizlikler)

### Community 41 - "Model Load & Dispose"
Cohesion: 0.32
Nodes (8): availableModels(), buildModelSuspension(), disposeBrakeGlow(), disposeObjectResources(), disposeVehicleVisual(), getWheelLocalBounds(), installGeneratedModel(), releaseModelIfUnused()

### Community 43 - "Stance Presets"
Cohesion: 0.29
Nodes (6): cloneStanceConfig(), PRESET_ORDER, SLIDER_SPECS, STANCE_PRESETS, StancePanelActions, StanceSliderSpec

### Community 44 - "Static Mesh Merging"
Cohesion: 0.33
Nodes (7): getCachedModel(), isAnimatedNode(), lampMergeRule(), mergeRigidPart(), mergeStaticMeshes(), nodeLabel(), objectName()

### Community 45 - "NPM Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, preview, server, start

### Community 46 - "Remote Vehicle Types"
Cohesion: 0.47
Nodes (4): RemoteVehicle, RemoteVehicle, MultiplayerPlayer, VehicleVisual

### Community 47 - "Reversed Model Cars"
Cohesion: 0.40
Nodes (5): Audi RS 3 Sedan (2023), Mercedes-Benz SL 65 AMG Black Series, modelRotationY: Math.PI, Source AUDI_RS3_8Y, Source MERCEDES_SL65_BLACK_SERIES

### Community 49 - "Capacitor Config"
Cohesion: 0.50
Nodes (3): config, @capacitor/cli@^8.5.3, @capacitor/cli

### Community 51 - "Vision GT Concepts"
Cohesion: 0.50
Nodes (4): Bugatti Vision Gran Turismo, Source BUGATTI_VISION_GT, Source VW_GTI_SUPERSPORT_VGT, Volkswagen GTI Supersport VGT

### Community 54 - "Splash xxxhdpi (cached)"
Cohesion: 0.67
Nodes (3): Capacitor default logo (blue gradient X mark), Unbranded Capacitor template splash (white background), Android landscape xxxhdpi splash screen

### Community 55 - "Capacitor Splash (cached)"
Cohesion: 0.67
Nodes (3): Capacitor logo (blue X mark on white), Capacitor Android wrapper, Android splash.png (default Capacitor splash)

### Community 56 - "Launcher xxhdpi (cached)"
Cohesion: 0.67
Nodes (3): Default Capacitor logo (blue X on grid), Android launcher icon (xxhdpi), Placeholder template app branding

### Community 57 - "Launcher xxxhdpi (cached)"
Cohesion: 0.67
Nodes (3): Default Capacitor logo (blue X on white grid), Android launcher icon (xxxhdpi), Unbranded placeholder icon (no Autodrom branding)

## Ambiguous Edges - Review These
- `Capacitor Default Logo (blue gradient crossed-bar X mark)` → `Autodrom App Branding (placeholder; Capacitor default not customized)`  [AMBIGUOUS]
  android/app/src/main/res/drawable-land-hdpi/splash.png · relation: conceptually_related_to

## Knowledge Gaps
- **22 isolated node(s):** `VITE_MULTIPLAYER_URL`, `CORS_ORIGIN`, `Render web service deployment`, `Cloudflare static deployment`, `Cloudflare Durable Objects alternative` (+17 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 242 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DriveEngine` connect `Drive Loop & Collisions` to `Drive Engine Core (dup)`, `README Game Features`, `Geometry & Track Builders`, `Main Bootstrap & Debug`, `Drivetrain Physics`, `Multiplayer Client`, `Chassis Steering Model`, `Render Pipeline`, `Axle Grip Parameters`, `Tire Profiles & Tuning`, `Map Lighting & Stance`, `Remote Cars & Smoke`, `Tire Smoke`, `Rain & Lightning`, `Weather Environment`, `Stance Controls`, `Lens Raindrops`, `Tire Tuning Actions`, `Remote Vehicle Types`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **What connects `VITE_MULTIPLAYER_URL`, `CORS_ORIGIN`, `Render web service deployment` to the rest of the system?**
  _22 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Drive Engine Core (dup)` be split into smaller, more focused modules?**
  _Cohesion score 0.0528169014084507 - nodes in this community are weakly interconnected._
- **Why does `three` connect `Geometry & Track Builders` to `Drive Engine Core (dup)`, `README Game Features`, `Vehicle Materials`, `Runtime Dependencies`, `Lamp Bloom & Vehicle Visuals`, `Render Pipeline`, `Package Manifest`, `Sky & Environment Colors`, `Atmosphere Sky Bake`, `Tire Smoke`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Should `README Game Features` be split into smaller, more focused modules?**
  _Cohesion score 0.050724637681159424 - nodes in this community are weakly interconnected._
- **Why does `DriveEngine` connect `Drive Engine Core (dup)` to `README Game Features`, `Geometry & Track Builders`, `Drivetrain Physics`, `Multiplayer Client`, `Remote Vehicle Types`, `Rain & Lightning`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Capacitor Default Logo (blue gradient crossed-bar X mark)` and `Autodrom App Branding (placeholder; Capacitor default not customized)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._