// Damage: what breaks on an off-road truck, and what that does to it. The physics reports the hits (where on the hull,
// which way, how fast it was closing), the tyres' loads and the drivetrain's shaft torques; this keeps the state and
// the truck reads its effects back.
//
//   body       dents where the hull hit hard enough to bend sheet metal (closing faster than ~8 km/h). Steel bumpers
//              and rock sliders take hits that would crease a fender or a sill.
//   glass      a hit on the roof or the windscreen cracks it, more shatters it (a roll-over does both)
//   lights     a front corner hit breaks that headlamp
//   radiator   a front hit holes it: the coolant runs out over minutes, then the engine overheats, loses power and,
//              driven on, seizes. Stop and it cools.
//   oil pan    a hard hit on the belly with no skid plate cracks the pan: the engine wears out the same way
//   steering   a big hit on a front wheel bends the tie rod: the wheels toe off line and the truck pulls to one side
//   springs    a hard landing cracks the main leaf (that corner sags), and blows the dampers (it bounces)
//   tyres      a sharp rock at speed cuts a sidewall; aired down with a big side load, a tyre comes off the bead
//              (beadlocks hold it). A flat tyre runs on its rim. The truck carries one spare.
//   axles      a wheel with grip and a locker in low range can get more torque than its shaft takes: it snaps. That
//              wheel turns free; with an open diff the whole axle loses drive (4WD gets you home)
//   engine     water in the intake at speed bends a rod (at idle it only stalls); upside down it starves and stops
//
// Effects read by the physics: toe, spring rate and damper factors, flat tyres, broken shafts, engine power.
// The renderer takes the new dents (newDents) and the state for glass, lights, steam and smoke.
//
// How hard things break is the damage level (the game's setting). Realistic: all of the above, as on a real truck.
// Forgiving (the default): it takes a proper crash to break anything, a holed radiator leaks slowly, an overheating or
// leaking engine runs rough and loses power but never seizes, and water in the intake stalls it (only flat out does it
// bend a rod).

const share = (spec) => (spec.mass * 9.81) / 4;

/**
 * Thresholds and rates per level: closing speeds (m/s) that dent panels, crack the glass, break a headlamp, hole the
 * radiator, crack the oil pan, bend a tie rod; leak rates; the suspension peaks (times the corner's share of the
 * weight) that blow a damper and crack a leaf; the odds of a cut or unseated tyre; shaft strength; how fast heat and
 * a lack of oil wear the engine and the least it wears to (limp: it still runs); the revs above which water in the
 * intake bends a rod, and over how many more revs a rod is ruined.
 */
export const DAMAGE_LEVELS = {
  realistic: {
    dent: 2.2, glass: 2.5, lamp: 3.4, radiator: 3.6, leak: 0.16, pan: 2.6, panLeak: 0.05, tieRod: 4.5, toe: 0.004, toeMax: 0.07,
    shock: 13.5, spring: 16, cut: 1, bead: 1, shaft: 1, cook: 0.0025, wear: 0.004, limp: 0, hydro: 1300, hydroSpan: 2200,
  },
  forgiving: {
    dent: 3.6, glass: 4.5, lamp: 5.5, radiator: 7.5, leak: 0.035, pan: 5.5, panLeak: 0.015, tieRod: 9, toe: 0.0012, toeMax: 0.018,
    shock: 19, spring: 24, cut: 0.25, bead: 0.25, shaft: 1.35, cook: 0.0008, wear: 0.0012, limp: 0.4, hydro: 3200, hydroSpan: 6000,
  },
};
export const DAMAGE_LEVEL = 'forgiving';
export const DENT_SPEED = DAMAGE_LEVELS.realistic.dent;          // m/s closing speed that starts to dent panels (realistic)

export class Damage {
  constructor(spec, level = DAMAGE_LEVEL) {
    this.spec = spec;
    this.setLevel(level);
    this.reset();
  }

  /** How hard things break: 'forgiving' or 'realistic' (see DAMAGE_LEVELS). */
  setLevel(level) {
    this.level = DAMAGE_LEVELS[level] ? level : DAMAGE_LEVEL;
    this.k = DAMAGE_LEVELS[this.level];
  }

