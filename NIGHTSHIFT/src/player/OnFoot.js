// On foot (GTA-style): leave the car with F, walk/sprint around the city, get back in, or take any car
// on the street. Carjacking a traffic car throws the driver out and turns the car into a drivable
// vehicle; your previous car stays parked where you left it (and returns to your garage if you wander
// far away). The police can chase and arrest you on foot.
import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';
import { bus } from '../core/EventBus.js';

const WALK = 1.7, RUN = 6.2, RADIUS = 0.34, ENTER_DIST = 3.4;
const _v = new THREE.Vector3();

function buildCharacter() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0x1d2330, roughness: 0.75 });
  const jeans = new THREE.MeshStandardMaterial({ color: 0x2b3547, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xb58868, roughness: 0.7 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.9 });
  const box = (w, h, d, m, y = 0) => { const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, y, 0); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; return mesh; };
  const limb = (w, len, d, m, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); p.add(box(w, len, d, m, -len / 2)); g.add(p); return p; };
  const torso = box(0.44, 0.6, 0.24, jacket, 1.2); g.add(torso);
  const neck = box(0.1, 0.08, 0.1, skin, 1.54); g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin); head.scale.set(1, 1.18, 1.08); head.position.y = 1.7; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair); cap.position.y = 1.73; g.add(cap);
  const hips = box(0.4, 0.14, 0.22, jeans, 0.86); g.add(hips);
  const legL = limb(0.15, 0.84, 0.17, jeans, 0.11, 0.86), legR = limb(0.15, 0.84, 0.17, jeans, -0.11, 0.86);
  for (const l of [legL, legR]) { const s = box(0.15, 0.08, 0.27, shoe, -0.84); s.position.z = 0.05; l.add(s); }
  const armL = limb(0.11, 0.56, 0.12, jacket, 0.29, 1.47), armR = limb(0.11, 0.56, 0.12, jacket, -0.29, 1.47);
  for (const a of [armL, armR]) a.add(box(0.09, 0.1, 0.09, skin, -0.61));
  return { group: g, legL, legR, armL, armR, torso, head };
}

