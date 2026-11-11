import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GameSettings } from './save';
import { HeightGrid, WallGrid, forEachWorldTriangle } from './terrain';
import { freezeStatic, type WorldData } from './world';

// Model-based racing circuits and mountain passes. Each track keeps its real
// elevation profile: drivable ground comes from a height field built from its
// road/runoff surface meshes, and barriers from a 2D wall occupancy grid.

const HEIGHT_CELL = 2;          // m
const WALL_CELL = 1;            // m
const WALL_REACH = 1.4;         // m above the ground a wall must reach down to stop a car
const ALPHA_CUTOFF = 0.45;      // texture alpha below this is a hole (leaves, grass edges, fences)

interface TrackWorldConfig {
  rootName: string;
  modelPath: string;
  scale: number;
  spawnWorld: THREE.Vector3;
  spawnHeading: THREE.Vector2;
  groundPattern: RegExp;
  wallPattern: RegExp;
  shadowPattern: RegExp;
  mergeStaticByMaterial?: boolean;
}

const SPA_CONFIG: TrackWorldConfig = {
  rootName: 'spa-francorchamps',
  modelPath: '/assets/models/MAP/circuit_de_spa-francorchamps_1992_layout.glb',
  // Model units to metres: the circuit's ~100 m of elevation and its surface
  // area both give ~0.17 m per unit; ×1.2 like the rest of the game world.
  scale: 0.17 * 1.2,
  // Spawn on the run down from La Source towards Eau Rouge, facing clockwise.
  spawnWorld: new THREE.Vector3(4460 * 0.17 * 1.2, 0, -4400 * 0.17 * 1.2),
  spawnHeading: new THREE.Vector2(350, 800),
  groundPattern: /road|grass|grvl|rmbl|hill|gbrm|segwide/i,
  wallPattern: /grdrl|twall|mtla|bldg|bldn|fnc|fence|pinewall|gsbars/i,
  shadowPattern: /grdrl|twall|mtla|bldg|bldn|fnc|fence|pine|gsbars|gurder|tent|sign/i,
};

const NURBURGRING_CONFIG: TrackWorldConfig = {
  rootName: 'nurburgring-gp',
  modelPath: '/assets/models/MAP/nurburgring_race_driver_grid_ds.glb',
  // Model is in metres (road width ~10 m); ×1.2 matches game world scale.
  scale: 1.2,
  // Spawn on the GP start/finish straight facing Turn 1.
  spawnWorld: new THREE.Vector3(425.05 * 1.2, 0, -388.58 * 1.2),
  spawnHeading: new THREE.Vector2(-37.40, 39.16),
  // Three.js GLTFLoader strips dots from node/mesh names via sanitizeNodeName,
  // so match `_Track01` / `_Track_Start` (case-sensitive capital T) without dots.
  groundPattern: /_Track01|_Track_Start|inf_d|nur_inf|out_d|outfld|nur_out|Nur_con|nur_wal04/,
  wallPattern: /wal13|nur_wal0[123]|wall_co|spon_w|nur_bui/,
  shadowPattern: /wal13|nur_wal0[123]|wall_co|spon_w|nur_bui|nur_tsh|nur_tpa|bmwpower/i,
  mergeStaticByMaterial: true,
};

const BUSHIDO_PEAK_CONFIG: TrackWorldConfig = {
  rootName: 'bushido-peak',
  modelPath: '/assets/models/MAP/burnout_dominator_bushido_peak.glb',
  // FBX root node carries a 0.01 cm-to-m transform; ×110 yields a ~14.5 m mountain road.
  scale: 110,
  // Spawn on the flat opening straight of unit_000 facing into unit_001.
  spawnWorld: new THREE.Vector3(-1.7830 * 110, 0, -22.2587 * 110),
  spawnHeading: new THREE.Vector2(0.5063, 0.8623),
  groundPattern: /\bunit_\d+_sub_\d+_material_0(08|09|14|38|39|40|41|42|44|64|65|68|75)_/i,
  wallPattern: /\bunit_\d+_sub_\d+_material_0(10|11|12|13|45|46|70|71|89|91)_/i,
  shadowPattern: /\bunit_\d+_sub_\d+_material_0(04|05|10|21|24|35|50|82|83)_/i,
  mergeStaticByMaterial: true,
};

let loader: GLTFLoader | null = null;

export function createSpaWorld(settings: GameSettings): WorldData {
  return createTrackWorld(SPA_CONFIG, settings);
}

export function createNurburgringWorld(settings: GameSettings): WorldData {
  return createTrackWorld(NURBURGRING_CONFIG, settings);
}

export function createBushidoPeakWorld(settings: GameSettings): WorldData {
  return createTrackWorld(BUSHIDO_PEAK_CONFIG, settings);
}

