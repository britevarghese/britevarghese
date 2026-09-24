// Map: HARBOR DOCKS — container terminal on the waterfront. Four flags: two container yards, the quay and the
// warehouse row. Flat ground, tight lanes between container stacks, long sightlines along the quay.
import { mulberry32 } from '../util.js';
import { propList, baseProps } from './helpers.js';

const bases = {
  1: { x: -134, z: 55, yaw: -Math.PI / 2 },  // US: west, facing east (+x)
  2: { x: 134, z: 55, yaw: Math.PI / 2 },    // RU: east, facing west (-x)
};

const buildings = [
  // warehouse row
  { id: 'hw1', x: -88, z: 18, w: 26, d: 16, floors: 1, style: 'warehouse', damage: 0.1, doors: ['n', 's'] },
  { id: 'hw2', x: -44, z: 18, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.35, doors: ['n', 's', 'e'] },
  { id: 'hw3', x: 44, z: 18, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.2, doors: ['n', 's', 'w'] },
  { id: 'hw4', x: 88, z: 18, w: 26, d: 16, floors: 1, style: 'warehouse', damage: 0, doors: ['n', 's'] },
  // port offices & customs
  { id: 'ho1', x: -22, z: 72, w: 14, d: 10, floors: 3, style: 'concrete', damage: 0.3, doors: ['n', 'e'] },
  { id: 'ho2', x: 24, z: 74, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0, doors: ['n', 'w'] },
  { id: 'ho3', x: -13, z: -84, w: 10, d: 9, floors: 2, style: 'brick', damage: 0.45, doors: ['s', 'e'] },
  { id: 'ho4', x: -70, z: 100, w: 12, d: 9, floors: 2, style: 'plaster', damage: 0.2, doors: ['n'] },
  { id: 'ho5', x: 72, z: 104, w: 12, d: 9, floors: 2, style: 'brick', damage: 0.1, doors: ['n'] },
  { id: 'ho6', x: 0, z: 120, w: 16, d: 10, floors: 2, style: 'plaster', damage: 0.6, doors: ['n', 's'] },
  // bases
  { id: 'hus', x: -140, z: 30, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['e', 'n'] },
  { id: 'hru', x: 140, z: 30, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['w', 'n'] },
];

function props() {
  const { P, add } = propList();
  const rnd = mulberry32(2024);
  // container yards: rows of stacks with lanes, west and east of the central road
  for (const side of [-1, 1]) {
    for (let row = 0; row < 6; row++) {
      const z = -96 + row * 13;
      for (let col = 0; col < 7; col++) {
        const x = side * (22 + col * 13.5);
        if (rnd() < 0.18) continue;                 // gaps make flanking lanes
        if (Math.hypot(x - side * 88, z + 62) < 14) continue; // keep the flag zone open
        add('container', x, z, 0);
        if (rnd() < 0.45) add('container', x, z, 0, { y: 2.6 });
      }
    }
  }
  // quay: bollard-like barriers, cargo, burnt vehicles
  for (let x = -140; x <= 140; x += 18) add('barrier2', x, -113, 0);
  add('car', -30, -104, 1, { burnt: true }); add('car', 36, -102, 1); add('crate_stack', -8, -104, 0); add('crate_stack', 12, -100, 1);
  add('sandbags', 0, -96, 0, { len: 8 }); add('sandbags', -20, -92, 1, { len: 5 }); add('sandbags', 22, -92, 1, { len: 5 });
  add('barrel', 5, -106); add('barrel', 5.7, -106.5); add('generator', -4, -96, 1);
  // warehouse row / flag D crossroads
  add('car', -8, 44, 0, { burnt: true }); add('car', 10, 36, 1); add('sandbags', 0, 50, 0, { len: 6 }); add('barrier', -12, 30, 1); add('barrier', 12, 30, 1);
  add('crate_stack', -66, 36, 0); add('crate_stack', 66, 36, 1); add('trash', 30, 52, 0); add('utility', -30, 52, 0);
  for (const x of [-110, -66, -22, 22, 66, 110]) add('lamp', x, 36, 0);
  for (const x of [-120, -60, 60, 120]) add('lamp', x, -106, 0);
  baseProps(add, bases[1], 'e'); baseProps(add, bases[2], 'w');
  return P;
}

export default {
  id: 'harbor',
  name: 'Harbor Docks',
  description: 'Container terminal on the waterfront. Tight container lanes, open quay, warehouse row — 4 flags.',
  mapHalf: 175, playHalf: 150,
  terrain: { amp: 1.2, scale: 60, detail: 0.3, edge: 10, seed: 31, flatten: 16 },
  sea: { axis: 'z', at: -118, dir: -1, depth: 6, shore: 3 },
  atmosphere: { sun: [-0.62, 0.46, 0.22], fog: 0xb4bfc7, fogNear: 50, fogFar: 0.85, exposure: 0.9, grass: [0.92, 0.95, 0.85] },
  vegetation: { seed: 77, trees: 120, shrubs: 500, rocks: 40, clusters: 3 },
  roads: [
    { ax: -175, az: -108, bx: 175, bz: -108, w: 12, name: 'quay' },
    { ax: 0, az: -108, bx: 0, bz: 175, w: 9, name: 'central' },
    { ax: -175, az: 40, bx: 175, bz: 40, w: 9, name: 'warehouse row' },
    { ax: -175, az: 88, bx: 175, bz: 88, w: 7, name: 'port road' },
    { ax: -120, az: -108, bx: -120, bz: 40, w: 7, name: 'west lane' },
    { ax: 120, az: -108, bx: 120, bz: 40, w: 7, name: 'east lane' },
  ],
  flags: [
    { id: 'A', x: -88, z: -62, r: 14, owner: 1 },
    { id: 'B', x: 0, z: -102, r: 15 },
    { id: 'C', x: 88, z: -62, r: 14, owner: 2 },
    { id: 'D', x: 0, z: 40, r: 15 },
  ],
  bases,
  buildings,
  props,
};
