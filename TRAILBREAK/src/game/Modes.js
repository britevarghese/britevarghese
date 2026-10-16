// Party modes, as in Off-Road League, for a room of friends (or alone): ELIMINATION and KING OF THE HILL. They run on
// the events' machinery (game/EventPlay.js: a start, J, friends joining within the race lead, the shared clock, results
// and prize money), each with its own kind of run in place of the gates:
//
//   Elimination   everyone starts in the middle of a wide circle (the map's arena) that holds, then shrinks, again and
//                 again, to a point: outside it the truck takes damage (a tenth of its health a second), and at none it
//                 is out. The circles come from the match's start time (every truck in the room works out the same
//                 ones), each next one inside the last around a point on a trail, where trucks can follow. The last
//                 truck in wins; alone, it is how long you last (higher is better).
//   King of the   a zone on a rise a drive from the start: time in it counts only while nobody else is in it. First to
//   Hill          HOLD seconds wins; alone, how soon you get there and hold it (lower is better).
//
// Pure logic: runs in Node for the tests.

export const DRAIN = 10;                         // health a second outside the zone (of 100)
export const HOLD = 45;                          // s of the hill to win
const RADII = [260, 175, 115, 70, 38, 16, 0];    // m: the zone's circles
const WAIT = [28, 22, 20, 18, 16, 14];           // s each circle holds before it shrinks
const SHRINK = [24, 20, 18, 15, 12, 10];         // s it takes to shrink to the next
export const ZONE_TIME = WAIT.reduce((a, b) => a + b, 0) + SHRINK.reduce((a, b) => a + b, 0);
const HILL_LIMIT = 600;                          // s

/** mulberry32: a small seeded generator (the same circles on every machine in the room). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The circles of an elimination match: [{ wait: [t, t], t0, t1, x0, z0, r0, x1, z1, r1 }]: it holds (x0, z0, r0) until
 * t0 (s from the start), then shrinks to (x1, z1, r1) by t1. Each next centre is a trail point inside the last circle,
 * far enough in for the new circle to fit inside it.
 */
export function zoneSchedule(trails, center, seed) {
  const R = rng(seed);
  const pts = trails.flatMap((t) => t.points);
  let x = center.x, z = center.z, t = 0;
  const out = [];
  for (let i = 0; i < RADII.length - 1; i++) {
    const r0 = RADII[i], r1 = RADII[i + 1];
    const cand = pts.filter(([px, pz]) => Math.hypot(px - x, pz - z) <= (r0 - r1) * 0.9);
    const [nx, nz] = cand.length ? cand[Math.floor(R() * cand.length)] : [x, z];
    out.push({ wait: [t, t + WAIT[i]], t0: t + WAIT[i], t1: t + WAIT[i] + SHRINK[i], x0: x, z0: z, r0, x1: nx, z1: nz, r1 });
    t += WAIT[i] + SHRINK[i]; x = nx; z = nz;
  }
  return out;
}

/**
 * The zone at t (s from the start): { x, z, r, next: { x, z, r } (where it is going), shrinking, left (s until it
 * starts or stops shrinking), stage }.
 */
export function zoneAt(schedule, t) {
  for (let i = 0; i < schedule.length; i++) {
    const S = schedule[i];
    if (t < S.t0) return { x: S.x0, z: S.z0, r: S.r0, next: { x: S.x1, z: S.z1, r: S.r1 }, shrinking: false, left: S.t0 - t, stage: i };
    if (t < S.t1) {
      const k = (t - S.t0) / (S.t1 - S.t0);
      return { x: S.x0 + (S.x1 - S.x0) * k, z: S.z0 + (S.z1 - S.z0) * k, r: S.r0 + (S.r1 - S.r0) * k, next: { x: S.x1, z: S.z1, r: S.r1 }, shrinking: true, left: S.t1 - t, stage: i };
    }
  }
  const L = schedule.at(-1);
  return { x: L.x1, z: L.z1, r: L.r1, next: { x: L.x1, z: L.z1, r: L.r1 }, shrinking: false, left: 0, stage: schedule.length };
}

