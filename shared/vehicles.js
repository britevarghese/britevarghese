// Vehicles shared by server (authority: seats, damage, weapons) and client (prediction of the driven vehicle,
// rendering): a main battle tank and an attack helicopter. Physics is deterministic and frame-rate independent
// (fixed sub-steps), like the soldier movement.
import { clamp, angleDiff } from './util.js';
import { STEP_UP } from './world.js';

// Ground vehicle drivetrain / chassis (SI units, accelerations in m/s²):
//   accel: traction-limited launch; power: specific power (W/kg) -> engine accel ≈ power / speed once rolling;
//   brake: service brakes; coast: rolling resistance + engine braking off the throttle; grip: lateral tyre limit
//   (μ·g); maxSlope: steepest climb (deg, tyres / tracks slip above it and it slides back); step: highest ledge it
//   drives up onto (m); susp: suspension droop (wheels keep traction while the hull is this far above the ground);
//   bounce: restitution against walls; hull: [offset ahead of the centre, radius] circles for world collision.
export const VEHICLES = {
  tank: {
    name: 'M-30 Main Battle Tank', kind: 'tracked', hp: 1000, seats: 2,
    // hull half-extents (m): width, height, length; hitbox origin at the hull bottom centre
    half: [1.8, 1.2, 3.7], radius: 2.3, hull: [[1.9, 1.8], [0, 1.8], [-1.9, 1.8]],
    // ~60 t on ~1100 kW (≈12 W/kg at the sprockets): high tractive effort when crawling (climbs 60 % grades),
    // power-limited above ~2 m/s -> 0-47 km/h in ~7 s (≈1.8 m/s² average); skid-steering scrubs speed
    maxSpeed: 13, reverseSpeed: 5, accel: 5.5, power: 12, brake: 6, coast: 3, turnScrub: 1.5, maxSlope: 31, step: 0.9, susp: 0.12, bounce: 0.1,
    turnRate: 0.8, turretRate: 0.75, gunPitch: [-0.14, 0.33],
    // seat 0: driver + 120 mm cannon (1100 m/s, ~1030 m/s left at 1 km), seat 1: coaxial/roof machine gun
    weapons: [
      { id: 'tank_cannon', name: '120 mm HE shell', reload: 4.5, velocity: 1100, dragQ: 6e-5, maxRange: 1800, splash: 6, damage: 110, vehicleDamage: 320, directHit: 380 },
      { id: 'tank_mg', name: '7.62 mm MG', rpm: 650, velocity: 820, dragQ: 0.8e-3, maxRange: 800, damage: 22, vehicleDamage: 2, mag: 200, reload: 5 },
    ],
    // bullets and grenades vs armour
    armor: { bullet: 0.02, grenade: 0.5, explosive: 1 },
    eye: [0, 3.1, -0.2], seatPos: [[0, 3.1, -0.2], [0, 3.1, 1.0]],
  },
  heli: {
    name: 'AH-7 Attack Helicopter', kind: 'heli', hp: 650, seats: 2,
    // fuselage circles: nose / cabin / tail boom; rotor: main rotor radius (m) at rotorH above the skids
    half: [1.3, 1.45, 5.5], radius: 3.2, hull: [[3.0, 1.5], [0.3, 1.6], [-2.7, 1.0], [-4.8, 0.7]], rotor: 7.3, rotorH: 2.9,
    // pitchMax limits the combined tilt of the rotor disc; drag is tuned so full tilt levels off at ≈ maxSpeed
    maxSpeed: 62, climb: 11, yawRate: 1.6, pitchMax: 0.45, rollMax: 0.45, dragLin: 0.015, dragQuad: 0.0615,
    weapons: [
      { id: 'heli_rockets', name: 'Hydra-class rockets', salvo: 14, rpm: 360, reload: 7, velocity: 190, drag: 0, gravityScale: 0.25, maxRange: 1200, splash: 4.5, damage: 90, vehicleDamage: 170, directHit: 210 },
      { id: 'heli_cannon', name: '30 mm cannon', rpm: 520, velocity: 800, dragQ: 0.29e-3, maxRange: 1000, splash: 2, damage: 38, vehicleDamage: 40, directHit: 55, mag: 120, reload: 4 },
    ],
    armor: { bullet: 0.25, grenade: 0.8, explosive: 1 },
    eye: [0, 1.6, -3.2], seatPos: [[0, 1.6, -3.2], [0, 1.6, -4.6]],
  },
  // light utility vehicle (Humvee class): fast, lightly armoured, a .50 cal on the roof ring
  jeep: {
    name: 'LTV-4 Light Utility Vehicle', kind: 'wheeled', hp: 420, seats: 3,
    half: [1.1, 1.0, 2.45], radius: 1.9, hull: [[1.35, 1.1], [0, 1.1], [-1.35, 1.1]],
    // 0-97 km/h ≈ 6 s, 0.76 g brakes, 0.8 g cornering, 60 % grade, 0.5 m vertical step (Humvee: 0.46 m)
    maxSpeed: 27, reverseSpeed: 7, accel: 5.5, power: 82, brake: 7.5, coast: 1.3, maxSlope: 31, step: 0.5, susp: 0.25, bounce: 0.2,
    wheelbase: 3.3, maxSteer: 0.55, grip: 7.85,
    weapons: [null, { id: 'jeep_mg', name: '.50 cal machine gun', rpm: 550, velocity: 880, dragQ: 0.53e-3, maxRange: 1000, damage: 34, vehicleDamage: 9, mag: 100, reload: 5 }, null],
    armor: { bullet: 0.3, grenade: 1, explosive: 1.2 },
    // driver, roof gunner (standing in the ring: exposed), passenger
    seatPos: [[-0.45, 1.5, 0.0], [0, 2.35, 0.55], [0.45, 1.5, 0.0]], exposed: { 1: 'stand' },
  },
  // dirt bike: the fastest way around, zero protection
  bike: {
    name: 'TR-450 Trail Motorcycle', kind: 'wheeled', hp: 160, seats: 2,
    half: [0.42, 0.62, 1.1], radius: 1.0, hull: [[0.6, 0.5], [-0.6, 0.5]],
    // 0-119 km/h ≈ 4.5 s, ~1 g brakes, 0.9 g lean-limited cornering, climbs 35°
    maxSpeed: 33, reverseSpeed: 3, accel: 8.5, power: 155, brake: 9.5, coast: 1.1, maxSlope: 35, step: 0.3, susp: 0.3, bounce: 0.15,
    wheelbase: 1.45, maxSteer: 0.6, grip: 8.8, lean: true,
    weapons: [],
    armor: { bullet: 0.8, grenade: 1, explosive: 1.3 },
    seatPos: [[0, 1.35, 0.1], [0, 1.45, 0.62]], exposed: { 0: 'crouch', 1: 'crouch' },
  },
};