  reset() {
    this.body = 0;
    this.dents = [];                    // the latest dents: { p: [x,y,z], d: [x,y,z], depth, r } (CG frame)
    this.dentCount = 0;                 // dents ever (the room's copies apply the ones they haven't)
    this.newDents = [];                 // dents the renderer hasn't applied yet
    this.glass = 0;                     // 0 whole .. 1 cracked .. 2 shattered
    this.lights = [1, 1];               // headlamps left, right
    this.radiator = 0;                  // leak: share of the coolant lost per minute
    this.coolant = 1;
    this.temp = 88;                     // coolant temperature (°C)
    this.oil = 0;                       // oil leak (cracked pan): engine wear per minute of running
    this.engine = 1;                    // health: 1 sound, 0 seized
    this.toe = 0;                       // rad, + steers left: the tie rod knocked out of line
    this.springs = [0, 0, 0, 0];        // 0 sound .. 1 main leaf broken
    this.shocks = [0, 0, 0, 0];         // 0 sound .. 1 blown
    this.flat = [false, false, false, false];
    this.spare = true;
    this.shafts = [false, false, false, false];
    this.upside = 0;                    // s upside down with the engine running
    this.messages = [];                 // for the HUD
    this.version = 0;                   // changes whenever something breaks or is mended (for the network)
    this._last = new Map();             // hull point -> [time, speed] of its last dent
    this._shaftT = [0, 0, 0, 0];
    this._susPeak = [0, 0, 0, 0];
  }

  say(text, kind = 'warn') { this.messages.push({ text, kind }); this.version++; }

  /** Where a point (CG frame) is on the truck, in the design frame (origin on the ground mid-wheelbase). */
  design(p) { const s = this.spec; return [p.x, p.y + s.cgHeight - (s.raise || 0), p.z + (s.cgZ || 0)]; }

  /**
   * A hit on the hull at local point p (CG frame), pushed along local direction n (out of the obstacle, into the
   * truck), closing at speed v (m/s). key: which hull point (to count one hit once). t: the physics clock.
   */
  hit(p, n, v, key, t, what = 'ground') {
    const k = this.k;
    if (v < k.dent) return;
    const last = this._last.get(key);
    if (last && t - last[0] < 0.35 && v < last[1] * 1.3) return;
    this._last.set(key, [t, v]);
    const s = this.spec, [x, y, z] = this.design(p);
    const front = z > s.noseZ - 0.4, rear = z < -(s.noseZ + 0.2), belly = y < 0.5 && !front && !rear;
    const roof = y > s.roofY - 0.25, belt = (s.roofY + 0.6) / 2;
    // the frame and the bumpers are thick steel; sliders guard the sills
    let tough = 1;
    if (belly) tough = 3;
    else if ((front || rear) && y < 0.75) tough = 1.6;
    else if (s.sliders && y < 0.65) tough = 2.5;
    const over = v / tough - k.dent;
    if (over > 0 && !belly) {
      const depth = Math.min(0.2, 0.03 * Math.pow(over, 1.15)), r = 0.32 + 0.05 * v;
      const dent = { p: [p.x, p.y, p.z], d: [n.x, n.y, n.z], depth, r };
      this.dents.push(dent);
      this.dentCount++;
      if (this.dents.length > 60) this.dents.shift();
      this.newDents.push(dent);
      this.body = Math.min(1, this.body + depth * 1.6);
      this.version++;
    }
    // glass: the roof and the windscreen pillars, and the cab twisting in a roll-over
    if ((roof || (y > belt && z > s.cabZ - 0.5)) && v > k.glass) {
      const was = this.glass;
      this.glass = Math.min(2, this.glass + (v - k.glass) * 0.3);
      if (was < 0.35 && this.glass >= 0.35) this.say('Windscreen cracked');
      if (was < 1.6 && this.glass >= 1.6) { this.glass = 2; this.say('Windows smashed'); }
    }
    if (front && y > 0.55 && y < 1.3) {
      // headlamps on the corners, the radiator behind the grille
      const side = x > 0 ? 0 : 1;
      if (Math.abs(x) > 0.35 && v > k.lamp && this.lights[side]) { this.lights[side] = 0; this.say(`${side ? 'Right' : 'Left'} headlamp smashed`); }
      if (Math.abs(x) < 0.7 && v > k.radiator) {
        const was = this.radiator;
        this.radiator = Math.min(1.5, this.radiator + (v - k.radiator) * k.leak);
        if (!was && this.radiator) this.say('Radiator holed: coolant leaking. Watch the temperature', 'bad');
      }
    }
    if (belly && v > k.pan && s.hullFriction >= 0.99) {
      const was = this.oil;
      this.oil = Math.min(1, this.oil + (v - k.pan) * k.panLeak);
      if (!was && this.oil) this.say('Oil pan cracked on a rock: skid plates would have saved it', 'bad');
    }
  }

  /** A front tyre struck from the side or shoved back hard (a tree, a rock): the tie rod bends. side +1 left. */
  steeringHit(side, v) {
    const k = this.k;
    if (v < k.tieRod) return;
    const was = Math.abs(this.toe);
    this.toe = Math.max(-k.toeMax, Math.min(k.toeMax, this.toe + side * (v - k.tieRod) * k.toe));
    if (was < 0.012 && Math.abs(this.toe) >= 0.012) this.say(`Tie rod bent: the truck pulls to the ${this.toe > 0 ? 'left' : 'right'}`);
    this.version++;
  }

