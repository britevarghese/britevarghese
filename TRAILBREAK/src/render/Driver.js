// The driver: a figure in the driver's seat (a short-sleeved shirt, driving gloves) with hands on the steering wheel. The hands turn with the wheel and go
// hand over hand (render/Hands.js); the arms reach them from the shoulders (two-bone IK, the elbows down and out); the
// head is where the driver's-seat camera is (hidden in that view, the arms and hands in front of it). Built in the
// body's design frame from the wheel (its group: centre, column tilt and yaw; the rim's radius) and the driver's eye.
import * as THREE from 'three';
import { Hands } from './Hands.js';

const UPPER = 0.3, FORE = 0.27, HAND = 0.075;    // m: shoulder to elbow, elbow to wrist, wrist to the middle of the fist
const COMFY = 0.9 * (UPPER + FORE);                 // (shoulder to wrist with the elbows a little bent)
const TORSO = [0.16, 0.3];                          // the torso's capsule: radius, length between its round ends

let G = null, M = null;
function shared() {
  if (G) return;
  const cap = (r, h) => new THREE.CapsuleGeometry(r, h, 4, 10);
  // a limb: round ends of radius r0 (at -len/2) and r1 (at +len/2) along y, tapering between
  const limb = (r0, r1, len) => {
    const pts = [];
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 * (k / 4 - 1); pts.push(new THREE.Vector2(r0 * Math.cos(a), -len / 2 + r0 * Math.sin(a))); }
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 * (k / 4); pts.push(new THREE.Vector2(Math.max(0, r1 * Math.cos(a)), len / 2 + r1 * Math.sin(a))); }
    return new THREE.LatheGeometry(pts, 12);
  };
  G = {
    upper: limb(0.046, 0.039, UPPER), sleeve: limb(0.056, 0.05, 0.55 * UPPER), fore: limb(0.04, 0.028, FORE),
    hand: limb(0.03, 0.032, HAND), fist: cap(0.034, 0.05), cuff: new THREE.CylinderGeometry(0.036, 0.034, 0.055, 12),
    torso: cap(...TORSO), hips: cap(0.13, 0.16).rotateZ(Math.PI / 2), thigh: cap(0.07, 0.36), shin: cap(0.055, 0.34),
    shoe: new THREE.BoxGeometry(0.1, 0.07, 0.24), neck: new THREE.CylinderGeometry(0.05, 0.055, 0.16, 10),
    head: new THREE.SphereGeometry(0.1, 18, 14), hair: new THREE.SphereGeometry(0.106, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
  };
  for (const g of Object.values(G)) g.userData.cached = true;       // (shared by every truck: TruckModel.dispose leaves them)
  const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  M = { shirt: std(0x30363d, 0.88), trousers: std(0x2e3440, 0.9), glove: std(0x171717, 0.55, 0.1), skin: std(0x8e5c40, 0.62), hair: std(0x1b1512, 0.9), shoe: std(0x2a221c, 0.7) };
}

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class Driver {
  /**
   * wheel: the steering wheel's group (in the body: its position and rotation, the column's), rimR: the rim's radius
   * (m, to the middle of its tube), eye: the driver's eye [x, y, z] in the design frame.
   */
  constructor(wheel, rimR, eye) {
    shared();
    this.hands = new Hands();
    this.rimR = rimR;
    this.wheelPos = wheel.position.clone();
    this.wheelRot = new THREE.Quaternion().setFromEuler(wheel.rotation);
    this.group = new THREE.Group();
    this._v = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
    const mesh = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; this.group.add(o); return o; };

    // seated, the head at the eye, leaning in (or back) until the wheel is in easy reach
    const E = v3(...eye), neck = E.clone().add(v3(0, -0.2, -0.11));
    const rest = this.hands.hands.map((h) => this.rim(h.at, 0, new THREE.Vector3()));
    const sh = (s) => neck.clone().add(v3(0.185 * s, -0.045, 0));
    const far = Math.max(rest[0].distanceTo(sh(1)), rest[1].distanceTo(sh(-1))) - HAND;
    const mid = rest[0].clone().add(rest[1]).multiplyScalar(0.5);
    const lean = v3(mid.x - neck.x, 0, mid.z - neck.z).normalize().multiplyScalar(far > COMFY ? far - COMFY : far < 0.65 * COMFY ? far - 0.65 * COMFY : 0);
    neck.add(lean);
    this.shoulders = [sh(1), sh(-1)];                   // (left: +x, as the left hand)
    this.out = [1, -1];                                 // (each elbow's way out from the body, across)
    const pelvis = E.clone().add(v3(0, -0.66, -0.2));
    this.place(mesh(G.torso, M.shirt), pelvis.clone().add(v3(0, -0.03, 0)), neck.clone().add(v3(0, 0.03, 0)), 2 * TORSO[0] + TORSO[1], [1.15, 0.72]);
    mesh(G.hips, M.trousers).position.copy(pelvis);
    for (const s of [1, -1]) {
      const hip = pelvis.clone().add(v3(0.1 * s, -0.02, 0.04)), knee = hip.clone().add(v3(0.03 * s, 0.07, 0.4));
      const ankle = knee.clone().add(v3(0, -0.38, 0.08));
      this.place(mesh(G.thigh, M.trousers), hip, knee);
      this.place(mesh(G.shin, M.trousers), knee, ankle);
      mesh(G.shoe, M.shoe).position.copy(ankle).add(v3(0, -0.03, 0.07));
    }
    this.arms = [0, 1].map(() => ({ upper: mesh(G.upper, M.skin), sleeve: mesh(G.sleeve, M.shirt), fore: mesh(G.fore, M.skin), cuff: mesh(G.cuff, M.glove), hand: mesh(G.hand, M.glove), fist: mesh(G.fist, M.glove) }));
    // the head, its hair and neck (hidden in the driver's-seat view)
    const head = E.clone().add(v3(0, 0.035, -0.075)).add(lean);
    const n = mesh(G.neck, M.skin), h = mesh(G.head, M.skin), hair = mesh(G.hair, M.hair);
    this.place(n, neck, head.clone().add(v3(0, -0.06, -0.01)));
    h.position.copy(head); h.scale.set(0.9, 1.1, 1);
    hair.position.copy(head).add(v3(0, 0.012, -0.012)); hair.scale.set(0.9, 1.1, 1); hair.rotation.x = -0.35;
    this.head = [n, h, hair];
    this.update(0, 0);
  }

  /** A point on the rim (in the body's frame) at `at` rad round the wheel, lifted off it toward the driver by `lift`. */
  rim(at, lift, out) {
    const r = this.rimR - 0.02 * lift;
    return out.set(r * Math.cos(at), r * Math.sin(at), -0.075 * lift).applyQuaternion(this.wheelRot).add(this.wheelPos);
  }

  /**
   * A mesh drawn along its y set from a to b; `len` (its length along y as built): stretched to reach from a to b;
   * `across`: its x and z scale.
   */
  place(o, a, b, len = 0, across = null) {
    const d = (this._d ||= new THREE.Vector3()).copy(b).sub(a), L = d.length();
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / (L || 1)));
    o.scale.set(across ? across[0] : 1, len ? L / len : 1, across ? across[1] : 1);
    return o;
  }

  /** The cab view: the camera is in the driver's head. */
  setSeatView(on) { for (const o of this.head) o.visible = !on; }

  /** The steering wheel turned to `wheel` (rad about its column), dt s on. */
  update(wheel, dt) {
    this.hands.update(wheel, dt);
    const [fist, wrist, tan, d, pole, elbow] = this._v;
    this.hands.hands.forEach((h, i) => {
      const arm = this.arms[i], S = this.shoulders[i];
      // the fist round the rim, along it; the wrist just behind it, toward the shoulder
      this.rim(h.at, h.lift, fist);
      wrist.copy(S).sub(fist).normalize().multiplyScalar(HAND).add(fist);
      // two-bone IK: the elbow on the circle round the shoulder-wrist line, toward the pole (down and out); a grip out
      // of reach pulls the hand off the rim, the arm straight
      d.copy(wrist).sub(S);
      const L = Math.min(Math.max(d.length(), Math.abs(UPPER - FORE) + 1e-3), UPPER + FORE - 1e-3);
      d.normalize();
      wrist.copy(S).addScaledVector(d, L);
      fist.sub(wrist).normalize().multiplyScalar(HAND).add(wrist);
      const x = (UPPER * UPPER - FORE * FORE + L * L) / (2 * L), y = Math.sqrt(Math.max(0, UPPER * UPPER - x * x));
      pole.set(0.55 * this.out[i], -1, -0.15);
      pole.addScaledVector(d, -pole.dot(d)).normalize();
      elbow.copy(S).addScaledVector(d, x).addScaledVector(pole, y);
      this.place(arm.upper, S, elbow);
      this.place(arm.sleeve, S, tan.copy(S).lerp(elbow, 0.55));
      this.place(arm.fore, elbow, wrist);
      this.place(arm.hand, wrist, fist);
      this.place(arm.cuff, elbow.lerp(wrist, 0.88), wrist);
      tan.set(-Math.sin(h.at), Math.cos(h.at), 0).applyQuaternion(this.wheelRot);
      arm.fist.position.copy(fist);
      arm.fist.quaternion.setFromUnitVectors(UP, tan);
    });
  }
}
