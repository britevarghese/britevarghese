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
/**
 * Tyres: overall diameter (in), section width, mounted weight with a steel wheel, rotating inertia, rim diameter. From
 * the micro 4x4's 27s through the light-truck sizes to the 46" military and expedition tyres; and below them the road
 * cars' low-profile sizes (`road`: only for road cars; each one's factory tyre is its own, `stockTyre` in trucks.js).
 */
export const TYRES = {
  24: { d: 24, label: '205/55R15', radius: 12 * IN, width: 0.205, mass: 18, inertia: 0.85, rim: 15, road: true },
  25: { d: 25, label: '225/45R17', radius: 12.5 * IN, width: 0.225, mass: 20, inertia: 1.0, rim: 17, road: true },
  26: { d: 26, label: '255/35R19', radius: 13 * IN, width: 0.255, mass: 22, inertia: 1.15, rim: 19, road: true },
  27: { d: 27, label: '205/75R15', radius: 13.5 * IN, width: 0.205, mass: 21, inertia: 1.4, rim: 15 },
  28: { d: 28, label: '28x8.5R15', radius: 14 * IN, width: 0.216, mass: 24, inertia: 1.65, rim: 15 },
  29: { d: 29, label: '29x9.5R15', radius: 14.5 * IN, width: 0.241, mass: 27, inertia: 1.9, rim: 15 },
  30: { d: 30, label: '30x9.5R15', radius: 15 * IN, width: 0.241, mass: 31, inertia: 2.2, rim: 15 },
  31: { d: 31, label: '31x10.5R15', radius: 15.5 * IN, width: 0.267, mass: 34, inertia: 2.6, rim: 15 },
  33: { d: 33, label: '33x12.5R15', radius: 16.5 * IN, width: 0.318, mass: 40, inertia: 3.5, rim: 15 },
  35: { d: 35, label: '35x12.5R15', radius: 17.5 * IN, width: 0.318, mass: 47, inertia: 4.7, rim: 15 },
  37: { d: 37, label: '37x12.5R17', radius: 18.5 * IN, width: 0.318, mass: 53, inertia: 6.0, rim: 17 },
  40: { d: 40, label: '40x13.5R17', radius: 20 * IN, width: 0.343, mass: 66, inertia: 8.3, rim: 17 },
  42: { d: 42, label: '395/85R20', radius: 21 * IN, width: 0.395, mass: 92, inertia: 12.5, rim: 20 },
  44: { d: 44, label: '44x18.5R20', radius: 22 * IN, width: 0.47, mass: 104, inertia: 15.5, rim: 20 },
  46: { d: 46, label: '46x16.5R20', radius: 23 * IN, width: 0.42, mass: 112, inertia: 18.5, rim: 20 },
};
export const TYRE_SIZES = [24, 25, 26, 27, 28, 29, 30, 31, 33, 35, 37, 40, 42, 44, 46];
// (build codes store a tyre as its place in this list: sizes are only ever added at the end, so old codes still read)
const TYRE_CODES = [30, 31, 33, 35, 37, 27, 28, 29, 40, 42, 44, 46, 24, 25, 26];

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
  // the road cars' (`road`): a soft compound on a shallow, stiff tread, which grips tarmac at a smaller slip than a
  // truck's tyre (`tyre`: its slip curve) and lets go sooner past it; little bite on anything loose, and none in snow
  {
    name: 'Summer performance', short: 'summer', desc: 'Ultra-high-performance road tyres: a soft compound, a stiff shallow tread. Superb on dry tarmac; hopeless in mud, snow and wet grass.',
    grip: { road: 1.25, rock: 1.0, dirt: 0.84, gravel: 0.8, grass: 0.86, mud: 0.55, sand: 0.66, snow: 0.42, ice: 0.7, riverbed: 0.72, tea: 0.78 }, rr: 0.85, noise: 0.12, road: true,
    tyre: { alphaPeak: 0.15, relaxY: 0.38, relaxX: 0.18 },
  },
  {
    name: 'Track semi-slick', short: 'track', desc: 'Road-legal semi-slicks (Cup 2 R, Trofeo R): the most grip there is on a dry road, and it lets go suddenly at the limit. Useless on anything loose.',
    grip: { road: 1.45, rock: 1.02, dirt: 0.76, gravel: 0.72, grass: 0.78, mud: 0.45, sand: 0.58, snow: 0.34, ice: 0.6, riverbed: 0.64, tea: 0.7 }, rr: 0.9, noise: 0.15, road: true,
    tyre: { alphaPeak: 0.13, relaxY: 0.34, relaxX: 0.16 },
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
  { name: 'Forged alloys', short: 'alloys', desc: 'Light forged wheels on low-profile tyres: there is too little sidewall to air them down much.', beadlock: false, compressor: false, minPsi: 26, mass: 0, road: true },
];

// (the last three: portal axles, the ring and pinion times the reduction in the hubs)
export const AXLE_RATIOS = [3.54, 4.10, 4.56, 5.13, 5.38, 5.89, 6.53, 7.17];
/** A truck's ring and pinion sets, shallowest first (its own, when its factory ratio isn't one of the usual). */
export const ratiosFor = (base) => base.axleRatios || AXLE_RATIOS;

export const TCASES = [
  { name: 'Stock transfer case', short: 'stock', desc: 'Two speeds: high, and a low range for the hard stuff.', low: null },
  { name: '4:1 crawl box', short: '4:1', desc: 'A 4:1 low range: creep up ledges at walking pace with the engine barely above idle.', low: 4.0, mass: 18 },
];

/** How much each diff option locks (for keeping the better one): the auto-locker between a rear locker and both. */
export const DIFF_RANK = [0, 1, 2, 3, 2.5];
export const DIFFS = [
  { name: 'Open differentials', short: 'open', desc: 'Stock. Power goes to the wheel with the least grip.', front: 'open', rear: 'open' },
  { name: 'Rear limited-slip', short: 'LSD', desc: 'Clutches in the rear diff push some torque to the wheel with grip. Always on, no button.', front: 'open', rear: 'lsd' },
  { name: 'Rear selectable locker', short: 'R lock', desc: 'Lock the rear axle solid on demand (X).', front: 'open', rear: 'locker', mass: 4 },
  { name: 'Front and rear lockers', short: 'F+R lock', desc: 'Both axles lock on demand. Unlock to turn.', front: 'locker', rear: 'locker', mass: 9 },
  { name: 'Rear auto-locker (MLD), front brake locking', short: 'MLD', desc: 'The Thar\'s mechanical locking differential locks the rear axle by itself when a wheel spins (below about 30 km/h) and frees it to turn; in 4WD the brakes hold a spinning front wheel back so the other drives.', front: 'bld', rear: 'auto', mass: 5 },
];

