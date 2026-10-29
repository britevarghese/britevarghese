// Shared PBR materials built from real texture sets (albedo + OpenGL normal + AO/Roughness/Metal packed maps).
// Building geometry carries UVs in metres; each material repeats its texture at the real size of the scanned
// surface (clones share the image source: one GPU upload, own repeat).
import * as THREE from 'three';

// real-world size (m) covered by one texture tile, per texture set (Poly Haven scans)
const TEX_SIZE = { concrete: 2.71, plaster: 1.8, brick: 1.5, plaster_painted: 1.5, brick_clean: 3.0, roof_tiles: 2.5, concrete_slab: 2.3, concrete_floor: 3.0, corrugated: 2.7, rusty_metal: 1.0, plywood: 1.2, asphalt: 3.0 };
// mean linear albedo of a texture, for materials that recolour it (vertex colour = the wanted albedo)
const TEX_MEAN = { plaster_painted: [0.3, 0.28, 0.22], plaster: [0.18, 0.155, 0.107], plywood: [0.2, 0.12, 0.05], concrete: [0.27, 0.24, 0.16] };

// Building materials by logical name (shared/map.js and the client's facade details use these names):
// [texture set, options]. `paint`: the texture only adds detail (its mean colour is divided out, contrast scaled by
// the value) and the vertex colour is the albedo — one material for every house colour.
const BUILDING = {
  concrete: ['concrete', {}],
  plaster: ['plaster', {}],
  brick: ['brick', {}],
  plaster_paint: ['plaster_painted', { paint: 0.7 }],
  // damaged houses: the same plaster, rougher and dirtier (darker vertex colour, more grime); the peeling-plaster scan's
  // patches repeat every 1.8 m and read as camouflage even toned down
  plaster_worn: ['plaster_painted', { paint: 1 }],
  brick_clean: ['brick_clean', {}],
  brick_worn: ['brick_clean', {}], // sooty (darker vertex colour): the crumbling scan's blotches read as camouflage
  metal_siding: ['corrugated', { color: 0xb8c0c4 }],
  concrete_slab: ['concrete_slab', {}],
  concrete_floor: ['concrete_floor', {}],
  roof: ['concrete_floor', { color: 0x9a9a98 }],
  roof_tiles: ['roof_tiles', { roughness: 0.9 }],
  metal_roof: ['corrugated', { color: 0x8f969a }],
  skylight: ['corrugated', { color: 0xd8e2e4, metalness: 0, roughness: 0.4 }],
  metal: ['rusty_metal', {}],
  metal_paint: ['plaster_painted', { paint: 0.25, metalness: 0, roughness: 0.55 }],
  plaster_int: ['concrete', { color: 0xf2eee6, normal: 0.6 }],
  trim: ['plaster_painted', { paint: 0.45 }],
  plinth: ['concrete_slab', { color: 0x8c8a86 }],
  frame: ['rusty_metal', { color: 0x6f6f6f }],
  frame_paint: ['plaster_painted', { paint: 0.2, roughness: 0.6, metalness: 0 }],
  wood: ['plywood', {}],
  wood_paint: ['plywood', { paint: 0.5, metalness: 0 }],
  container: ['corrugated', {}],
  asphalt: ['asphalt', {}],
};
// facade weathering (see #weather): grime at the foot of the wall / rain streaks under ledges, per material
const WEATHER = { plaster_paint: [1, 1], plaster_worn: [1.4, 1.3], brick_clean: [0.8, 0.6], brick_worn: [0.7, 0.5], concrete: [1, 1], concrete_slab: [0.9, 0.8], metal_siding: [0.8, 0.7], trim: [0.8, 0.8], plinth: [0.6, 0], roof_tiles: [0, 0], metal_roof: [0, 0], frame_paint: [0.5, 0], wood_paint: [0.5, 0], metal_paint: [0.4, 0] };

export class MaterialLibrary {
  constructor(assets, quality) {
    this.assets = assets;
    this.quality = quality;
    this.cache = new Map();
    this.sets = new Map();
  }

