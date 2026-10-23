// Tea: an estate's rows of bushes, clipped flat at waist height, running round the hills along the contours with
// narrow paths between them for the pluckers. A row is a hedge of rounded bushes (dark mature leaves, the bright
// flush of new leaves on top), built along the iso-lines of the ground's height every ROW m of rise, so on a steep
// hillside the rows crowd together and on a gentle one they spread out, as planted. Near the camera each row has a
// rounded section and short segments; further out a simpler one; beyond that the terrain draws the rows as stripes
// (render/Terrain.js). Where a truck has driven through, the bushes are flattened into its ruts.
//
// Built per CHUNK m square (cached) and gathered when the camera crosses into another chunk.

import * as THREE from 'three';
import { SURFACE } from '../physics/Surfaces.js';
import { DeformGrid } from '../world/Deform.js';

const CHUNK = 24;
export const TEA_ROW = 0.6;                      // m of rise between rows (also the terrain's stripes)
const TOP = 0.92, HALF = 0.56;                   // a bush's height and half-width
/** How far (m) the hedges reach, by graphics level, and where they turn simple. */
const RANGE = { high: 150, medium: 110, low: 70 };
const NEAR = 55;
const STEEP = 0.84;                              // the steepest ground planted (rise over run)
// the colours of the leaves: mature, flush, shade (linear)
const LEAF = [0.06, 0.16, 0.03], FLUSH = [0.2, 0.38, 0.05], SHADE = [0.02, 0.05, 0.012];

const hash = (x, z, s) => { const h = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };

