// NIGHTSHIFT audio - procedurally recorded impact sounds.
// Real crashes are dense: a low body thump, dozens of tiny sheet-metal crumple events, heavily damped panel
// resonances (car panels thud, they don't ring like bells), plastic cracks, glass and debris settling
// afterwards. That density can't be done with a few live oscillators, so each sound is rendered once into
// an AudioBuffer (several variations each) when audio starts, and the recipes play them back with
// intensity-dependent level, brightness and pitch.

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

class Canvas {
  constructor(sr, seconds, R) { this.sr = sr; this.d = new Float32Array(Math.ceil(sr * seconds)); this.R = R; }
  logU(lo, hi) { return lo * Math.pow(hi / lo, this.R()); }

  // band-passed white-noise burst with an exponential envelope (RBJ band-pass, constant peak gain)
  burst(t0, dur, amp, lo, hi, attack = 0.0005) {
    const { sr, d, R } = this;
    const f = Math.sqrt(lo * hi), q = Math.max(0.3, f / Math.max(1, hi - lo));
    const w = TAU * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const i0 = Math.floor(t0 * sr), n = Math.floor(dur * 5 * sr), tau = dur * sr;
    for (let i = 0; i < n && i0 + i < d.length; i++) {
      const x = R() * 2 - 1;
      const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const env = Math.min(1, i / (attack * sr + 1)) * Math.exp(-i / tau);
      d[i0 + i] += y * env * amp * 2.2;
    }
  }
  // damped sinusoid (a structural mode)
  mode(t0, f, decay, amp) {
    const { sr, d } = this;
    const i0 = Math.floor(t0 * sr), n = Math.floor(decay * 6 * sr), w = TAU * f / sr, ph = this.R() * TAU, k = Math.exp(-1 / (decay * sr));
    let e = amp;
    for (let i = 0; i < n && i0 + i < d.length; i++) { d[i0 + i] += Math.sin(w * i + ph) * e; e *= k; }
  }
  // low thump with a falling pitch (body / suspension mass)
  thump(t0, f0, f1, decay, amp) {
    const { sr, d } = this;
    const i0 = Math.floor(t0 * sr), n = Math.floor(decay * 6 * sr);
    let ph = 0;
    for (let i = 0; i < n && i0 + i < d.length; i++) {
      const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.7));
      ph += TAU * f / sr;
      d[i0 + i] += Math.sin(ph) * amp * Math.exp(-t / decay) * Math.min(1, i / (0.0015 * sr));
    }
  }
  // many short crumple/crackle grains, denser at the start
  crumple(t0, span, count, amp, lo = 500, hi = 5500) {
    for (let i = 0; i < count; i++) {
      const u = Math.pow(this.R(), 1.8), t = t0 + u * span;
      const f = this.logU(lo, hi);
      this.burst(t, 0.0015 + this.R() * 0.01, amp * (0.25 + this.R() * 0.75) * (1 - u * 0.8), f * 0.7, f * 1.4);
    }
  }
  // damped sheet-metal / plastic panel: a cloud of short modes
  panel(t0, count, lo, hi, decLo, decHi, amp) {
    for (let i = 0; i < count; i++) {
      const f = this.logU(lo, hi);
      this.mode(t0, f, decLo + this.R() * (decHi - decLo) * Math.sqrt(lo / f) * 1.6, amp * (0.3 + this.R() * 0.7) / Math.pow(f / lo, 0.35));
    }
  }
  glass(t0, amp) {
    this.crumple(t0, 0.08, 70, amp * 0.9, 2500, 12000);
    for (let i = 0; i < 26; i++) {
      const t = t0 + 0.03 + Math.pow(this.R(), 1.4) * 0.8;
      this.mode(t, this.logU(2800, 9500), 0.008 + this.R() * 0.04, amp * (0.08 + this.R() * 0.2) * (1 - (t - t0) * 0.8));
    }
  }
  debris(t0, span, count, amp, lo = 1200, hi = 6000) {
    let t = t0;
    for (let i = 0; i < count; i++) {
      t += (span / count) * (0.4 + this.R() * 1.2);
      const a = amp * (0.3 + this.R() * 0.7) * Math.pow(0.85, i);
      const f = this.logU(lo, hi);
      this.mode(t, f, 0.006 + this.R() * 0.02, a);
      this.burst(t, 0.002, a * 0.6, f * 0.6, f * 1.6);
    }
  }
  lowpass(fc) { const a = 1 - Math.exp(-TAU * fc / this.sr); let y = 0; const d = this.d; for (let i = 0; i < d.length; i++) { y += (d[i] - y) * a; d[i] = y; } }
  softclip(drive) { const d = this.d, k = Math.tanh(drive); for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * drive) / k; }
  finish(peak = 0.9, fadeOut = 0.05) {
    const d = this.d; let m = 0;
    for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
    const g = m > 0 ? peak / m : 1, nf = Math.floor(fadeOut * this.sr);
    for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - nf ? (d.length - i) / nf : 1);
    return d;
  }
}

