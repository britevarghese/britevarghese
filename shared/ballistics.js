// Projectile ballistics shared by the server (authoritative hits) and the client (tracers, predicted impacts):
// every bullet leaves the muzzle at the weapon's velocity, slows down with air drag, drops under gravity and
// takes real time to arrive. Sights are zeroed: the barrel is tilted up so the bullet crosses the line of sight
// at the zeroing distance (like a real rifle), so it hits high before that distance and low after it.
export const GRAVITY = 9.81;
export const STEP = 1 / 30;       // path segment duration (= one server tick; drop within a segment is < 1 cm)
export const MAX_FLIGHT = 3;      // s

// Integrates the flight. Returns the path points [{ x, y, z, t, d (distance travelled) }] until the bullet hits the
// static world (buildings, props, terrain), exceeds its max range or times out, plus that world hit.
export function bulletPath(world, o, dir, def) {
  let x = o.x, y = o.y, z = o.z;
  let vx = dir.x * def.velocity, vy = dir.y * def.velocity, vz = dir.z * def.velocity;
  const pts = [{ x, y, z, t: 0, d: 0 }];
  let t = 0, d = 0, hit = null;
  const k = Math.exp(-(def.drag || 0) * STEP);
  while (t < MAX_FLIGHT && d < (def.maxRange || 800)) {
    // exact for linear drag + gravity over one step
    const c = def.drag ? (1 - k) / def.drag : STEP;
    const nx = x + vx * c, nz = z + vz * c;
    const ny = y + vy * c - (def.drag ? (GRAVITY / def.drag) * (STEP - c) : 0.5 * GRAVITY * STEP * STEP);
    vx *= k; vz *= k; vy = vy * k - (def.drag ? (GRAVITY / def.drag) * (1 - k) : GRAVITY * STEP);
    const sx = nx - x, sy = ny - y, sz = nz - z, len = Math.hypot(sx, sy, sz);
    const h = world.raycast({ x, y, z }, { x: sx / len, y: sy / len, z: sz / len }, len, true);
    if (h) {
      const f = h.t / len;
      t += STEP * f; d += h.t;
      pts.push({ x: h.point[0], y: h.point[1], z: h.point[2], t, d });
      hit = h; break;
    }
    t += STEP; d += len; x = nx; y = ny; z = nz;
    pts.push({ x, y, z, t, d });
  }
  return { pts, hit, end: pts[pts.length - 1] };
}

// Upward tilt (radians) that makes the bullet cross the line of sight at `zero` metres.
const zeroCache = new Map();
export function zeroAngle(def, zero) {
  const key = `${def.id}:${zero}`;
  if (zeroCache.has(key)) return zeroCache.get(key);
  // flight time to the zero distance with drag, then the drop accumulated by then
  const v = def.velocity, kd = def.drag || 0;
  const tz = kd ? -Math.log(Math.max(1e-6, 1 - (zero * kd) / v)) / kd : zero / v;
  const drop = kd ? (GRAVITY / kd) * (tz - (1 - Math.exp(-kd * tz)) / kd) : 0.5 * GRAVITY * tz * tz;
  const a = Math.atan2(drop, zero);
  zeroCache.set(key, a);
  return a;
}
