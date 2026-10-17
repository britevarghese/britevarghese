// What breaks: young trees and slender trunks give way to a truck, the big ones stop it; roadside things go; and the
// world keeps (and shares) what is down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';
import { trunkCap, WOOD_C } from '../src/world/Breakables.js';
import { mapById } from '../src/world/maps/index.js';
import { generateWorld } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';

/** Flat grass with trunks (and the world's rule: one gives way when the truck bends it past what it takes). */
function grove(trunks) {
  const broken = new Set();
  return {
    broken,
    height: () => 0, surfaceAt: () => SURFACES[SURFACE.GRASS],
    treesNear: (px, pz, rr, out) => {
      out.length = 0;
      trunks.forEach((t, i) => { if (!broken.has(i) && Math.hypot(px - t.x, pz - t.z) < rr + t.r + 2) out.push({ ...t, y: 0, i }); });
      return out;
    },
    strike: (i, moment) => { if (moment >= trunks[i].cap) { broken.add(i); return true; } return false; },
  };
}

/** A truck rolling at kmh into the trunks, 4 s; its speed after, and what broke. */
function hit(id, kmh, trunks) {
  const g = grove(trunks), v = new Vehicle(truckSpec(id));
  v.place(g, 0, 0, 0);
  for (let n = 0; n < 240; n++) v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g);
  v.vel.set(0, 0, kmh / 3.6);
  let flipped = false;
  for (let n = 0; n < 480 * 3; n++) { v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g); if (v.up.y < 0.5) flipped = true; }
  return { kmh: Math.hypot(v.vel.x, v.vel.z) * 3.6, broken: g.broken.size, flipped, z: v.pos.z };
}

const ash = mapById('ashwood'), ker = mapById('kerala');
const tree = (type, r, map = ash) => ({ x: 0, z: 12, r, top: 15, cap: trunkCap(map, type, r) });

test('what a trunk takes: C d^3 for its kind, the big ones unbreakable', () => {
  assert.equal(trunkCap(ash, 0, 0.05), WOOD_C * 0.1 ** 3);
  assert.ok(trunkCap(ash, 3, 0.3) < trunkCap(ash, 0, 0.3), 'a dead snag is brittle');
  assert.ok(trunkCap(ker, 4, 0.1) < 2000, 'a banana folds at a touch');
  assert.equal(trunkCap(ash, 0, 0.32), Infinity, 'a big pine: a truck crumples on it first');
  assert.ok(trunkCap(ker, 0, 0.17) < Infinity && trunkCap(ker, 3, 0.15) < Infinity, 'palms and rubber trees can go');
});

test('a young tree snaps in front of a truck at 25 km/h, which hardly slows; a big pine stops it dead, upright', () => {
  for (const id of ['gecko', 'thar', 'bruiser']) {
    const young = hit(id, 25, [tree(0, 0.05)]), clear = hit(id, 25, []);
    assert.equal(young.broken, 1, `${id}: the sapling stands`);
    assert.ok(young.kmh > clear.kmh * 0.75 && young.z > clear.z - 1.5, `${id}: it slowed to ${young.kmh.toFixed(0)} km/h (${clear.kmh.toFixed(0)} with nothing in the way)`);
    const pine = hit(id, 25, [tree(0, 0.45)]);
    assert.equal(pine.broken, 0);
    assert.ok(pine.kmh < 3 && !pine.flipped, `${id}: into the pine, still ${pine.kmh.toFixed(1)} km/h${pine.flipped ? ', flipped' : ''}`);
  }
});

test('a slender trunk goes to a heavy truck at speed, not to a light one going slowly', () => {
  const palm = tree(0, 0.17, ker);
  assert.equal(hit('rhino', 45, [palm]).broken, 1, 'the Unimog through a palm at 45 km/h');
  assert.equal(hit('gecko', 12, [palm]).broken, 0, 'a Niva at 12 km/h');
  const birch = tree(2, 0.2);
  assert.equal(hit('bruiser', 45, [birch]).broken, 1);
});

test('the world: young trees and roadside things placed the same every time, kept off the trails; breaks by key', async () => {
  const data = await generateWorld({ map: 'ashwood' });
  const w = new World(data), base = data.trees.base;
  assert.ok(data.trees.count - base > 500, `${data.trees.count - base} young trees`);
  assert.ok(w.roadside.length > 100 && w.roadside.some((it) => it.kind === 'rail') && w.roadside.some((it) => it.kind === 'sign'));
  // the same again (a friend's machine builds the same world)
  const data2 = await generateWorld({ map: 'ashwood' }), w2 = new World(data2);
  assert.equal(data2.trees.count, data.trees.count);
  assert.equal(data2.trees.x[data.trees.count - 1], data.trees.x[data.trees.count - 1]);
  assert.deepEqual(w2.roadside.map((it) => it.kind + it.x.toFixed(2)), w.roadside.map((it) => it.kind + it.x.toFixed(2)));
  // a young tree: in the way until struck hard enough, then gone, and the break queued
  const i = base + 10, x = data.trees.x[i], z = data.trees.z[i];
  assert.ok(w.treesNear(x, z, 0.5, []).some((t) => t.i === i));
  assert.equal(w.strike(i, 10), false, 'a nudge');
  assert.equal(w.strike(i, 1e6), true);
  assert.ok(!w.treesNear(x, z, 0.5, []).some((t) => t.i === i), 'out of the way');
  assert.equal(w.breaks.length, 1);
  assert.equal(w.breaks[0].key, 't' + i);
  // a friend's break, by key; the room's list
  const o = w.roadside.length - 1;
  assert.equal(w.breakKey('o' + o, 1, 0, 8), true);
  assert.equal(w.breakKey('o' + o), false, 'already down');
  assert.equal(w.breakKey('t99999999'), false);
  assert.deepEqual(w.brokenKeys().sort(), ['o' + o, 't' + i].sort());
  // the winch doesn't take a sapling for an anchor
  const pick = w.nearestTree(x, z, 30);
  assert.ok(!pick || pick.i < base || pick.cap >= 6e4);
});