export const isGround = (type) => VEHICLES[type].kind !== 'heli';

// which vehicles each team gets at its base on a map (bigger maps get helicopters)
export function vehicleLoadout(map) {
  if (map.def.mode === 'royale') return [];
  if (map.PLAY_HALF >= 180) return ['tank', 'heli', 'jeep', 'bike', 'bike'];
  if (map.PLAY_HALF >= 150) return ['tank', 'jeep', 'bike', 'bike'];
  return ['jeep', 'bike'];
}

const STEP = 1 / 120, G = 9.81;
// a hard landing: the suspension soaks up ~8 m/s, beyond that it counts like hitting a wall (groundCrashDamage)
export const LAND_SOFT = 8, CRASH_MIN = 11;
// vertical acceleration the suspension can take before it bottoms out (driving into a steep bank at speed hurts)
const SUSP_ACC = 30;

// push the hull circles out of the world's boxes; the vehicle translates by the summed push
// -> { x, z, solid } or null (solid: a real obstacle, not just the edge of the play area)
const _c = { x: 0, z: 0 };
function collideHull(world, s, hull, fx, fz, feetY, height) {
  let px = 0, pz = 0, solid = false;
  for (let it = 0; it < 2; it++) {
    let moved = false;
    for (const [o, r] of hull) {
      const cx = s.x + fx * o, cz = s.z + fz * o;
      _c.x = cx; _c.z = cz;
      if (world.resolveHorizontal(_c, feetY, height, r)) solid = true;
      const dx = _c.x - cx, dz = _c.z - cz;
      if (dx * dx + dz * dz > 1e-12) { s.x += dx; s.z += dz; px += dx; pz += dz; moved = true; }
    }
    if (!moved) break;
  }
  return px || pz ? { x: px, z: pz, solid } : null;
}

