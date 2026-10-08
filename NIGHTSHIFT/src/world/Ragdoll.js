// A Verlet ragdoll for a rigged character (Mixamo-style bones): particles at the joints, kept apart by the bone
// lengths and a few braces across the torso, falling under gravity onto the ground (with friction) and stopping
// against walls and poles. Each frame the bones are aimed along the particles, so a struck or shot person falls
// and settles limb by limb instead of as one stiff body. Freezes once it has come to rest.
import * as THREE from 'three';

const J = ['Hips', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const I = Object.fromEntries(J.map((n, i) => [n, i]));
// bones (kept at their length) and braces (keep the torso a torso)
const LINKS = [
  ['Hips', 'Spine2'], ['Spine2', 'Head'],
  ['Spine2', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'],
  ['Spine2', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'],
  ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'],
  ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'],
  ['LeftArm', 'RightArm'], ['LeftUpLeg', 'RightUpLeg'], ['LeftArm', 'LeftUpLeg'], ['RightArm', 'RightUpLeg'],
  ['LeftArm', 'RightUpLeg'], ['RightArm', 'LeftUpLeg'], ['Head', 'LeftArm'], ['Head', 'RightArm'],
];
// soft limits: a knee or elbow can't fold its two ends closer than this share of their straight length
const BENDS = [['LeftUpLeg', 'LeftFoot', 0.45], ['RightUpLeg', 'RightFoot', 0.45], ['LeftArm', 'LeftHand', 0.3], ['RightArm', 'RightHand', 0.3], ['Hips', 'Head', 0.75]];
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export class Ragdoll {
  // human: a Human (bones in human.B); v: initial velocity {x, y, z}; spin: rad/s about `axis` (tumble)
  constructor(human, v, spin = 0, axis = null) {
    this.h = human; this.ok = J.every((n) => human.B[n]);
    if (!this.ok) return;
    human.group.updateMatrixWorld(true);
    this.p = J.map((n) => human.B[n].getWorldPosition(new THREE.Vector3()));
    const c = this.p[0].clone();
    // previous positions = current - v*dt (Verlet), plus a tumble about the hips
    const dt = 1 / 60;
    this.q = this.p.map((x) => {
      const o = x.clone().sub(_v.set(v.x, v.y, v.z).multiplyScalar(dt));
      if (spin && axis) { const r = x.clone().sub(c); o.sub(_w.copy(axis).cross(r).multiplyScalar(spin * dt)); }
      return o;
    });
    this.len = LINKS.map(([a, b]) => this.p[I[a]].distanceTo(this.p[I[b]]));
    this.bend = BENDS.map(([a, b, k]) => this.p[I[a]].distanceTo(this.p[I[b]]) * k);
    this.rest = 0; this.still = false; this.landed = false;
  }

  // ground(x, z): the ground height; colliders(x, z): nearby obstacles {cx, cz, hx, hz, cos, sin, h}
  step(dt, ground, colliders) {
    if (!this.ok || this.still) return;
    const n = 2, h = Math.min(dt, 1 / 30) / n, P = this.p, Q = this.q;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < P.length; i++) {
        const p = P[i], q = Q[i];
        const vx = (p.x - q.x) * 0.995, vy = (p.y - q.y) * 0.995, vz = (p.z - q.z) * 0.995;
        q.copy(p);
        p.x += vx; p.y += vy - 9.81 * h * h; p.z += vz;
      }
      for (let it = 0; it < 6; it++) {
        LINKS.forEach(([a, b], k) => this._keep(P[I[a]], P[I[b]], this.len[k], 1));
        BENDS.forEach(([a, b], k) => { const A = P[I[a]], B = P[I[b]], d = A.distanceTo(B); if (d < this.bend[k]) this._keep(A, B, this.bend[k], 1); });
        // the ground (a body is ~10 cm thick) and anything solid
        for (let i = 0; i < P.length; i++) {
          const p = P[i], g = ground(p.x, p.z) + (i === 2 ? 0.1 : 0.06);
          if (p.y < g) {
            p.y = g; this.landed = true;
            // friction: drag the previous position toward this one along the ground
            const q = Q[i]; q.x += (p.x - q.x) * 0.35; q.z += (p.z - q.z) * 0.35;
          }
        }
        if (colliders) for (const c of colliders(P[0].x, P[0].z)) for (const p of P) {
          if ((c.h ?? 99) < p.y + 0.1) continue;
          const dx = p.x - c.cx, dz = p.z - c.cz, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
          const px = c.hx + 0.12 - Math.abs(lx), pz = c.hz + 0.12 - Math.abs(lz);
          if (px <= 0 || pz <= 0) continue;
          if (px < pz) { const sg = Math.sign(lx) || 1; p.x += c.cos * sg * px; p.z -= c.sin * sg * px; }
          else { const sg = Math.sign(lz) || 1; p.x += c.sin * sg * pz; p.z += c.cos * sg * pz; }
        }
      }
    }
    // at rest a while: freeze
    let mv = 0; for (let i = 0; i < P.length; i++) mv = Math.max(mv, P[i].distanceTo(Q[i]));
    if (this.landed && mv < 0.004) { if ((this.rest += dt) > 1.2) this.still = true; } else this.rest = 0;
  }

  _keep(A, B, L, k) {
    _v.subVectors(B, A); const d = _v.length() || 1e-6, e = (d - L) / d * 0.5 * k;
    A.addScaledVector(_v, e); B.addScaledVector(_v, -e);
  }

  get hips() { return this.p[0]; }

  // aim the bones along the particles (the group follows the hips)
  pose(yaw) {
    if (!this.ok) return;
    const h = this.h, B = h.B, P = this.p, g = h.group;
    // the body's frame: hips -> chest is "up", left hip -> right hip is "across"
    const up = _v.subVectors(P[I.Spine2], P[0]).normalize(), across = _w.subVectors(P[I.LeftUpLeg], P[I.RightUpLeg]).normalize();
    const fwd = new THREE.Vector3().crossVectors(across, up).normalize();
    across.crossVectors(up, fwd).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, up, fwd));
    g.updateMatrixWorld(true);
    // put the hips bone on the hips particle
    const hb = B.Hips.getWorldPosition(new THREE.Vector3());
    g.position.add(P[0].clone().sub(hb));
    g.updateMatrixWorld(true);
    const aim = (a, b, t) => h._aim(B[a], B[b], P[I[t]]);
    aim('Spine2', 'Head', 'Head');
    aim('LeftArm', 'LeftForeArm', 'LeftForeArm'); aim('LeftForeArm', 'LeftHand', 'LeftHand');
    aim('RightArm', 'RightForeArm', 'RightForeArm'); aim('RightForeArm', 'RightHand', 'RightHand');
    aim('LeftUpLeg', 'LeftLeg', 'LeftLeg'); aim('LeftLeg', 'LeftFoot', 'LeftFoot');
    aim('RightUpLeg', 'RightLeg', 'RightLeg'); aim('RightLeg', 'RightFoot', 'RightFoot');
    void yaw;
  }
}
