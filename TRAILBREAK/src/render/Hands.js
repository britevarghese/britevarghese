// The driver's hands on the steering wheel (pure: render/Person.js and render/Driver.js draw them, the tests drive them).
//
// Push-pull steering, as driving schools teach it: each hand holds the rim at a grip (an angle round the rim, in the
// wheel's own turning frame) and turns with the wheel while that stays within reach of its side; past that it lets go
// and takes the rim again further back while the other hand holds on, so one hand is always on the wheel and the arms
// never cross over the top of it (filling the view from the driver's seat). Driving straight again, they go back to a
// quarter to three, one at a time. A wheel spun faster than hands can take hold again (a player's own steering wheel
// spun hard) slides round under them.
//
// Keys and sticks turn the front wheels far quicker than any hands could turn a real steering wheel (the whole lock
// in a fifth of a second, crawling): drawn that fast the wheel would spin by five turns a second under hands that
// can't keep up. So the steering wheel drawn for them (HandTurn) is turned as hands turn one: toward where the front
// wheels point, getting going and stopping as a driver's arms do, never faster than a quick shuffle round the rim.
//
// Angles are round the wheel as its frame has them: 0 on the driver's left (nine o'clock), pi/2 at the top.

/** Where the hands rest: a quarter to three, a little above the middle of the wheel (left, right). */
export const REST = [0.17, Math.PI - 0.17];
/** How far (rad) either side of its rest a hand keeps hold; past REACH_MAX going up the rim (at the top), or
 * REACH_DOWN pulling it down (a little past the bottom), it lets go even if the other hand is off. */
export const REACH = 0.9, REACH_MAX = 1.4, REACH_DOWN = 2;
/** Seconds from letting go to holding again; of a steady wheel before the hands go back to rest. */
export const GRIP_T = 0.22, SETTLE = 0.8;
/** s: the quickest a hand lets go and holds again. */
export const FLIGHT_MIN = 0.07;
/** rad/s: a wheel turning faster slides round under the hands. */
export const SLIDE = 11;
/** rad/s and rad/s^2: the fastest a driver's hands turn a steering wheel (a quick push-pull shuffle, 1.4 turns a
 * second), and how hard their arms get it going and stop it. */
export const TURN_MAX = 9, TURN_ACC = 70;
/** rad: how far the drawn steering wheel turns at full lock for keys and sticks (0.64 of a turn each way: a quick
 * steering box, so it gets there not long after the front wheels do). */
export const WHEEL_LOCK = 4;

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const ease = (t) => t * t * (3 - 2 * t);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** The steering wheel as the driver's hands turn it, toward where the steering asks (rad about its column). */
export class HandTurn {
  constructor() { this.a = 0; this.v = 0; this.set = false; }

  /** Toward `target`, dt s on (no dt: there at once, a truck just drawn or posed). */
  to(target, dt) {
    if (!this.set || dt === undefined) { this.set = true; this.a = target; this.v = 0; return this.a; }
    if (!(dt > 0)) return this.a;
    const e = target - this.a;
    // the speed that stops it on the target, braking as hard as the arms can; close in, in proportion to how far off
    const want = Math.sign(e) * Math.min(TURN_MAX, Math.sqrt(2 * TURN_ACC * Math.abs(e)), Math.abs(e) * 14);
    this.v += clamp(want - this.v, -TURN_ACC * dt, TURN_ACC * dt);
    const step = this.v * dt;
    if (step * e > 0 && Math.abs(step) >= Math.abs(e)) { this.a = target; this.v = 0; } else this.a += step;
    return this.a;
  }
}

export class Hands {
  constructor() {
    /** Each hand: at (rad round the rim, where it is now), lift (0 holding .. 1 in the air), on (holding). */
    this.hands = REST.map((r) => ({ grip: r, on: true, t: 1, from: r, at: r, lift: 0 }));
    this.wheel = 0;
    this.still = 0;
  }

  /** The wheel turned to `wheel` (rad about its column), `dt` s since the last call (none: posed there at once). */
  update(wheel, dt) {
    if (dt === undefined) {
      // (posed, not turned: holding it at a quarter to three)
      this.wheel = wheel; this.still = 0;
      this.hands.forEach((h, i) => Object.assign(h, { grip: REST[i] - wheel, on: true, t: 1, from: REST[i], at: REST[i], lift: 0 }));
      return;
    }
    const turn = wheel - this.wheel, spin = dt > 0 ? Math.abs(turn) / dt : 0;
    this.still = spin > 0.3 ? 0 : this.still + dt;
    this.wheel = wheel;
    // each hand holding: how far round from its rest, whether that is up its side of the rim (the left hand
    // clockwise, the right one anticlockwise), and so how far it may go on holding: to the top (any further and the
    // arms cross), or a little past the bottom
    const st = this.hands.map((h, i) => {
      const dev = h.on ? wrap(h.grip + wheel - REST[i]) : 0, up = (i === 0) === (dev > 0);
      return { dev, up, max: up ? REACH_MAX : REACH_DOWN };
    });
    this.hands.forEach((h, i) => {
      const other = this.hands[1 - i], s = st[i], o = st[1 - i];
      if (h.on) {
        h.at = h.grip + wheel;
        h.lift = 0;
        const dev = s.dev;
        if (spin > SLIDE && Math.abs(dev) > REACH) {
          // spun too fast to take hold again: the rim slides through the hand, at the end of its reach
          h.at = REST[i] + Math.sign(dev) * REACH;
          h.grip = h.at - wheel;
          return;
        }
        // past its reach: take the rim again behind the rest, ready to turn it on further, while the other hand holds;
        // both past it at once (a big turn begun with both at the rest), the one going up the rim first, while the
        // other pulls it on down; or, the wheel steady, back at the rest
        const wait = other.on && Math.abs(o.dev) > REACH && o.up && !s.up;
        if ((Math.abs(dev) > REACH && other.on && !wait) || Math.abs(dev) > s.max) this.regrip(h, REST[i] - Math.sign(dev) * REACH);
        else if (this.still > SETTLE && Math.abs(dev) > 0.2 && other.on) this.regrip(h, REST[i]);
        return;
      }
      // in the air: from where it let go to its new grip (which turns with the wheel meanwhile); the quicker the faster
      // the wheel turns, to hold again before the other hand is past its furthest reach (and missing no more than 0.9
      // rad of the wheel)
      // (what is left of the way, in the time the wheel takes to turn that far: set as it lets go, quicker if the wheel
      // gets quicker)
      const left = clamp((other.on ? o.max - Math.abs(o.dev) : 0.9) - 0.05, 0.05, 0.9);
      h.rate = Math.min(1 / FLIGHT_MIN, Math.max(h.rate || 0, 1 / GRIP_T, (1 - h.t) * spin / left));
      // (the wheel turned back meanwhile, carrying the new grip out of reach: it reaches for the rim within reach)
      const land = wrap(h.grip + wheel - REST[i]);
      if (Math.abs(land) > REACH) h.grip = REST[i] + Math.sign(land) * REACH - wheel;
      h.t = Math.min(1, h.t + dt * h.rate);
      h.at = h.from + wrap(h.grip + wheel - h.from) * ease(h.t);
      h.lift = Math.sin(Math.PI * h.t);
      if (h.t >= 1) { h.on = true; h.at = h.grip + wheel; h.lift = 0; }
    });
  }

  /** Let go, to hold the rim again at `target` (rad round the rim, as it is now). */
  regrip(h, target) {
    h.on = false;
    h.t = 0;
    h.rate = 0;
    h.from = h.at;
    h.grip = target - this.wheel;
  }
}
