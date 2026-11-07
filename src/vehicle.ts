import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { VehicleSpec } from './data';
import { GLOW_LAYER } from './lampBloom';
import { applyVarnishQuality, refineVehicleMaterials, setVarnishQualityDefault } from './vehicleMaterials';
import type { GameSettings } from './save';

export interface VehicleVisual {
  root: THREE.Group;
  wheels: THREE.Group[];
  steerWheels: THREE.Group[];
  spinQuaternion: THREE.Quaternion;
  steerQuaternion: THREE.Quaternion;
  wheelRadius: number;
  procedural: THREE.Group;
  modelLoaded: boolean;
  modelWheels: Array<{
    node: THREE.Object3D;
    rest: THREE.Quaternion;
    axis: THREE.Vector3;
    steerAxis: THREE.Vector3;
    isFront: boolean;
    steerWithParent: boolean;
    radius: number;
    spinDirection: number;
  }>;
  modelSteeringNodes: Array<{
    node: THREE.Object3D;
    rest: THREE.Quaternion;
    steerAxis: THREE.Vector3;
  }>;
  modelInstance: THREE.Object3D | null;
  releaseModel: (() => void) | null;
  disposed: boolean;
  /** One entry per wheel: where it sits on the car and what moves with it. */
  suspension: WheelSuspension[];
  lights: VehicleLights;
}

interface LampMaterial {
  material: THREE.MeshStandardMaterial;
  color: THREE.Color;
  emissive: THREE.Color;
  intensity: number;
  opacity: number;
}

/** Brake and reverse lamps of the car currently shown (model or procedural). */
export interface VehicleLights {
  /** Red rear lamp materials that glow brighter under braking. */
  brakeLamps: LampMaterial[];
  /** Dedicated lit-mesh materials whose emissive color is tinted while braking. */
  brakeNodeMaterials: LampMaterial[];
  /** Original material and a material-independent red lit version per dedicated lamp mesh. */
  brakeNodeMaterialOverrides: Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; lit: THREE.Material | THREE.Material[] }>;
  /** Separate "lamp on" meshes some models ship: shown only while braking / reversing. */
  brakeNodes: THREE.Object3D[];
  reverseNodes: THREE.Object3D[];
  /** Soft red halo around each lit lamp and on the road behind; shown while braking. */
  /** Copies of the lit lamp meshes on the bloom layer: the glow spreads from the lamp itself. */
  glow: LampGlow | null;
  brake: boolean;
  reverse: boolean;
}

// Deep red with no green in it, kept modest: tone mapping pushes a strong
// red with any green towards orange. The lens itself turns red too, so a
// whitish lens does not shine back the daylight in white. Lenses with a
// texture glow through it, so the lamp's own pattern shows.
const BRAKE_GLOW = new THREE.Color(0.9, 0, 0);
const BRAKE_GLOW_INTENSITY = 1.4;
const BRAKE_GLOW_INTENSITY_TEXTURED = 2;
const LIT_LENS_TINT = new THREE.Color(1, 0.15, 0.12);
// Colour of the light the lamp spreads (bloom layer), linear and above 1 so the blur keeps it bright.
const LAMP_BLOOM_COLOR = new THREE.Color(2.6, 0.02, 0);
// A lit lens fills with light but its housing still shows through.
const BRAKE_LENS_EXTRA_OPACITY = 0.35;
const BRAKE_LENS_MAX_OPACITY = 0.85;

function lampMaterial(material: THREE.MeshStandardMaterial): LampMaterial {
  return { material, color: material.color.clone(), emissive: material.emissive.clone(), intensity: material.emissiveIntensity, opacity: material.opacity };
}

function emptyLights(): VehicleLights {
  return { brakeLamps: [], brakeNodeMaterials: [], brakeNodeMaterialOverrides: [], brakeNodes: [], reverseNodes: [], glow: null, brake: false, reverse: false };
}

// --- Contact shadow: a soft dark patch right under the car. The sun's shadow
// map is too coarse to darken the narrow gap under the body; this patch seats
// the car on the ground (also with shadows off). ---
let contactShadowTexture: THREE.CanvasTexture | null = null;

function contactShadowMap(): THREE.CanvasTexture {
  if (contactShadowTexture) return contactShadowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  // The car's footprint as a blurred rounded rectangle (not a disc), so the
  // darkening sits under the body and fades out right at its edges.
  // alphaMap reads the green channel, not alpha: draw white on opaque black.
  context.fillStyle = '#000';
  context.fillRect(0, 0, size, size);
  context.filter = 'blur(' + Math.round(size * 0.09) + 'px)';
  context.fillStyle = '#fff';
  const inset = size * 0.16;
  context.beginPath();
  context.roundRect(inset, inset, size - inset * 2, size - inset * 2, size * 0.14);
  context.fill();
  contactShadowTexture = new THREE.CanvasTexture(canvas);
  return contactShadowTexture;
}

function createContactShadow(spec: VehicleSpec): THREE.Mesh {
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.width * 1.3, spec.length * 1.22),
    new THREE.MeshBasicMaterial({
      color: 0x000000, alphaMap: contactShadowMap(), transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }),
  );
  shadow.name = 'contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  shadow.renderOrder = 1;
  shadow.castShadow = false;
  shadow.receiveShadow = false;
  shadow.userData.castsShadow = false;
  return shadow;
}

interface LampGlow { meshes: THREE.Mesh[]; material: THREE.Material }

