// Behaviour tests for the vehicle physics: each checks something a driver would notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT, GRAVITY } from '../src/physics/Vehicle.js';
import { Drivetrain } from '../src/physics/Drivetrain.js';
import { Quat, clamp } from '../src/physics/math.js';
import { TRUCKS, truckSpec } from '../src/physics/trucks.js';
import { SURFACE, SURFACES } from '../src/physics/Surfaces.js';
import { flat, slope, soft, slopeWithIce, ledge, worn, rough } from './grounds.mjs';
import { HARD_KNOCK } from '../src/game/Events.js';
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

test('in the rain earth and grass are slick (a truck stops in a longer way), mud softer and damp sand firmer', async () => {
  const { WET_SURFACES } = await import('../src/physics/Surfaces.js');
  // (a stock Thar braked hard from 15 m/s on the flat, dry and wet)
  const stop = (surface, wet) => {
    const g = { height: () => 0, surfaceAt: () => (wet ? WET_SURFACES : SURFACES)[surface] }, v = truck('thar', g);
    run(v, g, 0.3);
    v.vel.set(0, 0, 15);
    for (const w of v.wheels) w.omega = 15 / v.spec.tyre.radius;
    // (to where it first stands still: held on the brake after, it would back away)
    const z0 = v.pos.z;
    let at = null;
    run(v, g, 8, (q) => { if (at === null && q.vel.dot(q.fwd) < 0.2) at = q.pos.z - z0; return { ...IDLE, brake: 1 }; });
    assert.ok(at !== null, 'stopped');
    return at;
  };
  for (const [s, name, more] of [[SURFACE.DIRT, 'earth', 1.15], [SURFACE.GRASS, 'grass', 1.25], [SURFACE.ROAD, 'tarmac', 1.15]]) {
    const dry = stop(s, false), wet = stop(s, true);
    assert.ok(wet > dry * more, `${name}: stopped in ${dry.toFixed(1)} m dry, ${wet.toFixed(1)} m wet`);
  }
  // (the ruts a Thar leaves driven 8 s from a standing start in low range, dry and wet)
  const rut = (surface, wet) => {
    const g = soft(surface, 0, 1, wet), v = truck('thar', g);
    v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    run(v, g, 8, (q) => ({ ...IDLE, throttle: clamp((3 - q.vel.dot(q.fwd)) * 0.8 + 0.25, 0, 1) }));
    return g.grid.get(v.wheels[2].cx, v.wheels[2].cz - 2);
  };
  const mudDry = rut(SURFACE.MUD, false), mudWet = rut(SURFACE.MUD, true), sandDry = rut(SURFACE.SAND, false), sandWet = rut(SURFACE.SAND, true);
  assert.ok(mudWet > mudDry * 1.1, `mud ruts ${(mudDry * 100).toFixed(1)} cm dry, ${(mudWet * 100).toFixed(1)} cm wet`);
  assert.ok(sandWet < sandDry * 0.85, `sand ruts ${(sandDry * 100).toFixed(1)} cm dry, ${(sandWet * 100).toFixed(1)} cm damp`);
  // (and a world in the rain hands out the wet grounds, its mud softer)
  const { World } = await import('../src/world/World.js');
  const N = 33, data = { N, res: 1, origin: -16, half: 16, heights: new Float32Array(N * N), surface: new Uint8Array(N * N).fill(SURFACE.MUD), water: new Float32Array(N * N).fill(-1e9), waterN: N, waterRes: 1, trees: [], boulders: [], beacons: [], landmarks: [], posts: [], trails: [], map: { id: 'test' } };
  const w = new World(data), soft0 = w.softness(0, 0);
  w.setWet(0.5);
  const mu = SURFACES[SURFACE.MUD].mu, muWet = WET_SURFACES[SURFACE.MUD].mu, half = w.surfaceAt(0, 0).mu, soft1 = w.softness(0, 0);
  assert.ok(half < mu && half > muWet && soft1 > soft0, `the world part wet as it dries: grip ${half.toFixed(3)} between ${mu} and ${muWet}`);
  w.setWet(1);
  assert.ok(w.surfaceAt(0, 0) === WET_SURFACES[SURFACE.MUD] && w.softness(0, 0) > soft1, 'the world wet through in the rain');
  w.setWet(0);
  assert.ok(w.surfaceAt(0, 0) === SURFACES[SURFACE.MUD] && w.softness(0, 0) === soft0, 'and dry again');
});

