// Room server tests with fake sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { Lobby, normalizeCode } = require('../server/rooms.js');

class FakeWs extends EventEmitter {
  constructor() { super(); this.sent = []; this.closed = null; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
  msg(obj) { this.emit('message', JSON.stringify(obj), false); }
  last(t) { for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i]; return null; }
}

function join(lobby, name, room) {
  const ws = new FakeWs();
  lobby.addConnection(ws);
  ws.msg({ t: 'hello', name, room });
  return ws;
}

const state = (x, extra = {}) => ({ t: 'state', s: { p: [x, 10, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], wh: [[0.1, 0, 0], [0.1, 0, 0], [0.1, 0, 0], [0.1, 0, 0]], rpm: 900, truck: 'ranger', paint: '#aa5533', ...extra } });

test('room codes: normalised, unambiguous alphabet', () => {
  assert.equal(normalizeCode(' abcde '), 'ABCDE');
  assert.equal(normalizeCode('AB0DE'), null);      // no zero
  assert.equal(normalizeCode('ABI23'), null);      // no I
  assert.equal(normalizeCode('AB'), null);
});

test('a new player gets a fresh room; friends join it by code', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.5 });
  const a = join(lobby, 'Ana');
  const w = a.last('welcome');
  assert.ok(w && w.room.length === 5 && w.id === 1);
  const b = join(lobby, 'Ben', w.room.toLowerCase());
  const wb = b.last('welcome');
  assert.equal(wb.room, w.room);
  assert.deepEqual(wb.players.map((p) => p.name), ['Ana']);
  assert.equal(a.last('join').name, 'Ben');
  // someone else without a code lands in a different room
  const c = join(lobby, 'Cy');
  assert.notEqual(c.last('welcome').room, w.room);
});

test('rooms fill up at their limit', () => {
  const lobby = new Lobby({ maxPlayers: 2 });
  const a = join(lobby, 'A', 'TRAPS');
  join(lobby, 'B', 'TRAPS');
  const c = join(lobby, 'C', 'TRAPS');
  assert.match(c.last('error').msg, /full/);
  assert.equal(c.closed.code, 1013);
  a.close();
  const d = join(lobby, 'D', 'TRAPS');
  assert.ok(d.last('welcome'));
});

test('snapshots carry each player state to the room only', () => {
  const lobby = new Lobby();
  const a = join(lobby, 'A', 'MUDDY');
  const b = join(lobby, 'B', 'MUDDY');
  const c = join(lobby, 'C', 'GRAVL');
  a.msg(state(5));
  b.msg(state(7));
  c.msg(state(9));
  for (const r of lobby.rooms.values()) r.tick();
  const snap = b.last('snapshot');
  assert.deepEqual(snap.players.map((p) => p.name).sort(), ['A', 'B']);
  assert.equal(snap.players.find((p) => p.name === 'A').s.p[0], 5);
  assert.deepEqual(c.last('snapshot').players.map((p) => p.name), ['C']);
});

test('a truck\'s build (garage parts) travels with its state; junk is dropped', () => {
  const lobby = new Lobby();
  const a = join(lobby, 'A', 'GEARS');
  const room = lobby.rooms.get('GEARS');
  const me = () => [...room.players.values()][0].s;
  a.msg(state(1, { cfg: '23123132101210' }));
  assert.equal(me().cfg, '23123132101210');
  a.msg(state(2, { cfg: '<script>' }));
  assert.equal(me().cfg, '23123132101210', 'keeps the last good one');
  a.msg(state(3, { cfg: 'x'.repeat(40) }));
  assert.equal(me().cfg, '23123132101210');
});

test('teleports are rejected unless announced', () => {
  const lobby = new Lobby();
  const a = join(lobby, 'A', 'WARPS');
  a.msg(state(0));
  a.msg(state(500));
  assert.ok(a.last('correction'));
  const room = lobby.rooms.get('WARPS');
  assert.equal([...room.players.values()][0].s.p[0], 0);
  a.msg(state(500, { warp: 1 }));
  assert.equal([...room.players.values()][0].s.p[0], 500);
});

test('winch lines to another player are relayed; to a stranger they are dropped', () => {
  const lobby = new Lobby();
  const a = join(lobby, 'A', 'WNCHX');
  const b = join(lobby, 'B', 'WNCHX');
  const idB = b.last('welcome').id;
  a.msg(state(0, { winch: { to: idB, a: [0, 0.5, -2.4], f: [0, 0.6, 2.1], len: 12, ten: 30000 } }));
  const room = lobby.rooms.get('WNCHX');
  assert.deepEqual(room.players.get(1).s.winch, { to: idB, a: [0, 0.5, -2.4], f: [0, 0.6, 2.1], len: 12, ten: 30000 });
  a.msg(state(0.5, { winch: { to: 99, a: [0, 0, 0], f: [0, 0, 0], len: 3 } }));
  assert.equal(room.players.get(1).s.winch, null);
});

test('beacons are shared once, and new arrivals learn which are found', () => {
  const lobby = new Lobby();
  const a = join(lobby, 'A', 'BEACN');
  const b = join(lobby, 'B', 'BEACN');
  a.msg({ t: 'beacon', id: 3 });
  a.msg({ t: 'beacon', id: 3 });
  assert.equal(b.sent.filter((m) => m.t === 'beacon').length, 1);
  assert.equal(b.last('beacon').by, 'A');
  const c = join(lobby, 'C', 'BEACN');
  assert.deepEqual(c.last('welcome').beacons, [3]);
  a.msg({ t: 'beacon', id: 999 });
  assert.equal(b.sent.filter((m) => m.t === 'beacon').length, 1);
});

test('damage: relayed to the room, cleaned, and handed to whoever joins later', () => {
  const lobby = new Lobby({ maxPlayers: 4 });
  const a = join(lobby, 'Ana', 'DENTS');
  const b = join(lobby, 'Ben', 'DENTS');
  a.msg({ t: 'damage', d: { v: 3, n: 2, g: 9, l: 1, f: 2, s: 1, k: 0.2, t: 0.5, d: [[0, 1.2, 1.5, 0, 0, -1, 0.1, 0.6], ['x'], [1, 2, 3]], junk: 'no' } });
  const got = b.last('damage');
  assert.equal(got.id, a.last('welcome').id);
  assert.equal(got.d.g, 2, 'glass clamped');
  assert.equal(got.d.t, 0.1, 'toe clamped');
  assert.equal(got.d.d.length, 1, 'only well-formed dents');
  assert.equal(got.d.junk, undefined);
  assert.equal(a.last('damage'), null, 'not echoed to the sender');
  const c = join(lobby, 'Cy', 'DENTS');
  const ana = c.last('welcome').players.find((p) => p.name === 'Ana');
  assert.equal(ana.dmg.f, 2, 'a late joiner sees the flat tyre');
});
