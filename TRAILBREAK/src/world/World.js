// A map's world at run time: the ground the physics drives on (heights with ruts and boulders, surfaces, water,
// trees and walls to hit) and the data the renderer draws.
//
// Ground interface used by physics/Vehicle.js:
//   height(x, z)                 ground height: terrain - ruts, or the top of a boulder
//   surfaceAt(x, z)              surface record (physics/Surfaces.js)
//   water(x, z)                  water surface height there, or -Infinity
// (and for the renderer, waterSurface(x, z): the water's surface as it is drawn)
//   deform(x, z, fx, fz, hw, hl, press, dig)   press soft ground under a tyre, returns the rut depth
//   treesNear(x, z, r, out)      trunks, wall posts and roadside posts { x, y, z, r, cap, top, u, i } near (x, z)
//   strike(i, moment, vx, vz)    a truck bends obstacle i that hard (N m): breaks it if it gives way (true)
// (a custom layout's props, from the map builder, are part of the ground: setProps; game/Props.js)
//
// What breaks (world/Breakables.js): the trees slender enough, the young trees and the roadside things, each a unit
// (a tree, or a whole fence panel, sign or barrel) by key ('t' + tree, 'o' + roadside thing). Breaks queue in
// `breaks` for the game to draw, sound and share with the room ({ key, x, y, z, dx, dz, v, local, quiet }).

import { SURFACES, SURFACE } from '../physics/Surfaces.js';
import { DeformGrid } from './Deform.js';
import { NO_WATER } from './WorldGen.js';
import { MAP_HALF, mapById } from './maps/index.js';
import { rockTop, shapeOf } from './RockShapes.js';
import { PROP_TYPES, propTop, paintAt, reach, settle } from '../game/Props.js';
import { growYoung, placeRoadside, placedObstacles, trunkCap, WINCH_CAP } from './Breakables.js';

const OB_CELL = 16;          // obstacle (tree, post) grid cell (m)
const BO_CELL = 8;           // boulder grid cell (m)

