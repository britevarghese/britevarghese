// Map: FIRESTORM — big open battle royale island of towns, farms, an industrial yard and a military base,
// linked by country roads. No flags: squads drop in from a transport plane, loot, and survive the ring of fire.
import { propList, village } from './helpers.js';

const pois = {
  town: { x: 10, z: 20 },
  north: { x: 30, z: -300 },
  farm: { x: -260, z: -230 },
  yard: { x: 270, z: -240 },
  base: { x: 255, z: 245 },
  hamlet: { x: -265, z: 235 },
  radio: { x: -330, z: -10 },
  checkpoint: { x: 330, z: 15 },
  south: { x: -30, z: 320 },
};

// bases are only used to flatten terrain and keep vegetation off the two big compounds
const bases = {
  1: { x: pois.base.x, z: pois.base.z, yaw: 0 },
  2: { x: pois.yard.x, z: pois.yard.z, yaw: Math.PI },
};

const R = (a, b, w = 7, name = 'road') => ({ ax: a[0], az: a[1], bx: b[0], bz: b[1], w, name });
const P = (k) => [pois[k].x, pois[k].z];
const roads = [
  // main cross through the town
  R(P('radio'), [-120, 10]), R([-120, 10], P('town')), R(P('town'), [150, 25]), R([150, 25], P('checkpoint')),
  R(P('north'), [20, -140]), R([20, -140], P('town')), R(P('town'), [-10, 170]), R([-10, 170], P('south')),
  // country lanes to the corners
  R(P('farm'), [-140, -120], 5, 'lane'), R([-140, -120], [-40, -20], 5, 'lane'),
  R(P('yard'), [160, -130], 6, 'lane'), R([160, -130], [60, -20], 6, 'lane'),
  R(P('base'), [150, 150], 6, 'lane'), R([150, 150], [60, 70], 6, 'lane'),
  R(P('hamlet'), [-150, 150], 5, 'lane'), R([-150, 150], [-50, 70], 5, 'lane'),
  R(P('north'), [150, -270], 5, 'lane'), R([150, -270], P('yard'), 5, 'lane'),
  R(P('south'), [130, 300], 5, 'lane'), R([130, 300], P('base'), 5, 'lane'),
];

const buildings = [
  // town centre: a few taller blocks around the square
  { id: 'ft1', x: -14, z: -8, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0.3, doors: ['s', 'e'] },
  { id: 'ft2', x: 34, z: -6, w: 11, d: 10, floors: 3, style: 'plaster', damage: 0, doors: ['s'] },
  { id: 'ft3', x: -16, z: 46, w: 12, d: 11, floors: 2, style: 'brick', damage: 0.5, doors: ['n'] },
  { id: 'ft4', x: 36, z: 48, w: 10, d: 10, floors: 2, style: 'plaster', damage: 0.2, doors: ['n', 'w'] },
  // industrial yard
  { id: 'fy1', x: 250, z: -262, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.2, doors: ['s', 'e'] },
  { id: 'fy2', x: 292, z: -216, w: 20, d: 14, floors: 1, style: 'warehouse', damage: 0, doors: ['w', 'n'] },
  { id: 'fy3', x: 246, z: -212, w: 10, d: 9, floors: 2, style: 'concrete', damage: 0.3, doors: ['e'] },
  // military base
  { id: 'fb1', x: 238, z: 232, w: 14, d: 9, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'e'] },
  { id: 'fb2', x: 272, z: 230, w: 10, d: 8, floors: 1, style: 'bunker', damage: 0.3, doors: ['s'] },
  { id: 'fb3', x: 236, z: 266, w: 12, d: 10, floors: 2, style: 'concrete', damage: 0, doors: ['n', 'e'] },
  { id: 'fb4', x: 276, z: 268, w: 18, d: 12, floors: 1, style: 'warehouse', damage: 0, doors: ['w'] },
  // farm
  { id: 'ff1', x: -272, z: -250, w: 20, d: 14, floors: 1, style: 'warehouse', damage: 0.4, doors: ['e', 's'] },
  { id: 'ff2', x: -236, z: -214, w: 10, d: 9, floors: 2, style: 'plaster', damage: 0.2, doors: ['e'] },
  // radio station on the western hill
  { id: 'fr1', x: -336, z: -24, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['e'] },
  { id: 'fr2', x: -318, z: 8, w: 11, d: 9, floors: 2, style: 'concrete', damage: 0.3, doors: ['n', 'e'] },
  // checkpoint east
  { id: 'fc1', x: 322, z: -2, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0.2, doors: ['w', 's'] },
];
village(buildings, { id: 'ftv', cx: 10, cz: 20, n: 12, seed: 71, spread: 70, damage: 0.35, avoid: { roads } });
village(buildings, { id: 'fnv', cx: pois.north.x, cz: pois.north.z, n: 8, seed: 72, spread: 40, avoid: { roads } });
village(buildings, { id: 'fsv', cx: pois.south.x, cz: pois.south.z, n: 7, seed: 73, spread: 38, damage: 0.4, avoid: { roads } });
village(buildings, { id: 'fhv', cx: pois.hamlet.x, cz: pois.hamlet.z, n: 6, seed: 74, spread: 34, avoid: { roads } });
village(buildings, { id: 'ffv', cx: -228, cz: -262, n: 3, seed: 75, spread: 18, avoid: { roads } });
village(buildings, { id: 'fcv', cx: 348, cz: 40, n: 3, seed: 76, spread: 20, styles: ['concrete', 'brick'], avoid: { roads } });
village(buildings, { id: 'fwv', cx: -150, cz: 90, n: 3, seed: 77, spread: 24, avoid: { roads } });
village(buildings, { id: 'fev', cx: 160, cz: -60, n: 3, seed: 78, spread: 24, avoid: { roads } });
village(buildings, { id: 'fmv', cx: -110, cz: -310, n: 4, seed: 79, spread: 26, avoid: { roads } });
village(buildings, { id: 'fov', cx: 140, cz: 330, n: 4, seed: 80, spread: 26, avoid: { roads } });
village(buildings, { id: 'fkv', cx: -190, cz: -40, n: 3, seed: 81, spread: 22, avoid: { roads } });

