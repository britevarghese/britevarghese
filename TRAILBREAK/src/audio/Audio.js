// Sound: each truck's own kind of engine, rebuilt a firing at a time from real recordings (audio/engine-worklet.js,
// banks from tools/sounds), and synthesised tyre roll on each surface, wheelspin, mud, water, wind, suspension knocks
// and bangs, the winch motor and a quiet forest. Other players' engines play from where their trucks are. Without
// AudioWorklet (or a bank) the engine falls back to recorded loops crossfaded by rpm and throttle.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function noiseBuffer(ctx, seconds = 2, color = 'white') {
  const n = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else if (color === 'pink') {
      b0 = 0.997 * b0 + w * 0.029591; b1 = 0.985 * b1 + w * 0.032534; b2 = 0.95 * b2 + w * 0.048056; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.6;
    } else d[i] = w;
  }
  return b;
}

const glide = (param, v, t, tc = 0.06) => { if (Number.isFinite(v)) param.setTargetAtTime(v, t, tc); };

/** One engine: twelve seamless loops (six rpm points, on and off throttle). */
class EngineVoice {
  constructor(audio, set, out, pitch = 1) {
    const ctx = audio.ctx;
    this.ctx = ctx; this.pitch = pitch;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.gain.connect(out);
    this.f0 = set.f0;
    this.loops = [];
    const t = ctx.currentTime;
    for (const cls of ['on', 'off']) {
      set[cls].forEach((l, i) => {
        const src = ctx.createBufferSource(); src.buffer = l.buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(g).connect(this.gain);
        src.start(t, Math.random() * l.buf.duration);
        this.loops.push({ src, g, cls, i, norm: 0.48 / l.rms });
      });
    }
    this.rpmS = 0; this.thrS = 0;
  }

  drive(rpmN, thr, vol) {
    const t = this.ctx.currentTime, F = this.f0, n = F.length;
    const top = Math.max(F[n - 1], F[0] * 3);
    this.rpmS += (rpmN - this.rpmS) * 0.25;
    this.thrS += (thr - this.thrS) * 0.2;
    const f = Math.max(F[0] * 0.6, F[0] + clamp(this.rpmS, -0.3, 1.15) * (top - F[0])) * this.pitch;
    let k = 0; while (k < n - 2 && f > F[k + 1]) k++;
    const w0 = clamp(Math.log(f / F[k]) / Math.log(F[k + 1] / F[k]), 0, 1);
    const u = clamp((w0 - 0.3) / 0.4, 0, 1), w = u * u * (3 - 2 * u);
    const on = Math.sqrt(this.thrS), off = Math.sqrt(1 - this.thrS);
    const loud = (0.5 + 0.5 * Math.pow(clamp(this.rpmS, 0, 1), 0.8)) * (0.7 + 0.3 * this.thrS);
    for (const L of this.loops) {
      const wl = L.i === k ? Math.cos(w * Math.PI / 2) : L.i === k + 1 ? Math.sin(w * Math.PI / 2) : 0;
      glide(L.g.gain, wl * (L.cls === 'on' ? on : off * 0.85) * L.norm * loud, t, 0.05);
      if (wl > 0 || L.g.gain.value > 1e-4) glide(L.src.playbackRate, clamp(f / F[L.i], 0.5, 2.2), t, 0.04);
    }
    glide(this.gain.gain, vol, t, 0.1);
  }

  stop() {
    const t = this.ctx.currentTime;
    glide(this.gain.gain, 0, t, 0.05);
    for (const L of this.loops) { try { L.src.stop(t + 0.3); } catch { /* stopped */ } }
    setTimeout(() => this.gain.disconnect(), 500);
  }
}

/** An engine bank: the recording's firings (tools/sounds/build_grains.py), ready for the worklet. */
async function fetchBank(name) {
  const base = '/assets/audio/engines/';
  const meta = await (await fetch(base + name + '.grains.json', { cache: 'no-cache' })).json();
  const wav = await (await fetch(`${base}${name}.grains.wav?v=${meta.ver || 0}`)).arrayBuffer();
  const v = new DataView(wav);
  let p = 12, data = null;
  while (p + 8 <= wav.byteLength) {
    const id = String.fromCharCode(v.getUint8(p), v.getUint8(p + 1), v.getUint8(p + 2), v.getUint8(p + 3)), len = v.getUint32(p + 4, true);
    if (id === 'data') {
      const n = len >> 1;
      data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = v.getInt16(p + 8 + i * 2, true) / 32768;
      break;
    }
    p += 8 + len + (len & 1);
  }
  if (!data) throw new Error('bank without audio: ' + name);
  const arr = (b64, T) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };
  return { data, sr: meta.sr, cyl: meta.cyl, idleRpm: meta.idleRpm, pos: arr(meta.pos, Int32Array), r: arr(meta.r, Float32Array),
    g: arr(meta.g, Float32Array), cls: arr(meta.cls, Uint8Array), run: arr(meta.run, Uint16Array) };
}

