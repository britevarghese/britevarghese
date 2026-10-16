// Terrain rendering: a quadtree of square patches, each a 32 x 32 grid of quads. Patches near the camera are small
// (16 m, 0.5 m between vertices, fine enough to show ruts), far ones are large; past the map's edge the patches
// follow the far landform out to the horizon. Patches are built on demand (a few per frame), cached, and rebuilt
// where tyres have pressed ruts into the ground. Skirts hide the cracks between patches of different sizes.
//
// Ground: close up, photo-scanned textures of each kind of ground (render/Ground.js), one layer per 1 m cell of the
// map (a texture the shader reads), blended between cells by their height maps so stones stand proud of the mud and
// grass grows over the edge of a trail; steep ground is textured from the side. Each vertex carries a tint for the
// colour of the land (lush or dry grass, alpine, wet by the water, worn ruts). Far away the textures fade into the
// vertex colour: each layer's average colour times the tint, baked once into a 1 m colour grid with mip levels so
// distant patches show the average colour of the ground they cover.

import * as THREE from 'three';
import { SURFACE } from '../physics/Surfaces.js';
import { MAP_HALF } from '../world/maps/index.js';
import { DeformGrid } from '../world/Deform.js';
import { vnoise } from '../world/Noise.js';
import { TEA_ROW, TEA_RANGE } from './Tea.js';

const GRID = 32;
const V = GRID + 1;
const ROOT = 8192;
const MIN = 16;
const SPLIT_DEFAULT = 2.1;
const MAX_CACHE = 700;

