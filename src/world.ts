import * as THREE from 'three';
import type { MapId } from './data';
import type { GameSettings } from './save';

export interface WorldCollider {
  x: number;
  z: number;
  halfX: number;
  halfZ: number;
}

export interface WorldData {
  root: THREE.Group;
  colliders: WorldCollider[];
  spawn: THREE.Vector3;
  spawnYaw: number;
  speedGates: SpeedGate[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface SpeedGate {
  id: string;
  center: THREE.Vector3;
  direction: THREE.Vector3;
  halfWidth: number;
}

const cityRoadCenters = [-135, -45, 45, 135];

function standard(color: string, roughness = 0.8, metalness = 0.04): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function flatPlane(width: number, depth: number, color: string, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), standard(color));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true;
  return mesh;
}

function addDashMarks(
  parent: THREE.Group,
  horizontal: boolean,
  line: number,
  from: number,
  to: number,
  spacing: number,
  y: number,
  color: string,
): void {
  const count = Math.floor((to - from) / spacing);
  if (count <= 0) return;
  const geometry = new THREE.BoxGeometry(horizontal ? 5 : 0.22, 0.025, horizontal ? 0.22 : 5);
  const material = standard(color, 0.78, 0.03);
  const marks = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i += 1) {
    const along = from + i * spacing;
    dummy.position.set(horizontal ? along : line, y, horizontal ? line : along);
    dummy.updateMatrix();
    marks.setMatrixAt(i, dummy.matrix);
  }
  marks.instanceMatrix.needsUpdate = true;
  marks.receiveShadow = true;
  parent.add(marks);
}

function addCityBuildings(parent: THREE.Group, colliders: WorldCollider[]): void {
  const rng = seededRandom(74);
  const buildings: Array<{ x: number; z: number; w: number; d: number; h: number; color: THREE.Color }> = [];
  const palettes = ['#687975', '#887e70', '#747d78', '#948d7f', '#5d706f', '#aba18b'];
  for (let row = 0; row < cityRoadCenters.length - 1; row += 1) {
    for (let col = 0; col < cityRoadCenters.length - 1; col += 1) {
      const cx = (cityRoadCenters[col] + cityRoadCenters[col + 1]) / 2;
      const cz = (cityRoadCenters[row] + cityRoadCenters[row + 1]) / 2;
      const total = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < total; i += 1) {
        const w = 15 + rng() * 17;
        const d = 14 + rng() * 18;
        const h = 12 + rng() * (i % 3 === 0 ? 32 : 20);
        const x = cx + (rng() - 0.5) * 38;
        const z = cz + (rng() - 0.5) * 37;
        buildings.push({ x, z, w, d, h, color: new THREE.Color(palettes[Math.floor(rng() * palettes.length)]) });
        colliders.push({ x, z, halfX: w * 0.5 + 0.7, halfZ: d * 0.5 + 0.7 });
      }
    }
  }
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const buildingMaterial = standard('#ffffff', 0.88, 0.03);
  const mesh = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, buildings.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < buildings.length; i += 1) {
    const b = buildings[i];
    dummy.position.set(b.x, b.h / 2, b.z);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, b.color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  const windowGeometry = new THREE.BoxGeometry(1, 1, 0.025);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: '#d1cba8', roughness: 0.3, metalness: 0.28, emissive: '#342e1e', emissiveIntensity: 0.14 });
  const panesPerBuilding = 8;
  const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, buildings.length * panesPerBuilding);
  let index = 0;
  for (const b of buildings) {
    const rows = Math.max(2, Math.floor(b.h / 5.2));
    const cols = 2;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (index >= windows.count) break;
        dummy.position.set(
          b.x - b.w * 0.24 + col * b.w * 0.48,
          2 + row * Math.min(4.3, (b.h - 3) / rows),
          b.z + b.d / 2 + 0.018,
        );
        dummy.scale.set(Math.max(0.75, b.w * 0.18), 1.55, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        windows.setMatrixAt(index, dummy.matrix);
        index += 1;
      }
    }
  }
  windows.count = index;
  windows.instanceMatrix.needsUpdate = true;
  parent.add(windows);
}

