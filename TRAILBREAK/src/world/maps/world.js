// The open world: every map's ground joined into one, driven without a loading screen between them. World axes as on
// every map: +x east, +z south, +y up, metres.
//
// From the Arabian Sea inland: the Konkan Coast (8 km) round Kashid; east of it the Konkan Ghat, a stretch of upland the
// Kashid ghat road carries on across, down to the river that comes out of Kerala and up into Kerala's hills; the Kerala
// Ghats; north of their tea plateau the Ashwood Pass, a saddle in the range; and over it, Ashwood Valley under its snow.
//
// Each map is built as it always is (world/WorldGen.js), in its own frame, and stands in the world at its centre below;
// a map here differs from the one driven alone only where a road leaves it: its edge's ridge cut down to a pass, and a
// spur of road from its tracks out through the pass to its edge (added after its own trails, so its puddles, boulders
// and trees fall where they do on the map alone). The two stretches between the maps are maps of their own: their
// ground, made to carry on from the maps either side, is laid onto those maps' own edges at the end (their heights
// and slopes, so nothing steps or kinks where they meet), with their roads meeting the spurs there.
import { fbm, ridged, vnoise } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';
import { landform, spline, limitGrade } from '../WorldGen.js';
import { COAST } from './coast.js';
import { KERALA, KERALA_WALLS, baseHeight as keralaBase, SEED as KERALA_SEED, RIVER as KERALA_RIVER } from './kerala.js';
import { ASHWOOD, WORLD_SEED as ASHWOOD_SEED } from './ashwood.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);
const gauss = (d, w) => Math.exp(-((d / w) ** 2));

// ---------------------------------------------------------------- the maps as they stand in the world
// (each map's centre in the world; their squares meet edge to edge, their grids' lines on each other's)
export const CENTRES = { coast: [0, 0], ghat: [5024, -700], kerala: [7072, -700], pass: [7072, -2748], ashwood: [7072, -4796] };

// a pass through a map's edge ridge: the ridge (the part of its height its generator adds within 330 m of the edge)
// cut down to the land behind it, on a line across the edge (along: 'x' for a pass in the north or south edge, 'z' in
// the west or east one; at: where along it; side: which edge, by the sign of the other coordinate)
const passCut = (wall, passes) => (x, z) => {
  const w = wall(x, z);
  if (w <= 0) return 0;
  let k = 0;
  for (const p of passes) {
    if (p.along === 'x' ? Math.sign(z) !== p.side : Math.sign(x) !== p.side) continue;
    k = Math.max(k, gauss((p.along === 'x' ? x : z) - p.at, p.w ?? 120));
  }
  return w * k * 0.94;
};

// Kerala: its forested ridges round the edge (kerala.js baseHeight's last term), and its passes: west towards the
// coast (along the spur south of Rubber Estate Hill), north to Ashwood (between Kurinji Top and Vadakku Peak)
const keralaWall = (x, z) => {
  const e = Math.max(Math.abs(x), Math.abs(z));
  return e > 850 ? smoothstep(850, 1180, e) * (210 + 130 * ridged(x / 240, z / 240, 4, KERALA_SEED + 20)) : 0;
};
const keralaPasses = passCut(keralaWall, [{ along: 'z', at: 40, side: -1 }, { along: 'x', at: 30, side: -1 }]);
const keralaGround = (x, z) => keralaBase(x, z) - keralaPasses(x, z);
// Ashwood: the walls of its valley (WorldGen's own landform), and its pass south, where the old valley road leaves it
const ashwoodWall = (x, z) => {
  const e = Math.max(Math.abs(x), Math.abs(z));
  return e > 850 ? smoothstep(850, 1180, e) * (230 + 140 * ridged(x / 240, z / 240, 4, ASHWOOD_SEED + 20)) : 0;
};
const ashwoodPasses = passCut(ashwoodWall, [{ along: 'x', at: 20, side: 1 }]);
const ashwoodGround = (x, z) => landform(ASHWOOD).baseHeight(x, z) - ashwoodPasses(x, z);

