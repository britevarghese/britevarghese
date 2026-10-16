// Events: timed competitions on a map's own ground. Each is a start line and gates to drive through in order, the last
// one the finish. Alone you race the par times for a medal; with friends in the room, whoever starts an event invites
// the others, everyone who joins lines up at the start, and the prize money goes by finishing order.
//
// Each map lists its events (world/maps/): a climb along one of its trails, straight courses (a bog dash, a sand drag,
// a paddy field), a slalom through rocks. This module turns those into gates on the ground, and runs and scores them.
//
// Pure logic (runs in Node for the tests): the game draws the gates, the HUD shows the run.

/**
 * Prize money: solo medals (paid once per medal level per event), and by finishing place in a race with friends; an
 * event's `prize` scales both (the long hill climb pays more than a ten-second drag). The par times come from driving
 * the courses (a careful driver in each stock truck; gold is about the best of them).
 */
export const MEDAL_PRIZE = { gold: 1500, silver: 800, bronze: 400 };
export const FINISH_PRIZE = 100;
export const RACE_PRIZE = [2500, 1200, 600, 300];
export const TOUCH_PENALTY = 5;              // s per hard knock in the trials
export const COUNTDOWN = 3;                  // s
export const TIME_LIMIT = 600;               // s

const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A trail event's stretch of its trail's control points, from its start on. */
function trailFrom(M, spec) {
  const pts = M.trails.find((t) => t.name === spec.trail).points;
  return pts.slice(Math.max(0, pts.findIndex((p) => p[0] === spec.from[0] && p[1] === spec.from[1])));
}

/** The courses as polylines (straight ones and trail climbs), for the world to keep puddles, boulders and trees off. */
export function courseLines(M) {
  return (M.events || []).filter((e) => e.kind !== 'slalom').map((e) => (e.kind === 'line' ? e.line : trailFrom(M, e)));
}

/** A map's slalom line (start, then the gates), along which the world beds its boulders down; or null. */
export function slalomLine(M) {
  const e = (M.events || []).find((v) => v.kind === 'slalom');
  return e ? [e.start, ...e.gates] : null;
}

/**
 * The events of a world: { id, name, desc, start: {x, z, yaw}, gates, par: {gold, silver, bronze}, touch }. A gate is
 * passed within r of its centre { x, z, r, y, dy }, or, with dir, by crossing its line { x, z, r, dir: [dx, dz] }.
 */
export function eventsFor(world) {
  const M = world.map || world.data?.map;
  // a line across a straight course (crossed going the course's way, within r of its middle)
  const linesOn = (pts, a, b, r) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return pts.map(([x, z]) => ({ x, z, r, dir: [dx / l, dz / l] })); };
  const startAt = (a, b, back = 0) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return { x: a[0] - (dx / l) * back, z: a[1] - (dz / l) * back, yaw: Math.atan2(dx, dz) };
  };
  const ev = (M?.events || []).map((spec) => {
    const { kind, line: _l, at: _a, from: _f, gap: _g, r, dy, gates: _gs, start: _s, ...rest } = spec;
    if (kind === 'trail') {
      // up the trail from one of its control points, a gate every `gap` m of trail (each only counts from the trail
      // itself, not from the switchback below it)
      const line = world.data?.trails?.find((t) => t.name === spec.trail)?.points || trailFrom(M, spec);
      const [sx, sz] = spec.from;
      let i0 = 0;
      line.forEach(([x, z], i) => { if (Math.hypot(x - sx, z - sz) < Math.hypot(line[i0][0] - sx, line[i0][1] - sz)) i0 = i; });
      const gates = [];
      let acc = 0;
      for (let i = i0 + 1; i < line.length; i++) {
        acc += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
        if (acc >= spec.gap || i === line.length - 1) {
          if (i === line.length - 1 && acc < spec.gap * 0.4 && gates.length) gates.pop();
          gates.push({ x: line[i][0], z: line[i][1], r, dy });
          acc = 0;
        }
      }
      return { ...rest, kind, start: startAt(line[i0], line[Math.min(line.length - 1, i0 + 2)]), gates, line: line.slice(i0) };
    }
    if (kind === 'line') {
      // a straight course with a run-up: line gates across it at fractions of the way (1: the finish)
      const [a, b] = spec.line;
      return { ...rest, kind, start: startAt(a, b), gates: linesOn(spec.at.map((t) => (t === 1 ? b : along(a, b, t))), a, b, r), line: [a, b] };
    }
    // a slalom of round gates
    return { ...rest, kind, start: startAt(spec.start, spec.gates[0]), gates: spec.gates.map(([x, z]) => ({ x, z, r })) };
  });
  for (const e of ev) for (const g of e.gates) g.y = world.terrain(g.x, g.z);
  return ev;
}

/** Medal for a time against the par times, or null. */
export function medalFor(event, time) {
  const p = event.par;
  return time <= p.gold ? 'gold' : time <= p.silver ? 'silver' : time <= p.bronze ? 'bronze' : null;
}

