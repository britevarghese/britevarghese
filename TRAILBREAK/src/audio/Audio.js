// Sound: each truck's own kind of engine, rebuilt a firing at a time from real recordings (audio/engine-worklet.js,
// banks from tools/sounds), and synthesised tyre roll on each surface, wheelspin, mud (squelching, clods slapping the
// arches), stones pinging off the underbody, water, wind, suspension knocks
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
  return { data, sr: meta.sr, cyl: meta.cyl, engineCyl: meta.engineCyl || meta.cyl, idleRpm: meta.idleRpm, pos: arr(meta.pos, Int32Array), r: arr(meta.r, Float32Array),
    g: arr(meta.g, Float32Array), cls: arr(meta.cls, Uint8Array), run: arr(meta.run, Uint16Array) };
}

/** Cylinders of the engine each bank was recorded from (for the starter's compression strokes). */
const BANK_CYL = { v6: 6, i6: 6, d6: 6, d6m: 6, v8: 8, v8m: 8, v8s: 8, d8: 8, i4: 4, d4: 4, d4t: 4, v10: 10, f6: 6 };

/**
 * One engine from a bank: the worklet node, steered by rpm, load and a loudness, through a low-pass that opens with
 * the revs (the note is in the firings' harmonics, below a kilohertz or two; above them the recordings and the
 * overlapping firings leave a hiss that, flat out, sounded like noise rather than an engine). A big engine is louder
 * (cfg.loud) and has more of its low end (cfg.bass, dB on a shelf under 140 Hz: a V8's firings thump, a big diesel
 * rumbles). The last gain is the gear changes': the throttle shut for a moment as the next gear goes in.
 */
class GrainVoice {
  constructor(audio, bank, out, cfg) {
    const ctx = audio.ctx;
    this.ctx = ctx; this.grain = true; this.loud = cfg.loud || 1;
    this.node = new AudioWorkletNode(ctx, 'tb-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { bank, config: cfg } });
    this.rpm = this.node.parameters.get('rpm'); this.load = this.node.parameters.get('load'); this.gain = this.node.parameters.get('gain');
    this.bass = ctx.createBiquadFilter(); this.bass.type = 'lowshelf'; this.bass.frequency.value = 140; this.bass.gain.value = cfg.bass || 0;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 1600; this.tone.Q.value = 0.6;
    this.post = ctx.createGain();
    this.node.connect(this.bass).connect(this.tone).connect(this.post).connect(out);
  }

  /** The throttle shut for `len` s as a gear goes in: the engine drops to a mutter and comes back. */
  cut(len = 0.08, depth = 0.3) {
    const t = this.ctx.currentTime, g = this.post.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(depth, t + 0.015); g.setValueAtTime(depth, t + len); g.linearRampToValueAtTime(1, t + len + 0.06);
  }

  /** rpm, the engine's idle and redline, load 0..1 (on throttle .. overrun), vol 0..1. */
  drive(rpm, idle, red, load, vol) {
    const t = this.ctx.currentTime;
    const rn = clamp((rpm - idle) / Math.max(1, red - idle), 0, 1.2);
    // louder with revs and with load (closed throttle at speed: the overrun is quieter than the pull): about 8 dB
    // from idle to flat out at the redline
    const loud = (0.55 + 0.45 * Math.pow(rn, 0.8)) * (0.72 + 0.28 * load);
    glide(this.rpm, rpm, t, 0.02);
    glide(this.load, clamp(load, 0, 1), t, 0.05);
    glide(this.gain, 3.8 * this.loud * loud * vol, t, 0.08);
    glide(this.tone.frequency, 1500 + 0.45 * rpm + 600 * load, t, 0.08);
  }

  stop() {
    const t = this.ctx.currentTime;
    glide(this.gain, 0, t, 0.05);
    setTimeout(() => { try { this.node.disconnect(); this.bass.disconnect(); this.tone.disconnect(); this.post.disconnect(); this.node.port.close(); } catch { /* gone */ } }, 500);
  }
}

/**
 * An electric truck: no engine to hear, the motors and their inverters, and the sound the truck plays as it pulls.
 *  - The drive units' whine: three orders of the motor speed (the second reduction stage's mesh, the first stage's,
 *    and the motor's own electromagnetic order beating against it), each a narrow band of noise round its pitch with a
 *    little pure tone at its heart, wavering slightly, so it sings and breathes as a real gearbox does rather than
 *    hums like a synthesiser. Louder pulling or regenerating, quiet coasting.
 *  - The inverters' high hiss pulling hard, and their switching whistle at walking pace.
 *  - The propulsion sound the Hummer EV plays through its speakers: a deep two-note drone that rises with the speed and
 *    swells and brightens with the power asked for (felt more than heard at a cruise).
 *  - Its pedestrian warning at walking pace: a soft low chord that fades out by 30 km/h.
 */
class ElectricVoice {
  constructor(audio, out) {
    const ctx = audio.ctx;
    this.ctx = ctx; this.electric = true;
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(out);
    this.oscs = []; this.noises = [];
    const osc = (type, f, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0; o.connect(g).connect(dest); o.start(); this.oscs.push(o); return { o, g }; };
    // the whine's orders: [Hz per motor rpm, its share]
    this.orders = [[0.145, 1], [0.383, 0.8], [0.4, 0.45]].map(([k, share]) => {
      const n = noiseVoice(ctx, audio.pink, this.out, 'bandpass', 500, 28);
      this.noises.push(n);
      return { k, share, n, tone: osc('sine', 500, this.out), wob: Math.random() * 6 };
    });
    this.hiss = noiseVoice(ctx, audio.white, this.out, 'bandpass', 5200, 2.5); this.noises.push(this.hiss);
    this.pwm = osc('sine', 8000, this.out);
    // the drone: a root and its fifth (a hair sharp, so they beat) and the octave, through a low-pass that opens with power
    this.dl = ctx.createBiquadFilter(); this.dl.type = 'lowpass'; this.dl.frequency.value = 200; this.dl.Q.value = 2; this.dl.connect(this.out);
    this.d1 = osc('sawtooth', 40, this.dl); this.d2 = osc('sawtooth', 60, this.dl); this.d3 = osc('triangle', 80, this.dl);
    // the pedestrian warning
    this.hf = ctx.createBiquadFilter(); this.hf.type = 'lowpass'; this.hf.frequency.value = 260; this.hf.Q.value = 1.2; this.hf.connect(this.out);
    this.h1 = osc('sawtooth', 55, this.hf);
    this.h2 = osc('sawtooth', 82.5, this.hf);
    this.t0 = ctx.currentTime;
  }

