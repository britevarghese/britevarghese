// Route the new country's roads over its ground (world/maps/north.js, east.js, deccan.js) and write them to
// src/world/maps/countryRoads.js. Each road goes through its waypoints (`via`, in its region's frame); between each
// two the cheapest way over a grid of the region's ground, as a road builder would lay it: the length, more for every
// percent of grade (a lot more past the road's own grade), for turning, for water. Then smoothed.
//
//   node tools/routeroads.mjs [region ...]      (all of them without)
import fs from 'node:fs';
import { ROUTED } from '../src/world/maps/routed.js';
import { REGIONS } from '../src/world/maps/world.js';

const out = new URL('../src/world/maps/countryRoads.js', import.meta.url);
const only = process.argv.slice(2);
const { ROADS } = await import('../src/world/maps/countryRoads.js');
const roads = structuredClone(ROADS);

// 16 ways out of a cell: the 8 neighbours and the 8 knight's moves (smoother lines than 8 alone)
const DIRS = [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1], [-1, 2], [-1, 1], [-2, 1], [-1, 0], [-2, -1], [-1, -1], [-1, -2], [0, -1], [1, -2], [1, -1], [2, -1]];
const ANG = DIRS.map(([a, b]) => Math.atan2(b, a));
const turnOf = (d, e) => { const t = Math.abs(ANG[e] - ANG[d]); return t > Math.PI ? 2 * Math.PI - t : t; };

