// First-person viewmodel: the imported character's own arms/hands (head hidden) holding the imported weapon,
// placed in camera space. Hip <-> ADS interpolates position, rotation and FOV so the camera ends up exactly on
// the optic's eye point / sight axis. Scoped optics render a magnified picture-in-picture onto the eyepiece.
import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig.js';
import { WeaponModel } from '../weapons/WeaponModel.js';
import { makeMuzzleFlash } from '../fx/Effects.js';

const ease = (t) => t * t * (3 - 2 * t);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _ndc = new THREE.Vector3(), _wp = new THREE.Vector3(), _wv = new THREE.Vector3(), _wq = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(), _e1 = new THREE.Euler(), _tp = new THREE.Vector3();
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// reload pose per action type: pitch, yaw, roll (rad), x, y, z (m) at the height of the reload
const RELOAD_TILT = { rifle: [0.12, 0.2, -0.62, -0.1, 0.135, -0.14], pistol: [0.42, 0.28, 0.1, -0.03, 0.02, 0.02], bolt: [-0.04, 0.12, 0.45, -0.03, -0.02, -0.12] };
const _pv1 = new THREE.Vector3();

export class Viewmodel {
  constructor(assets, charLoaded, weaponLoaded, weaponKey, renderer, { quality = 'medium' } = {}) {
    this.assets = assets;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 20);
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x4a4238, 0.55);
    this.sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    this.sunTarget = new THREE.Object3D();
    this.sun.target = this.sunTarget;
    this.scene.add(this.hemi, this.sun, this.sunTarget);
    this.rig = new CharacterRig(assets, charLoaded, { firstPerson: true });
    this.rig.externalWeaponPlacement = true;
    this.scene.add(this.rig.root);
    // hide head/helmet (collapse head bone) and keep only what the camera would see
    if (this.rig.bones.head) this.rig.bones.head.scale.setScalar(0.0001);
    this.rig.meshes.forEach((m) => { if (/visor|helmet|head|face|hair|eye|mask|goggle/i.test(m.name)) m.visible = false; });
    this.rig.meshes.forEach((m) => { m.castShadow = false; });
    this.rig.root.updateMatrixWorld(true);
    this.eyeY = this.rig.bones.head.getWorldPosition(new THREE.Vector3()).y + 0.07;
    this.weapons = {};
    this.quality = quality;
    this.reloadEmpty = false; this.tps = false; this.worldCam = null; this.playerVel = new THREE.Vector3(); this.scopeShift = new THREE.Vector2();
    // spent cases leave the viewmodel's ejection port (camera space, own FOV): re-project them onto the same pixel
    // and distance in the world, so they fly on from where they are seen and land on the real ground
    this.ejectFP = (pos, vel, kind, q) => {
      const cam = this.worldCam;
      if (this.tps || !cam || !WeaponModel.sink) return;
      this.toWorld(pos, _wp, cam);
      _wv.copy(vel).applyQuaternion(cam.quaternion).add(this.playerVel);
      WeaponModel.sink.brass(_wp, _wv, kind, _wq.copy(cam.quaternion).multiply(q));
    };
    // the muzzle flash lights the gun and the hands for a moment
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
    this.scene.add(this.flashLight);
    this.flashT = 0;
    // grenade throw: an M67 in the right hand (wind-up, overarm throw, the spoon flies off at release)
    this.throwT = -1e9;
    this.ov = { p: new THREE.Vector3(), F: new THREE.Vector3(), N: new THREE.Vector3(), w: 0 };
    this.rig.handOverride = { right: this.ov };
    assets.loadWeapon('grenade').then((l) => {
      this.nade = assets.clone(l.gltf); this.nade.getObjectByName('m67_pin')?.removeFromParent();
      this.nade.visible = false; this.nade.traverse((o) => { o.castShadow = false; }); this.scene.add(this.nade);
    }).catch(() => {});
    this.setWeapon(weaponKey, weaponLoaded);
    this.ads = 0; this.adsTarget = 0;
    this.sway = new THREE.Vector2(); this.swayVel = new THREE.Vector2();
    this.recoil = { z: 0, pitch: 0, yaw: 0, vz: 0, vp: 0, vy: 0 };
    this.bobT = 0; this.sprint = 0; this.switchT = 1; this.reload = 0; this.move = 0; this.crouch = 0;
    this.lightShade = 1;
    this.scopeRT = null;
    this.renderer = renderer;
  }

  throwNade() { this.throwT = performance.now(); this.spoonOut = false; }

  // right hand through the throw (camera space): grip -> wind-up beside the head -> release ahead -> follow-through
  #throwPose() {
    const t = (performance.now() - this.throwT) / 1000, ov = this.ov;
    ov.w = t > 0.75 ? 0 : smooth01(0, 0.1, t) * (1 - smooth01(0.5, 0.75, t));
    if (this.nade) this.nade.visible = ov.w > 0.3 && t < 0.27;
    if (ov.w <= 0) return 0;
    const k1 = smooth01(0.06, 0.2, t), k2 = smooth01(0.2, 0.3, t), k3 = smooth01(0.3, 0.45, t);
    ov.p.set(0.24, -0.04, 0.02).lerp(_tp.set(0.07, 0.05, -0.45), k2).lerp(_tp.set(0.02, -0.25, -0.3), k3);
    if (k1 < 1) ov.p.lerp(_tp.set(0.22, -0.2, -0.25), 1 - k1);
    ov.F.set(0.05, 0.9, 0.3).lerp(_tp.set(0, 0.2, -1), k2).normalize();
    ov.N.set(-0.2, 0.2, -1).lerp(_tp.set(-0.1, -1, -0.2), k2).normalize();
    return ov.w;
  }

  // a point in viewmodel (camera) space -> the world point on the same pixel at the same distance from the eye
  toWorld(p, out = new THREE.Vector3(), cam = this.worldCam) {
    const d = p.length();
    _ndc.copy(p).project(this.camera);
    return out.set(_ndc.x, _ndc.y, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(d).add(cam.position);
  }

  setWeapon(key, loaded) {
    if (!this.weapons[key]) this.weapons[key] = new WeaponModel(this.assets, loaded, { key, firstPerson: true });
    const w = this.weapons[key];
    if (this.weapon) { this.weapon.root.removeFromParent(); if (this.weapon.flash) this.weapon.flash.visible = false; }
    this.weapon = w;
    this.scene.add(w.root);
    this.rig.equip(w);
    w.onEject = this.ejectFP;
    if (!w.flash) {
      // first-person muzzle flash, at the muzzle (bore along -Z)
      w.flash = makeMuzzleFlash(w.action?.type || 'rifle');
      w.flash.position.copy(w.sockets.muzzle);
      w.root.add(w.flash);
    }
    this.rig.weaponInWorld = true;
    w.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.switchT = 0;
    this.weaponKey = key;
    // hip & ADS poses in camera space
    const pistol = key === 'pistol';
    // (pistol: a two-handed ready hold, arms half extended in front of the chest)
    this.hip = { pos: pistol ? new THREE.Vector3(0.12, -0.155, -0.42) : new THREE.Vector3(0.16, -0.205, -0.2), rot: new THREE.Euler(pistol ? 0.02 : 0.03, pistol ? 0.05 : 0.07, pistol ? 0.0 : 0.08) };
    // a tall optic (red dot on a riser above a pistol grip) sits the rifle lower in the hands at the hip, so the sight
    // stays down in the corner of the view instead of filling it
    if (!pistol && w.sockets.opticEye && w.sockets.rightGrip) this.hip.pos.y -= Math.max(0, w.sockets.opticEye.y - w.sockets.rightGrip.y - 0.1);
    // body offset so shoulders sit just behind/below the eye
    // (shoulder joints ~0.2 m under the eye, as in a real body: the arms run up to the gun from below the view
    // instead of filling it)
    this.bodyOffset = new THREE.Vector3(pistol ? 0 : 0.02, -0.1, pistol ? 0.04 : 0.02);
  }

  // Where the weapon's reference point (rightGrip for hip, opticEye for ADS) goes, in camera space
  #weaponMatrix(dt, s) {
    const w = this.weapon;
    const a = ease(this.ads);
    // hip: place the rightGrip at hip.pos; ADS: place opticEye at the camera origin looking down -Z
    const hipQ = new THREE.Quaternion().setFromEuler(this.hip.rot);
    const hipPos = this.hip.pos.clone().sub(w.sockets.rightGrip.clone().applyQuaternion(hipQ));
    const adsQ = new THREE.Quaternion();
    const adsPos = w.sockets.opticEye.clone().negate();
    const q = hipQ.slerp(adsQ, a);
    const p = hipPos.lerp(adsPos, a);
    // procedural motion (scaled down while aiming)
    const k = 1 - a * 0.85;
    const t = performance.now() / 1000;
    const breathe = (s.moving ? 0.3 : 1) * (0.0035 * Math.sin(t * 1.3)) * (a > 0.5 ? 0.35 : 1);
    const bx = Math.sin(this.bobT) * 0.012 * this.move * k, by = -Math.abs(Math.cos(this.bobT)) * 0.009 * this.move * k;
    p.x += bx + this.sway.x * 0.012 * k; p.y += by + breathe + this.sway.y * 0.012 * k;
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.sway.y * 0.035 * k + breathe * 0.6, -this.sway.x * 0.045 * k, this.sway.x * 0.03 * k)));
    // working the bolt: the rifle rolls a little onto its right side and dips, so the bolt comes up to the hand
    const bh = this.weapon.boltHand || 0;
    // (looking through the scope: the eye comes off axis while the bolt is worked — the scope shadow swims, px)
    this.scopeShift.set(bh * 30 * Math.sin((this.weapon.cycleU || 0) * 9), bh * 22 * (0.6 + 0.4 * Math.cos((this.weapon.cycleU || 0) * 7)));
    if (bh > 0) {
      q.multiply(_q1.setFromEuler(_e1.set(-0.06 * bh, 0.05 * bh, -0.24 * bh)));
      p.x += 0.01 * bh; p.y -= 0.03 * bh * k; p.z -= 0.03 * bh * k;
    }
    // sprint: off the shoulder, carried low across the body, muzzle down and to the left (turned about the firing
    // hand so the stock drops away instead of swinging into the face); a pistol is just lowered
    if (this.sprint > 0.01) {
      const sp = ease(this.sprint), pistol = this.weaponKey === 'pistol';
      const pv = _pv1.copy(w.sockets.rightGrip).applyQuaternion(q).add(p);
      q.multiply(_q1.setFromEuler(_e1.set((pistol ? -0.55 : -0.4) * sp, (pistol ? 0.3 : 0.62) * sp, (pistol ? 0.2 : 0.45) * sp)));
      p.copy(pv).sub(_pv1.copy(w.sockets.rightGrip).applyQuaternion(q));
      p.x += (pistol ? 0 : -0.03) * sp; p.y -= (pistol ? 0.06 : 0.04) * sp; p.z -= (pistol ? 0 : 0.1) * sp;
    }
    // recoil (kick back + muzzle rise), recovers via spring
    p.z += this.recoil.z; p.y += this.recoil.z * 0.15;
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.recoil.pitch, this.recoil.yaw, this.recoil.yaw * 0.6)));
    // reload: the gun comes off the shoulder and turns to the working hand — magazine well toward the support hand
    // (rifle: rolled onto its left side; pistol: muzzle up, grip out), the bolt rifle's receiver top and bolt to
    // the right hand. Back on target as the reload finishes.
    if (this.reload > 0 && this.reload < 1) {
      const rl = this.reload, type = this.weapon.action?.type || 'rifle', T = RELOAD_TILT[type] || RELOAD_TILT.rifle;
      // (the bolt rifle comes off the shoulder at once and stays out until the bolt is closed: the hand works it
      // at arm's length, not in front of the eye)
      const r = type === 'bolt' ? ease(Math.min(1, rl / 0.1)) * (1 - ease(Math.max(0, (rl - 0.88) / 0.12))) : Math.sin(Math.min(1, rl * 1.15) * Math.PI);
      // empty rifle: off the shoulder, pushed out and tipped up so the support hand can work the charging handle
      const e = this.reloadEmpty && type === 'rifle' ? ease(Math.min(1, Math.max(0, (rl - 0.72) / 0.08))) * (1 - ease(Math.min(1, Math.max(0, (rl - 0.88) / 0.1)))) : 0;
      // (turned about the firing hand, not the middle of the gun)
      const pv = _pv1.copy(w.sockets.rightGrip).applyQuaternion(q).add(p);
      q.multiply(_q1.setFromEuler(_e1.set(T[0] * r - 0.12 * e, T[1] * r + 0.3 * e, T[2] * r + 0.5 * e)));
      p.copy(pv).sub(_pv1.copy(w.sockets.rightGrip).applyQuaternion(q));
      p.x += T[3] * r - 0.06 * e; p.y += T[4] * r - 0.02 * e; p.z += T[5] * r - 0.18 * e;
    }
    // grenade throw: the rifle drops away to the left, held in the support hand
    const tw = this.ov.w;
    if (tw > 0) { q.multiply(_q1.setFromEuler(_e1.set(-0.22 * tw, 0.22 * tw, 0.35 * tw))); p.x -= 0.06 * tw; p.y -= 0.05 * tw; }
    // weapon switch: raise from below
    const sw = 1 - ease(Math.min(1, this.switchT));
    p.y -= sw * 0.3; q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-sw * 0.9, 0, 0)));
    // crouch / land dip
    p.y -= this.crouch * 0.01;
    return { p, q };
  }

  kick(def) {
    this.weapon.fired(); // case out / slide back / bolt cycle
    // a different flame every shot: turned about the bore, sized, for about two frames
    const f = this.weapon.flash;
    f.visible = true; f.rotation.z = Math.random() * Math.PI * 2; f.scale.setScalar(0.75 + Math.random() * 0.5);
    f.star.rotation.z = Math.random() * Math.PI * 2;
    this.flashT = 0.034;
    this.flashLight.position.copy(this.weapon.sockets.muzzle).applyMatrix4(this.weapon.root.matrixWorld);
    this.flashLight.intensity = def.id === 'sniper' ? 2.2 : 1.2;
    const r = this.recoil, a = this.ads > 0.5;
    r.vz += (a ? 0.45 : 0.9) * Math.min(2, def.recoil.pitch + 0.4);
    r.vp += (a ? 1.1 : 2.0) * def.recoil.pitch;
    r.vy += (Math.random() - 0.5) * def.recoil.yaw * 3;
  }

  // s: { ads, moving (0..1 speed factor), sprint, firing, mouseDX, mouseDY, reload (0..1 or 0), crouch, camera, baseFov, speed }
  update(dt, s) {
    this.adsTarget = s.ads ? 1 : 0;
    const adsTime = s.adsTime || 0.22;
    this.ads += Math.sign(this.adsTarget - this.ads) * Math.min(Math.abs(this.adsTarget - this.ads), dt / adsTime);
    this.move = damp(this.move, s.moving || 0, 8, dt);
    this.bobT += dt * (5.5 + 4 * (s.speedFactor || 0)) * (this.move > 0.05 ? 1 : 0);
    this.sprint = damp(this.sprint, s.sprint ? 1 : 0, 9, dt);
    this.switchT += dt * 2.6;
    // empty reloads (charging handle / slide release) are known at the start: the magazine was empty
    if (s.reload > 0 && !(this.reload > 0)) this.reloadEmpty = s.mag === 0;
    this.reload = s.reload || 0;
    this.tps = !!s.tps; this.worldCam = s.camera || null;
    this.playerVel.set(s.vx || 0, s.vy || 0, s.vz || 0);
    this.crouch = damp(this.crouch, s.crouch ? 1 : 0, 8, dt);
    // sway: weapon lags behind mouse motion, spring back
    const tx = -(s.mouseDX || 0) * 0.02, ty = (s.mouseDY || 0) * 0.02;
    this.sway.x = damp(this.sway.x, Math.max(-1.5, Math.min(1.5, tx)), 9, dt);
    this.sway.y = damp(this.sway.y, Math.max(-1.5, Math.min(1.5, ty)), 9, dt);
    // recoil springs
    const r = this.recoil;
    for (const [x, v, k, c] of [['z', 'vz', 170, 17], ['pitch', 'vp', 160, 15], ['yaw', 'vy', 150, 16]]) {
      r[v] += (-k * r[x] - c * r[v]) * dt; r[x] += r[v] * dt;
    }
    const { p, q } = this.#weaponMatrix(dt, s);
    this.weapon.root.position.copy(p);
    this.weapon.root.quaternion.copy(q);
    this.weapon.root.updateMatrixWorld(true);
    // body: eye at origin
    const rig = this.rig;
    rig.setState({ speed: 0, aimYaw: 0, pitch: 0, stance: 'stand', reload: this.reload, sprint: false });
    rig.mag = s.mag ?? 1; rig.reloadEmpty = this.reloadEmpty;
    rig.root.position.set(this.bodyOffset.x, -this.eyeY + this.bodyOffset.y - this.sprint * 0.03, this.bodyOffset.z);
    this.#throwPose();
    rig.update(dt);
    if (this.nade?.visible) {
      // the grenade sits in the palm of the throwing hand; the spoon pops off as it leaves the hand
      const hand = rig.bones.rightHand, L = rig.handLocal.right;
      hand.localToWorld(this.nade.position.copy(L.palm)).addScaledVector(this.ov.N, 0.04);
      hand.getWorldQuaternion(this.nade.quaternion);
    } else if (this.nade && !this.spoonOut && performance.now() - this.throwT > 260 && performance.now() - this.throwT < 450) {
      this.spoonOut = true;
      if (this.worldCam && WeaponModel.sink) WeaponModel.sink.brass(this.toWorld(this.nade.position, _wp), _wv.set(0.6, 2.2, 0.4).applyQuaternion(this.worldCam.quaternion), 'spoon', this.worldCam.quaternion);
    }
    // slide / bolt slammed home (slide release, charging handle let go, bolt handle down): a small jolt
    const slam = this.weapon.slamT;
    if (slam && slam !== this.lastSlam) { this.lastSlam = slam; r.vz += 0.1; r.vp += 0.22; r.vy += (Math.random() - 0.5) * 0.1; }
    // collapse the head (helmet/visor/face) into the chest, behind the near plane, so it never occludes the view
    const head = rig.bones.head;
    head.scale.setScalar(0.0001);
    head.position.copy(head.parent.worldToLocal(new THREE.Vector3(0, -0.45, 0.35)));
    head.updateMatrixWorld(true);
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) { this.weapon.flash.visible = false; this.flashLight.intensity = 0; }
    if (this.weapon.scopeDisc) this.weapon.scopeDisc.visible = this.ads > 0.92;
    if (this.weapon.reticle) this.weapon.reticle.visible = this.ads > 0.5;
    // FOV: viewmodel keeps a stable FOV; the world camera zooms (handled by caller using fovScale)
    this.fovScale = 1 + ((s.adsFov || 0.75) - 1) * ease(this.ads);
    // match world lighting direction
    if (s.sunDir && s.camera) {
      const inv = s.camera.quaternion.clone().invert();
      const d = s.sunDir.clone().applyQuaternion(inv);
      this.sun.position.copy(d).multiplyScalar(5);
      this.sunTarget.position.set(0, 0, 0);
      this.lightShade = damp(this.lightShade, s.shade ?? 1, 4, dt);
      this.sun.intensity = 2.2 * this.lightShade;
      this.hemi.intensity = 0.35 + 0.35 * this.lightShade;
    }
    if (s.env) this.scene.environment = s.env;
    this.scene.environmentIntensity = 0.55 + 0.45 * this.lightShade;
  }

  // Render world (by caller) then this. For scopes, render a magnified PiP of the world first.
  renderScope(renderer, worldScene, worldCamera, baseFov) {
    const w = this.weapon;
    if (!w.scopeDisc || !w.scopeDisc.visible) return;
    const size = this.quality === 'verylow' ? 256 : this.quality === 'low' ? 384 : this.quality === 'high' || this.quality === 'ultra' ? 1024 : 640;
    if (!this.scopeRT) {
      this.scopeRT = new THREE.WebGLRenderTarget(size, size, { samples: 0 });
      this.scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
      this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.1, 1500);
    }
    // every weapon model has its own eyepiece disc (switching weapons / respawning builds a new one): it must get
    // the magnified picture too, otherwise it shows as a plain white disc
    if (w.scopeDisc.userData.rt !== this.scopeRT) {
      w.scopeDisc.userData.rt = this.scopeRT;
      w.scopeDisc.material = new THREE.ShaderMaterial({
        uniforms: { map: { value: this.scopeRT.texture } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform sampler2D map; varying vec2 vUv;
          void main(){
            vec2 c = vUv - 0.5; float r = length(c) * 2.0;
            vec3 col = texture2D(map, vUv).rgb;
            // PSO-style reticle: posts + chevron + fine crosshair
            float line = 0.0; float px = 0.006;
            line += step(abs(c.y), px) * step(0.12, abs(c.x));
            line += step(abs(c.x), px * 1.2) * step(0.1, -c.y) ;
            float chev = step(abs(abs(c.x) + c.y * 0.9 - 0.0), px * 1.3) * step(-0.05, c.y) * step(c.y, 0.0) * step(abs(c.x), 0.05);
            line += chev;
            line += step(abs(c.x), px * 0.4) * step(abs(c.y), 0.09) * step(0.03, abs(c.y)) * 0.8;
            col = mix(col, vec3(0.02), clamp(line, 0.0, 1.0));
            // vignette + lens edge
            col *= smoothstep(1.0, 0.82, r);
            col += vec3(0.02, 0.03, 0.04) * smoothstep(0.6, 1.0, r);
            if (r > 1.0) discard;
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
    }
    const cam = this.scopeCam;
    worldCamera.getWorldPosition(cam.position);
    // aim along the actual sight axis of the (recoiling) weapon, expressed in world space
    const q = this.weapon.root.quaternion.clone();
    cam.quaternion.copy(worldCamera.quaternion).multiply(q);
    cam.fov = baseFov / this.weapon.magnification;
    cam.updateProjectionMatrix();
    renderer.setRenderTarget(this.scopeRT);
    renderer.render(worldScene, cam);
    renderer.setRenderTarget(null);
  }

  render(renderer, worldScene, worldCamera, baseFov = 75) {
    const ac = renderer.autoClear;
    this.renderScope(renderer, worldScene, worldCamera, baseFov);
    renderer.autoClear = true;
    renderer.render(worldScene, worldCamera);
    renderer.autoClear = false;
    renderer.clearDepth();
    this.camera.aspect = worldCamera.aspect;
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}
