// Trees: stylised low-poly pines, firs, birches and dead snags, instanced in three distance bands (near: detailed
// and casting shadows, mid: detailed, far: a single cone or blob). The bands are refilled from the world's tree list
// when the camera has moved far enough. The foliage sways a little in the wind.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NEAR = 110, FAR = 2400;
let MID = 340;

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Shade a geometry's colours from dark at the bottom to light at the top (fake ambient occlusion). */
function gradient(g, y0, y1, lo = 0.72, hi = 1.08) {
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    const f = lo + (hi - lo) * t;
    c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f);
  }
  return g;
}

// geometries are 1 unit tall: the instance scale is the tree's height
function pine(detail) {
  const parts = [];
  if (detail) parts.push(colored(new THREE.CylinderGeometry(0.018, 0.03, 0.4, 5).translate(0, 0.2, 0), 0x5a4030));
  const tiers = detail ? [[0.2, 0.25, 0.42], [0.36, 0.2, 0.36], [0.52, 0.15, 0.3], [0.68, 0.1, 0.26]] : [[0.18, 0.24, 0.82]];
  for (const [y, r, h] of tiers) {
    const g = colored(new THREE.ConeGeometry(r, h, detail ? 7 : 6, 1).translate(0, y + h / 2, 0), 0x3b6a2f);
    parts.push(gradient(g, y, y + h, 0.62, 1.1));
  }
  return mergeGeometries(parts);
}
function fir(detail) {
  const parts = [];
  if (detail) parts.push(colored(new THREE.CylinderGeometry(0.014, 0.024, 0.3, 5).translate(0, 0.15, 0), 0x4e382a));
  const tiers = detail ? [[0.14, 0.17, 0.3], [0.27, 0.15, 0.27], [0.4, 0.12, 0.24], [0.53, 0.09, 0.22], [0.66, 0.065, 0.2], [0.78, 0.04, 0.22]] : [[0.12, 0.16, 0.88]];
  for (const [y, r, h] of tiers) parts.push(gradient(colored(new THREE.ConeGeometry(r, h, detail ? 6 : 5, 1).translate(0, y + h / 2, 0), 0x2d5a34), y, y + h, 0.62, 1.1));
  return mergeGeometries(parts);
}
function birch(detail) {
  const parts = [colored(new THREE.CylinderGeometry(0.02, 0.03, 0.7, 5).translate(0, 0.35, 0), 0xd8d2c4)];
  const blobs = detail ? [[0, 0.62, 0, 0.2], [0.09, 0.78, 0.04, 0.16], [-0.08, 0.74, -0.05, 0.15], [0.02, 0.9, -0.02, 0.12]] : [[0, 0.7, 0, 0.26]];
  for (const [x, y, z, r] of blobs) parts.push(gradient(colored(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), 0x7d9a3e), y - r, y + r, 0.7, 1.12));
  return mergeGeometries(parts);
}
function snag(detail) {
  const parts = [colored(new THREE.CylinderGeometry(0.012, 0.035, 1, 5).translate(0, 0.5, 0), 0x7a6e62)];
  if (detail) {
    for (const [y, a, l] of [[0.45, 0.5, 0.16], [0.6, 2.4, 0.12], [0.75, 4.1, 0.1]]) {
      const b = colored(new THREE.CylinderGeometry(0.006, 0.01, l, 4), 0x6f6458);
      b.rotateZ(Math.PI / 2.6).rotateY(a).translate(Math.cos(a) * l * 0.4, y, -Math.sin(a) * l * 0.4);
      parts.push(b);
    }
  }
  return mergeGeometries(parts);
}

const BUILDERS = [pine, fir, birch, snag];

