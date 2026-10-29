// Shared kit for the procedurally modelled weapons (build-carbine.mjs, build-grenade.mjs): chamfered parts with
// worn edges (vertex colour), box-projected UVs, tileable procedural detail maps (micro-normal + roughness
// variation, generated here — no external texture source) and GLB export with the maps embedded as WebP.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

// the exporter reads Blobs through FileReader (browser API)
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

// ------------------------------------------------------------------ parts
// A part = non-indexed geometry with position / normal / uv / color. `paint` = [face rgb, worn-edge rgb] (linear):
// faces whose normal is off the part's own axes (chamfers, bevels) get the worn colour — bare metal / scuffed
// polymer shows exactly where real guns wear.
export class Parts {
  constructor(uvScale = 1) { this.list = []; this.uvScale = uvScale; }
  add(geo, paint, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sy = 1, wear = 'chamfer', uv = this.uvScale, smooth = false } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (sy !== 1) g.scale(1, sy, 1);
    if (!smooth) g.computeVertexNormals();
    colorize(g, paint, wear, x * 31 + y * 17 + z * 13);
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    boxUV(g, uv);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    this.list.push(g);
    return g;
  }
  merge() { const g = mergeGeometries(this.list); return g; }
}

// box with every edge chamfered by c (a convex hull of 24 points)
export function cbox(w, h, d, c = 0.0012) {
  c = Math.min(c, w / 3, h / 3, d / 3);
  const pts = [], X = w / 2, Y = h / 2, Z = d / 2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(new THREE.Vector3(sx * (X - c), sy * Y, sz * (Z - c)), new THREE.Vector3(sx * X, sy * (Y - c), sz * (Z - c)), new THREE.Vector3(sx * (X - c), sy * (Y - c), sz * Z));
  }
  return new ConvexGeometry(pts);
}

// side profile [[z, y], ...] (weapon space) extruded across X, bevelled
export function profile(pts, width, bevel = 0.0015, segs = 1) {
  const sh = new THREE.Shape();
  // (shape x = -z: the quarter turn about Y below maps it back to +z without mirroring the faces)
  sh.moveTo(-pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) sh.lineTo(-p[0], p[1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(Math.PI / 2); // extrusion -> weapon X
  return g;
}

// tube along Z (open-ended ring when ri > 0)
export function tube(r, len, seg = 16, ri = 0, r2 = r) {
  if (!ri) return new THREE.CylinderGeometry(r2, r, len, seg).rotateX(Math.PI / 2);
  const sh = new THREE.Shape().absarc(0, 0, r, 0, Math.PI * 2, false);
  sh.holes.push(new THREE.Path().absarc(0, 0, ri, 0, Math.PI * 2, true));
  return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: seg }).translate(0, 0, -len / 2);
}

function colorize(g, [face, edge], wear, seed = 0) {
  const n = g.attributes.normal, cnt = n.count, col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i += 3) {
    // face normal of the triangle (flat), in the part's own frame
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += n.getX(i + k); ny += n.getY(i + k); nz += n.getZ(i + k); }
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const m = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    // chamfer: off every axis of the part's own frame (cbox); bevel: the bevel ring of a profile extruded along X
    const worn = wear === 'all' || (wear === 'chamfer' && m < 0.97) || (wear === 'bevel' && Math.abs(nx) > 0.15 && Math.abs(nx) < 0.97);
    // wear differs from edge to edge (handled corners shine, others keep their finish); one value per face plane
    // so the two triangles of a facet still share their corners
    const h = hash(nx * 3.1 + seed, ny * 5.7 + seed * 0.37, nz * 2.3);
    const k = worn ? 0.25 + 0.75 * h * h : 0.06 * h;
    for (let j = 0; j < 3; j++) col.set([face[0] + (edge[0] - face[0]) * k, face[1] + (edge[1] - face[1]) * k, face[2] + (edge[2] - face[2]) * k], (i + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// triplanar-style box projection: each triangle takes the two axes across its normal (metres * scale)
function boxUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += Math.abs(n.getX(i + k)); ny += Math.abs(n.getY(i + k)); nz += Math.abs(n.getZ(i + k)); }
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      const [u, v] = nx >= ny && nx >= nz ? [z, y] : ny >= nz ? [x, z] : [x, y];
      uv[(i + k) * 2] = u * s; uv[(i + k) * 2 + 1] = v * s;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

export const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }; // sRGB hex -> linear rgb

