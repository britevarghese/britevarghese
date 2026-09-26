// Terrain: the countryside around Port Halvern, beyond the ring highway. Pure data (no three.js), so
// the physics (CityLayout.groundHeight) and the renderer (Landscape.js) use exactly the same surface.
//   north / west: the Halvern Range (ridged mountains, snow above ~480 m), Summit Drive climbs to the
//                 observatory and the radio masts
//   south:        the coast: coastal plain, sand beach, the sea (sea level SEA), Ocean Boulevard, a pier
//                 and a lighthouse
//   east:         farmland and rolling hills, Harvest Road, a lake, a wind farm, a diner
// World axes: +Z is north, +X is WEST (the player's left when facing north), heights in metres.
import { RING, RING_CORNER_R } from './CityLayout.js';

export const SEA = -0.4;              // sea level (anything below is water)
export const EDGE_OFF = 18;           // terrain starts this far outside the ring centre line
export const DRIVE_LIMIT = 1950;      // drivable countryside: up to this far outside the ring edge
export const NEAR = 3400;             // detailed terrain grid half-size (m)
export const FAR = 15000;             // horizon terrain radius
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ noise (deterministic value noise)
function hash(ix, iz, s) {
  let h = (ix * 374761393 + iz * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, s), b = hash(ix + 1, iz, s), c = hash(ix, iz + 1, s), d = hash(ix + 1, iz + 1, s);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}
export function fbm(x, z, oct = 5, s = 0) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f + i * 17.3, z * f - i * 9.1, s + i); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
function ridged(x, z, oct = 5, s = 0) {
  let v = 0, a = 0.5, f = 1, n = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let r = 1 - Math.abs(vnoise(x * f + i * 5.7, z * f + i * 3.1, s + 40 + i) * 2 - 1);
    r = r * r * w; w = clamp(r * 1.6, 0, 1);
    v += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return v / n;
}

// ------------------------------------------------------------------ regions
// signed distance outside the ring highway's outer edge (rounded square)
export function ringEdgeDist(x, z) {
  const C = RING - RING_CORNER_R;
  const qx = Math.abs(x) - C, qz = Math.abs(z) - C;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
  return out - RING_CORNER_R - EDGE_OFF;
}
const angDist = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return Math.abs(d); };
// bearing: 0 = north (+z), +PI/2 = west (+x), +-PI = south, -PI/2 = east
export const bearing = (x, z) => Math.atan2(x, z);
export const seaMask = (a) => 1 - smooth(1.0, 1.45, angDist(a, Math.PI));
export const mountainMask = (a) => 1 - smooth(1.05, 1.55, angDist(a, 0.85));
export const farmMask = (a) => 1 - smooth(0.7, 1.15, angDist(a, -Math.PI / 2));
// shoreline: distance outside the ring edge where land meets the sea (varies along the coast)
export const shoreDist = (a) => 730 + (vnoise(a * 2.2, 3.7, 91) - 0.5) * 200;

