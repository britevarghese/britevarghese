// What the open world's new country is made of (world/maps/north.js, east.js, deccan.js): the stretches that fill the
// world out to one big map round the old ones, each a map of its own laid onto its neighbours' edges (maps/seams.js).
// Here: their shared shapes (distances to lines, a coastline's side), fields cut into parcels with their crops, and
// the planting of their trees.
import { fbm, vnoise } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { ASHWOOD } from './ashwood.js';
import { ROADS } from './countryRoads.js';

/**
 * A region's trails: each road's routed points (maps/countryRoads.js) with its kind and build; a road not routed yet is
 * left out. routes: name -> { via (waypoints the router goes through), grade, ...the trail's own fields }.
 */
export const trailsOf = (id, routes) => Object.entries(routes).filter(([name, r]) => r.points || ROADS[id]?.[name]).map(([name, r]) => {
  const { via, routeGrade, ...rest } = r;                                       // eslint-disable-line no-unused-vars
  return { name, points: r.points || ROADS[id][name], ...rest };
});

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hyp = (a, b) => Math.sqrt(a * a + b * b);
export const gauss = (d, w) => Math.exp(-((d / w) ** 2));
export { fbm, vnoise };

/** Distance from (x, z) to a polyline: { d, s (m along it), i (segment) }, one shared result. */
const near = { d: 0, s: 0, i: 0, side: 0 };
export function lineNear(pts, x, z) {
  let best = Infinity, arc = 0, bs = 0, bi = 0, side = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az, l2 = vx * vx + vz * vz, l = Math.sqrt(l2);
    const wx = x - ax, wz = z - az, t = clamp((wx * vx + wz * vz) / l2, 0, 1);
    const d = hyp(wx - vx * t, wz - vz * t);
    if (d < best) { best = d; bs = arc + t * l; bi = i; side = vx * wz - vz * wx; }
    arc += l;
  }
  near.d = best; near.s = bs; near.i = bi; near.side = Math.sign(side);
  return near;
}
export const lineD = (pts, x, z) => lineNear(pts, x, z).d;

/** A polyline's length (m). */
export const lineLength = (pts) => pts.reduce((a, p, i) => (i ? a + hyp(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

/** A point along a polyline, s m from its start: [x, z]. */
export function along(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const l = hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s <= l || i === pts.length - 1) { const t = clamp(s / l, 0, 1); return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)]; }
    s -= l;
  }
  return pts[pts.length - 1].slice();
}

const hash = (a, b, s) => { const h = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };

/**
 * Fields: the farmland cut into parcels on a grid turned to the bearing `rot` (rad), each `w` x `d` m, every row of
 * them shifted along by its own amount (so the boundaries don't run on in lines across the country), and each sown
 * with one of `crops` (by its weight: [[name, weight], ...]). at(x, z): { crop, edge (m to the parcel's boundary), u,
 * v (across and along its rows), id }, one shared result.
 */
export function fields({ rot = 0, w = 70, d = 110, crops, seed = 0 }) {
  const c = Math.cos(rot), s = Math.sin(rot), total = crops.reduce((a, [, k]) => a + k, 0);
  const out = { crop: null, edge: 0, u: 0, v: 0, id: 0 };
  return (x, z) => {
    const u = x * c + z * s, v = -x * s + z * c;
    const row = Math.floor(v / d), off = hash(row, 7, seed) * w, col = Math.floor((u + off) / w);
    // (some parcels twice as long: two of a row's run together)
    const pair = hash(row, col >> 1, seed + 3) < 0.3;
    const c0 = pair ? col & ~1 : col, fu = u + off - c0 * w, fw = pair ? 2 * w : w, fv = v - row * d;
    let r = hash(row, c0, seed + 1) * total, crop = crops[crops.length - 1][0];
    for (const [name, k] of crops) { if (r < k) { crop = name; break; } r -= k; }
    out.crop = crop; out.edge = Math.min(fu, fw - fu, fv, d - fv); out.u = fu; out.v = fv; out.id = row * 7919 + c0;
    return out;
  };
}

/**
 * The trees of a stretch: a candidate every `step` m (jittered), kept off the bare ground, the trails and the water,
 * the clearings and the courses; `rule(x, z, s, h, R)` says what grows there: [kind, height, trunk radius], or null.
 */
