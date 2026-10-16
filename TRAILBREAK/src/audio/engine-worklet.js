// TRAILBREAK engine voice (AudioWorklet): a real engine, a firing at a time.
//
// The bank (tools/sounds/build_grains.py) is a recording cut into firings: a mark on every firing pulse, with the
// engine's revs there (relative to its idle) and what it was doing (idling, accelerating, holding, slowing). This
// plays them back pitch-synchronously: every firing of the game's engine (at the rate its revs make) starts recorded
// firings, each windowed from the firing before it to the one after, so neighbours overlap and add up seamlessly.
// The exhaust and the block keep their real resonances at any revs, and the cycle-to-cycle roughness of a real engine
// stays, because the firings play in their recorded order for as long as the revs allow.
//
// For each firing the target revs are bracketed: the nearest recorded firing at or below them and the nearest at or
// above, mixed by how close each is (one alone when it is close enough). On and off throttle each have their own
// pair (firings recorded pulling vs slowing), mixed by the load. All of them start at the same instant, lined up on
// their firing pulses.
//
// Parameters: rpm (the game engine's), load (0..1), gain. Config message: { idle: the game engine's idle rpm,
// pitch: a multiplier on the firing rate (an engine of the same kind, but bigger or smaller) }.
// Bank message: { data: Float32Array, sr, cyl, idleRpm, pos: Int32Array, r: Float32Array, g: Float32Array,
// cls: Uint8Array (0 idle, 1 accelerating, 2 slowing, 3 holding; +4 recorded on the road), run: Uint16Array }.

const MAXG = 40;          // grains sounding at once (at most)
const LOOK = 6000;        // longest half-window (output samples): firings slower than this are clipped
const NEAR = 0.04;        // a firing this close to the target (log revs) plays alone

/** Firings sorted by their revs, for finding the ones nearest a target. */
class Sorted {
  constructor(r) {
    this.idx = Int32Array.from(r.keys()).sort((a, b) => r[a] - r[b]);
    this.r = Float32Array.from(this.idx, (k) => r[k]);
  }
  /** Position in this.idx of the first firing at or above rt. */
  at(rt) {
    const R = this.r;
    let lo = 0, hi = R.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (R[m] < rt) lo = m + 1; else hi = m; }
    return lo;
  }
}

// What a stream would rather not use: on throttle, a firing recorded slowing down sounds thin; off throttle, one
// recorded pulling sounds too strong. [idle, accelerating, slowing, holding]
const CLASS_COST = { on: [0.03, 0, 0.12, 0.015], off: [0.02, 0.12, 0, 0.015] };

