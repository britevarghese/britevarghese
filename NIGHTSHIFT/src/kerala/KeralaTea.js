// Tea bushes round the camera: the terrain shader paints the estates' rows from afar (KeralaTile, tea in the
// ground texture's alpha); near the camera the rows are real rounded bushes, set along the same contour lines the
// shader draws (row centres where y / 0.4 + wobble is a half-integer), so the painted rows carry on beyond them.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE } from './KeralaTile.js';

const R = 46, CELL = 1, MAX = 7000, ROW = 0.4;
// (the shader's row wobble: keep the two in step)
const wob = (x, z) => 0.4 * (Math.sin(x * 0.071) + Math.sin(z * 0.053 + 1.7));

export class KeralaTea {
  constructor(scene) {
    let g = new THREE.IcosahedronGeometry(0.5, 1);
    g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    // a flat-topped, slightly flattened dome: the sheared top of a plucked bush
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { const y = P.getY(i); P.setY(i, y > 0.25 ? 0.25 + (y - 0.25) * 0.3 : y); }
    g.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(0x224411));   // (the colour buffer before the first draw: the shader needs it from the start)
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.name = 'teaBushes';
    scene.add(this.mesh);
    this.at = null; this.t = 0;
  }

  update(dt, camera, world) {
    this.t -= dt;
    const p = camera.position;
    if (this.at && this.t > 0) return;
    if (this.at && Math.hypot(p.x - this.at[0], p.z - this.at[1]) < 6 && this.tiles === world.tiles.size) return;
    this.t = 0.3; this.at = [p.x, p.z]; this.tiles = world.tiles.size;
    const t0 = world.tileAt(p.x, p.z);
    if (!t0?.ready || !t0.h0 || Math.max(...t0.h0) < 850 || p.y > t0.heightAt(-p.x - t0.E0, p.z - t0.N0) + 120) { this.mesh.count = 0; return; }
    const N = Math.round(2 * R / CELL) + 1, x0 = Math.round(p.x) - R, z0 = Math.round(p.z) - R;
    const F = new Float32Array(N * N), T = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = x0 + i * CELL, z = z0 + j * CELL, t = world.tileAt(x, z);
      F[j * N + i] = t?.ready ? t.heightAt(-x - t.E0, z - t.N0) / ROW + wob(x, z) - 0.5 : NaN;
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const taken = new Set();
    let n = 0;
    const put = (x, z) => {
      if (n >= MAX || (x - p.x) ** 2 + (z - p.z) ** 2 > R * R) return;
      const k = Math.round(x / 0.9) * 100003 + Math.round(z / 0.9);
      if (taken.has(k)) return;
      const t = world.tileAt(x, z); if (!t?.ready) return;
      const e = -x - t.E0, nn = z - t.N0;
      if (!t.isTea?.(e, nn) || t.onRoad(e, nn, 1.2)) return;
      taken.add(k);
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453, r = h - Math.floor(h);
      v.set(x, t.heightAt(e, nn) - 0.12, z);
      q.setFromAxisAngle(up, r * 6.283);
      s.set(1.15 + r * 0.3, 0.95 + r * 0.25, 1.15 + (1 - r) * 0.3);
      m4.compose(v, q, s); this.mesh.setMatrixAt(n, m4);
      // fresh pale-green flush on dark glossy leaves
      col.setRGB(0.05 + r * 0.03, 0.115 + r * 0.04, 0.022 + r * 0.012); this.mesh.setColorAt(n++, col);
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = F[j * N + i]; if (Number.isNaN(a)) continue;
      // the slope here (flat ground carries no rows, as in the shader)
      const b = i + 1 < N ? F[j * N + i + 1] : NaN, c = j + 1 < N ? F[(j + 1) * N + i] : NaN;
      for (const [o, di, dj] of [[b, 1, 0], [c, 0, 1]]) {
        if (Number.isNaN(o) || Math.floor(a) === Math.floor(o)) continue;
        const sl = Math.abs(o - a) * ROW / CELL; if (sl < 0.08 || sl > 2) continue;
        for (let lv = Math.floor(Math.min(a, o)) + 1; lv <= Math.max(a, o); lv++) { const u = (lv - a) / (o - a); put(x0 + (i + di * u) * CELL, z0 + (j + dj * u) * CELL); }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
