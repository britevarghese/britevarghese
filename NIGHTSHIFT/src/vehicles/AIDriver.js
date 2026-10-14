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

  // (Kerala's routes are the lanes themselves, keep-left: followed as they are. A road's centre line elsewhere:
  // driven on its right-hand side, an offset polyline)
  setRoute(points, loop = false, offset = this.laneOffset ?? (this.v?.physics?.world?.kerala ? 0 : 2.6)) {
    // drive on the right-hand side of the road (offset polyline), not on the center line
    if (offset && points.length > 1) {
      const out = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        out.push([points[i][0] - dz / l * offset, points[i][1] + dx / l * offset]);
      }
      points = out;
    }
    this.route = points; this.idx = 0; this.loop = loop; this.mode = 'route';
    // skip route points that are behind the car and close (avoids U-turns into curbs)
    const s = this.v.state;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    while (!loop && this.idx < points.length - 2) {
      const p = points[this.idx + 1];
      const dx = p[0] - s.x, dz = p[1] - s.z;
      if (dx * fx + dz * fz < 0 && Math.hypot(dx, dz) < 60) this.idx++; else break;
    }
  }

  // progress helper: index of nearest segment ahead
  _advanceIndex(x, z) {
    const r = this.route;
    while (this.idx < r.length - 1) {
      const a = r[this.idx], b = r[this.idx + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const t = ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1);
      // past the segment's end, or round a corner beside its point (within 5 m of it, or nearer the next segment
      // than this one): on to the next, so the car doesn't keep circling for a point it has already passed
      let next = t > 1;
      if (!next && this.idx < r.length - 2) {
        const c = r[this.idx + 2], ex = c[0] - b[0], ez = c[1] - b[1], u = clamp(((x - b[0]) * ex + (z - b[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const tt = clamp(t, 0, 1), dThis = Math.hypot(a[0] + dx * tt - x, a[1] + dz * tt - z), dNext = Math.hypot(b[0] + ex * u - x, b[1] + ez * u - z);
        next = Math.hypot(b[0] - x, b[1] - z) < 5 || (t > 0.5 && dNext < dThis - 0.5);
      }
      if (next) this.idx++; else break;
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

  // the turning of the route over the next `dist` metres from the car (signed, summed: a lane-change wiggle cancels
  // out) and the length it is spread over
  _bendAhead(x, z, dist) {
    const r = this.route;
    let i = this.idx, len = 0, sum = 0, px = x, pz = z;
    while (i < r.length - 2 && len < dist) {
      const a = r[i], b = r[i + 1], c = r[i + 2];
      len += Math.hypot(b[0] - px, b[1] - pz); px = b[0]; pz = b[1];
      if (len > dist) break;
      sum += wrapAngle(Math.atan2(c[0] - b[0], c[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1]));
      i++;
    }
    return { a: Math.abs(sum), len: Math.max(2, Math.min(len, dist)) };
  }

  // max heading change over the next `dist` meters (corner severity). A corner drawn with several close points
  // (a junction turn on lane points) is one corner: the turning within any 20 m is added up (signed: an S-bend
  // or a lane-change wiggle cancels out)
  _cornerAhead(dist) {
    const r = this.route, turns = [], s = this.v.state;
    let i = this.idx, travelled = 0;
    while (i < r.length - 2 && travelled < dist + 20) {
      const a = r[i], b = r[i + 1], c = r[i + 2];
      const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]), h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
      // (distances from the car, not from the start of the segment it's on)
      travelled += i === this.idx ? Math.hypot(b[0] - s.x, b[1] - s.z) : Math.hypot(b[0] - a[0], b[1] - a[1]);
      turns.push([travelled, wrapAngle(h2 - h1)]);
      i++;
      if (this.loop && i >= r.length - 2) break;
    }
    // and how fast it can be taken: its radius is the length the turning is spread over (8 m at least) divided
    // by the angle, the speed what the tyres hold round that radius. Of the corners ahead, the one that needs
    // the most braking from here
    let maxTurn = 0, turnDist = dist, vc = Infinity, need = -Infinity;
    for (let j = 0; j < turns.length; j++) {
      if (turns[j][0] > dist) break;
      let sum = 0, span = 0;
      for (let k = j; k < turns.length && turns[k][0] - turns[j][0] <= 20; k++) { sum += turns[k][1]; span = turns[k][0] - turns[j][0]; }
      const a = Math.min(Math.PI, Math.abs(sum));
      // (and a sharp corner at one point on its own: two sharp opposite corners close together - a jog through a
      // junction - cancelled out in the sum, and the car came at the first one at 55 km/h)
      const a1 = Math.min(Math.PI, Math.abs(turns[j][1]));
      if (a < 0.2 && a1 < 0.35) continue;
      // (a tight junction turn at walking pace: the steering lock is less at speed)
      const v = Math.min(a >= 0.2 ? Math.sqrt(5 * this.skill * Math.max(6, span) / a) : Infinity, a1 >= 0.35 ? Math.sqrt(5 * this.skill * 6 / a1) : Infinity) + 0.5;
      const n = -(2 * 5.5 * Math.max(0, turns[j][0] - 8) + v * v);
      if (Math.max(a, a1) > maxTurn) maxTurn = Math.max(a, a1);
      if (n > need) { need = n; vc = v; turnDist = turns[j][0]; }
    }
    return { turn: maxTurn, dist: turnDist, vc };
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
      // shorten the lookahead before sharp corners so the car doesn't cut through blocks
      let laDist = 7 + speed * 0.55;
      const r = this.route, ni = this.idx + 1;
      if (ni < r.length - 1) {
        const a = r[ni - 1], b = r[ni], c2 = r[ni + 1];
        const turn = Math.abs(wrapAngle(Math.atan2(c2[0] - b[0], c2[1] - b[1]) - Math.atan2(b[0] - a[0], b[1] - a[1])));
        const dCorner = Math.hypot(b[0] - s.x, b[1] - s.z);
        // (at the corner itself too: a point well past it is across the corner's pavement)
        if (turn > 0.6) laDist = Math.min(laDist, dCorner > 6 ? Math.max(6, dCorner + 2) : Math.max(4, dCorner + 3));
      }
      // and on a bend (a curve drawn with many close points, each turning a little): the line to the point it steers
      // for cuts inside the lane by about L^2 / 8R, kept to 0.3 m (it was a metre and a half on a lane's tight bend
      // at 45 km/h, into the trees and poles on the inside)
      const bend = this._bendAhead(s.x, s.z, laDist);
      if (bend.a > 0.1) laDist = Math.max(4.5, Math.min(laDist, Math.sqrt(8 * (bend.len / bend.a) * 0.3)));
      let la = this._lookahead(s.x, s.z, laDist);
      // and never for a point across the verge (a junction's corner, the inside of a kink in the lanes): shortened
      // until the line to it stays on the road
      const W = v.physics?.world;
      if (W?.kerala && W.onCarriageway(s.x, s.z)) {
        for (let k = 0; k < 4 && laDist > 3.5; k++) {
          if ([0.35, 0.7].every((f) => W.onCarriageway(s.x + (la[0] - s.x) * f, s.z + (la[1] - s.z) * f))) break;
          laDist *= 0.65; la = this._lookahead(s.x, s.z, laDist);
        }
      }
      tx = la[0]; tz = la[1];
      const corner = this._cornerAhead(Math.max(50, speed * 3.5));
      if (Number.isFinite(corner.vc)) {
        // allow braking distance to the corner
        const vmax = Math.sqrt(corner.vc * corner.vc + 2 * 5.5 * Math.max(0, corner.dist - 8));
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
      if (ahead < 14 + speed * 0.5 && Math.abs(lat) < 2.2 && this.mode !== 'pursue') targetSpeed = Math.min(targetSpeed, (o.v ?? 0) + 2 + ahead * 0.3);
    }
    this.avoid = avoid;

    const desired = Math.atan2(tx - s.x, tz - s.z);
    const diff = wrapAngle(desired - s.yaw);
    // still turning hard (a junction's corner passed but the car not yet round it): no faster than it can turn at,
    // not on the throttle at full lock into the wall on the outside
    if (this.mode !== 'pursue' && Math.abs(diff) > 0.35) targetSpeed = Math.min(targetSpeed, 4 + 10 * Math.max(0, 1 - Math.abs(diff) / 1.2));
    let steer = clamp(-diff * 2.2 + clamp(avoid, -1, 1) * 0.35, -1, 1);
    // and back onto the line itself when off it (steering only for a point ahead, a metre to one side was corrected
    // slowly: a car drifted that far toward a bridge's parapet and into its end)
    if (this.mode !== 'pursue' && this.idx < this.route.length - 1 && !avoid) {
      const a = this.route[this.idx], b = this.route[this.idx + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const eR = ((s.x - a[0]) * -dz + (s.z - a[1]) * dx) / L;   // (+: right of the line, (-dz, dx) being its right)
      steer = clamp(steer - clamp(eR, -2, 2) * 0.45 / (1 + speed / 15), -1, 1);
    }
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
    // progress watchdog: repeatedly stuck -> ask the owner to reset us onto a lane
    this.watchT = (this.watchT || 0) + dt;
    if (this.watchT > 5) {
      const moved = this.watchPos ? Math.hypot(s.x - this.watchPos[0], s.z - this.watchPos[1]) : 99;
      this.needsReset = moved < 4 && targetSpeed > 3;
      this.watchPos = [s.x, s.z]; this.watchT = 0;
    }
    const err = targetSpeed - speed;
    c.steer = steer;
    c.throttle = err > 0 ? clamp(err / 6, 0.25, 1) * this.powerScale : 0;
    c.brake = err < -1 ? clamp(-err / 4, 0.3, 1) : 0;   // (firmly: the speed plan counts on real braking)
    c.handbrake = Math.abs(diff) > 1.1 && speed > 12 && speed < 30 ? 1 : 0;
    c.nitro = this.useNitro && err > 15 && Math.abs(diff) < 0.12;
  }
}
