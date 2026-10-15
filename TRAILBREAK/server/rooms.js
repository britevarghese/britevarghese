'use strict';
/*
 * Private rooms for TRAILBREAK. Each group of friends drives in its own room, joined by a short code
 * (the shared link is https://host/?room=CODE). A room is created by the first player who asks for its code,
 * so a link keeps working after a server restart.
 *
 * Protocol (JSON text frames over /ws):
 *   client -> server  {t:'hello', name, room?, truck?, paint?}
 *   server -> client  {t:'welcome', id, room, tickRate, maxPlayers, players:[{id,name}], beacons:[id...]}
 *   client -> server  {t:'state', s:{p:[x,y,z], q:[x,y,z,w], v:[x,y,z], w:[x,y,z], wh:[[susp, spin, steer] x4],
 *                       rpm, thr, brk, lights, truck, cfg, paint, warp, winch}}
 *                       cfg: the truck's build (garage parts), a short [0-9a-z] code; help: 1 when calling for a tow
 *                       winch: null, or {to:'tree'|<player id>, a:[x,y,z] (tree: world anchor; player: point in
 *                       that truck's frame), f:[x,y,z] (our fairlead, our frame), len, ten}
 *   server -> clients {t:'snapshot', time, players:[{id, name, s}]}          (at tickRate, to the room)
 *   server -> client  {t:'correction', s}                                    (an update was rejected)
 *   client -> server  {t:'beacon', id}         -> room {t:'beacon', id, by}  (shared survey progress)
 *   client -> server  {t:'chat', text}         -> room {t:'chat', id, name, text}
 *   client -> server  {t:'ping', time}         -> client {t:'pong', time, echo}
 *   server -> clients {t:'join', id, name} / {t:'leave', id, name}
 *   server -> client  {t:'error', msg}
 *
 * The server only sanity-checks: physics runs on each player's own machine. Speeds are clamped and
 * unannounced teleports are rejected.
 */

const MAX_SPEED = 70;          // m/s (250 km/h: far above any truck here)
const MAX_TELEPORT = 50;       // m between consecutive accepted updates without an announced warp
const MAX_COORD = 1e5;
const MAX_MSG_RATE = 60;       // messages per second per client (soft limit)
const WARP_COOLDOWN = 400;     // ms between accepted teleports
const EMPTY_ROOM_TTL = 30 * 60 * 1000;
const MAX_ROOMS = 500;
const BEACON_COUNT = 64;       // beacon ids are 0..63
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
const CODE_RX = /^[A-HJ-NP-Z2-9]{4,8}$/;

function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
function vec(a, n) { return Array.isArray(a) && a.length === n && a.every(isNum); }
function cleanStr(s, max, fallback) {
  if (typeof s !== 'string') return fallback;
  const out = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  return out || fallback;
}
function round(n, k = 1000) { return Math.round(n * k) / k; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function normalizeCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return CODE_RX.test(c) ? c : null;
}

