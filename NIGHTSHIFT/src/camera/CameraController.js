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

  next() { this.mode = (this.mode + 1) % CAMERA_MODES.length; return CAMERA_MODES[this.mode].name; }
  addShake(a) { this.shake = Math.min(1.5, this.shake + a); }

  snap(vehicle) {
    const s = vehicle.state;
    this.heading = s.yaw;
    const m = CAMERA_MODES[1];
    this.pos.set(s.x - Math.sin(s.yaw) * m.dist, s.y + m.height, s.z - Math.cos(s.yaw) * m.dist);
    this.look.set(s.x, s.y + 1, s.z);
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
    // follow heading blends between car heading and travel direction (drift follow)
    const velHeading = Math.atan2(s.vx, s.vz);
    let target = s.yaw;
    if (speed > 4 && s.speed > 0) {
      let diff = velHeading - s.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      target = s.yaw + diff * 0.55;
    }
    let dh = target - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * (1 - Math.exp(-dt * (s.onGround ? 5.5 : 2)));
    const h = this.heading + this.orbitX + (lookBack ? Math.PI : 0);
    const speedK = clamp(speed / 70, 0, 1);
    const dist = mode.dist * (1 + speedK * 0.12 - (fx.nitro || 0) * 0.06);
    const height = mode.height * (1 + this.orbitY * 0.9) + (s.onGround ? 0 : 0.4);
    // braking dive / acceleration lift (camera reacts to body pitch)
    this.pitchLag = damp(this.pitchLag, s.pitch, 6, dt);
    const desired = _v.set(s.x - Math.sin(h) * dist, s.y + height - this.pitchLag * 2.2, s.z - Math.cos(h) * dist);
    // spring follow (not rigid): stiffer at speed to avoid falling behind
    const k = s.onGround ? 9 + speedK * 6 : 4;
    this.pos.x = damp(this.pos.x, desired.x, k, dt);
    this.pos.z = damp(this.pos.z, desired.z, k, dt);
    this.pos.y = damp(this.pos.y, desired.y, s.onGround ? 7 : 3, dt);
    // keep camera above the ground
    this.pos.y = Math.max(this.pos.y, s.y + 0.7);
    const lookAhead = 2.5 + speedK * 4;
    const lh = this.heading + (lookBack ? Math.PI : 0);
    _t.set(s.x + Math.sin(lh) * lookAhead, s.y + mode.look + (s.onGround ? 0 : 0.3), s.z + Math.cos(lh) * lookAhead);
    this.look.lerp(_t, 1 - Math.exp(-dt * 12));
    cam.position.copy(this.pos);
    // shake: road vibration + impacts
    const vib = speedK * speedK * 0.035 + this.shake * 0.25 + (fx.nitro || 0) * 0.03;
    const t = this.time;
    cam.position.x += (Math.sin(t * 37.1) + Math.sin(t * 21.7)) * 0.5 * vib;
    cam.position.y += (Math.sin(t * 43.3) + Math.sin(t * 17.9)) * 0.5 * vib;
    cam.lookAt(this.look);
    // slight roll into drifts
    cam.rotateZ(clamp(-s.yawRate * 0.02 * speedK, -0.05, 0.05));
    this.shake = damp(this.shake, 0, 4, dt);
    this.fov = damp(this.fov, mode.fov + speedK * 16 + (fx.nitro || 0) * 9, 3.5, dt);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
    if (vehicle.renderer) { const intr = vehicle.renderer.lod0.getObjectByName('interior'); if (intr) intr.visible = true; }
  }
}
