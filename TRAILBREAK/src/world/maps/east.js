// The open world's east (world/maps/world.js): the two stretches between the Konkan Coast and the range the Ashwood
// Pass crosses, filling the world up to Ashwood. Their west on the real ground the coast's bake carries on (the
// ridges behind the Phansad plateau); their east made to rise into the range.
//
//   Koyna Glen: a long lake in a deep valley under Ashwood's ridges, held behind an earth dam at its foot; the Koyna
//     road down off Chalkewadi through a gap in the glen's west ridge and along the lake to the dam, a trail up from
//     the dam to Ashwood.
//   Bhimashankar: jungle-clad ranges either side of a valley that falls north to Koyna; the Bhimashankar road up it
//     from the Konkan Ghat, a quarry in the hills to the east, and the Cairn trail down off the pass.
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { graded } from './seams.js';
import { ridged } from '../Noise.js';
import { clamp, lerp, smoothstep, gauss, fbm, vnoise, lineNear, lineD, plant, tropic, alpine, TROPIC, ALPINE, TROPICAL, HIGHLAND, stretch, trailsOf } from './country.js';

/** Its rallies' par times (seconds): a careful driver in three stock trucks, gold about the best of them. */
const PAR = { koyna: { gold: 118, silver: 142, bronze: 175 }, bhimashankar: { gold: 105, silver: 125, bronze: 155 } };

/** The east's centres in the world (two 2 km squares between the coast and the pass's range). */
export const EAST_AT = { glen: [5024, -4796], forest: [5024, -2748] };
const real = (id) => { const [cx, cz] = EAST_AT[id]; return (x, z) => COAST.baseHeight(x + cx, z + cz); };

// ---------------------------------------------------------------- Koyna Glen
const GLEN_SEED = 8110;
const glenReal = real('glen');
/** Koyna lake: long north and south down the glen, held at 61 m behind the dam. */
const KOYNA = { x: 170, z: -170, r: 185, stretch: 3.4, rot: Math.PI / 2, hold: 61 };
const DAM_Z = 560, DAM_TOP = 66;
export const glenGround = (x, z) => {
  let r = glenReal(x, z);
  // Koyna Gap: a saddle in the west ridge where the road comes down off Chalkewadi
  r = lerp(r, Math.min(r, 72 + 0.012 * (x + 1024)), gauss(z + 634, 150) * smoothstep(-60, -260, x));
  // the glen: its floor under the lake, its east side rising into Ashwood's ridges, its head to the north
  // (the floor a couple of metres above the lake, where the road runs along its shore)
  let d = 63 + 3 * fbm(x / 70, z / 70, 2, GLEN_SEED + 1);
  const east = 170 * smoothstep(330, 880, x) * (0.85 + 0.3 * fbm(x / 300, z / 300, 3, GLEN_SEED + 2)) + 20 * ridged(x / 160, z / 160, 3, GLEN_SEED + 3) * smoothstep(400, 700, x);
  d += east + 95 * smoothstep(-680, -1000, z);
  // below the dam the valley falls away to the south
  d -= 18 * smoothstep(DAM_Z + 30, DAM_Z + 260, z) * (1 - smoothstep(330, 700, x));
  let h = lerp(r, d, smoothstep(-400, -70, x));
  // the dam: an earth bank across the valley's foot, its crest a road
  const dz = Math.abs(z - DAM_Z);
  if (dz < 60 && x > -40 && x < 520) h = Math.max(h, DAM_TOP - Math.max(0, dz - 7) * 0.45 - Math.max(0, -x) * 0.2);
  return h;
};

export const GLEN_ROUTES = {
  'Koyna Road': { via: [[-1024, -634], [-700, -620], [-330, -560], [-150, -300], [-60, 200], [-90, 540], [-70, 760], [150, 900], [150, 1024]], kind: 'road', width: 3.7, lanes: 2, grade: 0.08, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 8] },
  'Koyna Dam Road': { via: [[-90, 540], [-20, 558], [200, 560], [470, 556]], kind: 'road', width: 3.2, grade: 0.08, cut: 3, shoulder: 4 },
  'Pinecrest Trail': { via: [[470, 552], [640, 330], [820, 100], [1024, -64]], kind: 'trail', width: 2.2, grade: 0.26, extend: [0, 8] },
  // (on up over the ridge at the glen's head to its north edge: the Timber Road into Bearwood Taiga, world/maps/taiga.js)
  'Glen Head Track': { via: [[-150, -300], [20, -700], [170, -900], [170, -1024]], kind: 'trail', width: 2.4, extend: [0, 8] },
};

