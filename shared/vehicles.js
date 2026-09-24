// Vehicles shared by server (authority: seats, damage, weapons) and client (prediction of the driven vehicle,
// rendering): a main battle tank and an attack helicopter. Physics is deterministic and frame-rate independent
// (fixed sub-steps), like the soldier movement.
import { clamp, angleDiff } from './util.js';

export const VEHICLES = {
  tank: {
    name: 'M-30 Main Battle Tank', hp: 1000, seats: 2,
    // hull half-extents (m): width, height, length; hitbox origin at the hull bottom centre
    half: [1.8, 1.2, 3.7], radius: 2.3,
    maxSpeed: 13, reverseSpeed: 5, accel: 4.5, brake: 9, turnRate: 0.8, turretRate: 0.75, gunPitch: [-0.14, 0.33],
    // seat 0: driver + 120 mm cannon, seat 1: coaxial/roof machine gun
    weapons: [
      { id: 'tank_cannon', name: '120 mm HE shell', reload: 4.5, velocity: 560, drag: 0.02, maxRange: 1800, splash: 6, damage: 110, vehicleDamage: 320, directHit: 380 },
      { id: 'tank_mg', name: '7.62 mm MG', rpm: 650, velocity: 820, drag: 0.2, maxRange: 800, damage: 22, vehicleDamage: 2, mag: 200, reload: 5 },
    ],
    // bullets and grenades vs armour
    armor: { bullet: 0.02, grenade: 0.5, explosive: 1 },
    eye: [0, 3.1, -0.2],
  },
  heli: {
    name: 'AH-7 Attack Helicopter', hp: 650, seats: 2,
    half: [1.3, 1.45, 5.5], radius: 3.2, rotor: 7.3,
    maxSpeed: 62, climb: 11, yawRate: 1.6, pitchMax: 0.42, rollMax: 0.5,
    weapons: [
      { id: 'heli_rockets', name: 'Hydra-class rockets', salvo: 14, rpm: 360, reload: 7, velocity: 190, drag: 0, gravityScale: 0.25, maxRange: 1200, splash: 4.5, damage: 90, vehicleDamage: 170, directHit: 210 },
      { id: 'heli_cannon', name: '30 mm cannon', rpm: 520, velocity: 800, drag: 0.15, maxRange: 1000, splash: 2, damage: 38, vehicleDamage: 40, directHit: 55, mag: 120, reload: 4 },
    ],
    armor: { bullet: 0.25, grenade: 0.8, explosive: 1 },
    eye: [0, 1.6, -3.2],
  },
};

// which vehicles each team gets at its base on a map (bigger maps get helicopters)
export function vehicleLoadout(map) {
  if (map.def.mode === 'royale') return [];
  const big = map.PLAY_HALF >= 180;
  return big ? ['tank', 'heli'] : map.PLAY_HALF >= 150 ? ['tank'] : [];
}

const STEP = 1 / 120;

// ---------------------------------------------------------------- tank (tracked, terrain following)
// s: { x, y, z, yaw, pitch, roll, speed, turretYaw (world), gunPitch }
// input: { throttle -1..1, steer -1..1, aimYaw (world), aimPitch }
export function stepTank(world, s, input, dt) {
  const V = VEHICLES.tank;
  world.ignoreOwner = s.id;
  const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), h = dt / n;
  for (let i = 0; i < n; i++) {
    const th = clamp(input.throttle || 0, -1, 1);
    const want = th >= 0 ? th * V.maxSpeed : th * V.reverseSpeed;
    const a = Math.sign(want - s.speed) === Math.sign(s.speed) || s.speed === 0 ? V.accel : V.brake;
    s.speed += clamp(want - s.speed, -a * h, a * h);
    // tracks: pivot turns when slow, wider arcs at speed
    const turn = (input.steer || 0) * V.turnRate * (1 - Math.min(0.45, Math.abs(s.speed) / V.maxSpeed * 0.45));
    s.yaw += turn * h * (s.speed < -0.2 ? -1 : 1);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const pos = { x: s.x + fx * s.speed * h, z: s.z + fz * s.speed * h };
    if (world.resolveHorizontal(pos, s.y + 0.6, 2.2, V.radius)) s.speed *= 0.6;
    s.x = pos.x; s.z = pos.z;
    // turret + gun follow the aim at their drive rates
    const ty = input.aimYaw ?? s.turretYaw;
    s.turretYaw += clamp(angleDiff(s.turretYaw, ty), -V.turretRate * h, V.turretRate * h);
    s.gunPitch = clamp(s.gunPitch + clamp((input.aimPitch ?? s.gunPitch) - s.gunPitch, -0.4 * h, 0.4 * h), V.gunPitch[0], V.gunPitch[1]);
  }
  // sit on the ground: height from the centre, pitch/roll from front/back and left/right samples
  const [hw, , hl] = V.half;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
  const g = (x, z) => world.supportHeight(x, z, s.y + 1.2, 0.3);
  const f = g(s.x + fx * hl * 0.8, s.z + fz * hl * 0.8), b = g(s.x - fx * hl * 0.8, s.z - fz * hl * 0.8);
  const l = g(s.x - rx * hw, s.z - rz * hw), r = g(s.x + rx * hw, s.z + rz * hw);
  const y = Math.max((f + b + l + r) / 4, g(s.x, s.z));
  const k = 1 - Math.exp(-12 * dt);
  s.y += (y - s.y) * k;
  s.pitch += (Math.atan2(f - b, hl * 1.6) - s.pitch) * k;
  s.roll += (Math.atan2(l - r, hw * 2) - s.roll) * k;
  world.ignoreOwner = null;
  return s;
}

