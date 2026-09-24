// Collision world shared by server (authoritative movement for bots, hit detection) and client (prediction).
import { PROP_TYPES, getMap } from './map.js';

export const STEP_UP = 0.5;
export const PLAYER_RADIUS = 0.34;
export const STANCE_HEIGHT = { stand: 1.8, crouch: 1.2, prone: 0.55 };
export const EYE_HEIGHT = { stand: 1.64, crouch: 1.08, prone: 0.38 };
// Real-world numbers: g = 9.81 m/s², a loaded soldier's standing jump ≈ 3.3 m/s take-off (≈ 0.55 m of lift,
// ≈ 0.67 s in the air). Momentum is kept in the air (only light air control); repeated jumps tire you out;
// hard landings slow you down; falls higher than SAFE_FALL hurt (FALL_DMG hp per extra metre).
export const MOVE = { walk: 3.6, sprint: 6.3, crouch: 2.0, prone: 0.85, ads: 2.2, accel: 40, airAccel: 2.5, jump: 3.3, gravity: 9.81 };
export const SAFE_FALL = 3.2, FALL_DMG = 16;
export const fallDamage = (impactSpeed) => { const h = (impactSpeed * impactSpeed) / (2 * MOVE.gravity); return h > SAFE_FALL ? (h - SAFE_FALL) * FALL_DMG : 0; };
const MAX_STEP = 1 / 120;

const CELL = 12;

export class CollisionWorld {
  constructor(map = getMap('outskirts')) {
    this.map = map;
    this.boxes = [];
    this.ramps = [];
    this.buildings = [];
    this.grid = new Map();
    // moving solids (vehicles): { min, max, surface, bullets: false, owner } — refreshed every frame / tick
    this.dynamic = [];
    this.ignoreOwner = null; // a vehicle doesn't collide with itself while it moves
    this.#build();
  }

