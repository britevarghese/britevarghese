// Integration: two WebSocket clients join, spawn, see each other in snapshots, chat, and shoot (server-authoritative).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { groundHeight } from '../shared/map.js';

const PORT = 3999;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name, team) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, msgs: [], snaps: [], events: [] };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'snap') c.snaps.push(m); else if (m.t === 'ev') c.events.push(m.e); else c.msgs.push(m);
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', s: m.s }));
  });
  c.open = new Promise((r) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', name, team, cls: 'assault' })); r(); }));
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}

test('multiplayer join / spawn / snapshot / chat / shoot', async (t) => {
  const srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, BOTS: '0' }, stdio: 'pipe' });
  t.after(() => srv.kill());
  await new Promise((r) => srv.stdout.on('data', (d) => d.toString().includes('running') && r()));
  const a = client('Alpha', 1), b = client('Bravo', 2);
  await Promise.all([a.open, b.open]);
  await wait(300);
  const wa = a.msgs.find((m) => m.t === 'welcome'), wb = b.msgs.find((m) => m.t === 'welcome');
  assert.ok(wa && wb);
  assert.equal(wa.team, 1); assert.equal(wb.team, 2);
  a.send({ t: 'spawn', p: 'base' }); b.send({ t: 'spawn', p: 'base' });
  await wait(400);
  const sa = a.events.find((e) => e.t === 'spawn' && e.id === wa.id);
  const sb = b.events.find((e) => e.t === 'spawn' && e.id === wb.id);
  assert.ok(sa && sb, 'both spawned');
  // move both to open ground facing each other, 20 m apart
  const place = (c, id, x, z, yaw) => c.send({ t: 'in', x, y: groundHeight(x, z), z, yaw, pitch: 0, st: 'stand', ads: false, sp: false, vx: 0, vz: 0, og: true, sl: 0 });
  // walk there gradually (server rejects teleports)
  for (let i = 0; i <= 170; i++) {
    const k = i / 170;
    place(a, wa.id, sa.x + (100 - sa.x) * k, sa.z + (60 - sa.z) * k, 0);
    place(b, wb.id, sb.x + (100 - sb.x) * k, sb.z + (40 - sb.z) * k, Math.PI);
    await wait(120);
  }
  await wait(300);
  const last = a.snaps[a.snaps.length - 1];
  assert.ok(last.p.some((r) => r[0] === wb.id), 'A sees B in snapshots');
  a.send({ t: 'chat', msg: 'hello' });
  await wait(200);
  assert.ok(b.events.some((e) => e.t === 'chat' && e.msg === 'hello'));
  // A shoots at B's chest
  const me = last.p.find((r) => r[0] === wa.id), other = last.p.find((r) => r[0] === wb.id);
  const o = [me[1], me[2] + 1.64, me[3]];
  const tgt = [other[1], other[2] + 1.2, other[3]];
  const d = tgt.map((v, i) => v - o[i]); const L = Math.hypot(...d);
  a.send({ t: 'fire', o, d: d.map((v) => v / L) });
  await wait(300);
  const hurt = b.events.find((e) => e.t === 'hurt' && e.v === wb.id);
  assert.ok(hurt, 'B took damage from server-validated shot');
  assert.ok(a.events.some((e) => e.t === 'hitmark'));
  a.ws.close(); b.ws.close();
});
