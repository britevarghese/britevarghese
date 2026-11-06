// Bots as vehicle crews, the way people use them: a tank or jeep left standing in the motor pool gets taken (after
// a while, so players have first pick), a teammate climbs up behind the jeep's .50 cal, and the driver takes it to
// an objective along a route planned for the hull's width (roads preferred). The vehicle is simulated here with the
// same physics players' clients predict with (shared stepGround). The tank fights from where it stands (turret
// slewed at its drive rate, elevation for the shell's drop, a short halt to shoot at range); crews bail out of a
// vehicle that is about to brew up or is hopelessly stuck.
import { VEHICLES, stepGround, stepHeli, vehicleCollider, CRASH_MIN, groundCrashDamage, heliCrashDamage, GUN_H } from '../shared/vehicles.js';
import { EYE_HEIGHT } from '../shared/world.js';
import { zeroAngle } from '../shared/ballistics.js';
import { angleDiff, clamp } from '../shared/util.js';

const rand = (a, b) => a + Math.random() * (b - a);
export const CREW_TYPES = ['tank', 'jeep', 'bike', 'heli'];
// free width a route needs (hull half-width + a margin), metres from the centre line to the nearest obstacle
const NEED = { tank: 2.6, jeep: 1.9, bike: 1.1 };
const IDLE_MS = 20000; // a vehicle has to stand unused this long before a bot takes the controls

// ---------------------------------------------------------------- route planning
// Clearance map on the soldiers' nav grid (distance to the nearest blocked cell, chamfer 3-4), with what stops a
// hull but not a man added in: water, slopes past ~28°, the edge of the play area. Plus a road flag (drivers keep to
// roads where they can). Computed once per map (the nav grid is shared between rooms).
function vehicleMap(nav, map) {
  if (nav.veh) return nav.veh;
  const N = nav.n, cell = nav.cell, INF = 1e6, d = new Float32Array(N * N), road = new Uint8Array(N * N);
  const gh = map.groundHeight;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = nav.cx(i), z = nav.cz(j);
    let bl = nav.blocked[k] || i === 0 || j === 0 || i === N - 1 || j === N - 1;
    if (!bl && map.seaFactor && map.seaFactor(x, z) > 0.02) bl = 1;
    if (!bl && (i + j) % 2 === 0) {
      // gradient over 2 m steeper than tan 28° (the hulls climb 31°; a route shouldn't need all of it)
      if (Math.hypot(gh(x + 1, z) - gh(x - 1, z), gh(x, z + 1) - gh(x, z - 1)) > 1.06) bl = 1;
    }
    d[k] = bl ? 0 : INF;
    if (!bl && map.roadDistance && (i % 2 === 0 && j % 2 === 0)) road[k] = map.roadDistance(x, z) < 3.5 ? 1 : 0;
  }
  // two-pass chamfer distance transform (3 = one cell across, 4 = one diagonally)
  for (let j = 1; j < N; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    d[k] = Math.min(d[k], d[k - 1] + 3, d[k - N] + 3, d[k - N - 1] + 4, d[k - N + 1] + 4);
  }
  for (let j = N - 2; j >= 0; j--) for (let i = N - 2; i > 0; i--) {
    const k = j * N + i;
    d[k] = Math.min(d[k], d[k + 1] + 3, d[k + N] + 3, d[k + N + 1] + 4, d[k + N - 1] + 4);
  }
  for (let k = 0; k < d.length; k++) d[k] = (d[k] / 3) * cell; // -> metres
  nav.veh = { clear: d, road };
  return nav.veh;
}

const clearAt = (nav, M, x, z) => M.clear[nav.iz(z) * nav.n + nav.ix(x)];

// straight drive from a to b keeps the hull's width clear of everything
function lineClear(nav, M, a, b, need) {
  const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / (nav.cell * 0.9)));
  for (let s = 0; s <= n; s++) if (clearAt(nav, M, a.x + ((b.x - a.x) * s) / n, a.z + ((b.z - a.z) * s) / n) < need) return false;
  return true;
}

// A* on a lattice of every 2nd nav cell (1.5 m) where the hull fits; roads cost less, hugging walls more. A tight
// motor pool / gate the full margin doesn't fit through is tried again with less room to spare (still wider than
// the hull). Returns smoothed waypoints [{x, z}] from (sx, sz) to (tx, tz) or null.
export function vehicleRoute(g, type, sx, sz, tx, tz) {
  const need = NEED[type] || 2.2, half = VEHICLES[type]?.half[0] || 1.5;
  return route(g, sx, sz, tx, tz, need) || route(g, sx, sz, tx, tz, Math.max(half + 0.35, need - 0.6));
}

