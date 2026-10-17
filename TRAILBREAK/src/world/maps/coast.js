// The Konkan Coast: a stretch of India's west coast laid out for driving on tarmac. World axes: +x east, +z south, +y
// up, metres.
//
// The Arabian Sea along the west, a beach of pale sand and a grove of coconut palms behind it. A four-lane highway
// runs round the whole map in a ring (5.5 km: two long straights north to south, the coastal one behind the palms
// and the inland one across the plain, joined by sweeping bends); the ghat road leaves the coastal highway at Ponnur,
// the little coastal town where everyone starts, and climbs over the wooded hills in the middle in hairpins to the
// inland highway. On the plain inland lies an airstrip, its runway long enough to find a truck's top speed; a river
// comes down from the hills to the sea under the coastal highway's bridge, and a lighthouse stands on the point to
// the north of the town.
//
// The generator (world/WorldGen.js) builds the common ground; the hooks in `gen` add the sea, the beach, the town's
// and the airfield's level ground, and the trees.
import { fbm, ridged } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';
import { KERALA_WALLS } from './kerala.js';

export const SEED = 4410;
const S = SEED;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);

// ---------------------------------------------------------------- the landform
/** The sea's level (m). */
export const SEA = 1;
/** The waterline: x at which the sea meets the beach, for each z (a coast with a few gentle bays). */
export const shoreX = (z) => -735 + 30 * Math.sin(z / 240 + 0.6) + 14 * Math.sin(z / 83 + 2.1);
// the wooded hills in the middle: centre, height above the plain, radius
export const PEAKS = [
  { x: 60, z: -440, h: 140, r: 200, name: 'Kanthari Hill' },
  { x: 70, z: -70, h: 105, r: 150, name: 'Ghat Top' },
  { x: 130, z: 210, h: 95, r: 170 },
  { x: -60, z: 560, h: 60, r: 180 },
  { x: 260, z: -230, h: 45, r: 150 },
];
// the airfield on the plain inland: the runway's line (north end, south end), its apron to the east of its middle
export const RUNWAY = [[540, -690], [540, 70]];
export const APRON = { x: 610, z: -310, hw: 50, hd: 40 };
// the town's level ground round its main street
export const TOWN = { x: -430, z: 40, r: 150 };

/** The ground before the river is cut: the sea floor, the beach, the plain rising slowly inland, the hills, the
 *  ranges round the edges (north, east and south; the sea is the edge to the west). */
function baseHeight(x, z) {
  const d = x - shoreX(z);
  let h = d < 0 ? SEA - 0.8 - Math.min(9, -d * 0.045) : SEA - 0.6 + Math.min(d, 60) * 0.06 + Math.max(0, d - 60) * 0.012;
  h += smoothstep(40, 220, d) * 3 * fbm(x / 420, z / 420, 3, S + 3);
  let mount = 0;
  for (const p of PEAKS) {
    const dx = x - p.x, dz = z - p.z, d2 = (dx * dx + dz * dz) / (p.r * p.r);
    if (d2 < 4) mount += p.h * Math.exp(-d2 * 2.3);
  }
  if (mount > 0.5) h += mount * (0.55 + 0.6 * ridged(x / 260, z / 260, 5, S + 10));
  const e = Math.max(x, Math.abs(z));
  if (e > 900) h += smoothstep(900, 1180, e) * (160 + 100 * ridged(x / 240, z / 240, 4, S + 20));
  return h;
}
const roughOf = (h) => clamp((h - 20) / 120, 0.15, 1);

// ---------------------------------------------------------------- the roads
const P = Math.PI;
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

