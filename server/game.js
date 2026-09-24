// Authoritative Conquest game simulation.
import { CollisionWorld, stepCharacter, EYE_HEIGHT, STANCE_HEIGHT, MOVE } from '../shared/world.js';
import { TEAM_NAMES, getMap } from '../shared/map.js';
import { WEAPONS, CLASSES, GRENADE, damageAt, hitCapsules, rayCapsule } from '../shared/weapons.js';
import { NavGrid } from './nav.js';
import { BotBrain } from './bots.js';

export const TICK_HZ = 30;
export const SNAP_HZ = 20;
const START_TICKETS = 300;
const RESPAWN_DELAY = 5;
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
      const world = new CollisionWorld(this.map), nav = new NavGrid(world);
      this.log(`[game] ${this.map.id}: collision + nav grid ${nav.n}x${nav.n} built in ${Date.now() - t0} ms`);
      const v = { world, nav }; worldCache.set(this.map.id, v); return v;
    })();
    this.world = shared.world;
    this.nav = shared.nav;
    this.players = new Map();
    this.grenades = [];
    this.botsPerTeam = botsPerTeam;
    this.events = [];
    this.time = 0;
    this.resetRound();
  }

  now() { return this.clock ?? Date.now(); }

  resetRound() {
    this.tickets = { 1: START_TICKETS, 2: START_TICKETS };
    this.flags = this.map.FLAGS.map((f) => ({ ...f, owner: f.owner || 0, progress: f.owner === 1 ? 1 : f.owner === 2 ? -1 : 0, contested: false }));
    this.roundOver = null;
    this.bleedAcc = { 1: 0, 2: 0 };
    this.grenades = [];
    for (const p of this.players.values()) {
      p.kills = p.deaths = p.score = 0;
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
      lastInput: this.now(), lastFireFlag: 0, lastDamageFrom: null,
    };
    if (bot) p.brain = new BotBrain(this, p);
    this.players.set(p.id, p);
    return p;
  }

  removePlayer(id) { this.players.delete(id); }

  teamCounts(humansToo = false) {
    const c = { 1: 0, 2: 0 };
    for (const p of this.players.values()) if (humansToo || !p.bot) c[p.team]++;
    return c;
  }

  balanceBots() {
    const humans = { 1: 0, 2: 0 }, bots = { 1: [], 2: [] };
    for (const p of this.players.values()) (p.bot ? bots[p.team].push(p) : humans[p.team]++);
    const names = ['Reyes', 'Kowalski', 'Hansen', 'Ivanov', 'Okafor', 'Brandt', 'Novak', 'Sato', 'Moreau', 'Petrov', 'Walsh', 'Lindqvist', 'Costa', 'Bauer', 'Kaya', 'Volkov', 'Garcia', 'Duarte', 'Fischer', 'Sokolov'];
    for (const t of [1, 2]) {
      const want = Math.max(0, this.botsPerTeam - humans[t]);
      while (bots[t].length < want) {
        const n = names[Math.floor(Math.random() * names.length)];
        bots[t].push(this.addPlayer({ name: `[BOT] ${n}`, bot: true, team: t, cls: Math.random() < 0.8 ? 'assault' : 'recon' }));
      }
      while (bots[t].length > want) this.removePlayer(bots[t].pop().id);
    }
  }

  spawnOptions(team) {
    const opts = [{ id: 'base', x: this.map.BASES[team].x, z: this.map.BASES[team].z }];
    for (const f of this.flags) if (f.owner === team) opts.push({ id: f.id, x: f.x, z: f.z });
    return opts;
  }

  spawn(p, pointId = 'base', cls) {
    if (p.alive || this.roundOver) return false;
    if (this.now() < p.respawnAt) return false;
    if (cls && CLASSES[cls]) p.cls = cls;
    const opt = this.spawnOptions(p.team).find((o) => o.id === pointId) || this.spawnOptions(p.team)[0];
    let x = opt.x, z = opt.z;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, r = opt.id === 'base' ? 3 + Math.random() * 9 : 8 + Math.random() * 10;
      x = opt.x + Math.cos(a) * r; z = opt.z + Math.sin(a) * r;
      const pos = { x, z };
      const gy = this.map.groundHeight(x, z);
      if (!this.world.resolveHorizontal(pos, gy, 1.8) && this.world.supportHeight(x, z, gy + 0.2) < gy + 0.3) break;
    }
    const c = CLASSES[p.cls];
    Object.assign(p, {
      alive: true, hp: 100, x, z, y: this.world.supportHeight(x, z, this.map.groundHeight(x, z) + 0.3), vx: 0, vy: 0, vz: 0, stance: 'stand', onGround: true,
      yaw: this.map.BASES[p.team].yaw + (Math.random() - 0.5) * 0.4, pitch: 0, slot: 0, reloadUntil: 0, nextFire: 0, grenades: c.grenades,
      weapons: [c.primary, c.secondary].map((id) => ({ id, mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve })),
      spawnProtect: this.now() + 2000, history: [], lastDamageFrom: null, spawnPoint: opt.id,
    });
    p.lastInput = this.now();
    if (p.brain) p.brain.onSpawn();
    this.emit({ t: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, cls: p.cls, w: p.weapons, g: p.grenades }, p.bot ? null : p);
    return true;
  }

  kill(p, killer, weapon, silent = false) {
    if (!p.alive) return;
    p.alive = false; p.hp = 0;
    p.respawnAt = this.now() + RESPAWN_DELAY * 1000;
    if (silent) return;
    p.deaths++;
    this.tickets[p.team] = Math.max(0, this.tickets[p.team] - 1);
    if (killer && killer !== p && killer.team !== p.team) { killer.kills++; killer.score += 100; }
    this.emit({ t: 'kill', v: p.id, k: killer ? killer.id : 0, w: weapon, hs: p.lastHeadshot || false, kx: killer?.x, ky: killer?.y, kz: killer?.z });
  }

  damage(victim, amount, attacker, weapon, head = false) {
    if (!victim.alive || this.now() < victim.spawnProtect) return;
    if (attacker && attacker !== victim && attacker.team === victim.team) return; // no friendly fire
    victim.hp -= amount;
    victim.lastHeadshot = head;
    victim.lastDamageFrom = attacker ? attacker.id : 0;
    victim.lastHit = this.now();
    if (victim.brain) victim.brain.onDamaged(attacker);
    this.emit({ t: 'hurt', v: victim.id, a: attacker ? attacker.id : 0, d: Math.round(amount), hs: head, ax: attacker?.x, az: attacker?.z }, null, [victim.id, attacker?.id]);
    if (victim.hp <= 0) this.kill(victim, attacker, weapon);
  }

  // ------------------------------------------------------------ input from humans
  handleInput(p, m) {
    if (!p.alive) return;
    const now = this.now();
    const dt = Math.max(0.001, (now - p.lastInput) / 1000);
    p.lastInput = now;
    const dx = m.x - p.x, dz = m.z - p.z;
    const allowed = MOVE.sprint * 1.6 * Math.min(dt, 0.5) + 0.6;
    if (process.env.DEV_TELEPORT && Number.isFinite(m.x + m.y + m.z)) { p.x = m.x; p.y = m.y; p.z = m.z; }
    else if (Math.hypot(dx, dz) > allowed || !Number.isFinite(m.x + m.y + m.z) || Math.abs(m.x) > this.map.PLAY_HALF + 10 || Math.abs(m.z) > this.map.PLAY_HALF + 10) {
      this.emit({ t: 'correct', x: p.x, y: p.y, z: p.z }, p);
    } else {
      p.x = m.x; p.y = m.y; p.z = m.z;
    }
    p.yaw = +m.yaw || 0; p.pitch = Math.max(-1.5, Math.min(1.5, +m.pitch || 0));
    p.stance = STANCES.includes(m.st) ? m.st : 'stand';
    p.ads = !!m.ads; p.sprint = !!m.sp; p.vx = +m.vx || 0; p.vz = +m.vz || 0; p.onGround = !!m.og;
    if (m.sl === 0 || m.sl === 1) { if (m.sl !== p.slot) { p.slot = m.sl; p.reloadUntil = 0; } }
  }

  // ------------------------------------------------------------ weapons
  tryFire(p, origin, dir, clientTime) {
    const now = this.now();
    if (!p.alive || now < p.reloadUntil || this.roundOver) return false;
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

    const maxRange = 600;
    const wh = this.world.raycast(o, d, maxRange, true);
    let best = wh ? wh.t : maxRange, victim = null, head = false;
    const rewindTo = now - (p.bot ? 0 : Math.min(250, p.rtt / 2 + 100));
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team) continue;
      const hp = p.bot ? q : this.historyAt(q, rewindTo);
      if (Math.hypot(hp.x - o.x, hp.z - o.z) > best + 2) continue;
      for (const c of hitCapsules(hp)) {
        const t = rayCapsule(o, d, c.a, c.b, c.r);
        if (t !== null && t < best) { best = t; victim = q; head = c.part === 'head'; }
      }
    }
    const end = [o.x + d.x * best, o.y + d.y * best, o.z + d.z * best];
    this.emit({ t: 'shot', id: p.id, w: w.id, o: [o.x, o.y, o.z], e: end, s: victim ? 'flesh' : wh && wh.t <= best ? wh.surface : 'none', n: !victim && wh ? wh.normal : null });
    if (victim) {
      let dmg = damageAt(def, best) * (head ? def.headMul : 1);
      this.damage(victim, dmg, p, w.id, head);
      if (!victim.alive) p.score += head ? 20 : 0;
      this.emit({ t: 'hitmark', hs: head, k: !victim.alive }, p.bot ? null : p);
    }
    if (w.mag === 0 && p.bot) this.reload(p);
    return true;
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
    p.grenades--;
    const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    const sp = GRENADE.throwSpeed;
    this.grenades.push({ id: nextId++, owner: p.id, team: p.team, x: eye.x, y: eye.y, z: eye.z, vx: (d[0] / dl) * sp + p.vx * 0.5, vy: (d[1] / dl) * sp + 2.5, vz: (d[2] / dl) * sp + p.vz * 0.5, fuse: GRENADE.fuse });
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
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const c = { x: q.x, y: q.y + (q.stance === 'prone' ? 0.3 : 1.0), z: q.z };
      const dist = Math.hypot(c.x - g.x, c.y - g.y, c.z - g.z);
      if (dist > GRENADE.radius) continue;
      if (!this.world.lineOfSight({ x: g.x, y: g.y + 0.15, z: g.z }, c)) continue;
      if (owner && q.team === owner.team && q !== owner) continue;
      const f = 1 - dist / GRENADE.radius;
      this.damage(q, GRENADE.maxDamage * f * f + (dist < 2 ? 40 : 0), owner, 'grenade');
    }
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
        for (const p of this.players.values()) if (p.alive && p.team === team && Math.hypot(p.x - f.x, p.z - f.z) < f.r) p.score += f.owner ? 200 : 100;
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
      this.emit({ t: 'round', winner, name: TEAM_NAMES[winner] });
    }
  }

  // ------------------------------------------------------------ main tick
  tick(dt) {
    const now = this.now();
    this.time += dt;
    if (this.roundOver && now - this.roundOver.at > 15000) this.resetRound();
    this.balanceBots();
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.bot && now >= p.respawnAt && !this.roundOver) {
          const opts = this.spawnOptions(p.team);
          this.spawn(p, opts[Math.floor(Math.random() * opts.length)].id);
        }
        continue;
      }
      if (p.bot) {
        const input = p.brain.think(dt);
        stepCharacter(this.world, p, input, dt);
        if (p.y < -30) this.kill(p, null, 'fall');
      } else if (now - p.lastInput > 8000) {
        // AFK/disconnected-ish: no inputs; nothing to simulate
      }
      if (p.reloadUntil && now >= p.reloadUntil) {
        const w = p.weapons[p.reloadSlot ?? p.slot];
        if (w) { const need = WEAPONS[w.id].mag - w.mag, take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; }
        p.reloadUntil = 0;
        this.emit({ t: 'ammo', w: p.weapons, g: p.grenades }, p.bot ? null : p);
      }
      if (Math.abs(p.x) > this.map.PLAY_HALF + 4 || Math.abs(p.z) > this.map.PLAY_HALF + 4) this.damage(p, 12 * dt, null, 'boundary');
      p.history.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance });
      while (p.history.length && p.history[0].t < now - HISTORY_MS) p.history.shift();
    }
    this.stepGrenades(dt);
    this.stepFlags(dt);
  }

  // ------------------------------------------------------------ networking helpers
  emit(ev, only = null, alsoIds = null) {
    this.events.push({ ev, only: only ? only.id : null, ids: alsoIds });
  }

  flushEvents() { const e = this.events; this.events = []; return e; }

  snapshot() {
    const now = this.now();
    const P = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const w = p.weapons[p.slot];
      const flags = (p.ads ? 1 : 0) | (p.sprint ? 2 : 0) | (now < p.reloadUntil ? 4 : 0) | (now - p.lastFireFlag < 120 ? 8 : 0) | (p.onGround ? 16 : 0);
      P.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3), +p.pitch.toFixed(3), STANCES.indexOf(p.stance), flags, w ? w.id : '', Math.max(0, Math.round(p.hp)), +(p.vx || 0).toFixed(2), +(p.vz || 0).toFixed(2)]);
    }
    return {
      t: 'snap', time: now, p: P,
      g: this.grenades.map((g) => [g.id, +g.x.toFixed(2), +g.y.toFixed(2), +g.z.toFixed(2)]),
      f: this.flags.map((f) => [f.id, f.owner, +f.progress.toFixed(3), f.contested ? 1 : 0]),
      tk: [this.tickets[1], this.tickets[2]],
    };
  }

  scoreboard() {
    return {
      t: 'board',
      rows: [...this.players.values()].map((p) => ({ id: p.id, n: p.name, tm: p.team, k: p.kills, d: p.deaths, s: p.score, b: p.bot ? 1 : 0, png: p.bot ? 0 : Math.round(p.rtt), a: p.alive ? 1 : 0 })),
    };
  }
}
