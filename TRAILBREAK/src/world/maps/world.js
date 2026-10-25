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
import { graded, seamPairs } from './seams.js';
import { KORLAI, BORLI, TABLELAND, WINDFARM, NORTH_AT } from './north.js';
import { GLEN, FOREST, EAST_AT } from './east.js';
import { DECCAN, DECCAN_AT } from './deccan.js';
import { TAIGA, TAIGA_AT } from './taiga.js';
import { CANYON, CANYON_AT } from './canyon.js';
import { trailsOf } from './country.js';

export { seamPairs };

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
const keralaPasses = passCut(keralaWall, [{ along: 'z', at: 40, side: -1 }, { along: 'x', at: 30, side: -1 }, { along: 'x', at: 200, side: 1 }]);
const keralaGround = (x, z) => keralaBase(x, z) - keralaPasses(x, z);
// Ashwood: the walls of its valley (WorldGen's own landform), and its pass south, where the old valley road leaves it
const ashwoodWall = (x, z) => {
  const e = Math.max(Math.abs(x), Math.abs(z));
  return e > 850 ? smoothstep(850, 1180, e) * (230 + 140 * ridged(x / 240, z / 240, 4, ASHWOOD_SEED + 20)) : 0;
};
const ashwoodPasses = passCut(ashwoodWall, [{ along: 'x', at: 20, side: 1 }, { along: 'z', at: -64, side: -1 }]);
const ashwoodGround = (x, z) => landform(ASHWOOD).baseHeight(x, z) - ashwoodPasses(x, z);

/** The coast as it stands in the world: the Kashid ghat road carried on to its east edge. */
export const COAST_W = {
  ...COAST, id: 'coast@world',
  // (in the world: fields of mud and of rock by its roads and tracks, boulders about its open ground)
  mudFields: 5, rockFields: 3, mudTracks: 0.4, wornTracks: true, rockRelief: true, looseRocks: 4, boulderMax: 16000,
  trails: [...COAST.trails,
    { name: 'Kashid Ghat East', kind: 'road', width: 3.6, lanes: 2, grade: 0.11, smooth: 24, cut: 7, shoulder: 8, level: true, extend: [0, 8], points: [[3960, -700], [3980, -685.5], [3999.9, -671.1]] },
    // (the coast road on north from its end round the headland, and the ridge track from its end by the edge: into
    // Korlai and the Table Land)
    { name: 'Coast Road North', kind: 'road', width: 3.8, lanes: 2, grade: 0.1, smooth: 24, cut: 6, shoulder: 8, level: true, extend: [0, 8], points: [[-1900, -3960], [-1881, -3980], [-1862, -3999.9]] },
    { name: 'Ridge Track North', kind: 'trail', width: 2.3, extend: [0, 8], points: [[400, -3960], [399.8, -3980], [399.6, -3999.9]] },
    // (and the south ghat on east from its end, into the Deccan)
    { name: 'South Ghat East', kind: 'road', width: 3.6, lanes: 2, grade: 0.1, smooth: 24, cut: 6, shoulder: 8, level: true, extend: [0, 8], points: [[3960, 1300], [3980, 1290], [3999.9, 1280]] }],
  gen: graded([{ road: 'Kashid Ghat East', grade: 0.1, ends: ['ground'] }, { road: 'Coast Road North', grade: 0.1, ends: ['ground'] }, { road: 'South Ghat East', grade: 0.1, ends: ['ground'] }], COAST.gen),
};

/** Kerala as it stands in the world: passes west and north, and the roads out through them. */
export const KERALA_W = {
  ...KERALA, id: 'kerala@world', baseHeight: keralaGround, mudFields: 4, rockFields: 2.5, mudTracks: 0.4, wornTracks: true, rockRelief: true, looseRocks: 4,
  // (the house beside the Anapara Track set back off it: its corner stood on the track's bed, its yard a terrace below)
  landmarks: KERALA.landmarks.map((L) => (L.type === 'house' && L.x === 150 && L.z === 96 ? { ...L, x: 148, z: 99.4 } : L)),
  trails: [...KERALA.trails,
    // (off the paddy and rubber track below Rubber Estate Hill, west along the spur and through the pass to the coast:
    // the Konkan Ghat Road's two lanes and their lines carried on to the track)
    { name: 'Konkan Road', kind: 'road', width: 3.6, lanes: 2, shoulder: 8, level: true, grade: 0.12, cut: 6, extend: [0, 8], points: [[-558, 47], [-610, 44], [-690, 42], [-770, 40], [-860, 40], [-950, 40], [-1024, 40]] },
    // (off the Kurinji jeep track below the summit, north through the gap between the peaks: gravel, as the pass road it
    // runs on into is)
    { name: 'Pass Road', kind: 'road', width: 3.4, grade: 0.12, cut: 6, extend: [0, 8], surface: SURFACE.GRAVEL, points: [[17, -775], [20, -850], [25, -940], [30, -1024]] },
    // (the corner from the estate road onto the jeep track at the factory, worn smooth: the road is cut into the slope
    // there a metre and a half below the yard's edge, a crest a long truck grounds on as it turns)
    { name: 'Factory Turn', kind: 'trail', width: 2.4, points: [[57, -633], [54, -641], [55.5, -647], [60, -648.5], [66, -646], [69, -643]] },
    // (off the end of the quarry road, south through a gap cut in the ridge to the Deccan's ghat road)
    { name: 'Deccan Road', kind: 'road', width: 3.6, lanes: 2, grade: 0.12, cut: 6, shoulder: 8, level: true, extend: [0, 8], points: [[189, 675], [191, 760], [196, 860], [201, 950], [205, 1024]] }],
  gen: graded([{ road: 'Konkan Road', grade: 0.12, ends: ['ground'] }, { road: 'Pass Road', grade: 0.12, ends: ['ground'] }, { road: 'Deccan Road', grade: 0.12, ends: ['ground'] },
    { road: 'Factory Turn', grade: 0.12, smooth: 8, ends: ['ground', 'ground'] }], KERALA.gen),
};

