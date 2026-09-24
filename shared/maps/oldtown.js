// Map: OLD TOWN — dense historic town: narrow streets and multi-storey blocks around a market (A), the church
// square (B), the train station (C) and the old mill (D). Close quarters everywhere — 4 flags.
import { propList, baseProps, village } from './helpers.js';

const bases = {
  1: { x: -150, z: 0, yaw: -Math.PI / 2 },   // US: west, facing east
  2: { x: 150, z: 0, yaw: Math.PI / 2 },     // RU: east, facing west
};

const roads = [
  { ax: -175, az: 0, bx: 175, bz: 0, w: 8, name: 'high street' },
  { ax: -175, az: -58, bx: 175, bz: -58, w: 6, name: 'north lane' },
  { ax: -175, az: 58, bx: 175, bz: 58, w: 6, name: 'south lane' },
  { ax: -70, az: -140, bx: -70, bz: 140, w: 6, name: 'mill street' },
  { ax: 0, az: -140, bx: 0, bz: 140, w: 7, name: 'church street' },
  { ax: 70, az: -140, bx: 70, bz: 140, w: 6, name: 'station street' },
  { ax: 40, az: 110, bx: 150, bz: 110, w: 10, name: 'railway' },
];

const buildings = [];
// town blocks between the streets: 2-3 storey houses, some ruined
const blocks = [[-35, -29], [35, -29], [-35, 29], [35, 29], [-105, -29], [105, -29], [-105, 29], [105, 29], [-35, -95], [35, -95], [-35, 95], [-105, -95], [105, -95], [-105, 95]];
blocks.forEach(([cx, cz], i) => {
  const placed = village(buildings, { id: `ot${i}_`, cx, cz, n: 3, seed: 100 + i, spread: 16, styles: ['plaster', 'brick', 'concrete'], damage: 0.45, avoid: { roads } });
  for (const b of placed) b.floors = Math.min(3, b.floors + (i % 3 === 0 ? 1 : 0));
});
// landmarks
buildings.push(
  { id: 'och', x: 0, z: -22, w: 16, d: 12, floors: 3, style: 'brick', damage: 0.5, doors: ['s', 'n'] },   // church (B)
  { id: 'omk', x: -44, z: 22, w: 12, d: 10, floors: 2, style: 'plaster', damage: 0.2, doors: ['n', 'e'] }, // market hall (A)
  { id: 'ost', x: 96, z: 92, w: 26, d: 12, floors: 2, style: 'concrete', damage: 0.3, doors: ['s', 'n', 'w'] }, // station (C)
  { id: 'oml', x: -92, z: -104, w: 20, d: 14, floors: 1, style: 'warehouse', damage: 0.4, doors: ['e', 's'] }, // mill (D)
);

function props() {
  const { P, add } = propList();
  // market square: stalls (crates), carts, barricades
  for (let i = 0; i < 5; i++) add('crate_stack', -60 + i * 6, 12, i % 2);
  add('car', -30, 8, 0, { burnt: true }); add('barrier', -20, -6, 1); add('barrier', -20, -4.4, 1); add('sandbags', -52, 38, 0, { len: 6 });
  // church square: rubble, sandbag positions
  add('sandbags', -10, 10, 0, { len: 8 }); add('sandbags', 12, 10, 0, { len: 8 }); add('car', 14, -6, 1); add('trash', -12, -8, 0);
  // station: containers on the tracks, platform barriers
  add('container', 70, 110, 0); add('container', 120, 110, 0); add('container', 136, 108, 0); add('barrier2', 84, 102, 0); add('barrier2', 104, 102, 0);
  // mill yard
  add('barrel', -76, -118); add('barrel', -76.6, -118.7); add('crate_stack', -110, -120, 0); add('generator', -84, -90, 0); add('car', -60, -120, 1, { burnt: true });
  // street barricades and wrecks
  for (const [x, z, r] of [[-70, -30, 0], [70, 30, 0], [0, 58, 1], [-120, 0, 1], [120, 0, 1], [0, -58, 1], [35, 58, 1], [-35, -58, 1]]) add('barrier', x, z, r);
  for (const [x, z, r] of [[-86, 4, 0], [86, -4, 0], [-4, 90, 1], [4, -90, 1], [50, -58, 0], [-50, 58, 0]]) add('car', x, z, r, { burnt: Math.random() < 0.5 });
  for (let x = -160; x <= 160; x += 32) { add('lamp', x, 5, 0); add('lamp', x + 16, -5, 0); }
  baseProps(add, bases[1], 'e'); baseProps(add, bases[2], 'w');
  return P;
}

export default {
  id: 'oldtown',
  name: 'Old Town',
  description: 'Dense historic town: narrow streets, market square, church, train station and mill — close quarters, 4 flags.',
  mapHalf: 180, playHalf: 160,
  terrain: { amp: 3, scale: 60, detail: 0.8, edge: 20, seed: 77, flatten: 14, baseAmp: 6, baseScale: 200 },
  atmosphere: { sun: [-0.35, 0.45, -0.55], fog: 0xb9b6ad, fogNear: 60, fogFar: 0.9, exposure: 0.95, grass: [0.98, 1.0, 0.9] },
  vegetation: { seed: 7707, trees: 160, shrubs: 700, rocks: 40, clusters: 3, dead: 0.2 },
  roads,
  flags: [
    { id: 'A', x: -44, z: 8, r: 14, owner: 1 },
    { id: 'B', x: 0, z: 4, r: 13 },
    { id: 'C', x: 96, z: 76, r: 14, owner: 2 },
    { id: 'D', x: -90, z: -82, r: 14 },
  ],
  bases,
  buildings,
  props,
};
