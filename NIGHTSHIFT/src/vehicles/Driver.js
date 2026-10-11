// First-person driver: the rigged rider character (public/assets/models/rider.glb) sat in the driver's
// seat under the cockpit camera, arms reaching the steering wheel with two-bone IK and the fingers
// curled round the rim at ten to two, turning with the wheel. The head is collapsed (the camera is
// inside it) and the helmet hidden; torso, arms and legs are what the driver sees looking down.
// With the realistic arms loaded (public/assets/models/fp_hands.glb, tools/import-hands.mjs) the
// character's own arms fold away and those, in leather riding gloves and jacket sleeves, hold the wheel.
// Car body space: +Z forward, +X left, y up.
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';
import { Rider } from './Rider.js';

const SCALE = 0.95;
const pos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];

// where one hand holds the rim: sd = +1 left hand, -1 right; turn = the wheel's rotation. As driving schools teach
// (and the 'sports grip' of driving games): at a quarter to three, the palm round the outside of the rim, the
// knuckles at its front edge, the fingers wrapped round behind it, the thumb along it towards the top of the
// wheel; the driver sees the backs of the hands from the side and above
function rimHold(W, sd, turn) {
  // push-pull steering: the hands go round with the wheel for a small turn, then the rim slides through them (going
  // hand over hand, an arm swung across the top of the wheel and filled the view)
  const ang = sd * 1.4 + 0.55 * Math.tanh(turn / 0.55);
  const radial = W.up0.clone().multiplyScalar(Math.cos(ang)).addScaledVector(W.right0, -Math.sin(ang));
  const grip = W.hub.clone().addScaledVector(radial, W.R);
  const tang = new THREE.Vector3().crossVectors(W.axis, radial).normalize(); // along the rim
  const knuck = grip.clone().addScaledVector(radial, 0.03).addScaledVector(W.axis, -0.015);
  const wrist = knuck.clone().addScaledVector(W.axis, 0.085).addScaledVector(radial, 0.02);
  // (up the rim, towards the top of the wheel; a little inside it and towards the driver)
  const thumb = W.up0.clone().multiplyScalar(Math.sin(ang)).addScaledVector(W.right0, Math.cos(ang)).multiplyScalar(sd)
    .addScaledVector(radial, -0.35).addScaledVector(W.axis, 0.25);
  return { radial, grip, tang, wrist, knuck, thumb };
}

class Poser {
  constructor() { this.curl = new Map(); } // which way each finger joint curls (found on the first pose)
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

  // a hand on the rim (rimHold): palm on it, thumb along it, fingers wrapped over and round behind it.
  // B: bones by the usual names ('Left' / 'Right' + Hand, HandMiddle1, HandIndex1..4, HandThumb1..4)
  _gripRim(B, S, h, W) {
    if (!B[S + 'HandMiddle1']) return;
    this._aim(B[S + 'Hand'], B[S + 'HandMiddle1'], h.knuck);
    this._twist(B[S + 'Hand'], B[S + 'HandMiddle1'], B[S + 'HandThumb1'], h.thumb);
    // (a rig posed with its fingers already bent: straightened along the hand first)
    if (this.straighten) {
      const dir = pos(B[S + 'HandMiddle1'], new THREE.Vector3()).sub(pos(B[S + 'Hand'], _p)).normalize();
      for (const f of FINGERS) for (let j = 1; j <= 3; j++) {
        const bone = B[S + 'Hand' + f + j], tip = B[S + 'Hand' + f + (j + 1)];
        if (!bone || !tip) break;
        const L = pos(bone, _p).distanceTo(pos(tip, _c));
        this._aim(bone, tip, pos(bone, new THREE.Vector3()).addScaledVector(dir, L));
      }
    }
    // each finger joint curls about the rim's direction, whichever way brings the fingertip round towards the rim
    for (const f of FINGERS) {
      for (let j = 1; j <= 3; j++) {
        const bone = B[S + 'Hand' + f + j], tip = B[S + 'Hand' + f + (j + 1)];
        if (!bone || !tip) break;
        this._curl(bone, tip, h.tang, this.curlAng[j - 1], h.grip);
      }
    }
    // thumb: round the rim from inside (its base too, when the rig's thumb has a tip joint to aim with)
    for (let j = this.thumbFrom || 2; j <= 3; j++) {
      const bone = B[S + 'HandThumb' + j], tip = B[S + 'HandThumb' + (j + 1)];
      if (bone && tip) this._curl(bone, tip, h.radial, this.thumbAng * (j === 1 ? 0.6 : 1), h.grip);
    }
  }
}

