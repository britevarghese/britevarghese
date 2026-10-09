// NetworkClient: multiplayer. When the host has multiplayer on (config.json "multiplayer.enabled", on
// by default, or `--multiplayer`), the client connects to /ws, sends its state at the server tick rate
// and renders the other players with snapshot interpolation: their car or bike (swapped whenever they
// switch, steal or take one), or their character when they are on foot, with a name tag above.
// Cars a player leaves in the street are shared too: anyone can walk up and take one (the server
// hands it over first come, first served). Remote cars are solid: your car and your character
// collide with them. Street traffic is shared: players near each other form a group and the lowest id
// in it runs the traffic for all of them (streamed at 10 Hz, interpolated like the players), so
// everyone sees the same cars in the same places. Police and races stay local to each player.
import * as THREE from 'three';
import { VehicleRenderer } from '../vehicles/VehicleRenderer.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { CARS, TRAFFIC_VEHICLES, POLICE_CAR } from '../vehicles/VehicleCatalog.js';
import { buildCharacter } from '../player/OnFoot.js';
import { bus } from '../core/EventBus.js';
import { TYPE_SPECS } from '../traffic/TrafficManager.js';

const INTERP_DELAY = 0.12;   // seconds of buffering for smooth interpolation
const WARP_DIST = 40;        // a jump this far between sends is announced as a teleport
const MAX_PARKED = 4;
const GROUP_JOIN = 450, GROUP_LEAVE = 600; // m: players this close share one traffic simulation
const TRAFFIC_HZ = 10;
const TRAFFIC_DELAY = 0.2; // s: remote traffic is drawn this far in the past (interpolation)
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

// size / mass of any vehicle id the game knows (unknown ids from other clients fall back to a sedan)
export function vehicleDef(id) {
  const c = CARS[id] || TRAFFIC_VEHICLES[id] || (id === 'interceptor' ? POLICE_CAR : null);
  return c ? { id, p: c.params } : { id: 'sedan', p: TRAFFIC_VEHICLES.sedan.params };
}

// a remote car as a solid, kinematic box (for VehiclePhysics.resolvePair and on-foot collisions)
class Proxy {
  constructor(id) { this.s = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, damage: 0 }; this.setCar(id); }
  setCar(id) {
    const { p } = vehicleDef(id);
    const w = p.width || 1.9, l = p.length || 4.5, m = p.mass || 1500;
    this.p = { width: w, length: l, mass: m, hx: w / 2, hz: l / 2, inertia: m * (l * l + w * w) / 12 };
  }
  get state() { return this.s; }
  obb() { const s = this.s; return { cx: s.x, cz: s.z, hx: this.p.hx * 0.96, hz: this.p.hz * 0.97, cos: Math.cos(s.yaw), sin: Math.sin(s.yaw) }; }
}

// each player their own colour (the same on every screen: from the id), used on the map, the minimap and the tag
const FRIEND_COLORS = ['#b967ff', '#ff8a3d', '#3dd6ff', '#ff4fb0', '#7dff5a', '#ffd23d', '#ff5a5a', '#5a8cff'];
export const friendColor = (id) => FRIEND_COLORS[Math.abs(Number(id) || 0) % FRIEND_COLORS.length];

// a name tag over a player: their name in their colour and how far away they are; it keeps the same size on screen
// and, for the one you are tracking, shows through buildings
function nameTag(r) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 72;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }));
  s.scale.set(0.24, 0.045, 1); s.renderOrder = 10;
  s.userData.draw = (dist, tracked) => {
    const label = `${tracked ? '◎ ' : ''}${r.name}${dist > 40 ? ' · ' + (dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m') : ''}`;
    if (s.userData.label === label) return;
    s.userData.label = label;
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    g.font = '700 32px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = Math.min(378, g.measureText(label).width + 34), col = friendColor(r.id);
    g.fillStyle = 'rgba(10,12,18,0.78)'; g.beginPath(); g.roundRect(192 - w / 2, 8, w, 54, 14); g.fill();
    g.strokeStyle = col; g.lineWidth = tracked ? 5 : 3; g.stroke();
    g.fillStyle = col; g.fillText(label, 192, 36);
    tex.needsUpdate = true;
  };
  return s;
}

