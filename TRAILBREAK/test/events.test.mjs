// Events and the career: the run's clock and gates, medals and prize money, races, the wallet; and the valley's trails
// and courses checked for what a stock truck can drive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventRun, medalFor, runPrize, standings, eventsFor, gridFor, MEDAL_PRIZE, FINISH_PRIZE, RACE_PRIZE, TOUCH_PENALTY, TIME_LIMIT } from '../src/game/Events.js';
import { Career, START_MONEY, DEBT_LIMIT, TRUCK_PRICES } from '../src/game/Career.js';
import { generateWorld } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec, TRUCKS } from '../src/physics/trucks.js';
import { stockBuild } from '../src/physics/Upgrades.js';

const P = (x, z, y = 0) => ({ x, y, z });
const course = {
  id: 'test', par: { gold: 10, silver: 15, bronze: 20 }, prize: 2,
  gates: [{ x: 0, z: 10, r: 3 }, { x: 0, z: 30, r: 5, dir: [0, 1] }],
};

test('a run: countdown, then the gates in order (a point within r, a line crossed), then the finish', () => {
  const run = new EventRun(course, 3);
  assert.equal(run.update(1, P(0, 10)), null, 'counting down: nothing counts');
  assert.equal(run.phase, 'countdown');
  assert.equal(run.update(3.5, P(0, 30)), null, 'the finish line before gate 1 is not a finish');
  assert.equal(run.update(4, P(4, 10)), null, 'missed gate 1 by a metre');
  assert.equal(run.update(5, P(2, 10)), 'gate');
  assert.equal(run.update(6, P(0, 29)), null, 'short of the line');
  assert.equal(run.update(7, P(6, 30.2)), null, 'over the line but wide of it');
  assert.equal(run.update(8, P(-4, 30.5)), 'finish');
  assert.equal(run.phase, 'finished');
  assert.equal(run.time, 5);
  assert.deepEqual(run.splits, [2, 5]);
});

test('a run: hard knocks of the body cost seconds in the trials (one per second at most); too long and it is over', () => {
  const run = new EventRun({ ...course, touch: true }, 0);
  run.update(0.5, P(0, 0));
  assert.equal(run.update(1, P(0, 0), 2), 'touch');
  assert.equal(run.update(1.5, P(0, 0), 3), null, 'the same knock');
  assert.equal(run.update(2.2, P(0, 0), 3), 'touch');
  assert.equal(run.penalty, 2 * TOUCH_PENALTY);
  assert.equal(run.update(3, P(0, 0), 0.5), null, 'a scrape is free');
  assert.ok(Math.abs(run.time - (3 + 2 * TOUCH_PENALTY)) < 1e-9);
  assert.equal(new EventRun(course, 0).update(TIME_LIMIT + 1, P(0, 0)), 'timeout');
});

test('medals and prize money: each medal level pays once, scaled by the event; places pay in a race of two or more', () => {
  assert.equal(medalFor(course, 9.9), 'gold');
  assert.equal(medalFor(course, 15), 'silver');
  assert.equal(medalFor(course, 19), 'bronze');
  assert.equal(medalFor(course, 21), null);
  // bronze, then silver, then gold come to the gold prize; gold at once pays the same
  const steps = runPrize(course, 'bronze', null).medal + runPrize(course, 'silver', 'bronze').medal + runPrize(course, 'gold', 'silver').medal;
  assert.equal(steps, MEDAL_PRIZE.gold * 2);
  assert.equal(runPrize(course, 'gold', null).medal, MEDAL_PRIZE.gold * 2);
  assert.equal(runPrize(course, 'silver', 'gold').medal, 0, 'nothing for a worse medal');
  assert.equal(runPrize(course, null, null).finish, FINISH_PRIZE * 2);
  const s = standings([{ id: 1, name: 'A', time: 12 }, { id: 2, name: 'B', time: null }, { id: 3, name: 'C', time: 11 }], course);
  assert.deepEqual(s.map((r) => [r.name, r.place, r.prize]), [['C', 1, RACE_PRIZE[0] * 2], ['A', 2, RACE_PRIZE[1] * 2], ['B', null, 0]]);
  assert.equal(standings([{ id: 1, name: 'A', time: 12 }], course)[0].prize, 0, 'alone: no place money');
});

