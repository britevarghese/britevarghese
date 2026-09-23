// First-person viewmodel: the imported character's own arms/hands (head hidden) holding the imported weapon,
// placed in camera space. Hip <-> ADS interpolates position, rotation and FOV so the camera ends up exactly on
// the optic's eye point / sight axis. Scoped optics render a magnified picture-in-picture onto the eyepiece.
import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig.js';
import { WeaponModel } from '../weapons/WeaponModel.js';

const ease = (t) => t * t * (3 - 2 * t);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

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
    this.setWeapon(weaponKey, weaponLoaded);
    this.ads = 0; this.adsTarget = 0;
    this.sway = new THREE.Vector2(); this.swayVel = new THREE.Vector2();
    this.recoil = { z: 0, pitch: 0, yaw: 0, vz: 0, vp: 0, vy: 0 };
    this.bobT = 0; this.sprint = 0; this.switchT = 1; this.reload = 0; this.move = 0; this.crouch = 0;
    this.lightShade = 1;
    this.scopeRT = null;
    this.renderer = renderer;
  }

  setWeapon(key, loaded) {
    if (!this.weapons[key]) this.weapons[key] = new WeaponModel(this.assets, loaded, { key, firstPerson: true });
    const w = this.weapons[key];
    if (this.weapon) this.weapon.root.removeFromParent();
    this.weapon = w;
    this.scene.add(w.root);
    this.rig.equip(w);
    this.rig.weaponInWorld = true;
    w.root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.switchT = 0;
    this.weaponKey = key;
    // hip & ADS poses in camera space
    const pistol = key === 'pistol';
    this.hip = { pos: pistol ? new THREE.Vector3(0.13, -0.19, -0.38) : new THREE.Vector3(0.16, -0.205, -0.2), rot: new THREE.Euler(pistol ? 0.03 : 0.03, pistol ? 0.06 : 0.07, pistol ? 0.02 : 0.08) };
    // body offset so shoulders sit just behind/below the eye
    this.bodyOffset = new THREE.Vector3(0.02, -0.02, pistol ? 0.05 : 0.02);
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
    // sprint low-ready
    if (this.sprint > 0.01) {
      const sp = ease(this.sprint);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32 * sp, 0.55 * sp, 0.35 * sp)));
      p.x += 0.02 * sp; p.y -= 0.045 * sp; p.z += 0.03 * sp;
    }
    // recoil (kick back + muzzle rise), recovers via spring
    p.z += this.recoil.z; p.y += this.recoil.z * 0.15;
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.recoil.pitch, this.recoil.yaw, this.recoil.yaw * 0.6)));
    // reload tilt
    if (this.reload > 0 && this.reload < 1) {
      const r = Math.sin(Math.min(1, this.reload * 1.15) * Math.PI);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22 * r, 0.25 * r, 0.6 * r)));
      p.y -= 0.03 * r; p.x -= 0.02 * r;
    }
    // weapon switch: raise from below
    const sw = 1 - ease(Math.min(1, this.switchT));
    p.y -= sw * 0.3; q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-sw * 0.9, 0, 0)));
    // crouch / land dip
    p.y -= this.crouch * 0.01;
    return { p, q };
  }

  kick(def) {
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
    this.reload = s.reload || 0;
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
    rig.root.position.set(this.bodyOffset.x, -this.eyeY + this.bodyOffset.y - this.sprint * 0.03, this.bodyOffset.z);
    rig.update(dt);
    // collapse the head (helmet/visor/face) into the chest, behind the near plane, so it never occludes the view
    const head = rig.bones.head;
    head.scale.setScalar(0.0001);
    head.position.copy(head.parent.worldToLocal(new THREE.Vector3(0, -0.45, 0.35)));
    head.updateMatrixWorld(true);
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
    const size = this.quality === 'low' ? 384 : 640;
    if (!this.scopeRT) {
      this.scopeRT = new THREE.WebGLRenderTarget(size, size, { samples: 0 });
      this.scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
      this.scopeCam = new THREE.PerspectiveCamera(10, 1, 0.1, 1500);
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
