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
// Widening radii: a soft core plus a short falloff. Wider, the halo washed
// the whole rear of the car red.
const BLUR_PASSES = [0.8, 1.4];
// Glow added on top of the frame.
const GLOW_STRENGTH = 1.1;

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
  private readonly blur: THREE.ShaderMaterial;
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
    this.blur = new THREE.ShaderMaterial({
      uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
      vertexShader: quadVertex,
      fragmentShader: blurFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { glow: { value: this.targets[0].texture }, strength: { value: GLOW_STRENGTH } },
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

    this.quad.material = this.blur;
    for (const radius of BLUR_PASSES) {
      this.blur.uniforms.source.value = a.texture;
      this.blur.uniforms.step.value.set(radius / a.width, 0);
      renderer.setRenderTarget(b);
      renderer.render(this.quadScene, this.quadCamera);
      this.blur.uniforms.source.value = b.texture;
      this.blur.uniforms.step.value.set(0, radius / a.height);
      renderer.setRenderTarget(a);
      renderer.render(this.quadScene, this.quadCamera);
    }

    renderer.setRenderTarget(null);
    this.quad.material = this.composite;
    renderer.autoClear = false;
    renderer.render(this.quadScene, this.quadCamera);
    renderer.autoClear = autoClear;
  }

  compile(): void {
    this.quad.material = this.blur;
    this.renderer.compile(this.quadScene, this.quadCamera);
    this.quad.material = this.composite;
    this.renderer.compile(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.blur.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
