import { VEHICLE_SCALE, type VehicleSpec } from './data';
import {
  ROLLING_RESISTANCE,
  aeroDownforceG,
  aeroProfileOf,
  airDragCoefficient,
  driveLayoutOf,
  estimateFrontWeightShare,
  estimateVehicleMassKg,
  type AeroProfile,
  type DriveLayout,
} from './drivetrain';
import { STANCE_PRESETS, cloneStanceConfig, type StanceConfig } from './stancePanel';

// Four-wheel chassis with one tyre model for driving, braking and cornering.
//
// Each tyre (0: FL, 1: FR, 2: RL, 3: RR) carries:
// - A normal load from static weight, longitudinal and lateral load transfer
//   (split front/rear by roll stiffness), aerodynamic downforce and the
//   4-corner suspension contact.
// - Its own wheel speed, driven by engine torque and slowed by the brakes and
//   by the road. Slip ratio (kappa) comes from that wheel speed, slip angle
//   (alpha) from the contact patch velocity in the steered wheel frame.
// - A combined-slip force: kappa and alpha are each scaled by their peak, the
//   length of that slip vector sets the force on the tyre's curve and its
//   direction splits it into drive/brake and cornering force. Spending grip on
//   one leaves less for the other (friction circle) without separate rules.
// - Load sensitivity: a tyre's friction coefficient falls as its load rises,
//   so load transfer costs the axle grip and the roll-stiffness split sets the
//   understeer/oversteer balance.
// ABS and traction control act per wheel on wheel speed, keeping the slip ratio
// at what the tyre can use while it also corners.

const GRAVITY = 9.81;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type TireProfileId = 'street' | 'sport' | 'semi-slick' | 'drift';
export type TireIndex = 0 | 1 | 2 | 3; // 0: FL, 1: FR, 2: RL, 3: RR
export type TireEditTarget = 'all' | 'front' | 'rear' | 'fl' | 'fr' | 'rl' | 'rr';

export interface TireTuningParams {
  frictionCoeff: number;     // Base friction scale (0.5 .. 2.0)
  longStiffness: number;     // Longitudinal initial slope multiplier (0.4 .. 2.5)
  latStiffness: number;      // Lateral cornering stiffness multiplier (0.4 .. 2.5)
  peakSlipAngleDeg: number;  // Slip angle at peak lateral force in degrees (3 .. 18)
  peakSlipRatio: number;     // Slip ratio at peak longitudinal force (0.04 .. 0.35)
  postPeakGrip: number;      // Sliding grip share past the peak (0.40 .. 1.00)
  loadSensitivity: number;   // Friction drop per unit excess load (0.00 .. 0.50)
}

export interface SingleTireTelemetry {
  slipAngleDeg: number;
  slipRatio: number;
  normalLoadN: number;
  longForceN: number;
  latForceN: number;
  gripUtilization: number;
  wheelAngularSpeed: number;
  grounded: boolean;
}

export interface TireDebugState {
  profile: TireProfileId;
  target: TireEditTarget;
  tires: [TireTuningParams, TireTuningParams, TireTuningParams, TireTuningParams];
  telemetry: [SingleTireTelemetry, SingleTireTelemetry, SingleTireTelemetry, SingleTireTelemetry];
}

// frictionCoeff is relative to the car's own tyre grip (the Sport compound = 1).
export const TIRE_PROFILES: Record<TireProfileId, { label: string; front: TireTuningParams; rear: TireTuningParams }> = {
  street: {
    label: 'Street',
    front: { frictionCoeff: 1.18, longStiffness: 1.35, latStiffness: 1.48, peakSlipAngleDeg: 5.4, peakSlipRatio: 0.09, postPeakGrip: 0.80, loadSensitivity: 0.15 },
    rear: { frictionCoeff: 1.18, longStiffness: 1.35, latStiffness: 1.56, peakSlipAngleDeg: 5.2, peakSlipRatio: 0.09, postPeakGrip: 0.58, loadSensitivity: 0.15 },
  },
  sport: {
    label: 'Sport',
    front: { frictionCoeff: 1.38, longStiffness: 1.65, latStiffness: 1.85, peakSlipAngleDeg: 4.5, peakSlipRatio: 0.08, postPeakGrip: 0.85, loadSensitivity: 0.13 },
    rear: { frictionCoeff: 1.38, longStiffness: 1.65, latStiffness: 1.96, peakSlipAngleDeg: 4.3, peakSlipRatio: 0.08, postPeakGrip: 0.54, loadSensitivity: 0.13 },
  },
  'semi-slick': {
    label: 'Semi-Slick',
    front: { frictionCoeff: 1.80, longStiffness: 2.50, latStiffness: 2.50, peakSlipAngleDeg: 3.0, peakSlipRatio: 0.06, postPeakGrip: 1.0, loadSensitivity: 0.10 },
    rear: { frictionCoeff: 1.80, longStiffness: 2.50, latStiffness: 2.50, peakSlipAngleDeg: 3.0, peakSlipRatio: 0.06, postPeakGrip: 1.0, loadSensitivity: 0.10 },
  },
  drift: {
    label: 'Drift Compound',
    front: { frictionCoeff: 1.22, longStiffness: 1.30, latStiffness: 1.60, peakSlipAngleDeg: 5.5, peakSlipRatio: 0.10, postPeakGrip: 0.86, loadSensitivity: 0.15 },
    rear: { frictionCoeff: 0.94, longStiffness: 1.02, latStiffness: 1.12, peakSlipAngleDeg: 7.8, peakSlipRatio: 0.13, postPeakGrip: 0.56, loadSensitivity: 0.19 },
  },
};

const LOAD_TRANSFER_PITCH_TIME = 0.09; // s
const LOAD_TRANSFER_ROLL_TIME = 0.07;  // s
const MIN_ROLLING_SPEED = 1.6;         // m/s, slip angle denominator floor
const SLIP_SPEED_FLOOR = 2.5;          // m/s, slip ratio denominator floor
const KINEMATIC_SPEED = 1.0;           // m/s
const DYNAMIC_SPEED = 3.2;             // m/s
const REFERENCE_WEIGHT = 1450;         // kg
const REAR_STAGGER_PER_BIAS = 1.0;     // rear grip gain per unit of rearward weight bias (0.39 front -> +11%)
const WHEEL_INERTIA = 1.1;             // kg·m², wheel, tyre, brake disc and hub
const FRONT_BRAKE_BIAS = 0.68;
const HANDBRAKE_FORCE_G = 2.4;         // hydraulic rear lock force per rear tyre load
const ABS_SLIP_SHARE = 0.95;           // ABS holds the slip ratio this close to the tyre's peak
const TCS_SLIP_SHARE = 0.95;           // traction control slip target, share of peak
const SUBSTEP = 1 / 240;
// Drift steering assist: smoothed path-bending acceleration (g) when steering into an active slide.
const DRIFT_ASSIST_G = 0.44;
const DRIFT_ASSIST_SLIP = [0.14, 0.32] as const;
const DRIFT_SPIN_DAMP = 5.4;

/**
 * Peak friction coefficient of the car's own tyres (Sport compound).
 * Road cars run 0.9 (eco) to ~1.1 (cup tyres); race cars on slicks ~1.45.
 */
export function baseTireGrip(spec: VehicleSpec): number {
  const id = spec.id.toLowerCase();
  if (
    (id.includes('gt3') && !id.includes('911'))
    || id.includes('vision-gt')
    || id.includes('vgt')
    || id.includes('p1-gtr')
    || id.includes('bmw-m3-gtr')
    || id.includes('acr-x')
  ) {
    return 1.48;
  }
  if (spec.category === 'EKONOMI') {
    return 0.20 + 0.88 * spec.handling;
  }
  const cupTyres = id.includes('911-gt3-rs') || id.includes('m4-gts') || id.includes('one1') || id.includes('imola')
    || id.includes('zonda') || id.includes('valkyrie') || id.includes('s206') || id.includes('clk-gtr');
  return 0.17 + 0.96 * spec.handling + (cupTyres ? 0.07 : 0);
}