export class Vegetation {
  constructor(world, scene) {
    this.world = world;
    this.trees = world.trees;
    this.uniforms = { uTime: { value: 0 } };
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float sway = sin(uTime * 1.3 + ip.x * 0.11 + ip.z * 0.07) * 0.6 + sin(uTime * 2.7 + ip.z * 0.3) * 0.25;
    float k = position.y * position.y;
    transformed.x += sway * 0.018 * k;
    transformed.z += sway * 0.012 * k;
  }
#endif`);
    };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.bands = [];
    const n = this.trees.count;
    // capacity per type and band: counts of each type
    const perType = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) perType[this.trees.type[i]]++;
    for (const [band, detail] of [['near', true], ['mid', true], ['far', false]]) {
      const meshes = BUILDERS.map((build, t) => {
        const geo = build(detail);
        const cap = Math.max(1, band === 'near' ? Math.min(perType[t], 1500) : perType[t]);
        const m = new THREE.InstancedMesh(geo, this.material, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0;
        m.castShadow = band === 'near';
        m.receiveShadow = band !== 'far';
        m.frustumCulled = false;
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        this.group.add(m);
        return m;
      });
      this.bands.push({ band, meshes });
    }
    this.lastFill = new THREE.Vector3(1e9, 0, 1e9);
    this.lastFar = new THREE.Vector3(1e9, 0, 1e9);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color(); this._up = new THREE.Vector3(0, 1, 0);
  }

  fill(cam, bandsToFill) {
    const T = this.trees, n = T.count;
    const counts = this.bands.map(() => [0, 0, 0, 0]);
    const m = this._m, q = this._q, s = this._s, p = this._p, c = this._c;
    for (let i = 0; i < n; i++) {
      const dx = T.x[i] - cam.x, dz = T.z[i] - cam.z;
      const d2 = dx * dx + dz * dz;
      const b = d2 < NEAR * NEAR ? 0 : d2 < MID * MID ? 1 : d2 < FAR * FAR ? 2 : -1;
      if (b < 0 || !bandsToFill[b]) continue;
      const t = T.type[i];
      const mesh = this.bands[b].meshes[t];
      const k = counts[b][t];
      if (k >= mesh.instanceMatrix.count) continue;
      counts[b][t]++;
      // stable per-tree variation from its index
      const h1 = Math.sin(i * 12.9898) * 43758.5453, r1 = h1 - Math.floor(h1);
      const h2 = Math.sin(i * 78.233) * 12543.123, r2 = h2 - Math.floor(h2);
      q.setFromAxisAngle(this._up, r1 * 6.283);
      const ht = T.h[i], wd = ht * (0.85 + r2 * 0.35);
      s.set(wd, ht, wd);
      p.set(T.x[i], T.y[i] - 0.15, T.z[i]);
      m.compose(p, q, s);
      mesh.setMatrixAt(k, m);
      const tint = 0.86 + r2 * 0.26;
      c.setRGB(tint * (0.95 + r1 * 0.1), tint, tint * (0.92 + r1 * 0.08));
      mesh.setColorAt(k, c);
    }
    for (let b = 0; b < 3; b++) {
      if (!bandsToFill[b]) continue;
      this.bands[b].meshes.forEach((mesh, t) => {
        mesh.count = counts[b][t];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
  }

  update(camera, dt) {
    this.uniforms.uTime.value += dt;
    const cam = camera.position;
    const moved = Math.hypot(cam.x - this.lastFill.x, cam.z - this.lastFill.z);
    const movedFar = Math.hypot(cam.x - this.lastFar.x, cam.z - this.lastFar.z);
    if (moved > 18 || movedFar > 90) {
      // all bands together, so a tree is never drawn twice (or not at all) where the bands meet
      this.fill(cam, [true, true, true]);
      this.lastFill.copy(cam);
      this.lastFar.copy(cam);
    }
  }

  setShadows(on) { for (const m of this.bands[0].meshes) m.castShadow = on; }

  /** Distance out to which trees are drawn in full (beyond it they are simple cones). */
  setDetailRange(mid) { MID = mid; this.lastFill.set(1e9, 0, 1e9); }
}

export async function preview(world, r) { return new Vegetation(world, r.scene); }
