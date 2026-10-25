// The open world's north (world/maps/world.js): four stretches along the north edge of the Konkan Coast, on the real
// ground there (the coast's bake carries its heights 12 km out, every 40 m: maps/coast.js groundHeight), from the
// Arabian Sea inland to the hills under Koyna Glen. West to east:
//
//   Korlai: the coast carried north, a flat coastal plain behind the shore; Korlai's headland out into the sea, its
//     fort along the ridge and the lighthouse at its tip; the bazaar village behind Revdanda beach.
//   Borli Valley: a broad valley under a wooded ridge, Supegaon lake in it, flowers on its slopes in the monsoon.
//   Table Land: the ridge of laterite north-east of the coast's plateau, and on it a mesa, sheer-sided and flat-topped.
//   Chalkewadi: the high ridge over the coast's north-east corner, wind turbines along its crest.
//
// Along the north of all four the North Coast Highway runs from Korlai to Koyna Glen on the low ground (cut through
// the Table Land's ridge at Devkund Gap); tracks and lanes run off it.
import { SURFACE } from '../../physics/Surfaces.js';
import { COAST } from './coast.js';
import { graded } from './seams.js';
import { ROADS } from './countryRoads.js';
import { clamp, lerp, smoothstep, hyp, gauss, fbm, vnoise, lineNear, lineD, plant, tropic, TROPIC, TROPICAL, stretch, trailsOf, along, lineLength } from './country.js';

/** Its rallies' par times (seconds): a careful driver in three stock trucks, gold about the best of them. */
const PAR = { fortrun: { gold: 152, silver: 183, bronze: 226 }, mesaclimb: { gold: 431, silver: 517, bronze: 638 }, turbineridge: { gold: 223, silver: 268, bronze: 330 } };

/** The north band's centres in the world (its four squares, 1820 m each, along the coast's north edge). */
export const NORTH_AT = { korlai: [-2370, -4910], borli: [-550, -4910], tableland: [1270, -4910], windfarm: [3090, -4910] };
const HALF = 910;
const real = (id) => { const [cx, cz] = NORTH_AT[id]; return (x, z) => COAST.baseHeight(x + cx, z + cz); };


// ---------------------------------------------------------------- Korlai
const KORLAI_SEED = 7110;
// the headland's spine, from the plain out to its tip, and its height along it (s: m from the plain)
const HEADLAND = [[60, -70], [-150, -76], [-450, -70], [-770, -86]];
const headH = (s) => 8 + 46 * smoothstep(0, 440, s) - 16 * smoothstep(640, 840, s);
const korlaiReal = real('korlai');
export const korlaiGround = (x, z) => {
  let h = korlaiReal(x, z);
  // the headland: a ridge out of the sea, flat along its crest, its sides falling sheer to the water
  const n = lineNear(HEADLAND, x, z), top = headH(n.s) + 4 * fbm(x / 60, z / 60, 2, KORLAI_SEED + 1);
  const k = smoothstep(95, 34, n.d + 10 * vnoise(x / 40, z / 40, KORLAI_SEED + 2));
  if (k > 0) h = Math.max(h, lerp(h, top, k * k * (3 - 2 * k)));
  return h;
};

// the roads: waypoints in the stretch's frame (tools/routeroads.mjs routes them over the ground)
export const KORLAI_ROUTES = {
  'North Coast Highway': { via: [[508, 910], [430, 600], [380, 250], [360, -150], [390, -400], [600, -620], [910, -760]], kind: 'road', width: 3.8, lanes: 2, grade: 0.07, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 8] },
  'Korlai Fort Road': { via: [[365, 30], [60, -70], [-290, -71, 1], [-490, -71], [-735, -86]], kind: 'road', width: 3.0, grade: 0.11, cut: 5, shoulder: 5 },
  'Revdanda Beach Track': { via: [[392, -430], [160, -480], [60, -640], [70, -880]], kind: 'trail', width: 2.3 },
};