// ------------------------------------------------------------------ roads, flat pads, landmarks
// Country roads as control polylines [x, z]; smoothed and sampled at load. First point joins the ring.
export const ROADS = [
  { id: 'summit', name: 'Summit Drive', width: 9, pts: [[0, 1194], [0, 1420], [60, 1700], [240, 1950], [520, 2110], [820, 2190], [1010, 2330], [950, 2500], [760, 2590], [740, 2740], [960, 2830], [1240, 2870], [1470, 2905]] },
  { id: 'coast', name: 'Ocean Boulevard', width: 10, pts: [[0, -1194], [0, -1420], [40, -1600], [260, -1700], [700, -1730], [1150, -1690], [1500, -1580], [1800, -1400]] },
  { id: 'coastE', name: 'Ocean Boulevard', width: 10, pts: [[40, -1600], [-240, -1705], [-700, -1740], [-1150, -1700], [-1500, -1580], [-1780, -1400]] },
  { id: 'harvest', name: 'Harvest Road', width: 9, pts: [[-1194, 0], [-1420, 0], [-1650, 40], [-1900, 200], [-2150, 330], [-2450, 300], [-2700, 120], [-2800, -180], [-2650, -500], [-2350, -620]] },
];
// flattened areas (landmarks sit on them): x, z, r = radius, h = height or null (= terrain there)
export const PADS = [
  { id: 'observatory', x: 1520, z: 2915, r: 80 },
  { id: 'diner', x: -1640, z: 110, r: 45 },
  { id: 'farm', x: -2080, z: 470, r: 80 },
  { id: 'lighthouse', x: 1760, z: -1930, r: 28 },
  { id: 'sign', x: -320, z: 1720, r: 0 }, // marker only
];
// where the country roads leave the ring highway (gaps in its outer barrier)
export const EXITS = [{ x: 0, z: 1180, axis: 'z' }, { x: 0, z: -1180, axis: 'z' }, { x: -1180, z: 0, axis: 'x' }];
export const atExit = (x, z) => EXITS.some((e) => (e.axis === 'z' ? Math.abs(x - e.x) < 11 && Math.abs(z - e.z) < 30 : Math.abs(z - e.z) < 11 && Math.abs(x - e.x) < 30));
// drivable decks over water: the pier
export const DECKS = [{ id: 'pier', x0: 248, x1: 266, z0: -2040, z1: -1742, h: 2.3 }];
// landmark positions (Landscape.js builds them, CityPlanner adds their colliders)
export const LANDMARKS = {
  observatory: { x: 1545, z: 2945 },
  masts: [[1705, 3060], [1420, 3120], [1760, 2830]],
  sign: { x: -150, z: 2150, text: 'PORT HALVERN' },
  ferris: { x: 257, z: -2005 },
  lighthouse: { x: 1760, z: -1930 },
  diner: { x: -1650, z: 128, yaw: Math.PI / 2 },
  farm: { x: -2080, z: 470 },
  turbines: [[-1480, 900], [-1640, 1060], [-1800, 1180], [-2000, 1230], [-2220, 1150], [-2420, 1010], [-2600, 860], [-2760, 700]],
  lifeguards: [[-560, -1804], [-120, -1898], [620, -1900], [1060, -1892]],
};
// lakes: basin centres (water shows wherever the ground is below SEA)
export const LAKES = [{ x: -2050, z: -380, r: 240 }];

// ------------------------------------------------------------------ height
// raw terrain height before roads/pads are cut in
export function baseHeight(x, z) {
  const d = ringEdgeDist(x, z);
  if (d <= 0) return 0.3;
  const a = bearing(x, z);
  const edge = smooth(25, 260, d);
  const sm = seaMask(a), mm = mountainMask(a), fm = farmMask(a);
  const shore = shoreDist(a);
  // rolling hills (gentler across the farmland and the coastal plain)
  let hills = (fbm(x / 760, z / 760, 4, 1) - 0.42) * 70 + (fbm(x / 210, z / 210, 3, 2) - 0.5) * 9;
  hills *= 1 - fm * 0.6;
  hills *= 1 - sm * smooth(shore - 520, shore - 160, d) * 0.92;
  let h = 0.3 + Math.max(hills, 0.4) * edge;
  // mountains: rise from ~600 m out, highest far away
  const mf = mm * smooth(300, 2100, d);
  if (mf > 0.001) {
    const r = ridged(x / 2000, z / 2000, 6, 3);
    h += mf * (90 + 1500 * Math.pow(r, 1.6)) * (0.6 + 0.4 * smooth(1500, 5000, d));
  }
  // a second, farther range all around the horizon (except over the sea)
  const far = smooth(3500, 9000, d) * (1 - sm * 0.9);
  if (far > 0.001) h += far * (200 + 900 * Math.pow(ridged(x / 3000, z / 3000, 5, 7), 1.4));
  // lakes
  for (const L of LAKES) { const ld = Math.hypot(x - L.x, z - L.z); if (ld < L.r * 1.8) h = lerp(Math.min(h, -4 + (ld / L.r) * 3), h, smooth(L.r * 0.9, L.r * 1.8, ld)); }
  // the coast: beach, then the sea floor
  if (sm > 0.001) {
    const land = 1 - sm * smooth(shore - 60, shore + 20, d);
    const floor = SEA - 1.5 - smooth(shore, shore + 900, d) * 40;
    h = lerp(lerp(0.3 + 2.2 * (1 - smooth(shore - 260, shore - 20, d)), h, land * land), floor, sm * smooth(shore + 5, shore + 120, d));
    if (d > shore - 260 && d < shore + 120) h = Math.min(h, lerp(3, SEA - 0.8, smooth(shore - 260, shore + 60, d)) + (1 - sm) * 50);
  }
  return h;
}

