// Map: KESTREL AIRBASE — an abandoned military airfield: a long runway, hangar row (A), control tower (B),
// fuel depot (C) and a radar hill (D). Wide open ground between concrete — 4 flags.
import { propList, baseProps, village } from './helpers.js';

const bases = {
  1: { x: -20, z: 205, yaw: 0 },          // US: south, facing north
  2: { x: 20, z: -205, yaw: Math.PI },    // RU: north, facing south
};

const roads = [
  { ax: -225, az: 10, bx: 225, bz: 10, w: 30, name: 'runway' },
  { ax: -170, az: -40, bx: 170, bz: -40, w: 12, name: 'taxiway' },
  { ax: -120, az: 10, bx: -120, bz: -40, w: 12, name: 'link west' },
  { ax: 120, az: 10, bx: 120, bz: -40, w: 12, name: 'link east' },
  { ax: -20, az: 225, bx: -20, bz: 25, w: 8, name: 'south gate road' },
  { ax: 20, az: -225, bx: 20, bz: -45, w: 8, name: 'north gate road' },
  { ax: 20, az: -95, bx: 150, bz: -120, w: 6, name: 'depot road' },
  { ax: -20, az: 110, bx: -150, bz: 130, w: 6, name: 'radar road' },
];

const buildings = [
  // A: hangar row on the west apron
  { id: 'ah1', x: -150, z: -70, w: 30, d: 22, floors: 1, style: 'warehouse', damage: 0.2, doors: ['n', 's'] },
  { id: 'ah2', x: -112, z: -70, w: 30, d: 22, floors: 1, style: 'warehouse', damage: 0.5, doors: ['s', 'e'] },
  { id: 'ah3', x: -186, z: -64, w: 12, d: 10, floors: 2, style: 'concrete', damage: 0.1, doors: ['s'] },
  // B: control tower + terminal
  { id: 'at1', x: 6, z: -66, w: 9, d: 9, floors: 4, style: 'concrete', damage: 0.25, doors: ['s', 'e'] },
  { id: 'at2', x: 30, z: -70, w: 22, d: 12, floors: 2, style: 'plaster', damage: 0.35, doors: ['s', 'w'] },
  { id: 'at3', x: -24, z: -72, w: 12, d: 10, floors: 1, style: 'brick', damage: 0.6, doors: ['e', 's'] },
  // C: fuel depot (east)
  { id: 'af1', x: 150, z: -110, w: 18, d: 12, floors: 1, style: 'warehouse', damage: 0, doors: ['w'] },
  { id: 'af2', x: 176, z: -134, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['w', 'n'] },
  // D: radar hill (south-west)
  { id: 'ar1', x: -152, z: 132, w: 10, d: 9, floors: 1, style: 'bunker', damage: 0, doors: ['e', 'n'] },
  { id: 'ar2', x: -172, z: 150, w: 9, d: 8, floors: 2, style: 'concrete', damage: 0.3, doors: ['e'] },
  // bases
  { id: 'aus', x: -44, z: 198, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['n', 'e'] },
  { id: 'aru', x: 44, z: -198, w: 9, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
];
// barracks blocks behind the terminal and near the south gate
village(buildings, { id: 'abk', cx: 70, cz: -150, n: 4, seed: 31, spread: 26, styles: ['concrete', 'brick'], avoid: { roads } });
village(buildings, { id: 'abs', cx: 40, cz: 130, n: 4, seed: 32, spread: 30, styles: ['concrete', 'plaster'], damage: 0.4, avoid: { roads } });

function props() {
  const { P, add } = propList();
  // hangar apron: parked cargo, crates, fuel carts
  for (let i = 0; i < 4; i++) add('container', -170 + i * 16, -40 - 14, 0);
  add('crate_stack', -130, -52, 0); add('crate_stack', -96, -52, 1); add('barrel', -140, -50); add('barrel', -140.6, -50.8); add('generator', -104, -48, 0);
  add('car', -160, -90, 1, { burnt: true }); add('trash', -122, -92, 0);
  // tower: sandbag ring and barriers
  add('sandbags', 6, -40, 0, { len: 10 }); add('sandbags', -8, -58, 1, { len: 8 }); add('barrier2', 20, -54, 0); add('barrier2', 22, -54, 0);
  add('car', 44, -52, 0); add('car', -40, -56, 1, { burnt: true });
  // fuel depot: tank farm (containers stand in for tanks), fences
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) add('barrel', 132 + i * 3, -128 + j * 3);
  add('container', 160, -92, 1); add('container', 190, -110, 0); add('fence', 170, -150, 0, { len: 50 }); add('fence', 196, -125, 1, { len: 40 });
  add('sandbags', 140, -96, 0, { len: 8 });
  // radar hill: trenches
  add('sandbags', -140, 120, 0, { len: 12 }); add('sandbags', -164, 116, 1, { len: 10 }); add('crate_stack', -146, 146, 0); add('ammo', -144.8, 146.6, 0.5);
  // runway: wrecks and cover in the open
  add('car', -60, 14, 0, { burnt: true }); add('car', 70, 4, 1, { burnt: true }); add('container', 0, 18, 0); add('container', 130, 20, 0);
  add('barrier', -30, 2, 0); add('barrier', -28.4, 2, 0); add('barrier', 40, 18, 0); add('crate_stack', 100, -8, 0); add('crate_stack', -100, 26, 0);
  for (let x = -200; x <= 200; x += 40) { add('lamp', x, -8, 0); add('lamp', x + 20, 28, 0); }
  baseProps(add, bases[1], 'n'); baseProps(add, bases[2], 's');
  return P;
}

export default {
  id: 'airfield',
  name: 'Kestrel Airbase',
  description: 'Abandoned airfield: hangars, control tower, fuel depot and radar hill around a long open runway — 4 flags.',
  mapHalf: 260, playHalf: 232,
  terrain: { amp: 5, scale: 90, detail: 1.0, edge: 26, seed: 212, flatten: 26, baseAmp: 14, baseScale: 260 },
  atmosphere: { sun: [0.5, 0.52, 0.35], fog: 0xc4c9c6, fogNear: 90, fogFar: 1.1, exposure: 1.0, grass: [1.02, 1.0, 0.85] },
  vegetation: { seed: 2121, trees: 420, shrubs: 1400, rocks: 200, clusters: 6, dead: 0.12 },
  roads,
  flags: [
    { id: 'A', x: -130, z: -66, r: 16 },
    { id: 'B', x: 8, z: -52, r: 15 },
    { id: 'C', x: 160, z: -118, r: 15, owner: 2 },
    { id: 'D', x: -154, z: 138, r: 14, owner: 1 },
  ],
  bases,
  buildings,
  props,
};