function addStreetFurniture(parent: THREE.Group): void {
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 5.4, 7);
  const poleMaterial = standard('#66746f', 0.47, 0.6);
  const points: Array<[number, number]> = [];
  for (const line of cityRoadCenters) {
    for (let n = -1; n <= 1; n += 1) {
      points.push([line - 16, n * 102]);
      points.push([line + 16, n * 102 + 22]);
      points.push([n * 102 - 18, line + 16]);
      points.push([n * 102 + 20, line - 16]);
    }
  }
  const polesMesh = new THREE.InstancedMesh(pole, poleMaterial, points.length);
  const lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.13, 0.72), standard('#d3d4b7', 0.48, 0.2), points.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < points.length; i += 1) {
    const [x, z] = points[i];
    dummy.position.set(x, 2.7, z);
    dummy.updateMatrix();
    polesMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x + (x < 0 ? 0.32 : -0.32), 5.44, z);
    dummy.rotation.y = Math.PI / 2;
    dummy.updateMatrix();
    lampHeads.setMatrixAt(i, dummy.matrix);
    dummy.rotation.y = 0;
  }
  polesMesh.instanceMatrix.needsUpdate = true;
  lampHeads.instanceMatrix.needsUpdate = true;
  polesMesh.castShadow = true;
  parent.add(polesMesh, lampHeads);
}

function createCityWorld(): WorldData {
  const root = new THREE.Group();
  const roadMaterial = standard('#303837', 0.94, 0.01);
  const sidewalkMaterial = standard('#a7a89a', 0.91, 0.02);
  for (const line of cityRoadCenters) {
    const roadX = new THREE.Mesh(new THREE.PlaneGeometry(390, 20), roadMaterial);
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.set(0, 0.012, line);
    roadX.receiveShadow = true;
    root.add(roadX);
    const roadZ = new THREE.Mesh(new THREE.PlaneGeometry(20, 390), roadMaterial);
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.set(line, 0.013, 0);
    roadZ.receiveShadow = true;
    root.add(roadZ);
    for (const side of [-1, 1]) {
      const curbX = new THREE.Mesh(new THREE.PlaneGeometry(390, 2.4), sidewalkMaterial);
      curbX.rotation.x = -Math.PI / 2;
      curbX.position.set(0, 0.019, line + side * 11.2);
      root.add(curbX);
      const curbZ = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 390), sidewalkMaterial);
      curbZ.rotation.x = -Math.PI / 2;
      curbZ.position.set(line + side * 11.2, 0.02, 0);
      root.add(curbZ);
    }
  }

  for (const line of cityRoadCenters) {
    for (const other of cityRoadCenters) {
      addDashMarks(root, true, line, other - 32, other + 32, 100, 0.028, '#e8e3cc');
    }
  }
  for (const line of cityRoadCenters) {
    for (let segment = -1; segment < cityRoadCenters.length - 1; segment += 1) {
      const start = segment < 0 ? -195 : cityRoadCenters[segment] + 14;
      const end = segment + 1 >= cityRoadCenters.length ? 195 : cityRoadCenters[segment + 1] - 14;
      if (end > start) {
        addDashMarks(root, true, line - 4.2, start, end, 13, 0.029, '#d8d7c7');
        addDashMarks(root, true, line + 4.2, start, end, 13, 0.029, '#d8d7c7');
        addDashMarks(root, false, line - 4.2, start, end, 13, 0.029, '#d8d7c7');
        addDashMarks(root, false, line + 4.2, start, end, 13, 0.029, '#d8d7c7');
      }
    }
  }

  const colliders: WorldCollider[] = [];
  addCityBuildings(root, colliders);
  addStreetFurniture(root);
  addCityTrees(root, colliders);
  addDistrictProps(root);
  return {
    root, colliders, spawn: new THREE.Vector3(-45, 0, 10), spawnYaw: 0, speedGates: [],
    bounds: { minX: -195, maxX: 195, minZ: -195, maxZ: 195 },
  };
}

