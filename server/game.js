// Authoritative Conquest game simulation.
import { CollisionWorld, stepCharacter, EYE_HEIGHT, STANCE_HEIGHT, MOVE, SAFE_FALL, FALL_DMG } from '../shared/world.js';
import { TEAM_NAMES, getMap } from '../shared/map.js';
import { WEAPONS, CLASSES, GRENADE, damageAt, hitCapsules, rayCapsule, armourAspect } from '../shared/weapons.js';
import { NavGrid } from './nav.js';
import { stepAir } from '../shared/royale.js';
import { bulletPath, STEP } from '../shared/ballistics.js';
import { BotBrain } from './bots.js';
import { VehicleSystem } from './vehicles.js';
import { angleDiff } from '../shared/util.js';
import { SQUAD_SIZE, SQUAD_SAFE_MS, SQUAD_ENEMY_R } from '../shared/squads.js';
import { VEHICLES } from '../shared/vehicles.js';

export const TICK_HZ = 30;

// a bot name nobody in the room has yet (two "[BOT] Okafor" on opposite sides make the kill feed unreadable);
// once the list runs out, numbered ("[BOT] Reyes 2")
export function botName(players, names) {
  const used = new Set([...players.values()].map((p) => p.name));
  const free = names.filter((n) => !used.has(`[BOT] ${n}`));
  if (free.length) return `[BOT] ${free[Math.floor(Math.random() * free.length)]}`;
  for (let k = 2; ; k++) { const n = `[BOT] ${names[Math.floor(Math.random() * names.length)]} ${k}`; if (!used.has(n)) return n; }
}
export const SNAP_HZ = 20;
const START_TICKETS = 300;
const RESPAWN_DELAY = 5;
// wounded, not killed: a soldier taken down by body hits (not a head shot, not blown apart, not a fall / run-over /
// vehicle death) lies incapacitated and bleeds out over BLEED_MS; a medic beside him can bring him round in
// REVIVE_MS (he gets up where he fell with REVIVE_HP, his kit as it was). The team's ticket goes only when he bleeds
// out or gives up and redeploys.
export const SPOT_MS = 6000, SPOT_RECON_MS = 9000;
export const BLEED_MS = 15000, REVIVE_MS = 2500, REVIVE_RANGE = 2.5, REVIVE_HP = 30;
const NO_REVIVE = new Set(['fall', 'roadkill', 'restricted', 'boundary', 'crash', 'reset', 'suicide']);
const HISTORY_MS = 1000;
const STANCES = ['stand', 'crouch', 'prone'];

let nextId = 1;
const worldCache = new Map();

export class Game {
  constructor({ botsPerTeam = 8, log = console.log, map = 'outskirts' } = {}) {
    this.log = log;
    this.map = getMap(map);
    // collision world + nav grid are immutable per map: share them between rooms playing the same map
    const shared = worldCache.get(this.map.id) || (() => {
      const t0 = Date.now();
      const world = new CollisionWorld(this.map), nav = new NavGrid(world, this.map.PLAY_HALF > 300 ? 1 : 0.75);
      this.log(`[game] ${this.map.id}: collision + nav grid ${nav.n}x${nav.n} built in ${Date.now() - t0} ms`);
      const v = { world, nav }; worldCache.set(this.map.id, v); return v;
    })();
    this.world = shared.world;
    this.nav = shared.nav;
    this.players = new Map();
    this.agents = [];        // LLM-commanded soldiers (AI Zone rooms)
    this.grenades = [];
    this.bullets = [];
    this.botsPerTeam = botsPerTeam;
    this.events = [];
    this.time = 0;
    this.vehicles = new VehicleSystem(this);
    this.glassBroken = new Set(); // window panes shattered this round (the collision world is shared: state lives here)
    this.restrictedHQ = Math.min(45, this.map.PLAY_HALF * 0.3); // radius of each HQ's no-go zone for the enemy
    this.reviveEnabled = true; // (battle royale: no medics, no reviving)
    this.squadsEnabled = true; // (battle royale: everyone for himself)
    this.spotting = true;
    this.resetRound();
  }

  now() { return this.clock ?? Date.now(); }

