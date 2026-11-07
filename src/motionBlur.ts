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

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float strength;
  uniform vec2 focus;   // vanishing point the blur streaks away from
  uniform float aspect;
  uniform vec4 protectedLampRect;
  uniform float protectLamp;
  varying vec2 vUv;
  void main() {
    vec2 toFocus = vUv - focus;
    // Keep the car (just below screen centre) crisp; blur grows towards the edges.
    vec2 fromCar = (vUv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
    float mask = smoothstep(0.16, 0.62, length(fromCar));
    float inLamp = step(protectedLampRect.x, vUv.x) * step(vUv.x, protectedLampRect.z)
      * step(protectedLampRect.y, vUv.y) * step(vUv.y, protectedLampRect.w);
    mask *= 1.0 - protectLamp * inLamp;
    vec2 stepUv = toFocus * strength * mask / float(${SAMPLES});
    vec4 color = vec4(0.0);
    for (int i = 0; i < ${SAMPLES}; i++) {
      color += texture2D(tDiffuse, vUv - stepUv * float(i));
    }
    gl_FragColor = color / float(${SAMPLES});
    #include <tonemapping_fragment>
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
  private readonly protectedBounds = new THREE.Box3();
  private readonly objectBounds = new THREE.Box3();
  private readonly projectedCorner = new THREE.Vector3();
  private readonly protectedMin = new THREE.Vector2();
  private readonly protectedMax = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer, samples: number) {
    // Half float keeps the scene's HDR range; tone mapping happens in the blur pass.
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        strength: { value: 0 },
        focus: { value: new THREE.Vector2(0.5, 0.6) },
        aspect: { value: 1 },
        protectedLampRect: { value: new THREE.Vector4(0, 0, 0, 0) },
        protectLamp: { value: 0 },
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
  render(scene: THREE.Scene, camera: THREE.Camera, strength: number, focus: THREE.Vector2, protectedLamps: readonly THREE.Object3D[] = []): void {
    if (strength < 0.002) {
      this.renderer.render(scene, camera);
      return;
    }
    this.protectedBounds.makeEmpty();
    for (const lamp of protectedLamps) {
      if (!lamp.visible) continue;
      this.objectBounds.setFromObject(lamp);
      this.protectedBounds.union(this.objectBounds);
    }
    if (this.protectedBounds.isEmpty()) {
      this.material.uniforms.protectLamp.value = 0;
    } else {
      camera.updateWorldMatrix(true, false);
      this.protectedMin.set(Infinity, Infinity);
      this.protectedMax.set(-Infinity, -Infinity);
      for (let corner = 0; corner < 8; corner += 1) {
        this.projectedCorner.set(
          corner & 1 ? this.protectedBounds.max.x : this.protectedBounds.min.x,
          corner & 2 ? this.protectedBounds.max.y : this.protectedBounds.min.y,
          corner & 4 ? this.protectedBounds.max.z : this.protectedBounds.min.z,
        ).project(camera);
        const x = this.projectedCorner.x * 0.5 + 0.5;
        const y = this.projectedCorner.y * 0.5 + 0.5;
        this.protectedMin.x = Math.min(this.protectedMin.x, x);
        this.protectedMin.y = Math.min(this.protectedMin.y, y);
        this.protectedMax.x = Math.max(this.protectedMax.x, x);
        this.protectedMax.y = Math.max(this.protectedMax.y, y);
      }
      const padding = 0.008;
      (this.material.uniforms.protectedLampRect.value as THREE.Vector4).set(
        THREE.MathUtils.clamp(this.protectedMin.x - padding, 0, 1),
        THREE.MathUtils.clamp(this.protectedMin.y - padding, 0, 1),
        THREE.MathUtils.clamp(this.protectedMax.x + padding, 0, 1),
        THREE.MathUtils.clamp(this.protectedMax.y + padding, 0, 1),
      );
      this.material.uniforms.protectLamp.value = 1;
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