  /** rpm: the motors' speed; load 0..1 (pulling, or regenerating); speed m/s; vol 0..1. */
  drive(rpm, load, speed, vol) {
    const t = this.ctx.currentTime, r = Math.abs(rpm), spin = clamp(r / 2500, 0, 1), L = clamp(load, 0, 1);
    const pull = 0.25 + 0.75 * L, tt = t - this.t0;
    for (const o of this.orders) {
      // (a slow waver in pitch and level, as a real drive unit's whine has under a changing load)
      const f = Math.max(30, r * o.k) * (1 + 0.004 * Math.sin(tt * 2.3 + o.wob)), a = spin * o.share * pull * (0.85 + 0.15 * Math.sin(tt * 1.7 + o.wob * 2));
      glide(o.n.f.frequency, f, t, 0.03); glide(o.tone.o.frequency, f, t, 0.03);
      glide(o.n.g.gain, 1.6 * a, t, 0.06); glide(o.tone.g.gain, 0.022 * a, t, 0.06);
    }
    glide(this.hiss.g.gain, 0.025 * L * spin, t, 0.06);
    // the inverters' switching whistle, high and thin, heard at walking pace when the motors are working
    const crawl = clamp(1 - speed / 6, 0, 1);
    glide(this.pwm.o.frequency, 7600 + 900 * Math.min(1, r / 1200), t, 0.1);
    glide(this.pwm.g.gain, 0.0035 * crawl * L, t, 0.08);
    // the drone: 38 Hz at a standstill rising to about 120 at the top speed
    const fd = 38 + Math.min(speed, 50) * 1.65;
    glide(this.d1.o.frequency, fd, t, 0.05); glide(this.d2.o.frequency, fd * 1.503, t, 0.05); glide(this.d3.o.frequency, fd * 2, t, 0.05);
    glide(this.dl.frequency, 140 + 900 * L + speed * 4, t, 0.08);
    const drone = 0.05 * (0.15 + 0.85 * L) * clamp(speed / 3 + L, 0, 1);
    glide(this.d1.g.gain, drone, t, 0.08); glide(this.d2.g.gain, drone * 0.55, t, 0.08); glide(this.d3.g.gain, drone * 0.4, t, 0.08);
    // the pedestrian warning
    const slow = clamp(1 - speed / 8.3, 0, 1);
    glide(this.h1.g.gain, 0.08 * slow * (0.45 + 0.55 * Math.min(1, speed / 1.5 + L)), t, 0.1);
    glide(this.h2.g.gain, 0.05 * slow * (0.45 + 0.55 * Math.min(1, speed / 1.5 + L)), t, 0.1);
    glide(this.h1.o.frequency, 55 + speed * 7, t, 0.1); glide(this.h2.o.frequency, 82.5 + speed * 10.5, t, 0.1);
    glide(this.out.gain, vol, t, 0.1);
  }