export class Tea {
  constructor(world, scene) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'tea';
    scene.add(this.group);
    this.chunks = new Map();               // key -> { mesh, lod } (mesh null: no tea there)
    this.range = RANGE.high;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTeaW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTeaW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vTeaW;
float th(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float tn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(th(i), th(i + vec3(1,0,0)), f.x), mix(th(i + vec3(0,1,0)), th(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(th(i + vec3(0,0,1)), th(i + vec3(1,0,1)), f.x), mix(th(i + vec3(0,1,1)), th(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
// clusters of leaves: light and dark flecks at a few sizes
float lf = tn(vTeaW * 9.0) * 0.55 + tn(vTeaW * 23.0) * 0.45;
diffuseColor.rgb *= 0.72 + 0.56 * lf;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // the leaves' facets catch the light: tilt the normal by a bumpy field
  vec3 g = vec3(tn(vTeaW * 14.0 + 3.1), tn(vTeaW * 14.0 + 7.3), tn(vTeaW * 14.0 + 11.9)) - 0.5;
  normal = normalize(normal + (viewMatrix * vec4(g * 0.9, 0.0)).xyz);
}`);
    };
    this.at = null;
  }

  /** The hedges of one chunk (a mesh, or null where no tea grows). lod 0: near, 1: simple. */
  build(cx, cz, lod) {
    const w = this.world, x0 = cx * CHUNK, z0 = cz * CHUNK;
    // any tea here at all?
    let any = false;
    for (let z = z0; z <= z0 + CHUNK && !any; z += 3) for (let x = x0; x <= x0 + CHUNK && !any; x += 3) if (w.surfaceId(x, z) === SURFACE.TEA) any = true;
    if (!any) return null;
    const g = lod ? 1 : 0.5, n = Math.round(CHUNK / g) + 1;
    const H = new Float32Array(n * n);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) H[k * n + i] = w.terrain(x0 + i * g, z0 + k * g);
    const pos = [], nor = [], col = [];
    const prof = lod
      ? [[-HALF, 0.05, -1, 0.15], [0, TOP, 0, 1], [HALF, 0.05, 1, 0.15]]
      : [[-HALF, 0.02, -1, 0.1], [-HALF * 0.86, TOP * 0.62, -0.85, 0.5], [-HALF * 0.45, TOP * 0.97, -0.3, 1], [HALF * 0.45, TOP * 0.97, 0.3, 1], [HALF * 0.86, TOP * 0.62, 0.85, 0.5], [HALF, 0.02, 1, 0.1]];
    const P = prof.length;
    // a hedge piece from a to b (each [x, z]): its section at each end, quads between
    const piece = (ax, az, bx, bz) => {
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (w.surfaceId(mx, mz) !== SURFACE.TEA) return;
      const bush = hash(Math.round(mx * 0.8), Math.round(mz * 0.8), 1);
      if (bush < 0.04) return;                                                 // a gap: a dead bush, a path
      let dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const lx = -dz, lz = dx;                                                 // across the row
      const ends = [[ax, az], [bx, bz]].map(([x, z]) => {
        const crushed = w.deformGrid.get(x, z) > 0.012 ? 0.22 : 1;
        const top = (0.84 + 0.16 * hash(Math.round(x * 1.7), Math.round(z * 1.7), 2)) * crushed;
        const y = w.terrain(x, z) - 0.04;
        return prof.map(([u, v, nu, nv]) => [x + lx * u * (crushed < 1 ? 1.3 : 1), y + v * top, z + lz * u * (crushed < 1 ? 1.3 : 1), lx * nu, nv, lz * nu]);
      });
      const shade = 0.85 + 0.3 * bush;
      for (let q = 0; q < P - 1; q++) {
        const a0 = ends[0][q], a1 = ends[0][q + 1], b0 = ends[1][q], b1 = ends[1][q + 1];
        for (const v of [a0, b0, b1, a0, b1, a1]) {
          pos.push(v[0], v[1], v[2]);
          const nl = Math.hypot(v[3], v[4], v[5]) || 1;
          nor.push(v[3] / nl, v[4] / nl, v[5] / nl);
          // flush on top, mature leaves on the sides, shade at the foot
          const up = Math.max(0, v[4] / nl), low = 1 - Math.min(1, (v[1] - w.terrain(v[0], v[2])) / (TOP * 0.5));
          for (let c = 0; c < 3; c++) col.push((LEAF[c] + (FLUSH[c] - LEAF[c]) * up * up - (LEAF[c] - SHADE[c]) * Math.max(0, low)) * shade);
        }
      }
    };
    // marching squares: where each row (a level of the height, every TEA_ROW m) crosses each cell
    for (let k = 0; k < n - 1; k++) for (let i = 0; i < n - 1; i++) {
      const h00 = H[k * n + i], h10 = H[k * n + i + 1], h01 = H[(k + 1) * n + i], h11 = H[(k + 1) * n + i + 1];
      const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
      // (none planted on a bank steeper than 40 degrees, a road's cut: there the rows stacked into bars standing out
      // of the bank, and its soil shows)
      if (Math.hypot(h10 - h00 + h11 - h01, h01 - h00 + h11 - h10) / (2 * g) > STEEP) continue;
      for (let L = Math.ceil(lo / TEA_ROW); L * TEA_ROW < hi; L++) {
        const v = L * TEA_ROW, cut = [];
        const edge = (ha, hb, xa, za, xb, zb) => { if ((ha < v) !== (hb < v)) { const t = (v - ha) / (hb - ha); cut.push([xa + (xb - xa) * t, za + (zb - za) * t]); } };
        const X = x0 + i * g, Z = z0 + k * g;
        edge(h00, h10, X, Z, X + g, Z); edge(h10, h11, X + g, Z, X + g, Z + g);
        edge(h11, h01, X + g, Z + g, X, Z + g); edge(h01, h00, X, Z + g, X, Z);
        if (cut.length >= 2) piece(cut[0][0], cut[0][1], cut[1][0], cut[1][1]);
        if (cut.length === 4) piece(cut[2][0], cut[2][1], cut[3][0], cut[3][1]);
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = lod === 0;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    return mesh;
  }

  /** Forget the chunks over freshly pressed ruts (keys of world/Deform.js chunks). */
  markDirty(keys) {
    for (const key of keys) {
      const [x0, z0, x1, z1] = DeformGrid.bounds(key);
      for (let z = Math.floor(z0 / CHUNK); z < Math.ceil(z1 / CHUNK); z++) for (let x = Math.floor(x0 / CHUNK); x < Math.ceil(x1 / CHUNK); x++) {
        const k = x * 65536 + z, c = this.chunks.get(k);
        if (c) { if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); } this.chunks.delete(k); }
      }
    }
    this.at = null;
  }

  update(camera) {
    const cam = camera.position;
    const cx = Math.floor(cam.x / CHUNK), cz = Math.floor(cam.z / CHUNK);
    const at = `${cx},${cz},${this.range}`;
    if (at === this.at) return;
    this.at = at;
    const R = this.range, n = Math.ceil(R / CHUNK) + 1, want = new Map();
    for (let k = -n; k <= n; k++) for (let i = -n; i <= n; i++) {
      const x0 = (cx + i) * CHUNK, z0 = (cz + k) * CHUNK;
      const dx = Math.max(0, Math.abs(cam.x - (x0 + CHUNK / 2)) - CHUNK / 2), dz = Math.max(0, Math.abs(cam.z - (z0 + CHUNK / 2)) - CHUNK / 2);
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      want.set((cx + i) * 65536 + (cz + k), d < NEAR ? 0 : 1);
    }
    // drop what is out of range or at the wrong detail, build what is missing (a few per update)
    for (const [key, c] of this.chunks) {
      if (want.get(key) === c.lod) continue;
      if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); }
      this.chunks.delete(key);
    }
    let budget = 10;
    for (const [key, lod] of want) {
      if (this.chunks.has(key)) continue;
      if (budget-- <= 0) { this.at = null; break; }                 // (the rest on the next update)
      const x = Math.round(key / 65536), z = key - x * 65536;
      const mesh = this.build(x, z, lod);
      if (mesh) this.group.add(mesh);
      this.chunks.set(key, { mesh, lod });
    }
  }

  setQuality(q) { this.range = RANGE[q] || RANGE.high; this.at = null; }
  setShadows(on) { for (const c of this.chunks.values()) if (c.mesh && c.lod === 0) c.mesh.castShadow = on; }
  /** Fill every chunk in range now (before the first frame). */
  prime(camera) { for (let i = 0; i < 80; i++) { this.at = null; this.update(camera); if (this.at !== null) break; } }
}

export const TEA_RANGE = RANGE;