/** Cylinders of the engine each bank was recorded from (for the starter's compression strokes). */
const BANK_CYL = { v6: 6, i6: 6, d6: 6, v8: 8, v8m: 8, d8: 8, i4: 4, d4: 4, d4t: 4 };

/** One engine from a bank: the worklet node, steered by rpm, load and a loudness. */
class GrainVoice {
  constructor(audio, bank, out, cfg) {
    const ctx = audio.ctx;
    this.ctx = ctx; this.grain = true;
    this.node = new AudioWorkletNode(ctx, 'tb-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.node.port.postMessage({ bank });
    this.node.port.postMessage({ config: cfg });
    this.rpm = this.node.parameters.get('rpm'); this.load = this.node.parameters.get('load'); this.gain = this.node.parameters.get('gain');
    this.node.connect(out);
  }

  /** rpm, the engine's idle and redline, load 0..1 (on throttle .. overrun), vol 0..1. */
  drive(rpm, idle, red, load, vol) {
    const t = this.ctx.currentTime;
    const rn = clamp((rpm - idle) / Math.max(1, red - idle), 0, 1.2);
    // louder with revs and with load (closed throttle at speed: the overrun is quieter than the pull)
    const loud = (0.5 + 0.5 * Math.pow(rn, 0.7)) * (0.62 + 0.38 * load);
    glide(this.rpm, rpm, t, 0.02);
    glide(this.load, clamp(load, 0, 1), t, 0.05);
    glide(this.gain, 4.5 * loud * vol, t, 0.08);
  }

  stop() {
    const t = this.ctx.currentTime;
    glide(this.gain, 0, t, 0.05);
    setTimeout(() => { try { this.node.disconnect(); this.node.port.close(); } catch { /* gone */ } }, 500);
  }
}

/** A looping noise through a filter, with a gain. */
function noiseVoice(ctx, buf, out, type, freq, q = 0.8) {
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f).connect(g).connect(out);
  src.start(ctx.currentTime, Math.random() * buf.duration);
  return { src, f, g };
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.sets = new Map();
    this.banks = new Map();
    this.remote = new Map();
    this.thumpCool = 0;
    this.mutes = new Set();
    // a hidden tab is silent: no engine idling away behind the other tabs (the audio stops altogether until it's back)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  async start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    // the grain engine (falls back to loops where AudioWorklet isn't there)
    this.grainsReady = ctx.audioWorklet
      ? ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url)).then(() => true, (e) => { console.warn('engine worklet:', e); return false; })
      : Promise.resolve(false);
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    // a browser that wouldn't resume the sound by itself (coming back to the tab) does on the next touch or key
    const wake = () => { if (ctx.state !== 'running' && !document.hidden) ctx.resume().catch(() => {}); };
    addEventListener('pointerdown', wake, true); addEventListener('keydown', wake, true);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.white = noiseBuffer(ctx, 2, 'white');
    this.pink = noiseBuffer(ctx, 3, 'pink');
    this.brown = noiseBuffer(ctx, 3, 'brown');
    this.engineBus = ctx.createGain(); this.engineBus.gain.value = 0.55; this.engineBus.connect(this.master);
    // tyres, surfaces, water, wind
    this.roll = noiseVoice(ctx, this.pink, this.master, 'bandpass', 500, 0.7);
    this.crunch = noiseVoice(ctx, this.white, this.master, 'bandpass', 2600, 1.2);
    this.slip = noiseVoice(ctx, this.white, this.master, 'bandpass', 1400, 1.4);
    this.squelch = noiseVoice(ctx, this.brown, this.master, 'lowpass', 280, 2.5);
    this.water = noiseVoice(ctx, this.pink, this.master, 'bandpass', 900, 0.6);
    this.wind = noiseVoice(ctx, this.pink, this.master, 'lowpass', 600, 0.5);
    // winch motor: a buzzing saw through a filter
    this.winchOsc = ctx.createOscillator(); this.winchOsc.type = 'sawtooth'; this.winchOsc.frequency.value = 110;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 900;
    this.winchGain = ctx.createGain(); this.winchGain.gain.value = 0;
    this.winchOsc.connect(wf).connect(this.winchGain).connect(this.master);
    this.winchOsc.start();
    // the starter motor: a saw whirring, chopped by the compression strokes
    this.starterOsc = ctx.createOscillator(); this.starterOsc.type = 'sawtooth'; this.starterOsc.frequency.value = 95;
    this.starterLfo = ctx.createOscillator(); this.starterLfo.frequency.value = 7;
    const sLfoG = ctx.createGain(); sLfoG.gain.value = 0.5;
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 700;
    this.starterGain = ctx.createGain(); this.starterGain.gain.value = 0;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    this.starterLfo.connect(sLfoG).connect(chop.gain);
    this.starterOsc.connect(sf).connect(chop).connect(this.starterGain).connect(this.master);
    this.starterOsc.start(); this.starterLfo.start();
    // the starter's high whine (its pinion on the ring gear), riding on the motor
    this.pinionOsc = ctx.createOscillator(); this.pinionOsc.type = 'triangle'; this.pinionOsc.frequency.value = 820;
    const pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 900; pf.Q.value = 2;
    this.pinionGain = ctx.createGain(); this.pinionGain.gain.value = 0;
    this.pinionOsc.connect(pf).connect(this.pinionGain).connect(chop);
    this.pinionOsc.start();
    // turbo: the compressor wheel's whistle (two partials, rising with the shaft speed) and the air rushing through
    this.turboOsc = ctx.createOscillator(); this.turboOsc.type = 'sine'; this.turboOsc.frequency.value = 3000;
    this.turboOsc2 = ctx.createOscillator(); this.turboOsc2.type = 'sine'; this.turboOsc2.frequency.value = 4500;
    this.turboGain = ctx.createGain(); this.turboGain.gain.value = 0;
    const tg2 = ctx.createGain(); tg2.gain.value = 0.3;
    this.turboOsc.connect(this.turboGain); this.turboOsc2.connect(tg2).connect(this.turboGain);
    this.turboGain.connect(this.master);
    this.turboOsc.start(); this.turboOsc2.start();
    this.turboAir = noiseVoice(ctx, this.pink, this.master, 'bandpass', 2500, 1.1);
    this.boost = 0;
    // the gearbox and transfer case singing under load (straight-cut reverse and low range louder)
    this.whineOsc = ctx.createOscillator(); this.whineOsc.type = 'triangle'; this.whineOsc.frequency.value = 400;
    this.whineF = ctx.createBiquadFilter(); this.whineF.type = 'bandpass'; this.whineF.frequency.value = 700; this.whineF.Q.value = 1.4;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineF).connect(this.whineGain).connect(this.master);
    this.whineOsc.start();
    // air: hissing out of a valve, or the compressor pumping it back
    this.air = noiseVoice(ctx, this.white, this.master, 'highpass', 3500, 0.7);
    // mud-terrain tyres hum on hard ground: a tone at the lug passing frequency
    this.humOsc = ctx.createOscillator(); this.humOsc.type = 'triangle'; this.humOsc.frequency.value = 120;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 300; hf.Q.value = 0.8;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
    this.humOsc.connect(hf).connect(this.humGain).connect(this.master);
    this.humOsc.start();
    // forest ambience
    this.forest = noiseVoice(ctx, this.pink, this.master, 'highpass', 2500, 0.3);
    this.forest.g.gain.value = 0.012;
    this.birdT = 3;
  }

  /** The master volume: nothing with the sound off, or while there is any reason to be quiet. */
  get volume() { return this.enabled && !this.mutes.size ? 0.9 : 0; }

  setEnabled(on) { this.enabled = on; this.applyVolume(); }

  /** Quiet for a reason ('pause': the pause menu; 'menu': the garage and the like; 'hidden': another tab) while on. */
  setMuted(reason, on) {
    if (on) this.mutes.add(reason); else this.mutes.delete(reason);
    this.applyVolume();
  }

  applyVolume() { if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05); }

  onVisibility() {
    const hidden = document.visibilityState === 'hidden';
    this.setMuted('hidden', hidden);
    if (!this.ctx) return;
    clearTimeout(this.sleepT);
    // faded out, then stopped (no sound, no work) a moment later
    if (hidden) this.sleepT = setTimeout(() => { if (document.hidden) this.ctx.suspend().catch(() => {}); }, 250);
    else this.ctx.resume().catch(() => {});
  }

  async loadSet(name) {
    if (this.sets.has(name)) return this.sets.get(name);
    const base = '/assets/audio/engines/';
    const pr = Promise.all([
      fetch(base + name + '.loops.json').then((r) => r.json()),
      fetch(base + name + '.loops.wav').then((r) => r.arrayBuffer()).then((ab) => this.ctx.decodeAudioData(ab)),
    ]).then(([m, buf]) => {
      const k = buf.sampleRate / m.sr, src = buf.getChannelData(0);
      const cut = ([a, l]) => {
        const a2 = Math.round(a * k), l2 = Math.round(l * k), b = this.ctx.createBuffer(1, l2, buf.sampleRate);
        const d = b.getChannelData(0); d.set(src.subarray(a2, a2 + l2));
        let e = 0; for (let i = 0; i < l2; i += 4) e += d[i] * d[i];
        return { buf: b, rms: Math.sqrt(e / (l2 / 4)) || 1e-3 };
      };
      return { f0: m.f0, on: m.on.map(cut), off: m.off.map(cut) };
    });
    this.sets.set(name, pr);
    return pr;
  }

  loadBank(name) {
    if (!this.banks.has(name)) this.banks.set(name, fetchBank(name));
    return this.banks.get(name);
  }

  /** The engine voice for a truck: its bank through the grain engine, else the loops. */
  async makeVoice(spec, out) {
    if (spec.engineBank && await this.grainsReady) {
      const bank = await this.loadBank(spec.engineBank).catch((e) => { console.warn('engine bank', spec.engineBank, e); return null; });
      if (bank) return new GrainVoice(this, bank, out, { idle: spec.engine.idleRpm, pitch: spec.bankPitch || 1 });
    }
    const set = await this.loadSet(spec.engineSound).catch(() => null);
    return set ? new EngineVoice(this, set, out, spec.soundPitch || 1) : null;
  }

  async setLocalEngine(spec) {
    if (!this.ctx) return;
    const want = (this.engineWant = (this.engineWant || 0) + 1);
    const voice = await this.makeVoice(spec, this.engineBus);
    if (!voice) return;
    if (want !== this.engineWant) { voice.stop(); return; }          // (a newer truck was asked for meanwhile)
    this.engine?.stop();
    this.engine = voice;
    this.engineSpec = spec;
  }

  /** Feed an engine voice: grain voices take the revs as they are, loops a 0..1 share of the range. */
  driveVoice(voice, spec, rpm, thr, vol) {
    const e = spec.engine;
    if (voice.grain) voice.drive(rpm, e.idleRpm, e.redline, thr, vol);
    else voice.drive((rpm - e.idleRpm) / (e.redline - e.idleRpm), Math.max(thr, 0.05), vol);
  }

  /** A one-shot knock or bang: filtered noise burst. */
  bang(strength, low = true) {
    if (!this.ctx || strength < 0.05) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = low ? this.brown : this.white;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = low ? 180 + strength * 300 : 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(clamp(strength, 0, 1) * (low ? 1.6 : 0.5), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + (low ? 0.28 : 0.18));
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.4);
  }

  /** The engine dies: a cough and a shudder. */
  stall() {
    this.bang(0.7, true);
    setTimeout(() => this.bang(0.4, true), 160);
  }

  /** A start-light beep (the countdown, a gate passed). */
  beep(freq = 880, len = 0.16, vol = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setValueAtTime(vol, t + len - 0.03); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + len + 0.02);
  }

  chirp() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 2200;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      const t0 = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t0 + 0.06);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.018, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.08);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.1);
    }
  }

  /**
   * v: the local Vehicle; listener: camera; remotes: [{ id, spec, pos, rpm, thr }]
   */
  update(dt, v, camera, remotes = []) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // listener
    const L = this.ctx.listener, p = camera.position;
    const fx = -camera.matrixWorld.elements[8], fy = -camera.matrixWorld.elements[9], fz = -camera.matrixWorld.elements[10];
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(fx, fy, fz, 0, 1, 0); }

    if (v) {
      // the load the engine sounds under: the throttle, and how hard it is pulling (or being pulled: overrun)
      const dtr = v.dt, e = dtr.e;
      const peak = e._peak || (e._peak = e.torque.reduce((m, q) => Math.max(m, q[1]), 1));
      const pull = clamp(dtr.engineTorque / peak, 0, 1);
      this.loadS = (this.loadS ?? 0) + ((0.65 * dtr.throttle + 0.35 * pull) - (this.loadS ?? 0)) * Math.min(1, dt * 8);
      // cranking: the engine turns over on the starter (its firings come slow and soft: compression, no bang)
      const cranking = dtr.crankT > 0;
      if (this.engine) this.driveVoice(this.engine, this.engineSpec || v.spec, cranking ? Math.max(dtr.rpm, 150) : dtr.rpm, cranking ? 0.15 : this.loadS, dtr.running ? 0.95 : cranking ? 0.32 : 0);
      // the starter: a motor chopped by the compression strokes (a diesel's heavier and slower)
      const bank = v.spec.engineBank || '';
      const cyl = e.cyl || BANK_CYL[bank] || 6, diesel = !!e.diesel || bank[0] === 'd';
      glide(this.starterGain.gain, cranking ? (diesel ? 0.085 : 0.07) : 0, t, 0.03);
      glide(this.pinionGain.gain, cranking ? 0.05 : 0, t, 0.03);
      glide(this.starterLfo.frequency, Math.max(4, dtr.rpm * cyl / 120), t, 0.05);
      glide(this.starterOsc.frequency, diesel ? 80 : 98, t, 0.05);
      // turbo (spec.turbo 1: turbo-diesel, 2: twin-turbo petrol): boost builds with load once the revs are up,
      // the wheel spools up behind it and winds down after a lift
      const T = v.spec.turbo || 0, idle = e.idleRpm;
      const rr = dtr.rpm / idle;
      const want = T && dtr.running ? clamp((this.loadS - 0.2) / 0.7, 0, 1) * clamp((rr - 1.4) / 2.0, 0, 1) : 0;
      this.boost += (want - this.boost) * Math.min(1, dt / (want > this.boost ? (T === 1 ? 0.8 : 0.5) : 0.4));
      const shaft = 0.12 + 0.88 * Math.sqrt(this.boost);
      const fW = (T === 2 ? 3000 : 2000) + shaft * (T === 2 ? 4500 : 3000);
      glide(this.turboOsc.frequency, fW, t, 0.05); glide(this.turboOsc2.frequency, fW * 1.52, t, 0.05);
      glide(this.turboGain.gain, T ? (T === 2 ? 0.0032 : 0.0045) * this.boost * (0.4 + 0.6 * this.loadS) : 0, t, 0.06);
      glide(this.turboAir.g.gain, T ? 0.022 * this.boost * (0.3 + 0.7 * this.loadS) : 0, t, 0.06);
      glide(this.turboAir.f.frequency, 1400 + 2600 * shaft, t, 0.06);
      // gear whine: the gearbox output (the transfer case input) turning, louder pulling hard, in low range and
      // in reverse (straight-cut)
      const gb = Math.abs(dtr.wOut) * (dtr.low ? dtr.t.low : dtr.t.high) * 60 / (2 * Math.PI);
      const fWh = gb / 60 * 33;
      const pullAmt = clamp(Math.abs(dtr.engineTorque) / peak, 0, 1);
      const whine = fWh > 60 ? Math.min(1, gb / 1800) * (0.3 + 0.7 * pullAmt) * (dtr.low ? 2.2 : 1) * (dtr.gear < 0 ? 2.6 : 1) : 0;
      glide(this.whineOsc.frequency, Math.max(40, fWh), t, 0.05);
      glide(this.whineF.frequency, clamp(fWh * 1.1, 200, 4000), t, 0.05);
      glide(this.whineGain.gain, Math.min(0.03, 0.0065 * whine), t, 0.08);
      const speed = Math.abs(v.speed);
      // air in or out of the tyres
      const airing = Math.abs((v.psiAir ?? v.psi) - v.psiTarget) > 0.05 && (v.psiTarget > v.psi || speed < 2.5);
      glide(this.air.g.gain, airing ? (v.psiTarget < v.psi ? 0.09 : 0.04) : 0, t, 0.08);
      // tread hum on road and rock, louder for mud tyres
      let hard = 0;
      for (const w of v.wheels) if (w.contact && (w.surf.name === 'road' || w.surf.name === 'rock')) hard += 0.25;
      const noise = [0.25, 0.7, 1][v.spec.tyre.tread || 0];
      glide(this.humGain.gain, hard * noise * Math.min(1, speed / 12) * 0.05, t, 0.1);
      glide(this.humOsc.frequency, Math.max(40, speed / ([0.055, 0.085, 0.13][v.spec.tyre.tread || 0])), t, 0.1);
      // ground under the tyres
      let roll = 0, crunch = 0, slip = 0, mud = 0, water = 0, n = 0;
      for (const w of v.wheels) {
        if (!w.contact) continue;
        n++;
        const s = w.surf.name;
        const sp = Math.min(1, speed / 20);
        roll += sp * (s === 'road' || s === 'rock' ? 0.5 : 0.8);
        if (s === 'gravel' || s === 'riverbed') crunch += sp * 1.1;
        if (s === 'dirt' || s === 'sand') crunch += sp * 0.35;
        if (s === 'mud' || s === 'snow') mud += Math.min(1, speed / 6 + w.slipSpeed / 8);
        slip += clamp((w.slipSpeed - 1.5) / 8, 0, 1) * (s === 'mud' ? 0.3 : 1);
        water += clamp(w.water * 2, 0, 1) * Math.min(1, speed / 4);
      }
      if (n) { roll /= n; crunch /= n; slip /= n; mud /= n; water /= n; }
      glide(this.roll.g.gain, roll * 0.22, t);
      glide(this.roll.f.frequency, 250 + speed * 18, t);
      glide(this.crunch.g.gain, crunch * 0.09, t);
      glide(this.slip.g.gain, slip * 0.16, t);
      glide(this.squelch.g.gain, mud * (0.35 + 0.25 * Math.sin(t * 9)), t, 0.03);
      glide(this.water.g.gain, Math.max(water * 0.4, v.waterDepth > 0.05 ? Math.min(0.5, speed * 0.1) : 0), t);
      glide(this.wind.g.gain, Math.min(0.35, speed * speed * 0.0004), t);
      glide(this.wind.f.frequency, 300 + speed * 25, t);
      // knocks: hull scrapes and impacts, hard landings
      this.thumpCool -= dt;
      const hit = Math.max(v.hullContact || 0, v.impact || 0);
      if (hit > 0.15 && this.thumpCool <= 0) { this.bang(Math.min(1, hit), true); if (hit > 0.6) this.bang(hit * 0.6, false); this.thumpCool = 0.18; }
      v.impact = 0;
      // winch
      const W = v.winch;
      const run = W.attached && W.motor !== 0;
      glide(this.winchGain.gain, run ? 0.05 + 0.04 * Math.min(1, W.tension / 40000) : 0, t, 0.05);
      glide(this.winchOsc.frequency, run ? (W.motor > 0 ? 150 - 50 * Math.min(1, W.tension / v.spec.winch.stallPull) : 170) : 100, t, 0.08);
    }
    // birds now and then
    this.birdT -= dt;
    if (this.birdT < 0) { this.birdT = 4 + Math.random() * 10; if (Math.random() < 0.7) this.chirp(); }

    // other players' engines, from where they are
    const seen = new Set();
    for (const r of remotes) {
      seen.add(r.id);
      let rv = this.remote.get(r.id);
      if (!rv) {
        rv = { voice: null, panner: null, loading: false };
        this.remote.set(r.id, rv);
        rv.loading = true;
        const pan = this.ctx.createPanner();
        pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 7; pan.maxDistance = 600; pan.rolloffFactor = 1.2;
        pan.connect(this.engineBus);
        rv.panner = pan;
        this.makeVoice(r.spec, pan).then((voice) => {
          if (!this.remote.has(r.id)) { voice?.stop(); return; }
          rv.voice = voice;
        }).catch(() => {});
      }
      if (rv.voice) {
        rv.voice.thrS = (rv.voice.thrS ?? 0) + (r.thr - (rv.voice.thrS ?? 0)) * Math.min(1, dt * 8);
        this.driveVoice(rv.voice, r.spec, r.rpm, rv.voice.thrS, 0.8);
        if (rv.panner.positionX) { rv.panner.positionX.value = r.pos.x; rv.panner.positionY.value = r.pos.y; rv.panner.positionZ.value = r.pos.z; } else rv.panner.setPosition(r.pos.x, r.pos.y, r.pos.z);
      }
    }
    for (const [id, rv] of this.remote) if (!seen.has(id)) { rv.voice?.stop(); rv.panner?.disconnect(); this.remote.delete(id); }
  }
}
