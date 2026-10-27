// Behaviour tests for the vehicle physics: each checks something a driver would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT, GRAVITY } from '../src/physics/Vehicle.js';
import { Drivetrain } from '../src/physics/Drivetrain.js';
import { Quat, clamp } from '../src/physics/math.js';
import { TRUCKS, truckSpec } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { flat, slope, soft, slopeWithIce, ledge } from './grounds.mjs';
import { keysBend } from './drive.mjs';

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
  const v = truck('hauler', g);
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
  const v = truck('mule', g);
  v.dt.setRange(true, 0);
  run(v, g, 12, { ...IDLE, throttle: 1 });
  const kmh = v.speed * 3.6;
  // the Willys's 1.97:1 low range in top gear: 4200 rpm limiter / (1.0 * 1.97 * 4.88) on 28" tyres -> ~60 km/h, and it
  // gets there slowly
  assert.ok(kmh > 25 && kmh < 62, `low range speed after 12 s: ${kmh.toFixed(1)} km/h`);
});

test('ABS: braking hard, a truck still steers, and a straight stop runs straight (all four brakes working)', () => {
  for (const id of ['thar', 'shepherd', 'mule']) {
    const cruise = (brake, steer) => {
      const g = flat(SURFACE.ROAD), v = truck(id, g);
      run(v, g, 0.3);
      v.vel.set(0, 0, 80 / 3.6);
      for (const w of v.wheels) w.omega = 80 / 3.6 / v.spec.tyre.radius;
      run(v, g, 2, { ...IDLE, throttle: 0.25 });
      const h0 = Math.atan2(v.fwd.x, v.fwd.z);
      let locked = 0, n = 0;
      run(v, g, 1.5, (w) => {
        // (a front wheel on the ground, at speed: one lifted off it in the turn stops, as it would)
        if (w.speed > 8) for (const wh of w.wheels.slice(0, 2)) if (wh.contact && wh.N > 500) { n++; if (Math.abs(wh.omega * w.spec.tyre.radius) < 0.2 * w.speed) locked++; }
        return { ...IDLE, brake, steer };
      });
      return { turned: Math.abs(Math.atan2(v.fwd.x, v.fwd.z) - h0) * 180 / Math.PI, locked: locked / Math.max(1, n) };
    };
    const straight = cruise(1, 0), turning = cruise(1, 0.6);
    assert.ok(straight.turned < 1, `${id}: a straight stop pulled ${straight.turned.toFixed(1)} deg`);
    assert.ok(turning.turned > 20 && turning.locked < 0.2, `${id}: braking and steering turned ${turning.turned.toFixed(1)} deg, the fronts locked ${(turning.locked * 100).toFixed(0)}% of the time`);
  }
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

test('the handbrake holds the truck: on a 30 degree slope in 2WD, and with the throttle on (which revs the engine); rolling, it locks the rear wheels and stops it', () => {
  for (const id of ['thar', 'hummer']) {
    const g = slope(30, SURFACE.DIRT);
    const v = truck(id, g);
    v.dt.fourWD = false;
    run(v, g, 1.5, { ...IDLE, handbrake: 1 });
    const p0 = v.pos.clone();
    run(v, g, 5, { ...IDLE, handbrake: 1, throttle: 0.6 });
    assert.ok(dist(v.pos, p0) < 0.05, `${id} moved ${dist(v.pos, p0).toFixed(2)} m`);
    // (the clutch held down: the throttle revs the engine, the drive stays off)
    assert.ok(v.dt.rpm > 2.5 * v.spec.engine.idleRpm, `${id} revs only to ${Math.round(v.dt.rpm)} rpm on the handbrake`);
    // from 54 km/h on the flat: rolling, it is the rear wheels' brake alone (locked, sliding: the start of a drift),
    // about a third of a g, as a driver's pulled lever is; then every brake once the truck is down to a walk
    const f = flat(), w = truck(id, f);
    run(w, f, 1, { ...IDLE, handbrake: 1 });
    w.vel.set(w.fwd.x * 15, 0, w.fwd.z * 15);
    for (const wh of w.wheels) wh.omega = 15 / w.spec.tyre.radius;
    run(w, f, 1, { ...IDLE, handbrake: 1 });
    assert.ok(Math.abs(w.wheels[2].omega) < 0.5 && Math.abs(w.wheels[0].omega) > 20, `${id}: rear wheels ${w.wheels[2].omega.toFixed(1)}, fronts ${w.wheels[0].omega.toFixed(1)} rad/s on the handbrake`);
    run(w, f, 5, { ...IDLE, handbrake: 1 });
    assert.ok(w.speed < 0.1, `${id} still at ${w.speed.toFixed(2)} m/s after 6 s`);
  }
});

test('a handbrake turn on the keys: the tail steps out in 2WD and 4WD, the speed is kept, and caught it holds a drift', () => {
  for (const [id, fourWD] of [['thar', false], ['thar', true], ['shepherd', true], ['m4csl', false]]) {
    const g = flat(id === 'm4csl' ? SURFACE.ROAD : SURFACE.DIRT), v = truck(id, g);
    run(v, g, 1, { ...IDLE, handbrake: 1 });
    v.dt.setFourWD(fourWD, 0);
    const sp = (id === 'm4csl' ? 70 : 50) / 3.6, d = v.dt;                    // (the road car's sticky tyres: faster)
    v.vel.set(v.fwd.x * sp, 0, v.fwd.z * sp);
    for (const w of v.wheels) w.omega = sp / v.spec.tyre.radius;
    d.gear = 2; d.wEngine = sp / v.spec.tyre.radius * d.axleGear * d.t.gears[1];
    // (the body's angle to the way it is going, deg)
    const slip = () => Math.abs(Math.atan2(v.vel.dot(v.right), v.vel.dot(v.fwd))) * 180 / Math.PI;
    run(v, g, 0.3, { ...IDLE, steer: 1, throttle: 0.2 });
    let t = 0;
    while (t < 1.5 && slip() < 22) { run(v, g, 0.02, { ...IDLE, steer: 1, handbrake: 1 }); t += 0.02; }
    assert.ok(slip() >= 22, `${id} ${fourWD ? '4WD' : '2WD'}: the tail only ${slip().toFixed(0)} deg out on the handbrake`);
    assert.ok(v.speed > 0.6 * sp, `${id}: down to ${(v.speed * 3.6).toFixed(0)} km/h by the time the tail is out`);
    // a driver catching it: countersteer and throttle by how far out it is
    let worst = 0, held = 0;
    for (let k = 0; k < 150; k++) {
      const a = slip();
      run(v, g, 0.02, { ...IDLE, steer: clamp(-(a - 22) / 12, -1, 1), throttle: clamp(0.8 - (a - 20) / 25, 0.1, 0.8) });
      worst = Math.max(worst, slip()); if (slip() > 10 && slip() < 50) held += 0.02;
    }
    assert.ok(worst < 85, `${id} ${fourWD ? '4WD' : '2WD'}: spun round (${worst.toFixed(0)} deg)`);
    assert.ok(held > 0.7, `${id} ${fourWD ? '4WD' : '2WD'}: drifting only ${held.toFixed(1)} s of 3`);
  }
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

test('stability control: floored round a full-lock bend on the keys, a truck circles at its grip instead of spinning or crawling', () => {
  // (on tarmac the tyres grip at a small slip angle: at full lock the truck circles tight, about 8.5 m, so slower)
  for (const [id, surf, kmh, g] of [['hummerev', SURFACE.ROAD, 22, 0.5], ['hummerev', SURFACE.GRASS, 22, 0.38], ['bronco', SURFACE.DIRT, 45, 0.45], ['thar', SURFACE.GRASS, 35, 0.35]]) {
    const ground = flat(surf), v = truck(id, ground);
    run(v, ground, 0.5);
    v.vel.set(0, 0, 25 / 3.6);
    let slide = 0, sp = 0, ay = 0, n = 0, i = 0;
    const N = Math.round(5 / PHYS_DT);
    run(v, ground, 5, (w) => {
      const s = Math.hypot(w.vel.x, w.vel.z);
      if (s > 3) slide = Math.max(slide, Math.abs(Math.atan2(w.vel.dot(w.right), w.vel.dot(w.fwd))));
      if (i++ > N - 2 / PHYS_DT) { sp += s; ay += s * Math.abs(w.angVel.y); n++; }
      return { ...IDLE, throttle: 1, steer: 1 };
    });
    const at = `${id} on ${Object.keys(SURFACE).find((k) => SURFACE[k] === surf)}`;
    assert.ok(slide * 180 / Math.PI < 16, `${at}: slid ${(slide * 180 / Math.PI).toFixed(1)} degrees`);
    assert.ok(sp / n * 3.6 > kmh, `${at}: circling at ${(sp / n * 3.6).toFixed(0)} km/h`);
    assert.ok(ay / n / GRAVITY > g, `${at}: ${(ay / n / GRAVITY).toFixed(2)} g round the bend`);
  }
});

test('turning on the keys at speed uses the tyres\' grip: at 30 and 45 km/h on the road a truck turns well inside the old circles', () => {
  const road = flat(SURFACE.ROAD);
  const circle = (id, kmh) => {
    const v = truck(id, road);
    run(v, road, 0.5);
    const vt = kmh / 3.6;
    v.vel.set(0, 0, vt);
    let R = 0, n = 0, i = 0;
    const N = Math.round(8 / PHYS_DT);
    run(v, road, 8, (w) => {
      if (i++ > N - 3 / PHYS_DT) { R += Math.hypot(w.vel.x, w.vel.z) / Math.max(1e-3, Math.abs(w.angVel.y)); n++; }
      const e = vt - w.vel.dot(w.fwd);
      return { ...IDLE, throttle: Math.max(0, Math.min(1, 0.2 + e * 0.6)), brake: Math.max(0, Math.min(1, -e * 0.4)), steer: 1 };
    });
    return R / n;
  };
  for (const [id, r30, r45] of [['bronco', 12, 27], ['thar', 12, 27], ['hummerev', 12.5, 28]]) {
    const a = circle(id, 30), b = circle(id, 45);
    assert.ok(a < r30, `${id} at 30 km/h: a ${a.toFixed(1)} m circle`);
    assert.ok(b < r45, `${id} at 45 km/h: a ${b.toFixed(1)} m circle`);
  }
});

test('a steering wheel with the assist on: nudged a tenth of its travel at 90 km/h it turns the car gently, not round; at walking pace it still has the whole lock', () => {
  const road = flat(SURFACE.ROAD);
  const nudge = (id, ctrl) => {
    const v = truck(id, road);
    v.dt.setFourWD(false, 0);
    v.vel.set(0, 0, 25); for (const w of v.wheels) w.omega = 25 / v.spec.tyre.radius;
    let yaw = 0;
    run(v, road, 1.5, (w) => { yaw = Math.max(yaw, Math.abs(w.angVel.y)); return { ...IDLE, throttle: 0.3, steer: 0.1, ...ctrl }; });
    return { yaw, up: v.up.y };
  };
  for (const id of ['thar', 'm4csl']) {
    const raw = nudge(id, { analogSteer: true }), held = nudge(id, { wheelAssist: true });
    assert.ok(raw.yaw > 0.6, `${id}: raw, the nudge spins it (${(raw.yaw * 57.3).toFixed(0)} deg/s)`);
    assert.ok(held.yaw < 0.35 && held.yaw < raw.yaw / 3 && held.up > 0.95, `${id}: with the assist, ${(held.yaw * 57.3).toFixed(0)} deg/s`);
    const v = truck(id, road);
    v.vel.set(0, 0, 2);
    run(v, road, 1, { ...IDLE, throttle: 0.2, steer: 1, wheelAssist: true });
    assert.ok(Math.abs(v.steerAngle) > 0.95 * v.spec.axles[0].steer, `${id}: full lock crawling (${v.steerAngle.toFixed(3)} rad)`);
  }
});

test('on grass at speed the keys turn a truck at its grip, its path following the wheels instead of crabbing wide', () => {
  const grass = flat(SURFACE.GRASS);
  for (const id of ['shepherd', 'thar', 'bronco']) for (const kmh of [60, 100]) {
    const v = truck(id, grass);
    run(v, grass, 0.5, { ...IDLE, handbrake: 1 });
    const r = keysBend(v, grass, kmh);
    assert.ok(r.g > 0.44, `${id} at ${kmh} km/h on grass: ${r.g.toFixed(2)} g round the bend`);
    assert.ok(r.slip * 180 / Math.PI < 6, `${id} at ${kmh} km/h on grass: pointing ${(r.slip * 180 / Math.PI).toFixed(1)} degrees inside its path`);
  }
});

test('the steering assist keeps tall, narrow trucks on their wheels: full lock snapped on at 60 and 80 km/h, on and off the power', () => {
  for (const id of ['rhino', 'mule', 'shepherd', 'thar']) {
    for (const surf of [SURFACE.ROAD, SURFACE.DIRT]) for (const kmh of [60, 80]) for (const throttle of [0.6, 0]) {
      const ground = flat(surf), v = truck(id, ground);
      run(v, ground, 0.3);
      v.vel.set(0, 0, kmh / 3.6);
      let up = 1;
      run(v, ground, 5, (w) => { up = Math.min(up, w.up.y); return { ...IDLE, throttle, steer: 1 }; });
      assert.ok(up > 0.5, `${id} at ${kmh} km/h on ${surf === SURFACE.ROAD ? 'the road' : 'dirt'}${throttle ? '' : ', off the power'}: tipped to up.y ${up.toFixed(2)}`);
    }
  }
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

// the suspension as a car tester measures it: how it bounces, how far the body leans in a turn and dives under the
// brakes, against real trucks (1 to 2 Hz, damped to a quarter or so of critical; 5 to 8.5 degrees of lean per g for a
// 4x4, under 4.5 for a sports car; 2 to 4 degrees of dive at 0.8 g, less than the springs alone would let it)
const ROAD = { height: () => 0, surfaceAt: () => flat(SURFACE.ROAD).surfaceAt() };
function bounce(id) {
  const v = truck(id, ROAD);
  run(v, ROAD, 2, { ...IDLE, brake: 1, handbrake: 1 });
  const y0 = v.pos.y, ys = [];
  v.pos.y -= 0.06; v.vel.set(0, 0, 0);
  for (let i = 0; i < 3 / PHYS_DT; i++) { v.step({ ...IDLE, brake: 1, handbrake: 1 }, ROAD); ys.push(v.pos.y - y0); }
  // (the first overshoot above where it sits and the swing below after it: half a period, and how much it dies away)
  const ext = [];
  for (let i = 1; i < ys.length - 1; i++) if ((ys[i] - ys[i - 1]) * (ys[i + 1] - ys[i]) < 0 && Math.abs(ys[i]) > 5e-4) ext.push([i, ys[i]]);
  const k = ext.findIndex(([, y]) => y > 0), [a, b] = [ext[k], ext[k + 1]];
  const hz = 1 / (2 * (b[0] - a[0]) * PHYS_DT), dec = 2 * Math.log(Math.abs(a[1] / b[1]));
  return { hz, zeta: dec / Math.sqrt(4 * Math.PI ** 2 + dec * dec) };
}
function leanPerG(id) {
  const v = truck(id, ROAD);
  run(v, ROAD, 15, (t) => (t.speed < 45 / 3.6 ? { ...IDLE, throttle: 0.7 } : IDLE));
  let steer = 0, lat = 0, roll = 0, n = 0;
  for (let i = 0; i < 8 / PHYS_DT; i++) {
    const ay = v.speed * v.angVel.y;
    steer = clamp(steer + (0.4 * GRAVITY - Math.abs(ay) > 0 ? 1 : -1) * 0.0003, 0, 1);
    v.step({ ...IDLE, throttle: v.speed < 45 / 3.6 ? 0.5 : 0.15, steer }, ROAD);
    if (i > 5 / PHYS_DT) { lat += Math.abs(ay); roll += Math.abs(Math.asin(v.left.y)); n++; }
  }
  return (roll / n * 180 / Math.PI) / (lat / n / GRAVITY);
}
function dive(spec) {
  const v = new Vehicle(spec); v.place(ROAD, 0, 0, 0);
  run(v, ROAD, 20, (t) => (t.speed < 80 / 3.6 ? { ...IDLE, throttle: 1 } : { ...IDLE, throttle: 0.3 }));
  const p0 = Math.asin(v.fwd.y);
  let sum = 0, n = 0;
  for (let i = 0; i < 1 / PHYS_DT; i++) { v.step({ ...IDLE, brake: 0.7 }, ROAD); if (i > 0.4 / PHYS_DT) { sum += p0 - Math.asin(v.fwd.y); n++; } }
  return sum / n * 180 / Math.PI;
}

test('the suspension rides, leans and dives as a real truck\'s does (and a sports car\'s as one)', () => {
  for (const id of ['thar', 'wrangler', 'gclass', 'hummer']) {
    const { hz, zeta } = bounce(id), lean = leanPerG(id), d = dive(truckSpec(id));
    assert.ok(hz > 0.9 && hz < 2 && zeta > 0.15 && zeta < 0.6, `${id}: bounces at ${hz.toFixed(2)} Hz, damped ${zeta.toFixed(2)}`);
    assert.ok(lean > 5 && lean < 8.6, `${id}: leans ${lean.toFixed(1)} degrees per g`);
    assert.ok(d > 1.5 && d < 4, `${id}: dives ${d.toFixed(1)} degrees braking`);
    // (the links take some of the dive: with none of them angled, more)
    const flatLinks = structuredClone(truckSpec(id)); for (const a of flatLinks.axles) a.anti = 0;
    assert.ok(dive(flatLinks) > d + 0.2, `${id}: anti-dive`);
  }
  for (const id of ['m4csl', 'r35']) {
    const { hz } = bounce(id), lean = leanPerG(id);
    assert.ok(hz > 1.5 && hz < 2.8 && lean > 1.2 && lean < 4.5, `${id}: ${hz.toFixed(2)} Hz, ${lean.toFixed(1)} degrees per g`);
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
  // torque twist lightens the right rear: with an open diff that is the one that spins (one-wheel peel), digging until
  // it hangs in its hole on the axle's droop (so its spin is measured, not its slip at that instant)
  const spinV = (w) => w.omega * v2.spec.tyre.radius - v2.vel.dot(v2.fwd);
  const spin = v2.wheels[3];
  assert.ok(spinV(spin) > 2, `right rear tyre spinning at ${spinV(spin).toFixed(1)} m/s over the ground`);
  assert.ok(spinV(v2.wheels[2]) < spinV(spin), 'the left rear, with more weight on it, spins less');
  const after = g2.grid.get(spin.cx, spin.cz);
  assert.ok(after > before[1] + 0.08 || after >= 0.35, `dug from ${before[1].toFixed(3)} to ${after.toFixed(3)} m`);
});

test('deep mud (a map\'s deepMud, the taiga\'s): the tyres sink about twice as deep, and the truck wallows through slower', () => {
  // (from a standing start, flat out in low range: in it a stock UAZ at part throttle in high range sits in its holes)
  const go = (softness) => {
    const g = soft(SURFACE.MUD, 0, softness), v = truck('ranger', g), z0 = v.pos.z;
    v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    run(v, g, 10, { ...IDLE, throttle: 1 });
    const w = v.wheels[2];
    return { rut: g.grid.get(w.cx, w.cz - 1.5), went: v.pos.z - z0 };
  };
  const firm = go(1), deep = go(2.2);
  assert.ok(deep.rut > firm.rut * 1.6, `ruts ${firm.rut.toFixed(3)} m, deep ${deep.rut.toFixed(3)} m`);
  assert.ok(deep.went < firm.went * 0.9 && deep.went > 5, `went ${firm.went.toFixed(1)} m, deep ${deep.went.toFixed(1)} m`);
});

test('ruts steer a truck in deep mud: in its own it holds them against a little steering, and leaves them with more', () => {
  // (driven 6 s straight through deep mud, put back where it set off and driven again, steering right: how far it
  // strays, against the same on fresh mud)
  const go = (steer, rutted) => {
    const g = soft(SURFACE.MUD, 0, 2.2);
    const start = () => { const v = truck('ranger', g); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0); run(v, g, 0.5); return v; };
    let v = start();
    if (rutted) { run(v, g, 6, { ...IDLE, throttle: 0.7 }); v = start(); }
    run(v, g, 6, { ...IDLE, throttle: 0.7, steer });
    return Math.abs(v.pos.x);
  };
  const held = go(0.15, true), free = go(0.15, false), out = go(0.6, true);
  assert.ok(held < 0.6 && free > held + 0.6, `a little steering: ${held.toFixed(2)} m off its ruts, ${free.toFixed(2)} m on fresh mud`);
  assert.ok(out > 3, `full steering climbs out of them: ${out.toFixed(2)} m`);
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

test('a friend winches a truck in over a laggy link: it comes at the winch\'s pace, the rope stays taut, the friend stays put', () => {
  // as core/Game.js wires it: each sees the other's truck (and the rope's length) a moment late, 20 times a second,
  // and brings it on to now along its velocity; the pulled truck works out the rope's pull from where it is
  const g = flat(), age = 0.08 + 0.12, rate = 20;
  const B = truck('thar', g, 0, 0, 0, '00000000010000'), A = truck('thar', g, 0, 16, Math.PI);
  run(B, g, 1, { ...IDLE, handbrake: 1 }); run(A, g, 1);
  const hook = A.winch.fairlead.clone();
  const world = (s, p) => p.clone().applyQuat(s.q).add(s.p);
  const mix = (a, b, k) => a.clone().scale(1 - k).addScaled(b, k);
  const snap = (v, w) => ({ p: v.pos.clone(), q: new Quat().copy(v.quat), vel: v.vel.clone(), w });
  const seen = (h, t) => {
    const tt = t - age;
    let i = h.length - 1;
    while (i > 0 && h[i].t > tt) i--;
    const a = h[i], b = h[i + 1] || a, k = b === a ? 0 : Math.min(1, Math.max(0, (tt - a.t) / (b.t - a.t)));
    const s = { p: mix(a.s.p, b.s.p, k), q: k < 0.5 ? a.s.q : b.s.q, vel: mix(a.s.vel, b.s.vel, k), w: b.s.w };
    if (a.s.w && b.s.w) { s.len = a.s.w.len + (b.s.w.len - a.s.w.len) * k; s.rate = b.s.w.rate; }
    return s;
  };
  B.attachWinch('truck', world(snap(A), hook), 1, hook);
  const hA = [], hB = [], z0 = A.pos.z;
  let t = 0, top = 0, slack = 0, taut = false;
  for (let i = 0, n = Math.round(14 / PHYS_DT); i < n; i++) {
    t += PHYS_DT;
    if (i % Math.round(1 / (rate * PHYS_DT)) === 0) { hA.push({ t, s: snap(A) }); hB.push({ t, s: snap(B, { len: B.winch.len, rate: B.winch.rate }) }); }
    const a = seen(hA, t), b = seen(hB, t);
    B.winch.anchor.copy(world(a, hook).addScaled(a.vel, age)); B.winch.anchorVel = a.vel; B.winch.motor = 1;
    A.pulls = [{ local: hook, target: world(b, B.winch.fairlead).addScaled(b.vel, age), targetVel: b.vel, len: Math.max(0.6, (b.len ?? B.winch.len) + (b.rate || 0) * age), rope: B.spec.winch }];
    A.step(IDLE, g); B.step({ ...IDLE, hold: 0.8 }, g);
    top = Math.max(top, -A.vel.z);
    const felt = A.pulls[0].felt;
    if (t > 2) { if (taut && felt === 0) slack++; taut = felt > 300; }
  }
  const pace = B.spec.winch.lineSpeed;
  assert.ok(z0 - A.pos.z > 4, `came in ${(z0 - A.pos.z).toFixed(1)} m`);
  assert.ok(top < pace * 1.6, `top speed ${top.toFixed(2)} m/s against a line speed of ${pace} m/s`);
  assert.ok(slack <= 2, `the rope went slack ${slack} times`);
  assert.ok(Math.abs(B.pos.z) < 0.3, `the friend's truck moved ${B.pos.z.toFixed(2)} m`);
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