// ------------------------------------------------------------------ procedural detail maps (tileable)
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// tileable value-noise fBm, N x N, in [0, 1]
export function fbm(N, { seed = 1, octaves = 5, base = 8, gain = 0.5, stretch = 1 } = {}) {
  const out = new Float32Array(N * N), r = rng(seed);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = base << o, cy = Math.max(1, Math.round(cells / stretch)), grid = new Float32Array(cells * cy);
    for (let i = 0; i < grid.length; i++) grid[i] = r();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const gx = (x / N) * cells, gy = (y / N) * cy, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const g = (a, b) => grid[((b + cy) % cy) * cells + ((a + cells) % cells)];
      const v = (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
      out[y * N + x] += v * amp;
    }
    tot += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
// polymer stipple: dense small bumps (tileable)
export function stipple(N, { seed = 7, count = 2600, rMin = 1.2, rMax = 2.6 } = {}) {
  const h = new Float32Array(N * N), r = rng(seed);
  for (let i = 0; i < count; i++) {
    const cx = r() * N, cy = r() * N, rad = rMin + r() * (rMax - rMin);
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d < 1) { const k = ((y % N) + N) % N * N + ((x % N) + N) % N; h[k] = Math.max(h[k], Math.sqrt(1 - d * d)); }
    }
  }
  return h;
}
// height field -> tangent-space normal map (RGB bytes)
export function normalMap(h, N, strength) {
  const out = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const H = (a, b) => h[((b + N) % N) * N + ((a + N) % N)];
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const L = Math.hypot(dx, dy, 1), i = (y * N + x) * 3;
    out[i] = Math.round((-dx / L * 0.5 + 0.5) * 255); out[i + 1] = Math.round((dy / L * 0.5 + 0.5) * 255); out[i + 2] = Math.round((1 / L * 0.5 + 0.5) * 255);
  }
  return out;
}
// glTF metallicRoughness map: G = roughness multiplier, B = metalness multiplier (R unused = 1)
export function ormMap(h, N, rLo, rHi, metal = 1) {
  const out = Buffer.alloc(N * N * 3);
  for (let i = 0; i < N * N; i++) { out[i * 3] = 255; out[i * 3 + 1] = Math.round(255 * (rLo + (rHi - rLo) * h[i])); out[i * 3 + 2] = Math.round(255 * metal); }
  return out;
}
export const webp = (raw, N, q = 88) => sharp(raw, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: q }).toBuffer();

// ------------------------------------------------------------------ export
// maps: { materialName: { normal: Buffer(webp), normalScale, orm: Buffer(webp) } }
export async function exportGLB(scene, maps = {}) {
  const glb = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(glb));
  // indexed (flat faces share their corners) + 8-bit normals / colours (KHR_mesh_quantization); positions stay
  // float so node pivots (hinges, bolt axis) are untouched
  await doc.transform(weld(), quantize({ pattern: /^(NORMAL|COLOR_0)$/ }));
  if (Object.keys(maps).length) doc.createExtension(EXTTextureWebP).setRequired(true);
  const cache = new Map();
  const tex = (buf, name) => { if (!cache.has(buf)) cache.set(buf, doc.createTexture(name).setImage(new Uint8Array(buf)).setMimeType('image/webp')); return cache.get(buf); };
  for (const m of doc.getRoot().listMaterials()) {
    const M = maps[m.getName()];
    if (!M) continue;
    if (M.normal) { m.setNormalTexture(tex(M.normal, `${m.getName()}_nor`)); m.setNormalScale(M.normalScale ?? 1); }
    if (M.orm) m.setMetallicRoughnessTexture(tex(M.orm, `${m.getName()}_rough`));
  }
  return Buffer.from(await io.writeBinary(doc));
}

export function stats(root) {
  const b = new THREE.Box3().setFromObject(root), s = b.getSize(new THREE.Vector3());
  let tris = 0; root.traverse((o) => { if (o.isMesh) tris += o.geometry.attributes.position.count / 3; });
  return { size: s, tris };
}
