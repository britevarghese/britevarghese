// The driver, a real person (render/DriverAssets.js: "indian man", CC BY 4.0) in the driver's seat. Seated under the
// cab view's eye, the arms reach the steering wheel with two-bone IK and the fingers curl round its rim; the hands go
// round with the wheel and take new grips (render/Hands.js); the legs reach down to the pedals. In the cab view his
// head folds away (the camera is inside it), and so do his arms: gloved ones in jacket sleeves ("Hand With Gloves",
// CC BY 4.0), with more detail close up, hold the wheel instead. The posing is NIGHTSHIFT's (vehicles/Driver.js), in the
// truck body's design frame: +z forward, +x left, y up.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Hands } from './Hands.js';

const HEIGHT = 1.76;                       // m: the man standing
const ARM_REACH = 0.56;                    // m: the gloved arms, shoulder to wrist
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const pos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();
const _id = new THREE.Vector3(), _ik = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();

/** Two-bone IK: the joint between root a and target t (lengths l1, l2), bending toward `hint`. */
function ik(a, t, l1, l2, hint, out) {
  _id.subVectors(t, a);
  const d = clamp(_id.length(), 0.05, l1 + l2 - 1e-3);
  _id.normalize();
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  _ik.copy(hint).addScaledVector(_id, -hint.dot(_id)).normalize();
  return out.copy(a).addScaledVector(_id, l1 * cosA).addScaledVector(_ik, l1 * Math.sqrt(1 - cosA * cosA));
}

/**
 * Where a hand holds the rim: `at` rad round it (0 at the driver's left, pi/2 at the top), sd 1 the left hand and -1
 * the right, lifted off it by `lift` (0..1, taking a new grip). The palm round the outside of the rim, the knuckles at
 * its front edge, the fingers round behind it, the thumb along it toward the top. W: the wheel, { hub, axis (toward the
 * driver), up0 (its top, straight ahead), right0 (the driver's right), R (the rim's radius) }.
 */
function rimHold(W, at, sd, lift) {
  const radial = W.up0.clone().multiplyScalar(Math.sin(at)).addScaledVector(W.right0, -Math.cos(at));
  const grip = W.hub.clone().addScaledVector(radial, W.R - 0.02 * lift).addScaledVector(W.axis, 0.07 * lift);
  const tang = new THREE.Vector3().crossVectors(W.axis, radial).normalize();             // along the rim
  const knuck = grip.clone().addScaledVector(radial, 0.03).addScaledVector(W.axis, -0.015);
  const wrist = knuck.clone().addScaledVector(W.axis, 0.085).addScaledVector(radial, 0.02);
  const thumb = W.right0.clone().multiplyScalar(Math.sin(at)).addScaledVector(W.up0, Math.cos(at)).multiplyScalar(sd)
    .addScaledVector(radial, -0.35).addScaledVector(W.axis, 0.25);
  return { radial, grip, tang, wrist, knuck, thumb };
}

/** Turning bones in world space (here: the truck body's frame), and a hand round the rim. */
class Poser {
  constructor() { this.curl = new Map(); }       // which way each finger joint curls (found on the first pose)

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

  // rotate `bone` (its children with it) so the joint `tip` moves onto `target`
  _aim(bone, tip, target) {
    bone.updateWorldMatrix(true, false);
    pos(bone, _p); pos(tip, _c);
    _d.subVectors(_c, _p).normalize(); _k.subVectors(target, _p).normalize();
    this._rotW(bone, _qd.setFromUnitVectors(_d, _k));
  }

