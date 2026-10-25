// The open world's south-east (world/maps/world.js): the Deccan, 4 km square south of the Konkan Ghat and Kerala, on
// the real ground the coast's bake carries on there: the broad valley of the Kundalika along its north, hills to the
// south and west. The river out of Kerala comes down off the ghat into it and runs east along the valley and out of
// the world.
//
// Farmland over the valley floor, cut into fields of mustard, sugarcane, wheat and sunflower and fields ploughed red,
// tree lines along their boundaries; Shivapur, a market town on the river with its grid of streets; the Deccan
// Expressway along the valley; a ghat road down the escarpment from Kerala; Shivsagar lake out on the valley floor
// east of the town, a road round it; the Tamhini road south up into the hills to the viewpoint over the world's end.
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { graded } from './seams.js';
import { clamp, lerp, smoothstep, hyp, gauss, fbm, vnoise, lineNear, lineD, plant, tropic, TROPIC, TROPICAL, stretch, trailsOf, fields } from './country.js';

/** The Deccan's centre in the world (a 4 km square south of the ghat and Kerala). */
/** Its rallies' par times (seconds): a careful driver in three stock trucks, gold about the best of them. */
const PAR = { deccanghat: { gold: 107, silver: 128, bronze: 158 }, tamhini: { gold: 468, silver: 561, bronze: 692 } };
export const DECCAN_AT = [6048, 2372];
const HALF = 2048, SEED = 9110;
const realAt = (x, z) => COAST.baseHeight(x + DECCAN_AT[0], z + DECCAN_AT[1]);

// the river: from where the Konkan Ghat's river crosses into the Deccan, east along the valley and out of the world
const RIVER_PTS = [[-358, -2048], [-330, -1830], [-200, -1640], [60, -1520], [400, -1440], [800, -1390], [1200, -1330], [1600, -1300], [2100, -1290]];
// Shivapur: its streets (east and west along the river, north and south across it), the town square their crossing
const TOWN = { x0: 180, x1: 780, z0: -1230, z1: -930 };
const STREETS_EW = [-1180, -1080, -980], STREETS_NS = [230, 380, 530, 680];
// Shivsagar lake, out on the valley floor east of the town (its basin scooped from the floor: world/WorldGen.js)
const LAKE = { x: 1500, z: -700, r: 210, stretch: 1.6, rot: 0.15 };
const inLake = (x, z, k = 1) => { const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot), dx = x - LAKE.x, dz = z - LAKE.z; return Math.hypot((dx * c + dz * s) / LAKE.stretch, -dx * s + dz * c) < LAKE.r * k; };

/** The valley floor's level (the real ground smoothed), and the land made from the real ground and the escarpment. */
export const deccanGround = (x, z) => {
  let h = realAt(x, z);
  // the escarpment under Kerala: its ridges carried down to the valley floor, a gap in it below Kerala's own (where
  // the ghat road comes down)
  const esc = smoothstep(-1250, -2048, z) * smoothstep(150, 450, x);
  if (esc > 0) {
    const top = 205 + 25 * fbm(x / 260, z / 260, 3, SEED + 1) - 150 * gauss(x - 1229, 230);
    h = lerp(h, Math.max(h, lerp(top, 6, smoothstep(-2000, -1300, z))), esc);
  }
  // the gap's floor: a steady fall from Kerala's edge (its road out at 58 m) to the valley floor
  const gw = gauss(x - 1229, 110) * smoothstep(-1380, -1560, z);
  if (gw > 0.01) h = lerp(h, lerp(58, 8, clamp((z + 2048) / 650, 0, 1)) + 1.5 * fbm(x / 90, z / 90, 2, SEED + 3), gw);
  // the valley floor: level ground for the fields, the river's own bed cut in it by the generator
  const vf = smoothstep(60, 25, h);
  if (vf > 0) h = lerp(h, 9 + 0.35 * (h - 9) + 1.2 * fbm(x / 120, z / 120, 2, SEED + 2), vf);
  // the town on a terrace above the river
  const td = Math.max(TOWN.x0 - x, x - TOWN.x1, TOWN.z0 - z, z - TOWN.z1);
  if (td < 60) h = lerp(h, 14, smoothstep(60, 0, td));
  return h;
};

