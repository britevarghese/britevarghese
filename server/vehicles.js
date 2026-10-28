// Server-side vehicles: spawning at team bases, seats (enter / exit / switch), driver state validation, weapons
// (ballistic shells, rockets, machine guns / cannon through the shared bullet system), armour and damage,
// destruction (occupants die, credited to the attacker), respawn, run-overs, and the network snapshot.
import { VEHICLES, vehicleLoadout, stepHeli, stepGround, groundPose, heliCrashDamage, groundCrashDamage, CRASH_MIN, rayVehicle, seatPosition, vehicleCollider, vehicleMount, exposedPose, GUN_H } from '../shared/vehicles.js';
import { EYE_HEIGHT } from '../shared/world.js';
import { motorPool } from '../shared/map.js';

const TYPES = Object.keys(VEHICLES);
const RESPAWN = 25000;
// bailing out: above BAIL_SAFE m/s the tumble hurts (BAIL_DMG hp per m/s more); the soldier keeps the vehicle's
// momentum up to BAIL_CARRY m/s (game.handleInput accepts that speed for a moment after p.bailUntil is set)
const BAIL_SAFE = 8, BAIL_DMG = 5, BAIL_CARRY = 34;
// driver updates: movement budget refilled at 1.35 × top speed, holding up to BUDGET_S seconds of travel (+2 m), so
// bursty arrival (several updates a few ms apart after a network stall) passes while teleports / speed hacks don't
const BUDGET_S = 0.6;
let nextVid = 1;

