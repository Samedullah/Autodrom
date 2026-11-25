import * as THREE from 'three';
import type { GameSettings } from './save';
import { HeightGrid, WallGrid, forEachWorldTriangle } from './terrain';
import type { SpeedGate, WorldData } from './world';

// Purpose-built 3.2 km Grand Prix circuit ("Autodrom GP"):
// - 660 m main straight with start/finish gantry, 12-box starting grid & drivable pit lane
// - Heavy-braking Turn 1-2 complex, uphill Esses, 26.5 m Summit corner, downhill back straight,
//   stadium hairpin, and a 6.5° banked carousel sweeping back onto the main straight
// - Real 3D elevation & camber via HeightGrid, continuous Armco/tire barriers via WallGrid

const TRACK_HALF_WIDTH = 9.0;       // 18 m total asphalt width (~15 real metres at 1.2x scale)
const CURB_WIDTH = 1.65;
const VERGE_OUTER = 16.8;           // guardrail offset from centerline
const PIT_WINDOW_START = -295;      // pit entry diverge X on main straight
const PIT_WALL_START = -225;        // pit wall start X
const PIT_WALL_END = 175;           // pit wall end X
const PIT_WINDOW_END = 245;         // pit exit merge X
const MAIN_STRAIGHT_Z = -275;
const PIT_OUTER_OFFSET = 39.5;      // z = -275 + 39.5 = -235.5 (garage front wall)
const PIT_WALL_OFFSET = 16.5;       // z = -275 + 16.5 = -258.5
const HEIGHT_CELL = 1.5;
const WALL_CELL = 1.0;

interface TrackSample {
  x: number;
  y: number;
  z: number;
  s: number;
  tx: number;
  tz: number;
  rx: number;
  rz: number;
  kappa: number;
  tanBank: number;
  inPitWindow: boolean;
  rightBarrierOffset: number;
}

interface CachedTextures {
  asphalt: THREE.CanvasTexture;
  curb: THREE.CanvasTexture;
  checker: THREE.CanvasTexture;
}

let cachedTextures: CachedTextures | null = null;

function getTrackTextures(): CachedTextures {
  if (cachedTextures) return cachedTextures;

  // 1. Procedural multi-grain asphalt with darkened rubber racing groove & crisp white edge lines
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 512;
  asphaltCanvas.height = 512;
  const actx = asphaltCanvas.getContext('2d');
  if (actx) {
    actx.fillStyle = '#313639';
    actx.fillRect(0, 0, 512, 512);
    const img = actx.getImageData(0, 0, 512, 512);
    const data = img.data;
    let seed = 1337;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let py = 0; py < 512; py += 1) {
      for (let px = 0; px < 512; px += 1) {
        const u = px / 512;
        // Darker rubbered-in groove near centre-left/centre of the track
        const groove = Math.exp(-(((u - 0.48) / 0.22) ** 2)) * 10;
        const streak = Math.sin(u * Math.PI * 14) * 1.6;
        const grain = (rand() - 0.5) * 18;
        const base = 50 - groove + streak + grain;
        const idx = (py * 512 + px) * 4;
        data[idx] = Math.max(24, Math.min(82, base));
        data[idx + 1] = Math.max(27, Math.min(86, base + 3));
        data[idx + 2] = Math.max(29, Math.min(90, base + 5));
        data[idx + 3] = 255;
      }
    }
    actx.putImageData(img, 0, 0);
    // Crisp white track-limit lines
    actx.fillStyle = '#e7e4d5';
    actx.fillRect(14, 0, 10, 512);
    actx.fillRect(512 - 24, 0, 10, 512);
  }
  const asphalt = new THREE.CanvasTexture(asphaltCanvas);
  asphalt.wrapS = THREE.ClampToEdgeWrapping;
  asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.anisotropy = 8;
  asphalt.colorSpace = THREE.SRGBColorSpace;

  // 2. FIA red-and-white rumble kerb texture
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 64;
  curbCanvas.height = 256;
  const cctx = curbCanvas.getContext('2d');
  if (cctx) {
    cctx.fillStyle = '#ece9dd';
    cctx.fillRect(0, 0, 64, 128);
    cctx.fillStyle = '#c8322b';
    cctx.fillRect(0, 128, 64, 128);
    // Subtle dark serration groove between blocks
    cctx.fillStyle = 'rgba(20, 22, 24, 0.22)';
    cctx.fillRect(0, 124, 64, 5);
    cctx.fillRect(0, 252, 64, 4);
  }
  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.wrapS = THREE.ClampToEdgeWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = 4;
  curb.colorSpace = THREE.SRGBColorSpace;

  // 3. Start/Finish black-and-white checkerboard texture
  const checkerCanvas = document.createElement('canvas');
  checkerCanvas.width = 256;
  checkerCanvas.height = 64;
  const kctx = checkerCanvas.getContext('2d');
  if (kctx) {
    const cols = 16;
    const rows = 4;
    const cw = checkerCanvas.width / cols;
    const ch = checkerCanvas.height / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        kctx.fillStyle = (r + c) % 2 === 0 ? '#f2efe4' : '#1b1e20';
        kctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }
  }
  const checker = new THREE.CanvasTexture(checkerCanvas);
  checker.colorSpace = THREE.SRGBColorSpace;

  cachedTextures = { asphalt, curb, checker };
  return cachedTextures;
}

function surfaceY(sample: TrackSample, rightOffset: number): number {
  return sample.y - rightOffset * sample.tanBank;
}

function worldPoint(sample: TrackSample, rightOffset: number, yLift = 0, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(
    sample.x + sample.rx * rightOffset,
    surfaceY(sample, rightOffset) + yLift,
    sample.z + sample.rz * rightOffset,
  );
}

