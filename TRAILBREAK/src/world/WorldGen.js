// Builds a map's world from its definition (world/maps/): heights on a 1 m grid, ground surfaces, river and lake water
// levels, trees, boulders, beacons and building colliders. Deterministic (each map has its own seed), pure JS (also
// runs in Node for the tests), so every player's world is identical without sending it over the network.
//
// Order: macro landform on a 4 m grid (rolling hills, mountains, the river valley carved along a level profile that
// only ever runs downhill, edge walls, big lumps) -> 1 m detail (bumps, roughness) -> river channel, fords, lake
// basin, bog, puddles -> trails and the old road blended in (with two-track ruts) -> surfaces -> trees, boulders.
// A map adds its own features at each step through its `gen` hooks (Kerala's paddy terraces, tea estates, plantations).

import { fbm, ridged, vnoise, rng } from './Noise.js';
import { SURFACE } from '../physics/Surfaces.js';
import { MAP_HALF, mapById } from './maps/index.js';
import { courseLines, slalomLine } from '../game/Events.js';

export const GRID_RES = 1;
export const GRID_N = MAP_HALF * 2 / GRID_RES + 1;          // 2049
export const GRID_ORIGIN = -MAP_HALF;
const COARSE = 4;
const CN = MAP_HALF * 2 / COARSE + 1;                        // 513
export const WATER_RES = 2;
export const WATER_N = MAP_HALF * 2 / WATER_RES + 1;         // 1025
export const NO_WATER = -1e9;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);

/** Resample a polyline through control points as a Catmull-Rom curve, ~step metres apart. */
export function spline(points, step) {
  const out = [];
  const P = (i) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const n = Math.max(1, Math.ceil(hyp(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

/**
 * A profile kept within a grade: with Math.min the highest one under h (cut down), with Math.max the lowest one over
 * it (filled up). step[c]: the most it may change between points c-1 and c.
 */
export function limitGrade(h, step, pick) {
  const out = Float64Array.from(h), sgn = pick === Math.min ? 1 : -1;
  for (let c = 1; c < out.length; c++) out[c] = pick(out[c], out[c - 1] + sgn * step[c]);
  for (let c = out.length - 2; c >= 0; c--) out[c] = pick(out[c], out[c + 1] + sgn * step[c + 1]);
  return out;
}

// ---------------------------------------------------------------- a map's landform
const LANDFORMS = new Map();

/**
 * A map's landform, made once per map: the ground before the river valley is carved (baseHeight: the map's own, or
 * rolling hills with its peaks and walls round the edge), the river's level profile, the ground with the valley
 * carved (macroHeight), the big lumps, and the far terrain beyond the map's edge.
 */
export function landform(M) {
  let L = LANDFORMS.get(M.id);
  if (L) return L;
  const S = M.seed, RV = M.river;
  const riverCoarsePts = spline(RV.points, 25);
  const riverArc = [0];
  for (let i = 1; i < riverCoarsePts.length; i++) riverArc.push(riverArc[i - 1] + hyp(riverCoarsePts[i][0] - riverCoarsePts[i - 1][0], riverCoarsePts[i][1] - riverCoarsePts[i - 1][1]));
  const riverLen = riverArc[riverArc.length - 1];

  /** Landform before the valley is carved: rolling ground, mountains, the walls around the map. */
  const baseHeight = M.baseHeight || ((x, z) => {
    const wx = x + 110 * fbm(x / 900, z / 900, 2, S + 1);
    const wz = z + 110 * fbm(x / 900 + 7.7, z / 900 - 3.3, 2, S + 2);
    let h = 64 + 24 * fbm(wx / 760, wz / 760, 4, S + 3) + 8 * fbm(wx / 230, wz / 230, 3, S + 4);
    let mount = 0;
    for (let i = 0; i < M.peaks.length; i++) {
      const p = M.peaks[i];
      const dx = wx - p.x, dz = wz - p.z, d2 = (dx * dx + dz * dz) / (p.r * p.r);
      if (d2 > 4) continue;
      mount += p.h * Math.exp(-d2 * 2.3);
    }
    if (mount > 0.5) h += mount * (0.5 + 0.62 * ridged(wx / 270, wz / 270, 5, S + 10));
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (e > 850) h += smoothstep(850, 1180, e) * (230 + 140 * ridged(x / 240, z / 240, 4, S + 20));
    return h;
  });

  // level along the river: never above the land beside it, and falling at least 0.7% (a river that moves); a
  // waterfall keeps its step (the smoothing passes leave the points either side of it alone)
  const riverLevel = (() => {
    const cut = RV.cut ?? 3.5, minDrop = RV.minDrop ?? 0.007;
    const raw = riverCoarsePts.map(([x, z]) => baseHeight(x, z) - cut);
    const lv = new Float64Array(raw.length);
    const drop = (i) => (riverArc[i] - riverArc[i - 1]) * minDrop;
    const keep = new Set();
    for (const f of RV.falls || []) {
      let bi = 0;
      riverCoarsePts.forEach(([x, z], i) => { if (hyp(x - f.x, z - f.z) < hyp(riverCoarsePts[bi][0] - f.x, riverCoarsePts[bi][1] - f.z)) bi = i; });
      keep.add(bi); keep.add(bi + 1);
    }
    lv[0] = raw[0];
    for (let i = 1; i < raw.length; i++) lv[i] = Math.min(raw[i], lv[i - 1] - drop(i));
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < lv.length - 1; i++) if (!keep.has(i)) lv[i] = (lv[i - 1] + 2 * lv[i] + lv[i + 1]) / 4;
      for (let i = 1; i < lv.length; i++) lv[i] = Math.min(lv[i], lv[i - 1] - drop(i));
    }
    return lv;
  })();

  /** Nearest point on the coarse river: distance, level there, fraction along the river (one shared result). */
  const near = { d: 0, level: 0, s: 0 };
  const riverNear = (x, z) => {
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < riverCoarsePts.length - 1; i++) {
      const a = riverCoarsePts[i], b = riverCoarsePts[i + 1];
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      if (x < Math.min(ax, bx) - best || x > Math.max(ax, bx) + best || z < Math.min(az, bz) - best || z > Math.max(az, bz) + best) continue;
      const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
      const l2 = vx * vx + vz * vz;
      const t = l2 > 0 ? clamp((wx * vx + wz * vz) / l2, 0, 1) : 0;
      const dx = wx - vx * t, dz = wz - vz * t;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < best) { best = d; bi = i; bt = t; }
    }
    near.d = best;
    near.level = lerp(riverLevel[bi], riverLevel[bi + 1], bt);
    near.s = (riverArc[bi] + (riverArc[bi + 1] - riverArc[bi]) * bt) / riverLen;
    if (RV.smooth) {
      // where a fast-falling river bends, the nearest stretch jumps from one leg to the other: blend the legs within
      // `smooth` m of the nearest, so the valley floor carved from them has no crease
      let wl = 0, ws = 0, wsum = 0;
      for (let i = 0; i < riverCoarsePts.length - 1; i++) {
        const a = riverCoarsePts[i], b = riverCoarsePts[i + 1];
        const vx = b[0] - a[0], vz = b[1] - a[1], wx = x - a[0], wz = z - a[1], l2 = vx * vx + vz * vz;
        const t = l2 > 0 ? clamp((wx * vx + wz * vz) / l2, 0, 1) : 0;
        const d = hyp(wx - vx * t, wz - vz * t);
        if (d > best + RV.smooth) continue;
        const w = (1 - (d - best) / RV.smooth) ** 2;
        wl += w * lerp(riverLevel[i], riverLevel[i + 1], t);
        ws += w * (riverArc[i] + (riverArc[i + 1] - riverArc[i]) * t) / riverLen;
        wsum += w;
      }
      near.level = wl / wsum; near.s = ws / wsum;
    }
    return near;
  };

  /**
   * The landform with the river valley carved in (also the terrain beyond the map edge). A map can widen the valley
   * and its flat floor along the river (valleyAt: fraction along the river -> [width, flat floor's half-width]).
   */
  const W0 = RV.valley ?? 175, bank = RV.bank ?? 0.035;
  const macroHeight = (x, z) => {
    let h = baseHeight(x, z);
    const r = riverNear(x, z);
    let W = W0, flat = 14;
    if (RV.valleyAt) [W, flat] = RV.valleyAt(r.s);
    if (r.d < W) {
      const b = smoothstep(W, flat, r.d);
      const floor = r.level + 2.0 + r.d * bank;
      if (h > floor) h -= (h - floor) * b * 0.93;
      else h = lerp(h, floor, b * 0.8);                                  // no hollows below the river beside it
    }
    return h;
  };

  /** How rough the ground is at a height (big lumps, bumps): more in the mountains. */
  const roughOf = M.roughOf || ((h) => clamp((h - 70) / 170, 0.22, 1));
  /** Big lumps (tens of metres), stronger in the mountains. */
  const lumps = (x, z, h) => roughOf(h) * 5.2 * fbm(x / 46, z / 46, 3, S + 40);
  /** Far terrain (outside the generated grid). */
  const farHeight = (x, z) => { const h = macroHeight(x, z); return h + lumps(x, z, h); };

  L = { baseHeight, riverNear, macroHeight, lumps, roughOf, farHeight, riverLen };
  LANDFORMS.set(M.id, L);
  return L;
}