export const TRANSMISSIONS = [
  { name: '3-speed automatic', short: 'auto', type: 'auto', gears: [2.46, 1.46, 1.0], reverse: 2.18, desc: 'Torque converter: creeps at idle, multiplies torque from a stop.' },
  { name: '3-speed manual', short: '3-spd', type: 'manual', gears: [2.99, 1.75, 1.0], reverse: 3.17, desc: 'Clutch and three ratios. Holds the truck back downhill.' },
  { name: '4-speed manual, granny low', short: '4-spd', type: 'manual', gears: [6.55, 3.58, 1.7, 1.0], reverse: 6.09, desc: 'A 6.55:1 first gear: crawls in high range, starts in second on the road.' },
  { name: '5-speed manual, overdrive', short: '5-spd', type: 'manual', gears: [3.95, 2.14, 1.38, 1.0, 0.85], reverse: 4.22, desc: 'Five close ratios and an overdrive top: quieter at speed, a little short at the bottom.' },
  { name: '4-speed automatic, overdrive', short: '4-spd auto', type: 'auto', gears: [2.8, 1.53, 1.0, 0.71], reverse: 2.39, desc: 'A torque converter and an overdrive: easy to drive, relaxed at speed.' },
  { name: 'Heavy-duty 5-speed, granny low', short: 'HD 5-spd', type: 'manual', gears: [5.61, 3.04, 1.67, 1.0, 0.73], reverse: 5.04, desc: 'A one-ton truck\'s gearbox: a 5.61 granny first and an overdrive. Heavy, unbreakable.' },
  { name: '8-speed truck gearbox', short: '8-spd', type: 'manual', gears: [9.0, 6.4, 4.6, 3.3, 2.4, 1.75, 1.3, 1.0], reverse: 9.6, desc: 'Eight close ratios from a 9:1 crawler first: no low range needed.' },
  { name: '6-speed manual (6R320M)', short: '6-spd', type: 'manual', gears: [3.96, 2.24, 1.42, 1.0, 0.81, 0.72], reverse: 3.76, desc: 'The Thar\'s six-speed: a 3.96 first, two overdrives for the highway.' },
  { name: '6-speed automatic', short: '6-spd auto', type: 'auto', gears: [3.6, 2.09, 1.47, 1.0, 0.74, 0.63], reverse: 3.25, desc: 'A six-speed torque-converter automatic: smooth, and it crawls without a clutch.' },
  { name: '5-speed automatic (W5A580)', short: '5-spd auto', type: 'auto', gears: [3.59, 2.19, 1.41, 1.0, 0.83], reverse: 3.16, desc: 'The Wrangler\'s five-speed automatic: a 3.59 first through a torque converter, an overdrive top.' },
  { name: '6-speed manual (NSG370)', short: 'NSG370', type: 'manual', gears: [4.46, 2.61, 1.72, 1.25, 1.0, 0.84], reverse: 4.06, desc: 'The Wrangler\'s six-speed manual: a 4.46 first for the rocks, an overdrive top.' },
  { name: '10-speed automatic (10R60)', short: '10-spd auto', type: 'auto', gears: [4.7, 2.99, 2.15, 1.77, 1.52, 1.28, 1.0, 0.85, 0.69, 0.64], reverse: 4.87, desc: 'The Bronco\'s ten-speed automatic: a 4.70 first through a torque converter, close steps all the way, two overdrives.' },
  { name: '5-speed automatic (Allison 1000)', short: 'Allison', type: 'auto', gears: [3.1, 1.81, 1.41, 1.0, 0.71], reverse: 4.49, desc: 'The H1 Alpha\'s heavy-duty Allison five-speed: built for a diesel\'s torque, a 3.10 first, an overdrive top.' },
  { name: 'Single-speed reduction (electric)', short: 'direct', type: 'direct', gears: [1.0], reverse: 1.0, desc: 'Electric drive units: the motors geared straight to the axles, one ratio, full torque from a standstill. No clutch, no torque converter, nothing to shift.' },
  { name: '5-speed automatic (INVECS-II)', short: '5-spd auto', type: 'auto', gears: [3.79, 2.06, 1.42, 1.0, 0.73], reverse: 3.48, desc: 'The Pajero\'s five-speed automatic with its sport-shift gate: a 3.79 first through a torque converter, an overdrive top.' },
  { name: '8-speed automatic (ZF 8HP)', short: '8-spd auto', type: 'auto', gears: [5.5, 3.52, 2.2, 1.72, 1.317, 1.0, 0.823, 0.64], reverse: 3.993, desc: 'The Defender\'s ZF eight-speed automatic: a 5.50 first through a torque converter, close steps all the way, two overdrives.' },
  // the road cars' (`road`): close ratios and no low range. A dual-clutch box (`dct`) shifts as a manual does, through
  // its own clutches, in a tenth of a second (shiftTime) and by itself unless the driver takes the paddles
  { name: '6-speed manual (Getrag)', short: 'Getrag 6', type: 'manual', road: true, gears: [3.827, 2.36, 1.685, 1.312, 1.0, 0.793], reverse: 3.28, desc: 'The Getrag six-speed of the Supra and the Skyline GT-R: built for big turbo torque, close ratios, an overdrive top.' },
  { name: '5-speed manual, dog-leg (Getrag 265)', short: 'dog-leg 5', type: 'manual', road: true, gears: [3.72, 2.4, 1.77, 1.26, 1.0], reverse: 4.23, desc: 'The E30 M3\'s close-ratio five-speed: first down and to the left, the four racing ratios in an H, fifth direct.' },
  { name: '5-speed manual (NSX)', short: 'NSX 5', type: 'manual', road: true, gears: [3.071, 1.952, 1.4, 1.033, 0.771], reverse: 2.727, desc: 'The NSX\'s five-speed transaxle: short, precise throws and a tall fifth.' },
  { name: '5-speed manual (RX-7)', short: 'RX-7 5', type: 'manual', road: true, gears: [3.483, 2.015, 1.391, 1.0, 0.719], reverse: 3.288, desc: 'The FD RX-7\'s five-speed: close enough to keep a rotary on the boil, an overdrive fifth.' },
  { name: '5-speed manual (STi)', short: 'STi 5', type: 'manual', road: true, gears: [3.166, 1.882, 1.296, 0.972, 0.738], reverse: 3.333, desc: 'The Impreza STi\'s close-ratio five-speed, behind its turbo flat-four.' },
  { name: '4-speed manual (930)', short: '930 4', type: 'manual', road: true, gears: [2.25, 1.304, 0.893, 0.656], reverse: 2.437, desc: 'The 930 Turbo\'s four-speed: four gears were all the torque of the turbo needed, and all the box could take.' },
  { name: '5-speed manual (F40)', short: 'F40 5', type: 'manual', road: true, gears: [2.769, 1.631, 1.158, 0.891, 0.725], reverse: 2.92, desc: 'The F40\'s five-speed in its open gate: a heavy clutch, a metal click on every shift.' },
  { name: '6-speed manual (BMW M)', short: 'M 6', type: 'manual', road: true, gears: [4.11, 2.315, 1.542, 1.179, 1.0, 0.846], reverse: 3.727, desc: 'The M3 and M4\'s six-speed manual: a short first, close steps and a gentle overdrive.' },
  { name: '7-speed dual-clutch (PDK)', short: 'PDK', type: 'manual', dct: true, shiftTime: 0.1, road: true, gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], reverse: 3.42, desc: 'Porsche\'s PDK: two clutches, the next gear always waiting; shifts in a tenth of a second, by itself or on the paddles.' },
  { name: '7-speed dual-clutch (S tronic)', short: 'S tronic', type: 'manual', dct: true, shiftTime: 0.1, road: true, gears: [3.13, 2.59, 1.96, 1.55, 1.24, 1.0, 0.8], reverse: 2.79, desc: 'The seven-speed dual-clutch of the R8 and the Huracán: close ratios, shifts in a tenth of a second.' },
  { name: '7-speed dual-clutch (SSG)', short: 'SSG', type: 'manual', dct: true, shiftTime: 0.09, road: true, gears: [3.98, 2.61, 1.91, 1.48, 1.18, 0.95, 0.75], reverse: 3.0, desc: 'McLaren\'s seamless-shift seven-speed: the drive barely breaks between gears.' },
  { name: '8-speed dual-clutch (Tremec)', short: 'Tremec 8', type: 'manual', dct: true, shiftTime: 0.1, road: true, gears: [2.91, 1.76, 1.22, 0.88, 0.65, 0.51, 0.4, 0.33], reverse: 2.33, desc: 'The mid-engined Corvette\'s eight-speed dual-clutch: six close ratios and two tall overdrives for the highway.' },
  { name: '6-speed dual-clutch (GR6)', short: 'GR6', type: 'manual', dct: true, shiftTime: 0.12, road: true, gears: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], reverse: 3.383, desc: 'The GT-R\'s rear transaxle: six speeds, two clutches, built to put 600 Nm through four wheels.' },
  { name: '7-speed dual-clutch (AMG Speedshift)', short: 'Speedshift', type: 'manual', dct: true, shiftTime: 0.1, road: true, gears: [3.4, 2.19, 1.63, 1.29, 1.03, 0.84, 0.63], reverse: 2.53, desc: 'The AMG GT\'s seven-speed dual-clutch transaxle, at the back for the balance.' },
  { name: '8-speed automatic (M Steptronic)', short: 'Steptronic', type: 'auto', road: true, gears: [5.0, 3.2, 2.143, 1.72, 1.314, 1.0, 0.822, 0.64], reverse: 3.456, desc: 'The M4\'s ZF eight-speed: a torque converter that locks up at once, quick shifts, a short first.' },
  { name: '7-speed ISR', short: 'ISR', type: 'manual', dct: true, shiftTime: 0.12, road: true, gears: [3.91, 2.44, 1.81, 1.46, 1.19, 0.97, 0.83], reverse: 2.9, desc: 'Lamborghini\'s single-clutch independent-shifting-rod box: fifty milliseconds a shift, and you feel every one.' },
  { name: '7-speed automatic (7G-Tronic)', short: '7G', type: 'auto', gears: [4.38, 2.86, 1.92, 1.37, 1.0, 0.82, 0.73], reverse: 3.42, desc: 'The G 63\'s AMG seven-speed automatic: a 4.38 first through a torque converter, two overdrives.' },
];
/** The electric drive units' gearbox (TRANSMISSIONS index). */
export const EV_TRANS = TRANSMISSIONS.findIndex((t) => t.type === 'direct');
/** A gearbox by its short name (TRANSMISSIONS index). */
export const transIndex = (short) => TRANSMISSIONS.findIndex((t) => t.short === short);
/** What a road car can take (its `only`, with its tyre sizes): a 2" lift at most (a safari build), its own treads and
 *  an all-terrain, its forged wheels, no low range, no lockers, snorkel, armour or light bar, the road gearboxes. */
export const ROAD_ONLY = {
  lift: [0, 1], tread: [3, 4, 0], wheels: [3], tcase: [0], diffs: [0, 1], intake: [0], winch: [0], armor: [0], lights: [0],
  trans: TRANSMISSIONS.map((t, i) => (t.road ? i : -1)).filter((i) => i >= 0),
};

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

/** Engines: each truck's stock unit, the same tuned, and the classic swap. Diesels make their torque low and rev out
 *  early; sound: one of the recorded engines (pitched for the size and the number of cylinders), `loud` as much louder
 *  than a small engine, and `bass` dB more of its low end (a big V8's chest-thump, a big diesel's rumble). */
