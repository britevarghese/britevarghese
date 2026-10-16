// Kerala: a corner of the Western Ghats, laid out for off-roading. World axes: +x east, +z south, +y up, metres.
//
// The high ranges fill the north: rolling tea estates on a plateau that climbs to Kurinji Top, grassland on the
// summits and dark shola forest in the folds. The Ponmala river rises on the plateau to the north-east and drops over
// the escarpment in the Thoovanam cascade, then winds south-west across the valley between flooded paddy fields and
// out of the map. The forest station and the village sit on the valley floor; Anapara, a bare granite dome, stands to
// the east; the midlands to the west and south are red laterite hills under rubber and coconut, with a laterite
// quarry and a reservoir.
//
// The generator (world/WorldGen.js) builds the common ground (the landform, the river, the trails) and calls the
// hooks in `gen` below for what only Kerala has: zones (tea, shola, rubber, paddy, the dome, the quarry, homesteads)
// worked out on a 4 m grid, the paddies' terraces and bunds and their water, the ground of each zone, granite
// boulders, and its trees.
import { fbm, ridged, vnoise, rng } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';

export const SEED = 2716;
const S = SEED;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);

// ---------------------------------------------------------------- the landform
// summits: centre, height above the land round them, radius
export const PEAKS = [
  { x: -170, z: -740, h: 150, r: 260, name: 'Kurinji Top' },
  { x: -560, z: -620, h: 110, r: 260 },
  { x: 230, z: -780, h: 120, r: 240 },
  { x: 620, z: -880, h: 100, r: 300 },
  { x: -860, z: -260, h: 80, r: 260 },
  { x: 880, z: -380, h: 90, r: 280 },
  { x: -640, z: 120, h: 55, r: 230 },
  { x: -260, z: 620, h: 45, r: 250 },
  { x: 300, z: 520, h: 50, r: 240 },
  { x: 760, z: 640, h: 60, r: 280 },
];
// Anapara: a bare granite dome, a field of boulders at the foot of its west slab
export const DOME = { x: 600, z: 140, r: 115, h: 72 };
export const GARDEN = { x: 372, z: 192, r: 55 };
// the laterite quarry: a pit cut into a hillside (centre, half-sizes, turn)
// (square to the compass: its sheer faces run along the ground's 1 m grid, so they stand cut clean)
export const QUARRY = { x: 215, z: 655, hw: 34, hd: 22, yaw: 0 };
// the rainwater pond in the pit's floor (in the pit's frame): its dish's half-axes and depth, and how far under the
// floor the water stands (so the water's edge is a contour of the dish, the ground wet only down in it)
const POND = { u: 12, v: -8, a: 17, b: 11.5, depth: 0.9, level: 0.5 };
// the ramp the lorries use, left uncut along the pit's west face (in the pit's frame): from the road at the top of the
// face down to the floor
const RAMP = { u0: -34, u1: -27, v0: -24, v1: 14 };

let WX = 0, WZ = 0;
/** The landform's warp (sets WX, WZ). */
function warp(x, z) {
  WX = x + 80 * fbm(x / 620, z / 620, 2, S + 1);
  WZ = z + 80 * fbm(x / 620 + 4.1, z / 620 - 2.9, 2, S + 2);
}

/**
 * How far up onto the high ranges (0 in the midlands, 1 on the plateau) from warped coordinates. The escarpment's line
 * wanders, and so does its width: sheer in places, elsewhere long spurs, the broadest north of the station, which the
 * estate road climbs.
 */
function plateauW(wx, wz) {
  const edgeZ = -330 + 80 * fbm(wx / 420, 0.5, 3, S + 5);
  let width = 430 + 260 * fbm(wx / 260, 3.3, 2, S + 8);
  const spur = Math.exp(-(((wx + 40) / 190) ** 2));
  width = Math.max(220, lerp(width, 820, spur));
  return smoothstep(edgeZ + width * 0.35, edgeZ - width * 0.65, wz);
}
export function plateauAt(x, z) { warp(x, z); return plateauW(WX, WZ); }

/** Anapara's rise over the land round it (m): a lopsided whaleback, its long west flank a slab of bare granite. */
export function domeAt(x, z) {
  const dx = x - DOME.x, dz = z - DOME.z;
  if (dx * dx + dz * dz > (DOME.r * 2.3) ** 2) return 0;
  const a = Math.atan2(dz, dx), west = Math.max(0, -Math.cos(a - 0.15));
  const rr = DOME.r * (1 + 0.18 * Math.cos(a - 0.6) * Math.cos(a - 0.6) + 0.1 * fbm(Math.cos(a) * 1.5, Math.sin(a) * 1.5, 2, S + 30) + 0.75 * west * west);
  const dd = hyp(dx * 0.85, dz) / rr;
  if (dd >= 1) return 0;
  // (the west flank a plain ramp of rock rather than the dome's rounded shoulder)
  return DOME.h * lerp(Math.pow(1 - dd * dd, 1.25), Math.pow(1 - dd, 1.15), west * west);
}

/** The ground before the river valley is carved. */
export function baseHeight(x, z) {
  warp(x, z);
  const wx = WX, wz = WZ;
  // the midlands: crowded laterite hills, round-topped and steep-sided, with flat valley floors between them
  const hill = fbm(wx / 260, wz / 260, 4, S + 3);
  let h = 52 + 34 * hill + 26 * Math.max(0, hill) ** 1.5 + 9 * fbm(wx / 95, wz / 95, 3, S + 4);
  // the high ranges: north of the escarpment (its line wanders, spurs run down it and ravines cut back into it) the
  // land stands ~190 m higher
  h += plateauW(wx, wz) * (190 + 45 * fbm(wx / 380, wz / 380, 3, S + 6));
  // the summits: round-shouldered and steep-sided, the Ghats' grassy tops
  let mount = 0;
  for (const p of PEAKS) {
    const dx = wx - p.x, dz = wz - p.z, d2 = (dx * dx + dz * dz) / (p.r * p.r);
    if (d2 > 4) continue;
    mount += p.h * Math.exp(-d2 * 2.0);
  }
  if (mount > 0.5) h += mount * (0.75 + 0.35 * ridged(wx / 300, wz / 300, 4, S + 10));
  h += domeAt(x, z);
  // the walls round the edge: forested ridges
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e > 850) h += smoothstep(850, 1180, e) * (210 + 130 * ridged(x / 240, z / 240, 4, S + 20));
  return h;
}

/** How rough the ground is at a height: the high ranges and the edges more than the valley. */
export const roughOf = (h) => clamp((h - 60) / 220, 0.18, 1);

