// NIGHTSHIFT audio - one-shot voices and the synthesized sound-effect recipes.

import { clamp, num, safeStop, safeDisconnect, createPanner } from './Util.js';

const rand = (a, b) => a + Math.random() * (b - a);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * A short-lived voice. Every node goes in `nodes`, every source is tracked; when all sources
 * have ended the whole graph is disconnected.
 */
export class Shot {
  constructor(mgr, dest, opts = {}) {
    const ctx = (this.ctx = mgr.ctx);
    this.mgr = mgr;
    this.buffers = mgr.buffers;
    this.nodes = [];
    this.pending = 0;
    this.dead = false;
    this.endAt = ctx.currentTime + 0.1;
    this.out = this.gain(num(opts.gain, 1));
    let tail = this.out;
    if (opts.position && mgr.listener) {
      const sp = mgr._spatial(opts.position, opts.ref || 10, 1, opts.maxDist || 400);
      const air = this.filter('lowpass', sp.air, 0.7);
      const pan = createPanner(ctx);
      this.nodes.push(pan);
      pan.pan.value = sp.pan;
      const att = this.gain(sp.gain);
      tail.connect(air).connect(pan).connect(att);
      tail = att;
    }
    tail.connect(dest);
    if (opts.reverb > 0 && mgr.reverbIn) {
      const send = this.gain(opts.reverb);
      tail.connect(send).connect(mgr.reverbIn);
    }
  }

  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; this.nodes.push(g); return g; }
  filter(type, f, q = 0.7) {
    const n = this.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q;
    this.nodes.push(n); return n;
  }
  shaper(curve) { const n = this.ctx.createWaveShaper(); n.curve = curve; this.nodes.push(n); return n; }

  /** Register and schedule a source node. */
  play(src, t, dur, offset) {
    this.nodes.push(src);
    this.pending++;
    src.onended = () => { if (--this.pending <= 0) this.cleanup(); };
    if (offset != null) src.start(t, offset); else src.start(t);
    safeStop(src, t + dur);
    this.endAt = Math.max(this.endAt, t + dur);
    return src;
  }

  osc(type, f, t, dur) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    return this.play(o, t, dur);
  }

  noise(kind, t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[kind] || this.buffers.white;
    s.loop = true;
    return this.play(s, t, dur, rand(0, s.buffer.duration * 0.8));
  }

  buffer(buf, t, rate = 1) {
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    return this.play(s, t, buf.duration / rate + 0.05);
  }

  /** Play a pre-rendered buffer with level, pitch and an optional low-pass (soft hits sound duller). */
  sample(buf, t, { rate = 1, gain = 1, lp = null } = {}) {
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = this.gain(gain);
    let n = src;
    if (lp) { const f = this.filter('lowpass', lp, 0.6); n.connect(f); n = f; }
    n.connect(g).connect(this.out);
    this.play(src, t, buf.duration / rate + 0.05);
    return src;
  }

  /** Oscillator tone with AD envelope and optional pitch glide. Returns the osc. */
  tone(type, f, t, a, peak, dec, fEnd, dest = this.out) {
    const o = this.osc(type, f, t, a + dec + 0.05);
    if (fEnd) o.frequency.setValueAtTime(f, t);
    if (fEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, fEnd), t + a + dec);
    const g = this.gain(0);
    env(g.gain, t, a, peak, dec);
    o.connect(g).connect(dest);
    return o;
  }

  /** Filtered noise hit with AD envelope and optional filter sweep. Returns the filter. */
  noiseHit(kind, ftype, f, q, t, a, peak, dec, fEnd, dest = this.out, pre) {
    const n = this.noise(kind, t, a + dec + 0.05);
    const flt = this.filter(ftype, f, q);
    if (fEnd) flt.frequency.setValueAtTime(f, t);
    if (fEnd) flt.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t + a + dec);
    const g = this.gain(0);
    env(g.gain, t, a, peak, dec);
    if (pre) n.connect(pre).connect(flt); else n.connect(flt);
    flt.connect(g).connect(dest);
    return flt;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    const t = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(t);
      this.out.gain.setTargetAtTime(0, t, 0.008);
    } catch (_) {}
    for (const n of this.nodes) if (typeof n.stop === 'function') safeStop(n, t + 0.04);
  }

  cleanup() {
    if (this._clean) return;
    this._clean = true;
    this.dead = true;
    for (const n of this.nodes) safeDisconnect(n);
    this.nodes.length = 0;
  }
}

