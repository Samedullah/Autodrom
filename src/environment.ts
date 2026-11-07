import * as THREE from 'three';
import type { SkyColors } from './atmosphere';
import type { GameSettings } from './save';

// Time of day and weather: where the sun (or moon) is, the sky's colours, how
// strong each light is, fog, rain and how wet the ground is. It only computes
// and draws the weather; the engine applies the numbers to its lights.
// Nothing here touches driving physics.

export interface EnvironmentState {
  /** Hours, 0..24. */
  timeOfDay: number;
  /** Whether the clock runs. */
  cycleRunning: boolean;
  /** Real minutes per in-game day. */
  cycleMinutes: number;
  /** 0 dry .. 1 downpour. */
  rain: number;
}

export interface EnvironmentLighting {
  sky: SkyColors;
  /** Direction towards the light that casts shadows (sun by day, moon at night). */
  lightDirection: THREE.Vector3;
  lightColor: THREE.Color;
  /** Share of the quality level's full sun strength. */
  lightShare: number;
  fillSky: THREE.Color;
  fillGround: THREE.Color;
  /** Share of the quality level's fill (hemisphere) strength. */
  fillShare: number;
  /** Bake brightness of the sun/moon disc and its halo. */
  disc: number;
  glow: number;
  /** Multipliers for the fog's near and far distances. */
  fogNear: number;
  fogFar: number;
  /** 0 day .. 1 night: headlights. */
  darkness: number;
  /** 0 dry .. 1 soaked: lags behind the rain. */
  wetness: number;
}

interface SkyKey { hour: number; zenith: string; horizon: string; ground: string; light: string }

// Clear-sky colours through the day; values between keys are blended.
const SKY_KEYS: SkyKey[] = [
  { hour: 0, zenith: '#060b16', horizon: '#1a2232', ground: '#0c100d', light: '#9fb4ff' },
  { hour: 4.9, zenith: '#0a1222', horizon: '#26304a', ground: '#0e120e', light: '#9fb4ff' },
  { hour: 6.1, zenith: '#2f4a78', horizon: '#e5a27a', ground: '#3a3a30', light: '#ffb070' },
  { hour: 8, zenith: '#4f81bd', horizon: '#d6cfc0', ground: '#535a4a', light: '#ffe2bd' },
  { hour: 12, zenith: '#5d8fc9', horizon: '#c9d6d6', ground: '#5d6655', light: '#fff2da' },
  { hour: 16.5, zenith: '#5486c2', horizon: '#d8d2c2', ground: '#596050', light: '#ffe6c4' },
  { hour: 17.9, zenith: '#33507f', horizon: '#ee9c68', ground: '#3d3a2e', light: '#ff9850' },
  { hour: 19.3, zenith: '#0c1528', horizon: '#2a3148', ground: '#0e110e', light: '#9fb4ff' },
  { hour: 24, zenith: '#060b16', horizon: '#1a2232', ground: '#0c100d', light: '#9fb4ff' },
];

// Overcast tones the sky blends to under rain.
const OVERCAST_DAY = { zenith: new THREE.Color('#6d7780'), horizon: new THREE.Color('#9ba3a7'), ground: new THREE.Color('#4b5048') };
const OVERCAST_NIGHT = { zenith: new THREE.Color('#0c0f14'), horizon: new THREE.Color('#1d2228'), ground: new THREE.Color('#0b0d0c') };

const SUN_MAX_ELEVATION = THREE.MathUtils.degToRad(58);
// Shadows from a sun right at the horizon would stretch across the whole map.
const MIN_SHADOW_ELEVATION = 0.18;
const MOON_STRENGTH = 0.05;      // moonlight as a share of full sun
const WET_UP_SECONDS = 25;       // to soak the ground under steady rain
const DRY_SECONDS = 70;          // to dry again

const color = (hex: string): THREE.Color => new THREE.Color(hex);
const KEY_COLORS = SKY_KEYS.map((key) => ({
  hour: key.hour, zenith: color(key.zenith), horizon: color(key.horizon), ground: color(key.ground), light: color(key.light),
}));

function sunDirectionAt(hour: number, into: THREE.Vector3): number {
  // The sun rises at 6, peaks at 12, sets at 18; it crosses the sky from east to west.
  const angle = ((hour - 6) / 12) * Math.PI;
  const elevation = Math.asin(Math.sin(angle) * Math.sin(SUN_MAX_ELEVATION));
  const azimuth = THREE.MathUtils.degToRad(100 + 160 * ((hour - 6) / 12));
  into.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
  return Math.sin(elevation);
}

