// InputManager: keyboard + mouse + gamepad -> normalized driving controls and edge-triggered actions.
import { clamp, approach } from './util.js';
import { TouchControls } from './TouchControls.js';
import { bus } from './EventBus.js';
import { isWheel, xboxLayout, pedal, wheelSteer, hat, profileFor, saveProfile, settlePedals, gamepads } from './Wheel.js';

const KEYMAP = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight'],
  lookBack: ['KeyC'],
};
const ACTIONS = {
  camera: ['KeyV'], map: ['KeyM'], pause: ['Escape', 'KeyP'], reset: ['KeyR'], horn: ['KeyH'],
  dev: ['F3'], photo: ['F2'], replay: ['KeyI'], enter: ['KeyF'], jump: ['Space'], fullscreen: ['F11'], confirm: ['Enter'], back: ['Backspace'], event: ['KeyE'], garage: ['KeyG'], attack: ['KeyQ'], weapon: ['Digit1'], reload: ['KeyR'], sockets: ['F7'], envStats: ['F8'], envDetail: ['F9'], envWeather: ['F4'],
  up: ['ArrowUp'], down: ['ArrowDown'], leftNav: ['ArrowLeft'], rightNav: ['ArrowRight'],
};

export class InputManager {
  constructor(settings) {
    this.settings = settings;
    this.down = new Set();
    this.pressed = new Set();   // actions triggered this frame
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false, lookBack: false, lookX: 0, lookY: 0 };
    this.steerKeyboard = 0;
    this.gamepadIndex = -1;
    this.wheel = null;           // the steering wheel in use (a Gamepad), if the controller is one
    this._wheelAsked = new Set(); // (wheels whose pedals the setup has asked for this session)
    this._padTold = new Set();    // (gamepads told once where a wheel is set up)
    this.lastDevice = 'keyboard';
    this.mouse = { dx: 0, dy: 0, dragging: false, lastMove: 0, aim: false };
    this.enabled = true;
    this._padPrev = {};
    this.touch = new TouchControls(this);
    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('blur', () => this.down.clear());
    addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; console.info('[Input] gamepad connected:', e.gamepad.id); });
    addEventListener('gamepaddisconnected', () => { this.gamepadIndex = -1; });
    // while playing, a click on the game captures the mouse (as GTA does): moving it then looks around with no
    // button held; Esc frees it (and pauses). `lockable` is set by the game each frame.
    this.lockable = false;
    addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.lockable && e.target?.tagName === 'CANVAS' && !document.pointerLockElement && this.settings.gameplay.mouseCapture !== false) {
        try { const r = e.target.requestPointerLock?.({ unadjustedMovement: true }); r?.catch?.(() => { try { e.target.requestPointerLock(); } catch { /* not allowed */ } }); } catch { /* not allowed */ }
      }
      if (e.button === 2 || e.button === 1) this.mouse.dragging = true;
      if (e.button === 2) this.mouse.aim = true;                      // right button: aim a weapon (on foot)
      if (e.button === 0 && e.target?.tagName === 'CANVAS') this.pressed.add('attack'); // left click: punch / fire
    });
    addEventListener('mouseup', (e) => { this.mouse.dragging = false; if (e.button === 2) this.mouse.aim = false; });
    addEventListener('mousemove', (e) => {
      if (this.mouse.dragging || document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; this.mouse.lastMove = performance.now(); }
    });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.lockable) this.pressed.add('pause'); });
    addEventListener('contextmenu', (e) => { if (e.target.tagName === 'CANVAS') e.preventDefault(); });
  }

  _key(e, isDown) {
    const code = e.code;
    // prevent browser defaults for game keys (space scroll, F3 find, arrows)
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2', 'F3', 'F4', 'F7', 'F8', 'F9', 'Tab'].includes(code) && e.target.tagName !== 'INPUT') e.preventDefault();
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') && code !== 'Escape') return;
    if (isDown) {
      if (!this.down.has(code)) {
        for (const [a, keys] of Object.entries(ACTIONS)) if (keys.includes(code)) this.pressed.add(a);
      }
      this.down.add(code);
      this.lastDevice = 'keyboard';
    } else this.down.delete(code);
  }

  _any(keys) { for (const k of keys) if (this.down.has(k)) return true; return false; }
  wasPressed(action) { return this.pressed.has(action); }
  consume(action) { const had = this.pressed.has(action); this.pressed.delete(action); return had; }

  update(dt) {
    const c = this.controls;
    const sens = this.settings.gameplay.steeringSensitivity || 1;
    // keyboard
    let throttle = this._any(KEYMAP.throttle) ? 1 : 0;
    let brake = this._any(KEYMAP.brake) ? 1 : 0;
    const l = this._any(KEYMAP.left), r = this._any(KEYMAP.right);
    const target = (r ? 1 : 0) - (l ? 1 : 0);
    // keyboard steering ramps (faster return to center) for smooth arcade feel
    const rate = (target === 0 || Math.sign(target) !== Math.sign(this.steerKeyboard) ? 7 : 3.2) * sens;
    this.steerKeyboard = approach(this.steerKeyboard, target, rate * dt);
    let steer = this.steerKeyboard;
    let handbrake = this._any(KEYMAP.handbrake) ? 1 : 0;
    let nitro = this._any(KEYMAP.nitro);
    let lookBack = this._any(KEYMAP.lookBack);
    let lookX = 0, lookY = 0;

    // gamepad (standard mapping), or a steering wheel (see Wheel.js)
    const pads = gamepads();
    // (with more than one, a wheel set up here first: some wheels show up twice, as themselves and as an Xbox pad)
    const live = [...pads].filter(Boolean);
    const pad = (live.length > 1 && live.find((p) => profileFor(this.settings, p))) || pads[this.gamepadIndex] || live[0];
    this.wheel = pad && isWheel(pad, this.settings.gameplay.controller, this.settings) ? pad : null;
    const edge = (key, p, action) => {
      if (p && !this._padPrev[key]) for (const a of [].concat(action)) this.pressed.add(a);
      this._padPrev[key] = p;
    };
    if (this.wheel) {
      this.gamepadIndex = pad.index;
      // its wheel and pedals, once learnt (the setup asks for them the first time a wheel is seen, once a session); until
      // then the wheel on axis 0 and the pedals where a pad has its triggers (R2 / L2, or RT / LT laid out as a pad)
      const prof = profileFor(this.settings, pad), std = pad.mapping === 'standard';
      if (!prof && !this._wheelAsked.has(pad.id)) { this._wheelAsked.add(pad.id); bus.emit('wheel:setup', { id: pad.id }); }
      // (a pedal let up past its learnt rest: kept, and saved a moment later)
      if (prof && settlePedals(pad, prof)) this._saveProfT = 1;
      if (prof && this._saveProfT > 0 && (this._saveProfT -= dt) <= 0) saveProfile(this.settings, prof);
      const s = wheelSteer(pad, sens, prof?.steer);
      const th = prof ? pedal(pad, prof.throttle) : pad.buttons[7]?.value || 0;
      const br = prof ? pedal(pad, prof.brake) : pad.buttons[6]?.value || 0;
      // (a pedal that is a button is no button of the controls)
      const nAx = pad.axes.length, pedalBtn = new Set([prof?.throttle, prof?.brake].filter((q) => q && q.i >= nAx).map((q) => q.i - nAx));
      const B = (i) => !pedalBtn.has(i) && !!pad.buttons[i]?.pressed;
      if (Math.abs(s) > 0.03 || th > 0.05 || br > 0.05 || pad.buttons.some((b) => b.pressed)) this.lastDevice = 'wheel';
      if (s !== 0) steer = s;                                      // (linear: as far as the wheel is turned)
      throttle = Math.max(throttle, th); brake = Math.max(brake, br);
      // buttons: the face buttons as on a pad (A / cross: handbrake, Y / triangle: get in / out); the paddles nitro and
      // horn (never the car's reset, a paddle is pulled by accident). Menu buttons where each layout has them
      if (B(0)) handbrake = 1;
      if (B(2)) lookBack = true;
      if (B(4)) nitro = true;
      // menu buttons: laid out as a pad (X-Input), as an Xbox wheel (Menu, View on 6 / 7), or as a PlayStation one
      const [P, M, C, Hn] = std ? [9, 8, 11, 10] : xboxLayout(pad) ? [6, 7, 8, 9] : [9, 8, 10, 11];
      edge(0, B(0), ['confirm', 'jump']); edge(1, B(1), ['back', 'attack']); edge(3, B(3), 'enter'); edge(5, B(5), 'horn');
      edge(P, B(P), 'pause'); edge(M, B(M), 'map'); edge(C, B(C), 'camera'); edge(Hn, B(Hn), 'horn');
      // the d-pad: a hat axis (Chrome), or buttons 12-15 (Firefox)
      const H = hat(pad);
      edge('hu', H.up || B(12), 'up'); edge('hd', H.down || B(13), 'down'); edge('hl', H.left || B(14), 'leftNav'); edge('hr', H.right || B(15), 'rightNav');
    } else if (pad) {
      this.gamepadIndex = pad.index;
      // (a steering wheel in X-Input mode looks like an Xbox pad: say once where it is set up)
      if (!this._padTold.has(pad.id)) { this._padTold.add(pad.id); bus.emit('toast', { text: 'Controller connected. A steering wheel? Settings > Controls > SET UP WHEEL', time: 5 }); }
      const ax = pad.axes[0] || 0;
      const dz = (v, d = 0.12) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
      const s = dz(ax);
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      const used = Math.abs(s) > 0 || rt > 0.05 || lt > 0.05 || pad.buttons.some((b) => b.pressed);
      if (used) this.lastDevice = 'gamepad';
      if (Math.abs(s) > 0) steer = clamp(Math.sign(s) * Math.pow(Math.abs(s), 1.5) * sens, -1, 1);
      throttle = Math.max(throttle, rt);
      brake = Math.max(brake, lt);
      if (pad.buttons[0]?.pressed) handbrake = 1;           // A
      if (pad.buttons[5]?.pressed) nitro = true;            // RB
      if (pad.buttons[2]?.pressed) lookBack = true;         // X
      lookX = dz(pad.axes[2] || 0, 0.2); lookY = dz(pad.axes[3] || 0, 0.2);
      const btn = (i, action) => edge(i, !!pad.buttons[i]?.pressed, action);
      btn(11, 'camera');  // R3 (Y is get in / out, like GTA)
      btn(9, 'pause');    // Start
      btn(3, 'enter');    // Y: get in / out
      btn(8, 'map');      // Back/View
      btn(1, ['back', 'attack']); // B: back in menus, punch on foot
      btn(0, ['confirm', 'jump']);  // A (menus / jump on foot)
      btn(12, 'up'); btn(14, 'leftNav'); btn(15, 'rightNav');
      btn(4, ['reset', 'reload']);    // LB (on foot: reload)
      btn(13, ['down', 'weapon']);  // d-pad down: menus; on foot, draw / holster the pistol
      btn(2, 'event');    // X: a mission's action (talk, grab, take)
      btn(11, 'horn');    // R3
    }
    // touch screen (phones, tablets)
    const T = this.touch.state();
    if (T) {
      if (T.steer || T.throttle || T.brake || T.handbrake) this.lastDevice = 'touch';
      if (Math.abs(T.steer) > Math.abs(steer)) steer = T.steer * sens;
      throttle = Math.max(throttle, T.throttle); brake = Math.max(brake, T.brake); handbrake = Math.max(handbrake, T.handbrake);
      nitro = nitro || T.nitro; lookBack = lookBack || T.lookBack;
      // (a look drag counts as the mouse does, a little livelier for the thumb)
      if (T.lookDx || T.lookDy) { this.mouse.dx += T.lookDx * 1.6; this.mouse.dy += T.lookDy * 1.6; this.mouse.lastMove = performance.now(); }
    }
    c.throttle = throttle; c.brake = brake; c.steer = clamp(steer, -1, 1); c.handbrake = handbrake;
    // held: E, or X on a pad (fill a bag, hold a door)
    c.use = this._any(ACTIONS.event) || (!this.wheel && this.gamepadIndex >= 0 && !!gamepads()[this.gamepadIndex]?.buttons[2]?.pressed);
    c.nitro = nitro; c.lookBack = lookBack;
    const csens = this.settings.gameplay.cameraSensitivity || 1;
    c.lookX = lookX + this.mouse.dx * 0.004 * csens; c.lookY = lookY + this.mouse.dy * 0.004 * csens;
    c.mouseLook = this.mouse.dragging || performance.now() - this.mouse.lastMove < 1500;
    // aiming a weapon on foot: the right mouse button, or the left trigger
    c.aim = this.mouse.aim || !!T?.aim || (!this.wheel && this.gamepadIndex >= 0 && (gamepads()[this.gamepadIndex]?.buttons[6]?.value || 0) > 0.5);
    this.mouse.dx = 0; this.mouse.dy = 0;
  }

  endFrame() { this.pressed.clear(); }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (!this.settings.gameplay.vibration || this.gamepadIndex < 0) return;
    const pad = gamepads()[this.gamepadIndex];
    const act = pad?.vibrationActuator;
    if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
  }
}
