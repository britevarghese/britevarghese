// Battle royale ("Firestorm"-style) game mode: warm-up lobby -> transport plane flies over the island -> everyone
// jumps (freefall + parachute) -> loot weapons, armor, med kits -> the ring of fire closes in -> no respawns,
// last one standing wins -> next match.
import { Game } from './game.js';
import { BotBrain } from './bots.js';
import { WEAPONS } from '../shared/weapons.js';
import { ROYALE, LOOT, rollLoot, RING_PHASES, ringAt, planeLine, stepAir } from '../shared/royale.js';
import { stepCharacter } from '../shared/world.js';
import { angleDiff, clamp } from '../shared/util.js';

const PHASES = ['lobby', 'plane', 'live', 'over'];
const NAMES = ['Reyes', 'Kowalski', 'Hansen', 'Ivanov', 'Okafor', 'Brandt', 'Novak', 'Sato', 'Moreau', 'Petrov', 'Walsh', 'Lindqvist', 'Costa', 'Bauer', 'Kaya', 'Volkov', 'Garcia', 'Duarte', 'Fischer', 'Sokolov', 'Nakamura', 'Haddad', 'Silva', 'Jensen'];
const rand = (a, b) => a + Math.random() * (b - a);

export class RoyaleGame extends Game {
  constructor({ bots = 14, log = console.log, map = 'firestorm', lobbyTime = ROYALE.lobbyTime } = {}) {
    super({ botsPerTeam: 0, log, map });
    this.mode = 'royale';
    this.BotBrainClass = RoyaleBrain;
    this.botTotal = Math.max(0, Math.min(23, bots));
    this.lobbyTime = lobbyTime;
  }

  isEnemy(a, b) { return a !== b; }

  resetRound() {
    this.phase = 'lobby';
    this.lobbyEnd = null;
    this.tickets = { 1: 0, 2: 0 };
    this.flags = [];
    this.roundOver = null;
    this.grenades = []; this.bullets = [];
    this.ring = null; this.plane = null; this.drops = [];
    this.loot = new Map(); this.lootSeq = 1;
    this.startCount = 0;
    for (const p of [...this.players.values()]) {
      if (p.bot) { this.players.delete(p.id); continue; }
      Object.assign(p, { alive: false, inPlane: false, air: 0, hp: 100, kills: 0, deaths: 0, score: 0, place: 0, armor: 0, meds: 0, healUntil: 0, weapons: [null, null] });
    }
    this.emit({ t: 'loot', all: [] });
  }

  addPlayer(opts) {
    const p = super.addPlayer({ ...opts, team: opts.bot ? opts.team : 1 + (this.players.size % 2) });
    Object.assign(p, { inPlane: false, air: 0, armor: 0, meds: 0, healUntil: 0, place: 0, weapons: [null, null], respawnAt: Infinity });
    // late joiners board the plane while it is still over the first part of the island
    if (!p.bot && this.phase === 'plane' && this.planeK(this.now()) < this.plane.jumpUntil - 0.2) p.inPlane = true;
    return p;
  }

  // sent to a player right after joining (current loot on the ground)
  joinPayload() { return { t: 'ev', e: { t: 'loot', all: [...this.loot.values()].map(lootRow) } }; }

  balanceBots() {
    if (this.phase !== 'lobby') return;
    const bots = [...this.players.values()].filter((p) => p.bot);
    const humans = this.players.size - bots.length;
    const want = humans ? this.botTotal : 0;
    while (bots.length < want) {
      const n = NAMES[Math.floor(Math.random() * NAMES.length)];
      bots.push(this.addPlayer({ name: `[BOT] ${n}`, bot: true, team: 1 + (bots.length % 2), cls: 'assault' }));
    }
    while (bots.length > want) this.removePlayer(bots.pop().id);
  }

  spawn() { return false; } // no respawns: you enter the island by jumping out of the plane

  // ---------------------------------------------------------------- match flow
  aliveCount() { let n = 0; for (const p of this.players.values()) if (p.alive || p.inPlane) n++; return n; }