export const KORLAI = stretch({
  id: 'korlai', name: 'Korlai', short: 'Korlai', seed: KORLAI_SEED, half: HALF, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  station: { x: 390, z: -330, name: 'Korlai Bazaar' }, spawn: { x: 372, z: -350, yaw: Math.PI }, dealer: 'Konkan Motors',
  load: () => COAST.load(), baseHeight: korlaiGround, roughOf: (h) => clamp((h - 30) / 160, 0.15, 0.7),
  ...TROPICAL, farWoods: 0.45,
  // (the sea is the Konkan Coast's sheet, carried on north: render/Water.js)
  sea: { level: 0, sheet: true, strips: false },
  trails: trailsOf('korlai', KORLAI_ROUTES),
  landmarks: [
    { type: 'lighthouse', x: -775, z: -86, yaw: Math.PI / 2 },
    { type: 'fort', x: -390, z: -71, yaw: 0, len: 150 },
    { type: 'chaistall', x: 362, z: -300, yaw: Math.PI / 2 },
    { type: 'busstop', x: 342, z: -180, yaw: Math.PI / 2 },
  ],
  beacons: [{ id: 0, name: 'Korlai Lighthouse', x: -690, z: -96 }, { id: 1, name: 'Revdanda Beach', x: 70, z: -820 }, { id: 2, name: 'Korlai Creek', x: 120, z: 560 }],
  // (par times: a careful driver in three stock trucks, its gold about the best of them)
  races: [
    { id: 'fortrun', kind: 'rally', name: 'Korlai Fort Run', desc: 'Off the coast highway, out along the headland and through the gates of the old Portuguese fort to the lighthouse at its tip.',
      trail: 'Korlai Fort Road', from: [365, 30], to: [-735, -86], cps: 5, r: 11, par: PAR.fortrun, prize: 1.1 },
  ],
  gen: graded([{ road: 'North Coast Highway', grade: 0.07, smooth: 40, ends: ['ground', 'ground'] }, { road: 'Korlai Fort Road', grade: 0.11, ends: [{ road: 'North Coast Highway' }, null] }], {
    water({ setWater, hAt, waterRes }) {
      for (let z = -HALF; z <= HALF; z += waterRes) for (let x = -HALF; x <= HALF; x += waterRes) if (hAt(x, z) < 0.15) setWater(x, z, 0);
    },
    surface(x, z, h, sl, s) {
      if (s === SURFACE.ROCK) return s;
      if (h < 2.6 && h > -2 && vnoise(x / 40, z / 40, KORLAI_SEED + 3) < 0.8) return SURFACE.SAND;      // the beaches
      if (h < 6 && vnoise(x / 25, z / 25, KORLAI_SEED + 4) > 0.62) return SURFACE.MUD;                  // the creek's flats
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      plant(ctx, 6, (x, z, s, h, R, roll) => {
        if (h < 1.5) return null;
        const head = lineD(HEADLAND, x, z) < 110, grove = vnoise(x / 120, z / 120, KORLAI_SEED + 5);
        if (head) return roll < 0.04 ? tropic(TROPIC.mango, R) : null;                                  // scrub on the headland
        if (h < 12) return roll < 0.05 + 0.25 * smoothstep(0.45, 0.7, grove) ? tropic(roll < 0.2 ? TROPIC.coconut : TROPIC.mango, R) : null;
        return roll < 0.03 + 0.2 * smoothstep(0.5, 0.75, grove) ? tropic(roll < 0.12 ? TROPIC.giant : TROPIC.mango, R) : null;
      });
    },
  }),
});

// ---------------------------------------------------------------- Borli Valley
const BORLI_SEED = 7220;
const borliReal = real('borli');
/** Supegaon lake: in the valley's floor, long north and south. */
const SUPEGAON = { x: 150, z: -150, r: 115, stretch: 2.0, rot: 1.45, hold: 18.5 };
export const borliGround = (x, z) => borliReal(x, z);
// the flowers on the valley's slopes (the colours over its grass): balsam purple, Smithia yellow, pink
const FLOWERS = [[1.9, 0.75, 3.6], [3.3, 2.5, 0.7], [2.6, 1.05, 2.3]];
const borliTint = (x, z, layer, h, c) => {
  if (layer !== 'grass' || h < 24 || h > 150) return;
  const p = vnoise(x / 34, z / 34, BORLI_SEED + 1), f = smoothstep(0.58, 0.74, p) * smoothstep(24, 40, h);
  if (f <= 0) return;
  const k = FLOWERS[Math.floor(vnoise(x / 90, z / 90, BORLI_SEED + 2) * 2.999)], g = f * (0.75 + 0.25 * vnoise(x / 6, z / 6, BORLI_SEED + 3));
  for (let i = 0; i < 3; i++) c[i] = lerp(c[i], k[i], g);
};