/** A bloom-layer copy of each lamp mesh, parented to it so it follows the car. */
function createLampGlow(lamps: THREE.Mesh[]): LampGlow | null {
  if (lamps.length === 0) return null;
  const material = new THREE.MeshBasicMaterial({ color: LAMP_BLOOM_COLOR, toneMapped: false, side: THREE.DoubleSide });
  const meshes: THREE.Mesh[] = [];
  for (const lamp of lamps) {
    const skinned = lamp as THREE.SkinnedMesh;
    let glow: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const copy = new THREE.SkinnedMesh(lamp.geometry, material);
      copy.bind(skinned.skeleton, skinned.bindMatrix);
      glow = copy;
    } else {
      glow = new THREE.Mesh(lamp.geometry, material);
    }
    glow.layers.set(GLOW_LAYER);
    glow.visible = false;
    glow.castShadow = false;
    glow.userData.castsShadow = false;
    glow.frustumCulled = lamp.frustumCulled;
    lamp.add(glow);
    meshes.push(glow);
  }
  return { meshes, material };
}

function disposeBrakeGlow(lights: VehicleLights): void {
  const glow = lights.glow;
  if (!glow) return;
  for (const mesh of glow.meshes) mesh.parent?.remove(mesh);
  glow.material.dispose();
  lights.glow = null;
}

export function setVehicleLights(visual: VehicleVisual, brake: boolean, reverse: boolean): void {
  const lights = visual.lights;
  if (lights.brake !== brake) {
    lights.brake = brake;
    for (const override of lights.brakeNodeMaterialOverrides) override.mesh.material = brake ? override.lit : override.original;
    for (const lamp of lights.brakeNodeMaterials) {
      if (brake) lamp.material.emissive.copy(BRAKE_GLOW);
      else lamp.material.emissive.copy(lamp.emissive);
    }
    for (const lamp of lights.brakeLamps) {
      const material = lamp.material;
      if (brake) {
        material.color.copy(lamp.color).multiply(LIT_LENS_TINT);
        material.emissive.copy(BRAKE_GLOW);
        material.emissiveIntensity = material.emissiveMap ? BRAKE_GLOW_INTENSITY_TEXTURED : BRAKE_GLOW_INTENSITY;
        if (material.transparent) {
          material.opacity = Math.max(lamp.opacity, Math.min(BRAKE_LENS_MAX_OPACITY, lamp.opacity + BRAKE_LENS_EXTRA_OPACITY));
        }
      } else {
        material.color.copy(lamp.color);
        material.emissive.copy(lamp.emissive);
        material.emissiveIntensity = lamp.intensity;
        material.opacity = lamp.opacity;
      }
    }
    for (const node of lights.brakeNodes) node.visible = brake;
    if (lights.glow) for (const mesh of lights.glow.meshes) mesh.visible = brake;
  }
  if (lights.reverse !== reverse) {
    lights.reverse = reverse;
    for (const node of lights.reverseNodes) node.visible = reverse;
  }
}

// Models ripped from games often carry the lit lamp as its own mesh.
const BRAKE_ON_NODE_PATTERN = /(^|[^a-z])lights?_brakes?|brake_?light_?(glass_?)?lit/i;
const REVERSE_ON_NODE_PATTERN = /(^|[^a-z])lights?_reverse/i;
// Otherwise the rear lamp lens is found by its name...
const REAR_LAMP_NAME_PATTERN = /tail_?(light|lamp|lens)|brake_?(light|lamp)|stop_?(light|lamp)|rear_?(light|lamp)|red_?glass|glass_?red|(outer|inner)_?red|lglass\w*red|light\w*red/i;
const NOT_LAMP_PATTERN = /calip|callip|disc|rotor|pad|wheel|tire|tyre|(^|[^a-z])rims?([^a-z]|$)|seat|interior|badge|head/i;

function nodeLabel(object: THREE.Object3D): string {
  return object.name || String(object.userData.name ?? '');
}

/**
 * Finds the brake and reverse lamps of an installed model. Dedicated "lamp
 * on" meshes are toggled; else red rear lamp lenses (by name, or failing
 * that by being small, red and at the back) get their own material copy that
 * can glow without lighting other cars sharing the model.
 */
