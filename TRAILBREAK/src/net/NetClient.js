// Multiplayer client: joins a room (server/rooms.js), sends this truck's state at the server's tick rate, and keeps a
// short buffer of everyone else's so they can be drawn smoothly about 120 ms in the past (interpolated between
// snapshots, extrapolated briefly if one is late).

const DELAY = 0.12;              // s behind the newest data
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

export class NetClient {
  constructor({ name, room, map, onEvent }) {
    this.name = name;
    this.roomAsk = room || '';
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
      const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      const timer = setTimeout(() => { fail('The server did not answer.'); try { ws.close(); } catch { /* closed */ } }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name: this.name, room: this.roomAsk, map: this.mapAsk }));
      ws.onerror = () => fail('Could not reach the server.');
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.connected;
        this.connected = false;
        fail(this.lastError || 'The connection closed.');
        if (was) this.onEvent({ t: 'disconnected' });
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'welcome') {
          clearTimeout(timer);
          this.id = m.id; this.room = m.room; this.tickRate = m.tickRate; this.maxPlayers = m.maxPlayers; this.map = m.map || null;
          this.connected = true;
          for (const p of m.players) { const r = this.remote(p.id, p.name); if (p.dmg) r.dmg = p.dmg; }
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
        const now = Date.now();
        const sample = m.time - now;
        this.offset = this.offset === null ? sample : this.offset + (sample - this.offset) * 0.05;
        const live = new Set();
        for (const p of m.players) {
          if (p.id === this.id) continue;
          live.add(p.id);
          const r = this.remote(p.id, p.name);
          const last = r.snaps[r.snaps.length - 1];
          if (last && p.s.warp !== last.s.warp) r.snaps.length = 0;             // a respawn: don't slide across the map
          r.snaps.push({ t: m.time / 1000, s: p.s });
          if (r.snaps.length > 30) r.snaps.shift();
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

  /** Interpolated state of a remote player at render time, or null. */
  sample(r) {
    const snaps = r.snaps;
    if (!snaps.length || this.offset === null) return null;
    const t = (Date.now() + this.offset) / 1000 - DELAY;
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
    } else {
      // late: carry on along the last velocity for a moment
      const dt = Math.min(MAX_EXTRAP, Math.max(0, t - a.t));
      for (let i = 0; i < 3; i++) { out.pos[i] = sa.p[i] + sa.v[i] * dt; out.vel[i] = sa.v[i]; }
      for (let i = 0; i < 4; i++) out.quat[i] = sa.q[i];
      for (let w = 0; w < 4; w++) for (let k = 0; k < 3; k++) out.wh[w][k] = sa.wh[w][k];
      out.rpm = sa.rpm; out.thr = sa.thr;
    }
    out.truck = sa.truck; out.cfg = sa.cfg || ''; out.help = sa.help ? 1 : 0; out.paint = sa.paint; out.lights = sa.lights; out.winch = (b ? b.s : sa).winch; out.brk = sa.brk;
    out.stale = t - snaps[snaps.length - 1].t > 3;
    return out;
  }

  /** Send our truck's state (rate limited to the tick rate). */
  sendState(dt, v, extra) {
    this.sendT += dt;
    if (!this.connected || this.sendT < 1 / this.tickRate) return;
    this.sendT = 0;
    const s = {
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
}