  resetRound() {
    for (const p of this.players.values()) { p.downed = null; p.reviving = null; }
    this.tickets = { 1: START_TICKETS, 2: START_TICKETS };
    this.roundStart = this.now();
    this.flags = this.map.FLAGS.map((f) => ({ ...f, owner: f.owner || 0, progress: f.owner === 1 ? 1 : f.owner === 2 ? -1 : 0, contested: false }));
    this.roundOver = null;
    this.bleedAcc = { 1: 0, 2: 0 };
    this.grenades = []; this.bullets = [];
    this.vehicles.resetAll();
    this.repairGlass();
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.score = 0; p.stats = {};
      this.kill(p, null, 'reset', true);
      p.respawnAt = this.now() + 1500;
    }
  }

  // ------------------------------------------------------------ players
  addPlayer({ name, bot = false, team = 0, cls = 'assault', send = null }) {
    const counts = this.teamCounts(true);
    if (team !== 1 && team !== 2) team = counts[1] <= counts[2] ? 1 : 2;
    const p = {
      id: nextId++, name: String(name || 'Soldier').slice(0, 18), bot, team, cls: CLASSES[cls] ? cls : 'assault', send,
      alive: false, hp: 100, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, stance: 'stand', onGround: true,
      ads: false, sprint: false, slot: 0, weapons: [], grenades: 0, reloadUntil: 0, nextFire: 0, spawnProtect: 0,
      kills: 0, deaths: 0, score: 0, history: [], respawnAt: this.now() + (bot ? 500 + Math.random() * 2500 : 0), rtt: 80,
      lastInput: this.now(), lastFireFlag: 0, lastDamageFrom: null, stats: {},
    };
    if (bot) p.brain = new (this.BotBrainClass || BotBrain)(this, p);
    this.players.set(p.id, p);
    this.organiseSquads();
    return p;
  }

  removePlayer(id) { this.players.delete(id); this.organiseSquads(); }

  // ------------------------------------------------------------ score
  // every point a soldier earns goes through here: added to his score, tallied for the end-of-round summary, and
  // shown to the player in the score feed by his crosshair
  award(p, pts, why, extra = null) {
    if (!p || !(pts > 0)) return;
    pts = Math.round(pts);
    p.score += pts;
    const s = p.stats || (p.stats = {});
    s[why] = (s[why] || 0) + 1;
    if (!p.bot) this.emit({ t: 'score', pts, why, ...extra }, p);
  }

  // ------------------------------------------------------------ squads
  // Each team in squads of four. A player keeps his squad; bots top up the squads with players in them first (so a
  // player always has squad mates to spawn on), then make up their own. Run whenever who is on which team changes.
  organiseSquads() {
    if (!this.squadsEnabled) return;
    for (const team of [1, 2]) {
      const ps = [...this.players.values()].filter((p) => p.team === team);
      const sq = new Map(), get = (id) => sq.get(id) || (sq.set(id, { h: [], b: [] }), sq.get(id));
      const size = (id) => (sq.has(id) ? sq.get(id).h.length + sq.get(id).b.length : 0);
      const freeId = () => { let i = 1; while (sq.has(i) && size(i) > 0) i++; return i; };
      const humans = ps.filter((p) => !p.bot).sort((a, b) => a.id - b.id), bots = ps.filter((p) => p.bot).sort((a, b) => a.id - b.id);
      for (const p of humans) { if (p.squad && get(p.squad).h.length < SQUAD_SIZE) get(p.squad).h.push(p); else p.squad = 0; }
      for (const p of humans) if (!p.squad) {
        // with the other players where there is room, else a squad of his own
        let best = 0;
        for (const [id, s] of sq) if (s.h.length && s.h.length < SQUAD_SIZE && (!best || s.h.length > sq.get(best).h.length)) best = id;
        p.squad = best || freeId(); get(p.squad).h.push(p);
      }
      for (const p of bots) { if (p.squad && size(p.squad) < SQUAD_SIZE) get(p.squad).b.push(p); else p.squad = 0; }
      // a bot without a squad, or out of a bots-only squad, fills the gaps in the players' squads
      for (const [id, s] of [...sq]) {
        while (s.h.length && size(id) < SQUAD_SIZE) {
          const donor = bots.find((b) => !b.squad) || bots.find((b) => b.squad && !sq.get(b.squad).h.length);
          if (!donor) break;
          if (donor.squad) { const d = sq.get(donor.squad); d.b.splice(d.b.indexOf(donor), 1); }
          donor.squad = id; s.b.push(donor);
        }
      }
      for (const p of bots) if (!p.squad) {
        let best = 0;
        for (const [id] of sq) if (size(id) > 0 && size(id) < SQUAD_SIZE && (!best || id < best)) best = id;
        p.squad = best || freeId(); get(p.squad).b.push(p);
      }
    }
  }

  squadMates(p) { return [...this.players.values()].filter((q) => q !== p && q.team === p.team && q.squad && q.squad === p.squad); }

  // can p deploy on squad mate m right now? '' = yes, else why not (c combat, v vehicle, a air, r restricted)
  squadBlock(p, m, now = this.now()) {
    if (!m || !m.alive || m === p || m.team !== p.team || !m.squad || m.squad !== p.squad) return 'x';
    if (m.vehicle) {
      // into his vehicle: only while it has a seat free
      const v = this.vehicles.get(m.vehicle);
      if (!v || v.dead || !v.seats.includes(null)) return 'v';
    } else if (m.air || m.onGround === false) return 'a';
    if (m.inRestricted > 0) return 'r';
    // in the fight: hit or shooting lately, an enemy close, or one with eyes on him from not far off
    if (now - (m.lastHit || 0) < SQUAD_SAFE_MS || now - (m.lastFireFlag || 0) < SQUAD_SAFE_MS) return 'c';
    const eye = { x: m.x, y: m.y + 1.4, z: m.z };
    for (const q of this.players.values()) {
      if (!q.alive || !this.isEnemy(q, m)) continue;
      const d = Math.hypot(q.x - m.x, q.z - m.z);
      if (d < SQUAD_ENEMY_R || (d < SQUAD_ENEMY_R * 3 && this.world.lineOfSight(eye, { x: q.x, y: q.y + 1.4, z: q.z }))) return 'c';
    }
    return '';
  }

  // for the deploy screen of a dead player: [[mate id, why not ('' = can spawn)], ...]
  squadSpawns(p) {
    if (!this.squadsEnabled || !p.squad) return undefined;
    const now = this.now();
    return this.squadMates(p).filter((m) => m.alive).map((m) => [m.id, this.squadBlock(p, m, now)]);
  }

  // a free spot right behind the squad mate, on the same floor, that he can see
  #squadSpot(m) {
    const eye = { x: m.x, y: m.y + 1.2, z: m.z };
    for (const r of [1.6, 2.4, 1.1]) {
      for (const da of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2, -Math.PI / 2, 2.2, -2.2, Math.PI]) {
        // behind him: his forward is (-sin yaw, -cos yaw)
        const a = m.yaw + da, cx = m.x + Math.sin(a) * r, cz = m.z + Math.cos(a) * r;
        const y = this.world.supportHeight(cx, cz, m.y + 0.6);
        if (Math.abs(y - m.y) > 0.6) continue;
        const pos = { x: cx, z: cz };
        if (this.world.resolveHorizontal(pos, y, 1.8)) continue;
        if (!this.world.lineOfSight(eye, { x: cx, y: y + 1.2, z: cz })) continue;
        if (Math.abs(cx) > this.map.PLAY_HALF || Math.abs(cz) > this.map.PLAY_HALF) continue;
        return { x: cx, y, z: cz };
      }
    }
    return { x: m.x, y: m.y, z: m.z };
  }

  // Conquest: two teams. Battle royale overrides this (everyone for themselves).
  isEnemy(a, b) { return a !== b && a.team !== b.team; }

  teamCounts(humansToo = false) {
    const c = { 1: 0, 2: 0 };
    for (const p of this.players.values()) if (humansToo || !p.bot) c[p.team]++;
    return c;
  }

  balanceBots() {
    const humans = { 1: 0, 2: 0 }, bots = { 1: [], 2: [] };
    // AI-zone agents take the place of a bot on their team
    for (const p of this.players.values()) (p.bot && !p.agent ? bots[p.team].push(p) : humans[p.team]++);
    const names = ['Reyes', 'Kowalski', 'Hansen', 'Ivanov', 'Okafor', 'Brandt', 'Novak', 'Sato', 'Moreau', 'Petrov', 'Walsh', 'Lindqvist', 'Costa', 'Bauer', 'Kaya', 'Volkov', 'Garcia', 'Duarte', 'Fischer', 'Sokolov'];
    for (const t of [1, 2]) {
      const want = Math.max(0, this.botsPerTeam - humans[t]);
      while (bots[t].length < want) {
        bots[t].push(this.addPlayer({ name: botName(this.players, names), bot: true, team: t, cls: ((r) => (r < 0.5 ? 'assault' : r < 0.65 ? 'recon' : r < 0.85 ? 'support' : 'medic'))(Math.random()) }));
      }
      while (bots[t].length > want) this.removePlayer(bots[t].pop().id);
    }
  }

  // a flag is only a spawn point while it is safe: owned, not being captured, no enemy near it
  spawnOptions(team) {
    const opts = [{ id: 'base', x: this.map.BASES[team].x, z: this.map.BASES[team].z }];
    for (const f of this.flags) if (f.owner === team && !this.#flagUnderAttack(f, team)) opts.push({ id: f.id, x: f.x, z: f.z });
    return opts;
  }

  #flagUnderAttack(f, team) {
    if (f.contested) return true;
    for (const q of this.players.values()) if (q.alive && q.team !== team && Math.hypot(q.x - f.x, q.z - f.z) < f.r + 25) return true;
    return false;
  }

  // how exposed a spawn spot is: enemies that could see it (closer = worse)
  #spawnThreat(team, x, y, z) {
    let t = 0;
    const eye = { x, y: y + 1.5, z };
    for (const q of this.players.values()) {
      if (!q.alive || q.team === team) continue;
      const d = Math.hypot(q.x - x, q.z - z);
      if (d > 160) continue;
      if (d < 25) { t += 10; continue; }
      if (this.world.lineOfSight(eye, { x: q.x, y: q.y + 1.5, z: q.z })) t += 3 - d / 80;
    }
    return t;
  }

  spawn(p, pointId = 'base', cls) {
    if (p.alive || this.roundOver) return false;
    if (this.now() < p.respawnAt) return false;
    // redeploying while still down: given up on a medic — that costs the ticket now
    if (p.downed) this.#bleedOut(p);
    let mate = null;
    if (typeof pointId === 'string' && pointId[0] === '@') {
      // on a squad mate: only while he is out of the fight
      mate = this.players.get(+pointId.slice(1));
      const why = this.squadsEnabled ? this.squadBlock(p, mate) : 'x';
      if (why) { if (!p.bot) this.emit({ t: 'spawnfail', why }, p); return false; }
      if (p.downed) this.#bleedOut(p);
    }
    if (cls && CLASSES[cls]) p.cls = cls;
    const opt = mate ? { id: 'squad', x: mate.x, z: mate.z } : this.spawnOptions(p.team).find((o) => o.id === pointId) || this.spawnOptions(p.team)[0];
    // several free candidate spots; take the one fewest enemies can see (no spawning into a firefight)
    let x = opt.x, z = opt.z, best = Infinity, found = 0, y = null;
    const ride = mate?.vehicle ? this.vehicles.get(mate.vehicle) : null;
    if (ride) ({ x, y, z } = ride);
    else if (mate) ({ x, y, z } = this.#squadSpot(mate));
    for (let tries = 0; tries < 40 && found < 8 && !mate; tries++) {
      const a = Math.random() * Math.PI * 2, r = opt.id === 'base' ? 3 + Math.random() * 9 : 8 + Math.random() * 10;
      const cx = opt.x + Math.cos(a) * r, cz = opt.z + Math.sin(a) * r;
      const pos = { x: cx, z: cz };
      const gy = this.map.groundHeight(cx, cz);
      if (this.world.resolveHorizontal(pos, gy, 1.8) || this.world.supportHeight(cx, cz, gy + 0.2) >= gy + 0.3) continue;
      found++;
      const threat = this.#spawnThreat(p.team, cx, gy, cz) + Math.random() * 0.1;
      if (threat < best) { best = threat; x = cx; z = cz; }
      if (threat < 0.1) break;
    }
    const c = CLASSES[p.cls];
    Object.assign(p, {
      alive: true, hp: 100, x, z, y: y ?? this.world.supportHeight(x, z, this.map.groundHeight(x, z) + 0.3), vx: 0, vy: 0, vz: 0, stance: mate?.stance === 'crouch' ? 'crouch' : 'stand', onGround: true,
      yaw: mate ? mate.yaw : this.map.BASES[p.team].yaw + (Math.random() - 0.5) * 0.4, pitch: 0, slot: 0, reloadUntil: 0, nextFire: 0, grenades: c.grenades,
      weapons: [c.primary, c.secondary, c.gadget].filter(Boolean).map((id, i) => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve * (i === 0 ? c.ammoMul || 1 : 1) })),
      spawnProtect: this.now() + (mate ? 1500 : 3000), spawnedAt: this.now(), history: [], lastDamageFrom: null, spawnPoint: opt.id, airPeak: null, inRestricted: 0,
    });
    p.lastInput = this.now(); p.moveBudget = undefined; p.dmgBy = null;
    if (p.brain) p.brain.onSpawn();
    this.emit({ t: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, cls: p.cls, w: p.weapons, g: p.grenades, ...(mate && { on: mate.id, st: p.stance }) }, p.bot ? null : p);
    if (ride) this.vehicles.enter(p, ride.id); // (a free seat in his vehicle)
    if (mate) this.award(mate, 10, 'squadspawn', { v: p.id });
    return true;
  }

  kill(p, killer, weapon, silent = false) {
    if (!p.alive) return;
    // incapacitated rather than killed? (body hits; not blown apart: an explosion's overkill shows in the hp)
    const downable = this.reviveEnabled && !silent && !p.lastHeadshot && p.hp > -45 && !p.vehicle && !p.air && !NO_REVIVE.has(weapon);
    if (p.vehicle) this.vehicles.exit(p, true);
    p.alive = false; p.hp = 0; p.reviving = null;
    p.respawnAt = this.now() + RESPAWN_DELAY * 1000;
    if (silent) return;
    p.deaths++;
    if (downable) p.downed = { until: this.now() + BLEED_MS, x: p.x, y: p.y, z: p.z, by: killer ? killer.id : 0 };
    else this.tickets[p.team] = Math.max(0, this.tickets[p.team] - 1);
    if (killer && killer !== p && killer.team !== p.team) {
      killer.kills++;
      this.award(killer, 100, downable ? 'down' : 'kill', { v: p.id });
      if (p.lastHeadshot && !NO_REVIVE.has(weapon)) this.award(killer, 20, 'headshot');
      const kd = Math.hypot(killer.x - p.x, killer.z - p.z);
      if (kd > (killer.stats.longest || 0) && !killer.vehicle) killer.stats.longest = Math.round(kd);
      // whoever else hurt him badly: an assist worth the damage done
      for (const [id, dmg] of p.dmgBy || []) {
        const a = id !== killer.id && dmg >= 20 && this.players.get(id);
        if (a && a.team === killer.team) this.award(a, Math.min(dmg, 90), 'assist', { v: p.id });
      }
      // spotted for the killer's team by someone else: an assist for the spotter
      const sp = p.spottedTeam === killer.team && p.spottedUntil > this.now() && p.spottedBy !== killer.id && this.players.get(p.spottedBy);
      if (sp) this.award(sp, 25, 'spot', { v: p.id });
    }
    p.spottedUntil = 0; p.dmgBy = null;
    this.emit({ t: 'kill', v: p.id, k: killer ? killer.id : 0, w: weapon, hs: p.lastHeadshot || false, kx: killer?.x, ky: killer?.y, kz: killer?.z, ...(downable && { dn: 1 }) });
  }

  // bled out (or gave up): the ticket goes now
  #bleedOut(p) {
    p.downed = null;
    this.tickets[p.team] = Math.max(0, this.tickets[p.team] - 1);
    this.emit({ t: 'bledout', id: p.id });
  }

  // ------------------------------------------------------------ spotting
  // Q: the enemy (or enemy vehicle) nearest the spotter's crosshair, in sight and in range, is marked for his whole
  // team for a few seconds — on their minimaps and over his head. o / d: the spotter's camera ray (o is only trusted
  // near him: third person and vehicle cameras sit a few metres off).
  spot(p, o, d) {
    const now = this.now();
    if (!this.spotting || !p.alive || now < (p.nextSpot || 0)) return null;
    p.nextSpot = now + 700;
    const eye = { x: p.x, y: p.y + (p.vehicle ? 1.6 : EYE_HEIGHT[p.stance] || 1.6), z: p.z };
    const org = Array.isArray(o) && o.length === 3 && o.every(Number.isFinite) && Math.hypot(o[0] - eye.x, o[1] - eye.y, o[2] - eye.z) < 15 ? { x: o[0], y: o[1], z: o[2] } : eye;
    let dir = Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) ? d : [-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch)];
    const L = Math.hypot(dir[0], dir[1], dir[2]) || 1; dir = dir.map((c) => c / L);
    const range = p.cls === 'recon' ? 450 : 300;
    let best = null;
    const consider = (t, q, v) => {
      const dx = t.x - org.x, dy = t.y - org.y, dz = t.z - org.z, dist = Math.hypot(dx, dy, dz);
      if (dist > range || dist < 1) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * dir[0] + dy * dir[1] + dz * dir[2]) / dist)));
      // a few degrees round the crosshair, or ~2.5 m either side of it up close
      const allow = Math.min(0.3, Math.max(0.06, Math.atan(2.5 / dist)));
      if (ang > allow) return;
      const score = ang / allow + dist / range * 0.3 + (v ? -0.2 : 0);
      if (best && score >= best.score) return;
      if (!this.world.lineOfSight(org, t)) return;
      best = { q, v, score };
    };
    const seen = new Set();
    for (const q of this.players.values()) {
      if (!q.alive || !this.isEnemy(p, q) || q.air === 1) continue;
      const v = q.vehicle && this.vehicles.get(q.vehicle);
      if (v) { if (seen.has(v.id)) continue; seen.add(v.id); consider({ x: v.x, y: v.y + VEHICLES[v.type].half[1], z: v.z }, q, v); continue; }
      consider({ x: q.x, y: q.y + (q.stance === 'prone' ? 0.35 : q.stance === 'crouch' ? 0.9 : 1.3), z: q.z }, q, null);
    }
    if (!best) { if (!p.bot) this.emit({ t: 'spot', ok: 0 }, p); return null; }
    this.markSpotted(p, best.q, best.v);
    if (!p.bot) this.emit({ t: 'spot', ok: 1, id: best.q.id, v: best.v?.type }, p);
    return best.q;
  }

  // mark q (and his vehicle) as spotted for p's team; bots call this for what they see
  markSpotted(p, q, v = null) {
    if (!this.spotting) return;
    const until = this.now() + (p.cls === 'recon' ? SPOT_RECON_MS : SPOT_MS);
    for (const o of v ? [v, ...v.seats.map((id) => id && this.players.get(id)).filter(Boolean)] : [q]) {
      if ((o.spottedUntil || 0) < until) { o.spottedUntil = until; o.spottedTeam = p.team; o.spottedBy = p.id; }
    }
  }

  // for one team's snapshot: who of the enemy is spotted right now (soldiers, vehicles)
  spottedFor(team) {
    if (!this.spotting) return undefined;
    const now = this.now(), pl = [], vl = [];
    for (const q of this.players.values()) if (q.alive && q.team !== team && q.spottedTeam === team && q.spottedUntil > now) pl.push(q.id);
    for (const v of this.vehicles.list) if (!v.dead && v.spottedTeam === team && v.spottedUntil > now) vl.push(v.id);
    return pl.length || vl.length ? { p: pl, v: vl } : undefined;
  }

  // a downed player gives up on a medic (redeploy screen): the ticket goes now, medics stop heading for him
  giveUp(p) { if (p.downed) this.#bleedOut(p); }

  // a medic starts / stops working on a downed teammate (holding the revive key; bots set it directly)
  reviveHold(medic, id, on) {
    if (!on) { medic.reviving = null; return; }
    const q = this.players.get(id);
    if (!medic.alive || medic.vehicle || !CLASSES[medic.cls]?.medic || !q?.downed || q.team !== medic.team) return;
    if (Math.hypot(q.downed.x - medic.x, q.downed.z - medic.z) > REVIVE_RANGE || Math.abs(q.downed.y - medic.y) > 1.5) return;
    if (medic.reviving?.id !== id) medic.reviving = { id, t0: this.now() };
  }

  // per tick: bleeding out, revives in progress
  #casualties(now) {
    for (const p of this.players.values()) {
      if (p.downed && now >= p.downed.until) this.#bleedOut(p);
      const r = p.reviving;
      if (!r) continue;
      const q = this.players.get(r.id);
      // (the medic has to stay with him: in reach, on his feet, not driving off)
      if (!p.alive || p.vehicle || !q?.downed || Math.hypot(q.downed.x - p.x, q.downed.z - p.z) > REVIVE_RANGE + 0.3) { p.reviving = null; continue; }
      if (now - r.t0 >= REVIVE_MS) this.#revive(p, q);
    }
  }

  #revive(medic, q) {
    const d = q.downed, now = this.now();
    medic.reviving = null; q.downed = null;
    Object.assign(q, {
      alive: true, hp: REVIVE_HP, x: d.x, y: d.y, z: d.z, vx: 0, vy: 0, vz: 0, stance: 'crouch', onGround: true, air: 0,
      reloadUntil: 0, nextFire: now + 600, spawnProtect: 0, history: [], lastDamageFrom: null, airPeak: null, lastHit: now,
    });
    q.lastInput = now; q.moveBudget = undefined;
    q.deaths = Math.max(0, q.deaths - 1); // (brought round: not a death after all)
    this.award(medic, 50, 'revive', { v: q.id });
    if (q.brain) q.brain.onRevived?.();
    this.emit({ t: 'revive', id: q.id, by: medic.id, x: q.x, y: q.y, z: q.z, hp: q.hp, w: q.weapons, g: q.grenades, sl: q.slot });
  }

  // a medic of p's team up and about within r metres (downed bots hold on for one)
  medicNear(p, r = 45) {
    for (const q of this.players.values()) if (q !== p && q.alive && q.team === p.team && CLASSES[q.cls]?.medic && !q.vehicle && Math.hypot(q.x - p.x, q.z - p.z) < r) return q;
    return null;
  }

  damage(victim, amount, attacker, weapon, head = false) {
    if (!victim.alive || this.now() < victim.spawnProtect || !(amount > 0) || !Number.isFinite(amount)) return;
    if (attacker && attacker !== victim && !this.isEnemy(attacker, victim)) return; // no friendly fire
    if (attacker && attacker !== victim) (victim.dmgBy || (victim.dmgBy = new Map())).set(attacker.id, (victim.dmgBy.get(attacker.id) || 0) + Math.min(amount, Math.max(0, victim.hp)));
    victim.hp -= amount;
    victim.lastHeadshot = head;
    victim.lastDamageFrom = attacker ? attacker.id : 0;
    victim.lastHit = this.now();
    if (victim.brain) victim.brain.onDamaged(attacker);
    this.emit({ t: 'hurt', v: victim.id, a: attacker ? attacker.id : 0, d: Math.round(amount), hs: head, ax: attacker?.x, az: attacker?.z, w: attacker ? undefined : weapon }, null, [victim.id, attacker?.id]);
    if (victim.hp <= 0) this.kill(victim, attacker, weapon);
  }

  // ------------------------------------------------------------ window glass
  breakGlass(pane, at, dir) {
    if (this.glassBroken.has(pane.id)) return;
    this.glassBroken.add(pane.id);
    this.emit({ t: 'glass', id: pane.id, p: (at || pane.c).map((v) => +v.toFixed(2)), d: dir ? [+dir[0].toFixed(2), +dir[1].toFixed(2), +dir[2].toFixed(2)] : null });
  }

  repairGlass() { if (this.glassBroken?.size) { this.glassBroken.clear(); this.emit({ t: 'glassreset' }); } }

  // something moving from a to b (a bullet, a soldier's body) smashes the panes it crosses
  #glassAlong(a, b, r = 0) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz) || 1;
    for (const h of this.world.glassAlong(a, b, r)) {
      if (this.glassBroken.has(h.pane.id)) continue;
      this.breakGlass(h.pane, [a.x + dx * h.t, a.y + dy * h.t, a.z + dz * h.t], [dx / l, dy / l, dz / l]);
    }
  }

  #glassBlast(x, y, z, radius) {
    for (const pane of this.world.glassNear(x, y, z, radius)) {
      const d = [pane.c[0] - x, pane.c[1] - y, pane.c[2] - z], l = Math.hypot(...d) || 1;
      this.breakGlass(pane, null, d.map((v) => v / l));
    }
  }

  // ------------------------------------------------------------ input from humans
  handleInput(p, m) {
    if (!p.alive || p.vehicle) return;
    const now = this.now();
    const dt = Math.max(0.001, (now - p.lastInput) / 1000);
    p.lastInput = now;
    const dx = m.x - p.x, dz = m.z - p.z;
    // freefall / parachute glide is much faster than running; the air state only moves forward:
    // freefall (1) -> parachute (2) -> ground (0), never back up into the air
    const air = p.air && (m.dr === p.air || (p.air === 1 && m.dr === 2)) ? m.dr : 0;
    if (p.air && !air) p.landedAt = now;
    // movement budget (as the vehicles have): refilled at the fastest a soldier can go, holding ~0.6 s of travel +
    // 1.5 m, so a burst of inputs arriving together after a network hiccup passes, while a teleport or a sustained
    // speed hack doesn't (a flat allowance per message let a client go faster just by sending more often, and still
    // rubber-banded a jittery connection whose messages came in bunches)
    // (just bailed out of a moving vehicle: carrying its speed for a moment)
    const rate = p.air ? 34 : Math.max(MOVE.sprint * 1.6, p.bailUntil > now ? (p.bailSpeed || 0) * 1.2 : 0), cap = rate * 0.6 + 1.5;
    p.moveBudget = Math.min(cap, (p.moveBudget ?? cap) + rate * Math.min(dt, 0.5));
    const moved = Math.hypot(dx, dz);
    p.air = air;
    const before = { x: p.x, y: p.y, z: p.z };
    if (process.env.DEV_TELEPORT && Number.isFinite(m.x + m.y + m.z)) { p.x = m.x; p.y = m.y; p.z = m.z; }
    else if (moved > p.moveBudget || !Number.isFinite(m.x + m.y + m.z) || Math.abs(m.x) > this.map.PLAY_HALF + 10 || Math.abs(m.z) > this.map.PLAY_HALF + 10) {
      this.emit({ t: 'correct', x: p.x, y: p.y, z: p.z }, p);
    } else {
      p.x = m.x; p.y = m.y; p.z = m.z; p.moveBudget -= moved;
    }
    // climbing / jumping through a window smashes the glass (body at hip and chest height)
    const mv = Math.hypot(p.x - before.x, p.z - before.z);
    if (mv > 0.02 && mv < 6) for (const hgt of [0.6, 1.1]) this.#glassAlong({ x: before.x, y: before.y + hgt, z: before.z }, { x: p.x, y: p.y + hgt, z: p.z }, 0.25);
    // fall damage for players (their movement is predicted client-side): highest point of the airborne phase -> landing
    if (!p.air && !air) {
      if (!m.og) p.airPeak = Math.max(p.airPeak ?? p.y, p.y);
      else if (p.airPeak != null) {
        const h = p.airPeak - p.y; p.airPeak = null;
        if (h > SAFE_FALL && !process.env.DEV_TELEPORT) this.damage(p, (h - SAFE_FALL) * FALL_DMG, null, 'fall');
      }
    } else p.airPeak = null;
    if (!p.alive) return;
    p.yaw = +m.yaw || 0; p.pitch = Math.max(-1.5, Math.min(1.5, +m.pitch || 0));
    p.stance = STANCES.includes(m.st) ? m.st : 'stand';
    p.ads = !!m.ads; p.sprint = !!m.sp; p.vx = +m.vx || 0; p.vz = +m.vz || 0; p.onGround = !!m.og;
    if (Number.isInteger(m.sl) && m.sl >= 0 && p.weapons[m.sl]) { if (m.sl !== p.slot) { p.slot = m.sl; p.reloadUntil = 0; } }
  }

  // ------------------------------------------------------------ weapons
  // rt: the server time the shooter's screen was showing other soldiers at (their interpolation delay), for exact
  // lag compensation; older clients fall back to an estimate from ping
  tryFire(p, origin, dir, clientTime, rt) {
    const now = this.now();
    if (!p.alive || p.vehicle || now < p.reloadUntil || this.roundOver) return false;
    const w = p.weapons[p.slot]; if (!w) return false;
    const def = WEAPONS[w.id];
    const interval = Math.max(60000 / def.rpm, (def.bolt || 0) * 1000);
    if (now < p.nextFire - 25) return false;
    if (w.mag <= 0) return false;
    w.mag--;
    p.nextFire = Math.max(now, p.nextFire) + interval;
    p.lastFireFlag = now;
    p.spawnProtect = 0;
    // validate origin against server eye position
    const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
    let o = origin && Number.isFinite(origin[0] + origin[1] + origin[2]) ? { x: origin[0], y: origin[1], z: origin[2] } : eye;
    if (Math.hypot(o.x - eye.x, o.y - eye.y, o.z - eye.z) > 1.6) o = eye;
    let d = { x: dir[0], y: dir[1], z: dir[2] };
    const dl = Math.hypot(d.x, d.y, d.z); if (!Number.isFinite(dl) || dl < 1e-6) return false;
    d.x /= dl; d.y /= dl; d.z /= dl;

    // real projectile: travel time, drag and bullet drop (shared/ballistics.js). The path through the static world
    // is known now; soldiers are tested segment by segment as the bullet flies (lag-compensated per segment).
    const path = bulletPath(this.world, o, d, def);
    const viewT = p.bot ? now : Number.isFinite(rt) ? Math.max(now - 450, Math.min(now, rt)) : now - Math.min(250, p.rtt / 2 + 100);
    const b = { id: nextId++, shooter: p, w: w.id, def, pts: path.pts, i: 0, t0: now, viewT, bot: !!p.bot, done: false, worldHit: path.hit };
    const end = path.end, wh = path.hit;
    // (l: the last round in the magazine — everyone sees the slide / bolt locked back)
    this.emit({ t: 'shot', id: p.id, b: b.id, w: w.id, o: [o.x, o.y, o.z], e: [end.x, end.y, end.z], tf: +end.t.toFixed(3), s: wh ? wh.surface : 'none', n: wh ? wh.normal : null, ...(w.mag === 0 && { l: 1 }) });
    this.#suppress(p, o, end);
    this.bullets.push(b);
    this.stepBullet(b, now); // what the bullet covers before the next tick (anything within ~30 m) resolves right away
    if (w.mag === 0 && p.bot) this.reload(p);
    return true;
  }

  // bots an enemy round passes within 3 m of (head / chest height, more than 3 m from the muzzle) feel it crack past:
  // suppression (BotBrain.onSuppressed). A round that hits them is handled as damage instead.
  #suppress(p, o, end) {
    const dx = end.x - o.x, dy = end.y - o.y, dz = end.z - o.z, L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1) return;
    for (const q of this.players.values()) {
      if (!q.brain || !q.alive || q.vehicle || !this.isEnemy(p, q)) continue;
      const cy = q.y + (q.stance === 'prone' ? 0.3 : q.stance === 'crouch' ? 0.9 : 1.3);
      const t = ((q.x - o.x) * dx + (cy - o.y) * dy + (q.z - o.z) * dz) / L2;
      if (t <= 0 || t > 1 || t * Math.sqrt(L2) < 3) continue;
      const d = Math.hypot(o.x + dx * t - q.x, o.y + dy * t - cy, o.z + dz * t - q.z);
      if (d > 0.35 && d < 3) q.brain.onSuppressed?.(p, d);
    }
  }

  // vehicle weapons (shells, rockets, cannon, MG): same flight model; explosive rounds burst where they land
  fireProjectile(p, o, d, W, v) {
    const now = this.now();
    const path = bulletPath(this.world, o, d, W);
    const b = { id: nextId++, shooter: p, w: W.id, def: W, pts: path.pts, i: 0, t0: now, viewT: p.bot ? now : now - Math.min(250, p.rtt / 2 + 100), bot: !!p.bot, done: false, vehicle: v.id, worldHit: path.hit };
    const end = path.end, wh = path.hit;
    this.emit({ t: 'shot', id: p.id, b: b.id, w: W.id, v: v.id, o: [o.x, o.y, o.z], e: [end.x, end.y, end.z], tf: +end.t.toFixed(3), s: wh ? wh.surface : 'none', n: wh ? wh.normal : null });
    this.#suppress(p, o, end);
    this.bullets.push(b);
    this.stepBullet(b, now);
  }

  // generic blast: soldiers (line of sight, no friendly fire) + vehicles
  explodeAt(x, y, z, { radius, damage, owner = null, weapon = 'explosion', vehicleDamage = 0, kind = 'explosive', boom = true }) {
    if (boom) this.emit({ t: 'boom', x, y, z, big: radius >= 5 ? 1 : 0 });
    this.#glassBlast(x, y, z, radius * 1.6);
    for (const q of this.players.values()) {
      if (!q.alive || (q.vehicle && !q.exposed)) continue;
      const c = { x: q.x, y: q.y + (q.stance === 'prone' ? 0.3 : 1.0), z: q.z };
      const dist = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (dist > radius) continue;
      if (!this.world.lineOfSight({ x, y: y + 0.15, z }, c)) continue;
      if (owner && q !== owner && !this.isEnemy(owner, q)) continue;
      const f = 1 - dist / radius;
      this.damage(q, damage * f * f + (dist < radius * 0.3 ? damage * 0.4 : 0), owner, weapon);
    }
    if (vehicleDamage > 0) this.vehicles.explosion(x, y, z, radius, vehicleDamage, owner, weapon, kind);
  }

  stepBullet(b, now) {
    const until = (now - b.t0) / 1000 + STEP - 1e-6;
    while (!b.done && b.i < b.pts.length - 1 && b.pts[b.i].t < until) {
      const hit = this.#bulletSegment(b, b.pts[b.i], b.pts[b.i + 1]);
      if (hit) { b.done = true; this.#bulletHit(b, hit); return; }
      b.i++;
    }
    if (b.i >= b.pts.length - 1) {
      b.done = true;
      // explosive round reached the ground / a wall (not yet armed that close to the launcher: it just thuds in)
      if (b.def.splash && b.worldHit && !(b.pts[b.pts.length - 1].d < (b.def.armDist || 0))) { const e = b.pts[b.pts.length - 1]; this.explodeAt(e.x, e.y + 0.3, e.z, { radius: b.def.splash, damage: b.def.damage, owner: b.shooter, weapon: b.w, vehicleDamage: b.def.vehicleDamage }); }
    }
  }

  stepBullets(now) {
    for (const b of this.bullets) this.stepBullet(b, now);
    this.bullets = this.bullets.filter((b) => !b.done);
  }

  #bulletSegment(b, a, c) {
    const sx = c.x - a.x, sy = c.y - a.y, sz = c.z - a.z, len = Math.hypot(sx, sy, sz);
    if (len < 1e-6) return null;
    // rounds go through window glass and shatter it (a hit further along stops the bullet there, so the panes
    // beyond a victim may break a moment early — at 30 m per tick nobody sees it)
    this.#glassAlong(a, c);
    const d = { x: sx / len, y: sy / len, z: sz / len }, o = { x: a.x, y: a.y, z: a.z };
    const mx = a.x + sx / 2, mz = a.z + sz / 2;
    // where everyone was when the bullet got here, on the shooter's timeline (what they saw + the flight time)
    const at = b.viewT + c.t * 1000;
    let best = len, victim = null, part = null;
    for (const q of this.players.values()) {
      if (q === b.shooter || !q.alive || (q.vehicle && !q.exposed) || !this.isEnemy(b.shooter, q)) continue;
      if (Math.hypot(q.x - mx, q.z - mz) > len / 2 + 6) continue;
      const hp = b.bot ? q : this.historyAt(q, at);
      for (const cap of hitCapsules(hp)) {
        const t = rayCapsule(o, d, cap.a, cap.b, cap.r);
        if (t !== null && t < best) { best = t; victim = q; part = cap.part; }
      }
    }
    // vehicles, lag-compensated like soldiers (bots see the present)
    const vh = b.bot ? this.vehicles.rayTest(o, d, best, b.shooter) : this.#vehicleRayAt(o, d, best, b.shooter, at);
    // (an exposed rider in the line of fire takes the round, not the bike under them)
    if (vh && vh.t < best && !(victim && victim.vehicle === vh.v.id)) return { vehicle: vh.v, dist: a.d + vh.t, point: [o.x + d.x * vh.t, o.y + d.y * vh.t, o.z + d.z * vh.t] };
    return victim ? { victim, head: part === 'head', part, dist: a.d + best, point: [o.x + d.x * best, o.y + d.y * best, o.z + d.z * best] } : null;
  }

  #bulletHit(b, { victim, vehicle, head, part, dist, point }) {
    const p = b.shooter, def = b.def;
    if (def.armDist && dist < def.armDist) {
      // unarmed launcher round: a 1.8 kg projectile at 290 m/s still hurts what it strikes
      if (vehicle) { this.emit({ t: 'bhit', b: b.id, p: point.map((v) => +v.toFixed(2)), vh: vehicle.id }); if (vehicle.seats.some((s) => s && this.isEnemy(p, this.players.get(s) || p))) this.vehicles.damage(vehicle, def.dudVehicle, p, b.w, 'bullet'); }
      else { this.damage(victim, def.dudDamage, p, b.w); this.emit({ t: 'bhit', b: b.id, p: point.map((v) => +v.toFixed(2)), v: victim.id }); }
      return;
    }
    if (vehicle) {
      this.emit({ t: 'bhit', b: b.id, p: point.map((v) => +v.toFixed(2)), vh: vehicle.id });
      const friendly = !vehicle.seats.some((s) => s) ? vehicle.team === p.team : vehicle.seats.every((s) => !s || !this.isEnemy(p, this.players.get(s) || p));
      if (def.splash) {
        // (a launcher's shaped charge: where it strikes the hull matters)
        const aspect = def.launcher ? armourAspect(vehicle, { x: point[0] - b.pts[0].x, z: point[2] - b.pts[0].z }) : 1;
        if (!friendly) this.vehicles.damage(vehicle, (def.directHit || def.vehicleDamage) * aspect, p, b.w, 'explosive');
        this.explodeAt(point[0], point[1], point[2], { radius: def.splash, damage: def.damage, owner: p, weapon: b.w, vehicleDamage: 0 });
      } else if (!friendly) this.vehicles.damage(vehicle, def.vehicleDamage ?? (def.range ? damageAt(def, dist) : def.damage), p, b.w, 'bullet');
      return;
    }
    if (def.splash) { this.explodeAt(point[0], point[1], point[2], { radius: def.splash, damage: def.damage, owner: p, weapon: b.w, vehicleDamage: def.vehicleDamage }); }
    // hit zones: a head hit with a rifle round is lethal, legs/hips take less than the torso
    const zone = head ? def.headMul || 1.5 : part === 'legs' ? def.legMul ?? 0.75 : 1;
    const dmg = def.splash ? def.directHit || def.damage : (def.range ? damageAt(def, dist) : def.damage) * zone;
    const wasAlive = victim.alive;
    this.damage(victim, dmg, p, b.w, head);
    const killed = wasAlive && !victim.alive;
    this.emit({ t: 'bhit', b: b.id, p: point.map((v) => +v.toFixed(2)), v: victim.id });
    // only the shooter gets the hit marker (bots have no screen: sending it with no recipient would reach everyone)
    if (!p.bot) this.emit({ t: 'hitmark', hs: head, k: killed, d: Math.round(dmg), v: victim.id, r: Math.round(dist) }, p);
  }

  reload(p) {
    if (!p.alive) return;
    const w = p.weapons[p.slot]; if (!w) return;
    const def = WEAPONS[w.id];
    if (w.mag >= def.mag || w.reserve <= 0 || this.now() < p.reloadUntil) return;
    const t = (w.mag === 0 ? def.reloadEmpty : def.reload) * 1000;
    p.reloadUntil = this.now() + t;
    p.reloadSlot = p.slot;
    this.emit({ t: 'reload', id: p.id, dur: t });
  }

  throwGrenade(p, o, d) {
    if (!p.alive || p.grenades <= 0 || this.roundOver) return;
    if (!Array.isArray(d) || d.length < 3 || !d.slice(0, 3).every(Number.isFinite)) return;
    const dl = Math.hypot(d[0], d[1], d[2]);
    if (dl < 1e-6) return;
    p.grenades--;
    const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
    // an overarm throw: ~15 m/s release (≈ 30 m on a lob), part of the thrower's own run carried over
    const sp = GRENADE.throwSpeed;
    this.grenades.push({ id: nextId++, owner: p.id, team: p.team, x: eye.x, y: eye.y, z: eye.z, vx: (d[0] / dl) * sp + (p.vx || 0) * 0.5, vy: (d[1] / dl) * sp + 1.5, vz: (d[2] / dl) * sp + (p.vz || 0) * 0.5, fuse: GRENADE.fuse });
    this.emit({ t: 'throw', id: p.id, g: p.grenades }, null);
  }

  stepGrenades(dt) {
    for (const g of this.grenades) {
      g.fuse -= dt;
      const sub = 4;
      for (let i = 0; i < sub; i++) {
        const h = dt / sub;
        g.vy -= GRENADE.gravity * h;
        const v = Math.hypot(g.vx, g.vy, g.vz);
        if (v > 1e-4) {
          const d = { x: g.vx / v, y: g.vy / v, z: g.vz / v };
          // a window pane in the way shatters and takes some of the speed off
          const to = { x: g.x + g.vx * h, y: g.y + g.vy * h, z: g.z + g.vz * h };
          for (const gh of this.world.glassAlong(g, to)) {
            if (this.glassBroken.has(gh.pane.id)) continue;
            this.breakGlass(gh.pane, [g.x + (to.x - g.x) * gh.t, g.y + (to.y - g.y) * gh.t, g.z + (to.z - g.z) * gh.t], [d.x, d.y, d.z]);
            g.vx *= 0.7; g.vy *= 0.7; g.vz *= 0.7;
          }
          const hit = this.world.raycast(g, d, v * h + 0.06, false);
          if (hit) {
            const n = hit.normal, vn = g.vx * n[0] + g.vy * n[1] + g.vz * n[2];
            g.vx = (g.vx - 2 * vn * n[0]) * 0.45; g.vy = (g.vy - 2 * vn * n[1]) * 0.35; g.vz = (g.vz - 2 * vn * n[2]) * 0.45;
            g.x = hit.point[0] + n[0] * 0.07; g.y = hit.point[1] + n[1] * 0.07; g.z = hit.point[2] + n[2] * 0.07;
            if (Math.abs(vn) > 3) this.emit({ t: 'bounce', x: g.x, y: g.y, z: g.z });
            continue;
          }
        }
        g.x += g.vx * h; g.y += g.vy * h; g.z += g.vz * h;
      }
      if (g.fuse <= 0) this.explode(g);
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }

  explode(g) {
    const owner = this.players.get(g.owner) || null;
    this.emit({ t: 'boom', x: g.x, y: g.y, z: g.z });
    this.#glassBlast(g.x, g.y, g.z, GRENADE.radius * 1.4);
    for (const q of this.players.values()) {
      if (!q.alive || (q.vehicle && !q.exposed)) continue; // armour protects the crew
      const c = { x: q.x, y: q.y + (q.stance === 'prone' ? 0.3 : 1.0), z: q.z };
      const dist = Math.hypot(c.x - g.x, c.y - g.y, c.z - g.z);
      if (dist > GRENADE.radius) continue;
      const o = { x: g.x, y: g.y + 0.15, z: g.z };
      if (!this.world.lineOfSight(o, c)) continue;
      // a vehicle hull between the blast and the soldier shields them too
      const vd = { x: (c.x - o.x) / (dist || 1), y: (c.y - o.y) / (dist || 1), z: (c.z - o.z) / (dist || 1) };
      if (q.vehicle == null && this.vehicles.rayTest(o, vd, dist - 0.3, null)) continue;
      if (owner && q !== owner && !this.isEnemy(owner, q)) continue;
      const f = 1 - dist / GRENADE.radius;
      this.damage(q, GRENADE.maxDamage * f * f + (dist < 2 ? 40 : 0), owner, 'grenade');
    }
    this.vehicles.explosion(g.x, g.y, g.z, GRENADE.radius, 160, owner, 'grenade', 'grenade');
  }

  // ray test against every vehicle placed where it was at time t (pose history), then put them back
  #vehicleRayAt(o, d, maxT, shooter, t) {
    const moved = [];
    for (const v of this.vehicles.list) {
      const h = v.hist;
      if (!h?.length || v.dead || t >= h[h.length - 1].t) continue;
      let a = h[0], b = h[0];
      for (let i = h.length - 1; i > 0; i--) if (h[i - 1].t <= t) { a = h[i - 1]; b = h[i]; break; }
      const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
      moved.push([v, v.x, v.y, v.z, v.yaw, v.pitch]);
      v.x = a.x + (b.x - a.x) * k; v.y = a.y + (b.y - a.y) * k; v.z = a.z + (b.z - a.z) * k;
      v.yaw = a.yaw + angleDiff(a.yaw, b.yaw) * k; v.pitch = a.pitch + (b.pitch - a.pitch) * k;
    }
    try { return this.vehicles.rayTest(o, d, maxT, shooter); } finally {
      for (const [v, x, y, z, yaw, pitch] of moved) Object.assign(v, { x, y, z, yaw, pitch });
    }
  }

  // soldiers are solid: a bot that walked into someone is pushed back out (players' own movement does the same
  // client-side), then kept out of walls
  separate(p) {
    const R = 0.62;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.vehicle || q.air) continue;
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
      if (d >= R || Math.abs(q.y - p.y) > 1.6) continue;
      const nx = d > 1e-3 ? dx / d : Math.cos(p.id), nz = d > 1e-3 ? dz / d : Math.sin(p.id);
      p.x += nx * (R - d); p.z += nz * (R - d);
    }
    this.world.resolveHorizontal(p, p.y, 1.8);
  }

  historyAt(q, t) {
    const h = q.history;
    if (!h.length) return q;
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1], b = h[i], k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1, b.t - a.t)));
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, yaw: b.yaw, stance: b.stance };
      }
    }
    return h[0];
  }

  // health regeneration (faster for medics, who also heal teammates close by) and support ammo resupply
  #sustain(p, dt, now) {
    const c = CLASSES[p.cls];
    const quiet = now - (p.lastHit || 0);
    if (p.hp < 100 && quiet > (c?.medic ? 3000 : 6000)) p.hp = Math.min(100, p.hp + (c?.medic ? 12 : 5) * dt);
    if (!c?.medic && !c?.resupply) return;
    p.auraT = (p.auraT || 0) + dt;
    if (p.auraT < 1) return;
    p.auraT = 0;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team !== p.team || q.vehicle || Math.hypot(q.x - p.x, q.z - p.z) > 8) continue;
      if (c.medic && q.hp < 100 && now - (q.lastHit || 0) > 1500) {
        const h = Math.min(6, 100 - q.hp); q.hp += h;
        // patching teammates up: 10 points per 30 hp given
        p.healAcc = (p.healAcc || 0) + h;
        if (p.healAcc >= 30) { p.healAcc -= 30; this.award(p, 10, 'heal'); }
      }
      if (c.resupply) {
        const w = q.weapons[0], def = w && WEAPONS[w.id];
        if (def && w.reserve < def.reserve) {
          w.reserve = Math.min(def.reserve * (CLASSES[q.cls]?.ammoMul || 1), w.reserve + Math.ceil(def.mag / 3)); if (!q.bot) this.emit({ t: 'ammo', w: q.weapons, g: q.grenades }, q);
          p.ammoAcc = (p.ammoAcc || 0) + 1;
          if (p.ammoAcc >= 3) { p.ammoAcc = 0; this.award(p, 10, 'resupply'); }
        }
      }
    }
  }

  // ------------------------------------------------------------ conquest
  stepFlags(dt) {
    for (const f of this.flags) {
      const n = { 1: 0, 2: 0 };
      for (const p of this.players.values()) {
        if (p.alive && Math.hypot(p.x - f.x, p.z - f.z) < f.r && Math.abs(p.y - this.map.groundHeight(f.x, f.z)) < 8) n[p.team]++;
      }
      f.inside = n;
      const diff = n[1] - n[2];
      f.contested = n[1] > 0 && n[2] > 0;
      if (!diff) continue;
      const rate = 0.09 * Math.min(3, Math.abs(diff)) * dt * Math.sign(diff);
      const before = f.owner;
      f.progress = Math.max(-1, Math.min(1, f.progress + rate));
      if (f.owner === 1 && f.progress <= 0) f.owner = 0;
      if (f.owner === 2 && f.progress >= 0) f.owner = 0;
      if (f.progress >= 1) f.owner = 1;
      if (f.progress <= -1) f.owner = 2;
      if (before !== f.owner) {
        this.emit({ t: 'flag', id: f.id, owner: f.owner, prev: before });
        const team = f.owner || (before === 1 ? 2 : 1);
        for (const p of this.players.values()) if (p.alive && p.team === team && Math.hypot(p.x - f.x, p.z - f.z) < f.r) this.award(p, f.owner ? 200 : 100, f.owner ? 'capture' : 'neutralize', { f: f.id });
      }
    }
    const owned = { 1: 0, 2: 0 };
    for (const f of this.flags) if (f.owner) owned[f.owner]++;
    for (const [a, b] of [[1, 2], [2, 1]]) {
      if (owned[a] > owned[b]) {
        this.bleedAcc[b] += dt * (owned[a] - owned[b]) * (owned[b] === 0 ? 0.3 : 0.14);
        while (this.bleedAcc[b] >= 1) { this.bleedAcc[b]--; this.tickets[b] = Math.max(0, this.tickets[b] - 1); }
      }
    }
    if (!this.roundOver && (this.tickets[1] <= 0 || this.tickets[2] <= 0)) {
      const winner = this.tickets[1] > this.tickets[2] ? 1 : 2;
      this.roundOver = { winner, at: this.now() };
      this.emit({ t: 'round', winner, name: TEAM_NAMES[winner], ...this.roundSummary() });
    }
  }

  // the end-of-round summary: tickets left, every soldier's round (the client picks the top players and the ribbons)
  roundSummary() {
    const S = (p, k) => p.stats?.[k] || 0;
    return {
      tk: [this.tickets[1], this.tickets[2]], next: 15000, dur: Math.round((this.now() - this.roundStart) / 1000),
      // [id, name, team, score, kills, deaths, assists, revives, captures, spot assists, vehicles, headshots, longest kill, bot]
      ps: [...this.players.values()].map((p) => [p.id, p.name, p.team, p.score, p.kills, p.deaths, S(p, 'assist'), S(p, 'revive'), S(p, 'capture') + S(p, 'neutralize'), S(p, 'spot'), S(p, 'vehicle'), S(p, 'headshot'), S(p, 'longest'), p.bot ? 1 : 0]),
    };
  }

  // ------------------------------------------------------------ main tick
  tick(dt) {
    const now = this.now();
    this.time += dt;
    if (this.roundOver && now - this.roundOver.at > 15000) this.resetRound();
    this.balanceBots();
    if ((this.squadT = (this.squadT || 0) + 1) % 15 === 0) this.organiseSquads(); // (team switches)
    // the collision world is shared by every room on this map: install this room's vehicles before simulating
    this.world.dynamic = this.vehicles.colliders; this.world.ignoreOwner = null;
    this.vehicles.tick(dt, now);
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.bot && now >= p.respawnAt && !this.roundOver && !(p.downed && this.medicNear(p))) {
          const opts = this.spawnOptions(p.team);
          // half the time on a squad mate who is clear to spawn on (closer to the fight than a flag or the HQ)
          const mates = this.squadsEnabled && Math.random() < 0.5 ? this.squadMates(p).filter((m) => !m.vehicle && !this.squadBlock(p, m, now)) : [];
          this.spawn(p, mates.length ? `@${mates[Math.floor(Math.random() * mates.length)].id}` : opts[Math.floor(Math.random() * opts.length)].id);
        }
        continue;
      }
      if (p.vehicle) {
        // seated: position comes from the vehicle; bots in vehicles are handled by the vehicle system
        if (p.bot && p.brain.vehicleThink) p.brain.vehicleThink(dt);
      } else if (p.bot) {
        const input = p.brain.think(dt);
        if (p.air) stepAir(this.world, p, input, dt); else { stepCharacter(this.world, p, input, dt); this.separate(p); }
        if (p.fall > 0) this.damage(p, p.fall, null, 'fall');
        if (p.y < -30) this.kill(p, null, 'fall');
      } else if (now - p.lastInput > 8000) {
        // AFK/disconnected-ish: no inputs; nothing to simulate
      }
      if (p.reloadUntil && now >= p.reloadUntil) {
        const w = p.weapons[p.reloadSlot ?? p.slot];
        if (w) { const need = WEAPONS[w.id].mag - w.mag, take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; }
        p.reloadUntil = 0;
        if (!p.bot) this.emit({ t: 'ammo', w: p.weapons, g: p.grenades }, p);
      }
      this.#sustain(p, dt, now);
      if (Math.abs(p.x) > this.map.PLAY_HALF + 4 || Math.abs(p.z) > this.map.PLAY_HALF + 4) this.damage(p, 12 * dt, null, 'boundary');
      // the enemy HQ is out of bounds (like an uncap base): warn, then hurt, so nobody camps the spawn
      else if (this.restrictedHQ) {
        const eb = this.map.BASES[p.team === 1 ? 2 : 1];
        if (eb && Math.hypot(p.x - eb.x, p.z - eb.z) < this.restrictedHQ) {
          p.inRestricted = (p.inRestricted || 0) + dt;
          if (!p.bot && (!p.restrictedMsg || now - p.restrictedMsg > 1000)) { p.restrictedMsg = now; this.emit({ t: 'restricted', left: Math.max(0, 5 - p.inRestricted) }, p); }
          if (p.inRestricted > 5) this.damage(p, 25 * dt, null, 'restricted');
        } else p.inRestricted = 0;
      }
      p.history.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance });
      while (p.history.length && p.history[0].t < now - HISTORY_MS) p.history.shift();
    }
    // vehicle poses too, so shots at a moving jeep / helicopter are judged where the shooter saw it
    for (const v of this.vehicles.list) {
      const h = v.hist || (v.hist = []);
      h.push({ t: now, x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch || 0 });
      while (h.length && h[0].t < now - HISTORY_MS) h.shift();
    }
    for (const a of this.agents) a.tick();
    this.stepBullets(now);
    this.stepGrenades(dt);
    this.#casualties(now);
    this.stepFlags(dt);
  }

  // ------------------------------------------------------------ networking helpers
  emit(ev, only = null, alsoIds = null) {
    this.events.push({ ev, only: only ? only.id : null, ids: alsoIds });
    for (const a of this.agents) a.onEvent(ev);
  }

  flushEvents() { const e = this.events; this.events = []; return e; }

  snapshot() {
    const now = this.now();
    const P = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const w = p.weapons[p.slot];
      const flags = (p.ads ? 1 : 0) | (p.sprint ? 2 : 0) | (now < p.reloadUntil ? 4 : 0) | (now - p.lastFireFlag < 120 ? 8 : 0) | (p.onGround ? 16 : 0) | (p.air === 1 ? 32 : 0) | (p.air === 2 ? 64 : 0) | (p.vehicle && !p.exposed ? 128 : 0);
      P.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), STANCES.indexOf(p.stance), flags, w ? w.id : '', Math.max(0, Math.round(p.hp)), +(p.vx || 0).toFixed(2), +(p.vz || 0).toFixed(2)]);
    }
    return {
      t: 'snap', time: now, p: P,
      g: this.grenades.map((g) => [g.id, +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)]),
      f: this.flags.map((f) => [f.id, f.owner, +f.progress.toFixed(3), f.contested ? 1 : 0]),
      tk: [this.tickets[1], this.tickets[2]],
      veh: this.vehicles.list.length ? this.vehicles.snapshot() : undefined,
      dn: this.#downedList(now),
    };
  }

  #downedList(now) {
    const out = [];
    for (const p of this.players.values()) if (p.downed) out.push([p.id, p.team, +p.downed.x.toFixed(2), +p.downed.y.toFixed(2), +p.downed.z.toFixed(2), Math.ceil((p.downed.until - now) / 1000)]);
    return out.length ? out : undefined;
  }

  scoreboard() {
    return {
      t: 'board',
      rows: [...this.players.values()].map((p) => ({ id: p.id, n: p.name, tm: p.team, k: p.kills, d: p.deaths, s: p.score, b: p.bot ? 1 : 0, ai: p.agent ? 1 : 0, png: p.bot ? 0 : Math.round(p.rtt), a: p.alive ? 1 : 0, c: p.cls, sq: p.squad || 0 })),
    };
  }
}