/** The coast as it stands in the world: the Kashid ghat road carried on to its east edge. */
export const COAST_W = {
  ...COAST, id: 'coast@world',
  trails: [...COAST.trails,
    { name: 'Kashid Ghat East', kind: 'road', width: 3.6, lanes: 2, grade: 0.11, smooth: 24, cut: 7, shoulder: 8, level: true, extend: [0, 8], points: [[3960, -700], [3980, -685.5], [3999.9, -671.1]] }],
  gen: graded([{ road: 'Kashid Ghat East', grade: 0.1, ends: ['ground'] }], COAST.gen),
};

/** Kerala as it stands in the world: passes west and north, and the roads out through them. */
export const KERALA_W = {
  ...KERALA, id: 'kerala@world', baseHeight: keralaGround,
  trails: [...KERALA.trails,
    // (off the paddy and rubber track below Rubber Estate Hill, west along the spur and through the pass to the coast:
    // the Konkan Ghat Road's two lanes and their lines carried on to the track)
    { name: 'Konkan Road', kind: 'road', width: 3.6, lanes: 2, shoulder: 8, level: true, grade: 0.12, cut: 6, extend: [0, 8], points: [[-558, 47], [-610, 44], [-690, 42], [-770, 40], [-860, 40], [-950, 40], [-1024, 40]] },
    // (off the Kurinji jeep track below the summit, north through the gap between the peaks: gravel, as the pass road it
    // runs on into is)
    { name: 'Pass Road', kind: 'road', width: 3.4, grade: 0.12, cut: 6, extend: [0, 8], surface: SURFACE.GRAVEL, points: [[17, -775], [20, -850], [25, -940], [30, -1024]] },
    // (the corner from the estate road onto the jeep track at the factory, worn smooth: the road is cut into the slope
    // there a metre and a half below the yard's edge, a crest a long truck grounds on as it turns)
    { name: 'Factory Turn', kind: 'trail', width: 2.4, points: [[57, -633], [54, -641], [55.5, -647], [60, -648.5], [66, -646], [69, -643]] }],
  gen: graded([{ road: 'Konkan Road', grade: 0.12, ends: ['ground'] }, { road: 'Pass Road', grade: 0.12, ends: ['ground'] },
    { road: 'Factory Turn', grade: 0.12, smooth: 8, ends: ['ground', 'ground'] }], KERALA.gen),
};

/** Ashwood as it stands in the world: a pass south, and the old valley road on through it. */
export const ASHWOOD_W = {
  ...ASHWOOD, id: 'ashwood@world', baseHeight: ashwoodGround,
  trails: [...ASHWOOD.trails, { name: 'Pass Road', kind: 'road', width: 3.4, extend: [0, 8], points: [[10, 890], [14, 950], [18, 1000], [20, 1024]] }],
};

// (the roads that cross a seam: extend: [start, end] m, each paved straight on past its end at the seam, and its lines
// and wear with it, each map drawing only its own side: so a road crossing a seam at a slant is paved right up to it
// on both sides, world/WorldGen.js, render/RoadMarkings.js, render/RoadWear.js)

// ---------------------------------------------------------------- seams, and roads on graded ground
/**
 * A stretch's ground laid onto the maps either side of it (seams: each { side, at0, step, h, g }: the neighbour's
 * heights along the shared edge every `step` m from `at0` (in the stretch's frame), and how steeply its ground runs up
 * towards the edge). Within `band` m of an edge the stretch's own ground gives way to the neighbour's carried on past
 * its edge, its slope fading over a few tens of metres: on the edge itself the two are the same height. What is
 * carried in is the neighbour's edge averaged along it over more of it the further in (half as far either way as it is
 * in, up to 80 m): its hills and valleys run on into the stretch, but not its every hummock and rill, drawn out
 * straight across the band into furrows.
 */
function onSeams(seams, half, x, z, h) {
  for (const sm of seams) {
    const B = sm.band ?? 220, D0 = 28;
    const dist = sm.side === 'west' ? x + half : sm.side === 'east' ? half - x : sm.side === 'north' ? z + half : half - z;
    if (dist >= B) continue;
    const q = ((sm.side === 'west' || sm.side === 'east' ? z : x) - sm.at0) / sm.step, q0 = Math.min(Math.floor(q), sm.h.length - 2);
    if (q < 0 || q > sm.h.length - 1) continue;
    const f = q - q0, w = Math.min(80, Math.max(0, dist) * 0.5) / sm.step;
    const eh = edgeMean(sm, 'h', q0, w) * (1 - f) + edgeMean(sm, 'h', q0 + 1, w) * f;
    const eg = edgeMean(sm, 'g', q0, w) * (1 - f) + edgeMean(sm, 'g', q0 + 1, w) * f;
    h = lerp(h, eh + eg * D0 * (1 - Math.exp(-dist / D0)), smoothstep(B, 0, dist));
  }
  return h;
}

