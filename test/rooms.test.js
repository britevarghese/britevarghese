// Rooms / lobby: create private rooms over HTTP, list, join by code with password, per-room maps, isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 3998, BASE = `http://localhost:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const join = (room, msg) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${room}`);
  const got = [];
  ws.on('message', (d) => { const m = JSON.parse(d); got.push(m); if (m.t === 'welcome' || m.t === 'error') resolve({ ws, first: m, got }); });
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room, name: 'Tester', ...msg })));
});

test('lobby: public rooms per map, private rooms with codes and passwords', async (t) => {
  const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BOTS: '2' }, stdio: 'pipe' });
  t.after(() => srv.kill());
  await new Promise((r) => srv.stdout.on('data', (d) => d.toString().includes('running') && r()));
  const maps = await (await fetch(`${BASE}/api/maps`)).json();
  assert.ok(maps.length >= 4, 'at least 4 maps');
  const pub = await (await fetch(`${BASE}/api/rooms`)).json();
  assert.equal(pub.length, maps.length + 1, 'one default public room per map, plus Team Deathmatch');
  assert.equal(pub.filter((r) => r.mode === 'tdm').length, 1, 'the Team Deathmatch room');
  assert.deepEqual(new Set(pub.map((r) => r.map)), new Set(maps.map((m) => m.id)));

  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Squad <b>night</b>', map: 'harbor', bots: 1, private: true, password: 'hunter2' }) });
  const room = await res.json();
  assert.equal(res.status, 200);
  assert.match(room.id, /^[A-Z0-9]{6}$/);
  assert.equal(room.map, 'harbor');
  assert.equal(room.name.includes('<'), false, 'name sanitised');
  const list = await (await fetch(`${BASE}/api/rooms`)).json();
  assert.equal(list.some((r) => r.id === room.id), false, 'private room hidden from browser');
  assert.equal((await fetch(`${BASE}/api/rooms/${room.id.toLowerCase()}`)).status, 200, 'code lookup is case-insensitive');

  const bad = await join(room.id, { password: 'nope' });
  assert.equal(bad.first.t, 'error'); assert.equal(bad.first.code, 'password');
  bad.ws.close();
  const ok = await join(room.id, { password: 'hunter2' });
  assert.equal(ok.first.t, 'welcome');
  assert.equal(ok.first.room.map, 'harbor');
  const none = await join('ZZZZZZ', {});
  assert.equal(none.first.code, 'noroom');
  none.ws.close();

  // a player in another room must not appear in this room's snapshots
  const other = await join('VALLEY', {});
  assert.equal(other.first.room.map, 'valley');
  await wait(600);
  const snaps = ok.got.filter((m) => m.t === 'snap');
  assert.ok(snaps.length > 0, 'room is ticking once a human joined');
  assert.equal(snaps.at(-1).f.length, 4, 'harbor has 4 flags');
  assert.ok(!snaps.some((s) => s.p.some((r) => r[0] === other.first.id)), 'rooms are isolated');
  ok.ws.close(); other.ws.close();
});

import { Room, RoomManager } from '../server/rooms.js';
import { Game } from '../server/game.js';
import { MAP_IDS } from '../shared/map.js';

test('every map: bases can reach every flag, spawns are valid', () => {
  for (const id of MAP_IDS) {
    const g = new Game({ botsPerTeam: 0, map: id, log: () => {} });
    for (const t of [1, 2]) {
      const b = g.map.BASES[t];
      for (const f of g.map.FLAGS) assert.ok(g.nav.findPath(b.x, b.z, f.x, f.z, 400000), `${id}: team ${t} base cannot reach flag ${f.id}`);
      const p = g.addPlayer({ name: 'x', team: t });
      p.respawnAt = 0; assert.ok(g.spawn(p, 'base'), `${id}: spawn failed`);
      assert.ok(Math.abs(p.y - g.map.groundHeight(p.x, p.z)) < 1.5, `${id}: spawned off the ground`);
      assert.ok(!g.world.resolveHorizontal({ x: p.x, z: p.z }, p.y, 1.8), `${id}: spawned inside geometry`);
    }
  }
});

