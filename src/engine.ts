import * as THREE from 'three';
import { ECONOMY, type MapId, type VehicleSpec } from './data';
import { IncomeClock } from './economy';
import type { GameSettings } from './save';
import { createVehicleVisual, disposeVehicleVisual, installGeneratedModel, setVehicleWheelSpin, type VehicleVisual } from './vehicle';
import { buildWorld, type WorldData } from './world';

export type Gear = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type DrivingControl = 'gas' | 'brake' | 'left' | 'right' | 'handbrake';

export interface Telemetry {
  speedKmh: number;
  gear: Gear;
  rpm: number;
  drifting: boolean;
}

export interface EngineCallbacks {
  onIncome: (amount: number) => void;
  onMissionComplete: (amount: number) => void;
  onMissionFailed: () => void;
  onDevCode: () => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onEscape: () => void;
}

const GEAR_SPEED = [0, 0.17, 0.31, 0.48, 0.66, 0.84, 1];
const GEAR_TORQUE = [0, 1, 0.82, 0.68, 0.57, 0.49, 0.43];
const MASTER_PHYSICS = {
  step: 1 / 120,
  frontLoad: 0.52,
  tireGrip: 1.15,
  corneringStiffness: 54,
  yawInertiaFactor: 0.28,
  rollingResistance: 0.08,
  steeringRate: 4.2,
  steeringReturnRate: 3.2,
  drivetrainEfficiency: 0.82,
  lowSpeedPowerReference: 8,
} as const;

const FALLBACK_MASS_KG: Record<VehicleSpec['category'], number> = {
  EKONOMI: 1120,
  SEHIR: 1375,
  SPORT: 1480,
  PERFORMANS: 1630,
  SUPER: 1540,
};

function pixelRatioLimit(quality: GameSettings['quality']): number {
  if (quality === 'ultra') return 2.25;
  if (quality === 'high') return 1.65;
  return quality === 'medium' ? 1.25 : 0.9;
}

function shadowMapResolution(quality: GameSettings['quality']): number {
  if (quality === 'ultra') return 3072;
  if (quality === 'high') return 1536;
  return 1024;
}

function tireForceFromSlip(slipAngle: number, stiffness: number, limit: number): number {
  if (limit <= 0) return 0;
  return -limit * Math.tanh((stiffness * slipAngle) / limit);
}

function vehicleMassKg(vehicle: VehicleSpec): number {
  return vehicle.realSpecs?.weightKg ?? FALLBACK_MASS_KG[vehicle.category];
}

