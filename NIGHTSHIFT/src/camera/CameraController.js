// CameraController: cinematic spring-damped chase camera (3 distances) plus bumper, hood and
// cockpit views. Speed-based FOV, road vibration, collision/landing shake, drift follow,
// braking dive / acceleration lift, mouse & right-stick look-around, look-back.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/util.js';

export const CAMERA_MODES = [
  { name: 'Close Chase', dist: 4.9, height: 1.55, look: 0.95, fov: 64 },
  { name: 'Chase', dist: 6.6, height: 2.0, look: 1.0, fov: 62 },
  { name: 'Far Chase', dist: 9.5, height: 2.9, look: 1.1, fov: 58 },
  { name: 'Bumper', marker: 'eye_bumper', fov: 70 },
  { name: 'Hood', marker: 'eye_hood', fov: 68 },
  { name: 'Cockpit', marker: 'eye_cockpit', fov: 72 },
];

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class CameraController {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;
    this.mode = settings.gameplay.defaultCamera ?? 1;
    this.pos = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this.heading = 0;           // smoothed follow heading
    this.shake = 0;             // impulse shake amount
    this.fovBase = 62;
    this.fov = 62;
    this.orbitX = 0; this.orbitY = 0;
    this.time = 0;
    this.pitchLag = 0;
    this.vel = new THREE.Vector3();
    this.cinematic = null;      // {pos, target, t}
  }

  // fraction (0..1) of the camera offset that is free of solid colliders
  _clearance(x, y, z, off) {
    const col = this.world.collision;
    const steps = 12;
    const tmp = this._tmp || (this._tmp = []);
    for (let i = 2; i <= steps; i++) {
      const f = i / steps;
      const px = x + off.x * f, pz = z + off.z * f, py = y + (off.y - 1.3) * f;
      col.query(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4, tmp);
      for (const c of tmp) {
        if (c.kind === 'pole' || c.kind === 'tree' || c.kind === 'rail' || c.kind === 'barrier' || c.h < py) continue;
        const lx = (px - c.cx) * c.cos - (pz - c.cz) * c.sin, lz = (px - c.cx) * c.sin + (pz - c.cz) * c.cos;
        if (Math.abs(lx) <= c.hx + 0.35 && Math.abs(lz) <= c.hz + 0.35) return Math.max(0.3, (i - 1.5) / steps);
      }
    }
    return 1;
  }

  next() { this.mode = (this.mode + 1) % CAMERA_MODES.length; return CAMERA_MODES[this.mode].name; }
  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  snap(vehicle) {
    const s = vehicle.state;
    this.heading = s.yaw;
    const m = CAMERA_MODES[1];
    this.pos.set(s.x - Math.sin(s.yaw) * m.dist, s.y + m.height, s.z - Math.cos(s.yaw) * m.dist);
    this.look.set(s.x, s.y + 1, s.z);
    this.off = null; this.baseY = s.y; this.hVel = 0; this.gLag = 0; this.clear = 1;
  }

  update(dt, vehicle, controls, fx = {}) {
    const cam = this.camera;
    this.time += dt;
    const s = vehicle.state;
    const speed = Math.hypot(s.vx, s.vz);
    const mode = CAMERA_MODES[this.mode];
    // look-around (mouse drag / right stick), eases back when released
    if (controls.mouseLook || Math.abs(controls.lookX) > 0.01 || Math.abs(controls.lookY) > 0.01) {
      this.orbitX = clamp(this.orbitX + controls.lookX * (controls.mouseLook ? 1 : dt * 3), -Math.PI, Math.PI);
      this.orbitY = clamp(this.orbitY + controls.lookY * (controls.mouseLook ? 1 : dt * 2), -0.35, 0.6);
      this.lookIdle = 0;
    } else {
      this.lookIdle = (this.lookIdle || 0) + dt;
      if (this.lookIdle > 0.6) { this.orbitX = damp(this.orbitX, 0, 3, dt); this.orbitY = damp(this.orbitY, 0, 3, dt); }
    }
    const lookBack = controls.lookBack;

    if (this.cinematic) {
      const c = this.cinematic;
      c.t += dt;
      const a = c.t * 0.25;
      _v.set(s.x + Math.sin(a) * c.r, s.y + c.h, s.z + Math.cos(a) * c.r);
      this.pos.lerp(_v, 1 - Math.exp(-dt * 3));
      cam.position.copy(this.pos);
      cam.lookAt(s.x, s.y + 0.8, s.z);
      this.fov = damp(this.fov, 50, 3, dt);
      cam.fov = this.fov; cam.updateProjectionMatrix();
      return;
    }

    if (mode.marker && vehicle.renderer) {
      // attached views follow the sprung body (pitch/roll) with light smoothing
      const mk = vehicle.renderer.markers[mode.marker];
      vehicle.renderer.body.updateMatrixWorld(true);
      if (mk) {
        _v.copy(mk.position);
        if (lookBack) _v.z = mode.marker === 'eye_bumper' ? -_v.z : _v.z;
        _v.applyMatrix4(vehicle.renderer.body.matrixWorld);
        cam.position.copy(_v);
        vehicle.renderer.body.getWorldQuaternion(_q);
        cam.quaternion.copy(_q);
        cam.rotateY(Math.PI + (lookBack ? Math.PI : 0) + this.orbitX);
        cam.rotateX(-this.orbitY * 0.5);
        // vibration
        const vib = Math.min(1, speed / 60) * 0.004 + this.shake * 0.02;
        cam.position.x += (Math.random() - 0.5) * vib; cam.position.y += (Math.random() - 0.5) * vib;
        vehicle.renderer.lod0.getObjectByName('interior') && (vehicle.renderer.lod0.getObjectByName('interior').visible = mode.marker === 'eye_cockpit');
      }
      this.fov = damp(this.fov, mode.fov + Math.min(14, speed * 0.16) + (fx.nitro || 0) * 8, 4, dt);
      this.shake = damp(this.shake, 0, 5, dt);
      cam.fov = this.fov; cam.near = 0.05; cam.updateProjectionMatrix();
      this.pos.copy(cam.position);
      return;
    }
    cam.near = 0.2;
    // --- chase camera ---
    // The camera offset is smoothed in car-relative space, so at constant speed the car stays put
    // in the frame (no ever-growing positional lag); rotation follows through a critically damped
    // angular spring, and g-forces nudge the distance (accel pulls back, braking pushes in).
    const velHeading = Math.atan2(s.vx, s.vz);
    let target = s.yaw;
    if (speed > 4 && s.speed > 0) {
      let diff = velHeading - s.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      target = s.yaw + diff * (s.drifting ? 0.62 : 0.4); // swing out to show the drift angle
    }
    let dh = target - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    const wH = s.onGround ? 6.5 : 2.5;
    this.hVel = (this.hVel || 0) + (wH * wH * dh - 2 * wH * (this.hVel || 0)) * dt;
    this.heading += this.hVel * dt;
    const h = this.heading + this.orbitX + (lookBack ? Math.PI : 0);
    const sk = clamp(speed / 75, 0, 1);
    const ease = sk * sk * (3 - 2 * sk);
    const nitro = fx.nitro || 0;
    const ax = vehicle.physics?.axPrev || 0;
    this.gLag = damp(this.gLag || 0, clamp(ax * 0.07, -0.55, 0.7), 3.5, dt);
    // bikes: a closer, lower chase that ignores wheelies (the bike pitches, not the view)
    const bike = !!vehicle.physics?.p.bike;
    const dist = mode.dist * (bike ? 0.72 : 1) * (1 + 0.08 * ease) + this.gLag + nitro * 0.45;
    this.pitchLag = damp(this.pitchLag, bike ? 0 : s.pitch, 6, dt);
    const height = mode.height * (bike ? 0.8 : 1) * (1 + this.orbitY * 0.9) - this.pitchLag * 1.6 + (s.onGround ? 0 : 0.35);
    // desired offset from the car, smoothed (no lag at constant velocity)
    const ox = -Math.sin(h) * dist, oz = -Math.cos(h) * dist;
    if (!this.off) this.off = new THREE.Vector3(ox, height, oz);
    this.off.x = damp(this.off.x, ox, 12, dt); this.off.z = damp(this.off.z, oz, 12, dt); this.off.y = damp(this.off.y, height, 6, dt);
    // vertical follow is softer so suspension bounce doesn't shake the whole view
    this.baseY = this.baseY === undefined ? s.y : damp(this.baseY, s.y, s.onGround ? 7 : 2.5, dt);
    // camera collision: pull in when a building/wall blocks the line from the car to the camera
    let k = 1;
    if (this.world) k = this._clearance(s.x, this.baseY + 1.3, s.z, this.off);
    this.clear = damp(this.clear ?? 1, k, k < (this.clear ?? 1) ? 25 : 4, dt);
    this.pos.set(s.x + this.off.x * this.clear, Math.max(this.baseY + this.off.y * (0.6 + 0.4 * this.clear), s.y + 0.6), s.z + this.off.z * this.clear);
    const lookAhead = 3 + 8 * ease;
    const lh = this.heading + (lookBack ? Math.PI : 0);
    _t.set(s.x + Math.sin(lh) * lookAhead, this.baseY + mode.look + 0.35 + (s.onGround ? 0 : 0.25), s.z + Math.cos(lh) * lookAhead);
    this.look.lerp(_t, 1 - Math.exp(-dt * 14));
    cam.position.copy(this.pos);
    // shake: fine road vibration that grows with speed + low-frequency sway + impacts
    const t = this.time;
    const vib = ease * ease * 0.02 + this.shake * 0.22 + nitro * 0.02;
    cam.position.x += (Math.sin(t * 37.1) + Math.sin(t * 23.3)) * 0.5 * vib + Math.sin(t * 1.3) * 0.02 * ease;
    cam.position.y += (Math.sin(t * 43.3) + Math.sin(t * 19.7)) * 0.5 * vib + Math.sin(t * 0.9) * 0.015 * ease;
    cam.lookAt(this.look);
    // slight roll into turns/drifts
    const rollT = bike ? clamp(-s.roll * 0.14, -0.12, 0.12) : clamp(-s.yawRate * 0.025 * ease - (s.drifting ? Math.sign(s.yawRate) * 0.02 : 0), -0.06, 0.06);
    this.roll = damp(this.roll || 0, rollT, 4, dt);
    cam.rotateZ(this.roll);
    this.shake = damp(this.shake, 0, 4, dt);
    this.fov = damp(this.fov, mode.fov + ease * 13 + nitro * 7, 3.5, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    if (vehicle.renderer) { const intr = vehicle.renderer.lod0.getObjectByName('interior'); if (intr) intr.visible = true; }
  }
}
