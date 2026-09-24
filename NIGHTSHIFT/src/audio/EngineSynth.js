// NIGHTSHIFT audio - player engine / drivetrain / tyre synthesis.
// All nodes are created once in the constructor; per-frame work is only AudioParam automation.

import { clamp, num, glide, safeStop, safeDisconnect } from './Util.js';
import { makeDriveCurve } from './Noise.js';

/**
 * Per-car-type character. harm = partial amplitudes of the firing-pulse waveform (index 1 = fundamental).
 */
const PROFILES = {
  muscle: {
    cyl: 8, harm: [0, 1, 0.75, 0.5, 0.22, 0.3, 0.1, 0.12, 0.04, 0.06, 0.03],
    sub: 0.6, h2: 0.14, h15: 0.3, cutBase: 260, cutRpm: 2100, cutThr: 1500, q: 3.2,
    drive: 3.2, amDepth: 0.4, amRate: 0.5, exhaust: 0.45, intake: 0.18, turbo: 0, crackle: 1, gain: 1.0,
    bodyF: 110, bodyGain: 6,
  },
  sports: {
    cyl: 6, harm: [0, 1, 0.6, 0.45, 0.35, 0.25, 0.18, 0.12, 0.1, 0.08, 0.06],
    sub: 0.3, h2: 0.3, h15: 0.12, cutBase: 480, cutRpm: 3400, cutThr: 2200, q: 2.4,
    drive: 2.2, amDepth: 0.16, amRate: 1, exhaust: 0.28, intake: 0.24, turbo: 0.55, crackle: 0.6, gain: 0.9,
    bodyF: 180, bodyGain: 4,
  },
  exotic: {
    cyl: 10, harm: [0, 0.8, 1, 0.7, 0.62, 0.5, 0.45, 0.36, 0.3, 0.25, 0.2, 0.17, 0.14, 0.12],
    sub: 0.1, h2: 0.55, h15: 0.06, cutBase: 800, cutRpm: 6200, cutThr: 3200, q: 4.2,
    drive: 2.6, amDepth: 0.08, amRate: 1, exhaust: 0.22, intake: 0.3, turbo: 0, crackle: 0.8, gain: 0.85,
    bodyF: 320, bodyGain: 5,
  },
  tuner: {
    cyl: 4, harm: [0, 1, 0.8, 0.7, 0.2, 0.55, 0.15, 0.42, 0.1, 0.3, 0.08, 0.2],
    sub: 0.14, h2: 0.34, h15: 0.36, cutBase: 600, cutRpm: 4200, cutThr: 2600, q: 5,
    drive: 4.2, amDepth: 0.14, amRate: 1, exhaust: 0.35, intake: 0.42, turbo: 1, crackle: 0.55, gain: 0.85,
    bodyF: 240, bodyGain: 3,
  },
};


