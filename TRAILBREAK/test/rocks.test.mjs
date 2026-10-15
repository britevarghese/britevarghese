// Boulder shapes: the top the physics drives on is the surface the renderer draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rockShape, rockTop, ROCK_SHAPES } from '../src/world/RockShapes.js';

test('each rock shape has a top inside its unit ball, highest near the middle', () => {
  for (let k = 0; k < ROCK_SHAPES; k++) {
    const c = rockTop(k, 0, 0);
    assert.ok(c > 0.55 && c < 0.99, `shape ${k} centre ${c}`);
    assert.equal(rockTop(k, 0.99, 0.99), -1, 'off the footprint');
    assert.ok(rockTop(k, 0.6, 0) < c + 0.1, `shape ${k} falls away from the middle`);
  }
});

test('the top lies on the drawn surface: just under it is rock, just over it is air', () => {
  for (let k = 0; k < ROCK_SHAPES; k++) {
    const { radius } = rockShape(k);
    const inside = (u, y, v) => { const l = Math.hypot(u, y, v); return l <= radius(u / l, y / l, v / l); };
    for (const [u, v] of [[0, 0], [0.3, -0.2], [-0.4, 0.35], [0.1, 0.5]]) {
      // at grid points the lookup is exact up to the bisection tolerance
      const i = Math.round((u + 1) * 20), j = Math.round((v + 1) * 20), gu = i / 20 - 1, gv = j / 20 - 1;
      const t = rockTop(k, gu, gv);
      assert.ok(inside(gu, t - 0.01, gv), `shape ${k} (${gu}, ${gv}) under the top is rock`);
      assert.ok(!inside(gu, t + 0.01, gv), `shape ${k} (${gu}, ${gv}) over the top is air`);
    }
  }
});