function env(param, t, a, peak, dec) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), t + Math.max(0.001, a));
  param.exponentialRampToValueAtTime(0.0001, t + Math.max(0.001, a) + Math.max(0.005, dec));
}

// ---------------------------------------------------------------------------
// Recipes: (shot, t, opts, mgr). Each returns nothing; the shot tracks lifetime.
// ---------------------------------------------------------------------------

function metalResonators(s, t, amt, count = 6, base = 280) {
  // detuned inharmonic sine pairs = struck sheet metal
  const ratios = [1, 1.47, 2.09, 2.76, 3.52, 4.61, 5.83];
  for (let i = 0; i < count; i++) {
    const f = base * ratios[i % ratios.length] * rand(0.93, 1.08);
    const dec = rand(0.25, 0.8) * (0.6 + amt * 0.6);
    const pk = (0.05 / (1 + i * 0.4)) * amt;
    s.tone('sine', f, t, 0.002, pk, dec, f * rand(0.97, 0.995));
    s.tone('sine', f * rand(1.004, 1.012), t, 0.002, pk * 0.8, dec * 0.8);
  }
}

function glassTinkle(s, t, amt, n = 10) {
  for (let i = 0; i < n; i++) {
    const tt = t + 0.02 + Math.pow(Math.random(), 1.6) * 0.55;
    const f = rand(2600, 7500);
    s.tone('sine', f, tt, 0.001, rand(0.02, 0.06) * amt, rand(0.04, 0.16));
  }
  s.noiseHit('white', 'highpass', 5200, 0.7, t + 0.01, 0.002, 0.18 * amt, 0.22);
}

// impact type -> bank sound; intensity drives level, brightness and (slightly) pitch
const IMPACT = { heavy: 'crash', traffic: 'crash', light: 'bump', wall: 'wall', pole: 'pole', barrier: 'barrier' };
function playImpact(s, t, bank, name, k, extra = {}) {
  const buf = bank.pick(name);
  if (!buf) return false;
  s.sample(buf, t, {
    rate: rand(0.93, 1.07) * (1.08 - 0.16 * k),          // bigger hits: heavier, lower
    gain: (0.22 + 0.78 * Math.pow(k, 0.8)) * (extra.gain ?? 1),
    lp: 900 + 17000 * Math.pow(k, 1.3),                   // soft taps are dull, big hits are bright
  });
  return true;
}