function createHighwayWorld(): WorldData {
  const root = new THREE.Group();
  const roadPoints: THREE.Vector3[] = [];
  const radius = 76;
  const straight = 196;
  const steps = 84;
  roadPoints.push(new THREE.Vector3(-straight, 0, radius));
  roadPoints.push(new THREE.Vector3(straight, 0, radius));
  for (let i = 1; i <= steps; i += 1) {
    const theta = Math.PI / 2 - (Math.PI * i) / steps;
    roadPoints.push(new THREE.Vector3(straight + radius * Math.cos(theta), 0, radius * Math.sin(theta)));
  }
  roadPoints.push(new THREE.Vector3(-straight, 0, -radius));
  for (let i = 1; i <= steps; i += 1) {
    const theta = -Math.PI / 2 + (Math.PI * i) / steps;
    roadPoints.push(new THREE.Vector3(-straight - radius * Math.cos(theta), 0, radius * Math.sin(theta)));
  }
  const curve = new THREE.CatmullRomCurve3(roadPoints, true, 'centripetal', 0.4);
  const samples = curve.getPoints(500);
  const asphalt = standard('#333a39', 0.96, 0.01);
  addRoadRibbon(root, samples, 29, 0.014, asphalt);
  addRoadRibbon(root, samples, 0.42, 0.028, standard('#d8d6c3', 0.88, 0.01), 14.25);
  addRoadRibbon(root, samples, 0.42, 0.028, standard('#d8d6c3', 0.88, 0.01), -14.25);

  const dashGeometry = new THREE.BoxGeometry(5, 0.026, 0.25);
  const dashMaterial = standard('#f0e6c9', 0.75, 0.02);
  const dashCount = 100;
  const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount);
  const dummy = new THREE.Object3D();
  const dashPoints = curve.getPoints(dashCount);
  for (let i = 0; i < dashCount; i += 1) {
    const current = dashPoints[i];
    const next = dashPoints[(i + 1) % dashCount];
    const angle = Math.atan2(-(next.z - current.z), next.x - current.x);
    dummy.position.set(current.x, 0.031, current.z);
    dummy.rotation.y = angle;
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  }
  dashes.instanceMatrix.needsUpdate = true;
  root.add(dashes);

  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.8, 0.24), standard('#d7d2c1', 0.43, 0.48), 160);
  const postDummy = new THREE.Object3D();
  for (let i = 0; i < 160; i += 1) {
    const p = curve.getPoint(i / 160);
    const tangent = curve.getTangent(i / 160);
    const nx = tangent.z;
    const nz = -tangent.x;
    const side = i % 2 === 0 ? 1 : -1;
    postDummy.position.set(p.x + nx * 18 * side, 0.4, p.z + nz * 18 * side);
    postDummy.updateMatrix();
    posts.setMatrixAt(i, postDummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  root.add(posts);

  addHighwayScenery(root, curve);
  const speedGates = addSpeedGates(root, curve);
  return {
    root, colliders: [], spawn: new THREE.Vector3(-140, 0, radius + 8), spawnYaw: Math.PI / 2, speedGates,
    bounds: { minX: -380, maxX: 380, minZ: -260, maxZ: 260 },
  };
}

function addSpeedGates(parent: THREE.Group, curve: THREE.CatmullRomCurve3): SpeedGate[] {
  const material = new THREE.MeshStandardMaterial({
    color: '#49f0d0', emissive: '#16bfa2', emissiveIntensity: 1.4, metalness: 0.38, roughness: 0.25,
  });
  return [0.19, 0.69].map((t, index) => {
    const center = curve.getPointAt(t);
    const direction = curve.getTangentAt(t).setY(0).normalize();
    const frame = new THREE.Group();
    frame.position.copy(center);
    frame.rotation.y = Math.atan2(direction.x, direction.z);

    // Use only the upper half of the torus so it forms an arch over the road.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.38, 10, 72, Math.PI), material);
    ring.position.y = 0.4;
    ring.castShadow = true;
    frame.add(ring);

    const boardCanvas = document.createElement('canvas');
    boardCanvas.width = 512;
    boardCanvas.height = 96;
    const context = boardCanvas.getContext('2d');
    if (context) {
      context.fillStyle = '#132e2c';
      context.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
      context.strokeStyle = '#56f1d2';
      context.lineWidth = 5;
      context.strokeRect(3, 3, boardCanvas.width - 6, boardCanvas.height - 6);
      context.fillStyle = '#e8fff8';
      context.font = '700 38px Arial';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('200 KM/SA  ·  ₺5.000', boardCanvas.width / 2, boardCanvas.height / 2);
    }
    const labelTexture = new THREE.CanvasTexture(boardCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 1.35),
      new THREE.MeshBasicMaterial({ map: labelTexture, side: THREE.DoubleSide }),
    );
    label.position.set(0, 10.2, 0.08);
    frame.add(label);
    parent.add(frame);
    return { id: `highway-gate-${index + 1}`, center, direction, halfWidth: 8.5 };
  });
}

