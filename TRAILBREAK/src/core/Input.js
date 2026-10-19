// Keyboard, gamepad and steering wheel -> driving controls and one-shot actions.
//
// Keys (see index.html's help): W/S throttle/brake, A/D steer, Space handbrake, L range, 4 4WD, X lockers, B sway bar,
// G gearbox mode (Shift/Ctrl shift in manual; a steering wheel's paddles or H-shifter too), F winch hook, E/Q winch
// in/out, R recover, Backspace station, C camera,
// H lights, M map, P tyre pressure, U garage, T call friends for a tow, Y fit the spare, J events, Enter chat, Esc pause,
// F1 help, V voice chat (join; mute; or hold to talk), N the modes and races.

const KEY_ACTIONS = {
  KeyL: 'range', Digit4: '4wd', Numpad4: '4wd', KeyX: 'locks', KeyB: 'sway', KeyG: 'gearMode',
  ShiftLeft: 'shiftUp', ShiftRight: 'shiftUp', ControlLeft: 'shiftDown', ControlRight: 'shiftDown',
  KeyF: 'hook', KeyR: 'recover', Backspace: 'respawn', KeyC: 'camera', KeyH: 'lights', KeyM: 'map',
  Enter: 'chat', Escape: 'pause', F1: 'help', Slash: 'help', KeyP: 'air', KeyU: 'garage', KeyT: 'tow', KeyY: 'spare', KeyJ: 'event',
  KeyV: 'voice', KeyN: 'modes',
};
const WHEEL_RX = /wheel|racing|driving force|\bG2[5-9]\b|\bG9[0-9]{2}\b|DFGT|momo|thrustmaster|\bT1[5-9]0\b|\bT2[0-9]{2}\b|\bT3[0-9]{2}\b|\bTMX\b|T-GT|fanatec|\bCSL\b|clubsport|podium|moza|simucube|simagic|\bPXN\b|cammus|nitho|steering/i;

/**
 * A steering wheel's gear shifters, by button: its paddles (gear up, gear down) and an H-pattern shifter's gates (1st to
 * 6th, then reverse). A wheel the browser maps as a standard pad (Xbox style) has its paddles on the bumpers (RB up, LB
 * down); Logitech's own layout (G29, G920, G923) has the right paddle on button 4, the left on 5 and the shifter's gates
 * on 12-18; Thrustmaster's has the paddles first (0 right, 1 left). Any other wheel, or a player's own choice: set in
 * the settings by pulling the paddle (Input.learn).
 */