function route(g, sx, sz, tx, tz, need, maxExpand = 120000) {
  const nav = g.nav, M = vehicleMap(nav, g.map), N = nav.n, S = 2;
  const L = Math.floor(N / S), node = (i, j) => (j * S) * N + i * S;
  const ok = (i, j) => i >= 0 && j >= 0 && i < L && j < L && M.clear[node(i, j)] >= need;
  // nearest lattice node the hull fits on (the vehicle may be parked closer to a wall than a route may pass)
  const snap = (x, z) => {
    const ci = Math.round(nav.ix(x) / S), cj = Math.round(nav.iz(z) / S);
    for (let r = 0; r <= 10; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !ok(ci + di, cj + dj)) continue;
        const dd = di * di + dj * dj; if (dd < bd) { bd = dd; best = [ci + di, cj + dj]; }
      }
      if (best) return best;
    }
    return null;
  };
  const s = snap(sx, sz), t = snap(tx, tz);
  if (!s || !t) return null;
  const start = s[1] * L + s[0], goal = t[1] * L + t[0];
  const gs = new Float32Array(L * L).fill(Infinity), came = new Int32Array(L * L).fill(-1), closed = new Uint8Array(L * L);
  const hf = [], hk = []; // binary heap (f, key)
  const push = (f, k) => { hf.push(f); hk.push(k); let i = hf.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; } };
  const pop = () => {
    const top = hk[0], lf = hf.pop(), lk = hk.pop();
    if (hf.length) {
      hf[0] = lf; hk[0] = lk; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hf.length && hf[l] < hf[m]) m = l; if (r < hf.length && hf[r] < hf[m]) m = r; if (m === i) break; [hf[m], hf[i]] = [hf[i], hf[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m; }
    }
    return top;
  };
  const h = (k) => { const dx = Math.abs((k % L) - t[0]), dz = Math.abs(((k / L) | 0) - t[1]); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * 0.75; };
  gs[start] = 0; push(h(start), start);
  let expanded = 0, found = false;
  while (hf.length && expanded < maxExpand) {
    const k = pop();
    if (k === goal) { found = true; break; }
    if (closed[k]) continue;
    closed[k] = 1; expanded++;
    const ci = k % L, cj = (k / L) | 0, gk = gs[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if ((!di && !dj) || !ok(ci + di, cj + dj)) continue;
      if (di && dj && (!ok(ci + di, cj) || !ok(ci, cj + dj))) continue;
      const nn = node(ci + di, cj + dj), c = M.clear[nn];
      const step = (di && dj ? 1.414 : 1) * (M.road[nn] ? 0.75 : 1) + (c < need + 1.5 ? 0.6 : 0);
      const nk = (cj + dj) * L + ci + di, ng = gk + step;
      if (ng < gs[nk]) { gs[nk] = ng; came[nk] = k; push(ng + h(nk), nk); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) { cells.push(k); if (k === start) break; }
  cells.reverse();
  const pt = (k) => ({ x: nav.cx((k % L) * S), z: nav.cz(((k / L) | 0) * S) });
  // string pulling: straight runs wherever the hull fits (a little more room than the lattice needed)
  const out = [pt(cells[0])];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineClear(nav, M, pt(cells[anchor]), pt(cells[i]), need + 0.2)) { anchor = i - 1; out.push(pt(cells[anchor])); }
  }
  if (cells.length > 1) out.push(pt(cells[cells.length - 1]));
  return out;
}

// ---------------------------------------------------------------- taking a vehicle
const crewOf = (g, v, seat) => v.seats[seat] && g.players.get(v.seats[seat]);
const claimed = (g, v, seat, p, now) => {
  const c = v.claims?.[seat];
  if (!c || c.id === p.id || now > c.until) return false;
  const q = g.players.get(c.id);
  return !!q && q.alive && !q.vehicle;
};

// called from BotBrain.pickGoal: send the bot to a free vehicle near it (driver: a tank / jeep that has stood unused
// at least IDLE_MS; gunner: the free roof gun of a jeep a teammate is driving and that is standing still).
// Returns true when a vehicle became the goal.
export function vehicleGoal(brain) {
  const g = brain.g, p = brain.p, now = g.now();
  if (!g.vehicles || p.vehicle || brain.order || g.roundOver || now < (brain.nextVehicleTry || 0)) return false;
  brain.nextVehicleTry = now + rand(8000, 15000);
  let best = null;
  for (const v of g.vehicles.list) {
    // (not a wreck about to brew up: that's what its last crew bailed out of)
    if (v.dead || !CREW_TYPES.includes(v.type) || v.team !== p.team || v.hp < VEHICLES[v.type].hp * 0.4) continue;
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    if (!v.seats.some(Boolean)) {
      if (d > 70 || now - (v.idleSince ?? now) < IDLE_MS || Math.abs(v.speed || 0) > 0.5 || claimed(g, v, 0, p, now)) continue;
      // a player on the team close to it is probably going for it: leave it to him
      if ([...g.players.values()].some((q) => !q.bot && q.alive && !q.vehicle && q.team === p.team && Math.hypot(q.x - v.x, q.z - v.z) < 30)) continue;
      // (a bike only for a long way to go: for a flag across the map it saves a minute's run)
      if (v.type === 'bike' && (d > 40 || !g.flags.some((f) => f.owner !== p.team && Math.hypot(f.x - p.x, f.z - p.z) > 140))) continue;
      // (flying one takes a trained pilot: only the better bots go for the helicopter)
      if (v.type === 'heli' && brain.skill < 0.6) continue;
      if (Math.random() > (v.type === 'tank' ? 0.7 : v.type === 'bike' ? 0.6 : 0.5)) continue;
      if (!best || d < best.d) best = { v, seat: 0, d };
    } else if ((v.type === 'jeep' || v.type === 'heli') && !v.seats[1] && crewOf(g, v, 0)?.team === p.team) {
      if (d > 35 || Math.hypot(v.vx || 0, v.vz || 0) > 1.5 || claimed(g, v, 1, p, now)) continue;
      if (v.type === 'heli' && v.y - g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5) > 0.5) continue; // (only on the ground)
      if (!best || d < best.d) best = { v, seat: 1, d };
    }
  }
  return best ? boardGoal(brain, best.v, best.seat) : false;
}