/**
 * C1-continuous nonlinear tire force curve:
 * - u = |slip| / peakSlip
 * - For 0 <= u <= 1: rises smoothly to 1.0 at u = 1 with initial slope scaled by `stiffness`.
 * - For u > 1: decays smoothly toward `postPeakGrip` without sudden drop-offs.
 */
export function nonlinearTireResponse(normSlip: number, stiffness: number, postPeakGrip: number): number {
  const u = Math.abs(normSlip);
  if (u <= 0) return 0;
  const k = Math.max(0.35, stiffness);
  if (u <= 1) {
    const shaped = (k * u) / (1 + (k - 1) * u);
    return Math.sin(0.5 * Math.PI * shaped);
  }
  const d = u - 1;
  const slide = Math.min(1, Math.max(0.25, postPeakGrip));
  // Gentle plateau right past peak (u = 1..1.4) keeps limit track cornering forgiving;
  // deeper slides (u > 1.8) decay smoothly to kinetic sliding friction (`postPeakGrip`)
  // so rear tyres genuinely stay loose in a drift instead of snapping back at 90%+ grip.
  const decay = (0.88 * k * d * d * (1 + 0.45 * d)) / (1 + 0.35 * d);
  return slide + (1 - slide) / (1 + decay);
}

export interface ChassisBody {
  velocity: { x: number; z: number };  // m/s, world
  yaw: number;                         // rad; forward is (sin, cos), right is (cos, -sin)
  yawRate: number;                     // rad/s
}

export interface ChassisInput {
  dt: number;
  steer: number;           // front wheel angle (rad), + turns towards the car's right vector (+X)
  grounded: boolean;
  frontDriveForce: number; // N the engine asks of the front tyres (+ forward, engine braking -)
  rearDriveForce: number;  // N the engine asks of the rear tyres
  drivelineMass: number;   // kg of engine inertia seen at the driven tyres (split by drive share)
  rearShare: number;       // 0..1 share of the drive going to the rear axle
  limiterSpeed: number;    // m/s the driven wheels cannot turn faster than in this gear
  brake: number;           // 0..1 foot brake
  lineLock: boolean;       // burnout: the foot brake holds only the undriven axle (fronts on RWD, rears on FWD)
  handbrake: number;       // 0..1 rear wheels locked
  tcs: boolean;            // traction control
  /** Raw driver steering input -1..1 (+ towards the right vector), used by the drift steering assist. */
  steerInput?: number;
  // Optional per-wheel vertical loads (m/s², sum ~ GRAVITY) from 4-corner suspension:
  // [FL, FR, RL, RR]
  wheelSuspensionLoads?: readonly number[];
}

export interface ChassisOutput {
  frontSlip: number;       // rad, average signed slip angle of front axle
  rearSlip: number;        // rad, average signed slip angle of rear axle
  frontSideUse: number;    // 0..1 share of front axle grip spent sideways
  rearSideUse: number;     // 0..1 share of rear axle grip spent sideways
  frontSlide: number;      // 0..1 how far past peak grip the front axle slides
  rearSlide: number;       // 0..1 how far past peak grip the rear axle slides
  frontSpin: number;       // 0..1 front wheelspin under power
  rearSpin: number;        // 0..1 rear wheelspin under power
  frontWheelSpeed: number; // m/s, front tyre surface speed (average)
  rearWheelSpeed: number;  // m/s, rear tyre surface speed (average)
  accelLong: number;       // m/s², body acceleration along the car
  accelLat: number;        // m/s², body acceleration along the right vector (+X)
  tcsActive: boolean;      // traction control holding a driven wheel back
  absActive: boolean;      // ABS releasing a wheel
}

export function emptyChassisOutput(): ChassisOutput {
  return {
    frontSlip: 0, rearSlip: 0, frontSideUse: 0, rearSideUse: 0, frontSlide: 0, rearSlide: 0,
    frontSpin: 0, rearSpin: 0, frontWheelSpeed: 0, rearWheelSpeed: 0, accelLong: 0, accelLat: 0,
    tcsActive: false, absActive: false,
  };
}

function cloneTuning(src: TireTuningParams): TireTuningParams {
  return {
    frictionCoeff: src.frictionCoeff,
    longStiffness: src.longStiffness,
    latStiffness: src.latStiffness,
    peakSlipAngleDeg: src.peakSlipAngleDeg,
    peakSlipRatio: src.peakSlipRatio,
    postPeakGrip: src.postPeakGrip,
    loadSensitivity: src.loadSensitivity,
  };
}

function emptyTelemetry(): SingleTireTelemetry {
  return {
    slipAngleDeg: 0,
    slipRatio: 0,
    normalLoadN: 0,
    longForceN: 0,
    latForceN: 0,
    gripUtilization: 0,
    wheelAngularSpeed: 0,
    grounded: true,
  };
}

export function defaultTireProfileFor(spec: VehicleSpec): TireProfileId {
  return spec.category === 'SUPER' || spec.bodyStyle === 'super' ? 'semi-slick' : 'sport';
}

export class Chassis {
  private massKg = REFERENCE_WEIGHT;
  private baseFrontWeightShare = 0.5;
  // Rear tyre width relative to the front. Rear/mid-engine cars run wider rear tyres
  // (staggered fitment) so the heavier rear axle is not the first to let go.
  private rearStagger = 1;
  private frontWeightShare = 0.5;
  private frontArm = 1.3;     // m, centre of mass to front axle
  private rearArm = 1.3;      // m, centre of mass to rear axle
  private wheelbase = 2.6;    // m
  private baseTrack = 1.5;    // m
  private track = 1.5;        // m
  private baseCgHeight = 0.46;// m
  private cgHeight = 0.46;    // m
  private wheelRadius = 0.34; // m
  private yawInertia = 1.85;  // m² (Izz / m)
  // Body slip angle of the previous steering update and its filtered rate (rad/s),
  // used by the self-steer (caster) model to hold a drift angle when the wheel is released.
  private prevBodyAngle = 0;
  private bodySlipRate = 0;
  private baseMu = 1.0;          // peak friction coefficient of the car's own tyres
  private latGripScale = 1.0;    // lateral cornering grip bonus (keeps 0-100 & braking distances realistic)
  private specBraking = 12;      // m/s², catalog braking rating for the active car
  private brakeDecel = 12;       // m/s² the brake system can ask for (more than the tyres give)
  private airDrag = 0;           // m/s² per (m/s)²
  private frontRollShare = 0.55; // share of lateral load transfer carried by the front axle
  private diffLockRate = 12;     // 1/s, how fast a limited-slip diff evens out the driven wheels
  private driveLayout: DriveLayout = 'RWD';
  private aeroProfile: AeroProfile = { downforceGAt250Kmh: 0.06, maxDownforceG: 0.14, frontAeroShare: 0.45 };
  private readonly stance: StanceConfig = cloneStanceConfig(STANCE_PRESETS.stock.config);
  private pitchShift = 0;     // smoothed longitudinal load transfer share
  private rollShift = 0;      // smoothed lateral load transfer share
  private accelLong = 0;      // m/s², last substep
  private accelLat = 0;       // m/s², last substep
  private rearSlipHeat = 0;   // 0..1 short-term rear tyre slip memory so lifting off gas mid-drift doesn't snap-hook
  private driftAssistCmd = 0; // smoothed -1..1 inward drift assist so key transitions never jerk

