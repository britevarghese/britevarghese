// Photo mode: the world freezes, the HUD hides and a free camera orbits the car. Drag to orbit, wheel to
// zoom, WASD / Q-E to move the focus point, and a side panel sets lens, exposure, roll, time of day,
// motion blur and a colour filter. ENTER (or the button) saves a PNG of the current frame.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

export const FILTERS = {
  none:  { label: 'NONE',  sat: 1,    contrast: 1,    tint: [1, 1, 1],       lift: 0,     grain: 0 },
  noir:  { label: 'NOIR',  sat: 0,    contrast: 1.3,  tint: [1, 1, 1],       lift: 0.01,  grain: 0.035 },
  neon:  { label: 'NEON',  sat: 1.45, contrast: 1.12, tint: [1.04, 0.94, 1.1], lift: 0,   grain: 0 },
  warm:  { label: 'SODIUM', sat: 1.05, contrast: 1.05, tint: [1.14, 1.0, 0.82], lift: 0.004, grain: 0.01 },
  cool:  { label: 'STEEL', sat: 0.85, contrast: 1.1,  tint: [0.86, 0.98, 1.14], lift: 0.004, grain: 0.01 },
  film:  { label: 'FILM',  sat: 0.9,  contrast: 0.94, tint: [1.05, 1.0, 0.92], lift: 0.02,  grain: 0.05 },
};

const _v = new THREE.Vector3();

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.focus = new THREE.Vector3();
    this.off = new THREE.Vector3();     // pan offset of the focus from the car
    this.opts = { fov: 50, ev: 0, roll: 0, blur: 0, vignette: 0.35, filter: 'none', hour: 0 };
    this._drag = null;
    const canvas = () => game.rm.renderer.domElement;
    addEventListener('pointerdown', (e) => {
      if (!this.active || e.target !== canvas()) return;
      this._drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    });
    addEventListener('pointerup', () => { this._drag = null; });
    addEventListener('pointermove', (e) => {
      if (!this.active || !this._drag) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      if (this._drag.pan) this._pan(-dx * this.dist * 0.0016, dy * this.dist * 0.0016, 0);
      else { this.yaw -= dx * 0.006; this.pitch = clamp(this.pitch + dy * 0.004, -0.2, 1.45); }
    });
    addEventListener('wheel', (e) => {
      if (!this.active || e.target !== canvas()) return;
      this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), 1.6, 40);
    }, { passive: true });
  }

  enter() {
    const g = this.game, s = g.player.state, cam = g.camera;
    this.active = true;
    this.prevMode = g.state.mode;
    g.state.mode = 'photo';
    g.audio.setPaused(true);
    document.getElementById('hud').classList.add('hidden');
    // start from the current view: orbit angles from the camera's offset to the car
    this.off.set(0, 0, 0);
    this.focus.set(s.x, s.y + 0.7, s.z);
    _v.copy(cam.position).sub(this.focus);
    this.dist = clamp(_v.length(), 3, 20);
    this.yaw = Math.atan2(_v.x, _v.z);
    this.pitch = clamp(Math.asin(clamp(_v.y / Math.max(0.01, _v.length()), -1, 1)), -0.2, 1.45);
    const o = this.opts;
    o.fov = Math.round(cam.fov); o.ev = 0; o.roll = 0; o.blur = Math.round((g.fx2.speed || 0) * 100) / 100;
    this.env0 = { mode: g.env.mode, hour: g.env.hour };
    o.hour = +g.env.hour.toFixed(1);
    this.savedFx = { speed: g.fx2.speed, nitro: g.fx2.nitro, damageFlash: g.fx2.damageFlash };
    g.ui.showPhoto(this);
  }

  exit() {
    const g = this.game;
    this.active = false;
    g.fx2.photo = null;
    g.env.mode = this.env0.mode; g.env.hour = this.env0.hour; g.env.envCanvasKey = '';
    g.camera.fov = this.opts.fov; g.camera.updateProjectionMatrix();
    g.ui.clear();
    g.state.mode = 'paused';
    g.ui.showPause();
  }

  setHour(h) {
    const env = this.game.env;
    env.mode = 'photo'; env.hour = ((h % 24) + 24) % 24; env.envCanvasKey = '';
    this.opts.hour = h;
  }

  _pan(right, up, fwd) {
    const cx = Math.cos(this.yaw), sx = Math.sin(this.yaw);
    // camera looks along -(sin yaw, cos yaw); right vector = (-cos, 0, sin)
    this.off.x += -cx * right - sx * fwd;
    this.off.z += sx * right - cx * fwd;
    this.off.y += up;
    const r = Math.hypot(this.off.x, this.off.z);
    if (r > 25) { this.off.x *= 25 / r; this.off.z *= 25 / r; }
    this.off.y = clamp(this.off.y, -0.6, 8);
  }

  update(dt, input) {
    const g = this.game, s = g.player.state, cam = g.camera, o = this.opts;
    const k = (c) => input.down.has(c);
    const sp = (k('ShiftLeft') ? 9 : 3.5) * dt;
    this._pan((k('KeyD') ? sp : 0) - (k('KeyA') ? sp : 0), (k('KeyE') ? sp : 0) - (k('KeyQ') ? sp : 0), (k('KeyW') ? sp : 0) - (k('KeyS') ? sp : 0));
    if (k('ArrowLeft')) this.yaw += dt * 1.2;
    if (k('ArrowRight')) this.yaw -= dt * 1.2;
    if (k('ArrowUp')) this.pitch = clamp(this.pitch + dt * 0.8, -0.2, 1.45);
    if (k('ArrowDown')) this.pitch = clamp(this.pitch - dt * 0.8, -0.2, 1.45);
    this.focus.set(s.x + this.off.x, s.y + 0.7 + this.off.y, s.z + this.off.z);
    const cp = Math.cos(this.pitch);
    cam.position.set(this.focus.x + Math.sin(this.yaw) * cp * this.dist, this.focus.y + Math.sin(this.pitch) * this.dist, this.focus.z + Math.cos(this.yaw) * cp * this.dist);
    cam.position.y = Math.max(cam.position.y, s.y + 0.12);
    cam.lookAt(this.focus);
    cam.rotateZ(THREE.MathUtils.degToRad(o.roll));
    cam.near = 0.05;
    cam.fov = o.fov; cam.updateProjectionMatrix();
    // freeze the live effects at what the shot calls for
    const f = FILTERS[o.filter] || FILTERS.none;
    g.fx2.speed = o.blur; g.fx2.nitro = 0; g.fx2.damageFlash = 0; g.fx2.lensRain = 0;
    g.fx2.photo = { ...f, vignette: o.vignette };
    if (input.consume('confirm')) this.capture();
    if (input.consume('pause')) this.exit();
    if (input.consume('horn')) g.ui.togglePhotoPanel?.();
  }

  applyExposure() { this.game.rm.renderer.toneMappingExposure *= Math.pow(2, this.opts.ev); }

  capture() { this._capture = true; }
  // called right after the frame is rendered: the drawing buffer is still intact in the same task
  afterRender() {
    if (!this._capture) return;
    this._capture = false;
    const canvas = this.game.rm.renderer.domElement;
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    const name = `nightshift-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    canvas.toBlob((blob) => {
      if (!blob) { this.game.ui.toast('Could not capture the frame', 'err', 3); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.lastShot = name;
      this.game.ui.toast(`Saved ${name}`, 'good', 3);
    }, 'image/png');
    this.game.ui.photoFlash?.();
  }
}
