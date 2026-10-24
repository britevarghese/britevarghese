// Multiplayer client: joins a room (server/rooms.js), sends this truck's state at the server's tick rate, and keeps a
// short buffer of everyone else's so they can be drawn smoothly a little in the past (interpolated between snapshots,
// extrapolated briefly if one is late). Each state carries the time its driver took it (on the server's clock), so
// the buffer holds every one at the moment it was true: the server sends the newest it has every tick, and a state
// it sends twice (none newer came in between) is one state, not a stop and a jump. How far behind a player is drawn
// is that player's own: as far as their states take to arrive (the slowest of late), so a laggy connection is shown
// a little later rather than guessed at and corrected.

const DELAY = 0.12;              // s behind the newest data (to start with: each player's own, by how late theirs come)
const MIN_DELAY = 0.08, MAX_DELAY = 0.6;
const MAX_EXTRAP = 0.25;         // s

const lerp = (a, b, t) => a + (b - a) * t;
function slerp(a, b, t, out) {
  let [ax, ay, az, aw] = a; let [bx, by, bz, bw] = b;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
  let k0 = 1 - t, k1 = t;
  if (cos < 0.9995) { const th = Math.acos(cos), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s; }
  out[0] = ax * k0 + bx * k1; out[1] = ay * k0 + by * k1; out[2] = az * k0 + bz * k1; out[3] = aw * k0 + bw * k1;
  const l = Math.hypot(out[0], out[1], out[2], out[3]) || 1;
  for (let i = 0; i < 4; i++) out[i] /= l;
  return out;
}
const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** Now (ms since 1970), to a fraction of a millisecond. */
const clock = () => performance.timeOrigin + performance.now();