function findModelLights(instance: THREE.Object3D, root: THREE.Object3D, spec: VehicleSpec, owned: THREE.Material[]): VehicleLights {
  const lights = emptyLights();
  const collectToggles = (pattern: RegExp, into: THREE.Object3D[]): void => {
    instance.traverse((object) => {
      if (!pattern.test(nodeLabel(object))) return;
      for (let parent = object.parent; parent && parent !== instance; parent = parent.parent) {
        if (into.includes(parent)) return;
      }
      into.push(object);
    });
  };
  collectToggles(BRAKE_ON_NODE_PATTERN, lights.brakeNodes);
  collectToggles(REVERSE_ON_NODE_PATTERN, lights.reverseNodes);
  if (lights.brakeNodes.length > 0) {
    const lamps: THREE.Mesh[] = [];
    for (const node of lights.brakeNodes) node.traverse((child) => { if ((child as THREE.Mesh).isMesh) lamps.push(child as THREE.Mesh); });
    for (const mesh of lamps) {
      const original = mesh.material;
      const makeLit = (): THREE.Material => {
        const material = new THREE.MeshBasicMaterial({ color: 0xff1010, toneMapped: false, side: THREE.DoubleSide });
        owned.push(material);
        return material;
      };
      const lit = Array.isArray(original) ? original.map(makeLit) : makeLit();
      lights.brakeNodeMaterialOverrides.push({ mesh, original, lit });
    }
    lights.glow = createLampGlow(lamps);
    for (const node of [...lights.brakeNodes, ...lights.reverseNodes]) node.visible = false;
    return lights;
  }
  for (const node of lights.reverseNodes) node.visible = false;

  const toggled = new Set<THREE.Object3D>();
  for (const node of lights.reverseNodes) node.traverse((child) => toggled.add(child));
  const meshes: THREE.Mesh[] = [];
  instance.traverse((object) => {
    if ((object as THREE.Mesh).isMesh && !toggled.has(object)) meshes.push(object as THREE.Mesh);
  });
  const named: THREE.Mesh[] = [];
  for (const mesh of meshes) {
    let label = nodeLabel(mesh);
    for (let parent = mesh.parent; parent && parent !== instance; parent = parent.parent) label += ' ' + nodeLabel(parent);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    label += ' ' + materials.map((material) => material.name).join(' ');
    if (REAR_LAMP_NAME_PATTERN.test(label) && !NOT_LAMP_PATTERN.test(label)) named.push(mesh);
  }
  let candidates = named;
  if (candidates.length === 0) {
    root.updateWorldMatrix(true, true);
    const toRoot = root.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    candidates = meshes.filter((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const red = materials.some((material) => {
        const color = (material as THREE.MeshStandardMaterial).color;
        return color && color.r > 0.25 && color.r > color.g * 2.5 && color.r > color.b * 2.5;
      });
      if (!red) return false;
      box.setFromObject(mesh).applyMatrix4(toRoot);
      box.getSize(size);
      box.getCenter(center);
      return center.z < -spec.length * 0.36 && Math.max(size.x, size.y, size.z) < spec.width * 0.45
        && center.y > spec.height * 0.25 && center.y < spec.height * 0.85;
    });
  }
  lights.glow = createLampGlow(candidates);
  const copies = new Map<THREE.Material, THREE.Material>();
  for (const mesh of candidates) {
    const swap = (material: THREE.Material): THREE.Material => {
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
      let copy = copies.get(material);
      if (!copy) {
        copy = material.clone();
        // Glow through the lens texture. Assigned now, with the lamp still
        // dark, so braking only changes values and never recompiles a shader.
        const lens = copy as THREE.MeshStandardMaterial;
        if (!lens.emissiveMap && lens.map) lens.emissiveMap = lens.map;
        copies.set(material, copy);
        owned.push(copy);
        lights.brakeLamps.push(lampMaterial(copy as THREE.MeshStandardMaterial));
      }
      return copy;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  }
  return lights;
}

export interface WheelSuspension {
  /** Wheel centre in the vehicle's own frame (metres, +Z forward, +X right). */
  x: number;
  z: number;
  /** Nodes that travel up and down with this wheel (wheel or steering pivot, calipers). */
  nodes: Array<{ node: THREE.Object3D; rest: THREE.Vector3; up: THREE.Vector3 }>;
}

const modelLoader = new GLTFLoader();
interface CachedModel {
  promise: Promise<THREE.Object3D | null>;
  references: number;
  pendingUsers: number;
  progress: number; // 0..1 share of the file downloaded
  /** Clear-coated materials of the loaded model, whose varnish follows the quality setting. */
  varnished: THREE.MeshPhysicalMaterial[];
}

const modelCache = new Map<string, CachedModel>();

// Node names that installGeneratedModel animates (wheel spin, steering, calipers).
// GLTFLoader turns spaces in some node names into underscores.
const WHEEL_NODE_PATTERN = /^(?:3dwheel[\s_]+(?:front|rear)[\s_]+[lr](?:\b|_)|bone_wheel_(?:FR|FL|BR|BL)_rotation(?:\.\d+|\d+)?(?:\b|_)|wheel-(?:rear|front|frount)[-_]+[lr](?:[_\b]|\b))/i;
const WHEEL_CARRIER_PIVOT_PATTERN = /^bone_wheel_(?:FR|FL|BR|BL)_steer(?:\.\d+|\d+)?(?:\b|_)/i;
const STEERING_PIVOT_PATTERN = /^bone_wheel_(?:FR|FL)_steer(?:\.\d+|\d+)?(?:\b|_)/i;
const FRONT_CALIPER_PATTERN = /^bone_caliper_(?:FR|FL).{3}$/i;
const REAR_CALIPER_PATTERN = /^bone_caliper_(?:BR|BL).{3}$/i;
// Parts smaller than this share of the car length do not cast shadows; the body
// shadow already covers them and each caster costs a draw call in the shadow pass.
const SHADOW_CASTER_MIN_LENGTH_SHARE = 0.2;

function objectName(object: THREE.Object3D): string {
  return object.name || String(object.userData.name ?? '');
}

function isAnimatedNode(object: THREE.Object3D): boolean {
  const name = objectName(object);
  return WHEEL_NODE_PATTERN.test(name) || WHEEL_CARRIER_PIVOT_PATTERN.test(name)
    || FRONT_CALIPER_PATTERN.test(name) || REAR_CALIPER_PATTERN.test(name);
}

function toFloatAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attribute;
  const array = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < itemSize; c += 1) array[i * itemSize + c] = attribute.getComponent(i, c);
  }
  return new THREE.BufferAttribute(array, itemSize);
}

/**
 * Imported cars often arrive as hundreds of primitives, each a separate draw
 * call (twice with shadows). Bake every mesh that never moves relative to the
 * model into one mesh per material. Animated subtrees stay untouched so wheel
 * and steering pivots keep working.
 */
