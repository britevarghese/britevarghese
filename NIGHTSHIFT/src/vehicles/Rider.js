// Motorcycle rider, posed with two-bone IK onto the bike's seat, handlebars and footpegs. The pose
// comes from the bike's real wheelbase / seat height and its riding style (sport: crouched onto
// clip-ons, cruiser: upright with mid controls) and tucks in at speed.
// SkinnedRider bends the bones of a rigged, textured character (public/assets/models/rider.glb,
// imported by tools/import-rider.mjs); Rider is a simple built-in figure used if that model is missing.
// Bike space: +Z forward, +X left, y = 0 on the ground.
import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';
import { AssetManager } from '../assets/AssetManager.js';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _k = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qd = new THREE.Quaternion();

// seat / bars / pegs relative to the rear axle (z) and the ground (y); w = half width
const STYLE = {
  sport: { hipZ: 0.33, barsBack: 0.44, barsY: 0.1, barsW: 0.31, pegBack: 0.22, pegY: 0.37, pegW: 0.17, torso: 0.62, tuck: 0.3, neck: 0.12 },
  cruiser: { hipZ: 0.36, barsBack: 0.46, barsY: 0.36, barsW: 0.4, pegBack: -0.3, pegY: 0.3, pegW: 0.24, torso: 1.35, tuck: 1.2, neck: 0.16 },
};
const THIGH = 0.45, SHIN = 0.46, UPPER = 0.31, FORE = 0.3, TORSO = 0.52;

// where the rider's joints go on this bike: hips on the seat, shoulders along the torso line, wrists
// on the grips, feet on the pegs, plus the direction elbows and knees bend
function poseTargets(c, bk, tuck) {
  const wb = bk.zF - bk.zR;
  const hip = new THREE.Vector3(0, bk.seat + 0.1, bk.zR + c.hipZ * wb);
  const ang = lerp(c.torso, c.tuck, tuck); // torso angle above horizontal, lower when tucked
  const sh = new THREE.Vector3(0, Math.sin(ang) * TORSO, Math.cos(ang) * TORSO).add(hip);
  const out = { hip, sh, ang, side: {} };
  for (const side of [1, -1]) {
    out.side[side] = {
      grip: new THREE.Vector3(side * c.barsW, bk.seat + c.barsY, bk.zF - c.barsBack),
      elbowHint: new THREE.Vector3(side * 0.7, -0.7, -0.2),
      peg: new THREE.Vector3(side * c.pegW, c.pegY, hip.z - c.pegBack),
      kneeHint: new THREE.Vector3(side * 0.35, 0.3, 1),
    };
  }
  return out;
}