export class VehicleSystem {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.colliders = [];
    const map = game.map;
    const placed = []; // footprints of the vehicles already parked: { x, z, r }
    for (const team of [1, 2]) {
      const b = map.BASES[team];
      // motor pool around the HQ (shared/map.js plans the slots and levels the ground under them)
      const pool = map.POOL?.[team] || motorPool(b), used = new Set();
      vehicleLoadout(map).forEach((type) => {
        const slot = pool.find((m) => m.type === type && !used.has(m)); used.add(slot);
        const spot = this.#clearSpot(slot.x, slot.z, type, placed);
        placed.push({ x: spot.x, z: spot.z, r: Math.hypot(VEHICLES[type].half[0], VEHICLES[type].half[2]) });
        const v = { id: nextVid++, type, team, home: { x: spot.x, z: spot.z, yaw: b.yaw } };
        this.#reset(v);
        this.list.push(v);
      });
    }
  }

  // nearest spot around (x, z) where the vehicle's footprint is free of buildings / props and of the vehicles
  // parked before it (bounding circles + 1 m)
  #clearSpot(x, z, type, placed = []) {
    const w = this.g.world, V = VEHICLES[type], r0 = Math.hypot(V.half[0], V.half[2]), r = r0 + 0.8;
    // a helicopter also needs its rotor disc clear of anything taller than the cabin (trees, walls, lamps)
    const rr = type === 'heli' ? V.rotor + 0.5 : r;
    const inside = (b, px, pz, rad) => b.max[0] > px - rad && b.min[0] < px + rad && b.max[2] > pz - rad && b.min[2] < pz + rad;
    // flat ground to park on: the height range under the footprint (centre + a ring at ~the hull's reach), the
    // closest spot that is level enough wins, else the flattest free one found
    const level = { tank: 0.35, heli: 0.45, jeep: 0.25, bike: 0.15 }[type] ?? 0.3;
    const unevenness = (px, pz) => {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2, d = k === 8 ? 0 : r0 * 0.85, h = w.map.groundHeight(px + Math.cos(a) * d, pz + Math.sin(a) * d);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return hi - lo;
    };
    let best = null;
    for (let ring = 0, rings = type === 'heli' ? 22 : 14; ring < rings; ring++) {
      for (let k = 0; k < Math.max(1, ring * 6); k++) {
        const a = (k / Math.max(1, ring * 6)) * Math.PI * 2, px = x + Math.cos(a) * ring * 3, pz = z + Math.sin(a) * ring * 3;
        const gy = w.map.groundHeight(px, pz);
        const blocked = w.query(px - rr, pz - rr, px + rr, pz + rr).some((b) => (b.max[1] > gy + 0.4 && b.min[1] < gy + 4 && inside(b, px, pz, r))
          || (rr > r && b.max[1] > gy + 2.4 && b.min[1] < gy + (V.rotorH || 3) + 1.5 && inside(b, px, pz, rr)));
        const taken = placed.some((q) => Math.hypot(q.x - px, q.z - pz) < q.r + r0 + 1);
        if (blocked || taken || w.map.seaFactor?.(px, pz) > 0.01) continue;
        const u = unevenness(px, pz);
        if (u < level) return { x: px, z: pz };
        if (!best || u + ring * 0.03 < best.score) best = { x: px, z: pz, score: u + ring * 0.03 };
      }
    }
    return best ? { x: best.x, z: best.z } : { x, z };
  }

  #reset(v) {
    const V = VEHICLES[v.type];
    Object.assign(v, {
      x: v.home.x, z: v.home.z, y: this.g.world.supportHeight(v.home.x, v.home.z, 500), yaw: v.home.yaw, pitch: 0, roll: 0,
      // parked on its wheels / tracks, following the ground (not level with one end in the air)
      ...groundPose(this.g.world, v.home.x, v.home.z, v.home.yaw, v.type),
      speed: 0, vx: 0, vy: 0, vz: 0, turretYaw: v.home.yaw, gunPitch: 0, hp: V.hp, dead: false, respawnAt: 0,
      seats: new Array(V.seats).fill(null), ammo: V.weapons.map((w) => (w ? w.mag || w.salvo || 1 : 0)), reloadUntil: V.weapons.map(() => 0), nextShot: V.weapons.map(() => 0), steer: 0,
      lastInput: this.g.now(), lastDamager: null, lastDriver: null, air: false, comp: 0, rest: true, budget: 0,
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
    if (seat === 0) { v.team = p.team; v.lastInput = this.g.now(); v.budget = 2; v.rest = false; }
    this.#placeOccupant(p, v);
    this.g.emit({ t: 'venter', id: p.id, v: v.id, seat });
  }

  switchSeat(p, seat) {
    const v = p.vehicle && this.get(p.vehicle);
    if (!v || seat < 0 || seat >= v.seats.length || v.seats[seat]) return;
    v.seats[p.seat] = null;
    if (p.seat === 0) this.#leftControls(v, p); // nobody at the controls: it rolls on / drops
    this.#sit(p, v, seat);
  }

  exit(p, silent = false) {
    const v = p.vehicle && this.get(p.vehicle);
    p.vehicle = null; p.exposed = null;
    if (!v) return;
    v.seats[p.seat] = null;
    if (p.seat === 0) this.#leftControls(v, p);
    // step out beside the hull (left side, then right, then behind)
    const V = VEHICLES[v.type], rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw), bx = Math.sin(v.yaw), bz = Math.cos(v.yaw);
    for (const [ox, oz] of [[-rx, -rz], [rx, rz], [bx, bz]]) {
      const d = (ox === bx ? V.half[2] : V.half[0]) + 1.2;
      const pos = { x: v.x + ox * d, z: v.z + oz * d };
      const gy = this.g.world.supportHeight(pos.x, pos.z, v.y + 2);
      if (!this.g.world.resolveHorizontal({ ...pos }, gy + 0.1, 1.8)) { Object.assign(p, { x: pos.x, z: pos.z, y: Math.max(gy, v.y) }); break; }
    }
    // the soldier leaves with the vehicle's momentum (capped: see BAIL_CARRY)
    const heli = V.kind === 'heli', fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
    const vx = heli ? v.vx || 0 : fx * (v.speed || 0), vz = heli ? v.vz || 0 : fz * (v.speed || 0), hs = Math.hypot(vx, vz);
    const keep = hs > BAIL_CARRY ? BAIL_CARRY / hs : 1;
    Object.assign(p, { vx: vx * keep, vz: vz * keep, vy: heli ? Math.max(-25, Math.min(11, v.vy || 0)) : 0 });
    p.bailUntil = this.g.now() + 1500; p.bailSpeed = hs * keep;
    p.history = [];
    if (!silent) this.g.emit({ t: 'vexit', id: p.id, v: v.id, x: p.x, y: p.y, z: p.z, vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2), vz: +p.vz.toFixed(2) });
    // bailing out at speed (on the ground, or from a helicopter skimming it) hurts: tumbling across the ground
    const low = !heli || p.y - this.g.world.supportHeight(p.x, p.z, p.y + 0.5) < 3;
    if (!silent && low && hs > BAIL_SAFE) this.g.damage(p, (hs - BAIL_SAFE) * BAIL_DMG, null, 'fall');
  }

  // the driver let go of the controls (got out / changed seat): a ground vehicle rolls on with its momentum and is
  // simulated here until it stops; run-over kills are still credited to (and spare the team of) whoever drove it
  #leftControls(v, p) {
    v.lastDriver = p.id; v.rest = false; v.lastInput = this.g.now();
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
    // movement budget (see BUDGET_S): judged over a window, not per message, so arrival jitter doesn't reject updates
    const rate = V.maxSpeed * 1.35, cap = rate * BUDGET_S + 2;
    v.budget = Math.min(cap, (v.budget ?? cap) + rate * dt);
    const moved = Math.hypot(m.x - v.x, m.z - v.z);
    const H = this.g.map.PLAY_HALF + 20;
    if ((moved > v.budget && !process.env.DEV_TELEPORT) || Math.abs(m.x) > H || Math.abs(m.z) > H) { this.g.emit({ t: 'vcorrect', v: v.id, x: v.x, y: v.y, z: v.z, yaw: v.yaw }, p); return; }
    v.budget = Math.max(0, v.budget - moved);
    Object.assign(v, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: +m.pitch || 0, roll: +m.roll || 0 });
    v.rest = false;
    const cl = (x, a, b) => Math.max(a, Math.min(b, +x || 0));
    if (V.kind !== 'heli') {
      // (downhill / bounces can exceed the governed top speed a little)
      v.speed = cl(m.sp, -Math.max(V.reverseSpeed, V.maxSpeed * 0.3), V.maxSpeed * 1.3); v.steer = cl(m.st, -1, 1);
      v.vy = cl(m.vy, -60, 15); v.air = !!m.ar;
      v.vx = -Math.sin(v.yaw) * v.speed; v.vz = -Math.cos(v.yaw) * v.speed;
      if (v.type === 'tank') { v.turretYaw = +m.ty || 0; v.gunPitch = cl(m.gp, V.gunPitch[0], V.gunPitch[1]); }
      if (+m.imp > CRASH_MIN) this.damage(v, groundCrashDamage(Math.min(40, +m.imp)), null, 'crash', 'crash');
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
    // the barrel / pods can stick through a wall the hull is up against: a round whose way out from the turret
    // (gun trunnions, mount, airframe centre) to the muzzle is blocked goes off at the obstruction instead
    const pv = v.type === 'tank' && seat === 0 ? { x: v.x, y: v.y + GUN_H, z: v.z } : { x: v.x, y: o.y, z: v.z };
    const bx = o.x - pv.x, by = o.y - pv.y, bz = o.z - pv.z, bl = Math.hypot(bx, by, bz);
    const block = bl > 0.01 && g.world.raycast(pv, { x: bx / bl, y: by / bl, z: bz / bl }, bl, true);
    if (block) { const t = Math.max(0, block.t - 0.05) / bl; o = { x: pv.x + bx * t, y: pv.y + by * t, z: pv.z + bz * t }; }
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
    // solid hulls where every vehicle is at the start of the tick (so the ones simulated here collide with all the
    // others), each refreshed in place once its vehicle has moved
    this.colliders.length = 0;
    for (const v of this.list) if (!v.dead) this.colliders.push((v.col = vehicleCollider(v, v.col)));
    for (const v of this.list) {
      if (v.dead) {
        if (now >= v.respawnAt) { this.#reset(v); g.emit({ t: 'vspawn', v: v.id }); continue; }
        // a shot-down helicopter's wreck drops out of the sky
        const gy = g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5);
        if (v.y > gy) { v.vy = (v.vy || 0) - 9.81 * dt; v.y = Math.max(gy, v.y + v.vy * dt); v.x += (v.vx || 0) * dt; v.z += (v.vz || 0) * dt; }
        continue;
      }
      const V = VEHICLES[v.type];
      // helicopter with nobody at the controls: falls (and crashes if high)
      if (v.type === 'heli' && !v.seats[0] && !v.rest) {
        const s = { ...v };
        stepHeli(g.world, s, { collective: 0, power: 0.15 }, dt);
        Object.assign(v, { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, pitch: s.pitch, roll: s.roll });
        if (s.impact > 6) this.damage(v, heliCrashDamage(s.impact), v.lastDamager ? g.players.get(v.lastDamager) : null, 'crash', 'crash');
        if (v.dead) continue;
        // down and stopped: parked (settled on its wheels) until someone takes the controls
        if (Math.hypot(v.vx || 0, v.vy || 0, v.vz || 0) < 0.3 && v.y - g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5) < 0.2) {
          Object.assign(v, groundPose(g.world, v.x, v.z, v.yaw, 'heli', v.y + 0.5), { vx: 0, vy: 0, vz: 0, rest: true });
        }
      } else if (V.kind !== 'heli' && !v.seats[0] && !v.rest) {
        // ground vehicle with nobody at the wheel (bailed out of at speed, left rolling / airborne): it coasts on with
        // the same physics the driver's client predicts, until it comes to rest
        stepGround(g.world, v, { throttle: 0, steer: 0 }, dt, v.type);
        if (v.speed === 0 && !v.air && Math.abs(v.vy) < 0.05) { v.rest = true; v.vy = 0; }
        if (v.impact > CRASH_MIN) this.damage(v, groundCrashDamage(Math.min(40, v.impact)), null, 'crash', 'crash');
        if (v.dead) continue;
      }
      // driver disconnected / went quiet: stop
      if (v.seats[0] && now - v.lastInput > 3000) v.speed = 0;
      if (v.type === 'bike' && !v.seats[0] && v.rest) { v.roll = 0.16; v.pitch = 0; } // parked on its side stand
      for (let i = 0; i < v.seats.length; i++) {
        const q = v.seats[i] && g.players.get(v.seats[i]);
        if (!q || !q.alive || q.vehicle !== v.id) { v.seats[i] = null; continue; }
        this.#placeOccupant(q, v);
      }
      // ground vehicles run over soldiers in their path (driven, or still rolling after the driver bailed out);
      // no friendly fire: the driver's (else the vehicle's) team is spared, like everywhere else
      if (V.kind !== 'heli' && Math.abs(v.speed) > (v.type === 'tank' ? 3 : 6)) {
        const driver = g.players.get(v.seats[0] || v.lastDriver) || null;
        for (const q of g.players.values()) {
          if (!q.alive || q.vehicle || q.air || q === driver) continue;
          if (driver ? !g.isEnemy(driver, q) : q.team === v.team) continue;
          if (Math.abs(q.y - v.y) < 2 && rayVehicle({ x: q.x, y: q.y + 0.5, z: q.z }, { x: 0, y: 1, z: 0 }, v, 0.01) !== null) g.kill(q, driver, 'roadkill');
        }
      }
      if (v.type === 'heli' && Math.abs(v.x) > g.map.MAP_HALF + 40) this.damage(v, 1000, null, 'crash', 'crash');
      if (!v.dead) vehicleCollider(v, v.col);
    }
    // wrecks are not solid
    for (let i = this.colliders.length - 1; i >= 0; i--) if (this.get(this.colliders[i].owner)?.dead) this.colliders.splice(i, 1);
  }

  snapshot() {
    return this.list.map((v) => [v.id, TYPES.indexOf(v.type), v.team, +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2), +v.yaw.toFixed(3), +(v.pitch || 0).toFixed(3), +(v.roll || 0).toFixed(3),
      +v.turretYaw.toFixed(3), +v.gunPitch.toFixed(3), Math.max(0, Math.round(v.hp)), v.dead ? 1 : 0, v.seats.map((s) => s || 0), +(v.speed || Math.hypot(v.vx, v.vz) || 0).toFixed(1), +(v.steer || 0).toFixed(2),
      // velocity, so a new driver takes over a vehicle that is still rolling / falling without a jolt
      +(v.vx || 0).toFixed(2), +(v.vy || 0).toFixed(2), +(v.vz || 0).toFixed(2)]);
  }
}

export const VEHICLE_TYPES = TYPES;
