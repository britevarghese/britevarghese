// NetworkClient: optional multiplayer foundation. If the host enables multiplayer
// (config.json "multiplayer.enabled" or `--multiplayer`), the client connects to /ws, sends its
// VehicleState at the server tick rate and renders other players with snapshot interpolation.
// The server is authoritative for validation (speed clamp, teleport rejection).
import * as THREE from 'three';
import { VehicleRenderer } from '../vehicles/VehicleRenderer.js';
import { bus } from '../core/EventBus.js';

const INTERP_DELAY = 0.12; // seconds of buffering for smooth interpolation

export class NetworkClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = 0;
    this.remotes = new Map(); // id -> {name, buf:[{t,s}], x, z, renderer}
    this.tickRate = 20;
    this.sendT = 0;
    this.connected = false;
    this.clock = 0;
  }

  async connect() {
    let cfg;
    try { cfg = await (await fetch('/api/config')).json(); } catch { return false; }
    if (!cfg?.multiplayer?.enabled) return false;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${cfg.multiplayer.path || '/ws'}`;
    return new Promise((resolve) => {
      try { this.ws = new WebSocket(url); } catch { resolve(false); return; }
      this.ws.onopen = () => { this.ws.send(JSON.stringify({ t: 'hello', name: `Driver${Math.floor(Math.random() * 900 + 100)}` })); };
      this.ws.onmessage = (e) => this._onMessage(e.data, resolve);
      this.ws.onclose = () => { this.connected = false; for (const r of this.remotes.values()) r.renderer?.dispose(); this.remotes.clear(); };
      this.ws.onerror = () => resolve(false);
    });
  }

  _onMessage(data, resolve) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'welcome') { this.id = m.id; this.tickRate = m.tickRate; this.connected = true; bus.emit('toast', { text: `Multiplayer: connected as #${m.id}` }); resolve?.(true); }
    else if (m.t === 'snapshot') {
      for (const pl of m.players) {
        if (pl.id === this.id || !pl.s) continue;
        let r = this.remotes.get(pl.id);
        if (!r) { r = { name: pl.name, buf: [], x: 0, z: 0, renderer: null, car: pl.s.car }; this.remotes.set(pl.id, r); }
        r.buf.push({ t: this.clock, s: pl.s });
        if (r.buf.length > 30) r.buf.shift();
      }
    } else if (m.t === 'leave') {
      const r = this.remotes.get(m.id);
      r?.renderer?.dispose();
      this.remotes.delete(m.id);
    } else if (m.t === 'correction' && m.s) {
      // server rejected our state (teleport/speed) — snap back
      const p = this.game.player?.physics;
      if (p) p.place(m.s.p[0], m.s.p[2], p.s.yaw);
    }
  }

  update(dt) {
    this.clock += dt;
    if (!this.connected) return;
    // send local state
    this.sendT += dt;
    const pl = this.game.player;
    if (pl && this.sendT >= 1 / this.tickRate) {
      this.sendT = 0;
      const s = pl.state;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-s.pitch, s.yaw, s.roll, 'YXZ'));
      this.ws.send(JSON.stringify({ t: 'state', s: { p: [s.x, s.y, s.z], q: [q.x, q.y, q.z, q.w], v: [s.vx, s.vy || 0, s.vz], car: pl.carId, paint: pl.renderer?.custom?.paint || '#ffffff' } }));
    }
    // interpolate remotes
    const renderT = this.clock - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (b.length < 2) continue;
      let i = b.length - 2;
      while (i > 0 && b[i].t > renderT) i--;
      const a = b[i], c = b[i + 1];
      const k = Math.min(1, Math.max(0, (renderT - a.t) / ((c.t - a.t) || 1)));
      const x = a.s.p[0] + (c.s.p[0] - a.s.p[0]) * k, y = a.s.p[1] + (c.s.p[1] - a.s.p[1]) * k, z = a.s.p[2] + (c.s.p[2] - a.s.p[2]) * k;
      const qa = new THREE.Quaternion(...a.s.q), qc = new THREE.Quaternion(...c.s.q);
      qa.slerp(qc, k);
      r.x = x; r.z = z;
      if (!r.renderer && this.game.lib.has(c.s.car)) {
        r.renderer = new VehicleRenderer(this.game.lib, c.s.car, { headlights: 0 });
        r.renderer.applyCustom({ paint: c.s.paint, finish: 'metallic' });
        this.game.scene.add(r.renderer.group);
      }
      if (r.renderer) {
        const e = new THREE.Euler().setFromQuaternion(qa, 'YXZ');
        const sp = Math.hypot(c.s.v[0], c.s.v[2]);
        r.spin = (r.spin || 0) + sp * dt / 0.34;
        r.renderer.sync({ x, y, z, yaw: e.y, pitch: -e.x, roll: e.z, wheelOff: [0, 0, 0, 0], wheelComp: [0, 0, 0, 0], wheelSpin: r.spin, wheelSteer: 0, brake: 0, speed: sp, nitroActive: false, onGround: true, groundY: y }, dt, this.game.camera.position, this.game.env.state);
      }
    }
  }
}
