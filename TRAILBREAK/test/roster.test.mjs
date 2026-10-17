// The dealer's roster: every truck, stock and built, is a sound truck that drives, stops and climbs like its kind, and
// every one takes the garage's parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { TRUCK_IDS, OFFROAD_IDS, truckSpec, truckBase } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { PRESETS, presetsFor, presetBuild, stockBuild, buildStats, maxTyre, LIFTS, TYRE_SIZES } from '../src/physics/Upgrades.js';
import { TRUCK_PRICES, DEALER_ORDER } from '../src/game/Career.js';
import { flat, slope } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(v, ground, seconds, ctrl, until) {
  for (let i = 0, n = Math.round(seconds / PHYS_DT); i < n; i++) {
    v.step(ctrl, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
    if (until?.(v)) return i * PHYS_DT;
  }
  return null;
}

test('the dealer sells every truck, cheapest first, and every truck takes the whole catalogue', () => {
  assert.deepEqual([...DEALER_ORDER].sort(), [...TRUCK_IDS].sort());
  for (let i = 1; i < DEALER_ORDER.length; i++) assert.ok(TRUCK_PRICES[DEALER_ORDER[i]] > TRUCK_PRICES[DEALER_ORDER[i - 1]]);
  // (the road cars: test/roadcars.test.mjs)
  for (const id of OFFROAD_IDS) {
    const base = truckBase(id), stock = stockBuild(base), st0 = buildStats(truckSpec(id));
    // tyres: from the factory size up to what the tallest lift clears, at least three sizes to choose from
    const sizes = TYRE_SIZES.filter((d) => d >= base.stock.tyre && d <= maxTyre(base, LIFTS.length - 1));
    assert.ok(sizes.length >= 3, `${id}: ${sizes.length} tyre sizes`);
    assert.ok(st0.clearance > 0.17 && st0.clearance < 0.5, `${id}: ${st0.clearance} m under the diffs`);
    assert.ok(st0.wading > 0.6 && st0.tip > 35, `${id}: wades ${st0.wading} m, tips at ${st0.tip} degrees`);
    for (const p of PRESETS.slice(1)) {
      const b = presetBuild(base, p.id), st = buildStats(truckSpec(id, b));
      for (const k of ['mass', 'cgHeight', 'clearance', 'approach', 'departure', 'breakover', 'wading', 'crawl', 'topSpeed']) {
        assert.ok(Number.isFinite(st[k]) && st[k] > 0, `${id} ${p.id}: ${k} ${st[k]}`);
      }
      // every build lifts the truck onto bigger tyres: more room under the diffs, a heavier truck
      assert.ok(b.lift > 0 && b.tyre > stock.tyre, `${id} ${p.id}: lift ${b.lift}, ${b.tyre}" tyres`);
      assert.ok(st.clearance > st0.clearance && st.mass > st0.mass, `${id} ${p.id}: clearance and weight`);
    }
  }
});

for (const id of OFFROAD_IDS) {
  test(`${id}: gets up to 50 km/h on the road, stops from 50 in 10-16 m, climbs a 25 degree dirt slope in low range`, () => {
    const road = flat(SURFACE.ROAD);
    let v = new Vehicle(truckSpec(id));
    v.place(road, 0, 0, 0);
    v.dt.setFourWD(false, 0);
    const t50 = run(v, road, 25, { ...IDLE, throttle: 1 }, (v) => v.vel.dot(v.fwd) * 3.6 >= 50);
    assert.ok(t50 !== null, `${id}: never reached 50 km/h`);
    // braking from 50 km/h
    v = new Vehicle(truckSpec(id));
    v.place(road, 0, 0, 0);
    v.vel.set(0, 0, 50 / 3.6);
    for (const w of v.wheels) w.omega = 50 / 3.6 / v.spec.tyre.radius;
    run(v, road, 8, { ...IDLE, brake: 1 }, (v) => v.vel.dot(v.fwd) < 0.15);
    assert.ok(v.pos.z > 10 && v.pos.z < 16, `${id}: stopped in ${v.pos.z.toFixed(1)} m`);
    // 25 degrees of dirt from a standstill
    const hill = slope(25, SURFACE.DIRT);
    v = new Vehicle(truckSpec(id));
    v.place(hill, 0, 0, 0);
    v.dt.setRange(true, 0); v.dt.setFourWD(true, 0);
    const up = run(v, hill, 15, { ...IDLE, throttle: 1 }, (v) => v.pos.z > 12);
    assert.ok(up !== null && v.up.y > 0.8, `${id}: did not climb 25 degrees (got to z ${v.pos.z.toFixed(1)})`);
  });
}

test('every preset build of every truck settles and drives off', () => {
  const g = flat(SURFACE.DIRT);
  for (const id of TRUCK_IDS) {
    for (const p of presetsFor(truckBase(id))) {
      const v = new Vehicle(truckSpec(id, presetBuild(truckBase(id), p.id)));
      v.place(g, 0, 0, 0);
      run(v, g, 1, { ...IDLE, handbrake: 1 });
      assert.ok(v.vel.length() < 0.05, `${id} ${p.id}: still moving at rest`);
      v.dt.setFourWD(true, 0);
      run(v, g, 3, { ...IDLE, throttle: 0.6 });
      assert.ok(v.pos.z > 3 && v.up.y > 0.95, `${id} ${p.id}: drove ${v.pos.z.toFixed(1)} m`);
    }
  }
});

test('a heavy truck airs down and back up to its own road pressure (55 psi on the Unimog), not a light truck\'s', () => {
  const g = flat(SURFACE.SAND), v = new Vehicle(truckSpec('rhino'));
  v.place(g, 0, 0, 0);
  assert.equal(v.psi, 55);
  v.psiTarget = 22;
  run(v, g, 25, { ...IDLE, handbrake: 1 });
  assert.equal(v.psi, 22);
  v.psiTarget = 55;                                              // its onboard air
  run(v, g, 40, { ...IDLE, handbrake: 1 });
  assert.equal(v.psi, 55);
});
