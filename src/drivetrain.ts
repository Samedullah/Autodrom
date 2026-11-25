import type { VehicleSpec } from './data';

// Engine and gearbox: turns throttle, gear and driven wheel speed into a drive
// force at the driven tyres. What the tyres do with that force (grip, wheelspin,
// traction control) is the chassis' job, so one tyre model handles driving,
// braking and cornering together (see chassis.ts).

export type Gear = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Share of the catalog top speed at redline per gear. Top gear runs slightly
// long so top speed is reached just below redline against aerodynamic drag.
export const GEAR_SPEED = [0, 0.17, 0.31, 0.48, 0.66, 0.84, 1.03];
const GEAR_TORQUE = [0, 1, 0.82, 0.68, 0.57, 0.49, 0.43];
const REVERSE_TORQUE = 0.48;
const REVERSE_TOP_SPEED = 10; // m/s (36 km/h at the limiter)
const ACCELERATION_SCALE = 0.45;
// Engine braking in 1st gear (m/s²), falling off in higher gears.
const ENGINE_BRAKING = 1.6;
// Rotational inertia of the engine, clutch and gearbox input (kg·m²). Seen from
// the driven tyres it grows with the square of the overall gear ratio, which is
// why first gear pulls less than the torque alone suggests.
const ENGINE_INERTIA = 0.08;
export const IDLE_RPM = 850;
export const REDLINE_RPM = 7050;

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
 * Vehicle-specific aerodynamic downforce, in share of the car's weight.
 * Road cars make next to none; winged track specials make a useful amount;
 * GT3 and prototype-style race cars make close to their own weight at 250 km/h,
 * which is what lets them corner far faster at speed than slowly.
 */
export function aeroProfileOf(spec: VehicleSpec): AeroProfile {
  const id = spec.id.toLowerCase();
  // GT3 race cars, Vision GT concepts and the Valkyrie: ground effect and big wings.
  if (
    (id.includes('gt3') && !id.includes('911'))
    || id.includes('vision-gt')
    || id.includes('vgt')
    || id.includes('valkyrie')
  ) {
    return { downforceGAt250Kmh: 0.96, maxDownforceG: 1.75, frontAeroShare: 0.43 };
  }
  // Track specials and race-bred cars with big wings.
  if (
    id.includes('p1-gtr')
    || id.includes('one1')
    || id.includes('zonda')
    || id.includes('imola')
    || id.includes('clk-gtr')
    || id.includes('bmw-m3-gtr')
    || id.includes('acr-x')
    || id.includes('911-gt3-rs')
    || id.includes('m4-gts')
  ) {
    return { downforceGAt250Kmh: 0.42, maxDownforceG: 0.9, frontAeroShare: 0.43 };
  }
  // Hypercars and supercars with active aero; widebody kits with wings.
  if (
    spec.category === 'SUPER'
    || id.includes('bugatti')
    || id.includes('chiron')
    || id.includes('voiture')
    || id.includes('huayra')
    || id.includes('laferrari')
    || id.includes('cc850')
    || id.includes('regera')
    || id.includes('720s')
    || id.includes('carrera-gt')
    || id.includes('gt-r-nismo')
    || id.includes('s206')
    || id.includes('lbworks')
    || id.includes('varis')
    || id.includes('md4')
  ) {
    return { downforceGAt250Kmh: 0.19, maxDownforceG: 0.44, frontAeroShare: 0.43 };
  }
  if (spec.category === 'PERFORMANS') {
    return { downforceGAt250Kmh: 0.12, maxDownforceG: 0.26, frontAeroShare: 0.44 };
  }
  if (spec.category === 'SPORT') {
    return { downforceGAt250Kmh: 0.08, maxDownforceG: 0.18, frontAeroShare: 0.44 };
  }
  return { downforceGAt250Kmh: 0.04, maxDownforceG: 0.09, frontAeroShare: 0.45 };
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
  throttle: number;            // 0..1
  /** Throttle while the brakes hold every driven wheel (AWD at a standstill): the engine revs against the slipping clutch, nothing turns. */
  revAgainstBrakes?: boolean;
  grounded: boolean;
  frontWheelSpeed: number;     // m/s, front tyre surface speed
  rearWheelSpeed: number;      // m/s, rear tyre surface speed
  rearSpin: number;            // 0..1 rear wheelspin last step (active AWD split)
}

