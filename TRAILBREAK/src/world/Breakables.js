// What a truck can break: trees slender enough to give way, the young trees growing along the trails, and the
// roadside things (fences, trail posts, signs, barrels, crates, woodpiles).
//
// A trunk gives way when the truck bends it harder than its wood takes: the push at each contact times its height up
// the trunk, against about C d^3 at its foot for a trunk d across (green wood's strength in bending, over the trunk's
// section modulus, pi d^3 / 32). A 10 cm sapling goes at walking pace, a 30 cm palm or birch to a truck at town
// speeds, the forest giants never. Each map says how its kinds of tree take it (map.treeStrength: a dead snag is
// brittle, a banana's stem is water and leaf).
//
// The young trees and the roadside things are added here, once the map is made (its own seed: the map itself stays as
// it is): the young trees join the map's trees (after its own, from trees.base on); each roadside thing stands on the
// ground as a few upright posts to hit (the obstacles physics/Vehicle.js meets, as it meets trunks), and breaks as one.
//
// Pure logic: runs in Node for the tests.
import { SURFACE } from '../physics/Surfaces.js';
import { rng } from './Noise.js';
import { courseLines, slalomLine } from '../game/Events.js';
import { MAP_HALF } from './maps/index.js';

/** Green wood in bending, as a truck meets it: what a trunk d across takes at its foot is C d^3 (N m). */
export const WOOD_C = 4e6;
/** Trunks that take more than this stand: a truck crumples on them before they go (N m; a pine over 50 cm, a giant). */
const UNBREAKABLE = 5e5;
/** The winch only hooks round a trunk that holds its pull: one that takes at least this (N m, at the strap). */
export const WINCH_CAP = 6e4;

/** What a trunk of radius r of a map's tree type takes (N m), or Infinity. */
export function trunkCap(map, type, r) {
  const k = map?.treeStrength?.[type] ?? 1;
  const cap = WOOD_C * (2 * r) ** 3 * k;
  return cap > UNBREAKABLE ? Infinity : cap;
}

// ---------------------------------------------------------------- the roadside things
/**
 * Each kind: its obstacles (in its own frame: u along it, from -len/2 to len/2) as [u, r, top, cap], and what it is
 * (the renderer draws it, and throws its pieces when it breaks).
 */
export const ROADSIDE = {
  rail: { name: 'split-rail fence', len: 2.8 },        // two posts and two rails; posts at both ends
  bamboo: { name: 'bamboo fence', len: 2.6 },          // bamboo poles lashed to two posts
  marker: { name: 'trail marker post' },
  sign: { name: 'trail sign', len: 1.3 },
  barrel: { name: 'barrel' },
  drum: { name: 'water drum' },
  crate: { name: 'crate' },
  woodpile: { name: 'woodpile', len: 2.2 },
};

/** The obstacles of a roadside thing: [{ u, r, top, cap }] along its length. */
export function obstaclesOf(item) {
  const L = item.len || 0;
  switch (item.kind) {
    case 'rail': case 'bamboo': {
      const post = item.kind === 'rail' ? [0.075, 1.15, 3500] : [0.055, 1.25, 1800], rail = item.kind === 'rail' ? [0.06, 1.05, 2000] : [0.05, 1.15, 1100];
      const out = [{ u: -L / 2, r: post[0], top: post[1], cap: post[2] }, { u: L / 2, r: post[0], top: post[1], cap: post[2] }];
      const n = Math.max(1, Math.round(L / 0.6) - 1);
      for (let k = 1; k <= n; k++) out.push({ u: -L / 2 + L * k / (n + 1), r: rail[0], top: rail[1], cap: rail[2] });
      return out;
    }
    case 'marker': return [{ u: 0, r: 0.06, top: 1.25, cap: 2200 }];
    case 'sign': return [-0.6, -0.2, 0.2, 0.6].map((u, k) => ({ u, r: k % 3 ? 0.05 : 0.07, top: 2.0, cap: 2800 }));
    case 'barrel': return [{ u: 0, r: 0.3, top: 0.9, cap: 150 }];
    case 'drum': return [{ u: 0, r: 0.3, top: 0.9, cap: 100 }];
    case 'crate': return [{ u: 0, r: 0.42, top: 0.8, cap: 900 }];
    case 'woodpile': return [-0.75, 0, 0.75].map((u) => ({ u, r: 0.35, top: 1.0, cap: 1800 }));
    default: return [];
  }
}

