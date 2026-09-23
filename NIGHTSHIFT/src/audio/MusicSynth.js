// NIGHTSHIFT audio - original procedural night-drive synthwave loop.
// Lookahead scheduler on AudioContext time; all instruments synthesized.

import { clamp, glide, safeStop, safeDisconnect } from './Util.js';

const BPM = 100;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.18;    // seconds scheduled ahead
const TICK_MS = 25;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 8-bar phrase in A minor. root = bass midi note, pad = chord voicing.
const BARS = [
  { root: 33, pad: [57, 60, 64] }, // Am
  { root: 29, pad: [57, 60, 65] }, // F
  { root: 36, pad: [55, 60, 64] }, // C
  { root: 31, pad: [55, 59, 62] }, // G
  { root: 33, pad: [57, 60, 64] }, // Am
  { root: 29, pad: [57, 60, 65] }, // F
  { root: 38, pad: [57, 62, 65] }, // Dm
  { root: 28, pad: [56, 59, 64] }, // E
];

// Original lead motif: [step, midi, lengthInSteps] per bar
const LEAD = [
  [[0, 76, 6], [6, 74, 2], [8, 72, 4], [12, 69, 4]],
  [[0, 72, 6], [6, 69, 2], [8, 65, 4], [12, 67, 2], [14, 69, 2]],
  [[0, 67, 4], [4, 72, 4], [8, 76, 6], [14, 74, 2]],
  [[0, 74, 8], [8, 71, 4], [12, 67, 4]],
  [[0, 69, 2], [2, 72, 2], [4, 76, 4], [8, 81, 6], [14, 79, 2]],
  [[0, 77, 6], [6, 76, 2], [8, 72, 8]],
  [[0, 74, 4], [4, 77, 4], [8, 76, 4], [12, 74, 4]],
  [[0, 71, 6], [6, 68, 2], [8, 64, 8]],
];

const BASS_CALM = [0, null, 0, null, 12, null, 0, null, 0, null, 7, null, 12, null, 0, 7];
const BASS_DRIVE = [0, 0, 12, 0, 0, 0, 12, 0, 7, 7, 12, 7, 0, 0, 12, 12];

export class MusicSynth {
  constructor(ctx, out, buffers, reverbSend) {
    this.ctx = ctx;
    this.buffers = buffers;
    this.on = false;
    this.intensity = 0;
    this.timer = null;
    this.step = 0;
    this.bar = 0;
    this.loop = 0;
    this.nextTime = 0;
    this.live = 0; // scheduled note sources still alive

    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.out = g(0);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 2600; this.filter.Q.value = 0.8;
    this.mix = g(0.8);
    this.mix.connect(this.filter).connect(this.out).connect(out);

    this.drums = g(0.7); this.drums.connect(this.mix);
    this.bassBus = g(0.55); this.bassBus.connect(this.mix);
    this.padPump = g(1);
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 1400; this.padFilter.Q.value = 2;
    this.padLfo = ctx.createOscillator(); this.padLfo.frequency.value = 0.07;
    this.padLfoDepth = g(500); this.padLfo.connect(this.padLfoDepth).connect(this.padFilter.frequency);
    this.padBus = g(0.22);
    this.padFilter.connect(this.padPump).connect(this.padBus).connect(this.mix);
    this.leadBus = g(0.12); this.leadBus.connect(this.mix);
    this.arpBus = g(0); this.arpBus.connect(this.mix);

    // dotted-eighth echo for lead / arp
    this.delay = ctx.createDelay(1.5); this.delay.delayTime.value = STEP * 3;
    this.fb = g(0.38);
    this.delayLP = ctx.createBiquadFilter(); this.delayLP.type = 'lowpass'; this.delayLP.frequency.value = 2400;
    this.delaySend = g(0.5);
    this.leadBus.connect(this.delaySend); this.arpBus.connect(this.delaySend);
    this.delaySend.connect(this.delay).connect(this.delayLP).connect(this.fb).connect(this.delay);
    this.delayLP.connect(this.mix);

    this.revSend = g(0.25);
    if (reverbSend) { this.mix.connect(this.revSend).connect(reverbSend); }
    this.snareVerb = g(0.5);
    if (reverbSend) this.snareVerb.connect(reverbSend);

    this.padLfo.start();
    this._tick = () => this.schedule();
  }

  setOn(on) {
    on = !!on;
    const t = this.ctx.currentTime;
    if (on === this.on) return;
    this.on = on;
    if (on) {
      this.step = 0; this.bar = 0; this.loop = 0;
      this.nextTime = t + 0.08;
      glide(this.out.gain, 1, t, 0.4);
      if (!this.timer && typeof setInterval === 'function') this.timer = setInterval(this._tick, TICK_MS);
      this.schedule();
    } else {
      glide(this.out.gain, 0, t, 0.3);
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
  }

  setIntensity(v) {
    this.intensity = clamp(Number(v) || 0, 0, 1);
    const t = this.ctx.currentTime;
    const i = this.intensity;
    glide(this.filter.frequency, 2400 + i * 9000, t, 0.5);
    glide(this.drums.gain, 0.6 + i * 0.45, t, 0.4);
    glide(this.arpBus.gain, clamp((i - 0.3) * 0.2, 0, 0.12), t, 0.5);
    glide(this.bassBus.gain, 0.5 + i * 0.15, t, 0.4);
  }

  /** Lookahead scheduler: safe to call often (interval + per-frame). */
  schedule() {
    if (!this.on) return;
    const now = this.ctx.currentTime;
    if (this.ctx.state !== 'running') return;
    // resync if we fell far behind (tab hidden, etc.)
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    let guard = 0;
    while (this.nextTime < now + LOOKAHEAD && guard++ < 32) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
      if (this.step >= 16) {
        this.step = 0;
        this.bar++;
        if (this.bar >= BARS.length) { this.bar = 0; this.loop++; }
      }
    }
  }

