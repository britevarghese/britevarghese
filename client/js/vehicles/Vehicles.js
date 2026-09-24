// Client side of the vehicles (tank, attack helicopter, jeep, motorbike): models driven by interpolated snapshots, the local driver's vehicle
// predicted with the shared physics (like soldier movement), seats / enter / exit, chase + gunner cameras,
// weapons (cannon, rockets, machine guns) with predicted impact reticles, HUD, engine / rotor sound,
// wreck smoke, minimap icons, touch controls.
import * as THREE from 'three';
import { VEHICLES, stepGround, stepHeli, seatPosition, vehicleCollider, vehicleMount, exposedPose, GUN_H } from '/shared/vehicles.js';
import { EYE_HEIGHT } from '/shared/world.js';
import { bulletPath } from '/shared/ballistics.js';
import { angleDiff, clamp } from '/shared/util.js';
import { buildTank, buildHeli, buildJeep, buildBike, setWrecked } from './VehicleModels.js';

const TYPES = Object.keys(VEHICLES);
const $ = (id) => document.getElementById(id);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const SEAT_NAMES = { tank: ['DRIVER / 120 mm GUN', 'ROOF MACHINE GUN'], heli: ['PILOT / ROCKETS', 'GUNNER / 30 mm CANNON'], jeep: ['DRIVER', 'ROOF .50 CAL', 'PASSENGER'], bike: ['RIDER', 'PILLION'] };
const SHORT = { tank: 'TANK', heli: 'HELICOPTER', jeep: 'JEEP', bike: 'MOTORBIKE' };
const BUILD = { tank: buildTank, heli: buildHeli, jeep: buildJeep, bike: buildBike };
// chase camera: pivot height above the hull, distance behind
const CHASE = { tank: [3.1, 2.0, 10.5], heli: [2.4, 2.6, 15], jeep: [2.2, 1.6, 7.5], bike: [1.5, 1.2, 5] };
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class VehiclesClient {
  constructor(game) {
    this.g = game;
    this.map = new Map();      // id -> view state + model
    this.mine = null;          // { id, seat } while seated
    this.drive = null;         // predicted state of the vehicle I drive
    this.colliders = [];
    this.fov = 70;
    this.ammo = new Map();     // vehicle id -> { ammo, rlUntil[] }
    this.rockets = [];
    this.sendT = 0; this.impAcc = 0;
    this.#ui();
    addEventListener('keydown', (e) => {
      if (this.g.chatOpen || e.repeat || !this.g.me.alive) return;
      if (e.code === 'KeyE' && !this.g.royale) this.toggle();
      if (this.mine && (e.code === 'Digit1' || e.code === 'F1')) { e.preventDefault(); this.g.net.send({ t: 'vseat', seat: 0 }); }
      if (this.mine && (e.code === 'Digit2' || e.code === 'F2')) { e.preventDefault(); this.g.net.send({ t: 'vseat', seat: 1 }); }
      if (this.mine && (e.code === 'Digit3' || e.code === 'F3')) { e.preventDefault(); this.g.net.send({ t: 'vseat', seat: 2 }); }
      if (this.mine && e.code === 'KeyV') this.firstPerson = !this.firstPerson;
    });
  }

  #ui() {
    const hud = document.createElement('div');
    hud.id = 'vhud'; hud.className = 'hidden';
    hud.innerHTML = `<div id="vh-name"></div><div id="vh-hpbar"><div id="vh-hp"></div></div><div id="vh-weap"></div><div id="vh-info"></div><div id="vh-keys"></div>`;
    document.body.appendChild(hud);
    const ret = document.createElement('div'); ret.id = 'vret'; ret.className = 'hidden'; document.body.appendChild(ret);
    const pr = document.createElement('div'); pr.id = 'vprompt'; pr.className = 'hidden'; document.body.appendChild(pr);
  }

  // ---------------------------------------------------------------- enter / exit
  nearest() {
    const s = this.g.me.s;
    let best = null, bd = 1e9;
    for (const v of this.map.values()) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - s.x, v.z - s.z);
      if (d < VEHICLES[v.type].radius + 3 && Math.abs(v.y - s.y) < 4 && d < bd && v.seats.some((x) => !x)) {
        const enemyInside = v.seats.some((id) => id && this.g.board.get(id) && this.g.board.get(id).tm !== this.g.myTeam);
        if (!enemyInside) { best = v; bd = d; }
      }
    }
    return best;
  }

  toggle() {
    if (this.mine) { this.g.net.send({ t: 'vexit' }); return; }
    const me = this.g.me;
    if (!me.alive || me.s.air) return;
    const v = this.nearest();
    if (v) this.g.net.send({ t: 'venter', id: v.id });
  }

  #seated(id, seat) {
    const v = this.map.get(id);
    const was = this.mine;
    this.mine = { id, seat };
    const me = this.g.me;
    if (!was || was.id !== id) {
      // look where the vehicle / turret points
      me.yaw = v ? (v.type === 'tank' ? v.turretYaw : v.yaw) : me.yaw;
      this.pose = v ? exposedPose(v.type, seat) : null; me.pitch = v?.type === 'heli' ? -0.12 : 0;
      this.firstPerson = false;
      this.g.hud.notice(`${v ? VEHICLES[v.type].name.toUpperCase() : 'VEHICLE'} · ${SEAT_NAMES[v?.type || 'tank'][seat]}`, 2500);
      this.g.audio.ui('switch');
    }
    if (seat === 0 && v && (!this.drive || this.drive.s.id !== id)) {
      this.drive = { type: v.type, s: { id, x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll, speed: 0, steer: 0, turretYaw: v.turretYaw, gunPitch: v.gunPitch, vx: 0, vy: 0, vz: 0 } };
      const last = this.#row(id); if (last) Object.assign(this.drive.s, { x: last[3], y: last[4], z: last[5], yaw: last[6], pitch: last[7], roll: last[8], turretYaw: last[9], gunPitch: last[10] });
    }
    if (seat !== 0) this.drive = null;
    document.body.classList.add('invehicle');
    $('vhud').classList.remove('hidden');
  }

  #left(pos) {
    this.mine = null; this.drive = null; this.pose = null; this.riderYaw = null; this.fpView = false;
    document.body.classList.remove('invehicle');
    $('vhud').classList.add('hidden'); $('vret').classList.add('hidden');
    const me = this.g.me;
    if (pos) Object.assign(me.s, { x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' });
    if (this.g.me.alive) me.pitch = 0;
  }

  #row(id) { return this.g.lastSnap?.veh?.find((r) => r[0] === id); }

  // ---------------------------------------------------------------- network
  onSnap(m) {
    const me = m.me;
    if (me?.alive && me.vid) { if (!this.mine || this.mine.id !== me.vid || this.mine.seat !== me.seat) this.#seated(me.vid, me.seat); }
    else if (this.mine && (!me?.alive || !me.vid)) this.#left(null);
  }

  onEvent(e) {
    switch (e.t) {
      case 'venter': if (e.id === this.g.myId) this.#seated(e.v, e.seat); break;
      case 'vexit': if (e.id === this.g.myId) this.#left(e); break;
      case 'vcorrect': if (this.drive && this.drive.s.id === e.v) Object.assign(this.drive.s, { x: e.x, y: e.y, z: e.z, yaw: e.yaw, speed: 0, vx: 0, vy: 0, vz: 0 }); break;
      case 'vammo': this.ammo.set(e.v, { ammo: e.ammo, rl: e.rl.map((t) => performance.now() + t) }); break;
      case 'vhurt': {
        const v = this.map.get(e.v);
        if (v && this.mine?.id === e.v && e.d >= 5) { this.g.hud.hurtFlash(); this.g.audio.impact([v.x, v.y + 1, v.z], 'metal'); if (e.d > 60) this.g.effects.shake = Math.max(this.g.effects.shake, 0.6); }
        break;
      }
      case 'vboom': {
        const p = [e.x, e.y, e.z];
        this.g.effects.explosion(p, this.g.camera.position); this.g.effects.explosion([e.x + 1, e.y + 1.5, e.z - 1], null);
        this.g.audio.explosion(p);
        const v = this.map.get(e.v);
        if (v && !v.smoke) v.smoke = this.g.effects.addAmbientSmoke(e.x, e.y + 1.5, e.z, { rate: 3 });
        if (this.mine?.id === e.v) this.#left(null);
        break;
      }
      case 'vspawn': { const v = this.map.get(e.v); if (v?.smoke) { this.g.effects.removeAmbientSmoke(v.smoke); v.smoke = null; } break; }
      case 'kill': if (e.v === this.g.myId && this.mine) this.#left(null); break;
    }
  }

  // a vehicle weapon fired (anyone's, mine included: vehicle shots are not predicted)
  onShot(e) {
    const v = this.map.get(e.v), W = v && VEHICLES[v.type].weapons.find((w) => w?.id === e.w);
    const u = v?.model.userData;
    let from = e.o;
    if (u) {
      const mz = e.w === 'tank_cannon' ? u.muzzle : e.w === 'tank_mg' || e.w === 'jeep_mg' ? u.mgMuzzle : e.w === 'heli_cannon' ? u.cannonMuzzle : null;
      if (mz) { mz.getWorldPosition(_v); from = [_v.x, _v.y, _v.z]; }
    }
    const dist = Math.hypot(e.e[0] - from[0], e.e[1] - from[1], e.e[2] - from[2]);
    const tf = Math.max(0.01, e.tf ?? dist / 600);
    const dir = new THREE.Vector3(e.e[0] - from[0], e.e[1] - from[1], e.e[2] - from[2]).normalize();
    const fx = this.g.effects, au = this.g.audio;
    const pos = new THREE.Vector3(...from);
    if (e.w === 'tank_cannon') {
      fx.muzzleFlash(pos, dir, true); fx.muzzleFlash(pos.clone().addScaledVector(dir, 0.6), dir, true);
      // blast: dust kicked up around the tank + muzzle smoke
      for (let i = 0; i < 18 * fx.q.particles; i++) fx.emit(pos.x, pos.y, pos.z, dir.x * 8 + (Math.random() - 0.5) * 5, (Math.random() - 0.3) * 3, dir.z * 8 + (Math.random() - 0.5) * 5, 0x8f877a, 0.8 + Math.random(), 1.5 + Math.random() * 1.5, { grow: 3, alpha: 0.45, drag: 2.5, grav: -0.2 });
      if (v) for (let i = 0; i < 14 * fx.q.particles; i++) { const a = Math.random() * 6.28; fx.emit(v.x + Math.cos(a) * 3, v.y + 0.3, v.z + Math.sin(a) * 3, Math.cos(a) * 5, 0.5, Math.sin(a) * 5, 0x9c8a72, 1.2, 1.4, { grow: 2.5, alpha: 0.35, drag: 3, grav: 0 }); }
      au.cannon(from, this.mine?.id === e.v);
      fx.tracer(from, e.e, dist / tf);
      if (this.mine?.id === e.v) fx.shake = Math.max(fx.shake, 0.5);
    } else if (e.w === 'heli_rockets') {
      au.rocket(from);
      this.rockets.push({ from: new THREE.Vector3(...from), to: new THREE.Vector3(...e.e), t: 0, tf, dir });
    } else {
      fx.muzzleFlash(pos, dir, e.w === 'heli_cannon');
      au.gunshot(this.mine?.id === e.v ? null : from, e.w === 'heli_cannon' ? 'sniper' : 'ar', this.mine?.id === e.v);
      fx.tracer(from, e.e, dist / tf);
      if (e.s !== 'none' && !W?.splash) setTimeout(() => fx.impact(e.e, e.n, e.s), tf * 1000);
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt, sample) {
    const g = this.g;
    if (sample?.b?.veh) {
      const { a, b, k } = sample;
      const A = new Map((a.veh || []).map((r) => [r[0], r]));
      for (const rb of b.veh) {
        const ra = A.get(rb[0]) || rb;
        let v = this.map.get(rb[0]);
        if (!v) {
          const type = TYPES[rb[1]];
          const model = BUILD[type](rb[2]);
          g.world.scene.add(model);
          v = { id: rb[0], type, team: rb[2], model, spin: 0, wrecked: false, smoke: null, loop: null };
          this.map.set(v.id, v);
        }
        const L = (i) => ra[i] + (rb[i] - ra[i]) * k, LA = (i) => ra[i] + angleDiff(ra[i], rb[i]) * k;
        Object.assign(v, { x: L(3), y: L(4), z: L(5), yaw: LA(6), pitch: L(7), roll: L(8), turretYaw: LA(9), gunPitch: L(10), hp: rb[11], dead: !!rb[12], seats: rb[13], speed: rb[14], steer: rb[15] || 0, team: rb[2] });
      }
    }
    // my own vehicle: predicted
    if (this.drive) {
      const v = this.map.get(this.drive.s.id), s = this.drive.s;
      if (v && !v.dead) Object.assign(v, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, roll: s.roll, turretYaw: s.turretYaw ?? v.turretYaw, gunPitch: s.gunPitch ?? v.gunPitch, speed: s.speed ?? Math.hypot(s.vx, s.vz), steer: s.steer });
    }
    // solid hulls for the local soldier / driver prediction
    this.colliders.length = 0;
    for (const v of this.map.values()) if (!v.dead) this.colliders.push(vehicleCollider(v));
    g.world.collision.dynamic = this.colliders;
    // models
    const cam = g.camera.position;
    let loops = 0;
    for (const v of this.map.values()) {
      const m = v.model, u = m.userData;
      m.position.set(v.x, v.y, v.z); m.rotation.y = v.yaw;
      u.body.rotation.set(v.type === 'heli' ? -v.pitch : v.pitch, 0, -v.roll, 'YXZ');
      if (v.dead !== v.wrecked) { v.wrecked = v.dead; setWrecked(m, v.dead); if (!v.dead && v.smoke) { g.effects.removeAmbientSmoke(v.smoke); v.smoke = null; } }
      if (v.dead && !v.smoke) v.smoke = g.effects.addAmbientSmoke(v.x, v.y + 1.5, v.z);
      if (v.smoke) Object.assign(v.smoke, { x: v.x, y: v.y + 1.5, z: v.z });
      const occupied = v.seats?.some((x) => x);
      if (u.wheels) {
        // wheels roll with the speed, front wheels / forks turn with the steering
        const spin = (v.speed || 0) / u.wheelR * dt;
        for (const w of u.wheels) w.rotation.x -= spin;
        const st = (v.steer ?? 0) * VEHICLES[v.type].maxSteer;
        for (const f of u.front) f.rotation.y = st;
      }
      if (v.type === 'jeep') {
        const mineGun = this.mine?.id === v.id && this.mine.seat === 1;
        u.mg.rotation.set(mineGun ? this.aimPitch || 0 : v.gunPitch, angleDiff(v.yaw, mineGun ? g.me.yaw : v.turretYaw), 0, 'YXZ');
      } else if (v.type === 'bike') {
        // parked bike: no rider -> resting on the side stand
      } else if (v.type === 'tank') {
        u.turret.rotation.y = angleDiff(v.yaw, v.turretYaw);
        u.gun.rotation.x = v.gunPitch;
        if (this.mine?.id === v.id && this.mine.seat === 1) { u.mg.rotation.set(this.aimPitch || 0, angleDiff(v.turretYaw, g.me.yaw), 0, 'YXZ'); }
      } else {
        const agl = v.y - g.world.collision.supportHeight(v.x, v.z, v.y + 0.5, 1.5);
        v.spin = damp(v.spin, v.dead ? 0 : occupied || agl > 1 ? 1 : 0, occupied ? 0.6 : 0.25, dt);
        u.rotor.rotation.y += v.spin * 28 * dt;
        u.tailRotor.rotation.x += v.spin * 90 * dt;
        const blur = v.spin > 0.55;
        u.disc.visible = blur && !v.dead;
        for (const bl of u.blades) bl.visible = !blur || v.spin < 0.8;
        if (this.mine?.id === v.id && this.mine.seat === 1) u.cannon.rotation.set(clamp(this.aimPitch || 0, -1.2, 0.3), angleDiff(v.yaw, g.me.yaw), 0, 'YXZ');
      }
      // engine / rotor sound for the closest few running vehicles
      const d = Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z);
      const running = !v.dead && (occupied || (v.type === 'heli' && v.spin > 0.05));
      if (running && d < 320 && loops < 4) {
        loops++;
        if (!v.loop) v.loop = g.audio.loop(v.type);
        const mineV = this.mine?.id === v.id;
        const vol = (mineV ? 0.55 : 1.1 * Math.max(0, 1 - d / 320) ** 2) * (v.type === 'heli' ? v.spin : v.type === 'bike' ? 0.7 : 1);
        const rev = v.type === 'heli' ? 1 : 1 + Math.min(1, Math.abs(v.speed || 0) / VEHICLES[v.type].maxSpeed) * (v.type === 'tank' ? 0.8 : 1.6);
        v.loop?.set(vol, v.type === 'heli' ? 900 + v.spin * 300 : (v.type === 'tank' ? 180 : v.type === 'jeep' ? 320 : 700) * rev, rev);
      } else if (v.loop) { v.loop.stop(); v.loop = null; }
    }
    // rockets in flight: motor flare + smoke trail
    const fx = g.effects;
    for (const r of this.rockets) {
      r.t += dt;
      const k = Math.min(1, r.t / r.tf);
      _v.copy(r.from).lerp(r.to, k);
      fx.emit(_v.x, _v.y, _v.z, (Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4, 0xcfcac2, 0.35, 1.6 + Math.random(), { grow: 3, alpha: 0.5, drag: 1.5, grav: -0.1 });
      fx.emit(_v.x, _v.y, _v.z, 0, 0, 0, 0xffb040, 0.25, 0.05, { grow: 1, alpha: 1, drag: 0, grav: 0, add: 1 });
    }
    this.rockets = this.rockets.filter((r) => r.t < r.tf);
    this.#prompt();
  }

  #prompt() {
    const el = $('vprompt'), me = this.g.me;
    const v = !this.mine && me.alive && !me.s.air && !this.g.royale ? this.nearest() : null;
    el.classList.toggle('hidden', !v);
    if (v) {
      const seat = v.seats.indexOf(0) >= 0 ? v.seats.indexOf(0) : v.seats.findIndex((x) => !x);
      el.textContent = `${this.g.isTouch ? 'TAP VEH' : 'E'} — ENTER ${SHORT[v.type]} (${SEAT_NAMES[v.type][seat] || ''})`;
    }
  }

  // controls while seated (replaces the soldier's update)
  updateLocal(dt) {
    const g = this.g, me = g.me, k = me.keys, T = me.touch, v = this.map.get(this.mine.id);
    if (!v) return;
    const chat = g.chatOpen;
    const key = (c) => !chat && k.has(c);
    const now = performance.now();
    const seat = this.mine.seat;
    // aim point: whatever the camera centre looks at
    const cam = g.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion).clone();
    const hit = g.world.collision.raycast(cam.position, fwd, 900, true);
    const aim = cam.position.clone().addScaledVector(fwd, hit ? hit.t : 900);
    this.aimPoint = aim;
    if (this.drive) {
      const s = this.drive.s;
      if (v.type !== 'heli') {
        const px = s.x - Math.sin(s.turretYaw) * 1.9, pz = s.z - Math.cos(s.turretYaw) * 1.9, py = s.y + GUN_H;
        const input = {
          throttle: (key('KeyW') ? 1 : 0) - (key('KeyS') ? 1 : 0) - (T.mz || 0),
          steer: (key('KeyA') ? 1 : 0) - (key('KeyD') ? 1 : 0) - (T.mx || 0),
          aimYaw: Math.atan2(-(aim.x - s.x), -(aim.z - s.z)),
          aimPitch: Math.atan2(aim.y - py, Math.hypot(aim.x - px, aim.z - pz)),
        };
        stepGround(g.world.collision, s, input, dt, v.type);
        this.impAcc = Math.max(this.impAcc, s.impact || 0);
      } else {
        const up = key('Space') || T.up, down = key('ShiftLeft') || key('ControlLeft') || key('KeyC') || T.down;
        const tilt = Math.max(0.5, Math.cos(s.pitch) * Math.cos(s.roll));
        // hover assist: level thrust compensates the tilt, and vertical speed is damped unless climbing / descending
        const collective = (1 / tilt - 1) / 0.75 + (up ? 0.9 : 0) - (down ? 0.9 : 0) + (up || down ? 0 : clamp(-s.vy * 0.25, -0.5, 0.5));
        const input = {
          collective,
          pitch: (key('KeyW') ? 1 : 0) - (key('KeyS') ? 1 : 0) - (T.mz || 0),
          roll: (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0) + (T.mx || 0),
          yawRate: clamp(angleDiff(s.yaw, me.yaw) * 2.2, -1, 1),
        };
        stepHeli(g.world.collision, s, input, dt);
        this.impAcc = Math.max(this.impAcc, s.impact || 0);
      }
      this.sendT += dt;
      if (this.sendT >= 1 / 30) {
        this.sendT = 0;
        g.net.send({ t: 'vin', x: +s.x.toFixed(3), y: +s.y.toFixed(3), z: +s.z.toFixed(3), yaw: +s.yaw.toFixed(4), pitch: +s.pitch.toFixed(4), roll: +s.roll.toFixed(4), sp: +(s.speed || 0).toFixed(2), st: +(s.steer || 0).toFixed(2), ty: +(s.turretYaw || 0).toFixed(4), gp: +(s.gunPitch || 0).toFixed(4), vx: +(s.vx || 0).toFixed(2), vy: +(s.vy || 0).toFixed(2), vz: +(s.vz || 0).toFixed(2), imp: +this.impAcc.toFixed(1) });
        this.impAcc = 0;
      }
    } else {
      // gunner: free aim from the mount
      const m = vehicleMount(v, seat);
      this.aimDir = new THREE.Vector3(aim.x - m.x, aim.y - m.y, aim.z - m.z).normalize();
      this.aimPitch = Math.asin(clamp(this.aimDir.y, -1, 1));
      this.sendT += dt;
      if (this.sendT >= 0.1) { this.sendT = 0; g.net.send({ t: 'vin', ay: +me.yaw.toFixed(3), ap: +this.aimPitch.toFixed(3) }); }
    }
    // weapons: server-authoritative rate / ammo, mirrored here so the trigger doesn't spam
    const W = VEHICLES[v.type].weapons[seat];
    const st = this.ammo.get(v.id), rl = st?.rl?.[seat] || 0;
    if (me.mouse.l && !chat && W && now >= (this.nextShot || 0) && now >= rl && !v.dead) {
      const d = seat === 0 ? null : this.aimDir;
      g.net.send(d ? { t: 'vfire', d: [+d.x.toFixed(4), +d.y.toFixed(4), +d.z.toFixed(4)] } : { t: 'vfire' });
      this.nextShot = now + (W.rpm ? 60000 / W.rpm : W.reload * 1000);
    }
    // the soldier rides along (minimap, audio listener, respawn logic use me.s)
    const sp = seatPosition(v, seat), pose = exposedPose(v.type, seat);
    Object.assign(me.s, { x: sp.x, y: sp.y - (pose ? EYE_HEIGHT[pose] : 1.6), z: sp.z, vx: 0, vy: 0, vz: 0, onGround: true, air: 0, stance: pose || 'stand' });
    // riders in the open are drawn (third person): the driver faces the direction of travel, gunners their aim
    this.pose = pose; this.riderYaw = pose && seat === 0 ? v.yaw : null;
    me.sprinting = false; me.ads = false; me.moveFactor = 0;
    this.#hud(v, seat, W, st, now);
  }

  #hud(v, seat, W, st, now) {
    const V = VEHICLES[v.type];
    $('vh-name').textContent = `${V.name} · ${SEAT_NAMES[v.type][seat]}`;
    const hp = Math.max(0, v.hp) / V.hp;
    const bar = $('vh-hp'); bar.style.width = `${hp * 100}%`; bar.style.background = hp > 0.5 ? '#7fd06b' : hp > 0.25 ? '#e0b44a' : '#e0574d';
    const rl = st?.rl?.[seat] || 0, ammo = st?.ammo?.[seat] ?? (W ? W.mag || W.salvo || 1 : 0);
    $('vh-weap').textContent = !W ? (seat === 0 ? 'NO WEAPON — DRIVE' : 'PASSENGER') : `${W.name} · ${now < rl ? `RELOADING ${((rl - now) / 1000).toFixed(1)} s` : W.mag || W.salvo ? `${ammo} / ${W.mag || W.salvo}` : 'READY'}`;
    const s = this.drive?.s || v;
    const kmh = Math.round(Math.abs(v.type === 'tank' ? s.speed || 0 : Math.hypot(s.vx || 0, s.vz || 0)) * 3.6);
    const agl = v.y - this.g.world.collision.supportHeight(v.x, v.z, v.y + 0.5, 1.5);
    $('vh-info').textContent = `${kmh} km/h${v.type === 'heli' ? ` · ALT ${Math.max(0, agl).toFixed(0)} m${s.vy !== undefined ? ` · V/S ${(s.vy || 0).toFixed(1)}` : ''}` : ''} · HULL ${Math.round(v.hp)}`;
    $('vh-keys').textContent = this.g.isTouch ? '' : v.type === 'jeep' || v.type === 'bike'
      ? (seat === 0 ? 'W/S throttle / brake · A/D steer · mouse look · V view · 2 next seat · E exit' : `${W ? 'mouse aim · LMB fire · RMB zoom · ' : ''}1 driver seat · E exit`)
      : v.type === 'tank'
      ? (seat === 0 ? 'W/S throttle · A/D steer · mouse turret · LMB fire · RMB zoom · V view · 2 MG seat · E exit' : 'mouse aim · LMB fire · RMB zoom · 1 driver seat · E exit')
      : (seat === 0 ? 'W/S nose down/up · A/D bank · mouse heading · SPACE climb · SHIFT descend · LMB rockets · 2 gunner · E exit' : 'mouse aim · LMB 30 mm · RMB zoom · 1 pilot seat · E exit');
    // predicted impact reticle for the main weapons (where the shell / rockets will actually land)
    const ret = $('vret');
    this.retT = (this.retT || 0) + 1;
    if (seat === 0 && W && this.retT % 4 === 0) {
      let o, d;
      if (v.type === 'tank') {
        const ty = v.turretYaw, gp = v.gunPitch, cp = Math.cos(gp);
        d = { x: -Math.sin(ty) * cp, y: Math.sin(gp), z: -Math.cos(ty) * cp };
        o = { x: v.x - Math.sin(ty) * 1.9 + d.x * 5.3, y: v.y + GUN_H + d.y * 5.3, z: v.z - Math.cos(ty) * 1.9 + d.z * 5.3 };
      } else {
        const pv = -(v.pitch || 0) - 0.03, cp = Math.cos(pv);
        d = { x: -Math.sin(v.yaw) * cp, y: Math.sin(pv), z: -Math.cos(v.yaw) * cp };
        o = { x: v.x + d.x * 3, y: v.y + 0.85, z: v.z + d.z * 3 };
      }
      const e = bulletPath(this.g.world.collision, o, d, W).end;
      _v.set(e.x, e.y, e.z).project(this.g.camera);
      const on = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      ret.classList.toggle('hidden', !on);
      if (on) { ret.style.left = `${(_v.x + 1) / 2 * innerWidth}px`; ret.style.top = `${(1 - _v.y) / 2 * innerHeight}px`; ret.classList.toggle('ready', now >= rl); }
    } else if (seat !== 0 || !W) ret.classList.add('hidden');
  }

  // ---------------------------------------------------------------- cameras
  updateCamera(cam, dt) {
    const g = this.g, me = g.me, v = this.map.get(this.mine.id);
    if (!v) return;
    const seat = this.mine.seat, zoom = me.mouse.r;
    me.pitch = clamp(me.pitch, -1.2, 0.9);
    const shake = g.effects.shake;
    const yaw = me.yaw + (Math.random() - 0.5) * shake * 0.02, pitch = me.pitch + (Math.random() - 0.5) * shake * 0.02;
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const hasGun = !!VEHICLES[v.type].weapons[seat];
    const firstPerson = (seat !== 0 && hasGun) || (zoom && hasGun) || this.firstPerson;
    this.fpView = firstPerson;
    if (firstPerson) {
      // gunner's sight / roof MG / chin turret view
      let p;
      if (seat === 0 && v.type === 'tank') p = { x: v.x - Math.sin(v.turretYaw) * 1.2, y: v.y + GUN_H + 0.55, z: v.z - Math.cos(v.turretYaw) * 1.2 };
      else if (seat === 0 || !hasGun) { const sp = seatPosition(v, seat); p = { x: sp.x, y: sp.y + (v.type === 'heli' ? 0.35 : 0.1), z: sp.z }; }
      else { const m = vehicleMount(v, seat); p = { x: m.x, y: m.y + (v.type === 'tank' ? 0.35 : -0.05), z: m.z }; }
      cam.position.set(p.x, p.y, p.z);
      this.fov = zoom ? (seat === 0 && v.type === 'tank' ? 18 : 30) : g.baseFov;
    } else {
      // chase camera orbiting the vehicle, pulled in by walls / terrain
      const heli = v.type === 'heli', [ph, oy, oz] = CHASE[v.type];
      const pivot = new THREE.Vector3(v.x, v.y + ph, v.z);
      _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ'));
      const off = new THREE.Vector3(0, oy, oz).applyQuaternion(_q);
      const len = off.length(), dir = off.normalize();
      const hit = g.world.collision.raycast(pivot, dir, len + 0.3, false);
      const dist = hit ? Math.max(1.5, hit.t - 0.4) : len;
      const want = pivot.addScaledVector(dir, dist);
      const gy = g.world.collision.supportHeight(want.x, want.z, want.y + 1, 0.2) + 0.4;
      if (want.y < gy) want.y = gy;
      cam.position.lerp(want, this.camInit ? 1 - Math.exp(-20 * dt) : 1); this.camInit = true;
      // look slightly down so the vehicle sits in the lower middle of the screen (aim = screen centre)
      cam.rotation.set(pitch - (heli ? 0.09 : 0.11), yaw, 0, 'YXZ');
      this.fov = g.baseFov * (heli ? 1.05 : 1);
    }
  }

  // ---------------------------------------------------------------- minimap
  drawMinimap(ctx, tx, tz, k, yaw) {
    const me = this.g.me.s;
    for (const v of this.map.values()) {
      if (v.dead) continue;
      const friendly = v.team === this.g.myTeam;
      if (!friendly && Math.hypot(v.x - me.x, v.z - me.z) > 110) continue;
      ctx.save(); ctx.translate(tx(v.x), tz(v.z)); ctx.rotate(-v.yaw);
      ctx.fillStyle = friendly ? '#6fb0ff' : '#ff5e4d'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
      if (v.type === 'tank') { ctx.fillRect(-4, -6, 8, 12); ctx.strokeRect(-4, -6, 8, 12); ctx.fillRect(-1, -11, 2, 6); }
      else if (v.type === 'jeep') { ctx.fillRect(-3, -5, 6, 10); ctx.strokeRect(-3, -5, 6, 10); }
      else if (v.type === 'bike') { ctx.fillRect(-1.2, -4, 2.4, 8); }
      else { ctx.beginPath(); ctx.arc(0, -2, 4, 0, 7); ctx.fill(); ctx.fillRect(-1, 0, 2, 9); ctx.beginPath(); ctx.moveTo(-7, -2); ctx.lineTo(7, -2); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.restore();
    }
  }
}
