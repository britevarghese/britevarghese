// The Konkan Coast: 8 x 8 km of the real coast of Raigad, Maharashtra, round Kashid beach (18.44 N, 72.922 E). World
// axes: +x east, +z south, +y up, metres from the middle.
//
// The ground is the real one (tools/konkan.py bakes it): SRTM heights, and what grows or stands on every 10 m from
// ESA WorldCover. The Arabian Sea along the west; Kashid's long crescent of pale sand between two wooded headlands,
// the village behind it and its paddy fields; then the escarpment, two hundred and fifty metres of forest climbing to
// the laterite tableland of the Phansad hills, cut by deep valleys, with a reservoir in one of them to the north.
//
// The roads are routed over that ground (tools/konkan.py roads: world/maps/coastRoads.js): the coast road along the
// shore the whole length of the map, behind the beach and round the northern headland; the Kashid ghat climbing from
// the village in hairpins to the tableland and across it to the east; the south ghat up from the paddy valley to the
// south; the plateau road between the two across the top, past an airstrip; and a dirt track along a ridge and down
// to the reservoir. The coast road, the south ghat, the plateau road and the Kashid ghat make a loop of about 12 km.
//
// The generator (world/WorldGen.js) builds the common ground on a 2 m grid (a big map's); the hooks in `gen` add the
// sea and the reservoir, the ground's surfaces from its land cover, the airstrip's level ground, the trees.
import { fbm, vnoise } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';
import { KERALA_WALLS } from './kerala.js';
import { ROUTES } from './coastRoads.js';

export const SEED = 4410;
const S = SEED;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);
const P = Math.PI;

/** The map's half-size (m): 8 km across. */
export const HALF = 4000;
/** The sea's level (m). */
export const SEA = 0;

// ---------------------------------------------------------------- the real ground (public/assets/maps/coast)
// heights every 10 m over 8.4 km, every 40 m over 24 km (beyond the map's edge), the land cover every 10 m
const HG = { n: 841, res: 10, o: -4200 }, FG = { n: 601, res: 40, o: -12000 }, CG = { n: 801, res: 10, o: -4000 };
let HGT = null, FAR = null, COV = null, SHORE = null;
// WorldCover's classes (and the bake's: 80 the sea, 81 inland water)
export const COVER = { TREES: 10, SHRUB: 20, GRASS: 30, CROPS: 40, BUILT: 50, BARE: 60, SEA: 80, LAKE: 81, WETLAND: 90, MANGROVE: 95 };

/** Heights from the bake: uint16 in 5 cm steps from -50 m, each row as differences along it. */
function decode(buf, n) {
  const d = new Uint16Array(buf.buffer, buf.byteOffset, n * n), out = new Float32Array(n * n);
  for (let k = 0; k < n; k++) {
    let q = 0;
    for (let i = 0; i < n; i++) { q = (q + d[k * n + i]) & 0xffff; out[k * n + i] = q / 20 - 50; }
  }
  return out;
}

/** How far each 10 m cell is from the sea (m), by two sweeps of a chamfer distance (0 at sea). */
function shoreDistance(C, n) {
  const D = new Float32Array(n * n).fill(1e6), d1 = 10, d2 = 14.142;
  for (let i = 0; i < n * n; i++) if (C[i] === COVER.SEA) D[i] = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const o = k * n + i; let v = D[o];
    if (i > 0) v = Math.min(v, D[o - 1] + d1);
    if (k > 0) { v = Math.min(v, D[o - n] + d1); if (i > 0) v = Math.min(v, D[o - n - 1] + d2); if (i < n - 1) v = Math.min(v, D[o - n + 1] + d2); }
    D[o] = v;
  }
  for (let k = n - 1; k >= 0; k--) for (let i = n - 1; i >= 0; i--) {
    const o = k * n + i; let v = D[o];
    if (i < n - 1) v = Math.min(v, D[o + 1] + d1);
    if (k < n - 1) { v = Math.min(v, D[o + n] + d1); if (i < n - 1) v = Math.min(v, D[o + n + 1] + d2); if (i > 0) v = Math.min(v, D[o + n - 1] + d2); }
    D[o] = v;
  }
  return D;
}

