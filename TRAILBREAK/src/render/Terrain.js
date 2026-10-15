// Terrain rendering: a quadtree of square patches, each a 32 x 32 grid of quads. Patches near the camera are small
// (16 m, 0.5 m between vertices, fine enough to show ruts), far ones are large; past the map's edge the patches
// follow the far landform out to the horizon. Patches are built on demand (a few per frame), cached, and rebuilt
// where tyres have pressed ruts into the ground. Skirts hide the cracks between patches of different sizes.
//
// Colour: each surface's colour, varied by noise, slope, height and wetness, baked once into a 1 m colour grid with
// mip levels so distant patches show the average colour of the ground they cover. The material adds fine noise.

import * as THREE from 'three';
import { SURFACE } from '../physics/Surfaces.js';
import { farHeight } from '../world/WorldGen.js';
import { MAP_HALF } from '../world/MapData.js';
import { DeformGrid } from '../world/Deform.js';
import { vnoise, fbm } from '../world/Noise.js';

const GRID = 32;
const V = GRID + 1;
const ROOT = 8192;
const MIN = 16;
const SPLIT_DEFAULT = 2.1;
const MAX_CACHE = 700;

const SURF_COLORS = {
  [SURFACE.GRASS]: 0x6f8c3c, [SURFACE.DIRT]: 0x8d7454, [SURFACE.GRAVEL]: 0x958b7c, [SURFACE.ROCK]: 0x8a857d,
  [SURFACE.MUD]: 0x5e4a33, [SURFACE.SAND]: 0xc8b088, [SURFACE.SNOW]: 0xeef1f4, [SURFACE.ROAD]: 0x77705f,
  [SURFACE.RIVERBED]: 0x5f5946, [SURFACE.ICE]: 0xcfe3ec,
};

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const lin = (hex) => [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];

