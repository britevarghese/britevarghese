// Theyyam masks: 50 hidden collectibles, GTA hidden-package style. Theyyam is the ritual art of North Malabar -
// Kannur's own - and one painted mask is hidden in each of 50 towns and villages around Kannur (Thalassery, Mahe,
// Taliparamba, Mattannur...). Each is set down beside the road near the place's centre once its ground is built.
// Close by it shimmers and chimes; touch it to collect. Every mask pays, and 10 / 25 / 50 pay a bonus.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { formatMoney } from '../core/util.js';
import { START } from '../kerala/KeralaWorld.js';

export const MASK_COUNT = 50;
const MIN_SPACING = 2000, RADIUS = 32000;
const RANK = { city: 0, town: 1, suburb: 2, village: 3 };
const MILESTONES = { 10: 10000, 25: 30000, 50: 100000 };

// the 50 places: cities, towns, suburbs, then villages near Kannur, at least 2 km apart
export function maskPlaces(places, start) {
  const C = (places || []).filter((p) => RANK[p[0]] !== undefined)
    .map((p) => ({ name: String(p[1]).split(';')[0], kind: p[0], x: -p[3], z: p[4], d: Math.hypot(-p[3] - start.x, p[4] - start.z) }))
    .filter((o) => o.d < RADIUS)
    .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.d - b.d);
  const pick = [];
  for (const o of C) {
    if (pick.length >= MASK_COUNT) break;
    if (pick.every((q) => Math.hypot(q.x - o.x, q.z - o.z) > MIN_SPACING)) pick.push(o);
  }
  return pick.sort((a, b) => a.d - b.d).map((o, i) => ({ ...o, id: i }));
}