  private defaultProfileId: TireProfileId = 'sport';
  private profileId: TireProfileId = 'sport';
  private editTarget: TireEditTarget = 'all';
  // 0: FL (+X, +Z), 1: FR (-X, +Z), 2: RL (+X, -Z), 3: RR (-X, -Z)
  private readonly tires: [TireTuningParams, TireTuningParams, TireTuningParams, TireTuningParams] = [
    cloneTuning(TIRE_PROFILES.sport.front),
    cloneTuning(TIRE_PROFILES.sport.front),
    cloneTuning(TIRE_PROFILES.sport.rear),
    cloneTuning(TIRE_PROFILES.sport.rear),
  ];
  private readonly telemetry: [SingleTireTelemetry, SingleTireTelemetry, SingleTireTelemetry, SingleTireTelemetry] = [
    emptyTelemetry(),
    emptyTelemetry(),
    emptyTelemetry(),
    emptyTelemetry(),
  ];
  private readonly wheelLoads = [0.25, 0.25, 0.25, 0.25];
  private readonly wheelGrounded = [true, true, true, true];
  private readonly wheelSteer = [0, 0, 0, 0];
  private readonly wheelSpeed = [0, 0, 0, 0];   // m/s, tyre surface speed
  private readonly output: ChassisOutput = emptyChassisOutput();

  constructor(spec: VehicleSpec) {
    this.setVehicle(spec);
  }

  get steeringWheelbase(): number { return this.wheelbase; }
  get frontAxle(): number { return this.frontArm; }
  get rearAxle(): number { return this.rearArm; }
  get trackWidth(): number { return this.track; }

  /** Returns live state reference (no allocation) for TireDebugPanel. */
  getDebugState(): TireDebugState {
    return {
      profile: this.profileId,
      target: this.editTarget,
      tires: this.tires,
      telemetry: this.telemetry,
    };
  }

  setEditTarget(target: TireEditTarget): void {
    this.editTarget = target;
  }

  applyProfile(profile: TireProfileId): void {
    this.profileId = profile;
    const preset = TIRE_PROFILES[profile];
    Object.assign(this.tires[0], preset.front);
    Object.assign(this.tires[1], preset.front);
    Object.assign(this.tires[2], preset.rear);
    Object.assign(this.tires[3], preset.rear);
    const maxCompoundMu = Math.max(1, preset.front.frictionCoeff, preset.rear.frictionCoeff);
    this.brakeDecel = Math.max(this.specBraking, 1.25 * GRAVITY * this.baseMu * maxCompoundMu);
  }

  resetTuningToDefault(): void {
    this.editTarget = 'all';
    this.applyProfile(this.defaultProfileId);
  }

  updateTuning(changes: Partial<TireTuningParams>, target: TireEditTarget = this.editTarget): void {
    this.editTarget = target;
    const indices: TireIndex[] =
      target === 'all' ? [0, 1, 2, 3]
      : target === 'front' ? [0, 1]
      : target === 'rear' ? [2, 3]
      : target === 'fl' ? [0]
      : target === 'fr' ? [1]
      : target === 'rl' ? [2]
      : [3];
    for (let i = 0; i < indices.length; i += 1) {
      const tire = this.tires[indices[i]];
      if (changes.frictionCoeff !== undefined) tire.frictionCoeff = clamp(changes.frictionCoeff, 0.4, 2.2);
      if (changes.longStiffness !== undefined) tire.longStiffness = clamp(changes.longStiffness, 0.3, 2.8);
      if (changes.latStiffness !== undefined) tire.latStiffness = clamp(changes.latStiffness, 0.3, 2.8);
      if (changes.peakSlipAngleDeg !== undefined) tire.peakSlipAngleDeg = clamp(changes.peakSlipAngleDeg, 2.0, 20.0);
      if (changes.peakSlipRatio !== undefined) tire.peakSlipRatio = clamp(changes.peakSlipRatio, 0.04, 0.35);
      if (changes.postPeakGrip !== undefined) tire.postPeakGrip = clamp(changes.postPeakGrip, 0.35, 1.0);
      if (changes.loadSensitivity !== undefined) tire.loadSensitivity = clamp(changes.loadSensitivity, 0.0, 0.5);
    }
  }

  /**
   * Front wheel angle that utilizes the front tires' peak cornering force at `speed`.
   * Includes both the kinematic path curvature and the front tire's peak slip angle.
   */
  /** Lateral acceleration (m/s²) the tyres can hold at `speed` (m/s), downforce included. */
  maxLateralAccel(speed: number): number {
    const frontMu = 0.5 * (this.tires[0].frictionCoeff + this.tires[1].frictionCoeff);
    const rearMu = 0.5 * (this.tires[2].frictionCoeff + this.tires[3].frictionCoeff) * this.rearStagger;
    // Aero downforce raises the cornering limit at speed: the steering limit must allow
    // the front tires to use it, otherwise high-downforce cars understeer artificially.
    const aeroGain = 1 + aeroDownforceG(this.aeroProfile, speed);
    return GRAVITY * this.baseMu * this.latGripScale * Math.min(frontMu, rearMu) * aeroGain * 0.96;
  }

  gripSteeringAngle(speed: number): number {
    const v = Math.max(speed, 1);
    const frontPeakRad = 0.5 * (this.tires[0].peakSlipAngleDeg + this.tires[1].peakSlipAngleDeg) * DEG_TO_RAD;
    const maxLatAccel = this.maxLateralAccel(v);
    // Steady-state bicycle kinematics: delta = atan(L * a_max / v^2) + (alpha_F - alpha_R).
    // Keep full front slip-angle reserve through 100-170 km/h (28-47 m/s) so the front tyres
    // hold ~98% peak lateral bite mid-corner instead of dropping off, while bounding lock above
    // 200 km/h (55+ m/s) so high-speed turn-in never out-yaws the rear axle.
    const pathAngle = Math.atan(this.wheelbase * maxLatAccel / (v * v));
    const reserve = frontPeakRad * (0.48 - 0.25 * smoothstep(v, 36, 56));
    const highSpeedRatioCap = 1.72 - 0.52 * smoothstep(v, 45, 55);
    return pathAngle + Math.min(reserve, pathAngle * highSpeedRatioCap);
  }