const ENGINE = {
  V8_50: { name: 'V8 5.0', idleRpm: 700, redline: 4400, limiter: 4650, inertia: 0.32, friction: [17, 0.024], bank: 'v8', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, loud: 1.2, bass: 4,
    torque: [[400, 130], [800, 230], [1200, 280], [1800, 302], [2400, 318], [3000, 310], [3600, 290], [4200, 262], [4700, 200], [5200, 130]] },
  V8_66: { name: 'V8 6.6', idleRpm: 650, redline: 4200, limiter: 4400, inertia: 0.38, friction: [20, 0.027], bank: 'v8', turbo: 0, sound: 'v8_muscle', pitch: 0.86, mass: 0, loud: 1.25, bass: 5,
    torque: [[400, 160], [800, 285], [1200, 350], [1800, 395], [2400, 410], [3000, 396], [3600, 365], [4200, 310], [4600, 240], [5000, 150]] },
  I6_42: { name: 'I6 4.2', idleRpm: 650, redline: 4300, limiter: 4500, inertia: 0.26, friction: [14, 0.021], bank: 'i6', turbo: 0, sound: 'i6_bmw', pitch: 0.78, mass: 0,
    torque: [[400, 120], [800, 205], [1200, 240], [1800, 262], [2400, 268], [3000, 258], [3600, 238], [4200, 205], [4600, 160], [5000, 110]] },
  V8_75: { name: 'V8 7.5 big-block', idleRpm: 650, redline: 4300, limiter: 4500, inertia: 0.44, friction: [23, 0.03], bank: 'v8', turbo: 0, sound: 'v8_muscle', pitch: 0.8, mass: 80, loud: 1.35, bass: 6,
    torque: [[400, 200], [800, 360], [1200, 445], [1800, 500], [2400, 520], [3000, 505], [3600, 465], [4200, 395], [4600, 300], [5000, 180]] },
  I4_13: { name: 'I4 1.3', idleRpm: 850, redline: 6000, limiter: 6300, inertia: 0.09, friction: [6, 0.011], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 1.18, mass: 0,
    torque: [[600, 58], [1000, 76], [1500, 85], [2000, 91], [2500, 96], [3000, 99], [3500, 101], [4000, 100], [4500, 97], [5000, 92], [5500, 85], [6000, 76], [6500, 58]] },
  I4_16: { name: 'I4 1.6 16-valve', idleRpm: 850, redline: 6500, limiter: 6800, inertia: 0.1, friction: [7, 0.012], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 1.24, mass: 12,
    torque: [[600, 70], [1000, 95], [1500, 108], [2000, 116], [2500, 122], [3000, 126], [3500, 129], [4000, 130], [4500, 129], [5000, 125], [5500, 118], [6000, 110], [6500, 99], [7000, 72]] },
  // the Lada Niva's VAZ-21214 1.7 four: 59.5 kW at 5,000 rpm, 127 Nm at 4,000
  I4_17: { name: 'VAZ 1.7', idleRpm: 850, redline: 5500, limiter: 5800, inertia: 0.11, friction: [7, 0.012], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 1.12, mass: 0, cyl: 4,
    torque: [[600, 70], [1000, 92], [1500, 104], [2000, 112], [2500, 118], [3000, 122], [3500, 125], [4000, 127], [4500, 124], [5000, 114], [5500, 100], [6000, 70]] },
  // the Willys MB's L134 Go Devil: a 2.2 side-valve four, 45 kW at 4,000 rpm, 142 Nm at 2,000
  I4_22: { name: 'Go Devil 2.2', idleRpm: 600, redline: 4000, limiter: 4200, inertia: 0.16, friction: [8, 0.014], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 0.9, mass: 0, cyl: 4,
    torque: [[400, 90], [800, 120], [1200, 132], [1600, 139], [2000, 142], [2500, 140], [3000, 134], [3500, 122], [4000, 107], [4400, 72]] },
  // the UAZ Hunter's ZMZ-409 2.7 four: 94 kW at 4,600 rpm, 209 Nm at 3,900; and the ZMZ-514 2.2 turbo-diesel
  I4_27: { name: 'ZMZ 2.7', idleRpm: 750, redline: 4800, limiter: 5000, inertia: 0.17, friction: [10, 0.017], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 0.96, mass: 0, cyl: 4,
    torque: [[500, 118], [1000, 160], [1500, 178], [2000, 188], [2500, 196], [3000, 202], [3500, 207], [3900, 209], [4300, 204], [4600, 196], [5000, 168], [5300, 120]] },
  D22Z: { name: 'ZMZ 2.2 turbo-diesel', idleRpm: 750, redline: 4000, limiter: 4200, inertia: 0.23, friction: [14, 0.024], bank: 'd4', turbo: 1, sound: 'i6_bmw', pitch: 0.68, mass: 40, cyl: 4, diesel: true,
    torque: [[500, 110], [800, 150], [1000, 190], [1300, 245], [1600, 270], [2400, 270], [2800, 262], [3200, 245], [3600, 222], [4000, 190], [4300, 120]] },
  I4_24: { name: 'I4 2.4', idleRpm: 750, redline: 5000, limiter: 5300, inertia: 0.15, friction: [9, 0.016], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 0.98, mass: 0,
    torque: [[500, 95], [1000, 145], [1500, 160], [2000, 168], [2500, 173], [2800, 175], [3500, 170], [4000, 163], [4500, 153], [4800, 145], [5300, 112]] },
  I6_42P: { name: 'I6 4.2', idleRpm: 650, redline: 4000, limiter: 4300, inertia: 0.3, friction: [15, 0.022], bank: 'i6', turbo: 0, sound: 'i6_bmw', pitch: 0.74, mass: 0,
    torque: [[400, 150], [800, 245], [1200, 274], [1800, 285], [2400, 282], [3000, 275], [3600, 265], [4000, 245], [4400, 195]] },
  I6_42TD: { name: 'I6 4.2 turbo-diesel', idleRpm: 650, redline: 4000, limiter: 4200, inertia: 0.36, friction: [18, 0.024], bank: 'd6', turbo: 1, sound: 'i6_bmw', pitch: 0.6, mass: 60,
    torque: [[500, 170], [1000, 262], [1500, 322], [2000, 350], [2500, 360], [3000, 352], [3600, 324], [4000, 290], [4300, 190]] },
  I6_59TD: { name: 'I6 5.9 turbo-diesel', idleRpm: 750, redline: 3000, limiter: 3200, inertia: 0.62, friction: [25, 0.03], bank: 'd6', turbo: 1, sound: 'i6_bmw', pitch: 0.55, mass: 0, loud: 1.15, bass: 5,
    torque: [[500, 300], [800, 420], [1200, 540], [1600, 570], [2000, 560], [2400, 520], [2800, 470], [3000, 440], [3300, 290]] },
  I6_67CR: { name: 'I6 6.7 common-rail', idleRpm: 700, redline: 3200, limiter: 3400, inertia: 0.66, friction: [26, 0.03], bank: 'd6', turbo: 1, sound: 'i6_bmw', pitch: 0.56, mass: 45, loud: 1.2, bass: 5,
    torque: [[500, 340], [800, 560], [1200, 780], [1600, 870], [2000, 880], [2400, 840], [2800, 760], [3200, 650], [3500, 400]] },
  I6_57D: { name: 'OM 352 5.7 diesel six', idleRpm: 650, redline: 2800, limiter: 3000, inertia: 0.75, friction: [28, 0.035], bank: 'd6', turbo: 0, sound: 'i6_bmw', pitch: 0.5, mass: 0,
    torque: [[500, 230], [800, 300], [1200, 345], [1600, 363], [2000, 355], [2400, 340], [2800, 320], [3100, 210]] },
  // the Thar's 2.2 mHawk 130: 96 kW at 3,750 rpm, 300 Nm from 1,600 to 2,800 (the turbo comes in from ~1,300)
  D22: { name: 'mHawk 2.2 turbo-diesel', idleRpm: 800, redline: 4200, limiter: 4400, inertia: 0.24, friction: [16, 0.026], bank: 'd4', turbo: 1, sound: 'i6_bmw', pitch: 0.7, mass: 0, cyl: 4, diesel: true,
    torque: [[600, 118], [800, 150], [1000, 185], [1200, 226], [1400, 270], [1600, 300], [2200, 300], [2800, 300], [3200, 284], [3750, 246], [4000, 222], [4400, 150]] },
  // the Thar Roxx's mHawk 2.2 in its four-wheel-drive automatic's tune: 129 kW (175 PS) at 3,500 rpm, 370 Nm from 1,500
  // to 3,000
  D22R: { name: 'mHawk 2.2 turbo-diesel (175 PS)', idleRpm: 800, redline: 4200, limiter: 4400, inertia: 0.24, friction: [16, 0.026], bank: 'd4', turbo: 1, sound: 'i6_bmw', pitch: 0.7, mass: 0, cyl: 4, diesel: true,
    torque: [[600, 140], [800, 180], [1000, 228], [1200, 284], [1400, 340], [1500, 370], [3000, 370], [3500, 351], [3750, 318], [4000, 282], [4400, 180]] },
  // and the Roxx's mStallion 2.0 turbo-petrol (automatic): 130 kW (177 PS) at 5,000 rpm, 380 Nm from 1,750 to 3,000
  P20R: { name: 'mStallion 2.0 turbo-petrol (177 PS)', idleRpm: 750, redline: 5500, limiter: 5800, inertia: 0.16, friction: [10, 0.017], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1.02, mass: -20, cyl: 4,
    torque: [[600, 150], [1000, 250], [1250, 320], [1750, 380], [3000, 380], [3500, 368], [4000, 338], [4500, 296], [5000, 248], [5500, 215], [6000, 130]] },
  // and its 2.0 mStallion petrol: 112 kW at 5,000 rpm, 320 Nm from 1,500 to 3,000
  P20: { name: 'mStallion 2.0 turbo-petrol', idleRpm: 750, redline: 5500, limiter: 5800, inertia: 0.16, friction: [10, 0.017], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1.02, mass: -20, cyl: 4,
    torque: [[600, 135], [1000, 215], [1250, 280], [1500, 320], [3000, 320], [3600, 300], [4200, 268], [5000, 214], [5500, 184], [6000, 120]] },
  // the Wrangler's 3.6 Pentastar V6: 213 kW at 6,400 rpm, 353 Nm at 4,800; and the 6.4 HEMI V8 (the 392): 350 kW, 637 Nm
  V6_36: { name: '3.6 Pentastar V6', idleRpm: 650, redline: 6400, limiter: 6600, inertia: 0.19, friction: [12, 0.018], bank: 'v6', turbo: 0, sound: 'i6_bmw', pitch: 0.95, mass: 0,
    torque: [[600, 210], [1000, 262], [1500, 290], [2000, 305], [2500, 316], [3000, 326], [3500, 336], [4000, 345], [4800, 353], [5500, 342], [6000, 328], [6400, 318], [6800, 240]] },
  V8_64: { name: '6.4 HEMI V8', idleRpm: 650, redline: 6000, limiter: 6400, inertia: 0.36, friction: [20, 0.026], bank: 'v8m', turbo: 0, sound: 'v8_muscle', pitch: 0.96, mass: 60, loud: 1.4, bass: 7,
    torque: [[600, 380], [1000, 480], [1500, 540], [2000, 575], [3000, 610], [4300, 637], [5000, 625], [6000, 557], [6400, 500], [6800, 340]] },
  // the Bronco's 2.7 EcoBoost twin-turbo V6: 246 kW at 5,250 rpm, 563 Nm at 3,100; and the Bronco Raptor's 3.0
  // EcoBoost: 312 kW at 5,750, 597 Nm at 3,500
  V6_27T: { name: '2.7 EcoBoost V6', idleRpm: 650, redline: 5800, limiter: 6000, inertia: 0.2, friction: [13, 0.019], bank: 'v6', turbo: 2, sound: 'i6_bmw', pitch: 0.92, mass: 0,
    torque: [[600, 240], [1000, 330], [1500, 430], [2000, 505], [2500, 545], [3100, 563], [3500, 560], [4000, 540], [4500, 505], [5250, 447], [5800, 395], [6200, 250]] },
  V6_30T: { name: '3.0 EcoBoost V6', idleRpm: 650, redline: 6200, limiter: 6400, inertia: 0.22, friction: [14, 0.02], bank: 'v6', turbo: 2, sound: 'i6_bmw', pitch: 0.9, mass: 25,
    torque: [[600, 260], [1000, 350], [1500, 455], [2000, 540], [2500, 580], [3500, 597], [4000, 592], [4500, 575], [5000, 552], [5750, 518], [6200, 470], [6600, 300]] },
  // the Pajero's 4M41 3.2 DI-D turbo-diesel four: 118 kW at 3,800 rpm, 373 Nm from 2,000; and its 3.8 MIVEC V6 petrol:
  // 184 kW at 6,000, 329 Nm at 2,750
  D32: { name: '3.2 DI-D turbo-diesel', idleRpm: 750, redline: 4000, limiter: 4200, inertia: 0.26, friction: [15, 0.026], bank: 'd4', turbo: 1, sound: 'i6_bmw', pitch: 0.66, mass: 0, cyl: 4, diesel: true,
    torque: [[600, 170], [1000, 260], [1500, 340], [2000, 373], [2500, 373], [3000, 360], [3500, 335], [3800, 310], [4000, 290], [4300, 180]] },
  V6_38M: { name: '3.8 MIVEC V6', idleRpm: 650, redline: 6000, limiter: 6300, inertia: 0.2, friction: [12, 0.018], bank: 'v6', turbo: 0, sound: 'i6_bmw', pitch: 0.94, mass: -30,
    torque: [[600, 200], [1000, 262], [1500, 300], [2000, 318], [2750, 329], [3500, 325], [4500, 312], [5500, 298], [6000, 292], [6400, 250]] },
  // the Ranger Raptor's EcoBlue 2.0 bi-turbo diesel: 157 kW at 3,750 rpm, 500 Nm from 1,750 to 2,000
  D20BT: { name: 'EcoBlue 2.0 bi-turbo diesel', idleRpm: 750, redline: 4200, limiter: 4400, inertia: 0.2, friction: [14, 0.024], bank: 'd4t', turbo: 2, sound: 'i6_bmw', pitch: 0.72, mass: 0, cyl: 4, diesel: true,
    torque: [[600, 230], [1000, 360], [1400, 460], [1750, 500], [2000, 500], [2500, 472], [3000, 445], [3750, 400], [4200, 340], [4500, 200]] },
  // the Ram HD's 6.4 HEMI V8 (the trucks' tune): 306 kW at 5,600 rpm, 582 Nm at 4,000
  V8_64HD: { name: '6.4 HEMI V8', idleRpm: 650, redline: 5800, limiter: 6100, inertia: 0.36, friction: [20, 0.026], bank: 'v8m', turbo: 0, sound: 'v8_muscle', pitch: 0.92, mass: 0, loud: 2.6, bass: 9,
    torque: [[600, 340], [1000, 430], [1500, 485], [2000, 520], [2500, 545], [3000, 562], [3500, 575], [4000, 582], [4500, 575], [5000, 560], [5600, 520], [6000, 470], [6400, 330]] },
  // the H1 Alpha's 6.6 Duramax (LLY) turbo-diesel V8: 224 kW at 3,200 rpm, 705 Nm at 1,800; and the later L5P Duramax:
  // 332 kW at 2,800, 1,234 Nm at 1,600
  V8_66D: { name: '6.6 Duramax turbo-diesel V8', idleRpm: 680, redline: 3300, limiter: 3500, inertia: 0.5, friction: [24, 0.03], bank: 'd8', turbo: 1, sound: 'v8_muscle', pitch: 0.7, mass: 0, loud: 1.2, bass: 5, diesel: true,
    torque: [[500, 340], [800, 480], [1200, 620], [1500, 690], [1800, 705], [2400, 700], [2800, 685], [3200, 668], [3500, 540], [3800, 300]] },
  V8_66L5P: { name: '6.6 Duramax L5P', idleRpm: 680, redline: 3300, limiter: 3500, inertia: 0.52, friction: [25, 0.031], bank: 'd8', turbo: 1, sound: 'v8_muscle', pitch: 0.72, mass: 30, loud: 1.25, bass: 6, diesel: true,
    torque: [[500, 520], [800, 820], [1200, 1100], [1600, 1234], [2000, 1220], [2400, 1160], [2800, 1132], [3200, 960], [3500, 700], [3800, 380]] },
  // the GMC Hummer EV Edition 1's three motors (one front, two rear): 746 kW (1,000 hp) all told, ~1,400 Nm at the
  // motors (about 17,500 Nm at the wheels through the 12.5:1 reduction) from a standstill to ~4,800 rpm, then constant
  // power to 13,000; friction here is the regeneration off the throttle (Nm + Nm per rpm), and the "idle" only a floor
  E_3M: { name: 'Three motors (Edition 1)', electric: true, idleRpm: 300, redline: 13000, limiter: 13400, inertia: 0.09, friction: [0, 0.035], bank: null, turbo: 0, sound: 'electric', pitch: 1, mass: 0,
    torque: [[100, 1400], [4800, 1400], [6000, 1187], [7000, 1018], [8000, 890], [9000, 792], [10000, 712], [11000, 648], [12000, 594], [13000, 548], [13600, 300]] },
  // the Cybertruck Cyberbeast's three motors (one front, two rear): 630 kW all told, ~930 Nm at the motors (10,296 lb-ft,
  // ~14,000 Nm, at the wheels through the 15.02:1 reduction) to ~6,500 rpm, then constant power to ~19,000 (209 km/h)
  E_CB: { name: 'Three motors (Cyberbeast)', electric: true, idleRpm: 300, redline: 19000, limiter: 19100, inertia: 0.06, friction: [0, 0.024], bank: null, turbo: 0, sound: 'electric', pitch: 1, mass: 0,
    torque: [[100, 929], [6450, 929], [8000, 752], [10000, 602], [12000, 501], [14000, 430], [16000, 376], [18000, 334], [19000, 317], [19600, 150]] },
  // the Defender's D350 Ingenium 3.0 straight-six turbo-diesel, mild hybrid: 257 kW at 4,000 rpm, 700 Nm from 1,500 to
  // 3,000; and the Defender OCTA's 4.4 twin-turbo V8, mild hybrid: 467 kW at 6,000-7,000, 750 Nm from 1,800 to 5,855
  D30I6: { name: 'D350 3.0 straight-six diesel', idleRpm: 700, redline: 4500, limiter: 4700, inertia: 0.3, friction: [16, 0.024], bank: 'd6m', turbo: 2, sound: 'i6_bmw', pitch: 0.64, mass: 0, loud: 1.05, bass: 3, diesel: true,
    torque: [[600, 300], [1000, 520], [1250, 640], [1500, 700], [3000, 700], [3500, 668], [4000, 613], [4400, 545], [4700, 430], [5000, 200]] },
  V8_44TT: { name: '4.4 twin-turbo V8', idleRpm: 650, redline: 7000, limiter: 7200, inertia: 0.26, friction: [17, 0.022], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1.04, mass: 40, loud: 1.3, bass: 5,
    torque: [[600, 360], [1000, 500], [1400, 650], [1800, 750], [5855, 750], [6500, 686], [7000, 637], [7400, 420]] },
  I6_60TD: { name: 'I6 6.0 turbo-diesel', idleRpm: 650, redline: 2800, limiter: 3000, inertia: 0.8, friction: [30, 0.036], bank: 'd6', turbo: 1, sound: 'i6_bmw', pitch: 0.52, mass: 70,
    torque: [[500, 320], [800, 450], [1200, 570], [1500, 600], [1800, 592], [2200, 560], [2600, 505], [2800, 470], [3100, 300]] },
  // ---- the road cars' (makers' figures): light flywheels, high redlines
  // the M4 CSL's S58 3.0 twin-turbo straight-six: 405 kW at 6,250 rpm, 650 Nm from 2,750 to 5,950; and the M5 CS's
  // S63 4.4 twin-turbo V8: 467 kW at 6,000, 750 Nm from 1,800 to 5,950
  S58: { name: 'S58 3.0 twin-turbo straight-six', idleRpm: 750, redline: 7200, limiter: 7400, inertia: 0.16, friction: [12, 0.02], bank: 'i6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.2, bass: 3,
    torque: [[700, 300], [1200, 430], [2000, 590], [2750, 650], [5950, 650], [6250, 619], [6800, 560], [7200, 505], [7600, 300]] },
  S63: { name: 'S63 4.4 twin-turbo V8', idleRpm: 700, redline: 7000, limiter: 7200, inertia: 0.2, friction: [14, 0.022], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 45, cyl: 8, loud: 1.35, bass: 5,
    torque: [[700, 400], [1200, 560], [1800, 750], [5950, 750], [6500, 668], [7000, 600], [7400, 350]] },
  // the AMG GT S's M178 4.0 twin-turbo V8 (its turbos inside the vee): 375 kW at 6,250, 650 Nm from 1,750 to 4,750;
  // and the GT R's: 430 kW at 6,250, 700 Nm from 1,900 to 5,500
  M178S: { name: 'M178 4.0 twin-turbo V8', idleRpm: 700, redline: 7000, limiter: 7200, inertia: 0.19, friction: [14, 0.022], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.4, bass: 6,
    torque: [[700, 380], [1200, 540], [1750, 650], [4750, 650], [5500, 620], [6250, 573], [6800, 515], [7200, 460], [7600, 280]] },
  M178R: { name: 'M178 4.0 twin-turbo V8 (GT R)', idleRpm: 700, redline: 7200, limiter: 7400, inertia: 0.19, friction: [14, 0.022], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.45, bass: 6,
    torque: [[700, 400], [1200, 570], [1900, 700], [5500, 700], [6250, 657], [6900, 590], [7200, 540], [7600, 300]] },
  // the C8 Stingray's LT2 6.2 pushrod V8 (with the Z51's exhaust): 369 kW at 6,450 rpm, 637 Nm at 5,150; and the Z06's
  // LT6 5.5 flat-plane V8: 499 kW at 8,400, 623 Nm at 6,300
  LT2: { name: 'LT2 6.2 V8', idleRpm: 650, redline: 6600, limiter: 6800, inertia: 0.22, friction: [16, 0.024], bank: 'v8', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.4, bass: 6,
    torque: [[650, 470], [1500, 560], [2500, 590], [3500, 610], [4500, 630], [5150, 637], [6000, 600], [6450, 546], [6800, 490], [7100, 300]] },
  LT6: { name: 'LT6 5.5 flat-plane V8', idleRpm: 900, redline: 8600, limiter: 8800, inertia: 0.15, friction: [14, 0.02], bank: 'v6', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 15, cyl: 8, loud: 1.4, bass: 3,
    torque: [[900, 400], [2000, 470], [3000, 510], [4500, 575], [6300, 623], [7500, 612], [8400, 567], [8800, 490], [9100, 300]] },
  // the Huracán LP 610-4's 5.2 V10: 449 kW at 8,250 rpm, 560 Nm at 6,500; and the Performante's: 470 kW at 8,000,
  // 600 Nm at 6,500
  V10_52: { name: '5.2 V10', idleRpm: 900, redline: 8500, limiter: 8700, inertia: 0.15, friction: [14, 0.021], bank: 'v10', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 10, loud: 1.35, bass: 3,
    torque: [[900, 400], [2000, 440], [3000, 470], [4000, 500], [5000, 530], [6500, 560], [7500, 548], [8250, 520], [8700, 470], [9000, 300]] },
  V10_52P: { name: '5.2 V10 (Performante)', idleRpm: 900, redline: 8500, limiter: 8700, inertia: 0.15, friction: [14, 0.021], bank: 'v10', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 10, loud: 1.4, bass: 3,
    torque: [[900, 420], [2000, 470], [3000, 505], [4000, 540], [5000, 570], [6500, 600], [7500, 585], [8000, 561], [8700, 490], [9000, 320]] },
  // the E30 M3's S14 2.3 four: 147 kW at 6,750 rpm, 240 Nm at 4,750; and the Sport Evolution's 2.5: 175 kW at 7,000
  S14: { name: 'S14 2.3 four', idleRpm: 900, redline: 7250, limiter: 7450, inertia: 0.11, friction: [8, 0.014], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 4, loud: 1.1,
    torque: [[900, 150], [1500, 180], [2500, 205], [3500, 220], [4750, 240], [5500, 236], [6750, 208], [7250, 190], [7600, 110]] },
  S14E: { name: 'S14 2.5 four (Sport Evolution)', idleRpm: 900, redline: 7500, limiter: 7700, inertia: 0.11, friction: [8, 0.014], bank: 'i4', turbo: 0, sound: 'i6_bmw', pitch: 1, mass: 2, cyl: 4, loud: 1.15,
    torque: [[900, 160], [1500, 190], [2500, 215], [3500, 230], [4750, 240], [5500, 240], [6500, 238], [7000, 239], [7500, 200], [7900, 110]] },
  // the NSX's C30A 3.0 VTEC V6: 201 kW at 7,100 rpm, 284 Nm at 5,300; and the NSX-R's C32B 3.2: 216 kW at 7,300
  C30A: { name: 'C30A 3.0 VTEC V6', idleRpm: 800, redline: 8000, limiter: 8200, inertia: 0.12, friction: [10, 0.017], bank: 'v6', turbo: 0, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.15,
    torque: [[800, 200], [2000, 240], [3000, 255], [4000, 265], [5300, 284], [6000, 280], [7100, 270], [7600, 250], [8000, 220], [8300, 130]] },
  C32B: { name: 'C32B 3.2 VTEC V6', idleRpm: 800, redline: 8000, limiter: 8200, inertia: 0.12, friction: [10, 0.017], bank: 'v6', turbo: 0, sound: 'i6_bmw', pitch: 1, mass: 5, cyl: 6, loud: 1.2,
    torque: [[800, 215], [2000, 255], [3000, 272], [4000, 284], [5300, 304], [6000, 300], [7300, 283], [7800, 260], [8000, 230], [8300, 140]] },
  // the 930 Turbo's 3.0 flat-six with one turbo: 191 kW at 5,500 rpm, 343 Nm at 4,000, and nearly nothing below 3,000;
  // and the intercooled 3.3 of 1978: 221 kW, 412 Nm
  F6_30T: { name: '3.0 turbo flat-six', idleRpm: 900, redline: 6800, limiter: 7000, inertia: 0.14, friction: [11, 0.018], bank: 'f6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.15, bass: 2,
    torque: [[900, 150], [1500, 180], [2500, 215], [3000, 265], [3500, 315], [4000, 343], [4500, 340], [5500, 332], [6000, 310], [6500, 270], [6900, 150]] },
  F6_33T: { name: '3.3 turbo flat-six (intercooled)', idleRpm: 900, redline: 6800, limiter: 7000, inertia: 0.14, friction: [11, 0.018], bank: 'f6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 12, cyl: 6, loud: 1.2, bass: 2,
    torque: [[900, 170], [1500, 205], [2500, 250], [3000, 320], [3500, 385], [4000, 412], [4500, 405], [5500, 384], [6000, 360], [6500, 300], [6900, 160]] },
  // the R34 GT-R's RB26DETT 2.6 twin-turbo straight-six: 206 kW and 392 Nm on paper (the Japanese makers' gentlemen's
  // agreement), about 235 kW at 6,800 rpm and 440 Nm at 4,400 on a dyno; and the Nismo Z-tune's 2.8: 368 kW, 540 Nm
  RB26: { name: 'RB26DETT 2.6 twin-turbo straight-six', idleRpm: 900, redline: 8000, limiter: 8200, inertia: 0.15, friction: [11, 0.019], bank: 'i6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.2, bass: 2,
    torque: [[900, 240], [1500, 290], [2500, 360], [3500, 415], [4400, 440], [5000, 432], [6000, 375], [6800, 330], [7500, 285], [8000, 228], [8300, 130]] },
  RB26Z: { name: 'RB26 2.8 (Nismo Z-tune)', idleRpm: 900, redline: 8000, limiter: 8200, inertia: 0.15, friction: [11, 0.019], bank: 'i6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 10, cyl: 6, loud: 1.3, bass: 3,
    torque: [[900, 250], [1500, 300], [2500, 380], [3500, 470], [4500, 525], [5200, 540], [6000, 535], [6800, 517], [7500, 470], [8000, 400], [8300, 200]] },
  // the R35 GT-R's VR38DETT 3.8 twin-turbo V6 (2008): 357 kW at 6,400 rpm, 588 Nm from 3,200 to 5,200; and the
  // Nismo's (2017): 441 kW at 6,800, 652 Nm
  VR38: { name: 'VR38DETT 3.8 twin-turbo V6', idleRpm: 750, redline: 7000, limiter: 7200, inertia: 0.18, friction: [13, 0.021], bank: 'v6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.25, bass: 3,
    torque: [[750, 300], [1500, 420], [2500, 540], [3200, 588], [5200, 588], [6000, 565], [6400, 533], [6800, 480], [7200, 300]] },
  VR38N: { name: 'VR38DETT (Nismo)', idleRpm: 750, redline: 7100, limiter: 7300, inertia: 0.18, friction: [13, 0.021], bank: 'v6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.3, bass: 3,
    torque: [[750, 320], [1500, 450], [2500, 580], [3600, 652], [5600, 652], [6400, 640], [6800, 619], [7100, 560], [7400, 320]] },
  // the FD RX-7's 13B-REW twin-rotor Wankel with sequential twin turbos: 188 kW at 6,500 rpm, 294 Nm at 5,000 (a twin
  // rotor fires as often as a four); and the Cosmo's 20B-REW three-rotor: 206 kW, 403 Nm at 1,800 (as a six)
  R13B: { name: '13B-REW twin-rotor (sequential turbos)', idleRpm: 850, redline: 8000, limiter: 8200, inertia: 0.11, friction: [11, 0.02], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 4, loud: 1.15,
    torque: [[850, 140], [1500, 170], [2500, 240], [3500, 270], [4500, 280], [5000, 294], [6000, 290], [6500, 276], [7500, 230], [8000, 200], [8300, 100]] },
  R20B: { name: '20B-REW three-rotor', idleRpm: 850, redline: 8000, limiter: 8200, inertia: 0.13, friction: [13, 0.022], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 30, cyl: 6, loud: 1.25,
    torque: [[850, 200], [1500, 330], [1800, 403], [3000, 400], [4500, 380], [5500, 340], [6500, 302], [7500, 250], [8000, 200], [8300, 100]] },
  // the Senna's M840TR 4.0 twin-turbo flat-plane V8: 588 kW at 7,250 rpm, 800 Nm from 5,500 to 6,700; and the Senna
  // GTR's: 607 kW
  M840TR: { name: 'M840TR 4.0 twin-turbo V8', idleRpm: 900, redline: 8250, limiter: 8450, inertia: 0.15, friction: [14, 0.021], bank: 'v6', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.45, bass: 4,
    torque: [[900, 380], [1500, 420], [2500, 560], [3500, 680], [4500, 760], [5500, 800], [6700, 800], [7250, 774], [7750, 700], [8250, 610], [8500, 350]] },
  M840TRG: { name: 'M840TR 4.0 twin-turbo V8 (Senna GTR)', idleRpm: 900, redline: 8250, limiter: 8450, inertia: 0.15, friction: [14, 0.021], bank: 'v6', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.5, bass: 4,
    torque: [[900, 380], [1500, 420], [2500, 560], [3500, 680], [4500, 760], [5500, 800], [7250, 800], [7750, 725], [8250, 640], [8500, 360]] },
  // the Impreza STi's EJ20 2.0 turbo boxer four: 206 kW at 6,500 rpm, 353 Nm at 4,000; and the 22B's EJ22 2.2: 206 kW
  // at 6,000, 363 Nm at 3,200
  EJ20: { name: 'EJ20 2.0 turbo boxer four', idleRpm: 850, redline: 7500, limiter: 7700, inertia: 0.13, friction: [10, 0.017], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 4, loud: 1.2, bass: 2,
    torque: [[850, 140], [1500, 170], [2500, 250], [3000, 300], [4000, 353], [5000, 345], [6500, 302], [7000, 280], [7500, 240], [7900, 130]] },
  EJ22: { name: 'EJ22 2.2 turbo boxer four (22B)', idleRpm: 850, redline: 7200, limiter: 7400, inertia: 0.14, friction: [10, 0.018], bank: 'i4', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 5, cyl: 4, loud: 1.25, bass: 2,
    torque: [[850, 160], [1500, 200], [2500, 300], [3200, 363], [4500, 355], [5500, 340], [6000, 328], [6800, 280], [7300, 140]] },
  // the Supra's 2JZ-GTE 3.0 twin-turbo straight-six (export): 239 kW at 5,600 rpm, 427 Nm at 4,000; and a big
  // single-turbo conversion on the stock block, the tuners' favourite: about 600 kW
  // the R8 V10 plus's 5.2 FSI V10: 449 kW at 8,250 rpm, 560 Nm at 6,500; and the 2019 V10 performance's: 456 kW at
  // 8,000, 580 Nm at 6,600
  V10_R8: { name: '5.2 FSI V10', idleRpm: 800, redline: 8700, limiter: 8900, inertia: 0.15, friction: [14, 0.021], bank: 'v10', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 10, loud: 1.35, bass: 3,
    torque: [[800, 290], [2000, 390], [3000, 450], [4000, 490], [5000, 520], [6000, 550], [6500, 560], [7500, 540], [8250, 520], [8700, 490], [9000, 300]] },
  V10_R8P: { name: '5.2 FSI V10 (performance)', idleRpm: 800, redline: 8700, limiter: 8900, inertia: 0.15, friction: [14, 0.021], bank: 'v10', turbo: 0, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 10, loud: 1.4, bass: 3,
    torque: [[800, 300], [2000, 405], [3000, 465], [4000, 505], [5000, 540], [6000, 568], [6600, 580], [7500, 562], [8000, 544], [8700, 500], [9000, 310]] },
  // the G 63's M157 5.5 twin-turbo V8 (2015): 420 kW at 5,500 rpm, 760 Nm from 1,750 to 5,250; and the G 65's M279
  // 6.0 twin-turbo V12: 463 kW at 4,800-5,100, 1,000 Nm from 2,300 to 4,300
  M157: { name: 'M157 5.5 twin-turbo V8', idleRpm: 650, redline: 6500, limiter: 6700, inertia: 0.24, friction: [17, 0.025], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 0, cyl: 8, loud: 1.4, bass: 6,
    torque: [[650, 400], [1000, 520], [1500, 690], [1750, 760], [5250, 760], [5500, 729], [6000, 640], [6500, 560], [6800, 300]] },
  M279: { name: 'M279 6.0 twin-turbo V12', idleRpm: 600, redline: 6000, limiter: 6200, inertia: 0.3, friction: [20, 0.028], bank: 'v8s', turbo: 2, sound: 'v8_muscle', pitch: 1, mass: 90, cyl: 12, loud: 1.4, bass: 6,
    torque: [[600, 500], [1000, 700], [1500, 900], [2300, 1000], [4300, 1000], [5100, 867], [5600, 760], [6000, 600], [6300, 320]] },
  JZ2: { name: '2JZ-GTE 3.0 twin-turbo straight-six', idleRpm: 750, redline: 6800, limiter: 7000, inertia: 0.17, friction: [12, 0.02], bank: 'i6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 0, cyl: 6, loud: 1.2, bass: 3,
    torque: [[750, 220], [1500, 280], [2500, 360], [3500, 410], [4000, 427], [4800, 425], [5600, 407], [6200, 370], [6800, 320], [7100, 160]] },
  JZ2S: { name: '2JZ single-turbo conversion', idleRpm: 800, redline: 7800, limiter: 8000, inertia: 0.17, friction: [12, 0.02], bank: 'i6', turbo: 2, sound: 'i6_bmw', pitch: 1, mass: 15, cyl: 6, loud: 1.4, bass: 4,
    torque: [[800, 220], [2000, 300], [3000, 450], [4000, 700], [5000, 880], [5500, 900], [6500, 880], [7200, 800], [7800, 700], [8200, 350]] },
};
/** The same engine tuned: more torque (k) above idle, a little more revs (for a diesel: more fuel, more boost); a
 * petrol V8 with a cam sounds it (the cammed V8's bank). */