// the river: from the plateau in the north-east, over the escarpment (the cascade), across the valley to the south-west.
// A shallow, braided stretch below the village is the river run.
export const RIVER = {
  points: [[1150, -950], [900, -800], [720, -720], [600, -580], [470, -500], [390, -420], [330, -370], [290, -300], [240, -230], [150, -190], [60, -150], [-30, -150], [-110, -95], [-160, -10], [-250, 40], [-330, 110], [-350, 200], [-410, 290], [-500, 340], [-560, 430], [-640, 520], [-780, 570], [-900, 660], [-1030, 760], [-1180, 860]],
  widthStart: 10, widthEnd: 22, depthStart: 1.2, depthEnd: 2.0,
  fords: [[20, -150]],
  falls: [{ x: 300, z: -335 }],
  smooth: 60,
  // below the escarpment the valley opens out: a broad, flat floor for the paddy fields
  valleyAt: (s) => { const k = smoothstep(0.36, 0.46, s); return [lerp(160, 230, k), lerp(14, 100, k)]; },
  shallows: [{ x: -345, z: 165, r: 75, depth: 0.12, widen: 0.9 }],
  bank: 0.012,                                       // the valley floor beside it nearly level (for the paddies)
};

export const LAKE = { x: -390, z: 770, r: 105, lobes: 0.35 };
export const STATION = { x: 40, z: 60, name: 'Ponmala Forest Station' };
// the tea factory's estate: tea all round it
const ESTATE = { x: 60, z: -650, r: 170 };
export const SPAWN = { x: 40, z: 82, yaw: Math.PI };

// ---------------------------------------------------------------- zones
export const ZONE = { OPEN: 0, TEA: 1, SHOLA: 2, RUBBER: 3, PADDY: 4, GRASSLAND: 5, DOME: 6, QUARRY: 7, VILLAGE: 8, BANK: 9 };
const ZC = 4;                                   // zone grid (m)
// paddy plots: a grid along the valley (u down it, v across), each plot flat at its own level, bunds between
const PHI = Math.atan2(750, -880), PC = Math.cos(PHI), PS = Math.sin(PHI);
const PU = 34, PV = 24, BUND = 0.3, BUND_SIDE = 1.3, BUND_H = 0.25;
const plotOf = (x, z) => [Math.floor((x * PC + z * PS) / PU), Math.floor((-x * PS + z * PC) / PV)];
const plotKey = (pu, pv) => (pu + 2048) * 4096 + (pv + 2048);

/** A point in the quarry pit's frame. */
function quarryUV(x, z) {
  const c = Math.cos(QUARRY.yaw), s = Math.sin(QUARRY.yaw), dx = x - QUARRY.x, dz = z - QUARRY.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}
/** How far a point is outside the quarry pit's rectangle (< 0 inside). */
function quarryOut(x, z) {
  const [u, v] = quarryUV(x, z);
  return Math.max(Math.abs(u) - QUARRY.hw, Math.abs(v) - QUARRY.hd);
}
/** Where a point is in the pond's dish: < 1 inside its rim (0 at the middle). */
function pondE(x, z) {
  const [u, v] = quarryUV(x, z);
  return ((u - POND.u) / POND.a) ** 2 + ((v - POND.v) / POND.b) ** 2;
}

function zoneAt(K, x, z) {
  const i = clamp(Math.round((x - K.origin) / ZC), 0, K.ZN - 1), k = clamp(Math.round((z - K.origin) / ZC), 0, K.ZN - 1);
  return K.zone[k * K.ZN + i];
}

/** Work out the zones on the 4 m grid, the paddy plots and their levels, and the quarry floor. */
function prepare(c) {
  const { K, coarseAt, LF, origin, half } = c;
  const ZN = Math.round(half * 2 / ZC) + 1;
  Object.assign(K, { origin, ZN, zone: new Uint8Array(ZN * ZN), plots: new Map() });
  const fallS = (() => { const n = LF.riverNear(RIVER.falls[0].x, RIVER.falls[0].z); return n.s; })();
  for (let k = 0; k < ZN; k++) {
    const z = origin + k * ZC;
    for (let i = 0; i < ZN; i++) {
      const x = origin + i * ZC;
      const h = coarseAt(x, z);
      const sl = hyp(coarseAt(x + 4, z) - coarseAt(x - 4, z), coarseAt(x, z + 4) - coarseAt(x, z - 4)) / 8;
      const P = plateauAt(x, z);
      const r = LF.riverNear(x, z);
      let zn = ZONE.OPEN;
      if (domeAt(x, z) > 1.5) zn = ZONE.DOME;
      else if (Math.max(Math.abs(x), Math.abs(z)) > 900 + 50 * fbm(x / 120, z / 120, 2, S + 63)) zn = ZONE.SHOLA;   // the forested ridges round the edge
      else if (quarryOut(x, z) < 3) zn = ZONE.QUARRY;
      else if (P > 0.8) {
        // the high ranges: grassland on the tops, shola in the hollows, along the streams and on the steepest
        // ground, tea everywhere else
        let mean = 0;
        for (let a = 0; a < 8; a++) mean += coarseAt(x + Math.cos(a * 0.785) * 45, z + Math.sin(a * 0.785) * 45) / 8;
        const hollow = mean - h, patch = fbm(x / 210, z / 210, 3, S + 60);
        const estate = hyp(x - ESTATE.x, z - ESTATE.z) < ESTATE.r;           // (round the factory: all tea)
        if (h > 372 + 18 * fbm(x / 90, z / 90, 2, S + 61)) zn = ZONE.GRASSLAND;
        else if (!estate && (hollow > 4.5 || patch > 0.32 || r.d < 55 || sl > 0.95)) zn = ZONE.SHOLA;
        else zn = ZONE.TEA;
      } else if (P > 0.06) zn = ZONE.SHOLA;                          // the escarpment's evergreen forest
      else {
        const st = hyp(x - STATION.x, z - STATION.z);
        if (r.s > fallS + 0.03 && r.d < 175 && r.d > 18 && h < r.level + 8 && sl < 0.12) zn = ZONE.PADDY;
        else if (st < 230 + 40 * fbm(x / 80, z / 80, 2, S + 62)) zn = ZONE.VILLAGE;
        else if (r.d < 55) zn = ZONE.BANK;
        else if (x < 120 && st > 280 && sl < 0.8 && fbm(x / 280, z / 280, 3, S + 70) > -0.08) zn = ZONE.RUBBER;
      }
      K.zone[k * ZN + i] = zn;
    }
  }
  // paddy plots: wholly on paddy ground (every sample point), each levelled at its mean less a little
  const seen = new Set();
  for (let k = 0; k < ZN; k++) for (let i = 0; i < ZN; i++) {
    if (K.zone[k * ZN + i] !== ZONE.PADDY) continue;
    const [pu, pv] = plotOf(origin + i * ZC, origin + k * ZC), key = plotKey(pu, pv);
    if (seen.has(key)) continue;
    seen.add(key);
    let ok = true, sum = 0, n = 0;
    for (let a = 0; a <= 4 && ok; a++) for (let b = 0; b <= 4 && ok; b++) {
      const u = (pu + a / 4) * PU, v = (pv + b / 4) * PV, x = u * PC - v * PS, z = u * PS + v * PC;
      if (zoneAt(K, x, z) !== ZONE.PADDY) ok = false;
      else { sum += coarseAt(x, z); n++; }
    }
    if (ok) K.plots.set(key, { pu, pv, floor: sum / n - 0.3 });
  }
  // the quarry floor: just under the lowest ground at its rim, so its low side is open
  let rim = Infinity;
  for (let a = 0; a < 48; a++) {
    const t = a / 48 * Math.PI * 2, c2 = Math.cos(QUARRY.yaw), s2 = Math.sin(QUARRY.yaw);
    const u = Math.cos(t) * (QUARRY.hw + 4) * 1.05, v = Math.sin(t) * (QUARRY.hd + 4) * 1.05;
    rim = Math.min(rim, coarseAt(QUARRY.x + u * c2 - v * s2, QUARRY.z + u * s2 + v * c2));
  }
  K.quarryFloor = rim - 0.4;
  // the swept yards of bare red earth (the muttam) in front of the houses and the chai stall: [x, z, r]
  K.yards = LANDMARKS.filter((L) => L.type === 'house' || L.type === 'chaistall').map((L) => {
    const f = L.type === 'house' ? 7 : 3.5;
    return [L.x + Math.sin(L.yaw) * f, L.z + Math.cos(L.yaw) * f, L.type === 'house' ? 5.5 : 4];
  });
  const top = (RAMP.u0 + RAMP.u1) / 2;
  K.rampTop = coarseAt(QUARRY.x + top * Math.cos(QUARRY.yaw) - RAMP.v0 * Math.sin(QUARRY.yaw), QUARRY.z + top * Math.sin(QUARRY.yaw) + RAMP.v0 * Math.cos(QUARRY.yaw));
}

