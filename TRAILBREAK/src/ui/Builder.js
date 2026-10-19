// The map builder (Esc > Map builder, or Modes & races): build your own course on the map you are on, out of the props
// in game/Props.js, from a camera over it. Pick a prop from the palette and click (tap) the ground to put it down (Q
// and E, or the turn buttons, turn it; checkpoints face on from the last one); with no prop picked, click one to pick
// it, drag it to move it, Del to take it away, Ctrl+Z to undo. Drag the ground to move about, right-drag (two
// fingers) to turn the view, the wheel (pinch) to zoom; W A S D move too.
//
// Everything you put down is part of the ground at once (World.setProps): TEST DRIVE puts your truck in it; with a
// start line and checkpoints it is a race (RACE IT). The map you are building is kept in the browser as you go (one
// for each map), MY MAPS keeps copies under a name, and SHARE gives a link that opens it for anyone. In a room your
// friends see it as you build it (and can build on it too).
import * as THREE from 'three';
import { PROP_TYPES, PROP_IDS, MAX_PROPS, reach, encodeLayout, decodeLayout } from '../game/Props.js';
import { PropView } from '../render/PropView.js';
import { escapeHtml } from './HUD.js';

const $ = (id) => document.getElementById(id);
const STORE = 'trailbreak.layouts.v1';
const GROUPS = ['Jumps', 'Obstacles', 'Track', 'Race'];
const STEP = Math.PI / 12;