export class World {
  constructor(data) {
    this.data = data;
    this.map = data.map || mapById();
    this.farHeight = data.farHeight;
    this.N = data.N; this.origin = data.origin;
    // the map's half-size and its fine grid's cell (m): a 2 km map's 1 m, a big map's bigger
    this.half = data.half ?? MAP_HALF; this.res = data.res ?? 1;
    this.H = data.heights; this.S = data.surface;
    this.W = data.water; this.WN = data.waterN; this.WR = data.waterRes;
    this.deformGrid = new DeformGrid();
    this.props = []; this.paints = []; this.propCells = new Map();
    // the young trees (joining the map's own) and the roadside things, once the ground is there to stand them on
    growYoung(data, this);
    this.roadside = placeRoadside(data, this);
    this.trees = data.trees;
    this.boulders = data.boulders;
    this.beacons = data.beacons;
    this.landmarks = data.landmarks;
    this.lake = data.lake;

    // obstacles: trees, wall posts, then the roadside things' posts, bucketed by cell (counting sort into flat arrays);
    // each with what it takes to break (N m at its foot; Infinity: nothing does), how tall it stands, and the unit it
    // breaks with (-1: a wall's)
    const T = data.trees, P = data.posts, road = this.roadside.map((it) => placedObstacles(it, (x, z) => this.terrain(x, z)));
    const n = T.count + P.length + road.reduce((a, l) => a + l.length, 0);
    this.ob = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), r: new Float32Array(n), cap: new Float32Array(n), top: new Float32Array(n), unit: new Int32Array(n) };
    const ob = this.ob;
    for (let i = 0; i < T.count; i++) { ob.x[i] = T.x[i]; ob.y[i] = T.y[i]; ob.z[i] = T.z[i]; ob.r[i] = T.r[i]; ob.cap[i] = trunkCap(this.map, T.type[i], T.r[i]); ob.top[i] = T.h[i]; ob.unit[i] = i; }
    P.forEach((p, k) => { const i = T.count + k; ob.x[i] = p.x; ob.y[i] = p.y; ob.z[i] = p.z; ob.r[i] = p.r; ob.cap[i] = Infinity; ob.top[i] = 6; ob.unit[i] = -1; });
    let i = T.count + P.length;
    road.forEach((list, j) => { for (const o of list) { ob.x[i] = o.x; ob.y[i] = o.y; ob.z[i] = o.z; ob.r[i] = o.r; ob.cap[i] = o.cap; ob.top[i] = o.top; ob.unit[i] = T.count + j; i++; } });
    this.broken = new Uint8Array(T.count + this.roadside.length);
    this.breaks = [];
    const HALF = this.half;
    this.obN = Math.ceil(HALF * 2 / OB_CELL);
    const cellOf = (x, z) => Math.min(this.obN - 1, Math.max(0, Math.floor((z + HALF) / OB_CELL))) * this.obN + Math.min(this.obN - 1, Math.max(0, Math.floor((x + HALF) / OB_CELL)));
    const counts = new Uint32Array(this.obN * this.obN + 1);
    for (let k = 0; k < n; k++) counts[cellOf(ob.x[k], ob.z[k]) + 1]++;
    for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
    this.obStart = counts;
    this.obIdx = new Uint32Array(n);
    const fill = counts.slice();
    for (let k = 0; k < n; k++) this.obIdx[fill[cellOf(ob.x[k], ob.z[k])]++] = k;
    this.obPool = [];
    for (let k = 0; k < 64; k++) this.obPool.push({ x: 0, y: 0, z: 0, r: 0, cap: Infinity, top: 0, u: -1, i: 0 });

    // boulders: each listed in every cell its footprint touches
    this.boN = Math.ceil(HALF * 2 / BO_CELL);
    this.boCells = new Map();
    this.boulders.forEach((b, i) => {
      const R = Math.max(b.rx, b.rz);
      b.cos = Math.cos(b.yaw); b.sin = Math.sin(b.yaw);
      b.shape = shapeOf(i);
      const i0 = Math.floor((b.x - R + HALF) / BO_CELL), i1 = Math.floor((b.x + R + HALF) / BO_CELL);
      const k0 = Math.floor((b.z - R + HALF) / BO_CELL), k1 = Math.floor((b.z + R + HALF) / BO_CELL);
      for (let k = k0; k <= k1; k++) for (let ii = i0; ii <= i1; ii++) {
        const key = k * this.boN + ii;
        let list = this.boCells.get(key);
        if (!list) { list = []; this.boCells.set(key, list); }
        list.push(i);
      }
    });
  }

  /** Terrain height without ruts or boulders (bilinear on the fine grid, the far landform outside it). */
  terrain(x, z) {
    const fx = (x - this.origin) / this.res, fz = (z - this.origin) / this.res;
    const N = this.N;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return this.farHeight(x, z);
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const o = k * N + i, H = this.H;
    return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + N] * (1 - tx) + H[o + N + 1] * tx) * tz;
  }

  /** A custom layout's props (game/Props.js), each settled on the ground; they replace any there were. */
  setProps(list) {
    this.props = (list || []).filter((p) => PROP_TYPES[p.type]).map((p) => settle({ type: p.type, x: p.x, z: p.z, yaw: p.yaw || 0 }, (x, z) => this.terrain(x, z)));
    this.paints = this.props.filter((p) => PROP_TYPES[p.type].shape === 'paint');
    this.propCells = new Map();
    this.props.forEach((p, i) => {
      const R = reach(p.type);
      for (let k = Math.floor((p.z - R + this.half) / BO_CELL); k <= Math.floor((p.z + R + this.half) / BO_CELL); k++) {
        for (let c = Math.floor((p.x - R + this.half) / BO_CELL); c <= Math.floor((p.x + R + this.half) / BO_CELL); c++) {
          const key = k * this.boN + c;
          let list = this.propCells.get(key);
          if (!list) this.propCells.set(key, (list = []));
          list.push(i);
        }
      }
    });
  }

  /** The prop whose top is highest at (x, z), and that top: { p, top }, or null. */
  propAt(x, z) {
    if (!this.props.length) return null;
    const list = this.propCells.get(Math.floor((z + this.half) / BO_CELL) * this.boN + Math.floor((x + this.half) / BO_CELL));
    if (!list) return null;
    let best = null, top = -Infinity;
    for (let n = 0; n < list.length; n++) {
      const p = this.props[list[n]], t = propTop(p, x, z);
      if (t > top) { top = t; best = p; }
    }
    return best ? { p: best, top } : null;
  }

  /** Top of the highest boulder at (x, z), or -Infinity. */
  boulderTop(x, z) {
    const key = Math.floor((z + this.half) / BO_CELL) * this.boN + Math.floor((x + this.half) / BO_CELL);
    const list = this.boCells.get(key);
    if (!list) return -Infinity;
    let top = -Infinity;
    for (let n = 0; n < list.length; n++) {
      const b = this.boulders[list[n]];
      const dx = x - b.x, dz = z - b.z;
      const u = (dx * b.cos - dz * b.sin) / b.rx, v = (dx * b.sin + dz * b.cos) / b.rz;
      if (u * u + v * v >= 1) continue;
      const y = b.y + b.ry * rockTop(b.shape, u, v);
      if (y > top) top = y;
    }
    return top;
  }

  height(x, z) {
    let h = this.terrain(x, z);
    if (this.deformGrid.chunks.size) h -= this.deformGrid.get(x, z);
    const b = this.boulderTop(x, z);
    if (b > h) h = b;
    if (this.props.length) { const q = this.propAt(x, z); if (q && q.top > h) h = q.top; }
    return h;
  }

  surfaceId(x, z) {
    for (let n = 0; n < this.paints.length; n++) if (paintAt(this.paints[n], x, z)) return PROP_TYPES[this.paints[n].type].surface;
    const i = Math.round((x - this.origin) / this.res), k = Math.round((z - this.origin) / this.res);
    if (i < 0 || k < 0 || i >= this.N || k >= this.N) return SURFACE.ROCK;
    return this.S[k * this.N + i];
  }

  surfaceAt(x, z) {
    if (this.props.length) { const q = this.propAt(x, z); if (q && q.top > this.terrain(x, z) - 0.02) return SURFACES[PROP_TYPES[q.p.type].surface]; }
    if (this.boulderTop(x, z) > this.terrain(x, z) - 0.02) return SURFACES[SURFACE.ROCK];
    return SURFACES[this.surfaceId(x, z)];
  }

  water(x, z) {
    const i = Math.round((x - this.origin) / this.WR), k = Math.round((z - this.origin) / this.WR);
    if (i < 0 || k < 0 || i >= this.WN || k >= this.WN) return -Infinity;
    const w = this.W[k * this.WN + i];
    return w === NO_WATER ? -Infinity : w;
  }

  /**
   * The water's surface as render/Water.js draws it: across the triangles between its grid points (each cell cut
   * corner (i+1, k) to (i, k+1)), so what floats on it (foam, ripples) sits on the drawn surface, not under it.
   */
  waterSurface(x, z) {
    const fx = (x - this.origin) / this.WR, fz = (z - this.origin) / this.WR, i = Math.floor(fx), k = Math.floor(fz), u = fx - i, v = fz - k;
    const N = this.WN, W = this.W;
    if (i < 0 || k < 0 || i + 1 >= N || k + 1 >= N) return this.water(x, z);
    const a = W[k * N + i], b = W[k * N + i + 1], c = W[(k + 1) * N + i], e = W[(k + 1) * N + i + 1];
    if (a === NO_WATER || b === NO_WATER || c === NO_WATER || e === NO_WATER) return this.water(x, z);
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : e + (c - e) * (1 - u) + (b - e) * (1 - v);
  }

  /**
   * The deepest a rut can go at a point: each ground's own, blended across its cells, so a rut in mud runs out
   * onto firm ground up a ramp (as the mud thins out at its edge) rather than ending at a wall.
   */
  maxSinkAt(x, z) {
    for (let n = 0; n < this.paints.length; n++) if (paintAt(this.paints[n], x, z)) return SURFACES[PROP_TYPES[this.paints[n].type].surface].maxSink;
    const fx = (x - this.origin) / this.res, fz = (z - this.origin) / this.res, i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const m = (a, b) => (a < 0 || b < 0 || a >= this.N || b >= this.N ? 0 : SURFACES[this.S[b * this.N + a]].maxSink);
    return (m(i, k) * (1 - tx) + m(i + 1, k) * tx) * (1 - tz) + (m(i, k + 1) * (1 - tx) + m(i + 1, k + 1) * tx) * tz;
  }

  deform(x, z, fx, fz, hw, hl, press, dig) {
    return this.deformGrid.stamp(x, z, fx, fz, hw, hl, press, dig, (px, pz) => this.maxSinkAt(px, pz));
  }

  /** Trunks and posts within r of (x, z) (reuses its result objects: copy what you keep). */
  treesNear(x, z, r, out) {
    out.length = 0;
    const c0 = Math.floor((x - r + this.half) / OB_CELL), c1 = Math.floor((x + r + this.half) / OB_CELL);
    const k0 = Math.floor((z - r + this.half) / OB_CELL), k1 = Math.floor((z + r + this.half) / OB_CELL);
    const ob = this.ob;
    for (let k = Math.max(0, k0); k <= Math.min(this.obN - 1, k1); k++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.obN - 1, c1); c++) {
        const cell = k * this.obN + c;
        for (let s = this.obStart[cell]; s < this.obStart[cell + 1]; s++) {
          const i = this.obIdx[s], u = ob.unit[i];
          if (u >= 0 && this.broken[u]) continue;
          const dx = ob.x[i] - x, dz = ob.z[i] - z, rr = r + ob.r[i];
          if (dx * dx + dz * dz > rr * rr || out.length >= this.obPool.length) continue;
          const o = this.obPool[out.length];
          o.x = ob.x[i]; o.y = ob.y[i]; o.z = ob.z[i]; o.r = ob.r[i]; o.cap = ob.cap[i]; o.top = ob.top[i]; o.u = u; o.i = i;
          out.push(o);
        }
      }
    }
    return out;
  }

  /**
   * A truck bends obstacle i (its trunk, or a roadside thing's post) with `moment` N m at its foot, going (vx, vz):
   * if it gives way, its unit breaks (true).
   */
  strike(i, moment, vx, vz) {
    const u = this.ob.unit[i];
    if (u < 0 || this.broken[u] || !(moment >= this.ob.cap[i])) return false;
    this.breakUnit(u, vx, vz, true, false);
    return true;
  }

  /** Break a unit (a tree, or a roadside thing): it stops being in the way, and the game hears of it in `breaks`. */
  breakUnit(u, vx = 0, vz = 0, local = false, quiet = false) {
    if (u < 0 || u >= this.broken.length || this.broken[u]) return false;
    this.broken[u] = 1;
    const T = this.trees, tree = u < T.count, it = tree ? null : this.roadside[u - T.count];
    const v = Math.hypot(vx, vz), x = tree ? T.x[u] : it.x, z = tree ? T.z[u] : it.z;
    this.breaks.push({ key: tree ? 't' + u : 'o' + (u - T.count), tree: tree ? u : -1, item: tree ? -1 : u - T.count, x, y: tree ? T.y[u] : it.y, z, dx: v > 0.01 ? vx / v : 0, dz: v > 0.01 ? vz / v : 1, v, local, quiet });
    return true;
  }

  /** Break by key (a friend's break, or the room's list when joining); false if there is no such thing or it is gone. */
  breakKey(key, dx = 0, dz = 1, v = 0, quiet = false) {
    const m = /^([to])(\d{1,7})$/.exec(String(key));
    if (!m) return false;
    const u = m[1] === 't' ? Number(m[2]) : this.trees.count + Number(m[2]);
    if (m[1] === 't' && u >= this.trees.count) return false;
    return this.breakUnit(u, dx * v, dz * v, false, quiet);
  }

  /** Every broken unit's key (for the room). */
  brokenKeys() {
    const out = [], n = this.trees.count;
    for (let u = 0; u < this.broken.length; u++) if (this.broken[u]) out.push(u < n ? 't' + u : 'o' + (u - n));
    return out;
  }

  /** Nearest tree (not a wall post, not one too slender to hold the pull, not a broken one) within reach of a point, for the winch. */
  nearestTree(x, z, maxDist, filter = null) {
    const out = this.treesNear(x, z, maxDist, []);
    let best = null, bd = Infinity;
    for (const t of out) {
      if (t.i >= this.trees.count || t.cap < WINCH_CAP) continue;
      if (filter && !filter(t)) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) { bd = d; best = { ...t }; }
    }
    return best;
  }

  inBounds(x, z, margin = 0) { return Math.abs(x) < this.half - margin && Math.abs(z) < this.half - margin; }
}