export const BORLI_ROUTES = {
  'North Coast Highway': { via: [[-910, -760], [-600, -640], [-300, -540], [0, -570], [400, -560], [910, -510]], kind: 'road', width: 3.8, lanes: 2, grade: 0.07, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 8] },
  'Borli Lane': { via: [[-150, -545], [-110, -260], [-80, 60], [20, 350], [150, 640]], kind: 'road', width: 3.0, grade: 0.1, cut: 4, shoulder: 5 },
  'Supegaon Lake Track': { via: [[-80, 60], [330, 120], [380, -200], [330, -430]], kind: 'trail', width: 2.2 },
};

export const BORLI = stretch({
  id: 'borli', name: 'Borli Valley', short: 'Borli', seed: BORLI_SEED, half: HALF, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  station: { x: -190, z: -130, name: 'Borli' }, spawn: { x: -170, z: -150, yaw: 0 }, dealer: 'Konkan Motors',
  load: () => COAST.load(), baseHeight: borliGround, roughOf: (h) => clamp((h - 30) / 160, 0.15, 0.7),
  ...TROPICAL, farWoods: 0.5, tint: borliTint, tintRange: 4, lake: SUPEGAON,
  trails: trailsOf('borli', BORLI_ROUTES),
  landmarks: [
    { type: 'chaistall', x: -160, z: -95, yaw: -Math.PI / 2 },
    { type: 'busstop', x: -165, z: -520, yaw: 0 },
  ],
  beacons: [{ id: 0, name: 'Supegaon Lake', x: 360, z: 110 }, { id: 1, name: 'Borli Ridge', x: -640, z: 120 }],
  gen: graded([{ road: 'North Coast Highway', grade: 0.07, smooth: 40, ends: ['ground', 'ground'] }, { road: 'Borli Lane', grade: 0.1, ends: [{ road: 'North Coast Highway' }, null] }], {
    surface(x, z, h, sl, s) {
      if (s === SURFACE.ROCK) return s;
      // the valley floor's paddy, dry: stubble and bare earth
      if (h < 26 && vnoise(x / 9, z / 9, BORLI_SEED + 4) > 0.68) return SURFACE.DIRT;
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      plant(ctx, 6, (x, z, s, h, R, roll) => {
        const wood = vnoise(x / 140, z / 140, BORLI_SEED + 5), ridge = smoothstep(60, 120, h);
        if (h < 26) return roll < 0.02 + 0.1 * smoothstep(0.55, 0.75, wood) ? tropic(roll < 0.05 ? TROPIC.coconut : TROPIC.mango, R) : null;
        return roll < 0.03 + 0.28 * ridge * smoothstep(0.3, 0.6, wood) ? tropic(roll < 0.15 ? TROPIC.giant : roll < 0.2 ? TROPIC.bamboo : TROPIC.mango, R) : null;
      });
    },
  }),
});

// ---------------------------------------------------------------- Table Land
const TABLE_SEED = 7330;
const tableReal = real('tableland');
// the mesa: a rounded rectangle on the ridge (its centre, half-sizes, bearing), its top, and the ledge road cut up its
// south face from the east
const MESA = { x: 230, z: 430, hu: 330, hv: 160, rot: 0.18, top: 288 };
const LEDGE = [[640, 640], [420, 625], [220, 610], [60, 585]];
const ledgeLen = lineLength(LEDGE);
const mesaSD = (x, z) => {
  const c = Math.cos(MESA.rot), s = Math.sin(MESA.rot), dx = x - MESA.x, dz = z - MESA.z;
  const u = Math.abs(dx * c + dz * s) - MESA.hu + 60, v = Math.abs(-dx * s + dz * c) - MESA.hv + 60;
  return Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0) - 60;
};
// Devkund Gap: the two ridges west of the mesa cut down where the highway goes through them
const gap = (x, z, h) => {
  const k = gauss(z + 515, 150) * smoothstep(170, 70, x);
  return k > 0 ? lerp(h, Math.min(h, 45 + 0.025 * (x + 910)), k) : h;
};
export const tableGround = (x, z) => {
  let h = gap(x, z, tableReal(x, z));
  const sd = mesaSD(x, z) + 9 * fbm(x / 50, z / 50, 2, TABLE_SEED + 1);
  if (sd < 70) {
    const top = MESA.top + 1.2 * fbm(x / 80, z / 80, 2, TABLE_SEED + 2);
    // sheer walls a few tens of metres high, a talus of fallen blocks at their foot
    const k = smoothstep(26, -4, sd), talus = smoothstep(70, 26, sd) * 0.35;
    h = Math.max(h, lerp(h, top, Math.max(k, talus * (1 - k))));
  }
  // the ledge road: a shelf cut along the wall, rising from the ridge to the top
  const n = lineNear(LEDGE, x, z);
  if (n.d < 40) h = lerp(h, lerp(tableReal(LEDGE[0][0], LEDGE[0][1]) + 2, MESA.top, n.s / ledgeLen), smoothstep(40, 10, n.d));
  return h;
};
const onMesa = (x, z) => mesaSD(x, z) < -6;