// the ring: from the middle of its coastal side round clockwise (north, east, south, west) back to where it began; its
// four bends 230 m round, the gentlest of kinks along its sides
const W = -560, E = 770, NZ = -820, SZ = 820;
const RING = road([
  [W, 40], [W + 4, -160, 1500], [W - 6, -400, 1500], [W, NZ, 230], [-60, NZ - 6, 1500], [300, NZ + 4, 1500], [E, NZ, 230],
  [E, -300, 1500], [E + 6, 20, 1500], [E, SZ, 230], [300, SZ + 4, 1500], [-60, SZ - 4, 1500], [W, SZ, 230],
  [W - 6, 400, 1500], [W + 5, 220, 1500], [W, 40],
]);

// the ghat road: Ponnur's main street, then up the hills' west face in two hairpins (21 m round) to the top, and down
// their east side in long bends to the inland highway
const GHAT = road([
  [W, 40], [-490, 40, 300], [-420, 41, 300], [-350, 39, 200], [-290, 32, 120], [-195, 0, 90],
  [-140, -24, 60], [-122, -70, 60], [-122, -126, 21], [-80, -126, 21], [-80, 41, 21], [-38, 41, 21],
  [-38, -60, 50], [-5, -135, 60], [40, -152, 60], [95, -145, 70], [170, -80, 140], [300, 50, 200],
  [470, 170, 220], [620, 220, 200], [E, 240],
], 6);
export const TRAILS = [
  { name: 'Coast Highway', kind: 'road', width: 7, lanes: 4, grade: 0.06, smooth: 60, cut: 8, shoulder: 12, level: true, bridge: true, verge: { puddles: 5 }, points: RING },
  { name: 'Ghat Road', kind: 'road', width: 4.2, lanes: 2, grade: 0.11, smooth: 24, cut: 7, shoulder: 9, level: true, verge: { puddles: 8 }, points: GHAT },
  { name: 'Market Road', kind: 'road', width: 3.6, lanes: 2, grade: 0.08, cut: 4, level: true, verge: { puddles: 6 }, points: road([[-470, 40], [-471, -60, 150], [-462, -130]]) },
  { name: 'Temple Road', kind: 'road', width: 3.6, lanes: 2, grade: 0.08, cut: 4, level: true, verge: { puddles: 6 }, points: road([[-400, 41], [-399, 140, 150], [-410, 205]]) },
  { name: 'Lighthouse Road', kind: 'road', width: 3.6, lanes: 2, grade: 0.08, cut: 4, level: true, verge: { puddles: 6 }, points: road([[W, -300], [-630, -305, 60], [-668, -360, 120], [-700, -515]]) },
  { name: 'Runway', kind: 'road', width: 15, lanes: 0, runway: true, grade: 0.006, smooth: 80, cut: 10, shoulder: 14, level: true, points: road(RUNWAY, 20) },
  { name: 'Taxiway', kind: 'road', width: 5, lanes: 0, grade: 0.03, smooth: 30, cut: 6, shoulder: 8, level: true, points: road([[540, -310], [E, -305]], 15) },
];

// the river: down from the hills between their southern summits and out to sea under the coastal highway
export const RIVER = {
  points: [[150, 420], [60, 430], [-40, 450], [-150, 470], [-260, 482], [-380, 496], [-480, 510], [-560, 520], [-640, 528], [-720, 536], [-820, 545], [-1000, 552], [-1180, 560]],
  widthStart: 8, widthEnd: 18, depthStart: 0.9, depthEnd: 1.6, cut: 1.6,
  fords: [],
};

export const STATION = { x: -425, z: 74, name: 'Ponnur Motor Station' };
export const SPAWN = { x: -432, z: 41, yaw: -P / 2 };                 // on the main street, facing the coast highway

