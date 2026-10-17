// The driver's hands on the steering wheel (render/Hands.js): they hold ten to two, turn with the wheel, go hand over
// hand on a big turn with one always holding, and settle back when the wheel is straight again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hands, REST, REACH, REACH_MAX, SLIDE } from '../src/render/Hands.js';

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const DT = 1 / 60;

test('at rest: ten to two, both holding', () => {
  const h = new Hands();
  for (let i = 0; i < 60; i++) h.update(0, DT);
  h.hands.forEach((x, i) => { assert.ok(x.on); assert.equal(x.lift, 0); assert.ok(Math.abs(wrap(x.at - REST[i])) < 1e-9); });
});

test('a small turn: both hands keep hold and turn with the wheel', () => {
  const h = new Hands();
  for (let i = 0; i <= 60; i++) h.update(0.8 * i / 60, DT);
  h.hands.forEach((x, i) => { assert.ok(x.on, `hand ${i} let go`); assert.ok(Math.abs(wrap(x.at - REST[i] - 0.8)) < 1e-9); });
});

test('lock to lock: hand over hand, one hand always on the wheel, neither past its reach', () => {
  const h = new Hands();
  let regrips = 0, bothOff = 0, worst = 0;
  const was = h.hands.map((x) => x.on);
  // straight to full lock one way (1.3 turns) in 1.5 s, then to full lock the other way, then back
  const path = (t) => (t < 1.5 ? 8 * t / 1.5 : t < 4.5 ? 8 - 16 * (t - 1.5) / 3 : -8 + 8 * (t - 4.5) / 1.5);
  for (let t = 0; t <= 6; t += DT) {
    h.update(path(t), DT);
    h.hands.forEach((x, i) => {
      if (was[i] && !x.on) regrips++;
      was[i] = x.on;
      if (x.on) worst = Math.max(worst, Math.abs(wrap(x.at - REST[i])));
      assert.ok(x.lift >= 0 && x.lift <= 1);
    });
    if (!h.hands[0].on && !h.hands[1].on) bothOff++;
  }
  assert.ok(regrips >= 8, `${regrips} new grips`);
  assert.equal(bothOff, 0, 'both hands off the wheel at once');
  assert.ok(worst <= REACH_MAX + 0.15, `a hand held on ${worst.toFixed(2)} rad from its rest`);
});

test('spun faster than hands can take hold (the keyboard at a crawl): the wheel slides through them', () => {
  const h = new Hands();
  for (let t = 0; t <= 0.2; t += DT) {
    h.update(8 * t / 0.2, DT);                                       // 40 rad/s
    h.hands.forEach((x, i) => { assert.ok(x.on, `hand ${i} let go`); assert.ok(Math.abs(wrap(x.at - REST[i])) <= REACH + 1e-9); });
  }
  assert.ok(8 / 0.2 > SLIDE);
});

test('straight again and steady: both hands back at ten to two', () => {
  const h = new Hands();
  for (let t = 0; t <= 1; t += DT) h.update(3 * t, DT);           // a big turn: grips all round the rim
  for (let t = 0; t <= 0.5; t += DT) h.update(3 - 3 * t / 0.5, DT); // and back
  for (let t = 0; t <= 2.5; t += DT) h.update(0, DT);               // held straight
  h.hands.forEach((x, i) => { assert.ok(x.on); assert.ok(Math.abs(wrap(x.at - REST[i])) < 0.2 + 1e-9, `hand ${i} at ${x.at.toFixed(2)}`); });
  assert.ok(REACH < REACH_MAX);
});