export const GLEN = stretch({
  id: 'glen', name: 'Koyna Glen', short: 'Koyna', seed: GLEN_SEED, half: 1024, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  station: { x: -150, z: 470, name: 'Koyna Dam' }, spawn: { x: -130, z: 450, yaw: Math.PI }, dealer: 'Ashwood 4x4 Sales',
  load: () => COAST.load(), baseHeight: glenGround, roughOf: (h) => clamp((h - 60) / 200, 0.2, 0.9),
  ...HIGHLAND, farWoods: 0.7, lake: KOYNA,
  trails: trailsOf('glen', GLEN_ROUTES),
  landmarks: [{ type: 'cabin', x: -170, z: 440, yaw: 0.2 }, { type: 'flag', x: 200, z: 548, yaw: 0 }],
  beacons: [{ id: 0, name: 'Koyna Dam', x: 330, z: 566 }, { id: 1, name: 'Glen Head', x: 170, z: -880 }, { id: 2, name: 'Koyna Gap', x: -560, z: -600 }],
  races: [
    { id: 'koyna', kind: 'rally', name: 'Koyna Lakeside', desc: 'Down through the Koyna gap and along the lake under the pines to the dam.',
      trail: 'Koyna Road', from: [-700, -620], to: [-90, 540], cps: 6, r: 12, par: PAR.koyna, prize: 1.2 },
  ],
  gen: graded([{ road: 'Koyna Road', grade: 0.08, smooth: 40, ends: ['ground', 'ground'] }, { road: 'Koyna Dam Road', grade: 0.06, ends: [{ road: 'Koyna Road' }, null] },
    { road: 'Pinecrest Trail', grade: 0.24, ends: [{ road: 'Koyna Dam Road' }, 'ground'] },
    // (over the ridge at the glen's head to the taiga: cut down to a grade a laden truck takes)
    { road: 'Glen Head Track', grade: 0.2, smooth: 24, ends: [{ road: 'Koyna Road' }, 'ground'] }], {
    surface(x, z, h, sl, s) {
      if (s === SURFACE.DIRT) return SURFACE.GRASS;
      return s;
    },
    trees(ctx) {
      // pine and fir up the glen's sides (the valley's cold air) in stands with open ground between, birch by the water,
      // a few dead ones
      plant(ctx, 5, (x, z, s, h, R, roll) => {
        if (Math.abs(z - DAM_Z) < 70 && x > -200 && x < 560) return null;
        const wood = 0.1 + 0.65 * smoothstep(0, 0.4, fbm(x / 160, z / 160, 2, GLEN_SEED + 4));
        if (roll > wood * (h < 72 ? 0.35 : 1) * 0.5) return null;
        const pick = R();
        return alpine(h < 75 && pick < 0.4 ? ALPINE.birch : pick < 0.03 ? ALPINE.snag : pick < 0.6 ? ALPINE.pine : pick < 0.85 ? ALPINE.fir : ALPINE.spruce, R);
      });
    },
  }),
});

// ---------------------------------------------------------------- Bhimashankar
const FOREST_SEED = 8220;
const forestReal = real('forest');
// the valley down the middle, from the Konkan Ghat's side to Koyna, and its floor along it
const VALLEY = [[-560, 1024], [-330, 560], [-120, 120], [60, -420], [150, -1024]];
const valleyFloor = (s) => lerp(128, 46, clamp(s / 2200, 0, 1));
// the quarry: a pit cut in benches into the hills east of the valley, a ramp down its west side
export const QUARRY = { x: 470, z: 210, r: 120, depth: 34 };
export const QUARRY_RAMP = [[QUARRY.x - QUARRY.r - 140, QUARRY.z + 75], [QUARRY.x - 20, QUARRY.z + 10]];
/** Bhimashankar's ground without its quarry. */
const forestLand = (x, z) => {
  const r = forestReal(x, z);
  // the hills, and east of them the range the Ashwood Pass crosses
  const hills = 205 + 55 * fbm(x / 420, z / 420, 3, FOREST_SEED + 1) + 18 * fbm(x / 120, z / 120, 2, FOREST_SEED + 2);
  const range = 300 + 70 * ridged(x / 280, z / 280, 4, FOREST_SEED + 3);
  let d = lerp(hills, range, smoothstep(380, 900, x));
  const n = lineNear(VALLEY, x, z), fl = valleyFloor(n.s) + 4 * fbm(x / 80, z / 80, 2, FOREST_SEED + 4);
  d = lerp(d, Math.min(d, fl + Math.max(0, n.d - 60) * 0.28), smoothstep(420, 120, n.d));
  return lerp(r, d, smoothstep(-760, -380, x));
};
// (the quarry's floor, and its ramp's head, at fixed levels: the ground at the pit's middle and the ramp's top)
let QL = null;
const quarryLevels = () => QL || (QL = { floor: forestLand(QUARRY.x, QUARRY.z) - QUARRY.depth, top: forestLand(...QUARRY_RAMP[0]) });
const RAMP_LEN = Math.hypot(QUARRY_RAMP[1][0] - QUARRY_RAMP[0][0], QUARRY_RAMP[1][1] - QUARRY_RAMP[0][1]);
export const forestGround = (x, z) => {
  let h = forestLand(x, z);
  const qd = Math.hypot(x - QUARRY.x, z - QUARRY.z);
  if (qd > QUARRY.r + 200) return h;
  const { floor, top } = quarryLevels();
  // the quarry: a pit in benches, 7 m each, down to its floor
  if (qd < QUARRY.r + 40) {
    const rim = h, t = clamp((QUARRY.r - qd) / QUARRY.r, 0, 1);
    const bench = Math.floor(t * 5) / 5, pit = lerp(rim, floor, Math.min(1, bench * 1.25 + smoothstep(0.1, 0.2, t - bench) * 0.25));
    h = lerp(h, Math.min(h, pit), smoothstep(QUARRY.r + 40, QUARRY.r, qd));
  }
  // its ramp: one even grade from the hillside down into it, cut into the ground or built up on it
  const ramp = lineNear(QUARRY_RAMP, x, z);
  if (ramp.d < 18) h = lerp(h, lerp(top, floor + 2, clamp(ramp.s / RAMP_LEN, 0, 1)), smoothstep(18, 9, ramp.d));
  return h;
};
const inQuarry = (x, z) => Math.hypot(x - QUARRY.x, z - QUARRY.z) < QUARRY.r + 4;