export const TABLE_ROUTES = {
  'North Coast Highway': { via: [[-910, -510], [-640, -512], [-250, -515], [100, -520], [910, -520]], kind: 'road', width: 3.8, lanes: 2, grade: 0.07, smooth: 30, cut: 8, shoulder: 8, level: true, extend: [8, 8] },
  'Mesa Road': { via: [[100, -520], [200, -150], [500, 150], [700, 520], [640, 640], [60, 585], [-40, 470]], kind: 'road', width: 3.0, grade: 0.12, cut: 6, shoulder: 5, surface: SURFACE.GRAVEL },
  'Table Land Top': { via: [[-40, 470], [240, 440], [520, 400]], kind: 'trail', width: 2.6 },
  'Ridge Track': { via: [[-870, 910], [-700, 760], [-420, 700], [-150, 720], [200, 760], [520, 700], [700, 520]], kind: 'trail', width: 2.3, extend: [8, 0] },
};

export const TABLELAND = stretch({
  id: 'tableland', name: 'Table Land', short: 'Table Land', seed: TABLE_SEED, half: HALF, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  station: { x: 140, z: -470, name: 'Devkund Dhaba' }, spawn: { x: 160, z: -455, yaw: Math.PI / 2 }, dealer: 'Konkan Motors',
  load: () => COAST.load(), baseHeight: tableGround, roughOf: (h) => clamp((h - 40) / 200, 0.2, 0.8),
  ...TROPICAL, farWoods: 0.4,
  trails: trailsOf('tableland', TABLE_ROUTES),
  landmarks: [{ type: 'chaistall', x: 150, z: -495, yaw: 0 }, { type: 'lookout', x: 560, z: 430, yaw: 0.2 }],
  beacons: [{ id: 0, name: 'Table Land', x: 240, z: 380 }, { id: 1, name: 'Devkund Gap', x: -560, z: -470 }],
  races: [
    { id: 'mesaclimb', kind: 'rally', name: 'Mesa Climb', desc: 'Off the highway and up the gravel road onto the laterite mesa, round its rim to the flat top.',
      trail: 'Mesa Road', from: [100, -520], to: [-40, 470], cps: 6, r: 10, par: PAR.mesaclimb, prize: 1.2 },
  ],
  gen: graded([{ road: 'North Coast Highway', grade: 0.07, smooth: 40, ends: ['ground', 'ground'] }, { road: 'Mesa Road', grade: 0.12, ends: [{ road: 'North Coast Highway' }, null] }], {
    surface(x, z, h, sl, s) {
      // the mesa's top: bare laterite, gravel and rock, a little grass in its hollows
      if (onMesa(x, z) && sl < 0.6) return vnoise(x / 12, z / 12, TABLE_SEED + 3) > 0.62 ? SURFACE.GRASS : vnoise(x / 30, z / 30, TABLE_SEED + 4) > 0.55 ? SURFACE.GRAVEL : SURFACE.DIRT;
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      plant(ctx, 6, (x, z, s, h, R, roll) => {
        if (mesaSD(x, z) < 40) return null;
        const wood = vnoise(x / 150, z / 150, TABLE_SEED + 5), low = smoothstep(150, 80, h);
        return roll < 0.015 + 0.22 * low * smoothstep(0.35, 0.65, wood) ? tropic(roll < 0.08 ? TROPIC.giant : roll < 0.11 ? TROPIC.bamboo : TROPIC.mango, R) : null;
      });
    },
  }),
});