export class Rider {
  // bike: { zF, zR (wheel centres), seat (seat height m), style, suit colour }
  constructor(bike, shadow = false) {
    this.cfg = { ...STYLE[bike.style] || STYLE.sport, ...(bike.rider || {}) };
    this.bike = bike;
    this.group = new THREE.Group();
    this.group.name = 'rider';
    const suit = new THREE.MeshStandardMaterial({ color: bike.suit ?? 0x16181d, roughness: 0.55, metalness: 0.1 });
    const accent = new THREE.MeshStandardMaterial({ color: bike.accent ?? 0xb3121f, roughness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.7 });
    const helmet = new THREE.MeshPhysicalMaterial({ color: bike.helmet ?? 0x1c1f26, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    const visor = new THREE.MeshPhysicalMaterial({ color: 0x050608, roughness: 0.05, metalness: 0.9 });
    this.mats = [suit, accent, black, helmet, visor];
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0); // unit bone along +Y
    const ball = new THREE.SphereGeometry(1, 12, 8);
    this.geos = [cyl, ball];
    const add = (geo, mat, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.castShadow = shadow; this.group.add(m); return m; };
    const bone = (r, mat) => ({ mesh: add(cyl, mat, r, 1, r), r });
    this.bones = {
      thighL: bone(0.095, suit), thighR: bone(0.095, suit), shinL: bone(0.07, suit), shinR: bone(0.07, suit),
      upperL: bone(0.065, accent), upperR: bone(0.065, accent), foreL: bone(0.055, suit), foreR: bone(0.055, suit),
      spine: bone(0.17, suit), neck: bone(0.055, black),
    };
    this.balls = {
      hips: add(ball, suit, 0.18, 0.13, 0.17), kneeL: add(ball, suit, 0.08, 0.08, 0.08), kneeR: add(ball, suit, 0.08, 0.08, 0.08),
      shoulders: add(ball, accent, 0.21, 0.11, 0.14), handL: add(ball, black, 0.055, 0.05, 0.07), handR: add(ball, black, 0.055, 0.05, 0.07),
      bootL: add(ball, black, 0.055, 0.06, 0.14), bootR: add(ball, black, 0.055, 0.06, 0.14),
    };
    this.head = new THREE.Group();
    const shell = new THREE.Mesh(ball, helmet); shell.scale.set(0.15, 0.155, 0.17); shell.castShadow = shadow;
    // visor: a band of the shell facing forward (+Z is phi = pi/2 in SphereGeometry)
    const vis = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, Math.PI / 2 - 0.9, 1.8, 1.05, 0.7), visor);
    vis.scale.set(0.152, 0.157, 0.172);
    this.head.add(shell, vis);
    this.group.add(this.head);
    this.tuck = 0;
    this.pose(0);
  }

  // place a unit bone between a and b
  _bone(b, a, c) {
    _d.subVectors(c, a);
    const len = _d.length();
    b.mesh.position.copy(a);
    b.mesh.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / (len || 1)));
    b.mesh.scale.set(b.r, len, b.r);
  }

  // two-bone IK: joint position for root a -> target t with lengths l1, l2, bending toward `hint`
  static ik(a, t, l1, l2, hint, out) {
    _d.subVectors(t, a);
    const d = clamp(_d.length(), 0.05, l1 + l2 - 1e-3);
    _d.normalize();
    const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    // bend direction: hint projected perpendicular to the a->t axis
    _k.copy(hint).addScaledVector(_d, -hint.dot(_d)).normalize();
    return out.copy(a).addScaledVector(_d, l1 * cosA).addScaledVector(_k, l1 * Math.sqrt(1 - cosA * cosA));
  }

  // tuck 0 (cruising) .. 1 (flat on the tank at top speed)
  pose(tuck) {
    this.tuck = tuck;
    const c = this.cfg, bk = this.bike;
    const T = poseTargets(c, bk, tuck);
    const hipP = T.hip, sh = T.sh, ang = T.ang;
    this._bone(this.bones.spine, hipP, sh);
    this.balls.hips.position.copy(hipP);
    this.balls.shoulders.position.copy(sh);
    // head: forward of the shoulders, looking up the road
    const hd = new THREE.Vector3(0, c.neck, 0.09).add(sh);
    this._bone(this.bones.neck, sh, hd);
    this.head.position.copy(hd).add(new THREE.Vector3(0, 0.04, 0.03));
    this.head.rotation.x = -(Math.PI / 2 - ang) * 0.35;
    this.eye = this.head.position.clone().add(new THREE.Vector3(0, 0.02, 0.1));
    for (const side of [1, -1]) {
      const L = side > 0 ? 'L' : 'R';
      // arms: shoulder -> grip, elbows out and down
      const shoulder = sh.clone().add(new THREE.Vector3(side * 0.19, -0.02, 0));
      const { grip, elbowHint, peg: foot, kneeHint } = T.side[side];
      const elbow = Rider.ik(shoulder, grip, UPPER, FORE, elbowHint, new THREE.Vector3());
      this._bone(this.bones['upper' + L], shoulder, elbow);
      this._bone(this.bones['fore' + L], elbow, grip);
      this.balls['hand' + L].position.copy(grip);
      // legs: hip -> footpeg, knees forward and out (gripping the tank)
      const h = hipP.clone().add(new THREE.Vector3(side * 0.1, 0, 0));
      const knee = Rider.ik(h, foot, THIGH, SHIN, kneeHint, new THREE.Vector3());
      this._bone(this.bones['thigh' + L], h, knee);
      this._bone(this.bones['shin' + L], knee, foot);
      this.balls['knee' + L].position.copy(knee);
      this.balls['boot' + L].position.copy(foot).add(new THREE.Vector3(0, 0, 0.05));
    }
  }

  update(speedKmh) {
    const t = clamp((speedKmh - 90) / 110, 0, 1);
    if (Math.abs(t - this.tuck) > 0.02) this.pose(lerp(this.tuck, t, 0.15));
  }

  setVisible(on) { this.group.visible = on; }
  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); this.head.children[1].geometry.dispose(); }
}

// ---------------------------------------------------------------------------------- rigged rider
const RIDER_SCALE = 0.95; // the model is 1.87 m tall: a 1.78 m rider
const bodyPos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);