  /**
   * Computes the front wheel angle for the current frame, respecting:
   * - Low-speed full steering lock
   * - High-speed steady-state cornering stability + crisp turn-in bite
   * - Natural self-aligning torque (caster) and full counter-steering authority in a slide
   */
  updateSteering(
    currentAngle: number,
    steerInput: number,
    longitudinal: number,
    lateral: number,
    yawRate: number,
    handling: number,
    maxLockConfig: number,
    dt: number,
  ): number {
    const lockBonusRad = this.stance.steeringLockBonusDeg * DEG_TO_RAD;
    const fullLock = clamp(maxLockConfig * 0.82 + lockBonusRad, 0.88, 1.18);
    const toeTurnInBoost = clamp(1 - this.stance.frontToeDeg * 0.10, 0.86, 1.22);
    const speed = Math.hypot(longitudinal, lateral);
    const frontPeakRad = 0.5 * (this.tires[0].peakSlipAngleDeg + this.tires[1].peakSlipAngleDeg) * DEG_TO_RAD;

    // Direction the front axle contact patch is travelling relative to the car's nose.
    const safeLong = Math.max(longitudinal, 1.5);
    const frontTravel = speed > 1.8
      ? Math.atan2(lateral + this.frontArm * yawRate, safeLong)
      : 0;
    const bodyAngle = speed > 1.5
      ? Math.atan2(lateral, safeLong)
      : 0;
    // In a tight grip turn the CG velocity points inside the nose purely from geometry
    // (rear axle tracks, CG swings): that is NOT a slide. Only treat the body angle as a
    // drift angle when the rear axle itself is travelling outward in the same direction.
    const rearTravel = speed > 1.8
      ? Math.atan2(lateral - this.rearArm * yawRate, safeLong)
      : 0;
    const rearOutward = Math.sign(rearTravel) === Math.sign(bodyAngle)
      ? smoothstep(Math.abs(rearTravel), 0.04, 0.10)
      : 0;
    const bodySlip = Math.abs(bodyAngle) * rearOutward;
    if (dt > 1e-5) {
      const rawRate = (bodyAngle - this.prevBodyAngle) / dt;
      this.bodySlipRate += (clamp(rawRate, -6, 6) - this.bodySlipRate) * Math.min(1, dt * 18);
    }
    this.prevBodyAngle = bodyAngle;

    const fadeLock = fullLock / (1 + Math.pow(speed / 50, 1.52));
    // Aim the front tyres near their peak slip angle relative to where the front axle is
    // travelling at low-to-medium speed; through 90-165 km/h blend smoothly into gripSteeringAngle
    // with a quick steering rack so turn-in bites immediately without unsettling the rear at 200+ km/h.
    const travelInTurn = frontTravel * Math.sign(steerInput || 1);
    const openLoop = Math.min(fadeLock, this.gripSteeringAngle(speed));
    const peakBite = clamp(travelInTurn + frontPeakRad * 0.96, frontPeakRad * 0.5, fadeLock);
    const closedLoop = smoothstep(speed, 2.5, 5) * (1 - smoothstep(speed, 16, 26));
    const maxGripSteer = speed < 2.5
      ? fadeLock
      : openLoop + (peakBite - openLoop) * closedLoop;
    // Fast, direct rack through 100-165 km/h (~0.14-0.19 s to cornering lock) instead of 0.42 s,
    // calming above 170 km/h so 200+ km/h lane changes settle straight without weaving.
    const steerTime = 0.055 + 0.13 * smoothstep(speed, 12, 45) + 0.18 * smoothstep(speed, 46, 56);
    const gripRate = Math.min(6.2, maxGripSteer / steerTime) * toeTurnInBoost;

    let target: number;
    let rate: number;
    if (Math.abs(steerInput) > 0.05) {
      const yawLimit = this.maxLateralAccel(speed) / Math.max(speed, 1);
      const overYaw = Math.max(0, yawRate * Math.sign(steerInput)) / yawLimit;
      const yawTrim = 1 - smoothstep(speed, 16, 28) * clamp(1.35 * (overYaw - 1.03), 0, 0.72);
      const gripTarget = steerInput * maxGripSteer * yawTrim;
      // In body frame, `bodyAngle < 0` (`lateral < 0`) means the tail is out to the right
      // (a left-hand drift, nose pointed left of velocity). Countersteering is `steerInput < 0`
      // (steering right), which has the SAME sign as `bodyAngle`.
      const oppositeToSlide = bodySlip > 0.04 && Math.sign(steerInput) === Math.sign(bodyAngle);

      if (oppositeToSlide) {
        const counterBlend = smoothstep(speed, 3.0, 7.0) * smoothstep(bodySlip, 0.06, 0.16);
        if (counterBlend > 0.01) {
          // Critically-damped countersteering:
          // - Arrest rotation into the slide (`spinIntoSlide > 0`) promptly without slamming to full lock.
          // - Cap straighten-out angular rate proportional to remaining `bodySlip` (`~1.55 * bodySlip`)
          //   so as the drift angle approaches zero, yawRate tapers to zero with no tank-slapper whip.
          const spinIntoSlide = Math.max(0, -yawRate * steerInput);
          const recoveryRate = Math.max(0, yawRate * steerInput);
          const safeRecovery = 0.14 + 1.55 * bodySlip;
          const excessRecovery = Math.max(0, recoveryRate - safeRecovery);
          const cmdSlip = clamp(
            frontPeakRad * 0.52 + spinIntoSlide * 0.34 - excessRecovery * 0.68,
            -frontPeakRad * 0.55,
            frontPeakRad * 1.0,
          );
          const slideTarget = clamp(frontTravel + steerInput * cmdSlip, -fullLock, fullLock);
          target = gripTarget * (1 - counterBlend) + slideTarget * counterBlend;
          rate = 12.5 * toeTurnInBoost;
        } else {
          target = gripTarget;
          rate = gripRate;
        }
      } else {
        // Steering INTO the turn while sliding: track `frontTravel + steerInput * cmdSlip` all the
        // way through 3rd/4th-gear drift speeds (up to ~180 km/h) so there is no mid-drift wheel
        // snap around 90-115 km/h. Normal grip cornering (< 9° body slip) stays on `gripTarget`.
        const activeSlide = Math.max(
          bodySlip * smoothstep(this.output.rearSlide, 0.05, 0.28),
          this.output.rearSlide * 0.32 * smoothstep(bodySlip, 0.12, 0.22),
        );
        const turnInSlideBlend = smoothstep(speed, 3.5, 8.0) * (1 - smoothstep(speed, 46, 56))
          * smoothstep(activeSlide, 0.12, 0.24);
        if (turnInSlideBlend > 0.01) {
          const spinRateInTurn = Math.max(0, yawRate * steerInput);
          const dampingEngage = smoothstep(bodySlip, 0.28, 0.54);
          const excessYaw = Math.max(0, spinRateInTurn - 1.35) * dampingEngage;
          const angleTaper = 1 - 0.85 * smoothstep(bodySlip, 0.52, 0.84);
          const cmdSlip = clamp(frontPeakRad * 0.95 * angleTaper - excessYaw * 0.30, -frontPeakRad * 0.25, frontPeakRad * 0.95);
          const rawSlideTarget = clamp(frontTravel + steerInput * cmdSlip, -fullLock, fullLock);
          const initAllowance = 1 + 0.85 * (1 - smoothstep(bodySlip, 0.28, 0.54));
          const maxInwardSteer = Math.min(fullLock, maxGripSteer * initAllowance);
          const slideTarget = steerInput > 0
            ? Math.min(rawSlideTarget, maxInwardSteer)
            : Math.max(rawSlideTarget, -maxInwardSteer);
          target = gripTarget * (1 - turnInSlideBlend) + slideTarget * turnInSlideBlend;
          rate = (7.5 + 2.5 * turnInSlideBlend) * toeTurnInBoost;
        } else {
          target = gripTarget;
          rate = gripRate;
        }
      }
    } else {
      // Steering released: return to 0 in normal driving; during an oversteer slide,
      // pneumatic trail / caster self-aligns the front wheels with enough inward bite to balance
      // the sliding rear (~66% grip), so lifting off gas + wheel lets the drift glide smoothly
      // instead of snapping straight or whipping the other way.
      const oversteerSlide = smoothstep(bodySlip, 0.13, 0.26) * smoothstep(speed, 3.5, 8.0);
      const driftHold = 1 - smoothstep(speed, 38, 50);
      const holdBias = -Math.sign(bodyAngle) * frontPeakRad * 0.56 * smoothstep(bodySlip, 0.15, 0.34) * driftHold;
      const casterAlign = frontTravel + holdBias + clamp(this.bodySlipRate * 0.09, -0.14, 0.14);
      target = clamp(casterAlign * oversteerSlide, -fullLock, fullLock);
      rate = 5.2 + 4.2 * oversteerSlide;
    }

    return approach(currentAngle, target, rate * handling * dt);
  }

  setStance(stance: StanceConfig): void {
    Object.assign(this.stance, stance);
    this.applyStanceGeometry();
  }

  private applyStanceGeometry(): void {
    const avgOffsetM = 0.5 * (this.stance.frontOffsetMm + this.stance.rearOffsetMm) * 0.001;
    const avgRideDeltaM = 0.5 * (this.stance.frontRideHeightMm + this.stance.rearRideHeightMm) * 0.001;
    const rakeShift = ((this.stance.rearRideHeightMm - this.stance.frontRideHeightMm) * 0.001 / Math.max(this.wheelbase, 2.0)) * 0.14;
    this.track = Math.max(1.25, this.baseTrack + avgOffsetM * 2);
    this.cgHeight = clamp(this.baseCgHeight + avgRideDeltaM * 0.65, 0.30, 0.64);
    this.frontWeightShare = clamp(this.baseFrontWeightShare + rakeShift, 0.32, 0.68);
    this.rearArm = this.wheelbase * this.frontWeightShare;
    this.frontArm = this.wheelbase * (1 - this.frontWeightShare);
  }

