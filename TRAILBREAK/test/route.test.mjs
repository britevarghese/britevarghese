// The satnav (game/Route.js): by road and trail where that is quicker, straight across where it isn't.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RouteGraph, along } from '../src/game/Route.js';

const line = (x0, z0, x1, z1, step = 6) => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
};
// a road east-west, a trail north from its middle, and a loop of trail to the south-east
const trails = [
  { kind: 'road', points: line(-600, 0, 600, 0) },
  { kind: 'trail', points: line(0, 0, 0, -800) },
  { kind: 'trail', points: [...line(300, 0, 300, 300), ...line(300, 306, 500, 300).slice(1), ...line(500, 300, 300, 0).slice(1)] },
];
const G = new RouteGraph(trails);

test('the route goes by the road and turns up the trail where they meet', () => {
  const r = G.route(-500, 10, 0, -700);
  const [x0, z0] = r.points[0], [x1, z1] = r.points.at(-1);
  assert.deepEqual([x0, z0], [-500, 10]);
  assert.deepEqual([x1, z1], [0, -700]);
  assert.ok(r.onTrail / r.length > 0.9, `${(r.onTrail / r.length * 100).toFixed(0)}% on road and trail`);
  // it passes the junction
  assert.ok(r.points.some(([x, z]) => Math.hypot(x, z) < 4), 'through the junction');
  assert.ok(r.length >= Math.hypot(500, 710) && r.length < 1300, `${r.length.toFixed(0)} m`);
});

test('short hops and places far from any trail go straight across', () => {
  const r = G.route(100, 20, 110, 40);
  assert.equal(r.points.length, 2);
  const far = G.route(-500, 400, -400, 600);
  assert.equal(far.points.length, 2, 'nothing to gain on the road');
});

test('where the route is: the segment, how far off it, how much is left', () => {
  const pts = [[0, 0], [100, 0], [100, 100]];
  const a = along(pts, 50, 5);
  assert.equal(a.seg, 0);
  assert.ok(Math.abs(a.off - 5) < 1e-9 && Math.abs(a.done - 50) < 1e-9 && Math.abs(a.left - 150) < 1e-9);
  const b = along(pts, 104, 60);
  assert.equal(b.seg, 1);
  assert.ok(Math.abs(b.left - 40) < 1e-9);
});