function buildTrackSamples(): TrackSample[] {
  const controlPoints = [
    // Main Start/Finish Straight: West -> East along z = -275, y = 0
    new THREE.Vector3(-330, 0.0, MAIN_STRAIGHT_Z),
    new THREE.Vector3(-210, 0.0, MAIN_STRAIGHT_Z),
    new THREE.Vector3(-70, 0.0, MAIN_STRAIGHT_Z),
    new THREE.Vector3(80, 0.0, MAIN_STRAIGHT_Z),
    new THREE.Vector3(220, 0.0, MAIN_STRAIGHT_Z),
    new THREE.Vector3(345, 0.0, MAIN_STRAIGHT_Z),
    // Turn 1: Heavy braking tightening right-hander
    new THREE.Vector3(445, 0.8, -258),
    new THREE.Vector3(492, 2.8, -195),
    new THREE.Vector3(462, 5.8, -122),
    // Turn 2: Uphill left-hander
    new THREE.Vector3(382, 9.5, -72),
    new THREE.Vector3(358, 13.8, 8),
    // Turn 3 & 4: High-speed Esses climbing the ridge
    new THREE.Vector3(418, 18.2, 88),
    new THREE.Vector3(488, 22.8, 168),
    // Turn 5-6: Summit double-apex right-hander (peak y = 26.5 m)
    new THREE.Vector3(478, 26.5, 262),
    new THREE.Vector3(388, 24.5, 325),
    // Back Straight: Fast downhill plunge East -> West
    new THREE.Vector3(240, 17.5, 330),
    new THREE.Vector3(50, 9.0, 318),
    new THREE.Vector3(-150, 3.2, 304),
    new THREE.Vector3(-350, 1.5, 290),
    // Turn 7: West Stadium Hairpin (right-hander)
    new THREE.Vector3(-465, 2.6, 252),
    new THREE.Vector3(-502, 4.8, 172),
    new THREE.Vector3(-438, 6.8, 98),
    // Turn 8: Stadium technical left
    new THREE.Vector3(-348, 7.2, 50),
    new THREE.Vector3(-342, 5.6, -32),
    // Turn 9-10: Banked sweeping carousel onto Main Straight
    new THREE.Vector3(-432, 3.8, -98),
    new THREE.Vector3(-495, 2.5, -178),
    new THREE.Vector3(-460, 1.4, -250),
    new THREE.Vector3(-400, 0.3, MAIN_STRAIGHT_Z),
  ];

  const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal', 0.5);
  const count = 1600;
  const raw = curve.getSpacedPoints(count);
  raw.pop();

  // Keep the entire pit/grid zone dead-straight and dead-level at z = -275, y = 0.
  for (let i = 0; i < count; i += 1) {
    const p = raw[i];
    if (p.z < -250 && p.x > -345 && p.x < 305) {
      const tIn = THREE.MathUtils.smoothstep(p.x, -345, -298);
      const tOut = 1 - THREE.MathUtils.smoothstep(p.x, 248, 305);
      const flat = tIn * tOut;
      p.z = THREE.MathUtils.lerp(p.z, MAIN_STRAIGHT_Z, flat);
      p.y = THREE.MathUtils.lerp(p.y, 0, flat);
    }
  }

  const rawKappa = new Float32Array(count);
  const tangentsX = new Float32Array(count);
  const tangentsZ = new Float32Array(count);
  const arcS = new Float32Array(count);
  let cumulativeS = 0;

  for (let i = 0; i < count; i += 1) {
    const prev = raw[(i - 1 + count) % count];
    const curr = raw[i];
    const next = raw[(i + 1) % count];
    arcS[i] = cumulativeS;
    cumulativeS += Math.hypot(next.x - curr.x, next.z - curr.z);

    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    tangentsX[i] = tx;
    tangentsZ[i] = tz;

    const v1x = curr.x - prev.x;
    const v1z = curr.z - prev.z;
    const v2x = next.x - curr.x;
    const v2z = next.z - curr.z;
    const d1 = Math.hypot(v1x, v1z) || 1;
    const d2 = Math.hypot(v2x, v2z) || 1;
    const cross = (v1x * v2z - v1z * v2x) / (d1 * d2);
    rawKappa[i] = cross / (0.5 * (d1 + d2));
  }

  // Smooth curvature so corner camber rolls in and out progressively.
  const smoothKappa = new Float32Array(count);
  const window = 18;
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    for (let k = -window; k <= window; k += 1) {
      sum += rawKappa[(i + k + count) % count];
    }
    smoothKappa[i] = sum / (window * 2 + 1);
  }

  const samples: TrackSample[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = raw[i];
    const tx = tangentsX[i];
    const tz = tangentsZ[i];
    // Driver-right horizontal unit vector when moving along (tx, tz).
    const rx = -tz;
    const rz = tx;
    const kappa = smoothKappa[i];

    // Signature banked carousel in Turn 9-10 (west-northwest sector) leans up to ~6.5°.
    const inCarousel = p.x < -335 && p.z < -40
      ? THREE.MathUtils.smoothstep(-p.x, 335, 415) * (1 - THREE.MathUtils.smoothstep(p.z, -80, -30))
      : 0;
    const maxTan = THREE.MathUtils.lerp(0.055, 0.114, inCarousel);
    const scale = THREE.MathUtils.lerp(2.1, 4.6, inCarousel);
    let tanBank = THREE.MathUtils.clamp(kappa * scale, -maxTan, maxTan);

    // Keep the main straight & pit entry/exit completely unbanked.
    if (p.z < -255 && p.x > -340 && p.x < 295) {
      const tIn = THREE.MathUtils.smoothstep(p.x, -340, -298);
      const tOut = 1 - THREE.MathUtils.smoothstep(p.x, 248, 295);
      tanBank *= 1 - tIn * tOut;
    }

    // Ensure banked inner shoulders never dip below y = 0.
    const y = Math.max(p.y, Math.abs(tanBank) * (VERGE_OUTER + 1));

    // Smoothly bow the outer right-side barrier around the pit lane & garages on the main straight.
    let inPitWindow = false;
    let rightBarrierOffset = VERGE_OUTER;
    if (p.z < -265 && p.x >= PIT_WINDOW_START && p.x <= PIT_WINDOW_END) {
      inPitWindow = true;
      const bowIn = THREE.MathUtils.smoothstep(p.x, PIT_WINDOW_START, PIT_WALL_START - 8);
      const bowOut = 1 - THREE.MathUtils.smoothstep(p.x, PIT_WALL_END + 8, PIT_WINDOW_END);
      rightBarrierOffset = THREE.MathUtils.lerp(VERGE_OUTER, PIT_OUTER_OFFSET, bowIn * bowOut);
    }

    samples.push({
      x: p.x,
      y,
      z: p.z,
      s: arcS[i],
      tx,
      tz,
      rx,
      rz,
      kappa,
      tanBank,
      inPitWindow,
      rightBarrierOffset,
    });
  }

  return samples;
}

function standard(color: string, roughness = 0.85, metalness = 0.04): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function buildMainTrackAsphalt(samples: TrackSample[], texture: THREE.CanvasTexture): THREE.Mesh {
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];
  const totalLength = samples[n - 1].s + Math.hypot(samples[0].x - samples[n - 1].x, samples[0].z - samples[n - 1].z);

  const tmp = new THREE.Vector3();
  for (let i = 0; i <= n; i += 1) {
    const sample = samples[i % n];
    const s = i === n ? totalLength : sample.s;
    const vCoord = s / 18;

    worldPoint(sample, -TRACK_HALF_WIDTH, 0, tmp);
    positions[i * 6] = tmp.x;
    positions[i * 6 + 1] = tmp.y;
    positions[i * 6 + 2] = tmp.z;
    uvs[i * 4] = 0;
    uvs[i * 4 + 1] = vCoord;

    worldPoint(sample, TRACK_HALF_WIDTH, 0, tmp);
    positions[i * 6 + 3] = tmp.x;
    positions[i * 6 + 4] = tmp.y;
    positions[i * 6 + 5] = tmp.z;
    uvs[i * 4 + 2] = 1;
    uvs[i * 4 + 3] = vCoord;

    if (i < n) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: '#ffffff',
    roughness: 0.88,
    metalness: 0.03,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'autodrom-asphalt';
  mesh.receiveShadow = true;
  mesh.userData.castsShadow = false;
  return mesh;
}

