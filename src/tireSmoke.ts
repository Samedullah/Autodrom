import * as THREE from 'three';

// Tire smoke as camera-facing quads. Live particles are packed at the front
// of the arrays (swap-remove), so per frame only live ones are simulated,
// uploaded and drawn. Each emitter (a wheel) keeps feeding its newest puff
// while the wheel is still inside it, and starts a new one only after moving
// away or once that puff has aged: far fewer overlapping quads, less overdraw.
const CAPACITY = 256;
const FEED_TIME = 0.16;       // s a puff keeps taking smoke from its wheel
const FEED_RADIUS = 0.7;      // m the wheel may move before a new puff starts
const FEED_GAIN = 0.15;       // strength added per feed, as a share of intensity
const FADE_IN = 0.14;
const HORIZONTAL_DRAG = 1.6;  // 1/s: smoke quickly loses the car's speed and lingers
const BUOYANCY = 0.22;        // m/s² upward
const MAX_RISE = 0.75;        // m/s: warm smoke rises, but slowly
const WIND_X = 0.32;          // m/s drift so clouds do not hang perfectly still
const WIND_Z = 0.14;

function createPuffTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  // Overlapping soft blobs give the puff a lumpy, billowing silhouette
  // instead of a perfect disc.
  let seed = 7;
  const random = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 26; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * size * 0.2;
    const x = size / 2 + Math.cos(angle) * distance;
    const y = size / 2 + Math.sin(angle) * distance;
    const radius = size * (0.12 + random() * 0.16);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.16 + random() * 0.16;
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.45})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  // Keep the edges fully transparent so the quad never shows.
  context.globalCompositeOperation = 'destination-in';
  const mask = context.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = mask;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const vertexShader = /* glsl */ `
  attribute vec4 iPosition; // xyz, w = ground height under the particle
  attribute vec4 iParams;   // size, opacity, rotation, shade
  varying vec2 vUv;
  varying float vOpacity;
  varying float vHeight;
  varying float vShade;
  #include <fog_pars_vertex>
  void main() {
    float s = sin(iParams.z);
    float c = cos(iParams.z);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iParams.x;
    vec4 mvPosition = modelViewMatrix * vec4(iPosition.xyz, 1.0);
    mvPosition.xy += corner;
    gl_Position = projectionMatrix * mvPosition;
    // World height of this corner: camera right/up axes are the view matrix rows.
    vec3 cameraRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 cameraUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vHeight = iPosition.y - iPosition.w + cameraRight.y * corner.x + cameraUp.y * corner.y;
    // Puffs right in front of the lens would fill the screen: fade them out.
    vOpacity = iParams.y * smoothstep(0.6, 2.8, -mvPosition.z);
    vShade = iParams.w;
    vUv = uv;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 litColor;
  uniform vec3 shadowColor;
  varying vec2 vUv;
  varying float vOpacity;
  varying float vHeight;
  varying float vShade;
  #include <fog_pars_fragment>
  void main() {
    float density = texture2D(map, vUv).a;
    // Soft contact with the ground instead of a hard cut line.
    float alpha = density * vOpacity * smoothstep(0.0, 0.45, vHeight);
    if (alpha < 0.003) discard;
    // Sky lights the top of the cloud, the underside and dense core stay darker.
    float light = clamp(vUv.y * 0.75 + 0.35 - density * 0.25, 0.0, 1.0) * vShade;
    gl_FragColor = vec4(mix(shadowColor, litColor, light), alpha);
    #include <fog_fragment>
    #include <colorspace_fragment>
  }
`;

