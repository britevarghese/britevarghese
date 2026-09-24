// Local player: input, client-side predicted movement (shared physics), FPS/TPS camera, weapon handling.
import * as THREE from 'three';
import { stepCharacter, EYE_HEIGHT, STANCE_HEIGHT } from '/shared/world.js';
import { WEAPONS } from '/shared/weapons.js';
import { stepAir } from '/shared/royale.js';
import { zeroAngle } from '/shared/ballistics.js';

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class LocalPlayer {
  constructor(game) {
    this.g = game;
    this.s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
    this.yaw = 0; this.pitch = 0;
    this.keys = new Set();
    this.mouse = { l: false, r: false, dx: 0, dy: 0 };
    this.sens = +(localStorage.getItem('sp_sens') || 0.0022);
    this.alive = false;
    this.slot = 0; this.weapons = []; this.grenades = 0;
    this.recoil = { p: 0, y: 0 };
    this.bloom = 0;
    this.nextFire = 0; this.reloadUntil = 0; this.reloadStart = 0; this.reloadDur = 0;
    this.thirdPerson = false;
    this.triggerReleased = true;
    this.camBob = 0; this.stepDist = 0; this.landDip = 0;
    this.tpsCam = new THREE.Vector3();
    // touch input (set by ui/TouchControls): analog stick, sprint flag, jump pulse
    this.touch = { mx: 0, mz: 0, sprint: false, jump: false };
    this.bindInput();
  }

  bindInput() {
    const el = this.g.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (this.g.chatOpen) return;
      if (e.code === 'Tab') { e.preventDefault(); this.g.hud.scoreboard(true, this.g.myId); }
      if (e.code === 'Space' && !e.repeat && this.alive) this.jumpQueued = true; // a tap shorter than one frame still jumps
      this.keys.add(e.code);
      const R = this.g.royale;
      if (R && !e.repeat) {
        if (e.code === 'Space' && R.inPlane) R.jump();
        if (e.code === 'KeyM') R.mapHeld = true;
        if (e.code === 'KeyE') R.pickup();
        if (e.code === 'KeyH') R.heal();
      }
      if (!this.alive) return;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.setStance(this.s.stance === 'crouch' ? 'stand' : 'crouch');
      if (e.code === 'KeyZ') this.setStance(this.s.stance === 'prone' ? 'stand' : 'prone');
      if (e.code === 'KeyR') this.reload();
      if (e.code === 'Digit1') this.switchSlot(0);
      if (e.code === 'Digit2') this.switchSlot(1);
      if (e.code === 'KeyG') this.throwGrenade();
      if (e.code === 'KeyV') this.thirdPerson = !this.thirdPerson;
      if (e.code === 'PageUp' || e.code === 'PageDown') { e.preventDefault(); this.cycleZero(e.code === 'PageUp' ? 1 : -1); }
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'Tab') this.g.hud.scoreboard(false); if (e.code === 'KeyM' && this.g.royale) this.g.royale.mapHeld = false; });
    el.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== el) { if (this.canLook()) el.requestPointerLock(); return; }
      if (e.button === 0) this.mouse.l = true;
      if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; this.triggerReleased = e.button === 0 ? true : this.triggerReleased; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== el || !this.canLook()) return;
      this.look(e.movementX, e.movementY);
    });
    addEventListener('wheel', () => { if (this.alive) this.switchSlot(1 - this.slot); });
  }

  // look input shared by mouse and touch (pixels of movement)
  // alive, or looking around from the transport plane (battle royale)
  canLook() { return this.alive || !!this.g.royale?.inPlane; }

  // third-person camera: toggled with V, forced while falling / under the canopy
  isTPS() { return this.thirdPerson || (this.alive && this.s.air > 0); }

  look(dx, dy, k = this.sens) {
    if (!this.canLook()) return;
    const f = k * (this.adsBlend > 0.5 ? (WEAPONS[this.weaponId()]?.scoped ? 0.35 : 0.7) : 1);
    this.yaw -= dx * f; this.pitch -= dy * f;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.mouse.dx += dx; this.mouse.dy += dy;
  }

  weaponId() { return this.weapons[this.slot]?.id; }

  // sight zeroing distance (m) of the current weapon; the barrel is tilted so the bullet crosses the aim point there
  zeroOf(id = this.weaponId()) { const def = WEAPONS[id]; return def?.zero ? (this.zero?.[id] ?? def.zero[0]) : 0; }
  cycleZero(step) {
    const id = this.weaponId(), def = WEAPONS[id]; if (!def?.zero) return;
    this.zero = this.zero || {};
    const i = Math.max(0, Math.min(def.zero.length - 1, def.zero.indexOf(this.zeroOf(id)) + step));
    this.zero[id] = def.zero[i];
    this.g.hud.notice(`ZEROING ${def.zero[i]} m`, 900);
    this.g.audio.ui('switch');
  }

  spawn(m) {
    Object.assign(this.s, { x: m.x, y: m.y, z: m.z, vx: m.vx || 0, vy: m.vy || 0, vz: m.vz || 0, onGround: !m.air, stance: 'stand', air: m.air || 0 });
    this.yaw = m.yaw; this.pitch = m.air ? -0.5 : 0; this.alive = true; this.jumpQueued = false;
    this.weapons = m.w.map((w) => (w ? { ...w } : null)); this.grenades = m.g; this.slot = m.sl ?? 0;
    this.reloadUntil = 0; this.recoil.p = this.recoil.y = 0;
    this.g.equipLocal(this.weaponId());
  }

  // battle royale: authoritative inventory after a pickup / swap / heal
  applyInventory(e) {
    const before = this.weaponId();
    this.weapons = e.w.map((w, i) => {
      if (!w) return null;
      const l = this.weapons[i];
      return l && l.id === w.id && performance.now() < this.reloadUntil ? { ...w, mag: l.mag } : { ...w };
    });
    this.grenades = e.g;
    if (e.sl !== undefined && this.weapons[e.sl]) this.slot = e.sl;
    if (!this.weapons[this.slot]) this.slot = this.weapons.findIndex(Boolean);
    if (this.weaponId() !== before) { this.reloadUntil = 0; this.g.equipLocal(this.weaponId()); }
  }

  setStance(st) {
    if (st !== 'prone' && this.s.stance !== st) {
      // standing up needs head room
      const ceil = this.g.world.collision.ceilingHeight(this.s.x, this.s.z, this.s.y + 0.4);
      if (ceil < this.s.y + STANCE_HEIGHT[st]) return;
    }
    this.s.stance = st;
  }

  switchSlot(i) {
    if (i === this.slot || !this.weapons[i]) return;
    this.slot = i; this.reloadUntil = 0;
    this.g.equipLocal(this.weaponId());
    this.g.audio.ui('switch');
  }

  reload() {
    const w = this.weapons[this.slot]; if (!w) return;
    const def = WEAPONS[w.id];
    if (w.mag >= def.mag || w.reserve <= 0 || performance.now() < this.reloadUntil) return;
    this.reloadDur = (w.mag === 0 ? def.reloadEmpty : def.reload) * 1000;
    this.reloadStart = performance.now(); this.reloadUntil = this.reloadStart + this.reloadDur;
    this.g.net.send({ t: 'reload' });
    this.g.audio.ui('reload');
    setTimeout(() => this.g.audio.ui('reload2'), this.reloadDur * 0.75);
  }

  throwGrenade() {
    if (this.grenades <= 0) return;
    this.grenades--;
    const d = this.aimDir();
    this.g.net.send({ t: 'nade', o: [this.s.x, this.s.y + EYE_HEIGHT[this.s.stance], this.s.z], d: [d.x, d.y + 0.15, d.z] });
    this.g.viewmodel.switchT = 0.2;
  }

  aimDir() {
    const cp = Math.cos(this.pitch + this.recoil.p);
    return new THREE.Vector3(-Math.sin(this.yaw + this.recoil.y) * cp, Math.sin(this.pitch + this.recoil.p), -Math.cos(this.yaw + this.recoil.y) * cp);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    if (!this.alive) return;
    const k = this.keys, s = this.s;
    const chat = this.g.chatOpen;
    let fx = 0, fz = 0;
    if (!chat) {
      if (k.has('KeyW')) fz -= 1; if (k.has('KeyS')) fz += 1; if (k.has('KeyA')) fx -= 1; if (k.has('KeyD')) fx += 1;
    }
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const T = this.touch;
    if (!chat && (T.mx || T.mz)) { fx = T.mx; fz = T.mz; } // analog: partial deflection = slower walk
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin, wz = -fx * sin + fz * cos;
    const reloading = performance.now() < this.reloadUntil;
    const sprint = !chat && (k.has('ShiftLeft') || T.sprint) && fz < 0 && !this.mouse.r && s.stance !== 'prone';
    if (sprint && s.stance === 'crouch') s.stance = 'stand';
    const ads = this.mouse.r && !sprint;
    this.sprinting = sprint; this.ads = ads;
    const jump = !chat && (k.has('Space') || T.jump || this.jumpQueued);
    const jumpPulse = T.jump || this.jumpQueued;
    T.jump = false; this.jumpQueued = false;
    if (s.air) {
      // freefall / canopy: steer with WASD relative to the view, look down to dive, SPACE opens the canopy
      const dive = Math.max(0, Math.min(1, (-this.pitch - 0.35) / 0.8));
      const deploy = s.air === 1 && ((jump && this.spaceReleased) || jumpPulse);
      this.spaceReleased = !k.has('Space');
      stepAir(this.g.world.collision, s, { fx: wx, fz: wz, dive, deploy }, dt);
      if (!s.air) { this.landDip = 0.12; this.g.audio.footstep(null, this.g.surfaceAt(s.x, s.z), true, 1.8); this.spaceReleased = false; }
      this.sprinting = false; this.ads = false; this.moveFactor = 0;
      this.#sendInput(s, false, false);
      return;
    }
    if (jump && s.stance !== 'stand' && s.onGround) { this.setStance('stand'); }
    const prevGround = s.onGround;
    stepCharacter(this.g.world.collision, s, { fx: wx, fz: wz, sprint, jump: jump && s.stance === 'stand', ads }, dt);
    if (s.landed) { this.landDip = Math.min(0.12, s.landed * 0.012); this.g.audio.footstep(null, this.g.surfaceAt(s.x, s.z), true, 1.5); }
    if (s.y < -40) { this.g.net.send({ t: 'suicide' }); }
    // footsteps
    const hs = Math.hypot(s.vx, s.vz);
    if (s.onGround && hs > 0.5) {
      this.stepDist += hs * dt;
      const stride = sprint ? 1.9 : s.stance === 'crouch' ? 0.9 : 1.5;
      if (this.stepDist > stride) { this.stepDist = 0; this.g.audio.footstep(null, this.g.surfaceAt(s.x, s.z), true, s.stance === 'crouch' ? 0.4 : sprint ? 1.2 : 0.8); }
    }
    // weapon
    const w = this.weapons[this.slot], def = w ? WEAPONS[w.id] : null;
    this.adsBlend = this.g.viewmodel ? this.g.viewmodel.ads : 0;
    if (def) {
      if (this.mouse.l && !chat && !sprint && !reloading && performance.now() >= this.nextFire && this.g.viewmodel.switchT > 0.8 && !this.g.royale?.healing) {
        if (!def.auto && !this.triggerReleased) {} // semi/bolt: one shot per click
        else if (w.mag > 0) this.fire(w, def);
        else { this.g.audio.ui('empty'); this.nextFire = performance.now() + 300; this.reload(); }
        this.triggerReleased = false;
      }
      if (!this.mouse.l) this.triggerReleased = true;
      if (w.mag === 0 && !reloading && w.reserve > 0 && !this.mouse.l) this.reload();
    }
    // recoil recovery & bloom
    const rec = def ? def.recoil.recover : 8;
    this.recoil.p = damp(this.recoil.p, 0, this.mouse.l && def?.auto ? rec * 0.25 : rec, dt);
    this.recoil.y = damp(this.recoil.y, 0, rec, dt);
    this.bloom = damp(this.bloom, 0, 4, dt);
    this.landDip = damp(this.landDip, 0, 6, dt);
    this.#sendInput(s, ads, sprint);
    this.moveFactor = Math.min(1, hs / 3.6);
  }

  // send input at ~30Hz
  #sendInput(s, ads, sprint) {
    const now = performance.now();
    if (now - (this.lastSend || 0) < 1000 / 30) return;
    this.lastSend = now;
    this.g.net.send({ t: 'in', x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3), yaw: +this.yaw.toFixed(4), pitch: +this.pitch.toFixed(4), st: s.stance, ads, sp: sprint, vx: +s.vx.toFixed(2), vz: +s.vz.toFixed(2), og: s.onGround, sl: this.slot, dr: s.air || 0 });
  }

  spread(def) {
    const hs = Math.hypot(this.s.vx, this.s.vz);
    const base = this.adsBlend > 0.8 ? def.spreadAds : def.spreadHip * (this.s.stance === 'crouch' ? 0.75 : this.s.stance === 'prone' ? 0.55 : 1);
    return (base + def.spreadMove * Math.min(1, hs / 4) * (this.adsBlend > 0.8 ? 0.3 : 1) + this.bloom * (this.adsBlend > 0.8 ? 0.3 : 1) + (this.s.onGround ? 0 : 4)) * (Math.PI / 180);
  }

  fire(w, def) {
    const now = performance.now();
    this.nextFire = now + Math.max(60000 / def.rpm, (def.bolt || 0) * 1000);
    w.mag--;
    const sp = this.spread(def);
    const d = this.aimDir();
    if (this.thirdPerson) {
      // shoot from the soldier's eye toward whatever the over-the-shoulder camera is looking at
      const cam = this.g.camera, cf = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const hit = this.g.world.collision.raycast(cam.position, cf, 600, true);
      const target = hit ? new THREE.Vector3(...hit.point) : cam.position.clone().addScaledVector(cf, 600);
      d.copy(target).sub(this.eyePos()).normalize();
    }
    // random cone
    const r = Math.sqrt(Math.random()) * sp, a = Math.random() * Math.PI * 2;
    const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, d).normalize();
    d.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    // sight zeroing: barrel tilted up so the bullet's drop brings it back onto the aim point at the zero distance
    const za = zeroAngle(def, this.zeroOf(def.id));
    if (za) d.multiplyScalar(Math.cos(za)).addScaledVector(up, Math.sin(za)).normalize();
    const eye = this.eyePos();
    this.g.net.send({ t: 'fire', o: [eye.x, eye.y, eye.z], d: [d.x, d.y, d.z], ct: this.g.net.serverNow() });
    // recoil: kick the aim (camera) up with slight random yaw; bloom the cone
    const adsK = this.adsBlend > 0.8 ? 0.75 : 1;
    const stK = this.s.stance === 'prone' ? 0.5 : this.s.stance === 'crouch' ? 0.8 : 1;
    this.recoil.p += def.recoil.pitch * (Math.PI / 180) * adsK * stK;
    this.recoil.y += (Math.random() - 0.4) * def.recoil.yaw * (Math.PI / 180) * adsK;
    this.bloom = Math.min(4, this.bloom + (def.auto ? 0.35 : 1));
    this.g.onLocalShot(eye, d, def);
  }

  eyePos() {
    const eh = EYE_HEIGHT[this.s.stance];
    return new THREE.Vector3(this.s.x, this.s.y + (this.eyeSmooth ?? eh), this.s.z);
  }

  // camera placement for this frame
  updateCamera(cam, dt) {
    const s = this.s;
    this.eyeSmooth = damp(this.eyeSmooth ?? EYE_HEIGHT[s.stance], EYE_HEIGHT[s.stance], 9, dt);
    const hs = Math.hypot(s.vx, s.vz);
    if (s.onGround && hs > 0.3) this.camBob += dt * hs * (this.sprinting ? 2.3 : 2.6);
    const bobA = this.adsBlend > 0.5 ? 0.15 : 1;
    const bobY = Math.abs(Math.sin(this.camBob)) * 0.028 * Math.min(1, hs / 4) * bobA;
    const bobX = Math.cos(this.camBob) * 0.012 * Math.min(1, hs / 4) * bobA;
    const eye = new THREE.Vector3(s.x, s.y + this.eyeSmooth - this.landDip + bobY, s.z);
    const shake = this.g.effects.shake;
    const pitch = this.pitch + this.recoil.p + (Math.random() - 0.5) * shake * 0.03;
    const yaw = this.yaw + this.recoil.y + (Math.random() - 0.5) * shake * 0.03;
    const roll = -Math.cos(this.camBob) * 0.004 * Math.min(1, hs / 4) * bobA + (this.sprinting ? Math.sin(this.camBob) * 0.006 : 0);
    cam.rotation.set(pitch, yaw, roll, 'YXZ');
    if (!this.isTPS()) {
      cam.position.copy(eye).add(new THREE.Vector3(bobX, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0)));
      this.tpsBlend = 0;
    } else {
      // over-the-shoulder camera with collision
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
      const pivot = new THREE.Vector3(s.x, s.y + Math.min(1.55, this.eyeSmooth + 0.15), s.z);
      const offset = (s.air ? new THREE.Vector3(0, s.air === 1 ? 1.6 : 3.2, s.air === 1 ? 5.5 : 11) : new THREE.Vector3(0.55, 0.22, this.adsBlend > 0.5 ? 1.25 : 2.5)).applyQuaternion(q);
      const len = offset.length(), dir = offset.clone().normalize();
      const hit = this.g.world.collision.raycast(pivot, dir, len + 0.3, false);
      const dist = hit ? Math.max(0.3, hit.t - 0.3) : len;
      this.tpsCam.copy(pivot).addScaledVector(dir, dist);
      cam.position.lerp(this.tpsCam, this.tpsBlend === 1 ? 1 - Math.exp(-25 * dt) : 1);
      this.tpsBlend = 1;
    }
  }
}