/** The plot at a point, its local edge distance and the floor of the plot across the nearest edge. */
function paddyAt(K, x, z) {
  const u = x * PC + z * PS, v = -x * PS + z * PC, pu = Math.floor(u / PU), pv = Math.floor(v / PV);
  const p = K.plots.get(plotKey(pu, pv));
  if (!p) return null;
  const fu = u - pu * PU, fv = v - pv * PV;
  const e = [fu, PU - fu, fv, PV - fv];
  let m = 0;
  for (let q = 1; q < 4; q++) if (e[q] < e[m]) m = q;
  const nb = K.plots.get(plotKey(pu + (m === 0 ? -1 : m === 1 ? 1 : 0), pv + (m === 2 ? -1 : m === 3 ? 1 : 0)));
  return { p, e: e[m], nb };
}

/** Bund and floor: the ground in a paddy plot. */
function paddyHeight(K, x, z, h) {
  const q = paddyAt(K, x, z);
  if (!q) return h;
  const f0 = q.p.floor, nb = q.nb ? q.nb.floor : f0, top = Math.max(f0, nb) + BUND_H;
  if (q.e < BUND) return top;
  // down into a plot a terrace lower, a bank as wide as the step needs
  const side = BUND_SIDE + 2.5 * Math.max(0, nb - f0);
  if (q.e < BUND + side) return lerp(top, f0, (q.e - BUND) / side);
  return f0 + 0.03 * (vnoise(x / 3, z / 3, S + 80) - 0.5);
}

// ---------------------------------------------------------------- the generator's hooks
// colliders of Kerala's buildings (rows of posts along their walls, in their own frame)
const box = (hw, hd) => (L, wall) => { wall(L, -hw, -hd, hw, -hd); wall(L, hw, -hd, hw, hd); wall(L, hw, hd, -hw, hd); wall(L, -hw, hd, -hw, -hd); };
const WALLS = {
  teafactory: box(13, 6.5), bungalow: box(6, 5), chaistall: box(2.2, 1.6), house: box(4.2, 3.4), laterite: box(1.6, 1),
  busstop: (L, wall) => { for (const [a, b] of [[-1.8, -0.8], [1.8, -0.8]]) wall(L, a, b, a, b, 0.2); },
};

