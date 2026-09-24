// Map: CHECKPOINT ZULU — small walled military compound for fast close-quarters fights. 3 flags close together:
// the motor pool, the HQ courtyard inside the walls, and the fuel depot.
import { propList, baseProps } from './helpers.js';

const bases = {
  1: { x: -72, z: 70, yaw: -Math.PI / 4 },     // US: south-west corner, facing the compound
  2: { x: 72, z: -70, yaw: (3 * Math.PI) / 4 }, // RU: north-east corner
};

const buildings = [
  // inside the walls
  { id: 'zhq', x: 10, z: -6, w: 14, d: 10, floors: 2, style: 'concrete', damage: 0.25, doors: ['s', 'w', 'n'] },
  { id: 'zb1', x: -18, z: -20, w: 18, d: 9, floors: 1, style: 'warehouse', damage: 0.15, doors: ['e', 'w'] },
  { id: 'zb2', x: -14, z: 18, w: 10, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['e', 'n'] },
  { id: 'zt1', x: 26, z: 20, w: 8, d: 8, floors: 3, style: 'brick', damage: 0.4, doors: ['w'] },
  // outside: motor pool (A) and fuel depot (C)
  { id: 'zm1', x: -52, z: 22, w: 16, d: 12, floors: 1, style: 'warehouse', damage: 0.3, doors: ['e', 's'] },
  { id: 'zd1', x: 50, z: -26, w: 12, d: 10, floors: 1, style: 'plaster', damage: 0.5, doors: ['w', 'n'] },
  // bases
  { id: 'zus', x: -78, z: 52, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['e', 'n'] },
  { id: 'zru', x: 78, z: -52, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['w', 's'] },
];

function props() {
  const { P, add } = propList();
  // perimeter T-walls (40 x 40 m) with gate gaps on every side
  for (const [x, z, rot, len] of [
    [-22, -40, 0, 32], [22, -40, 0, 32], [-22, 40, 0, 32], [22, 40, 0, 32],
    [-40, -22, 1, 32], [-40, 22, 1, 32], [40, -22, 1, 32], [40, 22, 1, 32],
  ]) add('wall', x, z, rot, { len });
  // gate checkpoints
  for (const [x, z, rot] of [[0, -44, 0], [0, 44, 0], [-44, 0, 1], [44, 0, 1]]) { add('barrier', x - 1.8, z, rot); add('barrier', x + 1.8, z, rot); }
  add('sandbags', -6, 48, 0, { len: 5 }); add('sandbags', 6, -48, 0, { len: 5 }); add('sandbags', -48, -6, 1, { len: 5 }); add('sandbags', 48, 6, 1, { len: 5 });
  // courtyard
  add('container', -2, 10, 1); add('crate_stack', 6, 12, 0); add('sandbags', -6, 4, 0, { len: 4 }); add('generator', 20, 6, 0); add('barrel', 24, -18); add('barrel', 24.6, -18.6);
  add('car', 20, -26, 0, { burnt: true }); add('crate_stack', -30, 0, 1); add('utility', 32, 4, 0); add('lamp', 0, 0, 0);
  // motor pool (A)
  add('car', -60, 42, 1); add('car', -52, 44, 1, { burnt: true }); add('car', -66, 36, 0); add('container', -70, 20, 1); add('crate_stack', -40, 50, 0);
  add('sandbags', -56, 58, 0, { len: 6 }); add('barrel', -44, 30); add('generator', -46, 34, 1);
  // fuel depot (C)
  for (let i = 0; i < 6; i++) add('barrel', 52 + (i % 3) * 0.8, -48 - Math.floor(i / 3) * 0.8);
  add('container', 70, -24, 1); add('container', 58, -10, 0); add('sandbags', 56, -58, 0, { len: 6 }); add('crate_stack', 40, -52, 1); add('car', 64, -40, 1, { burnt: true });
  baseProps(add, bases[1], 'n'); baseProps(add, bases[2], 's');
  return P;
}

export default {
  id: 'compound',
  name: 'Checkpoint Zulu',
  description: 'Small walled military compound. Fast close-quarters infantry fights — 3 flags, short distances.',
  mapHalf: 112, playHalf: 92,
  terrain: { amp: 2.5, scale: 45, detail: 0.6, edge: 12, seed: 55, flatten: 12 },
  atmosphere: { sun: [-0.22, 0.86, 0.3], fog: 0xcfc8b8, fogNear: 60, fogFar: 0.7, exposure: 1.0, grass: [1.08, 0.96, 0.72] },
  vegetation: { seed: 909, trees: 90, shrubs: 380, rocks: 60, clusters: 4 },
  roads: [
    { ax: -112, az: 0, bx: 112, bz: 0, w: 7, name: 'east-west' },
    { ax: 0, az: -112, bx: 0, bz: 112, w: 7, name: 'north-south' },
    { ax: -80, az: 60, bx: -44, bz: 30, w: 5, name: 'motor pool' },
    { ax: 80, az: -60, bx: 44, bz: -30, w: 5, name: 'depot' },
  ],
  flags: [
    { id: 'A', x: -56, z: 32, r: 12, owner: 1 },
    { id: 'B', x: 2, z: 26, r: 11 },
    { id: 'C', x: 56, z: -36, r: 12, owner: 2 },
  ],
  bases,
  buildings,
  props,
};