/** Ashwood as it stands in the world: a pass south, and the old valley road on through it. */
export const ASHWOOD_W = {
  ...ASHWOOD, id: 'ashwood@world', baseHeight: ashwoodGround, mudFields: 3, rockFields: 2.5, mudTracks: 0.4, wornTracks: true, rockRelief: true, looseRocks: 5,
  trails: [...ASHWOOD.trails, { name: 'Pass Road', kind: 'road', width: 3.4, extend: [0, 8], points: [[10, 890], [14, 950], [18, 1000], [20, 1024]] },
    // (the Pinecrest trail on west through a gap in the valley's wall, down to Koyna Glen)
    { name: 'Pinecrest West', kind: 'trail', width: 2.1, extend: [0, 8], points: [[-760, -45], [-850, -52], [-940, -58], [-1024, -64]] }],
};

// (the roads that cross a seam: extend: [start, end] m, each paved straight on past its end at the seam, and its lines
// and wear with it, each map drawing only its own side: so a road crossing a seam at a slant is paved right up to it
// on both sides, world/WorldGen.js, render/RoadMarkings.js, render/RoadWear.js)

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
// the stretches' spurs into the new country round them (routed over their ground: tools/routeroads.mjs)
export const GHAT_SPURS = {
  'Bhimashankar Road': { via: [[-60, 84], [-120, -250], [-200, -600], [-256, -1024]], kind: 'road', width: 3.6, lanes: 2, grade: 0.08, smooth: 30, cut: 6, shoulder: 8, level: true, extend: [0, 8] },
  'Kundalika South': { via: [[770, 885], [766, 960], [760, 1024]], kind: 'trail', width: 2.2, extend: [0, 8] },
};
export const PASS_SPURS = {};
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
export const ghatGround = (x, z) => {
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

/** The river's level where it leaves the Konkan Ghat across its south edge (into the Deccan). */
let ghatOut = null;
function ghatRiverOut() {
  if (ghatOut !== null) return ghatOut;
  const R = ghatRiver(), pts = spline(R.points, 2);
  let len = 0, sEdge = 0, total = 0;
  for (let i = 1; i < pts.length; i++) total += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    len += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (pts[i - 1][1] <= 1024 && pts[i][1] > 1024) sEdge = len / total;
  }
  ghatOut = R.levelAt(sEdge);
  return ghatOut;
}

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
    ...trailsOf('ghat', GHAT_SPURS),
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
  roadSurface: SURFACE.ROAD, puddles: 8, mudFields: 4, rockFields: 2.5, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
  // (the ghat's steep ground grown over as Kerala's is, all the way to the coast: its escarpment up to Kerala's ridges
  // green, bare rock only on its sheerest faces)
  keralaRock: 4096,
  pads: { chaistall: 5, busstop: 3 },
  gen: { walls: KERALA_WALLS, trees: ghatTrees,
    ...graded([{ road: 'Konkan Ghat Road', grade: 0.09, ends: ['ground', 'ground'] }, { road: 'Kundalika River Track', grade: 0.2, ends: [{ road: 'Konkan Ghat Road' }, 'ground'] },
      { road: 'Bhimashankar Road', grade: 0.08, ends: [{ road: 'Konkan Ghat Road' }, 'ground'] }]) },
  litter: COAST.litter, treeStrength: COAST.treeStrength, young: COAST.young, roadside: COAST.roadside,
  dust: COAST.dust, mudTint: COAST.mudTint, ground: 'coast', trees: 'kerala', atmosphere: COAST.atmosphere,
};