const gen = {
  prepare,
  walls: WALLS,
  // roads cross the paddies on embankments
  trailFloor(x, z, K) {
    if (zoneAt(K, x, z) !== ZONE.PADDY) return -Infinity;
    const q = paddyAt(K, x, z);
    return q ? Math.max(q.p.floor, q.nb ? q.nb.floor : -Infinity) + 0.65 : -Infinity;
  },
  // smooth hillsides under the tea and on the granite; the rest keeps its bumps
  detail(x, z, K) {
    const zn = zoneAt(K, x, z);
    return zn === ZONE.TEA ? 0.35 : zn === ZONE.DOME ? 0.45 : zn === ZONE.PADDY ? 0.2 : 1;
  },
  fine(x, z, h, K) {
    const zn = zoneAt(K, x, z);
    if (zn === ZONE.PADDY) return paddyHeight(K, x, z, h);
    if (zn === ZONE.QUARRY) {
      // the pit: cut down to the floor, its faces sheer; a shallow dish in the floor holds the rain, and the ramp
      // down the west face is left standing
      const o = quarryOut(x, z), e = pondE(x, z), [u, v] = quarryUV(x, z);
      let floor = K.quarryFloor + 0.08 * fbm(x / 6, z / 6, 2, S + 81) - (e < 1 ? POND.depth * (1 - e) ** 1.5 : 0);
      const ramp = lerp(K.rampTop, K.quarryFloor, clamp((v - RAMP.v0) / (RAMP.v1 - RAMP.v0), 0, 1));
      floor = Math.max(floor, lerp(floor, ramp, smoothstep(RAMP.u1 + 2.5, RAMP.u1, u)));
      if (o < 1.5) return Math.min(h, lerp(floor, h, smoothstep(-0.5, 1.5, o)));
    }
    return h;
  },
  // paddy water: a hand's depth over the mud of every plot (not on the bunds, nor where a road runs through)
  water(ctx) {
    const { K, setWater, cellOf, trailD, trailW } = ctx;
    for (const p of K.plots.values()) {
      // every point of the water grid (2 m) inside the plot
      const cs = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => { const u = (p.pu + a) * PU, v = (p.pv + b) * PV; return [u * PC - v * PS, u * PS + v * PC]; });
      const x0 = Math.floor(Math.min(...cs.map((c) => c[0])) / 2) * 2, x1 = Math.max(...cs.map((c) => c[0]));
      const z0 = Math.floor(Math.min(...cs.map((c) => c[1])) / 2) * 2, z1 = Math.max(...cs.map((c) => c[1]));
      for (let x = x0; x <= x1; x += 2) for (let z = z0; z <= z1; z += 2) {
        const q = paddyAt(K, x, z);
        if (!q || q.p !== p || q.e < BUND + 0.4) continue;
        const idx = cellOf(x, z);
        if (trailD(idx) < trailW(idx) + 1) continue;
        setWater(x, z, p.floor + 0.15);
      }
    }
    // rainwater standing in the quarry's pond (over the whole dish: its shore is where the floor comes up out of it)
    const c2 = Math.cos(QUARRY.yaw), s2 = Math.sin(QUARRY.yaw);
    for (let a = -POND.a - 2; a <= POND.a + 2; a += 2) for (let b = -POND.b - 2; b <= POND.b + 2; b += 2) {
      const u = POND.u + a, v = POND.v + b;
      const x = QUARRY.x + u * c2 - v * s2, z = QUARRY.z + u * s2 + v * c2;
      if (pondE(x, z) < 1) setWater(x, z, K.quarryFloor - POND.level);
    }
  },
  surface(x, z, h, sl, s, idx, ctx) {
    const K = ctx.K;
    // ragged edges between zones
    const jx = x + 5 * (vnoise(x / 7, z / 7, S + 90) - 0.5), jz = z + 5 * (vnoise(x / 7 + 3.3, z / 7, S + 91) - 0.5);
    const zn = zoneAt(K, jx, jz);
    // the quarry: red laterite, its faces cut sheer, wet mud round the pond
    const qo = quarryOut(x, z);
    if (qo < 2) return qo < 0 && pondE(x, z) < 0.8 + 0.2 * vnoise(x / 4, z / 4, S + 93) ? SURFACE.MUD : SURFACE.DIRT;
    // the river's margins: sand and shingle, or bare granite where it runs through the forest on the hills
    if (s === SURFACE.SAND || s === SURFACE.GRAVEL) return zn === ZONE.SHOLA && vnoise(x / 5, z / 5, S + 98) > 0.3 ? SURFACE.ROCK : s;
    if (zoneAt(K, x, z) === ZONE.PADDY) {
      const q = paddyAt(K, x, z);
      if (q) return q.e < BUND + BUND_SIDE * 0.6 ? SURFACE.GRASS : SURFACE.MUD;
    }
    switch (zn) {
      case ZONE.DOME: return domeAt(x, z) > 2.5 && vnoise(x / 9, z / 9, S + 95) < 0.86 ? SURFACE.ROCK : s === SURFACE.ROCK ? s : vnoise(x / 6, z / 6, S + 92) > 0.6 ? SURFACE.GRAVEL : s;
      // (the cuttings for the estate's tracks and buildings: red earth)
      case ZONE.TEA: return sl > 0.95 ? (s === SURFACE.ROCK && sl > 1.3 ? s : SURFACE.DIRT) : SURFACE.TEA;
      // forest on the escarpment, in the hollows and on the ridges round the edge: bare rock only on the sheerest
      // faces
      case ZONE.SHOLA: return s === SURFACE.ROCK && sl < 1.25 + 0.4 * vnoise(x / 13, z / 13, S + 96) ? SURFACE.GRASS : s;
      case ZONE.OPEN: case ZONE.VILLAGE: case ZONE.RUBBER: case ZONE.BANK:
        // the midlands' steep cuttings and banks are red laterite, not granite
        if (s === SURFACE.ROCK && sl < 1.45) return SURFACE.DIRT;
        // bare red laterite: the swept yards in front of the houses, and here and there a small patch (not the
        // generic blotches)
        if (s === SURFACE.DIRT) s = SURFACE.GRASS;
        if (s === SURFACE.GRASS && sl < 0.35) {
          for (const [yx, yz, r] of K.yards) if (hyp(x - yx, z - yz) < r * (0.85 + 0.3 * vnoise(x / 3, z / 3, S + 97))) return SURFACE.DIRT;
          if (vnoise(x / 4.5, z / 4.5, S + 94) > 0.93) return SURFACE.DIRT;
        }
        return s;
      default: return s;
    }
  },
  // granite: a field of boulders round Anapara's foot, big rounded ones down the cascade, outcrops on the tops
  boulders(ctx, addBoulder) {
    const R = rng(S + 300), { K, cellOf, trailD, riverD, riverHalf, onCourse } = ctx;
    const ok = (x, z) => { const idx = cellOf(x, z); return trailD(idx) > 4.5 && !onCourse(x, z, 6); };
    // the boulder field at the foot of the slab: the trials go through it
    for (let n = 0; n < 360; n++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * GARDEN.r, size = 0.6 + R() * 0.9 + R() * R() * 1.3;
      const x = GARDEN.x + Math.cos(a) * d, z = GARDEN.z + Math.sin(a) * d;
      if (ok(x, z)) addBoulder(x, z, size, 0.22 + R() * 0.22, R);
    }
    for (let n = 0; n < 320; n++) {
      const a = R() * Math.PI * 2, d = DOME.r * (0.8 + 0.7 * Math.sqrt(R())), size = 0.5 + R() * 1.0 + R() * R() * 1.4;
      const x = DOME.x + Math.cos(a) * d / 0.85, z = DOME.z + Math.sin(a) * d;
      if (ok(x, z)) addBoulder(x, z, size, 0.25 + R() * 0.2, R);
    }
    const pts = ctx.riverFine;
    // the cascade: big rounded boulders down its channel and on its banks, the water tumbling between them
    const esc = pts.filter(([x, z]) => { const P = plateauAt(x, z); return P > 0.06 && P < 0.9; });
    for (let n = 0; n < 420 && esc.length; n++) {
      const p = esc[Math.floor(R() * esc.length)], w = riverHalf(cellOf(p[0], p[1])) + 5;
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * w, size = 0.7 + R() * 1.2 + R() * R() * 1.8;
      const x = p[0] + Math.cos(a) * d, z = p[1] + Math.sin(a) * d;
      if (ok(x, z)) addBoulder(x, z, size, 0.35 + R() * 0.15, R);
    }
    for (let n = 0; n < 900; n++) {
      const p = pts[Math.floor(R() * pts.length)], x = p[0] + (R() - 0.5) * 30, z = p[1] + (R() - 0.5) * 30, size = 0.6 + R() * R() * 2.2;
      const idx = cellOf(x, z), P = plateauAt(x, z);
      if (riverD(idx) > riverHalf(idx) + 6 || R() > (P > 0.05 && P < 0.95 ? 0.9 : 0.12)) continue;
      if (ok(x, z)) addBoulder(x, z, size, 0.4, R);
    }
    for (let n = 0; n < 3000; n++) {
      const x = (R() * 2 - 1) * 990, z = -1000 + R() * 700;
      if (zoneAt(K, x, z) !== ZONE.GRASSLAND || R() > 0.08) continue;
      if (ok(x, z)) addBoulder(x, z, 0.5 + R() * R() * 1.8, 0.45, R);
    }
  },
  trees(ctx) {
    const { K, H, surf, R, trees: T, clear, cellOf, trailD, trailW, riverD, riverHalf, waterAt, hAt, onCourse } = ctx;
    const add = (x, z, type, ht, r) => { T.x.push(x); T.y.push(hAt(x, z)); T.z.push(z); T.h.push(ht); T.r.push(r); T.type.push(type); };
    // (the rock trials weave through boulders, not trees: its line and its start are kept clear)
    const trials = EVENTS.find((e) => e.kind === 'slalom'), tl = [trials.start, ...trials.gates];
    const onTrials = (x, z) => {
      if (hyp(x - tl[0][0], z - tl[0][1]) < 14) return true;
      for (let k = 1; k < tl.length; k++) {
        const [ax, az] = tl[k - 1], [bx, bz] = tl[k], dx = bx - ax, dz = bz - az;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        if (hyp(x - ax - dx * t, z - az - dz * t) < 6) return true;
      }
      return false;
    };
    const blocked = (x, z, pad = 3.2) => {
      const idx = cellOf(x, z);
      if (trailD(idx) < trailW(idx) + pad || riverD(idx) < riverHalf(idx) + 3) return true;
      const wl = waterAt(x, z);
      if (wl > -1e8 && H[idx] < wl + 0.3) return true;
      for (const [cx, cz, cr] of clear) if (Math.abs(x - cx) < cr && Math.abs(z - cz) < cr && hyp(x - cx, z - cz) < cr) return true;
      return onCourse(x, z) || onTrials(x, z);
    };
    const bare = (s) => s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.GRAVEL || s === SURFACE.ROCK;
    // kinds: 0 coconut, 1 jungle giant, 2 mango/jack, 3 rubber (and the tea's shade trees), 4 banana, 5 bamboo
    const coconut = (x, z) => add(x, z, 0, 10 + R() * 10, 0.17);
    const jungle = (x, z) => { const ht = 20 + R() * 14; add(x, z, 1, ht, 0.35 + ht * 0.012); };
    const mango = (x, z) => add(x, z, 2, 8 + R() * 8, 0.28);
    const banana = (x, z) => add(x, z, 4, 3 + R() * 2.2, 0.1);
    const bamboo = (x, z) => add(x, z, 5, 9 + R() * 7, 0.55);
    const STEP = 4;
    for (let z = K.origin + 3; z < -K.origin - 3; z += STEP) {
      for (let x = K.origin + 3; x < -K.origin - 3; x += STEP) {
        const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9, roll = R(), pick = R();
        const idx = cellOf(px, pz), s = surf[idx];
        if (bare(s)) continue;
        const zn = zoneAt(K, px, pz), nearRiver = riverD(idx) < riverHalf(idx) + 25;
        const patch = fbm(px / 140, pz / 140, 2, S + 100);
        let dens = 0;
        switch (zn) {
          case ZONE.TEA: dens = 0.009; break;                                  // the estates' shade trees
          case ZONE.SHOLA: dens = 0.62 + 0.2 * patch; break;
          case ZONE.GRASSLAND: dens = 0.012; break;
          case ZONE.VILLAGE: dens = 0.16 + 0.1 * patch; break;
          case ZONE.BANK: dens = 0.4; break;
          case ZONE.OPEN: dens = 0.2 + 0.25 * patch; break;
          case ZONE.DOME: dens = 0.02; break;
          default: dens = 0;
        }
        if (roll > dens || blocked(px, pz)) continue;
        if (zn === ZONE.TEA) { add(px, pz, 2, 13 + pick * 6, 0.24); continue; }
        if (zn === ZONE.SHOLA) { if (nearRiver && pick < 0.5) bamboo(px, pz); else if (pick < 0.55) jungle(px, pz); else mango(px, pz); continue; }
        if (zn === ZONE.GRASSLAND || zn === ZONE.DOME) { mango(px, pz); continue; }
        if (zn === ZONE.BANK) { if (pick < 0.4) coconut(px, pz); else if (pick < 0.8) bamboo(px, pz); else mango(px, pz); continue; }
        // farmland and homesteads: coconut above all, banana, mango and jack, the odd big tree and bamboo clump
        if (pick < 0.48) coconut(px, pz);
        else if (pick < (zn === ZONE.VILLAGE ? 0.72 : 0.58)) banana(px, pz);
        else if (pick < 0.86) mango(px, pz);
        else if (pick < 0.94) jungle(px, pz);
        else bamboo(px, pz);
      }
    }
    // rubber estates: rows across the slope, 6.5 m apart, a tree every 3.5 m
    const ra = 0.55, rc = Math.cos(ra), rs = Math.sin(ra);
    for (let a = -1500; a < 1500; a += 6.5) {
      for (let b = -1500; b < 1500; b += 3.5) {
        const x = a * rc - b * rs + (R() - 0.5) * 0.6, z = a * rs + b * rc + (R() - 0.5) * 0.6;
        if (Math.abs(x) > -K.origin - 4 || Math.abs(z) > -K.origin - 4) continue;
        if (zoneAt(K, x, z) !== ZONE.RUBBER) continue;
        const s = surf[cellOf(x, z)];
        if (bare(s) || blocked(x, z, 2.5) || R() < 0.06) continue;
        add(x, z, 3, 12 + R() * 5, 0.15);
      }
    }
    // coconut palms along the paddies' outer bunds, where the fields meet the higher ground
    for (const p of K.plots.values()) {
      for (const [du, dv, along] of [[-1, 0, 'v'], [1, 0, 'v'], [0, -1, 'u'], [0, 1, 'u']]) {
        if (K.plots.has(plotKey(p.pu + du, p.pv + dv))) continue;
        const n = along === 'v' ? 3 : 4;
        for (let q = 0; q < n; q++) {
          if (R() < 0.35) continue;
          const t = (q + 0.3 + R() * 0.4) / n;
          const u = (p.pu + (du === 1 ? 1 : 0) + (along === 'u' ? t : 0)) * PU + du * 2.2, v = (p.pv + (dv === 1 ? 1 : 0) + (along === 'v' ? t : 0)) * PV + dv * 2.2;
          const x = u * PC - v * PS, z = u * PS + v * PC;
          if (!blocked(x, z, 2)) coconut(x, z);
        }
      }
    }
  },
};

