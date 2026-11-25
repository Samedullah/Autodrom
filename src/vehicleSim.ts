import { ECONOMY, type VehicleSpec } from './data';
import { Chassis, emptyChassisOutput, type ChassisBody, type ChassisOutput } from './chassis';
import { Drivetrain, GEAR_SPEED, driveLayoutOf, rpmAtSpeed, type Gear } from './drivetrain';

// Vehicle dynamics without rendering: driver controls in, car motion out.
// The game (engine.ts) and the physics tests drive the same code.

export interface DriverControls {
  /** 0..1 (keys give 0 or 1). */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, + steers towards the car's right vector (+X), like the A key. */
  steer: number;
  handbrake: boolean;
}

export interface PlanarVelocity {
  x: number;
  z: number;
}

const DOWNSHIFT_SAFE_SPEED_FACTOR = 0.9;
const AUTO_UPSHIFT_RPM = 6700;
const AUTO_DOWNSHIFT_RPM = 2500;

export class VehicleSim {
  readonly chassis: Chassis;
  readonly drivetrain: Drivetrain;
  readonly body: ChassisBody;
  gear: Gear = 1;
  automatic = false;
  tcsEnabled = true;
  /** Front wheel angle (rad), counter-steer included. */
  frontWheelAngle = 0;
  /** Gas and brake together at a standstill: the driven wheels spin, the car stays. */
  burnout = false;
  private spec: VehicleSpec;
  private handbrakeBlend = 0;
  private chassisOutput: ChassisOutput = emptyChassisOutput();

  constructor(spec: VehicleSpec, velocity: PlanarVelocity, yaw = 0) {
    this.spec = spec;
    this.drivetrain = new Drivetrain(spec);
    this.chassis = new Chassis(spec);
    this.body = { velocity, yaw, yawRate: 0 };
  }

  get output(): ChassisOutput {
    return this.chassisOutput;
  }

  get vehicle(): VehicleSpec {
    return this.spec;
  }

  /** Speed along the car's nose (m/s, negative when reversing). */
  get forwardSpeed(): number {
    return this.body.velocity.x * Math.sin(this.body.yaw) + this.body.velocity.z * Math.cos(this.body.yaw);
  }

  /** Speed across the car (m/s, along the right vector). */
  get lateralSpeed(): number {
    return this.body.velocity.x * Math.cos(this.body.yaw) - this.body.velocity.z * Math.sin(this.body.yaw);
  }

  setVehicle(spec: VehicleSpec): void {
    this.spec = spec;
    this.gear = 1;
    this.drivetrain.setVehicle(spec);
    this.chassis.setVehicle(spec);
    this.reset();
  }

  /** Back to rest: wheels stopped, engine at idle, steering centred. */
  reset(): void {
    this.drivetrain.reset();
    this.chassis.reset();
    this.chassisOutput = this.chassis.step(this.body, emptyInput(0));
    this.body.yawRate = 0;
    this.frontWheelAngle = 0;
    this.handbrakeBlend = 0;
    this.burnout = false;
  }

  shiftUp(): void {
    if (this.automatic) return;
    this.gear = (this.gear === -1 ? 0 : Math.min(6, Math.max(1, this.gear + 1))) as Gear;
  }

  shiftDown(): void {
    if (this.automatic) return;
    this.shiftDownIfSafe();
  }

