// The frame rate's readout (ui/PerfMeter.js): frames a second over the last second, the longest wait and the late
// frames over the last ten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameStats } from '../src/ui/PerfMeter.js';

test('a steady 60 frames a second: 60 fps, 16.7 ms, nothing late', () => {
  const s = new FrameStats();
  for (let i = 0; i < 300; i++) s.add(1000 / 60);
  const r = s.read();
  assert.ok(Math.abs(r.fps - 60) < 0.5, `${r.fps}`);
  assert.ok(Math.abs(r.ms - 16.67) < 0.1);
  assert.ok(r.worst < 17 && r.late === 0);
});

test('a stutter at a full frame rate: the long wait shows for ten seconds, then is forgotten', () => {
  const s = new FrameStats();
  for (let i = 0; i < 120; i++) s.add(1000 / 60);
  s.add(240);                                                   // (a quarter of a second without a frame)
  for (let i = 0; i < 120; i++) s.add(1000 / 60);
  let r = s.read();
  assert.ok(Math.abs(r.fps - 60) < 0.5, 'the frame rate itself is back at 60');
  assert.equal(Math.round(r.worst), 240);
  assert.equal(r.late, 1);
  for (let i = 0; i < 620; i++) s.add(1000 / 60);               // (ten seconds and a bit on)
  r = s.read();
  assert.ok(r.worst < 17 && r.late === 0, 'forgotten');
  assert.ok(s.gaps.length <= 2 * 620, 'only ten seconds kept');
});

test('a slow machine: 25 frames a second, every frame a 40 ms wait, none of them a stutter', () => {
  const s = new FrameStats();
  for (let i = 0; i < 100; i++) s.add(40);
  const r = s.read();
  assert.ok(Math.abs(r.fps - 25) < 0.5);
  assert.equal(r.late, 0);
  assert.equal(Math.round(r.worst), 40);
});
