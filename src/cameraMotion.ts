// Chase camera reactions to what the car is doing, layered on top of the
// fixed framing: it sits back under acceleration, leans forward under
// braking, kicks briefly on gear changes, leans with the body in corners and
// shakes a little at very high speed.
//
// Each reaction is a damped spring driven by the car's measured acceleration,
// so it follows real forces, never snaps, and settles by itself. The springs
// run on fixed sub-steps: the motion is the same at 30, 60 or 144 FPS.

const SUBSTEP = 1 / 240;

// Back/forward offset of the lens along the car (m per m/s² of acceleration).
const SURGE_PER_ACCEL = 0.028;
const SURGE_MAX = 0.32;
// Lens pitch (rad per m/s²): + looks up (leaning back), - looks down (nose dive).
const PITCH_PER_ACCEL = 0.0032;
const PITCH_MAX = 0.035;
// Share of the body's roll the camera follows, and sideways sway per m/s².
const ROLL_FOLLOW = 0.20;
const ROLL_MAX = 0.014;
const SWAY_PER_ACCEL = 0.0045;
const SWAY_MAX = 0.06;
// Gear change kicks: velocity added to the surge / pitch springs.
const UPSHIFT_SURGE_KICK = 0.9;    // m/s forward: drive cut, the car pitches forward, then pulls again
const UPSHIFT_PITCH_KICK = -0.07;  // rad/s
const DOWNSHIFT_SURGE_KICK = -0.7; // m/s backward: engine braking jolt
const DOWNSHIFT_PITCH_KICK = -0.1;
// High speed shake: none below the first speed, full at the second.
const SHAKE_START = 170 / 3.6;
const SHAKE_FULL = 300 / 3.6;
const SHAKE_POSITION = 0.006;     // m
const SHAKE_ANGLE = 0.0009;       // rad

interface Spring { value: number; velocity: number }

function spring(): Spring { return { value: 0, velocity: 0 }; }

// One sub-step of a damped spring pulled towards target.
function stepSpring(s: Spring, target: number, frequencyHz: number, dampingRatio: number, h: number): void {
  const omega = 2 * Math.PI * frequencyHz;
  const accel = omega * omega * (target - s.value) - 2 * dampingRatio * omega * s.velocity;
  s.velocity += accel * h;
  s.value += s.velocity * h;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

function smoothstep(x: number, edge0: number, edge1: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface CameraMotionInput {
  dt: number;
  accelLong: number;  // m/s² along the car, + speeding up
  accelLat: number;   // m/s² across the car
  bodyRoll: number;   // rad, as the suspension tilts the body
  speed: number;      // m/s
  gearChange: number; // +1 upshift, -1 downshift, 0 none this frame
}

export class CameraMotion {
  /** Lens offset along the car's heading (m, + towards the car's nose). */
  surge = 0;
  /** Lens offset across the car (m, along the car's right vector). */
  sway = 0;
  /** Extra lens pitch (rad, + looks up) and roll (rad). */
  pitch = 0;
  roll = 0;
  /** Small high speed shake, added to the lens position (m) and angles (rad). */
  readonly shake = { x: 0, y: 0, pitch: 0, roll: 0 };

  private readonly surgeSpring = spring();
  private readonly pitchSpring = spring();
  private readonly swaySpring = spring();
  private readonly rollSpring = spring();
  private time = 0;
  private remainder = 0;

  reset(): void {
    for (const s of [this.surgeSpring, this.pitchSpring, this.swaySpring, this.rollSpring]) {
      s.value = 0;
      s.velocity = 0;
    }
    this.remainder = 0;
    this.update({ dt: 0, accelLong: 0, accelLat: 0, bodyRoll: 0, speed: 0, gearChange: 0 });
  }

  update(input: CameraMotionInput): void {
    if (input.gearChange > 0) {
      this.surgeSpring.velocity += UPSHIFT_SURGE_KICK;
      this.pitchSpring.velocity += UPSHIFT_PITCH_KICK;
    } else if (input.gearChange < 0) {
      this.surgeSpring.velocity += DOWNSHIFT_SURGE_KICK;
      this.pitchSpring.velocity += DOWNSHIFT_PITCH_KICK;
    }
    // Speeding up leaves the lens behind; braking carries it forward.
    const surgeTarget = clamp(-input.accelLong * SURGE_PER_ACCEL, SURGE_MAX);
    const pitchTarget = clamp(input.accelLong * PITCH_PER_ACCEL, PITCH_MAX);
    // In a corner the lens drifts to the outside and leans with the body.
    const swayTarget = clamp(-input.accelLat * SWAY_PER_ACCEL, SWAY_MAX);
    const rollTarget = clamp(input.bodyRoll * ROLL_FOLLOW, ROLL_MAX);

    this.remainder += input.dt;
    while (this.remainder >= SUBSTEP) {
      this.remainder -= SUBSTEP;
      // Slightly under-damped: a gear kick overshoots once, then settles.
      stepSpring(this.surgeSpring, surgeTarget, 2.2, 0.55, SUBSTEP);
      stepSpring(this.pitchSpring, pitchTarget, 2.6, 0.6, SUBSTEP);
      stepSpring(this.swaySpring, swayTarget, 1.4, 0.9, SUBSTEP);
      stepSpring(this.rollSpring, rollTarget, 2, 0.9, SUBSTEP);
    }
    // Kicks may overshoot, but never far enough to block the view.
    this.surge = clamp(this.surgeSpring.value, SURGE_MAX * 1.4);
    this.pitch = clamp(this.pitchSpring.value, PITCH_MAX * 1.4);
    this.sway = this.swaySpring.value;
    this.roll = this.rollSpring.value;

    // Shake: a few unrelated sines read as road texture, not as a wobble.
    // It depends on elapsed time only, so it is frame-rate independent too.
    this.time += input.dt;
    const t = this.time;
    const amount = smoothstep(input.speed, SHAKE_START, SHAKE_FULL);
    const noise = (a: number, b: number, c: number): number =>
      (Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2);
    this.shake.x = amount * SHAKE_POSITION * noise(37.1, 53.7, 71.3);
    this.shake.y = amount * SHAKE_POSITION * noise(43.9, 61.1, 89.7);
    this.shake.pitch = amount * SHAKE_ANGLE * noise(41.3, 67.9, 79.1);
    this.shake.roll = amount * SHAKE_ANGLE * noise(47.7, 59.3, 83.9);
  }
}