  startMatch(now) {
    this.phase = 'plane';
    const half = this.map.PLAY_HALF;
    const line = planeLine(half, Math.random);
    const len = Math.hypot(line.bx - line.ax, line.bz - line.az);
    // the plane is only over the island between these fractions of its path
    const inside = (half * 0.8) / len;
    this.plane = { ...line, len, t0: now, dur: (len / ROYALE.planeSpeed) * 1000, y: ROYALE.planeAlt, jumpFrom: 0.5 - inside, jumpUntil: 0.5 + inside };
    const R0 = half * 1.45, ph = RING_PHASES[0];
    this.ring = { cx: 0, cz: 0, r: R0, stage: 0, dmg: 0, ...this.#nextCircle(0, 0, R0, ph.r * R0), t0: now + ph.wait * 1000, t1: now + (ph.wait + ph.shrink) * 1000 };
    this.#generateLoot();
    for (const p of this.players.values()) {
      Object.assign(p, { alive: false, inPlane: true, air: 0, hp: 100, armor: 0, meds: 0, healUntil: 0, place: 0, kills: 0, deaths: 0, score: 0, weapons: [null, null], grenades: 0, history: [] });
      if (p.bot) p.brain.onBoard(this.plane);
    }
    this.startCount = this.aliveCount();
    this.emit({ t: 'match', n: this.startCount });
    this.log(`[royale] match started: ${this.startCount} players`);
  }

  planeK(now) { return this.plane ? (now - this.plane.t0) / this.plane.dur : 0; }

  planePos(now) {
    const P = this.plane, k = this.planeK(now);
    return { x: P.ax + (P.bx - P.ax) * k, z: P.az + (P.bz - P.az) * k, y: P.y, k };
  }

  jump(p) {
    if (!p.inPlane || this.phase !== 'plane') return;
    const now = this.now(), pp = this.planePos(now);
    if (pp.k < this.plane.jumpFrom) return;
    p.inPlane = false;
    const pistol = WEAPONS.pistol;
    Object.assign(p, {
      alive: true, hp: 100, x: pp.x + rand(-2, 2), z: pp.z + rand(-2, 2), y: pp.y - 4, vx: this.plane.dx * 22, vz: this.plane.dz * 22, vy: -4,
      air: 1, onGround: false, stance: 'stand', yaw: Math.atan2(-this.plane.dx, -this.plane.dz), pitch: -0.6, slot: 1, reloadUntil: 0, nextFire: 0,
      weapons: [null, { id: 'pistol', mag: pistol.mag, reserve: 0 }], grenades: 0, armor: 0, meds: 0, spawnProtect: 0, history: [], lastDamageFrom: null,  airPeak: null,
    });
    p.lastInput = now;
    if (p.brain) p.brain.onJump();
    this.emit({ t: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, cls: 'royale', w: p.weapons, g: 0, sl: 1, air: 1, vx: p.vx, vz: p.vz, vy: p.vy }, p.bot ? null : p);
  }

  #stepPlane(now) {
    const k = this.planeK(now);
    for (const p of this.players.values()) {
      if (!p.inPlane) continue;
      if (k >= this.plane.jumpUntil || (p.bot && now >= p.brain.jumpAt)) this.jump(p);
    }
    if (k >= this.plane.jumpUntil && ![...this.players.values()].some((p) => p.inPlane)) this.phase = 'live';
  }