// ground under a ground vehicle: hull height (highest of the centre and the mean of the four edge samples) and the
// slope along the heading. Ledges are only climbed up to the vehicle's step height.
function groundUnder(world, s, V, fx, fz, out) {
  const [hw, , hl] = V.half, feet = s.y + V.step - STEP_UP, L = hl * 0.8, rx = -fz, rz = fx;
  const g = (x, z) => world.supportHeight(x, z, feet, 0.3);
  out.f = g(s.x + fx * L, s.z + fz * L); out.b = g(s.x - fx * L, s.z - fz * L);
  out.l = g(s.x - rx * hw, s.z - rz * hw); out.r = g(s.x + rx * hw, s.z + rz * hw);
  out.y = Math.max((out.f + out.b + out.l + out.r) / 4, g(s.x, s.z));
  out.slope = clamp((out.f - out.b) / (2 * L), -4, 4);
  return out;
}

// ---------------------------------------------------------------- ground vehicles
// tank: tracks (pivot turns, skid-steer scrub), turret + gun follow the aim; wheeled: bicycle-model steering limited
// by tyre grip (friction circle: cornering eats into traction / braking, understeer scrubs speed), the bike leans.
// Longitudinal: gravity along the slope, power-limited engine, brakes, rolling resistance (coasting off the
// throttle), hill hold when stopped; too steep -> the tyres / tracks slip and it slides back.
// Vertical: integrated with gravity — it snaps onto ground that rises under it, flies off crests / ledges / cliffs
// and lands (impact -> crash damage on the server).
// s: { x, y, z, yaw, pitch, roll, speed, vy, turretYaw (world), gunPitch, steer } (+ out: vx, vz, air, impact)
// input: { throttle -1..1, steer -1..1 (+ = left), aimYaw (world), aimPitch }
export const stepTank = (world, s, input, dt) => stepGround(world, s, input, dt, 'tank');

