// Drivetrain: engine -> torque converter (+ lockup clutch) and automatic gearbox, or clutch and manual gearbox ->
// two-speed transfer case (high / low, part-time 4WD) -> front and rear axles with open, limited-slip or locking
// differentials -> wheels.
//
// Rotating parts are 1-D bodies: the four wheels, the gearbox output shaft (the transfer case input) and the engine.
// The torque converter is a force element (its torque follows the pump and turbine speeds). Everything that is
// geared or clamped together is a velocity constraint, solved exactly each substep as a small dense system:
//   rear axle:   (wRL + wRR) / 2 * G = wOut           open differential: both wheels get the same torque
//   front axle:  (wFL + wFR) / 2 * G = wOut           only in 4WD (the transfer case locks the axles together)
//   locker:      wL = wR                              locked differential: both wheels turn together
//   lockup:      wEngine = gear * wOut                bounded by the lockup clutch's torque capacity
//   clutch:      wEngine = gear * wOut                manual gearbox: bounded by the clutch's capacity as it engages
//   LSD:         wL = wR                              bounded by its clutch packs: preload + a share of the axle torque
//   auto-locker: wL = wR                              (a mechanical locker, as the Thar's MLD) while it is locked: it
//                                                     locks itself when one wheel spins away, and frees itself when
//                                                     the drive comes off or the truck goes faster than ~30 km/h
//   brakes:      w = 0                                bounded by each brake's torque
// (G = transfer case ratio * axle ratio). Bounded constraints that would need more torque than they have are
// clamped and the system solved again without them (an active-set pass), which is what lets wheels lock under
// braking, a clutch slip, or a brake hold a truck on a hill.
//
// So the classic off-road behaviour falls out of the mechanics: with open diffs a wheel in the air spins up and the
// one on the ground gets no more torque than it does; lock the diff and the wheel with grip gets the torque. A
// limited-slip diff sends the grippy wheel up to ~2.6 times the torque of the other, which is little when the other
// is in the air: a touch of brake (raising the slipping wheel's torque) gets more through, as drivers do.
//
// The manual gearbox has an automatic clutch, as a driver would work it: it slips to pull away, stays in while the
// engine is above idle (engine braking downhill), and opens rather than let the engine stall. No creep at idle.
// A dual-clutch box (trans.dct) shifts up without a gap in the drive: the next gear's clutch takes over at once,
// slipping with about the engine's own torque while the ignition is cut and the revs come down to the new gear's speed
// (the clutch alone, biting hard, would throw the engine's spin into the tyres).
//
// An electric truck (engine.electric, gearbox type 'direct'): the motors are geared straight to the axles, one ratio
// each way, so the motor turns with the wheels (rigidly, both ways) and gives its torque from a standstill: full torque
// to its base speed, then constant power. No idle, no clutch or converter; off the throttle it brakes itself,
// regenerating (engine.friction), down to nothing at a standstill.
//
// Road cars (trans.drive): 'rwd' drives the rear axle alone (no front axle to engage); 'awd' drives both all the
// time through a centre differential that splits the torque (trans.split: the front's share) and a coupling that
// holds the axles together up to its torque (trans.centre: [preload, share of the drive torque], N m at the wheels:
// a viscous or multi-plate clutch, as in a Haldex or ATTESA), so a slipping axle sends the drive to the other:
//   centre diff: split * (wFL + wFR) / 2 * G + (1 - split) * (wRL + wRR) / 2 * G = wOut
//   coupling:    (wFL + wFR) / 2 = (wRL + wRR) / 2                bounded by its torque
// A lockable centre (trans.centreLock, the G-class's) locks it solid instead: the part-time 4WD's rigid shafts.

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
  type: 'auto',                    // 'auto': torque converter; 'manual': clutch
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
const NO_BREAKS = [false, false, false, false];
const OUT = 4, ENG = 5;
const MAXC = 10;

