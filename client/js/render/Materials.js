// Shared PBR materials built from real texture sets (albedo + OpenGL normal + AO/Roughness/Metal packed maps).
import * as THREE from 'three';

export class MaterialLibrary {
  constructor(assets, quality) {
    this.assets = assets;
    this.quality = quality;
    this.cache = new Map();
  }

  pbr(key, opts = {}) {
    const id = `${key}|${JSON.stringify(opts)}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const t = this.assets.textureSet(key);
    const m = new THREE.MeshStandardMaterial({
      name: key,
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.arm,
      metalnessMap: t.arm,
      aoMap: t.arm,
      aoMapIntensity: 0.8,
      metalness: opts.metalness ?? 1,
      roughness: opts.roughness ?? 1,
      color: new THREE.Color(opts.color ?? 0xffffff),
      normalScale: new THREE.Vector2(opts.normal ?? 1, opts.normal ?? 1),
      vertexColors: !!opts.vertexColors,
      envMapIntensity: opts.env ?? 0.8,
      side: opts.side ?? THREE.FrontSide,
    });
    this.cache.set(id, m);
    return m;
  }

  // Building materials by logical name (shared/map.js uses these names)
  building(name) {
    const map = {
      concrete: ['concrete', { vertexColors: true }],
      plaster: ['plaster', { vertexColors: true }],
      brick: ['brick', { vertexColors: true }],
      metal_siding: ['corrugated', { vertexColors: true, color: 0xb8c0c4 }],
      concrete_slab: ['concrete_slab', { vertexColors: true }],
      concrete_floor: ['concrete_floor', { vertexColors: true }],
      roof: ['concrete_floor', { vertexColors: true, color: 0x9a9a98 }],
      metal_roof: ['corrugated', { vertexColors: true, color: 0x8f969a }],
      metal: ['rusty_metal', { vertexColors: true }],
      plaster_int: ['plaster', { vertexColors: true, color: 0xe8e4dc }],
      trim: ['concrete', { vertexColors: true, color: 0xb9b6ae }],
      plinth: ['concrete_slab', { vertexColors: true, color: 0x8c8a86 }],
      frame: ['rusty_metal', { vertexColors: true, color: 0x6f6f6f }],
      wood: ['plywood', { vertexColors: true }],
      container: ['corrugated', { vertexColors: true }],
      asphalt: ['asphalt', {}],
    };
    const [k, o] = map[name] || map.concrete;
    return this.pbr(k, o);
  }

  glass() {
    if (!this.cache.has('glass')) {
      this.cache.set('glass', new THREE.MeshStandardMaterial({ name: 'window_glass', color: 0x7f9aa3, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.38, envMapIntensity: 1.6, depthWrite: false, side: THREE.DoubleSide }));
    }
    return this.cache.get('glass');
  }
}

// ------------------------------------------------------------------ box geometry builder with world-space UVs
// parts: [{ min, max, mat }] ; faceMat(part, faceNormal, center) -> material name ; returns Map(matName -> BufferGeometry)
export function buildBoxGeometry(parts, { tile = 2.5, faceMat = null, color = null, center = null } = {}) {
  const buckets = new Map();
  const get = (k) => { let b = buckets.get(k); if (!b) buckets.set(k, (b = { p: [], n: [], uv: [], c: [], i: [] })); return b; };
  const faces = [
    { n: [1, 0, 0], u: 2, v: 1, s: 1 }, { n: [-1, 0, 0], u: 2, v: 1, s: -1 },
    { n: [0, 1, 0], u: 0, v: 2, s: 1 }, { n: [0, -1, 0], u: 0, v: 2, s: -1 },
    { n: [0, 0, 1], u: 0, v: 1, s: 1 }, { n: [0, 0, -1], u: 0, v: 1, s: -1 },
  ];
  for (const part of parts) {
    const mn = part.min, mx = part.max;
    for (const f of faces) {
      const axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
      const fc = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      fc[axis] = f.s > 0 ? mx[axis] : mn[axis];
      const matName = faceMat ? faceMat(part, f.n, fc) : part.mat;
      if (!matName) continue;
      const b = get(matName);
      const base = b.p.length / 3;
      // 4 corners
      const ua = f.u, va = f.v;
      const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const [cu, cv] of corners) {
        const p = [0, 0, 0];
        p[axis] = f.s > 0 ? mx[axis] : mn[axis];
        p[ua] = cu ? mx[ua] : mn[ua];
        p[va] = cv ? mx[va] : mn[va];
        b.p.push(p[0], p[1], p[2]);
        b.n.push(...f.n);
        const sgn = (axis === 0 ? -f.s : f.s);
        b.uv.push((p[ua] * (axis === 1 ? 1 : sgn)) / tile, (axis === 1 ? p[va] : p[va]) / tile);
        const col = color ? color(p, part, f.n) : [1, 1, 1];
        b.c.push(col[0], col[1], col[2]);
      }
      // winding: ensure CCW when viewed from outside
      const flip = (axis === 0 && f.s > 0) || (axis === 1 && f.s > 0) || (axis === 2 && f.s < 0);
      if (!flip) b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const out = new Map();
  for (const [k, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
    g.setIndex(b.i);
    g.computeBoundingSphere();
    out.set(k, g);
  }
  return out;
}