  // texture set repeating every `scale` metres (on metre UVs); clones share the image (no extra upload)
  #set(key, scale) {
    const t = this.assets.textureSet(key);
    if (!scale) return t;
    const id = `${key}|${scale}`;
    if (!this.sets.has(id)) {
      const c = {};
      for (const k of ['map', 'normalMap', 'arm']) {
        c[k] = t[k].clone(); c[k].repeat.set(1 / scale, 1 / scale);
        // image still loading: wait for it like the original does (the loader flags the clones, AssetManager.texture)
        if (!t[k].image) { c[k].version = 0; (t[k].clones || (t[k].clones = [])).push(c[k]); }
      }
      this.sets.set(id, c);
    }
    return this.sets.get(id);
  }

  pbr(key, opts = {}) {
    const id = `${key}|${JSON.stringify(opts)}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const t = this.#set(key, opts.scale);
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

  // Building materials by logical name, mapped at the textures' real size (geometry UVs in metres).
  // weather: the geometry has the `weather` attribute (height above the building's base, under-sill mask) and the
  // material adds world-space macro variation, grime and rain streaks (buildings only; props share the plain one).
  building(name, { weather = false } = {}) {
    const [k, o] = BUILDING[name] || BUILDING.concrete;
    const w = weather ? WEATHER[name] || null : null;
    const id = `bld|${name}|${w ? w.join(',') : ''}`;
    if (this.cache.has(id)) return this.cache.get(id);
    const { paint, ...rest } = o;
    const m = this.pbr(k, { vertexColors: true, ...rest, scale: TEX_SIZE[k] }).clone();
    m.name = name;
    if (paint !== undefined || w) this.#weather(m, k, paint, w);
    if (name === 'plaster_int') {
      // cheap stand-in for bounced daylight inside rooms (no extra lights / passes)
      m.emissive = new THREE.Color(0x3a3834); m.emissiveMap = m.map; m.emissiveIntensity = 1;
    }
    this.cache.set(id, m);
    return m;
  }

  // Facade shader: `paint` divides the texture's mean colour out (so the vertex colour is the albedo) and scales its
  // contrast; weathering (world space, no textures): low-frequency patches so big walls don't look tiled, a darker
  // splash zone along the foot of the wall with a ragged edge, and vertical streaks below window sills (geometry
  // mask) and floor bands (every 3.2 m), on vertical faces only. Per-material amounts are uniforms, so every building
  // material shares one program (the noise is skipped on VERY LOW).
  #weather(m, texKey, paint, w) {
    const mean = paint !== undefined ? TEX_MEAN[texKey] || [0.25, 0.25, 0.25] : [1, 1, 1];
    const u = { wMean: { value: new THREE.Vector3(...mean) }, wPaint: { value: paint ?? 1 }, wAmt: { value: new THREE.Vector3(w ? 1 : 0, w ? w[0] : 0, w ? w[1] : 0) } };
    const full = this.quality !== 'verylow';
    m.customProgramCacheKey = () => (full ? 'bldw' : 'bldw0');
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      if (full) {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec2 weather;\nvarying vec2 vWeather;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeather = weather; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      }
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 wMean; uniform float wPaint; uniform vec3 wAmt; // wAmt: macro variation on/off, grime, streaks
${full ? `varying vec2 vWeather; varying vec3 vWPos; varying vec3 vWN;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }` : ''}`)
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  sampledDiffuseColor.rgb = max(mix(wMean, sampledDiffuseColor.rgb, wPaint) / wMean, 0.0);
  diffuseColor *= sampledDiffuseColor;
#endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
${full ? `if (wAmt.x > 0.5) {
  vec3 wp = vWPos;
  float side = 1.0 - abs(vWN.y);
  float along = abs(vWN.x) > 0.5 ? wp.z : wp.x;
  // macro variation (±9 %, slightly warmer where darker)
  float mv = wNoise(wp.xz * 0.09 + wp.y * 0.06) * 0.6 + wNoise(vec2(along * 0.45, wp.y * 0.3) + wp.xz * 0.05) * 0.4;
  diffuseColor.rgb *= mix(vec3(0.9, 0.88, 0.85), vec3(1.08), mv);
  // splash zone / ground grime with a ragged top edge
  float h = vWeather.x + (wNoise(vec2(along * 1.3, wp.y * 0.7)) - 0.5) * 0.45;
  float gr = (1.0 - smoothstep(0.0, 1.05, h)) * side * wAmt.y;
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.55, 0.48), gr);
  // rain streaks: below the sill (masked wall pieces) and below the floor bands / eaves
  float dSill = max(0.0, 0.89 - mod(vWeather.x, 3.2)), dBand = 3.2 - mod(vWeather.x + 0.28, 3.2);
  float src = vWeather.y * exp(-dSill * 1.6) + 0.55 * exp(-dBand * 1.2);
  float sk = wNoise(vec2(along * 7.0, wp.y * 0.25)) * wNoise(vec2(along * 2.3 + 7.0, wp.y * 0.6));
  diffuseColor.rgb *= 1.0 - 0.32 * wAmt.z * side * src * smoothstep(0.12, 0.5, sk);
}` : ''}`);
    };
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
// UVs are world coordinates / tile (tile 1 = metres, for building materials). color(p, part, n, mat) -> [r,g,b];
// weather(p, part, n, mat) -> [height above base, under-sill mask] adds the `weather` attribute.
// into: a MeshBuckets to append to (one set of buckets for many calls, no merge pass); then nothing is returned.
const FACES = [
  { n: [1, 0, 0], u: 2, v: 1, s: 1 }, { n: [-1, 0, 0], u: 2, v: 1, s: -1 },
  { n: [0, 1, 0], u: 0, v: 2, s: 1 }, { n: [0, -1, 0], u: 0, v: 2, s: -1 },
  { n: [0, 0, 1], u: 0, v: 1, s: 1 }, { n: [0, 0, -1], u: 0, v: 1, s: -1 },
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];
export function buildBoxGeometry(parts, { tile = 2.5, faceMat = null, color = null, weather = null, into = null } = {}) {
  const buckets = into ? null : new Map();
  const get = into ? (k) => into.bucket(k) : (k) => { let b = buckets.get(k); if (!b) buckets.set(k, (b = { p: [], n: [], uv: [], c: [], w: [], i: [] })); return b; };
  const fc = [0, 0, 0], p = [0, 0, 0];
  for (const part of parts) {
    const mn = part.min, mx = part.max;
    for (let fi = 0; fi < 6; fi++) {
      if (part.hide === fi) continue; // a face against a wall, never seen
      const f = FACES[fi], axis = f.n[0] ? 0 : f.n[1] ? 1 : 2;
      fc[0] = (mn[0] + mx[0]) / 2; fc[1] = (mn[1] + mx[1]) / 2; fc[2] = (mn[2] + mx[2]) / 2;
      fc[axis] = f.s > 0 ? mx[axis] : mn[axis];
      const matName = faceMat ? faceMat(part, f.n, fc) : part.mat;
      if (!matName) continue;
      const b = get(matName);
      const base = b.p.length / 3;
      // 4 corners (p is reused: the callbacks must not keep it)
      const ua = f.u, va = f.v, sgn = axis === 0 ? -f.s : f.s;
      for (let k = 0; k < 4; k++) {
        const cu = CORNERS[k][0], cv = CORNERS[k][1];
        p[axis] = f.s > 0 ? mx[axis] : mn[axis];
        p[ua] = cu ? mx[ua] : mn[ua];
        p[va] = cv ? mx[va] : mn[va];
        b.p.push(p[0], p[1], p[2]);
        b.n.push(f.n[0], f.n[1], f.n[2]);
        b.uv.push((p[ua] * (axis === 1 ? 1 : sgn)) / tile, p[va] / tile);
        const col = color ? color(p, part, f.n, matName) : [1, 1, 1];
        b.c.push(col[0], col[1], col[2]);
        if (weather) { const w = weather(p, part, f.n, matName); b.w.push(w[0], w[1]); }
      }
      // winding: ensure CCW when viewed from outside
      const flip = (axis === 0 && f.s > 0) || (axis === 1 && f.s > 0) || (axis === 2 && f.s < 0);
      if (!flip) b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  if (into) return null;
  const out = new Map();
  for (const [k, b] of buckets) out.set(k, toGeometry(b, !!weather));
  return out;
}

function toGeometry(b, weather) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
  if (weather) g.setAttribute('weather', new THREE.Float32BufferAttribute(b.w, 2));
  g.setIndex(b.i);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ free-form geometry with the same attributes
// (position, normal, metre UVs, colour, weather) as buildBoxGeometry, bucketed by material: sloped roof planes,
// gable triangles, rotated beams, ridge caps. `w` is a function p -> [height above base, mask] (it may be swapped
// between buildings: everything appended goes to the same per-material buckets).
export class MeshBuckets {
  constructor(w) { this.w = w; this.b = new Map(); }

  bucket(k) { let b = this.b.get(k); if (!b) this.b.set(k, (b = { p: [], n: [], uv: [], c: [], w: [], i: [] })); return b; }

  // convex polygon facing `n` (either winding: it is flipped to counter-clockwise seen from n); uv(p) -> [u, v] in m
  poly(mat, pts, n, uv, col) {
    if (pts.length < 3) return;
    let nx = 0, ny = 0, nz = 0; // Newell normal
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) pts = [...pts].reverse();
    const b = this.bucket(mat), base = b.p.length / 3;
    for (const p of pts) {
      const t = uv(p), w = this.w(p);
      b.p.push(p[0], p[1], p[2]); b.n.push(n[0], n[1], n[2]); b.uv.push(t[0], t[1]); b.c.push(col[0], col[1], col[2]); b.w.push(w[0], w[1]);
    }
    for (let k = 1; k < pts.length - 1; k++) b.i.push(base, base + k, base + k + 1);
  }

  // planar polygon with its UVs measured along tangent t / bitangent s from its first point
  flat(mat, pts, n, t, s, col) {
    const o = pts[0];
    this.poly(mat, pts, n, (p) => { const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; return [d[0] * t[0] + d[1] * t[1] + d[2] * t[2], d[0] * s[0] + d[1] * s[1] + d[2] * s[2]]; }, col);
  }

  // oriented box: centre c, orthonormal axes ax (length), ay, az with half extents h
  obox(mat, c, ax, ay, az, h, col) {
    const P = (a, b2, d) => [0, 1, 2].map((i) => c[i] + ax[i] * a * h[0] + ay[i] * b2 * h[1] + az[i] * d * h[2]);
    const neg = (v) => v.map((x) => -x);
    // each face: normal, then 4 corners counter-clockwise seen from outside
    const F = [
      [ay, [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)], ax, az],
      [neg(ay), [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)], ax, az],
      [az, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], ax, ay],
      [neg(az), [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)], ax, ay],
      [ax, [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)], az, ay],
      [neg(ax), [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)], az, ay],
    ];
    for (const [n, pts, t, s] of F) this.flat(mat, pts, n, t, s, col);
  }

  // any indexed / non-indexed BufferGeometry (its own UVs), already in world space
  geometry(mat, g, col) {
    const b = this.bucket(mat), base = b.p.length / 3, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let k = 0; k < P.count; k++) {
      const p = [P.getX(k), P.getY(k), P.getZ(k)];
      b.p.push(p[0], p[1], p[2]); b.n.push(N.getX(k), N.getY(k), N.getZ(k)); b.uv.push(U ? U.getX(k) : 0, U ? U.getY(k) : 0); b.c.push(col[0], col[1], col[2]); const w = this.w(p); b.w.push(w[0], w[1]);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) b.i.push(base + g.index.getX(k));
    else for (let k = 0; k < P.count; k++) b.i.push(base + k);
  }

  geometries() {
    const out = new Map();
    for (const [k, b] of this.b) if (b.i.length) out.set(k, toGeometry(b, true));
    return out;
  }
}
