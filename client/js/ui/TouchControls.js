// Mobile touch controls (multi-touch via Pointer Events):
//   left side  : floating analog joystick (push to the rim to sprint)
//   right side : drag anywhere to look; the FIRE button can be dragged too (aim while shooting)
//   buttons    : FIRE, AIM (toggle), JUMP, CROUCH, PRONE, RELOAD, GRENADE, SWAP, 3RD PERSON, scoreboard, chat, pause
export const isTouchDevice = () => new URLSearchParams(location.search).has('touch')
  || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);

const BTN = [
  // id, label, class (position group)
  ['fire', 'FIRE', 'big'], ['ads', 'AIM', 'mid'], ['jump', 'JUMP', 'sm'], ['crouch', 'CRCH', 'sm'], ['prone', 'PRONE', 'sm'],
  ['reload', 'R', 'sm'], ['nade', 'G', 'sm'], ['swap', '⇄', 'sm'], ['view', '👁', 'top'], ['score', '☰', 'top'], ['chat', '💬', 'top'], ['pause', '❚❚', 'top'],
  // battle royale only
  ['pick', 'PICK', 'sm br'], ['heal', '✚', 'sm br'], ['map', 'MAP', 'top br'],
  // vehicles: enter / exit, switch seat, helicopter climb / descend
  ['veh', 'VEH', 'sm veh'], ['vseat', 'SEAT', 'sm vin'], ['vup', '▲', 'sm vin heli'], ['vdown', '▼', 'sm vin heli'],
];

