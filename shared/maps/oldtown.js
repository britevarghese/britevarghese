// Map: OLD TOWN — dense historic town: terraced streets with sidewalks around the cobbled market square (A) and the
// church square (B), the train station (C) and the old mill (D). Back yards and alleys behind every street front —
// close quarters everywhere, 4 flags.
import { propList, baseProps, townBlock } from './helpers.js';

const bases = {
  1: { x: -150, z: 0, yaw: -Math.PI / 2 },   // US: west, facing east
  2: { x: 150, z: 0, yaw: Math.PI / 2 },     // RU: east, facing west
};

const roads = [
  { ax: -175, az: 0, bx: 175, bz: 0, w: 8, name: 'high street', sidewalk: 2 },
  { ax: -175, az: -58, bx: 175, bz: -58, w: 6, name: 'north lane', sidewalk: 2 },
  { ax: -175, az: 58, bx: 175, bz: 58, w: 6, name: 'south lane', sidewalk: 2 },
  { ax: -70, az: -140, bx: -70, bz: 140, w: 6, name: 'mill street', sidewalk: 2 },
  // church street runs into the church square from both sides (the church stands in the square across its axis)
  { ax: 0, az: -140, bx: 0, bz: -38, w: 7, name: 'church street', sidewalk: 2 },
  { ax: 0, az: -10, bx: 0, bz: 140, w: 7, name: 'church street', sidewalk: 2 },
  { ax: 70, az: -140, bx: 70, bz: 140, w: 6, name: 'station street', sidewalk: 2 },
  { ax: 40, az: 110, bx: 150, bz: 110, w: 10, name: 'railway', kind: 'rail' },
];

// open places (kept free of houses): the two squares, the station forecourt, the mill yard, both HQs, the railway
const squares = {
  market: { x0: -65, z0: 6, x1: -26, z1: 38 },
  church: { x0: -22, z0: -38, x1: 22, z1: -6 },
  station: { x0: 77, z0: 63, x1: 118, z1: 84 },
  mill: { x0: -112, z0: -112, x1: -75, z1: -63 },
};
const avoid = [...Object.values(squares), { x0: -175, z0: -42, x1: -118, z1: 42 }, { x0: 118, z0: -42, x1: 175, z1: 42 }, { x0: 36, z0: 103, x1: 175, z1: 117 }];

// landmarks first, so the town houses are placed around them
const buildings = [
  { id: 'och', x: 0, z: -22, w: 16, d: 12, floors: 3, style: 'brick', damage: 0.5, doors: ['s', 'n'] },   // church (B)
  { id: 'omk', x: -44, z: 24, w: 11, d: 10, floors: 2, style: 'plaster', damage: 0.2, doors: ['n', 'e'] }, // market hall (A)
  { id: 'ost', x: 96, z: 92, w: 28, d: 12, floors: 2, style: 'concrete', damage: 0.3, doors: ['s', 'n', 'w'] }, // station (C)
  { id: 'oml', x: -92, z: -104, w: 20, d: 14, floors: 1, style: 'warehouse', damage: 0.4, doors: ['e', 's'] }, // mill (D)
];

const { P: townProps, add: addTown } = propList();
// (the squares are paved right up to the house fronts around them)
const paved = [
  { ...squares.market, x1: -24.5, z1: 40, kind: 'cobble' }, { x0: -23.5, z0: -38, x1: 23.5, z1: -4, kind: 'cobble' },
  { ...squares.station, x1: 116, z1: 85, kind: 'pavers' }, { x0: -110, z0: -96, x1: -76, z1: -63, kind: 'concrete' },
];
// Town blocks between the streets (buildable rects behind the 2 m sidewalks). Inner town: terraced on every street,
// 2-4 storeys; outer quarters thinner, lower and partly detached toward the fields and the HQs.
const inner = { floors: [2, 4], depth: [8, 11], width: [7, 11], damage: 0.35, clutter: 3 };
const outer = { floors: [1, 3], depth: [8, 10], width: [8, 11], every: [1, 2], alley: [5, 10], damage: 0.3, clutter: 1 };
const westFace = { width: [6, 13] }; // front doors on a west wall must clear the stair (see doorFits)
const lone = { detached: true, alley: [6, 12] }; // single houses with gardens between
const blocks = [
  // around the market square (A): church-street row, south-lane row, and a row facing the square
  { id: 'oa', x0: -65, z0: 6, x1: -5.5, z1: 53, sides: { n: true, s: true, e: { depth: [8, 9] } }, ...inner,
    extra: [{ face: 'w', at: -24.5, from: 6, to: 42, depth: [8, 9], ...westFace }] },
  { id: 'ob', x0: 5.5, z0: 6, x1: 65, z1: 53, sides: { n: true, s: true, w: westFace, e: true }, ...inner },
  // around the church square (B): rows on the high street, the lanes, and facing the square
  { id: 'oc', x0: -65, z0: -53, x1: -5.5, z1: -6, sides: { n: true, s: true, w: westFace }, ...inner,
    extra: [{ face: 'e', at: -23.5, from: -37.5, to: -15 }] },
  { id: 'od', x0: 5.5, z0: -53, x1: 65, z1: -6, sides: { n: true, s: true, e: true }, ...inner,
    extra: [{ face: 'w', at: 23.5, from: -37.5, to: -15, ...westFace }] },
  // quarters between the HQs and the mill / station streets
  { id: 'oe', x0: -132, z0: 6, x1: -75, z1: 53, sides: { n: true, s: lone, e: true }, ...outer },
  { id: 'of', x0: -132, z0: -53, x1: -75, z1: -6, sides: { n: lone, s: true, e: true }, ...outer },
  { id: 'og', x0: 75, z0: 6, x1: 132, z1: 53, sides: { n: true, s: lone, w: westFace }, ...outer },
  { id: 'oh', x0: 75, z0: -53, x1: 132, z1: -6, sides: { n: lone, s: true, w: westFace }, ...outer },
  // the town's north and south edges: houses along the lanes, gardens and fields behind
  { id: 'oi', x0: -65, z0: -128, x1: -5.5, z1: -63, sides: { s: true }, ...outer },
  { id: 'oj', x0: 5.5, z0: -128, x1: 65, z1: -63, sides: { s: true }, ...outer },
  { id: 'ok', x0: -65, z0: 63, x1: -5.5, z1: 128, sides: { n: true, e: { ...lone, alley: [14, 20] } }, ...outer },
  { id: 'ol', x0: 5.5, z0: 63, x1: 65, z1: 128, sides: { n: true }, ...outer },
  { id: 'om', x0: 75, z0: -128, x1: 128, z1: -63, sides: { s: lone }, ...outer },
  { id: 'on', x0: -128, z0: 63, x1: -75, z1: 128, sides: { e: lone }, ...outer },
];
blocks.forEach((b, i) => townBlock(buildings, addTown, { seed: 1000 + i * 31, avoid, ...b }));

