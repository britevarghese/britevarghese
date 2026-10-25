// The open world's north-west corner (world/maps/world.js): Lalghati Canyon, a 2 km square west of Bearwood Taiga and
// north of Chalkewadi, red sandstone country in the manner of the canyon maps of the mud-and-timber truck games. The
// Bearwood leaves the taiga and runs west through a canyon it has cut a hundred metres down into a plateau of red rock
// (lal ghati: the red valley), then north out of the world.
//
//   the canyon: walls of red sandstone in ledges (beds of harder rock standing out over softer, world/WorldGen.js shapes
//     them here, render/Terrain.js draws their beds) round a broad open floor, 250 to 380 m across: the river on it
//     between sand bars, red mud flats where it floods, reeds, acacias here and there, a wide braided shallows at its
//     bend; Lalghati Base on the floor where it opens to the taiga
//   Hidden Creek: a side canyon off its south side, a creek in a channel down its floor from the Hidden Pool under a dry
//     fall at its head, across the main floor to the river
//   Red Pool: a box canyon off its north side, a waterhole under its end wall in the reeds
//   the plateau: slickrock and red sand on top, thor (the candelabra spurge) and acacias, the Rim Lookout over the gorge
//   the escarpment: the plateau's south edge, a wall down to the bench below, broken where a ramp of fallen rock comes
//     down; on the bench red mud flats that hold the rain and the Chimneys, three sandstone buttes
//
// The tracks: the Gorge Track up the floor from the taiga, through the river at the shallows and on north; the Ledge
// Road, a shelf cut along the canyon's south wall up to the rim; the Rim Track along the top; the Hidden Creek Track up
// the creek; the Red Pool Track; the Chimneys Road down the ramp to the bench and the buttes.
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { TAIGA, TAIGA_RIVER_PTS } from './taiga.js';
import { landform } from '../WorldGen.js';
import { ridged, rng } from '../Noise.js';
import { graded } from './seams.js';
import { clamp, lerp, smoothstep, gauss, hyp, fbm, vnoise, lineNear, lineLength, along, plant, desert, DESERT, TROPICAL, stretch, trailsOf } from './country.js';

/** The canyon's centre in the world (a 2 km square west of the taiga, north of Chalkewadi and the Table Land). */
export const CANYON_AT = [2976, -6844];
export const CANYON_HALF = 1024;
const SEED = 7731;

// ---------------------------------------------------------------- the river and its gorge
/** The Bearwood through the canyon: in from the taiga across the east edge, west and then north out of the world. */
export const CANYON_RIVER_PTS = [[1024, 300], [880, 285], [740, 232], [600, 192], [470, 214], [330, 160], [200, 62], [60, -8], [-100, -28],
  [-250, -96], [-360, -238], [-420, -420], [-410, -612], [-352, -800], [-310, -1024]];
const RIVER_LEN = lineLength(CANYON_RIVER_PTS);
// (the gorge carried on past the map's ends: on from the taiga's valley, and on north under the far land)
const GORGE_PTS = [[1320, 312], ...CANYON_RIVER_PTS, [-276, -1560]];
const GORGE_OFF = hyp(1320 - 1024, 312 - 300);
/** The river's fords: where the Red Pool Track crosses. (The Gorge Track crosses in the shallows at the bend.) */
export const CANYON_FORDS = [[60, -8]];
/** The shallows at the bend: the river spread wide and knee deep over its stones. */
export const CANYON_SHALLOWS = { x: -300, z: -160, r: 80, depth: 0.32, widen: 1.3 };

// the river's level where it comes in: the taiga's where it leaves (world/WorldGen.js landform), then falling 24 m
// through the canyon
let level0 = null;
const riverIn = () => (level0 ??= landform(TAIGA).riverNear(-1024, TAIGA_RIVER_PTS[TAIGA_RIVER_PTS.length - 1][1]).level);
export const canyonLevel = (s) => riverIn() - 24 * s;

/** The canyon's floor, a half-width (m) along it (fraction along the river): a broad open valley between its walls, widest where it opens to the taiga and to the north. */
const floorHalf = (s) => lerp(lerp(190, 125, smoothstep(0.02, 0.24, s)), 160, smoothstep(0.72, 0.95, s));

// the side canyons: Hidden Creek off the south side (its creek down from the Hidden Pool), and the Red Pool box canyon
// off the north side; each a broad floor rising gently from the main one to its head, the creek in a channel down it,
// walls up to the plateau
export const CREEK = { pts: [[372, 228], [384, 300], [370, 380], [400, 450]], half: 22, wall: 24, rise: 8, pool: 26 };
export const RED_POOL = { pts: [[72, -14], [52, -150], [92, -288], [58, -414]], half: 34, wall: 32, rise: 7, pool: 38 };
const SIDES = [CREEK, RED_POOL].map((c) => ({ ...c, len: lineLength(c.pts) }));
/** The pools at the heads of the side canyons: [x, z, r]. */
export const POOLS = SIDES.map((c) => [...c.pts[c.pts.length - 1], c.pool]);

