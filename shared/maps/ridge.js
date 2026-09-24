// Map: KASKAR RIDGE — a mountain pass: the road climbs through a gorge between a hill village (A), a quarry (B) and a
// fortified ridge line (C). Big height differences and long sightlines — recon country, 3 flags.
import { propList, baseProps, village } from './helpers.js';

const bases = {
  1: { x: -170, z: 150, yaw: -Math.PI / 4 },    // US: south-west
  2: { x: 170, z: -150, yaw: (3 * Math.PI) / 4 }, // RU: north-east
};

const path = [[-190, 170], [-130, 110], [-70, 80], [-20, 20], [30, -30], [80, -70], [130, -110], [190, -170]];
const roads = [];
for (let i = 0; i < path.length - 1; i++) roads.push({ ax: path[i][0], az: path[i][1], bx: path[i + 1][0], bz: path[i + 1][1], w: 7, name: 'pass road' });
roads.push({ ax: -70, az: 80, bx: -110, bz: -40, w: 5, name: 'village track' }, { ax: 30, az: -30, bx: 110, bz: 50, w: 6, name: 'quarry road' });

const buildings = [
  // B: quarry works
  { id: 'rq1', x: 112, z: 58, w: 22, d: 14, floors: 1, style: 'warehouse', damage: 0.3, doors: ['w', 's'] },
  { id: 'rq2', x: 88, z: 76, w: 9, d: 8, floors: 2, style: 'concrete', damage: 0.2, doors: ['s'] },
  // C: ridge fortifications
  { id: 'rc1', x: -12, z: -96, w: 10, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'e'] },
  { id: 'rc2', x: 18, z: -112, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0.2, doors: ['s'] },
  { id: 'rc3', x: -40, z: -110, w: 8, d: 8, floors: 2, style: 'concrete', damage: 0.4, doors: ['e'] },
  // bases
  { id: 'rus', x: -186, z: 128, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['n', 'e'] },
  { id: 'rru', x: 186, z: -128, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
];
// A: hill village (stone houses), plus a roadside hamlet in the gorge
village(buildings, { id: 'rv', cx: -110, cz: -40, n: 8, seed: 41, spread: 28, styles: ['brick', 'plaster'], damage: 0.3, avoid: { roads } });
village(buildings, { id: 'rg', cx: 10, cz: 30, n: 3, seed: 42, spread: 16, styles: ['plaster', 'concrete'], damage: 0.5, avoid: { roads } });

function props() {
  const { P, add } = propList();
  // quarry: rock-crusher yard, containers, trucks
  add('container', 130, 40, 1); add('container', 132, 76, 0); add('crate_stack', 100, 40, 0); add('generator', 120, 80, 0);
  add('car', 96, 50, 1, { burnt: true }); add('barrel', 140, 60); add('barrel', 140.7, 60.6); add('fence', 150, 58, 1, { len: 50 });
  // ridge: trench line and MG nests
  add('sandbags', -20, -84, 0, { len: 14 }); add('sandbags', 12, -96, 0, { len: 12 }); add('sandbags', 40, -100, 1, { len: 10 });
  add('sandbags', -48, -94, 1, { len: 8 }); add('crate_stack', 2, -120, 0); add('ammo', 3.2, -118.8, 0.4); add('barrier2', -30, -80, 0); add('barrier2', -28, -80, 0);
  // village: carts and walls
  add('car', -96, -20, 0); add('crate_stack', -122, -52, 1); add('wall', -110, -80, 0, { len: 40 }); add('trash', -130, -30, 0);
  // gorge road: wrecked convoy
  add('car', -44, 50, 1, { burnt: true }); add('car', -36, 42, 1, { burnt: true }); add('container', 56, -52, 1); add('barrier', 0, 0, 1); add('barrier', 4, -4, 1);
  baseProps(add, bases[1], 'n'); baseProps(add, bases[2], 's');
  return P;
}

export default {
  id: 'ridge',
  name: 'Kaskar Ridge',
  description: 'Mountain pass: hill village, quarry and a fortified ridge line above a winding gorge road — long sightlines, 3 flags.',
  mapHalf: 225, playHalf: 200,
  terrain: { amp: 16, scale: 55, detail: 1.8, edge: 40, seed: 919, flatten: 14, baseAmp: 70, baseScale: 170 },
  atmosphere: { sun: [0.3, 0.38, 0.6], fog: 0xb8c0c6, fogNear: 90, fogFar: 1.2, exposure: 1.02, grass: [0.92, 1.0, 0.82] },
  vegetation: { seed: 9191, trees: 900, shrubs: 1900, rocks: 480, clusters: 8, dead: 0.06 },
  roads,
  flags: [
    { id: 'A', x: -108, z: -36, r: 16, owner: 1 },
    { id: 'B', x: 108, z: 62, r: 16, owner: 2 },
    { id: 'C', x: -4, z: -100, r: 15 },
  ],
  bases,
  buildings,
  props,
};