function randomCode(len = 5, rand = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

class Room {
  constructor(code, { tickRate = 20, maxPlayers = 4, log = () => {} } = {}) {
    this.code = code;
    this.tickRate = tickRate;
    this.maxPlayers = maxPlayers;
    this.log = log;
    this.players = new Map();
    this.beacons = new Map();      // id -> name of the player who surveyed it
    this.nextId = 1;
    this.emptySince = Date.now();
  }

  get size() { return this.players.size; }

  add(player) {
    player.id = this.nextId++;
    this.players.set(player.id, player);
    this.emptySince = 0;
    this.send(player, {
      t: 'welcome', id: player.id, room: this.code, tickRate: this.tickRate, maxPlayers: this.maxPlayers,
      players: [...this.players.values()].filter((p) => p !== player).map((p) => ({ id: p.id, name: p.name })),
      beacons: [...this.beacons.keys()],
    });
    this.broadcast({ t: 'join', id: player.id, name: player.name }, player);
    this.log(`[room ${this.code}] ${player.name} (#${player.id}) joined, ${this.size}/${this.maxPlayers}`);
  }

  remove(player) {
    if (this.players.get(player.id) !== player) return;
    this.players.delete(player.id);
    if (this.size === 0) this.emptySince = Date.now();
    this.broadcast({ t: 'leave', id: player.id, name: player.name });
    this.log(`[room ${this.code}] ${player.name} (#${player.id}) left, ${this.size}/${this.maxPlayers}`);
  }

  handle(player, msg) {
    switch (msg.t) {
      case 'state': {
        const s = this.validate(player, msg.s);
        if (s) { player.s = s; player.lastUpdate = Date.now(); }
        return;
      }
      case 'beacon': {
        const id = msg.id;
        if (!Number.isInteger(id) || id < 0 || id >= BEACON_COUNT || this.beacons.has(id)) return;
        this.beacons.set(id, player.name);
        this.broadcast({ t: 'beacon', id, by: player.name });
        this.log(`[room ${this.code}] ${player.name} surveyed beacon ${id} (${this.beacons.size} found)`);
        return;
      }
      case 'chat': {
        const text = cleanStr(msg.text, 160, '');
        if (!text) return;
        const now = Date.now();
        if (now - (player.lastChat || 0) < 500) return;
        player.lastChat = now;
        this.broadcast({ t: 'chat', id: player.id, name: player.name, text });
        return;
      }
      case 'ping':
        this.send(player, { t: 'pong', time: Date.now(), echo: isNum(msg.time) ? msg.time : 0 });
        return;
      default:
    }
  }

  /** A sanitized copy of a state update, or null when it is rejected. */
  validate(player, s) {
    if (!s || typeof s !== 'object') return null;
    if (!vec(s.p, 3) || s.p.some((c) => Math.abs(c) > MAX_COORD)) return null;
    let q = vec(s.q, 4) ? s.q.slice() : [0, 0, 0, 1];
    const ql = Math.hypot(q[0], q[1], q[2], q[3]);
    q = ql > 1e-6 ? q.map((c) => c / ql) : [0, 0, 0, 1];
    let v = vec(s.v, 3) ? s.v.slice() : [0, 0, 0];
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (speed > MAX_SPEED) v = v.map((c) => (c / speed) * MAX_SPEED);
    const w = vec(s.w, 3) ? s.w.map((c) => clamp(c, -20, 20)) : [0, 0, 0];

    const prev = player.s;
    const warp = isNum(s.warp) ? s.warp | 0 : 0;
    if (prev) {
      const d = Math.hypot(s.p[0] - prev.p[0], s.p[1] - prev.p[1], s.p[2] - prev.p[2]);
      const now = Date.now();
      const announced = warp !== prev.warp && now - (player.lastWarp || 0) > WARP_COOLDOWN;
      if (d > MAX_TELEPORT && !announced) {
        this.send(player, { t: 'correction', s: prev });
        return null;
      }
      if (announced) player.lastWarp = now;
    }

    const wh = [];
    if (Array.isArray(s.wh)) {
      for (const x of s.wh.slice(0, 4)) {
        if (!vec(x, 3)) { wh.push([0, 0, 0]); continue; }
        wh.push([round(clamp(x[0], -2, 2)), round(x[1] % (Math.PI * 2), 100), round(clamp(x[2], -1, 1))]);
      }
    }
    while (wh.length < 4) wh.push([0, 0, 0]);

    let winch = null;
    const W = s.winch;
    if (W && typeof W === 'object' && vec(W.a, 3) && vec(W.f, 3) && isNum(W.len)) {
      const to = W.to === 'tree' ? 'tree' : (Number.isInteger(W.to) && this.players.has(W.to) && W.to !== player.id ? W.to : null);
      if (to !== null && W.a.every((c) => Math.abs(c) <= MAX_COORD) && W.f.every((c) => Math.abs(c) < 10)) {
        winch = { to, a: W.a.map((c) => round(c)), f: W.f.map((c) => round(c)), len: round(clamp(W.len, 0, 100)), ten: round(clamp(isNum(W.ten) ? W.ten : 0, 0, 1e6), 1) };
      }
    }

    return {
      p: s.p.map((c) => round(c)),
      q: q.map((c) => round(c, 10000)),
      v: v.map((c) => round(c)),
      w: w.map((c) => round(c)),
      wh,
      rpm: isNum(s.rpm) ? Math.round(clamp(s.rpm, 0, 9000)) : 800,
      thr: isNum(s.thr) ? round(clamp(s.thr, 0, 1), 100) : 0,
      brk: s.brk ? 1 : 0,
      lights: s.lights ? 1 : 0,
      truck: cleanStr(s.truck, 24, prev ? prev.truck : 'ranger'),
      cfg: typeof s.cfg === 'string' && /^[0-9a-z]{1,24}$/.test(s.cfg) ? s.cfg : (prev ? prev.cfg : ''),
      help: s.help ? 1 : 0,
      paint: /^#[0-9a-fA-F]{6}$/.test(s.paint) ? s.paint : (prev ? prev.paint : '#b5532c'),
      warp,
      winch,
    };
  }

  tick() {
    if (this.size === 0) return;
    const players = [];
    for (const p of this.players.values()) if (p.s) players.push({ id: p.id, name: p.name, s: p.s });
    this.broadcast({ t: 'snapshot', time: Date.now(), players });
  }

  send(player, obj) { player.ws.send(JSON.stringify(obj)); }

  broadcast(obj, except = null) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except) p.ws.send(data);
  }
}

