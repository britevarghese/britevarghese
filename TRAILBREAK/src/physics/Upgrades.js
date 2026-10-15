// The garage: upgrades for the trucks, and what each one does to the physics.
//
// A build is a choice per category (a small object, or a 14-character code for storage and the network).
// buildSpec(base, build) turns a truck's stock spec (trucks.js) into the spec the physics drives: tyre size and
// tread, wheel weight and inertia, ride height and suspension travel, the new centre of gravity and inertia from
// every part's weight and where it sits, gearing, differentials, engine, air intake height, winch, armour.
//
// Units follow the trade: lifts and tyres in inches, pressure in psi; the physics works in SI.

import { DEFAULT_TYRE } from './Tire.js';
import { SURFACE } from './Surfaces.js';
import { torqueAt } from './Drivetrain.js';

const IN = 0.0254;
const G = 9.81;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------------------------------------------------------------- parts
/** Light truck tyres: overall diameter (in), section width, mounted weight with a steel wheel, rotating inertia. */
export const TYRES = {
  30: { d: 30, label: '30x9.5R15', radius: 15 * IN, width: 0.241, mass: 31, inertia: 2.2 },
  31: { d: 31, label: '31x10.5R15', radius: 15.5 * IN, width: 0.267, mass: 34, inertia: 2.6 },
  33: { d: 33, label: '33x12.5R15', radius: 16.5 * IN, width: 0.318, mass: 40, inertia: 3.5 },
  35: { d: 35, label: '35x12.5R15', radius: 17.5 * IN, width: 0.318, mass: 47, inertia: 4.7 },
  37: { d: 37, label: '37x12.5R17', radius: 18.5 * IN, width: 0.318, mass: 53, inertia: 6.0 },
};
export const TYRE_SIZES = [30, 31, 33, 35, 37];

/** Tread patterns: grip by surface relative to an all-terrain, rolling resistance, road noise. */
export const TREADS = [
  { name: 'All-terrain', short: 'A/T', desc: 'The all-rounder: quiet on the road, decent everywhere.', grip: {}, rr: 1, noise: 0.25 },
  {
    name: 'Mud-terrain', short: 'M/T', desc: 'Big lugs and open voids that clean themselves in mud. Hums on the road, slides a little sooner on rock.',
    grip: { mud: 1.14, snow: 1.06, sand: 1.04, grass: 1.05, riverbed: 1.05, rock: 0.97, road: 0.94, dirt: 0.99, gravel: 1.0, ice: 0.9 }, rr: 1.08, noise: 0.7,
  },
  {
    name: 'Bias-ply mud tyre', short: 'MUD', desc: 'Tall paddle lugs on a stiff bias-ply carcass: the king of the bog, poor on rock and tarmac.',
    grip: { mud: 1.25, snow: 1.07, sand: 0.98, grass: 1.1, riverbed: 1.08, rock: 0.9, road: 0.84, dirt: 0.95, gravel: 0.95, ice: 0.8 }, rr: 1.16, noise: 1, stiff: 1.12,
  },
];

export const LIFTS = [
  { name: 'Stock suspension', short: 'stock', inches: 0, lift: 0, travel: 0, rate: 1, damp: 1, mass: 0, desc: 'Factory springs and shocks.' },
  { name: '2" lift: springs and shocks', short: '2"', inches: 2, lift: 2 * IN, travel: 0.02, rate: 1.05, damp: 1.05, mass: 16, desc: 'Room for a size bigger tyre, a little more ground clearance.' },
  { name: '4" lift: springs, shocks, extended lines', short: '4"', inches: 4, lift: 4 * IN, travel: 0.05, rate: 1, damp: 1.1, mass: 32, desc: 'Clears 35s. The centre of gravity rises with it.' },
  { name: '6" long-travel: soft springs, remote-reservoir shocks', short: '6" LT', inches: 6, lift: 6 * IN, travel: 0.11, rate: 0.82, damp: 1.25, mass: 50, desc: 'Huge articulation and 37s. Soft and tall: mind the side slopes.' },
];

