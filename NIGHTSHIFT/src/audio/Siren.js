// NIGHTSHIFT audio - persistent spatial voices: police sirens and civilian traffic.

import { clamp, glide, createPanner, safeStop, safeDisconnect } from './Util.js';

const WAIL_LOW = 650;
const WAIL_HIGH = 1500;

export class SirenVoice {
  constructor(ctx, out, reverbSend) {
    this.ctx = ctx;
    this.released = false;
    this.mode = 'wail';
    this.rateJitter = 0.92 + Math.random() * 0.16; // de-sync multiple cars
    const center = (WAIL_LOW + WAIL_HIGH) / 2;
    const depth = (WAIL_HIGH - WAIL_LOW) / 2;

    this.osc = ctx.createOscillator(); this.osc.type = 'square'; this.osc.frequency.value = center;
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'sawtooth'; this.osc2.frequency.value = center; this.osc2.detune.value = 9;
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine'; this.lfo.frequency.value = 0.4 * this.rateJitter;
    this.lfoDepth = ctx.createGain(); this.lfoDepth.gain.value = depth;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.osc.frequency);
    this.lfoDepth.connect(this.osc2.frequency);

    this.mixA = ctx.createGain(); this.mixA.gain.value = 0.22;
    this.mixB = ctx.createGain(); this.mixB.gain.value = 0.12;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 3400; this.tone.Q.value = 0.9;
    this.horn = ctx.createBiquadFilter(); this.horn.type = 'peaking'; this.horn.frequency.value = 1200; this.horn.Q.value = 1.5; this.horn.gain.value = 5;
    this.air = ctx.createBiquadFilter(); this.air.type = 'lowpass'; this.air.frequency.value = 8000;
    this.pan = createPanner(ctx);
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.send = ctx.createGain(); this.send.gain.value = 0.25;

    this.osc.connect(this.mixA).connect(this.tone);
    this.osc2.connect(this.mixB).connect(this.tone);
    this.tone.connect(this.horn).connect(this.air).connect(this.pan).connect(this.gain).connect(out);
    if (reverbSend) this.gain.connect(this.send).connect(reverbSend);

    const t = ctx.currentTime;
    this.osc.start(t); this.osc2.start(t);
    // start the LFO at a random phase-ish offset by delaying it a little
    this.lfo.start(t + Math.random() * 0.3);
    this.nodes = [this.osc, this.osc2, this.lfo, this.lfoDepth, this.mixA, this.mixB, this.tone, this.horn, this.air, this.pan, this.gain, this.send];
  }

  /** sp = spatial() result, intensity 0..1, dopplerRatio (1 = none) */
  update(sp, intensity, dopplerRatio, t) {
    if (this.released) return;
    const yelp = intensity > 0.7;
    const mode = yelp ? 'yelp' : 'wail';
    if (mode !== this.mode) {
      this.mode = mode;
      this.lfo.type = yelp ? 'triangle' : 'sine';
      glide(this.lfo.frequency, (yelp ? 3.6 : 0.4) * this.rateJitter, t, 0.05);
      glide(this.lfoDepth.gain, yelp ? 380 : (WAIL_HIGH - WAIL_LOW) / 2, t, 0.05);
      const center = yelp ? 1100 : (WAIL_LOW + WAIL_HIGH) / 2;
      glide(this.osc.frequency, center, t, 0.05);
      glide(this.osc2.frequency, center, t, 0.05);
    }
    const cents = 1200 * Math.log2(clamp(dopplerRatio || 1, 0.75, 1.3));
    glide(this.osc.detune, cents, t, 0.08);
    glide(this.osc2.detune, cents + 9, t, 0.08);
    glide(this.pan.pan, sp.pan, t, 0.05);
    glide(this.air.frequency, sp.air, t, 0.08);
    const lvl = sp.gain * (0.35 + 0.65 * clamp(intensity, 0, 1));
    glide(this.gain.gain, clamp(lvl, 0, 1.2), t, 0.06);
    // far sirens bounce off buildings more
    glide(this.send.gain, 0.15 + clamp(sp.dist / 150, 0, 0.5), t, 0.2);
  }

  release() {
    if (this.released) return;
    this.released = true;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.12);
    for (const o of [this.osc, this.osc2, this.lfo]) safeStop(o, t + 0.8);
    this.osc.onended = () => { for (const n of this.nodes) safeDisconnect(n); };
  }
}