// ------------------------------------------------------------------ road network (sampled)
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
const CELL = 40;
export class TerrainData {
  constructor() {
    this.roads = [];
    for (const r of ROADS) this.roads.push(this._sampleRoad(r, this.roads));
    // pads take the (smoothed) terrain height at their centre, or the height of the road reaching them
    this.pads = PADS.filter((p) => p.r > 0).map((p) => {
      let h = baseHeight(p.x, p.z);
      for (const rd of this.roads) for (const s of rd.s) if (Math.hypot(s.x - p.x, s.z - p.z) < p.r) h = s.h;
      return { ...p, h: Math.max(h, 1) };
    });
    // spatial hash of road samples for fast "nearest road" queries
    this.hash = new Map();
    for (const rd of this.roads) for (let i = 0; i < rd.s.length - 1; i++) {
      const a = rd.s[i], b = rd.s[i + 1];
      const x0 = Math.floor((Math.min(a.x, b.x) - 45) / CELL), x1 = Math.floor((Math.max(a.x, b.x) + 45) / CELL);
      const z0 = Math.floor((Math.min(a.z, b.z) - 45) / CELL), z1 = Math.floor((Math.max(a.z, b.z) + 45) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
        const k = cx * 100003 + cz;
        let l = this.hash.get(k); if (!l) this.hash.set(k, (l = []));
        l.push({ rd, i });
      }
    }
  }