export class Drivetrain {
  constructor(engine = {}, trans = {}, diffs = {}) {
    this.e = { ...DEFAULT_ENGINE, ...engine };
    this.t = { ...DEFAULT_TRANS, ...trans };
    this.diffs = { front: diffs.front || 'open', rear: diffs.rear || 'open' };
    this.manual = this.t.type === 'manual';
    this.direct = this.t.type === 'direct';
    this.electric = !!this.e.electric;
    let peak = 0;
    for (let rpm = 500; rpm < this.e.redline; rpm += 100) peak = Math.max(peak, torqueAt(this.e.torque, rpm));
    this.clutchCap = 2.2 * peak;     // Nm, clutch fully in
    this.clutch = 0;                 // clutch engagement 0..1 (manual)
    this.running = true;
    this.crankT = 0;                 // starter motor running (s left)
    this.powerMul = 1;               // share of its torque a damaged engine still makes
    this.seized = false;             // won't turn over
    this.broken = null;              // [4] axle shafts snapped (physics/Damage.js)
    this.wheelT = new Float64Array(4);   // Nm each axle shaft carried this substep
    this.lamAcc = new Float64Array(MAXC);
    this.propRear = 0;               // Nm in the rear / front propshafts (torque twist, sounds)
    this.propFront = 0;
    this.outTorque = 0;              // Nm into the transfer case
    this.couple = 0;                 // Nm through the clutch / lockup
    this.lsdIdx = -1;
    this.wEngine = this.electric ? 0 : this.e.idleRpm / RPM;
    this.wOut = 0;
    this.gear = 1;               // -1 reverse, 0 neutral, 1..n
    this.low = false;            // transfer case range
    this.drive = this.t.drive || '4wd';   // part-time 4WD; or a road car's 'rwd' or 'awd' (see the header)
    this.fourWD = this.drive !== 'rwd';
    this.lockCentre = false;     // an AWD's lockable centre diff, locked
    this.lockFront = false;
    this.lockRear = false;
    this.autoLock = false; this.autoT = 0;           // the auto-locker's state (diffs.rear 'auto')
    this.auto = true;            // automatic shifting
    this.lockupOn = false;
    this.shiftT = 0;
    this.upT = 0;                // a dual-clutch upshift's ignition cut (s left)
    this.launching = false;      // a road car's launch control at work
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
    const dctUp = this.t.dct && g > this.gear && this.gear > 0;
    if (dctUp) this.upT = 0.4;
    this.gear = g;
    this.shiftT = dctUp ? 0 : this.t.shiftTime;
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
    // (rear-wheel drive has no front axle to engage, all-wheel drive none to let go: only part-time 4WD shifts)
    if (this.drive !== '4wd') return on === this.fourWD;
    if (on === this.fourWD) return true;
    if (on && Math.abs(speed) > 20) return false;
    this.fourWD = on;
    return true;
  }

  /** Lock or free an all-wheel drive's centre diff (false if it can't be locked, or when too fast to lock it). */
  setCentreLock(on, speed) {
    if (on && (this.drive !== 'awd' || !this.t.centreLock || Math.abs(speed) > 8)) return false;
    this.lockCentre = on;
    return true;
  }

  /** Engage or release a locker; false if that axle has none, or when too fast to engage. */
  setLocker(axle, on, speed) {
    if (on && (this.diffs[axle] !== 'locker' || Math.abs(speed) > 8)) return false;
    if (axle === 'front') this.lockFront = on; else this.lockRear = on;
    return true;
  }

  /** The revs a road car's launch control holds while its clutch slips (where its engine makes its torque). */
  launchRpm(throttle) {
    if (this._launch === undefined) {
      const e = this.e, peak = Math.max(...e.torque.map((q) => q[1]));
      // the lowest revs with nine tenths of the peak torque, but no less than 3,000
      this._launch = Math.max(3000, e.torque.find((q) => q[1] >= 0.9 * peak)?.[0] ?? 3000);
    }
    return this.e.idleRpm + (this._launch - this.e.idleRpm) * throttle;
  }

  /** The gear an automatic shift starts in: second in high range with a granny-low first (not a road car's short one). */
  get firstGear() { return !this.low && !this.t.road && this.t.gears[0] > 4 && this.t.gears.length > 3 ? 2 : 1; }

  /** Stall the engine (water in the intake). */
  stall() { this.running = false; this.crankT = 0; this.lockupOn = false; }

  /** Crank it over; it runs after the starter has turned it for a moment (an electric truck: at once). */
  start() {
    if (this.running || this.seized) return;
    if (this.electric) { this.running = true; this.crankT = 0; return; }
    if (this.crankT <= 0) this.crankT = 0.75;
  }

