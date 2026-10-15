// Sound: recorded engine loops (crossfaded by rpm and throttle, as NIGHTSHIFT does), and synthesised tyre roll on
// each surface, wheelspin, mud, water, wind, suspension knocks and bangs, the winch motor and a quiet forest.
// Other players' engines play from where their trucks are.

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
    this.remote = new Map();
    this.thumpCool = 0;
  }

  async start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    this.master = ctx.createGain(); this.master.gain.value = this.enabled ? 0.9 : 0;
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
    // forest ambience
    this.forest = noiseVoice(ctx, this.pink, this.master, 'highpass', 2500, 0.3);
    this.forest.g.gain.value = 0.012;
    this.birdT = 3;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.1);
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

  async setLocalEngine(spec) {
    if (!this.ctx) return;
    const set = await this.loadSet(spec.engineSound).catch(() => null);
    if (!set) return;
    this.engine?.stop();
    this.engine = new EngineVoice(this, set, this.engineBus, spec.soundPitch || 1);
    this.engineSpec = spec;
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
      const e = v.dt.e;
      const rpmN = (v.dt.rpm - e.idleRpm) / (e.redline - e.idleRpm);
      this.engine?.drive(rpmN, Math.max(v.dt.throttle, 0.05), 0.95);
      const speed = Math.abs(v.speed);
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
        this.loadSet(r.spec.engineSound).then((set) => {
          if (!this.remote.has(r.id)) return;
          const pan = this.ctx.createPanner();
          pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 7; pan.maxDistance = 600; pan.rolloffFactor = 1.2;
          pan.connect(this.engineBus);
          rv.panner = pan;
          rv.voice = new EngineVoice(this, set, pan, r.spec.soundPitch || 1);
        }).catch(() => {});
      }
      if (rv.voice) {
        const e = r.spec.engine;
        rv.voice.drive((r.rpm - e.idleRpm) / (e.redline - e.idleRpm), Math.max(0.05, r.thr), 0.8);
        if (rv.panner.positionX) { rv.panner.positionX.value = r.pos.x; rv.panner.positionY.value = r.pos.y; rv.panner.positionZ.value = r.pos.z; } else rv.panner.setPosition(r.pos.x, r.pos.y, r.pos.z);
      }
    }
    for (const [id, rv] of this.remote) if (!seen.has(id)) { rv.voice?.stop(); rv.panner?.disconnect(); this.remote.delete(id); }
  }
}
