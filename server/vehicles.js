// Server-side vehicles: spawning at team bases, seats (enter / exit / switch), driver state validation, weapons
// (ballistic shells, rockets, machine guns / cannon through the shared bullet system), armour and damage,
// destruction (occupants die, credited to the attacker), respawn, run-overs, and the network snapshot.
import { VEHICLES, vehicleLoadout, stepHeli, heliCrashDamage, groundCrashDamage, rayVehicle, seatPosition, vehicleCollider, vehicleMount, exposedPose, GUN_H } from '../shared/vehicles.js';
import { EYE_HEIGHT } from '../shared/world.js';

const TYPES = Object.keys(VEHICLES);
const RESPAWN = 25000;
let nextVid = 1;

export class VehicleSystem {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.colliders = [];
    const map = game.map;
    for (const team of [1, 2]) {
      const b = map.BASES[team];
      const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
      let bikes = 0;
      vehicleLoadout(map).forEach((type) => {
        // motor pool around the HQ: tank right, helicopter pad left, jeep beside the tank, bikes behind the HQ
        const [side, back] = type === 'tank' ? [16, 4] : type === 'heli' ? [-20, 4] : type === 'jeep' ? [25, 2] : [6 + 3 * bikes++, 10];
        const spot = this.#clearSpot(b.x + rx * side - fx * back, b.z + rz * side - fz * back, type);
        const v = { id: nextVid++, type, team, home: { x: spot.x, z: spot.z, yaw: b.yaw } };
        this.#reset(v);
        this.list.push(v);
      });
    }
  }

  // nearest spot around (x, z) where the vehicle's footprint is free of buildings / props
  #clearSpot(x, z, type) {
    const w = this.g.world, V = VEHICLES[type], r = Math.hypot(V.half[0], V.half[2]) + 0.8;
    for (let ring = 0; ring < 12; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const a = (k / Math.max(1, ring * 6)) * Math.PI * 2, px = x + Math.cos(a) * ring * 3, pz = z + Math.sin(a) * ring * 3;
        const gy = w.map.groundHeight(px, pz);
        const blocked = w.query(px - r, pz - r, px + r, pz + r).some((b) => b.max[1] > gy + 0.4 && b.min[1] < gy + 4 && b.max[0] > px - r && b.min[0] < px + r && b.max[2] > pz - r && b.min[2] < pz + r);
        const slope = Math.abs(w.map.groundHeight(px + 3, pz) - w.map.groundHeight(px - 3, pz)) + Math.abs(w.map.groundHeight(px, pz + 3) - w.map.groundHeight(px, pz - 3));
        if (!blocked && slope < 2.5) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  #reset(v) {
    const V = VEHICLES[v.type];
    Object.assign(v, {
      x: v.home.x, z: v.home.z, y: this.g.world.supportHeight(v.home.x, v.home.z, 500), yaw: v.home.yaw, pitch: 0, roll: 0,
      speed: 0, vx: 0, vy: 0, vz: 0, turretYaw: v.home.yaw, gunPitch: 0, hp: V.hp, dead: false, respawnAt: 0,
      seats: new Array(V.seats).fill(null), ammo: V.weapons.map((w) => (w ? w.mag || w.salvo || 1 : 0)), reloadUntil: V.weapons.map(() => 0), nextShot: V.weapons.map(() => 0), steer: 0,
      lastInput: this.g.now(), lastDamager: null,
    });
  }

  // new round: everyone out, every vehicle back at its base
  resetAll() {
    for (const v of this.list) {
      for (const sid of v.seats || []) { const q = sid && this.g.players.get(sid); if (q) this.exit(q, true); }
      this.#reset(v);
    }
  }

  get(id) { return this.list.find((v) => v.id === id); }

  // ---------------------------------------------------------------- seats
  enter(p, id) {
    const v = this.get(id);
    if (!v || v.dead || p.vehicle || !p.alive || p.air) return;
    if (Math.hypot(v.x - p.x, v.z - p.z) > VEHICLES[v.type].radius + 3.2 || Math.abs(v.y - p.y) > 4) return;
    // an enemy-held vehicle can't be boarded while an enemy is inside
    if (v.seats.some((sid) => sid && this.g.isEnemy(p, this.g.players.get(sid) || p))) return;
    const seat = v.seats.indexOf(null);
    if (seat < 0) return;
    this.#sit(p, v, seat);
  }

  #sit(p, v, seat) {
    v.seats[seat] = p.id; p.vehicle = v.id; p.seat = seat; p.reloadUntil = 0; p.stance = 'stand';
    // bike riders / the jeep's roof gunner sit in the open: visible, and bullets hit them
    p.exposed = exposedPose(v.type, seat); p.vx = p.vz = 0;
    if (seat === 0) { v.team = p.team; v.lastInput = this.g.now(); }
    this.#placeOccupant(p, v);
    this.g.emit({ t: 'venter', id: p.id, v: v.id, seat });
  }

  switchSeat(p, seat) {
    const v = p.vehicle && this.get(p.vehicle);
    if (!v || seat < 0 || seat >= v.seats.length || v.seats[seat]) return;
    v.seats[p.seat] = null;
    if (p.seat === 0) v.speed = 0; // driver left the controls
    this.#sit(p, v, seat);
  }

  exit(p, silent = false) {
    const v = p.vehicle && this.get(p.vehicle);
    p.vehicle = null; p.exposed = null;
    if (!v) return;
    v.seats[p.seat] = null;
    if (p.seat === 0) v.speed = 0;
    // step out beside the hull (left side, then right, then behind)
    const V = VEHICLES[v.type], rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), bx = Math.sin(v.yaw), bz = Math.cos(v.yaw);
    for (const [ox, oz] of [[-rx, -rz], [rx, rz], [bx, bz]]) {
      const d = (ox === bx ? V.half[2] : V.half[0]) + 1.2;
      const pos = { x: v.x + ox * d, z: v.z + oz * d };
      const gy = this.g.world.supportHeight(pos.x, pos.z, v.y + 2);
      if (!this.g.world.resolveHorizontal({ ...pos }, gy + 0.1, 1.8)) { Object.assign(p, { x: pos.x, z: pos.z, y: Math.max(gy, v.y), vx: 0, vz: 0, vy: 0 }); break; }
    }
    p.history = [];
    if (!silent) this.g.emit({ t: 'vexit', id: p.id, v: v.id, x: p.x, y: p.y, z: p.z });
  }

  #placeOccupant(p, v) {
    const s = seatPosition(v, p.seat), pose = p.exposed;
    p.x = s.x; p.z = s.z; p.onGround = true;
    if (pose) { p.stance = pose; p.y = s.y - EYE_HEIGHT[pose]; if (p.seat === 0) p.yaw = v.yaw; }
    else p.y = s.y - 1.6;
  }

  // ---------------------------------------------------------------- driver state (client-predicted, validated here)
  input(p, m) {
    const v = p.vehicle && this.get(p.vehicle);
    if (!v || v.dead) return;
    const now = this.g.now();
    if (p.seat !== 0) {
      if (Number.isFinite(m.ay)) {
        const ap = Math.max(-1.2, Math.min(0.8, +m.ap || 0));
        v.aim = v.aim || []; v.aim[p.seat] = { yaw: +m.ay, pitch: ap };
        p.yaw = +m.ay; p.pitch = ap;
        if (v.type === 'jeep' && p.seat === 1) { v.turretYaw = +m.ay; v.gunPitch = ap; } // the roof ring follows its gunner
      }
      return;
    }
    const V = VEHICLES[v.type];
    const dt = Math.max(0.001, (now - v.lastInput) / 1000); v.lastInput = now;
    if (![m.x, m.y, m.z, m.yaw].every(Number.isFinite)) return;
    const moved = Math.hypot(m.x - v.x, m.z - v.z), limit = (V.maxSpeed * 1.35) * Math.min(dt, 0.5) + 1;
    const H = this.g.map.PLAY_HALF + 20;
    if ((moved > limit && !process.env.DEV_TELEPORT) || Math.abs(m.x) > H || Math.abs(m.z) > H) { this.g.emit({ t: 'vcorrect', v: v.id, x: v.x, y: v.y, z: v.z, yaw: v.yaw }, p); return; }
    Object.assign(v, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: +m.pitch || 0, roll: +m.roll || 0 });
    if (V.kind !== 'heli') {
      v.speed = Math.max(-V.reverseSpeed, Math.min(V.maxSpeed, +m.sp || 0)); v.steer = Math.max(-1, Math.min(1, +m.st || 0));
      if (v.type === 'tank') { v.turretYaw = +m.ty || 0; v.gunPitch = Math.max(V.gunPitch[0], Math.min(V.gunPitch[1], +m.gp || 0)); }
      if (+m.imp > 11 && V.kind === 'wheeled') this.damage(v, groundCrashDamage(Math.min(40, +m.imp)), null, 'crash', 'crash');
    } else { v.vx = +m.vx || 0; v.vy = +m.vy || 0; v.vz = +m.vz || 0; if (+m.imp > 6) this.damage(v, heliCrashDamage(Math.min(40, +m.imp)), v.lastDamager ? this.g.players.get(v.lastDamager) : null, 'crash'); }
  }

  // ---------------------------------------------------------------- weapons
  fire(p, m) {
    const v = p.vehicle && this.get(p.vehicle), g = this.g, now = g.now();
    if (!v || v.dead || g.roundOver) return;
    const seat = p.seat, W = VEHICLES[v.type].weapons[seat];
    if (!W || now < v.reloadUntil[seat] || now < v.nextShot[seat]) return;
    if (v.ammo[seat] <= 0) { v.reloadUntil[seat] = now + W.reload * 1000; v.ammo[seat] = W.mag || W.salvo || 1; return; }
    let o, d;
    const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
    if (v.type === 'tank' && seat === 0) {
      // 120 mm: from the muzzle along the gun (trunnions 1.9 m ahead of the turret ring, 5.3 m barrel)
      const ty = v.turretYaw, gp = v.gunPitch, cp = Math.cos(gp);
      d = { x: -Math.sin(ty) * cp, y: Math.sin(gp), z: -Math.cos(ty) * cp };
      o = { x: v.x - Math.sin(ty) * 1.9 + d.x * 5.3, y: v.y + GUN_H + d.y * 5.3, z: v.z - Math.cos(ty) * 1.9 + d.z * 5.3 };
    } else if (v.type === 'heli' && seat === 0) {
      // rocket pods on the stub wings, firing along the nose (slightly down with the airframe)
      const side = v.ammo[seat] % 2 ? 1 : -1, pv = -(v.pitch || 0) - 0.03, cp = Math.cos(pv);
      d = { x: -sy * cp, y: Math.sin(pv), z: -cy * cp };
      o = { x: v.x + cy * side * 1.25 + d.x * 2, y: v.y + 0.85, z: v.z - sy * side * 1.25 + d.z * 2 };
    } else {
      // gunner: free aim sent by the client (clamped), from the gun mount
      const a = Array.isArray(m.d) ? { x: +m.d[0], y: +m.d[1], z: +m.d[2] } : null;
      const l = a && Math.hypot(a.x, a.y, a.z);
      if (!l || !Number.isFinite(l)) return;
      d = { x: a.x / l, y: Math.max(-0.9, Math.min(0.7, a.y / l)), z: a.z / l };
      const mount = vehicleMount(v, seat);
      o = { x: mount.x + d.x * 1.2, y: mount.y + d.y * 1.2, z: mount.z + d.z * 1.2 };
    }
    v.ammo[seat]--;
    v.nextShot[seat] = now + (W.rpm ? 60000 / W.rpm : W.reload * 1000);
    if (v.ammo[seat] <= 0) { v.reloadUntil[seat] = now + W.reload * 1000; v.ammo[seat] = W.mag || W.salvo || 1; }
    p.spawnProtect = 0;
    g.fireProjectile(p, o, d, W, v);
    this.#sendAmmo(p, v);
  }

  #sendAmmo(p, v) { if (!p.bot) this.g.emit({ t: 'vammo', v: v.id, ammo: v.ammo, rl: v.reloadUntil.map((t) => Math.max(0, t - this.g.now())) }, p); }

  // ---------------------------------------------------------------- damage
  // weaponKind: 'bullet' | 'grenade' | 'explosive' | 'crash'
  damage(v, amount, attacker, weapon, kind = 'explosive') {
    if (v.dead || amount <= 0) return;
    const A = VEHICLES[v.type].armor;
    const dmg = kind === 'crash' ? amount : amount * (A[kind] ?? 1);
    if (dmg <= 0) return;
    v.hp -= dmg;
    if (attacker && attacker.team !== v.team) v.lastDamager = attacker.id;
    this.g.emit({ t: 'vhurt', v: v.id, hp: Math.max(0, Math.round(v.hp)), d: Math.round(dmg), a: attacker ? attacker.id : 0 });
    if (attacker && !attacker.bot && dmg >= 1) this.g.emit({ t: 'hitmark', hs: false, k: v.hp <= 0, d: Math.round(dmg), v: -v.id, r: 0 }, attacker);
    if (v.hp <= 0) this.destroy(v, attacker || (v.lastDamager && this.g.players.get(v.lastDamager)) || null, weapon);
  }

  destroy(v, killer, weapon) {
    const g = this.g;
    v.dead = true; v.hp = 0; v.respawnAt = g.now() + RESPAWN; v.speed = 0; v.vx *= 0.3; v.vz *= 0.3; v.vy = Math.min(0, v.vy || 0);
    g.emit({ t: 'vboom', v: v.id, x: v.x, y: v.y + 1.2, z: v.z });
    for (const sid of v.seats) {
      const q = sid && g.players.get(sid);
      if (!q) continue;
      this.exit(q, true);
      g.kill(q, killer && killer !== q ? killer : null, weapon || 'vehicle');
    }
    v.seats.fill(null);
    if (killer && killer.team !== v.team) killer.score += 200;
    g.explodeAt(v.x, v.y + 1.2, v.z, { radius: 7, damage: 90, owner: killer, weapon: 'vehicle', vehicleDamage: 0 });
  }

  // nearest vehicle hit by a ray segment (skipping the shooter's own vehicle): { v, t } or null
  rayTest(o, d, maxT, shooter) {
    let best = null;
    for (const v of this.list) {
      if (v.dead || (shooter && shooter.vehicle === v.id)) continue;
      if (Math.hypot(v.x - (o.x + d.x * maxT / 2), v.z - (o.z + d.z * maxT / 2)) > maxT / 2 + 10) continue;
      const t = rayVehicle(o, d, v, maxT);
      if (t !== null && (!best || t < best.t)) best = { v, t };
    }
    return best;
  }

  // blast damage to vehicles (line-of-sight not required: shrapnel/overpressure)
  explosion(x, y, z, radius, vehicleDamage, owner, weapon, kind = 'explosive') {
    for (const v of this.list) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - x, v.y + 1.2 - y, v.z - z) - VEHICLES[v.type].half[0];
      if (d > radius) continue;
      this.damage(v, vehicleDamage * (1 - Math.max(0, d) / radius), owner, weapon, kind);
    }
  }

  // ---------------------------------------------------------------- tick
  tick(dt, now) {
    const g = this.g;
    this.colliders.length = 0;
    for (const v of this.list) {
      if (v.dead) {
        if (now >= v.respawnAt) { this.#reset(v); g.emit({ t: 'vspawn', v: v.id }); continue; }
        // a shot-down helicopter's wreck drops out of the sky
        const gy = g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5);
        if (v.y > gy) { v.vy = (v.vy || 0) - 9.81 * dt; v.y = Math.max(gy, v.y + v.vy * dt); v.x += (v.vx || 0) * dt; v.z += (v.vz || 0) * dt; }
        continue;
      }
      // helicopter with nobody at the controls: falls (and crashes if high)
      if (v.type === 'heli' && !v.seats[0]) {
        const s = { ...v };
        stepHeli(g.world, s, { collective: 0, power: 0.15 }, dt);
        Object.assign(v, { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, pitch: s.pitch, roll: s.roll });
        if (s.impact > 6) this.damage(v, heliCrashDamage(s.impact), v.lastDamager ? g.players.get(v.lastDamager) : null, 'crash', 'crash');
      }
      // driver disconnected / went quiet: stop
      if (v.seats[0] && now - v.lastInput > 3000) v.speed = 0;
      if (v.type === 'bike' && !v.seats[0]) { v.roll = 0.16; v.pitch = 0; } // parked on its side stand
      for (let i = 0; i < v.seats.length; i++) {
        const q = v.seats[i] && g.players.get(v.seats[i]);
        if (!q || !q.alive || q.vehicle !== v.id) { v.seats[i] = null; continue; }
        this.#placeOccupant(q, v);
      }
      // tanks run over soldiers in their path
      if (VEHICLES[v.type].kind !== 'heli' && Math.abs(v.speed) > (v.type === 'tank' ? 3 : 6) && v.seats[0]) {
        const driver = g.players.get(v.seats[0]);
        for (const q of g.players.values()) {
          if (!q.alive || q.vehicle || q.air || q === driver) continue;
          if (Math.abs(q.y - v.y) < 2 && rayVehicle({ x: q.x, y: q.y + 0.5, z: q.z }, { x: 0, y: 1, z: 0 }, v, 0.01) !== null) g.kill(q, driver && g.isEnemy(driver, q) ? driver : null, 'roadkill');
        }
      }
      if (v.type === 'heli' && Math.abs(v.x) > g.map.MAP_HALF + 40) this.damage(v, 1000, null, 'crash', 'crash');
      this.colliders.push(vehicleCollider(v));
    }
  }

  snapshot() {
    return this.list.map((v) => [v.id, TYPES.indexOf(v.type), v.team, +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +v.yaw.toFixed(3), +(v.pitch || 0).toFixed(3), +(v.roll || 0).toFixed(3),
      +v.turretYaw.toFixed(3), +v.gunPitch.toFixed(3), Math.max(0, Math.round(v.hp)), v.dead ? 1 : 0, v.seats.map((s) => s || 0), +(v.speed || Math.hypot(v.vx, v.vz) || 0).toFixed(1), +(v.steer || 0).toFixed(2)]);
  }
}

export const VEHICLE_TYPES = TYPES;
