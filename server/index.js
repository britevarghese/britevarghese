// STRIKEPOINT server: static client + authoritative WebSocket game server.
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, TICK_HZ, SNAP_HZ } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 3000;
const BOTS = process.env.BOTS !== undefined ? +process.env.BOTS : 8;

const app = express();
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/assets', express.static(path.join(ROOT, 'client/assets'), { maxAge: '1h', fallthrough: false }));
for (const r of ['character', 'weapon', 'character-weapon', 'ads', 'scale']) app.get(`/debug/${r}`, (_, res) => res.sendFile(path.join(ROOT, 'client/debug.html')));
// list of asset files actually present (lets the client resolve manifest fallback chains without 404 probing)
const listFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`]));
app.get('/api/assets', (_, res) => res.json(listFiles(path.join(ROOT, 'client/assets')).filter((f) => /\.(glb|gltf)$/i.test(f))));
app.get('/api/health', (_, res) => res.json({ ok: true, players: game.players.size }));
app.use(express.static(path.join(ROOT, 'client')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const game = new Game({ botsPerTeam: BOTS });

const clients = new Map(); // ws -> player
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

wss.on('connection', (ws) => {
  let player = null;
  let chatTokens = 3;
  const chatTimer = setInterval(() => { chatTokens = Math.min(3, chatTokens + 1); }, 2000);
  ws.on('message', (buf) => {
    let m;
    try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!player) {
      if (m.t !== 'join') return;
      player = game.addPlayer({ name: m.name, team: m.team, cls: m.cls, send: (x) => send(ws, x) });
      player.ws = ws;
      clients.set(ws, player);
      send(ws, { t: 'welcome', id: player.id, team: player.team, cls: player.cls, tickHz: TICK_HZ, snapHz: SNAP_HZ });
      send(ws, game.scoreboard());
      game.emit({ t: 'chat', from: 'SERVER', msg: `${player.name} joined ${player.team === 1 ? 'US' : 'RU'}` });
      return;
    }
    switch (m.t) {
      case 'in': game.handleInput(player, m); break;
      case 'fire': if (Array.isArray(m.d)) game.tryFire(player, m.o, m.d, m.ct); break;
      case 'reload': game.reload(player); break;
      case 'nade': if (Array.isArray(m.d)) game.throwGrenade(player, m.o, m.d); break;
      case 'spawn': game.spawn(player, m.p, m.cls); break;
      case 'team':
        if (!player.alive && (m.team === 1 || m.team === 2)) player.team = m.team;
        break;
      case 'chat':
        if (chatTokens > 0 && typeof m.msg === 'string' && m.msg.trim()) { chatTokens--; game.emit({ t: 'chat', from: player.name, tm: player.team, msg: m.msg.trim().slice(0, 120) }); }
        break;
      case 'pong': if (typeof m.s === 'number') player.rtt = player.rtt * 0.7 + Math.min(1000, Date.now() - m.s) * 0.3; break;
      case 'suicide': game.kill(player, null, 'suicide'); break;
    }
  });
  ws.on('close', () => {
    clearInterval(chatTimer);
    if (player) { game.emit({ t: 'chat', from: 'SERVER', msg: `${player.name} left` }); game.removePlayer(player.id); }
    clients.delete(ws);
  });
});

let last = Date.now(), snapAcc = 0, boardAcc = 0, pingAcc = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.tick(dt);
  // events
  for (const { ev, only, ids } of game.flushEvents()) {
    const s = JSON.stringify({ t: 'ev', e: ev });
    for (const [ws, p] of clients) {
      if (only !== null && p.id !== only) continue;
      if (ids && !ids.includes(p.id)) continue;
      send(ws, s);
    }
  }
  snapAcc += dt; boardAcc += dt; pingAcc += dt;
  if (snapAcc >= 1 / SNAP_HZ) {
    snapAcc = 0;
    const snap = game.snapshot();
    for (const [ws, p] of clients) {
      snap.me = { hp: Math.max(0, Math.round(p.hp)), alive: p.alive, w: p.weapons, sl: p.slot, g: p.grenades, rl: Math.max(0, p.reloadUntil - now), rs: Math.max(0, p.respawnAt - now), sp: p.spawnPoint };
      send(ws, snap);
    }
  }
  if (boardAcc >= 1) { boardAcc = 0; const b = JSON.stringify(game.scoreboard()); for (const ws of clients.keys()) send(ws, b); }
  if (pingAcc >= 2) { pingAcc = 0; for (const ws of clients.keys()) send(ws, { t: 'ping', s: now }); }
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  const hasUserChar = fs.existsSync(path.join(ROOT, 'client/assets/user'));
  console.log(`STRIKEPOINT running on http://localhost:${PORT}  (bots per team: ${BOTS}${hasUserChar ? ', user asset overrides present' : ''})`);
});

export { game, server };