export function boardGoal(brain, v, seat) {
  const g = brain.g, p = brain.p, now = g.now();
  const path = g.nav.findPath(p.x, p.z, v.x, v.z, undefined, p.y);
  if (!path) return false;
  (v.claims || (v.claims = []))[seat] = { id: p.id, until: now + 30000 };
  brain.goal = { x: v.x, z: v.z, vehicle: v.id, seat };
  brain.path = path; brain.pathIdx = 1;
  brain.repathAt = now + 30000;
  return true;
}

// in BotBrain.think while walking to a vehicle: get in when close. Returns true when it handled this frame.
export function boardStep(brain) {
  const g = brain.g, p = brain.p, gl = brain.goal, now = g.now();
  const v = g.vehicles?.get(gl.vehicle);
  const lost = !v || v.dead || (gl.seat === 0 ? v.seats.some(Boolean) : v.seats[1] || !v.seats[0] || Math.abs(v.speed || 0) > 2)
    || Math.hypot(v.x - gl.x, v.z - gl.z) > 6 || now > (v.claims?.[gl.seat]?.until ?? 0);
  if (lost) { if (v?.claims?.[gl.seat]?.id === p.id) v.claims[gl.seat] = null; brain.goal = null; brain.pickGoal(); return false; }
  if (Math.hypot(v.x - p.x, v.z - p.z) > VEHICLES[v.type].radius + 2.6) return false;
  g.vehicles.enter(p, v.id);
  if (!p.vehicle) return false;
  v.claims[gl.seat] = null;
  brain.crew = newCrew(now, (v.type === 'jeep' || v.type === 'heli') && p.seat === 0 ? now + rand(4000, 7000) : 0);
  brain.goal = null; brain.path = null;
  // a jeep driver / helicopter pilot calls a teammate up to the gun and waits for him (a short while if nobody comes)
  if ((v.type === 'jeep' || v.type === 'heli') && p.seat === 0 && !v.seats[1]) {
    for (const q of g.players.values()) {
      if (q === p || !q.bot || !q.alive || q.vehicle || q.team !== p.team || q.brain?.target || q.brain?.order || Math.hypot(q.x - v.x, q.z - v.z) > 40) continue;
      if (boardGoal(q.brain, v, 1)) { brain.crew.wait = now + 14000; break; }
    }
  }
  return true;
}

// ---------------------------------------------------------------- crew
const newCrew = (now, wait = 0) => ({ since: now, goal: null, route: null, idx: 0, repathAt: 0, stuckT: 0, stuck: [], backUntil: 0, back: 0, haltUntil: 0, target: null, seenAt: -1e9, aware: 0, aimErr: 0, fireAt: 0, wait });

// Brain.vehicleThink: every tick while seated
export function crewThink(brain, dt) {
  const g = brain.g, p = brain.p, now = g.now(), v = g.vehicles.get(p.vehicle);
  if (!v || v.dead) return;
  const V = VEHICLES[v.type], c = brain.crew || (brain.crew = newCrew(now));
  // bail out: about to brew up, the driver gone (gunner), hopelessly stuck
  const driverGone = p.seat !== 0 && !v.seats[0];
  if (driverGone) c.noDriver = c.noDriver || now; else c.noDriver = 0;
  if (v.type !== 'heli' && (v.hp < V.hp * 0.25 || (c.noDriver && now - c.noDriver > 2500) || c.stuck.filter((t) => now - t < 40000).length >= 4 || !CREW_TYPES.includes(v.type))) {
    g.vehicles.exit(p);
    brain.crew = null; brain.nextVehicleTry = now + 30000; brain.pickGoal();
    return;
  }
  if (v.type === 'bike') { if (p.seat === 0) ride(brain, c, v, V, dt, now); else { g.vehicles.exit(p); brain.crew = null; brain.pickGoal(); } return; }
  if (v.type === 'heli') {
    if (p.seat === 0) fly(brain, c, v, V, dt, now);
    // gunner: works the chin cannon; gets out once the helicopter is down without a pilot (not in mid-air)
    else if (c.noDriver && now - c.noDriver > 1500 && v.y - g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5) < 3) { g.vehicles.exit(p); brain.crew = null; brain.pickGoal(); }
    else if (p.seat === 1 && v.seats[0]) gun(brain, c, v, dt, now);
    return;
  }
  if (p.seat === 0) drive(brain, c, v, V, dt, now);
  else if (v.type === 'jeep' && p.seat === 1) gun(brain, c, v, dt, now);
}

// dirt bike: a fast ride to the edge of the objective, then off it and on foot. The rider has no weapon and no
// protection: anyone shooting at him, or an enemy in sight close by, and he brakes and gets off to fight.
function ride(brain, c, v, V, dt, now) {
  const g = brain.g, p = brain.p;
  if (now >= brain.nextPerceive) { brain.perceive(now); brain.nextPerceive = now + 220; }
  const threat = (brain.target && brain.visible && Math.hypot(brain.target.x - p.x, brain.target.z - p.z) < 90) || now - (p.lastHit || 0) < 800;
  const arrived = c.route && c.idx >= c.route.length;
  if ((threat || arrived) && Math.abs(v.speed) < 3) {
    g.vehicles.exit(p);
    brain.crew = null; brain.nextVehicleTry = now + 20000; brain.pickGoal();
    return;
  }
  if (threat) { step(g, v, { throttle: v.speed > 0.5 ? -1 : 0, steer: 0 }, dt, p, now); return; }
  drive(brain, c, v, V, dt, now);
}