  addBox(min, max, surface = 'concrete', bullets = true, tag = '') {
    const b = { min, max, surface, bullets, tag, id: this.boxes.length };
    this.boxes.push(b);
    const cx0 = Math.floor(min[0] / CELL), cx1 = Math.floor(max[0] / CELL);
    const cz0 = Math.floor(min[2] / CELL), cz1 = Math.floor(max[2] / CELL);
    for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) {
      const k = i * 100003 + j;
      let arr = this.grid.get(k); if (!arr) this.grid.set(k, (arr = [])); arr.push(b);
    }
    return b;
  }

  #build() {
    const { BUILDINGS, PROPS, generateBuilding, generateVegetation, groundHeight } = this.map;
    const surfaceOf = { concrete: 'concrete', plaster: 'concrete', brick: 'concrete', metal_siding: 'metal', concrete_slab: 'concrete', concrete_floor: 'concrete', roof: 'concrete', metal_roof: 'metal', metal: 'metal', plaster_int: 'concrete' };
    for (const spec of BUILDINGS) {
      const g = generateBuilding(spec);
      this.buildings.push(g);
      for (const p of g.parts) if (p.collide) this.addBox(p.min, p.max, surfaceOf[p.mat] || 'concrete', true, g.id);
      for (const r of g.ramps) this.ramps.push(r);
    }
    for (const p of PROPS) {
      const t = PROP_TYPES[p.type];
      const y = groundHeight(p.x, p.z) + (p.y || 0);
      const rot90 = Math.round(p.rot) % 2 === 1;
      if (p.type === 'sandbags' || p.type === 'wall' || p.type === 'fence') {
        const len = p.len, h = p.type === 'sandbags' ? 1.05 : p.type === 'wall' ? 2.6 : 2.5, th = p.type === 'sandbags' ? 0.45 : p.type === 'wall' ? 0.25 : 0.06;
        const hx = rot90 ? th : len / 2, hz = rot90 ? len / 2 : th;
        // walls/fences follow the ground: approximate with segments
        const segs = Math.max(1, Math.round(len / 6));
        for (let s = 0; s < segs; s++) {
          const f0 = -1 + (2 * s) / segs, f1 = -1 + (2 * (s + 1)) / segs;
          const cx = p.x + (rot90 ? 0 : ((f0 + f1) / 2) * hx), cz = p.z + (rot90 ? ((f0 + f1) / 2) * hz : 0);
          const gy = groundHeight(cx, cz);
          const sx = rot90 ? hx : hx / segs, sz = rot90 ? hz / segs : hz;
          this.addBox([cx - sx, gy - 0.3, cz - sz], [cx + sx, gy + h, cz + sz], t.surface, t.bullets !== false, 'prop');
        }
        continue;
      }
      if (!t.half) continue;
      const [a, b2, c] = t.half;
      const hx = rot90 ? c : a, hz = rot90 ? a : c;
      this.addBox([p.x - hx, y, p.z - hz], [p.x + hx, y + b2 * 2, p.z + hz], t.surface, t.bullets !== false, 'prop');
    }
    // quay edge on harbour maps: a low concrete wall keeps soldiers out of the water (and is usable cover)
    const sea = this.map.sea;
    if (sea) {
      const H = this.map.MAP_HALF, e = sea.at, y = groundHeight(sea.axis === 'x' ? e - sea.dir * 1 : 0, sea.axis === 'z' ? e - sea.dir * 1 : 0);
      const lo = Math.min(e, e + sea.dir * 0.6), hi = Math.max(e, e + sea.dir * 0.6);
      if (sea.axis === 'z') this.addBox([-H, y - 8, lo], [H, y + 1.1, hi], 'concrete', true, 'quay');
      else this.addBox([lo, y - 8, -H], [hi, y + 1.1, H], 'concrete', true, 'quay');
    }
    this.vegetation = generateVegetation();
    for (const t of this.vegetation.trees) {
      const r = 0.16 * t.s, y = groundHeight(t.x, t.z);
      this.addBox([t.x - r, y - 0.2, t.z - r], [t.x + r, y + 3.2 * t.s, t.z + r], 'wood', true, 'tree');
    }
    for (const r of this.vegetation.rocks) {
      const h = r.s * (r.kind === 'rock_07' ? 0.1 : 0.025), w = r.s * (r.kind === 'rock_07' ? 0.1 : 0.05);
      if (h > 0.35) { const y = groundHeight(r.x, r.z); this.addBox([r.x - w, y - 0.2, r.z - w], [r.x + w, y + h, r.z + w], 'rock', true, 'rock'); }
    }
  }

  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const seen = new Set();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      const arr = this.grid.get(i * 100003 + j); if (!arr) continue;
      for (const b of arr) if (!seen.has(b.id)) { seen.add(b.id); out.push(b); }
    }
    for (const b of this.dynamic) {
      if (b.owner === this.ignoreOwner) continue;
      if (b.max[0] >= x0 && b.min[0] <= x1 && b.max[2] >= z0 && b.min[2] <= z1) out.push(b);
    }
    return out;
  }

  // Highest walkable surface under (x,z) that is not above feetY + STEP_UP.
  supportHeight(x, z, feetY, r = 0.2) {
    let h = this.map.groundHeight(x, z);
    for (const b of this.query(x - r, z - r, x + r, z + r, this._q || (this._q = []))) {
      if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && b.max[1] <= feetY + STEP_UP && b.max[1] > h) h = b.max[1];
    }
    for (const rp of this.ramps) {
      if (x > rp.x0 - 0.05 && x < rp.x1 + 0.05 && z > rp.z0 && z < rp.z1) {
        const t = (z - rp.z0) / (rp.z1 - rp.z0);
        const y = rp.y0 + (rp.y1 - rp.y0) * t;
        if (y <= feetY + STEP_UP && y > h) h = y;
      }
    }
    return h;
  }

  // Lowest ceiling above head (for jump / stand-up checks)
  ceilingHeight(x, z, fromY, r = PLAYER_RADIUS * 0.8) {
    let c = Infinity;
    for (const b of this.query(x - r, z - r, x + r, z + r, this._q2 || (this._q2 = []))) {
      if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && b.min[1] >= fromY && b.min[1] < c) c = b.min[1];
    }
    return c;
  }

  // Push a vertical cylinder out of boxes. Returns true if collided.
  resolveHorizontal(pos, feetY, height, r = PLAYER_RADIUS) {
    let hit = false;
    const list = this.query(pos.x - r - 0.5, pos.z - r - 0.5, pos.x + r + 0.5, pos.z + r + 0.5, this._q3 || (this._q3 = []));
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const b of list) {
        if (b.max[1] <= feetY + STEP_UP || b.min[1] >= feetY + height) continue;
        const cx = Math.max(b.min[0], Math.min(pos.x, b.max[0]));
        const cz = Math.max(b.min[2], Math.min(pos.z, b.max[2]));
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          pos.x += (dx / d) * push; pos.z += (dz / d) * push;
        } else {
          // centre inside the box: exit via the nearest face
          const ex = [pos.x - b.min[0], b.max[0] - pos.x, pos.z - b.min[2], b.max[2] - pos.z];
          const m = Math.min(...ex), k = ex.indexOf(m);
          if (k === 0) pos.x = b.min[0] - r; else if (k === 1) pos.x = b.max[0] + r; else if (k === 2) pos.z = b.min[2] - r; else pos.z = b.max[2] + r;
        }
        moved = hit = true;
      }
      if (!moved) break;
    }
    const lim = this.map.PLAY_HALF + 8;
    pos.x = Math.max(-lim, Math.min(lim, pos.x)); pos.z = Math.max(-lim, Math.min(lim, pos.z));
    return hit;
  }

  // Ray vs world. Returns { t, point, normal, surface, box } or null.
  raycast(o, d, maxDist, forBullets = true) {
    let best = maxDist, hit = null;
    // walk the grid cells along the ray (coarse: sample AABB of segment in chunks)
    const steps = Math.ceil(maxDist / CELL) + 1;
    const seen = new Set();
    for (let s = 0; s < steps; s++) {
      const t0 = s * CELL, t1 = Math.min(maxDist, (s + 1) * CELL);
      if (t0 > best) break;
      const ax = o.x + d.x * t0, az = o.z + d.z * t0, bx = o.x + d.x * t1, bz = o.z + d.z * t1;
      for (const b of this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._q4 || (this._q4 = []))) {
        if (seen.has(b.id)) continue; seen.add(b.id);
        if (forBullets && !b.bullets) continue;
        const r = rayBox(o, d, b.min, b.max);
        if (r && r.t < best && r.t >= 0) { best = r.t; hit = { t: r.t, normal: r.n, surface: b.surface, box: b }; }
      }
    }
    // terrain: march
    const tt = this.rayTerrain(o, d, best);
    if (tt !== null && tt < best) {
      best = tt;
      const px = o.x + d.x * tt, pz = o.z + d.z * tt;
      const e = 0.5, hx = this.map.groundHeight(px + e, pz) - this.map.groundHeight(px - e, pz), hz = this.map.groundHeight(px, pz + e) - this.map.groundHeight(px, pz - e);
      const nl = Math.hypot(hx, 2 * e, hz);
      hit = { t: tt, normal: [-hx / nl, (2 * e) / nl, -hz / nl], surface: 'dirt', box: null };
    }
    if (!hit) return null;
    hit.point = [o.x + d.x * hit.t, o.y + d.y * hit.t, o.z + d.z * hit.t];
    return hit;
  }

  rayTerrain(o, d, maxDist) {
    let prevT = 0, prevDiff = o.y - this.map.groundHeight(o.x, o.z);
    if (prevDiff < 0) return 0;
    const step = 0.6;
    for (let t = step; t <= maxDist + step; t += step) {
      const tc = Math.min(t, maxDist);
      const y = o.y + d.y * tc, g = this.map.groundHeight(o.x + d.x * tc, o.z + d.z * tc);
      const diff = y - g;
      if (diff < 0) return prevT + (tc - prevT) * (prevDiff / (prevDiff - diff));
      prevT = tc; prevDiff = diff;
      if (tc >= maxDist) break;
    }
    return null;
  }

  lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return true;
    return !this.raycast(a, { x: dx / L, y: dy / L, z: dz / L }, L - 0.05, true);
  }
}

