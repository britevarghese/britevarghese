// The trucks: real four-wheel drives of the world (each body a real 3D model: render/TruckAssets.js), with their real
// wheelbases, tracks, weights, engines and gearing. Most are body-on-frame on beam axles (leaf or coil springs), some
// independent at one end or both; a manual or automatic gearbox and a two-speed transfer case (the Unimog: portal axles
// and an eight-speed box; the Hummer EV and the Cybertruck: electric motors and one gear).
//
//   Gecko     the Lada Niva (a real model)                             Mule     the Willys MB, the original jeep (a real model)
//   Ranger    the UAZ Hunter (a real model)                            Trekker  the Ford Ranger Raptor (a real model)
//   Shepherd  the Land Rover Defender 110, 2026 (a real model)         Drover   the Mitsubishi Pajero (a real model)
//   Hauler    the Chevrolet K20 Suburban (a real model)                 Bruiser  the Ram 2500 Power Wagon (a real model)
//   Rhino     the Mercedes-Benz Unimog U1300L (a real model)          G 63     the Mercedes-AMG G-Class (a real model)
//   Roxx      the Mahindra Thar Roxx, five doors (a real model)       Cybertruck  the Tesla Cybertruck Cyberbeast (a real model)
//
// And the road cars (`road`, at the end): sports cars and supercars, rear- or all-wheel drive, on their own tyres.
//
//   M4 CSL    the BMW M4 CSL                                           AMG GT   the Mercedes-AMG GT S
//   C8        the Chevrolet Corvette Stingray                          Huracán  the Lamborghini Huracán LP 610-4
//   R8        the Audi R8 V10 plus, widebody                           M3       the BMW M3 (E30)
//   NSX       the Honda NSX (NA1)                                      930      the Porsche 911 Turbo (930)
//   R34       the Nissan Skyline GT-R (R34)                            R35      the Nissan GT-R (R35)
//   RX-7      the Mazda RX-7 (FD)                                      Senna    the McLaren Senna
//   STi       the Subaru Impreza WRX STi (GC8)                         Supra    the Toyota Supra Turbo (A80)
// (each one a real model too)
//
// (real: the makers' 0-100 km/h time and top speed, which the tests hold the physics to)
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