test('room rotates to the next map after a round', () => {
  const r = new Room({ id: 'TEST01', name: 't', map: 'outskirts', botsPerTeam: 0, rotation: true });
  const fake = { readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() { this.closed = true; } };
  assert.equal(r.join(fake, { name: 'a' }), null);
  r.game.roundOver = { winner: 1, at: Date.now() - 14000 };
  r.tick(1 / 30, Date.now());
  assert.equal(r.mapId, MAP_IDS[1]);
  assert.ok(fake.sent.some((m) => m.t === 'mapchange' && m.map === MAP_IDS[1]));
  assert.equal(r.clients.size, 0);
});

test('a player-made room survives its own map rotation: the players are away reloading, not gone', () => {
  const M = new RoomManager({ log: () => {} });
  const r = M.create({ name: 'mine', map: 'outskirts', botsPerTeam: 0, rotation: true });
  const fake = { readyState: 1, send() {}, close() {} };
  assert.equal(r.join(fake, { name: 'a' }), null);
  // the room has been up for a whole round
  r.createdAt -= 20 * 60000; r.emptySince -= 20 * 60000;
  r.game.roundOver = { winner: 1, at: Date.now() - 14000 };
  M.tick(1 / 30);
  assert.equal(r.clients.size, 0, 'everyone sent off to reload');
  assert.ok(M.get(r.id) === r, 'the room is still there for them to come back to'); // (ok, not equal: a failure would try to print the whole game)
  assert.equal(r.mapId, MAP_IDS[1]);
  // ...but an abandoned one is still closed after two minutes
  r.emptySince -= 121000;
  M.tick(1 / 30);
  assert.equal(M.get(r.id), undefined);
});

test('joining during the end-of-round screen: the newcomer gets the result and the time left, flagged as not his round', () => {
  const r = new Room({ id: 'TEST02', name: 't', map: 'outskirts', botsPerTeam: 2, rotation: false });
  const mk = () => ({ readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {} });
  const early = mk();
  r.join(early, { name: 'early' });
  assert.ok(!early.sent.some((m) => m.t === 'ev' && m.e.t === 'round'), 'nothing of the kind mid-round');
  r.game.roundOver = { winner: 2, at: Date.now() - 6000 };
  const late = mk();
  r.join(late, { name: 'late' });
  const ev = late.sent.find((m) => m.t === 'ev' && m.e.t === 'round')?.e;
  assert.ok(ev, 'told the round is over');
  assert.equal(ev.winner, 2); assert.equal(ev.late, 1);
  assert.ok(ev.next > 8000 && ev.next <= 9000, `time left to the next round (${ev.next} ms)`);
  assert.ok(Array.isArray(ev.ps) && ev.ps.some((x) => x[1] === 'early') && ev.tk.length === 2, 'with the final scoreboard');
  assert.ok(late.sent.findIndex((m) => m.t === 'welcome') < late.sent.findIndex((m) => m.t === 'ev' && m.e.t === 'round'), 'after the welcome');
});

