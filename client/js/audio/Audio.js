// Spatial audio (WebAudio, HRTF panning). Gunshots use real recorded single shots (CC0, see README) with
// random variant + pitch per shot; everything else is synthesized. Distance changes loudness, adds low-pass
// "muffling", and delays far shots by the speed of sound. Synth gunshots remain as fallback until samples load.
const SAMPLES = { ar: 6, sniper: 5, pistol: 4 };
const MAX_VOICES = 28;
export class GameAudio {
  constructor() {
    this.ctx = null; this.enabled = true;
    let v = 80; try { v = +(localStorage.getItem('sp_volume') ?? 80); } catch {}
    this.volume = Math.max(0, Math.min(1, v / 100));
    this.buffers = {}; this.lastVar = {}; this.voices = 0;
  }

  async #loadSamples() {
    const jobs = [];
    for (const [k, n] of Object.entries(SAMPLES)) {
      this.buffers[k] = [];
      for (let i = 0; i < n; i++) {
        jobs.push(fetch(`/assets/audio/${k}_${i}.wav`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)))
          .then((buf) => { this.buffers[k].push(buf); })
          .catch((e) => console.warn(`[audio] gunshot sample ${k}_${i} failed (${e}); using synth`)));
      }
    }
    await Promise.all(jobs);
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // shared reverb tail (short synthetic impulse) for outdoor slap-back
    this.verb = this.ctx.createConvolver();
    const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 1.4, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2) * (i < 900 ? 0 : 1); }
    this.verb.buffer = ir;
    this.verbGain = this.ctx.createGain(); this.verbGain.gain.value = 0.22;
    this.verb.connect(this.verbGain).connect(this.master);
    this.#loadSamples();
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

  #chain(pos, gain, lowpass, delay = 0, verbSend = 1) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = gain;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass;
    g.connect(f);
    let out = f;
    if (pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.1; p.maxDistance = 600;
      p.positionX ? (p.positionX.value = pos[0], p.positionY.value = pos[1], p.positionZ.value = pos[2]) : p.setPosition(...pos);
      f.connect(p); out = p;
    }
    if (delay > 0) { const dl = c.createDelay(3); dl.delayTime.value = delay; out.connect(dl); out = dl; }
    out.connect(this.master);
    if (verbSend >= 1) out.connect(this.verb);
    else if (verbSend > 0) { const vs = c.createGain(); vs.gain.value = verbSend; out.connect(vs).connect(this.verb); }
    return g;
  }

  #dist(pos) { if (!pos || !this.lp) return 0; return Math.hypot(pos[0] - this.lp.x, pos[1] - this.lp.y, pos[2] - this.lp.z); }

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

  gunshot(pos, weapon = 'ar', local = false) {
    if (!this.ctx || !this.enabled) return;
    const d = local ? 0 : this.#dist(pos);
    const t = this.ctx.currentTime;
    const set = this.buffers[weapon] || this.buffers.ar;
    if (set?.length) {
      if (!local && (this.voices >= MAX_VOICES || d > 900)) return;
      // pick a different recording than last time + slight pitch/level variation so bursts never sound looped
      let i = Math.floor(Math.random() * set.length);
      if (set.length > 1 && i === this.lastVar[weapon]) i = (i + 1) % set.length;
      this.lastVar[weapon] = i;
      const delay = !local && d > 30 ? d / 343 : 0;
      // far away: the crack's highs die off, the boom and the echo stay
      const muffle = local ? 20000 : Math.max(900, 16000 * Math.exp(-d / 140));
      const base = weapon === 'sniper' ? 1.15 : weapon === 'pistol' ? 0.7 : 0.95;
      const g = this.#chain(local ? null : pos, base * (local ? 0.9 : 1.6) * (0.9 + Math.random() * 0.2), muffle, delay, local ? 0.15 : Math.min(1, 0.35 + d / 200));
      const src = this.ctx.createBufferSource(); src.buffer = set[i];
      src.playbackRate.value = 0.95 + Math.random() * 0.1;
      src.connect(g); src.start(t + delay);
      this.voices++; src.onended = () => { this.voices--; g.disconnect(); };
      if (local) this.#noiseBurst(g, t + 0.004, 0.035, 0.001, 3500); // bolt carrier / action clack
      return;
    }
    const muffle = Math.max(500, 14000 - d * 60);
    const delay = d > 40 ? d / 343 : 0;
    const big = weapon === 'sniper', pistol = weapon === 'pistol';
    const g = this.#chain(local ? null : pos, (local ? 0.55 : 1.0) * (big ? 1.3 : pistol ? 0.6 : 1), muffle, delay);
    this.#noiseBurst(g, t + delay, big ? 0.35 : pistol ? 0.12 : 0.16, 0.001, 200);
    this.#thump(g, t + delay, big ? 110 : pistol ? 180 : 140, big ? 0.3 : 0.14, big ? 1.2 : 0.8);
    if (local) this.#noiseBurst(g, t + 0.01, 0.05, 0.001, 3000); // mechanical crack
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

  // supersonic crack of a bullet passing within a few metres (+ a short whizz for slower pistol rounds)
  crack(pos, weapon = 'ar', dist = 2) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, loud = Math.max(0.25, 1 - dist / 4);
    const g = this.#chain(pos, 0.9 * loud, 16000, 0, 0.3);
    if (weapon === 'pistol') this.#noiseBurst(g, t, 0.12, 0.01, 1200, 2400);
    else { this.#noiseBurst(g, t, 0.025, 0.0005, 2500); this.#noiseBurst(g, t + 0.004, 0.06, 0.001, 800, 1800); }
  }

  explosion(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos), t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    const g = this.#chain(pos, 2.4, Math.max(400, 9000 - d * 40), delay);
    this.#noiseBurst(g, t + delay, 1.6, 0.004, 30);
    this.#thump(g, t + delay, 70, 0.9, 1.8);
    this.#noiseBurst(g, t + delay + 0.05, 2.2, 0.2, 0, 180);
  }

  // 120 mm tank gun: supersonic blast + deep boom, heard (and felt) far away
  cannon(pos, local = false) {
    if (!this.ctx) return;
    const d = local ? 0 : this.#dist(pos), t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    const g = this.#chain(local ? null : pos, local ? 2.2 : 3, Math.max(500, 12000 - d * 25), delay, local ? 0.5 : 1);
    this.#noiseBurst(g, t + delay, 0.5, 0.001, 60);
    this.#thump(g, t + delay, 55, 1.1, 2.2);
    this.#noiseBurst(g, t + delay + 0.03, 1.8, 0.1, 0, 140);
  }

  // rocket motor ignition + whoosh
  rocket(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos), t = this.ctx.currentTime;
    const g = this.#chain(pos, 1.3, Math.max(700, 9000 - d * 30), d > 30 ? d / 343 : 0);
    this.#noiseBurst(g, t, 0.08, 0.001, 300);
    this.#noiseBurst(g, t + 0.02, 0.9, 0.05, 0, 900);
  }

  // window pane shattering: bright crash + a spray of glass tinkles falling after it
  glass(pos) {
    if (!this.ctx) return;
    const d = this.#dist(pos); if (d > 120) return;
    const t = this.ctx.currentTime, delay = d > 30 ? d / 343 : 0;
    const g = this.#chain(pos, 1.1, Math.max(2500, 16000 - d * 90), delay, 0.6);
    this.#noiseBurst(g, t + delay, 0.18, 0.001, 2500);
    this.#noiseBurst(g, t + delay + 0.01, 0.45, 0.01, 4500, 7000);
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
    const g = this.#chain(null, 0.5 + k * 1.2, 1200 + k * 3000, 0, 0.2);
    this.#thump(g, t, 70 - k * 25, 0.18 + k * 0.2, 0.8 + k * 1.2);
    this.#noiseBurst(g, t, 0.06 + k * 0.08, 0.001, 200, 900);
    if (hurt) { this.#noiseBurst(g, t + 0.02, 0.09, 0.001, 1400, 3200); this.#thump(g, t + 0.03, 45, 0.35, 1.6); }
  }

  // vaulting a sill / parapet: hands on the ledge, gear rattle
  vault() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, g = this.#chain(null, 0.45, 5000, 0, 0.2);
    this.#noiseBurst(g, t, 0.07, 0.002, 800, 2200);
    this.#noiseBurst(g, t + 0.18, 0.12, 0.01, 1500, 4000);
  }

  impact(pos, surface) {
    if (!this.ctx || this.#dist(pos) > 40) return;
    const t = this.ctx.currentTime;
    const g = this.#chain(pos, 0.25, surface === 'metal' ? 9000 : 4000);
    if (surface === 'metal') { const o = this.ctx.createOscillator(), og = this.ctx.createGain(); o.frequency.value = 1800 + Math.random() * 1500; og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(og).connect(g); o.start(t); o.stop(t + 0.3); }
    this.#noiseBurst(g, t, surface === 'dirt' || surface === 'sand' ? 0.12 : 0.07, 0.001, surface === 'wood' ? 600 : 900, surface === 'concrete' ? 2500 : 0);
  }

  footstep(pos, surface, local = false, loud = 1) {
    if (!this.ctx) return;
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
