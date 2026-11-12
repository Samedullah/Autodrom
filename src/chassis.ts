import { VEHICLE_SCALE, type VehicleSpec } from './data';
import {
  aeroDownforceG,
  aeroProfileOf,
  driveLayoutOf,
  estimateFrontWeightShare,
  estimateVehicleMassKg,
  type AeroProfile,
  type DriveLayout,
} from './drivetrain';
import { STANCE_PRESETS, cloneStanceConfig, type StanceConfig } from './stancePanel';

// Four-wheel independent tire & chassis dynamics model.
//
// Each of the 4 tires (0: FL, 1: FR, 2: RL, 3: RR) computes:
// - Normal load (N) from static weight distribution, longitudinal pitch transfer,
//   lateral roll transfer, and 4-corner suspension contact/compression.
// - Contact patch velocity in the wheel's steered frame, including body yaw rate
//   (vx_i = vx - r * x_i, vy_i = vy + r * z_i).
// - Longitudinal slip ratio (kappa) and lateral slip angle (alpha).
// - Nonlinear tire force response (smooth rise controlled by stiffness, peak at
//   peakSlip, gradual decay toward postPeakGrip).
// - Combined slip / friction ellipse coupling longitudinal and lateral forces.
// - Load sensitivity reducing effective friction coefficient at high vertical load.

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

export const TIRE_PROFILES: Record<TireProfileId, { label: string; front: TireTuningParams; rear: TireTuningParams }> = {
  street: {
    label: 'Street',
    front: {
      frictionCoeff: 1.00,
      longStiffness: 0.95,
      latStiffness: 0.96,
      peakSlipAngleDeg: 8.5,
      peakSlipRatio: 0.13,
      postPeakGrip: 0.80,
      loadSensitivity: 0.24,
    },
    rear: {
      frictionCoeff: 1.00,
      longStiffness: 0.95,
      latStiffness: 0.98,
      peakSlipAngleDeg: 8.2,
      peakSlipRatio: 0.13,
      postPeakGrip: 0.82,
      loadSensitivity: 0.24,
    },
  },
  sport: {
    label: 'Sport',
    front: {
      frictionCoeff: 1.12,
      longStiffness: 1.10,
      latStiffness: 1.15,
      peakSlipAngleDeg: 7.8,
      peakSlipRatio: 0.12,
      postPeakGrip: 0.82,
      loadSensitivity: 0.21,
    },
    rear: {
      frictionCoeff: 1.12,
      longStiffness: 1.10,
      latStiffness: 1.16,
      peakSlipAngleDeg: 7.6,
      peakSlipRatio: 0.12,
      postPeakGrip: 0.84,
      loadSensitivity: 0.21,
    },
  },
  'semi-slick': {
    label: 'Semi-Slick',
    front: {
      frictionCoeff: 1.28,
      longStiffness: 1.35,
      latStiffness: 1.40,
      peakSlipAngleDeg: 6.5,
      peakSlipRatio: 0.10,
      postPeakGrip: 0.75,
      loadSensitivity: 0.17,
    },
    rear: {
      frictionCoeff: 1.28,
      longStiffness: 1.35,
      latStiffness: 1.42,
      peakSlipAngleDeg: 6.4,
      peakSlipRatio: 0.10,
      postPeakGrip: 0.77,
      loadSensitivity: 0.17,
    },
  },
  drift: {
    label: 'Drift Compound',
    front: {
      frictionCoeff: 0.98,
      longStiffness: 1.02,
      latStiffness: 1.08,
      peakSlipAngleDeg: 8.8,
      peakSlipRatio: 0.13,
      postPeakGrip: 0.86,
      loadSensitivity: 0.21,
    },
    rear: {
      frictionCoeff: 0.95,
      longStiffness: 0.94,
      latStiffness: 0.98,
      peakSlipAngleDeg: 9.4,
      peakSlipRatio: 0.14,
      postPeakGrip: 0.88,
      loadSensitivity: 0.22,
    },
  },
};

// Base lateral grip in g before vehicle handling and tire profile scaling.
const GRIP_LATERAL_G = 1.36;
const LOAD_TRANSFER_PITCH_TIME = 0.09; // s
const LOAD_TRANSFER_ROLL_TIME = 0.07;  // s
const MIN_ROLLING_SPEED = 1.6;         // m/s
const KINEMATIC_SPEED = 1.0;           // m/s
const DYNAMIC_SPEED = 3.2;             // m/s
const REFERENCE_WEIGHT = 1450;         // kg
const MASS_SENSITIVITY = 0.10;
const SUBSTEP = 1 / 240;

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
  return slide + (1 - slide) / (1 + 1.35 * k * d * d);
}