// ---------------------------------------------------------------- Chalkewadi
const WIND_SEED = 7440;
const windReal = real('windfarm');
// the crests the turbines stand along (the ridge over the coast's corner, and the one west of it)
const CRESTS = [[[400, 230], [520, 420], [640, 590], [770, 760], [880, 820]], [[-880, 760], [-700, 700], [-520, 640], [-330, 690]]];
export const windGround = (x, z) => windReal(x, z);
/** The turbines: every 130 m along each crest, 24 m off it, and kept 28 m clear of the tracks up there. */
const TURBINE_CLEAR = 28;
function turbines() {
  const tracks = Object.keys(WIND_ROUTES).map((name) => ROADS.windfarm?.[name]).filter(Boolean);
  return CRESTS.flatMap((c) => {
    const L = lineLength(c), out = [];
    for (let s = 40; s < L - 20; s += 130) {
      const [x, z] = along(c, s), [x2, z2] = along(c, s + 5), l = hyp(x2 - x, z2 - z) || 1;
      let tx = x - (z2 - z) / l * 24, tz = z + (x2 - x) / l * 24;
      for (const t of tracks) {
        const n = lineNear(t, tx, tz);
        if (n.d >= TURBINE_CLEAR) continue;
        const [px, pz] = along(t, n.s), dx = tx - px, dz = tz - pz, dl = hyp(dx, dz);
        const [ux, uz] = dl > 0.5 ? [dx / dl, dz / dl] : [-(z2 - z) / l, (x2 - x) / l];
        tx = px + ux * TURBINE_CLEAR; tz = pz + uz * TURBINE_CLEAR;
      }
      out.push({ type: 'turbine', x: Math.round(tx), z: Math.round(tz), yaw: 0 });
    }
    return out;
  });
}

export const WIND_ROUTES = {
  'North Coast Highway': { via: [[-910, -520], [-400, -470], [0, -440], [400, -480], [910, -520]], kind: 'road', width: 3.8, lanes: 2, grade: 0.07, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [8, 8] },
  'Turbine Track': { via: [[300, -465], [420, 0], [400, 230], [640, 590], [880, 820]], kind: 'trail', width: 2.6, grade: 0.22 },
  'West Ridge Track': { via: [[-600, -485], [-640, 100], [-760, 560], [-560, 650], [-330, 690]], kind: 'trail', width: 2.4, grade: 0.24 },
};

export const WINDFARM = stretch({
  id: 'windfarm', name: 'Chalkewadi', short: 'Chalkewadi', seed: WIND_SEED, half: HALF, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  station: { x: 300, z: -500, name: 'Chalkewadi Gate' }, spawn: { x: 280, z: -510, yaw: Math.PI / 2 }, dealer: 'Konkan Motors',
  load: () => COAST.load(), baseHeight: windGround, roughOf: (h) => clamp((h - 40) / 220, 0.2, 0.8),
  ...TROPICAL, farWoods: 0.35,
  trails: trailsOf('windfarm', WIND_ROUTES),
  landmarks: [...turbines(), { type: 'garage', x: 330, z: -535, yaw: 0 }],
  beacons: [{ id: 0, name: 'Chalkewadi Ridge', x: 700, z: 640 }, { id: 1, name: 'West Ridge', x: -520, z: 610 }],
  races: [
    { id: 'turbineridge', kind: 'rally', name: 'Turbine Ridge', desc: 'From the gate up the windfarm track onto Chalkewadi\'s bare crest, and along it under the turning blades.',
      trail: 'Turbine Track', from: [300, -465], to: [880, 820], cps: 6, r: 10, par: PAR.turbineridge, prize: 1.3 },
  ],
  gen: graded([{ road: 'North Coast Highway', grade: 0.07, smooth: 40, ends: ['ground', 'ground'] }], {
    surface(x, z, h, sl, s) {
      // the ridges' tops: short grass on thin soil, bare rock and laterite gravel showing through
      if (h > 190 && sl < 0.5 && vnoise(x / 18, z / 18, WIND_SEED + 1) > 0.66) return SURFACE.GRAVEL;
      return s === SURFACE.DIRT ? SURFACE.GRASS : s;
    },
    trees(ctx) {
      plant(ctx, 6, (x, z, s, h, R, roll) => {
        if (h > 180) return null;                                                // (the ridges bare: the wind)
        const wood = vnoise(x / 130, z / 130, WIND_SEED + 2);
        return roll < 0.02 + 0.2 * smoothstep(0.4, 0.7, wood) * smoothstep(170, 90, h) ? tropic(roll < 0.06 ? TROPIC.giant : TROPIC.mango, R) : null;
      });
    },
  }),
});