export interface DrivetrainOutput {
  /** Force the driven tyres are asked to put on the road (N, + forward). Engine braking is negative. */
  driveForce: number;
  /** Share of the drive force sent to the rear axle. */
  rearShare: number;
  /** Engine and gearbox inertia seen at the driven tyres' surface (kg), 0 out of gear. */
  drivelineMass: number;
  /** Highest surface speed the driven wheels can turn at in this gear (m/s). */
  limiterSpeed: number;
}

export class Drivetrain {
  rpm = IDLE_RPM;
  airDrag = 0;
  private massKg = 1450;
  private baseRearShare = 1;
  private isAttesa = false;
  private readonly output: DrivetrainOutput = { driveForce: 0, rearShare: 1, drivelineMass: 0, limiterSpeed: Infinity };

  constructor(private spec: VehicleSpec) {
    this.setVehicle(spec);
  }

  setVehicle(spec: VehicleSpec): void {
    this.spec = spec;
    this.massKg = estimateVehicleMassKg(spec);
    this.baseRearShare = rearDriveShare(spec);
    this.isAttesa = (spec.realSpecs?.drive?.toUpperCase() ?? '').includes('ATTESA');
    this.airDrag = airDragCoefficient(spec);
    this.reset();
  }

  reset(): void {
    this.rpm = IDLE_RPM;
    this.output.driveForce = 0;
  }

  step(input: DrivetrainInput): DrivetrainOutput {
    const { dt, gear } = input;
    const out = this.output;
    // ATTESA-style active split: torque moves forward when the rear wheels slip.
    out.rearShare = this.isAttesa
      ? Math.max(0.5, this.baseRearShare - input.rearSpin * 0.42)
      : this.baseRearShare;
    const inGear = gear !== 0;
    const direction = gear === -1 ? -1 : 1;
    const drivenWheelSpeed = input.rearWheelSpeed * out.rearShare + input.frontWheelSpeed * (1 - out.rearShare);

    let targetRpm: number;
    if (inGear) {
      const wheelRpm = rpmAtSpeed(this.spec, drivenWheelSpeed, gear);
      const gearIndex = gear === -1 ? 1 : gear;
      const clutchRpm = input.throttle > 0 || input.revAgainstBrakes ? 1450 + 1850 / gearIndex : IDLE_RPM;
      targetRpm = Math.max(wheelRpm, clutchRpm);
    } else {
      targetRpm = IDLE_RPM + input.throttle * (REDLINE_RPM - IDLE_RPM);
    }
    const rpmRate = inGear ? 14500 : input.throttle > 0 ? 9500 : 4800;
    this.rpm = approach(this.rpm, Math.min(targetRpm, REDLINE_RPM + 150), rpmRate * dt);

    const topSpeed = inGear ? gearTopSpeed(this.spec, gear) : Infinity;
    out.limiterSpeed = topSpeed * 1.02;
    // Engine angular speed per metre/second of tyre surface speed in this gear.
    const ratio = inGear ? ((REDLINE_RPM * Math.PI) / 30) / Math.max(topSpeed, 0.1) : 0;
    out.drivelineMass = ENGINE_INERTIA * ratio * ratio;

    if (!inGear) {
      out.driveForce = 0;
    } else if (input.throttle > 0) {
      const gearTorque = gear === -1 ? REVERSE_TORQUE : GEAR_TORQUE[gear];
      out.driveForce = direction * input.throttle * this.massKg * this.spec.acceleration * ACCELERATION_SCALE * gearTorque * torqueCurve(this.rpm);
    } else if (Math.abs(drivenWheelSpeed) > 0.5 && input.grounded) {
      // Closed throttle in gear: the engine drags the driven wheels down.
      out.driveForce = -Math.sign(drivenWheelSpeed) * this.massKg * ENGINE_BRAKING / Math.pow(Math.abs(gear), 0.6)
        * Math.min(1, Math.abs(drivenWheelSpeed) / 3);
    } else {
      out.driveForce = 0;
    }
    if (input.revAgainstBrakes) out.driveForce = 0;
    return out;
  }
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
}
