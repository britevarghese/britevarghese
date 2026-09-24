// Vehicle catalog: original NIGHTSHIFT cars plus licensed real cars — handling parameters, prices,
// tiers, unlock rules (driver level or career mission) and upgrade effects.
import { CALIBRATION } from './RealCarCalibration.js';
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
// NIGHTSHIFT originals: no unlock needed beyond their level/price
CARS.kestrel.unlock = { level: 1 }; CARS.kestrel.tier = 'D';
CARS.hikari.unlock = { level: 1 }; CARS.hikari.tier = 'D';
CARS.brawler.unlock = { level: 5 }; CARS.brawler.tier = 'C';
CARS.stratos.unlock = { level: 16 }; CARS.stratos.tier = 'A';

// ------------------------------------------------------------------ licensed real cars
// Real-world figures (approximate, public data): power kW, kerb mass kg, drivetrain, 0-100 km/h s,
// top speed km/h, dimensions m. Physics params are derived from them (see realParams) and then
// calibrated with tools/dev/physics-metrics.mjs so t100 lands near the real figure.
// src: CC-BY 4.0 source model on Sketchfab (downloaded/converted by tools/import-cars.mjs; attribution is
// shown in the garage and in public/assets/models/cars/CREDITS.md). standIn: original model shown,
// scaled to the real dimensions, until the real model has been imported.
// Car names and badges are trademarks of their manufacturers; this is a non-commercial fan project.
const REAL = [
  { id: 'bmw_m3_e30', brand: 'BMW', model: 'M3 (E30)', year: 1986, tier: 'D', carType: 'tuner', unlock: { level: 2 }, price: 24000,
    spec: { trans: 'manual', kw: 147, kg: 1200, drive: 'RWD', t100: 6.7, vmax: 235, len: 4.345, wid: 1.68, hgt: 1.37, wb: 2.565, track: 1.42, wr: 0.31, fw: 0.51, redline: 7250, gears: [3.72, 2.40, 1.77, 1.26, 1.00], fd: 3.25, grip: 1.12, era: 1986 },
    blurb: 'The touring-car legend. Light, nimble, and it rewards a smooth right foot.',
    src: { uid: 'ac3c7013434e403e8faff87948caf422', title: '[FREE] BMW M3 E30', author: 'TinoD2' }, standIn: 'kestrel' },
  { id: 'subaru_wrx_sti_gc8', brand: 'Subaru', model: 'Impreza WRX STi (GC8)', year: 1999, tier: 'D', carType: 'tuner', unlock: { level: 3 }, price: 29000,
    spec: { trans: 'manual', kw: 206, kg: 1260, drive: 'AWD', t100: 5.0, vmax: 240, len: 4.35, wid: 1.69, hgt: 1.405, wb: 2.52, track: 1.46, wr: 0.31, fw: 0.6, redline: 8000, gears: [3.08, 2.05, 1.47, 1.09, 0.86], fd: 3.9, grip: 1.18, era: 1999 },
    blurb: 'Turbo boxer, symmetrical AWD, rally DNA. Launches like nothing else in its class.',
    src: { uid: '457f01e7e8d14b088e3f092c1be9e75c', title: 'Subaru Impreza WRX STi Version VI (GC8)', author: 'Car2022' }, standIn: 'hikari' },
  { id: 'mazda_rx7_fd', brand: 'Mazda', model: 'RX-7 (FD)', year: 1992, tier: 'D', carType: 'tuner', unlock: { level: 4 }, price: 33000,
    spec: { trans: 'manual', kw: 188, kg: 1260, drive: 'RWD', t100: 5.3, vmax: 250, len: 4.285, wid: 1.76, hgt: 1.23, wb: 2.425, track: 1.46, wr: 0.32, fw: 0.5, redline: 8000, gears: [3.48, 2.02, 1.39, 1.00, 0.72], fd: 4.1, grip: 1.18, era: 1992 },
    blurb: 'Twin-rotor twin-turbo. Perfect balance, screaming redline, born to drift.',
    src: { uid: 'd35ff630df614771b82e7b2f59035b1e', title: 'Mazda RX-7 FD', author: 'Lexyc16' }, standIn: 'hikari', driftAssist: 1.1 },
  { id: 'porsche_930_turbo', brand: 'Porsche', model: '911 Turbo (930)', year: 1975, tier: 'C', carType: 'sports', unlock: { mission: 'widowmaker' }, price: 45000,
    spec: { trans: 'manual', kw: 191, kg: 1140, drive: 'RWD', t100: 5.5, vmax: 250, len: 4.29, wid: 1.775, hgt: 1.32, wb: 2.27, track: 1.43, wr: 0.32, fw: 0.39, redline: 6800, gears: [2.25, 1.30, 0.89, 0.63], fd: 4.22, grip: 1.12, era: 1975 },
    blurb: 'The original Widowmaker. Rear engine, big turbo lag, lift off mid-corner at your peril.',
    src: { uid: '8568d9d14a994b9cae59499f0dbed21e', title: 'FREE 1975 Porsche 911 (930) Turbo', author: 'lionsharp' }, standIn: 'kestrel', powerOversteer: 1.3 },
  { id: 'nissan_skyline_r34', brand: 'Nissan', model: 'Skyline GT-R (R34)', year: 1999, tier: 'C', carType: 'tuner', unlock: { level: 6 }, price: 48000,
    spec: { trans: 'manual', kw: 243, kg: 1560, drive: 'AWD', t100: 4.9, vmax: 250, len: 4.6, wid: 1.785, hgt: 1.36, wb: 2.665, track: 1.48, wr: 0.33, fw: 0.57, redline: 8000, gears: [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], fd: 3.55, grip: 1.22, era: 1999 },
    blurb: 'Godzilla, second generation. ATTESA AWD and an RB26 that loves boost.',
    src: { uid: 'ff8fb2251dfa4bb9979e7022c5a6666c', title: 'Nissan Skyline R34 GT-R', author: 'Lexyc16' }, standIn: 'kestrel' },
  { id: 'toyota_supra_mk4', brand: 'Toyota', model: 'Supra Turbo (A80)', year: 1994, tier: 'C', carType: 'tuner', unlock: { level: 7 }, price: 52000,
    spec: { trans: 'manual', kw: 240, kg: 1570, drive: 'RWD', t100: 4.9, vmax: 285, len: 4.515, wid: 1.81, hgt: 1.275, wb: 2.55, track: 1.52, wr: 0.33, fw: 0.53, redline: 6800, gears: [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], fd: 3.27, grip: 1.2, era: 1994 },
    blurb: 'Iron-block 2JZ inline-six. Long legs, huge top end, tuner royalty.',
    src: { uid: 'eb9bb1eb41db431cb078088ae1ce45f8', title: 'Toyota Supra MK IV (1994)', author: 'TinoD2' }, standIn: 'kestrel', powerOversteer: 1.1 },
  { id: 'honda_nsx_na1', brand: 'Honda', model: 'NSX (NA1)', year: 1990, tier: 'C', carType: 'sports', unlock: { level: 9 }, price: 58000,
    spec: { trans: 'manual', kw: 201, kg: 1370, drive: 'RWD', t100: 5.7, vmax: 270, len: 4.405, wid: 1.81, hgt: 1.17, wb: 2.53, track: 1.51, wr: 0.32, fw: 0.42, redline: 8000, gears: [3.07, 1.77, 1.23, 0.97, 0.77], fd: 4.06, grip: 1.22, era: 1990 },
    blurb: 'Mid-engine precision tuned by a champion. Telepathic steering, VTEC howl.',
    src: { uid: '1cc15628a00a4739a6b6c01128927c8d', title: 'Honda NSX 1990', author: 'Lexyc16' }, standIn: 'stratos' },
  { id: 'bmw_m4_f82', brand: 'BMW', model: 'M4 Coupé (F82)', year: 2014, tier: 'B', carType: 'sports', unlock: { level: 11 }, price: 78000,
    spec: { trans: 'dct', kw: 317, kg: 1570, drive: 'RWD', t100: 4.1, vmax: 280, len: 4.671, wid: 1.87, hgt: 1.383, wb: 2.812, track: 1.6, wr: 0.34, fw: 0.52, redline: 7600, gears: [4.81, 2.59, 1.70, 1.28, 1.00, 0.84, 0.67], fd: 3.46, grip: 1.25, era: 2014 },
    blurb: 'Twin-turbo straight-six with a wicked sense of humour. Torque on tap everywhere.',
    src: { uid: '25d00f20b8cf4828bd934acb31e0aae4', title: 'BMW M4 F82 Razor 2014', author: 'heynic (www.vecarz.com)' }, standIn: 'kestrel', powerOversteer: 1.15 },
  { id: 'nissan_gtr_r35', brand: 'Nissan', model: 'GT-R (R35)', year: 2017, tier: 'B', carType: 'sports', unlock: { level: 13 }, price: 98000,
    spec: { trans: 'dct', kw: 419, kg: 1750, drive: 'AWD', t100: 2.9, vmax: 315, len: 4.71, wid: 1.895, hgt: 1.37, wb: 2.78, track: 1.6, wr: 0.35, fw: 0.54, redline: 7100, gears: [4.06, 2.30, 1.59, 1.25, 1.00, 0.80], fd: 3.7, grip: 1.32, era: 2017 },
    blurb: 'Hand-built V6, launch control, AWD brutality. Physics-defying pace for its weight.',
    src: { uid: '7b142ea3376e4811a326256c59bbc7a2', title: 'Nissan Skyline GTR r35', author: 'BlackSnow02' }, standIn: 'kestrel' },
  { id: 'chevrolet_corvette_c8', brand: 'Chevrolet', model: 'Corvette Stingray (C8)', year: 2020, tier: 'B', carType: 'muscle', unlock: { level: 14 }, price: 105000,
    spec: { trans: 'dct', kw: 369, kg: 1530, drive: 'RWD', t100: 3.0, vmax: 312, len: 4.63, wid: 1.93, hgt: 1.235, wb: 2.72, track: 1.64, wr: 0.35, fw: 0.4, redline: 6500, gears: [2.91, 1.76, 1.22, 0.97, 0.81, 0.64, 0.49], fd: 5.17, grip: 1.33, era: 2020 },
    blurb: 'America went mid-engine. Small-block V8 thunder with supercar balance.',
    src: { uid: '790c40ccff6843eab0b7b4bd18421ff8', title: '2019 Chevrolet Corvette C8 Stingray', author: 'Haris3D' }, standIn: 'stratos' },
  { id: 'porsche_911_gt3', brand: 'Porsche', model: '911 GT3', year: 2018, tier: 'B', carType: 'exotic', unlock: { mission: 'track_weapon' }, price: 125000,
    spec: { trans: 'dct', kw: 368, kg: 1430, drive: 'RWD', t100: 3.4, vmax: 318, len: 4.56, wid: 1.85, hgt: 1.27, wb: 2.46, track: 1.56, wr: 0.34, fw: 0.39, redline: 9000, gears: [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], fd: 3.97, grip: 1.38, era: 2018 },
    blurb: '9,000 rpm flat-six, rear-wheel steer, zero compromise. A race car with plates.',
    src: { uid: '78d5c47ab2554c2592b7e499179a0792', title: 'Porsche 911 GT3', author: 'ChevroletSS' }, standIn: 'kestrel' },
  { id: 'audi_r8_v10', brand: 'Audi', model: 'R8 V10 performance quattro', year: 2021, tier: 'A', carType: 'exotic', unlock: { level: 18 }, price: 175000,
    spec: { trans: 'dct', kw: 456, kg: 1595, drive: 'AWD', t100: 3.1, vmax: 331, len: 4.43, wid: 1.94, hgt: 1.24, wb: 2.65, track: 1.64, wr: 0.35, fw: 0.42, redline: 8700, gears: [3.13, 2.59, 1.96, 1.54, 1.21, 0.97, 0.75], fd: 4.0, grip: 1.36, era: 2021 },
    blurb: 'Naturally aspirated V10 and quattro grip. Everyday supercar, nightly weapon.',
    src: { uid: '8dd1c237238244d1a2a49d764d321b87', title: '2021 Audi R8 V10 Performance Quattro (Type 4S)', author: 'supercarmodels' }, standIn: 'stratos' },
  { id: 'ferrari_f40', brand: 'Ferrari', model: 'F40', year: 1987, tier: 'A', carType: 'exotic', unlock: { mission: 'legend_of_the_night' }, price: 260000,
    spec: { trans: 'manual', kw: 352, kg: 1100, drive: 'RWD', t100: 4.1, vmax: 324, len: 4.36, wid: 1.97, hgt: 1.12, wb: 2.45, track: 1.6, wr: 0.34, fw: 0.42, redline: 7750, gears: [2.77, 1.94, 1.45, 1.13, 0.84], fd: 3.54, grip: 1.26, era: 1987 },
    blurb: 'Twin turbos, no driver aids, no mercy. The last car signed off by the founder.',
    src: { uid: '52a66c41cfcd4f999fb1b1c49bf24d70', title: 'Ferrari f40', author: 'BlackSnow02' }, standIn: 'stratos', powerOversteer: 1.25 },
  { id: 'mclaren_senna', brand: 'McLaren', model: 'Senna', year: 2018, tier: 'A', carType: 'exotic', unlock: { level: 22 }, price: 320000,
    spec: { trans: 'dct', kw: 588, kg: 1300, drive: 'RWD', t100: 2.8, vmax: 340, len: 4.744, wid: 1.958, hgt: 1.229, wb: 2.67, track: 1.66, wr: 0.35, fw: 0.42, redline: 8250, gears: [3.98, 2.61, 1.91, 1.48, 1.18, 0.95, 0.77], fd: 3.31, grip: 1.45, era: 2018, downforce: 3.2 },
    blurb: 'Downforce first, comfort never. The most extreme road car McLaren ever built.',
    src: { uid: 'ea3e43a6eb004853a87fe9c58422eb96', title: 'McLaren Senna Free', author: 'BlackSnow02' }, standIn: 'stratos' },
  { id: 'lamborghini_centenario', brand: 'Lamborghini', model: 'Centenario LP 770-4', year: 2016, tier: 'S', carType: 'exotic', unlock: { level: 26 }, price: 450000,
    spec: { trans: 'isr', kw: 566, kg: 1520, drive: 'AWD', t100: 2.8, vmax: 350, len: 4.924, wid: 2.062, hgt: 1.143, wb: 2.7, track: 1.72, wr: 0.36, fw: 0.43, redline: 8500, gears: [3.91, 2.44, 1.81, 1.46, 1.19, 0.97, 0.84], fd: 2.87, grip: 1.4, era: 2016, downforce: 2.6 },
    blurb: 'A centenary tribute with a 770 PS V12. Forty were made. You have one.',
    src: { uid: 'd679af35b5694301a185c7454a700c73', title: 'Lamborghini Centenario LP-770 Interior SDC', author: 'Lambo_SC04' }, standIn: 'stratos' },
  { id: 'lamborghini_huracan_tt', brand: 'Lamborghini', model: 'Huracán Twin Turbo', year: 2019, tier: 'S', carType: 'exotic', unlock: { mission: 'apex_predator' }, price: 0,
    spec: { trans: 'dct', kw: 735, kg: 1480, drive: 'AWD', t100: 2.5, vmax: 360, len: 4.459, wid: 1.924, hgt: 1.165, wb: 2.62, track: 1.67, wr: 0.36, fw: 0.43, redline: 8500, gears: [3.13, 2.59, 1.96, 1.54, 1.21, 1.00, 0.77], fd: 3.8, grip: 1.4, era: 2019, downforce: 2.4 },
    blurb: 'Twin-turbo V10 built for the street-racing scene. The final prize of the night.',
    src: { uid: '1d3809ea5a6749d9864ec4c32511d716', title: 'Lamborghini Huracan Twin Turbo [LOST]', author: 'BlackSnow02' }, standIn: 'stratos' },
];

