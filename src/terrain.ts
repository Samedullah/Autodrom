import * as THREE from 'three';

// Grids built once from a map model's triangles, so the per-frame physics
// only does array lookups: a height field for the drivable ground and an
// occupancy grid for walls and barriers.

export interface GridBounds { minX: number; minZ: number; maxX: number; maxZ: number }

/** Drivable ground height, sampled bilinearly. Cells no ground triangle touched take their neighbours' height. */
export class HeightGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly heights: Float32Array;

  constructor(readonly bounds: GridBounds, readonly cell: number) {
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    this.heights = new Float32Array(this.cols * this.rows).fill(Number.NaN);
  }

  /** Writes one triangle (world coordinates); where triangles overlap the higher one wins. */
  addTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
    const { minX, minZ } = this.bounds;
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - minX) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.ceil((Math.max(a.x, b.x, c.x) - minX) / this.cell));
    const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - minZ) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.ceil((Math.max(a.z, b.z, c.z) - minZ) / this.cell));
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(det) < 1e-9) return;
    // Slightly generous edges so cells between neighbouring triangles are not lost.
    const tolerance = -0.02;
    for (let row = r0; row <= r1; row += 1) {
      const z = minZ + row * this.cell;
      for (let col = c0; col <= c1; col += 1) {
        const x = minX + col * this.cell;
        const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
        const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < tolerance || l2 < tolerance || l3 < tolerance) continue;
        const y = l1 * a.y + l2 * b.y + l3 * c.y;
        const index = row * this.cols + col;
        const current = this.heights[index];
        if (Number.isNaN(current) || y > current) this.heights[index] = y;
      }
    }
  }

  /** Fills untouched cells from their neighbours (gaps between meshes), then any rest with `fallback`. */
  fillGaps(fallback: number, passes = 6): void {
    const { cols, rows, heights } = this;
    for (let pass = 0; pass < passes; pass += 1) {
      let filled = 0;
      const next = heights.slice();
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          if (!Number.isNaN(heights[index])) continue;
          let sum = 0;
          let count = 0;
          if (col > 0 && !Number.isNaN(heights[index - 1])) { sum += heights[index - 1]; count += 1; }
          if (col < cols - 1 && !Number.isNaN(heights[index + 1])) { sum += heights[index + 1]; count += 1; }
          if (row > 0 && !Number.isNaN(heights[index - cols])) { sum += heights[index - cols]; count += 1; }
          if (row < rows - 1 && !Number.isNaN(heights[index + cols])) { sum += heights[index + cols]; count += 1; }
          if (count > 0) { next[index] = sum / count; filled += 1; }
        }
      }
      heights.set(next);
      if (filled === 0) break;
    }
    for (let i = 0; i < heights.length; i += 1) if (Number.isNaN(heights[i])) heights[i] = fallback;
  }

  /** Height at (x, z); `slope` receives the rise per metre along X and Z. Outside the grid: null. */
  sample(x: number, z: number, slope?: THREE.Vector2): number | null {
    const fx = (x - this.bounds.minX) / this.cell;
    const fz = (z - this.bounds.minZ) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.cols - 1 || fz >= this.rows - 1) return null;
    const col = Math.floor(fx);
    const row = Math.floor(fz);
    const tx = fx - col;
    const tz = fz - row;
    const i = row * this.cols + col;
    const h00 = this.heights[i];
    const h10 = this.heights[i + 1];
    const h01 = this.heights[i + this.cols];
    const h11 = this.heights[i + this.cols + 1];
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    if (slope) {
      slope.set(
        ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / this.cell,
        (bottom - top) / this.cell,
      );
    }
    return top + (bottom - top) * tz;
  }
}

/** Cells a car cannot enter: barriers, walls, buildings. */
export class WallGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: Uint8Array;

  constructor(readonly bounds: GridBounds, readonly cell: number) {
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1;
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
    this.cells = new Uint8Array(this.cols * this.rows);
  }

  /**
   * Marks the footprint of a steep (wall-like) triangle, but only the part
   * low enough to touch a car: bridges and roofs overhead stay passable.
   */
  addWallTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, groundAt: (x: number, z: number) => number, reach: number): void {
    const edges: Array<[THREE.Vector3, THREE.Vector3]> = [[a, b], [b, c], [c, a]];
    for (const [p, q] of edges) {
      const length = Math.hypot(q.x - p.x, q.z - p.z);
      const steps = Math.max(1, Math.ceil(length / (this.cell * 0.5)));
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = p.x + (q.x - p.x) * t;
        const z = p.z + (q.z - p.z) * t;
        const y = p.y + (q.y - p.y) * t;
        if (y > groundAt(x, z) + reach) continue;
        this.mark(x, z);
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const col = Math.round((x - this.bounds.minX) / this.cell);
    const row = Math.round((z - this.bounds.minZ) / this.cell);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true;
    return this.cells[row * this.cols + col] === 1;
  }

  /** Opens a disc again, e.g. around the spawn point. */
  clear(x: number, z: number, radius: number): void {
    const span = Math.ceil(radius / this.cell);
    const col = Math.round((x - this.bounds.minX) / this.cell);
    const row = Math.round((z - this.bounds.minZ) / this.cell);
    for (let dr = -span; dr <= span; dr += 1) {
      for (let dc = -span; dc <= span; dc += 1) {
        if (dr * dr + dc * dc > span * span) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && c >= 0 && r < this.rows && c < this.cols) this.cells[r * this.cols + c] = 0;
      }
    }
  }

  private mark(x: number, z: number): void {
    const col = Math.round((x - this.bounds.minX) / this.cell);
    const row = Math.round((z - this.bounds.minZ) / this.cell);
    if (col >= 0 && row >= 0 && col < this.cols && row < this.rows) this.cells[row * this.cols + col] = 1;
  }
}

/** Calls `visit` with every triangle of `mesh` in world coordinates. */
export function forEachWorldTriangle(mesh: THREE.Mesh, visit: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void): void {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return;
  const index = geometry.getIndex();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const matrix = mesh.matrixWorld;
  const count = index ? index.count : position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, ia).applyMatrix4(matrix);
    b.fromBufferAttribute(position, ib).applyMatrix4(matrix);
    c.fromBufferAttribute(position, ic).applyMatrix4(matrix);
    visit(a, b, c);
  }
}
