// Debris: animated copies of knocked-over street furniture. Lamp posts topple about their base in
// the direction of the hit (rigid rod falling under gravity) and slide a little; small clutter is
// thrown, tumbles, bounces and settles on its side. Pieces stay down until the world restores the
// prop (WorldManager._restoreBroken), or the oldest is recycled when the pool is full.
import * as THREE from 'three';

const G = 9.81;
// resting radius when lying on its side (base-origin models would otherwise sink halfway)
const LIE = { bin: 0.28, hydrant: 0.15, meter: 0.1, bollard: 0.1, cone: 0.1, bench: 0.22 };
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3();

export class Debris {
  constructor(scene, defs, groundAt, max = 40) {
    this.scene = scene;
    this.defs = defs;
    this.groundAt = groundAt;
    this.max = max;
    this.items = [];
  }

  spawn(p, vx, vz, speed) {
    const parts = this.defs[p.type];
    if (!parts) return;
    const g = new THREE.Group();
    for (const part of parts) {
      if (part.emissive) continue; // a knocked-down lamp head goes dark
      const m = new THREE.Mesh(part.geo, part.mat);
      m.castShadow = !!part.shadow;
      g.add(m);
    }
    g.position.set(p.x, p.y, p.z);
    g.rotation.set(0, p.rot, 0);
    this.scene.add(g);
    const sp = Math.max(0.1, Math.hypot(vx, vz));
    const dx = vx / sp, dz = vz / sp;
    const it = { p, g, t: 0, rest: false };
    if (p.type === 'lamp') {
      it.lamp = true;
      it.q0 = g.quaternion.clone();
      it.base = g.position.clone();
      it.axis = new THREE.Vector3(dz, 0, -dx); // up x dir: tips the top toward the push
      it.theta = 0;
      it.omega = 0.35 + speed * 0.045;
      it.slide = new THREE.Vector3(vx * 0.22, 0, vz * 0.22);
    } else {
      const r = () => Math.random() - 0.5;
      it.vel = new THREE.Vector3(vx * (0.75 + Math.random() * 0.35) + r() * 2.5, 1.8 + speed * 0.1 + Math.random() * 2, vz * (0.75 + Math.random() * 0.35) + r() * 2.5);
      it.spin = new THREE.Vector3(r() * 14, r() * 8, r() * 14);
      it.lie = LIE[p.type] ?? 0.15;
    }
    this.items.push(it);
    while (this.items.length > this.max) this._drop(this.items.shift());
  }

  // prop restored by the world: remove its debris
  restore(props) {
    const set = new Set(props);
    this.items = this.items.filter((it) => { if (set.has(it.p)) { this._drop(it); return false; } return true; });
  }

  _drop(it) { this.scene.remove(it.g); }

  update(dt) {
    if (!this.items.length || dt <= 0) return;
    dt = Math.min(dt, 1 / 30);
    for (const it of this.items) {
      if (it.rest) continue;
      it.t += dt;
      const g = it.g;
      if (it.lamp) {
        // rod pivoting at its base: theta'' = 3g/(2L) sin(theta), L ~ 8.4 m
        it.omega += 1.75 * Math.sin(it.theta + 0.04) * dt;
        it.theta += it.omega * dt;
        const flat = 1.5;
        if (it.theta >= flat) {
          it.theta = flat;
          if (it.omega > 0.9) it.omega *= -0.2; // clang: small bounce off the tarmac
          else { it.omega = 0; if (it.slide.lengthSq() < 0.01) it.rest = true; }
        }
        it.slide.multiplyScalar(Math.max(0, 1 - (it.theta >= flat ? 5 : 1.2) * dt));
        it.base.addScaledVector(it.slide, dt);
        g.position.copy(it.base);
        _q.setFromAxisAngle(it.axis, it.theta);
        g.quaternion.copy(it.q0).premultiply(_q);
        continue;
      }
      // thrown clutter
      it.vel.y -= G * dt;
      g.position.addScaledVector(it.vel, dt);
      const w = it.spin.length();
      if (w > 1e-3) { _q.setFromAxisAngle(_v.copy(it.spin).divideScalar(w), w * dt); g.quaternion.premultiply(_q); }
      const ground = this.groundAt(g.position.x, g.position.z) + it.lie * 0.6;
      if (g.position.y < ground) {
        g.position.y = ground;
        if (it.vel.y < -1.6) {
          it.vel.y *= -0.3; it.vel.x *= 0.6; it.vel.z *= 0.6; it.spin.multiplyScalar(0.55);
        } else {
          it.vel.y = 0;
          const f = Math.max(0, 1 - 7 * dt);
          it.vel.x *= f; it.vel.z *= f; it.spin.multiplyScalar(f);
          if (Math.hypot(it.vel.x, it.vel.z) < 0.15 || it.t > 6) this._settle(it);
        }
      }
    }
  }

  // come to rest upright (if it landed that way) or lying on its side, sitting on the ground
  _settle(it) {
    const g = it.g;
    _up.set(0, 1, 0).applyQuaternion(g.quaternion);
    const upright = _up.y > 0.75;
    const target = upright ? _v.set(0, 1, 0) : _v.set(_up.x, 0, _up.z).normalize();
    if (!upright && target.lengthSq() < 0.5) target.set(1, 0, 0);
    _q.setFromUnitVectors(_up, target);
    g.quaternion.premultiply(_q);
    g.position.y = this.groundAt(g.position.x, g.position.z) + (upright ? 0 : it.lie);
    it.rest = true;
  }
}
