// First-person driver: the rigged rider character (public/assets/models/rider.glb) sat in the driver's
// seat under the cockpit camera, arms reaching the steering wheel with two-bone IK and the fingers
// curled round the rim at ten to two, turning with the wheel. The head is collapsed (the camera is
// inside it) and the helmet hidden; torso, arms and legs are what the driver sees looking down.
// Car body space: +Z forward, +X left, y up.
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';
import { Rider } from './Rider.js';

const SCALE = 0.95;
const pos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

export class FPDriver {
  // eye: camera position; wheel: { hub, axis (towards the driver), up0, right0, R } (all body space)
  constructor(template, eye, wheel) {
    this.eye = eye.clone(); this.wheel = wheel;
    this.group = new THREE.Group(); this.group.name = 'fp_driver'; this.group.visible = false;
    this.model = AssetManager.clone(template);
    this.model.scale.multiplyScalar(SCALE);
    this.group.add(this.model);
    this.B = {};
    this.model.traverse((o) => {
      if (o.isBone) { const n = o.name.replace(/_\d+$/, ''); this.B[n] ||= o; o.userData.rest = o.quaternion.clone(); o.userData.restS = o.scale.clone(); }
      if (o.isMesh) {
        o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false;
        if (/Headwear/i.test(o.material?.name || '')) o.visible = false; // helmet: this is a car
      }
    });
    this.steer = null;
    this.curl = new Map(); // which way each finger joint curls (found on the first pose)
  }
  // rotate `bone` about world `axis` by `th`, the way that brings `tip` closest to `c`
  _curl(bone, tip, axis, th, c) {
    let sgn = this.curl.get(bone);
    if (sgn === undefined) {
      let bd = 1e9;
      for (const s of [1, -1]) {
        const save = bone.quaternion.clone();
        this._rotW(bone, _qd.setFromAxisAngle(axis, th * s));
        const d = pos(tip, _c).distanceTo(c);
        if (d < bd) { bd = d; sgn = s; }
        bone.quaternion.copy(save); bone.updateWorldMatrix(false, true);
      }
      this.curl.set(bone, sgn);
    }
    this._rotW(bone, _qd.setFromAxisAngle(axis, th * sgn));
  }