function buildCurbs(samples: TrackSample[], curbTexture: THREE.CanvasTexture): THREE.Mesh {
  const n = samples.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Vector3();

  // Determine where inside apex kerbs and outside exit kerbs belong.
  const hasCurb = (idx: number, side: -1 | 1): boolean => {
    const s = samples[idx];
    // Never place a right-side kerb across the pit entry / exit merges.
    if (side === 1 && s.inPitWindow) return false;
    const k = s.kappa;
    // Inside apex kerb: right side for right turns (k > 0), left side for left turns (k < 0).
    if (side === 1 && k > 0.0042) return true;
    if (side === -1 && k < -0.0042) return true;
    // Outside exit kerb: check slightly upstream (up to ~48 m back along the lap) for a strong corner.
    for (let back = 4; back <= 24; back += 4) {
      const prev = samples[(idx - back + n) % n];
      if (side === -1 && prev.kappa > 0.0055) return true;
      if (side === 1 && prev.kappa < -0.0055) return true;
    }
    return false;
  };

  for (const side of [-1, 1] as const) {
    const innerOff = side * TRACK_HALF_WIDTH;
    const midOff = side * (TRACK_HALF_WIDTH + CURB_WIDTH * 0.35);
    const outerOff = side * (TRACK_HALF_WIDTH + CURB_WIDTH);

    let runStart = -1;
    for (let i = 0; i <= n; i += 1) {
      const active = i < n && hasCurb(i, side);
      if (active && runStart < 0) {
        runStart = i;
      } else if (!active && runStart >= 0) {
        const len = i - runStart;
        if (len >= 5) {
          const baseVertex = positions.length / 3;
          for (let j = runStart; j <= i; j += 1) {
            const sample = samples[j % n];
            const fade = Math.min(1, (j - runStart) / 3, (i - j) / 3);
            const ridge = 0.045 * fade;
            const v = sample.s / 4.4;

            worldPoint(sample, innerOff, 0.004, tmp);
            positions.push(tmp.x, tmp.y, tmp.z);
            uvs.push(0, v);

            worldPoint(sample, midOff, ridge, tmp);
            positions.push(tmp.x, tmp.y, tmp.z);
            uvs.push(0.4, v);

            worldPoint(sample, outerOff, 0.004, tmp);
            positions.push(tmp.x, tmp.y, tmp.z);
            uvs.push(1, v);
          }
          const rows = i - runStart;
          for (let r = 0; r < rows; r += 1) {
            const r0 = baseVertex + r * 3;
            const r1 = r0 + 3;
            if (side === 1) {
              indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
              indices.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
            } else {
              indices.push(r0 + 1, r0, r1 + 1, r0, r1, r1 + 1);
              indices.push(r0 + 2, r0 + 1, r1 + 2, r0 + 1, r1 + 1, r1 + 2);
            }
          }
        }
        runStart = -1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: curbTexture,
    roughness: 0.78,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'autodrom-curbs';
  mesh.receiveShadow = true;
  mesh.userData.castsShadow = false;
  return mesh;
}

function buildVergesAndRunoffs(samples: TrackSample[]): { leftVerge: THREE.Mesh; rightVerge: THREE.Mesh } {
  const n = samples.length;
  const grassColor = new THREE.Color('#5a704c');
  const gravelColor = new THREE.Color('#bfa578');
  const apronColor = new THREE.Color('#474d4f');
  const tmp = new THREE.Vector3();
  const cTmp = new THREE.Color();

  const makeSide = (side: -1 | 1): THREE.Mesh => {
    const positions = new Float32Array((n + 1) * 2 * 3);
    const colors = new Float32Array((n + 1) * 2 * 3);
    const indices: number[] = [];

    for (let i = 0; i <= n; i += 1) {
      const idx = i % n;
      const sample = samples[idx];
      const innerOff = side * TRACK_HALF_WIDTH;
      const outerOff = side === 1 ? sample.rightBarrierOffset : -VERGE_OUTER;

      // Gravel trap on the outside of medium/hard corners
      let gravelShare = 0;
      for (let look = -8; look <= 14; look += 4) {
        const near = samples[(idx + look + n) % n];
        if (side === -1 && near.kappa > 0.0065) {
          gravelShare = Math.max(gravelShare, THREE.MathUtils.smoothstep(near.kappa, 0.0065, 0.012));
        } else if (side === 1 && near.kappa < -0.0065) {
          gravelShare = Math.max(gravelShare, THREE.MathUtils.smoothstep(-near.kappa, 0.0065, 0.012));
        }
      }

      if (side === 1 && sample.inPitWindow) {
        cTmp.copy(apronColor);
      } else {
        cTmp.copy(grassColor).lerp(gravelColor, gravelShare);
      }

      worldPoint(sample, innerOff, -0.012, tmp);
      positions[i * 6] = tmp.x;
      positions[i * 6 + 1] = tmp.y;
      positions[i * 6 + 2] = tmp.z;

      worldPoint(sample, outerOff, -0.02, tmp);
      positions[i * 6 + 3] = tmp.x;
      positions[i * 6 + 4] = tmp.y;
      positions[i * 6 + 5] = tmp.z;

      for (const base of [i * 6, i * 6 + 3]) {
        colors[base] = cTmp.r;
        colors[base + 1] = cTmp.g;
        colors[base + 2] = cTmp.b;
      }

      if (i < n) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        if (side === 1) {
          indices.push(a, b, c, b, d, c);
        } else {
          indices.push(b, a, d, a, c, d);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.01,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.userData.castsShadow = false;
    return mesh;
  };

  return { leftVerge: makeSide(-1), rightVerge: makeSide(1) };
}

function sampleLandscapeHeight(refs: TrackSample[], x: number, z: number): { y: number; minClearance: number } {
  let bestDistSq = Infinity;
  let nearest = refs[0];
  for (let k = 0; k < refs.length; k += 1) {
    const s = refs[k];
    const dx = x - s.x;
    const dz = z - s.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      nearest = s;
    }
  }
  const dist = Math.sqrt(bestDistSq);
  const signedRight = (x - nearest.x) * nearest.rx + (z - nearest.z) * nearest.rz;
  const corridorHalf = signedRight >= 0 ? nearest.rightBarrierOffset : VERGE_OUTER;
  const clearance = Math.max(0, dist - corridorHalf);

  const edgeOffset = THREE.MathUtils.clamp(signedRight, -VERGE_OUTER, nearest.rightBarrierOffset);
  const baseTrackY = surfaceY(nearest, edgeOffset) - 0.32;
  const hillWave =
    Math.sin(x * 0.0065 + 0.7) * Math.cos(z * 0.0075 - 0.4) * 14 +
    Math.sin(x * 0.014 - z * 0.011) * 5.5 +
    9;
  const rimFactor = THREE.MathUtils.smoothstep(Math.max(Math.abs(x) / 620, Math.abs(z) / 440), 0.72, 1.05);
  const outerRise = hillWave + rimFactor * 26;
  const blend = THREE.MathUtils.smoothstep(clearance, 4, 95);
  return {
    y: baseTrackY + outerRise * blend,
    minClearance: dist - corridorHalf,
  };
}

function buildLandscape(refs: TrackSample[]): THREE.Mesh {
  const minX = -740;
  const maxX = 720;
  const minZ = -520;
  const maxZ = 540;
  const step = 18;
  const cols = Math.floor((maxX - minX) / step) + 1;
  const rows = Math.floor((maxZ - minZ) / step) + 1;

  const positions = new Float32Array(cols * rows * 3);
  const colors = new Float32Array(cols * rows * 3);
  const lowGrass = new THREE.Color('#516646');
  const midGrass = new THREE.Color('#667953');
  const ridgeRock = new THREE.Color('#84826f');
  const cTmp = new THREE.Color();

  for (let r = 0; r < rows; r += 1) {
    const z = minZ + r * step;
    for (let c = 0; c < cols; c += 1) {
      const x = minX + c * step;
      const { y } = sampleLandscapeHeight(refs, x, z);

      const idx = (r * cols + c) * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      const hShare = THREE.MathUtils.clamp(y / 38, 0, 1);
      cTmp.copy(lowGrass).lerp(midGrass, Math.min(1, hShare * 1.4)).lerp(ridgeRock, Math.max(0, (hShare - 0.58) * 1.7));
      colors[idx] = cTmp.r;
      colors[idx + 1] = cTmp.g;
      colors[idx + 2] = cTmp.b;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 }),
  );
  mesh.name = 'autodrom-landscape';
  mesh.receiveShadow = true;
  mesh.userData.castsShadow = false;
  return mesh;
}

function markWallLine(
  wallGrid: WallGrid,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  groundAt: (x: number, z: number) => number,
): void {
  // Construct two vertical triangles along (x0,z0)-(x1,z1) so WallGrid marks every cell along the barrier.
  const a = new THREE.Vector3(x0, groundAt(x0, z0), z0);
  const b = new THREE.Vector3(x1, groundAt(x1, z1), z1);
  const c = new THREE.Vector3(x1, groundAt(x1, z1) + 1.1, z1);
  const d = new THREE.Vector3(x0, groundAt(x0, z0) + 1.1, z0);
  wallGrid.addWallTriangle(a, b, c, groundAt, 1.5);
  wallGrid.addWallTriangle(a, c, d, groundAt, 1.5);
}

function buildGuardrailsAndTireWalls(
  parent: THREE.Group,
  samples: TrackSample[],
  wallGrid: WallGrid,
  groundAt: (x: number, z: number) => number,
): void {
  const n = samples.length;
  const railMaterial = standard('#bfc6c9', 0.42, 0.65);
  const postMaterial = standard('#6f777a', 0.55, 0.55);

  const tmp = new THREE.Vector3();
  const buildRailStrip = (side: -1 | 1): void => {
    const positions = new Float32Array((n + 1) * 4 * 3);
    const indices: number[] = [];

    for (let i = 0; i <= n; i += 1) {
      const sample = samples[i % n];
      const off = side === 1 ? sample.rightBarrierOffset : -VERGE_OUTER;
      const inward = off - side * 0.14;

      // Front face (facing the track) + top cap of the double-wave Armco rail
      worldPoint(sample, inward, 0.22, tmp);
      const base = i * 12;
      positions[base] = tmp.x;
      positions[base + 1] = tmp.y;
      positions[base + 2] = tmp.z;

      worldPoint(sample, inward, 1.02, tmp);
      positions[base + 3] = tmp.x;
      positions[base + 4] = tmp.y;
      positions[base + 5] = tmp.z;

      worldPoint(sample, off, 1.02, tmp);
      positions[base + 6] = tmp.x;
      positions[base + 7] = tmp.y;
      positions[base + 8] = tmp.z;

      worldPoint(sample, off, 0.22, tmp);
      positions[base + 9] = tmp.x;
      positions[base + 10] = tmp.y;
      positions[base + 11] = tmp.z;

      if (i < n) {
        const next = samples[(i + 1) % n];
        const nextOff = side === 1 ? next.rightBarrierOffset : -VERGE_OUTER;
        const x0 = sample.x + sample.rx * inward;
        const z0 = sample.z + sample.rz * inward;
        const x1 = next.x + next.rx * (nextOff - side * 0.14);
        const z1 = next.z + next.rz * (nextOff - side * 0.14);
        markWallLine(wallGrid, x0, z0, x1, z1, groundAt);

        const r0 = i * 4;
        const r1 = (i + 1) * 4;
        if (side === 1) {
          indices.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
          indices.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
          indices.push(r0 + 2, r1 + 2, r0 + 3, r0 + 3, r1 + 2, r1 + 3);
        } else {
          indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
          indices.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
          indices.push(r0 + 2, r0 + 3, r1 + 2, r0 + 3, r1 + 3, r1 + 2);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, railMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.castsShadow = true;
    parent.add(mesh);
  };

  buildRailStrip(-1);
  buildRailStrip(1);

  // Guardrail steel posts every ~6 m
  const postStep = 3;
  const postCount = Math.floor(n / postStep) * 2;
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 1.08, 0.16), postMaterial, postCount);
  const dummy = new THREE.Object3D();
  let pIdx = 0;
  for (let i = 0; i < n; i += postStep) {
    const s = samples[i];
    const yaw = Math.atan2(s.tx, s.tz);
    for (const side of [-1, 1] as const) {
      if (pIdx >= postCount) break;
      const off = side === 1 ? s.rightBarrierOffset : -VERGE_OUTER;
      worldPoint(s, off, 0.54, dummy.position);
      dummy.rotation.set(0, yaw, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(pIdx, dummy.matrix);
      pIdx += 1;
    }
  }
  posts.count = pIdx;
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  posts.userData.castsShadow = true;
  parent.add(posts);

  // Red & white FIA tire stacks lining the outside barrier of heavy corners
  const tirePositions: Array<{ x: number; y: number; z: number; red: boolean }> = [];
  for (let i = 0; i < n; i += 2) {
    const s = samples[i];
    for (const side of [-1, 1] as const) {
      if (side === 1 && s.inPitWindow) continue;
      const outside = (side === -1 && s.kappa > 0.0072) || (side === 1 && s.kappa < -0.0072);
      if (!outside) continue;
      const off = side * (VERGE_OUTER - 0.72);
      worldPoint(s, off, 0, tmp);
      tirePositions.push({
        x: tmp.x,
        y: tmp.y,
        z: tmp.z,
        red: Math.floor(i / 6) % 2 === 0,
      });
    }
  }

  if (tirePositions.length > 0) {
    const tireGeom = new THREE.CylinderGeometry(0.52, 0.52, 0.96, 10);
    const tireMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.86, metalness: 0.02 });
    const tires = new THREE.InstancedMesh(tireGeom, tireMat, tirePositions.length);
    const redCol = new THREE.Color('#c9322b');
    const whiteCol = new THREE.Color('#edeae0');
    for (let i = 0; i < tirePositions.length; i += 1) {
      const tp = tirePositions[i];
      dummy.position.set(tp.x, tp.y + 0.48, tp.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tires.setMatrixAt(i, dummy.matrix);
      tires.setColorAt(i, tp.red ? redCol : whiteCol);
    }
    tires.instanceMatrix.needsUpdate = true;
    if (tires.instanceColor) tires.instanceColor.needsUpdate = true;
    tires.castShadow = true;
    tires.receiveShadow = true;
    tires.userData.castsShadow = true;
    parent.add(tires);
  }
}

function buildPitComplexAndGrid(
  parent: THREE.Group,
  checkerTexture: THREE.CanvasTexture,
  wallGrid: WallGrid,
  groundAt: (x: number, z: number) => number,
): THREE.Mesh {
  const group = new THREE.Group();
  group.name = 'autodrom-pit-complex';

  // 1. Drivable Pit Lane Asphalt Ribbon (Pit Entry -> Pit Lane -> Pit Exit)
  const pitZ = MAIN_STRAIGHT_Z + 26.0; // z = -249
  const pitCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(PIT_WINDOW_START - 8, 0.012, MAIN_STRAIGHT_Z + 5.5),
    new THREE.Vector3(PIT_WALL_START - 22, 0.012, MAIN_STRAIGHT_Z + 17.5),
    new THREE.Vector3(PIT_WALL_START + 8, 0.012, pitZ),
    new THREE.Vector3(0, 0.012, pitZ),
    new THREE.Vector3(PIT_WALL_END - 8, 0.012, pitZ),
    new THREE.Vector3(PIT_WALL_END + 22, 0.012, MAIN_STRAIGHT_Z + 17.5),
    new THREE.Vector3(PIT_WINDOW_END + 8, 0.012, MAIN_STRAIGHT_Z + 5.5),
  ], false, 'centripetal', 0.5);

  const pitPoints = pitCurve.getSpacedPoints(120);
  const pitHalfWidth = 5.4;
  const pitPos: number[] = [];
  const pitIdx: number[] = [];
  for (let i = 0; i < pitPoints.length; i += 1) {
    const curr = pitPoints[i];
    const prev = pitPoints[Math.max(0, i - 1)];
    const next = pitPoints[Math.min(pitPoints.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const rx = -tz;
    const rz = tx;
    pitPos.push(curr.x - rx * pitHalfWidth, 0.014, curr.z - rz * pitHalfWidth);
    pitPos.push(curr.x + rx * pitHalfWidth, 0.014, curr.z + rz * pitHalfWidth);
    if (i < pitPoints.length - 1) {
      const a = i * 2;
      pitIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const pitGeom = new THREE.BufferGeometry();
  pitGeom.setAttribute('position', new THREE.Float32BufferAttribute(pitPos, 3));
  pitGeom.setIndex(pitIdx);
  pitGeom.computeVertexNormals();
  const pitAsphaltMesh = new THREE.Mesh(pitGeom, standard('#2b3032', 0.9, 0.02));
  pitAsphaltMesh.receiveShadow = true;
  pitAsphaltMesh.userData.castsShadow = false;
  group.add(pitAsphaltMesh);

  // Pit speed-limit lines & pit box markings
  const lineMat = new THREE.MeshStandardMaterial({
    color: '#e8e4d3',
    roughness: 0.78,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const pitLaneLength = PIT_WALL_END - PIT_WALL_START;
  for (const zOff of [-pitHalfWidth + 0.35, pitHalfWidth - 0.35]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(pitLaneLength, 0.25), lineMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set((PIT_WALL_START + PIT_WALL_END) / 2, 0.02, pitZ + zOff);
    strip.userData.castsShadow = false;
    group.add(strip);
  }

  // 2. Concrete Pit Wall separating Main Straight and Pit Lane
  const pitWallZ = MAIN_STRAIGHT_Z + PIT_WALL_OFFSET;
  const pitWallLen = PIT_WALL_END - PIT_WALL_START;
  const pitWallCenterX = (PIT_WALL_START + PIT_WALL_END) / 2;
  const pitWall = new THREE.Mesh(
    new THREE.BoxGeometry(pitWallLen, 1.18, 0.72),
    standard('#d9ddd8', 0.72, 0.08),
  );
  pitWall.position.set(pitWallCenterX, 0.59, pitWallZ);
  pitWall.castShadow = true;
  pitWall.receiveShadow = true;
  pitWall.userData.castsShadow = true;
  group.add(pitWall);

  const wallStripe = new THREE.Mesh(
    new THREE.BoxGeometry(pitWallLen + 0.04, 0.28, 0.76),
    standard('#1d8f7d', 0.55, 0.15),
  );
  wallStripe.position.set(pitWallCenterX, 0.88, pitWallZ);
  wallStripe.userData.castsShadow = false;
  group.add(wallStripe);

  // Bright yellow/black impact attenuator nose at pit wall entry
  const nose = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.48, 1.15, 12),
    standard('#e6b938', 0.55, 0.12),
  );
  nose.position.set(PIT_WALL_START - 0.3, 0.58, pitWallZ);
  nose.castShadow = true;
  nose.userData.castsShadow = true;
  group.add(nose);

  // Register Pit Wall in WallGrid (both faces so it blocks from track and pit side)
  markWallLine(wallGrid, PIT_WALL_START - 0.6, pitWallZ - 0.35, PIT_WALL_END + 0.4, pitWallZ - 0.35, groundAt);
  markWallLine(wallGrid, PIT_WALL_START - 0.6, pitWallZ + 0.35, PIT_WALL_END + 0.4, pitWallZ + 0.35, groundAt);

  // 3. Pit Garages Building (12 bays + VIP Hospitality Terrace + Race Control Tower)
  const garageCount = 12;
  const bayWidth = 26;
  const buildingLen = garageCount * bayWidth; // 312 m
  const buildingCenterX = -25;
  const buildingFrontZ = MAIN_STRAIGHT_Z + PIT_OUTER_OFFSET + 0.2; // z = -235.3
  const buildingDepth = 18;
  const buildingCenterZ = buildingFrontZ + buildingDepth / 2;

  const mainStructure = new THREE.Mesh(
    new THREE.BoxGeometry(buildingLen, 9.6, buildingDepth),
    standard('#cfd4d0', 0.78, 0.08),
  );
  mainStructure.position.set(buildingCenterX, 4.8, buildingCenterZ);
  mainStructure.castShadow = true;
  mainStructure.receiveShadow = true;
  mainStructure.userData.castsShadow = true;
  group.add(mainStructure);

  // Upper VIP glass lounge strip facing the track
  const vipGlass = new THREE.Mesh(
    new THREE.BoxGeometry(buildingLen - 6, 2.9, 0.18),
    new THREE.MeshStandardMaterial({
      color: '#5a7e8a',
      roughness: 0.2,
      metalness: 0.55,
      emissive: '#2c3d35',
      emissiveIntensity: 0.35,
    }),
  );
  vipGlass.position.set(buildingCenterX, 7.1, buildingFrontZ - 0.05);
  vipGlass.userData.castsShadow = false;
  group.add(vipGlass);

  // Overhanging upper roof visor
  const roofVisor = new THREE.Mesh(
    new THREE.BoxGeometry(buildingLen + 4, 0.55, buildingDepth + 4.5),
    standard('#2b3336', 0.55, 0.32),
  );
  roofVisor.position.set(buildingCenterX, 9.85, buildingCenterZ - 1.6);
  roofVisor.castShadow = true;
  roofVisor.userData.castsShadow = true;
  group.add(roofVisor);

  // 12 recessed dark garage bays + colored team fascias + pit stop box markings
  const bayInteriorGeom = new THREE.BoxGeometry(bayWidth - 3.2, 4.2, 0.25);
  const bayInteriorMat = standard('#1a1f22', 0.92, 0.05);
  const bayHeaderGeom = new THREE.BoxGeometry(bayWidth - 1.4, 0.68, 0.32);
  const teamPalette = ['#c8372d', '#2b7bbb', '#1d9a78', '#e09f2d', '#8856b8', '#d65c38'];
  const pitBoxMarkMat = new THREE.MeshStandardMaterial({
    color: '#d9483b',
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  for (let i = 0; i < garageCount; i += 1) {
    const bx = buildingCenterX - buildingLen / 2 + (i + 0.5) * bayWidth;
    const bay = new THREE.Mesh(bayInteriorGeom, bayInteriorMat);
    bay.position.set(bx, 2.1, buildingFrontZ - 0.04);
    bay.userData.castsShadow = false;
    group.add(bay);

    const header = new THREE.Mesh(bayHeaderGeom, standard(teamPalette[i % teamPalette.length], 0.52, 0.16));
    header.position.set(bx, 4.65, buildingFrontZ - 0.08);
    header.userData.castsShadow = false;
    group.add(header);

    const pitBox = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 4.2), pitBoxMarkMat);
    pitBox.rotation.x = -Math.PI / 2;
    pitBox.position.set(bx, 0.019, buildingFrontZ - 4.2);
    pitBox.userData.castsShadow = false;
    group.add(pitBox);
  }

  // Sculpted Race Control Tower at x = -40 (aligned with Start/Finish line)
  const towerX = -40;
  const towerShaft = new THREE.Mesh(
    new THREE.BoxGeometry(11, 24, 11),
    standard('#2d3639', 0.58, 0.28),
  );
  towerShaft.position.set(towerX, 12, buildingCenterZ - 1);
  towerShaft.castShadow = true;
  towerShaft.receiveShadow = true;
  towerShaft.userData.castsShadow = true;
  group.add(towerShaft);

  const towerPod = new THREE.Mesh(
    new THREE.BoxGeometry(17, 5.2, 15),
    standard('#dfe3de', 0.62, 0.14),
  );
  towerPod.position.set(towerX, 23.5, buildingCenterZ - 2.5);
  towerPod.castShadow = true;
  towerPod.userData.castsShadow = true;
  group.add(towerPod);

  const towerGlass = new THREE.Mesh(
    new THREE.BoxGeometry(16.2, 2.8, 14.4),
    new THREE.MeshStandardMaterial({
      color: '#6397a6',
      roughness: 0.18,
      metalness: 0.6,
      emissive: '#284548',
      emissiveIntensity: 0.45,
    }),
  );
  towerGlass.position.set(towerX, 23.6, buildingCenterZ - 2.8);
  towerGlass.userData.castsShadow = false;
  group.add(towerGlass);

  // 4. Start/Finish Checkerboard Line, Starting Grid Slots & Overhead Gantry (x = -40)
  const startX = -40;
  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, TRACK_HALF_WIDTH * 2 - 1.0),
    new THREE.MeshStandardMaterial({
      map: checkerTexture,
      roughness: 0.76,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.position.set(startX, 0.018, MAIN_STRAIGHT_Z);
  startLine.receiveShadow = true;
  startLine.userData.castsShadow = false;
  group.add(startLine);

  // 12 staggered starting grid brackets behind x = -40
  for (let slot = 0; slot < 12; slot += 1) {
    const gx = startX - 14 - slot * 10.5;
    const gz = MAIN_STRAIGHT_Z + (slot % 2 === 0 ? -3.6 : 3.6);
    const frontBar = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 3.0), lineMat);
    frontBar.rotation.x = -Math.PI / 2;
    frontBar.position.set(gx + 2.4, 0.017, gz);
    frontBar.userData.castsShadow = false;
    group.add(frontBar);
    for (const s of [-1.4, 1.4]) {
      const sideBar = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.24), lineMat);
      sideBar.rotation.x = -Math.PI / 2;
      sideBar.position.set(gx + 1.2, 0.017, gz + s);
      sideBar.userData.castsShadow = false;
      group.add(sideBar);
    }
  }

  // Overhead Start/Finish Gantry spanning z = -292.5 .. -258.5 at x = -40
  const gantrySpan = 34;
  const gantryZCenter = MAIN_STRAIGHT_Z - 0.5;
  const trussMat = standard('#2a3134', 0.45, 0.62);
  for (const zLeg of [gantryZCenter - gantrySpan / 2, gantryZCenter + gantrySpan / 2]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.46, 9.6, 10), trussMat);
    pillar.position.set(startX, 4.8, zLeg);
    pillar.castShadow = true;
    pillar.userData.castsShadow = true;
    group.add(pillar);
  }
  const crossBeam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.35, gantrySpan + 1.2), trussMat);
  crossBeam.position.set(startX, 9.4, gantryZCenter);
  crossBeam.castShadow = true;
  crossBeam.userData.castsShadow = true;
  group.add(crossBeam);

  // AUTODROM GP banner board on the gantry
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 1024;
  bannerCanvas.height = 160;
  const bctx = bannerCanvas.getContext('2d');
  if (bctx) {
    bctx.fillStyle = '#142321';
    bctx.fillRect(0, 0, 1024, 160);
    bctx.fillStyle = '#49f0d0';
    bctx.fillRect(0, 0, 1024, 10);
    bctx.fillRect(0, 150, 1024, 10);
    bctx.fillStyle = '#f2f7f2';
    bctx.font = '800 58px Arial';
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';
    bctx.fillText('AUTODROM  GRAND  PRIX', 512, 82);
  }
  const bannerTex = new THREE.CanvasTexture(bannerCanvas);
  bannerTex.colorSpace = THREE.SRGBColorSpace;
  const bannerMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 2.3, 19.5),
    new THREE.MeshBasicMaterial({ map: bannerTex }),
  );
  bannerMesh.position.set(startX - 0.72, 9.45, MAIN_STRAIGHT_Z);
  bannerMesh.userData.castsShadow = false;
  group.add(bannerMesh);

  // 5 F1 start light pods hanging beneath the gantry
  const podMat = standard('#181c1e', 0.6, 0.3);
  const redLightMat = new THREE.MeshStandardMaterial({
    color: '#ff3b30',
    emissive: '#ff261b',
    emissiveIntensity: 1.8,
    roughness: 0.25,
  });
  const greenLightMat = new THREE.MeshStandardMaterial({
    color: '#35eb78',
    emissive: '#1fd660',
    emissiveIntensity: 1.6,
    roughness: 0.25,
  });
  for (let p = -2; p <= 2; p += 1) {
    const lz = MAIN_STRAIGHT_Z + p * 2.1;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.35, 0.78), podMat);
    pod.position.set(startX - 0.65, 7.65, lz);
    pod.userData.castsShadow = false;
    group.add(pod);

    const upperBulb = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), redLightMat);
    upperBulb.rotation.z = Math.PI / 2;
    upperBulb.position.set(startX - 0.88, 7.95, lz);
    upperBulb.userData.castsShadow = false;
    group.add(upperBulb);

    const lowerBulb = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), greenLightMat);
    lowerBulb.rotation.z = Math.PI / 2;
    lowerBulb.position.set(startX - 0.88, 7.35, lz);
    lowerBulb.userData.castsShadow = false;
    group.add(lowerBulb);
  }

  parent.add(group);
  return pitAsphaltMesh;
}

