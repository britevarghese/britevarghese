// Realistic people: rigged, textured characters (public/assets/models/humans, imported by
// tools/import-humans.mjs) that all share one humanoid skeleton, animated with motion-captured clips
// (public/assets/anims/people.json, retargeted by tools/import-anims.mjs): idle, walk, jog and sprint
// blended by speed with the playback rate matched to the ground speed, plus one-shot actions (getting
// in and out of cars, jumping, stumbling). If the clips are missing, a procedural IK walk takes over.
// Used for the player on foot, other players on foot, mission contacts and the nearby pedestrians.
import * as THREE from 'three';
import { AssetManager, modelUrl } from '../assets/AssetManager.js';
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
// Kerala dress: men in a plain cotton shirt over dark trousers, khaki, or a white mundu; the women's own sarees and
// churidars. (The kurta and western-dress models are kept for the story's characters only.)
const KL_CROWD = ['pmariano', 'alex', 'arnold', 'jake', 'emilius', 'kl_elder', 'pmariano', 'alex', 'jake', 'kl_saree', 'kl_saree_pink', 'kl_saree', 'kl_saree_pink'];
const KL_SHIRTS = [0xf2f0ea, 0xf4f4f0, 0xa9c8e8, 0x8fb0d8, 0xe8c4c8, 0xe6dcc0, 0xc8ccd0, 0x6a8ab0, 0x8a3a3a, 0x3a5a3a, 0xd8c8a0, 0x4a4a6a];
const KL_LOWERS = [0x1f2430, 0x2e2e30, 0x23262c, 0x6a5a44, 0x3a4250, 0xf2efe6, 0xf2efe6, 0xece6d4];

export class HumanLibrary {
  // Kerala: the player's own look first, then the Kerala crowd instead of the city set
  constructor(assets, manifest, { kerala = false } = {}) {
    this.assets = assets; this.manifest = manifest; this.kerala = kerala;
    const base = manifest?.humans || [];
    const men = base.filter((h) => ['pmariano', 'alex', 'arnold', 'jake', 'emilius'].includes(h.id));
    this.list = kerala && manifest?.humansKL?.length ? [base[0], ...men, ...manifest.humansKL].filter(Boolean) : base;
    this.models = []; this.ready = false;
  }
  load(priority = 5) {
    if (this._job) return this._job;
    const anims = fetch('/assets/anims/people.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((a) => { this.anims = a; });
    this._job = Promise.all([anims, ...this.list.map((h) => this.assets.loadGLTF(modelUrl(this.manifest, h.file), priority).then((g) => ({ ...h, scene: g.scene })).catch(() => null))])
      .then(([, ...ms]) => {
        this.models = ms.filter(Boolean); this.ready = this.models.length > 0;
        if (this.kerala) { this.crowd = KL_CROWD.map((id) => this.models.find((m) => m.id === id)).filter(Boolean); if (!this.crowd.length) this.crowd = null; }
        this.men = (this.crowd || this.models.slice(1)).filter((m) => m.sex !== 'f');
        return this;
      });
    return this._job;
  }
  // AnimationClips for one model: the baked hips track is re-based on this model's own hip height, in character
  // space (y up), then taken into the hips' parent space (a Mixamo armature is often rotated and scaled)
  clipsFor(model, hips) {
    if (!this.anims) return null;
    model.clips ||= {};
    hips.parent.updateWorldMatrix(true, false);
    const toLocal = new THREE.Matrix4().copy(hips.parent.matrixWorld).invert();
    const rest = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
    const key = [...rest.toArray(), ...toLocal.elements].map((v) => v.toFixed(3)).join(',');
    if (model.clips[key]) return model.clips[key];
    const A = this.anims, ref = A.hipsRest, k = rest.y / ref[1], P = new THREE.Vector3();
    const out = {};
    for (const [name, c] of Object.entries(A.clips)) {
      const tracks = Object.entries(c.bones).map(([b, q]) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, c.times, q));
      const hp = new Float32Array(c.hips.length);
      for (let i = 0; i < c.hips.length; i += 3) {
        P.set(rest.x + (c.hips[i] - ref[0]) * k, rest.y + (c.hips[i + 1] - ref[1]) * k, rest.z + (c.hips[i + 2] - ref[2]) * k).applyMatrix4(toLocal);
        hp[i] = P.x; hp[i + 1] = P.y; hp[i + 2] = P.z;
      }
      tracks.push(new THREE.VectorKeyframeTrack('Hips.position', c.times, hp));
      const clip = new THREE.AnimationClip(name, c.duration, tracks);
      clip.userData = { loop: c.loop, speed: c.speed };
      out[name] = clip;
    }
    return (model.clips[key] = out);
  }
  // a new character; `which` = index or id (defaults to a deterministic pick from a number)
  // (Kerala: a number picks from the crowd, each one dressed in their own shirt and lower)
  create(which = 0, opts = {}) {
    if (!this.ready) return null;
    const L = typeof which === 'number' && this.crowd ? this.crowd : this.models;
    const m = typeof which === 'string' ? this.models.find((x) => x.id === which) || this.models[0] : L[((which % L.length) + L.length) % L.length];
    const outfit = opts.outfit ?? (this.kerala && typeof which === 'number' ? { top: KL_SHIRTS[(which * 7 + 3) % KL_SHIRTS.length], bottom: KL_LOWERS[(which * 5 + 1) % KL_LOWERS.length] } : null);
    return new Human(m, { ...opts, outfit, lib: this });
  }
  // a man from the crowd (drivers, riders)
  // (opts.outfit: a uniform; then only the avatars that can wear one)
  createMan(n = 0, opts = {}) {
    if (!this.ready || !this.men?.length) return this.create(n, opts);
    const L = opts.outfit ? this.men.filter((m) => !/^kl_/.test(m.id)) : this.men, M = L.length ? L : this.men;
    const m = M[((n % M.length) + M.length) % M.length];
    return new Human(m, { ...opts, outfit: opts.outfit ?? (this.kerala ? { top: KL_SHIRTS[(n * 7 + 3) % KL_SHIRTS.length], bottom: KL_LOWERS[(n * 5 + 1) % KL_LOWERS.length] } : null), lib: this });
  }
}

