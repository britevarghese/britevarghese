// AIDriver: steering/throttle controller for police and racers. Pure-pursuit along a waypoint
// route with curvature-based speed planning, direct pursuit of a target when close, obstacle
// avoidance against traffic and unsticking (reverse & retry). Produces Vehicle.controls.
import { clamp, wrapAngle } from '../core/util.js';

export class AIDriver {
  constructor(vehicle, opts = {}) {
    this.v = vehicle;
    this.route = [];        // [[x,z], ...]
    this.idx = 0;           // current segment index
    this.skill = opts.skill ?? 0.85;       // cornering aggressiveness (0.6 .. 1.1)
    this.maxSpeed = opts.maxSpeed ?? 80;
    this.stuckT = 0; this.reverseT = 0;
    this.target = null;     // {x, z, vx, vz} for direct pursuit
    this.mode = 'route';    // route | pursue | park
    this.powerScale = 1;
    this.avoid = 0;
    this.loop = false;
  }

  setRoute(points, loop = false) { this.route = points; this.idx = 0; this.loop = loop; this.mode = 'route'; }

  // progress helper: index of nearest segment ahead
  _advanceIndex(x, z) {
    const r = this.route;
    while (this.idx < r.length - 1) {
      const a = r[this.idx], b = r[this.idx + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1);
      if (t > 1) this.idx++; else break;
    }
    if (this.loop && this.idx >= r.length - 1) this.idx = 0;
  }

  _lookahead(x, z, dist) {
    const r = this.route;
    let i = this.idx;
    let px = x, pz = z;
    // project onto current segment
    if (i < r.length - 1) {
      const a = r[i], b = r[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1);
      px = a[0] + dx * t; pz = a[1] + dz * t;
    }
    let rem = dist;
    while (i < r.length - 1) {
      const b = r[i + 1];
      const d = Math.hypot(b[0] - px, b[1] - pz);
      if (d >= rem) return [px + (b[0] - px) / d * rem, pz + (b[1] - pz) / d * rem];
      rem -= d; px = b[0]; pz = b[1]; i++;
      if (this.loop && i >= r.length - 1) i = 0;
    }
    return r.length ? r[r.length - 1] : [x, z];
  }

  // max heading change over the next `dist` meters (corner severity)
  _cornerAhead(dist) {
    const r = this.route;
    let i = this.idx, travelled = 0, maxTurn = 0, turnDist = dist;
    while (i < r.length - 2 && travelled < dist) {
      const a = r[i], b = r[i + 1], c = r[i + 2];
      const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
      const turn = Math.abs(wrapAngle(h2 - h1));
      const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (turn > maxTurn) { maxTurn = turn; turnDist = travelled + segLen; }
      travelled += segLen;
      i++;
    }
    return { turn: maxTurn, dist: turnDist };
  }

  update(dt, obstacles = []) {
    const v = this.v, s = v.state, c = v.controls;
    const speed = Math.hypot(s.vx, s.vz);
    if (this.mode === 'park') { c.throttle = 0; c.brake = 1; c.steer = 0; c.handbrake = 1; c.nitro = false; return; }
    let tx, tz, targetSpeed = this.maxSpeed;
    if (this.mode === 'pursue' && this.target) {
      const t = this.target;
      const d = Math.hypot(t.x - s.x, t.z - s.z);
      const lead = clamp(d / 40, 0, 1.2);
      tx = t.x + (t.vx || 0) * lead; tz = t.z + (t.vz || 0) * lead;
      targetSpeed = d < 12 ? Math.max(Math.hypot(t.vx || 0, t.vz || 0) + 4, 8) : this.maxSpeed;
    } else if (this.route.length > 1) {
      this._advanceIndex(s.x, s.z);
      const la = this._lookahead(s.x, s.z, 7 + speed * 0.55);
      tx = la[0]; tz = la[1];
      const corner = this._cornerAhead(Math.max(40, speed * 3));
      if (corner.turn > 0.25) {
        const vc = (9 + 26 * (1 - corner.turn / Math.PI)) * this.skill + 4;
        // allow braking distance to the corner
        const vmax = Math.sqrt(vc * vc + 2 * 7.5 * Math.max(0, corner.dist - 10));
        targetSpeed = Math.min(targetSpeed, vmax);
      }
      if (!this.loop && this.idx >= this.route.length - 2) {
        const end = this.route[this.route.length - 1];
        if (Math.hypot(end[0] - s.x, end[1] - s.z) < 12) targetSpeed = 0;
      }
    } else { c.throttle = 0; c.brake = 0.5; c.steer = 0; return; }

    // obstacle avoidance (traffic cars / other vehicles ahead)
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    let avoid = 0;
    for (const o of obstacles) {
      const dx = o.x - s.x, dz = o.z - s.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 2 || ahead > 18 + speed * 0.8) continue;
      const lat = -dx * fz + dz * fx; // + = to the right? right = (-fz, fx)
      if (Math.abs(lat) > 2.8) continue;
      avoid += (lat > 0 ? -1 : 1) * (1 - ahead / (18 + speed * 0.8));
      if (ahead < 10 && speed > (o.v ?? 0) + 6 && this.mode !== 'pursue') targetSpeed = Math.min(targetSpeed, (o.v ?? 0) + 4);
    }
    this.avoid = avoid;

    const desired = Math.atan2(tx - s.x, tz - s.z);
    const diff = wrapAngle(desired - s.yaw);
    let steer = clamp(-diff * 2.2 + avoid * 0.8, -1, 1);
    // counter-steer when sliding
    if (s.slip > 0.25) steer = clamp(steer - Math.sign(s.yawRate) * 0.3, -1, 1);
    // stuck detection -> reverse
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = 0; c.brake = 1; c.steer = -steer; c.handbrake = 0; c.nitro = false;
      return;
    }
    if (speed < 1.2 && targetSpeed > 3) { this.stuckT += dt; if (this.stuckT > 1.6) { this.reverseT = 1.3; this.stuckT = 0; } } else this.stuckT = 0;
    if (Math.abs(diff) > 2.2 && speed < 6) { // target behind: three-point turn
      this.reverseT = 0.9;
    }
    const err = targetSpeed - speed;
    c.steer = steer;
    c.throttle = err > 0 ? clamp(err / 6, 0.25, 1) * this.powerScale : 0;
    c.brake = err < -2 ? clamp(-err / 10, 0.2, 1) : 0;
    c.handbrake = Math.abs(diff) > 1.1 && speed > 12 && speed < 30 ? 1 : 0;
    c.nitro = this.useNitro && err > 15 && Math.abs(diff) < 0.12;
  }
}
