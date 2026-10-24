// Where each car starts in the open world (world/maps/world.js): a home suited to it, so cars of different kinds
// start in different places. The off-road trucks start at the bases in the woods, the hills and the canyon, the
// sports cars on the North Coast Highway, and the U8 on the beach (it swims). Drivers who share a home park side by
// side (core/Game.js spawnPoint). (Kept out of the world's build: world/WorldLoader.js rebuilds the maps when a
// module the generator imports changes.)
import { regionById } from './maps/world.js';
import { TRUCKS } from '../physics/trucks.js';

// each: its map, and the spot in that map's frame ({ x, z, yaw }, yaw 0 facing +z) with its name; without a spot,
// the map's own by its station
export const HOMES = {
  kashid: { region: 'coast' },
  beach: { region: 'coast', spot: { x: -1592, z: 690, yaw: -Math.PI / 2 }, name: 'Kashid Beach' },
  highway: { region: 'korlai', spot: { x: 399, z: 289, yaw: -3.064 }, name: 'the North Coast Highway' },
  bearwood: { region: 'taiga' },
  lalghati: { region: 'canyon' },
  ashwood: { region: 'ashwood' },
  pass: { region: 'pass' },
  ponmala: { region: 'kerala' },
  ghat: { region: 'ghat' },
  bhimashankar: { region: 'forest' },
  shivapur: { region: 'deccan' },
};

// the trucks' homes (a sports car's is the highway; any other the Kashid station)
const BY_CAR = {
  thar: 'kashid', u8: 'beach',
  rhino: 'bearwood', ranger: 'bearwood', hauler: 'bearwood',                 // Unimog, UAZ, K20: the logging camp
  wrangler: 'lalghati', bronco: 'lalghati', trekker: 'lalghati',             // the rock crawlers and the Raptor
  shepherd: 'ashwood', mule: 'ashwood',
  gclass: 'pass', gecko: 'pass',
  roxx: 'ponmala', drover: 'ponmala',
  bruiser: 'ghat',
  hummer: 'bhimashankar',
  hummerev: 'shivapur', cybertruck: 'shivapur',
};

/** The home of a car: its key in HOMES. */
export const homeKey = (truckId) => BY_CAR[truckId] || (TRUCKS[truckId]?.road ? 'highway' : 'kashid');

/** Where a car starts, in the world's frame: { region (its map's id), x, z, yaw, name }. */
export function homeOf(truckId) {
  const H = HOMES[homeKey(truckId)], R = regionById(H.region), M = R.map;
  const S = H.spot || M.spawn;
  return { region: H.region, x: S.x + R.at[0], z: S.z + R.at[1], yaw: S.yaw, name: H.name || M.station.name };
}

/** Whether a truck can be left at (x, z) facing yaw: dry, level, firm ground clear of trunks, posts, rocks and buildings. */
function clear(world, x, z, yaw, tmp) {
  if (world.inBounds && !world.inBounds(x, z, 8)) return false;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (f, r) => { const px = x + fx * f + c * r, pz = z + fz * f - s * r; return [px, pz, world.height(px, pz)]; };
  const corners = [at(2.3, 1.1), at(2.3, -1.1), at(-2.3, 1.1), at(-2.3, -1.1)];
  for (const [px, pz, h] of [...corners, [x, z, world.height(x, z)]]) {
    if (world.water(px, pz) > h - 0.05 || world.boulderTop(px, pz) > h + 0.05) return false;
  }
  const [a, b, d, e] = corners.map((q) => q[2]);
  if (Math.abs((a + b - d - e) / 9.2) > 0.12 || Math.abs((a + d - b - e) / 4.4) > 0.1) return false;
  if (world.surfaceAt(x, z).name === 'mud') return false;
  if (world.treesNear(x, z, 3.6, tmp).length) return false;
  return !world.landmarks.some((L) => Math.hypot(L.x - x, L.z - z) < 9);
}

/**
 * A parking bay at a home or a station's yard (spot { x, z, yaw }): of the bays round it (side by side 5.5 m apart,
 * in rows 9 m apart ahead and behind, nearest first) those a truck can be left in and none of the other drivers' trucks
 * (taken: [x, z] each) is on, the n-th (round again past the last). The spot itself when there is none.
 */
export function park(world, spot, n = 0, taken = []) {
  const c = Math.cos(spot.yaw), s = Math.sin(spot.yaw), fx = Math.sin(spot.yaw), fz = Math.cos(spot.yaw);
  const bays = [], tmp = [];
  for (let row = -2; row <= 2; row++) for (let side = -3; side <= 3; side++) bays.push([row * 9, side * 5.5]);
  bays.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
  const free = [];
  for (const [f, r] of bays) {
    const x = spot.x + fx * f + c * r, z = spot.z + fz * f - s * r;
    if (taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5) || !clear(world, x, z, spot.yaw, tmp)) continue;
    free.push({ x, z });
  }
  return free.length ? { ...spot, ...free[n % free.length] } : spot;
}