  // apply a world-space rotation to a bone
  _rotW(bone, qw) {
    bone.getWorldQuaternion(_q).premultiply(qw);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_q));
    bone.updateWorldMatrix(false, true);
  }

  // roll `bone` about its own axis (toward `tip`) so that `ref` points as near `dir` as it can
  _twist(bone, tip, ref, dir) {
    bone.updateWorldMatrix(true, false);
    const o = pos(bone, new THREE.Vector3()), ax = pos(tip, new THREE.Vector3()).sub(o).normalize();
    const r = pos(ref, new THREE.Vector3()).sub(o);
    r.addScaledVector(ax, -r.dot(ax)).normalize();
    const w = dir.clone().addScaledVector(ax, -dir.dot(ax)).normalize();
    const ang = Math.atan2(ax.dot(_d.crossVectors(r, w)), r.dot(w));
    this._rotW(bone, _qd.setFromAxisAngle(ax, ang));
  }

  // a hand on the rim (rimHold): palm on it, thumb along it, fingers over and round behind it. B: bones by the usual
  // names ('Left' / 'Right' + Hand, HandMiddle1, HandIndex1..4, HandThumb1..4)
  _gripRim(B, S, h) {
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
    // each finger joint curls about the rim's direction, whichever way brings the fingertip round toward the rim
    for (const f of FINGERS) {
      for (let j = 1; j <= 3; j++) {
        const bone = B[S + 'Hand' + f + j], tip = B[S + 'Hand' + f + (j + 1)];
        if (!bone || !tip) break;
        this._curl(bone, tip, h.tang, this.curlAng[j - 1], h.grip);
      }
    }
    // the thumb round the rim from inside
    for (let j = this.thumbFrom || 2; j <= 3; j++) {
      const bone = B[S + 'HandThumb' + j], tip = B[S + 'HandThumb' + (j + 1)];
      if (bone && tip) this._curl(bone, tip, h.radial, this.thumbAng * (j === 1 ? 0.6 : 1), h.grip);
    }
  }
}

/** The man in the seat (a Mixamo-named rig: Hips, Spine, ..., LeftHandIndex1..3). */
class Man extends Poser {
  constructor(template) {
    super();
    this.curlAng = [0.9, 1.05, 0.7]; this.thumbAng = 0.5;
    this.model = SkeletonUtils.clone(template);
    const B = (this.B = {});
    this.model.traverse((o) => {
      if (o.isBone) B[o.name.replace(/_\d+$/, '')] ||= o;
      // (posed far from its bind pose: never culled by its bind-pose bounds; it lives inside the cab, in its shade)
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; }
    });
    // joints this rig lacks, to aim with: the top of the head, the fingertips (nothing is skinned to them)
    const add = (parent, name, at) => { const b = new THREE.Bone(); b.name = name; b.position.copy(at); parent.add(b); return b; };
    if (B.Head && !B.HeadTop_End) B.HeadTop_End = add(B.Head, 'HeadTop_End', B.Head.position.clone().multiplyScalar(1.8));
    for (const S of ['Left', 'Right']) for (const f of [...FINGERS, 'Thumb']) {
      const j3 = B[S + 'Hand' + f + '3'];
      if (j3 && !B[S + 'Hand' + f + '4']) B[S + 'Hand' + f + '4'] = add(j3, S + 'Hand' + f + '4', j3.position.clone().multiplyScalar(0.8));
    }
    this.bones = [];
    this.model.traverse((o) => { if (o.isBone) { o.userData.rest = o.quaternion.clone(); o.userData.restS = o.scale.clone(); this.bones.push(o); } });
    // to a man's height
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    this.model.scale.multiplyScalar(HEIGHT / (box.max.y - box.min.y));
  }

  /** Seated with his eyes at `eye`; holds: [left, right] (rimHold); seat: the cab view (head and arms folded away). */
  pose(eye, holds, seat, hipZ) {
    const B = this.B, m = this.model;
    for (const b of this.bones) { b.quaternion.copy(b.userData.rest); b.scale.copy(b.userData.restS); }
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    // seated, leaning back against the seat: the hips down and ahead of the eyes (+z is forward), as far as the seat has
    // them (hipZ)
    const head = eye.clone().add(new THREE.Vector3(0, -0.06, -0.12));
    const hip = new THREE.Vector3(eye.x, eye.y - 0.66, hipZ);
    m.position.add(hip).sub(pos(B.Hips, _p));
    m.updateMatrixWorld(true);
    this._aim(B.Spine, B.Head, head);
    m.position.add(head).sub(pos(B.Head, _p));                   // (the eyes where the cab view's camera is)
    m.updateMatrixWorld(true);
    this._aim(B.Neck, B.HeadTop_End, pos(B.Head, new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0.2)));
    for (const [i, sd] of [[0, 1], [1, -1]]) {
      const S = sd > 0 ? 'Left' : 'Right', h = holds[i];
      // in the cab view his arms fold away at the shoulder (the gloved ones hold the wheel)
      if (seat) { B[S + 'Arm'].scale.setScalar(0.001); B[S + 'Arm'].updateWorldMatrix(false, true); continue; }
      const a = pos(B[S + 'Arm'], new THREE.Vector3());
      const l1 = a.distanceTo(pos(B[S + 'ForeArm'], _c)), l2 = pos(B[S + 'ForeArm'], _p).distanceTo(pos(B[S + 'Hand'], _c));
      const elbow = ik(a, h.wrist, l1, l2, new THREE.Vector3(sd * 0.55, -0.85, -0.1), new THREE.Vector3());
      this._aim(B[S + 'Arm'], B[S + 'ForeArm'], elbow);
      this._aim(B[S + 'ForeArm'], B[S + 'Hand'], h.wrist);
      this._gripRim(B, S, h);
    }
    // legs down to the pedals
    for (const sd of [1, -1]) {
      const S = sd > 0 ? 'Left' : 'Right';
      if (!B[S + 'UpLeg']) continue;
      const hp = pos(B[S + 'UpLeg'], new THREE.Vector3());
      const ankle = new THREE.Vector3(hp.x + sd * 0.04, hp.y - 0.26, hp.z + 0.86);
      const l1 = hp.distanceTo(pos(B[S + 'Leg'], _c)), l2 = pos(B[S + 'Leg'], _p).distanceTo(pos(B[S + 'Foot'], _c));
      const knee = ik(hp, ankle, l1, l2, new THREE.Vector3(sd * 0.2, 1, 0.2), new THREE.Vector3());
      this._aim(B[S + 'UpLeg'], B[S + 'Leg'], knee);
      this._aim(B[S + 'Leg'], B[S + 'Foot'], ankle);
    }
    if (seat) { B.Head.scale.setScalar(0.001); B.Head.updateWorldMatrix(false, true); }
  }
}