// Which texture layer each surface shows (grass under the trees shows the forest floor). Colours for when the
// textures could not be loaded.
const LAYER_OF = {
  [SURFACE.GRASS]: 'grass', [SURFACE.DIRT]: 'dirt', [SURFACE.GRAVEL]: 'gravel', [SURFACE.ROCK]: 'rock', [SURFACE.MUD]: 'mud',
  [SURFACE.SAND]: 'sand', [SURFACE.SNOW]: 'snow', [SURFACE.ROAD]: 'road', [SURFACE.RIVERBED]: 'pebbles', [SURFACE.ICE]: 'snow',
  [SURFACE.TEA]: 'tea',
};
// a map without a layer of its own for a ground shows another
const FALLBACK = { road: 'gravel', tea: 'forest', forest: 'grass' };
const PLAIN = {
  grass: 0x6f8c3c, forest: 0x4f4430, dirt: 0x8d7454, gravel: 0x958b7c, rock: 0x8a857d, mud: 0x5e4a33, sand: 0xc8b088,
  snow: 0xeef1f4, pebbles: 0x5f5946, tea: 0x3a6420,
};
// tints of the grass: lush hollows, dry knolls, thin alpine turf
const LUSH = [0.78, 0.93, 0.8], DRY = [1.5, 1.24, 1.3], ALPINE = [1.22, 1.08, 1.15];

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
  /** ground: the loaded textures (render/Ground.js), or null to colour the ground without them. */
  constructor(world, scene, { onProgress, ground = null } = {}) {
    this.world = world;
    this.scene = scene;
    this.ground = ground;
    this.snowLine = world.map.snowLine ?? 1e6;                // (no snow on a tropical map)
    this.litter = world.map.litter;                            // how much each type of tree carpets the ground
    this.layers = ground ? ground.layers : Object.keys(PLAIN).map((name) => ({ name, avg: lin(PLAIN[name]), rough: 0.95 }));
    this.layerIndex = {};
    this.layers.forEach((l, i) => { this.layerIndex[l.name] = i; });
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.index = makeIndex();
    this.cache = new Map();
    this.frame = 0;
    this.buildColors(onProgress);
    this.material = this.makeMaterial();
    this.shadows = true;
    this.tmpH = new Float32Array((V + 2) * (V + 2));
    this.budget = 6;
    this.split = SPLIT_DEFAULT;
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const G = this.ground, w = this.world;
    const uniforms = {};
    if (G) {
      const splat = new THREE.DataTexture(this.splat, w.N, w.N, THREE.RedFormat, THREE.UnsignedByteType);
      splat.magFilter = splat.minFilter = THREE.NearestFilter;
      splat.generateMipmaps = false;
      splat.unpackAlignment = 1;
      splat.needsUpdate = true;
      this.splatTex = splat;
      Object.assign(uniforms, {
        uGC: { value: G.color }, uGN: { value: G.normal }, uSplat: { value: splat },
        uLay: { value: this.layers.map((l) => new THREE.Vector4(1 / l.size, l.rough, l.heightW, 0)) },
        uGain: { value: this.layers.map((l) => new THREE.Vector3(...l.gain)) },
        uSplatO: { value: new THREE.Vector2(w.origin, w.origin) }, uSplatN: { value: w.N }, uMapHalf: { value: MAP_HALF },
        uTexFar: { value: 320 }, uIds: { value: new THREE.Vector3(this.layerIndex.grass, this.layerIndex.rock, this.layerIndex.snow ?? this.layerIndex.rock) },
        uSnowLine: { value: this.snowLine + 40 }, uRelief: { value: 1 },
        uTea: { value: this.layerIndex.tea ?? -1 }, uTeaNear: { value: TEA_RANGE.high },
      });
    }
    this.uniforms = uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 tint;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec3 vTint;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = objectNormal;
vTint = tint * 2.0;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec3 vTint;
float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }
${G ? `
#define NLAYERS ${this.layers.length}
uniform highp sampler2DArray uGC;
uniform highp sampler2DArray uGN;
uniform highp sampler2D uSplat;
uniform vec4 uLay[NLAYERS];
uniform vec3 uGain[NLAYERS];
uniform vec2 uSplatO;
uniform float uSplatN;
uniform float uMapHalf;
uniform float uTexFar;
uniform vec3 uIds;
uniform float uSnowLine;
uniform float uRelief;
uniform float uTea;
uniform float uTeaNear;
// a tea estate beyond the hedges (render/Tea.js): the rows as stripes along the contours, leaves over the soil
vec3 gTea(vec3 soil, float dist) {
  float ph = fract(vWPos.y / ${TEA_ROW.toFixed(3)});
  float band = smoothstep(0.06, 0.26, ph) * smoothstep(0.99, 0.72, ph);
  float aa = clamp(fwidth(vWPos.y / ${TEA_ROW.toFixed(3)}) * 2.0 - 0.4, 0.0, 1.0);
  band = mix(band, 0.68, aa);
  float lum = dot(soil, vec3(0.3, 0.5, 0.2));
  vec3 leaf = vec3(0.06, 0.15, 0.03) * (0.7 + 2.2 * lum);
  return mix(soil, leaf, band * smoothstep(uTeaNear * 0.8, uTeaNear, dist));
}
// the projections (top, and the two sides for steep ground), their weights and screen-space derivatives
vec2 gPT, gPX, gPZ, gDTx, gDTy, gDXx, gDXy, gDZx, gDZy;
float gwT, gwX, gwZ, gSX, gSZ;
float gL[4];
float gW[4];
int gn;
float gId(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(int(uSplatN) - 1));
  return floor(texelFetch(uSplat, c, 0).r * 255.0 + 0.5);
}
void gAdd(float id, float w) {
  for (int j = 0; j < 4; j++) {
    if (j >= gn) break;
    if (gL[j] == id) { gW[j] += w; return; }
  }
  gL[gn] = id; gW[gn] = w; gn++;
}
vec4 gColor(float L, float sc) {
  vec4 c = vec4(0.0);
  if (gwT > 0.0) c += textureGrad(uGC, vec3(gPT * sc, L), gDTx * sc, gDTy * sc) * gwT;
  if (gwX > 0.0) c += textureGrad(uGC, vec3(gPX * sc, L), gDXx * sc, gDXy * sc) * gwX;
  if (gwZ > 0.0) c += textureGrad(uGC, vec3(gPZ * sc, L), gDZx * sc, gDZy * sc) * gwZ;
  return c;
}
// the normal map's tilt as a world-space vector along the ground
vec3 gTilt(float L, float sc) {
  vec3 d = vec3(0.0);
  if (gwT > 0.0) { vec2 t = textureGrad(uGN, vec3(gPT * sc, L), gDTx * sc, gDTy * sc).rg * 2.0 - 1.0; d += vec3(t.x, 0.0, -t.y) * gwT; }
  if (gwX > 0.0) { vec2 t = textureGrad(uGN, vec3(gPX * sc, L), gDXx * sc, gDXy * sc).rg * 2.0 - 1.0; d += vec3(0.0, t.y, -gSX * t.x) * gwX; }
  if (gwZ > 0.0) { vec2 t = textureGrad(uGN, vec3(gPZ * sc, L), gDZx * sc, gDZy * sc).rg * 2.0 - 1.0; d += vec3(gSZ * t.x, t.y, 0.0) * gwZ; }
  return d;
}` : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gNW = normalize(vWNormal);
float gRough = -1.0;
{
  float dist = length(vWPos - cameraPosition);
  float mid = clamp(1.0 - dist / 900.0, 0.0, 1.0);
  float n1 = tn(vWPos.xz * 0.31);
  float n2 = tn(vWPos.xz * 0.11);
  float n3 = tn(vWPos.xz * 0.023);
  float vary = 0.9 + 0.1 * n1 * (1.0 - smoothstep(60.0, 220.0, dist)) + 0.12 * n2 * mid + 0.08 * n3;
${G ? `
  float tex = 1.0 - smoothstep(uTexFar * 0.55, uTexFar, dist);
  vec3 n = gNW;
  // projections and their derivatives, taken here where every pixel runs the same code
  gSX = n.x >= 0.0 ? 1.0 : -1.0; gSZ = n.z >= 0.0 ? 1.0 : -1.0;
  gPT = vec2(vWPos.x, -vWPos.z); gPX = vec2(-vWPos.z * gSX, vWPos.y); gPZ = vec2(vWPos.x * gSZ, vWPos.y);
  vec2 qx = vec2(-vWPos.z, vWPos.y), qz = vec2(vWPos.x, vWPos.y);
  gDTx = dFdx(gPT); gDTy = dFdy(gPT);
  gDXx = dFdx(qx) * gSX; gDXy = dFdy(qx) * gSX; gDZx = dFdx(qz) * gSZ; gDZy = dFdy(qz) * gSZ;
  vec3 tw = abs(n.y) > 0.82 ? vec3(0.0, 1.0, 0.0) : pow(abs(n), vec3(6.0));
  tw /= (tw.x + tw.y + tw.z);
  gwT = tw.y > 0.03 ? tw.y : 0.0; gwX = tw.x > 0.03 ? tw.x : 0.0; gwZ = tw.z > 0.03 ? tw.z : 0.0;
  float tws = gwT + gwX + gwZ; gwT /= tws; gwX /= tws; gwZ /= tws;
  if (tex > 0.0) {
    // the layers of the four cells around this point, weighted by distance
    vec2 g = vWPos.xz - uSplatO;
    vec2 gi = floor(g), f = g - gi;
    ivec2 c = ivec2(gi);
    float i0, i1, i2, i3;
    if (abs(vWPos.x) < uMapHalf && abs(vWPos.z) < uMapHalf) {
      i0 = gId(c); i1 = gId(c + ivec2(1, 0)); i2 = gId(c + ivec2(0, 1)); i3 = gId(c + ivec2(1, 1));
    } else {
      // past the edge of the map: rock on the steeps, snow on the tops, grass below
      i0 = n.y < 0.7 ? uIds.y : vWPos.y > uSnowLine ? uIds.z : uIds.x;
      i1 = i0; i2 = i0; i3 = i0;
    }
    gn = 1; gL[0] = i0; gW[0] = (1.0 - f.x) * (1.0 - f.y);
    gAdd(i1, f.x * (1.0 - f.y)); gAdd(i2, (1.0 - f.x) * f.y); gAdd(i3, f.x * f.y);
    // blend by height: where one ground's relief stands higher it shows through
    vec4 cs[4];
    float hs[4];
    float top = -1.0;
    for (int j = 0; j < 4; j++) {
      if (j >= gn) break;
      vec4 lay = uLay[int(gL[j])];
      cs[j] = gColor(gL[j], lay.x);
      if (gL[j] == uTea) cs[j].rgb = gTea(cs[j].rgb, dist);
      hs[j] = gW[j] + cs[j].a * lay.z;
      top = max(top, hs[j]);
    }
    float near = (1.0 - smoothstep(25.0, 140.0, dist)) * uRelief;
    vec3 alb = vec3(0.0), tilt = vec3(0.0);
    float rough = 0.0, sum = 0.0;
    for (int j = 0; j < 4; j++) {
      if (j >= gn) break;
      int li = int(gL[j]);
      vec4 lay = uLay[li];
      float b = max(0.0, hs[j] - top + 0.16);
      sum += b;
      alb += cs[j].rgb * uGain[li] * b;
      rough += lay.y * b;
      if (near > 0.0) tilt += gTilt(gL[j], lay.x) * b;
    }
    alb /= sum; rough /= sum; tilt /= sum;
    diffuseColor.rgb = mix(diffuseColor.rgb, alb * vTint, tex);
    gRough = mix(0.95, rough, tex);
    gNW = normalize(gNW + tilt * near * 0.9);
  }` : ''}
  diffuseColor.rgb *= vary;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (gRough >= 0.0) roughnessFactor = gRough;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);`);
    };
    return mat;
  }

  /** Graphics level: how far out the ground is textured, and whether close up its relief is lit. */
  setQuality(q) {
    if (!this.uniforms.uTexFar) return;
    this.uniforms.uTexFar.value = q === 'high' ? 320 : q === 'medium' ? 240 : 150;
    this.uniforms.uRelief.value = q === 'low' ? 0 : 1;
    this.uniforms.uTeaNear.value = TEA_RANGE[q] || TEA_RANGE.high;
  }

  /**
   * The ground under the woods: how many trees stand over each 2 m cell (each tree counts fully under its crown and
   * less out to the edge of the needles and leaves it drops).
   */
  canopy() {
    const T = this.world.trees, n = Math.ceil(MAP_HALF * 2 / 2) + 1, g = new Float32Array(n * n);
    for (let t = 0; t < T.count; t++) {
      // conifers carpet the ground with needles; birches (type 2) and dead trees much less
      const litter = this.litter ? this.litter[T.type[t]] ?? 1 : T.type[t] === 2 ? 0.35 : T.type[t] === 3 ? 0.5 : 1;
      const R = 1.5 + T.h[t] * 0.3, cx = (T.x[t] + MAP_HALF) / 2, cz = (T.z[t] + MAP_HALF) / 2, r = R / 2;
      for (let k = Math.max(0, Math.floor(cz - r)); k <= Math.min(n - 1, Math.ceil(cz + r)); k++) {
        for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(n - 1, Math.ceil(cx + r)); i++) {
          const d = Math.hypot(i - cx, k - cz) / r;
          if (d < 1) g[k * n + i] += Math.min(1, 1.6 * (1 - d)) * litter;
        }
      }
    }
    return { n, g, at: (x, z) => {
      const fx = Math.min(n - 1.001, Math.max(0, (x + MAP_HALF) / 2)), fz = Math.min(n - 1.001, Math.max(0, (z + MAP_HALF) / 2));
      const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
      return (g[k * n + i] * (1 - tx) + g[k * n + i + 1] * tx) * (1 - tz) + (g[(k + 1) * n + i] * (1 - tx) + g[(k + 1) * n + i + 1] * tx) * tz;
    } };
  }

  /** Texture layer of a cell: its surface's, or the forest floor where trees stand on grass. */
  layerAt(s, x, z, canopy) {
    let name = LAYER_OF[s] || 'grass';
    while (this.layerIndex[name] === undefined && FALLBACK[name]) name = FALLBACK[name];
    if (name === 'grass' && this.layerIndex.forest !== undefined && canopy(x, z) + 0.7 * (vnoise(x / 7, z / 7, 907) - 0.5) + 0.6 * (vnoise(x / 2.2, z / 2.2, 908) - 0.5) > 1.15) return this.layerIndex.forest;
    return this.layerIndex[name] ?? 0;
  }

  /**
   * The colour of the land over a layer's texture (multiplies it): lush or dry grass and alpine turf, a little
   * variety in everything else, darker on broken steep ground, wet by the water. Writes linear RGB into out.
   */
  tintAt(layer, x, z, h, slope, out) {
    let r = 1, g = 1, b = 1;
    if (layer === this.layerIndex.grass) {
      const n = vnoise(x / 37, z / 37, 901) * 0.6 + vnoise(x / 9, z / 9, 902) * 0.4;
      const m = n < 0.5 ? LUSH : DRY, f = Math.min(1, Math.abs(n - 0.5) * 3);
      r += (m[0] - 1) * f; g += (m[1] - 1) * f; b += (m[2] - 1) * f;
      const t = Math.min(1, Math.max(0, (h - 120) / 160));
      r += (ALPINE[0] - r) * t; g += (ALPINE[1] - g) * t; b += (ALPINE[2] - b) * t;
      // shade grass and moss among the trees
      const c = Math.min(1, this.can(x, z) * 0.7);
      r *= 1 - 0.24 * c; g *= 1 - 0.16 * c; b *= 1 - 0.26 * c;
    } else {
      const f = 0.92 + 0.16 * vnoise(x / 6, z / 6, 903);
      r = f; g = f; b = f;
    }
    const sd = 1 - Math.min(0.25, slope * 0.12);
    r *= sd; g *= sd; b *= sd;
    const wl = this.world.water(x, z);
    if (wl > -1e8 && h < wl + 0.45) { const f = h < wl ? 0.7 : 0.82; r *= f; g *= f; b *= f; }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  /** The layer of every 1 m cell (for the shader), and the colour grid and its mip levels (for far away). */
  buildColors(onProgress) {
    const w = this.world, N = w.N, O = w.origin;
    const col = new Uint8Array(N * N * 3), splat = new Uint8Array(N * N);
    const H = w.H, S = w.S, avg = this.layers.map((l) => l.avg), t3 = [0, 0, 0];
    const can = this.can = this.canopy().at;
    for (let k = 0; k < N; k++) {
      const z = O + k;
      for (let i = 0; i < N; i++) {
        const x = O + i;
        const idx = k * N + i;
        const L = this.layerAt(S[idx], x, z, can);
        splat[idx] = L;
        const h = H[idx];
        const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), k0 = Math.max(0, k - 1), k1 = Math.min(N - 1, k + 1);
        const gx = (H[k * N + i1] - H[k * N + i0]) / (i1 - i0), gz = (H[k1 * N + i] - H[k0 * N + i]) / (k1 - k0);
        this.tintAt(L, x, z, h, Math.sqrt(gx * gx + gz * gz), t3);
        const a = avg[L];
        col[idx * 3] = Math.min(255, Math.round(Math.sqrt(a[0] * t3[0]) * 255));       // stored ~gamma 2 for precision
        col[idx * 3 + 1] = Math.min(255, Math.round(Math.sqrt(a[1] * t3[1]) * 255));
        col[idx * 3 + 2] = Math.min(255, Math.round(Math.sqrt(a[2] * t3[2]) * 255));
      }
      if (onProgress && k % 256 === 0) onProgress(k / N);
    }
    this.splat = splat;
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
    const li = this.layerIndex;
    this.farRock = avg[li.rock]; this.farGrass = avg[li.grass]; this.farSnow = avg[li.snow ?? li.rock];
    this.farForest = [avg[li.grass][0] * 0.55, avg[li.grass][1] * 0.68, avg[li.grass][2] * 0.55];
  }

  /** Past the map: the layer the shader shows (rock on the steeps, snow on the tops, grass below). */
  farLayer(h, ny) {
    const li = this.layerIndex;
    return ny < 0.7 ? li.rock : h > this.snowLine + 40 ? li.snow ?? li.rock : li.grass;
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
    const rock = Math.min(1, Math.max(0, (slope - 0.75) * 2.5));
    const snow = Math.min(1, Math.max(0, (h - this.snowLine - 30 - 40 * n) / 40));
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
    return this.world.farHeight(x, z);
  }

  build(node) {
    const { x0, z0, size } = node;
    const sp = size / GRID;
    const near = sp <= 1;
    // heights with a one-vertex border for the normals
    const T = this.tmpH, VB = V + 2;
    for (let k = -1; k <= V; k++) for (let i = -1; i <= V; i++) T[(k + 1) * VB + (i + 1)] = this.heightAt(x0 + i * sp, z0 + k * sp, near);
    const nV = V * V + 4 * V;
    const pos = new Float32Array(nV * 3), nor = new Int8Array(nV * 3), col = new Uint8Array(nV * 3), tint = new Uint8Array(nV * 3);
    const c3 = [0, 0, 0], t3 = [0, 0, 0], w = this.world;
    const inMap = (x, z) => Math.abs(x) < MAP_HALF && Math.abs(z) < MAP_HALF;
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < V; k++) for (let i = 0; i < V; i++) {
      const v = k * V + i;
      const h = T[(k + 1) * VB + (i + 1)];
      const gx = (T[(k + 1) * VB + i + 2] - T[(k + 1) * VB + i]) / (2 * sp), gz = (T[(k + 2) * VB + i + 1] - T[k * VB + i + 1]) / (2 * sp);
      let nx = -gx, ny = 1, nz = -gz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
      pos[v * 3] = i * sp; pos[v * 3 + 1] = h; pos[v * 3 + 2] = k * sp;
      nor[v * 3] = Math.round(nx * 127); nor[v * 3 + 1] = Math.round(ny * 127); nor[v * 3 + 2] = Math.round(nz * 127);
      const x = x0 + i * sp, z = z0 + k * sp, slope = Math.sqrt(gx * gx + gz * gz);
      this.colorAt(x, z, sp, h, slope, c3);
      // the tint over the textures: the land's own, or past the map the far colour over the layer the shader shows
      if (inMap(x, z)) this.tintAt(this.splat[Math.round(z - w.origin) * w.N + Math.round(x - w.origin)], x, z, h, slope, t3);
      else { const a = this.layers[this.farLayer(h, ny)].avg; for (let c = 0; c < 3; c++) t3[c] = Math.min(2, Math.max(0.4, c3[c] / a[c])); }
      if (near) {
        const d = w.deformGrid.get(x, z);
        if (d > 0.004) {
          // pressed and churned ground in the ruts
          const f = 1 - Math.min(0.45, d * 2.6);
          c3[0] *= f; c3[1] *= f * 0.97; c3[2] *= f * 0.94;
          t3[0] *= f; t3[1] *= f * 0.97; t3[2] *= f * 0.94;
        }
      }
      col[v * 3] = Math.round(Math.sqrt(c3[0]) * 255); col[v * 3 + 1] = Math.round(Math.sqrt(c3[1]) * 255); col[v * 3 + 2] = Math.round(Math.sqrt(c3[2]) * 255);
      for (let c = 0; c < 3; c++) tint[v * 3 + c] = Math.min(255, Math.round(t3[c] * 127.5));
      if (h < minY) minY = h; if (h > maxY) maxY = h;
    }
    // skirts
    const drop = Math.max(1.5, sp * 2.5);
    const edgeIdx = [(t) => t, (t) => GRID * V + t, (t) => t * V, (t) => t * V + GRID];
    for (let e = 0; e < 4; e++) for (let t = 0; t < V; t++) {
      const src = edgeIdx[e](t), dst = V * V + e * V + t;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - drop; pos[dst * 3 + 2] = pos[src * 3 + 2];
      for (let c = 0; c < 3; c++) { nor[dst * 3 + c] = nor[src * 3 + c]; col[dst * 3 + c] = col[src * 3 + c]; tint[dst * 3 + c] = tint[src * 3 + c]; }
    }
    // colours are stored gamma-2 encoded: decode in the attribute by squaring? Keep simple: convert to linear floats
    const colF = new Float32Array(nV * 3);
    for (let n = 0; n < nV * 3; n++) { const v = col[n] / 255; colF[n] = v * v; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(colF, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3, true));
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
