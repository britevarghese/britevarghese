// Spatial audio (WebAudio, HRTF panning) built on real recordings (CC0 / public domain, see assets/audio/README.md):
// per-weapon gunshots with near (first person) and distant mic takes, vehicle guns, reload / bolt / handling foley
// on the animation timeline, boots per surface, bullet impacts, spent brass, explosions. Every set holds several
// takes: a random one plays with a little pitch variation so repeats never sound looped. Distance changes loudness,
// adds low-pass "muffling" and delays far sounds by the speed of sound. The synthesized versions stay as fallback
// until the samples have loaded (they load in the background after the first click, own weapons first).
const MAX_VOICES = 32; // spatial sample voices (own gun + own foley are not counted)
const SFX_TRIM = 0.5; // one-shot bus: own carbine shot ~-24 dBFS (loudest 50 ms), a grenade at 15 m ~-13
const CAP = { gun: 20, step: 8, imp: 10, brass: 4, misc: 8 }; // per kind, so a firefight can't starve footsteps
// [near set, distant set, gain]: gains even out the sets' measured punch (RMS of the first 150 ms) and put the
// weapons where they belong: 9 mm < 5.56 < 7.62x54R, .50 cal and 30 mm loudest
const GUN = {
  ar: ['ar_near', 'ar_far', 1.0, 1.03], sniper: ['sniper_near', 'sniper_far', 1.72, 1.07], pistol: ['pistol_near', 'pistol_far', 0.92, 0.73],
  jeep_mg: ['m2', 'm2', 1.29, 1.29], tank_mg: ['mg762', 'mg762', 1.0, 1.0], heli_cannon: ['c30', 'c30', 1.24, 1.24],
};
// reload foley at fractions of the reload time — the viewmodel animates to the same marks: magazine released 0.20,
// new one seated 0.70, on an empty gun the bolt / slide goes home at 0.88. [fraction, set, gain, only-when-empty, rate]
const RELOAD = {
  ar: [[0.2, 'ar_magout', 0.8], [0.42, 'draw_rifle', 0.22], [0.7, 'ar_magin', 1], [0.88, 'ar_bolt', 1, true]],
  pistol: [[0.2, 'pistol_magout', 0.8], [0.42, 'draw_pistol', 0.2], [0.7, 'pistol_magin', 1], [0.88, 'pistol_slide', 1, true]],
  // bolt rifle (stripper clip): bolt open, magazine floorplate / clip, rounds pushed in at 0.70, bolt closed at 0.88
  sniper: [[0.05, 'bolt_up', 0.6], [0.11, 'bolt_back', 0.6], [0.2, 'ar_magout', 0.5, false, 0.9], [0.42, 'draw_rifle', 0.22], [0.7, 'clip', 1], [0.88, 'bolt_fwd', 0.9], [0.93, 'bolt_down', 0.9]],
};
// own handling noise (reload, bolt, draw, dry fire, grenade): ~14 dB under the own gunshot as it leaves the limiter
const FOLEY = 0.1;
// even out the surfaces as heard (short crisp concrete / metal steps read quieter than a long gravel crunch)
const STEP_GAIN = { concrete: 1.7, metal: 1.2, wood: 1.0, grass: 0.8, dirt: 1.3, sand: 1.4 };
const STEP = { concrete: 'step_concrete', grass: 'step_grass', dirt: 'step_dirt', sand: 'step_dirt', wood: 'step_wood', metal: 'step_metal' };
const IMP = { concrete: 'imp_concrete', metal: 'imp_metal', dirt: 'imp_dirt', sand: 'imp_dirt', wood: 'imp_wood', glass: 'imp_glass', flesh: 'imp_flesh', rubber: 'imp_dirt' };
// what is heard first loads first
const prio = (s) => (/_near$|^step_|^dry_|^draw_|^(ar|pistol)_mag|^ar_bolt|^pistol_slide|^bolt_|^clip/.test(s) ? 0 : /_far$|^imp_|^brass/.test(s) ? 1 : 2);