class Heap {
  constructor() { this.k = []; this.v = []; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

/**
 * The cheapest way from a to b over the grid (the region's heights every `step` m): { path: [[x, z], ...], dir (the
 * way it arrives) }. dir0: the way it must leave a (going on from the last leg through a waypoint), or -1 for any;
 * dirEnd: the way it must come into b, or -1 for any. ends: the road's own two ends (near them it may come to the
 * region's edge, where it crosses into the next).
 */
function route(R, G, a, b, grade, kind, dir0, ends, dirEnd = -1) {
  const { n, step, half, H, cost } = G;
  const cell = ([x, z]) => [Math.round((x + half) / step), Math.round((z + half) / step)];
  const [ai, ak] = cell(a), [bi, bk] = cell(b);
  const N = n * n * 16, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  const heap = new Heap(), hx = (i, k) => Math.hypot(i - bi, k - bk) * step;
  // (off the region's edges, where the seams' blending moves the ground under it, but near its own ends)
  const edgeCost = (i, k) => {
    const x = i * step - half, z = k * step - half, e = half - Math.max(Math.abs(x), Math.abs(z));
    if (e > 70) return 0;
    for (const [ex, ez] of ends) if (Math.hypot(x - ex, z - ez) < 120) return 0;
    return (70 - e) * 0.6;
  };
  for (let d = 0; d < 16; d++) { if (dir0 >= 0 && d !== dir0) continue; const s = (ak * n + ai) * 16 + d; g[s] = 0; heap.push(hx(ai, ak), s); }
  const turnK = kind === 'road' ? 22 : 8;
  let end = -1;
  while (heap.size) {
    const s = heap.pop(), c = s >> 4, d = s & 15, i = c % n, k = (c - i) / n;
    if (i === bi && k === bk && (dirEnd < 0 || turnOf(d, dirEnd) < 0.45)) { end = s; break; }
    const gs = g[s];
    for (let e = 0; e < 16; e++) {
      const turn = turnOf(d, e);
      if (turn > 1.2) continue;                                                     // (no sharper than a hairpin's steps)
      const ii = i + DIRS[e][0], kk = k + DIRS[e][1];
      if (ii < 0 || kk < 0 || ii >= n || kk >= n) continue;
      const c2 = kk * n + ii, L = Math.hypot(DIRS[e][0], DIRS[e][1]) * step;
      const gr = Math.abs(H[c2] - H[c]) / L;
      let w = L * (1 + 2.5 * (gr / grade) ** 2) + turnK * turn * turn * step + (cost[c2] + edgeCost(ii, kk)) * L;
      if (gr > grade) w += L * 600 * (gr - grade);
      const s2 = c2 * 16 + e, t = gs + w;
      if (t < g[s2]) { g[s2] = t; from[s2] = s; heap.push(t + hx(ii, kk), s2); }
    }
  }
  if (end < 0) throw new Error(`${R.id}: no way from ${a} to ${b}`);
  const path = [];
  for (let s = end; s >= 0; s = from[s]) { const c = s >> 4, i = c % n; path.push([i * step - half, (c - i) / n * step - half]); }
  path.reverse();
  path[0] = a.slice(0, 2); path[path.length - 1] = b.slice(0, 2);
  return { path, dir: end & 15 };
}

/** Ramer-Douglas-Peucker: the points the line can't do without within tol m. */
function simplify(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let best = 0, bi = -1;
    const [ax, az] = p[a], vx = p[b][0] - ax, vz = p[b][1] - az, l = Math.hypot(vx, vz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i][0] - ax) * vz - (p[i][1] - az) * vx) / l; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
/** Chaikin's corner cutting, its ends kept. */
function chaikin(p, times) {
  for (let t = 0; t < times; t++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

// Where a road meets the edge of its region it carries straight on across it into the next region's road: the way the
// next one's goes there where that one is laid by hand (the old maps' spurs), else square across the edge (both sides
// routed, both square). (dx, dz) the way into the region, from its end on the edge.
const routed = (id, name) => ROUTED.some((Q) => Q.id === id && Q.routes[name]);
function intoRegion(R, [x, z]) {
  const half = R.half;
  if (half - Math.max(Math.abs(x), Math.abs(z)) > 2) return null;
  const at = REGIONS.find((Q) => Q.id === R.id).at, wx = x + at[0], wz = z + at[1];
  for (const Q of REGIONS) {
    if (Q.id === R.id) continue;
    for (const t of Q.map.trails) {
      if (routed(Q.id, t.name)) continue;
      const p = t.points;
      for (const j of [0, 1]) {
        const a = j ? p[p.length - 1] : p[0];
        if (Math.hypot(a[0] + Q.at[0] - wx, a[1] + Q.at[1] - wz) > 3) continue;
        // (a point some 25 m back along it: the way it comes up to the edge)
        let k = j ? p.length - 2 : 1;
        while (k > 0 && k < p.length - 1 && Math.hypot(p[k][0] - a[0], p[k][1] - a[1]) < 25) k += j ? -1 : 1;
        const dx = a[0] - p[k][0], dz = a[1] - p[k][1], l = Math.hypot(dx, dz);
        return [dx / l, dz / l];
      }
    }
  }
  return Math.abs(x) > Math.abs(z) ? [-Math.sign(x), 0] : [0, -Math.sign(z)];
}
const APPROACH = 45;
const nearestDir = ([dx, dz]) => { const a0 = Math.atan2(dz, dx); return ANG.reduce((b, t, i) => (Math.abs(Math.atan2(Math.sin(t - a0), Math.cos(t - a0))) < Math.abs(Math.atan2(Math.sin(ANG[b] - a0), Math.cos(ANG[b] - a0))) ? i : b), 0); };

for (const R of ROUTED) {
  if (only.length && !only.includes(R.id)) continue;
  await R.load?.();
  const step = R.step ?? 5, half = R.half, n = Math.round(2 * half / step) + 1;
  const H = new Float32Array(n * n), cost = new Float32Array(n * n);
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const x = i * step - half, z = k * step - half;
    H[k * n + i] = R.ground(x, z);
    cost[k * n + i] = R.avoid ? R.avoid(x, z, H[k * n + i]) : 0;
  }
  const G = { n, step, half, H, cost };
  roads[R.id] = roads[R.id] || {};
  for (const [name, r] of Object.entries(R.routes)) {
    const t0 = Date.now();
    // its ends on the region's edges carried straight on across them (a waypoint APPROACH m in, the way across)
    const via = r.via.map((p) => p.slice()), n0 = via.length;
    const inA = intoRegion(R, via[0]), inB = intoRegion(R, via[n0 - 1]);
    if (inA) via.splice(1, 0, [via[0][0] + inA[0] * APPROACH, via[0][1] + inA[1] * APPROACH]);
    if (inB) via.splice(via.length - 1, 0, [via[via.length - 1][0] + inB[0] * APPROACH, via[via.length - 1][1] + inB[1] * APPROACH]);
    // (leaving its start towards its first waypoint: free to set off any way, a road started off round a loop)
    let pts = [], dir = nearestDir([via[1][0] - via[0][0], via[1][1] - via[0][1]]);
    const ends = [via[0], via[via.length - 1]], nv = via.length;
    for (let w = 0; w < nv - 1; w++) {
      // (a leg laid straight, whatever the ground: an approach to an edge, or one its waypoint marks so ([x, z, 1]: on
      // to the next in a line, as through a fort's gates); its grade is the bed's to even out, world/maps/seams.js. The
      // leg before one comes into it already going its way.)
      const isStraight = (q) => (inA && q === 0) || (inB && q === nv - 2) || (q >= 0 && q < nv - 1 && via[q][2] === 1);
      const straight = isStraight(w);
      const dirEnd = isStraight(w + 1) ? nearestDir([via[w + 2][0] - via[w + 1][0], via[w + 2][1] - via[w + 1][1]]) : -1;
      const leg = straight ? { path: [via[w].slice(0, 2), via[w + 1].slice(0, 2)], dir: nearestDir([via[w + 1][0] - via[w][0], via[w + 1][1] - via[w][1]]) }
        : route(R, G, via[w], via[w + 1], r.routeGrade ?? r.grade ?? (r.kind === 'road' ? 0.12 : 0.28), r.kind, dir, ends, dirEnd);
      pts.push(...(w ? leg.path.slice(1) : leg.path));
      dir = leg.dir;
    }
    pts = chaikin(simplify(pts, step * 0.6), 3);
    pts = simplify(pts, 0.35).map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
    // its grade over 20 m, as laid on the region's ground (before it is graded)
    let worst = 0, at = null;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const g = l > 4 ? Math.abs(R.ground(...pts[i]) - R.ground(...pts[i - 1])) / l : 0;
      if (g > worst) { worst = g; at = pts[i].map(Math.round); }
    }
    // (and how near it comes to itself further along: a waypoint it overshot and came back to lays it over itself; a
    // hairpin's two legs part as they leave it)
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let close = Infinity, cat = null;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      if (arc[j] - arc[i] < 80) continue;
      const d = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (d < close) { close = d; cat = pts[i].map(Math.round); }
    }
    roads[R.id][name] = pts;
    console.log(`${R.id}: ${name}: ${pts.length} points, steepest ${(worst * 100).toFixed(0)}% at (${at}), nearest itself ${close.toFixed(0)} m at (${cat})${close < 12 ? ' OVER ITSELF' : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

const lines = ['// The new country\'s roads (world/maps/north.js, east.js, deccan.js), routed over its ground by tools/routeroads.mjs:',
  '// region id -> road name -> its points in the region\'s own frame. Generated: run the tool again after changing a',
  '// region\'s ground or a road\'s waypoints.', 'export const ROADS = {'];
for (const [id, rs] of Object.entries(roads)) {
  lines.push(`  ${id}: {`);
  for (const [name, pts] of Object.entries(rs)) lines.push(`    '${name}': [${pts.map(([x, z]) => `[${x}, ${z}]`).join(', ')}],`);
  lines.push('  },');
}
lines.push('};', '');
fs.writeFileSync(out, lines.join('\n'));
