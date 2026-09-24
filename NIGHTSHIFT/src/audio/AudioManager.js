// NIGHTSHIFT audio - AudioManager
// Fully procedural Web Audio engine: player engine synth, police sirens, traffic, environment,
// synthwave music and one-shot SFX. Optional user samples can override one-shot events.
// No three.js dependency: positions are plain {x, y, z} objects.

import { createNoiseBuffers, createImpulseResponse, makeCrunchCurve } from './Noise.js';
import { clamp, num, glide, vec, normalize, cross, dot, spatial } from './Util.js';
import { EngineSynth } from './EngineSynth.js';
import { SirenVoice, TrafficVoice } from './Siren.js';
import { MusicSynth } from './MusicSynth.js';
import { Shot, RECIPES } from './Sfx.js';
import { ImpactBank } from './ImpactBank.js';

const DEFAULT_SETTINGS = { master: 0.8, engine: 0.8, traffic: 0.7, police: 0.8, music: 0.6, environment: 0.7 };
const MAX_ONE_SHOTS = 16;
const MAX_SIRENS = 4;
const MAX_TRAFFIC = 6;
const SPEED_OF_SOUND = 343;

// event -> bus / reverb send / min retrigger interval (s)
const EVENT_ROUTING = {
  collision: { bus: 'sfx', reverb: 0.22, gap: 0.06 },
  footstep: { bus: 'sfx', reverb: 0.12, gap: 0.12 },
  gearUp: { bus: 'sfx', reverb: 0, gap: 0.05 },
  gearDown: { bus: 'sfx', reverb: 0, gap: 0.05 },
  nitroStart: { bus: 'sfx', reverb: 0.1, gap: 0.1 },
  nitroEnd: { bus: 'sfx', reverb: 0.05, gap: 0.1 },
  landing: { bus: 'sfx', reverb: 0.1, gap: 0.08 },
  brakeSqueal: { bus: 'sfx', reverb: 0.1, gap: 0.3 },
  crackle: { bus: 'engine', reverb: 0.2, gap: 0.03 },
  blowOff: { bus: 'engine', reverb: 0.1, gap: 0.25 },
  horn: { bus: 'traffic', reverb: 0.25, gap: 0.15 },
  checkpoint: { bus: 'ui', reverb: 0.15, gap: 0.05 },
  countdown: { bus: 'ui', reverb: 0.15, gap: 0.05 },
  raceFinish: { bus: 'ui', reverb: 0.25, gap: 0.5 },
  busted: { bus: 'ui', reverb: 0.25, gap: 0.5 },
  escaped: { bus: 'ui', reverb: 0.25, gap: 0.5 },
  heatUp: { bus: 'ui', reverb: 0.15, gap: 0.3 },
  uiClick: { bus: 'ui', reverb: 0, gap: 0.03 },
  uiHover: { bus: 'ui', reverb: 0, gap: 0.04 },
  uiBack: { bus: 'ui', reverb: 0, gap: 0.03 },
  purchase: { bus: 'ui', reverb: 0.1, gap: 0.1 },
  farHorn: { bus: 'env', reverb: 0.8, gap: 1 },
  dog: { bus: 'env', reverb: 0.7, gap: 1 },
  distantSiren: { bus: 'env', reverb: 0.9, gap: 2 },
};

const DISTRICTS = {
  downtown: { bed: 0.2, bedCut: 260, hiss: 0.05, drone: 0, crickets: 0.1 },
  industrial: { bed: 0.15, bedCut: 180, hiss: 0.025, drone: 0.05, crickets: 0.25 },
  suburban: { bed: 0.07, bedCut: 140, hiss: 0.015, drone: 0, crickets: 1 },
  highway: { bed: 0.22, bedCut: 340, hiss: 0.08, drone: 0, crickets: 0.2 },
  docks: { bed: 0.12, bedCut: 160, hiss: 0.02, drone: 0.035, crickets: 0.15 },
  default: { bed: 0.14, bedCut: 220, hiss: 0.04, drone: 0, crickets: 0.3 },
};

function getAudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

export class AudioManager {
  constructor(audioSettings = {}) {
    this.settings = { ...DEFAULT_SETTINGS };
    this._mergeSettings(audioSettings);
    this.supported = !!getAudioContextClass();
    this.ctx = null;
    this.ready = false;
    this._initPromise = null;

    this.listener = {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      right: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      _t: null,
    };
    this.samples = new Map();
    this._pendingSamples = new Map();
    this.shots = [];
    this.sirens = new Map();
    this.trafficVoices = new Map();
    this._lastEvent = new Map();
    this._trafficT = 0;

    this.paused = false;
    this.musicOn = false;
    this.musicIntensity = 0;
    this.env = { rain: 0, speed: 0, night: true, district: 'downtown' };
    this._envSpeedFromEnv = false;
    this.playerSpeed = 0;
    this._envTimer = 6;
    this._engineSeen = -1;
    this._engineGateOpen = false;
  }

  // ------------------------------------------------------------------ lifecycle

  async init() {
    if (!this.supported) return false;
    if (this.ctx) {
      await this._resume();
      return this.ready;
    }
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        this._build();
        this.ready = true;
        this.applySettings(this.settings);
        this.setEnvironment(this.env);
        this.setMusicIntensity(this.musicIntensity);
        this.setPaused(this.paused);
        if (this.musicOn) this.music.setOn(true);
        this._installUnlock();
        await this._resume();
        this._decodePending();
        return true;
      } catch (e) {
        console.warn('[audio] init failed, running silent:', e);
        this.ready = false;
        return false;
      }
    })();
    return this._initPromise;
  }

  async _resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || typeof ctx.resume !== 'function') return;
    try {
      // resume() may never settle without a gesture: don't block the caller forever
      await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    } catch (_) { /* ignore */ }
  }

  _installUnlock() {
    if (typeof document === 'undefined') return;
    const unlock = () => {
      if (this.ctx && this.ctx.state !== 'running') this._resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
      document.addEventListener(ev, unlock, { passive: true });
    }
  }

  _build() {
    const AC = getAudioContextClass();
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { ctx = new AC(); }
    this.ctx = ctx;
    this.buffers = createNoiseBuffers(ctx);
    this.curves = { crunch: makeCrunchCurve() };
    // pre-rendered crash / impact / backfire / scrape sounds (built in small slices after start-up)
    this.impacts = new ImpactBank(ctx);
    this.impacts.build(() => { this._initScrape(); this.engine?.attachScreech(this.impacts.pick('screech')); });

    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // ---- master chain: buses -> preMaster -> comp -> limiter -> pauseLP -> duck -> master -> out
    this.preMaster = g(1);
    this.pauseLP = ctx.createBiquadFilter(); this.pauseLP.type = 'lowpass'; this.pauseLP.frequency.value = 20000; this.pauseLP.Q.value = 0.5;
    this.duck = g(1);
    this.masterGain = g(this.settings.master);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18; this.comp.knee.value = 12; this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.006; this.comp.release.value = 0.2;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    // duck/pause filter sit after the dynamics so compressor make-up can't undo the pause duck
    this.preMaster.gain.value = 0.8;
    this.preMaster.connect(this.comp).connect(this.limiter)
      .connect(this.pauseLP).connect(this.duck).connect(this.masterGain).connect(ctx.destination);

    this.buses = {
      engine: g(this.settings.engine),
      sfx: g(this.settings.engine),
      traffic: g(this.settings.traffic),
      police: g(this.settings.police),
      music: g(this.settings.music),
      env: g(this.settings.environment),
      ui: g(0.9),
    };
    for (const k in this.buses) this.buses[k].connect(this.preMaster);

    // ---- subtle city reverb
    this.reverbIn = g(1);
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx, 2.2, 3.2);
    this.reverbReturn = g(0.32);
    this.reverbIn.connect(this.convolver).connect(this.reverbReturn).connect(this.preMaster);
    // small sends from the continuous buses
    for (const [k, amt] of [['sfx', 0.06], ['police', 0.12], ['traffic', 0.08], ['engine', 0.03]]) {
      const s = g(amt); this.buses[k].connect(s).connect(this.reverbIn);
    }

    // ---- player car
    this.engineGate = g(0);
    this.carSfxGate = g(0);
    this.engineGate.connect(this.buses.engine);
    this.carSfxGate.connect(this.buses.sfx);
    this.engine = new EngineSynth(ctx, this.buffers, this.engineGate, this.carSfxGate, this);
    this.engine.initWorklet();
    this.engine.start();

    // ---- traffic shared noise
    this.trafficNoise = ctx.createBufferSource();
    this.trafficNoise.buffer = this.buffers.pink; this.trafficNoise.loop = true;
    this.trafficNoise.start(0, 0.7);

    // ---- music
    this.music = new MusicSynth(ctx, this.buses.music, this.buffers, this.reverbIn);

    // ---- environment beds
    this._buildEnv();
  }

  _buildEnv() {
    const ctx = this.ctx;
    const out = this.buses.env;
    const g = (v = 0) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const f = (type, fr, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = fr; n.Q.value = q; return n; };
    const loop = (buf, off) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, off); return s; };
    const osc = (type, fr) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = fr; o.start(); return o; };
    const E = (this.envNodes = {});

    E.pink = loop(this.buffers.pink, 1.3);
    E.brown = loop(this.buffers.brown, 0.4);
    E.white = loop(this.buffers.white, 0.9);
    E.drops = loop(this.buffers.droplets, 0);

    // city bed (distant traffic rumble + tyre wash)
    E.cityLP = f('lowpass', 220, 0.6); E.cityGain = g(0);
    E.brown.connect(E.cityLP).connect(E.cityGain).connect(out);
    E.cityBP = f('bandpass', 900, 0.6); E.cityHiss = g(0);
    E.pink.connect(E.cityBP).connect(E.cityHiss).connect(out);
    E.cityLfo = osc('sine', 0.05); E.cityLfoD = g(0.03);
    E.cityLfo.connect(E.cityLfoD).connect(E.cityGain.gain);

    // industrial drone
    E.drone1 = osc('sine', 55); E.drone2 = osc('triangle', 82.6);
    E.droneGain = g(0);
    E.drone1.connect(E.droneGain); E.drone2.connect(E.droneGain);
    E.droneGain.connect(out);

    // crickets: carrier gated by a fast square and a slow sine
    E.cricket = osc('sine', 4500);
    E.cg1 = g(0.5); E.cg2 = g(0.5); E.cricketGain = g(0);
    E.cl1 = osc('square', 29); E.cl1d = g(0.5); E.cl1.connect(E.cl1d).connect(E.cg1.gain);
    E.cl2 = osc('sine', 0.7); E.cl2d = g(0.5); E.cl2.connect(E.cl2d).connect(E.cg2.gain);
    E.cricket.connect(E.cg1).connect(E.cg2).connect(E.cricketGain).connect(out);

    // rain
    E.rainHP = f('highpass', 500); E.rainLP = f('lowpass', 7000); E.rainGain = g(0);
    E.pink.connect(E.rainHP).connect(E.rainLP).connect(E.rainGain).connect(out);
    E.rainLow = f('lowpass', 1400); E.rainHeavy = g(0);
    E.white.connect(E.rainLow).connect(E.rainHeavy).connect(out);
    E.dropHP = f('highpass', 1200); E.dropGain = g(0);
    E.drops.connect(E.dropHP).connect(E.dropGain).connect(out);

    // wind (speed)
    E.windBP = f('bandpass', 400, 0.9); E.windGain = g(0);
    E.gust = osc('sine', 0.13); E.gustD = g(120); E.gust.connect(E.gustD).connect(E.windBP.frequency);
    E.pink.connect(E.windBP).connect(E.windGain).connect(out);

    E.send = g(0.15);
    out.connect(E.send).connect(this.reverbIn);
  }

  // ------------------------------------------------------------------ settings / mix

  _mergeSettings(s) {
    if (!s || typeof s !== 'object') return;
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (s[k] !== undefined) this.settings[k] = clamp(num(Number(s[k]), this.settings[k]), 0, 1);
    }
  }

  applySettings(audioSettings) {
    this._mergeSettings(audioSettings);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    // perceptual-ish curve
    const c = (v) => v * v;
    glide(this.masterGain.gain, c(s.master), t, 0.05);
    glide(this.buses.engine.gain, c(s.engine), t, 0.05);
    glide(this.buses.sfx.gain, c(s.engine), t, 0.05);
    glide(this.buses.traffic.gain, c(s.traffic), t, 0.05);
    glide(this.buses.police.gain, c(s.police), t, 0.05);
    glide(this.buses.music.gain, c(s.music), t, 0.05);
    glide(this.buses.env.gain, c(s.environment), t, 0.05);
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    glide(this.duck.gain, this.paused ? 0.25 : 1, t, 0.12);
    glide(this.pauseLP.frequency, this.paused ? 900 : 20000, t, 0.12);
  }

  // ------------------------------------------------------------------ listener / spatial

  setListener({ position, forward, up } = {}) {
    const L = this.listener;
    const p = vec(position);
    const now = this.ctx ? this.ctx.currentTime : (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);
    if (L._t != null) {
      const dt = now - L._t;
      if (dt > 0.001 && dt < 0.5) {
        const k = clamp(dt * 8, 0, 1);
        L.velocity.x += ((p.x - L.position.x) / dt - L.velocity.x) * k;
        L.velocity.y += ((p.y - L.position.y) / dt - L.velocity.y) * k;
        L.velocity.z += ((p.z - L.position.z) / dt - L.velocity.z) * k;
      } else if (dt >= 0.5) {
        L.velocity = { x: 0, y: 0, z: 0 };
      }
    }
    L._t = now;
    L.position = p;
    if (forward) L.forward = normalize(vec(forward));
    if (up) L.up = normalize(vec(up));
    const r = cross(L.forward, L.up);
    if (Math.hypot(r.x, r.y, r.z) > 1e-4) L.right = normalize(r);
  }

  _spatial(position, ref = 8, rolloff = 1, maxDist = 300) {
    return spatial(this.listener, position, ref, rolloff, maxDist);
  }

  // ------------------------------------------------------------------ player engine

  setPlayerEngine(state) {
    if (!this.ready || !state) return;
    this.playerSpeed = Math.abs(num(state.speed, 0));
    this.engine.set(state);
    this._engineSeen = this.ctx.currentTime;
    if (!this._engineGateOpen) {
      this._engineGateOpen = true;
      const t = this.ctx.currentTime;
      glide(this.engineGate.gain, 1, t, 0.15);
      glide(this.carSfxGate.gain, 1, t, 0.15);
    }
    if (!this._envSpeedFromEnv) this._applyWind();
  }

  // ------------------------------------------------------------------ one-shots

  async loadSample(name, url) {
    if (!name || !url) return false;
    try {
      if (typeof fetch !== 'function') throw new Error('fetch unavailable');
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const ab = await res.arrayBuffer();
      if (this.ctx) {
        this.samples.set(name, await this._decode(ab));
      } else {
        this._pendingSamples.set(name, ab);
      }
      return true;
    } catch (e) {
      console.warn(`[audio] loadSample('${name}', '${url}') failed; using synth fallback.`, e && e.message ? e.message : e);
      return false;
    }
  }

  _decode(ab) {
    return new Promise((resolve, reject) => {
      try {
        const p = this.ctx.decodeAudioData(ab, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }

  _decodePending() {
    for (const [name, ab] of this._pendingSamples) {
      this._pendingSamples.delete(name);
      this._decode(ab)
        .then((buf) => this.samples.set(name, buf))
        .catch((e) => console.warn(`[audio] could not decode sample '${name}'; using synth fallback.`, e && e.message ? e.message : e));
    }
  }

  _purgeShots(force = false) {
    const now = this.ctx.currentTime;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      if (s.dead || s._clean || (force && now > s.endAt + 1)) {
        if (!s._clean && now > s.endAt + 1) s.cleanup();
        this.shots.splice(i, 1);
      }
    }
  }

  _newShot(busName, opts) {
    this._purgeShots();
    while (this.shots.length >= MAX_ONE_SHOTS) {
      const old = this.shots.shift();
      old.kill();
    }
    const bus = this.buses[busName] || this.buses.sfx;
    const shot = new Shot(this, bus, opts);
    this.shots.push(shot);
    return shot;
  }

  playEvent(name, opts = {}) {
    if (!this.ready || typeof name !== 'string') return false;
    opts = opts || {};
    try {
      if (this.ctx.state !== 'running') this._resume();
      const route = EVENT_ROUTING[name] || { bus: 'sfx', reverb: 0.1, gap: 0.03 };
      const now = this.ctx.currentTime;
      const key = name === 'collision' ? name + (opts.type || '') : name;
      const last = this._lastEvent.get(key);
      if (last != null && now - last < route.gap) return false;
      this._lastEvent.set(key, now);

      // user-provided sample overrides the synth
      let sample = null;
      if (name === 'collision') sample = this.samples.get('collision_' + (opts.type || 'heavy')) || this.samples.get('collision');
      else if (name === 'countdown' && opts.final) sample = this.samples.get('countdown_final') || this.samples.get(name);
      else sample = this.samples.get(name);

      const recipe = RECIPES[name];
      if (!sample && !recipe) return false;

      const intensity = clamp(num(opts.intensity, 1), 0, 1);
      const shot = this._newShot(route.bus, {
        position: opts.position || null,
        reverb: route.reverb,
        gain: num(opts.volume, 1) * (sample && name === 'collision' ? 0.4 + 0.6 * intensity : 1),
        ref: name === 'horn' ? 12 : 10,
      });
      const t = now + 0.005;
      if (sample) {
        shot.buffer(sample, t, clamp(num(opts.rate, 1), 0.25, 4));
      } else {
        recipe(shot, t, opts, this);
      }
      if (shot.pending === 0) shot.cleanup();
      return true;
    } catch (e) {
      console.warn('[audio] playEvent failed:', name, e);
      return false;
    }
  }

  playFootstep(run, position) { return this.playEvent('footstep', { intensity: run ? 0.85 : 0.5, position, volume: 0.9 }); }

  // continuous grinding while the car slides along a wall / barrier (instead of a stream of thumps)
  _initScrape() {
    const ctx = this.ctx, buf = this.impacts.pick('scrape');
    if (!buf || !this.carSfxGate) return;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.scrapeLP = ctx.createBiquadFilter(); this.scrapeLP.type = 'lowpass'; this.scrapeLP.frequency.value = 2500; this.scrapeLP.Q.value = 0.6;
    this.scrapeGain = ctx.createGain(); this.scrapeGain.gain.value = 0;
    src.connect(this.scrapeLP).connect(this.scrapeGain).connect(this.carSfxGate);
    src.start();
    this.scrapeSrc = src;
  }
  /** level 0..1 (0 = not touching), speed m/s along the wall */
  setScrape(level, speed = 0) {
    if (!this.scrapeGain) return;
    const t = this.ctx.currentTime;
    glide(this.scrapeGain.gain, level * 0.5, t, level > 0 ? 0.02 : 0.07);
    glide(this.scrapeLP.frequency, 1200 + Math.min(speed, 45) * 180, t, 0.05);
    glide(this.scrapeSrc.playbackRate, 0.65 + Math.min(speed, 45) / 45 * 0.7, t, 0.08);
  }

  /** Engine-internal events (crackle pops, blow-off). Lower priority: skipped when busy. */
  _internalEvent(name, opts) {
    if (!this.ready) return;
    if (this.shots.length >= MAX_ONE_SHOTS - 3) return;
    this.playEvent(name, opts);
  }

  // ------------------------------------------------------------------ police / traffic

  setSirens(list) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const items = this._nearest(list, MAX_SIRENS);
    const seen = new Set();
    for (const it of items) {
      const id = it.id;
      seen.add(id);
      let v = this.sirens.get(id);
      if (!v) {
        v = new SirenVoice(this.ctx, this.buses.police, this.reverbIn);
        this.sirens.set(id, v);
      }
      const sp = this._spatial(it.position, 12, 0.9, 400);
      let ratio = 1;
      if (it.velocity) {
        const vel = vec(it.velocity);
        const L = this.listener.velocity;
        const rel = { x: vel.x - L.x, y: vel.y - L.y, z: vel.z - L.z };
        const vr = dot(rel, sp.dir); // + = moving away
        ratio = SPEED_OF_SOUND / (SPEED_OF_SOUND + clamp(vr, -120, 120));
      }
      v.update(sp, num(it.intensity, 0.5), ratio, t);
    }
    for (const [id, v] of this.sirens) {
      if (!seen.has(id)) { v.release(); this.sirens.delete(id); }
    }
  }

  setTraffic(list) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const dt = this._trafficT ? clamp(t - this._trafficT, 0.001, 0.5) : 0.016;
    this._trafficT = t;
    const items = this._nearest(list, MAX_TRAFFIC);
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let v = this.trafficVoices.get(it.id);
      if (!v) {
        v = new TrafficVoice(this.ctx, this.buses.traffic, this.trafficNoise);
        this.trafficVoices.set(it.id, v);
      }
      v.update(this._spatial(it.position, 6, 1, 160), num(it.speed, 10), dt, t);
    }
    for (const [id, v] of this.trafficVoices) {
      if (!seen.has(id)) { v.release(); this.trafficVoices.delete(id); }
    }
  }

  _nearest(list, max) {
    if (!Array.isArray(list)) return [];
    const valid = list.filter((it) => it && it.id != null && it.position);
    if (valid.length <= max) return valid;
    const L = this.listener.position;
    const d2 = (p) => (num(p.x) - L.x) ** 2 + (num(p.y) - L.y) ** 2 + (num(p.z) - L.z) ** 2;
    return valid
      .map((it) => [d2(it.position), it])
      .sort((a, b) => a[0] - b[0])
      .slice(0, max)
      .map((e) => e[1]);
  }

  // ------------------------------------------------------------------ environment

  setEnvironment(env = {}) {
    if (!env || typeof env !== 'object') return;
    const E0 = this.env;
    if (env.rain !== undefined) E0.rain = clamp(num(Number(env.rain), 0), 0, 1);
    if (env.speed !== undefined) { E0.speed = Math.abs(num(Number(env.speed), 0)); this._envSpeedFromEnv = true; }
    if (env.night !== undefined) E0.night = !!env.night;
    if (typeof env.district === 'string') E0.district = env.district;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const E = this.envNodes;
    const d = DISTRICTS[E0.district] || DISTRICTS.default;
    const night = E0.night;
    const rain = E0.rain;

    glide(E.cityGain.gain, d.bed * (night ? 0.8 : 1.2), t, 1.0);
    glide(E.cityLP.frequency, d.bedCut, t, 1.0);
    glide(E.cityHiss.gain, d.hiss * (night ? 0.8 : 1.3) * (1 - rain * 0.5), t, 1.0);
    glide(E.droneGain.gain, d.drone, t, 1.5);
    glide(E.cricketGain.gain, night ? d.crickets * 0.012 * (1 - rain) : 0, t, 1.5);

    glide(E.rainGain.gain, rain * 0.3, t, 0.6);
    glide(E.rainHeavy.gain, rain * rain * 0.12, t, 0.6);
    glide(E.dropGain.gain, rain * 0.35, t, 0.6);
    glide(E.rainLP.frequency, 4000 + rain * 5000, t, 0.6);
    this._applyWind();
  }

  _applyWind() {
    if (!this.ready) return;
    const E = this.envNodes;
    const t = this.ctx.currentTime;
    const sp = Math.max(this._envSpeedFromEnv ? this.env.speed : 0, this.playerSpeed);
    const n = clamp(sp / 70, 0, 1.3);
    glide(E.windGain.gain, clamp(n * n * 0.4, 0, 0.5), t, 0.2);
    glide(E.windBP.frequency, 300 + sp * 14, t, 0.2);
  }

  _envEvents(dt) {
    this._envTimer -= dt;
    if (this._envTimer > 0) return;
    const night = this.env.night;
    this._envTimer = night ? 7 + Math.random() * 12 : 12 + Math.random() * 20;
    if (this.paused || this.shots.length > 10) return;
    const dist = this.env.district;
    const pool = ['farHorn', 'farHorn'];
    if (night && (dist === 'suburban' || dist === 'industrial' || dist === 'docks')) pool.push('dog', 'dog');
    else if (night) pool.push('dog');
    if (night && this.sirens.size === 0) pool.push('distantSiren');
    const name = pool[Math.floor(Math.random() * pool.length)];
    const a = Math.random() * Math.PI * 2;
    const r = 120 + Math.random() * 140;
    const L = this.listener.position;
    const position = { x: L.x + Math.cos(a) * r, y: L.y + 5, z: L.z + Math.sin(a) * r };
    this.playEvent(name, { position, volume: 0.9 });
  }

  // ------------------------------------------------------------------ music

  setMusic(on) {
    this.musicOn = !!on;
    if (!this.ready) return;
    this.music.setOn(this.musicOn);
  }

  setMusicIntensity(v) {
    this.musicIntensity = clamp(num(Number(v), 0), 0, 1);
    if (!this.ready) return;
    this.music.setIntensity(this.musicIntensity);
  }

  // ------------------------------------------------------------------ per-frame

  update(dt) {
    if (!this.ready) return;
    dt = clamp(num(dt, 0.016), 0, 0.25);
    try {
      this.engine.update(dt);
      this.music.schedule();
      this._purgeShots(true);
      this._envEvents(dt);
      // fade the player car out if the game stopped feeding it (menus, garage...)
      if (this._engineGateOpen && this.ctx.currentTime - this._engineSeen > 0.4) {
        this._engineGateOpen = false;
        const t = this.ctx.currentTime;
        glide(this.engineGate.gain, 0, t, 0.2);
        glide(this.carSfxGate.gain, 0, t, 0.2);
      }
    } catch (e) {
      if (!this._warnedUpdate) { this._warnedUpdate = true; console.warn('[audio] update error:', e); }
    }
  }

  getDebugInfo() {
    const state = !this.supported ? 'unsupported' : this.ctx ? this.ctx.state : 'uninitialized';
    if (!this.ready) return { state, voices: 0 };
    const oneShots = this.shots.filter((s) => !s.dead).length;
    const voices = oneShots + this.sirens.size + this.trafficVoices.size + (this._engineGateOpen ? 1 : 0) + this.music.live;
    return {
      state,
      voices,
      oneShots,
      sirens: this.sirens.size,
      traffic: this.trafficVoices.size,
      engine: this._engineGateOpen,
      engineType: this.engine.type,
      music: this.music.on,
      musicNotes: this.music.live,
      paused: this.paused,
      samples: [...this.samples.keys()],
      time: +this.ctx.currentTime.toFixed(2),
    };
  }
}

export default AudioManager;