  setVehicle(spec: VehicleSpec): void {
    this.massKg = estimateVehicleMassKg(spec);
    this.baseFrontWeightShare = estimateFrontWeightShare(spec);
    const unscaledLength = spec.length / VEHICLE_SCALE;
    const unscaledWidth = spec.width / VEHICLE_SCALE;
    const unscaledHeight = spec.height / VEHICLE_SCALE;

    this.wheelbase = Math.max(2.1, unscaledLength * 0.58);
    this.baseTrack = Math.max(1.35, unscaledWidth * 0.86);
    this.baseCgHeight = clamp(unscaledHeight * 0.35, 0.38, 0.56);
    this.wheelRadius = clamp(unscaledLength * 0.074, 0.29, 0.38);
    this.applyStanceGeometry();

    this.driveLayout = driveLayoutOf(spec);
    this.aeroProfile = aeroProfileOf(spec);
    const id = spec.id.toLowerCase();
    const inertiaFactor = spec.bodyStyle === 'super' ? 0.85
      : id.includes('911') ? 0.90
      : (spec.bodyStyle === 'sedan' || id.includes('charger') || id.includes('m5')) ? 1.04
      : 0.92;
    this.yawInertia = inertiaFactor * this.frontArm * this.rearArm + 0.075 * this.track * this.track;

    this.baseMu = baseTireGrip(spec);
    this.latGripScale = spec.category === 'SUPER' ? 1.13
      : spec.category === 'PERFORMANS' ? 1.11
      : spec.category === 'SPORT' ? 1.08
      : spec.category === 'SEHIR' ? 1.05
      : 1.0;
    // Brakes strong enough to lock the tyres at any speed; ABS then holds them at the limit.
    this.specBraking = spec.braking;
    this.defaultProfileId = defaultTireProfileFor(spec);
    this.editTarget = 'all';
    this.applyProfile(this.defaultProfileId);
    this.airDrag = airDragCoefficient(spec);
    const rwdStaggerFloor = this.driveLayout === 'RWD' && spec.category !== 'EKONOMI' && spec.category !== 'SEHIR' ? 0.04 : 0;
    this.rearStagger = 1 + Math.max(rwdStaggerFloor, REAR_STAGGER_PER_BIAS * Math.max(0, 0.5 - this.baseFrontWeightShare));
    // Roll stiffness split: keeps positive high-speed stability (rear never lets go before front
    // on lift-off or 250 km/h turn-in) while allowing stronger front bite than before.
    this.frontRollShare = this.driveLayout === 'FWD' ? 0.69 : this.baseFrontWeightShare < 0.46 ? 0.63 : 0.665;
    this.diffLockRate = this.driveLayout === 'RWD' ? 5 : this.driveLayout === 'AWD' ? 4 : 2;
    this.reset();
  }

  reset(): void {
    this.prevBodyAngle = 0;
    this.bodySlipRate = 0;
    this.pitchShift = 0;
    this.rollShift = 0;
    this.accelLong = 0;
    this.accelLat = 0;
    this.rearSlipHeat = 0;
    this.driftAssistCmd = 0;
    Object.assign(this.output, emptyChassisOutput());
    const totalWeightN = this.massKg * GRAVITY;
    for (let i = 0; i < 4; i += 1) {
      const share = (i < 2 ? this.frontWeightShare : 1 - this.frontWeightShare) * 0.5;
      this.wheelLoads[i] = share;
      this.wheelGrounded[i] = true;
      this.wheelSpeed[i] = 0;
      const t = this.telemetry[i];
      t.slipAngleDeg = 0;
      t.slipRatio = 0;
      t.normalLoadN = share * totalWeightN;
      t.longForceN = 0;
      t.latForceN = 0;
      t.gripUtilization = 0;
      t.wheelAngularSpeed = 0;
      t.grounded = true;
    }
  }

