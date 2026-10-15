// Events: timed competitions on the valley's own ground. Each is a start line and gates to drive through in order,
// the last one the finish. Alone you race the par times for a medal; with friends in the room, whoever starts an event
// invites the others, everyone who joins lines up at the start, and the prize money goes by finishing order.
//
//   Summit Hill Climb   up the Summit Trail's switchbacks from the ford to Corrie Summit: power and grip uphill
//   Cattail Bog Dash    straight down the bog: momentum, the right line and tyres that clean themselves
//   Rock Garden Trials  tight gates zig-zagging through the boulders; every hard knock of the body costs 5 seconds
//   Sand Wash Drag      100 m flat out across the soft sand of the wash: power, and the right tyre pressure
//
// Pure logic (runs in Node for the tests): the game draws the gates, the HUD shows the run.

import { BOG, ROCK_GARDEN, SAND_STRIP, TRAILS } from '../world/MapData.js';

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

// the straight courses (start, finish)
// (the bog's length, 8 m off its middle, clear of the pond in the centre)
const BOG_LINE = (() => {
  const c = Math.cos(BOG.rot), s = Math.sin(BOG.rot), L0 = BOG.rx + 45, L1 = BOG.rx - 23, ox = BOG.x - s * 8, oz = BOG.z - c * 8;
  return [[ox - L0 * c, oz + L0 * s], [ox + L1 * c, oz - L1 * s]];
})();
const SAND_LINE = SAND_STRIP;
// the hill climb: the Summit Trail from just over the Summit Ford (its control point [-170, -10]) to the top
const SUMMIT = TRAILS.find((t) => t.name === 'Summit Trail').points, HILL_FROM = 5;
const HILL_GAP = 120;                        // m of trail between gates

// the trials: a slalom of gates up through the rock garden. Along the line between them the world beds the big boulders
// down to rocks a truck can crawl (WorldGen); the rest flank it
const TRIALS = (() => {
  const a = [ROCK_GARDEN.x - 70, ROCK_GARDEN.z + 62], b = [ROCK_GARDEN.x + 62, ROCK_GARDEN.z - 72];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l;
  const gates = [0.16, 0.32, 0.48, 0.64, 0.8].map((t, k) => { const p = along(a, b, t), o = (k % 2 ? -1 : 1) * 9; return [p[0] + nx * o, p[1] + nz * o]; });
  gates.push(b);
  const g0 = gates[0], gl = Math.hypot(g0[0] - a[0], g0[1] - a[1]);
  return { start: [a[0] - (g0[0] - a[0]) / gl * 6, a[1] - (g0[1] - a[1]) / gl * 6], gates };
})();

/** The trials line: start, then the gates. */
export function trialsLine() { return [TRIALS.start, ...TRIALS.gates]; }

/** The courses as polylines, for the world to keep puddles, boulders and trees off them (WorldGen). */
export function coursePaths() {
  return [BOG_LINE, SAND_LINE, SUMMIT.slice(HILL_FROM)];
}

/**
 * The events of a world: { id, name, desc, start: {x, z, yaw}, gates, par: {gold, silver, bronze}, touch }. A gate is
 * passed within r of its centre { x, z, r, y, dy }, or, with dir, by crossing its line { x, z, r, dir: [dx, dz] }.
 */
export function eventsFor(world) {
  const ev = [];
  // a line across a straight course (crossed going the course's way, within r of its middle)
  const linesOn = (pts, a, b, r) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return pts.map(([x, z]) => ({ x, z, r, dir: [dx / l, dz / l] })); };
  const startAt = (a, b, back = 0) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return { x: a[0] - (dx / l) * back, z: a[1] - (dz / l) * back, yaw: Math.atan2(dx, dz) };
  };

  // up the Summit Trail from just over the ford to the lookout on Corrie Summit, a gate every ~120 m of trail (each
  // only counts from the trail itself, not from the switchback below it)
  {
    const line = world.data?.trails?.find((t) => t.name === 'Summit Trail')?.points || SUMMIT;
    const [sx, sz] = SUMMIT[HILL_FROM];
    let i0 = 0;
    line.forEach(([x, z], i) => { if (Math.hypot(x - sx, z - sz) < Math.hypot(line[i0][0] - sx, line[i0][1] - sz)) i0 = i; });
    const gates = [];
    let acc = 0;
    for (let i = i0 + 1; i < line.length; i++) {
      acc += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (acc >= HILL_GAP || i === line.length - 1) {
        if (i === line.length - 1 && acc < HILL_GAP * 0.4 && gates.length) gates.pop();
        gates.push({ x: line[i][0], z: line[i][1], r: 9, dy: 5 });
        acc = 0;
      }
    }
    ev.push({
      id: 'hillclimb', name: 'Summit Hill Climb', desc: 'From the Summit Ford up the trail\'s switchbacks to the lookout on Corrie Summit: 1.3 km and 260 m of climb.',
      start: startAt(line[i0], line[Math.min(line.length - 1, i0 + 2)]), gates, par: { gold: 195, silver: 235, bronze: 290 }, prize: 1.6, trail: 'Summit Trail',
    });
  }
  // the long way down the bog, with a run-up
  {
    const [a, b] = BOG_LINE;
    ev.push({
      id: 'bogdash', name: 'Cattail Bog Dash', desc: 'A run-up, then the length of the bog, straight through the mud.',
      start: startAt(a, b), gates: linesOn([along(a, b, 0.4), along(a, b, 0.7), b], a, b, 14), par: { gold: 20.5, silver: 25, bronze: 32 }, prize: 1,
    });
  }
  // a slalom of tight gates up through the boulders
  ev.push({
    id: 'trials', name: 'Rock Garden Trials', desc: 'A slalom of tight gates up through the boulders. Each hard knock of the body: +5 s.',
    start: startAt(TRIALS.start, TRIALS.gates[0]), gates: TRIALS.gates.map(([x, z]) => ({ x, z, r: 6 })), par: { gold: 70, silver: 90, bronze: 120 }, prize: 1.2, touch: true,
  });
  // a hundred metres of soft sand down the wash's levelled floor, as sand drags are run
  {
    const [a, b] = SAND_LINE;
    ev.push({
      id: 'sanddrag', name: 'Sand Wash Drag', desc: 'A hundred metres flat out across the soft sand of the wash floor.',
      start: startAt(a, b), gates: linesOn([along(a, b, 0.5), b], a, b, 14), par: { gold: 11.5, silver: 13.5, bronze: 16 }, prize: 0.8,
    });
  }
  for (const e of ev) for (const g of e.gates) g.y = world.terrain(g.x, g.z);
  return ev;
}

/** Medal for a time against the par times, or null. */
export function medalFor(event, time) {
  const p = event.par;
  return time <= p.gold ? 'gold' : time <= p.silver ? 'silver' : time <= p.bronze ? 'bronze' : null;
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
    const through = g.dir ? ox * g.dir[0] + oz * g.dir[1] >= 0 && Math.abs(ox * g.dir[1] - oz * g.dir[0]) < g.r : Math.hypot(ox, oz) < g.r;
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
 * Final places of a race: results [{ id, name, time | null (didn't finish) }] -> sorted, with place and prize.
 */
export function standings(results) {
  const done = results.filter((r) => Number.isFinite(r.time)).sort((a, b) => a.time - b.time);
  const out = results.filter((r) => !Number.isFinite(r.time));
  const n = results.length;
  return [...done.map((r, i) => ({ ...r, place: i + 1, prize: n > 1 ? RACE_PRIZE[i] || 0 : 0 })), ...out.map((r) => ({ ...r, place: null, prize: 0 }))];
}
