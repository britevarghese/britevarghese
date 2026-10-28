// Projectile ballistics shared by the server (authoritative hits) and the client (tracers, predicted impacts):
// every bullet leaves the muzzle at the weapon's velocity, slows down with air drag, drops under gravity and
// takes real time to arrive. Sights are zeroed: the barrel is tilted up so the bullet crosses the line of sight
// at the zeroing distance (like a real rifle), so it hits high before that distance and low after it.
export const GRAVITY = 9.81;
export const STEP = 1 / 30;       // path segment duration (= one server tick; drop within a segment is < 1 cm)
export const MAX_FLIGHT = 3;      // s

// Air drag on a bullet grows with the square of its speed: dv/dt = -k·|v|·v (k per metre, from the round's
// ballistic coefficient), so a rifle bullet sheds speed fast at first: 5.56 mm 910 -> ~550 m/s at 500 m (0.72 s),
// 7.62x54R 830 -> ~370 m/s at 1000 m (~1.85 s). Weapons without `dragQ` keep a simple linear drag (`drag`, 1/s).
const SUB = 4; // integration sub-steps per path segment (1/120 s)
function advance(def, s, G) {
  if (def.dragQ) {
    const h = STEP / SUB;
    for (let i = 0; i < SUB; i++) {
      const f = 1 / (1 + def.dragQ * Math.hypot(s.vx, s.vy, s.vz) * h);
      s.vx *= f; s.vy = s.vy * f - G * h; s.vz *= f;
      s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
    }
    return;
  }
  // exact for linear drag + gravity over one step
  const k = Math.exp(-(def.drag || 0) * STEP), c = def.drag ? (1 - k) / def.drag : STEP;
  s.x += s.vx * c; s.z += s.vz * c;
  s.y += s.vy * c - (def.drag ? (G / def.drag) * (STEP - c) : 0.5 * G * STEP * STEP);
  s.vx *= k; s.vz *= k; s.vy = s.vy * k - (def.drag ? (G / def.drag) * (1 - k) : G * STEP);
}

// Integrates the flight. Returns the path points [{ x, y, z, t, d (distance travelled) }] until the bullet hits the
// static world (buildings, props, terrain), exceeds its max range or times out, plus that world hit.
export function bulletPath(world, o, dir, def) {
  let x = o.x, y = o.y, z = o.z;
  const st = { x, y, z, vx: dir.x * def.velocity, vy: dir.y * def.velocity, vz: dir.z * def.velocity };
  const pts = [{ x, y, z, t: 0, d: 0 }];
  let t = 0, d = 0, hit = null;
  // (rockets: the motor carries most of the weight -> reduced effective gravity)
  const G = GRAVITY * (def.gravityScale ?? 1);
  while (t < MAX_FLIGHT && d < (def.maxRange || 800)) {
    advance(def, st, G);
    const nx = st.x, ny = st.y, nz = st.z;
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
const NO_WORLD = { raycast: () => null };
export function zeroAngle(def, zero) {
  const key = `${def.id}:${zero}`;
  if (zeroCache.has(key)) return zeroCache.get(key);
  if (def.dragQ) {
    // no closed form with quadratic drag: shoot (in empty space) and correct the tilt until it crosses at `zero`
    let a = 0;
    for (let it = 0; it < 4; it++) {
      const { pts } = bulletPath(NO_WORLD, { x: 0, y: 0, z: 0 }, { x: Math.cos(a), y: Math.sin(a), z: 0 }, { ...def, maxRange: zero * 1.5 + 50 });
      const j = pts.findIndex((p) => p.x >= zero);
      if (j < 1) break;
      const p0 = pts[j - 1], p1 = pts[j], y = p0.y + ((p1.y - p0.y) * (zero - p0.x)) / (p1.x - p0.x);
      a -= Math.atan2(y, zero);
    }
    zeroCache.set(key, a);
    return a;
  }
  // flight time to the zero distance with drag, then the drop accumulated by then
  const v = def.velocity, kd = def.drag || 0;
  const tz = kd ? -Math.log(Math.max(1e-6, 1 - (zero * kd) / v)) / kd : zero / v;
  const drop = kd ? (GRAVITY / kd) * (tz - (1 - Math.exp(-kd * tz)) / kd) : 0.5 * GRAVITY * tz * tz;
  const a = Math.atan2(drop, zero);
  zeroCache.set(key, a);
  return a;
}