// the escarpment: the plateau's south edge, about 560 m south of the middle, with a ramp of fallen rock down it at
// x -150 (the Chimneys Road); the bench below it; the Chimneys standing on the bench
const RAMP_X = -150;
export const BUTTES = [{ x: -520, z: 730, r: 36, h: 64 }, { x: -372, z: 790, r: 24, h: 52 }, { x: 250, z: 742, r: 30, h: 58 }];
const BENCH = 56;

/** The plateau and the bench, before the gorge is cut into them. */
function upland(x, z) {
  const wx = x + 40 * fbm(x / 300, z / 300, 2, SEED + 1), wz = z + 40 * fbm(x / 300 + 5.1, z / 300 - 3.3, 2, SEED + 2);
  // the plateau: rolling slickrock at 150-175 m, domes of it standing up, dry washes cut down a few metres
  let top = 160 + 12 * fbm(wx / 420, wz / 420, 3, SEED + 3) + 4 * fbm(wx / 80, wz / 80, 2, SEED + 4);
  top += 9 * Math.max(0, ridged(wx / 150, wz / 150, 3, SEED + 15) - 0.35) * 2;
  top -= 5 * smoothstep(0.62, 0.9, 1 - Math.abs(fbm(wx / 240, wz / 240, 2, SEED + 16)) * 3.2);
  // the bench below the escarpment: red earth and mud flats in hollows
  const bench = BENCH + 5 * fbm(x / 200, z / 200, 2, SEED + 6);
  // the escarpment: 90 m wide, a few hundred where the rock has fallen into a ramp
  const edgeZ = 560 + 45 * fbm(x / 260, 0.5, 2, SEED + 5), ramp = gauss(x - RAMP_X, 90);
  let h = lerp(top, bench, smoothstep(edgeZ - 30 - 120 * ramp, edgeZ + 60 + 260 * ramp, wz));
  // the Chimneys: buttes in beds, their sides sheer
  for (const b of BUTTES) {
    const d = hyp(x - b.x, z - b.z) + 5 * fbm(x / 25, z / 25, 2, SEED + 8);
    if (d < b.r + 20) h = Math.max(h, bench + b.h * smoothstep(b.r + 16, b.r, d) * (0.94 + 0.06 * fbm(x / 9, z / 9, 2, SEED + 9)));
  }
  return h;
}

/** The ground: the upland with the gorge and its side canyons cut into it. */
export function canyonGround(x, z) {
  const up = upland(x, z);
  const g = lineNear(GORGE_PTS, x, z), gd = g.d, gs = g.s;
  const s = clamp((gs - GORGE_OFF) / RIVER_LEN, 0, 1);
  const floor = canyonLevel(s) + 2.2 + 0.014 * Math.max(0, gd - 14);
  // (the walls wander, and the floor narrows and widens)
  const half = floorHalf(s) + 12 * fbm(gs / 110, 0.3, 2, SEED + 10);
  const wall = 42 + 16 * vnoise(gs / 160, 1.7, SEED + 11);
  const d = gd + 12 * fbm(x / 70, z / 70, 2, SEED + 12);
  // (where the upland is already below the floor, the bench far from the gorge, it stands as it is)
  let h = up <= floor ? up : lerp(floor, up, smoothstep(half, half + wall, d) ** 0.85);
  // the side canyons: their floors from the gorge's up to their heads, a pool at each head
  for (const c of SIDES) {
    // (its mouth on the gorge's floor: that floor's height there, reckoned once)
    c.f0 ??= canyonLevel(clamp((lineNear(GORGE_PTS, ...c.pts[0]).s - GORGE_OFF) / RIVER_LEN, 0, 1)) + 2.2;
    const n = lineNear(c.pts, x, z), nd = n.d, ns = n.s;
    if (nd > c.half + c.wall + 30) continue;
    // (the creek's channel down the middle: a couple of metres wide, half a metre down)
    const t = ns / c.len, sf = c.f0 + c.rise * t + 0.3 * fbm(ns / 12, 0.1, 2, SEED + 13) - 0.55 * smoothstep(4.5, 1.5, nd);
    const dd = nd + 3 * fbm(x / 20, z / 20, 2, SEED + 14);
    // (wider at the head, round the pool: a bowl a metre and a half deep under the dry fall)
    const hw = c.half + (c.pool - c.half) * smoothstep(0.82, 1, t), [px, pz] = c.pts[c.pts.length - 1];
    const bowl = 1.7 * smoothstep(c.pool * 0.95, c.pool * 0.35, hyp(x - px, z - pz));
    h = Math.min(h, lerp(sf - bowl, h, smoothstep(hw, hw + c.wall, dd) ** 0.8));
  }
  return h;
}