// ------------------------------------------------------------------ recipes (sr, R) -> Float32Array
const RECIPES = {
  // car into car / heavy object: thump, crumple, damped panels, bumper cracks, sometimes glass, debris
  crash(sr, R, v) {
    const c = new Canvas(sr, 1.5, R);
    c.thump(0, 95, 36, 0.11, 1.0);
    c.burst(0, 0.05, 0.9, 40, 380);
    c.burst(0, 0.004, 0.8, 1200, 9000);
    c.crumple(0.002, 0.34, 110, 0.5);
    c.panel(0, 36, 140, 3800, 0.02, 0.09, 0.22);
    c.panel(0.05 + R() * 0.06, 20, 160, 3000, 0.015, 0.06, 0.12); // second contact as the cars shove apart
    for (let i = 0; i < 4; i++) c.burst(0.005 + R() * 0.11, 0.0015, 0.5, 2000, 7000);
    if (v % 2 === 0) c.glass(0.012, 0.55);
    c.debris(0.28, 0.9, 10, 0.2);
    c.softclip(1.6);
    return c.finish(0.92);
  },
  // light bump / bumper tap
  bump(sr, R) {
    const c = new Canvas(sr, 0.6, R);
    c.thump(0, 125, 58, 0.055, 0.8);
    c.burst(0, 0.03, 0.5, 60, 500);
    c.burst(0, 0.003, 0.35, 1500, 7000);
    c.panel(0, 14, 180, 1900, 0.012, 0.045, 0.2);
    c.crumple(0.002, 0.06, 14, 0.18, 800, 4500);
    c.softclip(1.3);
    return c.finish(0.85);
  },
  // into a concrete wall: deeper, harder, gritty, gravel afterwards
  wall(sr, R) {
    const c = new Canvas(sr, 1.4, R);
    c.thump(0, 70, 30, 0.14, 1.0);
    c.burst(0, 0.07, 1.0, 30, 300);
    c.burst(0, 0.005, 0.9, 900, 8000);
    c.crumple(0.002, 0.3, 80, 0.45);
    c.crumple(0.01, 0.5, 70, 0.25, 300, 2200); // concrete grit
    c.panel(0, 24, 130, 3000, 0.02, 0.08, 0.18);
    c.debris(0.2, 1.0, 16, 0.18, 1500, 6500);
    c.softclip(1.7);
    return c.finish(0.93);
  },
  // steel lamp post: hit, the hollow tube rings, it falls, clangs on the road, the lamp head breaks
  pole(sr, R) {
    const c = new Canvas(sr, 2.4, R);
    c.thump(0, 90, 40, 0.08, 0.8);
    c.burst(0, 0.004, 0.7, 1500, 8000);
    c.crumple(0.002, 0.12, 30, 0.35);
    const f0 = 380 + R() * 150;
    [1, 2.76, 5.4, 8.93, 13.34].forEach((r, i) => c.mode(0.002, f0 * r * (0.98 + R() * 0.04), 0.9 / (1 + i * 0.5), 0.35 / (1 + i * 0.7)));
    const tf = 0.9 + R() * 0.15; // hits the ground
    c.thump(tf, 80, 40, 0.06, 0.5);
    [1, 2.76, 5.4, 8.93].forEach((r, i) => c.mode(tf, f0 * 0.93 * r, 0.45 / (1 + i * 0.5), 0.28 / (1 + i * 0.7)));
    c.burst(tf, 0.03, 0.4, 500, 5000);
    c.glass(tf + 0.01, 0.5);
    [1, 2.76, 5.4].forEach((r, i) => c.mode(tf + 0.22, f0 * 0.93 * r, 0.25, 0.1 / (1 + i)));
    return c.finish(0.9);
  },
  // plastic water barrier / cone: hollow knock and clattering bounces
  barrier(sr, R) {
    const c = new Canvas(sr, 1.2, R);
    c.thump(0, 150, 90, 0.06, 0.6);
    c.panel(0, 12, 140, 1300, 0.025, 0.07, 0.3);
    c.burst(0, 0.004, 0.3, 1000, 5000);
    let t = 0.08;
    for (let i = 0; i < 6; i++) { t += 0.06 + R() * 0.12 * (1 + i * 0.15); c.panel(t, 6, 200, 1600, 0.01, 0.04, 0.2 * Math.pow(0.78, i)); c.burst(t, 0.003, 0.15 * Math.pow(0.78, i), 1500, 6000); }
    return c.finish(0.85);
  },
  // suspension bottoming out / landing
  landing(sr, R) {
    const c = new Canvas(sr, 0.7, R);
    c.thump(0, 80, 34, 0.13, 1.0);
    c.burst(0, 0.05, 0.6, 30, 260);
    c.panel(0, 14, 90, 700, 0.03, 0.08, 0.2);   // chassis / damper clunk
    c.crumple(0.01, 0.14, 10, 0.08, 1500, 4500); // rattles
    c.softclip(1.4);
    return c.finish(0.9);
  },
  // exhaust backfire / overrun pop
  backfire(sr, R) {
    const c = new Canvas(sr, 0.45, R);
    c.burst(0, 0.0025, 1.0, 300, 9000);
    c.thump(0, 120, 45, 0.05, 0.9);
    c.burst(0.001, 0.05, 0.5, 150, 1400);
    c.panel(0, 8, 160, 900, 0.015, 0.04, 0.15); // pipe ring
    c.softclip(2.2);
    return c.finish(0.9);
  },
  // gearbox clunk
  clunk(sr, R) {
    const c = new Canvas(sr, 0.18, R);
    c.thump(0, 150, 90, 0.02, 0.5);
    c.panel(0, 8, 700, 3200, 0.006, 0.018, 0.25);
    c.burst(0, 0.002, 0.2, 2000, 7000);
    return c.finish(0.7);
  },
  // tyre screech: rubber stick-slip = a few tonal bands with chaotic pitch/level wobble plus rubber hiss
  screech(sr, R) {
    const L = 3.0, X = 0.15, n = Math.floor((L + X) * sr);
    const d = new Float32Array(n);
    const walk = (rate, depth) => { // smoothed random walk (low-passed noise), unit-ish range
      const out = new Float32Array(n); let y = 0, v = 0; const a = 1 - Math.exp(-TAU * rate / sr);
      for (let i = 0; i < n; i++) { v += ((R() * 2 - 1) - v) * a; y += (v * 6 - y) * a; out[i] = y * depth; }
      return out;
    };
    const amp = walk(9, 1), fm = walk(28, 1);
    const parts = [[760 + R() * 80, 1], [1040 + R() * 90, 0.55], [1530 + R() * 120, 0.3], [2280 + R() * 160, 0.15]];
    for (const [f0, a0] of parts) {
      let ph = R() * TAU; const own = walk(17, 1);
      for (let i = 0; i < n; i++) {
        const f = f0 * (1 + 0.05 * fm[i] + 0.02 * own[i]);
        ph += TAU * f / sr;
        const e = Math.max(0, 0.65 + 0.5 * amp[i] + 0.25 * own[i]);
        d[i] += Math.sin(ph) * a0 * e * 0.3;
      }
    }
    // rubber hiss: band-limited noise following the same grip wobble
    let lp = 0, hp = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const x = R() * 2 - 1; lp += (x - lp) * 0.35; const h = lp - prev; prev = lp; hp = h;
      d[i] += hp * 0.35 * Math.max(0, 0.6 + 0.5 * amp[i]);
    }
    const nx = Math.floor(X * sr), nl = Math.floor(L * sr), out = new Float32Array(nl);
    for (let i = 0; i < nl; i++) out[i] = d[i];
    for (let i = 0; i < nx; i++) { const k = i / nx; out[i] = d[i] * k + d[nl + i] * (1 - k); }
    let m = 0; for (let i = 0; i < nl; i++) m = Math.max(m, Math.abs(out[i]));
    for (let i = 0; i < nl; i++) out[i] *= 0.8 / (m || 1);
    return out;
  },
  // metal/plastic grinding along concrete; rendered loopable
  scrape(sr, R) {
    const L = 2.4, X = 0.12;
    const c = new Canvas(sr, L + X, R);
    const n = Math.floor((L + X) * 420);
    for (let i = 0; i < n; i++) {
      const t = R() * (L + X);
      const f = c.logU(500, 5500);
      c.burst(t, 0.002 + R() * 0.008, 0.08 + R() * 0.2, f * 0.6, f * 1.6);
    }
    for (let i = 0; i < 40; i++) c.mode(R() * (L + X), c.logU(900, 3200), 0.02 + R() * 0.05, 0.08); // squeals
    c.burst(0, (L + X) / 5, 0.15, 40, 250); // low body rumble
    const d = c.d, nx = Math.floor(X * sr), nl = Math.floor(L * sr);
    const out = new Float32Array(nl);
    for (let i = 0; i < nl; i++) out[i] = d[i];
    for (let i = 0; i < nx; i++) { const k = i / nx; out[i] = d[i] * k + d[nl + i] * (1 - k); } // crossfade tail into head
    let m = 0; for (let i = 0; i < nl; i++) m = Math.max(m, Math.abs(out[i]));
    for (let i = 0; i < nl; i++) out[i] *= 0.8 / (m || 1);
    return out;
  },
};

const COUNTS = { crash: 4, bump: 4, wall: 3, pole: 2, barrier: 3, landing: 3, backfire: 5, clunk: 3, scrape: 1, screech: 1 };

export class ImpactBank {
  constructor(ctx) { this.ctx = ctx; this.b = {}; this.ready = false; }

  // render in small slices so starting audio never stalls a frame
  build(onReady) {
    const jobs = [];
    for (const [name, n] of Object.entries(COUNTS)) for (let v = 0; v < n; v++) jobs.push([name, v]);
    const step = () => {
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < 6) {
        const [name, v] = jobs.shift();
        const data = RECIPES[name](this.ctx.sampleRate, rng(0x9e3779b1 ^ (v * 7919 + name.length * 104729)), v);
        const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
        buf.getChannelData(0).set(data);
        (this.b[name] ||= []).push(buf);
      }
      if (jobs.length) setTimeout(step, 0); else { this.ready = true; onReady?.(); }
    };
    setTimeout(step, 0);
  }

  pick(name) { const a = this.b[name]; return a?.length ? a[Math.floor(Math.random() * a.length)] : null; }
}