// a painted Theyyam face: red, the black-and-white eyes, a gold thirumudi (head-dress) behind
export function maskTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), C = 128;
  // thirumudi: gold ray-disc with red rim
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    g.fillStyle = i % 2 ? '#ffcc33' : '#e8a020';
    g.beginPath(); g.moveTo(C, C);
    g.lineTo(C + Math.cos(a - 0.12) * 124, C + Math.sin(a - 0.12) * 124);
    g.lineTo(C + Math.cos(a + 0.12) * 124, C + Math.sin(a + 0.12) * 124);
    g.closePath(); g.fill();
  }
  g.strokeStyle = '#b01818'; g.lineWidth = 8; g.beginPath(); g.arc(C, C, 118, 0, 7); g.stroke();
  g.fillStyle = '#fff3c0'; for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2 + 0.11; g.beginPath(); g.arc(C + Math.cos(a) * 104, C + Math.sin(a) * 104, 4, 0, 7); g.fill(); }
  // face
  g.fillStyle = '#d4231a'; g.beginPath(); g.ellipse(C, C + 8, 58, 70, 0, 0, 7); g.fill();
  g.strokeStyle = '#ffd24a'; g.lineWidth = 4; g.beginPath(); g.ellipse(C, C + 8, 58, 70, 0, 0, 7); g.stroke();
  // eyes: white almond, black outline, a curl at the corner
  for (const s of [-1, 1]) {
    g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 5;
    g.beginPath(); g.ellipse(C + s * 24, C - 4, 17, 9, s * 0.2, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(C + s * 24, C - 4, 5, 0, 7); g.fill();
    g.beginPath(); g.moveTo(C + s * 40, C - 8); g.quadraticCurveTo(C + s * 56, C - 18, C + s * 50, C - 30); g.stroke();
  }
  // brow and forehead mark
  g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.moveTo(C - 44, C - 24); g.quadraticCurveTo(C, C - 44, C + 44, C - 24); g.stroke();
  g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(C, C - 52); g.lineTo(C - 7, C - 30); g.lineTo(C + 7, C - 30); g.closePath(); g.fill();
  // nose, mouth and the white dotted cheek patterns
  g.strokeStyle = '#111'; g.lineWidth = 4; g.beginPath(); g.moveTo(C, C + 2); g.lineTo(C - 6, C + 22); g.lineTo(C + 6, C + 22); g.stroke();
  g.fillStyle = '#111'; g.beginPath(); g.ellipse(C, C + 44, 22, 9, 0, 0, Math.PI); g.fill();
  g.fillStyle = '#fff'; for (const s of [-1, 1]) for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(C + s * (30 + k * 3), C + 22 + k * 6, 2.6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Collectibles {
  constructor(game) {
    this.game = game;
    const w = game.world;
    this.enabled = !!(w.kerala && w.index?.places);
    game.save.data.masks ??= {};
    this.places = this.enabled ? maskPlaces(w.index.places, START) : [];
    this.spots = new Map();   // id -> { x, y, z, mesh }
    this.pingT = 0;
    if (!this.enabled) return;
    this.tex = maskTexture();
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, toneMapped: false });
    this.geo = new THREE.CircleGeometry(0.75, 32);
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.glowGeo = new THREE.CylinderGeometry(0.5, 0.9, 6, 16, 1, true).translate(0, 3, 0);
  }

  get found() { return this.game.save.data.masks; }
  get count() { return Object.keys(this.found).length; }

  // set a mask down on the pavement beside the nearest road to its place's centre, once that ground is built
  _resolve(p) {
    const w = this.game.world;
    if (!w.groundKnown(p.x, p.z, 30)) return null;
    const r = w.roadSpot(p.x, p.z, 7);
    if (!r || Math.hypot(r.x - p.x, r.z - p.z) > 400) return { skip: true };
    const sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw); // across the road
    for (const off of [6, 8, 10, 13, 4.5]) for (const side of [1, -1]) {
      const x = r.x + sx * off * side, z = r.z + sz * off * side;
      if (w.offCarriageway(x, z, 0.8) && !w.inWater(x, z)) return { x, z, y: w.groundHeight(x, z) };
    }
    return { skip: true };
  }

  _spawn(p, at) {
    const mesh = new THREE.Group();
    const face = new THREE.Mesh(this.geo, this.mat); face.position.y = 1.4;
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat); glow.visible = false;
    mesh.add(face, glow);
    mesh.position.set(at.x, at.y, at.z);
    this.game.scene.add(mesh);
    this.spots.set(p.id, { ...at, mesh, face, glow, place: p });
  }

  update(dt) {
    if (!this.enabled) return;
    const g = this.game, f = g.focusState, t = performance.now() / 1000;
    this.pingT -= dt;
    let nearest = Infinity;
    for (const p of this.places) {
      if (this.found[p.id]) continue;
      const far = Math.hypot(p.x - f.x, p.z - f.z);
      let s = this.spots.get(p.id);
      if (!s && far < 700) {
        if (!(this._tries ||= {})[p.id] || t - this._tries[p.id] > 3) {
          this._tries[p.id] = t;
          const at = this._resolve(p);
          if (at && !at.skip) { this._spawn(p, at); s = this.spots.get(p.id); }
          else if (at?.skip) this._tries[p.id] = t + 60; // nowhere sensible here yet: look again in a minute
        }
      }
      if (!s) continue;
      const d = Math.hypot(s.x - f.x, s.z - f.z);
      if (d > 900) { this._drop(p.id); continue; }
      s.mesh.visible = d < 260;
      if (!s.mesh.visible) continue;
      s.face.rotation.y = t * 1.2;
      s.face.position.y = 1.4 + Math.sin(t * 2 + p.id) * 0.12;
      s.glow.visible = d < 80;
      s.glow.material.opacity = 0.18 + 0.12 * Math.sin(t * 3);
      nearest = Math.min(nearest, d);
      if (d < (g.onFoot?.active ? 2.6 : 4.2) && Math.abs((f.y ?? s.y) - s.y) < 3) this._collect(p);
    }
    // a soft chime when one is close, quicker the closer it is
    if (nearest < 70 && this.pingT <= 0) {
      g.audio?.playEvent?.('checkpoint', { volume: 0.25 + 0.4 * (1 - nearest / 70) });
      this.pingT = 0.6 + (nearest / 70) * 2.4;
    }
  }

  _drop(id) {
    const s = this.spots.get(id);
    if (!s) return;
    s.mesh.removeFromParent();
    this.spots.delete(id);
  }

  _collect(p) {
    const g = this.game;
    this.found[p.id] = { at: Date.now(), place: p.name };
    this._drop(p.id);
    const n = this.count;
    const cash = 500, xp = 100;
    g.save.addCash(cash, '');
    g.progress?.addXp?.(xp, 'mask');
    g.audio?.playEvent?.('purchase');
    g.hud?.message?.(`THEYYAM MASK ${n}/${MASK_COUNT}`, `${p.name.toUpperCase()} · ${formatMoney(cash)} · +${xp} XP`, 3);
    const bonus = MILESTONES[n];
    if (bonus) {
      g.save.addCash(bonus, '');
      setTimeout(() => g.ui?.toast?.(n === MASK_COUNT ? `All ${MASK_COUNT} Theyyam masks found! ${formatMoney(bonus)} bonus. Kannur salutes you.` : `${n} masks found: ${formatMoney(bonus)} bonus`, 'cash', 6), 3200);
    }
    g.save.save?.();
    bus.emit('mask:found', { id: p.id, count: n, place: p.name });
  }

  // nearest uncollected mask's place (for a hint)
  hint() {
    const f = this.game.focusState;
    let best = null, bd = Infinity;
    for (const p of this.places) { if (this.found[p.id]) continue; const d = Math.hypot(p.x - f.x, p.z - f.z); if (d < bd) { bd = d; best = p; } }
    return best ? { name: best.name, km: bd / 1000 } : null;
  }
}
