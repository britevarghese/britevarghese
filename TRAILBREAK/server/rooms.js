'use strict';
/*
 * Private rooms for TRAILBREAK. Each group of friends drives in its own room, joined by a short code
 * (the shared link is https://host/?room=CODE). A room is created by the first player who asks for its code,
 * so a link keeps working after a server restart.
 *
 * Protocol (JSON text frames over /ws):
 *   client -> server  {t:'hello', name, room?, map?, quick?, truck?, paint?}
 *                       map: the map a new room is opened on (one who joins an open room drives its map)
 *                       quick: true (and no room): a quick match, into the fullest public room on that map with a
 *                       seat free, or a new public room (rooms opened by code stay private: only their link gets in)
 *   server -> client  {t:'welcome', id, room, map, public, tickRate, maxPlayers, players:[{id,name}], beacons:[id...]}
 *   client -> server  {t:'state', s:{p:[x,y,z], q:[x,y,z,w], v:[x,y,z], w:[x,y,z], wh:[[susp, spin, steer] x4],
 *                       rpm, thr, brk, lights, truck, cfg, paint, warp, winch}}
 *                       cfg: the truck's build (garage parts), a short [0-9a-z] code; help: 1 when calling for a tow
 *                       winch: null, or {to:'tree'|<player id>, a:[x,y,z] (tree: world anchor; player: point in
 *                       that truck's frame), f:[x,y,z] (our fairlead, our frame), len, ten}
 *   server -> clients {t:'snapshot', time, players:[{id, name, s}]}          (at tickRate, to the room)
 *   server -> client  {t:'correction', s}                                    (an update was rejected)
 *   client -> server  {t:'beacon', id}         -> room {t:'beacon', id, by}  (shared survey progress)
 *   client -> server  {t:'chat', text}         -> room {t:'chat', id, name, text}
 *   client -> server  {t:'layout', code}       -> room {t:'layout', id, name, code}   (the map builder's props, a share
 *                       code, src/game/Props.js; the room keeps the last one for whoever joins: welcome's layout)
 *   client -> server  {t:'brk', k, d, v}       -> room {t:'brk', k, d, v}    (a tree or a roadside thing knocked down:
 *                       its key, 't' + tree or 'o' + roadside thing (world/World.js), the way it went [dx, dz] and how
 *                       fast; the room keeps what is down for whoever joins: welcome's broken)
 *   client -> server  {t:'damage', d}          -> room {t:'damage', id, d}   (what is broken on that truck: glass, lamps,
 *                       flat tyres, steam, smoke, toe and the latest dents; kept for whoever joins later)
 *   client -> server  {t:'ping', time}         -> client {t:'pong', time, echo}
 *   races (one at a time in a room; the clock is the server's, ms):
 *   client -> server  {t:'ev', k:'open', id}   -> room {t:'ev', k:'open', id, by, name, at, racers:[{id, name}]}
 *                       (at: when the countdown ends, RACE_LEAD from now; friends can join until then)
 *   client -> server  {t:'ev', k:'join'}       -> room {t:'ev', k:'join', id, pid, name, racers}
 *   client -> server  {t:'ev', k:'done', time} -> room {t:'ev', k:'done', id, pid, name, time}   (time null: gave up)
 *   server -> room    {t:'ev', k:'end', id, results:[{id, name, time}]}   (everyone done, gone, or out of time)
 *                       welcome carries race: {id, at, racers} while one is open or running
 *   voice chat (src/net/Voice.js): players who join the room's voice talk to each other directly (WebRTC), the server
 *   passing on their connection offers; where no direct link can be made, the audio comes through here instead:
 *   client -> server  {t:'voice', on, mic, mute} -> room {t:'voice', id, on, mic, mute}   (in the voice chat; has a
 *                       microphone; has muted it)
 *   client -> server  {t:'rtc', to, d}        -> that player {t:'rtc', from, d}   (an offer or answer, as it is)
 *   client -> server  binary [1, seq hi, seq lo, audio...] -> everyone else in voice [1, id hi, id lo, seq hi, seq lo, audio...]
 *                       (40 ms of 16 kHz speech, 4-bit ADPCM)
 *                       welcome's players carry voice: 1, mic and mute for those already in it
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
const MAX_VOICE_RATE = 40;     // relayed voice frames per second per client (25 when talking)
const MAX_VOICE_FRAME = 1400;  // bytes
const MAX_RTC = 16000;         // characters of a connection offer
const WARP_COOLDOWN = 400;     // ms between accepted teleports
const EMPTY_ROOM_TTL = 30 * 60 * 1000;
const MAX_ROOMS = 500;
const BEACON_COUNT = 64;       // beacon ids are 0..63
const MAX_BROKEN = 6000;       // trees and roadside things a room remembers as knocked down
const BREAK_RX = /^[to]\d{1,7}$/;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I
const CODE_RX = /^[A-HJ-NP-Z2-9]{4,8}$/;
const RACE_LEAD = 15000;       // ms from opening a race to the start: time for friends to join
const RACE_MAX = 21 * 60 * 1000;   // ms after the start a race is called (the events' own limits: 10 min, the longest 20)
const EVENT_RX = /^[a-z]{2,16}$/;
const LAYOUT_RX = /^[A-Za-z0-9_-]{0,24000}$/;   // a layout's share code (base64url)
const MAP_RX = /^[a-z]{2,16}$/;
const DEFAULT_MAP = 'ashwood';

function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
function vec(a, n) { return Array.isArray(a) && a.length === n && a.every(isNum); }
function cleanStr(s, max, fallback) {
  if (typeof s !== 'string') return fallback;
  const out = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
  return out || fallback;
}
function round(n, k = 1000) { return Math.round(n * k) / k; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/** A sanitized damage summary (src/physics/Damage.js summary()), or null. */
function cleanDamage(d) {
  if (!d || typeof d !== 'object') return null;
  const n = (x, lo, hi) => (isNum(x) ? clamp(x, lo, hi) : lo);
  const dents = Array.isArray(d.d) ? d.d.slice(-16).filter((a) => vec(a, 8)).map((a) => a.map((c) => round(clamp(c, -6, 6)))) : [];
  return {
    v: Math.round(n(d.v, 0, 1e9)), n: Math.round(n(d.n, 0, 1e9)), g: round(n(d.g, 0, 2), 10), l: Math.round(n(d.l, 0, 3)),
    f: Math.round(n(d.f, 0, 15)), s: Math.round(n(d.s, 0, 2)), k: round(n(d.k, 0, 1), 10), t: round(n(d.t, -0.1, 0.1)), d: dents,
  };
}

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
  constructor(code, { tickRate = 20, maxPlayers = 4, log = () => {}, map = DEFAULT_MAP } = {}) {
    this.code = code;
    this.map = map;                // which map the room drives (the first player's pick)
    this.public = false;           // a quick-match room: anyone looking for a game may be put in it
    this.tickRate = tickRate;
    this.maxPlayers = maxPlayers;
    this.log = log;
    this.players = new Map();
    this.beacons = new Map();      // id -> name of the player who surveyed it
    this.race = null;              // { id, at, racers: Map(player id -> { name, time: undefined | null | s }) }
    this.layout = null;            // the map builder's props here (a share code), for whoever joins
    this.broken = new Set();       // what has been knocked down here (World keys), for whoever joins
    this.nextId = 1;
    this.emptySince = Date.now();
  }

  get size() { return this.players.size; }

  add(player) {
    player.id = this.nextId++;
    this.players.set(player.id, player);
    this.emptySince = 0;
    this.send(player, {
      t: 'welcome', id: player.id, room: this.code, map: this.map, public: this.public ? 1 : 0, tickRate: this.tickRate, maxPlayers: this.maxPlayers,
      players: [...this.players.values()].filter((p) => p !== player).map((p) => ({ id: p.id, name: p.name, ...(p.dmg ? { dmg: p.dmg } : {}), ...(p.voice ? { voice: 1, mic: p.mic ? 1 : 0, mute: p.mute ? 1 : 0 } : {}) })),
      beacons: [...this.beacons.keys()],
      race: this.race ? { id: this.race.id, at: this.race.at, racers: this.racerList() } : null,
      ...(this.layout ? { layout: this.layout } : {}),
      ...(this.broken.size ? { broken: [...this.broken] } : {}),
    });
    this.broadcast({ t: 'join', id: player.id, name: player.name }, player);
    this.log(`[room ${this.code}] ${player.name} (#${player.id}) joined, ${this.size}/${this.maxPlayers}`);
  }

  remove(player) {
    if (this.players.get(player.id) !== player) return;
    this.players.delete(player.id);
    if (this.size === 0) this.emptySince = Date.now();
    this.broadcast({ t: 'leave', id: player.id, name: player.name });
    const me = this.race?.racers.get(player.id);
    if (me && me.time === undefined) { me.time = null; this.checkRace(); }
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
      case 'damage': {
        const d = cleanDamage(msg.d);
        if (!d) return;
        player.dmg = d;
        this.broadcast({ t: 'damage', id: player.id, d }, player);
        return;
      }
      case 'brk': {
        const k = msg.k;
        if (typeof k !== 'string' || !BREAK_RX.test(k) || this.broken.has(k) || this.broken.size >= MAX_BROKEN) return;
        this.broken.add(k);
        const d = Array.isArray(msg.d) && msg.d.length === 2 && msg.d.every(isNum) ? msg.d.map((x) => Math.max(-1, Math.min(1, x))) : [0, 1];
        const v = isNum(msg.v) ? Math.max(0, Math.min(MAX_SPEED, msg.v)) : 0;
        this.broadcast({ t: 'brk', k, d, v }, player);
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
      case 'layout': {
        if (typeof msg.code !== 'string' || !LAYOUT_RX.test(msg.code)) return;
        const now = Date.now();
        if (now - (player.lastLayout || 0) < 300) return;
        player.lastLayout = now;
        this.layout = msg.code || null;
        this.broadcast({ t: 'layout', id: player.id, name: player.name, code: msg.code }, player);
        return;
      }
      case 'ping':
        this.send(player, { t: 'pong', time: Date.now(), echo: isNum(msg.time) ? msg.time : 0 });
        return;
      case 'voice':
        player.voice = !!msg.on; player.mic = player.voice && !!msg.mic; player.mute = player.mic && !!msg.mute;
        this.broadcast({ t: 'voice', id: player.id, on: player.voice ? 1 : 0, mic: player.mic ? 1 : 0, mute: player.mute ? 1 : 0 }, player);
        return;
      case 'rtc': {
        // a voice connection offer or answer, between two players in the voice chat
        const to = this.players.get(msg.to);
        if (!to || to === player || !player.voice || !to.voice || !msg.d || typeof msg.d !== 'object') return;
        if (JSON.stringify(msg.d).length > MAX_RTC) return;
        this.send(to, { t: 'rtc', from: player.id, d: msg.d });
        return;
      }
      case 'ev':
        this.event(player, msg);
        return;
      default:
    }
  }

  // ---- races
  racerList() { return [...this.race.racers].map(([id, r]) => ({ id, name: r.name })); }

  event(player, msg, now = Date.now()) {
    const r = this.race;
    if (msg.k === 'open') {
      if (r || typeof msg.id !== 'string' || !EVENT_RX.test(msg.id)) return;
      this.race = { id: msg.id, at: now + RACE_LEAD, racers: new Map([[player.id, { name: player.name, time: undefined }]]) };
      this.broadcast({ t: 'ev', k: 'open', id: msg.id, by: player.id, name: player.name, at: this.race.at, racers: this.racerList() });
      this.log(`[room ${this.code}] ${player.name} opened a race: ${msg.id}`);
    } else if (msg.k === 'join') {
      if (!r || now >= r.at || r.racers.has(player.id)) return;
      r.racers.set(player.id, { name: player.name, time: undefined });
      this.broadcast({ t: 'ev', k: 'join', id: r.id, pid: player.id, name: player.name, racers: this.racerList() });
    } else if (msg.k === 'done') {
      const me = r?.racers.get(player.id);
      if (!me || me.time !== undefined) return;
      me.time = isNum(msg.time) && msg.time > 0 && msg.time < 3600 && now >= r.at ? round(msg.time, 100) : null;
      this.broadcast({ t: 'ev', k: 'done', id: r.id, pid: player.id, name: player.name, time: me.time });
      this.checkRace(now);
    }
  }

  /** End the race once every racer is done (or gone), or it has run too long. */
  checkRace(now = Date.now()) {
    const r = this.race;
    if (!r) return;
    const all = [...r.racers.values()].every((x) => x.time !== undefined);
    if (!all && now < r.at + RACE_MAX) return;
    this.race = null;
    this.broadcast({ t: 'ev', k: 'end', id: r.id, results: [...r.racers].map(([id, x]) => ({ id, name: x.name, time: x.time ?? null })) });
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
        winch = { to, a: W.a.map((c) => round(c)), f: W.f.map((c) => round(c)), len: round(clamp(W.len, 0, 100)), ten: round(clamp(isNum(W.ten) ? W.ten : 0, 0, 1e6), 1), rate: round(clamp(isNum(W.rate) ? W.rate : 0, -5, 5)) };
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
    if (this.race) this.checkRace();
    if (this.size === 0) return;
    const players = [];
    for (const p of this.players.values()) if (p.s) players.push({ id: p.id, name: p.name, s: p.s });
    this.broadcast({ t: 'snapshot', time: Date.now(), players });
  }

  /** A voice frame to relay (binary [1, seq hi, seq lo, audio...]): to everyone else in voice, with who said it. */
  voiceFrame(player, data) {
    if (!player.voice || !player.mic || data.length < 4 || data.length > MAX_VOICE_FRAME || data[0] !== 1) return;
    const out = Buffer.allocUnsafe(data.length + 2);
    out[0] = 1; out.writeUInt16BE(player.id & 0xffff, 1);
    data.copy(out, 3, 1);
    for (const p of this.players.values()) if (p !== player && p.voice) p.ws.send(out);
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

  /** The room with a code, opened on `map` if it doesn't exist yet, or if nobody is in it (whoever comes back to an
   *  empty room opens it again, on their map: the beacons found and any race were the old map's). */
  room(code, map = DEFAULT_MAP) {
    let r = this.rooms.get(code);
    if (r && r.size === 0 && r.map !== map) { this.rooms.delete(code); r = null; }
    if (!r) {
      if (this.rooms.size >= MAX_ROOMS) { this.sweep(); if (this.rooms.size >= MAX_ROOMS) return null; }
      r = new Room(code, { tickRate: this.tickRate, maxPlayers: this.maxPlayers, log: this.log, map });
      this.rooms.set(code, r);
    }
    return r;
  }

  /** A quick match on `map`: the fullest public room there with a seat free, or a new public one. */
  quickRoom(map = DEFAULT_MAP) {
    let best = null;
    for (const r of this.rooms.values()) {
      if (!r.public || r.map !== map || r.size === 0 || r.size >= r.maxPlayers) continue;
      if (!best || r.size > best.size) best = r;
    }
    if (best) return best;
    const r = this.room(this.newCode(), map);
    if (r) r.public = true;
    return r;
  }

  addConnection(ws) {
    const player = { id: 0, ws, name: null, room: null, s: null, lastUpdate: 0, msgWindowStart: Date.now(), msgCount: 0 };
    const send = (obj) => ws.send(JSON.stringify(obj));

    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (isBinary) {
        // voice: its own budget (a talking player sends 25 frames a second besides the truck's state)
        if (now - (player.voiceWindow || 0) > 1000) { player.voiceWindow = now; player.voiceCount = 0; }
        if (++player.voiceCount <= MAX_VOICE_RATE && player.room) player.room.voiceFrame(player, data);
        return;
      }
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
        const map = typeof msg.map === 'string' && MAP_RX.test(msg.map) ? msg.map : DEFAULT_MAP;
        const room = msg.quick === true && !asked ? this.quickRoom(map) : this.room(asked || this.newCode(), map);
        const code = room?.code;
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

module.exports = { Lobby, Room, normalizeCode, randomCode, MAX_SPEED, MAX_TELEPORT, BEACON_COUNT, RACE_LEAD };
