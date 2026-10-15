// Drivetrain: engine -> torque converter (+ lockup clutch) -> automatic gearbox -> two-speed transfer case
// (high / low, part-time 4WD) -> front and rear axles with open or locked differentials -> wheels.
//
// Rotating parts are 1-D bodies: the four wheels, the gearbox output shaft (the transfer case input) and the engine.
// The torque converter is a force element (its torque follows the pump and turbine speeds). Everything that is
// geared or clamped together is a velocity constraint, solved exactly each substep as a small dense system:
//   rear axle:   (wRL + wRR) / 2 * G = wOut           open differential: both wheels get the same torque
//   front axle:  (wFL + wFR) / 2 * G = wOut           only in 4WD (the transfer case locks the axles together)
//   locker:      wL = wR                              locked differential: both wheels turn together
//   lockup:      wEngine = gear * wOut                bounded by the lockup clutch's torque capacity
//   brakes:      w = 0                                bounded by each brake's torque
// (G = transfer case ratio * axle ratio). Bounded constraints that would need more torque than they have are
// clamped and the system solved again without them (an active-set pass), which is what lets wheels lock under
// braking, a clutch slip, or a brake hold a truck on a hill.
//
// So the classic off-road behaviour falls out of the mechanics: with open diffs a wheel in the air spins up and the
// one on the ground gets no more torque than it does; lock the diff and the wheel with grip gets the torque.

import { clamp, solveDense, smoothstep } from './math.js';

const RPM = 60 / (2 * Math.PI);   // rad/s -> rpm

export const DEFAULT_ENGINE = {
  name: 'V8',
  idleRpm: 720,
  redline: 4600,
  limiter: 4800,
  // full-throttle torque (Nm) against rpm
  torque: [[400, 120], [800, 215], [1200, 262], [1800, 296], [2400, 312], [3000, 306], [3600, 288], [4200, 255], [4800, 200], [5200, 140]],
  inertia: 0.3,                    // kg m^2: crank, flywheel, torque converter pump
  friction: [16, 0.024],           // closed-throttle drag: Nm + Nm per rpm (engine braking)
};

export const DEFAULT_TRANS = {
  gears: [2.48, 1.48, 1.0],        // 3-speed automatic
  reverse: 2.08,
  high: 1.0,
  low: 2.72,                       // transfer case low range
  axle: 4.1,                       // ring and pinion
  tcK: 10.6,                       // torque converter capacity factor, (rad/s) / sqrt(Nm): stall ~1800 rpm
  tcStallRatio: 2.1,               // torque multiplication at stall
  tcCoupling: 0.86,                // speed ratio where multiplication ends
  lockup: 700,                     // Nm, lockup clutch capacity
  outInertia: 0.05,                // kg m^2, gearbox output + transfer case
  turbineInertia: 0.06,            // kg m^2, turbine + gear set (reflected through the gear ratio)
  shiftTime: 0.32,                 // s
  efficiency: 0.86,                // gearbox, transfer case and axles (a 4WD driveline loses a little more)
};

export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1] * Math.max(0, rpm / curve[0][0]);
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
      return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

const NB = 6;            // bodies: 0 FL, 1 FR, 2 RL, 3 RR, 4 gearbox output, 5 engine
const OUT = 4, ENG = 5;
const MAXC = 10;

export class Drivetrain {
  constructor(engine = {}, trans = {}) {
    this.e = { ...DEFAULT_ENGINE, ...engine };
    this.t = { ...DEFAULT_TRANS, ...trans };
    this.wEngine = this.e.idleRpm / RPM;
    this.wOut = 0;
    this.gear = 1;               // -1 reverse, 0 neutral, 1..n
    this.low = false;            // transfer case range
    this.fourWD = true;
    this.lockFront = false;
    this.lockRear = false;
    this.auto = true;            // automatic shifting
    this.lockupOn = false;
    this.shiftT = 0;
    this.idleI = 0;
    this.limiterCut = false;
    this.throttle = 0;           // effective throttle after idle control and limiter
    this.engineTorque = 0;       // net crank torque (for the HUD / audio load)
    this.tcSlip = 0;
    this.turbineTorque = 0;
    // scratch for the constraint solve
    this.J = new Float64Array(MAXC * NB);
    this.bound = new Float64Array(MAXC);
    this.lam = new Float64Array(MAXC);
    this.A = new Float64Array(MAXC * MAXC);
    this.b = new Float64Array(MAXC);
    this.x = new Float64Array(MAXC);
    this.v = new Float64Array(NB);
    this.m = new Float64Array(NB);
    this.active = new Uint8Array(MAXC);
    this.idx = new Int32Array(MAXC);
  }

