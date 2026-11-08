// Deliveries (game/Jobs.js, game/Delivery.js) and what a load does to a truck (physics/Upgrades.js: the load's weight
// on the bed, the springs set for the truck empty).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';
import { JOBS, CARGO, placeOf, loadOf, payOf } from '../src/game/Jobs.js';
import { Delivery } from '../src/game/Delivery.js';
import { soft } from './grounds.mjs';

const flat = (s) => ({ height: () => 0, surfaceAt: () => SURFACES[s], water: () => -Infinity });
const settle = (v, g, t = 3) => { for (let k = 0; k < t / PHYS_DT; k++) v.step({ throttle: 0, brake: 1, steer: 0, handbrake: 1 }, g); };

test('a load squats the truck by what its springs give, and raises its centre of gravity', () => {
  const g = flat(SURFACE.ROAD);
  for (const id of ['ranger', 'thar', 'hauler']) {
    const empty = new Vehicle(truckSpec(id, '')), spec = truckSpec(id, '', { m: 500, kind: 'cement' }), laden = new Vehicle(spec);
    empty.place(g, 0, 0, 0); laden.place(g, 0, 0, 0);
    settle(empty, g); settle(laden, g);
    const rear = (v) => (v.axles[1].zL + v.axles[1].zR) / 2, [fz, rz] = spec.axles.map((a) => a.z);
    const want = 500 * 9.81 * ((fz - spec.cargo.z) / (fz - rz)) / 2 / spec.axles[1].rate;
    const got = rear(laden) - rear(empty);
    assert.ok(Math.abs(got - want) < 0.25 * want, `${id}: rear squats ${(got * 100).toFixed(1)} cm, its springs ${(want * 100).toFixed(1)} cm`);
    assert.equal(spec.mass, truckSpec(id, '').mass + 500);
    assert.ok(spec.cgHeight > truckSpec(id, '').cgHeight + 0.03, `${id}: centre of gravity up`);
  }
});

test('a load: the truck pulls slower, and sinks deeper in mud', () => {
  const road = flat(SURFACE.ROAD);
  const to30 = (cargo) => {
    const v = new Vehicle(truckSpec('ranger', '', cargo));
    v.place(road, 0, 0, 0); settle(v, road, 1);
    let t = 0;
    for (; t < 20 && v.vel.dot(v.fwd) < 8.33; t += PHYS_DT) v.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, road);
    return t;
  };
  const tEmpty = to30(null), tLaden = to30({ m: 500, kind: 'cement' });
  assert.ok(tLaden > tEmpty * 1.1, `0-30 km/h: ${tEmpty.toFixed(1)} s empty, ${tLaden.toFixed(1)} s with 500 kg`);
  const sink = (cargo) => {
    const mud = soft(SURFACE.MUD), v = new Vehicle(truckSpec('ranger', '', cargo));
    v.place(mud, 0, 0, 0); settle(v, mud, 4);
    return v.wheels.reduce((s, w) => s + (w.sink || 0), 0) / 4;
  };
  const sEmpty = sink(null), sLaden = sink({ m: 500, kind: 'cement' });
  assert.ok(sLaden > sEmpty + 0.005, `standing in mud: ${(sEmpty * 100).toFixed(1)} cm empty, ${(sLaden * 100).toFixed(1)} cm with 500 kg`);
});

test('the jobs: every place is on the map, every load what its units weigh, the pay by distance and weight', () => {
  for (const j of JOBS) {
    const a = placeOf(j.from), b = placeOf(j.to);
    assert.ok(a && b, `${j.id}: both places found`);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 500, `${j.id}: somewhere to go`);
    assert.ok(j.km * 1000 >= Math.hypot(a.x - b.x, a.z - b.z) * 0.98, `${j.id}: no shorter than the straight line`);
    const L = loadOf(j);
    assert.equal(L.m, Math.round(CARGO[j.cargo].each * j.count));
    assert.ok(L.m >= 150 && L.m <= 600, `${j.id}: ${L.m} kg, a 4x4's load`);
    assert.equal(payOf(j), Math.round((150 + 120 * j.km + 0.25 * L.m * j.km) / 10) * 10);
  }
  assert.equal(CARGO.cement.each, 50);
  assert.equal(CARGO.gas.each, 29.7);
  assert.equal(new Set(JOBS.map((j) => j.id)).size, JOBS.length);
});

