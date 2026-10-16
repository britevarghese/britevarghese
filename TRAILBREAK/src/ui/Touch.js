// On-screen controls for phones and tablets: steering on the left, pedals on the right, and buttons for the winch,
// recovery, transfer case, lockers, tyre pressure, camera, map, events (at a start line or in a run) and menu. Shown
// only on touch screens.

const BUTTONS = [
  ['cam', 'camera', 'CAM'], ['hook', 'hook', 'WINCH'], ['rec', 'recover', 'RESET'],
  ['rng', 'range', 'LOW'], ['lck', 'locks', 'LOCK'], ['air', 'air', 'AIR'], ['tow', 'tow', 'HELP'], ['map', 'map', 'MAP'], ['ev', 'event', 'EVENT'], ['mod', 'modes', 'MODES'], ['esc', 'pause', '☰'],
];

export function isTouchDevice() {
  return ('ontouchstart' in window) || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
}

export class TouchControls {
  constructor(input) {
    this.input = input;
    const root = this.root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-steer"><button data-k="left">◀</button><button data-k="right">▶</button></div>
      <div class="t-pedals"><button data-k="brake" class="t-brake">BRAKE</button><button data-k="gas" class="t-gas">GAS</button></div>
      <div class="t-winch hidden"><button data-k="wout">OUT</button><button data-k="win">IN</button></div>
      <div class="t-buttons">${BUTTONS.map(([id, , label]) => `<button data-a="${id}">${label}</button>`).join('')}</div>`;
    document.body.appendChild(root);
    document.body.classList.add('touch');
    const held = new Set();
    const sync = () => {
      const t = input.touch;
      t.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      t.throttle = held.has('gas') ? 1 : 0;
      t.brake = held.has('brake') ? 1 : 0;
      t.winch = (held.has('win') ? 1 : 0) - (held.has('wout') ? 1 : 0);
    };
    for (const b of root.querySelectorAll('button[data-k]')) {
      const k = b.dataset.k;
      const down = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); held.add(k); b.classList.add('on'); input.device = 'touch'; sync(); };
      const up = (e) => { e.preventDefault(); held.delete(k); b.classList.remove('on'); sync(); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
    }
    for (const b of root.querySelectorAll('button[data-a]')) {
      const action = BUTTONS.find(([id]) => id === b.dataset.a)[1];
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.pressed.add(action); });
    }
    this.winchRow = root.querySelector('.t-winch');
  }

  update(game) {
    this.winchRow.classList.toggle('hidden', !game.vehicle.winch.attached);
    const ev = this.root.querySelector('[data-a="ev"]');
    ev.classList.toggle('hidden', !game.events?.canPress);
    const r = this.root.querySelector('[data-a="rng"]');
    const label = game.vehicle.dt.low ? 'HIGH' : 'LOW';
    if (r.textContent !== label) r.textContent = label;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }
}
