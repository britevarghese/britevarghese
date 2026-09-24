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
  assert.equal(pub.length, maps.length, 'one default public room per map');
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

import { Room } from '../server/rooms.js';
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
