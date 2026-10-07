// Vehicle interaction: getting into and out of vehicles the way a person does, and sitting in them.
//
// Every vehicle gets an interaction PROFILE: sockets in its own body space (+Z forward, +X left, y up), measured
// from the model (cabin bounds, the steering wheel found by rays from the driver's eye, the real door hinges)
// and tuned by vehicle class (car, SUV, truck, bus, autorickshaw): driver seat (hips), cabin floor, pedals,
// steering wheel rim (grips) or handlebar, driver door hinge / length / handle, entry point (where you stand
// to get in), the sill the hips pass over, a step for tall cabs, and the exit point. Kerala drives on the
// left, so cars are right-hand drive: the driver's door is on the right.
//
// The player's own rigged character is posed by a small body-IK layer on top of the motion-captured clips:
// pelvis onto a target, two-bone IK for each arm and leg (hands to the door handle / the wheel rim / the
// bars, feet to the ground, the step, the floor and the pedals), the spine ducking under the roof line and
// the head looking where it should. The sequence is an explicit state machine:
//
//   enter:  approach (walks there, round the vehicle if needed) -> align -> reach handle -> open door ->
//           step in (inner foot first, ducking) -> lower body -> sit -> legs in -> hands to wheel -> close door
//           -> drive (camera blends from the walking camera to the driving camera)
//   seated: hands follow the wheel as it turns, feet on the pedals, body sways with braking / acceleration /
//           cornering and jolts in collisions, head looks into the turn
//   exit:   stop -> hands off -> door opens -> legs out -> rise and duck out -> stand -> step clear -> close door
//
// The character is parented to the vehicle while it is in or at it, so nothing slides when the car rolls;
// the walking parts use the normal locomotion clips. Character, vehicle, seat and door state are separate
// (seat occupancy lives on the vehicle), ready for other players. Full IK runs only for the player.
import * as THREE from 'three';
import { CARS, TRAFFIC_MODELS } from './VehicleCatalog.js';
import { STYLE, poseTargets } from './Rider.js';
import { clamp, lerp } from '../core/util.js';

const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const BUSES = new Set(['ksrtc', 'pvtbus', 'pvtbus2', 'bus']);
const TRUCKS = new Set(['lorry', 'truck', 'minitruck', 'van']);
const SUVS = new Set(['scorpio', 'thar', 'brezza', 'ertiga', 'suv']);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);

