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
  private cameraOrbit = 0;
  private cameraElevation = Math.asin(3.6 / 9.2);
  private cameraZoom = 1;
  private drivingEnabled = false;
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
  private skidIndex = 0;
  private skidCount = 0;
  private skidElapsed = 0;
  private static readonly skidCapacity = 300;
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
    this.scene.add(this.skidMarks);
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
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let longitudinal = this.velocity.dot(this.forward);
    let lateral = this.velocity.dot(this.right);

    if (brake) {
      if (Math.abs(longitudinal) > 0.33) {
        longitudinal = approach(longitudinal, 0, this.vehicle.braking * dt);
      } else {
        this.gear = -1;
        longitudinal = Math.max(-11, longitudinal - this.vehicle.acceleration * 0.42 * dt);
      }
    } else if (gas && this.gear >= 1) {
      const ratio = GEAR_SPEED[this.gear];
      const limit = this.vehicle.maxSpeed / ECONOMY.kmhPerUnit * ratio;
      const torque = GEAR_TORQUE[this.gear];
      longitudinal = Math.min(limit, longitudinal + this.vehicle.acceleration * torque * dt);
    } else if (gas && this.gear === -1) {
      longitudinal = Math.max(-11, longitudinal - this.vehicle.acceleration * 0.48 * dt);
    } else if (this.gear === 0) {
      longitudinal *= Math.exp(-0.85 * dt);
    } else {
      longitudinal *= Math.exp(-0.13 * dt);
    }

    // Apply the throttle/brake change in the car's current direction before
    // steering, then preserve that world-space momentum as the body turns.
    this.velocity.copy(this.forward).multiplyScalar(longitudinal).addScaledVector(this.right, lateral);
    const speed = Math.abs(longitudinal);
    const wantsDrift = handbrake && speed > 5 && Math.abs(steerInput) > 0.05;
    const wheelbase = Math.max(2, this.vehicle.length * 0.58);
    const maxSteeringAngle = Math.min(0.78, this.vehicle.steering * 0.5);
    const steeringYawRate = longitudinal / wheelbase * Math.tan(steerInput * maxSteeringAngle);
    const lateralGrip = this.vehicle.handling * (wantsDrift ? 30 : 40);
    const maxYawRate = Math.min(wantsDrift ? 1.9 : 2.1, lateralGrip / Math.max(speed, 2.5));
    const driftYawRate = wantsDrift ? THREE.MathUtils.clamp(-lateral * 0.12, -0.75, 0.75) : 0;
    const yawRateLimit = Math.min(2.4, maxYawRate * (wantsDrift ? 1.5 : 1));
    this.yaw += THREE.MathUtils.clamp(steeringYawRate + driftYawRate, -yawRateLimit, yawRateLimit) * dt;

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    // Project the old world velocity against the new heading. This lets the
    // body rotate around moving momentum instead of snapping the whole car's
    // velocity to the steering direction.
    longitudinal = this.velocity.dot(this.forward);
    lateral = this.velocity.dot(this.right);
    lateral *= Math.exp(-(wantsDrift ? 0.9 : 9.2 * this.vehicle.handling) * dt);
    const slipAngle = Math.atan2(Math.abs(lateral), Math.max(Math.abs(longitudinal), 1));
    const drifting = wantsDrift && slipAngle > 0.065;
    this.driftValue = drifting ? Math.min(1, this.driftValue + dt * 2.2) : Math.max(0, this.driftValue - dt * 2.8);

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
    this.updateSkids(dt, drifting);
    this.wheelTravel += longitudinal * dt;
    setVehicleWheelSpin(this.visual, this.wheelTravel);
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

  private updateSkids(dt: number, drifting: boolean): void {
    if (!this.settings.effects || !drifting || Math.abs(this.velocity.dot(this.forward)) < 6) {
      this.skidElapsed = 0;
      return;
    }
    this.skidElapsed += dt;
    if (this.skidElapsed < 0.09) return;
    this.skidElapsed = 0;
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const back = -this.vehicle.length * 0.32;
    for (const side of [-1, 1]) {
      this.skidDummy.position.set(
        this.carRoot.position.x + this.forward.x * back + this.right.x * side * this.vehicle.width * 0.32,
        0.024,
        this.carRoot.position.z + this.forward.z * back + this.right.z * side * this.vehicle.width * 0.32,
      );
      this.skidDummy.rotation.set(0, this.yaw, 0);
      this.skidDummy.scale.set(1, 1, 1);
      this.skidDummy.updateMatrix();
      this.skidMarks.setMatrixAt(this.skidIndex, this.skidDummy.matrix);
      this.skidIndex = (this.skidIndex + 1) % DriveEngine.skidCapacity;
      this.skidCount = Math.min(DriveEngine.skidCapacity, this.skidCount + 1);
    }
    this.skidMarks.count = this.skidCount;
    this.skidMarks.instanceMatrix.needsUpdate = true;
  }

  private clearSkids(): void {
    this.skidIndex = 0;
    this.skidCount = 0;
    this.skidElapsed = 0;
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