export class FPDriver extends Poser {
  // eye: camera position; wheel: { hub, axis (towards the driver), up0, right0, R } (all body space)
  // hands: the realistic arms' template (optional)
  constructor(template, eye, wheel, hands = null) {
    super();
    this.curlAng = [0.9, 1.05, 0.7]; this.thumbAng = 0.5;
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
    this.arms = hands ? new FPArms(hands) : null;
    if (this.arms) this.group.add(this.arms.model);
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
      const S = sd > 0 ? 'Left' : 'Right', h = rimHold(W, sd, turn);
      // the realistic arms hold the wheel: this character's own fold away at the shoulder (out of sight)
      if (this.arms) { B[S + 'Arm'].scale.setScalar(0.001); B[S + 'Arm'].updateWorldMatrix(false, true); continue; }
      const a = pos(B[S + 'Arm'], new THREE.Vector3());
      const l1 = pos(B[S + 'Arm'], _p).distanceTo(pos(B[S + 'ForeArm'], _c)), l2 = pos(B[S + 'ForeArm'], _p).distanceTo(pos(B[S + 'Hand'], _c));
      const elbow = Rider.ik(a, h.wrist, l1, l2, new THREE.Vector3(sd * 0.55, -0.85, -0.1), new THREE.Vector3());
      this._aim(B[S + 'Arm'], B[S + 'ForeArm'], elbow);
      this._aim(B[S + 'ForeArm'], B[S + 'Hand'], h.wrist);
      this._gripRim(B, S, h, W);
    }
    this.arms?.pose(eye, W, turn);
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

// The driver's arms (fp_hands.glb: "Hand With Gloves" by teenjust500, CC BY 4.0): black leather riding gloves
// with hard knuckles, and jacket sleeves, on a named rig: each side (L / R) a shoulder -> upper arm -> forearm ->
// hand -> fingers chain (the thumb three joints, the others four), three twist bones along the forearm. It looks
// down +Z with its left arm on +X, as the car does; its units are inches (scaled to a man's arms here).
const FINGER_BONES = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Pinky: 'pink' };
const ARM_REACH = 0.56; // shoulder to wrist, m

