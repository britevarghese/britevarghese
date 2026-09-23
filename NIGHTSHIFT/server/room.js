'use strict';
/*
 * Room / replication logic for the optional multiplayer foundation.
 *
 * Protocol (JSON text frames):
 *   client -> server  {t:'hello', name}
 *   server -> client  {t:'welcome', id, tickRate}
 *   client -> server  {t:'state', s:{p:[x,y,z], q:[x,y,z,w], v:[x,y,z], car, paint}}
 *   server -> clients {t:'snapshot', time, players:[{id, name, s}]}   (at tickRate)
 *   server -> client  {t:'correction', s}   (when an update was rejected)
 *   server -> clients {t:'leave', id}
 *   server -> client  {t:'error', msg}
 *
 * The server is authoritative for sanity only: speeds are clamped and
 * teleports are rejected. Physics still runs on the clients.
 */

const MAX_SPEED = 120;      // m/s
const MAX_TELEPORT = 60;    // m between consecutive accepted updates
const MAX_COORD = 1e5;      // world bounds sanity
const MAX_MSG_RATE = 60;    // messages per second per client (soft limit)

function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
function vec(a, n) {
  return Array.isArray(a) && a.length === n && a.every(isNum);
}
function cleanStr(s, max, fallback) {
  if (typeof s !== 'string') return fallback;
  const out = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  return out || fallback;
}
function round(n) { return Math.round(n * 1000) / 1000; }

class Room {
  constructor({ tickRate = 20, maxPlayers = 8, log = () => {} } = {}) {
    this.tickRate = Math.max(1, Math.min(60, tickRate | 0));
    this.maxPlayers = Math.max(1, maxPlayers | 0);
    this.log = log;
    this.players = new Map(); // id -> player
    this.nextId = 1;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000 / this.tickRate);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  addConnection(ws) {
    const player = {
      id: 0, ws, name: null, s: null, lastUpdate: 0,
      msgWindowStart: Date.now(), msgCount: 0,
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      // Soft rate limit.
      const now = Date.now();
      if (now - player.msgWindowStart > 1000) { player.msgWindowStart = now; player.msgCount = 0; }
      if (++player.msgCount > MAX_MSG_RATE) return;

      let msg;
      try { msg = JSON.parse(data); } catch { return this.send(ws, { t: 'error', msg: 'bad json' }); }
      if (!msg || typeof msg.t !== 'string') return;
      this.handle(player, msg);
    });

    ws.on('close', () => {
      if (player.id && this.players.get(player.id) === player) {
        this.players.delete(player.id);
        this.log(`[mp] ${player.name} (#${player.id}) left, ${this.players.size} online`);
        this.broadcast({ t: 'leave', id: player.id });
      }
    });
  }

  handle(player, msg) {
    if (msg.t === 'hello') {
      if (player.id) return; // already joined
      if (this.players.size >= this.maxPlayers) {
        this.send(player.ws, { t: 'error', msg: 'server full' });
        return player.ws.close(1013, 'server full');
      }
      player.id = this.nextId++;
      player.name = cleanStr(msg.name, 20, `Driver${player.id}`);
      this.players.set(player.id, player);
      this.send(player.ws, { t: 'welcome', id: player.id, tickRate: this.tickRate });
      this.log(`[mp] ${player.name} (#${player.id}) joined from ${player.ws.remoteAddress}, ${this.players.size} online`);
      return;
    }
    if (msg.t === 'state') {
      if (!player.id) return;
      const s = this.validate(player, msg.s);
      if (s) { player.s = s; player.lastUpdate = Date.now(); }
      return;
    }
    if (msg.t === 'ping') {
      this.send(player.ws, { t: 'pong', time: Date.now(), echo: msg.time });
    }
  }

  /** Returns a sanitized state, or null if rejected. */
  validate(player, s) {
    if (!s || typeof s !== 'object') return null;
    if (!vec(s.p, 3) || s.p.some((c) => Math.abs(c) > MAX_COORD)) return null;

    let q = vec(s.q, 4) ? s.q.slice() : [0, 0, 0, 1];
    const ql = Math.hypot(q[0], q[1], q[2], q[3]);
    q = ql > 1e-6 ? q.map((c) => c / ql) : [0, 0, 0, 1];

    let v = vec(s.v, 3) ? s.v.slice() : [0, 0, 0];
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (speed > MAX_SPEED) v = v.map((c) => (c / speed) * MAX_SPEED);

    const prev = player.s;
    if (prev) {
      const d = Math.hypot(s.p[0] - prev.p[0], s.p[1] - prev.p[1], s.p[2] - prev.p[2]);
      if (d > MAX_TELEPORT) {
        this.send(player.ws, { t: 'correction', s: prev });
        return null;
      }
    }

    return {
      p: s.p.map(round),
      q: q.map(round),
      v: v.map(round),
      car: cleanStr(s.car, 32, prev ? prev.car : 'default'),
      paint: cleanStr(s.paint, 16, prev ? prev.paint : '#ffffff'),
    };
  }

  tick() {
    if (this.players.size === 0) return;
    const players = [];
    for (const p of this.players.values()) {
      if (p.s) players.push({ id: p.id, name: p.name, s: p.s });
    }
    this.broadcast({ t: 'snapshot', time: Date.now(), players });
  }

  send(ws, obj) { ws.send(JSON.stringify(obj)); }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) p.ws.send(data);
  }
}

module.exports = { Room, MAX_SPEED, MAX_TELEPORT };