test('mud takes time to give: kept moving a truck rides higher than it sinks standing; stopped in a bog it settles in, and pulls away the harder for it', () => {
  // (a stock Thar driven into deep mud at a walk in low range and stopped: the rut it left rolling, how deep it sits
  // standing, and how far it gets in 5 s at 40% throttle after standing 3 s or a minute, then at 70%)
  const into = () => {
    const g = soft(SURFACE.MUD, 0, 2.2), v = truck('thar', g);
    v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    let rolled = null;
    run(v, g, 12, (q) => {
      if (!rolled && q.pos.z > 12) rolled = { x: q.wheels[2].cx, z: q.wheels[2].cz };
      return { ...IDLE, throttle: clamp((2 - q.vel.dot(q.fwd)) * 0.8 + 0.25, 0, 1) };
    });
    run(v, g, 3, { ...IDLE, brake: 1 });
    return { g, v, rut: g.grid.get(rolled.x, rolled.z) };
  };
  const depth = ({ g, v }) => v.wheels.reduce((a, w) => a + g.grid.get(w.cx, w.cz), 0) / 4;
  const pull = ({ g, v }, throttle) => { const z0 = v.pos.z; run(v, g, 5, { ...IDLE, throttle }); return v.pos.z - z0; };
  const brief = into(), long = into();
  run(brief.v, brief.g, 3, { ...IDLE, handbrake: 1 });
  run(long.v, long.g, 60, { ...IDLE, handbrake: 1 });
  const d3 = depth(brief), d60 = depth(long);
  assert.ok(d3 > brief.rut * 1.1 && d60 > d3 * 1.12, `rolled ${(brief.rut * 100).toFixed(1)} cm deep; standing 3 s ${(d3 * 100).toFixed(1)} cm, a minute ${(d60 * 100).toFixed(1)} cm`);
  const after3 = pull(brief, 0.4), after60 = pull(long, 0.4), more = pull(long, 0.7);
  assert.ok(after60 < after3 * 0.6 && more > 5, `at 40% throttle ${after3.toFixed(1)} m after a short stop, ${after60.toFixed(1)} m after a long one; then at 70% ${more.toFixed(1)} m`);
});

test('ruts steer a truck in deep mud: in its own it holds them against a little steering, and leaves them with more', () => {
  // (driven 6 s straight through deep mud, put back where it set off and driven again, steering right: how far it
  // strays, against the same on fresh mud)
  // (in deep mud a truck wallows: each from three starts a centimetre apart, the mean)
  const go = (steer, rutted) => {
    let sum = 0;
    for (const dx of [0, 0.01, 0.02]) {
      const g = soft(SURFACE.MUD, 0, 2.2);
      const start = () => { const v = truck('ranger', g, dx); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0); run(v, g, 0.5); return v; };
      let v = start();
      if (rutted) { run(v, g, 6, { ...IDLE, throttle: 0.7 }); v = start(); }
      run(v, g, 6, { ...IDLE, throttle: 0.7, steer });
      sum += Math.abs(v.pos.x - dx) / 3;
    }
    return sum;
  };
  const held = go(0.15, true), free = go(0.15, false), out = go(0.6, true);
  assert.ok(held < 1 && held < free * 0.45, `a little steering: ${held.toFixed(2)} m off its ruts, ${free.toFixed(2)} m on fresh mud`);
  assert.ok(out > 3, `full steering climbs out of them: ${out.toFixed(2)} m`);
});

test('a tread packs with sticky mud crawling through it and grips the less (an all-terrain more than a mud-terrain); spun up, it flings it out', () => {
  // (a stock all-terrain truck crawling 12 s through deep mud, against the same with clogging off and on mud-terrains)
  const crawl = (tyre) => {
    const spec = { ...truckSpec('thar') };
    spec.tyre = { ...spec.tyre, ...tyre };
    const g = soft(SURFACE.MUD, 0, 2.2), v = new Vehicle(spec);
    v.place(g, 0, 0, 0); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    run(v, g, 0.5, IDLE);
    run(v, g, 12, { ...IDLE, throttle: 0.5 });
    return { v, g, clog: v.wheels.reduce((a, w) => a + w.clog, 0) / 4, mu: v.wheels.reduce((a, w) => a + w.mu, 0) / 4 };
  };
  const at = crawl({}), clean = crawl({ clogLoss: 0 }), mt = crawl({ clogLoss: 0.08, cleanSpeed: 2.6 });
  assert.ok(at.clog > 0.8 && mt.clog < at.clog - 0.2, `packed: all-terrain ${at.clog.toFixed(2)}, mud-terrain ${mt.clog.toFixed(2)}`);
  assert.ok(at.mu < clean.mu * 0.9, `grip: ${at.mu.toFixed(3)} packed, ${clean.mu.toFixed(3)} with the tread clean`);
  // floored: the tread spun up flings the mud out
  run(at.v, at.g, 3, { ...IDLE, throttle: 1 });
  const after = at.v.wheels.reduce((a, w) => a + w.clog, 0) / 4;
  assert.ok(after < at.clog - 0.3, `spun up: ${at.clog.toFixed(2)} -> ${after.toFixed(2)}`);
});