function mergeStaticMeshes(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const modelInverse = model.matrixWorld.clone().invert();
  const groups = new Map<string, { material: THREE.Material; geometries: THREE.BufferGeometry[]; sources: THREE.Mesh[] }>();
  const visit = (object: THREE.Object3D): void => {
    if (isAnimatedNode(object)) return;
    const mesh = object as THREE.Mesh;
    const mergeable = mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh
      && !Array.isArray(mesh.material) && Object.keys(mesh.geometry.morphAttributes).length === 0;
    if (mergeable) {
      const material = mesh.material as THREE.Material;
      const source = mesh.geometry;
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, toFloatAttribute(attribute));
      if (source.index) geometry.setIndex(Array.from(source.index.array));
      const transform = modelInverse.clone().multiply(mesh.matrixWorld);
      geometry.applyMatrix4(transform);
      if (transform.determinant() < 0) {
        // A mirrored transform reverses triangle winding once baked into vertices.
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
        const index = geometry.index!;
        for (let i = 0; i + 2 < index.count; i += 3) {
          const b = index.getX(i + 1);
          index.setX(i + 1, index.getX(i + 2));
          index.setX(i + 2, b);
        }
      }
      const signature = Object.keys(geometry.attributes).sort().map((name) => name + geometry.attributes[name].itemSize).join(',');
      const key = material.uuid + '|' + signature + '|' + (geometry.index ? 'i' : 'n');
      const group = groups.get(key) ?? { material, geometries: [], sources: [] };
      group.geometries.push(geometry);
      group.sources.push(mesh);
      groups.set(key, group);
    }
    for (const child of object.children) visit(child);
  };
  visit(model);

  const replacedGeometries = new Set<THREE.BufferGeometry>();
  for (const group of groups.values()) {
    if (group.sources.length < 2) {
      for (const geometry of group.geometries) geometry.dispose();
      continue;
    }
    const merged = mergeGeometries(group.geometries);
    for (const geometry of group.geometries) geometry.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, group.material);
    mesh.name = 'merged-static';
    model.add(mesh);
    for (const source of group.sources) {
      source.removeFromParent();
      replacedGeometries.add(source.geometry);
    }
  }
  for (const geometry of replacedGeometries) geometry.dispose();

  // Drop now-empty transform nodes so per-frame matrix updates stay cheap.
  const prune = (object: THREE.Object3D): boolean => {
    for (const child of [...object.children]) {
      if (prune(child)) child.removeFromParent();
    }
    return object !== model && object.children.length === 0 && !(object as THREE.Mesh).isMesh
      && !isAnimatedNode(object) && !(object as THREE.Bone).isBone;
  };
  prune(model);
}
let manifestPromise: Promise<Set<string>> | null = null;

async function availableModels(): Promise<Set<string>> {
  if (!manifestPromise) {
    manifestPromise = fetch('/assets/models/manifest.json', { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) return new Set<string>();
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !Array.isArray((data as { models?: unknown }).models)) return new Set<string>();
        return new Set((data as { models: unknown[] }).models.filter((id): id is string => typeof id === 'string'));
      })
      .catch(() => new Set<string>());
  }
  return manifestPromise;
}

function makeMaterial(color: string, roughness = 0.42, metalness = 0.24): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function sideVolume(points: Array<[number, number]>, width: number, material: THREE.Material, bevel = 0.02): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelThickness: bevel,
    bevelSize: bevel,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -width / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.y = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function panel(points: Array<[number, number, number]>, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.material.side = THREE.DoubleSide;
  return mesh;
}

function createWheel(radius: number, width: number, dark: THREE.Material, rim: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18, 1), dark);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.61, radius * 0.61, width * 1.035, 16, 1), rim);
  disc.rotation.z = Math.PI / 2;
  group.add(disc);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.18, radius * 0.18, width * 1.06, 12, 1), dark);
  hub.rotation.z = Math.PI / 2;
  group.add(hub);
  return group;
}