  /** Automatic shift logic, run every substep. thr: driver throttle 0..1. */
  autoShift(dt, thrIn, wheels) {
    // the shift schedule follows a smoothed throttle (as a governor / throttle-valve cable would), and waits a moment
    // after each shift, so the box doesn't hunt between two gears
    this.thrS = (this.thrS ?? thrIn) + (thrIn - (this.thrS ?? thrIn)) * Math.min(1, dt / 0.6);
    this.sinceShift = (this.sinceShift || 0) + dt;
    // how fast the truck gains or loses speed (a share of its speed per second, smoothed)
    const wNow = Math.abs(this.wOut), wWas = this.wWas ?? wNow;
    this.wWas = wNow;
    this.aRel = (this.aRel || 0) + ((wNow - wWas) / dt / Math.max(wNow, 5) - (this.aRel || 0)) * Math.min(1, dt / 0.5);
    const thr = Math.max(this.thrS, thrIn > 0.95 ? thrIn : 0);          // floored throttle: kickdown at once
    if (this.shiftT > 0) { this.shiftT = Math.max(0, this.shiftT - dt); return; }
    if (!this.auto || this.gear <= 0) return;
    if (this.gear < this.firstGear) { this.gear = this.firstGear; return; }
    const n = this.t.gears.length;
    const turbineRpm = (g) => this.wOut * this.t.gears[g - 1] * RPM;
    // what the truck makes over the ground, as the ABS wheel sensors tell the gearbox (the slowest wheel): wheels
    // spinning in place on a climb don't upshift it out of the gear it needs
    let wRef = Math.abs(this.wOut);
    if (wheels) for (const w of wheels) wRef = Math.min(wRef, Math.abs(w.omega) * this.axleGear);
    const groundRpm = (g) => wRef * this.t.gears[g - 1] * RPM;
    // crawling in low range off the throttle (a steep way down): hold the gear and drop to first for the engine to
    // hold the truck back, as a driver puts the selector in 1
    if (this.low && thrIn < 0.05) {
      if (this.gear > this.firstGear && this.sinceShift > 0.6 && turbineRpm(this.gear - 1) < this.e.redline - 400) {
        this.gear--; this.shiftT = this.t.shiftTime * (this.manual ? 1.1 : 0.8); this.lockupOn = false; this.sinceShift = 0;
      }
      return;
    }
    if (this.sinceShift < 0.9) return;
    // upshift from ~1800 rpm cruising to just under the redline flat out; downshift well below (the ratio step)
    const top = this.e.redline - 150, light = this.low ? 2100 : 1750;
    const up = light + (top - light) * thr;
    const down = (this.low ? 900 : 1000) + (top * 0.55 - 1000) * thr;
    const shiftTime = this.t.shiftTime * (this.manual ? 1.4 : 1);
    // a modern automatic (six speeds or more) reads the grade: it doesn't shift up while the truck slows under power
    const modern = !this.manual && n >= 6, climbing = modern && thr > 0.1 && this.aRel < -0.04;
    if (this.gear < n && turbineRpm(this.gear) > up && groundRpm(this.gear) > up - 300 && !climbing) {
      // (a dual-clutch box's next clutch takes the drive over at once: no gap, only the revs to bring down)
      this.gear++; this.shiftT = this.t.dct ? 0 : shiftTime; this.lockupOn = false; this.sinceShift = 0;
      if (this.t.dct) this.upT = 0.4;
    } else if (this.gear > this.firstGear && turbineRpm(this.gear) < down && turbineRpm(this.gear - 1) < up - 500) {
      // (and skips straight down to the gear the speed wants)
      let g = this.gear - 1;
      if (modern) while (g > this.firstGear && turbineRpm(g) < down && turbineRpm(g - 1) < up - 500) g--;
      this.gear = g; this.shiftT = shiftTime * 0.8; this.lockupOn = false; this.sinceShift = 0;
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
    // (input.declutch: the clutch held down, or an automatic slipped into neutral, whatever gear it shows)
    const g = input.declutch ? 0 : this.gearRatio;
    const G = this.axleGear;
    // (the gearbox shifts by the driver's pedal, not by what the traction control lets through to the engine)
    this.autoShift(dt, input.pedal ?? input.throttle, wheels);

    // ---- engine: idle governor, rev limiter, net torque (or the starter, when it isn't running)
    const rpm = this.wEngine * RPM;
    let Teng;
    if (this.running && this.electric) {
      // the motors: their torque at the speed they turn (either way), cut above the top speed; off the throttle the
      // regeneration brakes them; out of gear, nothing
      if (Math.abs(rpm) > e.limiter) this.limiterCut = true; else if (Math.abs(rpm) < e.redline) this.limiterCut = false;
      const thr = this.limiterCut || g === 0 ? 0 : input.throttle;
      this.throttle = thr;
      const regen = e.friction[0] * Math.sign(rpm) + e.friction[1] * rpm;
      Teng = g === 0 ? -0.5 * this.wEngine : thr * torqueAt(e.torque, Math.max(e.torque[0][0], Math.abs(rpm))) * this.powerMul - (1 - thr) * regen;
    } else if (this.running) {
      const err = (e.idleRpm - rpm) / e.idleRpm;
      this.idleI = clamp(this.idleI + err * dt * 2.5, -0.1, 0.25);
      const idleThr = clamp(0.03 + err * 3 + this.idleI, 0, 0.4);
      if (rpm > e.limiter) this.limiterCut = true; else if (rpm < e.redline) this.limiterCut = false;
      let thr = Math.max(input.throttle, idleThr);
      if (this.limiterCut) thr = 0;
      // (a dual-clutch upshift: no spark until the engine is down to the new gear's speed)
      if (this.upT > 0) { this.upT -= dt; if (rpm > Math.abs(this.wOut * this.gearRatio * RPM) + 250) thr = 0; else this.upT = 0; }
      this.throttle = thr;
      const fric = e.friction[0] + e.friction[1] * rpm;
      Teng = thr * torqueAt(e.torque, rpm) * this.powerMul - (1 - thr) * fric;
    } else {
      this.throttle = 0; this.idleI = 0;
      Teng = -(e.friction[0] + e.friction[1] * rpm) * Math.tanh(this.wEngine / 4);
      if (this.crankT > 0) {
        Teng += 75 * Math.max(0, 1 - rpm / 260);                       // the starter turns it at ~200 rpm
        this.crankT -= dt;
        if (this.crankT <= 0) { this.running = true; this.crankT = 0; }
      }
    }
    this.engineTorque = Teng;

    // ---- manual: the automatic clutch (see the header)
    if (this.manual) {
      const inRpm = this.wOut * g * RPM;                               // gearbox input shaft
      let target = 0;
      if (g !== 0 && this.shiftT === 0 && this.running) {
        this.launching = input.throttle > 0.02 && this.t.road && Math.abs(inRpm) < this.launchRpm(input.throttle) - 200;
        if (this.launching) {
          // a road car's launch control: the clutch in, but slipping, carrying the engine's own torque (so a cut in it,
          // the traction control's, reaches the tyres) and a little more above its launch revs, less below them, to
          // hold it there until the car has caught up with them (see the clutch's bound below)
          target = 1;
        } else if (input.throttle > 0.02) {
          const launch = e.idleRpm + 400 + 1600 * input.throttle;
          target = smoothstep(e.idleRpm + 50, launch, rpm);
          if (this.clutch > 0.98 && Math.abs(inRpm) > e.idleRpm * 0.85) target = 1;
          if (this.t.road && Math.abs(inRpm) >= this.launchRpm(input.throttle) - 200) target = 1;
        } else if (Math.abs(inRpm) > e.idleRpm * 0.8 && rpm > e.idleRpm * 0.6) target = 1;
      }
      // (it bites slowly pulling away; a dual-clutch box's next clutch at once on the move)
      const rate = target > this.clutch ? (this.t.dct && Math.abs(inRpm) > e.idleRpm * 1.5 ? 10 : 3) : 12;
      this.clutch += clamp(target - this.clutch, -rate * dt, rate * dt);
    }

    // ---- torque converter (automatic; not when the lockup clutch carries it, nor in neutral)
    let Tpump = 0, Tturb = 0;
    if (!this.manual && !this.direct && g !== 0 && !this.lockupOn) {
      const wt = this.wOut * g;
      [Tpump, Tturb] = this.converter(this.wEngine, wt);
      if (this.shiftT > t.shiftTime * 0.55) Tturb *= 0.45;           // torque dip while the band changes over
    } else this.tcSlip = 0;
    this.turbineTorque = Tturb;

    // ---- lockup clutch logic (a road car's sports automatic locks up from first gear, flat out too, as soon as the
    // converter has stopped multiplying: it only slips to pull away and to shift)
    const sport = !!this.t.road;
    if (!this.manual && !this.direct && g > 0 && (this.gear >= 2 || sport) && this.shiftT === 0 && this.running) {
      const sr = this.wEngine > 1 ? (this.wOut * g) / this.wEngine : 0;
      const turb = this.wOut * g * RPM;
      if (!this.lockupOn && sr > (sport ? 0.85 : 0.9) && turb > 1350 && (sport || input.throttle < 0.9)) this.lockupOn = true;
      else if (this.lockupOn && (turb < 1150 || (!sport && input.throttle > 0.97))) this.lockupOn = false;
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
    // losses: the driving torque arrives reduced; coasting, the engine sees the wheels' torque reduced the same way.
    // Through a clutch (lockup or manual) the loss is a drag on the output, from the last substep's torque.
    const loss = (1 - eff) * Math.abs(this.couple * g) * Math.tanh(this.wOut * 4);
    v[OUT] = this.wOut + dt * (g * Tturb * (g * Tturb * this.wOut >= 0 ? eff : 1 / eff) - 0.015 * this.wOut - loss) / Iout;
    m[ENG] = e.inertia;
    v[ENG] = this.wEngine + dt * (Teng - Tpump) / e.inertia;

    // ---- constraints
    const J = this.J, bound = this.bound;
    J.fill(0);
    let n = 0;
    // an axle drives through its diff; a snapped shaft lets its wheel turn free. Then an open (or limited-slip)
    // diff's side gear spins with no load, so neither wheel gets torque; a locked one still drives the other wheel.
    const B = this.broken || NO_BREAKS;
    const axle = (l, r, locked) => {
      if (!B[l] && !B[r]) { J[n * NB + l] = G / 2; J[n * NB + r] = G / 2; J[n * NB + OUT] = -1; bound[n] = Infinity; return n++; }
      if (!locked || (B[l] && B[r])) return -1;
      const k = B[l] ? r : l;
      J[n * NB + k] = G; J[n * NB + OUT] = -1; bound[n] = Infinity; return n++;
    };
    // the mechanical auto-locker: flyweights lock it when one rear wheel spins ~100 rpm faster than the other below
    // about 30 km/h (the wheels' 22 rad/s); then it stays locked while it drives, and frees itself when the torque
    // comes off (lift off, or the wheels' own speeds pull apart turning) or above that speed
    if (this.diffs.rear === 'auto') {
      const wl = wheels[2].omega, wr = wheels[3].omega, avg = Math.abs(wl + wr) / 2;
      if (!this.autoLock) {
        if (Math.abs(wl - wr) > 10.5 && avg < 22) { this.autoLock = true; this.autoT = 0; }
      } else {
        this.autoT = Math.abs(this.propRear) < 150 ? this.autoT + dt : 0;
        if (this.autoT > 0.3 || avg > 24) this.autoLock = false;
      }
    } else this.autoLock = false;
    const lockR = this.lockRear || this.autoLock;
    // rear axle (the gearbox output turns with the rear propshaft), front axle in 4WD; or an all-wheel drive's centre
    // diff and its coupling (with a shaft snapped, or the centre locked: the axles rigidly, as part-time 4WD)
    let iRear = -1, iFront = -1, iCentre = -1, iCouple = -1;
    const split = this.t.split ?? 0.4;
    if (this.drive === 'awd' && !this.lockCentre && !B[0] && !B[1] && !B[2] && !B[3]) {
      const g2 = G / 2;
      J[n * NB + 0] = g2 * split; J[n * NB + 1] = g2 * split; J[n * NB + 2] = g2 * (1 - split); J[n * NB + 3] = g2 * (1 - split);
      J[n * NB + OUT] = -1; bound[n] = Infinity; iCentre = n++;
      const [pre, k] = this.t.centre || [200, 0.3];
      J[n * NB + 0] = 0.5; J[n * NB + 1] = 0.5; J[n * NB + 2] = -0.5; J[n * NB + 3] = -0.5;
      bound[n] = (pre + k * Math.abs(this.outTorque * G)) * dt; iCouple = n++;
    } else {
      iRear = axle(2, 3, lockR);
      iFront = this.fourWD ? axle(0, 1, this.lockFront) : -1;
    }
    if (!B[2] && !B[3]) {
      if (lockR) { J[n * NB + 2] = 1; J[n * NB + 3] = -1; bound[n] = Infinity; n++; } else if (this.diffs.rear === 'lsd') {
        J[n * NB + 2] = 1; J[n * NB + 3] = -1; bound[n] = (100 + 0.45 * Math.abs(this.propRear * t.axle)) * dt; n++;
      }
    }
    if (this.lockFront && !B[0] && !B[1]) { J[n * NB + 0] = 1; J[n * NB + 1] = -1; bound[n] = Infinity; n++; }
    const nDrive = n;
    let ic = -1;
    if (this.lockupOn) { ic = n; J[n * NB + ENG] = 1; J[n * NB + OUT] = -g; bound[n] = t.lockup * dt; n++; }
    if (this.manual && g !== 0 && this.clutch > 0.001) {
      // (a dual-clutch upshift's clutch carries about the engine's own torque while it pulls the revs down; a launch,
      // what the engine makes, more above the launch revs and less below)
      let cap = this.upT > 0 ? Math.min(this.clutchCap, 1.1 * torqueAt(e.torque, rpm)) : this.clutchCap;
      if (this.launching) { const L = this.launchRpm(input.throttle); cap = Math.min(cap, Math.max(0, this.throttle * torqueAt(e.torque, rpm) * (1 + 2 * (rpm - L) / L))); }
      ic = n; J[n * NB + ENG] = 1; J[n * NB + OUT] = -g; bound[n] = this.clutch * cap * dt; n++;
    }
    // (electric: the motor geared to the output, rigidly, in gear)
    if (this.direct && g !== 0) { ic = n; J[n * NB + ENG] = 1; J[n * NB + OUT] = -g; bound[n] = Infinity; n++; }
    for (let i = 0; i < 4; i++) {
      const Tb = input.brakeTorque[i];
      if (Tb > 0) { J[n * NB + i] = 1; bound[n] = Tb * dt; n++; }
    }
    this.lamAcc.fill(0, 0, n);
    this.solve(n);
    // torques in the propshafts and through the clutch, and in each axle shaft (an all-wheel drive's: the centre diff's
    // split, and what its coupling moved from one axle to the other)
    const R = this.rangeRatio;
    let lr = iRear >= 0 ? this.lamAcc[iRear] : 0, lf = iFront >= 0 ? this.lamAcc[iFront] : 0;
    if (iCentre >= 0) {
      const lc = this.lamAcc[iCentre], lk = this.lamAcc[iCouple];
      lr = (1 - split) * lc - lk / G; lf = split * lc + lk / G;
    }
    this.propRear = R * lr / dt;
    this.propFront = R * lf / dt;
    this.outTorque = (lr + lf) / dt;
    this.couple = ic >= 0 ? this.lamAcc[ic] / dt : 0;
    for (let i = 0; i < 4; i++) {
      let T = 0;
      for (let r = 0; r < nDrive; r++) T += J[r * NB + i] * this.lamAcc[r];
      this.wheelT[i] = T / dt;
    }

    for (let i = 0; i < 4; i++) wheels[i].omega = v[i];
    this.wOut = v[OUT];
    this.wEngine = this.electric ? v[ENG] : Math.max(v[ENG], this.running ? 300 / RPM : 0);
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
      const system = (give) => {
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
        let d = 0;
        for (let r = 0; r < k; r++) d = Math.max(d, A[r * k + r]);
        for (let r = 0; r < k; r++) A[r * k + r] += give * d;
      };
      system(0);
      let solved = solveDense(A, b, k, x);
      if (!solved) {
        // redundant constraints: braking all four wheels in four-wheel drive, with the engine let go (in neutral, the
        // clutch out, an automatic's converter unlocked), says the same about the shafts as the two diffs do. A touch
        // of give on each lets them share the load and every brake still does its part (dropping one, as below,
        // left a rear wheel unbraked: the truck pulled to one side as it stopped)
        system(1e-7);
        solved = solveDense(A, b, k, x);
      }
      if (!solved) {
        // degenerate (e.g. lockers fighting a locked brake): drop a row that ties two wheels together (a locker or a
        // limited-slip's: with both wheels' brakes holding them it has nothing to add), else the last. (The last is a
        // brake's: dropping it let a braked wheel roll, an H1 in neutral on its handbrake sliding down a slope)
        let drop = idx[k - 1];
        for (let r = 0; r < k; r++) {
          const ir = idx[r] * NB;
          let wheelsIn = 0;
          for (let q = 0; q < 4; q++) if (J[ir + q] !== 0) wheelsIn++;
          if (wheelsIn === 2 && J[ir + OUT] === 0 && J[ir + ENG] === 0) { drop = idx[r]; break; }
        }
        active[drop] = 0;
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
    this.lamAcc[i] += lam;
    const J = this.J, v = this.v, m = this.m, o = i * NB;
    for (let q = 0; q < NB; q++) { const j = J[o + q]; if (j !== 0) v[q] += j * lam / m[q]; }
  }
}