// Physical engine layouts for the AudioWorklet model (engine-worklet.js): firing angles over the 720 deg
// cycle, which exhaust bank each firing feeds, per-cylinder header delay (ms; unequal headers = rumble),
// exhaust length per bank (m), pipe feedback/damping and pulse character.
const even = (n) => Array.from({ length: n }, (_, i) => (720 / n) * i);
const alt = (n) => Array.from({ length: n }, (_, i) => i & 1);
export const LAYOUTS = {
  i4: { fire: even(4), hdr: [0, 0.12, 0.05, 0.18], pipe: [2.6, 2.6], open: 0.55, sharp: 5, turb: 0.35, intake: 0.35, pops: 0.5 },
  boxer4: { fire: even(4), bank: [0, 0, 1, 1], hdr: [0, 1.9, 0.35, 2.3], pipe: [2.4, 2.5], open: 0.6, sharp: 4.2, turb: 0.4, jitter: 0.16, intake: 0.3, pops: 0.7 },
  i6: { fire: even(6), hdr: [0, 0.08, 0.04, 0.1, 0.02, 0.06], pipe: [3.0, 3.0], open: 0.5, sharp: 5.5, turb: 0.3, intake: 0.35, pops: 0.5 },
  flat6: { fire: even(6), bank: [0, 1, 0, 1, 0, 1], hdr: [0, 0.2, 0.1, 0.3, 0.05, 0.25], pipe: [2.2, 2.35], open: 0.5, sharp: 6, turb: 0.35, intake: 0.4, valve: 0.035, pops: 0.6 },
  v6: { fire: even(6), bank: alt(6), hdr: [0, 0.15, 0.05, 0.2, 0.1, 0.25], pipe: [2.7, 2.8], open: 0.52, sharp: 5.2, turb: 0.3, intake: 0.35, pops: 0.5 },
  v8cross: { fire: even(8), bank: [0, 1, 0, 1, 1, 0, 1, 0], hdr: [0, 0.3, 0.1, 0.4, 0.2, 0.05, 0.35, 0.15], pipe: [3.1, 3.2], open: 0.58, sharp: 4, turb: 0.4, jitter: 0.14, intake: 0.25, pops: 1 },
  v8flat: { fire: even(8), bank: alt(8), hdr: [0, 0.1, 0.05, 0.12, 0.02, 0.08, 0.04, 0.1], pipe: [2.3, 2.3], open: 0.48, sharp: 6.5, turb: 0.35, intake: 0.4, pops: 0.9 },
  v10: { fire: even(10), bank: alt(10), hdr: [0, 0.1, 0.05, 0.15, 0.02, 0.12, 0.07, 0.14, 0.03, 0.09], pipe: [2.4, 2.45], open: 0.46, sharp: 6.5, turb: 0.3, intake: 0.45, valve: 0.03, pops: 1 },
  v12: { fire: even(12), bank: alt(12), hdr: Array(12).fill(0).map((_, i) => (i % 5) * 0.04), pipe: [2.5, 2.5], open: 0.44, sharp: 7, turb: 0.28, intake: 0.5, valve: 0.03, pops: 0.9 },
  rotary: { fire: even(4), hdr: [0, 0.05, 0, 0.05], pipe: [2.0, 2.0], fb: 0.45, open: 0.8, sharp: 3, turb: 0.65, jitter: 0.08, intake: 0.2, rotary: true, pops: 1.2 },
};
const TYPE_LAYOUT = { muscle: 'v8cross', sports: 'v6', exotic: 'v12', tuner: 'i4' };