// ------------------------------------------------------------------------------------------- profile
export function interactionProfile(v) {
  const r = v.renderer;
  if (!r) return null;
  if (r._iprof) return r._iprof;
  const car = CARS[v.carId], P = v.p;
  const kind = car?.bike || P.bike ? 'bike' : v.carId === 'auto' ? 'auto' : BUSES.has(v.carId) ? 'bus' : TRUCKS.has(v.carId) ? 'truck'
    : SUVS.has(v.carId) || (P.cgHeight ?? 0.5) > 0.66 ? 'suv' : 'car';
  // cabin bounds in body space
  r.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(r.body.matrixWorld).invert(), box = new THREE.Box3(), tb = new THREE.Box3();
  (r._lod0 || r.body).traverse((o) => {
    if (!o.isMesh || o.visible === false || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(inv); box.union(tb);
  });
  const W = P.width || 1.8, L = P.length || 4.4;
  if (box.isEmpty() || box.max.x - box.min.x > W * 1.6) box.set(new THREE.Vector3(-W / 2, -0.35, -L / 2), new THREE.Vector3(W / 2, 1.1, L / 2));
  // (mirrors and roof racks stick out: the cabin is about the vehicle's own width)
  const halfW = Math.min((box.max.x - box.min.x) / 2, W / 2 + 0.08), groundY = box.min.y, roofY = box.max.y;
  const pr = { kind, box, halfW, groundY, roofY };
  if (kind === 'bike') {
    // motorcycles: mount from the left (the side stand side): stand by the seat, hands to the bars, swing the
    // right leg over, sit, feet down
    const bk = r.bikeGeom?.() || { zF: L * 0.36, zR: -L * 0.36, seat: 0.8, style: 'sport' };
    const cfg = { ...STYLE[bk.style] || STYLE.sport, ...(bk.rider || {}) };
    const T = poseTargets(cfg, bk, 0, { down: 1, paddle: null });
    pr.bk = bk; pr.ds = 1;
    pr.seat = T.hip.clone();
    pr.bars = { L: T.side[1].grip.clone(), R: T.side[-1].grip.clone() };
    pr.pegs = { L: T.side[1].peg.clone(), R: T.side[-1].peg.clone() };
    pr.entry = new THREE.Vector3(0.62, groundY, pr.seat.z + 0.1);
    pr.exit = new THREE.Vector3(1.0, groundY, pr.seat.z + 0.1);
    pr.handle = pr.bars.L.clone();
    return (r._iprof = pr);
  }
  // seat, wheel and pedals
  const G = kind === 'auto' ? null : r.steeringGeom?.();
  // +1 = left. Indian (Kerala) vehicles are right-hand drive; others follow the model's own driver's eye
  const indian = !!TRAFFIC_MODELS[v.carId] && /^kl_/.test(TRAFFIC_MODELS[v.carId].id);
  let ds = indian ? -1 : G ? (G.eye.x < -0.05 ? -1 : G.eye.x > 0.05 ? 1 : -1) : -1;
  if (kind === 'auto') {
    // the auto driver sits in the middle at the front on a bench, on handlebars
    pr.seat = new THREE.Vector3(0, groundY + 0.78, box.max.z - 1.05);
    pr.bars = { L: new THREE.Vector3(0.3, pr.seat.y + 0.36, pr.seat.z + 0.48), R: new THREE.Vector3(-0.3, pr.seat.y + 0.36, pr.seat.z + 0.48) };
    ds = -1;
  } else if (G) {
    pr.seat = new THREE.Vector3(ds * Math.abs(G.eye.x || 0.36), G.eye.y - (kind === 'bus' ? 0.7 : 0.66), G.eye.z - 0.13);
    pr.wheel = { hub: G.hub.clone(), axis: G.axis.clone(), up0: G.up0.clone(), right0: G.right0.clone(), R: G.R };
    pr.wheel.hub.x = pr.seat.x;
  } else {
    pr.seat = new THREE.Vector3(ds * halfW * 0.42, groundY + (kind === 'bus' ? 1.55 : kind === 'truck' ? 1.45 : kind === 'suv' ? 0.92 : 0.72), L * 0.05);
  }
  pr.ds = ds;
  const S = pr.seat;
  // sanity: seat height by class, and the seat inside the front door's opening (eye probes on tall cabins
  // can land on the rear seats)
  const H = { car: [0.42, 0.72], suv: [0.66, 1.0], truck: [1.3, 1.75], bus: [1.3, 1.6], auto: [0.7, 0.85] }[kind];
  S.y = clamp(S.y, groundY + H[0], groundY + H[1]);
  const d0 = r.doors?.[ds];
  if (d0 && kind !== 'auto') {
    const lo = d0.hinge.z - d0.len * 0.85, hi = d0.hinge.z - d0.len * 0.38;
    if (S.z < lo || S.z > hi) S.z = d0.hinge.z - d0.len * 0.62;
  }
  if (kind !== 'auto' && (!pr.wheel || Math.abs(pr.wheel.hub.z - S.z - 0.58) > 0.3 || pr.wheel.hub.y < S.y + 0.2)) {
    // a wheel where a driver's hands would find it (and draw one if the model has none there)
    const axis = new THREE.Vector3(0, 0.42, -1).normalize(), up0 = new THREE.Vector3(0, 1, 0).projectOnPlane(axis).normalize();
    pr.wheel = { hub: new THREE.Vector3(S.x, S.y + (kind === 'bus' || kind === 'truck' ? 0.5 : 0.42), S.z + 0.58), axis, up0, right0: new THREE.Vector3().crossVectors(up0, axis).normalize(), R: kind === 'bus' ? 0.24 : 0.18 };
    pr.ownWheel = true;
  }
  pr.floorY = S.y - (kind === 'bus' || kind === 'truck' ? 0.44 : kind === 'auto' ? 0.4 : 0.3);
  const ahead = pr.wheel ? pr.wheel.hub.z + 0.42 : S.z + 0.62;
  pr.pedals = { L: new THREE.Vector3(S.x + 0.13, pr.floorY + 0.06, ahead), R: new THREE.Vector3(S.x - 0.11, pr.floorY + 0.1, ahead + 0.04) };
  // the driver's door: the model's own hinge, or a typical one
  const d = r.doors?.[ds];
  pr.door = d ? { side: ds, hinge: d.hinge.clone(), len: d.len, real: true } : { side: ds, hinge: new THREE.Vector3(ds * halfW, groundY + 0.6, S.z + 0.72), len: kind === 'auto' ? 0 : 1.0, real: false };
  const hz = pr.door.hinge.z, len = pr.door.len;
  const handleH = { car: 0.98, suv: 1.12, truck: 1.4, bus: 1.32, auto: 1.25 }[kind];
  pr.handle = new THREE.Vector3(ds * (halfW + 0.03), groundY + handleH, len ? hz - len + 0.12 : S.z + 0.35);
  pr.entry = new THREE.Vector3(ds * (halfW + (kind === 'auto' ? 0.3 : 0.4)), groundY, S.z + (kind === 'bus' ? 0.25 : 0.08));
  pr.sill = new THREE.Vector3(ds * (halfW - 0.12), S.y + (kind === 'car' ? 0.12 : 0.06), S.z + 0.04);
  pr.exit = new THREE.Vector3(ds * (halfW + 0.9), groundY, S.z + 0.25);
  // tall cabs: a step to climb on
  if (S.y - groundY > 1.15) pr.step = new THREE.Vector3(ds * (halfW - 0.08), groundY + (S.y - groundY) * 0.36, S.z + 0.12);
  pr.duck = clamp(1.12 - (roofY - S.y), 0, 0.5) * 2;   // how far the head has to come down under the roof line
  return (r._iprof = pr);
}

// sockets drawn as small markers on the vehicle (debug: "show vehicle interaction sockets")
export function showSockets(v, on) {
  const r = v?.renderer;
  if (!r) return;
  if (r._sockets) { r._sockets.removeFromParent(); r._sockets = null; }
  if (!on) return;
  const P = interactionProfile(v);
  if (!P || P.kind === 'bike') return;
  const g = new THREE.Group(); g.name = 'interaction_sockets';
  const dot = (p, col, size = 0.05) => { if (!p) return; const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false })); m.position.copy(p); m.renderOrder = 99; g.add(m); };
  dot(P.seat, 0x00ff66, 0.08); dot(P.entry, 0xffff00, 0.09); dot(P.exit, 0xff8800, 0.09); dot(P.handle, 0x00ffff); dot(P.sill, 0xffffff);
  dot(P.pedals.L, 0xff00ff); dot(P.pedals.R, 0xff00ff); dot(P.step, 0x8888ff); dot(P.door.hinge, 0xff0000, 0.06);
  if (P.wheel) for (const a of [1.05, -1.05]) dot(gripPoint(P.wheel, a, 0, _a).clone(), 0x3399ff);
  if (P.bars) { dot(P.bars.L, 0x3399ff); dot(P.bars.R, 0x3399ff); }
  r.body.add(g); r._sockets = g;
}

// a point on the steering-wheel rim at clock angle ang (rad, 0 = top, + = towards the driver's left), turned by steer
function gripPoint(W, ang, steer, out) {
  const a = ang - steer * 2.6;
  return out.copy(W.hub).addScaledVector(W.up0, Math.cos(a) * W.R).addScaledVector(W.right0, -Math.sin(a) * W.R);
}