  get rpm() { return this.wEngine * RPM; }
  get gearRatio() {
    const t = this.t;
    if (this.gear === 0) return 0;
    if (this.gear < 0) return -t.reverse;
    return t.gears[this.gear - 1];
  }
  get rangeRatio() { return this.low ? this.t.low : this.t.high; }
  /** Wheel speed (rad/s) -> output shaft speed factor (G in the header). */
  get axleGear() { return this.rangeRatio * this.t.axle; }
  get gearLabel() { return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }

  /** Request a gear (manual mode or reverse). Returns false when refused (too fast). */
  selectGear(g, speed) {
    g = clamp(g | 0, -1, this.t.gears.length);
    if (g === this.gear) return true;
    if ((g < 0 && speed > 1.5) || (this.gear < 0 && g > 0 && speed < -1.5)) return false;
    this.gear = g;
    this.shiftT = this.t.shiftTime;
    this.lockupOn = false;
    return true;
  }

  setRange(low, speed) {
    if (low === this.low) return true;
    if (Math.abs(speed) > 3) return false;      // part-time transfer case: shift range nearly stopped
    this.low = low;
    this.shiftT = this.t.shiftTime;
    this.lockupOn = false;
    return true;
  }

  setFourWD(on, speed) {
    if (on === this.fourWD) return true;
    if (on && Math.abs(speed) > 20) return false;
    this.fourWD = on;
    return true;
  }

  setLocker(axle, on, speed) {
    if (on && Math.abs(speed) > 8) return false;
    if (axle === 'front') this.lockFront = on; else this.lockRear = on;
    return true;
  }

  /** Automatic shift logic, run every substep. thr: driver throttle 0..1. */
  autoShift(dt, thrIn) {
    // the shift schedule follows a smoothed throttle (as a governor / throttle-valve cable would), and waits a moment
    // after each shift, so the box doesn't hunt between two gears
    this.thrS = (this.thrS ?? thrIn) + (thrIn - (this.thrS ?? thrIn)) * Math.min(1, dt / 0.6);
    this.sinceShift = (this.sinceShift || 0) + dt;
    const thr = Math.max(this.thrS, thrIn > 0.95 ? thrIn : 0);          // floored throttle: kickdown at once
    if (this.shiftT > 0) { this.shiftT = Math.max(0, this.shiftT - dt); return; }
    if (!this.auto || this.gear <= 0 || this.sinceShift < 0.9) return;
    const n = this.t.gears.length;
    const turbineRpm = (g) => this.wOut * this.t.gears[g - 1] * RPM;
    // upshift from ~1800 rpm cruising to just under the redline flat out; downshift well below (the ratio step)
    const top = this.e.redline - 150, light = this.low ? 2100 : 1750;
    const up = light + (top - light) * thr;
    const down = (this.low ? 900 : 1000) + (top * 0.55 - 1000) * thr;
    if (this.gear < n && turbineRpm(this.gear) > up) {
      this.gear++; this.shiftT = this.t.shiftTime; this.lockupOn = false; this.sinceShift = 0;
    } else if (this.gear > 1 && turbineRpm(this.gear) < down && turbineRpm(this.gear - 1) < up - 500) {
      this.gear--; this.shiftT = this.t.shiftTime * 0.8; this.lockupOn = false; this.sinceShift = 0;
    }
  }