// Real cars: an engine layout per car on top of one of the four base characters. Firing frequency is
// rpm/60 * cyl/2, so a two-rotor rotary (fires twice per turn) uses cyl 4; boxers and cross-plane V8s get
// their uneven burble from a slow, deep amplitude wobble.
const CAR_SOUNDS = {
  bmw_m3_e30:            ['tuner',  { layout: 'i4', cyl: 4, turbo: 0, intake: 0.55, cutRpm: 5200, crackle: 0.7, amDepth: 0.1 }],          // S14 I4, NA
  subaru_wrx_sti_gc8:    ['tuner',  { layout: 'boxer4', cyl: 4, turbo: 1, amDepth: 0.42, amRate: 0.5, sub: 0.3, bodyF: 150, h15: 0.5 }],   // EJ20 boxer, turbo
  mazda_rx7_fd:          ['tuner',  { layout: 'rotary', cyl: 4, harm: [0, 1, 0.9, 0.85, 0.7, 0.62, 0.5, 0.45, 0.36, 0.3, 0.24], turbo: 0.85, crackle: 1, h15: 0.1, amDepth: 0.05, cutRpm: 6200, q: 3 }], // 13B-REW rotary
  porsche_930_turbo:     ['sports', { layout: 'flat6', cyl: 6, turbo: 1, amDepth: 0.3, amRate: 0.5, sub: 0.35, bodyF: 150, intake: 0.15 }],  // flat-6, single turbo
  nissan_skyline_r34:    ['sports', { layout: 'i6', cyl: 6, turbo: 0.95, intake: 0.4, cutRpm: 4200, crackle: 0.5 }],                      // RB26 I6, twin turbo
  toyota_supra_mk4:      ['sports', { layout: 'i6', cyl: 6, turbo: 1, sub: 0.35, cutRpm: 3800, crackle: 0.55 }],                          // 2JZ I6, twin turbo
  honda_nsx_na1:         ['sports', { layout: 'v6', cyl: 6, turbo: 0, intake: 0.5, cutRpm: 5200, h2: 0.4, q: 3.2 }],                      // C30A V6, VTEC
  bmw_m4_f82:            ['sports', { layout: 'i6', cyl: 6, turbo: 0.7, crackle: 0.9, drive: 2.8, exhaust: 0.34 }],                        // S55 I6, twin turbo
  nissan_gtr_r35:        ['sports', { layout: 'v6', cyl: 6, turbo: 0.9, sub: 0.4, bodyF: 140, crackle: 0.6, cutRpm: 3000 }],               // VR38 V6, twin turbo
  chevrolet_corvette_c8: ['muscle', { layout: 'v8cross', cyl: 8, crackle: 1, cutRpm: 2600 }],                                                    // LT2 cross-plane V8
  porsche_911_gt3:       ['exotic', { layout: 'flat6', cyl: 6, harm: [0, 1, 0.9, 0.62, 0.5, 0.42, 0.34, 0.26, 0.2, 0.15], sub: 0.2, h2: 0.6, cutRpm: 7000, amDepth: 0.12, amRate: 0.5, bodyF: 260 }], // 4.0 flat-6, 9000 rpm
  audi_r8_v10:           ['exotic', { layout: 'v10', cyl: 10, crackle: 1, intake: 0.36 }],                                                  // 5.2 V10, NA
  ferrari_f40:           ['exotic', { layout: 'v8flat', cyl: 8, turbo: 1, crackle: 1, h2: 0.4, sub: 0.2, cutRpm: 5000, drive: 3.2 }],          // F120 flat-plane V8, twin turbo
  mclaren_senna:         ['exotic', { layout: 'v8flat', cyl: 8, turbo: 0.8, crackle: 0.9, h2: 0.45, drive: 3 }],                               // M840TR V8, twin turbo
  lamborghini_centenario:['exotic', { layout: 'v12', cyl: 12, harm: [0, 0.7, 1, 0.8, 0.7, 0.62, 0.55, 0.5, 0.42, 0.36, 0.3, 0.26, 0.22, 0.2, 0.16], h2: 0.65, cutRpm: 7200, crackle: 1, gain: 0.9 }], // 6.5 V12, NA
  lamborghini_huracan_tt:['exotic', { layout: 'v10', cyl: 10, turbo: 0.8, crackle: 1, drive: 3.2, sub: 0.18 }],                             // V10, aftermarket twin turbo
};
for (const [id, [base, o]] of Object.entries(CAR_SOUNDS)) PROFILES[id] = { ...PROFILES[base], ...o, base };

/** Engine sound key for a car: its own profile when there is one, else its type's. */
export const engineSoundFor = (carId, carType) => (PROFILES[carId] ? carId : carType);

export class EngineSynth {
  /**
   * @param ctx AudioContext
   * @param buffers {white, pink, brown}
   * @param engineOut node: engine bus
   * @param sfxOut node: car sfx bus (tyres, road, nitro)
   * @param host object with _internalEvent(name, opts)
   */
  constructor(ctx, buffers, engineOut, sfxOut, host) {
    this.ctx = ctx;
    this.host = host;
    this.waves = {};
    this.type = null;
    this.p = PROFILES.sports;
    this.state = {
      rpm: 900, idle: 850, redline: 7000, throttle: 0, load: 0, speed: 0, gear: 1,
      nitro: false, skid: 0, onGround: true, damage: 0,
    };
    this.boost = 0;         // smoothed turbo boost 0..1
    this.prevThrottle = 0;
    this.crackleTimer = 0;
    this.crackleAcc = 0;
    this.misfireAcc = 0;
    this.lastSet = 0;
    this.started = false;

    const c = ctx;
    const mk = (type, f) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const g = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
    const flt = (type, f, q = 0.7) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    const src = (buf) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; return s; };

