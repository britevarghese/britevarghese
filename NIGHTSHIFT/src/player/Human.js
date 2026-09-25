// Realistic people: rigged, textured characters (public/assets/models/humans, imported by
// tools/import-humans.mjs) that all share one humanoid skeleton, animated procedurally: idle, walk and
// run cycles solved with two-bone IK (feet planted on the ground, knees and elbows bending the right
// way), arm swing, hip bob and sway, and a forward lean when running. Used for the player on foot,
// other players on foot, mission contacts and the pedestrians near the camera.
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';
import { clamp, lerp } from '../core/util.js';

const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const _t = new THREE.Vector3(), _h = new THREE.Vector3(), _e = new THREE.Vector3();
const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);

// joint position for a two-bone chain root a -> target t, lengths l1 / l2, bending toward `hint`
function ik(a, t, l1, l2, hint, out) {
  _d.subVectors(t, a);
  const d = clamp(_d.length(), 0.05, l1 + l2 - 1e-3);
  _d.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  _k.copy(hint).addScaledVector(_d, -hint.dot(_d)).normalize();
  return out.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_k, l1 * Math.sqrt(1 - cosA * cosA));
}

// Loads the people models listed in the manifest (low priority, after the city is up).
export class HumanLibrary {
  constructor(assets, manifest) { this.assets = assets; this.list = manifest?.humans || []; this.models = []; this.ready = false; }
  load(priority = 5) {
    if (this._job) return this._job;
    this._job = Promise.all(this.list.map((h) => this.assets.loadGLTF(`/assets/models/${h.file}`, priority).then((g) => ({ ...h, scene: g.scene })).catch(() => null)))
      .then((ms) => { this.models = ms.filter(Boolean); this.ready = this.models.length > 0; return this; });
    return this._job;
  }
  // a new character; `which` = index or id (defaults to a deterministic pick from a number)
  create(which = 0, opts = {}) {
    if (!this.ready) return null;
    const m = typeof which === 'string' ? this.models.find((x) => x.id === which) || this.models[0] : this.models[((which % this.models.length) + this.models.length) % this.models.length];
    return new Human(m, opts);
  }
}

export class Human {
  constructor(model, { shadow = true, height } = {}) {
    this.id = model.id;
    this.group = new THREE.Group();
    this.group.name = 'human_' + model.id;
    this.root = AssetManager.clone(model.scene);
    this.group.add(this.root);
    this.B = {};
    this.root.traverse((o) => {
      if (o.isBone) { const n = o.name.replace(/_\d+$/, ''); this.B[n] ||= o; o.userData.rest = o.quaternion.clone(); }
      if (o.isMesh) { o.castShadow = shadow; o.frustumCulled = false; }
    });
    // normalise the height (the models are 1.74-1.87 m tall): men ~1.78 m, women ~1.66 m
    this.group.updateMatrixWorld(true);
    const top = wpos(this.B.HeadTop_End, new THREE.Vector3()).y;
    const want = height ?? (model.sex === 'f' ? 1.66 : 1.78);
    this.root.scale.multiplyScalar(want / top);
    this.group.updateMatrixWorld(true);
    // rest measurements in character space
    const B = this.B, L = (a, b) => wpos(a, _p).distanceTo(wpos(b, _c));
    this.hipH = wpos(B.Hips, new THREE.Vector3()).y;
    this.thigh = L(B.LeftUpLeg, B.LeftLeg); this.shin = L(B.LeftLeg, B.LeftFoot);
    this.upper = L(B.LeftArm, B.LeftForeArm); this.fore = L(B.LeftForeArm, B.LeftHand);
    this.ankleH = wpos(B.LeftFoot, new THREE.Vector3()).y;
    this.hipW = Math.abs(wpos(B.LeftUpLeg, new THREE.Vector3()).x);
    this.phase = Math.random() * 6.28;
    this.speedS = 0;
    this.lean = 0;
    this.t = Math.random() * 10;
  }

  _reset() { for (const b of Object.values(this.B)) b.quaternion.copy(b.userData.rest); }

