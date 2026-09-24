// Objective driving-feel metrics for every player car (and police), no browser needed.
//   node tools/dev/physics-metrics.mjs [--json out.json]
// Flat, obstacle-free world so results isolate the vehicle model.
import fs from 'node:fs';
import { VehiclePhysics } from '../../src/physics/VehiclePhysics.js';
import { tunedParams, POLICE_CAR, PLAYER_CAR_ORDER } from '../../src/vehicles/VehicleCatalog.js';

const flat = { layout: { groundHeight: () => 0 }, collision: { query: () => [] } };
const DT = 1 / 120;
const C = (o) => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false, ...o });
const kmh = (v) => v * 3.6;

function car(params, speedKmh = 0) {
  const v = new VehiclePhysics(params, flat);
  v.place(0, 0, 0);
  v.s.vz = speedKmh / 3.6;
  v.step(DT, C({ throttle: 0.3 })); // settle state
  return v;
}
// hold speed with a simple cruise controller while steering
function cruise(v, target) { const e = target / 3.6 - v.s.speed; return e > 0 ? { throttle: Math.min(1, e * 0.8), brake: 0 } : { throttle: 0, brake: Math.min(1, -e * 0.3) }; }

function metrics(params) {
  const m = {};
  // straight line
  let v = car(params), t = 0;
  for (; t < 60; t += DT) { v.step(DT, C({ throttle: 1 })); const s = kmh(v.s.speed); if (!m.t100 && s >= 100) m.t100 = +t.toFixed(2); if (!m.t200 && s >= 200) m.t200 = +t.toFixed(1); }
  m.topSpeed = Math.round(kmh(v.s.speed));
  v = car(params, 100); let z0 = v.s.z; for (t = 0; t < 10 && v.s.speed > 0.2; t += DT) v.step(DT, C({ brake: 1 })); m.brake100m = +(v.s.z - z0).toFixed(1);
  // step steer response at 60 and 120 km/h (steer 0.5 right)
  for (const sp of [60, 120]) {
    v = car(params, sp);
    let peak = 0, t90 = null, yawR = [];
    for (t = 0; t < 4; t += DT) { v.step(DT, C({ ...cruise(v, sp), steer: 0.5 })); yawR.push(Math.abs(v.s.yawRate)); peak = Math.max(peak, Math.abs(v.s.yawRate)); }
    const steady = yawR.slice(-60).reduce((a, b) => a + b, 0) / 60;
    t90 = yawR.findIndex((r) => r >= steady * 0.9) * DT;
    m[`step${sp}`] = { response90: +t90.toFixed(2), overshootPct: Math.round((peak / steady - 1) * 100), latG: +(steady * v.s.speed / 9.81).toFixed(2), slip: +v.s.slip.toFixed(2), speedKept: Math.round(kmh(v.s.speed)) };
  }
  // turning circle at 25 km/h full lock
  v = car(params, 25); for (t = 0; t < 4; t += DT) v.step(DT, C({ ...cruise(v, 25), steer: 1 }));
  m.turnRadius = +(v.s.speed / Math.max(1e-3, Math.abs(v.s.yawRate))).toFixed(1);
  // slalom stability at 100 km/h
  v = car(params, 100); let maxSlip = 0;
  for (t = 0; t < 6; t += DT) { v.step(DT, C({ ...cruise(v, 100), steer: 0.6 * Math.sin(t * Math.PI * 2 * 0.5) })); maxSlip = Math.max(maxSlip, v.s.slip); }
  m.slalomMaxSlip = +maxSlip.toFixed(2);
  // lift-off mid corner at 120
  v = car(params, 120); maxSlip = 0;
  for (t = 0; t < 4; t += DT) { v.step(DT, C({ throttle: t < 1.5 ? 0.6 : 0, steer: 0.6 })); maxSlip = Math.max(maxSlip, v.s.slip); }
  m.liftOffMaxSlip = +maxSlip.toFixed(2);
  // handbrake drift at 100 km/h: 0.4 s handbrake + full steer, then throttle + hold 0.6 steer
  v = car(params, 100); let slips = [], sp0 = v.s.speed;
  for (t = 0; t < 4; t += DT) { v.step(DT, C({ throttle: t > 0.4 ? 1 : 0, handbrake: t < 0.4 ? 1 : 0, steer: t < 0.8 ? 1 : 0.6 })); slips.push(v.s.slip); }
  m.drift = { peakSlip: +Math.max(...slips).toFixed(2), holdSlip: +(slips.slice(-120).reduce((a, b) => a + b, 0) / 120).toFixed(2), speedKeptPct: Math.round(v.s.speed / sp0 * 100), headingChangeDeg: Math.round(Math.abs(v.s.yaw) * 57.3) };
  // exit: countersteer then neutral -> time until grip
  let exitT = null;
  for (t = 0; t < 4; t += DT) { v.step(DT, C({ throttle: 0.5, steer: t < 0.6 ? -0.8 : 0 })); if (exitT === null && v.s.slip < 0.08) exitT = t; }
  m.drift.exitTime = exitT === null ? '>4' : +exitT.toFixed(2);
  // power oversteer from 50 km/h
  v = car(params, 50); maxSlip = 0;
  for (t = 0; t < 3; t += DT) { v.step(DT, C({ throttle: 1, steer: 0.7 })); maxSlip = Math.max(maxSlip, v.s.slip); }
  m.powerSlideMaxSlip = +maxSlip.toFixed(2);
  return m;
}

const out = {};
for (const id of PLAYER_CAR_ORDER) out[id] = metrics(tunedParams(id, {}));
out.kestrel_maxed = metrics(tunedParams('kestrel', { engine: 3, transmission: 3, tires: 3, brakes: 3, suspension: 3, nitrous: 3 }));
out.police = metrics({ ...POLICE_CAR.params });
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(15), JSON.stringify(v));