  /** Torque converter: pump torque (load on the engine) and turbine torque for pump / turbine speeds (rad/s). */
  converter(wp, wt) {
    const t = this.t, K = t.tcK;
    if (wp >= 0 && wt <= wp) {
      // driving: the pump spins faster than the turbine
      const sr = wp > 1e-3 ? clamp(wt / wp, 0, 1) : 1;
      const cap = Math.min(1, (1 - sr) / 0.12);                     // torque falls to 0 as the speeds meet
      const tp = (wp / K) * (wp / K) * cap;
      const tr = sr < t.tcCoupling ? t.tcStallRatio - (t.tcStallRatio - 1) * (Math.max(0, sr) / t.tcCoupling) : 1;
      this.tcSlip = 1 - sr;
      return [tp, tp * tr];
    }
    if (wt > wp && wt >= 0) {
      // overrun: the wheels drive the engine (engine braking through the converter, less efficiently)
      const sr = wt > 1e-3 ? clamp(wp / wt, 0, 1) : 1;
      const cap = Math.min(1, (1 - sr) / 0.12);
      const tp = -(wt / K) * (wt / K) * cap * 0.65;
      this.tcSlip = sr - 1;
      return [tp, tp];
    }
    // turbine turning backwards against the pump (rolling back in a forward gear): stall, full multiplication
    const tp = (Math.max(0, wp) / K) * (Math.max(0, wp) / K);
    this.tcSlip = 1;
    return [tp, tp * t.tcStallRatio];
  }

  /**
   * One substep.
   *   input:  { throttle 0..1, brakeTorque: [4] Nm, }
   *   wheels: [4] { omega (rad/s, + rolls forward), inertia, torque (external, Nm), damp (implicit Nm s/rad) }
   * Updates wheels[i].omega and the engine / output shaft speeds.
   */
  step(dt, input, wheels) {
    const e = this.e, t = this.t;
    const g = this.gearRatio;
    const G = this.axleGear;
    this.autoShift(dt, input.throttle);

    // ---- engine: idle governor, rev limiter, net torque
    const rpm = this.wEngine * RPM;
    const err = (e.idleRpm - rpm) / e.idleRpm;
    this.idleI = clamp(this.idleI + err * dt * 2.5, -0.1, 0.25);
    const idleThr = clamp(0.03 + err * 3 + this.idleI, 0, 0.4);
    if (rpm > e.limiter) this.limiterCut = true; else if (rpm < e.redline) this.limiterCut = false;
    let thr = Math.max(input.throttle, idleThr);
    if (this.limiterCut) thr = 0;
    this.throttle = thr;
    const fric = e.friction[0] + e.friction[1] * rpm;
    const Teng = thr * torqueAt(e.torque, rpm) - (1 - thr) * fric;
    this.engineTorque = Teng;

    // ---- torque converter (not when the lockup clutch carries it, nor in neutral)
    let Tpump = 0, Tturb = 0;
    if (g !== 0 && !this.lockupOn) {
      const wt = this.wOut * g;
      [Tpump, Tturb] = this.converter(this.wEngine, wt);
      if (this.shiftT > t.shiftTime * 0.55) Tturb *= 0.45;           // torque dip while the band changes over
    } else this.tcSlip = 0;
    this.turbineTorque = Tturb;

    // ---- lockup clutch logic
    if (g > 0 && this.gear >= 2 && this.shiftT === 0) {
      const sr = this.wEngine > 1 ? (this.wOut * g) / this.wEngine : 0;
      const turb = this.wOut * g * RPM;
      if (!this.lockupOn && sr > 0.9 && turb > 1350 && input.throttle < 0.9) this.lockupOn = true;
      else if (this.lockupOn && (turb < 1150 || input.throttle > 0.97)) this.lockupOn = false;
    } else this.lockupOn = false;

    // ---- predicted velocities (unconstrained)
    const v = this.v, m = this.m;
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      const D = w.damp || 0;
      v[i] = (w.omega + dt * w.torque / w.inertia) / (1 + dt * D / w.inertia);
      m[i] = w.inertia + dt * D;
    }
    const Iout = t.outInertia + t.turbineInertia * g * g;
    m[OUT] = Iout;
    const eff = t.efficiency - (this.fourWD ? 0.03 : 0);
    // losses: the driving torque arrives reduced; coasting, the engine sees the wheels' torque reduced the same way
    v[OUT] = this.wOut + dt * (g * Tturb * (g * Tturb * this.wOut >= 0 ? eff : 1 / eff) - 0.015 * this.wOut) / Iout;
    m[ENG] = e.inertia;
    v[ENG] = this.wEngine + dt * (Teng - Tpump) / e.inertia;