/** A seam's heights or slopes (key 'h' or 'g') at point i, averaged over w points either way (w fractional). */
function edgeMean(sm, key, i, w) {
  // (running sums along the edge, made once a seam)
  const sums = (sm.sums ||= {})[key] ||= (() => {
    const a = sm[key], c = new Float64Array(a.length + 1);
    for (let k = 0; k < a.length; k++) c[k + 1] = c[k] + a[k];
    return c;
  })();
  const n = sm[key].length, box = (W) => {
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W);
    return (sums[hi + 1] - sums[lo]) / (hi - lo + 1);
  };
  const W0 = Math.floor(w), t = w - W0;
  return t ? box(W0) * (1 - t) + box(W0 + 1) * t : box(W0);
}
const seamDist = (seams, half, x, z) => {
  let d = Infinity;
  for (const sm of seams) d = Math.min(d, sm.side === 'west' ? x + half : sm.side === 'east' ? half - x : sm.side === 'north' ? z + half : half - z);
  return d;
};

/**
 * A stretch's edges made its neighbours' exactly, once everything is cut into it (its roads' and its river's own cuts
 * went over the ground the neighbour had already cut its own into): what is left between the two shifted out of the
 * ground over the last few metres in from the edge.
 */
function closeSeams(ctx) {
  const { M, H, N, res, origin } = ctx, B = 30, nB = Math.ceil(B / res);
  for (const sm of M.seams || []) {
    for (let t = 0; t < N; t++) {
      const q = (origin + t * res - sm.at0) / sm.step, q0 = Math.min(Math.floor(q), sm.h.length - 2);
      if (q < 0 || q > sm.h.length - 1) continue;
      const cell = (d) => (sm.side === 'west' ? t * N + d : sm.side === 'east' ? t * N + N - 1 - d : sm.side === 'north' ? d * N + t : (N - 1 - d) * N + t);
      const off = sm.h[q0] + (sm.h[q0 + 1] - sm.h[q0]) * (q - q0) - H[cell(0)];
      for (let d = 0; d <= nB; d++) H[cell(d)] += off * smoothstep(B, 0, d * res);
    }
  }
}

/**
 * Roads on graded ground: the ground along each (its trail in M.trails, by name), smoothed and kept within its grade,
 * cut into the rises and built up over the dips as deep as that takes, its ends held where they must be ('ground': on
 * the ground there, which on a seam is the neighbour's road; { road }: on that road); and the ground along it laid onto
 * that line, banked either side. A map's prepare, fine and surface hooks (its own run first); on a stretch, its seams
 * too.
 */