  step(dt: number, controls: DriverControls, grounded: boolean, wheelSuspensionLoads?: readonly number[]): ChassisOutput {
    // In the air the tyres have nothing to push against.
    const throttle = grounded ? clamp01(controls.throttle) : 0;
    const brakeInput = grounded ? clamp01(controls.brake) : 0;
    const gas = throttle > 0.05;
    const brake = brakeInput > 0.05;
    const steerInput = grounded ? controls.steer : 0;
    const handbrake = grounded && controls.handbrake;
    // The handbrake lever builds rear lock progressively and releases quickly when let go.
    this.handbrakeBlend = approach(this.handbrakeBlend, handbrake ? 1 : 0, dt * (handbrake ? 7.0 : 4.8));
    const longitudinal = this.forwardSpeed;
    const lateral = this.lateralSpeed;
    if (this.automatic) this.updateAutomaticTransmission(longitudinal, gas);

    // A burnout holds the car on the front brakes while the driven wheels spin.
    // With every wheel driven (AWD) the brakes hold the driven wheels too, so gas
    // and brake together just rev the engine against them.
    const standingOnBoth = gas && brake && Math.hypot(this.body.velocity.x, this.body.velocity.z) < 1.15 && this.gear !== 0;
    this.burnout = standingOnBoth && driveLayoutOf(this.spec) !== 'AWD';
    const previous = this.chassisOutput;
    const drive = this.drivetrain.step({
      dt,
      gear: this.gear,
      throttle: !brake || this.burnout || this.gear === 0 ? throttle : 0,
      revAgainstBrakes: standingOnBoth && !this.burnout,
      grounded,
      frontWheelSpeed: previous.frontWheelSpeed,
      rearWheelSpeed: previous.rearWheelSpeed,
      rearSpin: previous.rearSpin,
    });

    // Speed-sensitive steering, self-aligning caster, and counter-steer assistance.
    this.frontWheelAngle = this.chassis.updateSteering(
      this.frontWheelAngle,
      steerInput,
      longitudinal,
      lateral,
      this.body.yawRate,
      this.spec.handling,
      this.spec.steering,
      dt,
    );

    this.chassisOutput = this.chassis.step(this.body, {
      dt,
      steer: this.frontWheelAngle,
      grounded,
      frontDriveForce: drive.driveForce * (1 - drive.rearShare),
      rearDriveForce: drive.driveForce * drive.rearShare,
      drivelineMass: drive.drivelineMass,
      rearShare: drive.rearShare,
      limiterSpeed: drive.limiterSpeed,
      brake: brakeInput,
      lineLock: this.burnout,
      handbrake: this.handbrakeBlend,
      tcs: this.tcsEnabled && !this.burnout,
      wheelSuspensionLoads,
    });

    // Never faster than the car's top speed (a long downhill or a tow cannot overspeed it).
    const absoluteLimit = this.spec.maxSpeed / ECONOMY.kmhPerUnit + 2;
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);
    if (speed > absoluteLimit) {
      this.body.velocity.x *= absoluteLimit / speed;
      this.body.velocity.z *= absoluteLimit / speed;
    }
    return this.chassisOutput;
  }

  private shiftDownIfSafe(): boolean {
    const nextGear = this.gear === 1 ? 0 : Math.max(-1, this.gear - 1) as Gear;
    const speedKmh = Math.hypot(this.body.velocity.x, this.body.velocity.z) * ECONOMY.kmhPerUnit;
    if (nextGear > 0) {
      const nextGearSpeedLimit = this.spec.maxSpeed * GEAR_SPEED[nextGear];
      if (speedKmh > nextGearSpeedLimit * DOWNSHIFT_SAFE_SPEED_FACTOR) return false;
    } else if (nextGear === -1 && speedKmh > 5) {
      return false;
    }
    this.gear = nextGear;
    return true;
  }

  private updateAutomaticTransmission(longitudinal: number, gas: boolean): void {
    if (this.gear < 1) {
      this.gear = 1;
      return;
    }
    // Shift on road speed, not wheel speed: a spinning tyre should not upshift.
    const rpm = rpmAtSpeed(this.spec, longitudinal, this.gear);
    if (gas && rpm >= AUTO_UPSHIFT_RPM && this.gear < 6) {
      this.gear = (this.gear + 1) as Gear;
    } else if (this.gear > 1 && rpm <= AUTO_DOWNSHIFT_RPM) {
      this.shiftDownIfSafe();
    }
  }
}

function emptyInput(dt: number) {
  return {
    dt, steer: 0, grounded: true, frontDriveForce: 0, rearDriveForce: 0, drivelineMass: 0, rearShare: 1,
    limiterSpeed: Infinity, brake: 0, lineLock: false, handbrake: 0, tcs: false,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function approach(value: number, target: number, delta: number): number {
  if (value < target) return Math.min(target, value + delta);
  return Math.max(target, value - delta);
}