import { buildSpec, decodeBuild, normalizeBuild, encodeBuild, TRUCK_BASES, EV_TRANS, ROAD_ONLY, transIndex } from './Upgrades.js';

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
    // driver's eyes, the bonnet camera; hip: how far forward his hips are (z, m), in the model's own seat (its back's
    // face at hip height, measured, and 12 cm on: where it is the game's, they are 28 cm ahead of his eyes, as it is built)
    eye: [0.4, 1.62, -0.2], hip: -0.15, hoodEye: [0, 1.48, 1.2],
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
    eye: [0.47, 1.6, 0.25], hip: 0.17, hoodEye: [0, 1.45, 1.5],          // driver's eyes, the bonnet camera
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
    eye: [0.31, 1.36, -0.25], hip: -0.36, hoodEye: [0, 1.22, 0.95],          // driver's eyes, the bonnet camera
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
    eye: [0.41, 1.38, -0.15], hip: -0.17, hoodEye: [0, 1.25, 0.8],
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
    eye: [0.42, 1.55, -0.2], hip: -0.27, hoodEye: [0, 1.45, 1.4],
    drag: { cd: 0.5, area: 3.3 },
    buoyancy: 0.28,
    shafts: [7000, 8500], parts: 1.1, tc: true,
    style: 'trekker', look: { bed: true, coils: true },
  },
  shepherd: {
    // the Land Rover Defender 110 (L663, the 2026 model year): 3,022 mm wheelbase, 5,018 mm long over the spare wheel,
    // 1,996 mm wide, an aluminium monocoque with independent suspension at all four corners (double wishbones in front,
    // integral links behind) on air springs, a two-speed transfer box and an active centre diff, 218 mm under it at
    // its normal height (Land Rover's technical data; a real model: render/TruckAssets.js)
    id: 'shepherd', name: 'Land Rover Defender 110',
    blurb: 'Land Rover Defender 110 (2026): 119" wheelbase, the D350 3.0 straight-six turbo-diesel with a mild hybrid, a ZF eight-speed automatic and a two-speed transfer box, air suspension and independent at all four corners, Terrain Response, traction control and a rear limited-slip diff. Quick, quiet and very capable.',
    mass: 2430, cgHeight: 0.78, cgZ: 0.02, inertiaBox: [1.85, 1.35, 4.5],
    axles: [
      { z: 1.511, track: 1.704, springTrack: 1.2, rate: 46000, bump: 2800, rebound: 5600, travel: 0.24, sag: 0.1, mass: 95, steer: 0.58, brake: 4000, swayBar: 26000, ifs: true, armDrop: 0.1 },
      { z: -1.511, track: 1.7, springTrack: 1.2, rate: 50000, bump: 2800, rebound: 5600, travel: 0.26, sag: 0.1, mass: 95, steer: 0, brake: 2700, handbrake: 3400, ifs: true, armDrop: 0.1 },
    ],
    trans: { tcK: 9.4 },
    stock: { tyre: 31, axle: 3.31, trans: 15, fit: 33, low: 2.93, diffs: 1 },
    axleRatios: [3.31, 3.55, 4.1, 4.56, 4.88, 5.13],
    stockTyre: { label: '255/60 R20 A/T', radius: 0.407, width: 0.255, rim: 20, desc: 'The Defender\'s 255/60 R20 all-terrains (32") on 20" alloys.' },
    hull: [
      { c: [0, 0.83, -0.14], h: [0.99, 0.41, 2.47], pts: 'bottom' },       // body: the bumpers and sills 0.42 m up, beltline 1.24
      { c: [0, 0.32, 0], h: [0.5, 0.1, 1.15], pts: 'bottom' },              // belly: 218 mm under the subframes
      { c: [0, 1.61, -0.75], h: [0.93, 0.33, 1.6], pts: 'top' },            // the five-door body, roof 1.94 m
    ],
    roofY: 1.94, cabZ: 0.1, noseZ: 2.32, rackZ: -1.0,
    intakePos: [-0.6, 1.05, 1.7], snorkelPos: [-1.0, 1.85, 0.6],
    winch: { fairlead: [0, 0.55, 2.3] },
    eye: [0.41, 1.6, -0.17], hip: -0.04, hoodEye: [0, 1.42, 1.4],
    drag: { cd: 0.41, area: 3.4 },
    buoyancy: 0.3,
    shafts: [8000, 9000], tyreLoad: 5600, parts: 1.4, tc: true,
    style: 'shepherd', look: { coils: true },
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
    eye: [0.4, 1.62, -0.18], hip: -0.27, hoodEye: [0, 1.5, 1.2],
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
    eye: [0.46, 1.74, 0.5], hip: 0.53, hoodEye: [0, 1.6, 1.6],
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
    eye: [0.48, 2.13, 1.1], hip: 0.81, hoodEye: [0, 1.9, 2.3],
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
    eye: [-0.38, 1.5, -0.22], hip: -0.28, hoodEye: [0, 1.38, 1.0],                   // (right-hand drive)
    drag: { cd: 0.55, area: 2.8 },
    buoyancy: 0.3,
    shafts: [5000, 6500], parts: 1.0,
    style: 'thar', look: { top: 'black', coils: true, alloy: true },
  },
  roxx: {
    // the Mahindra Thar Roxx AX7L 4x4 diesel automatic (2024): the five-door Thar, 4,428 mm long, 1,870 mm wide,
    // 2,850 mm wheelbase, 1,580 mm track, 226 mm under the rear axle, right-hand drive; double wishbones in front, a
    // five-link rear axle on coils with an electronic locker. (Mahindra publishes no kerb weight: 2,100 kg here is
    // the three-door Thar's and the longer body's, with a driver and a full tank)
    id: 'roxx', name: 'Mahindra Thar Roxx',
    blurb: 'The five-door Thar: 112" wheelbase, the mHawk 2.2 turbo-diesel at 175 PS and 370 Nm, a six-speed automatic, double wishbones in front and a five-link rear axle with an electronic locker. Longer, roomier, steadier.',
    mass: 2100, cgHeight: 0.8, cgZ: 0.1, inertiaBox: [1.7, 1.35, 4.2],
    axles: [
      { z: 1.425, track: 1.58, springTrack: 1.0, rate: 40000, bump: 2700, rebound: 5400, travel: 0.2, sag: 0.085, mass: 85, steer: 0.58, brake: 3300, swayBar: 24000, ifs: true },
      { z: -1.425, track: 1.58, springTrack: 1.0, rate: 44000, bump: 2600, rebound: 5200, travel: 0.25, sag: 0.095, mass: 95, steer: 0, brake: 2100, handbrake: 3000, diffDrop: 0.16, diffX: 0 },
    ],
    trans: { tcK: 10 },
    stock: { tyre: 31, axle: 4.27, trans: transIndex('6-spd auto'), fit: 31, low: 2.48, diffs: 2 },
    axleRatios: [3.73, 4.27, 4.56, 4.88, 5.13, 5.38, 5.89],
    stockTyre: { label: '255/60 R19', radius: 0.3943, width: 0.255, rim: 19, desc: 'The AX7L\'s 255/60 R19s on diamond-cut alloys.' },
    hull: [
      { c: [0, 0.83, -0.015], h: [0.93, 0.39, 2.085], pts: 'bottom' },     // body: bumpers 0.44 m up, beltline 1.22
      { c: [0, 0.45, 0], h: [0.38, 0.11, 1.0], pts: 'bottom' },            // belly: transfer case 0.34 m up
      { c: [0, 1.54, -0.79], h: [0.86, 0.32, 1.21], pts: 'top' },          // the hard top over both rows, roof 1.86 m
    ],
    roofY: 1.86, cabZ: 0.35, noseZ: 2.07, rackZ: -0.8,
    intakePos: [0.55, 0.95, 1.55], snorkelPos: [0.9, 1.8, 0.75],        // (the snorkel up the left pillar)
    winch: { fairlead: [0, 0.6, 2.09] },
    eye: [-0.38, 1.47, -0.08], hip: -0.19, hoodEye: [0, 1.36, 1.15],                 // (right-hand drive)
    drag: { cd: 0.55, area: 3.0 },
    buoyancy: 0.3,
    shafts: [5500, 7000], parts: 1.05, tc: true,
    style: 'roxx', look: { top: 'black', coils: true, alloy: true },
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
    eye: [0.37, 1.48, -0.2], hip: -0.26, hoodEye: [0, 1.36, 1.0],
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
    eye: [0.38, 1.56, -0.08], hip: -0.01, hoodEye: [0, 1.45, 1.15],
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
    eye: [0.63, 1.7, -0.1], hoodEye: [0, 1.6, 1.4],
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
    eye: [0.44, 1.68, 0.17], hip: 0.18, hoodEye: [0, 1.52, 1.25],
    drag: { cd: 0.5, area: 3.9 },
    buoyancy: 0.22,
    shafts: [11000, 13000], tyreK: 1.5, tyreLoad: 10000, parts: 1.6, tc: true,
    style: 'hummerev', look: { top: 'paint', coils: true, bed: true },
  },

  cybertruck: {
    // the Tesla Cybertruck Cyberbeast (2024): 3,635 mm wheelbase, 1,772 mm track, 5,683 mm long, 3,113 kg; three motors
    // (630 kW), one 15.02:1 reduction, adaptive air suspension on double wishbones at all four corners (here at its
    // raised off-road height: up to 406 mm under it), a locking front differential and a rear one locked by its two
    // rear motors, LT285/65 R20 all-terrains. The body is the 2019 show truck's (a real model: render/TruckAssets.js)
    id: 'cybertruck', name: 'Tesla Cybertruck',
    blurb: 'Tesla Cybertruck Cyberbeast: a stainless-steel wedge on 35s. 143" wheelbase, three motors and 845 hp, a locked front and rear for the dirt, air suspension raised for the trail. Three tons, silent, and quicker off the line than the supercars.',
    mass: 3190, cgHeight: 0.78, cgZ: 0, inertiaBox: [2.0, 1.25, 5.0],
    axles: [
      { z: 1.8175, track: 1.772, springTrack: 1.3, rate: 52000, bump: 4000, rebound: 8000, travel: 0.25, sag: 0.1, mass: 130, steer: 0.55, brake: 6200, swayBar: 28000, ifs: true, armDrop: 0.08 },
      { z: -1.8175, track: 1.772, springTrack: 1.3, rate: 54000, bump: 4000, rebound: 8000, travel: 0.25, sag: 0.1, mass: 135, steer: 0, brake: 4800, handbrake: 5200, ifs: true, armDrop: 0.08 },
    ],
    trans: { tcK: 8, efficiency: 0.95 },
    stock: { tyre: 35, axle: 15.02, trans: EV_TRANS, fit: 37, low: 1, diffs: 3, wheels: 0, psi: 48 },
    axleRatios: [15.02],
    // (as the Hummer EV: no reduction gears, gearbox, low range or air intake to swap)
    only: { gears: [0], trans: [EV_TRANS], tcase: [0], intake: [0] },
    stockTyre: { label: 'LT285/65 R20 A/T', radius: 0.4393, width: 0.285, rim: 20, desc: 'The Cybertruck\'s 35-inch Goodyear Wrangler Territory RT all-terrains on 20" wheels behind their aero covers.' },
    hull: [
      { c: [0, 1.1, -0.11], h: [1.05, 0.45, 2.86], pts: 'bottom' },       // body: the nose and the tail 0.65 m up, the bed's sides 1.55
      { c: [0, 0.48, 0], h: [0.7, 0.08, 1.6], pts: 'bottom' },             // belly: the battery's armour, 0.40 m up
      { c: [0, 1.62, 0], h: [0.95, 0.3, 1.0], pts: 'top' },               // the cab under its ridge, 1.92 m
    ],
    roofY: 1.92, cabZ: 0.3, noseZ: 2.75, rackZ: -2.0,
    // (no air intake: sealed drive units and battery)
    intakePos: [0.6, 0.9, 2.0], snorkelPos: [0.6, 0.9, 2.0],
    winch: { fairlead: [0, 0.75, 2.7] },
    eye: [0.57, 1.5, 0.52], hip: 0.4, hoodEye: [0, 1.45, 2.05],
    drag: { cd: 0.39, area: 3.5 },
    buoyancy: 0.22,
    shafts: [11000, 13000], tyreK: 1.4, tyreLoad: 9000, parts: 1.5, tc: true,
    style: 'cybertruck', look: { top: 'paint', coils: true, bed: true },
  },

  gclass: {
    // the Mercedes-AMG G 63 (W463, 2015-2018): 2,850 mm wheelbase, 4,763 mm long with its spare, 1,855 mm wide, a ladder
    // frame and beam axles on coil springs at both ends, permanent four-wheel drive with three diff locks (centre, front,
    // rear) and a 2.16 low range, 210 mm under the diffs (a real model: render/TruckAssets.js)
    id: 'gclass', name: 'Mercedes-AMG G 63',
    blurb: 'Mercedes-AMG G 63: the G-Wagen with a 5.5 twin-turbo V8 (571 PS), a seven-speed automatic, permanent four-wheel drive with a low range and three diff locks, beam axles on coils. Absurdly fast for a box, and a real off-roader underneath.',
    mass: 2625, cgHeight: 0.85, cgZ: 0.09, inertiaBox: [1.75, 1.45, 4.2],
    axles: [
      { z: 1.425, track: 1.559, springTrack: 1.0, rate: 60000, bump: 3400, rebound: 6800, travel: 0.22, sag: 0.09, mass: 130, steer: 0.55, brake: 5000, swayBar: 32000, diffDrop: 0.17, diffX: -0.1 },
      { z: -1.425, track: 1.559, springTrack: 1.05, rate: 66000, bump: 3400, rebound: 6800, travel: 0.24, sag: 0.095, mass: 140, steer: 0, brake: 3500, handbrake: 4400, diffDrop: 0.17, diffX: 0 },
    ],
    // (the centre diff open, 40:60, until it is locked: the 4WD key)
    trans: { tcK: 8.6, drive: 'awd', split: 0.4, centre: [0, 0], centreLock: true },
    stock: { tyre: 31, axle: 4.0, trans: transIndex('7G'), fit: 33, low: 2.16, diffs: 3, psi: 36 },
    axleRatios: [3.7, 4.0, 4.38, 4.88, 5.13],
    stockTyre: { label: '275/50 R20', radius: 0.3915, width: 0.275, rim: 20, desc: 'The G 63\'s 275/50 R20s on 20-inch AMG wheels.' },
    hull: [
      { c: [0, 0.88, -0.02], h: [0.93, 0.4, 2.23], pts: 'bottom' },         // body: bumpers 0.49 m up, the beltline 1.28
      { c: [0, 0.33, 0], h: [0.45, 0.09, 1.2], pts: 'bottom' },             // belly: the floor tray 0.24 m up
      { c: [0, 1.6, -0.86], h: [0.88, 0.35, 1.2], pts: 'top' },             // the upright cabin, roof 1.95 m
    ],
    roofY: 1.948, cabZ: -0.5, noseZ: 2.2, rackZ: -0.9,
    intakePos: [-0.6, 0.7, 1.6], snorkelPos: [-0.95, 1.9, 0.6],
    winch: { fairlead: [0, 0.55, 2.2] },
    eye: [0.38, 1.66, -0.36], hoodEye: [0, 1.58, 1.3],
    drag: { cd: 0.54, area: 3.2 },
    buoyancy: 0.3,
    shafts: [8000, 9000], tyreLoad: 6000, parts: 1.6, tc: true,
    style: 'gclass', look: { top: 'paint', coils: true },
  },
  // ---------------------------------------------------------------- road cars (`road`: see roadCar below): sports cars
  // and supercars on their own tyres and gearboxes, rear- or all-wheel drive, with their downforce. Ground clearance is
  // the car's: a hand's width. Each body is the model's extent (render/TruckAssets.js).
  m4csl: roadCar({
    // the BMW M4 CSL (G82, 2022): 2,857 mm wheelbase, 4,801 mm long, 1,887 mm wide, 1,625 kg (DIN), 52% of it on the
    // front axle; the S58 straight-six, an eight-speed M Steptronic, rear-wheel drive through the Active M differential,
    // carbon-ceramic brakes and Cup 2 R tyres
    id: 'm4csl', name: 'BMW M4 CSL', real: { t100: 3.7, vmax: 307 },
    blurb: 'BMW M4 CSL: the lightest and fastest M4. The S58 3.0 twin-turbo straight-six with 550 PS, an eight-speed M Steptronic, rear-wheel drive through the Active M differential, a carbon roof and bonnet, Cup 2 R tyres. 0-100 km/h in 3.7 s, 307 km/h.',
    mass: 1700, cgHeight: 0.47, weightFront: 0.52, wheelbase: 2.857, track: [1.623, 1.625],
    body: [-2.512, 2.319, 0.944, 0.138, 1.41, [-0.8, 0.25]], springs: [52000, 56000], brakes: [3800, 2300],
    tyre: { d: 27, label: '275/35 R19 · 285/30 R20 Cup 2 R', radius: 0.3427, width: 0.28, rim: 20, mass: 24, inertia: 1.6, desc: 'The CSL\'s Michelin Pilot Sport Cup 2 R semi-slicks, 275/35 R19 in front and 285/30 R20 behind, on forged wheels.' },
    drive: 'rwd', box: 'Steptronic', tcK: 8.2, lockup: 1300, final: 3.154, finals: [2.85, 3.154, 3.46, 3.73], tread: 4,
    eye: [0.41, 1.15, -0.24], hoodEye: [0, 1.02, 1.25], cd: 0.36, area: 2.2, aero: [0.12, 0.18], parts: 2.0,
  }),
  amggt: roadCar({
    // the Mercedes-AMG GT S (C190, 2015): 2,630 mm wheelbase, 4,546 mm long, 1,939 mm wide, 1,570 kg (DIN), 47% of it
    // on the front axle (the engine behind the front axle, the gearbox at the back), the M178 4.0 twin-turbo V8, a
    // seven-speed dual-clutch transaxle, rear-wheel drive and an electronic limited-slip diff
    id: 'amggt', name: 'Mercedes-AMG GT S', real: { t100: 3.8, vmax: 310 },
    blurb: 'Mercedes-AMG GT S: a long bonnet over the M178 4.0 twin-turbo V8 (510 PS), a seven-speed dual-clutch transaxle at the back, rear-wheel drive and a limited-slip diff. 0-100 km/h in 3.8 s, 310 km/h, and a V8 that crackles.',
    mass: 1645, cgHeight: 0.45, weightFront: 0.47, wheelbase: 2.63, track: [1.595, 1.63],
    body: [-2.329, 2.201, 0.97, 0.122, 1.265, [-0.95, -0.1]], springs: [46000, 54000], brakes: [3600, 2400],
    tyre: { d: 27, label: '265/35 ZR19 · 295/30 ZR20', radius: 0.3425, width: 0.28, rim: 20, mass: 25, inertia: 1.6, desc: 'The GT S\'s Michelin Pilot Super Sports, 265/35 ZR19 in front and 295/30 ZR20 behind, on forged AMG wheels.' },
    drive: 'rwd', box: 'Speedshift', final: 3.67, finals: [3.27, 3.67, 3.92],
    eye: [0.39, 1.03, -0.5], hoodEye: [0, 0.98, 1.0], cd: 0.36, area: 2.05, aero: [0.08, 0.2], parts: 1.9,
  }),
  c8: roadCar({
    // the Chevrolet Corvette Stingray (C8, 2020) with the Z51 package: 2,722 mm wheelbase, 4,630 mm long, 1,933 mm
    // wide, 1,655 kg, 40% of it on the front axle: the LT2 6.2 V8 behind the seats, an eight-speed dual-clutch, rear-wheel
    // drive through an electronic limited-slip diff
    id: 'c8', name: 'Chevrolet Corvette Stingray', real: { t100: 3.5, vmax: 312 },
    blurb: 'Corvette Stingray (C8) Z51: the first mid-engined Corvette. The LT2 6.2 pushrod V8 behind the seats with 495 hp, an eight-speed dual-clutch, rear-wheel drive and an electronic limited-slip diff. 0-100 km/h in 3.5 s, 312 km/h.',
    mass: 1730, cgHeight: 0.45, weightFront: 0.4, wheelbase: 2.722, track: [1.571, 1.571],
    body: [-2.272, 2.41, 0.965, 0.109, 1.23, [-0.45, 0.35]], springs: [44000, 62000],
    tyre: { d: 27, label: '245/35 ZR19 · 305/30 ZR20', radius: 0.3428, width: 0.29, rim: 20, mass: 25, inertia: 1.6, desc: 'The Z51\'s Michelin Pilot Sport 4S, 245/35 ZR19 in front and 305/30 ZR20 behind.' },
    drive: 'rwd', box: 'Tremec 8', final: 5.56, finals: [5.17, 5.56, 5.88],
    eye: [0.38, 1.0, -0.17], hoodEye: [0, 0.88, 1.2], cd: 0.36, area: 2.1, aero: [0.1, 0.2], parts: 1.7,
  }),
  huracan: roadCar({
    // the Lamborghini Huracán LP 610-4 (2014): 2,620 mm wheelbase, 4,459 mm long, 1,924 mm wide, 1,532 kg, 42% of it
    // on the front axle; the 5.2 V10 behind the seats, the seven-speed dual-clutch, all-wheel drive through a
    // multi-plate coupling to the front axle
    id: 'huracan', name: 'Lamborghini Huracán', real: { t100: 3.2, vmax: 325 },
    blurb: 'Lamborghini Huracán LP 610-4: the 5.2 V10 behind the seats with 610 PS and a scream to 8,500 rpm, a seven-speed dual-clutch, all-wheel drive through a coupling to the front axle. 0-100 km/h in 3.2 s, 325 km/h.',
    mass: 1610, cgHeight: 0.44, weightFront: 0.42, wheelbase: 2.62, track: [1.633, 1.633],
    body: [-2.083, 2.386, 0.965, 0.133, 1.17, [-0.55, 0.35]], springs: [46000, 60000],
    tyre: { d: 27, label: '245/30 R20 · 305/30 R20', radius: 0.3445, width: 0.28, rim: 20, mass: 24, inertia: 1.55, desc: 'Pirelli P Zeros, 245/30 R20 in front and 305/30 R20 behind.' },
    drive: 'awd', split: 0.3, centre: [400, 0.35], box: 'S tronic', final: 3.94, finals: [3.73, 3.94, 4.25],
    eye: [0.37, 0.98, -0.1], hip: -0.08, hoodEye: [0, 0.84, 1.15], cd: 0.39, area: 1.98, aero: [0.08, 0.16], parts: 2.4,
  }),
  r8: roadCar({
    // the Audi R8 V10 plus (Type 4S, 2016) under a widebody kit, on deep-dish wheels: 2,650 mm wheelbase, 4,570 mm long
    // with its splitter, 2,210 mm across the flared arches, 1,555 kg, 40% of it on the front axle; the 5.2 V10 behind
    // the seats, the seven-speed S tronic, quattro all-wheel drive through a multi-plate coupling to the front axle
    id: 'r8', name: 'Audi R8 V10 plus (widebody)', real: { t100: 3.2, vmax: 330 },
    blurb: 'Audi R8 V10 plus under a widebody kit: the 5.2 V10 behind the seats with 610 PS and a scream to 8,700 rpm, a seven-speed S tronic, quattro all-wheel drive. Flared arches, a splitter and deep-dish wheels on a supercar you can use every day.',
    mass: 1630, cgHeight: 0.45, weightFront: 0.4, wheelbase: 2.65, track: [1.769, 1.855],
    body: [-2.09, 2.479, 1.106, 0.099, 1.278, [-0.55, 0.45]], springs: [46000, 60000],
    tyre: { d: 27, label: '245/30 R20 · 305/30 R20', radius: 0.338, width: 0.28, rim: 20, mass: 24, inertia: 1.55, desc: '245/30 R20 in front and 305/30 R20 behind, on deep-dish five-spoke wheels.' },
    drive: 'awd', split: 0.3, centre: [400, 0.35], box: 'S tronic', final: 3.97, finals: [3.73, 3.97, 4.25],
    eye: [0.44, 1.09, 0.06], hoodEye: [0, 1.06, 1.1], cd: 0.37, area: 2.2, aero: [0.08, 0.14], parts: 2.2,
  }),
  m3e30: roadCar({
    // the BMW M3 (E30, 1986): 2,562 mm wheelbase, 4,345 mm long, 1,680 mm wide, 1,200 kg, half of it on each axle;
    // the S14 2.3 four, the Getrag dog-leg five-speed, rear-wheel drive through a 25% limited-slip diff
    id: 'm3e30', name: 'BMW M3 (E30)', real: { t100: 6.7, vmax: 235 },
    blurb: 'BMW M3 (E30): the touring-car homologation special. The S14 2.3 four with 200 PS and a howl to 7,250 rpm, a dog-leg five-speed, rear-wheel drive and a limited-slip diff, 1.2 tons. Light, balanced, and a joy on a twisty road.',
    mass: 1275, cgHeight: 0.5, weightFront: 0.5, wheelbase: 2.562, track: [1.379, 1.403],
    body: [-2.269, 2.044, 0.84, 0.139, 1.336, [-1.1, 0.1]], springs: [30000, 34000],
    tyre: { d: 24, label: '205/55 VR15', radius: 0.3081, width: 0.205, rim: 15, mass: 19, inertia: 0.95, desc: 'Period 205/55 VR15 performance tyres on the M3\'s cross-spoke wheels.' },
    drive: 'rwd', box: 'dog-leg 5', final: 3.25, finals: [3.15, 3.25, 3.46, 3.73, 4.1],
    eye: [0.31, 1.13, -0.22], hoodEye: [0, 1.02, 1.0], cd: 0.37, area: 1.9, aero: [0, 0.05], parts: 1.3,
  }),
  nsx: roadCar({
    // the Honda NSX (NA1, 1990), right-hand drive: 2,530 mm wheelbase, 4,405 mm long, 1,810 mm wide, an aluminium
    // monocoque, 1,365 kg, 42% of it on the front axle; the C30A 3.0 VTEC V6 behind the seats, a five-speed manual
    id: 'nsx', name: 'Honda NSX', real: { t100: 5.7, vmax: 270 },
    blurb: 'Honda NSX (NA1): the everyday supercar, an aluminium body tuned with Ayrton Senna. The C30A 3.0 VTEC V6 behind the seats revving to 8,000, a five-speed manual, rear-wheel drive. Light, precise and forgiving.',
    mass: 1440, cgHeight: 0.46, weightFront: 0.42, wheelbase: 2.53, track: [1.557, 1.557],
    body: [-2.236, 2.176, 0.91, 0.104, 1.16, [-0.55, 0.15]], springs: [36000, 46000],
    tyre: { d: 24, label: '205/50 ZR15 · 225/50 ZR16', radius: 0.296, width: 0.215, rim: 16, mass: 19, inertia: 0.95, desc: '205/50 ZR15 in front and 225/50 ZR16 behind, as it came.' },
    drive: 'rwd', box: 'NSX 5', final: 4.062, finals: [3.73, 4.062, 4.235],
    eye: [-0.34, 0.95, -0.22], hoodEye: [0, 0.9, 1.25], cd: 0.34, area: 1.8, aero: [0, 0.04], parts: 1.5,
  }),
  p930: roadCar({
    // the Porsche 911 Turbo (930, 1975): 2,272 mm wheelbase, 4,291 mm long, 1,775 mm wide, 1,140 kg, 38% of it on the
    // front axle (the engine behind the rear one); the 3.0 flat-six with one big turbo, a four-speed manual
    id: 'p930', name: 'Porsche 911 Turbo (930)', real: { t100: 5.5, vmax: 250 },
    blurb: 'Porsche 911 Turbo (930): the widowmaker. A 3.0 flat-six behind the rear axle with one big turbo (260 PS, all of it at once), a four-speed manual, rear-wheel drive and a whale-tail spoiler. Mind the lift-off oversteer.',
    mass: 1215, cgHeight: 0.5, weightFront: 0.38, wheelbase: 2.272, track: [1.459, 1.496],
    body: [-2.238, 2.054, 0.887, 0.09, 1.287, [-0.8, 0.1]], springs: [24000, 38000],
    tyre: { d: 25, label: '205/55 VR16 · 225/50 VR16 P7', radius: 0.3206, width: 0.215, rim: 16, mass: 19, inertia: 1.0, desc: 'Pirelli P7s, 205/55 VR16 in front and 225/50 VR16 behind, on 16-inch Fuchs forged wheels.' },
    drive: 'rwd', box: '930 4', final: 4.222, finals: [4.0, 4.222, 4.429], diffs: 0,
    eye: [0.285, 1.09, -0.29], hoodEye: [0, 0.95, 1.0], cd: 0.39, area: 1.79, aero: [0, 0.08], parts: 1.6,
  }),
  r34: roadCar({
    // the Nissan Skyline GT-R (R34, 1999), right-hand drive: 2,665 mm wheelbase, 4,600 mm long, 1,785 mm wide,
    // 1,560 kg, 55% of it on the front axle; the RB26DETT 2.6 twin-turbo straight-six, a Getrag six-speed, ATTESA E-TS
    // four-wheel drive (the rear driven, the front through a clutch when the rear slips)
    id: 'r34', name: 'Nissan Skyline GT-R (R34)', real: { t100: 4.9, vmax: 260 },
    blurb: 'Nissan Skyline GT-R (R34): Godzilla. The RB26DETT 2.6 twin-turbo straight-six (280 PS on paper, much more in the tuners\' hands), a Getrag six-speed, ATTESA E-TS all-wheel drive. Fast anywhere, in any weather.',
    mass: 1635, cgHeight: 0.5, weightFront: 0.55, wheelbase: 2.665, track: [1.421, 1.421],
    body: [-2.351, 2.258, 0.885, 0.127, 1.343, [-0.9, 0.25]], springs: [44000, 40000],
    tyre: { d: 26, label: '245/40 ZR18', radius: 0.3243, width: 0.245, rim: 18, mass: 23, inertia: 1.25, desc: '245/40 ZR18 Bridgestone Potenzas on the GT-R\'s six-spoke wheels.' },
    drive: 'awd', split: 0.1, centre: [300, 0.45], box: 'Getrag 6', final: 3.545, finals: [3.357, 3.545, 3.9, 4.111],
    eye: [-0.35, 1.1, -0.32], hoodEye: [0, 1.05, 1.3], cd: 0.34, area: 2.0, aero: [0.05, 0.1], parts: 1.8,
  }),
  r35: roadCar({
    // the Nissan GT-R (R35, 2008): 2,780 mm wheelbase, 4,655 mm long, 1,895 mm wide, 1,740 kg, 54% of it on the front
    // axle; the VR38DETT 3.8 twin-turbo V6, the six-speed dual-clutch transaxle, ATTESA E-TS all-wheel drive
    id: 'r35', name: 'Nissan GT-R (R35)', real: { t100: 3.5, vmax: 310 },
    blurb: 'Nissan GT-R (R35): the supercar killer. The hand-built VR38DETT 3.8 twin-turbo V6 with 485 PS, a six-speed dual-clutch transaxle, ATTESA E-TS all-wheel drive. Heavy, and devastatingly quick off the line.',
    mass: 1815, cgHeight: 0.48, weightFront: 0.54, wheelbase: 2.78, track: [1.53, 1.53],
    body: [-2.355, 2.28, 0.938, 0.142, 1.38, [-0.95, 0.15]], springs: [52000, 50000],
    tyre: { d: 28, label: '255/40 ZRF20 · 285/35 ZRF20', radius: 0.3721, width: 0.27, rim: 20, mass: 27, inertia: 1.8, desc: 'Run-flat Dunlop SP Sport Maxx GT600s, 255/40 ZRF20 in front and 285/35 ZRF20 behind.' },
    drive: 'awd', split: 0.1, centre: [400, 0.5], box: 'GR6', final: 3.7, finals: [3.54, 3.7, 3.92],
    eye: [0.41, 1.1, -0.4], hip: -0.26, hoodEye: [0, 1.05, 1.35], cd: 0.27, area: 2.09, aero: [0.08, 0.12], parts: 1.8,
  }),
  rx7: roadCar({
    // the Mazda RX-7 (FD3S, 1992): 2,425 mm wheelbase, 4,295 mm long, 1,760 mm wide, 1,250 kg, half of it on each
    // axle; the 13B-REW twin-rotor Wankel with sequential twin turbos, a five-speed manual, a Torsen limited-slip diff
    id: 'rx7', name: 'Mazda RX-7 (FD)', real: { t100: 5.3, vmax: 250 },
    blurb: 'Mazda RX-7 (FD): the rotary. The 13B-REW twin-rotor Wankel with sequential twin turbos (255 PS) revving to 8,000, a five-speed manual, a Torsen limited-slip diff, perfect balance and 1.25 tons.',
    mass: 1325, cgHeight: 0.46, weightFront: 0.5, wheelbase: 2.425, track: [1.45, 1.45],
    body: [-2.214, 2.051, 0.894, 0.154, 1.26, [-0.85, -0.1]], springs: [34000, 36000],
    tyre: { d: 25, label: '225/50 ZR16', radius: 0.3241, width: 0.225, rim: 17, mass: 21, inertia: 1.1, desc: '225/50 ZR16 Bridgestone Expedias on the RX-7\'s own wheels.' },
    drive: 'rwd', box: 'RX-7 5', final: 4.1, finals: [3.9, 4.1, 4.3, 4.44],
    eye: [0.34, 1.05, -0.38], hoodEye: [0, 0.91, 1.05], cd: 0.34, area: 1.9, aero: [0.02, 0.06], parts: 1.3,
  }),
  senna: roadCar({
    // the McLaren Senna (2018): 2,670 mm wheelbase, 4,744 mm long, 1,958 mm wide, 1,198 kg dry, 42% of it on the front
    // axle; the M840TR 4.0 twin-turbo V8, a seven-speed dual-clutch, rear-wheel drive, and 800 kg of downforce at 250
    // km/h from its active wing and diffuser
    id: 'senna', name: 'McLaren Senna', real: { t100: 2.8, vmax: 340 },
    blurb: 'McLaren Senna: a road-legal track car. The M840TR 4.0 twin-turbo V8 with 800 PS, a seven-speed dual-clutch, rear-wheel drive, 1.2 tons, carbon everything and 800 kg of downforce at 250 km/h. 0-100 km/h in 2.8 s, 340 km/h.',
    mass: 1385, cgHeight: 0.42, weightFront: 0.42, wheelbase: 2.67, track: [1.636, 1.616],
    body: [-2.2, 2.573, 0.98, 0.066, 1.22, [-0.4, 0.25]], springs: [62000, 76000], brakes: [3600, 2600],
    tyre: { d: 27, label: '245/35 R19 · 315/30 R20 Trofeo R', radius: 0.338, width: 0.29, rim: 19, mass: 22, inertia: 1.4, desc: 'Pirelli P Zero Trofeo R semi-slicks, 245/35 R19 in front and 315/30 R20 behind.' },
    drive: 'rwd', box: 'SSG', final: 3.31, finals: [3.1, 3.31, 3.54], tread: 4,
    eye: [0.31, 1.03, 0.07], hip: 0.2, hoodEye: [0, 0.87, 1.18], cd: 0.5, area: 1.95, aero: [1.1, 1.6], parts: 3.0,
  }),
  sti: roadCar({
    // the Subaru Impreza WRX STi (GC8, the 1996 body), right-hand drive: 2,520 mm wheelbase, 4,350 mm long, 1,690 mm
    // wide, 1,270 kg, 58% of it on the front axle (the boxer ahead of it); the EJ20 2.0 turbo flat-four, a five-speed
    // manual, all-wheel drive through a viscous centre diff
    id: 'sti', name: 'Subaru Impreza WRX STi (GC8)', real: { t100: 4.9, vmax: 250 },
    blurb: 'Subaru Impreza WRX STi (GC8), the 1996 car: the rally car for the road. The EJ20 2.0 turbo boxer four with 280 PS and its burble, a five-speed manual, all-wheel drive through a centre diff. At home on gravel and in the wet.',
    mass: 1345, cgHeight: 0.52, weightFront: 0.58, wheelbase: 2.52, track: [1.446, 1.446],
    body: [-2.137, 2.095, 0.846, 0.172, 1.395, [-0.95, 0.1]], springs: [34000, 32000],
    tyre: { d: 24, label: '205/55 R15', radius: 0.3028, width: 0.205, rim: 15, mass: 19, inertia: 0.95, desc: '205/55 R15 performance tyres on gold rally-style wheels.' },
    drive: 'awd', split: 0.4, centre: [300, 0.4], box: 'STi 5', final: 4.444, finals: [3.9, 4.111, 4.444],
    eye: [-0.37, 1.17, -0.3], hoodEye: [0, 1.04, 1.1], cd: 0.4, area: 2.0, aero: [0, 0.04], parts: 1.2,
  }),
  supra: roadCar({
    // the Toyota Supra Turbo (A80, 1994), right-hand drive: 2,550 mm wheelbase, 4,515 mm long, 1,810 mm wide,
    // 1,510 kg, 53% of it on the front axle; the 2JZ-GTE 3.0 twin-turbo straight-six, a Getrag six-speed, a Torsen
    // limited-slip diff
    id: 'supra', name: 'Toyota Supra Turbo (A80)', real: { t100: 4.9, vmax: 285 },
    blurb: 'Toyota Supra Turbo (A80): the 2JZ-GTE 3.0 twin-turbo straight-six with 326 PS (and room for a thousand), a Getrag six-speed, rear-wheel drive and a Torsen limited-slip diff. A legend of the tuning world.',
    mass: 1585, cgHeight: 0.5, weightFront: 0.53, wheelbase: 2.55, track: [1.496, 1.496],
    body: [-2.296, 2.235, 0.906, 0.157, 1.278, [-0.95, 0.1]], springs: [40000, 42000],
    tyre: { d: 25, label: '235/45 ZR17 · 255/40 ZR17', radius: 0.3353, width: 0.245, rim: 17, mass: 22, inertia: 1.2, desc: '235/45 ZR17 in front and 255/40 ZR17 behind on the Supra\'s five-spoke wheels.' },
    drive: 'rwd', box: 'Getrag 6', final: 3.266, finals: [3.133, 3.266, 3.769],
    eye: [-0.31, 1.04, -0.27], hoodEye: [0, 1.0, 1.25], cd: 0.32, area: 1.95, aero: [0.04, 0.1], parts: 1.4,
  }),
};