  // rotate `bone` (children follow) so the joint `tip` moves onto `target`
  _aim(bone, tip, target) {
    bone.updateWorldMatrix(true, false);
    pos(bone, _p); pos(tip, _c);
    _d.subVectors(_c, _p).normalize(); _k.subVectors(target, _p).normalize();
    _qd.setFromUnitVectors(_d, _k);
    this._rotW(bone, _qd);
  }
  // apply a world-space rotation to a bone
  _rotW(bone, qw) {
    bone.getWorldQuaternion(_q).premultiply(qw);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_q));
    bone.updateWorldMatrix(false, true);
  }
  // roll `bone` about its own axis (towards `tip`) so that `ref` points as close to `dir` as possible
  _twist(bone, tip, ref, dir) {
    bone.updateWorldMatrix(true, false);
    const o = pos(bone, new THREE.Vector3()), ax = pos(tip, new THREE.Vector3()).sub(o).normalize();
    const r = pos(ref, new THREE.Vector3()).sub(o);
    r.addScaledVector(ax, -r.dot(ax)).normalize();
    const w = dir.clone().addScaledVector(ax, -dir.dot(ax)).normalize();
    const ang = Math.atan2(ax.dot(_d.crossVectors(r, w)), r.dot(w));
    this._rotW(bone, _qd.setFromAxisAngle(ax, ang));
  }

  pose(steer) {
    if (this.steer !== null && Math.abs(steer - this.steer) < 0.002) return;
    this.steer = steer;
    const B = this.B, g = this.group, W = this.wheel, eye = this.eye;
    const parent = g.parent;
    parent?.remove(g); // pose in the car body's frame
    for (const b of Object.values(B)) { b.quaternion.copy(b.userData.rest); b.scale.copy(b.userData.restS); }
    g.position.set(0, 0, 0); this.model.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    // seated, leaning back ~20 degrees: hips down and behind the eyes
    const head = eye.clone().add(new THREE.Vector3(0, -0.06, -0.12));
    const hip = eye.clone().add(new THREE.Vector3(0, -0.66, -0.26));
    this.model.position.add(hip).sub(pos(B.Hips, _p));
    g.updateMatrixWorld(true);
    this._aim(B.Spine, B.Head, head);
    this.model.position.add(head).sub(pos(B.Head, _p)); // eyes exactly at the camera
    g.updateMatrixWorld(true);
    this._aim(B.Neck, B.HeadTop_End, pos(B.Head, new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0.2)));
    const turn = steer * 2.6; // road-wheel angle -> steering-wheel turn (steer > 0 = left: the top of the wheel goes left)
    for (const sd of [1, -1]) {
      const S = sd > 0 ? 'Left' : 'Right';
      const ang = sd * 1.05 + turn; // ten to two, rotated with the wheel
      const radial = W.up0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(W.right0, -Math.sin(ang));
      const grip = W.hub.clone().addScaledVector(radial, W.R);
      const tang = new THREE.Vector3().crossVectors(W.axis, radial).normalize(); // along the rim
      // wrist in front of the rim and a little inside it; knuckles over the outer edge
      const wrist = grip.clone().addScaledVector(W.axis, 0.075).addScaledVector(radial, -0.035);
      const knuck = grip.clone().addScaledVector(W.axis, 0.012).addScaledVector(radial, 0.03);
      const a = pos(B[S + 'Arm'], new THREE.Vector3());
      const l1 = pos(B[S + 'Arm'], _p).distanceTo(pos(B[S + 'ForeArm'], _c)), l2 = pos(B[S + 'ForeArm'], _p).distanceTo(pos(B[S + 'Hand'], _c));
      const elbow = Rider.ik(a, wrist, l1, l2, new THREE.Vector3(sd * 0.55, -0.85, -0.1), new THREE.Vector3());
      this._aim(B[S + 'Arm'], B[S + 'ForeArm'], elbow);
      this._aim(B[S + 'ForeArm'], B[S + 'Hand'], wrist);
      if (!B[S + 'HandMiddle1']) continue;
      this._aim(B[S + 'Hand'], B[S + 'HandMiddle1'], knuck);
      // thumb side towards the hub, palm onto the rim
      this._twist(B[S + 'Hand'], B[S + 'HandMiddle1'], B[S + 'HandThumb1'], radial.clone().negate().addScaledVector(W.axis, 0.3));
      // fingers wrap over the rim and round behind it: each joint curls about the rim's direction,
      // whichever way brings the fingertip round towards the rim
      for (const f of FINGERS) {
        for (let j = 1; j <= 3; j++) {
          const bone = B[S + 'Hand' + f + j], tip = B[S + 'Hand' + f + (j + 1)];
          if (!bone || !tip) break;
          this._curl(bone, tip, tang, [0.9, 1.05, 0.7][j - 1], grip);
        }
      }
      // thumb: a light curl round the front of the rim
      for (let j = 2; j <= 3; j++) {
        const bone = B[S + 'HandThumb' + j], tip = B[S + 'HandThumb' + (j + 1)];
        if (bone && tip) this._curl(bone, tip, radial, 0.5, grip);
      }
    }
    // legs down to the pedals
    for (const sd of [1, -1]) {
      const S = sd > 0 ? 'Left' : 'Right';
      if (!B[S + 'UpLeg']) continue;
      const h = pos(B[S + 'UpLeg'], new THREE.Vector3());
      const ankle = new THREE.Vector3(h.x + sd * 0.04, h.y - 0.26, h.z + 0.86);
      const l1 = h.distanceTo(pos(B[S + 'Leg'], _c)), l2 = pos(B[S + 'Leg'], _p).distanceTo(pos(B[S + 'Foot'], _c));
      const knee = Rider.ik(h, ankle, l1, l2, new THREE.Vector3(sd * 0.2, 1, 0.2), new THREE.Vector3());
      this._aim(B[S + 'UpLeg'], B[S + 'Leg'], knee);
      this._aim(B[S + 'Leg'], B[S + 'Foot'], ankle);
    }
    // the camera is inside the head: collapse it
    B.Head.scale.setScalar(0.001);
    B.Head.updateWorldMatrix(false, true);
    parent?.add(g);
  }

  dispose() { this.group.removeFromParent(); } // geometry / materials / textures are the template's
}
