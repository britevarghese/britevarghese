// Path finding and line of sight are the server's hot loops (every bot, every tick). Their fast versions must give
// exactly the answers of the plain ones, and the work must stay spread out: one tick is shared by every room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { NavGrid } from '../server/nav.js';

const quiet = () => {};
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// the search as first written: Maps, a Set and a heap of pairs (slow, but plainly right)
class PlainNav extends NavGrid {
  constructor(from) { super({ map: { PLAY_HALF: 1, groundHeight: () => 0 }, supportHeight: () => 0, query: () => [], boxes: [] }, 1); Object.assign(this, from); }
  findPath(sx, sz, tx, tz, maxExpand = 60000, sy) {
    const s = this.nearestFreeFrom(sx, sz, sy), t = this.nearestFree(this.ix(tx), this.iz(tz));
    if (!s || !t) return null;
    const N = this.n, start = s[1] * N + s[0], goal = t[1] * N + t[0];
    const g = new Map([[start, 0]]), came = new Map(), heap = [[0, start]], closed = new Set();
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (k) => { const dx = Math.abs((k % N) - t[0]), dz = Math.abs(((k / N) | 0) - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    let expanded = 0, found = false;
    while (heap.length && expanded < maxExpand) {
      const [, k] = pop();
      if (k === goal) { found = true; break; }
      if (closed.has(k)) continue;
      closed.add(k); expanded++;
      const ci = k % N, cj = (k / N) | 0, gk = g.get(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const nk = nj * N + ni, ng = gk + (di && dj ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, k); push(ng + h(nk), nk); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== undefined; k = came.get(k)) { cells.push(k); if (k === start) break; }
    cells.reverse();
    const pts = [cells[0]];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) if (!this.gridLOS(cells[anchor], cells[i]) || !this.bodyClear(cells[anchor], cells[i])) { anchor = i - 1; pts.push(cells[anchor]); }
    pts.push(cells[cells.length - 1]);
    return pts.map((k) => ({ x: this.cx(k % N), z: this.cz((k / N) | 0) }));
  }
}

test('path finding: the fast search returns exactly the waypoints of the plain one (also when it gives up or there is no way)', () => {
  for (const map of ['compound', 'oldtown']) {
    const g = new Game({ botsPerTeam: 0, map, log: quiet }), plain = new PlainNav(g.nav), H = g.map.PLAY_HALF, rnd = rng(map.length);
    let found = 0, none = 0;
    for (let i = 0; i < 70; i++) {
      const far = rnd() < 0.6, x0 = (rnd() - 0.5) * 1.9 * H, z0 = (rnd() - 0.5) * 1.9 * H;
      const x1 = far ? (rnd() - 0.5) * 1.9 * H : x0 + (rnd() - 0.5) * 50, z1 = far ? (rnd() - 0.5) * 1.9 * H : z0 + (rnd() - 0.5) * 50;
      const limit = i % 6 === 0 ? 400 : undefined, sy = g.map.groundHeight(x0, z0);
      const a = plain.findPath(x0, z0, x1, z1, limit, sy), b = g.nav.findPath(x0, z0, x1, z1, limit, sy);
      assert.deepEqual(b, a, `${map}: (${x0.toFixed(1)}, ${z0.toFixed(1)}) -> (${x1.toFixed(1)}, ${z1.toFixed(1)})`);
      if (a) found++; else none++;
    }
    assert.ok(found > 30 && none > 0, `${map}: both outcomes covered (${found} routes, ${none} without)`);
  }
});

test('line of sight: the yes / no test agrees with the full ray cast on every kind of ray, vehicles included', () => {
  for (const map of ['oldtown', 'airfield']) {
    const g = new Game({ botsPerTeam: 0, map, log: quiet }), w = g.world, H = g.map.PLAY_HALF, gh = g.map.groundHeight, rnd = rng(7 + map.length);
    g.vehicles.tick(1 / 30, g.now()); // (builds the vehicles' colliders)
    w.dynamic = g.vehicles.colliders;
    assert.ok(w.dynamic.length > 0, 'vehicles on the map');
    const full = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); return L < 1e-4 || !w.raycast(a, { x: dx / L, y: dy / L, z: dz / L }, L - 0.05, true); };
    let clear = 0, blocked = 0;
    for (let i = 0; i < 12000; i++) {
      const kind = i % 5;
      let a, b;
      if (kind < 2) { // along the ground: knee height (path smoothing), eye to chest (what a bot sees)
        const x = (rnd() - 0.5) * 1.9 * H, z = (rnd() - 0.5) * 1.9 * H, an = rnd() * 6.2832, L = 0.5 + rnd() * rnd() * 250, bx = x + Math.cos(an) * L, bz = z + Math.sin(an) * L;
        a = { x, y: gh(x, z) + (kind ? 1.6 : 0.5), z }; b = { x: bx, y: gh(bx, bz) + (kind ? 0.3 + rnd() * 1.4 : 0.5), z: bz };
      } else if (kind === 2) { // around a box: from inside it, from exactly on a face, along an axis
        const bb = w.boxes[Math.floor(rnd() * w.boxes.length)], m = rnd();
        a = { x: bb.min[0] + (bb.max[0] - bb.min[0]) * (rnd() * 1.4 - 0.2), y: bb.min[1] + (bb.max[1] - bb.min[1]) * (rnd() * 1.4 - 0.2), z: bb.min[2] + (bb.max[2] - bb.min[2]) * (rnd() * 1.4 - 0.2) };
        if (rnd() < 0.3) a.x = bb.max[0];
        b = m < 0.3 ? { x: a.x, y: a.y, z: a.z + (rnd() - 0.5) * 30 } : m < 0.6 ? { x: a.x + (rnd() - 0.5) * 30, y: a.y, z: a.z } : m < 0.7 ? { x: a.x, y: a.y + (rnd() - 0.5) * 20, z: a.z } : { x: a.x + (rnd() - 0.5) * 40, y: a.y + (rnd() - 0.5) * 6, z: a.z + (rnd() - 0.5) * 40 };
      } else if (kind === 3) { // steep: out of the air into the ground
        const x = (rnd() - 0.5) * 1.9 * H, z = (rnd() - 0.5) * 1.9 * H;
        a = { x, y: gh(x, z) + rnd() * 60, z }; b = { x: x + (rnd() - 0.5) * 80, y: gh(x, z) + (rnd() - 0.3) * 30, z: z + (rnd() - 0.5) * 80 };
      } else { // across a vehicle (sometimes the one being ignored), down to a few centimetres long
        const v = g.vehicles.list[Math.floor(rnd() * g.vehicles.list.length)], x = v.x + (rnd() - 0.5) * 12, z = v.z + (rnd() - 0.5) * 12, L = rnd() < 0.3 ? rnd() * 0.2 : rnd() * 15, an = rnd() * 6.2832;
        a = { x, y: v.y + rnd() * 3, z }; b = { x: x + Math.cos(an) * L, y: a.y + (rnd() - 0.5) * 2, z: z + Math.sin(an) * L };
        w.ignoreOwner = rnd() < 0.3 ? v.id : null;
      }
      const want = full(a, b), got = w.lineOfSight(a, b);
      assert.equal(got, want, `${map}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      if (got) clear++; else blocked++;
      w.ignoreOwner = null;
    }
    assert.ok(clear > 2000 && blocked > 2000, `${map}: both outcomes covered (${clear} clear, ${blocked} blocked)`);
  }
});

test('bots plan their routes when they spawn, a few ticks apart: not all in the tick they are added, nor all at once after a round restart', () => {
  const g = new Game({ botsPerTeam: 8, map: 'outskirts', log: quiet }); g.clock = 1_000_000;
  g.addPlayer({ name: 'H', team: 1 });
  let searches = 0, most = 0;
  const find = g.nav.findPath.bind(g.nav); g.nav.findPath = (...a) => { searches++; return find(...a); };
  const tick = () => { const before = searches; g.clock += 1000 / 30; g.tick(1 / 30); g.flushEvents(); most = Math.max(most, searches - before); };
  try {
    tick();
    const bots = [...g.players.values()].filter((p) => p.bot);
    assert.equal(bots.length, 15, 'the bots are in');
    assert.equal(searches, 0, 'and none has planned a route from nowhere');
    for (let i = 0; i < 120; i++) tick();
    assert.ok(bots.every((p) => p.alive || p.deaths), 'all of them deployed');
    assert.ok(most <= 4, `route planning is spread over the ticks (at most ${most} searches in one)`);
    // a round restart: everyone is sent back, the bots return over the next second or so
    g.tickets[2] = 0; tick();
    assert.ok(g.roundOver, 'round over');
    g.clock += 15100; most = 0; tick();
    assert.ok(!g.roundOver, 'next round');
    const times = bots.map((p) => p.respawnAt).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 60, 'no two bots come back in the same tick');
    for (let i = 0; i < 120; i++) tick();
    assert.ok(bots.every((p) => p.alive || p.deaths), 'all of them back');
    assert.ok(most <= 4, `and again nothing piles up (at most ${most} searches in one tick)`);
  } finally { g.nav.findPath = find; }
});
