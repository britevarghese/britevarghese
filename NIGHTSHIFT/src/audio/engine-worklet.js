// NIGHTSHIFT engine AudioWorklet: a small physical engine model instead of oscillators.
// Each cylinder fires at its crank angle (4-stroke cycle = 720 deg). Every firing launches an exhaust
// pressure pulse (sharp blowdown, decaying tail, combustion turbulence, cycle-to-cycle variation) that
// travels down its header (per-cylinder delay: unequal headers give the boxer rumble), into its bank's
// exhaust pipe (a lossy waveguide whose reflections give the pipe resonances), and out of the collector.
// A weaker, inverted intake pulse goes through a short intake tract; valvetrain ticks ride on top.
// Tone shaping (muffler low-pass, body EQ, volume law) happens in the Web Audio graph after this node.

const MAX_PULSES = 48;
const BUF = 8192;

class Bank {
  constructor() { this.buf = new Float32Array(BUF); this.w = 0; this.lp = 0; this.delay = 400; this.fb = 0.55; this.damp = 0.35; }
  // lossy open-pipe waveguide: y = x - fb * lowpass(y delayed by the round trip)
  tick(x) {
    const r = this.buf[(this.w - this.delay + BUF) & (BUF - 1)];
    this.lp += (r - this.lp) * this.damp;
    const y = x - this.fb * this.lp;
    this.buf[this.w] = y;
    this.w = (this.w + 1) & (BUF - 1);
    return y;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.pulses = [];
    for (let i = 0; i < MAX_PULSES; i++) this.pulses.push({ on: false, wait: 0, t: 0, T: 1, a: 0, bank: 0, intake: false });
    this.banks = [new Bank(), new Bank()];
    this.intakeTract = new Bank();
    this.seed = 12345;
    this.noiseLp = 0;
    this.valve = 0;
    this.thrS = 0; this.rpmS = 900;
    this.hp = 0; this.hpIn = 0;
    this.configure({});
    this.port.onmessage = (e) => { if (e.data?.type === 'config') this.configure(e.data.config); };
  }

  configure(c) {
    this.fire = c.fire || [0, 180, 360, 540];        // firing angles, deg of 720
    this.bankOf = c.bank || this.fire.map(() => 0);   // bank (0/1) per firing
    this.hdr = (c.hdr || this.fire.map(() => 0)).map((ms) => Math.round(ms * sampleRate / 1000));
    const pipes = c.pipe || [2.8, 2.8];                 // exhaust length per bank (m)
    const cs = 480;                                     // speed of sound in hot exhaust gas (m/s)
    this.banks.forEach((b, i) => { b.delay = Math.min(BUF - 2, Math.round(2 * pipes[i % pipes.length] / cs * sampleRate)); b.fb = c.fb ?? 0.55; b.damp = c.damp ?? 0.35; });
    this.intakeTract.delay = Math.round(2 * (c.intakeLen || 0.55) / 340 * sampleRate); this.intakeTract.fb = -0.6; this.intakeTract.damp = 0.5;
    this.open = c.open ?? 0.55;       // exhaust-open duration as a fraction of a crank revolution
    this.sharp = c.sharp ?? 5;        // tail decay (higher = snappier, raspier)
    this.turb = c.turb ?? 0.35;       // combustion turbulence (noise) in each pulse
    this.jitter = c.jitter ?? 0.12;   // cycle-to-cycle amplitude variation at idle
    this.intakeAmt = c.intake ?? 0.25;
    this.valveAmt = c.valve ?? 0.02;
    this.rotary = !!c.rotary;
    this.pops = c.pops ?? 0.6;      // afterfire tendency (pops per second scale)
    this.norm = 1.6 / Math.sqrt(this.fire.length);
  }