// building colliders: each a few walls (rows of posts), in the building's own frame
const WALLS = {
  station: (L, wall) => { wall(L, -5, -4, 5, -4); wall(L, 5, -4, 5, 4); wall(L, 5, 4, -5, 4); wall(L, -5, 4, -5, -4); },
  garage: (L, wall) => { wall(L, -3.5, -3, 3.5, -3); wall(L, 3.5, -3, 3.5, 3); wall(L, -3.5, 3, -3.5, -3); },
  cabin: (L, wall) => { wall(L, -3, -2.5, 3, -2.5); wall(L, 3, -2.5, 3, 2.5); wall(L, 3, 2.5, -3, 2.5); wall(L, -3, 2.5, -3, -2.5); },
  firetower: (L, wall) => { for (const [a, b] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) wall(L, a, b, a, b, 0.3); },
  lookout: (L, wall) => { for (const [a, b] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) wall(L, a, b, a, b, 0.3); },
  mine: (L, wall) => { wall(L, -4, -2, -4, 3); wall(L, 4, -2, 4, 3); },
  mast: (L, wall) => wall(L, 0, 0, 0, 0, 0.25),
  flag: (L, wall) => wall(L, 0, 0, 0, 0, 0.25),
};
// how far round a building the ground is levelled for it (m)
const PADS = { station: 11, garage: 8, mine: 10, firetower: 7, lookout: 7, cabin: 7 };

