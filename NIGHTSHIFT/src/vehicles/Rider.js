// Motorcycle rider: a helmeted figure whose limbs are posed with two-bone IK onto the bike's seat,
// handlebars and footpegs. The pose comes from the bike's real wheelbase / seat height and its riding
// style (sport: crouched onto clip-ons, cruiser: upright with mid controls) and tucks in at speed.
// Bike space: +Z forward, +X left, y = 0 on the ground.
import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3();

// seat / bars / pegs relative to the rear axle (z) and the ground (y); w = half width
const STYLE = {
  sport: { hipZ: 0.36, barsBack: 0.44, barsY: 0.1, barsW: 0.31, pegBack: 0.2, pegY: 0.37, pegW: 0.17, torso: 0.72, tuck: 0.34, head: 0.32 },
  cruiser: { hipZ: 0.36, barsBack: 0.46, barsY: 0.36, barsW: 0.4, pegBack: -0.3, pegY: 0.3, pegW: 0.24, torso: 1.35, tuck: 1.2, head: 0.1 },
};
const THIGH = 0.45, SHIN = 0.46, UPPER = 0.31, FORE = 0.3, TORSO = 0.56;

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
      thighL: bone(0.085, suit), thighR: bone(0.085, suit), shinL: bone(0.065, suit), shinR: bone(0.065, suit),
      upperL: bone(0.058, suit), upperR: bone(0.058, suit), foreL: bone(0.05, accent), foreR: bone(0.05, accent),
      spine: bone(0.16, suit), neck: bone(0.05, black),
    };
    this.balls = {
      hips: add(ball, suit, 0.17, 0.12, 0.15), kneeL: add(ball, suit, 0.08, 0.08, 0.08), kneeR: add(ball, suit, 0.08, 0.08, 0.08),
      shoulders: add(ball, suit, 0.2, 0.1, 0.12), handL: add(ball, black, 0.055, 0.05, 0.07), handR: add(ball, black, 0.055, 0.05, 0.07),
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
    const c = this.cfg, bk = this.bike, wb = bk.zF - bk.zR;
    const hip = _a.set(0, bk.seat + 0.1, bk.zR + c.hipZ * wb);
    const hipP = hip.clone();
    // torso: angle above horizontal, lower when tucked
    const ang = lerp(c.torso, c.tuck, tuck);
    const sh = new THREE.Vector3(0, Math.sin(ang) * TORSO, Math.cos(ang) * TORSO).add(hipP);
    this._bone(this.bones.spine, hipP, sh);
    this.bones.spine.mesh.scale.z = 0.12;
    this.balls.hips.position.copy(hipP);
    this.balls.shoulders.position.copy(sh);
    // head: forward of the shoulders, looking up the road
    const hd = new THREE.Vector3(0, 0.2 - tuck * 0.04, c.head * 0.3 + 0.08).add(sh);
    this._bone(this.bones.neck, sh, hd);
    this.head.position.copy(hd).add(new THREE.Vector3(0, 0.06, 0.02));
    this.head.rotation.x = -(Math.PI / 2 - ang) * 0.35;
    this.eye = this.head.position.clone().add(new THREE.Vector3(0, 0.02, 0.1));
    for (const side of [1, -1]) {
      const L = side > 0 ? 'L' : 'R';
      // arms: shoulder -> grip, elbows out and down
      const shoulder = sh.clone().add(new THREE.Vector3(side * 0.19, -0.02, 0));
      const grip = new THREE.Vector3(side * c.barsW, bk.seat + c.barsY, bk.zF - c.barsBack);
      const elbow = Rider.ik(shoulder, grip, UPPER, FORE, new THREE.Vector3(side * 0.7, -0.7, -0.2), new THREE.Vector3());
      this._bone(this.bones['upper' + L], shoulder, elbow);
      this._bone(this.bones['fore' + L], elbow, grip);
      this.balls['hand' + L].position.copy(grip);
      // legs: hip -> footpeg, knees forward and out (gripping the tank)
      const h = hipP.clone().add(new THREE.Vector3(side * 0.1, 0, 0));
      const foot = new THREE.Vector3(side * c.pegW, c.pegY, hipP.z - c.pegBack);
      const knee = Rider.ik(h, foot, THIGH, SHIN, new THREE.Vector3(side * 0.35, 0.3, 1), new THREE.Vector3());
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

  dispose() { for (const g of this.geos) g.dispose(); for (const m of this.mats) m.dispose(); this.head.children[1].geometry.dispose(); }
}