export function plant(ctx, step, rule) {
  const { surf, R, trees: T, clear, cellOf, trailD, trailW, waterAt, hAt, onCourse, H, half } = ctx;
  const add = (x, z, type, ht, r) => { T.x.push(x); T.y.push(hAt(x, z)); T.z.push(z); T.h.push(ht); T.r.push(r); T.type.push(type); };
  // (the clearings by 64 m cell, each in every cell it reaches)
  const CC = 64, cl = new Map();
  for (const q of clear) {
    for (let k = Math.floor((q[1] - q[2]) / CC); k <= Math.floor((q[1] + q[2]) / CC); k++) for (let i = Math.floor((q[0] - q[2]) / CC); i <= Math.floor((q[0] + q[2]) / CC); i++) {
      const key = k * 1000 + i;
      if (!cl.has(key)) cl.set(key, []);
      cl.get(key).push(q);
    }
  }
  for (let z = -half + 3; z < half - 3; z += step) {
    for (let x = -half + 3; x < half - 3; x += step) {
      const px = x + (R() - 0.5) * step * 0.9, pz = z + (R() - 0.5) * step * 0.9, roll = R();
      const idx = cellOf(px, pz), s = surf[idx];
      if (s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.ROAD || s === SURFACE.SNOW) continue;
      if (trailD(idx) < trailW(idx) + 5) continue;
      const wl = waterAt(px, pz);
      if (wl > -1e8 && H[idx] < wl + 0.4) continue;
      let blocked = false;
      for (const [cx, cz, cr] of cl.get(Math.floor(pz / CC) * 1000 + Math.floor(px / CC)) || []) if (Math.abs(px - cx) < cr && Math.abs(pz - cz) < cr && hyp(px - cx, pz - cz) < cr) { blocked = true; break; }
      if (blocked) continue;
      const t = rule(px, pz, s, H[idx], R, roll);
      if (!t || onCourse(px, pz)) continue;
      add(px, pz, t[0], t[1], t[2]);
    }
  }
}

// kinds of tree: the Kerala set's (0 coconut, 1 jungle giant, 2 mango/jack, 3 rubber, 4 banana, 5 bamboo) and
// Ashwood's (0 pine, 1 fir, 2 spruce, 3 birch, 4 snag)
export const TROPIC = { coconut: 0, giant: 1, mango: 2, rubber: 3, banana: 4, bamboo: 5 };
export const ALPINE = { pine: 0, fir: 1, spruce: 2, birch: 3, snag: 4 };
/** A tree of the Kerala set: [kind, height, trunk radius]. */
export function tropic(kind, R) {
  switch (kind) {
    case TROPIC.coconut: return [0, 10 + R() * 10, 0.17];
    case TROPIC.giant: { const h = 15 + R() * 13; return [1, h, 0.3 + h * 0.012]; }
    case TROPIC.rubber: return [3, 9 + R() * 6, 0.16];
    case TROPIC.banana: return [4, 3 + R() * 2.5, 0.12];
    case TROPIC.bamboo: return [5, 9 + R() * 7, 0.55];
    default: return [2, 8 + R() * 8, 0.28];
  }
}
/** A tree of the Ashwood set. */
export function alpine(kind, R) {
  const h = kind === ALPINE.birch ? 9 + R() * 7 : kind === ALPINE.snag ? 7 + R() * 6 : 11 + R() * 11;
  return [kind, h, kind === ALPINE.birch ? 0.14 + R() * 0.08 : 0.18 + h * 0.012 + R() * 0.06];
}

/** A tree of the canyon set (render/Vegetation.js): acacia (babul), thor (the candelabra spurge), a dead tree. */
export const DESERT = { acacia: 0, thor: 1, dead: 2 };
export function desert(kind, R) {
  switch (kind) {
    case DESERT.thor: return [1, 2.2 + R() * 2.6, 0.2];
    case DESERT.dead: return [2, 5 + R() * 4, 0.16 + R() * 0.06];
    default: { const h = 4.5 + R() * 5; return [0, h, 0.12 + h * 0.016]; }
  }
}

/** What a tropical stretch shares with the Konkan Coast (its trees, roadside, dust and mud), and an alpine one with Ashwood. */
export const TROPICAL = {
  litter: COAST.litter, treeStrength: COAST.treeStrength, young: COAST.young, roadside: COAST.roadside, dust: COAST.dust,
  mudTint: COAST.mudTint, ground: 'coast', trees: 'kerala', pads: COAST.pads, roadSurface: SURFACE.ROAD, puddles: 3,
};
export const HIGHLAND = {
  ...TROPICAL, trees: 'ashwood', treeStrength: ASHWOOD.treeStrength, young: ASHWOOD.young, litter: ASHWOOD.litter,
};

/** A stretch's map, with what every map has (none of it, where it has none of its own). */
export function stretch(def) {
  return {
    peaks: [], landmarks: [], beacons: [], events: [], races: [], modes: null, river: null, ...def,
    half: def.half ?? 1024, res: def.res ?? 2, coarse: def.coarse ?? 4, waterRes: def.waterRes ?? 2,
  };
}
