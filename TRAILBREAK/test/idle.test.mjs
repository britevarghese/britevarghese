// Background work's turns (core/Idle.js): the next task on a loading screen; once the game draws frames, the idle time
// between them, with time enough for the piece of work; never starved where there is none; at once when hurried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { idle, setPlaying, setHurry } from '../src/core/Idle.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** A browser's requestIdleCallback, played by hand: left(): the idle time each call gets (ms), or null for none till its timeout. */
function fakeIdle(left) {
  const calls = [];
  globalThis.requestIdleCallback = (fn, { timeout }) => {
    const t = left();
    calls.push(t);
    if (t === null) setTimeout(() => fn({ didTimeout: true, timeRemaining: () => 0 }), timeout);
    else setTimeout(() => fn({ didTimeout: false, timeRemaining: () => t }), 1);
  };
  return calls;
}
const took = async (p) => { const t0 = performance.now(); await p; return performance.now() - t0; };

test('on a loading screen (and where the browser has no idle callbacks): the next task', async () => {
  delete globalThis.requestIdleCallback;
  setPlaying(false); setHurry(false);
  assert.ok(await took(idle(6)) < 20);
  setPlaying(true);
  assert.ok(await took(idle(6)) < 20, 'no requestIdleCallback: a task');
});

test('playing: a turn when the frame leaves time enough for the piece of work, not before', async () => {
  setPlaying(true); setHurry(false);
  // (time to spare at once)
  let calls = fakeIdle(() => 10);
  assert.ok(await took(idle(6)) < 20);
  assert.equal(calls.length, 1);
  // (2 ms left before this frame and the next: not enough for 6; then 9)
  const seq = [2, 2, 9];
  calls = fakeIdle(() => seq.shift());
  await idle(6);
  assert.deepEqual(calls, [2, 2, 9], 'asked again until there was time');
  // (a long piece asks for no more than a frame can give)
  calls = fakeIdle(() => 12);
  await idle(40);
  assert.equal(calls.length, 1);
});

test('playing with no idle time at all: a turn all the same, within a few frames', async () => {
  setPlaying(true); setHurry(false);
  fakeIdle(() => null);
  const t = await took(idle(6));
  assert.ok(t >= 20 && t < 110, `${t.toFixed(0)} ms`);
  // (and with only scraps of idle time: never enough for the piece, it still gets its turn)
  fakeIdle(() => 1);
  const t2 = await took(idle(6));
  assert.ok(t2 >= 20 && t2 < 130, `${t2.toFixed(0)} ms`);
});

test('hurried (a fast travel waiting on a map): the next task, and one waiting for idle time goes at once', async () => {
  setPlaying(true); setHurry(true);
  fakeIdle(() => null);
  assert.ok(await took(idle(6)) < 20);
  setHurry(false);
  fakeIdle(() => 1);
  const p = took(idle(6));
  await sleep(8);
  setHurry(true);
  assert.ok(await p < 40, 'let go when the hurry began');
  setHurry(false); setPlaying(false);
  delete globalThis.requestIdleCallback;
});
