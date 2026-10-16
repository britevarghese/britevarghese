// Damage: what breaks, when it breaks, and what it does to the truck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec, TRUCKS } from '../src/physics/trucks.js';
import { presetBuild } from '../src/physics/Upgrades.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';
import { flat, ledge, flooded } from './grounds.mjs';

const run = (v, ground, ctrl, seconds, each) => {
  for (let n = 0; n < seconds * 480; n++) { v.step(typeof ctrl === 'function' ? ctrl(n / 480, v) : ctrl, ground); each?.(v); }
};
const heading = (v) => Math.atan2(v.fwd.x, v.fwd.z) * 180 / Math.PI;

/** Flat ground with one tree trunk at (x, z). */
function withTree(x, z, r = 0.25) {
  const tree = { x, y: 0, z, r };
  return {
    height: () => 0, surfaceAt: () => SURFACES[SURFACE.DIRT],
    treesNear: (px, pz, rr, out) => { out.length = 0; if (Math.hypot(px - x, pz - z) < rr + 4) out.push(tree); return out; },
  };
}

test('ordinary driving breaks nothing: accelerating, braking, weaving, crawling a ledge slowly', () => {
  const v = new Vehicle(truckSpec('ranger'));
  const g = flat(SURFACE.DIRT);
  v.place(g, 0, 0, 0);
  run(v, g, (t) => ({ throttle: t < 8 ? 1 : 0, brake: t > 8 ? 1 : 0, steer: Math.sin(t) * 0.6, handbrake: 0 }), 12);
  assert.ok(!v.damage.any, `damage on a drive: ${JSON.stringify(v.damage.summary())}`);
  const w = new Vehicle(truckSpec('hauler'));
  const l = ledge(6, 0.3);
  w.place(l, 0, 0, 0);
  w.dt.setRange(true, 0);
  run(w, l, (t, v2) => ({ throttle: v2.vel.length() < 1.2 ? 0.6 : 0, brake: 0, steer: 0, handbrake: 0 }), 20);
  assert.ok(w.pos.z > 8, 'over the ledge');
  assert.ok(!w.damage.any, `damage crawling a ledge: ${JSON.stringify(w.damage.summary())}`);
});

test('a roll onto the roof dents it, breaks the glass and stops the engine', () => {
  const v = new Vehicle(truckSpec('ranger'));
  const g = flat(SURFACE.DIRT);
  v.place(g, 0, 0, 0);
  v.pos.y += 2.2;
  v.quat.set(0, 0, 1, 0);                                   // upside down
  run(v, g, { throttle: 0.2, brake: 0, steer: 0, handbrake: 0 }, 4);
  const D = v.damage;
  assert.ok(v.up.y < -0.5, 'on its roof');
  assert.ok(D.dents.length > 0 && D.body > 0.2, `dents: ${D.dents.length}, body ${D.body}`);
  assert.ok(D.dents.some((d) => d.p[1] > 0.4), 'dents on the top');
  assert.ok(D.glass >= 0.35, `glass ${D.glass}`);
  assert.equal(v.dt.running, false, 'the engine starves upside down');
  // righted, it starts again
  v.rightSideUp(g);
  assert.equal(v.dt.running, true);
});

test('realistic: into a tree at 20 km/h the radiator holes, the coolant runs out, it overheats and loses power', () => {
  const g = withTree(0, 12);
  const v = new Vehicle(truckSpec('ranger'));
  v.damage.setLevel('realistic');
  v.place(g, 0, 0, 0);
  run(v, g, (t, s) => ({ throttle: s.pos.z < 7 && s.vel.length() * 3.6 < 20 ? 1 : 0, brake: 0, steer: 0, handbrake: 0 }), 4);
  const D = v.damage;
  assert.ok(D.dents.length > 0, 'dented');
  assert.ok(D.radiator > 0, `radiator ${D.radiator}`);
  assert.ok(D.dents.every((d) => d.p[2] > 0.5), 'the dents are at the front');
  // back off and idle, then drive on with the leak: coolant gone, temperature up, power down
  const P0 = D.power;
  const g2 = flat(SURFACE.DIRT);
  v.place(g2, 50, 0, 0);
  run(v, g2, (t) => ({ throttle: t % 20 < 10 ? 0.8 : 0, brake: t % 20 < 10 ? 0 : 1, steer: 0, handbrake: 0 }), 260);
  assert.ok(D.coolant < 0.1, `coolant ${D.coolant}`);
  assert.ok(D.temp > 112, `temperature ${D.temp}`);
  assert.ok(D.power < P0 * 0.85, `power ${D.power}`);
});

test('realistic: a slower knock on a tree only scuffs: no dent below ~8 km/h, a dent above', () => {
  const knock = (kmh) => {
    const g = withTree(0, 12);
    const v = new Vehicle(truckSpec('ranger'));
    v.damage.setLevel('realistic');
    v.place(g, 0, 8, 0);
    v.vel.set(0, 0, kmh / 3.6);                              // rolling at kmh, coasting into the trunk
    for (const w of v.wheels) w.omega = kmh / 3.6 / v.spec.tyre.radius;
    run(v, g, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 4);
    return v.damage;
  };
  const slow = knock(6), fast = knock(14);
  assert.equal(slow.dents.length, 0);
  assert.equal(slow.radiator, 0);
  assert.ok(fast.dents.length > 0, 'a dent at 14 km/h');
});