  #nextCircle(cx, cz, r, nr) {
    // new circle entirely inside the current one, kept on the island
    const half = this.map.PLAY_HALF;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * Math.max(0, r - nr) * 0.85;
      const nx = cx + Math.cos(a) * d, nz = cz + Math.sin(a) * d;
      if (Math.abs(nx) < half - nr * 0.35 && Math.abs(nz) < half - nr * 0.35 || i === 19) return { nx: clamp(nx, -half * 0.8, half * 0.8), nz: clamp(nz, -half * 0.8, half * 0.8), nr };
    }
    return { nx: cx, nz: cz, nr };
  }

  #stepRing(now) {
    const g = this.ring; if (!g) return;
    if (now >= g.t0 && g.dmg === 0) g.dmg = RING_PHASES[g.stage].dmg;
    if (now < g.t1) return;
    // this stage closed: the ring now sits at its target and the next stage is announced
    const R0 = this.map.PLAY_HALF * 1.45;
    const stage = g.stage + 1;
    const cur = { cx: g.nx, cz: g.nz, r: g.nr };
    if (stage >= RING_PHASES.length) { Object.assign(g, cur, { nx: cur.cx, nz: cur.cz, nr: cur.r, t0: Infinity, t1: Infinity }); g.t1 = Infinity; return; }
    const ph = RING_PHASES[stage];
    Object.assign(g, cur, this.#nextCircle(cur.cx, cur.cz, cur.r, ph.r * R0), { stage, dmg: RING_PHASES[stage - 1].dmg, t0: now + ph.wait * 1000, t1: now + (ph.wait + ph.shrink) * 1000 });
    this.emit({ t: 'ring', stage });
    if (stage <= 3) this.#supplyDrop(now);
  }

  #supplyDrop(now) {
    const g = this.ring;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * g.nr * 0.7;
      const x = g.nx + Math.cos(a) * d, z = g.nz + Math.sin(a) * d;
      const gy = this.world.supportHeight(x, z, 500);
      if (Math.abs(gy - this.map.groundHeight(x, z)) > 0.5) continue; // not on a roof
      const drop = { id: this.lootSeq++, x, z, gy, y0: gy + 170, t0: now, land: now + (170 / 7.5) * 1000 };
      this.drops.push(drop);
      this.emit({ t: 'supply', ...drop });
      return;
    }
  }

  #stepDrops(now) {
    for (const d of this.drops) {
      if (d.done || now < d.land) continue;
      d.done = true;
      const items = [Math.random() < 0.5 ? 'sniper' : 'ar', 'armor', 'armor', 'med', 'med', 'nade', 'ammo', 'ammo'];
      items.forEach((type, i) => {
        const a = (i / items.length) * Math.PI * 2;
        this.#addLoot(type, d.x + Math.cos(a) * 1.6, d.z + Math.sin(a) * 1.6, d.gy + 0.4, type === 'ar' || type === 'sniper' ? [WEAPONS[type].mag, WEAPONS[type].mag * 4] : undefined);
      });
    }
    this.drops = this.drops.filter((d) => !d.done || now - d.land < 5000);
  }

  // ---------------------------------------------------------------- loot
  #addLoot(type, x, z, yHint, a, broadcast = true) {
    const y = this.world.supportHeight(x, z, yHint);
    const it = { id: this.lootSeq++, type, x: +x.toFixed(2), y: +(y + 0.02).toFixed(2), z: +z.toFixed(2), a };
    if (LOOT[type].kind === 'weapon' && !a) it.a = [WEAPONS[type].mag, WEAPONS[type].mag * 2];
    this.loot.set(it.id, it);
    if (broadcast) this.emit({ t: 'lootadd', it: [lootRow(it)] });
    return it;
  }

  #generateLoot() {
    this.loot.clear();
    const rnd = Math.random, W = this.world;
    for (const b of W.buildings) {
      const s = b.spec, wh = s.style === 'warehouse', bunker = s.style === 'bunker';
      for (let f = 0; f < s.floors; f++) {
        const n = wh ? 4 + Math.floor(rnd() * 3) : bunker ? 2 + Math.floor(rnd() * 2) : 1 + Math.floor(rnd() * 2.4);
        for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
          const x = s.x + (rnd() - 0.5) * (s.w - 2.2), z = s.z + (rnd() - 0.5) * (s.d - 2.2);
          if (x < s.x - s.w / 2 + 2.2 && !wh && !bunker) continue; // keep the stairwell clear
          const floorY = b.y0 + f * b.FH + 0.3;
          const pos = { x, z };
          if (W.resolveHorizontal(pos, floorY, 1.2, 0.35)) continue;
          const y = W.supportHeight(x, z, floorY);
          if (Math.abs(y - floorY) > 0.6) continue;
          this.#addLoot(rollLoot(rnd), x, z, floorY, undefined, false); k++;
        }
      }
    }
    // outdoor caches next to crates, containers and wrecks
    for (const p of this.map.PROPS) {
      if (!['crate_stack', 'container', 'car', 'generator', 'sandbags'].includes(p.type) || rnd() < 0.45) continue;
      const a = rnd() * Math.PI * 2, r = p.type === 'container' ? 3.4 : 2.1;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const pos = { x, z }, gy = this.map.groundHeight(x, z);
      if (W.resolveHorizontal(pos, gy, 1.2, 0.35)) continue;
      this.#addLoot(rollLoot(rnd), x, z, gy + 0.3, undefined, false);
    }
    this.emit({ t: 'loot', all: [...this.loot.values()].map(lootRow) });
  }

  pickup(p, id) {
    const it = this.loot.get(id);
    const why = !it ? 'gone' : !p.alive ? 'dead' : p.air ? 'in the air' : Math.hypot(it.x - p.x, it.z - p.z) > ROYALE.pickRange || Math.abs(it.y - p.y) > 2.2 ? 'out of reach' : null;
    if (why) { if (process.env.DEBUG_ROYALE) this.log(`[royale] ${p.name} pickup ${id} refused: ${why} (at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)} item ${it ? [it.x, it.y, it.z] : '-'})`); return false; }
    const L = LOOT[it.type];
    if (process.env.DEBUG_ROYALE && !p.bot) this.log(`[royale] ${p.name} picks ${id} ${it.type} (armor ${p.armor}, meds ${p.meds}, w ${p.weapons.map((w) => w && `${w.id}:${w.mag}/${w.reserve}`)})`);
    switch (L.kind) {
      case 'weapon': {
        const def = WEAPONS[L.w], si = def.slot, cur = p.weapons[si];
        const [mag, reserve] = it.a || [def.mag, def.mag * 2];
        if (cur && cur.id === L.w) {
          if (cur.reserve >= def.reserve) return false;
          cur.reserve = Math.min(def.reserve, cur.reserve + mag + reserve);
        } else {
          if (cur) this.#addLoot(cur.id, p.x + rand(-0.5, 0.5), p.z + rand(-0.5, 0.5), p.y + 0.5, [cur.mag, cur.reserve]);
          p.weapons[si] = { id: L.w, mag, reserve };
          p.slot = si; p.reloadUntil = 0;
        }
        break;
      }
      case 'ammo': {
        let took = false;
        for (const w of p.weapons) { if (!w) continue; const d = WEAPONS[w.id]; if (w.reserve < d.reserve) { w.reserve = Math.min(d.reserve, w.reserve + d.mag * 2); took = true; } }
        if (!took) return false;
        break;
      }
      case 'armor': if (p.armor >= ROYALE.maxArmor) return false; p.armor = Math.min(ROYALE.maxArmor, p.armor + L.amount); break;
      case 'med': if (p.meds >= ROYALE.maxMeds) return false; p.meds++; break;
      case 'nade': if (p.grenades >= ROYALE.maxNades) return false; p.grenades++; break;
    }
    this.loot.delete(id);
    p.pickups = (p.pickups || 0) + 1;
    this.emit({ t: 'lootdel', id, by: p.id });
    this.#sendInv(p);
    return true;
  }

  #sendInv(p) { if (!p.bot) this.emit({ t: 'inv', w: p.weapons, sl: p.slot, g: p.grenades, ar: Math.round(p.armor), md: p.meds }, p); }

  heal(p) {
    if (!p.alive || p.air || p.meds <= 0 || p.hp >= 100 || p.healUntil) return;
    p.healUntil = this.now() + ROYALE.healTime * 1000;
    p.reloadUntil = 0;
  }

  tryFire(p, ...args) {
    if (p.inPlane || p.air || this.phase === 'lobby') return false;
    p.healUntil = 0; // shooting interrupts healing
    return super.tryFire(p, ...args);
  }

  throwGrenade(p, o, d) { if (!p.air) super.throwGrenade(p, o, d); }

  handleInput(p, m) {
    if (p.inPlane || !p.alive) return;
    if (p.air && Number.isFinite(m.y) && m.y > p.y + 1) m.y = p.y; // no climbing while falling
    super.handleInput(p, m);
  }

  damage(victim, amount, attacker, weapon, head = false) {
    if (!victim.alive) return;
    // armor plates soak most of a hit until they are broken (the ring burns straight through)
    if (weapon !== 'ring' && victim.armor > 0) { const a = Math.min(victim.armor, amount * 0.6); victim.armor -= a; amount -= a; }
    super.damage(victim, amount, attacker, weapon, head);
    if (!victim.bot && victim.alive) this.#sendInv(victim);
  }

  kill(p, killer, weapon, silent = false) {
    if (!p.alive) return;
    p.alive = false; p.hp = 0; p.air = 0; p.healUntil = 0; p.respawnAt = Infinity;
    if (silent) return;
    p.deaths++;
    p.place = this.aliveCount() + 1;
    if (killer && killer !== p) { killer.kills++; killer.score += 100; }
    // everything the fallen soldier carried spills onto the ground
    const drops = [];
    for (const w of p.weapons) if (w && (w.mag + w.reserve > 0 || w.id !== 'pistol')) drops.push([w.id, [w.mag, w.reserve]]);
    for (let i = 0; i < p.meds; i++) drops.push(['med']);
    for (let i = 0; i < p.grenades; i++) drops.push(['nade']);
    if (p.armor >= 25) drops.push(['armor']);
    drops.push(['ammo']);
    drops.forEach(([type, a], i) => {
      const ang = (i / drops.length) * Math.PI * 2 + rand(0, 0.5), r = 0.7 + rand(0, 0.8);
      this.#addLoot(type, p.x + Math.cos(ang) * r, p.z + Math.sin(ang) * r, p.y + 0.8, a);
    });
    this.emit({ t: 'kill', v: p.id, k: killer ? killer.id : 0, w: weapon, hs: p.lastHeadshot || false, kx: killer?.x, ky: killer?.y, kz: killer?.z, left: this.aliveCount(), place: p.place });
  }

  #checkWin(now) {
    if (this.phase !== 'plane' && this.phase !== 'live') return;
    const alive = [...this.players.values()].filter((p) => p.alive || p.inPlane);
    const need = this.startCount >= 2 ? 1 : 0;
    if (alive.length > need) return;
    const w = alive[0] || null;
    if (w) { w.place = 1; w.score += 500; }
    this.phase = 'over';
    this.roundOver = { winner: w ? w.id : 0, at: now };
    this.emit({ t: 'round', royale: 1, winner: w ? w.id : 0, name: w ? w.name : 'NOBODY' });
    this.log(`[royale] match over, winner: ${w ? w.name : 'none'}`);
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    const now = this.now();
    this.time += dt;
    if (this.phase === 'over' && now - this.roundOver.at > ROYALE.endScreen * 1000) this.resetRound();
    if (this.phase === 'lobby') {
      this.balanceBots();
      const humans = [...this.players.values()].filter((p) => !p.bot).length;
      if (!humans) this.lobbyEnd = null;
      else if (!this.lobbyEnd) this.lobbyEnd = now + this.lobbyTime * 1000;
      if (this.lobbyEnd && now >= this.lobbyEnd) this.startMatch(now);
    }
    if (this.phase === 'plane') this.#stepPlane(now);
    if (this.phase === 'plane' || this.phase === 'live') this.#stepRing(now);
    const rg = this.ring && ringAt(this.ring, now);
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.bot) {
        const input = p.brain.think(dt);
        if (p.air) stepAir(this.world, p, input, dt);
        else { stepCharacter(this.world, p, input, dt); if (p.fall > 0) this.damage(p, p.fall, null, 'fall'); }
      }
      if (p.reloadUntil && now >= p.reloadUntil) {
        const w = p.weapons[p.reloadSlot ?? p.slot];
        if (w) { const need = WEAPONS[w.id].mag - w.mag, take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; }
        p.reloadUntil = 0;
        if (!p.bot) this.emit({ t: 'ammo', w: p.weapons, g: p.grenades }, p);
      }
      if (p.healUntil && now >= p.healUntil) {
        p.healUntil = 0; p.meds--; p.hp = Math.min(100, p.hp + ROYALE.healAmount);
        this.#sendInv(p);
      }
      // the ring of fire burns anyone outside it
      if (rg && this.ring.dmg > 0 && Math.hypot(p.x - rg.x, p.z - rg.z) > rg.r) {
        p.ringAcc = (p.ringAcc || 0) + this.ring.dmg * dt;
        if (p.ringAcc >= 1) { const d = Math.floor(p.ringAcc); p.ringAcc -= d; this.damage(p, d, null, 'ring'); }
      }
      if (p.y < -30 || Math.abs(p.x) > this.map.MAP_HALF || Math.abs(p.z) > this.map.MAP_HALF) this.kill(p, null, 'fall');
      if (!p.alive) continue;
      p.history.push({ t: now, x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance });
      while (p.history.length && p.history[0].t < now - 1000) p.history.shift();
    }
    this.stepBullets(now);
    this.stepGrenades(dt);
    this.#stepDrops(now);
    this.#checkWin(now);
  }

  snapshot() {
    const s = super.snapshot(), now = this.now();
    s.ph = PHASES.indexOf(this.phase);
    s.cd = this.phase === 'lobby' && this.lobbyEnd ? Math.max(0, this.lobbyEnd - now) : this.phase === 'over' ? Math.max(0, this.roundOver.at + ROYALE.endScreen * 1000 - now) : 0;
    if (this.phase === 'plane') {
      const pp = this.planePos(now);
      s.pl = [+pp.x.toFixed(1), +pp.z.toFixed(1), pp.y, +this.plane.dx.toFixed(4), +this.plane.dz.toFixed(4), pp.k >= this.plane.jumpFrom ? 1 : 0, +pp.k.toFixed(4), this.plane.jumpUntil];
    }
    const g = this.ring;
    if (g) s.rg = [+g.cx.toFixed(1), +g.cz.toFixed(1), +g.r.toFixed(1), +g.nx.toFixed(1), +g.nz.toFixed(1), +g.nr.toFixed(1), g.t0 === Infinity ? 0 : g.t0, g.t1 === Infinity ? 0 : g.t1, g.stage, g.dmg];
    s.al = this.aliveCount();
    s.tk = [s.al, this.startCount];
    return s;
  }

  meExtra(p, now) {
    return { ar: Math.round(p.armor || 0), md: p.meds || 0, ip: p.inPlane ? 1 : 0, air: p.air || 0, hl: p.healUntil ? Math.max(0, p.healUntil - now) : 0, pc: p.place || 0 };
  }

  scoreboard() {
    const b = super.scoreboard();
    for (const r of b.rows) { const p = this.players.get(r.id); r.a = p && (p.alive || p.inPlane) ? 1 : 0; r.pc = p?.place || 0; }
    b.royale = 1;
    return b;
  }
}

