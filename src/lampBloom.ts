import * as THREE from 'three';

// Selective bloom for lit lamps: only objects on GLOW_LAYER (copies of the
// lamp meshes themselves) are drawn into a small offscreen target, blurred,
// and added on top of the frame. The light spreads from the real lamp shape
// instead of from sprites floating next to it. Runs only while a lamp is lit.
// The car body is drawn into the glow target's depth first (no colour), so
// glow only shows where the lamp itself is visible: it no longer shines
// through the bodywork and paint the car red from the inside.

export const GLOW_LAYER = 3;

const DOWNSCALE = 4;
// Light scattering in a lens or the eye: a bright, tight core with a tail that
// fades out smoothly and reaches far. Each level blurs further (a few small
// passes, so wide blurs stay smooth without banding) and is summed with a
// falling weight; one single blur reads as a flat, artificial blob instead.
const BLOOM_LEVELS = [
  { passes: 1, radius: 1.0, weight: 0.52 },
  { passes: 2, radius: 1.3, weight: 0.26 },
  { passes: 3, radius: 1.6, weight: 0.14 },
  { passes: 3, radius: 1.8, weight: 0.08 },
];
// Glow added on top of the frame.
const GLOW_STRENGTH = 1.7;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const blurFragment = /* glsl */ `
  uniform sampler2D source;
  uniform vec2 step;
  varying vec2 vUv;
  void main() {
    vec4 sum = texture2D(source, vUv) * 0.2270270270;
    sum += texture2D(source, vUv + step * 1.3846153846) * 0.3162162162;
    sum += texture2D(source, vUv - step * 1.3846153846) * 0.3162162162;
    sum += texture2D(source, vUv + step * 3.2307692308) * 0.0702702703;
    sum += texture2D(source, vUv - step * 3.2307692308) * 0.0702702703;
    gl_FragColor = sum;
  }
`;

const accumulateFragment = /* glsl */ `
  uniform sampler2D source;
  uniform float weight;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(texture2D(source, vUv).rgb * weight, 1.0);
  }
`;

const compositeFragment = /* glsl */ `
  uniform sampler2D glow;
  uniform float strength;
  varying vec2 vUv;
  void main() {
    vec3 light = texture2D(glow, vUv).rgb * strength;
    // Soft roll-off so a strong glow stays red instead of clipping to white.
    gl_FragColor = vec4(light / (1.0 + light), 1.0);
  }
`;

export class LampBloom {
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  /** Sum of the bloom levels. */
  private readonly accum: THREE.WebGLRenderTarget;
  private readonly blur: THREE.ShaderMaterial;
  private readonly accumulate: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private readonly clearColor = new THREE.Color();
  private readonly hidden: THREE.Object3D[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    const options = { type: THREE.HalfFloatType, depthBuffer: true } as const;
    this.targets = [new THREE.WebGLRenderTarget(1, 1, options), new THREE.WebGLRenderTarget(1, 1, options)];
    this.accum = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.accumulate = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, weight: { value: 1 } },
      vertexShader: quadVertex,
      fragmentShader: accumulateFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
      vertexShader: quadVertex,
      fragmentShader: blurFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { glow: { value: this.accum.texture }, strength: { value: GLOW_STRENGTH } },
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, Math.round(this.size.x / DOWNSCALE));
    const height = Math.max(1, Math.round(this.size.y / DOWNSCALE));
    for (const target of this.targets) target.setSize(width, height);
    this.accum.setSize(width, height);
  }

  /**
   * Adds the glow of everything on GLOW_LAYER to the frame already on screen.
   * `occluder` (the car carrying the lamps) hides the glow wherever its body
   * stands in front of a lamp.
   */
  render(scene: THREE.Scene, camera: THREE.Camera, occluder?: THREE.Object3D): void {
    const renderer = this.renderer;
    const [a, b] = this.targets;
    const mask = camera.layers.mask;
    const background = scene.background;
    const fog = scene.fog;
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    // The shadow map is already current for this frame.
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    scene.background = null;
    scene.fog = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(a);
    renderer.clear();
    renderer.autoClear = false;
    if (occluder) {
      // Depth of the occluder only. Lights stay on, so no material needs a
      // new shader; transparent lenses write no depth and do not hide lamps.
      for (const child of scene.children) {
        if (child !== occluder && child.visible && !(child as THREE.Light).isLight) {
          child.visible = false;
          this.hidden.push(child);
        }
      }
      const color = renderer.state.buffers.color;
      color.setMask(false);
      color.setLocked(true);
      renderer.render(scene, camera);
      color.setLocked(false);
      color.setMask(true);
      for (const child of this.hidden) child.visible = true;
      this.hidden.length = 0;
    }
    camera.layers.set(GLOW_LAYER);
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
    camera.layers.mask = mask;
    scene.background = background;
    scene.fog = fog;
    renderer.shadowMap.autoUpdate = shadowAutoUpdate;
    renderer.setClearColor(this.clearColor, clearAlpha);

    renderer.setRenderTarget(this.accum);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = false;
    for (const level of BLOOM_LEVELS) {
      this.quad.material = this.blur;
      for (let pass = 0; pass < level.passes; pass += 1) {
        this.blur.uniforms.source.value = a.texture;
        this.blur.uniforms.step.value.set(level.radius / a.width, 0);
        renderer.setRenderTarget(b);
        renderer.render(this.quadScene, this.quadCamera);
        this.blur.uniforms.source.value = b.texture;
        this.blur.uniforms.step.value.set(0, level.radius / a.height);
        renderer.setRenderTarget(a);
        renderer.render(this.quadScene, this.quadCamera);
      }
      this.quad.material = this.accumulate;
      this.accumulate.uniforms.source.value = a.texture;
      this.accumulate.uniforms.weight.value = level.weight;
      renderer.setRenderTarget(this.accum);
      renderer.render(this.quadScene, this.quadCamera);
    }
    renderer.autoClear = autoClear;

    renderer.setRenderTarget(null);
    this.quad.material = this.composite;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
  }

  compile(): void {
    this.quad.material = this.blur;
    this.renderer.compile(this.quadScene, this.quadCamera);
    this.quad.material = this.accumulate;
    this.renderer.compile(this.quadScene, this.quadCamera);
    this.quad.material = this.composite;
    this.renderer.compile(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.accum.dispose();
    this.blur.dispose();
    this.accumulate.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
