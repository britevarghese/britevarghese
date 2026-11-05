// A river's current (world/World.js currentSpeed and flow; physics/Vehicle.js waterStep and wheelsInCurrent): how fast
// it runs, and what it does to a truck stood in it. The speeds against Jarrett's measurements on steep stony streams;
// what it does against what moving water does to real vehicles (UNSW WRL's flood tests, TR2017/07, and the US
// National Weather Service: two feet of fast water carries off SUVs and trucks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { currentSpeed } from '../src/world/World.js';
import { flat } from './grounds.mjs';

/** A river over a flat stony bed, `depth` deep, running toward +x at `speed` m/s (0: still water). */
const river = (depth, speed) => ({
  ...flat(SURFACE.RIVERBED), water: () => depth,
  flow: (x, z, out) => { out.x = speed; out.z = 0; return speed; },
});
const HOLD = { throttle: 0, brake: 0, steer: 0, handbrake: 1, hold: 1 };
const FREE = { throttle: 0, brake: 0, steer: 0, handbrake: 0, neutral: 1 };

/** Stood side on to the current (heading +z) for `seconds`, settled first: how far it went, and how fast at most. */
function stand(id, depth, speed, seconds, ctrl = HOLD) {
  const g = river(depth, speed), v = new Vehicle(truckSpec(id));
  v.place(g, 0, 0, 0);
  for (let i = 0; i < Math.round(1 / PHYS_DT); i++) v.step(HOLD, g);
  const x0 = v.pos.x, z0 = v.pos.z;
  let top = 0;
  for (let i = 0, n = Math.round(seconds / PHYS_DT); i < n; i++) {
    v.step(ctrl, g);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
    top = Math.max(top, Math.hypot(v.vel.x, v.vel.z));
  }
  return { moved: Math.hypot(v.pos.x - x0, v.pos.z - z0), down: v.pos.x - x0, top, v };
}

test('how fast a river runs: a knee-deep ford at about 1 m/s, a metre-deep one at 2; deeper faster, steeper barely', () => {
  const ford = currentSpeed(0.66, 0.0105), deep = currentSpeed(1.18, 0.0187);
  assert.ok(ford > 1.0 && ford < 1.5, `a 0.66 m ford on a 1% fall: ${ford.toFixed(2)} m/s`);
  assert.ok(deep > 1.9 && deep < 2.5, `a 1.2 m ford on a 1.9% fall: ${deep.toFixed(2)} m/s`);
  assert.ok(currentSpeed(0.2, 0.01) < 0.6, 'ankle-deep water runs slowly over its stones');
  assert.ok(currentSpeed(1.5, 0.01) > currentSpeed(0.5, 0.01) * 2, 'the deep channel runs fastest');
  // (Jarrett: the steeper bed is the rougher, so four times the fall is under a fifth faster)
  const r = currentSpeed(0.6, 0.04) / currentSpeed(0.6, 0.01);
  assert.ok(r > 1.05 && r < 1.2, `four times as steep: ${r.toFixed(2)} times as fast`);
  assert.equal(currentSpeed(1, 0), 0, 'level water is still');
  assert.equal(currentSpeed(0, 0.02), 0);
  assert.ok(currentSpeed(5, 0.2) <= 3.5, 'no faster than white water');
});

test('a truck side on in a ford: knee-deep running water it stands in; a metre of fast water carries a light truck off', () => {
  // knee deep (0.6 m) at 1.3 m/s, as the taiga's Bearwood ford: brakes on, it stays where it is
  const knee = stand('ranger', 0.6, 1.3, 10);
  assert.ok(knee.moved < 0.1, `held in 0.6 m at 1.3 m/s: moved ${knee.moved.toFixed(2)} m`);
  // 1.2 m at 2.2 m/s (the taiga's Deep Ford): the water over its floor lifts it and pushes it off, brakes or not
  const deep = stand('ranger', 1.2, 2.2, 10);
  assert.ok(deep.down > 5, `a 2 t truck in 1.2 m at 2.2 m/s: carried ${deep.down.toFixed(1)} m downstream`);
  // the same depth standing still: it stays (it's the current that moves it)
  const still = stand('ranger', 1.2, 0, 10);
  assert.ok(still.moved < 0.1, `in 1.2 m of still water: moved ${still.moved.toFixed(2)} m`);
  // a far heavier truck (the 6.2 t Rhino) holds in the same water
  const heavy = stand('rhino', 1.2, 2.2, 10);
  assert.ok(heavy.moved < 0.1, `the Rhino in 1.2 m at 2.2 m/s: moved ${heavy.moved.toFixed(2)} m`);
});

test('carried off, a truck goes with the water, never faster than it', () => {
  const r = stand('thar', 1.2, 2.2, 15, FREE);
  assert.ok(r.down > 10, `drifted ${r.down.toFixed(1)} m`);
  assert.ok(r.top < 2.2 * 1.1, `at most ${r.top.toFixed(2)} m/s in a 2.2 m/s current`);
});