const lootRow = (it) => [it.id, it.type, it.x, it.y, it.z];

// ---------------------------------------------------------------- bots
// Royale bots: pick a drop zone along the flight path, glide there, grab the closest useful loot, keep ahead of
// the ring, heal up when safe, and fight with the shared combat logic from BotBrain.
class RoyaleBrain extends BotBrain {
  onBoard(plane) {
    const k = rand(plane.jumpFrom + 0.02, plane.jumpUntil - 0.05);
    this.jumpAt = plane.t0 + plane.dur * k;
    // aim for a building within ~160 m of where we leave the plane
    const px = plane.ax + (plane.bx - plane.ax) * k, pz = plane.az + (plane.bz - plane.az) * k;
    const near = this.g.map.BUILDINGS.filter((b) => Math.hypot(b.x - px, b.z - pz) < 170);
    const b = near.length ? near[Math.floor(Math.random() * near.length)] : { x: px + rand(-60, 60), z: pz + rand(-60, 60), w: 4, d: 4 };
    this.landing = { x: b.x + rand(-b.w, b.w) * 0.8, z: b.z + rand(-b.d, b.d) * 0.8 };
  }

  onJump() { this.onSpawn(); this.nextDecide = 0; }

  // (also called from the BotBrain constructor, before this subclass is initialised)
  pickGoal() { if (this.p.alive && !this.p.air) this.decide(true); }

