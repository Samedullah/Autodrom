// Vehicle physics acceptance tests: real-world ballparks for grip, braking and
// acceleration, and the handling behaviours the game relies on.
// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DT,
  brakingDistance,
  drive,
  makeSim,
  skidpadG,
  slipAngleDeg,
  speedOf,
  timeTo,
  topSpeedKmh,
} from './drive';

const ROAD = ['volkswagen-golf-gti-mk7', 'bmw-m4-competition-2025', 'toyota-supra-a80', 'mclaren-720s'];

function within(value: number, min: number, max: number, label: string): void {
  assert.ok(value >= min && value <= max, `${label}: ${value.toFixed(2)} not in [${min}, ${max}]`);
}

test('road cars corner at realistic grip levels (0.80–1.30 g)', () => {
  for (const id of ROAD) {
    within(skidpadG(id, 60), 0.80, 1.30, `${id} @60`);
    within(skidpadG(id, 120), 0.80, 1.30, `${id} @120`);
  }
  within(skidpadG('cedar-mini', 60), 0.65, 0.88, 'economy car @60');
});

test('100–160 km/h cornering: crisp turn-in bite and sustained lateral grip', () => {
  for (const kmh of [100, 130, 155]) {
    const simM4 = makeSim('bmw-m4-competition-2025', { kmh });
    drive(simM4, 0.25, () => ({ throttle: 0.4, brake: 0, steer: 1, handbrake: false }));
    const turnInG = Math.abs(speedOf(simM4) * simM4.body.yawRate) / 9.81;
    assert.ok(turnInG > 0.95, `M4 turn-in @${kmh} km/h too sluggish at 0.25 s: ${turnInG.toFixed(2)} g`);
    assert.ok(skidpadG('bmw-m4-competition-2025', kmh) > 1.08, `M4 steady @${kmh} km/h too low`);
    assert.ok(skidpadG('mclaren-720s', kmh) > 1.12, `720S steady @${kmh} km/h too low`);
    assert.ok(skidpadG('volkswagen-golf-gti-mk7', kmh) > 0.90, `Golf GTI steady @${kmh} km/h too low`);
  }
});

test('tight corners: full lock at 25 km/h bites on the front tyres instead of ploughing', () => {
  for (const id of ROAD) {
    const sim = makeSim(id, { kmh: 25 });
    const speed = 25 / 3.6;
    let integral = 0;
    for (let t = 0; t < 4; t += DT) {
      const error = speed - speedOf(sim);
      integral = Math.min(2, Math.max(-2, integral + error * DT));
      sim.step(DT, { throttle: Math.min(1, Math.max(0, 0.15 + 0.6 * error + 0.8 * integral)), brake: 0, steer: 1, handbrake: false }, true);
    }
    const radius = speedOf(sim) / Math.abs(sim.body.yawRate);
    const tires = sim.chassis.getDebugState().telemetry;
    const frontSlip = Math.abs(tires[0].slipAngleDeg + tires[1].slipAngleDeg) / 2;
    const peak = sim.chassis.getDebugState().tires[0].peakSlipAngleDeg;
    assert.ok(radius < 6.8, `${id} turning radius at 25 km/h ${radius.toFixed(1)} m`);
    assert.ok(frontSlip < peak * 1.3, `${id} front tyres scrub at ${frontSlip.toFixed(1)}° (peak ${peak}°)`);
  }
});

test('downforce makes race and track cars grip harder the faster they go', () => {
  const slow = skidpadG('mercedes-amg-gt3-2016', 80);
  const fast = skidpadG('mercedes-amg-gt3-2016', 250);
  within(slow, 1.1, 1.5, 'GT3 @80');
  assert.ok(fast > slow * 1.35, `GT3 should gain grip with speed: ${slow.toFixed(2)} -> ${fast.toFixed(2)}`);
  within(fast, 1.6, 2.4, 'GT3 @250');
  const rsSlow = skidpadG('porsche-911-gt3-rs', 80);
  const rsFast = skidpadG('porsche-911-gt3-rs', 250);
  assert.ok(rsFast > rsSlow * 1.2, `911 GT3 RS should gain grip with speed: ${rsSlow.toFixed(2)} -> ${rsFast.toFixed(2)}`);
  // A road car without wings barely changes.
  const m4Slow = skidpadG('bmw-m4-competition-2025', 80);
  const m4Fast = skidpadG('bmw-m4-competition-2025', 250);
  within(m4Fast / m4Slow, 0.9, 1.2, 'M4 high/low speed grip ratio');
});