// the fields: two grids of them (the valley's, turned with it; the uplands', squarer), and their crops
const VALLEY_FIELDS = fields({ rot: 0.08, w: 64, d: 120, seed: SEED + 10, crops: [['mustard', 3], ['cane', 3], ['wheat', 3], ['plough', 2], ['sunflower', 1.5], ['fallow', 1]] });
const UPLAND_FIELDS = fields({ rot: -0.35, w: 80, d: 90, seed: SEED + 11, crops: [['millet', 3], ['fallow', 3], ['plough', 1], ['mustard', 1]] });
const inTown = (x, z) => x > TOWN.x0 - 20 && x < TOWN.x1 + 20 && z > TOWN.z0 - 20 && z < TOWN.z1 + 20;
/** The field at a point, or null where nothing is sown (the town, the river, the hills' steeps, the lake). */
function fieldAt(x, z, h) {
  if (inTown(x, z) || h > 175) return null;
  if (lineD(RIVER_PTS, x, z) < 45) return null;
  if (inLake(x, z, 1.35)) return null;
  const f = h < 32 ? VALLEY_FIELDS(x, z) : UPLAND_FIELDS(x, z);
  return f.edge < 3 ? null : f;
}
// each crop's colour over the grass (or the soil, ploughed) and the ground it is
const CROPS = {
  mustard: { tint: [3.6, 2.7, 0.5], s: SURFACE.GRASS }, sunflower: { tint: [3.7, 2.2, 0.35], s: SURFACE.GRASS },
  cane: { tint: [0.75, 1.25, 0.8], s: SURFACE.GRASS }, wheat: { tint: [1.7, 1.55, 0.75], s: SURFACE.GRASS },
  millet: { tint: [1.45, 1.25, 0.7], s: SURFACE.GRASS }, fallow: { tint: [1.3, 1.05, 0.8], s: SURFACE.GRASS },
  plough: { tint: [1.15, 1.0, 0.95], s: SURFACE.DIRT },
};
const deccanTint = (x, z, layer, h, c) => {
  const f = fieldAt(x, z, h);
  if (!f) return;
  const k = CROPS[f.crop], t = k.tint, rows = 0.9 + 0.1 * Math.sin(f.u * 1.6);
  if ((layer === 'grass' && k.s === SURFACE.GRASS) || (layer === 'dirt' && k.s === SURFACE.DIRT)) for (let i = 0; i < 3; i++) c[i] = t[i] * rows * (0.92 + 0.16 * vnoise(x / 20, z / 20, SEED + 12));
};

// the town's streets, straight: each a short road of its own
const STREETS = [
  ...STREETS_EW.map((z, i) => [`Shivapur ${['North', 'Market', 'South'][i]} Street`, [[TOWN.x0, z], [TOWN.x1, z]]]),
  ...STREETS_NS.map((x, i) => [`Shivapur Lane ${i + 1}`, [[x, TOWN.z0], [x, TOWN.z1]]]),
];
/** The town's houses: along each street, both sides, facing it (not at the crossings). */
export const TOWN_HOUSES = (() => {
  const out = [], P = Math.PI;
  for (const z of STREETS_EW) for (let x = TOWN.x0 + 14; x < TOWN.x1 - 10; x += 30) {
    if (STREETS_NS.some((sx) => Math.abs(sx - x) < 16)) continue;
    for (const side of [-1, 1]) out.push({ type: (x * 7 + z) % 9 === 0 ? 'chaistall' : 'house', x: Math.round(x), z: Math.round(z + side * 15), yaw: side > 0 ? P : 0, style: 'kerala' });
  }
  for (const x of STREETS_NS) for (let z = TOWN.z0 + 14; z < TOWN.z1 - 10; z += 30) {
    if (STREETS_EW.some((sz) => Math.abs(sz - z) < 18)) continue;
    for (const side of [-1, 1]) out.push({ type: 'house', x: Math.round(x + side * 15), z: Math.round(z), yaw: side > 0 ? -P / 2 : P / 2, style: 'kerala' });
  }
  return out;
})();
// farmhouses out among the fields
const FARMS = [[-120, -1100], [1050, -1650], [1500, -1120], [-250, -620], [900, -820], [1750, -820], [-700, -300], [330, -500]];