function graded(specs, own = {}) {
  return {
    ...own,
    prepare(c) {
      own.prepare?.(c);
      const { M, K, coarseAt, res, half } = c;
      K.seams = M.seams || []; K.half = half; K.beds = [];
      const ground = (x, z) => onSeams(K.seams, half, x, z, coarseAt(x, z));
      for (const sp of specs) {
        const tr = M.trails.find((t) => t.name === sp.road), pts = spline(tr.points, res), n = pts.length;
        const arc = [0];
        for (let i = 1; i < n; i++) arc.push(arc[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        let hs = pts.map(([x, z]) => ground(x, z));
        const win = Math.max(1, Math.round((sp.smooth ?? 30) / res));
        for (let pass = 0; pass < 3; pass++) {
          const out = new Array(n);
          for (let i = 0; i < n; i++) {
            let sum = 0, cnt = 0;
            for (let q = Math.max(0, i - win); q <= Math.min(n - 1, i + win); q++) { sum += hs[q]; cnt++; }
            out[i] = sum / cnt;
          }
          hs = out;
        }
        const gr = sp.grade * 0.95, step = arc.map((a, i) => (i ? (a - arc[i - 1]) * gr : 0));
        const cut = limitGrade(hs, step, Math.min), fill = limitGrade(hs, step, Math.max);
        hs = hs.map((_, i) => (cut[i] + fill[i]) / 2);
        // its ends held: everything within the grade of them
        (sp.ends || []).forEach((e, j) => {
          if (!e) return;
          const ie = j ? n - 1 : 0, [ex, ez] = pts[ie];
          let P;
          if (e === 'ground') P = ground(ex, ez);
          else {
            const o = K.beds.find((b) => b.name === e.road);
            let bd = Infinity;
            for (let i = 0; i < o.pts.length; i++) { const d = hyp(o.pts[i][0] - ex, o.pts[i][1] - ez); if (d < bd) { bd = d; P = o.hs[i]; } }
          }
          for (let i = 0; i < n; i++) { const r = gr * Math.abs(arc[i] - arc[ie]); hs[i] = clamp(hs[i], P - r, P + r); }
        });
        // the corridor: each cell's distance from the line and the line's height there
        const bed = tr.width + 4, reach = bed + 90;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        x0 = Math.max(-half, Math.floor((x0 - reach) / res) * res); z0 = Math.max(-half, Math.floor((z0 - reach) / res) * res);
        x1 = Math.min(half, x1 + reach); z1 = Math.min(half, z1 + reach);
        const nx = Math.round((x1 - x0) / res) + 1, nz = Math.round((z1 - z0) / res) + 1;
        const D = new Float32Array(nx * nz).fill(1e9), P = new Float32Array(nx * nz), r = Math.ceil(reach / res);
        for (let p = 0; p < n; p++) {
          const [px, pz] = pts[p], ci = Math.round((px - x0) / res), ck = Math.round((pz - z0) / res);
          for (let k = Math.max(0, ck - r); k <= Math.min(nz - 1, ck + r); k++) {
            const dz = z0 + k * res - pz;
            for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
              const dx = x0 + i * res - px, d = Math.sqrt(dx * dx + dz * dz), o = k * nx + i;
              if (d < D[o]) { D[o] = d; P[o] = hs[p]; }
            }
          }
        }
        K.beds.push({ name: sp.road, pts, hs, x0, z0, nx, nz, res, D, P, bed, reach });
      }
    },
    fine(x, z, h, K) {
      if (own.fine) h = own.fine(x, z, h, K);
      if (K.seams.length) h = onSeams(K.seams, K.half, x, z, h);
      for (const b of K.beds) {
        const i = Math.round((x - b.x0) / b.res), k = Math.round((z - b.z0) / b.res);
        if (i < 0 || k < 0 || i >= b.nx || k >= b.nz) continue;
        const o = k * b.nx + i, d = b.D[o];
        if (d >= b.reach) continue;
        const p = b.P[o], bank = Math.min(b.reach - b.bed, Math.max(10, 1.5 * Math.abs(h - p)));
        let w = d <= b.bed ? 1 : smoothstep(b.bed + bank, b.bed, d);
        // (on a seam the neighbour's ground stands as it is: its own road is there)
        if (K.seams.length) w *= smoothstep(0, 24, seamDist(K.seams, K.half, x, z));
        h = lerp(h, p, w);
      }
      return h;
    },
    // (towards a seam with Kerala, its forest's rule for bare rock, as on Kerala's own side: only on the sheerest
    // faces, the rest of its steep ground grown over; giving way raggedly to this map's own over M.keralaRock m)
    surface(x, z, h, sl, s, idx, ctx) {
      if (own.surface) s = own.surface(x, z, h, sl, s, idx, ctx);
      const { K, M } = ctx;
      if (s !== SURFACE.ROCK || !K.seams.length || !M.keralaRock) return s;
      for (const sm of K.seams) {
        if (sm.id !== 'kerala') continue;
        const d = sm.side === 'west' ? x + K.half : sm.side === 'east' ? K.half - x : sm.side === 'north' ? z + K.half : K.half - z;
        const t = smoothstep(M.keralaRock, M.keralaRock * 0.5, d);
        if (t > 0 && vnoise(x / 9, z / 9, M.seed + 61) < t * 1.15 && sl < 1.25 + 0.4 * vnoise(x / 13, z / 13, M.seed + 62)) return SURFACE.GRASS;
      }
      return s;
    },
    finish(ctx) { own.finish?.(ctx); closeSeams(ctx); },
  };
}

// the Kerala river where it leaves Kerala's west edge (in Kerala's frame), and its level there
let keralaOut = null;
function keralaRiverOut() {
  if (keralaOut) return keralaOut;
  const pts = spline(KERALA_RIVER.points, 2);
  let best = pts[0];
  for (const p of pts) if (Math.abs(p[0] + 1024) < Math.abs(best[0] + 1024)) best = p;
  const level = landform(KERALA_W).riverNear(-1024, best[1]).level;
  keralaOut = { z: best[1], level };
  return keralaOut;
}

const GHAT_SEED = 5150, PASS_SEED = 6260;
// the stretches' races' par times (s)
const GHAT_PAR = { ghatroad: { gold: 117, silver: 140, bronze: 173 }, kundalika: { gold: 58, silver: 69, bronze: 85 } };
const PASS_PAR = { passclimb: { gold: 79, silver: 95, bronze: 118 }, cairnridge: { gold: 78, silver: 93, bronze: 115 } };
// the river out of Kerala across the Konkan Ghat (its frame): its last bends in Kerala as Kerala has them (so the two
// lines are one where they meet), then south-west out of the world
const GHAT_RIVER = [...KERALA_RIVER.points.slice(-4).map(([x, z]) => [x + 2048, z]), [740, 950], [650, 1040], [560, 1150]];
const distToLine = (pts, x, z) => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az, wx = x - ax, wz = z - az;
    const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
    best = Math.min(best, hyp(wx - vx * t, wz - vz * t));
  }
  return best;
};