  stop() {
    const t = this.ctx.currentTime;
    glide(this.out.gain, 0, t, 0.05);
    setTimeout(() => { try { for (const o of this.oscs) o.stop(); for (const n of this.noises) n.src.stop(); this.out.disconnect(); } catch { /* gone */ } }, 500);
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
    this.grains = [0, 0, 0, 0].map(() => ({ suck: Math.random(), slap: Math.random(), ping: Math.random() }));
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
    // rain (rainK, 0 to 1: Game sets it, and rainCab): its hiss on the ground all about, and its drumming on the roof
    this.rainHiss = noiseVoice(ctx, this.pink, this.master, 'highpass', 1200, 0.4);
    this.rainRoof = noiseVoice(ctx, this.brown, this.master, 'bandpass', 420, 0.9);
    this.rainK = 0; this.rainCab = false;
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
    if (spec.engine?.electric) return new ElectricVoice(this, out);
    if (spec.engineBank && await this.grainsReady) {
      const bank = await this.loadBank(spec.engineBank).catch((e) => { console.warn('engine bank', spec.engineBank, e); return null; });
      if (bank) return new GrainVoice(this, bank, out, { idle: spec.engine.idleRpm, cyl: spec.engine.cyl || 0, loud: spec.engineLoud || 1, bass: spec.engineBass || 0 });
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
    this.lastGear = undefined; this.thrHi = 0;                         // (a new truck: no gear change heard from the last)
  }

  /** Feed an engine voice: grain voices take the revs as they are, loops a 0..1 share of the range. */
  driveVoice(voice, spec, rpm, thr, vol) {
    const e = spec.engine;
    // (an electric truck: its speed from the motors' through the reduction)
    if (voice.electric) voice.drive(rpm, thr, Math.abs(rpm) * Math.PI / 30 / (spec.trans.axle * (spec.trans.gears[0] || 1)) * spec.tyre.radius, vol);
    else if (voice.grain) voice.drive(rpm, e.idleRpm, e.redline, thr, vol);
    else voice.drive((rpm - e.idleRpm) / (e.redline - e.idleRpm), Math.max(thr, 0.05), vol);
  }

  /** A one-shot knock or bang: filtered noise burst. */
  /**
   * A short burst of noise through a filter swept from f0 to f1 (Hz) over len s: a tyre's tread sucking out of mud, a
   * clod slapping the wheel arch, a stone pinging off the underbody.
   */
  grain(buf, type, f0, f1, q, gain, len) {
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.015;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + Math.min(0.008, len * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * (buf.duration - len - 0.1)); src.stop(t + len + 0.03);
  }

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

  /**
   * A gear going in: the gearbox's clunk (a heavier one going down, the revs blipped to match), and pulling hard on an
   * upshift the exhaust's crack: the engine is cut for a moment as the gear goes in and the unburnt fuel lights in the
   * hot pipe, a sharp pop or two over a low boom, bigger from a big engine and high revs (a diesel only chuffs).
   *   up: an upshift; rf: the revs, 0 idle .. 1 redline; load 0..1; big 0..1 (a four .. a big V8); vol 0..1
   */
  shiftSound(up, rf, load, big, diesel, vol) {
    const ctx = this.ctx, t = ctx.currentTime;
    const burst = (buf, type, freq, q, gain, at, len, attack = 0.002) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(gain, t + at + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + at + len);
      src.connect(f).connect(g).connect(this.master);
      src.start(t + at, Math.random() * 1.5); src.stop(t + at + len + 0.05);
    };
    // the clunk of the next gear (and the driveline taking up its slack)
    burst(this.brown, 'lowpass', up ? 260 : 200, 0.9, (up ? 0.22 : 0.3) * vol, 0, 0.07, 0.003);
    burst(this.white, 'bandpass', 2400, 2.5, 0.035 * vol, 0.004, 0.02);
    const hard = clamp((rf - 0.45) / 0.45, 0, 1) * clamp((load - 0.35) / 0.5, 0, 1);
    if (!up || hard <= 0) return 0;
    const v = hard * vol * (0.55 + 0.45 * big);
    if (diesel) {
      // a diesel's chuff: a soft low puff of air
      burst(this.brown, 'lowpass', 160, 0.7, 0.55 * v, 0.01, 0.16, 0.01);
      return hard * 0.4;
    }
    // the boom, and a crack or two on top of it
    burst(this.brown, 'lowpass', 130 + 60 * big, 0.8, 1.1 * v, 0.012, 0.15, 0.003);
    const n = 1 + Math.floor(Math.random() * 2 + hard);
    for (let i = 0; i < n; i++) burst(this.white, 'bandpass', 700 + Math.random() * 900, 1.3, (0.55 - 0.15 * i) * v, 0.015 + i * (0.035 + Math.random() * 0.03), 0.04);
    return hard;
  }