// ------------------------------------------------------------------------------------------- body IK
class BodyIK {
  constructor(human) {
    this.h = human; const B = human.B;
    const L = (a, b) => wpos(B[a], _a).distanceTo(wpos(B[b], _b));
    human.group.updateMatrixWorld(true);
    this.len = { thigh: L('LeftUpLeg', 'LeftLeg'), shin: L('LeftLeg', 'LeftFoot'), upper: L('LeftArm', 'LeftForeArm'), fore: L('LeftForeArm', 'LeftHand') };
  }
  // turn `bone` so `tip` points at world `target`, blended by w
  aim(bone, tip, target, w = 1) {
    if (!bone || !tip || w <= 0.001) return;
    _q0.copy(bone.quaternion);
    this.h._aim(bone, tip, target);
    if (w < 0.999) { _q1.copy(bone.quaternion); bone.quaternion.slerpQuaternions(_q0, _q1, w); bone.updateWorldMatrix(false, true); }
  }
  // two-bone chain root -> mid -> end onto world `target`, bending towards world direction `hint`
  limb(root, mid, end, target, hint, w, l1, l2) {
    if (w <= 0.001) return;
    const B = this.h.B, a = wpos(B[root], _c);
    _d.subVectors(target, a);
    const dist = clamp(_d.length(), 0.05, l1 + l2 - 1e-3);
    _d.normalize();
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    _k.copy(hint).addScaledVector(_d, -hint.dot(_d)).normalize();
    const joint = _a.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_k, l1 * Math.sqrt(1 - cosA * cosA));
    this.aim(B[root], B[mid], joint.clone(), w);
    this.aim(B[mid], B[end], target, w);
  }
  arm(side, target, hint, w) { const S = side > 0 ? 'Left' : 'Right'; this.limb(S + 'Arm', S + 'ForeArm', S + 'Hand', target, hint, w, this.len.upper, this.len.fore); }
  leg(side, target, hint, w) { const S = side > 0 ? 'Left' : 'Right'; this.limb(S + 'UpLeg', S + 'Leg', S + 'Foot', target, hint, w, this.len.thigh, this.len.shin); }
}

// ------------------------------------------------------------------------------------------- the controller
export class VehicleInteraction {
  constructor(game, onFoot) {
    this.game = game; this.of = onFoot;
    this.st = null;                  // { mode: 'enter' | 'exit' | 'seated', v, P, phase, t, ... }
    this.sway = { x: 0, z: 0, vx: 0, vz: 0 };
    this.debug = false;
  }
  get human() { return this.of.human; }
  get busy() { return !!this.st && this.st.mode !== 'seated'; }
  get seated() { return this.st?.mode === 'seated' ? this.st.v : null; }

  // -------------------------------------------------------------- frames
  _body(v) { return v.renderer.body; }
  _toWorld(v, p, out = new THREE.Vector3()) { return this._body(v).localToWorld(out.copy(p)); }
  _toLocal(v, p, out = new THREE.Vector3()) { return this._body(v).worldToLocal(out.copy(p)); }
  // the character container goes with the vehicle (posed in its body space) or back to the world
  _attach(v) { const c = this.of.body.group; if (c.parent !== this._body(v)) this._body(v).attach(c); }
  _detach() { const c = this.of.body.group; if (c.parent !== this.game.scene) this.game.scene.attach(c); }

  // -------------------------------------------------------------- enter
  canUse(v) { const P = interactionProfile(v); return !!(P && this.human); }

  startEnter(v) {
    const P = interactionProfile(v), s = this.of.state;
    // which side are we on? Walk round the front or back to the driver's door if needed
    const me = this._toLocal(v, _a.set(s.x, s.y, s.z));
    const route = [];
    if (Math.sign(me.x || P.ds) !== P.ds && P.kind !== 'auto' && P.kind !== 'bike') {
      const zEnd = Math.abs(me.z - P.box.max.z) < Math.abs(me.z - P.box.min.z) ? P.box.max.z + 0.9 : P.box.min.z - 0.9;
      const x0 = -P.ds * (P.halfW + 0.8), x1 = P.ds * (P.halfW + 0.8);
      route.push(new THREE.Vector3(x0, 0, zEnd), new THREE.Vector3(x1, 0, zEnd));
    }
    route.push(P.entry.clone().add(new THREE.Vector3(P.ds * 0.25, 0, -0.35)), P.entry.clone());
    if (P.kind === 'bike' && me.x < 0) { // round the front or back to the left side
      const zEnd = me.z > 0 ? P.box.max.z + 0.7 : P.box.min.z - 0.7;
      route.unshift(new THREE.Vector3(-0.9, 0, zEnd), new THREE.Vector3(0.9, 0, zEnd));
    }
    v.occupied = 'entering';
    this.st = { mode: 'enter', v, P, phase: 'approach', t: 0, route, ri: 0, T: 0 };
    this.game.hud.setPrompt(null);
  }

