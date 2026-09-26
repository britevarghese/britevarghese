// ChunkManager: streams CITY_CHUNK_X_Z groups around the camera with a per-frame time budget,
// two detail levels, material LOD for distant buildings, distance culling and disposal.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

const MIN = -9, MAX = 8;

export class ChunkManager {
  constructor(scene, builder, materials, preset) {
    this.scene = scene;
    this.builder = builder;
    this.M = materials;
    this.preset = preset;
    this.root = new THREE.Group();
    this.root.name = 'city';
    scene.add(this.root);
    this.chunks = new Map(); // key -> {ci, cj, base, detail, far}
    this.queue = [];
    this.nearKeys = [];
    this.nearKeySig = '';
    this.stats = { loaded: 0, detailed: 0, buildMs: 0 };
  }

  setPreset(p) { this.preset = p; this.nearKeySig = ''; }

  // Build everything required around `pos` synchronously (initial load); calls onProgress(0..1)
  async preload(pos, radius, onProgress) {
    const keys = [];
    for (let ci = MIN; ci <= MAX; ci++) for (let cj = MIN; cj <= MAX; cj++) {
      const d = this._dist(ci, cj, pos);
      if (d < radius) keys.push([d, ci, cj]);
    }
    keys.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, ci, cj] of keys) {
      const c = this._ensure(ci, cj);
      this._buildBase(c);
      if (d < this.preset.detailDistance) this._buildDetail(c);
      n++;
      if (n % 3 === 0) { onProgress?.(n / keys.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    onProgress?.(1);
    this.update(pos, 0, true);
  }

  _dist(ci, cj, pos) {
    const cx = (ci + 0.5) * 160, cz = (cj + 0.5) * 160;
    return Math.max(0, Math.hypot(cx - pos.x, cz - pos.z) - 113); // distance to chunk (approx, minus half diagonal)
  }
  _ensure(ci, cj) {
    const key = `${ci},${cj}`;
    let c = this.chunks.get(key);
    if (!c) { c = { key, ci, cj, base: null, detail: null, far: false }; this.chunks.set(key, c); }
    return c;
  }
  _buildBase(c) {
    if (c.base) return;
    const t = performance.now();
    c.base = this.builder.buildBase(c.ci, c.cj);
    this.root.add(c.base);
    this.stats.buildMs = performance.now() - t;
  }
  _buildDetail(c) {
    if (c.detail) return;
    c.detail = this.builder.buildDetail(c.ci, c.cj, this.preset);
    this.root.add(c.detail);
  }
  _dispose(group) {
    if (!group) return;
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.root.remove(group);
  }

  update(pos, dt, force = false) {
    const view = this.preset.viewDistance, detail = this.preset.detailDistance;
    const want = [];
    for (let ci = MIN; ci <= MAX; ci++) for (let cj = MIN; cj <= MAX; cj++) {
      const d = this._dist(ci, cj, pos);
      const key = `${ci},${cj}`;
      const c = this.chunks.get(key);
      if (d < view) {
        if (!c?.base) want.push({ d, ci, cj, level: 'base' });
        else if (d < detail && !c.detail) want.push({ d, ci, cj, level: 'detail' });
      }
      if (!c) this.impostor?.setLoaded(ci, cj, false);
      if (c) {
        if (c.base) {
          c.base.visible = d < view;
          // material LOD: cheaper facade shading for distant chunks
          const far = d > detail * 1.35;
          if (far !== c.far) {
            c.far = far;
            for (const m of c.base.userData.meshes) {
              if (m.userData.facade !== undefined) m.material = far ? this.M.facadesFar[m.userData.facade] : this.M.facades[m.userData.facade];
              m.castShadow = !far && m.material !== this.M.road;
            }
          }
        }
        if (c.detail) c.detail.visible = d < detail * 1.15;
        this.impostor?.setLoaded(ci, cj, !!(c.base && c.base.visible));
        // unload far chunks
        if (d > view + 220 && c.base) { this._dispose(c.base); c.base = null; this._dispose(c.detail); c.detail = null; this.chunks.delete(key); }
        else if (d > detail + 200 && c.detail) { this._dispose(c.detail); c.detail = null; }
      }
    }
    // build queue: nearest first, within a time budget (avoid frame spikes)
    want.sort((a, b) => a.d - b.d);
    const budget = force ? 1e9 : 5; // ms
    const t0 = performance.now();
    for (const w of want) {
      const c = this._ensure(w.ci, w.cj);
      if (w.level === 'base') this._buildBase(c); else this._buildDetail(c);
      if (performance.now() - t0 > budget) break;
    }
    // near set for props/lights
    const near = [];
    for (const c of this.chunks.values()) if (c.base && this._dist(c.ci, c.cj, pos) < detail) near.push(c.key);
    near.sort();
    const sig = near.join('|');
    if (sig !== this.nearKeySig) {
      this.nearKeySig = sig;
      this.nearKeys = near;
      this.nearPos = { x: pos.x, z: pos.z };
      bus.emit('chunks:near', near);
    }
    let loaded = 0, detailed = 0;
    for (const c of this.chunks.values()) { if (c.base) loaded++; if (c.detail) detailed++; }
    this.stats.loaded = loaded; this.stats.detailed = detailed; this.stats.pending = want.length;
  }
}