function addGrandstand(
  parent: THREE.Group,
  x: number,
  y: number,
  z: number,
  yaw: number,
  length: number,
  tiers = 6,
): void {
  const stand = new THREE.Group();
  stand.position.set(x, y, z);
  stand.rotation.y = yaw;

  const concreteMat = standard('#9aa09c', 0.88, 0.04);
  const seatColors = ['#c93b32', '#2d7ab8', '#e0a938', '#259678', '#d9ded8'];
  const tierDepth = 2.1;
  const tierRise = 1.05;

  // Base structure under the tiers
  const totalDepth = tiers * tierDepth;
  const totalHeight = tiers * tierRise;
  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(length, totalHeight + 1.4, 1.2),
    standard('#586264', 0.8, 0.12),
  );
  backWall.position.set(0, (totalHeight + 1.4) / 2, -totalDepth / 2 - 0.5);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  backWall.userData.castsShadow = true;
  stand.add(backWall);

  for (let t = 0; t < tiers; t += 1) {
    const stepH = (t + 1) * tierRise;
    const stepZ = totalDepth / 2 - (t + 0.5) * tierDepth;
    const block = new THREE.Mesh(new THREE.BoxGeometry(length, stepH, tierDepth), concreteMat);
    block.position.set(0, stepH / 2, stepZ);
    block.castShadow = t === tiers - 1;
    block.receiveShadow = true;
    block.userData.castsShadow = t === tiers - 1;
    stand.add(block);

    // Colorful seat rows along each tier
    const seatRow = new THREE.Mesh(
      new THREE.BoxGeometry(length - 2.4, 0.34, tierDepth * 0.58),
      standard(seatColors[t % seatColors.length], 0.65, 0.06),
    );
    seatRow.position.set(0, stepH + 0.17, stepZ + 0.15);
    seatRow.userData.castsShadow = false;
    stand.add(seatRow);
  }

  // Cantilevered white stadium canopy roof + rear support masts
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(length + 3, 0.55, totalDepth + 5.5),
    standard('#e6eae5', 0.58, 0.12),
  );
  canopy.position.set(0, totalHeight + 5.4, 1.4);
  canopy.rotation.x = 0.07;
  canopy.castShadow = true;
  canopy.receiveShadow = true;
  canopy.userData.castsShadow = true;
  stand.add(canopy);

  const mastCount = Math.max(3, Math.floor(length / 36));
  const mastGeom = new THREE.CylinderGeometry(0.28, 0.36, totalHeight + 6.2, 8);
  const mastMat = standard('#3b4447', 0.48, 0.58);
  for (let m = 0; m < mastCount; m += 1) {
    const mx = -length * 0.44 + (length * 0.88 * m) / Math.max(1, mastCount - 1);
    const mast = new THREE.Mesh(mastGeom, mastMat);
    mast.position.set(mx, (totalHeight + 6.2) / 2, -totalDepth / 2 - 1.1);
    mast.castShadow = true;
    mast.userData.castsShadow = true;
    stand.add(mast);
  }

  parent.add(stand);
}

