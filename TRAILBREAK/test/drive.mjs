// Driving a vehicle in the tests: a manoeuvre and what it measures.
import { PHYS_DT, GRAVITY } from '../src/physics/Vehicle.js';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

/** A full-lock bend on the keys at kmh (the speed held, in the gear a driver would be in): the path's lateral g and
 * the body's slip angle (rad) over the last 1.5 s, and the largest slip angle on the way. */
export function keysBend(v, ground, kmh, seconds = 4) {
  const sp = kmh / 3.6, d = v.dt, wOut = sp / v.spec.tyre.radius * d.axleGear;
  v.vel.set(0, 0, sp);
  for (const w of v.wheels) w.omega = sp / v.spec.tyre.radius;
  if (!d.electric) {
    let g = 1;
    while (g < d.t.gears.length && wOut * d.t.gears[g - 1] * 60 / (2 * Math.PI) > 0.7 * (d.e.redline || 6000)) g++;
    d.gear = g; d.wEngine = wOut * d.t.gears[g - 1];
  }
  let ay = 0, slip = 0, worst = 0, n = 0, px = v.vel.x, pz = v.vel.z;
  const N = Math.round(seconds / PHYS_DT);
  for (let k = 0; k < N; k++) {
    v.step({ ...IDLE, throttle: Math.max(0, Math.min(1, 0.25 + (sp - v.vel.dot(v.fwd)) * 0.5)), steer: 1 }, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
    const s = Math.hypot(v.vel.x, v.vel.z), b = Math.abs(Math.atan2(v.vel.dot(v.right), v.vel.dot(v.fwd)));
    // (the path's own lateral acceleration, not the yaw rate's: a truck crabbing sideways turns its nose more than its path)
    const lat = Math.abs((v.vel.x - px) * -v.vel.z + (v.vel.z - pz) * v.vel.x) / PHYS_DT / (s || 1);
    px = v.vel.x; pz = v.vel.z;
    if (s > 3) worst = Math.max(worst, b);
    if (k >= N - Math.round(1.5 / PHYS_DT)) { ay += lat; slip += b; n++; }
  }
  return { g: ay / n / GRAVITY, slip: slip / n, worst };
}