const MEDALS = [null, 'bronze', 'silver', 'gold'];
export const medalRank = (m) => Math.max(0, MEDALS.indexOf(m ?? null));

/**
 * What a finished run pays: the step up to a better medal than the driver held before (so each level is paid once:
 * bronze, then silver, then gold come to the gold prize), and a little for finishing at all.
 */
export function runPrize(event, medal, before) {
  const k = event.prize ?? 1;
  const up = medalRank(medal) > medalRank(before) ? MEDAL_PRIZE[medal] - (MEDAL_PRIZE[before] || 0) : 0;
  return { medal: Math.round(up * k), finish: Math.round(FINISH_PRIZE * k) };
}

/**
 * Where racers line up: side by side on the start line where the ground is open (firm, not steep, no water, trees or
 * boulders), else in a second row. [{ x, z, yaw }] for up to four trucks; the first is the start itself.
 */
export function gridFor(world, event) {
  const { x, z, yaw } = event.start, fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
  const ok = (px, pz) => {
    const h = world.terrain(px, pz), sl = Math.hypot(world.terrain(px + 2, pz) - world.terrain(px - 2, pz), world.terrain(px, pz + 2) - world.terrain(px, pz - 2)) / 4;
    if (sl > 0.3 || world.water(px, pz) > h - 0.1) return false;
    if (world.treesNear && world.treesNear(px, pz, 3.5, []).some((t) => Math.hypot(t.x - px, t.z - pz) < 3.5)) return false;
    return !(world.boulders || []).some((b) => Math.hypot(b.x - px, b.z - pz) < Math.max(b.rx, b.rz) + 2);
  };
  const slots = [[0, 0], [4.5, 0], [-4.5, 0], [9, 0], [-9, 0], [0, -9], [4.5, -9], [-4.5, -9], [0, -18], [4.5, -18], [-4.5, -18]];
  const out = [];
  for (const [side, back] of slots) {
    const px = x + rx * side + fx * back, pz = z + rz * side + fz * back;
    if (!out.length || ok(px, pz)) out.push({ x: px, z: pz, yaw });
    if (out.length === 4) break;
  }
  while (out.length < 4) out.push({ x: x - fx * 9 * out.length, z: z - fz * 9 * out.length, yaw });
  return out;
}

/** m:ss.s */
export function clock(t) {
  if (!Number.isFinite(t)) return '--:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/**
 * One run of an event by this truck. phase: 'countdown' -> 'running' -> 'finished' | 'out' (gave up or timed out).
 * startAt: the clock time (s) the countdown ends; update with the same clock.
 */
export class EventRun {
  constructor(event, startAt) {
    this.event = event;
    this.startAt = startAt;
    this.phase = 'countdown';
    this.gate = 0;
    this.penalty = 0;
    this.time = 0;
    this.touchAt = -1e9;
    this.splits = [];
  }

  /** Advance: now (s, the shared clock), the truck's position and how hard its body is hitting things (hullContact). */
  update(now, pos, hullContact = 0) {
    if (this.phase === 'countdown') {
      if (now >= this.startAt) this.phase = 'running';
      else return null;
    }
    if (this.phase !== 'running') return null;
    this.time = now - this.startAt + this.penalty;
    const E = this.event;
    if (E.touch && hullContact > 1 && now - this.touchAt > 1) { this.touchAt = now; this.penalty += TOUCH_PENALTY; this.time += TOUCH_PENALTY; return 'touch'; }
    const g = E.gates[this.gate];
    const ox = pos.x - g.x, oz = pos.z - g.z;
    // (a race's checkpoint also counts passed close by: near; on a corner the line can be cut)
    const through = g.dir ? (ox * g.dir[0] + oz * g.dir[1] >= 0 && Math.abs(ox * g.dir[1] - oz * g.dir[0]) < g.r) || (g.near && Math.hypot(ox, oz) < g.near) : Math.hypot(ox, oz) < g.r;
    if (through && Math.abs(pos.y - (g.y ?? pos.y)) < (g.dy ?? 12)) {
      this.splits.push(this.time);
      this.gate++;
      if (this.gate >= E.gates.length) { this.phase = 'finished'; return 'finish'; }
      return 'gate';
    }
    if (now - this.startAt > TIME_LIMIT) { this.phase = 'out'; return 'timeout'; }
    return null;
  }

  /** Seconds left in the countdown (while counting down). */
  countdown(now) { return Math.max(0, this.startAt - now); }
}

/**
 * Final places of a race: results [{ id, name, time | null (didn't finish) }] -> sorted, with place and prize (place
 * money only when there was someone to race: two or more starters).
 */
export function standings(results, event = {}) {
  const k = event.prize ?? 1;
  const done = results.filter((r) => Number.isFinite(r.time)).sort((a, b) => a.time - b.time);
  const out = results.filter((r) => !Number.isFinite(r.time));
  const n = results.length;
  return [...done.map((r, i) => ({ ...r, place: i + 1, prize: n > 1 ? Math.round((RACE_PRIZE[i] || 0) * k) : 0 })), ...out.map((r) => ({ ...r, place: null, prize: 0 }))];
}