export class Environment {
  readonly state: EnvironmentState = { timeOfDay: 13, cycleRunning: true, cycleMinutes: 24, rain: 0 };
  readonly rain: RainField;
  private wetness = 0;
  private readonly lighting: EnvironmentLighting = {
    sky: { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color() },
    lightDirection: new THREE.Vector3(0, 1, 0),
    lightColor: new THREE.Color(),
    lightShare: 1,
    fillSky: new THREE.Color(),
    fillGround: new THREE.Color(),
    fillShare: 1,
    disc: 40,
    glow: 1,
    fogNear: 1,
    fogFar: 1,
    darkness: 0,
    wetness: 0,
  };
  private readonly sun = new THREE.Vector3();
  private readonly moon = new THREE.Vector3();
  private readonly overcast = { zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color() };

  constructor(quality: GameSettings['quality']) {
    this.rain = new RainField(quality);
  }

  set(changes: Partial<EnvironmentState>): void {
    Object.assign(this.state, changes);
    this.state.timeOfDay = THREE.MathUtils.euclideanModulo(this.state.timeOfDay, 24);
    this.state.rain = THREE.MathUtils.clamp(this.state.rain, 0, 1);
    this.state.cycleMinutes = Math.max(1, this.state.cycleMinutes);
  }

  get currentWetness(): number {
    return this.wetness;
  }

  /** Advances the clock and the ground's wetness; returns the lighting for now. */
  update(dt: number): EnvironmentLighting {
    const state = this.state;
    if (state.cycleRunning) state.timeOfDay = (state.timeOfDay + dt * 24 / (state.cycleMinutes * 60)) % 24;
    const wetRate = state.rain > this.wetness ? 1 / WET_UP_SECONDS : 1 / DRY_SECONDS;
    this.wetness += THREE.MathUtils.clamp(state.rain - this.wetness, -wetRate * dt, wetRate * dt);
    return this.evaluate();
  }

  private evaluate(): EnvironmentLighting {
    const { timeOfDay: hour, rain } = this.state;
    const out = this.lighting;
    let i = 0;
    while (i < KEY_COLORS.length - 2 && KEY_COLORS[i + 1].hour <= hour) i += 1;
    const a = KEY_COLORS[i];
    const b = KEY_COLORS[i + 1];
    const t = THREE.MathUtils.smoothstep(hour, a.hour, b.hour);
    out.sky.zenith.lerpColors(a.zenith, b.zenith, t);
    out.sky.horizon.lerpColors(a.horizon, b.horizon, t);
    out.sky.ground.lerpColors(a.ground, b.ground, t);
    out.lightColor.lerpColors(a.light, b.light, t);

    const sunHeight = sunDirectionAt(hour, this.sun);
    const moonHeight = sunDirectionAt((hour + 12) % 24, this.moon);
    const day = THREE.MathUtils.smoothstep(sunHeight, -0.04, 0.16);
    out.darkness = 1 - THREE.MathUtils.smoothstep(sunHeight, -0.06, 0.08);

    // Clouds: grey the sky, dim and soften the light, pull the fog in.
    this.overcast.zenith.lerpColors(OVERCAST_NIGHT.zenith, OVERCAST_DAY.zenith, day);
    this.overcast.horizon.lerpColors(OVERCAST_NIGHT.horizon, OVERCAST_DAY.horizon, day);
    this.overcast.ground.lerpColors(OVERCAST_NIGHT.ground, OVERCAST_DAY.ground, day);
    const cloud = rain * 0.85;
    out.sky.zenith.lerp(this.overcast.zenith, cloud);
    out.sky.horizon.lerp(this.overcast.horizon, cloud);
    out.sky.ground.lerp(this.overcast.ground, cloud);

    const useSun = sunHeight >= 0 || moonHeight < 0;
    out.lightDirection.copy(useSun ? this.sun : this.moon);
    if (out.lightDirection.y < MIN_SHADOW_ELEVATION) {
      out.lightDirection.y = MIN_SHADOW_ELEVATION;
      out.lightDirection.normalize();
    }
    const moonlight = MOON_STRENGTH * THREE.MathUtils.smoothstep(moonHeight, 0, 0.25);
    out.lightShare = (useSun ? day : moonlight) * (1 - 0.7 * rain);
    out.sky.sun.copy(out.lightColor);
    out.disc = useSun ? 40 * day : 4 * moonlight / MOON_STRENGTH;
    out.glow = (useSun ? 1 : 0.3) * (1 - rain);

    out.fillSky.lerpColors(out.sky.horizon, out.sky.zenith, 0.5);
    out.fillGround.copy(out.sky.ground);
    out.fillShare = THREE.MathUtils.lerp(0.22, 1, day) * (1 + 0.6 * rain);
    out.fogNear = 1 - 0.6 * rain;
    out.fogFar = 1 - 0.5 * rain;
    out.darkness = Math.max(out.darkness, rain * 0.55);
    out.wetness = this.wetness;
    return out;
  }

