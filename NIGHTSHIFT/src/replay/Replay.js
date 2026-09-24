// Instant replay: while driving, the last ~15 s of the player, rivals, police and traffic are recorded at
// 30 Hz. Replay mode freezes the live simulation, plays the recording back (interpolated) with cinematic
// cameras (chase, trackside, helicopter, bumper, wheel), slow motion and scrubbing, and hands the frame
// to photo mode on F2. Leaving the replay restores the live state exactly.
import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

const RATE = 1 / 30;
const LENGTH = 15;
const KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'vx', 'vz', 'speed', 'brake', 'wheelSpin', 'wheelSteer', 'yawRate'];
const ANGLES = new Set(['yaw', 'pitch', 'roll']);
export const REPLAY_CAMS = ['AUTO', 'CHASE', 'TRACKSIDE', 'HELICOPTER', 'BUMPER', 'WHEEL'];
const SPEEDS = [0.1, 0.25, 0.5, 1];

const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

function snap(s) {
  const o = {};
  for (const k of KEYS) o[k] = s[k];
  o.wheelOff = s.wheelOff ? [...s.wheelOff] : null;
  o.nitroActive = s.nitroActive; o.drifting = s.drifting; o.onGround = s.onGround;
  return o;
}
function mix(a, b, t, out) {
  for (const k of KEYS) out[k] = ANGLES.has(k) ? lerpAngle(a[k], b[k], t) : lerp(a[k], b[k], t);
  if (a.wheelOff && out.wheelOff) for (let i = 0; i < 4; i++) out.wheelOff[i] = lerp(a.wheelOff[i], b.wheelOff[i], t);
  out.nitroActive = t < 0.5 ? a.nitroActive : b.nitroActive; out.drifting = a.drifting; out.onGround = a.onGround;
}
const TRAFFIC_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'roll', 'spin', 'brake', 'dist'];

const _v = new THREE.Vector3(), _t = new THREE.Vector3();

export class Replay {
  constructor(game) {
    this.game = game;
    this.frames = [];
    this.acc = 0;
    this.active = false;
    this.trafficList = [];
    this.cam = 0; this.speedIdx = 3; this.playing = true;
  }

  get duration() { const f = this.frames; return f.length > 1 ? f[f.length - 1].t - f[0].t : 0; }
  clear() { this.frames.length = 0; this.acc = 0; }

  // ------------------------------------------------------------------ recording (drive mode only)
  record(dt) {
    this.acc += dt;
    if (this.acc < RATE) return;
    this.acc %= RATE;
    const g = this.game;
    const t = g.state.time;
    const others = [];
    for (const v of [...g.police.vehicles(), ...g.races.vehicles(), ...g.rivals.vehicles()]) others.push([v, snap(v.state)]);
    const traffic = g.traffic.renderList.map((c) => {
      const o = { type: c.type, color: c.color, lod: c.lod, spec: c.spec, ref: c };
      for (const k of TRAFFIC_KEYS) o[k] = c[k];
      return o;
    });
    this.frames.push({ t, player: snap(g.player.state), others, traffic });
    while (this.frames.length && t - this.frames[0].t > LENGTH) this.frames.shift();
  }

  // ------------------------------------------------------------------ playback
  enter() {
    const g = this.game;
    if (this.frames.length < 20) { g.ui.toast('Nothing to replay yet — drive for a few seconds', '', 2.5); return false; }
    this.active = true;
    this.prevMode = g.state.mode;
    g.state.mode = 'replay';
    g.audio.setPaused(true);
    document.getElementById('hud').classList.add('hidden');
    // remember the live state so leaving the replay restores it exactly
    this.live = [[g.player, snap(g.player.state)]];
    for (const [v] of this.frames[this.frames.length - 1].others) this.live.push([v, snap(v.state)]);
    this.t = this.frames[0].t; this.t0 = this.t; this.t1 = this.frames[this.frames.length - 1].t;
    this.playing = true; this.speedIdx = 3; this.cam = 0; this.camT = 0; this.autoIdx = 0;
    this.track = null; this.heliA = Math.random() * Math.PI * 2;
    g.camCtl.snap(g.player);
    g.ui.showReplay(this);
    return true;
  }