// gearbox behaviour: shift duration and how much drive survives the shift
const SHIFT = { manual: { shiftTime: 0.3, shiftFill: 0.12 }, dct: { shiftTime: 0.08, shiftFill: 0.75 }, isr: { shiftTime: 0.15, shiftFill: 0.4 } };
// Real-world spec -> physics params (kW power, mass, drivetrain, geometry). Grip and brakes scale with
// the tyre/brake technology of the car's era.
export function realParams(r) {
  const s = r.spec;
  const modern = Math.min(1, Math.max(0, (s.era - 1975) / 45));
  return {
    mass: s.kg, enginePower: s.kw, maxSpeed: s.vmax / 3.6,
    grip: s.grip, driftGrip: 0.34 + s.grip * 0.06, steeringAngle: 0.56 - (s.wb - 2.5) * 0.08,
    brakingForce: s.kg * (10.5 + modern * 3.5),
    wheelBase: s.wb, trackWidth: s.track, cgHeight: 0.38 + s.hgt * 0.07, frontWeight: s.fw,
    drive: s.drive, gears: s.gears, finalDrive: s.fd, redline: s.redline,
    downforce: s.downforce ?? (0.9 + modern * 1.1), suspensionStrength: 1.9 + modern * 0.6, suspensionDamping: 0.45 + modern * 0.1,
    length: s.len, width: s.wid, wheelRadius: s.wr,
    ...SHIFT[s.trans || 'manual'],
    ...(r.powerOversteer ? { powerOversteer: r.powerOversteer } : {}),
    ...(r.driftAssist ? { driftAssist: r.driftAssist } : {}),
  };
}
// signature factory colours (used by stand-in models; imported models keep their own paint)
const FACTORY = {
  bmw_m3_e30: '#e9e9e4', subaru_wrx_sti_gc8: '#1f3a93', mazda_rx7_fd: '#b3121f', porsche_930_turbo: '#c8102e', nissan_skyline_r34: '#1f4fbf',
  toyota_supra_mk4: '#e2621b', honda_nsx_na1: '#c01818', bmw_m4_f82: '#d8a800', nissan_gtr_r35: '#e9eaea', chevrolet_corvette_c8: '#c3141c',
  porsche_911_gt3: '#b7b9bb', audi_r8_v10: '#5f6468', ferrari_f40: '#d40000', mclaren_senna: '#ff7a00', lamborghini_centenario: '#1c1c1e', lamborghini_huracan_tt: '#6bd03a',
};
for (const r of REAL) {
  const params = realParams(r);
  const cal = CALIBRATION[r.id];
  if (cal) { params.enginePower *= cal.power; params.launchG = cal.launchG; params.maxSpeed *= cal.vmax; }
  CARS[r.id] = {
    id: r.id, name: `${r.brand} ${r.model}`, brand: r.brand, model: r.model, year: r.year, class: `${r.tier}-CLASS`, tier: r.tier,
    price: r.price, carType: r.carType, blurb: r.blurb, unlock: r.unlock, real: true, spec: r.spec, standIn: r.standIn, factoryColor: FACTORY[r.id],
    source: { site: 'Sketchfab', uid: r.src.uid, title: r.src.title, author: r.src.author, url: `https://sketchfab.com/3d-models/${r.src.uid}`, license: 'CC-BY-4.0' },
    params,
  };
}
for (const [id, c] of Object.entries(CARS)) { c.tier ||= 'D'; c.brand ||= 'NIGHTSHIFT'; c.model ||= c.name; }

export const TIERS = ['D', 'C', 'B', 'A', 'S'];
export const TIER_NAMES = { D: 'D · STREET', C: 'C · SPORT', B: 'B · PERFORMANCE', A: 'A · SUPERCAR', S: 'S · HYPERCAR' };
const unlockKey = (c) => c.unlock?.level ?? 0;
// garage order: by tier, then unlock level, then price
export const PLAYER_CAR_ORDER = Object.values(CARS).sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || unlockKey(a) - unlockKey(b) || a.price - b.price).map((c) => c.id);
export const REAL_CAR_IDS = REAL.map((r) => r.id);

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