  // -------------------------------------------------------------- exit
  startExit(v) {
    const P = interactionProfile(v);
    if (!P || !this.human) return false;
    if (P.kind === 'bike') {
      this.st = { mode: 'exit', v, P, side: 1, phase: 'bikeStop', t: 0, T: 0 };
      v.occupied = 'exiting';
      return true;
    }
    // a clear place to stand: the driver's side, else climb across and out of the other side
    const free = (p) => { const w = this._toWorld(v, p, _a); return this.of._free(w.x, w.z) && this._clearOfVehicles(w.x, w.z, v); };
    let side = P.ds;
    const mirror = (p) => new THREE.Vector3(-p.x, p.y, p.z);
    if (!(free(P.exit) && free(P.entry))) {
      if (P.kind !== 'auto' && free(mirror(P.exit)) && free(mirror(P.entry))) side = -P.ds;
      else return 'blocked';
    }
    this.st = { mode: 'exit', v, P, side, phase: 'stop', t: 0, T: 0 };
    v.occupied = 'exiting';
    return true;
  }
  _clearOfVehicles(x, z, self) {
    const g = this.game;
    for (const v of [g.player, ...this.of.parked, ...(g.police?.vehicles() || [])]) {
      if (!v || v === self || v.gone) continue;
      const s = v.state, c = Math.cos(s.yaw), sn = Math.sin(s.yaw), lx = (x - s.x) * c - (z - s.z) * sn, lz = (x - s.x) * sn + (z - s.z) * c;
      if (Math.abs(lx) < (v.p.width || 1.9) / 2 + 0.4 && Math.abs(lz) < (v.p.length || 4.5) / 2 + 0.4) return false;
    }
    for (const c of g.traffic?.cars || []) {
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), lx = (x - c.x) * cs - (z - c.z) * sn, lz = (x - c.x) * sn + (z - c.z) * cs;
      if (Math.abs(lx) < (c.spec?.w || 1.9) / 2 + 0.4 && Math.abs(lz) < (c.spec?.l || 4.6) / 2 + 0.4) return false;
    }
    return true;
  }

  // sit straight in (a new car from the garage, a respawn)
  seatInstant(v) {
    const P = interactionProfile(v);
    if (!P || !this.human) { this.st = null; return; }
    if (P.kind === 'bike') { this._riderIsMe(v, true); this.st = { mode: 'seated', v, P, t: 0, T: 0 }; v.occupied = 'driver'; this._detach(); this.of.body.group.visible = false; return; }
    this._attach(v);
    this.human.play(P.kind === 'auto' ? 'sitIdle' : 'drive', { hold: true, fade: 0 });
    this.st = { mode: 'seated', v, P, t: 0 };
    v.occupied = 'driver';
    this.of.body.group.visible = true;
  }

  release() { // stop occupying (the character is put away elsewhere)
    if (this.st?.v) this.st.v.occupied = null;
    this.st = null;
  }

  // -------------------------------------------------------------- per frame
  update(dt, input) {
    const st = this.st;
    if (!st) return;
    if (!st.v.renderer || st.v.gone) { this._detach(); this.st = null; return; }
    st.t += dt; st.T += dt;
    if (st.mode === 'enter') this._enter(dt, input);
    else if (st.mode === 'exit') this._exit(dt, input);
    else this._seated(dt);
    this._debugDraw();
  }

  _next(name) { this.st.phase = name; this.st.t = 0; }

  // walking along the route to the door, with the normal locomotion
  _walk(dt, target, speedMax) {
    const s = this.of.state, w = this._toWorld(this.st.v, target, _b);
    const dx = w.x - s.x, dz = w.z - s.z, d = Math.hypot(dx, dz);
    const sp = Math.min(speedMax, d * 2.2 + 0.25);             // slows to a stop on arrival
    if (d > 0.04) { s.x += dx / d * Math.min(sp * dt, d); s.z += dz / d * Math.min(sp * dt, d); }
    let dy = Math.atan2(dx, dz) - s.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    if (d > 0.15) s.yaw += dy * Math.min(1, dt * 9);
    s.speed = d > 0.04 ? sp : 0; s.vx = s.vz = 0;
    s.y = this.of._ground(s.x, s.z);
    return d;
  }

  _enter(dt, input) {
    const st = this.st, v = st.v, P = st.P, s = this.of.state, h = this.human;
    v.controls.handbrake = 1; v.controls.throttle = 0;
    const ic = input?.controls;
    switch (st.phase) {
      case 'approach': {
        // the player can give up by walking away
        if (ic && Math.hypot((ic.throttle || 0) - (ic.brake || 0), ic.steer || 0) > 0.5 && st.t > 0.4) { this._cancel(); return; }
        const far = st.route.length - st.ri > 2;
        const d = this._walk(dt, st.route[st.ri], far ? 3.2 : 1.7);
        if (d < (st.ri < st.route.length - 1 ? 0.35 : 0.06)) { if (++st.ri >= st.route.length) this._next('align'); }
        if (st.t > 12) { this._cancel(); return; }
        this.of._pose(dt);
        return;
      }
      case 'align': {
        // settle on the spot, turning to face the door handle (feet stay planted; the yaw eases round)
        const H = P.kind === 'bike' ? this._toWorld(v, _c.set(P.entry.x, 0, P.entry.z + 5), _c) : this._toWorld(v, P.handle, _c);
        this._walk(dt, P.entry, 0.6);
        let dy = Math.atan2(H.x - s.x, H.z - s.z) - s.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        s.yaw += dy * Math.min(1, dt * 7); s.speed = 0;
        this.of._pose(dt);
        if (st.t > 0.3 && Math.abs(dy) < 0.12) {
          this._attach(v);
          st.local = this._localPose();            // where the hips / facing are now, in vehicle space
          if (P.kind === 'bike') { this._next('mountReach'); }
          else if (P.kind === 'auto') { this._next('step'); h.play('sitEnter', { rate: 1.1, hold: true, fade: 0.2 }); }
          else { this._next('reach'); h.play('interact', { rate: 1.5, fade: 0.15 }); }
        }
        return;
      }
      case 'mountReach': {
        // standing by the seat: both hands onto the bars, lean in a little
        const T = 0.45, k = smooth(st.t / T);
        this._poseLocal(dt, st.local.hips, st.local.yaw, (ik) => {
          this._feetDown(ik, v, P, st.local.hips, 1);
          ik.arm(1, this._toWorld(v, P.bars.L), this._hint(v, 0.7, -0.7, -0.2), k);
          ik.arm(-1, this._toWorld(v, P.bars.R), this._hint(v, -0.5, -0.7, -0.2), k);
          this._look(ik, this._toWorld(v, _c.set(0, 1.2, 4)), 0.5);
        });
        if (st.t >= T) { this._next('swing'); st.from = st.local.hips.clone(); }
        return;
      }
      case 'swing': {
        // the right leg swings up and over the seat; the hips come across onto it
        const T = 0.75, k = smooth(st.t / T);
        const over = _d.copy(P.seat).add(_k.set(0.05, 0.12, 0));
        const hips = k < 0.6 ? st.from.clone().lerp(over, k / 0.6) : over.clone().lerp(P.seat, (k - 0.6) / 0.4);
        hips.y += Math.sin(k * Math.PI) * 0.08;
        this._poseLocal(dt, hips, lerp(st.local.yaw, 0, k), (ik) => {
          ik.arm(1, this._toWorld(v, P.bars.L), this._hint(v, 0.7, -0.7, -0.2), 1);
          ik.arm(-1, this._toWorld(v, P.bars.R), this._hint(v, -0.6, -0.7, -0.2), 1);
          // left foot stays planted beside the bike; the right foot arcs over the seat to the far side
          ik.leg(1, this._toWorld(v, _a.set(0.32, P.groundY, P.seat.z + 0.08)), this._hint(v, 0.4, 0.2, 1), 1);
          const f0 = _b.set(0.42, P.groundY, P.seat.z - 0.05), f1 = _c.set(-0.32, P.groundY, P.seat.z + 0.08);
          const foot = f0.clone().lerp(f1, k); foot.y += Math.sin(k * Math.PI) * (P.seat.y + 0.15 - P.groundY);
          foot.z -= Math.sin(k * Math.PI) * 0.35;                    // swung round behind, over the tail
          ik.leg(-1, this._toWorld(v, foot), this._hint(v, -0.3, 0.3, 1), 1);
          this._look(ik, this._toWorld(v, _c.set(0, 1.2, 4)), 0.5);
        });
        if (st.t >= T) this._next('mountSit');
        return;
      }
      case 'mountSit': {
        // settled on the seat, both feet down: the bike's rider (our own model) takes over
        const T = 0.3;
        this._poseLocal(dt, P.seat, 0, (ik) => {
          ik.arm(1, this._toWorld(v, P.bars.L), this._hint(v, 0.7, -0.7, -0.2), 1);
          ik.arm(-1, this._toWorld(v, P.bars.R), this._hint(v, -0.7, -0.7, -0.2), 1);
          ik.leg(1, this._toWorld(v, _a.set(0.36, P.groundY + 0.06, P.seat.z + 0.08)), this._hint(v, 0.5, 0.3, 1), 1);
          ik.leg(-1, this._toWorld(v, _a.set(-0.36, P.groundY + 0.06, P.seat.z + 0.08)), this._hint(v, -0.5, 0.3, 1), 1);
        });
        if (st.t >= T) {
          this._riderIsMe(v, true);
          this._detach(); this.of.body.group.visible = false; h.clearAction(0);
          this.of._handover?.(v);
          this.st = { mode: 'seated', v, P, t: 0, T: 0 }; v.occupied = 'driver';
        }
        return;
      }
      case 'reach': {
        // hand to the handle, the door swings open, the hand rides it out a little
        const T = 0.75;
        if (!st.opened && st.t > 0.32) { st.opened = true; this._door(v, P.door.side, true); }
        const hand = this._handleNow(v, P);
        this._poseLocal(dt, st.local.hips, st.local.yaw, (ik) => {
          const w = smooth(st.t / 0.3) * (1 - smooth((st.t - T + 0.18) / 0.18));
          ik.arm(this._outerSide(P), hand, this._hint(v, -P.ds * 0.3, -1, -0.3), w);
          this._look(ik, hand, 0.6);
          this._feetDown(ik, v, P, st.local.hips, 1);
        });
        if (st.t >= T) { this._next('step'); h.play('sitEnter', { rate: 1.05, hold: true, fade: 0.25 }); }
        return;
      }
      case 'step': {
        // turn the back to the seat, inner foot in over the sill (onto the step for a tall cab), head down
        const T = P.step ? 0.75 : 0.55, k = smooth(st.t / T);
        const hips = _d.copy(st.local.hips).lerp(P.step ? P.step.clone().add(_k.set(P.ds * 0.25, 0.75, 0)) : P.sill.clone().add(_k.set(P.ds * 0.28, 0.08, 0)), k);
        const yaw = lerp(st.local.yaw, P.ds * 0.55, k);
        this._poseLocal(dt, hips, yaw, (ik) => {
          const inner = -P.ds;                                   // the leg towards the inside goes first
          // the inner foot lifts over the sill and down onto the cabin floor (or the step)
          const floorIn = new THREE.Vector3(P.sill.x - P.ds * 0.2, P.step ? P.step.y : P.floorY + 0.02, P.seat.z + 0.32);
          const foot = new THREE.Vector3(P.entry.x, P.groundY, P.entry.z + 0.15).lerp(floorIn, k);
          foot.y = lerp(P.groundY, floorIn.y, k) + Math.sin(k * Math.PI) * 0.22;
          ik.leg(inner, this._toWorld(v, foot), this._hint(v, 0.1, 0.4, 1), 1);
          ik.leg(-inner, this._toWorld(v, _k.set(P.entry.x, P.groundY, P.entry.z - 0.1)), this._hint(v, 0, 0.3, 1), 1);
          this._spine(ik, v, P.duck * Math.sin(k * Math.PI * 0.6) * 0.6);
          this._look(ik, this._toWorld(v, P.seat, _c), 0.4);
        });
        if (st.t >= T) { this._next('lower'); st.from = hips.clone(); st.fromYaw = yaw; }
        return;
      }
      case 'lower': {
        // the hips swing in under the roof and down onto the seat, turning to face forward
        const T = 0.65, k = smooth(st.t / T);
        const hips = _d.copy(st.from).lerp(P.seat, k); hips.y += Math.sin(k * Math.PI) * 0.03;
        const yaw = lerp(st.fromYaw, 0, k);
        this._poseLocal(dt, hips, yaw, (ik) => {
          const inner = -P.ds;
          ik.leg(inner, this._toWorld(v, _a.copy(P.pedals[inner > 0 ? 'L' : 'R']).lerp(_k.set(P.sill.x - P.ds * 0.2, P.floorY + 0.02, P.seat.z + 0.32), 1 - k)), this._hint(v, 0.1, 0.5, 1), 1);
          // the outer foot stays on the ground outside until the hips are in
          ik.leg(-inner, this._toWorld(v, _k.set(P.entry.x, P.groundY, P.entry.z - 0.1)), this._hint(v, 0, 0.3, 1), 1);
          this._spine(ik, v, P.duck * (1 - k) * 0.7);
          this._look(ik, this._toWorld(v, _c.copy(P.seat).add(_k.set(0, 0.5, 3)), _c), 0.4);
        });
        if (st.t >= T) { this._next('legsIn'); h.play(P.kind === 'auto' ? 'sitIdle' : 'drive', { hold: true, fade: 0.45 }); }
        return;
      }
      case 'legsIn': {
        // the outer leg comes in over the sill onto its pedal
        const T = 0.45, k = smooth(st.t / T), outer = P.ds;
        this._poseLocal(dt, P.seat, 0, (ik) => {
          const from = _a.set(P.entry.x, P.groundY, P.entry.z - 0.1), to = P.pedals[outer > 0 ? 'L' : 'R'];
          const p = _b.copy(from).lerp(to, k); p.y += Math.sin(k * Math.PI) * 0.28;
          ik.leg(outer, this._toWorld(v, p), this._hint(v, 0.1, 0.5, 1), 1);
          ik.leg(-outer, this._toWorld(v, P.pedals[-outer > 0 ? 'L' : 'R']), this._hint(v, 0.1, 0.5, 1), 1);
          this._look(ik, this._toWorld(v, _c.copy(P.seat).add(_k.set(0, 0.5, 3)), _c), 0.4);
        });
        if (st.t >= T) this._next('settle');
        return;
      }
      case 'settle': {
        // pull the door to, hands onto the wheel, look up the road; then it's yours
        const T = 0.55;
        if (!st.closed && st.t > 0.12) { st.closed = true; this._door(v, P.door.side, false); this.of._handover?.(v); }
        this._seatedPose(dt, smooth(st.t / 0.4));
        if (st.t >= T) { this.st = { mode: 'seated', v, P, t: 0, T: 0 }; v.occupied = 'driver'; }
        return;
      }
    }
  }

  _exit(dt, input) {
    const st = this.st, v = st.v, P = st.P, h = this.human;
    const side = st.side, sgn = side === P.ds ? 1 : -1;     // climbing across to the other door mirrors x
    const M = (p) => (sgn > 0 ? p : _k.copy(p).setX(-p.x));
    switch (st.phase) {
      case 'bikeStop': {
        v.controls.throttle = 0; v.controls.brake = Math.hypot(v.state.vx, v.state.vz) > 0.6 ? 1 : 0; v.controls.handbrake = 1; v.controls.steer = 0;
        if (Math.hypot(v.state.vx, v.state.vz) < 0.6 || st.t > 3) {
          // our own body takes over from the bike's rider in the same place (feet down, hands on the bars)
          v.renderer.setRider?.(false);
          this.of.body.group.visible = true;
          this._attach(v);
          this.human.clearAction(0);
          this._next('unswing');
        }
        return;
      }
      case 'unswing': {
        const T = 0.8, k = smooth(st.t / T);
        const over = _d.copy(P.seat).add(_k.set(0.05, 0.12, 0)), stand = _b.copy(P.entry); stand.y = P.groundY + (h.hipH || 0.95);
        const hips = k < 0.4 ? P.seat.clone().lerp(over, k / 0.4) : over.clone().lerp(stand, (k - 0.4) / 0.6);
        this._poseLocal(dt, hips, lerp(0, 0.3, k), (ik) => {
          const wH = 1 - smooth((k - 0.75) / 0.25);
          ik.arm(1, this._toWorld(v, P.bars.L), this._hint(v, 0.7, -0.7, -0.2), wH);
          ik.arm(-1, this._toWorld(v, P.bars.R), this._hint(v, -0.6, -0.7, -0.2), wH);
          ik.leg(1, this._toWorld(v, _a.set(0.36, P.groundY, P.seat.z + 0.08).lerp(_c.set(P.entry.x + 0.08, P.groundY, P.entry.z + 0.05), k)), this._hint(v, 0.4, 0.2, 1), 1);
          const f0 = _a.set(-0.36, P.groundY, P.seat.z + 0.08), f1 = _c.set(P.entry.x - 0.1, P.groundY, P.entry.z - 0.1);
          const foot = f0.clone().lerp(f1, k); foot.y += Math.sin(k * Math.PI) * (P.seat.y + 0.15 - P.groundY); foot.z -= Math.sin(k * Math.PI) * 0.35;
          ik.leg(-1, this._toWorld(v, foot), this._hint(v, -0.3, 0.3, 1), 1);
        });
        if (st.t >= T) {
          const s = this.of.state, c = this.of.body.group;
          this._detach(); c.updateMatrixWorld(true);
          const e = new THREE.Euler().setFromQuaternion(c.getWorldQuaternion(_q0), 'YXZ'), hp = wpos(h.B.Hips, _a);
          s.x = hp.x; s.z = hp.z; s.y = this.of._ground(s.x, s.z); s.yaw = e.y;
          c.quaternion.identity(); c.position.set(s.x, s.y, s.z); c.rotation.set(0, s.yaw, 0);
          this._next('bikeStepAway');
        }
        return;
      }
      case 'bikeStepAway': {
        const d = this._walk(dt, P.exit, 1.2);
        this.of._pose(dt);
        if (d < 0.08 || st.t > 1.5 || (input?.controls && st.t > 0.3 && Math.hypot((input.controls.throttle || 0) - (input.controls.brake || 0), input.controls.steer || 0) > 0.3)) { v.occupied = null; this.st = null; }
        return;
      }
      case 'stop': {
        // bring it to a stop first (handbrake), hands still on the wheel
        v.controls.throttle = 0; v.controls.brake = Math.hypot(v.state.vx, v.state.vz) > 0.6 ? 1 : 0; v.controls.handbrake = 1; v.controls.steer = 0;
        this._seatedPose(dt, 1);
        if (Math.hypot(v.state.vx, v.state.vz) < 0.6 || st.t > 3) this._next('handsOff');
        return;
      }
      case 'handsOff': {
        const T = 0.3;
        v.controls.brake = 0; v.controls.handbrake = 1;
        this._seatedPose(dt, 1 - smooth(st.t / T));
        if (st.t > 0.12 && !st.opened) { st.opened = true; this._door(v, side, true); }
        if (st.t >= T) {
          // across to the passenger side first?
          if (sgn < 0) { st.from = P.seat.clone(); this._next('across'); } else this._next('legsOut');
          h.play('sitIdle', { hold: true, fade: 0.25 });
        }
        return;
      }
      case 'across': {
        const T = 0.9, k = smooth(st.t / T);
        const hips = _d.copy(st.from).lerp(_a.set(-P.seat.x, P.seat.y, P.seat.z), k); hips.y += Math.sin(k * Math.PI) * 0.06;
        this._poseLocal(dt, hips, 0, (ik) => { this._spine(ik, v, P.duck * 0.5 * Math.sin(k * Math.PI)); });
        if (st.t >= T) this._next('legsOut');
        return;
      }
      case 'legsOut': {
        // turn towards the door, the outer leg swings out onto the ground
        const T = 0.5, k = smooth(st.t / T), seat = M(P.seat).clone();
        this._poseLocal(dt, seat, side * 0.5 * k, (ik) => {
          const outer = side, to = M(_a.set(P.entry.x, P.groundY, P.entry.z - 0.1)).clone(), from = M(P.pedals[outer > 0 ? 'L' : 'R']).clone();
          const p = from.lerp(to, k); p.y += Math.sin(k * Math.PI) * 0.28;
          ik.leg(outer, this._toWorld(v, p), this._hint(v, side * 0.4, 0.5, 1), 1);
          ik.leg(-outer, this._toWorld(v, M(P.pedals[-outer > 0 ? 'L' : 'R']).clone()), this._hint(v, 0.1, 0.5, 1), 1);
          this._look(ik, this._toWorld(v, M(P.exit).clone().setY(P.seat.y), _c), 0.5);
        });
        if (st.t >= T) { this._next('rise'); h.play('sitExit', { rate: 1.35, fade: 0.2 }); st.from = seat; }
        return;
      }
      case 'rise': {
        // duck under the roof and out, weight onto the outside foot, standing up beside the door
        const T = P.step ? 0.9 : 0.8, k = smooth(st.t / T);
        const standHips = M(P.entry).clone(); standHips.y = P.groundY + (h.hipH || 0.95);
        const mid = M(P.sill).clone().add(_k.set(side * 0.28, 0.08, 0));
        const hips = k < 0.5 ? _d.copy(st.from).lerp(mid, k * 2) : _d.copy(mid).lerp(standHips, (k - 0.5) * 2);
        this._poseLocal(dt, hips, side * lerp(0.5, 0.75, k), (ik) => {
          ik.leg(side, this._toWorld(v, M(_a.set(P.entry.x, P.groundY, P.entry.z - 0.1)).clone()), this._hint(v, side * 0.3, 0.3, 1), 1);
          const innerFrom = M(P.pedals[-side > 0 ? 'L' : 'R']).clone(), innerTo = M(_a.set(P.entry.x, P.groundY, P.entry.z + 0.2)).clone();
          const p = innerFrom.lerp(innerTo, smooth((k - 0.35) / 0.65)); p.y += Math.sin(smooth((k - 0.35) / 0.65) * Math.PI) * 0.25;
          ik.leg(-side, this._toWorld(v, p), this._hint(v, 0.1, 0.4, 1), 1 - smooth((k - 0.85) / 0.15));
          this._spine(ik, v, P.duck * Math.sin(k * Math.PI) * 0.7);
        });
        if (st.t >= T) {
          // standing outside: back to the world and the walking character
          const s = this.of.state, c = this.of.body.group;
          this._detach();
          c.updateMatrixWorld(true);
          const e = new THREE.Euler().setFromQuaternion(c.getWorldQuaternion(_q0), 'YXZ');
          const hp = wpos(h.B.Hips, _a);
          s.x = hp.x; s.z = hp.z; s.y = this.of._ground(s.x, s.z); s.yaw = e.y;
          c.quaternion.identity(); c.position.set(s.x, s.y, s.z); c.rotation.set(0, s.yaw, 0);
          h.clearAction(0.12);
          this._next('stepAway');
        }
        return;
      }
      case 'stepAway': {
        const d = this._walk(dt, M(P.exit).clone(), 1.3);
        this.of._pose(dt);
        if (d < 0.08 || st.t > 2) { this._next('close'); h.play('interact', { rate: 1.6, fade: 0.15 }); st.h0 = this.of.state.yaw; }
        return;
      }
      case 'close': {
        // turn back and push the door shut; moving off lets go (the door swings to on its own)
        const s = this.of.state, T = 0.65, ic = input?.controls;
        const door = this._toWorld(v, _a.set(side * (P.halfW + 0.1), P.groundY + 1.0, P.door.hinge.z - P.door.len * 0.75));
        let dy = Math.atan2(door.x - s.x, door.z - s.z) - s.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        s.yaw += dy * Math.min(1, dt * 8); s.speed = 0;
        this.of._pose(dt);
        if (st.t < 0.5) { const ik = this._ik(); ik.arm(side > 0 ? -1 : 1, door, this._hint(v, side * 0.3, -1, 0), smooth(st.t / 0.25) * (1 - smooth((st.t - 0.35) / 0.15))); }
        if (!st.closed && st.t > 0.25) { st.closed = true; this._door(v, side, false); }
        if (st.t >= T || (ic && st.t > 0.3 && Math.hypot((ic.throttle || 0) - (ic.brake || 0), ic.steer || 0) > 0.3)) {
          if (!st.closed) this._door(v, side, false);
          v.occupied = null; this.st = null; h.clearAction(0.2);
        }
        return;
      }
    }
  }

  // -------------------------------------------------------------- driving
  _seated(dt) {
    const st = this.st, v = st.v;
    if (st.P.kind === 'bike') { this.of.body.group.visible = false; return; }
    // first person: the cockpit view draws its own arms
    this.of.body.group.visible = !v.renderer.cockpitOn;
    if (!this.of.body.group.visible) return;
    // the body sways with the car: g-forces in the car's frame (a damped spring, kept subtle)
    const s = v.state, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const vl = s.vx * fx + s.vz * fz, vlat = s.vx * fz - s.vz * fx;
    const along = (vl - (st.pv ?? vl)) / Math.max(dt, 1e-3), lat = (vlat - (st.pl ?? vlat)) / Math.max(dt, 1e-3);
    st.pv = vl; st.pl = vlat;
    const yr = s.yawRate ?? 0, latG = -vl * yr;                    // centripetal: a left turn throws you right
    const W = this.sway, kx = clamp(latG * 0.006, -0.07, 0.07), kz = clamp(-along * 0.009, -0.06, 0.09);
    W.vx += ((kx - W.x) * 60 - W.vx * 9) * dt; W.vz += ((kz - W.z) * 60 - W.vz * 9) * dt;
    W.x += W.vx * dt; W.z += W.vz * dt;
    void lat;
    this._seatedPose(dt, 1);
  }
  // a jolt from a collision (VehicleInteraction.collision(intensity, nx, nz))
  collision(k, nx = 0, nz = 0) {
    if (this.st?.mode !== 'seated') return;
    const v = this.st.v, s = v.state, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    // into the car's frame: x left, z forward
    const lx = nx * c - nz * sn, lz = nx * sn + nz * c;
    this.sway.vx += -lx * k * 2.2; this.sway.vz += -lz * k * 2.6;
  }

  _seatedPose(dt, wHands) {
    const st = this.st, v = st.v, P = st.P, s = v.state;
    const steer = s.wheelSteer || 0;
    const hips = _d.copy(P.seat); hips.x += this.sway.x * 0.35;
    this._poseLocal(dt, hips, 0, (ik) => {
      // feet on the pedals (the right foot presses with the throttle / brake)
      const thr = v.controls?.throttle || 0, brk = v.controls?.brake || 0;
      ik.leg(1, this._toWorld(v, P.pedals.L), this._hint(v, 0.15, 0.5, 1), 1);
      ik.leg(-1, this._toWorld(v, _a.copy(P.pedals.R).add(_k.set(brk > 0.1 ? 0.12 : 0, -0.03 * Math.max(thr, brk), 0.04 * Math.max(thr, brk)))), this._hint(v, -0.15, 0.5, 1), 1);
      // the torso sways with the car (forward under braking, back under acceleration, out in the turns)
      ik.aim(this.human.B.Spine, this.human.B.Neck, wpos(this.human.B.Neck, _a).add(this._dirW(v, -this.sway.x, 0, this.sway.z, _b)), 1);
      // hands on the wheel, turning with it (ten to two), or on the bars
      if (P.wheel) {
        for (const side of [1, -1]) ik.arm(side, this._toWorld(v, gripPoint(P.wheel, side * 1.05, steer, _a)), this._hint(v, side * 0.6, -0.8, -0.2), wHands);
      } else if (P.bars) {
        const turn = steer * 0.5;
        for (const side of [1, -1]) { const g = _a.copy(P.bars[side > 0 ? 'L' : 'R']); g.z += side * turn * 0.25; ik.arm(side, this._toWorld(v, g), this._hint(v, side * 0.7, -0.7, -0.2), wHands); }
      }
      // eyes on the road, into the turn
      this._look(ik, this._toWorld(v, _c.set(P.seat.x - steer * 5, P.seat.y + 0.6, P.seat.z + 12), _c), 0.55);
    });
  }

  // -------------------------------------------------------------- posing helpers
  _ik() { return (this._bik ||= new BodyIK(this.human)); }
  // pose the character in vehicle space: hips at `hips`, facing `yaw` (0 = the vehicle's forward), animation
  // first, then the IK callback
  _poseLocal(dt, hips, yaw, fn) {
    const c = this.of.body.group, h = this.human;
    c.rotation.set(0, yaw, 0);
    c.updateMatrixWorld(true);
    h.animate(0, dt);
    h.root.updateMatrixWorld(true);
    // move the container so the hips land on target
    const now = this._toLocal(this.st.v, wpos(h.B.Hips, _a), _b);
    c.position.add(_c.copy(hips).sub(now));
    c.updateMatrixWorld(true);
    fn?.(this._ik());
    // the walking camera follows the hips while getting in / out
    const w = this._toWorld(this.st.v, hips, _a), s = this.of.state;
    s.x = w.x; s.z = w.z;
  }
  _localPose() {
    const c = this.of.body.group, h = this.human;
    c.updateMatrixWorld(true);
    const hips = this._toLocal(this.st.v, wpos(h.B.Hips, _a));
    const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    return { hips, yaw: e.y };
  }
  _feetDown(ik, v, P, hips, w) {
    for (const side of [1, -1]) {
      const fwd = _a.set(Math.sin(this.of.body.group.rotation.y), 0, Math.cos(this.of.body.group.rotation.y));
      const lat = _b.set(fwd.z, 0, -fwd.x).multiplyScalar(side * 0.11);
      const p = _c.set(hips.x + lat.x, P.groundY, hips.z + lat.z);
      ik.leg(side, this._toWorld(v, p), this._dirW(v, fwd.x, 0.3, fwd.z, _k), w);
    }
  }
  _spine(ik, v, duck) {
    if (duck <= 0.01) return;
    const B = this.human.B, base = wpos(B.Spine, _a), neck = wpos(B.Neck, _b);
    const L = base.distanceTo(neck), fwd = this._dirW(v, 0, 0, 1, _c);
    const dir = _k.subVectors(neck, base).normalize().addScaledVector(fwd, duck).normalize();
    ik.aim(B.Spine, B.Neck, base.clone().addScaledVector(dir, L), 1);
  }
  _look(ik, target, w) {
    const B = this.human.B;
    if (!B.Neck || !B.HeadTop_End) return;
    const n = wpos(B.Neck, new THREE.Vector3()), dir = _k.subVectors(target, n).normalize();
    dir.y = Math.max(dir.y, -0.3) + 0.25;                            // a level-ish gaze, not chin-on-chest
    ik.aim(B.Neck, B.HeadTop_End, n.add(dir.normalize().multiplyScalar(0.3)), w);
  }
  _hint(v, x, y, z) { return this._dirW(v, x, y, z, new THREE.Vector3()).normalize(); }
  _dirW(v, x, y, z, out) { return out.set(x, y, z).applyQuaternion(this._body(v).getWorldQuaternion(_q1)); }
  // the hand nearer the door's free edge
  _outerSide(P) { return P.ds > 0 ? 1 : -1; }
  // the handle as the door swings (it moves round the hinge)
  _handleNow(v, P) {
    const d = v.renderer.doors?.[P.door.side];
    if (d?.node) {
      const local = _a.copy(P.handle).sub(P.door.hinge);
      const ang = -Math.sign(P.door.side) * (d.a || 0);
      local.applyAxisAngle(_b.set(0, 1, 0), ang);
      return this._toWorld(v, local.add(P.door.hinge));
    }
    return this._toWorld(v, P.handle);
  }
  _door(v, side, open) {
    const g = this.game;
    const ok = v.renderer?.setDoor?.(side, open);
    const P = interactionProfile(v);
    const pos = this._toWorld(v, _a.set(side * P.halfW, P.groundY + 1, P.door.hinge.z - P.door.len / 2));
    const position = { x: pos.x, y: pos.y, z: pos.z };
    if (P.kind === 'auto') return;
    if (open) g.audio?.playEvent('doorOpen', { position });
    else if (ok) v.renderer.onDoorShut = () => { v.renderer.onDoorShut = null; g.audio?.playEvent('doorShut', { position }); };
    else g.audio?.playEvent('doorShut', { position });
  }
  _cancel() {
    const st = this.st;
    if (st?.v) st.v.occupied = null;
    this._detach();
    this.st = null;
    this.human?.clearAction(0.2);
  }

  // the bike's rider is drawn from our own character (same look), shown or hidden
  _riderIsMe(v, on) {
    if (this.human?.root) { this.human.root.userData.riderScale = 1; v.renderer.setRiderTemplate?.(this.human.root); }
    v.renderer.setRider?.(on);
  }

  setDebug(on) { this.debug = on; for (const v of [this.game.player, ...this.of.parked]) showSockets(v, on); }
  _debugDraw() {
    if (!this.debug) return;
    const v = this.st?.v;
    if (v && !v.renderer._sockets) showSockets(v, true);
  }
}
