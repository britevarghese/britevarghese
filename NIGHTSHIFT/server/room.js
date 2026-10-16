'use strict';
/*
 * Room / replication logic for the optional multiplayer foundation.
 *
 * Protocol (JSON text frames):
 *   client -> server  {t:'hello', name}
 *   server -> client  {t:'welcome', id, tickRate}
 *   client -> server  {t:'state', ack, s:{p:[x,y,z], q:[x,y,z,w], v:[x,y,z], car, paint, foot, warp, parked:[...]}}
 *                       ack: the time of the last snapshot the client has had (a client too far behind is sent
 *                       one snapshot a second, and no traffic, until it catches up)
 *                       foot: 1 when the player is walking (p = the character, car = the car they left)
 *                       warp: counter the client bumps on a deliberate teleport (respawn, reset, mission)
 *                       parked: up to 4 cars the player left in the street {k, car, paint, p, yaw}
 *   server -> clients {t:'snapshot', time, players:[{id, name, s}]}   (at tickRate)
 *   client -> server  {t:'take', owner, k}            take another player's parked car
 *   server -> taker   {t:'take-ok', owner, k, car, paint, p, yaw} | {t:'take-fail', owner, k}
 *   server -> owner   {t:'taken', k, by}                (drop it from your parked list)
 *   server -> clients {t:'join', id, name} / {t:'leave', id, name}
 *   server -> client  {t:'error', msg}
 *   client -> server  {t:'traffic', cars:[[id, type, x, y, z, yaw, speed, brake, color], ...]}
 *   server -> others  {t:'traffic', from, cars}
 *                       Shared street traffic: players close together form a group and the lowest id
 *                       in it simulates the cars for everyone (the others render and collide with them).
 *
 * The server is authoritative for sanity only: speeds are clamped, positions kept to the map, and a jump the
 * client didn't announce is passed on as a teleport. Physics still runs on the clients.
 */

const MAX_SPEED = 120;      // m/s
const MAX_TELEPORT = 60;    // m between consecutive accepted updates
const MAX_COORD = 1e6;      // world bounds sanity (Kerala's map runs to 600 km north: at 1e5 every update from Kannur,
                            // 210 km up, was thrown away and nobody saw anybody)