const tunedBy = (k, revs = 200) => (e) => ({ ...e, name: `${e.name} tuned`, redline: e.redline + revs, limiter: e.limiter + revs, mass: e.mass + 6,
  bank: e.bank === 'v8' ? 'v8m' : e.bank,
  torque: e.torque.map(([r, t]) => [r, Math.round(t * (r < 1000 ? 1 + (k - 1) * 0.3 : k))]) });
const tuned = tunedBy(1.13);
export const ENGINES = {
  ranger: [{ ...ENGINE.I4_27, short: 'stock', desc: 'Stock ZMZ 2.7 four: 94 kW, 209 Nm high up at 3,900 rpm. It needs revs.' }, { ...tuned(ENGINE.I4_27), short: 'tuned', desc: 'A cam, a freer exhaust and a remap: +13% torque.' }, { ...ENGINE.D22Z, short: 'diesel', desc: 'The ZMZ 2.2 turbo-diesel: 270 Nm from 1,600 rpm, +29% torque low down, 40 kg more over the front axle.' }],
  hauler: [{ ...ENGINE.V8_66, short: 'stock', desc: 'Stock 6.6 V8.' }, { ...tuned(ENGINE.V8_66), short: 'tuned', desc: 'Cam, carburettor and headers: +13% torque.' }, { ...ENGINE.V8_75, short: '7.5 swap', mass: 45, desc: 'Big-block swap: +27% torque.' }],
  mule: [{ ...ENGINE.I4_22, short: 'stock', desc: 'Stock 2.2 Go Devil four: 45 kW, 142 Nm at 2,000 rpm. It plods.' }, { ...tuned(ENGINE.I4_22), short: 'tuned', desc: 'Higher compression, a bigger carburettor and a split manifold: +13% torque.' }, { ...ENGINE.V8_50, short: 'V8 swap', mass: 75, desc: 'The hot-rodder\'s small-block V8: more than twice the torque, 75 kg more over the front axle.' }],
  gecko: [{ ...ENGINE.I4_17, short: 'stock', desc: 'Stock VAZ 1.7 four: 59.5 kW, 127 Nm. It needs revs.' }, { ...tuned(ENGINE.I4_17), short: 'tuned', desc: 'A cam, a freer exhaust and a remap: +13% torque.' }, { ...ENGINE.D22Z, short: 'diesel', desc: 'A 2.2 turbo-diesel squeezed in: 270 Nm from 1,600 rpm, more than twice the torque, 40 kg more over the front axle.' }],
  trekker: [{ ...ENGINE.D20BT, short: 'stock', desc: 'Stock EcoBlue 2.0 bi-turbo diesel: 157 kW, 500 Nm from 1,750 rpm.' }, { ...tunedBy(1.15, 100)(ENGINE.D20BT), short: 'remap', desc: 'An ECU remap: +15% torque.' }, { ...ENGINE.V6_30T, short: '3.0 V6', desc: 'The next Raptor\'s 3.0 EcoBoost twin-turbo V6 petrol: 312 kW and 597 Nm, 25 kg heavier.' }],
  shepherd: [{ ...ENGINE.D30I6, short: 'stock', desc: 'Stock D350 3.0 straight-six turbo-diesel, mild hybrid: 257 kW, 700 Nm from 1,500 to 3,000 rpm.' }, { ...tunedBy(1.12, 100)(ENGINE.D30I6), short: 'remap', desc: 'An ECU remap: +12% torque.' }, { ...ENGINE.V8_44TT, short: 'OCTA V8', desc: 'The Defender OCTA\'s 4.4 twin-turbo V8, mild hybrid: 467 kW and 750 Nm, revs to 7,000, 40 kg heavier.' }],
  drover: [{ ...ENGINE.D32, short: 'stock', desc: 'Stock 3.2 DI-D turbo-diesel four: 118 kW, 373 Nm from 2,000 rpm.' }, { ...tunedBy(1.15, 100)(ENGINE.D32), short: 'remap', desc: 'An ECU remap and a bigger intercooler: +15% torque.' }, { ...ENGINE.V6_38M, short: '3.8 V6', desc: 'The 3.8 MIVEC V6 petrol: 184 kW, revs to 6,000, 30 kg lighter.' }],
  bruiser: [{ ...ENGINE.V8_64HD, short: 'stock', desc: 'Stock 6.4 HEMI V8: 306 kW at 5,600 rpm, 582 Nm at 4,000.' }, { ...tunedBy(1.1, 200)(ENGINE.V8_64HD), short: 'tuned', desc: 'A cold-air intake, headers and a tune: +10% torque.' }, { ...ENGINE.I6_67CR, short: 'Cummins', mass: 300, desc: 'The 6.7 Cummins turbo-diesel six: 880 Nm, half as much again, and 300 kg more over the front axle.' }],
  wrangler: [{ ...ENGINE.V6_36, short: 'stock', desc: 'Stock 3.6 Pentastar V6: 213 kW at 6,400 rpm, 353 Nm at 4,800. It likes revs.' }, { ...tunedBy(1.12, 200)(ENGINE.V6_36), short: 'tuned', desc: 'A cold-air intake, an exhaust and a tune: +12% torque.' }, { ...ENGINE.V8_64, short: '392 HEMI', desc: 'The 6.4 HEMI V8 swap: 350 kW and 637 Nm, +80% torque, 60 kg heavier.' }],
  hummer: [{ ...ENGINE.V8_66D, short: 'stock', desc: 'Stock 6.6 Duramax turbo-diesel V8: 224 kW at 3,200 rpm, 705 Nm at 1,800.' }, { ...tunedBy(1.2, 100)(ENGINE.V8_66D), short: 'tuned', desc: 'A tune, bigger injectors and an intercooler: +20% torque.' }, { ...ENGINE.V8_66L5P, short: 'L5P swap', desc: 'The later L5P Duramax: 332 kW and 1,234 Nm, +75% torque, 30 kg heavier.' }],
  bronco: [{ ...ENGINE.V6_27T, short: 'stock', desc: 'Stock 2.7 EcoBoost twin-turbo V6: 246 kW at 5,250 rpm, 563 Nm at 3,100.' }, { ...tunedBy(1.12, 200)(ENGINE.V6_27T), short: 'tuned', desc: 'A tune, a bigger intercooler and a downpipe: +12% torque.' }, { ...ENGINE.V6_30T, short: '3.0 Raptor', desc: 'The Bronco Raptor\'s 3.0 EcoBoost V6: 312 kW and 597 Nm, 25 kg heavier.' }],
  thar: [{ ...ENGINE.D22, short: 'stock', desc: 'Stock mHawk 2.2 turbo-diesel: 96 kW, 300 Nm from 1,600 to 2,800 rpm.' }, { ...tunedBy(1.2, 100)(ENGINE.D22), short: 'remap', desc: 'An ECU remap and a bigger intercooler: 360 Nm, 115 kW.' }, { ...ENGINE.P20, short: 'petrol', desc: 'The mStallion 2.0 turbo-petrol: 112 kW and 320 Nm, revs to 5,500, 20 kg lighter.' }],
  roxx: [{ ...ENGINE.D22R, short: 'stock', desc: 'Stock mHawk 2.2 turbo-diesel in the Roxx\'s tune: 129 kW (175 PS), 370 Nm from 1,500 to 3,000 rpm.' }, { ...tunedBy(1.15, 100)(ENGINE.D22R), short: 'remap', desc: 'An ECU remap and a bigger intercooler: +15% torque.' }, { ...ENGINE.P20R, short: 'petrol', desc: 'The Roxx\'s mStallion 2.0 turbo-petrol: 130 kW and 380 Nm, revs to 5,500, 20 kg lighter.' }],
  hummerev: [{ ...ENGINE.E_3M, short: 'stock', desc: 'Three motors, one in front and two at the back: 746 kW (1,000 hp), and all of their torque from a standstill.' },
    { ...ENGINE.E_3M, name: 'Three motors, Watts to Freedom', short: 'WTF', desc: 'The launch mode\'s calibration kept on: the battery let out harder, +10% torque.',
      torque: ENGINE.E_3M.torque.map(([r, t]) => [r, Math.round(t * 1.1)]) },
    { ...ENGINE.E_3M, name: 'Two motors (EV2X)', short: '2 motors', mass: -110, desc: 'One motor front and one rear: 425 kW (570 hp), 110 kg lighter.',
      torque: ENGINE.E_3M.torque.map(([r, t]) => [r, Math.round(t * 0.6)]) }],
  cybertruck: [{ ...ENGINE.E_CB, short: 'stock', desc: 'Three motors, one in front and two at the back: 630 kW (845 hp), all of their torque from a standstill.' },
    { ...ENGINE.E_CB, name: 'Three motors, Beast Mode', short: 'Beast', desc: 'The launch mode\'s calibration kept on: the battery let out harder, +10% torque.',
      torque: ENGINE.E_CB.torque.map(([r, t]) => [r, Math.round(t * 1.1)]) },
    { ...ENGINE.E_CB, name: 'Two motors (AWD)', short: '2 motors', mass: -95, desc: 'The all-wheel-drive Cybertruck\'s pair, one front and one rear: 447 kW (600 hp), 95 kg lighter.',
      torque: ENGINE.E_CB.torque.map(([r, t]) => [r, Math.round(t * 0.72)]) }],
  rhino: [{ ...ENGINE.I6_57D, short: 'stock', desc: 'Stock OM 352 5.7 diesel six: 96 kW (130 hp), 363 Nm. Governed at 2,800 rpm.' }, { ...tunedBy(1.3, 0)(ENGINE.I6_57D), turbo: 1, short: 'turbo', desc: 'A turbocharger: +30% torque, 125 kW.' }, { ...ENGINE.I6_60TD, short: '6.0 swap', desc: 'A 6.0 turbo-intercooled six: 600 Nm, +65% torque.' }],
  gclass: [{ ...ENGINE.M157, short: 'stock', desc: 'Stock M157 5.5 twin-turbo V8: 420 kW (571 PS) at 5,500 rpm, 760 Nm from 1,750 to 5,250.' },
    { ...tunedBy(1.1, 0)(ENGINE.M157), short: 'tuned', desc: 'A remap and freer downpipes: +10% torque.' },
    { ...ENGINE.M279, short: 'G 65 V12', desc: 'The G 65\'s M279 6.0 twin-turbo V12: 463 kW and 1,000 Nm, 90 kg more over the front axle.' }],
  // ---- the road cars
  m4csl: [{ ...ENGINE.S58, short: 'stock', desc: 'Stock S58 3.0 twin-turbo straight-six in the CSL\'s tune: 405 kW (550 PS) at 6,250 rpm, 650 Nm from 2,750 to 5,950.' },
    { ...tunedBy(1.12, 0)(ENGINE.S58), short: 'tuned', desc: 'A remap, downpipes and a bigger intercooler: +12% torque.' },
    { ...ENGINE.S63, short: 'V8 swap', desc: 'The M5 CS\'s S63 4.4 twin-turbo V8: 467 kW and 750 Nm, 45 kg more over the front axle.' }],
  amggt: [{ ...ENGINE.M178S, short: 'stock', desc: 'Stock M178 4.0 twin-turbo V8 of the GT S, its turbos inside the vee: 375 kW (510 PS) at 6,250 rpm, 650 Nm from 1,750 to 4,750.' },
    { ...tunedBy(1.12, 0)(ENGINE.M178S), short: 'tuned', desc: 'A remap and freer downpipes: +12% torque.' },
    { ...ENGINE.M178R, short: 'GT R', desc: 'The GT R\'s M178: bigger turbos, 430 kW (585 PS) and 700 Nm.' }],
  c8: [{ ...ENGINE.LT2, short: 'stock', desc: 'Stock LT2 6.2 pushrod V8 with the Z51\'s exhaust: 369 kW (495 hp) at 6,450 rpm, 637 Nm at 5,150.' },
    { ...tunedBy(1.08, 200)(ENGINE.LT2), short: 'tuned', desc: 'Long-tube headers, a cold-air intake and a tune: +8% torque, 200 rpm more.' },
    { ...ENGINE.LT6, short: 'Z06 LT6', desc: 'The Z06\'s LT6 5.5 flat-plane V8: 499 kW (670 hp) at 8,400 rpm, and a howl to 8,600.' }],
  huracan: [{ ...ENGINE.V10_52, short: 'stock', desc: 'Stock 5.2 V10: 449 kW (610 PS) at 8,250 rpm, 560 Nm at 6,500.' },
    { ...tunedBy(1.06, 0)(ENGINE.V10_52), short: 'tuned', desc: 'A freer exhaust and a remap: +6% torque.' },
    { ...ENGINE.V10_52P, short: 'Performante', desc: 'The Performante\'s V10: titanium valves, 470 kW (640 PS) and 600 Nm.' }],
  r8: [{ ...ENGINE.V10_R8, short: 'stock', desc: 'Stock 5.2 FSI V10 of the V10 plus: 449 kW (610 PS) at 8,250 rpm, 560 Nm at 6,500.' },
    { ...tunedBy(1.06, 0)(ENGINE.V10_R8), short: 'tuned', desc: 'A freer exhaust and a remap: +6% torque.' },
    { ...ENGINE.V10_R8P, short: 'performance', desc: 'The 2019 V10 performance\'s: 456 kW (620 PS) and 580 Nm.' }],
  m3e30: [{ ...ENGINE.S14, short: 'stock', desc: 'Stock S14 2.3 four: 147 kW (200 PS) at 6,750 rpm, 240 Nm at 4,750. It wants revs.' },
    { ...tunedBy(1.08, 200)(ENGINE.S14), short: 'tuned', desc: 'Sharper cams, a freer exhaust and a chip: +8% torque, 200 rpm more.' },
    { ...ENGINE.S14E, short: 'Evo 2.5', desc: 'The Sport Evolution\'s 2.5 S14: 175 kW (238 PS) at 7,000 rpm.' }],
  nsx: [{ ...ENGINE.C30A, short: 'stock', desc: 'Stock C30A 3.0 VTEC V6: 201 kW (274 PS) at 7,100 rpm, 284 Nm at 5,300; VTEC kicks in at 5,800.' },
    { ...tunedBy(1.07, 200)(ENGINE.C30A), short: 'tuned', desc: 'Headers, an intake and a remap: +7% torque, 200 rpm more.' },
    { ...ENGINE.C32B, short: 'C32B 3.2', desc: 'The later C32B 3.2 VTEC V6: 216 kW (294 PS) and 304 Nm.' }],
  p930: [{ ...ENGINE.F6_30T, short: 'stock', desc: 'Stock 3.0 turbo flat-six: 191 kW (260 PS) at 5,500 rpm, 343 Nm at 4,000, and almost nothing until the turbo wakes at 3,000.' },
    { ...tunedBy(1.15, 0)(ENGINE.F6_30T), short: 'tuned', desc: 'More boost and a richer injection map: +15% torque.' },
    { ...ENGINE.F6_33T, short: '3.3 IC', desc: 'The 1978 Turbo\'s intercooled 3.3: 221 kW (300 PS) and 412 Nm.' }],
  r34: [{ ...ENGINE.RB26, short: 'stock', desc: 'Stock RB26DETT 2.6 twin-turbo straight-six: 280 PS on paper, about 320 PS (235 kW) at 6,800 rpm and 440 Nm at 4,400 in fact.' },
    { ...tunedBy(1.25, 0)(ENGINE.RB26), short: 'boost up', desc: 'The tuners\' classic: more boost, a front-mount intercooler, a remap. +25% torque.' },
    { ...ENGINE.RB26Z, short: 'Z-tune', desc: 'The Nismo Z-tune\'s 2.8 RB26: 368 kW (500 PS) and 540 Nm.' }],
  r35: [{ ...ENGINE.VR38, short: 'stock', desc: 'Stock VR38DETT 3.8 twin-turbo V6, hand-built: 357 kW (485 PS) at 6,400 rpm, 588 Nm from 3,200 to 5,200.' },
    { ...tunedBy(1.15, 0)(ENGINE.VR38), short: 'tuned', desc: 'A remap, an intake and downpipes: +15% torque.' },
    { ...ENGINE.VR38N, short: 'Nismo', desc: 'The Nismo\'s VR38: GT3 turbos, 441 kW (600 PS) and 652 Nm.' }],
  rx7: [{ ...ENGINE.R13B, short: 'stock', desc: 'Stock 13B-REW twin-rotor Wankel, sequential twin turbos: 188 kW (255 PS) at 6,500 rpm, 294 Nm at 5,000.' },
    { ...tunedBy(1.15, 0)(ENGINE.R13B), short: 'tuned', desc: 'A bigger intercooler, more boost and a remap: +15% torque.' },
    { ...ENGINE.R20B, short: '20B swap', desc: 'The Cosmo\'s 20B-REW three-rotor: 206 kW and 403 Nm from 1,800 rpm, 30 kg more.' }],
  senna: [{ ...ENGINE.M840TR, short: 'stock', desc: 'Stock M840TR 4.0 twin-turbo flat-plane V8: 588 kW (800 PS) at 7,250 rpm, 800 Nm from 5,500 to 6,700.' },
    { ...tunedBy(1.06, 0)(ENGINE.M840TR), short: 'tuned', desc: 'A remap: +6% torque.' },
    { ...ENGINE.M840TRG, short: 'GTR', desc: 'The Senna GTR\'s: 607 kW (825 PS), and 800 Nm to 7,250 rpm.' }],
  sti: [{ ...ENGINE.EJ20, short: 'stock', desc: 'Stock EJ20 2.0 turbo boxer four: 206 kW (280 PS) at 6,500 rpm, 353 Nm at 4,000, and the boxer\'s burble.' },
    { ...tunedBy(1.18, 0)(ENGINE.EJ20), short: 'tuned', desc: 'A bigger turbo and a remap: +18% torque.' },
    { ...ENGINE.EJ22, short: '22B 2.2', desc: 'The 22B\'s EJ22 2.2: 206 kW and 363 Nm at 3,200, more of it lower down.' }],
  supra: [{ ...ENGINE.JZ2, short: 'stock', desc: 'Stock 2JZ-GTE 3.0 twin-turbo straight-six: 239 kW (326 PS) at 5,600 rpm, 427 Nm at 4,000.' },
    { ...tunedBy(1.25, 0)(ENGINE.JZ2), short: 'tuned', desc: 'More boost, bigger injectors and a remap: +25% torque. The block shrugs.' },
    { ...ENGINE.JZ2S, short: 'single turbo', desc: 'A big single-turbo conversion on the stock bottom end: about 600 kW (800 hp) and 900 Nm.' }],
};