export const WHEELS = [
  { name: 'Steel wheels', short: 'steel', desc: 'Air down to 14 psi; air back up only at the station.', beadlock: false, compressor: false, minPsi: 14, mass: 0 },
  { name: 'Steel wheels + onboard air', short: 'steel + air', desc: 'A compressor under the bonnet: air back up anywhere.', beadlock: false, compressor: true, minPsi: 14, mass: 9 },
  { name: 'Beadlocks + onboard air', short: 'beadlocks', desc: 'Rings bolt the bead to the rim: crawl at 6 psi without rolling a tyre off.', beadlock: true, compressor: true, minPsi: 6, mass: 9, wheelMass: 3 },
];

export const AXLE_RATIOS = [3.54, 4.10, 4.56, 5.13, 5.38];

export const TCASES = [
  { name: 'Stock transfer case', short: 'stock', desc: 'Two speeds: high, and a low range for the hard stuff.', low: null },
  { name: '4:1 crawl box', short: '4:1', desc: 'A 4:1 low range: creep up ledges at walking pace with the engine barely above idle.', low: 4.0, mass: 18 },
];

export const DIFFS = [
  { name: 'Open differentials', short: 'open', desc: 'Stock. Power goes to the wheel with the least grip.', front: 'open', rear: 'open' },
  { name: 'Rear limited-slip', short: 'LSD', desc: 'Clutches in the rear diff push some torque to the wheel with grip. Always on, no button.', front: 'open', rear: 'lsd' },
  { name: 'Rear selectable locker', short: 'R lock', desc: 'Lock the rear axle solid on demand (X).', front: 'open', rear: 'locker', mass: 4 },
  { name: 'Front and rear lockers', short: 'F+R lock', desc: 'Both axles lock on demand. Unlock to turn.', front: 'locker', rear: 'locker', mass: 9 },
];

export const TRANSMISSIONS = [
  { name: '3-speed automatic', short: 'auto', type: 'auto', gears: [2.46, 1.46, 1.0], reverse: 2.18, desc: 'Torque converter: creeps at idle, multiplies torque from a stop.' },
  { name: '3-speed manual', short: '3-spd', type: 'manual', gears: [2.99, 1.75, 1.0], reverse: 3.17, desc: 'Clutch and three ratios. Holds the truck back downhill.' },
  { name: '4-speed manual, granny low', short: '4-spd', type: 'manual', gears: [6.55, 3.58, 1.7, 1.0], reverse: 6.09, desc: 'A 6.55:1 first gear: crawls in high range, starts in second on the road.' },
];

export const INTAKES = [
  { name: 'Stock air cleaner', short: 'stock', desc: 'Breathes from under the bonnet: water over it stops the engine. Ford slowly, or the bow wave gets there first.' },
  { name: 'Snorkel', short: 'snorkel', desc: 'A raised intake up the windscreen pillar: ford water nearly to the roof.', mass: 4 },
];

export const WINCHES = [
  { name: '9,500 lb winch, steel cable', short: '9.5k steel', desc: '42 kN of pull, 30 m of steel cable.', stallPull: 42000, lineSpeed: 0.5, maxLen: 30, stiffness: 150000, damping: 10000, breakLoad: 90000, mass: 0 },
  { name: '12,000 lb winch, synthetic rope', short: '12k synthetic', desc: '53 kN of pull and 38 m of light, stretchy rope.', stallPull: 53000, lineSpeed: 0.46, maxLen: 38, stiffness: 95000, damping: 8000, breakLoad: 110000, mass: 6, synthetic: true },
];

export const ARMOR = [
  { name: 'No armour', short: 'none', desc: 'The frame and the oil pan take the hits.', hull: 1, mass: 0 },
  { name: 'Skid plates', short: 'skids', desc: 'Steel plates under the engine, gearbox and tank: the belly slides over rock instead of hanging up.', hull: 0.55, mass: 38 },
  { name: 'Skid plates + rock sliders', short: 'skids + sliders', desc: 'Steel tubes along the sills as well, to pivot and slide on.', hull: 0.5, mass: 66, sliders: true },
];

export const LIGHTS = [
  { name: 'Stock headlamps', short: 'stock', desc: 'Two round sealed-beam lamps.' },
  { name: 'Roof light bar', short: 'light bar', desc: 'Four driving lamps on the roof: much more light at night.', mass: 9 },
];

