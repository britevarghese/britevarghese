// The open world's far north (world/maps/world.js): Bearwood Taiga, a 2 km square north of Koyna Glen, over the ridge
// at the glen's head. Logging country under a grey sky, in the manner of the mud-and-timber truck games: stands of dark
// spruce and pine with open ground between them, the Bearwood river winding west across a boggy basin, Blackwater Bog
// north of it, and the logging tracks between them churned into deep mud, through open fields of it.
//
//   the timber camp: on a terrace above the river, its garage, the sawmill and the log yard; the Timber Road up to it
//     over the ridge from Koyna Glen
//   the ford track: from the camp across the river at the ford and north to the cutting in the far woods
//   Blackwater Track: off the ford track west along the edge of the bog, back across the river to the log landing
//   Lookout Hill: a knoll in the north-east with a watchtower on it, a steep track up
//
// All the going a mud-and-timber truck game has, each its own ground under the tyres (physics/Surfaces.js): the Timber
// Road's gravel, the tracks' deep mud on the wet ground, mud holes, the camp's flooded mud pit, Blackwater Bog's black
// pools, two shallow fords and a deep one that drowns a low air intake, the sandy shallows above the ford, a boulder
// field on Lookout Hill's flank, steep climbs, the forest's tracks between the trees.
//
// Its air is its own (atmosphere, air): fog that closes in to a few hundred metres, an overcast sky, the light flat and
// the colours muted, coming on as a truck drives in over the ridge (world/OpenWorld.js airAt).
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { glenGround } from './east.js';
import { graded } from './seams.js';
import { ridged } from '../Noise.js';
import { clamp, lerp, smoothstep, fbm, vnoise, lineD, plant, alpine, ALPINE, HIGHLAND, stretch, trailsOf } from './country.js';

/** Its rallies' par times (seconds): a careful driver in three stock trucks, gold about the best of them, through the
 * deep mud (the UAZ needs low range in it, and up the west ford's north bank). */
const PAR = { timberrun: { gold: 200, silver: 240, bronze: 295 }, blackwater: { gold: 245, silver: 295, bronze: 360 } };

/** The taiga's centre in the world (a 2 km square north of Koyna Glen). */
export const TAIGA_AT = [5024, -6844];
const HALF = 1024, SEED = 9410;

// the river: out of the hills in the east, west across the basin and out of the world's west edge
export const TAIGA_RIVER_PTS = [[1024, -260], [820, -200], [600, -80], [420, 30], [240, 110], [60, 130], [-140, 90], [-340, 120], [-560, 210], [-800, 250], [-1024, 300]];
export const TAIGA_FORDS = [[240, 110], [-745, 247]];
// Blackwater Bog: a wide flat wet hollow on the basin floor north of the river (world/WorldGen.js makes it)
const BOG = { x: -330, z: -330, rx: 230, rz: 130, rot: 0.32 };
const CAMP = { x: 140, z: 420 }, LOOKOUT = { x: 640, z: -640 }, LANDING = { x: -690, z: 560 }, CUTTING = { x: -80, z: -790 };
// the mud pit: an old borrow pit by the camp, dug a metre down and flooded, a hand's depth of water over deep mud
const PIT = { x: 60, z: 345, rx: 30, rz: 18, rot: 0.4 };
const pitE = (x, z) => {
  const dx = x - PIT.x, dz = z - PIT.z, c = Math.cos(PIT.rot), s = Math.sin(PIT.rot);
  return Math.hypot((dx * c + dz * s) / PIT.rx, (-dx * s + dz * c) / PIT.rz);
};
// the boulder field on Lookout Hill's west flank (world/WorldGen.js rockGarden: rock underfoot, boulders to crawl over)
const BOULDERS = { x: 560, z: -380, r: 45 };
// the shallows above the ford: the river wide and ankle deep over gravel, a sand bar on its inside bank
const SHALLOWS = { x: 390, z: 45, r: 60, depth: 0.22, widen: 0.8 }, SANDBAR = { x: 400, z: 88, r: 30 };