export function createVehicleVisual(spec: VehicleSpec): VehicleVisual {
  const root = new THREE.Group();
  root.scale.setScalar(1.1);
  const procedural = new THREE.Group();
  root.add(procedural);
  const wheels: THREE.Group[] = [];
  const steerWheels: THREE.Group[] = [];
  const body = makeMaterial(spec.bodyColor, 0.32, 0.42);
  const trim = makeMaterial('#19211f', 0.62, 0.16);
  const rubber = makeMaterial('#111614', 0.83, 0.05);
  const alloy = makeMaterial('#aebbb4', 0.24, 0.8);
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#253b42', roughness: 0.16, metalness: 0.48, transparent: true, opacity: 0.9,
  });
  const headlight = new THREE.MeshStandardMaterial({ color: '#e8f8de', emissive: '#bde8ca', emissiveIntensity: 1.5 });
  const taillight = new THREE.MeshStandardMaterial({ color: '#e94742', emissive: '#c21e1b', emissiveIntensity: 1.1 });
  const length = spec.length;
  const width = spec.width;
  const h = spec.height;
  const isM3Gtr = spec.id === 'bmw-m3-gtr';
  const front = length / 2;
  const rear = -length / 2;
  const wheelRadius = spec.bodyStyle === 'super' ? 0.4 : 0.37;
  const wheelX = width * 0.51;
  const axleFront = length * (spec.bodyStyle === 'hatch' ? 0.31 : 0.32);
  const axleRear = -length * 0.31;

  let hoodHeight = 0.83;
  let roofHeight = h;
  let cabinRear = -0.17 * length;
  let cabinFront = 0.16 * length;
  if (spec.bodyStyle === 'hatch') {
    hoodHeight = 0.82;
    cabinRear = -0.34 * length;
    cabinFront = 0.16 * length;
  } else if (spec.bodyStyle === 'sedan') {
    hoodHeight = 0.83;
    cabinRear = -0.22 * length;
    cabinFront = 0.15 * length;
  } else if (spec.bodyStyle === 'roadster') {
    roofHeight = h * 0.84;
    cabinRear = -0.1 * length;
    cabinFront = 0.15 * length;
  } else if (spec.bodyStyle === 'super') {
    hoodHeight = 0.72;
    roofHeight = h * 0.97;
    cabinRear = -0.12 * length;
    cabinFront = 0.19 * length;
  }

  const bodyProfile: Array<[number, number]> = [
    [rear, 0.34], [rear + 0.08, 0.78], [rear + 0.28, 0.9],
    [rear + length * 0.34, 0.88], [rear + length * 0.49, hoodHeight],
    [front - 0.12, hoodHeight * 0.97], [front, 0.48], [front - 0.04, 0.34],
  ];
  procedural.add(sideVolume(bodyProfile, width * 0.92, body, 0.035));

  const cabinProfile: Array<[number, number]> = [
    [cabinRear - length * 0.17, 0.88],
    [cabinRear, roofHeight - 0.05],
    [cabinFront, roofHeight],
    [cabinFront + length * 0.14, Math.max(0.82, hoodHeight + 0.08)],
    [cabinFront + length * 0.08, 0.87],
  ];
  procedural.add(sideVolume(cabinProfile, width * (spec.bodyStyle === 'super' ? 0.77 : 0.81), body, 0.025));

  const glassSide = new THREE.MeshStandardMaterial({ color: '#253e45', roughness: 0.2, metalness: 0.35, side: THREE.DoubleSide });
  const sideWindowPoints: Array<[number, number]> = [
    [cabinRear + length * 0.035, roofHeight - 0.15],
    [cabinRear + length * 0.07, roofHeight - 0.12],
    [cabinFront - length * 0.055, roofHeight - 0.12],
    [cabinFront + length * 0.055, 0.94],
    [cabinFront - length * 0.04, 0.92],
    [cabinRear + length * 0.03, 0.91],
  ];
  const windowShape = new THREE.Shape();
  windowShape.moveTo(sideWindowPoints[0][0], sideWindowPoints[0][1]);
  for (let i = 1; i < sideWindowPoints.length; i += 1) windowShape.lineTo(sideWindowPoints[i][0], sideWindowPoints[i][1]);
  windowShape.closePath();
  for (const side of [-1, 1]) {
    const windowMesh = new THREE.Mesh(new THREE.ShapeGeometry(windowShape), glassSide);
    windowMesh.rotation.y = -Math.PI / 2;
    windowMesh.position.x = side * width * 0.408;
    procedural.add(windowMesh);
  }

  const windshieldFrontZ = cabinFront + length * 0.07;
  const windshieldBaseZ = cabinFront + length * 0.15;
  const windshield = panel([
    [-width * 0.335, 0.96, windshieldFrontZ],
    [width * 0.335, 0.96, windshieldFrontZ],
    [width * 0.37, hoodHeight + 0.04, windshieldBaseZ],
    [-width * 0.37, hoodHeight + 0.04, windshieldBaseZ],
  ], glass);
  procedural.add(windshield);

  const rearGlass = panel([
    [-width * 0.33, 0.93, cabinRear - length * 0.02],
    [width * 0.33, 0.93, cabinRear - length * 0.02],
    [width * 0.37, 0.84, cabinRear - length * 0.13],
    [-width * 0.37, 0.84, cabinRear - length * 0.13],
  ], glass);
  procedural.add(rearGlass);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.89, 0.13, 0.15), trim);
  bumper.position.set(0, 0.4, front - 0.015);
  procedural.add(bumper);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(width * 0.87, 0.12, 0.14), trim);
  rearBumper.position.set(0, 0.4, rear + 0.015);
  procedural.add(rearBumper);

  const grille = new THREE.Mesh(new THREE.BoxGeometry(width * 0.28, 0.17, 0.035), trim);
  grille.position.set(0, 0.57, front - 0.035);
  procedural.add(grille);
  if (isM3Gtr) {
    for (const side of [-1, 1]) {
      const kidney = new THREE.Mesh(new THREE.BoxGeometry(width * 0.105, 0.19, 0.045), trim);
      kidney.position.set(side * width * 0.09, 0.575, front - 0.06);
      procedural.add(kidney);
    }
    const stripeColors = ['#1673b8', '#80b7d5', '#d82f3c'];
    stripeColors.forEach((color, index) => {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.018, 0.72), makeMaterial(color, 0.43, 0.12));
      stripe.position.set((index - 1) * 0.075, hoodHeight + 0.012, front - 0.49);
      procedural.add(stripe);
      const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.014, 0.84), makeMaterial(color, 0.43, 0.12));
      roofStripe.position.set((index - 1) * 0.06, roofHeight + 0.008, -0.08);
      procedural.add(roofStripe);
    });
    for (const side of [-1, 1]) {
      const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, length * 0.55), makeMaterial('#1673b8', 0.43, 0.12));
      sideStripe.position.set(side * width * 0.47, 0.49, -0.02);
      procedural.add(sideStripe);
    }
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(width * 1.04, 0.055, 0.32), trim);
    splitter.position.set(0, 0.34, front + 0.035);
    procedural.add(splitter);
  }

  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(width * 0.17, 0.105, 0.045), headlight);
    lamp.position.set(side * width * 0.32, 0.69, front - 0.045);
    procedural.add(lamp);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(width * 0.16, 0.12, 0.045), taillight);
    tail.position.set(side * width * 0.32, 0.69, rear + 0.035);
    procedural.add(tail);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.18), body);
    mirror.position.set(side * width * 0.48, 0.92, cabinFront + length * 0.06);
    procedural.add(mirror);
  }

  const suspension: WheelSuspension[] = [];
  for (const z of [axleFront, axleRear]) {
    for (const side of [-1, 1]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(side * wheelX, wheelRadius + 0.025, z);
      const wheel = createWheel(wheelRadius, 0.23, rubber, alloy);
      steeringPivot.add(wheel);
      procedural.add(steeringPivot);
      wheels.push(wheel);
      if (z === axleFront) steerWheels.push(steeringPivot);
      suspension.push({
        x: side * wheelX, z,
        nodes: [{ node: steeringPivot, rest: steeringPivot.position.clone(), up: new THREE.Vector3(0, 1, 0) }],
      });
    }
  }

  if (spec.bodyStyle === 'sport' || spec.bodyStyle === 'super') {
    const spoilerHeight = isM3Gtr ? 1.31 : 1.05;
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(width * (isM3Gtr ? 0.96 : 0.82), isM3Gtr ? 0.075 : 0.06, isM3Gtr ? 0.38 : 0.3),
      trim,
    );
    spoiler.position.set(0, spoilerHeight, rear + 0.14);
    procedural.add(spoiler);
    for (const side of [-1, 1]) {
      const finHeight = isM3Gtr ? 0.35 : 0.23;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.07, finHeight, 0.07), trim);
      fin.position.set(side * width * 0.32, spoilerHeight - finHeight * 0.52, rear + 0.16);
      procedural.add(fin);
    }
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(width * 0.9, 0.065, length * 0.42), trim);
    skirt.position.set(0, 0.39, 0);
    procedural.add(skirt);
  }

  const undertray = new THREE.Mesh(new THREE.BoxGeometry(width * 0.68, 0.12, length * 0.74), trim);
  undertray.position.y = 0.39;
  procedural.add(undertray);
  procedural.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  const visual: VehicleVisual = {
    root,
    wheels,
    steerWheels,
    spinQuaternion: new THREE.Quaternion(),
    steerQuaternion: new THREE.Quaternion(),
    wheelRadius,
    procedural,
    modelLoaded: false,
    modelWheels: [],
    modelSteeringNodes: [],
    lights: { ...emptyLights(), brakeLamps: [lampMaterial(taillight)] },
    modelInstance: null,
    releaseModel: null,
    disposed: false,
    suspension,
  };
  root.add(createContactShadow(spec));
  const tails: THREE.Mesh[] = [];
  procedural.traverse((object) => { if ((object as THREE.Mesh).material === taillight) tails.push(object as THREE.Mesh); });
  visual.lights.glow = createLampGlow(tails);
  return visual;
}