const gearOption = (r) => ({ name: `${r.toFixed(2)}:1 ring and pinion`, short: r.toFixed(2), ratio: r, desc: 'Deeper (bigger number) gears turn the wheels slower and harder: they bring back the pull bigger tyres take away, and lower the top speed.' });

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
    options: AXLE_RATIOS.map((r) => gearOption(r)),
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
export function optionsFor(cat, truckId) {
  if (cat.id === 'engine') return ENGINES[truckId] || ENGINES.ranger;
  const base = TRUCK_BASES[truckId];
  if (cat.id === 'gears' && base?.axleRatios) return base.axleRatios.map(gearOption);
  if (cat.id === 'tyre' && base?.stockTyre) return cat.options.map((o) => (o.d === base.stock.tyre ? { ...o, name: `${o.d}" tyres (${base.stockTyre.label}, factory)`, desc: base.stockTyre.desc || o.desc } : o));
  return cat.options;
}
/** The trucks' stock specs, registered by trucks.js (for the options that depend on the truck). */
export const TRUCK_BASES = {};
/** A truck's tyre of a size: its factory tyre in the stock size (when it has its own), else the usual one. */
export const tyreFor = (base, d) => (d === base.stock.tyre && base.stockTyre ? { ...TYRES[d], ...base.stockTyre } : TYRES[d]);