  step(body: ChassisBody, input: ChassisInput): ChassisOutput {
    const out = this.output;
    const dt = input.dt;
    if (dt <= 0) return out;
    const m = this.massKg;
    const radius = this.wheelRadius;
    const wheelMass = WHEEL_INERTIA / (radius * radius);
    const rearShare = clamp(input.rearShare, 0, 1);
    const frontDriveMass = input.drivelineMass * (1 - rearShare) * 0.5;
    const rearDriveMass = input.drivelineMass * rearShare * 0.5;
    const frontDrive = input.frontDriveForce * 0.5;
    // Pulling the hydraulic handbrake declutches rear drive so the rear wheels lock cleanly
    // even if the player keeps holding W on entry.
    const handbrakeCut = 1 - smoothstep(input.handbrake, 0.15, 0.45);
    const rearDrive = input.rearDriveForce * 0.5 * handbrakeCut;

    if (!input.grounded) {
      this.stepAirborne(input, dt, wheelMass + frontDriveMass, wheelMass + rearDriveMass);
      return out;
    }

    const currentVx = body.velocity.x * Math.sin(body.yaw) + body.velocity.z * Math.cos(body.yaw);
    const downforceG = aeroDownforceG(this.aeroProfile, Math.max(0, currentVx));
    const frontAero = downforceG * this.aeroProfile.frontAeroShare;
    const rearAero = downforceG * (1 - this.aeroProfile.frontAeroShare);

    // 4-corner suspension: only which tyres touch the road. Its load readings follow the
    // map's height-grid facets (10-20 Hz shake), so they would make grip flicker; the load
    // split stays with this model's load transfer and roll-stiffness split.
    const suspLoads = input.wheelSuspensionLoads;
    for (let i = 0; i < 4; i += 1) this.wheelGrounded[i] = !suspLoads || suspLoads.length !== 4 || suspLoads[i] > 0.05;

    // Ackermann front wheel steering angles + static front/rear toe alignment.
    const steer = input.steer;
    const frontToeRad = (this.stance.frontToeDeg - STANCE_PRESETS.stock.config.frontToeDeg) * DEG_TO_RAD * 0.32;
    const rearToeRad = (this.stance.rearToeDeg - STANCE_PRESETS.stock.config.rearToeDeg) * DEG_TO_RAD * 0.32;
    if (Math.abs(steer) > 1e-4) {
      const tanS = Math.tan(steer);
      // Ackermann: the inside wheel turns tighter than the outside one, most of all at full lock,
      // so both front tyres follow the same tight circle instead of scrubbing (~70% Ackermann).
      const ack = 0.35 * this.track / this.wheelbase;
      this.wheelSteer[0] = Math.atan(tanS / Math.max(0.25, 1 - ack * tanS)) - frontToeRad;
      this.wheelSteer[1] = Math.atan(tanS / Math.max(0.25, 1 + ack * tanS)) + frontToeRad;
    } else {
      this.wheelSteer[0] = -frontToeRad;
      this.wheelSteer[1] = frontToeRad;
    }
    this.wheelSteer[2] = -rearToeRad;
    this.wheelSteer[3] = rearToeRad;

    // Brake force each tyre is asked for (N). The system can lock the tyres even
    // with downforce on them; ABS keeps them turning at the slip they grip best at.
    const brakeDecel = this.brakeDecel * (1 + downforceG);
    const holdFrontOnly = input.lineLock && this.driveLayout !== 'FWD';
    const holdRearOnly = input.lineLock && this.driveLayout === 'FWD';
    const frontBrakeForce = holdRearOnly ? 0 : input.brake * m * brakeDecel * (holdFrontOnly ? 1 : FRONT_BRAKE_BIAS) * 0.5;
    const rearBrakeForce = holdFrontOnly ? 0 : input.brake * m * brakeDecel * (holdRearOnly ? 1 : 1 - FRONT_BRAKE_BIAS) * 0.5;
    const frontCamberLat = camberLatMultiplier(this.stance.frontCamberDeg) * this.latGripScale;
    const rearCamberLat = camberLatMultiplier(this.stance.rearCamberDeg) * this.latGripScale;
    const frontCamberLong = camberLongMultiplier(this.stance.frontCamberDeg);
    const rearCamberLong = camberLongMultiplier(this.stance.rearCamberDeg);

    const halfTrack = this.track * 0.5;
    const weightN = m * GRAVITY;
    const nominalLoad = weightN * 0.25;
    let remaining = dt;
    let maxFrontSlide = 0;
    let maxRearSlide = 0;
    let frontSpin = 0;
    let rearSpin = 0;
    let tcsActive = false;
    let absActive = false;
    let lastFrontSlip = 0;
    let lastRearSlip = 0;
    let lastFrontUse = 0;
    let lastRearUse = 0;

    while (remaining > 1e-6) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      const lastStep = remaining <= 1e-6;

      // Load transfer follows the body's acceleration with a short suspension lag.
      const pitchTarget = clamp((this.accelLong / GRAVITY) * (this.cgHeight / this.wheelbase), -0.12, 0.16);
      this.pitchShift += (pitchTarget - this.pitchShift) * (1 - Math.exp(-h / LOAD_TRANSFER_PITCH_TIME));
      // Positive accelLat (towards +X) rolls the body towards -X and loads the -X tyres (FR, RR).
      const rollTarget = clamp((this.accelLat / GRAVITY) * (this.cgHeight / this.track), -0.5, 0.5);
      this.rollShift += (rollTarget - this.rollShift) * (1 - Math.exp(-h / LOAD_TRANSFER_ROLL_TIME));
      const staticFront = clamp(this.frontWeightShare - this.pitchShift, 0.15, 0.85);
      const frontAxleLoad = staticFront + frontAero;
      const rearAxleLoad = 1 - staticFront + rearAero;
      const frontRoll = clamp(this.rollShift * this.frontRollShare, -0.5 * frontAxleLoad, 0.5 * frontAxleLoad);
      const rearRoll = clamp(this.rollShift * (1 - this.frontRollShare), -0.5 * rearAxleLoad, 0.5 * rearAxleLoad);
      this.wheelLoads[0] = 0.5 * frontAxleLoad - frontRoll;
      this.wheelLoads[1] = 0.5 * frontAxleLoad + frontRoll;
      this.wheelLoads[2] = 0.5 * rearAxleLoad - rearRoll;
      this.wheelLoads[3] = 0.5 * rearAxleLoad + rearRoll;
      // A tyre in the air carries nothing; the others do not pick up its share.
      for (let i = 0; i < 4; i += 1) if (!this.wheelGrounded[i]) this.wheelLoads[i] = 0;

      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const vx = body.velocity.x * sin + body.velocity.z * cos;
      const vy = body.velocity.x * cos - body.velocity.z * sin;
      const speed = Math.hypot(vx, vy);
      const r = body.yawRate;
      const bodySlipAngle = speed > 1.5 ? Math.atan2(Math.abs(vy), Math.max(Math.abs(vx), 0.5)) : 0;
      // Once the driver has deliberately kicked the car past ~19° sideways (e.g. via handbrake),
      // let the rear wheels spin on throttle instead of having TCS choke the drift dead; below 19°
      // TCS retains 100% authority so normal cornering never spins.
      const tcsDriftBypass = smoothstep(bodySlipAngle, 0.33, 0.46);

      // 1. Wheel speeds: engine, brakes and the road's pull, solved implicitly so
      //    stiff tyres stay stable at any speed.
      for (let i = 0; i < 4; i += 1) {
        const isFront = i < 2;
        const tp = this.tires[i];
        this.wheelKinematics(i, vx, vy, r, halfTrack);
        const vLong = kin.vLong;
        const driveForce = isFront ? frontDrive : rearDrive;
        const inertiaMass = wheelMass + (isFront ? frontDriveMass : rearDriveMass);
        const u = this.wheelSpeed[i];
        const load = this.wheelLoads[i];
        if (!this.wheelGrounded[i] || load <= 1e-4) {
          this.wheelSpeed[i] = this.freeWheelSpeed(u, driveForce, isFront ? frontBrakeForce : rearBrakeForce + (isFront ? 0 : input.handbrake * HANDBRAKE_FORCE_G * nominalLoad), inertiaMass, h, input.limiterSpeed);
          continue;
        }
        const fz = load * weightN;
        const heatTrim = isFront ? 1 : 1 - 0.10 * this.rearSlipHeat;
        const mu = this.tireMu(i, fz, nominalLoad) * heatTrim;
        const camberLong = isFront ? frontCamberLong : rearCamberLong;
        const camberLat = isFront ? frontCamberLat : rearCamberLat;
        const alpha = Math.atan2(-kin.vLat, Math.max(Math.abs(vLong), MIN_ROLLING_SPEED));
        const refSpeed = Math.max(Math.abs(vLong), SLIP_SPEED_FLOOR);
        const kappa0 = (u - vLong) / refSpeed;
        combinedTireForce(kappa0, alpha, tp, mu, fz, camberLong, camberLat);
        const fx0 = tire.fx;
        combinedTireForce(kappa0 + 1e-3, alpha, tp, mu, fz, camberLong, camberLat);
        const slope = Math.max((tire.fx - fx0) / 1e-3, 0.05 * mu * fz / Math.max(tp.peakSlipRatio, 0.03));
        const denom = inertiaMass / h + slope / refSpeed;
        const uFree = (inertiaMass * u / h + driveForce - fx0 + slope * (kappa0 + vLong / refSpeed)) / denom;
        let uNew = uFree;

        // Combined slip: the more the tyre corners, the less slip ratio ABS and TCS allow.
        const cornering = Math.min(1, Math.abs(alpha) / Math.max(tp.peakSlipAngleDeg * DEG_TO_RAD, 0.03));
        const brakeForce = isFront ? frontBrakeForce : rearBrakeForce;
        if (brakeForce > 0) {
          uNew = Math.sign(uFree) * Math.max(0, Math.abs(uFree) - brakeForce / denom);
          if (Math.abs(vLong) > 1.5) {
            const absSlip = tp.peakSlipRatio * ABS_SLIP_SHARE * Math.sqrt(Math.max(0.15, 1 - cornering * cornering));
            const floor = vLong - Math.sign(vLong) * absSlip * refSpeed;
            const released = vLong > 0 ? Math.max(uNew, Math.min(uFree, floor)) : Math.min(uNew, Math.max(uFree, floor));
            if (Math.abs(released - uNew) > 0.02) absActive = true;
            uNew = released;
          }
        }
        if (!isFront && input.handbrake > 0) {
          const lockForce = input.handbrake * HANDBRAKE_FORCE_G * fz;
          uNew = Math.sign(uNew) * Math.max(0, Math.abs(uNew) - lockForce / denom);
        }
        const accelerating = (driveForce > 0 && uNew > vLong) || (driveForce < 0 && uNew < vLong && vLong < 0.5);
        if (accelerating && input.tcs && tcsDriftBypass < 0.99) {
          const baseTcsSlip = tp.peakSlipRatio * TCS_SLIP_SHARE * Math.sqrt(Math.max(0.1, 1 - cornering * cornering));
          const tcsSlip = baseTcsSlip + tcsDriftBypass * 1.2;
          const ceiling = vLong + Math.sign(driveForce) * tcsSlip * refSpeed;
          if (driveForce > 0 && uNew > ceiling) {
            if (uNew - ceiling > 0.05) tcsActive = true;
            uNew = ceiling;
          } else if (driveForce < 0 && uNew < ceiling) {
            if (ceiling - uNew > 0.05) tcsActive = true;
            uNew = ceiling;
          }
        }
        if (driveForce * uNew > 0 && Math.abs(uNew) > input.limiterSpeed) uNew = Math.sign(uNew) * input.limiterSpeed;
        this.wheelSpeed[i] = uNew;
      }

      // 2. Limited-slip differential evens out the driven wheels of an axle.
      const diffBlend = 1 - Math.exp(-this.diffLockRate * h);
      if (rearShare < 1 && input.frontDriveForce !== 0) this.lockAxle(0, 1, diffBlend);
      if (rearShare > 0 && input.rearDriveForce !== 0 && input.handbrake <= 0) this.lockAxle(2, 3, diffBlend);

      // 3. Tyre forces from the new wheel speeds.
      let sumFx = 0;
      let sumFy = 0;
      let yawTorque = 0;
      let frontSlipSum = 0;
      let rearSlipSum = 0;
      let frontUseSum = 0;
      let rearUseSum = 0;
      let frontSlideSub = 0;
      let rearSlideSub = 0;
      let frontSpinSub = 0;
      let rearSpinSub = 0;
      for (let i = 0; i < 4; i += 1) {
        const isFront = i < 2;
        const isLeft = (i & 1) === 0;
        const tp = this.tires[i];
        const tel = this.telemetry[i];
        const load = this.wheelLoads[i];
        if (!this.wheelGrounded[i] || load <= 1e-4) {
          if (lastStep) {
            tel.normalLoadN = 0;
            tel.longForceN = 0;
            tel.latForceN = 0;
            tel.gripUtilization = 0;
            tel.wheelAngularSpeed = this.wheelSpeed[i] / radius;
            tel.grounded = false;
          }
          continue;
        }
        this.wheelKinematics(i, vx, vy, r, halfTrack);
        const vLong = kin.vLong;
        const fz = load * weightN;
        const heatTrim = isFront ? 1 : 1 - 0.10 * this.rearSlipHeat;
        const mu = this.tireMu(i, fz, nominalLoad) * heatTrim;
        const peakAngle = Math.max(tp.peakSlipAngleDeg * DEG_TO_RAD, 0.03);
        const alpha = Math.atan2(-kin.vLat, Math.max(Math.abs(vLong), MIN_ROLLING_SPEED));
        const refSpeed = Math.max(Math.abs(vLong), SLIP_SPEED_FLOOR);
        const kappa = (this.wheelSpeed[i] - vLong) / refSpeed;
        combinedTireForce(
          kappa, alpha, tp, mu, fz,
          isFront ? frontCamberLong : rearCamberLong,
          isFront ? frontCamberLat : rearCamberLat,
        );
        const c = kin.cos;
        const s = kin.sin;
        // Wheel frame (forward c,s; lateral -s,c) into the body frame.
        const fxBody = tire.fx * c - tire.fy * s;
        const fyBody = tire.fx * s + tire.fy * c;
        const wx = isLeft ? halfTrack : -halfTrack;
        const wz = isFront ? this.frontArm : -this.rearArm;
        sumFx += fxBody;
        sumFy += fyBody;
        yawTorque += wz * fyBody - wx * fxBody;

        const grip = mu * fz;
        const peakForce = grip * Math.max(
          isFront ? frontCamberLong : rearCamberLong,
          isFront ? frontCamberLat : rearCamberLat,
        );
        const sideUse = peakForce > 1 ? Math.abs(tire.fy) / peakForce : 0;
        const angleSlide = smoothstep(Math.abs(alpha), peakAngle * 1.15, peakAngle * 3.0);
        const lockSlide = smoothstep(-kappa * Math.sign(vLong || 1), tp.peakSlipRatio * 2.5, 0.6);
        const driveForce = isFront ? frontDrive : rearDrive;
        const spin = driveForce !== 0 && Math.sign(driveForce) === Math.sign(kappa)
          ? smoothstep(Math.abs(kappa) / Math.max(tp.peakSlipRatio, 0.03), 1.6, 4.5)
          : 0;
        const wheelSlide = Math.max(angleSlide, spin * 0.65, lockSlide * 0.85);
        if (isFront) {
          frontSlipSum += alpha * 0.5;
          frontUseSum += sideUse * 0.5;
          frontSlideSub = Math.max(frontSlideSub, wheelSlide);
          frontSpinSub = Math.max(frontSpinSub, spin);
        } else {
          rearSlipSum += alpha * 0.5;
          rearUseSum += sideUse * 0.5;
          rearSlideSub = Math.max(rearSlideSub, wheelSlide);
          rearSpinSub = Math.max(rearSpinSub, spin);
        }
        if (lastStep) {
          tel.slipAngleDeg = alpha * RAD_TO_DEG;
          tel.slipRatio = kappa;
          tel.normalLoadN = fz;
          tel.longForceN = tire.fx;
          tel.latForceN = tire.fy;
          tel.gripUtilization = peakForce > 1 ? Math.min(1, Math.hypot(tire.fx, tire.fy) / peakForce) : 0;
          tel.wheelAngularSpeed = this.wheelSpeed[i] / radius;
          tel.grounded = true;
        }
      }

      // Short-term rear slip/thermal memory: builds quickly when rear tyres spin or slide, decays
      // over ~0.45 s so lifting off the throttle mid-drift glides smoothly instead of snap-hooking.
      const heatTarget = clamp(Math.max(rearSlideSub, rearSpinSub), 0, 1);
      const heatTau = heatTarget > this.rearSlipHeat ? 0.06 : 0.45;
      this.rearSlipHeat += (heatTarget - this.rearSlipHeat) * (1 - Math.exp(-h / heatTau));

      // 4. Body motion: tyre forces, air drag and rolling resistance.
      let totalAx = sumFx / m - this.airDrag * vx * speed;
      let totalAy = sumFy / m - this.airDrag * vy * speed;
      if (Math.abs(vx) > 0.05) totalAx -= Math.sign(vx) * ROLLING_RESISTANCE;
      // Brakes and rolling resistance stop the car; they never push it back the other way.
      const nextVx = vx + totalAx * h;
      const pushing = input.frontDriveForce !== 0 || input.rearDriveForce !== 0;
      if (vx * nextVx < 0 && (input.brake > 0 || input.handbrake > 0 || !pushing)) totalAx = -vx / h;
      let yawAccel = yawTorque / m / this.yawInertia;

      // Drift steering assist: check against actual drift side (`-vy`, NOT `yawRate` which flips
      // sign during countersteer recovery!) and smooth the command so transitions never snap.
      const steerIn = input.steerInput ?? 0;
      const intoDrift = speed > 4 && Math.abs(vy) > 0.4 && steerIn * (-vy) > 0 && steerIn * r > -0.15;
      const rawAssist = intoDrift
        ? steerIn
          * smoothstep(bodySlipAngle, DRIFT_ASSIST_SLIP[0], DRIFT_ASSIST_SLIP[1])
          * smoothstep(speed, 5, 9)
        : 0;
      this.driftAssistCmd += (rawAssist - this.driftAssistCmd) * (1 - Math.exp(-h / 0.075));
      if (Math.abs(this.driftAssistCmd) > 1e-3 && speed > 2) {
        const assist = DRIFT_ASSIST_G * GRAVITY * this.driftAssistCmd;
        totalAx += assist * (-vy / speed);
        totalAy += assist * (vx / speed);
        yawAccel -= Math.sign(r) * smoothstep(bodySlipAngle, 0.62, 0.90) * DRIFT_SPIN_DAMP * Math.abs(r) * Math.abs(this.driftAssistCmd);
      }

      // Low-speed kinematic blend so parking and stop-and-go never jitter.
      const dynamic = smoothstep(speed, KINEMATIC_SPEED, DYNAMIC_SPEED);
      if (dynamic < 1) {
        const kinematicYawRate = (vx / this.wheelbase) * Math.tan(steer);
        const settle = Math.min(1, 25 * h);
        yawAccel = yawAccel * dynamic + ((kinematicYawRate - r) * settle / h) * (1 - dynamic);
        totalAy = totalAy * dynamic + ((this.rearArm * r - vy) * settle / h) * (1 - dynamic);
      }

      body.velocity.x += (sin * totalAx + cos * totalAy) * h;
      body.velocity.z += (cos * totalAx - sin * totalAy) * h;
      body.yawRate += yawAccel * h;
      body.yaw += body.yawRate * h;
      this.accelLong = totalAx;
      this.accelLat = totalAy;

      maxFrontSlide = Math.max(maxFrontSlide, frontSlideSub * dynamic);
      maxRearSlide = Math.max(maxRearSlide, rearSlideSub * dynamic);
      frontSpin = Math.max(frontSpin, frontSpinSub);
      rearSpin = Math.max(rearSpin, rearSpinSub);
      lastFrontSlip = frontSlipSum;
      lastRearSlip = rearSlipSum;
      lastFrontUse = frontUseSum;
      lastRearUse = rearUseSum;
    }