test('a flat tyre drops its corner and pulls the truck to that side; the spare puts it right', () => {
  const g = flat(SURFACE.ROAD);
  const drive = (flatI) => {
    const v = new Vehicle(truckSpec('ranger'));
    v.place(g, 0, 0, 0);
    if (flatI >= 0) v.damage.goFlat(flatI, 'test');
    run(v, g, { throttle: 0.5, brake: 0, steer: 0, handbrake: 0 }, 6);
    return v;
  };
  const ok = drive(-1), fl = drive(0);
  assert.ok(fl.wheels[0].hub.y < ok.wheels[0].hub.y - 0.05, `hub ${fl.wheels[0].hub.y} vs ${ok.wheels[0].hub.y}`);
  // flat front left (left = +x): it drags and the truck turns left
  assert.ok(heading(fl) - heading(ok) > 2, `heading ${heading(fl)} vs ${heading(ok)}`);
  assert.ok(fl.damage.fitSpare(0) && !fl.damage.flat[0] && !fl.damage.spare);
  assert.equal(fl.damage.fitSpare(0), false, 'only one spare');
});

test('a bent tie rod makes the truck pull', () => {
  const g = flat(SURFACE.ROAD);
  const v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0);
  v.damage.toe = 0.03;                                       // toed left
  run(v, g, { throttle: 0.5, brake: 0, steer: 0, handbrake: 0 }, 6);
  assert.ok(heading(v) > 5, `heading ${heading(v)}`);
});

test('a snapped rear shaft: an open diff stops driving (2WD goes nowhere, 4WD gets home); a locker still drives', () => {
  const g = flat(SURFACE.DIRT);
  const go = (fourWD, build, lock) => {
    const v = new Vehicle(truckSpec('ranger', build));
    v.place(g, 0, 0, 0);
    v.dt.setFourWD(fourWD, 0);
    if (lock) v.dt.setLocker('rear', true, 0);
    v.damage.shafts[2] = true;                               // rear left
    run(v, g, { throttle: 0.7, brake: 0, steer: 0, handbrake: 0 }, 5);
    return v.vel.length();
  };
  assert.ok(go(false) < 0.3, '2WD, open rear diff: no drive');
  assert.ok(go(true) > 3, '4WD: the front pulls');
  assert.ok(go(false, presetBuild(TRUCKS.ranger, 'crawler'), true) > 3, 'rear locker in: the other rear wheel drives');
});

test('realistic: water in the intake at revs bends a rod; at idle it only stalls', () => {
  const v = new Vehicle(truckSpec('ranger'));
  v.damage.setLevel('realistic');
  const deep = flooded(flat(SURFACE.RIVERBED), 1.2);
  v.place(flat(SURFACE.RIVERBED), 0, 0, 0);
  v.damage.hydrolock(800);
  assert.equal(v.damage.engine, 1, 'idle: no damage');
  v.damage.hydrolock(3000);
  assert.ok(v.damage.engine < 0.4, `engine ${v.damage.engine}`);
  v.damage.hydrolock(3500);
  assert.ok(v.damage.seized, 'seized');
  run(v, flat(SURFACE.RIVERBED), { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 0.1);
  assert.equal(v.dt.running, false, 'it stops');
  v.dt.start();
  assert.equal(v.dt.crankT, 0, 'a seized engine will not crank');
  void deep;
});

test('forgiving (the default): a 20 km/h tree only scuffs, a hard crash leaks slowly, and the engine never seizes from heat or water', () => {
  const tree = (kmh) => {
    const g = withTree(0, 12);
    const v = new Vehicle(truckSpec('ranger'));
    assert.equal(v.damage.level, 'forgiving');
    v.place(g, 0, 8, 0);
    v.vel.set(0, 0, kmh / 3.6);
    for (const w of v.wheels) w.omega = kmh / 3.6 / v.spec.tyre.radius;
    run(v, g, { throttle: 0, brake: 0, steer: 0, handbrake: 0 }, 4);
    return v;
  };
  const knock = tree(20).damage;
  assert.equal(knock.radiator, 0, 'no leak at 20 km/h');
  assert.equal(knock.toe, 0, 'the steering is true');
  // a 40 km/h crash holes it; driven on for minutes the engine overheats and loses power but keeps running
  const v = tree(40), D = v.damage;
  assert.ok(D.radiator > 0, 'a crash holes the radiator');
  const g2 = flat(SURFACE.DIRT);
  v.place(g2, 50, 0, 0);
  run(v, g2, (t) => ({ throttle: t % 20 < 10 ? 0.8 : 0, brake: t % 20 < 10 ? 0 : 1, steer: 0, handbrake: 0 }), 600);
  assert.ok(!D.seized && v.dt.running, `still running (engine ${D.engine.toFixed(2)}, ${D.temp.toFixed(0)} C)`);
  // water in the intake at 3000 rpm: it stalls and knocks, but it will start again
  const w = new Vehicle(truckSpec('ranger'));
  w.damage.hydrolock(3000);
  assert.ok(!w.damage.seized && w.damage.engine > 0.9, `engine ${w.damage.engine}`);
});

test('the workshop mends everything; the bill reflects the damage', () => {
  const v = new Vehicle(truckSpec('ranger'));
  const D = v.damage;
  D.hit({ x: 0, y: 0.6, z: 1.5 }, { x: 0, y: 0, z: -1 }, 7, 'k', 0);
  D.goFlat(1, 'test');
  D.toe = 0.02;
  assert.ok(D.any && D.cost > 300, `cost ${D.cost}`);
  const v0 = D.version;
  D.repairAll();
  assert.ok(!D.any && D.version > v0 && D.cost === 0);
});