    // ---- constraints
    const J = this.J, bound = this.bound;
    J.fill(0);
    let n = 0;
    // rear axle (always: the gearbox output turns with the rear propshaft)
    J[n * NB + 2] = G / 2; J[n * NB + 3] = G / 2; J[n * NB + OUT] = -1; bound[n] = Infinity; n++;
    if (this.fourWD) { J[n * NB + 0] = G / 2; J[n * NB + 1] = G / 2; J[n * NB + OUT] = -1; bound[n] = Infinity; n++; }
    if (this.lockRear) { J[n * NB + 2] = 1; J[n * NB + 3] = -1; bound[n] = Infinity; n++; }
    if (this.lockFront) { J[n * NB + 0] = 1; J[n * NB + 1] = -1; bound[n] = Infinity; n++; }
    if (this.lockupOn) { J[n * NB + ENG] = 1; J[n * NB + OUT] = -g; bound[n] = t.lockup * dt; n++; }
    for (let i = 0; i < 4; i++) {
      const Tb = input.brakeTorque[i];
      if (Tb > 0) { J[n * NB + i] = 1; bound[n] = Tb * dt; n++; }
    }
    this.solve(n);

    for (let i = 0; i < 4; i++) wheels[i].omega = v[i];
    this.wOut = v[OUT];
    this.wEngine = Math.max(v[ENG], 300 / RPM);
  }

  /** Solve the n constraints in this.J against velocities this.v, masses this.m (active set for the bounded ones). */
  solve(n) {
    const J = this.J, bound = this.bound, v = this.v, m = this.m, A = this.A, b = this.b, x = this.x;
    const active = this.active, idx = this.idx;
    active.fill(0, 0, n);
    for (let i = 0; i < n; i++) active[i] = 1;
    // clamped impulses already applied to v stay applied; each pass removes the over-bound constraints
    for (let pass = 0; pass <= n; pass++) {
      let k = 0;
      for (let i = 0; i < n; i++) if (active[i]) idx[k++] = i;
      if (k === 0) return;
      for (let r = 0; r < k; r++) {
        const ir = idx[r] * NB;
        let rhs = 0;
        for (let q = 0; q < NB; q++) rhs -= J[ir + q] * v[q];
        b[r] = rhs;
        for (let c = 0; c < k; c++) {
          const ic = idx[c] * NB;
          let s = 0;
          for (let q = 0; q < NB; q++) { const jr = J[ir + q]; if (jr !== 0) s += jr * J[ic + q] / m[q]; }
          A[r * k + c] = s;
        }
      }
      if (!solveDense(A, b, k, x)) {
        // degenerate (e.g. lockers fighting a locked brake): fall back to dropping the last constraint
        active[idx[k - 1]] = 0;
        continue;
      }
      // the worst violation of a bound, if any
      let worst = -1, over = 0;
      for (let r = 0; r < k; r++) {
        const i = idx[r];
        const o = Math.abs(x[r]) - bound[i];
        if (o > over + 1e-12) { over = o; worst = r; }
      }
      if (worst < 0) {
        for (let r = 0; r < k; r++) this.applyImpulse(idx[r], x[r]);
        return;
      }
      // clamp that one to its bound, apply it, and solve the rest again
      const i = idx[worst];
      this.applyImpulse(i, Math.sign(x[worst]) * bound[i]);
      active[i] = 0;
    }
  }

  applyImpulse(i, lam) {
    const J = this.J, v = this.v, m = this.m, o = i * NB;
    for (let q = 0; q < NB; q++) { const j = J[o + q]; if (j !== 0) v[q] += j * lam / m[q]; }
  }
}