test('in ruts deeper than its clearance a truck\'s diffs plough a groove through the mud hump between them', () => {
  // (ruts 35 cm deep in deep mud where its wheels run, the mud between them as it was: the diffs, 22 cm up, meet it)
  const track = truckSpec('thar').axles[0].track, D = 0.35;
  const rutsAt = (x) => { const r = Math.min(Math.abs(x - track / 2), Math.abs(x + track / 2)); return r < 0.25 ? D : r < 0.4 ? D * (0.4 - r) / 0.15 : 0; };
  const g = soft(SURFACE.MUD, 0, 2.2);
  for (let z = -6; z <= 50; z += 0.1) for (let x = -1.4; x <= 1.4; x += 0.05) { const d = rutsAt(x); if (d > 0) g.grid.stamp(x, z, 0, 1, 0.03, 0.06, d, 0, () => 0.6); }
  const v = truck('thar', g);
  v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  run(v, g, 1, IDLE);
  const z0 = v.pos.z;
  run(v, g, 10, { ...IDLE, throttle: 0.6 });
  // (the groove down the middle where it has been, the rear diff's line)
  let groove = 0;
  for (let z = z0 + 2; z < v.pos.z - 4; z += 0.5) groove += g.grid.get(0, z) / Math.round((v.pos.z - z0 - 6) / 0.5);
  assert.ok(v.pos.z - z0 > 25 && groove > 0.04, `${(v.pos.z - z0).toFixed(1)} m on, the hump ploughed ${(groove * 100).toFixed(1)} cm down`);
});

test('a rough track: its deep ruts, holes on alternate sides and roots crawled over clean, hammered over at speed', () => {
  // (a stock Thar down 250 m of it on firm earth, held to a speed: the times it strikes the ground hard)
  const g = rough(SURFACE.DIRT);
  const strikes = (target, low) => {
    const v = truck('thar', g);
    v.dt.setFourWD(true, 0); v.dt.setRange(low, 0);
    let t = 0, last = -9, n = 0;
    run(v, g, 150, (q) => {
      t += PHYS_DT;
      if (q.knock > HARD_KNOCK && t - last > 1) { last = t; n++; }
      const sp = q.vel.dot(q.fwd), head = Math.atan2(q.fwd.x, q.fwd.z);
      if (q.pos.z > 250) return { ...IDLE, brake: 1 };
      return { ...IDLE, throttle: clamp((target - sp) * 0.6 + 0.3, 0, 1), brake: sp > target + 1 ? 0.3 : 0, steer: clamp((head + q.pos.x * 0.15) * 2, -1, 1) };
    });
    return { n, z: v.pos.z };
  };
  const crawl = strikes(2, true), fast = strikes(14, false);
  assert.ok(crawl.z > 240 && fast.z > 240, `both got through: ${crawl.z.toFixed(0)} m, ${fast.z.toFixed(0)} m`);
  assert.ok(crawl.n <= 1 && fast.n >= 4, `hard strikes: ${crawl.n} at a crawl, ${fast.n} at speed`);
});

