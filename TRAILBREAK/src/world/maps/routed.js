// The regions whose roads tools/routeroads.mjs routes: each { id, half, ground (its heights, in its own frame),
// routes (name -> { via, grade, kind }), load (what the ground needs fetched first), avoid (extra cost a metre: water,
// cliffs, the map's open edges), step (m between the grid's points) }.
import { COAST } from './coast.js';
import { KORLAI, KORLAI_ROUTES, korlaiGround, BORLI, BORLI_ROUTES, borliGround, TABLELAND, TABLE_ROUTES, tableGround, WINDFARM, WIND_ROUTES, windGround } from './north.js';
import { GLEN, GLEN_ROUTES, glenGround, FOREST, FOREST_ROUTES, forestGround, QUARRY, QUARRY_RAMP } from './east.js';
import { DECCAN, DECCAN_ROUTES, deccanGround } from './deccan.js';
import { GHAT_SPURS, PASS_SPURS, ghatGround, passGround } from './world.js';
import { lineD } from './country.js';

// (a road keeps a few tens of metres in from an open edge of the world)
const edge = (half, sides) => (x, z) => {
  let c = 0;
  if (sides.includes('north')) c += Math.max(0, 40 - (z + half)) * 2;
  if (sides.includes('south')) c += Math.max(0, 40 - (half - z)) * 2;
  if (sides.includes('west')) c += Math.max(0, 40 - (x + half)) * 2;
  if (sides.includes('east')) c += Math.max(0, 40 - (half - x)) * 2;
  return c;
};
const northEdge = edge(910, ['north']);
/** In a lake (its shape as the generator makes it, world/WorldGen.js), with a margin round it: an extra cost. */
const lakeCost = (L, margin = 1.2) => {
  const c = Math.cos(L.rot || 0), s = Math.sin(L.rot || 0), k = L.stretch || 1;
  return (x, z) => { const dx = x - L.x, dz = z - L.z, u = (dx * c + dz * s) / k, v = -dx * s + dz * c; return Math.hypot(u, v) < L.r * margin ? 60 : 0; };
};
const borliLake = lakeCost(BORLI.lake), glenLake = lakeCost(GLEN.lake, 1.08), shivsagar = lakeCost(DECCAN.lake, 1.15);
const deccanRiver = DECCAN.riverWith(0).points;
// (into the quarry only down its ramp)
const quarry = (x, z) => (Math.hypot(x - QUARRY.x, z - QUARRY.z) < QUARRY.r + 30 && lineD(QUARRY_RAMP, x, z) > 5 ? 40 : 0);
// (the Deccan's own routes but its town's streets, which are laid straight)
const deccanRoutes = Object.fromEntries(Object.entries(DECCAN_ROUTES).filter(([, r]) => !r.points));

export const ROUTED = [
  { id: 'korlai', half: KORLAI.half, ground: korlaiGround, routes: KORLAI_ROUTES, load: () => COAST.load(), avoid: (x, z, h) => (h < 0.8 ? 40 : 0) + northEdge(x, z) },
  { id: 'borli', half: BORLI.half, ground: borliGround, routes: BORLI_ROUTES, load: () => COAST.load(), avoid: (x, z) => borliLake(x, z) + northEdge(x, z) },
  { id: 'tableland', half: TABLELAND.half, ground: tableGround, routes: TABLE_ROUTES, load: () => COAST.load(), avoid: northEdge },
  { id: 'windfarm', half: WINDFARM.half, ground: windGround, routes: WIND_ROUTES, load: () => COAST.load(), avoid: northEdge },
  { id: 'forest', half: FOREST.half, ground: forestGround, routes: FOREST_ROUTES, load: () => COAST.load(), avoid: quarry },
  { id: 'glen', half: GLEN.half, ground: glenGround, routes: GLEN_ROUTES, load: () => COAST.load(), avoid: (x, z) => glenLake(x, z) + edge(1024, ['north'])(x, z) },
  { id: 'deccan', half: DECCAN.half, step: 8, ground: deccanGround, routes: deccanRoutes, load: () => COAST.load(),
    avoid: (x, z) => shivsagar(x, z) + (lineD(deccanRiver, x, z) < 40 ? 25 : 0) + edge(2048, ['east', 'south'])(x, z) },
  { id: 'ghat', half: 1024, ground: ghatGround, routes: GHAT_SPURS, load: () => COAST.load() },
  { id: 'pass', half: 1024, ground: passGround, routes: PASS_SPURS },
];