test('full throttle and full lock at 160 km/h does not spin the car (traction control on)', () => {
  for (const id of [...ROAD, 'porsche-911-gt3-rs', 'dodge-charger-srt-hellcat-2015']) {
    const trace = drive(makeSim(id, { kmh: 160 }), 4, () => ({ throttle: 1, brake: 0, steer: 1, handbrake: false }));
    assert.ok(!trace.spun && trace.maxSlipDeg < 12, `${id} lost it at 160: max slip ${trace.maxSlipDeg.toFixed(1)}°`);
  }
});

test('turning in at 250 km/h stays on the grip limit instead of sliding', () => {
  for (const id of ['mclaren-720s', 'porsche-911-gt3-rs', 'mercedes-amg-gt3-2016', 'bugatti-chiron-ss-300']) {
    const trace = drive(makeSim(id, { kmh: 250 }), 4, () => ({ throttle: 0.4, brake: 0, steer: 1, handbrake: false }));
    assert.ok(trace.maxSlipDeg < 10, `${id} slid at 250: max slip ${trace.maxSlipDeg.toFixed(1)}°`);
  }
});

test('a lane change at 200 km/h settles straight without weaving', () => {
  for (const id of ROAD) {
    const sim = makeSim(id, { kmh: 200 });
    const trace = drive(sim, 4, (t) => ({ throttle: 0.5, brake: 0, steer: t < 0.6 ? 1 : t < 1.4 ? -1 : 0, handbrake: false }));
    assert.ok(trace.maxSlipDeg < 8, `${id} lane change slip ${trace.maxSlipDeg.toFixed(1)}°`);
    assert.ok(Math.abs(trace.finalYawRate) < 0.02, `${id} still yawing ${trace.finalYawRate.toFixed(3)} rad/s`);
  }
});

test('lifting off mid-corner tightens the line without spinning', () => {
  for (const id of ROAD) {
    const sim = makeSim(id, { kmh: 140 });
    drive(sim, 2, () => ({ throttle: 0.6, brake: 0, steer: 1, handbrake: false }));
    const trace = drive(sim, 3, () => ({ throttle: 0, brake: 0, steer: 1, handbrake: false }));
    assert.ok(trace.maxSlipDeg < 10, `${id} lift-off slip ${trace.maxSlipDeg.toFixed(1)}°`);
  }
});

test('lifting off on semi-slicks tucks the nose in: tighter line, rear keeps its grip', () => {
  for (const [id, kmh, gear] of [['mercedes-amg-gt3-2016', 70, 2], ['mercedes-amg-gt3-2016', 100, 3], ['bmw-m4-competition-2025', 70, 2]] as const) {
    const sim = makeSim(id, { kmh, automatic: false, gear, tires: 'semi-slick' });
    drive(sim, 1.5, () => ({ throttle: 1, brake: 0, steer: 1, handbrake: false }));
    const radiusOnPower = speedOf(sim) / Math.abs(sim.body.yawRate);
    const trace = drive(sim, 0.8, () => ({ throttle: 0, brake: 0, steer: 1, handbrake: false }));
    const radiusLifted = speedOf(sim) / Math.abs(sim.body.yawRate);
    assert.ok(radiusLifted < radiusOnPower, `${id}: lift should tighten the line (${radiusOnPower.toFixed(0)} -> ${radiusLifted.toFixed(0)} m)`);
    assert.ok(trace.maxSlipDeg < 5, `${id}: slid ${trace.maxSlipDeg.toFixed(1)}° after lifting`);
  }
});

test('ABS braking: 100-0 km/h in real-world distances, and the car still steers', () => {
  for (const id of ROAD) within(brakingDistance(id, 100), 30, 42, `${id} 100-0 m`);
  within(brakingDistance('cedar-mini', 100), 36, 50, 'economy car 100-0 m');
  within(brakingDistance('mercedes-amg-gt3-2016', 100), 22, 32, 'GT3 100-0 m');
  // Braking while turning keeps turning (wheels do not lock).
  const sim = makeSim('bmw-m4-competition-2025', { kmh: 120 });
  drive(sim, 1, () => ({ throttle: 0.3, brake: 0, steer: 1, handbrake: false }));
  const before = sim.body.yaw;
  drive(sim, 1.5, () => ({ throttle: 0, brake: 1, steer: 1, handbrake: false }));
  assert.ok(Math.abs(sim.body.yaw - before) > 0.35, 'car should keep turning under ABS braking');
});