function getCachedModel(path: string, targetLength: number, rotationY = 0, excludeNodes: string[] = []): CachedModel {
  const cached = modelCache.get(path);
  if (cached) return cached;
  const entry: CachedModel = { promise: Promise.resolve(null), references: 0, pendingUsers: 0, progress: 0, varnished: [] };
  entry.promise = modelLoader.loadAsync(path, (event) => {
    if (event.lengthComputable && event.total > 0) entry.progress = event.loaded / event.total;
  }).then((gltf) => {
    entry.progress = 1;
    const model = gltf.scene;
    if (excludeNodes.length > 0) {
      const excluded = new Set(excludeNodes);
      const nodesToRemove: THREE.Object3D[] = [];
      model.traverse((object) => {
        if (excluded.has(object.name)) nodesToRemove.push(object);
      });
      for (const object of nodesToRemove) object.parent?.remove(object);
    }
    model.rotation.y = rotationY;
    model.updateMatrixWorld(true);
    let bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const modelLength = Math.max(size.z, 0.01);
    model.scale.setScalar(targetLength / modelLength);
    model.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;
    entry.varnished = refineVehicleMaterials(model, targetLength);
    mergeStaticMeshes(model);
    model.updateMatrixWorld(true);
    const partBounds = new THREE.Box3();
    const partSize = new THREE.Vector3();
    model.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        partBounds.setFromObject(object).getSize(partSize);
        object.userData.castsShadow = Math.max(partSize.x, partSize.y, partSize.z) >= targetLength * SHADOW_CASTER_MIN_LENGTH_SHARE;
        object.castShadow = object.userData.castsShadow;
        object.receiveShadow = true;
      }
    });
    return model;
  }).catch((error: unknown) => {
    console.warn('Araç modeli yüklenemedi; yedek model kullanılacak:', path, error);
    return null;
  });
  modelCache.set(path, entry);
  return entry;
}

/** Applies the quality setting to every loaded car's paint (and to cars loaded later). */
export function setVehicleMaterialQuality(quality: GameSettings['quality']): void {
  setVarnishQualityDefault(quality);
  for (const entry of modelCache.values()) applyVarnishQuality(entry.varnished, quality);
}

// How much of a car's model file has downloaded (0 when it has not started).
export function modelDownloadProgress(spec: VehicleSpec): number {
  return modelCache.get(spec.modelPath)?.progress ?? 0;
}