export function rayBox(o, d, mn, mx) {
  let tmin = -Infinity, tmax = Infinity, n = null;
  const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(D[i]) < 1e-9) { if (O[i] < mn[i] || O[i] > mx[i]) return null; continue; }
    let t1 = (mn[i] - O[i]) / D[i], t2 = (mx[i] - O[i]) / D[i];
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[i] = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: tmin < 0 ? 0 : tmin, n: n || [0, 1, 0] };
}

// ------------------------------------------------------------------ character movement (shared by bots + client prediction)
// state: { x, y, z, vx, vy, vz, onGround, stance }
// input: { fx, fz (world-space wish dir, normalized or 0), sprint, jump, ads }
// Fixed 120 Hz sub-steps + exact constant-gravity integration: the same jump reaches the same height on a
// 30 fps phone, a 144 Hz monitor and the 30 Hz server.
export function stepCharacter(world, s, input, dt) {
  const n = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6)), h = dt / n;
  let landed = 0;
  for (let i = 0; i < n; i++) {
    stepOnce(world, s, input, h);
    if (s.landed) landed = Math.max(landed, s.landed);
    input = i === 0 && input.jump ? { ...input, jump: false } : input; // one jump per call
  }
  s.landed = landed;
  s.fall = landed ? fallDamage(landed) : 0;
  return s;
}

