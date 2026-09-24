// Style chain: stunts done back-to-back build one combo. Each action adds points and resets a short
// window; every second different action raises the multiplier (up to x5). When the window runs out the
// chain is banked as XP (and a little cash); a hard crash loses it.
import { bus } from '../core/EventBus.js';

const WINDOW = 3.2;      // seconds to keep the chain alive
const MAX_MULT = 5;

export class StyleChain {
  constructor(progress) {
    this.progress = progress;
    this.reset();
    this.driftT = 0; this.airT = 0; this.fastT = 0;
  }
  reset() { this.points = 0; this.mult = 1; this.actions = 0; this.timer = 0; this.last = ''; this.lastKind = ''; this.kinds = new Set(); }
  get active() { return this.points > 0; }

  add(kind, label, pts) {
    if (pts <= 0) return;
    this.points += pts;
    this.timer = WINDOW;
    this.last = label;
    if (kind !== this.lastKind) { this.actions++; this.lastKind = kind; this.kinds.add(kind); }
    this.mult = Math.min(MAX_MULT, 1 + Math.floor(this.actions / 2));
    bus.emit('style:add', { kind, label, pts, total: this.points, mult: this.mult });
  }

  crash() {
    if (!this.active) return;
    bus.emit('style:lost', { points: this.points, mult: this.mult });
    this.reset();
  }

  bank() {
    if (!this.active) return;
    const score = Math.round(this.points * this.mult);
    const xp = Math.round(score / 10), cash = Math.round(score / 25) * 5;
    const st = this.progress.stats;
    st.bestChain = Math.max(st.bestChain || 0, score);
    bus.emit('style:bank', { score, mult: this.mult, xp, cash, kinds: [...this.kinds] });
    if (cash > 0) this.progress.save.addCash(cash, '');
    this.progress.addXp(xp, 'style');
    this.reset();
  }

  // continuous actions accumulate here; discrete ones call add() directly
  update(dt, s) {
    const kmh = Math.hypot(s.vx, s.vz) * 3.6;
    if (s.drifting && kmh > 40 && s.onGround) { this.driftT += dt; if (this.driftT > 0.4) this.add('drift', 'DRIFT', dt * (80 + kmh * 0.6)); } else this.driftT = 0;
    if (!s.onGround && kmh > 30) { this.airT += dt; if (this.airT > 0.35) this.add('air', 'BIG AIR', dt * 220); } else this.airT = 0;
    if (kmh > 220 && s.onGround) { this.fastT += dt; if (this.fastT > 1) this.add('speed', 'TOP SPEED', dt * (kmh - 200) * 0.8); } else this.fastT = 0;
    if (this.active) { this.timer -= dt; if (this.timer <= 0) this.bank(); }
  }
}