function addBrakeMarkersAndSigns(parent: THREE.Group, samples: TrackSample[]): void {
  const n = samples.length;

  // Create reusable 150 / 100 / 50 brake distance marker textures
  const distances = [150, 100, 50] as const;
  const markerMaterials = distances.map((meters) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#18201e';
      ctx.fillRect(0, 0, 256, 160);
      ctx.strokeStyle = '#f2efe4';
      ctx.lineWidth = 10;
      ctx.strokeRect(8, 8, 240, 144);
      ctx.fillStyle = '#f6f5ee';
      ctx.font = '800 92px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(meters), 128, 84);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  });

  // Find indices closest to Turn 1 entry, Turn 5 Summit entry, and Turn 7 Stadium Hairpin entry
  const findClosestSample = (tx: number, tz: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i += 1) {
      const d = (samples[i].x - tx) ** 2 + (samples[i].z - tz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const brakingZones: Array<{ apexX: number; apexZ: number; side: -1 | 1 }> = [
    { apexX: 395, apexZ: -270, side: -1 }, // Turn 1 (markers on driver's left)
    { apexX: 486, apexZ: 215, side: -1 },  // Turn 5 Summit (markers on driver's left)
    { apexX: -415, apexZ: 278, side: -1 }, // Turn 7 Hairpin (markers on driver's left)
  ];

  const totalLen = samples[n - 1].s + 2;
  const postGeom = new THREE.CylinderGeometry(0.09, 0.11, 2.2, 6);
  const postMat = standard('#6f7778', 0.5, 0.5);
  const boardGeom = new THREE.BoxGeometry(2.5, 1.45, 0.12);
  const tmp = new THREE.Vector3();

  for (const zone of brakingZones) {
    const turnIdx = findClosestSample(zone.apexX, zone.apexZ);
    const turnS = samples[turnIdx].s;
    distances.forEach((distMeters, dIdx) => {
      const targetS = (turnS - distMeters + totalLen) % totalLen;
      // Locate sample with s closest to targetS
      let sIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < n; i += 1) {
        const diff = Math.abs(samples[i].s - targetS);
        if (diff < bestDiff) {
          bestDiff = diff;
          sIdx = i;
        }
      }
      const s = samples[sIdx];
      const off = zone.side * (VERGE_OUTER + 1.35);
      worldPoint(s, off, 0, tmp);
      const yaw = Math.atan2(s.tx, s.tz);

      const markerGroup = new THREE.Group();
      markerGroup.position.copy(tmp);
      // Face oncoming drivers along -tangent
      markerGroup.rotation.y = yaw + Math.PI;

      const post = new THREE.Mesh(postGeom, postMat);
      post.position.y = 1.1;
      post.userData.castsShadow = false;
      markerGroup.add(post);

      const board = new THREE.Mesh(boardGeom, markerMaterials[dIdx]);
      board.position.y = 2.05;
      board.castShadow = true;
      board.userData.castsShadow = true;
      markerGroup.add(board);

      parent.add(markerGroup);
    });
  }
}

function addTrackSpeedGates(parent: THREE.Group, samples: TrackSample[]): SpeedGate[] {
  const archMat = new THREE.MeshStandardMaterial({
    color: '#49f0d0',
    emissive: '#16bfa2',
    emissiveIntensity: 1.4,
    metalness: 0.38,
    roughness: 0.25,
  });

  const makeGateLabel = (title: string): THREE.Mesh => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#132e2c';
      ctx.fillRect(0, 0, 512, 96);
      ctx.strokeStyle = '#56f1d2';
      ctx.lineWidth = 5;
      ctx.strokeRect(3, 3, 506, 90);
      ctx.fillStyle = '#e8fff8';
      ctx.font = '700 36px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, 256, 48);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(8.2, 1.5),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    mesh.userData.castsShadow = false;
    return mesh;
  };

  // Pick sample on Main Straight (x ≈ 195) and sample on Downhill Back Straight (x ≈ -180, z > 250)
  let mainIdx = 0;
  let backIdx = 0;
  let bestMain = Infinity;
  let bestBack = Infinity;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    if (s.z < -265) {
      const d = Math.abs(s.x - 195);
      if (d < bestMain) { bestMain = d; mainIdx = i; }
    } else if (s.z > 250) {
      const d = Math.abs(s.x - (-180));
      if (d < bestBack) { bestBack = d; backIdx = i; }
    }
  }

  return [mainIdx, backIdx].map((idx, gateIndex) => {
    const s = samples[idx];
    const center = new THREE.Vector3(s.x, s.y, s.z);
    const direction = new THREE.Vector3(s.tx, 0, s.tz).normalize();
    const frame = new THREE.Group();
    frame.position.copy(center);
    frame.rotation.y = Math.atan2(direction.x, direction.z);

    // Span comfortably outside the 18 m asphalt so the arch feet sit on the grass verge
    const halfWidth = 10.6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(halfWidth, 0.4, 10, 72, Math.PI), archMat);
    ring.position.y = 0.2;
    ring.castShadow = true;
    ring.userData.castsShadow = true;
    frame.add(ring);

    const label = makeGateLabel('200 KM/SA  ·  ₺5.000');
    label.position.set(0, halfWidth + 1.85, 0.08);
    frame.add(label);

    parent.add(frame);
    return {
      id: `autodrom-gate-${gateIndex + 1}`,
      center,
      direction,
      halfWidth: TRACK_HALF_WIDTH + 1.2,
    };
  });
}

