// NIGHTSHIFT audio - granular engine player built on real engine recordings.
// A recording of an engine revving is analysed offline (tools/sounds/analyze.py): every ~23 ms frame knows
// the firing frequency f0 and whether the revs were rising (on throttle), falling (off throttle) or steady.
// Here two grain streams (on-throttle / off-throttle) pick source positions whose f0 matches the target rpm,
// play them with Hann-windowed 50% overlap and a small resampling to land exactly on pitch, and crossfade by
// throttle. When the recording's own revs follow the target, a stream simply keeps playing the recording
// (seamless); otherwise it jumps to the best matching frame, aligned by waveform similarity (WSOLA) so the
// splice doesn't click or phase.

const DIR_COST = { on: { 1: 0, 0: 0.025, '-1': 0.07 }, off: { '-1': 0, 0: 0.025, 1: 0.09 } };

class Voice {
  constructor(kind) {
    this.kind = kind;
    this.cost = DIR_COST[kind];
    this.grains = [];      // {pos, rate, age}
  }
}

class EngineSampleProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpmN', defaultValue: 0, minValue: -0.5, maxValue: 1.5, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.src = null;
    this.G = Math.round(2560 * sampleRate / 44100) & ~1;
    this.H = this.G >> 1;
    this.win = new Float32Array(this.G);
    for (let i = 0; i < this.G; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.G);
    this.voices = [new Voice('on'), new Voice('off')];
    this.clock = 0;
    this.thr = 0;
    this.fade = 0;
    this.env = 0;
    this.port.onmessage = (e) => { if (e.data?.type === 'load') this._load(e.data); };
  }

  _load({ data, t, f, d, v, f0idle, f0max }) {
    const n = t.length;
    const P = new Float64Array(n), LF = new Float64Array(n), D = new Int8Array(n), Q = new Float32Array(n), L = new Float32Array(n);
    for (let i = 0; i < n; i++) { P[i] = t[i] * sampleRate; LF[i] = Math.log(f[i]); D[i] = d[i]; Q[i] = v ? Math.min(0.5, Math.max(0, (-v[i] - 8) * 0.03)) : 0; L[i] = v ? Math.pow(10, Math.min(24, Math.max(0, -v[i])) * 0.5 / 20) : 1; }
    // index sorted by pitch for the frame search
    const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => LF[a] - LF[b]);
    this.ord = Int32Array.from(ord);
    this.ordLF = Float64Array.from(ord.map((i) => LF[i]));
    this.P = P; this.LF = LF; this.D = D; this.Q = Q; this.L = L; this.n = n; // Q: penalty for quiet frames, L: level lift
    // (a recording at idle is ~20 dB under a full rev; in a game that reads as silence, so quiet frames are
    // brought up by half their shortfall: the engine still gets louder with revs, just not by as much)
    this.src = data; this.len = data.length;
    this.f0idle = f0idle; this.f0max = f0max;
    this.hop = n > 1 ? (P[n - 1] - P[0]) / (n - 1) : 1024; // average source samples between frames
    for (const v of this.voices) v.grains.length = 0;
    this.fade = 0;
  }

  // nearest analysed frame to a source position (frames are in time order; gaps = unusable audio)
  _frameAt(pos) {
    const P = this.P;
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] <= pos) lo = m; else hi = m; }
    const i = pos - P[lo] < P[hi] - pos ? lo : hi;
    return Math.abs(P[i] - pos) < this.hop * 1.6 ? i : -1;
  }

  _pick(v, lt) {
    const L = this.ordLF, n = this.n;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= lt) lo = m; else hi = m; }
    let best = -1, bestC = 1e9;
    const G = this.G, len = this.len;
    const scan = (k) => {
      const dl = Math.abs(L[k] - lt);
      if (dl > 0.35) return false;
      const i = this.ord[k];
      if (this.P[i] + G * 2.2 >= len) return true;
      const c = dl + v.cost[this.D[i]] + this.Q[i] + Math.random() * 0.012;
      if (c < bestC) { bestC = c; best = i; }
      return true;
    };
    for (let k = lo, m = 0; k >= 0 && m < 260; k--, m++) if (!scan(k)) break;
    for (let k = lo + 1, m = 0; k < n && m < 260; k++, m++) if (!scan(k)) break;
    if (best < 0) best = this.ord[lt < L[0] ? 0 : n - 1];
    return best;
  }

  _sample(p) {
    const i = p | 0, a = p - i, s = this.src;
    return s[i] + (s[i + 1] - s[i]) * a;
  }

  // offset that best continues the waveform of the grain `prev` (WSOLA)
  _align(prev, start, rate, lt) {
    if (!prev) return start;
    const period = sampleRate / Math.exp(lt);
    const span = Math.min(Math.round(period * 0.6), 1400);
    const Lc = 192, step = 2, len = this.len;
    const ref = this._ref || (this._ref = new Float32Array(Lc));
    for (let k = 0; k < Lc; k++) {
      const p = prev.pos + k * step * prev.rate;
      ref[k] = p < len - 2 ? this._sample(p) : 0;
    }
    let best = start, bestS = -Infinity;
    const coarse = Math.max(2, Math.round(span / 48));
    const test = (o) => {
      const s0 = start + o;
      if (s0 < 0 || s0 + (Lc * step + this.G) * rate >= len - 2) return;
      let xy = 0, yy = 1e-9;
      for (let k = 0; k < Lc; k++) { const y = this._sample(s0 + k * step * rate); xy += ref[k] * y; yy += y * y; }
      const sc = xy / Math.sqrt(yy);
      if (sc > bestS) { bestS = sc; best = s0; }
    };
    for (let o = -span; o <= span; o += coarse) test(o);
    const c = best - start;
    for (let o = c - coarse; o <= c + coarse; o += 1) test(o);
    return best;
  }

  _spawn(v, lt, pitch) {
    const prev = v.grains.length ? v.grains[v.grains.length - 1] : null;
    let pos = -1, fi = -1;
    if (prev) {
      // continue the recording where the previous grain has got to, if it still fits
      const cont = prev.pos;
      fi = this._frameAt(cont);
      if (fi >= 0 && cont + this.G * 2.2 < this.len && Math.abs(this.LF[fi] - lt) < 0.055 && v.cost[this.D[fi]] < 0.05) pos = cont;
      else fi = -1;
    }
    if (pos < 0) {
      fi = this._pick(v, lt);
      const rate0 = Math.min(2, Math.max(0.5, Math.exp(lt - this.LF[fi]))) * pitch;
      pos = this._align(prev, this.P[fi], rate0, lt);
    }
    const rate = Math.min(2, Math.max(0.5, Math.exp(lt - this.LF[fi]))) * pitch;
    v.grains.push({ pos, rate, age: 0, amp: this.L[fi] });
  }

  process(_in, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    if (!this.src) { out.fill(0); return true; }
    const rpmN = params.rpmN[0], pitch = params.pitch[0], gain = params.gain[0];
    const lt = Math.log(Math.max(4, this.f0idle + rpmN * (this.f0max - this.f0idle)));
    const thrT = params.throttle[0];
    const G = this.G, H = this.H, win = this.win, len = this.len;
    for (let i = 0; i < out.length; i++) {
      if (this.clock <= 0) {
        this.clock = H;
        for (const v of this.voices) this._spawn(v, lt, pitch);
      }
      this.clock--;
      this.thr += (thrT - this.thr) * 0.0012;
      this.fade += (1 - this.fade) * 0.0005;
      const wOn = Math.sqrt(this.thr), wOff = Math.sqrt(1 - this.thr);
      let acc = 0;
      for (let vi = 0; vi < 2; vi++) {
        const v = this.voices[vi];
        let s = 0;
        const gr = v.grains;
        for (let k = 0; k < gr.length; k++) {
          const g = gr[k];
          if (g.age < G && g.pos < len - 2) s += win[g.age] * g.amp * this._sample(g.pos);
          g.pos += g.rate; g.age++;
        }
        acc += s * (vi === 0 ? wOn : wOff);
      }
      // gentle peak limiter: the loudest recordings sit ~6 dB over the others at full revs
      const y = acc * gain * this.fade, ay = Math.abs(y);
      this.env = ay > this.env ? this.env + (ay - this.env) * 0.02 : this.env * 0.99985;
      out[i] = this.env > 0.85 ? y * 0.85 / this.env : y;
    }
    for (const v of this.voices) {
      const gr = v.grains;
      while (gr.length && gr[0].age >= G) gr.shift();
    }
    return true;
  }
}

registerProcessor('nightshift-engine-sample', EngineSampleProcessor);