export class Human {
  constructor(model, { shadow = true, height, lib, idle = 'idle', outfit = null } = {}) {
    this.id = model.id;
    if (/^kl_/.test(model.id)) outfit = null;   // (the Kerala models wear their own mundu, saree or churidar)
    this.group = new THREE.Group();
    this.group.name = 'human_' + model.id;
    this.root = AssetManager.clone(model.scene);
    this.group.add(this.root);
    this.B = {};
    // a rig with no head-top bone gets one, a neck-length and a bit above the head (posing and sizing aim at it)
    let head = null, hasTop = false;
    this.root.traverse((o) => { if (!o.isBone) return; const n = o.name.replace(/^mixamorig\d*[:_]?/i, '').replace(/_\d+$/, ''); if (n === 'Head') head ||= o; if (n === 'HeadTop_End') hasTop = true; });
    if (head && !hasTop) { const b = new THREE.Bone(); b.name = 'HeadTop_End'; b.position.copy(head.position).multiplyScalar(1.8); head.add(b); }
    this.root.traverse((o) => {
      // (Ready Player Me and Mixamo rigs share bone names; Mixamo exports prefix them, e.g. mixamorig:Hips)
      if (o.isBone) { const n = o.name.replace(/^mixamorig\d*[:_]?/i, '').replace(/_\d+$/, ''); this.B[n] ||= o; o.userData.rest = o.quaternion.clone(); }
      if (o.isMesh) { o.castShadow = shadow; o.frustumCulled = false; }
      // dressed: a plain cotton shirt and trousers or mundu over the avatar's own outfit (its print and logos go)
      if (o.isMesh && outfit && o.material?.name) {
        const top = /Outfit_Top/i.test(o.material.name), bot = /Outfit_Bottom/i.test(o.material.name);
        if (top || bot) { const m = o.material.clone(); m.map = null; m.color.setHex(top ? outfit.top : outfit.bottom); m.roughness = 0.9; m.metalness = 0; o.material = m; }
        // (and black hair: no dyed blue or orange)
        if (/Hair|Beard/i.test(o.material.name) && !/^kl_/.test(model.id)) { const m = o.material.clone(); m.color.setHex(0x2a2622); o.material = m; }
      }
    });
    // normalise the height (the models are 1.74-1.87 m tall): men ~1.78 m, women ~1.66 m
    this.group.updateMatrixWorld(true);
    const top = wpos(this.B.HeadTop_End, new THREE.Vector3()).y;
    const want = height ?? (model.sex === 'f' ? 1.66 : 1.78);
    this.root.scale.multiplyScalar(want / top);
    this.group.updateMatrixWorld(true);
    // stand on the ground: models whose origin isn't at the soles (some sank to the knees, some floated) are moved
    // so the ankles sit at a normal ~9 cm
    const ank = Math.min(wpos(this.B.LeftFoot, new THREE.Vector3()).y, wpos(this.B.RightFoot, new THREE.Vector3()).y);
    if (Math.abs(ank - 0.09) > 0.035) { this.root.position.y += 0.09 - ank; this.group.updateMatrixWorld(true); }
    // and centred over the origin (one model was authored 2.3 m off it, so it walked and fell beside where it was)
    const hc = wpos(this.B.Hips, new THREE.Vector3());
    if (Math.hypot(hc.x, hc.z) > 0.15) { this.root.position.x -= hc.x; this.root.position.z -= hc.z; this.group.updateMatrixWorld(true); }
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
    // motion-captured clips (bones get clean names so the tracks bind)
    for (const [n, b] of Object.entries(B)) b.name = n;
    const clips = lib?.clipsFor(model, B.Hips);
    if (clips) {
      this.mixer = new THREE.AnimationMixer(this.root);
      this.acts = {};
      for (const [n, c] of Object.entries(clips)) {
        const a = this.mixer.clipAction(c);
        a.setLoop(c.userData.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = true;
        a.userData = c.userData;
        this.acts[n] = a;
      }
      this.idleName = this.acts[idle] ? idle : 'idle';
      for (const n of [this.idleName, 'walk', 'jog', 'sprint']) { const a = this.acts[n]; a.play(); a.setEffectiveWeight(n === this.idleName ? 1 : 0); a.time = Math.random() * a.getClip().duration; }
      this.shot = null; this.shotW = 0;
    }
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

  // one-shot action (sitEnter, sitExit, interact, jumpStart, jumpLand, hit, roll...); returns its length
  // in seconds. hold: keep the last frame until another action or clearAction(). rate: playback speed.
  play(name, { fade = 0.18, hold = false, rate = 1 } = {}) {
    const a = this.acts?.[name];
    if (!a) return 0;
    if (this.shot && this.shot !== a) this.shot.fadeOut(fade);
    a.reset(); a.setEffectiveTimeScale(rate); a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.shot = a; this.shotHold = hold; this.shotEnd = a.getClip().duration / rate;
    this.shotT = 0;
    return this.shotEnd;
  }
  clearAction(fade = 0.25) { if (this.shot) { this.shot.fadeOut(fade); this.shot = null; } }
  get busy() { return !!this.shot; }

  // speed m/s (ground speed); the caller has placed the group and updated its parents' matrices
  animate(speed, dt, airborne = false) {
    if (this.mixer) return this._animateClips(speed, dt, airborne);
    return this._animateIK(speed, dt);
  }

  // locomotion blend: idle -> walk -> jog -> sprint by speed, playback rate matched to the ground speed
  _animateClips(speed, dt, airborne) {
    const A = this.acts;
    this.speedS = lerp(this.speedS, speed, 1 - Math.exp(-dt * 10));
    const v = this.speedS;
    const seg = (x, a, b) => clamp((x - a) / (b - a), 0, 1);
    const wWalk = seg(v, 0.12, 0.9) * (1 - seg(v, 2.0, 3.0));
    const wJog = seg(v, 2.0, 3.0) * (1 - seg(v, 6.6, 7.8));
    const wSprint = seg(v, 6.6, 7.8);
    const wIdle = 1 - Math.max(wWalk, wJog, wSprint, seg(v, 0.12, 0.9));
    // a one-shot action takes over the whole body while it plays
    if (this.shot) {
      this.shotT += dt;
      if (!this.shotHold && this.shotT >= this.shotEnd - 0.15) this.clearAction(0.2);
    }
    const loco = this.shot ? 0 : 1;
    this.shotW = lerp(this.shotW, 1 - loco, 1 - Math.exp(-dt * 12));
    const k = 1 - this.shotW;
    const jl = airborne && A.jumpLoop && !this.shot;
    const set = (n, w, rate) => { const a = A[n]; if (!a) return; a.setEffectiveWeight(w * k * (jl ? 0 : 1)); if (rate) a.setEffectiveTimeScale(rate); };
    set(this.idleName, wIdle);
    set('walk', wWalk, clamp(v / (A.walk.userData.speed || 1.3), 0.75, 1.6));
    set('jog', wJog, clamp(v / (A.jog.userData.speed || 5), 0.7, 1.35));
    set('sprint', wSprint, clamp(v / (A.sprint.userData.speed || 8), 0.8, 1.3));
    if (A.jumpLoop) { if (jl && !A.jumpLoop.isRunning()) { A.jumpLoop.reset().play(); } A.jumpLoop.setEffectiveWeight(jl ? 1 : 0); }
    this.mixer.update(dt);
  }

  _animateIK(speed, dt) {
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