// ---------------------------------------------------------------- helicopter
// s: { x, y, z, vx, vy, vz, yaw, pitch, roll, landed }
// input: { collective -1..1, yawRate -1..1, pitch -1..1 (nose down +), roll -1..1 (bank right +), power 0..1 }
export function stepHeli(world, s, input, dt) {
  const V = VEHICLES.heli, G = 9.81;
  world.ignoreOwner = s.id;
  const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), h = dt / n;
  let impact = 0;
  for (let i = 0; i < n; i++) {
    const ground = world.supportHeight(s.x, s.z, s.y + 0.5, 1.5);
    const agl = s.y - ground;
    const col = clamp(input.collective || 0, -1, 1);
    // attitude: pilot input sets target pitch/roll, rotor disc follows quickly
    const tp = clamp(input.pitch || 0, -1, 1) * V.pitchMax, tr = clamp(input.roll || 0, -1, 1) * V.rollMax;
    const onGround = agl < 0.15 && col <= 0.05;
    s.pitch += ((onGround ? 0 : tp) - s.pitch) * (1 - Math.exp(-3.2 * h));
    s.roll += ((onGround ? 0 : tr) - s.roll) * (1 - Math.exp(-3.2 * h));
    s.yaw += clamp(input.yawRate || 0, -1, 1) * V.yawRate * h * (onGround ? 0.3 : 1);
    // thrust along the rotor axis: hover + collective, tilted by pitch (forward) and roll (sideways)
    // power: 1 with a pilot at the controls; an abandoned helicopter's rotor loses lift and it drops
    const thrust = G * (1 + col * 0.75) * (onGround && col <= 0.05 ? 0 : 1) * (input.power ?? 1);
    const fwd = Math.sin(s.pitch) * thrust, side = Math.sin(s.roll) * thrust, up = Math.cos(s.pitch) * Math.cos(s.roll) * thrust;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    s.vx += (fx * fwd + rx * side) * h * 1.6; s.vz += (fz * fwd + rz * side) * h * 1.6;
    s.vy += (up - G) * h;
    // aerodynamic drag (quadratic horizontally caps speed near maxSpeed), vertical damping
    const hs = Math.hypot(s.vx, s.vz), dragK = (onGround ? 3 : 0.035) + (hs / V.maxSpeed) ** 2 * 0.075;
    s.vx -= s.vx * dragK * h; s.vz -= s.vz * dragK * h;
    s.vy -= s.vy * 0.6 * h;
    s.vy = clamp(s.vy, -25, V.climb);
    // move + collide
    const pos = { x: s.x + s.vx * h, z: s.z + s.vz * h };
    if (world.resolveHorizontal(pos, s.y - 0.2, 2.8, V.radius)) { impact = Math.max(impact, hs); s.vx *= 0.2; s.vz *= 0.2; }
    s.x = pos.x; s.z = pos.z;
    s.y += s.vy * h;
    const g2 = world.supportHeight(s.x, s.z, s.y + 0.5, 1.5);
    const ceil = world.ceilingHeight(s.x, s.z, s.y + 0.5, 1.5);
    if (s.y + 2.9 > ceil && s.vy > 0) { impact = Math.max(impact, s.vy * 2); s.y = ceil - 2.9; s.vy = 0; }
    if (s.y <= g2) {
      impact = Math.max(impact, -s.vy + hs * 0.5 + Math.abs(s.roll) * 20 * (hs > 3 ? 1 : 0));
      s.y = g2; if (s.vy < 0) s.vy = 0; s.vx *= 0.7; s.vz *= 0.7; s.landed = true;
    } else s.landed = false;
  }
  s.impact = impact; // m/s-ish crash severity this step (server applies damage above a threshold)
  world.ignoreOwner = null;
  return s;
}

