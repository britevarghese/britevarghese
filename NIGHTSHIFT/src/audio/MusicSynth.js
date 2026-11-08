// NIGHTSHIFT audio - the procedural radio. Plays songs described as data (RadioSongs.js) with a lookahead
// scheduler on AudioContext time; every instrument is synthesized: synthwave kit, tabla / chenda / dhol
// style drums, a tanpura drone, plucked and reed leads, electric piano, vinyl crackle and rain.

import { clamp, glide, safeStop, safeDisconnect } from './Util.js';
import { DEFAULT_SONG } from './RadioSongs.js';

const LOOKAHEAD = 0.18;    // seconds scheduled ahead
const TICK_MS = 25;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const hit = (pat, s, bar, loop) => (typeof pat === 'function' ? pat(s, bar, loop) : Array.isArray(pat) && pat.includes(s) ? 1 : 0);

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
    this.onSongEnd = null;

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

    // echo for lead / arp (dotted eighth of the current song)
    this.delay = ctx.createDelay(1.5);
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

    // lo-fi bed: vinyl hiss and rain (running sources, faded in only on songs that want them)
    this.bed = g(0); this.bed.connect(this.mix);
    const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s; };
    if (buffers?.pink && buffers?.brown) {
      this.hiss = loop(buffers.pink);
      const hissBP = ctx.createBiquadFilter(); hissBP.type = 'bandpass'; hissBP.frequency.value = 3200; hissBP.Q.value = 0.7;
      const hissG = g(0.05);
      this.hiss.connect(hissBP).connect(hissG).connect(this.bed);
      this.rain = loop(buffers.brown);
      const rainLP = ctx.createBiquadFilter(); rainLP.type = 'highpass'; rainLP.frequency.value = 900;
      const rainG = g(0.08);
      this.rain.connect(rainLP).connect(rainG).connect(this.bed);
    }

    this.padLfo.start();
    this._bedStarted = false;
    this._tick = () => this.schedule();
    this.setSong(DEFAULT_SONG);
  }

  get stepDur() { return 60 / this.song.bpm / 4; }

  /** Switch to another song; it starts on the next step (with a short gap when already playing). */
  setSong(song) {
    if (!song) return;
    this.song = song;
    this.step = 0; this.bar = 0; this.loop = 0;
    const t = this.ctx.currentTime;
    this.delay.delayTime.setValueAtTime(this.stepDur * 3, t);
    this.nextTime = Math.max(this.nextTime, t + 0.35);
    glide(this.bed.gain, song.crackle ? 1 : 0, t, 0.6);
    if (song.crackle && !this._bedStarted && this.hiss) { this.hiss.start(t, Math.random()); this.rain.start(t, Math.random()); this._bedStarted = true; }
    glide(this.mix.gain, 0.8 * (song.gain ?? 1), t, 0.3); // stations matched in loudness
    glide(this.padBus.gain, song.pad === 'drone' ? 0.16 : song.pad === 'rhodes' ? 0.3 : 0.22, t, 0.3);
    glide(this.leadBus.gain, song.lead === 'reed' ? 0.1 : song.lead === 'pluck' ? 0.2 : song.lead === 'rhodes' ? 0.16 : 0.12, t, 0.3);
    this.setIntensity(this.intensity);
  }

  setOn(on) {
    on = !!on;
    const t = this.ctx.currentTime;
    if (on === this.on) return;
    this.on = on;
    if (on) {
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
    const i = this.intensity, s = this.song || {};
    const lofi = s.kit === 'lofi';
    glide(this.filter.frequency, lofi ? 3200 + i * 1500 : 2400 + i * 9000, t, 0.5);
    glide(this.drums.gain, (s.kit === 'kuthu' ? 0.8 : 0.6) + i * 0.45, t, 0.4);
    glide(this.arpBus.gain, s.arp ? clamp((i - 0.3) * 0.2, 0, 0.12) : 0, t, 0.5);
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
    const song = this.song;
    while (this.nextTime < now + LOOKAHEAD && guard++ < 32) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
      if (this.step >= song.steps) {
        this.step = 0;
        this.bar++;
        if (this.bar >= song.bars.length) {
          this.bar = 0; this.loop++;
          if (song.loops && this.loop >= song.loops && this.onSongEnd) { this.onSongEnd(); if (this.song !== song) return; }
        }
      }
    }
  }

  _playStep(s, t0) {
    const S = this.song, i = this.intensity;
    const bar = S.bars[this.bar];
    const t = t0 + (S.swing && s % 2 === 1 ? S.swing * this.stepDur : 0);
    const intro = this.loop === 0 && this.bar < 2; // sparse opening
    const drive = i > 0.55;
    const kit = S.kit;
    const dur = this.stepDur;

    // ---- drums ----
    const D = S.drums || (drive ? S.drumsDrive : S.drumsCalm) || {};
    if (!(intro && s !== 0)) {
      if (hit(D.kick, s, this.bar, this.loop)) {
        this._kick(t, kit === 'lofi');
        if (kit === 'synth') { const p = this.padPump.gain; p.cancelScheduledValues(t); p.setValueAtTime(0.35, t); p.linearRampToValueAtTime(1, t + 0.28); }
      }
    }
    if (!intro) {
      if (hit(D.snare, s, this.bar, this.loop)) this._snare(t, kit === 'lofi' ? 0.45 : 1, kit === 'lofi');
      if (D.hat) {
        const play = D.hat === 'sixteenths' || (D.hat === 'eighths' && s % 2 === 0) || hit(D.hat, s, this.bar, this.loop);
        if (play) { const open = s % 4 === 2 && kit === 'synth'; this._hat(t, open ? 0.11 : 0.035, (s % 2 ? 0.35 : 0.6) * (open ? 1 : 0.8) * (kit === 'lofi' ? 0.5 : 1)); }
      }
      if (hit(D.rim, s, this.bar, this.loop)) this._rim(t);
      if (hit(D.clap, s, this.bar, this.loop)) this._clap(t);
      if (hit(D.dhol, s, this.bar, this.loop)) { this._tom(t, 82, 0.95); if (s % 4 === 0) this._clap(t, 0.25); }
      if (hit(D.tom, s, this.bar, this.loop)) this._tom(t, 150, 0.55);
      const ch = hit(D.chenda, s, this.bar, this.loop);
      if (ch) this._chenda(t, ch);
    }
    if (hit(D.ge, s, this.bar, this.loop) && !(intro && s !== 0)) this._tablaGe(t);
    if (!intro) {
      if (hit(D.na, s, this.bar, this.loop)) this._tablaNa(t, 1);
      if (hit(D.tin, s, this.bar, this.loop)) this._tablaNa(t, 1.32);
      if (hit(D.te, s, this.bar, this.loop)) this._hat(t, 0.025, 0.45);
    }
    if (S.crackle && Math.random() < 0.18) this._pop(t + Math.random() * dur);

    // ---- bass ----
    const pat = S.bass || (drive ? S.bassDrive : S.bassCalm);
    const off = pat?.[s];
    if (off != null) {
      const f = mtof(bar.root + off);
      if (S.bassType === 'sub') this._sub(t, f, dur * 1.8);
      else if (S.bassType === 'round') this._round(t, f, dur * 3);
      else this._bass(t, f, dur * (drive ? 0.9 : 1.6));
    }

    // ---- chords / drone (once per bar) ----
    if (s === 0 && bar.pad?.length) {
      const len = dur * S.steps;
      if (S.pad === 'saw') for (const m of bar.pad) this._pad(t, mtof(m), len);
      else if (S.pad === 'drone') this._drone(t, bar.pad.map(mtof), len);
      else if (S.pad === 'rhodes') { bar.pad.forEach((m, k) => this._rhodes(t + k * 0.012, mtof(m), len * 0.9, 0.5)); }
    }
    if (S.pad === 'rhodes' && s === 10 && bar.pad?.length && this.bar % 2 === 1) bar.pad.forEach((m, k) => this._rhodes(t + k * 0.015, mtof(m), dur * 5, 0.32));

    // ---- melody ----
    const every = S.leadEvery || 2;
    if (S.leadNotes && (every === 1 || this.loop % every === every - 1)) {
      for (const [st, m, len] of S.leadNotes[this.bar] || []) {
        if (st !== s) continue;
        const f = mtof(m), L = dur * len;
        if (S.lead === 'pluck') this._pluck(t, f, L);
        else if (S.lead === 'reed') this._reed(t, f, L);
        else if (S.lead === 'rhodes') this._rhodes(t, f, L, 0.8);
        else this._lead(t, f, L);
      }
    }

    // ---- arp (synthwave, only audible with intensity) ----
    if (S.arp && i > 0.3 && bar.pad?.length >= 3) {
      const notes = [bar.pad[0] + 12, bar.pad[1] + 12, bar.pad[2] + 12, bar.pad[1] + 24];
      this._arp(t, mtof(notes[s % 4]), dur * 0.8);
    }
  }

  // ---------- instruments (short-lived nodes, auto-cleanup) ----------
  _done(src, nodes) {
    this.live++;
    src.onended = () => { this.live--; for (const n of nodes) safeDisconnect(n); };
  }
  _env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.001, t + a + dec);
  }
  _noise(t, dur) { const n = this.ctx.createBufferSource(); n.buffer = this.buffers.white; n.start(t, Math.random() * 1.5); safeStop(n, t + dur); return n; }

  _kick(t, soft = false) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    const g = c.createGain();
    o.frequency.setValueAtTime(soft ? 110 : 150, t);
    o.frequency.exponentialRampToValueAtTime(soft ? 48 : 44, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(soft ? 0.7 : 1, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + (soft ? 0.3 : 0.38));
    o.connect(g).connect(this.drums);
    o.start(t); safeStop(o, t + 0.4);
    this._done(o, [o, g]);
  }

  _snare(t, amt, brush = false) {
    const c = this.ctx;
    const n = this._noise(t, brush ? 0.3 : 0.22);
    const hp = c.createBiquadFilter(); hp.type = brush ? 'bandpass' : 'highpass'; hp.frequency.value = brush ? 2400 : 1100; hp.Q.value = brush ? 0.6 : 0.7;
    const ng = c.createGain();
    this._env(ng, t, 0.003, 0.5 * amt, brush ? 0.26 : 0.2);
    n.connect(hp).connect(ng).connect(this.drums);
    ng.connect(this.snareVerb);
    this._done(n, [n, hp, ng]);
    if (!brush) {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
      const og = c.createGain();
      this._env(og, t, 0.003, 0.4 * amt, 0.12);
      o.connect(og).connect(this.drums);
      o.start(t); safeStop(o, t + 0.14);
      this._done(o, [o, og]);
    }
  }

  _hat(t, dec, amt) {
    const c = this.ctx;
    const n = this._noise(t, dec + 0.02);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const g = c.createGain();
    this._env(g, t, 0.002, 0.18 * amt, dec);
    n.connect(hp).connect(g).connect(this.drums);
    this._done(n, [n, hp, g]);
  }

  _rim(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 1700;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 6;
    const g = c.createGain(); this._env(g, t, 0.001, 0.18, 0.03);
    o.connect(bp).connect(g).connect(this.drums); o.start(t); safeStop(o, t + 0.06);
    this._done(o, [o, bp, g]);
  }

  _clap(t, amt = 1) {
    const c = this.ctx;
    for (let k = 0; k < 3; k++) {
      const tt = t + k * 0.011;
      const n = this._noise(tt, 0.16);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;
      const g = c.createGain(); this._env(g, tt, 0.001, (k === 2 ? 0.45 : 0.3) * amt, k === 2 ? 0.14 : 0.02);
      n.connect(bp).connect(g).connect(this.drums);
      if (k === 2) g.connect(this.snareVerb);
      this._done(n, [n, bp, g]);
    }
  }

  // dhol / floor tom: a pitched thump with a slap on top
  _tom(t, f, amt) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = c.createGain(); this._env(g, t, 0.002, 0.9 * amt, 0.28);
    o.connect(g).connect(this.drums); o.start(t); safeStop(o, t + 0.35);
    this._done(o, [o, g]);
    const n = this._noise(t, 0.05);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1;
    const ng = c.createGain(); this._env(ng, t, 0.001, 0.25 * amt, 0.03);
    n.connect(bp).connect(ng).connect(this.drums);
    this._done(n, [n, bp, ng]);
  }

  // chenda: Kerala's cylindrical temple drum, a hard dry crack with a short ring
  _chenda(t, amt) {
    const c = this.ctx;
    const n = this._noise(t, 0.08);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900 + amt * 700; bp.Q.value = 2.5;
    const g = c.createGain(); this._env(g, t, 0.001, 0.55 * amt, 0.06);
    n.connect(bp).connect(g).connect(this.drums);
    this._done(n, [n, bp, g]);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(330, t + 0.05);
    const og = c.createGain(); this._env(og, t, 0.001, 0.2 * amt, 0.07);
    o.connect(og).connect(this.drums); o.start(t); safeStop(o, t + 0.1);
    this._done(o, [o, og]);
  }

  // tabla: the bayan's deep 'ge' bends up as the palm presses; the dayan's 'na' rings with a bright overtone
  _tablaGe(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(82, t); o.frequency.linearRampToValueAtTime(118, t + 0.18);
    const g = c.createGain(); this._env(g, t, 0.004, 0.75, 0.42);
    o.connect(g).connect(this.drums); o.start(t); safeStop(o, t + 0.5);
    this._done(o, [o, g]);
  }
  _tablaNa(t, k = 1) {
    const c = this.ctx;
    const f = 440 * k;
    const g = c.createGain(); this._env(g, t, 0.001, 0.32, 0.22);
    g.connect(this.drums);
    const oscs = [];
    for (const [r, a] of [[1, 1], [2.02, 0.5], [2.98, 0.25]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * r;
      const og = c.createGain(); og.gain.value = a;
      o.connect(og).connect(g); o.start(t); safeStop(o, t + 0.28);
      oscs.push(o); this._done(o, [o, og]);
    }
    const n = this._noise(t, 0.02);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = c.createGain(); this._env(ng, t, 0.001, 0.12, 0.012);
    n.connect(hp).connect(ng).connect(this.drums);
    this._done(n, [n, hp, ng]);
    void oscs;
  }

  _pop(t) {
    const c = this.ctx;
    const n = this._noise(t, 0.01);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = c.createGain(); this._env(g, t, 0.0005, 0.05 + Math.random() * 0.08, 0.004);
    n.connect(hp).connect(g).connect(this.bed);
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

  // sub bass: a sine with a little triangle for definition, punchy
  _sub(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.15;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.85, t + 0.008); g.gain.setTargetAtTime(0, t + len * 0.7, 0.05);
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.bassBus);
    o.start(t); o2.start(t); safeStop(o, t + len + 0.25); safeStop(o2, t + len + 0.25);
    this._done(o, [o, g]); this._done(o2, [o2, g2]);
  }

  // round bass: soft triangle through a low-pass, like a muted electric bass
  _round(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.75, t + 0.015); g.gain.setTargetAtTime(0, t + len * 0.75, 0.08);
    o.connect(lp).connect(g).connect(this.bassBus);
    o.start(t); safeStop(o, t + len + 0.4);
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

  // tanpura drone: each string plucked in turn and left to ring, with the buzzing 'jawari' brightness
  _drone(t, freqs, len) {
    const c = this.ctx;
    const strings = [freqs[1] || freqs[0], freqs[0] * 2, freqs[0] * 2, freqs[0]];
    strings.forEach((f, k) => {
      const tt = t + k * (len / 4);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (k - 1.5) * 3;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(f * 6, tt); bp.frequency.exponentialRampToValueAtTime(f * 2.5, tt + len * 0.9);
      const g = c.createGain();
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(0.32, tt + 0.03); g.gain.setTargetAtTime(0, tt + 0.05, len * 0.45);
      o.connect(bp).connect(g).connect(this.padFilter);
      o.start(tt); safeStop(o, tt + len * 1.3);
      this._done(o, [o, bp, g]);
    });
  }

  // electric piano: sine fundamental + a bell partial, gentle tremolo
  _rhodes(t, f, len, amt = 0.6) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32 * amt, t + 0.01); g.gain.setTargetAtTime(0, t + 0.02, Math.max(0.2, len * 0.45));
    const trem = c.createGain(); trem.gain.value = 1;
    const lfo = c.createOscillator(); lfo.frequency.value = 4.6;
    const ld = c.createGain(); ld.gain.value = 0.18; lfo.connect(ld).connect(trem.gain);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const b = c.createOscillator(); b.type = 'sine'; b.frequency.value = f * 4.01;
    const bg = c.createGain(); bg.gain.setValueAtTime(0.25, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); b.connect(bg).connect(g); g.connect(trem).connect(this.padFilter);
    const end = t + len + 1.2;
    o.start(t); b.start(t); lfo.start(t);
    safeStop(o, end); safeStop(b, end); safeStop(lfo, end);
    this._done(o, [o, g, trem]); this._done(b, [b, bg]); this._done(lfo, [lfo, ld]);
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

  // plucked string (veena / guitar-like): bright attack, the tone darkening as it decays, a little slide up into the note
  _pluck(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.detune.setValueAtTime(-60, t); o.detune.linearRampToValueAtTime(0, t + 0.06);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f; o2.detune.value = 5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(f * 9, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + Math.min(0.9, len + 0.3));
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.setTargetAtTime(0, t + 0.01, Math.max(0.12, Math.min(0.5, len * 0.5)));
    const g2 = c.createGain(); g2.gain.value = 0.5;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(this.leadBus);
    const end = t + len + 1;
    o.start(t); o2.start(t); safeStop(o, end); safeStop(o2, end);
    this._done(o, [o, lp, g]); this._done(o2, [o2, g2]);
  }

  // reed (nadaswaram-like): nasal, bright, scooped into each note, wide vibrato on long notes
  _reed(t, f, len) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f; o2.detune.value = -6;
    o.detune.setValueAtTime(-120, t); o.detune.exponentialRampToValueAtTime(-1, t + 0.07);
    o2.detune.setValueAtTime(-126, t); o2.detune.linearRampToValueAtTime(-6, t + 0.07);
    const vib = c.createOscillator(); vib.frequency.value = 5.8;
    const vd = c.createGain(); vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(f * 0.012, t + Math.max(0.15, len));
    vib.connect(vd); vd.connect(o.frequency); vd.connect(o2.frequency);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.1;
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 2800; pk.gain.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.03); g.gain.setTargetAtTime(0.38, t + 0.06, 0.1); g.gain.setTargetAtTime(0, t + len * 0.92, 0.04);
    const g2 = c.createGain(); g2.gain.value = 0.4;
    o.connect(bp); o2.connect(g2).connect(bp); bp.connect(pk).connect(g).connect(this.leadBus);
    const end = t + len + 0.3;
    o.start(t); o2.start(t); vib.start(t);
    safeStop(o, end); safeStop(o2, end); safeStop(vib, end);
    this._done(o, [o, bp, pk, g, vd]); this._done(o2, [o2, g2]); this._done(vib, [vib]);
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
    const t = this.ctx.currentTime;
    safeStop(this.padLfo, t);
    if (this._bedStarted) { safeStop(this.hiss, t); safeStop(this.rain, t); }
  }
}
