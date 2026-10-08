// A pistol on foot, GTA-style: 1 (d-pad down) draws / holsters it; hold the right mouse button (left trigger) to
// aim over the shoulder with a crosshair, left click (Q, B) fires, R (LB) reloads. Shots are rays from the camera
// through the crosshair: they stop at walls, buildings, vehicles and the ground, and drop the people they hit.
// The arms are aimed on top of the walking clip (the legs keep walking); gunfire scatters the street and the
// police hear it.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const MAG = 12, RANGE = 90, RATE = 0.16;
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.25, 'rgba(255,214,120,0.9)'); g.addColorStop(1, 'rgba(255,140,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Pistol {
  constructor(game, onFoot) {
    this.g = game; this.of = onFoot;
    this.armed = false; this.aim = 0; this.mag = MAG; this.reserve = 96;
    this.cd = 0; this.reloadT = 0; this.raise = 0; this.flashT = 0; this.tracerT = 0;
    // the gun: slide, frame, grip and trigger guard (dark steel), barrel along +z
    const steel = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.42, metalness: 0.75 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8, metalness: 0.1 });
    const gun = new THREE.Group();
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.032, 0.19), steel); slide.position.set(0, 0.022, 0.045); gun.add(slide);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.018, 0.15), steel); frame.position.set(0, -0.002, 0.03); gun.add(frame);
    const g2 = new THREE.Mesh(new THREE.BoxGeometry(0.029, 0.1, 0.045), grip); g2.position.set(0, -0.05, -0.025); g2.rotation.x = 0.28; gun.add(g2);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 4, 10, Math.PI), steel); guard.rotation.set(Math.PI, Math.PI / 2, 0); guard.position.set(0, -0.012, 0.03); gun.add(guard);
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    gun.visible = false;
    this.gun = gun; game.scene.add(gun);
    // muzzle flash, tracer, impact spark
    const glow = glowTexture();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.28); this.flash.visible = false; game.scene.add(this.flash);
    this.spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.spark.scale.setScalar(0.18); this.spark.visible = false; game.scene.add(this.spark);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.tracer = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracer.frustumCulled = false; this.tracer.visible = false; game.scene.add(this.tracer);
    // HUD: crosshair and ammo
    const hud = document.body;
    this.cross = document.createElement('div');
    this.cross.style.cssText = 'position:fixed;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border:2px solid rgba(255,255,255,0.85);border-radius:50%;box-shadow:0 0 3px rgba(0,0,0,0.7);pointer-events:none;display:none;z-index:5';
    const dot = document.createElement('div'); dot.style.cssText = 'position:absolute;left:50%;top:50%;width:3px;height:3px;margin:-1.5px 0 0 -1.5px;background:#fff;border-radius:50%';
    this.cross.appendChild(dot); hud.appendChild(this.cross);
    this.ammo = document.createElement('div');
    this.ammo.style.cssText = 'position:fixed;right:24px;bottom:150px;font:600 20px/1 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000;pointer-events:none;display:none;z-index:5;letter-spacing:1px';
    hud.appendChild(this.ammo);
  }

  holster() { this.armed = false; this.aim = 0; this.raise = 0; this.reloadT = 0; this.gun.visible = false; this.cross.style.display = 'none'; this.ammo.style.display = 'none'; }

  // per frame on foot, before movement. Returns true while the gun is in hand (punches are off).
  update(dt, input) {
    const of = this.of, g = this.g, c = input.controls;
    this.cd = Math.max(0, this.cd - dt); this.raise = Math.max(0, this.raise - dt);
    if (input.consume('weapon') && !of.dead) { if (this.armed) this.holster(); else { this.armed = true; of.human?.clearAction(0.1); } }
    if (!this.armed) return false;
    const aiming = !!c.aim && !of.dead;
    this.aim += ((aiming || this.raise > 0 ? 1 : 0) - this.aim) * (1 - Math.exp(-dt * 14));
    // reload: on R, or pulling the trigger on an empty magazine
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { const n = Math.min(MAG - this.mag, this.reserve); this.mag += n; this.reserve -= n; }
    } else if ((input.consume('reload') && this.mag < MAG && this.reserve > 0)) this._reload();
    if (input.consume('attack') && this.reloadT <= 0 && this.cd <= 0) {
      if (this.mag > 0) this._fire();
      else if (this.reserve > 0) this._reload();
      else { g.audio?.playEvent('dryFire', { position: this._handPos(_a) }); this.cd = 0.25; }
    }
    this.cross.style.display = this.aim > 0.6 ? 'block' : 'none';
    this.ammo.style.display = 'block';
    this.ammo.textContent = this.reloadT > 0 ? 'RELOADING' : `${this.mag} / ${this.reserve}`;
    // effects fade
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    if (this.tracerT > 0) { this.tracerT -= dt; this.tracer.material.opacity = Math.max(0, this.tracerT / 0.07) * 0.8; this.spark.material.opacity = this.tracer.material.opacity; if (this.tracerT <= 0) { this.tracer.visible = false; this.spark.visible = false; } }
    return true;
  }

  _reload() {
    this.reloadT = 1.4; this.raise = 0;
    this.of.human?.play('pistolReload', { rate: 1.2, fade: 0.1 });
    this.g.audio?.playEvent('reload', { position: this._handPos(_a) });
  }

  // where the camera's crosshair points: origin and direction (unit)
  aimRay(o, d) { const cam = this.g.camera; o.copy(cam.position); cam.getWorldDirection(d); }

  _fire() {
    const g = this.g, of = this.of, s = of.state;
    this.mag--; this.cd = RATE; this.raise = 0.9;
    of.recoil = 1;
    this.aimRay(_o, _d);
    // a touch of spread, more when firing from the hip or moving
    const spread = (this.aim > 0.8 ? 0.004 : 0.03) + Math.min(0.02, s.speed * 0.004);
    _d.x += (Math.random() - 0.5) * spread; _d.y += (Math.random() - 0.5) * spread; _d.z += (Math.random() - 0.5) * spread; _d.normalize();
    const hit = this._trace(_o, _d);
    const muzzle = this._muzzle(_a);
    // effects: flash, tracer from the muzzle to the hit, spark where it struck, the bang
    this.flash.position.copy(muzzle); this.flash.visible = true; this.flash.material.rotation = Math.random() * 6; this.flashT = 0.05;
    _t.copy(_o).addScaledVector(_d, hit.t);
    const P = this.tracer.geometry.attributes.position;
    P.setXYZ(0, muzzle.x, muzzle.y, muzzle.z); P.setXYZ(1, _t.x, _t.y, _t.z); P.needsUpdate = true;
    this.tracer.visible = true; this.tracerT = 0.07; this.tracer.material.opacity = 0.8;
    if (hit.kind !== 'none' && hit.kind !== 'ped') { this.spark.position.copy(_t); this.spark.visible = true; this.spark.material.opacity = 0.8; g.audio?.playEvent('ricochet', { position: { x: _t.x, y: _t.y, z: _t.z } }); }
    g.audio?.playEvent('gunshot', { position: { x: muzzle.x, y: muzzle.y, z: muzzle.z } });
    g.camCtl?.addShake?.(0.05);
    g.input.rumble?.(0.5, 0.3, 60);
    if (hit.kind === 'ped') g.peds.shoot(hit.p, _d.x, _d.z, hit.head);
    if (hit.kind === 'car' && hit.c.state === 'drive') hit.c.speedFactor = Math.min(1.6, (hit.c.speedFactor || 1) * 1.25); // the driver floors it
    // the street scatters; a cop who hears it comes
    g.peds?.panic(s.x, s.z, 45);
    g.police?.reportInfraction?.('gunfire', 3, 140);
    bus.emit('player:shot', { x: s.x, z: s.z, hit: hit.kind });
  }

  // the first thing along the ray: a person, a vehicle, a wall / building / pole / tree, the ground; or nothing
  _trace(o, d) {
    const g = this.g, W = g.world;
    let best = { kind: 'none', t: RANGE };
    // the ray starts at the camera: skip the stretch up to the character (nothing between them counts)
    const s = this.of.state, t0 = Math.max(0.3, (s.x - o.x) * d.x + (s.z - o.z) * d.z);
    const ph = g.peds?.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, RANGE);
    if (ph && ph.t > t0) best = { kind: 'ped', t: ph.t, p: ph.p, head: ph.head };
    // vehicles: traffic, police, the player's own parked cars (oriented boxes, ~1.5 m tall; buses and lorries taller)
    const boxes = [];
    for (const c of g.traffic?.cars || []) if (c.dist < RANGE + 10) boxes.push([c.obb(), c.y, c.spec?.bus || c.spec?.l > 7 ? 3 : c.spec?.bike ? 1.3 : 1.55, c]);
    for (const u of g.police?.units || []) { const v = u.vehicle; if (v?.physics) boxes.push([v.physics.obb ? v.physics.obb() : null, v.state.y, 1.5, null]); }
    for (const v of [g.player, ...(this.of.parked || [])]) if (v?.physics?.obb && !v.gone) boxes.push([v.physics.obb(), v.state.y, 1.4, null]);
    for (const [b, y0, h, c] of boxes) {
      if (!b) continue;
      const t = slab(o, d, b, y0, h);
      if (t > t0 && t < best.t) best = { kind: 'car', t, c };
    }
    // walls, buildings, poles, trees, and the ground: march along the ray
    const seen = new Set(), list = [];
    for (let t = t0; t < best.t; t += 1.5) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < (W.groundHeight ? W.groundHeight(x, z) : W.layout?.groundHeight?.(x, z) ?? 0)) { best = { kind: 'ground', t: Math.max(t0, t - 0.75) }; break; }
      W.collision?.query(x - 1.6, z - 1.6, x + 1.6, z + 1.6, list);
      for (const k of list) {
        if (seen.has(k)) continue; seen.add(k);
        const tt = slab(o, d, k, -1e9, 0, k.h ?? 99);
        if (tt > t0 && tt < best.t) best = { kind: 'wall', t: tt };
      }
    }
    return best;
  }

  _handPos(out) { const h = this.of.human; if (h?.B.RightHand) return h.B.RightHand.getWorldPosition(out); const s = this.of.state; return out.set(s.x, s.y + 1.2, s.z); }
  _muzzle(out) { return out.set(0, 0.022, 0.15).applyMatrix4(this.gun.matrixWorld); }

  // after the body is animated: the arms come up to aim (blended in), the gun sits in the right hand
  pose() {
    const of = this.of, h = of.human;
    if (!this.armed || !h || !of.active) { this.gun.visible = false; return; }
    const B = h.B, k = this.reloadT > 0 ? 0 : this.aim;
    this.aimRay(_o, _d);
    _t.copy(_o).addScaledVector(_d, 30);                         // the point the crosshair is on
    if (k > 0.01 && B.RightArm && B.RightForeArm && B.RightHand) {
      const sh = B.RightArm.getWorldPosition(_a), dir = _b.subVectors(_t, sh).normalize();
      const L = B.RightArm.getWorldPosition(new THREE.Vector3()).distanceTo(B.RightForeArm.getWorldPosition(new THREE.Vector3())) + B.RightForeArm.getWorldPosition(new THREE.Vector3()).distanceTo(B.RightHand.getWorldPosition(new THREE.Vector3()));
      const recoil = (of.recoil || 0) * 0.05;
      const hand = sh.clone().addScaledVector(dir, L * 0.96 - recoil).add(new THREE.Vector3(0, recoil * 0.6, 0));
      const elbow = sh.clone().addScaledVector(dir, L * 0.5).add(new THREE.Vector3(0, -0.05, 0));
      blendAim(h, B.RightArm, B.RightForeArm, elbow, k);
      blendAim(h, B.RightForeArm, B.RightHand, hand, k);
      // the left hand comes across to cup the grip
      if (B.LeftArm && B.LeftForeArm && B.LeftHand) {
        const lsh = B.LeftArm.getWorldPosition(new THREE.Vector3());
        const grip = hand.clone().add(new THREE.Vector3(0, -0.04, 0)).addScaledVector(dir, -0.03);
        const lel = lsh.clone().lerp(grip, 0.5).add(new THREE.Vector3(0, -0.12, 0));
        blendAim(h, B.LeftArm, B.LeftForeArm, lel, k);
        blendAim(h, B.LeftForeArm, B.LeftHand, grip, k);
      }
    }
    of.recoil = Math.max(0, (of.recoil || 0) - 0.25);
    // the gun in the right hand: along the aim when raised, pointing down and ahead when lowered
    const hp = this._handPos(_a);
    const s = of.state, fwd = _b.set(Math.sin(s.yaw), -1.6, Math.cos(s.yaw)).normalize();
    const dir = new THREE.Vector3().subVectors(_t, hp).normalize().lerp(fwd, 1 - k).normalize();
    _m.lookAt(_o.set(0, 0, 0), dir.clone().negate(), _up);
    this.gun.quaternion.setFromRotationMatrix(_m);
    this.gun.position.copy(hp).addScaledVector(dir, 0.04).add(new THREE.Vector3(0, -0.01, 0));
    this.gun.visible = true;
    this.gun.updateMatrixWorld(true);
  }
}