async function read(name) {
  if (typeof window === 'undefined') {
    const fs = await import('node:fs/promises');
    return new Uint8Array(await fs.readFile(new URL(`../../../public/assets/maps/coast/${name}.bin`, import.meta.url)));
  }
  const r = await fetch(`/assets/maps/coast/${name}.bin`);
  if (!r.ok) throw new Error(`the Konkan Coast's ${name}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Fetch the ground's grids (once), and lay out what stands on them (the villages' houses). */
async function load() {
  if (HGT) return;
  const [h, f, c] = await Promise.all(['height', 'far', 'cover'].map(read));
  HGT = decode(h, HG.n); FAR = decode(f, FG.n); COV = c;
  SHORE = shoreDistance(COV, CG.n);
  villages();
}

/** Bicubic (Catmull-Rom) height on a grid. */
function cubic(G, g, x, z) {
  const n = g.n, fx = clamp((x - g.o) / g.res, 1, n - 2.001), fz = clamp((z - g.o) / g.res, 1, n - 2.001);
  const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
  const w = (t) => [((-t + 2) * t - 1) * t / 2, ((3 * t - 5) * t * t + 2) / 2, ((-3 * t + 4) * t + 1) * t / 2, (t - 1) * t * t / 2];
  const wx = w(tx), wz = w(tz);
  let h = 0;
  for (let b = 0; b < 4; b++) {
    const o = (k - 1 + b) * n + i - 1;
    h += (G[o] * wx[0] + G[o + 1] * wx[1] + G[o + 2] * wx[2] + G[o + 3] * wx[3]) * wz[b];
  }
  return h;
}

/** The real ground's height: the 10 m grid over the map and just round it, the 40 m grid beyond, blended between. */
export function groundHeight(x, z) {
  const e = Math.max(Math.abs(x), Math.abs(z));
  if (e < 4100) return cubic(HGT, HG, x, z);
  const far = cubic(FAR, FG, x, z);
  return e >= 4180 ? far : lerp(cubic(HGT, HG, x, z), far, (e - 4100) / 80);
}

const cell = (x, z) => clamp(Math.round((z - CG.o) / CG.res), 0, CG.n - 1) * CG.n + clamp(Math.round((x - CG.o) / CG.res), 0, CG.n - 1);
/** The land cover at a point (WorldCover's class). */
export const coverAt = (x, z) => COV[cell(x, z)];
/**
 * The land cover with its edges frayed: looked up a few metres off, by a noise (the 10 m cells' squares would show
 * on the ground as stairs along the edge of a beach, a field or a village).
 */
const softCover = (x, z) => COV[cell(x + 14 * (vnoise(x / 13, z / 13, S + 61) - 0.5), z + 14 * (vnoise(x / 13 + 5.3, z / 13 - 2.9, S + 62) - 0.5))];
/** How far a point is from the sea (m; bilinear between the 10 m cells). */
export function shoreAt(x, z) {
  const fx = clamp((x - CG.o) / CG.res, 0, CG.n - 1.001), fz = clamp((z - CG.o) / CG.res, 0, CG.n - 1.001);
  const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k, n = CG.n, o = k * n + i;
  return (SHORE[o] * (1 - tx) + SHORE[o + 1] * tx) * (1 - tz) + (SHORE[o + n] * (1 - tx) + SHORE[o + n + 1] * tx) * tz;
}

const roughOf = () => 0.12;                   // (the real ground has its own hills: only a little roughness on it)

// ---------------------------------------------------------------- the roads
/**
 * A road's line from its corners: [x, z, r] (r: the corner's radius, m), each corner rounded off with an arc of its
 * radius (less where the legs either side are too short for it), then points every `step` metres along it. Even
 * spacing keeps the curve the generator draws through them (a Catmull-Rom spline) true to the arcs: uneven spacing
 * overshoots into kinks.
 */
function road(corners, step = 8) {
  const path = [corners[0].slice(0, 2)];
  for (let i = 1; i < corners.length - 1; i++) {
    const [ax, az] = corners[i - 1], [bx, bz, r = 0] = corners[i], [cx, cz] = corners[i + 1];
    const l1 = hyp(bx - ax, bz - az), l2 = hyp(cx - bx, cz - bz);
    const ux = (bx - ax) / l1, uz = (bz - az) / l1, vx = (cx - bx) / l2, vz = (cz - bz) / l2;
    const turn = Math.acos(clamp(ux * vx + uz * vz, -1, 1));
    if (r <= 0 || turn < 1e-3) { path.push([bx, bz]); continue; }
    const t = Math.min(r * Math.tan(turn / 2), l1 * 0.5, l2 * 0.5), rr = t / Math.tan(turn / 2);
    const side = Math.sign(ux * vz - uz * vx);                               // (+: turning right, toward +x of -z)
    const sx = bx - ux * t, sz = bz - uz * t, ox = sx - uz * rr * side, oz = sz + ux * rr * side;
    const a0 = Math.atan2(sz - oz, sx - ox), n = Math.max(2, Math.ceil(turn * rr / step));
    for (let k = 0; k <= n; k++) { const a = a0 + side * turn * k / n; path.push([ox + rr * Math.cos(a), oz + rr * Math.sin(a)]); }
  }
  path.push(corners[corners.length - 1].slice(0, 2));
  // evenly along it
  const out = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], L = hyp(bx - ax, bz - az);
    let s0 = step - carry;
    for (; s0 < L; s0 += step) out.push([ax + (bx - ax) * s0 / L, az + (bz - az) * s0 / L]);
    carry = L - (s0 - step);
  }
  const last = path[path.length - 1];
  if (hyp(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last); else out[out.length - 1] = last;
  return out.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}
/** A routed road's corners, each to be rounded with radius r. */
const rounded = (name, r) => ROUTES[name].map(([x, z], i, a) => (i === 0 || i === a.length - 1 ? [x, z] : [x, z, r]));

/** The point at distance d (m) along a line; a negative d counts back from its end. */
function along(pts, d) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let s = d < 0 ? total + d : d;
  for (let i = 1; i < pts.length; i++) {
    const L = hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (s <= L) { const t = s / L; return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t), Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])]; }
    s -= L;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  return [b[0], b[1], Math.atan2(b[0] - a[0], b[1] - a[1])];
}
/** The point of a line nearest (x, z), and how far along the line it is. */
function nearestOn(pts, x, z) {
  let best = Infinity, out = null, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, L = Math.sqrt(l2);
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = hyp(x - px, z - pz);
    if (d < best) { best = d; out = { x: px, z: pz, s: run + L * t, d, yaw: Math.atan2(dx, dz) }; }
    run += L;
  }
  return out;
}
/** A point beside a road: at distance s along it, off to its side (+ left, going along it) by `off` metres. */
function beside(pts, s, off) {
  const [x, z, yaw] = along(pts, s);
  return [Math.round(x + Math.cos(yaw) * off), Math.round(z - Math.sin(yaw) * off), yaw];
}

const COAST_RD = road(rounded('Coast Road', 250), 8);
const KASHID_GHAT = road(rounded('Kashid Ghat', 90), 6);
const SOUTH_GHAT = road(rounded('South Ghat', 90), 6);
const PLATEAU_RD = road(rounded('Plateau Road', 250), 8);
const RIDGE = road(rounded('Ridge Track', 40), 6);

// the airstrip on the tableland: its runway's line (north-west end, south-east end), its apron beside the middle (in
// the runway's frame: u along it from its middle, v across it, + to the south-west, toward the plateau road), and a
// taxiway from the runway across the apron to the road
export const RUNWAY = [[1225, -376], [1775, 576]];
const RW_LEN = hyp(RUNWAY[1][0] - RUNWAY[0][0], RUNWAY[1][1] - RUNWAY[0][1]);
const RU = [(RUNWAY[1][0] - RUNWAY[0][0]) / RW_LEN, (RUNWAY[1][1] - RUNWAY[0][1]) / RW_LEN], RV = [-RU[1], RU[0]];
const RW_MID = [(RUNWAY[0][0] + RUNWAY[1][0]) / 2, (RUNWAY[0][1] + RUNWAY[1][1]) / 2];
export const APRON = { u: 0, v: 95, hu: 60, hv: 40 };
const runwayFrame = (x, z) => { const dx = x - RW_MID[0], dz = z - RW_MID[1]; return [dx * RU[0] + dz * RU[1], dx * RV[0] + dz * RV[1]]; };
const fromRunway = (u, v) => [RW_MID[0] + RU[0] * u + RV[0] * v, RW_MID[1] + RU[1] * u + RV[1] * v];
const APRON_MID = fromRunway(APRON.u, APRON.v);
const TAXI_TO = nearestOn(PLATEAU_RD, APRON_MID[0], APRON_MID[1]);

export const TRAILS = [
  { name: 'Coast Road', kind: 'road', width: 3.8, lanes: 2, grade: 0.08, smooth: 40, cut: 6, shoulder: 9, level: true, verge: { puddles: 3 }, points: COAST_RD },
  { name: 'Kashid Ghat', kind: 'road', width: 3.6, lanes: 2, grade: 0.11, smooth: 24, cut: 7, shoulder: 8, level: true, verge: { puddles: 3 }, points: KASHID_GHAT },
  { name: 'South Ghat', kind: 'road', width: 3.6, lanes: 2, grade: 0.11, smooth: 24, cut: 7, shoulder: 8, level: true, verge: { puddles: 3 }, points: SOUTH_GHAT },
  { name: 'Plateau Road', kind: 'road', width: 4.0, lanes: 2, grade: 0.07, smooth: 40, cut: 8, shoulder: 10, level: true, verge: { puddles: 2 }, points: PLATEAU_RD },
  { name: 'Ridge Track', kind: 'trail', width: 2.3, grade: 0.22, smooth: 12, cut: 2, shoulder: 5, points: RIDGE },
  { name: 'Runway', kind: 'road', width: 15, lanes: 0, runway: true, grade: 0.006, smooth: 80, cut: 10, shoulder: 14, level: true, points: road(RUNWAY, 20) },
  { name: 'Taxiway', kind: 'road', width: 5, lanes: 0, grade: 0.05, smooth: 30, cut: 6, shoulder: 8, level: true, points: road([fromRunway(0, 0).map(Math.round), APRON_MID.map(Math.round), [Math.round(TAXI_TO.x), Math.round(TAXI_TO.z)]], 10) },
];

// ---------------------------------------------------------------- the places
// Kashid: where the ghat leaves the coast road, the village round it; the station on the inland side of the junction
const KASHID = { x: KASHID_GHAT[0][0], z: KASHID_GHAT[0][1] };
const [SPX, SPZ, SPYAW] = (() => { const q = nearestOn(COAST_RD, KASHID.x, KASHID.z); return along(COAST_RD, q.s + 40); })();
const ST = beside(COAST_RD, nearestOn(COAST_RD, KASHID.x, KASHID.z).s + 70, -26);
export const STATION = { x: ST[0], z: ST[1], name: 'Kashid Motor Station' };
// the start: on the coast road by the station, facing south along it
export const SPAWN = { x: Math.round(SPX), z: Math.round(SPZ), yaw: SPYAW };

const coastLen = (() => { let L = 0; for (let i = 1; i < COAST_RD.length; i++) L += hyp(COAST_RD[i][0] - COAST_RD[i - 1][0], COAST_RD[i][1] - COAST_RD[i - 1][1]); return L; })();
const KASHID_S = nearestOn(COAST_RD, KASHID.x, KASHID.z).s;
const SOUTH_S = nearestOn(COAST_RD, SOUTH_GHAT[0][0], SOUTH_GHAT[0][1]).s;
const plateauN = nearestOn(KASHID_GHAT, PLATEAU_RD[0][0], PLATEAU_RD[0][1]).s;
const plateauS = nearestOn(SOUTH_GHAT, PLATEAU_RD[PLATEAU_RD.length - 1][0], PLATEAU_RD[PLATEAU_RD.length - 1][1]).s;
const ridgeAt = nearestOn(KASHID_GHAT, RIDGE[0][0], RIDGE[0][1]).s;

const B = (id, name, [x, z]) => ({ id, name, x, z });
export const BEACONS = [
  B(0, 'Kashid Beach', beside(COAST_RD, KASHID_S + 380, 22)),
  B(1, 'Kashid Village', beside(COAST_RD, KASHID_S - 160, -14)),
  B(2, 'First Hairpin', beside(KASHID_GHAT, 700, 9)),
  B(3, 'Ghat Viewpoint', beside(KASHID_GHAT, ridgeAt - 180, 10)),
  B(4, 'Phansad Plateau', beside(KASHID_GHAT, plateauN + 900, 10)),
  B(5, 'East Ghat', beside(KASHID_GHAT, -350, 9)),
  B(6, 'Airstrip Apron', fromRunway(APRON.u + 30, APRON.v + 20).map(Math.round)),
  B(7, 'Plateau Crossing', beside(PLATEAU_RD, 1300, 10)),
  B(8, 'South Ghat Foot', beside(SOUTH_GHAT, 900, 9)),
  B(9, 'Paddy Valley', beside(SOUTH_GHAT, 2200, -10)),
  B(10, 'South Plateau', beside(SOUTH_GHAT, plateauS + 1500, 9)),
  B(11, 'North Headland', beside(COAST_RD, 1500, 10)),
  B(12, 'Rocky Point', beside(COAST_RD, 3600, -12)),
  B(13, 'South Shore', beside(COAST_RD, coastLen - 1600, -12)),
  B(14, 'South Cove', beside(COAST_RD, coastLen - 500, -12)),
  B(15, 'Ridge Track', beside(RIDGE, 1500, 6)),
  B(16, 'Reservoir Dam', beside(RIDGE, -1100, 7)),
  B(17, 'North Valley', beside(RIDGE, -250, 7)),
];

/** The landmarks: fixed ones here; the villages' houses are added once the ground is loaded (villages()). */
export const LANDMARKS = [
  { type: 'station', style: 'kerala', x: STATION.x, z: STATION.z, yaw: SPYAW + P, sign: STATION.name },
  { type: 'garage', style: 'kerala', ...(([x, z]) => ({ x, z }))(beside(COAST_RD, KASHID_S + 115, -24)), yaw: SPYAW + P },
  { type: 'busstop', ...(([x, z]) => ({ x, z }))(beside(COAST_RD, KASHID_S - 40, -9)), yaw: SPYAW + P / 2 },
  { type: 'chaistall', ...(([x, z]) => ({ x, z }))(beside(COAST_RD, KASHID_S + 260, 12)), yaw: SPYAW - P / 2 },
  { type: 'chaistall', ...(([x, z]) => ({ x, z }))(beside(KASHID_GHAT, ridgeAt - 150, -11)), yaw: 0 },
  { type: 'lookout', ...(([x, z]) => ({ x, z }))(beside(KASHID_GHAT, ridgeAt - 200, 22)), yaw: 0.3 },
  { type: 'mast', ...(([x, z]) => ({ x, z }))(fromRunway(APRON.u + 75, APRON.v + 30).map(Math.round)), yaw: 0 },
  { type: 'busstop', ...(([x, z]) => ({ x, z }))(beside(SOUTH_GHAT, 260, -9)), yaw: 0 },
  { type: 'chaistall', ...(([x, z]) => ({ x, z }))(beside(SOUTH_GHAT, 520, 11)), yaw: 0 },
];
const FIXED = LANDMARKS.length;

/**
 * The villages: a house wherever WorldCover sees built-up land (one in every few of its cells, not on a road, not in
 * the water, not too steep), facing the nearest road.
 */
function villages() {
  LANDMARKS.length = FIXED;
  const roads = [COAST_RD, KASHID_GHAT, SOUTH_GHAT, PLATEAU_RD];
  const taken = [];
  for (let k = 2; k < CG.n - 2; k += 2) for (let i = 2; i < CG.n - 2; i += 2) {
    if (COV[k * CG.n + i] !== COVER.BUILT) continue;
    const x = CG.o + i * CG.res + (vnoise(i * 0.37, k * 0.37, S + 5) - 0.5) * 8, z = CG.o + k * CG.res + (vnoise(i * 0.37, k * 0.37, S + 6) - 0.5) * 8;
    if (vnoise(x / 9, z / 9, S + 7) < 0.35) continue;
    let near = null;
    for (const r of roads) { const q = nearestOn(r, x, z); if (!near || q.d < near.d) near = q; }
    if (near.d < 12 || near.d > 400) continue;
    if (taken.some(([a, b]) => hyp(a - x, b - z) < 16)) continue;
    const h0 = groundHeight(x, z), sl = Math.max(Math.abs(groundHeight(x + 6, z) - groundHeight(x - 6, z)), Math.abs(groundHeight(x, z + 6) - groundHeight(x, z - 6))) / 12;
    if (h0 < SEA + 1.2 || sl > 0.2 || hyp(x - STATION.x, z - STATION.z) < 40) continue;
    taken.push([x, z]);
    const yaw = Math.round(Math.atan2(near.x - x, near.z - z) / (P / 2)) * (P / 2);
    LANDMARKS.push({ type: vnoise(x / 30, z / 30, S + 8) > 0.8 ? 'chaistall' : 'house', x: Math.round(x), z: Math.round(z), yaw });
  }
}

// ---------------------------------------------------------------- events (game/Events.js builds them)
const DRAG_FROM = fromRunway(RW_LEN / 2 - 60, 0), DRAG_TO = fromRunway(RW_LEN / 2 - 60 - 402, 0);
// (the top of the escarpment, where the ghat comes over onto the tableland: the highest of its climb from Kashid; and
// the straightest stretch of Kashid's sand, down its middle)
const GHAT_TOP = [261, -948];
/**
 * The events: the drag down the airstrip, the hill climb up the Kashid ghat, and a dash along Kashid's sand.
 */
export const EVENTS = [
  { id: 'runwaydrag', kind: 'line', name: 'Airstrip Drag', desc: 'A quarter mile flat out from a standing start down the plateau airstrip.',
    line: [DRAG_FROM.map(Math.round), DRAG_TO.map(Math.round)], at: [0.5, 1], r: 18, par: { gold: 17.5, silver: 20.5, bronze: 25 }, prize: 1 },
  { id: 'ghatclimb', kind: 'trail', name: 'Kashid Ghat Hill Climb', desc: 'From Kashid up the hairpins of the ghat to the edge of the plateau.',
    trail: 'Kashid Ghat', from: along(KASHID_GHAT, 160).slice(0, 2).map(Math.round), to: GHAT_TOP, gap: 150, r: 10, dy: 6, par: { gold: 210, silver: 275, bronze: 340 }, prize: 1.5 },
  { id: 'beachdash', kind: 'line', name: 'Kashid Beach Dash', desc: 'Down the middle of Kashid beach\'s soft sand: air the tyres down for it.',
    line: [[-2270, -1500], [-1994, -700]], at: [0.35, 0.7, 1], r: 14, par: { gold: 62, silver: 82, bronze: 102 }, prize: 0.9 },
];

/**
 * The checkpoint races (game/Races.js): the loop over the hills, the coast road end to end, the ghat over the
 * plateau, and the plateau road.
 */
// (through each junction itself: the satnav's router would cut across country between two roads near each other)
const loopVia = [
  along(COAST_RD, KASHID_S + 200), along(COAST_RD, (KASHID_S + SOUTH_S) / 2), along(COAST_RD, SOUTH_S - 120), SOUTH_GHAT[0],
  along(SOUTH_GHAT, 1500), along(SOUTH_GHAT, plateauS - 400), along(SOUTH_GHAT, plateauS),
  along(PLATEAU_RD, -300), along(PLATEAU_RD, 1300), along(PLATEAU_RD, 400), PLATEAU_RD[0],
  along(KASHID_GHAT, plateauN - 900), along(KASHID_GHAT, 1400), along(KASHID_GHAT, 300), KASHID_GHAT[0],
  along(COAST_RD, KASHID_S + 60),
].map(([x, z]) => [Math.round(x), Math.round(z)]);
export const RACES = [
  { id: 'konkanloop', kind: 'circuit', name: 'Konkan Loop', desc: 'A lap of the hills: south along the coast, up the south ghat, across the plateau and down the Kashid ghat\'s hairpins.',
    via: loopVia, laps: 1, cps: 12, r: 14, par: { gold: 650, silver: 840, bronze: 1050 }, prize: 2.4 },
  { id: 'coastsprint', kind: 'rally', name: 'Coast Road Sprint', desc: 'The coast road from end to end: round the northern headland, behind Kashid beach and down the shore to the south.',
    trail: 'Coast Road', from: COAST_RD[6], cps: 8, r: 14, par: { gold: 340, silver: 435, bronze: 540 }, prize: 1.8 },
  { id: 'ghatrally', kind: 'rally', name: 'Kashid Ghat Rally', desc: 'Kashid to the eastern edge of the map over the ghat: the hairpins, then across the tableland and its valleys.',
    trail: 'Kashid Ghat', from: KASHID_GHAT[4], cps: 9, r: 10, par: { gold: 540, silver: 690, bronze: 860 }, prize: 1.8 },
  { id: 'plateausprint', kind: 'rally', name: 'Plateau Sprint', desc: 'Across the Phansad tableland from the Kashid ghat to the south ghat, past the airstrip.',
    trail: 'Plateau Road', from: PLATEAU_RD[3], cps: 5, r: 14, par: { gold: 97, silver: 118, bronze: 145 }, prize: 1.2 },
];

/** The party modes' places (game/Modes.js): the elimination arena on the airstrip's apron, the hill a ghat lookout. */
const HILL = beside(KASHID_GHAT, ridgeAt - 200, 3);
export const MODES = {
  arena: { x: Math.round(APRON_MID[0]), z: Math.round(APRON_MID[1]), yaw: Math.atan2(RU[0], RU[1]) },
  hill: { x: HILL[0], z: HILL[1], r: 16, name: 'Ghat Viewpoint' },
  hillStart: [Math.round(KASHID.x), Math.round(KASHID.z)],
  hillPar: { gold: 215, silver: 270, bronze: 320 },
};

// ---------------------------------------------------------------- the generator's hooks
let apronLevel = 0;
const lakeLevels = new Map();                       // (each inland water's cell -> its level, found once)
const gen = {
  // the villages' buildings as Kerala's
  walls: { ...KERALA_WALLS },
  prepare({ coarseAt }) {
    // the airstrip level with its runway's middle
    let s = 0;
    for (let k = 0; k <= 20; k++) s += coarseAt(lerp(RUNWAY[0][0], RUNWAY[1][0], k / 20), lerp(RUNWAY[0][1], RUNWAY[1][1], k / 20));
    apronLevel = s / 21;
  },
  // the coastal plain and the tableland smooth; the slopes keep their bumps
  detail(x, z) { return shoreAt(x, z) < 400 ? 0.35 : 0.8; },
  fine(x, z, h) {
    // the airstrip's level ground: the apron, and the land along the runway
    const [u, v] = runwayFrame(x, z);
    const ad = Math.max(Math.abs(u - APRON.u) - APRON.hu, Math.abs(v - APRON.v) - APRON.hv);
    if (ad < 25) h = lerp(h, apronLevel, smoothstep(25, 0, ad));
    const ru = Math.abs(u) - RW_LEN / 2 - 40, rd = Math.max(ru, Math.abs(v) - 30);
    if (rd < 45) h = lerp(h, apronLevel, smoothstep(45, 0, rd) * 0.9);
    return h;
  },
  // the sea (its water reaching up under the beach), and the reservoir and the ponds at their levels
  water({ setWater, hAt, waterRes }) {
    const lakes = new Map();
    for (let z = -HALF; z <= HALF; z += waterRes) {
      for (let x = -HALF; x <= HALF; x += waterRes) {
        const c = coverAt(x, z);
        if (c === COVER.SEA || (shoreAt(x, z) < 40 && hAt(x, z) < SEA + 0.1)) setWater(x, z, SEA);
        else if (c >= COVER.LAKE && c < COVER.WETLAND) {
          let lv = lakeLevels.get(cell(x, z));
          if (lv === undefined) lv = lakeLevel(x, z);
          setWater(x, z, lv);
          lakes.set(lv, true);
        }
      }
    }
  },
  surface(x, z, h, sl, s) {
    const c = softCover(x, z), d = shoreAt(x, z);
    if (s === SURFACE.ROCK) return s;
    // the beach: WorldCover's bare sand by the sea, and the strip at the waterline
    if ((c === COVER.BARE && d < 250) || (d < 30 + 12 * vnoise(x / 30, z / 30, S + 40) && h < SEA + 3.5) || c === COVER.SEA) return SURFACE.SAND;
    const [u, v] = runwayFrame(x, z);
    if (Math.abs(u - APRON.u) < APRON.hu && Math.abs(v - APRON.v) < APRON.hv) return SURFACE.ROAD;   // the apron
    if (c === COVER.WETLAND || c === COVER.MANGROVE) return SURFACE.MUD;
    if (c === COVER.BARE) return vnoise(x / 14, z / 14, S + 41) > 0.5 ? SURFACE.ROCK : SURFACE.DIRT;   // laterite
    // paddy fields (dry: stubble and bare earth), village ground trodden to dirt
    if (c === COVER.CROPS) return vnoise(x / 9, z / 9, S + 42) > 0.45 ? SURFACE.DIRT : SURFACE.GRASS;
    if (c === COVER.BUILT) return vnoise(x / 6, z / 6, S + 43) > 0.4 ? SURFACE.DIRT : SURFACE.GRASS;
    if (s === SURFACE.DIRT) return SURFACE.GRASS;
    return s;
  },
  trees(ctx) {
    const { H, surf, R, trees: T, clear, cellOf, trailD, trailW, waterAt, hAt, onCourse } = ctx;
    const add = (x, z, type, ht, r) => { T.x.push(x); T.y.push(hAt(x, z)); T.z.push(z); T.h.push(ht); T.r.push(r); T.type.push(type); };
    // how far each 50 m cell is from a road: the woods thick along the roads (what you see), thinner far off them
    const RC = 50, rn = Math.ceil(2 * HALF / RC) + 1, roadD = new Float32Array(rn * rn).fill(1e6);
    for (const t of TRAILS) for (const [x, z] of t.points) roadD[Math.round((z + HALF) / RC) * rn + Math.round((x + HALF) / RC)] = 0;
    for (let pass = 0; pass < 2; pass++) {
      const [a, b, st] = pass ? [rn * rn - 1, -1, -1] : [0, rn * rn, 1];
      for (let o = a; o !== b; o += st) {
        const i = o % rn; let v = roadD[o];
        const nb = pass ? [[1, 0], [0, 1], [1, 1], [-1, 1]] : [[-1, 0], [0, -1], [-1, -1], [1, -1]];
        for (const [di, dk] of nb) { const ii = i + di, q = o + dk * rn + di; if (ii >= 0 && ii < rn && q >= 0 && q < rn * rn) v = Math.min(v, roadD[q] + RC * hyp(di, dk)); }
        roadD[o] = v;
      }
    }
    const nearRoad = (x, z) => roadD[clamp(Math.round((z + HALF) / RC), 0, rn - 1) * rn + clamp(Math.round((x + HALF) / RC), 0, rn - 1)];
    // the clearings round the buildings and the beacons, by 64 m cell (each in every cell it reaches)
    const CC = 64, near = new Map();
    for (const q of clear) {
      for (let k = Math.floor((q[1] - q[2]) / CC); k <= Math.floor((q[1] + q[2]) / CC); k++) for (let i = Math.floor((q[0] - q[2]) / CC); i <= Math.floor((q[0] + q[2]) / CC); i++) {
        const key = k * 1000 + i;
        if (!near.has(key)) near.set(key, []);
        near.get(key).push(q);
      }
    }
    // kinds (the Kerala set): 0 coconut, 1 jungle giant, 2 mango/jack, 3 rubber, 4 banana, 5 bamboo
    const blocked = (x, z) => {
      const idx = cellOf(x, z), tw = trailW(idx);
      // (the roads kept clear a verge's width, the airstrip well back)
      if (trailD(idx) < tw + (tw >= 7 ? 22 : 6)) return true;
      const wl = waterAt(x, z);
      if (wl > -1e8 && H[idx] < wl + 0.3) return true;
      const [u, v] = runwayFrame(x, z);
      if (Math.abs(u) < RW_LEN / 2 + 80 && Math.abs(v) < 60 + (Math.abs(u - APRON.u) < APRON.hu + 25 ? 100 : 0)) return true;
      for (const [cx, cz, cr] of near.get(Math.floor(z / CC) * 1000 + Math.floor(x / CC)) || []) if (Math.abs(x - cx) < cr && Math.abs(z - cz) < cr && hyp(x - cx, z - cz) < cr) return true;
      return onCourse(x, z);
    };
    const bare = (s) => s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.GRAVEL || s === SURFACE.ROCK || s === SURFACE.ROAD;
    const STEP = 6;
    for (let z = -HALF + 3; z < HALF - 3; z += STEP) {
      for (let x = -HALF + 3; x < HALF - 3; x += STEP) {
        const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9, roll = R(), pick = R();
        const c = coverAt(px, pz);
        if (c === COVER.SEA || c === COVER.LAKE) continue;
        const idx = cellOf(px, pz), s = surf[idx];
        if (bare(s)) continue;
        const d = shoreAt(px, pz), h = H[idx], rd = nearRoad(px, pz);
        const patch = fbm(px / 150, pz / 150, 2, S + 100) + 0.6 * fbm(px / 60, pz / 60, 2, S + 140);
        // the forest thick by the roads, thinning away from them (beyond, the ground's own colour carries the woods);
        // groves of coconut behind the beach, mango and jack round the villages and among the paddy, a few trees
        // out on the open grass
        const near = smoothstep(700, 120, rd);
        let dens;
        if (c === COVER.TREES) dens = (0.06 + 0.3 * near) * (0.75 + 0.5 * smoothstep(-0.2, 0.4, patch));
        else if (c === COVER.SHRUB) dens = 0.05 + 0.06 * near;
        else if (c === COVER.BUILT) dens = 0.08;
        else if (c === COVER.CROPS) dens = 0.015 + 0.05 * smoothstep(0.2, 0.6, patch);
        else dens = 0.01 + 0.03 * smoothstep(0.3, 0.6, patch);
        if (d < 500) dens = Math.max(dens, c === COVER.TREES || c === COVER.BUILT ? 0.22 : 0.06);
        if (roll > dens || blocked(px, pz)) continue;
        if (d < 500 || (c === COVER.BUILT && pick < 0.5)) {
          if (pick < 0.7) add(px, pz, 0, 11 + R() * 11, 0.17);
          else if (pick < 0.88) add(px, pz, 2, 8 + R() * 8, 0.28);
          else add(px, pz, 4, 3 + R() * 2.2, 0.1);
          continue;
        }
        if (c === COVER.TREES) {
          // the Phansad forest: the tall evergreen giants and teak on the slopes, mango and jack, bamboo in the hollows
          const hollow = vnoise(px / 90, pz / 90, S + 150) > 0.72;
          if (hollow && pick < 0.5) add(px, pz, 5, 9 + R() * 7, 0.55);
          else if (pick < 0.55) { const ht = 16 + R() * 14; add(px, pz, 1, ht, 0.32 + ht * 0.012); }
          else add(px, pz, 2, 8 + R() * 9, 0.28);
          continue;
        }
        if (pick < 0.65) add(px, pz, 2, 7 + R() * 8, 0.28); else add(px, pz, 0, 10 + R() * 10, 0.17);
      }
    }
  },
};

/** An inland water's level: a little under the lowest of the ground round it (each cell of it remembered). */
function lakeLevel(x, z) {
  // the water's cells, by a fill over the cover grid, and the lowest ground on its shore
  const start = cell(x, z), code = COV[start], seen = new Set([start]), list = [start];
  let shore = Infinity;
  for (let q = 0; q < list.length; q++) {
    const o = list[q], i = o % CG.n, k = (o - i) / CG.n;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= CG.n || kk >= CG.n) continue;
      const nb = kk * CG.n + ii;
      if (seen.has(nb)) continue;
      if (COV[nb] === code) { seen.add(nb); list.push(nb); } else shore = Math.min(shore, HGT[(kk + 20) * HG.n + ii + 20]);
    }
  }
  const level = shore - 0.3;
  for (const o of list) lakeLevels.set(o, level);
  return level;
}

/** The map, as the game and the generator see it. */
export const COAST = {
  id: 'coast', name: 'Konkan Coast', short: 'Coast',
  blurb: 'Eight kilometres of the real Konkan coast round Kashid beach: a coast road by the Arabian Sea, ghat roads in hairpins up to the Phansad tableland, an airstrip on top.',
  tagline: 'Old trucks, real physics, good friends. Drive the Konkan Coast together: race the loop, climb the ghats, find its survey beacons.',
  seed: SEED, station: STATION, spawn: SPAWN, dealer: 'Konkan Motors',
  // 8 km across on a 2 m grid, its landform on 4 m, its water on 4 m (maps/index.js)
  half: HALF, res: 2, coarse: 4, waterRes: 4,
  load, baseHeight: groundHeight, roughOf, gen,
  river: null, peaks: [],
  trails: TRAILS, beacons: BEACONS, landmarks: LANDMARKS, events: EVENTS, races: RACES, modes: MODES,
  roadSurface: SURFACE.ROAD, puddles: 0, sandBed: true, boulderMax: 2500,
  // the sea to the horizon (render/Water.js): drawn as one sheet, not on the water grid
  sea: { level: SEA, sheet: true },
  pads: { chaistall: 5, house: 7, busstop: 3, lookout: 7 },
  litter: [0.3, 1, 1, 1, 0.3, 0.8],
  treeStrength: [1, 1, 1, 0.8, 0.05, 1.5],
  young: {
    from: [0, 2, 2, 3, 4, null], alone: 2, h: { default: [2.2, 5.5], 0: [2.5, 4.5], 4: [2.2, 4] },
    r: { 0: (h) => 0.05 + 0.006 * h, 4: () => 0.09 }, edge: 0.2, wood: 0.3, open: 0.1, on: [SURFACE.GRASS, SURFACE.DIRT],
  },
  roadside: {
    fence: 'bamboo', fenceBy: ['house'], fenceReach: 26,
    byBuilding: { house: ['woodpile', 'drum'], chaistall: ['drum', 'crate', 'drum'], station: ['drum', 'crate'], garage: ['barrel', 'barrel', 'crate'] },
    ring: { house: 7.5, chaistall: 5, station: 8.5, garage: 6.5 },
  },
  dust: { [SURFACE.DIRT]: [0.42, 0.17, 0.08], [SURFACE.MUD]: [0.24, 0.09, 0.04], [SURFACE.ROAD]: [0.36, 0.33, 0.3], [SURFACE.SAND]: [0.62, 0.55, 0.42] },
  mudTint: [0.13, 0.045, 0.022],
  ground: 'coast', trees: 'kerala',
  // sea air: clear enough to see the coast from the plateau, fair-weather cloud
  atmosphere: { fog: 0.00028, cover: 0.3 },
};