// ---------------------------------------------------------------- helpers
const segDist = (x, z, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

/** Line segments in a coarse grid, for "how far is the nearest one" (less a half-width each). */
function segGrid(lines, cell = 32) {
  const cells = new Map(), segs = [];
  for (const { points, w } of lines) {
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1], [bx, bz] = points[k], s = segs.length;
      segs.push([ax, az, bx, bz, w]);
      const pad = w + 40;
      for (let cz = Math.floor((Math.min(az, bz) - pad) / cell); cz <= Math.floor((Math.max(az, bz) + pad) / cell); cz++) {
        for (let cx = Math.floor((Math.min(ax, bx) - pad) / cell); cx <= Math.floor((Math.max(ax, bx) + pad) / cell); cx++) {
          const key = cz * 4096 + cx;
          let l = cells.get(key);
          if (!l) cells.set(key, (l = []));
          l.push(s);
        }
      }
    }
  }
  /** Distance from (x, z) to the nearest line's edge (its centre less its half-width); Infinity beyond 40 m or so. */
  return (x, z) => {
    const l = cells.get(Math.floor(z / cell) * 4096 + Math.floor(x / cell));
    if (!l) return Infinity;
    let best = Infinity;
    for (const s of l) { const [ax, az, bx, bz, w] = segs[s]; best = Math.min(best, segDist(x, z, ax, az, bx, bz) - w); }
    return best;
  };
}

/** The map's trees in a grid, for the nearest one and how many stand round a point. */
function treeGrid(T, n, cell = 8) {
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.floor(T.z[i] / cell) * 8192 + Math.floor(T.x[i] / cell);
    let l = cells.get(key);
    if (!l) cells.set(key, (l = []));
    l.push(i);
  }
  return (x, z, rad, fn) => {
    for (let cz = Math.floor((z - rad) / cell); cz <= Math.floor((z + rad) / cell); cz++) {
      for (let cx = Math.floor((x - rad) / cell); cx <= Math.floor((x + rad) / cell); cx++) {
        const l = cells.get(cz * 8192 + cx);
        if (l) for (const i of l) fn(i, Math.hypot(T.x[i] - x, T.z[i] - z));
      }
    }
  };
}

/** The map's trails with their half-widths (the map's definitions, matched by name). */
function trailsOf(data) {
  const M = data.map, defs = new Map((M.trails || []).map((t) => [t.name, t]));
  return (data.trails || []).map((t) => ({ name: t.name, kind: t.kind, points: t.points, w: defs.get(t.name)?.width ?? 2.2 }));
}

/** Places nothing may go: the buildings, beacons, the station and where you start. */
function clearZones(data) {
  const M = data.map, z = [];
  for (const L of data.landmarks || []) z.push([L.x, L.z, L.type === 'station' ? 30 : 13]);
  for (const b of data.beacons || []) z.push([b.x, b.z, 10]);
  if (M.station) z.push([M.station.x, M.station.z, 30]);
  if (M.spawn) z.push([M.spawn.x, M.spawn.z, 22]);
  return (x, z0) => z.some(([cx, cz, r]) => Math.abs(x - cx) < r && Math.abs(z0 - cz) < r && Math.hypot(x - cx, z0 - cz) < r);
}

// ---------------------------------------------------------------- young trees
/**
 * The young trees along the trails' edges and in the gaps of the woods round them, added to the map's trees (once:
 * trees.base marks where the map's own end). world: terrain, water, surfaceId.
 */
