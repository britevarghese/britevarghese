// Map: OUTSKIRTS — ruined town crossroads (B) between an industrial yard (A) and a rail depot (C).
export default {
  id: 'outskirts',
  name: 'Outskirts',
  description: 'Ruined town crossroads between an industrial yard and a depot. Mixed ranges, 3 flags.',
  mapHalf: 190, playHalf: 168,
  terrain: { amp: 9, scale: 70, detail: 1.2, edge: 16, seed: 7 },
  atmosphere: { sun: [-0.45, 0.62, 0.38], fog: 0xbac4cb, fogNear: 70, fogFar: 1, exposure: 0.95, grass: [1, 1, 1] },
  vegetation: { seed: 4242, trees: 440, shrubs: 1300, rocks: 160 },
  roads: [
  { ax: 8, az: -186, bx: 8, bz: 186, w: 9, name: 'main' },
  { ax: -186, az: 0, bx: 186, bz: 0, w: 8, name: 'cross' },
  { ax: -186, az: 78, bx: 60, bz: 78, w: 7, name: 'north-a' },
  { ax: -60, az: -78, bx: 186, bz: -78, w: 7, name: 'south-c' },
  { ax: -40, az: 78, bx: -40, bz: 130, w: 6, name: 'a-spur' },
  { ax: 40, az: -78, bx: 40, bz: -130, w: 6, name: 'c-spur' },
],
  flags: [
  { id: 'A', x: -40, z: 70, r: 13, owner: 1 },
  { id: 'B', x: 6, z: -4, r: 15 },
  { id: 'C', x: 40, z: -70, r: 13, owner: 2 },
],
  bases: {
  1: { x: 8, z: 152, yaw: 0 },         // US spawns in the south, facing north (-z)
  2: { x: 8, z: -152, yaw: Math.PI },  // RU spawns in the north, facing south (+z)
},
  buildings: [
  // Town centre (B) – partially ruined
  { id: 'b1', x: -20, z: -18, w: 12, d: 10, floors: 2, style: 'plaster', damage: 0.55, doors: ['s', 'e'] },
  { id: 'b2', x: 27, z: -17, w: 10, d: 12, floors: 3, style: 'concrete', damage: 0.3, doors: ['w', 's'] },
  { id: 'b3', x: -22, z: 19, w: 14, d: 9, floors: 2, style: 'brick', damage: 0, doors: ['n', 'e'] },
  { id: 'b4', x: 28, z: 20, w: 10, d: 10, floors: 1, style: 'plaster', damage: 0.85, doors: ['w', 'n'] },
  { id: 'b5', x: -46, z: -16, w: 9, d: 12, floors: 2, style: 'concrete', damage: 0.15, doors: ['e'] },
  { id: 'b6', x: 52, z: 13, w: 12, d: 10, floors: 2, style: 'brick', damage: 0.4, doors: ['w'] },
  { id: 'b7', x: -44, z: 22, w: 10, d: 9, floors: 1, style: 'plaster', damage: 0.2, doors: ['s'] },
  // A – industrial yard
  { id: 'w1', x: -64, z: 58, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.1, doors: ['e', 'w'] },
  { id: 'a2', x: -28, z: 95, w: 10, d: 10, floors: 2, style: 'concrete', damage: 0, doors: ['s', 'w'] },
  { id: 'a3', x: -18, z: 55, w: 8, d: 12, floors: 1, style: 'plaster', damage: 0.3, doors: ['w'] },
  { id: 'a4', x: -78, z: 98, w: 12, d: 9, floors: 2, style: 'brick', damage: 0, doors: ['e'] },
  // C – depot
  { id: 'w2', x: 64, z: -58, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.25, doors: ['e', 'w'] },
  { id: 'c2', x: 28, z: -95, w: 10, d: 10, floors: 2, style: 'concrete', damage: 0.35, doors: ['n', 'e'] },
  { id: 'c3', x: 20, z: -55, w: 8, d: 12, floors: 1, style: 'plaster', damage: 0.2, doors: ['e'] },
  { id: 'c4', x: 80, z: -98, w: 12, d: 9, floors: 2, style: 'brick', damage: 0.1, doors: ['w'] },
  // Bases
  { id: 'us1', x: -12, z: 146, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['n', 'e'] },
  { id: 'ru1', x: 28, z: -146, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
  // Outskirts (background / flanks)
  { id: 'o1', x: 110, z: 40, w: 10, d: 10, floors: 2, style: 'plaster', damage: 0.2, doors: ['w'] },
  { id: 'o2', x: -110, z: -40, w: 10, d: 10, floors: 2, style: 'plaster', damage: 0.1, doors: ['e'] },
  { id: 'o3', x: 96, z: 112, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0.5, doors: ['w'] },
  { id: 'o4', x: -96, z: -112, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0.5, doors: ['e'] },
  { id: 'o5', x: 130, z: -30, w: 9, d: 12, floors: 2, style: 'brick', damage: 0, doors: ['w'] },
  { id: 'o6', x: -130, z: 30, w: 9, d: 12, floors: 2, style: 'brick', damage: 0, doors: ['e'] },
],
  props: (BASES) => buildProps(BASES),
};

function buildProps(BASES) {
  const P = [];
  const add = (type, x, z, rot = 0, extra = {}) => P.push({ type, x, z, rot, ...extra });
  // --- B (intersection): barricades, burnt cars, sandbags
  add('car', -3, 8, 1, { burnt: true }); add('car', 18, -9, 0, { burnt: true });
  add('barrier', 0, -12, 0); add('barrier', 1.6, -12.2, 0); add('barrier2', 14, 6, 1); add('barrier2', 14, 7.7, 1);
  add('sandbags', 6, 10, 0, { len: 5 }); add('sandbags', -6, -6, 1, { len: 4 }); add('sandbags', 18, 4, 1, { len: 4 });
  add('crate_stack', -8, 3, 0); add('crate', -8.2, 5, 1); add('barrel', 20, -3); add('barrel', 20.7, -2.4);
  add('container', -14, -3, 0); add('container', 36, 3, 1);
  add('trash', -12, 11, 0); add('utility', 13.5, -13, 0); add('generator', -2, -15, 0);
  add('lamp', 13.8, -8, 0); add('lamp', 2.2, 12, 0); add('lamp', 13.8, 24, 0); add('lamp', 2.2, -26, 0);
  // --- A (industrial yard)
  add('container', -44, 60, 1); add('container', -44, 60, 1, { stackOn: true, y: 2.6 });
  add('container', -52, 84, 0); add('container', -30, 66, 0);
  add('crate_stack', -38, 64, 0); add('crate', -36.5, 63.6, 1); add('barrel', -34, 74); add('barrel', -33.4, 74.6); add('barrel', -48, 73);
  add('sandbags', -40, 82, 0, { len: 6 }); add('sandbags', -50, 70, 1, { len: 4 }); add('barrier', -26, 74, 1); add('barrier', -26, 72.4, 1);
  add('car', -58, 76, 0); add('generator', -52, 66, 1); add('utility', -76, 68, 0);
  add('lamp', -20, 81.5, 0); add('lamp', -60, 81.5, 0);
  // --- C (depot) mirrored
  add('container', 44, -60, 1); add('container', 44, -60, 1, { stackOn: true, y: 2.6 });
  add('container', 52, -84, 0); add('container', 30, -66, 0);
  add('crate_stack', 38, -64, 0); add('crate', 36.5, -63.6, 1); add('barrel', 34, -74); add('barrel', 33.4, -74.6); add('barrel', 48, -73);
  add('sandbags', 40, -82, 0, { len: 6 }); add('sandbags', 50, -70, 1, { len: 4 }); add('barrier', 26, -74, 1); add('barrier', 26, -72.4, 1);
  add('car', 58, -76, 0, { burnt: true }); add('generator', 52, -66, 1); add('utility', 76, -68, 0);
  add('lamp', 20, -81.5, 0); add('lamp', 60, -81.5, 0);
  // --- open fields between objectives: scattered cover
  add('sandbags', -18, 38, 0, { len: 5 }); add('sandbags', 22, -38, 0, { len: 5 });
  add('barrier', -30, 40, 0); add('barrier', 30, -40, 0); add('barrier2', 40, 44, 0); add('barrier2', -40, -44, 0);
  add('car', 60, 40, 1); add('car', -60, -40, 1, { burnt: true }); add('crate_stack', 70, 30, 0); add('crate_stack', -70, -30, 0);
  add('container', 90, 60, 1); add('container', -90, -60, 1); add('container', 110, -70, 0); add('container', -110, 70, 0);
  // --- bases
  for (const [t, s] of [[1, 1], [2, -1]]) {
    const bz = BASES[t].z;
    add('sandbags', -6, bz - s * 10, 0, { len: 8 }); add('sandbags', 22, bz - s * 10, 0, { len: 8 });
    add('barrier', 2.5, bz - s * 14, 0); add('barrier', 13.5, bz - s * 14, 0);
    add('crate_stack', -2, bz + s * 4, 0); add('crate_stack', 20, bz + s * 4, 1); add('generator', 24, bz + s * 1, 0);
    add('container', 32, bz + s * 6, 1); add('container', -24, bz - s * 2, 1);
    add('wall', 8, bz + s * 20, 0, { len: 60 });
    add('fence', -24, bz - s * 16, 1, { len: 30 }); add('fence', 40, bz - s * 16, 1, { len: 30 });
  }
  // street lamps along the main road
  for (let z = -140; z <= 140; z += 35) if (Math.abs(z) > 30) add('lamp', 13.8, z + 5, 0);
  return P;
}