    // ---- shared noise sources (fan-out to all noise layers) ----
    this.white = src(buffers.white);
    this.pink = src(buffers.pink);
    this.brown = src(buffers.brown);

    // ---- harmonic core ----
    this.oMain = mk('sawtooth', 60);
    this.oSub = mk('triangle', 30);
    this.oH2 = mk('sawtooth', 120); this.oH2.detune.value = 7;
    this.oH15 = mk('square', 90); this.oH15.detune.value = -5;
    this.gMain = g(0.5); this.gSub = g(0.3); this.gH2 = g(0.2); this.gH15 = g(0.1);
    this.mix = g(1);
    this.oMain.connect(this.gMain).connect(this.mix);
    this.oSub.connect(this.gSub).connect(this.mix);
    this.oH2.connect(this.gH2).connect(this.mix);
    this.oH15.connect(this.gH15).connect(this.mix);

    // exhaust roughness (brown noise, low-passed near firing freq) goes through the drive too
    this.exhLP = flt('lowpass', 200, 1.2);
    this.exhGain = g(0.2);
    this.brown.connect(this.exhLP).connect(this.exhGain).connect(this.mix);

    this.shaper = c.createWaveShaper();
    this.shaper.curve = makeDriveCurve(3);
    this.preDrive = g(0.6);
    this.mix.connect(this.preDrive).connect(this.shaper);

    this.lp = flt('lowpass', 1200, 3);
    this.lp2 = flt('lowpass', 4000, 0.5);
    this.body = flt('peaking', 150, 1.2); this.body.gain.value = 5;
    this.shaper.connect(this.lp).connect(this.lp2).connect(this.body);

    // AM "firing pulse" lump: amGain.gain = base + lfoA*depthA + lfoB*depthB
    this.amGain = g(0.7);
    this.lfoA = mk('sine', 7);
    this.lfoB = mk('triangle', 3.1);
    this.lfoADepth = g(0.2);
    this.lfoBDepth = g(0.08);
    this.lfoA.connect(this.lfoADepth).connect(this.amGain.gain);
    this.lfoB.connect(this.lfoBDepth).connect(this.amGain.gain);
    this.body.connect(this.amGain);

    // overrun burble (off-throttle), also lumpy via amGain
    this.ovBP = flt('bandpass', 150, 3.5);
    this.ovGain = g(0);
    this.brown.connect(this.ovBP).connect(this.ovGain).connect(this.amGain);

    this.misfire = g(1);
    this.shift = g(1);
    this.out = g(0);
    this.amGain.connect(this.misfire).connect(this.shift).connect(this.out);

    // intake / induction noise (pink bandpass tracking rpm)
    this.inBP = flt('bandpass', 800, 1.4);
    this.inGain = g(0);
    this.pink.connect(this.inBP).connect(this.inGain).connect(this.shift);

    this.out.connect(engineOut);

    // ---- turbo whistle + spool hiss ----
    this.oTurbo = mk('sine', 2000);
    this.oTurbo2 = mk('sine', 3000);
    this.turboBP = flt('bandpass', 3000, 2);
    this.spoolBP = flt('bandpass', 5000, 6);
    this.turboGain = g(0);
    this.oTurbo.connect(this.turboBP);
    this.oTurbo2.connect(this.turboBP);
    this.white.connect(this.spoolBP).connect(this.turboBP);
    this.turboBP.connect(this.turboGain).connect(engineOut);

