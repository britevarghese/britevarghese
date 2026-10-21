// Grass: tufts of meadow grass on the meadows around the camera. Each tuft is three crossed cards carrying a picture
// of many blades (drawn once at startup: tapering, curving, each its own height and shade, some gone dry), instanced
// on a jittered grid over the cells whose ground is grass, so the grass grows exactly where the textured ground shows
// it. The blades take their colour from the scanned grass texture under the tuft and the land's tint (lush hollows,
// dry knolls); they sway in the wind, glow when the sun is behind them, and are pressed flat by the wheels. Far out
// the tufts thin (the survivors grow wider) and sink into the ground, whose meadow goes on beyond them.
//
// Tufts are made per 8 m chunk (cached) and gathered when the camera crosses into another chunk.

import * as THREE from 'three';
import { DeformGrid } from '../world/Deform.js';

const CHUNK = 8;
const SPACING = 0.6;                     // tuft grid (m)
const VARIANTS = 4;                      // pictures of blades side by side in the texture

/** Range (m) of the grass by graphics level. */
const RANGE = { high: 44, medium: 30, low: 19 };

const hash = (x, z, s) => { const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };

/** Pictures of blades of grass (white-ish green, to be tinted by the ground), with alpha. */
function bladeTexture() {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W * VARIANTS; c.height = H;
  const x = c.getContext('2d');
  let s = 11;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let v = 0; v < VARIANTS; v++) {
    const ox = v * W;
    const n = 64 + Math.floor(R() * 20);
    const blades = [];
    for (let b = 0; b < n; b++) blades.push({ bx: ox + 12 + R() * (W - 24), h: (0.35 + 0.65 * Math.pow(R(), 0.7)) * (H - 6), w: 2.2 + R() * 2.8, lean: (R() - 0.5) * 0.9, dry: R() < 0.16, shade: 0.86 + R() * 0.2 });
    blades.sort((a, b) => b.h - a.h);                       // tall ones behind
    for (const bl of blades) {
      const y0 = H, y1 = H - bl.h, tipX = bl.bx + bl.lean * bl.h * 0.6, cx = bl.bx + bl.lean * bl.h * 0.15;
      const g = x.createLinearGradient(0, y0, 0, y1);
      const k = bl.shade;
      const ch = (r, g2, b) => `rgb(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g2 * k))},${Math.min(255, Math.round(b * k))})`;
      if (bl.dry) {
        g.addColorStop(0, ch(170, 165, 125));
        g.addColorStop(1, ch(255, 240, 180));
      } else {
        g.addColorStop(0, ch(160, 176, 150));
        g.addColorStop(0.55, ch(218, 232, 205));
        g.addColorStop(1, ch(240, 248, 210));
      }
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(bl.bx - bl.w, y0);
      x.quadraticCurveTo(cx - bl.w * 0.6, (y0 + y1) / 2, tipX, y1);
      x.quadraticCurveTo(cx + bl.w * 0.6, (y0 + y1) / 2, bl.bx + bl.w, y0);
      x.closePath();
      x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** One tuft: three cards crossing at its middle, 1 m wide and tall before scaling (v up the card). */
function tuftGeometry() {
  const pos = [], nor = [], uv = [], idx = [];
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI + 0.3, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    const nx = -Math.sin(a) * 0.35, nz = Math.cos(a) * 0.35;      // mostly up: a tuft reads as a rounded mass
    const b = pos.length / 3;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    for (let k = 0; k < 4; k++) nor.push(nx, 0.94, nz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Grass {
  /**
   * terrain: render/Terrain.js (the layer of each cell and the land's tint); ground: render/Ground.js textures. centre:
   * where the map stands in the open world (render/WorldView.js: its tufts are placed in its own frame).
   */
  constructor(world, terrain, scene, ground, uniforms, { centre = [0, 0] } = {}) {
    this.world = world;
    this.terrain = terrain;
    this.ground = ground;
    this.range = RANGE.high;
    this.chunks = new Map();
    this.cap = Math.ceil(Math.PI * (RANGE.high + CHUNK * 1.5) ** 2 / (SPACING * SPACING));
    const g = this.geometry = tuftGeometry();
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);   // x, y, z, turn
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 4), 4).setUsage(THREE.DynamicDrawUsage);  // height, width, hash, -
    this.aTint = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aTint', this.aTint);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      uTime: uniforms?.uTime || { value: 0 }, uSunDirW: uniforms?.uSunDirW || { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: uniforms?.uSunColor || { value: new THREE.Color(1, 1, 1) },
      uRange: { value: this.range }, uPush: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uCentre: { value: new THREE.Vector2(...centre) },
    };
    this.ownTime = !uniforms?.uTime;
    this.mesh = new THREE.Mesh(g, this.material());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.at = null;
  }

  material() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: bladeTexture(), alphaTest: 0.42, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
    mat.alphaToCoverage = true;
    const G = this.ground, U = this.uniforms;
    const grassL = G ? G.index.grass : 0, grassScale = G ? 1 / G.layers[grassL].size : 1;
    // (its texture layer and scale are written into its shader: one per map's ground in the open world)
    mat.customProgramCacheKey = () => `grass ${G ? `${grassL} ${grassScale}` : '-'}`;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      if (G) sh.uniforms.uGC = { value: G.color };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 aPos;
attribute vec4 aSize;
attribute vec3 aTint;
uniform float uTime;
uniform float uRange;
uniform vec4 uPush[6];
uniform vec2 uCentre;
${G ? 'uniform highp sampler2DArray uGC;' : ''}
varying vec3 vGrass;
varying float vT;`)
        .replace('#include <beginnormal_vertex>', `
float cs = cos(aPos.w), sn = sin(aPos.w);
vec3 objectNormal = vec3(normal.x * cs - normal.z * sn, normal.y, normal.x * sn + normal.z * cs);`)
        .replace('#include <begin_vertex>', `
// thin out with distance (each tuft has its turn to go, the ones left grow wider to cover) and sink into the
// ground, so the meadow goes on past the last of them (a few wide tufts standing alone looked like scraps)
float dist = distance(cameraPosition.xz - uCentre, aPos.xz);
float keep = mix(1.0, 0.55, smoothstep(12.0, uRange, dist));
float alive = 1.0 - smoothstep(keep - 0.08, keep, aSize.z);
float fade = 1.0 - smoothstep(uRange * 0.5, uRange, dist);
float hgt = aSize.x * alive * fade;
float wid = aSize.y / sqrt(keep);
vec3 p = vec3(position.x * wid, position.y * hgt, position.z * wid);
p = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
vec3 transformed = aPos.xyz + p;
float aT = uv.y;
// wind: slow sway and quick flutter, stronger at the tips
float k = aT * aT;
float gust = sin(uTime * 0.9 + aPos.x * 0.05 + aPos.z * 0.04) * 0.5 + 0.5;
transformed.x += (sin(uTime * 1.9 + aPos.x * 0.37 + aPos.z * 0.21) * 0.6 + gust * 0.8) * 0.09 * k * hgt;
transformed.z += sin(uTime * 2.3 + aPos.z * 0.33 + aPos.x * 0.17) * 0.05 * k * hgt;
// pressed down by the wheels
for (int i = 0; i < 6; i++) {
  vec4 q = uPush[i];
  if (q.z <= 0.0) continue;
  vec2 d = transformed.xz - q.xy;
  float l = length(d);
  float f = 1.0 - smoothstep(q.z * 0.5, q.z, l);
  if (f > 0.0) {
    transformed.xz += normalize(d + 1e-4) * f * 0.35 * aT * hgt;
    transformed.y = mix(transformed.y, aPos.y + aT * 0.03, f * 0.85);
  }
}
vT = aT;
#ifdef USE_MAP
vMapUv = vec2((floor(aSize.z * ${VARIANTS}.0) + uv.x) / ${VARIANTS}.0, uv.y);
#endif
vec3 base = vec3(0.12, 0.16, 0.035);
${G ? `base = textureLod(uGC, vec3(vec2(aPos.x, -aPos.z) * ${grassScale.toFixed(5)} + vec2(aSize.z * 0.07, aSize.z * 0.13), ${grassL.toFixed(1)}), 3.0).rgb;` : ''}
vGrass = base * aTint * (0.92 + 0.16 * fract(aSize.z * 37.0)) * 1.3;`)
        .replace('#include <project_vertex>', `
vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
gl_Position = projectionMatrix * mvPosition;`)
        .replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
varying vec3 vGrass;
varying float vT;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vGrass;`)
        // both sides of a card face up out of the tuft (don't flip the normal on the back)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
