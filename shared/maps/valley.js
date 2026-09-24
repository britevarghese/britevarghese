// Map: DRY VALLEY — rolling hills with a winding road, a farm, a village and a fortified hilltop.
// Big elevation changes and long sightlines (recon country) — 3 flags.
import { propList, baseProps, village } from './helpers.js';

const bases = {
  1: { x: -6, z: 190, yaw: 0 },         // US: south, facing north
  2: { x: 14, z: -190, yaw: Math.PI },  // RU: north, facing south
};

// winding main road as a polyline of segments
const path = [[-6, 215], [-10, 150], [18, 90], [12, 20], [-8, -30], [-24, -90], [-6, -140], [14, 215 * -1]];
const roads = [];
for (let i = 0; i < path.length - 1; i++) roads.push({ ax: path[i][0], az: path[i][1], bx: path[i + 1][0], bz: path[i + 1][1], w: 7, name: 'valley road' });
roads.push({ ax: 18, az: 90, bx: -70, bz: 95, w: 5, name: 'farm track' }, { ax: -8, az: -30, bx: 75, bz: -80, w: 5, name: 'hill track' }, { ax: 12, az: 20, bx: 60, bz: 30, w: 5, name: 'village lane' });

const buildings = [
  // farm (A): barn + farmhouse + shed
  { id: 'vf1', x: -76, z: 76, w: 20, d: 14, floors: 1, style: 'warehouse', damage: 0.3, doors: ['e', 's'] },
  { id: 'vf2', x: -52, z: 108, w: 10, d: 9, floors: 2, style: 'plaster', damage: 0.2, doors: ['e'] },
  { id: 'vf3', x: -92, z: 104, w: 8, d: 8, floors: 1, style: 'brick', damage: 0.5, doors: ['n'] },
  // hilltop outpost (C): bunkers
  { id: 'vh1', x: 70, z: -86, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
  { id: 'vh2', x: 88, z: -70, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0.3, doors: ['w'] },
  // bases
  { id: 'vus', x: -24, z: 184, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['n', 'e'] },
  { id: 'vru', x: 32, z: -184, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
];
// village (B) around the crossroads + scattered houses along the road
village(buildings, { id: 'vv', cx: 32, cz: 8, n: 9, seed: 5, spread: 30, damage: 0.35 });
village(buildings, { id: 'vs', cx: -40, cz: -120, n: 3, seed: 9, spread: 22 });
village(buildings, { id: 'vn', cx: 70, cz: 140, n: 3, seed: 13, spread: 22 });

function props() {
  const { P, add } = propList();
  // farm yard
  add('crate_stack', -62, 82, 0); add('barrel', -64, 70); add('barrel', -64.6, 70.6); add('car', -60, 96, 1, { burnt: true }); add('trash', -86, 92, 1);
  add('sandbags', -68, 64, 0, { len: 6 }); add('sandbags', -46, 88, 1, { len: 5 }); add('generator', -84, 88, 0);
  // village
  add('car', 14, 4, 0, { burnt: true }); add('car', 40, 30, 1); add('barrier', 6, 14, 1); add('barrier', 6, 15.6, 1); add('sandbags', 24, -6, 0, { len: 6 });
  add('crate_stack', 44, 12, 0); add('utility', 20, 26, 0); add('lamp', 18, 20, 0); add('lamp', 4, -14, 0);
  // hilltop outpost trenches
  add('sandbags', 64, -72, 0, { len: 10 }); add('sandbags', 80, -94, 1, { len: 8 }); add('sandbags', 92, -82, 0, { len: 6 });
  add('barrier2', 58, -80, 1); add('barrier2', 58, -82, 1); add('crate_stack', 76, -76, 0); add('ammo', 77, -74, 0.4);
  // roadside cover
  add('car', -14, 60, 0, { burnt: true }); add('car', -18, -60, 1); add('barrier', 12, 120, 0); add('barrier', -20, -150, 0);
  baseProps(add, bases[1], 'n'); baseProps(add, bases[2], 's');
  return P;
}

export default {
  id: 'valley',
  name: 'Dry Valley',
  description: 'Rolling hills, a winding road, a farm, a village and a fortified hilltop. Long sightlines — 3 flags.',
  mapHalf: 215, playHalf: 192,
  terrain: { amp: 7, scale: 60, detail: 1.4, edge: 24, seed: 91, flatten: 16, baseAmp: 42, baseScale: 240 },
  atmosphere: { sun: [0.62, 0.34, -0.3], fog: 0xcdc2ad, fogNear: 80, fogFar: 1.1, exposure: 1.0, grass: [1.05, 0.98, 0.8] },
  vegetation: { seed: 505, trees: 700, shrubs: 1700, rocks: 260, clusters: 7, dead: 0.1 },
  roads,
  flags: [
    { id: 'A', x: -66, z: 92, r: 15, owner: 1 },
    { id: 'B', x: 26, z: 10, r: 16 },
    { id: 'C', x: 76, z: -80, r: 14, owner: 2 },
  ],
  bases,
  buildings,
  props,
};
