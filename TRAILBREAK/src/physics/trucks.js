// The trucks: original designs modelled on the classic four-wheel drives of the world, with their real wheelbases,
// tracks, weights, engines and gearing. Body-on-frame, a solid (beam) axle at each end on leaf or coil springs, a
// manual or automatic gearbox and a two-speed part-time transfer case (the expedition truck: portal axles and an
// eight-speed box instead).
//
//   Gecko     micro 4x4 (the little Japanese and Indian jeeps)         Mule     open utility (the classic CJ)
//   Ranger    compact two-door wagon (the early American wagons)       Trekker  compact pickup (the eighties' tough one)
//   Shepherd  British utility wagon (the long-wheelbase classic)       Drover   big six-cylinder wagon (the outback one)
//   Hauler    three-quarter-ton pickup                                  Bruiser  one-ton crew-cab turbo-diesel
//   Rhino     portal-axle expedition truck (the German unstoppable)
//
// Each entry is the truck as it leaves the factory: stock height, stock tyres. Upgrades.js turns it and a build
// (lift, tyres, gears, lockers...) into the spec the physics drives: use truckSpec(id, build).
//
// Geometry is in the design frame: origin on the ground under the middle of the wheelbase, +y up, +z forward,
// +x to the driver's left. The physics moves it into the frame of the centre of gravity.
//
//   mass, cgHeight, cgZ  the whole truck with a driver and a full tank, on its stock tyres
//   inertiaBox           size of a box with the sprung body's moments of inertia
//   axles[].mass         the bare axle: housing, diff, hubs, brakes and half the springs, without the wheels
//   axles[].rate         spring rate at the wheel (N/m); bump / rebound: damping (N s/m); travel: droop to bump stop;
//                        sag: droop to ride height; springTrack: how far apart the springs sit
//   axles[].diffDrop     how far the diff housing hangs below the axle centre (the lowest point of a beam axle truck);
//                        diffX: its offset from the middle (+ = left)
//   hull                 collision boxes: the body (bumpers and sills along its bottom), the belly (frame, gearbox
//                        and transfer case between the axles), the cab or top (its roof)
//   stock                factory tyre size (in), axle ratio, gearbox (index in Upgrades.TRANSMISSIONS), the biggest
//                        tyre that fits without a lift (in), transfer case low range
//   roofY, cabZ, noseZ, rackZ, intakePos, snorkelPos   where the accessories go
//   shafts               axle shaft strength, front and rear (N m); tyreK, tyreLoad: tyre stiffness factor and the
//                        load its grip is rated at (heavy trucks); parts: price factor for its parts
//   look                 for the model: top ('hard', 'canvas', 'paint'), bed (a pickup), coils, portal, leaf (half
//                        length of the leaf springs)

import { buildSpec, decodeBuild, normalizeBuild, encodeBuild, TRUCK_BASES } from './Upgrades.js';

