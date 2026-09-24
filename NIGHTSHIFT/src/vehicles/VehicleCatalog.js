// Vehicle catalog: original cars, handling parameters, prices and upgrade effects.
export const CARS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel RS', class: 'SPORTS', price: 0, carType: 'sports',
    blurb: 'Balanced front-engine coupe. High grip, eager turn-in.',
    params: { mass: 1420, enginePower: 290, maxSpeed: 77, grip: 1.26, driftGrip: 0.42, steeringAngle: 0.58, brakingForce: 17000, wheelBase: 2.62, trackWidth: 1.6, cgHeight: 0.46, frontWeight: 0.52, drive: 'RWD', gears: [3.3, 2.25, 1.68, 1.32, 1.06, 0.87], finalDrive: 3.7, redline: 7800, downforce: 1.5, suspensionStrength: 2.2, suspensionDamping: 0.5, length: 4.45, width: 1.9, wheelRadius: 0.34 },
  },
  hikari: {
    id: 'hikari', name: 'Hikari R4', class: 'TUNER', price: 18000, carType: 'tuner',
    blurb: 'Light turbo four. Loves to drift, responds best to upgrades.',
    params: { mass: 1240, enginePower: 245, maxSpeed: 73, grip: 1.24, driftGrip: 0.4, steeringAngle: 0.56, brakingForce: 15500, wheelBase: 2.53, trackWidth: 1.52, cgHeight: 0.47, frontWeight: 0.55, drive: 'RWD', gears: [3.5, 2.4, 1.8, 1.4, 1.12, 0.92], finalDrive: 4.1, redline: 8400, downforce: 1.3, suspensionStrength: 2.3, suspensionDamping: 0.5, length: 4.3, width: 1.8, wheelRadius: 0.33, driftAssist: 1.15 },
    upgradeBonus: 1.35,
  },
  brawler: {
    id: 'brawler', name: 'Brawler 71', class: 'MUSCLE', price: 32000, carType: 'muscle',
    blurb: 'Big V8 torque, lazy cornering. Power-slides on demand.',
    params: { mass: 1680, enginePower: 420, maxSpeed: 79, grip: 1.16, driftGrip: 0.36, steeringAngle: 0.52, brakingForce: 16000, wheelBase: 2.8, trackWidth: 1.62, cgHeight: 0.52, frontWeight: 0.56, drive: 'RWD', gears: [2.9, 1.95, 1.45, 1.12, 0.9], finalDrive: 3.4, redline: 6600, downforce: 1.0, suspensionStrength: 1.8, suspensionDamping: 0.42, length: 4.8, width: 1.96, wheelRadius: 0.36, powerOversteer: 1.35 },
  },
  stratos: {
    id: 'stratos', name: 'Stratos V12', class: 'EXOTIC', price: 95000, carType: 'exotic',
    blurb: 'Mid-engine all-wheel-drive missile. Precise and brutally fast.',
    params: { mass: 1500, enginePower: 450, maxSpeed: 90, grip: 1.4, driftGrip: 0.46, steeringAngle: 0.55, brakingForce: 21000, wheelBase: 2.73, trackWidth: 1.7, cgHeight: 0.42, frontWeight: 0.44, drive: 'AWD', gears: [3.1, 2.2, 1.7, 1.36, 1.12, 0.95, 0.8], finalDrive: 3.6, redline: 8800, downforce: 2.2, suspensionStrength: 2.5, suspensionDamping: 0.55, length: 4.6, width: 2.02, wheelRadius: 0.35 },
  },
};
export const PLAYER_CAR_ORDER = ['kestrel', 'hikari', 'brawler', 'stratos'];

export const POLICE_CAR = {
  id: 'interceptor', name: 'Interceptor', carType: 'muscle',
  params: { mass: 1750, enginePower: 320, maxSpeed: 72, grip: 1.22, driftGrip: 0.5, steeringAngle: 0.56, brakingForce: 19000, wheelBase: 2.9, trackWidth: 1.62, cgHeight: 0.5, frontWeight: 0.54, drive: 'RWD', gears: [3.0, 2.1, 1.55, 1.2, 0.98, 0.82], finalDrive: 3.6, redline: 6800, downforce: 1.3, suspensionStrength: 2.1, suspensionDamping: 0.5, length: 4.95, width: 1.92, wheelRadius: 0.35 },
};

export const UPGRADE_KEYS = ['engine', 'transmission', 'tires', 'brakes', 'suspension', 'nitrous'];
export const UPGRADE_NAMES = { engine: 'Engine', transmission: 'Transmission', tires: 'Tires', brakes: 'Brakes', suspension: 'Suspension', nitrous: 'Nitrous' };
export const UPGRADE_LEVELS = ['Stock', 'Street', 'Sport', 'Race'];
export const UPGRADE_COST = [0, 2500, 6500, 14000];
export const PAINT_COST = 400, PART_COST = 900, WHEEL_COST = 1200, VINYL_COST = 700;

// Apply upgrades to base params
export function tunedParams(carId, upgrades = {}) {
  const car = CARS[carId];
  const p = { ...car.params };
  const k = car.upgradeBonus || 1;
  const u = (key) => (upgrades[key] || 0) * k;
  p.enginePower *= 1 + 0.08 * u('engine');
  p.maxSpeed *= 1 + 0.025 * u('engine') + 0.015 * u('transmission');
  p.acceleration = 1 + 0.045 * u('transmission');
  p.grip *= 1 + 0.04 * u('tires');
  p.driftGrip *= 1 + 0.02 * u('tires');
  p.brakingForce *= 1 + 0.12 * u('brakes');
  p.suspensionStrength *= 1 + 0.08 * u('suspension');
  p.grip *= 1 + 0.015 * u('suspension');
  p.cgHeight *= 1 - 0.04 * u('suspension');
  p.nitroCapacity = 5 + 1.2 * u('nitrous');
  p.nitroPower = 0.6 + 0.08 * u('nitrous');
  return p;
}

// Performance ratings (0..10) for the garage UI
export function ratings(p) {
  return {
    speed: Math.min(10, (p.maxSpeed - 60) / 3.2),
    accel: Math.min(10, (p.enginePower * (p.acceleration || 1) / p.mass) * 26 - 1),
    handling: Math.min(10, (p.grip - 0.9) * 16 + p.steeringAngle * 3),
    braking: Math.min(10, p.brakingForce / p.mass * 0.75 - 1),
  };
}

export const PAINTS = ['#b3121f', '#e8e8ea', '#101012', '#1f4fd6', '#f2c200', '#ff6a00', '#1f9d55', '#6b2bd9', '#00b8d9', '#8a8f98', '#ff2d95', '#5c3a1e', '#d9d2b0', '#2a3b2c'];
export const RIM_NAMES = ['Twin-Five', 'Ten Spoke', 'Cross Mesh', 'Turbine'];
export const FINISHES = ['metallic', 'gloss', 'matte', 'pearl'];
export const SPOILER_NAMES = ['None', 'Ducktail', 'Street Wing', 'GT Wing'];
export const HOOD_NAMES = ['Stock', 'Power Bulge', 'Heat Vents', 'Carbon'];
export const BUMPER_NAMES = ['Stock', 'Aero Kit'];