test('braking to a stop stays stopped', () => {
  const sim = makeSim('bmw-m4-competition-2025', { kmh: 30 });
  drive(sim, 4, () => ({ throttle: 0, brake: 1, steer: 0, handbrake: false }));
  assert.ok(speedOf(sim) < 1e-3, `still moving at ${speedOf(sim)} m/s`);
});

test('acceleration and top speed: tyres limit the launch, power the top end', () => {
  within(timeTo('volkswagen-golf-gti-mk7', 100), 5.5, 7.5, 'Golf GTI 0-100 s');
  within(timeTo('bmw-m4-competition-2025', 100), 3.8, 5.5, 'M4 0-100 s');
  within(timeTo('bugatti-chiron-ss-300', 100), 2.3, 3.3, 'Chiron 0-100 s');
  // Traction control gets a powerful RWD car off the line quicker than wheelspin does.
  assert.ok(timeTo('bmw-m4-competition-2025', 100) < timeTo('bmw-m4-competition-2025', 100, { tcs: false }));
  for (const id of ['volkswagen-golf-gti-mk7', 'bmw-m4-competition-2025', 'bugatti-chiron-ss-300']) {
    const top = topSpeedKmh(id);
    const spec = makeSim(id).vehicle;
    within(top / spec.maxSpeed, 0.95, 1.01, `${id} top speed share`);
  }
});

test('grip ranking follows the tyre compound', () => {
  const street = skidpadG('bmw-m4-competition-2025', 80, { tires: 'street' });
  const sport = skidpadG('bmw-m4-competition-2025', 80, { tires: 'sport' });
  const semi = skidpadG('bmw-m4-competition-2025', 80, { tires: 'semi-slick' });
  assert.ok(street < sport && sport < semi, `street ${street.toFixed(2)} < sport ${sport.toFixed(2)} < semi ${semi.toFixed(2)}`);
});

test('drifting still works: handbrake or power with TCS off breaks the rear loose, countersteer holds it', () => {
  const hand = drive(makeSim('bmw-m4-competition-2025', { kmh: 60 }), 1.2, (t) => ({ throttle: 0, brake: 0, steer: 1, handbrake: t < 0.6 }));
  assert.ok(hand.maxSlipDeg > 20, `handbrake turn slip ${hand.maxSlipDeg.toFixed(1)}°`);

  const power = drive(makeSim('bmw-m4-competition-2025', { kmh: 50, tcs: false, automatic: false, gear: 2 }), 1.5,
    () => ({ throttle: 1, brake: 0, steer: 1, handbrake: false }));
  assert.ok(power.maxSlipDeg > 20, `power oversteer slip ${power.maxSlipDeg.toFixed(1)}°`);

  // A keyboard driver holding a drift: kick, then throttle with countersteer.
  const sim = makeSim('bmw-m4-competition-2025', { kmh: 55, tcs: false, automatic: false, gear: 2 });
  let heldSeconds = 0;
  for (let t = 0; t < 4; t += DT) {
    const angle = slipAngleDeg(sim);
    const steer = t < 0.4 ? 1 : angle > 32 ? -1 : angle > 18 ? 0 : 1;
    sim.step(DT, { throttle: angle > 45 ? 0.3 : 1, brake: 0, steer, handbrake: t < 0.4 }, true);
    if (t > 0.8 && slipAngleDeg(sim) > 10 && slipAngleDeg(sim) < 50) heldSeconds += DT;
    assert.ok(sim.forwardSpeed > 0, 'spun round while holding the drift');
  }
  assert.ok(heldSeconds > 2, `drift held for ${heldSeconds.toFixed(1)} s`);
});

test('steering into a drift tightens the line instead of running wide, without spinning', () => {
  for (const [id, kmh, gear] of [['bmw-m4-competition-2025', 50, 2], ['bmw-m4-competition-2025', 80, 3], ['nissan-350z-2003', 80, 3]] as const) {
    const pathTurn = (steer: number): { turned: number; spun: boolean } => {
      const sim = makeSim(id, { kmh, tcs: false, automatic: false, gear });
      const heading = (): number => Math.atan2(sim.body.velocity.x, sim.body.velocity.z);
      for (let t = 0; t < 0.5; t += DT) sim.step(DT, { throttle: 0.6, brake: 0, steer: 1, handbrake: t < 0.35 }, true);
      const start = heading();
      const trace = drive(sim, 1.5, () => ({ throttle: 0.75, brake: 0, steer, handbrake: false }));
      return { turned: Math.abs(heading() - start) * 180 / Math.PI, spun: trace.spun };
    };
    const neutral = pathTurn(0);
    const into = pathTurn(1);
    assert.ok(!into.spun, `${id} @${kmh}: spun while steering into the drift`);
    assert.ok(into.turned > neutral.turned + 10, `${id} @${kmh}: steering in turned the path ${into.turned.toFixed(0)}° vs ${neutral.turned.toFixed(0)}° neutral`);
  }
});

