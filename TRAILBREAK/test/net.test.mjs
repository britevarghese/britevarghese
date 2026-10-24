// The multiplayer client's buffer of the others' states (net/NetClient.js): each held at the time its driver took it,
// a state the server sends again (none newer came in) held once, and each player drawn as far behind as their states
// take to come.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NetClient } from '../src/net/NetClient.js';

const state = (x, ts, warp = 0) => ({
  ts, warp, p: [x, 0, 0], q: [0, 0, 0, 1], v: [10, 0, 0], w: [0, 0, 0], wh: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  rpm: 1500, thr: 0.5, truck: 'thar', cfg: '', paint: '#b5532c', lights: 0, winch: null,
});

test('net: states held at their drivers\' times, a state sent twice held once', () => {
  const n = new NetClient({ name: 'me' });
  n.id = 1; n.offset = 0;
  const t0 = Date.now();
  // the server's ticks: a new state, the same state again (none came in between), then the next
  n.handle({ t: 'snapshot', time: t0, players: [{ id: 2, name: 'b', s: state(0, t0 - 40) }] });
  n.handle({ t: 'snapshot', time: t0 + 50, players: [{ id: 2, name: 'b', s: state(0, t0 - 40) }] });
  n.handle({ t: 'snapshot', time: t0 + 100, players: [{ id: 2, name: 'b', s: state(0.5, t0 + 10) }] });
  const r = n.remotes.get(2);
  assert.equal(r.snaps.length, 2);
  assert.deepEqual(r.snaps.map((q) => Math.round(q.t * 1000) - t0), [-40, 10]);
  // a respawn starts the buffer again
  n.handle({ t: 'snapshot', time: t0 + 150, players: [{ id: 2, name: 'b', s: state(500, t0 + 60, 1) }] });
  assert.equal(r.snaps.length, 1);
});

test('net: each player drawn as far behind as their states take to come', () => {
  const n = new NetClient({ name: 'me' });
  n.id = 1; n.offset = 0;
  // one whose states come 50 ms after they're taken, one 250 ms after
  for (let k = 0; k < 20; k++) {
    const now = Date.now();
    n.handle({ t: 'snapshot', time: now, players: [{ id: 2, name: 'near', s: state(k, now - 50 + k * 0.5) }, { id: 3, name: 'far', s: state(k, now - 250 + k * 0.5) }] });
  }
  const a = n.remotes.get(2), b = n.remotes.get(3);
  assert.ok(Math.abs(a.delayTarget - 0.08) < 0.02, `near: ${a.delayTarget.toFixed(3)} s`);
  assert.ok(Math.abs(b.delayTarget - 0.28) < 0.02, `far: ${b.delayTarget.toFixed(3)} s`);
  assert.ok(n.leadOf(b) > 0 && Number.isFinite(n.sample(b).pos[0]));
});