export class SkinnedRider {
  constructor(bike, shadow, template) {
    this.cfg = { ...STYLE[bike.style] || STYLE.sport, ...(bike.rider || {}) };
    this.bike = bike;
    this.group = new THREE.Group();
    this.group.name = 'rider';
    this.model = AssetManager.clone(template);
    this.model.scale.multiplyScalar(RIDER_SCALE);
    this.group.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) { const n = o.name.replace(/_\d+$/, ''); this.bones[n] ||= o; o.userData.rest = o.quaternion.clone(); }
      if (o.isMesh) { o.castShadow = shadow; o.frustumCulled = false; } // the posed rider leaves the rest-pose bounds
    });
    this.tuck = 0;
    this.pose(0);
  }

  // rotate `bone` (keeping its children attached) so the joint `tip` moves onto `target`
  _aim(bone, tip, target) {
    bone.updateWorldMatrix(true, false);
    bodyPos(bone, _p); bodyPos(tip, _c);
    _d.subVectors(_c, _p).normalize(); _k.subVectors(target, _p).normalize();
    _qd.setFromUnitVectors(_d, _k);
    bone.getWorldQuaternion(_q).premultiply(_qd);
    bone.parent.getWorldQuaternion(_qp).invert();
    bone.quaternion.copy(_qp.multiply(_q));
    bone.updateWorldMatrix(false, true);
  }
  _len(a, b) { return bodyPos(a, _p).distanceTo(bodyPos(b, _c)); }

  pose(tuck) {
    this.tuck = tuck;
    const B = this.bones, g = this.group;
    const parent = g.parent;
    parent?.remove(g); // pose in bike space: the group's own frame is the bike's
    for (const b of Object.values(B)) b.quaternion.copy(b.userData.rest);
    g.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const T = poseTargets(this.cfg, this.bike, tuck);
    // hips onto the seat
    g.position.add(T.hip).sub(bodyPos(B.Hips, _p));
    g.updateMatrixWorld(true);
    // torso leans along the hip -> shoulder line, head up looking down the road
    this._aim(B.Spine, B.Neck, T.sh);
    const neckP = bodyPos(B.Neck, new THREE.Vector3());
    this._aim(B.Neck, B.HeadTop_End, neckP.add(new THREE.Vector3(0, 1, 0.35 + (1 - Math.sin(T.ang)) * 0.4)));
    for (const side of [1, -1]) {
      const S = side > 0 ? 'Left' : 'Right', t = T.side[side];
      // arms: wrists just behind the grips, elbows out and down
      const wrist = t.grip.clone().add(new THREE.Vector3(0, 0.01, -0.07));
      const a = bodyPos(B[S + 'Arm'], new THREE.Vector3());
      const elbow = Rider.ik(a, wrist, this._len(B[S + 'Arm'], B[S + 'ForeArm']), this._len(B[S + 'ForeArm'], B[S + 'Hand']), t.elbowHint, new THREE.Vector3());
      this._aim(B[S + 'Arm'], B[S + 'ForeArm'], elbow);
      this._aim(B[S + 'ForeArm'], B[S + 'Hand'], wrist);
      if (B[S + 'HandMiddle1']) this._aim(B[S + 'Hand'], B[S + 'HandMiddle1'], wrist.clone().add(new THREE.Vector3(0, -0.03, 0.1)));
      // legs: ankle over the peg, knees forward and out against the tank
      const ankle = t.peg.clone().add(new THREE.Vector3(0, 0.07, -0.07));
      const h = bodyPos(B[S + 'UpLeg'], new THREE.Vector3());
      const knee = Rider.ik(h, ankle, this._len(B[S + 'UpLeg'], B[S + 'Leg']), this._len(B[S + 'Leg'], B[S + 'Foot']), t.kneeHint, new THREE.Vector3());
      this._aim(B[S + 'UpLeg'], B[S + 'Leg'], knee);
      this._aim(B[S + 'Leg'], B[S + 'Foot'], ankle);
      if (B[S + 'ToeBase']) this._aim(B[S + 'Foot'], B[S + 'ToeBase'], ankle.clone().add(new THREE.Vector3(0, -0.07, 0.13)));
    }
    this.eye = bodyPos(B.Head, new THREE.Vector3()).add(new THREE.Vector3(0, 0.06, 0.12));
    parent?.add(g);
  }

  update(speedKmh) {
    const t = clamp((speedKmh - 90) / 110, 0, 1);
    if (Math.abs(t - this.tuck) > 0.04) this.pose(lerp(this.tuck, t, 0.3));
  }

  setVisible(on) { this.group.visible = on; }
  dispose() { this.group.removeFromParent(); } // geometry, materials and textures are shared with the template
}
