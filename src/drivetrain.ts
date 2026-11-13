import type { VehicleSpec } from './data';

// Engine, gearbox and driven axle longitudinal tire dynamics.
//
// Front and rear axles each carry their own surface speed and longitudinal slip.
// Driven wheels receive engine torque scaled by the gear's mechanical advantage
// and the car's specific torque-to-weight ratio. Within the friction limit,
// tires develop continuous elastic longitudinal slip; past the limit (reduced by
// cornering via the friction ellipse), the driven wheels spin up and operate on
// the post-peak sliding portion of the tire curve.

export type Gear = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Share of the catalog top speed at redline per gear. Top gear runs slightly
// long so top speed is reached just below redline against aerodynamic drag.
export const GEAR_SPEED = [0, 0.17, 0.31, 0.48, 0.66, 0.84, 1.03];
const GEAR_TORQUE = [0, 1, 0.82, 0.68, 0.57, 0.49, 0.43];
// Mechanical torque multiplication in lower gears relative to normal cruise pull,
// enabling realistic wheelspin breakaway on powerful cars in 1st-3rd gears.
// Scaled to match SI GRAVITY (9.81 m/s²) tire traction limits.
const GEAR_BREAKAWAY_BOOST = [0, 1.82, 1.54, 1.32, 1.15, 1.05, 1.0];
const REVERSE_TORQUE = 0.48;
const REVERSE_TOP_SPEED = 10; // m/s (36 km/h at the limiter)
const ACCELERATION_SCALE = 0.45;
export const IDLE_RPM = 850;
export const REDLINE_RPM = 7050;
// Unified SI gravity (m/s²), matching chassis.ts and engine.ts.
const GRAVITY = 9.81;
// Car mass over effective wheel + drivetrain rotational inertia.
const WHEEL_INERTIA_RATIO = 7.5;
export const WEIGHT_TRANSFER = 0.18; // baseline centre-of-mass height over wheelbase
const LOCKED_REAR_GRIP = 0.65;       // handbrake: share of rear grip spent braking
// Traction control: trims torque to what the tires can carry and cuts when
// a wheel breaks loose, reacting quickly enough to prevent unintended spins.
const TCS_GRIP_MARGIN = 0.94;
const TCS_SPIN_CUT = 0.38;
const TCS_CUT_RATE = 15;             // 1/s
const TCS_RESTORE_RATE = 5.5;        // 1/s

export type DriveLayout = 'RWD' | 'FWD' | 'AWD';

export function driveLayoutOf(spec: VehicleSpec): DriveLayout {
  const drive = spec.realSpecs?.drive?.toUpperCase() ?? '';
  if (drive.includes('FWD')) return 'FWD';
  if (drive.includes('AWD') || drive.includes('QUATTRO') || drive.includes('4MOTION') || drive.includes('XDRIVE') || drive.includes('ATTESA')) {
    return 'AWD';
  }
  if (!spec.realSpecs?.drive && (spec.category === 'EKONOMI' || spec.category === 'SEHIR')) {
    return 'FWD';
  }
  return 'RWD';
}

/**
 * Baseline share of drive torque sent to the rear axle.
 * AWD systems differ by architecture:
 * - Haldex / 4MOTION: front-biased (0.38 rear)
 * - Subaru STI / symmetrical AWD: balanced rear-leaning (0.59 rear)
 * - Audi quattro / Lamborghini / Bugatti: rear-biased (0.64 rear)
 * - BMW M xDrive: strongly rear-biased (0.72 rear)
 * - Nissan ATTESA E-TS: rear-biased (0.82 rear, dynamically sends torque forward on rear slip)
 */
export function rearDriveShare(spec: VehicleSpec): number {
  const layout = driveLayoutOf(spec);
  if (layout === 'RWD') return 1;
  if (layout === 'FWD') return 0;
  const drive = spec.realSpecs?.drive?.toUpperCase() ?? '';
  if (drive.includes('4MOTION')) return 0.38;
  if (drive.includes('ATTESA')) return 0.82;
  if (drive.includes('XDRIVE')) return 0.72;
  if (drive.includes('QUATTRO')) return 0.64;
  return 0.59;
}

/** Estimated vehicle mass in kg from realSpecs or class defaults. */
export function estimateVehicleMassKg(spec: VehicleSpec): number {
  if (spec.realSpecs?.weightKg && spec.realSpecs.weightKg > 500) return spec.realSpecs.weightKg;
  if (spec.category === 'EKONOMI') return 1060;
  if (spec.category === 'SEHIR') return 1280;
  if (spec.category === 'SPORT') return 1420;
  if (spec.category === 'PERFORMANS') return 1560;
  return 1450;
}

