// Painting the maps' pictures (ui/MapPaint.js): each ground height worked out once, the ring round the picture too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { heightGrid, splatTree, SLICE, SLICE_MS } from '../src/ui/MapPaint.js';

test('a picture\'s heights: each pixel\'s once, however often its neighbours ask for it; the same numbers as asked afresh', () => {
  let calls = 0;
  const ground = (i, j) => Math.sin(i * 0.37) * 40 + Math.cos(j * 0.21) * 25 + i * j * 1e-3;
  const i0 = 120, j0 = 40, w = 30, h = 20, H = heightGrid(i0, j0, w, h, (i, j) => { calls++; return ground(i, j); });
  let differ = 0;
  // as the painting reads them: a pixel, its four neighbours
  for (let j = j0; j < j0 + h; j++) {
    for (let i = i0; i < i0 + w; i++) {
      for (const [a, b] of [[i, j], [i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (H(a, b) !== ground(a, b)) differ++;
    }
  }
  assert.equal(differ, 0, 'the very numbers (kept as doubles)');
  // (the picture and the ring round it, less the ring's four corners, which no pixel asks for)
  assert.equal(calls, (w + 2) * (h + 2) - 4);
  assert.ok(calls < w * h * 5 / 4, `${calls} heights, where asking afresh takes ${w * h * 5}`);
});

test('a picture from the corner of the world (pixel 0, 0), and only the pixels asked for are worked out', () => {
  let calls = 0;
  const H = heightGrid(0, 0, 8, 8, (i, j) => { calls++; return i * 10 + j; });
  assert.equal(H(-1, 0), -10);
  assert.equal(H(8, 8), 88);
  assert.equal(H(3, 4), 34);
  assert.equal(H(3, 4), 34);
  assert.equal(calls, 3);
});

test('a turn of the painting: a few ms, the clock looked at every 16 pixels', () => {
  assert.ok(SLICE_MS >= 4 && SLICE_MS <= 8);
  assert.equal(SLICE, 15);
  // (a mask: one pixel in sixteen of any row, wherever the row starts)
  for (const start of [0, 7, 1000]) { let n = 0; for (let i = start; i < start + 160; i++) if ((i & SLICE) === SLICE) n++; assert.equal(n, 10); }
});

/** A white picture w by h, and how much of the tree's colour each pixel has taken (0 none, 1 all). */
function sheet(w, h) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = () => Array.from({ length: w * h }, (_, k) => (255 - data[k * 4]) / (255 - 42));
  return { data, ink };
}

test('a tree on a map\'s picture: a soft dot of about its own area, wherever in a pixel it stands', () => {
  const r = 0.6, area = Math.PI * r * r;
  // in a pixel's middle: that pixel, half see-through
  let S = sheet(5, 5);
  splatTree(S.data, 5, 5, 2.5, 2.5, r);
  let ink = S.ink();
  assert.ok(Math.abs(ink[12] - 0.5 * area) < 0.02, `the middle pixel ${ink[12].toFixed(2)}`);
  assert.ok(ink.filter((a) => a > 0.01).length === 1);
  // where four pixels meet: a quarter each
  S = sheet(5, 5);
  splatTree(S.data, 5, 5, 2, 2, r);
  ink = S.ink();
  for (const k of [6, 7, 11, 12]) assert.ok(Math.abs(ink[k] - 0.5 * area / 4) < 0.02, `pixel ${k}: ${ink[k].toFixed(2)}`);
  // anywhere: the same amount of it in all
  for (const [cx, cy] of [[2.5, 2.5], [2, 2], [2.2, 2.9], [1.71, 3.3]]) {
    S = sheet(5, 5);
    splatTree(S.data, 5, 5, cx, cy, r);
    const sum = S.ink().reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 0.5 * area) < 0.03, `at ${cx}, ${cy}: ${sum.toFixed(3)}`);
  }
  // (its colour: more green than red, more red than blue)
  S = sheet(3, 3);
  splatTree(S.data, 3, 3, 1.5, 1.5, r);
  const o = 4 * 4;
  assert.ok(S.data[o + 1] > S.data[o] && S.data[o] > S.data[o + 2] && S.data[o + 3] === 255, [...S.data.slice(o, o + 4)].join(' '));
});

test('trees over one another darken as paint does; one off the picture\'s edge marks only what is on it; a big one is a disc', () => {
  let S = sheet(4, 4);
  for (let k = 0; k < 6; k++) splatTree(S.data, 4, 4, 1.5, 1.5, 0.6);
  const many = S.ink()[5];
  assert.ok(many > 0.9 && many <= 1, `six trees on a pixel: ${many.toFixed(2)}`);
  S = sheet(4, 4);
  splatTree(S.data, 4, 4, 0, 0, 0.6);              // (on the corner: a quarter of it is on the picture)
  splatTree(S.data, 4, 4, -5, 2, 0.6);
  splatTree(S.data, 4, 4, 9, 9, 3);
  let ink = S.ink();
  assert.ok(ink[0] > 0.1 && ink.slice(1).every((a) => a < 0.01));
  S = sheet(11, 11);
  splatTree(S.data, 11, 11, 5.5, 5.5, 3);
  ink = S.ink();
  assert.ok(Math.abs(ink[5 * 11 + 5] - 0.5) < 0.01 && Math.abs(ink[5 * 11 + 7] - 0.5) < 0.01, 'half see-through inside');
  assert.ok(ink[0] === 0 && ink[5 * 11 + 10] < 0.01, 'nothing outside');
  const sum = ink.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 0.5 * Math.PI * 9) < 2.5, `a disc's area: ${sum.toFixed(1)}`);
});