  // rotate `bone` so the joint `tip` moves onto the world point `target` (children follow)
  _aim(bone, tip, target) {
    bone.updateWorldMatrix(true, false);
    wpos(bone, _p); wpos(tip, _c);
    _d.subVectors(_c, _p).normalize(); _k.subVectors(target, _p).normalize();
    _qd.setFromUnitVectors(_d, _k);
    bone.getWorldQuaternion(_q).premultiply(_qd);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_q));
    bone.updateWorldMatrix(false, true);
  }
  // character-space point -> world
  _w(x, y, z, out) { return this.group.localToWorld(out.set(x, y, z)); }

  // speed m/s (ground speed); the caller has placed the group and updated its parents' matrices
  animate(speed, dt) {
    const B = this.B, g = this.group;
    this.t += dt;
    this.speedS = lerp(this.speedS, speed, 1 - Math.exp(-dt * 8));
    const v = this.speedS;
    const run = clamp((v - 2.2) / 2, 0, 1);           // 0 walk .. 1 run
    const move = clamp(v / 0.5, 0, 1);                // 0 idle .. 1 moving
    const cycle = lerp(1.35, 2.3, run);               // metres per full gait cycle (two steps)
    this.phase += (v / cycle) * Math.PI * 2 * dt;
    const ph = this.phase;
    this._reset();
    g.updateMatrixWorld(true);
    // hips: bob twice per cycle, sway toward the stance leg, lean forward when running
    const bob = move * (lerp(0.028, 0.06, run) * Math.cos(2 * ph) - lerp(0.02, 0.07, run));
    const breathe = (1 - move) * Math.sin(this.t * 1.7) * 0.006;
    this.root.position.set(move * Math.sin(ph) * 0.02, bob + breathe, 0);
    this.root.updateMatrixWorld(true);
    // torso: lean forward with speed, counter-rotate a little against the hips
    this.lean = lerp(this.lean, lerp(0.04, 0.2, run) * move, 1 - Math.exp(-dt * 6));
    const hips = wpos(B.Hips, new THREE.Vector3()), neck = wpos(B.Neck, new THREE.Vector3());
    const tl = neck.distanceTo(hips);
    g.worldToLocal(hips);
    this._aim(B.Spine, B.Neck, this._w(hips.x, hips.y + Math.cos(this.lean) * tl, hips.z + Math.sin(this.lean) * tl, _t));
    // head up, looking where we go
    const nk = g.worldToLocal(wpos(B.Neck, new THREE.Vector3()));
    this._aim(B.Neck, B.HeadTop_End, this._w(nk.x, nk.y + 1, nk.z + 0.08 - this.lean * 0.5, _t));
    const stride = cycle / 4;                           // foot travel either side of the hips
    const lift = lerp(0.11, 0.26, run);
    for (const side of [1, -1]) {
      const S = side > 0 ? 'Left' : 'Right';
      const p = ph + (side > 0 ? 0 : Math.PI);
      // legs: the stance foot slides back under the body, the swing foot lifts and reaches forward
      const fz = move * stride * Math.sin(p) + run * 0.08;
      const fy = this.ankleH + move * lift * Math.max(0, Math.cos(p)) ** 1.5;
      const ankle = this._w(side * (this.hipW + 0.01), fy, fz, new THREE.Vector3());
      const hipW = wpos(B[S + 'UpLeg'], new THREE.Vector3());
      const knee = ik(hipW, ankle, this.thigh, this.shin, g.localToWorld(_h.set(side * 0.05, 0, 1)).sub(g.getWorldPosition(_e)), new THREE.Vector3());
      this._aim(B[S + 'UpLeg'], B[S + 'Leg'], knee);
      this._aim(B[S + 'Leg'], B[S + 'Foot'], ankle);
      // foot: flat, toes forward (pointing down a little at toe-off)
      const toe = g.worldToLocal(ankle.clone()).add(new THREE.Vector3(0, -this.ankleH + 0.03 - move * 0.04 * Math.max(0, -Math.sin(p)), 0.14));
      if (B[S + 'ToeBase']) this._aim(B[S + 'Foot'], B[S + 'ToeBase'], this._w(toe.x, toe.y, toe.z, _t));
      // arms: swing opposite to the leg on this side; elbows bend more when running
      const sh = g.worldToLocal(wpos(B[S + 'Arm'], new THREE.Vector3()));
      const swing = -move * lerp(0.32, 0.75, run) * Math.sin(p);
      const reach = (this.upper + this.fore) * lerp(0.97, 0.72, run * move);
      const hand = this._w(sh.x + side * lerp(0.08, 0.04, run), sh.y - Math.cos(swing) * reach, sh.z + Math.sin(swing) * reach + run * 0.12, new THREE.Vector3());
      const shW = wpos(B[S + 'Arm'], new THREE.Vector3());
      const elbow = ik(shW, hand, this.upper, this.fore, g.localToWorld(_h.set(side * 0.35, 0, -1)).sub(g.getWorldPosition(_e)), new THREE.Vector3());
      this._aim(B[S + 'Arm'], B[S + 'ForeArm'], elbow);
      this._aim(B[S + 'ForeArm'], B[S + 'Hand'], hand);
    }
  }

  dispose() { this.group.removeFromParent(); } // geometry/materials/textures are shared with the template
}
