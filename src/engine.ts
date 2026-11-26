import * as THREE from 'three';
import { ECONOMY, MAP_LABELS, VEHICLES, WORLD_SCALE, type MapId, type VehicleSpec } from './data';
import { IncomeClock } from './economy';
import type { GameSettings } from './save';
import { createVehicleVisual, disposeVehicleVisual, installGeneratedModel, modelDownloadProgress, setVehicleLights, setVehicleMaterialQuality, setVehicleSuspension, setVehicleWheelSpin, type VehicleVisual } from './vehicle';
import { VehicleAudio } from './vehicleAudio';
import { TireSmoke } from './tireSmoke';
import { MotionBlur } from './motionBlur';
import { LensDrops } from './lensDrops';
import { LampBloom } from './lampBloom';
import { CameraMotion } from './cameraMotion';
import { Atmosphere, DAYLIGHT } from './atmosphere';
import { Environment, applyWetness, type EnvironmentState } from './environment';
import type { TireDebugState, TireEditTarget, TireProfileId, TireTuningParams } from './chassis';
import { aeroDownforceG, aeroProfileOf, driveLayoutOf, type AeroProfile, type Gear } from './drivetrain';
import { VehicleSim } from './vehicleSim';
import type { LocalPlayerState, MultiplayerClient, MultiplayerPlayer } from './multiplayer';
import { STANCE_PRESETS, cloneStanceConfig, type StanceConfig, type StancePresetId } from './stancePanel';
import { buildWorld, groundHeightAt, type WorldData } from './world';
import type { WallGrid } from './terrain';

export type { Gear } from './drivetrain';
export type DrivingControl = 'gas' | 'brake' | 'left' | 'right' | 'handbrake';

export interface DriftComboState {
  active: boolean;
  sliding: boolean;
  score: number;
  multiplier: number;
  remainingSeconds: number;
  angleDeg: number;
  transitionFlash: boolean;
}

export interface Telemetry {
  speedKmh: number;
  gear: Gear;
  rpm: number;
  drifting: boolean;
  tcsActive: boolean;
  driftCombo?: DriftComboState;
}

export type CameraMode = 'chase' | 'free' | 'locked';

export interface EngineCallbacks {
  onIncome: (amount: number) => void;
  onDriftComplete?: (score: number, payout: number, maxMultiplier: number) => void;
  onMissionComplete: (amount: number) => void;
  onMissionFailed: () => void;
  onDevCode: () => void;
  onDebugPanel: () => void;
  onTireDebugPanel?: () => void;
  onStancePanel?: () => void;
  onCameraModeChange?: (mode: CameraMode) => void;
  onToggleTcs: () => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onEscape: () => void;
}

interface RemoteVehicle {
  target: MultiplayerPlayer;
  root: THREE.Group;
  visual: VehicleVisual;
  spec: VehicleSpec;
  wheelTravel: number;
  rearWheelTravel: number;
  steeringAngle: number;
  smokeEmitElapsed: number;
  smokeBuild: number;
  smokeEmitter: number;
  previousX: number;
  previousZ: number;
}


const SMOKE_EMIT_INTERVAL = 0.03;
// A model this slow to arrive finishes loading in the background instead.
const MODEL_LOAD_TIMEOUT_MS = 30000;
// Headlight beam strength at full darkness (candela).
const HEADLIGHT_INTENSITY = 1800;
// Soft red ground glow behind the rear bumper while braking (replaces dynamic PointLights
// so braking never alters scene light counts or triggers shader recompilation).
const BRAKE_SPILL_OPACITY = 0.52;
// Seconds between automatic re-bakes of the sky reflections while the day/night clock runs.
const ENVIRONMENT_BAKE_INTERVAL = 20;
// Distance between wall checks along a frame's move (m); walls are 1 m cells.
const WALL_CHECK_STEP = 0.5;
// Chase camera framing, set on the 911 GT3 RS (5.48 m long, 1.58 m tall in
// game) and scaled with each car's size so every car sits the same on screen.
const CAMERA_REFERENCE_LENGTH = 5.48;
const CAMERA_REFERENCE_HEIGHT = 1.58;
const CAMERA_DISTANCE = 7.75;       // m from the car's centre to the lens
const CAMERA_TARGET_HEIGHT = 1.05;  // m above the ground the camera aims at
const CAMERA_ELEVATION = 0.197;     // rad, ~11° looking down
const CAMERA_PULLBACK = 0.035;      // distance added at full pull-back, as a share
const CAMERA_PULLBACK_START = 150 / 3.6;
const CAMERA_PULLBACK_FULL = 320 / 3.6;
// Speed blur: none below the first speed, full strength at the second.
const MOTION_BLUR_START = 90 / 3.6;
const MOTION_BLUR_FULL = 260 / 3.6;
const MOTION_BLUR_MAX = 0.075;
// Smoke builds up while the tyres keep sliding: thin wisps at first, a thick
// cloud after this many seconds. It dies back quicker once grip returns.
const SMOKE_BUILD_TIME = 1.6;
const SMOKE_DECAY_TIME = 0.4;
// Drift combo scoring: closes out after 5 s without drifting and pays 30% of score as cash.
const DRIFT_COMBO_TIMEOUT = 5.0;
const DRIFT_PAYOUT_SHARE = 0.30;
const DRIFT_MAX_MULTIPLIER = 5.0;
const DRIFT_SECONDS_PER_STEP = 2.4;
// The sun's shadow camera covers this many metres around the player's car and
// follows it, instead of covering the whole map at once.

// Direction from the shadow target to the sun (same angle as the old fixed sun).
const SUN_OFFSET = new THREE.Vector3(-80, 160, -60);
const GRAVITY = 9.81;
// Rise allowed in one step beyond the slope itself; more is a ramp's vertical face: a wall.
const MAX_STEP_UP = 0.4;
// Suspension, tuned like a firm sports car rather than per model: ~2 Hz body
// bounce, well damped, stiff anti-roll bars, little roll and pitch under load.
const SUSPENSION = {
  frequencyHz: 1.95,
  dampingRatio: 0.5,
  bumpTravel: 0.09,       // compression past static ride height before the bump stop (m)
  bumpStopStiffness: 12,  // bump stop rate as a multiple of the spring rate
  bumpStopDamping: 5,     // extra damping inside the bump stop: it absorbs, it does not bounce
  hardLimit: 0.16,        // compression the body can never exceed (m)
  centerOfMassHeight: 0.48,
  pitchGyration: 0.29,    // radius of gyration as a share of car length
  rollGyration: 0.3,      // radius of gyration as a share of car width
  antiRollShare: 1.15,    // anti-roll bars add this share of the springs' own roll stiffness
  maxInertialAccel: 9,    // ~0.9 g: what street tyres can transmit; also ignores wall hits
  airAngularDamping: 1.4, // gentle loss of pitch/roll spin while airborne (1/s)
  substep: 1 / 240,
} as const;
function pixelRatioLimit(quality: GameSettings['quality']): number {
  if (quality === 'ultra') return 1.5;
  if (quality === 'high') return 1.1;
  return quality === 'medium' ? 0.95 : 0.8;
}

/**
 * Light levels per quality. The baked sky environment now gives materials
 * their ambient light and reflections, so the hemisphere light is only a
 * small fill; low quality (no shadows) leans on it more.
 */
function lightingFor(quality: GameSettings['quality']): { fill: number; sun: number; environment: number } {
  if (quality === 'low') return { fill: 0.9, sun: 2.6, environment: 0.65 };
  if (quality === 'medium') return { fill: 0.45, sun: 3, environment: 0.9 };
  return { fill: 0.35, sun: 3.1, environment: 1 };
}

// Metres the sun's shadow covers around the car: smaller areas give sharper
// shadows from the same map (~5 cm texels on high, ~4 cm on ultra).
function shadowHalfExtent(quality: GameSettings['quality']): number {
  if (quality === 'ultra') return 60;
  if (quality === 'high') return 40;
  return 36;
}

function shadowMapResolution(quality: GameSettings['quality']): number {
  if (quality === 'ultra') return 2048;
  if (quality === 'high') return 1536;
  return 1024;
}

function renderPixelRatio(quality: GameSettings['quality'], resolutionScale: GameSettings['resolutionScale']): number {
  return Math.max(0.5, Math.min(window.devicePixelRatio || 1, pixelRatioLimit(quality)) * resolutionScale);
}