// rotate `bone` so `tip` heads for `target`, blended with the animated pose by k
function blendAim(h, bone, tip, target, k) {
  _q0.copy(bone.quaternion);
  h._aim(bone, tip, target);
  if (k < 0.999) { _q1.copy(bone.quaternion); bone.quaternion.copy(_q0).slerp(_q1, k); bone.updateWorldMatrix(false, true); }
}

// ray (o, d) against an oriented box {cx, cz, hx, hz, cos, sin} spanning heights y0..y0+h (or up to `top`): entry t
function slab(o, d, b, y0, h, top) {
  const ox = o.x - b.cx, oz = o.z - b.cz;
  const lx = ox * b.cos - oz * b.sin, lz = ox * b.sin + oz * b.cos;
  const dx = d.x * b.cos - d.z * b.sin, dz = d.x * b.sin + d.z * b.cos;
  let tn = -Infinity, tf = Infinity;
  for (const [p, v, e] of [[lx, dx, b.hx], [lz, dz, b.hz]]) {
    if (Math.abs(v) < 1e-9) { if (Math.abs(p) > e) return Infinity; continue; }
    let a = (-e - p) / v, c = (e - p) / v; if (a > c) [a, c] = [c, a];
    tn = Math.max(tn, a); tf = Math.min(tf, c);
  }
  if (tn > tf || tf < 0) return Infinity;
  const t = Math.max(0, tn), y = o.y + d.y * t, hi = top ?? y0 + h;
  return y >= y0 && y <= hi ? t : Infinity;
}