export function growYoung(data, world) {
  const T = data.trees;
  if (T.base !== undefined) return 0;
  T.base = T.count;
  const M = data.map, Y = M?.young;
  if (!Y) return 0;
  const R = rng(((M.seed | 0) ^ 0x5eed) + 7121);
  const edge = segGrid(trailsOf(data)), courses = segGrid([...courseLines(M), slalomLine(M)].filter(Boolean).map((points) => ({ points, w: 0 })));
  const blocked = clearZones(data), near = treeGrid(T, T.count);
  const allowed = new Set(Y.on || [SURFACE.GRASS, SURFACE.DIRT]);
  const add = { x: [], y: [], z: [], r: [], h: [], type: [] }, mine = new Map();
  const tryAt = (x, z, maxEdge) => {
    if (Math.abs(x) > MAP_HALF - 20 || Math.abs(z) > MAP_HALF - 20) return;
    const e = edge(x, z);
    if (e < 0.5 || e > maxEdge || courses(x, z) < 7 || blocked(x, z)) return;
    if (!allowed.has(world.surfaceId(x, z))) return;
    const g = world.terrain(x, z);
    if (world.water(x, z) > g - 0.3) return;
    // the woods round it: how many trees, the nearest's kind (the young ones are its kind), room to grow
    let count = 0, nearest = -1, nd = Infinity, crowded = false;
    near(x, z, 14, (i, d) => {
      if (d < 14) count++;
      if (d < nd) { nd = d; nearest = i; }
      if (d < T.r[i] + 1.1) crowded = true;
    });
    if (crowded) return;
    const forest = Math.min(1, count / 6), chance = (maxEdge < 5 ? Y.edge : Y.wood) * (Y.open + (1 - Y.open) * forest);
    if (R() > chance) return;
    const type = Y.from[nearest >= 0 && nd < 22 ? T.type[nearest] : Y.alone];
    if (type === null || type === undefined) return;
    const key = Math.floor(z / 1.6) * 8192 + Math.floor(x / 1.6);
    for (const k of [key, key - 1, key + 1, key - 8192, key + 8192]) if (mine.has(k) && Math.hypot(mine.get(k)[0] - x, mine.get(k)[1] - z) < 1.6) return;
    mine.set(key, [x, z]);
    const [h0, h1] = Y.h[type] || Y.h.default, h = h0 + (h1 - h0) * R() ** 1.4;
    add.x.push(x); add.y.push(g); add.z.push(z); add.h.push(h); add.type.push(type);
    add.r.push(Y.r?.[type] ? Y.r[type](h) : 0.012 + 0.0085 * h);
  };
  for (const tr of trailsOf(data)) {
    for (let k = 1; k < tr.points.length; k++) {
      const [ax, az] = tr.points[k - 1], [bx, bz] = tr.points[k], L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
      for (let s = 0; s < L; s += 6) {
        const px = ax + ux * s, pz = az + uz * s;
        // along the edges: within a few metres of the track
        for (const side of [-1, 1]) {
          const o = tr.w + 0.6 + R() * 2.8, j = (R() - 0.5) * 4;
          tryAt(px + ux * j - uz * o * side, pz + uz * j + ux * o * side, 4);
        }
        // and in the woods round it
        for (let n = 0; n < 2; n++) {
          const side = R() < 0.5 ? -1 : 1, o = tr.w + 5 + R() * 27, j = (R() - 0.5) * 6;
          tryAt(px + ux * j - uz * o * side, pz + uz * j + ux * o * side, 40);
        }
      }
    }
  }
  const n0 = T.count, n1 = n0 + add.x.length;
  for (const k of ['x', 'y', 'z', 'r', 'h']) { const a = new Float32Array(n1); a.set(T[k]); a.set(add[k], n0); T[k] = a; }
  const ty = new Uint8Array(n1); ty.set(T.type); ty.set(add.type, n0); T.type = ty;
  T.count = n1;
  return add.x.length;
}

// ---------------------------------------------------------------- roadside things
/**
 * The roadside things of a map (its map.roadside style): [{ kind, x, y, z, yaw, len, text }], each on the ground
 * (its posts' feet at the ground under each). world: terrain, water, surfaceId.
 */
