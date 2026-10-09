// TouchControls: on-screen controls for phones and tablets, laid out as mobile GTA does.
//   Driving:  a steering stick under the left thumb (it appears where the thumb lands), the pedals under the right
//             thumb (GAS, BRAKE / reverse), handbrake and nitro above them, horn; get out, camera, map and pause up top.
//   On foot:  the same stick walks (pushed to the rim: run), with jump, punch / fire, aim, the pistol and get in / use
//             on the right.
//   Anywhere else on the right half, a drag looks around (as the mouse does).
// Only built on a touch device. It feeds InputManager: held controls through state(), taps as its actions.

const isTouch = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints || 0) > 0;

// [id, label, action (tap) or hold control, groups it shows in, css class]
const BUTTONS = [
  ['gas', 'GAS', { hold: 'throttle' }, ['car'], 'tc-pedal tc-gas'],
  ['brake', 'BRAKE', { hold: 'brake' }, ['car'], 'tc-pedal tc-brake'],
  ['hand', 'HAND\nBRAKE', { hold: 'handbrake' }, ['car'], 'tc-btn tc-hand'],
  ['nitro', 'NOS', { hold: 'nitro' }, ['car'], 'tc-btn tc-nitro'],
  ['horn', '📯', { tap: 'horn' }, ['car'], 'tc-btn tc-horn'],
  ['look', '👀', { hold: 'lookBack' }, ['car'], 'tc-btn tc-lookback'],
  ['jump', 'JUMP', { tap: 'jump' }, ['foot'], 'tc-btn tc-jump'],
  ['hit', '👊', { tap: 'attack' }, ['foot'], 'tc-btn tc-hit'],
  ['aim', 'AIM', { hold: 'aim' }, ['foot'], 'tc-btn tc-aim'],
  ['gun', '🔫', { tap: 'weapon' }, ['foot'], 'tc-btn tc-gun'],
  ['reload', 'R', { tap: 'reload' }, ['foot'], 'tc-btn tc-reload'],
  ['enter', '🚗', { tap: 'enter' }, ['car', 'foot'], 'tc-top tc-enter'],
  ['cam', '🎥', { tap: 'camera' }, ['car', 'foot'], 'tc-top tc-cam'],
  ['reset', '↺', { tap: 'reset' }, ['car'], 'tc-top tc-reset'],
  ['map', '🗺', { tap: 'map' }, ['car', 'foot', 'map'], 'tc-top tc-map'],
  ['event', '!', { tap: 'event' }, ['car', 'foot'], 'tc-top tc-event'],
  ['pause', 'II', { tap: 'pause' }, ['car', 'foot', 'map'], 'tc-top tc-pause'],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.on = isTouch();
    this.ctx = null;
    this.held = new Set();
    this.stick = null;            // { id, x0, y0, x, y }
    this.lookId = null; this.lx = 0; this.ly = 0;
    this.dx = 0; this.dy = 0;
    if (!this.on) return;
    document.documentElement.classList.add('touch');
    const root = this.root = document.createElement('div');
    root.id = 'touch-controls';
    root.innerHTML = '<div class="tc-zone tc-left"></div><div class="tc-zone tc-right"></div><div class="tc-stick"><div class="tc-knob"></div></div>'
      + '<div class="tc-rotate">Turn your phone sideways to play</div>';
    document.body.appendChild(root);
    this.stickEl = root.querySelector('.tc-stick'); this.knobEl = root.querySelector('.tc-knob');
    this.btns = [];
    for (const [id, label, act, groups, cls] of BUTTONS) {
      const b = document.createElement('div');
      b.className = 'tc-b ' + cls; b.textContent = label; b.dataset.id = id;
      root.appendChild(b);
      this.btns.push({ el: b, act, groups });
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture?.(e.pointerId); b.classList.add('on');
        if (act.hold) this.held.add(act.hold);
        if (act.tap) this.input.pressed.add(act.tap);
        navigator.vibrate?.(8);
      });
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); if (act.hold) this.held.delete(act.hold); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    }
    // left zone: the stick, centred where the thumb lands
    const L = root.querySelector('.tc-left');
    L.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      e.preventDefault(); L.setPointerCapture?.(e.pointerId);
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 };
      this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px';
      this.stickEl.classList.add('on'); this._knob();
    });
    L.addEventListener('pointermove', (e) => {
      const s = this.stick; if (!s || e.pointerId !== s.id) return;
      const R = this._radius(), dx = e.clientX - s.x0, dy = e.clientY - s.y0, l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
      s.x = dx * k / R; s.y = dy * k / R; this._knob();
    });
    const lup = (e) => { if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.stickEl.classList.remove('on'); } };
    L.addEventListener('pointerup', lup); L.addEventListener('pointercancel', lup);
    // right zone: drag to look around
    const Rz = root.querySelector('.tc-right');
    Rz.addEventListener('pointerdown', (e) => { if (this.lookId !== null) return; e.preventDefault(); Rz.setPointerCapture?.(e.pointerId); this.lookId = e.pointerId; this.lx = e.clientX; this.ly = e.clientY; });
    Rz.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.dx += e.clientX - this.lx; this.dy += e.clientY - this.ly; this.lx = e.clientX; this.ly = e.clientY;
    });
    const rup = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    Rz.addEventListener('pointerup', rup); Rz.addEventListener('pointercancel', rup);
    this.setContext('none');
  }

  _radius() { return Math.max(44, Math.min(innerWidth, innerHeight) * 0.13); }
  _knob() { const s = this.stick, R = this._radius(); this.knobEl.style.transform = s ? `translate(${s.x * R}px, ${s.y * R}px)` : ''; }

  // 'car' | 'foot' | 'map' | 'none' (menus, garage, cut-scenes: nothing on screen)
  setContext(ctx) {
    if (!this.on || ctx === this.ctx) return;
    this.ctx = ctx;
    this.root.dataset.ctx = ctx;
    for (const b of this.btns) b.el.style.display = b.groups.includes(ctx) ? '' : 'none';
    if (ctx === 'none' || ctx === 'map') { this.stick = null; this.stickEl.classList.remove('on'); this.held.clear(); this.lookId = null; for (const b of this.btns) b.el.classList.remove('on'); }
  }

  // the held controls this frame (merged into InputManager.controls)
  state() {
    if (!this.on || this.ctx === 'none' || this.ctx === 'map') return null;
    const s = this.stick, h = this.held;
    const out = { steer: 0, throttle: h.has('throttle') ? 1 : 0, brake: h.has('brake') ? 1 : 0, handbrake: h.has('handbrake') ? 1 : 0, nitro: h.has('nitro'), lookBack: h.has('lookBack'), aim: h.has('aim'), lookDx: this.dx, lookDy: this.dy };
    this.dx = 0; this.dy = 0;
    if (s) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      if (this.ctx === 'car') out.steer = Math.sign(s.x) * Math.pow(Math.abs(dz(s.x)), 1.4);
      else {
        // walking: the stick is the direction; at the rim, run
        const x = dz(s.x), y = dz(s.y);
        out.steer = x; out.throttle = Math.max(0, -y); out.brake = Math.max(0, y);
        if (Math.hypot(s.x, s.y) > 0.92) out.nitro = true;
      }
    }
    return out;
  }
}