export class NetworkClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = 0;
    this.remotes = new Map(); // id -> remote player
    this.tickRate = 20;
    this.sendT = 0;
    this.connected = false;
    this.clock = 0;
    this.warp = 0;
    this.nextKey = 1;
    this.names = new Map();
    this.pendingTake = null;
    this.links = new Set();   // "a|b" pairs of players currently close enough to share traffic
    this.trafficBuf = [];     // [{t, from, cars: Map}] from the player running our group's traffic
    this.trafficT = 0;
    this.trafficHost = 0;     // id of the player running our traffic (our own id = us)
  }

  get name() { return (this.game.settings.gameplay.playerName || '').trim() || this._rand || (this._rand = `Driver${Math.floor(Math.random() * 900 + 100)}`); }
  get online() { return this.connected ? this.remotes.size + 1 : 0; }

  async connect() {
    let cfg;
    try { cfg = await (await fetch('/api/config')).json(); } catch { return false; }
    if (!cfg?.multiplayer?.enabled) { this.status = 'off'; return false; }
    this.cfg = cfg.multiplayer;
    this.status = 'connecting';
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${cfg.multiplayer.path || '/ws'}`;
    return new Promise((resolve) => {
      try { this.ws = new WebSocket(url); } catch { this.status = 'error'; resolve(false); return; }
      this.ws.onopen = () => { this.ws.send(JSON.stringify({ t: 'hello', name: this.name })); };
      this.ws.onmessage = (e) => this._onMessage(e.data, resolve);
      this.ws.onclose = () => {
        const was = this.connected;
        this.connected = false; this.status = 'disconnected';
        for (const r of this.remotes.values()) this._disposeRemote(r);
        this.remotes.clear();
        if (was) { bus.emit('toast', { text: 'Multiplayer: disconnected, retrying...', type: 'err' }); setTimeout(() => this.connect(), 4000); }
        resolve(false);
      };
      this.ws.onerror = () => resolve(false);
    });
  }

  // reconnect with a new name (settings)
  rename() {
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; try { this.ws.close(); } catch { /* already closed */ } }
    this.connected = false; this.status = 'connecting';
    for (const r of this.remotes.values()) this._disposeRemote(r);
    this.remotes.clear(); this.names.clear();
    this.connect();
  }

  _send(o) { if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  _onMessage(data, resolve) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'welcome') {
      this.id = m.id; this.tickRate = m.tickRate; this.connected = true; this.status = 'connected';
      for (const p of m.players || []) this.names.set(p.id, p.name);
      const others = (m.players || []).length;
      bus.emit('toast', { text: `Online as ${this.name}${others ? ` · ${others} other player${others > 1 ? 's' : ''} in the city` : ''}` });
      resolve?.(true);
    } else if (m.t === 'join') {
      this.names.set(m.id, m.name);
      bus.emit('toast', { text: `${m.name} joined the city` });
    } else if (m.t === 'snapshot') {
      for (const pl of m.players) {
        if (pl.id === this.id || !pl.s) continue;
        this.names.set(pl.id, pl.name);
        let r = this.remotes.get(pl.id);
        if (!r) { r = { id: pl.id, name: pl.name, buf: [], x: pl.s.p[0], z: pl.s.p[2], parked: new Map(), phase: 0 }; this.remotes.set(pl.id, r); }
        r.buf.push({ t: performance.now() / 1000, s: pl.s });
        if (r.buf.length > 30) r.buf.shift();
        this._syncParked(r, pl.s.parked || []);
      }
    } else if (m.t === 'leave') {
      this.names.delete(m.id);
      const r = this.remotes.get(m.id);
      if (r) this._disposeRemote(r);
      this.remotes.delete(m.id);
      if (m.name) bus.emit('toast', { text: `${m.name} left` });
    } else if (m.t === 'traffic') {
      if (m.from !== this.trafficHost) return;
      const cars = new Map();
      for (const c of m.cars) cars.set(c[0], c);
      this.trafficBuf.push({ t: performance.now() / 1000, cars });
      if (this.trafficBuf.length > 12) this.trafficBuf.shift();
    } else if (m.t === 'correction' && m.s) {
      // server rejected our state (unannounced teleport / speed): snap back
      const fs = this.game.onFoot?.active ? null : this.game.player?.physics;
      if (fs) fs.place(m.s.p[0], m.s.p[2], fs.s.yaw);
    } else if (m.t === 'taken') {
      this._lose(m.k, m.by);
    } else if (m.t === 'take-ok') {
      this.pendingTake = null;
      const r = this.remotes.get(m.owner);
      const pc = r?.parked.get(m.k);
      if (pc) { this._disposeParked(pc); r.parked.delete(m.k); }
      this.game.onFoot?.enterTaken?.(m, this.names.get(m.owner) || r?.name);
    } else if (m.t === 'take-fail') {
      this.pendingTake = null;
      bus.emit('toast', { text: 'Someone got there first', type: 'err' });
    }
  }

  // ------------------------------------------------------------------ taking other players' cars
  requestTake(proxy) {
    if (this.pendingTake) return;
    this.pendingTake = { owner: proxy.owner, k: proxy.k, t: performance.now() / 1000 };
    this._send({ t: 'take', owner: proxy.owner, k: proxy.k });
  }

  // one of our parked cars was taken by another player
  _lose(k, by) {
    const g = this.game, of = g.onFoot;
    const v = [...(of?.parked || []), g.player].find((x) => x && x.netKey === k);
    if (!v) return;
    if (of && of.parked.includes(v)) { of.parked.splice(of.parked.indexOf(v), 1); v.dispose(); }
    else if (v === g.player) { v.gone = true; v.renderer && (v.renderer.group.visible = false); v.place(-1e5, -1e5, 0); }
    bus.emit('toast', { text: `${by || 'Another player'} drove off in your ${vehicleName(v.carId)}`, type: 'err', time: 4 });
  }

  // ------------------------------------------------------------------ remote parked cars
  _syncParked(r, list) {
    const seen = new Set();
    for (const c of list) {
      seen.add(c.k);
      let pc = r.parked.get(c.k);
      if (pc && pc.car !== c.car) { this._disposeParked(pc); pc = null; }
      if (!pc) { pc = { k: c.k, car: c.car, paint: c.paint, proxy: new Proxy(c.car), renderer: null }; pc.proxy.owner = r.id; pc.proxy.k = c.k; pc.proxy.remote = true; r.parked.set(c.k, pc); }
      Object.assign(pc.proxy.s, { x: c.p[0], y: c.p[1], z: c.p[2], yaw: c.yaw, vx: 0, vz: 0 });
      pc.proxy.carId = c.car; pc.paint = c.paint;
    }
    for (const [k, pc] of r.parked) if (!seen.has(k)) { this._disposeParked(pc); r.parked.delete(k); }
  }

  _disposeParked(pc) { pc.renderer?.dispose(); pc.renderer = null; }
  _disposeRemote(r) {
    r.renderer?.dispose(); r.renderer = null;
    if (r.char) this.game.scene.remove(r.char.group);
    if (r.tag) { this.game.scene.remove(r.tag); r.tag.material.map.dispose(); r.tag.material.dispose(); }
    for (const pc of r.parked.values()) this._disposeParked(pc);
  }

  // model for a vehicle id, streamed in on demand
  _renderer(car, paint) {
    const lib = this.game.lib;
    if (!lib.has(car)) {
      this.loading ||= new Set();
      if (!this.loading.has(car)) { this.loading.add(car); lib.load([car], 4).then(() => { if (lib.has(car)) this.loading.delete(car); }); } // failed ids stay in the set: no retry storm
      return null;
    }
    const r = new VehicleRenderer(lib, car, { headlights: 0, shadow: false, lodDistance: this.game.preset?.carLod1Distance || 60, sharedPaint: true });
    r.applyCustom({ paint: paint || '#888888', finish: 'metallic', tint: 0.4, ...(CARS[car]?.real ? CARS[car].look : {}) });
    this.game.scene.add(r.group);
    return r;
  }

  // solid remote cars near (x, z): the cars other players drive and the ones they parked
  proxies() {
    const out = [];
    if (!this.connected) return out;
    for (const r of this.remotes.values()) {
      if (r.proxy && !r.foot) out.push(r.proxy);
      for (const pc of r.parked.values()) out.push(pc.proxy);
    }
    return out;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    // wall clock (frame dt is capped, so summing it would drift behind the snapshots on slow frames)
    this.clock = performance.now() / 1000;
    this._dt = dt;
    if (!this.connected) {
      if (this.game.traffic?.remote) { this.game.traffic.remote = null; this.game.traffic.foci = []; }
      return;
    }
    const g = this.game;
    if (this.pendingTake && this.clock - this.pendingTake.t > 3) this.pendingTake = null;
    this._sendState(dt);
    this._group(dt);
    this._collide();
    const renderT = this.clock - INTERP_DELAY;
    const cam = g.camera.position, env = g.env.state;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let i = Math.max(0, b.length - 2);
      while (i > 0 && b[i].t > renderT) i--;
      const a = b[i], c = b[Math.min(i + 1, b.length - 1)];
      // across a teleport or an in/out of a car: no blending
      const jump = a.s.warp !== c.s.warp || a.s.foot !== c.s.foot;
      const k = jump ? 1 : Math.min(1, Math.max(0, (renderT - a.t) / ((c.t - a.t) || 1)));
      const x = a.s.p[0] + (c.s.p[0] - a.s.p[0]) * k, y = a.s.p[1] + (c.s.p[1] - a.s.p[1]) * k, z = a.s.p[2] + (c.s.p[2] - a.s.p[2]) * k;
      _q.set(...a.s.q); _q2.set(...c.s.q); _q.slerp(_q2, k);
      _e.setFromQuaternion(_q, 'YXZ');
      const sp = Math.hypot(c.s.v[0], c.s.v[2]);
      r.x = x; r.z = z; r.foot = !!c.s.foot;
      if (r.foot) {
        if (r.renderer) { r.renderer.dispose(); r.renderer = null; r.car = null; }
        // a realistic character once the people models are in (each player keeps one look), else the simple figure
        if (r.char && !r.char.human && g.humans?.ready) { g.scene.remove(r.char.group); r.char = null; }
        if (!r.char) {
          const human = g.humans?.create(r.id + 1, { shadow: false });
          r.char = human ? { human, group: human.group } : buildCharacter({ jacket: 0x3a1f5c });
          g.scene.add(r.char.group);
        }
        r.char.group.visible = true;
        r.char.group.position.set(x, y, z);
        if (r.char.human) {
          r.char.group.rotation.set(0, _e.y, 0);
          r.char.group.updateMatrixWorld(true);
          r.char.human.animate(sp, dt);
        } else {
          r.phase += dt * (sp > 3 ? 1.6 + sp * 0.95 : 2.2 + sp * 2.6);
          const sw = Math.min(1, sp / 2) * (sp > 3 ? 0.95 : 0.55);
          r.char.legL.rotation.x = Math.sin(r.phase) * sw; r.char.legR.rotation.x = -Math.sin(r.phase) * sw;
          r.char.armL.rotation.x = -Math.sin(r.phase) * sw * 0.8; r.char.armR.rotation.x = Math.sin(r.phase) * sw * 0.8;
          r.char.group.rotation.set(sp > 3 ? 0.12 : 0, _e.y, 0);
        }
      } else {
        if (r.char) r.char.group.visible = false;
        if (r.car !== c.s.car) { r.renderer?.dispose(); r.renderer = null; r.car = c.s.car; r.proxy = new Proxy(c.s.car); r.proxy.remote = true; }
        if (!r.renderer) r.renderer = this._renderer(c.s.car, c.s.paint);
        Object.assign(r.proxy.s, { x, y, z, yaw: _e.y, vx: c.s.v[0], vz: c.s.v[2] });
        if (r.renderer) {
          if (r.renderer.custom?.paint !== c.s.paint) r.renderer.applyCustom({ paint: c.s.paint });
          r.spin = (r.spin || 0) + sp * dt / 0.33;
          r.renderer.sync({ x, y, z, yaw: _e.y, pitch: -_e.x, roll: _e.z, wheelOff: [0, 0, 0, 0], wheelComp: [0, 0, 0, 0], wheelSpin: r.spin, wheelSteer: 0, brake: 0, speed: sp, nitroActive: false, onGround: true, groundY: y }, dt, cam, env);
        }
      }
      // name tag over the head / roof
      r.yaw = _e.y;
      if (!r.tag) { r.tag = nameTag(r); g.scene.add(r.tag); }
      // (seen from far off, so a friend can be found: up to 2 km, and the tracked one through walls)
      const dist = Math.hypot(x - cam.x, z - cam.z), tracked = g.gps?.friend === r.id;
      r.tag.position.set(x, y + (r.foot ? 2.15 : (vehicleDef(r.car).p.bike ? 2.0 : 1.9)) + Math.min(6, dist * 0.01), z);
      r.tag.visible = dist < 2000;
      r.tag.material.depthTest = !tracked;
      r.tag.userData.draw(dist, tracked);
      // their parked cars
      for (const pc of r.parked.values()) {
        if (!pc.renderer) pc.renderer = this._renderer(pc.car, pc.paint);
        if (pc.renderer) {
          const s = pc.proxy.s;
          pc.renderer.setRider?.(false);
          pc.renderer.sync({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: 0, roll: 0, wheelOff: [0, 0, 0, 0], wheelComp: [0, 0, 0, 0], wheelSpin: 0, wheelSteer: 0, brake: 0, speed: 0, nitroActive: false, onGround: true, groundY: s.y }, dt, cam, env);
        }
      }
    }
  }

  _sendState(dt) {
    const g = this.game, of = g.onFoot, pl = g.player;
    this.sendT += dt;
    if (!pl || this.sendT < 1 / this.tickRate) return;
    this.sendT = 0;
    const foot = !!of?.active;
    const s = foot ? of.state : pl.state;
    if (this.last && Math.hypot(s.x - this.last.x, s.z - this.last.z) > WARP_DIST) this.warp++;
    this.last = { x: s.x, z: s.z };
    _q.setFromEuler(_e.set(foot ? 0 : -s.pitch, s.yaw, foot ? 0 : s.roll, 'YXZ'));
    // cars we left in the street (the one we just got out of first)
    const parked = [];
    for (const v of [foot ? pl : null, ...(of?.parked || [])]) {
      if (!v || v.gone || parked.length >= MAX_PARKED) continue;
      v.netKey ||= this.nextKey++;
      parked.push({ k: v.netKey, car: v.carId, paint: paintOf(v), p: [v.state.x, v.state.y, v.state.z], yaw: v.state.yaw });
    }
    const car = foot ? (pl.gone ? 'sedan' : pl.carId) : pl.carId;
    this._send({ t: 'state', s: { p: [s.x, s.y, s.z], q: [_q.x, _q.y, _q.z, _q.w], v: [s.vx || 0, s.vy || 0, s.vz || 0], car, paint: paintOf(pl), foot: foot ? 1 : 0, warp: this.warp, parked } });
  }

  // ------------------------------------------------------------------ shared traffic
  // Groups are the connected components of "within GROUP_JOIN m" (with hysteresis), computed from the
  // same snapshots on every client, so all members agree who runs the traffic: the lowest id.
  _group(dt) {
    const g = this.game, tm = g.traffic;
    const me = g.focusState, pos = new Map([[this.id, { x: me.x, z: me.z }]]);
    for (const r of this.remotes.values()) if (r.buf.length) pos.set(r.id, { x: r.x, z: r.z });
    const ids = [...pos.keys()];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = Math.min(ids[i], ids[j]), b = Math.max(ids[i], ids[j]), key = a + '|' + b;
      const pa = pos.get(a), pb = pos.get(b), d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
      if (d < GROUP_JOIN) this.links.add(key); else if (d > GROUP_LEAVE) this.links.delete(key);
    }
    for (const key of this.links) { const [a, b] = key.split('|').map(Number); if (!pos.has(a) || !pos.has(b)) this.links.delete(key); }
    // my component
    const comp = new Set([this.id]), stack = [this.id];
    while (stack.length) {
      const x = stack.pop();
      for (const key of this.links) {
        const [a, b] = key.split('|').map(Number);
        const o = a === x ? b : b === x ? a : 0;
        if (o && !comp.has(o)) { comp.add(o); stack.push(o); }
      }
    }
    const host = Math.min(...comp);
    if (host !== this.trafficHost) { this.trafficHost = host; this.trafficBuf.length = 0; }
    if (!tm) return;
    if (host === this.id) {
      tm.remote = null;
      tm.foci = [...comp].filter((i) => i !== this.id).map((i) => pos.get(i));
      this.trafficT += dt;
      if (comp.size > 1 && this.trafficT >= 1 / TRAFFIC_HZ) { this.trafficT = 0; this._sendTraffic(tm); }
    } else {
      tm.foci = [];
      tm.remote ||= () => this._remoteTraffic();
    }
  }

  _sendTraffic(tm) {
    const r2 = (v) => Math.round(v * 100) / 100;
    const cars = tm.cars.map((c) => [c.id, c.type, r2(c.x), r2(c.y), r2(c.z), r2(c.yaw), r2(c.state === 'drive' ? c.v : Math.hypot(c.s2.vx, c.s2.vz)), c.brake ? 1 : 0, c.color.getHex()]);
    this._send({ t: 'traffic', cars });
  }

  // the host's cars, interpolated between its last two messages
  _remoteTraffic() {
    const b = this.trafficBuf, out = this._tOut || (this._tOut = []);
    out.length = 0;
    if (!b.length) return out;
    const renderT = this.clock - TRAFFIC_DELAY;
    let i = b.length - 1;
    while (i > 0 && b[i - 1].t > renderT) i--;
    const A = b[Math.max(0, i - 1)], B = b[i];
    const k = A === B ? 1 : Math.min(1.5, Math.max(0, (renderT - A.t) / ((B.t - A.t) || 1)));
    const pool = this._tPool || (this._tPool = new Map());
    const seen = new Set();
    for (const [id, c] of B.cars) {
      const a = A.cars.get(id) || c;
      let dy = c[5] - a[5]; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      let o = pool.get(id);
      if (!o || o.type !== c[1]) {
        const sp = TYPE_SPECS[c[1]] || TYPE_SPECS.sedan;
        o = { id, type: c[1], spec: sp, color: new THREE.Color(), spin: 0, pitch: 0, roll: 0, state: 'drive', p: { mass: sp.mass, inertia: sp.mass * (sp.l * sp.l + sp.w * sp.w) / 12, hx: sp.w / 2, hz: sp.l / 2 } };
        pool.set(id, o);
      }
      o.x = a[2] + (c[2] - a[2]) * k; o.y = a[3] + (c[3] - a[3]) * k; o.z = a[4] + (c[4] - a[4]) * k;
      o.yaw = a[5] + dy * k; o.v = c[6]; o.brake = c[7];
      o.color.setHex(c[8]);
      o.spin += o.v * (this._dt || 0.016) / 0.34;
      seen.add(id); out.push(o);
    }
    for (const id of pool.keys()) if (!seen.has(id)) pool.delete(id);
    return out;
  }

  // remote players' cars as obstacles for the traffic we run (they brake for them and get knocked)
  trafficObstacles() {
    const out = [];
    if (!this.connected || this.trafficHost !== this.id) return out;
    for (const r of this.remotes.values()) if (r.proxy && !r.foot) out.push(r.wrap || (r.wrap = { get physics() { return r.proxy; } }));
    return out;
  }

  // our car against the cars of other players (they are kinematic here; their own client moves them)
  _collide() {
    const g = this.game;
    if (g.onFoot?.active || !g.player) return;
    const ph = g.player.physics, s = ph.s;
    for (const px of this.proxies()) {
      if (Math.abs(px.s.x - s.x) > 8 || Math.abs(px.s.z - s.z) > 8) continue;
      const vx = px.s.vx, vz = px.s.vz, x = px.s.x, z = px.s.z;
      const hit = VehiclePhysics.resolvePair(ph, px);
      Object.assign(px.s, { x, z, vx, vz }); // the remote side is authoritative for itself
      if (hit?.impact > 2) {
        g.audio?.playEvent('collision', { intensity: Math.min(1, hit.impact / 25), type: 'traffic', position: { x: hit.x, y: 0.6, z: hit.z } });
        g.camCtl?.addShake(Math.min(0.8, hit.impact / 20));
      }
    }
    // the shared traffic someone else runs: solid for us, moved only by its host
    if (g.traffic?.remote) {
      const tp = this._tProxy || (this._tProxy = { s: { x: 0, z: 0, vx: 0, vz: 0, yawRate: 0, damage: 0, yaw: 0 }, p: null, c: null, obb() { const c = this.c; return { cx: this.s.x, cz: this.s.z, hx: this.p.hx * 0.95, hz: this.p.hz * 0.97, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw) }; } });
      for (const c of g.traffic.renderList) {
        if (Math.abs(c.x - s.x) > 9 || Math.abs(c.z - s.z) > 9) continue;
        tp.c = c; tp.p = c.p;
        Object.assign(tp.s, { x: c.x, z: c.z, vx: Math.sin(c.yaw) * c.v, vz: Math.cos(c.yaw) * c.v, yawRate: 0, damage: 0 });
        const hit = VehiclePhysics.resolvePair(ph, tp);
        if (hit?.impact) bus.emit('traffic:hit', { car: c, ...hit });
      }
    }
  }
}

function paintOf(v) { const p = v?.renderer?.custom?.paint; return typeof p === 'string' ? p : '#888888'; }
export function vehicleName(id) { return CARS[id]?.name || TRAFFIC_VEHICLES[id]?.name || 'car'; }