export interface ChassisBody {
  velocity: { x: number; z: number };  // m/s, world
  yaw: number;                         // rad; forward is (sin, cos), right is (cos, -sin)
  yawRate: number;                     // rad/s
}

export interface ChassisInput {
  dt: number;
  steer: number;          // front wheel angle (rad), + turns towards the car's right vector (+X)
  grounded: boolean;
  accelLong: number;      // measured m/s² along the car: longitudinal weight transfer
  accelLat?: number;      // measured m/s² across the car: lateral weight transfer
  frontLongUse: number;   // share of front axle grip spent driving
  rearLongUse: number;    // share of rear axle grip spent driving
  frontSpin: number;      // 0..1 driven front wheels spinning
  rearSpin: number;       // 0..1 driven rear wheels spinning
  frontSlipSpeed: number; // front wheel surface speed minus road speed (m/s)
  rearSlipSpeed: number;  // rear wheel surface speed minus road speed (m/s)
  rearLock: number;       // 0..1 handbrake: rear wheels locked
  braking: number;        // foot brake deceleration asked for (m/s²), 0 when off
  drivenTraction: number; // m/s² the driven axles pass to the road
  // Optional per-wheel vertical loads (m/s², sum ~ GRAVITY) from 4-corner suspension:
  // [FL, FR, RL, RR]
  wheelSuspensionLoads?: readonly number[];
}

export interface ChassisOutput {
  frontSlip: number;      // rad, average signed slip angle of front axle
  rearSlip: number;       // rad, average signed slip angle of rear axle
  frontSideUse: number;   // 0..1 share of front axle grip spent sideways
  rearSideUse: number;    // 0..1 share of rear axle grip spent sideways
  frontSlide: number;     // 0..1 how far past peak grip the front axle slides
  rearSlide: number;      // 0..1 how far past peak grip the rear axle slides
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

export class Chassis {
  private massKg = REFERENCE_WEIGHT;
  private baseFrontWeightShare = 0.5;
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
  private baseGrip = GRIP_LATERAL_G * GRAVITY;
  private brakeGrip = 1.25 * GRAVITY;
  private diffLock = 0.55;
  private driveLayout: DriveLayout = 'RWD';
  private aeroProfile: AeroProfile = { downforceGAt250Kmh: 0.25, maxDownforceG: 0.48, frontAeroShare: 0.45 };
  private readonly stance: StanceConfig = cloneStanceConfig(STANCE_PRESETS.stock.config);
  private pitchShift = 0;     // smoothed longitudinal load transfer share
  private rollShift = 0;      // smoothed lateral load transfer share

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
  private readonly output: ChassisOutput = {
    frontSlip: 0,
    rearSlip: 0,
    frontSideUse: 0,
    rearSideUse: 0,
    frontSlide: 0,
    rearSlide: 0,
  };

  constructor(spec: VehicleSpec) {
    this.setVehicle(spec);
  }

  get steeringWheelbase(): number { return this.wheelbase; }
  get frontAxle(): number { return this.frontArm; }
  get rearAxle(): number { return this.rearArm; }
  get trackWidth(): number { return this.track; }

  /** Average front friction multiplier relative to default Sport profile (for Drivetrain). */
  get frontFrictionMultiplier(): number {
    const base = (this.tires[0].frictionCoeff + this.tires[1].frictionCoeff) / (2 * TIRE_PROFILES.sport.front.frictionCoeff);
    return base * camberLongMultiplier(this.stance.frontCamberDeg);
  }

  /** Average rear friction multiplier relative to default Sport profile (for Drivetrain). */
  get rearFrictionMultiplier(): number {
    const base = (this.tires[2].frictionCoeff + this.tires[3].frictionCoeff) / (2 * TIRE_PROFILES.sport.rear.frictionCoeff);
    return base * camberLongMultiplier(this.stance.rearCamberDeg);
  }

  get frontPeakSlipRatio(): number {
    return 0.5 * (this.tires[0].peakSlipRatio + this.tires[1].peakSlipRatio);
  }

  get rearPeakSlipRatio(): number {
    return 0.5 * (this.tires[2].peakSlipRatio + this.tires[3].peakSlipRatio);
  }

  get frontPostPeakGrip(): number {
    return 0.5 * (this.tires[0].postPeakGrip + this.tires[1].postPeakGrip);
  }

  get rearPostPeakGrip(): number {
    return 0.5 * (this.tires[2].postPeakGrip + this.tires[3].postPeakGrip);
  }

