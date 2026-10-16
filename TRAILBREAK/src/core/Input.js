// Keyboard, gamepad and steering wheel -> driving controls and one-shot actions.
//
// Keys (see index.html's help): W/S throttle/brake, A/D steer, Space handbrake, L range, 4 4WD, X lockers, B sway bar,
// G gearbox mode (Shift/Ctrl shift in manual), F winch hook, E/Q winch in/out, R recover, Backspace station, C camera,
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
    return pads.find((p) => WHEEL_RX.test(p.id)) || pads[0] || null;
  }

  update(dt) {
    const c = this.controls;
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
    let lookX = 0, lookY = 0, analog = false;

    const pad = this.pad();
    if (pad) {
      const wheel = WHEEL_RX.test(pad.id) || pad.mapping !== 'standard';
      const edge = (i, action) => {
        const p = !!pad.buttons[i]?.pressed;
        if (p && !this.padPrev[i]) { this.pressed.add(action); this.device = wheel ? 'wheel' : 'gamepad'; }
        this.padPrev[i] = p;
      };
      const ax = pad.axes[0] || 0;
      if (wheel) {
        if (Math.abs(ax) > 0.01) { steer = clamp(ax, -1, 1); analog = true; }
      } else {
        const s = dz(ax);
        if (s !== 0) { steer = clamp(Math.sign(s) * Math.pow(Math.abs(s), 1.4), -1, 1); this.device = 'gamepad'; }
      }
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt); brake = Math.max(brake, lt);
      if (pad.buttons[0]?.pressed) handbrake = 1;
      if (pad.buttons[5]?.pressed) winch = 1;
      if (pad.buttons[4]?.pressed) winch = -1;
      if (!wheel) { lookX = dz(pad.axes[2] || 0, 0.18); lookY = dz(pad.axes[3] || 0, 0.18); }
      edge(2, 'hook'); edge(3, 'camera'); edge(1, 'recover'); edge(12, 'range'); edge(13, 'locks'); edge(14, '4wd');
      edge(15, 'lights'); edge(9, 'pause'); edge(8, 'map'); edge(11, 'event');
    }
    c.throttle = throttle; c.brake = brake; c.steer = clamp(steer, -1, 1); c.handbrake = handbrake; c.winch = winch;
    c.analogSteer = analog;
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