// The gloved arms (a Blender-named rig: each side L / R a shoulder -> upper arm -> forearm -> hand -> fingers chain,
// the thumb three joints and the others four, three twist bones along the forearm; a `camera` bone at the eyes). It
// looks down +z with its left arm on +x, as the truck does; its units are inches (scaled to a man's arms here).
const FINGER_BONES = { Thumb: 'thumb', Index: 'index', Middle: 'middle', Ring: 'ring', Pinky: 'pink' };

/**
 * The jacket sleeves are about 1.5 times a man's arm across: bulky, filling the view. Their vertices are drawn in
 * toward the arm's bones, in bind space: the upper arm's to 72%, the forearm's from 72% at the elbow to 92% at the cuff
 * (which still has to cover the glove's). Once per geometry (the copies share it).
 */
function slimSleeves(mesh) {
  const g = mesh.geometry;
  if (g.userData.slim) return;
  g.userData.slim = true;
  const sk = mesh.skeleton, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const at = sk.boneInverses.map((m) => new THREE.Vector3().setFromMatrixPosition(m.clone().invert()));
  const key = (b) => b.name.replace(/_\d+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const find = (k) => sk.bones.findIndex((b) => key(b) === k);
  const lines = [], line = new Int8Array(sk.bones.length).fill(-1);
  for (const s of ['l', 'r']) {
    const [u, f, h] = ['upperarml', 'lowerarml', 'handl'].map((n) => find(n + s));
    if (u < 0 || f < 0 || h < 0) continue;
    line[u] = lines.push({ a: at[u], c: at[f], f0: 0.72, f1: 0.72 }) - 1;
    line[f] = lines.push({ a: at[f], c: at[h], f0: 0.72, f1: 0.92 }) - 1;
    sk.bones.forEach((b, i) => { if (key(b).startsWith('twistarm') && key(b).endsWith('l' + s)) line[i] = line[f]; });
  }
  const v = new THREE.Vector3(), d = new THREE.Vector3(), move = new THREE.Vector3(), inv = mesh.bindMatrix.clone().invert();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix);
    move.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = SW.getComponent(i, k), L = lines[line[SI.getComponent(i, k)]];
      if (!w || !L) continue;
      const dir = d.subVectors(L.c, L.a), len = dir.length(); dir.divideScalar(len);
      const t = v.clone().sub(L.a).dot(dir), f = L.f0 + (L.f1 - L.f0) * clamp(t / len, 0, 1);
      move.addScaledVector(v.clone().sub(L.a).addScaledVector(dir, -t), w * (1 - f));
    }
    P.setXYZ(i, ...v.sub(move).applyMatrix4(inv).toArray());
  }
  P.needsUpdate = true;
  g.computeBoundingSphere();
}