export class TrafficVoice {
  /** noiseSrc: a shared looping pink-noise source node to fan out from */
  constructor(ctx, out, noiseSrc) {
    this.ctx = ctx;
    this.noiseSrc = noiseSrc;
    this.released = false;
    this.prevDist = null;
    this.radialVel = 0;
    this.hum = ctx.createOscillator(); this.hum.type = 'sawtooth'; this.hum.frequency.value = 40;
    this.hum2 = ctx.createOscillator(); this.hum2.type = 'triangle'; this.hum2.frequency.value = 80; this.hum2.detune.value = 11;
    this.humLP = ctx.createBiquadFilter(); this.humLP.type = 'lowpass'; this.humLP.frequency.value = 260; this.humLP.Q.value = 1.5;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0.25;
    this.tireBP = ctx.createBiquadFilter(); this.tireBP.type = 'bandpass'; this.tireBP.frequency.value = 700; this.tireBP.Q.value = 0.9;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    this.whooshHP = ctx.createBiquadFilter(); this.whooshHP.type = 'highpass'; this.whooshHP.frequency.value = 900;
    this.whooshGain = ctx.createGain(); this.whooshGain.gain.value = 0;
    this.air = ctx.createBiquadFilter(); this.air.type = 'lowpass'; this.air.frequency.value = 8000;
    this.pan = createPanner(ctx);
    this.gain = ctx.createGain(); this.gain.gain.value = 0;

    this.hum.connect(this.humLP);
    this.hum2.connect(this.humLP);
    this.humLP.connect(this.humGain).connect(this.air);
    noiseSrc.connect(this.tireBP); this.tireBP.connect(this.tireGain).connect(this.air);
    noiseSrc.connect(this.whooshHP); this.whooshHP.connect(this.whooshGain).connect(this.air);
    this.air.connect(this.pan).connect(this.gain).connect(out);
    const t = ctx.currentTime;
    this.hum.start(t); this.hum2.start(t);
    this.nodes = [this.hum, this.hum2, this.humLP, this.humGain, this.tireBP, this.tireGain, this.whooshHP, this.whooshGain, this.air, this.pan, this.gain];
  }

  update(sp, speed, dt, t) {
    if (this.released) return;
    speed = Math.abs(speed || 0);
    if (this.prevDist != null && dt > 0) {
      const v = (sp.dist - this.prevDist) / dt;
      this.radialVel += (clamp(v, -80, 80) - this.radialVel) * clamp(dt * 6, 0, 1);
    }
    this.prevDist = sp.dist;
    const doppler = 343 / (343 + this.radialVel); // approaching (negative) -> higher
    const cents = 1200 * Math.log2(clamp(doppler, 0.8, 1.25));
    const f = 32 + speed * 1.4;
    glide(this.hum.frequency, f, t, 0.1);
    glide(this.hum2.frequency, f * 2, t, 0.1);
    glide(this.hum.detune, cents, t, 0.08);
    glide(this.hum2.detune, cents + 11, t, 0.08);
    const sN = clamp(speed / 30, 0, 1.4);
    glide(this.tireGain.gain, 0.08 + sN * 0.3, t, 0.1);
    glide(this.tireBP.frequency, 500 + sN * 500 + cents * 0.5, t, 0.1);
    // pass-by whoosh: rises sharply when close & fast
    const close = clamp(1 - sp.dist / 22, 0, 1);
    glide(this.whooshGain.gain, close * close * sN * 0.7, t, 0.05);
    glide(this.pan.pan, sp.pan, t, 0.05);
    glide(this.air.frequency, sp.air, t, 0.08);
    glide(this.gain.gain, clamp(sp.gain * 0.9, 0, 1), t, 0.06);
  }

  release() {
    if (this.released) return;
    this.released = true;
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.1);
    safeStop(this.hum, t + 0.6);
    safeStop(this.hum2, t + 0.6);
    this.hum.onended = () => {
      try { this.noiseSrc.disconnect(this.tireBP); } catch (_) {}
      try { this.noiseSrc.disconnect(this.whooshHP); } catch (_) {}
      for (const n of this.nodes) safeDisconnect(n);
    };
  }
}