    // ---- damage rattle ----
    this.rattleBP = flt('bandpass', 2600, 5);
    this.rattleGain = g(0);
    this.rattleLfo = mk('square', 16);
    this.rattleDepth = g(0);
    this.rattleLfo.connect(this.rattleDepth).connect(this.rattleGain.gain);
    this.white.connect(this.rattleBP).connect(this.rattleGain).connect(engineOut);

    // ---- tyres / road / wind-on-car (sfx bus) ----
    this.skidBP = flt('bandpass', 1300, 5);
    this.skidJitter = mk('sine', 7.3);
    this.skidJitterDepth = g(180);
    this.skidJitter.connect(this.skidJitterDepth).connect(this.skidBP.frequency);
    this.skidTone = mk('triangle', 920);
    this.skidVib = mk('sine', 11);
    this.skidVibDepth = g(35);
    this.skidVib.connect(this.skidVibDepth).connect(this.skidTone.frequency);
    this.skidToneGain = g(0.08);
    this.skidGain = g(0);
    this.white.connect(this.skidBP).connect(this.skidGain);
    this.skidTone.connect(this.skidToneGain).connect(this.skidGain);
    this.skidGain.connect(sfxOut);

    this.roadLP = flt('lowpass', 150, 0.8);
    this.roadGain = g(0);
    this.brown.connect(this.roadLP).connect(this.roadGain).connect(sfxOut);
    this.hissBP = flt('bandpass', 900, 0.8);
    this.hissGain = g(0);
    this.pink.connect(this.hissBP).connect(this.hissGain).connect(sfxOut);

    // ---- nitro: roaring hiss ----
    this.nitroBP = flt('bandpass', 1800, 0.6);
    this.nitroLP = flt('lowpass', 320, 0.8);
    this.nitroGain = g(0);
    this.nitroRoar = g(0);
    this.white.connect(this.nitroBP).connect(this.nitroGain).connect(sfxOut);
    this.brown.connect(this.nitroLP).connect(this.nitroRoar).connect(engineOut);

    this.oscs = [this.oMain, this.oSub, this.oH2, this.oH15, this.lfoA, this.lfoB, this.oTurbo, this.oTurbo2,
      this.rattleLfo, this.skidJitter, this.skidTone, this.skidVib];
    this.srcs = [this.white, this.pink, this.brown];