const R = {
  collision(s, t, o, m) {
    const k = clamp(num(o.intensity, 0.6), 0, 1);
    const amt = 0.35 + 0.65 * k;
    const type = o.type || (k > 0.6 ? 'heavy' : 'light');
    const bank = m.impacts;
    if (bank?.ready) {
      let name = IMPACT[type] || 'crash';
      if (name === 'crash' && k < 0.25) name = 'bump';
      playImpact(s, t, bank, name, k);
      if (type === 'wall' && k > 0.45) playImpact(s, t + 0.004, bank, 'crash', k, { gain: 0.55 }); // body panels crumple too
      return;
    }
    switch (type) {
      case 'heavy': {
        const crunch = s.shaper(m.curves.crunch);
        s.noiseHit('white', 'lowpass', 4200, 1.2, t, 0.002, 0.75 * amt, 0.35 + 0.3 * k, 260, s.out, crunch);
        s.noiseHit('brown', 'lowpass', 400, 1, t, 0.003, 0.9 * amt, 0.45);
        s.tone('sine', 85, t, 0.003, 0.8 * amt, 0.4, 38);
        metalResonators(s, t, amt, 7, rand(240, 320));
        // secondary crumple
        s.noiseHit('white', 'bandpass', 1400, 2, t + 0.06, 0.004, 0.3 * amt, 0.2, 700, s.out, s.shaper(m.curves.crunch));
        break;
      }
      case 'light': {
        s.tone('sine', 120, t, 0.002, 0.55 * amt, 0.16, 55);
        s.noiseHit('brown', 'lowpass', 500, 0.8, t, 0.002, 0.6 * amt, 0.1);
        s.noiseHit('white', 'bandpass', 2200, 3, t, 0.001, 0.08 * amt, 0.03);
        break;
      }
      case 'wall': {
        s.tone('sine', 62, t, 0.003, 0.95 * amt, 0.35, 32);
        s.noiseHit('brown', 'lowpass', 260, 1.2, t, 0.003, 1.0 * amt, 0.32);
        // gritty concrete scrape + debris
        s.noiseHit('white', 'bandpass', 1700, 1.8, t + 0.01, 0.01, 0.22 * amt, 0.3, 900);
        for (let i = 0; i < 5; i++) s.noiseHit('white', 'bandpass', rand(900, 2500), 4, t + rand(0.05, 0.4), 0.001, 0.06 * amt, 0.03);
        break;
      }
      case 'pole': {
        // breakaway lamp post: dull thump, ringing hollow steel, the lamp head shattering
        s.tone('sine', 78, t, 0.002, 0.7 * amt, 0.22, 40);
        s.noiseHit('brown', 'lowpass', 520, 1, t, 0.002, 0.6 * amt, 0.14);
        metalResonators(s, t, amt * 0.9, 5, rand(420, 560));
        metalResonators(s, t + 0.9 + rand(0, 0.15), amt * 0.5, 4, rand(300, 380)); // it hits the ground
        glassTinkle(s, t + 0.95, amt * 0.8, 10);
        break;
      }
      case 'barrier': {
        // hollow plastic bounce + clatter
        s.tone('triangle', rand(380, 460), t, 0.002, 0.25 * amt, 0.09, 300);
        s.noiseHit('brown', 'lowpass', 700, 1, t, 0.002, 0.35 * amt, 0.08);
        const hits = 6 + Math.floor(k * 5);
        let tt = t + 0.04;
        for (let i = 0; i < hits; i++) {
          tt += rand(0.025, 0.09) * (1 + i * 0.12);
          const f = rand(1400, 3400);
          s.noiseHit('white', 'bandpass', f, 5, tt, 0.001, rand(0.08, 0.18) * amt / (1 + i * 0.2), rand(0.02, 0.05));
          s.tone('triangle', rand(500, 900), tt, 0.001, 0.05 * amt / (1 + i * 0.2), 0.04);
        }
        break;
      }
      case 'traffic':
      default: {
        const crunch = s.shaper(m.curves.crunch);
        s.noiseHit('white', 'lowpass', 3500, 1, t, 0.002, 0.55 * amt, 0.3, 300, s.out, crunch);
        s.tone('sine', 95, t, 0.003, 0.6 * amt, 0.3, 45);
        metalResonators(s, t, amt * 0.6, 4, rand(300, 380));
        glassTinkle(s, t, amt, 8 + Math.floor(k * 8));
        break;
      }
    }
  },

  // shoe on pavement: soft heel thud + a small gritty scuff
  footstep(s, t, o) {
    const k = clamp(num(o.intensity, 0.5), 0, 1);
    s.noiseHit('brown', 'lowpass', 380 + k * 250, 0.9, t, 0.002, 0.35 * k, 0.05);
    s.noiseHit('white', 'bandpass', rand(1800, 3200), 1.4, t + 0.008, 0.001, 0.07 * k, 0.03);
    s.tone('sine', rand(95, 130), t, 0.001, 0.12 * k, 0.04, 70);
  },

  crackle(s, t, o, m) {
    const k = num(o.intensity, 0.6);
    const pop = m.impacts?.ready && m.impacts.pick('backfire');
    if (pop) { s.sample(pop, t, { rate: rand(0.85, 1.2), gain: 0.35 + 0.55 * k, lp: 3000 + 9000 * k }); return; }
    s.noiseHit('white', 'bandpass', rand(500, 1300), 1.2, t, 0.001, 0.9 * k, rand(0.02, 0.06), null, s.out, s.shaper(m.curves.crunch));
    s.tone('sine', rand(70, 110), t, 0.001, 0.5 * k, 0.05, 40);
  },

  blowOff(s, t, o) {
    const k = clamp(num(o.intensity, 0.7), 0, 1);
    s.noiseHit('white', 'bandpass', 4200, 0.9, t, 0.012, 0.35 * k, 0.45, 1400);
    s.noiseHit('white', 'highpass', 6000, 0.7, t, 0.005, 0.12 * k, 0.25);
    // flutter "chu-chu"
    for (let i = 0; i < 3; i++) s.noiseHit('pink', 'bandpass', 900, 2, t + 0.05 + i * 0.045, 0.004, 0.08 * k, 0.03);
  },

  gearUp(s, t, o, m) {
    m.engine && m.engine.shiftDip(true);
    const cl = m.impacts?.ready && m.impacts.pick('clunk');
    if (cl) { s.sample(cl, t, { rate: rand(0.9, 1.1), gain: 0.35, lp: 5000 }); return; }
    s.noiseHit('brown', 'lowpass', 900, 1, t, 0.002, 0.35, 0.05);
    s.tone('sine', 150, t, 0.001, 0.25, 0.06, 90);
    s.noiseHit('white', 'bandpass', 3200, 6, t + 0.01, 0.001, 0.05, 0.02);
  },

  gearDown(s, t, o, m) {
    m.engine && m.engine.shiftDip(false);
    const cl = m.impacts?.ready && m.impacts.pick('clunk');
    if (cl) { s.sample(cl, t, { rate: rand(0.8, 0.95), gain: 0.3, lp: 4000 }); return; }
    s.noiseHit('brown', 'lowpass', 700, 1, t, 0.002, 0.35, 0.06);
    s.tone('sine', 120, t, 0.001, 0.22, 0.07, 70);
  },

  nitroStart(s, t) {
    s.tone('sine', 70, t, 0.005, 0.6, 0.25, 40);
    s.noiseHit('white', 'bandpass', 350, 0.8, t, 0.02, 0.45, 0.7, 3200);
    s.noiseHit('white', 'highpass', 3000, 0.7, t, 0.05, 0.12, 0.8);
  },

  nitroEnd(s, t) {
    s.noiseHit('white', 'bandpass', 2600, 0.8, t, 0.01, 0.2, 0.5, 500);
    s.noiseHit('pink', 'lowpass', 500, 1, t, 0.01, 0.2, 0.2);
  },

  brakeSqueal(s, t, o) {
    const k = clamp(num(o.intensity, 0.7), 0, 1);
    const dur = 0.5 + k * 0.4;
    const o1 = s.tone('sine', rand(2700, 3100), t, 0.03, 0.08 * k, dur);
    const vib = s.osc('sine', 6.5, t, dur + 0.1);
    const vd = s.gain(40); vib.connect(vd).connect(o1.frequency);
    s.noiseHit('white', 'bandpass', 3000, 8, t, 0.03, 0.15 * k, dur);
  },

  landing(s, t, o, m) {
    const k = clamp(num(o.intensity, 0.5), 0, 1);
    if (m?.impacts?.ready && playImpact(s, t, m.impacts, 'landing', k)) { if (k > 0.6) playImpact(s, t + 0.01, m.impacts, 'bump', k * 0.6, { gain: 0.5 }); return; }
    s.tone('sine', 90, t, 0.002, 0.7 * (0.3 + k), 0.25, 38);
    s.noiseHit('brown', 'lowpass', 600, 1, t, 0.002, 0.6 * (0.3 + k), 0.18);
    s.noiseHit('white', 'bandpass', 1800, 5, t + 0.03, 0.001, 0.08 * k, 0.05);
    if (k > 0.5) s.noiseHit('white', 'lowpass', 2500, 1, t, 0.002, 0.3 * k, 0.12, null, s.out, s.shaper(s.mgr.curves.crunch));
  },

  horn(s, t, o) {
    const dur = num(o.duration, 0.45);
    const lp = s.filter('lowpass', 2200, 1.5);
    const bp = s.filter('peaking', 800, 1.2); bp.gain.value = 6;
    const g = s.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.02);
    g.gain.setValueAtTime(0.28, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
    const f = num(o.pitch, 1);
    for (const hz of [392 * f, 494 * f]) {
      const x = s.osc('square', hz, t, dur + 0.1);
      x.connect(lp);
    }
    lp.connect(bp).connect(g).connect(s.out);
  },

  // ---- UI / game-flow ----
  checkpoint(s, t) {
    s.tone('sine', mtof(83), t, 0.004, 0.3, 0.35);
    s.tone('triangle', mtof(83), t, 0.004, 0.1, 0.2);
    s.tone('sine', mtof(88), t + 0.085, 0.004, 0.32, 0.5);
    s.tone('triangle', mtof(88), t + 0.085, 0.004, 0.1, 0.3);
  },

  countdown(s, t, o) {
    if (o.final) {
      s.tone('triangle', 1320, t, 0.005, 0.4, 0.6);
      s.tone('sine', 660, t, 0.005, 0.25, 0.6);
    } else {
      s.tone('triangle', 660, t, 0.004, 0.35, 0.18);
      s.tone('sine', 330, t, 0.004, 0.12, 0.15);
    }
  },

  raceFinish(s, t) {
    const notes = [69, 73, 76, 81, 85];
    notes.forEach((n, i) => s.tone('triangle', mtof(n), t + i * 0.08, 0.005, 0.22, 0.9));
    const lp = s.filter('lowpass', 2800, 1);
    lp.connect(s.out);
    for (const n of [57, 64, 69, 73]) {
      const x = s.tone('sawtooth', mtof(n), t + 0.35, 0.05, 0.07, 1.4, null, lp);
      x.detune.value = rand(-8, 8);
    }
    s.noiseHit('white', 'highpass', 8000, 0.7, t + 0.35, 0.3, 0.05, 1.0);
  },

  busted(s, t) {
    const lp = s.filter('lowpass', 1200, 2);
    lp.frequency.exponentialRampToValueAtTime(300, t + 1.6);
    lp.connect(s.out);
    [[50, 0, 0.2], [49, 0.24, 0.2], [45, 0.5, 1.2]].forEach(([n, d, len]) => {
      s.tone('sawtooth', mtof(n), t + d, 0.01, 0.3, len, null, lp);
      s.tone('square', mtof(n - 12), t + d, 0.01, 0.18, len, null, lp);
    });
    s.tone('sine', 70, t + 0.5, 0.003, 0.7, 0.5, 30);
    s.noiseHit('brown', 'lowpass', 300, 1, t + 0.5, 0.003, 0.6, 0.4);
  },

  escaped(s, t) {
    [57, 64, 69, 76, 81].forEach((n, i) => s.tone('triangle', mtof(n), t + i * 0.07, 0.005, 0.2, 0.6 + i * 0.1));
    s.noiseHit('white', 'bandpass', 400, 0.8, t, 0.3, 0.2, 0.5, 5000);
  },

  heatUp(s, t) {
    for (let i = 0; i < 4; i++) s.tone('square', i % 2 ? 660 : 880, t + i * 0.11, 0.003, 0.09, 0.09);
    s.noiseHit('pink', 'bandpass', 200, 1.2, t, 0.4, 0.25, 0.3, 1600);
    s.tone('sawtooth', 55, t, 0.3, 0.12, 0.5, 110);
  },

  uiClick(s, t) {
    s.tone('triangle', 1500, t, 0.001, 0.2, 0.04, 1100);
    s.noiseHit('white', 'highpass', 6000, 0.7, t, 0.001, 0.06, 0.012);
  },
  uiHover(s, t) { s.tone('sine', 2400, t, 0.002, 0.06, 0.03); },
  uiBack(s, t) { s.tone('triangle', 900, t, 0.002, 0.18, 0.09, 480); },

  purchase(s, t) {
    s.tone('sine', mtof(91), t, 0.002, 0.25, 0.45);
    s.tone('sine', mtof(96), t + 0.09, 0.002, 0.25, 0.7);
    s.tone('triangle', mtof(103), t + 0.09, 0.002, 0.05, 0.5);
    s.noiseHit('white', 'bandpass', 6000, 3, t, 0.001, 0.12, 0.05);
  },

  // ---- ambient far-away events (environment bus) ----
  farHorn(s, t) {
    R.horn(s, t, { duration: rand(0.3, 0.9), pitch: rand(0.85, 1.15) });
  },
  dog(s, t) {
    const barks = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < barks; i++) {
      const tt = t + i * rand(0.3, 0.5);
      const bp = s.filter('bandpass', rand(700, 1000), 2.5);
      bp.connect(s.out);
      s.tone('sawtooth', rand(420, 520), tt, 0.01, 0.35, 0.12, 280, bp);
      s.noiseHit('pink', 'bandpass', 1200, 2, tt, 0.005, 0.12, 0.08);
    }
  },
  distantSiren(s, t) {
    const dur = rand(3, 5.5);
    const o = s.osc('square', 700, t, dur + 0.2);
    const f = o.frequency;
    let tt = t;
    f.setValueAtTime(700, t);
    while (tt < t + dur) { f.linearRampToValueAtTime(1350, tt + 1.25); f.linearRampToValueAtTime(700, tt + 2.5); tt += 2.5; }
    const lp = s.filter('lowpass', 1600, 0.8);
    const g = s.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.8);
    g.gain.setValueAtTime(0.1, t + dur - 1);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g).connect(s.out);
  },
};

export const RECIPES = R;