// The Konkan Ghat: the coast's tableland carried east as rolling upland (its real ground at the coast's edge), falling
// away to the south into the valley of the river out of Kerala, and rising in the east into Kerala's ridges, through
// the gap the Konkan road takes.
const ghatGround = (x, z) => {
  const S = GHAT_SEED;
  const upland = 168 + 26 * fbm(x / 520, z / 520, 3, S + 1) + 10 * fbm(x / 140, z / 140, 2, S + 2);
  const coast = COAST.baseHeight(x + CENTRES.ghat[0], z + CENTRES.ghat[1]);
  const kerala = keralaGround(x - 2048, z);
  let h = lerp(upland, coast, smoothstep(-450, -1024, x));
  h = lerp(h, kerala, smoothstep(250, 1024, x));
  // the river's valley: a broad floor, its sides rising gently away from it to the upland and the range
  const valley = 26 + 0.12 * Math.max(0, distToLine(GHAT_RIVER, x, z) - 120) + 4 * fbm(x / 200, z / 200, 2, S + 3);
  return Math.min(h, valley);
};

/** The river out of Kerala carried on across the Konkan Ghat and out of the world to the south. */
function ghatRiver() {
  const out = keralaRiverOut();
  const points = GHAT_RIVER, pts = spline(points, 2);
  let len = 0, sSeam = 0;
  for (let i = 1; i < pts.length; i++) {
    len += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (pts[i - 1][0] >= 1024 && pts[i][0] < 1024) sSeam = len;
  }
  sSeam /= len;
  return {
    points, widthStart: 21.5, widthEnd: 24, depthStart: 2.0, depthEnd: 2.2, fords: [],
    // (falling on at 0.8%, out of the gorge it cut in the range into its own broad valley)
    levelAt: (s) => out.level - 0.008 * len * (s - sSeam),
    valleyAt: (s) => { const k = smoothstep(sSeam, sSeam + 0.3, s); return [lerp(230, 260, k), lerp(100, 120, k)]; },
  };
}