test('RWD drift: rear tyres drop to kinetic sliding grip (~60–75%) and sustain drift on throttle lift-off', () => {
  const sim = makeSim('bmw-m4-competition-2025', { kmh: 75, tcs: false, automatic: false, gear: 2 });
  // Initiate drift with handbrake, then settle on power
  drive(sim, 0.35, () => ({ throttle: 0.8, brake: 0, steer: 1, handbrake: true }));
  drive(sim, 0.65, () => ({ throttle: 1.0, brake: 0, steer: 0, handbrake: false }));
  const entrySlip = slipAngleDeg(sim);
  const telOnGas = sim.chassis.getDebugState().telemetry;
  const rearGripOnGas = 0.5 * (telOnGas[2].gripUtilization + telOnGas[3].gripUtilization);
  assert.ok(entrySlip > 18, `expected active drift before lift-off, got ${entrySlip.toFixed(1)}°`);
  assert.ok(rearGripOnGas < 0.78, `sliding rear tyres should not report ~93% grip, got ${(rearGripOnGas * 100).toFixed(0)}%`);

  // Lift off throttle completely for 1.0 s: drift should glide smoothly instead of snapping straight
  const liftTrace = drive(sim, 1.0, () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false }));
  const telOffGas = sim.chassis.getDebugState().telemetry;
  const rearGripOffGas = 0.5 * (telOffGas[2].gripUtilization + telOffGas[3].gripUtilization);
  assert.ok(!liftTrace.spun, 'spun after lifting off mid-drift');
  assert.ok(slipAngleDeg(sim) > 14, `drift snapped shut on lift-off (${entrySlip.toFixed(1)}° -> ${slipAngleDeg(sim).toFixed(1)}°)`);
  assert.ok(rearGripOffGas < 0.78, `off-throttle sliding rear grip jumped to ${(rearGripOffGas * 100).toFixed(0)}%`);
});

test('burnout: RWD spins the rears on the spot, AWD just revs', () => {
  const rwd = makeSim('bmw-m4-competition-2025');
  let moved = 0;
  for (let t = 0; t < 3; t += DT) {
    rwd.step(DT, { throttle: 1, brake: 1, steer: 0, handbrake: false }, true);
    moved += speedOf(rwd) * DT;
  }
  assert.ok(rwd.burnout && rwd.output.rearSpin > 0.9, 'rear wheels should spin');
  assert.ok(moved < 1, `RWD burnout crept ${moved.toFixed(2)} m`);

  const awd = makeSim('lamborghini-gallardo-lp560-4-spyder');
  for (let t = 0; t < 2; t += DT) awd.step(DT, { throttle: 1, brake: 1, steer: 0, handbrake: false }, true);
  assert.ok(!awd.burnout && speedOf(awd) < 0.05, 'AWD stays put');
});

test('tyre forces never exceed the friction circle', () => {
  const sim = makeSim('bmw-m4-competition-2025', { kmh: 90, tcs: false, automatic: false, gear: 2 });
  for (let t = 0; t < 4; t += DT) {
    sim.step(DT, { throttle: 1, brake: t > 2.5 ? 1 : 0, steer: t < 2 ? 1 : -1, handbrake: t > 1 && t < 1.3 }, true);
    for (const tire of sim.chassis.getDebugState().telemetry) {
      assert.ok(tire.gripUtilization <= 1.0001, `grip use ${tire.gripUtilization}`);
    }
  }
});

test('reverse gear backs up to the reverse limiter', () => {
  const sim = makeSim('bmw-m4-competition-2025', { automatic: false, gear: -1 });
  drive(sim, 4, () => ({ throttle: 1, brake: 0, steer: 0, handbrake: false }));
  within(-sim.forwardSpeed, 8, 10.5, 'reverse speed m/s');
});