export const RACKS = [
  { name: 'No roof rack', short: 'none', desc: 'Nothing up top.' },
  { name: 'Roof rack', short: 'rack', desc: 'A steel basket on the roof (a bed rack on the pickup): a little more drag.', mass: 22 },
  { name: 'Rack + jerry cans and spare', short: 'loaded', desc: 'Fuel, water and a second spare up top: 75 kg, high up. Mind the side slopes.', mass: 75 },
];

/** Engines: each truck's stock unit, the same tuned, and the classic swap. */
const ENGINE = {
  V8_50: { name: 'V8 5.0', idleRpm: 700, redline: 4400, limiter: 4650, inertia: 0.32, friction: [17, 0.024], sound: 'v8_muscle', pitch: 1, mass: 0,
    torque: [[400, 130], [800, 230], [1200, 280], [1800, 302], [2400, 318], [3000, 310], [3600, 290], [4200, 262], [4700, 200], [5200, 130]] },
  V8_66: { name: 'V8 6.6', idleRpm: 650, redline: 4200, limiter: 4400, inertia: 0.38, friction: [20, 0.027], sound: 'v8_muscle', pitch: 0.86, mass: 0,
    torque: [[400, 160], [800, 285], [1200, 350], [1800, 395], [2400, 410], [3000, 396], [3600, 365], [4200, 310], [4600, 240], [5000, 150]] },
  I6_42: { name: 'I6 4.2', idleRpm: 650, redline: 4300, limiter: 4500, inertia: 0.26, friction: [14, 0.021], sound: 'i6_bmw', pitch: 0.78, mass: 0,
    torque: [[400, 120], [800, 205], [1200, 240], [1800, 262], [2400, 268], [3000, 258], [3600, 238], [4200, 205], [4600, 160], [5000, 110]] },
  V8_75: { name: 'V8 7.5 big-block', idleRpm: 650, redline: 4300, limiter: 4500, inertia: 0.44, friction: [23, 0.03], sound: 'v8_muscle', pitch: 0.8, mass: 80,
    torque: [[400, 200], [800, 360], [1200, 445], [1800, 500], [2400, 520], [3000, 505], [3600, 465], [4200, 395], [4600, 300], [5000, 180]] },
};
const tuned = (e) => ({ ...e, name: `${e.name} tuned`, redline: e.redline + 200, limiter: e.limiter + 200, mass: e.mass + 6,
  torque: e.torque.map(([r, t]) => [r, Math.round(t * (r < 1000 ? 1.04 : 1.13))]) });
export const ENGINES = {
  ranger: [{ ...ENGINE.V8_50, short: 'stock', desc: 'Stock 5.0 V8.' }, { ...tuned(ENGINE.V8_50), short: 'tuned', desc: 'Cam, four-barrel carburettor and headers: +13% torque.' }, { ...ENGINE.V8_75, short: '7.5 swap', desc: 'Big-block swap: +60% torque, 80 kg more over the front axle.' }],
  hauler: [{ ...ENGINE.V8_66, short: 'stock', desc: 'Stock 6.6 V8.' }, { ...tuned(ENGINE.V8_66), short: 'tuned', desc: 'Cam, carburettor and headers: +13% torque.' }, { ...ENGINE.V8_75, short: '7.5 swap', mass: 45, desc: 'Big-block swap: +27% torque.' }],
  mule: [{ ...ENGINE.I6_42, short: 'stock', desc: 'Stock 4.2 straight six.' }, { ...tuned(ENGINE.I6_42), short: 'tuned', desc: 'Carburettor, headers, ignition: +13% torque.' }, { ...ENGINE.V8_50, short: 'V8 swap', mass: 45, desc: 'The classic small-block V8 swap: +19% torque, 45 kg more up front.' }],
};

