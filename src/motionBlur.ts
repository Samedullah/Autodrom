import * as THREE from 'three';

// Speed blur: the scene is rendered into an offscreen target, then drawn to
// the screen smeared towards the point the car is heading for. The middle of
// the screen, where the car sits, stays sharp. With no blur the scene renders
// straight to the screen, so standing still or slow driving costs nothing.
const SAMPLES = 10;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Samples are tone-mapped one by one and then averaged, so the blur works on
// the colours the player actually sees. Averaging the raw HDR scene instead
// lets a few very bright texels (lit lamps, sun glints, the sky) dominate
// every smear: red lamp light bled over the body and bright sky turned the
// whole image milky. Samples that land on the car itself are left out, so
// the car never smears onto the road around it.
const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float strength;
  uniform vec2 focus;   // vanishing point the blur streaks away from
  uniform float aspect;
  varying vec2 vUv;
  #ifndef TONE_MAPPING
  vec3 toneMapping(vec3 color) { return color; }
  #endif
  // 0 on the car (just below screen centre), 1 towards the edges.
  float awayFromCar(vec2 uv) {
    vec2 fromCar = (uv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
    return smoothstep(0.16, 0.62, length(fromCar));
  }
  void main() {
    float centerMask = awayFromCar(vUv);
    vec3 baseHdr = texture2D(tDiffuse, vUv).rgb;
    if (centerMask < 0.004) {
      gl_FragColor = vec4(toneMapping(baseHdr), 1.0);
      #include <colorspace_fragment>
      return;
    }
    vec2 stepUv = (vUv - focus) * strength * centerMask / float(${SAMPLES});
    float baseLuma = dot(baseHdr, vec3(0.2126, 0.7152, 0.0722));
    float baseKaris = 1.0 / (1.0 + baseLuma);
    vec3 hdrAccum = baseHdr * baseKaris;
    float weightAccum = baseKaris;
    for (int i = 1; i < ${SAMPLES}; i++) {
      vec2 uv = vUv - stepUv * float(i);
      float w = awayFromCar(uv);
      vec3 sampleHdr = texture2D(tDiffuse, uv).rgb;
      float luma = dot(sampleHdr, vec3(0.2126, 0.7152, 0.0722));
      float kw = w / (1.0 + luma);
      hdrAccum += sampleHdr * kw;
      weightAccum += kw;
    }
    vec3 resolvedHdr = hdrAccum / max(weightAccum, 1e-4);
    // Inverse Karis restore so overall scene brightness matches single-sample toneMapping.
    float avgLuma = dot(resolvedHdr, vec3(0.2126, 0.7152, 0.0722));
    vec3 restoredHdr = resolvedHdr / max(1.0 - min(avgLuma, 0.85) * 0.35, 0.25);
    gl_FragColor = vec4(toneMapping(restoredHdr), 1.0);
    #include <colorspace_fragment>
  }
`;

export class MotionBlur {
  private target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer, samples: number) {
    // Half float keeps the scene's HDR range; each sample is tone-mapped in the blur pass.
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        strength: { value: 0 },
        focus: { value: new THREE.Vector2(0.5, 0.6) },
        aspect: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size);
    this.target.setSize(Math.max(1, this.size.x), Math.max(1, this.size.y));
    this.material.uniforms.aspect.value = this.size.x / Math.max(1, this.size.y);
  }

  // strength: share of the distance to the focus point a pixel is smeared over.
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, focus: THREE.Vector2): void {
    if (strength < 0.002) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.material.uniforms.strength.value = strength;
    this.material.uniforms.focus.value.copy(focus);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  // Compile the blur shader ahead of time, so the first fast run does not hitch.
  compile(): void {
    this.renderer.compile(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