export const DECCAN_ROUTES = {
  'Deccan Expressway': { via: [[-160, -1660], [200, -1460], [600, -1300], [1000, -1250], [1400, -1180], [1950, -1120]], kind: 'road', width: 7.4, lanes: 4, grade: 0.05, smooth: 60, cut: 8, shoulder: 10, level: true, verge: { puddles: 2 } },
  'Shivapur Ghat Road': { via: [[-2048, -1092], [-1600, -1020], [-1100, -900], [-600, -1000], [-150, -1080], [180, -1080]], kind: 'road', width: 3.6, lanes: 2, grade: 0.08, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 0] },
  'Kerala Ghat Road': { via: [[1229, -2048], [1229, -1800], [1205, -1560], [1000, -1460], [800, -1420], [700, -1360]], kind: 'road', width: 3.6, lanes: 2, grade: 0.09, smooth: 26, cut: 7, shoulder: 8, level: true, extend: [8, 0] },
  'Kundalika Track': { via: [[-264, -2048], [-240, -1850], [-160, -1660]], kind: 'trail', width: 2.4, extend: [8, 0] },
  'Shivsagar Lake Road': { via: [[1000, -1250], [1080, -980], [1150, -560], [1450, -400], [1800, -460], [1960, -700], [1880, -960], [1600, -1060], [1400, -1180]], kind: 'road', width: 3.4, lanes: 2, grade: 0.06, smooth: 30, cut: 4, shoulder: 6 },
  'Tamhini Road': { via: [[530, -930], [620, -620], [760, -250], [850, 200], [950, 700], [1050, 1200], [980, 1600], [900, 1880]], kind: 'road', width: 3.4, lanes: 2, grade: 0.09, smooth: 26, cut: 6, shoulder: 6,
    // (over the plateau's broken ground, routed a little steeper than it is laid: its bed cut down to its grade, rather
    // than wandering kilometres round every rise)
    routeGrade: 0.14 },
  'Farm Track East': { via: [[1000, -1250], [1050, -1550], [1500, -1600], [1800, -1550]], kind: 'trail', width: 2.4 },
  'Farm Track West': { via: [[-150, -1080], [-200, -850], [-150, -600], [200, -480], [620, -620]], kind: 'trail', width: 2.4 },
  ...Object.fromEntries(STREETS.map(([name, pts]) => [name, { points: pts, kind: 'road', width: 3.4, grade: 0.06, shoulder: 3 }])),
};

/** The Deccan's river: the Konkan Ghat's carried on, falling gently east along the valley. */
function deccanRiver(level0) {
  return {
    points: RIVER_PTS, widthStart: 24, widthEnd: 30, depthStart: 2.2, depthEnd: 2.4, fords: [[1000, -1300]],
    levelAt: (s) => level0 - 21 * s, valleyAt: () => [200, 60],
  };
}