function addFloodlightsAndScenery(parent: THREE.Group, samples: TrackSample[], landscapeRefs: TrackSample[]): void {
  const n = samples.length;

  // 1. Tall stadium floodlight towers around the circuit
  const towerStep = Math.floor(n / 14);
  const mastGeom = new THREE.CylinderGeometry(0.18, 0.34, 18, 8);
  const mastMat = standard('#586366', 0.46, 0.62);
  const headGeom = new THREE.BoxGeometry(3.2, 1.1, 0.55);
  const headMat = new THREE.MeshStandardMaterial({
    color: '#fff6df',
    emissive: '#ffe9b8',
    emissiveIntensity: 1.7,
    roughness: 0.25,
  });

  const masts = new THREE.InstancedMesh(mastGeom, mastMat, 14);
  const heads = new THREE.InstancedMesh(headGeom, headMat, 14);
  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();

  for (let i = 0; i < 14; i += 1) {
    const s = samples[(i * towerStep + 35) % n];
    const side = i % 2 === 0 ? -1 : 1;
    const off = side === 1 ? s.rightBarrierOffset + 4.5 : -(VERGE_OUTER + 4.5);
    worldPoint(s, off, 0, tmp);
    const groundY = sampleLandscapeHeight(landscapeRefs, tmp.x, tmp.z).y;
    const faceTrackYaw = Math.atan2(-s.rx * side, -s.rz * side);

    dummy.position.set(tmp.x, groundY + 9, tmp.z);
    dummy.rotation.set(0, faceTrackYaw, 0);
    dummy.updateMatrix();
    masts.setMatrixAt(i, dummy.matrix);

    dummy.position.set(tmp.x, groundY + 18.1, tmp.z);
    dummy.rotation.set(0.32, faceTrackYaw, 0, 'YXZ');
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  }
  masts.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  masts.castShadow = true;
  masts.userData.castsShadow = true;
  heads.userData.castsShadow = false;
  parent.add(masts, heads);

  // 2. Pine & cypress trees + rock outcrops across the infield & surrounding valley hills
  let seed = 90210;
  const rng = (): number => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const treeSpots: Array<{ x: number; y: number; z: number; scale: number; tint: number }> = [];
  const rockSpots: Array<{ x: number; y: number; z: number; scale: number; rot: number }> = [];

  for (let attempt = 0; attempt < 1100 && treeSpots.length < 360; attempt += 1) {
    const x = (rng() - 0.5) * 1320;
    const z = (rng() - 0.5) * 920;

    // Keep clear of the Main Grandstand, Summit Grandstand, West Stadium Grandstand & Pit Building
    if (z > -335 && z < -205 && x > -240 && x < 200) continue;
    if (Math.hypot(x - 492, z - 316) < 68) continue;
    if (Math.hypot(x - (-536), z - 185) < 74) continue;

    const { y, minClearance } = sampleLandscapeHeight(landscapeRefs, x, z);
    if (minClearance < 10) continue;

    if (attempt % 9 === 0 && rockSpots.length < 85) {
      rockSpots.push({ x, y, z, scale: 1.1 + rng() * 2.1, rot: rng() * Math.PI * 2 });
    } else {
      treeSpots.push({ x, y, z, scale: 0.8 + rng() * 0.85, tint: rng() });
    }
  }

  if (treeSpots.length > 0) {
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.24, 0.36, 3.2, 6),
      standard('#6b5642', 0.95, 0.01),
      treeSpots.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.ConeGeometry(3.1, 9.6, 7),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0.01 }),
      treeSpots.length,
    );
    const pineA = new THREE.Color('#3f5b43');
    const pineB = new THREE.Color('#536e4d');
    const cTmp = new THREE.Color();

    for (let i = 0; i < treeSpots.length; i += 1) {
      const t = treeSpots[i];
      dummy.position.set(t.x, t.y + 1.4 * t.scale, t.z);
      dummy.rotation.set(0, t.tint * Math.PI, 0);
      dummy.scale.set(t.scale, t.scale, t.scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(t.x, t.y + 6.0 * t.scale, t.z);
      dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
      cTmp.copy(pineA).lerp(pineB, t.tint);
      crowns.setColorAt(i, cTmp);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    trunks.castShadow = true;
    crowns.castShadow = true;
    trunks.userData.castsShadow = true;
    crowns.userData.castsShadow = true;
    parent.add(trunks, crowns);
  }

  if (rockSpots.length > 0) {
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.2, 0),
      standard('#7e7c6d', 0.97, 0),
      rockSpots.length,
    );
    for (let i = 0; i < rockSpots.length; i += 1) {
      const r = rockSpots[i];
      dummy.position.set(r.x, r.y + 0.45 * r.scale, r.z);
      dummy.rotation.set(0.18, r.rot, 0.12);
      dummy.scale.set(r.scale * 1.3, r.scale * 0.72, r.scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.userData.castsShadow = true;
    parent.add(rocks);
  }
}