// ---------------------------------------------------------------- the layout
// Roads and tracks, routed over the ground by a trail designer (A* with a grade limit and a cost for turning, so the
// legs run long and the hairpins are few). The estate road crosses the river on a concrete causeway; the paddy and
// rubber track fords it at the shallows.
export const TRAILS = [
  { name: 'Estate Road', kind: 'road', width: 3.4, grade: 0.2, ford: 0.2, points: [
    [40, 28], [33, 0], [26, -40], [21, -80], [20, -110], [20, -128], [21, -168], [24, -181],
    [28, -190], [31, -200], [34, -209], [37, -219], [40, -228], [42, -238], [41, -248], [37, -258],
    [31, -265], [23, -272], [15, -277], [6, -282], [-3, -286], [-13, -288], [-23, -288], [-33, -288],
    [-43, -288], [-53, -288], [-63, -288], [-73, -288], [-83, -288], [-92, -285], [-102, -283], [-112, -279],
    [-121, -276], [-130, -273], [-140, -269], [-149, -265], [-158, -262], [-168, -259], [-178, -256], [-187, -255],
    [-197, -252], [-207, -249], [-216, -246], [-225, -242], [-234, -238.6], [-241.4, -236.5], [-245.9, -236.9], [-249.3, -238.3],
    [-252.5, -240.4], [-255.1, -243.9], [-257.2, -248.5], [-257.5, -252.7], [-256.6, -256.7], [-254, -260.9], [-247.6, -266.2], [-240, -272],
    [-232, -278], [-225, -285], [-223, -290], [-223.2, -294.9], [-224.2, -299], [-226.6, -302.7], [-228.2, -306.3], [-228.7, -310.1],
    [-228.3, -313.9], [-227.1, -317.7], [-224.2, -321.3], [-219.9, -325], [-214, -329], [-204, -330], [-194, -330], [-184, -332],
    [-175, -336], [-166, -341], [-157, -345], [-148, -350], [-140, -356], [-132, -362], [-125, -369], [-118, -376],
    [-111, -383], [-103, -389], [-94, -394], [-85, -398], [-76, -402], [-66, -405], [-57, -409], [-52.4, -413],
    [-49.4, -416.9], [-48.2, -420.7], [-47.9, -424.4], [-48.5, -427.9], [-49.9, -431.3], [-52.5, -434.5], [-57.4, -437.1], [-66, -438],
    [-76, -435], [-85, -433], [-95, -432], [-105, -434], [-115, -437], [-124, -441], [-131, -448], [-137, -456],
    [-143, -464], [-150, -472], [-157, -478], [-166, -483], [-176, -485], [-185.1, -483.8], [-194.6, -481.6], [-201.6, -483],
    [-207.5, -485.1], [-211.1, -488.2], [-213.4, -491.9], [-214.2, -495.8], [-213.8, -500], [-211.7, -504.3], [-208.6, -508.7], [-202, -513],
    [-192, -517], [-183, -520], [-173, -523], [-163, -524], [-153, -525], [-144, -528], [-135, -532], [-127, -538],
    [-119, -545], [-112, -551], [-104, -557], [-96, -563], [-87, -567], [-77, -570], [-67, -571], [-57, -570],
    [-47, -571], [-38, -574], [-28, -576], [-18, -579], [-9, -580], [1, -578], [11, -575], [20, -571],
    [29, -566], [38, -562], [47, -558], [57, -555], [66, -554], [76, -556], [86, -558], [96, -560],
    [106, -560], [116, -557], [121.7, -557.4], [126.7, -558.3], [130.3, -560.4], [133.3, -562.8], [135.5, -566.2], [136.9, -570.1],
    [136.9, -575.3], [136, -581], [130, -589], [123, -596], [115, -600], [105, -602], [95, -603], [85, -606],
    [77, -611], [69, -618], [62, -625], [57, -633], [53, -642], [50, -650],
  ] },
  { name: 'Kurinji Jeep Track', kind: 'trail', width: 2.2, points: [
    [50, -650], [59, -646], [69, -643], [79, -642], [88, -645], [95, -652], [100, -661], [104, -670], [107, -680],
    [108, -690], [104, -699], [99, -707], [91, -714], [84, -720], [76, -727], [68, -733], [61, -740], [56, -748],
    [50, -757], [45, -765], [36, -771], [27, -773], [17, -775], [7, -776], [-3, -775], [-12, -772], [-22, -769],
    [-31, -765], [-40, -761], [-49, -756], [-57, -751], [-66, -745], [-74, -740], [-83, -735], [-91, -730], [-100, -725],
    [-109, -720], [-118, -716], [-127, -712], [-136, -708], [-146, -704], [-155, -702], [-165, -700], [-175, -701], [-185, -703],
    [-195, -704], [-205, -706], [-214, -710], [-223, -715], [-231, -720], [-239, -726], [-245, -734], [-248, -743], [-246, -753],
    [-242, -762], [-237, -771], [-232, -780], [-226, -788], [-220, -795], [-212, -802], [-204, -808], [-196, -813], [-186, -817],
    [-177, -821], [-168, -825], [-159, -829], [-149, -832], [-140, -835], [-130, -835], [-121, -831], [-115, -823], [-112, -814],
    [-112, -804], [-116, -795], [-124, -788], [-133, -784], [-142, -784],
  ] },
  { name: 'High Range Track', kind: 'trail', width: 2.1, points: [
    [50, -650], [41, -653], [31, -656], [21, -659], [12, -662], [2, -665], [-8, -667], [-17, -668],
    [-27, -670], [-37, -672], [-47, -674], [-57, -675], [-67, -673], [-76, -671], [-86, -668], [-95, -664],
    [-104, -659], [-113, -655], [-122, -651], [-131, -646], [-140, -642], [-149, -638], [-158, -633], [-167, -629],
    [-177, -626], [-186, -624], [-196, -624], [-206, -624], [-216, -624], [-226, -623], [-236, -621], [-246, -620],
    [-256, -620], [-266, -622], [-275, -625], [-285, -629], [-293, -634], [-302, -639], [-310, -644], [-319, -649],
    [-328, -654], [-337, -658], [-346, -662], [-355, -666], [-365, -669], [-374, -673], [-384, -676], [-393, -679],
    [-403, -682], [-412, -685], [-422, -687], [-432, -688], [-442, -688], [-452, -686], [-461, -685], [-471, -684],
    [-481, -686], [-491, -689], [-500, -692], [-510, -695], [-520, -696], [-530, -698], [-539, -701], [-549, -703],
    [-559, -704], [-569, -704], [-579, -703], [-589, -701], [-598, -698], [-608, -695], [-617, -693], [-627, -690],
    [-636, -686], [-645, -681], [-654, -677], [-663, -673], [-673, -672], [-682, -668], [-688, -661], [-689, -651],
    [-688, -641], [-689, -631], [-689, -621], [-687, -611], [-682, -603], [-676, -595], [-667, -590], [-657, -588],
    [-648, -590], [-638, -593], [-630, -598], [-622, -604], [-616.2, -612.1], [-611.7, -620.9], [-611.8, -629.3], [-613.9, -636.6],
    [-618.6, -641.6], [-624.6, -644.9], [-631.5, -645.3], [-638.2, -644.1], [-643, -640.6], [-646.2, -636.6], [-647.4, -632.7], [-647.8, -628.8],
    [-647.1, -625.3], [-646, -622],
  ] },
  // (off the jeep track, up round the hill to the east)
  { name: 'North Peak Track', kind: 'trail', width: 2.1, points: [
    [107, -680], [113, -672], [120, -665], [130, -662], [136, -660.2],
    [140.7, -660.4], [144.2, -661.8], [147.3, -663.7], [149.8, -666.3], [151.6, -669.4], [152.5, -673.5], [152.8, -678.2], [151, -685],
    [147, -694], [144, -703], [140, -713], [136, -722], [132, -731], [127, -740], [121, -748], [114, -755],
    [107, -762], [101, -770], [98, -779], [97, -789], [101, -798], [109, -803], [119, -805], [129, -808],
    [138, -811], [147, -815], [156, -819], [165, -824], [173, -830], [181, -836], [188, -843], [196, -849],
    [204, -855], [213, -859], [223, -861], [233, -861], [242, -857], [250, -851], [256, -844], [262, -835],
    [268, -827], [272.7, -819.1], [275.6, -812.1], [275.2, -805.7], [273.3, -800.7], [269.8, -797.3], [265.5, -794.7], [260, -794],
  ] },
  // (off the estate road at its last bend before the factory, along the top of the escarpment)
  { name: 'Thoovanam Top Track', kind: 'trail', width: 2.1, points: [
    [136.9, -575.3], [140, -567], [145, -558], [150, -550], [155, -542], [161, -533],
    [167, -526], [175, -519], [183, -513], [192, -508], [201, -504], [209, -499], [218, -494], [227, -490], [237, -487],
    [247, -486], [257, -486], [266, -487], [276, -490], [286, -493], [295, -496], [304, -500], [314, -503], [323, -506],
    [333, -510], [342, -513], [352, -515], [362, -517], [372, -517], [381, -514], [391, -511], [400, -507], [410, -500],
  ] },
  { name: 'Thoovanam Pool Track', kind: 'trail', width: 2.1, points: [
    [42, -238], [70, -238], [80, -238], [90, -238], [100, -238], [110, -238], [120, -238], [130, -238], [140, -238],
    [150, -238], [160, -238], [170, -238], [180, -238], [190, -240], [199, -243], [209, -246], [218, -249], [228, -252],
    [237, -255], [248, -258],
  ] },
  { name: 'Anapara Track', kind: 'trail', width: 2.2, points: [
    [90, 70], [100, 68], [110, 69], [119, 72], [128, 76], [137, 81], [146, 86], [154, 91],
    [162, 97], [171, 103], [179, 108], [186, 115], [194, 122], [201, 129], [208, 136], [215, 143],
    [222, 150], [229, 157], [236, 164], [243, 171], [250, 178], [257, 186], [264, 193], [271, 200],
    [280, 204], [290, 203], [300, 201], [308.8, 198.8], [317.1, 195.9], [322.8, 189.6], [328, 182], [332, 172],
    [335, 163], [340, 154], [346, 146], [353, 140], [362, 135], [371, 132], [381, 132], [391, 134],
    [401, 136], [410, 140], [418, 146], [426, 151], [432, 151.4], [437.8, 150.3], [442.7, 146.7], [447, 142],
    [451, 133], [455, 124], [461, 116], [469, 110], [478, 105], [487, 101], [496, 96], [505, 93],
    [515, 94], [523.5, 99.4], [529.3, 107.3], [530, 116.9], [531.8, 125.9], [538.2, 133.6], [546, 139], [553, 147],
    [559.1, 150.4], [565.3, 152.7], [572.1, 152.4], [579, 151], [587, 145], [595, 139], [600, 135],
  ] },
  { name: 'Paddy and Rubber Track', kind: 'trail', width: 2.2, ford: 0.15, points: [
    [0, 80], [-8, 85], [-14, 93], [-17, 103], [-17, 113], [-22, 121], [-30, 127], [-39, 130], [-49, 134],
    [-58, 138], [-67, 142], [-76, 147], [-85, 151], [-93, 156], [-102, 161], [-111, 165], [-121, 168], [-131, 169],
    [-141, 167], [-150, 164], [-160, 161], [-170, 159], [-180, 159], [-189, 161], [-199, 162], [-209, 162], [-219, 162],
    [-229, 162], [-239, 163], [-249, 165], [-259, 168], [-268, 171], [-278, 174], [-287, 176], [-306, 177], [-382, 169],
    [-402, 165], [-411, 163], [-421, 160], [-430, 156], [-439, 152], [-448, 148], [-456, 142], [-462, 134], [-468, 125],
    [-473, 117], [-478, 109], [-484, 100], [-490, 92], [-496, 84], [-501, 76], [-507, 67], [-511, 58], [-515, 49],
    [-517, 39], [-518, 29], [-519, 20], [-522, 10], [-527, 2], [-534, -3], [-543, -4], [-551, -1], [-557, 8],
    [-558, 17], [-558, 27], [-558, 37], [-558, 47], [-561, 57], [-565, 66], [-567, 76], [-567, 86], [-565, 96],
    [-563, 105], [-564, 115], [-567, 125], [-572, 133], [-578, 141], [-586, 148], [-594, 154], [-602, 159], [-611, 163],
    [-620, 167], [-630, 170], [-640, 170], [-650, 170], [-660, 169], [-669, 166], [-677, 159], [-683, 152], [-689, 143],
    [-694, 135], [-698, 126],
  ] },
  { name: 'Quarry Road', kind: 'road', width: 3.2, grade: 0.2, points: [
    [50, 95], [48, 105], [47, 115], [44, 124], [38, 132], [29, 135], [19, 134], [9, 131], [-1, 132],
    [-8, 139], [-12, 147], [-13, 157], [-11, 167], [-7, 176], [-3, 185], [2, 194], [6, 203], [11, 212],
    [15, 221], [20, 230], [24, 239], [29, 248], [34, 257], [38, 266], [41, 275], [42, 285], [42, 295],
    [43, 305], [45, 315], [48, 324], [49, 334], [48, 344], [45, 354], [44, 364], [46, 374], [50, 383],
    [54, 392], [55, 402], [53, 412], [49, 421], [45, 430], [42, 440], [39, 449], [37, 459], [37, 469],
    [40, 478], [44, 488], [47, 497], [47, 507], [45, 517], [42, 526], [38, 535], [35, 545], [35, 555],
    [39, 564], [45, 572], [52, 579], [59, 586], [66, 593], [72, 601], [78, 609], [84, 617], [91, 624],
    [99, 629], [109, 633], [118, 636], [128, 637], [138, 636], [148, 633], [158, 631], [166, 631],
    // (down the ramp into the pit)
    [173, 632.5], [178.5, 635.5], [182.5, 640.5], [184.3, 647], [184.5, 655], [184.7, 663], [186.5, 670], [189, 675],
  ] },
  { name: 'Reservoir Track', kind: 'trail', width: 2.1, points: [
    [190, 680], [180, 682], [170, 682], [161, 679], [151, 676], [142, 671], [133, 667], [124, 663], [115, 659],
    [106, 655], [96, 652], [87, 649], [77, 646], [68, 642], [58, 639], [49, 635], [40, 631], [31, 626],
    [23, 621], [14, 617], [4, 613], [-6, 612], [-16, 612], [-26, 612], [-36, 612], [-46, 612], [-56, 612],
    [-66, 612], [-76, 612], [-85, 614], [-95, 617], [-104, 620], [-114, 624], [-123, 628], [-132, 632], [-141, 637],
    [-150, 642], [-158, 647], [-167, 652], [-176, 655], [-186, 657], [-196, 659], [-205, 663], [-214, 667], [-223, 672],
    [-232, 677], [-240, 682], [-248, 688], [-255, 695], [-263, 701], [-272, 705], [-282, 706], [-292, 703], [-300, 700],
  ] },
];
// survey beacons
export const BEACONS = [
  { id: 0, name: 'Kurinji Top', x: -142, z: -784 },
  { id: 1, name: 'Ponmala Tea Factory', x: 32, z: -640 },
  { id: 2, name: 'Thoovanam Pool', x: 248, z: -258 },
  { id: 3, name: 'Thoovanam Top', x: 410, z: -500 },
  { id: 4, name: 'Anapara Rock', x: 616, z: 128 },
  { id: 5, name: 'Paddy Fields', x: -160, z: 161 },
  { id: 6, name: 'Kadavu Ford', x: -344, z: 172 },
  { id: 7, name: 'Rubber Estate Hill', x: -698, z: 126 },
  { id: 8, name: 'Laterite Quarry', x: 205, z: 640 },
  { id: 9, name: 'Ponmala Reservoir', x: -300, z: 700 },
  { id: 10, name: 'Tower Hill', x: -646, z: -622 },
  { id: 11, name: 'Vadakku Peak', x: 260, z: -794 },
  { id: 12, name: 'Shola Forest', x: -380, z: -675 },
  { id: 13, name: 'Estate Bungalow', x: 22, z: -690 },
  { id: 14, name: 'Chai Kada', x: 46, z: -232 },
];