export class NetClient {
  constructor({ name, room, map, quick, onEvent }) {
    this.name = name;
    this.roomAsk = room || '';
    this.quick = !!quick && !room;     // a quick match: into a public room with anyone looking for a game
    this.public = false;
    this.mapAsk = map || '';
    this.map = null;                   // the room's map (the one it was opened on)
    this.onEvent = onEvent || (() => {});
    this.ws = null;
    this.id = 0;
    this.room = null;
    this.tickRate = 20;
    this.remotes = new Map();          // id -> { id, name, snaps: [{ t, s }] }
    this.offset = null;                // server clock - local clock (ms)
    this.sendT = 0;
    this.connected = false;
    this.warp = 0;
    this.ping = 0;
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = this.ws = new WebSocket(this.url());
      ws.binaryType = 'arraybuffer';                  // (voice through the server: net/Voice.js)
      const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      const timer = setTimeout(() => { fail('The server did not answer.'); try { ws.close(); } catch { /* closed */ } }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, room: this.roomAsk, map: this.mapAsk, ...(this.quick ? { quick: true } : {}) }));
      ws.onerror = () => fail('Could not reach the server.');
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.connected;
        this.connected = false;
        fail(this.lastError || 'The connection closed.');
        if (was) this.onEvent({ t: 'disconnected' });
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') { this.onBinary?.(e.data); return; }
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.id = m.id; this.room = m.room; this.tickRate = m.tickRate; this.maxPlayers = m.maxPlayers; this.map = m.map || null; this.public = !!m.public;
          if (Number.isFinite(m.time)) this.offset = m.time - clock();      // (the snapshots refine it: none come while the map loads)
          this.connected = true;
          for (const p of m.players) { const r = this.remote(p.id, p.name); if (p.dmg) r.dmg = p.dmg; r.voice = p.voice; r.mic = p.mic; r.mute = p.mute; }
          settled = true;
          resolve(m);
          this.pingTimer = setInterval(() => this.send({ t: 'ping', time: performance.now() }), 2000);
          return;
        }
        if (m.t === 'error') { this.lastError = m.msg; this.onEvent(m); return; }
        this.handle(m);
      };
    });
  }

  remote(id, name) {
    let r = this.remotes.get(id);
    if (!r) { r = { id, name, snaps: [] }; this.remotes.set(id, r); }
    if (name) r.name = name;
    return r;
  }

  handle(m) {
    switch (m.t) {
      case 'snapshot': {
        // (the server's clock less ours, as the quickest of the last 2 s of snapshots tells it, the others late by
        // however long they took; eased onto, so the clock trucks are drawn by and stamp their states with runs even)
        const now = clock(), sample = m.time - now, win = this.offWin || (this.offWin = []);
        win.push(sample);
        if (win.length > 2 * this.tickRate) win.shift();
        const best = Math.max(...win);
        this.offset = this.offset === null || Math.abs(best - this.offset) > 250 ? best : this.offset + (best - this.offset) * 0.02;
        const live = new Set();
        for (const p of m.players) {
          if (p.id === this.id) continue;
          live.add(p.id);
          const r = this.remote(p.id, p.name);
          const last = r.snaps[r.snaps.length - 1], t = (Number.isFinite(p.s.ts) ? p.s.ts : m.time) / 1000;
          if (last && p.s.warp !== last.s.warp) r.snaps.length = 0;             // a respawn: don't slide across the map
          else if (last && t <= last.t) continue;                             // (the one we have, sent again)
          r.snaps.push({ t, s: p.s });
          if (r.snaps.length > 30) r.snaps.shift();
          // how late their states come: the latest of late, easing back down a few ms a state
          const lag = (now + this.offset) / 1000 - t;
          r.lagHi = Math.max(lag, (r.lagHi ?? lag) - 0.003);
          r.delayTarget = Math.min(MAX_DELAY, Math.max(MIN_DELAY, r.lagHi + 0.03));
        }
        break;
      }
      case 'damage': if (m.id !== this.id) this.remote(m.id).dmg = m.d; break;
      case 'join': this.remote(m.id, m.name); this.onEvent(m); break;
      case 'leave': this.remotes.delete(m.id); this.onEvent(m); break;
      case 'pong': this.ping = performance.now() - m.echo; break;
      case 'correction': this.onEvent(m); break;
      default: this.onEvent(m);
    }
  }

  send(o) { if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  /** A voice frame, dropped when the connection is backed up (late speech is worse than a gap). */
  sendBinary(b) { if (this.connected && this.ws.readyState === 1 && this.ws.bufferedAmount < 32768) this.ws.send(b); }

  /** How old (s) a remote truck's state is when sample() shows it: the interpolation delay, its trip up to the server
   *  (about half our ping) and the wait for its next send and the server's next tick. */
  get lead() { let d = 0; for (const r of this.remotes.values()) d = Math.max(d, r.delay ?? 0); return d || DELAY + this.ping / 2000 + 1 / this.tickRate; }
  /** How old (s) one remote truck's state is as it is shown. */
  leadOf(r) { return r?.delay ?? this.lead; }

  /** Interpolated state of a remote player at render time, or null. */
  sample(r) {
    const snaps = r.snaps;
    if (!snaps.length || this.offset === null) return null;
    // (their delay eased to how late their states come: the clock they're drawn on runs a touch fast or slow meanwhile)
    const now = (clock() + this.offset) / 1000, step = r.lastAt ? Math.min(0.1, Math.max(0, now - r.lastAt)) : 0;
    r.lastAt = now;
    r.delay = r.delay ?? DELAY;
    r.delay += ((r.delayTarget ?? DELAY) - r.delay) * Math.min(1, step * 1.5);
    const t = now - r.delay;
    let a = snaps[0], b = null;
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].t <= t) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    const out = r.view || (r.view = { pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], wh: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], rpm: 800, thr: 0, truck: 'ranger', cfg: '', paint: '#b5532c', lights: 0, winch: null });
    const sa = a.s;
    if (b) {
      const k = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-3, b.t - a.t)));
      const sb = b.s;
      for (let i = 0; i < 3; i++) { out.pos[i] = lerp(sa.p[i], sb.p[i], k); out.vel[i] = lerp(sa.v[i], sb.v[i], k); }
      slerp(sa.q, sb.q, k, out.quat);
      for (let w = 0; w < 4; w++) {
        out.wh[w][0] = lerp(sa.wh[w][0], sb.wh[w][0], k);
        out.wh[w][1] = angLerp(sa.wh[w][1], sb.wh[w][1], k);
        out.wh[w][2] = lerp(sa.wh[w][2], sb.wh[w][2], k);
      }
      out.rpm = lerp(sa.rpm, sb.rpm, k); out.thr = lerp(sa.thr, sb.thr, k);
      const wa = sa.winch, wb = sb.winch, same = wa && wb && wa.to === wb.to;
      out.winchLen = same ? lerp(wa.len, wb.len, k) : wb ? wb.len : 0;
      out.winchRate = wb && Number.isFinite(wb.rate) ? wb.rate : same ? (wb.len - wa.len) / Math.max(1e-3, b.t - a.t) : 0;
    } else {
      // late: carry on along the last velocity for a moment
      const dt = Math.min(MAX_EXTRAP, Math.max(0, t - a.t));
      for (let i = 0; i < 3; i++) { out.pos[i] = sa.p[i] + sa.v[i] * dt; out.vel[i] = sa.v[i]; }
      for (let i = 0; i < 4; i++) out.quat[i] = sa.q[i];
      for (let w = 0; w < 4; w++) for (let k = 0; k < 3; k++) out.wh[w][k] = sa.wh[w][k];
      out.rpm = sa.rpm; out.thr = sa.thr;
      out.winchRate = sa.winch && Number.isFinite(sa.winch.rate) ? sa.winch.rate : 0;
      out.winchLen = sa.winch ? sa.winch.len + out.winchRate * dt : 0;                 // (the line runs on with it)
    }
    out.truck = sa.truck; out.cfg = sa.cfg || ''; out.help = sa.help ? 1 : 0; out.paint = sa.paint; out.lights = sa.lights; out.winch = (b ? b.s : sa).winch; out.brk = sa.brk;
    out.warp = sa.warp;
    out.stale = t - snaps[snaps.length - 1].t > 3;
    return out;
  }

  /** Send our truck's state (rate limited to the tick rate). */
  sendState(dt, v, extra) {
    // (at an even pace: what is left over from one send counts toward the next)
    this.sendT += dt;
    if (!this.connected || this.sendT < 1 / this.tickRate) return;
    this.sendT = Math.min(this.sendT - 1 / this.tickRate, 1 / this.tickRate);
    const s = {
      ts: Math.round((clock() + (this.offset ?? 0)) * 10) / 10,
      p: [v.pos.x, v.pos.y, v.pos.z], q: [v.quat.x, v.quat.y, v.quat.z, v.quat.w],
      v: [v.vel.x, v.vel.y, v.vel.z], w: [v.angVel.x, v.angVel.y, v.angVel.z],
      wh: [0, 1, 2, 3].map((i) => v.wheelState(i)),
      rpm: v.dt.rpm, thr: v.dt.throttle, brk: v.pedalBrake > 0.1 ? 1 : 0,
      truck: extra.truck, cfg: extra.cfg || '', help: extra.help ? 1 : 0, paint: extra.paint, lights: extra.lights ? 1 : 0, warp: this.warp,
      winch: extra.winch || null,
    };
    this.send({ t: 'state', s });
  }

  close() { clearInterval(this.pingTimer); try { this.ws?.close(); } catch { /* closed */ } }

  /**
   * Back into the same room after the connection was lost (a server restart drops everyone, and a room is made again
   * by its code): a new id, the others as the welcome lists them. Resolves with the welcome, as connect() does.
   */
  reconnect() {
    clearInterval(this.pingTimer);
    this.roomAsk = this.room || this.roomAsk; this.mapAsk = this.map || this.mapAsk; this.quick = false;
    this.remotes.clear(); this.lastError = null;
    return this.connect();
  }
}