  // choose where to go: ring safety > useful loot > another building in the safe zone
  decide(force = false) {
    const g = this.g, p = this.p, now = g.now();
    const ring = g.ring && ringAt(g.ring, now);
    let target = null;
    if (ring) {
      const nr = g.ring.nr, dn = Math.hypot(p.x - g.ring.nx, p.z - g.ring.nz);
      const soon = g.ring.t0 - now < 25000 || now > g.ring.t0;
      const outNow = Math.hypot(p.x - ring.x, p.z - ring.z) > ring.r * 0.92;
      if (outNow || (soon && dn > nr * 0.85)) {
        if (!this.safeSpot || Math.hypot(this.safeSpot.x - g.ring.nx, this.safeSpot.z - g.ring.nz) > nr * 0.7) {
          const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * nr * 0.55;
          this.safeSpot = { x: g.ring.nx + Math.cos(a) * r, z: g.ring.nz + Math.sin(a) * r };
        }
        target = { ...this.safeSpot, kind: 'ring' };
      }
    }
    if (!target) {
      let best = null, bestS = -Infinity;
      for (const it of g.loot.values()) {
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        // bots navigate a 2D grid: skip loot on upper floors / roofs and anything they failed to reach
        if (d > 70 || this.skip?.has(it.id) || it.y - g.map.groundHeight(it.x, it.z) > 1.5) continue;
        const want = this.#want(it);
        if (want <= 0) continue;
        const s = want * 10 - d;
        if (s > bestS) { bestS = s; best = it; }
      }
      if (best) {
        if (Math.hypot(best.x - p.x, best.z - p.z) < 1.6 && Math.abs(best.y - p.y) < 2) {
          g.pickup(p, best.id);
          if (p.weapons[0]) p.slot = 0;
          this.lootId = null;
          return;
        }
        if (this.lootGoal !== best.id) { this.lootGoal = best.id; this.lootSince = now; }
        else if (now - this.lootSince > 12000) { (this.skip || (this.skip = new Set())).add(best.id); this.lootGoal = null; return; }
        target = { x: best.x, z: best.z, kind: 'loot', id: best.id };
      }
    }
    if (!target) {
      // roam to another building inside the safe zone
      if (!this.roam || Math.hypot(this.roam.x - p.x, this.roam.z - p.z) < 3 || force) {
        const R = g.ring ? { x: g.ring.nx, z: g.ring.nz, r: g.ring.nr } : { x: 0, z: 0, r: 300 };
        const cand = g.map.BUILDINGS.filter((b) => Math.hypot(b.x - R.x, b.z - R.z) < R.r * 0.9);
        const b = cand.length ? cand[Math.floor(Math.random() * cand.length)] : { x: R.x + rand(-20, 20), z: R.z + rand(-20, 20) };
        this.roam = { x: b.x + rand(-2, 2), z: b.z + rand(-2, 2) };
      }
      target = { ...this.roam, kind: 'roam' };
    }
    const moved = !this.goal || Math.hypot(this.goal.x - target.x, this.goal.z - target.z) > 3;
    if (moved || force || !this.path) {
      if (!this.#route(target) && target.kind === 'loot') (this.skip || (this.skip = new Set())).add(target.id);
    }
    if (p.hp < 60 && p.meds > 0 && !this.target && !p.healUntil) g.heal(p);
  }

  #want(it) {
    const p = this.p, L = LOOT[it.type];
    switch (L.kind) {
      case 'weapon': { const def = WEAPONS[L.w], cur = p.weapons[def.slot]; if (!cur) return 3; if (cur.id === L.w) return cur.reserve < def.reserve * 0.5 ? 1 : 0; return L.w === 'ar' && cur.id !== 'ar' ? 1.5 : 0; }
      case 'ammo': return p.weapons.some((w) => w && w.reserve < WEAPONS[w.id].mag * 2) ? 1.6 : 0;
      case 'armor': return p.armor < 100 ? 2 : 0;
      case 'med': return p.meds < 2 ? 1.4 : p.meds < ROYALE.maxMeds ? 0.4 : 0;
      case 'nade': return p.grenades < 2 ? 0.6 : 0;
    }
    return 0;
  }

