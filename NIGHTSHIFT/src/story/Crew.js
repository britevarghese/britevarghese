// The player's crew in a story mission, as in GTA: real characters (the people models) who keep with the player.
// On foot they walk, jog or run to their place beside and a little behind the player, matching the pace, finding a
// way round walls, furniture and parked cars; they go through a door with the player; they get into the car through
// their own door and sit beside the player (the same get-in as the player's: the hand on the handle, the door swung
// open, ducking in, legs in, the door pulled shut), and out again. In a scene they stand where they are put, face
// who they are told, look at whoever is talking and hold their pose (a gun on the room). Masks, a pistol, a bag.
//
//   follow   to a slot beside / behind the leader (the player)
//   goto     to a point (walking or running), then stand there facing something
//   stand    stay put, facing a yaw or a point
//   board    getting into a vehicle; car: sitting in it; alight: getting out
//   hidden   not in the world for now
import * as THREE from 'three';
import { VehicleInteraction, BodyIK } from '../vehicles/Interaction.js';
import { clamp } from '../core/util.js';
import { wearMask, makeGun, makeBag } from './HeistProps.js';

const RADIUS = 0.3;
const turn = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + clamp(d, -k, k); };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0), _o = new THREE.Vector3(), _lk = new THREE.Vector3();

