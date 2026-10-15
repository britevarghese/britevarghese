// The trucks. Original designs in the spirit of 1960s-70s four-wheel drives: body-on-frame, beam axles on leaf or
// coil springs front and rear, a big slow engine, a 3- or 4-speed automatic and a two-speed transfer case.
//
// Geometry is in the design frame: origin on the ground under the middle of the wheelbase, +y up, +z forward,
// +x to the driver's left. The physics moves it into the frame of the centre of gravity.

import { DEFAULT_TYRE } from './Tire.js';

const V8 = {
  name: 'V8 5.0',
  idleRpm: 700, redline: 4400, limiter: 4650,
  torque: [[400, 130], [800, 230], [1200, 280], [1800, 302], [2400, 318], [3000, 310], [3600, 290], [4200, 262], [4700, 200], [5200, 130]],
  inertia: 0.32, friction: [17, 0.024],
};
const V8_BIG = {
  name: 'V8 5.9',
  idleRpm: 650, redline: 4200, limiter: 4400,
  torque: [[400, 160], [800, 285], [1200, 350], [1800, 395], [2400, 410], [3000, 396], [3600, 365], [4200, 310], [4600, 240], [5000, 150]],
  inertia: 0.38, friction: [20, 0.027],
};
const I6 = {
  name: 'I6 4.0',
  idleRpm: 650, redline: 4300, limiter: 4500,
  torque: [[400, 120], [800, 205], [1200, 240], [1800, 262], [2400, 268], [3000, 258], [3600, 238], [4200, 205], [4600, 160], [5000, 110]],
  inertia: 0.26, friction: [14, 0.021],
};

export const TRUCKS = {
  ranger: {
    id: 'ranger', name: 'Ranger', blurb: 'Short-wheelbase two-door. Nimble, tips over sooner.',
    engineSound: 'v8_muscle', soundPitch: 1.0,
    mass: 1820, cgHeight: 0.86, cgZ: 0.08, inertiaBox: [1.8, 1.5, 4.0],
    tyre: { ...DEFAULT_TYRE, radius: 0.395, width: 0.265, mass: 30, inertia: 2.2 },
    axles: [
      { z: 1.18, track: 1.48, springTrack: 0.98, rate: 46000, bump: 2300, rebound: 4700, travel: 0.27, sag: 0.1, mass: 125, steer: 0.62, brake: 2600, swayBar: 30000 },
      { z: -1.18, track: 1.48, springTrack: 1.06, rate: 40000, bump: 2200, rebound: 4500, travel: 0.29, sag: 0.11, mass: 115, steer: 0, brake: 1600, handbrake: 2600 },
    ],
    engine: V8,
    trans: { gears: [2.48, 1.48, 1.0], reverse: 2.08, high: 1.0, low: 2.72, axle: 4.1, tcK: 10.2 },
    hull: [
      { c: [0, 0.96, 0.08], h: [0.86, 0.38, 1.98] },       // frame, body tub, bumpers
      { c: [0, 1.63, -0.3], h: [0.78, 0.3, 1.2] },         // cab and top
    ],
    winch: { fairlead: [0, 0.66, 2.12], maxLen: 32, stiffness: 140000, damping: 9000, lineSpeed: 0.55, stallPull: 44000, breakLoad: 90000 },
    drag: { cd: 0.56, area: 2.75 },
    buoyancy: 0.32,
    style: 'ranger',
  },
  hauler: {
    id: 'hauler', name: 'Hauler', blurb: 'Full-size pickup. Long, heavy, big torque.',
    engineSound: 'v8_muscle', soundPitch: 0.86,
    mass: 2280, cgHeight: 0.9, cgZ: 0.28, inertiaBox: [1.95, 1.5, 5.3],
    tyre: { ...DEFAULT_TYRE, radius: 0.42, width: 0.285, mass: 36, inertia: 2.9, stiffness: 250000 },
    axles: [
      { z: 1.6, track: 1.64, springTrack: 1.06, rate: 62000, bump: 2800, rebound: 5600, travel: 0.25, sag: 0.1, mass: 150, steer: 0.58, brake: 3300, swayBar: 38000 },
      { z: -1.6, track: 1.64, springTrack: 1.16, rate: 52000, bump: 2600, rebound: 5200, travel: 0.28, sag: 0.1, mass: 140, steer: 0, brake: 2100, handbrake: 3200 },
    ],
    engine: V8_BIG,
    trans: { gears: [2.48, 1.48, 1.0, 0.75], reverse: 2.08, high: 1.0, low: 2.72, axle: 4.1, tcK: 9.4 },
    hull: [
      { c: [0, 0.98, 0.15], h: [0.93, 0.4, 2.62] },
      { c: [0, 1.66, 0.25], h: [0.84, 0.3, 0.72] },
    ],
    winch: { fairlead: [0, 0.7, 2.78], maxLen: 32, stiffness: 150000, damping: 10000, lineSpeed: 0.5, stallPull: 52000, breakLoad: 100000 },
    drag: { cd: 0.6, area: 3.0 },
    buoyancy: 0.3,
    style: 'hauler',
  },
  mule: {
    id: 'mule', name: 'Mule', blurb: 'Small, light utility truck. Narrow enough for the tight trails.',
    engineSound: 'i6_bmw', soundPitch: 0.78,
    mass: 1360, cgHeight: 0.8, cgZ: 0.1, inertiaBox: [1.62, 1.45, 3.5],
    tyre: { ...DEFAULT_TYRE, radius: 0.375, width: 0.235, mass: 26, inertia: 1.8, stiffness: 200000 },
    axles: [
      { z: 1.06, track: 1.36, springTrack: 0.86, rate: 33000, bump: 1800, rebound: 3700, travel: 0.25, sag: 0.09, mass: 95, steer: 0.64, brake: 2000, swayBar: 20000 },
      { z: -1.06, track: 1.36, springTrack: 0.9, rate: 30000, bump: 1700, rebound: 3500, travel: 0.27, sag: 0.1, mass: 90, steer: 0, brake: 1300, handbrake: 2000 },
    ],
    engine: I6,
    trans: { gears: [2.74, 1.55, 1.0], reverse: 2.2, high: 1.0, low: 2.46, axle: 4.27, tcK: 11.5 },
    hull: [
      { c: [0, 0.9, 0.12], h: [0.78, 0.35, 1.72] },
      { c: [0, 1.55, -0.35], h: [0.72, 0.3, 0.95] },
    ],
    winch: { fairlead: [0, 0.62, 1.86], maxLen: 30, stiffness: 120000, damping: 8000, lineSpeed: 0.55, stallPull: 38000, breakLoad: 80000 },
    drag: { cd: 0.58, area: 2.5 },
    buoyancy: 0.33,
    style: 'mule',
  },
};

export const TRUCK_IDS = Object.keys(TRUCKS);
export const truckSpec = (id) => TRUCKS[id] || TRUCKS.ranger;