// enemies the crew can see from the vehicle: soldiers out to ~300 m, vehicles out to ~500 m (vision blocks, optics),
// within the sight's field (turret / vehicle heading) or close around it; spotting takes a moment
function spot(brain, c, v, eye, fwd, now, dt) {
  const g = brain.g, p = brain.p;
  let best = null, bestS = Infinity;
  for (const q of g.players.values()) {
    if (!q.alive || q.air || !g.isEnemy(p, q) || now < (q.spawnProtect || 0)) continue;
    // (nothing in the enemy's HQ: nobody may go there, and a pass over it would cost the crew their lives)
    const eb = g.map.BASES?.[p.team === 1 ? 2 : 1];
    if (eb && g.restrictedHQ && Math.hypot(q.x - eb.x, q.z - eb.z) < g.restrictedHQ + 15) continue;
    const qv = q.vehicle && g.vehicles.get(q.vehicle);
    if (qv && qv.seats[0] !== q.id) continue; // a vehicle counts once (its driver)
    // a helicopter in flight is no target for a tank gun or unguided rockets — only one hovering low and slow
    if (qv?.type === 'heli' && (Math.hypot(qv.vx || 0, qv.vz || 0) > 8 || qv.y - g.world.supportHeight(qv.x, qv.z, qv.y + 0.5, 1.5) > 35)) continue;
    const tx = qv ? qv.x : q.x, tz = qv ? qv.z : q.z, d = Math.hypot(tx - eye.x, tz - eye.z);
    if (d > (qv ? 500 : 300) * (0.8 + brain.skill * 0.3)) continue;
    const off = Math.abs(angleDiff(fwd, Math.atan2(-(tx - eye.x), -(tz - eye.z))));
    if (off > 1.1 && d > 40 && q !== c.target) continue;
    const ty = qv ? qv.y + VEHICLES[qv.type].half[1] : q.y + (q.stance === 'prone' ? 0.3 : q.stance === 'crouch' ? 0.9 : 1.3);
    if (!g.world.lineOfSight(eye, { x: tx, y: ty, z: tz })) continue;
    // armour first (it is the threat to a tank), then the nearest
    const s = d * (qv ? (qv.type === 'tank' ? 0.25 : 0.5) : 1);
    if (s < bestS) { bestS = s; best = { q, qv, x: tx, y: ty, z: tz, d }; }
  }
  if (best && best.q === c.target?.q) { c.target = best; c.seenAt = now; return best; }
  if (best) {
    // a new contact registers over ~0.4-1.5 s (sooner for a vehicle, a target close by, a skilled crew)
    // (a man-sized figure through vision blocks takes far longer to pick out than a vehicle)
    c.aware = (c.candidate === best.q ? c.aware : 0) + dt * (best.qv ? 1.8 : 0.7) * (0.6 + brain.skill) / (0.4 + best.d / (best.qv ? 250 : 120));
    c.candidate = best.q;
    if (c.aware >= 1) {
      c.target = best; c.seenAt = now; c.aware = 0;
      c.fireAt = now + rand(800, 1800) * (1.6 - brain.skill);
      c.aimErr = rand(-1, 1) * (best.qv ? 0.008 : 0.018 + (1 - brain.skill) * 0.025);
    }
  }
  if (c.target && (now - c.seenAt > 4000 || !c.target.q.alive)) c.target = null;
  return c.target && now - c.seenAt < 300 ? c.target : null;
}

// pick where to drive: the best flag (as soldiers score it); a tank stops short of it in overwatch, a jeep drives
// into the capture zone, a bike to its edge (the rider goes the rest of the way on foot)
function pickDriveGoal(brain, c, v, now) {
  const g = brain.g, p = brain.p;
  const scored = g.flags.map((f) => {
    const d = Math.hypot(f.x - v.x, f.z - v.z);
    let s = -d * 0.015;
    if (f.owner !== p.team) s += 3; else if (f.contested) s += 2.5; else s -= 2;
    return { f, s: s + rand(0, 1.5) };
  }).sort((a, b) => b.s - a.s);
  const f = scored[0]?.f;
  if (!f) return;
  // (a helicopter flies straight there: no route on the ground)
  if (v.type === 'heli') { c.goal = { x: f.x, z: f.z, flag: f.id }; c.route = null; c.repathAt = now + rand(25000, 40000); c.arrivedAt = 0; return; }
  const nav = g.nav, M = vehicleMap(nav, g.map), need = NEED[v.type];
  let goal = null;
  for (let tries = 0; tries < 24 && !goal; tries++) {
    const toV = Math.atan2(v.x - f.x, v.z - f.z) + rand(-0.9, 0.9);
    const r = v.type === 'tank' ? f.r + rand(15, 45) : v.type === 'bike' ? f.r + rand(5, 20) : rand(0, f.r * 0.7);
    const x = f.x + Math.sin(toV) * r, z = f.z + Math.cos(toV) * r;
    if (Math.abs(x) < g.map.PLAY_HALF - 8 && Math.abs(z) < g.map.PLAY_HALF - 8 && clearAt(nav, M, x, z) >= need + 0.5) goal = { x, z };
  }
  if (!goal) goal = { x: f.x, z: f.z };
  c.goal = { ...goal, flag: f.id };
  c.route = vehicleRoute(g, v.type, v.x, v.z, goal.x, goal.z);
  c.idx = 1;
  c.repathAt = now + rand(25000, 40000);
  c.arrivedAt = 0;
}