    out.frontSlip = lastFrontSlip;
    out.rearSlip = lastRearSlip;
    out.frontSideUse = clamp(lastFrontUse, 0, 1);
    out.rearSideUse = clamp(lastRearUse, 0, 1);
    out.frontSlide = maxFrontSlide;
    out.rearSlide = maxRearSlide;
    out.frontSpin = frontSpin;
    out.rearSpin = input.handbrake > 0.5 ? 0 : rearSpin;
    out.frontWheelSpeed = 0.5 * (this.wheelSpeed[0] + this.wheelSpeed[1]);
    out.rearWheelSpeed = 0.5 * (this.wheelSpeed[2] + this.wheelSpeed[3]);
    out.accelLong = this.accelLong;
    out.accelLat = this.accelLat;
    out.tcsActive = tcsActive;
    out.absActive = absActive;
    return out;
  }

  /** In the air the tyres push on nothing: engine spins the driven wheels, brakes stop them. */
  private stepAirborne(input: ChassisInput, dt: number, frontMass: number, rearMass: number): void {
    const out = this.output;
    const weightN = this.massKg * GRAVITY;
    for (let i = 0; i < 4; i += 1) {
      const isFront = i < 2;
      const drive = (isFront ? input.frontDriveForce : input.rearDriveForce) * 0.5;
      const held = !input.lineLock || (isFront ? this.driveLayout !== 'FWD' : this.driveLayout === 'FWD');
      const brake = (held ? input.brake * this.massKg * this.brakeDecel * 0.5 * (isFront ? FRONT_BRAKE_BIAS : 1 - FRONT_BRAKE_BIAS) : 0)
        + (isFront ? 0 : input.handbrake * HANDBRAKE_FORCE_G * weightN * 0.25);
      this.wheelSpeed[i] = this.freeWheelSpeed(this.wheelSpeed[i], drive, brake, isFront ? frontMass : rearMass, dt, input.limiterSpeed);
      const t = this.telemetry[i];
      t.normalLoadN = 0;
      t.longForceN = 0;
      t.latForceN = 0;
      t.gripUtilization = 0;
      t.wheelAngularSpeed = this.wheelSpeed[i] / this.wheelRadius;
      t.grounded = false;
    }
    out.frontSideUse = 0;
    out.rearSideUse = 0;
    out.frontSlide = 0;
    out.rearSlide = 0;
    out.frontSpin = 0;
    out.rearSpin = 0;
    out.frontWheelSpeed = 0.5 * (this.wheelSpeed[0] + this.wheelSpeed[1]);
    out.rearWheelSpeed = 0.5 * (this.wheelSpeed[2] + this.wheelSpeed[3]);
    out.accelLong = 0;
    out.accelLat = 0;
    out.tcsActive = false;
    out.absActive = false;
    this.accelLong = 0;
    this.accelLat = 0;
  }

  /** A wheel off the ground: only the engine and the brakes act on it. */
  private freeWheelSpeed(u: number, drive: number, brake: number, mass: number, dt: number, limiter: number): number {
    let next = u + (drive / mass) * dt;
    next = Math.sign(next) * Math.max(0, Math.abs(next) - (brake / mass) * dt);
    if (drive * next > 0 && Math.abs(next) > limiter) next = Math.sign(next) * limiter;
    return next;
  }

  private lockAxle(left: number, right: number, blend: number): void {
    const mean = 0.5 * (this.wheelSpeed[left] + this.wheelSpeed[right]);
    this.wheelSpeed[left] += (mean - this.wheelSpeed[left]) * blend;
    this.wheelSpeed[right] += (mean - this.wheelSpeed[right]) * blend;
  }

  /** Peak friction coefficient of tyre `i` under load `fz` (N). */
  private tireMu(i: number, fz: number, nominalLoad: number): number {
    const tp = this.tires[i];
    // Load sensitivity: a tyre grips less per newton the harder it is pressed down.
    const loadSens = clamp(1 - tp.loadSensitivity * (fz / nominalLoad - 1), 0.7, 1.1);
    return this.baseMu * tp.frictionCoeff * (i < 2 ? 1 : this.rearStagger) * loadSens;
  }

  /** Contact patch velocity of wheel `i` in its own steered frame (writes `kin`). */
  private wheelKinematics(i: number, vx: number, vy: number, r: number, halfTrack: number): void {
    const wx = (i & 1) === 0 ? halfTrack : -halfTrack;
    const wz = i < 2 ? this.frontArm : -this.rearArm;
    const vxi = vx - r * wx;
    const vyi = vy + r * wz;
    const delta = this.wheelSteer[i];
    const c = Math.cos(delta);
    const s = Math.sin(delta);
    kin.cos = c;
    kin.sin = s;
    kin.vLong = vxi * c + vyi * s;
    kin.vLat = -vxi * s + vyi * c;
  }
}

