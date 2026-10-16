// AIDriver: steering/throttle controller for police and racers. Pure-pursuit along a waypoint
// route with curvature-based speed planning, direct pursuit of a target when close, obstacle
// avoidance against traffic and unsticking (reverse & retry). Produces Vehicle.controls.
import { clamp, wrapAngle } from '../core/util.js';

// the way a route runs over the `d` metres before point i (back) or after it: a lane's last metre or two can hook
// toward a junction's centre, and its last segment alone gave a corner the wrong lines
function runDir(P, i, back, d = 6) {
  const st = back ? -1 : 1;
  let j = i, len = 0;
  while (j + st >= 0 && j + st < P.length && len < d) { len += Math.hypot(P[j + st][0] - P[j][0], P[j + st][1] - P[j][1]); j += st; }
  const k = back ? 1 : -1, dx = (P[i][0] - P[j][0]) * k, dz = (P[i][1] - P[j][1]) * k, l = Math.hypot(dx, dz);
  return l > 0.01 ? [dx / l, dz / l] : null;
}

// a route's sharp corners rounded to arcs the car can steer round (radius R). Lanes meet at a junction a few metres
// apart at right angles - a turn of 3 or 4 m radius - and a car turning no tighter than 4.7 m at its lock ran wide
// off the road at a third of the junctions in a town. A corner split over two close points (one lane's end, the next
// one's start, across the junction; and a lane starting with a hook) is taken as the one corner where the lanes' lines
// meet. A bend drawn with many points is left alone: the steering follows those (made one corner, a bend of 15 m
// radius became a tight turn bulging off the road into a canal's parapet). An arc that cuts the corner of the kerb (a
// left turn's inside) swings out toward the road's middle until it stays on the road, as a driver swings out
export function roundCorners(points, R, onRoad = null, halfW = 0.9) {
  const P = points.map((q) => [q[0], q[1]]);
  const dir = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const turn = (u, w) => Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]);
  for (let i = 1; i < P.length - 2; i++) {
    // (a turn starting here; and the points after it within 8 m that, with it, turn tighter than the car could follow:
    // not a bend's points, nor a jog. Measured from this point's way in to the last one's way out: where the lanes
    // overlap, the next starting behind the last one's end, the hop between them turns back)
    const uIn = dir(P[i - 1], P[i]);
    if (Math.abs(turn(uIn, dir(P[i], P[i + 1]))) < 0.2) continue;
    const u = runDir(P, i, true);
    if (!u) continue;
    let J = -1, X = null;
    for (let j = i + 1, len = 0; j < P.length - 1; j++) {
      len += Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1]);
      if (len > 8) break;
      const tot = Math.abs(turn(uIn, dir(P[j], P[j + 1])));
      if (tot < 0.4 || len / tot > R * 0.5) continue;
      const w = runDir(P, j, false);
      if (!w) continue;
      const cr = u[0] * w[1] - u[1] * w[0];
      if (Math.abs(cr) < 0.35) continue;   // (near enough parallel: a jog, not a corner)
      // (where the lines meet: ahead of the one lane's end, behind the next one's start - or, where they overlap, along
      // it, short of its next point)
      const ex = P[j][0] - P[i][0], ez = P[j][1] - P[i][1];
      const s = (ex * w[1] - ez * w[0]) / cr, t = (ex * u[1] - ez * u[0]) / cr;   // (P[i] + u s = P[j] + w t)
      const segB = Math.hypot(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]);
      if (s < -0.5 || s > 8 || t < -8 || t > Math.min(8, segB - 1)) continue;
      J = j; X = [P[i][0] + u[0] * s, P[i][1] + u[1] * s];
    }
    if (J < 0) continue;
    P.splice(i, J - i + 1, X);
    i--;   // (and again from there: one corner made of more pieces than these)
  }
  // (the room before or after a corner: the run straight on through points that hardly turn, not just the next piece.
  // A route met a 100-degree junction turn by a 3.9 m hop in line with the lane before it, from one lane's end to the
  // next one's start: rounded within that hop, 2 m across, the car swung its nose a metre and a half off the road)
  const room = (i, back) => {
    let L = 0;
    for (let k = i; ;) {
      const k2 = back ? k - 1 : k + 1;
      L += Math.hypot(P[k2][0] - P[k][0], P[k2][1] - P[k][1]);
      if (k2 <= 0 || k2 >= P.length - 1 || Math.abs(turn(dir(P[k2 - 1], P[k2]), dir(P[k2], P[k2 + 1]))) >= 0.12) return L;
      k = k2;
    }
  };
  const out = [P[0]];
  let skip = 0;
  for (let i = 1; i < P.length - 1; i++) {
    if (i < skip) continue;   // (inside the last corner's arc)
    const u = dir(P[i - 1], P[i]), w = dir(P[i], P[i + 1]), a = Math.abs(turn(u, w));
    // (a gentle turn is a bend, which the steering follows; a hairpin is left as it is)
    if (a < 0.5 || a > 2.6) { out.push(P[i]); continue; }
    const near = (k) => Math.hypot(P[k][0] - P[i][0], P[k][1] - P[i][1]);
    const tn = Math.tan(a / 2);
    let bx = w[0] - u[0], bz = w[1] - u[1]; const bl = Math.hypot(bx, bz); bx /= bl; bz /= bl;   // (into the turn)
    // the arc for a given tangent length, and how well it keeps to the road
    // (on the road with the car's width either side of it - on the inside, and what the steering cuts off a curve and
    // the rear wheels' running inside the front's; on the outside the front corner's swing - or moved across, out or
    // in, until it is: a car turning into a side street at the arc's exit swept its front corner into the end of a
    // compound wall at the street's mouth)
    const fit = (T) => {
      const r = T / tn;
      if (r < 1.5) return null;
      const cx = P[i][0] + bx * r / Math.cos(a / 2), cz = P[i][1] + bz * r / Math.cos(a / 2);
      const f0 = Math.atan2(P[i][1] - u[1] * T - cz, P[i][0] - u[0] * T - cx), f1 = Math.atan2(P[i][1] + w[1] * T - cz, P[i][0] + w[0] * T - cx);
      const df = wrapAngle(f1 - f0), m = Math.max(2, Math.ceil(a * r / 1.5));
      const arc = [];
      for (let k = 0; k <= m; k++) { const f = f0 + df * k / m; arc.push([cx + Math.cos(f) * r, cz + Math.sin(f) * r]); }
      let best = 0, fewest = 0;
      if (onRoad) {
        fewest = Infinity;
        for (const e of [0, -0.5, 0.6, -1, 1.2, 1.8, 2.4, 3]) {
          let inner = 0, outer = 0;
          for (const [x, z] of arc) {
            const qx = x - bx * e, qz = z - bz * e, rx = (cx - x) / r, rz = (cz - z) / r;
            if (!onRoad(qx + rx * (halfW + 0.45), qz + rz * (halfW + 0.45))) inner++;
            if (!onRoad(qx - rx * (halfW + 0.4), qz - rz * (halfW + 0.4))) outer++;
          }
          const score = inner * 3 + outer * 2 + Math.abs(e) * 0.1;
          if (score < fewest) { fewest = score; best = e; }
          if (!inner && !outer) break;
        }
      }
      return { T, arc, best, fewest };
    };
    // (rounded as widely as the car needs where the road allows; within the pieces next to the corner where it doesn't.
    // Not an acute turn to the left, the kerb's side (keeping left): rounded that widely, its arc cut deep across the
    // inside of the corner, through the walls there. One to the right crosses the junction's open middle)
    const segIn = room(i, true), segOut = room(i, false), acuteLeft = a > 1.9 && turn(u, w) < 0;
    let A = acuteLeft ? null : fit(Math.min(R * tn, segIn * 0.48, segOut * 0.48));
    const T0 = Math.min(R * tn, near(i - 1) * 0.48, near(i + 1) * 0.48);
    if (!A || T0 < A.T - 0.1) { const B = fit(T0); if (B && (!A || B.fewest < A.fewest)) { A = B; A.short = true; } }
    if (!A) { out.push(P[i]); continue; }
    const { T, arc, best } = A, sIn = A.short ? near(i - 1) : segIn, sOut = A.short ? near(i + 1) : segOut;
    // (moved across over the last few metres before it and the first few after, not the whole way from the corner
    // before: the slant over a 45 m straight ran a race's rival along the road's edge into a canal's parapet)
    const sw = Math.min(20, Math.max(5, Math.abs(best) * 7));
    const pre = best && sIn * 0.9 > T + sw ? T + sw : T, post = best && sOut * 0.9 > T + sw ? T + sw : T;
    // (the points it passes by - in line before or after it - go)
    while (out.length > 1 && (P[i][0] - out[out.length - 1][0]) * u[0] + (P[i][1] - out[out.length - 1][1]) * u[1] < pre - 0.05) out.pop();
    for (skip = i + 1; skip < P.length - 1 && (P[skip][0] - P[i][0]) * w[0] + (P[skip][1] - P[i][1]) * w[1] < post - 0.05; skip++);
    if (pre > T) out.push([P[i][0] - u[0] * pre, P[i][1] - u[1] * pre]);
    for (const [x, z] of arc) out.push([x - bx * best, z - bz * best]);
    if (post > T) out.push([P[i][0] + w[0] * post, P[i][1] + w[1] * post]);
  }
  out.push(P[P.length - 1]);
  return out;
}

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

  // a lorry or a bus takes a corner slower than a car (a quarter slower at 8 m long): its turning circle is wider and it
  // leans on its tyres sooner (an 8 m lorry took a 100-degree junction turn at a car's speed, ran wide onto the verge
  // and into a wall)
  get bulkK() { return 1 - 0.3 * clamp(((this.v?.p?.length || 4.5) - 4.6) / 4, 0, 1); }

  // the tightest turn the car makes at junction pace, with a little room: its wheelbase over the tangent of the
  // steering lock it has there
  get turnR() { const p = this.v?.p || {}; return (p.wheelBase || 2.6) / Math.tan((p.steeringAngle || 0.56) * 0.86) * 1.1; }

  // (Kerala's routes are the lanes themselves, keep-left: followed as they are, the junctions' corners rounded to
  // what the car can steer. A road's centre line elsewhere: driven on its right-hand side, an offset polyline)
  setRoute(points, loop = false, offset = this.laneOffset ?? (this.v?.physics?.world?.kerala ? 0 : 2.6)) {
    const W = this.v?.physics?.world;
    if (W?.kerala && points.length > 2) points = roundCorners(points, this.turnR, (x, z) => W.onCarriageway(x, z), (this.v?.p?.width || 1.8) / 2);
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
      // past the segment's end, or round a corner beside its point (within 5 m of a sharp one, or nearer the next
      // segment than this one): on to the next, so the car doesn't keep circling for a point it has already passed
      // (not 5 m short of every point: along a curve drawn with points 1.4 m apart it ran 3 or 4 points ahead of
      // itself, steered for a point further on than meant, and cut a junction's rounded corner by 1.4 m)
      let next = t > 1;
      if (!next && this.idx < r.length - 2) {
        const c = r[this.idx + 2], ex = c[0] - b[0], ez = c[1] - b[1], u = clamp(((x - b[0]) * ex + (z - b[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
        const tt = clamp(t, 0, 1), dThis = Math.hypot(a[0] + dx * tt - x, a[1] + dz * tt - z), dNext = Math.hypot(b[0] + ex * u - x, b[1] + ez * u - z);
        const sharp = Math.abs(wrapAngle(Math.atan2(ex, ez) - Math.atan2(dx, dz))) > 0.5;
        next = (sharp && Math.hypot(b[0] - x, b[1] - z) < 5) || (t > 0.5 && dNext < dThis - 0.5);
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
    return { a: Math.abs(sum), s: sum, len: Math.max(2, Math.min(len, dist)) };
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
      const v = (Math.min(a >= 0.2 ? Math.sqrt(5 * this.skill * Math.max(6, span) / a) : Infinity, a1 >= 0.35 ? Math.sqrt(5 * this.skill * 6 / a1) : Infinity) + 0.5) * this.bulkK;
      const n = -(2 * 5.5 * Math.max(0, turns[j][0] - 8) + v * v);
      if (Math.max(a, a1) > maxTurn) maxTurn = Math.max(a, a1);
      if (n > need) { need = n; vc = v; turnDist = turns[j][0]; }
    }
    return { turn: maxTurn, dist: turnDist, vc };
  }

  update(dt, obstacles = []) {
    const v = this.v, s = v.state, c = v.controls;
    const speed = Math.hypot(s.vx, s.vz);
    // (standing still on the handbrake: the brake held at a standstill is reverse gear, and the car backed away)
    if (this.mode === 'park') { c.throttle = 0; c.brake = speed > 0.6 ? 1 : 0; c.steer = 0; c.handbrake = 1; c.nitro = false; return; }
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
      // (and what steering for a point on a curve cuts off it, L^2 / 8R, given back: aimed that much to the outside. A
      // junction's corner rounded to the car's turning circle was still cut by a metre, over the kerb's corner)
      if (bend.a > 0.15) {
        const ddx = la[0] - s.x, ddz = la[1] - s.z, dl = Math.hypot(ddx, ddz) || 1;
        const k = Math.sign(bend.s) * Math.min(0.8, laDist * laDist / (8 * bend.len / bend.a)) / dl;
        la = [la[0] - ddz * k, la[1] + ddx * k];
      }
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
      // a lorry or a bus keeps to the outside of a sharp turn (its rear wheels run inside the front's, and steered
      // along the lane it cut the corner of a Y-junction onto the verge and lodged there): aimed out by up to a metre
      // and a half as the turn comes, as far as the road goes
      if (this.bulkK < 0.97 && this.mode !== 'pursue') {
        const bt = this._bendAhead(s.x, s.z, 16);
        if (bt.a > 0.6) {
          const L = this.v.p.length || 4.5, off = Math.min(1.5, (L - 4.6) * 0.5) * clamp((bt.a - 0.6) / 0.9, 0, 1) * Math.sign(bt.s);
          const fx0 = Math.sin(s.yaw), fz0 = Math.cos(s.yaw), ox = -fz0 * off, oz = fx0 * off;   // (right of the car for a left turn)
          for (const k of [1, 0.6, 0.3]) {
            const qx = tx + ox * k, qz = tz + oz * k;
            if (!W?.kerala || W.onCarriageway(qx, qz)) { tx = qx; tz = qz; break; }
          }
        }
      }
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
    } else { c.throttle = 0; c.brake = speed > 0.6 ? 0.5 : 0; c.handbrake = speed > 0.6 ? 0 : 1; c.steer = 0; return; }

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
      let eR = ((s.x - a[0]) * -dz + (s.z - a[1]) * dx) / L;   // (+: right of the line, (-dz, dx) being its right)
      // (not yet at the line's start: how far off the line run on back behind it means nothing. A route starting 25 m
      // ahead, its first piece a degree off the car's way, read 1.9 m off and steered the car hard into a wall)
      const t = ((s.x - a[0]) * dx + (s.z - a[1]) * dz) / L;
      if (t < 0) eR *= Math.max(0, 1 + t / 5);
      steer = clamp(steer - clamp(eR, -2, 2) * 0.45 / (1 + speed / 15), -1, 1);
      // well off it (come out of a junction wide): slowed until back in the lane, as a driver would (it sped up while
      // swinging back across, and over-ran the lane into a bridge's parapet)
      if (Math.abs(eR) > 1) targetSpeed = Math.min(targetSpeed, 5 + 7 / Math.abs(eR));
    }
    // counter-steer when sliding
    if (s.slip > 0.25) steer = clamp(steer - Math.sign(s.yawRate) * 0.3, -1, 1);
    // stuck detection -> reverse
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      c.throttle = 0; c.brake = 1; c.steer = -steer; c.handbrake = 0; c.nitro = false;
      return;
    }
    // (or on the throttle and not moving: pushing against something at a slow corner speed, a lorry at 3 m/s wanted
    // never counted as stuck and pushed at a wall for good)
    const pushing = speed < 0.5 && c.throttle > 0.3;
    if (speed < 1.2 && (targetSpeed > 3 || pushing)) { this.stuckT += dt; if (this.stuckT > 1.6) { this.reverseT = 1.3; this.stuckT = 0; } } else this.stuckT = 0;
    if (Math.abs(diff) > 2.2 && speed < 6) { // target behind: three-point turn
      this.reverseT = 0.9;
    }
    // progress watchdog: repeatedly stuck -> ask the owner to reset us onto a lane
    this.watchT = (this.watchT || 0) + dt;
    if (this.watchT > 5) {
      const moved = this.watchPos ? Math.hypot(s.x - this.watchPos[0], s.z - this.watchPos[1]) : 99;
      this.needsReset = moved < 4 && (targetSpeed > 3 || pushing);
      this.watchPos = [s.x, s.z]; this.watchT = 0;
    }
    // (and not on the throttle while still steering hard: out of a sharp junction turn it sped up at full lock and
    // swung wide, into a bridge's parapet just past the junction)
    if (this.mode !== 'pursue' && Math.abs(steer) > 0.7) targetSpeed = Math.min(targetSpeed, 6 * this.bulkK);
    const err = targetSpeed - speed;
    c.steer = steer;
    c.throttle = err > 0 ? clamp(err / 6, 0.25, 1) * this.powerScale : 0;
    c.brake = err < -1 ? clamp(-err / 4, 0.3, 1) : 0;   // (firmly: the speed plan counts on real braking)
    c.handbrake = Math.abs(diff) > 1.1 && speed > 12 && speed < 30 ? 1 : 0;
    // (stopped where it means to stop: held there)
    if (targetSpeed < 0.5 && speed < 0.8) { c.brake = 0; c.throttle = 0; c.handbrake = 1; }
    c.nitro = this.useNitro && err > 15 && Math.abs(diff) < 0.12;
  }
}