// ---------------------------------------------------------------- prices (US dollars, parts and fitting)
/** What each part costs to buy and fit; the truck's factory parts are free. Tyres are a set of five. */
export const PRICES = {
  lift: [0, 900, 2200, 5800],
  tyre: { 24: 1100, 25: 1400, 26: 1800, 27: 520, 28: 600, 29: 720, 30: 850, 31: 950, 33: 1300, 35: 1750, 37: 2400, 40: 3300, 42: 4500, 44: 5900, 46: 7400 },
  tread: [0, 400, 350, 900, 1500],
  wheels: [0, 650, 2100, 0],
  gears: 1600,                       // any ratio but the factory one: both axles re-geared
  tcase: [0, 1900],
  diffs: [0, 750, 1100, 2200, 900],
  trans: [1800, 1200, 1600, 1500, 2200, 2400, 5200, 1900, 2600, 2400, 1800, 3200, 3600, 0, 2400, 3400,  // a different gearbox swapped in
    4200, 3800, 3600, 3400, 3200, 3000, 6500, 4000, 9500, 9000, 12000, 8500, 9000, 8800, 6800, 11000, 5200],
  engine: [0, 1500, 4800],
  intake: [0, 450],
  winch: [0, 1300],
  armor: [0, 700, 1350],
  lights: [0, 480],
  rack: [0, 520, 900],
};

