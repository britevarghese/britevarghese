// Progression: driver XP and levels (1-30), gameplay stats, career missions and car unlocks.
// Cars unlock by driver level or by completing a career mission (CARS[id].unlock); unlocked cars are
// then bought with cash (mission "gift" cars are delivered free). Everything persists in the save.
import { bus } from '../core/EventBus.js';
import { CARS } from '../vehicles/VehicleCatalog.js';
import { MISSIONS, MISSION_BY_ID, CHAPTERS } from './Missions.js';
import { formatMoney } from '../core/util.js';

export const MAX_LEVEL = 30;
export const xpToNext = (level) => Math.round(150 + 80 * Math.pow(level, 1.3));
export function levelInfo(xp) {
  let level = 1, rest = xp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}
// top-speed milestones (km/h -> XP), paid once
const SPEED_XP = [[150, 150], [200, 300], [250, 600], [300, 1000], [340, 1500]];

export class Progression {
  constructor(game) {
    this.game = game;
    const d = game.save.data;
    d.xp ??= 0; d.stats ??= {}; d.missions ??= {};
    this.driftT = 0;
    this.lastLevel = this.level;
    this._checkT = 0;
    this._wire();
    this._evaluate(true);
  }

  get save() { return this.game.save; }
  get stats() { return this.save.data.stats; }
  get level() { return levelInfo(this.save.data.xp).level; }
  get info() { return levelInfo(this.save.data.xp); }
  // race payouts grow with the driver's level so late-game cars stay reachable
  get rewardMult() { return 1 + 0.08 * (this.level - 1); }

  // ------------------------------------------------------------------ unlocks
  isUnlocked(id) {
    const u = CARS[id]?.unlock;
    if (!u) return true;
    if (u.mission) return !!this.save.data.missions[u.mission]?.done;
    return this.level >= (u.level || 1);
  }
  unlockText(id) {
    const u = CARS[id]?.unlock;
    if (!u) return '';
    if (u.mission) { const m = MISSION_BY_ID[u.mission]; return `MISSION · ${m ? m.name.toUpperCase() : u.mission}`; }
    return `DRIVER LEVEL ${u.level}`;
  }
  chapterOpen(ch) {
    const c = CHAPTERS.find((x) => x.id === ch);
    if (!c || ch === 1) return true;
    const prevFinale = MISSIONS.find((m) => m.chapter === ch - 1 && m.finale);
    return this.level >= c.level || !!(prevFinale && this.save.data.missions[prevFinale.id]?.done);
  }

  // ------------------------------------------------------------------ XP
  addXp(n, reason = '') {
    if (!(n > 0)) return;
    const before = this.level;
    this.save.data.xp = Math.round(this.save.data.xp + n);
    bus.emit('progress:xp', { xp: this.save.data.xp, delta: n, reason });
    const after = this.level;
    if (after > before) {
      const unlocked = Object.keys(CARS).filter((id) => CARS[id].unlock?.level && CARS[id].unlock.level > before && CARS[id].unlock.level <= after);
      bus.emit('progress:level', { level: after, unlocked });
    }
    this.save.markDirty();
    this._evaluate();
  }

  // ------------------------------------------------------------------ stats from gameplay
  _wire() {
    const S = () => this.stats;
    const near = (x, z, r = 8) => { const s = this.game.player?.state; return s && Math.hypot(s.x - x, s.z - z) < r; };
    bus.on('race:finished', (r) => {
      if (r.failed) return;
      const s = S();
      if (r.win) {
        s.racesWon = (s.racesWon || 0) + 1;
        (s.wonEvents ||= {})[r.def.id] = true;
        this.addXp(400 + (r.def.rep || 100) * 3, 'win');
      } else this.addXp(120 + (r.def.rep || 100), 'finish');
    });
    bus.on('police:escaped', (e) => { const s = S(); s.escapes = (s.escapes || 0) + 1; s.maxEscapeHeat = Math.max(s.maxEscapeHeat || 0, e.heat || 1); this.addXp(180 * (e.heat || 1), 'escape'); });
    bus.on('police:disabled', () => { const s = S(); s.copsDisabled = (s.copsDisabled || 0) + 1; this.addXp(120, 'cop disabled'); });
    bus.on('traffic:nearMiss', () => { const s = S(); s.nearMisses = (s.nearMisses || 0) + 1; this.addXp(20, 'near miss'); });
    bus.on('prop:break', (e) => {
      if (!e.p || !near(e.p.x, e.p.z)) return;
      const s = S();
      if (e.p.type === 'lamp') { s.lampsDown = (s.lampsDown || 0) + 1; this.addXp(12, 'lamp'); } else { s.propsDown = (s.propsDown || 0) + 1; this.addXp(3, 'prop'); }
    });
    bus.on('progress:upgrade', () => { const s = S(); s.upgrades = (s.upgrades || 0) + 1; this.addXp(100, 'upgrade'); });
    bus.on('progress:carBought', () => { this.addXp(250, 'new car'); this._evaluate(); });
  }

  // per frame while driving: drift length, top speed, distance
  update(dt, player) {
    const s = player.state, st = this.stats;
    const kmh = Math.hypot(s.vx, s.vz) * 3.6;
    if (s.drifting && kmh > 40 && s.onGround) this.driftT += dt;
    else if (this.driftT > 0) {
      if (this.driftT > (st.longestDrift || 0)) st.longestDrift = +this.driftT.toFixed(2);
      if (this.driftT > 1) { const xp = Math.round(this.driftT * 25); this.addXp(xp, 'drift'); bus.emit('progress:drift', { seconds: this.driftT, xp }); }
      this.driftT = 0;
    }
    if (kmh > (st.topSpeed || 0)) {
      const prev = st.topSpeed || 0;
      st.topSpeed = Math.round(kmh);
      for (const [v, xp] of SPEED_XP) if (prev < v && kmh >= v) { this.addXp(xp, `${v} km/h`); bus.emit('progress:speed', { kmh: v, xp }); }
    }
    const km = Math.floor((this.save.data.distanceDriven || 0) / 1000);
    if (km > (st.kmPaid || 0)) { st.kmPaid = km; this.addXp(20, 'distance'); }
    this._checkT -= dt;
    if (this._checkT <= 0) { this._checkT = 1; this._evaluate(); }
  }

  // ------------------------------------------------------------------ missions
  progressOf(m) {
    const ctx = { stats: this.stats, save: this.save.data, level: this.level };
    return Math.min(m.target, m.value(ctx));
  }
  _evaluate(silent = false) {
    const done = this.save.data.missions;
    for (const m of MISSIONS) {
      if (done[m.id]?.done || !this.chapterOpen(m.chapter)) continue;
      if (this.progressOf(m) < m.target) continue;
      done[m.id] = { done: true, at: Date.now() };
      const r = m.reward || {};
      if (r.cash) this.save.addCash(r.cash, silent ? '' : 'mission');
      if (r.car && r.gift) this.save.grantCar(r.car, !!CARS[r.car]?.real);
      this.save.save();
      if (!silent) bus.emit('mission:complete', { mission: m, reward: r });
      if (r.xp) this.addXp(r.xp, 'mission');
    }
  }

  // text summary for toasts / results
  rewardText(r) {
    const parts = [];
    if (r.cash) parts.push(formatMoney(r.cash));
    if (r.xp) parts.push(`${r.xp.toLocaleString()} XP`);
    if (r.car) parts.push(`${r.gift ? 'CAR: ' : 'UNLOCKS '}${CARS[r.car]?.name?.toUpperCase() || r.car}`);
    return parts.join(' · ');
  }
}