/** The modes of a world, as events: an elimination arena and a hill, from the map's `modes` (world/maps/). */
export function modesFor(world) {
  const M = world.map || world.data?.map, m = M?.modes;
  if (!m) return [];
  const yawTo = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const out = [];
  if (m.arena) {
    const A = m.arena;
    out.push({ id: 'elimination', kind: 'zone', mode: true, name: 'Elimination', higher: true,
      desc: 'Stay inside the circle as it shrinks, again and again, to nothing: outside it your truck takes damage. The last truck in wins; alone, last as long as you can.',
      start: { x: A.x, z: A.z, yaw: A.yaw ?? 0 }, center: { x: A.x, z: A.z }, gates: [],
      par: { gold: ZONE_TIME, silver: ZONE_TIME - 45, bronze: ZONE_TIME - 100 }, prize: 1.6 });
  }
  if (m.hill) {
    const H = m.hill, S = m.hillStart;
    out.push({ id: 'kingofhill', kind: 'hill', mode: true, name: 'King of the Hill',
      desc: `Get to ${H.name} first and hold it: ${HOLD} s inside its ring with nobody else in it wins. Push them out!`,
      start: { x: S[0], z: S[1], yaw: yawTo(S, [H.x, H.z]) }, hill: { x: H.x, z: H.z, r: H.r ?? 16, y: world.terrain(H.x, H.z), name: H.name }, gates: [],
      par: m.hillPar || { gold: 100, silver: 130, bronze: 170 }, prize: 1.4 });
  }
  return out;
}

/** An elimination match for one truck: the zone, its health, out at none. phase: 'countdown' -> 'running' -> 'finished'. */
export class ZoneRun {
  constructor(event, startAt, trails, seed) {
    this.event = event;
    this.startAt = startAt;
    this.phase = 'countdown';
    this.time = 0;
    this.health = 100;
    this.gate = 0; this.penalty = 0; this.splits = [];
    this.schedule = zoneSchedule(trails, event.center, seed);
    this.zone = zoneAt(this.schedule, 0);
    this.outside = false;
    this.last = null;
  }

  update(now, pos) {
    if (this.phase === 'countdown') {
      if (now >= this.startAt) this.phase = 'running';
      else return null;
    }
    if (this.phase !== 'running') return null;
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    this.time = now - this.startAt;
    this.zone = zoneAt(this.schedule, this.time);
    this.outside = Math.hypot(pos.x - this.zone.x, pos.z - this.zone.z) > this.zone.r;
    if (this.outside) this.health = Math.max(0, this.health - DRAIN * dt);
    if (this.health <= 0) { this.phase = 'finished'; this.out = true; return 'finish'; }
    return null;
  }

  countdown(now) { return Math.max(0, this.startAt - now); }
}

/** King of the hill for one truck: time held (alone in the ring), to HOLD. others: the other trucks' positions. */
export class HillRun {
  constructor(event, startAt) {
    this.event = event;
    this.startAt = startAt;
    this.phase = 'countdown';
    this.time = 0;
    this.held = 0;
    this.inside = false; this.contested = false;
    this.gate = 0; this.penalty = 0; this.splits = [];
    this.last = null;
  }

  update(now, pos, _knock, others = []) {
    if (this.phase === 'countdown') {
      if (now >= this.startAt) this.phase = 'running';
      else return null;
    }
    if (this.phase !== 'running') return null;
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    this.time = now - this.startAt;
    const H = this.event.hill, inRing = (p) => Math.hypot(p.x - H.x, p.z - H.z) < H.r && Math.abs(p.y - H.y) < 8;
    this.inside = inRing(pos);
    this.contested = this.inside && others.some(inRing);
    if (this.inside && !this.contested) this.held += dt;
    if (this.held >= HOLD) { this.held = HOLD; this.phase = 'finished'; return 'finish'; }
    if (this.time > HILL_LIMIT) { this.phase = 'out'; return 'timeout'; }
    return null;
  }

  /** Where this truck stands if the match ends now (someone else held the hill): its time plus what it still needed. */
  standing() { return this.time + (HOLD - this.held); }

  countdown(now) { return Math.max(0, this.startAt - now); }
}
