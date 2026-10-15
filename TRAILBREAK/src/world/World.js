// The valley at run time: the ground the physics drives on (heights with ruts and boulders, surfaces, water,
// trees and walls to hit) and the data the renderer draws.
//
// Ground interface used by physics/Vehicle.js:
//   height(x, z)                 ground height: terrain - ruts, or the top of a boulder
//   surfaceAt(x, z)              surface record (physics/Surfaces.js)
//   water(x, z)                  water surface height there, or -Infinity
//   deform(x, z, fx, fz, hw, hl, press, dig)   press soft ground under a tyre, returns the rut depth
//   treesNear(x, z, r, out)      trunks and wall posts { x, y, z, r } near (x, z)

import { SURFACES, SURFACE } from '../physics/Surfaces.js';
import { DeformGrid } from './Deform.js';
import { farHeight, NO_WATER } from './WorldGen.js';
import { MAP_HALF } from './MapData.js';

const OB_CELL = 16;          // obstacle (tree, post) grid cell (m)
const BO_CELL = 8;           // boulder grid cell (m)

export class World {
  constructor(data) {
    this.data = data;
    this.N = data.N; this.origin = data.origin;
    this.H = data.heights; this.S = data.surface;
    this.W = data.water; this.WN = data.waterN; this.WR = data.waterRes;
    this.deformGrid = new DeformGrid();
    this.trees = data.trees;
    this.boulders = data.boulders;
    this.beacons = data.beacons;
    this.landmarks = data.landmarks;
    this.lake = data.lake;

    // obstacles: trees then posts, bucketed by cell (counting sort into flat arrays)
    const T = data.trees, P = data.posts;
    const n = T.count + P.length;
    this.ob = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), r: new Float32Array(n) };
    for (let i = 0; i < T.count; i++) { this.ob.x[i] = T.x[i]; this.ob.y[i] = T.y[i]; this.ob.z[i] = T.z[i]; this.ob.r[i] = T.r[i]; }
    P.forEach((p, k) => { const i = T.count + k; this.ob.x[i] = p.x; this.ob.y[i] = p.y; this.ob.z[i] = p.z; this.ob.r[i] = p.r; });
    this.obN = Math.ceil(MAP_HALF * 2 / OB_CELL);
    const cellOf = (x, z) => Math.min(this.obN - 1, Math.max(0, Math.floor((z + MAP_HALF) / OB_CELL))) * this.obN + Math.min(this.obN - 1, Math.max(0, Math.floor((x + MAP_HALF) / OB_CELL)));
    const counts = new Uint32Array(this.obN * this.obN + 1);
    for (let i = 0; i < n; i++) counts[cellOf(this.ob.x[i], this.ob.z[i]) + 1]++;
    for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
    this.obStart = counts;
    this.obIdx = new Uint32Array(n);
    const fill = counts.slice();
    for (let i = 0; i < n; i++) this.obIdx[fill[cellOf(this.ob.x[i], this.ob.z[i])]++] = i;
    this.obPool = [];
    for (let i = 0; i < 64; i++) this.obPool.push({ x: 0, y: 0, z: 0, r: 0 });

    // boulders: each listed in every cell its footprint touches
    this.boN = Math.ceil(MAP_HALF * 2 / BO_CELL);
    this.boCells = new Map();
    this.boulders.forEach((b, i) => {
      const R = Math.max(b.rx, b.rz);
      b.cos = Math.cos(b.yaw); b.sin = Math.sin(b.yaw);
      const i0 = Math.floor((b.x - R + MAP_HALF) / BO_CELL), i1 = Math.floor((b.x + R + MAP_HALF) / BO_CELL);
      const k0 = Math.floor((b.z - R + MAP_HALF) / BO_CELL), k1 = Math.floor((b.z + R + MAP_HALF) / BO_CELL);
      for (let k = k0; k <= k1; k++) for (let ii = i0; ii <= i1; ii++) {
        const key = k * this.boN + ii;
        let list = this.boCells.get(key);
        if (!list) { list = []; this.boCells.set(key, list); }
        list.push(i);
      }
    });
  }

  /** Terrain height without ruts or boulders (bilinear on the 1 m grid, the far landform outside it). */
  terrain(x, z) {
    const fx = x - this.origin, fz = z - this.origin;
    const N = this.N;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return farHeight(x, z);
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const o = k * N + i, H = this.H;
    return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + N] * (1 - tx) + H[o + N + 1] * tx) * tz;
  }

  /** Top of the highest boulder at (x, z), or -Infinity. */
  boulderTop(x, z) {
    const key = Math.floor((z + MAP_HALF) / BO_CELL) * this.boN + Math.floor((x + MAP_HALF) / BO_CELL);
    const list = this.boCells.get(key);
    if (!list) return -Infinity;
    let top = -Infinity;
    for (let n = 0; n < list.length; n++) {
      const b = this.boulders[list[n]];
      const dx = x - b.x, dz = z - b.z;
      const u = (dx * b.cos - dz * b.sin) / b.rx, v = (dx * b.sin + dz * b.cos) / b.rz;
      const q = 1 - u * u - v * v;
      if (q <= 0) continue;
      const y = b.y + b.ry * Math.sqrt(q);
      if (y > top) top = y;
    }
    return top;
  }

  height(x, z) {
    let h = this.terrain(x, z);
    if (this.deformGrid.chunks.size) h -= this.deformGrid.get(x, z);
    const b = this.boulderTop(x, z);
    return b > h ? b : h;
  }

  surfaceId(x, z) {
    const i = Math.round(x - this.origin), k = Math.round(z - this.origin);
    if (i < 0 || k < 0 || i >= this.N || k >= this.N) return SURFACE.ROCK;
    return this.S[k * this.N + i];
  }

  surfaceAt(x, z) {
    if (this.boulderTop(x, z) > this.terrain(x, z) - 0.02) return SURFACES[SURFACE.ROCK];
    return SURFACES[this.surfaceId(x, z)];
  }

  water(x, z) {
    const i = Math.round((x - this.origin) / this.WR), k = Math.round((z - this.origin) / this.WR);
    if (i < 0 || k < 0 || i >= this.WN || k >= this.WN) return -Infinity;
    const w = this.W[k * this.WN + i];
    return w === NO_WATER ? -Infinity : w;
  }

  deform(x, z, fx, fz, hw, hl, press, dig) {
    return this.deformGrid.stamp(x, z, fx, fz, hw, hl, press, dig, (px, pz) => SURFACES[this.surfaceId(px, pz)].maxSink);
  }

  /** Trunks and posts within r of (x, z) (reuses its result objects: copy what you keep). */
  treesNear(x, z, r, out) {
    out.length = 0;
    const c0 = Math.floor((x - r + MAP_HALF) / OB_CELL), c1 = Math.floor((x + r + MAP_HALF) / OB_CELL);
    const k0 = Math.floor((z - r + MAP_HALF) / OB_CELL), k1 = Math.floor((z + r + MAP_HALF) / OB_CELL);
    const ob = this.ob;
    for (let k = Math.max(0, k0); k <= Math.min(this.obN - 1, k1); k++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.obN - 1, c1); c++) {
        const cell = k * this.obN + c;
        for (let s = this.obStart[cell]; s < this.obStart[cell + 1]; s++) {
          const i = this.obIdx[s];
          const dx = ob.x[i] - x, dz = ob.z[i] - z, rr = r + ob.r[i];
          if (dx * dx + dz * dz > rr * rr || out.length >= this.obPool.length) continue;
          const o = this.obPool[out.length];
          o.x = ob.x[i]; o.y = ob.y[i]; o.z = ob.z[i]; o.r = ob.r[i]; o.i = i;
          out.push(o);
        }
      }
    }
    return out;
  }

  /** Nearest tree (not a wall post) within reach of a point, for the winch. */
  nearestTree(x, z, maxDist, filter = null) {
    const out = this.treesNear(x, z, maxDist, []);
    let best = null, bd = Infinity;
    for (const t of out) {
      if (t.i >= this.trees.count) continue;
      if (filter && !filter(t)) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) { bd = d; best = { ...t }; }
    }
    return best;
  }

  inBounds(x, z, margin = 0) { return Math.abs(x) < MAP_HALF - margin && Math.abs(z) < MAP_HALF - margin; }
}