  /**
   * Each substep, for each tyre i: its load N (N), side force Flat (N), forward speed over the ground vx (m/s), the
   * surface, the tyre (pressure psi, beadlock, tread), whether it is on a boulder.
   */
  tyreLoad(i, N, Flat, vx, surf, tyre, psi, onRock, t) {
    if (this.flat[i]) return;
    const r = N / share(this.spec);
    // a sharp rock hit at speed can cut the sidewall (once per hit: not again for half a second)
    if (onRock && r > 4 && Math.abs(vx) > 4 && t - (this._cutAt?.[i] ?? -1) > 0.5) {
      (this._cutAt || (this._cutAt = []))[i] = t;
      if (Math.random() < Math.min(0.25, (r - 4) * 0.03) * (tyre.tread === 'mt' || tyre.tread === 'mud' ? 0.5 : 1) * this.k.cut) this.goFlat(i, 'cut by a rock');
    }
    // aired down and pushed sideways, a tyre without beadlocks comes off its bead
    if (!tyre.beadlock && psi < 16 && N > 1000) {
      const q = Math.abs(Flat) / N;
      if (q > 0.62 && Math.random() < (q - 0.62) * (16 - psi) * 0.0016 * this.k.bead) this.goFlat(i, 'off the bead');
    }
  }

  /**
   * The suspension load at corner i (spring and bump stop, N) each substep. What breaks goes by the peak of each hit
   * (in times that corner's share of the weight): bottoming out on a rough trail is what bump stops are for; a landing
   * like a metre-and-a-half drop blows the damper, harder still cracks the main leaf.
   */
  suspension(i, F) {
    const r = F / share(this.spec);
    if (r > 8) { if (r > this._susPeak[i]) this._susPeak[i] = r; return; }
    const peak = this._susPeak[i];
    if (!peak) return;
    this._susPeak[i] = 0;
    const k = this.k;
    if (peak > k.shock) { this.shocks[i] = Math.min(1, this.shocks[i] + (peak - k.shock) * 0.12); this.version++; }
    if (peak > k.spring) {
      const was = this.springs[i];
      this.springs[i] = Math.min(1, this.springs[i] + (peak - k.spring) * 0.18);
      if (was < 1 && this.springs[i] >= 1) this.say(`${CORNER[i]} leaf spring broken: that corner sags`);
    }
  }

  goFlat(i, why) {
    if (this.flat[i]) return;
    this.flat[i] = true;
    this.say(`${CORNER[i]} tyre ${why}: running on the rim. ${this.spare ? 'Stop and press Y to fit the spare' : 'No spare left'}`, 'bad');
  }

  /**
   * Torque (Nm) in each axle shaft this substep. Shafts take a steady crawl; they snap from shock: a tyre spinning
   * (spinning: seconds since it last was) that bites, sending a spike through a shaft that twists for ~50 ms.
   */
  shaftTorque(i, T, strength, spinning, dt) {
    if (this.shafts[i]) return;
    this._shaftT[i] += (Math.abs(T) - this._shaftT[i]) * Math.min(1, dt / 0.05);
    if (this._shaftT[i] > strength * this.k.shaft && spinning < 0.4) {
      this.shafts[i] = true;
      this.say(`${i < 2 ? 'Front' : 'Rear'} axle shaft snapped (${i % 2 ? 'right' : 'left'})${i < 2 ? '' : ': in 2WD the rear won\'t drive. Use 4WD'}`, 'bad');
    }
  }

  /** Water got into the intake at rpm: a bent rod above the level's revs (realistic: ~1300 rpm). */
  hydrolock(rpm) {
    const k = this.k;
    if (rpm < k.hydro) return;
    this.engine = Math.max(0, this.engine - (rpm - k.hydro) / k.hydroSpan);
    this.say(this.engine <= 0 ? 'Water in the engine at speed: a rod is bent. It won\'t turn over: get a tow' : 'Water in the engine: it knocks and has lost power', 'bad');
  }

