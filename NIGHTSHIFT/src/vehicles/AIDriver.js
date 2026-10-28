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
      // (and up to 4 m back along the way in: the lane out starting 2 m behind the lane in's end, the lines met short
      // of it - left unmerged, the corner was rounded within that 2 m hook, and the car ran on past it into a pole)
      const segB = Math.hypot(P[j + 1][0] - P[j][0], P[j + 1][1] - P[j][1]), segA = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (s < Math.max(-4, 0.5 - segA) || s > 8 || t < -8 || t > Math.min(8, segB - 1)) continue;
      J = j; X = [P[i][0] + u[0] * s, P[i][1] + u[1] * s];
    }
    if (J < 0) continue;
    P.splice(i, J - i + 1, X);
    i--;   // (and again from there: one corner made of more pieces than these)
  }
  // (the room before or after a corner: the run straight on through points that hardly turn, not just the next piece.
  // A route met a 100-degree junction turn by a 3.9 m hop in line with the lane before it, from one lane's end to the
  // next one's start: rounded within that hop, 2 m across, the car swung its nose a metre and a half off the road)
  // (all of it up to where a gentle bend starts, which isn't rounded; half of it up to a corner, whose own arc takes
  // the other half. A side road bending gently away from a junction left its turn half the room it had: rounded to
  // 3.9 m, tighter than the car could steer, and it ran wide off the road)
  const room = (i, back) => {
    let L = 0;
    for (let k = i; ;) {
      const k2 = back ? k - 1 : k + 1;
      L += Math.hypot(P[k2][0] - P[k][0], P[k2][1] - P[k][1]);
      if (k2 <= 0 || k2 >= P.length - 1) return [L, 0.95];
      const t = Math.abs(turn(dir(P[k2 - 1], P[k2]), dir(P[k2], P[k2 + 1])));
      if (t >= 0.12) return [L, t < 0.5 ? 0.95 : 0.48];
      k = k2;
    }
  };
  // (the point `d` along the route from point i, back or on, and the index of the first point past it)
  const along = (i, d, back) => {
    for (let k = i, L = 0; ;) {
      const k2 = back ? k - 1 : k + 1;
      if (k2 < 0 || k2 > P.length - 1) return [[P[k][0], P[k][1]], k];
      const l = Math.hypot(P[k2][0] - P[k][0], P[k2][1] - P[k][1]);
      if (L + l >= d) { const f = (d - L) / (l || 1); return [[P[k][0] + (P[k2][0] - P[k][0]) * f, P[k][1] + (P[k2][1] - P[k][1]) * f], k2]; }
      L += l; k = k2;
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
      let best = 0, fewest = 0, off = 0;
      if (onRoad) {
        fewest = Infinity;
        // (out to 4.6 m: an acute turn at a Y-junction's tip, moved out 3 m, still clipped the tip; the junction's
        // mouth had room for it)
        for (const e of [0, -0.5, 0.6, -1, 1.2, 1.8, 2.4, 3, 3.8, 4.6]) {
          let inner = 0, outer = 0;
          for (const [x, z] of arc) {
            const qx = x - bx * e, qz = z - bz * e, rx = (cx - x) / r, rz = (cz - z) / r;
            if (!onRoad(qx + rx * (halfW + 0.45), qz + rz * (halfW + 0.45))) inner++;
            if (!onRoad(qx - rx * (halfW + 0.4), qz - rz * (halfW + 0.4))) outer++;
          }
          const score = inner * 3 + outer * 2 + Math.abs(e) * 0.1;
          if (score < fewest) { fewest = score; best = e; off = inner + outer; }
          if (!inner && !outer) break;
        }
      }
      return { T, arc, best, fewest, off };
    };
    // (rounded as widely as the car needs where the road allows; within the pieces next to the corner where it doesn't.
    // Not an acute turn to the left, the kerb's side (keeping left): rounded that widely, its arc cut deep across the
    // inside of the corner, through the walls there. One to the right crosses the junction's open middle)
    // (unless the wide arc, moved out into the junction's mouth, keeps to the road all round: a 140-degree turn at a
    // Y-junction, too sharp for any arc within the corner, had the car shunting back and forth for 13 s)
    const [segIn, kIn] = room(i, true), [segOut, kOut] = room(i, false), acuteLeft = a > 1.9 && turn(u, w) < 0;
    let A = fit(Math.min(R * tn, segIn * kIn, segOut * kOut));
    if (acuteLeft && A?.off !== 0) A = null;
    // (the tighter arc only where the car can still drive it: R has a tenth to spare over its lock at junction pace, and
    // one rounded to 3.9 m, tighter than it can steer, it ran wide off the road at the end of)
    const T0 = Math.min(R * tn, near(i - 1) * 0.48, near(i + 1) * 0.48);
    if (!A || (T0 < A.T - 0.1 && T0 / tn > R / 1.17)) { const B = fit(T0); if (B && (!A || B.fewest < A.fewest)) { A = B; A.short = true; } }
    if (!A) { out.push(P[i]); continue; }
    const { T, arc, best } = A, sIn = A.short ? near(i - 1) : segIn, sOut = A.short ? near(i + 1) : segOut;
    // (moved across over the last few metres before it and the first few after, not the whole way from the corner
    // before: the slant over a 45 m straight ran a race's rival along the road's edge into a canal's parapet)
    const sw = Math.min(20, Math.max(5, Math.abs(best) * 7));
    const pre = best && sIn * 0.9 > T + sw ? T + sw : T, post = best && sOut * 0.9 > T + sw ? T + sw : T;
    // (where the move across starts and ends: that far along the route itself, on the lane - put that far along the
    // straight line out of the corner, 2 m off a lane bending gently away, it took a car to the road's edge and a
    // barrier)
    const preQ = pre > T ? along(i, pre, true) : null, postQ = post > T ? along(i, post, false) : null;
    // (the points it passes by - in line before or after it - go)
    if (preQ) { const by = new Set(P.slice(preQ[1] + 1, i)); while (out.length > 1 && by.has(out[out.length - 1])) out.pop(); }
    else while (out.length > 1 && (P[i][0] - out[out.length - 1][0]) * u[0] + (P[i][1] - out[out.length - 1][1]) * u[1] < pre - 0.05) out.pop();
    if (postQ) skip = postQ[1];
    else for (skip = i + 1; skip < P.length - 1 && (P[skip][0] - P[i][0]) * w[0] + (P[skip][1] - P[i][1]) * w[1] < post - 0.05; skip++);
    // (held to even where it doesn't keep to the road all round, however it's moved - a junction too tight for the
    // turn: steered for a point ahead there instead, cutting in, a car's inside rear corner went 0.6 m over the tip of
    // a Y-junction)
    if (preQ) out.push(preQ[0]);
    for (const [x, z] of arc) out.push([x - bx * best, z - bz * best]);
    if (postQ) out.push(postQ[0]);
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
    // drives on through the route's end (a race's finish line) rather than pulling up there
    this.runOn = opts.runOn ?? false;
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
    this.raw = points; this.offset = offset;
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
    // (a point on top of the last one dropped: a piece of no length has no way, and followed, it read as a sharp kink)
    points = points.filter((q, i) => !i || Math.hypot(q[0] - points[i - 1][0], q[1] - points[i - 1][1]) > 0.05);
    this.route = points; this.idx = 0; this.loop = loop; this.mode = 'route';
    // on from the piece of the route beside the car, running its way, within the route's first 60 m (one begun at a
    // junction behind it, on the road it's on: not back to that junction first). And from the start when there's none:
    // skipping every point behind it, one that turned round first had the car head for its 21st point, 50 m off
    // across the corner, into a barrier
    const s = this.v.state;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    if (!loop) {
      let best = 0, bd = Infinity;
      for (let i = 0, len = 0; i < points.length - 1 && len < 60; i++) {
        const a = points[i], b = points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-6;
        const t = clamp(((s.x - a[0]) * dx + (s.z - a[1]) * dz) / (L * L), 0, 1), d = Math.hypot(s.x - a[0] - dx * t, s.z - a[1] - dz * t);
        if ((dx * fx + dz * fz) / L > 0.3 && d < bd - 0.01) { bd = d; best = i; }
        len += L;
      }
      if (bd < 8) this.idx = best;
    }
  }

  // more route on the end of this one (a cruise's next leg, starting where this one ends): the corner where they join
  // planned for and braked for like any other (handed a new route at the last one's end, a sharp turn met there at
  // 58 km/h ran a car off the road into a house's wall)
  extendRoute(points) {
    const raw = this.raw, s = this.v.state;
    if (!raw?.length || this.loop || this.mode !== 'route') { this.setRoute(points, false, this.offset); return; }
    // (from two points before the car's nearest: the corner it's in rounded as it was)
    let j = 0, bd = Infinity;
    for (let i = 0; i < raw.length; i++) { const d = (raw[i][0] - s.x) ** 2 + (raw[i][1] - s.z) ** 2; if (d < bd) { bd = d; j = i; } }
    const keep = raw.slice(Math.max(0, j - 2)), last = keep[keep.length - 1];
    this.setRoute([...keep, ...(Math.hypot(points[0][0] - last[0], points[0][1] - last[1]) < 0.5 ? points.slice(1) : points)], false, this.offset);
  }

  // the distance left along the route to its end (counted up to `cap`)
  remaining(cap = Infinity) {
    const r = this.route, s = this.v.state;
    if (this.loop) return Infinity;
    if (!r.length) return 0;
    if (this.idx >= r.length - 1) return Math.hypot(r[r.length - 1][0] - s.x, r[r.length - 1][1] - s.z);
    let d = Math.hypot(r[this.idx + 1][0] - s.x, r[this.idx + 1][1] - s.z);
    for (let i = this.idx + 1; i < r.length - 1 && d < cap; i++) d += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]);
    return d;
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

  // following the route itself: the steering that keeps the car on it from where it is - the route's turning a moment
  // ahead (the steering's lag) as a wheel angle, the car's heading off the route's, and the distance off it. Each point
  // of the route turns it evenly over a stretch about it: half the pieces either side at most (an arc's points 1.5 m
  // apart, its curvature), and no longer than the turn needs (15 m a radian: a kink between long straights a gentle
  // bend, and an arc's first point at the end of a straight not the whole of its second half). Measured from the
  // nearest place on the route, on the piece the car is on, one or two on or a few back (a car inside a junction's arc
  // is nearer the next piece before it's past this one's end; and the rear axle trails the car's middle).
  // All of it for the one place on the car that goes the way it points: the middle of the rear axle (nearer the
  // middle of the car at speed, the rear tyres slipping out a little). The middle itself runs inside the way it
  // points round a bend - steered on its heading it settled 0.6 m inside a junction's arc - and steered on the way it
  // was going, at an arc's end the still-turned wheel had it going along the straight while it pointed 13 degrees
  // short of it: the wheel came straight, it set off along its nose, 0.4 m wide across the lane, into the corner of a
  // building. The rear axle on the arc, the car points along the straight as it comes to it
  _track(speed) {
    const s = this.v.state, r = this.route, n = r.length, p = this.v.p || {};
    const seg = (i) => Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]) || 1e-6;
    const hd = (i) => Math.atan2(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]);
    // (point j's turn, and the stretch before and after it the turn is spread over)
    const vtx = (j) => { const tau = wrapAngle(hd(j) - hd(j - 1)), half = Math.max(0.75, Math.abs(tau) * 7.5); return [tau, Math.min(seg(j - 1) / 2, half), Math.min(seg(j) / 2, half)]; };
    const sk = clamp(speed / 55, 0, 1), lock = (p.steeringAngle || 0.56) * (1 - 0.66 * sk * (2 - sk)), wb = p.wheelBase || 2.6;   // (as the physics allows)
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), back = s.vx * fx + s.vz * fz < -0.5;
    const arm = back ? 0 : Math.max(0, (p.b ?? wb / 2) - speed * speed / 150), X = s.x - fx * arm, Z = s.z - fz * arm;
    let bi = -1, bt = 0, bd = Infinity, e = 0;
    for (let i = Math.max(0, this.idx - 3); i <= Math.min(n - 2, this.idx + 2); i++) {
      const a = r[i], dx = r[i + 1][0] - a[0], dz = r[i + 1][1] - a[1], L = seg(i), t = clamp(((X - a[0]) * dx + (Z - a[1]) * dz) / L, 0, L);
      const d = Math.hypot(X - a[0] - dx / L * t, Z - a[1] - dz / L * t);
      if (d < bd - 1e-3) { bd = d; bi = i; bt = t; e = ((X - a[0]) * -dz + (Z - a[1]) * dx) / L; }   // (+: right of it)
    }
    if (bi < 0) return 0;
    const Li = seg(bi);
    let h = hd(bi);
    if (bi > 0) { const [tau, l, rr] = vtx(bi); if (bt < rr) h = hd(bi - 1) + tau * (bt + l) / (l + rr); }
    if (bi < n - 2) { const [tau, l, rr] = vtx(bi + 1); if (bt > Li - l) h = hd(bi) + tau * (bt - Li + l) / (l + rr); }
    // (the curvature `dp` on: that of the point whose stretch it falls in, if any; and the most over the next few metres)
    const dp = 0.2 + speed * 0.08, ahead = 3 + arm + speed * 0.5;
    let k = 0, kMax = 0;
    for (let j = Math.max(1, bi), cum = j === bi ? -bt : Li - bt; j < n - 1 && cum - 30 < ahead; cum += seg(j), j++) {
      const [tau, l, rr] = vtx(j), kj = tau / Math.max(0.3, l + rr);
      if (dp >= cum - l && dp <= cum + rr) k = kj;
      // (nor a sharp corner left unrounded - too tight for any arc: spread into a curve, it ran across the grass
      // inside a Y-junction)
      if (cum + rr > 0 && cum - l < ahead) kMax = Math.max(kMax, Math.abs(tau) > 0.6 ? Infinity : Math.abs(kj));
    }
    const delta = Math.atan(wb * k) + wrapAngle(h - s.yaw) + Math.atan(1.5 * e / (speed + 1));
    // (a route tighter than the car can steer - an acute turn rounded as tight as the corner allows - isn't followed
    // to the letter: the point ahead steered for cuts in early, as it must. Followed, the car turned in late, at its
    // lock, and ran wide over the far side of a Y-junction)
    const kCar = Math.tan(lock) / wb;
    this._trackW = clamp((1.2 * kCar - kMax) / (0.2 * kCar), 0, 1);
    return clamp(-delta / lock, -1, 1);
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
      let sum = 0, span = 0, rT = Infinity;
      for (let k = j, n = 1; k < turns.length && turns[k][0] - turns[j][0] <= 20; k++, n++) {
        sum += turns[k][1]; span = turns[k][0] - turns[j][0];
        // (and the tightest stretch of it 6 m long or more, each point's turning spread over the gap to the next)
        if (n > 1 && span * n / (n - 1) >= 6) rT = Math.min(rT, span * n / (n - 1) / Math.max(0.2, Math.abs(sum)));
      }
      const a = Math.min(Math.PI, Math.abs(sum));
      // (and a sharp corner at one point on its own: two sharp opposite corners close together - a jog through a
      // junction - cancelled out in the sum, and the car came at the first one at 55 km/h)
      const a1 = Math.min(Math.PI, Math.abs(turns[j][1]));
      if (a < 0.2 && a1 < 0.35) continue;
      // (a junction's turn as slow as its tightest part needs, on less of the tyres' grip the tighter it is: the steering
      // takes time to wind on. Its speed from the whole 20 m it turns over, the lane's bending on after the turn's arc
      // too, a 5.5 m radius turn into a side road was taken at 21 km/h, on the tyres' limit, and the car ran wide)
      const vT = a >= 1 && rT < 12 ? Math.sqrt(5 * this.skill * clamp(rT / 10, 0.6, 1) * rT) : Infinity;
      // (a tight junction turn at walking pace: the steering lock is less at speed)
      const v = (Math.min(a >= 0.2 ? Math.sqrt(5 * this.skill * Math.max(6, span) / a) : Infinity, a1 >= 0.35 ? Math.sqrt(5 * this.skill * 6 / a1) : Infinity, vT) + 0.5) * this.bulkK;
      const n = -(2 * 5.5 * Math.max(0, turns[j][0] - 8) + v * v);
      if (Math.max(a, a1) > maxTurn) maxTurn = Math.max(a, a1);
      if (n > need) { need = n; vc = v; turnDist = turns[j][0]; }
    }
    return { turn: maxTurn, dist: turnDist, vc };
  }

  // room to go by one standing at the kerb (lat: how far to this car's right it is, need: how much further out than
  // now this car's middle must go): the road out there from here to past it, the car's outer side kept to the tarmac,
  // and nothing on that line coming the other way
  _roomBy(o, lat, ahead, need, obstacles) {
    const s = this.v.state, W = this.v.physics.world, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), k = -Math.sign(lat) * need;
    const ox = s.x - fz * k, oz = s.z + fx * k, myW = (this.v.p?.width || 1.8) / 2, past = ahead + (o.spec?.l ?? 4.4) / 2 + 2;
    for (const a of [ahead * 0.5, ahead, past]) if (!W.onCarriageway(ox + fx * a, oz + fz * a, 0.3 - myW)) return false;
    for (const q of obstacles) {
      if (q === o) continue;
      const dx = q.x - ox, dz = q.z - oz, a = dx * fx + dz * fz, l = Math.abs(-dx * fz + dz * fx), qh = (q.spec?.l ?? 4.4) / 2;
      // (anything standing on that line beside it - a bus stopped the other way: out round the parked car, the car
      // only stopped against the bus instead, the road between them taken)
      if (a > -qh && a < past + qh && l < (q.spec?.w ?? 1.8) / 2 + myW + 0.25) return false;
      if (!((q.v ?? 0) > 0.5) || a < -5 || a > past + 40 || l > 3) continue;
      if (Math.sin(q.yaw) * fx + Math.cos(q.yaw) * fz < -0.5) return false;
    }
    return true;
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
      // (closing on them no faster than it can slow back to their pace in the room left: at 166 km/h 90 m off, a police
      // car couldn't follow the player's turn and went on into a building)
      targetSpeed = Math.min(this.maxSpeed, Math.max(Math.hypot(t.vx || 0, t.vz || 0) + 4, 8) + 0.25 * Math.max(0, d - 12));
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
      // and braked for in time to stop there (slowed only in its last 12 m, a car came up to a route's end at 58 km/h
      // and ran on past it), unless it runs on through it
      if (!this.loop && !this.runOn) { const rem = this.remaining(120); if (rem < 120) targetSpeed = Math.min(targetSpeed, Math.sqrt(8 * Math.max(0, rem - 3))); }
    } else { c.throttle = 0; c.brake = speed > 0.6 ? 0.5 : 0; c.handbrake = speed > 0.6 ? 0 : 1; c.steer = 0; return; }

    // obstacle avoidance (traffic cars / other vehicles ahead)
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    let avoid = 0, pass = 0;
    const myL = v.p?.length || 4.4, myW = (v.p?.width || 1.8) / 2;
    // (still going by one standing at the kerb: kept out until clear of its back. But before it's alongside, the way
    // out round it taken meanwhile - something come the other way: back in behind it. Pushed on out, a van stood
    // against a parked car's corner and an auto, and was reset 13 times)
    if (this.passO) {
      const o = this.passO, a = (o.x - s.x) * fx + (o.z - s.z) * fz, lat = -(o.x - s.x) * fz + (o.z - s.z) * fx;
      if (a < -(myL + (o.spec?.l ?? 4.4)) / 2 - 0.5 || a > 30 || (o.v ?? 0) > 1 || this.mode === 'pursue') this.passO = null;
      else if (a > 2 && !this._roomBy(o, lat, a, Math.max(0, (o.spec?.w ?? 1.8) / 2 + myW + 0.45 - Math.abs(lat)), obstacles)) this.passO = null;
      else { pass = this.passLat; targetSpeed = Math.min(targetSpeed, 6); }
    }
    for (const o of obstacles) {
      const dx = o.x - s.x, dz = o.z - s.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 2 || ahead > 18 + speed * 0.8 || o === this.passO) continue;
      const lat = -dx * fz + dz * fx; // + = to the right? right = (-fz, fx)
      // (only what this car's body would come within half a metre of: steered away from and slowed for anything
      // within 2.8 m of its middle, a car met one coming the other way in its own lane on a narrow street, 2 m across)
      const clear = Math.abs(lat) - (o.spec?.w ?? 1.8) / 2 - myW;
      if (clear > 0.5) continue;
      // (one coming the other way, in its own lane, that this car's body clears by a quarter of a metre: by it at a
      // crawl, not stopped for. Each waiting for the other, a mission's car and a bus stood nose to nose on a narrow
      // street in Chala for good)
      if (clear > 0.2 && this.mode !== 'pursue' && o.yaw !== undefined && Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz < -0.5) {
        targetSpeed = Math.min(targetSpeed, 4); avoid += (lat > 0 ? -0.5 : 0.5) * (1 - ahead / (18 + speed * 0.8)); continue;
      }
      // (one pulled over to the kerb for this one's siren: steered round, not slowed for)
      const making = this.siren && o.yieldT > 0 && Math.abs(lat) > 0.8;
      if (!making && ahead < 14 + speed * 0.5 && this.mode !== 'pursue') {
        // (one standing at the kerb - parked, pulled in - or a wreck lying in the lane: out round it at a crawl, if the
        // road beside it has room and nothing's coming the other way. Braked for as a car in a queue is, the van you
        // tail stopped behind a car parked at the kerb and waited there for good. Not one stopped in a queue, square in
        // the lane)
        const need = (o.spec?.w ?? 1.8) / 2 + myW + 0.45 - Math.abs(lat);
        if (v.physics?.world?.kerala && (o.v ?? 0) < 0.3 && (o.parked || o.state !== 'drive' || (o.pulled && Math.abs(lat) > 0.5)) && this._roomBy(o, lat, ahead, need, obstacles)) {
          if (need > Math.abs(pass)) { pass = -Math.sign(lat) * need; this.passO = o; this.passLat = pass; }
          targetSpeed = Math.min(targetSpeed, 6);
          continue;
        }
      }
      avoid += (lat > 0 ? -1 : 1) * (1 - ahead / (18 + speed * 0.8)) * (making ? 2 : 1);
      if (making) continue;
      // (and slowed to stop short of it: allowed its speed + 2 m/s + 0.3 m/s a metre off, an ambulance on its way to
      // an accident came up to a car stopped in the queue at 3.5 m/s and shunted it off the road. Its speed the way
      // this one's going: one coming the other way gives no leave to drive at it)
      if (ahead < 14 + speed * 0.5 && this.mode !== 'pursue') {
        const gap = ahead - (myL + (o.spec?.l ?? 4.4)) / 2 - 1.2, along = (o.v ?? 0) * Math.max(0, o.yaw === undefined ? 1 : Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz);
        targetSpeed = Math.min(targetSpeed, along + Math.sqrt(2 * 3.5 * Math.max(0, gap)));
      }
    }
    this.avoid = avoid;
    if (pass) { tx += -fz * pass; tz += fx * pass; }   // (aimed out by what it takes to clear it: (-fz, fx) the car's right)

    const desired = Math.atan2(tx - s.x, tz - s.z);
    const diff = wrapAngle(desired - s.yaw);
    // still turning hard (a junction's corner passed but the car not yet round it): no faster than it can turn at,
    // not on the throttle at full lock into the wall on the outside
    if (this.mode !== 'pursue' && Math.abs(diff) > 0.35) targetSpeed = Math.min(targetSpeed, 4 + 10 * Math.max(0, 1 - Math.abs(diff) / 1.2));
    let steer = clamp(-diff * 2.2 + clamp(avoid, -1, 1) * 0.35, -1, 1);
    // and back onto the line itself when off it (steering only for a point ahead, a metre to one side was corrected
    // slowly: a car drifted that far toward a bridge's parapet and into its end)
    if (this.mode !== 'pursue' && this.idx < this.route.length - 1 && !avoid && !pass) {
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
      // and close to the line at junction pace, steered along it: the turning the route has a little ahead wound on as it
      // comes (as a driver turns the wheel into a corner), the heading off the route's and the distance off it taken
      // out. (Steered only for a point a few metres on, a car turned in early, inside a junction's arc and pointing
      // less round it than the arc, then couldn't get round its end: 0.9 m wide off a 5.5 m radius turn into a side
      // road.) Not a lorry or a bus, which keeps to the outside of a turn; nor at speed, where the point ahead does
      const w = this.bulkK > 0.97 ? clamp((14 - speed) / 4, 0, 1) * clamp(2 - Math.abs(eR), 0, 1) : 0;
      if (w > 0) { const t = this._track(speed), wt = w * this._trackW; steer = steer * (1 - wt) + t * wt; }
    }
    // counter-steer when sliding
    if (s.slip > 0.25) steer = clamp(steer - Math.sign(s.yawRate) * 0.3, -1, 1);
    // stuck detection -> reverse
    // (backing up at walking pace, and only while there's road behind: a car turning round at a dead end backed off
    // at 25 km/h, into a barrier)
    const Wk = v.physics?.world?.kerala ? v.physics.world : null, half = (v.p?.length || 4.4) / 2 + 1.2;
    // (checked a metre or so past each end, and half a metre over the road's edge: in a lane hardly longer than the car
    // is wide, held to the tarmac itself, it turned round in 10 cm shuffles)
    const rearOK = !Wk || Wk.onCarriageway(s.x - fx * half, s.z - fz * half, 0.5), frontOK = !Wk || Wk.onCarriageway(s.x + fx * (half + 0.6), s.z + fz * (half + 0.6), 0.5);
    const back = -(s.vx * fx + s.vz * fz);
    const reverse = (st) => { c.throttle = back > 2.5 ? 0.4 : 0; c.brake = back > 2 ? 0 : 1; c.steer = st; c.handbrake = 0; c.nitro = false; };
    // target behind (or well round to the side with the car near stopped: a turn too sharp to steer round, a
    // 140-degree one at a Y-junction): three-point turn - forward on full lock toward it as far as the road goes, back
    // on full opposite lock as far as the road behind goes or until it points near enough the way on, and again, each
    // leg a moment at least. (Steered only as hard as the point ahead asked, a car shuffled a metre back and forth at
    // that junction for 14 s; and a reverse called off the moment it began, another sat nosed into a road's edge)
    // (or the point it steers for inside the circle the car turns on at full lock, whichever side it's on: the way on
    // doubles back tighter than the car can turn - a Y-junction's two forks, 155 degrees from one to the other in two
    // corners 4 m apart - and swept round on full lock, the car ran 2.2 m off the far side of the road)
    let inCircle = false;
    if (!this.turning && this.mode === 'route' && speed < 6 && targetSpeed > 1) {   // (not pulling up at the route's end)
      const p = v.p || {}, wb = p.wheelBase || 2.6, sk = clamp(speed / 55, 0, 1), arm = p.b ?? wb / 2;
      const Rr = wb / Math.tan((p.steeringAngle || 0.56) * (1 - 0.66 * sk * (2 - sk)));
      const side = Math.sign((tx - s.x) * -fz + (tz - s.z) * fx) || 1;   // (+: to the right, (-fz, fx))
      // (the circle's middle level with the rear axle, out to that side)
      const cx = s.x - fx * arm - fz * Rr * side, cz = s.z - fz * arm + fx * Rr * side;
      inCircle = Math.hypot(tx - cx, tz - cz) < Rr - 0.5;
    }
    if (!this.turning && ((Math.abs(diff) > 2.2 && speed < 6) || (Math.abs(diff) > 1.5 && speed < 1.5) || inCircle)) {
      this.turning = rearOK && Math.abs(diff) > 2.2 ? 'back' : 'fwd'; this.turnSide = Math.sign(diff) || 1; this.legT = 0; this.turnT = 0;
    }
    if (this.turning) {
      this.legT += dt; this.turnT += dt;
      const blocked = speed < 0.5 && this.legT > 1.2;   // (forward against something: back again)
      if (Math.abs(diff) < 0.35 || this.turnT > 25) this.turning = false;
      else if (this.turning === 'back' ? !rearOK || this.legT > 2.5 || Math.abs(diff) < 1 : rearOK && Math.abs(diff) >= 1 && this.legT > 0.4 && (!frontOK || blocked)) {
        this.turning = this.turning === 'back' ? 'fwd' : 'back'; this.legT = 0;
      }
    }
    if (this.turning === 'back') { reverse(this.turnSide); return; }
    if (this.reverseT > 0 && rearOK) { this.reverseT -= dt; reverse(-steer); return; }
    this.reverseT = 0;
    // (or on the throttle and not moving: pushing against something at a slow corner speed, a lorry at 3 m/s wanted
    // never counted as stuck and pushed at a wall for good)
    const pushing = speed < 0.5 && c.throttle > 0.3;
    if (!this.turning && speed < 1.2 && (targetSpeed > 3 || pushing)) { this.stuckT += dt; if (this.stuckT > 1.6) { this.reverseT = 1.3; this.stuckT = 0; } } else this.stuckT = 0;
    if (this.turning) { steer = -this.turnSide; targetSpeed = Math.min(targetSpeed, 2.5); }
    // progress watchdog: repeatedly stuck -> ask the owner to reset us onto a lane
    this.watchT = (this.watchT || 0) + dt;
    if (this.watchT > 5) {
      const moved = this.watchPos ? Math.hypot(s.x - this.watchPos[0], s.z - this.watchPos[1]) : 99;
      // (or waiting on something that never goes - a standoff with something coming the other way on a narrow street,
      // a wreck in the lane and the road beside it never clear: 30 s without getting anywhere, its route not done. The
      // van you tail waited behind a wreck for good)
      this.waitT = moved < 4 && this.mode === 'route' && this.idx < this.route.length - 3 ? (this.waitT || 0) + this.watchT : 0;
      // (not while turning round: a three-point turn in a narrow lane gets nowhere for a while, and was reset)
      this.needsReset = !this.turning && moved < 4 && (targetSpeed > 3 || pushing || this.waitT >= 30);
      this.watchPos = [s.x, s.z]; this.watchT = 0;
    }
    // (and not on the throttle while still steering hard: out of a sharp junction turn it sped up at full lock and
    // swung wide, into a bridge's parapet just past the junction)
    if (this.mode !== 'pursue' && Math.abs(steer) > 0.7) targetSpeed = Math.min(targetSpeed, 6 * this.bulkK);
    const err = targetSpeed - speed;
    c.steer = steer;
    c.throttle = err > 0 ? clamp(err / 6, 0.25, 1) * this.powerScale : 0;
    // (firmly: the speed plan counts on real braking. And from half a metre a second over: let run to 1 m/s over, a car
    // came into a junction's tight turn 3.6 km/h faster than planned - a fifth faster, half as much again sideways - and
    // ran wide off the road at its exit)
    c.brake = err < -0.5 ? clamp(-err / 4, 0.2, 1) : 0;
    c.handbrake = Math.abs(diff) > 1.1 && speed > 12 && speed < 30 ? 1 : 0;
    // (stopped where it means to stop: held there)
    if (targetSpeed < 0.5 && speed < 0.8) { c.brake = 0; c.throttle = 0; c.handbrake = 1; }
    c.nitro = this.useNitro && err > 15 && Math.abs(diff) < 0.12;
  }
}