/** The basin and the hills round it, rising in the south to meet the glen's north edge. */
export const taigaGround = (x, z) => {
  // the basin: low rolling ground, its floor about 80 m
  const wx = x + 60 * fbm(x / 500, z / 500, 2, SEED + 1), wz = z + 60 * fbm(x / 500 + 3.1, z / 500 - 1.7, 2, SEED + 2);
  let h = 82 + 16 * fbm(wx / 320, wz / 320, 3, SEED + 3) + 5 * fbm(wx / 90, wz / 90, 2, SEED + 4);
  // hills round it: highest in the east (the range Ashwood lies under), lower to the north, gentle in the west
  h += 120 * smoothstep(250, 1000, x) * (0.75 + 0.35 * fbm(x / 260, z / 260, 3, SEED + 5));
  h += 70 * smoothstep(-420, -1000, z) * (0.7 + 0.4 * fbm(x / 240, z / 240, 3, SEED + 6));
  h += 30 * smoothstep(-450, -1000, x) * (0.6 + 0.6 * fbm(x / 200, z / 200, 2, SEED + 7));
  h += 14 * ridged(x / 180, z / 180, 3, SEED + 8) * smoothstep(300, 900, Math.hypot(x, z));
  // Lookout Hill, a rounded knoll in the north-east, the watchtower on top
  h += 48 * Math.exp(-((x - LOOKOUT.x) ** 2 + (z - LOOKOUT.z) ** 2) / (2 * 150 * 150));
  // the camp's terrace above the river, and the landing's
  for (const [c, r, lv] of [[CAMP, 70, 89], [LANDING, 55, 85]]) h = lerp(h, lv, smoothstep(r * 1.8, r, Math.hypot(x - c.x, z - c.z)));
  // the south: up to the ridge at the head of Koyna Glen, its edge the glen's own
  return lerp(h, glenGround(x, -1024), smoothstep(560, 1024, z));
};

export const TAIGA_ROUTES = {
  // (the logging road in: gravel, the timber lorries' way out)
  'Timber Road': { via: [[170, 1024], [150, 820], [120, 640], [140, 470]], kind: 'trail', width: 3.4, extend: [8, 0], surface: SURFACE.GRAVEL },
  'Bearwood Ford Track': { via: [[140, 470], [190, 300], [240, 110], [200, -120], [60, -330], [-60, -560], [CUTTING.x, CUTTING.z]], kind: 'trail', width: 3.0 },
  'Blackwater Track': { via: [[60, -330], [-150, -250], [-330, -200], [-560, -250], [-760, -110], [-745, 247], [LANDING.x, LANDING.z]], kind: 'trail', width: 2.8, grade: 0.26, routeGrade: 0.28 },
  'Landing Road': { via: [[140, 470], [-100, 520], [-400, 560], [LANDING.x, LANDING.z]], kind: 'trail', width: 3.2 },
  'Lookout Track': { via: [[200, -120], [420, -320], [580, -560], [LOOKOUT.x, LOOKOUT.z]], kind: 'trail', width: 2.6, routeGrade: 0.22 },
  // (off the landing road north across the river at the deep ford, the water up to a truck's bonnet: 0.95 m over the
  // ford's bed, the channel either side of it deeper still, on to Blackwater Track)
  // (on west from the log landing along the river's south bank, out across the edge into Lalghati Canyon,
  // world/maps/canyon.js)
  'Lalghati Track': { via: [[LANDING.x, LANDING.z], [-860, 420], [-1024, 336]], kind: 'trail', width: 3.0, extend: [0, 8] },
  'Deep Ford Track': { via: [[-400, 560], [-385, 330], [-340, 120], [-330, -200]], kind: 'trail', width: 2.8, ford: 0.95, grade: 0.3 },
};

// wet ground: the basin floor near the river and the bog, low hollows; the logging tracks through it are deep mud
const wetness = (x, z, h) => {
  const river = smoothstep(90, 20, lineD(TAIGA_RIVER_PTS, x, z));
  const low = smoothstep(92, 82, h);
  return Math.max(river * 0.8, low * 0.7) + 0.45 * (fbm(x / 60, z / 60, 2, SEED + 20) - 0.1);
};
const nearCamp = (x, z) => Math.hypot(x - CAMP.x, z - CAMP.z) < 95;

