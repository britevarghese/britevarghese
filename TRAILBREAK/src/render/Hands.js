// The driver's hands on the steering wheel (pure: render/Driver.js draws them, the tests drive them).
//
// Each hand holds the rim at a grip (an angle round the rim, in the wheel's own turning frame) and turns with the wheel
// while that stays within reach of its shoulder; past that it lets go and takes the rim again further back while the
// other hand holds on: hand over hand, one hand always on the wheel. Driving straight again, they go back to ten to
// two, one at a time. A wheel spun faster than hands can take hold again (a keyboard's quick lock, crawling) slides
// round under them.
//
// Angles are round the wheel as its frame has them: 0 on the driver's left (nine o'clock), pi/2 at the top.

/** Where the hands rest: ten to two (left, right). */
export const REST = [0.5, Math.PI - 0.5];
/** How far (rad) either side of its rest a hand keeps hold; past REACH_MAX it lets go even if the other hand is off. */
export const REACH = 1.15, REACH_MAX = 1.9;
/** Seconds from letting go to holding again; of a steady wheel before the hands go back to rest. */
export const GRIP_T = 0.22, SETTLE = 0.8;
/** rad/s: a wheel turning faster slides round under the hands. */
export const SLIDE = 7;

const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
const ease = (t) => t * t * (3 - 2 * t);

export class Hands {
  constructor() {
    /** Each hand: at (rad round the rim, where it is now), lift (0 holding .. 1 in the air), on (holding). */
    this.hands = REST.map((r) => ({ grip: r, on: true, t: 1, from: r, at: r, lift: 0 }));
    this.wheel = 0;
    this.still = 0;
  }

  /** The wheel turned to `wheel` (rad about its column), `dt` s since the last call. */
  update(wheel, dt) {
    const spin = dt > 0 ? Math.abs(wheel - this.wheel) / dt : 0;
    this.still = spin > 0.3 ? 0 : this.still + dt;
    this.wheel = wheel;
    // (a hand in the air is quicker the faster the wheel turns: it never misses more than 0.6 rad of it)
    const rate = Math.max(1 / GRIP_T, spin / 0.6);
    this.hands.forEach((h, i) => {
      const other = this.hands[1 - i];
      if (h.on) {
        h.at = h.grip + wheel;
        h.lift = 0;
        const dev = wrap(h.at - REST[i]);
        if (spin > SLIDE && Math.abs(dev) > REACH) {
          // spun too fast to take hold again: the rim slides through the hand, at the end of its reach
          h.at = REST[i] + Math.sign(dev) * REACH;
          h.grip = h.at - wheel;
          return;
        }
        // past its reach: take the rim again behind the rest, ready to pull it round further; or, the wheel steady,
        // back at the rest
        if ((Math.abs(dev) > REACH && other.on) || Math.abs(dev) > REACH_MAX) this.regrip(h, REST[i] - Math.sign(dev) * REACH * 0.6);
        else if (this.still > SETTLE && Math.abs(dev) > 0.2 && other.on) this.regrip(h, REST[i]);
        return;
      }
      // in the air: from where it let go to its new grip (which turns with the wheel meanwhile)
      h.t = Math.min(1, h.t + dt * rate);
      h.at = h.from + wrap(h.grip + wheel - h.from) * ease(h.t);
      h.lift = Math.sin(Math.PI * h.t);
      if (h.t >= 1) { h.on = true; h.at = h.grip + wheel; h.lift = 0; }
    });
  }

  /** Let go, to hold the rim again at `target` (rad round the rim, as it is now). */
  regrip(h, target) {
    h.on = false;
    h.t = 0;
    h.from = h.at;
    h.grip = target - this.wheel;
  }
}