const MAX_MSG_RATE = 60;    // messages per second per client (soft limit)
const MAX_PARKED = 4;
const MAX_TRAFFIC = 120;    // cars per traffic message
// (any of the game's vehicle types by its id: a list of the old city's six left every Kerala vehicle - autos, buses,
// scooters, lorries - out of the shared traffic)
const TRAFFIC_TYPE = /^[a-z][a-z0-9_]{0,23}$/;
const LIVE_BACKLOG = 64 * 1024; // bytes queued to a player beyond which live updates to them are skipped
const LIVE_LAG = 800;           // ms a player's game may be behind the snapshots before they're held back

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
        this.broadcast({ t: 'leave', id: player.id, name: player.name });
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
      this.send(player.ws, { t: 'welcome', id: player.id, tickRate: this.tickRate, players: [...this.players.values()].filter((p) => p !== player).map((p) => ({ id: p.id, name: p.name })) });
      this.broadcast({ t: 'join', id: player.id, name: player.name }, player);
      this.log(`[mp] ${player.name} (#${player.id}) joined from ${player.ws.remoteAddress}, ${this.players.size} online`);
      return;
    }
    if (msg.t === 'state') {
      if (!player.id) return;
      if (isNum(msg.ack)) player.ack = msg.ack;   // (the last snapshot their game has had: how far behind it is)
      const s = this.validate(player, msg.s);
      if (s) { player.s = s; player.lastUpdate = Date.now(); }
      return;
    }
    if (msg.t === 'take') {
      if (!player.id) return;
      const owner = this.players.get(msg.owner);
      const i = owner?.s?.parked?.findIndex((c) => c.k === msg.k) ?? -1;
      if (!owner || owner === player || i < 0) return this.send(player.ws, { t: 'take-fail', owner: msg.owner, k: msg.k });
      const [car] = owner.s.parked.splice(i, 1);
      (owner.taken ||= new Set()).add(car.k); // ignore it in the owner's next few updates
      this.send(owner.ws, { t: 'taken', k: car.k, by: player.name });
      this.send(player.ws, { t: 'take-ok', owner: owner.id, ...car });
      this.log(`[mp] ${player.name} took ${owner.name}'s ${car.car}`);
      return;
    }
    if (msg.t === 'traffic') {
      if (!player.id || !Array.isArray(msg.cars)) return;
      const cars = [];
      for (const c of msg.cars.slice(0, MAX_TRAFFIC)) {
        if (!Array.isArray(c) || c.length !== 9 || typeof c[1] !== 'string' || !TRAFFIC_TYPE.test(c[1])) continue;
        const n = [c[0], c[2], c[3], c[4], c[5], c[6], c[7], c[8]];
        if (!n.every(isNum) || Math.abs(c[2]) > MAX_COORD || Math.abs(c[4]) > MAX_COORD) continue;
        cars.push([c[0] | 0, c[1], round(c[2]), round(c[3]), round(c[4]), round(c[5]), round(c[6]), c[7] ? 1 : 0, c[8] | 0]);
      }
      this.broadcast({ t: 'traffic', from: player.id, cars }, player, true);
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
    const raw = isNum(s.warp) ? s.warp | 0 : 0;
    // (a jump the game didn't announce - a mission's or a reset's teleport moments after another - is taken as one
    // all the same, so the others see a jump and not a drive across the map. Snapped back to where the player had
    // been instead, a story mission put them back at its start, its car never came, and it went no further)
    if (prev && raw === player.rawWarp && Math.hypot(s.p[0] - prev.p[0], s.p[1] - prev.p[1], s.p[2] - prev.p[2]) > MAX_TELEPORT) player.jumps = (player.jumps || 0) + 1;
    player.rawWarp = raw;
    const warp = raw + (player.jumps || 0);
    const parked = [];
    if (Array.isArray(s.parked)) {
      for (const c of s.parked.slice(0, MAX_PARKED)) {
        if (!c || !isNum(c.k) || !vec(c.p, 3) || c.p.some((v) => Math.abs(v) > MAX_COORD)) continue;
        if (player.taken?.has(c.k)) continue;
        parked.push({ k: c.k | 0, car: cleanStr(c.car, 32, 'sedan'), paint: cleanStr(c.paint, 16, '#888888'), p: c.p.map(round), yaw: isNum(c.yaw) ? round(c.yaw) : 0 });
      }
    }
    // the client has caught up once a taken car is gone from its own list
    if (player.taken) for (const k of player.taken) if (!s.parked?.some?.((c) => c && c.k === k)) player.taken.delete(k);

    return {
      p: s.p.map(round),
      q: q.map(round),
      v: v.map(round),
      car: cleanStr(s.car, 32, prev ? prev.car : 'default'),
      paint: cleanStr(s.paint, 16, prev ? prev.paint : '#ffffff'),
      foot: s.foot ? 1 : 0,
      warp,
      parked,
    };
  }

  tick() {
    if (this.players.size === 0) return;
    const players = [];
    for (const p of this.players.values()) {
      if (p.s) players.push({ id: p.id, name: p.name, s: p.s });
    }
    this.broadcast({ t: 'snapshot', time: Date.now(), players }, null, true);
  }

  send(ws, obj) { ws.send(JSON.stringify(obj)); }

  // (the many-times-a-second updates - snapshots, traffic - are held back from a player whose connection is behind:
  // queued up on a slow link they built up into a minute of lag, until the heartbeat, stuck behind them, timed out
  // and the player was dropped. How far behind: the time of the last snapshot their game says it has had. Behind,
  // they get one snapshot a second until they catch up - and nothing else live)
  behind(p, now) { return (p.ack !== undefined && now - p.ack > LIVE_LAG) || p.ws.backlog > LIVE_BACKLOG; }
  broadcast(obj, except = null, live = false) {
    const data = JSON.stringify(obj), now = Date.now();
    for (const p of this.players.values()) {
      if (p === except) continue;
      if (live && this.behind(p, now)) {
        if (obj.t !== 'snapshot' || now - (p.trickleT || 0) < 1000) continue;
        p.trickleT = now;
      }
      p.ws.send(data);
    }
  }
}

module.exports = { Room, MAX_SPEED, MAX_TELEPORT };