/** Price of part value v in category cat for a truck (0 for its factory part); a big truck's parts cost more. */
export function partPrice(base, cat, v) {
  const stock = stockBuild(base)[cat];
  if (v === stock) return 0;
  const p = PRICES[cat];
  const raw = cat === 'tyre' ? p[v] || 0 : typeof p === 'number' ? p : p?.[v] || 0;
  return Math.round(raw * (cat === 'tyre' ? 1 : base.parts ?? 1) / 10) * 10;
}

// ---------------------------------------------------------------- builds
/** Each truck's factory build (indices; tyre is the diameter). Some come with lockers, onboard air or a raised intake. */
export function stockBuild(base) {
  const st = base.stock;
  return {
    lift: 0, tyre: st.tyre, tread: st.tread ?? 0, wheels: st.wheels ?? 0, gears: ratiosFor(base).indexOf(st.axle), tcase: 0,
    diffs: st.diffs ?? 0, trans: st.trans, engine: 0, intake: st.intake ?? 0, winch: 0, armor: 0, lights: 0, rack: 0,
  };
}

const step = (list, v, k) => list[clamp(list.indexOf(v) + k, 0, list.length - 1)];
// (a truck with an eight-speed or a six-speed keeps its own: the crawl box does the rest)
const truckBox = (b, t) => { const g = TRANSMISSIONS[b.trans]?.gears; return g && (g[0] > 8 || g.length >= 6) ? b.trans : t; };
/** Ready-made builds, relative to the truck's stock sizes. */
export const PRESETS = [
  { id: 'stock', name: 'Stock', desc: 'As it left the factory.', make: (b) => b },
  { id: 'trail', name: 'Weekend trail', desc: '2" lift, one size bigger A/Ts, deeper gears, rear locker, skids, onboard air.',
    make: (b, base) => ({ ...b, lift: 1, tyre: step(TYRE_SIZES, b.tyre, 1), wheels: 1, gears: Math.min(b.gears + 1, ratiosFor(base).length - 1), diffs: 2, armor: 1, rack: 1 }) },
  { id: 'crawler', name: 'Rock crawler', desc: '4" lift, 35" M/Ts on beadlocks (bigger on a big truck), deeper gears, lockers both ends, 4:1 box, granny gearbox, armour.',
    make: (b, base) => ({ ...b, lift: 2, tyre: b.tyre <= 33 ? 35 : step(TYRE_SIZES, b.tyre, 1), tread: 1, wheels: 2, gears: Math.max(Math.min(3, ratiosFor(base).length - 2), b.gears), tcase: 1, diffs: 3, trans: truckBox(b, 2), engine: 1, winch: 1, armor: 2, lights: 1, rack: 0 }) },
  { id: 'mudder', name: 'Mud bogger', desc: '6" long-travel, 37" bias-ply mudders (bigger on a big truck), the deepest gears, lockers, snorkel, engine swap, light bar.',
    make: (b, base) => ({ ...b, lift: 3, tyre: b.tyre <= 35 ? 37 : step(TYRE_SIZES, b.tyre, 2), tread: 2, wheels: 1, gears: Math.max(Math.min(4, ratiosFor(base).length - 1), b.gears), tcase: 0, diffs: 3, trans: truckBox(b, 0), engine: 2, intake: 1, winch: 1, armor: 1, lights: 1, rack: 0 }) },
  { id: 'overland', name: 'Overlander', desc: 'Mild lift and A/Ts, snorkel, rear locker, big winch, armour, roof rack with fuel and water.',
    make: (b, base) => ({ ...b, lift: 1, tyre: step(TYRE_SIZES, b.tyre, 1), wheels: 1, gears: Math.min(b.gears + 1, ratiosFor(base).length - 1), diffs: 2, engine: 1, intake: 1, winch: 1, armor: 2, lights: 1, rack: 2 }) },
];

