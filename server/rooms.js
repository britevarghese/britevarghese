// Rooms: independent game instances (own map, bots, tickets, players) hosted by one server process.
import crypto from 'node:crypto';
import { Game, TICK_HZ, SNAP_HZ } from './game.js';
import { RoyaleGame } from './royale.js';
import { MAP_DEFS, MAP_IDS, CONQUEST_MAPS, modeOf } from '../shared/map.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const send = (ws, msg) => { if (ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
export const cleanName = (s, max = 18) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export class Room {
  constructor({ id, name, map, botsPerTeam = 6, maxPlayers = 24, isPrivate = false, password = '', rotation = true, persistent = false, log = () => {} }) {
    this.id = id; this.name = name; this.botsPerTeam = botsPerTeam; this.maxPlayers = maxPlayers;
    this.isPrivate = isPrivate; this.password = password; this.rotation = rotation; this.persistent = persistent;
    this.log = log;
    this.clients = new Map();   // ws -> player
    this.createdAt = Date.now(); this.emptySince = Date.now();
    this.acc = { snap: 0, board: 0, ping: 0 };
    this.#startGame(map);
  }

  #startGame(map) {
    this.mapId = MAP_DEFS[map] ? map : MAP_IDS[0];
    this.mode = modeOf(this.mapId);
    // battle royale: botsPerTeam is the total number of bots (everyone is on their own)
    this.game = this.mode === 'royale'
      ? new RoyaleGame({ bots: this.botsPerTeam, map: this.mapId, log: this.log, lobbyTime: +process.env.ROYALE_LOBBY || undefined })
      : new Game({ botsPerTeam: this.botsPerTeam, map: this.mapId, log: this.log });
  }

  humans() { return this.clients.size; }

  info() {
    const g = this.game;
    return {
      id: this.id, name: this.name, map: this.mapId, mode: this.mode, mapName: MAP_DEFS[this.mapId].name, players: this.humans(), max: this.maxPlayers,
      bots: this.botsPerTeam, private: this.isPrivate, locked: !!this.password, rotation: this.rotation, tickets: [g.tickets[1], g.tickets[2]],
    };
  }

  // returns error code or null
  join(ws, m) {
    if (this.humans() >= this.maxPlayers) return 'full';
    if (this.password && !safeEqual(m.password ?? '', this.password)) return 'password';
    const g = this.game;
    const p = g.addPlayer({ name: cleanName(m.name) || 'Soldier', team: m.team, cls: m.cls });
    this.clients.set(ws, p);
    send(ws, { t: 'welcome', id: p.id, team: p.team, cls: p.cls, mode: this.mode, tickHz: TICK_HZ, snapHz: SNAP_HZ, room: this.info() });
    send(ws, g.scoreboard());
    const extra = g.joinPayload?.(p); if (extra) send(ws, extra);
    g.emit({ t: 'chat', from: 'SERVER', msg: this.mode === 'royale' ? `${p.name} joined` : `${p.name} joined ${p.team === 1 ? 'US' : 'RU'}` });
    return null;
  }

  leave(ws) {
    const p = this.clients.get(ws);
    if (!p) return;
    this.game.emit({ t: 'chat', from: 'SERVER', msg: `${p.name} left` });
    this.game.removePlayer(p.id);
    this.clients.delete(ws);
    if (!this.clients.size) {
      this.emptySince = Date.now();
      // a battle royale match with nobody watching is abandoned; the next visitor gets a fresh lobby
      if (this.mode === 'royale') this.game.resetRound();
    }
  }

  message(ws, m) {
    const p = this.clients.get(ws), g = this.game;
    if (!p) return;
    switch (m.t) {
      case 'in': g.handleInput(p, m); break;
      case 'fire': if (Array.isArray(m.d)) g.tryFire(p, m.o, m.d, m.ct, m.rt); break;
      case 'reload': g.reload(p); break;
      case 'nade': if (Array.isArray(m.d)) g.throwGrenade(p, m.o, m.d); break;
      case 'spawn': g.spawn(p, m.p, m.cls); break;
      case 'team': if (!p.alive && (m.team === 1 || m.team === 2)) p.team = m.team; break;
      case 'chat': {
        const now = Date.now();
        p.chatTokens = Math.min(3, (p.chatTokens ?? 3) + (now - (p.chatAt || now)) / 2000); p.chatAt = now;
        const msg = cleanName(m.msg, 120);
        if (p.chatTokens >= 1 && msg) { p.chatTokens--; g.emit({ t: 'chat', from: p.name, tm: p.team, msg }); }
        break;
      }
      case 'pong': if (typeof m.s === 'number') p.rtt = p.rtt * 0.7 + Math.min(1000, Date.now() - m.s) * 0.3; break;
      case 'suicide': g.kill(p, null, 'suicide'); break;
      // battle royale
      case 'jump': g.jump?.(p); break;
      case 'pick': if (Number.isInteger(m.id)) g.pickup?.(p, m.id); break;
      case 'heal': g.heal?.(p); break;
    }
  }

  tick(dt, now) {
    const g = this.game;
    // empty rooms sleep (bots only fight while somebody is watching)
    if (!this.clients.size) return;
    // map rotation shortly before the round would restart on the same map
    if (this.rotation && this.mode === 'conquest' && g.roundOver && now - g.roundOver.at > 13000) {
      const next = CONQUEST_MAPS[(CONQUEST_MAPS.indexOf(this.mapId) + 1) % CONQUEST_MAPS.length];
      this.log(`[room ${this.id}] rotating map ${this.mapId} -> ${next}`);
      const msg = JSON.stringify({ t: 'mapchange', map: next, room: this.id });
      for (const ws of this.clients.keys()) { send(ws, msg); setTimeout(() => ws.close(4000, 'mapchange'), 400); }
      this.clients.clear();
      this.#startGame(next);
      return;
    }
    g.tick(dt);
    for (const { ev, only, ids } of g.flushEvents()) {
      const s = JSON.stringify({ t: 'ev', e: ev });
      for (const [ws, p] of this.clients) {
        if (only !== null && p.id !== only) continue;
        if (ids && !ids.includes(p.id)) continue;
        send(ws, s);
      }
    }
    const A = this.acc;
    A.snap += dt; A.board += dt; A.ping += dt;
    if (A.snap >= 1 / SNAP_HZ) {
      // carry the remainder (resetting to 0 would drop 20 Hz snapshots to every other 30 Hz tick = 15 Hz)
      A.snap = Math.min(A.snap - 1 / SNAP_HZ, 1 / SNAP_HZ);
      const snap = g.snapshot();
      for (const [ws, p] of this.clients) {
        snap.me = { hp: Math.max(0, Math.round(p.hp)), alive: p.alive, w: p.weapons, sl: p.slot, g: p.grenades, rl: Math.max(0, p.reloadUntil - now), rs: Math.max(0, Math.min(99999, p.respawnAt - now)), sp: p.spawnPoint };
        if (g.meExtra) Object.assign(snap.me, g.meExtra(p, now));
        send(ws, snap);
      }
    }
    if (A.board >= 1) { A.board = 0; const b = JSON.stringify(g.scoreboard()); for (const ws of this.clients.keys()) send(ws, b); }
    if (A.ping >= 2) { A.ping = 0; for (const ws of this.clients.keys()) send(ws, { t: 'ping', s: now }); }
  }
}

