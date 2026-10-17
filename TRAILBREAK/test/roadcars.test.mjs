// The road cars: each drives as its maker says it does (its `real` figures in trucks.js), takes only a road car's
// parts, and is driven as it is built: rear-wheel drive, or all-wheel drive through a centre differential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { ROAD_IDS, OFFROAD_IDS, truckSpec, truckBase } from '../src/physics/trucks.js';
import { SURFACE, SURFACES } from '../src/physics/Surfaces.js';
import { CATEGORIES, optionsFor, optionAllowed, presetsFor, presetBuild, buildStats, TYRE_SIZES } from '../src/physics/Upgrades.js';
import { flat } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(v, ground, seconds, ctrl, until) {
  for (let i = 0, n = Math.round(seconds / PHYS_DT); i < n; i++) {
    v.step(typeof ctrl === 'function' ? ctrl(v) : ctrl, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
    if (until?.(v)) return i * PHYS_DT;
  }
  return null;
}

for (const id of ROAD_IDS) {
  test(`${id}: 0-100 km/h and top speed near the maker's figures, stops from 100 in 28-40 m`, () => {
    const real = truckBase(id).real, road = flat(SURFACE.ROAD);
    let v = new Vehicle(truckSpec(id));
    v.place(road, 0, 0, 0);
    run(v, road, 1.5, { ...IDLE, handbrake: 1 });                              // (settled on its springs)
    const t100 = run(v, road, 12, { ...IDLE, throttle: 1 }, (v) => v.vel.dot(v.fwd) * 3.6 >= 100);
    // (a little slower than the maker's, who launches on a warm, rubbered-in surface)
    assert.ok(t100 !== null && t100 > real.t100 * 0.9 && t100 < real.t100 * 1.25, `${id}: 0-100 in ${t100?.toFixed(2)} s (the maker: ${real.t100} s)`);
    const vmax = buildStats(truckSpec(id)).topSpeed;
    assert.ok(Math.abs(vmax - real.vmax) < real.vmax * 0.08, `${id}: ${vmax.toFixed(0)} km/h flat out (the maker: ${real.vmax})`);
    v = new Vehicle(truckSpec(id));
    v.place(road, 0, 0, 0);
    v.vel.set(0, 0, 100 / 3.6);
    for (const w of v.wheels) w.omega = 100 / 3.6 / v.spec.tyre.radius;
    run(v, road, 8, { ...IDLE, brake: 1 }, (v) => v.vel.dot(v.fwd) < 0.15);
    assert.ok(v.pos.z > 28 && v.pos.z < 40, `${id}: stopped from 100 in ${v.pos.z.toFixed(1)} m`);   // (the Senna: 29.5)
  });
}

test('a road car takes a road car\'s parts and its own tyres; a truck none of them', () => {
  for (const id of ROAD_IDS) {
    const base = truckBase(id);
    assert.ok(base.only?.tyre?.length, `${id}: its tyre sizes`);
    for (const d of TYRE_SIZES) assert.equal(optionAllowed(base, 'tyre', TYRE_SIZES.indexOf(d)), base.only.tyre.includes(d), `${id}: ${d}" tyres`);
    // no lockers, snorkel, armour or light bar; and every preset leaves it a road car on its own tyres
    for (const [cat, i] of [['diffs', 3], ['intake', 1], ['armor', 1], ['lights', 1], ['lift', 3]]) assert.ok(!optionAllowed(base, cat, i), `${id}: ${cat} ${i}`);
    for (const p of presetsFor(base)) {
      const b = presetBuild(base, p.id), st = buildStats(truckSpec(id, b));
      assert.ok(base.only.tyre.includes(b.tyre) && b.lift <= 1, `${id} ${p.id}`);
      for (const k of ['mass', 'cgHeight', 'clearance', 'topSpeed']) assert.ok(Number.isFinite(st[k]) && st[k] > 0, `${id} ${p.id}: ${k} ${st[k]}`);
    }
    const st = buildStats(truckSpec(id));
    assert.ok(st.clearance > 0.08 && st.clearance < 0.2 && st.tip > 45, `${id}: ${st.clearance.toFixed(3)} m clearance, tips at ${st.tip.toFixed(0)} degrees`);
  }
  for (const id of OFFROAD_IDS) {
    const base = truckBase(id);
    for (const cat of CATEGORIES) {
      if (cat.id === 'tyre' || cat.id === 'engine') continue;
      optionsFor(cat, id).forEach((o, i) => { if (o.road) assert.ok(!optionAllowed(base, cat.id, i), `${id}: ${cat.id} ${o.name}`); });
    }
    for (const d of [24, 25, 26]) assert.ok(!optionAllowed(base, 'tyre', TYRE_SIZES.indexOf(d)), `${id}: ${d}" road tyres`);
  }
});

/** The share of the drive torque on the front axle over a second flat out from a standstill. */
function frontShare(spec, ground) {
  const v = new Vehicle(spec);
  v.place(ground, 0, 0, 0);
  run(v, ground, 1, { ...IDLE, handbrake: 1 });
  let f = 0, r = 0;
  run(v, ground, 1, { ...IDLE, throttle: 1 }, (v) => { const T = v.dt.wheelT; f += T[0] + T[1]; r += T[2] + T[3]; });
  return { share: f / (f + r), v };
}

test('rear-wheel drive drives the rear wheels alone; it has no front axle to engage', () => {
  const spec = truckSpec(ROAD_IDS[0]);
  assert.equal(spec.trans.drive, 'rwd');
  const { share, v } = frontShare(spec, flat(SURFACE.ROAD));
  assert.ok(Math.abs(share) < 1e-6, `front share ${share}`);
  assert.equal(v.dt.fourWD, false);
  assert.equal(v.dt.setFourWD(true, 0), false);
});

test('all-wheel drive: the centre diff splits the drive; its coupling sends it to the axle that grips', () => {
  const awd = (centre) => {
    const spec = JSON.parse(JSON.stringify(truckSpec(ROAD_IDS[0])));
    Object.assign(spec.trans, { drive: 'awd', split: 0.3, centre });
    return spec;
  };
  // on a dry road, about the split
  const dry = frontShare(awd([0, 0]), flat(SURFACE.ROAD)).share;
  assert.ok(dry > 0.25 && dry < 0.35, `front share ${dry.toFixed(3)} on the road`);
  // the rear wheels on ice, the front on the road: an open centre diff gives the front no more than the spinning
  // rear takes; the coupling holds the axles together and the front pulls the car off the ice
  const ice = { height: () => 0, surfaceAt: (x, z) => SURFACES[z < 0 ? SURFACE.ICE : SURFACE.ROAD] };
  const go = (centre) => { const { v } = frontShare(awd(centre), ice); return v.pos.z; };
  const open = go([0, 0]), coupled = go([400, 0.3]);
  assert.ok(coupled > open + 0.3, `open centre ${open.toFixed(2)} m, coupled ${coupled.toFixed(2)} m`);
});

test('downforce: the wings press a road car onto the road with the square of its speed', () => {
  const spec = truckSpec(ROAD_IDS[0]), road = flat(SURFACE.ROAD);
  const load = (kmh) => {
    const v = new Vehicle(spec);
    v.place(road, 0, 0, 0);
    v.vel.set(0, 0, kmh / 3.6);
    for (const w of v.wheels) w.omega = kmh / 3.6 / spec.tyre.radius;
    v.dt.auto = false; v.dt.gear = v.dt.t.gears.length;                      // (coasting in top gear)
    let n = 0, k = 0;
    // the wheels' load over the last half second
    run(v, road, 1.5, IDLE, (v) => { if (v.time > 1) { n += v.wheels.reduce((s, w) => s + w.N, 0); k++; } });
    return n / k;
  };
  const q = 0.5 * 1.2 * (200 / 3.6) ** 2, expect = q * (spec.aero[0] + spec.aero[1]);
  const added = load(200) - load(30);
  assert.ok(Math.abs(added - expect) < 0.35 * expect, `${added.toFixed(0)} N more at 200 km/h (the wings: ${expect.toFixed(0)})`);
});