const ghatTrees = (ctx) => {
  const { surf, R, trees: T, clear, cellOf, trailD, trailW, waterAt, hAt, onCourse, H } = ctx;
  const add = (x, z, type, ht, r) => { T.x.push(x); T.y.push(hAt(x, z)); T.z.push(z); T.h.push(ht); T.r.push(r); T.type.push(type); };
  const half = 1024, S = GHAT_SEED, STEP = 6;
  // kinds (the Kerala set): 0 coconut, 1 jungle giant, 2 mango/jack, 3 rubber, 4 banana, 5 bamboo
  for (let z = -half + 3; z < half - 3; z += STEP) {
    for (let x = -half + 3; x < half - 3; x += STEP) {
      const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9, roll = R(), pick = R();
      const idx = cellOf(px, pz), s = surf[idx];
      if (s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.GRAVEL || s === SURFACE.ROCK || s === SURFACE.ROAD) continue;
      if (trailD(idx) < trailW(idx) + 6) continue;
      const wl = waterAt(px, pz);
      if (wl > -1e8 && H[idx] < wl + 0.3) continue;
      let blocked = false;
      for (const [cx, cz, cr] of clear) if (Math.abs(px - cx) < cr && Math.abs(pz - cz) < cr && hyp(px - cx, pz - cz) < cr) { blocked = true; break; }
      if (blocked || onCourse(px, pz)) continue;
      // woods in the folds and along the river, open grass and scrub on the upland, a rubber estate by the road
      const patch = fbm(px / 160, pz / 160, 2, S + 10) + 0.5 * fbm(px / 55, pz / 55, 2, S + 11);
      const valley = smoothstep(180, 40, hAt(px, pz) - 30);
      const rubber = vnoise(px / 260, pz / 260, S + 12) > 0.7 && hyp(px + 150, pz - 60) < 520;
      const dens = rubber ? 0.32 : 0.02 + 0.2 * smoothstep(-0.1, 0.45, patch) + 0.18 * valley;
      if (roll > dens) continue;
      if (rubber) { add(px, pz, 3, 9 + R() * 6, 0.16); continue; }
      if (valley > 0.6 && pick < 0.35) { add(px, pz, 0, 10 + R() * 10, 0.17); continue; }
      if (vnoise(px / 90, pz / 90, S + 13) > 0.74 && pick < 0.5) { add(px, pz, 5, 9 + R() * 7, 0.55); continue; }
      if (pick < 0.5) { const ht = 15 + R() * 13; add(px, pz, 1, ht, 0.3 + ht * 0.012); continue; }
      add(px, pz, 2, 8 + R() * 8, 0.28);
    }
  }
};

/** The Konkan Ghat: from the Kashid ghat at the coast's edge to the pass into Kerala. */
export const GHAT = {
  id: 'ghat', name: 'Konkan Ghat', short: 'Ghat',
  seed: GHAT_SEED, station: { x: -150, z: 64, name: 'Ghat Dhaba' }, spawn: { x: -130, z: 80, yaw: Math.PI / 2 }, dealer: 'Konkan Motors',
  half: 1024, res: 1, coarse: 4, waterRes: 2, farWoods: 0.9,
  load: () => COAST.load(), baseHeight: ghatGround, roughOf: (h) => clamp((h - 40) / 200, 0.2, 0.8),
  get river() { return ghatRiver(); }, peaks: [],
  trails: [
    { name: 'Konkan Ghat Road', kind: 'road', width: 3.6, lanes: 2, grade: 0.09, smooth: 30, cut: 7, shoulder: 8, level: true, extend: [8, 8],
      points: [[-1024, 29], [-964, 72], [-880, 92], [-760, 96], [-600, 70], [-420, 40], [-240, 52], [-60, 84], [140, 70], [340, 60], [540, 44], [720, 30], [860, 36], [960, 40], [1024, 40]] },
    // (down off the road into the river's valley, and up it along the bank to below the gorge)
    { name: 'Kundalika River Track', kind: 'trail', width: 2.2, points: [[340, 60], [400, 250], [480, 430], [570, 600], [650, 740], [720, 840], [770, 885]] },
  ],
  beacons: [{ id: 0, name: 'Ghat Top', x: -890, z: 95 }, { id: 1, name: 'Kundalika Bank', x: 766, z: 880 }],
  landmarks: [{ type: 'chaistall', x: -132, z: 44, yaw: 0.1 }, { type: 'busstop', x: -176, z: 48, yaw: -0.05 }],
  events: [], modes: null,
  races: [
    // (par times: a careful driver in each stock truck, test/world.test.mjs; gold about the best of them)
    { id: 'ghatroad', kind: 'rally', name: 'Konkan Ghat Road', desc: 'The ghat road from the edge of the Konkan Coast across the upland and down through the gap in the ridges into Kerala.',
      trail: 'Konkan Ghat Road', from: [-964, 72], to: [960, 40], cps: 6, r: 12, par: GHAT_PAR.ghatroad, prize: 1.4 },
    { id: 'kundalika', kind: 'rally', name: 'Kundalika Descent', desc: 'Off the ghat road and down the river track to the bank of the river out of Kerala.',
      trail: 'Kundalika River Track', from: [340, 60], to: [770, 885], cps: 4, r: 10, par: GHAT_PAR.kundalika, prize: 1.1 },
  ],
  roadSurface: SURFACE.ROAD, puddles: 4,
  // (the ghat's steep ground grown over as Kerala's is, all the way to the coast: its escarpment up to Kerala's ridges
  // green, bare rock only on its sheerest faces)
  keralaRock: 4096,
  pads: { chaistall: 5, busstop: 3 },
  gen: { walls: KERALA_WALLS, trees: ghatTrees,
    ...graded([{ road: 'Konkan Ghat Road', grade: 0.09, ends: ['ground', 'ground'] }, { road: 'Kundalika River Track', grade: 0.2, ends: [{ road: 'Konkan Ghat Road' }, 'ground'] }]) },
  litter: COAST.litter, treeStrength: COAST.treeStrength, young: COAST.young, roadside: COAST.roadside,
  dust: COAST.dust, mudTint: COAST.mudTint, ground: 'coast', trees: 'kerala', atmosphere: COAST.atmosphere,
};