function drive(brain, c, v, V, dt, now) {
  const g = brain.g, p = brain.p, tank = v.type === 'tank';
  const eye = { x: v.x, y: v.y + (tank ? 3.1 : 1.9), z: v.z };
  const input = { throttle: 0, steer: 0 };
  // ---- weapons (the tank's driver seat works the main gun)
  const fwd = tank ? v.turretYaw : v.yaw;
  const t = tank ? spot(brain, c, v, eye, fwd, now, dt) : null;
  if (tank) {
    if (t) {
      const W = V.weapons[0], gun = { x: v.x - Math.sin(v.turretYaw) * 1.9, y: v.y + GUN_H, z: v.z - Math.cos(v.turretYaw) * 1.9 };
      const tv = t.qv || t.q, d = Math.hypot(t.x - gun.x, t.z - gun.z), lead = d / W.velocity;
      const ax = t.x + (tv.vx || 0) * lead, az = t.z + (tv.vz || 0) * lead;
      const yaw = Math.atan2(-(ax - gun.x), -(az - gun.z)) + c.aimErr;
      const pitch = Math.atan2(t.y - gun.y, d) + zeroAngle(W, clamp(Math.round(d / 10) * 10, 10, W.maxRange * 0.9)) + c.aimErr * 0.4;
      input.aimYaw = yaw; input.aimPitch = pitch;
      c.aimErr *= Math.exp(-dt * (0.6 + brain.skill * 1.2));
      // splash: never with friendlies around the target
      const mates = [...g.players.values()].some((q) => q !== p && q.alive && !g.isEnemy(p, q) && Math.hypot(q.x - t.x, q.z - t.z) < 9);
      const laid = Math.abs(angleDiff(v.turretYaw, yaw)) < 0.006 + 1.2 / Math.max(d, 10) && Math.abs(v.gunPitch - clamp(pitch, V.gunPitch[0], V.gunPitch[1])) < 0.012;
      if (laid && !mates && now > c.fireAt && now >= v.reloadUntil[0] && now >= v.nextShot[0] && d > 12) {
        g.vehicles.fire(p, {});
        // the gunner corrects from the fall of the shot: the next round lands closer (walked onto the target);
        // against infantry the crew watches the strike before the next round
        c.aimErr = c.aimErr * rand(0.4, 0.8) + rand(-1, 1) * (t.qv ? 0.003 : 0.008 + (1 - brain.skill) * 0.01);
        c.fireAt = now + (t.qv ? rand(200, 900) : rand(3000, 6000));
      }
      // a short halt to shoot at range: a moving tank's first round rarely hits
      if (d > 90 && !c.haltUntil) c.haltUntil = now + rand(5000, 9000);
    } else {
      // no target: the turret faces the way the tank is going, then scans
      input.aimYaw = v.yaw + Math.sin(now / 2600 + p.id) * 0.6; input.aimPitch = 0;
      if (now - c.seenAt > 3000) c.haltUntil = 0;
    }
    p.yaw = v.turretYaw; p.pitch = v.gunPitch;
  } else p.yaw = v.yaw;
  // ---- where to
  if (c.wait && now < c.wait && !v.seats[1] && (!v.claims?.[1] || now < v.claims[1].until)) { step(g, v, input, dt, p, now); return; }
  c.wait = 0;
  const flag = c.goal && g.flags.find((f) => f.id === c.goal.flag);
  const taken = flag && flag.owner === p.team && !flag.contested && Math.abs(flag.progress) >= 1;
  if (!c.goal || now > c.repathAt || (taken && c.arrivedAt && now - c.arrivedAt > 8000) || (!c.route && now > (c.retryAt || 0))) {
    pickDriveGoal(brain, c, v, now);
    if (!c.route) c.retryAt = now + 5000;
  }
  const R = c.route;
  if (!R || c.idx >= R.length || (c.haltUntil && now < c.haltUntil)) {
    if (R && c.idx >= R.length && !c.arrivedAt) c.arrivedAt = now;
    // parked: hold the brakes (and the gunner's platform)
    input.throttle = Math.abs(v.speed) > 0.5 ? -Math.sign(v.speed) * 0.6 : 0;
    step(g, v, input, dt, p, now);
    return;
  }
  // ---- pure pursuit along the route: a point a little ahead on the path, slower into bends and at the end
  const look = 5 + Math.abs(v.speed) * 0.7;
  while (c.idx < R.length - 1 && Math.hypot(R[c.idx].x - v.x, R[c.idx].z - v.z) < look) c.idx++;
  const wp = R[c.idx], dWp = Math.hypot(wp.x - v.x, wp.z - v.z);
  if (c.idx === R.length - 1 && dWp < (tank ? 4 : 3)) c.idx++;
  const want = Math.atan2(-(wp.x - v.x), -(wp.z - v.z)), err = angleDiff(v.yaw, want);
  let remain = dWp;
  for (let i = c.idx; i < R.length - 1; i++) remain += Math.hypot(R[i + 1].x - R[i].x, R[i + 1].z - R[i].z);
  // the bend ahead (angle between the next two legs)
  let bend = 0;
  if (c.idx < R.length - 1) bend = Math.abs(angleDiff(Math.atan2(-(R[c.idx + 1].x - wp.x), -(R[c.idx + 1].z - wp.z)), want));
  const cruise = (tank ? 0.85 : 0.7) * V.maxSpeed;
  let vt = Math.min(cruise, 3 + remain * 0.6, dWp < 15 ? cruise * (1 - Math.min(0.7, bend / 2)) : cruise);
  if (!tank && v.seats[1] && c.gunnerBusy && now - c.gunnerBusy < 1500) vt = Math.min(vt, 7); // a steadier gun platform
  // a teammate on foot in the way: stop for him
  for (const q of g.players.values()) {
    if (q === p || !q.alive || q.vehicle || g.isEnemy(p, q)) continue;
    const dx = q.x - v.x, dz = q.z - v.z, dq = Math.hypot(dx, dz);
    if (dq < 9 + Math.abs(v.speed) * 0.5 && Math.abs(angleDiff(v.yaw, Math.atan2(-dx, -dz))) < 0.5) vt = 0;
  }
  if (now < c.backUntil) {
    // backing out after getting stuck, wheels / tracks the other way
    input.throttle = -0.7; input.steer = c.back;
  } else if (Math.abs(err) > (tank ? 1.0 : 1.6)) {
    // the way on is well behind: a tank pivots on its tracks, a jeep makes a three-point turn
    if (tank) { input.throttle = 0.15; input.steer = Math.sign(err); }
    else { input.throttle = v.speed > 3 ? -1 : -0.6; input.steer = -Math.sign(err); }
  } else {
    input.steer = clamp(err * (tank ? 2.5 : 1.8), -1, 1);
    const sp = Math.max(0, v.speed);
    input.throttle = vt <= 0.1 ? (sp > 0.5 ? -0.8 : 0) : sp < vt - 0.5 ? clamp((vt - sp) / 3, 0.35, 1) : sp > vt + 1.5 ? -0.5 : 0.25;
    if (tank && Math.abs(err) > 0.5) input.throttle = Math.min(input.throttle, 0.4); // skid turns bleed speed
  }
  // stuck: throttle on, going nowhere -> back off a few metres the other way and plan again
  const moving = Math.abs(v.speed) > 0.6;
  c.stuckT = Math.abs(input.throttle) > 0.3 && !moving && now >= c.backUntil ? (c.stuckT || 0) + dt : 0;
  if (c.stuckT > 1.6) {
    c.stuckT = 0; c.stuck.push(now);
    c.back = -Math.sign(err || 1) * (tank ? 0.6 : 1); c.backUntil = now + rand(1400, 2200);
    c.repathAt = now + 2500;
  }
  step(g, v, input, dt, p, now);
}