// ---------------------------------------------------------------- the places
export const BEACONS = [
  { id: 0, name: 'Ponnur Lighthouse', x: -696, z: -522 },
  { id: 1, name: 'Ponnur Beach', x: -662, z: -340 },
  { id: 2, name: 'Market Square', x: -462, z: -128 },
  { id: 3, name: 'Temple Tank', x: -410, z: 204 },
  { id: 4, name: 'River Bridge', x: -548, z: 525 },
  { id: 5, name: 'Ghat Top', x: 72, z: -146 },
  { id: 6, name: 'Hairpin Bend', x: -101, z: -126 },
  { id: 7, name: 'Airfield Tower', x: 636, z: -338 },
  { id: 8, name: 'Runway End', x: 540, z: -676 },
  { id: 9, name: 'North Cape', x: -470, z: -790 },
  { id: 10, name: 'Toll Plaza', x: 300, z: -810 },
  { id: 11, name: 'East Highway', x: 780, z: 20 },
  { id: 12, name: 'South Bay', x: -300, z: 818 },
  { id: 13, name: 'Palm Grove', x: -585, z: 300 },
  { id: 14, name: 'Ghat Foot', x: 676, z: 236 },
];

export const LANDMARKS = [
  { type: 'station', style: 'kerala', x: -425, z: 74, yaw: P, sign: 'Ponnur Motor Station' },
  { type: 'garage', style: 'kerala', x: -470, z: 74, yaw: P },
  { type: 'lighthouse', x: -712, z: -540, yaw: 0 },
  { type: 'house', x: -505, z: 18, yaw: P }, { type: 'house', x: -380, z: 16, yaw: P }, { type: 'house', x: -345, z: 66, yaw: 0 },
  { type: 'house', x: -492, z: -50, yaw: P / 2 }, { type: 'house', x: -448, z: -95, yaw: -P / 2 }, { type: 'house', x: -420, z: 140, yaw: -P / 2 },
  { type: 'house', x: -380, z: 180, yaw: P / 2 }, { type: 'house', x: -520, z: 70, yaw: 0 },
  { type: 'chaistall', x: -455, z: 16, yaw: P }, { type: 'chaistall', x: -308, z: 54, yaw: 0 },
  { type: 'busstop', x: -405, z: 20, yaw: P }, { type: 'busstop', x: 700, z: 222, yaw: P },
  { type: 'lookout', x: 82, z: -168, yaw: 0.3 },
  { type: 'mast', x: 646, z: -350, yaw: 0 },
];

// ---------------------------------------------------------------- events (game/Events.js builds them)
/**
 * The events: the drag down the runway, the hill climb up the ghat road, and a dash along the beach's sand.
 */
export const EVENTS = [
  { id: 'runwaydrag', kind: 'line', name: 'Runway Drag', desc: 'A quarter mile flat out from a standing start down the airstrip\'s runway.',
    line: [[540, 40], [540, -362]], at: [0.5, 1], r: 18, par: { gold: 17.5, silver: 20.5, bronze: 25 }, prize: 1 },
  { id: 'ghatclimb', kind: 'trail', name: 'Ghat Hill Climb', desc: 'From the edge of Ponnur up the hairpins of the ghat road to the top of the pass.',
    trail: 'Ghat Road', from: [-240, 18], to: [49, -151], gap: 110, r: 10, dy: 6, par: { gold: 52, silver: 62, bronze: 76 }, prize: 1.4 },
  { id: 'beachdash', kind: 'line', name: 'Beach Dash', desc: 'Along the water\'s edge on the soft sand of Ponnur Beach.',
    line: [[-698, -240], [-702, 40]], at: [0.35, 0.7, 1], r: 14, par: { gold: 21, silver: 25, bronze: 31 }, prize: 0.9 },
];

/**
 * The checkpoint races (game/Races.js): the whole ring, its two long straights, the ghat road end to end.
 */