// The Ashwood Pass: Kerala's tea plateau carried north and Ashwood's valley mouth carried south meet across a saddle
// in the range, the pass road's line through it lower than the ridges either side.
const passLine = (z) => 25 + 40 * Math.sin((z + 1024) / 2048 * Math.PI * 3) * smoothstep(1024, 600, Math.abs(z));
const passGround = (x, z) => {
  const S = PASS_SEED;
  const range = 330 + 90 * ridged(x / 320, z / 320, 4, S + 1) + 25 * fbm(x / 120, z / 120, 3, S + 2);
  const kerala = keralaGround(x, z + 2048), ashwood = ashwoodGround(x, z - 2048);
  let h = lerp(range, kerala, smoothstep(150, 1024, z));
  h = lerp(h, ashwood, smoothstep(-150, -1024, z));
  // the pass: a broad gap down the middle, from Kerala's side of it to Ashwood's
  const t = (1024 - z) / 2048;
  const gap = lerp(keralaGround(30, -1024), ashwoodGround(20, 1024), smoothstep(0, 1, t)) + 22 * Math.sin(t * Math.PI);
  return lerp(h, Math.min(h, gap), gauss(x - passLine(z), 210) * 0.9);
};

/** The Ashwood Pass: from Kerala's tea plateau over the range to Ashwood Valley. */
export const PASS = {
  id: 'pass', name: 'Ashwood Pass', short: 'Pass',
  seed: PASS_SEED, station: { x: 110, z: -60, name: 'Pass Hut' }, spawn: { x: 95, z: -45, yaw: 0 }, dealer: 'Ashwood 4x4 Sales',
  half: 1024, res: 1, coarse: 4, waterRes: 2, farWoods: 0.75,
  baseHeight: passGround, roughOf: (h) => clamp((h - 80) / 220, 0.25, 1),
  river: null, peaks: [], snowLine: 390,
  // (the snow comes down to 390 m on the Ashwood side; towards Kerala, whose ridges are laid onto the south of the pass
  // and are green, it stays above them)
  snowLineAt: (x, z) => 390 + 180 * smoothstep(600, 900, z),
  // (and its steep ground grown over as Kerala's is for 210 m in from the seam, giving way to bare rock over as far again)
  keralaRock: 420,
  trails: [
    { name: 'Ashwood Pass Road', kind: 'road', width: 3.4, grade: 0.12, smooth: 24, cut: 6, extend: [8, 8],
      points: [[30, 1024], [40, 900], [62, 760], [40, 600], [0, 430], [-10, 250], [20, 60], [60, -120], [52, -300], [10, -480], [-12, -660], [0, -820], [14, -940], [20, -1024]] },
    { name: 'Cairn Ridge Trail', kind: 'trail', width: 2.1, points: [[-10, 250], [-150, 210], [-290, 130], [-390, 10], [-420, -130], [-350, -250], [-210, -320], [-70, -330], [52, -300]] },
  ],
  beacons: [{ id: 0, name: 'Ashwood Pass', x: 30, z: 40 }, { id: 1, name: 'Cairn Ridge', x: -405, z: -60 }],
  landmarks: [{ type: 'cabin', x: 128, z: -72, yaw: 1.3 }, { type: 'flag', x: 96, z: -30, yaw: 0 }],
  events: [], modes: null,
  races: [
    { id: 'passclimb', kind: 'rally', name: 'Ashwood Pass Climb', desc: 'From the floor of Ashwood Valley up the pass road to the saddle, two hundred metres higher.',
      trail: 'Ashwood Pass Road', from: [14, -940], to: [-10, 250], cps: 6, r: 12, par: PASS_PAR.passclimb, prize: 1.4 },
    { id: 'cairnridge', kind: 'rally', name: 'Cairn Ridge Trail', desc: 'Off the top of the pass and round the ridge to the west on the cairn trail, and back down to the road.',
      trail: 'Cairn Ridge Trail', from: [-10, 250], to: [52, -300], cps: 5, r: 10, par: PASS_PAR.cairnridge, prize: 1.2 },
  ],
  puddles: 3,
  gen: graded([{ road: 'Ashwood Pass Road', grade: 0.12, ends: ['ground', 'ground'] },
    { road: 'Cairn Ridge Trail', grade: 0.22, ends: [{ road: 'Ashwood Pass Road' }, { road: 'Ashwood Pass Road' }] }]),
  treeStrength: ASHWOOD.treeStrength, young: ASHWOOD.young, roadside: ASHWOOD.roadside,
  ground: 'ashwood', trees: 'ashwood',
};