/** Static front axle weight share (0..1) from drivetrain & body layout. */
export function estimateFrontWeightShare(spec: VehicleSpec): number {
  const id = spec.id.toLowerCase();
  if (id.includes('911')) return 0.39; // rear-engine flat-six
  const midEngine = spec.bodyStyle === 'super'
    || id.includes('r8')
    || id.includes('huracan')
    || id.includes('gallardo')
    || id.includes('720s')
    || id.includes('p1')
    || id.includes('laferrari')
    || id.includes('zonda')
    || id.includes('huayra')
    || id.includes('carrera-gt')
    || id.includes('clk-gtr')
    || id.includes('cc850')
    || id.includes('regera')
    || id.includes('one1')
    || id.includes('chiron')
    || id.includes('voiture')
    || id.includes('vision-gt')
    || id.includes('nova-one');
  if (midEngine && !id.includes('f12') && !id.includes('sls') && !id.includes('slr') && !id.includes('m4') && !id.includes('amg-gt3')) {
    return 0.43;
  }
  const layout = driveLayoutOf(spec);
  if (layout === 'FWD') return 0.60;
  if (spec.bodyStyle === 'sedan' || id.includes('charger') || id.includes('m5') || id.includes('rs4') || id.includes('impreza')) {
    return 0.53;
  }
  if (id.includes('slr') || id.includes('sls') || id.includes('f12')) return 0.51;
  return 0.50;
}

/** Peak tire longitudinal friction coefficient (in g) from vehicle handling. */
export function longitudinalGrip(spec: VehicleSpec): number {
  return 1.06 + 0.24 * spec.handling;
}

export function gearTopSpeed(spec: VehicleSpec, gear: Gear): number {
  if (gear === -1) return REVERSE_TOP_SPEED;
  return spec.maxSpeed / 3.6 * GEAR_SPEED[Math.max(1, gear)];
}

export function rpmAtSpeed(spec: VehicleSpec, speed: number, gear: Gear): number {
  return IDLE_RPM + Math.abs(speed) / Math.max(gearTopSpeed(spec, gear), 0.1) * (REDLINE_RPM - IDLE_RPM);
}

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Share of peak torque across the rev range: solid low-end, strong midrange,
// slight top-end taper, and soft rev limiter cut at redline.
function torqueCurve(rpm: number): number {
  const x = rpm / REDLINE_RPM;
  const rise = 0.24 + 0.76 * smoothstep(x, 0.08, 0.50);
  const taper = 1 - 0.22 * smoothstep(x, 0.78, 1);
  const limiter = 1 - smoothstep(rpm, REDLINE_RPM - 130, REDLINE_RPM + 40);
  return rise * taper * limiter;
}

const TOP_SPEED_DRAG_SHARE = 0.97;
export const ROLLING_RESISTANCE = 0.15; // m/s²

export function airDragCoefficient(spec: VehicleSpec): number {
  const speed = spec.maxSpeed / 3.6;
  const pull = spec.acceleration * ACCELERATION_SCALE * GEAR_TORQUE[6] * torqueCurve(rpmAtSpeed(spec, speed, 6));
  return Math.max(0, (pull * TOP_SPEED_DRAG_SHARE - ROLLING_RESISTANCE) / (speed * speed));
}

export interface AeroProfile {
  /** Downforce in g (share of vehicle weight) at 250 km/h (69.44 m/s). */
  downforceGAt250Kmh: number;
  /** Maximum aerodynamic downforce in g at extreme speeds. */
  maxDownforceG: number;
  /** Share of aerodynamic downforce on the front axle (remainder on rear wing/diffuser). */
  frontAeroShare: number;
}

const AERO_REF_SPEED_SQ = (250 / 3.6) * (250 / 3.6);

/**
 * Vehicle-specific aerodynamic downforce profile based on wing/splitter/diffuser package.
 * GT3 race cars, track-focused specials, and active-aero hypercars (Bugatti, GT3 RS, M4 GT3 EVO,
 * P1 GTR, One:1, Zonda, Huayra, CLK GTR) generate substantial high-speed downforce.
 */