export const TRUCKS = {
  ranger: {
    id: 'ranger', name: 'Ranger',
    blurb: 'Compact two-door wagon: 92" wheelbase, 5.0 V8, three-speed automatic. Nimble on tight trails.',
    mass: 1760, cgHeight: 0.74, cgZ: 0.09, inertiaBox: [1.62, 1.15, 3.5],
    axles: [
      { z: 1.1685, track: 1.458, springTrack: 0.96, rate: 37500, bump: 2300, rebound: 4600, travel: 0.25, sag: 0.095, mass: 95, steer: 0.58, brake: 2600, swayBar: 30000, diffDrop: 0.16, diffX: -0.2 },
      { z: -1.1685, track: 1.458, springTrack: 1.0, rate: 39500, bump: 2200, rebound: 4400, travel: 0.26, sag: 0.1, mass: 85, steer: 0, brake: 1600, handbrake: 2600, diffDrop: 0.16, diffX: -0.05 },
    ],
    trans: { tcK: 10.2 },
    stock: { tyre: 31, axle: 4.10, trans: 0, fit: 31, low: 2.46 },
    hull: [
      { c: [0, 0.785, -0.12], h: [0.865, 0.335, 1.92], pts: 'bottom' },     // body: bumpers 0.45 m up, beltline 1.12
      { c: [0, 0.45, 0], h: [0.42, 0.13, 0.9], pts: 'bottom' },             // belly: transfer case 0.32 m up
      { c: [0, 1.455, -0.79], h: [0.8, 0.335, 1.21], pts: 'top' },          // hardtop, roof 1.79 m
    ],
    roofY: 1.79, cabZ: 0.42, noseZ: 1.8, rackZ: -0.8,
    intakePos: [0, 0.92, 1.3], snorkelPos: [-0.86, 1.86, 0.46],
    winch: { fairlead: [0, 0.6, 1.86] },
    eye: [0.38, 1.5, -0.2], hoodEye: [0, 1.33, 1.05],          // driver's eyes, the bonnet camera
    drag: { cd: 0.56, area: 2.6 },
    buoyancy: 0.32,
    shafts: [6000, 7500],
    style: 'ranger',
  },
  hauler: {
    id: 'hauler', name: 'Hauler',
    blurb: 'Three-quarter-ton pickup: 131" wheelbase, 6.6 V8, four-speed with a granny low. Heavy, long and strong.',
    mass: 2250, cgHeight: 0.8, cgZ: 0.22, inertiaBox: [1.8, 1.2, 4.9],
    axles: [
      { z: 1.67, track: 1.68, springTrack: 1.0, rate: 55600, bump: 3200, rebound: 6400, travel: 0.23, sag: 0.09, mass: 135, steer: 0.52, brake: 3300, swayBar: 38000, diffDrop: 0.19, diffX: -0.22 },
      { z: -1.67, track: 1.63, springTrack: 1.08, rate: 62900, bump: 3000, rebound: 6000, travel: 0.25, sag: 0.09, mass: 150, steer: 0, brake: 2100, handbrake: 3200, diffDrop: 0.2, diffX: -0.06 },
    ],
    trans: { tcK: 9.4 },
    stock: { tyre: 33, axle: 4.10, trans: 2, fit: 33, low: 1.96 },
    hull: [
      { c: [0, 0.85, -0.185], h: [1.0, 0.35, 2.695], pts: 'bottom' },       // body and bed: bumpers 0.5 m, rails 1.2
      { c: [0, 0.49, 0], h: [0.46, 0.13, 1.4], pts: 'bottom' },             // belly 0.36 m up
      { c: [0, 1.54, 0.11], h: [0.84, 0.34, 0.49], pts: 'top' },            // cab, roof 1.88 m
    ],
    roofY: 1.88, cabZ: 0.56, noseZ: 2.51, rackZ: -1.7,
    intakePos: [0, 1.02, 1.95], snorkelPos: [-0.96, 1.96, 0.62],
    winch: { fairlead: [0, 0.66, 2.56] },
    eye: [0.42, 1.6, -0.02], hoodEye: [0, 1.4, 1.75],          // driver's eyes, the bonnet camera
    drag: { cd: 0.6, area: 3.15 },
    buoyancy: 0.3,
    shafts: [11000, 12000], parts: 1.15,
    style: 'hauler', look: { bed: true, leaf: 0.72 },
  },
  mule: {
    id: 'mule', name: 'Mule',
    blurb: 'Open utility 4x4: 83" wheelbase, 4.2 straight six, three-speed stick. Light and narrow, but tippy.',
    mass: 1300, cgHeight: 0.7, cgZ: 0.07, inertiaBox: [1.45, 1.1, 3.1],
    axles: [
      { z: 1.06, track: 1.31, springTrack: 0.82, rate: 36600, bump: 1900, rebound: 3800, travel: 0.23, sag: 0.09, mass: 70, steer: 0.6, brake: 2000, swayBar: 18000, diffDrop: 0.15, diffX: -0.18 },
      { z: -1.06, track: 1.27, springTrack: 0.86, rate: 35800, bump: 1760, rebound: 3500, travel: 0.24, sag: 0.09, mass: 75, steer: 0, brake: 1300, handbrake: 2000, diffDrop: 0.15, diffX: -0.05 },
    ],
    trans: { tcK: 11.5 },
    stock: { tyre: 30, axle: 3.54, trans: 1, fit: 31, low: 2.03 },
    hull: [
      { c: [0, 0.71, -0.13], h: [0.8, 0.29, 1.75], pts: 'bottom' },         // tub: bumpers 0.42 m up, top 1.0
      { c: [0, 0.43, 0], h: [0.4, 0.11, 0.8], pts: 'bottom' },              // belly 0.32 m up
      { c: [0, 1.36, -0.67], h: [0.74, 0.36, 0.95], pts: 'top' },           // roll bar and soft top, 1.72 m
    ],
    roofY: 1.72, cabZ: 0.28, noseZ: 1.62, rackZ: -0.75,
    intakePos: [0, 0.86, 1.2], snorkelPos: [-0.8, 1.78, 0.36],
    winch: { fairlead: [0, 0.58, 1.68] },
    eye: [0.32, 1.42, -0.32], hoodEye: [0, 1.25, 0.95],          // driver's eyes, the bonnet camera
    drag: { cd: 0.62, area: 2.25 },
    buoyancy: 0.33,
    shafts: [5000, 6500], parts: 0.9,
    style: 'mule', look: { top: 'canvas' },
  },
  gecko: {
    id: 'gecko', name: 'Gecko',
    blurb: 'Micro 4x4: 80" wheelbase, 1.3 four-cylinder, five-speed, a ton all in. Floats over mud and slips between the trees; slow, and narrow on a side slope.',
    mass: 1050, cgHeight: 0.62, cgZ: 0.05, inertiaBox: [1.4, 1.0, 2.9],
    axles: [
      { z: 1.015, track: 1.21, springTrack: 0.74, rate: 22000, bump: 1200, rebound: 2400, travel: 0.19, sag: 0.08, mass: 42, steer: 0.6, brake: 1300, swayBar: 9000, diffDrop: 0.13, diffX: -0.15 },
      { z: -1.015, track: 1.22, springTrack: 0.78, rate: 21000, bump: 1150, rebound: 2300, travel: 0.2, sag: 0.085, mass: 45, steer: 0, brake: 800, handbrake: 1300, diffDrop: 0.13, diffX: -0.05 },
    ],
    trans: { tcK: 13 },
    stock: { tyre: 27, axle: 5.38, trans: 3, fit: 28, low: 1.65 },
    hull: [
      { c: [0, 0.71, -0.095], h: [0.73, 0.29, 1.715], pts: 'bottom' },     // body: bumpers 0.42 m up, beltline 1.0
      { c: [0, 0.36, 0], h: [0.34, 0.08, 0.75], pts: 'bottom' },            // belly: transfer case 0.28 m up
      { c: [0, 1.345, -0.75], h: [0.69, 0.345, 1.0], pts: 'top' },          // canvas top, 1.69 m
    ],
    roofY: 1.69, cabZ: 0.2, noseZ: 1.62, rackZ: -0.8,
    intakePos: [0, 0.8, 0.95], snorkelPos: [-0.72, 1.62, 0.2],
    winch: { fairlead: [0, 0.52, 1.68] },
    eye: [0.3, 1.38, -0.3], hoodEye: [0, 1.18, 0.85],
    drag: { cd: 0.55, area: 2.1 },
    buoyancy: 0.34,
    shafts: [3500, 4500], tyreK: 0.8, tyreLoad: 2600, parts: 0.7,
    style: 'gecko', look: { top: 'canvas', leaf: 0.5 },
  },
  trekker: {
    id: 'trekker', name: 'Trekker',
    blurb: 'Compact pickup: 103" wheelbase, 2.4 four-cylinder, five-speed, leaf springs both ends. Light, simple and unbreakable.',
    mass: 1480, cgHeight: 0.72, cgZ: 0.16, inertiaBox: [1.6, 1.15, 4.3],
    axles: [
      { z: 1.3075, track: 1.41, springTrack: 0.86, rate: 33000, bump: 1800, rebound: 3600, travel: 0.21, sag: 0.085, mass: 70, steer: 0.6, brake: 2300, swayBar: 20000, diffDrop: 0.16, diffX: -0.18 },
      { z: -1.3075, track: 1.39, springTrack: 0.98, rate: 30000, bump: 1700, rebound: 3400, travel: 0.22, sag: 0.08, mass: 72, steer: 0, brake: 1300, handbrake: 2200, diffDrop: 0.17, diffX: -0.04 },
    ],
    trans: { tcK: 11 },
    stock: { tyre: 31, axle: 4.10, trans: 3, fit: 31, low: 2.28 },
    hull: [
      { c: [0, 0.77, -0.05], h: [0.845, 0.32, 2.22], pts: 'bottom' },       // body and bed: bumpers 0.45 m, rails 1.09
      { c: [0, 0.42, 0.1], h: [0.38, 0.1, 1.0], pts: 'bottom' },            // belly 0.32 m up
      { c: [0, 1.42, 0.12], h: [0.8, 0.33, 0.5], pts: 'top' },              // cab, roof 1.75 m
    ],
    roofY: 1.75, cabZ: 0.45, noseZ: 2.17, rackZ: -1.4,
    intakePos: [0, 0.95, 1.6], snorkelPos: [-0.83, 1.8, 0.62],
    winch: { fairlead: [0, 0.6, 2.22] },
    eye: [0.36, 1.48, 0.05], hoodEye: [0, 1.3, 1.45],
    drag: { cd: 0.52, area: 2.5 },
    buoyancy: 0.3,
    shafts: [6000, 7000], tyreLoad: 3700, parts: 0.85,
    style: 'trekker', look: { bed: true, leaf: 0.62 },
  },
  shepherd: {
    id: 'shepherd', name: 'Shepherd',
    blurb: 'British utility wagon: 110" wheelbase, 2.5 turbo-diesel, five-speed, coil springs and long travel. Boxy, tall and tireless.',
    mass: 2050, cgHeight: 0.86, cgZ: -0.06, inertiaBox: [1.7, 1.4, 4.2],
    axles: [
      { z: 1.397, track: 1.486, springTrack: 0.9, rate: 39000, bump: 2300, rebound: 4600, travel: 0.24, sag: 0.1, mass: 95, steer: 0.55, brake: 3000, swayBar: 15000, diffDrop: 0.17, diffX: -0.12 },
      { z: -1.397, track: 1.486, springTrack: 1.0, rate: 46000, bump: 2500, rebound: 5000, travel: 0.27, sag: 0.11, mass: 100, steer: 0, brake: 2000, handbrake: 3000, diffDrop: 0.17, diffX: -0.12 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 31, axle: 4.10, trans: 3, fit: 31, low: 2.74 },
    hull: [
      { c: [0, 0.82, -0.155], h: [0.89, 0.33, 2.245], pts: 'bottom' },      // body: bumpers 0.49 m up, waist 1.15
      { c: [0, 0.45, 0], h: [0.4, 0.11, 1.0], pts: 'bottom' },              // belly: transfer case 0.34 m up
      { c: [0, 1.59, -0.6], h: [0.87, 0.44, 1.75], pts: 'top' },            // station wagon body, roof 2.03 m
    ],
    roofY: 2.03, cabZ: 0.55, noseZ: 2.09, rackZ: -0.6,
    intakePos: [-0.62, 0.98, 1.7], snorkelPos: [-0.9, 2.05, 0.95],
    winch: { fairlead: [0, 0.66, 2.15] },
    eye: [0.42, 1.6, 0.0], hoodEye: [0, 1.42, 1.45],
    drag: { cd: 0.65, area: 3.2 },
    buoyancy: 0.3,
    shafts: [5500, 7000], tyreLoad: 5000, parts: 1.0,
    style: 'shepherd', look: { top: 'hard', coils: true },
  },
  drover: {
    id: 'drover', name: 'Drover',
    blurb: 'Big six-cylinder wagon: 107" wheelbase, 4.2 straight six, four-speed automatic, leaf springs. Heavy, smooth and built to last.',
    mass: 2150, cgHeight: 0.82, cgZ: 0.05, inertiaBox: [1.75, 1.35, 4.4],
    axles: [
      { z: 1.365, track: 1.475, springTrack: 0.92, rate: 44000, bump: 2500, rebound: 5000, travel: 0.22, sag: 0.09, mass: 110, steer: 0.55, brake: 3200, swayBar: 30000, diffDrop: 0.18, diffX: -0.2 },
      { z: -1.365, track: 1.46, springTrack: 1.04, rate: 48000, bump: 2600, rebound: 5200, travel: 0.23, sag: 0.095, mass: 115, steer: 0, brake: 2000, handbrake: 3200, diffDrop: 0.18, diffX: -0.05 },
    ],
    trans: { tcK: 9.8 },
    stock: { tyre: 31, axle: 4.10, trans: 4, fit: 31, low: 1.96 },
    hull: [
      { c: [0, 0.815, -0.145], h: [0.9, 0.315, 2.37], pts: 'bottom' },     // body: bumpers 0.5 m up, waist 1.13
      { c: [0, 0.47, 0], h: [0.42, 0.12, 1.05], pts: 'bottom' },            // belly 0.35 m up
      { c: [0, 1.475, -0.75], h: [0.86, 0.345, 1.7], pts: 'top' },          // wagon roof 1.82 m
    ],
    roofY: 1.82, cabZ: 0.6, noseZ: 2.225, rackZ: -0.9,
    intakePos: [-0.6, 1.0, 1.7], snorkelPos: [-0.9, 1.85, 0.9],
    winch: { fairlead: [0, 0.66, 2.29] },
    eye: [0.42, 1.55, 0.1], hoodEye: [0, 1.38, 1.6],
    drag: { cd: 0.58, area: 3.0 },
    buoyancy: 0.3,
    shafts: [8500, 10000], tyreLoad: 5300, parts: 1.05,
    style: 'drover', look: { top: 'hard', leaf: 0.66 },
  },
  bruiser: {
    id: 'bruiser', name: 'Bruiser',
    blurb: 'One-ton crew-cab pickup: 156" wheelbase, 5.9 turbo-diesel six, heavy-duty five-speed. Pulls anything; long and three and a half tons.',
    mass: 3350, cgHeight: 0.92, cgZ: 0.4, inertiaBox: [1.95, 1.5, 6.2],
    axles: [
      { z: 1.98, track: 1.74, springTrack: 1.02, rate: 95000, bump: 4800, rebound: 9600, travel: 0.2, sag: 0.075, mass: 190, steer: 0.5, brake: 5800, swayBar: 60000, diffDrop: 0.19, diffX: -0.24 },
      { z: -1.98, track: 1.7, springTrack: 1.16, rate: 105000, bump: 4600, rebound: 9200, travel: 0.22, sag: 0.07, mass: 200, steer: 0, brake: 3600, handbrake: 5000, diffDrop: 0.2, diffX: -0.08 },
    ],
    trans: { tcK: 7.5 },
    stock: { tyre: 33, axle: 4.10, trans: 5, fit: 35, low: 2.72, psi: 50 },
    hull: [
      { c: [0, 0.95, -0.125], h: [1.0, 0.35, 3.055], pts: 'bottom' },       // body and bed: bumpers 0.6 m, rails 1.3
      { c: [0, 0.55, 0.2], h: [0.48, 0.13, 1.6], pts: 'bottom' },           // belly 0.42 m up
      { c: [0, 1.64, 0.3], h: [0.9, 0.34, 1.05], pts: 'top' },              // crew cab, roof 1.98 m
    ],
    roofY: 1.98, cabZ: 1.0, noseZ: 2.93, rackZ: -1.95,
    intakePos: [-0.5, 1.15, 2.4], snorkelPos: [-1.02, 2.06, 1.3],
    winch: { fairlead: [0, 0.75, 3.0] },
    eye: [0.45, 1.72, 0.65], hoodEye: [0, 1.55, 2.2],
    drag: { cd: 0.62, area: 3.6 },
    buoyancy: 0.27,
    shafts: [14000, 15000], tyreK: 1.6, tyreLoad: 8000, parts: 1.3,
    style: 'bruiser', look: { bed: true, leaf: 0.8 },
  },
  rhino: {
    id: 'rhino', name: 'Rhino',
    blurb: 'Portal-axle expedition truck: 128" wheelbase, 5.7 diesel six, eight-speed, lockers both ends, tyre inflation from the cab, 44 cm under the diffs. Six tons; nothing stops it.',
    mass: 6200, cgHeight: 1.25, cgZ: 0.3, inertiaBox: [2.2, 2.0, 5.2],
    axles: [
      { z: 1.625, track: 1.86, springTrack: 1.1, rate: 260000, bump: 9000, rebound: 18000, travel: 0.3, sag: 0.09, mass: 420, steer: 0.5, brake: 14000, swayBar: 80000, diffDrop: 0.06, plateDrop: -0.12, diffX: 0 },
      { z: -1.625, track: 1.86, springTrack: 1.1, rate: 240000, bump: 8500, rebound: 17000, travel: 0.32, sag: 0.1, mass: 430, steer: 0, brake: 9000, handbrake: 14000, diffDrop: 0.06, plateDrop: -0.12, diffX: 0 },
    ],
    trans: { tcK: 6 },
    stock: { tyre: 42, axle: 7.17, trans: 6, fit: 44, low: 1.0, diffs: 3, wheels: 1, intake: 1, psi: 55 },
    hull: [
      { c: [0, 1.17, -0.045], h: [1.1, 0.33, 2.77], pts: 'bottom' },        // chassis and bed floor: bumpers 0.84 m up
      { c: [0, 0.82, 0], h: [0.45, 0.12, 1.1], pts: 'bottom' },             // belly: 0.7 m up
      { c: [0, 2.2, 1.45], h: [1.05, 0.63, 0.95], pts: 'top' },             // cab over the front axle, roof 2.83 m
      { c: [0, 1.75, -1.2], h: [1.1, 0.2, 1.6], pts: 'top' },               // the bed's drop sides
    ],
    roofY: 2.83, cabZ: 1.4, noseZ: 2.725, rackZ: 1.45,
    intakePos: [-0.6, 1.25, 2.0], snorkelPos: [-1.0, 1.55, 0.6],
    winch: { fairlead: [0, 0.95, 2.78] },
    eye: [0.5, 2.35, 1.9], hoodEye: [0, 2.0, 2.6],
    drag: { cd: 0.8, area: 6.2 },
    buoyancy: 0.25,
    shafts: [30000, 32000], tyreK: 2.8, tyreLoad: 15000, parts: 1.8,
    style: 'rhino', look: { top: 'paint', coils: true, portal: true },
  },
  thar: {
    // the 2020 Mahindra Thar LX: 3,985 mm long, 1,820 mm wide, 226 mm under the rear axle, right-hand drive
    id: 'thar', name: 'Mahindra Thar',
    blurb: 'The new Thar: 96" wheelbase, mHawk 2.2 turbo-diesel, six-speed manual, independent front on coil-overs, a five-link rear axle with an auto-locker. Short, light and keen.',
    mass: 1850, cgHeight: 0.78, cgZ: 0.12, inertiaBox: [1.6, 1.3, 3.7],
    axles: [
      { z: 1.225, track: 1.56, springTrack: 0.96, rate: 34000, bump: 2400, rebound: 4800, travel: 0.2, sag: 0.085, mass: 80, steer: 0.6, brake: 2800, swayBar: 22000, ifs: true },
      { z: -1.225, track: 1.48, springTrack: 0.98, rate: 38000, bump: 2300, rebound: 4600, travel: 0.25, sag: 0.095, mass: 90, steer: 0, brake: 1800, handbrake: 2600, diffDrop: 0.16, diffX: 0 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 31, axle: 4.27, trans: 7, fit: 31, low: 2.48, diffs: 4 },
    axleRatios: [3.73, 4.27, 4.56, 4.88, 5.13, 5.38, 5.89],
    stockTyre: { label: '255/65 R18 A/T', radius: 0.3944, width: 0.255, rim: 18, desc: 'The factory 255/65 R18 all-terrains on diamond-cut alloys.' },
    hull: [
      { c: [0, 0.74, -0.07], h: [0.9, 0.33, 1.94], pts: 'bottom' },         // body: bumpers 0.41 m up, beltline 1.07
      { c: [0, 0.42, 0], h: [0.38, 0.11, 0.85], pts: 'bottom' },            // belly: transfer case 0.31 m up
      { c: [0, 1.555, -0.8], h: [0.86, 0.37, 1.15], pts: 'top' },          // hard top, roof 1.93 m
    ],
    roofY: 1.93, cabZ: 0.3, noseZ: 1.88, rackZ: -0.75,
    intakePos: [0.55, 0.95, 1.35], snorkelPos: [0.88, 1.85, 0.6],        // (the snorkel up the left pillar)
    winch: { fairlead: [0, 0.58, 1.9] },
    eye: [-0.38, 1.5, -0.22], hoodEye: [0, 1.38, 1.0],                   // (right-hand drive)
    drag: { cd: 0.55, area: 2.8 },
    buoyancy: 0.3,
    shafts: [5000, 6500], parts: 1.0,
    style: 'thar', look: { top: 'black', coils: true, alloy: true },
  },
};
// (the options that depend on the truck, Upgrades.optionsFor, look trucks up here)
Object.assign(TRUCK_BASES, TRUCKS);

export const TRUCK_IDS = Object.keys(TRUCKS);
export const truckBase = (id) => TRUCKS[id] || TRUCKS.ranger;

/** The physics spec for a truck and a build (object, 14-character code, or nothing for stock), cached per build. */
const cache = new Map();
export function truckSpec(id, build) {
  const base = truckBase(id);
  const b = typeof build === 'string' ? decodeBuild(base, build) : normalizeBuild(base, build);
  const key = `${base.id}:${encodeBuild(b)}`;
  let spec = cache.get(key);
  if (!spec) { spec = buildSpec(base, b); cache.set(key, spec); }
  return spec;
}
