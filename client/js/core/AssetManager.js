// Central asset manager: manifest-driven GLB loading with caching, candidate-file fallback chains,
// skinned-mesh aware cloning, texture sets and loud missing-asset diagnostics.
// Primitive geometry is NEVER substituted for a character or weapon: a missing asset is an error.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = '/assets/';

export class AssetManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.gltf = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.cache = new Map();      // url -> Promise<gltf>
    this.texCache = new Map();
    this.manifest = null;
    this.report = [];            // diagnostics shown in debug pages / console
    this.errors = [];
    this.maxAnisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
    this.anisotropy = 4;
  }

  async init() {
    const r = await fetch(`${BASE}asset-manifest.json`);
    this.manifest = await r.json();
    return this;
  }

  async #exists(url) {
    if (this.available === undefined) {
      try { const r = await fetch('/api/assets'); this.available = r.ok ? new Set(await r.json()) : null; } catch { this.available = null; }
    }
    if (this.available) return this.available.has(url.slice(BASE.length));
    try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
  }

  // Load first existing candidate. Returns { gltf, file } — throws (and reports) if none exist.
  async loadFirst(kind, key, files) {
    for (const f of files) {
      const url = BASE + f;
      if (!(await this.#exists(url))) continue;
      const gltf = await this.load(url);
      this.report.push({ kind, key, file: f, url });
      return { gltf, file: f, url };
    }
    const msg = `FAILED TO LOAD ${kind} "${key}" — none of [${files.join(', ')}] exist under ${BASE}`;
    console.error(`%c${msg}`, 'color:#fff;background:#b00;padding:2px 6px');
    this.errors.push(msg);
    throw new Error(msg);
  }

  load(url) {
    if (!this.cache.has(url)) {
      this.cache.set(url, new Promise((res, rej) => this.gltf.load(url, (g) => { this.#prepare(g); res(g); }, undefined, (e) => {
        const msg = `FAILED TO LOAD ${url}: ${e.message || e}`;
        console.error(msg); this.errors.push(msg); rej(e);
      })));
    }
    return this.cache.get(url);
  }

  #prepare(g) {
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = this.anisotropy;
      }
    });
  }

  // Clone for a new instance (shares geometry/materials/textures; skinned meshes get their own skeleton).
  clone(gltf) { return SkeletonUtils.clone(gltf.scene); }

  async loadCharacter(key) {
    const def = this.manifest.characters[key];
    if (!def) throw new Error(`Unknown character ${key}`);
    const r = await this.loadFirst('character', key, def.files);
    return { ...r, def };
  }

  async loadWeapon(key) {
    const def = this.manifest.weapons[key];
    if (!def) throw new Error(`Unknown weapon ${key}`);
    const r = await this.loadFirst('weapon', key, def.files);
    // Config (sockets/orientation) only applies to the file it was written for: the default file.
    const isDefault = r.file === def.files[def.files.length - 1];
    let cfg = def;
    if (isDefault && r.file === 'weapons/bolt_action_rifle.glb' && key !== 'bolt_rifle') cfg = { ...this.manifest.weapons.bolt_rifle, files: def.files };
    if (!isDefault) cfg = { ...def, sockets: def.userSockets || null, forward: def.userForward || 'auto', optic: def.userOptic || { type: 'auto' } };
    return { ...r, def: cfg };
  }

  async loadProp(key) { return this.load(BASE + this.manifest.props[key]); }
  async loadVegetation(key) { return this.load(BASE + this.manifest.vegetation[key]); }

  texture(path, srgb = false, repeat = true) {
    const url = BASE + path;
    if (!this.texCache.has(url)) {
      const t = this.texLoader.load(url, undefined, undefined, () => { const m = `FAILED TO LOAD texture ${url}`; console.error(m); this.errors.push(m); });
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.texCache.set(url, t);
    }
    return this.texCache.get(url);
  }

  // PBR set from Poly Haven: diff (sRGB), nor (OpenGL normal), arm (AO/Rough/Metal packed)
  textureSet(key) {
    const p = this.manifest.textures[key];
    return { map: this.texture(`${p}/diff.webp`, true), normalMap: this.texture(`${p}/nor.webp`), arm: this.texture(`${p}/arm.webp`) };
  }

  async loadHDRI(renderer) {
    const tex = await new RGBELoader().loadAsync(BASE + this.manifest.hdri);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    return { background: tex, env };
  }
}

// ------------------------------------------------------------------ diagnostics
export function describeGLTF(label, gltf, file) {
  const meshes = [], mats = new Set(), texs = new Set(), skins = new Set(), bones = [];
  const nodes = [];
  gltf.scene.traverse((o) => {
    nodes.push(o.name || `(${o.type})`);
    if (o.isMesh) {
      meshes.push(o.name);
      for (const m of [o.material].flat()) { mats.add(m.name || m.uuid); for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) texs.add(m[k].uuid); }
      if (o.isSkinnedMesh) skins.add(o.skeleton.uuid);
    }
    if (o.isBone) bones.push(o.name);
  });
  const info = { label, file, meshes: meshes.length, materials: mats.size, textures: texs.size, skeletons: skins.size, bones: bones.length, animations: gltf.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`), nodes };
  console.groupCollapsed(`=== ${label} === ${file}`);
  console.log(`meshes: ${info.meshes}  materials: ${info.materials}  textures: ${info.textures}  skeletons: ${info.skeletons}  bones: ${info.bones}`);
  console.log('animations:', info.animations.join(', ') || 'none');
  console.log('bones:', bones.join(' '));
  console.log('nodes:', nodes.join(' '));
  console.groupEnd();
  return { ...info, boneNames: bones };
}
