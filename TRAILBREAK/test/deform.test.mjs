// Ruts (world/Deform.js): which chunks, and which quarters of them, a change marks for the terrain to draw again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeformGrid } from '../src/world/Deform.js';

const xz = (key) => { const cx = Math.round(key / 65536); return [cx, key - cx * 65536]; };
const marked = (g) => {
  const keys = g.takeDirty() || [];
  return Object.fromEntries(keys.map((k) => [xz(k).join(','), g.taken.get(k)]));
};
const press = (g, x, z) => g.stamp(x, z, 1, 0, 0.05, 0.05, 0.1, 0, () => 1);

test('a rut in the middle of a chunk marks only its own quarter of it', () => {
  const g = new DeformGrid();
  press(g, 4.1, 4.1);
  assert.deepEqual(marked(g), { '0,0': 0b0001 });
  press(g, 12.1, 12.1);
  assert.deepEqual(marked(g), { '0,0': 0b1000 });
});

test('near the line between two quarters it marks both', () => {
  const g = new DeformGrid();
  press(g, 8.05, 2);
  assert.deepEqual(marked(g), { '0,0': 0b0011 });
});

test('near the corner of a chunk it marks the facing quarters of its neighbours too', () => {
  const g = new DeformGrid();
  press(g, 16.1, 16.1);
  assert.deepEqual(marked(g), { '1,1': 0b0001, '0,0': 0b1000, '1,0': 0b0100, '0,1': 0b0010 });
  // (and across the negative coordinates the same)
  press(g, -0.1, 4);
  assert.deepEqual(marked(g), { '-1,0': 0b0010, '0,0': 0b0001 });
});

test('a lookup sees chunks made or cleared since the last one', () => {
  const g = new DeformGrid(), dig = (x, z) => g.stamp(x, z, 1, 0, 0.4, 0.4, 0.1, 0, () => 1);
  dig(40, 40);
  assert.equal(g.get(4, 4), 0);                // (no chunk there yet: remembered as none)
  dig(4, 4);
  assert.ok(g.get(4, 4) > 0.09);
  g.chunks.clear();
  assert.equal(g.get(4, 4), 0);
  dig(40, 40);
  assert.equal(g.get(4, 4), 0);
});