/** A road car's ready-made builds (the off-road ones would only bottom it out). */
export const ROAD_PRESETS = [
  { id: 'stock', name: 'Stock', desc: 'As it left the factory.', make: (b) => b },
  { id: 'track', name: 'Track day', desc: 'Semi-slick tyres, a limited-slip diff and the engine tuned.', make: (b) => ({ ...b, tread: 4, diffs: 1, engine: 1 }) },
  { id: 'safari', name: 'Safari', desc: 'Raised 2" on all-terrain tyres, a roof rack: a supercar for the gravel, as the 911 Dakar and the Huracán Sterrato are.', make: (b) => ({ ...b, lift: 1, tread: 0, rack: 1 }) },
  { id: 'max', name: 'Flat out', desc: 'The strongest engine, semi-slicks and a limited-slip diff.', make: (b) => ({ ...b, tread: 4, diffs: 1, engine: 2 }) },
];
/** The ready-made builds for a truck (or a road car). */
export const presetsFor = (base) => (base?.road ? ROAD_PRESETS : PRESETS);

export function presetBuild(base, id) {
  const list = presetsFor(base), p = list.find((x) => x.id === id) || list[0], s = stockBuild(base), b = p.make(s, base);
  // a preset never takes away what the truck came with (factory lockers, onboard air, a raised intake, its power)
  if (DIFF_RANK[b.diffs] < DIFF_RANK[s.diffs]) b.diffs = s.diffs;
  const eng = ENGINES[base.id], peak = (e) => Math.max(...e.torque.map((q) => q[1]));
  if (eng && eng[b.engine] && peak(eng[b.engine]) < peak(eng[s.engine])) b.engine = s.engine;
  for (const cat of ['wheels', 'intake']) b[cat] = Math.max(b[cat], s[cat]);
  return normalizeBuild(base, b);
}

/** The biggest tyre (in) a lift makes room for: it fits at fit + lift, and up to 2" more rubs (bump stops extended). */
export const maxTyre = (base, lift) => base.stock.fit + LIFTS[lift].inches + 2;

/** A few words for a build: its preset's name, or what has changed from stock. */
export function buildSummary(base, build) {
  const b = normalizeBuild(base, build), code = encodeBuild(b);
  for (const p of presetsFor(base)) if (encodeBuild(presetBuild(base, p.id)) === code) return p.name;
  const s = stockBuild(base), out = [];
  if (b.lift !== s.lift) out.push(`${LIFTS[b.lift].inches}" lift`);
  if (b.tyre !== s.tyre || b.tread !== s.tread) out.push(`${b.tyre}" ${TREADS[b.tread].short}`);
  if (b.gears !== s.gears) out.push(`${ratiosFor(base)[b.gears].toFixed(2)}s`);
  if (b.diffs !== s.diffs) out.push(DIFFS[b.diffs].short);
  if (b.tcase !== s.tcase) out.push('4:1 box');
  if (b.trans !== s.trans) out.push(TRANSMISSIONS[b.trans].short);
  if (b.engine !== s.engine) out.push(ENGINES[base.id][b.engine].short);
  if (b.intake !== s.intake) out.push(b.intake ? 'snorkel' : 'stock air cleaner');
  if (b.wheels !== s.wheels) out.push(WHEELS[b.wheels].short);
  if (b.winch) out.push('12k winch');
  if (b.armor) out.push(ARMOR[b.armor].short);
  if (b.lights) out.push('light bar');
  if (b.rack) out.push(b.rack === 2 ? 'loaded rack' : 'rack');
  return out.length ? out.join(', ') : 'Stock';
}

/**
 * Whether a truck can take option i of a category: not what its own `only` leaves out (for tyres, the diameters it
 * takes), a road car's parts (`road`) only on a road car, and the electric gearbox only behind electric motors.
 */
export function optionAllowed(base, catId, i) {
  if (catId === 'tyre') {
    const d = TYRE_SIZES[i];
    return !!TYRES[d] && !(TYRES[d].road && !base.road) && !(base.only?.tyre && !base.only.tyre.includes(d));
  }
  if (base.only?.[catId] && !base.only[catId].includes(i)) return false;
  if (CATEGORIES.find((c) => c.id === catId)?.options?.[i]?.road && !base.road) return false;
  if (catId === 'trans' && TRANSMISSIONS[i]?.type === 'direct' && !ENGINES[base.id]?.[0]?.electric) return false;
  return true;
}

/** Clamp every choice to a valid one; missing ones come from stock. */
export function normalizeBuild(base, build) {
  const s = stockBuild(base), b = { ...s, ...(build || {}) };
  for (const cat of CATEGORIES) {
    if (cat.id === 'tyre') continue;
    const n = optionsFor(cat, base.id).length;
    b[cat.id] = Number.isInteger(b[cat.id]) ? clamp(b[cat.id], 0, n - 1) : s[cat.id];
    if (!optionAllowed(base, cat.id, b[cat.id])) b[cat.id] = s[cat.id];
  }
  const tyreOk = (d) => TYRE_SIZES.includes(d) && d >= base.stock.tyre && optionAllowed(base, 'tyre', TYRE_SIZES.indexOf(d));
  if (!tyreOk(b.tyre)) b.tyre = s.tyre;
  while (b.tyre > maxTyre(base, b.lift)) b.tyre = TYRE_SIZES[TYRE_SIZES.indexOf(b.tyre) - 1];
  if (!tyreOk(b.tyre)) b.tyre = s.tyre;
  return b;
}

/** 14 characters, one per category (tyre as its index in TYRE_CODES). */
export function encodeBuild(b) {
  return CATEGORY_IDS.map((id) => (id === 'tyre' ? TYRE_CODES.indexOf(b.tyre) : b[id]).toString(36)).join('');
}

export function decodeBuild(base, code) {
  if (typeof code !== 'string' || !/^[0-9a-z]{1,24}$/.test(code)) return stockBuild(base);
  const b = {};
  CATEGORY_IDS.forEach((id, i) => {
    if (i >= code.length) return;
    const v = parseInt(code[i], 36);
    b[id] = id === 'tyre' ? TYRE_CODES[v] : v;
  });
  return normalizeBuild(base, b);
}

// ---------------------------------------------------------------- build -> physics spec
/**
 * Where each part's weight changes the truck (design frame: x left, y up from the ground at stock height, z forward):
 * its mass less the factory part's, which the truck's own mass already carries.
 */
function addedParts(base, b) {
  const p = [], s = stockBuild(base);
  const front = base.axles[0].z, roofY = base.roofY, eng = ENGINES[base.id];
  const add = (list, id, x, y, z) => { const m = (list[b[id]].mass || 0) - (list[s[id]].mass || 0); if (m) p.push({ m, x, y, z }); };
  add(LIFTS, 'lift', 0, 0.55, 0);
  add(ARMOR, 'armor', 0, 0.48, 0.3);
  add(TCASES, 'tcase', 0.1, 0.5, 0);
  add(DIFFS, 'diffs', 0, 0.4, 0);
  add(eng, 'engine', 0, 0.85, front - 0.15);
  add(WHEELS, 'wheels', 0.3, 0.85, front);
  add(INTAKES, 'intake', -0.8, 1.5, base.cabZ);
  add(WINCHES, 'winch', 0, 0.7, base.noseZ);
  add(LIGHTS, 'lights', 0, roofY + 0.12, base.cabZ);
  add(RACKS, 'rack', 0, roofY + 0.2, base.rackZ);
  return p;
}

/**
 * The physics spec for a truck with a build. The stock spec (trucks.js) describes the truck at stock height on its
 * stock tyres with bare axles (axle mass without wheels); everything here is derived from it.
 */
export function buildSpec(base, buildIn) {
  const b = normalizeBuild(base, buildIn);
  const spec = JSON.parse(JSON.stringify(base));
  const T0 = tyreFor(base, base.stock.tyre), T = tyreFor(base, b.tyre);
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

  // ---- tyres (a heavy truck's are built for its weight: stiffer carcasses, more plies, higher pressures)
  const tk = base.tyreK ?? 1;
  spec.tyre = {
    ...DEFAULT_TYRE, ...(base.tyre || {}), ...(tread.tyre || {}),
    radius: T.radius, width: T.width, mass: wheelMass, inertia: T.inertia * (wheels.beadlock ? 1.07 : 1),
    stiffness: 230000 * Math.pow(T.width / 0.267, 0.4) * (tread.stiff || 1) * tk,
    damping: DEFAULT_TYRE.damping * Math.sqrt(tk), loadNominal: base.tyreLoad ?? DEFAULT_TYRE.loadNominal,
    tread: b.tread, treadName: tread.name, rrMul: tread.rr,
    grip: SURFACE_NAMES.map((n) => tread.grip[n] || 1),
    psiStock: base.stock.psi ?? 30, minPsi: wheels.minPsi, beadlock: wheels.beadlock, compressor: wheels.compressor, size: T.d, rim: T.rim,
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
  spec.engineSound = eng.sound; spec.soundPitch = eng.pitch;          // (the recorded loops: the fallback)
  spec.engineBank = eng.bank;      // the grain engine's bank (audio/engine-worklet.js)
  spec.engineLoud = eng.loud || 1; spec.engineBass = eng.bass || 0;
  spec.turbo = eng.turbo || 0;                                         // 1 turbo-diesel, 2 twin-turbo petrol
  const tr = TRANSMISSIONS[b.trans];
  spec.trans = {
    ...base.trans, type: tr.type, gears: tr.gears.slice(), reverse: tr.reverse,
    low: TCASES[b.tcase].low || base.stock.low, axle: ratiosFor(base)[b.gears], road: !!base.road,
    ...(tr.shiftTime ? { shiftTime: tr.shiftTime } : {}), ...(tr.dct ? { dct: true } : {}),
  };
  spec.diffs = { front: DIFFS[b.diffs].front, rear: DIFFS[b.diffs].rear };
  spec.bld = { front: spec.diffs.front === 'bld' || !!base.tc, rear: !!base.tc };   // (brakes holding a spinning wheel)
  // axle shafts (N m before they snap): the truck's own, chromoly with a locker
  spec.shafts = (base.shafts || [6000, 7500]).map((v, k) => v * (spec.diffs[k ? 'rear' : 'front'] === 'locker' ? 1.25 : 1));

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
    clearance: rStatic - Math.max(...spec.axles.map((a) => (a.ifs ? a.armDrop ?? 0.11 : a.diffDrop ?? 0.16))),   // under the diffs (an independent axle's arms)
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
