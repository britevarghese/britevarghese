// Room server tests with fake sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { Lobby, normalizeCode } = require('../server/rooms.js');

class FakeWs extends EventEmitter {
  constructor() { super(); this.sent = []; this.bins = []; this.closed = null; }
  send(data) { if (Buffer.isBuffer(data)) this.bins.push(data); else this.sent.push(JSON.parse(data)); }
  bin(buf) { this.emit('message', buf, true); }
  close(code, reason) { this.closed = { code, reason }; this.emit('close'); }
  msg(obj) { this.emit('message', JSON.stringify(obj), false); }
  last(t) { for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].t === t) return this.sent[i]; return null; }
}

function join(lobby, name, room, map) {
  const ws = new FakeWs();
  lobby.addConnection(ws);
  ws.msg({ t: 'hello', name, room, map });
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

test('a room drives the map its first player picked; friends who join drive it too', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.25 });
  const a = join(lobby, 'Ana', undefined, 'kerala');
  const w = a.last('welcome');
  assert.equal(w.map, 'kerala');
  assert.equal(join(lobby, 'Ben', w.room, 'ashwood').last('welcome').map, 'kerala', 'the room\'s map, not the one asked for');
  assert.equal(join(lobby, 'Cy').last('welcome').map, 'ashwood', 'no pick: the first map');
  assert.equal(join(lobby, 'Di', undefined, '../../etc').last('welcome').map, 'ashwood', 'junk: the first map');
});

test('a room everyone has left opens again on the map of whoever comes back first, without the old map\'s beacons', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.3 });
  const a = join(lobby, 'Ana', undefined, 'kerala'), code = a.last('welcome').room;
  a.msg({ t: 'beacon', id: 3 });
  const b = join(lobby, 'Ben', code, 'ashwood');
  assert.equal(b.last('welcome').map, 'kerala', 'someone is in it: its map');
  assert.deepEqual(b.last('welcome').beacons, [3]);
  a.close(); b.close();
  const c = join(lobby, 'Ana', code, 'ashwood');
  assert.equal(c.last('welcome').map, 'ashwood', 'empty: the map asked for');
  assert.deepEqual(c.last('welcome').beacons, [], 'no beacons from the other map');
  assert.equal(join(lobby, 'Ben', code, 'kerala').last('welcome').map, 'ashwood', 'and friends join it there');
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
  a.msg(state(0, { winch: { to: idB, a: [0, 0.5, -2.4], f: [0, 0.6, 2.1], len: 12, ten: 30000, rate: -0.42 } }));
  const room = lobby.rooms.get('WNCHX');
  assert.deepEqual(room.players.get(1).s.winch, { to: idB, a: [0, 0.5, -2.4], f: [0, 0.6, 2.1], len: 12, ten: 30000, rate: -0.42 }, 'with the line\'s speed');
  a.msg(state(0.2, { winch: { to: idB, a: [0, 0.5, -2.4], f: [0, 0.6, 2.1], len: 11.9, ten: 3e4, rate: 'fast' } }));
  assert.equal(room.players.get(1).s.winch.rate, 0, 'junk speed: none');
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

test('races: one opens it, friends join before the start, results end it; a racer who leaves gave up', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.5 });
  const a = join(lobby, 'Ana');
  const code = a.last('welcome').room;
  const b = join(lobby, 'Ben', code), c = join(lobby, 'Cy', code);
  const room = lobby.rooms.get(code);
  a.msg({ t: 'ev', k: 'open', id: 'sanddrag' });
  const open = b.last('ev');
  assert.equal(open.k, 'open'); assert.equal(open.id, 'sanddrag'); assert.equal(open.name, 'Ana');
  assert.ok(open.at > Date.now() + 10000, 'friends get time to join');
  a.msg({ t: 'ev', k: 'open', id: 'bogdash' });                  // one race at a time
  assert.equal(room.race.id, 'sanddrag');
  b.msg({ t: 'ev', k: 'join' });
  assert.deepEqual(c.last('ev').racers.map((r) => r.name), ['Ana', 'Ben']);
  // a newcomer hears about the race in its welcome
  const d = join(lobby, 'Di', code);
  assert.equal(d.last('welcome').race.id, 'sanddrag');
  // the start: times only count after it
  room.race.at = Date.now() - 1;
  c.msg({ t: 'ev', k: 'join' });                                   // too late
  assert.equal(room.race.racers.size, 2);
  a.msg({ t: 'ev', k: 'done', time: 12.345 });
  assert.equal(c.last('ev').k, 'done');
  assert.equal(c.last('ev').time, 12.35);
  assert.ok(room.race, 'still waiting for Ben');
  b.close();                                                       // Ben leaves: he gave up
  const end = a.last('ev');
  assert.equal(end.k, 'end');
  assert.deepEqual(end.results, [{ id: 1, name: 'Ana', time: 12.35 }, { id: 2, name: 'Ben', time: null }]);
  assert.equal(room.race, null);
  // the next race can be opened
  c.msg({ t: 'ev', k: 'open', id: 'trials' });
  assert.equal(room.race.id, 'trials');
  c.msg({ t: 'ev', k: 'done', time: 5 });                         // before the start: not a time
  const done = a.sent.filter((m) => m.t === 'ev' && m.k === 'done').pop();
  assert.equal(done.time, null);
  assert.equal(a.last('ev').k, 'end', 'Cy was its only racer');
});