// height of the tank gun's trunnions above the ground (turret ring 1.58 m + 0.4 m)
export const GUN_H = 1.98;

// world position of a gunner's weapon mount (seat 1): tank roof MG / helicopter chin cannon
export function vehicleMount(v, seat = 1) {
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  if (v.type === 'tank') {
    const ty = v.turretYaw ?? v.yaw, c = Math.cos(ty), s = Math.sin(ty);
    return { x: v.x + c * 0.75 + s * 0.3, y: v.y + 2.9, z: v.z - s * 0.75 + c * 0.3 };
  }
  return { x: v.x - sy * 3.6, y: v.y + 0.5, z: v.z - cy * 3.6 };
}

// crash damage from impact severity
export const heliCrashDamage = (impact) => (impact < 6 ? 0 : (impact - 6) * 110);

// oriented hit box of a vehicle: returns { c:[x,y,z], ax: [right, up, fwd unit vectors], half }
export function vehicleBox(v) {
  const V = VEHICLES[v.type];
  // tank pitch: + = nose up; helicopter pitch: + = nose down (it accelerates forward)
  const pv = v.type === 'heli' ? -(v.pitch || 0) : v.pitch || 0;
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(pv), sp = Math.sin(pv);
  const fwd = [-sy * cp, sp, -cy * cp], right = [cy, 0, -sy];
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const c = [v.x + up[0] * V.half[1], v.y + up[1] * V.half[1], v.z + up[2] * V.half[1]];
  return { c, ax: [right, up, fwd], half: V.half };
}

// ray (o, unit d) vs oriented box -> distance or null
export function rayVehicle(o, d, v, maxT) {
  const { c, ax, half } = vehicleBox(v);
  let tmin = 0, tmax = maxT;
  const p = [c[0] - o.x, c[1] - o.y, c[2] - o.z];
  for (let i = 0; i < 3; i++) {
    const a = ax[i], e = a[0] * p[0] + a[1] * p[1] + a[2] * p[2], f = a[0] * d.x + a[1] * d.y + a[2] * d.z;
    if (Math.abs(f) > 1e-9) {
      let t1 = (e + half[i]) / f, t2 = (e - half[i]) / f;
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    } else if (-e - half[i] > 0 || -e + half[i] < 0) return null;
  }
  return tmin;
}

// where a seated soldier is (for their own camera + the server's position of the occupant)
export function seatPosition(v, seat) {
  const V = VEHICLES[v.type], e = V.eye;
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  const z = e[2] + (seat ? (v.type === 'heli' ? -1.4 : 1.2) : 0);
  // local frame: x right, z backward (-z = forward)
  return { x: v.x + cy * e[0] + sy * z, y: v.y + e[1], z: v.z - sy * e[0] + cy * z };
}

// axis-aligned collider around a vehicle (soldiers can't walk through it, can stand on it)
export function vehicleCollider(v, out = { min: [0, 0, 0], max: [0, 0, 0], surface: 'metal', bullets: false, tag: 'vehicle' }) {
  const V = VEHICLES[v.type];
  // bounds of the rotated hull footprint
  const c = Math.abs(Math.cos(v.yaw)), sn = Math.abs(Math.sin(v.yaw)), [hw, hh, hl] = V.half;
  const ex = c * hw + sn * hl * 0.92, ez = sn * hw + c * hl * 0.92;
  out.owner = v.id;
  out.min[0] = v.x - ex; out.min[1] = v.y; out.min[2] = v.z - ez;
  out.max[0] = v.x + ex; out.max[1] = v.y + hh * 1.6; out.max[2] = v.z + ez;
  return out;
}
