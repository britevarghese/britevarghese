// Ledges (world/Ledges.js): a canyon wall's beds as slabs of rock jutting out of it, each block a slab along the wall
// whose lip stands out past the face below, the recess under it in its shadow. Built a square at a time near the
// camera (out past a few hundred metres the ground's own beds, render/Terrain.js, are all that shows), in the rock of
// the ground textures, banded in the map's strata colours, darker under the lips and streaked with desert varnish
// down the faces.
import * as THREE from 'three';
import { ledgeSteps, tracksOf } from '../world/Ledges.js';
import { rockMaterial } from './Rocks.js';

const CHUNK = 64;              // m square
const NEAR = 250, KEEP = 330;  // built out to, kept out to (m)
const SHADOW = 140;            // casting shadows out to (m)
const SLICE = 2.5;             // ms a frame given to building them (a square takes a few frames' slices)

/**
 * A block's cross-section, out from the face (s) and up (v) from its lip's line on the face: the top running back
 * into the face above, the rounded lip, the front, the underside running back into the face below; and how dark each
 * corner is (the underside in the shadow of the recess).
 */
function profile(jut, thick, sl) {
  const back = thick / Math.max(sl, 0.3), lip = Math.min(3.6, back + jut), r = Math.min(0.28, thick * 0.22);
  return {
    pts: [[-0.9, 0.02], [lip - r, 0.02], [lip, -r], [lip - 0.12, -thick + r], [lip - 0.12 - r, -thick], [Math.min(back - 0.7, lip - 0.6), -thick]],
    ao: [1, 1, 0.96, 0.74, 0.5, 0.42],
  };
}

/** A square's strips (world/Ledges.js), then their mesh (null if it has none), a step at a time: a strip a step. */
function* chunkSteps(world, x, z, size, spec, tint) {
  const strips = yield* ledgeSteps(world, x, z, size, spec);
  return yield* build(strips, tint);
}

