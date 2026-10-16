// Ruts: how far soft ground (mud, sand, snow) has been pressed down, on a sparse grid of small cells. Tyres stamp
// it (Vehicle.js) and it never springs back, so every truck that passes deepens the track for the next one. The
// ground's height subtracts it; the renderer rebuilds the terrain where it changed (dirty chunks, and which quarters
// of them: the finest terrain patches are a quarter of a chunk).

const CELL = 0.25;          // m
const N = 64;               // cells per chunk side (16 m)
const SPAN = CELL * N;
const REACH = 4;            // cells: how far a change shows in the terrain drawn round it (see markNear)

export class DeformGrid {
  constructor() {
    this.chunks = new Map();
    this.dirty = new Set();
    this.quads = new Map();     // dirty chunk -> which quarters changed (bits 1 << (qx + 2 qz))
    this.taken = new Map();     // (the same, for the chunks the last takeDirty returned)
    this.lastKey = NaN;         // the chunk the last lookup found (most lookups land in the same one), while the
    this.lastChunk = undefined; // chunks stay as many as they were then
    this.lastSize = -1;
    this.version = 0;
  }

  static key(cx, cz) { return cx * 65536 + cz; }

  chunk(cx, cz, create) {
    const k = cx * 65536 + cz;
    let c = this.chunks.get(k);
    if (!c && create) { c = new Float32Array(N * N); this.chunks.set(k, c); }
    return c;
  }

  cell(ix, iz) {
    const cx = Math.floor(ix / N), cz = Math.floor(iz / N), k = cx * 65536 + cz;
    let c;
    if (k === this.lastKey && this.lastSize === this.chunks.size) c = this.lastChunk;
    else { c = this.chunks.get(k); this.lastKey = k; this.lastChunk = c; this.lastSize = this.chunks.size; }
    if (!c) return 0;
    return c[(iz - cz * N) * N + (ix - cx * N)];
  }

  /** Depth (m, >= 0) at (x, z), bilinear between cell centres. */
  get(x, z) {
    if (this.chunks.size === 0) return 0;
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const a = this.cell(ix, iz), b = this.cell(ix + 1, iz), c = this.cell(ix, iz + 1), d = this.cell(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /**
   * Press the ground down under a tyre's contact patch: a rectangle centred on (x, z) with its long axis along
   * (fx, fz), half width hw and half length hl. Cells are pressed to at least `press` (soft edges) and then dug
   * `dig` deeper; nothing goes below maxSink(x, z). Returns the depth at the centre.
   */
  stamp(x, z, fx, fz, hw, hl, press, dig, maxSink) {
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    const ext = Math.max(hw, hl) + CELL;
    const i0 = Math.floor((x - ext) / CELL), i1 = Math.floor((x + ext) / CELL);
    const k0 = Math.floor((z - ext) / CELL), k1 = Math.floor((z + ext) / CELL);
    const edge = 0.08;
    for (let ix = i0; ix <= i1; ix++) {
      for (let iz = k0; iz <= k1; iz++) {
        const px = (ix + 0.5) * CELL - x, pz = (iz + 0.5) * CELL - z;
        const along = Math.abs(px * fx + pz * fz), across = Math.abs(-px * fz + pz * fx);
        if (along > hl + edge || across > hw + edge) continue;
        const wA = along <= hl ? 1 : 1 - (along - hl) / edge;
        const wC = across <= hw ? 1 : 1 - (across - hw) / edge;
        const w = wA * wC;
        const cxk = Math.floor(ix / N), czk = Math.floor(iz / N);
        const lim = maxSink((ix + 0.5) * CELL, (iz + 0.5) * CELL);
        if (lim <= 0) continue;
        const c = this.chunk(cxk, czk, true);
        const i = (iz - czk * N) * N + (ix - cxk * N);
        const cur = c[i];
        const next = Math.min(lim, Math.max(cur, press * w) + dig * w);
        if (next > cur + 1e-5) {
          c[i] = next;
          this.dirty.add(cxk * 65536 + czk);
          this.markNear(cxk, czk, ix - cxk * N, iz - czk * N);
          this.version++;
        }
      }
    }
    return this.get(x, z);
  }

  /**
   * Mark the quarters of the chunks whose drawn ground a changed cell (li, lk of chunk cx, cz) reaches: its own, and
   * its neighbours' where it lies within REACH cells of them (a point's height reads the cells round it, its berm
   * the ruts half a metre off, its normal the next point's).
   */
  markNear(cx, cz, li, lk) {
    const M = REACH, H = N / 2, edge = li < M || li >= N - M || lk < M || lk >= N - M;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dz) && !edge) continue;
      const x = li - dx * N, z = lk - dz * N;
      if (x < -M || x >= N + M || z < -M || z >= N + M) continue;
      const x0 = Math.max(0, x - M) >= H ? 1 : 0, x1 = Math.min(N - 1, x + M) >= H ? 1 : 0;
      const z0 = Math.max(0, z - M) >= H ? 2 : 0, z1 = Math.min(N - 1, z + M) >= H ? 2 : 0;
      const key = (cx + dx) * 65536 + cz + dz;
      if (dx || dz) this.dirty.add(key);
      this.quads.set(key, (this.quads.get(key) | 0) | (1 << (x0 + z0)) | (1 << (x1 + z0)) | (1 << (x0 + z1)) | (1 << (x1 + z1)));
    }
  }

  /** Chunk keys changed since the last call (for the renderer). */
  takeDirty() {
    if (this.dirty.size === 0) return null;
    const out = [...this.dirty];
    this.dirty.clear();
    const t = this.taken;
    this.taken = this.quads; this.quads = t; t.clear();
    return out;
  }

  /** Chunk key -> world rectangle [x0, z0, x1, z1]. */
  static bounds(key) {
    const cx = Math.round(key / 65536), cz = key - cx * 65536;
    return [cx * SPAN, cz * SPAN, (cx + 1) * SPAN, (cz + 1) * SPAN];
  }
}

export const DEFORM_CELL = CELL;
export const DEFORM_SPAN = SPAN;