export const RACES = [
  { id: 'ringcircuit', kind: 'circuit', name: 'Coast Ring Circuit', desc: 'A lap of the four-lane ring: up the coast, across the north, down the inland straight and back by the south bay.',
    via: [[-556, -100], [-480, -775], [200, -818], [770, -380], [770, 380], [200, 822], [-480, 778], [-560, 200], [-560, 60]], laps: 1, cps: 10, r: 14, par: { gold: 215, silver: 260, bronze: 320 }, prize: 1.8 },
  { id: 'coastsprint', kind: 'rally', name: 'Coast Highway Sprint', desc: 'North from the river bridge along the coastal straight to the north cape.',
    via: [[-558, 470], [-556, 100], [-560, -380], [-555, -560]], cps: 5, r: 14, par: { gold: 46, silver: 55, bronze: 68 }, prize: 1.2 },
  { id: 'inlandsprint', kind: 'rally', name: 'Inland Straight Sprint', desc: 'South down the inland highway past the airfield: the longest straight on the coast.',
    via: [[770, -560], [775, -200], [775, 200], [770, 560]], cps: 5, r: 14, par: { gold: 44, silver: 53, bronze: 65 }, prize: 1.2 },
  { id: 'ghatrally', kind: 'rally', name: 'Ghat Road Rally', desc: 'Ponnur to the inland highway over the ghat: the main street, the hairpins and the long bends down the far side.',
    trail: 'Ghat Road', from: [-420, 41], cps: 7, r: 10, par: { gold: 95, silver: 115, bronze: 140 }, prize: 1.5 },
];

/** The party modes' places (game/Modes.js): the elimination arena on the airfield's apron, the hill on the ghat top. */
export const MODES = {
  arena: { x: 610, z: -310, yaw: 0 },
  hill: { x: 72, z: -146, r: 16, name: 'Ghat Top' },
  hillStart: [-420, 41],
  hillPar: { gold: 75, silver: 92, bronze: 115 },
};

