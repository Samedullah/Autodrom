import * as THREE from 'three';

// Raindrops landing on the camera lens: small clear beads that catch the light
// (a dark rim, a lighter body and a bright glint on top), fade as they run off,
// and at speed get blown out towards the screen edges. All drops are one
// instanced draw over the finished frame, drawn only while it rains.

const MAX_DROPS = 72;
/** Drops landing per second in full rain while standing still; more with speed. */
const DROPS_PER_SECOND = 14;
const DROPS_PER_SECOND_PER_MS = 0.35;
/** Above this speed (m/s) the airflow starts clearing the lens. */
const AIRFLOW_START = 8;

interface Drop {
  x: number;
  y: number;
  size: number;
  age: number;
  life: number;
  /** Slide speed down the lens (big drops only), screen heights per second. */
  slide: number;
  stretch: number;
  seed: number;
}

const vertexShader = /* glsl */ `
  attribute vec4 aDrop;   // x, y (NDC), radius (screen heights), alpha
  attribute vec2 aShape;  // vertical stretch, seed
  uniform float aspect;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vUv = position.xy;
    vAlpha = aDrop.w;
    vSeed = aShape.y;
    vec2 offset = position.xy * aDrop.z * vec2(1.0 / aspect, aShape.x) * 2.0;
    gl_Position = vec4(aDrop.xy + offset, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float brightness;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    // Slightly wobbly outline so drops are not perfect circles.
    float angle = atan(vUv.y, vUv.x);
    float r = length(vUv) * (1.0 + 0.06 * sin(angle * 3.0 + vSeed * 6.28) + 0.04 * sin(angle * 5.0 + vSeed * 17.0));
    float inside = 1.0 - smoothstep(0.86, 1.0, r);
    if (inside <= 0.0) discard;
    // A water bead is a tiny upside-down lens: the bright sky above shows in
    // its lower half as a light crescent, its upper edge stays dark, and the
    // light source leaves a sharp glint near the top.
    float edge = smoothstep(0.5, 0.95, r) * inside;
    float lower = smoothstep(0.15, -0.35, vUv.y);
    float body = inside * (0.5 + 0.5 * lower);
    float glint = 1.0 - smoothstep(0.0, 0.17, length(vUv - vec2(-0.3, 0.4)));
    vec3 light = vec3(0.88, 0.92, 0.97) * brightness;
    vec3 dark = light * 0.18;
    vec3 shade = mix(dark, light, clamp(lower * 0.85 + glint * 2.0 + (1.0 - edge) * 0.25, 0.0, 1.0));
    float alpha = body * 0.24 + edge * (0.22 + 0.3 * lower) + glint * 0.9;
    gl_FragColor = vec4(shade, alpha * vAlpha);
  }
`;

export class LensDrops {
  private readonly drops: Drop[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly dropAttribute: THREE.InstancedBufferAttribute;
  private readonly shapeAttribute: THREE.InstancedBufferAttribute;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private spawnDebt = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    this.dropAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 4), 4);
    this.shapeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DROPS * 2), 2);
    this.dropAttribute.setUsage(THREE.DynamicDrawUsage);
    this.shapeAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aDrop', this.dropAttribute);
    geometry.setAttribute('aShape', this.shapeAttribute);
    this.material = new THREE.ShaderMaterial({
      uniforms: { aspect: { value: 1 }, brightness: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_DROPS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get active(): boolean {
    return this.drops.length > 0;
  }

  /**
   * `rain` 0..1, `speed` in m/s, `brightness` 0..1 (how much light the drops catch).
   * `blowFrom` is the point (screen 0..1) the airflow pushes drops away from: where the car heads.
   */
  update(dt: number, rain: number, speed: number, brightness: number, blowFrom: THREE.Vector2): void {
    const airflow = THREE.MathUtils.smoothstep(speed, AIRFLOW_START, 45);
    if (rain > 0.03) {
      this.spawnDebt += dt * rain * (DROPS_PER_SECOND + speed * DROPS_PER_SECOND_PER_MS);
      while (this.spawnDebt >= 1) {
        this.spawnDebt -= 1;
        if (this.drops.length < MAX_DROPS) this.drops.push(this.newDrop(airflow));
      }
    } else {
      this.spawnDebt = 0;
    }
    const fromX = blowFrom.x * 2 - 1;
    const fromY = blowFrom.y * 2 - 1;
    for (let i = this.drops.length - 1; i >= 0; i -= 1) {
      const drop = this.drops[i];
      drop.age += dt;
      // Airflow drags drops outward from the heading point, faster near the edges.
      const push = airflow * 1.6 * dt;
      drop.x += (drop.x - fromX) * push;
      drop.y += (drop.y - fromY) * push - drop.slide * 2 * dt;
      if (drop.age >= drop.life || Math.abs(drop.x) > 1.2 || Math.abs(drop.y) > 1.2) this.drops.splice(i, 1);
    }
    this.renderer.getDrawingBufferSize(this.size);
    this.material.uniforms.aspect.value = this.size.x / Math.max(1, this.size.y);
    this.material.uniforms.brightness.value = brightness;
    const drops = this.dropAttribute.array as Float32Array;
    const shapes = this.shapeAttribute.array as Float32Array;
    this.drops.forEach((drop, i) => {
      // Quick fade in on impact, slow fade as the water runs off.
      const t = drop.age / drop.life;
      const alpha = Math.min(1, drop.age / 0.06) * (1 - t * t);
      drops.set([drop.x, drop.y, drop.size * (1 + 0.15 * Math.min(1, drop.age / 0.15)), alpha], i * 4);
      shapes.set([drop.stretch * (1 + drop.slide * 4 * t), drop.seed], i * 2);
    });
    this.mesh.count = this.drops.length;
    this.dropAttribute.needsUpdate = true;
    this.shapeAttribute.needsUpdate = true;
  }

  /** Draws the drops over whatever is on screen. */
  render(): void {
    if (this.mesh.count === 0) return;
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = autoClear;
  }

  clear(): void {
    this.drops.length = 0;
    this.mesh.count = 0;
  }

  compile(): void {
    this.renderer.compile(this.scene, this.camera);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  private newDrop(airflow: number): Drop {
    // Mostly tiny beads, now and then a bigger drop that slowly runs down.
    const big = Math.random() < 0.12;
    const size = big ? 0.016 + Math.random() * 0.012 : 0.005 + Math.random() * 0.007;
    return {
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      size,
      age: 0,
      life: (big ? 3.5 + Math.random() * 3 : 1.4 + Math.random() * 2.2) * (1 - 0.6 * airflow),
      slide: big ? 0.01 + Math.random() * 0.03 : 0,
      stretch: 0.9 + Math.random() * 0.25,
      seed: Math.random(),
    };
  }
}