// ---------------------------------------------------------------- categories (garage order)
export const CATEGORIES = [
  { id: 'lift', group: 'Suspension and tyres', name: 'Lift', options: LIFTS },
  {
    id: 'tyre', group: 'Suspension and tyres', name: 'Tyre size',
    options: TYRE_SIZES.map((d) => ({ name: `${d}" tyres (${TYRES[d].label})`, short: `${d}"`, d, desc: `${TYRES[d].mass} kg each on the wheel. Bigger tyres lift the diffs and the body, roll over more, and float better, but weigh more and gear the truck taller: re-gear the axles to match.` })),
  },
  { id: 'tread', group: 'Suspension and tyres', name: 'Tread', options: TREADS },
  { id: 'wheels', group: 'Suspension and tyres', name: 'Wheels and air', options: WHEELS },
  {
    id: 'gears', group: 'Drivetrain', name: 'Axle gears',
    options: AXLE_RATIOS.map((r) => ({ name: `${r.toFixed(2)}:1 ring and pinion`, short: r.toFixed(2), ratio: r, desc: 'Deeper (bigger number) gears turn the wheels slower and harder: they bring back the pull bigger tyres take away, and lower the top speed.' })),
  },
  { id: 'tcase', group: 'Drivetrain', name: 'Transfer case', options: TCASES },
  { id: 'diffs', group: 'Drivetrain', name: 'Differentials', options: DIFFS },
  { id: 'trans', group: 'Drivetrain', name: 'Gearbox', options: TRANSMISSIONS },
  { id: 'engine', group: 'Drivetrain', name: 'Engine', options: null },          // per truck
  { id: 'intake', group: 'Equipment', name: 'Air intake', options: INTAKES },
  { id: 'winch', group: 'Equipment', name: 'Winch', options: WINCHES },
  { id: 'armor', group: 'Equipment', name: 'Armour', options: ARMOR },
  { id: 'lights', group: 'Equipment', name: 'Lights', options: LIGHTS },
  { id: 'rack', group: 'Equipment', name: 'Roof', options: RACKS },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const optionsFor = (cat, truckId) => (cat.id === 'engine' ? ENGINES[truckId] || ENGINES.ranger : cat.options);

// ---------------------------------------------------------------- prices (US dollars, parts and fitting)
/** What each part costs to buy and fit; the truck's factory parts are free. Tyres are a set of five. */
export const PRICES = {
  lift: [0, 900, 2200, 5800],
  tyre: { 30: 850, 31: 950, 33: 1300, 35: 1750, 37: 2400 },
  tread: [0, 400, 350],
  wheels: [0, 650, 2100],
  gears: 1600,                       // any ratio but the factory one: both axles re-geared
  tcase: [0, 1900],
  diffs: [0, 750, 1100, 2200],
  trans: [1800, 1200, 1600],         // a different gearbox swapped in
  engine: [0, 1500, 4800],
  intake: [0, 450],
  winch: [0, 1300],
  armor: [0, 700, 1350],
  lights: [0, 480],
  rack: [0, 520, 900],
};

/** Price of part value v in category cat for a truck (0 for its factory part). */
export function partPrice(base, cat, v) {
  const stock = stockBuild(base)[cat];
  if (v === stock) return 0;
  const p = PRICES[cat];
  if (cat === 'tyre') return p[v] || 0;
  if (typeof p === 'number') return p;
  return p?.[v] || 0;
}

// ---------------------------------------------------------------- builds
/** Each truck's factory build (indices; tyre is the diameter). */
export function stockBuild(base) {
  return {
    lift: 0, tyre: base.stock.tyre, tread: 0, wheels: 0, gears: AXLE_RATIOS.indexOf(base.stock.axle), tcase: 0,
    diffs: 0, trans: base.stock.trans, engine: 0, intake: 0, winch: 0, armor: 0, lights: 0, rack: 0,
  };
}

const step = (list, v, k) => list[clamp(list.indexOf(v) + k, 0, list.length - 1)];
/** Ready-made builds, relative to the truck's stock sizes. */
export const PRESETS = [
  { id: 'stock', name: 'Stock', desc: 'As it left the factory.', make: (b) => b },
  { id: 'trail', name: 'Weekend trail', desc: '2" lift, one size bigger A/Ts, deeper gears, rear locker, skids, onboard air.',
    make: (b) => ({ ...b, lift: 1, tyre: step(TYRE_SIZES, b.tyre, 1), wheels: 1, gears: Math.min(b.gears + 1, AXLE_RATIOS.length - 1), diffs: 2, armor: 1, rack: 1 }) },
  { id: 'crawler', name: 'Rock crawler', desc: '4" lift, 35" M/Ts on beadlocks, 5.13s, lockers both ends, 4:1 box, granny four-speed, armour.',
    make: (b) => ({ ...b, lift: 2, tyre: 35, tread: 1, wheels: 2, gears: 3, tcase: 1, diffs: 3, trans: 2, engine: 1, winch: 1, armor: 2, lights: 1, rack: 0 }) },
  { id: 'mudder', name: 'Mud bogger', desc: '6" long-travel, 37" bias-ply mudders, 5.38s, lockers, snorkel, engine swap, light bar.',
    make: (b) => ({ ...b, lift: 3, tyre: 37, tread: 2, wheels: 1, gears: 4, tcase: 0, diffs: 3, trans: 0, engine: 2, intake: 1, winch: 1, armor: 1, lights: 1, rack: 0 }) },
  { id: 'overland', name: 'Overlander', desc: 'Mild lift and A/Ts, snorkel, rear locker, big winch, armour, roof rack with fuel and water.',
    make: (b) => ({ ...b, lift: 1, tyre: step(TYRE_SIZES, b.tyre, 1), wheels: 1, gears: Math.min(b.gears + 1, AXLE_RATIOS.length - 1), diffs: 2, engine: 1, intake: 1, winch: 1, armor: 2, lights: 1, rack: 2 }) },
];

export function presetBuild(base, id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return normalizeBuild(base, p.make(stockBuild(base)));
}

/** The biggest tyre (in) a lift makes room for: it fits at fit + lift, and up to 2" more rubs (bump stops extended). */
export const maxTyre = (base, lift) => base.stock.fit + LIFTS[lift].inches + 2;

/** A few words for a build: its preset's name, or what has changed from stock. */
export function buildSummary(base, build) {
  const b = normalizeBuild(base, build), code = encodeBuild(b);
  for (const p of PRESETS) if (encodeBuild(presetBuild(base, p.id)) === code) return p.name;
  const s = stockBuild(base), out = [];
  if (b.lift !== s.lift) out.push(`${LIFTS[b.lift].inches}" lift`);
  if (b.tyre !== s.tyre || b.tread !== s.tread) out.push(`${b.tyre}" ${TREADS[b.tread].short}`);
  if (b.gears !== s.gears) out.push(`${AXLE_RATIOS[b.gears].toFixed(2)}s`);
  if (b.diffs !== s.diffs) out.push(DIFFS[b.diffs].short);
  if (b.tcase !== s.tcase) out.push('4:1 box');
  if (b.trans !== s.trans) out.push(TRANSMISSIONS[b.trans].short);
  if (b.engine !== s.engine) out.push(ENGINES[base.id][b.engine].short);
  if (b.intake) out.push('snorkel');
  if (b.wheels) out.push(WHEELS[b.wheels].short);
  if (b.winch) out.push('12k winch');
  if (b.armor) out.push(ARMOR[b.armor].short);
  if (b.lights) out.push('light bar');
  if (b.rack) out.push(b.rack === 2 ? 'loaded rack' : 'rack');
  return out.length ? out.join(', ') : 'Stock';
}

/** Clamp every choice to a valid one; missing ones come from stock. */
export function normalizeBuild(base, build) {
  const s = stockBuild(base), b = { ...s, ...(build || {}) };
  for (const cat of CATEGORIES) {
    if (cat.id === 'tyre') continue;
    const n = optionsFor(cat, base.id).length;
    b[cat.id] = Number.isInteger(b[cat.id]) ? clamp(b[cat.id], 0, n - 1) : s[cat.id];
  }
  if (!TYRE_SIZES.includes(b.tyre) || b.tyre < base.stock.tyre) b.tyre = s.tyre;
  while (b.tyre > maxTyre(base, b.lift)) b.tyre = TYRE_SIZES[TYRE_SIZES.indexOf(b.tyre) - 1];
  return b;
}

/** 14 characters, one per category (tyre as its index in TYRE_SIZES). */
export function encodeBuild(b) {
  return CATEGORY_IDS.map((id) => (id === 'tyre' ? TYRE_SIZES.indexOf(b.tyre) : b[id]).toString(36)).join('');
}

export function decodeBuild(base, code) {
  if (typeof code !== 'string' || !/^[0-9a-z]{1,24}$/.test(code)) return stockBuild(base);
  const b = {};
  CATEGORY_IDS.forEach((id, i) => {
    if (i >= code.length) return;
    const v = parseInt(code[i], 36);
    b[id] = id === 'tyre' ? TYRE_SIZES[v] : v;
  });
  return normalizeBuild(base, b);
}

// ---------------------------------------------------------------- build -> physics spec
/** Where each added part sits (design frame: x left, y up from the ground at stock height, z forward). */
function addedParts(base, b) {
  const p = [];
  const front = base.axles[0].z, roofY = base.roofY;
  const lift = LIFTS[b.lift], armor = ARMOR[b.armor], tc = TCASES[b.tcase], diff = DIFFS[b.diffs];
  const eng = ENGINES[base.id][b.engine];
  if (lift.mass) p.push({ m: lift.mass, x: 0, y: 0.55, z: 0 });
  if (armor.mass) p.push({ m: armor.mass, x: 0, y: 0.48, z: 0.3 });
  if (tc.mass) p.push({ m: tc.mass, x: 0.1, y: 0.5, z: 0 });
  if (diff.mass) p.push({ m: diff.mass, x: 0, y: 0.4, z: 0 });
  if (eng.mass) p.push({ m: eng.mass, x: 0, y: 0.85, z: front - 0.15 });
  if (b.wheels > 0) p.push({ m: WHEELS[b.wheels].mass, x: 0.3, y: 0.85, z: front });
  if (INTAKES[b.intake].mass) p.push({ m: INTAKES[b.intake].mass, x: -0.8, y: 1.5, z: base.cabZ });
  if (WINCHES[b.winch].mass) p.push({ m: WINCHES[b.winch].mass, x: 0, y: 0.7, z: base.noseZ });
  if (LIGHTS[b.lights].mass) p.push({ m: LIGHTS[b.lights].mass, x: 0, y: roofY + 0.12, z: base.cabZ });
  if (RACKS[b.rack].mass) p.push({ m: RACKS[b.rack].mass, x: 0, y: roofY + 0.2, z: base.rackZ });
  return p;
}

/**
 * The physics spec for a truck with a build. The stock spec (trucks.js) describes the truck at stock height on its
 * stock tyres with bare axles (axle mass without wheels); everything here is derived from it.
 */
export function buildSpec(base, buildIn) {
  const b = normalizeBuild(base, buildIn);
  const spec = JSON.parse(JSON.stringify(base));
  const T0 = TYRES[base.stock.tyre], T = TYRES[b.tyre];
  const tread = TREADS[b.tread], wheels = WHEELS[b.wheels], lift = LIFTS[b.lift];
  const dR = T.radius - T0.radius;
  const raise = lift.lift + dR;                                       // the body rises by the lift and the tyre growth
  const wheelMass = T.mass + (wheels.wheelMass || 0);

  // ---- weights and the centre of gravity
  const unsprung0 = base.axles.reduce((s, a) => s + a.mass, 0) + 4 * T0.mass;
  const sprung0 = base.mass - unsprung0;
  const hSprung0 = (base.mass * base.cgHeight - unsprung0 * T0.radius) / sprung0;
  const zSprung0 = (base.mass * base.cgZ - 2 * T0.mass * (base.axles[0].z + base.axles[1].z) - base.axles[0].mass * base.axles[0].z - base.axles[1].mass * base.axles[1].z) / sprung0;
  const parts = addedParts(base, b);
  let m = sprung0, my = sprung0 * (hSprung0 + raise), mz = sprung0 * zSprung0;
  for (const p of parts) { m += p.m; my += p.m * (p.y + raise); mz += p.m * p.z; }
  for (const a of base.axles) { const ma = a.mass + 2 * wheelMass; m += ma; my += ma * T.radius; mz += ma * a.z; }
  spec.mass = Math.round(m);
  spec.cgHeight = my / m;
  spec.cgZ = mz / m;
  // inertia: the stock body as a box, plus the added parts and the heavier wheels as point masses
  const [W, H, L] = base.inertiaBox;
  let Ix = sprung0 / 12 * (H * H + L * L), Iy = sprung0 / 12 * (L * L + W * W) * 1.05, Iz = sprung0 / 12 * (W * W + H * H) * 0.95;
  const pt = (pm, x, y, z) => {
    const dy = y - spec.cgHeight, dz = z - spec.cgZ;
    Ix += pm * (dy * dy + dz * dz); Iy += pm * (x * x + dz * dz); Iz += pm * (x * x + dy * dy);
  };
  const dyBody = hSprung0 + raise - spec.cgHeight, dzBody = zSprung0 - spec.cgZ;
  Ix += sprung0 * (dyBody * dyBody + dzBody * dzBody); Iz += sprung0 * dyBody * dyBody; Iy += sprung0 * dzBody * dzBody;
  for (const p of parts) pt(p.m, p.x, p.y + raise, p.z);
  for (const a of base.axles) { pt(a.mass, 0, T.radius, a.z); pt(wheelMass, a.track / 2, T.radius, a.z); pt(wheelMass, -a.track / 2, T.radius, a.z); }
  spec.inertia = [Ix, Iy, Iz];

  // ---- tyres
  spec.tyre = {
    ...DEFAULT_TYRE, ...(base.tyre || {}),
    radius: T.radius, width: T.width, mass: wheelMass, inertia: T.inertia * (wheels.beadlock ? 1.07 : 1),
    stiffness: 230000 * Math.pow(T.width / 0.267, 0.4) * (tread.stiff || 1),
    tread: b.tread, treadName: tread.name, rrMul: tread.rr,
    grip: SURFACE_NAMES.map((n) => tread.grip[n] || 1),
    psiStock: 30, minPsi: wheels.minPsi, beadlock: wheels.beadlock, compressor: wheels.compressor, size: T.d,
  };

  // ---- suspension: lift, travel, rate, tyre rub
  const fit = base.stock.fit + lift.inches;
  const rubIn = Math.max(0, T.d - fit);
  spec.axles = base.axles.map((a) => {
    const travel = a.travel + lift.travel;
    return {
      ...a,
      mass: a.mass + 2 * wheelMass,
      travel, sag: a.sag + lift.travel * 0.55,
      bumpTravel: travel - rubIn * 0.025,                          // a tyre too big for the arches hits the bump stop early
      rate: a.rate * lift.rate, bump: a.bump * lift.damp, rebound: a.rebound * lift.damp,
      swayBar: a.swayBar ? a.swayBar * (lift.inches >= 6 ? 0.7 : 1) : a.swayBar,
    };
  });
  spec.rubInches = rubIn;

  // ---- body: everything bolted to the frame rises
  spec.hull = base.hull.map((h) => ({ ...h, c: [h.c[0], h.c[1] + raise, h.c[2]], h: h.h.slice() }));
  spec.hullFriction = ARMOR[b.armor].hull;
  spec.sliders = !!ARMOR[b.armor].sliders;
  if (spec.sliders) {
    // steel tubes along the sills, between the wheels, a little below and outside the body
    const body = spec.hull[0], zf = base.axles[0].z, zr = base.axles[1].z, r = T.radius;
    const z0 = zr + r + 0.12, z1 = zf - r - 0.12;
    spec.hull.push({ c: [0, body.c[1] - body.h[1] - 0.02, (z0 + z1) / 2], h: [body.h[0] + 0.03, 0.04, (z1 - z0) / 2], pts: 'bottom', thin: true });
  }
  const W0 = WINCHES[b.winch];
  spec.winch = { ...base.winch, ...W0, fairlead: [base.winch.fairlead[0], base.winch.fairlead[1] + raise, base.winch.fairlead[2]] };
  spec.snorkel = b.intake === 1;
  const intake = spec.snorkel ? base.snorkelPos : base.intakePos;
  spec.intake = [intake[0], intake[1] + raise, intake[2]];
  spec.drag = { cd: base.drag.cd + (b.rack ? 0.04 : 0) + (b.lights ? 0.02 : 0), area: base.drag.area + 1.6 * raise + (b.rack ? 0.25 : 0) };
  spec.raise = raise;
  spec.dR = dR;
  spec.lightBar = b.lights === 1;

  // ---- drivetrain
  const eng = ENGINES[base.id][b.engine];
  spec.engine = { ...eng };
  spec.engineSound = eng.sound; spec.soundPitch = eng.pitch;
  const tr = TRANSMISSIONS[b.trans];
  spec.trans = {
    ...base.trans, type: tr.type, gears: tr.gears.slice(), reverse: tr.reverse,
    low: TCASES[b.tcase].low || base.stock.low, axle: AXLE_RATIOS[b.gears],
  };
  spec.diffs = { front: DIFFS[b.diffs].front, rear: DIFFS[b.diffs].rear };

  spec.build = b;
  spec.buildCode = encodeBuild(b);
  return spec;
}

const SURFACE_NAMES = Object.keys(SURFACE).map((k) => k.toLowerCase());

/** The physics spec for a truck id and a build (object or code). */
export function specFor(base, build) {
  return buildSpec(base, typeof build === 'string' ? decodeBuild(base, build) : build);
}

// ---------------------------------------------------------------- garage numbers
/** Tangent from a point (dz ahead of the contact, h up) to a wheel of radius r: the steepest ground it clears. */
function clearAngle(r, dz, h) {
  const R = Math.hypot(dz, r - h), phi = Math.atan2(r - h, dz);
  return Math.max(0, Math.asin(Math.min(1, r / R)) - phi) * 180 / Math.PI;
}

/** What a build means on the trail: the numbers the garage shows. */
export function buildStats(spec) {
  const t = spec.tyre, e = spec.engine, tr = spec.trans;
  const rStatic = t.radius - (spec.mass * G / 4) / t.stiffness;
  const [body, belly] = spec.hull;
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  // approach and departure: from the tyres to the bumpers; breakover: the crest the belly clears between the wheels
  const bumperY = body.c[1] - body.h[1];
  const approach = clearAngle(rStatic, body.c[2] + body.h[2] - zf, bumperY);
  const departure = clearAngle(rStatic, zr - (body.c[2] - body.h[2]), bumperY);
  const bellyY = belly.c[1] - belly.h[1];
  let breakover = 180;
  for (const z of [belly.c[2] - belly.h[2], belly.c[2], belly.c[2] + belly.h[2]]) {
    breakover = Math.min(breakover, clearAngle(rStatic, zf - z, bellyY) + clearAngle(rStatic, z - zr, bellyY));
  }
  // gearing
  const top = tr.gears[tr.gears.length - 1] * tr.axle;
  const crawl = tr.gears[0] * tr.low * tr.axle;
  let peakT = 0, peakP = 0;
  for (let rpm = 600; rpm <= e.redline; rpm += 50) { const tq = torqueAt(e.torque, rpm); peakT = Math.max(peakT, tq); peakP = Math.max(peakP, tq * rpm * Math.PI / 30); }
  const vGear = (e.redline * Math.PI / 30) / top * rStatic;
  // power-limited top speed: drag + rolling resistance = power at the wheels
  const crr = 0.015 * t.rrMul, P = peakP * 0.83;
  let v = 10;
  for (let i = 0; i < 40; i++) v = Math.cbrt(Math.max(1, (P - crr * spec.mass * G * v) / (0.5 * 1.2 * spec.drag.cd * spec.drag.area)));
  const tip = Math.atan2(Math.min(...spec.axles.map((a) => a.track)) / 2, spec.cgHeight) * 180 / Math.PI;
  return {
    mass: spec.mass,
    cgHeight: spec.cgHeight,
    clearance: rStatic - Math.max(...spec.axles.map((a) => a.diffDrop || 0.16)),       // under the diffs
    belly: bellyY,
    approach, departure, breakover,
    wading: spec.intake[1] - 0.08,
    crawl,
    idleCrawl: (e.idleRpm * Math.PI / 30) / crawl * rStatic * 3.6,                     // km/h in first, low range, at idle
    topSpeed: Math.min(vGear, v) * 3.6,
    peakTorque: peakT,
    powerKw: peakP / 1000,
    tip,
    travel: Math.max(...spec.axles.map((a) => a.travel)),
    bumpLoss: spec.rubInches * 0.025,
    rub: spec.rubInches,
    tyre: `${t.size}" ${TREADS[spec.build.tread].short}`,
    minPsi: t.minPsi,
  };
}