    this.setCarType('sports');
  }

  /** Swap the whistle-like skid tone for a rendered tyre-screech loop (from the impact bank). */
  attachScreech(buf) {
    if (!buf || this.screech) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    this.screechGain = c.createGain(); this.screechGain.gain.value = 0;
    src.connect(this.screechGain).connect(this.skidGain);
    src.start();
    this.screech = src;
    this.skidToneGain.gain.value = 0;   // retire the oscillator whine
    this.skidBP.disconnect(); const hiss = c.createGain(); hiss.gain.value = 0.3; this.skidBP.connect(hiss).connect(this.skidGain); // keep a little broadband hiss
  }

  /** Load the physical engine model; until (or unless) it loads, the oscillator engine plays. */
  async initWorklet() {
    try {
      if (!this.ctx.audioWorklet) return false;
      await this.ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      const wk = new AudioWorkletNode(this.ctx, 'nightshift-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.wk = wk;
      this.mix.disconnect();              // retire the oscillator core
      wk.connect(this.preDrive);
      this.useWorklet = true;
      const type = this.type; this.type = null; this.setCarType(type || 'sports');
      console.info('[Audio] physical engine model active');
      return true;
    } catch (e) { console.warn('[Audio] engine worklet unavailable, using oscillator engine', e); return false; }
  }

  start() {
    if (this.started) return;
    this.started = true;
    const t = this.ctx.currentTime;
    for (const o of this.oscs) o.start(t);
    this.white.start(t, Math.random() * 1.5);
    this.pink.start(t, Math.random() * 2);
    this.brown.start(t, Math.random() * 2);
  }

  _wave(type) {
    if (!this.waves[type]) {
      const h = PROFILES[type].harm;
      const real = new Float32Array(h.length);
      const imag = new Float32Array(h);
      this.waves[type] = this.ctx.createPeriodicWave(real, imag);
    }
    return this.waves[type];
  }

  setCarType(type) {
    if (!PROFILES[type]) type = 'sports';
    if (type === this.type) return;
    this.type = type;
    const p = (this.p = PROFILES[type]);
    const t = this.ctx.currentTime;
    const base = p.base || type;
    this.oMain.setPeriodicWave(this._wave(type));
    this.oSub.type = base === 'muscle' ? 'triangle' : 'sine';
    this.oH15.type = base === 'tuner' ? 'square' : 'sawtooth';
    this.oH2.type = base === 'exotic' ? 'sawtooth' : 'square';
    glide(this.gSub.gain, p.sub * 0.6, t, 0.05);
    glide(this.gH2.gain, p.h2 * 0.5, t, 0.05);
    glide(this.gH15.gain, p.h15 * 0.4, t, 0.05);
    glide(this.gMain.gain, 0.55, t, 0.05);
    glide(this.body.frequency, p.bodyF, t, 0.05);
    glide(this.body.gain, p.bodyGain, t, 0.05);
    glide(this.lp.Q, p.q, t, 0.05);
    this.shaper.curve = makeDriveCurve(this.useWorklet ? 1.3 + p.drive * 0.3 : p.drive);
    if (this.wk) {
      const lay = LAYOUTS[p.layout || TYPE_LAYOUT[base]] || LAYOUTS.i6;
      this.wk.port.postMessage({ type: 'config', config: lay });
      glide(this.lp.Q, 0.9, t, 0.05); // the pipes resonate on their own; a soft muffler filter is enough
      glide(this.gMain.gain, 0, t, 0.05);
    }
  }

  /** Brief torque-cut dip on upshift. */
  shiftDip(up = true) {
    const t = this.ctx.currentTime;
    const prm = this.shift.gain;
    prm.cancelScheduledValues(t);
    prm.setValueAtTime(prm.value, t);
    prm.linearRampToValueAtTime(up ? 0.35 : 0.6, t + 0.03);
    prm.linearRampToValueAtTime(1, t + (up ? 0.16 : 0.1));
  }

  set(s) {
    const st = this.state;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (typeof s.carType === 'string') this.setCarType(s.carType);
    const p = this.p;

    st.idle = clamp(num(s.idleRpm, st.idle), 300, 3000);
    st.redline = clamp(num(s.redline, st.redline), st.idle + 1000, 20000);
    st.rpm = clamp(num(s.rpm, st.rpm), 0, st.redline * 1.1);
    st.throttle = clamp(num(s.throttle, st.throttle), 0, 1);
    st.load = clamp(num(s.load, st.throttle), 0, 1);
    st.speed = Math.abs(num(s.speed, st.speed));
    st.gear = num(s.gear, st.gear);
    st.nitro = !!s.nitro;
    st.skid = clamp(num(s.skid, 0), 0, 1);
    st.onGround = s.onGround !== false;
    st.damage = clamp(num(s.damage, st.damage), 0, 1);

    const rpm = Math.max(st.rpm, 200);
    const rpmN = clamp((rpm - st.idle) / (st.redline - st.idle), 0, 1);
    const thr = st.throttle;
    const off = 1 - clamp(thr * 4, 0, 1); // 1 when fully off throttle
    const f = (rpm / 60) * (p.cyl / 2); // firing frequency

    // --- pitch ---
    const ftc = 0.025;
    glide(this.oMain.frequency, f, t, ftc);
    glide(this.oSub.frequency, f * 0.5, t, ftc);
    glide(this.oH2.frequency, f * 2, t, ftc);
    glide(this.oH15.frequency, f * 1.5, t, ftc);
    glide(this.exhLP.frequency, clamp(f * 1.6, 60, 2000), t, ftc);
    glide(this.ovBP.frequency, clamp(f * 0.75, 40, 1200), t, ftc);
    glide(this.inBP.frequency, clamp(f * 3.2, 200, 6000), t, ftc);

    // --- timbre: cutoff rises with rpm & throttle; overrun darker ---
    const cut = p.cutBase + p.cutRpm * rpmN + p.cutThr * thr * (0.4 + 0.6 * st.load) - off * rpmN * p.cutRpm * 0.35;
    glide(this.lp.frequency, clamp(cut, 120, 12000), t, 0.05);
    glide(this.lp2.frequency, clamp(cut * 2.5, 800, 16000), t, 0.05);
    glide(this.preDrive.gain, this.wk ? 0.7 + 0.3 * thr : 0.35 + 0.5 * thr + 0.25 * st.load, t, 0.05);
    glide(this.exhGain.gain, p.exhaust * (0.35 + 0.65 * thr) * (0.7 + 0.6 * (1 - rpmN)), t, 0.05);

    if (this.wk) {
      const P = this.wk.parameters;
      P.get('rpm').setTargetAtTime(rpm, t, 0.02);
      P.get('throttle').setTargetAtTime(thr, t, 0.03);
      glide(this.lp.frequency, clamp(cut * 1.05 + 350, 300, 9000), t, 0.05); // muffler opens with rpm/throttle
    }
    // --- AM firing lump: strong at idle / low rpm, smooth when revving (the physical model has its own) ---
    const lump = this.wk ? 0 : p.amDepth * (1 - rpmN * 0.85) * (1 - thr * 0.5);
    glide(this.lfoA.frequency, (rpm / 120) * p.amRate, t, 0.05);
    glide(this.lfoB.frequency, (rpm / 60) * 0.37, t, 0.05);
    glide(this.lfoADepth.gain, lump, t, 0.05);
    glide(this.lfoBDepth.gain, lump * 0.35, t, 0.05);
    glide(this.amGain.gain, 1 - lump * 1.2, t, 0.05);

    // --- overrun layer ---
    glide(this.ovGain.gain, off * rpmN * (this.wk ? 0.2 : 0.6) * p.crackle, t, 0.08);

    // --- volume law: throttle-dependent ---
    const vol = this.wk
      ? (0.8 + 0.2 * Math.pow(thr, 0.7)) * (0.85 + 0.15 * rpmN) * p.gain * (1.9 - 0.9 * rpmN) // model already scales with rpm/load; keep idle ~15 dB under a full pull
      : (off > 0.5 ? 0.3 + 0.1 * rpmN : 0.3 + 0.7 * Math.pow(thr, 0.8)) * (0.55 + 0.45 * rpmN) * p.gain;
    glide(this.out.gain, vol * 0.55, t, 0.05);
    glide(this.inGain.gain, p.intake * thr * (0.2 + rpmN) * 0.35, t, 0.05);

    // --- turbo ---
    const target = p.turbo > 0 ? clamp(rpmN * 1.2 - 0.15, 0, 1) * thr * st.load : 0;
    // boost builds slowly (lag), drops fast
    const dtSet = this.lastSet ? clamp(t - this.lastSet, 0, 0.1) : 0.016;
    this.lastSet = t;
    const rate = target > this.boost ? 1.6 : 6;
    this.boost += (target - this.boost) * clamp(rate * dtSet, 0, 1);
    glide(this.oTurbo.frequency, 1800 + this.boost * 6200, t, 0.05);
    glide(this.oTurbo2.frequency, (1800 + this.boost * 6200) * 1.51, t, 0.05);
    glide(this.turboBP.frequency, 2000 + this.boost * 6000, t, 0.05);
    glide(this.turboGain.gain, p.turbo * this.boost * this.boost * 0.05, t, 0.05);

    // blow-off when throttle released from high boost
    if (p.turbo > 0 && this.prevThrottle > 0.55 && thr < 0.2 && this.boost > 0.45) {
      this.host._internalEvent('blowOff', { intensity: this.boost * p.turbo });
      this.boost *= 0.3;
    }
    // lift at high rpm -> arm the crackle window
    if (this.prevThrottle > 0.5 && thr < 0.15 && rpmN > 0.5) {
      this.crackleTimer = 0.6 + rpmN * 1.0;
    }
    if (thr > 0.3) this.crackleTimer = 0;
    this.prevThrottle = thr;

    // --- damage rattle ---
    glide(this.rattleLfo.frequency, clamp(f / 4, 6, 30), t, 0.1);
    glide(this.rattleDepth.gain, st.damage * 0.06 * (0.4 + thr), t, 0.1);
    glide(this.rattleGain.gain, st.damage * 0.06 * (0.4 + thr), t, 0.1);

    // --- tyres, road, nitro ---
    const ground = st.onGround ? 1 : 0;
    const spN = clamp(st.speed / 60, 0, 1.5);
    glide(this.skidGain.gain, Math.pow(st.skid, 1.4) * 0.35 * ground, t, 0.04);
    glide(this.skidBP.frequency, 1100 + st.skid * 500 + spN * 200, t, 0.05);
    glide(this.skidTone.frequency, 850 + st.skid * 180, t, 0.05);
    if (this.screech) {
      glide(this.screechGain.gain, 0.9 + st.skid * 0.4, t, 0.05);
      glide(this.screech.playbackRate, 0.88 + st.skid * 0.14 + Math.min(spN, 1) * 0.08, t, 0.08); // harder slides squeal higher
    }
    glide(this.roadGain.gain, clamp(spN, 0, 1) * 0.35 * ground, t, 0.08);
    glide(this.roadLP.frequency, 90 + spN * 180, t, 0.08);
    glide(this.hissGain.gain, spN * spN * 0.06 * ground, t, 0.08);
    glide(this.hissBP.frequency, 600 + spN * 700, t, 0.08);
    glide(this.nitroGain.gain, st.nitro ? 0.18 : 0, t, st.nitro ? 0.06 : 0.2);
    glide(this.nitroRoar.gain, st.nitro ? 0.35 * (0.5 + thr * 0.5) : 0, t, st.nitro ? 0.06 : 0.25);
  }

  update(dt) {
    if (!this.started) return;
    const st = this.state;
    const p = this.p;
    // overrun crackles
    if (this.crackleTimer > 0) {
      this.crackleTimer -= dt;
      const rate = 7 * p.crackle * clamp(this.crackleTimer, 0, 1);
      this.crackleAcc += rate * dt;
      if (this.crackleAcc > 1 || Math.random() < rate * dt * 0.5) {
        this.crackleAcc = 0;
        this.host._internalEvent('crackle', { intensity: 0.4 + Math.random() * 0.6 });
      }
    }
    // misfires with damage
    if (st.damage > 0.25) {
      this.misfireAcc += dt * st.damage * 4 * (0.3 + st.throttle);
      if (this.misfireAcc > 1 && Math.random() < 0.5) {
        this.misfireAcc = 0;
        const t = this.ctx.currentTime;
        const g = this.misfire.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(1, t);
        g.linearRampToValueAtTime(0.15, t + 0.01);
        g.linearRampToValueAtTime(1, t + 0.05 + Math.random() * 0.06);
        if (Math.random() < st.damage * 0.3) this.host._internalEvent('crackle', { intensity: 0.3 });
      }
    }
  }

  /** Quick fade (used when paused / disposing). */
  dispose() {
    const t = this.ctx.currentTime;
    for (const o of this.oscs) safeStop(o, t + 0.05);
    for (const s of this.srcs) safeStop(s, t + 0.05);
    safeDisconnect(this.out);
    safeDisconnect(this.turboGain);
    safeDisconnect(this.skidGain);
  }
}
