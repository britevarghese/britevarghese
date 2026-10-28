// Roots across a rough track (world/Worn.js rough: the taiga's Muskeg Trail): each a gnarled tube of bark lying across
// the track where the physics raises its bump, following the ground over the ruts and the hump, thinning out to
// nothing under the verges, sunk in the earth to the bump's height (the ground drawn under it is without the bump,
// render/Terrain.js: the tube is the bump the tyres climb, its top the bump's top and as wide at half its height).
// Only on firm ground, as the physics has them (in mud they are buried). One static mesh for a map's roots: a few
// hundred, made once.
import * as THREE from 'three';
import { WornTracks, GAUGE } from '../world/Worn.js';
import { vnoise } from '../world/Noise.js';

const ACROSS = 2.2;        // m either side of the wheel line a root is followed out to (it thins to nothing by then)
const STEP = 0.14;         // m between a root's rings
const SIDES = 8;           // a ring's corners
// its colours (linear): grey-brown bark, its furrows darker; where the tyres ride over it the bark rubbed off to the
// pale wood; moss on it out under the verges
const BARK = [0.105, 0.08, 0.056], WOOD = [0.36, 0.25, 0.14], MOSS = [0.055, 0.07, 0.028];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The roots of a map's rough tracks, into a group: world, the map's World (world/World.js) with its worn tracks. */
export class Roots {
  constructor(world, group) {
    const G = world.worn, pos = [], col = [], idx = [];
    const p = { x: 0, z: 0, dx: 0, dz: 0 }, ring = [];
    for (const L of G.lines) {
      if (!L.rough) continue;
      // (each root once: those rootsAt finds round each stretch, kept in the stretch they fall in)
      for (let b = 0; b * 5 < L.len; b++) {
        const n = G.rootsAt(L, (b + 0.5) * 5);
        for (let i = 0; i < n; i += 4) {
          const c = G.roots[i], slant = G.roots[i + 1], hgt = G.roots[i + 2], hw = G.roots[i + 3];
          if (c < b * 5 || c >= (b + 1) * 5) continue;
          ring.length = 0;
          for (let u = -ACROSS; u <= ACROSS + 1e-6; u += STEP) {
            // (its line a little crooked)
            const s = c + u * slant + 0.035 * (vnoise(u * 1.4, c, 703) * 2 - 1);
            if (!G.pointAt(L, s, p)) { ring.push(null); continue; }
            const off = WornTracks.wander(L, s) * G.free(p.x, p.z) + u, x = p.x - p.dz * off, z = p.z + p.dx * off;
            // (its height as the physics has it: thinning under the track's edges, on firm ground only, fading at the
            // track's ends and the map's edge)
            const end = (L.open0 ? 1 : sstep(0, 10, s)) * (L.open1 ? 1 : sstep(0, 10, L.len - s));
            const wear = world.wearAt(x, z) * G.free(x, z);
            const h = hgt * (1 - sstep(1.3, 2.2, Math.abs(u))) * sstep(0.82, 0.95, wear * end);
            // (none in a hole: the physics has the hole there)
            if (h < 0.015 || G.potDepth(G.potsAt(L, s), s, u, wear) > 0.01) { ring.push(null); continue; }
            // (round, as wide at half its height as the bump, cos squared hw either side: (hw^2 + h^2) / 4h; deeper
            // sunk where it thins, as a root dives under the verge; a little gnarled, its girth swelling and narrowing)
            const r = Math.min(0.2, (hw * hw + h * h) / (4 * h)) * (0.88 + 0.24 * vnoise(u * 2.3, c, 701));
            // (rubbed where the wheels go, GAUGE either side of the middle; mossy out under the verges)
            const worn = 1 - sstep(0.12, 0.34, Math.abs(Math.abs(u) - GAUGE)), moss = sstep(1.0, 1.8, Math.abs(u));
            ring.push({ x, y: world.terrain(x, z) - r, z, r, tone: 0.8 + 0.4 * vnoise(u * 1.7, c * 0.3, 702), worn, moss, c });
          }
          // a tube through each unbroken run of rings
          let run = [];
          const flush = () => { if (run.length >= 2) tube(run, pos, col, idx); run = []; };
          for (const q of ring) { if (q) run.push(q); else flush(); }
          flush();
        }
      }
    }
    this.mesh = null;
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    group.add(this.mesh);
  }

  /** Whether they cast shadows (each root its shadow on the ground beside it). */
  setShadows(on) { if (this.mesh) this.mesh.castShadow = on; }

  dispose() { if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.dispose(); } }
}

/**
 * A tube through rings [{ x, y, z, r, tone, worn, moss, c }], into the arrays: its ends closed off with a point, its
 * bark ridged and furrowed along it (each corner drawn in a little, never out: its top no higher than the ground's
 * bump).
 */
function tube(rings, pos, col, idx) {
  const n = rings.length, base = pos.length / 3;
  for (let k = 0; k < n; k++) {
    const a = rings[Math.max(0, k - 1)], b = rings[Math.min(n - 1, k + 1)], q = rings[k];
    // (round the way along: one way across it level, the other up)
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let nx = -tz, nz = tx;
    const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const bx = -ty * nz, by = tx * nz - tz * nx, bz = ty * nx;
    // (the ends drawn in to a point)
    const r0 = k === 0 || k === n - 1 ? q.r * 0.25 : q.r;
    for (let j = 0; j < SIDES; j++) {
      const t = (j / SIDES) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
      const ridge = vnoise(j * 0.9 + q.c * 7, k * 0.35, 704), r = r0 * (1 - 0.13 * ridge);
      pos.push(q.x + (nx * cs + bx * sn) * r, q.y + by * sn * r, q.z + (nz * cs + bz * sn) * r);
      // (the bark furrowed along it, darker underneath where the earth clings; rubbed pale on top in the wheel tracks,
      // mossy on top at the verges)
      const up = Math.max(0, sn), k2 = q.tone * (0.62 + 0.38 * up) * (1.08 - 0.4 * ridge);
      const rub = q.worn * sstep(0.25, 0.85, sn) * 0.85, green = q.moss * sstep(0, 0.6, sn) * 0.6;
      for (let c = 0; c < 3; c++) col.push((BARK[c] * k2 * (1 - rub) + WOOD[c] * q.tone * rub) * (1 - green) + MOSS[c] * green);
    }
  }
  for (let k = 0; k < n - 1; k++) {
    for (let j = 0; j < SIDES; j++) {
      const a = base + k * SIDES + j, b = base + k * SIDES + ((j + 1) % SIDES), c = a + SIDES, d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
  }
}