  /**
   * Once a frame: coolant, temperature, oil, the engine running upside down. drivetrain: physics/Drivetrain.js;
   * load 0..1 (throttle x rpm); up: the truck's up vector y.
   */
  update(dt, dtr, load, upY, waterDepth) {
    const running = dtr.running;
    this.coolant = Math.max(0, this.coolant - this.radiator * dt / 60);
    // coolant temperature: held at ~88 °C by the thermostat while there is coolant to carry the heat away
    const lack = Math.max(0, 0.45 - this.coolant) / 0.45;
    const target = running ? 88 + lack * (35 + 75 * load) : 20;
    this.temp += (target - this.temp) * Math.min(1, dt / (running ? 25 : 70)) + (waterDepth > 0.4 ? -dt * 2 : 0);
    if (!this.hotSaid && this.temp > 112) { this.hotSaid = true; this.say(this.k.limp > 0 ? 'Engine overheating: it is losing power. Stop and let it cool' : 'Engine overheating: stop and let it cool, or it will seize', 'bad'); }
    if (this.temp < 100) this.hotSaid = false;
    if (running) {
      // heat and a lack of oil wear it (forgiving: only down to a limp, rough but running)
      const floor = Math.min(this.engine, this.k.limp);
      if (this.temp > 125) this.engine = Math.max(floor, this.engine - dt * (this.temp - 125) * this.k.cook);
      if (this.oil) this.engine = Math.max(floor, this.engine - dt * this.oil * (0.2 + load) * this.k.wear);
      // upside down: oil and fuel starve and it stops
      this.upside = upY < -0.25 ? this.upside + dt : 0;
      if (this.upside > 1.5) { dtr.stall(); this.upside = 0; this.say('Engine stalled upside down: right the truck and restart it (E)'); }
      if (this.engine <= 0) { dtr.stall(); this.say('Engine seized: it needs a tow to the station', 'bad'); }
    }
  }

  /** How much of its torque the engine still makes. */
  get power() {
    const hot = this.temp > 118 ? Math.max(0.45, 1 - (this.temp - 118) / 18) : 1;
    return Math.min(1, 0.25 + 0.75 * Math.sqrt(Math.max(0, this.engine))) * hot;
  }

  get seized() { return this.engine <= 0; }

  /** Is anything broken (for the HUD and the repair button)? */
  get any() {
    return this.body > 0.02 || this.glass > 0.3 || !this.lights[0] || !this.lights[1] || this.radiator > 0 || this.oil > 0
      || this.engine < 0.999 || Math.abs(this.toe) > 0.005 || this.springs.some((v) => v > 0.05) || this.shocks.some((v) => v > 0.1)
      || this.flat.some(Boolean) || !this.spare || this.shafts.some(Boolean) || this.coolant < 0.98;
  }

  /** The repair bill, roughly what parts and a mechanic's day cost (for the shop). */
  get cost() {
    let c = this.body * 1800 + (this.glass > 0.3 ? (this.glass >= 2 ? 450 : 250) : 0) + (2 - this.lights[0] - this.lights[1]) * 90;
    c += this.radiator > 0 ? 420 : 0; c += this.oil > 0 ? 260 : 0; c += (1 - this.engine) * 4200;
    c += Math.abs(this.toe) > 0.005 ? 180 : 0;
    c += this.springs.reduce((a, v) => a + (v > 0.05 ? 160 + v * 200 : 0), 0) + this.shocks.reduce((a, v) => a + (v > 0.1 ? 90 : 0), 0);
    c += this.flat.reduce((a, f) => a + (f ? 240 : 0), 0) + (this.spare ? 0 : 240);
    c += this.shafts.reduce((a, b) => a + (b ? 380 : 0), 0);
    return Math.round(c / 10) * 10;
  }

  /** Fit the spare to tyre i (it must be flat, and there must be a spare). */
  fitSpare(i) {
    if (!this.spare || !this.flat[i]) return false;
    this.spare = false;
    this.flat[i] = false;
    this.version++;
    this.say(`Spare fitted (${CORNER[i].toLowerCase()})`, 'good');
    return true;
  }

  /** Everything mended (the station's workshop). */
  repairAll() {
    const v = this.version;
    this.reset();
    this.version = v + 1;
    this.repaired = true;
  }

  /** A compact summary for the other players' view of this truck. */
  summary() {
    return {
      v: this.version, n: this.dentCount, g: Math.round(this.glass * 10) / 10, l: this.lights[0] + this.lights[1] * 2,
      f: this.flat.reduce((m, f, i) => m | (f ? 1 << i : 0), 0),
      s: this.radiator > 0 && this.coolant > 0.02 ? (this.temp > 112 ? 2 : 1) : this.temp > 112 ? 2 : 0,
      k: Math.round((1 - this.engine) * 10) / 10, t: Math.round(this.toe * 1000) / 1000,
      d: this.dents.slice(-16).map((d) => [...d.p, ...d.d, d.depth, d.r].map((x) => Math.round(x * 1000) / 1000)),
    };
  }
}

export const CORNER = ['Front left', 'Front right', 'Rear left', 'Rear right'];