export class GameAudio {
  constructor() {
    this.ctx = null; this.enabled = true;
    let v = 80; try { v = +(localStorage.getItem('sp_volume') ?? 80); } catch {}
    this.volume = Math.max(0, Math.min(1, v / 100));
    this.lib = {}; this.lastVar = {}; this.voices = 0; this.cv = {}; this.foleyQ = [];
    this.stats = {}; // plays per set (debug / scripts/playtest-audio.mjs: __game.audio.stats)
  }

  // sounds.json: set -> [file, [[start s, duration s, hit offset s?], ...]]; each set is one file of takes in a row
  async #loadSamples() {
    let man;
    try { man = await (await fetch('/assets/audio/sounds.json')).json(); } catch (e) { console.warn('[audio] no sound manifest; using synth', e); return; }
    const sets = Object.keys(man).sort((a, b) => prio(a) - prio(b));
    const one = async (set) => {
      const [file, takes] = man[set];
      try {
        const ab = await (await fetch(`/assets/audio/${file}`)).arrayBuffer();
        const buf = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
        const sr = buf.sampleRate, d = buf.getChannelData(0);
        this.lib[set] = takes.map(([s, dur, hit = 0]) => {
          // +60 ms: room for a decoder that leaves the MP3 priming delay in (the takes are 100 ms apart)
          const a = Math.round(s * sr), n = Math.min(d.length - a, Math.round((dur + 0.06) * sr));
          const b = this.ctx.createBuffer(1, n, sr); b.copyToChannel(d.subarray(a, a + n), 0);
          return { b, hit };
        });
      } catch (e) { console.warn(`[audio] ${file} failed (${e}); using synth`); }
    };
    for (let i = 0; i < sets.length; i += 4) await Promise.all(sets.slice(i, i + 4).map(one));
    this.loaded = true;
  }

  has(set) { return !!this.lib[set]?.length; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    // bus soft clipper instead of a DynamicsCompressor: Chromium's compressor pulls transients down 5-13 dB even at
    // ratio 1 (gunshots most, steady loops not at all), which left a reload as loud as the shot it follows. Linear up
    // to -4 dBFS, then a tanh shoulder into 0 dBFS: pile-ups (full auto + explosions) saturate instead of clipping.
    const lim = this.limiter = this.ctx.createWaveShaper(), K = 0.63, curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++) { const x = (i / 2048 - 1) * 4, a = Math.abs(x); curve[i] = Math.sign(x) * (a < K ? a : K + (1 - K) * Math.tanh((a - K) / (1 - K))); }
    lim.curve = curve; lim.oversample = '2x';
    const pre = this.ctx.createGain(); pre.gain.value = 0.25; // the curve spans input -4..4 (overs up to +12 dB), the shaper reads -1..1
    this.master.connect(pre).connect(lim).connect(this.ctx.destination);
    // one-shots (everything but the engine / wind loops) share a trim: about what that compressor took off them
    this.sfx = this.ctx.createGain(); this.sfx.gain.value = SFX_TRIM; this.sfx.connect(this.master);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // supersonic bullet shock wave: an N-wave (overpressure jumps up, falls linearly through zero, jumps back) of
    // ~0.4 ms, plus its ground reflection 3 ms later
    const sr = this.ctx.sampleRate, nw = this.ctx.createBuffer(1, Math.round(sr * 0.012), sr), w = nw.getChannelData(0);
    const N = Math.max(4, Math.round(sr * 0.0004));
    for (const [at, k] of [[Math.round(sr * 0.0005), 1], [Math.round(sr * 0.0035), 0.45]]) for (let i = 0; i <= N; i++) w[at + i] += k * (1 - (2 * i) / N);
    this.nwave = nw;
    // shared reverb tail (short synthetic impulse) for outdoor slap-back
    this.verb = this.ctx.createConvolver();
    const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 1.4, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2) * (i < 900 ? 0 : 1); }
    this.verb.buffer = ir;
    this.verbGain = this.ctx.createGain(); this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.sfx);
    if (!this.loaded) this.#loadSamples(); // (scripts/playtest-audio.mjs hands decoded sets to its offline renders)
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t);
      L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t);
      L.upX.setValueAtTime(up.x, t); L.upY.setValueAtTime(up.y, t); L.upZ.setValueAtTime(up.z, t);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    this.lp = pos;
  }

  // gain -> lowpass (-> HRTF panner) -> master + reverb send. Far sounds are delayed by their start time, not here.
  #chain(pos, gain, lowpass, verbSend = 1, ref = 4) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = gain;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.min(lowpass, c.sampleRate / 2 - 100);
    g.connect(f);
    let out = f;
    if (pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 600;
      p.positionX ? (p.positionX.value = pos[0], p.positionY.value = pos[1], p.positionZ.value = pos[2]) : p.setPosition(...pos);
      f.connect(p); out = p;
    }
    out.connect(this.sfx);
    if (verbSend >= 1) out.connect(this.verb);
    else if (verbSend > 0) { const vs = c.createGain(); vs.gain.value = verbSend; out.connect(vs).connect(this.verb); }
    return g;
  }

  #dist(pos) { if (!pos || !this.lp) return 0; return Math.hypot(pos[0] - this.lp.x, pos[1] - this.lp.y, pos[2] - this.lp.z); }

  // one take of a sample set. o: pos (null = in the head), gain, rate, lp, verb, ref, at (ctx time; with hit:true the
  // take's transient lands on `at`), delay (s), cat (voice cap kind; none = own sounds, uncapped), q (cancel list)
  #play(set, o = {}) {
    const L = this.lib[set], c = this.ctx;
    if (!L?.length || !c || !this.enabled) return null;
    const cat = o.cat;
    if (cat && (this.voices >= MAX_VOICES || (this.cv[cat] || 0) >= CAP[cat])) return null;
    let i = Math.floor(Math.random() * L.length);
    if (L.length > 1 && i === this.lastVar[set]) i = (i + 1) % L.length;
    this.lastVar[set] = i;
    const take = L[i], rate = o.rate ?? 0.96 + Math.random() * 0.08;
    const g = this.#chain(o.pos || null, o.gain ?? 1, o.lp ?? 20000, o.verb ?? 0.3, o.ref);
    const src = c.createBufferSource(); src.buffer = take.b; src.playbackRate.value = rate;
    src.connect(g);
    const now = c.currentTime, want = (o.at ?? now) + (o.delay || 0) - (o.hit ? take.hit / rate : 0);
    // already late (a timer fired late): skip the lead-in so the transient still lands on time
    if (want >= now) src.start(want); else src.start(now, Math.min((now - want) * rate, take.b.duration * 0.5));
    if (cat) { this.voices++; this.cv[cat] = (this.cv[cat] || 0) + 1; }
    this.stats[set] = (this.stats[set] || 0) + 1;
    src.onended = () => { if (cat) { this.voices--; this.cv[cat]--; } g.disconnect(); if (o.q) { const k = o.q.indexOf(src); if (k >= 0) o.q.splice(k, 1); } };
    if (o.q) o.q.push(src);
    return src;
  }

  #noiseBurst(dest, t, dur, attack = 0.002, hp = 0, bp = 0) {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const env = c.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + attack); env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    let node = src;
    if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
    if (bp) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = 1.2; node.connect(f); node = f; }
    node.connect(env).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  #thump(dest, t, freq, dur, gain = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.35, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }

  // weapon: 'ar' | 'sniper' | 'pistol' or a vehicle gun ('jeep_mg', 'tank_mg', 'heli_cannon')
  gunshot(pos, weapon = 'ar', local = false) {
    if (!this.ctx || !this.enabled) return;
    const d = local ? 0 : this.#dist(pos);
    const t = this.ctx.currentTime;
    const G = GUN[weapon] || GUN.ar;
    // first person and close by: the near mics (beside the shooter); further out the distant takes, which carry
    // the range's slap-back
    const far = !local && d > 25, set = far ? G[1] : G[0];
    if (this.has(set)) {
      if (!local && d > 900) return;
      const delay = !local && d > 30 ? d / 343 : 0;
      // far away: the crack's highs die off, the boom and the echo stay
      const muffle = local ? 20000 : Math.max(900, 16000 * Math.exp(-d / 140));
      this.#play(set, { pos: local ? null : pos, gain: (far ? G[3] : G[2]) * (local ? 0.9 : 1.6) * (0.9 + Math.random() * 0.2), lp: muffle, delay, verb: local ? 0.15 : Math.min(1, 0.35 + d / 200), cat: local ? null : 'gun' });
      return;
    }
    const muffle = Math.max(500, 14000 - d * 60);
    const delay = d > 40 ? d / 343 : 0;
    const big = weapon === 'sniper' || weapon === 'heli_cannon', pistol = weapon === 'pistol';
    const g = this.#chain(local ? null : pos, (local ? 0.55 : 1.0) * (big ? 1.3 : pistol ? 0.6 : 1), muffle);
    this.#noiseBurst(g, t + delay, big ? 0.35 : pistol ? 0.12 : 0.16, 0.001, 200);
    this.#thump(g, t + delay, big ? 110 : pistol ? 180 : 140, big ? 0.3 : 0.14, big ? 1.2 : 0.8);
    if (local) this.#noiseBurst(g, t + 0.01, 0.05, 0.001, 3000); // mechanical crack
  }

  // magazine reload of `weapon` taking dur s (empty: bolt / slide release at the end). pos = a soldier nearby
  // (quieter, spatial); null = my own, cancelled by stopFoley() when the reload is cut short
  reload(weapon, dur, empty = false, pos = null) {
    if (!this.ctx || !this.enabled) return;
    if (!pos) this.stopFoley();
    const R = RELOAD[weapon] || RELOAD.ar, t = this.ctx.currentTime;
    if (!this.has(R[R.length - 1][1])) { // samples not loaded yet: the old two clicks
      if (pos) return;
      this.ui('reload'); setTimeout(() => this.ui('reload2'), dur * 750); return;
    }
    for (const [f, set, gain, onlyEmpty, rate] of R) {
      if (onlyEmpty && !empty) continue;
      this.#play(set, { at: t + f * dur, hit: true, gain: gain * (pos ? 0.25 : FOLEY), rate, pos, verb: pos ? 0.2 : 0.04, ref: 2, q: pos ? null : this.foleyQ, cat: pos ? 'misc' : null });
    }
  }

  // bolt-action cycle after a shot, over dur s starting 0.15 s after it: handle up 0.10, bolt back 0.30 (the case
  // flies out), forward 0.55, handle down 0.70 — the viewmodel animates the same marks
  boltCycle(dur, pos = null, surface = null) {
    if (!this.ctx || !this.enabled || !this.has('bolt_fwd')) return;
    const t0 = this.ctx.currentTime + 0.15;
    for (const [f, set, gain] of [[0.1, 'bolt_up', 0.7], [0.3, 'bolt_back', 0.9], [0.55, 'bolt_fwd', 0.9], [0.7, 'bolt_down', 0.8]]) {
      this.#play(set, { at: t0 + f * dur, hit: true, gain: gain * (pos ? 0.3 : FOLEY * 1.2), pos, verb: pos ? 0.2 : 0.04, ref: 2, q: pos ? null : this.foleyQ, cat: pos ? 'misc' : null });
    }
    if (surface) this.brass(surface, pos, 0.15 + 0.3 * dur + 0.45, 'sniper');
  }

  stopFoley() { for (const s of this.foleyQ.splice(0)) { try { s.stop(); } catch {} } }

  // trigger pulled on an empty chamber
  dry(weapon) {
    if (!this.#play(weapon === 'pistol' ? 'dry_pistol' : 'dry_rifle', { gain: FOLEY * 1.3, verb: 0.03 })) this.ui('empty');
  }

  // weapon drawn / swapped: sling, cloth, metal
  draw(weapon) {
    if (!this.#play(weapon === 'pistol' ? 'draw_pistol' : 'draw_rifle', { gain: FOLEY, verb: 0.03, q: this.foleyQ })) this.ui('switch');
  }

  // spent case hitting the ground `delay` s after the shot (ejected, then a ~1.4 m fall); grass swallows it
  brass(surface, pos = null, delay = 0.5, weapon = 'ar') {
    if (!this.ctx || !this.enabled || surface === 'grass') return;
    const soft = surface === 'dirt' || surface === 'sand';
    this.#play(surface === 'wood' ? 'brass_wood' : 'brass_hard', {
      pos, at: this.ctx.currentTime + delay + Math.random() * 0.12, gain: (pos ? 0.25 : FOLEY * 1.2) * (soft ? 1.2 : 1) * (weapon === 'pistol' ? 0.8 : 1),
      // bigger case, lower ring
      rate: (weapon === 'pistol' ? 1.12 : weapon === 'sniper' ? 0.86 : 1) * (0.95 + Math.random() * 0.1), lp: soft ? 4000 : 16000, verb: 0.1, ref: 2, cat: 'brass',
    });
  }

  // grenade: pin pulled, overarm throw, the spoon flies off
  throwNade() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.#play('nade_pin', { gain: FOLEY * 1.2, at: t, verb: 0.03 });
    this.#play('nade_throw', { gain: FOLEY, at: t + 0.1, hit: true, verb: 0.03 });
    this.#play('nade_spoon', { gain: FOLEY * 0.5, at: t + 0.22, verb: 0.05, lp: 9000 });
  }

  nadeBounce(pos) {
    if (!this.ctx || this.#dist(pos) > 60) return;
    this.#play('nade_bounce', { pos, gain: 0.25, rate: 0.85 + Math.random() * 0.2, verb: 0.3, cat: 'imp' });
  }

  // continuous beds: 'engine' (transport plane turboprops) and 'wind' (freefall / canopy). Returns { set(gain, freq), stop() }.
  loop(kind) {
    if (!this.ctx) return null;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(), g = c.createGain(); g.gain.value = 0;
    const extra = [];
    if (kind === 'engine') {
      f.type = 'lowpass'; f.frequency.value = 260;
      // four turboprops slightly out of tune -> slow beating drone
      for (const hz of [74, 75.3, 111, 148.6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; const og = c.createGain(); og.gain.value = 0.12; o.connect(og).connect(f); o.start(); extra.push(o); }
    } else if (kind === 'tank' || kind === 'jeep' || kind === 'bike') {
      // engines: detuned saws through a lowpass that opens with the revs (tank diesel rumble, V8 turbo-diesel,
      // single-cylinder two-stroke rasp)
      f.type = 'lowpass'; f.frequency.value = 180;
      const base = kind === 'tank' ? [31, 46.5, 62.3, 93] : kind === 'jeep' ? [42, 63, 84.5, 126] : [58, 116.5, 175, 233];
      for (const hz of base) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.userData = hz; const og = c.createGain(); og.gain.value = 0.16; o.connect(og).connect(f); o.start(); extra.push(o); }
    } else if (kind === 'heli') {
      // rotor: filtered noise amplitude-modulated at the blade-passing rate ("wop-wop") + turbine whine
      f.type = 'lowpass'; f.frequency.value = 900;
      const am = c.createGain(); am.gain.value = 0.55;
      const lfo = c.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 17; const lg = c.createGain(); lg.gain.value = 0.45;
      lfo.connect(lg).connect(am.gain); lfo.start(); extra.push(lfo);
      const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 2400; const wg = c.createGain(); wg.gain.value = 0.012; whine.connect(wg).connect(g); whine.start(); extra.push(whine);
      const thump = c.createOscillator(); thump.type = 'triangle'; thump.frequency.value = 17; const tg = c.createGain(); tg.gain.value = 0.25; thump.connect(tg).connect(f); thump.start(); extra.push(thump);
      src.connect(am).connect(f).connect(g).connect(this.master); src.start();
      return {
        set: (v) => g.gain.setTargetAtTime(v, c.currentTime, 0.2),
        stop: () => { try { src.stop(); extra.forEach((o) => o.stop()); } catch {} g.disconnect(); },
      };
    } else { f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 0.5; }
    src.connect(f).connect(g).connect(this.master); src.start();
    return {
      set: (v, freq, rate) => {
        g.gain.setTargetAtTime(v, c.currentTime, 0.2); if (freq) f.frequency.setTargetAtTime(freq, c.currentTime, 0.2);
        if (rate && kind !== 'heli') for (const o of extra) o.frequency.setTargetAtTime(o.userData * rate, c.currentTime, 0.3);
      },
      stop: () => { try { src.stop(); extra.forEach((o) => o.stop()); } catch {} g.disconnect(); },
    };
  }

  // a bullet passing within a few metres: supersonic rifle rounds crack (the shock wave's N-wave, then the air
  // tearing behind it); the slower 9 mm only whizzes past, its pitch falling as it goes (Doppler)
  crack(pos, weapon = 'ar', dist = 2) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime, loud = Math.max(0.25, 1 - dist / 4);
    const g = this.#chain(pos, 0.9 * loud, 16000, 0.3);
    if (weapon === 'pistol') {
      const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
      f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(1300, t + 0.16);
      const env = c.createGain(); env.gain.setValueAtTime(0.001, t); env.gain.exponentialRampToValueAtTime(2.2, t + 0.07); env.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      src.connect(f).connect(env).connect(g); src.start(t, Math.random() * 0.5, 0.25);
      return;
    }
    const n = c.createBufferSource(); n.buffer = this.nwave; n.playbackRate.value = 0.85 + Math.random() * 0.3;
    const ng = c.createGain(); ng.gain.value = 1.6; n.connect(ng).connect(g); n.start(t);
    this.#noiseBurst(g, t + 0.001, 0.04, 0.0005, 2800);
    this.#noiseBurst(g, t + 0.004, 0.07, 0.002, 900, 2000);
    if (weapon === 'sniper' || weapon === 'jeep_mg') this.#thump(g, t, 260, 0.06, 0.4); // bigger bullet, fuller snap
  }

  explosion(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos), t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    if (this.has('expl')) {
      // recorded blast (camera mics: little real sub-bass) + a synthesized body and, further away, a rolling rumble
      this.#play('expl', { pos, gain: 1.2, lp: Math.max(500, 18000 * Math.exp(-d / 220)), delay, verb: Math.min(1, 0.5 + d / 150), ref: 10, rate: 0.9 + Math.random() * 0.15 });
      const g = this.#chain(pos, 1.0, Math.max(300, 4000 - d * 10), 0.6, 10);
      this.#thump(g, t + delay, 62, 0.9, 1.2);
      this.#noiseBurst(g, t + delay + 0.08, 1.6 + Math.min(1.6, d / 120), 0.25, 0, 160);
      this.stats.explosion = (this.stats.explosion || 0) + 1;
      return;
    }
    const g = this.#chain(pos, 2.4, Math.max(400, 9000 - d * 40));
    this.#noiseBurst(g, t + delay, 1.6, 0.004, 30);
    this.#thump(g, t + delay, 70, 0.9, 1.8);
    this.#noiseBurst(g, t + delay + 0.05, 2.2, 0.2, 0, 180);
  }

  // 120 mm tank gun: supersonic blast + deep boom, heard (and felt) far away
  cannon(pos, local = false) {
    if (!this.ctx) return;
    const d = local ? 0 : this.#dist(pos), t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    const g = this.#chain(local ? null : pos, local ? 2.2 : 3, Math.max(500, 12000 - d * 25), local ? 0.5 : 1, 10);
    if (this.#play('cannon', { pos: local ? null : pos, gain: local ? 0.75 : 1.4, lp: Math.max(600, 18000 * Math.exp(-d / 250)), delay, verb: local ? 0.4 : 1, ref: 10, rate: 0.95 + Math.random() * 0.1 })) {
      g.gain.value = local ? 0.5 : 0.8; this.#thump(g, t + delay, 50, 1.1, 1.0);
      return;
    }
    this.#noiseBurst(g, t + delay, 0.5, 0.001, 60);
    this.#thump(g, t + delay, 55, 1.1, 2.2);
    this.#noiseBurst(g, t + delay + 0.03, 1.8, 0.1, 0, 140);
  }

  // rocket motor ignition + whoosh
  rocket(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos), t = this.ctx.currentTime + (d > 30 ? d / 343 : 0);
    const g = this.#chain(pos, 1.3, Math.max(700, 9000 - d * 30));
    this.#noiseBurst(g, t, 0.08, 0.001, 300);
    this.#noiseBurst(g, t + 0.02, 0.9, 0.05, 0, 900);
  }

  // window pane shattering: bright crash + a spray of glass tinkles falling after it
  glass(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos); if (d > 120) return;
    const t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    const rec = this.#play('glass_break', { pos, gain: 1.1, delay, lp: Math.max(2500, 16000 - d * 90), verb: 0.5 });
    const g = this.#chain(pos, rec ? 0.5 : 1.1, Math.max(2500, 16000 - d * 90), 0.6);
    if (!rec) { this.#noiseBurst(g, t + delay, 0.18, 0.001, 2500); this.#noiseBurst(g, t + delay + 0.01, 0.45, 0.01, 4500, 7000); }
    for (let i = 0; i < 9; i++) {
      const o = this.ctx.createOscillator(), og = this.ctx.createGain(), tt = t + delay + 0.05 + Math.random() * 0.55;
      o.type = 'sine'; o.frequency.value = 3200 + Math.random() * 4800;
      og.gain.setValueAtTime(0, tt); og.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.1, tt + 0.003); og.gain.exponentialRampToValueAtTime(0.0008, tt + 0.08 + Math.random() * 0.12);
      o.connect(og).connect(g); o.start(tt); o.stop(tt + 0.25);
    }
  }

  // own landing: boots + body weight, heavier the faster you hit the ground; hurt = bone-jarring crunch
  land(speed, hurt = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = Math.min(1, speed / 14);
    const g = this.#chain(null, 0.5 + k * 1.2, 1200 + k * 3000, 0.2);
    this.#thump(g, t, 70 - k * 25, 0.18 + k * 0.2, 0.8 + k * 1.2);
    this.#noiseBurst(g, t, 0.06 + k * 0.08, 0.001, 200, 900);
    this.#play('draw_rifle', { gain: FOLEY * (0.6 + k), at: t + 0.03, verb: 0.03 }); // kit rattling
    if (hurt) { this.#noiseBurst(g, t + 0.02, 0.09, 0.001, 1400, 3200); this.#thump(g, t + 0.03, 45, 0.35, 1.6); }
  }

  // vaulting a sill / parapet: hands on the ledge, gear rattle
  vault() {
    if (!this.ctx) return;
    if (this.#play('draw_rifle', { gain: FOLEY * 1.2, verb: 0.03 })) return;
    const t = this.ctx.currentTime, g = this.#chain(null, 0.45, 5000, 0.2);
    this.#noiseBurst(g, t, 0.07, 0.002, 800, 2200);
    this.#noiseBurst(g, t + 0.18, 0.12, 0.01, 1500, 4000);
  }

  // bullet hitting a surface ('concrete' | 'metal' | 'dirt' | 'sand' | 'wood' | 'glass' | 'flesh'); some hard hits whine off
  impact(pos, surface) {
    if (!this.ctx || !this.enabled) return;
    const d = this.#dist(pos); if (d > 50) return;
    const set = IMP[surface] || 'imp_concrete', lp = Math.max(2500, 16000 - d * 220);
    if (this.#play(set, { pos, gain: surface === 'flesh' ? 0.35 : 0.6, lp, verb: 0.4, ref: 3, cat: 'imp' })) {
      if ((surface === 'metal' || surface === 'concrete') && Math.random() < 0.2) this.#play('ricochet', { pos, gain: 0.3, lp, at: this.ctx.currentTime + 0.015, verb: 0.5, ref: 3, cat: 'imp' });
      return;
    }
    if (d > 40) return;
    const t = this.ctx.currentTime;
    const g = this.#chain(pos, 0.25, surface === 'metal' ? 9000 : 4000);
    if (surface === 'metal') { const o = this.ctx.createOscillator(), og = this.ctx.createGain(); o.frequency.value = 1800 + Math.random() * 1500; og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(og).connect(g); o.start(t); o.stop(t + 0.3); }
    this.#noiseBurst(g, t, surface === 'dirt' || surface === 'sand' ? 0.12 : 0.07, 0.001, surface === 'wood' ? 600 : 900, surface === 'concrete' ? 2500 : 0);
  }

  // boots on `surface`; loud: crouch 0.4, walk 0.8, sprint 1.2, landing 1.5+
  footstep(pos, surface, local = false, loud = 1) {
    if (!this.ctx || !this.enabled) return;
    if (this.#play(STEP[surface] || 'step_concrete', {
      pos: local ? null : pos, gain: (local ? 0.16 : 0.22) * loud * (STEP_GAIN[surface] || 1), rate: 0.92 + Math.random() * 0.16,
      lp: surface === 'sand' ? 2200 : local ? 14000 : 9000, verb: local ? 0.03 : 0.15, ref: 3, cat: local ? null : 'step',
    })) return;
    const t = this.ctx.currentTime;
    const bp = { concrete: 1800, metal: 2600, wood: 900, dirt: 500, grass: 1200, sand: 700 }[surface] || 900;
    const g = this.#chain(local ? null : pos, (local ? 0.12 : 0.3) * loud, 6000);
    this.#noiseBurst(g, t, surface === 'grass' ? 0.14 : 0.08, 0.004, 0, bp);
    if (surface === 'metal') this.#thump(g, t, 240, 0.08, 0.2);
  }

  ui(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.#chain(null, 0.35, 12000);
    if (kind === 'hit') { this.#noiseBurst(g, t, 0.04, 0.001, 4000); this.#thump(g, t, 1400, 0.05, 0.25); }
    if (kind === 'headshot') { this.#noiseBurst(g, t, 0.05, 0.001, 3500); const o = this.ctx.createOscillator(), og = this.ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(2600, t); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(og).connect(g); o.start(t); o.stop(t + 0.2); }
    if (kind === 'kill') { this.#noiseBurst(g, t, 0.05, 0.001, 3000); this.#noiseBurst(g, t + 0.07, 0.06, 0.001, 3000); }
    if (kind === 'hurt') { this.#thump(g, t, 90, 0.18, 0.6); }
    if (kind === 'reload') { this.#noiseBurst(g, t, 0.04, 0.001, 2500, 3200); this.#noiseBurst(g, t + 0.35, 0.05, 0.001, 2000, 2400); }
    if (kind === 'reload2') { this.#noiseBurst(g, t, 0.06, 0.001, 1500, 1800); }
    if (kind === 'switch') { this.#noiseBurst(g, t, 0.05, 0.001, 1800, 2200); }
    if (kind === 'empty') { this.#noiseBurst(g, t, 0.02, 0.001, 5000); }
    if (kind === 'capture') { const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.setValueAtTime(780, t + 0.12); const og = this.ctx.createGain(); og.gain.setValueAtTime(0.15, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.4); o.connect(og).connect(g); o.start(t); o.stop(t + 0.45); }
  }
}
