// Kerala's police on the roads (not chasing anyone), all of them doing the job, not standing about:
//   - a traffic officer at a busy signalled junction near the player (some junctions, never more than one, only once
//     that part of town is there): on his podium under the white umbrella at the corner he runs the junction himself,
//     palm raised to the way he is holding, the other arm waving the other way through, and the traffic does as he
//     says (the signal heads follow his phases);
//   - now and then a checking point on a main road ahead: the Kerala Police Bolero pulled over with its lights going,
//     a barricade on the edge. One officer waves a vehicle down, it pulls in, the other walks to it and checks the
//     papers, then waves it on. The player too: stop and show your documents (a stolen car is spotted), or drive
//     through and they come after you;
//   - a jam (vehicles stuck nose to tail): an officer walks in and clears it, one way at a time.
// Built round the player and taken away again as they leave (nothing here is saved).
import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';

const KHAKI = { top: 0xa08a5a, bottom: 0x8c7a52 };
const CHECK_EVERY = 150;      // seconds between checking points (at most one at a time)
const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3();
const hash = (str) => [...str].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
const toward = (from, x, z) => { const dx = x - from[0], dz = z - from[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

export class KeralaPolice {
  constructor(game) {
    this.game = game;
    this.posts = new Map();   // signal node -> { group, cop, S, node, at }
    this.check = null;        // the checking point
    this.jam = null;          // an officer clearing a jam
    this.t = 0; this.checkT = 40; this.jamCD = 0;
    this.group = new THREE.Group(); this.group.name = 'kl_police_posts';
    game.scene.add(this.group);
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    this.mats = { podium: M(0xd8d4c8), stripe: M(0xb01818), white: M(0xf2f0ea), pole: M(0x6a6a6a), canopy: M(0xcfccc4, { side: THREE.DoubleSide, roughness: 1 }) };
  }

  _cop(n) {
    const h = this.game.humans?.ready ? this.game.humans.createMan(n, { shadow: false, outfit: KHAKI }) : null;
    if (h) this.group.add(h.group);
    return h;
  }

  // ------------------------------------------------------------------------------------------------- gestures
  // the hand straight out toward (x, z) at shoulder height, palm up: stop
  _stopArm(h, side, x, z) {
    const B = h.B, arm = B[side + 'Arm'], hand = B[side + 'Hand'];
    if (!arm || !hand) return;
    h.group.updateMatrixWorld(true);
    arm.getWorldPosition(_s);
    _u.set(x - _s.x, 0, z - _s.z).normalize();
    h._aim(arm, hand, _v.copy(_s).addScaledVector(_u, 0.62).add(_u.set(0, 0.22, 0)));
  }
  // the arm sweeping from (ax, az) round toward (bx, bz): come on through
  _waveArm(h, side, ax, az, bx, bz, t) {
    const B = h.B, arm = B[side + 'Arm'], hand = B[side + 'Hand'];
    if (!arm || !hand) return;
    h.group.updateMatrixWorld(true);
    arm.getWorldPosition(_s);
    const k = (Math.sin(t * 3.2) + 1) / 2, a = toward([_s.x, _s.z], ax, az), b = toward([_s.x, _s.z], bx, bz);
    _u.set(a[0] * (1 - k) + b[0] * k, 0, a[1] * (1 - k) + b[1] * k).normalize();
    h._aim(arm, hand, _v.copy(_s).addScaledVector(_u, 0.6).add(_u.set(0, 0.05 + 0.08 * k, 0)));
  }
  _face(h, x, z, dt, k = 6) {
    const want = Math.atan2(x - h.group.position.x, z - h.group.position.z);
    let d = want - h.group.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    h.group.rotation.y += d * Math.min(1, dt * k);
  }
  // walk toward (x, z) at a steady pace; true once there
  _walk(h, x, z, dt) {
    const W = this.game.world, p = h.group.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { h.animate(0, dt); return true; }
    const step = Math.min(d, 1.4 * dt);
    p.x += dx / d * step; p.z += dz / d * step; p.y = W.groundHeight(p.x, p.z, p.y + 0.5);
    this._face(h, x, z, dt, 10);
    h.animate(1.4, dt);
    return false;
  }

  // a podium with a white umbrella: the Kerala traffic policeman's post
  _podium() {
    const g = new THREE.Group(), m = this.mats;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.45, 16), m.podium); base.position.y = 0.22; g.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.81, 0.81, 0.12, 16, 1, true), m.stripe); band.position.y = 0.3; g.add(band);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), m.pole); pole.position.set(0.55, 1.5, 0); g.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.45, 12, 1, true), m.canopy); top.position.set(0.55, 2.8, 0); g.add(top);
    return g;
  }

  // a red-and-white barricade (a 'POLICE' board on two legs)
  _barricade() {
    const g = new THREE.Group(), m = this.mats;
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), i % 2 ? m.white : m.stripe); b.position.set(-1.05 + i * 0.42, 0.9, 0); g.add(b); }
    for (const x of [-1.1, 1.1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.5), m.pole); l.position.set(x, 0.45, 0); g.add(l); }
    return g;
  }

  update(dt, focus) {
    const g = this.game, W = g.world;
    if (!W.kerala || !g.humans?.ready) return;
    this.T = (this.T || 0) + dt;
    for (const p of this.posts.values()) this._runPost(p, dt);
    if (this.check) this._runCheck(dt);
    if (this.jam) this._runJam(dt, focus);
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1.5;
    this._app?.clear();   // (the lanes round a junction, looked up again as tiles come and go)
    this._placePosts(focus);
    // --- a checking point: one at a time, on a main road 150-250 m from the player, gone when they're 400 m off
    if (this.check && Math.hypot(this.check.x - focus.x, this.check.z - focus.z) > 400) this._clearCheck();
    this.checkT -= 1.5;
    if (!this.check && this.checkT <= 0 && !g.police?.inPursuit) {
      this.checkT = CHECK_EVERY;
      const lanes = g.traffic?.graph?.lanesNear?.(focus.x, focus.z, 150, 250)?.filter((l) => l.kind === 'lane' && l.laneIndex === 0 && (l.edge?.cls ?? 9) <= 3 && l.length > 90 && W.tileAt(l.pts[0][0], l.pts[0][1])?.ready) || [];
      if (lanes.length) this._makeCheck(lanes[Math.floor(Math.random() * lanes.length)]);
    }
    // --- a jam near the player: an officer comes to clear it
    this.jamCD -= 1.5;
    if (!this.jam && this.jamCD <= 0) this._findJam(focus);
  }

  // ------------------------------------------------------------------------------------- junction officers
  // at the nearest busy signalled junction within 200 m that has one (about a third of them do), once that part of
  // town is built: one officer at most
  _placePosts(focus) {
    const W = this.game.world;
    const sig = [...(W.lanes?.signals || [])].map(([k, S]) => [k, S, Math.hypot(S.x - focus.x, S.z - focus.z)])
      .filter((q) => q[2] < 200 && hash(q[0]) % 3 === 0 && W.tileAt(q[1].x, q[1].z)?.ready).sort((a, b) => a[2] - b[2]).slice(0, 1);
    const want = new Set(sig.map((q) => q[0]));
    for (const [k, p] of this.posts) if (!want.has(k)) { p.group.removeFromParent(); p.cop?.group.removeFromParent(); delete p.S.cop; this.posts.delete(k); }
    for (const [k, S] of sig) {
      if (this.posts.has(k)) continue;
      // the corner: the nearest point round the junction off every carriageway
      let spot = null;
      for (let r = 7; r <= 16 && !spot; r += 1.5) for (let a = 0; a < 16 && !spot; a++) {
        const x = S.x + Math.cos(a / 16 * Math.PI * 2 + 0.4) * r, z = S.z + Math.sin(a / 16 * Math.PI * 2 + 0.4) * r;
        if (!W.onCarriageway(x, z, 1.2)) spot = [x, z];
      }
      if (!spot) continue;
      const grp = this._podium(), y = W.groundHeight(spot[0], spot[1]);
      grp.position.set(spot[0], y, spot[1]); grp.rotation.y = Math.atan2(S.x - spot[0], S.z - spot[1]);
      this.group.add(grp);
      const cop = this._cop(k.length * 7 + 3);
      if (cop) { cop.group.position.set(spot[0], y + 0.45, spot[1]); cop.group.rotation.y = grp.rotation.y; }
      // he takes the junction over: the way with the longer queue goes first
      S.cop = { go: this._waiting(k, 'x') >= this._waiting(k, 'z') ? 'x' : 'z', t: 0, amber: 0 };
      this.posts.set(k, { group: grp, cop, S, node: k, at: spot });
    }
  }

  // the lanes coming into a junction on one phase, and how many vehicles wait (or come) on them
  _approach(node, axis) {
    const k = node + '|' + axis, C = (this._app ||= new Map());
    if (!C.has(k)) C.set(k, (this.game.world.lanes?.lanes || []).filter((l) => l.signal && l.to === node && l.axis === axis));
    return C.get(k);
  }
  _waiting(node, axis, moving = false) {
    let n = 0;
    for (const l of this._approach(node, axis)) for (const c of l.cars || []) {
      const d = l.length - c.s;
      if (d < 45 && (moving ? c.v > 2 && d < 30 : c.v < 1.5)) n++;
    }
    return n;
  }

  _runPost(p, dt) {
    // (the junction's signal record is made again as tiles come and go: the officer stays in charge of the new one)
    const live = this.game.world.lanes?.signals?.get(p.node);
    if (live && live !== p.S) { live.cop = p.S.cop; delete p.S.cop; p.S = live; }
    const C = p.S.cop, h = p.cop;
    if (!C) return;
    // his phases: a way goes until its queue has gone through (8 s at least) or 24 s if the other way is waiting;
    // then that way gets an amber wave (2.5 s) and the other goes
    C.t += dt;
    if (C.amber > 0) { C.amber -= dt; if (C.amber <= 0) { C.go = C.go === 'x' ? 'z' : 'x'; C.t = 0; } }
    else {
      const other = C.go === 'x' ? 'z' : 'x', wOther = this._waiting(p.node, other);
      if (wOther > 0 && ((C.t > 8 && this._waiting(p.node, C.go, true) === 0) || C.t > 24)) C.amber = 2.5;
    }
    if (!h) return;
    h.animate(0, dt);
    // facing the junction; the palm to the way held, the other arm waving the way going (from where it comes, on
    // across the junction)
    this._face(h, p.S.x, p.S.z, dt, 3);
    const stopAxis = C.amber > 0 ? null : C.go === 'x' ? 'z' : 'x', goLanes = this._approach(p.node, C.go);
    const back = (l) => { const P = l.pts, e = P[P.length - 1], a = P[Math.max(0, P.length - 2)], L = Math.hypot(e[0] - a[0], e[1] - a[1]) || 1; return [e[0] - (e[0] - a[0]) / L * 20, e[1] - (e[1] - a[1]) / L * 20]; };
    const nearest = (L) => L.sort((a, b) => Math.hypot(back(a)[0] - p.at[0], back(a)[1] - p.at[1]) - Math.hypot(back(b)[0] - p.at[0], back(b)[1] - p.at[1]))[0];
    const hold = stopAxis ? nearest(this._approach(p.node, stopAxis)) : nearest(goLanes);
    if (hold) { const q = back(hold); this._stopArm(h, 'Right', q[0], q[1]); }
    const go = C.amber > 0 ? null : nearest(goLanes);
    if (go) { const q = back(go); this._waveArm(h, 'Left', q[0], q[1], 2 * p.S.x - q[0], 2 * p.S.z - q[1], this.T); }
  }

  // ------------------------------------------------------------------------------------------ checking point
  _makeCheck(lane) {
    const g = this.game, W = g.world, tmp = { x: 0, z: 0, dx: 0, dz: 1 };
    // a place along the road where the verge is clear for the jeep (no house, wall or stall there)
    let s = -1, edge = 0, rx = 0, rz = 0, yaw = 0, ex = 0, ez = 0;
    for (const f of [0.6, 0.45, 0.75, 0.35, 0.85]) {
      lane.sample(lane.length * f, tmp);
      rx = -tmp.dz; rz = tmp.dx; yaw = Math.atan2(tmp.dx, tmp.dz);   // (right of travel: the kerb is to the left)
      // the carriageway's edge on the kerb side (left of travel), found by stepping out from the lane
      edge = 1.75; while (edge < 14 && W.onCarriageway(tmp.x + rx * -edge, tmp.z + rz * -edge, 0)) edge += 0.25;
      ex = tmp.x + rx * -(edge + 1.6); ez = tmp.z + rz * -(edge + 1.6);   // the jeep on the verge
      const jx = ex - tmp.dx * 6, jz = ez - tmp.dz * 6;
      const blocked = W.collision.query(jx - 4, jz - 4, jx + 4, jz + 4, []).some((c) => c.kind !== 'lane' && c.kind !== 'connector' && Math.hypot(c.cx - jx, c.cz - jz) < 3.2 + Math.max(c.hx, c.hz))
        || W.inWater?.(jx, jz) || W.onCarriageway(jx, jz, 0.3);
      if (!blocked) { s = lane.length * f; break; }
    }
    if (s < 0) return;
    lane.sample(s, tmp);
    const grp = new THREE.Group(); this.group.add(grp);
    const cols = [];
    let jeep = null;
    if (g.lib.has('bolero')) {
      jeep = new Vehicle({ carId: 'bolero', params: { ...TRAFFIC_VEHICLES.bolero.params }, world: W, lib: g.lib, role: 'parked', carType: 'muscle', renderOpts: { police: true, headlights: 0, shadow: false, lodDistance: g.preset.carLod1Distance, detailWheels: false, sharedPaint: true } });
      jeep.renderer.applyCustom({ paint: 'factory', finish: 'gloss', tint: 0.5 });
      const jx = ex - tmp.dx * 6, jz = ez - tmp.dz * 6;
      jeep.place(jx, jz, yaw);
      jeep.renderer.sirenOn = true;
      g.scene.add(jeep.renderer.group);
      // (solid: it's a jeep, not a picture of one)
      cols.push({ cx: jx, cz: jz, hx: 0.95, hz: 2.2, cos: Math.cos(yaw), sin: Math.sin(yaw), angle: yaw, h: W.groundHeight(jx, jz) + 2, kind: 'building' });
    }
    const bar = this._barricade(), bx = tmp.x + rx * -(edge - 0.4), bz = tmp.z + rz * -(edge - 0.4);
    bar.position.set(bx, W.groundHeight(bx, bz), bz); bar.rotation.y = yaw; grp.add(bar);   // (along the edge, facing the traffic)
    cols.push({ cx: bx, cz: bz, hx: 1.15, hz: 0.25, cos: Math.cos(yaw), sin: Math.sin(yaw), angle: yaw, h: W.groundHeight(bx, bz) + 1.1, kind: 'barrier' });
    for (const c of cols) W.collision.add(c);
    // the waver at the edge a little before the barricade; the checker by the jeep
    const at = (back, side) => [tmp.x - tmp.dx * back + rx * -side, tmp.z - tmp.dz * back + rz * -side];
    const wave = at(6, edge + 0.4), home = at(2, edge + 1.1);
    const waver = this._cop(5), checker = this._cop(16);
    for (const [h, q] of [[waver, wave], [checker, home]]) if (h) { h.group.position.set(q[0], W.groundHeight(q[0], q[1]), q[1]); h.group.rotation.y = yaw + Math.PI; }
    this.check = { x: tmp.x, z: tmp.z, dx: tmp.dx, dz: tmp.dz, yaw, lane, s, group: grp, jeep, cols, waver, checker, wave, home, phase: 'idle', next: 4, car: null, t: 0, player: null };
  }

  _clearCheck() {
    const c = this.check; this.check = null;
    if (!c) return;
    c.group.removeFromParent();
    for (const h of [c.waver, c.checker]) h?.group.removeFromParent();
    for (const q of c.cols) this.game.world.collision.remove(q);
    if (c.car && c.car !== 'player') { c.car.ckWait = false; c.car.ckHold = false; c.car.pullAt = 0; }
    if (c.jeep) { c.jeep.renderer.group.removeFromParent(); c.jeep.dispose?.(); }
  }

  _runCheck(dt) {
    const K = this.check, g = this.game, W = g.world, T = this.T;
    const along = (x, z) => (x - K.x) * K.dx + (z - K.z) * K.dz, across = (x, z) => Math.abs(-(x - K.x) * K.dz + (z - K.z) * K.dx);
    // --- the player: waved down as they come up the road
    const driving = g.state.mode === 'drive' && !g.onFoot?.active, ps = g.player?.state;
    if (driving && ps) {
      const a = along(ps.x, ps.z), sp = Math.hypot(ps.vx, ps.vz);
      if (!K.player && a > -70 && a < -12 && across(ps.x, ps.z) < 8 && sp > 1 && K.phase === 'idle') {
        K.player = 'waved'; K.phase = 'wave'; K.car = 'player';
        g.hud.message('POLICE CHECK', 'pull over by the barricade and stop', 3);
      }
      if (K.player === 'waved' && sp < 0.8 && Math.hypot(ps.x - K.x, ps.z - K.z) < 30) { K.player = 'stopped'; K.phase = 'walkTo'; g.hud.message('POLICE CHECK', 'documents, please', 2.5); }
      if (K.player === 'waved' && a > 4) {
        K.player = 'ran'; K.phase = 'idle'; K.car = null; K.next = 10;
        g.hud.message('POLICE CHECK', 'you drove through a police check', 3);
        g.police?.startPursuit?.(1, 'ignored a police check');
      }
    }
    if (K.player === 'ran' || K.player === 'done') { if (!ps || Math.hypot(ps.x - K.x, ps.z - K.z) > 150) K.player = null; }
    if (K.player === 'waved' && (!driving || !ps || Math.hypot(ps.x - K.x, ps.z - K.z) > 120)) { K.player = null; K.car = null; K.phase = 'idle'; K.next = 6; }   // (turned off another way)
    // --- a vehicle on the road: one waved down every so often
    if (K.phase === 'idle') {
      K.next -= dt;
      if (K.next <= 0) {
        K.next = 3;
        const c = K.lane.cars.find((o) => o.state === 'drive' && !o.pulled && !o.pullAt && !o.spec.bus && o.s > K.s - 70 && o.s < K.s - 25);
        if (c) { c.pullAt = K.s - 4; c.ckWait = true; c.arriving = false; K.car = c; K.phase = 'wave'; K.t = 0; }
      }
    }
    const tc = K.car && K.car !== 'player' ? K.car : null;
    if (tc && (!g.traffic.cars.includes(tc) || (tc.path !== K.lane && !tc.ckHold))) { tc.ckWait = false; tc.ckHold = false; K.car = null; K.phase = 'walkBack'; }
    if (K.phase === 'wave' && tc) { K.t += dt; if (tc.ckHold) K.phase = 'walkTo'; else if (K.t > 25) { tc.ckWait = false; tc.pullAt = 0; K.car = null; K.phase = 'idle'; K.next = 8; } }
    // the vehicle being checked: where its kerb-side window is
    let win = null;
    if (K.car === 'player' && ps) { const fx = Math.sin(ps.yaw), fz = Math.cos(ps.yaw); win = [ps.x + fx * 0.6 + fz * 1.6, ps.z + fz * 0.6 - fx * 1.6, ps.x, ps.z]; }
    else if (tc) { const fx = Math.sin(tc.yaw), fz = Math.cos(tc.yaw), w = (tc.spec.w || 1.7) / 2 + 0.7; win = [tc.x + fx * 0.6 + fz * w, tc.z + fz * 0.6 - fx * w, tc.x, tc.z]; }
    const ch = K.checker, wv = K.waver;
    // the waver: palm out to the vehicle he is stopping, else watching the traffic come
    if (wv) {
      wv.animate(0, dt);
      const tx = K.car === 'player' && ps ? ps.x : tc ? tc.x : K.x - K.dx * 40, tz = K.car === 'player' && ps ? ps.z : tc ? tc.z : K.z - K.dz * 40;
      this._face(wv, tx, tz, dt, 4);
      if (K.phase === 'wave') this._stopArm(wv, 'Right', tx, tz);
      else if (K.phase === 'release') this._waveArm(wv, 'Left', K.x - K.dx * 10, K.z - K.dz * 10, K.x + K.dx * 20, K.z + K.dz * 20, T);
    }
    if (!ch) { if (K.phase === 'walkTo') K.phase = 'check'; }
    else if (K.phase === 'walkTo') {
      if (K.car === 'player' && (!driving || Math.hypot(ps.vx, ps.vz) > 3 || Math.hypot(ps.x - K.x, ps.z - K.z) > 45)) {   // (drove off before he got there)
        K.player = 'ran'; K.car = null; K.phase = 'walkBack';
        g.hud.message('POLICE CHECK', 'you drove off from a police check', 3); g.police?.startPursuit?.(1, 'drove off from a police check');
      } else if (!win) K.phase = 'walkBack';
      else if (this._walk(ch, win[0], win[1], dt)) { K.phase = 'check'; K.t = 0; ch.play('talk', { hold: true }); }
    }
    else if (K.phase === 'check') {
      ch.animate(0, dt); if (win) this._face(ch, win[2], win[3], dt, 4);
      K.t += dt;
      if (K.car === 'player' && (!driving || Math.hypot(ps.vx, ps.vz) > 3)) {   // (drove off mid-check)
        K.player = 'ran'; K.car = null; K.phase = 'walkBack'; ch.clearAction();
        g.hud.message('POLICE CHECK', 'you drove off from a police check', 3); g.police?.startPursuit?.(1, 'drove off from a police check');
      } else if (K.t > (K.car === 'player' ? 5 : 7)) {
        ch.clearAction();
        if (K.car === 'player') {
          if (g.player?.stolen) { g.hud.message('STOLEN VEHICLE', 'the officer knows this car: it was reported stolen', 3.5); g.police?.startPursuit?.(2, 'stolen car'); }
          else g.hud.message('DOCUMENTS OK', 'licence, RC and insurance in order: drive safe', 3);
          K.player = 'done';
        } else if (tc) { tc.ckHold = false; tc.dwell = 1.2; }
        K.phase = 'release'; K.t = 0;
      }
    } else if (K.phase === 'release') { ch.animate(0, dt); K.t += dt; if (K.t > 2) { K.car = null; K.phase = 'walkBack'; } }
    else if (K.phase === 'walkBack') { if (this._walk(ch, K.home[0], K.home[1], dt)) { K.phase = 'idle'; K.next = 12 + Math.random() * 14; } }
    else ch.animate(0, dt);
  }

  // ------------------------------------------------------------------------------------------------- jams
  // three or more vehicles stuck (nose to tail, nose to nose) for 20 s within 35 m of each other, near the player
  _findJam(focus) {
    const g = this.game, W = g.world;
    // (not a queue at a red light: that moves on its own)
    const atRed = (c) => c.path?.signal && W.signalState(c.path.to, c.path.axis) !== 'green';
    const stuck = (g.traffic?.cars || []).filter((c) => c.state === 'drive' && c.v < 0.3 && (c.stuckT || 0) > 20 && !c.ckHold && !c.pulled && !atRed(c) && Math.hypot(c.x - focus.x, c.z - focus.z) < 200);
    let best = null, bn = 0;
    for (const c of stuck) { const n = stuck.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 35).length; if (n > bn) { bn = n; best = c; } }
    if (!best || bn < 3) return;
    const near = stuck.filter((o) => Math.hypot(o.x - best.x, o.z - best.z) < 35), cx = near.reduce((s, c) => s + c.x, 0) / near.length, cz = near.reduce((s, c) => s + c.z, 0) / near.length;
    // he comes on foot from the roadside 25 m off, to a spot off the carriageway by the jam
    const off = (r0, r1) => { for (let r = r0; r <= r1; r += 2) for (let a = 0; a < 12; a++) { const x = cx + Math.cos(a / 12 * Math.PI * 2) * r, z = cz + Math.sin(a / 12 * Math.PI * 2) * r; if (!W.onCarriageway(x, z, 0.8)) return [x, z]; } return null; };
    const spot = off(4, 14), from = off(22, 34);
    if (!spot || !from) return;
    const cop = this._cop(27);
    if (!cop) return;
    cop.group.position.set(from[0], W.groundHeight(from[0], from[1]), from[1]);
    this.jam = { x: cx, z: cz, spot, from, cop, phase: 'walkIn', t: 0, turn: 0, clear: 0, ref: best.yaw, cars: new Set() };
    if (Math.hypot(cx - focus.x, cz - focus.z) < 150) g.hud.message('TRAFFIC POLICE', 'an officer is coming to clear the jam', 2.5);
  }

  _runJam(dt, focus) {
    const J = this.jam, g = this.game, h = J.cop;
    J.t += dt;
    const release = () => { for (const c of J.cars) { c.jamGo = false; c.jamHold = false; } J.cars.clear(); };
    if (J.phase === 'walkIn') { if (this._walk(h, J.spot[0], J.spot[1], dt)) { J.phase = 'direct'; J.t = 0; } return; }
    if (J.phase === 'walkOut') { if (this._walk(h, J.from[0], J.from[1], dt)) { h.group.removeFromParent(); this.jam = null; this.jamCD = 30; } return; }
    // directing: the vehicles round the jam in two lots by the way they face; one lot goes (they may squeeze past
    // the others), the other waits, 10 s each, until nothing is stuck there
    h.animate(0, dt);
    const near = g.traffic.cars.filter((c) => c.state === 'drive' && Math.hypot(c.x - J.x, c.z - J.z) < 45);
    for (const c of J.cars) if (!near.includes(c)) { c.jamGo = false; c.jamHold = false; J.cars.delete(c); }
    if (J.t > 10) { J.t = 0; J.turn ^= 1; }
    let gx = 0, gz = 0, hx = 0, hz = 0, ng = 0, nh = 0;
    for (const c of near) {
      const same = Math.cos(c.yaw - J.ref) >= 0, go = same === (J.turn === 0);
      c.jamGo = go; c.jamHold = !go; J.cars.add(c);
      if (go) { gx += c.x; gz += c.z; ng++; } else { hx += c.x; hz += c.z; nh++; }
    }
    this._face(h, J.x, J.z, dt, 3);
    if (nh) this._stopArm(h, 'Right', hx / nh, hz / nh);
    if (ng) { const fx = Math.sin(J.turn ? J.ref + Math.PI : J.ref), fz = Math.cos(J.turn ? J.ref + Math.PI : J.ref); this._waveArm(h, 'Left', gx / ng - fx * 10, gz / ng - fz * 10, gx / ng + fx * 15, gz / ng + fz * 15, this.T); }
    const stuck = near.some((c) => !c.jamHold && c.v < 0.3 && (c.stuckT || 0) > 4);   // (not the ones he is holding)
    J.clear = stuck ? 0 : J.clear + dt;
    if (J.clear > 8 || J.total > 120 || Math.hypot(J.x - focus.x, J.z - focus.z) > 400) { release(); J.phase = 'walkOut'; }
    J.total = (J.total || 0) + dt;
  }

  // the jeep's lights flash with the renderer's own update (it isn't driven)
  sync(dt, cam) { if (this.check?.jeep) { const v = this.check.jeep; v.sync?.(dt, cam, this.game.env); } }
}