test('a client sending garbage cannot take the server down: oversized, binary and malformed frames only cost it its own connection', async (t) => {
  const P2 = 3996;
  const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: P2, BOTS: '1' }, stdio: 'pipe' });
  t.after(() => srv.kill());
  let exited = false; srv.on('exit', () => { exited = true; });
  await new Promise((r) => srv.stdout.on('data', (d) => d.toString().includes('running') && r()));
  const open = () => new Promise((r, j) => { const ws = new WebSocket(`ws://localhost:${P2}/ws`); ws.on('error', () => j(new Error('the server no longer accepts connections'))); ws.on('open', () => r(ws)); });
  const health = async () => { try { return (await fetch(`http://localhost:${P2}/api/health`)).ok; } catch { return false; } };
  // a well-behaved player in a room, to see the game carries on for him
  const good = await open();
  let snaps = 0; good.on('message', (d) => { if (JSON.parse(d).t === 'snap') snaps++; });
  good.send(JSON.stringify({ t: 'join', room: 'OUTSKIRTS', name: 'Good' }));
  for (const junk of ['x'.repeat(40000), Buffer.alloc(30000, 7), '{"t":', 'null', '[]', '{"t":"join","room":{"a":1}}', JSON.stringify({ t: 'join', room: 'OUTSKIRTS', name: { toString: 1 } })]) {
    const bad = await open();
    bad.send(junk);
    await wait(150);
    bad.terminate();
  }
  // room, map and kit names that are keys of every object
  const res = await fetch(`http://localhost:${P2}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', map: 'constructor', botsPerTeam: 1 }) });
  assert.equal(res.status, 200, 'an unknown map falls back to the default one');
  const made = await res.json();
  const odd = await open();
  const welcome = new Promise((r) => odd.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'welcome' || m.t === 'error') r(m); }));
  odd.send(JSON.stringify({ t: 'join', room: made.id, name: 'Odd', cls: '__proto__' }));
  assert.equal((await welcome).cls, 'assault', 'an unknown kit falls back to assault');
  odd.send(JSON.stringify({ t: 'spawn', p: 'constructor', cls: 'constructor' }));
  odd.terminate();
  // joined, then garbage of every message type
  const bad = await open();
  bad.send(JSON.stringify({ t: 'join', room: 'OUTSKIRTS', name: 'Bad' }));
  await wait(100);
  for (const type of ['in', 'fire', 'nade', 'spawn', 'team', 'chat', 'pong', 'pick', 'venter', 'revive', 'spot', 'order', 'vseat', 'vin', 'vfire']) {
    for (const body of [{}, { o: 'x', d: 'y', p: {}, id: 'z', f: 5, msg: {}, seat: 'q', team: 'x' }, { o: [1e999, 0, 0], d: [0, 0, 0], k: 1e999, yaw: 1e999, pitch: 1e999, dt: 1e999, x: 1e999, y: 1e999, z: 1e999 }]) bad.send(JSON.stringify({ t: type, ...body }).replace(/null/g, '1e999'));
  }
  await wait(400);
  assert.ok(!exited, 'the server process is still running');
  assert.ok(await health(), 'and still answers');
  const before = snaps;
  await wait(400);
  assert.ok(snaps > before, 'the game carries on for the other player');
  good.terminate(); bad.terminate();
});

test('a room whose tick throws does not stop the other rooms; if it keeps failing its round is restarted', () => {
  const logs = [];
  const M = new RoomManager({ log: (m) => logs.push(m) });
  const a = M.create({ id: 'BROKEN', name: 'a', map: 'outskirts', botsPerTeam: 0, persistent: true });
  const b = M.create({ id: 'FINE', name: 'b', map: 'outskirts', botsPerTeam: 0, persistent: true });
  const fake = () => ({ readyState: 1, send() {}, close() {} });
  a.join(fake(), { name: 'x' }); b.join(fake(), { name: 'y' });
  let bTicks = 0, resets = 0;
  const tickB = b.game.tick.bind(b.game); b.game.tick = (dt) => { bTicks++; return tickB(dt); };
  const resetA = a.game.resetRound.bind(a.game); a.game.resetRound = () => { resets++; a.game.tick = tickA; return resetA(); };
  const tickA = a.game.tick.bind(a.game); a.game.tick = () => { throw new Error('boom'); };
  for (let i = 0; i < 89; i++) M.tick(1 / 30);
  assert.equal(bTicks, 89, 'the other room never missed a tick');
  assert.equal(resets, 0);
  assert.ok(logs.some((l) => l.includes('BROKEN') && l.includes('boom')), 'the fault is logged with its cause');
  assert.ok(logs.filter((l) => l.includes('boom')).length <= 2, 'without flooding the log');
  M.tick(1 / 30);
  assert.equal(resets, 1, 'after 3 s of failing ticks the round is restarted');
  M.tick(1 / 30);
  assert.equal(bTicks, 91);
});
