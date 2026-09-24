// Battle royale ("Firestorm"-style) rules shared by server and client: flight, freefall + parachute physics,
// loot definitions and the ring of fire schedule.
import { clamp } from './util.js';

export const ROYALE = {
  lobbyTime: 25,          // s of warm-up once a human is in the room
  minLobbyTime: 8,        // s left when the room fills up
  planeAlt: 230,          // m above the terrain's base level
  planeSpeed: 58,         // m/s
  fallSpeed: 46,          // terminal velocity belly-to-earth (m/s)
  diveSpeed: 64,          // head-down dive (look down)
  fallGlide: 20,          // horizontal tracking speed in freefall
  chuteAuto: 55,          // m above ground: canopy opens automatically
  chuteMin: 18,           // canopy can't be opened closer than this (you'd hit the ground)
  chuteSink: 5.2,         // canopy descent rate
  chuteGlide: 9.5,        // canopy forward speed
  endScreen: 15,          // s the result screen shows before the next match's lobby
  maxArmor: 100,
  maxMeds: 4,
  maxNades: 3,
  healTime: 3.2,          // s to use a med kit
  healAmount: 50,
  pickRange: 2.6,
};

// air state: 0 on foot, 1 freefall, 2 parachute
// input: { fx, fz (world-space wish direction), dive (0..1 = looking down), deploy (bool) }
export function stepAir(world, s, input, dt) {
  const R = ROYALE;
  const ground = world.supportHeight(s.x, s.z, s.y);
  const agl = s.y - ground;
  if (s.air === 1 && (input.deploy && agl > R.chuteMin || agl < R.chuteAuto)) { s.air = 2; s.chuteT = 0; }
  const glide = s.air === 1 ? R.fallGlide * (1 + (input.dive || 0) * 0.45) : R.chuteGlide;
  const wantVy = s.air === 1 ? -(R.fallSpeed + (R.diveSpeed - R.fallSpeed) * (input.dive || 0)) : -R.chuteSink;
  const k = 1 - Math.exp(-(s.air === 1 ? 1.1 : 2.2) * dt);
  s.vx += (input.fx * glide - s.vx) * k;
  s.vz += (input.fz * glide - s.vz) * k;
  s.vy += (wantVy - s.vy) * (1 - Math.exp(-(s.air === 1 ? 0.9 : 1.8) * dt));
  s.chuteT = (s.chuteT || 0) + dt;
  const pos = { x: s.x + s.vx * dt, z: s.z + s.vz * dt };
  if (agl < 4) world.resolveHorizontal(pos, s.y, 1.8);
  s.x = pos.x; s.z = pos.z;
  const ny = s.y + s.vy * dt;
  const sup = world.supportHeight(s.x, s.z, s.y);
  if (ny <= sup) {
    s.landed = s.air === 1 ? -s.vy : 0;
    s.y = sup; s.vy = 0; s.vx *= 0.3; s.vz *= 0.3; s.air = 0; s.onGround = true; s.stance = 'stand';
  } else { s.y = ny; s.onGround = false; }
  return s;
}

// ---------------------------------------------------------------- loot
export const LOOT = {
  ar: { kind: 'weapon', w: 'ar', name: 'AR-15 Carbine', model: 'ar' },
  sniper: { kind: 'weapon', w: 'sniper', name: 'M-38 Bolt Rifle', model: 'sniper' },
  pistol: { kind: 'weapon', w: 'pistol', name: 'P-17 Pistol', model: 'pistol' },
  ammo: { kind: 'ammo', name: 'Ammo box', model: 'ammo_box' },
  armor: { kind: 'armor', name: 'Armor plate kit', model: 'armor', amount: 50 },
  med: { kind: 'med', name: 'Med kit', model: 'medical_box' },
  nade: { kind: 'nade', name: 'Frag grenade', model: 'grenade' },
};
// weighted table for floor loot
export const LOOT_TABLE = [['ar', 14], ['sniper', 6], ['pistol', 6], ['ammo', 24], ['armor', 14], ['med', 16], ['nade', 10]];
export function rollLoot(rnd) {
  const total = LOOT_TABLE.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [k, w] of LOOT_TABLE) if ((r -= w) < 0) return k;
  return 'ammo';
}

// ---------------------------------------------------------------- ring of fire
// r: radius as a fraction of the starting radius; wait = s before shrinking; shrink = s the wall takes to close in;
// dmg = hp/s outside the ring.
export const RING_PHASES = [
  { wait: 75, shrink: 50, r: 0.52, dmg: 1.5 },
  { wait: 50, shrink: 40, r: 0.28, dmg: 3 },
  { wait: 40, shrink: 35, r: 0.14, dmg: 5 },
  { wait: 30, shrink: 30, r: 0.06, dmg: 8 },
  { wait: 25, shrink: 25, r: 0.015, dmg: 12 },
];

// current ring radius/centre from the networked ring state
// ring: { cx, cz, r, nx, nz, nr, t0, t1 } (t in ms server time; shrink happens between t0 and t1)
export function ringAt(ring, now) {
  if (!ring) return null;
  const k = clamp((now - ring.t0) / Math.max(1, ring.t1 - ring.t0), 0, 1);
  return { x: ring.cx + (ring.nx - ring.cx) * k, z: ring.cz + (ring.nz - ring.cz) * k, r: ring.r + (ring.nr - ring.r) * k, k };
}

// straight flight line crossing the map (never through the very edge)
export function planeLine(half, rnd) {
  const a = rnd() * Math.PI * 2, off = (rnd() - 0.5) * half * 0.7;
  const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
  const len = half * 1.25;
  return { ax: px * off - dx * len, az: pz * off - dz * len, bx: px * off + dx * len, bz: pz * off + dz * len, dx, dz };
}