export async function installGeneratedModel(visual: VehicleVisual, spec: VehicleSpec): Promise<boolean> {
  if (!(await availableModels()).has(spec.id)) return false;
  if (visual.disposed) return false;
  const cached = getCachedModel(spec.modelPath, spec.length, spec.modelRotationY, spec.modelExcludeNodes);
  cached.pendingUsers += 1;
  try {
    const source = await cached.promise;
    if (!source || visual.disposed) return false;
    // Some imported cars contain skinned meshes. Object3D.clone() leaves their
    // skeletons pointing at the cached source hierarchy, so clone bones too.
    const instance = cloneSkinnedModel(source);
    const wheelNodes: THREE.Object3D[] = [];
    const wheelCarrierPivots: THREE.Object3D[] = [];
    const steeringPivotNodes: THREE.Object3D[] = [];
    const caliperNodes: THREE.Object3D[] = [];
    const rearCaliperNodes: THREE.Object3D[] = [];
    instance.traverse((object) => {
      const nodeName = object.name || String(object.userData.name ?? '');
      // GLTFLoader turns spaces in some node names into underscores.
      const isNamedWheel = WHEEL_NODE_PATTERN.test(nodeName);
      const isWheelCarrierPivot = WHEEL_CARRIER_PIVOT_PATTERN.test(nodeName);
      const isFrontSteeringPivot = STEERING_PIVOT_PATTERN.test(nodeName);
      const isFrontCaliper = FRONT_CALIPER_PATTERN.test(nodeName);
      const isRearCaliper = REAR_CALIPER_PATTERN.test(nodeName);
      if (!isNamedWheel && !isWheelCarrierPivot && !isFrontCaliper && !isRearCaliper) return;
      // GLTF nodes authored with a matrix keep matrixAutoUpdate disabled. Decompose
      // their existing pivot transform before changing quaternions each frame.
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.matrixAutoUpdate = true;
      if (isNamedWheel) wheelNodes.push(object);
      if (isWheelCarrierPivot) wheelCarrierPivots.push(object);
      if (isFrontSteeringPivot) steeringPivotNodes.push(object);
      if (isFrontCaliper) caliperNodes.push(object);
      if (isRearCaliper) rearCaliperNodes.push(object);
    });
    cached.references += 1;
    visual.modelInstance = instance;
    const lampMaterials: THREE.Material[] = [];
    visual.releaseModel = () => {
      for (const material of lampMaterials) material.dispose();
      cached.references = Math.max(0, cached.references - 1);
      releaseModelIfUnused(spec.modelPath, cached);
    };
    visual.root.add(instance);
    visual.root.updateWorldMatrix(true, true);
    const wasBraking = visual.lights.brake;
    const wasReversing = visual.lights.reverse;
    setVehicleLights(visual, false, false);
    disposeBrakeGlow(visual.lights);
    visual.lights = findModelLights(instance, visual.root, spec, lampMaterials);
    setVehicleLights(visual, wasBraking, wasReversing);
    const rootInverseQuaternion = visual.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const forward = new THREE.Vector3(0, 0, 1);
    const down = new THREE.Vector3(0, -1, 0);
    const hasSteeringPivotAncestor = (node: THREE.Object3D): boolean => {
      let parent = node.parent;
      while (parent && parent !== instance) {
        if (steeringPivotNodes.includes(parent)) return true;
        parent = parent.parent;
      }
      return false;
    };
    // A few GLBs (including the F80 M3) export front calipers as siblings of
    // the steering pivots. Rotating those calipers in place makes them drift
    // away from the brake disc. Reparent them under the matching wheel pivot;
    // attach() preserves their current world transform and makes them follow
    // the wheel's steering motion as a fixed brake assembly.
    for (const caliper of caliperNodes) {
      if (hasSteeringPivotAncestor(caliper)) continue;
      const caliperName = caliper.name || String(caliper.userData.name ?? '');
      const side = caliperName.match(/^bone_caliper_(FR|FL)/i)?.[1]?.toUpperCase();
      if (!side) continue;
      const pivot = steeringPivotNodes.find((node) => {
        const pivotName = node.name || String(node.userData.name ?? '');
        return new RegExp(`^bone_wheel_${side}_steer`, 'i').test(pivotName);
      });
      if (pivot) pivot.attach(caliper);
    }
    instance.updateWorldMatrix(true, true);
    const steeringNodes = [
      ...steeringPivotNodes,
      ...caliperNodes.filter((node) => !hasSteeringPivotAncestor(node)),
    ];
    visual.modelWheels = wheelNodes.length === 4
      ? wheelNodes.map((node) => {
        const bounds = getWheelLocalBounds(node);
        const size = bounds.getSize(new THREE.Vector3());
        const dimensions = [size.x, size.y, size.z];
        const axleIndex = dimensions.indexOf(Math.min(...dimensions));
        const axis = new THREE.Vector3().setComponent(axleIndex, 1);
        const diameters = dimensions.filter((_, index) => index !== axleIndex);
        // Bounds are expressed in the wheel pivot's local units. Include the
        // scale of every ancestor (some GLBs put centimeter conversion on a
        // wheel/steer pivot, not only on the model root) to get a world-space
        // radius matching wheelTravel.
        const localRadius = Math.max(0.001, (diameters[0] + diameters[1]) / 4);
        const wheelWorldScale = node.getWorldScale(new THREE.Vector3());
        const vehicleWorldScale = visual.root.getWorldScale(new THREE.Vector3());
        wheelWorldScale.divide(vehicleWorldScale);
        const radialScale = Math.sqrt(
          wheelWorldScale.getComponent((axleIndex + 1) % 3)
          * wheelWorldScale.getComponent((axleIndex + 2) % 3),
        );
        const radius = localRadius * radialScale;
        const rootRelativeQuaternion = rootInverseQuaternion.clone()
          .multiply(node.getWorldQuaternion(new THREE.Quaternion()));
        const axleInVehicle = axis.clone().applyQuaternion(rootRelativeQuaternion).normalize();
        const positiveRotationTravel = new THREE.Vector3().crossVectors(axleInVehicle, down).dot(forward);
        const spinDirection = positiveRotationTravel >= 0 ? -1 : 1;
        const parentQuaternion = node.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
        const parentRelativeQuaternion = rootInverseQuaternion.clone().multiply(parentQuaternion);
        const steerAxis = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(parentRelativeQuaternion.invert())
          .normalize();
        const nodeName = node.name || String(node.userData.name ?? '');
        const isFront = /^(?:3dwheel[\s_]+front[\s_]+[lr](?:\b|_)|bone_wheel_(?:FR|FL)_rotation(?:\.\d+|\d+)?(?:\b|_)|wheel-(?:front|frount)[-_]+[lr](?:[_\b]|\b))/i.test(nodeName);
        return { node, rest: node.quaternion.clone(), axis, steerAxis, isFront, steerWithParent: isFront && hasSteeringPivotAncestor(node), radius, spinDirection };
      })
      : [];
    visual.modelSteeringNodes = steeringNodes.map((node) => {
      const parentQuaternion = node.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
      const parentRelativeQuaternion = rootInverseQuaternion.clone().multiply(parentQuaternion);
      const steerAxis = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(parentRelativeQuaternion.invert())
        .normalize();
      return { node, rest: node.quaternion.clone(), steerAxis };
    });
    if (wheelNodes.length !== 4) {
      console.warn('Araçta 4 tekerlek pivotu bulunamadı:', spec.id, wheelNodes.map((node) => node.name));
    }
    if (visual.modelWheels.length === 4) {
      visual.suspension = buildModelSuspension(visual, wheelCarrierPivots, [...caliperNodes, ...rearCaliperNodes]);
    }
    visual.procedural.visible = false;
    visual.modelLoaded = true;
    return true;
  } catch (error) {
    console.warn('Araç modeli kurulamadı; yedek model kullanılacak:', spec.modelPath, error);
    return false;
  } finally {
    cached.pendingUsers = Math.max(0, cached.pendingUsers - 1);
    releaseModelIfUnused(spec.modelPath, cached);
  }
}