  dispose(): void {
    this.rain.dispose();
  }
}

/**
 * Rain streaks in a box that travels with the camera. Every streak moves in
 * the vertex shader from a time uniform, so falling rain costs no CPU work;
 * the intensity sets how many streaks are drawn.
 */
export class RainField {
  readonly mesh: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private readonly capacity: number;

  constructor(quality: GameSettings['quality']) {
    this.capacity = quality === 'ultra' ? 9000 : quality === 'high' ? 6000 : quality === 'medium' ? 3500 : 1600;
    const base = new Float32Array(this.capacity * 2 * 3);
    const end = new Float32Array(this.capacity * 2);
    for (let i = 0; i < this.capacity; i += 1) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let v = 0; v < 2; v += 1) {
        base.set([x, y, z], (i * 2 + v) * 3);
        end[i * 2 + v] = v;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCamera: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(46, 26, 46) },
        uFall: { value: 15 },
        uWind: { value: new THREE.Vector2(1.6, 0.7) },
        uLength: { value: 0.85 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0.72, 0.77, 0.82) },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform vec3 uCamera;
        uniform float uTime;
        uniform vec3 uBox;
        uniform float uFall;
        uniform vec2 uWind;
        uniform float uLength;
        varying float vEnd;
        void main() {
          vec3 p = position * uBox;
          vec3 velocity = vec3(uWind.x, -uFall, uWind.y);
          // Fall and drift, wrapped inside a box centred on the camera.
          vec3 moved = p + velocity * uTime;
          vec3 world;
          world.y = uCamera.y - uBox.y * 0.35 + mod(moved.y, uBox.y);
          world.xz = uCamera.xz + mod(moved.xz - uCamera.xz, uBox.xz) - uBox.xz * 0.5;
          world -= normalize(velocity) * uLength * aEnd;
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vEnd;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * mix(1.0, 0.15, vEnd));
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geometry, this.material);
    this.mesh.name = 'rain';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.userData.castsShadow = false;
  }

  update(camera: THREE.Camera, time: number, intensity: number, brightness: number): void {
    const visible = intensity > 0.01;
    this.mesh.visible = visible;
    if (!visible) return;
    const u = this.material.uniforms;
    (u.uCamera.value as THREE.Vector3).copy(camera.position);
    u.uTime.value = time % 1000;
    u.uOpacity.value = 0.18 + 0.32 * intensity;
    (u.uColor.value as THREE.Color).setRGB(0.72, 0.77, 0.82).multiplyScalar(0.35 + 0.65 * brightness);
    this.mesh.geometry.setDrawRange(0, Math.ceil(this.capacity * intensity) * 2);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * Wet ground: rougher surfaces turn glossy (the sky reflects in them) and
 * darker. Dry values are remembered on each material the first time.
 */
export function applyWetness(root: THREE.Object3D, wetness: number): void {
  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const entry of Array.isArray(material) ? material : [material]) {
      const surface = entry as THREE.MeshStandardMaterial;
      if (!surface.isMeshStandardMaterial) continue;
      if (surface.userData.dryRoughness === undefined) {
        surface.userData.dryRoughness = surface.roughness;
        surface.userData.dryColor = surface.color.clone();
      }
      const dry = surface.userData.dryRoughness as number;
      surface.roughness = Math.max(0.06, THREE.MathUtils.lerp(dry, dry * 0.3, wetness));
      surface.color.copy(surface.userData.dryColor as THREE.Color).multiplyScalar(1 - 0.3 * wetness);
    }
  });
}
