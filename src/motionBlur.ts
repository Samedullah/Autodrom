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
  varying vec2 vUv;
  void main() {
    vec2 toFocus = vUv - focus;
    // Keep the car (just below screen centre) crisp; blur grows towards the edges.
    vec2 fromCar = (vUv - vec2(0.5, 0.42)) * vec2(aspect, 1.0);
    float mask = smoothstep(0.16, 0.62, length(fromCar));
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

  constructor(private readonly renderer: THREE.WebGLRenderer, samples: number) {
    // Half float keeps the scene's HDR range; tone mapping happens in the blur pass.
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
