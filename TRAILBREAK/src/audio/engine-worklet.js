// TRAILBREAK engine voice (AudioWorklet): a real engine, a firing at a time.
//
// The bank (tools/sounds/build_grains.py) is a recording cut into firings: a mark on every firing pulse, with the
// engine's revs there (relative to its idle) and what it was doing (idling, accelerating, holding, slowing). This
// plays them back pitch-synchronously: every firing of the game's engine (at the rate its revs make) starts recorded
// firings, each windowed from the firing before it to the one after, so neighbours overlap and add up seamlessly.
// The exhaust and the block keep their real resonances at any revs, and the cycle-to-cycle roughness of a real engine
// stays, because the firings play in their recorded order for as long as the revs allow.
//
// On and off throttle each have a run of recorded firings playing (firings recorded pulling, or slowing), mixed by
// the load. A run carries on, firing after firing as recorded, while its revs stay near the game's: how near depends
// on how fast the game's are moving (at steady revs a recorded sweep would otherwise climb away and jump back, over
// and over: a warble a few times a second). Then another run takes over: one recorded near the same revs, doing what
// the engine is doing (pulling, holding, slowing), not played lately (a handful of firings going round and round
// came out as a buzz), lined up on the waveform the old run would have played next and played on from there. Past
// the top of the recording the firings come from its top two percent, faster than they were recorded.
//
// The firings come at the game engine's own rate (its revs and cylinders: the note is where its tachometer says).
// They are picked from where the recording's revs were nearest the game's, the game's idle playing the recording's
// idle: an engine idling slower or faster than the recorded one starts from its idle firings, and is at the same
// revs as the recording within a few hundred rpm of revving.
//
// Parameters: rpm (the game engine's), load (0..1), gain. Config message: { idle: the game engine's idle rpm }.
// Bank message: { data: Float32Array, sr, cyl, idleRpm, pos: Int32Array, r: Float32Array, g: Float32Array,
// cls: Uint8Array (0 idle, 1 accelerating, 2 slowing, 3 holding; +4 recorded on the road), run: Uint16Array }.

const MAXG = 40;          // grains sounding at once (at most)
const LOOK = 6000;        // longest half-window (output samples): firings slower than this are clipped

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

// What a run would rather not be (in log revs): on throttle, a firing recorded slowing down sounds thin; off
// throttle, one recorded pulling sounds too strong; at steady revs, one from a hold fits best. [idle, accelerating,
// slowing, holding], on throttle with the revs rising or steady, off throttle with them falling or steady
const CLASS_COST = [[[0.03, 0, 0.12, 0.02], [0.03, 0.015, 0.1, 0]], [[0.02, 0.12, 0, 0.02], [0.01, 0.1, 0.015, 0]]];