// ---------------------------------------------------------------- road cars
/**
 * A road car's entry from what makes it itself and what every one shares: independent suspension at both ends (wheel
 * rates `springs`, front and rear, N/m; dampers and travel to match), brakes that can lock its tyres (or its own,
 * `brakes`, N m a wheel), a hand's width under the floor, a road car's parts (Upgrades.ROAD_ONLY and its own tyre
 * size), forged wheels at 36 psi, traction and stability control, and its collision boxes from its body:
 *   body: the model's extent [rear, front, half width at the waist, floor, roof, [the roof's rear, front]] (m)
 *   weightFront: the share of its weight on the front axle; tyre: its factory tyre (size d in inches, and the rest of a
 *   stockTyre); drive: 'rwd' or 'awd' (with split and centre: see physics/Drivetrain.js); box: its gearbox (the short
 *   name in Upgrades.TRANSMISSIONS), tcK and lockup an automatic's; final and finals: its final drive and the others
 */
function roadCar(c) {
  const wb = c.wheelbase, [zR, zF, half, floor, roof, roofZ] = c.body, belt = roof - 0.43, T = c.tyre, r = T.radius;
  const lockMass = c.mass * 9.81 * r;
  const axle = (z, track, rate, brake, front) => ({
    z, track, springTrack: +(track - 0.3).toFixed(3), rate, bump: Math.round(rate * 0.062), rebound: Math.round(rate * 0.124),
    travel: 0.13, sag: 0.065, mass: front ? 55 : 60, steer: front ? 0.58 : 0, brake,
    ...(front ? { swayBar: Math.round(c.mass * 24) } : { handbrake: brake }), ifs: true, armDrop: +(r - 0.13).toFixed(3),
  });
  const zc = (roofZ[0] + roofZ[1]) / 2;
  return {
    id: c.id, name: c.name, road: true, real: c.real, blurb: c.blurb,
    mass: c.mass, cgHeight: c.cgHeight, cgZ: +((c.weightFront - 0.5) * wb).toFixed(3),
    inertiaBox: [+(2 * half - 0.1).toFixed(2), +(0.72 * roof).toFixed(2), +(0.88 * (zF - zR)).toFixed(2)],
    axles: [
      axle(wb / 2, c.track[0], c.springs[0], c.brakes?.[0] ?? Math.round(lockMass * 0.62), true),
      axle(-wb / 2, c.track[1], c.springs[1], c.brakes?.[1] ?? Math.round(lockMass * 0.38), false),
    ],
    trans: { drive: c.drive, ...(c.drive === 'awd' ? { split: c.split, centre: c.centre } : {}), ...(c.tcK ? { tcK: c.tcK, lockup: c.lockup } : {}) },
    stock: { tyre: T.d, axle: c.final, trans: transIndex(c.box), fit: T.d, low: 1, diffs: c.diffs ?? 1, tread: c.tread ?? 3, wheels: 3, psi: 36 },
    axleRatios: c.finals,
    stockTyre: { label: T.label, radius: r, width: T.width, rim: T.rim, mass: T.mass, inertia: T.inertia, desc: T.desc },
    only: { ...ROAD_ONLY, tyre: [T.d] },
    hull: [
      { c: [0, (floor + belt) / 2, (zR + zF) / 2], h: [half, (belt - floor) / 2, (zF - zR) / 2], pts: 'bottom' },   // the body
      { c: [0, floor + 0.035, 0], h: [Math.min(0.55, half - 0.35), 0.035, wb / 2 - 0.3], pts: 'bottom' },         // the floor
      { c: [0, (belt + roof) / 2, zc], h: [half - 0.26, (roof - belt) / 2, (roofZ[1] - roofZ[0]) / 2 + 0.3], pts: 'top' },  // the roof
    ],
    roofY: roof, cabZ: zc, noseZ: zF - 0.02, rackZ: zc,
    // (its air intakes behind the grille or in the flanks, near the road: no snorkel for a road car)
    intakePos: [-0.3, floor + 0.42, zF - 0.3], snorkelPos: [-0.3, floor + 0.42, zF - 0.3],
    winch: { fairlead: [0, floor + 0.17, zF] },                            // (the tow eye in the front bumper)
    eye: c.eye, hip: c.hip, hoodEye: c.hoodEye,
    drag: { cd: c.cd, area: c.area }, aero: c.aero,
    buoyancy: 0.3, shafts: [3500, 4500], tyreK: 1.3, tyreLoad: 5000, parts: c.parts ?? 2, tc: true,
    style: c.id, look: { coils: true },
  };
}
// (the options that depend on the truck, Upgrades.optionsFor, look trucks up here)
Object.assign(TRUCK_BASES, TRUCKS);

export const TRUCK_IDS = Object.keys(TRUCKS);
/** The road cars, and the off-road trucks. */
export const ROAD_IDS = TRUCK_IDS.filter((id) => TRUCKS[id].road);
export const OFFROAD_IDS = TRUCK_IDS.filter((id) => !TRUCKS[id].road);
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