export class OnFoot {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.state = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, rpm: 0, onGround: true, pitch: 0, roll: 0 };
    this.body = buildCharacter();
    this.body.group.visible = false;
    game.scene.add(this.body.group);
    this.camYaw = 0; this.camPitch = 0.18; this.camDist = 4.2;
    this.phase = 0; this.vy = 0;
    this.camPos = new THREE.Vector3();
    this.parked = [];        // cars left behind (still physical, drawn, collidable)
  }

  // ------------------------------------------------------------------ get out / get in
  exit() {
    const g = this.game, v = g.player, s = v.state;
    if (Math.hypot(s.vx, s.vz) > 8) { g.ui.toast('Slow down to get out', '', 1.5); return false; }
    const L = (v.p.width || 1.9) / 2 + 0.55;
    const side = [1, -1].find((k) => this._free(s.x + Math.cos(s.yaw) * L * k, s.z - Math.sin(s.yaw) * L * k)) ?? 1;
    this.state.x = s.x + Math.cos(s.yaw) * L * side; this.state.z = s.z - Math.sin(s.yaw) * L * side;
    this.state.y = this._ground(this.state.x, this.state.z);
    this.state.yaw = s.yaw; this.state.vx = this.state.vz = 0;
    this.camYaw = s.yaw; this.vy = 0;
    this.active = true;
    this.body.group.visible = true;
    this.car = v;                     // the car we just left: parked
    v.controls.throttle = 0; v.controls.brake = 0; v.controls.handbrake = 1; v.controls.steer = 0; v.controls.nitro = false;
    this.camPos.copy(g.camera.position);
    g.audio?.setEngineOn?.(false);
    document.getElementById('hud')?.classList.add('onfoot');
    bus.emit('player:onfoot', { on: true });
    return true;
  }

  // nearest enterable vehicle: our car, a parked car, or a traffic car
  nearestVehicle() {
    const g = this.game, s = this.state;
    let best = null, bd = ENTER_DIST;
    const consider = (kind, ref, x, z, extra = 0) => { const d = Math.hypot(x - s.x, z - s.z) - extra; if (d < bd) { bd = d; best = { kind, ref }; } };
    if (g.player) consider('own', g.player, g.player.state.x, g.player.state.z, 0.9);
    for (const v of this.parked) consider('parked', v, v.state.x, v.state.z, 0.9);
    for (const c of g.traffic?.cars || []) if (TRAFFIC_VEHICLES[c.type]) consider('traffic', c, c.x, c.z, c.spec?.w ? c.spec.w * 0.5 : 0.9);
    return best;
  }

  enter(target) {
    const g = this.game;
    let v;
    if (target.kind === 'own') v = g.player;
    else if (target.kind === 'parked') {
      v = target.ref;
      this.parked.splice(this.parked.indexOf(v), 1);
      if (g.player !== v) this._park(g.player);
    } else {
      v = this._jack(target.ref);
      if (!v) return false;
      this._park(g.player);
    }
    g.player = v;
    v.controls.handbrake = 0;
    this.active = false;
    this.body.group.visible = false;
    g.camCtl.snap(v);
    g.audio?.setEngineOn?.(true);
    document.getElementById('hud')?.classList.remove('onfoot');
    bus.emit('player:onfoot', { on: false, vehicle: v });
    return true;
  }

  _park(v) {
    if (!v || this.parked.includes(v)) return;
    v.controls.throttle = 0; v.controls.brake = 0; v.controls.handbrake = 1; v.controls.steer = 0; v.controls.nitro = false;
    this.parked.push(v);
  }

  // turn a traffic car into a drivable vehicle at the same spot; the driver bails out and runs
  _jack(c) {
    const g = this.game, def = TRAFFIC_VEHICLES[c.type];
    if (!def || !g.lib.has(c.type)) return null;
    const v = new Vehicle({ carId: c.type, params: { ...def.params }, world: g.world, lib: g.lib, role: 'player', carType: def.carType, renderOpts: { headlights: g.preset.headlightSpots, shadow: g.preset.shadows !== 'off', lodDistance: 1e9 } });
    const col = '#' + new THREE.Color(c.color ?? 0x888888).getHexString();
    v.renderer.applyCustom({ paint: col, finish: 'gloss', wheel: 0, tint: 0.2 });
    v.renderer.enableDents?.();
    g.scene.add(v.renderer.group);
    v.place(c.x, c.z, c.yaw);
    v.stolen = true;
    g.traffic.remove(c);
    g.peds?.spawnFleeing?.(c.x + Math.cos(c.yaw) * 1.6, c.z - Math.sin(c.yaw) * 1.6, this.state.x, this.state.z);
    g.audio?.playEvent('collision', { intensity: 0.15, type: 'light', position: { x: c.x, y: 0.5, z: c.z } });
    g.police?.reportInfraction('carjack', 1);
    g.ui.toast(`Stole a ${def.name}`, '', 2);
    bus.emit('player:carjack', { type: c.type });
    return v;
  }

  // ------------------------------------------------------------------ movement
  _ground(x, z) { return this.game.world.layout.groundHeight(x, z); }

  _free(x, z) {
    const tmp = this._tmp || (this._tmp = []);
    this.game.world.collision.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6, tmp);
    for (const c of tmp) {
      if (c.h < this.state.y + 0.5) continue;
      const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin, lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos;
      if (Math.abs(lx) < c.hx + RADIUS && Math.abs(lz) < c.hz + RADIUS) return false;
    }
    return true;
  }

  // push the character out of static colliders and vehicles (oriented boxes)
  _resolve() {
    const s = this.state, g = this.game;
    const tmp = this._tmp || (this._tmp = []);
    g.world.collision.query(s.x - 1, s.z - 1, s.x + 1, s.z + 1, tmp);
    const push = (cx, cz, cos, sin, hx, hz) => {
      const lx = (s.x - cx) * cos - (s.z - cz) * sin, lz = (s.x - cx) * sin + (s.z - cz) * cos;
      const ox = hx + RADIUS - Math.abs(lx), oz = hz + RADIUS - Math.abs(lz);
      if (ox <= 0 || oz <= 0) return;
      let nx = 0, nz = 0;
      if (ox < oz) nx = Math.sign(lx) * ox; else nz = Math.sign(lz) * oz;
      // back to world space (inverse rotation)
      s.x += nx * cos + nz * sin; s.z += -nx * sin + nz * cos;
    };
    for (const c of tmp) if (c.h > s.y + 0.4) push(c.cx, c.cz, c.cos, c.sin, c.hx, c.hz);
    const car = (x, z, yaw, w, l) => push(x, z, Math.cos(yaw), Math.sin(yaw), w / 2, l / 2);
    for (const v of [g.player, ...this.parked, ...(g.police?.vehicles() || []), ...(g.races?.vehicles() || []), ...(g.rivals?.vehicles() || [])]) {
      if (!v) continue; const vs = v.state; if (Math.abs(vs.x - s.x) > 8 || Math.abs(vs.z - s.z) > 8) continue;
      car(vs.x, vs.z, vs.yaw, v.p.width || 1.9, v.p.length || 4.5);
    }
    for (const c of g.traffic?.cars || []) {
      if (Math.abs(c.x - s.x) > 10 || Math.abs(c.z - s.z) > 10) continue;
      const w = c.spec?.w || 1.9, l = c.spec?.l || 4.6;
      // moving traffic knocks you aside
      const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
      const lx = (s.x - c.x) * cos - (s.z - c.z) * sin, lz = (s.x - c.x) * sin + (s.z - c.z) * cos;
      if (Math.abs(lx) < w / 2 + RADIUS && Math.abs(lz) < l / 2 + RADIUS && (c.v || 0) > 4 && !this.knockT) {
        this.knockT = 1.2; this.vy = 3.5;
        const dir = Math.sign(lx) || 1; s.vx = Math.cos(c.yaw) * dir * 6; s.vz = -Math.sin(c.yaw) * dir * 6;
        g.audio?.playEvent('collision', { intensity: 0.35, type: 'light', position: { x: s.x, y: 0.8, z: s.z } });
        g.camCtl.addShake(0.6);
      }
      car(c.x, c.z, c.yaw, w, l);
    }
  }

  update(dt, input) {
    const s = this.state, g = this.game, ic = input.controls;
    // camera-relative movement
    const fwdIn = (ic.throttle || 0) - (ic.brake || 0), sideIn = -(ic.steer || 0);
    const mag = Math.min(1, Math.hypot(fwdIn, sideIn));
    const run = ic.nitro;
    let tx = 0, tz = 0;
    if (mag > 0.05 && !this.knockT) {
      const cy = this.camYaw;
      const dx = Math.sin(cy) * fwdIn + Math.cos(cy) * sideIn, dz = Math.cos(cy) * fwdIn - Math.sin(cy) * sideIn;
      const l = Math.hypot(dx, dz) || 1, sp = (run ? RUN : WALK) * mag;
      tx = dx / l * sp; tz = dz / l * sp;
      let d = Math.atan2(dx, dz) - s.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      s.yaw += d * Math.min(1, dt * 12);
    }
    const acc = this.knockT ? 1.5 : 10;
    s.vx = damp(s.vx, tx, acc, dt); s.vz = damp(s.vz, tz, acc, dt);
    s.x += s.vx * dt; s.z += s.vz * dt;
    // gravity / jump (space)
    const gy = this._ground(s.x, s.z);
    if (input.consume('jump') && s.y <= gy + 0.02) this.vy = 4.2;
    this.vy -= 9.81 * dt; s.y += this.vy * dt;
    if (s.y <= gy) { s.y = gy; this.vy = 0; }
    s.onGround = s.y <= gy + 0.02;
    this._resolve();
    if (this.knockT) { this.knockT = Math.max(0, this.knockT - dt); if (!this.knockT) this.knockT = 0; }
    s.speed = Math.hypot(s.vx, s.vz);
    // walk cycle
    const b = this.body, v = s.speed;
    this.phase += dt * (v > 3 ? 1.6 + v * 0.95 : 2.2 + v * 2.6);
    const sw = Math.min(1, v / 2) * (v > 3 ? 0.95 : 0.55);
    b.legL.rotation.x = Math.sin(this.phase) * sw; b.legR.rotation.x = -Math.sin(this.phase) * sw;
    b.armL.rotation.x = -Math.sin(this.phase) * sw * 0.8; b.armR.rotation.x = Math.sin(this.phase) * sw * 0.8;
    b.group.position.set(s.x, s.y + Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, v / 2), s.z);
    b.group.rotation.set(v > 3 ? 0.12 : 0, s.yaw, this.knockT ? Math.sin(this.knockT * 6) * 0.4 : 0);
    // footsteps
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && v > 0.6 && s.onGround) { this.lastStep = step; g.audio?.playFootstep?.(v > 3, { x: s.x, y: s.y, z: s.z }); }
    // enter a vehicle
    const near = this.nearestVehicle();
    g.hud.setPrompt(near ? `press <span class="key">F</span> / <span class="key">Y</span> to ${near.kind === 'traffic' ? 'steal this car' : 'get in'}` : null);
    if (near && input.consume('enter')) this.enter(near);
  }

  // third-person camera: mouse / right stick orbit, eases in behind while walking
  updateCamera(dt, input, cam) {
    const s = this.state, ic = input.controls;
    if (ic.mouseLook || Math.abs(ic.lookX) > 0.01 || Math.abs(ic.lookY) > 0.01) {
      this.camYaw -= ic.lookX * (ic.mouseLook ? 1 : dt * 3);
      this.camPitch = clamp(this.camPitch + ic.lookY * (ic.mouseLook ? 1 : dt * 2), -0.35, 1.1);
      this.lookIdle = 0;
    } else {
      this.lookIdle = (this.lookIdle || 0) + dt;
      if (this.lookIdle > 1.2 && s.speed > 0.8) { let d = s.yaw - this.camYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.camYaw += d * Math.min(1, dt * 1.6); }
    }
    const dist = this.camDist * (s.speed > 3 ? 1.15 : 1);
    const cp = Math.cos(this.camPitch);
    const tx = s.x - Math.sin(this.camYaw) * dist * cp, tz = s.z - Math.cos(this.camYaw) * dist * cp, ty = s.y + 1.55 + Math.sin(this.camPitch) * dist;
    _v.set(tx, Math.max(ty, s.y + 0.4), tz);
    // don't put the camera inside buildings: pull in toward the character
    let k = 1;
    for (let i = 1; i <= 6; i++) {
      const f = i / 6, px = s.x + (tx - s.x) * f, pz = s.z + (tz - s.z) * f;
      if (!this._free(px, pz)) { k = Math.max(0.25, (i - 1) / 6); break; }
    }
    _v.set(s.x + (tx - s.x) * k, s.y + 1.4 + (_v.y - s.y - 1.4) * k, s.z + (tz - s.z) * k);
    this.camPos.lerp(_v, 1 - Math.exp(-dt * 10));
    cam.position.copy(this.camPos);
    cam.lookAt(s.x, s.y + 1.45, s.z);
    cam.fov = damp(cam.fov, s.speed > 3 ? 62 : 58, 3, dt); cam.near = 0.1;
    cam.updateProjectionMatrix();
  }

  // parked cars: physics (handbrake), visuals; ones far away go back to the garage
  updateParked(dt, camPos, env) {
    const g = this.game, f = g.focusState;
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (Math.hypot(v.state.x - f.x, v.state.z - f.z) > 450) { v.dispose(); this.parked.splice(i, 1); continue; }
      v.update(dt);
      v.sync(dt, camPos, env);
    }
  }

  clearParked() { for (const v of this.parked) v.dispose(); this.parked.length = 0; }
}