// ---------------------------------------------------------------- the world
/** The maps of the world, west to east then north: id, definition, centre, the maps along each of its edges. */
export const REGIONS = [
  { id: 'coast', map: COAST_W, at: CENTRES.coast },
  { id: 'ghat', map: GHAT, at: CENTRES.ghat, seams: { west: 'coast', east: 'kerala' } },
  { id: 'kerala', map: KERALA_W, at: CENTRES.kerala },
  { id: 'pass', map: PASS, at: CENTRES.pass, seams: { south: 'kerala', north: 'ashwood' } },
  { id: 'ashwood', map: ASHWOOD_W, at: CENTRES.ashwood },
];
export const regionById = (id) => REGIONS.find((r) => r.id === id);

/** The open world, as the lobby and the rooms know it. */
// the world's own race, across its maps: through each map's roads in turn (world coordinates; the satnav's routes
// between these points, game/Races.js)
const at = (id, [x, z]) => [Math.round(x + CENTRES[id][0]), Math.round(z + CENTRES[id][1])];
const COAST_GHAT = COAST.trails.find((t) => t.name === 'Kashid Ghat').points;
const COAST_TO_SNOW = [
  COAST_GHAT[4], COAST_GHAT[Math.round(COAST_GHAT.length / 2)], [3960, -700],              // up the Kashid ghat
  at('ghat', [140, 70]), at('kerala', [-760, 40]), at('kerala', [40, 60]),                   // over the Konkan Ghat into Kerala's town
  at('kerala', [17, -775]), at('pass', [60, -120]), at('ashwood', [10, 890]), at('ashwood', [-58, 430]),   // up the jeep track and over the pass
].map(([x, z]) => [Math.round(x), Math.round(z)]);

export const WORLD = {
  id: 'world', name: 'Open World', short: 'World',
  races: [
    { id: 'coasttosnow', kind: 'rally', name: 'Coast to Snow', desc: 'Kashid to Ashwood: up the Kashid ghat, over the Konkan Ghat into Kerala, through the town and the tea, over the Ashwood Pass and down to the ranger station.',
      via: COAST_TO_SNOW, cps: 16, r: 14, par: { gold: 1575, silver: 1889, bronze: 2330 }, prize: 4 },
  ],
  blurb: 'The Konkan Coast, the Kerala Ghats and Ashwood Valley in one world: drive from the Arabian Sea up the ghats, through the tea estates and over the pass to the snow, with no loading on the way.',
  tagline: 'Old trucks, real physics, good friends. One world from the sea to the snow: drive it together.',
  start: 'coast', dealer: COAST.dealer, atmosphere: COAST.atmosphere,
};