function stepOnce(world, s, input, dt) {
  s.fatigue = Math.max(0, (s.fatigue || 0) - dt * 0.35);
  s.groundT = s.onGround ? (s.groundT || 0) + dt : 0;
  s.landSlow = Math.max(0, (s.landSlow || 0) - dt);
  let speed = s.stance === 'prone' ? MOVE.prone : s.stance === 'crouch' ? MOVE.crouch : input.ads ? MOVE.ads : input.sprint ? MOVE.sprint : MOVE.walk;
  if (s.landSlow > 0) speed *= 0.5;
  const wx = input.fx * speed, wz = input.fz * speed;
  if (s.onGround) {
    const accel = MOVE.accel;
    const ax = wx - s.vx, az = wz - s.vz;
    const al = Math.hypot(ax, az), maxA = accel * dt;
    if (al > maxA) { s.vx += (ax / al) * maxA; s.vz += (az / al) * maxA; } else { s.vx = wx; s.vz = wz; }
  } else if (input.fx || input.fz) {
    // airborne: keep momentum, only nudge toward the wish direction (can't speed past the take-off speed)
    const before = Math.hypot(s.vx, s.vz);
    s.vx += input.fx * MOVE.airAccel * dt; s.vz += input.fz * MOVE.airAccel * dt;
    const after = Math.hypot(s.vx, s.vz), cap = Math.max(before, speed * 0.5);
    if (after > cap) { s.vx *= cap / after; s.vz *= cap / after; }
  }
  // jump: needs solid footing for a moment; chained jumps lose height (no bunny hopping)
  if (input.jump && s.onGround && s.stance === 'stand' && s.groundT > 0.1) {
    s.vy = MOVE.jump * (1 - 0.45 * Math.min(1, s.fatigue));
    s.fatigue = Math.min(1.5, s.fatigue + 0.6);
    s.onGround = false; s.groundT = 0;
  }
  const height = STANCE_HEIGHT[s.stance];
  const pos = { x: s.x + s.vx * dt, z: s.z + s.vz * dt };
  world.resolveHorizontal(pos, s.y, height);
  // blocked by a wall: lose the velocity into it
  if (Math.abs(pos.x - (s.x + s.vx * dt)) > 1e-4) s.vx = (pos.x - s.x) / dt;
  if (Math.abs(pos.z - (s.z + s.vz * dt)) > 1e-4) s.vz = (pos.z - s.z) / dt;
  s.x = pos.x; s.z = pos.z;
  const g = MOVE.gravity;
  let ny = s.y + s.vy * dt - 0.5 * g * dt * dt;
  let vy = s.vy - g * dt;
  const ceil = world.ceilingHeight(s.x, s.z, s.y + 0.5);
  if (ny + height > ceil && vy > 0) { ny = ceil - height; vy = 0; }
  const sup = world.supportHeight(s.x, s.z, Math.max(s.y, ny));
  const wasGround = s.onGround;
  s.landed = 0;
  if (ny <= sup || (wasGround && vy <= 0 && s.y - sup < 0.35)) {
    if (!wasGround) {
      s.landed = -vy;
      if (-vy > 6) s.landSlow = Math.min(0.6, -vy * 0.04);
    }
    ny = sup; vy = 0; s.onGround = true;
  } else s.onGround = false;
  s.y = ny; s.vy = vy;
}
