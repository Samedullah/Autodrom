import type { VehicleSpec } from './data';

// Engine, gearbox and the two axles' tyres along the car's length.
//
// Front and rear wheels each have their own surface speed. A driven axle is
// pushed by engine torque and held back by what its tyres can transmit: when
// the torque asks for more, the wheels spin up and keep spinning until torque
// falls (rev limiter, lifted throttle, higher gear) or the car catches up.
// Engine speed follows the driven wheels, so torque really depends on gear and
// rpm: high gear at low speed bogs, the limiter cuts power.

export type Gear = -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;

// Share of the catalog top speed at redline per gear. Top gear runs a little
// long, as on real cars: top speed is set by air drag just below redline.
export const GEAR_SPEED = [0, 0.17, 0.31, 0.48, 0.66, 0.84, 1.03];
const GEAR_TORQUE = [0, 1, 0.82, 0.68, 0.57, 0.49, 0.43];
const REVERSE_TORQUE = 0.48;
const REVERSE_TOP_SPEED = 10; // m/s (36 km/h at the limiter)
const ACCELERATION_SCALE = 0.45;
export const IDLE_RPM = 850;
export const REDLINE_RPM = 7050;
const GRAVITY = 9.81;
// Car mass over effective wheel + drivetrain inertia: how much faster than the
// car a wheel speeds up or slows down under the same unbalanced force.
const WHEEL_INERTIA_RATIO = 6;
const SPIN_START_GRIP = 0.9;      // grip right at breakaway, as a share of peak
const SPIN_FULL_GRIP = 0.72;      // grip of a tyre spinning hard
const WEIGHT_TRANSFER = 0.18;     // centre-of-mass height over wheelbase
const LOCKED_REAR_GRIP = 0.6;     // handbrake: share of rear grip spent braking
// Traction control: torque is trimmed to what the tyres can carry, and cut
// hard when a wheel still breaks loose. It reacts quickly but not instantly,
// so a hard launch still chirps the tyres briefly.
const TCS_GRIP_MARGIN = 1.05;     // torque allowed as a share of the grip limit
const TCS_SPIN_CUT = 0.3;         // torque left while a wheel is spinning
const TCS_CUT_RATE = 14;          // 1/s
const TCS_RESTORE_RATE = 4;       // 1/s

export type DriveLayout = 'RWD' | 'FWD' | 'AWD';

