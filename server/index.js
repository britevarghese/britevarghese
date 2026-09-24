// STRIKEPOINT server: static client, lobby API and authoritative WebSocket game rooms.
import express from 'express';
import compression from 'compression';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { TICK_HZ } from './game.js';
import { RoomManager } from './rooms.js';
import { cleanAgentConfig, testAgentConfig } from './agent.js';
import { mapList, MAP_IDS, MAP_DEFS } from '../shared/map.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.env.PORT || 3000;
const BOTS = process.env.BOTS !== undefined ? +process.env.BOTS : 6;
const DEFAULT_ROOMS = process.env.DEFAULT_ROOMS !== '0';
const MAX_CONN_PER_IP = +process.env.MAX_CONN_PER_IP || 8;

const rooms = new RoomManager();
if (DEFAULT_ROOMS) {
  // one always-on public room per map (they sleep while empty)
  const ids = { outskirts: 'OUTSKIRTS', harbor: 'HARBOR', valley: 'VALLEY', compound: 'ZULU', airfield: 'AIRBASE', oldtown: 'OLDTOWN', ridge: 'RIDGE', firestorm: 'FIRESTORM' };
  const royaleBots = process.env.ROYALE_BOTS !== undefined ? +process.env.ROYALE_BOTS : Math.min(23, BOTS * 2 + 3);
  for (const map of MAP_IDS) {
    const royale = MAP_DEFS[map].mode === 'royale';
    rooms.create({ id: ids[map] || map.toUpperCase(), name: royale ? `${MAP_DEFS[map].name} · Battle Royale` : `${MAP_DEFS[map].name} 24/7`, map, botsPerTeam: royale ? royaleBots : map === 'compound' ? Math.min(BOTS, 5) : BOTS, maxPlayers: royale ? 24 : 32, rotation: false, persistent: true });
  }
}

const app = express();
app.set('trust proxy', true); // correct client IPs behind Render/Fly/Cloudflare
app.use(compression());
app.use(express.json({ limit: '4kb' }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), { maxAge: '7d' }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/assets', express.static(path.join(ROOT, 'client/assets'), { maxAge: '1h', fallthrough: false }));
for (const r of ['character', 'weapon', 'character-weapon', 'ads', 'scale']) app.get(`/debug/${r}`, (_, res) => res.sendFile(path.join(ROOT, 'client/debug.html')));
// list of asset files actually present (lets the client resolve manifest fallback chains without 404 probing)
const listFiles = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(path.join(dir, d.name), `${base}${d.name}/`) : [`${base}${d.name}`]));
const assetList = listFiles(path.join(ROOT, 'client/assets')).filter((f) => /\.(glb|gltf)$/i.test(f));
app.get('/api/assets', (_, res) => res.json(assetList));
app.get('/api/health', (_, res) => res.json({ ok: true, rooms: rooms.rooms.size, players: [...rooms.rooms.values()].reduce((s, r) => s + r.humans(), 0) }));

// ---------------------------------------------------------------- lobby API
app.get('/api/maps', (_, res) => res.json(mapList()));
app.get('/api/rooms', (_, res) => res.json(rooms.list()));
app.get('/api/rooms/:id', (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Room not found' });
  res.json(r.info());
});
const createLog = new Map(); // ip -> [timestamps]
app.post('/api/rooms', (req, res) => {
  const ip = req.ip, now = Date.now();
  const recent = (createLog.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 5) return res.status(429).json({ error: 'Too many rooms created, wait a few minutes' });
  const b = req.body || {};
  try {
    // AI Zone: up to 2 LLM-commanded soldiers (validated here; keys are kept in memory only)
    const agents = (Array.isArray(b.ai) ? b.ai : b.ai ? [b.ai] : []).slice(0, 2).map(cleanAgentConfig);
    if (agents.length && MAP_DEFS[b.map]?.mode === 'royale') return res.status(400).json({ error: 'AI agents play Conquest maps' });
    const r = rooms.create({ name: b.name, map: b.map, botsPerTeam: b.bots ?? 4, maxPlayers: b.maxPlayers ?? 16, isPrivate: agents.length ? true : !!b.private, password: b.password || '', rotation: b.rotation !== false, agents });
    recent.push(now); createLog.set(ip, recent);
    res.json(r.info());
  } catch (e) { res.status(/required|valid|must/i.test(e.message) ? 400 : 503).json({ error: e.message }); }
});
// AI Zone: test a model connection (one tiny request) before creating the room
const testLog = new Map();
app.post('/api/ai/test', async (req, res) => {
  const ip = req.ip, now = Date.now();
  const recent = (testLog.get(ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 6) return res.status(429).json({ error: 'Too many tests, wait a minute' });
  recent.push(now); testLog.set(ip, recent);
  try { res.json(await testAgentConfig(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.use(express.static(path.join(ROOT, 'client')));

// ---------------------------------------------------------------- game sockets
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const perIp = new Map();
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  if (perIp.get(ip) > MAX_CONN_PER_IP) { send(ws, { t: 'error', code: 'limit', msg: 'Too many connections from your address' }); ws.close(); }
  const url = new URL(req.url, 'http://x');
  let room = null;
  // token bucket: ~90 messages/s sustained, bursts of 180 (inputs are sent at 30 Hz)
  let tokens = 180, last = Date.now();
  ws.on('message', (buf) => {
    const now = Date.now();
    tokens = Math.min(180, tokens + ((now - last) / 1000) * 90); last = now;
    if (--tokens < 0) return;
    let m;
    try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!room) {
      if (m.t !== 'join') return;
      const r = rooms.get(m.room || url.searchParams.get('room')) || (m.room || url.searchParams.get('room') ? null : rooms.list()[0] && rooms.get(rooms.list()[0].id));
      if (!r) return send(ws, { t: 'error', code: 'noroom', msg: 'Room not found (it may have closed)' });
      const err = r.join(ws, m);
      if (err) return send(ws, { t: 'error', code: err, msg: err === 'full' ? 'Room is full' : 'Wrong room password' });
      room = r;
      return;
    }
    room.message(ws, m);
  });
  ws.on('close', () => {
    perIp.set(ip, (perIp.get(ip) || 1) - 1);
    if (perIp.get(ip) <= 0) perIp.delete(ip);
    if (room) room.leave(ws);
  });
});

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  rooms.tick(dt);
}, 1000 / TICK_HZ);

server.listen(PORT, '0.0.0.0', () => {
  const hasUserChar = assetList.some((f) => f.startsWith('user/'));
  console.log(`STRIKEPOINT running on http://localhost:${PORT}  (${rooms.rooms.size} rooms, bots per team: ${BOTS}${hasUserChar ? ', user asset overrides present' : ''})`);
});

export { rooms, server };