export function aeroProfileOf(spec: VehicleSpec): AeroProfile {
  const id = spec.id.toLowerCase();
  // Pure GT3 / GTR / Vision GT race & extreme winged track cars
  if (
    id.includes('gt3')
    || id.includes('p1-gtr')
    || id.includes('vision-gt')
    || id.includes('vgt')
    || id.includes('one1')
    || id.includes('zonda')
    || id.includes('clk-gtr')
  ) {
    return { downforceGAt250Kmh: 0.92, maxDownforceG: 1.55, frontAeroShare: 0.42 };
  }
  // Bugattis & active-aero / winged hypercars and track editions
  if (
    id.includes('bugatti')
    || id.includes('chiron')
    || id.includes('voiture')
    || id.includes('huayra')
    || id.includes('laferrari')
    || id.includes('cc850')
    || id.includes('regera')
    || id.includes('720s')
    || id.includes('carrera-gt')
    || id.includes('m4-gts')
    || id.includes('gt-r-nismo')
    || id.includes('s206')
  ) {
    return { downforceGAt250Kmh: 0.72, maxDownforceG: 1.30, frontAeroShare: 0.43 };
  }
  // Supercars & widebody aero kits (LB Works, Varis, Duke MD4)
  if (spec.category === 'SUPER' || id.includes('lbworks') || id.includes('varis') || id.includes('md4')) {
    return { downforceGAt250Kmh: 0.52, maxDownforceG: 0.98, frontAeroShare: 0.44 };
  }
  if (spec.category === 'PERFORMANS') {
    return { downforceGAt250Kmh: 0.34, maxDownforceG: 0.65, frontAeroShare: 0.45 };
  }
  if (spec.category === 'SPORT') {
    return { downforceGAt250Kmh: 0.25, maxDownforceG: 0.48, frontAeroShare: 0.45 };
  }
  return { downforceGAt250Kmh: 0.14, maxDownforceG: 0.28, frontAeroShare: 0.46 };
}

/** Aerodynamic downforce (in g, i.e. multiple of vehicle weight) at a given forward speed (m/s). */
export function aeroDownforceG(profile: AeroProfile, forwardSpeed: number): number {
  if (forwardSpeed <= 1) return 0;
  const g = profile.downforceGAt250Kmh * (forwardSpeed * forwardSpeed) / AERO_REF_SPEED_SQ;
  return Math.min(profile.maxDownforceG, g);
}

export interface DrivetrainInput {
  dt: number;
  gear: Gear;
  throttle: boolean;
  handbrake: boolean;
  burnout: boolean;      // line lock: fronts braked, driven wheels free to spin
  /** Throttle while the brakes hold every driven wheel (AWD at a standstill): the engine revs against the slipping clutch, nothing turns. */
  revAgainstBrakes?: boolean;
  tcs: boolean;          // traction control on (a burnout overrides it)
  grounded: boolean;
  forwardSpeed: number;  // m/s along the car
  frontSideUse: number;  // 0..1 lateral grip share used on front axle
  rearSideUse: number;   // 0..1 lateral grip share used on rear axle
  // Optional tire tuning multipliers from TireDebugPanel / Chassis
  frontFrictionMult?: number;
  rearFrictionMult?: number;
  frontLongStiffness?: number;
  rearLongStiffness?: number;
  frontPeakSlipRatio?: number;
  rearPeakSlipRatio?: number;
  frontPostPeakGrip?: number;
  rearPostPeakGrip?: number;
}

export interface DrivetrainOutput {
  accel: number;         // m/s² the tires pass to the car along its length
  frontSpin: number;     // 0..1 how hard the front tires spin under power
  rearSpin: number;      // 0..1 how hard the rear tires spin under power
  frontLongUse: number;  // 0..1 share of front grip spent longitudinally
  rearLongUse: number;   // 0..1 share of rear grip spent longitudinally
  tcsActive: boolean;    // traction control is cutting torque right now
}

interface AxleStepResult {
  speed: number;
  traction: number;
}

export class Drivetrain {
  rpm = IDLE_RPM;
  airDrag = 0;
  frontWheelSpeed = 0;
  rearWheelSpeed = 0;
  private baseRearShare = 1;
  private isAttesa = false;
  private frontStaticShare = 0.5;
  private aeroProfile: AeroProfile = { downforceGAt250Kmh: 0.25, maxDownforceG: 0.48, frontAeroShare: 0.45 };
  private torqueReserveBoost = 1;
  private baseMu = 1.3;
  private lastAccel = 0;
  private tcsFactor = 1;
  private readonly frontResult: AxleStepResult = { speed: 0, traction: 0 };
  private readonly rearResult: AxleStepResult = { speed: 0, traction: 0 };
  private readonly output: DrivetrainOutput = {
    accel: 0,
    frontSpin: 0,
    rearSpin: 0,
    frontLongUse: 0,
    rearLongUse: 0,
    tcsActive: false,
  };

