// CharacterRig: wraps an IMPORTED skinned character (never procedural geometry) with
//  - automatic skeleton discovery / bone mapping + facing & real-world scale normalization
//  - AnimationMixer locomotion blending with speed-synced playback (idle/walk/run/sprint...)
//  - procedural layers on the real skeleton for states without clips (crouch via leg IK, prone, jump, death, hit)
//  - upper-body aim (spine pitch/yaw distribution + head look) toward a unified world-space aim target
//  - weapon attachment: stock -> shoulder pocket, muzzle/optic -> aim direction
//  - two-bone arm IK: right hand -> weapon.rightGrip, left hand -> weapon.leftGrip, finger curl around the grips
import * as THREE from 'three';
import { mapBones, mapClips } from './BoneMap.js';
import { solveTwoBone, setBoneWorldQuaternion, rotateBoneWorld, basisQuaternion } from './IK.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// Grip hand frames in weapon space: F = finger direction, N = palm normal (points from palm into the grip)
export const DEFAULT_HAND_FRAMES = {
  rifle: { right: { F: [0, -0.55, -0.85], N: [-1, 0, 0] }, left: { F: [0.75, 0.25, -0.45], N: [0.15, 1, 0] } },
  pistol: { right: { F: [0, -0.35, -0.95], N: [-1, 0, 0] }, left: { F: [0.3, -0.6, -0.75], N: [0.95, 0.1, 0] } },
};