export function wheelShifters(pad) {
  const id = (pad.id || '').toLowerCase();
  if (pad.mapping === 'standard') return { up: 5, down: 4, gates: null };
  if (/046d|logitech/.test(id)) return { up: 4, down: 5, gates: [12, 13, 14, 15, 16, 17, 18] };
  if (/044f|thrustmaster/.test(id)) return { up: 0, down: 1, gates: null };
  return { up: 4, down: 5, gates: null };
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.enabled = true;
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, analogSteer: false, winch: 0, lookX: 0, lookY: 0 };
    this.steerKey = 0;
    this.padPrev = {};
    this.device = 'keyboard';
    this.shifters = {};          // a wheel's paddles as the player set them: { [pad id]: { up, down } } (the settings')
    this.learning = null;        // waiting for a button to pull: { which: 'up' | 'down', done }
    this.wheelCal = {};          // a steering wheel's travel as the player calibrated it: { [pad id]: { axis, lo, mid, hi } }
    this.wheelRot = {};          // how far a steering wheel turns lock to lock, as the player set it (degrees): { [pad id]: deg }
    this.calib = null;           // calibrating one (calibrate())
    this.gate = 0;               // the gear an H-pattern shifter's stick is in (-1 reverse, 0 neutral), once it is used
    this.hShifter = false;
    this.mouse = { dx: 0, dy: 0, drag: false, last: 0 };
    this.touch = { steer: 0, throttle: 0, brake: 0, winch: 0 };   // on-screen controls (ui/Touch.js)
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousedown', (e) => { if (e.target.tagName === 'CANVAS') { this.mouse.drag = true; } });
    addEventListener('mouseup', () => { this.mouse.drag = false; });
    addEventListener('mousemove', (e) => { if (this.mouse.drag) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; this.mouse.last = performance.now(); } });
    addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
    // touch: drag on the canvas looks around
    let tp = null;
    addEventListener('touchstart', (e) => { if (e.target.tagName === 'CANVAS' && e.touches.length === 1) tp = [e.touches[0].clientX, e.touches[0].clientY]; }, { passive: true });
    addEventListener('touchmove', (e) => {
      if (!tp || e.touches.length !== 1) return;
      const t = e.touches[0];
      this.mouse.dx += (t.clientX - tp[0]) * 1.5; this.mouse.dy += (t.clientY - tp[1]) * 1.5; this.mouse.last = performance.now();
      tp = [t.clientX, t.clientY];
    }, { passive: true });
    addEventListener('touchend', () => { tp = null; }, { passive: true });
  }

  key(e, isDown) {
    const tag = e.target?.tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && e.code !== 'Escape' && e.code !== 'Enter') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'F1', 'Tab', 'Slash'].includes(e.code) && tag !== 'INPUT') e.preventDefault();
    if (isDown) {
      if (!this.down.has(e.code) && KEY_ACTIONS[e.code]) this.pressed.add(KEY_ACTIONS[e.code]);
      this.down.add(e.code);
      this.device = 'keyboard';
    } else this.down.delete(e.code);
  }

  any(...codes) { for (const c of codes) if (this.down.has(c)) return true; return false; }
  consume(action) { const had = this.pressed.has(action); this.pressed.delete(action); return had; }

  pad() {
    let pads = [];
    try { pads = [...(navigator.getGamepads?.() || [])].filter(Boolean); } catch { /* blocked */ }
    return pads.find((p) => this.wheelCal[p.id]) || pads.find((p) => WHEEL_RX.test(p.id)) || pads[0] || null;
  }

  // (a wheel that passes itself off as an Xbox pad, as many do, is one once the player has calibrated it)
  isWheel(pad) { return !!this.wheelCal[pad.id] || WHEEL_RX.test(pad.id) || pad.mapping !== 'standard'; }

  /** The steering wheel connected (the browser shows one once a button on it is pressed), or null. */
  wheelPad() { const p = this.pad(); return p && this.isWheel(p) ? p : null; }

  /**
   * How far a steering wheel turns lock to lock (degrees): as the player set it, else as its make's usually do (a
   * Logitech, a Thrustmaster, a Fanatec and the direct-drive wheels 900; a wheel the game doesn't know, 270).
   */
  rotationOf(pad) {
    if (this.wheelRot[pad.id]) return this.wheelRot[pad.id];
    return /046d|logitech|044f|thrustmaster|fanatec|moza|simucube|simagic|cammus/i.test(pad.id) ? 900 : 270;
  }

  /** A wheel's steering, -1 (full left) to 1 (full right): over the travel it was calibrated to, else its first axis. */
  wheelSteer(pad) {
    const C = this.wheelCal[pad.id];
    if (!C) return clamp(pad.axes[0] || 0, -1, 1);
    const v = pad.axes[C.axis] || 0;
    return clamp(v >= C.mid ? (v - C.mid) / Math.max(1e-3, C.hi - C.mid) : (v - C.mid) / Math.max(1e-3, C.mid - C.lo), -1, 1);
  }

  /**
   * Calibrate the steering of the controller connected: the player turns it all the way left and right and lets it
   * back to the centre. The axis that moved the most is the steering; its two ends become full lock (a little short of
   * them, so full lock is easy to reach). update({ pos, left, right }) as it goes, done(cal) at the end; cancel() stops.
   */
  calibrate(update, done) { this.calib = { update, done, a0: null, lo: [], hi: [], restT: 0 }; }
  cancelCalibrate() { this.calib = null; }

  calibFrom(pad, dt) {
    const K = this.calib;
    if (!pad) { K.update?.({ none: true }); return; }
    const ax = pad.axes.map((a) => a || 0);
    if (!K.a0) { K.a0 = ax.slice(); K.lo = ax.slice(); K.hi = ax.slice(); }
    ax.forEach((a, i) => { K.lo[i] = Math.min(K.lo[i], a); K.hi[i] = Math.max(K.hi[i], a); });
    let axis = 0;
    ax.forEach((_, i) => { if (K.hi[i] - K.lo[i] > K.hi[axis] - K.lo[axis]) axis = i; });
    const mid = K.a0[axis], v = ax[axis], lo = K.lo[axis], hi = K.hi[axis];
    const left = mid - lo > 0.15, right = hi - mid > 0.15;
    // both ends seen, and the wheel back at the centre a moment: done
    K.restT = left && right && Math.abs(v - mid) < 0.06 * (hi - lo) ? K.restT + Math.min(0.1, dt) : 0;
    K.update?.({ pos: v >= mid ? (v - mid) / Math.max(1e-3, hi - mid) : (v - mid) / Math.max(1e-3, mid - lo), left, right });
    if (K.restT > 0.7) {
      const cal = { axis, mid: v, lo: v + (lo - v) * 0.96, hi: v + (hi - v) * 0.96 };
      this.wheelCal[pad.id] = cal;
      this.calib = null;
      K.done?.(cal, pad);
    }
  }

  /** A wheel's shifters: its layout's, with the paddles the player set. */
  shiftersFor(pad) { return { ...wheelShifters(pad), ...(this.shifters[pad.id] || {}) }; }

  /** Set a paddle: the next button pulled on the wheel shifts up (which 'up') or down; done(button) after. */
  learn(which, done) { this.learning = { which, done, prev: null }; }

  learnFrom(pad) {
    const L = this.learning;
    if (!pad || !this.isWheel(pad)) return;
    const now = pad.buttons.map((b) => !!b?.pressed);
    if (L.prev) {
      const i = now.findIndex((p, k) => p && !L.prev[k]);
      if (i >= 0) {
        const S = this.shiftersFor(pad), other = L.which === 'up' ? 'down' : 'up';
        // (the button the other paddle had: they swap)
        this.shifters[pad.id] = { up: S.up, down: S.down, [L.which]: i, ...(S[other] === i ? { [other]: S[L.which] } : {}) };
        this.padPrev[i] = true;                                    // (not a shift as well)
        this.learning = null;
        L.done?.(i);
        return;
      }
    }
    L.prev = now;
  }

  update(dt) {
    const c = this.controls;
    if (this.learning) this.learnFrom(this.pad());
    if (this.calib) this.calibFrom(this.pad(), dt);
    if (!this.enabled) {
      c.throttle = c.brake = c.steer = c.handbrake = c.winch = 0;
      this.mouse.dx = this.mouse.dy = 0;
      return c;
    }
    let throttle = this.any('KeyW', 'ArrowUp') ? 1 : 0;
    let brake = this.any('KeyS', 'ArrowDown') ? 1 : 0;
    const l = this.any('KeyA', 'ArrowLeft'), r = this.any('KeyD', 'ArrowRight');
    const target = clamp((r ? 1 : 0) - (l ? 1 : 0) + this.touch.steer, -1, 1);
    throttle = Math.max(throttle, this.touch.throttle);
    brake = Math.max(brake, this.touch.brake);
    const rate = target === 0 || Math.sign(target) !== Math.sign(this.steerKey) ? 7 : 3.6;
    this.steerKey += clamp(target - this.steerKey, -rate * dt, rate * dt);
    let steer = this.steerKey;
    let handbrake = this.any('Space') ? 1 : 0;
    let winch = (this.any('KeyE') ? 1 : 0) - (this.any('KeyQ') ? 1 : 0) || this.touch.winch;
    let lookX = 0, lookY = 0, analog = false, turned = null;

    const pad = this.pad();
    if (pad) {
      const wheel = this.isWheel(pad);
      // (a wheel's shifters do nothing else)
      const S = wheel ? this.shiftersFor(pad) : null;
      const free = (i) => !S || (i !== S.up && i !== S.down && !S.gates?.includes(i));
      const press = (i, action) => {
        const p = !!pad.buttons[i]?.pressed;
        if (p && !this.padPrev[i]) { this.pressed.add(action); this.device = wheel ? 'wheel' : 'gamepad'; }
        this.padPrev[i] = p;
      };
      const edge = (i, action) => { if (free(i)) press(i, action); };
      const held = (i) => free(i) && !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] || 0;
      if (wheel) {
        // a wheel: its whole travel is the whole lock, straight (no curve, no dead zone)
        const w = this.wheelSteer(pad);
        if (Math.abs(w) > 0.01) { steer = w; analog = true; }
        // (the steering wheel in the cab turns as the player's own does: as far as their hands turn it)
        turned = w * (this.rotationOf(pad) / 2) * Math.PI / 180;
      } else {
        const s = dz(ax);
        if (s !== 0) { steer = clamp(Math.sign(s) * Math.pow(Math.abs(s), 1.4), -1, 1); this.device = 'gamepad'; }
      }
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt); brake = Math.max(brake, lt);
      if (held(0)) handbrake = 1;
      if (held(5)) winch = 1;
      if (held(4)) winch = -1;
      if (!wheel) { lookX = dz(pad.axes[2] || 0, 0.18); lookY = dz(pad.axes[3] || 0, 0.18); }
      edge(2, 'hook'); edge(3, 'camera'); edge(1, 'recover'); edge(12, 'range'); edge(13, 'locks'); edge(14, '4wd');
      edge(15, 'lights'); edge(9, 'pause'); edge(8, 'map'); edge(11, 'event');
      if (wheel) {
        // the paddles: a gear up or down (an automatic box goes to manual for them: Game)
        press(S.up, 'paddleUp'); press(S.down, 'paddleDown');
        // an H-pattern shifter: the gear its stick is in, out of every gate neutral (once the stick has been used:
        // a wheel without one never presses its gates)
        if (S.gates) {
          let g = 0;
          S.gates.forEach((b, k) => { if (pad.buttons[b]?.pressed) g = k === S.gates.length - 1 ? -1 : k + 1; });
          if (g !== 0) this.hShifter = true;
          if (this.hShifter && g !== this.gate) { this.gate = g; this.pressed.add('gate'); this.device = 'wheel'; }
        }
      }
    }
    c.throttle = throttle; c.brake = brake; c.steer = clamp(steer, -1, 1); c.handbrake = handbrake; c.winch = winch;
    c.analogSteer = analog;
    c.wheelTurn = turned;
    c.lookX = lookX + this.mouse.dx * 0.005; c.lookY = lookY + this.mouse.dy * 0.004;
    c.looking = this.mouse.drag || performance.now() - this.mouse.last < 2500 || Math.abs(lookX) + Math.abs(lookY) > 0.05;
    this.mouse.dx = this.mouse.dy = 0;
    return c;
  }

  endFrame() { this.pressed.clear(); }

  /** Gamepad rumble: the heavy (strong) and light (weak) motors, 0..1, for ms (Chrome and Edge; Firefox's pulse). */
  rumble(strong, weak, ms = 100) {
    const pad = this.pad();
    if (!pad) return;
    const a = pad.vibrationActuator;
    if (a?.playEffect) a.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
    else pad.hapticActuators?.[0]?.pulse?.(clamp(Math.max(strong, weak), 0, 1), ms)?.catch?.(() => {});
  }
}