export const DECCAN = stretch({
  id: 'deccan', name: 'The Deccan', short: 'Deccan', seed: SEED, half: HALF, res: 2, coarse: 8, waterRes: 4, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, looseRocks: 5,
  station: { x: 480, z: -1040, name: 'Shivapur Motors' }, spawn: { x: 470, z: -1020, yaw: Math.PI / 2 }, dealer: 'Shivapur Motors',
  load: () => COAST.load(), baseHeight: deccanGround, roughOf: (h) => clamp((h - 40) / 220, 0.1, 0.8),
  ...TROPICAL, farWoods: 0.55, tint: deccanTint, tintRange: 4, lake: LAKE,
  trails: trailsOf('deccan', DECCAN_ROUTES),
  landmarks: [
    { type: 'garage', x: 470, z: -1062, yaw: 0, style: 'kerala' }, { type: 'busstop', x: 400, z: -1095, yaw: 0 },
    ...TOWN_HOUSES, ...FARMS.map(([x, z], i) => ({ type: 'house', x, z, yaw: (i * 1.3) % Math.PI, style: 'kerala' })),
    { type: 'flag', x: 1505, z: -395, yaw: 0 }, { type: 'lookout', x: 900, z: 1900, yaw: Math.PI },
  ],
  beacons: [
    { id: 0, name: 'Shivapur Square', x: 455, z: -1030 }, { id: 1, name: 'Shivsagar Lake', x: 1500, z: -420 },
    { id: 2, name: 'Mustard Fields', x: 1300, z: -1560 }, { id: 3, name: 'Tamhini Viewpoint', x: 910, z: 1860 },
    { id: 4, name: 'Kundalika Bend', x: -260, z: -1700 },
  ],
  races: [
    { id: 'deccanghat', kind: 'rally', name: 'Deccan Ghat Descent', desc: 'Off Kerala\'s ridge through the gap in the escarpment and down the bends to the expressway on the valley floor.',
      trail: 'Kerala Ghat Road', from: [1229, -2000], to: [700, -1360], cps: 5, r: 12, par: PAR.deccanghat, prize: 1.2 },
    { id: 'tamhini', kind: 'rally', name: 'Tamhini Road', desc: 'From Shivapur south over the farmland plateau and its fields, the long way to the world\'s southern edge.',
      trail: 'Tamhini Road', from: [530, -930], to: [900, 1880], cps: 8, r: 12, par: PAR.tamhini, prize: 1.5 },
  ],
  gen: graded([
    { road: 'Deccan Expressway', grade: 0.05, smooth: 80, ends: ['ground', 'ground'] },
    { road: 'Shivapur Ghat Road', grade: 0.08, ends: ['ground', { road: 'Deccan Expressway' }] },
    { road: 'Kerala Ghat Road', grade: 0.09, ends: ['ground', { road: 'Deccan Expressway' }] },
    { road: 'Kundalika Track', grade: 0.2, ends: ['ground', { road: 'Deccan Expressway' }] },
    { road: 'Shivsagar Lake Road', grade: 0.06, ends: [{ road: 'Deccan Expressway' }, { road: 'Deccan Expressway' }] },
    { road: 'Tamhini Road', grade: 0.09, ends: [null, null] },
  ], {
    detail: (x, z) => (fieldAt(x, z, 20) ? 0.25 : 0.8),
    surface(x, z, h, sl, s) {
      if (s === SURFACE.ROCK || s === SURFACE.SAND || s === SURFACE.MUD) return s;
      if (inTown(x, z)) return vnoise(x / 6, z / 6, SEED + 13) > 0.6 ? SURFACE.DIRT : SURFACE.GRASS;
      const f = sl < 0.25 ? fieldAt(x, z, h) : null;
      if (f) return CROPS[f.crop].s;
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      plant(ctx, 6, (x, z, s, h, R, roll) => {
        const f = fieldAt(x, z, h);
        // tree lines along the fields' boundaries; nothing in the fields themselves
        if (f) return null;
        const edge = h < 175 && !inTown(x, z) && (h < 32 ? VALLEY_FIELDS(x, z) : UPLAND_FIELDS(x, z)).edge < 4;
        if (edge) return roll < 0.32 ? tropic(roll < 0.05 ? TROPIC.coconut : roll < 0.08 ? TROPIC.banana : TROPIC.mango, R) : null;
        if (inTown(x, z)) return roll < 0.03 ? tropic(roll < 0.015 ? TROPIC.coconut : TROPIC.mango, R) : null;
        if (lineD(RIVER_PTS, x, z) < 70) return roll < 0.2 ? tropic(roll < 0.08 ? TROPIC.coconut : TROPIC.bamboo, R) : null;
        // the hills wooded, thicker up the slopes
        const wood = smoothstep(60, 160, h) * (0.4 + 0.6 * smoothstep(-0.2, 0.4, fbm(x / 200, z / 200, 2, SEED + 14)));
        return roll < 0.03 + 0.4 * wood ? tropic(roll < 0.2 ? TROPIC.giant : roll < 0.27 ? TROPIC.bamboo : TROPIC.mango, R) : null;
      });
    },
  }),
  /** (the river's level where it comes in, given once the Konkan Ghat is built: world/maps/world.js) */
  riverWith: deccanRiver,
});