export function stepGround(world, s, input, dt, type = 'tank') {
  const V = VEHICLES[type], wheeled = V.kind === 'wheeled';
  world.ignoreOwner = s.id;
  const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), h = dt / n;
  const bodyH = V.half[1] * 1.6, mu = Math.tan(V.maxSlope * Math.PI / 180), [hw, , hl] = V.half;
  const th = clamp(input.throttle || 0, -1, 1), steerIn = clamp(input.steer || 0, -1, 1);
  const k = 1 - Math.exp(-12 * h), gnd = groundUnder(world, s, V, -Math.sin(s.yaw), -Math.cos(s.yaw), {});
  let impact = 0, land = 0, yawRate = 0;
  s.speed = s.speed || 0; s.steer = s.steer || 0; s.comp = s.comp || 0;
  if (!Number.isFinite(s.vy)) s.vy = s.y - gnd.y <= V.susp ? s.speed * gnd.slope : 0; // (state without vy: on the ground)
  for (let i = 0; i < n; i++) {
    // wheels / tracks on the ground (the suspension keeps them there while the hull is within its droop)
    const contact = s.y - gnd.y <= V.susp;
    if (wheeled) s.steer += (steerIn - s.steer) * (1 - Math.exp(-9 * h)); // ~0.15 s lock to lock
    yawRate = 0;
    if (contact) {
      const sl = gnd.slope, cosT = 1 / Math.hypot(1, sl), sinT = sl * cosT, sp = Math.abs(s.speed);
      let share = 1, scrub = 0;
      if (wheeled) {
        // yaw rate = v / wheelbase * tan(steer), capped by lateral grip (a = yawRate * v <= grip)
        const yawReq = (s.speed / V.wheelbase) * Math.tan(s.steer * V.maxSteer * (1 - Math.min(0.5, sp / V.maxSpeed * 0.5)));
        const lim = sp > 0.5 ? V.grip / sp : Infinity;
        yawRate = clamp(yawReq, -lim, lim);
        const aLat = Math.abs(yawRate * s.speed), over = Math.abs(yawReq * s.speed) / V.grip - 1;
        share = Math.sqrt(Math.max(0.04, 1 - (aLat / V.grip) ** 2));
        if (sp > 1) scrub = 0.1 * aLat + 0.25 * V.grip * clamp(over / 3, 0, 1);
      } else {
        // tracks: pivot turns when slow, wider arcs at speed
        yawRate = steerIn * V.turnRate * (1 - Math.min(0.45, sp / V.maxSpeed * 0.45)) * (s.speed < -0.2 ? -1 : 1);
        share = 1 - 0.4 * Math.abs(steerIn);
        if (sp > 0.3) scrub = V.turnScrub * Math.abs(steerIn);
      }
      s.yaw += yawRate * h;
      // gravity along the slope; steeper than the slope limit the tyres / tracks spin or skid (kinetic friction,
      // fading from μ at the limit to μ/2 a few degrees past it): it can't climb under power and can't be held, it
      // slides back down
      const steep = Math.abs(sinT) > mu * cosT;
      const cap = steep ? Math.max(0.5, 1 - 2 * (Math.abs(sl) - mu)) * mu * G * cosT : Infinity;
      // traction: the launch is limited by accel on the flat, the climb by the slope limit
      const trac = Math.min(cap, Math.max(mu, V.accel / G) * G * cosT * share);
      let v = s.speed - G * sinT * h, coast = scrub, b = 0;
      if (th > 0.01 && v > -0.3) {
        const want = th * V.maxSpeed;
        if (v < want) v = Math.min(want, v + Math.min(V.accel, V.power / Math.max(1, v), trac) * h); else coast += V.coast;
      } else if (th < -0.01 && v < 0.3) {
        const want = th * V.reverseSpeed;
        if (v > want) v = Math.max(want, v - Math.min(V.accel, trac) * h); else coast += V.coast;
      } else if (th > 0.01 || th < -0.01) b = Math.min(cap, V.brake * cosT * share); // brake pedal against the motion
      else if (steep) b = cap; // off the throttle on a slope too steep to hold: the brakes lock, it skids
      else coast += V.coast;   // rolling resistance + engine braking
      const c = (coast + b) * h;
      v = v > 0 ? Math.max(0, v - c) : Math.min(0, v + c);
      // stopped off the throttle on a slope it can hold: hill hold / handbrake
      if (!steep && th <= 0.01 && th >= -0.01 && Math.abs(v) < 0.3) v = 0;
      s.speed = v;
    }
    let fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    s.x += fx * s.speed * h; s.z += fz * s.speed * h;
    // walls / props / other vehicles taller than the step: bounce off head-on, scrape along at a glancing angle
    const push = collideHull(world, s, V.hull, fx, fz, s.y + V.step - STEP_UP, bodyH - V.step + STEP_UP);
    if (push) {
      const pl = Math.hypot(push.x, push.z), nx = push.x / pl, nz = push.z / pl;
      let ux = fx * s.speed, uz = fz * s.speed;
      const vn = ux * nx + uz * nz;
      if (vn < 0) {
        if (push.solid) impact = Math.max(impact, -vn);
        ux -= (1 + V.bounce) * vn * nx; uz -= (1 + V.bounce) * vn * nz;
        // friction along the obstacle
        const tn = ux * nx + uz * nz, tx = ux - tn * nx, tz = uz - tn * nz, tl = Math.hypot(tx, tz);
        if (tl > 1e-6) { const f = Math.max(0, 1 - (0.3 * (1 + V.bounce) * -vn) / tl); ux = tn * nx + tx * f; uz = tn * nz + tz * f; }
        // a glancing hit swings the nose along the obstacle
        if (s.speed > 0 && ux * fx + uz * fz > 0.5) {
          s.yaw += angleDiff(s.yaw, Math.atan2(-ux, -uz)) * 0.5;
          fx = -Math.sin(s.yaw); fz = -Math.cos(s.yaw);
        }
        s.speed = ux * fx + uz * fz;
      }
    }
    if (V.turretRate) {
      // turret + gun follow the aim at their drive rates
      const ty = input.aimYaw ?? s.turretYaw;
      s.turretYaw += clamp(angleDiff(s.turretYaw, ty), -V.turretRate * h, V.turretRate * h);
      s.gunPitch = clamp(s.gunPitch + clamp((input.aimPitch ?? s.gunPitch) - s.gunPitch, -0.4 * h, 0.4 * h), V.gunPitch[0], V.gunPitch[1]);
    }
    // vertical: ballistic, unless the ground (rising under the hull, or a ledge within the step height) holds it up
    const y0 = gnd.y;
    groundUnder(world, s, V, fx, fz, gnd);
    const vyB = s.vy - G * h, yB = s.y + vyB * h;
    if (yB <= gnd.y) {
      // the ground's vertical speed under the moving hull: the smaller of the hull's actual rise and speed × slope
      // (a ledge doesn't launch it; a cliff edge under the front doesn't yank it down)
      const rA = (gnd.y - y0) / h, rS = s.speed * gnd.slope;
      const vyG = rA * rS <= 0 ? 0 : Math.abs(rA) < Math.abs(rS) ? rA : rS;
      // landing / bottoming out: the vertical speed change beyond what the suspension takes, normal to the ground
      const e = Math.max(0, vyG - vyB - SUSP_ACC * h) / Math.hypot(1, gnd.slope);
      s.comp = e > 0 ? s.comp + e : 0;
      if (s.comp > land) land = s.comp;
      if (e > 0 && s.comp > 3) s.speed *= 1 - Math.min(0.4, e * 0.02); // bottoming out scrubs speed
      s.y = gnd.y; s.vy = vyG;
    } else {
      // leaving the ground (crest, ramp, ledge): take-off no steeper than ~35° whatever the terrain under the wheels
      s.y = yB; s.vy = contact ? Math.min(vyB, 0.7 * Math.abs(s.speed) + 0.5) : vyB; s.comp = 0;
    }
    // hull attitude: follow the ground (front/back, left/right samples); in the air the nose drops with the flight path
    s.air = s.y - gnd.y > V.susp;
    if (!s.air) {
      s.pitch += (Math.atan2(gnd.f - gnd.b, hl * 1.6) - s.pitch) * k;
      // a motorbike banks into the turn (tan(lean) = lateral acceleration / g); cars and tanks follow the ground
      const lean = V.lean ? -Math.atan(clamp(yawRate * s.speed, -V.grip, V.grip) / G) : Math.atan2(gnd.l - gnd.r, hw * 2);
      s.roll += (lean - s.roll) * k;
    } else {
      const kk = 1 - Math.exp(-2 * h);
      s.pitch += (clamp(Math.atan2(s.vy, Math.max(4, Math.abs(s.speed))), -0.6, 0.4) - s.pitch) * kk;
      s.roll -= s.roll * kk;
    }
  }
  // crash severity this step (m/s): wall impact (normal speed), or a landing beyond what the suspension absorbs
  s.impact = Math.max(impact, land > LAND_SOFT ? land - LAND_SOFT + CRASH_MIN : 0);
  s.land = land;
  s.vx = -Math.sin(s.yaw) * s.speed; s.vz = -Math.cos(s.yaw) * s.speed;
  world.ignoreOwner = null;
  return s;
}