  get frontLongStiffness(): number {
    return 0.5 * (this.tires[0].longStiffness + this.tires[1].longStiffness);
  }

  get rearLongStiffness(): number {
    return 0.5 * (this.tires[2].longStiffness + this.tires[3].longStiffness);
  }

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
  }

  resetTuningToDefault(): void {
    this.editTarget = 'all';
    this.applyProfile('sport');
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
      if (changes.peakSlipAngleDeg !== undefined) tire.peakSlipAngleDeg = clamp(changes.peakSlipAngleDeg, 3.0, 20.0);
      if (changes.peakSlipRatio !== undefined) tire.peakSlipRatio = clamp(changes.peakSlipRatio, 0.04, 0.35);
      if (changes.postPeakGrip !== undefined) tire.postPeakGrip = clamp(changes.postPeakGrip, 0.35, 1.0);
      if (changes.loadSensitivity !== undefined) tire.loadSensitivity = clamp(changes.loadSensitivity, 0.0, 0.5);
    }
  }

  /**
   * Front wheel angle that utilizes the front tires' peak cornering force at `speed`.
   * Includes both the kinematic path curvature and the front tire's peak slip angle.
   */
  gripSteeringAngle(speed: number): number {
    const v = Math.max(speed, 1);
    // Steady-state bicycle kinematics: delta = atan(L * a_max / v^2) + (alpha_F - alpha_R).
    // At the cornering limit, alpha_F ~ 0.95 * peak and alpha_R ~ 0.67 * peak,
    // so the understeer slip-angle reserve (alpha_F - alpha_R) is ~0.28 * frontPeakRad.
    const FRONT_BALANCE = 0.93;
    const frontPeakRad = 0.5 * (this.tires[0].peakSlipAngleDeg + this.tires[1].peakSlipAngleDeg) * DEG_TO_RAD;
    const frontMu = 0.5 * (this.tires[0].frictionCoeff + this.tires[1].frictionCoeff) * FRONT_BALANCE;
    const rearMu = 0.5 * (this.tires[2].frictionCoeff + this.tires[3].frictionCoeff) * 0.95;
    const maxLatAccel = this.baseGrip * Math.min(frontMu, rearMu);
    return Math.atan(this.wheelbase * maxLatAccel / (v * v)) + frontPeakRad * 0.28;
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

    const fadeLock = fullLock / (1 + Math.pow(speed / 45, 1.55));
    const maxGripSteer = Math.min(fadeLock, this.gripSteeringAngle(speed));

    let target: number;
    let rate: number;
    if (Math.abs(steerInput) > 0.05) {
      const gripTarget = steerInput * maxGripSteer;
      // In body frame, `bodyAngle < 0` (`lateral < 0`) means the tail is out to the right
      // (a left-hand drift, nose pointed left of velocity). Countersteering is `steerInput < 0`
      // (steering right), which has the SAME sign as `bodyAngle`.
      const oppositeToSlide = bodySlip > 0.04 && Math.sign(steerInput) === Math.sign(bodyAngle);

      if (oppositeToSlide) {
        const counterBlend = smoothstep(speed, 3.0, 7.0) * smoothstep(bodySlip, 0.04, 0.11);
        if (counterBlend > 0.01) {
          // Countersteering:
          // - When yawRate is rotating INTO the slide (`spinIntoSlide > 0`), apply strong
          //   opposing slip angle to arrest rotation immediately.
          // - When yawRate is rotating OUT of the slide (`recoveryRate > 0`), maintain active
          //   countersteer slip angle (`cmdSlip`) so drift angle progressively decreases at
          //   ~45-65 deg/s, only damping if recoveryRate exceeds a safe straighten-out rate.
          const spinIntoSlide = Math.max(0, -yawRate * steerInput);
          const recoveryRate = Math.max(0, yawRate * steerInput);
          const excessRecovery = Math.max(0, recoveryRate - 0.62);
          const cmdSlip = Math.max(-frontPeakRad * 0.45, frontPeakRad * 0.52 + spinIntoSlide * 0.26 - excessRecovery * 0.55);
          const slideTarget = clamp(frontTravel + steerInput * cmdSlip, -fullLock, fullLock);
          target = gripTarget * (1 - counterBlend) + slideTarget * counterBlend;
          rate = 18.0 * toeTurnInBoost;
        } else {
          target = gripTarget;
          rate = 5.2 * toeTurnInBoost;
        }
      } else {
        // Steering INTO the turn (initiating a drift or widening an existing drift):
        // When the rear axle is broken loose (handbrake or power oversteer) or the body is
        // sliding, track `frontTravel + steerInput * cmdSlip` so the front tires maintain
        // optimal peak turn-in bite (`~8°` slip angle) during initiation, and then damp
        // against excessive yawRate/bodySlip so holding turn-in widens the angle controllably.
        const activeSlide = Math.max(bodySlip, this.output.rearSlide * 0.35);
        const turnInSlideBlend = smoothstep(speed, 3.5, 8.0) * smoothstep(activeSlide, 0.08, 0.20);
        if (turnInSlideBlend > 0.01) {
          const spinRateInTurn = Math.max(0, yawRate * steerInput);
          const dampingEngage = smoothstep(bodySlip, 0.32, 0.58);
          const excessYaw = Math.max(0, spinRateInTurn - 1.85) * dampingEngage;
          const angleTaper = 1 - 0.50 * smoothstep(bodySlip, 0.60, 0.95);
          const cmdSlip = frontPeakRad * 1.15 * angleTaper - excessYaw * 0.22;
          const rawSlideTarget = clamp(frontTravel + steerInput * cmdSlip, -fullLock, fullLock);
          // Once bodySlip is established (> 20°), cap inward steering to maxGripSteer in
          // the turn direction; during initial breakaway (< 20°), allow up to 1.65 * maxGripSteer
          // so the front tires can reach full peak slip angle while yawRate builds.
          const initAllowance = 1 + 0.80 * (1 - smoothstep(bodySlip, 0.26, 0.50));
          const maxInwardSteer = Math.min(fullLock, maxGripSteer * initAllowance);
          const slideTarget = steerInput > 0
            ? Math.min(rawSlideTarget, maxInwardSteer)
            : Math.max(rawSlideTarget, -maxInwardSteer);
          target = gripTarget * (1 - turnInSlideBlend) + slideTarget * turnInSlideBlend;
          rate = (7.2 + 2.5 * turnInSlideBlend) * toeTurnInBoost;
        } else {
          target = gripTarget;
          rate = 5.2 * toeTurnInBoost;
        }
      }
    } else {
      // Steering released: return to 0 in normal driving; during an oversteer slide,
      // pneumatic trail / caster self-aligns the front wheels toward zero front slip angle
      // (`frontTravel`) so the front tires stop pulling the nose deeper into the spin.
      const oversteerSlide = smoothstep(bodySlip, 0.09, 0.22) * smoothstep(speed, 3.5, 8.0);
      // Self-steer settles slightly toward the turn so the front axle carries its share of the
      // cornering force (moment balance with the sliding rear) instead of zero force, and
      // resists changes of the slip angle: the drift holds on throttle, ends when grip returns.
      const holdBias = -Math.sign(bodyAngle) * frontPeakRad * 0.34 * smoothstep(bodySlip, 0.12, 0.30);
      const casterAlign = frontTravel + holdBias + this.bodySlipRate * 0.14;
      target = clamp(casterAlign * oversteerSlide, -fullLock, fullLock);
      rate = 5.2 + 5.0 * oversteerSlide;
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
    const inertiaFactor = spec.bodyStyle === 'super' ? 0.90
      : id.includes('911') ? 0.95
      : (spec.bodyStyle === 'sedan' || id.includes('charger') || id.includes('m5')) ? 1.12
      : 1.00;
    this.yawInertia = inertiaFactor * this.frontArm * this.rearArm + 0.08 * this.track * this.track;

    const massFactor = clamp(Math.pow(REFERENCE_WEIGHT / this.massKg, MASS_SENSITIVITY), 0.91, 1.07);
    this.baseGrip = (GRIP_LATERAL_G + 0.24 * spec.handling) * GRAVITY * massFactor;
    this.brakeGrip = (1.10 + 0.25 * spec.handling) * GRAVITY;
    this.diffLock = this.driveLayout === 'RWD' ? 0.62 : this.driveLayout === 'AWD' ? 0.45 : 0.18;
  }

  reset(): void {
    this.prevBodyAngle = 0;
    this.bodySlipRate = 0;
    this.pitchShift = 0;
    this.rollShift = 0;
    this.output.frontSlip = 0;
    this.output.rearSlip = 0;
    this.output.frontSideUse = 0;
    this.output.rearSideUse = 0;
    this.output.frontSlide = 0;
    this.output.rearSlide = 0;
    const totalWeightN = this.massKg * GRAVITY;
    for (let i = 0; i < 4; i += 1) {
      const share = (i < 2 ? this.frontWeightShare : 1 - this.frontWeightShare) * 0.5;
      this.wheelLoads[i] = share;
      this.wheelGrounded[i] = true;
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

    // 1. Dynamic longitudinal & lateral weight transfer (as share of total vehicle weight).
    const tractiveLong = input.braking > 0 ? -input.braking * 0.65 : input.drivenTraction;
    const effAccelLong = 0.72 * tractiveLong + 0.28 * input.accelLong;
    const pitchTarget = clamp((effAccelLong / GRAVITY) * (this.cgHeight / this.wheelbase), -0.09, 0.13);
    this.pitchShift += (pitchTarget - this.pitchShift) * (1 - Math.exp(-dt / LOAD_TRANSFER_PITCH_TIME));

    const currentSin = Math.sin(body.yaw);
    const currentCos = Math.cos(body.yaw);
    const currentVx = body.velocity.x * currentSin + body.velocity.z * currentCos;
    const estAccelLat = input.accelLat ?? (currentVx * body.yawRate);
    // Positive accelLat means accelerating toward +right (+X, left side of car),
    // which rolls the body toward -X (right side) and loads the -X wheels (FR=1, RR=3).
    const rollTarget = clamp((estAccelLat / GRAVITY) * (this.cgHeight / this.track), -0.34, 0.34);
    this.rollShift += (rollTarget - this.rollShift) * (1 - Math.exp(-dt / LOAD_TRANSFER_ROLL_TIME));

    if (!input.grounded) {
      out.frontSideUse = 0;
      out.rearSideUse = 0;
      out.frontSlide = 0;
      out.rearSlide = 0;
      for (let i = 0; i < 4; i += 1) {
        const t = this.telemetry[i];
        t.normalLoadN = 0;
        t.longForceN = 0;
        t.latForceN = 0;
        t.gripUtilization = 0;
        t.grounded = false;
      }
      return out;
    }

    const downforceG = aeroDownforceG(this.aeroProfile, Math.max(0, currentVx));
    const frontAero = downforceG * this.aeroProfile.frontAeroShare;
    const rearAero = downforceG * (1 - this.aeroProfile.frontAeroShare);

    const staticFront = clamp(this.frontWeightShare - this.pitchShift, 0.18, 0.82);
    const staticRear = 1 - staticFront;
    const frontAxleLoad = staticFront + frontAero;
    const rearAxleLoad = staticRear + rearAero;

    // Conserve axle load across left/right roll transfer so vertical load is never created or destroyed.
    const frontRoll = clamp(this.rollShift * 0.54, -0.46 * frontAxleLoad, 0.46 * frontAxleLoad);
    const rearRoll = clamp(this.rollShift * 0.46, -0.46 * rearAxleLoad, 0.46 * rearAxleLoad);

    this.wheelLoads[0] = 0.5 * frontAxleLoad - frontRoll; // FL (+X, +Z)
    this.wheelLoads[1] = 0.5 * frontAxleLoad + frontRoll; // FR (-X, +Z)
    this.wheelLoads[2] = 0.5 * rearAxleLoad - rearRoll;   // RL (+X, -Z)
    this.wheelLoads[3] = 0.5 * rearAxleLoad + rearRoll;   // RR (-X, -Z)

    const suspLoads = input.wheelSuspensionLoads;
    if (suspLoads && suspLoads.length === 4) {
      let suspSum = 0;
      let groundedCount = 0;
      for (let i = 0; i < 4; i += 1) {
        const sl = suspLoads[i];
        this.wheelGrounded[i] = sl > 0.05;
        if (sl > 0.05) {
          suspSum += sl;
          groundedCount += 1;
        } else {
          this.wheelLoads[i] = 0;
        }
      }
      if (groundedCount > 0 && suspSum > 1e-3) {
        const targetTotalLoad = (1 + downforceG) * (groundedCount / 4);
        let blendedSum = 0;
        for (let i = 0; i < 4; i += 1) {
          if (this.wheelGrounded[i]) {
            const normSusp = (suspLoads[i] / suspSum) * targetTotalLoad;
            this.wheelLoads[i] = 0.76 * this.wheelLoads[i] + 0.24 * normSusp;
            blendedSum += this.wheelLoads[i];
          }
        }
        if (blendedSum > 1e-4) {
          const scale = targetTotalLoad / blendedSum;
          for (let i = 0; i < 4; i += 1) {
            this.wheelLoads[i] *= scale;
          }
        }
      }
    } else {
      for (let i = 0; i < 4; i += 1) this.wheelGrounded[i] = true;
    }

    // Ackermann front wheel steering angles + static front/rear toe alignment.
    const steer = input.steer;
    const frontToeRad = (this.stance.frontToeDeg - STANCE_PRESETS.stock.config.frontToeDeg) * DEG_TO_RAD * 0.32;
    const rearToeRad = (this.stance.rearToeDeg - STANCE_PRESETS.stock.config.rearToeDeg) * DEG_TO_RAD * 0.32;
    if (Math.abs(steer) > 1e-4) {
      const tanS = Math.tan(steer);
      const ack = (0.22 * this.track / this.wheelbase) * (1 - smoothstep(Math.abs(steer), 0.25, 0.52));
      this.wheelSteer[0] = Math.atan(tanS / Math.max(0.25, 1 - ack * tanS)) - frontToeRad;
      this.wheelSteer[1] = Math.atan(tanS / Math.max(0.25, 1 + ack * tanS)) + frontToeRad;
    } else {
      this.wheelSteer[0] = -frontToeRad;
      this.wheelSteer[1] = frontToeRad;
    }
    this.wheelSteer[2] = -rearToeRad;
    this.wheelSteer[3] = rearToeRad;

    // Longitudinal braking usage per axle (with ABS & EBD).
    const brakeFront = input.braking > 0
      ? Math.min(0.84, (input.braking * 0.72) / Math.max(this.brakeGrip * frontAxleLoad, 1))
      : 0;
    const brakeRear = input.braking > 0
      ? Math.min(0.36, (input.braking * 0.28) / Math.max(this.brakeGrip * rearAxleLoad, 1))
      : 0;
    const frontLongUse = Math.max(input.frontLongUse, brakeFront);
    const rearLongUse = Math.max(input.rearLongUse, brakeRear);

    const halfTrack = this.track * 0.5;
    const totalWeightN = this.massKg * GRAVITY;
    let remaining = dt;
    let maxFrontSlide = 0;
    let maxRearSlide = 0;
    let lastFrontSlip = 0;
    let lastRearSlip = 0;
    let lastFrontUse = 0;
    let lastRearUse = 0;

    while (remaining > 1e-6) {
      const h = Math.min(SUBSTEP, remaining);
      remaining -= h;
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const vx = body.velocity.x * sin + body.velocity.z * cos;
      const vy = body.velocity.x * cos - body.velocity.z * sin;
      const speed = Math.hypot(vx, vy);
      const r = body.yawRate;

      let totalAx = 0;
      let totalAy = 0;
      let totalYawTorque = 0;
      let frontSlipSum = 0;
      let rearSlipSum = 0;
      let frontUseSum = 0;
      let rearUseSum = 0;
      let frontSlideSub = 0;
      let rearSlideSub = 0;

      for (let i = 0; i < 4; i += 1) {
        const isFront = i < 2;
        const isLeft = (i & 1) === 0;
        const wx = isLeft ? halfTrack : -halfTrack;
        const wz = isFront ? this.frontArm : -this.rearArm;
        const wLoad = this.wheelLoads[i];
        const tp = this.tires[i];
        const tel = this.telemetry[i];

        if (!this.wheelGrounded[i] || wLoad <= 1e-4) {
          tel.normalLoadN = 0;
          tel.longForceN = 0;
          tel.latForceN = 0;
          tel.gripUtilization = 0;
          tel.grounded = false;
          continue;
        }

        // Contact patch velocity in body frame including yaw rotation.
        const vxi = vx - r * wx;
        const vyi = vy + r * wz;

        // Transform into wheel's steered frame.
        const delta = this.wheelSteer[i];
        const c = Math.cos(delta);
        const s = Math.sin(delta);
        const vLong = vxi * c + vyi * s;
        const vLat = -vxi * s + vyi * c;

        // Lateral slip angle (rad).
        const denomLong = Math.max(Math.abs(vLong), MIN_ROLLING_SPEED);
        const slipAngle = Math.atan2(-vLat, denomLong);
        const peakAngleRad = tp.peakSlipAngleDeg * DEG_TO_RAD;
        const normLatSlip = slipAngle / Math.max(peakAngleRad, 0.03);

        // Longitudinal slip velocity & slip ratio (kappa).
        const axleSlipSpeed = isFront ? input.frontSlipSpeed : input.rearSlipSpeed;
        const axleSpin = isFront ? input.frontSpin : input.rearSpin;
        const axleLongUse = isFront ? frontLongUse : rearLongUse;
        const lock = isFront ? 0 : input.rearLock;

        // Differential distribution: open diff spins inner unloaded wheel more;
        // LSD locks left & right driven wheels closer together.
        const axleLoad = isFront ? frontAxleLoad : rearAxleLoad;
        const wheelShareOfAxle = axleLoad > 1e-3 ? wLoad / (0.5 * axleLoad) : 1;
        const openUnloadedBoost = clamp(1.35 - 0.35 * wheelShareOfAxle, 0.75, 1.45);
        const diffSlipScale = this.diffLock + (1 - this.diffLock) * openUnloadedBoost;

        let wheelSlipSpeed = axleSlipSpeed * diffSlipScale;
        if (input.braking > 0 && lock < 0.05) {
          const brakeUse = isFront ? brakeFront : brakeRear;
          wheelSlipSpeed = -Math.sign(vLong || 1) * brakeUse * tp.peakSlipRatio * denomLong * 0.9;
        }
        if (lock > 0) {
          // Progressive handbrake slip: locking the rear wheels creates strong longitudinal slip
          // that breaks rear lateral traction cleanly to initiate a slide, while remaining bounded
          // so the rear axle develops a controllable drift angle instead of an instant 360 spin.
          const lockedSlipSpeed = -Math.sign(vLong || 1) * tp.peakSlipRatio * denomLong * (1.8 + 3.2 * lock);
          wheelSlipSpeed = wheelSlipSpeed * (1 - lock) + lockedSlipSpeed * lock;
        }

        const wheelSurfaceSpeed = vLong + wheelSlipSpeed;
        const slipRatioDenom = Math.max(Math.abs(vLong), Math.abs(wheelSurfaceSpeed) * 0.25, 2.2);
        const slipRatio = wheelSlipSpeed / slipRatioDenom;
        const normLongSlip = slipRatio / Math.max(tp.peakSlipRatio, 0.03);

        // Load sensitivity: effective friction drops smoothly as a single tire carries excess load.
        // Baseline front/rear balance (0.94 front, 1.00 rear) reflects front roll-stiffness bias
        // so steady-state cornering has progressive limit understeer unless longitudinal slip
        // (throttle wheelspin, handbrake, or trail-braking) consumes the rear friction budget.
        const axleBalance = isFront ? 0.94 : 1.00;
        const camberDeg = isFront ? this.stance.frontCamberDeg : this.stance.rearCamberDeg;
        const camberLat = camberLatMultiplier(camberDeg);
        const loadSens = clamp(1 - tp.loadSensitivity * (wLoad - 0.25) * 1.8, 0.72, 1.06);
        const maxTireAccel = this.baseGrip * tp.frictionCoeff * wLoad * loadSens * axleBalance * camberLat;

        // Unified Combined-Slip Tire Model (Friction Ellipse + Post-Peak Sliding Vector):
        // 1. Within the tire's grip envelope, pure lateral (fLat0) and longitudinal (fLong0)
        //    demands coexist inside the friction ellipse without artificially cutting
        //    cornering stiffness under normal cruise throttle.
        // 2. When combined demand exceeds the tire's friction circle or the wheel spins/locks
        //    past peak longitudinal slip, longitudinal demand reduces lateral grip enough to
        //    initiate and sustain oversteer (or understeer on FWD), while saturating smoothly
        //    so the rear axle retains weathervane restoring force at high drift angles.
        const uLatAbs = Math.abs(normLatSlip);
        const uLongRaw = Math.max(Math.abs(normLongSlip), axleLongUse * 0.85, lock > 0 ? lock * 5.8 : 0);
        const fLat0 = nonlinearTireResponse(uLatAbs, tp.latStiffness, tp.postPeakGrip);
        const fLong0 = Math.max(
          nonlinearTireResponse(uLongRaw, tp.longStiffness, tp.postPeakGrip),
          axleLongUse * 0.80,
        );

        // Excess longitudinal slip past peak (wheelspin or handbrake) pulls the friction
        // vector toward the longitudinal axis, breaking rear lateral traction crisply at
        // small-to-medium slip angles while saturating smoothly at large drift angles so
        // the rear axle retains weathervane restoring force and never spins out uncontrollably.
        const spinOvershoot = Math.max(0, uLongRaw - 1.0);
        const boundedOvershoot = spinOvershoot / (1 + 0.18 * spinOvershoot);
        const latVelocityShare = 1 / (1 + 0.06 * Math.max(0, uLatAbs - 2.0));
        const effLong = Math.hypot(fLong0 * 0.78, boundedOvershoot * 0.95) * latVelocityShare;
        const combDemand = Math.hypot(effLong, fLat0);

        let latShare: number;
        let longShare: number;
        if (combDemand > 1.0) {
          const uComb = Math.hypot(Math.min(uLongRaw, 3.0), uLatAbs);
          const envLat = nonlinearTireResponse(Math.max(1, uComb), tp.latStiffness, tp.postPeakGrip);
          const envLong = nonlinearTireResponse(Math.max(1, uComb), tp.longStiffness, tp.postPeakGrip);
          const ellipseScale = Math.max(fLat0, envLat) / combDemand;
          latShare = fLat0 * ellipseScale;
          longShare = (effLong / combDemand) * envLong;
        } else {
          latShare = fLat0;
          longShare = fLong0;
        }
        const latAccel = Math.sign(slipAngle) * maxTireAccel * latShare;

        // Steered wheel lateral force projected into body frame.
        // Preserve full geometric projection (-sin(delta), cos(delta)) so that during
        // countersteering the force perpendicular to the velocity vector is not attenuated,
        // and maintain effective yaw moment arm at large countersteer angles.
        const fxLat = -latAccel * s;
        const fyLat = latAccel * c;
        const fyYaw = isFront ? latAccel * Math.max(0.84, c) : fyLat;

        // Driven longitudinal force lateral steering projection on front wheels.
        const axleDriveShare = isFront
          ? (this.driveLayout === 'FWD' ? 1 : this.driveLayout === 'AWD' ? 0.35 : 0)
          : (this.driveLayout === 'RWD' ? 1 : this.driveLayout === 'AWD' ? 0.65 : 0);
        const wheelDriveAccel = input.drivenTraction * axleDriveShare * 0.5;
        const fyDriveSteer = isFront ? wheelDriveAccel * s : 0;

        const wheelFx = fxLat;
        const wheelFy = fyLat + fyDriveSteer;

        totalAx += wheelFx;
        totalAy += wheelFy;
        totalYawTorque += wz * (fyYaw + fyDriveSteer) - wx * wheelFx;

        // Slide severity past peak slip angle (or under wheelspin/handbrake).
        const angleSlide = smoothstep(Math.abs(slipAngle), peakAngleRad * 1.15, peakAngleRad * 3.0);
        const wheelSlide = Math.max(angleSlide, axleSpin * 0.65, lock * 0.85);
        // Report actual tire lateral force utilization (latShare) so Drivetrain's friction
        // ellipse receives true physical force usage without positive-feedback inflation.
        if (isFront) {
          frontSlipSum += slipAngle * 0.5;
          frontUseSum += latShare * 0.5;
          frontSlideSub = Math.max(frontSlideSub, wheelSlide);
        } else {
          rearSlipSum += slipAngle * 0.5;
          rearUseSum += latShare * 0.5;
          rearSlideSub = Math.max(rearSlideSub, wheelSlide);
        }

        // Record live telemetry for this wheel (only arithmetic, zero allocation).
        if (remaining <= 1e-6) {
          const longSign = Math.sign(slipRatio || (input.braking > 0 ? -vLong : input.drivenTraction));
          tel.slipAngleDeg = slipAngle * RAD_TO_DEG;
          tel.slipRatio = slipRatio;
          tel.normalLoadN = wLoad * totalWeightN;
          tel.longForceN = longSign * longShare * maxTireAccel * this.massKg;
          tel.latForceN = latAccel * this.massKg;
          tel.gripUtilization = Math.min(1.0, Math.hypot(longShare, latShare));
          tel.wheelAngularSpeed = wheelSurfaceSpeed / this.wheelRadius;
          tel.grounded = true;
        }
      }

      let yawAccel = totalYawTorque / this.yawInertia;

      // Low-speed kinematic blend so parking and stop-and-go never jitter.
      const dynamic = smoothstep(speed, KINEMATIC_SPEED, DYNAMIC_SPEED);
      if (dynamic < 1) {
        const kinematicYawRate = (vx / this.wheelbase) * Math.tan(steer);
        const settle = Math.min(1, 25 * h);
        yawAccel = yawAccel * dynamic + ((kinematicYawRate - r) * settle / h) * (1 - dynamic);
        totalAy = totalAy * dynamic + ((this.rearArm * r - vy) * settle / h) * (1 - dynamic);
        totalAx *= dynamic;
      }

      body.velocity.x += (sin * totalAx + cos * totalAy) * h;
      body.velocity.z += (cos * totalAx - sin * totalAy) * h;
      body.yawRate += yawAccel * h;
      body.yaw += body.yawRate * h;

      maxFrontSlide = Math.max(maxFrontSlide, frontSlideSub * dynamic);
      maxRearSlide = Math.max(maxRearSlide, rearSlideSub * dynamic);
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
    return out;
  }
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