test('the career: money, the dealer, parts, repairs on credit, best times', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const C = new Career({ truck: 'ranger' }, storage);
  assert.equal(C.money, START_MONEY);
  assert.ok(C.ownsTruck('ranger') && !C.ownsTruck('hauler'));
  assert.equal(C.buyTruck('hauler'), false, 'not enough money');
  C.add(20000, 'test');
  assert.ok(C.buyTruck('hauler'));
  assert.equal(C.money, START_MONEY + 20000 - TRUCK_PRICES.hauler);
  // parts: a quote for what isn't owned; once bought, fitting them again is free
  const build = { ...stockBuild(TRUCKS.ranger), lift: 1, tyre: 33 };
  const q = C.quote('ranger', build);
  assert.ok(q.total > 0 && q.items.length === 2);
  assert.ok(C.buyBuild('ranger', build));
  assert.equal(C.quote('ranger', build).total, 0);
  // repairs and the tow truck can run into the red, down to the limit
  const paid = C.charge(1e6, 'a very big bill');
  assert.equal(C.money, DEBT_LIMIT);
  assert.ok(paid > 0);
  assert.equal(C.pay(10, 'a part'), false, 'buying needs the money');
  // best times
  assert.equal(C.record('bogdash', { time: 30, medal: 'bronze' }), true);
  assert.equal(C.record('bogdash', { time: 31, medal: null }), false);
  assert.equal(C.record('bogdash', { time: 22, medal: 'silver' }), true);
  assert.deepEqual(C.best('bogdash'), { time: 22, medal: 'silver' });
  // it is kept: a new Career on the same storage has it all
  const again = new Career({}, storage);
  assert.equal(again.money, DEBT_LIMIT);
  assert.ok(again.ownsTruck('hauler'));
  assert.deepEqual(again.best('bogdash'), { time: 22, medal: 'silver' });
});

test('the valley: every trail a stock truck can drive (no pitch over 27 degrees, no bend tighter than 9 m), and the courses', async () => {
  const data = await generateWorld({});
  const world = new World(data);
  for (const tr of data.trails) {
    const p = tr.points;
    let maxG = 0, minR = Infinity;
    for (let i = 1; i < p.length - 1; i++) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i], [cx, cz] = p[i + 1];
      const a = Math.hypot(bx - ax, bz - az), b = Math.hypot(cx - bx, cz - bz), c = Math.hypot(cx - ax, cz - az);
      const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
      if (area > 1e-6) minR = Math.min(minR, (a * b * c) / (4 * area));
      // the grade over 8 m along the trail
      const dx = (cx - ax) / (a + b), dz = (cz - az) / (a + b);
      const g = Math.abs(world.terrain(bx + dx * 4, bz + dz * 4) - world.terrain(bx - dx * 4, bz - dz * 4)) / 8;
      maxG = Math.max(maxG, Math.atan(g) * 180 / Math.PI);
    }
    assert.ok(maxG < 27, `${tr.name}: a ${maxG.toFixed(1)} degree pitch`);
    assert.ok(minR > 9, `${tr.name}: a ${minR.toFixed(1)} m bend`);
  }
  const events = eventsFor(world);
  assert.deepEqual(events.map((e) => e.id), ['hillclimb', 'bogdash', 'trials', 'sanddrag']);
  for (const e of events) {
    assert.ok(e.gates.length >= 2 && e.gates.every((g) => Number.isFinite(g.y)), `${e.id}: gates on the ground`);
    const grid = gridFor(world, e);
    assert.equal(grid.length, 4);
    for (const s of grid) assert.ok(world.water(s.x, s.z) < world.terrain(s.x, s.z), `${e.id}: a grid slot in water`);
  }
  // a stock ranger, flat out at 30 psi, gets down the sand drag inside the bronze par
  const drag = events.find((e) => e.id === 'sanddrag');
  const v = new Vehicle(truckSpec('ranger'));
  v.place(world, drag.start.x, drag.start.z, drag.start.yaw);
  v.dt.setFourWD(true, 0);
  const run = new EventRun(drag, 0);
  let t = 0;
  while (t < 40 && run.phase !== 'finished') {
    const g = drag.gates[Math.min(run.gate, drag.gates.length - 1)];
    let diff = Math.atan2(g.x - v.pos.x, g.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z);
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    v.step({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -diff * 2)), handbrake: 0 }, world);
    t += 1 / 480;
    run.update(t, v.pos, 0);
  }
  assert.equal(run.phase, 'finished');
  assert.ok(run.time < drag.par.bronze, `the drag in ${run.time.toFixed(1)} s`);
});
