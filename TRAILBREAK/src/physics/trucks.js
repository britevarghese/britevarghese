// The trucks: original designs modelled on the classic 1970s American four-wheel drives, with their real wheelbases,
// tracks, weights, engines and gearing. Body-on-frame, a solid (beam) axle at each end on leaf or coil springs, a big
// slow engine, a manual or automatic gearbox and a two-speed part-time transfer case.
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

import { buildSpec, decodeBuild, normalizeBuild, encodeBuild } from './Upgrades.js';

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
    style: 'hauler',
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
    style: 'mule',
  },
};

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