export function createAutodromWorld(settings: GameSettings): WorldData {
  const root = new THREE.Group();
  root.name = 'autodrom-gp';

  const textures = getTrackTextures();
  const samples = buildTrackSamples();

  const bounds = { minX: -560, maxX: 550, minZ: -345, maxZ: 385 };
  const heights = new HeightGrid(
    { minX: bounds.minX - 20, maxX: bounds.maxX + 20, minZ: bounds.minZ - 20, maxZ: bounds.maxZ + 20 },
    HEIGHT_CELL,
  );
  const wallGrid = new WallGrid(
    { minX: bounds.minX - 20, maxX: bounds.maxX + 20, minZ: bounds.minZ - 20, maxZ: bounds.maxZ + 20 },
    WALL_CELL,
  );

  const landscapeRefs: TrackSample[] = [];
  for (let i = 0; i < samples.length; i += 4) landscapeRefs.push(samples[i]);

  // Build drivable surfaces first and populate HeightGrid
  const asphaltMesh = buildMainTrackAsphalt(samples, textures.asphalt);
  const curbsMesh = buildCurbs(samples, textures.curb);
  const { leftVerge, rightVerge } = buildVergesAndRunoffs(samples);
  const landscapeMesh = buildLandscape(landscapeRefs);

  root.add(landscapeMesh, leftVerge, rightVerge, asphaltMesh, curbsMesh);

  // Temporary ground lookup before HeightGrid is finalized (pit lane is at y = 0)
  const flatZero = (): number => 0;
  const pitAsphaltMesh = buildPitComplexAndGrid(root, textures.checker, wallGrid, flatZero);

  root.updateMatrixWorld(true);
  for (const surface of [leftVerge, rightVerge, pitAsphaltMesh, asphaltMesh, curbsMesh]) {
    forEachWorldTriangle(surface, (a, b, c) => heights.addTriangle(a, b, c));
  }
  heights.fillGaps(0, 8);

  const groundAt = (x: number, z: number): number => heights.sample(x, z) ?? 0;
  buildGuardrailsAndTireWalls(root, samples, wallGrid, groundAt);

  // 3 Grandstands seated cleanly into the terrain:
  // 1) Main Straight Grandstand (facing +Z toward Start/Finish & Pit Garages)
  addGrandstand(root, -35, -0.2, MAIN_STRAIGHT_Z - 31, 0, 220, 7);
  // 2) Summit Ridge Grandstand overlooking Turn 5-6 Crest
  const summitStandY = sampleLandscapeHeight(landscapeRefs, 492, 316).y - 1.2;
  addGrandstand(root, 492, summitStandY, 316, -Math.PI * 0.76, 96, 5);
  // 3) West Stadium Grandstand overlooking Turn 7 Hairpin
  const stadiumStandY = sampleLandscapeHeight(landscapeRefs, -536, 185).y - 1.2;
  addGrandstand(root, -536, stadiumStandY, 185, Math.PI * 0.54, 110, 6);

  addBrakeMarkersAndSigns(root, samples);
  const speedGates = addTrackSpeedGates(root, samples);
  addFloodlightsAndScenery(root, samples, landscapeRefs);

  // Spawn on Pole Position area right behind the Start/Finish gantry, facing +X down the 660 m main straight
  const spawn = new THREE.Vector3(-68, 0, MAIN_STRAIGHT_Z);
  spawn.y = groundAt(spawn.x, spawn.z);
  wallGrid.clear(spawn.x, spawn.z, 6);

  const castsEnabled = settings.shadows && settings.quality !== 'low';
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.castsShadow === undefined) mesh.userData.castsShadow = false;
    mesh.castShadow = castsEnabled && mesh.userData.castsShadow === true;
  });

  return {
    root,
    colliders: [],
    spawn,
    spawnYaw: Math.PI / 2,
    speedGates,
    ramps: [],
    bounds,
    terrain: heights,
    walls: wallGrid,
    ready: Promise.resolve(),
    loadProgress: () => 1,
  };
}