// ---------------------------------------------------------------- the places
const BASE = { x: 822, z: 350 }, LOOKOUT = { x: 132, z: 222 }, RAMP_TOP = { x: RAMP_X, z: 420 };
/** The mud flats on the bench: a hollow of red mud between the Chimneys, standing water in its low spots. */
export const MUD_FLATS = { x: -40, z: 735, rx: 170, rz: 58, rot: 0.08 };

/** Its rallies' par times (seconds): a careful driver in three stock trucks, gold about the best of them. */
const PAR = { lalghatirun: { gold: 135, silver: 162, bronze: 200 }, ledgeroad: { gold: 125, silver: 150, bronze: 185 } };

export const CANYON_ROUTES = {
  // (in from the taiga up the gorge's floor past the base along the river's south bank, through the river in the
  // shallows at the bend and on north along its east bank; its waypoints on the floor beside the river)
  'Gorge Track': { via: [[1024, 336], [949, 342], [880, 335], [801, 309], [736, 284], [673, 265], [607, 241], [558, 241], [488, 247], [404, 224], [340, 194],
    [274, 155], [213, 119], [159, 88], [98, 53], [47, 29], [-22, 16], [-92, 11], [-170, -14], [-232, -46], [-300, -160], [-329, -254], [-366, -376],
    [-379, -499], [-354, -625], [-312, -759], [-283, -860]], kind: 'trail', width: 3.0, extend: [8, 0] },
  // (a shelf cut along the canyon's south wall from the floor, round the bend and up the west wall to the rim, 1.1 km
  // at 9%: its waypoints where the wall stands at the height it has climbed to; wide enough for two trucks to pass)
  'Ledge Road': { via: [[404, 224], [382, 254], [321, 286], [245, 260], [212, 228], [175, 203], [133, 183], [111, 183], [72, 160], [36, 133], [-7, 132],
    [-52, 131], [-97, 128], [-186, 107], [-227, 88], [-269, 72], [-310, 55], [-401, -27], [-430, -62], [-460, -95], [-493, -127], [-530, -190]],
  kind: 'trail', width: 5.0, routeGrade: 0.17, grade: 0.2, cut: 14, shoulder: 7 },
  // (along the plateau back from the rim, from the top of the shelf round the bend to the lookout)
  'Rim Track': { via: [[-530, -190], [-570, -90], [-550, 50], [-440, 160], [-300, 210], [-160, 240], [-60, 260], [60, 270], [LOOKOUT.x, LOOKOUT.z + 34]], kind: 'trail', width: 2.8 },
  // (off the rim track down the ramp of fallen rock in the escarpment to the bench, past the mud flats to the Chimneys)
  'Chimneys Road': { via: [[-60, 260], [RAMP_TOP.x, RAMP_TOP.z], [-150, 600], [-170, 690], [-300, 760], [-450, 790]], kind: 'trail', width: 2.8, routeGrade: 0.2 },
  // (up beside the creek, across the floor and up the side canyon to the Hidden Pool)
  'Hidden Creek Track': { via: [[404, 224], [394, 262], [400, 330], [388, 400], [420, 436]], kind: 'trail', width: 2.8 },
  // (across the river at the ford and up the box canyon beside its creek to the Red Pool)
  'Red Pool Track': { via: [[47, 29], [62, -8], [68, -150], [106, -280], [82, -376]], kind: 'trail', width: 2.8, routeGrade: 0.3 },
};

// ---------------------------------------------------------------- what's where
const near = (pts, x, z) => lineNear(pts, x, z).d;
/** How much of a wall (0 to 1) the ground is at (x, z): the steepness of the landform (its coarse grid), its beds cut there. */
const wallness = (K, x, z) => {
  const c = K.coarseAt, e = 4;
  return smoothstep(0.28, 0.7, hyp(c(x + e, z) - c(x - e, z), c(x, z + e) - c(x, z - e)) / (2 * e));
};
const inFlats = (x, z) => {
  const dx = x - MUD_FLATS.x, dz = z - MUD_FLATS.z, c = Math.cos(MUD_FLATS.rot), s = Math.sin(MUD_FLATS.rot);
  return hyp((dx * c + dz * s) / MUD_FLATS.rx, (-dx * s + dz * c) / MUD_FLATS.rz);
};

/**
 * The colours over its ground: the sandstone in its strata (bands a few metres deep, cream, orange and deep red, a
 * darker varnish where it weathers), the red earth and sand, the grass dry but by the water.
 */
