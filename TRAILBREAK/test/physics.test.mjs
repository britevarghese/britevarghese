// Behaviour tests for the vehicle physics: each checks something a driver would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT, GRAVITY } from '../src/physics/Vehicle.js';
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
  // torque twist lightens the right rear: with an open diff that is the one that spins (one-wheel peel)
  const spin = v2.wheels[3];
  assert.ok(spin.slipSpeed > 2, `right rear tyre slipping at ${spin.slipSpeed.toFixed(1)} m/s`);
  assert.ok(v2.wheels[2].slipSpeed < spin.slipSpeed, 'the left rear, with more weight on it, spins less');
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