// collision damage for ground vehicles hitting walls / landing hard (m/s of crash severity, see stepGround)
export const groundCrashDamage = (impact) => (impact < CRASH_MIN ? 0 : (impact - CRASH_MIN) * 22);

// ---------------------------------------------------------------- helicopter
// pilot assist (the client's flight controls, shared so tests fly the same way): level thrust compensates the tilt;
// with neither SPACE nor SHIFT it holds the altitude; SHIFT descends at a sink rate that shrinks near the ground
// (1.5 m/s + 0.4/s per metre of height, at most 8 m/s), so holding it to touchdown lands gently.
// k: { up, down, pitch -1..1, roll -1..1, yawRate -1..1 }, agl: height above the ground / roof below (m)
export const HELI_SINK = { base: 1.5, perM: 0.4, max: 8 };
export function heliAssist(s, k, agl) {
  const tilt = Math.max(0.5, Math.cos(s.pitch) * Math.cos(s.roll)), level = (1 / tilt - 1) / 0.75;
  let collective;
  if (k.up) collective = level + 0.9;
  else {
    const want = k.down ? -Math.min(HELI_SINK.max, HELI_SINK.base + HELI_SINK.perM * Math.max(0, agl)) : 0;
    // feed-forward for the vertical damping at the wanted sink rate + feedback on the error
    collective = level + (want * 0.6) / (0.75 * G) + clamp((want - (s.vy || 0)) * 0.5, -0.9, 0.9);
  }
  return { collective, pitch: k.pitch || 0, roll: k.roll || 0, yawRate: k.yawRate || 0 };
}

