// The trucks: real four-wheel drives of the world (each body a real 3D model: render/TruckAssets.js), with their real
// wheelbases, tracks, weights, engines and gearing. Most are body-on-frame on beam axles (leaf or coil springs), some
// independent at one end or both; a manual or automatic gearbox and a two-speed transfer case (the Unimog: portal axles
// and an eight-speed box; the Hummer EV: electric motors and one gear).
//
//   Gecko     the Lada Niva (a real model)                             Mule     the Willys MB, the original jeep (a real model)
//   Ranger    the UAZ Hunter (a real model)                            Trekker  the Ford Ranger Raptor (a real model)
//   Shepherd  the Land Rover Defender 110 (a real model)               Drover   the Mitsubishi Pajero (a real model)
//   Hauler    the Chevrolet K20 Suburban (a real model)                 Bruiser  the Ram 2500 Power Wagon (a real model)
//   Rhino     the Mercedes-Benz Unimog U1300L (a real model)
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
//   tc                   brake traction control on both axles (a modern truck's): the brakes hold back a wheel that
//                        spins away from the other, with the diffs open
//   look                 for the model: top ('hard', 'canvas', 'paint'), bed (a pickup), coils, portal, leaf (half
//                        length of the leaf springs)

import { buildSpec, decodeBuild, normalizeBuild, encodeBuild, TRUCK_BASES, EV_TRANS } from './Upgrades.js';