const STRATA = [[1.04, 0.66, 0.52], [0.72, 0.36, 0.26], [1.22, 1.3, 1.36], [0.9, 0.5, 0.36], [0.62, 0.3, 0.22], [1.08, 0.82, 0.7], [0.82, 0.44, 0.32]];
const canyonTint = (x, z, layer, h, c) => {
  if (layer === 'rock') {
    // (the beds dip a little, and their colours run on along them: the band by the height, warped)
    const y = h + 2.5 * fbm(x / 140, z / 140, 2, SEED + 20), b = y / 4.6 + 0.4 * Math.sin(y / 17);
    const i = Math.floor(b), f = b - i, A = STRATA[((i % 7) + 7) % 7], B = STRATA[(((i + 1) % 7) + 7) % 7], k = smoothstep(0.8, 1, f);
    const v = 0.9 + 0.18 * vnoise(x / 13, z / 13, SEED + 21), varnish = 1 - 0.28 * smoothstep(0.55, 0.8, vnoise(x / 9, h / 3, SEED + 22));
    for (let j = 0; j < 3; j++) c[j] *= lerp(A[j], B[j], k) * v * varnish;
  } else if (layer === 'dirt') { c[0] *= 1.25; c[1] *= 0.92; c[2] *= 0.8; }
  else if (layer === 'sand') { c[0] *= 1.2; c[1] *= 1.0; c[2] *= 0.86; }
  else if (layer === 'grass') {
    // (dry, straw-coloured; green by the water, and the reeds there)
    const wet = smoothstep(40, 10, Math.min(creekD(x, z), lineNear(CANYON_RIVER_PTS, x, z).d - 12));
    c[0] *= lerp(1.8, 1.05, wet); c[1] *= lerp(1.0, 1.05, wet); c[2] *= lerp(1.2, 0.85, wet);
  }
  else if (layer === 'mud') { c[0] *= 1.2; c[1] *= 0.95; c[2] *= 0.78; }           // (red mud)
  else if (layer === 'gravel' || layer === 'pebbles') { c[0] *= 1.42; c[1] *= 0.96; c[2] *= 0.76; }   // (the red rock's)
};

/** The floor of the gorge (fraction along the river, and the floor's height there) at (x, z), and how far off the river. */
const gorgeAt = (x, z) => {
  const g = lineNear(GORGE_PTS, x, z), sR = clamp((g.s - GORGE_OFF) / RIVER_LEN, 0, 1);
  return { d: g.d, floor: canyonLevel(sR) + 2.2, half: floorHalf(sR) };
};
/** Distance to the water at the heads and down the floors of the side canyons (their creeks and pools). */
const creekD = (x, z) => {
  let d = Infinity;
  for (const c of SIDES) {
    const n = lineNear(c.pts, x, z), [px, pz] = c.pts[c.pts.length - 1];
    d = Math.min(d, Math.max(0, n.d - 2), Math.max(0, hyp(x - px, z - pz) - c.pool * 0.75));
  }
  return d;
};