  /**
   * Lifting off from high revs: the exhaust crackles and pops for a moment (fuel lighting in the pipe on the overrun),
   * a few sharp snaps and a low pop or two scattered over half a second. rf: the revs (0 idle .. 1 redline).
   */
  crackle(rf, big, vol) {
    const ctx = this.ctx, t = ctx.currentTime, k = clamp((rf - 0.5) / 0.5, 0, 1);
    const n = 2 + Math.floor(Math.random() * 3 + 3 * k);
    for (let i = 0; i < n; i++) {
      const at = 0.05 + Math.random() * 0.55, low = Math.random() < 0.35;
      const src = ctx.createBufferSource(); src.buffer = low ? this.brown : this.white;
      const f = ctx.createBiquadFilter(); f.type = low ? 'lowpass' : 'bandpass'; f.frequency.value = low ? 180 + 80 * big : 900 + Math.random() * 1400; f.Q.value = low ? 0.8 : 1.6;
      const g = ctx.createGain(), a = (low ? 0.6 : 0.32) * (0.4 + 0.6 * k) * (0.6 + 0.4 * big) * vol * (0.6 + 0.4 * Math.random());
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(a, t + at + 0.0015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + at + (low ? 0.09 : 0.03));
      src.connect(f).connect(g).connect(this.master);
      src.start(t + at, Math.random() * 1.5); src.stop(t + at + 0.15);
    }
  }