// buildings and props: Kerala's tiled roofs and whitewashed walls (render/Landmarks.js draws them)
export const LANDMARKS = [
  { type: 'station', style: 'kerala', x: 52, z: 40, yaw: 0 },
  { type: 'garage', style: 'kerala', x: 12, z: 46, yaw: 0 },
  { type: 'teafactory', x: 64, z: -666, yaw: 0.15 },
  { type: 'bungalow', x: 40, z: -688, yaw: -0.3 },
  { type: 'chaistall', x: 56, z: -244, yaw: 1.4 },
  { type: 'busstop', x: 36, z: -26, yaw: 1.65 },
  { type: 'house', x: 110, z: 22, yaw: 0.4 },
  { type: 'house', x: -30, z: 112, yaw: -0.2 },
  { type: 'house', x: 82, z: 142, yaw: 2.9 },
  { type: 'house', x: -52, z: 34, yaw: 1.2 },
  { type: 'house', x: 150, z: 96, yaw: -1.1 },
  { type: 'house', x: 6, z: 160, yaw: 0.9 },
  { type: 'lookout', style: 'kerala', x: -150, z: -792, yaw: 0.3 },
  { type: 'mast', x: -652, z: -628, yaw: 0 },
  { type: 'laterite', x: 238, z: 668, yaw: 0.1 },
  { type: 'laterite', x: 245, z: 664, yaw: 0.45 },
];
// events (game/Events.js builds them; the par times come from driving them in every stock truck)
export const EVENTS = [
  { id: 'teaclimb', kind: 'trail', name: 'Kurinji Hill Climb', desc: 'From the tea factory up the jeep track through the estates to the viewpoint on Kurinji Top.',
    trail: 'Kurinji Jeep Track', from: [50, -650], gap: 110, r: 9, dy: 5, par: { gold: 110, silver: 135, bronze: 165 }, prize: 1.5 },
  { id: 'paddydash', kind: 'line', name: 'Paddy Field Dash', desc: 'Off the estate road and across five flooded paddy fields and the bunds between them. The mud drags harder the faster you go.',
    line: [[22, -66], [-151, 82]], at: [0.35, 0.68, 1], r: 14, par: { gold: 28.5, silver: 35, bronze: 45 }, prize: 1 },
  { id: 'rocktrials', kind: 'slalom', name: 'Anapara Rock Trials', desc: 'Tight gates through the boulders at the foot of the dome and up its granite slab. Each hard knock of the body: +5 s.',
    start: [312, 212], gates: [[340, 196], [362, 214], [382, 184], [402, 204], [425, 186], [452, 176]], r: 6, par: { gold: 58, silver: 75, bronze: 100 }, prize: 1.2, touch: true },
  { id: 'riverrun', kind: 'line', name: 'Kadavu River Run', desc: 'Flat out down the shallows of the Ponmala river and through the ford, spray everywhere.',
    line: [[-330, 85], [-356, 230]], at: [0.5, 1], r: 16, par: { gold: 10.5, silver: 12.5, bronze: 15.5 }, prize: 0.9 },
];

