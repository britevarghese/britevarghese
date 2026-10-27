// Worn tracks: what years of trucks have done to a map's tracks (its trails; map.wornTracks). Two ruts worn into the
// bed where the wheels run, a little over a metre and a half apart and wandering from side to side down the track,
// deep in earth, shallow on gravel and hardly there on rock; the hump between them
// left standing, the grass growing on it (render/Terrain.js, render/Grass.js); the spoil a little proud of the ground
// beside them; and potholes across the track here and there. Worn as a stock truck can still drive: the ruts 5 to 15
// cm deep on earth, shallower in the mud (where trucks press their own deeper as they pass: world/Deform.js), so its
// axles clear the hump between them, and wandering only a little off the track's middle, so a truck keeping to it
// rides in them rather than with a wheel on the hump. Too fine for the ground's grid (a rut is 60 cm across):
// reckoned at each point from the track's line, for the physics (world/World.js terrain) and the renderer alike.
//
// Near a map's edge (where its track runs on into the next map's) the ruts run straight down the middle at an even
// depth and there are no potholes, so the two maps' ruts meet.
import { spline } from './WorldGen.js';
import { vnoise, hash2 } from './Noise.js';

const STEP = 2;                 // m between the points of a track's line
const CELL = 16;                // m: the buckets of segments
export const GAUGE = 0.8;       // m from the middle of the wheel line to each rut's middle
export const RUT = 0.3;         // m: half a rut's width
const REACH = 3.4;              // m off the line that anything reaches (the wander, the ruts and their spoil, potholes)
const EDGE = 40;                // m in from a map's edge the ruts come round to straight and even
const BIN = 28;                 // m of track to a pothole (at most)
const OUT = 2.6;                // m off the line past which nothing is worn (the wander, a rut's spoil, a pothole's side)
// how deep each ground wears (a track's ruts as deep as it is soft): none on tarmac or ice
const WEAR = [1, 1, 0.45, 0.15, 0.8, 0.6, 0.7, 0, 0.3, 0, 0.6];