// s: { x, y, z, vx, vy, vz, yaw, pitch, roll, landed }
// input: { collective -1..1, yawRate -1..1, pitch -1..1 (nose down +), roll -1..1 (bank right +), power 0..1 }
// Resting pose on the ground under the vehicle: height and the pitch / roll that put the chassis on its wheels /
// tracks (ground vehicles: front / back / left / right of the hull), or the helicopter on its two main wheels and
// tail wheel — instead of sitting level with one end in the air and the other dug into a slope.
// Sign conventions as the physics: ground pitch + = nose up, helicopter pitch + = nose down; roll + = left side up.
const HELI_GEAR = { main: -2.0, tail: 5.2, track: 1.2 };
export function groundPose(world, x, z, yaw, type, feet = 500) {
  const V = VEHICLES[type], fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
  const g = (dx, dz) => world.supportHeight(x + rx * dx + fx * dz, z + rz * dx + fz * dz, feet, 0.3);
  if (V.kind === 'heli') {
    const { main, tail, track } = HELI_GEAR;
    const ml = g(-track, -main), mr = g(track, -main), tw = g(0, -tail), m = (ml + mr) / 2;
    // the airframe origin sits between the main wheels and the tail wheel on the line through their contacts
    const y = m + (tw - m) * (-main / (tail - main));
    return { y: Math.max(y, g(0, 0) - 0.05), pitch: clamp(Math.atan2(tw - m, tail - main), -0.3, 0.3), roll: clamp(Math.atan2(ml - mr, track * 2), -0.3, 0.3) };
  }
  const [hw, , hl] = V.half, L = hl * 0.8;
  const f = g(0, L), b = g(0, -L), l = g(-hw, 0), r = g(hw, 0);
  return { y: Math.max((f + b + l + r) / 4, g(0, 0)), pitch: Math.atan2(f - b, 2 * L), roll: Math.atan2(l - r, 2 * hw) };
}