class FPArms extends Poser {
  constructor(template) {
    super();
    this.straighten = true; this.curlAng = [1.05, 1.35, 0.8]; this.thumbAng = 0.3; this.thumbFrom = 1;
    // shoulder (left side; mirrored for the right) from the eyes, and which way the elbows bend
    this.shoulder = new THREE.Vector3(0.22, -0.3, -0.08); this.elbowHint = new THREE.Vector3(0.8, -0.6, -0.1);
    this.model = AssetManager.clone(template);
    const N = {}; this.bones = [];
    this.model.traverse((o) => {
      // (names like upperarm_L.L / hand_L.R: keyed without punctuation, 'upperarmll', 'handlr')
      if (o.isBone) { N[o.name.replace(/_\d+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase()] ||= o; o.userData.rest = o.quaternion.clone(); o.userData.restP = o.position.clone(); this.bones.push(o); }
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
    });
    const B = (this.B = {}), w = (o) => pos(o, new THREE.Vector3());
    this.cam = N.camera; this.tw = {};
    for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
      Object.assign(B, { [S + 'Shoulder']: N['shoulderl' + s], [S + 'Arm']: N['upperarml' + s], [S + 'ForeArm']: N['lowerarml' + s], [S + 'Hand']: N['handl' + s] });
      // each finger down its own chain (the joints' numbering runs either way)
      for (const [F, f] of Object.entries(FINGER_BONES)) {
        let b = N[f + 'l' + s];
        for (let j = 1; b && j <= 4; j++) { B[S + 'Hand' + F + j] = b; b = b.children.find((c) => c.isBone); }
      }
    }
    // to a man's size: shoulder to wrist ARM_REACH
    this.model.updateMatrixWorld(true);
    const reach = w(B.LeftArm).distanceTo(w(B.LeftForeArm)) + w(B.LeftForeArm).distanceTo(w(B.LeftHand));
    this.model.scale.multiplyScalar(ARM_REACH / reach);
    this.model.updateMatrixWorld(true);
    // rest measurements: arm lengths; the upper arm's and forearm's rest frames about the elbow's hinge; where the
    // thumb sits about the forearm (its own frame); each twist bone's share of the forearm's turn (how far down it)
    this.len = {}; this.rest = {};
    const q = (b) => b.getWorldQuaternion(new THREE.Quaternion());
    for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) {
      const [a, f, hd] = [S + 'Arm', S + 'ForeArm', S + 'Hand'].map((n) => w(B[n]));
      const du = f.clone().sub(a), df = hd.clone().sub(f), hinge = du.clone().cross(df);
      this.len[S] = [du.length(), df.length()];
      this.rest[S] = { arm: [q(B[S + 'Arm']), du, hinge], fore: [q(B[S + 'ForeArm']), df, hinge], thumb: w(B[S + 'HandThumb1']).sub(f).applyQuaternion(q(B[S + 'ForeArm']).invert()) };
      this.tw[S] = [1, 2, 3].map((i) => N[`twistarm${i}l${s}`]).filter(Boolean).map((b) => [b, Math.min(1, w(b).sub(f).dot(df) / df.lengthSq())]);
    }
  }
  // turn `bone` so that its rest direction and side (world, the rest pose: [q, d0, r0]) become d1 and r1
  _frame(bone, [q0, d0, r0], d1, r1) {
    const basis = (d, r) => { const x = d.clone().normalize(), y = r.clone().addScaledVector(x, -r.dot(x)).normalize(); return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)); };
    const R = basis(d1, r1).multiply(basis(d0, r0).transpose());
    const qw = new THREE.Quaternion().setFromRotationMatrix(R).multiply(q0);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(qw));
    bone.updateWorldMatrix(false, true);
  }
  _place(bone, p) { bone.position.copy(bone.parent.worldToLocal(p.clone())); bone.updateWorldMatrix(false, true); }

  pose(eye, W, turn) {
    const B = this.B, m = this.model;
    for (const b of this.bones) { b.quaternion.copy(b.userData.rest); b.position.copy(b.userData.restP); }
    m.position.set(0, 0, 0); m.updateMatrixWorld(true);
    if (this.cam) { m.position.copy(eye).sub(pos(this.cam, _p)); m.updateMatrixWorld(true); } // the rig's camera at the eyes
    for (const sd of [1, -1]) {
      const S = sd > 0 ? 'Left' : 'Right', h = rimHold(W, sd, turn), [l1, l2] = this.len[S], R = this.rest[S];
      // shoulder beside and below the eyes (out of sight); brought forward if the wheel is out of reach. The rig's
      // shoulder bone moves there (the sleeve's top with it)
      const sh = eye.clone().add(this.shoulder).setX(eye.x + sd * this.shoulder.x);
      const d = sh.distanceTo(h.wrist), reach = (l1 + l2) * 0.97;
      if (d > reach) sh.lerp(h.wrist, 1 - reach / d);
      this._place(B[S + 'Shoulder'], pos(B[S + 'Shoulder'], new THREE.Vector3()).add(sh).sub(pos(B[S + 'Arm'], _p)));
      const elbow = Rider.ik(sh, h.wrist, l1, l2, this.elbowHint.clone().setX(sd * this.elbowHint.x), new THREE.Vector3());
      // upper arm and forearm framed about the elbow's hinge (no twist at the elbow), the hand on the rim
      const du = elbow.clone().sub(sh), df = h.wrist.clone().sub(elbow), hinge = du.clone().cross(df);
      this._frame(B[S + 'Arm'], R.arm, du, hinge);
      this._frame(B[S + 'ForeArm'], R.fore, df, hinge);
      this._gripRim(B, S, h, W);
      // the forearm turns with the hand: the hand's roll about it (from their rest relation) shared out along the
      // twist bones, so the sleeve and the glove's cuff follow without a candy-wrapper wrist
      const fa = B[S + 'ForeArm'], o = pos(fa, new THREE.Vector3()), ax = df.clone().normalize();
      const cur = R.thumb.clone().applyQuaternion(fa.getWorldQuaternion(_q)), want = pos(B[S + 'HandThumb1'], new THREE.Vector3()).sub(o);
      cur.addScaledVector(ax, -cur.dot(ax)); want.addScaledVector(ax, -want.dot(ax));
      const ang = Math.atan2(ax.dot(_d.crossVectors(cur, want)), cur.dot(want));
      for (const [b, f] of this.tw[S]) this._rotW(b, _qd.setFromAxisAngle(ax, ang * f));
    }
  }
}