export const CANYON = stretch({
  id: 'canyon', name: 'Lalghati Canyon', short: 'Lalghati', seed: SEED, half: CANYON_HALF,
  blurb: 'Red rock country: a broad canyon cut a hundred metres into a sandstone plateau, its floor wide open, red mud flats by the river, a side canyon with a creek in it, waterholes in the reeds, and buttes under the escarpment.',
  station: { x: BASE.x, z: BASE.z, name: 'Lalghati Base' }, spawn: { x: BASE.x - 12, z: BASE.z + 30, yaw: -Math.PI / 2 }, dealer: 'Lalghati Base',
  load: () => COAST.load(), baseHeight: canyonGround, roughOf: (h) => clamp((h - 60) / 220, 0.15, 0.5),
  ...TROPICAL, ground: 'canyon', trees: 'canyon', farWoods: 0.12, tint: canyonTint, tintRange: 2.5,
  // (the grass on the tracks' humps and verges dry too)
  vergeTint: [1.6, 1.0, 1.2],
  // (its boulders and blocks in the colours of its beds, render/Rocks.js)
  rockTint: true,
  // (each kind of tree: an acacia drops a little litter, a thor none, a dead tree its twigs; a thor's soft stems give
  // at a touch, a dead tree's brittle trunk soon; and young ones of the nearest kind by the tracks)
  litter: [0.35, 0, 0.15], treeStrength: [0.9, 0.12, 0.35],
  young: {
    from: [0, 1, 0], alone: 0, h: { default: [1.6, 3.6], 1: [0.9, 2.2] }, r: { 0: (h) => 0.04 + 0.01 * h, 1: () => 0.12 },
    edge: 0.16, wood: 0.12, open: 0.35, on: [SURFACE.GRASS, SURFACE.DIRT],
  },
  // reeds at the waters' edges and out into the shallows, in clumps (render/Grass.js): round the pools, along the creeks
  // and the river, in the mud flats' pools
  reeds(x, z, w) {
    let wl = w.water(x, z);
    if (wl < -1e8) wl = Math.max(w.water(x + 2.5, z), w.water(x - 2.5, z), w.water(x, z + 2.5), w.water(x, z - 2.5));
    if (wl < -1e8) return 0;
    const depth = wl - w.terrain(x, z), n = vnoise(x / 5, z / 5, SEED + 50);
    return depth < 0.5 && depth > -0.45 && n > 0.42 ? 1.1 + 1.3 * (n - 0.42) : 0;
  },
  // its sandstone in strong beds (render/Terrain.js), its own air: clear and warm, the colours rich
  rockBeds: 1.5,
  // and streaked dark down its faces with desert varnish where the rain runs off its ledges (render/Terrain.js)
  varnish: 1,
  // its water red-brown with the sand it carries, its bed hidden a hand's depth down (render/Water.js)
  water: { silt: [0.26, 0.135, 0.075] },
  // and its walls' beds in three dimensions (world/Ledges.js, render/Ledges.js): at the lip of each bed (as the walls'
  // shaping, gen.fine below, cuts them) a ledge jutting out over the face below, and here and there a thinner one
  // partway down the face; on the gorge's walls, the side canyons', the buttes' and the escarpment's
  ledges: {
    bed: (x, z, h) => { const y = h + 2.5 * fbm(x / 140, z / 140, 2, SEED + 20); return y / 10.5 + 0.22 * Math.sin(y / 23); },
    levels: [
      { at: 0.96, out: [0.9, 2.4], thick: [1.5, 2.8], block: [6, 16] },
      { at: 0.58, out: [0.25, 0.8], thick: [0.5, 1.0], block: [3, 8], cover: 0.45 },
    ],
    minSlope: 0.9, clear: 8, seed: SEED + 400,
  },
  atmosphere: { fog: 0.0004, cover: 0.62 }, air: { fog: 0.0004, cover: 0.62, sun: 1, sat: 1.1, fade: 200 },
  dust: { ...COAST.dust, [SURFACE.SAND]: [0.5, 0.26, 0.15], [SURFACE.DIRT]: [0.45, 0.22, 0.12] },
  puddles: 5, mudFields: 2.5, rockFields: 2.5, mudTracks: 0.35, wornTracks: true, rockRelief: true, looseRocks: 4,
  river: { points: CANYON_RIVER_PTS, widthStart: 16, widthEnd: 22, depthStart: 1.8, depthEnd: 2.2, fords: CANYON_FORDS, shallows: [CANYON_SHALLOWS],
    levelAt: canyonLevel, valleyAt: () => [60, 26], cliffs: true },
  trails: trailsOf('canyon', CANYON_ROUTES),
  landmarks: [
    { type: 'station', x: BASE.x, z: BASE.z, yaw: Math.PI / 2, sign: 'LALGHATI BASE' },
    { type: 'cabin', x: BASE.x + 34, z: BASE.z + 22, yaw: 1.4 }, { type: 'cabin', x: BASE.x + 30, z: BASE.z - 14, yaw: 1.7 },
    { type: 'flag', x: BASE.x - 14, z: BASE.z - 18, yaw: 0 }, { type: 'mast', x: BASE.x + 52, z: BASE.z + 50, yaw: 0 },
    { type: 'lookout', x: LOOKOUT.x, z: LOOKOUT.z, yaw: Math.PI },
  ],
  beacons: [
    { id: 0, name: 'Lalghati Base', x: BASE.x - 30, z: BASE.z - 34 }, { id: 1, name: 'Hidden Creek', x: 404, z: 330 },
    { id: 2, name: 'Hidden Pool', x: 424, z: 430 }, { id: 3, name: 'Red Pool', x: 80, z: -362 },
    { id: 4, name: 'Rim Lookout', x: LOOKOUT.x + 14, z: LOOKOUT.z + 20 }, { id: 5, name: 'Lal Shallows', x: -262, z: -120 },
    { id: 6, name: 'The Chimneys', x: -440, z: 690 }, { id: 7, name: 'Mud Flats', x: -40, z: 690 },
    { id: 8, name: 'North Bar', x: -300, z: -790 },
  ],
  races: [
    { id: 'lalghatirun', kind: 'rally', name: 'Lalghati Canyon Run', desc: 'Down the canyon floor from the base between the red walls, past the mouth of Hidden Creek and through the river at the shallows.',
      trail: 'Gorge Track', from: [801, 309], to: [-300, -160], cps: 7, r: 12, par: PAR.lalghatirun, prize: 1.5 },
    { id: 'ledgeroad', kind: 'rally', name: 'Ledge Road Climb', desc: 'Up the shelf road cut along the canyon wall, from the floor round the bend and up the west wall to the rim, a hundred metres up.',
      trail: 'Ledge Road', from: [382, 254], to: [-530, -190], cps: 5, r: 10, par: PAR.ledgeroad, prize: 1.4 },
  ],
  // (its tracks laid as trails are: the shelf road cut into the wall as deep as it needs, its bed banked no wider than
  // its shoulders, so the floor below it stays the floor)
  gen: graded([], {
    prepare({ K, coarseAt }) { K.coarseAt = coarseAt; },
    // the walls in beds: each 8-13 m deep, a ledge of harder rock over a steep face of softer, their lips a little
    // ragged, runnels worn down the faces
    fine(x, z, h, K) {
      const w = wallness(K, x, z);
      if (w <= 0) return h;
      const off = 2.5 * fbm(x / 140, z / 140, 2, SEED + 20), y = h + off;
      const u = y / 10.5 + 0.22 * Math.sin(y / 23), du = 1 / 10.5 + 0.22 / 23 * Math.cos(y / 23);
      const bed = Math.floor(u), f = u - bed, lip = 0.38 + 0.12 * fbm(x / 18, z / 18, 2, SEED + 24);
      const stepped = y + (bed + smoothstep(lip, 0.97, f) - u) / du - off;
      return lerp(h, stepped, w) + w * 1.4 * (ridged(x / 16, z / 16, 2, SEED + 23) - 0.4);
    },
    surface(x, z, h, sl, s, idx, ctx) {
      if (s === SURFACE.RIVERBED) return s;
      const w = wallness(ctx.K, x, z);
      if (sl > 0.62 || (w > 0.35 && sl > 0.32)) return SURFACE.ROCK;
      const n1 = vnoise(x / 23, z / 23, SEED + 30), n2 = vnoise(x / 7, z / 7, SEED + 31), n3 = vnoise(x / 55, z / 55, SEED + 32);
      // the side canyons' floors: shingle down the creek, sand and mud round the pools
      const cd = creekD(x, z);
      if (cd < 3) return n2 > 0.5 ? SURFACE.GRAVEL : SURFACE.MUD;
      if (cd < 9) return n2 > 0.55 ? SURFACE.SAND : SURFACE.MUD;
      // the river's banks (the generator's sand and shingle), and the floor of the gorge beside them
      if (s === SURFACE.SAND || s === SURFACE.GRAVEL) return s;
      const g = gorgeAt(x, z);
      if (h < g.floor + 5 && g.d < g.half + 40) {
        if (g.d < 30) return n1 > 0.58 ? SURFACE.MUD : n2 > 0.52 ? SURFACE.SAND : SURFACE.GRAVEL;
        // (red mud flats out across the floor where the river floods it, most of it near the river; earth, dry grass
        // and drifts of sand between)
        if (n3 > 0.62 - 0.2 * smoothstep(g.half * 0.8, 40, g.d)) return SURFACE.MUD;
        return n1 > 0.7 ? SURFACE.GRASS : n2 > 0.66 ? SURFACE.SAND : SURFACE.DIRT;
      }
      // the bench: the mud flats, red earth and drifts of sand, grass in the hollows
      if (h < 90 && z > 400) {
        if (inFlats(x, z) < 1 + 0.12 * fbm(x / 20, z / 20, 2, SEED + 33)) return SURFACE.MUD;
        return n1 > 0.62 ? SURFACE.GRASS : n2 > 0.6 ? SURFACE.SAND : SURFACE.DIRT;
      }
      // the ledges and the plateau: slickrock, red sand in its hollows, earth and a little grass in the pockets
      if (w > 0.15) return n2 > 0.72 ? SURFACE.SAND : SURFACE.ROCK;
      return n1 > 0.4 ? SURFACE.ROCK : n2 > 0.55 ? SURFACE.SAND : n3 > 0.55 ? SURFACE.GRASS : SURFACE.DIRT;
    },
    // standing water: the creeks running down the side canyons' floors from their pools, the pools, and the mud flats'
    // low spots
    water({ K, setWater, hAt, cellOf, trailD, trailW, waterRes }) {
      for (const c of SIDES) {
        const [px, pz] = c.pts[c.pts.length - 1], top = c.f0 + c.rise;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of c.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        for (let x = Math.floor((x0 - c.pool) / waterRes) * waterRes; x <= x1 + c.pool; x += waterRes) {
          for (let z = Math.floor((z0 - c.pool) / waterRes) * waterRes; z <= z1 + c.pool; z += waterRes) {
            const pd = hyp(x - px, z - pz);
            if (pd < c.pool * 0.82) { setWater(x, z, top + 0.34); continue; }
            // (the creek in its channel, knee deep at the middle)
            const n = lineNear(c.pts, x, z), nd = n.d, ns = n.s;
            if (nd < 3.5) setWater(x, z, c.f0 + c.rise * ns / c.len + 0.05);
          }
        }
      }
      const pts = [], hs = [];
      for (let x = MUD_FLATS.x - MUD_FLATS.rx; x <= MUD_FLATS.x + MUD_FLATS.rx; x += waterRes) {
        for (let z = MUD_FLATS.z - MUD_FLATS.rx; z <= MUD_FLATS.z + MUD_FLATS.rx; z += waterRes) {
          if (inFlats(x, z) > 0.85) continue;
          const idx = cellOf(x, z);
          if (trailD(idx) < trailW(idx) + 3) continue;
          pts.push(x, z); hs.push(hAt(x, z));
        }
      }
      if (hs.length) {
        const level = [...hs].sort((a, b) => a - b)[Math.floor(hs.length * 0.3)] + 0.06;
        for (let i = 0; i < hs.length; i++) if (hs[i] < level) setWater(pts[2 * i], pts[2 * i + 1], level);
      }
    },
    trees(ctx) {
      const { K, hAt } = ctx;
      plant(ctx, 7, (x, z, s, h, R, roll) => {
        if (hyp(x - BASE.x, z - BASE.z) < 75 || hyp(x - LOOKOUT.x, z - LOOKOUT.z) < 20 || ctx.hoodoos?.some(([hx, hz]) => hyp(x - hx, z - hz) < 8)) return null;
        // (nothing on the faces of the walls: a tree there stands out from the cliff like a blot; the ledges keep theirs)
        if (Math.max(Math.abs(hAt(x + 2, z) - hAt(x - 2, z)), Math.abs(hAt(x, z + 2) - hAt(x, z - 2))) > 2) return null;
        const w = wallness(K, x, z);
        if (s === SURFACE.ROCK && roll > 0.08) return null;
        const pick = R(), wet = Math.min(creekD(x, z), lineNear(CANYON_RIVER_PTS, x, z).d - 14);
        // by the water: acacias thick; on the gorge's floor and the bench, acacias scattered; on the ledges and the
        // plateau a thor in the cracks now and then, a few acacias in the pockets of earth, dead trees here and there
        if (wet < 30) return roll < 0.32 ? desert(pick < 0.92 ? DESERT.acacia : DESERT.dead, R) : null;
        const g = gorgeAt(x, z);
        if (h < g.floor + 5 && g.d < g.half + 40) return roll < 0.07 ? desert(pick < 0.9 ? DESERT.acacia : pick < 0.96 ? DESERT.thor : DESERT.dead, R) : null;
        if (h < 90 && z > 400) return roll < 0.13 ? desert(pick < 0.62 ? DESERT.acacia : pick < 0.9 ? DESERT.thor : DESERT.dead, R) : null;
        if (w > 0.15) return roll < 0.09 ? desert(pick < 0.7 ? DESERT.thor : DESERT.acacia, R) : null;
        return roll < 0.08 ? desert(pick < 0.5 ? DESERT.thor : pick < 0.92 ? DESERT.acacia : DESERT.dead, R) : null;
      });
    },
    // fallen rock: blocks at the foot of the walls and down the escarpment's ramp
    boulders(ctx, add, list) {
      const { K, trailD, trailW, cellOf, onCourse, hAt } = ctx, R = rng(SEED + 99);
      for (let n = 0; n < 9000; n++) {
        const x = (R() * 2 - 1) * (CANYON_HALF - 30), z = (R() * 2 - 1) * (CANYON_HALF - 30), roll = R();
        const w = wallness(K, x, z), g = gorgeAt(x, z), foot = Math.abs(hAt(x, z) - g.floor - 6) < 6 && g.d < g.half + 60;
        const ramp = gauss(x - RAMP_X, 70) * smoothstep(380, 470, z) * smoothstep(720, 640, z);
        if (!((w > 0.05 && w < 0.5 && foot && roll < 0.5) || roll < ramp * 0.35)) continue;
        const idx = cellOf(x, z);
        if (trailD(idx) < trailW(idx) + 3 || onCourse(x, z, 9)) continue;
        add(x, z, 0.7 + R() * 1.4 + R() * R() * 1.8, 0.25 + R() * 0.2);
      }
      const RW = rng(SEED + 97), { waterAt } = ctx;
      const depth = (x, z) => { const wl = waterAt(x, z); return wl > -1e8 ? wl - hAt(x, z) : -9; };
      const clearAt = (x, z, m) => { const idx = cellOf(x, z); return trailD(idx) > trailW(idx) + m && !onCourse(x, z, m + 6); };
      // hoodoos: pillars of the sandstone standing free of the walls on the floor near their feet, left where the wall
      // round them has worn back, each a stack of its beds' blocks, narrowing up it, a harder bed's block a cap rock on
      // top (Thor's Hammer at Bryce); off the tracks, the water and each other
      const RH = rng(SEED + 95), hoodoos = ctx.hoodoos = [];
      for (let n = 0; n < 4000 && hoodoos.length < 9; n++) {
        const x = (RH() * 2 - 1) * (CANYON_HALF - 60), z = (RH() * 2 - 1) * (CANYON_HALF - 60), w = wallness(K, x, z), g = gorgeAt(x, z), h = hAt(x, z);
        if (w > 0.05 || h > g.floor + 4 || g.d > g.half + 50 || g.d < 40 || creekD(x, z) < 20) continue;
        // (near a wall: steep ground within 50 m)
        let wall = false;
        for (let a = 0; a < 8 && !wall; a++) wall = wallness(K, x + Math.cos(a * Math.PI / 4) * 45, z + Math.sin(a * Math.PI / 4) * 45) > 0.4;
        if (!wall || !clearAt(x, z, 14) || hoodoos.some(([hx, hz]) => hyp(hx - x, hz - z) < 140) || hyp(x - BASE.x, z - BASE.z) < 120) continue;
        hoodoos.push([x, z]);
        // (its blocks sunk into each other, one column of rock: its harder beds standing out a little wider than the
        // softer, a wavering outline up it)
        const W0 = 2.2 + RH() * 1.4, nb = 8 + Math.floor(RH() * 7), yaw = RH() * Math.PI, ph = RH() * 6;
        let top = null;
        for (let k = 0; k < nb; k++) {
          const cap = k === nb - 1, f = cap ? 1.25 : (1 - 0.36 * k / nb) * (1 + 0.1 * Math.sin(k * 1.9 + ph)), ry = cap ? 0.75 + RH() * 0.3 : 1.1 + RH() * 0.6;
          const wx = W0 * f * (0.92 + 0.16 * RH()), wz = W0 * f * (0.78 + 0.2 * RH()), ox = k ? (RH() - 0.5) * 0.25 : 0, oz = k ? (RH() - 0.5) * 0.25 : 0;
          const y = top === null ? h - ry * 0.3 : top + ry * 0.22;
          list.push({ x: x + ox, y, z: z + oz, rx: wx, ry, rz: wz, yaw: yaw + (RH() - 0.5) * 0.12, shade: RH(), block: Math.floor(RH() * 6) });
          top = y + ry * 0.66;
        }
      }
      // the shores: stones the water has rolled round, in clusters out in the shallows and up the wet sand at its edge;
      // and where a bank is rock, slabs of the bedrock the river has bared, flat on their beds, stepping down into it
      const shores = [[CANYON_RIVER_PTS, 26, 26000], ...SIDES.map((c) => [c.pts, 6, 2400])];
      for (const [pts, across, draws] of shores) {
        const len = lineLength(pts);
        for (let n = 0; n < draws; n++) {
          const s = RW() * len, [ax, az] = along(pts, s), [bx, bz] = along(pts, s + 2), l = hyp(bx - ax, bz - az) || 1;
          const o = (RW() * 2 - 1) * across, x = ax - (bz - az) / l * o, z = az + (bx - ax) / l * o, roll = RW();
          const d = depth(x, z), clump = vnoise(x / 7, z / 7, SEED + 98);
          if (d > 0.45 || d < -0.7 || roll > (clump - 0.38) * 2.2 || !clearAt(x, z, 2)) continue;
          add(x, z, 0.16 + RW() * 0.28 + RW() * RW() * RW() * 0.9, 0.3 + RW() * 0.2, RW);
        }
      }
      for (const [px, pz, r] of POOLS) {
        for (let n = 0; n < 1500; n++) {
          const a = RW() * Math.PI * 2, rr = r * (0.6 + 0.6 * RW()), x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr, d = depth(x, z);
          if (d > 0.4 || d < -0.6 || RW() > vnoise(x / 6, z / 6, SEED + 98) * 1.4 || !clearAt(x, z, 2)) continue;
          add(x, z, 0.18 + RW() * 0.3 + RW() * RW() * 0.6, 0.35, RW);
        }
      }
      for (let n = 0, len = lineLength(CANYON_RIVER_PTS); n < 5000; n++) {
        const s = RW() * len, [ax, az] = along(CANYON_RIVER_PTS, s), [bx, bz] = along(CANYON_RIVER_PTS, s + 2), l = hyp(bx - ax, bz - az) || 1;
        const o = (RW() * 2 - 1) * 26, x = ax - (bz - az) / l * o, z = az + (bx - ax) / l * o, d = depth(x, z);
        // (a slab where the water laps the bank's edge, where the rock runs out under it)
        if (d > 0.25 || d < -0.35 || vnoise(x / 30, z / 30, SEED + 96) < 0.55 || !clearAt(x, z, 4)) continue;
        const yaw = -Math.atan2(bz - az, bx - ax) + (RW() - 0.5) * 0.5, g = hAt(x, z);
        // (each the next bed up, smaller, set back from the water: its foot on the one below it)
        for (let k = 0, top = null, w = 1.6 + RW() * 2.2, nb = 1 + Math.floor(RW() * 2.4); k < nb; k++, w *= 0.7) {
          const back = k * w * 0.55 * Math.sign(o || 1), cx = x - (bz - az) / l * back, cz = z + (bx - ax) / l * back, ry = 0.2 + RW() * 0.14;
          const y = top === null ? g - ry * 0.45 : top + ry * 0.62;
          list.push({ x: cx, y, z: cz, rx: w, ry, rz: w * (0.45 + 0.3 * RW()), yaw, shade: RW(), block: Math.floor(RW() * 6) });
          top = y + ry * 0.66;
        }
      }
    },
  }),
});