function createTrackWorld(config: TrackWorldConfig, settings: GameSettings): WorldData {
  const root = new THREE.Group();
  root.name = config.rootName;
  let progress = 0;
  const world: WorldData = {
    root,
    colliders: [],
    spawn: config.spawnWorld.clone(),
    spawnYaw: Math.atan2(config.spawnHeading.x, config.spawnHeading.y),
    speedGates: [],
    ramps: [],
    bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    terrain: null,
    walls: null,
    ready: Promise.resolve(),
    loadProgress: () => progress,
  };
  loader ??= new GLTFLoader();
  world.ready = loader.loadAsync(config.modelPath, (event) => {
    if (event.lengthComputable && event.total > 0) progress = 0.85 * event.loaded / event.total;
  }).then(async (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(config.scale);
    root.add(model);
    root.updateMatrixWorld(true);

    const ground: THREE.Mesh[] = [];
    const walls: THREE.Mesh[] = [];
    const box = new THREE.Box3();
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const matNames = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.name).join(' ');
      const label = `${mesh.parent?.name ?? ''} ${mesh.name} ${matNames}`;
      if (config.groundPattern.test(label)) {
        ground.push(mesh);
        box.expandByObject(mesh);
      }
      if (config.wallPattern.test(label)) {
        walls.push(mesh);
      }
      mesh.userData.castsShadow = config.shadowPattern.test(label);
      mesh.castShadow = settings.shadows && settings.quality !== 'low' && mesh.userData.castsShadow;
      mesh.receiveShadow = true;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) cutOutTransparency(material);
    });

    // Lowest drivable ground at y = 0, like the other maps.
    model.position.y = -box.min.y;
    root.updateMatrixWorld(true);
    box.min.y = 0;
    const bounds = { minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z };
    world.bounds = { minX: bounds.minX + 4, maxX: bounds.maxX - 4, minZ: bounds.minZ + 4, maxZ: bounds.maxZ - 4 };
    progress = 0.88;
    await nextFrame();

    const heights = new HeightGrid(bounds, HEIGHT_CELL);
    const normal = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const upness = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number => {
      normal.crossVectors(edge1.subVectors(b, a), edge2.subVectors(c, a));
      const length = normal.length();
      return length > 0 ? Math.abs(normal.y) / length : 0;
    };
    for (const mesh of ground) {
      forEachWorldTriangle(mesh, (a, b, c) => {
        if (upness(a, b, c) > 0.5) heights.addTriangle(a, b, c);
      });
    }
    heights.fillGaps(0);
    world.terrain = heights;
    progress = 0.94;
    await nextFrame();

    const wallGrid = new WallGrid(bounds, WALL_CELL);
    const groundAt = (x: number, z: number): number => heights.sample(x, z) ?? 0;
    for (const mesh of walls) {
      forEachWorldTriangle(mesh, (a, b, c) => {
        if (upness(a, b, c) < 0.6) wallGrid.addWallTriangle(a, b, c, groundAt, WALL_REACH);
      });
    }

    const spawn = config.spawnWorld.clone();
    spawn.y = groundAt(spawn.x, spawn.z);
    world.spawn.copy(spawn);
    wallGrid.clear(spawn.x, spawn.z, 6);
    world.walls = wallGrid;

    if (config.mergeStaticByMaterial) {
      batchStaticMeshes(root, model, settings);
    }

    freezeStatic(root);
    progress = 1;
  }).catch((error: unknown) => {
    console.warn(`${config.rootName} haritası yüklenemedi:`, error);
    progress = 1;
  });
  return world;
}

/**
 * Merges static single-material meshes that share the same material, shadow flag,
 * and attribute layout so multi-thousand-mesh tracks render in ~100 draw calls.
 */
function batchStaticMeshes(root: THREE.Group, model: THREE.Object3D, settings: GameSettings): void {
  const buckets = new Map<string, {
    material: THREE.Material;
    castsShadow: boolean;
    geometries: THREE.BufferGeometry[];
  }>();

  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || !mesh.geometry) return;
    const geom = mesh.geometry;
    const attrs = Object.keys(geom.attributes).sort().join(',');
    const indexed = geom.index !== null ? '1' : '0';
    const castsShadow = Boolean(mesh.userData.castsShadow);
    const key = `${mesh.material.uuid}|${castsShadow ? '1' : '0'}|${indexed}|${attrs}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mesh.material, castsShadow, geometries: [] };
      buckets.set(key, bucket);
    }
    const worldGeom = geom.clone();
    worldGeom.applyMatrix4(mesh.matrixWorld);
    bucket.geometries.push(worldGeom);
  });

  const batchedGroup = new THREE.Group();
  batchedGroup.name = `${root.name}-batched`;
  for (const bucket of buckets.values()) {
    if (bucket.geometries.length === 0) continue;
    const merged = bucket.geometries.length === 1
      ? bucket.geometries[0]
      : mergeGeometries(bucket.geometries, false);
    if (bucket.geometries.length > 1) {
      for (const g of bucket.geometries) g.dispose();
    }
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.userData.castsShadow = bucket.castsShadow;
    mesh.castShadow = settings.shadows && settings.quality !== 'low' && bucket.castsShadow;
    mesh.receiveShadow = true;
    batchedGroup.add(mesh);
  }

  root.remove(model);
  root.add(batchedGroup);
}

// The model marks grass, gravel, trees and the tree-line backdrop as blended
// transparency. Blended surfaces are sorted and drawn over each other every
// frame (heavy overdraw in a forest, ground drawn in the wrong order); their
// textures are really cut-outs, so draw them opaque with an alpha test.
function cutOutTransparency(material: THREE.Material): void {
  if (!material.transparent) return;
  material.transparent = false;
  material.alphaTest = ALPHA_CUTOFF;
  material.depthWrite = true;
  material.needsUpdate = true;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