export function driveLayoutOf(spec: VehicleSpec): DriveLayout {
  const drive = spec.realSpecs?.drive?.toUpperCase() ?? '';
  if (drive.includes('FWD')) return 'FWD';
  if (drive.includes('AWD') || drive.includes('QUATTRO')) return 'AWD';
  return 'RWD';
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

// Share of peak torque: weak just off idle, full through the mid range,
// tapering towards redline, and cut by the limiter.
function torqueCurve(rpm: number): number {
  const x = rpm / REDLINE_RPM;
  const rise = 0.18 + 0.82 * smoothstep(x, 0.1, 0.55);
  const taper = 1 - 0.25 * smoothstep(x, 0.75, 1);
  const limiter = 1 - smoothstep(rpm, REDLINE_RPM - 140, REDLINE_RPM + 40);
  return rise * taper * limiter;
}

// Share of the top-gear pull that air resistance takes just below top speed:
// every car still reaches its catalog top speed, but the last stretch is a
// slow, laboured climb.
const TOP_SPEED_DRAG_SHARE = 0.97;
export const ROLLING_RESISTANCE = 0.15; // m/s²

/**
 * Air drag coefficient (m/s² per (m/s)²) matched to the car: at its catalog
 * top speed, rolling plus air resistance use TOP_SPEED_DRAG_SHARE of what 6th
 * gear can still push there.
 */
export function airDragCoefficient(spec: VehicleSpec): number {
  const speed = spec.maxSpeed / 3.6;
  const pull = spec.acceleration * ACCELERATION_SCALE * GEAR_TORQUE[6] * torqueCurve(rpmAtSpeed(spec, speed, 6));
  return Math.max(0, (pull * TOP_SPEED_DRAG_SHARE - ROLLING_RESISTANCE) / (speed * speed));
}

export interface DrivetrainInput {
  dt: number;
  gear: Gear;
  throttle: boolean;
  handbrake: boolean;
  burnout: boolean;   // line lock: fronts braked, driven wheels free to spin
  tcs: boolean;       // traction control on (a burnout overrides it)
  grounded: boolean;
  forwardSpeed: number;  // m/s along the car
  lateralSpeed: number;  // m/s across the car
}

export interface DrivetrainOutput {
  accel: number;      // m/s² the tyres give the car along its length
  frontSpin: number;  // 0..1 how hard the front tyres spin under power
  rearSpin: number;
  tcsActive: boolean; // traction control is cutting torque right now
}

export class Drivetrain {
  rpm = IDLE_RPM;
  /** This car's air drag coefficient, see airDragCoefficient. */
  airDrag = 0;
  frontWheelSpeed = 0;
  rearWheelSpeed = 0;
  private layout: DriveLayout = 'RWD';
  private lastAccel = 0;
  private tcsFactor = 1;
  private readonly output: DrivetrainOutput = { accel: 0, frontSpin: 0, rearSpin: 0, tcsActive: false };

  constructor(private spec: VehicleSpec) {
    this.setVehicle(spec);
  }

  setVehicle(spec: VehicleSpec): void {
    this.spec = spec;
    this.layout = driveLayoutOf(spec);
    this.airDrag = airDragCoefficient(spec);
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
    const rearShare = this.layout === 'RWD' ? 1 : this.layout === 'FWD' ? 0 : 0.6;
    const inGear = gear !== 0;
    const direction = gear === -1 ? -1 : 1;

    // Engine speed: locked to the driven wheels, except that the clutch slips
    // to keep it off idle (and at a launch rpm when the throttle is down).
    const drivenSpeed = this.frontWheelSpeed * (1 - rearShare) + this.rearWheelSpeed * rearShare;
    let targetRpm: number;
    if (inGear) {
      const wheelRpm = rpmAtSpeed(this.spec, drivenSpeed, gear);
      const gearIndex = gear === -1 ? 1 : gear;
      const clutchRpm = input.throttle ? 1300 + 1700 / gearIndex : IDLE_RPM;
      targetRpm = Math.max(wheelRpm, clutchRpm);
    } else {
      targetRpm = input.throttle ? REDLINE_RPM : IDLE_RPM;
    }
    const rpmRate = inGear ? 14000 : input.throttle ? 9000 : 4500;
    this.rpm = approach(this.rpm, Math.min(targetRpm, REDLINE_RPM + 150), rpmRate * dt);

    // Grip per axle: static 50/50, shifted rearwards under acceleration, and
    // reduced by the friction circle while the car is sliding sideways.
    const mu = 1.05 + 0.25 * this.spec.handling;
    const rearLoad = Math.min(0.7, Math.max(0.3, 0.5 + WEIGHT_TRANSFER * this.lastAccel / GRAVITY));
    const slipAngle = Math.atan2(Math.abs(input.lateralSpeed), Math.max(Math.abs(forwardSpeed), 1));
    const sideUse = Math.min(0.85, slipAngle / 0.35);
    const circle = Math.sqrt(1 - sideUse * sideUse);
    const frontLimit = mu * GRAVITY * (1 - rearLoad) * circle;
    const rearLimit = mu * GRAVITY * rearLoad * circle;
    const topSpeed = inGear ? gearTopSpeed(this.spec, gear) * 1.02 : Infinity;

    const gearTorque = gear === -1 ? REVERSE_TORQUE : GEAR_TORQUE[Math.max(0, gear)];
    let driveAccel = input.throttle && inGear
      ? direction * this.spec.acceleration * ACCELERATION_SCALE * gearTorque * torqueCurve(this.rpm)
      : 0;
    let tcsTarget = 1;
    if (input.tcs && !input.burnout && input.grounded && driveAccel !== 0) {
      const demand = Math.abs(driveAccel);
      if (rearShare > 0) tcsTarget = Math.min(tcsTarget, rearLimit * TCS_GRIP_MARGIN / (demand * rearShare));
      if (rearShare < 1) tcsTarget = Math.min(tcsTarget, frontLimit * TCS_GRIP_MARGIN / (demand * (1 - rearShare)));
      const spinning = Math.max(
        rearShare > 0 ? powerSpin(this.rearWheelSpeed, forwardSpeed, direction) : 0,
        rearShare < 1 ? powerSpin(this.frontWheelSpeed, forwardSpeed, direction) : 0,
      );
      if (spinning > 0.05) tcsTarget = Math.min(tcsTarget, TCS_SPIN_CUT);
    }
    tcsTarget = Math.min(1, tcsTarget);
    this.tcsFactor = approach(this.tcsFactor, tcsTarget, (tcsTarget < this.tcsFactor ? TCS_CUT_RATE : TCS_RESTORE_RATE) * dt);
    driveAccel *= this.tcsFactor;

    let accel = 0;
    const front = this.stepAxle(this.frontWheelSpeed, forwardSpeed, driveAccel * (1 - rearShare), frontLimit, input, topSpeed);
    this.frontWheelSpeed = front.speed;
    accel += front.traction;
    if (input.handbrake && input.grounded) {
      this.rearWheelSpeed = 0;
      if (Math.abs(forwardSpeed) > 0.3) accel -= Math.sign(forwardSpeed) * rearLimit * LOCKED_REAR_GRIP;
    } else {
      const rear = this.stepAxle(this.rearWheelSpeed, forwardSpeed, driveAccel * rearShare, rearLimit, input, topSpeed);
      this.rearWheelSpeed = rear.speed;
      accel += rear.traction;
    }
    this.lastAccel = input.burnout ? 0 : accel;

    this.output.accel = input.grounded ? accel : 0;
    this.output.tcsActive = driveAccel !== 0 && this.tcsFactor < 0.97;
    this.output.frontSpin = powerSpin(this.frontWheelSpeed, forwardSpeed, direction);
    this.output.rearSpin = input.handbrake ? 0 : powerSpin(this.rearWheelSpeed, forwardSpeed, direction);
    return this.output;
  }

  // One axle's wheel speed and the force (as car acceleration) its tyres pass
  // to the road. Below the grip limit the tyre rolls with the road; past it the
  // wheel spins and grip falls off with how hard it spins.
  private stepAxle(
    wheel: number, ground: number, drive: number, limit: number, input: DrivetrainInput, topSpeed: number,
  ): { speed: number; traction: number } {
    const { dt } = input;
    if (!input.grounded) {
      return { speed: clampMagnitude(wheel + drive * WHEEL_INERTIA_RATIO * dt, topSpeed), traction: 0 };
    }
    // A clutch kick against the brakes always breaks the driven tyres loose.
    if (input.burnout && drive !== 0) limit = Math.min(limit, Math.abs(drive) * 0.8);
    const threshold = 0.5 + 0.06 * Math.abs(ground);
    const slip = wheel - ground;
    if (Math.abs(slip) <= threshold) {
      if (Math.abs(drive) <= limit) return { speed: ground, traction: drive };
      const traction = Math.sign(drive) * limit * SPIN_START_GRIP;
      return { speed: clampMagnitude(wheel + (drive - traction) * WHEEL_INERTIA_RATIO * dt, topSpeed), traction };
    }
    const grip = SPIN_START_GRIP - (SPIN_START_GRIP - SPIN_FULL_GRIP) * smoothstep(Math.abs(slip), threshold, 8);
    const traction = Math.sign(slip) * limit * grip;
    const next = clampMagnitude(wheel + (drive - traction) * WHEEL_INERTIA_RATIO * dt, topSpeed);
    const nextSlip = next - ground;
    // The spinning wheel has slowed back to road speed: it grips again.
    if (nextSlip * slip <= 0 || Math.abs(nextSlip) <= threshold) {
      return { speed: ground, traction: Math.max(-limit, Math.min(limit, drive)) };
    }
    return { speed: next, traction };
  }
}

// Wheels turning faster than the road in the driving direction: 0 rolling, 1 spinning hard.
function powerSpin(wheel: number, ground: number, direction: number): number {
  const slip = (wheel - ground) * direction;
  return smoothstep(slip, 0.6 + 0.06 * Math.abs(ground), 4.5 + 0.06 * Math.abs(ground));
}

function clampMagnitude(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
}