export class CharacterRig {
  constructor(assets, loaded, { firstPerson = false } = {}) {
    this.assets = assets;
    this.file = loaded.file;
    this.def = loaded.def || {};
    this.firstPerson = firstPerson;
    this.root = new THREE.Group();           // world transform: feet position, rotation.y = body yaw
    this.root.name = 'character';
    this.poseRoot = new THREE.Group();       // prone / death rotations
    this.body = new THREE.Group();           // facing + scale normalization
    this.root.add(this.poseRoot); this.poseRoot.add(this.body);
    this.model = assets.clone(loaded.gltf);
    this.body.add(this.model);
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; this.meshes.push(o);
        for (const m of [o.material].flat()) if (m.map) m.map.anisotropy = assets.anisotropy;
      }
    });
    this.bones = mapBones(this.model, this.def.bones);
    this.#normalize();
    this.#captureRest();
    this.clips = mapClips(loaded.gltf.animations);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(this.clips)) if (clip) { const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); this.actions[k] = a; }
    if (!this.actions.idle) console.error(`[rig] ${this.file}: no idle clip found — animations: ${loaded.gltf.animations.map((a) => a.name).join(', ') || 'none'}`);
    this.state = { speed: 0, moveYaw: 0, aimYaw: 0, pitch: 0, stance: 'stand', ads: false, sprint: false, onGround: true, reload: 0, firing: false, dead: false, vy: 0 };
    this.blend = { crouch: 0, prone: 0, sprint: 0, ads: 0, air: 0, death: 0, reload: 0, recoil: 0, hit: 0, land: 0 };
    this.bodyYaw = 0;
    this.legYaw = 0;
    this.aimTarget = new THREE.Vector3();
    this.weapon = null;
    this.ikWeight = 1;
    this.handFrames = DEFAULT_HAND_FRAMES.rifle;
    this.debug = null;
  }

  // --------------------------------------------------------------- setup
  #normalize() {
    this.model.updateMatrixWorld(true);
    const b = this.bones;
    // facing from the foot -> toe vector (or hip axis), rotate so the character faces -Z
    let fwd = new THREE.Vector3();
    if (b.leftToe && b.leftFoot) fwd.subVectors(b.leftToe.getWorldPosition(new THREE.Vector3()), b.leftFoot.getWorldPosition(new THREE.Vector3()));
    if (fwd.lengthSq() < 1e-8 && b.leftUpLeg && b.rightUpLeg) {
      const left = new THREE.Vector3().subVectors(b.leftUpLeg.getWorldPosition(new THREE.Vector3()), b.rightUpLeg.getWorldPosition(new THREE.Vector3()));
      fwd.crossVectors(left, UP);
    }
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, 1);
    fwd.normalize();
    this.body.rotation.y = Math.PI - Math.atan2(fwd.x, fwd.z);
    this.body.updateMatrixWorld(true);
    // real-world height from the skeleton
    let minY = Infinity;
    for (const bn of b.all) minY = Math.min(minY, bn.getWorldPosition(_v).y);
    const headY = b.head.getWorldPosition(_v).y, neckY = b.neck ? b.neck.getWorldPosition(_v2).y : headY - 0.1;
    const nativeH = headY + Math.max(0.08, (headY - neckY) * 1.45) - Math.min(minY, 0);
    const want = this.def.height || 1.8;
    this.scale = nativeH > 1.5 && nativeH < 2.1 ? 1 : want / nativeH;
    this.body.scale.setScalar(this.scale);
    this.body.updateMatrixWorld(true);
    // put the lowest point (soles) at y=0
    let m2 = Infinity;
    for (const bn of b.all) m2 = Math.min(m2, bn.getWorldPosition(_v).y);
    const sole = b.leftFoot ? b.leftFoot.getWorldPosition(_v).y - (b.leftToe ? Math.max(0, b.leftToe.getWorldPosition(_v2).y) : 0) : 0;
    this.body.position.y = -Math.min(m2, sole > 0 ? 0 : m2);
    this.body.updateMatrixWorld(true);
    this.height = (b.head.getWorldPosition(_v).y + Math.max(0.08, (headY - neckY) * 1.45 * this.scale));
  }

  #captureRest() {
    this.rest = new Map();
    for (const bn of this.bones.all) this.rest.set(bn, bn.quaternion.clone());
    this.root.updateMatrixWorld(true);
    // hand local frames (finger dir + palm normal) from the real hand bones
    this.handLocal = {};
    for (const s of ['left', 'right']) {
      const hand = this.bones[`${s}Hand`];
      const mid = this.bones[`${s}_middle`]?.[0] || this.bones[`${s}_index`]?.[0];
      const th = this.bones[`${s}_thumb`]?.[0];
      if (!hand || !mid) continue;
      const f = mid.position.clone().normalize();
      const t = th ? th.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
      const n = s === 'right' ? new THREE.Vector3().crossVectors(t, f) : new THREE.Vector3().crossVectors(f, t);
      n.addScaledVector(f, -n.dot(f)).normalize();
      // palm centre offset (hand-local, unscaled bone units)
      const palm = mid.position.clone().multiplyScalar(0.5);
      this.handLocal[s] = { f, n, t, palm, midLen: mid.position.length() };
    }
    // head orientation relative to an upright body facing -Z (for head look / prone)
    this.headRest = this.bones.head.getWorldQuaternion(new THREE.Quaternion());
  }

  boneReport() {
    const r = {};
    for (const k of ['hips', 'chest', 'neck', 'head', 'leftShoulder', 'leftArm', 'leftForeArm', 'leftHand', 'rightShoulder', 'rightArm', 'rightForeArm', 'rightHand', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot']) r[k] = this.bones[k]?.name || 'MISSING';
    r.spine = this.bones.spine.map((b) => b.name).join(',');
    r.fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => `${f}:${this.bones[`right_${f}`]?.length || 0}`).join(' ');
    r.clips = Object.entries(this.clips).filter(([, c]) => c).map(([k, c]) => `${k}=${c.name}`).join(' ');
    return r;
  }

  equip(weapon, kind = 'rifle') {
    if (this.weapon) this.weapon.root.removeFromParent();
    this.weapon = weapon;
    this.weaponKind = weapon ? (weapon.key === 'pistol' ? 'pistol' : 'rifle') : kind;
    this.handFrames = DEFAULT_HAND_FRAMES[this.weaponKind];
    if (weapon) this.root.parent ? this.root.parent.add(weapon.root) : this.root.add(weapon.root);
    this.weaponInWorld = weapon && weapon.root.parent !== this.root;
  }

  setState(s) { Object.assign(this.state, s); }

  setVisible(v) { this.model.visible = v; if (this.weapon) this.weapon.root.visible = v; }

  // --------------------------------------------------------------- per-frame
  update(dt) {
    const s = this.state, B = this.blend;
    B.crouch = damp(B.crouch, s.stance === 'crouch' ? 1 : 0, 10, dt);
    B.prone = damp(B.prone, s.stance === 'prone' ? 1 : 0, 5, dt);
    B.sprint = damp(B.sprint, s.sprint && s.speed > 4 ? 1 : 0, 8, dt);
    B.ads = damp(B.ads, s.ads ? 1 : 0, 12, dt);
    B.air = damp(B.air, s.onGround ? 0 : 1, 10, dt);
    B.death = s.dead ? Math.min(1, B.death + dt * 1.6) : 0;
    B.recoil = damp(B.recoil, 0, 14, dt);
    B.hit = damp(B.hit, 0, 7, dt);
    B.land = damp(B.land, 0, 6, dt);
    if (s.firing) B.recoil = Math.min(1, B.recoil + 0.6);

    // ----- body yaw / leg direction
    const moving = s.speed > 0.3;
    let legOffset = 0, backwards = false;
    if (moving && B.prone < 0.5) {
      const d = angDiff(s.aimYaw, s.moveYaw);
      if (Math.abs(d) <= 1.95) legOffset = Math.max(-1.0, Math.min(1.0, d));
      else { backwards = true; legOffset = Math.max(-1.0, Math.min(1.0, angDiff(s.aimYaw, s.moveYaw + Math.PI))); }
    }
    const targetBody = s.aimYaw + legOffset * (1 - B.sprint * 0.2);
    const idleSlack = angDiff(this.bodyYaw, s.aimYaw);
    if (moving || Math.abs(idleSlack) > 0.9 || B.prone > 0.1 || s.firing || s.ads) this.bodyYaw += angDiff(this.bodyYaw, moving ? targetBody : s.aimYaw) * (1 - Math.exp(-(moving ? 9 : 5) * dt));
    this.root.rotation.y = this.bodyYaw;

    // ----- locomotion clip weights
    const spd = s.speed;
    const sc = this.height / 1.8;
    const A = this.actions;
    const wIdle = 1 - smooth(0.15, 1.2, spd);
    const wRun = smooth(2.4, 4.2, spd);
    const wWalk = Math.max(0, 1 - wIdle - wRun);
    const dead = B.death > 0;
    const set = (k, w, ts) => { if (A[k]) { A[k].setEffectiveWeight(dead ? A[k].getEffectiveWeight() * 0.9 : w); if (ts !== undefined) A[k].timeScale = ts; } };
    const dir = backwards ? -1 : 1;
    set('idle', wIdle + (A.walk ? 0 : wWalk));
    set('walk', wWalk, dir * Math.max(0.55, Math.min(1.6, spd / (1.45 * sc))));
    set('run', wRun, dir * Math.max(0.7, Math.min(1.55, spd / (3.9 * sc))));
    if (A.sprint) { set('sprint', B.sprint); }
    this.mixer.update(dead ? dt * 0.3 : dt);
    this.root.updateMatrixWorld(true);

    // ----- procedural layers
    this.#stanceAndLegs(dt);
    this.#poseRootLayer();
    this.root.updateMatrixWorld(true);
    if (!dead) {
      this.#aimSpine();
      if (this.weapon) {
        if (!this.externalWeaponPlacement) this.#placeWeapon(dt);
        this.solveArms(dt);
      }
      this.#headLook();
    } else this.#deathLayer(dt);
  }

  #stanceAndLegs(dt) {
    const B = this.blend, b = this.bones;
    const crouchDrop = (0.46 * B.crouch + 0.05 * B.ads * (1 - B.crouch) + B.land * 0.12) * (1 - B.prone) * (this.height / 1.8);
    const tuck = B.air * 0.22 * (1 - B.prone);
    if ((crouchDrop < 0.005 && tuck < 0.005) || !b.leftUpLeg) return;
    // feet targets from the animated pose, before the pelvis drop
    const lf = b.leftFoot.getWorldPosition(new THREE.Vector3()), rf = b.rightFoot.getWorldPosition(new THREE.Vector3());
    const hip = b.hips.getWorldPosition(new THREE.Vector3());
    hip.y -= crouchDrop;
    b.hips.position.copy(b.hips.parent.worldToLocal(hip.clone()));
    b.hips.updateMatrixWorld(true);
    lf.y += tuck; rf.y += tuck * 0.7;
    // spread feet slightly and move the rear foot back when crouching (kneeling-ish support)
    const fwd = _v.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    const right = _v2.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
    lf.addScaledVector(fwd, 0.12 * B.crouch).addScaledVector(right, -0.04 * B.crouch);
    rf.addScaledVector(fwd, -0.18 * B.crouch).addScaledVector(right, 0.05 * B.crouch);
    for (const [s, tgt] of [['left', lf], ['right', rf]]) {
      const knee = b[`${s}Leg`].getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 1.0);
      const footQ = b[`${s}Foot`].getWorldQuaternion(new THREE.Quaternion());
      solveTwoBone(b[`${s}UpLeg`], b[`${s}Leg`], b[`${s}Foot`], tgt, knee, 1);
      setBoneWorldQuaternion(b[`${s}Foot`], footQ);
    }
  }

  #poseRootLayer() {
    const B = this.blend, p = this.poseRoot;
    const pr = B.prone;
    // prone: lie face down, head toward aim; pivot so the pelvis stays near the root position.
    // The body follows the ground slope between head and feet (roads, embankments, hills) and is lifted where the
    // ground under head/feet is higher than under the hips, so boots and chest never sink into the surface.
    let slope = 0, lift = 0;
    if (pr > 0.01 && this.groundAt) {
      const r = this.root.position, k = this.height / 1.8, fx = -Math.sin(this.bodyYaw), fz = -Math.cos(this.bodyYaw);
      const ahead = 1.0 * k, behind = 0.85 * k;
      const gh = this.groundAt(r.x + fx * ahead, r.z + fz * ahead, r.y);
      const gf = this.groundAt(r.x - fx * behind, r.z - fz * behind, r.y);
      const target = Math.max(-0.45, Math.min(0.45, Math.atan2(gh - gf, ahead + behind)));
      this.proneSlope = (this.proneSlope ?? target) + (target - (this.proneSlope ?? target)) * 0.3;
      slope = this.proneSlope;
      // ground line through head/feet vs. the ground under the hips (convex road crowns, kerbs, rocks)
      const mid = gf + (gh - gf) * (behind / (ahead + behind));
      lift = Math.max(0, Math.min(0.6, mid - r.y));
    }
    p.rotation.set((-Math.PI / 2 + slope) * pr, 0, 0);
    p.position.set(0, (0.27 + lift) * pr, 0.95 * pr * (this.height / 1.8));
  }

  #aimSpine() {
    const s = this.state, B = this.blend, spine = this.bones.spine;
    if (!spine.length) return;
    const yawTwist = angDiff(this.bodyYaw, s.aimYaw);
    const right = _v.set(Math.cos(s.aimYaw), 0, -Math.sin(s.aimYaw));
    // pitch: when prone, the torso needs to arch up to look forward
    const pitch = s.pitch * (1 - B.sprint * 0.7) + B.prone * 0.95 + B.hit * 0.15 + B.recoil * 0.02;
    const n = spine.length;
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / ((n * (n + 1)) / 2);
      rotateBoneWorld(spine[i], _q.setFromAxisAngle(UP, yawTwist * w));
      rotateBoneWorld(spine[i], _q.setFromAxisAngle(right, pitch * w * (B.prone > 0.5 ? 0.8 : 1)));
    }
  }

  #headLook() {
    const s = this.state, head = this.bones.head;
    // desired: head facing along the aim direction (relative to its rest orientation facing -Z)
    const aimQ = _q.setFromEuler(_e.set(s.pitch * 0.85, s.aimYaw, 0, 'YXZ'));
    const want = aimQ.multiply(this.headRest);
    if (this.blend.ads > 0.1 && this.weapon) {
      // cheek weld: tilt the head slightly down/right toward the optic
      want.premultiply(_q2.setFromAxisAngle(_v.set(-Math.sin(s.aimYaw), 0, -Math.cos(s.aimYaw)), -0.18 * this.blend.ads));
    }
    const cur = head.getWorldQuaternion(new THREE.Quaternion());
    setBoneWorldQuaternion(head, cur.slerp(want, 0.8));
  }

  // Weapon transform in world space: stock in the right shoulder pocket, muzzle along the aim direction.
  #placeWeapon(dt) {
    const s = this.state, B = this.blend, w = this.weapon, b = this.bones;
    const aimQ = _q.setFromEuler(_e.set(s.pitch, s.aimYaw, 0, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(aimQ);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(aimQ);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(aimQ);
    const shoulder = b.rightArm.getWorldPosition(new THREE.Vector3());
    const chest = b.chest.getWorldPosition(new THREE.Vector3());
    const pistol = this.weaponKind === 'pistol';
    const pocket = shoulder.clone();
    if (pistol) {
      // two-handed pistol: arms extended forward at chest height
      pocket.lerp(chest, 0.5).addScaledVector(fwd, 0.42 + 0.08 * B.ads).addScaledVector(up, 0.12 + 0.1 * B.ads);
    } else {
      pocket.addScaledVector(right, -0.06 - 0.02 * B.ads).addScaledVector(up, -0.035 + 0.03 * B.ads).addScaledVector(fwd, 0.05);
    }
    // recoil + sprint low-ready + reload tilt
    const q = aimQ.clone();
    if (B.sprint > 0.01) {
      q.multiply(_q2.setFromEuler(_e.set(-0.85 * B.sprint, 0.75 * B.sprint, 0.5 * B.sprint, 'YXZ')));
      pocket.addScaledVector(right, -0.12 * B.sprint).addScaledVector(up, -0.08 * B.sprint);
    }
    const rl = this.state.reload;
    if (rl > 0 && rl < 1) {
      const k = Math.sin(Math.min(1, rl * 1.2) * Math.PI);
      q.multiply(_q2.setFromEuler(_e.set(-0.25 * k, 0.15 * k, 0.55 * k, 'YXZ')));
      pocket.addScaledVector(fwd, -0.02 * k).addScaledVector(up, -0.05 * k);
    }
    q.multiply(_q2.setFromEuler(_e.set(0.035 * B.recoil, 0, 0)));
    pocket.addScaledVector(fwd, -0.035 * B.recoil);
    w.root.quaternion.copy(q);
    const stock = w.sockets.stock.clone().applyQuaternion(q);
    w.root.position.copy(pocket).sub(stock);
    if (w.root.parent !== this.root.parent && w.root.parent) {
      // weapon parented under the character root: convert
      w.root.parent.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(w.root.parent.matrixWorld).invert();
      const m = new THREE.Matrix4().compose(w.root.position, w.root.quaternion, new THREE.Vector3(1, 1, 1)).premultiply(inv);
      m.decompose(w.root.position, w.root.quaternion, _v3);
    }
    w.root.updateMatrixWorld(true);
    this.aimTarget.copy(w.socketWorld('muzzle', new THREE.Vector3())).addScaledVector(fwd, 30);
  }

  // Arm IK to the weapon grips (+ reload choreography for the support hand), then finger curl.
  solveArms(dt, opts = {}) {
    const w = this.weapon, b = this.bones;
    if (!w || !b.rightHand || !this.handLocal.right) return;
    w.root.updateMatrixWorld(true);
    const wq = w.root.getWorldQuaternion(new THREE.Quaternion());
    const wr = new THREE.Vector3(1, 0, 0).applyQuaternion(wq), wu = new THREE.Vector3(0, 1, 0).applyQuaternion(wq), wf = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
    const rl = this.state.reload;
    for (const side of ['right', 'left']) {
      const frame = this.handFrames[side];
      let grip = w.socketWorld(side === 'right' ? 'rightGrip' : 'leftGrip', new THREE.Vector3());
      let F = new THREE.Vector3(...frame.F).normalize().applyQuaternion(wq);
      let N = new THREE.Vector3(...frame.N).normalize().applyQuaternion(wq);
      let weight = this.ikWeight;
      if (side === 'left' && rl > 0 && rl < 1) {
        // support hand: grip -> magazine -> pouch -> magazine -> grip
        const mag = w.socketWorld('rightGrip', new THREE.Vector3()).lerp(w.socketWorld('leftGrip', _v), 0.45).addScaledVector(wu, -0.09);
        const pouch = b.chest.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, -0.32).addScaledVector(wr, -0.1).addScaledVector(wf, 0.12);
        const k = rl;
        const p = k < 0.2 ? grip.clone().lerp(mag, k / 0.2) : k < 0.45 ? mag.clone().lerp(pouch, (k - 0.2) / 0.25) : k < 0.75 ? pouch.clone().lerp(mag, (k - 0.45) / 0.3) : mag.clone().lerp(grip, (k - 0.75) / 0.25);
        grip = p;
        N = wu.clone(); F = wf.clone().addScaledVector(wr, 0.5);
      }
      if (side === 'left' && opts.leftFree) weight = 0;
      const upper = b[`${side}Arm`], lower = b[`${side}ForeArm`], hand = b[`${side}Hand`];
      const L = this.handLocal[side];
      // desired hand world rotation from the grip frame
      const handQ = basisQuaternion(L.f, L.n, F, N);
      // wrist position so the palm centre sits on the grip surface
      const palmWorld = L.palm.clone().multiply(hand.getWorldScale(_v3)).applyQuaternion(handQ);
      const target = grip.clone().addScaledVector(N, -(side === 'right' ? 0.024 : 0.028)).sub(palmWorld);
      const pole = upper.getWorldPosition(new THREE.Vector3());
      if (side === 'right') pole.addScaledVector(wr, 0.35).addScaledVector(UP, -0.55).addScaledVector(wf, -0.15);
      else pole.addScaledVector(wr, -0.25).addScaledVector(UP, -0.7).addScaledVector(wf, 0.1);
      solveTwoBone(upper, lower, hand, target, pole, weight);
      if (weight > 0) {
        const cur = hand.getWorldQuaternion(new THREE.Quaternion());
        setBoneWorldQuaternion(hand, cur.slerp(handQ, weight));
        if (!this.detail) this.#curlFingers(side, F, N, weight);
      }
      if (this.debug) this.debug[side].copy(target);
    }
  }

  #curlFingers(side, F, N, weight) {
    const k = new THREE.Vector3().crossVectors(F, N).normalize(); // rotating about k moves fingers toward the palm
    const right = side === 'right';
    const curls = {
      thumb: [0.2, 0.35, 0.3], index: right ? [0.35, 0.35, 0.25] : [0.95, 1.05, 0.7],
      middle: [1.05, 1.15, 0.8], ring: [1.1, 1.15, 0.8], pinky: [1.15, 1.1, 0.8],
    };
    for (const [f, angles] of Object.entries(curls)) {
      const chain = this.bones[`${side}_${f}`];
      if (!chain?.length) continue;
      for (let i = 0; i < chain.length; i++) {
        const bn = chain[i];
        bn.quaternion.copy(this.rest.get(bn));
        bn.updateMatrixWorld(true);
        const axis = f === 'thumb' ? _v.copy(F).multiplyScalar(right ? -1 : 1).lerp(k, 0.5).normalize() : k;
        rotateBoneWorld(bn, _q.setFromAxisAngle(axis, angles[i] * weight));
      }
    }
  }

  #deathLayer(dt) {
    const B = this.blend, p = this.poseRoot;
    const t = B.death, e = t * t * (3 - 2 * t);
    const dir = this.deathDir || 1;
    p.rotation.set(dir * (Math.PI / 2) * e, 0, 0.25 * e * dir);
    p.position.set(0, 0.12 * e, 0);
    // limp arms: relax toward animation (no IK); weapon drops
    if (this.weapon) {
      if (!this.dropped) {
        this.dropped = { vy: 0.5, spin: (Math.random() - 0.5) * 3 };
      }
      const w = this.weapon.root, g = this.groundY ?? this.root.position.y;
      if (w.position.y > g + 0.05) {
        this.dropped.vy -= 9.8 * dt;
        w.position.y = Math.max(g + 0.05, w.position.y + this.dropped.vy * dt);
        w.rotateZ(this.dropped.spin * dt);
        w.rotateX(0.9 * dt);
      }
    }
  }

  die(fromDir = 1) { this.state.dead = true; this.deathDir = fromDir; this.dropped = null; this.groundY = this.root.position.y; }
  revive() { this.state.dead = false; this.blend.death = 0; this.dropped = null; this.poseRoot.rotation.set(0, 0, 0); this.poseRoot.position.set(0, 0, 0); }
  hitReact() { this.blend.hit = 1; }
  land(v) { this.blend.land = Math.min(1, v / 10); }

  // --------------------------------------------------------------- diagnostics
  validate() {
    const w = this.weapon, b = this.bones;
    if (!w) return { error: 'no weapon' };
    const out = {};
    const palm = (side) => {
      const hand = b[`${side}Hand`], L = this.handLocal[side];
      return hand.localToWorld(L.palm.clone());
    };
    const rg = w.socketWorld('rightGrip', new THREE.Vector3()), lg = w.socketWorld('leftGrip', new THREE.Vector3());
    out.rightGripOffset = +palm('right').distanceTo(rg).toFixed(3);
    out.leftGripOffset = +palm('left').distanceTo(lg).toFixed(3);
    const sh = b.rightArm.getWorldPosition(new THREE.Vector3());
    out.stockToShoulder = +w.socketWorld('stock', new THREE.Vector3()).distanceTo(sh).toFixed(3);
    const wq = w.root.getWorldQuaternion(new THREE.Quaternion());
    const muzzleDir = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
    const aimDir = this.aimTarget.clone().sub(w.socketWorld('muzzle', new THREE.Vector3())).normalize();
    out.muzzleAlignDeg = +THREE.MathUtils.radToDeg(Math.acos(Math.min(1, muzzleDir.dot(aimDir)))).toFixed(2);
    out.ok = out.rightGripOffset < 0.05 && out.leftGripOffset < 0.06 && out.stockToShoulder < 0.2 && out.muzzleAlignDeg < 2;
    if (!out.ok && !this._warned) { this._warned = true; console.warn('[rig] weapon alignment out of tolerance', out); }
    return out;
  }
}
