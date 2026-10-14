// Cutscenes the GTA way: the game keeps running (traffic drives past, people walk, the engine idles) while the
// camera cuts between shots and the characters talk. A scene is a list of shots:
//   { dur, cam: (t, k, out) => out.set({ pos, look, fov }) | { pos, look, fov } (Vector3s or functions of k),
//     lines: [[at, speaker, text], ...], on: [[at, fn], ...], enter(), exit() }
// k is the shot's progress 0..1, eased. Positions may be functions (following a moving car, an actor's head).
// Letterboxed, the HUD away, the player's controls off. Esc / Start skips it: the rest of its events still run, in
// order, so the world ends up as the scene leaves it.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _l = new THREE.Vector3();
const ease = (k) => k * k * (3 - 2 * k);
const val = (v, k, out) => (typeof v === 'function' ? v(k, out) : out.copy(v));

export class Cinema {
  constructor(game, story) {
    this.game = game; this.story = story;
    this.active = false;
  }

  play(shots, onDone, { skippable = true } = {}) {
    this.shots = shots; this.i = -1; this.t = 0; this.onDone = onDone; this.skippable = skippable;
    this.active = true;
    const g = this.game;
    // (the HUD away, and the game's own notices - unlocks, achievements - held back until it's over)
    for (const id of ['hud', 'toasts']) document.getElementById(id)?.classList.add('hidden');
    this.story.el.root.classList.add('cine');
    this.story.el.obj.classList.remove('on');
    g.hud?.setPrompt?.(null);
    this._skipHint(true);
    this._next();
  }

  _next() {
    const prev = this.shots[this.i];
    if (prev) { this._flush(prev); prev.exit?.(); }
    this.i++; this.t = 0;
    const s = this.shots[this.i];
    if (!s) { this._end(); return; }
    s._done = new Set();
    s.enter?.();
  }
  // a shot's events and lines not yet fired (cut short, or skipped)
  _flush(s) {
    for (const [at, fn] of s.on || []) if (!s._done.has(fn)) { s._done.add(fn); fn(); }
  }

  update(dt, input) {
    if (!this.active) return;
    if (this.skippable && (input.consume('pause') || input.consume('back'))) { this.skip(); return; }
    const s = this.shots[this.i];
    if (!s) return;
    this.t += dt;
    for (const ev of s.on || []) if (this.t >= ev[0] && !s._done.has(ev[1])) { s._done.add(ev[1]); ev[1](); }
    const lines = s.lines || [];
    let cur = null;
    for (const L of lines) if (this.t >= L[0]) cur = L;
    if (cur !== this.curLine) { this.curLine = cur; this.story._subtitle(cur ? cur[1] : null, cur ? cur[2] : ''); }
    if (this.t >= s.dur) this._next();
  }

  // where the camera is this frame (called instead of the game's own cameras)
  camera(dt, cam) {
    const s = this.shots[this.i];
    if (!s) return;
    const k = ease(Math.min(1, this.t / s.dur));
    let fov = 50;
    if (typeof s.cam === 'function') { const r = s.cam(this.t, k); _p.copy(r.pos); _l.copy(r.look); fov = r.fov ?? fov; }
    else { val(s.cam.pos, k, _p); val(s.cam.look, k, _l); fov = typeof s.cam.fov === 'function' ? s.cam.fov(k) : s.cam.fov ?? fov; }
    cam.position.copy(_p); cam.lookAt(_l);
    if (s.cam.roll) cam.rotateZ(s.cam.roll);
    cam.fov = fov; cam.near = 0.05; cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  skip() {
    // the rest of the scene's events, in order, then out
    for (let j = Math.max(0, this.i); j < this.shots.length; j++) {
      const s = this.shots[j];
      if (j > this.i) { s._done = new Set(); s.enter?.(); }
      this._flush(s); s.exit?.();
    }
    this.i = this.shots.length;
    this._end();
  }

  _end() {
    if (!this.active) return;
    this.active = false;
    this.curLine = null;
    this.story._subtitle(null);
    this.story.el.root.classList.remove('cine');
    for (const id of ['hud', 'toasts']) document.getElementById(id)?.classList.remove('hidden');
    this._skipHint(false);
    const g = this.game;
    if (g.onFoot.active) { g.onFoot.camPos.copy(g.camera.position); } else g.camCtl.snap(g.player);
    const f = this.onDone; this.onDone = null;
    f?.();
  }

  _skipHint(on) {
    if (!this.hint) {
      const d = document.createElement('div');
      d.className = 'cine-skip'; d.innerHTML = 'Esc / <span class="key">Start</span> to skip';
      this.story.el.root.appendChild(d); this.hint = d;
    }
    this.hint.classList.toggle('on', on && this.skippable);
  }
}

// a big title over the picture (the game's name at the start of the story, a chapter's)
export function titleCard(story, big, small = '', time = 4.5) {
  const t = document.createElement('div');
  t.className = 'cine-title';
  t.innerHTML = `${big}${small ? `<small>${small}</small>` : ''}`;
  t.style.animationDuration = `${time}s`;
  story.el.root.appendChild(t);
  setTimeout(() => t.remove(), time * 1000);
}