// one rut, r off its middle: its floor, and the spoil pushed out of it a little proud of the ground either side
function rut(r, depth) {
  r = Math.abs(r);
  if (r < RUT) { const k = Math.cos(r / RUT * Math.PI / 2); return depth * k * k; }
  return r < RUT + 0.4 ? -depth * 0.18 * Math.sin((r - RUT) / 0.4 * Math.PI) : 0;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class WornTracks {
  /** map: the map's definition (its trails, in its own frame); half: its half-size. */
  constructor(map, half) {
    this.half = half;
    const xs = [], zs = [], ss = [], ts = [], lines = [];
    for (const tr of map.trails) {
      if (tr.kind !== 'trail' || tr.bridge) continue;
      const pts = spline(tr.points, STEP), t = lines.length, seed = 7919 * (t + 1);
      // (a track's end that is at the map's edge runs on into the next map: its ruts don't fade out there, but run
      // straight on over the edge, as its bed does, to meet the next map's)
      const atEdge = (q) => Math.max(Math.abs(q[0]), Math.abs(q[1])) > half - 12;
      const open0 = atEdge(pts[0]), open1 = atEdge(pts[pts.length - 1]);
      const on = (a, b) => { const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [1, 2, 3, 4, 5, 6, 7, 8].map((k) => [a[0] + (a[0] - b[0]) / l * STEP * k, a[1] + (a[1] - b[1]) / l * STEP * k]); };
      if (open0) pts.unshift(...on(pts[0], pts[1]).reverse());
      if (open1) pts.push(...on(pts[pts.length - 1], pts[pts.length - 2]));
      const start = xs.length;
      let s = 0;
      for (let p = 0; p < pts.length; p++) {
        if (p) s += Math.hypot(pts[p][0] - pts[p - 1][0], pts[p][1] - pts[p - 1][1]);
        xs.push(pts[p][0]); zs.push(pts[p][1]); ss.push(s); ts.push(t);
      }
      lines.push({ start, end: xs.length - 1, len: s, seed, open0, open1 });
    }
    this.x = Float64Array.from(xs); this.z = Float64Array.from(zs); this.s = Float64Array.from(ss); this.t = Int32Array.from(ts);
    this.lines = lines;
    // segments (by their first point) in buckets, each in every bucket within REACH of it: the buckets' lists one
    // after another in `items`, bucket b's from first[b] to first[b + 1]
    const n = this.n = Math.ceil((2 * half + 2 * CELL) / CELL), o = this.o = -half - CELL;
    const count = new Int32Array(n * n + 1);
    const each = (fn) => {
      for (const L of lines) {
        for (let p = L.start; p < L.end; p++) {
          const x0 = Math.min(this.x[p], this.x[p + 1]) - REACH, x1 = Math.max(this.x[p], this.x[p + 1]) + REACH;
          const z0 = Math.min(this.z[p], this.z[p + 1]) - REACH, z1 = Math.max(this.z[p], this.z[p + 1]) + REACH;
          for (let k = Math.max(0, Math.floor((z0 - o) / CELL)); k <= Math.min(n - 1, Math.floor((z1 - o) / CELL)); k++) {
            for (let i = Math.max(0, Math.floor((x0 - o) / CELL)); i <= Math.min(n - 1, Math.floor((x1 - o) / CELL)); i++) fn(k * n + i, p);
          }
        }
      }
    };
    each((b) => { count[b + 1]++; });
    for (let b = 0; b < n * n; b++) count[b + 1] += count[b];
    this.first = count;
    this.items = new Int32Array(count[n * n]);
    const fill = count.slice(0, n * n);
    each((b, p) => { this.items[fill[b]++] = p; });
    this.hit = { u: 0, s: 0, t: -1, d: 0, ax: 0, az: 0 };
    this.look = { u: 0, s: 0, depth: 0, W: 0, pot: 0, t: -1 };
    this.pots = new Float64Array(15);
  }

  /** Is anything worn within r of the square [x0, x0 + size] x [z0, z0 + size]? */
  near(x0, z0, size, r = 0) {
    const { n, o, first } = this;
    for (let k = Math.max(0, Math.floor((z0 - r - o) / CELL)); k <= Math.min(n - 1, Math.floor((z0 + size + r - o) / CELL)); k++) {
      for (let i = Math.max(0, Math.floor((x0 - r - o) / CELL)); i <= Math.min(n - 1, Math.floor((x0 + size + r - o) / CELL)); i++) if (first[k * n + i + 1] > first[k * n + i]) return true;
    }
    return false;
  }

  /**
   * The nearest track's line to (x, z), within REACH: into this.hit { u (m to the left of it, signed), s (m along it),
   * t (which track), d (|u|), ax, az (the way across it, to the left) }; null if none.
   */
  nearest(x, z) {
    const { n, o } = this, i = Math.floor((x - o) / CELL), k = Math.floor((z - o) / CELL);
    if (i < 0 || k < 0 || i >= n || k >= n) return null;
    const b = k * n + i, j0 = this.first[b], j1 = this.first[b + 1];
    if (j0 === j1) return null;
    const X = this.x, Z = this.z, items = this.items;
    let best = REACH * REACH, bp = -1, bt = 0;
    for (let j = j0; j < j1; j++) {
      const p = items[j], dx = X[p + 1] - X[p], dz = Z[p + 1] - Z[p], ex = x - X[p], ez = z - Z[p];
      let t = (ex * dx + ez * dz) / (dx * dx + dz * dz || 1);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ex - dx * t, qz = ez - dz * t, d2 = qx * qx + qz * qz;
      if (d2 < best) { best = d2; bp = p; bt = t; }
    }
    if (bp < 0) return null;
    const dx = X[bp + 1] - X[bp], dz = Z[bp + 1] - Z[bp], l = Math.sqrt(dx * dx + dz * dz) || 1, h = this.hit;
    // (the way across, to the left of the way along)
    h.ax = -dz / l; h.az = dx / l;
    h.u = (x - X[bp]) * h.ax + (z - Z[bp]) * h.az;
    h.s = this.s[bp] + bt * (this.s[bp + 1] - this.s[bp]);
    h.t = this.t[bp]; h.d = Math.sqrt(best);
    return h;
  }

  /** How freely the ruts wander and vary at (x, z): 0 at the map's edge, 1 from EDGE m in. */
  free(x, z) { return sstep(0, EDGE, this.half - Math.max(Math.abs(x), Math.abs(z))); }

  /**
   * The wear at (x, z) of track hit h (this.hit): into this.look { u (m off the wheel line's middle), s, depth (the
   * ruts' depth there, m, scaled by the ground: wear), W (m off the wheel line that the bare earth reaches), pot (the
   * potholes' depth at the point) }.
   */
  shape(h, x, z, wear) {
    const L = this.lines[h.t], s = h.s, f = this.free(x, z), q = this.look;
    // the wheel line wanders from side to side, over tens of metres; the ruts' depth and the bare earth's width vary
    const wander = ((vnoise(s / 31, 0.5, L.seed) * 2 - 1) * 0.18 + (vnoise(s / 9, 0.5, L.seed + 1) * 2 - 1) * 0.03) * f;
    const vary = vnoise(s / 17, 0.5, L.seed + 2);
    // (the ends of a track: fading in over 10 m, unless it runs on into the next map)
    const end = (L.open0 ? 1 : sstep(0, 10, s)) * (L.open1 ? 1 : sstep(0, 10, L.len - s));
    q.u = h.u - wander; q.s = s; q.t = h.t;
    q.depth = (0.1 * (1 - f) + f * (0.05 + 0.1 * vary)) * wear * end;
    q.W = GAUGE + RUT + 0.35 + f * (vnoise(s / 6, 0.5, L.seed + 3) - 0.3) * 0.7;
    q.pot = f > 0 ? this.potDepth(this.potsAt(L, s), s, q.u, wear * f) : 0;
    return q;
  }

  /**
   * The potholes within `reach` of s along track L (up to one a stretch, across the track or one side of it): into
   * this.pots, five numbers each (its middle off the wheel line, its half width, its depth, where it is along the track
   * and its half length); returns how many numbers.
   */
  potsAt(L, s, reach = 0) {
    const P = this.pots, b0 = Math.floor(s / BIN);
    let n = 0;
    for (let b = b0 - 1; b <= b0 + 1; b++) {
      if (hash2(b, L.seed, 31) > 0.55) continue;
      const c = (b + 0.2 + 0.6 * hash2(b, L.seed, 32)) * BIN, len = 1.1 + 1.1 * hash2(b, L.seed, 33);
      if (Math.abs(s - c) > len + reach) continue;
      P[n++] = (hash2(b, L.seed, 34) - 0.5) * 1.4; P[n++] = 0.7 + 0.6 * hash2(b, L.seed, 35);
      P[n++] = 0.05 + 0.08 * hash2(b, L.seed, 36); P[n++] = c; P[n++] = len;
    }
    return n;
  }

  /** Those potholes' depth (the first n numbers of this.pots) at s along, u off the wheel line, in ground that wears `wear`. */
  potDepth(n, s, u, wear) {
    const P = this.pots;
    let pot = 0;
    for (let i = 0; i < n; i += 5) {
      const along = Math.abs(s - P[i + 3]), across = Math.abs(u - P[i]);
      if (along > P[i + 4] || across > P[i + 1]) continue;
      const ca = Math.cos(along / P[i + 4] * Math.PI / 2), cc = Math.cos(across / P[i + 1] * Math.PI / 2);
      pot = Math.max(pot, P[i + 2] * ca * ca * cc * cc * wear);
    }
    return pot;
  }

  /** The ruts' and their spoil's depth (m, > 0 down) at u off the wheel line, for ruts `depth` deep. */
  static profile(u, depth) { return rut(u + GAUGE, depth) + rut(u - GAUGE, depth); }

  /**
   * The wear's depth (as depth gives it) added into out[0 .. 2n] at the 2n + 1 points step apart along (ax, az)
   * through (x, z), -n to n: a tyre's breadth and a little more, all off the same stretch of the nearest track (its
   * line, wander and depth found once, at (x, z); each point's own ground's wear).
   */
  across(x, z, ax, az, n, step, out, wearAt) {
    const h = this.nearest(x, z);
    if (!h || h.d > OUT + n * step) return out;
    // (each point's way off the track's line, and along it)
    const du = (ax * h.ax + az * h.az) * step, ds = (ax * h.az - az * h.ax) * step;
    const q = this.shape(h, x, z, 1), f = this.free(x, z), np = f > 0 ? this.potsAt(this.lines[h.t], q.s, Math.abs(ds) * n) : 0;
    for (let k = -n; k <= n; k++) {
      const u = h.u + k * du;
      if (Math.abs(u) > OUT) continue;
      const wear = wearAt(x + ax * k * step, z + az * k * step);
      if (wear <= 0) continue;
      const uw = q.u + k * du;
      out[k + n] += WornTracks.profile(uw, q.depth * wear) + (np ? this.potDepth(np, q.s + k * ds, uw, wear * f) : 0);
    }
    return out;
  }

  /** The wear's depth at (x, z) (m, > 0 down): of the nearest track, its ground's wear blended across the cells (wearAt). */
  depth(x, z, wearAt) {
    const h = this.nearest(x, z);
    if (!h || h.d > OUT) return 0;
    const wear = wearAt(x, z);
    if (wear <= 0) return 0;
    const q = this.shape(h, x, z, wear);
    return WornTracks.profile(q.u, q.depth) + q.pot;
  }
}

/** A ground's wear (how deep a track's ruts are worn in it, relative): by surface id. */
export const wearOf = (s) => WEAR[s] ?? 1;