// The Ashwood Pass: Kerala's tea plateau carried north and Ashwood's valley mouth carried south meet across a saddle
// in the range, the pass road's line through it lower than the ridges either side.
const passLine = (z) => 25 + 40 * Math.sin((z + 1024) / 2048 * Math.PI * 3) * smoothstep(1024, 600, Math.abs(z));
export const passGround = (x, z) => {
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

/** The Ashwood Pass: from Kerala's tea plateau over the range to Ashwood Valley. (Its trucks park in the lay-by on the
 * pass road below the hut, whose bank is too steep to drive.) */
export const PASS = {
  id: 'pass', name: 'Ashwood Pass', short: 'Pass',
  seed: PASS_SEED, station: { x: 110, z: -60, name: 'Pass Hut' }, spawn: { x: 50, z: -56, yaw: 2.91 }, dealer: 'Ashwood 4x4 Sales',
  half: 1024, res: 1, coarse: 4, waterRes: 2, farWoods: 0.6,
  // (its woods thinner than Ashwood's, open alpine meadow between them; fields of mud on its trail)
  woods: 0.55, mudFields: 4, rockFields: 3, mudTracks: 0.5, wornTracks: true, rockRelief: true, looseRocks: 5,
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
    ...trailsOf('pass', PASS_SPURS),
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

/** The Deccan as it stands in the world: its river the Konkan Ghat's, at the level it leaves the ghat. */
const DECCAN_W = { ...DECCAN, get river() { return DECCAN.riverWith(ghatRiverOut()); } };

// ---------------------------------------------------------------- the world
/** The maps of the world, west to east then north: id, definition, centre, the maps along each of its edges. */
export const REGIONS = [
  { id: 'coast', map: COAST_W, at: CENTRES.coast },
  { id: 'ghat', map: GHAT, at: CENTRES.ghat, seams: { west: 'coast', east: 'kerala' } },
  { id: 'kerala', map: KERALA_W, at: CENTRES.kerala },
  { id: 'pass', map: PASS, at: CENTRES.pass, seams: { south: 'kerala', north: 'ashwood' } },
  { id: 'ashwood', map: ASHWOOD_W, at: CENTRES.ashwood },
  // the north (world/maps/north.js), along the coast's north edge from the sea
  { id: 'korlai', map: KORLAI, at: NORTH_AT.korlai, seams: { south: 'coast' } },
  { id: 'borli', map: BORLI, at: NORTH_AT.borli, seams: { south: 'coast', west: 'korlai' } },
  { id: 'tableland', map: TABLELAND, at: NORTH_AT.tableland, seams: { south: 'coast', west: 'borli' } },
  { id: 'windfarm', map: WINDFARM, at: NORTH_AT.windfarm, seams: { south: 'coast', west: 'tableland' } },
  // the east (world/maps/east.js), between the coast and the pass's range, up to Ashwood
  { id: 'forest', map: FOREST, at: EAST_AT.forest, seams: { west: 'coast', east: 'pass', south: 'ghat' } },
  { id: 'glen', map: GLEN, at: EAST_AT.glen, seams: { west: ['windfarm', 'coast'], east: 'ashwood', south: 'forest' } },
  // the Deccan (world/maps/deccan.js), south of the ghat and Kerala, its river the ghat's carried on
  { id: 'deccan', map: DECCAN_W, at: DECCAN_AT, seams: { north: ['ghat', 'kerala'], west: 'coast' } },
  // the far north: Bearwood Taiga over the ridge at the head of Koyna Glen
  { id: 'taiga', map: TAIGA, at: TAIGA_AT, seams: { south: 'glen' } },
  // and west of it, north of Chalkewadi and the Table Land: Lalghati Canyon, the Bearwood's gorge in red rock
  { id: 'canyon', map: CANYON, at: CANYON_AT, seams: { south: ['windfarm', 'tableland'], east: 'taiga' } },
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

// and along the north: the North Coast Highway from where it leaves the coast, past Korlai, Borli, the Table Land and
// Chalkewadi, down into Koyna Glen to the dam
const atR = (id, [x, z]) => { const R = regionById(id); return [Math.round(x + R.at[0]), Math.round(z + R.at[1])]; };
const NORTH_COAST = [atR('korlai', [508, 880]), atR('korlai', [380, 250]), atR('korlai', [600, -620]), atR('borli', [0, -570]), atR('tableland', [100, -520]),
  atR('windfarm', [0, -440]), atR('glen', [-700, -620]), atR('glen', [-90, 540])];

export const WORLD = {
  id: 'world', name: 'Open World', short: 'World',
  races: [
    { id: 'coasttosnow', kind: 'rally', name: 'Coast to Snow', desc: 'Kashid to Ashwood: up the Kashid ghat, over the Konkan Ghat into Kerala, through the town and the tea, over the Ashwood Pass and down to the ranger station.',
      via: COAST_TO_SNOW, cps: 16, r: 14, par: { gold: 1575, silver: 1889, bronze: 2330 }, prize: 4 },
    { id: 'northcoast', kind: 'rally', name: 'North Coast Highway', desc: 'The highway along the north of the world: from the coast past Korlai, through Borli and the Devkund Gap, under the Chalkewadi turbines and down to the Koyna dam.',
      via: NORTH_COAST, cps: 14, r: 14, par: { gold: 917, silver: 1101, bronze: 1358 }, prize: 3 },
  ],
  blurb: 'The Konkan Coast, the Kerala Ghats and Ashwood Valley in one world: drive from the Arabian Sea up the ghats, through the tea estates and over the pass to the snow, with no loading on the way.',
  tagline: 'Old trucks, real physics, good friends. One world from the sea to the snow: drive it together.',
  start: 'coast', dealer: COAST.dealer, atmosphere: COAST.atmosphere,
};
