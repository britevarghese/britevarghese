// Behaviour tests for the vehicle physics: each checks something a driver would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT, GRAVITY } from '../src/physics/Vehicle.js';
import { Drivetrain } from '../src/physics/Drivetrain.js';
import { TRUCKS, truckSpec } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { flat, slope, soft, slopeWithIce, ledge } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(v, ground, seconds, ctrl = IDLE) {
  const n = Math.round(seconds / PHYS_DT);
  for (let i = 0; i < n; i++) {
    v.step(typeof ctrl === 'function' ? ctrl(v) : ctrl, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
  }
}

function truck(id = 'ranger', ground = flat(), x = 0, z = 0, yaw = 0, build = undefined) {
  const v = new Vehicle(truckSpec(id, build));
  v.place(ground, x, z, yaw);
  return v;
}

const manual = (v, gear = 1) => { v.dt.auto = false; v.dt.gear = gear; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

for (const id of Object.keys(TRUCKS)) {
  test(`${id}: settles at its design ride height, carrying its weight on four tyres`, () => {
    const g = flat();
    const v = truck(id, g);
    run(v, g, 3, { ...IDLE, handbrake: 1 });
    const loads = v.wheels.reduce((s, w) => s + w.N, 0);
    assert.ok(Math.abs(loads - v.mass * GRAVITY) / (v.mass * GRAVITY) < 0.02, `tyre loads ${loads.toFixed(0)} N vs weight ${(v.mass * GRAVITY).toFixed(0)} N`);
    for (const ax of v.axles) {
      assert.ok(Math.abs(ax.zL - ax.spec.sag) < 0.012 && Math.abs(ax.zR - ax.spec.sag) < 0.012, `axle at ${ax.zL.toFixed(3)} / ${ax.zR.toFixed(3)}, design sag ${ax.spec.sag}`);
    }
    assert.ok(v.vel.length() < 0.01, 'at rest');
    assert.ok(Math.abs(v.pos.y - v.spec.cgHeight) < 0.03, `CG height ${v.pos.y.toFixed(3)}`);
  });
}

test('accelerates like an old V8 4x4 and tops out believably', () => {
  const g = flat();
  const v = truck('ranger', g);
  run(v, g, 1, { ...IDLE, handbrake: 1 });
  let t60 = null;
  const n = Math.round(40 / PHYS_DT);
  for (let i = 0; i < n; i++) {
    v.step({ ...IDLE, throttle: 1 }, g);
    if (t60 === null && v.speed * 3.6 >= 60) t60 = i * PHYS_DT;
  }
  assert.ok(t60 !== null && t60 > 5 && t60 < 10.5, `0-60 km/h in ${t60?.toFixed(1)} s`);
  const top = v.speed * 3.6;
  assert.ok(top > 115 && top < 175, `top speed ${top.toFixed(0)} km/h`);
  // straight, give or take the pull of torque twist (the right rear tyre a little lighter than the left)
  const heading = Math.atan2(v.fwd.x, v.fwd.z) * 180 / Math.PI;
  assert.ok(Math.abs(heading) < 2, `drives straight (heading ${heading.toFixed(2)} deg after ${v.pos.z.toFixed(0)} m)`);
});

test('low range crawls at walking pace and multiplies torque', () => {
  const g = flat();
  const v = truck('ranger', g);
  v.dt.setRange(true, 0);
  run(v, g, 12, { ...IDLE, throttle: 1 });
  const kmh = v.speed * 3.6;
  // low range in top gear: 4650 rpm limiter / (1.0 * 2.72 * 4.1) -> ~60 km/h
  assert.ok(kmh > 25 && kmh < 70, `low range speed after 12 s: ${kmh.toFixed(1)} km/h`);
});

test('the brakes hold a truck on a 25 degree dirt slope', () => {
  const g = slope(25, SURFACE.DIRT);
  const v = truck('ranger', g);
  manual(v, 1);
  run(v, g, 1, { ...IDLE, brake: 1 });
  const p0 = v.pos.clone();
  run(v, g, 5, { ...IDLE, brake: 1 });
  assert.ok(dist(v.pos, p0) < 0.05, `crept ${dist(v.pos, p0).toFixed(3)} m`);
});

test('locked wheels slide down a 25 degree mud slope', () => {
  const g = slope(25, SURFACE.MUD);
  const v = truck('ranger', g);
  manual(v, 1);
  const p0 = v.pos.clone();
  run(v, g, 5, { ...IDLE, brake: 1 });
  assert.ok(p0.z - v.pos.z > 1, `slid ${(p0.z - v.pos.z).toFixed(2)} m downhill`);
});

test('low range climbs a 30 degree slope from rest', () => {
  const g = slope(30, SURFACE.DIRT);
  const v = truck('ranger', g);
  v.dt.setRange(true, 0);
  manual(v, 1);
  run(v, g, 0.5, { ...IDLE, brake: 1 });
  const z0 = v.pos.z;
  run(v, g, 8, { ...IDLE, throttle: 1 });
  assert.ok(v.pos.z - z0 > 6, `climbed ${(v.pos.z - z0).toFixed(2)} m`);
});

test('open diffs: with a diagonal pair of tyres on ice the truck goes nowhere; locking both diffs climbs', () => {
  const setup = (build) => {
    // ice under the front-left and rear-right tyres (the cross-axle case), dirt under the other two
    const R = truckSpec('hauler'), half = R.axles[0].track / 2, zf = R.axles[0].z - R.cgZ, zr = R.axles[1].z - R.cgZ;
    const patches = [[half - 0.45, zr + 1.0, half + 0.45, 99], [-half - 0.45, -99, -half + 0.45, zf - 1.0]];
    const g = slopeWithIce(12, patches);
    const v = truck('hauler', g, 0, 0, 0, build);
    v.dt.setRange(true, 0);
    manual(v, 1);
    run(v, g, 1, { ...IDLE, brake: 1 });
    return { g, v };
  };
  {
    const { g, v } = setup();
    assert.equal(v.wheels[0].surf.name, 'ice');
    assert.equal(v.wheels[3].surf.name, 'ice');
    assert.equal(v.wheels[1].surf.name, 'dirt');
    const z0 = v.pos.z;
    run(v, g, 0.8, { ...IDLE, throttle: 0.7 });
    assert.ok(v.wheels[0].slipSpeed > 2 && v.wheels[3].slipSpeed > 2, 'the tyres on ice spin');
    assert.ok(v.wheels[1].slipSpeed < 0.5 && v.wheels[2].slipSpeed < 0.5, 'the tyres on dirt get no more torque than those on ice');
    run(v, g, 1.2, { ...IDLE, throttle: 0.7 });
    assert.ok(v.pos.z - z0 < 0.1, `open diffs moved it ${(v.pos.z - z0).toFixed(2)} m`);
  }
  {
    const { g, v } = setup({ diffs: 3 });
    assert.ok(v.dt.setLocker('front', true, 0) && v.dt.setLocker('rear', true, 0), 'lockers fitted');
    const z0 = v.pos.z;
    run(v, g, 3, { ...IDLE, throttle: 0.7 });
    assert.ok(v.pos.z - z0 > 0.6, `lockers moved it ${(v.pos.z - z0).toFixed(2)} m`);
  }
});

test('brake traction control: on the same cross-axle ice a modern truck, its lockers off, climbs on its brakes', () => {
  const S = truckSpec('bronco'), half = S.axles[0].track / 2, zf = S.axles[0].z - S.cgZ, zr = S.axles[1].z - S.cgZ;
  const g = slopeWithIce(12, [[half - 0.45, zr + 1.0, half + 0.45, 99], [-half - 0.45, -99, -half + 0.45, zf - 1.0]]);
  const go = (spec) => {
    const v = new Vehicle(spec);
    v.place(g, 0, 0, 0);
    v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    manual(v, 1);
    run(v, g, 1, { ...IDLE, brake: 1 });
    assert.equal(v.wheels[0].surf.name, 'ice');
    assert.equal(v.wheels[3].surf.name, 'ice');
    assert.ok(!v.dt.lockFront && !v.dt.lockRear, 'lockers off');
    const z0 = v.pos.z;
    run(v, g, 3, { ...IDLE, throttle: 0.7 });
    return v.pos.z - z0;
  };
  const without = go({ ...S, tc: false, bld: { front: false, rear: false } }), withTc = go(S);
  assert.ok(without < 0.1, `open diffs alone moved it ${without.toFixed(2)} m`);
  assert.ok(withTc > 0.6, `braking the spinning wheels moved it ${withTc.toFixed(2)} m`);
});

test('traction control: flat out up a snowy slope the tyres spin far less, and the truck climbs as well', () => {
  const g = slope(8, SURFACE.SNOW);
  const go = (spec) => {
    const v = new Vehicle(spec);
    v.place(g, 0, 0, 0);
    v.dt.setFourWD(true, 0);
    run(v, g, 1, { ...IDLE, handbrake: 1 });
    const z0 = v.pos.z;
    let slip = 0;
    run(v, g, 2, { ...IDLE, throttle: 1 });
    run(v, g, 2, (vv) => { slip += vv.wheels.reduce((s, w) => s + w.slipSpeed, 0) / 4; return { ...IDLE, throttle: 1 }; });
    return { climbed: v.pos.z - z0, slip: slip / Math.round(2 / PHYS_DT) };
  };
  const S = truckSpec('bronco'), off = go({ ...S, tc: false, bld: { front: false, rear: false } }), on = go(S);
  assert.ok(on.slip < off.slip * 0.5, `wheelspin ${on.slip.toFixed(1)} m/s with it, ${off.slip.toFixed(1)} without`);
  assert.ok(on.climbed > off.climbed * 0.9, `climbed ${on.climbed.toFixed(1)} m with it, ${off.climbed.toFixed(1)} without`);
});

test('a modern automatic kicks straight down to the gear it needs and holds its gear on a climb; an older one steps', () => {
  const box = (id) => { const s = truckSpec(id); return new Drivetrain(s.engine, s.trans, s.diffs); };
  // flat out at a crawl in low range in a tall gear: the ten-speed drops to first at once, the five-speed one gear
  const ten = box('bronco'), five = box('wrangler');
  for (const d of [ten, five]) {
    d.setRange(true, 0); d.shiftT = 0;
    d.gear = d.t.gears.length - 2; d.sinceShift = 5; d.wOut = 25;
    d.autoShift(PHYS_DT, 1, null);
  }
  assert.equal(ten.gear, 1, 'the ten-speed in first');
  assert.equal(five.gear, 2, 'the five-speed one gear down');
  // part throttle, the revs high enough to shift up, while a climb slows the truck: the ten-speed holds third
  const climb = (d, slowing) => {
    d.gear = 3; d.wOut = 4000 / (d.t.gears[2] * 30 / Math.PI);
    for (let i = 0; i < Math.round(1 / PHYS_DT); i++) {
      d.sinceShift = 0;
      if (slowing) d.wOut *= 1 - 0.12 * PHYS_DT;
      d.autoShift(PHYS_DT, 0.3, null);
    }
    d.sinceShift = 5;
    d.autoShift(PHYS_DT, 0.3, null);
    return d.gear;
  };
  assert.equal(climb(box('bronco'), true), 3, 'holds third as the climb slows it');
  assert.equal(climb(box('bronco'), false), 4, 'shifts up at a steady speed');
  assert.equal(climb(box('wrangler'), true), 4, 'the five-speed shifts up anyway');
});

test('a tyre climbs a rock ledge a third of its height', () => {
  const g = ledge(2.2, 0.14);
  const v = truck('ranger', g);
  v.dt.setRange(true, 0);
  run(v, g, 8, { ...IDLE, throttle: 0.7 });
  assert.ok(v.pos.z > 5, `got to z = ${v.pos.z.toFixed(2)}`);
  assert.ok(v.up.y > 0.95, 'still upright');
});

test('steering left turns left, and the body leans out of the turn', () => {
  const g = flat();
  const v = truck('ranger', g);
  run(v, g, 6, (veh) => ({ ...IDLE, throttle: veh.speed < 7 ? 0.6 : 0 }));
  run(v, g, 4, (veh) => ({ ...IDLE, throttle: veh.speed < 7 ? 0.6 : 0, steer: -1 }));
  assert.ok(v.angVel.y > 0.2, `yaw rate ${v.angVel.y.toFixed(2)} (left is +)`);
  assert.ok(v.left.y > 0.01, 'leans to the right (outside of a left turn)');
  assert.ok(v.up.y > 0.95, 'stays on its wheels');
});

test('tips over on a 50 degree side slope, stays up on 25', () => {
  for (const [deg, over] of [[25, false], [50, true]]) {
    const g = slope(deg, SURFACE.ROCK, true);
    const v = truck('ranger', g);
    manual(v, 1);
    run(v, g, 4, { ...IDLE, brake: 1 });
    assert.equal(v.up.y < 0.5, over, `${deg} deg: up.y = ${v.up.y.toFixed(2)}`);
  }
});

test('mud: tyres leave ruts, and a spinning tyre digs deeper than a rolling one', () => {
  const g = soft(SURFACE.MUD);
  const v = truck('ranger', g);
  run(v, g, 6, (veh) => ({ ...IDLE, throttle: veh.speed < 2 ? 0.7 : 0 }));
  const track = v.wheels[2];
  const rut = g.grid.get(track.cx, track.cz - 1.5);
  assert.ok(rut > 0.05, `rut depth ${rut.toFixed(3)} m`);
  // nose against a tree, full throttle in 2WD: the rear tyres spin in place and dig
  const g2 = soft(SURFACE.MUD);
  const v2 = truck('ranger', g2);
  v2.dt.setFourWD(false, 0);
  manual(v2, 1);
  const tree = { x: v2.pos.x, y: 0, z: v2.pos.z + 2.5, r: 0.4 };
  g2.treesNear = (x, z, r, out) => { out.length = 0; out.push(tree); return out; };
  run(v2, g2, 1, IDLE);
  const before = [2, 3].map((i) => g2.grid.get(v2.wheels[i].cx, v2.wheels[i].cz));
  run(v2, g2, 3, { ...IDLE, throttle: 1 });
  // torque twist lightens the right rear: with an open diff that is the one that spins (one-wheel peel), digging until
  // it hangs in its hole on the axle's droop (so its spin is measured, not its slip at that instant)
  const spinV = (w) => w.omega * v2.spec.tyre.radius - v2.vel.dot(v2.fwd);
  const spin = v2.wheels[3];
  assert.ok(spinV(spin) > 2, `right rear tyre spinning at ${spinV(spin).toFixed(1)} m/s over the ground`);
  assert.ok(spinV(v2.wheels[2]) < spinV(spin), 'the left rear, with more weight on it, spins less');
  const after = g2.grid.get(spin.cx, spin.cz);
  assert.ok(after > before[1] + 0.08 || after >= 0.35, `dug from ${before[1].toFixed(3)} to ${after.toFixed(3)} m`);
});

test('the winch drags a truck in neutral toward the anchor, and stalls at its rated pull', () => {
  const g = flat(SURFACE.MUD);
  const v = truck('ranger', g);
  manual(v, 0);
  run(v, g, 0.5, IDLE);
  const anchor = v.pos.clone().addScaled(v.fwd, 18);
  assert.equal(v.attachWinch('tree', anchor), true);
  const far = v.pos.clone().addScaled(v.fwd, 80);
  const v3 = truck('ranger', g);
  assert.equal(v3.attachWinch('tree', far), false, 'out of reach');
  const d0 = dist(v.pos, anchor);
  v.winch.motor = 1;
  run(v, g, 12, IDLE);
  assert.ok(d0 - dist(v.pos, anchor) > 2.5, `pulled ${(d0 - dist(v.pos, anchor)).toFixed(2)} m`);
  // against the brakes on dirt it stalls: tension near the stall pull, no more
  const g2 = flat(SURFACE.ROCK);
  const v2 = truck('hauler', g2);
  manual(v2, 1);
  const a2 = v2.pos.clone().addScaled(v2.fwd, 10);
  v2.attachWinch('tree', a2);
  v2.winch.motor = 1;
  let maxT = 0;
  const n = Math.round(10 / PHYS_DT);
  for (let i = 0; i < n; i++) { v2.step({ ...IDLE, brake: 1 }, g2); maxT = Math.max(maxT, v2.winch.tension); }
  assert.ok(maxT < v2.spec.winch.stallPull * 1.25, `peak tension ${maxT.toFixed(0)} N`);
});

test('a truck on its roof can be put back on its wheels', () => {
  const g = slope(55, SURFACE.ROCK, true);
  const v = truck('mule', g);
  run(v, g, 4, IDLE);
  const flatG = flat();
  v.rightSideUp(flatG);
  run(v, flatG, 2, { ...IDLE, handbrake: 1 });
  assert.ok(v.up.y > 0.99 && v.settled, 'upright and settled');
});