function props() {
  const { P: list, add } = propList();
  // town square
  add('car', 8, 18, 0, { burnt: true }); add('car', -2, 30, 1); add('barrier', 16, 4, 1); add('barrier', 16, 5.6, 1);
  add('sandbags', 4, -18, 0, { len: 8 }); add('crate_stack', 22, 32, 0); add('lamp', 0, 10, 0); add('lamp', 24, 10, 0); add('utility', 44, 22, 0);
  // industrial yard: container stacks and a fenced lot
  for (let i = 0; i < 6; i++) add('container', 214 + (i % 3) * 7, -250 + Math.floor(i / 3) * 16, 1);
  add('container', 300, -262, 0); add('container', 300, -259.5, 0); add('barrel', 272, -236); add('barrel', 272.6, -236.7); add('generator', 262, -232, 0);
  add('fence', 270, -290, 0, { len: 60 }); add('crate_stack', 230, -226, 0); add('trash', 284, -236, 1);
  // military base: perimeter wall, sandbag positions, barriers
  add('wall', 256, 206, 0, { len: 70 }); add('wall', 256, 292, 0, { len: 70 }); add('wall', 214, 249, 1, { len: 70 });
  add('sandbags', 254, 216, 0, { len: 10 }); add('sandbags', 296, 248, 1, { len: 10 }); add('barrier2', 300, 224, 1); add('barrier2', 300, 226, 1);
  add('crate_stack', 256, 250, 0); add('ammo', 257, 252, 0.4); add('container', 290, 286, 0);
  // farm
  add('crate_stack', -250, -236, 0); add('barrel', -256, -226); add('car', -244, -270, 1, { burnt: true }); add('generator', -262, -228, 0);
  // radio station
  add('sandbags', -326, -40, 0, { len: 8 }); add('utility', -330, 4, 0); add('lamp', -345, -8, 0); add('generator', -324, -18, 0);
  // checkpoint
  add('barrier', 316, 14, 0); add('barrier', 316, 22, 0); add('sandbags', 330, 28, 0, { len: 6 }); add('car', 338, 8, 1);
  // roadside wrecks
  add('car', -80, 12, 0, { burnt: true }); add('car', 90, 22, 0); add('car', 20, -200, 1, { burnt: true }); add('car', -4, 240, 1);
  add('car', -190, -170, 1); add('car', 200, 180, 0, { burnt: true }); add('car', 210, -180, 1);
  return list;
}

export default {
  id: 'firestorm',
  name: 'Firestorm Island',
  mode: 'royale',
  description: 'Battle royale: jump from the plane, loot weapons, armor and med kits, outrun the ring of fire. Last one standing wins.',
  mapHalf: 450, playHalf: 420,
  terrain: { amp: 10, scale: 85, detail: 1.3, edge: 30, seed: 404, flatten: 18, baseAmp: 34, baseScale: 280 },
  atmosphere: { sun: [0.5, 0.42, 0.28], fog: 0xc9c1b0, fogNear: 90, fogFar: 1.15, exposure: 1.0, grass: [1.0, 1.0, 0.86] },
  vegetation: { seed: 909, trees: 1500, shrubs: 3200, rocks: 420, clusters: 7, dead: 0.09 },
  roads,
  flags: [],
  bases,
  buildings,
  props,
  pois,
};
