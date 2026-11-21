// Boats you drive: on foot at the edge of Kerala's water (a backwater, a river, the harbour), press E to take a country
// boat with an outboard and steer it round. W / S throttle and reverse, A / D steer, shift for full throttle; it
// slows on its own, turns better with way on, and stops (with a knock) at the bank. Near land, E or F goes ashore
// and the boat stays moored there until you leave it behind.
// While aboard you are on foot as far as the game is concerned (the camera, the map, the police follow you): the
// on-foot update hands the frame to ride() (OnFoot.boat), which moves the boat and seats you in it.
import { AssetManager } from '../assets/AssetManager.js';
import * as THREE from 'three';
import { clamp, formatMoney } from '../core/util.js';
import { markerBeam } from '../world/MarkerBeam.js';

const HIRE = 50, ACCEL = 3.2, BOOST = 5, REV = 2.2, MAX = 12, MAX_BOOST = 16, TURN = 0.75, BOW = 3.4, STERN = 2.6;

export class BoatRide {
  constructor(game) { this.game = game; this.boat = null; this.moored = null; this.lookT = 0; this.spot = null; }
  get active() { return !!this.boat; }

  _surface(x, z) { return this.game.boats?._surface(x, z) ?? null; }
  _open(x, z, r) { return this.game.boats?._open(x, z, r) ?? false; }
  _model() { const M = this.game.boats?.models || {}; return M.canopy || M.vallam || null; }

