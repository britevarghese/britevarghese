// An electric truck (the GMC Hummer EV): its motors geared straight to the axles give all their torque from a
// standstill, there is no idle and so no creep, off the throttle they brake it (regenerating), the top speed is the
// motors' limit, and deep water cuts the power back rather than stopping it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec, truckBase } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { PRESETS, presetBuild, EV_TRANS } from '../src/physics/Upgrades.js';
import { flat, flooded } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const run = (v, g, s, c, until) => {
  for (let i = 0, n = Math.round(s / PHYS_DT); i < n; i++) { v.step(c, g); if (until?.(v)) return i * PHYS_DT; }
  return null;
};

test('the Hummer EV: no creep, 0-100 km/h in under five seconds, its top speed at the motors\' limit', () => {
  const road = flat(SURFACE.ROAD), v = new Vehicle(truckSpec('hummerev'));
  v.place(road, 0, 0, 0);
  run(v, road, 3, IDLE);
  assert.ok(Math.abs(v.speed) < 0.05, `crept to ${v.speed.toFixed(2)} m/s`);
  assert.ok(v.dt.running && Math.abs(v.dt.rpm) < 5, 'on, the motors still');
  const t100 = run(v, road, 20, { ...IDLE, throttle: 1 }, (w) => w.speed * 3.6 >= 100);
  assert.ok(t100 !== null && t100 < 5, `0-100 km/h in ${t100?.toFixed(2)} s`);
  run(v, road, 40, { ...IDLE, throttle: 1 });
  const top = v.speed * 3.6;
  assert.ok(top > 160 && top < 180, `top speed ${top.toFixed(0)} km/h`);
});

test('the Hummer EV regenerates off the throttle: the motors brake it, harder than an engine in gear does', () => {
  const road = flat(SURFACE.ROAD);
  const coast = (id) => {
    const v = new Vehicle(truckSpec(id));
    v.place(road, 0, 0, 0);
    run(v, road, 30, { ...IDLE, throttle: 1 }, (w) => w.speed * 3.6 >= 80);
    const s0 = v.speed;
    run(v, road, 0.5, IDLE);
    const torque = v.dt.engineTorque;
    run(v, road, 2.5, IDLE);
    return { decel: (s0 - v.speed) / 3, torque };
  };
  const ev = coast('hummerev'), ice = coast('bronco');
  assert.ok(ev.torque < -50, `motor torque off the throttle ${ev.torque.toFixed(0)} Nm`);
  assert.ok(ev.decel > 1.0 && ev.decel > ice.decel, `slows at ${ev.decel.toFixed(2)} m/s2 (the Bronco ${ice.decel.toFixed(2)})`);
});

test('the Hummer EV in a metre of water: sealed, the power cut back, it keeps driving; its builds stay electric', () => {
  const water = flooded(flat(SURFACE.RIVERBED), 1.0), v = new Vehicle(truckSpec('hummerev'));
  v.place(water, 0, 0, 0);
  run(v, water, 4, { ...IDLE, throttle: 0.5 });
  assert.ok(v.dt.running && !v.flooded, 'still running');
  assert.ok(v.speed > 0.5, `drives on at ${v.speed.toFixed(2)} m/s`);
  // no gearbox or transfer case swaps, no snorkel: every preset keeps the electric drive
  for (const p of PRESETS) {
    const b = presetBuild(truckBase('hummerev'), p.id), spec = truckSpec('hummerev', b);
    assert.ok(b.trans === EV_TRANS && b.tcase === 0 && b.intake === 0 && spec.trans.type === 'direct', `${p.id}: ${JSON.stringify(b)}`);
    assert.ok(spec.engine.electric, `${p.id}: electric`);
  }
});