export function placeRoadside(data, world) {
  const M = data.map, S = M?.roadside;
  if (!S) return [];
  const R = rng(((M.seed | 0) ^ 0xfe1ce) + 313);
  const trails = trailsOf(data), edge = segGrid(trails);
  const courses = segGrid([...courseLines(M), slalomLine(M)].filter(Boolean).map((points) => ({ points, w: 0 })));
  const T = data.trees, near = treeGrid(T, T.base ?? T.count);
  const posts = data.posts || [];
  const items = [];
  const clear = (x, z, r) => {
    if (Math.abs(x) > MAP_HALF - 20 || Math.abs(z) > MAP_HALF - 20) return false;
    if (world.water(x, z) > world.terrain(x, z) - 0.25 || courses(x, z) < 6) return false;
    const s = world.surfaceId(x, z);
    if (s === SURFACE.MUD || s === SURFACE.RIVERBED || s === SURFACE.SAND) return false;
    let ok = true;
    near(x, z, r + 1.5, (i, d) => { if (d < T.r[i] + r + 0.4) ok = false; });
    for (const p of posts) if (Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3 && Math.hypot(p.x - x, p.z - z) < p.r + r + 0.5) { ok = false; break; }
    return ok;
  };
  const put = (kind, x, z, yaw, extra = {}) => {
    const it = { kind, x, z, yaw, len: ROADSIDE[kind].len || 0, ...extra };
    // every post of it clear of trees, water and the courses, and off the tracks (a fence beside one, not on it)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const o of obstaclesOf(it)) {
      const px = x + o.u * s, pz = z + o.u * c;
      if (!clear(px, pz, o.r) || edge(px, pz) < (extra.edge ?? 0.6)) return null;
    }
    it.y = world.terrain(x, z);
    delete it.edge;
    items.push(it);
    return it;
  };
  const along = (tr, from, to, step, fn) => {
    // walk a trail's line from arc length `from` to `to` in steps: the point there and the line's direction
    const P = tr.points;
    let k = 1, acc = 0;
    for (let a = from; a <= to; a += step) {
      while (k < P.length) {
        const seg = Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
        if (acc + seg >= a) break;
        acc += seg; k++;
      }
      if (k >= P.length) return;
      const [ax, az] = P[k - 1], [bx, bz] = P[k], L = Math.hypot(bx - ax, bz - az) || 1, t = (a - acc) / L;
      fn(ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / L, (bz - az) / L, a);
    }
  };
  const lengthOf = (tr) => { let L = 0; for (let k = 1; k < tr.points.length; k++) L += Math.hypot(tr.points[k][0] - tr.points[k - 1][0], tr.points[k][1] - tr.points[k - 1][1]); return L; };
  const fenceRun = (tr, from, to, kind, side, gapEvery = 9) => {
    const L = ROADSIDE[kind].len;
    let n = 0;
    along(tr, from, to, L, (x, z, ux, uz) => {
      if (++n % gapEvery === 0) return;                                  // (a gate, a gap)
      const o = tr.w + 1.5;
      put(kind, x + ux * L / 2 - uz * o * side, z + uz * L / 2 + ux * o * side, Math.atan2(ux, uz));
    });
  };

  // fences: along the road out of the station and beside the tracks by the homes
  for (const tr of trails) {
    const total = lengthOf(tr);
    for (const L of data.landmarks || []) {
      if (!S.fenceBy.includes(L.type)) continue;
      // the stretch of this trail near the building
      let a0 = Infinity, a1 = -Infinity, acc = 0;
      for (let k = 1; k < tr.points.length; k++) {
        const [ax, az] = tr.points[k - 1], [bx, bz] = tr.points[k], seg = Math.hypot(bx - ax, bz - az);
        const d = segDist(L.x, L.z, ax, az, bx, bz);
        if (d < S.fenceReach) { a0 = Math.min(a0, acc); a1 = Math.max(a1, acc + seg); }
        acc += seg;
      }
      if (a0 > a1) continue;
      const side = (() => {                                              // the side the building is on
        let best = 1, bd = Infinity;
        along(tr, a0, a1, 4, (x, z, ux, uz) => { const d = Math.hypot(L.x - x, L.z - z); if (d < bd) { bd = d; best = Math.sign(-uz * (L.x - x) + ux * (L.z - z)) || 1; } });
        return best;
      })();
      if (S.fenceBoth) { fenceRun(tr, Math.max(0, a0), Math.min(total, a1), S.fence, 1); fenceRun(tr, Math.max(0, a0), Math.min(total, a1), S.fence, -1); } else fenceRun(tr, Math.max(0, a0), Math.min(total, a1), S.fence, side);
    }
  }
  // trail marker posts every so often along the trails, and a sign at each end of each
  for (const tr of trails) {
    const total = lengthOf(tr);
    if (S.markers && tr.kind !== 'road') {
      let n = 0;
      along(tr, 60, total - 40, S.markers, (x, z, ux, uz) => { const side = n++ % 2 ? 1 : -1, o = tr.w + 1.0; put('marker', x - uz * o * side, z + ux * o * side, Math.atan2(ux, uz)); });
    }
    for (const at of [8, total - 8]) {
      along(tr, at, at + 0.1, 1, (x, z, ux, uz) => {
        const o = tr.w + 2.4;
        for (const side of [1, -1]) {
          if (put('sign', x - uz * o * side, z + ux * o * side, Math.atan2(ux, uz) + Math.PI / 2, { text: tr.name, edge: 1.2 })) break;   // (across the way: read coming up it)
        }
      });
    }
  }
  // by the buildings: barrels, crates, woodpiles (in each building's own frame, a ring outside its walls)
  for (const L of data.landmarks || []) {
    const kinds = S.byBuilding[L.type];
    if (!kinds) continue;
    const c = Math.cos(L.yaw || 0), s = Math.sin(L.yaw || 0);
    let placed = 0;
    for (let tryN = 0; tryN < 40 && placed < kinds.length; tryN++) {
      const kind = kinds[placed], a = R() * Math.PI * 2, d = (S.ring[L.type] || 7.5) + R() * 3;
      const lx = Math.sin(a) * d, lz = Math.cos(a) * d;
      const x = L.x + lx * c + lz * s, z = L.z - lx * s + lz * c;
      if (put(kind, x, z, (L.yaw || 0) + (R() - 0.5) * 0.6, { edge: 1.5 })) placed++;
    }
  }
  return items;
}

/** A roadside thing's obstacles in the world: [{ x, y, z, r, top, cap }]. */
export function placedObstacles(it, terrain) {
  const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
  return obstaclesOf(it).map((o) => {
    const x = it.x + o.u * s, z = it.z + o.u * c;
    return { x, y: terrain(x, z), z, r: o.r, top: o.top, cap: o.cap };
  });
}