// ---------------------------------------------------------------- the generator's hooks
const runwayLen = hyp(RUNWAY[1][0] - RUNWAY[0][0], RUNWAY[1][1] - RUNWAY[0][1]);
let apronLevel = 0, townLevel = 0;
const gen = {
  // the town's buildings as Kerala's; the lighthouse's tower a ring of posts
  walls: { ...KERALA_WALLS, lighthouse: (L, wall) => { for (let k = 0; k < 8; k++) { const a = k / 8 * 2 * P, b = (k + 1) / 8 * 2 * P; wall(L, 3.2 * Math.cos(a), 3.2 * Math.sin(a), 3.2 * Math.cos(b), 3.2 * Math.sin(b), 0.4); } } },
  prepare({ coarseAt }) {
    // the apron level with the runway's middle; the town on the level of its main street
    let s = 0;
    for (let k = 0; k <= 20; k++) s += coarseAt(lerp(RUNWAY[0][0], RUNWAY[1][0], k / 20), lerp(RUNWAY[0][1], RUNWAY[1][1], k / 20));
    apronLevel = s / 21;
    townLevel = coarseAt(TOWN.x, TOWN.z);
  },
  // the plain and the town smooth; the hills keep their bumps
  detail(x, z) { return x - shoreX(z) < 300 || x > 420 ? 0.35 : 1; },
  fine(x, z, h) {
    // the town's level ground, the airfield's apron and the land along the runway
    const td = hyp(x - TOWN.x, z - TOWN.z);
    if (td < TOWN.r * 1.4) h = lerp(h, townLevel + 0.3 * fbm(x / 60, z / 60, 2, S + 30), smoothstep(TOWN.r * 1.4, TOWN.r, td) * 0.85);
    const ax = Math.abs(x - APRON.x) - APRON.hw, az = Math.abs(z - APRON.z) - APRON.hd, ad = Math.max(ax, az);
    if (ad < 25) h = lerp(h, apronLevel, smoothstep(25, 0, ad));
    const t = clamp(((x - RUNWAY[0][0]) * (RUNWAY[1][0] - RUNWAY[0][0]) + (z - RUNWAY[0][1]) * (RUNWAY[1][1] - RUNWAY[0][1])) / (runwayLen * runwayLen), -0.08, 1.08);
    const rd = hyp(x - lerp(RUNWAY[0][0], RUNWAY[1][0], t), z - lerp(RUNWAY[0][1], RUNWAY[1][1], t));
    if (rd < 70) h = lerp(h, apronLevel, smoothstep(70, 30, rd) * 0.9);
    return h;
  },
  // the sea: everything west of the waterline, at the sea's level
  water({ setWater }) {
    for (let z = -1024; z <= 1024; z += 2) for (let x = -1024; x < shoreX(z) + 6; x += 2) setWater(x, z, SEA);
  },
  surface(x, z, h, sl, s) {
    const d = x - shoreX(z);
    if (d < 58 + 14 * fbm(x / 40, z / 40, 2, S + 40) && h < SEA + 4.5) return SURFACE.SAND;          // the beach
    const ax = Math.abs(x - APRON.x) - APRON.hw, az = Math.abs(z - APRON.z) - APRON.hd;
    if (ax < 0 && az < 0) return SURFACE.ROAD;                                                         // the apron
    if (s === SURFACE.DIRT && hyp(x - TOWN.x, z - TOWN.z) > TOWN.r) return SURFACE.GRASS;           // (dirt only in town)
    return s;
  },
  trees(ctx) {
    const { H, surf, R, trees: T, clear, cellOf, trailD, trailW, riverD, riverHalf, waterAt, hAt, onCourse } = ctx;
    const add = (x, z, type, ht, r) => { T.x.push(x); T.y.push(hAt(x, z)); T.z.push(z); T.h.push(ht); T.r.push(r); T.type.push(type); };
    // kinds (the Kerala set): 0 coconut, 1 jungle giant, 2 mango/jack, 3 rubber, 4 banana, 5 bamboo
    const blocked = (x, z) => {
      const idx = cellOf(x, z), tw = trailW(idx);
      // (the highway and the runway kept clear well back, the other roads a verge's width: the view ahead at speed)
      if (trailD(idx) < tw + (tw >= 7 ? 20 : 7)) return true;
      if (riverD(idx) < riverHalf(idx) + 3) return true;
      const wl = waterAt(x, z);
      if (wl > -1e8 && H[idx] < wl + 0.3) return true;
      if (Math.abs(x - APRON.x) < APRON.hw + 25 && Math.abs(z - APRON.z) < APRON.hd + 25) return true;
      for (const [cx, cz, cr] of clear) if (Math.abs(x - cx) < cr && Math.abs(z - cz) < cr && hyp(x - cx, z - cz) < cr) return true;
      return onCourse(x, z);
    };
    const bare = (s) => s === SURFACE.MUD || s === SURFACE.SAND || s === SURFACE.RIVERBED || s === SURFACE.GRAVEL || s === SURFACE.ROCK || s === SURFACE.ROAD;
    const STEP = 4;
    for (let z = -1021; z < 1021; z += STEP) {
      for (let x = -1021; x < 1021; x += STEP) {
        const px = x + (R() - 0.5) * STEP * 0.9, pz = z + (R() - 0.5) * STEP * 0.9, roll = R(), pick = R();
        const idx = cellOf(px, pz), s = surf[idx];
        if (bare(s)) continue;
        const d = px - shoreX(pz), h = H[idx], patch = fbm(px / 150, pz / 150, 2, S + 100);
        // the trees in clumps, open country between them (as a driving game's countryside opens up round its roads):
        // groves of coconut behind the beach with sand and grass between, woods with clearings on the hills, a copse
        // here and there on the plain
        const clump = patch + 0.6 * fbm(px / 70, pz / 70, 2, S + 140);
        const town = hyp(px - TOWN.x, pz - TOWN.z) < TOWN.r;
        let dens;
        if (d < 420) dens = town ? 0.03 : 0.006 + 0.15 * smoothstep(0.1, 0.45, clump);
        else if (h > 30) dens = 0.012 + 0.2 * smoothstep(0.05, 0.45, clump);
        else dens = 0.002 + 0.04 * smoothstep(0.3, 0.6, clump);
        if (roll > dens || blocked(px, pz)) continue;
        if (d < 420) {
          if (town) { if (pick < 0.5) add(px, pz, 0, 10 + R() * 9, 0.17); else if (pick < 0.8) add(px, pz, 4, 3 + R() * 2.2, 0.1); else add(px, pz, 2, 8 + R() * 7, 0.28); }
          else if (pick < 0.86) add(px, pz, 0, 11 + R() * 11, 0.17);
          else if (pick < 0.94) add(px, pz, 2, 8 + R() * 8, 0.28);
          else add(px, pz, 4, 3 + R() * 2.2, 0.1);
          continue;
        }
        if (h > 30) {
          if (riverD(idx) < riverHalf(idx) + 25 && pick < 0.4) add(px, pz, 5, 9 + R() * 7, 0.55);
          else if (pick < 0.4) { const ht = 18 + R() * 12; add(px, pz, 1, ht, 0.35 + ht * 0.012); }
          else add(px, pz, 2, 8 + R() * 8, 0.28);
          continue;
        }
        if (pick < 0.6) add(px, pz, 2, 8 + R() * 8, 0.28); else add(px, pz, 0, 10 + R() * 10, 0.17);
      }
    }
  },
};