class Lobby {
  constructor({ tickRate = 20, maxPlayers = 4, log = () => {}, rand = Math.random } = {}) {
    this.tickRate = clamp(tickRate | 0, 1, 60);
    this.maxPlayers = clamp(maxPlayers | 0, 1, 16);
    this.log = log;
    this.rand = rand;
    this.rooms = new Map();
    this.timer = null;
    this.sweepTimer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { for (const r of this.rooms.values()) r.tick(); }, 1000 / this.tickRate);
    this.timer.unref?.();
    this.sweepTimer = setInterval(() => this.sweep(), 60 * 1000);
    this.sweepTimer.unref?.();
  }

  stop() {
    clearInterval(this.timer); clearInterval(this.sweepTimer);
    this.timer = this.sweepTimer = null;
  }

  /** Drop rooms that have been empty for a while (their beacon progress goes with them). */
  sweep(now = Date.now()) {
    for (const [code, r] of this.rooms) if (r.size === 0 && r.emptySince && now - r.emptySince > EMPTY_ROOM_TTL) this.rooms.delete(code);
  }

  get playerCount() { let n = 0; for (const r of this.rooms.values()) n += r.size; return n; }

  newCode() {
    for (let i = 0; i < 100; i++) {
      const c = randomCode(5, this.rand);
      if (!this.rooms.has(c)) return c;
    }
    return randomCode(8, this.rand);
  }

  room(code) {
    let r = this.rooms.get(code);
    if (!r) {
      if (this.rooms.size >= MAX_ROOMS) { this.sweep(); if (this.rooms.size >= MAX_ROOMS) return null; }
      r = new Room(code, { tickRate: this.tickRate, maxPlayers: this.maxPlayers, log: this.log });
      this.rooms.set(code, r);
    }
    return r;
  }

  addConnection(ws) {
    const player = { id: 0, ws, name: null, room: null, s: null, lastUpdate: 0, msgWindowStart: Date.now(), msgCount: 0 };
    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - player.msgWindowStart > 1000) { player.msgWindowStart = now; player.msgCount = 0; }
      if (++player.msgCount > MAX_MSG_RATE) return;
      let msg;
      try { msg = JSON.parse(data); } catch { return send({ t: 'error', msg: 'bad json' }); }
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'hello') {
        if (player.room) return;
        const asked = msg.room == null || msg.room === '' ? null : normalizeCode(msg.room);
        if (msg.room != null && msg.room !== '' && !asked) {
          send({ t: 'error', msg: 'That room code is not valid.' });
          return ws.close(1008, 'bad room code');
        }
        const code = asked || this.newCode();
        const room = this.room(code);
        if (!room) { send({ t: 'error', msg: 'The server is busy. Try again later.' }); return ws.close(1013, 'busy'); }
        if (room.size >= room.maxPlayers) {
          send({ t: 'error', msg: `Room ${code} is full (${room.maxPlayers} drivers).` });
          return ws.close(1013, 'room full');
        }
        player.name = cleanStr(msg.name, 20, 'Driver');
        player.room = room;
        room.add(player);
        return;
      }
      if (player.room) player.room.handle(player, msg);
    });

    ws.on('close', () => { if (player.room) player.room.remove(player); });
  }
}

module.exports = { Lobby, Room, normalizeCode, randomCode, MAX_SPEED, MAX_TELEPORT, BEACON_COUNT };