normal = normalize(vNormal);`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  // sunlight through the blades when looking toward the sun
  vec3 sunV = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
  float back = pow(max(0.0, dot(normalize(vViewPosition), sunV)), 3.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * back * 0.8 * vT;
}`);
    };
    return mat;
  }

  /** The tufts of one chunk: x, y, z, turn, height, width, hash, tint r, g, b per tuft. */
  chunk(cx, cz) {
    const key = cx * 65536 + cz;
    let c = this.chunks.get(key);
    if (c) return c;
    const T = this.terrain, w = this.world, out = [], tint = [0, 0, 0];
    const grassL = T.layerIndex.grass, forestL = T.layerIndex.forest, dirtL = T.layerIndex.dirt, N = w.N;
    // (bare earth beside the meadow: grass straggles out onto it, so the meadow has no hard edge)
    const byGrass = (cell) => T.splat[cell - 1] === grassL || T.splat[cell + 1] === grassL || T.splat[cell - N] === grassL || T.splat[cell + N] === grassL;
    const n = Math.round(CHUNK / SPACING);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < n; i++) {
        const x = cx * CHUNK + (i + hash(i + cx * n, k + cz * n, 1)) * SPACING;
        const z = cz * CHUNK + (k + hash(i + cx * n, k + cz * n, 2)) * SPACING;
        if (Math.abs(x) > w.half || Math.abs(z) > w.half) continue;
        const cell = Math.round((z - w.origin) / w.res) * w.N + Math.round((x - w.origin) / w.res);
        const L = T.splat[cell];
        const r = hash(x, z, 3);
        const edge = L === dirtL && dirtL !== undefined && r < 0.45 && byGrass(cell);
        if (L !== grassL && !(L === forestL && r < 0.12) && !edge) continue;
        if (w.deformGrid.get(x, z) > 0.03) continue;                    // flattened into the ruts
        const y = w.terrain(x, z);
        const wl = w.water(x, z);
        if (wl > -1e8 && y < wl + 0.05) continue;
        // taller in the lush hollows, short on the dry knolls and the high pasture
        T.tintAt(edge ? grassL : L, x, z, y, 0, tint);
        const lush = Math.max(0, 1.2 - tint[0]);
        const alpine = Math.min(1, Math.max(0, (y - 140) / 160));
        const h = (0.3 + 0.32 * lush + 0.16 * hash(x, z, 4)) * (1 - 0.45 * alpine) * (L === forestL ? 0.7 : edge ? 0.6 : 1);
        out.push(x, y - 0.03, z, hash(x, z, 5) * 6.283, h, 0.55 + 0.35 * hash(x, z, 6), r, tint[0], tint[1], tint[2]);
      }
    }
    c = new Float32Array(out);
    this.chunks.set(key, c);
    if (this.chunks.size > 600) for (const k of this.chunks.keys()) { this.chunks.delete(k); if (this.chunks.size <= 400) break; }
    return c;
  }

  /** Forget the chunks over freshly pressed ruts (keys of world/Deform.js chunks, 16 m). */
  markDirty(keys) {
    for (const key of keys) {
      const [x0, z0, x1, z1] = DeformGrid.bounds(key);
      for (let z = Math.floor(z0 / CHUNK); z < Math.ceil(z1 / CHUNK); z++) for (let x = Math.floor(x0 / CHUNK); x < Math.ceil(x1 / CHUNK); x++) this.chunks.delete(x * 65536 + z);
    }
    this.at = null;
  }

  /** wheels: [{x, z, r}] that press the grass flat. */
  update(camera, dt, wheels = []) {
    const U = this.uniforms;
    if (this.ownTime) U.uTime.value += dt;                      // (otherwise the trees' clock drives the wind)
    for (let i = 0; i < 6; i++) {
      const q = U.uPush.value[i], w = wheels[i];
      if (w) q.set(w.x, w.z, w.r, 1); else q.set(0, 0, 0, 0);
    }
    const cam = camera.position;
    const cx = Math.floor(cam.x / CHUNK), cz = Math.floor(cam.z / CHUNK);
    const at = `${cx},${cz},${this.range}`;
    if (at === this.at) return;
    this.at = at;
    const R = this.range + CHUNK, n = Math.ceil(R / CHUNK);
    const P = this.aPos.array, S = this.aSize.array, C = this.aTint.array;
    let m = 0;
    for (let k = -n; k <= n; k++) {
      for (let i = -n; i <= n; i++) {
        const x0 = (cx + i) * CHUNK, z0 = (cz + k) * CHUNK;
        const dx = Math.max(0, Math.abs(cam.x - (x0 + CHUNK / 2)) - CHUNK / 2), dz = Math.max(0, Math.abs(cam.z - (z0 + CHUNK / 2)) - CHUNK / 2);
        if (dx * dx + dz * dz > R * R) continue;
        const c = this.chunk(cx + i, cz + k);
        // the shader thins the far tufts; leave out the ones it would drop even a chunk closer
        const near = Math.max(0, Math.hypot(dx, dz) - CHUNK * 1.5), t = Math.min(1, Math.max(0, (near - 12) / (this.range - 12)));
        const keep = 1 - 0.45 * t * t * (3 - 2 * t);
        for (let j = 0; j < c.length && m < this.cap; j += 10) {
          if (c[j + 6] > keep) continue;
          P[m * 4] = c[j]; P[m * 4 + 1] = c[j + 1]; P[m * 4 + 2] = c[j + 2]; P[m * 4 + 3] = c[j + 3];
          S[m * 4] = c[j + 4]; S[m * 4 + 1] = c[j + 5]; S[m * 4 + 2] = c[j + 6];
          C[m * 3] = c[j + 7]; C[m * 3 + 1] = c[j + 8]; C[m * 3 + 2] = c[j + 9];
          m++;
        }
      }
    }
    this.geometry.instanceCount = m;
    this.count = m;
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aTint.needsUpdate = true;
  }

  setQuality(q) { this.range = RANGE[q] || RANGE.high; this.uniforms.uRange.value = this.range; this.mesh.visible = true; }
}