/** A game for Delivery: a truck to move about, and what it calls. */
function fakeGame() {
  const G = {
    vehicle: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, up: { y: 1 }, waterDepth: 0 },
    spec: {}, route: null, cargo: null, paid: [], toasts: [], events: { racing: false },
    hud: { toast: (t) => G.toasts.push(t), hint: () => {} },
    career: { add: (n, why) => G.paid.push([n, why]) },
    setRoute: (item) => { G.route = { target: item, left: 0 }; },
    clearRoute: () => { G.route = null; },
    setCargo: (c) => { G.cargo = c; G.spec = c ? { cargo: { y: 1.1, z: -1 } } : {}; },
  };
  return G;
}
const run = (D, G, s) => { for (let t = 0; t < s; t += 1 / 60) D.update(1 / 60); };
const at = (G, p) => { G.vehicle.pos.x = p.x; G.vehicle.pos.z = p.z; };

test('a delivery: stop at the pickup and it loads, stop at the drop and it pays', () => {
  const G = fakeGame(), D = new Delivery(G), job = JOBS.find((j) => j.id === 'fort-cement');
  D.take(job.id);
  assert.equal(G.route.target.name, 'Kashid Motor Station');
  at(G, placeOf(job.from));
  run(D, G, 1);
  assert.equal(G.cargo, null, 'not loaded yet: it takes a moment');
  run(D, G, 1.5);
  assert.deepEqual(G.cargo, { m: 400, kind: 'cement', count: 8 });
  assert.equal(G.route.target.name, 'Korlai Fort');
  assert.ok(D.carrying);
  // driving past the drop doesn't unload it (speeding up and slowing down as a truck does: no jolt)
  at(G, placeOf(job.to));
  for (let k = 0; k <= 60; k++) { G.vehicle.vel.x = k / 12; D.update(1 / 60); }
  run(D, G, 2);
  assert.ok(D.carrying);
  for (let k = 60; k >= 0; k--) { G.vehicle.vel.x = k / 12; D.update(1 / 60); }
  run(D, G, 3);
  assert.equal(G.cargo, null);
  assert.deepEqual(G.paid, [[payOf(job), 'Delivery: Cement for Korlai Fort']]);
  assert.equal(D.active, null);
});

test('a delivery: jolts cost paper sacks more than drums; water ruins cement; a roll-over spills the load', () => {
  const bump = (cargo) => {
    const G = fakeGame(), D = new Delivery(G), job = JOBS.find((j) => j.cargo === cargo);
    D.take(job.id); at(G, placeOf(job.from)); run(D, G, 3);
    at(G, { x: 1e5, z: 1e5 });
    // a landing off a metre's drop: 4.4 m/s down taken out in 0.12 s of suspension travel, about 4.8 g through the
    // bed floor... then calm
    for (let k = 0; k < 5; k++) {
      G.vehicle.vel.y = -4.4; D.update(1 / 60);
      for (let f = 7; f >= 0; f--) { G.vehicle.vel.y = -4.4 * f / 7; D.update(1 / 60); }
      run(D, G, 0.5);
    }
    return D.active.cond;
  };
  const tea = bump('tea'), diesel = bump('diesel');
  assert.ok(tea < 0.9 && diesel > tea, `after five hard landings: tea ${(tea * 100).toFixed(0)}%, diesel ${(diesel * 100).toFixed(0)}%`);

  const G = fakeGame(), D = new Delivery(G), job = JOBS.find((j) => j.cargo === 'cement');
  D.take(job.id); at(G, placeOf(job.from)); run(D, G, 3);
  at(G, { x: 1e5, z: 1e5 });
  G.vehicle.waterDepth = 0.5;                       // under the bed floor (0.85 m): dry
  run(D, G, 5);
  assert.equal(D.active.cond, 1);
  G.vehicle.waterDepth = 1.0;                       // over it
  run(D, G, 4);
  assert.equal(D.active, null, 'soaked');
  assert.ok(G.toasts.some((t) => /ruined/.test(t)));

  const H = fakeGame(), E = new Delivery(H), j2 = JOBS.find((j) => j.cargo === 'gas');
  E.take(j2.id); at(H, placeOf(j2.from)); run(E, H, 3);
  at(H, { x: 1e5, z: 1e5 });
  H.vehicle.up.y = -0.9;
  run(E, H, 1.5);
  assert.equal(E.active, null);
  assert.equal(H.cargo, null);
  assert.ok(H.toasts.some((t) => /spilled/.test(t)));
});
