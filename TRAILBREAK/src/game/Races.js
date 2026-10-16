// Checkpoint races, as in Off-Road League: circuits of laps and point-to-point rallies along a map's trails, through
// numbered checkpoint arches; the screen shows the checkpoint (2/7), the lap and the clock. Each map lists its own
// (world/maps/, `races`, kept apart from its `events` so the ground they are built on stays as it was):
//
//   { id, kind: 'circuit', trail, laps, cps, ... }           laps of a loop trail, cps checkpoints a lap, then the line
//   { id, kind: 'circuit', via: [[x, z], ...], laps, cps }   laps through the via points by road and trail, and back
//   { id, kind: 'rally', trail, from?, to?, cps, ... }        along one trail (from and to: the points nearest)
//   { id, kind: 'rally', via: [[x, z], ...], cps, ... }       by road and trail through the via points (game/Route.js)
//   name, desc, r (how near a checkpoint's middle to cross it), par: { gold, silver, bronze } (s), prize (x the
//   events' money)
//
// They run on the events' machinery (game/Events.js, game/EventPlay.js: the start line, J, races with friends, medals,
// prize money), with their gates lines square to the course, crossed, or passed close by on a corner (near). Pure
// logic: runs in Node for the tests.
import { RouteGraph } from './Route.js';

const BACK = 7;                       // m behind a circuit's start-finish line to start from

/** The polyline's length, and the point and the direction at arc length s. */
function measure(pts) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const at = (s) => {
    s = Math.max(0, Math.min(cum.at(-1), s));
    let k = 1;
    while (k < pts.length - 1 && cum[k] < s) k++;
    const l = cum[k] - cum[k - 1] || 1, t = (s - cum[k - 1]) / l;
    const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / l, dz: (bz - az) / l };
  };
  return { length: cum.at(-1), at };
}

/** A smoother direction at s: the chord over 10 m either side (a gate square to the course, not to one kink of it). */
function dirAt(m, s) {
  const a = m.at(s - 10), b = m.at(s + 10), l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return [(b.x - a.x) / l, (b.z - a.z) / l];
}

/** The part of a trail between the points nearest `from` and `to` (default: all of it), in that order. */
function trailPart(points, from, to) {
  const near = (p) => { let bi = 0, bd = Infinity; points.forEach(([x, z], i) => { const d = Math.hypot(x - p[0], z - p[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const i0 = from ? near(from) : 0, i1 = to ? near(to) : points.length - 1;
  return i0 <= i1 ? points.slice(i0, i1 + 1) : points.slice(i1, i0 + 1).reverse();
}

/**
 * The races of a world, as events: { id, kind, name, desc, laps, start: { x, z, yaw }, gates: [{ x, z, y, r, dir, lap,
 * cp, finish }], line (the course to follow, laps and all), length (m, one lap), par, prize }.
 */
export function racesFor(world) {
  const M = world.map || world.data?.map, trails = world.data?.trails || [];
  let graph = null;
  const races = [];
  for (const spec of M?.races || []) {
    const { trail, via, from, to, laps: L, cps, r = 8, ...rest } = spec;
    let pts;
    if (via) {
      graph ||= new RouteGraph(trails);
      pts = [];
      const stops = spec.kind === 'circuit' ? [...via, via[0]] : via;
      for (let k = 1; k < stops.length; k++) {
        const leg = graph.route(stops[k - 1][0], stops[k - 1][1], stops[k][0], stops[k][1]).points;
        pts.push(...(k > 1 ? leg.slice(1) : leg));
      }
    } else {
      const t = trails.find((q) => q.name === trail);
      if (!t) continue;
      pts = spec.kind === 'circuit' ? t.points.slice() : trailPart(t.points, from, to);
    }
    if (pts.length < 2) continue;
    const m = measure(pts), laps = spec.kind === 'circuit' ? Math.max(1, L || 1) : 1;
    const gates = [];
    for (let lap = 1; lap <= laps; lap++) {
      for (let c = 1; c <= cps + 1; c++) {
        // (a rally's finish a few metres short of the trail's end, so it is crossed before the trail runs out)
        const s = c === cps + 1 && spec.kind !== 'circuit' ? m.length - 4 : (c / (cps + 1)) * m.length, p = m.at(s);
        gates.push({ x: p.x, z: p.z, r, near: r, dir: dirAt(m, s), lap, cp: c, finish: c === cps + 1 });
      }
    }
    for (const g of gates) g.y = world.terrain(g.x, g.z);
    // the start: a circuit's grid just behind its line; a rally's at its first point, facing down the course
    const d0 = dirAt(m, 0);
    const start = spec.kind === 'circuit'
      ? { x: pts[0][0] - d0[0] * BACK, z: pts[0][1] - d0[1] * BACK, yaw: Math.atan2(d0[0], d0[1]) }
      : { x: pts[0][0], z: pts[0][1], yaw: Math.atan2(d0[0], d0[1]) };
    const line = [];
    for (let lap = 0; lap < laps; lap++) line.push(...(lap ? pts.slice(1) : pts));
    if (spec.kind === 'circuit') line.unshift([start.x, start.z]);
    races.push({ ...rest, kind: spec.kind, race: true, laps, cps, start, gates, line, length: m.length });
  }
  return races;
}