export class DriveEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly motionBlur: MotionBlur;
  private readonly lampBloom: LampBloom;
  private readonly lensDrops: LensDrops;
  /** Screen point (0..1) lens drops are blown away from at speed. */
  private readonly dropFocus = new THREE.Vector2(0.5, 0.56);
  private readonly atmosphere = new Atmosphere(DAYLIGHT, SUN_OFFSET);
  private readonly environment: Environment;
  // Direction and distance from the shadow target to the light; follows the sun or moon.
  private readonly sunOffset = SUN_OFFSET.clone();
  private readonly sunForward = new THREE.Vector3();
  private readonly headlight = new THREE.SpotLight('#fff3df', 0, 95, 0.52, 0.6, 1.4);
  // Zero-light-cost additive red ground spill behind the rear bumper while braking.
  private readonly brakeSpillMaterial: THREE.MeshBasicMaterial;
  private readonly brakeSpillMesh: THREE.Mesh;
  // Spill strength by time of day: faint in sunlight, full at night.
  private brakeSpillScale = 0.14;
  private fogBase = { near: 108, far: 950 };
  private bakedHour = 0;
  private bakeForced = true;
  private bakedRain = -1;
  private bakedAt = -Infinity;
  private wetnessApplied = -1;
  private environmentTime = 0;
  private environmentBakes = 0;
  private fps = 60;
  private readonly initialModel: Promise<boolean>;
  private readonly blurFocus = new THREE.Vector2(0.5, 0.6);
  private readonly blurProbe = new THREE.Vector3();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1400);
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly touchKeys = new Set<string>();
  private readonly incomeClock = new IncomeClock();
  private readonly vehicleAudio = new VehicleAudio();
  private multiplayer: MultiplayerClient | null = null;
  private readonly remoteVehicles = new Map<string, RemoteVehicle>();
  private multiplayerSendElapsed = 0;
  private readonly sun: THREE.DirectionalLight;
  private readonly carRoot = new THREE.Group();
  private readonly callbacks: EngineCallbacks;
  private worldData: WorldData;
  private visual: VehicleVisual;
  private vehicle: VehicleSpec;
  private mapId: MapId;
  private settings: GameSettings;
  private velocity = new THREE.Vector3();
  // Vehicle dynamics (tyres, engine, gearbox); this class draws and moves what it computes.
  private readonly sim: VehicleSim;
  private cameraOrbit = 0;
  private cameraElevation = CAMERA_ELEVATION;
  private cameraHeading = 0;
  private cameraHeight = 0;
  private cameraZoom = 1;
  private readonly cameraMotion = new CameraMotion();
  private cameraGear: Gear = 1;
  private freeCameraActive = false;
  private cameraLocked = false;
  private lockedDistance = 0;
  private readonly lockedLocalPos = new THREE.Vector3();
  private readonly lockedLocalQuat = new THREE.Quaternion();
  private readonly lockedBasisQuat = new THREE.Quaternion();
  private readonly lockedBasisEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly freeCamPos = new THREE.Vector3();
  private readonly freeCamVel = new THREE.Vector3();
  private readonly freeCamDir = new THREE.Vector3();
  private readonly freeCamRight = new THREE.Vector3();
  private readonly freeCamMove = new THREE.Vector3();
  private readonly shadowFocus = new THREE.Vector3();
  private freeCamYaw = 0;
  private freeCamPitch = 0;
  private freeCamSpeed = 32;
  // Body-frame acceleration measured by the suspension each frame (m/s², clamped).
  private bodyAccelLong = 0;
  private bodyAccelLat = 0;
  private drivingEnabled = false;
  private cameraPointerId: number | null = null;
  private cameraPointerX = 0;
  private cameraPointerY = 0;
  private readonly cameraPointers = new Map<number, { x: number; y: number }>();
  private cameraPinchDistance = 0;
  private active = true;
  private sceneNeedsRender = true;
  private animationFrame = 0;
  private renderElapsed = 0;
  private telemetryElapsed = 0;
  private wheelTravel = 0;
  private rearWheelTravel = 0;
  private driftValue = 0;
  private driftScore = 0;
  private driftMultiplier = 1;
  private driftPeakMultiplier = 1;
  private driftComboProgress = 0;
  private driftIdleTimer = 0;
  private driftSide: -1 | 0 | 1 = 0;
  private driftSideHold = 0;
  private driftTransitionTimer = 0;
  private driftCurrentAngleDeg = 0;
  private driftSlidingNow = false;
  private readonly driftComboState: DriftComboState = {
    active: false,
    sliding: false,
    score: 0,
    multiplier: 1,
    remainingSeconds: DRIFT_COMBO_TIMEOUT,
    angleDeg: 0,
    transitionFlash: false,
  };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly previousCarPosition = new THREE.Vector3();
  private readonly speedGateCooldowns = new Map<string, number>();
  private drivingElapsed = 0;
  private readonly skidMarks: THREE.InstancedMesh;
  private readonly skidDummy = new THREE.Object3D();
  private readonly skidSlope = new THREE.Vector2();
  private readonly skidPreviousPositions: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skidCurrentPositions: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skidModelLocalPositions: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skidPreviousCenter = new THREE.Vector3();
  private readonly skidCurrentCenter = new THREE.Vector3();
  private readonly skidFrameTravel = new THREE.Vector3();
  private readonly skidInterpolatedPosition = new THREE.Vector3();
  private skidModelPositionsReady = false;
  private hasPreviousSkidPositions = false;
  private skidIndex = 0;
  private skidCount = 0;
  private skidDistance = 0;
  private static readonly skidCapacity = 300;
  private readonly tireSmoke = new TireSmoke();
  // Body on four springs: heave above the flat map, pitch (+ nose up), roll (+ right side up).
  private bodyHeight = 0;
  private heaveVelocity = 0;
  private bodyPitch = 0;
  private pitchRate = 0;
  private bodyRoll = 0;
  private rollRate = 0;
  private airborne = false;
  private readonly wheelGround = [0, 0, 0, 0];
  private readonly suspensionTravel = [0, 0, 0, 0];
  private readonly groundRate = [0, 0, 0, 0];
  private readonly wheelSuspensionLoads = [0, 0, 0, 0];
  private readonly wheelStaticLoad = [0, 0, 0, 0];
  private readonly wheelToChassisIdx = [0, 1, 2, 3];
  private suspCachedWheels: unknown = null;
  private suspSpringRate = 0;
  private suspDamperRate = 0;
  private suspPitchInertia = 1;
  private suspRollInertia = 1;
  private suspAntiRollStiffness = 0;
  private aeroProfile: AeroProfile;
  private stancePreset: StancePresetId | null = 'stock';
  private readonly stance: StanceConfig = cloneStanceConfig(STANCE_PRESETS.stock.config);
  private readonly telemetryState: Telemetry = { speedKmh: 0, gear: 1, rpm: 850, drifting: false, tcsActive: false };
  private readonly previousVelocity = new THREE.Vector3();
  private readonly groundSlope = new THREE.Vector2();
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();
  private smokeEmitElapsed = 0;
  private smokeBuild = 0;
  // Smoke emitter ids: 0-1 local rear wheels, 2-3 local fronts, remotes take pairs after.
  private nextSmokeEmitter = 4;
  private readonly ambient: THREE.HemisphereLight;
  private readonly resizeObserver: ResizeObserver;

  private get gear(): Gear { return this.sim.gear; }
  private get yaw(): number { return this.sim.body.yaw; }
  private set yaw(value: number) { this.sim.body.yaw = value; }
  private get frontWheelAngle(): number { return this.sim.frontWheelAngle; }

  constructor(
    private readonly host: HTMLElement,
    vehicle: VehicleSpec,
    mapId: MapId,
    settings: GameSettings,
    callbacks: EngineCallbacks,
  ) {
    this.vehicle = vehicle;
    this.aeroProfile = aeroProfileOf(vehicle);
    this.sim = new VehicleSim(vehicle, this.velocity, Math.PI / 2);
    this.sim.automatic = settings.transmissionMode === 'automatic';
    setVehicleMaterialQuality(settings.quality);
    this.mapId = mapId;
    this.settings = { ...settings };
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color('#9aafac');
    this.scene.fog = new THREE.Fog('#9aafac', 108, 950);
    this.ambient = new THREE.HemisphereLight('#e4f0e8', '#59624f', lightingFor(this.settings.quality).fill);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff1d5', lightingFor(this.settings.quality).sun);
    this.scene.add(this.sun.target);
    this.sun.castShadow = true;
    this.applyShadowExtent();
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = SUN_OFFSET.length() + 120;
    this.sun.shadow.bias = -0.0002;
    // Offsets along the surface normal: no shadow acne on curved bodywork.
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.camera.updateProjectionMatrix();
    // Light-space axes used to snap the moving shadow camera to whole texels,
    // which keeps shadow edges from shimmering while the car drives.
    this.scene.add(this.sun);
    // Yaw first, then pitch/roll in the car's own frame.
    this.carRoot.rotation.order = 'YXZ';
    this.scene.add(this.carRoot);
    this.skidMarks = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.018, 1.25),
      new THREE.MeshStandardMaterial({ color: '#1a1a18', roughness: 1, transparent: true, opacity: 0.46, depthWrite: false }),
      DriveEngine.skidCapacity,
    );
    this.skidMarks.count = 0;
    this.skidMarks.visible = this.settings.effects;
    this.skidMarks.receiveShadow = true;
    this.skidMarks.frustumCulled = false;
    this.skidMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.skidMarks);
    this.tireSmoke.mesh.visible = this.settings.effects;
    this.scene.add(this.tireSmoke.mesh);
    this.scene.add(this.atmosphere.dome);
    this.environment = new Environment(this.settings.quality);
    this.scene.add(this.environment.rain.mesh, this.environment.bolt.mesh);
    this.headlight.castShadow = false;
    this.headlight.visible = false;
    this.carRoot.add(this.headlight, this.headlight.target);
    this.brakeSpillMaterial = new THREE.MeshBasicMaterial({
      map: createBrakeSpillTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.brakeSpillMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.brakeSpillMaterial);
    this.brakeSpillMesh.name = 'brake-spill';
    this.brakeSpillMesh.rotation.x = -Math.PI / 2;
    this.brakeSpillMesh.renderOrder = 2;
    this.brakeSpillMesh.visible = false;
    this.brakeSpillMesh.castShadow = false;
    this.brakeSpillMesh.receiveShadow = false;
    this.brakeSpillMesh.userData.castsShadow = false;
    this.carRoot.add(this.brakeSpillMesh);
    this.placeBrakeSpill();
    this.worldData = buildWorld(mapId, this.settings);
    this.scene.add(this.worldData.root);
    this.visual = createVehicleVisual(vehicle);
    this.carRoot.add(this.visual.root);
    this.initialModel = installGeneratedModel(this.visual, vehicle).then((ok) => {
      this.applyStanceVisuals();
      return ok;
    });
    this.resetCar();
    // MSAA is fixed when the WebGL context is created, so a quality change
    // toggles it only after the next page load.
    const antialias = this.settings.quality === 'high' || this.settings.quality === 'ultra';
    this.renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
    const shadowResolution = Math.min(shadowMapResolution(this.settings.quality), this.renderer.capabilities.maxTextureSize);
    this.sun.shadow.mapSize.set(shadowResolution, shadowResolution);
    this.renderer.setPixelRatio(renderPixelRatio(this.settings.quality, this.settings.resolutionScale));
    this.renderer.setSize(host.clientWidth, host.clientHeight, false);
    this.renderer.shadowMap.enabled = this.settings.shadows && this.settings.quality !== 'low';
    this.renderer.shadowMap.type = this.settings.quality === 'medium' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // Frames draw several passes (shadows, blur, bloom); count them all, reset once per frame.
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Image-based lighting from the sky: reflections and ambient for every PBR material.
    this.scene.environment = this.atmosphere.environmentMap(this.renderer);
    this.scene.environmentIntensity = lightingFor(this.settings.quality).environment;
    // MotionBlur only runs past 90 km/h on outer edges; skipping 4x MSAA resolve on the HalfFloat
    // target saves massive fillrate on high-DPI displays.
    this.motionBlur = new MotionBlur(this.renderer, this.settings.quality === 'ultra' ? 2 : 0);
    this.lampBloom = new LampBloom(this.renderer);
    this.lensDrops = new LensDrops(this.renderer);
    this.renderer.domElement.className = 'drive-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Sürüş alanı');
    this.renderer.domElement.addEventListener('wheel', this.onCameraWheel, { passive: false });
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu);
    this.host.appendChild(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
    window.addEventListener('pointerdown', this.onAudioGesture);
    window.addEventListener('pointerdown', this.onCameraPointerDown, true);
    window.addEventListener('pointermove', this.onCameraPointerMove, true);
    window.addEventListener('pointerup', this.onCameraPointerEnd, true);
    window.addEventListener('pointercancel', this.onCameraPointerEnd, true);
    this.applyMapPalette();
    this.resize();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && (event.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))) return;
    void this.vehicleAudio.unlock();
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      this.callbacks.onEscape();
      return;
    }
    if (key === 'p') {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onDebugPanel();
      return;
    }
    if (key === 'l') {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onTireDebugPanel?.();
      return;
    }
    if (key === 'ı' || key === 'i' || key === 'i̇' || event.code === 'KeyI') {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onStancePanel?.();
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      this.callbacks.onDevCode();
      return;
    }
    if (key === 't') {
      event.preventDefault();
      if (!event.repeat) this.callbacks.onToggleTcs();
      return;
    }
    if (key === 'c' || event.code === 'KeyC') {
      if (!event.repeat && this.drivingEnabled) {
        event.preventDefault();
        if (this.freeCameraActive) {
          this.cameraLocked = false;
          this.setFreeCamera(false);
        } else {
          this.setFreeCamera(true);
        }
      }
      return;
    }
    if (key === 'x' || event.code === 'KeyX') {
      if (!event.repeat && this.drivingEnabled) {
        event.preventDefault();
        if (this.freeCameraActive || !this.cameraLocked) {
          this.lockCurrentCamera();
        } else {
          this.unlockCamera();
        }
      }
      return;
    }
    if (key === 'e' || key === 'q') {
      if (this.freeCameraActive && this.drivingEnabled) {
        event.preventDefault();
        this.keys.add(key);
        return;
      }
      if (!event.repeat && this.drivingEnabled) {
        event.preventDefault();
        if (key === 'e') this.shiftUp();
        else this.shiftDown();
      }
      return;
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
      event.preventDefault();
      if (this.drivingEnabled) this.keys.add(key);
      return;
    }
    if (['w', 'a', 's', 'd', ' ', 'shift', 'control'].includes(key)) {
      if (key !== 'shift' && key !== 'control') event.preventDefault();
      if (this.drivingEnabled) this.keys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.key.toLowerCase()); };
  private clearKeys = (): void => { this.keys.clear(); this.touchKeys.clear(); this.endCameraDrag(); };
  private onAudioGesture = (): void => { void this.vehicleAudio.unlock(); };

  private onContextMenu = (event: MouseEvent): void => {
    if (this.freeCameraActive) event.preventDefault();
  };

  private onCameraWheel = (event: WheelEvent): void => {
    if (!this.drivingEnabled) return;
    event.preventDefault();
    if (this.freeCameraActive) {
      this.freeCamSpeed = THREE.MathUtils.clamp(this.freeCamSpeed * Math.exp(-event.deltaY * 0.0012), 4, 240);
      return;
    }
    if (this.cameraLocked) return;
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * Math.exp(event.deltaY * 0.001), 0.55, 2.5);
  };

  private onCameraPointerDown = (event: PointerEvent): void => {
    const allowedButton = event.button === 0 || (this.freeCameraActive && event.button === 2);
    if (!this.drivingEnabled || (this.cameraLocked && !this.freeCameraActive) || (event.pointerType === 'mouse' && !allowedButton)) return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, input, select, textarea, a, [data-action], [data-control]')) return;
    if (!(target instanceof Element) || !target.closest('.drive-canvas')) return;
    if (this.cameraPointers.has(event.pointerId)) return;
    event.preventDefault();
    this.cameraPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.renderer.domElement.setPointerCapture(event.pointerId);
    if (this.cameraPointers.size === 1) {
      this.cameraPointerId = event.pointerId;
      this.cameraPointerX = event.clientX;
      this.cameraPointerY = event.clientY;
      this.renderer.domElement.classList.add('camera-dragging');
    } else if (this.cameraPointers.size === 2) {
      this.cameraPointerId = null;
      this.cameraPinchDistance = this.getCameraPinchDistance();
      this.renderer.domElement.classList.remove('camera-dragging');
    }
  };

  private onCameraPointerMove = (event: PointerEvent): void => {
    const pointer = this.cameraPointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.cameraPointers.size >= 2) {
      const distance = this.getCameraPinchDistance();
      if (this.cameraPinchDistance > 0 && distance > 0) {
        this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * this.cameraPinchDistance / distance, 0.55, 2.5);
      }
      this.cameraPinchDistance = distance;
      return;
    }
    if (event.pointerId !== this.cameraPointerId) return;
    const deltaX = event.clientX - this.cameraPointerX;
    const deltaY = event.clientY - this.cameraPointerY;
    this.cameraPointerX = event.clientX;
    this.cameraPointerY = event.clientY;
    if (this.freeCameraActive) {
      this.freeCamYaw = Math.atan2(Math.sin(this.freeCamYaw - deltaX * 0.0055), Math.cos(this.freeCamYaw - deltaX * 0.0055));
      this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch - deltaY * 0.0055, -1.52, 1.52);
      return;
    }
    this.cameraOrbit = Math.atan2(Math.sin(this.cameraOrbit - deltaX * 0.008), Math.cos(this.cameraOrbit - deltaX * 0.008));
    this.cameraElevation = THREE.MathUtils.clamp(this.cameraElevation - deltaY * 0.006, 0.12, 0.9);
  };

  private onCameraPointerEnd = (event: PointerEvent): void => {
    if (!this.cameraPointers.delete(event.pointerId)) return;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    if (this.cameraPointers.size === 0) {
      this.cameraPointerId = null;
      this.cameraPinchDistance = 0;
      this.renderer.domElement.classList.remove('camera-dragging');
      return;
    }
    const [pointerId, pointer] = this.cameraPointers.entries().next().value as [number, { x: number; y: number }];
    this.cameraPointerId = pointerId;
    this.cameraPointerX = pointer.x;
    this.cameraPointerY = pointer.y;
    this.cameraPinchDistance = 0;
    this.renderer.domElement.classList.add('camera-dragging');
  };

  private getCameraPinchDistance(): number {
    const [first, second] = [...this.cameraPointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  }

  private endCameraDrag(): void {
    for (const pointerId of this.cameraPointers.keys()) {
      if (this.renderer.domElement.hasPointerCapture(pointerId)) this.renderer.domElement.releasePointerCapture(pointerId);
    }
    this.cameraPointers.clear();
    this.cameraPointerId = null;
    this.cameraPinchDistance = 0;
    this.renderer.domElement.classList.remove('camera-dragging');
  }

  setTouchControl(control: DrivingControl, pressed: boolean): void {
    const key: Record<DrivingControl, string> = { gas: 'w', brake: 's', left: 'a', right: 'd', handbrake: ' ' };
    if (pressed) this.touchKeys.add(key[control]);
    else this.touchKeys.delete(key[control]);
  }

  toggleTcs(): boolean {
    this.sim.tcsEnabled = !this.sim.tcsEnabled;
    return this.sim.tcsEnabled;
  }

  isFreeCamera(): boolean {
    return this.freeCameraActive;
  }

  setFreeCamera(active: boolean): void {
    if (this.freeCameraActive === active) return;
    this.freeCameraActive = active;
    this.sceneNeedsRender = true;
    if (active) {
      this.camera.getWorldDirection(this.freeCamDir);
      this.freeCamPos.copy(this.camera.position);
      this.freeCamPitch = Math.asin(THREE.MathUtils.clamp(this.freeCamDir.y, -0.999, 0.999));
      this.freeCamYaw = Math.atan2(-this.freeCamDir.x, -this.freeCamDir.z);
      this.freeCamVel.set(0, 0, 0);
      this.callbacks.onCameraModeChange?.('free');
    } else {
      this.keys.delete('q');
      this.keys.delete('e');
      this.updateCamera(0, true);
      this.updateShadowFrustum();
      this.callbacks.onCameraModeChange?.(this.cameraLocked ? 'locked' : 'chase');
    }
  }

  private computeLockedBasis(distance: number): THREE.Quaternion {
    // Close mounts (cockpit, hood, wheel arch < 3.5 m) track full body pitch & roll so bodywork
    // never clips the lens; outer chase/drone rigs damp suspension bounce over longer lever arms.
    const pitchShare = 1 - 0.72 * THREE.MathUtils.smoothstep(distance, 3.5, 11.0);
    const rollShare = 1 - 0.82 * THREE.MathUtils.smoothstep(distance, 3.5, 11.0);
    this.lockedBasisEuler.set(-this.bodyPitch * pitchShare, this.yaw, this.bodyRoll * rollShare, 'YXZ');
    return this.lockedBasisQuat.setFromEuler(this.lockedBasisEuler);
  }

  lockCurrentCamera(): void {
    this.lockedDistance = this.camera.position.distanceTo(this.carRoot.position);
    const basisInv = this.computeLockedBasis(this.lockedDistance).clone().invert();
    this.lockedLocalPos.copy(this.camera.position).sub(this.carRoot.position).applyQuaternion(basisInv);
    this.lockedLocalQuat.copy(basisInv).multiply(this.camera.quaternion);
    this.cameraLocked = true;
    if (this.freeCameraActive) {
      this.freeCameraActive = false;
      this.keys.delete('q');
      this.keys.delete('e');
    }
    this.endCameraDrag();
    this.updateShadowFrustum();
    this.sceneNeedsRender = true;
    this.callbacks.onCameraModeChange?.('locked');
  }

  unlockCamera(): void {
    if (!this.cameraLocked && !this.freeCameraActive) return;
    this.cameraLocked = false;
    this.freeCameraActive = false;
    this.keys.delete('q');
    this.keys.delete('e');
    this.updateCamera(0, true);
    this.updateShadowFrustum();
    this.sceneNeedsRender = true;
    this.callbacks.onCameraModeChange?.('chase');
  }

  setMultiplayer(client: MultiplayerClient): void {
    this.multiplayer = client;
  }

  setRemotePlayers(players: MultiplayerPlayer[]): void {
    // Players driving another map are not drawn here.
    // A server that predates map ids sends none: show those players rather than nobody.
    const currentIds = new Set(players.filter((player) => (player.mapId ?? this.mapId) === this.mapId).map((player) => player.id));
    for (const [id, remote] of this.remoteVehicles) {
      if (currentIds.has(id)) continue;
      this.scene.remove(remote.root);
      disposeVehicleVisual(remote.visual);
      this.remoteVehicles.delete(id);
    }
    for (const player of players) {
      if (player.id === this.multiplayer?.localPlayerId || !currentIds.has(player.id)) continue;
      const existing = this.remoteVehicles.get(player.id);
      if (existing && existing.target.vehicleId !== player.vehicleId) {
        this.scene.remove(existing.root);
        disposeVehicleVisual(existing.visual);
        this.remoteVehicles.delete(player.id);
      }
      const remote = this.remoteVehicles.get(player.id) ?? this.createRemoteVehicle(player);
      remote.target = player;
    }
  }

  private isDown(key: string): boolean {
    return this.keys.has(key) || this.touchKeys.has(key);
  }

  shiftUp(): void {
    this.sim.shiftUp();
  }

  shiftDown(): void {
    this.sim.shiftDown();
  }

  setDrivingEnabled(enabled: boolean): void {
    this.drivingEnabled = enabled;
    this.sceneNeedsRender = true;
    if (!enabled) {
      this.bankDriftCombo();
      this.keys.clear();
      this.touchKeys.clear();
      this.endCameraDrag();
      this.velocity.set(0, 0, 0);
      this.sim.reset();
      this.driftValue = 0;
      setVehicleLights(this.visual, false, false);
      this.incomeClock.reset();
      this.callbacks.onTelemetry({ speedKmh: 0, gear: this.gear, rpm: 850, drifting: false, tcsActive: false, driftCombo: this.syncDriftComboState() });
    }
  }

  setVehicle(vehicle: VehicleSpec): void {
    if (this.vehicle.id === vehicle.id && (this.visual.modelLoaded || this.visual.modelInstance)) {
      this.resetCar();
      return;
    }
    this.vehicle = vehicle;
    this.aeroProfile = aeroProfileOf(vehicle);
    this.velocity.set(0, 0, 0);
    this.wheelTravel = 0;
    this.rearWheelTravel = 0;
    this.sim.setVehicle(vehicle);
    this.skidModelPositionsReady = false;
    this.incomeClock.reset();
    this.clearSkids();
    this.placeBrakeSpill();
    this.carRoot.remove(this.visual.root);
    disposeVehicleVisual(this.visual);
    this.visual = createVehicleVisual(vehicle);
    this.sceneNeedsRender = true;
    this.carRoot.add(this.visual.root);
    this.resetCar();
    this.applyStanceVisuals();
    const targetVisual = this.visual;
    void installGeneratedModel(targetVisual, vehicle).finally(() => {
      if (this.visual !== targetVisual) return;
      this.applyStanceVisuals();
      this.uploadTexturesIn(targetVisual.root);
      void this.precompileSubtree(this.carRoot);
    });
  }

  /** Switches map; resolves once a map that loads in the background is in place. */
  async setMap(mapId: MapId, onProgress: (share: number, label: string) => void = () => undefined): Promise<void> {
    if (this.mapId === mapId) return;
    this.mapId = mapId;
    this.sceneNeedsRender = true;
    this.scene.remove(this.worldData.root);
    disposeObject(this.worldData.root);
    const world = buildWorld(mapId, this.settings);
    this.worldData = world;
    this.scene.add(world.root);
    this.clearSkids();
    this.tireSmoke.clear();
    this.applyMapPalette();
    this.resetCar();
    let settled = false;
    void world.ready.finally(() => { settled = true; });
    await new Promise<void>((resolve) => {
      const poll = (): void => {
        onProgress(0.05 + 0.85 * world.loadProgress(), MAP_LABELS[mapId] + ' yükleniyor');
        if (settled) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });
    // Another map was chosen meanwhile.
    if (this.worldData !== world) return;
    onProgress(0.94, 'Harita hazırlanıyor');
    await this.finishWorldLoad();
    this.sceneNeedsRender = true;
  }

  /**
   * Loads what the first drive needs: the active car's model, the engine
   * sounds, and every shader of the scene, then draws one frame. Afterwards
   * driving starts without hitches or a car popping in.
   */
  async prepare(onProgress: (share: number, label: string) => void): Promise<void> {
    const audio = this.vehicleAudio.prefetch();
    let modelSettled = false;
    void this.initialModel.finally(() => { modelSettled = true; });
    const world = this.worldData;
    let worldSettled = false;
    void world.ready.finally(() => { worldSettled = true; });
    // A map that streams its model weighs more than the car.
    const worldWeight = world.loadProgress() < 1 ? 0.6 : 0;
    const giveUpAt = performance.now() + MODEL_LOAD_TIMEOUT_MS;
    await new Promise<void>((resolve) => {
      const poll = (): void => {
        const modelDone = modelSettled || performance.now() > giveUpAt;
        const share = (modelDone ? 1 : modelDownloadProgress(this.vehicle)) * (1 - worldWeight) + world.loadProgress() * worldWeight;
        onProgress(0.04 + 0.76 * share, modelDone ? MAP_LABELS[this.mapId] + ' yükleniyor' : this.vehicle.shortName + ' yükleniyor');
        if (modelDone && worldSettled) resolve();
        else requestAnimationFrame(poll);
      };
      poll();
    });
    onProgress(0.84, 'Sesler yükleniyor');
    await audio;
    onProgress(0.92, 'Harita hazırlanıyor');
    await this.finishWorldLoad();
  }

  // Car on the spawn and every shader of the scene compiled, then one frame drawn.
  private async finishWorldLoad(): Promise<void> {
    this.resetCar();
    // Upload every texture first with capped anisotropy so nothing uploads mid-corner.
    this.uploadTexturesIn(this.scene);
    setVehicleLights(this.visual, true, true);
    // Bypass frustum culling during compileAsync so meshes behind/beside the spawn camera
    // also get their shaders compiled now instead of stalling on the first lap.
    await this.precompileSubtree(this.scene);
    this.lampBloom.compile();
    this.lampBloom.render(this.scene, this.camera, this.carRoot);
    setVehicleLights(this.visual, false, false);
    this.motionBlur.compile();
    this.lensDrops.compile();
    this.renderScene();
  }

  private uploadTexturesIn(root: THREE.Object3D): void {
    const maxAniso = Math.min(
      this.renderer.capabilities.getMaxAnisotropy(),
      this.settings.quality === 'ultra' ? 8 : this.settings.quality === 'high' ? 4 : 2,
    );
    const textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      for (const entry of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(entry)) {
          if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
        }
      }
    });
    for (const texture of textures) {
      if (texture.anisotropy > maxAniso) texture.anisotropy = maxAniso;
      this.renderer.initTexture(texture);
    }
  }

  private async precompileSubtree(targetRoot: THREE.Object3D): Promise<void> {
    const culled: THREE.Object3D[] = [];
    targetRoot.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && object.frustumCulled) {
        object.frustumCulled = false;
        culled.push(object);
      }
    });
    const prevHeadlight = this.headlight.visible;
    try {
      if (this.settings.quality !== 'low') {
        this.headlight.visible = true;
        await this.renderer.compileAsync(this.scene, this.camera);
      }
      this.headlight.visible = false;
      await this.renderer.compileAsync(this.scene, this.camera);
    } finally {
      this.headlight.visible = prevHeadlight;
      for (const object of culled) object.frustumCulled = true;
      this.sceneNeedsRender = true;
    }
  }

  setSettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.sim.automatic = settings.transmissionMode === 'automatic';
    this.sceneNeedsRender = true;
    this.renderer.shadowMap.enabled = settings.shadows && settings.quality !== 'low';
    const nextShadowType = settings.quality === 'medium' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    if (this.renderer.shadowMap.type !== nextShadowType) {
      this.renderer.shadowMap.type = nextShadowType;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.setPixelRatio(renderPixelRatio(settings.quality, settings.resolutionScale));
    this.renderer.shadowMap.needsUpdate = true;
    const shadowResolution = Math.min(shadowMapResolution(settings.quality), this.renderer.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.width !== shadowResolution || this.sun.shadow.mapSize.height !== shadowResolution) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(shadowResolution, shadowResolution);
    }
    this.applyShadowExtent();
    this.skidMarks.visible = settings.effects;
    if (settings.quality === 'low') {
      this.headlight.visible = false;
      this.brakeSpillMesh.visible = false;
    }
    this.tireSmoke.mesh.visible = settings.effects;
    if (!settings.effects) this.tireSmoke.clear();
    if (!settings.effects) this.clearSkids();
    setVehicleMaterialQuality(settings.quality);
    const lighting = lightingFor(settings.quality);
    this.ambient.intensity = lighting.fill;
    this.sun.intensity = lighting.sun;
    this.scene.environmentIntensity = lighting.environment;
    this.applyMapPalette();
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        object.castShadow = settings.shadows && settings.quality !== 'low' && object.userData.castsShadow !== false;
      }
    });
    this.resize();
  }

  getMapId(): MapId { return this.mapId; }
  getVehicle(): VehicleSpec { return this.vehicle; }

  getTireDebugState(): TireDebugState {
    return this.sim.chassis.getDebugState();
  }

  setTireProfile(profile: TireProfileId): void {
    this.sim.chassis.applyProfile(profile);
  }

  setTireEditTarget(target: TireEditTarget): void {
    this.sim.chassis.setEditTarget(target);
  }

  updateTireTuning(changes: Partial<TireTuningParams>): void {
    this.sim.chassis.updateTuning(changes);
  }

  resetTireTuning(): void {
    this.sim.chassis.resetTuningToDefault();
  }

  getStanceState(): { preset: StancePresetId | null; config: StanceConfig } {
    return { preset: this.stancePreset, config: this.stance };
  }

  setStancePreset(preset: StancePresetId): void {
    this.stancePreset = preset;
    Object.assign(this.stance, STANCE_PRESETS[preset].config);
    this.sim.chassis.setStance(this.stance);
    this.applyStanceVisuals();
  }

  updateStance(changes: Partial<StanceConfig>): void {
    this.stancePreset = null;
    if (changes.frontRideHeightMm !== undefined) this.stance.frontRideHeightMm = THREE.MathUtils.clamp(changes.frontRideHeightMm, -80, 40);
    if (changes.rearRideHeightMm !== undefined) this.stance.rearRideHeightMm = THREE.MathUtils.clamp(changes.rearRideHeightMm, -80, 40);
    if (changes.frontOffsetMm !== undefined) this.stance.frontOffsetMm = THREE.MathUtils.clamp(changes.frontOffsetMm, -20, 60);
    if (changes.rearOffsetMm !== undefined) this.stance.rearOffsetMm = THREE.MathUtils.clamp(changes.rearOffsetMm, -20, 60);
    if (changes.wheelScale !== undefined) this.stance.wheelScale = THREE.MathUtils.clamp(changes.wheelScale, 0.88, 1.16);
    if (changes.frontCamberDeg !== undefined) this.stance.frontCamberDeg = THREE.MathUtils.clamp(changes.frontCamberDeg, -12, 2);
    if (changes.rearCamberDeg !== undefined) this.stance.rearCamberDeg = THREE.MathUtils.clamp(changes.rearCamberDeg, -12, 2);
    if (changes.frontToeDeg !== undefined) this.stance.frontToeDeg = THREE.MathUtils.clamp(changes.frontToeDeg, -1.5, 1.5);
    if (changes.rearToeDeg !== undefined) this.stance.rearToeDeg = THREE.MathUtils.clamp(changes.rearToeDeg, -1.5, 1.5);
    if (changes.steeringLockBonusDeg !== undefined) this.stance.steeringLockBonusDeg = THREE.MathUtils.clamp(changes.steeringLockBonusDeg, 0, 15);
    if (changes.springStiffnessMult !== undefined) this.stance.springStiffnessMult = THREE.MathUtils.clamp(changes.springStiffnessMult, 0.5, 2.5);
    if (changes.damperStiffnessMult !== undefined) this.stance.damperStiffnessMult = THREE.MathUtils.clamp(changes.damperStiffnessMult, 0.4, 2.5);
    if (changes.antiRollBarMult !== undefined) this.stance.antiRollBarMult = THREE.MathUtils.clamp(changes.antiRollBarMult, 0.3, 2.5);
    this.sim.chassis.setStance(this.stance);
    this.applyStanceVisuals();
  }

  resetStance(): void {
    this.setStancePreset('stock');
  }

  private applyStanceVisuals(): void {
    setVehicleWheelSpin(this.visual, this.wheelTravel, this.frontWheelAngle, this.rearWheelTravel, this.stance);
    setVehicleSuspension(this.visual, this.suspensionTravel, this.stance);
    this.sceneNeedsRender = true;
  }

  resetCar(): void {
    this.bankDriftCombo();
    this.sceneNeedsRender = true;
    this.carRoot.position.copy(this.worldData.spawn);
    this.yaw = this.worldData.spawnYaw;
    this.velocity.set(0, 0, 0);
    this.sim.reset();
    this.driftValue = 0;
    this.previousCarPosition.copy(this.worldData.spawn);
    this.speedGateCooldowns.clear();
    this.drivingElapsed = 0;
    this.carRoot.rotation.set(0, this.yaw, 0);
    // Rest on the ground under the spawn (maps with terrain spawn up a hill).
    const spawnGround = groundHeightAt(this.worldData, this.carRoot.position.x, this.carRoot.position.z);
    this.carRoot.position.y = spawnGround + 0.015;
    this.bodyHeight = spawnGround;
    this.heaveVelocity = 0;
    this.bodyPitch = 0;
    this.pitchRate = 0;
    this.bodyRoll = 0;
    this.rollRate = 0;
    this.airborne = false;
    this.wheelGround.fill(spawnGround);
    this.suspensionTravel.fill(0);
    this.previousVelocity.set(0, 0, 0);
    this.bodyAccelLong = 0;
    this.bodyAccelLat = 0;
    // Back to the default chase framing, snapped so the first frame is already there.
    if (this.freeCameraActive || this.cameraLocked) this.unlockCamera();
    this.cameraOrbit = 0;
    this.cameraElevation = CAMERA_ELEVATION;
    this.cameraZoom = 1;
    this.updateCamera(0, true);
    this.incomeClock.reset();
    this.clearSkids();
    this.tireSmoke.clear();
    this.smokeBuild = 0;
    this.applyStanceVisuals();
    this.updateShadowFrustum();
  }

  private applyShadowExtent(): void {
    const extent = shadowHalfExtent(this.settings.quality);
    const camera = this.sun.shadow.camera;
    camera.left = -extent;
    camera.right = extent;
    camera.top = extent;
    camera.bottom = -extent;
    camera.updateProjectionMatrix();
  }

  private updateShadowFrustum(): void {
    // Light-space axes, used to snap the moving shadow camera to whole texels
    // so shadow edges do not shimmer while the car drives.
    this.sunForward.copy(this.sunOffset).negate().normalize();
    this.shadowRight.crossVectors(this.sunForward, THREE.Object3D.DEFAULT_UP).normalize();
    this.shadowUp.crossVectors(this.shadowRight, this.sunForward).normalize();
    const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.width;
    const focus = this.shadowFocus;
    if (this.freeCameraActive) {
      this.camera.getWorldDirection(this.freeCamDir);
      focus.copy(this.camera.position).addScaledVector(this.freeCamDir, 24);
      focus.y = groundHeightAt(this.worldData, focus.x, focus.z);
    } else {
      focus.copy(this.carRoot.position);
    }
    const right = focus.dot(this.shadowRight);
    const up = focus.dot(this.shadowUp);
    this.sun.target.position.set(focus.x, focus.y, focus.z)
      .addScaledVector(this.shadowRight, Math.round(right / texel) * texel - right)
      .addScaledVector(this.shadowUp, Math.round(up / texel) * texel - up);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
  }

  /** Time of day and weather onto the lights, sky, fog, rain and wet ground. */
  private updateEnvironment(dt: number): void {
    this.environmentTime += dt;
    const lighting = this.environment.update(dt);
    const levels = lightingFor(this.settings.quality);
    this.atmosphere.setSky(lighting.sky, lighting.lightDirection, lighting.disc, lighting.glow);
    this.sunOffset.copy(lighting.lightDirection).multiplyScalar(SUN_OFFSET.length());
    this.sun.color.copy(lighting.lightColor);
    this.sun.intensity = levels.sun * lighting.lightShare;
    this.ambient.color.copy(lighting.fillSky);
    this.ambient.groundColor.copy(lighting.fillGround);
    this.ambient.intensity = levels.fill * lighting.fillShare;
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(this.atmosphere.fogColor);
      fog.near = this.fogBase.near * lighting.fogNear;
      fog.far = this.fogBase.far * lighting.fogFar;
    }
    (this.scene.background as THREE.Color | null)?.copy(this.atmosphere.fogColor);
    const headlightActive = this.settings.quality !== 'low' && lighting.darkness > 0.01;
    this.headlight.visible = headlightActive;
    this.headlight.intensity = headlightActive ? HEADLIGHT_INTENSITY * lighting.darkness : 0;
    this.headlight.position.set(0, this.vehicle.height * 0.42, this.vehicle.length * 0.47);
    this.headlight.target.position.set(0, 0, this.vehicle.length * 0.47 + 28);
    this.brakeSpillScale = 0.14 + 0.86 * lighting.darkness;
    const state = this.environment.state;
    this.environment.rain.update(this.camera, this.environmentTime, state.rain, 1 - lighting.darkness * 0.75);
    this.environment.bolt.update(this.camera, lighting.flash);
    if (lighting.struck) {
      const stormShare = THREE.MathUtils.smoothstep(state.rain, 0.55, 1.0);
      this.vehicleAudio.playThunder(0.45 + 0.55 * stormShare);
    }
    const dropsOn = this.drivingEnabled && this.settings.effects && state.lensDrops;
    if (dropsOn || this.lensDrops.active) {
      this.lensDrops.update(dt, dropsOn ? state.rain : 0, this.velocity.length(), 1 - lighting.darkness * 0.7, this.dropFocus);
    }
    if (Math.abs(lighting.wetness - this.wetnessApplied) > 0.02) {
      applyWetness(this.worldData.root, lighting.wetness);
      this.wetnessApplied = lighting.wetness;
    }
    // Re-bake the sky's reflections only on explicit weather/time edits or large sky shifts.
    const hourChange = Math.abs(THREE.MathUtils.euclideanModulo(state.timeOfDay - this.bakedHour + 12, 24) - 12);
    const autoBakeAllowed = this.settings.quality === 'high' || this.settings.quality === 'ultra';
    if (this.bakeForced || (autoBakeAllowed
      && this.environmentTime - this.bakedAt > ENVIRONMENT_BAKE_INTERVAL
      && (hourChange > 0.65 || Math.abs(state.rain - this.bakedRain) > 0.12))) {
      this.bakeForced = false;
      this.scene.environment = this.atmosphere.bake(this.renderer);
      this.environmentBakes += 1;
      this.bakedHour = state.timeOfDay;
      this.bakedRain = state.rain;
      this.bakedAt = this.environmentTime;
      this.sceneNeedsRender = true;
    }
  }

  getEnvironment(): EnvironmentState {
    return { ...this.environment.state };
  }

  /** Debug: a lightning strike right now. */
  strikeLightning(): void {
    this.environment.strike();
    this.sceneNeedsRender = true;
  }

  setEnvironment(changes: Partial<EnvironmentState>): void {
    this.environment.set(changes);
    this.bakeForced = true;
    this.sceneNeedsRender = true;
  }

  /** Numbers for the debug panel. */
  debugInfo(): {
    fps: number; drawCalls: number; triangles: number; geometries: number; textures: number;
    position: THREE.Vector3; speedKmh: number; mapId: MapId; vehicle: string; wetness: number;
    sun: number; fill: number; environment: number; headlight: number; bakes: number;
  } {
    const info = this.renderer.info;
    return {
      fps: this.fps,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      position: this.carRoot.position.clone(),
      speedKmh: this.velocity.length() * ECONOMY.kmhPerUnit,
      mapId: this.mapId,
      vehicle: this.vehicle.name,
      wetness: this.environment.currentWetness,
      sun: this.sun.intensity,
      fill: this.ambient.intensity,
      environment: this.scene.environmentIntensity,
      headlight: this.headlight.intensity,
      bakes: this.environmentBakes,
    };
  }

  private applyMapPalette(): void {
    // The sky dome covers the background; the fog takes its horizon colour.
    const color = this.atmosphere.fogColor;
    this.scene.background = color.clone();
    const fog = this.settings.quality === 'low'
      ? new THREE.Fog(color, 80, 460)
      : new THREE.Fog(color, 108, this.settings.quality === 'ultra' ? 1050 : this.settings.quality === 'high' ? 820 : 620);
    this.scene.fog = fog;
    this.fogBase = { near: fog.near, far: fog.far };
    // Past fog.far everything is exactly the background colour, so do not draw it.
    this.camera.far = fog.far + 20;
    this.camera.updateProjectionMatrix();
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.motionBlur.setSize();
    this.lampBloom.setSize();
  }

  private frame = (time: number): void => {
    const rawDt = this.clock.getDelta();
    if (this.active) {
      this.renderElapsed += rawDt;
      const limit = this.settings.fpsLimit === 0 ? 0 : 1 / this.settings.fpsLimit;
      // VSync jitter tolerance (1.6 ms) prevents 60 Hz / 120 Hz ProMotion displays from
      // dropping every 2nd or 3rd refresh when fpsLimit === 60, and steps simulation in
      // 1:1 lockstep with rendered frames so physics never advances on skipped frames.
      if (!this.sceneNeedsRender && limit > 0 && this.renderElapsed + 0.0016 < limit) {
        this.animationFrame = requestAnimationFrame(this.frame);
        return;
      }
      const frameDt = this.renderElapsed;
      this.renderElapsed = limit > 0 ? Math.max(0, Math.min(this.renderElapsed - limit, limit * 0.5)) : 0;
      const dt = Math.min(frameDt, 0.05);
      if (frameDt > 0) this.fps += (1 / frameDt - this.fps) * 0.08;

      if (!this.drivingEnabled && !this.sceneNeedsRender && this.remoteVehicles.size === 0) {
        const idleRain = this.environment.state.rain;
        if (idleRain > 0.005 || this.environment.state.lightning) {
          const lighting = this.environment.update(dt);
          if (lighting.struck) {
            const stormShare = THREE.MathUtils.smoothstep(idleRain, 0.55, 1.0);
            this.vehicleAudio.playThunder(0.45 + 0.55 * stormShare, true);
          }
        }
        this.vehicleAudio.update({
          dt,
          speedKmh: 0,
          rpm: 850,
          gear: this.gear,
          throttle: 0,
          drift: 0,
          rain: idleRain,
          active: false,
        });
        this.animationFrame = requestAnimationFrame(this.frame);
        return;
      }

      this.renderer.info.reset();
      this.updateEnvironment(dt);
      if (this.drivingEnabled) this.updateDriving(dt);
      else this.updateTireSmoke(dt, 0);
      this.updateRemoteVehicles(dt);
      if (this.drivingEnabled) {
        this.updateCamera(dt);
        this.updateShadowFrustum();
      }
      const telemetry = this.makeTelemetry();
      this.vehicleAudio.update({
        dt,
        speedKmh: telemetry.speedKmh,
        rpm: telemetry.rpm,
        gear: this.gear,
        throttle: !this.freeCameraActive && this.isDown('w') ? 1 : 0,
        drift: this.driftValue,
        rain: this.environment.state.rain,
        active: this.drivingEnabled,
      });
      if (this.drivingEnabled && this.multiplayer?.isInRoom) {
        this.multiplayerSendElapsed += dt;
        if (this.multiplayerSendElapsed >= 1 / 15) {
          this.multiplayerSendElapsed %= 1 / 15;
          const state: LocalPlayerState = {
            vehicleId: this.vehicle.id,
            x: this.carRoot.position.x,
            z: this.carRoot.position.z,
            yaw: this.yaw,
            steeringAngle: this.frontWheelAngle,
            speedKmh: telemetry.speedKmh,
            drifting: telemetry.drifting,
            burnout: this.sim.burnout || Math.max(this.sim.output.rearSpin, this.sim.output.frontSpin) > 0.35,
            // The server drops values past ±36.
            mapId: this.mapId,
            rearWheelSpinRate: THREE.MathUtils.clamp(this.sim.output.rearWheelSpeed - this.sim.forwardSpeed, -36, 36),
          };
          this.multiplayer.sendState(state);
        }
      }
      const income = this.incomeClock.update(dt, this.forwardSpeedKmh(), this.vehicle, this.drivingEnabled);
      if (income.paid > 0) this.callbacks.onIncome(income.paid);
      this.telemetryElapsed += dt;
      const telemetryInterval = this.driftScore > 0 ? 0.045 : 0.08;
      if (this.drivingEnabled && this.telemetryElapsed >= telemetryInterval) {
        this.telemetryElapsed = 0;
        this.callbacks.onTelemetry(telemetry);
      }
      if (this.sceneNeedsRender || this.drivingEnabled) {
        this.renderScene();
        this.sceneNeedsRender = false;
      }
    }
    this.animationFrame = requestAnimationFrame(this.frame);
    void time;
  };

  private updateDriving(dt: number): void {
    this.previousCarPosition.copy(this.carRoot.position);
    this.drivingElapsed += dt;
    const drivingControls = this.freeCameraActive
      ? { throttle: 0, brake: 0, steer: 0, handbrake: false }
      : {
          throttle: this.isDown('w') ? 1 : 0,
          brake: this.isDown('s') ? 1 : 0,
          steer: (this.isDown('a') ? 1 : 0) - (this.isDown('d') ? 1 : 0),
          handbrake: this.isDown(' '),
        };
    const out = this.sim.step(dt, drivingControls, !this.airborne, this.wheelSuspensionLoads);
    const burnout = this.sim.burnout;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const longitudinal = this.velocity.dot(this.forward);
    const lateral = this.velocity.dot(this.right);
    const speed = this.velocity.length();
    // Sliding: the rear tyres are past their grip (or locked by the handbrake).
    const slipAngle = Math.atan2(Math.abs(lateral), Math.max(Math.abs(longitudinal), 1));
    const driftSeverity = out.rearSlide;
    const drifting = speed > 6 && Math.abs(lateral) > 1 && driftSeverity > 0.05;
    this.driftValue = drifting ? Math.min(1, this.driftValue + dt * (1.5 + driftSeverity * 2)) : Math.max(0, this.driftValue - dt * 3.4);
    this.updateDriftScore(dt, longitudinal, lateral, speed, slipAngle, driftSeverity);

    // Physics speeds are real metres per second; the world is built WORLD_SCALE times larger.
    this.carRoot.position.addScaledVector(this.velocity, dt * WORLD_SCALE);
    this.handleCollisions();
    this.checkSpeedGates();
    this.updateSuspension(dt);
    this.carRoot.rotation.set(-this.bodyPitch, this.yaw, this.bodyRoll);
    this.carRoot.position.y = this.bodyHeight + 0.015;
    // Skid marks are laid flat on the map, so only draw them there.
    this.updateSkids((drifting || out.rearSpin > 0.3) && !this.airborne, slipAngle, speed);
    this.wheelTravel += out.frontWheelSpeed * dt * WORLD_SCALE;
    this.rearWheelTravel += out.rearWheelSpeed * dt * WORLD_SCALE;
    const slideSmoke = drifting ? driftSeverity : 0;
    // Burnout smoke comes off the driven (spinning) axle: the front on FWD cars.
    const frontDriven = driveLayoutOf(this.vehicle) === 'FWD';
    this.updateTireSmoke(
      dt,
      this.airborne ? 0 : burnout && !frontDriven ? 1 : Math.max(slideSmoke, out.rearSpin),
      this.airborne ? 0 : burnout && frontDriven ? 1 : Math.max(out.frontSpin, speed > 6 ? out.frontSlide * 0.6 : 0),
    );
    // The wheels show the real steering angle, counter-steer included.
    setVehicleWheelSpin(this.visual, this.wheelTravel, this.frontWheelAngle, this.rearWheelTravel, this.stance);
    setVehicleSuspension(this.visual, this.suspensionTravel, this.stance);
    setVehicleLights(this.visual, !this.freeCameraActive && this.isDown('s'), this.gear === -1, dt);
    const spill = this.settings.quality !== 'low' && this.settings.effects
      ? BRAKE_SPILL_OPACITY * this.brakeSpillScale * this.visual.lights.brakeLevel
      : 0;
    const spillVisible = spill > 0.006;
    this.brakeSpillMesh.visible = spillVisible;
    if (spillVisible) {
      this.brakeSpillMaterial.opacity = spill;
      // Keep the road glow flush on the ground beneath body pitch/heave.
      this.brakeSpillMesh.position.y = Math.max(0.02, this.wheelGround[2] - this.bodyHeight + 0.025);
    }
  }

  /** Sizes and places the additive red road-glow quad right behind the rear bumper. */
  private placeBrakeSpill(): void {
    const w = this.vehicle.width * 1.48;
    const d = Math.max(1.9, this.vehicle.length * 0.44);
    this.brakeSpillMesh.scale.set(w, d, 1);
    this.brakeSpillMesh.position.set(0, 0.025, -this.vehicle.length * 0.5 - d * 0.28);
  }

  /**
   * Four independent spring-dampers carry the body. Each wheel reads the ground
   * under it, so ramps lift the front axle first, launches happen when the
   * wheels lose contact, and landings compress the springs. Measured body
   * acceleration adds the usual weight transfer: squat, dive and roll.
   */
  private updateSuspension(dt: number): void {
    const position = this.carRoot.position;
    const wheels = this.visual.suspension;
    if (wheels.length !== 4 || dt <= 0) return;

    const centerGround = groundHeightAt(this.worldData, position.x, position.z, this.groundSlope);
    if (!this.airborne) {
      // A climb up the slope rises at most slope × distance travelled this frame.
      const travel = Math.hypot(position.x - this.previousCarPosition.x, position.z - this.previousCarPosition.z);
      if (centerGround - this.bodyHeight > MAX_STEP_UP + this.groundSlope.length() * travel) {
        // Drove into the tall end of a ramp: stop like at a wall.
        position.x = this.previousCarPosition.x;
        position.z = this.previousCarPosition.z;
        this.velocity.multiplyScalar(-0.2);
        return;
      }
      // Gravity along the slope: slower uphill, faster rolling down.
      this.velocity.x -= this.groundSlope.x * GRAVITY * dt;
      this.velocity.z -= this.groundSlope.y * GRAVITY * dt;
    }

    // Body-frame acceleration for weight transfer, clamped so wall bounces do not kick the body.
    const limit = SUSPENSION.maxInertialAccel;
    const accelLong = THREE.MathUtils.clamp((this.velocity.dot(this.forward) - this.previousVelocity.dot(this.forward)) / dt, -limit, limit);
    const accelLat = THREE.MathUtils.clamp((this.velocity.dot(this.right) - this.previousVelocity.dot(this.right)) / dt, -limit, limit);
    this.previousVelocity.copy(this.velocity);
    this.bodyAccelLong = accelLong;
    this.bodyAccelLat = accelLat;

    // Cache per-vehicle suspension geometry & constants so we don't recompute them every frame/substep.
    if (this.suspCachedWheels !== wheels) {
      this.suspCachedWheels = wheels;
      let frontZ = 0;
      let rearZ = 0;
      for (let i = 0; i < 4; i += 1) {
        const w = wheels[i];
        if (w.z > 0) frontZ += w.z * 0.5;
        else rearZ += w.z * 0.5;
      }
      const wheelbase = Math.max(frontZ - rearZ, 0.5);
      const omega = 2 * Math.PI * SUSPENSION.frequencyHz;
      this.suspSpringRate = 0.25 * omega * omega;
      this.suspDamperRate = 2 * SUSPENSION.dampingRatio * 0.25 * omega;
      this.suspPitchInertia = (SUSPENSION.pitchGyration * this.vehicle.length) ** 2;
      this.suspRollInertia = (SUSPENSION.rollGyration * this.vehicle.width) ** 2;
      let springRollStiffness = 0;
      for (let i = 0; i < 4; i += 1) {
        const w = wheels[i];
        springRollStiffness += this.suspSpringRate * w.x * w.x;
        this.wheelStaticLoad[i] = GRAVITY * 0.5 * (w.z > 0 ? -rearZ : frontZ) / wheelbase;
        // Map suspension wheel index to Chassis [FL=0, FR=1, RL=2, RR=3].
        this.wheelToChassisIdx[i] = (w.z > 0 ? 0 : 2) + (w.x > 0 ? 0 : 1);
      }
      this.suspAntiRollStiffness = springRollStiffness * SUSPENSION.antiRollShare;
    }

    const springRate = this.suspSpringRate * this.stance.springStiffnessMult;
    const damperRate = this.suspDamperRate * this.stance.damperStiffnessMult;
    const pitchInertia = this.suspPitchInertia;
    const rollInertia = this.suspRollInertia;
    const antiRollStiffness = this.suspAntiRollStiffness * this.stance.antiRollBarMult;
    const groundRate = this.groundRate;
    const forwardSpeed = Math.max(0, this.velocity.dot(this.forward));
    const downforceG = aeroDownforceG(this.aeroProfile, forwardSpeed);
    const frontAeroWheelLoad = GRAVITY * downforceG * 0.5 * this.aeroProfile.frontAeroShare;
    const rearAeroWheelLoad = GRAVITY * downforceG * 0.5 * (1 - this.aeroProfile.frontAeroShare);
    const aeroPullDown = GRAVITY * downforceG * 1.65;

    for (let i = 0; i < 4; i += 1) {
      const wheel = wheels[i];
      const ground = groundHeightAt(
        this.worldData,
        position.x + this.forward.x * wheel.z + this.right.x * wheel.x,
        position.z + this.forward.z * wheel.z + this.right.z * wheel.x,
      );
      const groundDelta = ground - this.wheelGround[i];
      // Ignore vertical cliff drops off a ramp edge, but track smooth downhill & uphill road slopes
      // with capped upward kick so crest triangle transitions do not launch high-downforce cars.
      groundRate[i] = groundDelta < -0.28 ? 0 : THREE.MathUtils.clamp(groundDelta / dt, -14, 4.8);
      this.wheelGround[i] = ground;
    }

    const steps = Math.max(1, Math.ceil(dt / SUSPENSION.substep));
    const h = dt / steps;
    let contacts = 0;
    for (let step = 0; step < steps; step += 1) {
      let force = 0;
      let pitchTorque = 0;
      let rollTorque = 0;
      let worstPenetration = 0;
      contacts = 0;
      const isLastStep = step === steps - 1;
      for (let i = 0; i < 4; i += 1) {
        const wheel = wheels[i];
        const staticLoad = this.wheelStaticLoad[i];
        const aeroWheelLoad = wheel.z > 0 ? frontAeroWheelLoad : rearAeroWheelLoad;
        const corner = this.bodyHeight + wheel.z * this.bodyPitch + wheel.x * this.bodyRoll;
        const compression = this.wheelGround[i] - corner;
        const compressionRate = groundRate[i] - (this.heaveVelocity + wheel.z * this.pitchRate + wheel.x * this.rollRate);
        let load = staticLoad + springRate * compression + damperRate * compressionRate;
        if (compression > SUSPENSION.bumpTravel) {
          load += springRate * SUSPENSION.bumpStopStiffness * (compression - SUSPENSION.bumpTravel)
            + damperRate * SUSPENSION.bumpStopDamping * compressionRate;
        }
        // Springs only push; a wheel hanging below its full droop has left the ground.
        // Aerodynamic downforce extends effective ground contact across crests.
        const maxDroop = (staticLoad + aeroWheelLoad * 0.85) / springRate;
        if (compression <= -maxDroop || load + aeroWheelLoad <= 0) {
          load = 0;
        } else {
          contacts += 1;
        }
        if (isLastStep) {
          this.wheelSuspensionLoads[this.wheelToChassisIdx[i]] = contacts > 0 && load > 0 ? load + aeroWheelLoad : 0;
        }
        worstPenetration = Math.max(worstPenetration, compression - SUSPENSION.hardLimit);
        force += load;
        pitchTorque += load * wheel.z;
        rollTorque += load * wheel.x;
      }
      // Weight transfer acts through the tyres, so only while touching the ground.
      if (contacts > 0) {
        pitchTorque += accelLong * SUSPENSION.centerOfMassHeight;
        rollTorque += accelLat * SUSPENSION.centerOfMassHeight - antiRollStiffness * this.bodyRoll;
        // Aerodynamic downforce strongly resists upward body lift over crests.
        if (this.heaveVelocity > 0) {
          this.heaveVelocity = Math.max(0, this.heaveVelocity - aeroPullDown * h);
          this.heaveVelocity *= Math.exp(-3.2 * downforceG * h);
        }
      } else {
        const spinLoss = Math.exp(-SUSPENSION.airAngularDamping * h);
        this.pitchRate *= spinLoss;
        this.rollRate *= spinLoss;
      }
      // When airborne or unloading over a crest, aerodynamic downforce pulls the car back to the road.
      const downwardGravity = contacts < 4 ? GRAVITY + aeroPullDown : GRAVITY;
      this.heaveVelocity += (force - downwardGravity) * h;
      this.pitchRate += pitchTorque / pitchInertia * h;
      this.rollRate += rollTorque / rollInertia * h;
      this.bodyHeight += this.heaveVelocity * h;
      this.bodyPitch += this.pitchRate * h;
      this.bodyRoll += this.rollRate * h;
      if (worstPenetration > 0) {
        // Never let the body sink through the ground on a hard landing.
        this.bodyHeight += worstPenetration;
        this.heaveVelocity = Math.max(0, this.heaveVelocity);
      }
    }
    this.airborne = contacts === 0;

    for (let i = 0; i < 4; i += 1) {
      const wheel = wheels[i];
      const staticLoad = this.wheelStaticLoad[i];
      const corner = this.bodyHeight + wheel.z * this.bodyPitch + wheel.x * this.bodyRoll;
      this.suspensionTravel[i] = THREE.MathUtils.clamp(this.wheelGround[i] - corner, -staticLoad / springRate, SUSPENSION.hardLimit);
    }
  }

  private checkSpeedGates(): void {
    const current = this.carRoot.position;
    for (const gate of this.worldData.speedGates) {
      const beforeX = this.previousCarPosition.x - gate.center.x;
      const beforeZ = this.previousCarPosition.z - gate.center.z;
      const afterX = current.x - gate.center.x;
      const afterZ = current.z - gate.center.z;
      const beforeDistance = beforeX * gate.direction.x + beforeZ * gate.direction.z;
      const afterDistance = afterX * gate.direction.x + afterZ * gate.direction.z;
      const travelDistance = afterDistance - beforeDistance;
      const crossedForward = beforeDistance <= 0 && afterDistance > 0;
      const crossedBackward = beforeDistance >= 0 && afterDistance < 0;
      if ((!crossedForward && !crossedBackward) || Math.abs(travelDistance) < 1e-6) continue;

      // Check where the car crossed the gate plane, not where it ended this frame.
      // This keeps fast passes and slightly angled approaches from being missed.
      const crossingT = THREE.MathUtils.clamp(-beforeDistance / travelDistance, 0, 1);
      const crossingX = beforeX + (afterX - beforeX) * crossingT;
      const crossingZ = beforeZ + (afterZ - beforeZ) * crossingT;

      const lateralX = gate.direction.z;
      const lateralZ = -gate.direction.x;
      const lateralDistance = crossingX * lateralX + crossingZ * lateralZ;
      if (Math.abs(lateralDistance) + this.vehicle.width * 0.5 > gate.halfWidth) continue;
      if (this.drivingElapsed < (this.speedGateCooldowns.get(gate.id) ?? 0)) continue;
      this.speedGateCooldowns.set(gate.id, this.drivingElapsed + 8);

      const gateSpeedKmh = Math.abs(this.velocity.dot(gate.direction)) * ECONOMY.kmhPerUnit;
      if (gateSpeedKmh >= 200) this.callbacks.onMissionComplete(5000);
      else this.callbacks.onMissionFailed();
    }
  }

  private updateSkids(drifting: boolean, slipAngle: number, speed: number): void {
    if (!this.settings.effects || !drifting || speed < 6) {
      this.skidDistance = 0;
      this.hasPreviousSkidPositions = false;
      return;
    }
    this.updateSkidWheelPositions();
    if (!this.hasPreviousSkidPositions) {
      this.skidPreviousPositions[0].copy(this.skidCurrentPositions[0]);
      this.skidPreviousPositions[1].copy(this.skidCurrentPositions[1]);
      this.hasPreviousSkidPositions = true;
      return;
    }

    this.skidPreviousCenter.copy(this.skidPreviousPositions[0]).add(this.skidPreviousPositions[1]).multiplyScalar(0.5);
    this.skidCurrentCenter.copy(this.skidCurrentPositions[0]).add(this.skidCurrentPositions[1]).multiplyScalar(0.5);
    this.skidFrameTravel.copy(this.skidCurrentCenter).sub(this.skidPreviousCenter);
    const frameDistance = this.skidFrameTravel.length();
    const severity = THREE.MathUtils.clamp((slipAngle - 0.12) / 0.42, 0, 1);
    const spacing = THREE.MathUtils.lerp(1.05, 0.62, severity);
    this.skidDistance += frameDistance;
    let addedMarks = false;
    while (this.skidDistance >= spacing) {
      const overshoot = this.skidDistance - spacing;
      const t = frameDistance > 1e-5 ? THREE.MathUtils.clamp(1 - overshoot / frameDistance, 0, 1) : 1;
      const markYaw = frameDistance > 1e-5 ? Math.atan2(this.skidFrameTravel.x, this.skidFrameTravel.z) : this.yaw;
      const scaleX = 0.78 + severity * 0.55;
      const scaleZ = THREE.MathUtils.clamp(spacing * 1.12 / 1.25, 0.5, 1.05);
      for (let wheel = 0; wheel < 2; wheel += 1) {
        this.skidInterpolatedPosition.copy(this.skidPreviousPositions[wheel]).lerp(this.skidCurrentPositions[wheel], t);
        const markX = this.skidInterpolatedPosition.x;
        const markZ = this.skidInterpolatedPosition.z;
        // Lie on the ground, tilted with its slope along the mark.
        const markGround = groundHeightAt(this.worldData, markX, markZ, this.skidSlope);
        const grade = this.skidSlope.x * Math.sin(markYaw) + this.skidSlope.y * Math.cos(markYaw);
        this.skidDummy.position.set(markX, markGround + 0.024, markZ);
        this.skidDummy.rotation.set(-Math.atan(grade), markYaw, 0, 'YXZ');
        this.skidDummy.scale.set(scaleX, 1, scaleZ);
        this.skidDummy.updateMatrix();
        this.skidMarks.setMatrixAt(this.skidIndex, this.skidDummy.matrix);
        this.skidIndex = (this.skidIndex + 1) % DriveEngine.skidCapacity;
        this.skidCount = Math.min(DriveEngine.skidCapacity, this.skidCount + 1);
      }
      this.skidDistance = overshoot;
      addedMarks = true;
    }
    this.skidPreviousPositions[0].copy(this.skidCurrentPositions[0]);
    this.skidPreviousPositions[1].copy(this.skidCurrentPositions[1]);
    if (addedMarks) {
      this.skidMarks.count = this.skidCount;
      this.skidMarks.instanceMatrix.needsUpdate = true;
    }
  }

  private createRemoteVehicle(player: MultiplayerPlayer): RemoteVehicle {
    const spec = VEHICLES.find((vehicle) => vehicle.id === player.vehicleId) ?? VEHICLES[0];
    const root = new THREE.Group();
    const visual = createVehicleVisual(spec);
    root.add(visual.root);
    root.position.set(player.x, groundHeightAt(this.worldData, player.x, player.z) + 0.015, player.z);
    root.rotation.order = 'YXZ';
    root.rotation.y = player.yaw;
    this.scene.add(root);
    void installGeneratedModel(visual, spec);
    const remote = {
      target: player,
      root,
      visual,
      spec,
      wheelTravel: 0,
      rearWheelTravel: 0,
      steeringAngle: Number.isFinite(player.steeringAngle) ? player.steeringAngle : 0,
      smokeEmitElapsed: 0,
      smokeBuild: 0,
      smokeEmitter: (this.nextSmokeEmitter += 2) - 2,
      previousX: player.x,
      previousZ: player.z,
    };
    this.remoteVehicles.set(player.id, remote);
    return remote;
  }

  private updateRemoteVehicles(dt: number): void {
    const blend = 1 - Math.exp(-12 * dt);
    for (const remote of this.remoteVehicles.values()) {
      const target = remote.target;
      remote.root.position.x += (target.x - remote.root.position.x) * blend;
      remote.root.position.z += (target.z - remote.root.position.z) * blend;
      // Sit on the ground and lean with it (positions carry no height or tilt).
      const remoteYaw = remote.root.rotation.y;
      const halfLength = remote.spec.length * 0.3;
      const halfWidth = remote.spec.width * 0.4;
      const { x: rx, z: rz } = remote.root.position;
      const sinYaw = Math.sin(remoteYaw);
      const cosYaw = Math.cos(remoteYaw);
      const front = groundHeightAt(this.worldData, rx + sinYaw * halfLength, rz + cosYaw * halfLength);
      const rear = groundHeightAt(this.worldData, rx - sinYaw * halfLength, rz - cosYaw * halfLength);
      const right = groundHeightAt(this.worldData, rx + cosYaw * halfWidth, rz - sinYaw * halfWidth);
      const left = groundHeightAt(this.worldData, rx - cosYaw * halfWidth, rz + sinYaw * halfWidth);
      remote.root.position.y += ((front + rear + right + left) / 4 + 0.015 - remote.root.position.y) * blend;
      remote.root.rotation.x += (-Math.atan2(front - rear, halfLength * 2) - remote.root.rotation.x) * blend;
      remote.root.rotation.z += (Math.atan2(right - left, halfWidth * 2) - remote.root.rotation.z) * blend;
      const yawDelta = THREE.MathUtils.euclideanModulo(target.yaw - remote.root.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
      remote.root.rotation.y += yawDelta * blend;
      const targetSteeringAngle = Number.isFinite(target.steeringAngle) ? target.steeringAngle : 0;
      remote.steeringAngle += (targetSteeringAngle - remote.steeringAngle) * blend;
      const dx = remote.root.position.x - remote.previousX;
      const dz = remote.root.position.z - remote.previousZ;
      const projectedTravel = dx * Math.sin(remote.root.rotation.y) + dz * Math.cos(remote.root.rotation.y);
      remote.wheelTravel += projectedTravel;
      const rearSpinRate = Number.isFinite(target.rearWheelSpinRate) ? target.rearWheelSpinRate : 0;
      remote.rearWheelTravel += projectedTravel + rearSpinRate * dt * WORLD_SCALE;
      remote.previousX = remote.root.position.x;
      remote.previousZ = remote.root.position.z;
      setVehicleWheelSpin(remote.visual, remote.wheelTravel, remote.steeringAngle, remote.rearWheelTravel);
      remote.smokeBuild = advanceSmokeBuild(remote.smokeBuild, target.burnout && this.settings.effects, dt);
      if (target.burnout && this.settings.effects) {
        remote.smokeEmitElapsed += dt;
        const vx = dt > 0 ? dx / dt : 0;
        const vz = dt > 0 ? dz / dt : 0;
        while (remote.smokeEmitElapsed >= SMOKE_EMIT_INTERVAL) {
          remote.smokeEmitElapsed -= SMOKE_EMIT_INTERVAL;
          this.emitRemoteTireSmoke(remote, vx, vz);
        }
      } else {
        remote.smokeEmitElapsed = 0;
      }
    }
  }

  // rearIntensity/frontIntensity 0..1: how hard each axle's tyres slide or spin.
  private updateTireSmoke(dt: number, rearIntensity: number, frontIntensity = 0): void {
    const sliding = this.settings.effects && Math.max(rearIntensity, frontIntensity) > 0.08;
    this.smokeBuild = advanceSmokeBuild(this.smokeBuild, sliding, dt);
    if (sliding) {
      this.smokeEmitElapsed += dt;
      const density = smokeDensity(this.smokeBuild);
      const rear = rearIntensity > 0.08 ? Math.max(0.4, rearIntensity) * density : 0;
      const front = frontIntensity > 0.08 ? Math.max(0.4, frontIntensity) * density : 0;
      if (rear > 0) this.updateSkidWheelPositions();
      while (this.smokeEmitElapsed >= SMOKE_EMIT_INTERVAL) {
        this.smokeEmitElapsed -= SMOKE_EMIT_INTERVAL;
        for (const wheel of [0, 1] as const) {
          const side = wheel === 0 ? -1 : 1;
          if (rear > 0) {
            const position = this.skidCurrentPositions[wheel];
            this.emitWheelSmoke(wheel, position.x, position.z, this.yaw, side, this.velocity.x * WORLD_SCALE, this.velocity.z * WORLD_SCALE, rear);
          }
          if (front > 0) {
            const ahead = this.vehicle.length * 0.31;
            const across = this.vehicle.width * 0.51 * side;
            const x = this.carRoot.position.x + Math.sin(this.yaw) * ahead + Math.cos(this.yaw) * across;
            const z = this.carRoot.position.z + Math.cos(this.yaw) * ahead - Math.sin(this.yaw) * across;
            this.emitWheelSmoke(2 + wheel, x, z, this.yaw, side, this.velocity.x * WORLD_SCALE, this.velocity.z * WORLD_SCALE, front);
          }
        }
      }
    } else {
      this.smokeEmitElapsed = 0;
    }
    this.tireSmoke.update(dt);
  }

  // One puff at a rear wheel contact patch, thrown back and out from the tyre.
  private emitWheelSmoke(emitter: number, x: number, z: number, yaw: number, side: -1 | 1, carVx: number, carVz: number, intensity: number): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const back = 0.4 + Math.random() * 0.9;
    const out = side * (0.25 + Math.random() * 0.45);
    const px = x + (Math.random() - 0.5) * 0.3;
    const pz = z + (Math.random() - 0.5) * 0.3;
    const ground = groundHeightAt(this.worldData, px, pz);
    this.tireSmoke.emit(
      emitter,
      px, ground + 0.22, pz, ground,
      carVx * 0.25 - forwardX * back + rightX * out,
      0.25 + Math.random() * 0.35,
      carVz * 0.25 - forwardZ * back + rightZ * out,
      intensity,
    );
  }

  private emitRemoteTireSmoke(remote: RemoteVehicle, vx: number, vz: number): void {
    const yaw = remote.root.rotation.y;
    // From the driven axle: the front wheels on FWD cars.
    const along = remote.spec.length * 0.31 * (driveLayoutOf(remote.spec) === 'FWD' ? 1 : -1);
    const halfTrack = remote.spec.width * 0.51;
    for (const side of [-1, 1] as const) {
      const x = remote.root.position.x + Math.sin(yaw) * along + Math.cos(yaw) * side * halfTrack;
      const z = remote.root.position.z + Math.cos(yaw) * along - Math.sin(yaw) * side * halfTrack;
      this.emitWheelSmoke(remote.smokeEmitter + (side < 0 ? 0 : 1), x, z, yaw, side, vx, vz, smokeDensity(remote.smokeBuild));
    }
  }

  private updateSkidWheelPositions(): void {
    if (!this.skidModelPositionsReady && this.visual.modelInstance && this.visual.modelWheels.length === 4) {
      this.carRoot.updateMatrixWorld(true);
      let rearIndex = 0;
      for (const wheel of this.visual.modelWheels) {
        if (wheel.isFront || rearIndex >= 2) continue;
        wheel.node.getWorldPosition(this.skidCurrentPositions[rearIndex]);
        this.carRoot.worldToLocal(this.skidCurrentPositions[rearIndex]);
        this.skidModelLocalPositions[rearIndex].copy(this.skidCurrentPositions[rearIndex]);
        rearIndex += 1;
      }
      if (rearIndex === 2) {
        this.skidModelPositionsReady = true;
        this.hasPreviousSkidPositions = false;
        this.skidDistance = 0;
      }
    }

    if (this.skidModelPositionsReady) {
      for (let wheel = 0; wheel < 2; wheel += 1) {
        this.skidCurrentPositions[wheel].copy(this.skidModelLocalPositions[wheel])
          .applyQuaternion(this.carRoot.quaternion)
          .add(this.carRoot.position);
        this.skidCurrentPositions[wheel].y = 0.024;
      }
      return;
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const rear = -this.vehicle.length * 0.31;
    const halfTrack = this.vehicle.width * 0.51;
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const side = wheel === 0 ? -1 : 1;
      this.skidCurrentPositions[wheel].set(
        this.carRoot.position.x + this.forward.x * rear + this.right.x * side * halfTrack,
        0.024,
        this.carRoot.position.z + this.forward.z * rear + this.right.z * side * halfTrack,
      );
    }
  }

  private clearSkids(): void {
    this.skidIndex = 0;
    this.skidCount = 0;
    this.skidDistance = 0;
    this.hasPreviousSkidPositions = false;
    this.skidMarks.count = 0;
  }

  // Barriers of model-based maps: the frame's move is checked in short steps
  // (walls are thin, a fast car would jump through), then the car slides
  // along the wall axis by axis, losing speed.
  private handleWallCollision(): void {
    const walls = this.worldData.walls;
    if (!walls) return;
    const position = this.carRoot.position;
    const previous = this.previousCarPosition;
    // Turned into a wall while standing: let it rotate back out instead of pinning it.
    if (this.footprintBlocked(walls, previous.x, previous.z)) return;
    const targetX = position.x;
    const targetZ = position.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(targetX - previous.x, targetZ - previous.z) / WALL_CHECK_STEP));
    let freeX = previous.x;
    let freeZ = previous.z;
    let hit = false;
    for (let i = 1; i <= steps; i += 1) {
      const x = previous.x + (targetX - previous.x) * i / steps;
      const z = previous.z + (targetZ - previous.z) * i / steps;
      if (this.footprintBlocked(walls, x, z)) {
        hit = true;
        break;
      }
      freeX = x;
      freeZ = z;
    }
    if (!hit) return;
    if (!this.footprintBlocked(walls, targetX, freeZ)) {
      position.x = targetX;
      position.z = freeZ;
      this.velocity.z *= -0.2;
    } else if (!this.footprintBlocked(walls, freeX, targetZ)) {
      position.x = freeX;
      position.z = targetZ;
      this.velocity.x *= -0.2;
    } else {
      position.x = freeX;
      position.z = freeZ;
      this.velocity.multiplyScalar(-0.2);
    }
    this.velocity.multiplyScalar(0.85);
  }

  private footprintBlocked(walls: WallGrid, x: number, z: number): boolean {
    const halfLength = this.vehicle.length * 0.45;
    const halfWidth = this.vehicle.width * 0.42;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const rx = cos * halfWidth;
    const rz = -sin * halfWidth;
    const fx = sin * halfLength;
    const fz = cos * halfLength;
    return (
      walls.blocked(x - fx - rx, z - fz - rz) ||
      walls.blocked(x - fx + rx, z - fz + rz) ||
      walls.blocked(x - rx, z - rz) ||
      walls.blocked(x + rx, z + rz) ||
      walls.blocked(x + fx - rx, z + fz - rz) ||
      walls.blocked(x + fx + rx, z + fz + rz)
    );
  }

  private handleCollisions(): void {
    for (const collider of this.worldData.colliders) {
      const dx = this.carRoot.position.x - collider.x;
      const dz = this.carRoot.position.z - collider.z;
      const limitX = collider.halfX + this.vehicle.width * 0.39;
      const limitZ = collider.halfZ + this.vehicle.length * 0.34;
      if (Math.abs(dx) < limitX && Math.abs(dz) < limitZ) {
        const pushX = limitX - Math.abs(dx);
        const pushZ = limitZ - Math.abs(dz);
        if (pushX < pushZ) {
          this.carRoot.position.x = collider.x + Math.sign(dx || 1) * limitX;
          this.velocity.x *= -0.16;
        } else {
          this.carRoot.position.z = collider.z + Math.sign(dz || 1) * limitZ;
          this.velocity.z *= -0.16;
        }
        this.velocity.multiplyScalar(0.72);
      }
    }
    this.handleWallCollision();
    const { minX, maxX, minZ, maxZ } = this.worldData.bounds;
    if (this.carRoot.position.x < minX || this.carRoot.position.x > maxX) {
      this.carRoot.position.x = THREE.MathUtils.clamp(this.carRoot.position.x, minX, maxX);
      this.velocity.x *= -0.25;
    }
    if (this.carRoot.position.z < minZ || this.carRoot.position.z > maxZ) {
      this.carRoot.position.z = THREE.MathUtils.clamp(this.carRoot.position.z, minZ, maxZ);
      this.velocity.z *= -0.25;
    }
  }

  private renderScene(): void {
    let strength = 0;
    const speed = this.velocity.length();
    if (!this.freeCameraActive && this.drivingEnabled && this.settings.effects && this.settings.quality !== 'low' && speed > MOTION_BLUR_START) {
      // Streak away from where the car is heading, as seen on screen.
      this.blurProbe.copy(this.carRoot.position).addScaledVector(this.velocity, 200 / speed).project(this.camera);
      if (this.blurProbe.z < 1) {
        const t = THREE.MathUtils.smoothstep(speed, MOTION_BLUR_START, MOTION_BLUR_FULL);
        strength = MOTION_BLUR_MAX * t;
        this.blurFocus.set(
          THREE.MathUtils.clamp(this.blurProbe.x * 0.5 + 0.5, 0, 1),
          THREE.MathUtils.clamp(this.blurProbe.y * 0.5 + 0.5, 0, 1),
        );
      }
    }
    this.atmosphere.follow(this.camera);
    this.motionBlur.render(this.scene, this.camera, strength, this.blurFocus);
    // Lit brake lamps spread their light (only while one is lit).
    if (this.settings.effects && this.settings.quality !== 'low' && this.visual.lights.brakeLevel > 0.01) this.lampBloom.render(this.scene, this.camera, this.carRoot);
    // Raindrops on the lens, over everything.
    this.lensDrops.render();
  }

  private updateCamera(dt: number, snap = false): void {
    if (this.freeCameraActive) {
      this.updateFreeCamera(dt);
      return;
    }
    if (this.cameraLocked) {
      const basis = this.computeLockedBasis(this.lockedDistance);
      this.camera.position.copy(this.lockedLocalPos).applyQuaternion(basis).add(this.carRoot.position);
      if (this.lockedDistance > 3.2) {
        const minGroundY = groundHeightAt(this.worldData, this.camera.position.x, this.camera.position.z) + 0.20;
        if (this.camera.position.y < minGroundY) this.camera.position.y = minGroundY;
      }
      this.camera.quaternion.copy(basis).multiply(this.lockedLocalQuat);
      return;
    }
    const sizeScale = this.vehicle.length / CAMERA_REFERENCE_LENGTH;
    const targetHeight = CAMERA_TARGET_HEIGHT * this.vehicle.height / CAMERA_REFERENCE_HEIGHT;
    const speed = this.velocity.length();
    const heightSmoothing = snap ? 1 : 1 - Math.pow(1 - this.settings.cameraFollow, dt * 60);
    const yawSmoothing = snap ? 1 : 1 - Math.pow(1 - this.settings.cameraFollow * 0.62, dt * 60);

    // Blend camera target heading toward the car's velocity vector when moving forward
    // so the camera stays calm along the travel path instead of whipping left/right
    // every time the tail kicks out or transitions during a drift.
    let desiredHeading = this.yaw;
    const forwardSpeed = this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
    if (!snap && forwardSpeed > 3.0 && speed > 3.5) {
      const travelYaw = Math.atan2(this.velocity.x, this.velocity.z);
      const slipDelta = THREE.MathUtils.euclideanModulo(travelYaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
      if (Math.abs(slipDelta) < 1.45) {
        const travelBlend = THREE.MathUtils.smoothstep(speed, 3.5, 11.0) * 0.58;
        desiredHeading = this.yaw + slipDelta * travelBlend;
      }
    }

    // Only the heading and the height are smoothed. The distance to the car
    // stays fixed, so speed never drags the camera back; past the pull-back
    // speed it eases out by a hair.
    this.cameraHeading += (THREE.MathUtils.euclideanModulo(desiredHeading - this.cameraHeading + Math.PI, Math.PI * 2) - Math.PI) * yawSmoothing;
    this.cameraHeight += (this.carRoot.position.y + targetHeight - this.cameraHeight) * heightSmoothing;
    this.cameraTarget.set(this.carRoot.position.x, this.cameraHeight, this.carRoot.position.z);
    const pullBack = THREE.MathUtils.smoothstep(speed, CAMERA_PULLBACK_START, CAMERA_PULLBACK_FULL);
    const distance = CAMERA_DISTANCE * sizeScale * (1 + CAMERA_PULLBACK * pullBack) * this.cameraZoom;
    const orbitInput = Number(this.keys.has('arrowright')) - Number(this.keys.has('arrowleft'));
    const elevationInput = Number(this.keys.has('arrowup')) - Number(this.keys.has('arrowdown'));
    this.cameraOrbit = Math.atan2(
      Math.sin(this.cameraOrbit + orbitInput * dt * 1.55),
      Math.cos(this.cameraOrbit + orbitInput * dt * 1.55),
    );
    this.cameraElevation = THREE.MathUtils.clamp(this.cameraElevation + elevationInput * dt * 0.62, 0.12, 0.9);
    const cameraYaw = this.cameraHeading + this.cameraOrbit;
    const sinCam = Math.sin(cameraYaw);
    const cosCam = Math.cos(cameraYaw);
    const horizontalDistance = distance * Math.cos(this.cameraElevation);
    this.camera.position.set(
      this.carRoot.position.x - sinCam * horizontalDistance,
      this.cameraTarget.y + distance * Math.sin(this.cameraElevation),
      this.carRoot.position.z - cosCam * horizontalDistance,
    );
    // Reactions to acceleration, gear changes, cornering and speed. Only the
    // lens moves, not the point it aims at, so they read as a lean, not a slide.
    const motion = this.cameraMotion;
    if (snap) {
      motion.reset();
      this.cameraGear = this.gear;
    } else {
      const gearChange = this.gear > this.cameraGear && this.cameraGear >= 1 ? 1 : this.gear < this.cameraGear && this.gear >= 1 ? -1 : 0;
      this.cameraGear = this.gear;
      motion.update({
        dt,
        accelLong: this.airborne ? 0 : this.bodyAccelLong,
        accelLat: this.airborne ? 0 : this.bodyAccelLat,
        bodyRoll: this.bodyRoll,
        speed,
        gearChange,
      });
    }
    const motionScale = sizeScale * this.cameraZoom;
    const surgeOffset = motion.surge * motionScale;
    const swayOffset = (motion.sway + motion.shake.x) * motionScale;
    this.camera.position.x += sinCam * surgeOffset + cosCam * swayOffset;
    this.camera.position.z += cosCam * surgeOffset - sinCam * swayOffset;
    this.camera.position.y += motion.shake.y * motionScale;
    this.camera.lookAt(this.cameraTarget);
    // The camera looks down its own -Z, which points along the car: rolling
    // with the body is a negative turn about the camera's Z.
    this.camera.rotateX(motion.pitch + motion.shake.pitch);
    this.camera.rotateZ(-motion.roll + motion.shake.roll);
  }

  private updateFreeCamera(dt: number): void {
    const lookYawInput = Number(this.keys.has('arrowleft')) - Number(this.keys.has('arrowright'));
    const lookPitchInput = Number(this.keys.has('arrowup')) - Number(this.keys.has('arrowdown'));
    this.freeCamYaw = Math.atan2(
      Math.sin(this.freeCamYaw + lookYawInput * dt * 1.8),
      Math.cos(this.freeCamYaw + lookYawInput * dt * 1.8),
    );
    this.freeCamPitch = THREE.MathUtils.clamp(this.freeCamPitch + lookPitchInput * dt * 1.35, -1.52, 1.52);

    const cosPitch = Math.cos(this.freeCamPitch);
    this.freeCamDir.set(-Math.sin(this.freeCamYaw) * cosPitch, Math.sin(this.freeCamPitch), -Math.cos(this.freeCamYaw) * cosPitch);
    this.freeCamRight.set(Math.cos(this.freeCamYaw), 0, -Math.sin(this.freeCamYaw));

    const forwardInput = Number(this.keys.has('w')) - Number(this.keys.has('s'));
    const rightInput = Number(this.keys.has('d')) - Number(this.keys.has('a'));
    const upInput = Number(this.keys.has(' ') || this.keys.has('e')) - Number(this.keys.has('q') || this.keys.has('control'));

    this.freeCamMove.set(0, 0, 0)
      .addScaledVector(this.freeCamDir, forwardInput)
      .addScaledVector(this.freeCamRight, rightInput);
    this.freeCamMove.y += upInput;
    if (this.freeCamMove.lengthSq() > 1) this.freeCamMove.normalize();

    const boost = this.keys.has('shift') ? 3.5 : 1;
    this.freeCamMove.multiplyScalar(this.freeCamSpeed * boost);

    const blend = 1 - Math.exp(-dt * 12);
    this.freeCamVel.lerp(this.freeCamMove, blend);
    this.freeCamPos.addScaledVector(this.freeCamVel, dt);

    // Keep at least 22 cm above the ground surface so low stance shots never clip beneath the map.
    const minGroundY = groundHeightAt(this.worldData, this.freeCamPos.x, this.freeCamPos.z) + 0.22;
    if (this.freeCamPos.y < minGroundY) {
      this.freeCamPos.y = minGroundY;
      if (this.freeCamVel.y < 0) this.freeCamVel.y = 0;
    }

    this.camera.position.copy(this.freeCamPos);
    this.camera.rotation.set(this.freeCamPitch, this.freeCamYaw, 0, 'YXZ');
  }

  private forwardSpeedKmh(): number {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return Math.max(0, this.velocity.dot(this.forward) * ECONOMY.kmhPerUnit);
  }

  private updateDriftScore(
    dt: number,
    longitudinal: number,
    lateral: number,
    speed: number,
    slipAngle: number,
    driftSeverity: number,
  ): void {
    if (this.driftTransitionTimer > 0) {
      this.driftTransitionTimer = Math.max(0, this.driftTransitionTimer - dt);
    }
    const angleDeg = slipAngle * (180 / Math.PI);
    const scoringDrift = !this.freeCameraActive
      && !this.airborne
      && longitudinal > 2.2
      && speed > 5.8
      && Math.abs(lateral) > 0.95
      && (angleDeg > 8.5 || driftSeverity > 0.05);

    if (scoringDrift) {
      this.driftSlidingNow = true;
      this.driftIdleTimer = 0;
      this.driftCurrentAngleDeg = angleDeg;

      const currentSide: -1 | 1 = lateral >= 0 ? 1 : -1;
      if (this.driftSide === currentSide) {
        this.driftSideHold += dt;
      } else {
        // Switching drift direction after holding the previous slide rewards a transition boost.
        if (this.driftSide !== 0 && this.driftSideHold >= 0.4 && this.driftScore > 40) {
          this.driftComboProgress += 0.95;
          this.driftTransitionTimer = 0.85;
        }
        this.driftSide = currentSide;
        this.driftSideHold = dt;
      }

      const speedKmh = speed * ECONOMY.kmhPerUnit;
      const angleFactor = THREE.MathUtils.smoothstep(angleDeg, 8, 48);
      const speedFactor = 0.45 + 1.55 * THREE.MathUtils.smoothstep(speedKmh, 24, 175);
      this.driftComboProgress += dt * (0.85 + 0.55 * angleFactor);
      const step = Math.floor(this.driftComboProgress / DRIFT_SECONDS_PER_STEP);
      this.driftMultiplier = Math.min(DRIFT_MAX_MULTIPLIER, 1 + step * 0.5);
      if (this.driftMultiplier > this.driftPeakMultiplier) {
        this.driftPeakMultiplier = this.driftMultiplier;
      }

      const baseRate = 430 * (0.28 + 0.72 * angleFactor) * speedFactor;
      this.driftScore += baseRate * this.driftMultiplier * dt;
      return;
    }

    this.driftSlidingNow = false;
    if (this.driftScore <= 0) return;

    this.driftIdleTimer += dt;
    if (this.driftIdleTimer >= DRIFT_COMBO_TIMEOUT) {
      this.bankDriftCombo();
    }
  }

  private bankDriftCombo(): void {
    const finalScore = Math.round(this.driftScore);
    const peakMult = this.driftPeakMultiplier;
    this.driftScore = 0;
    this.driftMultiplier = 1;
    this.driftPeakMultiplier = 1;
    this.driftComboProgress = 0;
    this.driftIdleTimer = 0;
    this.driftSide = 0;
    this.driftSideHold = 0;
    this.driftTransitionTimer = 0;
    this.driftCurrentAngleDeg = 0;
    this.driftSlidingNow = false;

    if (finalScore >= 25) {
      const payout = Math.max(1, Math.round(finalScore * DRIFT_PAYOUT_SHARE));
      this.callbacks.onDriftComplete?.(finalScore, payout, peakMult);
      this.callbacks.onTelemetry(this.makeTelemetry());
    }
  }

  private syncDriftComboState(): DriftComboState {
    const c = this.driftComboState;
    c.active = this.driftScore >= 10;
    c.sliding = this.driftSlidingNow;
    c.score = Math.round(this.driftScore);
    c.multiplier = this.driftMultiplier;
    c.remainingSeconds = c.active ? Math.max(0, DRIFT_COMBO_TIMEOUT - this.driftIdleTimer) : 0;
    c.angleDeg = Math.round(this.driftCurrentAngleDeg);
    c.transitionFlash = this.driftTransitionTimer > 0;
    return c;
  }

  private makeTelemetry(): Telemetry {
    const signed = this.velocity.dot(this.forward);
    const t = this.telemetryState;
    t.speedKmh = Math.abs(signed) * ECONOMY.kmhPerUnit;
    t.gear = this.gear;
    t.rpm = Math.round(this.sim.drivetrain.rpm);
    t.drifting = this.driftValue > 0.2;
    t.tcsActive = this.sim.output.tcsActive;
    t.driftCombo = this.syncDriftComboState();
    return t;
  }

  dispose(): void {
    this.active = false;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('pointerdown', this.onAudioGesture);
    window.removeEventListener('pointerdown', this.onCameraPointerDown, true);
    window.removeEventListener('pointermove', this.onCameraPointerMove, true);
    window.removeEventListener('pointerup', this.onCameraPointerEnd, true);
    window.removeEventListener('pointercancel', this.onCameraPointerEnd, true);
    this.renderer.domElement.removeEventListener('wheel', this.onCameraWheel);
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu);
    this.host.removeChild(this.renderer.domElement);
    this.motionBlur.dispose();
    this.atmosphere.dispose();
    this.environment.dispose();
    this.lampBloom.dispose();
    this.lensDrops.dispose();
    this.renderer.dispose();
    this.vehicleAudio.dispose();
    for (const remote of this.remoteVehicles.values()) disposeVehicleVisual(remote.visual);
    this.remoteVehicles.clear();
    disposeVehicleVisual(this.visual);
    this.tireSmoke.dispose();
    disposeObject(this.scene);
  }
}

function advanceSmokeBuild(build: number, sliding: boolean, dt: number): number {
  return sliding ? Math.min(1, build + dt / SMOKE_BUILD_TIME) : Math.max(0, build - dt / SMOKE_DECAY_TIME);
}

// Ease-in so the first moments of a slide only leave light wisps.
function smokeDensity(build: number): number {
  return 0.12 + 0.88 * build * build;
}


function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) material.dispose();
    }
  });
}

let cachedBrakeSpillTexture: THREE.CanvasTexture | null = null;

function createBrakeSpillTexture(): THREE.CanvasTexture {
  if (cachedBrakeSpillTexture) return cachedBrakeSpillTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  // Dual soft radial lobes matching the left and right tail lamps on the road behind the bumper.
  for (const cx of [size * 0.29, size * 0.71]) {
    const cy = size * 0.36;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.38);
    grad.addColorStop(0, 'rgba(255, 18, 8, 0.95)');
    grad.addColorStop(0.45, 'rgba(220, 10, 4, 0.42)');
    grad.addColorStop(1, 'rgba(180, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  cachedBrakeSpillTexture = texture;
  return texture;
}