  exit(toDrive = true) {
    const g = this.game;
    this.active = false;
    for (const [v, s] of this.live) if (v.alive !== false) Object.assign(v.state, s, { wheelOff: s.wheelOff ?? v.state.wheelOff });
    for (const [v] of this.live) v.sync(0, g.camera.position, g.env.state);
    g.camCtl.snap(g.player);
    g.ui.clear();
    if (toDrive) g.resume(); else { g.state.mode = 'paused'; g.ui.showPause(); }
  }

  // photo mode from the current replay frame; photo mode hands control back via returnFromPhoto()
  toPhoto() { this.inPhoto = true; this.game.photo.enter(); }
  returnFromPhoto() { this.inPhoto = false; this.game.state.mode = 'replay'; this.game.ui.showReplay(this); }

  _frameAt(t) {
    const f = this.frames;
    let lo = 0, hi = f.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m].t <= t) lo = m; else hi = m; }
    const a = f[lo], b = f[hi];
    const k = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    return { a, b, k, i: lo };
  }

  _apply(t) {
    const g = this.game;
    const { a, b, k } = this._frameAt(t);
    const jump = Math.hypot(a.player.x - b.player.x, a.player.z - b.player.z) > 30; // teleport (reset/race start)
    mix(a.player, b.player, jump ? 0 : k, g.player.state);
    const bOthers = new Map(b.others);
    for (const [v, sa] of a.others) {
      if (v.alive === false) continue;
      const sb = bOthers.get(v) || sa;
      mix(sa, sb, k, v.state);
      if (!v.renderer?.group.parent) g.scene.add(v.renderer.group);
      v.sync(1 / 60, g.camera.position, g.env.state);
    }
    // traffic: match cars between frames by their live object
    const bt = new Map(b.traffic.map((c) => [c.ref, c]));
    const list = this.trafficList; list.length = 0;
    for (const ca of a.traffic) {
      const cb = bt.get(ca.ref) || ca;
      const o = { type: ca.type, color: ca.color, lod: ca.lod, spec: ca.spec };
      for (const key of TRAFFIC_KEYS) o[key] = key === 'yaw' ? lerpAngle(ca.yaw, cb.yaw, k) : lerp(ca[key], cb[key], k);
      list.push(o);
    }
  }

  // future position of the player (for trackside camera placement)
  _ahead(t, dt) { const { a } = this._frameAt(Math.min(this.t1, t + dt)); return a.player; }

  update(dt, input) {
    const g = this.game;
    if (input.consume('pause')) { this.exit(true); return; }
    if (input.consume('photo')) { this.toPhoto(); return; }
    if (input.consume('camera')) { this.cam = (this.cam + 1) % REPLAY_CAMS.length; this.track = null; g.ui.updateReplay?.(this); }
    if (input.consume('up')) { this.speedIdx = Math.min(SPEEDS.length - 1, this.speedIdx + 1); g.ui.updateReplay?.(this); }
    if (input.consume('down')) { this.speedIdx = Math.max(0, this.speedIdx - 1); g.ui.updateReplay?.(this); }
    if (input.consume('confirm') || input.consume('horn')) { this.playing = !this.playing; g.ui.updateReplay?.(this); }
    let scrub = 0;
    if (input.down.has('ArrowLeft')) scrub -= 1;
    if (input.down.has('ArrowRight')) scrub += 1;
    const rate = SPEEDS[this.speedIdx];
    if (scrub) this.t += scrub * dt * 3;
    else if (this.playing) this.t += dt * rate;
    if (this.t >= this.t1) { this.t = this.t0; this.track = null; } // loop
    if (this.t < this.t0) this.t = this.t0;
    this._apply(this.t);
    this._camera(dt * (scrub ? 3 : this.playing ? rate : 0), dt);
    g.fx2.speed = 0; g.fx2.nitro = g.player.state.nitroActive ? 0.6 : 0; g.fx2.damageFlash = 0;
    g.ui.updateReplay?.(this);
  }

  // ------------------------------------------------------------------ cameras
  _camera(simDt, dt) {
    const g = this.game, cam = g.camera, s = g.player.state;
    let mode = REPLAY_CAMS[this.cam];
    if (mode === 'AUTO') {
      this.camT += simDt;
      const shots = ['CHASE', 'TRACKSIDE', 'WHEEL', 'TRACKSIDE', 'HELICOPTER', 'BUMPER'];
      if (this.camT > 3.2) { this.camT = 0; this.autoIdx = (this.autoIdx + 1) % shots.length; this.track = null; }
      mode = shots[this.autoIdx];
    }
    this.shot = mode;
    const sp = Math.hypot(s.vx, s.vz);
    cam.near = 0.1;
    if (mode === 'CHASE') {
      g.camCtl.update(Math.max(simDt, 1e-3), g.player, { lookX: 0, lookY: 0 }, g.fx2);
      return;
    }
    if (mode === 'TRACKSIDE') {
      // plant a camera beside the road ahead of the car; re-plant once the car has passed well by
      const far = this.track && Math.hypot(this.track.x - s.x, this.track.z - s.z) > 38 && ((this.track.x - s.x) * s.vx + (this.track.z - s.z) * s.vz) < 0;
      if (!this.track || far) {
        const f = this._ahead(this.t, clamp(28 / Math.max(sp, 8), 0.8, 2.5));
        const side = Math.random() < 0.5 ? 1 : -1, h = f.yaw;
        this.track = { x: f.x + Math.cos(h) * 5.5 * side, y: f.y + 0.9 + Math.random() * 1.6, z: f.z - Math.sin(h) * 5.5 * side };
      }
      cam.position.set(this.track.x, this.track.y, this.track.z);
      const d = Math.hypot(this.track.x - s.x, this.track.z - s.z);
      cam.lookAt(s.x, s.y + 0.7, s.z);
      cam.fov = clamp(1800 / Math.max(d, 6) / 4 + 22, 22, 60); // long lens far away, wider as it passes
    } else if (mode === 'HELICOPTER') {
      this.heliA += dt * 0.12;
      _v.set(s.x + Math.sin(this.heliA) * 18, s.y + 40, s.z + Math.cos(this.heliA) * 18); // steep, so towers rarely block the view
      cam.position.lerp(_v, this.heliSet ? 1 - Math.exp(-dt * 2) : 1); this.heliSet = true;
      cam.lookAt(s.x + s.vx * 0.3, s.y, s.z + s.vz * 0.3);
      cam.fov = 34;
    } else if (mode === 'BUMPER' || mode === 'WHEEL') {
      const r = g.player.renderer;
      r.body.updateMatrixWorld(true);
      if (mode === 'BUMPER') _v.set(0, 0.45, 2.6); else _v.set(1.25, 0.4, -0.2);
      _v.applyMatrix4(r.body.matrixWorld);
      cam.position.copy(_v);
      if (mode === 'BUMPER') { _t.set(0, 0.4, 12).applyMatrix4(r.body.matrixWorld); cam.lookAt(_t); cam.fov = 70; }
      else { _t.set(0.9, 0.35, 3.5).applyMatrix4(r.body.matrixWorld); cam.lookAt(_t); cam.fov = 62; }
      cam.near = 0.05;
    }
    if (mode !== 'HELICOPTER') this.heliSet = false;
    cam.updateProjectionMatrix();
  }

  get speedLabel() { const r = SPEEDS[this.speedIdx]; return r === 1 ? '1x' : `${r}x`; }
}
