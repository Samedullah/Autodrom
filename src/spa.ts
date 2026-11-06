import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GameSettings } from './save';
import { HeightGrid, WallGrid, forEachWorldTriangle } from './terrain';
import { freezeStatic, type WorldData } from './world';

// Circuit de Spa-Francorchamps, 1992 layout (Sketchfab model by Dave Love,
// CC BY 4.0, see ATTRIBUTION.md). The model keeps the real ~100 m of
// elevation change, so the drivable ground comes from a height field built
// from its surface meshes, and its barriers from a wall grid.

const MODEL_PATH = '/assets/models/MAP/circuit_de_spa-francorchamps_1992_layout.glb';
// Model units to metres: the circuit's ~100 m of elevation and its surface
// area both give ~0.17 m per unit; ×1.2 like the rest of the game world.
const SCALE = 0.17 * 1.2;
// Spawn on the run down from La Source towards Eau Rouge, in model units
// (Y up), facing the race direction (clockwise).
const SPAWN_MODEL = new THREE.Vector3(4460, 0, -4400);
const SPAWN_HEADING_MODEL = new THREE.Vector2(350, 800);

const HEIGHT_CELL = 2;      // m
const WALL_CELL = 1;        // m
const WALL_REACH = 1.4;     // m above the ground a wall must reach down to stop a car
const SPA_ALPHA_CUTOFF = 0.45;  // texture alpha below this is a hole (leaves, grass edges)

// Classified by material name.
const GROUND_PATTERN = /road|grass|grvl|rmbl|hill|gbrm|segwide/i;
const WALL_PATTERN = /grdrl|twall|mtla|bldg|bldn|fnc|fence|pinewall|gsbars/i;
const SHADOW_PATTERN = /grdrl|twall|mtla|bldg|bldn|fnc|fence|pine|gsbars|gurder|tent|sign/i;

let loader: GLTFLoader | null = null;

export function createSpaWorld(settings: GameSettings): WorldData {
  const root = new THREE.Group();
  root.name = 'spa-francorchamps';
  let progress = 0;
  const world: WorldData = {
    root,
    colliders: [],
    spawn: new THREE.Vector3(),
    spawnYaw: Math.atan2(SPAWN_HEADING_MODEL.x, SPAWN_HEADING_MODEL.y),
    speedGates: [],
    ramps: [],
    bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 },
    terrain: null,
    walls: null,
    ready: Promise.resolve(),
    loadProgress: () => progress,
  };
  loader ??= new GLTFLoader();
  world.ready = loader.loadAsync(MODEL_PATH, (event) => {
    if (event.lengthComputable && event.total > 0) progress = 0.85 * event.loaded / event.total;
  }).then(async (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(SCALE);
    root.add(model);
    root.updateMatrixWorld(true);

    const ground: THREE.Mesh[] = [];
    const walls: THREE.Mesh[] = [];
    const box = new THREE.Box3();
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.name).join(' ');
      if (GROUND_PATTERN.test(name)) {
        ground.push(mesh);
        box.expandByObject(mesh);
      } else if (WALL_PATTERN.test(name)) {
        walls.push(mesh);
      }
      mesh.userData.castsShadow = SHADOW_PATTERN.test(name);
      mesh.castShadow = settings.shadows && settings.quality !== 'low' && mesh.userData.castsShadow;
      mesh.receiveShadow = true;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) cutOutTransparency(material);
    });

    // Lowest ground at y = 0, like the other map.
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

    const spawn = SPAWN_MODEL.clone().multiplyScalar(SCALE);
    spawn.y = groundAt(spawn.x, spawn.z);
    world.spawn.copy(spawn);
    wallGrid.clear(spawn.x, spawn.z, 6);
    world.walls = wallGrid;

    freezeStatic(root);
    progress = 1;
  }).catch((error: unknown) => {
    console.warn('Spa haritası yüklenemedi:', error);
    progress = 1;
  });
  return world;
}

// The model marks grass, gravel, trees and the tree-line backdrop as blended
// transparency. Blended surfaces are sorted and drawn over each other every
// frame (heavy overdraw in a forest, ground drawn in the wrong order); their
// textures are really cut-outs, so draw them opaque with an alpha test.
function cutOutTransparency(material: THREE.Material): void {
  if (!material.transparent) return;
  material.transparent = false;
  material.alphaTest = SPA_ALPHA_CUTOFF;
  material.depthWrite = true;
  material.needsUpdate = true;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
