// Scripted driving on a flat, endless plane for the physics tests.
import { VEHICLES, type VehicleSpec } from '../src/data';
import { rpmAtSpeed, type Gear } from '../src/drivetrain';
import type { TireProfileId } from '../src/chassis';
import { VehicleSim, type DriverControls } from '../src/vehicleSim';

export const DT = 1 / 60;
export const G = 9.81;
export const COAST: DriverControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

export function car(id: string): VehicleSpec {
  const spec = VEHICLES.find((vehicle) => vehicle.id === id);
  if (!spec) throw new Error(`unknown car ${id}`);
  return spec;
}

export interface SimOptions {
  kmh?: number;
  automatic?: boolean;
  tcs?: boolean;
  tires?: TireProfileId;
  gear?: Gear;
}

/** A car on the plane, heading +Z, already rolling at `kmh` in a sensible gear. */
export function makeSim(id: string, options: SimOptions = {}): VehicleSim {
  const spec = car(id);
  const velocity = { x: 0, z: 0 };
  const sim = new VehicleSim(spec, velocity, 0);
  sim.automatic = options.automatic ?? true;
  sim.tcsEnabled = options.tcs ?? true;
  if (options.tires) sim.chassis.applyProfile(options.tires);
  const speed = (options.kmh ?? 0) / 3.6;
  sim.gear = options.gear ?? gearFor(spec, speed);
  if (speed > 0) {
    // Let the wheels spin up to road speed while the car is held at it.
    for (let i = 0; i < 30; i += 1) {
      velocity.x = 0;
      velocity.z = speed;
      sim.body.yaw = 0;
      sim.body.yawRate = 0;
      sim.step(DT, COAST, true);
    }
    velocity.x = 0;
    velocity.z = speed;
    sim.body.yaw = 0;
    sim.body.yawRate = 0;
  }
  return sim;
}

export function gearFor(spec: VehicleSpec, speed: number): Gear {
  for (let gear = 1; gear <= 6; gear += 1) {
    if (rpmAtSpeed(spec, speed, gear as Gear) < 6200 || gear === 6) return gear as Gear;
  }
  return 6;
}

export function speedOf(sim: VehicleSim): number {
  return Math.hypot(sim.body.velocity.x, sim.body.velocity.z);
}

/** Body slip angle (deg): how far the velocity points away from the nose. */
export function slipAngleDeg(sim: VehicleSim): number {
  return Math.atan2(Math.abs(sim.lateralSpeed), Math.max(Math.abs(sim.forwardSpeed), 0.5)) * 180 / Math.PI;
}

export function lateralG(sim: VehicleSim): number {
  return Math.abs(speedOf(sim) * sim.body.yawRate) / G;
}

/** Keeps the speed constant (a driver feathering the throttle) without changing the direction. */
export function holdSpeed(sim: VehicleSim, speed: number): void {
  const current = speedOf(sim);
  if (current < 0.1) return;
  sim.body.velocity.x *= speed / current;
  sim.body.velocity.z *= speed / current;
}

/** Steady cornering at a held speed with the steering key held: average lateral g at the end. */
export function skidpadG(id: string, kmh: number, options: SimOptions = {}): number {
  const sim = makeSim(id, { ...options, kmh });
  const speed = kmh / 3.6;
  let sum = 0;
  let samples = 0;
  let integral = 0;
  for (let t = 0; t < 6; t += DT) {
    // A driver feathering the throttle to hold the speed.
    const error = speed - speedOf(sim);
    integral = Math.min(2, Math.max(-2, integral + error * DT));
    const throttle = Math.min(1, Math.max(0, 0.15 + 0.6 * error + 0.8 * integral));
    sim.step(DT, { throttle, brake: 0, steer: 1, handbrake: false }, true);
    holdSpeed(sim, speed);
    if (t > 4.5) {
      sum += lateralG(sim);
      samples += 1;
    }
  }
  return sum / samples;
}

/** Seconds from a standstill to `kmh` with the gas held (automatic gearbox). */
export function timeTo(id: string, kmh: number, options: SimOptions = {}): number {
  const sim = makeSim(id, options);
  for (let t = 0; t < 60; t += DT) {
    sim.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, true);
    if (speedOf(sim) * 3.6 >= kmh) return t + DT;
  }
  return Infinity;
}

/** Metres to stop from `kmh` with the brake held (ABS). */
export function brakingDistance(id: string, kmh: number, steer = 0): number {
  const sim = makeSim(id, { kmh });
  let distance = 0;
  for (let t = 0; t < 20; t += DT) {
    sim.step(DT, { throttle: 0, brake: 1, steer, handbrake: false }, true);
    distance += speedOf(sim) * DT;
    if (speedOf(sim) < 0.05) return distance;
  }
  return Infinity;
}

export function topSpeedKmh(id: string): number {
  const sim = makeSim(id, { kmh: car(id).maxSpeed * 0.8 });
  for (let t = 0; t < 90; t += DT) sim.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false }, true);
  return speedOf(sim) * 3.6;
}

export interface Trace {
  maxSlipDeg: number;
  maxYawRate: number;
  finalSlipDeg: number;
  finalYawRate: number;
  finalKmh: number;
  spun: boolean;
}

/** Runs a control script and records how far the car got out of shape. */
export function drive(sim: VehicleSim, seconds: number, controls: (t: number) => DriverControls): Trace {
  let maxSlip = 0;
  let maxYaw = 0;
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT, controls(t), true);
    maxSlip = Math.max(maxSlip, slipAngleDeg(sim));
    maxYaw = Math.max(maxYaw, Math.abs(sim.body.yawRate));
  }
  return {
    maxSlipDeg: maxSlip,
    maxYawRate: maxYaw,
    finalSlipDeg: slipAngleDeg(sim),
    finalYawRate: sim.body.yawRate,
    finalKmh: speedOf(sim) * 3.6,
    spun: maxSlip > 60 || sim.forwardSpeed < 0,
  };
}