function releaseModelIfUnused(path: string, cached: CachedModel): void {
  if (cached.references > 0 || cached.pendingUsers > 0 || modelCache.get(path) !== cached) return;
  modelCache.delete(path);
  void cached.promise.then((model) => {
    if (model) disposeObjectResources(model);
  });
}

function disposeObjectResources(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      const assigned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of assigned) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

/**
 * Groups each model wheel with the nodes that must follow its suspension travel:
 * the wheel itself, or the steering pivot carrying it, plus any loose caliper.
 */
function buildModelSuspension(
  visual: VehicleVisual,
  wheelCarrierPivots: readonly THREE.Object3D[],
  calipers: readonly THREE.Object3D[],
): WheelSuspension[] {
  visual.root.updateWorldMatrix(true, true);
  const rootInverse = visual.root.matrixWorld.clone().invert();
  const travelEntry = (node: THREE.Object3D) => {
    // Vehicle "up" by one metre, expressed in the node's parent space.
    const parentWorld = node.parent?.matrixWorld ?? new THREE.Matrix4();
    const rootToParent = parentWorld.clone().invert().multiply(visual.root.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(rootToParent));
    node.matrix.decompose(node.position, node.quaternion, node.scale);
    node.matrixAutoUpdate = true;
    return { node, rest: node.position.clone(), up };
  };
  const moved = new Set<THREE.Object3D>();
  const suspension = visual.modelWheels.map((wheel) => {
    const center = getWheelLocalBounds(wheel.node).getCenter(new THREE.Vector3())
      .applyMatrix4(wheel.node.matrixWorld).applyMatrix4(rootInverse);
    let carrier = wheel.node;
    for (let parent = wheel.node.parent; parent; parent = parent.parent) {
      if (wheelCarrierPivots.includes(parent)) carrier = parent;
    }
    moved.add(carrier);
    return { x: center.x, z: center.z, nodes: [travelEntry(carrier)] };
  });
  const isUnderMovedNode = (node: THREE.Object3D): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent) if (moved.has(parent)) return true;
    return false;
  };
  for (const caliper of calipers) {
    if (moved.has(caliper) || isUnderMovedNode(caliper)) continue;
    const position = new THREE.Box3().setFromObject(caliper).getCenter(new THREE.Vector3()).applyMatrix4(rootInverse);
    let nearest = suspension[0];
    for (const entry of suspension) {
      if (Math.hypot(entry.x - position.x, entry.z - position.z) < Math.hypot(nearest.x - position.x, nearest.z - position.z)) nearest = entry;
    }
    nearest.nodes.push(travelEntry(caliper));
  }
  return suspension;
}

/** Moves every wheel by its suspension travel (metres, + is up toward the body). */
export function setVehicleSuspension(visual: VehicleVisual, travel: readonly number[]): void {
  for (let i = 0; i < visual.suspension.length; i += 1) {
    for (const part of visual.suspension[i].nodes) {
      part.node.position.copy(part.rest).addScaledVector(part.up, travel[i] ?? 0);
      part.node.updateMatrix();
    }
  }
}

function getWheelLocalBounds(node: THREE.Object3D): THREE.Box3 {
  node.updateWorldMatrix(true, true);
  const inverseNodeWorld = node.matrixWorld.clone().invert();
  const bounds = new THREE.Box3().makeEmpty();
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    const meshToNode = inverseNodeWorld.clone().multiply(child.matrixWorld);
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(meshToNode));
  });
  return bounds;
}

export function disposeVehicleVisual(visual: VehicleVisual): void {
  if (visual.disposed) return;
  visual.disposed = true;
  visual.root.parent?.remove(visual.root);
  disposeObjectResources(visual.procedural);
  if (visual.modelInstance) visual.root.remove(visual.modelInstance);
  visual.modelInstance = null;
  visual.modelWheels = [];
  visual.modelSteeringNodes = [];
  visual.releaseModel?.();
  visual.releaseModel = null;
  disposeBrakeGlow(visual.lights);
  const contactShadow = visual.root.getObjectByName('contact-shadow') as THREE.Mesh | undefined;
  if (contactShadow) {
    contactShadow.geometry.dispose();
    (contactShadow.material as THREE.Material).dispose();
  }
  visual.root.clear();
}

export function setVehicleWheelSpin(visual: VehicleVisual, distance: number, steeringAngle = 0, rearDistance = distance): void {
  // Procedural wheels use +X as their axle and the car moves along +Z.
  for (const wheel of visual.steerWheels) wheel.rotation.y = steeringAngle;
  for (let i = 0; i < visual.wheels.length; i += 1) {
    const wheelDistance = i >= 2 ? rearDistance : distance;
    visual.wheels[i].rotation.x = -wheelDistance / visual.wheelRadius;
  }
  for (const wheel of visual.modelWheels) {
    const wheelDistance = wheel.isFront ? distance : rearDistance;
    const angle = wheelDistance / wheel.radius * wheel.spinDirection;
    visual.spinQuaternion.setFromAxisAngle(wheel.axis, angle);
    wheel.node.quaternion.copy(wheel.rest);
    if (wheel.isFront && !wheel.steerWithParent) {
      visual.steerQuaternion.setFromAxisAngle(wheel.steerAxis, steeringAngle);
      wheel.node.quaternion.premultiply(visual.steerQuaternion);
    }
    wheel.node.quaternion.multiply(visual.spinQuaternion);
    wheel.node.updateMatrix();
  }
  for (const part of visual.modelSteeringNodes) {
    visual.steerQuaternion.setFromAxisAngle(part.steerAxis, steeringAngle);
    part.node.quaternion.copy(part.rest).premultiply(visual.steerQuaternion);
    part.node.updateMatrix();
  }
}