  _sampleRoad(r, earlier = []) {
    const P = r.pts, pts = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
      for (let k = 0; k < n; k++) pts.push(catmull(p0, p1, p2, p3, k / n));
    }
    pts.push(P[P.length - 1]);
    // height profile: terrain, smoothed, limited to a 9% grade, never under water, level with the ring at the start
    let h = pts.map(([x, z]) => Math.max(0.8, baseHeight(x, z)));
    for (let pass = 0; pass < 4; pass++) h = h.map((v, i) => { let s = 0, n = 0; for (let k = -8; k <= 8; k++) { const j = i + k; if (j >= 0 && j < h.length) { s += h[j]; n++; } } return s / n; });
    const joinsRing = ringEdgeDist(pts[0][0], pts[0][1]) < 5;
    if (joinsRing) h[0] = 0;
    // a branch: start exactly at the height of the road it leaves from, blending over 60 m
    let start = null;
    for (const e of earlier) for (const q of e.s) if (Math.hypot(q.x - pts[0][0], q.z - pts[0][1]) < 4) start = q.h;
    if (start !== null) { let acc2 = 0; h[0] = start; for (let i = 1; i < h.length && acc2 < 60; i++) { acc2 += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); h[i] = lerp(start, h[i], smooth(0, 60, acc2)); } }
    const seg = pts.map((p, i) => (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0));
    for (let i = 1; i < h.length; i++) h[i] = clamp(h[i], h[i - 1] - seg[i] * 0.09, h[i - 1] + seg[i] * 0.09);
    for (let i = h.length - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - seg[i + 1] * 0.09, h[i + 1] + seg[i + 1] * 0.09);
    if (joinsRing) h[0] = 0;
    // first 40 m blend from the highway's level into the profile
    let acc = 0;
    if (joinsRing) for (let i = 1; i < h.length && acc < 40; i++) { acc += seg[i]; h[i] = lerp(0, h[i], smooth(0, 40, acc)); }
    const s = pts.map(([x, z], i) => ({ x, z, h: h[i] }));
    return { ...r, s, hw: r.width / 2 };
  }

  // nearest road: { dist, h, rd, i, t } within 45 m, else null
  nearestRoad(x, z) {
    const l = this.hash.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
    if (!l) return null;
    let best = null, bd = 45;
    for (const { rd, i } of l) {
      const a = rd.s[i], b = rd.s[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / L2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = { dist: d, h: lerp(a.h, b.h, t), rd, i, t }; }
    }
    return best;
  }

  // final height: base terrain with roads and pads cut in
  height(x, z) {
    let h = baseHeight(x, z);
    const r = this.nearestRoad(x, z);
    if (r) h = lerp(r.h - 0.05, h, smooth(r.rd.hw + 1.5, r.rd.hw + 30, r.dist));
    for (const p of this.pads) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r * 2.2) h = lerp(p.h, h, smooth(p.r, p.r * 2.2, d)); }
    return h;
  }

  // drivable surface (physics): on a country road the road deck, elsewhere the ground
  groundHeight(x, z) {
    for (const d of DECKS) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) return d.h;
    const r = this.nearestRoad(x, z);
    if (r && r.dist < r.rd.hw) return r.h;
    return this.height(x, z);
  }

  onRoad(x, z) { const r = this.nearestRoad(x, z); return r && r.dist < r.rd.hw ? r : null; }

  // what the ground is like here (Landscape colours and tree placement agree on it)
  slope(x, z) { const e = 3; return Math.hypot(this.height(x + e, z) - this.height(x - e, z), this.height(x, z + e) - this.height(x, z - e)) / (2 * e); }
  fieldMask(x, z) {
    const a = bearing(x, z), d = ringEdgeDist(x, z);
    return farmMask(a) * smooth(80, 200, d) * (1 - smooth(1500, 2200, d)) * smooth(0.35, 0.45, fbm(x / 900, z / 900, 2, 21));
  }
  forest(x, z) { return smooth(0.5, 0.64, fbm(x / 520, z / 520, 4, 11)); }

  // deterministic forest / tree scatter over the detailed area: { x, z, y, type 0 conifer 1 broadleaf 2 palm, s, rot }
  trees() {
    if (this._trees) return this._trees;
    const out = [], CELLT = 24;
    for (let gx = -NEAR + 60; gx < NEAR - 60; gx += CELLT) for (let gz = -NEAR + 60; gz < NEAR - 60; gz += CELLT) {
      const j1 = hash(gx, gz, 301), j2 = hash(gx, gz, 302), j3 = hash(gx, gz, 303);
      const x = gx + (j1 - 0.5) * CELLT * 0.9, z = gz + (j2 - 0.5) * CELLT * 0.9;
      const d = ringEdgeDist(x, z);
      if (d < 70) continue;
      const a = bearing(x, z), sm = seaMask(a), sh = shoreDist(a);
      const coastal = sm > 0.5 && d > sh - 380 && d < sh - 50;
      const dens = coastal ? 0.08 : this.forest(x, z) * 0.85 + 0.04;
      if (j3 > dens) continue;
      if (this.fieldMask(x, z) > 0.3) continue;
      const r = this.nearestRoad(x, z);
      if (r && r.dist < r.rd.hw + 6) continue;
      if (this.pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 12)) continue;
      if (Object.values(LANDMARKS).flat().some((q) => Array.isArray(q) ? Math.hypot(x - q[0], z - q[1]) < 30 : q.x !== undefined && Math.hypot(x - q.x, z - q.z) < 40)) continue;
      const y = this.height(x, z);
      if (y < 0.6 || y > 440 + hash(gx, gz, 304) * 60) continue;
      if (this.slope(x, z) > 0.75) continue;
      const type = coastal ? 2 : y > 90 || mountainMask(a) * smooth(300, 900, d) > 0.5 ? (hash(gx, gz, 305) < 0.85 ? 0 : 1) : hash(gx, gz, 305) < 0.35 ? 0 : 1;
      out.push({ x, z, y, type, s: 0.75 + hash(gx, gz, 306) * 0.6, rot: hash(gx, gz, 307) * 6.283, drive: d < DRIVE_LIMIT + 20 });
    }
    return (this._trees = out);
  }
}

// the shared instance (built lazily: road sampling costs a few ms)
let _T = null;
export const terrain = () => (_T ||= new TerrainData());
