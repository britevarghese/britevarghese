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

/**
 * Drive a path ([[x, z], ...], a point every few metres) as a careful driver would: steering for a point ahead, slowing
 * for the bends ahead of it. Stops at the path's end, after `seconds`, or stuck (20 s without moving): { t, reached,
 * stuck, km, regions: the order of the maps it drove through (ground.regionAt), if there are any }.
 */
export function followPath(v, ground, path, { vmax = 16, lat = 0.35, seconds = 900 } = {}) {
  let t = 0, idx = 0, slowT = 0, km = 0, px = v.pos.x, pz = v.pos.z;
  const regions = [], N = Math.round(seconds / PHYS_DT), BR = 0.55 * GRAVITY;
  for (let s = 0; s < N && idx < path.length - 3; s++) {
    // the nearest point a little way on, and one to steer for further on, the faster the further
    let bi = idx, bd = Infinity;
    for (let k = idx, arc = 0; k < path.length && arc < 14; k++) {
      const d = Math.hypot(path[k][0] - v.pos.x, path[k][1] - v.pos.z);
      if (d < bd) { bd = d; bi = k; }
      if (k + 1 < path.length) arc += Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
    }
    idx = bi;
    const sp = v.vel.dot(v.fwd), look = Math.max(5, Math.min(14, 4 + Math.abs(sp) * 0.9));
    let j = idx, acc = 0;
    while (j < path.length - 1 && acc < look) { acc += Math.hypot(path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]); j++; }
    let diff = Math.atan2(path[j][0] - v.pos.x, path[j][1] - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z);
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    // the bends within braking distance: each one's speed, less what braking from here to it can shed
    let tight = Infinity, cap = Infinity;
    for (let q = idx + 1, accR = 0, reach = Math.max(30, sp * sp / (2 * BR) + 20); q < path.length - 1 && accR < reach; q++) {
      const ax = path[q][0] - path[q - 1][0], az = path[q][1] - path[q - 1][1], bx = path[q + 1][0] - path[q][0], bz = path[q + 1][1] - path[q][1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      accR += la;
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb || 1))));
      if (ang > 1e-3) {
        const R = (la + lb) / 2 / ang;
        if (accR < 30) tight = Math.min(tight, R);
        cap = Math.min(cap, Math.sqrt(lat * GRAVITY * R + 2 * BR * Math.max(0, accR - 8)));
      }
    }
    const target = Math.min(vmax, Math.sqrt(lat * GRAVITY * tight) + 1, cap + 1) * (Math.abs(diff) > 0.5 ? 0.5 : 1);
    const brake = sp > target + 1 ? Math.min(1, (sp - target) * 0.4) : 0;
    v.step({ throttle: brake ? 0 : Math.max(0, Math.min(1, (target - sp) * 0.6 + 0.35)), brake, steer: -Math.max(-1, Math.min(1, diff * 2.2)), handbrake: 0 }, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
    t += PHYS_DT;
    km += Math.hypot(v.pos.x - px, v.pos.z - pz) / 1000; px = v.pos.x; pz = v.pos.z;
    const r = ground.regionAt?.(v.pos.x, v.pos.z)?.id;
    if (r && r !== regions.at(-1)) regions.push(r);
    slowT = Math.abs(sp) < 1 ? slowT + PHYS_DT : 0;
    if (slowT > 20) return { t, reached: false, stuck: true, km, regions, at: [v.pos.x, v.pos.z] };
  }
  return { t, reached: idx >= path.length - 3, stuck: false, km, regions, at: [v.pos.x, v.pos.z] };
}

/** A route's points (game/Route.js) with a point every `step` m. */
export function densify(pts, step = 2) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let j = 1; j <= n; j++) out.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n]);
  }
  return out;
}