  // water worth a boat: open 40 m out on at least half its sides (a backwater, a river, the sea - not a temple pond)
  _wide(x, z) {
    const w = this.game.world;
    let n = 0;
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; if (w.inWater(x + Math.sin(a) * 40, z + Math.cos(a) * 40)) n++; }
    return n >= 6;
  }

  // open water for a boat within reach of (x, z): a spot 4-11 m off, clear 4 m round, on wide water
  _launch(x, z) {
    const w = this.game.world;
    for (const r of [4.5, 6, 8, 11]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
      if (!w.inWater(px, pz) || !this._open(px, pz, 4) || !this._wide(px, pz)) continue;
      const y = this._surface(px, pz);
      if (y === null) continue;
      return { x: px, z: pz, y, yaw: a }; // pointing away from the bank
    }
    return null;
  }

  // on foot, each frame: offer a boat at the water's edge (or the moored one)
  update(dt, input) {
    const g = this.game, F = g.onFoot;
    if (this.boat || !F?.active || !g.world.kerala || g.interiors?.active || F.dead || F.seq || F.climb || F.inter?.busy) return;
    const s = F.state;
    if (this.moored && Math.hypot(this.moored.x - s.x, this.moored.z - s.z) > 300) this._drop(this.moored), (this.moored = null);
    if ((this.lookT -= dt) <= 0) {
      this.lookT = 0.4;
      const m = this.moored;
      this.spot = m && Math.hypot(m.x - s.x, m.z - s.z) < 9 ? { moored: m } : this._model() ? this._launch(s.x, s.z) : null;
    }
    if (!this.spot) return;
    const own = !!this.spot.moored;
    if (g.story?.active || g.races?.active) return;
    g.hud.setPrompt(own ? 'press <span class="key">E</span> to take your boat' : `press <span class="key">E</span> to take a country boat · ${'$' + HIRE}`);
    if (input.consume('event')) {
      if (!own && g.save.data.cash < HIRE) { g.ui.toast(`A boat costs $${HIRE}`, 'err', 2); return; }
      if (!own) g.save.addCash(-HIRE, 'boat');
      this.board(own ? this.spot.moored : this.spot);
    }
  }

  board(at) {
    const g = this.game, F = g.onFoot;
    let b = at.obj ? at : null;
    if (!b) {
      const obj = AssetManager.clone(this._model());
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.scene.add(obj);
      b = { obj, x: at.x, z: at.z, y: at.y, yaw: at.yaw, v: 0, steer: 0, t: 0 };
    }
    if (this.moored === b) this.moored = null;
    this.boat = b;
    F.boat = this;
    F.pistol?.holster?.();
    this.camDist = F.camDist; F.camDist = 8.5;
    F.camYaw = b.yaw;
    F.human?.play?.('sitIdle', { hold: true, fade: 0.25 });
    g.hud.setPrompt(null);
    g.audio?.playEvent?.('doorShut');
    this._motor(true);
    if (!this.told) { this.told = true; g.ui.toast('Boat: W / S throttle, A / D steer, shift for full speed. E or F near the bank to go ashore.', '', 6); }
  }

  // the frame while aboard (from OnFoot.update)
  ride(dt, input) {
    const g = this.game, F = g.onFoot, b = this.boat, w = g.world, ic = input.controls, s = F.state;
    if (F.dead) { this.end(); this.moored = b; return; } // (shot aboard: the on-foot update takes it from here)
    b.t += dt;
    const thr = ic.throttle || 0, rev = ic.brake || 0, boost = !!ic.nitro, top = boost ? MAX_BOOST : MAX;
    b.v += (thr * (boost ? BOOST : ACCEL) - rev * REV) * dt;
    b.v -= (b.v * Math.abs(b.v) * 0.03 + b.v * 0.18) * dt;       // water drag
    b.v = clamp(b.v, -3, top);
    b.steer += ((ic.steer || 0) - b.steer) * Math.min(1, dt * 4);
    b.yaw -= b.steer * TURN * clamp(Math.abs(b.v) / 3, 0.2, 1) * Math.sign(b.v || 1) * dt;
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    const nx = b.x + fx * b.v * dt, nz = b.z + fz * b.v * dt;
    // (the end leading the way and the middle: a boat nosed into the bank can always back off it)
    const lead = b.v >= 0 ? BOW : -STERN;
    if (w.inWater(nx + fx * lead, nz + fz * lead) && w.inWater(nx, nz)) { b.x = nx; b.z = nz; }
    else {
      if (Math.abs(b.v) > 3) g.audio?.playEvent?.('collision', { intensity: Math.min(1, Math.abs(b.v) / 12) * 0.5, position: { x: b.x, y: b.y, z: b.z } });
      b.v *= -0.25;
    }
    const y = this._surface(b.x, b.z); if (y !== null) b.y = y;
    this._motorUpdate(Math.max(thr, rev), Math.abs(b.v));
    const sp = Math.abs(b.v), bob = 0.05 + 0.02 * Math.min(1, sp / 8);
    b.obj.position.set(b.x, b.y + Math.sin(b.t * 1.4) * bob, b.z);
    b.obj.rotation.set(-Math.min(0.08, sp * 0.006) + Math.sin(b.t * 1.1) * bob * 0.3, b.yaw, Math.sin(b.t * 0.9) * bob * 0.5 + b.steer * sp * 0.006, 'YXZ');
    // you: sat in the boat (the camera and the map follow the on-foot state)
    s.x = b.x - fx * 0.8; s.z = b.z - fz * 0.8; s.y = b.y - 0.05; s.yaw = b.yaw;
    s.vx = fx * b.v; s.vz = fz * b.v; s.speed = sp; s.onGround = true;
    const body = F.body.group;
    body.position.set(s.x, s.y, s.z); body.rotation.set(0, s.yaw, 0); body.updateMatrixWorld(true);
    if (F.human) { if (!F.human.shot) F.human.play('sitIdle', { hold: true, fade: 0.2 }); F.human.animate(0, dt, false); } // sat on the thwart
    // ashore near land
    const land = sp < 4 ? this._shore() : null;
    if (this.run) this._runUpdate(dt);
    const canRun = !this.run && !land && !g.story?.active && !g.jobs?.working;
    g.hud.setPrompt(land && !this.run ? 'press <span class="key">E</span> / <span class="key">F</span> to go ashore' : canRun && sp < 6 ? 'press <span class="key">E</span> for a buoy run' : null);
    if (land && !this.run && (input.consume('event') || input.consume('enter'))) this.ashore(land);
    else if (canRun && sp < 6 && input.consume('event')) this._runStart();
    else if (this.run && land && input.consume('enter')) { this._runEnd(false, 'Run abandoned'); this.ashore(land); }
  }

  // a dry spot a person can stand on within 7 m of the boat
  _shore() {
    const g = this.game, w = g.world, b = this.boat;
    if ((b.shoreT = (b.shoreT || 0) - 1 / 30) > 0) return b.shore;
    b.shoreT = 0.25; b.shore = null;
    for (const r of [2.5, 3.5, 4.5, 6, 7]) for (let k = 0; k < 12; k++) {
      const a = b.yaw + (k / 12) * Math.PI * 2, px = b.x + Math.sin(a) * r, pz = b.z + Math.cos(a) * r;
      // (ground that's built: where it isn't yet, nothing reads as water)
      if (!w.groundKnown(px, pz, 2) || w.inWater(px, pz) || !g.onFoot._free(px, pz)) continue;
      return (b.shore = { x: px, z: pz });
    }
    return null;
  }

  // ------------------------------------------------------------------ the buoy run
  // A course of buoys across the open water ahead, against the clock: each leg 90-180 m, clear water all the way.
  // Under par doubles the prize; your best time for a course of that many buoys is kept.
  _course() {
    const b = this.boat, pts = [];
    let x = b.x, z = b.z, yaw = b.yaw, len = 0;
    const clear = (x0, z0, x1, z1) => { const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 8); for (let i = 1; i <= n; i++) if (!this._open(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, 6)) return false; return true; };
    for (let k = 0; k < 7; k++) {
      let got = null;
      for (let t = 0; t < 40 && !got; t++) {
        const a = yaw + (Math.random() - 0.5) * (t < 20 ? 1.6 : 5), d = 90 + Math.random() * 90, nx = x + Math.sin(a) * d, nz = z + Math.cos(a) * d;
        if (pts.some((q) => Math.hypot(q.x - nx, q.z - nz) < 60) || !clear(x, z, nx, nz)) continue;
        const y = this._surface(nx, nz); if (y === null) continue;
        got = { x: nx, z: nz, y, a, d };
      }
      if (!got) break;
      pts.push(got); len += got.d; x = got.x; z = got.z; yaw = got.a;
    }
    return pts.length >= 4 ? { pts, len } : null;
  }

  _runStart() {
    const g = this.game, C = this._course();
    if (!C) { g.ui.toast('Not enough open water here for a buoy run: head further out', '', 3); return; }
    const group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.45, 0.6, 1.6, 12).translate(0, 0.6, 0), beamGeo = new THREE.CylinderGeometry(0.7, 0.7, 40, 12, 1, true).translate(0, 20, 0);
    C.pts.forEach((q, i) => {
      const last = i === C.pts.length - 1, col = last ? 0x3dff9a : 0xff5a2a;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.6 }));
      const beam = markerBeam(beamGeo, new THREE.Color(col), 0.16, { near: 10, far: 40 });
      const o = new THREE.Group(); o.add(m, beam); o.position.set(q.x, q.y, q.z); o.visible = i < 2;
      q.obj = o; group.add(o);
    });
    g.scene.add(group);
    const par = Math.round(C.len / 10 + 5);
    this.run = { pts: C.pts, i: 0, t: 0, par, group, len: C.len };
    g.hud.message('BUOY RUN', `${C.pts.length} buoys · par ${par} s`, 2.5);
    g.audio?.playEvent?.('countdown', { final: true });
    if (!this.meter) {
      this.meter = document.createElement('div'); this.meter.className = 'story-meter job-meter';
      this.meter.innerHTML = '<span></span><div class="bar"><i></i></div>';
      (document.querySelector('.job-hud') || document.getElementById('hud') || document.body).appendChild(this.meter);
    }
    this.meter.classList.remove('hidden');
  }

  _runUpdate(dt) {
    const g = this.game, R = this.run, b = this.boat, q = R.pts[R.i];
    R.t += dt;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    q.obj.position.y = q.y + Math.sin(R.t * 2 + R.i) * 0.08;
    this.meter.firstChild.textContent = `BUOY ${R.i + 1}/${R.pts.length} · ${R.t.toFixed(1)} s · par ${R.par} · ${Math.round(d)} m`;
    const bar = this.meter.querySelector('i'); bar.style.width = `${clamp(1 - R.t / (R.par * 1.6), 0, 1) * 100}%`; bar.className = R.t > R.par ? 'danger' : '';
    if (d < 9) {
      q.obj.visible = false; R.i++;
      g.audio?.playEvent?.('checkpoint');
      if (R.i >= R.pts.length) { this._runEnd(true); return; }
      R.pts[R.i].obj.visible = true; if (R.pts[R.i + 1]) R.pts[R.i + 1].obj.visible = true;
      g.hud.message(`${R.i}/${R.pts.length}`, '', 0.8, true);
    } else if (R.t > R.par * 2.5 || d > 600) this._runEnd(false, R.t > R.par * 2.5 ? 'Too slow: the buoys were taken in' : 'You left the course');
  }

  // the minimap: the buoy to make for, and the one after
  blips() { const R = this.run; return R ? R.pts.slice(R.i, R.i + 2).map((q, k) => ({ x: q.x, z: q.z, color: k ? '#a04a2a' : '#ff5a2a', r: k ? 4 : 6 })) : []; }

  _runEnd(done, why) {
    const g = this.game, R = this.run;
    if (!R) return;
    this.run = null;
    R.group.removeFromParent();
    R.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
    this.meter?.classList.add('hidden');
    if (!done) { if (why) g.hud.message('BUOY RUN OVER', why, 2.5); return; }
    const D = (g.save.data.boat ??= { runs: 0, best: {} }), n = R.pts.length, pace = R.len / R.t;
    const under = R.t <= R.par, pay = (150 + 40 * n) * (under ? 2 : 1), bestPace = D.best.pace || 0;
    D.runs++;
    if (pace > bestPace) D.best = { pace, t: R.t, n };
    g.save.addCash(pay, 'boat');
    g.progress?.addXp?.(under ? 120 : 60, 'boat');
    g.audio?.playEvent?.('raceFinish');
    g.hud.message(under ? 'UNDER PAR!' : 'RUN COMPLETE', `${R.t.toFixed(1)} s (par ${R.par}) · ${formatMoney(pay)}${pace > bestPace && bestPace ? ' · your fastest yet' : ''}`, 4);
    g.save.save?.();
  }

  ashore(at) {
    const g = this.game, F = g.onFoot, b = this.boat, s = F.state;
    this.end();
    s.x = at.x; s.z = at.z; s.y = F._ground(at.x, at.z); s.vx = s.vz = 0; s.speed = 0;
    s.yaw = Math.atan2(at.x - b.x, at.z - b.z); F.camYaw = s.yaw;
    b.v = 0; b.steer = 0;
    this.moored = b;
    g.audio?.playEvent?.('doorOpen');
  }

  // off the boat (ashore, or back in a car / respawned): the on-foot update takes over again
  end() {
    const g = this.game, F = g.onFoot;
    if (!this.boat) return;
    this._runEnd(false);
    this.boat = null;
    this._motor(false);
    if (F.boat === this) F.boat = null;
    if (this.camDist) F.camDist = this.camDist;
    F.human?.clearAction?.(0.25);
    g.hud.setPrompt(null);
  }

  // the outboard: a two-stroke buzz (saw + square an octave up, through a lowpass), pitch by speed, louder on the throttle
  _motor(on) {
    const A = this.game.audio, ctx = A?.ctx;
    if (!ctx || !A.buses?.engine) return;
    if (on && !this.motor) {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createOscillator(), amG = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 34; o2.frequency.value = 68;
      const m2 = ctx.createGain(); m2.gain.value = 0.35;
      lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 2;
      g.gain.value = 0;
      am.frequency.value = 17; amG.gain.value = 0.03; am.connect(amG).connect(g.gain); // the putter
      o1.connect(lp); o2.connect(m2).connect(lp); lp.connect(g).connect(A.buses.engine);
      for (const o of [o1, o2, am]) o.start();
      this.motor = { o1, o2, am, lp, g };
    } else if (!on && this.motor) {
      const M = this.motor, t = ctx.currentTime; this.motor = null;
      M.g.gain.setTargetAtTime(0, t, 0.15);
      for (const o of [M.o1, M.o2, M.am]) o.stop(t + 0.8);
    }
  }
  _motorUpdate(thr, sp) {
    const M = this.motor, ctx = this.game.audio?.ctx;
    if (!M || !ctx) return;
    const t = ctx.currentTime, f = 30 + sp * 4.2 + thr * 10, paused = this.game.audio.paused;
    M.o1.frequency.setTargetAtTime(f, t, 0.12); M.o2.frequency.setTargetAtTime(f * 2, t, 0.12); M.am.frequency.setTargetAtTime(f / 2, t, 0.12);
    M.lp.frequency.setTargetAtTime(320 + thr * 1300 + sp * 40, t, 0.1);
    M.g.gain.setTargetAtTime(paused ? 0 : 0.07 + thr * 0.12, t, 0.1);
  }

  _drop(b) { b?.obj?.removeFromParent(); }
  clear() { if (this.boat) { const b = this.boat; this.end(); this._drop(b); } this._drop(this.moored); this.moored = null; this.spot = null; }
}
