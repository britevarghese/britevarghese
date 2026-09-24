// Centralized AssetManager: GLB/GLTF, KTX2, WebP/PNG/JPEG, JSON and audio with caching,
// priority queue, progress reporting and non-fatal error handling.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { bus } from '../core/EventBus.js';

export const PRIORITY = { VEHICLE: 1, ROAD: 2, BUILDINGS: 3, TRAFFIC: 4, ENVIRONMENT: 5, COSMETIC: 6 };

export class AssetManager {
  constructor() {
    this.cache = new Map();     // url -> Promise<asset>
    this.loaded = new Map();    // url -> asset
    this.errors = [];
    this.manager = new THREE.LoadingManager();
    this.gltf = new GLTFLoader(this.manager);
    this.gltf.setMeshoptDecoder(MeshoptDecoder); // imported real-car models are meshopt-compressed
    this.texLoader = new THREE.TextureLoader(this.manager);
    this.ktx2 = null;
    this.pending = 0; this.done = 0;
    this.queue = [];
    this.active = 0;
    this.maxConcurrent = 4;
  }

  // Enable KTX2/Basis Universal textures once a renderer exists.
  initKTX2(renderer) {
    try {
      this.ktx2 = new KTX2Loader(this.manager).setTranscoderPath('/vendor/three/addons/libs/basis/').detectSupport(renderer);
      this.gltf.setKTX2Loader(this.ktx2);
    } catch (e) { console.warn('[Assets] KTX2 unavailable, falling back to WebP/PNG', e); }
  }

  get progress() { return this.pending === 0 ? 1 : this.done / this.pending; }

  _enqueue(url, priority, fn) {
    if (this.cache.has(url)) return this.cache.get(url);
    this.pending++;
    const p = new Promise((resolve, reject) => {
      this.queue.push({ priority, run: () => fn().then(resolve, reject) });
      this.queue.sort((a, b) => a.priority - b.priority);
      this._pump();
    }).then((asset) => {
      this.loaded.set(url, asset); this.done++; bus.emit('assets:progress', this.progress); return asset;
    }, (err) => {
      this.done++;
      const file = url.split('/').pop();
      this.errors.push({ url, file, error: String(err?.message || err) });
      console.error(`[Assets] ASSET LOAD ERROR: ${file}`, err);
      bus.emit('asset:error', { url, file, error: String(err?.message || err) });
      bus.emit('assets:progress', this.progress);
      throw err;
    });
    this.cache.set(url, p);
    return p;
  }

  _pump() {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      job.run().finally(() => { this.active--; this._pump(); });
    }
  }

  loadGLTF(url, priority = PRIORITY.COSMETIC) {
    return this._enqueue(url, priority, () => this.gltf.loadAsync(url));
  }

  loadTexture(url, priority = PRIORITY.ENVIRONMENT, { srgb = true, fallbackColor = 0x808080 } = {}) {
    const isKTX = url.endsWith('.ktx2');
    return this._enqueue(url, priority, () => (isKTX && this.ktx2 ? this.ktx2.loadAsync(url) : this.texLoader.loadAsync(url)).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })).catch(() => this.fallbackTexture(fallbackColor));
  }

  // Try formats in order of preference (KTX2 -> WebP -> PNG/JPEG).
  async loadTextureBest(base, priority, opts) {
    const exts = this.ktx2 ? ['.ktx2', '.webp', '.png', '.jpg'] : ['.webp', '.png', '.jpg'];
    for (const ext of exts) {
      try { return await this._enqueue(base + ext, priority, () => (ext === '.ktx2' ? this.ktx2.loadAsync(base + ext) : this.texLoader.loadAsync(base + ext))); } catch { /* try next */ }
    }
    return this.fallbackTexture(opts?.fallbackColor ?? 0x808080);
  }

  loadJSON(url, priority = PRIORITY.ROAD) {
    return this._enqueue(url, priority, async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }

  loadAudio(url, ctx, priority = PRIORITY.COSMETIC) {
    return this._enqueue(url, priority, async () => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ctx.decodeAudioData(await r.arrayBuffer());
    });
  }

  fallbackTexture(color = 0x808080) {
    const key = 'fallback:' + color;
    if (this.loaded.has(key)) return this.loaded.get(key);
    const c = new THREE.Color(color);
    const data = new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]);
    const t = new THREE.DataTexture(data, 1, 1);
    t.needsUpdate = true;
    this.loaded.set(key, t);
    return t;
  }

  // Correct cloning: skinned meshes need SkeletonUtils; geometry/materials stay shared.
  static clone(object) {
    let skinned = false;
    object.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
    return skinned ? SkeletonUtils.clone(object) : object.clone(true);
  }

  stats() { return { cached: this.loaded.size, errors: this.errors.length }; }
}