  /**
   * Something breaks (render/BreakView.js): 'tree' (the trunk cracking, its leaves swishing, the thud of it landing a
   * moment later: `fall` s), 'wood' (posts and rails splintering), 'metal' (a steel drum's hollow bong), 'plastic'
   * (a water drum's dull knock). vol: 0..1, by how hard and how near.
   */
  breakSound(kind, vol, fall = 0) {
    if (!this.ctx || vol < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime, v = Math.min(1, vol);
    const burst = (buf, type, freq, q, gain, at, len, attack = 0.004) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(gain, t + at + attack);
      g.gain.exponentialRampToValueAtTime(0.0008, t + at + len);
      src.connect(f).connect(g).connect(this.master);
      src.start(t + at, Math.random() * 1.5); src.stop(t + at + len + 0.05);
    };
    if (kind === 'tree' || kind === 'wood') {
      // the crack: a sharp bright snap, then the fibres tearing in a few quick crackles
      burst(this.white, 'bandpass', 2600, 0.9, 0.9 * v, 0, 0.09, 0.002);
      for (let i = 0; i < (kind === 'tree' ? 5 : 3); i++) burst(this.white, 'bandpass', 1500 + Math.random() * 2500, 2, 0.35 * v, 0.03 + i * (0.03 + Math.random() * 0.05), 0.05);
      burst(this.brown, 'lowpass', 260, 0.7, 0.8 * v, 0, 0.18);                     // (the knock of the hit itself)
    }
    if (kind === 'tree') {
      // the crown swishing through the air as it goes over, and the thud as it lands
      burst(this.white, 'bandpass', 900, 0.6, 0.18 * v, 0.1, Math.max(0.5, fall), Math.max(0.2, fall * 0.6));
      if (fall > 0) burst(this.brown, 'lowpass', 160, 0.8, 1.1 * v, fall, 0.45, 0.006);
    } else if (kind === 'metal') {
      // a steel drum: a hollow bong with a couple of rings, and its rattle as it rolls off
      for (const [f0, g0, len] of [[190, 0.5, 0.7], [410, 0.25, 0.45], [770, 0.12, 0.3]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(f0 * (0.95 + Math.random() * 0.1), t);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(g0 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + len + 0.05);
      }
      burst(this.white, 'bandpass', 3200, 1.5, 0.25 * v, 0, 0.08);
    } else if (kind === 'plastic') {
      burst(this.brown, 'lowpass', 420, 1.2, 0.9 * v, 0, 0.16);
      burst(this.white, 'bandpass', 1100, 1.5, 0.2 * v, 0, 0.07);
    }
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

  /** An exhaust pop since the last ask (0..1, how big), for the flash and puff at the tailpipe; 0 if none. */
  takePop() { const p = this.pop || 0; this.pop = 0; return p; }

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
      const pull = clamp(dtr.engineTorque / peak, 0, 1), regen = dtr.electric ? clamp(-dtr.engineTorque / peak, 0, 1) * 2.5 : 0;
      this.loadS = (this.loadS ?? 0) + ((0.65 * dtr.throttle + 0.35 * pull + regen) - (this.loadS ?? 0)) * Math.min(1, dt * 8);
      // cranking: the engine turns over on the starter (its firings come slow and soft: compression, no bang)
      const cranking = dtr.crankT > 0;
      if (this.engine) this.driveVoice(this.engine, this.engineSpec || v.spec, cranking ? Math.max(dtr.rpm, 150) : dtr.rpm, cranking ? 0.15 : this.loadS, dtr.running ? 0.95 : cranking ? 0.32 : 0);
      // gear changes and the overrun: the clunk, an upshift's crack from the exhaust (its flash and puff: this.pop, for
      // the game to draw), and lifting off from high revs, a moment of crackling
      if (dtr.running && !dtr.electric) {
        const rf = clamp((dtr.rpm - e.idleRpm) / Math.max(1, e.redline - e.idleRpm), 0, 1.2);
        const bk = v.spec.engineBank || '', big = clamp(((e.cyl || BANK_CYL[bk] || 6) - 4) / 4, 0, 1) * 0.7 + 0.3 * clamp(((v.spec.engineLoud || 1) - 1) / 0.6, 0, 1);
        const diesel = !!e.diesel || bk[0] === 'd', g = dtr.gear;
        if (this.lastGear !== undefined && g !== this.lastGear && g > 0 && this.lastGear > 0) {
          const up = g > this.lastGear, hard = this.shiftSound(up, this.lastRf ?? rf, this.loadS, big, diesel, 0.9);
          if (hard > 0) { this.engine?.cut?.(0.06 + 0.04 * hard, 0.35); this.pop = Math.max(this.pop || 0, hard); }
        }
        const pedal = v.pedalThrottle ?? 0;
        this.thrHi = Math.max(pedal, (this.thrHi ?? 0) - dt * 2.5);
        if (!diesel && pedal < 0.08 && this.thrHi > 0.6 && rf > 0.55) {
          this.crackle(rf, big, 0.9);
          this.pop = Math.max(this.pop || 0, 0.5 * clamp((rf - 0.5) / 0.5, 0, 1));
          this.thrHi = 0;
        }
        this.lastRf = rf;
      }
      this.lastGear = dtr.gear;
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
      // tread hum on road and rock, louder for mud tyres, a quiet roar from a road car's (its tread blocks' pitch, m)
      let hard = 0;
      for (const w of v.wheels) if (w.contact && (w.surf.name === 'road' || w.surf.name === 'rock')) hard += 0.25;
      const tread = v.spec.tyre.tread || 0, noise = [0.25, 0.7, 1, 0.15, 0.1][tread] ?? 0.25;
      glide(this.humGain.gain, hard * noise * Math.min(1, speed / 12) * 0.05, t, 0.1);
      glide(this.humOsc.frequency, Math.max(40, speed / ([0.055, 0.085, 0.13, 0.032, 0.04][tread] ?? 0.055)), t, 0.1);
      // ground under the tyres
      let roll = 0, crunch = 0, slip = 0, mud = 0, water = 0, n = 0;
      const R = v.spec.tyre.radius;
      for (const w of v.wheels) {
        if (!w.contact) continue;
        n++;
        const s = w.surf.name;
        // and what it does now and then: the tread sucking out of the mud as it turns (a squelch every few lugs,
        // lower and louder the deeper the tyre is in), clods slapping the wheel arch off a spinning tyre, stones
        // flicked up against the underbody on gravel (a few a second, at random)
        const G = this.grains[w.index & 3], tr = Math.abs(w.omega || 0) * R, wet = w.water > 0.1;
        if ((s === 'mud' || s === 'riverbed') && !wet && tr > 0.25) {
          G.suck += dt * Math.min(9, tr * 1.2 + w.slipSpeed) * (s === 'mud' ? 1 : 0.4) * (0.6 + Math.random() * 0.8);
          if (G.suck > 1) {
            G.suck = 0;
            const deep = Math.min(1, (w.sink || 0) / 0.35), f = (560 + Math.random() * 260) * (1 - 0.35 * deep);
            this.grain(this.pink, 'bandpass', f, f * (0.32 + Math.random() * 0.12), 3.5 + Math.random() * 2, (0.6 + 0.7 * deep) * (0.6 + Math.random() * 0.6), 0.08 + Math.random() * 0.08 + deep * 0.05);
          }
        }
        if ((s === 'mud' || s === 'sand' || s === 'riverbed' || s === 'snow') && w.slipSpeed > 1) {
          G.slap += dt * Math.min(10, (w.slipSpeed - 1) * 2.5) * (0.5 + Math.random());
          if (G.slap > 1) { G.slap = 0; const f = 700 + Math.random() * 500; this.grain(this.pink, 'lowpass', f, f * 0.4, 1, (s === 'mud' ? 0.6 : 0.25) * (0.5 + Math.random() * 0.7), 0.03 + Math.random() * 0.03); }
        }
        if ((s === 'gravel' || s === 'riverbed' || s === 'dirt') && speed > 2) {
          G.ping += dt * Math.min(6, speed * (s === 'dirt' ? 0.06 : 0.3)) * (0.4 + Math.random() * 1.2);
          if (G.ping > 1) { G.ping = 0; const f = 2800 + Math.random() * 3200; this.grain(this.white, 'bandpass', f, f * 0.85, 10, 0.15 + Math.random() * 0.15, 0.015 + Math.random() * 0.02); }
        }
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
      // (under the squelches, the steady slosh of the mud round the tyres)
      glide(this.squelch.g.gain, mud * 0.15, t, 0.08);
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
    // rain: the hiss louder the harder it falls, in the cab muffled under the drumming on the roof
    glide(this.rainHiss.g.gain, this.rainK * (this.rainCab ? 0.03 : 0.11), t, 0.3);
    glide(this.rainRoof.g.gain, this.rainK * (this.rainCab ? 0.09 : 0.015), t, 0.3);
    // birds now and then (not in the rain)
    this.birdT -= dt;
    if (this.birdT < 0) { this.birdT = 4 + Math.random() * 10; if (Math.random() < 0.7 * (1 - this.rainK)) this.chirp(); }

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
