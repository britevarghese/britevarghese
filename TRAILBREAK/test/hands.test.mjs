// The driver's hands on the steering wheel (render/Hands.js): they hold a quarter to three, turn with the wheel, take
// new grips on a big turn (push-pull) with one always holding, and settle back when the wheel is straight again; the
// steering wheel drawn for keys and sticks turns no faster than hands can turn it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hands, HandTurn, REST, REACH, REACH_MAX, REACH_DOWN, SLIDE, TURN_MAX, TURN_ACC, FLIGHT_MIN } from '../src/render/Hands.js';

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const DT = 1 / 60;

test('at rest: a quarter to three, both holding', () => {
  const h = new Hands();
  for (let i = 0; i < 60; i++) h.update(0, DT);
  h.hands.forEach((x, i) => { assert.ok(x.on); assert.equal(x.lift, 0); assert.ok(Math.abs(wrap(x.at - REST[i])) < 1e-9); });
});

test('a small turn: both hands keep hold and turn with the wheel', () => {
  const h = new Hands();
  for (let i = 0; i <= 60; i++) h.update(0.8 * i / 60, DT);
  h.hands.forEach((x, i) => { assert.ok(x.on, `hand ${i} let go`); assert.ok(Math.abs(wrap(x.at - REST[i] - 0.8)) < 1e-9); });
});

test('lock to lock: push-pull, one hand always on the wheel, neither past its reach, never crossing the top', () => {
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
      // (each hand on its own side of the top of the wheel: the left one never past it to the right, nor the right one
      // left; pulling down, a hand may go a little past the bottom, out of the way)
      const side = Math.cos(x.at);
      if (Math.sin(x.at) > 0) assert.ok(i === 0 ? side > -0.05 : side < 0.05, `hand ${i} crossed over the top at ${x.at.toFixed(2)}`);
      assert.ok(x.lift >= 0 && x.lift <= 1);
    });
    if (!h.hands[0].on && !h.hands[1].on) bothOff++;
  }
  assert.ok(regrips >= 8, `${regrips} new grips`);
  assert.equal(bothOff, 0, 'both hands off the wheel at once');
  assert.ok(worst <= REACH_DOWN + 0.15, `a hand held on ${worst.toFixed(2)} rad from its rest`);
});

test('spun faster than hands can take hold (a player\'s own wheel spun hard): the wheel slides through them', () => {
  const h = new Hands();
  for (let t = 0; t <= 0.2; t += DT) {
    h.update(8 * t / 0.2, DT);                                       // 40 rad/s
    h.hands.forEach((x, i) => { assert.ok(x.on, `hand ${i} let go`); assert.ok(Math.abs(wrap(x.at - REST[i])) <= REACH + 1e-9); });
  }
  assert.ok(8 / 0.2 > SLIDE);
});

test('straight again and steady: both hands back at a quarter to three', () => {
  const h = new Hands();
  for (let t = 0; t <= 1; t += DT) h.update(3 * t, DT);           // a big turn: grips all round the rim
  for (let t = 0; t <= 0.5; t += DT) h.update(3 - 3 * t / 0.5, DT); // and back
  for (let t = 0; t <= 2.5; t += DT) h.update(0, DT);               // held straight
  h.hands.forEach((x, i) => { assert.ok(x.on); assert.ok(Math.abs(wrap(x.at - REST[i])) < 0.2 + 1e-9, `hand ${i} at ${x.at.toFixed(2)}`); });
  assert.ok(REACH < REACH_MAX);
});

test('keys at a crawl: the wheel drawn turns no faster than hands, gets there, and stops there', () => {
  // the front wheels to full lock in a quarter of a second (4 rad of steering wheel), held, and back
  const t = new HandTurn(), h = new Hands();
  t.to(0);
  let prev = 0, fastest = 0, jerk = 0, v0 = 0, shortest = 9, air = [0, 0], bothOff = 0, over = 0;
  const target = (s) => (s < 0.25 ? 4 * s / 0.25 : s < 1.5 ? 4 : s < 1.75 ? 4 - 4 * (s - 1.5) / 0.25 : 0);
  for (let s = 0; s <= 3; s += DT) {
    const a = t.to(target(s), DT), v = (a - prev) / DT;
    fastest = Math.max(fastest, Math.abs(v));
    jerk = Math.max(jerk, Math.abs(v - v0) / DT);
    if (s > 1.2 && s < 1.5) over = Math.max(over, a - 4);
    prev = a; v0 = v;
    h.update(a, DT);
    h.hands.forEach((x, i) => {
      if (!x.on) air[i] += DT;
      else if (air[i] > 0) { shortest = Math.min(shortest, air[i]); air[i] = 0; }
    });
    if (!h.hands[0].on && !h.hands[1].on) bothOff++;
  }
  assert.ok(fastest <= TURN_MAX + 1e-6, `${fastest.toFixed(1)} rad/s`);
  assert.ok(jerk <= TURN_ACC + 1e-6, `${jerk.toFixed(0)} rad/s2`);
  assert.ok(Math.abs(prev) < 0.01 && over < 1e-6, `ended at ${prev.toFixed(3)}, overshot by ${over.toFixed(3)}`);
  assert.equal(bothOff, 0, 'both hands off the wheel at once');
  assert.ok(shortest >= FLIGHT_MIN - 1e-6, `a new grip in ${shortest.toFixed(3)} s`);
});

test('posed (no time passing): the wheel there at once, both hands holding at a quarter to three', () => {
  const t = new HandTurn(), h = new Hands();
  t.to(0, DT);
  assert.equal(t.to(-3.9), -3.9);
  h.update(-3.9);
  h.hands.forEach((x, i) => { assert.ok(x.on); assert.ok(Math.abs(wrap(x.at - REST[i])) < 1e-9); });
});