/** The palette's little pictures. */
const ICON = {
  ramp: '<path d="M3 18h18L21 9z"/>', bigramp: '<path d="M2 19h20V5z"/>', kicker: '<path d="M3 18h18c0-5-1-9-2-11-2 6-8 10-16 11z"/>',
  dirtmound: '<path d="M2 18c3-7 7-9 10-9s7 2 10 9z"/>', container: '<rect x="2" y="8" width="20" height="10" rx="1"/><path d="M6 8v10M10 8v10M14 8v10M18 8v10" stroke="#1c241f" stroke-width="1"/>',
  crate: '<rect x="5" y="7" width="14" height="12"/><path d="M5 7l14 12" stroke="#1c241f" stroke-width="1.5"/>', log: '<rect x="2" y="11" width="18" height="6" rx="3"/><circle cx="20" cy="14" r="3"/>',
  logpile: '<circle cx="7" cy="17" r="3"/><circle cx="13" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><circle cx="10" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><circle cx="13" cy="7" r="3"/>',
  rock: '<path d="M4 18l3-7 5-3 5 2 3 8z"/>', bigrock: '<path d="M2 19l2-9 6-5 7 1 5 6 0 7z"/>', barrel: '<rect x="7" y="5" width="10" height="15" rx="2"/><path d="M7 9h10M7 16h10" stroke="#1c241f" stroke-width="1"/>',
  tyres: '<ellipse cx="12" cy="17" rx="8" ry="2.5"/><ellipse cx="12" cy="13" rx="8" ry="2.5"/><ellipse cx="12" cy="9" rx="8" ry="2.5"/>', barrier: '<path d="M2 19h20l-2-3-4-1-1-7H9l-1 7-4 1z"/>',
  fence: '<path d="M4 6v14M12 6v14M20 6v14M3 10h18M3 15h18" stroke="currentColor" stroke-width="2" fill="none"/>', mud: '<ellipse cx="12" cy="15" rx="10" ry="5"/><ellipse cx="9" cy="14" rx="2" ry="1" fill="#1c241f"/>',
  start: '<path d="M5 21V4h13l-3 4 3 4H7" fill="none" stroke="currentColor" stroke-width="2"/>', checkpoint: '<path d="M3 20c0-9 4-15 9-15s9 6 9 15" fill="none" stroke="currentColor" stroke-width="3"/>',
  select: '<path d="M5 3l12 9-6 1 3 7-2 1-3-7-4 4z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">${ICON[k] || ''}</svg>`;

export class Builder {
  constructor(game) {
    this.g = game; this.world = game.world;
    this.view = new PropView(game.scene, game.world);
    this.map = game.world.map.id;
    this.active = false;
    this.tool = null;            // a prop type to put down, or null: pick and move
    this.sel = -1;
    this.yaw = 0;
    this.history = [];
    this.cam = { x: 0, z: 0, dist: 70, yaw: 0, pitch: 0.95 };
    this.ray = new THREE.Raycaster();
    this.ptrs = new Map();
    this.store = this.loadStore();
    this.layout = this.store.current[this.map] || { v: 1, map: this.map, name: '', props: [] };
    this.layout.map = this.map;
    this.buildUI();
    this.apply(false);
  }

  // ---------------------------------------------------------------- storage
  loadStore() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && s.current && Array.isArray(s.saved)) return s; } catch { /* none */ }
    return { current: {}, saved: [] };
  }
  saveStore() { try { localStorage.setItem(STORE, JSON.stringify(this.store)); } catch { /* full or blocked */ } }

  // ---------------------------------------------------------------- the layout
  /** Put the layout into the world (the ground, the meshes, the race), keep it, and tell the room. */
  apply(share = true) {
    this.world.setProps(this.layout.props);
    this.view.set(this.world.props);
    this.store.current[this.map] = this.layout;
    this.saveStore();
    this.g.events?.setCustom?.(this.layout);
    this.drawStatus();
    if (share) this.g.shareLayout?.(this.layout);
  }

  /** Replace the layout (a link, MY MAPS, a friend's): the world follows. */
  load(L, share = true) {
    this.layout = { v: 1, map: this.map, name: L.name || '', props: (L.props || []).filter((p) => PROP_TYPES[p.type]).slice(0, MAX_PROPS).map((p) => ({ type: p.type, x: p.x, z: p.z, yaw: p.yaw || 0 })) };
    this.sel = -1; this.history = [];
    if (this.nameEl) this.nameEl.value = this.layout.name;
    this.apply(share);
  }

  snapshot() { this.history.push(JSON.stringify(this.layout.props)); if (this.history.length > 60) this.history.shift(); }
  undo() { const h = this.history.pop(); if (!h) return; this.layout.props = JSON.parse(h); this.sel = -1; this.apply(); this.view.select(-1); }

  place(type, x, z, yaw) {
    if (this.layout.props.length >= MAX_PROPS) { this.g.hud.hint(`That's the most a map takes (${MAX_PROPS})`, 2); return; }
    if (type === 'start') { const k = this.layout.props.findIndex((p) => p.type === 'start'); if (k >= 0) { this.snapshot(); this.layout.props.splice(k, 1); } }
    else this.snapshot();
    // a checkpoint faces on from the last one (or the start)
    if (type === 'checkpoint') {
      const prev = [...this.layout.props].reverse().find((p) => p.type === 'checkpoint' || p.type === 'start');
      if (prev && Math.hypot(x - prev.x, z - prev.z) > 2) yaw = Math.atan2(x - prev.x, z - prev.z);
    }
    this.layout.props.push({ type, x: round(x), z: round(z), yaw: norm(yaw) });
    // the first checkpoint: the start line turns to face it
    const start = this.layout.props.find((p) => p.type === 'start');
    if (type === 'checkpoint' && start && this.layout.props.filter((p) => p.type === 'checkpoint').length === 1) start.yaw = norm(Math.atan2(x - start.x, z - start.z));
    this.apply();
    this.g.audio.beep?.(880, 0.05, 0.04);
  }

  remove(i) { if (i < 0) return; this.snapshot(); this.layout.props.splice(i, 1); this.sel = -1; this.apply(); this.view.select(-1); }
  turn(d) {
    if (this.sel >= 0) { this.snapshot(); const p = this.layout.props[this.sel]; p.yaw = norm(p.yaw + d); this.apply(); this.view.select(this.sel); }
    else this.yaw = norm(this.yaw + d);
  }
  clear() { if (!this.layout.props.length || !confirm('Take away everything on this map?')) return; this.snapshot(); this.layout.props = []; this.sel = -1; this.apply(); }

  // ---------------------------------------------------------------- open, close
  open() {
    if (this.active) return;
    const g = this.g;
    if (g.events.racing) { g.hud.hint('Finish (or leave) the run first', 2); return; }
    if (g.paused) g.togglePause(false);
    if (g.mapOpen) g.toggleMap();
    this.active = true;
    g.building = true;
    const v = g.vehicle.pos, f = g.vehicle.fwd;
    Object.assign(this.cam, { x: v.x + f.x * 20, z: v.z + f.z * 20, yaw: Math.atan2(f.x, f.z), dist: 70, pitch: 0.95 });
    this.el.classList.remove('hidden');
    g.hud.show(false);
    g.touch?.show(false);
    g.input.enabled = false;
    this.bind(true);
    this.setTool(this.tool);
    this.drawStatus();
    g.audio.setMuted?.('menu', true);
  }

  /** Out of the builder: drive (at the start line when it is a race and race is asked for). */
  close(then = null) {
    if (!this.active) return;
    const g = this.g;
    this.active = false;
    g.building = false;
    this.el.classList.add('hidden');
    this.view.ghost(null);
    this.view.select(-1); this.sel = -1;
    g.hud.show(true);
    g.touch?.show(true);
    g.input.enabled = !g.paused && !g.chatOpen && !g.mapOpen;
    this.bind(false);
    g.audio.setMuted?.('menu', false);
    g.cam.heading = null;
    if (then === 'drive') {
      // the truck where the camera is looking, facing the way it looks
      const x = this.cam.x, z = this.cam.z, spot = g.spotNear(x, z, 0) || { x, z };
      g.vehicle.place(g.world, spot.x, spot.z, this.cam.yaw);
      g.carry = 0; if (g.net) g.net.warp++;
      g.hud.toast('Test drive: Esc > Map builder to build on', false, 4);
    } else if (then === 'race') g.events.startNow('custom');
    g.renderer.renderer.domElement.focus();
  }

  // ---------------------------------------------------------------- the camera
  update(dt) {
    if (!this.active) return;
    const I = this.g.input, C = this.cam, k = C.dist * 0.9 * dt;
    const fx = Math.sin(C.yaw), fz = Math.cos(C.yaw);
    const fwd = (I.any('KeyW', 'ArrowUp') ? 1 : 0) - (I.any('KeyS', 'ArrowDown') ? 1 : 0), side = (I.any('KeyD', 'ArrowRight') ? 1 : 0) - (I.any('KeyA', 'ArrowLeft') ? 1 : 0);
    C.x += (fx * fwd - fz * side) * k; C.z += (fz * fwd + fx * side) * k;
    const lim = this.world.half - 24;
    C.x = Math.max(-lim, Math.min(lim, C.x)); C.z = Math.max(-lim, Math.min(lim, C.z));
    const ty = this.world.height(C.x, C.z), cp = Math.cos(C.pitch);
    const cam = this.g.renderer.camera;
    cam.position.set(C.x - fx * cp * C.dist, ty + Math.sin(C.pitch) * C.dist, C.z - fz * cp * C.dist);
    // (never under the ground)
    const gy = this.world.height(cam.position.x, cam.position.z) + 2;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(C.x, ty, C.z);
    if (this.hover && this.tool) this.view.ghost(this.tool, this.hover.x, this.hover.z, this.ghostYaw());
    else this.view.ghost(null);
  }

  /** Which way the ghost faces: a checkpoint on from the last one, else as turned. */
  ghostYaw() {
    if (this.tool === 'checkpoint' && this.hover) {
      const prev = [...this.layout.props].reverse().find((p) => p.type === 'checkpoint' || p.type === 'start');
      if (prev && Math.hypot(this.hover.x - prev.x, this.hover.z - prev.z) > 2) return Math.atan2(this.hover.x - prev.x, this.hover.z - prev.z);
    }
    return this.yaw;
  }

  /** The ground under a point of the screen: { x, z }, or null (the sky). */
  groundAt(cx, cy) {
    const el = this.g.renderer.renderer.domElement, r = el.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), this.g.renderer.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let prev = 0;
    for (let t = 1; t < 3000; t *= 1.04) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.world.height(x, z)) {
        // close in on it
        let a = prev, b = t;
        for (let n = 0; n < 12; n++) { const m = (a + b) / 2; if (o.y + d.y * m < this.world.height(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = t;
    }
    return null;
  }

  /** The prop at a ground point (the nearest whose footprint it is in, or very near), or -1. */
  propAt(pt) {
    let best = -1, bd = Infinity;
    this.layout.props.forEach((p, i) => {
      const d = Math.hypot(pt.x - p.x, pt.z - p.z) - Math.min(reach(p.type), 6);
      if (d < 1 && d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ---------------------------------------------------------------- pointer and keys
  bind(on) {
    const el = this.g.renderer.renderer.domElement;
    if (!this.handlers) {
      this.handlers = {
        down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e), wheel: (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); },
        menu: (e) => e.preventDefault(), key: (e) => this.key(e),
      };
    }
    const H = this.handlers, f = on ? 'addEventListener' : 'removeEventListener';
    el[f]('pointerdown', H.down); el[f]('pointermove', H.move); el[f]('pointerup', H.up); el[f]('pointercancel', H.up);
    el[f]('wheel', H.wheel, { passive: false }); el[f]('contextmenu', H.menu);
    window[f]('keydown', H.key);
    if (!on) this.ptrs.clear();
  }

  zoom(k) { this.cam.dist = Math.max(12, Math.min(420, this.cam.dist * k)); }

  down(e) {
    const el = this.g.renderer.renderer.domElement;
    el.setPointerCapture?.(e.pointerId);
    const p = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, button: e.button, t: performance.now() };
    this.ptrs.set(e.pointerId, p);
    this.moved = false;
    this.pinch = null;
    // pressing on the picked prop: drag it
    this.dragging = false;
    if (this.ptrs.size === 1 && e.button === 0 && !this.tool && this.sel >= 0) {
      const pt = this.groundAt(e.clientX, e.clientY);
      if (pt && this.propAt(pt) === this.sel) { this.dragging = true; this.snapshot(); }
    }
  }

  move(e) {
    const pt = this.groundAt(e.clientX, e.clientY);
    this.hover = pt;
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) this.moved = true;
    p.x = e.clientX; p.y = e.clientY;
    if (this.ptrs.size === 2) {
      // two fingers: pinch to zoom, twist and lift to turn the view
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x), my = (a.y + b.y) / 2;
      if (this.pinch) {
        this.zoom(this.pinch.d / d);
        this.cam.yaw -= ang - this.pinch.ang;
        this.cam.pitch = Math.max(0.25, Math.min(1.45, this.cam.pitch + (my - this.pinch.my) * 0.004));
      }
      this.pinch = { d, ang, my };
      return;
    }
    if (!this.moved) return;
    if (this.dragging && pt) {
      const q = this.layout.props[this.sel];
      q.x = round(pt.x); q.z = round(pt.z);
      this.apply(false);
      this.view.select(this.sel);
      return;
    }
    if (p.button === 2 || e.shiftKey) {
      // turn the view
      this.cam.yaw -= dx * 0.006;
      this.cam.pitch = Math.max(0.25, Math.min(1.45, this.cam.pitch + dy * 0.004));
    } else {
      // pan: the ground follows the pointer
      const s = this.cam.dist * 0.0023, fx = Math.sin(this.cam.yaw), fz = Math.cos(this.cam.yaw);
      this.cam.x += (fz * dx + fx * dy) * s; this.cam.z += (-fx * dx + fz * dy) * s;
    }
  }

  up(e) {
    const p = this.ptrs.get(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (this.dragging) { this.dragging = false; this.apply(); this.view.select(this.sel); return; }
    if (!p || this.moved || this.ptrs.size || p.button !== 0) return;
    const pt = this.groundAt(e.clientX, e.clientY);
    if (!pt) return;
    if (this.tool) { this.place(this.tool, pt.x, pt.z, this.ghostYaw()); return; }
    this.sel = this.propAt(pt);
    this.view.select(this.sel);
    this.drawStatus();
  }

  key(e) {
    if (!this.active || e.target?.tagName === 'INPUT') return;
    const k = e.code;
    if (k === 'KeyQ') this.turn(-STEP);
    else if (k === 'KeyE') this.turn(STEP);
    else if ((k === 'Delete' || k === 'Backspace') && this.sel >= 0) this.remove(this.sel);
    else if (k === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.undo();
    else if (k === 'Escape') { if (this.tool) this.setTool(null); else if (this.sel >= 0) { this.sel = -1; this.view.select(-1); this.drawStatus(); } else this.close(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  setTool(type) {
    this.tool = type;
    if (type) { this.sel = -1; this.view.select(-1); }
    for (const b of this.el.querySelectorAll('[data-prop]')) b.classList.toggle('on', (b.dataset.prop || null) === (type || 'select'));
    this.drawStatus();
  }

  // ---------------------------------------------------------------- the panels
  buildUI() {
    const el = this.el = $('builder');
    const groups = GROUPS.map((G) => `<div class="b-group"><span>${G}</span><div>${PROP_IDS.filter((id) => PROP_TYPES[id].group === G).map((id) => `<button data-prop="${id}" title="${escapeHtml(PROP_TYPES[id].name)}" style="color:${PROP_TYPES[id].color}">${icon(id)}<i>${escapeHtml(PROP_TYPES[id].name)}</i></button>`).join('')}</div></div>`).join('');
    $('b-palette').innerHTML = `<div class="b-group"><span>Edit</span><div><button data-prop="select" title="Pick, move, turn and take away">${icon('select')}<i>Pick</i></button></div></div>${groups}`;
    $('b-palette').addEventListener('click', (e) => { const b = e.target.closest('[data-prop]'); if (b) this.setTool(b.dataset.prop === 'select' ? null : b.dataset.prop); });
    this.nameEl = $('b-name');
    this.nameEl.value = this.layout.name;
    this.nameEl.addEventListener('change', () => { this.layout.name = this.nameEl.value.trim().slice(0, 40); this.apply(); });
    this.nameEl.addEventListener('keydown', (e) => e.stopPropagation());
    const on = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(); });
    on('b-undo', () => this.undo());
    on('b-left', () => this.turn(-STEP));
    on('b-right', () => this.turn(STEP));
    on('b-del', () => this.remove(this.sel));
    on('b-clear', () => this.clear());
    on('b-drive', () => this.close('drive'));
    on('b-race', () => this.close('race'));
    on('b-exit', () => this.close());
    on('b-share', () => this.share());
    on('b-maps', () => this.showMaps());
  }

  drawStatus() {
    if (!this.el) return;
    const n = this.layout.props.length, cps = this.layout.props.filter((p) => p.type === 'checkpoint').length, start = this.layout.props.some((p) => p.type === 'start');
    $('b-count').textContent = `${n}/${MAX_PROPS}`;
    $('b-race').classList.toggle('hidden', !(start && cps));
    $('b-del').disabled = this.sel < 0;
    const T = this.tool && PROP_TYPES[this.tool];
    $('b-hint').textContent = T
      ? `${T.name}: click the ground to put it down · Q / E turn it${this.tool === 'checkpoint' ? ' (it faces on from the last one)' : ''} · Esc puts it back`
      : this.sel >= 0 ? `${PROP_TYPES[this.layout.props[this.sel].type].name}: drag to move · Q / E turn · Del takes it away`
        : `Pick a prop below, or click one to move it · drag to look about, right-drag to turn, wheel to zoom${start && cps ? '' : ' · a start line and checkpoints make it a race'}`;
  }

  /** SHARE: a link that opens this map, built, for anyone. */
  share() {
    const code = encodeLayout({ ...this.layout, map: this.map });
    const url = `${location.origin}${location.pathname}?map=${this.map}&layout=${code}`;
    const box = $('b-sharebox');
    box.classList.remove('hidden');
    box.innerHTML = `<b>Share this map</b><p class="dim">Anyone who opens the link drives your map${this.layout.props.length ? ` (${this.layout.props.length} props)` : ''}.</p>
      <div class="invite-row"><input readonly value="${escapeHtml(url)}"><button class="primary small" id="b-copy">Copy</button></div><button class="ghost small" id="b-shareclose">Close</button>`;
    const inp = box.querySelector('input');
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    $('b-copy').onclick = async () => { try { await navigator.clipboard.writeText(url); $('b-copy').textContent = 'Copied'; } catch { inp.select(); document.execCommand?.('copy'); } };
    $('b-shareclose').onclick = () => box.classList.add('hidden');
  }

  /** MY MAPS: keep this one under its name; open, or throw away, the ones kept. */
  showMaps() {
    const box = $('b-sharebox');
    box.classList.remove('hidden');
    const mine = this.store.saved.filter((s) => s.map === this.map);
    box.innerHTML = `<b>My maps on ${escapeHtml(this.world.map.name)}</b>
      <div class="b-maps">${mine.map((s, i) => `<div class="b-maprow"><span>${escapeHtml(s.name || 'Untitled')} <small>${s.props.length} props</small></span><button class="ghost small" data-load="${i}">Open</button><button class="ghost small" data-drop="${i}">Delete</button></div>`).join('') || '<p class="dim">None kept yet.</p>'}</div>
      <div class="invite-row"><button class="primary small" id="b-keep">Keep this one${this.layout.name ? ` as "${escapeHtml(this.layout.name)}"` : ''}</button><button class="ghost small" id="b-new">Start a new, empty one</button><button class="ghost small" id="b-mapsclose">Close</button></div>`;
    box.onclick = (e) => {
      const l = e.target.closest('[data-load]'), d = e.target.closest('[data-drop]');
      if (l) { this.load(mine[+l.dataset.load]); box.classList.add('hidden'); }
      else if (d) { this.store.saved.splice(this.store.saved.indexOf(mine[+d.dataset.drop]), 1); this.saveStore(); this.showMaps(); }
    };
    $('b-keep').onclick = () => {
      if (!this.layout.name) { const n = prompt('A name for this map:', 'My course'); if (!n) return; this.layout.name = n.trim().slice(0, 40); this.nameEl.value = this.layout.name; }
      const k = this.store.saved.findIndex((s) => s.map === this.map && s.name === this.layout.name);
      const copy = { map: this.map, name: this.layout.name, props: JSON.parse(JSON.stringify(this.layout.props)), at: Date.now() };
      if (k >= 0) this.store.saved[k] = copy; else this.store.saved.push(copy);
      this.saveStore(); this.apply(false); this.showMaps();
    };
    $('b-new').onclick = () => { this.snapshot(); this.load({ name: '', props: [] }); box.classList.add('hidden'); };
    $('b-mapsclose').onclick = () => box.classList.add('hidden');
  }

  /** A layout from a link (?layout=...), for this map: null if it isn't one. */
  static fromLink(code) { return decodeLayout(code); }
}

const round = (v) => Math.round(v * 10) / 10;
const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