export const FOREST_ROUTES = {
  'Bhimashankar Road': { via: [[-256, 1024], [-330, 560], [-120, 120], [40, -380], [120, -760], [150, -1024]], kind: 'road', width: 3.6, lanes: 2, grade: 0.08, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 8] },
  'Bhor Quarry Road': { via: [[-120, 120], [90, 240], [210, 285], [450, 220]], kind: 'road', width: 3.2, grade: 0.14, cut: 5, shoulder: 5, surface: SURFACE.GRAVEL },
};

export const FOREST = stretch({
  id: 'forest', name: 'Bhimashankar', short: 'Bhimashankar', seed: FOREST_SEED, half: 1024,
  station: { x: -230, z: 330, name: 'Bhimashankar Rest House' }, spawn: { x: -210, z: 310, yaw: 0 }, dealer: 'Konkan Motors',
  load: () => COAST.load(), baseHeight: forestGround, roughOf: (h) => clamp((h - 60) / 220, 0.25, 0.9),
  ...TROPICAL, farWoods: 0.75, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  trails: trailsOf('forest', FOREST_ROUTES),
  landmarks: [{ type: 'bungalow', x: -255, z: 360, yaw: 1.2 }, { type: 'mine', x: 330, z: 255, yaw: -1.2 }, { type: 'chaistall', x: -200, z: 300, yaw: -0.5 }],
  beacons: [{ id: 0, name: 'Bhor Quarry', x: 470, z: 215 }, { id: 1, name: 'Bhimashankar Temple', x: -110, z: 80 }, { id: 2, name: 'Cairn Saddle', x: 780, z: -200 }],
  races: [
    { id: 'bhimashankar', kind: 'rally', name: 'Bhimashankar Jungle Road', desc: 'Through the evergreen jungle down the valley from the rest house to the head of Koyna Glen.',
      trail: 'Bhimashankar Road', from: [-330, 560], to: [120, -760], cps: 6, r: 12, par: PAR.bhimashankar, prize: 1.2 },
  ],
  gen: graded([{ road: 'Bhimashankar Road', grade: 0.08, smooth: 40, ends: ['ground', 'ground'] }, { road: 'Bhor Quarry Road', grade: 0.14, ends: [{ road: 'Bhimashankar Road' }, null] }], {
    surface(x, z, h, sl, s) {
      if (inQuarry(x, z)) return sl > 0.7 ? SURFACE.ROCK : vnoise(x / 8, z / 8, FOREST_SEED + 5) > 0.5 ? SURFACE.GRAVEL : SURFACE.DIRT;
      // (the jungle's steep ground grown over, as Kerala's is: bare rock only on its sheerest faces)
      if (s === SURFACE.ROCK && sl < 1.25 + 0.4 * vnoise(x / 13, z / 13, FOREST_SEED + 6)) return SURFACE.GRASS;
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      // the evergreen jungle in great stands, giants and bamboo, with open glades of grass between; mango and jack lower
      // down by the valley
      plant(ctx, 5, (x, z, s, h, R, roll) => {
        if (Math.hypot(x - QUARRY.x, z - QUARRY.z) < QUARRY.r + 30) return null;
        const wood = 0.05 + 0.7 * smoothstep(-0.05, 0.35, fbm(x / 180, z / 180, 2, FOREST_SEED + 7));
        if (roll > wood * 0.55) return null;
        const pick = R(), low = lineD(VALLEY, x, z) < 140;
        return tropic(pick < 0.5 ? TROPIC.giant : pick < 0.68 ? TROPIC.bamboo : low && pick < 0.85 ? TROPIC.mango : pick < 0.93 ? TROPIC.mango : TROPIC.banana, R);
      });
    },
  }),
});
