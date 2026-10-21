import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinnedModel } from 'three/addons/utils/SkeletonUtils.js';
import type { VehicleSpec } from './data';

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
}

const modelLoader = new GLTFLoader();
interface CachedModel {
  promise: Promise<THREE.Object3D | null>;
  references: number;
  pendingUsers: number;
}

const modelCache = new Map<string, CachedModel>();
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

  for (const z of [axleFront, axleRear]) {
    for (const side of [-1, 1]) {
      const steeringPivot = new THREE.Group();
      steeringPivot.position.set(side * wheelX, wheelRadius + 0.025, z);
      const wheel = createWheel(wheelRadius, 0.23, rubber, alloy);
      steeringPivot.add(wheel);
      procedural.add(steeringPivot);
      wheels.push(wheel);
      if (z === axleFront) steerWheels.push(steeringPivot);
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
  return {
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
    modelInstance: null,
    releaseModel: null,
    disposed: false,
  };
}

function getCachedModel(path: string, targetLength: number, rotationY = 0, excludeNodes: string[] = []): CachedModel {
  const cached = modelCache.get(path);
  if (cached) return cached;
  const entry: CachedModel = { promise: Promise.resolve(null), references: 0, pendingUsers: 0 };
  entry.promise = modelLoader.loadAsync(path).then((gltf) => {
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
    model.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        object.castShadow = true;
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
    const steeringPivotNodes: THREE.Object3D[] = [];
    const caliperNodes: THREE.Object3D[] = [];
    instance.traverse((object) => {
      const nodeName = object.name || String(object.userData.name ?? '');
      // GLTFLoader turns spaces in some node names into underscores.
      const isNamedWheel = /^(?:3dwheel[\s_]+(?:front|rear)[\s_]+[lr](?:\b|_)|bone_wheel_(?:FR|FL|BR|BL)_rotation(?:\.\d+|\d+)?(?:\b|_)|wheel-(?:rear|front|frount)[-_]+[lr](?:[_\b]|\b))/i.test(nodeName);
      const isFrontSteeringPivot = /^bone_wheel_(?:FR|FL)_steer(?:\.\d+|\d+)?(?:\b|_)/i.test(nodeName);
      const isFrontCaliper = /^bone_caliper_(?:FR|FL).{3}$/i.test(nodeName);
      if (!isNamedWheel && !isFrontSteeringPivot && !isFrontCaliper) return;
      // GLTF nodes authored with a matrix keep matrixAutoUpdate disabled. Decompose
      // their existing pivot transform before changing quaternions each frame.
      object.matrix.decompose(object.position, object.quaternion, object.scale);
      object.matrixAutoUpdate = true;
      if (isNamedWheel) wheelNodes.push(object);
      if (isFrontSteeringPivot) steeringPivotNodes.push(object);
      if (isFrontCaliper) caliperNodes.push(object);
    });
    cached.references += 1;
    visual.modelInstance = instance;
    visual.releaseModel = () => {
      cached.references = Math.max(0, cached.references - 1);
      releaseModelIfUnused(spec.modelPath, cached);
    };
    visual.root.add(instance);
    visual.root.updateWorldMatrix(true, true);
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