/** The gloved arms holding the wheel, in the cab view. */
class Arms extends Poser {
  constructor(template) {
    super();
    this.straighten = true; this.curlAng = [1.05, 1.35, 0.8]; this.thumbAng = 0.3; this.thumbFrom = 1;
    // the shoulder (the left one; mirrored for the right) from the eyes, and which way the elbows bend
    this.shoulder = new THREE.Vector3(0.22, -0.3, -0.08); this.elbowHint = new THREE.Vector3(0.8, -0.6, -0.1);
    this.model = SkeletonUtils.clone(template);
    this.model.traverse((o) => { if (o.isSkinnedMesh && /sleeve/i.test(o.material?.name || '')) slimSleeves(o); });
    const N = {};
    this.bones = [];
    this.model.traverse((o) => {
      // (names like upperarm_L.L and hand_L.R: keyed without punctuation, 'upperarmll', 'handlr')
      if (o.isBone) { N[o.name.replace(/_\d+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase()] ||= o; o.userData.rest = o.quaternion.clone(); o.userData.restP = o.position.clone(); this.bones.push(o); }
      if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; }
    });
    const B = (this.B = {}), w = (o) => pos(o, new THREE.Vector3());
    this.cam = N.camera;
    this.tw = {};
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
    // at rest: the arm's lengths; the upper arm's and forearm's frames about the elbow's hinge; where the thumb sits
    // about the forearm; each twist bone's share of the forearm's turn (how far down it)
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

  // turn `bone` so that its rest direction and side (world, at rest: [q, d0, r0]) become d1 and r1
  _frame(bone, [q0, d0, r0], d1, r1) {
    const basis = (dd, r) => { const x = dd.clone().normalize(), y = r.clone().addScaledVector(x, -r.dot(x)).normalize(); return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)); };
    const R = basis(d1, r1).multiply(basis(d0, r0).transpose());
    const qw = new THREE.Quaternion().setFromRotationMatrix(R).multiply(q0);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(qw));
    bone.updateWorldMatrix(false, true);
  }
  _place(bone, p) { bone.position.copy(bone.parent.worldToLocal(p.clone())); bone.updateWorldMatrix(false, true); }

  /** The hands on the rim (holds: [left, right], rimHold), the shoulders beside and below the eyes. */
  pose(eye, holds) {
    const B = this.B, m = this.model;
    for (const b of this.bones) { b.quaternion.copy(b.userData.rest); b.position.copy(b.userData.restP); }
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    if (this.cam) { m.position.copy(eye).sub(pos(this.cam, _p)); m.updateMatrixWorld(true); }    // (the rig's camera at the eyes)
    for (const [i, sd] of [[0, 1], [1, -1]]) {
      const S = sd > 0 ? 'Left' : 'Right', h = holds[i], [l1, l2] = this.len[S], R = this.rest[S];
      // the shoulder beside and below the eyes (out of sight), brought forward if the wheel is out of reach; the rig's
      // shoulder bone moves there (the sleeve's top with it)
      const sh = eye.clone().add(this.shoulder).setX(eye.x + sd * this.shoulder.x);
      const d = sh.distanceTo(h.wrist), reach = (l1 + l2) * 0.97;
      if (d > reach) sh.lerp(h.wrist, 1 - reach / d);
      this._place(B[S + 'Shoulder'], pos(B[S + 'Shoulder'], new THREE.Vector3()).add(sh).sub(pos(B[S + 'Arm'], _p)));
      const elbow = ik(sh, h.wrist, l1, l2, this.elbowHint.clone().setX(sd * this.elbowHint.x), new THREE.Vector3());
      // the upper arm and the forearm framed about the elbow's hinge (no twist at the elbow), the hand on the rim
      const du = elbow.clone().sub(sh), df = h.wrist.clone().sub(elbow), hinge = du.clone().cross(df);
      this._frame(B[S + 'Arm'], R.arm, du, hinge);
      this._frame(B[S + 'ForeArm'], R.fore, df, hinge);
      this._gripRim(B, S, h);
      // the forearm turns with the hand: the hand's roll about it shared out along the twist bones, so the sleeve and
      // the glove's cuff follow without a twisted wrist
      const fa = B[S + 'ForeArm'], o = pos(fa, new THREE.Vector3()), ax = df.clone().normalize();
      const cur = R.thumb.clone().applyQuaternion(fa.getWorldQuaternion(_q)), want = pos(B[S + 'HandThumb1'], new THREE.Vector3()).sub(o);
      cur.addScaledVector(ax, -cur.dot(ax)); want.addScaledVector(ax, -want.dot(ax));
      const ang = Math.atan2(ax.dot(_d.crossVectors(cur, want)), cur.dot(want));
      for (const [b, f] of this.tw[S]) this._rotW(b, _qd.setFromAxisAngle(ax, ang * f));
    }
  }
}