function addCityHighwayConnector(parent: THREE.Group): void {
  const roadStart = 135;
  const highwayJoin = 248;
  const length = highwayJoin - roadStart;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(length, 20), standard('#303837', 0.94, 0.01));
  road.rotation.x = -Math.PI / 2;
  road.position.set((roadStart + highwayJoin) / 2, 0.026, 0);
  road.receiveShadow = true;
  parent.add(road);

  for (const side of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(length, 0.025, 0.22), standard('#e7dfc5', 0.78, 0.02));
    edge.position.set((roadStart + highwayJoin) / 2, 0.044, side * 8.9);
    parent.add(edge);
  }
  addDashMarks(parent, true, 0, roadStart + 4, highwayJoin - 4, 12, 0.05, '#e8e3cc');
}

function addRoadRibbon(
  parent: THREE.Group,
  points: THREE.Vector3[],
  width: number,
  y: number,
  material: THREE.Material,
  sideOffset = 0,
): void {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const length = Math.hypot(tx, tz) || 1;
    tx /= length;
    tz /= length;
    const nx = -tz;
    const nz = tx;
    const centerX = points[i].x + nx * sideOffset;
    const centerZ = points[i].z + nz * sideOffset;
    const half = width / 2;
    positions.push(centerX + nx * half, y, centerZ + nz * half);
    positions.push(centerX - nx * half, y, centerZ - nz * half);
    const nextIndex = (i + 1) % points.length;
    const a = i * 2;
    const b = a + 1;
    const c = nextIndex * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function addCityTrees(parent: THREE.Group, colliders: WorldCollider[]): void {
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 2.5, 7), standard('#78634b', 0.95, 0.02), 48);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.15, 1), standard('#59705a', 0.93, 0.01), 48);
  const dummy = new THREE.Object3D();
  let index = 0;
  for (const road of cityRoadCenters) {
    for (const side of [-1, 1]) {
      for (const along of [-90, 0, 90]) {
        const points: Array<[number, number]> = [
          [road + side * 18, along],
          [along, road + side * 18],
        ];
        for (const [x, z] of points) {
          const isOnRoad = cityRoadCenters.some((center) => Math.abs(x - center) < 18 || Math.abs(z - center) < 18);
          const isOnConnector = x > 135 && x < 262 && Math.abs(z) < 18;
          const overlapsBuilding = colliders.some((collider) =>
            Math.abs(x - collider.x) < collider.halfX + 2 && Math.abs(z - collider.z) < collider.halfZ + 2,
          );
          if (isOnRoad || isOnConnector || overlapsBuilding || index >= trunks.count) continue;
          const scale = 0.8 + ((index * 13) % 5) * 0.09;
          dummy.position.set(x, 1.15, z);
          dummy.scale.set(1, scale, 1);
          dummy.updateMatrix();
          trunks.setMatrixAt(index, dummy.matrix);
          dummy.position.set(x, 3 + scale * 0.65, z);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          crowns.setMatrixAt(index, dummy.matrix);
          index += 1;
        }
      }
    }
  }
  trunks.count = index;
  crowns.count = index;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  crowns.castShadow = true;
  parent.add(trunks, crowns);
}

function addDistrictProps(parent: THREE.Group): void {
  const pavement = standard('#c4ba9f', 0.92, 0.02);
  for (let i = 0; i < 12; i += 1) {
    const x = -154 + i * 28;
    const marker = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.025, 0.12), pavement);
    marker.position.set(x, 0.03, 20);
    parent.add(marker);
  }
  const park = new THREE.Mesh(new THREE.BoxGeometry(48, 0.12, 48), standard('#72865c', 0.99, 0));
  park.position.set(-91, 0.02, 91);
  park.receiveShadow = true;
  parent.add(park);
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(44, 0.11, 44), standard('#aaa58f', 0.9, 0.02));
  plaza.position.set(90, 0.02, -91);
  plaza.receiveShadow = true;
  parent.add(plaza);
}