  rand() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  launch(i, rpm, thr) {
    const slot = this.pulses.find((p) => !p.on);
    if (!slot) return;
    const rev = 60 / Math.max(rpm, 100);               // seconds per crank revolution
    const rpmN = Math.min(1, rpm / 8000);
    const load = 0.42 + 0.58 * thr; // closed throttle still fires every cylinder, just with less charge
    const jit = 1 + (this.rand() * 2 - 1) * this.jitter * (1 - 0.6 * rpmN) * (1 - 0.5 * thr);
    // off-throttle at speed: occasional rich pops (afterfire) in the pipe
    const firings = (rpm / 120) * this.fire.length;
    const pop = thr < 0.08 && rpm > 2500 && this.rand() < this.pops * 3 / firings ? 1.8 + this.rand() * 1.5 : 1;
    slot.on = true; slot.intake = false;
    slot.wait = this.hdr[i] || 0;
    slot.t = 0;
    slot.T = Math.max(8, this.open * rev * sampleRate * (this.rotary ? 0.7 : 1) * (0.85 + 0.3 * thr));
    slot.a = load * jit * pop;
    slot.bank = this.bankOf[i] || 0;
    // intake pulse (inverted, weaker, stronger with open throttle)
    const s2 = this.pulses.find((p) => !p.on);
    if (s2) { s2.on = true; s2.intake = true; s2.wait = Math.round(0.35 * rev * sampleRate); s2.t = 0; s2.T = Math.max(8, 0.3 * rev * sampleRate); s2.a = -(0.3 + 0.7 * thr) * jit; s2.bank = 0; }
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    const ch = out[0];
    if (!ch) return true;
    const n = ch.length;
    const rpmT = params.rpm[0], thrT = params.throttle[0], gain = params.gain[0];
    const fire = this.fire, nf = fire.length;
    for (let s = 0; s < n; s++) {
      // smooth control changes over the block
      this.rpmS += (rpmT - this.rpmS) * 0.002;
      this.thrS += (thrT - this.thrS) * 0.004;
      const rpm = this.rpmS, thr = this.thrS;
      // crank: 720 deg per 4-stroke cycle
      const prev = this.phase;
      this.phase += (rpm / 60) * 360 / sampleRate;
      const wrapped = this.phase >= 720;
      if (wrapped) this.phase -= 720;
      for (let i = 0; i < nf; i++) {
        const a = fire[i];
        if (wrapped ? (a >= prev || a < this.phase) : (a >= prev && a < this.phase)) this.launch(i, rpm, thr);
      }
      // noise source for combustion turbulence
      const wn = this.rand() * 2 - 1;
      this.noiseLp += (wn - this.noiseLp) * 0.35;
      let b0 = 0, b1 = 0, inx = 0;
      for (let k = 0; k < MAX_PULSES; k++) {
        const p = this.pulses[k];
        if (!p.on) continue;
        if (p.wait > 0) { p.wait--; continue; }
        const x = p.t / p.T;
        if (x >= 1.6) { p.on = false; continue; }
        // sharp blowdown front, rounded body, exponential tail + turbulence riding on the pulse
        const env = (1 - Math.exp(-x * 45)) * Math.exp(-x * this.sharp);
        const v = p.a * env * (1 + this.turb * this.noiseLp * 1.1);
        if (p.intake) inx += v; else if (p.bank) b1 += v; else b0 += v;
        p.t++;
      }
      let y = this.banks[0].tick(b0) + this.banks[1].tick(b1);
      y += this.intakeTract.tick(inx) * this.intakeAmt;
      // valvetrain / mechanical: faint ticks at cam rate, more with rpm
      this.valve *= 0.93;
      if (this.rand() < (rpm / 60) * nf * 0.5 / sampleRate) this.valve += 1;
      y += this.valve * wn * this.valveAmt * (0.4 + rpm / 8000);
      // DC blocker (pressure pulses are one-sided)
      const hp = y - this.hpIn + 0.995 * this.hp; this.hpIn = y; this.hp = hp;
      ch[s] = hp * this.norm * gain;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch);
    return true;
  }
}

registerProcessor('nightshift-engine', EngineProcessor);