/** The mesh of a square's strips (null if it has none), a strip a step. */
function* build(strips, tint) {
  const pos = [], nor = [], col = [], ao = [], idx = [];
  const c = [1, 1, 1];
  for (const s of strips) {
    const n = s.pts.length / 3;
    // (each block its bed's band, a shade lighter or darker than the next)
    c[0] = c[1] = c[2] = 1;
    tint(s.pts[0], s.pts[2], s.pts[1], c);
    const shade = 0.96 + 0.08 * ((s.level * 7 + Math.floor(s.pts[0] * 0.37 + s.pts[2] * 0.21)) % 5) / 4;
    // which way the strip runs: the top's triangles wound to face up
    const tx = s.pts[3] - s.pts[0], tz = s.pts[5] - s.pts[2], flip = s.out[1] * tx - s.out[0] * tz < 0;
    const secs = [];
    for (let j = 0; j < n; j++) {
      const x = s.pts[3 * j], y = s.pts[3 * j + 1], z = s.pts[3 * j + 2], nx = s.out[2 * j], nz = s.out[2 * j + 1];
      // (the lip ragged along the block, and the block squared off a little at its ends)
      const f = Math.min(j, n - 1 - j), end = f === 0 ? 0.82 : f === 1 ? 0.94 : 1;
      const P = profile(s.jut * (1 + s.wave * Math.sin(j * 0.9 + s.level)) * end, s.thick * (f === 0 ? 0.9 : 1), s.sl[j]);
      // (its ends set in a hand's breadth: the crack of the joint between it and the next block)
      let px = x, pz = z;
      if (f === 0) { const k = j ? j - 1 : 1, dx = s.pts[3 * k] - x, dz = s.pts[3 * k + 2] - z, l = Math.hypot(dx, dz) || 1; px += dx / l * 0.14; pz += dz / l * 0.14; }
      secs.push(P.pts.map(([u, v]) => [px + nx * u, y + v, pz + nz * u]));
      secs[j].ao = P.ao;
      secs[j].n = [nx, nz];
    }
    const push = (p, N, a) => { pos.push(p[0], p[1], p[2]); nor.push(N[0], N[1], N[2]); col.push(c[0] * shade, c[1] * shade, c[2] * shade); ao.push(a); return pos.length / 3 - 1; };
    // each face of the cross-section along the strip: its own vertices, so its edges stay sharp
    for (let f = 0; f < 5; f++) {
      let prev = null;
      for (let j = 0; j < n; j++) {
        const S = secs[j], a = S[f], b = S[f + 1], [nx, nz] = S.n;
        // (the face's normal: across its edge in the cross-section, turned out into the world)
        const du = (b[0] - a[0]) * nx + (b[2] - a[2]) * nz, dv = b[1] - a[1], l = Math.hypot(du, dv) || 1;
        const ns = -dv / l, nv = du / l, N = [nx * ns, nv, nz * ns];
        const ia = push(a, N, S.ao[f]), ib = push(b, N, S.ao[f + 1]);
        if (prev) {
          const [pa, pb] = prev;
          if (flip) idx.push(pa, ib, pb, pa, ia, ib); else idx.push(pa, pb, ib, pa, ib, ia);
        }
        prev = [ia, ib];
      }
    }
    // the ends: the cross-section, square to the strip
    for (const [j, dir] of [[0, -1], [n - 1, 1]]) {
      const S = secs[j], k = Math.min(n - 1, Math.max(0, j - dir)), o = secs[k];
      let ex = S[0][0] - o[0][0], ez = S[0][2] - o[0][2];
      const l = Math.hypot(ex, ez) || 1; ex /= l; ez /= l;
      const base = pos.length / 3;
      for (let q = 0; q < 6; q++) push(S[q], [ex, 0, ez], S.ao[q] * 0.85);
      // (wound to face out of the strip's end)
      for (let q = 1; q < 5; q++) {
        if ((dir > 0) !== flip) idx.push(base, base + q, base + q + 1); else idx.push(base, base + q + 1, base + q);
      }
    }
    yield;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export class Ledges {
  constructor(world, scene, ground) {
    this.world = world;
    this.spec = world.map.ledges;
    this.scene = scene;
    this.material = rockMaterial(ground, { ledge: true });
    this.chunks = new Map();
    const M = world.map;
    this.tint = (x, z, y, c) => M.tint?.(x, z, 'rock', y, c);
    this.shadows = true;
    this.job = null;
    tracksOf(world);                                          // (made now, while the map loads, not at the first square)
  }

  /** The squares near the camera built, nearest first, a slice of a frame's time at a time; those far off let go. */
  update(camera) {
    const cam = camera.position, H = this.world.half;
    const want = [];
    const r = Math.ceil(NEAR / CHUNK);
    const ci = Math.floor(cam.x / CHUNK), ck = Math.floor(cam.z / CHUNK);
    for (let k = ck - r; k <= ck + r; k++) for (let i = ci - r; i <= ci + r; i++) {
      const x0 = i * CHUNK, z0 = k * CHUNK;
      if (x0 + CHUNK < -H || z0 + CHUNK < -H || x0 > H || z0 > H) continue;
      const d = Math.hypot(Math.max(0, Math.abs(cam.x - (x0 + CHUNK / 2)) - CHUNK / 2), Math.max(0, Math.abs(cam.z - (z0 + CHUNK / 2)) - CHUNK / 2));
      if (d > NEAR) continue;
      const key = `${i},${k}`;
      if (!this.chunks.has(key)) want.push([d, key, x0, z0]);
    }
    want.sort((a, b) => a[0] - b[0]);
    // (the square being built: on with it, or the nearest wanted; given up if it has fallen out of range)
    if (this.job && !want.some((w) => w[1] === this.job.key)) this.job = null;
    const t0 = performance.now();
    while (performance.now() - t0 < SLICE) {
      if (!this.job) {
        if (!want.length) break;
        const [, key, x0, z0] = want.shift(), x1 = Math.max(x0, -H), z1 = Math.max(z0, -H);
        const sz = Math.min(Math.min(x0 + CHUNK, H) - x1, Math.min(z0 + CHUNK, H) - z1);
        this.job = { key, x: x0 + CHUNK / 2, z: z0 + CHUNK / 2, it: chunkSteps(this.world, x1, z1, sz, this.spec, this.tint) };
      }
      const r = this.job.it.next();
      if (!r.done) continue;
      const g = r.value;
      let mesh = null;
      if (g) {
        mesh = new THREE.Mesh(g, this.material);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
      this.chunks.set(this.job.key, { mesh, x: this.job.x, z: this.job.z });
      const done = this.job.key;
      this.job = null;
      const at = want.findIndex((w) => w[1] === done);
      if (at >= 0) want.splice(at, 1);
    }
    for (const [key, ch] of this.chunks) {
      const d = Math.hypot(ch.x - cam.x, ch.z - cam.z);
      if (d > KEEP + CHUNK) {
        if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
        this.chunks.delete(key);
      } else if (ch.mesh) ch.mesh.castShadow = this.shadows && d < SHADOW;
    }
  }

  setShadows(on) { this.shadows = on; }

  /** Every square let go (the camera gone far off). */
  release() {
    for (const ch of this.chunks.values()) if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
    this.chunks.clear();
    this.job = null;
  }
}