function props() {
  const { P, add } = propList();
  P.push(...townProps.map((p) => ({ ...p })));
  // market square: stalls (crates) in front of the hall, carts, a barricade across the square
  for (let i = 0; i < 4; i++) add('crate_stack', -58 + i * 5, 14, i % 2);
  add('car', -30, 33, 1, { burnt: true }); add('barrier', -36, 12, 1); add('barrier', -36, 13.6, 1); add('sandbags', -56, 33, 0, { len: 6 }); add('trash', -62, 28, 1);
  // church square: sandbag positions, crates, a parked car
  add('sandbags', -12, -10, 0, { len: 7 }); add('sandbags', 12, -10, 0, { len: 7 }); add('car', 16, -30, 0); add('trash', -16, -32, 0);
  add('crate_stack', -18, -20, 1); add('barrier2', 18, -18, 1);
  // station: freight containers in the yard beside the tracks, platform barriers, forecourt
  add('container', 82, 119, 0); add('container', 120, 119, 0); add('container', 136, 121.5, 0); add('barrier2', 84, 101, 0); add('barrier2', 104, 101, 0);
  add('car', 88, 70, 1); add('sandbags', 106, 68, 0, { len: 6 });
  // mill yard
  add('barrel', -80, -92); add('barrel', -80.6, -92.7); add('crate_stack', -106, -90, 0); add('generator', -84, -88, 0); add('car', -100, -70, 1, { burnt: true });
  // street barricades, parked cars at the kerb and wrecks
  for (const [x, z, r] of [[-70, -30, 0], [70, 30, 0], [0, 58, 1], [-120, 0, 1], [120, 0, 1], [0, -58, 1], [35, 58, 1], [-35, -58, 1]]) add('barrier', x, z, r);
  [[-86, 2.3, 1], [86, -2.3, 1], [-2, 90, 0], [2, -90, 0], [50, -60, 1], [-50, 60, 1], [-40, -2.3, 1], [44, 2.3, 1], [72, -30, 0], [-68, 30, 0], [24, -56, 1], [-100, 56, 1]]
    .forEach(([x, z, r], i) => add('car', x, z, r, { burnt: i % 3 === 0 }));
  // street lamps on the sidewalks (kerb side), alternating along each street
  for (let x = -112; x <= 112; x += 32) { add('lamp', x, 4.6, 0); add('lamp', x + 16, -4.6, 0); }
  for (const z0 of [-58, 58]) for (let x = -105; x <= 105; x += 42) add('lamp', x, z0 + (x % 84 ? 3.6 : -3.6), 0);
  for (const x0 of [-70, 0, 70]) for (let z = -105; z <= 105; z += 42) if (Math.abs(z) > 12) add('lamp', x0 + (x0 === 0 ? 4.1 : 3.6) * (z % 84 ? 1 : -1), z, 0);
  baseProps(add, bases[1], 'e'); baseProps(add, bases[2], 'w');
  return P;
}

export default {
  id: 'oldtown',
  name: 'Old Town',
  description: 'Dense historic town: terraced streets, market square, church, train station and mill — close quarters, 4 flags.',
  mapHalf: 180, playHalf: 160,
  terrain: { amp: 3, scale: 60, detail: 0.8, edge: 11, seed: 77, flatten: 14, baseAmp: 6, baseScale: 200 }, // low edge hills: the HQs stand on them
  atmosphere: { sun: [-0.35, 0.45, -0.55], fog: 0xb9b6ad, fogNear: 60, fogFar: 0.9, exposure: 0.95, grass: [0.98, 1.0, 0.9] },
  vegetation: { seed: 7707, trees: 160, shrubs: 700, rocks: 20, clusters: 3, dead: 0.2 },
  roads,
  paved,
  flags: [
    { id: 'A', x: -44, z: 10, r: 14, owner: 1 },
    { id: 'B', x: 0, z: -5, r: 13 },
    { id: 'C', x: 96, z: 76, r: 14, owner: 2 },
    { id: 'D', x: -90, z: -82, r: 14 },
  ],
  bases,
  buildings,
  props,
};
