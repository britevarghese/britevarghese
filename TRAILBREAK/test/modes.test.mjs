// Party modes (game/Modes.js): the elimination zone's circles, health outside it; king of the hill's hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneSchedule, zoneAt, ZoneRun, HillRun, modesFor, ZONE_TIME, HOLD, DRAIN } from '../src/game/Modes.js';
import { medalFor, standings } from '../src/game/Events.js';
import { generateWorld } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';

// a grid of trail points over the arena
const trails = [{ points: Array.from({ length: 41 * 41 }, (_, i) => [((i % 41) - 20) * 15, (Math.floor(i / 41) - 20) * 15]) }];

test('the zone: the same circles from the same start, each inside the last, down to nothing', () => {
  const a = zoneSchedule(trails, { x: 0, z: 0 }, 12345), b = zoneSchedule(trails, { x: 0, z: 0 }, 12345), c = zoneSchedule(trails, { x: 0, z: 0 }, 999);
  assert.deepEqual(a, b, 'every truck in the room works out the same zones');
  assert.notDeepEqual(a, c);
  for (const S of a) assert.ok(Math.hypot(S.x1 - S.x0, S.z1 - S.z0) + S.r1 <= S.r0 + 1e-9, 'the next circle inside this one');
  assert.equal(a.at(-1).r1, 0);
  assert.equal(a.at(-1).t1, ZONE_TIME);
  // it holds, then shrinks smoothly to the next
  const S = a[1];
  assert.equal(zoneAt(a, S.t0 - 1).r, S.r0);
  assert.ok(!zoneAt(a, S.t0 - 1).shrinking && zoneAt(a, (S.t0 + S.t1) / 2).shrinking);
  assert.ok(Math.abs(zoneAt(a, (S.t0 + S.t1) / 2).r - (S.r0 + S.r1) / 2) < 1e-9);
  assert.equal(zoneAt(a, ZONE_TIME + 5).r, 0);
});

test('elimination: health drains outside the zone only; at none the truck is out, its time how long it lasted', () => {
  const e = { kind: 'zone', center: { x: 0, z: 0 }, higher: true, par: { gold: ZONE_TIME, silver: ZONE_TIME - 45, bronze: ZONE_TIME - 100 } };
  const run = new ZoneRun(e, 2, trails, 7);
  assert.equal(run.update(1, { x: 0, y: 0, z: 0 }), null);
  assert.equal(run.phase, 'countdown');
  run.update(2, { x: 0, y: 0, z: 0 });
  for (let t = 2; t < 12; t += 0.5) run.update(t, { x: 0, y: 0, z: 0 });
  assert.equal(run.health, 100, 'inside: no damage');
  run.update(12, { x: 0, y: 0, z: 0 });
  let r = null, t = 12;
  while (!r && t < 40) { t += 0.1; r = run.update(t, { x: 2000, y: 0, z: 0 }); }
  assert.equal(r, 'finish');
  assert.ok(run.out && Math.abs((t - 12) - 100 / DRAIN) < 0.3, `out after ${(t - 12).toFixed(1)} s outside`);
  // lasting longer is better: medals and places
  assert.equal(medalFor(e, ZONE_TIME + 3), 'gold');
  assert.equal(medalFor(e, ZONE_TIME - 60), 'bronze');
  assert.deepEqual(standings([{ id: 1, time: 50 }, { id: 2, time: 120 }, { id: 3, time: null }], e).map((s) => s.id), [2, 1, 3]);
});

test('king of the hill: time in the ring counts only alone in it; first to the hold wins, the others stand by what they still needed', () => {
  const e = { kind: 'hill', hill: { x: 0, z: 0, r: 16, y: 0 }, par: { gold: 100, silver: 130, bronze: 170 } };
  const run = new HillRun(e, 0), me = { x: 3, y: 1, z: 0 }, rival = { x: -5, y: 1, z: 2 }, away = { x: 300, y: 1, z: 0 };
  let t = 0;
  for (; t < 10; t += 0.1) run.update(t, me, 0, [away]);
  assert.ok(Math.abs(run.held - 10) < 0.2, `held ${run.held.toFixed(1)} s alone`);
  for (; t < 20; t += 0.1) run.update(t, me, 0, [rival]);
  assert.ok(run.contested && Math.abs(run.held - 10) < 0.2, 'contested: no time');
  assert.ok(Math.abs(run.standing() - (run.time + HOLD - run.held)) < 1e-9);
  let r = null;
  while (!r && t < 200) { t += 0.1; r = run.update(t, me, 0, [away]); }
  assert.equal(r, 'finish');
  assert.equal(run.held, HOLD);
  assert.ok(Math.abs(run.time - (HOLD + 10)) < 0.5);
});

test('each map has an elimination arena and a hill to hold', async () => {
  for (const map of ['ashwood', 'kerala']) {
    const world = new World(await generateWorld({ map }));
    const modes = modesFor(world);
    assert.deepEqual(modes.map((m) => m.id), ['elimination', 'kingofhill']);
    const hill = modes[1].hill;
    assert.ok(world.water(hill.x, hill.z) < world.terrain(hill.x, hill.z), `${map}: the hill is dry`);
    const pts = world.data.trails.flatMap((t) => t.points);
    assert.ok(Math.min(...pts.map(([x, z]) => Math.hypot(x - hill.x, z - hill.z))) < 10, `${map}: the hill is on a trail`);
    const S = zoneSchedule(world.data.trails, modes[0].center, 42);
    assert.ok(S.every((s) => s.r1 === 0 || pts.some(([x, z]) => x === s.x1 && z === s.z1)), `${map}: each next centre on a trail`);
  }
});