/** The map, as the game and the generator see it. */
export const KERALA = {
  id: 'kerala', name: 'Kerala Ghats', short: 'Kerala',
  blurb: 'Tea estates on misty hills, a waterfall, flooded paddy fields, red laterite tracks through rubber and coconut, and a granite dome.',
  tagline: 'Old trucks, real physics, good friends. Find the survey beacons of the Kerala Ghats together.',
  seed: SEED, station: STATION, spawn: SPAWN, dealer: 'Ponmala Motors',
  baseHeight, roughOf, gen,
  river: RIVER, lake: LAKE, peaks: PEAKS,
  trails: TRAILS, beacons: BEACONS, landmarks: LANDMARKS, events: EVENTS,
  roadSurface: SURFACE.ROAD, puddles: 6,
  // ground levelled under the buildings (m round them)
  pads: { teafactory: 16, bungalow: 9, chaistall: 5, house: 7, busstop: 3, laterite: 3 },
  // how much each kind of tree carpets the ground with leaves (the forest floor shows under them)
  litter: [0.3, 1, 1, 1, 0.3, 0.8],
  softTrees: [4],                                                 // banana plants: a truck pushes through them
  // red laterite: the dust and the mud the tyres throw (and the mud on the trucks)
  dust: { [SURFACE.DIRT]: [0.42, 0.17, 0.08], [SURFACE.MUD]: [0.24, 0.09, 0.04], [SURFACE.ROAD]: [0.32, 0.22, 0.16] },
  mudTint: [0.13, 0.045, 0.022],
  ground: 'kerala', trees: 'kerala', tea: true,
  // humid air: the hills fade into haze sooner, and more of the sky is cloud
  atmosphere: { fog: 0.00062, cover: 0.4 },
};