  constructor(private spec: VehicleSpec) {
    this.setVehicle(spec);
  }

  setVehicle(spec: VehicleSpec): void {
    this.spec = spec;
    this.baseRearShare = rearDriveShare(spec);
    this.isAttesa = (spec.realSpecs?.drive?.toUpperCase() ?? '').includes('ATTESA');
    this.frontStaticShare = estimateFrontWeightShare(spec);
    this.aeroProfile = aeroProfileOf(spec);
    this.baseMu = longitudinalGrip(spec);
    this.airDrag = airDragCoefficient(spec);
    const mass = estimateVehicleMassKg(spec);
    const torqueNm = spec.realSpecs?.torqueNm ?? (spec.power * 1.18);
    const specificTorque = torqueNm / mass; // Nm/kg (typical sport ~0.22, super ~0.45)
    this.torqueReserveBoost = Math.min(1.12, Math.max(0.96, 0.88 + specificTorque * 0.45));
    this.reset();
  }

  reset(): void {
    this.rpm = IDLE_RPM;
    this.frontWheelSpeed = 0;
    this.rearWheelSpeed = 0;
    this.lastAccel = 0;
    this.tcsFactor = 1;
  }

  step(input: DrivetrainInput): DrivetrainOutput {
    const { dt, gear, forwardSpeed } = input;
    // Dynamic AWD transfer for ATTESA-style active split when rear wheels slip or cornering hard.
    let rearShare = this.baseRearShare;
    if (this.isAttesa) {
      const activeTransfer = Math.max(this.output.rearSpin * 0.42, Math.max(0, input.rearSideUse - 0.55) * 0.45);
      rearShare = Math.max(0.50, this.baseRearShare - activeTransfer);
    }
    const inGear = gear !== 0;
    const direction = gear === -1 ? -1 : 1;

    const drivenSpeed = this.frontWheelSpeed * (1 - rearShare) + this.rearWheelSpeed * rearShare;
    let targetRpm: number;
    if (inGear) {
      const wheelRpm = rpmAtSpeed(this.spec, drivenSpeed, gear);
      const gearIndex = gear === -1 ? 1 : gear;
      const clutchRpm = input.throttle || input.revAgainstBrakes ? 1450 + 1850 / gearIndex : IDLE_RPM;
      targetRpm = Math.max(wheelRpm, clutchRpm);
    } else {
      targetRpm = input.throttle ? REDLINE_RPM : IDLE_RPM;
    }
    const rpmRate = inGear ? 14500 : input.throttle ? 9500 : 4800;
    this.rpm = approach(this.rpm, Math.min(targetRpm, REDLINE_RPM + 150), rpmRate * dt);

    const frontMult = input.frontFrictionMult ?? 1;
    const rearMult = input.rearFrictionMult ?? 1;
    const frontMu = this.baseMu * frontMult;
    const rearMu = this.baseMu * rearMult;

    const staticRear = 1 - this.frontStaticShare;
    const baseRearLoad = Math.min(0.74, Math.max(0.26, staticRear + WEIGHT_TRANSFER * this.lastAccel / GRAVITY));
    const baseFrontLoad = 1 - baseRearLoad;
    const downforceG = aeroDownforceG(this.aeroProfile, Math.max(0, forwardSpeed));
    const frontLoad = baseFrontLoad + downforceG * this.aeroProfile.frontAeroShare;
    const rearLoad = baseRearLoad + downforceG * (1 - this.aeroProfile.frontAeroShare);

    // Friction ellipse: lateral force spent cornering reduces available longitudinal grip.
    const frontSide = Math.min(0.90, input.frontSideUse * 0.92);
    const rearSide = Math.min(0.90, input.rearSideUse * 0.92);
    const frontFull = frontMu * GRAVITY * frontLoad;
    const rearFull = rearMu * GRAVITY * rearLoad;
    const frontLimit = frontFull * Math.sqrt(1 - frontSide * frontSide);
    const rearLimit = rearFull * Math.sqrt(1 - rearSide * rearSide);
    const topSpeed = inGear ? gearTopSpeed(this.spec, gear) * 1.02 : Infinity;

    const gearIdx = Math.max(0, gear);
    const gearTorque = gear === -1 ? REVERSE_TORQUE : GEAR_TORQUE[gearIdx];
    const breakawayBoost = gear === -1 ? 1.35 : GEAR_BREAKAWAY_BOOST[gearIdx] * this.torqueReserveBoost;
    const rawCruiseAccel = input.throttle && inGear
      ? direction * this.spec.acceleration * ACCELERATION_SCALE * gearTorque * torqueCurve(this.rpm)
      : 0;
    // Wheel torque demand includes low-gear mechanical multiplication so high-torque
    // cars can overcome rear/front tire grip when TCS is off or while cornering.
    let wheelDriveDemand = rawCruiseAccel * (input.tcs && !input.burnout ? 1.02 : breakawayBoost);

    let tcsTarget = 1;
    if (input.tcs && !input.burnout && input.grounded && wheelDriveDemand !== 0) {
      const demand = Math.abs(wheelDriveDemand);
      if (rearShare > 0) tcsTarget = Math.min(tcsTarget, rearLimit * TCS_GRIP_MARGIN / (demand * rearShare));
      if (rearShare < 1) tcsTarget = Math.min(tcsTarget, frontLimit * TCS_GRIP_MARGIN / (demand * (1 - rearShare)));
      const spinning = Math.max(
        rearShare > 0 ? powerSpin(this.rearWheelSpeed, forwardSpeed, direction, input.rearPeakSlipRatio ?? 0.12) : 0,
        rearShare < 1 ? powerSpin(this.frontWheelSpeed, forwardSpeed, direction, input.frontPeakSlipRatio ?? 0.12) : 0,
      );
      if (spinning > 0.04) tcsTarget = Math.min(tcsTarget, TCS_SPIN_CUT);
    }
    tcsTarget = Math.min(1, tcsTarget);
    this.tcsFactor = tcsTarget < this.tcsFactor
      ? approach(this.tcsFactor, tcsTarget, TCS_CUT_RATE * 2.5 * dt)
      : approach(this.tcsFactor, tcsTarget, TCS_RESTORE_RATE * dt);
    wheelDriveDemand *= this.tcsFactor;
    const cruiseAccel = rawCruiseAccel * this.tcsFactor;

    this.stepAxle(
      this.frontResult,
      this.frontWheelSpeed,
      forwardSpeed,
      wheelDriveDemand * (1 - rearShare),
      cruiseAccel * (1 - rearShare),
      frontLimit,
      input.frontLongStiffness ?? 1.10,
      input.frontPeakSlipRatio ?? 0.12,
      input.frontPostPeakGrip ?? 0.82,
      input,
      topSpeed,
    );
    this.frontWheelSpeed = this.frontResult.speed;
    const frontTraction = this.frontResult.traction;

    let rearTraction: number;
    if (input.handbrake && input.grounded) {
      const hbDecel = rearFull * LOCKED_REAR_GRIP;
      this.rearWheelSpeed = approach(this.rearWheelSpeed, 0, hbDecel * WHEEL_INERTIA_RATIO * 0.65 * dt);
      const lockShare = forwardSpeed > 1.0 ? Math.min(1, Math.max(0.25, 1 - this.rearWheelSpeed / forwardSpeed)) : 1;
      rearTraction = Math.abs(forwardSpeed) > 0.3
        ? -Math.sign(forwardSpeed) * rearLimit * LOCKED_REAR_GRIP * 0.55 * lockShare
        : 0;
    } else {
      this.stepAxle(
        this.rearResult,
        this.rearWheelSpeed,
        forwardSpeed,
        wheelDriveDemand * rearShare,
        cruiseAccel * rearShare,
        rearLimit,
        input.rearLongStiffness ?? 1.10,
        input.rearPeakSlipRatio ?? 0.12,
        input.rearPostPeakGrip ?? 0.84,
        input,
        topSpeed,
      );
      this.rearWheelSpeed = this.rearResult.speed;
      rearTraction = this.rearResult.traction;
    }

    const totalTraction = frontTraction + rearTraction;

    this.output.frontSpin = powerSpin(this.frontWheelSpeed, forwardSpeed, direction, input.frontPeakSlipRatio ?? 0.12);
    this.output.rearSpin = input.handbrake ? 0 : powerSpin(this.rearWheelSpeed, forwardSpeed, direction, input.rearPeakSlipRatio ?? 0.12);

    this.output.frontLongUse = input.grounded && frontFull > 1e-4
      ? Math.min(1, Math.max(Math.abs(frontTraction) / frontFull, this.output.frontSpin * 0.85))
      : 0;
    this.output.rearLongUse = input.grounded && rearFull > 1e-4
      ? (input.handbrake ? 1 : Math.min(1, Math.max(Math.abs(rearTraction) / rearFull, this.output.rearSpin * 0.85)))
      : 0;
    this.lastAccel = input.burnout ? 0 : totalTraction;

    this.output.accel = input.grounded ? totalTraction : 0;
    this.output.tcsActive = wheelDriveDemand !== 0 && this.tcsFactor < 0.96;
    return this.output;
  }