// ---------------------------------------------------------------- helicopter pilot
// Takes off straight up, transits ~40 m above the highest ground / roofs ahead, and makes rocket runs on what it
// spots: down to ~25 m, nose on the target (the pods fire along the nose; elevation for the rockets' drop), a salvo
// once laid, then breaks off — nose up, a hard turn away, out a few hundred metres — and comes round again. Badly hit
// (below 35 %) it flies home, lands on the pad and the pilot gets out. Altitude is held with the collective the way
// the players' pilot assist does it.
const HELI = { cruise: 38, attack: 26, cruiseSpeed: 38, runIn: 18 };
function clearanceAhead(g, v, dir, dist) {
  let top = -Infinity;
  const was = g.world.ignoreOwner; g.world.ignoreOwner = v.id; // (not its own airframe)
  for (let s = 0; s <= dist; s += 15) top = Math.max(top, g.world.supportHeight(v.x - Math.sin(dir) * s, v.z - Math.cos(dir) * s, 500, 2));
  g.world.ignoreOwner = was;
  return top;
}

function fly(brain, c, v, V, dt, now) {
  const g = brain.g, p = brain.p, H = c.heli || (c.heli = { phase: 'takeoff', since: now, salvo: 0 });
  const ground = g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5), agl = v.y - ground;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), vf = v.vx * fx + v.vz * fz, vs = v.vx * Math.cos(v.yaw) - v.vz * Math.sin(v.yaw);
  let wantYaw = v.yaw, wantAlt = ground + HELI.cruise, wantSpeed = 0, pitchSet = null;
  const home = v.home, toHome = Math.hypot(home.x - v.x, home.z - v.z);
  if (v.hp < V.hp * 0.35 && H.phase !== 'land') H.phase = toHome < 25 ? 'land' : 'rtb';
  const eye = { x: v.x, y: v.y + 1.6, z: v.z };
  const t = H.phase === 'rtb' || H.phase === 'land' || H.phase === 'takeoff' ? null : spot(brain, c, v, eye, v.yaw, now, dt);
  p.yaw = v.yaw;
  if (H.phase === 'takeoff' && c.wait && now < c.wait && !v.seats[1] && (!v.claims?.[1] || now < v.claims[1].until)) {
    // on the pad, rotor turning, waiting for the gunner called up
    v.lastInput = now; v.lastDriver = p.id; v.rest = false;
    stepHeli(g.world, v, { collective: -0.3, pitch: 0, roll: 0, yawRate: 0, power: 1 }, dt);
    if (v.col && !v.dead) vehicleCollider(v, v.col);
    return;
  }
  if (H.phase === 'takeoff') {
    c.wait = 0;
    // straight up off the pad, clear of the trees and hangars
    wantAlt = ground + 22; wantSpeed = 0;
    if (agl > 18) H.phase = 'transit';
  } else if (H.phase === 'rtb' || H.phase === 'land') {
    wantYaw = Math.atan2(-(home.x - v.x), -(home.z - v.z));
    if (H.phase === 'rtb') { wantSpeed = Math.min(HELI.cruiseSpeed, toHome * 0.4); wantAlt = Math.max(ground, clearanceAhead(g, v, wantYaw, 90)) + 30; if (toHome < 25) H.phase = 'land'; }
    else {
      // over the pad: no turning now — slide onto it with the disc (pitch / roll), wings level, and let down only
      // when slow and above it, gently near the ground (a banked or sliding touchdown wrecks the undercarriage)
      if (v.landed && Math.hypot(v.vx, v.vz) < 1) { g.vehicles.exit(p); brain.crew = null; brain.nextVehicleTry = now + 60000; brain.pickGoal(); return; }
      const k = Math.min(1, 6 / Math.max(1e-3, toHome * 0.4)), wx = (home.x - v.x) * 0.4 * k, wz = (home.z - v.z) * 0.4 * k;
      const ex = wx - v.vx, ez = wz - v.vz, rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
      const eF = ex * fx + ez * fz, eS = ex * rx + ez * rz, hs = Math.hypot(v.vx, v.vz);
      H.land = { pitch: clamp(eF * 0.12, -0.5, 0.5), roll: clamp(eS * 0.12, -0.35, 0.35) };
      H.vyWant = toHome < 5 && hs < 2 ? -Math.min(5, 1 + 0.3 * Math.max(0, agl)) : agl < 8 ? 0.5 : 0;
      wantYaw = v.yaw;
    }
  } else if (t && (H.phase === 'transit' || H.phase === 'attack')) {
    H.phase = 'attack';
    const d = Math.hypot(t.x - v.x, t.z - v.z);
    const toT = Math.atan2(-(t.x - v.x), -(t.z - v.z));
    wantYaw = toT;
    if (d > 450) { wantSpeed = HELI.cruiseSpeed; wantAlt = Math.max(ground, clearanceAhead(g, v, toT, 90)) + HELI.cruise; }
    else {
      // the run in: low, slower, nose on the target — elevation for the rockets' sag (a quarter of gravity)
      const W = V.weapons[0], tv = t.qv || t.q, tf = d / W.velocity;
      const ax = t.x + (tv.vx || 0) * tf, az = t.z + (tv.vz || 0) * tf;
      wantYaw = Math.atan2(-(ax - v.x), -(az - v.z));
      wantAlt = Math.max(ground, clearanceAhead(g, v, toT, Math.min(d, 90))) + HELI.attack;
      const drop = 0.5 * 9.81 * (W.gravityScale ?? 1) * tf * tf;
      const pv = Math.atan2(t.y + drop - (v.y + 0.85), d);      // rocket direction wanted (+ up)
      pitchSet = clamp(-pv - 0.03, -0.3, V.pitchMax);              // airframe pitch (+ nose down) that points the pods there
      const yawOk = Math.abs(angleDiff(v.yaw, wantYaw)) < 0.02 + 2 / d, pitchOk = Math.abs((v.pitch || 0) - pitchSet) < 0.03;
      const mates = [...g.players.values()].some((q) => q !== p && q.alive && !g.isEnemy(p, q) && Math.hypot(q.x - t.x, q.z - t.z) < 10);
      if (yawOk && pitchOk && !mates && d > 120 && now >= v.reloadUntil[0] && now >= v.nextShot[0] && now > c.fireAt) {
        g.vehicles.fire(p, {}); H.salvo++;
      }
      if (d < 140 || H.salvo >= (t.qv ? 8 : 4)) { H.phase = 'breakoff'; H.since = now; H.salvo = 0; H.away = toT + Math.PI + (Math.random() < 0.5 ? -0.6 : 0.6); }
    }
  } else if (H.phase === 'breakoff') {
    // pull out of the run: climb, turn hard away, open the range, then come back round
    wantYaw = H.away; wantSpeed = HELI.cruiseSpeed; wantAlt = Math.max(ground, clearanceAhead(g, v, wantYaw, 90)) + HELI.cruise + 6;
    if (now - H.since > 9000) H.phase = 'transit';
  } else {
    // transit / patrol: over the objective the bots are fighting for, circling it
    if (!c.goal || now > c.repathAt) pickDriveGoal(brain, c, v, now);
    const gx = c.goal?.x ?? v.x, gz = c.goal?.z ?? v.z, dg = Math.hypot(gx - v.x, gz - v.z);
    wantYaw = dg > 120 ? Math.atan2(-(gx - v.x), -(gz - v.z)) : Math.atan2(-(gx - v.x), -(gz - v.z)) + 1.2; // orbit
    wantSpeed = dg > 120 ? HELI.cruiseSpeed : 22;
    wantAlt = Math.max(ground, clearanceAhead(g, v, wantYaw, 120)) + HELI.cruise;
    if (H.phase !== 'transit') H.phase = 'transit';
  }
  // keep inside the play area (the airspace beyond it kills the airframe) and out of the enemy's HQ (no-go: the crew
  // would be hit after a few seconds over it)
  const lim = g.map.PLAY_HALF - 25;
  if (Math.abs(v.x) > lim || Math.abs(v.z) > lim) { wantYaw = Math.atan2(v.x, v.z); wantSpeed = Math.max(wantSpeed, 25); }
  const eb = g.map.BASES?.[p.team === 1 ? 2 : 1];
  if (eb && g.restrictedHQ && Math.hypot(v.x - eb.x, v.z - eb.z) < g.restrictedHQ + 40) { wantYaw = Math.atan2(-(v.x - eb.x), -(v.z - eb.z)); /* (heading straight away from it) */ wantSpeed = Math.max(wantSpeed, 25); if (H.phase === 'attack') { H.phase = 'breakoff'; H.since = now; H.away = wantYaw; } }
  // ---- controls: heading by yaw rate, speed by pitch (nose down accelerates), sideslip by roll, height by collective
  const yawErr = angleDiff(v.yaw, wantYaw);
  const yawRate = clamp(yawErr * 2.2, -1, 1);
  let pitch = pitchSet != null ? pitchSet / V.pitchMax : clamp((wantSpeed - vf) * 0.06, -0.8, 0.9);
  if (Math.abs(yawErr) > 1.2 && pitchSet == null) pitch = Math.min(pitch, 0.15); // turn first, then go
  let roll = clamp(-vs * 0.08 + yawErr * 0.25, -0.6, 0.6);
  if (H.phase === 'land' && H.land) { pitch = H.land.pitch; roll = H.land.roll; }
  const vyWant = H.phase === 'land' ? H.vyWant ?? 0 : clamp((wantAlt - v.y) * 0.45, -6, 6);
  const tilt = Math.max(0.5, Math.cos(v.pitch || 0) * Math.cos(v.roll || 0)), level = (1 / tilt - 1) / 0.75;
  const collective = level + (vyWant * 0.6) / (0.75 * 9.81) + clamp((vyWant - (v.vy || 0)) * 0.5, -0.9, 0.9);
  v.lastInput = now; v.lastDriver = p.id; v.rest = false;
  stepHeli(g.world, v, { collective, pitch: clamp(pitch, -1, 1), roll, yawRate, power: 1 }, dt);
  if (v.impact > 6) g.vehicles.damage(v, heliCrashDamage(Math.min(40, v.impact)), v.lastDamager ? g.players.get(v.lastDamager) : null, 'crash', 'crash');
  if (v.col && !v.dead) vehicleCollider(v, v.col);
}