export class TouchControls {
  constructor(game) {
    this.g = game;
    this.me = game.me;
    this.lookSens = +(localStorage.getItem('sp_touch_sens') || 0.0045);
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `<div id="t-stick-zone"></div><div id="t-look-zone"></div>
      <div id="t-stick" class="hidden"><div id="t-knob"></div></div>
      ${BTN.map(([id, label, cls]) => `<div class="tbtn ${cls}" id="t-${id}" data-id="${id}">${label}</div>`).join('')}
      <div id="t-rotate">Rotate your phone to landscape</div>`;
    document.body.appendChild(root);
    document.body.classList.add('touch');
    this.root = root;
    this.stick = null;        // { id, x0, y0 }
    this.looks = new Map();   // pointerId -> { x, y }
    this.#bindZones();
    this.#bindButtons();
    addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #bindZones() {
    const zone = document.getElementById('t-stick-zone'), stick = document.getElementById('t-stick'), knob = document.getElementById('t-knob');
    const R = 60;
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault(); this.g.audio.unlock();
      if (this.stick) return;
      zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      stick.style.left = `${e.clientX - R}px`; stick.style.top = `${e.clientY - R}px`;
      stick.classList.remove('hidden');
      knob.style.transform = 'translate(0px, 0px)';
    });
    zone.addEventListener('pointermove', (e) => {
      const s = this.stick; if (!s || e.pointerId !== s.id) return;
      let dx = e.clientX - s.x0, dy = e.clientY - s.y0;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const mag = Math.min(1, d / R);
      const dead = mag < 0.12 ? 0 : (mag - 0.12) / 0.88;
      this.me.touch.mx = d ? (dx / Math.min(d, R)) * dead : 0;
      this.me.touch.mz = d ? (dy / Math.min(d, R)) * dead : 0;
      // pushing to the rim forward = sprint
      this.me.touch.sprint = mag > 0.95 && dy < -R * 0.8;
    });
    const endStick = (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null; stick.classList.add('hidden');
      Object.assign(this.me.touch, { mx: 0, mz: 0, sprint: false });
    };
    zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);

    const look = document.getElementById('t-look-zone');
    this.#dragLook(look);
  }

  // any element can act as a look surface (look zone, and the fire button while held)
  #dragLook(el) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
    el.addEventListener('pointermove', (e) => {
      const p = this.looks.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      // screen pixels -> radians, independent of device pixel ratio; slower while aiming (handled in look())
      this.me.look(dx, dy, this.lookSens);
    });
    const end = (e) => this.looks.delete(e.pointerId);
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }

  #bindButtons() {
    const me = this.me, g = this.g;
    const on = (id, down, up) => {
      const el = document.getElementById(`t-${id}`);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); g.audio.unlock(); el.classList.add('on'); down?.(e); });
      const release = (e) => { el.classList.remove('on'); up?.(e); };
      el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
      return el;
    };
    const fire = on('fire', () => { me.mouse.l = true; }, () => { me.mouse.l = false; me.triggerReleased = true; });
    this.#dragLook(fire);
    on('ads', () => { me.mouse.r = !me.mouse.r; document.getElementById('t-ads').classList.toggle('latched', me.mouse.r); });
    on('jump', () => { if (g.royale?.inPlane) g.royale.jump(); else me.touch.jump = true; });
    on('pick', () => g.royale?.pickup());
    on('veh', () => g.vehicles?.toggle());
    on('vseat', () => { const m = g.vehicles?.mine; if (m) g.net.send({ t: 'vseat', seat: 1 - m.seat }); });
    on('vup', () => { me.touch.up = true; }, () => { me.touch.up = false; });
    on('vdown', () => { me.touch.down = true; }, () => { me.touch.down = false; });
    on('heal', () => g.royale?.heal());
    on('map', () => { if (g.royale) g.royale.mapHeld = !g.royale.mapHeld; });
    on('crouch', () => { if (me.alive) me.setStance(me.s.stance === 'crouch' ? 'stand' : 'crouch'); });
    on('prone', () => { if (me.alive) me.setStance(me.s.stance === 'prone' ? 'stand' : 'prone'); });
    on('reload', () => { if (me.alive) me.reload(); });
    on('nade', () => { if (me.alive) me.throwGrenade(); });
    on('swap', () => { if (me.alive) me.switchSlot(1 - me.slot); });
    on('view', () => { me.thirdPerson = !me.thirdPerson; });
    on('score', () => g.hud.scoreboard(true, g.myId), () => g.hud.scoreboard(false));
    on('chat', () => { if (!g.chatOpen) g.openChat(); });
    on('pause', () => { document.getElementById('pause').classList.remove('hidden'); });
  }

  update() {
    // hide gameplay controls while dead / in menus
    const inPlane = !!this.g.royale?.inPlane;
    const playing = (this.me.alive || inPlane) && document.getElementById('pause').classList.contains('hidden');
    this.root.classList.toggle('dead', !playing);
    this.root.classList.toggle('plane', inPlane);
    this.root.classList.toggle('air', !!(this.me.alive && this.me.s.air));
    const V = this.g.vehicles, heli = V?.mine && V.map.get(V.mine.id)?.type === 'heli';
    this.root.classList.toggle('invehicle', !!V?.mine);
    this.root.classList.toggle('heli', !!heli);
    document.getElementById('t-veh').classList.toggle('ready', !V?.mine && !document.getElementById('vprompt')?.classList.contains('hidden'));
    if (this.g.royale) document.getElementById('t-pick').classList.toggle('ready', !!this.g.royale.promptItem);
    if (!this.me.mouse.r) document.getElementById('t-ads').classList.remove('latched');
    document.getElementById('t-crouch').classList.toggle('latched', this.me.s.stance === 'crouch');
    document.getElementById('t-prone').classList.toggle('latched', this.me.s.stance === 'prone');
    if (!playing) { Object.assign(this.me.touch, { mx: 0, mz: 0, sprint: false }); this.me.mouse.l = false; }
  }

  // phones: go fullscreen + landscape from a user gesture (deploy button)
  static enterFullscreen() {
    const el = document.documentElement;
    const p = el.requestFullscreen?.({ navigationUI: 'hide' }) || el.webkitRequestFullscreen?.();
    Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
}