const kin = { vLong: 0, vLat: 0, cos: 1, sin: 0 };
const tire = { fx: 0, fy: 0 };

/**
 * Combined-slip tyre force (writes `tire`, N in the wheel frame). Slip ratio and
 * slip angle are each scaled by their peak; the length of that slip vector picks
 * the force on the tyre curve and its direction splits it between drive/brake
 * (fx) and cornering (fy). The sum never exceeds mu * fz.
 */
function combinedTireForce(
  kappa: number,
  alpha: number,
  tp: TireTuningParams,
  mu: number,
  fz: number,
  camberLong: number,
  camberLat: number,
): void {
  const sx = kappa / Math.max(tp.peakSlipRatio, 0.03);
  const sy = alpha / Math.max(tp.peakSlipAngleDeg * DEG_TO_RAD, 0.03);
  const rho = Math.hypot(sx, sy);
  if (rho < 1e-9) {
    tire.fx = 0;
    tire.fy = 0;
    return;
  }
  const wLong = (sx * sx) / (rho * rho);
  const wLat = 1 - wLong;
  const stiffness = wLong * tp.longStiffness + wLat * tp.latStiffness;
  const force = mu * fz * nonlinearTireResponse(rho, stiffness, tp.postPeakGrip) * (wLong * camberLong + wLat * camberLat);
  tire.fx = force * sx / rho;
  tire.fy = force * sy / rho;
}

function camberLatMultiplier(camberDeg: number): number {
  // Optimal cornering camber is ~ -2.8° (+1% lateral bite vs stock -1.2°),
  // whereas extreme stance camber (-8°..-12°) narrows contact patch (~0.84x).
  const diff = camberDeg + 2.8;
  return clamp(1.009 - 0.0034 * diff * diff, 0.82, 1.015);
}

function camberLongMultiplier(camberDeg: number): number {
  // Straight-line traction is highest near -1.0°..0°, dropping at extreme camber.
  const diff = camberDeg + 1.0;
  return clamp(1.002 - 0.0016 * diff * diff, 0.82, 1.002);
}

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
}