// shared index buffer: grid + skirt
function makeIndex() {
  const idx = [];
  for (let k = 0; k < GRID; k++) for (let i = 0; i < GRID; i++) {
    const a = k * V + i, b = a + 1, c = a + V, d = c + 1;
    if ((i + k) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  // skirt: 4 edges, each V vertices, stored after the grid
  const base = V * V;
  const edge = (e, gi) => base + e * V + gi;
  const edges = [
    (t) => t,                       // top row (k = 0)
    (t) => GRID * V + t,            // bottom row
    (t) => t * V,                   // left column
    (t) => t * V + GRID,            // right column
  ];
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < GRID; t++) {
      const a = edges[e](t), b = edges[e](t + 1), a2 = edge(e, t), b2 = edge(e, t + 1);
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings: skirts seen from either side
    }
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

export class TerrainRenderer {
  constructor(world, scene, { onProgress } = {}) {
    this.world = world;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.index = makeIndex();
    this.cache = new Map();
    this.frame = 0;
    this.material = this.makeMaterial();
    this.buildColors(onProgress);
    this.shadows = true;
    this.tmpH = new Float32Array((V + 2) * (V + 2));
    this.budget = 6;
    this.split = SPLIT_DEFAULT;
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float dist = length(vWPos - cameraPosition);
  float near = clamp(1.0 - dist / 120.0, 0.0, 1.0);
  float mid = clamp(1.0 - dist / 900.0, 0.0, 1.0);
  float n1 = tn(vWPos.xz * 1.7) * 0.6 + tn(vWPos.xz * 4.1) * 0.4;
  float n2 = tn(vWPos.xz * 0.11);
  float n3 = tn(vWPos.xz * 0.023);
  diffuseColor.rgb *= 0.9 + 0.16 * n2 * mid + 0.1 * n3 + (n1 - 0.5) * 0.22 * near;
}`);
    };
    return mat;
  }

  /** The 1 m colour grid and its mip levels. */
  buildColors(onProgress) {
    const w = this.world, N = w.N, O = w.origin;
    const col = new Uint8Array(N * N * 3);
    const base = {};
    for (const k of Object.keys(SURF_COLORS)) base[k] = lin(SURF_COLORS[k]);
    const dry = lin(0xa39a55), lush = lin(0x557a33), alpine = lin(0x8f8a5e), forest = lin(0x4a6a32);
    const H = w.H, S = w.S;
    for (let k = 0; k < N; k++) {
      const z = O + k;
      for (let i = 0; i < N; i++) {
        const x = O + i;
        const idx = k * N + i;
        const s = S[idx];
        let [r, g, b] = base[s] || base[0];
        const h = H[idx];
        const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), k0 = Math.max(0, k - 1), k1 = Math.min(N - 1, k + 1);
        const gx = (H[k * N + i1] - H[k * N + i0]) / (i1 - i0), gz = (H[k1 * N + i] - H[k0 * N + i]) / (k1 - k0);
        const slope = Math.sqrt(gx * gx + gz * gz);
        if (s === SURFACE.GRASS) {
          const n = vnoise(x / 37, z / 37, 901) * 0.6 + vnoise(x / 9, z / 9, 902) * 0.4;
          const t = Math.min(1, Math.max(0, (h - 120) / 160));
          const m1 = n < 0.5 ? lush : dry, f1 = Math.abs(n - 0.5) * 1.6;
          r += (m1[0] - r) * f1; g += (m1[1] - g) * f1; b += (m1[2] - b) * f1;
          r += (alpine[0] - r) * t; g += (alpine[1] - g) * t; b += (alpine[2] - b) * t;
          // darker under the woods (where the trees are dense the ground is shaded and needle-strewn)
          const fn = fbm(x / 310, z / 310, 2, 7331 + 80);            // the forest-density noise of WorldGen
          if (fn > 0.15) { const f = Math.min(0.5, (fn - 0.15) * 1.5); r += (forest[0] - r) * f; g += (forest[1] - g) * f; b += (forest[2] - b) * f; }
        } else {
          const n = vnoise(x / 6, z / 6, 903);
          const f = 0.88 + 0.24 * n;
          r *= f; g *= f; b *= f;
          // worn patches in a meadow: dirt showing through the grass, not bare earth
          if (s === SURFACE.DIRT) {
            let grassy = 0;
            for (const [di, dk] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) if (S[Math.min(N - 1, Math.max(0, k + dk)) * N + Math.min(N - 1, Math.max(0, i + di))] === SURFACE.GRASS) grassy++;
            const f2 = grassy * 0.12;
            r += (lush[0] - r) * f2; g += (lush[1] - g) * f2; b += (lush[2] - b) * f2;
          }
        }
        // steep ground darker (shadowed, broken)
        const sd = 1 - Math.min(0.25, slope * 0.12);
        r *= sd; g *= sd; b *= sd;
        // wet near water
        const wl = w.water(x, z);
        if (wl > -1e8 && h < wl + 0.45) { const f = h < wl ? 0.7 : 0.82; r *= f; g *= f; b *= f; }
        col[idx * 3] = Math.min(255, Math.round(Math.sqrt(r) * 255));       // stored ~gamma 2 for precision
        col[idx * 3 + 1] = Math.min(255, Math.round(Math.sqrt(g) * 255));
        col[idx * 3 + 2] = Math.min(255, Math.round(Math.sqrt(b) * 255));
      }
      if (onProgress && k % 256 === 0) onProgress(k / N);
    }
    // mips: level L has cells 2^L m wide (a box filter of the level below)
    this.mips = [{ n: N, step: 1, data: col }];
    let prev = this.mips[0];
    while (prev.n > 3) {
      const n = Math.floor((prev.n - 1) / 2) + 1, data = new Uint8Array(n * n * 3);
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, cnt = 0;
          for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
            const pi = i * 2 + di, pk = k * 2 + dk;
            if (pi < 0 || pk < 0 || pi >= prev.n || pk >= prev.n) continue;
            const wgt = (di === 0 ? 2 : 1) * (dk === 0 ? 2 : 1);
            sum += prev.data[(pk * prev.n + pi) * 3 + c] * wgt; cnt += wgt;
          }
          data[(k * n + i) * 3 + c] = Math.round(sum / cnt);
        }
      }
      prev = { n, step: prev.step * 2, data };
      this.mips.push(prev);
    }
    this.farRock = lin(0x7f7a73); this.farGrass = lin(0x5d7a3a); this.farSnow = lin(0xe9edf1); this.farForest = lin(0x41602f);
  }

  /** Colour (linear RGB) at (x, z) for a patch with vertex spacing `spacing`. */
  colorAt(x, z, spacing, h, slope, out) {
    const w = this.world;
    if (Math.abs(x) <= MAP_HALF && Math.abs(z) <= MAP_HALF) {
      let L = 0;
      while (L < this.mips.length - 1 && this.mips[L].step * 2 <= spacing) L++;
      const m = this.mips[L];
      const fx = Math.min(m.n - 1.001, Math.max(0, (x - w.origin) / m.step)), fz = Math.min(m.n - 1.001, Math.max(0, (z - w.origin) / m.step));
      const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
      const o = (k * m.n + i) * 3, d = m.data, rn = m.n * 3;
      for (let c = 0; c < 3; c++) {
        const v = (d[o + c] * (1 - tx) + d[o + 3 + c] * tx) * (1 - tz) + (d[o + rn + c] * (1 - tx) + d[o + rn + 3 + c] * tx) * tz;
        out[c] = (v / 255) * (v / 255);
      }
      return out;
    }
    // past the map: grass and woods low down, rock on the steeps, snow on the tops
    const n = vnoise(x / 400, z / 400, 905);
    const base = n > 0.55 ? this.farForest : this.farGrass;
    const rock = Math.min(1, Math.max(0, (slope - 0.45) * 2.5));
    const snow = Math.min(1, Math.max(0, (h - 330 - 40 * n) / 40));
    for (let c = 0; c < 3; c++) out[c] = base[c] + (this.farRock[c] - base[c]) * rock;
    for (let c = 0; c < 3; c++) out[c] += (this.farSnow[c] - out[c]) * snow;
    return out;
  }

  heightAt(x, z, withRuts) {
    const w = this.world;
    if (Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF) {
      let h = w.terrain(x, z);
      if (withRuts) h -= w.deformGrid.get(x, z);
      return h;
    }
    return farHeight(x, z);
  }

  build(node) {
    const { x0, z0, size } = node;
    const sp = size / GRID;
    const near = sp <= 1;
    // heights with a one-vertex border for the normals
    const T = this.tmpH, VB = V + 2;
    for (let k = -1; k <= V; k++) for (let i = -1; i <= V; i++) T[(k + 1) * VB + (i + 1)] = this.heightAt(x0 + i * sp, z0 + k * sp, near);
    const nV = V * V + 4 * V;
    const pos = new Float32Array(nV * 3), nor = new Int8Array(nV * 3), col = new Uint8Array(nV * 3);
    const c3 = [0, 0, 0];
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < V; k++) for (let i = 0; i < V; i++) {
      const v = k * V + i;
      const h = T[(k + 1) * VB + (i + 1)];
      const gx = (T[(k + 1) * VB + i + 2] - T[(k + 1) * VB + i]) / (2 * sp), gz = (T[(k + 2) * VB + i + 1] - T[k * VB + i + 1]) / (2 * sp);
      let nx = -gx, ny = 1, nz = -gz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
      pos[v * 3] = i * sp; pos[v * 3 + 1] = h; pos[v * 3 + 2] = k * sp;
      nor[v * 3] = Math.round(nx * 127); nor[v * 3 + 1] = Math.round(ny * 127); nor[v * 3 + 2] = Math.round(nz * 127);
      const x = x0 + i * sp, z = z0 + k * sp;
      this.colorAt(x, z, sp, h, Math.sqrt(gx * gx + gz * gz), c3);
      if (near) {
        const d = this.world.deformGrid.get(x, z);
        if (d > 0.004) { const f = 1 - Math.min(0.45, d * 2.6); c3[0] *= f; c3[1] *= f * 0.97; c3[2] *= f * 0.94; }
      }
      col[v * 3] = Math.round(Math.sqrt(c3[0]) * 255); col[v * 3 + 1] = Math.round(Math.sqrt(c3[1]) * 255); col[v * 3 + 2] = Math.round(Math.sqrt(c3[2]) * 255);
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    // skirts
    const drop = Math.max(1.5, sp * 2.5);
    const edgeIdx = [(t) => t, (t) => GRID * V + t, (t) => t * V, (t) => t * V + GRID];
    for (let e = 0; e < 4; e++) for (let t = 0; t < V; t++) {
      const src = edgeIdx[e](t), dst = V * V + e * V + t;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - drop; pos[dst * 3 + 2] = pos[src * 3 + 2];
      for (let c = 0; c < 3; c++) { nor[dst * 3 + c] = nor[src * 3 + c]; col[dst * 3 + c] = col[src * 3 + c]; }
    }
    // colours are stored gamma-2 encoded: decode in the attribute by squaring? Keep simple: convert to linear floats
    const colF = new Float32Array(nV * 3);
    for (let n = 0; n < nV * 3; n++) { const v = col[n] / 255; colF[n] = v * v; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(colF, 3));
    g.setIndex(this.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(size / 2, (minY + maxY) / 2, size / 2), Math.sqrt(2 * (size / 2) ** 2 + ((maxY - minY + drop) / 2) ** 2));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY - drop, 0), new THREE.Vector3(size, maxY, size));
    if (node.mesh) { node.mesh.geometry.dispose(); node.mesh.geometry = g; } else {
      node.mesh = new THREE.Mesh(g, this.material);
      node.mesh.position.set(x0, 0, z0);
      node.mesh.matrixAutoUpdate = false;
      node.mesh.updateMatrix();
      node.mesh.receiveShadow = true;
    }
    node.mesh.castShadow = this.shadows && sp <= 4;
    node.minY = minY; node.maxY = maxY;
    node.built = true;
    node.dirty = false;
  }

  node(level, ix, iz) {
    const key = level * 1e8 + ix * 1e4 + iz;
    let n = this.cache.get(key);
    if (!n) {
      const size = ROOT / (1 << level);
      n = { key, level, ix, iz, size, x0: -ROOT / 2 + ix * size, z0: -ROOT / 2 + iz * size, mesh: null, built: false, used: 0, minY: 0, maxY: 0 };
      this.cache.set(key, n);
    }
    return n;
  }

  /** Mark patches that show ruts in the given world rectangles as needing a rebuild. */
  markDirty(chunkKeys) {
    for (const key of chunkKeys) {
      const [x0, z0, x1, z1] = DeformGrid.bounds(key);
      for (const n of this.cache.values()) {
        if (!n.built || n.size / GRID > 1) continue;
        if (n.x0 < x1 && n.x0 + n.size > x0 && n.z0 < z1 && n.z0 + n.size > z0) n.dirty = true;
      }
    }
  }

  update(camPos) {
    this.frame++;
    const visible = [];
    let budget = this.budget;
    const want = (n) => {
      const cx = n.x0 + n.size / 2, cz = n.z0 + n.size / 2;
      const dx = Math.max(0, Math.abs(camPos.x - cx) - n.size / 2), dz = Math.max(0, Math.abs(camPos.z - cz) - n.size / 2);
      const dy = n.built ? Math.max(0, camPos.y - n.maxY, n.minY - camPos.y) : 0;
      return n.size > MIN && Math.sqrt(dx * dx + dy * dy + dz * dz) < n.size * this.split * 0.5;
    };
    const visit = (n) => {
      n.used = this.frame;
      if (want(n)) {
        const kids = [this.node(n.level + 1, n.ix * 2, n.iz * 2), this.node(n.level + 1, n.ix * 2 + 1, n.iz * 2), this.node(n.level + 1, n.ix * 2, n.iz * 2 + 1), this.node(n.level + 1, n.ix * 2 + 1, n.iz * 2 + 1)];
        let ready = true;
        for (const k of kids) {
          if (!k.built) { if (budget > 0) { this.build(k); budget--; } else ready = false; }
        }
        if (ready || !n.built) { for (const k of kids) visit(k); return; }
      }
      if (!n.built) this.build(n);
      if (n.dirty && budget > 0) { this.build(n); budget--; }
      visible.push(n);
    };
    // the root's four children are always there
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 2; ix++) visit(this.node(1, ix, iz));
    // swap the visible set into the scene
    const g = this.group;
    for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]);
    for (const n of visible) { g.add(n.mesh); n.mesh.castShadow = this.shadows && n.size / GRID <= 4; }
    this.visibleCount = visible.length;
    // evict patches unused for a while
    if (this.cache.size > MAX_CACHE) {
      const old = [...this.cache.values()].filter((n) => n.used < this.frame - 120 && n.level > 2).sort((a, b) => a.used - b.used);
      for (const n of old.slice(0, this.cache.size - MAX_CACHE + 50)) {
        if (n.mesh) n.mesh.geometry.dispose();
        this.cache.delete(n.key);
      }
    }
  }
}