  #route(target) {
    const p = this.p;
    this.goal = { x: target.x, z: target.z };
    // A* over at most ~120 m at a time on the big island; straight line if the grid has no answer
    const d = Math.hypot(target.x - p.x, target.z - p.z), k = d > 120 ? 120 / d : 1;
    const tx = p.x + (target.x - p.x) * k, tz = p.z + (target.z - p.z) * k;
    const path = this.g.nav.findPath(p.x, p.z, tx, tz, 25000);
    this.path = path || [{ x: p.x, z: p.z }, { x: tx, z: tz }];
    this.pathIdx = 1;
    this.repathAt = this.g.now() + (k < 1 ? rand(6000, 9000) : rand(12000, 20000));
    return !!path;
  }

  think(dt) {
    const g = this.g, p = this.p, now = g.now();
    if (p.air) {
      // glide toward the chosen drop zone, dive while far away
      const dx = this.landing.x - p.x, dz = this.landing.z - p.z, d = Math.hypot(dx, dz) || 1;
      const wantYaw = Math.atan2(-dx, -dz);
      p.yaw += clamp(angleDiff(p.yaw, wantYaw), -2 * dt, 2 * dt);
      return { fx: d > 3 ? dx / d : 0, fz: d > 3 ? dz / d : 0, dive: p.air === 1 && d < 60 ? 1 : 0, deploy: false };
    }
    // no rifle yet: don't go hunting someone you lost sight of, go find a gun first
    if (!this.visible && !p.weapons[0]) { this.lastSeen = null; this.target = null; }
    if (now >= (this.nextDecide || 0)) { this.nextDecide = now + 500; this.decide(); }
    // wedged somewhere (door frames, props): give up on the current goal and step somewhere else
    if (!this.anchor || Math.hypot(p.x - this.anchor.x, p.z - this.anchor.z) > 2.5) this.anchor = { x: p.x, z: p.z, t: now };
    else if (now - this.anchor.t > 7000 && !this.visible && !p.healUntil) {
      if (this.lootGoal) (this.skip || (this.skip = new Set())).add(this.lootGoal);
      this.lootGoal = null; this.roam = null; this.anchor = null;
      const a = rand(0, Math.PI * 2);
      this.#route({ x: p.x + Math.cos(a) * 12, z: p.z + Math.sin(a) * 12 });
      this.nextDecide = now + 4000;
    }
    // no gun yet: run to loot instead of standing in the open trying to shoot
    const w = p.weapons[p.slot];
    if (!w || (w.mag <= 0 && w.reserve <= 0)) {
      const other = p.weapons[1 - p.slot];
      if (other && other.mag + other.reserve > 0) p.slot = 1 - p.slot;
      else { const t = this.target; this.target = null; const input = super.think(dt); this.target = t; return input; }
    }
    return super.think(dt);
  }
}