  private stepAxle(
    out: AxleStepResult,
    wheel: number,
    ground: number,
    drive: number,
    cruiseDrive: number,
    limit: number,
    longStiffness: number,
    peakSlipRatio: number,
    postPeakGrip: number,
    input: DrivetrainInput,
    topSpeed: number,
  ): void {
    const { dt } = input;
    if (!input.grounded) {
      out.speed = clampMagnitude(wheel + drive * WHEEL_INERTIA_RATIO * dt, topSpeed);
      out.traction = 0;
      return;
    }
    let effectiveLimit = limit;
    if (input.burnout && drive !== 0) {
      effectiveLimit = Math.min(effectiveLimit, Math.abs(drive) * 0.45);
    }

    const stiffnessScale = Math.max(0.4, longStiffness);
    const refSpeed = Math.max(Math.abs(ground), 2.5);
    const peakSlipSpeed = Math.max(0.45, (peakSlipRatio / Math.sqrt(stiffnessScale)) * refSpeed);
    const slip = wheel - ground;
    const absSlip = Math.abs(slip);

    // Within peak slip region: continuous elastic slip proportional to torque demand.
    if (absSlip <= peakSlipSpeed * 1.05 && Math.abs(drive) <= effectiveLimit) {
      const elasticSlip = effectiveLimit > 1e-4 ? (drive / effectiveLimit) * peakSlipSpeed * 0.85 : 0;
      out.speed = clampMagnitude(ground + elasticSlip, topSpeed);
      out.traction = clampMagnitude(cruiseDrive, effectiveLimit);
      return;
    }

    // Past peak slip or drive torque exceeds tire limit: wheel spins up and
    // traction follows the post-peak sliding curve.
    const overshoot = Math.max(0, (absSlip - peakSlipSpeed) / Math.max(peakSlipSpeed * 3.2, 2.5));
    const slideShare = 1 - (1 - postPeakGrip) * smoothstep(overshoot * stiffnessScale, 0, 1);
    const slipSign = absSlip > 0.15 ? Math.sign(slip) : Math.sign(drive);
    const maxSlideTraction = effectiveLimit * slideShare;
    const traction = Math.abs(drive) > 0
      ? slipSign * Math.min(Math.max(Math.abs(cruiseDrive), maxSlideTraction * 0.72), maxSlideTraction)
      : 0;
    // If a wheel was slowed below ground speed (e.g. releasing the handbrake), road contact
    // rapidly spins it back up to ground speed so rear lateral grip recovers smoothly.
    const spinUpAssist = (slip * (ground >= 0 ? 1 : -1) < 0 && drive * (ground >= 0 ? 1 : -1) >= 0)
      ? Math.max(maxSlideTraction, GRAVITY * 0.9) * 1.8
      : maxSlideTraction;
    const wheelAccel = (drive - slipSign * spinUpAssist) * WHEEL_INERTIA_RATIO;
    const next = clampMagnitude(wheel + wheelAccel * dt, topSpeed);
    const nextSlip = next - ground;

    if (Math.abs(drive) <= effectiveLimit && (nextSlip * slip <= 0 || Math.abs(nextSlip) <= peakSlipSpeed * 0.85)) {
      const elasticSlip = effectiveLimit > 1e-4 ? (drive / effectiveLimit) * peakSlipSpeed * 0.8 : 0;
      out.speed = clampMagnitude(ground + elasticSlip, topSpeed);
      out.traction = clampMagnitude(cruiseDrive, effectiveLimit);
      return;
    }

    out.speed = next;
    out.traction = traction;
  }
}

function powerSpin(wheel: number, ground: number, direction: number, peakSlipRatio: number): number {
  const slip = (wheel - ground) * direction;
  const refSpeed = Math.max(Math.abs(ground), 3.0);
  const start = Math.max(0.45, peakSlipRatio * refSpeed * 0.95);
  const full = Math.max(3.8, start + 3.6 + 0.08 * refSpeed);
  return smoothstep(slip, start, full);
}

function clampMagnitude(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
}