export class RoomManager {
  constructor({ log = console.log, maxRooms = 40 } = {}) {
    this.rooms = new Map();
    this.log = log;
    this.maxRooms = maxRooms;
  }

  code() {
    for (;;) {
      const c = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (!this.rooms.has(c)) return c;
    }
  }

  create(opts) {
    if (this.rooms.size >= this.maxRooms) throw new Error('Server is full of rooms, try again later');
    const id = opts.id || this.code();
    const room = new Room({
      id,
      name: cleanName(opts.name, 32) || `${MAP_DEFS[opts.map]?.name || 'Battle'} room`,
      map: MAP_DEFS[opts.map] ? opts.map : MAP_IDS[0],
      botsPerTeam: Math.max(0, Math.min(modeOf(opts.map) === 'royale' ? 23 : 16, Math.round(+opts.botsPerTeam || 0))),
      maxPlayers: Math.max(2, Math.min(32, Math.round(+opts.maxPlayers || 24))),
      isPrivate: !!opts.isPrivate,
      password: cleanName(opts.password, 32),
      rotation: opts.rotation !== false,
      persistent: !!opts.persistent,
      log: this.log,
    });
    this.rooms.set(id, room);
    this.log(`[rooms] created ${id} "${room.name}" map=${room.mapId} bots=${room.botsPerTeam}${room.isPrivate ? ' private' : ''}`);
    return room;
  }

  get(id) { return this.rooms.get(String(id || '').toUpperCase()); }

  list() { return [...this.rooms.values()].filter((r) => !r.isPrivate).map((r) => r.info()).sort((a, b) => b.players - a.players); }

  tick(dt) {
    const now = Date.now();
    for (const r of this.rooms.values()) {
      r.tick(dt, now);
      if (!r.persistent && !r.clients.size && now - r.emptySince > 120000) { this.rooms.delete(r.id); this.log(`[rooms] closed empty room ${r.id}`); }
    }
  }
}
