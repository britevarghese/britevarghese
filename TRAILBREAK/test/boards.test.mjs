// Recovery boards (game/Boards.js): where a pair lies, and that digging out and laying them gets a stuck truck out of
// mud that full throttle won't.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, boardTop, layBoards, digOut, stuckPair } from '../src/game/Boards.js';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { bogPatch } from './grounds.mjs';

test('boards: a board is a gently tilted plank a few centimetres proud of what it lies on', () => {
  const b = { x0: 0, z0: 0, dx: 0, dz: 1, y0: -0.3, y1: 0, x: 0, z: BOARD.len / 2, yaw: 0 };
  assert.ok(Math.abs(boardTop(b, 0, 0) - (-0.3 + BOARD.t)) < 1e-9);
  assert.ok(Math.abs(boardTop(b, 0.1, BOARD.len) - BOARD.t) < 1e-9);
  assert.equal(boardTop(b, BOARD.w / 2 + 0.01, 0.5), -Infinity, 'off its side');
  assert.equal(boardTop(b, 0, BOARD.len + 0.05), -Infinity, 'past its end');
  assert.equal(boardTop(b, 0, -0.05), -Infinity, 'behind it');
});

// a stock Ranger stood in a bog's heart (as soft as Kashid Bog's when wet), then floored: sunk to its belly
const stuck = () => {
  const g = bogPatch(4, 1.2, 3), v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  for (let t = 0; t < 12; t += PHYS_DT) v.step({ throttle: 0, brake: 0, hold: 1, steer: 0, handbrake: 0 }, g);
  for (let t = 0; t < 6; t += PHYS_DT) v.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, g);
  for (let t = 0; t < 1; t += PHYS_DT) v.step({ throttle: 0, brake: 0, hold: 1, steer: 0, handbrake: 0 }, g);
  return { g, v };
};
const easeOut = (v, g, secs = 25) => {
  for (let t = 0; t < secs && v.pos.z < 8; t += PHYS_DT) {
    const sp = v.vel.dot(v.fwd);
    v.step({ throttle: Math.max(0, Math.min(1, (1.5 - sp) * 0.6 + 0.35)), brake: 0, steer: 0, handbrake: 0 }, g);
  }
  return v.pos.z;
};

test('boards: stuck in a bog, a truck digs out, lays the boards under the wheels in deepest and drives out', () => {
  const a = stuck();
  assert.ok(a.v.pos.z < 1 && Math.max(...a.v.wheels.map((w) => w.sink || 0)) > 0.25, `stuck: ${a.v.pos.z.toFixed(1)} m on, sunk ${Math.max(...a.v.wheels.map((w) => w.sink || 0)).toFixed(2)} m`);
  assert.ok(easeOut(a.v, a.g) < 1, 'and going nowhere without them');
  const b = stuck(), pair = stuckPair(b.v);
  const dug = digOut(b.v, b.g);
  b.g.boards = layBoards(b.v, b.g, false, pair);
  assert.ok(dug > 0.25, `dug out ${dug.toFixed(2)} m under it`);
  // (each in front of its tyre, along the truck, lying no steeper than a tyre will climb)
  const ws = pair === 'rear' ? b.v.wheels.slice(2) : b.v.wheels.slice(0, 2);
  b.g.boards.forEach((bd, i) => {
    assert.ok(Math.abs(bd.x0 - ws[i].cx) < 0.15 && bd.dz > 0.95 && (bd.y1 - bd.y0) / BOARD.len <= 0.3 + 1e-9, `board ${i} at ${bd.x0.toFixed(2)}, ${bd.z0.toFixed(2)}`);
  });
  const z = easeOut(b.v, b.g);
  assert.ok(z >= 8, `out on the boards: ${z.toFixed(1)} m on`);
});