// ---------------------------------------------------------------- the generator
/** Generate a map's world (map: its id or definition; the default map without one). */
export async function generateWorld({ map, onProgress = () => {}, yieldEvery = 64 } = {}) {
  const M = map && typeof map === 'object' ? map : mapById(map);
  const t0 = Date.now();
  const tick = async (f, label) => { onProgress(f, label); await new Promise((r) => setTimeout(r, 0)); };
  const S = M.seed, LF = landform(M), G = M.gen || {};
  const { macroHeight, lumps, riverNear, roughOf } = LF;
  const RIVER = M.river, LAKE = M.lake, BOG = M.bog, STATION = M.station, BEACONS = M.beacons;
  const SNOW_LINE = M.snowLine ?? Infinity;
  const K = {};                                     // the map's own working state, shared by its hooks

  // ---- macro grid (4 m), with the big lumps baked in
  const coarse = new Float32Array(CN * CN);
  const coarseRough = new Float32Array(CN * CN);
  for (let j = 0; j < CN; j++) {
    const z = GRID_ORIGIN + j * COARSE;
    for (let i = 0; i < CN; i++) {
      const x = GRID_ORIGIN + i * COARSE;
      const h = macroHeight(x, z);
      coarse[j * CN + i] = h + lumps(x, z, h);
      coarseRough[j * CN + i] = roughOf(h);
    }
    if (j % yieldEvery === 0) await tick(0.25 * j / CN, 'Raising the mountains');
  }
  const bil = (grid, x, z) => {
    const fx = clamp((x - GRID_ORIGIN) / COARSE, 0, CN - 1.001), fz = clamp((z - GRID_ORIGIN) / COARSE, 0, CN - 1.001);
    const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
    const o = k * CN + i;
    return (grid[o] * (1 - tx) + grid[o + 1] * tx) * (1 - tz) + (grid[o + CN] * (1 - tx) + grid[o + CN + 1] * tx) * tz;
  };
  const coarseAt = (x, z) => bil(coarse, x, z);

  // lake level: a little under the lowest ground on its shore. A lake with lobes has bays and points: its distance is
  // measured against a radius that changes round it
  let lake = null;
  const lobeR = (ang) => (LAKE.lobes ? 1 + LAKE.lobes * fbm(Math.cos(ang) * 1.6 + 3.1, Math.sin(ang) * 1.6 - 1.7, 3, S + 61) : 1);
  const lakeD = (dx, dz) => (LAKE.lobes ? Math.sqrt(dx * dx + dz * dz) / lobeR(Math.atan2(dz, dx)) : Math.sqrt(dx * dx + dz * dz));
  if (LAKE) {
    let shoreMin = Infinity;
    for (let a = 0; a < 64; a++) {
      const ang = a / 64 * Math.PI * 2, rr = LAKE.r * lobeR(ang);
      shoreMin = Math.min(shoreMin, bil(coarse, LAKE.x + Math.cos(ang) * rr * 1.12, LAKE.z + Math.sin(ang) * rr * 1.12));
    }
    lake = { ...LAKE, level: Math.round((shoreMin - 1.2) * 10) / 10 };
  }
  const bogFloor = BOG ? bil(coarse, BOG.x, BOG.z) - 0.8 : 0;
  const stationH = bil(coarse, STATION.x, STATION.z);
  // the sand wash: a dry wash with a level floor along the drag strip, from a run-up before it to a run-off after
  let washFloor = 0, washD = () => Infinity;
  if (M.sandStrip) {
    const [[wx0, wz0], [wx1, wz1]] = M.sandStrip;
    const wl = hyp(wx1 - wx0, wz1 - wz0), wux = (wx1 - wx0) / wl, wuz = (wz1 - wz0) / wl;
    for (let k = 0; k <= 10; k++) washFloor += bil(coarse, lerp(wx0, wx1, k / 10), lerp(wz0, wz1, k / 10)) / 11;
    washD = (x, z) => {
      const t = clamp((x - wx0) * wux + (z - wz0) * wuz, -25, wl + 35);
      return hyp(x - wx0 - wux * t, z - wz0 - wuz * t);
    };
  }
  G.prepare?.({ M, K, coarseAt, LF, origin: GRID_ORIGIN, N: GRID_N, half: MAP_HALF });

  // ---- fine grid (1 m): macro + bumps + lake + bog + station terrace (+ the map's own shaping)
  const N = GRID_N;
  const H = new Float32Array(N * N);
  const surf = new Uint8Array(N * N);
  const bogC = BOG ? Math.cos(BOG.rot) : 1, bogS = BOG ? Math.sin(BOG.rot) : 0;
  const lakeR2 = lake ? (lake.r * 1.5 * (lake.lobes ? 1 + lake.lobes : 1)) ** 2 : 0;
  for (let j = 0; j < N; j++) {
    const z = GRID_ORIGIN + j;
    for (let i = 0; i < N; i++) {
      const x = GRID_ORIGIN + i;
      let h = bil(coarse, x, z);
      const rough = bil(coarseRough, x, z);
      const dk = G.detail ? G.detail(x, z, K) : 1;                // (smooth hillsides on a map that asks for them)
      h += (0.25 + 0.35 * rough) * fbm(x / 7.5, z / 7.5, 2, S + 41) * dk;
      h += 0.06 * (vnoise(x / 1.9, z / 1.9, S + 42) * 2 - 1) * dk;
      // the lake basin
      if (lake) {
        const lx = x - lake.x, lz = z - lake.z, l2 = lx * lx + lz * lz;
        if (l2 < lakeR2) {
          const ld = lakeD(lx, lz);
          const bowl = lake.level - 0.4 - 7 * Math.max(0, 1 - (ld / lake.r) ** 2);
          const k = smoothstep(lake.r * 1.45, lake.r * 0.82, ld);
          if (h > bowl) h = lerp(h, bowl, k);
          const shore = lake.level + (ld - lake.r) * 0.06;
          if (ld > lake.r * 0.9 && h > shore) h = lerp(h, shore, smoothstep(lake.r * 1.5, lake.r * 1.02, ld) * 0.85);
        }
      }
      // the bog: a flat wet hollow
      if (BOG) {
        const bx = x - BOG.x, bz = z - BOG.z;
        if (Math.abs(bx) < BOG.rx * 2 && Math.abs(bz) < BOG.rx * 2) {
          const bu = (bx * bogC + bz * bogS) / BOG.rx, bv = (-bx * bogS + bz * bogC) / BOG.rz;
          const be = Math.sqrt(bu * bu + bv * bv);
          if (be < 1.8) h = lerp(h, bogFloor + 0.35 * fbm(x / 9, z / 9, 2, S + 50) + Math.max(0, be - 0.8) * 1.5, smoothstep(1.8, 0.9, be));
        }
      }
      // the wash floor (wind ripples on it)
      const wd = washD(x, z);
      if (wd < 36) h = lerp(h, washFloor + 0.07 * fbm(x / 8, z / 8, 2, S + 51), smoothstep(36, 15, wd));
      // station terrace
      const sx = x - STATION.x, sz = z - STATION.z;
      if (sx * sx + sz * sz < 75 * 75) h = lerp(h, stationH, smoothstep(75, 42, Math.sqrt(sx * sx + sz * sz)));
      if (G.fine) h = G.fine(x, z, h, K);
      H[j * N + i] = h;
    }
    if (j % yieldEvery === 0) await tick(0.25 + 0.3 * j / N, 'Shaping the valley');
  }

  // ---- river channel, fords, water levels
  const W = new Float32Array(WATER_N * WATER_N).fill(NO_WATER);
  const setWater = (x, z, level) => {
    const i = Math.round((x - GRID_ORIGIN) / WATER_RES), k = Math.round((z - GRID_ORIGIN) / WATER_RES);
    if (i < 0 || k < 0 || i >= WATER_N || k >= WATER_N) return;
    const idx = k * WATER_N + i;
    if (level > W[idx]) W[idx] = level;
  };
  // per cell: distance to the river (0.25 m units, 255 = far) and which river point is nearest
  const riverFine = spline(RIVER.points, 1.5);
  const RP = riverFine.length;
  const rpLevel = new Float32Array(RP), rpHalf = new Float32Array(RP), rpDepth = new Float32Array(RP);
  const rD = new Uint8Array(N * N).fill(255), rI = new Uint16Array(N * N);
  {
    let arc = 0;
    for (let p = 0; p < RP; p++) {
      if (p > 0) arc += hyp(riverFine[p][0] - riverFine[p - 1][0], riverFine[p][1] - riverFine[p - 1][1]);
      const [px, pz] = riverFine[p];
      const n = riverNear(px, pz);
      let half = lerp(RIVER.widthStart, RIVER.widthEnd, n.s) / 2 * (0.85 + 0.3 * vnoise(arc / 60, 0, S + 60));
      let depth = lerp(RIVER.depthStart, RIVER.depthEnd, n.s);
      for (const [fx, fz] of RIVER.fords) {
        const fd = hyp(px - fx, pz - fz);
        if (fd < 28) { const k = smoothstep(28, 8, fd); half *= 1 + 0.6 * k; depth = lerp(depth, 0.42, k); }
      }
      for (const sh of RIVER.shallows || []) {
        // a long shallow, wide stretch (a river run): ankle deep over stones
        const sd = hyp(px - sh.x, pz - sh.z);
        if (sd < sh.r + 25) { const k = smoothstep(sh.r + 25, sh.r, sd); half *= 1 + (sh.widen ?? 0.6) * k; depth = lerp(depth, sh.depth ?? 0.4, k); }
      }
      rpLevel[p] = n.level; rpHalf[p] = half; rpDepth[p] = depth;
      const R = Math.ceil(half + 42);
      const ci = Math.round(px - GRID_ORIGIN), ck = Math.round(pz - GRID_ORIGIN);
      for (let k = Math.max(0, ck - R); k <= Math.min(N - 1, ck + R); k++) {
        const dz = GRID_ORIGIN + k - pz;
        for (let i = Math.max(0, ci - R); i <= Math.min(N - 1, ci + R); i++) {
          const dx = GRID_ORIGIN + i - px;
          const q = Math.min(254, Math.round(Math.sqrt(dx * dx + dz * dz) * 4));
          const idx = k * N + i;
          if (q < rD[idx]) { rD[idx] = q; rI[idx] = p; }
        }
      }
    }
    await tick(0.58, 'Running the river');
    for (let idx = 0; idx < N * N; idx++) {
      if (rD[idx] === 255) continue;
      const d = rD[idx] / 4, p = rI[idx], half = rpHalf[p], level = rpLevel[p];
      let h = H[idx];
      if (d < half) {
        // the bed rises smoothly to the water's edge: no step there
        h = Math.min(h, level - 0.05 - rpDepth[p] * (1 - (d / half) ** 2));
      } else {
        // the banks rise no steeper than about 20 degrees for 25 m (a truck in the river can climb out anywhere),
        // then the limit relaxes so the valley side meets the land without a step. It follows the water level of
        // the nearest stretch of river, so it never cuts below a river running downhill.
        const k = d - half;
        const cap = level + 0.12 + 0.36 * k + (k > 25 ? 0.06 * (k - 25) ** 2 : 0);
        if (h > cap) h = cap;
        else if (k < 6) h = Math.max(h, level + 0.12 * Math.min(1, k / 1.5));   // no low ground beside the channel
      }
      H[idx] = h;
      if (d < half + 1.5) { const i = idx % N; setWater(GRID_ORIGIN + i, GRID_ORIGIN + (idx - i) / N, level); }
    }
  }
  const riverD = (idx) => (rD[idx] === 255 ? 1e9 : rD[idx] / 4);
  const riverHalf = (idx) => (rD[idx] === 255 ? 0 : rpHalf[rI[idx]]);
  const riverLvl = (idx) => rpLevel[rI[idx]];
  // lake and bog water
  if (lake || BOG) {
    for (let k = 0; k < WATER_N; k++) {
      const z = GRID_ORIGIN + k * WATER_RES;
      for (let i = 0; i < WATER_N; i++) {
        const x = GRID_ORIGIN + i * WATER_RES;
        if (lake && lakeD(x - lake.x, z - lake.z) < lake.r * 1.3 && (!lake.lobes || H[clamp(Math.round(z - GRID_ORIGIN), 0, N - 1) * N + clamp(Math.round(x - GRID_ORIGIN), 0, N - 1)] < lake.level + 0.5)) W[k * WATER_N + i] = Math.max(W[k * WATER_N + i], lake.level);
        if (BOG) {
          const bx = x - BOG.x, bz = z - BOG.z, bu = (bx * bogC + bz * bogS) / BOG.rx, bv = (-bx * bogS + bz * bogC) / BOG.rz;
          if (bu * bu + bv * bv < 0.45) W[k * WATER_N + i] = Math.max(W[k * WATER_N + i], bogFloor - 0.06);
        }
      }
    }
  }
  const hAt = (x, z) => H[clamp(Math.round(z - GRID_ORIGIN), 0, N - 1) * N + clamp(Math.round(x - GRID_ORIGIN), 0, N - 1)];
  const cellOf = (x, z) => clamp(Math.round(z - GRID_ORIGIN), 0, N - 1) * N + clamp(Math.round(x - GRID_ORIGIN), 0, N - 1);
  const ctx = { M, K, N, H, surf, W, origin: GRID_ORIGIN, setWater, hAt, cellOf, riverD, riverHalf, riverLvl, riverFine, coarseAt, lake };

  // the event courses are kept clear of puddles, boulders and trees
  const courses = courseLines(M);
  const onCourse = (x, z, w = 7) => {
    for (const path of courses) for (let k = 1; k < path.length; k++) {
      const [ax, az] = path[k - 1], [bx, bz] = path[k], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      if (hyp(x - ax - dx * t, z - az - dz * t) < w) return true;
    }
    return false;
  };
  ctx.onCourse = onCourse;

  // ---- trails and the road
  await tick(0.62, 'Cutting the trails');
  const R = rng(S + 99);
  const puddles = [];
  // every trail point in one list: target height, half-width, kind (1 trail, 2 road), its ford's depth (a causeway's
  // is shallow); and a paved road's own: the shoulder its bed blends into the land over, and whether it is laid
  // level across (a highway's tarmac) and crosses the river on a bridge
  const tpH = [], tpW = [], tpK = [], tpX = [], tpZ = [], tpF = [], tpS = [], tpL = [], tpB = [];
  const tD = new Uint8Array(N * N).fill(255), tI = new Uint16Array(N * N);   // distance in 0.1 m units
  const trailLines = [];
  for (const tr of M.trails) {
    const pts = spline(tr.points, 1);
    // (a road with lanes: its width and lanes go to the renderer, for the markings)
    trailLines.push({ name: tr.name, kind: tr.kind, points: spline(tr.points, 6), ...(tr.lanes !== undefined ? { lanes: tr.lanes, width: tr.width, ...(tr.runway ? { runway: true } : {}) } : {}) });
    // the trail's own grade: the ground along it, smoothed (a road more than a trail; a highway over a longer stretch,
    // tr.smooth points). A bridge's deck stands clear of the river under it.
    let hs = pts.map(([x, z]) => {
      if (tr.bridge) { const idx = cellOf(x, z); if (riverD(idx) < riverHalf(idx) + 4) return riverLvl(idx) + 2; }
      return hAt(x, z);
    });
    const win = tr.smooth ?? (tr.kind === 'road' ? 18 : 10);
    for (let pass = 0; pass < 3; pass++) {
      const out = new Array(hs.length);
      for (let c = 0; c < hs.length; c++) {
        let sum = 0, cnt = 0;
        for (let q = Math.max(0, c - win); q <= Math.min(hs.length - 1, c + win); q++) { sum += hs[q]; cnt++; }
        out[c] = sum / cnt;
      }
      hs = out;
    }
    // (a map can keep its roads above wet ground: on embankments across its paddy fields)
    if (G.trailFloor) hs = hs.map((h, c) => Math.max(h, G.trailFloor(pts[c][0], pts[c][1], K)));
    // the bed is graded, half cut into the rises and half built up over the dips, so no pitch is steeper than a
    // stock truck climbs in low range: the mean of the deepest cut and the highest fill that keep within the grade
    const gmax = tr.grade ?? (tr.kind === 'road' ? 0.14 : 0.34);
    const step = pts.map((q, c) => (c ? hyp(q[0] - pts[c - 1][0], q[1] - pts[c - 1][1]) * gmax : 0));
    // (by at most 3 m either way: a climb steeper than that on average stays steep rather than becoming a cutting or
    // an embankment)
    // (a highway's cuttings and embankments go deeper: tr.cut metres)
    const cut = limitGrade(hs, step, Math.min), fill = limitGrade(hs, step, Math.max), cm = tr.cut ?? 3;
    hs = hs.map((h, c) => clamp((cut[c] + fill[c]) / 2, h - cm, h + cm));
    // where it fords the river it dips to the bed, and the banks are cut down to it in ramps (a bridge doesn't)
    for (let p = 0; p < pts.length && !tr.bridge; p++) {
      const ci = Math.round(pts[p][0] - GRID_ORIGIN), ck = Math.round(pts[p][1] - GRID_ORIGIN);
      if (ci < 0 || ck < 0 || ci >= N || ck >= N) continue;
      const idx = ck * N + ci;
      if (riverD(idx) < riverHalf(idx) + 3) hs[p] = Math.min(hs[p], riverLvl(idx) - (tr.ford ?? 0.38));
    }
    hs = limitGrade(hs, step, Math.min);
    // its ends stay where they are: on the ground, or on the trail they join (eased in over a ramp)
    for (const e of [0, pts.length - 1]) {
      let target = hAt(pts[e][0], pts[e][1]), bd = 4;
      for (let q = 0; q < tpX.length; q++) { const d = hyp(tpX[q] - pts[e][0], tpZ[q] - pts[e][1]); if (d < bd) { bd = d; target = tpH[q]; } }
      const off = target - hs[e], D = Math.max(20, Math.abs(off) / 0.12);
      for (let c = e, s = 0; s < D && c >= 0 && c < pts.length; c += e ? -1 : 1) {
        hs[c] += off * (1 - s / D);
        const n = c + (e ? -1 : 1);
        if (n >= 0 && n < pts.length) s += hyp(pts[n][0] - pts[c][0], pts[n][1] - pts[c][1]);
      }
    }
    const base = tpH.length;
    const shoulder = tr.shoulder ?? 6;
    for (let p = 0; p < pts.length; p++) {
      tpH.push(hs[p]); tpW.push(tr.width); tpK.push(tr.kind === 'road' ? 2 : 1); tpX.push(pts[p][0]); tpZ.push(pts[p][1]); tpF.push(tr.ford);
      tpS.push(shoulder); tpL.push(tr.level ? 1 : 0.97); tpB.push(!!tr.bridge);
    }
    const Rr = Math.ceil(tr.width + shoulder);
    for (let p = 0; p < pts.length; p++) {
      const [px, pz] = pts[p];
      const ci = Math.round(px - GRID_ORIGIN), ck = Math.round(pz - GRID_ORIGIN);
      for (let k = Math.max(0, ck - Rr); k <= Math.min(N - 1, ck + Rr); k++) {
        const dz = GRID_ORIGIN + k - pz;
        for (let i = Math.max(0, ci - Rr); i <= Math.min(N - 1, ci + Rr); i++) {
          const dx = GRID_ORIGIN + i - px;
          const q = Math.min(254, Math.round(Math.sqrt(dx * dx + dz * dz) * 10));
          const idx = k * N + i;
          if (q < tD[idx]) { tD[idx] = q; tI[idx] = base + p; }
        }
      }
    }
    // a few puddles on each trail, in its lower stretches
    if (tr.kind === 'trail') {
      for (let n = 0; n < (M.puddles ?? 4); n++) {
        const p = Math.floor((0.15 + 0.7 * R()) * pts.length);
        const [px, pz] = pts[p];
        if (hyp(px - STATION.x, pz - STATION.z) < 90 || hs[p] > SNOW_LINE - 20) continue;
        const pd = { x: px + (R() - 0.5) * 1.5, z: pz + (R() - 0.5) * 1.5, r: 3.5 + R() * 4, depth: 0.28 + R() * 0.2 };
        // water lies on the level: none where the trail climbs (it would be a hole cut into the hill), nor on a
        // course (after the draws, so the rest of the world stays as it was)
        const grade = Math.abs(hs[Math.min(pts.length - 1, p + 6)] - hs[Math.max(0, p - 6)]) / 12;
        if (grade < 0.035 && !onCourse(pd.x, pd.z, pd.r + 6)) puddles.push(pd);
      }
    }
    // a paved road's verges (tr.verge.puddles: so many a km): rain standing in the dips just off the tarmac, the
    // ground round it trodden to mud (kept off the road itself, another road's and the courses)
    if (tr.verge?.puddles) {
      for (let n = Math.round(tr.verge.puddles * pts.length / 1000); n > 0; n--) {
        const p = Math.floor((0.03 + 0.94 * R()) * pts.length), side = R() < 0.5 ? 1 : -1, r = 1.1 + R() * 1.3;
        const a = pts[Math.max(0, p - 1)], b = pts[Math.min(pts.length - 1, p + 1)], l = hyp(b[0] - a[0], b[1] - a[1]) || 1;
        const off = side * (tr.width + 1.6 + r);
        const pd = { x: pts[p][0] - (b[1] - a[1]) / l * off, z: pts[p][1] + (b[0] - a[0]) / l * off, r, depth: 0.12 + R() * 0.1, verge: true };
        if (!onCourse(pd.x, pd.z, pd.r + 4)) puddles.push(pd);
      }
    }
  }
  const trailD = (idx) => (tD[idx] === 255 ? 1e9 : tD[idx] / 10);
  const trailW = (idx) => (tD[idx] === 255 ? 0 : tpW[tI[idx]]);
  const trailK = (idx) => (tD[idx] === 255 ? 0 : tpK[tI[idx]]);
  Object.assign(ctx, { trailD, trailW, trailK });
  for (let idx = 0; idx < N * N; idx++) {
    if (tD[idx] === 255) continue;
    const d = tD[idx] / 10, p = tI[idx], width = tpW[p];
    const w = d <= width ? 1 : smoothstep(width + tpS[p], width, d);
    let h = lerp(H[idx], tpH[p], w * tpL[p]);
    if (tpK[p] === 1 && d < width) h -= 0.07 * Math.exp(-(((d - 0.8) / 0.22) ** 2));       // two-track ruts
    if (riverD(idx) < riverHalf(idx) && !tpB[p]) h = Math.min(h, riverLvl(idx) - (tpF[p] !== undefined ? tpF[p] - 0.05 : 0.3));   // keep fords wet
    H[idx] = h;
  }
  // carve the puddles (only where the ground all round is level: on a side slope one would be a pothole with a wall)
  for (const pd of puddles) {
    const ci = Math.round(pd.x - GRID_ORIGIN), ck = Math.round(pd.z - GRID_ORIGIN), Rr = Math.ceil(pd.r + 2);
    // (a verge's: not on any road's tarmac, nor in the river)
    if (pd.verge) {
      const idx = cellOf(pd.x, pd.z);
      if (trailD(idx) < trailW(idx) + pd.r + 1 || riverD(idx) < riverHalf(idx) + pd.r + 3) { pd.skip = true; continue; }
    }
    let rim = Infinity, rimTop = -Infinity;
    for (let k = ck - Rr; k <= ck + Rr; k++) for (let i = ci - Rr; i <= ci + Rr; i++) {
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      const d = hyp(GRID_ORIGIN + i - pd.x, GRID_ORIGIN + k - pd.z);
      if (d > pd.r && d < pd.r + 1.5) { rim = Math.min(rim, H[k * N + i]); rimTop = Math.max(rimTop, H[k * N + i]); }
    }
    if (!Number.isFinite(rim) || rimTop - rim > 0.45) { pd.skip = true; continue; }
    pd.level = rim - 0.1;
    for (let k = ck - Rr; k <= ck + Rr; k++) for (let i = ci - Rr; i <= ci + Rr; i++) {
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      const d = hyp(GRID_ORIGIN + i - pd.x, GRID_ORIGIN + k - pd.z);
      if (d >= pd.r) continue;
      const idx = k * N + i;
      H[idx] = Math.min(H[idx], rim - pd.depth * (1 - (d / pd.r) ** 2) - 0.02);
    }
    for (let a = -pd.r; a <= pd.r; a += WATER_RES) for (let b = -pd.r; b <= pd.r; b += WATER_RES) {
      if (a * a + b * b < pd.r * pd.r * 0.8) setWater(pd.x + a, pd.z + b, pd.level);
    }
  }
  { const keep = puddles.filter((pd) => !pd.skip); puddles.length = 0; puddles.push(...keep); }
  // the map's own water (paddy fields), clear of the trails
  G.water?.(ctx);

  // ---- landmark pads (flatten under buildings)
  const landmarks = M.landmarks.map((L) => ({ ...L }));
  const pads = { ...PADS, ...(M.pads || {}) };
  for (const L of landmarks) {
    const pad = pads[L.type] || 0;
    L.y = hAt(L.x, L.z);
    if (!pad) continue;
    const h0 = L.y;
    const ci = Math.round(L.x - GRID_ORIGIN), ck = Math.round(L.z - GRID_ORIGIN), Rr = pad + 6;
    for (let k = ck - Rr; k <= ck + Rr; k++) for (let i = ci - Rr; i <= ci + Rr; i++) {
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      const idx = k * N + i;
      H[idx] = lerp(H[idx], h0, smoothstep(pad + 6, pad, hyp(GRID_ORIGIN + i - L.x, GRID_ORIGIN + k - L.z)));
    }
  }
  ctx.landmarks = landmarks;
  await tick(0.7, 'Laying the ground');

  // ---- surfaces
  const waterAt = (x, z) => {
    const i = Math.round((x - GRID_ORIGIN) / WATER_RES), k = Math.round((z - GRID_ORIGIN) / WATER_RES);
    if (i < 0 || k < 0 || i >= WATER_N || k >= WATER_N) return NO_WATER;
    return W[k * WATER_N + i];
  };
  ctx.waterAt = waterAt;
  const GARDEN = M.rockGarden, WASH = M.sandWash;
  const lakeShoreR2 = lake ? (lake.r * 1.3 * (lake.lobes ? 1 + lake.lobes : 1)) ** 2 : 0, washR2 = WASH ? 1.3 * WASH.r * WASH.r : 0, gardenR2 = GARDEN ? 1.3 * GARDEN.r * GARDEN.r : 0;
  for (let k = 0; k < N; k++) {
    const z = GRID_ORIGIN + k;
    const k0 = Math.max(0, k - 1), k1 = Math.min(N - 1, k + 1);
    for (let i = 0; i < N; i++) {
      const x = GRID_ORIGIN + i;
      const idx = k * N + i;
      const h = H[idx];
      const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
      const gx = (H[k * N + i1] - H[k * N + i0]) / (i1 - i0), gz = (H[k1 * N + i] - H[k0 * N + i]) / (k1 - k0);
      const sl = Math.sqrt(gx * gx + gz * gz);
      let s = SURFACE.GRASS;
      if (vnoise(x / 13, z / 13, S + 70) > 0.8) s = SURFACE.DIRT;
      const rd = riverD(idx), rh = riverHalf(idx);
      // snow and rock on the heights and the steeps
      if (h > SNOW_LINE - 30 && h > SNOW_LINE + 28 * (vnoise(x / 60, z / 60, S + 71) * 2 - 1)) s = sl > 1.1 ? SURFACE.ROCK : SURFACE.SNOW;
      else if (sl > 1.0 || (sl > 0.68 && vnoise(x / 11, z / 11, S + 72) > 0.45)) s = SURFACE.ROCK;
      if (GARDEN) {
        const gdx = x - GARDEN.x, gdz = z - GARDEN.z;
        if (gdx * gdx + gdz * gdz < gardenR2 && Math.sqrt(gdx * gdx + gdz * gdz) < GARDEN.r * (0.8 + 0.3 * vnoise(x / 20, z / 20, S + 73))) s = SURFACE.ROCK;
      }
      // sand on the lake shore, the wash and the river's banks
      if (lake) {
        const lx = x - lake.x, lz = z - lake.z, l2 = lx * lx + lz * lz;
        if (l2 < lakeShoreR2 && h < lake.level + 1.6 && lakeD(lx, lz) < lake.r * 1.12 + 6 * vnoise(x / 15, z / 15, S + 74)) s = SURFACE.SAND;
      }
      if (WASH) {
        const sx = x - WASH.x, sz = z - WASH.z;
        if (sx * sx + sz * sz < washR2 && Math.sqrt(sx * sx + sz * sz) < WASH.r * (0.75 + 0.4 * vnoise(x / 25, z / 25, S + 75))) s = SURFACE.SAND;
      }
      if (washD(x, z) < 15 + 5 * vnoise(x / 12, z / 12, S + 79)) s = SURFACE.SAND;
      if (rd < rh + 4 && rd >= rh - 0.5) s = vnoise(x / 9, z / 9, S + 76) > 0.45 ? SURFACE.SAND : SURFACE.GRAVEL;
      // the bog
      if (BOG) {
        const bx = x - BOG.x, bz = z - BOG.z;
        if (Math.abs(bx) < BOG.rx * 1.4 && Math.abs(bz) < BOG.rx * 1.4) {
          const bu = (bx * bogC + bz * bogS) / BOG.rx, bv = (-bx * bogS + bz * bogC) / BOG.rz, b2 = bu * bu + bv * bv;
          if (b2 < 1.6 && b2 < 1 + 0.35 * fbm(x / 14, z / 14, 2, S + 77)) s = SURFACE.MUD;
        }
      }
      // the map's own ground (plantations, paddies, quarries)
      if (G.surface) s = G.surface(x, z, h, sl, s, idx, ctx);
      // trails and road (on top)
      const td = trailD(idx), tw = trailW(idx);
      // (up in the snow a trail is the lookout's gravel track, ploughed, with the snow banked either side)
      if (td < tw * 0.95) s = trailK(idx) === 2 ? (M.roadSurface ?? SURFACE.GRAVEL) : s === SURFACE.SNOW ? SURFACE.GRAVEL : (s === SURFACE.MUD ? SURFACE.MUD : s === SURFACE.ROCK && sl > 0.5 ? SURFACE.ROCK : SURFACE.DIRT);
      else if (td < tw + 1.6 && (s === SURFACE.GRASS || s === M.vergeOf) && vnoise(x / 3, z / 3, S + 78) > 0.4) s = SURFACE.DIRT;
      // under water
      const wl = waterAt(x, z);
      if (wl > NO_WATER && h < wl - 0.05 && !(M.roadSurface !== undefined && s === M.roadSurface)) s = rd < rh + 1 ? SURFACE.RIVERBED : s === SURFACE.MUD ? SURFACE.MUD : SURFACE.RIVERBED;
      surf[idx] = s;
    }
    if (k % yieldEvery === 0) await tick(0.7 + 0.12 * k / N, 'Laying the ground');
  }
  for (const pd of puddles) {
    const ci = Math.round(pd.x - GRID_ORIGIN), ck = Math.round(pd.z - GRID_ORIGIN), Rr = Math.ceil(pd.r + 1.5);
    for (let k = ck - Rr; k <= ck + Rr; k++) for (let i = ci - Rr; i <= ci + Rr; i++) {
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      if (hyp(GRID_ORIGIN + i - pd.x, GRID_ORIGIN + k - pd.z) < pd.r + 1.2 && surf[k * N + i] !== SURFACE.SNOW) surf[k * N + i] = SURFACE.MUD;
    }
  }

  // ---- boulders
  await tick(0.84, 'Rolling boulders');
  const boulders = [];
  const addBoulder = (x, z, size, bury = 0.38, rnd = R) => {
    const rx = size * (0.8 + 0.5 * rnd()), rz = size * (0.8 + 0.5 * rnd()), ry = size * (0.55 + 0.35 * rnd());
    boulders.push({ x, y: hAt(x, z) - ry * bury, z, rx, ry, rz, yaw: rnd() * Math.PI * 2, shade: rnd() });
  };
  // the rock garden: a field of boulders with a way through for the bold
  if (GARDEN) {
    for (let n = 0; n < 340; n++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * GARDEN.r;
      const x = GARDEN.x + Math.cos(a) * d, z = GARDEN.z + Math.sin(a) * d;
      if (BEACONS.some((b) => hyp(x - b.x, z - b.z) < 6)) continue;
      addBoulder(x, z, 0.6 + R() * 0.9 + R() * R() * 1.3, 0.22 + R() * 0.22);
    }
  }
  // along the river and on the rocky steeps
  for (let n = 0; n < 9000 && boulders.length < 1400; n++) {
    const x = (R() * 2 - 1) * (MAP_HALF - 30), z = (R() * 2 - 1) * (MAP_HALF - 30);
    const idx = cellOf(x, z), s = surf[idx];
    const nearRiver = riverD(idx) < riverHalf(idx) + 6;
    const p = s === SURFACE.ROCK ? 0.35 : nearRiver ? 0.25 : s === SURFACE.SNOW ? 0.05 : 0.012;
    if (R() > p) continue;
    if (trailD(idx) < 4.5 || hyp(x - STATION.x, z - STATION.z) < 80) continue;
    addBoulder(x, z, 0.4 + R() * R() * (s === SURFACE.ROCK ? 2.4 : 1.3));
    if (onCourse(x, z, 9)) boulders.pop();                            // (after its draws: the rest stays as it was)
  }
  G.boulders?.(ctx, addBoulder, boulders);
  // the trials line: the big boulders on it rolled aside, the small ones bedded down to rocks a truck can crawl over or
  // straddle
  const tl = slalomLine(M);
  if (tl) {
    for (const b of boulders) {
      const Rb = Math.max(b.rx, b.rz);
      let on = false;
      for (let k = 1; k < tl.length && !on; k++) {
        const [ax, az] = tl[k - 1], [bx, bz] = tl[k], dx = bx - ax, dz = bz - az;
        const t = clamp(((b.x - ax) * dx + (b.z - az) * dz) / (dx * dx + dz * dz), 0, 1);
        on = hyp(b.x - ax - dx * t, b.z - az - dz * t) < Rb + 2.2;
      }
      if (!on) continue;
      const g = hAt(b.x, b.z);
      if (Rb > 1) b.gone = true;
      else if (b.y + b.ry - g > 0.3) b.y = g + 0.3 - b.ry;
    }
    const keep = boulders.filter((b) => !b.gone); boulders.length = 0; boulders.push(...keep);
  }

  // ---- trees
  await tick(0.9, 'Planting the forest');
  const trees = { x: [], y: [], z: [], r: [], h: [], type: [] };
  const clear = [...landmarks.map((L) => [L.x, L.z, L.type === 'station' ? 45 : 16]), ...BEACONS.map((b) => [b.x, b.z, 12]), [STATION.x, STATION.z, 60]];
  if (G.trees) G.trees({ ...ctx, R, trees, clear, lake, boulders }); else {
    const STEP = 5;
    for (let z = GRID_ORIGIN + 3; z < MAP_HALF - 3; z += STEP) {
      for (let x = GRID_ORIGIN + 3; x < MAP_HALF - 3; x += STEP) {
        const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9;
        const idx = cellOf(px, pz);
        const s = surf[idx], h = H[idx];
        if (s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.GRAVEL || s === SURFACE.ROCK) continue;
        if (trailD(idx) < trailW(idx) + 3.2 || riverD(idx) < riverHalf(idx) + 3) continue;
        const wl = waterAt(px, pz);
        if (wl > NO_WATER && h < wl + 0.3) continue;
        let blocked = false;
        for (const [cx, cz, cr] of clear) if (Math.abs(px - cx) < cr && Math.abs(pz - cz) < cr && hyp(px - cx, pz - cz) < cr) { blocked = true; break; }
        if (blocked) continue;
        // forest density: patchy woods, thicker on the hills to the west and the north slopes, thin on the meadows
        let dens = 0.5 + 0.55 * fbm(px / 310, pz / 310, 3, S + 80) + 0.25 * fbm(px / 70, pz / 70, 2, S + 81);
        dens += smoothstep(-200, -800, px) * 0.35 + smoothstep(-100, -600, pz) * 0.2 - smoothstep(500, 950, pz) * 0.3;
        if (s === SURFACE.SNOW) dens *= 0.25;
        if (h > SNOW_LINE + 40) dens *= 0.3;
        dens = clamp(dens - 0.12, 0, 0.9) ** 1.9;
        if (R() > dens) continue;
        const nearWater = riverD(idx) < riverHalf(idx) + 12 || (lake && hyp(px - lake.x, pz - lake.z) < lake.r + 60);
        const type = nearWater && R() < 0.55 ? 2 : (h > 200 || R() < 0.35) ? 1 : (R() < 0.02 ? 3 : 0);
        const ht = type === 2 ? 9 + R() * 7 : type === 1 ? 11 + R() * 10 : type === 3 ? 7 + R() * 6 : 12 + R() * 11;
        if (onCourse(px, pz)) continue;                  // event courses are kept clear (after the draws: the rest stays put)
        trees.x.push(px); trees.y.push(hAt(px, pz)); trees.z.push(pz);
        trees.r.push(type === 2 ? 0.14 + R() * 0.08 : 0.18 + ht * 0.012 + R() * 0.06);
        trees.h.push(ht); trees.type.push(type);
      }
    }
  }

  // ---- beacons, building colliders (rows of posts along the walls)
  const beacons = BEACONS.map((b) => ({ ...b, y: hAt(b.x, b.z) }));
  const posts = [];
  const wall = (L, x0, z0, x1, z1, r = 0.5) => {
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw);
    const n = Math.max(1, Math.round(hyp(x1 - x0, z1 - z0) / 0.9));
    for (let k = 0; k <= n; k++) {
      const lx = lerp(x0, x1, k / n), lz = lerp(z0, z1, k / n);
      posts.push({ x: L.x + lx * c + lz * s, y: L.y, z: L.z - lx * s + lz * c, r });
    }
  };
  for (const L of landmarks) (G.walls?.[L.type] || WALLS[L.type])?.(L, wall);

  await tick(1, 'Ready');
  return {
    map: M, farHeight: LF.farHeight,
    N, res: GRID_RES, origin: GRID_ORIGIN, heights: H, surface: surf,
    water: W, waterN: WATER_N, waterRes: WATER_RES,
    lake, bogFloor, puddles,
    trees: { x: Float32Array.from(trees.x), y: Float32Array.from(trees.y), z: Float32Array.from(trees.z), r: Float32Array.from(trees.r), h: Float32Array.from(trees.h), type: Uint8Array.from(trees.type), count: trees.x.length },
    boulders, beacons, landmarks, posts,
    trails: trailLines,
    river: { points: spline(RIVER.points, 6).map(([x, z]) => { const n = riverNear(x, z); return [x, z, n.level, lerp(RIVER.widthStart, RIVER.widthEnd, n.s) / 2]; }) },
    extra: K.out || {},
    genMs: Date.now() - t0,
  };
}