  _playStep(s, t) {
    const i = this.intensity;
    const bar = BARS[this.bar];
    const drive = i > 0.55;
    const intro = this.loop === 0 && this.bar < 2; // sparse opening

    // ---- drums ----
    const kickSteps = drive ? (s % 4 === 0 || (s === 14 && this.bar % 2 === 1)) : (s === 0 || s === 6 || s === 8 || (s === 11 && this.bar % 4 === 3));
    if (kickSteps && !(intro && s !== 0)) {
      this._kick(t);
      // sidechain pump on the pad
      const p = this.padPump.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(0.35, t);
      p.linearRampToValueAtTime(1, t + 0.28);
    }
    if (!intro && (s === 4 || s === 12)) this._snare(t, 1);
    if (!intro && drive && s === 15 && this.bar % 4 === 3) this._snare(t, 0.5);
    const hat16 = i > 0.4;
    if (!intro && (s % 2 === 0 || hat16)) {
      const open = s % 4 === 2;
      this._hat(t, open ? 0.11 : 0.035, (s % 2 ? 0.35 : 0.6) * (open ? 1 : 0.8));
    }

    // ---- bass ----
    const pat = drive ? BASS_DRIVE : BASS_CALM;
    const off = pat[s];
    if (off != null) this._bass(t, mtof(bar.root + off), STEP * (drive ? 0.9 : 1.6));

    // ---- pad (once per bar) ----
    if (s === 0) for (const m of bar.pad) this._pad(t, mtof(m), STEP * 16);

    // ---- lead: every other pass through the phrase ----
    if (this.loop % 2 === 1) {
      for (const [st, m, len] of LEAD[this.bar]) if (st === s) this._lead(t, mtof(m), STEP * len);
    }

    // ---- arp (only audible with intensity) ----
    if (i > 0.3) {
      const notes = [bar.pad[0] + 12, bar.pad[1] + 12, bar.pad[2] + 12, bar.pad[1] + 24];
      this._arp(t, mtof(notes[s % 4]), STEP * 0.8);
    }
  }

  // ---------- instruments (short-lived nodes, auto-cleanup) ----------
  _done(src, nodes) {
    this.live++;
    src.onended = () => { this.live--; for (const n of nodes) safeDisconnect(n); };
  }

  _kick(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    const g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g).connect(this.drums);
    o.start(t); safeStop(o, t + 0.4);
    this._done(o, [o, g]);
  }

  _snare(t, amt) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.buffers.white;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.5 * amt, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.4 * amt, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(hp).connect(ng).connect(this.drums);
    ng.connect(this.snareVerb);
    o.connect(og).connect(this.drums);
    n.start(t, Math.random() * 1.5); safeStop(n, t + 0.22);
    o.start(t); safeStop(o, t + 0.14);
    this._done(n, [n, hp, ng]);
    this._done(o, [o, og]);
  }

  _hat(t, dec, amt) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.buffers.white;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18 * amt, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    n.connect(hp).connect(g).connect(this.drums);
    n.start(t, Math.random() * 1.5); safeStop(n, t + dec + 0.02);
    this._done(n, [n, hp, g]);
  }

  _bass(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    const top = 500 + this.intensity * 1400;
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + len);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.006);
    g.gain.setTargetAtTime(0, t + len * 0.8, 0.03);
    o.connect(lp).connect(g).connect(this.bassBus);
    o.start(t); safeStop(o, t + len + 0.15);
    this._done(o, [o, lp, g]);
  }

  _pad(t, f, len) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.5);
    g.gain.setValueAtTime(0.3, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0, t + len + 0.5);
    g.connect(this.padFilter);
    const oscs = [];
    for (const det of [-9, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(g); o.start(t); safeStop(o, t + len + 0.55);
      oscs.push(o);
    }
    this._done(oscs[0], [oscs[0], g]);
    this._done(oscs[1], [oscs[1]]);
  }

  _lead(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2; o2.detune.value = 4;
    const vib = c.createOscillator(); vib.frequency.value = 5.2;
    const vd = c.createGain(); vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(f * 0.006, t + len);
    vib.connect(vd); vd.connect(o.frequency); vd.connect(o2.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.setTargetAtTime(0.22, t + 0.05, 0.1);
    g.gain.setTargetAtTime(0, t + len * 0.95, 0.05);
    const g2 = c.createGain(); g2.gain.value = 0.3;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(this.leadBus);
    const end = t + len + 0.3;
    o.start(t); o2.start(t); vib.start(t);
    safeStop(o, end); safeStop(o2, end); safeStop(vib, end);
    this._done(o, [o, lp, g, vd]);
    this._done(o2, [o2, g2]);
    this._done(vib, [vib]);
  }

  _arp(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(this.arpBus);
    o.start(t); safeStop(o, t + len + 0.02);
    this._done(o, [o, g]);
  }

  dispose() {
    this.setOn(false);
    safeStop(this.padLfo, this.ctx.currentTime);
  }
}