test('races: junk event ids are ignored; a race is called after its time limit', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.5 });
  const a = join(lobby, 'Ana');
  const room = lobby.rooms.get(a.last('welcome').room);
  a.msg({ t: 'ev', k: 'open', id: '<script>' });
  a.msg({ t: 'ev', k: 'open', id: 7 });
  assert.equal(room.race, null);
  a.msg({ t: 'ev', k: 'open', id: 'hillclimb' });
  room.race.at = Date.now() - 12 * 60 * 1000;
  room.tick();
  assert.equal(room.race, null);
  assert.deepEqual(a.last('ev').results, [{ id: 1, name: 'Ana', time: null }]);
});

test('voice chat: who is in it, connection offers passed between two in it, audio relayed to the rest of it', () => {
  const lobby = new Lobby({ maxPlayers: 4, rand: () => 0.3 });
  const a = join(lobby, 'Ana'), code = a.last('welcome').room;
  const b = join(lobby, 'Ben', code), c = join(lobby, 'Cy', code);
  const idA = a.last('welcome').id, idB = b.last('welcome').id, idC = c.last('welcome').id;
  // an offer before both are in voice goes nowhere
  a.msg({ t: 'rtc', to: idB, d: { type: 'offer', sdp: 'v=0' } });
  assert.equal(b.last('rtc'), null);
  a.msg({ t: 'voice', on: 1, mic: 1 });
  assert.deepEqual(b.last('voice'), { t: 'voice', id: idA, on: 1, mic: 1, mute: 0 });
  assert.equal(a.last('voice'), null, 'not echoed back');
  b.msg({ t: 'voice', on: 1, mic: 1, mute: 1 });
  a.msg({ t: 'rtc', to: idB, d: { type: 'offer', sdp: 'v=0' } });
  assert.deepEqual(b.last('rtc'), { t: 'rtc', from: idA, d: { type: 'offer', sdp: 'v=0' } });
  assert.equal(c.last('rtc'), null, 'only to the one it is for');
  a.msg({ t: 'rtc', to: idC, d: { type: 'offer', sdp: 'v=0' } });
  assert.equal(c.last('rtc'), null, 'not to one outside the voice chat');
  a.msg({ t: 'rtc', to: idB, d: { sdp: 'x'.repeat(20000) } });
  assert.equal(b.sent.filter((m) => m.t === 'rtc').length, 1, 'an oversized offer is dropped');
  // a relayed frame: to the others in voice, with who said it; not to Cy, not back to Ana
  a.bin(Buffer.from([1, 0, 7, 9, 8, 7, 6, 5]));
  assert.equal(b.bins.length, 1);
  assert.deepEqual([...b.bins[0]], [1, 0, idA, 0, 7, 9, 8, 7, 6, 5]);
  assert.equal(c.bins.length, 0);
  assert.equal(a.bins.length, 0);
  // too many frames in a second: the rest are dropped
  for (let i = 0; i < 60; i++) a.bin(Buffer.from([1, 0, i, 1, 2, 3, 4, 5]));
  assert.ok(b.bins.length <= 41, `${b.bins.length} frames in a second`);
  // whoever joins later sees who is in voice
  const d = join(lobby, 'Di', code);
  const ps = d.last('welcome').players;
  assert.deepEqual(ps.map((p) => [p.name, p.voice || 0, p.mic || 0, p.mute || 0]), [['Ana', 1, 1, 0], ['Ben', 1, 1, 1], ['Cy', 0, 0, 0]]);
  // leaving the voice chat
  a.msg({ t: 'voice', on: 0 });
  assert.deepEqual(b.last('voice'), { t: 'voice', id: idA, on: 0, mic: 0, mute: 0 });
  a.bin(Buffer.from([1, 0, 99, 1, 2, 3, 4, 5]));
  assert.ok(!b.bins.some((f) => f[4] === 99), 'out of the voice chat: nothing relayed');
});