/**
 * The driver for a truck: assets (render/DriverAssets.js), the steering wheel's group (in the body: its position and
 * rotation, the column's), the rim's radius (m), the driver's eye [x, y, z] (the design frame), how far forward his
 * hips are (z: 28 cm ahead of his eyes in the seats the game builds; spec.hip in a model's own). The same calls as
 * render/Driver.js (drawn instead while the models load): group, update(wheel, dt), setSeatView(on).
 */
export class Person {
  constructor(assets, wheel, rimR, eye, hipZ = eye[2] + 0.28) {
    const q = new THREE.Quaternion().setFromEuler(wheel.rotation);
    this.W = {
      hub: wheel.position.clone(), R: rimR,
      axis: new THREE.Vector3(0, 0, -1).applyQuaternion(q), up0: new THREE.Vector3(0, 1, 0).applyQuaternion(q), right0: new THREE.Vector3(-1, 0, 0).applyQuaternion(q),
    };
    this.eye = new THREE.Vector3(...eye); this.hipZ = hipZ;
    this.hands = new Hands();
    this.group = new THREE.Group();
    this.man = new Man(assets.man);
    this.arms = new Arms(assets.arms);
    this.arms.model.visible = false;
    this.group.add(this.man.model, this.arms.model);
    this.seat = false;
    this.key = '';
    this.update(0, 0);
  }

  /** The cab view: the camera is in his head; the gloved arms hold the wheel. */
  setSeatView(on) {
    if (on === this.seat) return;
    this.seat = on;
    this.arms.model.visible = on;
    this.key = '';
  }

  /** The steering wheel turned to `wheel` (rad about its column), dt s on: posed again when anything moved. */
  update(wheel, dt) {
    this.hands.update(wheel, dt);
    const H = this.hands.hands;
    const key = `${this.seat}|${H[0].at.toFixed(3)},${H[0].lift.toFixed(2)}|${H[1].at.toFixed(3)},${H[1].lift.toFixed(2)}`;
    if (key === this.key) return;
    this.key = key;
    const holds = H.map((h, i) => rimHold(this.W, h.at, i ? -1 : 1, h.lift));
    // posed in the body's frame: out of it meanwhile, its world the body's
    const parent = this.group.parent;
    parent?.remove(this.group);
    this.group.updateMatrixWorld(true);
    this.man.pose(this.eye, holds, this.seat, this.hipZ);
    if (this.seat) this.arms.pose(this.eye, holds);
    parent?.add(this.group);
  }
}