/** One run of firings being played: on or off throttle, from below (side -1) or above (+1) the target revs. */
class Stream {
  constructor(kind, side) { this.cost = CLASS_COST[kind]; this.side = side; this.cur = -1; this.seq = 0; this.off = 0; }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 15000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 8, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.bank = null;
    this.cfg = { idle: 800, pitch: 1 };
    this.g = [];
    for (let i = 0; i < MAXG; i++) this.g.push({ on: false, c: 0, T: 0, L: 1, R: 1, q: 1, amp: 0 });
    this.now = 0;              // output samples since the start
    this.T = 0;                // the next firing (output sample, fractional)
    this.seed = 0x9e3779b9;
    this.loadS = 0;
    this.hpX = 0; this.hpY = 0;
    this.ms = 0.01; this.corr = 1;
    this.msK = 1 - Math.exp(-1 / (0.3 * sampleRate));
    this.corrK = 1 - Math.exp(-1 / (0.05 * sampleRate));
    this.next = [];            // the grains chosen for the next firing
    this.planned = false;
    this.pool = [];
    for (let i = 0; i < 4; i++) this.pool.push({ c: 0, L: 1, R: 1, q: 1, amp: 0 });
    this.cand = new Int32Array(64);
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.bank) this.setBank(d.bank);
      if (d.config) Object.assign(this.cfg, d.config);
    };
    // (or given at the start: then it sounds from the first sample)
    const o = options?.processorOptions;
    if (o?.config) Object.assign(this.cfg, o.config);
    if (o?.bank) this.setBank(o.bank);
  }

  rand() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }

  setBank(b) {
    const n = b.pos.length, prev = new Float32Array(n), next = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const p = k > 0 && b.run[k - 1] === b.run[k] ? b.pos[k] - b.pos[k - 1] : 0;
      const q = k < n - 1 && b.run[k + 1] === b.run[k] ? b.pos[k + 1] - b.pos[k] : 0;
      prev[k] = p || q || b.sr / 40; next[k] = q || p || b.sr / 40;
    }
    let rMax = 0;
    for (let k = 0; k < n; k++) if (b.r[k] > rMax) rMax = b.r[k];
    this.bank = { ...b, n, prev, next, rMax, fIdle: b.idleRpm * b.cyl / 120, lr: Float32Array.from(b.r, Math.log) };
    this.sorted = new Sorted(b.r);
    this.streams = [new Stream('on', -1), new Stream('on', 1), new Stream('off', -1), new Stream('off', 1)];
    this.planned = false;
  }

  /**
   * The firing for this stream at relative revs rt, from its side of the target. The recording carries on (the
   * next recorded firing) while it stays on its side, within 15% and the right kind; otherwise the best few of the
   * neighbourhood (revs, then kind) are tried against the waveform the run would have played next, and the closest
   * match wins, lined up with it. -1: none on this side worth playing.
   */
  pick(s, rt) {
    const b = this.bank, S = this.sorted, lt = Math.log(rt), side = s.side;
    const onSide = (k) => (side < 0 ? b.lr[k] <= lt + 0.01 : b.lr[k] >= lt - 0.01);
    const k1 = s.cur + 1;
    if (s.cur >= 0 && k1 < b.n && b.run[k1] === b.run[s.cur] && s.seq < 1500 && onSide(k1)
      && Math.abs(b.lr[k1] - lt) < 0.15 && s.cost[b.cls[k1] & 3] < 0.05) {
      s.cur = k1; s.seq++; s.off = 0;
      return k1;
    }
    const i0 = S.at(rt);
    // this side's neighbourhood: up to 32 firings
    const lo = side < 0 ? Math.max(0, i0 - 32) : i0, hi = side < 0 ? i0 : Math.min(S.idx.length, i0 + 32);
    let best = 1e9;
    for (let i = lo; i < hi; i++) { const k = S.idx[i]; const c = Math.abs(b.lr[k] - lt) + s.cost[b.cls[k] & 3]; if (c < best) best = c; }
    if (best > 0.7 && !(s.side > 0 ? i0 >= S.idx.length : i0 === 0)) { s.cur = -1; return -1; }   // (the edge of the bank plays on)
    const cand = this.cand;
    let m = 0;
    for (let i = lo; i < hi && m < cand.length; i++) {
      const k = S.idx[i];
      if (Math.abs(b.lr[k] - lt) + s.cost[b.cls[k] & 3] <= best + 0.025 && k !== s.cur) cand[m++] = k;
    }
    if (!m) { s.cur = -1; return -1; }
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    let k = cand[0], off = 0;
    if (s.cur >= 0) {
      let bestV = -1e9;
      for (let i = 0; i < Math.min(4, m); i++) {
        const a = this.align(s.cur, cand[i]);
        if (a.v > bestV) { bestV = a.v; k = cand[i]; off = a.o; }
      }
    }
    s.cur = k; s.seq = 0; s.off = off;
    return k;
  }

  /**
   * How well firing k continues the run that has just played firing `from`: the normalised cross-correlation of the
   * recording around k (+- half a period, every other sample) with the recording where `from`'s run would have fired
   * next. Returns the best offset (samples) and its score.
   */
  align(from, k) {
    const b = this.bank, d = b.data, res = this._al || (this._al = { o: 0, v: 0 });
    const ref = b.pos[from] + b.next[from], c = b.pos[k], P = Math.min(b.prev[k], b.next[k]);
    const half = Math.floor(P / 2), W = Math.floor(P * 0.6), D = d.length;
    let rr = 1e-9;
    for (let j = -W; j <= W; j += 3) { const a = ref + j; if (a >= 0 && a < D) rr += d[a] * d[a]; }
    let bestO = 0, bestV = -1e9;
    for (let o = -half; o <= half; o += 2) {
      let xy = 0, yy = 1e-9;
      for (let j = -W; j <= W; j += 3) {
        const a = ref + j, e = c + o + j;
        if (a < 0 || e < 0 || a >= D || e >= D) continue;
        xy += d[a] * d[e]; yy += d[e] * d[e];
      }
      const v = xy / Math.sqrt(yy * rr);
      if (v > bestV) { bestV = v; bestO = o; }
    }
    res.o = bestO; res.v = bestV;
    return res;
  }

  /** The grains for the next firing (relative revs rt, firing period To output samples), into this.next. */
  plan(rt, To, wOn, wOff) {
    const b = this.bank, q0 = b.sr / sampleRate, lt = Math.log(rt);
    this.next.length = 0;
    let gi = 0;
    for (let kind = 0; kind < 2; kind++) {
      const w = kind ? wOff : wOn;
      const sLo = this.streams[kind * 2], sHi = this.streams[kind * 2 + 1];
      if (w < 0.03) { sLo.cur = -1; sHi.cur = -1; continue; }
      let kLo = this.pick(sLo, rt), kHi = this.pick(sHi, rt);
      // one alone when it is right on the target (or the other side has none); else both, by closeness
      const dLo = kLo >= 0 ? Math.max(0, lt - b.lr[kLo]) : 1e9, dHi = kHi >= 0 ? Math.max(0, b.lr[kHi] - lt) : 1e9;
      if (dLo < NEAR && dLo <= dHi) { kHi = -1; sHi.cur = -1; } else if (dHi < NEAR) { kLo = -1; sLo.cur = -1; }
      const both = kLo >= 0 && kHi >= 0;
      for (let side = 0; side < 2; side++) {
        const k = side ? kHi : kLo, s = side ? sHi : sLo;
        // (equal power: the two are different recordings, so they add up as uncorrelated, not in phase)
        const share = both ? (side ? Math.sin : Math.cos)(Math.PI / 2 * dLo / (dLo + dHi)) : 1;
        if (k < 0 || share < 0.02) continue;
        // beyond what was recorded: the firing is also shortened (its resonances rise a little), the rest is spacing
        const ext = rt / b.r[k];
        const qx = ext > 1.1 ? Math.pow(ext / 1.1, 0.45) : ext < 0.88 ? Math.pow(ext / 0.88, 0.3) : 1;
        const q = q0 * qx;
        const L = Math.min(LOOK, b.prev[k] / q), R = Math.min(LOOK, b.next[k] / q);
        const g = this.pool[gi++];
        g.c = b.pos[k] + s.off; g.L = L; g.R = R; g.q = q;
        // overlapping windows add up to about (their length / the spacing): keep the level where it is (past what was
        // recorded too: random wobbles of level or timing there only came out as hiss)
        g.amp = b.g[k] * w * share * Math.min(2, To / (0.5 * (L + R)));
        this.next.push(g);
      }
    }
    this.planned = true;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const b = this.bank;
    if (!b) { out.fill(0); return true; }
    const rpm = params.rpm[0], gain = params.gain[0];
    this.loadS += (params.load[0] - this.loadS) * 0.08;
    const cfg = this.cfg;
    const running = rpm > 120;
    const rt = Math.max(0.15, rpm / cfg.idle);
    const fT = rt * b.fIdle * cfg.pitch;                       // firings per second
    const To = sampleRate / Math.max(fT, 2);
    const wOn = Math.sqrt(this.loadS), wOff = Math.sqrt(1 - this.loadS);
    const data = b.data, D = data.length - 2;
    for (let i = 0; i < n; i++) {
      const t = this.now + i;
      if (running) {
        if (this.T < t) this.T = t;                           // (after a silence: start firing now)
        if (!this.planned) this.plan(rt, To, wOn, wOff);
        let lead = 0;
        for (const p of this.next) if (p.L > lead) lead = p.L;
        if (t >= this.T - lead) {
          for (const p of this.next) {
            let g = null;
            for (let j = 0; j < MAXG; j++) if (!this.g[j].on) { g = this.g[j]; break; }
            if (!g) break;
            g.on = true; g.c = p.c; g.T = this.T; g.L = p.L; g.R = p.R; g.q = p.q; g.amp = p.amp;
          }
          this.T += To;
          this.planned = false;
        }
      } else this.planned = false;
      let y = 0;
      for (let j = 0; j < MAXG; j++) {
        const g = this.g[j];
        if (!g.on) continue;
        const x = t - g.T;
        if (x > g.R) { g.on = false; continue; }
        if (x < -g.L) continue;
        const w = x < 0 ? 0.5 + 0.5 * Math.cos(Math.PI * x / g.L) : 0.5 + 0.5 * Math.cos(Math.PI * x / g.R);
        const sp = g.c + x * g.q;
        if (sp < 0 || sp >= D) continue;
        const s0 = sp | 0, a = sp - s0;
        y += (data[s0] * (1 - a) + data[s0 + 1] * a) * w * g.amp;
      }
      // DC blocker (a pulse train sits off zero)
      const hp = y - this.hpX + 0.9985 * this.hpY;
      this.hpX = y; this.hpY = hp;
      // level: evened out over about a third of a second, so the loudness follows the game (the gain), not where
      // in the recordings the firings came from; the firing-to-firing life in it stays
      this.ms += (hp * hp - this.ms) * this.msK;
      const corr = Math.min(4, Math.max(0.25, 0.1 / (Math.sqrt(this.ms) + 1e-5)));
      this.corr += (corr - this.corr) * this.corrK;
      out[i] = hp * this.corr * gain;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    this.now += n;
    return true;
  }
}

registerProcessor('tb-engine', EngineProcessor);