// the vehicle moves here (the server is the bot's client): same physics as a player's prediction
function step(g, v, input, dt, p, now) {
  v.lastInput = now; v.lastDriver = p.id; v.rest = false;
  stepGround(g.world, v, input, dt, v.type);
  if (v.impact > CRASH_MIN) g.vehicles.damage(v, groundCrashDamage(Math.min(40, v.impact)), null, 'crash', 'crash');
  if (v.col && !v.dead) vehicleCollider(v, v.col);
}

// jeep roof gunner: the soldier's own eyes (standing in the ring), the .50 cal in bursts
function gun(brain, c, v, dt, now) {
  const g = brain.g, p = brain.p, W = VEHICLES[v.type].weapons[1], heli = v.type === 'heli';
  if (now >= brain.nextPerceive) { brain.perceive(now); brain.nextPerceive = now + 220; }
  const t = brain.visible && brain.target;
  const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance || 'stand'], z: p.z };
  if (t) {
    const d = Math.hypot(t.x - eye.x, t.z - eye.z), lead = d / W.velocity;
    const aimY = t.y + (t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.95 : 1.3);
    const dx = t.x + (t.vx || 0) * lead - eye.x, dz = t.z + (t.vz || 0) * lead - eye.z;
    const yaw = Math.atan2(-dx, -dz) + brain.aimErr.yaw, pitch = Math.atan2(aimY - eye.y, d) + brain.aimErr.pitch + zeroAngle(W, clamp(Math.round(d / 10) * 10, 10, 900));
    const conv = Math.exp(-dt * (1 + brain.skill * 2));
    brain.aimErr.yaw *= conv; brain.aimErr.pitch *= conv;
    brain.turn(yaw, pitch, dt, 1.1);
    const veh = g.vehicles.get(v.id);
    const vs = veh.seats[0] && g.players.get(veh.seats[0])?.brain?.crew;
    if (vs) vs.gunnerBusy = now;
    const aimed = Math.abs(angleDiff(p.yaw, yaw - brain.aimErr.yaw)) < 0.05 + 0.8 / Math.max(d, 4);
    if (aimed && now > brain.reactUntil && now > brain.burstPauseUntil && d < (heli ? 700 : 400) && now >= v.reloadUntil[1] && now >= v.nextShot[1]) {
      if (brain.burstLeft <= 0) brain.burstLeft = Math.round(d > 150 ? rand(4, 7) : rand(6, 12));
      // ring mount: ~0.35° plus the vehicle's motion; the helicopter's turret is stabilised but the airframe shakes
      const moving = Math.hypot(v.vx || 0, v.vz || 0) > 2;
      const spread = ((heli ? 0.5 : 0.35) + (moving ? (heli ? 0.4 : 0.8) : 0)) * (Math.PI / 180) * (1.5 - brain.skill * 0.6);
      const cp = Math.cos(p.pitch);
      g.vehicles.fire(p, { d: [-Math.sin(p.yaw) * cp + rand(-spread, spread), Math.sin(p.pitch) + rand(-spread, spread), -Math.cos(p.yaw) * cp + rand(-spread, spread)] });
      brain.lastShotAt = now;
      if (--brain.burstLeft <= 0) brain.burstPauseUntil = now + rand(400, 1000);
    }
  } else {
    // scanning: sweep the arc ahead / to the flanks (from the helicopter: looking down onto the ground)
    brain.turn(v.yaw + Math.sin(now / 2100 + p.id) * 1.4, heli ? -0.35 : -0.02, dt, 0.5);
  }
  // the ring follows the gunner (what a player's client sends as its aim)
  if (!heli) { v.turretYaw = p.yaw; v.gunPitch = clamp(p.pitch, -0.9, 0.7); }
  (v.aim || (v.aim = []))[1] = { yaw: p.yaw, pitch: clamp(p.pitch, -1.2, 0.8) };
}