test("the rain in a rough track's holes: crawled through, a tyre down in one is in water, and the truck still crawls on", () => {
  // (a stock Thar crawled 150 m of it in low range, as above, with the rain standing in its holes: at most 30 cm of
  // it over the floor, a little more over the bottom of a tyre squashed under the truck's weight)
  const g = rough(SURFACE.DIRT, 1, true), v = truck('thar', g);
  v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  let wetT = 0, deepest = 0;
  run(v, g, 110, (q) => {
    if (q.wheels.some((w) => w.water > 0.03)) wetT += PHYS_DT;
    for (const w of q.wheels) deepest = Math.max(deepest, w.water);
    const sp = q.vel.dot(q.fwd), head = Math.atan2(q.fwd.x, q.fwd.z);
    if (q.pos.z > 150) return { ...IDLE, brake: 1 };
    return { ...IDLE, throttle: clamp((2 - sp) * 0.6 + 0.3, 0, 1), brake: sp > 3 ? 0.3 : 0, steer: clamp((head + q.pos.x * 0.15) * 2, -1, 1) };
  });
  assert.ok(v.pos.z > 145, `crawled ${v.pos.z.toFixed(0)} m`);
  assert.ok(wetT > 3 && deepest > 0.08 && deepest < 0.4, `a tyre in water ${wetT.toFixed(1)} s, at most ${(deepest * 100).toFixed(0)} cm deep`);
});

test('a tyre spun on the spot digs itself into earth, less into grass; rolling on, it leaves the ground alone', () => {
  // (held where it stands, floored in low range: the four tyres spin; then let go, and a truck driven across it)
  const spun = (surface) => {
    const g = soft(surface), v = truck('thar', g);
    v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
    run(v, g, 0.5, IDLE);
    const x = v.pos.x, z = v.pos.z;
    run(v, g, 6, () => { v.pos.x = x; v.pos.z = z; v.vel.x = 0; v.vel.z = 0; return { ...IDLE, throttle: 1 }; });
    return { g, v, z, dug: v.wheels.reduce((a, w) => a + g.grid.get(w.cx, w.cz), 0) / 4 };
  };
  const dirt = spun(SURFACE.DIRT), grass = spun(SURFACE.GRASS);
  assert.ok(dirt.dug > 0.02 && dirt.dug <= SURFACES[SURFACE.DIRT].loose + 1e-6, `earth: dug ${dirt.dug.toFixed(3)} m`);
  assert.ok(grass.dug > 0.004 && grass.dug < dirt.dug * 0.6, `grass: dug ${grass.dug.toFixed(3)} m (earth ${dirt.dug.toFixed(3)})`);
  // let go, it drives up out of its holes
  run(dirt.v, dirt.g, 4, { ...IDLE, throttle: 0.4 });
  assert.ok(dirt.v.pos.z - dirt.z > 5, `drove out: ${(dirt.v.pos.z - dirt.z).toFixed(1)} m`);
  // driven across earth, pulling away and at speed, the tyres roll on before they dig
  const g = soft(SURFACE.DIRT), v = truck('thar', g);
  run(v, g, 8, { ...IDLE, throttle: 1 });
  let deepest = 0;
  for (const c of g.grid.chunks.values()) for (const d of c) deepest = Math.max(deepest, d);
  assert.ok(v.speed > 15 && deepest < 0.005, `${v.speed.toFixed(1)} m/s, deepest ${deepest.toFixed(4)} m`);
});

test('a worn track\'s ruts steer a truck on firm ground: at speed a nudge of the wheel leaves it in them, at a crawl a firm turn climbs out', () => {
  const at = (g, steer, speed, hold, s) => {
    const v = truck('thar', g);
    const drive = (t, steer) => {
      for (let i = 0; i < Math.round(t / PHYS_DT); i++) {
        const sp = v.vel.dot(v.fwd);
        v.step({ ...IDLE, throttle: clamp((speed - sp) * 0.8 + hold, 0, 1), steer }, g);
      }
    };
    drive(speed > 10 ? 14 : 4, 0);
    const x0 = v.pos.x;
    drive(s, steer); drive(3, 0);
    return Math.abs(v.pos.x - x0);
  };
  // (72 km/h, the wheel nudged for 0.6 s and let go: on flat dirt the truck is off on a new line)
  const nudged = at(worn(0.12), 0.04, 20, 0.3, 0.6), nudgedFlat = at(worn(0), 0.04, 20, 0.3, 0.6);
  assert.ok(nudged < 0.2 && nudgedFlat > 1, `nudged at speed: ${nudged.toFixed(2)} m off its ruts, ${nudgedFlat.toFixed(2)} m on flat dirt`);
  // (3 m/s, a firm turn for 4 s: out of them and away, much as on flat dirt)
  const turned = at(worn(0.12), 0.35, 3, 0.3, 4), turnedFlat = at(worn(0), 0.35, 3, 0.3, 4);
  assert.ok(turned > 0.8 * turnedFlat, `a firm turn at a crawl: ${turned.toFixed(2)} m, ${turnedFlat.toFixed(2)} m on flat dirt`);
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
