// Deliveries: a load to haul from one place in the open world to another, for pay (game/Delivery.js plays them).
//
// The loads are what these places really move, in the units they move in:
//   cement in 50 kg bags, the Indian standard bag (IS 11652:2017 is the standard for the woven sacks of 50 kg cement);
//   cooking gas in the 14.2 kg domestic cylinder, 29.7 kg full (Indian Oil: about 15.5 kg empty);
//   diesel in 200-litre drums, 189 kg full (a steel drum about 22 kg empty, diesel 0.82-0.845 kg/l: EN 590);
//   tea in paper sacks of about 35 kg (IS 15576 sizes tea sacks at about 50, 35 and 28 kg).
// What hurts each: hard jolts in the bed (paper and woven sacks split, a bag bursts; steel cylinders and drums shrug
// most of it off), and water: cement and tea soaked in a ford deeper than the bed floor are ruined.
//
// A job's places are a map's station (map.station, always known) or one of a map's landmarks (map.landmarks: its
// lighthouse, fort, tea factory, fire tower, mine), in the world from the maps' own definitions, so a job is known
// before its maps are built. km: the way by road and trail (the satnav's, measured over the whole world; where it found
// no road, 1.3 times the straight line). The pay: $150, $120 a km and $0.25 a kg-km, to the nearest $10.
import { REGIONS } from '../world/maps/world.js';

export const CARGO = {
  cement: { name: 'cement', unit: 'bag', units: 'bags', each: 50, jolt: 1, wet: true, icon: 'box' },
  gas: { name: 'cooking gas', unit: 'cylinder', units: 'cylinders', each: 29.7, jolt: 0.3, wet: false, icon: 'fuel' },
  diesel: { name: 'diesel', unit: 'drum', units: 'drums', each: 189, jolt: 0.25, wet: false, icon: 'fuel' },
  tea: { name: 'tea', unit: 'sack', units: 'sacks', each: 35, jolt: 0.7, wet: true, icon: 'box' },
};

/** The places' names where a map's landmark has none of its own. */
const LANDMARK_NAME = { lighthouse: 'Korlai Lighthouse', fort: 'Korlai Fort', teafactory: 'Ponmala Tea Factory', firetower: 'Ashwood Fire Tower', mine: 'Ashwood Old Mine' };
/** How close to a place a truck must stop to load or unload (a fort's walls and a lighthouse's rocks keep it off the middle). */
const RADIUS = { station: 30, lighthouse: 45, fort: 70, teafactory: 40, firetower: 35, mine: 40 };

export const JOBS = [
  { id: 'fort-cement', title: 'Cement for Korlai Fort', from: { station: 'coast' }, to: { region: 'korlai', type: 'fort' }, cargo: 'cement', count: 8, km: 6.0,
    desc: 'The fort\'s walls are being repointed. Eight bags from the Kashid yard up the coast to the fort: keep them dry in the fords.' },
  { id: 'lighthouse-diesel', title: 'Diesel for the lighthouse', from: { station: 'korlai' }, to: { region: 'korlai', type: 'lighthouse' }, cargo: 'diesel', count: 2, km: 1.7,
    desc: 'The lighthouse\'s standby generator needs filling. Two drums out along the headland from the bazaar.' },
  { id: 'dhaba-gas', title: 'Gas for Ghat Dhaba', from: { station: 'coast' }, to: { station: 'ghat' }, cargo: 'gas', count: 12, km: 11.5,
    desc: 'The dhaba up the ghat has run out of cooking gas. Twelve cylinders from the coast, up the hairpins.' },
  { id: 'tea-coast', title: 'Ponmala tea to the coast', from: { region: 'kerala', type: 'teafactory' }, to: { station: 'coast' }, cargo: 'tea', count: 12, km: 15.6,
    desc: 'The estate\'s first flush, down off the hills, over the ghat and along the coast road to Kashid. Paper sacks: go gently, and stay out of deep water.' },
  { id: 'tea-dhaba', title: 'Tea for Ghat Dhaba', from: { region: 'kerala', type: 'teafactory' }, to: { station: 'ghat' }, cargo: 'tea', count: 6, km: 4.1,
    desc: 'Six sacks from the estate\'s factory to the dhaba at the top of the ghat.' },
  { id: 'firetower-diesel', title: 'Diesel for the fire tower', from: { station: 'ashwood' }, to: { region: 'ashwood', type: 'firetower' }, cargo: 'diesel', count: 1, km: 1.1,
    desc: 'One drum up the ridge trail to the fire tower\'s generator. Short, and steep.' },
  { id: 'mine-diesel', title: 'Diesel for the old mine', from: { station: 'ashwood' }, to: { region: 'ashwood', type: 'mine' }, cargo: 'diesel', count: 2, km: 1.4,
    desc: 'The pumps at the old mine keep the workings dry. Two drums along the ridge road.' },
  { id: 'forest-cement', title: 'Cement for the forest station', from: { station: 'deccan' }, to: { station: 'kerala' }, cargo: 'cement', count: 10, km: 2.7,
    desc: 'Ten bags from Shivapur for the new garage at Ponmala Forest Station: half a tonne on the springs.' },
  { id: 'canyon-gas', title: 'Gas for Lalghati Base', from: { station: 'taiga' }, to: { station: 'canyon' }, cargo: 'gas', count: 8, km: 1.9,
    desc: 'Eight cylinders from the timber camp across to the canyon base.' },
  { id: 'pass-diesel', title: 'Diesel for the Pass Hut', from: { station: 'glen' }, to: { station: 'pass' }, cargo: 'diesel', count: 2, km: 5.3,
    desc: 'Two drums from the dam up to the hut on the pass, into the snow.' },
];

const REGION = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

/** A job's place, in the world: { x, z, name, r (how close to stop), region }. */
export function placeOf(p) {
  const R = REGION[p.station || p.region];
  if (!R) return null;
  if (p.station) {
    const s = R.map.station;
    return s ? { x: s.x + R.at[0], z: s.z + R.at[1], name: s.name, r: RADIUS.station, region: R.id } : null;
  }
  const L = (R.map.landmarks || []).find((q) => q.type === p.type);
  return L ? { x: L.x + R.at[0], z: L.z + R.at[1], name: LANDMARK_NAME[p.type] || `${R.map.name} ${p.type}`, r: RADIUS[p.type] || 35, region: R.id } : null;
}

/** A job's load: { m (kg), kind, count, cargo }. */
export function loadOf(job) {
  const c = CARGO[job.cargo];
  return { m: Math.round(c.each * job.count), kind: job.cargo, count: job.count, cargo: c };
}

/** What a job pays, done with its load whole. */
export function payOf(job) {
  const m = loadOf(job).m;
  return Math.round((150 + 120 * job.km + 0.25 * m * job.km) / 10) * 10;
}

/** A friend's load from their state ("cement:8", net/NetClient.js): { m, kind, count } for truckSpec, or null. */
export function cargoOf(load) {
  const [kind, n] = typeof load === 'string' ? load.split(':') : [], c = CARGO[kind], count = Number(n);
  return c && Number.isInteger(count) && count >= 1 && count <= 30 ? { m: Math.round(c.each * count), kind, count } : null;
}

/** "8 bags of cement (400 kg)". */
export function loadText(job) {
  const L = loadOf(job), c = L.cargo;
  return `${L.count} ${L.count === 1 ? c.unit : c.units} of ${c.name} (${L.m} kg)`;
}