export function stepHeli(world, s, input, dt) {
  const V = VEHICLES.heli;
  world.ignoreOwner = s.id;
  const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), h = dt / n;
  const power = input.power ?? 1;
  let impact = 0;
  for (let i = 0; i < n; i++) {
    const ground = world.supportHeight(s.x, s.z, s.y + 0.5, 1.5);
    const agl = s.y - ground;
    const col = clamp(input.collective || 0, -1, 1);
    // attitude: pilot input sets target pitch/roll (their combined tilt limited), rotor disc follows quickly
    let tp = clamp(input.pitch || 0, -1, 1) * V.pitchMax, tr = clamp(input.roll || 0, -1, 1) * V.rollMax;
    const tilt = Math.hypot(tp, tr);
    if (tilt > V.pitchMax) { tp *= V.pitchMax / tilt; tr *= V.pitchMax / tilt; }
    const onGround = agl < 0.15 && col <= 0.05;
    // sitting on the ground the airframe settles onto its wheels (follows a slope) instead of levelling out
    const rest = onGround ? groundPose(world, s.x, s.z, s.yaw, 'heli', s.y + 0.5) : null;
    s.pitch += ((rest ? rest.pitch : tp) - s.pitch) * (1 - Math.exp(-3.2 * h));
    s.roll += ((rest ? rest.roll : tr) - s.roll) * (1 - Math.exp(-3.2 * h));
    s.yaw += clamp(input.yawRate || 0, -1, 1) * V.yawRate * h * (onGround ? 0.3 : 1);
    // thrust along the rotor axis: hover + collective, tilted by pitch (forward) and roll (sideways)
    // power: 1 with a pilot at the controls; an abandoned helicopter's rotor loses lift and it drops
    const thrust = G * (1 + col * 0.75) * (onGround && col <= 0.05 ? 0 : 1) * power;
    const fwd = Math.sin(s.pitch) * thrust, side = Math.sin(s.roll) * thrust, up = Math.cos(s.pitch) * Math.cos(s.roll) * thrust;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    s.vx += (fx * fwd + rx * side) * h; s.vz += (fz * fwd + rz * side) * h;
    s.vy += (up - G) * h;
    // aerodynamic drag: quadratic horizontally (full tilt levels off near maxSpeed), steep beyond it (retreating
    // blade stall: diving / climbing at full tilt can't push much past it); vertical damping
    const hs = Math.hypot(s.vx, s.vz), r = hs / V.maxSpeed;
    const dragK = (onGround ? 3 : V.dragLin) + r * r * V.dragQuad + (r > 1 ? (r - 1) * 4 : 0);
    s.vx -= s.vx * dragK * h; s.vz -= s.vz * dragK * h;
    s.vy -= s.vy * 0.6 * h;
    s.vy = clamp(s.vy, -25, V.climb);
    // move + collide the fuselage (nose / cabin / tail boom circles): lose the velocity into the obstacle
    s.x += s.vx * h; s.z += s.vz * h;
    const push = collideHull(world, s, V.hull, fx, fz, s.y - 0.2, 2.8);
    if (push) {
      const pl = Math.hypot(push.x, push.z), nx = push.x / pl, nz = push.z / pl, vn = s.vx * nx + s.vz * nz;
      if (vn < 0) {
        if (push.solid) impact = Math.max(impact, -vn);
        s.vx -= 1.3 * vn * nx; s.vz -= 1.3 * vn * nz; s.vx *= 0.8; s.vz *= 0.8;
      }
    }
    // main rotor disc vs buildings / trees / props: a blade strike damages it and kicks it away from the obstacle
    if (power > 0.5 && agl > 0.3) {
      const yr = s.y + V.rotorH;
      _c.x = s.x; _c.z = s.z;
      const struck = world.resolveHorizontal(_c, yr - 0.3 - STEP_UP, 0.6 + STEP_UP, V.rotor);
      const dx = _c.x - s.x, dz = _c.z - s.z, dl = Math.hypot(dx, dz);
      if (struck && dl > 1e-6) {
        const nx = dx / dl, nz = dz / dl, vn = s.vx * nx + s.vz * nz;
        if (vn < 0.5) {
          impact = Math.max(impact, 6.4 + 0.8 * Math.max(0, -vn)); // a graze ~45 hp, 5 m/s ~480 hp
          const out = Math.max(1.5, -0.5 * vn) - vn;
          s.vx += out * nx; s.vz += out * nz;
        }
      }
    }
    s.y += s.vy * h;
    const g2 = world.supportHeight(s.x, s.z, s.y + 0.5, 1.5);
    const ceil = world.ceilingHeight(s.x, s.z, s.y + 0.5, 1.5);
    if (s.y + 2.9 > ceil && s.vy > 0) { impact = Math.max(impact, s.vy * 2); s.y = ceil - 2.9; s.vy = 0; }
    if (s.y <= g2) {
      // touchdown: sink rate + skidding in fast / banked (a gentle landing under ~3 m/s costs nothing)
      const hs2 = Math.hypot(s.vx, s.vz);
      impact = Math.max(impact, -s.vy + Math.max(0, hs2 - 4) * 0.5 + Math.abs(s.roll) * 20 * (hs2 > 3 ? 1 : 0));
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
  if (v.type === 'jeep') return { x: v.x + sy * 0.55, y: v.y + 2.25, z: v.z + cy * 0.55 };
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
  const e = VEHICLES[v.type].seatPos[seat] || VEHICLES[v.type].seatPos[0];
  const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
  // local frame: x right, z backward (-z = forward)
  return { x: v.x + cy * e[0] + sy * e[2], y: v.y + e[1], z: v.z - sy * e[0] + cy * e[2] };
}

// seats where the soldier sits in the open (bike, the jeep's roof gunner): visible and can be shot; value = pose
export const exposedPose = (type, seat) => VEHICLES[type].exposed?.[seat] || null;

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