export class CrewMember {
  constructor(game, { id, name, model, outfit = null, slot = [1.1, -0.9] }) {
    this.game = game; this.id = id; this.name = name;
    const h = game.humans.create(model, { shadow: game.preset.shadows !== 'off', outfit });
    this.human = h;
    this.group = new THREE.Group(); this.group.name = 'crew_' + id;
    if (h) this.group.add(h.group);
    game.scene.add(this.group);
    this.state = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0 };
    this.mode = 'stand';
    this.slot = slot;                 // [to the right, ahead] of the leader (metres; negative = left / behind)
    this.face = null;                 // stand: a yaw, or { x, z } to face
    this.look = null;                 // a world point the head turns to (who is talking), or a function of one
    this.aimAt = null;                // a world point the gun is held on
    this.side = 1;                    // which way round an obstacle (kept until clear: no dithering)
    // the get-in / get-out is the player's own (Interaction.js), driven through a stand-in for the walking state
    const self = this;
    this.of = {
      state: this.state, body: { group: this.group }, human: h, parked: game.onFoot.parked,
      _ground: (x, z) => self._ground(x, z), _free: (x, z) => self._free(x, z), _pose: (dt) => self._pose(dt),
    };
    this.inter = new VehicleInteraction(game, this.of);
    this.ik = h ? new BodyIK(h) : null;
  }

  get ok() { return !!this.human; }

  // ------------------------------------------------------------------ orders
  place(x, z, yaw = this.state.yaw) {
    const s = this.state;
    s.x = x; s.z = z; s.yaw = yaw; s.speed = 0; s.y = this._ground(x, z);
    this.group.visible = true;
  }
  follow(slot = this.slot) { this._out(); this.mode = 'follow'; this.slot = slot; }
  goTo(x, z, { run = false, face = null, near = 0.3 } = {}) { this._out(); this.mode = 'goto'; this.dest = { x, z, run, near }; this.face = face; }
  stand(face = null) { this._out(); this.mode = 'stand'; if (face !== null) this.face = face; }
  hide() { this.inter.st = null; this.mode = 'hidden'; this.group.visible = false; this._propsVisible(false); }
  // into a vehicle by its door (P: Interaction's profile: the driver's or passengerProfile's), or straight into the seat
  board(v, P) { this.mode = 'board'; this.inter.startEnter(v, P); }
  seatIn(v, P) { this.group.visible = true; this.inter.seatInstant(v, P); this.mode = this.inter.st ? 'car' : 'stand'; }
  alight() { if (this.inter.seated) { const r = this.inter.startExit(this.inter.seated); if (r === true) this.mode = 'alight'; return r; } return false; }
  // (a walking order while still attached to a car: back into the world first)
  _out() { if (this.inter.st) { this.inter._detach(); this.inter.st = null; this.group.quaternion.identity(); } this.group.visible = true; }
  get seated() { return this.inter.seated; }
  get busy() { return this.mode === 'board' || this.mode === 'alight'; }

  setMask(style) { if (this.mask) { this.mask.removeFromParent(); this.mask = null; } if (style && this.human) this.mask = wearMask(this.human, style); }
  setGun(on) {
    if (on && !this.gun) { this.gun = makeGun(); this.game.scene.add(this.gun); this._layers(this.gun); }
    if (this.gun) this.gun.visible = on;
    this.gunOn = on;
  }
  setBag(on) {
    if (on && !this.bag) { this.bag = makeBag(this.id === 'leena' ? 0x2a1a1a : 0x1c2230); this.game.scene.add(this.bag); this._layers(this.bag); }
    if (this.bag) this.bag.visible = on;
    this.bagOn = on;
  }
  // the render layer the camera sees indoors (Interiors): on for the body and what it carries
  setIndoor(layer, on) {
    this.indoorLayer = on ? layer : null;
    for (const o of [this.group, this.gun, this.bag]) o?.traverse((q) => (on ? q.layers.enable(layer) : q.layers.disable(layer)));
  }
  _layers(o) { if (this.indoorLayer != null) o.traverse((q) => q.layers.enable(this.indoorLayer)); }
  _propsVisible(on) { if (this.gun) this.gun.visible = on && this.gunOn; if (this.bag) this.bag.visible = on && this.bagOn; }

  dispose() {
    this.inter._detach?.(); this.inter.st = null;
    this.group.removeFromParent(); this.human?.dispose?.();
    this.gun?.removeFromParent(); this.bag?.removeFromParent();
  }

  // ------------------------------------------------------------------ per frame
  update(dt, leader) {
    if (!this.human || this.mode === 'hidden') return;
    const s = this.state;
    switch (this.mode) {
      case 'follow': this._follow(dt, leader); break;
      case 'goto': {
        const D = this.dest, dx = D.x - s.x, dz = D.z - s.z, d = Math.hypot(dx, dz);
        if (d < D.near) { this.mode = 'stand'; this._move(dt, 0, 0, 0); break; }
        this._move(dt, dx, dz, D.run ? (d > 2 ? 5.2 : 2.6) : d > 1.2 ? 1.5 : 1.0);
        break;
      }
      case 'stand': this._move(dt, 0, 0, 0); break;
      case 'board': case 'alight': case 'car':
        // (the interaction poses the body, turning the head to whoever this one looks at)
        this.inter.gaze = this.look || null;
        this.inter.update(dt, null);
        if (this.mode === 'board' && this.inter.seated) this.mode = 'car';
        else if (this.mode === 'board' && !this.inter.st) this.mode = 'stand';            // (gave up: couldn't reach the door)
        else if (this.mode === 'alight' && !this.inter.st) this.mode = 'stand';
        else if (this.mode === 'car' && !this.inter.st) this.mode = 'stand';               // (the car went away)
        this._carry(); return;
    }
    this._pose(dt);
  }

  _follow(dt, L) {
    const s = this.state;
    if (!L) { this._move(dt, 0, 0, 0); return; }
    // the leader's heading (kept while they stand still, so the slot doesn't swing round with every little turn)
    if (L.speed > 0.4 || this.lh === undefined) this.lh = this.lh === undefined ? L.yaw : turn(this.lh, L.yaw, dt * 4);
    const fx = Math.sin(this.lh), fz = Math.cos(this.lh), rx = -Math.cos(this.lh), rz = Math.sin(this.lh);
    const tx = L.x + rx * this.slot[0] + fx * this.slot[1], tz = L.z + rz * this.slot[0] + fz * this.slot[1];
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
    // far behind (a cut, a door, a corner): straight to the slot
    if (d > 30) { this.place(tx, tz, L.yaw); return; }
    let want = d < 0.4 ? 0 : d < 1.6 ? 1.35 : d < 4.5 ? 3.0 : 5.6;
    if (L.speed > 2.5 && d > 0.7) want = Math.max(want, Math.min(6.4, L.speed * (d > 2 ? 1.15 : 1)));
    this._move(dt, dx, dz, want, L);
    if (want === 0) this.face = L.yaw;
  }

  // walk / run toward (dx, dz) at `want` m/s, round obstacles; standing: turn to `face`
  _move(dt, dx, dz, want, L) {
    const s = this.state;
    const d = Math.hypot(dx, dz);
    s.speed += (want - s.speed) * Math.min(1, dt * (want > s.speed ? 5 : 8));
    if (s.speed < 0.05) s.speed = 0;
    if (s.speed > 0 && d > 1e-3) {
      let ux = dx / d, uz = dz / d;
      // the first clear heading near the wanted one (probing a stride ahead), keeping to the side chosen last
      const probe = 0.55 + s.speed * 0.12;
      if (!this._free(s.x + ux * probe, s.z + uz * probe)) {
        let found = false;
        for (const k of [0.45, 0.9, 1.35, 1.8]) {
          for (const sg of [this.side, -this.side]) {
            const a = Math.atan2(ux, uz) + k * sg, vx = Math.sin(a), vz = Math.cos(a);
            if (this._free(s.x + vx * probe, s.z + vz * probe)) { ux = vx; uz = vz; this.side = sg; found = true; break; }
          }
          if (found) break;
        }
        if (!found) s.speed *= 0.5;
      }
      const step = Math.min(s.speed * dt, d);
      s.x += ux * step; s.z += uz * step;
      s.yaw = turn(s.yaw, Math.atan2(ux, uz), dt * (s.speed > 3 ? 7 : 9));
    } else if (this.face !== null && this.face !== undefined) {
      const fy = typeof this.face === 'number' ? this.face : Math.atan2(this.face.x - s.x, this.face.z - s.z);
      s.yaw = turn(s.yaw, fy, dt * 5);
    }
    this._resolve(L);
    s.y = this._ground(s.x, s.z);
  }

  // ------------------------------------------------------------------ the world round them
  _ground(x, z) { return this.game.onFoot._ground(x, z); }
  _free(x, z) {
    const tmp = this._tmp || (this._tmp = []);
    this.game.onFoot._statics(x - 0.6, z - 0.6, x + 0.6, z + 0.6, tmp);
    for (const c of tmp) {
      if (c.h < this.state.y + 0.5) continue;
      const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin, lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos;
      if (Math.abs(lx) < c.hx + RADIUS && Math.abs(lz) < c.hz + RADIUS) return false;
    }
    for (const v of this._cars()) {
      const vs = v.state, c = Math.cos(vs.yaw), sn = Math.sin(vs.yaw), lx = (x - vs.x) * c - (z - vs.z) * sn, lz = (x - vs.x) * sn + (z - vs.z) * c;
      if (Math.abs(lx) < (v.p.width || 1.9) / 2 + RADIUS && Math.abs(lz) < (v.p.length || 4.5) / 2 + RADIUS) return false;
    }
    return true;
  }
  _cars() { const g = this.game; return [g.player, ...g.onFoot.parked].filter((v) => v && !v.gone && Math.abs(v.state.x - this.state.x) < 8 && Math.abs(v.state.z - this.state.z) < 8); }
  // pushed out of walls, furniture and cars; never standing inside the player or each other
  _resolve(L) {
    const s = this.state, tmp = this._tmp || (this._tmp = []);
    this.game.onFoot._statics(s.x - 1, s.z - 1, s.x + 1, s.z + 1, tmp);
    const push = (cx, cz, cos, sin, hx, hz) => {
      const lx = (s.x - cx) * cos - (s.z - cz) * sin, lz = (s.x - cx) * sin + (s.z - cz) * cos;
      const ox = hx + RADIUS - Math.abs(lx), oz = hz + RADIUS - Math.abs(lz);
      if (ox <= 0 || oz <= 0) return;
      let nx = 0, nz = 0;
      if (ox < oz) nx = Math.sign(lx) * ox; else nz = Math.sign(lz) * oz;
      s.x += nx * cos + nz * sin; s.z += -nx * sin + nz * cos;
    };
    for (const c of tmp) if (c.h > s.y + 0.4) push(c.cx, c.cz, c.cos, c.sin, c.hx, c.hz);
    for (const v of this._cars()) push(v.state.x, v.state.z, Math.cos(v.state.yaw), Math.sin(v.state.yaw), (v.p.width || 1.9) / 2, (v.p.length || 4.5) / 2);
    const others = [L, ...(this.mates || []).map((m) => m.state)].filter((o) => o && o !== s);
    for (const o of others) {
      const dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz);
      if (d < 0.62 && d > 1e-4) { s.x += dx / d * (0.62 - d) * 0.6; s.z += dz / d * (0.62 - d) * 0.6; }
    }
  }

  // ------------------------------------------------------------------ the body
  _pose(dt) {
    const s = this.state, g = this.group, h = this.human;
    if (this.inter.st) {
      // (getting in / out: the interaction poses the body; still the gun and bag follow the hands)
      g.position.set(s.x, s.y, s.z); g.rotation.set(0, s.yaw, 0); g.updateMatrixWorld(true);
      h.animate(s.speed, dt);
      return;
    }
    g.position.set(s.x, s.y, s.z); g.rotation.set(0, s.yaw, 0); g.updateMatrixWorld(true);
    h.animate(s.speed, dt);
    const ik = this.ik;
    // the gun held on someone: the right arm points it (the body turns to face them, below the arm's reach)
    if (this.gunOn && this.aimAt && ik) {
      const B = h.B, sh = B.RightArm.getWorldPosition(_a), dir = _b.subVectors(this.aimAt, sh).normalize();
      const L = ik.len.upper + ik.len.fore;
      const hand = sh.clone().addScaledVector(dir, L * 0.95);
      ik.arm(-1, hand, new THREE.Vector3(-dir.z * 0.5, -1, dir.x * 0.5).normalize(), 0.9);
      // the left hand comes across to cup the grip (both hands on it, as they're taught)
      const grip = h.B.RightHand.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.035, 0)).addScaledVector(dir, -0.02);
      ik.arm(1, grip, new THREE.Vector3(dir.z * 0.5, -1, -dir.x * 0.5).normalize(), 0.85);
    }
    const look = typeof this.look === 'function' ? this.look(_lk) : this.look;
    if (look && ik) ik.look(look, 0.6);
    else if (this.aimAt && ik) ik.look(this.aimAt, 0.5);
    this.post?.(this, ik, dt);
    this._carry();
  }

  // the gun in the right hand (along the aim, or pointing down and ahead), the bag in the left
  _carry() {
    const h = this.human, B = h?.B;
    if (!B) return;
    const vis = this.group.visible;
    if (this.gun) {
      this.gun.visible = vis && this.gunOn && !this.inter.st;
      if (this.gun.visible && B.RightHand) {
        const hp = B.RightHand.getWorldPosition(_a), s = this.state;
        const dir = this.aimAt ? _b.subVectors(this.aimAt, hp).normalize() : _b.set(Math.sin(s.yaw), -1.6, Math.cos(s.yaw)).normalize();
        _m.lookAt(_o.set(0, 0, 0), dir.clone().negate(), _up);
        this.gun.quaternion.setFromRotationMatrix(_m);
        this.gun.position.copy(hp).addScaledVector(dir, 0.04);
        this.gun.updateMatrixWorld(true);
      }
    }
    if (this.bag) {
      this.bag.visible = vis && this.bagOn;
      if (this.bag.visible && B.LeftHand) {
        const hp = B.LeftHand.getWorldPosition(_a);
        this.bag.position.copy(hp);
        this.bag.quaternion.setFromAxisAngle(_up, this.state.yaw + Math.PI / 2);
        // (seated: the bag on the lap)
        if (this.inter.seated) { this.bag.position.y -= 0.02; this.bag.quaternion.setFromAxisAngle(_up, this.inter.seated.state.yaw + Math.PI / 2); }
        this.bag.updateMatrixWorld(true);
      }
    }
  }
}
void _q0; void _q1;