/** The map, as the game and the generator see it. */
export const COAST = {
  id: 'coast', name: 'Konkan Coast', short: 'Coast',
  blurb: 'Tarmac by the Arabian Sea: a four-lane highway ring with long straights, a ghat road in hairpins over the hills, a beach town and an airstrip.',
  tagline: 'Old trucks, real physics, good friends. Drive the Konkan Coast together: race the ring, climb the ghat, find its survey beacons.',
  seed: SEED, station: STATION, spawn: SPAWN, dealer: 'Konkan Motors',
  baseHeight, roughOf, gen,
  river: RIVER, peaks: PEAKS,
  trails: TRAILS, beacons: BEACONS, landmarks: LANDMARKS, events: EVENTS, races: RACES, modes: MODES,
  roadSurface: SURFACE.ROAD, puddles: 0,
  // the sea to the horizon (render/Water.js)
  sea: { level: SEA },
  pads: { chaistall: 5, house: 7, busstop: 3, lighthouse: 9 },
  litter: [0.3, 1, 1, 1, 0.3, 0.8],
  treeStrength: [1, 1, 1, 0.8, 0.05, 1.5],
  young: {
    from: [0, 2, 2, 3, 4, null], alone: 2, h: { default: [2.2, 5.5], 0: [2.5, 4.5], 4: [2.2, 4] },
    r: { 0: (h) => 0.05 + 0.006 * h, 4: () => 0.09 }, edge: 0.2, wood: 0.3, open: 0.1, on: [SURFACE.GRASS, SURFACE.DIRT],
  },
  roadside: {
    fence: 'bamboo', fenceBy: ['house'], fenceReach: 26,
    byBuilding: { house: ['woodpile', 'drum'], chaistall: ['drum', 'crate', 'drum'], station: ['drum', 'crate'], garage: ['barrel', 'barrel', 'crate'], lighthouse: ['crate', 'drum'] },
    ring: { house: 7.5, chaistall: 5, station: 8.5, garage: 6.5, lighthouse: 7 },
  },
  dust: { [SURFACE.DIRT]: [0.42, 0.17, 0.08], [SURFACE.MUD]: [0.24, 0.09, 0.04], [SURFACE.ROAD]: [0.36, 0.33, 0.3], [SURFACE.SAND]: [0.62, 0.55, 0.42] },
  mudTint: [0.13, 0.045, 0.022],
  ground: 'coast', trees: 'kerala',
  // sea air: clearer than the ghats, fair-weather cloud
  atmosphere: { fog: 0.00042, cover: 0.3 },
};