export class TireSmoke {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly gpuPosition = new Float32Array(CAPACITY * 4);
  private readonly gpuParams = new Float32Array(CAPACITY * 4);
  private readonly positionAttribute: THREE.InstancedBufferAttribute;
  private readonly paramsAttribute: THREE.InstancedBufferAttribute;
  private readonly velocity = new Float32Array(CAPACITY * 3);
  private readonly age = new Float32Array(CAPACITY);
  private readonly lifetime = new Float32Array(CAPACITY);
  private readonly strength = new Float32Array(CAPACITY);
  private readonly startSize = new Float32Array(CAPACITY);
  private readonly growth = new Float32Array(CAPACITY);
  private readonly spin = new Float32Array(CAPACITY);
  // Which emitter a particle belongs to (-1: none), and each emitter's newest puff.
  private readonly owner = new Int32Array(CAPACITY).fill(-1);
  private readonly emitterPuff = new Map<number, number>();
  private count = 0;
  private overwriteCursor = 0;

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = base.index;
    this.geometry.setAttribute('position', base.getAttribute('position'));
    this.geometry.setAttribute('uv', base.getAttribute('uv'));
    this.positionAttribute = new THREE.InstancedBufferAttribute(this.gpuPosition, 4).setUsage(THREE.DynamicDrawUsage);
    this.paramsAttribute = new THREE.InstancedBufferAttribute(this.gpuParams, 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPosition', this.positionAttribute);
    this.geometry.setAttribute('iParams', this.paramsAttribute);
    this.geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          map: { value: null },
          litColor: { value: new THREE.Color('#efefec') },
          shadowColor: { value: new THREE.Color('#8c8f93') },
        },
      ]),
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    material.uniforms.map.value = createPuffTexture();
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  // Smoke from one emitter: feeds its current puff when possible, else starts a new one.
  // intensity 0..1 scales density and how big the puff grows.
  emit(emitter: number, x: number, y: number, z: number, groundY: number, vx: number, vy: number, vz: number, intensity: number): void {
    const current = this.emitterPuff.get(emitter);
    if (current !== undefined && this.owner[current] === emitter && this.age[current] < FEED_TIME) {
      const dx = this.gpuPosition[current * 4] - x;
      const dz = this.gpuPosition[current * 4 + 2] - z;
      if (dx * dx + dz * dz < FEED_RADIUS * FEED_RADIUS) {
        this.strength[current] = Math.min(1, this.strength[current] + intensity * FEED_GAIN);
        this.growth[current] = Math.max(this.growth[current], (2.4 + Math.random() * 1.2) * (0.5 + 0.5 * intensity));
        return;
      }
    }
    let i = this.count;
    if (i < CAPACITY) {
      this.count += 1;
    } else {
      i = this.overwriteCursor;
      this.overwriteCursor = (this.overwriteCursor + 1) % CAPACITY;
    }
    this.gpuPosition[i * 4] = x;
    this.gpuPosition[i * 4 + 1] = y;
    this.gpuPosition[i * 4 + 2] = z;
    this.gpuPosition[i * 4 + 3] = groundY;
    this.gpuParams[i * 4 + 2] = Math.random() * Math.PI * 2;
    this.gpuParams[i * 4 + 3] = 0.82 + Math.random() * 0.18;
    this.velocity[i * 3] = vx;
    this.velocity[i * 3 + 1] = vy;
    this.velocity[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.lifetime[i] = 2.3 + Math.random() * 1.1;
    this.strength[i] = intensity * 0.6;
    this.startSize[i] = 0.45 + Math.random() * 0.25;
    this.growth[i] = (2.4 + Math.random() * 1.2) * (0.5 + 0.5 * intensity);
    this.owner[i] = emitter;
    this.emitterPuff.set(emitter, i);
    this.spin[i] = (Math.random() - 0.5) * 0.7;
  }

  update(dt: number): void {
    if (this.count === 0 && this.geometry.instanceCount === 0) return;
    const drag = Math.exp(-HORIZONTAL_DRAG * dt);
    let i = 0;
    while (i < this.count) {
      const nextAge = this.age[i] + dt;
      if (nextAge >= this.lifetime[i]) {
        this.removeAt(i);
        continue;
      }
      this.age[i] = nextAge;
      const v = i * 3;
      const p = i * 4;
      this.velocity[v] = this.velocity[v] * drag + WIND_X * (1 - drag);
      this.velocity[v + 2] = this.velocity[v + 2] * drag + WIND_Z * (1 - drag);
      this.velocity[v + 1] = Math.min(MAX_RISE, this.velocity[v + 1] + BUOYANCY * dt);
      this.gpuPosition[p] += this.velocity[v] * dt;
      this.gpuPosition[p + 1] += this.velocity[v + 1] * dt;
      this.gpuPosition[p + 2] += this.velocity[v + 2] * dt;
      const t = nextAge / this.lifetime[i];
      // Expands fast while hot, then slows down; thins out as it spreads.
      const size = this.startSize[i] + this.growth[i] * Math.sqrt(nextAge);
      const fadeIn = Math.min(1, nextAge / FADE_IN);
      const fadeOut = (1 - t) * (1 - t);
      this.gpuParams[p] = size;
      this.gpuParams[p + 1] = this.strength[i] * 0.62 * fadeIn * fadeOut;
      this.gpuParams[p + 2] += this.spin[i] * dt;
      i += 1;
    }
    this.geometry.instanceCount = this.count;
    if (this.count === 0) return;
    this.positionAttribute.clearUpdateRanges();
    this.positionAttribute.addUpdateRange(0, this.count * 4);
    this.positionAttribute.needsUpdate = true;
    this.paramsAttribute.clearUpdateRanges();
    this.paramsAttribute.addUpdateRange(0, this.count * 4);
    this.paramsAttribute.needsUpdate = true;
  }

  clear(): void {
    this.owner.fill(-1);
    this.emitterPuff.clear();
    this.count = 0;
    this.overwriteCursor = 0;
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    const material = this.mesh.material as THREE.ShaderMaterial;
    (material.uniforms.map.value as THREE.Texture).dispose();
    material.dispose();
  }

  private removeAt(i: number): void {
    const dead = this.owner[i];
    if (dead >= 0 && this.emitterPuff.get(dead) === i) this.emitterPuff.delete(dead);
    const last = this.count - 1;
    this.count = last;
    if (this.overwriteCursor >= this.count) this.overwriteCursor = 0;
    this.owner[i] = -1;
    if (i === last) return;
    const moved = this.owner[last];
    this.owner[i] = moved;
    this.owner[last] = -1;
    if (moved >= 0 && this.emitterPuff.get(moved) === last) this.emitterPuff.set(moved, i);
    this.gpuPosition.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.gpuParams.copyWithin(i * 4, last * 4, last * 4 + 4);
    this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.age[i] = this.age[last];
    this.lifetime[i] = this.lifetime[last];
    this.strength[i] = this.strength[last];
    this.startSize[i] = this.startSize[last];
    this.growth[i] = this.growth[last];
    this.spin[i] = this.spin[last];
  }
}