export const TRUCKS = {
  ranger: {
    // the UAZ Hunter (UAZ-315195, 2003-) in its Expedition dress: 2,380 mm wheelbase, 4,230 mm long over the bull bar,
    // a ladder frame, beam axles on coil springs in front and leaf springs behind, 210 mm under the diffs (a real model:
    // render/TruckAssets.js)
    id: 'ranger', name: 'UAZ Hunter',
    blurb: 'UAZ Hunter Expedition, the Soviet army jeep\'s heir: 94" wheelbase, a ladder frame and beam axles, the 2.7 four, a five-speed and a two-speed transfer case, a bull bar, winch and side steps from the factory. Simple, tough and slow.',
    mass: 2000, cgHeight: 0.8, cgZ: 0.08, inertiaBox: [1.75, 1.35, 3.9],
    axles: [
      { z: 1.19, track: 1.525, springTrack: 1.06, rate: 42000, bump: 2400, rebound: 4800, travel: 0.23, sag: 0.095, mass: 105, steer: 0.55, brake: 2900, swayBar: 18000, diffDrop: 0.17, diffX: -0.1 },
      { z: -1.19, track: 1.52, springTrack: 1.06, rate: 46000, bump: 2400, rebound: 4800, travel: 0.24, sag: 0.1, mass: 110, steer: 0, brake: 1900, handbrake: 3000, diffDrop: 0.17, diffX: 0 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 31, axle: 4.625, trans: 3, fit: 31, low: 1.94 },
    axleRatios: [4.1, 4.625, 5.125, 5.38, 5.89, 6.53],
    stockTyre: { label: '245/75 R16 M/T', radius: 0.392, width: 0.245, rim: 16, desc: 'The Expedition\'s 245/75 R16 mud-terrains (31") on red-lipped steel wheels.' },
    hull: [
      { c: [0, 0.83, -0.035], h: [0.88, 0.37, 2.105], pts: 'bottom' },     // body: the bull bar 0.46 m up, the bonnet 1.33
      { c: [0, 0.47, 0], h: [0.42, 0.1, 1.0], pts: 'bottom' },              // belly: transfer case 0.37 m up
      { c: [0, 1.66, -0.72], h: [0.86, 0.32, 1.15], pts: 'top' },           // the hard top, roof 1.98 m
    ],
    roofY: 1.98, cabZ: 0.3, noseZ: 2.06, rackZ: -0.75,
    intakePos: [-0.55, 0.95, 1.5], snorkelPos: [-0.92, 1.95, 0.5],
    winch: { fairlead: [0, 0.72, 2.06] },
    eye: [0.42, 1.62, -0.05], hoodEye: [0, 1.48, 1.2],          // driver's eyes, the bonnet camera
    drag: { cd: 0.6, area: 3.1 },
    buoyancy: 0.3,
    shafts: [6500, 7500], parts: 0.9,
    style: 'ranger', look: { coils: true },
  },
  hauler: {
    // the Chevrolet K20 Suburban, the square-body three-quarter-ton wagon (1973-1991): 129.5" wheelbase, 5.57 m long,
    // 2.02 m wide, leaf springs on a Dana 60 and a 14-bolt, an NP205 transfer case (a real model: render/TruckAssets.js)
    id: 'hauler', name: 'Chevrolet K20 Suburban',
    blurb: 'Chevrolet K20 Suburban, the square-body three-quarter-ton wagon: 129.5" wheelbase, the 6.6 V8, a four-speed with a 6.55 granny first, an NP205 and leaf springs on a Dana 60 and a 14-bolt. Long, heavy and strong.',
    mass: 2480, cgHeight: 0.86, cgZ: 0.2, inertiaBox: [1.85, 1.35, 5.0],
    axles: [
      { z: 1.6445, track: 1.7, springTrack: 0.96, rate: 58000, bump: 3300, rebound: 6600, travel: 0.23, sag: 0.09, mass: 140, steer: 0.52, brake: 3500, swayBar: 38000, diffDrop: 0.19, diffX: -0.22 },
      { z: -1.6445, track: 1.68, springTrack: 1.08, rate: 66000, bump: 3200, rebound: 6400, travel: 0.25, sag: 0.09, mass: 155, steer: 0, brake: 2300, handbrake: 3400, diffDrop: 0.2, diffX: -0.06 },
    ],
    trans: { tcK: 9.4 },
    stock: { tyre: 31, axle: 4.10, trans: 2, fit: 33, low: 1.96 },
    stockTyre: { label: 'LT235/85 R16 A/T', radius: 0.4025, width: 0.235, rim: 16, desc: 'The three-quarter-ton\'s tall, narrow LT235/85 R16s (32") on eight-lug steel wheels.' },
    hull: [
      { c: [0, 0.86, -0.22], h: [1.0, 0.41, 2.65], pts: 'bottom' },        // body: bumpers 0.45 m up, the beltline 1.27
      { c: [0, 0.5, 0.2], h: [0.45, 0.12, 1.2], pts: 'bottom' },            // belly: transfer case 0.38 m up
      { c: [0, 1.56, -0.95], h: [0.98, 0.3, 1.7], pts: 'top' },             // the wagon's roof, 1.86 m
    ],
    roofY: 1.86, cabZ: 0.3, noseZ: 2.43, rackZ: -1.0,
    intakePos: [-0.55, 1.05, 1.8], snorkelPos: [-1.0, 1.85, 0.75],
    winch: { fairlead: [0, 0.6, 2.45] },
    eye: [0.45, 1.6, 0.25], hoodEye: [0, 1.45, 1.5],          // driver's eyes, the bonnet camera
    drag: { cd: 0.62, area: 3.6 },
    buoyancy: 0.3,
    shafts: [11000, 12000], parts: 1.15,
    style: 'hauler', look: { leaf: 0.72 },
  },
  mule: {
    // the Willys MB (1941-1945), the jeep that went to war: 80" wheelbase, 3,360 mm long, 1,575 mm wide, 1,113 kg
    // empty, leaf springs on beam axles at both ends, 8.75" under the diffs (a real model: render/TruckAssets.js)
    id: 'mule', name: 'Willys MB',
    blurb: 'Willys MB, the original jeep: 80" wheelbase, the 2.2 Go Devil four, a three-speed stick and a two-speed transfer case, leaf springs at both ends, a ton and a bit. Light, narrow and nimble; slow, and tippy on a side slope.',
    mass: 1220, cgHeight: 0.66, cgZ: 0.06, inertiaBox: [1.45, 1.05, 3.0],
    axles: [
      { z: 1.016, track: 1.24, springTrack: 0.74, rate: 34000, bump: 1800, rebound: 3600, travel: 0.2, sag: 0.085, mass: 65, steer: 0.6, brake: 1900, swayBar: 9000, diffDrop: 0.14, diffX: -0.18 },
      { z: -1.016, track: 1.23, springTrack: 0.74, rate: 33000, bump: 1700, rebound: 3400, travel: 0.22, sag: 0.09, mass: 70, steer: 0, brake: 1250, handbrake: 1900, diffDrop: 0.14, diffX: -0.05 },
    ],
    trans: { tcK: 11.5 },
    stock: { tyre: 28, axle: 4.88, trans: 1, fit: 30, low: 1.97 },
    axleRatios: [4.27, 4.56, 4.88, 5.13, 5.38, 5.89],
    stockTyre: { label: '6.00-16 NDT', radius: 0.365, width: 0.165, rim: 16, desc: 'The army\'s 6.00-16 non-directional treads on split-rim steel wheels.' },
    hull: [
      { c: [0, 0.765, -0.01], h: [0.78, 0.325, 1.61], pts: 'bottom' },     // body: bumpers 0.44 m up, the bonnet 1.09
      { c: [0, 0.42, 0], h: [0.36, 0.08, 0.72], pts: 'bottom' },            // belly: transfer case 0.34 m up
      { c: [0, 1.42, 0.24], h: [0.72, 0.29, 0.1], pts: 'top' },             // the windscreen frame, 1.71 m (no roof)
    ],
    roofY: 1.71, cabZ: 0.1, noseZ: 1.6, rackZ: -0.9,
    intakePos: [0.3, 0.92, 1.1], snorkelPos: [-0.74, 1.55, 0.36],
    winch: { fairlead: [0, 0.52, 1.62] },
    eye: [0.3, 1.36, -0.25], hoodEye: [0, 1.22, 0.95],          // driver's eyes, the bonnet camera
    drag: { cd: 0.72, area: 2.0 },
    buoyancy: 0.33,
    shafts: [4000, 5500], parts: 0.85,
    style: 'mule', look: { bed: true, leaf: 0.48 },
  },
  gecko: {
    // the Lada Niva (VAZ-2121, 1977- , here the 1.7 21214): 2,200 mm wheelbase, 3,740 mm long, 1,680 mm wide, a
    // monocoque on double wishbones in front and a five-link coil axle behind, permanent four-wheel drive with a lockable
    // centre diff, 220 mm under the diffs (a real model: render/TruckAssets.js)
    id: 'gecko', name: 'Lada Niva',
    blurb: 'Lada Niva, the Soviet small 4x4: 87" wheelbase, the 1.7 four, a five-speed, permanent four-wheel drive and a low range, independent front, coils all round, 1.3 tons. Light, nimble and stubborn; slow, and narrow on a side slope.',
    mass: 1290, cgHeight: 0.66, cgZ: 0.1, inertiaBox: [1.45, 1.1, 3.0],
    axles: [
      { z: 1.1, track: 1.43, springTrack: 1.0, rate: 26000, bump: 1500, rebound: 3000, travel: 0.2, sag: 0.09, mass: 60, steer: 0.6, brake: 1900, swayBar: 12000, ifs: true, armDrop: 0.1 },
      { z: -1.1, track: 1.4, springTrack: 1.0, rate: 28000, bump: 1500, rebound: 3000, travel: 0.22, sag: 0.09, mass: 75, steer: 0, brake: 1100, handbrake: 1700, diffDrop: 0.11, diffX: 0 },
    ],
    trans: { tcK: 12 },
    stock: { tyre: 27, axle: 4.68, trans: 3, fit: 29, low: 1.78 },
    axleRatios: [4.3, 4.68, 5.13, 5.38, 5.89],
    stockTyre: { label: '175/80 R16', radius: 0.33, width: 0.175, rim: 16, desc: 'The Niva\'s skinny 175/80 R16s on steel wheels (its 3.9 axles through the transfer box\'s 1.2 high range: 4.68 all told).' },
    hull: [
      { c: [0, 0.745, -0.085], h: [0.82, 0.305, 1.855], pts: 'bottom' },   // body: bumpers 0.44 m up, the bonnet 1.05
      { c: [0, 0.38, 0], h: [0.36, 0.08, 0.7], pts: 'bottom' },             // belly: 0.30 m up
      { c: [0, 1.33, -0.65], h: [0.78, 0.26, 1.05], pts: 'top' },           // roof 1.59 m
    ],
    roofY: 1.59, cabZ: 0, noseZ: 1.77, rackZ: -0.7,
    intakePos: [0.35, 0.85, 1.3], snorkelPos: [-0.85, 1.55, 0.45],
    winch: { fairlead: [0, 0.5, 1.78] },
    eye: [0.35, 1.38, -0.15], hoodEye: [0, 1.25, 0.8],
    drag: { cd: 0.5, area: 2.3 },
    buoyancy: 0.34,
    shafts: [3500, 4500], tyreK: 0.8, tyreLoad: 2800, parts: 0.7,
    style: 'gecko', look: { coils: true },
  },
  trekker: {
    // the Ford Ranger Raptor (2019-2022), the desert runner: 3,220 mm wheelbase, 5,398 mm long, 2,180 mm wide, double
    // wishbones and long-travel Fox shocks in front, coil springs on a Watt's-linked beam axle behind, 283 mm under it
    // (a real model: render/TruckAssets.js)
    id: 'trekker', name: 'Ford Ranger Raptor',
    blurb: 'Ford Ranger Raptor: the desert-runner mid-size pickup. 127" wheelbase, the 2.0 bi-turbo diesel, a ten-speed automatic, long-travel Fox shocks on wishbones in front and coils on a Watt\'s-linked axle behind, a rear locker, 33s. Fast across the rough.',
    mass: 2410, cgHeight: 0.84, cgZ: 0.15, inertiaBox: [1.85, 1.35, 4.8],
    axles: [
      { z: 1.61, track: 1.71, springTrack: 1.12, rate: 52000, bump: 3000, rebound: 6000, travel: 0.25, sag: 0.1, mass: 95, steer: 0.55, brake: 4200, swayBar: 22000, ifs: true, armDrop: 0.1 },
      { z: -1.61, track: 1.71, springTrack: 1.08, rate: 56000, bump: 3000, rebound: 6000, travel: 0.28, sag: 0.11, mass: 125, steer: 0, brake: 2700, handbrake: 3400, diffDrop: 0.15, diffX: -0.05 },
    ],
    trans: { tcK: 8.5 },
    stock: { tyre: 33, axle: 4.10, trans: 11, fit: 35, low: 2.717, diffs: 2 },
    axleRatios: [3.73, 4.10, 4.56, 4.88, 5.13, 5.38],
    stockTyre: { label: 'LT285/70 R17 A/T', radius: 0.415, width: 0.285, rim: 17, desc: 'The Raptor\'s BFGoodrich LT285/70 R17 all-terrains (33").' },
    hull: [
      { c: [0, 0.85, -0.125], h: [1.02, 0.42, 2.69], pts: 'bottom' },      // body and bed: bumpers 0.43 m up, bonnet and bed rails 1.27
      { c: [0, 0.46, 0], h: [0.45, 0.1, 1.4], pts: 'bottom' },              // belly: the skid plates 0.36 m up
      { c: [0, 1.55, -0.33], h: [0.95, 0.25, 0.65], pts: 'top' },           // double cab, roof 1.8 m
    ],
    roofY: 1.8, cabZ: -0.3, noseZ: 2.55, rackZ: -1.95,
    intakePos: [-0.55, 1.15, 1.9], snorkelPos: [-1.0, 1.75, 0.55],
    winch: { fairlead: [0, 0.6, 2.56] },
    eye: [0.42, 1.55, -0.2], hoodEye: [0, 1.45, 1.4],
    drag: { cd: 0.5, area: 3.3 },
    buoyancy: 0.28,
    shafts: [7000, 8500], parts: 1.1, tc: true,
    style: 'trekker', look: { bed: true, coils: true },
  },
  shepherd: {
    // the Land Rover Defender 110 station wagon (a real model: render/TruckAssets.js)
    id: 'shepherd', name: 'Land Rover Defender 110',
    blurb: 'Defender 110 station wagon: 110" wheelbase, 2.5 turbo-diesel, five-speed, coil springs and long travel, a bull bar and side steps. Tall, tireless and unstoppable.',
    mass: 2050, cgHeight: 0.86, cgZ: -0.06, inertiaBox: [1.7, 1.4, 4.2],
    axles: [
      { z: 1.397, track: 1.486, springTrack: 0.9, rate: 39000, bump: 2300, rebound: 4600, travel: 0.24, sag: 0.1, mass: 95, steer: 0.55, brake: 3000, swayBar: 15000, diffDrop: 0.17, diffX: -0.12 },
      { z: -1.397, track: 1.486, springTrack: 1.0, rate: 46000, bump: 2500, rebound: 5000, travel: 0.27, sag: 0.11, mass: 100, steer: 0, brake: 2000, handbrake: 3000, diffDrop: 0.17, diffX: -0.12 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 31, axle: 4.10, trans: 3, fit: 31, low: 2.74 },
    hull: [
      { c: [0, 0.8, -0.22], h: [0.89, 0.33, 2.13], pts: 'bottom' },        // body: bumpers 0.47 m up, waist 1.13
      { c: [0, 0.45, 0], h: [0.4, 0.11, 1.0], pts: 'bottom' },              // belly: transfer case 0.34 m up
      { c: [0, 1.52, -0.6], h: [0.87, 0.44, 1.75], pts: 'top' },            // station wagon body, roof 1.96 m
    ],
    roofY: 1.96, cabZ: 0.55, noseZ: 1.95, rackZ: -0.6,
    intakePos: [-0.62, 0.98, 1.7], snorkelPos: [-0.9, 2.05, 0.95],
    winch: { fairlead: [0, 0.66, 2.15] },
    eye: [0.42, 1.6, 0.0], hoodEye: [0, 1.42, 1.45],
    drag: { cd: 0.65, area: 3.2 },
    buoyancy: 0.3,
    shafts: [5500, 7000], tyreLoad: 5000, parts: 1.0,
    style: 'shepherd', look: { top: 'hard', coils: true },
  },
  drover: {
    // the Mitsubishi Pajero (third generation, 1999-2006) long-wheelbase five-door: 2,780 mm wheelbase, 4,775 mm long,
    // 1,875 mm wide, a monocoque with independent suspension at all four corners, Super Select four-wheel drive, 235 mm
    // under it (a real model: render/TruckAssets.js)
    id: 'drover', name: 'Mitsubishi Pajero',
    blurb: 'Mitsubishi Pajero, the Dakar winner\'s road car: 109" wheelbase, the 3.2 DI-D turbo-diesel, a five-speed automatic, Super Select four-wheel drive with a low range, independent suspension at all four corners, traction control. Quick and comfortable on rough tracks.',
    mass: 2180, cgHeight: 0.84, cgZ: 0.08, inertiaBox: [1.8, 1.35, 4.4],
    axles: [
      { z: 1.39, track: 1.58, springTrack: 1.1, rate: 46000, bump: 2600, rebound: 5200, travel: 0.2, sag: 0.09, mass: 90, steer: 0.55, brake: 3400, swayBar: 24000, ifs: true, armDrop: 0.1 },
      { z: -1.39, track: 1.58, springTrack: 1.1, rate: 50000, bump: 2600, rebound: 5200, travel: 0.22, sag: 0.095, mass: 95, steer: 0, brake: 2300, handbrake: 3200, ifs: true, armDrop: 0.1 },
    ],
    trans: { tcK: 9.6 },
    stock: { tyre: 31, axle: 4.10, trans: 14, fit: 31, low: 1.9 },
    stockTyre: { label: '265/70 R16 A/T', radius: 0.39, width: 0.265, rim: 16, desc: 'The Pajero\'s 265/70 R16 all-terrains (31") on alloys.' },
    hull: [
      { c: [0, 0.87, -0.06], h: [0.94, 0.42, 2.32], pts: 'bottom' },       // body: bumpers 0.45 m up, the beltline 1.29
      { c: [0, 0.47, 0], h: [0.45, 0.1, 1.2], pts: 'bottom' },              // belly: 0.37 m up
      { c: [0, 1.65, -0.85], h: [0.9, 0.33, 1.2], pts: 'top' },             // roof 1.98 m
    ],
    roofY: 1.95, cabZ: 0, noseZ: 2.25, rackZ: -0.9,
    intakePos: [-0.55, 1.1, 1.7], snorkelPos: [-0.95, 1.9, 0.6],
    winch: { fairlead: [0, 0.6, 2.27] },
    eye: [0.4, 1.62, 0.0], hoodEye: [0, 1.5, 1.2],
    drag: { cd: 0.45, area: 3.2 },
    buoyancy: 0.3,
    shafts: [8000, 9000], tyreLoad: 5300, parts: 1.05, tc: true,
    style: 'drover', look: { coils: true },
  },
  bruiser: {
    // the Ram 2500 Power Wagon crew cab (2019-2022): 3,795 mm wheelbase, 6,070 mm long, 2,010 mm wide, three and a
    // quarter tons, coil springs on beam axles at both ends, e-lockers front and rear, a front sway bar that
    // disconnects (a real model: render/TruckAssets.js)
    id: 'bruiser', name: 'Ram 2500 Power Wagon',
    blurb: 'Ram 2500 Power Wagon crew cab: 149" wheelbase, the 6.4 HEMI V8, a six-speed automatic and a 2.64 low range, lockers at both ends, a front sway bar that disconnects, coils all round, 35s. Three and a quarter tons that climb like a jeep.',
    mass: 3280, cgHeight: 0.94, cgZ: 0.27, inertiaBox: [1.95, 1.5, 5.6],
    axles: [
      { z: 1.8975, track: 1.762, springTrack: 1.05, rate: 84000, bump: 4400, rebound: 8800, travel: 0.24, sag: 0.09, mass: 175, steer: 0.5, brake: 5600, swayBar: 30000, diffDrop: 0.19, diffX: -0.2 },
      { z: -1.8975, track: 1.74, springTrack: 1.12, rate: 90000, bump: 4400, rebound: 8800, travel: 0.25, sag: 0.085, mass: 190, steer: 0, brake: 3600, handbrake: 5000, diffDrop: 0.2, diffX: -0.06 },
    ],
    trans: { tcK: 8 },
    stock: { tyre: 35, axle: 4.10, trans: 8, fit: 37, low: 2.64, diffs: 3, psi: 45 },
    axleRatios: [3.73, 4.10, 4.30, 4.56, 4.88, 5.13, 5.38],
    stockTyre: { label: 'LT315/70 R17 M/T', radius: 0.437, width: 0.315, rim: 17, desc: '35-inch mud-terrains on 17" black wheels.' },
    hull: [
      { c: [0, 1.01, -0.13], h: [1.04, 0.46, 3.02], pts: 'bottom' },       // body and bed: bumpers 0.55 m up, bonnet and bed rails 1.47
      { c: [0, 0.58, 0.1], h: [0.5, 0.1, 1.6], pts: 'bottom' },             // belly: the transfer case 0.48 m up
      { c: [0, 1.73, -0.05], h: [0.95, 0.27, 0.9], pts: 'top' },            // crew cab, roof 2.0 m
    ],
    roofY: 2.0, cabZ: -0.1, noseZ: 2.87, rackZ: -2.05,
    intakePos: [-0.6, 1.3, 2.0], snorkelPos: [-1.05, 2.0, 0.95],
    winch: { fairlead: [0, 0.75, 2.88] },
    eye: [0.45, 1.72, 0.2], hoodEye: [0, 1.6, 1.6],
    drag: { cd: 0.6, area: 3.7 },
    buoyancy: 0.27,
    shafts: [14000, 15000], tyreK: 1.5, tyreLoad: 8000, parts: 1.3, tc: true,
    style: 'bruiser', look: { bed: true, coils: true },
  },
  rhino: {
    // the Mercedes-Benz Unimog U1300L (the 435, built from 1975, the German army's two-tonner): 3,250 mm wheelbase,
    // portal axles on coil springs at both ends, diff locks front and rear, the cab over the front axle, and here a box
    // body on the back (a real model: render/TruckAssets.js)
    id: 'rhino', name: 'Mercedes-Benz Unimog U1300L',
    blurb: 'Unimog U1300L with a box body: 128" wheelbase, the OM 352 5.7 diesel six, an eight-speed box, portal axles on coils, diff locks at both ends, tyre inflation from the cab, 46 cm under the diffs. Six tons that go where nothing else can.',
    mass: 6200, cgHeight: 1.25, cgZ: 0.15, inertiaBox: [2.2, 2.2, 5.4],
    axles: [
      { z: 1.625, track: 1.86, springTrack: 1.1, rate: 260000, bump: 9000, rebound: 18000, travel: 0.3, sag: 0.09, mass: 420, steer: 0.5, brake: 14000, swayBar: 80000, diffDrop: 0.06, plateDrop: -0.12, diffX: 0 },
      { z: -1.625, track: 1.86, springTrack: 1.1, rate: 240000, bump: 8500, rebound: 17000, travel: 0.32, sag: 0.1, mass: 430, steer: 0, brake: 9000, handbrake: 14000, diffDrop: 0.06, plateDrop: -0.12, diffX: 0 },
    ],
    trans: { tcK: 6 },
    stock: { tyre: 42, axle: 7.17, trans: 6, fit: 44, low: 1.0, diffs: 3, wheels: 1, intake: 1, psi: 55 },
    stockTyre: { label: '12.5 R20', radius: 0.54, width: 0.318, rim: 20, desc: 'Military-pattern 12.5 R20 radials on 20" steel wheels, 1.08 m tall.' },
    only: { intake: [1] },                                                  // (its own raised intake, behind the cab)
    hull: [
      { c: [0, 1.205, -0.22], h: [1.08, 0.525, 2.79], pts: 'bottom' },      // chassis and bonnet: bumpers 0.68 m up, the bonnet 1.73
      { c: [0, 0.68, 0.1], h: [0.83, 0.22, 0.68], pts: 'bottom' },          // belly: the tanks and boxes between the axles, 0.46 m up
      { c: [0, 2.14, 0.98], h: [1.04, 0.41, 0.62], pts: 'top' },            // the cab over the front axle, roof 2.55 m
      { c: [0, 1.96, -1.345], h: [1.08, 0.835, 1.665], pts: 'top' },        // the box body, 2.8 m
    ],
    roofY: 2.55, cabZ: 1.0, noseZ: 2.57, rackZ: 1.0,
    intakePos: [-0.6, 1.2, 2.0], snorkelPos: [-0.95, 1.28, 0.4],
    winch: { fairlead: [0, 0.8, 2.58] },
    eye: [0.5, 2.13, 1.1], hoodEye: [0, 1.9, 2.3],
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
  wrangler: {
    // the Jeep Wrangler JK Rubicon two-door (2012-2018): 4,223 mm long with its spare, 1,873 mm wide, 259 mm under the diffs
    id: 'wrangler', name: 'Jeep Wrangler',
    blurb: 'Wrangler Rubicon two-door: 95" wheelbase, 3.6 V6, five-speed automatic, a 4:1 Rock-Trac low range, lockers both ends, a front sway bar that disconnects. Built for the rocks.',
    mass: 2000, cgHeight: 0.72, cgZ: 0.05, inertiaBox: [1.65, 1.3, 3.8],      // (static stability 1.11: NHTSA's figure)
    axles: [
      { z: 1.212, track: 1.572, springTrack: 0.96, rate: 36000, bump: 2300, rebound: 4600, travel: 0.26, sag: 0.1, mass: 110, steer: 0.58, brake: 3000, swayBar: 26000, diffDrop: 0.17, diffX: -0.15 },
      { z: -1.212, track: 1.572, springTrack: 1.04, rate: 40000, bump: 2300, rebound: 4600, travel: 0.28, sag: 0.105, mass: 105, steer: 0, brake: 2000, handbrake: 2800, diffDrop: 0.17, diffX: 0 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 33, axle: 4.10, trans: 9, fit: 33, low: 4.0, diffs: 3 },
    stockTyre: { label: 'LT255/75 R17 M/T', radius: 0.4072, width: 0.259, rim: 17, desc: 'The Rubicon\'s LT255/75 R17 mud-terrains (32"), on black alloys.' },
    hull: [
      { c: [0, 0.8, -0.01], h: [0.92, 0.35, 2.0], pts: 'bottom' },          // body: bumpers 0.45 m up, beltline 1.15
      { c: [0, 0.46, 0], h: [0.4, 0.11, 0.85], pts: 'bottom' },             // belly: transfer case 0.35 m up
      { c: [0, 1.5, -0.75], h: [0.86, 0.3, 1.15], pts: 'top' },             // hard top, roof 1.8 m
    ],
    roofY: 1.8, cabZ: 0.3, noseZ: 2.0, rackZ: -0.75,
    intakePos: [-0.55, 1.0, 1.4], snorkelPos: [-0.9, 1.8, 0.55],
    winch: { fairlead: [0, 0.62, 2.03] },
    eye: [0.37, 1.48, -0.2], hoodEye: [0, 1.36, 1.0],
    drag: { cd: 0.58, area: 3.0 },
    buoyancy: 0.3,
    shafts: [6000, 7000], parts: 1.1, tc: true,
    style: 'wrangler', look: { top: 'black', coils: true },
  },
  bronco: {
    // the Ford Bronco Badlands four-door with the Sasquatch package (2021-): 4,811 mm long, 1,928 mm wide, 295 mm under
    // the rear diff
    id: 'bronco', name: 'Ford Bronco',
    blurb: 'Bronco Badlands four-door with the Sasquatch package: 116" wheelbase, 2.7 EcoBoost twin-turbo V6, ten-speed automatic, 35s, lockers both ends, independent front on long-travel coil-overs, a five-link rear axle.',
    mass: 2380, cgHeight: 0.77, cgZ: 0.03, inertiaBox: [1.75, 1.35, 4.3],      // (static stability 1.12)
    axles: [
      { z: 1.475, track: 1.72, springTrack: 1.09, rate: 43000, bump: 2700, rebound: 5400, travel: 0.22, sag: 0.09, mass: 90, steer: 0.55, brake: 3400, swayBar: 26000, ifs: true },
      { z: -1.475, track: 1.72, springTrack: 1.08, rate: 47000, bump: 2700, rebound: 5400, travel: 0.26, sag: 0.1, mass: 120, steer: 0, brake: 2300, handbrake: 3000, diffDrop: 0.12, diffX: 0.06 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 35, axle: 4.70, trans: 11, fit: 35, low: 3.06, diffs: 3 },
    axleRatios: [3.73, 4.27, 4.46, 4.70, 5.13, 5.38, 5.89],
    stockTyre: { label: '315/70 R17 M/T', radius: 0.437, width: 0.315, rim: 17, desc: 'The Sasquatch package\'s 315/70 R17 mud-terrains (35"), on 17" wheels.' },
    hull: [
      { c: [0, 0.89, -0.075], h: [0.95, 0.35, 2.295], pts: 'bottom' },     // body: bumpers 0.54 m up, beltline 1.24
      { c: [0, 0.5, 0], h: [0.42, 0.1, 1.0], pts: 'bottom' },               // belly: frame and transfer case 0.4 m up
      { c: [0, 1.6, -0.85], h: [0.88, 0.36, 1.35], pts: 'top' },            // hard top, roof 1.96 m
    ],
    roofY: 1.96, cabZ: 0.45, noseZ: 2.25, rackZ: -0.9,
    intakePos: [-0.55, 1.05, 1.55], snorkelPos: [-0.95, 1.9, 0.62],
    winch: { fairlead: [0, 0.62, 2.22] },
    eye: [0.42, 1.56, -0.25], hoodEye: [0, 1.45, 1.15],
    drag: { cd: 0.56, area: 3.3 },
    buoyancy: 0.3,
    shafts: [6500, 8000], parts: 1.15, tc: true,
    style: 'bronco', look: { top: 'paint', coils: true, alloy: true },
  },
  hummer: {
    // the AM General Hummer H1 Alpha hard top (2006): 3,302 mm wheelbase, 2,197 mm wide, 406 mm under the diffs (geared
    // hubs carry the axles up above the wheel centres), tyre inflation from the cab
    id: 'hummer', name: 'Hummer H1',
    blurb: 'Hummer H1 Alpha: the civilian Humvee. 130" wheelbase, 6.6 Duramax turbo-diesel V8, Allison five-speed, independent suspension at both ends on geared hubs, 16" under the diffs, 37s with tyre inflation from the cab. Three and a half tons, as wide as a lane.',
    mass: 3650, cgHeight: 0.86, cgZ: 0.1, inertiaBox: [2.0, 1.4, 4.4],
    axles: [
      { z: 1.651, track: 1.93, springTrack: 1.3, rate: 76000, bump: 4200, rebound: 8400, travel: 0.24, sag: 0.1, mass: 160, steer: 0.52, brake: 6200, swayBar: 30000, ifs: true, armDrop: 0.07 },
      { z: -1.651, track: 1.93, springTrack: 1.3, rate: 82000, bump: 4200, rebound: 8400, travel: 0.24, sag: 0.1, mass: 160, steer: 0, brake: 4600, handbrake: 6000, ifs: true, armDrop: 0.07 },
    ],
    trans: { tcK: 8 },
    stock: { tyre: 37, axle: 5.24, trans: 12, fit: 37, low: 2.72, diffs: 1, wheels: 1 },
    axleRatios: [4.71, 5.24, 5.89, 6.53],
    stockTyre: { label: '37x12.50 R17 M/T', radius: 0.475, width: 0.318, rim: 17, desc: 'The Alpha\'s 37x12.50 R17 mud-terrains, run-flat inserts and tyre inflation from the cab.' },
    hull: [
      { c: [0, 1.06, -0.08], h: [1.06, 0.38, 2.52], pts: 'bottom' },        // body: bumpers 0.68 m up, beltline 1.44
      { c: [0, 0.56, 0], h: [0.46, 0.1, 1.25], pts: 'bottom' },             // belly: the drivetrain up in its tunnel, 0.46 m up
      { c: [0, 1.72, -0.75], h: [1.0, 0.27, 1.5], pts: 'top' },             // hard top, roof 1.99 m
    ],
    roofY: 1.99, cabZ: 0.6, noseZ: 2.44, rackZ: -0.9,
    intakePos: [-0.75, 1.1, 1.3], snorkelPos: [-0.95, 1.95, 0.75],
    winch: { fairlead: [0, 0.95, 2.4] },
    eye: [0.55, 1.68, 0.05], hoodEye: [0, 1.6, 1.4],
    drag: { cd: 0.68, area: 4.0 },
    buoyancy: 0.28,
    shafts: [9000, 11000], tyreK: 1.4, tyreLoad: 9000, parts: 1.5, tc: true,
    style: 'hummer', look: { top: 'paint', coils: true },
  },
  hummerev: {
    // the GMC Hummer EV pickup, Edition 1 (2022): 3,445 mm wheelbase, 5,507 mm long, 2,202 mm wide, four tons and a
    // bit (1,326 kg of it the battery, low in the floor), three motors and four-wheel independent suspension on air
    // springs (here at its raised Terrain height), front and rear e-lockers, 35-inch mud-terrains
    id: 'hummerev', name: 'GMC Hummer EV',
    blurb: 'GMC Hummer EV Edition 1: the electric supertruck. 136" wheelbase, three motors and 1,000 hp, all of its torque from a standstill, e-lockers at both ends, air suspension, 35s. Four tons, silent, very quick.',
    mass: 4110, cgHeight: 0.8, cgZ: 0, inertiaBox: [2.0, 1.25, 4.8],
    axles: [
      { z: 1.7225, track: 1.87, springTrack: 1.32, rate: 64000, bump: 4500, rebound: 9000, travel: 0.25, sag: 0.1, mass: 145, steer: 0.55, brake: 7600, swayBar: 30000, ifs: true, armDrop: 0.08 },
      { z: -1.7225, track: 1.87, springTrack: 1.32, rate: 66000, bump: 4500, rebound: 9000, travel: 0.25, sag: 0.1, mass: 145, steer: 0, brake: 5800, handbrake: 6400, ifs: true, armDrop: 0.08 },
    ],
    trans: { tcK: 8, efficiency: 0.94 },
    stock: { tyre: 35, tread: 1, axle: 12.5, trans: EV_TRANS, fit: 37, low: 1, diffs: 3, wheels: 0, psi: 40 },
    axleRatios: [12.5],
    // (what an electric truck can't swap: its reduction gears and gearbox, a low range it hasn't got, an air intake it
    // doesn't need)
    only: { gears: [0], trans: [EV_TRANS], tcase: [0], intake: [0] },
    stockTyre: { label: 'LT315/70 R17 M/T', radius: 0.437, width: 0.315, rim: 17, desc: 'The Edition 1\'s 35-inch Goodyear Wrangler Territory mud-terrains on 17" beadlock-capable wheels.' },
    hull: [
      { c: [0, 1.06, -0.15], h: [1.1, 0.36, 2.76], pts: 'bottom' },        // body: the front and rear ends 0.70 m up, beltline 1.42
      { c: [0, 0.43, 0], h: [0.6, 0.1, 1.5], pts: 'bottom' },              // belly: the battery's skid plate, 0.33 m up
      { c: [0, 1.71, -0.15], h: [1.0, 0.28, 1.05], pts: 'top' },          // the crew cab under the removable roof panels, 1.99 m
    ],
    roofY: 1.935, cabZ: -0.15, noseZ: 2.6, rackZ: -1.95,
    // (no air intake: the drive units and the battery are sealed to 32 inches of water)
    intakePos: [0.6, 0.89, 1.6], snorkelPos: [0.6, 0.89, 1.6],
    winch: { fairlead: [0, 0.72, 2.58] },
    eye: [0.42, 1.6, -0.1], hoodEye: [0, 1.52, 1.25],
    drag: { cd: 0.5, area: 3.9 },
    buoyancy: 0.22,
    shafts: [11000, 13000], tyreK: 1.5, tyreLoad: 10000, parts: 1.6, tc: true,
    style: 'hummerev', look: { top: 'paint', coils: true, bed: true },
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