function addHighwayScenery(parent: THREE.Group, curve: THREE.CatmullRomCurve3): void {
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.6, 8, 7), standard('#536b54', 0.95, 0.01), 220);
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1.1, 0), standard('#827f6e', 0.98, 0), 75);
  const dummy = new THREE.Object3D();
  const tangent = new THREE.Vector3();
  for (let i = 0; i < trees.count; i += 1) {
    const t = ((i * 37) % 200) / 200;
    const p = curve.getPoint(t);
    curve.getTangent(t, tangent);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 35 + ((i * 19) % 70);
    const x = p.x + tangent.z * distance * side;
    const z = p.z - tangent.x * distance * side;
    const scale = 0.68 + ((i * 11) % 6) * 0.11;
    dummy.position.set(x, 3.5 * scale, z);
    dummy.scale.set(scale, scale, scale);
    dummy.rotation.y = (i * 0.7) % Math.PI;
    dummy.updateMatrix();
    trees.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < rocks.count; i += 1) {
    const t = ((i * 43) % 200) / 200;
    const p = curve.getPoint(t);
    curve.getTangent(t, tangent);
    const side = i % 2 === 0 ? 1 : -1;
    const distance = 23 + ((i * 13) % 26);
    dummy.position.set(p.x + tangent.z * distance * side, 0.5, p.z - tangent.x * distance * side);
    const size = 0.6 + ((i * 7) % 5) * 0.18;
    dummy.scale.set(size, size * 0.74, size * 1.4);
    dummy.rotation.set(0.1, i * 0.9, 0.2);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  trees.instanceMatrix.needsUpdate = true;
  rocks.instanceMatrix.needsUpdate = true;
  trees.castShadow = true;
  rocks.castShadow = true;
  parent.add(trees, rocks);

  const signs = new THREE.Group();
  const signData: Array<[number, number, string]> = [[-162, 106, 'HIZLI YOL'], [132, -107, 'OTOBAN 06']];
  for (const [x, z, label] of signData) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 8), standard('#7c887c', 0.5, 0.55));
    post.position.set(x, 3, z);
    signs.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(8, 2.2, 0.22), standard('#3f6d57', 0.55, 0.12));
    board.position.set(x, 5.6, z);
    signs.add(board);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.24), standard(label === 'HIZLI YOL' ? '#e1d7b0' : '#b7d9c0', 0.5, 0.1));
    stripe.position.set(x, 5.58, z + 0.13);
    signs.add(stripe);
  }
  parent.add(signs);
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function buildWorld(mapId: MapId, settings: GameSettings): WorldData {
  const worldScale = 1.2;
  const city = createCityWorld();
  const highway = createHighwayWorld();
  const root = new THREE.Group();
  const ground = flatPlane(1240, 620, '#78856f', -0.1);
  ground.position.x = 300;
  root.add(ground, city.root);
  highway.root.position.x = 520;
  root.add(highway.root);
  addCityHighwayConnector(root);

  const world: WorldData = {
    root,
    colliders: city.colliders.map((collider) => ({
      ...collider,
      x: collider.x * worldScale,
      z: collider.z * worldScale,
      halfX: collider.halfX * worldScale,
      halfZ: collider.halfZ * worldScale,
    })),
    spawn: city.spawn.clone().multiplyScalar(worldScale),
    spawnYaw: city.spawnYaw,
    speedGates: highway.speedGates.map((gate) => ({
      ...gate,
      center: gate.center.clone().add(highway.root.position).multiplyScalar(worldScale),
      halfWidth: gate.halfWidth * worldScale,
    })),
    bounds: {
      minX: -215 * worldScale,
      maxX: 905 * worldScale,
      minZ: -270 * worldScale,
      maxZ: 270 * worldScale,
    },
  };
  root.scale.setScalar(worldScale);
  world.root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) {
      const mesh = object as THREE.Mesh;
      mesh.castShadow = settings.shadows && settings.quality !== 'low';
    }
  });
  void mapId;
  return world;
}
