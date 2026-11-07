import * as THREE from 'three';

// Sky and the image-based lighting made from it.
//
// A gradient dome (zenith down to a hazy horizon, a glow around the sun or
// moon) replaces the flat background colour; the fog uses the dome's horizon
// colour, so distant ground melts into the sky without a seam. The same sky,
// plus a bright disc and a ground tone below the horizon, is baked into a
// PMREM environment map: every PBR material (paint, glass, chrome, asphalt)
// gets matching reflections and soft ambient light. Colours and the light's
// direction change with the time of day and the weather (see environment.ts);
// the bake is then redone now and then, always at the same size so no shader
// has to recompile.

export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sun: THREE.Color;
}

export const DAYLIGHT: SkyColors = {
  zenith: new THREE.Color('#5d8fc9'),
  horizon: new THREE.Color('#c9d6d6'),
  ground: new THREE.Color('#5d6655'),
  sun: new THREE.Color('#fff2da'),
};

const ENVIRONMENT_SIZE = 256;

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float sunDisc;     // brightness of the disc itself (0: glow only)
  uniform float glow;        // strength of the halo around it (less under cloud)
  varying vec3 vDirection;
  void main() {
    vec3 dir = normalize(vDirection);
    float up = dir.y;
    // Haze hugs the horizon, the colour deepens towards the zenith.
    vec3 sky = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.55));
    vec3 below = mix(horizon, ground, smoothstep(0.0, 0.25, -up));
    vec3 color = up >= 0.0 ? sky : below;
    float sunDot = max(dot(dir, sunDirection), 0.0);
    color += sunColor * glow * (pow(sunDot, 8.0) * 0.25 + pow(sunDot, 64.0) * 0.6);
    color += sunColor * smoothstep(0.9993, 0.9997, sunDot) * sunDisc;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() },
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      sunDisc: { value: 0 },
      glow: { value: 1 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function setSkyUniforms(material: THREE.ShaderMaterial, colors: SkyColors, direction: THREE.Vector3, disc: number, glow: number): void {
  const u = material.uniforms;
  (u.zenith.value as THREE.Color).copy(colors.zenith);
  (u.horizon.value as THREE.Color).copy(colors.horizon);
  (u.ground.value as THREE.Color).copy(colors.ground);
  (u.sunColor.value as THREE.Color).copy(colors.sun);
  (u.sunDirection.value as THREE.Vector3).copy(direction).normalize();
  u.sunDisc.value = disc;
  u.glow.value = glow;
}

export class Atmosphere {
  /** Sky dome drawn behind everything; follow the camera with `follow`. */
  readonly dome: THREE.Mesh;
  private readonly colors: SkyColors = {
    zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(),
  };
  private readonly direction = new THREE.Vector3(0, 1, 0);
  private disc = 40;
  private glow = 1;
  private environment: THREE.WebGLRenderTarget | null = null;
  private generator: THREE.PMREMGenerator | null = null;
  private readonly bakeScene = new THREE.Scene();
  private readonly bakeSky: THREE.Mesh;

  constructor(colors: SkyColors, lightDirection: THREE.Vector3) {
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial());
    this.dome.name = 'sky-dome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    this.dome.userData.castsShadow = false;
    this.bakeSky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), skyMaterial());
    this.bakeScene.add(this.bakeSky);
    this.setSky(colors, lightDirection, 40, 1);
  }

  /** Fog colour that matches the dome at the horizon. */
  get fogColor(): THREE.Color {
    return this.colors.horizon;
  }

  /**
   * New sky colours and light direction. `disc` is the brightness of the sun
   * (or moon) disc in the environment bake, `glow` the strength of its halo.
   */
  setSky(colors: SkyColors, lightDirection: THREE.Vector3, disc: number, glow: number): void {
    this.colors.zenith.copy(colors.zenith);
    this.colors.horizon.copy(colors.horizon);
    this.colors.ground.copy(colors.ground);
    this.colors.sun.copy(colors.sun);
    this.direction.copy(lightDirection).normalize();
    this.disc = disc;
    this.glow = glow;
    setSkyUniforms(this.dome.material as THREE.ShaderMaterial, this.colors, this.direction, 0, glow);
  }

  /** The current environment map, baking it the first time. */
  environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
    return this.environment ? this.environment.texture : this.bake(renderer);
  }

  /**
   * Bakes the current sky into a prefiltered environment map. Rendering into
   * the bake's targets skips tone mapping and colour space conversion, so the
   * environment stays linear HDR.
   */
  bake(renderer: THREE.WebGLRenderer): THREE.Texture {
    setSkyUniforms(this.bakeSky.material as THREE.ShaderMaterial, this.colors, this.direction, this.disc, this.glow);
    this.generator ??= new THREE.PMREMGenerator(renderer);
    const previous = this.environment;
    this.environment = this.generator.fromScene(this.bakeScene, 0, 0.1, 10, { size: ENVIRONMENT_SIZE });
    previous?.dispose();
    return this.environment.texture;
  }

  /** Keeps the dome centred on the camera and just inside its far plane. */
  follow(camera: THREE.PerspectiveCamera): void {
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(camera.far * 0.9);
  }

  dispose(): void {
    this.environment?.dispose();
    this.generator?.dispose();
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.bakeSky.geometry.dispose();
    (this.bakeSky.material as THREE.Material).dispose();
  }
}