/** The run of firings being played on (or off) throttle. */
class Stream {
  constructor() {
    this.cur = -1; this.off = 0;          // the firing playing, and the offset its run plays at (samples)
    this.rep = false;                     // (it was played twice running)
    this.recent = new Int32Array(32).fill(-1); this.ri = 0;     // the firings it played last
  }
  played(k) { this.recent[this.ri] = k; this.ri = (this.ri + 1) & 31; }
  lately(k) { const R = this.recent; for (let i = 0; i < 32; i++) if (R[i] === k) return true; return false; }
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
    this.cfg = { idle: 800 };
    this.g = [];
    for (let i = 0; i < MAXG; i++) this.g.push({ on: false, c: 0, T: 0, L: 1, R: 1, q: 1, amp: 0 });
    this.now = 0;              // output samples since the start
    this.T = 0;                // the next firing (output sample, fractional)
    this.seed = 0x9e3779b9;
    this.loadS = 0;
    this.lrPrev = 0; this.slope = 0;
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
    // the revs the recording's top (and bottom) two percent of firings start at: beyond them, targets stop there
    const m = Math.min(n - 1, Math.max(12, Math.round(n * 0.02)));
    this.rTop = this.sorted.r[n - 1 - m]; this.rBot = this.sorted.r[m];
    this.streams = [new Stream(), new Stream()];
    this.planned = false;
  }

  /**
   * The firing for this stream at relative revs rt (cost: what kind of firing it would rather not have). The run
   * carries on (the next recorded firing) while it is within `band` (log revs, kind counted in) of the best the
   * neighbourhood has; otherwise the best few of the neighbourhood (revs, then kind; not played lately) are tried
   * against the waveform the run would have played next, and the closest match wins, lined up with it (and its run
   * plays on lined up so). -1: none.
   */
  pick(s, rt, band, cost) {
    const b = this.bank, S = this.sorted, lt = Math.log(rt);
    // the neighbourhood: up to 24 firings either side of the target, and how near the nearest comes
    const i0 = S.at(rt), lo = Math.max(0, i0 - 24), hi = Math.min(S.idx.length, i0 + 24);
    let best = 1e9;
    for (let i = lo; i < hi; i++) {
      const k = S.idx[i], c = Math.abs(b.lr[k] - lt) + cost[b.cls[k] & 3];
      if (c < best) best = c;
    }
    // the run carries on: the next firing, or, where the recording's revs move slower or faster than the game's, the
    // same one once more or the one after next (where the recording has a gap in its revs, as near as the nearest
    // will do)
    if (s.cur >= 0) {
      let kc = -1, cc = 1e9;
      for (let j = 0; j < 3; j++) {
        const k = s.cur + j;
        if (k >= b.n || b.run[k] !== b.run[s.cur] || (j === 0 && s.rep)) continue;
        const c = Math.abs(b.lr[k] - lt) + cost[b.cls[k] & 3] + (j === 1 ? 0 : 0.012);
        if (c < cc) { cc = c; kc = k; }
      }
      if (kc >= 0 && cc <= best + band) {
        s.rep = kc === s.cur; s.cur = kc; s.played(kc);
        return kc;
      }
    }
    const cand = this.cand;
    let m = 0;
    // (further afield where the recording has few firings; the ones played lately only when there are too few
    // others; the one playing, never)
    for (let pass = 0; pass < 5 && m < 4; pass++) {
      const tol = [0.025, 0.05, 0.1, 0.25, 0.25][pass];
      m = 0;
      for (let i = lo; i < hi && m < cand.length; i++) {
        const k = S.idx[i];
        if (k === s.cur || (pass < 4 && s.lately(k))) continue;
        if (Math.abs(b.lr[k] - lt) + cost[b.cls[k] & 3] <= best + tol) cand[m++] = k;
      }
    }
    if (!m) { s.cur = -1; return -1; }
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); const t = cand[i]; cand[i] = cand[j]; cand[j] = t; }
    let k = cand[0], off = 0;
    if (s.cur >= 0) {
      let bestV = -1e9;
      for (let i = 0; i < Math.min(4, m); i++) {
        const a = this.align(s.cur, s.off, cand[i]);
        if (a.v > bestV) { bestV = a.v; k = cand[i]; off = a.o; }
      }
    }
    s.cur = k; s.off = off; s.rep = false; s.played(k);
    return k;
  }

  /**
   * How well firing k continues the run that has just played firing `from` (at offset fromOff): the normalised
   * cross-correlation of the recording around k (+- half a period, every other sample) with the recording where
   * `from`'s run would have played next. Offsets far from the firing's mark count against it a little (the runs'
   * offsets would otherwise wander off the firings). Returns the best offset (samples) and its score.
   */
  align(from, fromOff, k) {
    const b = this.bank, d = b.data, res = this._al || (this._al = { o: 0, v: 0 });
    const ref = b.pos[from] + fromOff + b.next[from], c = b.pos[k], P = Math.min(b.prev[k], b.next[k]);
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
      const v = xy / Math.sqrt(yy * rr) - 0.15 * (o / (half + 1)) * (o / (half + 1));
      if (v > bestV) { bestV = v; bestO = o; }
    }
    res.o = bestO; res.v = bestV;
    return res;
  }

  /** The grains for the next firing (the recording's revs to pick at rt, relative to its idle; firings per second
   * fT, To output samples apart; the revs moving at `slope`, d ln rpm / dt), into this.next. */
  plan(rt, fT, To, wOn, wOff, band, slope) {
    const b = this.bank, q0 = b.sr / sampleRate;
    rt = Math.min(this.rTop, Math.max(this.rBot, rt));
    this.next.length = 0;
    let gi = 0;
    for (let kind = 0; kind < 2; kind++) {
      const w = kind ? wOff : wOn, s = this.streams[kind];
      if (w < 0.03) { s.cur = -1; continue; }
      const moving = kind ? slope < -0.25 : slope > 0.25;
      const k = this.pick(s, rt, band, CLASS_COST[kind][moving ? 0 : 1]);
      if (k < 0) continue;
      // faster or slower than it was recorded (beyond the recording's revs, or below its idle): the firing is also
      // shortened or stretched a little (its resonances move a little), the rest is spacing
      const ext = fT / (b.r[k] * b.fIdle);
      const qx = ext > 1.1 ? Math.pow(ext / 1.1, 0.45) : ext < 0.88 ? Math.pow(ext / 0.88, 0.3) : 1;
      const q = q0 * qx;
      const L = Math.min(LOOK, b.prev[k] / q), R = Math.min(LOOK, b.next[k] / q);
      const g = this.pool[gi++];
      g.c = b.pos[k] + s.off; g.L = L; g.R = R; g.q = q;
      // overlapping windows add up to about (their length / the spacing): keep the level where it is (past what was
      // recorded too: random wobbles of level or timing there only came out as hiss)
      g.amp = b.g[k] * w * Math.min(2, To / (0.5 * (L + R)));
      this.next.push(g);
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
    const fT = Math.max(2, rpm * (cfg.cyl || b.cyl) / 120);    // firings per second (the engine's own cylinders: a V10 on a V8's bank)
    // the recording's revs to pick from (relative to its idle): the game's idle is the recording's, and the difference
    // between the two idles fades out over the first revs (below idle: slower idle firings)
    const rIdle = b.idleRpm;
    const rt = rpm >= cfg.idle ? (rpm + (rIdle - cfg.idle) * Math.exp((cfg.idle - rpm) / 600)) / rIdle
      : Math.max(0.15, rpm / cfg.idle);
    const To = sampleRate / fT;
    // how fast the revs are moving (d ln rpm / dt, over about a tenth of a second): how far a recorded run may go
    // before another takes over (a free rev in neutral: 15%; steady revs: 3.5%)
    const lr = Math.log(Math.max(rpm, 50)), dtB = n / sampleRate;
    if (!this.lrPrev) this.lrPrev = lr;
    this.slope += ((lr - this.lrPrev) / dtB - this.slope) * (1 - Math.exp(-dtB / 0.1));
    this.lrPrev = lr;
    const band = Math.min(0.15, 0.035 + 0.06 * Math.abs(this.slope));
    const wOn = Math.sqrt(this.loadS), wOff = Math.sqrt(1 - this.loadS);
    const data = b.data, D = data.length - 2;
    for (let i = 0; i < n; i++) {
      const t = this.now + i;
      if (running) {
        if (this.T < t) this.T = t;                           // (after a silence: start firing now)
        if (!this.planned) this.plan(rt, fT, To, wOn, wOff, band, this.slope);
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
