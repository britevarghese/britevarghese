// CharacterRig: wraps an IMPORTED skinned character (never procedural geometry) with
//  - automatic skeleton discovery / bone mapping + facing & real-world scale normalization
//  - AnimationMixer locomotion blending with speed-synced playback (idle/walk/run/sprint...)
//  - procedural layers on the real skeleton for states without clips (crouch via leg IK, prone, jump, death, hit)
//  - upper-body aim (spine pitch/yaw distribution + head look) toward a unified world-space aim target
//  - weapon attachment: stock -> shoulder pocket, muzzle/optic -> aim direction
//  - two-bone arm IK: right hand -> weapon.rightGrip, left hand -> weapon.leftGrip, finger curl around the grips
//  - hands working the gun: magazine out / pouch / in, charging handle, slide release, bolt cycle, stripper clip
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

// Hand frames (weapon space) for working the gun: F = finger direction, N = palm normal (into what is held)
const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const FR = {
  knob: { F: V(-0.15, 0.3, -0.94), N: V(-0.85, 0.45, -0.25) },     // right hand under the bolt knob (turns with the bolt)
  clip: { F: V(-0.1, -0.3, -1), N: V(-0.65, -0.75, 0) },             // clip pinched from the right, thumb on the top round
  magRifle: { F: V(0.25, 0.35, -0.9), N: V(0.7, 0.7, 0), off: 0.022 }, // magazine held low by its base, palm up-right
  magPistol: { F: V(0.1, 0.25, -1), N: V(0.05, 1, 0.1), off: 0.03 },  // magazine in the palm, finger along its front
  charge: { F: V(1, 0.15, 0.1), N: V(0, -0.35, 1) },                 // fingers hooked over the charging-handle latch
};
// hand target: position + orientation as a rotation of the canonical frame (fingers -Z, palm +X), so blends slerp
const F0 = new THREE.Vector3(0, 0, -1), N0 = new THREE.Vector3(1, 0, 0);
const mkT = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), F: new THREE.Vector3(), N: new THREE.Vector3(), off: 0.024, curl: 1 });
const _tb1 = new THREE.Vector3(), _tb2 = new THREE.Vector3(), _tb3 = new THREE.Vector3(), _tbm = new THREE.Matrix4();
function setT(t, p, F, N, off, curl) {
  const f = _tb1.copy(F).normalize(), n = _tb2.copy(N).addScaledVector(f, -N.dot(f)).normalize(), s = _tb3.crossVectors(f, n);
  t.q.setFromRotationMatrix(_tbm.makeBasis(n, s.negate(), f.negate())); // X -> n, Y -> -(f x n), Z -> -f
  t.p.copy(p); t.F.copy(F0).applyQuaternion(t.q); t.N.copy(N0).applyQuaternion(t.q); t.off = off; t.curl = curl;
  return t;
}
// (out may alias a, never b)
function mixT(out, a, b, k) {
  out.p.lerpVectors(a.p, b.p, k); out.q.slerpQuaternions(a.q, b.q, k);
  out.F.copy(F0).applyQuaternion(out.q); out.N.copy(N0).applyQuaternion(out.q);
  out.off = a.off + (b.off - a.off) * k; out.curl = a.curl + (b.curl - a.curl) * k;
  return out;
}
const eout = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return 1 - (1 - t) * (1 - t); };
const _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1), _I = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
const _hm = new THREE.Matrix4(), _hm2 = new THREE.Matrix4(), _hm3 = new THREE.Matrix4(), _hq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq3 = new THREE.Quaternion();
const _hk = new THREE.Vector3(), _hp = new THREE.Vector3(), _hp2 = new THREE.Vector3(), _hp3 = new THREE.Vector3(), _hg = new THREE.Vector3();
const _bu = new THREE.Vector3(), _br = new THREE.Vector3(), _bf = new THREE.Vector3(), _bc = new THREE.Vector3(), _f1 = new THREE.Vector3(), _f2 = new THREE.Vector3();
const _mp = new THREE.Vector3(), _mq = new THREE.Quaternion();

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
    this.gait = this.#measureGait(loaded.gltf);
    this.gaitPhase = 0;
    // the shoulder line of the idle (rifle-ready) pose, relative to the body: walking / running keeps it, so the walk
    // clip's torso swing doesn't pull the support hand off the handguard (the legs walk, the chest carries the rifle)
    this.shoulderRest = this.#shoulderLine('idle');
    this.state = { speed: 0, moveYaw: 0, aimYaw: 0, pitch: 0, stance: 'stand', ads: false, sprint: false, onGround: true, reload: 0, firing: false, dead: false, vy: 0 };
    this.blend = { crouch: 0, prone: 0, sprint: 0, ads: 0, air: 0, death: 0, reload: 0, recoil: 0, hit: 0, land: 0, skydive: 0, canopy: 0 };
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

  // How far the feet travel per cycle in the walk / run clips (stride, at this rig's scale), and where in each clip
  // the left foot is furthest forward (so the two cycles can be blended in step). Measured once per model by
  // sampling the clip: a planted foot (within 3 cm of its lowest point) slides back at the clip's own ground speed.
  #measureGait(gltf) {
    const cache = gltf.userData || (gltf.userData = {});
    if (cache.gait) return cache.gait;
    const out = {}, lf = this.bones.leftFoot, rf = this.bones.rightFoot;
    if (lf && rf) {
      for (const k of ['walk', 'run']) {
        const a = this.actions[k];
        if (!a) continue;
        for (const b of Object.values(this.actions)) b.setEffectiveWeight(0);
        a.setEffectiveWeight(1);
        const dur = a.getClip().duration, N = 60, tr = [[], []];
        for (let i = 0; i <= N; i++) {
          a.time = (i / N) * dur; this.mixer.update(0); this.root.updateMatrixWorld(true);
          tr[0].push(lf.getWorldPosition(new THREE.Vector3())); tr[1].push(rf.getWorldPosition(new THREE.Vector3()));
        }
        const speeds = [], stance = [];
        for (const t of tr) {
          const lo = Math.min(...t.map((p) => p.y)), mask = [];
          for (let i = 0; i < N; i++) {
            mask.push(t[i].y < lo + 0.03);
            if (i && t[i].y < lo + 0.03 && t[i - 1].y < lo + 0.03) speeds.push(Math.hypot(t[i].x - t[i - 1].x, t[i].z - t[i - 1].z) * (N / dur));
          }
          stance.push(mask);
        }
        let fwd = 0;
        for (let i = 1; i < N; i++) if (tr[0][i].z < tr[0][fwd].z) fwd = i;
        speeds.sort((x, y) => x - y);
        const speed = speeds.length ? speeds[speeds.length >> 1] : 0; // median: heel strike / toe-off don't skew it
        // stance masks are stored on the shared gait phase (phase 0 = left foot furthest forward)
        const onPhase = (m) => Array.from({ length: N }, (_, i) => m[(i + fwd) % N]);
        if (speed > 0.2) out[k] = { stride: speed * dur, dur, phase: fwd / N, stance: { left: onPhase(stance[0]), right: onPhase(stance[1]) } };
        a.time = 0;
      }
      for (const b of Object.values(this.actions)) b.setEffectiveWeight(0);
    }
    cache.gait = out;
    return out;
  }

  // yaw and roll (radians, in the body's frame) of the line from the right to the left shoulder joint; with a clip
  // name: as posed by that clip
  #shoulderLine(clip) {
    const b = this.bones;
    if (!b.leftArm || !b.rightArm) return null;
    if (clip) {
      const a = this.actions[clip];
      if (!a) return null;
      for (const x of Object.values(this.actions)) x.setEffectiveWeight(0);
      a.setEffectiveWeight(1); a.time = 0; this.mixer.update(0); a.setEffectiveWeight(0);
    }
    this.root.updateMatrixWorld(true);
    const d = b.leftArm.getWorldPosition(new THREE.Vector3()).sub(b.rightArm.getWorldPosition(_v2));
    const c = Math.cos(this.root.rotation.y), sn = Math.sin(this.root.rotation.y);
    const lx = d.x * c - d.z * sn, lz = d.x * sn + d.z * c; // world -> body frame
    return { yaw: Math.atan2(-lz, -lx), roll: Math.atan2(d.y, Math.hypot(lx, lz)) };
  }

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
    B.skydive = damp(B.skydive, s.skydive === 1 ? 1 : 0, 5, dt);
    B.canopy = damp(B.canopy, s.skydive === 2 ? 1 : 0, 4, dt);

    // ----- body yaw / leg direction
    const moving = s.speed > 0.3;
    // the legs walk the way the body actually moves (a strafe steps sideways, not forward with sliding feet);
    // the hips and spine twist back so the chest and rifle stay on the aim. Moving more than ~110° away from the
    // aim plays the cycle backwards instead (back-pedalling); the band in between stops it flip-flopping at 90°.
    let legOffset = 0;
    if (moving && B.prone < 0.5) {
      const d = angDiff(s.aimYaw, s.moveYaw);
      this.backwards = Math.abs(d) > (this.backwards ? Math.PI / 2 - 0.35 : Math.PI / 2 + 0.35);
      legOffset = this.backwards ? angDiff(s.aimYaw, s.moveYaw + Math.PI) : d;
    } else if (!moving) this.backwards = false;
    const backwards = !!this.backwards;
    const targetBody = s.aimYaw + legOffset;
    const idleSlack = angDiff(this.bodyYaw, s.aimYaw);
    const yaw0 = this.bodyYaw;
    if (moving || Math.abs(idleSlack) > 0.9 || B.prone > 0.1 || s.firing || s.ads) this.bodyYaw += angDiff(this.bodyYaw, moving ? targetBody : s.aimYaw) * (1 - Math.exp(-(moving ? 9 : 5) * dt));
    this.root.rotation.y = this.bodyYaw;
    this.turnRate = damp(this.turnRate || 0, dt > 0 ? Math.abs(angDiff(yaw0, this.bodyYaw)) / dt : 0, 10, dt);

    // ----- locomotion clip weights
    const spd = s.speed;
    const sc = this.height / 1.8;
    const A = this.actions;
    const wIdle = 1 - smooth(0.15, 1.2, spd);
    const wRun = smooth(2.4, 4.2, spd);
    const wWalk = Math.max(0, 1 - wIdle - wRun);
    const dead = B.death > 0;
    // dead: the weights frozen at the moment of death blend into the relaxed idle pose (always summing to 1, so the
    // bind T-pose never leaks in) while the clips slow to a stop
    const relax = Math.min(1, B.death * 3);
    const set = (k, w, ts) => { if (A[k]) { A[k].setEffectiveWeight(dead ? (this.deathW?.[k] ?? 0) * (1 - relax) + (k === 'idle' ? relax : 0) : w); if (ts !== undefined && !dead) A[k].timeScale = ts; } };
    const dir = backwards ? -1 : 1;
    // prone: the upright walk/run cycle can't be used on a body lying down (legs would scissor through the ground);
    // the crawl is carried by the procedural prone layer instead
    const upright = 1 - smooth(0.2, 0.7, B.prone);
    // turning on the spot: the feet step round (a bit of the walk cycle) instead of the body spinning on planted feet
    const turnStep = !moving && A.walk ? Math.min(0.6, Math.max(0, this.turnRate - 0.6) * 0.35) * upright * (1 - B.crouch * 0.5) : 0;
    const G = this.gait;
    if (G.walk && G.run) {
      // walk and run play in step from one gait phase; its rate makes the blended stride cover exactly the ground the
      // body covers (planted feet stay put at any speed, sprint included), capped at a believable cadence
      const ww = wWalk * upright + turnStep, wr = wRun * upright;
      this.blendRun = wr / Math.max(1e-3, ww + wr);
      set('idle', Math.max(0, 1 - ww - wr));
      set('walk', ww, 0); set('run', wr, 0);
      if (!dead) {
        const reach = wWalk * G.walk.stride + wRun * G.run.stride;
        const rate = moving ? Math.min(2.2, spd / Math.max(0.05, reach)) : turnStep > 0 ? 0.9 : 0;
        this.gaitPhase = (this.gaitPhase + dir * rate * dt + 1) % 1;
        const at = (g) => (((this.gaitPhase + g.phase) % 1) + 1) % 1 * g.dur;
        A.walk.time = at(G.walk); A.run.time = at(G.run);
      }
    } else {
      set('idle', 1 - (1 - wIdle - (A.walk ? 0 : wWalk)) * upright - turnStep);
      set('walk', wWalk * upright + turnStep, dir * Math.max(0.55, Math.min(1.6, (moving ? spd : 1.0) / (1.45 * sc))));
      set('run', wRun * upright, dir * Math.max(0.7, Math.min(1.55, spd / (3.9 * sc))));
    }
    if (A.sprint) { set('sprint', B.sprint * upright); }
    this.mixer.update(dead ? dt * (1 - relax) : dt);
    this.root.updateMatrixWorld(true);
    // steady chest: take out the walk / run clip's torso twist and shoulder roll (as far as the gait is blended in)
    const k = (1 - wIdle) * upright;
    if (!dead && this.shoulderRest && k > 0.01 && this.bones.spine.length) {
      const now = this.#shoulderLine(), sp = this.bones.spine, n = sp.length;
      // (the line's yaw goes down as the chest turns left about +Y; its roll goes up as the chest turns about forward)
      const dyaw = angDiff(this.shoulderRest.yaw, now.yaw) * k, droll = (this.shoulderRest.roll - now.roll) * k;
      const fwd = _v3.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
      for (const bn of sp) { rotateBoneWorld(bn, _q.setFromAxisAngle(UP, dyaw / n)); rotateBoneWorld(bn, _q.setFromAxisAngle(fwd, droll / n)); }
      this.root.updateMatrixWorld(true);
    }

    // ----- procedural layers
    this.#stanceAndLegs(dt);
    this.#poseRootLayer();
    this.root.updateMatrixWorld(true);
    if (!dead) this.#crawl(dt);
    if (!dead) {
      this.#aimSpine();
      this.#footLock(dt);
      if (this.weapon) {
        if (!this.externalWeaponPlacement) this.#placeWeapon(dt);
        this.solveArms(dt);
      }
      this.#headLook();
      if (B.skydive > 0.01 || B.canopy > 0.01) this.#airPose();
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

  // Foot locking: a foot in the stance part of the step is pinned to the spot where it touched down (two-bone leg IK),
  // so it never skates over the ground — even where the clip's own foot speed wobbles through the step, while the
  // body turns on the spot, or the gait is blended. It lets go when the step lifts the foot, smoothly.
  #footLock(dt) {
    const B = this.blend, s = this.state, b = this.bones, G = this.gait;
    const L = this.locks || (this.locks = { left: null, right: null });
    const active = G.walk && G.run && b.leftUpLeg && s.onGround && B.prone < 0.3 && B.air < 0.3 && B.skydive < 0.05 && B.canopy < 0.05
      && (s.speed > 0.3 || this.turnRate > 0.6);
    if (!active) { L.left = L.right = null; return; }
    const g = this.blendRun > 0.5 ? G.run : G.walk, N = g.stance.left.length, bin = Math.floor(this.gaitPhase * N) % N;
    const fwd = _v3.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw));
    for (const side of ['left', 'right']) {
      const foot = b[`${side}Foot`], p = foot.getWorldPosition(new THREE.Vector3());
      let lk = L[side];
      if (g.stance[side][bin]) {
        if (!lk) lk = L[side] = { x: p.x, z: p.z, w: 0 };
        lk.w = Math.min(1, lk.w + dt * 25);
        if (Math.hypot(p.x - lk.x, p.z - lk.z) > 0.35) { L[side] = null; continue; } // body turned / jumped too far
      } else if (lk) {
        lk.w -= dt * 14;
        if (lk.w <= 0) { L[side] = null; continue; }
      }
      if (!lk) continue;
      const knee = b[`${side}Leg`].getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 1.0);
      const footQ = foot.getWorldQuaternion(new THREE.Quaternion());
      solveTwoBone(b[`${side}UpLeg`], b[`${side}Leg`], foot, new THREE.Vector3(lk.x, p.y, lk.z), knee, lk.w);
      setBoneWorldQuaternion(foot, footQ);
    }
  }

  // prone and moving: a leopard crawl — one knee drawn up and out to the side while the other leg pushes, alternating
  #crawl(dt) {
    const B = this.blend, s = this.state, b = this.bones;
    if (B.prone < 0.6 || s.speed < 0.15 || !b.leftUpLeg) return;
    this.crawlT = (this.crawlT || 0) + dt * s.speed * 5.5;
    this.poseRoot.updateMatrixWorld(true);
    const pq = this.poseRoot.getWorldQuaternion(_q2);
    const R = _v.set(1, 0, 0).applyQuaternion(pq), F = _v2.set(0, 0, -1).applyQuaternion(pq);
    const w = smooth(0.6, 0.9, B.prone) * Math.min(1, s.speed / 0.4);
    for (const [side, sign, ph] of [['left', 1, 0], ['right', -1, Math.PI]]) {
      const k = Math.max(0, Math.sin(this.crawlT + ph));
      // lying face down, the chest axis F is the ground normal: rotating about it keeps the leg on the ground —
      // the thigh swings out sideways and the shin folds back in, flat (not up in the air)
      rotateBoneWorld(b[`${side}UpLeg`], _q.setFromAxisAngle(F, sign * 0.8 * k * w));
      rotateBoneWorld(b[`${side}Leg`], _q.setFromAxisAngle(F, -sign * 1.3 * k * w));
    }
  }

  // battle royale jump: stable freefall "box" (arms out and bent, knees bent, feet up) and hanging under the canopy
  // (hands up on the steering toggles, legs relaxed). Targets are in the body's own frame, so they follow the
  // belly-down pitch applied to the root while falling.
  #airPose() {
    const B = this.blend, b = this.bones;
    if (!b.leftArm || !b.leftUpLeg) return;
    this.root.updateMatrixWorld(true);
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const R = new THREE.Vector3(1, 0, 0).applyQuaternion(q), U = new THREE.Vector3(0, 1, 0).applyQuaternion(q), F = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const k = this.height / 1.8;
    for (const [pose, w] of [['sky', B.skydive], ['chute', B.canopy]]) {
      if (w < 0.01) continue;
      for (const [side, s] of [['left', -1], ['right', 1]]) {
        const sh = b[`${side}Arm`].getWorldPosition(new THREE.Vector3());
        const hip = b[`${side}UpLeg`].getWorldPosition(new THREE.Vector3());
        const hand = sh.clone(), elbow = sh.clone(), foot = hip.clone(), knee = hip.clone();
        if (pose === 'sky') {
          // arms spread wide, elbows ~90 deg, hands at head height; legs apart, knees slightly bent, feet up
          hand.addScaledVector(R, s * 0.52 * k).addScaledVector(U, 0.24 * k).addScaledVector(F, 0.02 * k);
          elbow.addScaledVector(R, s * 0.9).addScaledVector(U, -0.25).addScaledVector(F, -0.1);
          foot.addScaledVector(R, s * 0.32 * k).addScaledVector(U, -0.72 * k).addScaledVector(F, -0.3 * k);
          knee.addScaledVector(R, s * 0.35).addScaledVector(U, -0.45).addScaledVector(F, 0.5);
        } else {
          hand.addScaledVector(R, s * 0.14 * k).addScaledVector(U, 0.55 * k).addScaledVector(F, 0.04 * k);
          elbow.addScaledVector(R, s * 0.7).addScaledVector(U, 0.1);
          foot.addScaledVector(R, s * 0.08 * k).addScaledVector(U, -0.86 * k).addScaledVector(F, 0.1 * k);
          knee.addScaledVector(U, -0.4).addScaledVector(F, 0.8);
        }
        solveTwoBone(b[`${side}Arm`], b[`${side}ForeArm`], b[`${side}Hand`], hand, elbow, w);
        solveTwoBone(b[`${side}UpLeg`], b[`${side}Leg`], b[`${side}Foot`], foot, knee, w);
      }
    }
  }

  #aimSpine() {
    const s = this.state, B = this.blend, spine = this.bones.spine;
    if (!spine.length) return;
    let yawTwist = angDiff(this.bodyYaw, s.aimYaw);
    // a big twist (strafing, back-pedalling) starts at the pelvis: it turns ~35 % toward the aim while the thighs turn
    // back in the hip joints, so the legs keep stepping the way they go and the spine isn't wrung round on its own
    const b = this.bones, hip = 0.35 * (1 - B.prone) * smooth(0.2, 0.6, Math.abs(yawTwist));
    if (hip > 0 && b.hips && b.leftUpLeg && b.rightUpLeg) {
      rotateBoneWorld(b.hips, _q.setFromAxisAngle(UP, yawTwist * hip));
      rotateBoneWorld(b.leftUpLeg, _q.setFromAxisAngle(UP, -yawTwist * hip));
      rotateBoneWorld(b.rightUpLeg, _q.setFromAxisAngle(UP, -yawTwist * hip));
      yawTwist *= 1 - hip;
    }
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

  // Arm IK to the weapon grips — or wherever the hands are working the gun this frame (reload choreography, bolt
  // cycle, charging handle / slide release; see #handTargets) — then finger curl.
  solveArms(dt, opts = {}) {
    const w = this.weapon, b = this.bones;
    if (!w || !b.rightHand || !this.handLocal.right) return;
    w.root.updateMatrixWorld(true);
    const wq = w.root.getWorldQuaternion(new THREE.Quaternion());
    const wr = new THREE.Vector3(1, 0, 0).applyQuaternion(wq), wu = new THREE.Vector3(0, 1, 0).applyQuaternion(wq), wf = new THREE.Vector3(0, 0, -1).applyQuaternion(wq);
    const rl = this.state.reload > 0 && this.state.reload < 1 ? this.state.reload : 0;
    // the gun's own mechanics first (blowback, bolt, charging handle), so the hands go to where the parts are now
    if (!this.firstPerson) w.vel.set(-Math.sin(this.state.moveYaw) * this.state.speed, 0, -Math.cos(this.state.moveYaw) * this.state.speed);
    w.animate(performance.now(), rl, !!this.reloadEmpty, this.mag ?? 1);
    const T = w.action ? this.#handTargets(rl) : null;
    for (const side of ['right', 'left']) {
      const frame = this.handFrames[side];
      let grip = w.socketWorld(side === 'right' ? 'rightGrip' : 'leftGrip', new THREE.Vector3());
      let F = new THREE.Vector3(...frame.F).normalize().applyQuaternion(wq);
      let N = new THREE.Vector3(...frame.N).normalize().applyQuaternion(wq);
      let weight = this.ikWeight;
      const t = T?.[side];
      if (t) {
        // hand target in weapon space -> world
        grip.copy(t.p).applyMatrix4(w.root.matrixWorld);
        F.copy(t.F).applyQuaternion(wq); N.copy(t.N).applyQuaternion(wq);
      } else if (side === 'left' && rl > 0 && !w.action) {
        // (a weapon without moving parts) support hand: grip -> magazine -> pouch -> magazine -> grip
        const mag = w.socketWorld('rightGrip', new THREE.Vector3()).lerp(w.socketWorld('leftGrip', _v), 0.45).addScaledVector(wu, -0.09);
        const pouch = b.chest.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, -0.32).addScaledVector(wr, -0.1).addScaledVector(wf, 0.12);
        const k = rl;
        const p = k < 0.2 ? grip.clone().lerp(mag, k / 0.2) : k < 0.45 ? mag.clone().lerp(pouch, (k - 0.2) / 0.25) : k < 0.75 ? pouch.clone().lerp(mag, (k - 0.45) / 0.3) : mag.clone().lerp(grip, (k - 0.75) / 0.25);
        grip = p;
        N = wu.clone(); F = wf.clone().addScaledVector(wr, 0.5);
      }
      // a hand doing something away from the gun (first-person grenade throw): world target blended over the grip
      const ov = this.handOverride?.[side];
      if (ov && ov.w > 0) { grip.lerp(ov.p, ov.w); F.lerp(ov.F, ov.w).normalize(); N.lerp(ov.N, ov.w).normalize(); }
      if (side === 'left' && opts.leftFree) weight = 0;
      const upper = b[`${side}Arm`], lower = b[`${side}ForeArm`], hand = b[`${side}Hand`];
      const L = this.handLocal[side];
      // desired hand world rotation from the grip frame
      const handQ = basisQuaternion(L.f, L.n, F, N);
      // wrist position so the palm centre sits on the grip surface
      const palmWorld = L.palm.clone().multiply(hand.getWorldScale(_v3)).applyQuaternion(handQ);
      const target = grip.clone().addScaledVector(N, -(t ? t.off : side === 'right' ? 0.024 : 0.028)).sub(palmWorld);
      const pole = upper.getWorldPosition(new THREE.Vector3());
      if (side === 'right') pole.addScaledVector(wr, 0.35).addScaledVector(UP, -0.55).addScaledVector(wf, -0.15);
      else pole.addScaledVector(wr, -0.25).addScaledVector(UP, -0.7).addScaledVector(wf, 0.1);
      solveTwoBone(upper, lower, hand, target, pole, weight);
      if (weight > 0) {
        const cur = hand.getWorldQuaternion(new THREE.Quaternion());
        setBoneWorldQuaternion(hand, cur.slerp(handQ, weight));
        if (!this.detail) this.#curlFingers(side, F, N, weight, t ? t.curl : 1);
      }
      if (this.debug) this.debug[side].copy(target);
    }
  }

  // Where the hands are this frame, in weapon space ({ p, q, F, N, off, curl } per side, null = on its grip):
  //  magazine reload (0.20 out with the support hand, 0.45 pouch, 0.70 seated; empty: charging handle / slide
  //  release at 0.88), bolt cycle after a shot (right hand on the knob), bolt-rifle stripper-clip reload.
  // The magazine and the stripper clip ride in the hand, so they are placed here too.
  #handTargets(rl) {
    const w = this.weapon, A = w.action, b = this.bones, S = w.sockets;
    const H = this.hands || (this.hands = { right: mkT(), left: mkT(), gR: mkT(), gL: mkT(), a: mkT(), c: mkT(), d: mkT(), out: { right: null, left: null } });
    const out = H.out; out.right = out.left = null;
    const inv = _hm.copy(w.root.matrixWorld).invert(), wqi = w.root.getWorldQuaternion(_hq).invert();
    setT(H.gR, S.rightGrip, _f1.fromArray(this.handFrames.right.F), _f2.fromArray(this.handFrames.right.N), 0.024, 1);
    setT(H.gL, S.leftGrip, _f1.fromArray(this.handFrames.left.F), _f2.fromArray(this.handFrames.left.N), 0.028, 1);
    // body frame in weapon space (pouches on the chest rig / belt)
    const bUp = _bu.copy(UP).applyQuaternion(wqi), bRight = _br.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw)).applyQuaternion(wqi);
    const bFwd = _bf.set(-Math.sin(this.bodyYaw), 0, -Math.cos(this.bodyYaw)).applyQuaternion(wqi);
    const chest = b.chest.getWorldPosition(_bc).applyMatrix4(inv), k = this.height / 1.8;
    const pouch = (up, right, fwd, target) => target.copy(chest).addScaledVector(bUp, up * k).addScaledVector(bRight, right * k).addScaledVector(bFwd, fwd * k);
    if (A.type === 'bolt') {
      const knob = w.knobWorld(_hk).applyMatrix4(inv);
      // the hand turns with the bolt as it is lifted
      _hq3.setFromAxisAngle(_Z, w.boltSide * (A.boltLift ?? 1.45) * w.boltLift);
      const onKnob = setT(H.a, knob, _f1.copy(FR.knob.F).applyQuaternion(_hq3), _f2.copy(FR.knob.N).applyQuaternion(_hq3), 0.02, 0.75);
      const clip = w.clip;
      if (!rl) {
        if (clip) clip.visible = false;
        if (w.boltHand > 0) out.right = mixT(H.right, H.gR, onKnob, w.boltHand);
        return out;
      }
      // stripper-clip reload, right hand: knob (open the bolt) -> ammo pouch -> clip into the guide, thumb the rounds
      // down (0.70) -> knob (close, 0.88) -> grip
      const pp = pouch(-0.25, 0.11, 0.16, _hp);
      const atPouch = setT(H.c, pp, FR.clip.F, FR.clip.N, 0.03, 0.6);
      const press = smooth(0.64, 0.7, rl) * (1 - smooth(0.7, 0.74, rl));
      const g = _hg.copy(S.clipGuide || knob);
      const atGuide = setT(H.d, _hp2.copy(g).addScaledVector(bUp, 0.04 - 0.03 * press).addScaledVector(bRight, 0.035), FR.clip.F, FR.clip.N, 0.025, 0.6);
      const from = w.rlFrom?.hand ? mixT(H.right, H.gR, onKnob, w.rlFrom.hand) : H.gR;
      let t;
      if (rl < 0.07) t = mixT(H.right, from, onKnob, smooth(0, 0.07, rl));
      else if (rl < 0.2) t = onKnob;
      else if (rl < 0.45) t = mixT(H.right, onKnob, atPouch, smooth(0.2, 0.42, rl));
      else if (rl < 0.7) t = mixT(H.right, atPouch, atGuide, smooth(0.45, 0.64, rl));
      else if (rl < 0.77) t = mixT(H.right, atGuide, onKnob, smooth(0.7, 0.77, rl));
      else if (rl < 0.88) t = onKnob;
      else t = mixT(H.right, onKnob, H.gR, smooth(0.88, 0.99, rl));
      out.right = t;
      if (clip) {
        // the clip rides in the fingers, sits in the guide while the rounds are thumbed down (0.64-0.70), and is
        // kicked out by the bolt going forward (0.80)
        clip.visible = rl > 0.43 && rl < 0.8;
        if (clip.visible) {
          if (rl < 0.64) {
            const k2 = smooth(0.45, 0.64, rl);
            clip.position.copy(t.p).addScaledVector(bUp, -0.04).addScaledVector(bRight, -0.035).lerp(g, k2 * k2);
            clip.quaternion.setFromAxisAngle(_f1.copy(bFwd), 0.9 * (1 - k2));
          } else { clip.position.copy(g); clip.quaternion.identity(); }
          const down = smooth(0.64, 0.7, rl);
          for (const r of clip.rounds) { r.visible = rl < 0.7; r.userData.y0 ??= r.position.y; r.position.y = r.userData.y0 - down * 0.05; }
        }
        if (rl >= 0.8 && !w.clipOut) { w.clipOut = true; w.eject('clip', 'clipGuide', _f1.set(0.45, 1, 0.25).normalize(), 1.6); }
        if (rl < 0.8) w.clipOut = false;
      }
      return out;
    }
    // ---- magazine reload (rifle / pistol)
    const P = w.parts;
    if (!P.mag) return out;
    if (!rl) {
      P.mag.o.visible = true; w.placeMag(null); if (P.magEmpty) P.magEmpty.o.visible = false;
      return out;
    }
    const pistol = A.type === 'pistol', empty = !!this.reloadEmpty, drop = pistol && empty;
    const pp = pistol ? pouch(-0.43, -0.1, 0.14, _hp) : pouch(-0.27, -0.07, 0.17, _hp);
    // magazine frame (weapon space): seat -> out along the well -> pouch | pouch -> under the well -> seat (0.70)
    const seat = S.magSeat, ax = w.magAxis, outLen = w.magOut;
    const qPouch = _hq2.setFromRotationMatrix(_hm2.makeBasis(bRight, bUp, _f1.copy(bFwd).negate())).multiply(_hq3.setFromAxisAngle(_X, -0.35));
    const mp = _mp, mq = _mq.identity();
    let which = 'mag';
    if (rl < 0.2) mp.copy(seat);
    else if (drop && rl < 0.45) {
      // speed reload: the empty magazine drops free of the grip and falls away
      which = 'magEmpty';
      const ts = (rl - 0.2) * (this.reloadDur || 1.9);
      mp.copy(seat).addScaledVector(ax, outLen * smooth(0.2, 0.24, rl) + 4.9 * ts * ts);
      mq.setFromAxisAngle(_X, -ts * 2.5);
    } else if (rl < 0.28) mp.copy(seat).addScaledVector(ax, outLen * smooth(0.2, 0.28, rl));
    else if (rl < 0.45) {
      const k2 = smooth(0.28, 0.45, rl);
      mp.copy(seat).addScaledVector(ax, outLen).lerp(pp, k2).addScaledVector(bFwd, 0.06 * Math.sin(k2 * Math.PI));
      mq.slerpQuaternions(_I, qPouch, k2);
      if (empty) which = 'magEmpty';
    } else if (rl < 0.62) {
      const k2 = smooth(0.45, 0.62, rl);
      mp.copy(pp).lerp(_hp2.copy(seat).addScaledVector(ax, outLen * 0.75), k2).addScaledVector(bFwd, 0.05 * Math.sin(k2 * Math.PI));
      mq.slerpQuaternions(qPouch, _I, k2);
    } else if (rl < 0.7) mp.copy(seat).addScaledVector(ax, outLen * 0.75 * (1 - eout(0.62, 0.7, rl)));
    else mp.copy(seat);
    const seated = rl < 0.2 || rl >= 0.7, gone = drop && rl > 0.34 && rl < 0.45; // (fallen out of sight)
    const node = which === 'magEmpty' && P.magEmpty ? 'magEmpty' : 'mag';
    if (P.magEmpty) P.magEmpty.o.visible = node === 'magEmpty' && !gone;
    P.mag.o.visible = node === 'mag' && !gone;
    w.placeMag(seated ? null : _hm3.compose(mp, mq, _one).premultiply(w.root.matrixWorld), node);
    if (node === 'magEmpty') w.placeMag(null, 'mag');
    // support hand on the magazine (seat frame -> weapon space)
    const hold = pistol ? FR.magPistol : FR.magRifle;
    const handOn = (pos, quat, T) => setT(T, _hp3.copy(w.magGrab).applyQuaternion(quat).add(pos), _f1.copy(hold.F).applyQuaternion(quat), _f2.copy(hold.N).applyQuaternion(quat), hold.off, 0.85);
    const onMag = handOn(mp, mq, H.a);
    let t;
    if (drop && rl < 0.45) t = rl < 0.1 ? H.gL : mixT(H.left, H.gL, handOn(pp, qPouch, H.c), smooth(0.1, 0.45, rl));
    else if (rl < 0.2) t = mixT(H.left, H.gL, onMag, smooth(0.02, 0.19, rl));
    else if (rl < 0.7) t = onMag;
    else if (!empty || pistol) t = mixT(H.left, onMag, H.gL, smooth(0.72, 0.9, rl)); // (pistol: thumb on the slide stop, 0.88)
    else {
      // empty rifle: hand over the top to the charging handle, pull it back (0.80-0.865), let go at 0.88
      const cg = _hp2.copy(S.chargeGrip || S.opticEye); cg.z += (A.chargeTravel ?? 0.07) * (rl < 0.875 ? w.chargeK : 1);
      const onCharge = setT(H.c, cg, FR.charge.F, FR.charge.N, 0.02, 0.9);
      t = rl < 0.875 ? mixT(H.left, onMag, onCharge, smooth(0.71, 0.8, rl)) : mixT(H.left, onCharge, H.gL, smooth(0.88, 0.99, rl));
    }
    out.left = t;
    return out;
  }

  #curlFingers(side, F, N, weight, amount = 1) {
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
        rotateBoneWorld(bn, _q.setFromAxisAngle(axis, angles[i] * weight * amount));
      }
    }
  }

  #deathLayer(dt) {
    const B = this.blend, p = this.poseRoot, b = this.bones;
    const t = B.death;
    // the body accelerates as it topples (gravity), knees give way first
    const e = t * t, buckle = smooth(0, 0.45, t);
    const k = this.height / 1.8;
    if (!this.deathTarget) {
      // lying direction: tip toward fallDir (body-local), flatter or steeper to match the ground under the head
      const f = this.fallDir;
      let tilt = Math.PI / 2;
      if (this.groundAt) {
        const r = this.root.position, wx = f.x * Math.cos(this.bodyYaw) + f.z * Math.sin(this.bodyYaw), wz = -f.x * Math.sin(this.bodyYaw) + f.z * Math.cos(this.bodyYaw);
        const gh = this.groundAt(r.x + wx * 1.4 * k, r.z + wz * 1.4 * k, r.y + 1);
        tilt -= Math.max(-0.5, Math.min(0.5, Math.atan2(gh - r.y, 1.4 * k)));
      }
      const axis = new THREE.Vector3().crossVectors(UP, f).normalize();
      this.deathTarget = this.diedProne
        ? this.deathFrom.clone().multiply(_q.setFromAxisAngle(_v.set(0, 1, 0), (Math.random() < 0.5 ? 1 : -1) * 0.3))
        : new THREE.Quaternion().setFromAxisAngle(axis, tilt);
    }
    p.quaternion.slerpQuaternions(this.deathFrom, this.deathTarget, this.diedProne ? smooth(0, 1, t) : e);
    // knees fold so the hips come down and back as the body goes over; a lying body rests on its own thickness
    const drop = this.diedProne ? 0 : 0.35 * buckle * (1 - e) * k;
    p.position.copy(this.deathPos).lerp(_v.set(0, this.diedProne ? this.deathPos.y : 0.12 * k, 0), this.diedProne ? 0 : e);
    p.position.y -= drop;
    p.position.addScaledVector(this.fallDir, -0.3 * buckle * k * (this.diedProne ? 0 : 1));
    // limp body: slack knees and hips, upper body folding at the waist
    if (b.leftUpLeg && !this.diedProne) {
      p.updateMatrixWorld(true);
      const R = _v2.set(1, 0, 0).applyQuaternion(p.getWorldQuaternion(_q2));
      // knees give way while falling, then the legs settle mostly straight once the body is down
      const fold = buckle * (1 - 0.75 * e);
      for (const [side, s] of [['left', 1], ['right', 0.6]]) {
        rotateBoneWorld(b[`${side}UpLeg`], _q.setFromAxisAngle(R, 0.45 * fold * s));
        rotateBoneWorld(b[`${side}Leg`], _q.setFromAxisAngle(R, -0.9 * fold * s));
      }
      for (const bn of b.spine) rotateBoneWorld(bn, _q.setFromAxisAngle(R, (this.fallDir.z < 0 ? -0.12 : 0.08) * buckle));
      if (b.head) rotateBoneWorld(b.head, _q.setFromAxisAngle(R, (this.fallDir.z < 0 ? -0.3 : 0.25) * buckle));
    }
    // limp arms: relax toward animation (no IK); the weapon falls and comes to rest flat on its side
    if (this.weapon) {
      const w = this.weapon.root, g0 = this.groundY ?? this.root.position.y;
      const g = (this.weaponInWorld && this.groundAt ? this.groundAt(w.position.x, w.position.z, g0 + 0.5) : g0) + 0.03;
      if (!this.dropped) {
        const f = _v.set(0, 0, -1).applyQuaternion(w.quaternion), yaw = Math.atan2(-f.x, -f.z) + (Math.random() - 0.5) * 0.8;
        this.dropped = { vy: 0.4, y0: w.position.y, q0: w.quaternion.clone(), q1: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2, 'YXZ')) };
      }
      const d = this.dropped;
      if (w.position.y > g) {
        d.vy -= 9.8 * dt;
        w.position.y = Math.max(g, w.position.y + d.vy * dt);
      }
      w.quaternion.slerpQuaternions(d.q0, d.q1, Math.min(1, Math.max(0, (d.y0 - w.position.y) / Math.max(0.05, d.y0 - g))));
    }
  }

  // from: world position of the shooter ({x, z}) — the body falls away from the hit; without one, a random way
  die(from = null) {
    if (this.state.dead) return;
    this.state.dead = true; this.dropped = null; this.groundY = this.root.position.y;
    let a = Math.random() * Math.PI * 2;
    if (from && Number.isFinite(from.x) && Number.isFinite(from.z)) {
      const r = this.root.position, dx = r.x - from.x, dz = r.z - from.z;
      if (dx * dx + dz * dz > 1e-4) a = Math.atan2(dx, dz) - this.bodyYaw + (Math.random() - 0.5) * 0.8; // world -> body frame, a little scatter
    }
    this.fallDir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    this.diedProne = this.blend.prone > 0.5;
    this.deathFrom = this.poseRoot.quaternion.clone();
    this.deathPos = this.poseRoot.position.clone();
    this.deathTarget = null;
    this.deathW = {};
    for (const [k, act] of Object.entries(this.actions)) this.deathW[k] = act.getEffectiveWeight();
    const sum = Object.values(this.deathW).reduce((s, w) => s + w, 0) || 1;
    for (const k in this.deathW) this.deathW[k] /= sum;
  }
  revive() { this.state.dead = false; this.blend.death = 0; this.dropped = null; this.deathTarget = null; this.poseRoot.quaternion.identity(); this.poseRoot.position.set(0, 0, 0); }
  hitReact() { this.blend.hit = 1; }
  // one round fired: the rifle kicks back into the shoulder and recovers (per shot, so full-auto reads as recoil)
  kick() { this.blend.recoil = Math.min(1, this.blend.recoil + 0.6); this.weapon?.fired(); }
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