export class DriveEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1400);
  private readonly clock = new THREE.Clock();
  private readonly keys = new Set<string>();
  private readonly touchKeys = new Set<string>();
  private readonly incomeClock = new IncomeClock();
  private readonly sun: THREE.DirectionalLight;
  private readonly carRoot = new THREE.Group();
  private readonly callbacks: EngineCallbacks;
  private worldData: WorldData;
  private visual: VehicleVisual;
  private vehicle: VehicleSpec;
  private mapId: MapId;
  private settings: GameSettings;
  private gear: Gear = 1;
  private velocity = new THREE.Vector3();
  private yaw = Math.PI / 2;
  private yawRate = 0;
  private frontWheelAngle = 0;
  private previousSteerInput = 0;
  private flickLoad = 0;
  private cameraOrbit = 0;
  private cameraElevation = Math.asin(3.6 / 9.2);
  private cameraZoom = 1;
  private drivingEnabled = false;
  private driftModeEnabled = false;
  private driftModeBlend = 0;
  private masterModeEnabled = false;
  private handbrakeGripBlend = 0;
  private cameraPointerId: number | null = null;
  private cameraPointerX = 0;
  private cameraPointerY = 0;
  private readonly cameraPointers = new Map<number, { x: number; y: number }>();
  private cameraPinchDistance = 0;
  private active = true;
  private animationFrame = 0;
  private renderElapsed = 0;
  private telemetryElapsed = 0;
  private wheelTravel = 0;
  private rearWheelTravel = 0;
  private burnoutWheelSpin = 0;
  private driftValue = 0;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraDesired = new THREE.Vector3();
  private readonly previousCarPosition = new THREE.Vector3();
  private readonly speedGateCooldowns = new Map<string, number>();
  private drivingElapsed = 0;
  private readonly skidMarks: THREE.InstancedMesh;
  private readonly skidDummy = new THREE.Object3D();
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
  private static readonly smokeCapacity = 56;
  private readonly tireSmoke: THREE.Points;
  private readonly smokePositions = new Float32Array(DriveEngine.smokeCapacity * 3);
  private readonly smokeSizes = new Float32Array(DriveEngine.smokeCapacity);
  private readonly smokeOpacities = new Float32Array(DriveEngine.smokeCapacity);
  private readonly smokeAges = new Float32Array(DriveEngine.smokeCapacity).fill(-1);
  private readonly smokeLifetimes = new Float32Array(DriveEngine.smokeCapacity);
  private readonly smokeStrengths = new Float32Array(DriveEngine.smokeCapacity);
  private readonly smokeVelocities = Array.from({ length: DriveEngine.smokeCapacity }, () => new THREE.Vector3());
  private smokeIndex = 0;
  private smokeEmitElapsed = 0;
  private readonly ambient: THREE.HemisphereLight;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    vehicle: VehicleSpec,
    mapId: MapId,
    settings: GameSettings,
    callbacks: EngineCallbacks,
  ) {
    this.vehicle = vehicle;
    this.mapId = mapId;
    this.settings = { ...settings };
    this.callbacks = callbacks;
    this.scene.background = new THREE.Color('#9aafac');
    this.scene.fog = new THREE.Fog('#9aafac', 108, 950);
    this.ambient = new THREE.HemisphereLight('#e4f0e8', '#59624f', 2.15);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff1d5', 3.1);
    this.sun.position.set(220, 160, -60);
    this.sun.target.position.set(300, 0, 0);
    this.scene.add(this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.camera.left = -600;
    this.sun.shadow.camera.right = 600;
    this.sun.shadow.camera.top = 310;
    this.sun.shadow.camera.bottom = -310;
    this.sun.shadow.bias = -0.0003;
    this.scene.add(this.sun);
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
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3).setUsage(THREE.DynamicDrawUsage));
    smokeGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.smokeSizes, 1).setUsage(THREE.DynamicDrawUsage));
    smokeGeometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.smokeOpacities, 1).setUsage(THREE.DynamicDrawUsage));
    this.tireSmoke = new THREE.Points(smokeGeometry, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      vertexShader: `
        attribute float aSize;
        attribute float aOpacity;
        varying float vOpacity;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = clamp(aSize * (260.0 / max(-viewPosition.z, 0.1)), 2.0, 90.0);
          vOpacity = aOpacity;
        }
      `,
      fragmentShader: `
        varying float vOpacity;
        void main() {
          float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float softCloud = exp(-radius * radius * 4.2) * (1.0 - smoothstep(0.12, 1.0, radius));
          gl_FragColor = vec4(vec3(0.70, 0.72, 0.70), softCloud * vOpacity);
        }
      `,
    }));
    this.tireSmoke.frustumCulled = false;
    this.tireSmoke.renderOrder = 2;
    this.tireSmoke.visible = this.settings.effects;
    this.scene.add(this.tireSmoke);
    this.worldData = buildWorld(mapId, this.settings);
    this.scene.add(this.worldData.root);
    this.visual = createVehicleVisual(vehicle);
    this.carRoot.add(this.visual.root);
    void installGeneratedModel(this.visual, vehicle);
    this.resetCar();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const shadowResolution = Math.min(shadowMapResolution(this.settings.quality), this.renderer.capabilities.maxTextureSize);
    this.sun.shadow.mapSize.set(shadowResolution, shadowResolution);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit(this.settings.quality)));
    this.renderer.setSize(host.clientWidth, host.clientHeight, false);
    this.renderer.shadowMap.enabled = this.settings.shadows && this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'drive-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Sürüş alanı');
    this.renderer.domElement.addEventListener('wheel', this.onCameraWheel, { passive: false });
    this.host.appendChild(this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
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
    const key = event.key.toLowerCase();
    if (key === 'escape') {
      event.preventDefault();
      this.callbacks.onEscape();
      return;
    }
    if (key === 't') {
      event.preventDefault();
      this.callbacks.onDevCode();
      return;
    }
    if (key === 'e' || key === 'q') {
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
    if (['w', 'a', 's', 'd', ' '].includes(key)) {
      event.preventDefault();
      if (this.drivingEnabled) this.keys.add(key);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.key.toLowerCase()); };
  private clearKeys = (): void => { this.keys.clear(); this.touchKeys.clear(); this.endCameraDrag(); };

  private onCameraWheel = (event: WheelEvent): void => {
    if (!this.drivingEnabled) return;
    event.preventDefault();
    this.cameraZoom = THREE.MathUtils.clamp(this.cameraZoom * Math.exp(event.deltaY * 0.001), 0.55, 2.5);
  };

  private onCameraPointerDown = (event: PointerEvent): void => {
    if (!this.drivingEnabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
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

  toggleDriftMode(): boolean {
    this.driftModeEnabled = !this.driftModeEnabled;
    if (this.driftModeEnabled) this.masterModeEnabled = false;
    return this.driftModeEnabled;
  }

  toggleMasterMode(): boolean {
    this.masterModeEnabled = !this.masterModeEnabled;
    if (this.masterModeEnabled) {
      this.driftModeEnabled = false;
      this.driftModeBlend = 0;
    }
    return this.masterModeEnabled;
  }

  isDriftModeEnabled(): boolean { return this.driftModeEnabled; }
  isMasterModeEnabled(): boolean { return this.masterModeEnabled; }

  private isDown(key: string): boolean {
    return this.keys.has(key) || this.touchKeys.has(key);
  }

  shiftUp(): void {
    this.gear = (this.gear === -1 ? 0 : Math.min(6, Math.max(1, this.gear + 1))) as Gear;
  }

  shiftDown(): void {
    this.gear = (this.gear === 1 ? 0 : Math.max(-1, this.gear - 1)) as Gear;
  }

  setDrivingEnabled(enabled: boolean): void {
    this.drivingEnabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.touchKeys.clear();
      this.endCameraDrag();
      this.velocity.set(0, 0, 0);
      this.yawRate = 0;
      this.frontWheelAngle = 0;
      this.driftValue = 0;
      this.incomeClock.reset();
      this.callbacks.onTelemetry({ speedKmh: 0, gear: this.gear, rpm: 850, drifting: false });
    }
  }

  setVehicle(vehicle: VehicleSpec): void {
    this.vehicle = vehicle;
    this.gear = 1;
    this.velocity.set(0, 0, 0);
    this.wheelTravel = 0;
    this.rearWheelTravel = 0;
    this.burnoutWheelSpin = 0;
    this.skidModelPositionsReady = false;
    this.incomeClock.reset();
    this.clearSkids();
    this.carRoot.remove(this.visual.root);
    disposeVehicleVisual(this.visual);
    this.visual = createVehicleVisual(vehicle);
    this.carRoot.add(this.visual.root);
    this.resetCar();
    void installGeneratedModel(this.visual, vehicle);
  }

  setMap(mapId: MapId): void {
    if (this.mapId === mapId) return;
    this.mapId = mapId;
    this.scene.remove(this.worldData.root);
    disposeObject(this.worldData.root);
    this.worldData = buildWorld(mapId, this.settings);
    this.scene.add(this.worldData.root);
    this.clearSkids();
    this.applyMapPalette();
    this.resetCar();
  }

  setSettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.renderer.shadowMap.enabled = settings.shadows && settings.quality !== 'low';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit(settings.quality)));
    this.renderer.shadowMap.needsUpdate = true;
    const shadowResolution = Math.min(shadowMapResolution(settings.quality), this.renderer.capabilities.maxTextureSize);
    if (this.sun.shadow.mapSize.width !== shadowResolution || this.sun.shadow.mapSize.height !== shadowResolution) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(shadowResolution, shadowResolution);
    }
    this.skidMarks.visible = settings.effects;
    this.tireSmoke.visible = settings.effects;
    if (!settings.effects) this.clearSkids();
    this.ambient.intensity = settings.quality === 'low' ? 1.7 : 2.15;
    this.sun.intensity = settings.quality === 'low' ? 2.4 : 3.1;
    this.applyMapPalette();
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) object.castShadow = settings.shadows && settings.quality !== 'low';
    });
    this.resize();
  }

  getMapId(): MapId { return this.mapId; }
  getVehicle(): VehicleSpec { return this.vehicle; }

  resetCar(): void {
    this.carRoot.position.copy(this.worldData.spawn);
    this.yaw = this.worldData.spawnYaw;
    this.yawRate = 0;
    this.frontWheelAngle = 0;
    this.previousSteerInput = 0;
    this.flickLoad = 0;
    this.velocity.set(0, 0, 0);
    this.previousCarPosition.copy(this.worldData.spawn);
    this.speedGateCooldowns.clear();
    this.drivingElapsed = 0;
    this.carRoot.rotation.y = this.yaw;
    this.carRoot.position.y = 0.015;
    this.camera.position.set(this.carRoot.position.x - 11, 7.3, this.carRoot.position.z);
    this.camera.lookAt(this.carRoot.position.x, 1.2, this.carRoot.position.z);
    this.incomeClock.reset();
    this.clearSkids();
  }

  private applyMapPalette(): void {
    const color = '#a9b9ae';
    this.scene.background = new THREE.Color(color);
    this.scene.fog = this.settings.quality === 'low'
      ? new THREE.Fog(color, 80, 520)
      : new THREE.Fog(color, 108, this.settings.quality === 'ultra' ? 1200 : this.settings.quality === 'high' ? 950 : 700);
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private frame = (time: number): void => {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.active) {
      if (this.drivingEnabled) this.updateDriving(dt);
      this.updateCamera(dt);
      const telemetry = this.makeTelemetry();
      const income = this.incomeClock.update(dt, this.forwardSpeedKmh(), this.vehicle, this.drivingEnabled);
      if (income.paid > 0) this.callbacks.onIncome(income.paid);
      this.telemetryElapsed += dt;
      if (this.telemetryElapsed >= 0.08) {
        this.telemetryElapsed = 0;
        this.callbacks.onTelemetry(telemetry);
      }
      this.renderElapsed += dt;
      const limit = this.settings.fpsLimit === 0 ? 0 : 1 / this.settings.fpsLimit;
      if (limit === 0 || this.renderElapsed >= limit) {
        this.renderer.render(this.scene, this.camera);
        this.renderElapsed = 0;
      }
    }
    this.animationFrame = requestAnimationFrame(this.frame);
    void time;
  };

  private updateDriving(dt: number): void {
    this.previousCarPosition.copy(this.carRoot.position);
    this.drivingElapsed += dt;
    const gas = this.isDown('w');
    const brake = this.isDown('s');
    const steerInput = (this.isDown('a') ? 1 : 0) - (this.isDown('d') ? 1 : 0);
    const handbrake = this.isDown(' ');
    if (this.masterModeEnabled) {
      this.updateMasterDriving(dt, gas, brake, steerInput, handbrake);
      return;
    }
    this.driftModeBlend = approach(this.driftModeBlend, this.driftModeEnabled ? 1 : 0, dt * 2.2);
    this.handbrakeGripBlend = approach(this.handbrakeGripBlend, handbrake ? 1 : 0, dt * (handbrake ? 8 : 2.8));
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let longitudinal = this.velocity.dot(this.forward);
    let lateral = this.velocity.dot(this.right);
    const burnout = gas && brake && this.velocity.length() < 1.15;

    if (brake) {
      if (Math.abs(longitudinal) > 0.33) {
        longitudinal = approach(longitudinal, 0, this.vehicle.braking * dt);
      } else {
        longitudinal = 0;
      }
    } else if (gas && this.gear >= 1) {
      const ratio = GEAR_SPEED[this.gear];
      const limit = this.vehicle.maxSpeed / ECONOMY.kmhPerUnit * ratio;
      const torque = GEAR_TORQUE[this.gear];
      longitudinal = Math.min(limit, longitudinal + this.vehicle.acceleration * torque * dt);
    } else if (gas && this.gear === -1) {
      longitudinal = Math.max(-11, longitudinal - this.vehicle.acceleration * 0.48 * dt);
    } else if (this.gear === 0) {
      longitudinal *= Math.exp(-0.08 * dt);
    } else {
      longitudinal *= Math.exp(-0.16 * dt);
    }

    // Keep world momentum independent from body heading while the tire forces
    // update the body-frame forward and lateral components below.
    this.velocity.copy(this.forward).multiplyScalar(longitudinal).addScaledVector(this.right, lateral);
    const speed = this.velocity.length();
    const steeringDemand = THREE.MathUtils.clamp(Math.abs(steerInput) * (0.25 + speed / 12), 0, 1);
    const reversalImpulse = this.previousSteerInput * steerInput < 0
      ? THREE.MathUtils.clamp(Math.abs(steerInput - this.previousSteerInput) * 0.5, 0, 1) * THREE.MathUtils.clamp(speed / 20, 0, 1)
      : 0;
    this.flickLoad = Math.max(reversalImpulse, this.flickLoad * Math.exp(-dt / 0.28));
    this.previousSteerInput = steerInput;
    const wheelbase = Math.max(2, this.vehicle.length * 0.58);
    const maxSteeringAngle = Math.min(0.78, this.vehicle.steering * 0.5);
    // Preserve A/D steering direction; drift yaw follows this filtered wheel angle.
    const steeringTarget = steerInput * maxSteeringAngle;
    const steeringReleased = Math.abs(steerInput) <= 0.05;
    const steeringResponse = steeringReleased
      ? THREE.MathUtils.lerp(3.8, 0.8, this.driftModeBlend)
      : THREE.MathUtils.lerp(3.8, 2.8, this.driftModeBlend);
    this.frontWheelAngle = approach(this.frontWheelAngle, steeringTarget, steeringResponse * this.vehicle.handling * dt);
    const yawSteeringAngle = THREE.MathUtils.lerp(steeringTarget, this.frontWheelAngle, this.driftModeBlend);
    const steeringYawRate = longitudinal / wheelbase * Math.tan(yawSteeringAngle);

    const normalLateralGrip = this.vehicle.handling * (steeringDemand < 0.05 ? 11.5 : 9.8);
    // The old drift setting recovered lateral velocity in roughly 0.15–0.25 s,
    // which made a lifted throttle feel like an invisible brake. Keep some
    // stabilizing tire response, but let the car carry its slide long enough
    // for throttle and counter-steer to shape it.
    const driftLateralGrip = this.vehicle.handling * Math.max(1.15, 2.7 - steeringDemand * 0.9 - (gas ? 0.55 : 0.2) + (brake ? 0.35 : 0));
    let lateralRecovery = THREE.MathUtils.lerp(normalLateralGrip, driftLateralGrip, this.driftModeBlend);
    if (brake && speed > 7) {
      lateralRecovery *= 1 - 0.14 * THREE.MathUtils.clamp((speed - 7) / 16, 0, 1) * steeringDemand;
    }
    lateralRecovery *= 1 - this.flickLoad * (0.06 + 0.08 * this.driftModeBlend);
    if (speed > 4 && this.handbrakeGripBlend > 0) {
      const handbrakeGrip = this.vehicle.handling * THREE.MathUtils.lerp(2.25, 1.3, this.driftModeBlend);
      lateralRecovery = THREE.MathUtils.lerp(lateralRecovery, Math.min(lateralRecovery, handbrakeGrip), this.handbrakeGripBlend);
    }
    // On a drift-mode coast with no steering/brake input, keep some sideways
    // momentum. Counter-steer and braking retain their separate grip response.
    if (steeringReleased && !brake && !handbrake) {
      lateralRecovery *= THREE.MathUtils.lerp(1, 0.6, this.driftModeBlend);
    }
    const counterSteering = Math.abs(lateral) > 0.1 && Math.abs(steerInput) > 0.05 && Math.sign(lateral) === Math.sign(steerInput);
    if (counterSteering) {
      const counterSteerGrip = THREE.MathUtils.lerp(3.2, 0.2, this.driftModeBlend);
      lateralRecovery += this.vehicle.handling * counterSteerGrip * Math.abs(steerInput);
    }

    const releaseYawAssist = steeringReleased ? 0.1 * (1 - this.driftModeBlend) : 0;
    const counterSteerYaw = counterSteering ? 0.1 * Math.abs(steerInput) : 0;
    const driftSlipYaw = 0.12 + 0.14 * this.driftModeBlend;
    const releasedSlipYaw = THREE.MathUtils.lerp(driftSlipYaw, 0.16, steeringReleased ? this.driftModeBlend : 0);
    const driftCounterYaw = counterSteerYaw * (1 - 0.6 * this.driftModeBlend);
    const slipYawRate = lateral / wheelbase * (
      releasedSlipYaw + 0.12 * this.handbrakeGripBlend + releaseYawAssist + driftCounterYaw
    );
    const handbrakeTurn = handbrake && speed > 5 && Math.abs(steerInput) > 0.05;
    const maximumYawRate = Math.min(
      handbrakeTurn ? 1.9 : 2.1 + 0.3 * this.driftModeBlend,
      this.vehicle.handling * (handbrakeTurn ? 30 : 40 + 5 * this.driftModeBlend) / Math.max(speed, 2.5),
    );
    const yawRateLimit = Math.min(2.4, maximumYawRate * (handbrakeTurn ? 1.5 : 1));
    const driftYawRateLimit = yawRateLimit * (1 + 0.25 * this.driftModeBlend);
    const targetYawRate = THREE.MathUtils.clamp(steeringYawRate + slipYawRate, -driftYawRateLimit, driftYawRateLimit);
    const speedLoad = THREE.MathUtils.clamp(speed / 35, 0, 1);
    const normalYawAcceleration = THREE.MathUtils.lerp(8, 4.8, speedLoad);
    const driftYawAcceleration = THREE.MathUtils.lerp(4.4, 3.2, speedLoad);
    const yawAcceleration = this.vehicle.handling * THREE.MathUtils.lerp(normalYawAcceleration, driftYawAcceleration, this.driftModeBlend);
    const releasedYawAcceleration = this.vehicle.handling * 1.4;
    const yawRateResponse = THREE.MathUtils.lerp(
      yawAcceleration,
      releasedYawAcceleration,
      steeringReleased ? this.driftModeBlend : 0,
    );
    this.yawRate = approach(this.yawRate, targetYawRate, yawRateResponse * dt);
    this.yaw += this.yawRate * dt;

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // Reproject world momentum against the updated heading, then let grip
    // gradually reduce lateral speed instead of snapping it to zero.
    longitudinal = this.velocity.dot(this.forward);
    lateral = this.velocity.dot(this.right);
    lateral *= Math.exp(-lateralRecovery * dt);
    const slipAngle = Math.atan2(Math.abs(lateral), Math.max(Math.abs(longitudinal), 1));
    const drifting = (handbrake || this.driftModeBlend > 0.15 || this.driftValue > 0.08)
      && speed > 6 && slipAngle > 0.12 && Math.abs(lateral) > 1.25;
    const driftSeverity = THREE.MathUtils.clamp((slipAngle - 0.12) / 0.42, 0, 1);
    this.driftValue = drifting ? Math.min(1, this.driftValue + dt * (1.5 + driftSeverity * 2)) : Math.max(0, this.driftValue - dt * 3.4);

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.velocity.copy(this.forward).multiplyScalar(longitudinal).addScaledVector(this.right, lateral);
    const speedMagnitude = this.velocity.length();
    const absoluteLimit = this.vehicle.maxSpeed / ECONOMY.kmhPerUnit + 2;
    if (speedMagnitude > absoluteLimit) this.velocity.multiplyScalar(absoluteLimit / speedMagnitude);
    this.carRoot.position.addScaledVector(this.velocity, dt);
    this.handleCollisions();
    this.checkSpeedGates();
    this.carRoot.rotation.y = this.yaw;
    this.carRoot.position.y = 0.015 + (drifting ? Math.min(0.045, this.driftValue * 0.045) : 0);
    this.updateSkids(drifting, slipAngle, speed);
    this.wheelTravel += longitudinal * dt;
    this.burnoutWheelSpin = approach(
      this.burnoutWheelSpin,
      burnout ? (this.gear === -1 ? -18 : 18) : 0,
      dt * 28,
    );
    this.rearWheelTravel += (longitudinal + this.burnoutWheelSpin) * dt;
    this.updateTireSmoke(dt, burnout ? 1 : drifting ? driftSeverity : 0);
    setVehicleWheelSpin(this.visual, this.wheelTravel, this.frontWheelAngle, this.rearWheelTravel);
  }

  private updateMasterDriving(dt: number, gas: boolean, brake: boolean, steerInput: number, handbrake: boolean): void {
    if (gas && this.gear === 0) this.gear = 1;
    let remaining = dt;
    let speed = this.velocity.length();
    let slipAngle = 0;
    let burnout = false;
    const steerReversal = this.previousSteerInput * steerInput < 0
      ? THREE.MathUtils.clamp(Math.abs(steerInput - this.previousSteerInput), 0, 1)
        * THREE.MathUtils.clamp(speed / 12, 0, 1)
      : 0;
    this.flickLoad = Math.max(steerReversal, this.flickLoad);
    const topSpeed = this.vehicle.maxSpeed / ECONOMY.kmhPerUnit;
    const massKg = vehicleMassKg(this.vehicle);
    const availablePowerW = this.vehicle.power * 745.7 * MASTER_PHYSICS.drivetrainEfficiency;
    // Set drag from available wheel power at the vehicle's configured cruise
    // target. This creates a power-versus-drag terminal speed instead of a
    // direct velocity clamp.
    const aeroCoefficient = availablePowerW / (massKg * Math.max(topSpeed ** 3, 1));

    while (remaining > 1e-7) {
      const step = Math.min(MASTER_PHYSICS.step, remaining);
      remaining -= step;
      this.flickLoad *= Math.exp(-step / 0.3);
      this.handbrakeGripBlend = approach(this.handbrakeGripBlend, handbrake ? 1 : 0, step * (handbrake ? 8 : 2.8));
      this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      let longitudinal = this.velocity.dot(this.forward);
      let lateral = this.velocity.dot(this.right);
      speed = Math.hypot(longitudinal, lateral);
      burnout = gas && brake && speed < 1.15;
      const wheelbase = Math.max(2, this.vehicle.length * 0.58);
      const maxWheelAngle = Math.min(
        this.vehicle.steering * 0.5,
        Math.atan2(MASTER_PHYSICS.tireGrip * this.vehicle.handling * 9.81 * wheelbase * 0.82, Math.max(longitudinal * longitudinal, 1)),
      );
      const steeringTarget = steerInput * maxWheelAngle;
      const steeringRate = steerInput === 0 ? MASTER_PHYSICS.steeringReturnRate : MASTER_PHYSICS.steeringRate;
      this.frontWheelAngle = approach(this.frontWheelAngle, steeringTarget, steeringRate * step);

      let driveAcceleration = 0;
      if (gas && this.gear >= 1) {
        const gearLimit = topSpeed * GEAR_SPEED[this.gear];
        const engineHeadroom = THREE.MathUtils.clamp((gearLimit - Math.abs(longitudinal)) / Math.max(gearLimit * 0.18, 1), 0, 1);
        const torqueLimitedAcceleration = this.vehicle.acceleration * GEAR_TORQUE[this.gear] * engineHeadroom;
        const powerLimitedAcceleration = availablePowerW * engineHeadroom
          / (massKg * Math.max(Math.abs(longitudinal), MASTER_PHYSICS.lowSpeedPowerReference));
        driveAcceleration = Math.min(torqueLimitedAcceleration, powerLimitedAcceleration);
      }
      else if (gas && this.gear === -1) {
        const reverseTorque = this.vehicle.acceleration * 0.48;
        const reversePower = availablePowerW
          / (massKg * Math.max(Math.abs(longitudinal), MASTER_PHYSICS.lowSpeedPowerReference));
        driveAcceleration = -Math.min(reverseTorque, reversePower);
      }

      let brakeAcceleration = 0;
      if (brake && Math.abs(longitudinal) > 0.1) {
        brakeAcceleration = -Math.sign(longitudinal) * Math.min(this.vehicle.braking, Math.abs(longitudinal) / step);
      }

      const estimatedLongitudinalAcceleration = driveAcceleration + brakeAcceleration;
      const weightShift = THREE.MathUtils.clamp(
        (estimatedLongitudinalAcceleration * 0.55) / (wheelbase * 9.81),
        -0.18,
        0.18,
      );
      const frontLoad = THREE.MathUtils.clamp(MASTER_PHYSICS.frontLoad - weightShift, 0.32, 0.68);
      const rearLoad = 1 - frontLoad;
      const handlingGrip = MASTER_PHYSICS.tireGrip * this.vehicle.handling;
      // VehicleSpec acceleration/braking are whole-car gameplay targets. The
      // Usta branch drives the rear axle, so calibrate the shared tire budget
      // against the rear load; a fixed 1.15 g cap clipped acceleration and
      // braking before the configured vehicle values could be reached.
      const longitudinalCapacity = Math.max(
        handlingGrip * 9.81,
        this.vehicle.acceleration / Math.max(rearLoad, 0.32),
        this.vehicle.braking,
      );
      // A steering reversal briefly unloads rear grip. This affects only the
      // tire response; engine torque and throttle calculations stay intact.
      const rearGripScale = (1 - this.handbrakeGripBlend * 0.78) * (1 - this.flickLoad * 0.16);
      const frontLongitudinalCapacity = longitudinalCapacity * frontLoad;
      const rearLongitudinalCapacity = handlingGrip * 9.81 * rearLoad * rearGripScale;
      const frontLateralCapacity = handlingGrip * 9.81 * frontLoad;
      const rearLateralCapacity = handlingGrip * 9.81 * rearLoad * rearGripScale;

      const rearAxle = wheelbase * (1 - 0.52);
      const frontAxle = wheelbase - rearAxle;
      const speedForSlip = Math.max(Math.abs(longitudinal), 0.75) * (longitudinal < 0 ? -1 : 1);
      const forceBuild = THREE.MathUtils.clamp(speed / 3, 0, 1);
      const frontSlip = Math.atan2(lateral + this.yawRate * frontAxle, speedForSlip) - this.frontWheelAngle;
      const rearSlip = Math.atan2(lateral - this.yawRate * rearAxle, speedForSlip);
      const frontLateralWheel = tireForceFromSlip(
        frontSlip,
        MASTER_PHYSICS.corneringStiffness * this.vehicle.handling * frontLoad * forceBuild,
        frontLateralCapacity,
      );
      const rearLateralAtPeak = tireForceFromSlip(
        rearSlip,
        MASTER_PHYSICS.corneringStiffness * this.vehicle.handling * rearLoad * forceBuild,
        rearLateralCapacity,
      );
      // Let the rear tires fall off their peak progressively at large slip
      // angles, while the front tires retain the force needed for counter-steer.
      const rearBreakaway = THREE.MathUtils.smoothstep(Math.abs(rearSlip), 0.2, 0.55);
      const rearLateral = rearLateralAtPeak * (1 - rearBreakaway * 0.32);

      const frontLongitudinalDemand = brakeAcceleration * 0.68;
      const rearLongitudinalDemand = driveAcceleration + brakeAcceleration * 0.32;
      const frontUse = Math.hypot(
        frontLongitudinalDemand / Math.max(frontLongitudinalCapacity, 1e-4),
        frontLateralWheel / Math.max(frontLateralCapacity, 1e-4),
      );
      const rearUse = Math.hypot(
        rearLongitudinalDemand / Math.max(rearLongitudinalCapacity, 1e-4),
        rearLateral / Math.max(rearLateralCapacity, 1e-4),
      );
      const frontScale = frontUse > 1 ? 1 / frontUse : 1;
      const rearScale = rearUse > 1 ? 1 / rearUse : 1;
      const frontLongitudinalWheel = frontLongitudinalDemand * frontScale;
      const frontLateralWheelApplied = frontLateralWheel * frontScale;
      // In Usta mode, rear tire saturation must not reduce engine throttle
      // demand. Keep the rear brake contribution traction-limited, while
      // allowing the configured drive acceleration through unchanged.
      const rearLongitudinal = driveAcceleration + brakeAcceleration * 0.32 * rearScale;
      const rearLateralApplied = rearLateral * rearScale;
      const appliedDriveAcceleration = Math.max(0, Math.sign(driveAcceleration) * rearLongitudinal);
      const wheelspinAcceleration = Math.max(0, Math.abs(driveAcceleration) - appliedDriveAcceleration);
      const frontLongitudinal = frontLongitudinalWheel * Math.cos(this.frontWheelAngle)
        - frontLateralWheelApplied * Math.sin(this.frontWheelAngle);
      const frontLateral = frontLongitudinalWheel * Math.sin(this.frontWheelAngle)
        + frontLateralWheelApplied * Math.cos(this.frontWheelAngle);

      const aerodynamicDrag = aeroCoefficient * speed;
      const rollingDrag = Math.abs(longitudinal) > 0.2 ? Math.sign(longitudinal) * MASTER_PHYSICS.rollingResistance : longitudinal / step;
      const yawInertia = Math.max(1.8, (this.vehicle.length ** 2 + this.vehicle.width ** 2) * MASTER_PHYSICS.yawInertiaFactor);
      const lowSpeedRotation = THREE.MathUtils.clamp(speed / 2.5, 0, 1);
      const yawDamping = 0.55 + (1 - lowSpeedRotation) * 2.4;
      const yawAcceleration = (frontAxle * frontLateral - rearAxle * rearLateralApplied)
        / yawInertia * lowSpeedRotation
        - this.yawRate * yawDamping;
      let nextLongitudinal = longitudinal + (
        frontLongitudinal + rearLongitudinal - aerodynamicDrag * longitudinal - rollingDrag
        + lateral * this.yawRate
      ) * step;
      let nextLateral = lateral + (frontLateral + rearLateralApplied - longitudinal * this.yawRate - aerodynamicDrag * lateral) * step;
      if (burnout) {
        nextLongitudinal = 0;
        nextLateral = 0;
        this.yawRate = approach(this.yawRate, 0, step * 6);
      }
      this.yawRate += yawAcceleration * step;
      const nextSpeed = Math.hypot(nextLongitudinal, nextLateral);
      // Prevent tire forces or residual yaw momentum from turning a nearly
      // stationary car in place. The limit fades out by 2.5 m/s, leaving the
      // normal-speed drift response and the engine torque curve untouched.
      if (nextSpeed < 2.5) {
        const lowSpeedYawLimit = nextSpeed * 0.36;
        this.yawRate = THREE.MathUtils.clamp(this.yawRate, -lowSpeedYawLimit, lowSpeedYawLimit);
      }
      this.velocity.copy(this.forward).multiplyScalar(nextLongitudinal).addScaledVector(this.right, nextLateral);
      this.yaw += this.yawRate * step;
      this.carRoot.position.addScaledVector(this.velocity, step);
      this.wheelTravel += nextLongitudinal * step;
      if (burnout) {
        this.burnoutWheelSpin = approach(this.burnoutWheelSpin, this.gear === -1 ? -18 : 18, step * 28);
        this.rearWheelTravel += (nextLongitudinal + this.burnoutWheelSpin) * step;
      } else {
        this.burnoutWheelSpin = approach(this.burnoutWheelSpin, 0, step * 28);
        this.rearWheelTravel += (nextLongitudinal
          + Math.sign(driveAcceleration) * wheelspinAcceleration * step) * step;
      }

      slipAngle = Math.atan2(nextLateral, Math.max(Math.abs(nextLongitudinal), 0.75));
      const drifting = speed > 6 && Math.abs(slipAngle) > 0.12 && Math.abs(nextLateral) > 1.25;
      this.driftValue = drifting
        ? Math.min(1, this.driftValue + step * (1 + THREE.MathUtils.clamp((Math.abs(slipAngle) - 0.12) / 0.6, 0, 1)))
        : Math.max(0, this.driftValue - step * 2.4);
    }

    this.previousSteerInput = steerInput;
    this.handleCollisions();
    this.checkSpeedGates();
    this.carRoot.rotation.y = this.yaw;
    const sideSpeed = this.velocity.dot(this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)));
    speed = this.velocity.length();
    slipAngle = Math.atan2(sideSpeed, Math.max(Math.abs(this.velocity.dot(this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)))), 0.75));
    const drifting = speed > 6 && Math.abs(slipAngle) > 0.12 && Math.abs(sideSpeed) > 1.25;
    this.carRoot.position.y = 0.015 + (drifting ? Math.min(0.045, this.driftValue * 0.045) : 0);
    this.updateSkids(drifting, Math.abs(slipAngle), speed);
    const driftSmoke = drifting ? THREE.MathUtils.clamp((Math.abs(slipAngle) - 0.12) / 0.42, 0.18, 1) : 0;
    this.updateTireSmoke(dt, burnout ? 1 : driftSmoke);
    setVehicleWheelSpin(this.visual, this.wheelTravel, this.frontWheelAngle, this.rearWheelTravel);
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
        this.skidDummy.position.set(this.skidInterpolatedPosition.x, 0.024, this.skidInterpolatedPosition.z);
        this.skidDummy.rotation.set(0, markYaw, 0);
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

  private updateTireSmoke(dt: number, intensity: number): void {
    const canEmit = this.settings.effects && intensity > 0.08;
    if (canEmit) {
      this.updateSkidWheelPositions();
      this.smokeEmitElapsed += dt;
      while (this.smokeEmitElapsed >= 0.06) {
        this.smokeEmitElapsed -= 0.06;
        this.emitTireSmoke(0, intensity);
        this.emitTireSmoke(1, intensity);
      }
    } else {
      this.smokeEmitElapsed = 0;
    }

    for (let i = 0; i < DriveEngine.smokeCapacity; i += 1) {
      const age = this.smokeAges[i];
      if (age < 0) {
        this.smokeOpacities[i] = 0;
        this.smokeSizes[i] = 0;
        continue;
      }
      const nextAge = age + dt;
      if (nextAge >= this.smokeLifetimes[i]) {
        this.smokeAges[i] = -1;
        this.smokeOpacities[i] = 0;
        this.smokeSizes[i] = 0;
        continue;
      }
      this.smokeAges[i] = nextAge;
      const fade = 1 - nextAge / this.smokeLifetimes[i];
      const velocity = this.smokeVelocities[i];
      this.smokePositions[i * 3] += velocity.x * dt;
      this.smokePositions[i * 3 + 1] += velocity.y * dt;
      this.smokePositions[i * 3 + 2] += velocity.z * dt;
      velocity.y += 0.3 * dt;
      velocity.x *= Math.exp(-0.22 * dt);
      velocity.z *= Math.exp(-0.22 * dt);
      this.smokeSizes[i] = 0.3 + nextAge * 0.75;
      this.smokeOpacities[i] = this.smokeStrengths[i] * 0.48 * fade;
    }

    const geometry = this.tireSmoke.geometry;
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('aOpacity') as THREE.BufferAttribute).needsUpdate = true;
    this.tireSmoke.visible = this.settings.effects;
  }

  private emitTireSmoke(wheel: 0 | 1, intensity: number): void {
    const index = this.smokeIndex;
    this.smokeIndex = (this.smokeIndex + 1) % DriveEngine.smokeCapacity;
    const position = this.skidCurrentPositions[wheel];
    const side = wheel === 0 ? -1 : 1;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);
    this.smokePositions[index * 3] = position.x + (Math.random() - 0.5) * 0.16;
    this.smokePositions[index * 3 + 1] = position.y + 0.12;
    this.smokePositions[index * 3 + 2] = position.z + (Math.random() - 0.5) * 0.16;
    this.smokeAges[index] = 0;
    this.smokeLifetimes[index] = 1.05 + Math.random() * 0.35;
    this.smokeStrengths[index] = intensity;
    this.smokeVelocities[index].set(
      this.velocity.x * 0.12 - forwardX * (0.18 + Math.random() * 0.35) + rightX * side * (0.12 + Math.random() * 0.2),
      0.42 + Math.random() * 0.35,
      this.velocity.z * 0.12 - forwardZ * (0.18 + Math.random() * 0.35) + rightZ * side * (0.12 + Math.random() * 0.2),
    );
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

  private updateCamera(dt: number): void {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.cameraTarget.set(this.carRoot.position.x, this.carRoot.position.y + 1.05, this.carRoot.position.z);
    const distance = (9.2 + Math.min(3.5, this.velocity.length() * 0.12)) * this.cameraZoom;
    const orbitInput = Number(this.keys.has('arrowright')) - Number(this.keys.has('arrowleft'));
    const elevationInput = Number(this.keys.has('arrowup')) - Number(this.keys.has('arrowdown'));
    this.cameraOrbit = Math.atan2(
      Math.sin(this.cameraOrbit + orbitInput * dt * 1.55),
      Math.cos(this.cameraOrbit + orbitInput * dt * 1.55),
    );
    this.cameraElevation = THREE.MathUtils.clamp(this.cameraElevation + elevationInput * dt * 0.62, 0.12, 0.9);
    const cameraYaw = this.yaw + this.cameraOrbit;
    const horizontalDistance = distance * Math.cos(this.cameraElevation);
    this.cameraDesired.set(
      this.carRoot.position.x - Math.sin(cameraYaw) * horizontalDistance,
      this.cameraTarget.y + distance * Math.sin(this.cameraElevation) + Math.min(1.2, this.velocity.length() * 0.04),
      this.carRoot.position.z - Math.cos(cameraYaw) * horizontalDistance,
    );
    const smoothing = 1 - Math.pow(1 - this.settings.cameraFollow, dt * 60);
    this.camera.position.lerp(this.cameraDesired, smoothing);
    this.camera.lookAt(this.cameraTarget);
  }

  private forwardSpeedKmh(): number {
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    return Math.max(0, this.velocity.dot(this.forward) * ECONOMY.kmhPerUnit);
  }

  private makeTelemetry(): Telemetry {
    const signed = this.velocity.dot(this.forward);
    const speed = Math.abs(signed) * ECONOMY.kmhPerUnit;
    const gearIndex = Math.max(1, this.gear);
    const gearSpeedLimit = this.gear > 0 ? this.vehicle.maxSpeed * GEAR_SPEED[gearIndex] : 36;
    const rpm = Math.round(850 + Math.min(1, speed / Math.max(gearSpeedLimit, 1)) * 6200);
    return { speedKmh: speed, gear: this.gear, rpm, drifting: this.driftValue > 0.2 };
  }

  dispose(): void {
    this.active = false;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('pointerdown', this.onCameraPointerDown, true);
    window.removeEventListener('pointermove', this.onCameraPointerMove, true);
    window.removeEventListener('pointerup', this.onCameraPointerEnd, true);
    window.removeEventListener('pointercancel', this.onCameraPointerEnd, true);
    this.renderer.domElement.removeEventListener('wheel', this.onCameraWheel);
    this.host.removeChild(this.renderer.domElement);
    this.renderer.dispose();
    disposeVehicleVisual(this.visual);
    disposeObject(this.scene);
  }
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
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