/**
 * The taiga's colours over its ground (Ashwood's textures: its brown mud, not the coast's red laterite): dark, cool and
 * muted, the mud near black where it's wet, the needle litter under the trees dark brown, the river's sandy banks silt.
 */
const taigaTint = (x, z, layer, h, c) => {
  const v = 0.92 + 0.12 * vnoise(x / 23, z / 23, SEED + 30);
  const k = layer === 'grass' ? [0.66, 0.76, 0.6] : layer === 'mud' ? [0.8, 0.78, 0.76] : layer === 'dirt' ? [0.74, 0.68, 0.62]
    : layer === 'forest' ? [0.6, 0.75, 0.95] : layer === 'sand' ? [0.5, 0.55, 0.66] : [0.82, 0.84, 0.86];
  for (let i = 0; i < 3; i++) c[i] *= k[i] * (layer === 'mud' ? 1 : v);
};

export const TAIGA = stretch({
  id: 'taiga', name: 'Bearwood Taiga', short: 'Taiga', seed: SEED, half: HALF,
  blurb: 'Logging country in the far north: dark spruce forest, the Bearwood river, Blackwater Bog and mud tracks churned deep, under a grey sky.',
  station: { x: 150, z: 410, name: 'Bearwood Timber Camp' }, spawn: { x: 150, z: 445, yaw: Math.PI }, dealer: 'Bearwood Timber Camp',
  load: () => COAST.load(), baseHeight: taigaGround, roughOf: (h) => clamp((h - 80) / 200, 0.25, 0.85),
  ...HIGHLAND, ground: 'ashwood', farWoods: 0.7, tint: taigaTint, tintRange: 2,
  // the deep mud on its tracks: three quarters of their level stretches churned to mud (mudTracks), a mud hole every
  // hundred metres or so of each, and open fields of mud the tracks run through (world/WorldGen.js), nearly two a km
  puddles: 22, mudFields: 3, rockFields: 1.5, mudTracks: 0.75, wornTracks: true, rockRelief: true, looseRocks: 5,
  // its mud deep, as on a logging track in the thaw: a truck sinks to its axles in it (world/World.js softness)
  deepMud: 2.2,
  // its own air: fog closing in to a few hundred metres, the sky overcast, the light flat and the colours muted
  atmosphere: { fog: 0.0021, cover: 0.12 }, air: { fog: 0.0021, cover: 0.12, sun: 0.5, sat: 0.78, fade: 260 },
  mudTint: [0.24, 0.19, 0.14],
  // what the tyres throw up: its own dark peaty mud, grey-brown earth and sand (not the red laterite of the coast it
  // takes the rest of its look from)
  // (its earth damp: little dust off it)
  dustiness: 0.3,
  dust: { [SURFACE.MUD]: [0.13, 0.105, 0.08], [SURFACE.DIRT]: [0.24, 0.18, 0.12], [SURFACE.SAND]: [0.2, 0.17, 0.13], [SURFACE.ROAD]: [0.3, 0.29, 0.27] },
  river: { points: TAIGA_RIVER_PTS, widthStart: 10, widthEnd: 16, depthStart: 1.2, depthEnd: 1.8, fords: TAIGA_FORDS, shallows: [SHALLOWS] },
  bog: BOG, rockGarden: BOULDERS, sandWash: SANDBAR,
  trails: trailsOf('taiga', TAIGA_ROUTES),
  pads: { ...HIGHLAND.pads, logs: 6, sawmill: 13 },
  landmarks: [
    { type: 'station', x: 150, z: 410, yaw: Math.PI, sign: 'BEARWOOD TIMBER CAMP' },
    { type: 'sawmill', x: 70, z: 455, yaw: 0.3 },
    { type: 'logs', x: 30, z: 405, yaw: 0.3 }, { type: 'logs', x: 44, z: 388, yaw: 0.28 }, { type: 'logs', x: 215, z: 462, yaw: -0.2 },
    { type: 'cabin', x: 222, z: 380, yaw: 1.2 }, { type: 'cabin', x: 236, z: 412, yaw: 1.35 },
    { type: 'flag', x: 160, z: 450, yaw: 0 },
    { type: 'firetower', x: LOOKOUT.x, z: LOOKOUT.z, yaw: 0.4 },
    { type: 'logs', x: LANDING.x - 18, z: LANDING.z + 14, yaw: 1.4 }, { type: 'logs', x: LANDING.x + 16, z: LANDING.z + 18, yaw: 1.5 }, { type: 'logs', x: LANDING.x - 4, z: LANDING.z - 22, yaw: 1.3 },
    { type: 'cabin', x: LANDING.x - 30, z: LANDING.z - 10, yaw: 0.2 },
    { type: 'logs', x: CUTTING.x + 22, z: CUTTING.z - 8, yaw: 0.6 }, { type: 'logs', x: CUTTING.x - 24, z: CUTTING.z + 6, yaw: 0.5 },
  ],
  beacons: [
    { id: 0, name: 'Bearwood Ford', x: 262, z: 132 }, { id: 1, name: 'Blackwater Bog', x: -330, z: -210 },
    { id: 2, name: 'Lookout Hill', x: LOOKOUT.x + 14, z: LOOKOUT.z + 16 }, { id: 3, name: 'The Cutting', x: CUTTING.x, z: CUTTING.z + 30 },
    { id: 4, name: 'Log Landing', x: LANDING.x + 30, z: LANDING.z - 30 },
    { id: 5, name: 'The Mud Pit', x: PIT.x - 4, z: PIT.z + 26 }, { id: 6, name: 'Deep Ford', x: -322, z: 150 },
    { id: 7, name: 'Boulder Field', x: BOULDERS.x - 52, z: BOULDERS.z + 8 }, { id: 8, name: 'Bearwood Shallows', x: SANDBAR.x + 10, z: SANDBAR.z + 30 },
  ],
  races: [
    { id: 'timberrun', kind: 'rally', name: 'Timber Run', desc: 'From the timber camp across the Bearwood at the ford and up the mud of the logging track to the cutting in the far woods.',
      trail: 'Bearwood Ford Track', from: [190, 300], to: [CUTTING.x, CUTTING.z], cps: 6, r: 12, par: PAR.timberrun, prize: 1.4 },
    { id: 'blackwater', kind: 'rally', name: 'Blackwater Crossing', desc: 'Round the edge of Blackwater Bog in the mud and back over the river to the log landing.',
      trail: 'Blackwater Track', from: [-150, -250], to: [LANDING.x, LANDING.z], cps: 6, r: 12, par: PAR.blackwater, prize: 1.4 },
  ],
  gen: graded([{ road: 'Timber Road', grade: 0.13, smooth: 30, ends: ['ground', 'ground'] }], {
    prepare({ K, coarseAt }) { K.pitFloor = coarseAt(PIT.x, PIT.z) - 1.1; },
    // the mud pit dug out: a level floor, lumpy with churned mud, its sides sloping up over 6 m
    fine(x, z, h, K) {
      const e = pitE(x, z);
      return e < 1.5 ? lerp(h, K.pitFloor + 0.18 * fbm(x / 4, z / 4, 2, SEED + 40), smoothstep(1.5, 1, e)) : h;
    },
    // standing water: a hand's depth over the pit's floor, and the black pools in the low spots of the bog (its lowest
    // third), kept off the tracks
    water({ K, setWater, hAt, cellOf, trailD, trailW, waterRes }) {
      for (let x = PIT.x - PIT.rx - 4; x <= PIT.x + PIT.rx + 4; x += waterRes) for (let z = PIT.z - PIT.rx - 4; z <= PIT.z + PIT.rx + 4; z += waterRes) {
        if (pitE(x, z) < 1.1) setWater(x, z, K.pitFloor + 0.28);
      }
      const c = Math.cos(BOG.rot), sn = Math.sin(BOG.rot), inBog = (x, z) => {
        const dx = x - BOG.x, dz = z - BOG.z, u = (dx * c + dz * sn) / BOG.rx, v = (-dx * sn + dz * c) / BOG.rz;
        return u * u + v * v < 0.8;
      };
      const pts = [], hs = [];
      for (let x = BOG.x - BOG.rx; x <= BOG.x + BOG.rx; x += waterRes) for (let z = BOG.z - BOG.rx; z <= BOG.z + BOG.rx; z += waterRes) {
        if (!inBog(x, z)) continue;
        const idx = cellOf(x, z);
        if (trailD(idx) < trailW(idx) + 3) continue;
        pts.push(x, z); hs.push(hAt(x, z));
      }
      const level = [...hs].sort((a, b) => a - b)[Math.floor(hs.length / 3)] + 0.05;
      for (let i = 0; i < hs.length; i++) if (hs[i] < level) setWater(pts[2 * i], pts[2 * i + 1], level);
    },
    surface(x, z, h, sl, s) {
      if (pitE(x, z) < 1.25) return SURFACE.MUD;
      if (s === SURFACE.ROCK || s === SURFACE.RIVERBED || s === SURFACE.SAND || s === SURFACE.GRAVEL) return s;
      if (nearCamp(x, z)) return vnoise(x / 5, z / 5, SEED + 21) > 0.55 ? SURFACE.MUD : SURFACE.DIRT;
      // the wet ground is mud (the tracks through it stay mud: world/WorldGen.js); the rest moss and grass
      return sl < 0.35 && wetness(x, z, h) > 0.56 ? SURFACE.MUD : s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      // stands of spruce and pine, fir and birch, with wide open ground between them: clearings, meadows and old
      // cuttings, a lone tree here and there; the logging tracks' verges cleared some 20 m back, the wet ground all but
      // bare, dead snags in the cutting (about 30,000)
      // (how far to the nearest track: their lines' points every 3 m, by 8 m cell)
      const C = 8, cells = new Map();
      for (const t of ctx.M.trails) {
        const p = t.points;
        for (let i = 1; i < p.length; i++) {
          const n = Math.ceil(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / 3);
          for (let j = 0; j < n; j++) {
            const x = lerp(p[i - 1][0], p[i][0], j / n), z = lerp(p[i - 1][1], p[i][1], j / n), k = Math.floor(z / C) * 4096 + Math.floor(x / C);
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(x, z);
          }
        }
      }
      const trackD = (x, z) => {
        let d = Infinity;
        const cx = Math.floor(x / C), cz = Math.floor(z / C);
        for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
          const L = cells.get((cz + a) * 4096 + cx + b);
          if (L) for (let q = 0; q < L.length; q += 2) d = Math.min(d, Math.hypot(L[q] - x, L[q + 1] - z));
        }
        return d;
      };
      plant(ctx, 5, (x, z, s, h, R, roll) => {
        if (nearCamp(x, z) || Math.hypot(x - LANDING.x, z - LANDING.z) < 60 || pitE(x, z) < 1.8) return null;
        if (trackD(x, z) < 19 + 8 * vnoise(x / 30, z / 30, SEED + 24)) return null;
        const cut = Math.hypot(x - CUTTING.x, z - CUTTING.z) < 130, rocky = Math.hypot(x - BOULDERS.x, z - BOULDERS.z) < BOULDERS.r;
        const wet = wetness(x, z, h), stand = smoothstep(0, 0.22, fbm(x / 320, z / 320, 2, SEED + 23));
        const wood = cut ? 0.03 : rocky ? 0.08 : wet > 0.45 ? 0.05 : 0.02 + 0.44 * stand;
        if (roll > wood) return null;
        const pick = R();
        if (cut) return alpine(pick < 0.6 ? ALPINE.snag : ALPINE.birch, R);
        if (wet > 0.45 && pick < 0.55) return alpine(pick < 0.08 ? ALPINE.snag : ALPINE.birch, R);
        return alpine(pick < 0.42 ? ALPINE.spruce : pick < 0.72 ? ALPINE.pine : pick < 0.9 ? ALPINE.fir : pick < 0.97 ? ALPINE.birch : ALPINE.snag, R);
      });
    },
    // the timber's colliders: a log pile, the sawmill's posts and its saw bench
    walls: {
      logs: (L, wall) => wall(L, -4.2, 0, 4.2, 0, 1.0),
      sawmill: (L, wall) => { for (const [x, z] of [[-6, -4], [6, -4], [-6, 4], [6, 4]]) wall(L, x, z, x, z, 0.3); wall(L, -4.5, 0, 4.5, 0, 0.6); },
    },
  }),
});
