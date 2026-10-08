// KeralaTrees: Kerala's greenery. Every tile scatters coconut palms, broadleaf trees (mango, jackfruit, rain
// trees), banana plants and bushes by land use, densest round the houses the way Kerala's compounds are.
// Two levels of detail: each tile draws all its plants as cheap low-poly instances (one draw call per kind),
// and one shared set of detailed meshes is refilled with the plants near the camera. A shader swap at
// radius uR hides the cheap copy where the detailed one is drawn, so nothing has to be re-uploaded per tile.
// The detailed plants are leaf cards on a generated atlas (leaf clusters, pinnate palm fronds, banana leaves,
// bark), lit with normals pointing out of the crown so the foliage reads as a soft volume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE, C, ROAD_HALF } from './KeralaTile.js';

export const KIND = { palm: 0, broad: 1, banana: 2, bush: 3, areca: 4, rubber: 5, bamboo: 6, grass: 7 };
const KINDS = 8;

// atlas regions (u0, v0, u1, v1), v up
const AW = 512, AH = 256;
const R_LEAF = [0, 0, 0.5, 1], R_FROND = [0.5, 0, 0.75, 1], R_BANANA = [0.75, 0, 0.875, 1];
const R_FOLIAGE = [0.88, 0.55, 0.93, 0.95], R_BARK = [0.88, 0.05, 0.93, 0.45], R_PALMBARK = [0.95, 0.05, 1, 0.95];

function atlas() {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const X = (u) => u * AW, Y = (v) => (1 - v) * AH;
  const green = (l = 0) => `hsl(${88 + rnd() * 28}, ${38 + rnd() * 25}%, ${16 + l + rnd() * 18}%)`;
  // leaf clusters: hundreds of small pointed ovals, darker in the middle
  // in several sprigs, so the card's outline is ragged rather than a disc
  const sprigs = [[128, 128, 62]];
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283 + rnd() * 0.5, d = 55 + rnd() * 25; sprigs.push([128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 26 + rnd() * 18]); }
  for (let i = 0; i < 1600; i++) {
    const [cx, cy, sr] = sprigs[i % sprigs.length], a = rnd() * 6.283, r = Math.sqrt(rnd()) * sr;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    g.save(); g.translate(x, y); g.rotate(rnd() * 6.283);
    g.fillStyle = green(Math.hypot(x - 128, y - 128) / 120 * 14);
    g.beginPath(); g.ellipse(0, 0, 7 + rnd() * 5, 3 + rnd() * 1.8, 0, 0, 6.283); g.fill();
    g.restore();
  }
  // palm frond: rib up the middle, leaflets out to both sides, longer mid-frond
  g.save(); g.translate(X(0.625), 0);
  g.strokeStyle = '#8a8a40'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, AH); g.lineTo(0, 0); g.stroke();
  for (let y = 4; y < AH; y += 4) {
    const t = 1 - y / AH, len = 58 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) + 6;
    for (const side of [-1, 1]) {
      g.strokeStyle = green(4); g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(side * len * 0.5, y - 6, side * len, y + 10 + rnd() * 6); g.stroke();
    }
  }
  g.restore();
  // banana leaf: broad, bright, with a pale midrib, side veins and tears
  g.save(); g.translate(X(0.8125), 0);
  g.fillStyle = '#5f9a2e'; g.beginPath(); g.moveTo(0, AH); g.bezierCurveTo(-34, AH * 0.75, -32, AH * 0.2, 0, 0); g.bezierCurveTo(32, AH * 0.2, 34, AH * 0.75, 0, AH); g.fill();
  g.strokeStyle = 'rgba(200,220,120,0.55)'; g.lineWidth = 1;
  for (let y = 6; y < AH; y += 5) { g.beginPath(); g.moveTo(0, y); g.lineTo(-30, y - 6); g.moveTo(0, y); g.lineTo(30, y - 6); g.stroke(); }
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) { const y = 20 + rnd() * (AH - 40), side = rnd() < 0.5 ? -1 : 1; g.beginPath(); g.moveTo(side * 34, y); g.lineTo(side * 3, y - 3); g.lineTo(side * 34, y + 2); g.fill(); }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#c8d890'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, AH); g.lineTo(0, 0); g.stroke();
  g.restore();
  // solid foliage, bark, palm bark (ringed)
  g.fillStyle = '#2f5222'; g.fillRect(X(0.875), 0, X(0.06), AH / 2);
  for (let i = 0; i < 300; i++) { g.fillStyle = rnd() < 0.5 ? '#3a6028' : '#24401a'; g.fillRect(X(0.875) + rnd() * X(0.06), rnd() * AH / 2, 3, 3); }
  g.fillStyle = '#4a3e32'; g.fillRect(X(0.875), AH / 2, X(0.06), AH / 2);
  for (let i = 0; i < 80; i++) { g.fillStyle = rnd() < 0.5 ? '#5a4c3e' : '#3a3026'; g.fillRect(X(0.875) + rnd() * X(0.06), AH / 2 + rnd() * AH / 2, 2, 10); }
  g.fillStyle = '#8a7c66'; g.fillRect(X(0.94), 0, X(0.06), AH);
  for (let y = 0; y < AH; y += 6) { g.fillStyle = '#6a5e4c'; g.fillRect(X(0.94), y, X(0.06), 2); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------------------------------- geometry
// every part ends up non-indexed with position, normal, uv, color
function part(g, hex, region, { dark = 0, centre = null, up = 0 } = {}) {
  g = g.index ? g.toNonIndexed() : g.clone();
  const P = g.attributes.position, n = P.count;
  const c = new THREE.Color(hex), col = new Float32Array(n * 3);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, P.getY(i)); y1 = Math.max(y1, P.getY(i)); }
  for (let i = 0; i < n; i++) {
    const k = 1 - dark * (1 - (P.getY(i) - y0) / Math.max(1e-3, y1 - y0)); // darker underneath (self-shadow)
    col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // uv into the atlas region (solid regions: the whole part samples inside it)
  const uv = g.attributes.uv ? g.attributes.uv.array.slice() : new Float32Array(n * 2).fill(0.5);
  for (let i = 0; i < n; i++) { uv[i * 2] = region[0] + (region[2] - region[0]) * uv[i * 2]; uv[i * 2 + 1] = region[1] + (region[3] - region[1]) * uv[i * 2 + 1]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (centre) {
    // foliage: normals out of the crown (soft, volumetric light), tipped upwards a little
    const N = new Float32Array(n * 3), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { v.set(P.getX(i) - centre[0], P.getY(i) - centre[1] + up, P.getZ(i) - centre[2]).normalize(); N[i * 3] = v.x; N[i * 3 + 1] = v.y; N[i * 3 + 2] = v.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  } else g.computeVertexNormals();
  return g;
}
const merge = (parts) => mergeGeometries(parts);
function lumpy(r, detail, seed) {
  const g = new THREE.IcosahedronGeometry(r, detail), P = g.attributes.position, v = new THREE.Vector3();
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const bumps = new Map();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!bumps.has(k)) bumps.set(k, 0.8 + rnd() * 0.35);
    v.multiplyScalar(bumps.get(k));
    P.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  return g;
}
// leaf cards scattered over a crown: quads facing out of the centre, tilted randomly
function cards(cx, cy, cz, r, count, size, seed, hex) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = [], q = new THREE.Quaternion(), v = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < count; i++) {
    // directions spread over the sphere, fewer underneath
    const y = rnd() * 1.6 - 0.6, a = rnd() * 6.283, h = Math.sqrt(Math.max(0, 1 - y * y));
    v.set(Math.cos(a) * h, y, Math.sin(a) * h);
    const g = new THREE.PlaneGeometry(size * (0.8 + rnd() * 0.4), size * (0.8 + rnd() * 0.4));
    g.rotateZ(rnd() * 6.283);            // spin in its own plane, then face outwards
    q.setFromUnitVectors(z, v); g.applyQuaternion(q);
    g.translate(cx + v.x * r * 0.85, cy + v.y * r * 0.75, cz + v.z * r * 0.85);
    out.push(part(g, hex, R_LEAF, { centre: [cx, cy - r * 0.3, cz], up: 0 }));
  }
  return out;
}

function palmHi() {
  const parts = [];
  let x = 0, y = 0;
  for (let i = 0; i < 4; i++) {
    const h = 2.8, r0 = 0.22 - i * 0.025, r1 = r0 - 0.025, a = 0.04 * (i + 1);
    parts.push(part(new THREE.CylinderGeometry(r1, r0, h, 6, 1, true).translate(0, h / 2, 0).rotateZ(-a).translate(x, y, 0), 0xffffff, R_PALMBARK));
    x += Math.sin(a) * h; y += Math.cos(a) * h;
  }
  const top = [x, y, 0];
  // fronds: a V-folded blade arching out and drooping, textured with leaflets
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + (k % 3) * 0.13, len = 3.6 + (k % 4) * 0.45, up = k < 4 ? 0.6 : 0;
    const pts = [[0, 0.1], [len * 0.33, 0.6 + up], [len * 0.68, 0.25 + up * 0.5], [len, -1.2 - (k % 2) * 0.3]];
    const pos = [], uvs = [];
    for (let s = 0; s < 3; s++) {
      const [d0, y0] = pts[s], [d1, y1] = pts[s + 1], w = 1.15, f = 0.28, v0 = s / 3, v1 = (s + 1) / 3;
      // right half (u 0.5..1) and left half (u 0..0.5) of the frond texture
      pos.push(d0, y0, 0, d1, y1, 0, d1, y1 - f, w, d0, y0, 0, d1, y1 - f, w, d0, y0 - f, w);
      uvs.push(0.5, v0, 0.5, v1, 1, v1, 0.5, v0, 1, v1, 1, v0);
      pos.push(d0, y0, 0, d0, y0 - f, -w, d1, y1 - f, -w, d0, y0, 0, d1, y1 - f, -w, d1, y1, 0);
      uvs.push(0.5, v0, 0, v0, 0, v1, 0.5, v0, 0, v1, 0.5, v1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.rotateY(a).translate(...top);
    parts.push(part(g, [0xd8f0b0, 0xc0e0a0, 0xe8f0b8, 0xe0d8a0][k % 4], R_FROND, { centre: [top[0], top[1] - 1.5, 0] }));
  }
  // coconut bunch
  parts.push(part(new THREE.OctahedronGeometry(0.5, 0).scale(1, 0.8, 1).translate(top[0], top[1] - 0.45, 0), 0x6e6e26, R_FOLIAGE));
  return merge(parts);
}

function broadHi() {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.2, 0.32, 3.2, 6, 1, true).translate(0, 1.6, 0), 0xffffff, R_BARK));
  parts.push(part(new THREE.CylinderGeometry(0.1, 0.16, 2.2, 5, 1, true).translate(0, 1.1, 0).rotateZ(0.6).translate(0.1, 2.8, 0), 0xffffff, R_BARK));
  parts.push(part(new THREE.CylinderGeometry(0.1, 0.16, 2.0, 5, 1, true).translate(0, 1.0, 0).rotateZ(-0.55).rotateY(2).translate(0, 2.8, 0), 0xffffff, R_BARK));
  // crown: a dark core so it never looks hollow, covered in leaf cards
  const lumps = [[0, 5.5, 0, 2.5], [1.5, 5.0, 0.6, 1.9], [-1.3, 5.1, -0.7, 2.0], [0.3, 4.7, -1.5, 1.7], [-0.4, 4.8, 1.5, 1.7], [0.2, 6.5, 0.2, 1.6]];
  lumps.forEach(([x, y, z, r], i) => {
    parts.push(part(lumpy(r * 0.66, 0, 1000 + i * 77).scale(1, 0.8, 1).translate(x, y, z), 0xe8f8d0, R_FOLIAGE, { centre: [0, 5.2, 0], up: 0.5 }));
    parts.push(...cards(x, y, z, r, 8, r * 1.1, 50 + i * 13, 0xffffff));
  });
  return merge(parts);
}

function bananaHi() {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.12, 0.17, 2.0, 6, 1, true).translate(0, 1.0, 0), 0x9aa060, R_PALMBARK));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + k * 0.4, len = 2.0 + (k % 3) * 0.35, w = 0.45, droop = k % 3 === 0 ? 1.0 : 0.55;
    const pts = [[0, 0], [len * 0.25, 0.55], [len * 0.65, 0.5 - droop * 0.4], [len, -droop]];
    const pos = [], uvs = [];
    for (let s = 0; s < 3; s++) {
      const [d0, y0] = pts[s], [d1, y1] = pts[s + 1], v0 = s / 3, v1 = (s + 1) / 3;
      pos.push(d0, y0, -w, d1, y1, -w, d1, y1, w, d0, y0, -w, d1, y1, w, d0, y0, w);
      uvs.push(0, v0, 0, v1, 1, v1, 0, v0, 1, v1, 1, v0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.rotateY(a).translate(0, 2.0, 0);
    parts.push(part(g, k % 3 === 0 ? 0xd8d0a0 : 0xffffff, R_BANANA, { centre: [0, 1.5, 0] }));
  }
  return merge(parts);
}

function bushHi() {
  const parts = [];
  [[0, 0.6, 0, 0.85], [0.6, 0.5, 0.2, 0.65], [-0.5, 0.5, -0.25, 0.65]].forEach(([x, y, z, r], i) => {
    parts.push(part(lumpy(r * 0.8, 0, 300 + i * 31).translate(x, y, z), 0xa0b090, R_FOLIAGE, { centre: [0, 0.2, 0], up: 0.4 }));
    parts.push(...cards(x, y, z, r, 5, r * 1.3, 900 + i * 7, 0xffffff));
  });
  return merge(parts);
}

// areca (kamuku): a very slim, straight, ringed grey trunk ~11 m up, a green crownshaft and a small tuft of fronds
function arecaHi() {
  const parts = [part(new THREE.CylinderGeometry(0.09, 0.13, 10.5, 6, 1, true).translate(0, 5.25, 0).rotateZ(-0.025), 0xc8ccc0, R_PALMBARK)];
  const top = [0.26, 10.5, 0];
  parts.push(part(new THREE.CylinderGeometry(0.13, 0.11, 1.1, 6, 1, true).translate(top[0], top[1] + 0.5, 0), 0x6a9a3a, R_FOLIAGE));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + (k % 2) * 0.3, len = 2.3 + (k % 3) * 0.3;
    const pts = [[0, 0], [len * 0.4, 0.55], [len, -0.7 - (k % 2) * 0.3]], pos = [], uvs = [];
    for (let q = 0; q < 2; q++) {
      const [d0, y0] = pts[q], [d1, y1] = pts[q + 1], w = 0.7, f = 0.18, v0 = q / 2, v1 = (q + 1) / 2;
      pos.push(d0, y0, 0, d1, y1, 0, d1, y1 - f, w, d0, y0, 0, d1, y1 - f, w, d0, y0 - f, w); uvs.push(0.5, v0, 0.5, v1, 1, v1, 0.5, v0, 1, v1, 1, v0);
      pos.push(d0, y0, 0, d0, y0 - f, -w, d1, y1 - f, -w, d0, y0, 0, d1, y1 - f, -w, d1, y1, 0); uvs.push(0.5, v0, 0, v0, 0, v1, 0.5, v0, 0, v1, 0.5, v1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.rotateY(a).translate(top[0], top[1] + 1.05, 0);
    parts.push(part(g, k % 3 ? 0xd8f0b0 : 0xe8e8b0, R_FROND, { centre: [top[0], top[1], 0] }));
  }
  return merge(parts);
}

// rubber: a straight pale-grey trunk, branching high, a light narrow crown (planted in rows on the slopes)
function rubberHi() {
  const parts = [part(new THREE.CylinderGeometry(0.13, 0.2, 6.5, 6, 1, true).translate(0, 3.25, 0), 0xc8c4b8, R_BARK)];
  for (const [rz, ry] of [[0.35, 0], [-0.35, 2.1], [0.3, 4.2]]) parts.push(part(new THREE.CylinderGeometry(0.06, 0.1, 2.4, 5, 1, true).translate(0, 1.2, 0).rotateZ(rz).rotateY(ry).translate(0, 6.2, 0), 0xc0bcb0, R_BARK));
  [[0, 8.6, 0, 1.6], [0.9, 7.8, 0.3, 1.2], [-0.8, 7.9, -0.4, 1.2], [0.1, 9.6, 0.1, 1.1]].forEach(([x, y, z, r], i) => {
    parts.push(part(lumpy(r * 0.6, 0, 1400 + i * 37).scale(1, 0.85, 1).translate(x, y, z), 0xd0e8b8, R_FOLIAGE, { centre: [0, 8.2, 0], up: 0.5 }));
    parts.push(...cards(x, y, z, r, 6, r * 1.15, 140 + i * 17, 0xe0f0c8));
  });
  return merge(parts);
}

// bamboo clump: a dozen tall culms arching out from one base, feathery leaf cards along their upper half
function bambooHi() {
  const parts = [];
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 12; k++) {
    const a = rnd() * 6.283, lean = 0.12 + rnd() * 0.3, h = 7 + rnd() * 4;
    const g = new THREE.CylinderGeometry(0.045, 0.07, h, 5, 1, true).translate(0, h / 2, 0).rotateZ(lean).rotateY(a).translate(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
    parts.push(part(g, 0xb8c070, R_PALMBARK));
    for (let j = 0; j < 4; j++) {
      const t = 0.5 + j * 0.15, x = Math.cos(a) * (0.3 + Math.sin(lean) * h * t), y = Math.cos(lean) * h * t, z = -Math.sin(a) * (0.3 + Math.sin(lean) * h * t);
      parts.push(...cards(x, y, z, 0.9, 2, 1.3, 600 + k * 31 + j, 0xe8f8b0));
    }
  }
  return merge(parts);
}

// a tuft of tall grass: crossed blades from the frond texture's leaflets
function grassHi() {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.9, 0.7).translate(0, 0.33, 0).rotateY((k / 3) * Math.PI);
    parts.push(part(g, k ? 0xd8e8a0 : 0xe8e0a0, [0.5, 0.15, 0.75, 0.6], { centre: [0, -0.4, 0] }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------- distant
function palmLo() {
  // ~9 triangles: a three-sided trunk and three long fronds
  const parts = [part(new THREE.CylinderGeometry(0.15, 0.24, 11, 3, 1, true).translate(0, 5.5, 0).rotateZ(-0.06), 0x7c6c54, R_FOLIAGE)];
  const top = [0.33, 11, 0];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BufferGeometry(), len = 4.2;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-len, -1.2, -0.6, len, -1.2, 0.6, 0, 0.5, 0], 3));
    g.rotateY(k / 3 * Math.PI).translate(...top);
    parts.push(part(g, 0x4d7426, R_FOLIAGE, { centre: [top[0], top[1] - 2, 0] }));
  }
  return merge(parts);
}
function blobLo() {
  // ~14 triangles: a crown on a stub of trunk; scaled per kind
  return merge([part(new THREE.CylinderGeometry(0.2, 0.3, 3.4, 3, 1, true).translate(0, 1.7, 0), 0x4e4236, R_FOLIAGE),
    part(new THREE.OctahedronGeometry(2.8, 0).scale(1.05, 0.85, 1.05).translate(0, 5.4, 0), 0x2f5424, R_FOLIAGE, { dark: 0.4, centre: [0, 4.4, 0] })]);
}

// a Lambert material whose instances vanish inside (lo) or outside (hi) radius uR of the camera
function swapMaterial(U, near, map) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: near ? map : null, alphaTest: near ? 0.42 : 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCam = U.uCam; sh.uniforms.uR = U.uR; sh.uniforms.uFar = U.uFar;
    sh.vertexShader = 'uniform vec3 uCam; uniform float uR; uniform float uFar;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float dd = distance(ip.xz, uCam.xz);
        ${near ? 'if (dd > uR) transformed *= 0.0;' : 'if (dd < uR || dd > uFar) transformed *= 0.0;'} }`);
    // foliage normals point out of the crown on both faces: undo the back-face flip (no dark plates)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal *= faceDirection;');
  };
  m.customProgramCacheKey = () => (near ? 'klTreeHi' : 'klTreeLo');
  return m;
}

export class KeralaTrees {
  constructor(scene, preset) {
    this.U = { uCam: { value: new THREE.Vector3() }, uR: { value: 260 }, uFar: { value: 2200 } };
    this.hiGeo = [palmHi(), broadHi(), bananaHi(), bushHi(), arecaHi(), rubberHi(), bambooHi(), grassHi()];
    this.loGeo = [palmLo(), blobLo()];
    this.atlas = atlas();
    this.hiMat = swapMaterial(this.U, true, this.atlas);
    this.loMat = swapMaterial(this.U, false);
    this.group = new THREE.Group(); this.group.name = 'klTreesNear';
    scene.add(this.group);
    this.setPreset(preset);
  }

  setPreset(p = {}) {
    this.density = p.trees ?? 1;
    this.U.uR.value = 140 + 160 * Math.min(1, this.density);
    this.U.uFar.value = 1100 + 1300 * Math.min(1, this.density);
    this.shadows = !!(p.shadows && p.shadows !== 'off');
    const cap = Math.round(2500 + 7000 * this.density);
    if (this.cap === cap) return;
    this.cap = cap;
    for (const m of this.hi || []) { m.removeFromParent(); m.dispose(); }
    this.hi = this.hiGeo.map((g, k) => {
      const m = new THREE.InstancedMesh(g, this.hiMat, k === KIND.grass ? cap * 2 : k === KIND.bush ? cap : k >= KIND.areca ? Math.round(cap * 0.4) : Math.round(cap * 0.6));
      m.count = 0; m.frustumCulled = false; m.castShadow = this.shadows && k !== KIND.bush && k !== KIND.grass; m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3).setUsage(THREE.DynamicDrawUsage);
      m.name = `klTreeHi${k}`;
      this.group.add(m);
      return m;
    });
    this._at = null;
  }

  // scatter a tile's plants: returns { mesh group (distant copies), data for the near set }
  plant(tile) {
    const D = this.density;
    let s = (tile.tx * 2654435761 ^ tile.tz * 40503) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    // probability of a plant per cell, and the mix [palm, broad, banana, bush] by land use
    const MIX = {
      [C.land]: [0.55, 0.32, 0.38, 0.12, 0.18], [C.town]: [0.5, 0.42, 0.3, 0.12, 0.16], [C.grove]: [0.9, 0.7, 0.18, 0.08, 0.04],
      [C.forest]: [0.95, 0.06, 0.8, 0.0, 0.14], [C.religious]: [0.45, 0.35, 0.5, 0.0, 0.15], [C.grass]: [0.1, 0.3, 0.5, 0, 0.2],
      [C.paddy]: [0.02, 0.85, 0.15, 0, 0], [C.scrub]: [0.35, 0.15, 0.35, 0, 0.5], [C.wetland]: [0.3, 0.55, 0.25, 0, 0.2],
      [C.sand]: [0.3, 0.9, 0.1, 0, 0], [C.commercial]: [0.16, 0.45, 0.45, 0, 0.1], [C.industrial]: [0.12, 0.4, 0.4, 0, 0.2],
    };
    // keep clear of the carriageway: road segments in a 20 m grid
    const RG = new Map(), G = 20;
    for (const r of tile.roads) {
      // the road's real width (main roads are as wide as their lanes) plus the verge and shoulder
      const hw = (r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : (ROAD_HALF[r.cls] ?? 2)) + (r.cls <= 6 ? 2.4 : 1.4);
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        for (let gx = Math.floor((Math.min(a[0], b[0]) - hw) / G); gx <= Math.floor((Math.max(a[0], b[0]) + hw) / G); gx++)
          for (let gz = Math.floor((Math.min(a[1], b[1]) - hw) / G); gz <= Math.floor((Math.max(a[1], b[1]) + hw) / G); gz++) {
            const k = gx * 1000 + gz; if (!RG.has(k)) RG.set(k, []); RG.get(k).push(a[0], a[1], b[0], b[1], hw);
          }
      }
    }
    const onRoad = (e, n) => {
      const L = RG.get(Math.floor(e / G) * 1000 + Math.floor(n / G)); if (!L) return false;
      for (let j = 0; j < L.length; j += 5) {
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < L[j + 4] * L[j + 4]) return true;
      }
      return false;
    };
    const step = 6 / Math.sqrt(Math.max(0.3, Math.min(1, D)));
    const P = [];  // e, n, y, kind, scale, rot, tint
    // rubber estates: whole 300 m blocks of the midland slopes planted in rows (the rows follow one bearing)
    const estate = new Map();
    const isEstate = (e, n) => {
      const k = Math.floor(e / 300) * 100 + Math.floor(n / 300);
      if (!estate.has(k)) {
        const h = (Math.imul(k ^ (tile.tx * 73856093) ^ (tile.tz * 19349663), 2654435761) >>> 0) / 4294967296;
        estate.set(k, h < 0.22 ? h * 30 : -1);
      }
      return estate.get(k);
    };
    for (let n = step / 2; n < TILE; n += step) for (let e = step / 2; e < TILE; e += step) {
      const je = e + (rnd() - 0.5) * step * 0.95, jn = n + (rnd() - 0.5) * step * 0.95;
      const cls = tile.classAt(je, jn), mix = MIX[cls];
      if (!mix || onRoad(je, jn)) continue;
      const h = tile.heightAt(je, jn), est = (cls === C.grove || cls === C.forest || cls === C.land) && h > 40 && h < 700 ? isEstate(je, jn) : -1;
      if (est >= 0) {
        // a 2x2 block of rubber trees on a 3 m grid in the estate's row direction
        if (rnd() < 0.08) continue;
        for (const [a, b] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
          const ca = Math.cos(est), sa = Math.sin(est), pe = Math.round(e / step) * step + (a * ca - b * sa) * step, pn = Math.round(n / step) * step + (a * sa + b * ca) * step;
          if (!onRoad(pe, pn)) P.push(pe, pn, tile.heightAt(pe, pn), KIND.rubber, 0.85 + rnd() * 0.3, rnd() * 6.283, rnd());
        }
        continue;
      }
      // grass tufts on open ground and along the verges
      if ((cls === C.grass || cls === C.land || cls === C.scrub || cls === C.wetland || cls === C.town) && rnd() < 0.35 * D) {
        for (let t = 0; t < 1; t++) { const ge = je + (rnd() - 0.5) * step, gn = jn + (rnd() - 0.5) * step; if (!onRoad(ge, gn)) P.push(ge, gn, tile.heightAt(ge, gn), KIND.grass, 0.6 + rnd() * 0.8, rnd() * 6.283, rnd()); }
      }
      if (rnd() > mix[0]) continue;
      let r = rnd() * (mix[1] + mix[2] + mix[3] + mix[4]), kind = KIND.palm;
      if ((r -= mix[1]) > 0) kind = (r -= mix[2]) > 0 ? ((r -= mix[3]) > 0 ? KIND.bush : KIND.banana) : KIND.broad;
      if (kind === KIND.palm && h > 900) kind = KIND.broad; // no coconut palms high in the Ghats
      // areca grows among the coconuts round the houses; bamboo by water and on scrubby ground
      if (kind === KIND.palm && (cls === C.land || cls === C.town || cls === C.grove) && rnd() < 0.3) kind = KIND.areca;
      if ((kind === KIND.bush || kind === KIND.broad) && (cls === C.wetland || cls === C.scrub || tile.classAt(je + 8, jn) === C.water || tile.classAt(je - 8, jn) === C.water) && rnd() < 0.35) kind = KIND.bamboo;
      const sc = kind === KIND.palm ? 0.8 + rnd() * 0.45 : kind === KIND.broad ? 0.65 + rnd() * 0.7 : kind === KIND.areca ? 0.85 + rnd() * 0.3 : 0.7 + rnd() * 0.6;
      P.push(je, jn, h, kind, sc, rnd() * 6.283, rnd());
    }
    const N = P.length / 7;
    const data = { e0: tile.E0, n0: tile.N0, P: new Float32Array(P), cells: new Map() };
    for (let i = 0; i < N; i++) {
      const c = Math.floor(P[i * 7] / 100) + Math.floor(P[i * 7 + 1] / 100) * 64;
      if (!data.cells.has(c)) data.cells.set(c, []);
      data.cells.get(c).push(i);
    }
    // shade under the canopy on the ground texture (also what reads as forest from far away)
    if (tile.visCanvas) {
      const V = tile.visCanvas.getContext('2d'), RS = tile.visCanvas.width / TILE;
      V.fillStyle = 'rgba(22,40,16,0.32)';
      for (let i = 0; i < N; i++) {
        const k = P[i * 7 + 3]; if (k === KIND.bush || k === KIND.grass) continue;
        const r = (k === KIND.broad ? 3.6 : k === KIND.palm ? 2.6 : k === KIND.rubber ? 2.2 : k === KIND.bamboo ? 2.4 : 1.4) * P[i * 7 + 4] * RS;
        V.beginPath(); V.arc(P[i * 7] * RS, (TILE - P[i * 7 + 1]) * RS, Math.max(0.6, r), 0, 6.283); V.fill();
      }
      const terr = tile.group?.getObjectByName('terrain');
      if (terr?.material.map) terr.material.map.needsUpdate = true;
    }
    // distant copies: a share of the plants, a little bigger (palms, and one blob mesh for everything else)
    const g = new THREE.Group(); g.name = 'klTreesFar';
    const loFrac = 0.1 + 0.18 * Math.min(1, D), loScale = 1 / Math.sqrt(loFrac) * 0.6;
    const counts = [0, 0];
    // (bushes and banana plants are too small to matter at a distance)
    const far = (i) => { const k = P[i * 7 + 3]; return P[i * 7 + 6] < loFrac && k !== KIND.banana && k !== KIND.bush && k !== KIND.grass; };
    const lo = (k) => (k === KIND.palm || k === KIND.areca ? 0 : 1);
    for (let i = 0; i < N; i++) if (far(i)) counts[lo(P[i * 7 + 3])]++;
    const meshes = counts.map((c, j) => {
      if (!c) return null;
      const m = new THREE.InstancedMesh(this.loGeo[j], this.loMat, c);
      m.name = j ? 'treesFar' : 'palmsFar'; m.receiveShadow = false; m.castShadow = false;
      g.add(m); return m;
    });
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), at = [0, 0];
    for (let i = 0; i < N; i++) {
      if (!far(i)) continue;
      const kind = P[i * 7 + 3], j = lo(kind);
      this._matrix(m4, P, i, -P[i * 7], P[i * 7 + 1], kind === KIND.areca ? 1 : kind === KIND.rubber ? 0.55 * Math.max(1, loScale) : kind === KIND.bamboo ? 0.6 * Math.max(1, loScale) : kind === KIND.palm ? 1 : Math.max(1, loScale));
      meshes[j].setMatrixAt(at[j], m4);
      meshes[j].setColorAt(at[j]++, this._tint(col, kind, (P[i * 7 + 6] * 7.31) % 1));
    }
    for (const m of meshes) if (m) m.computeBoundingSphere();
    return { group: g, data };
  }

  _matrix(m4, P, i, x, z, extra = 1) {
    const kind = P[i * 7 + 3], sc = P[i * 7 + 4] * extra, rot = P[i * 7 + 5];
    const q = this._q || (this._q = new THREE.Quaternion()), e = this._e || (this._e = new THREE.Euler());
    // palms lean; broadleaf crowns spread wider than tall when big
    if (kind === KIND.palm) e.set(Math.sin(rot * 3.1) * 0.12, rot, Math.cos(rot * 2.3) * 0.12); else if (kind === KIND.areca) e.set(Math.sin(rot * 3.1) * 0.03, rot, Math.cos(rot * 2.3) * 0.03); else e.set(0, rot, 0);
    q.setFromEuler(e);
    const v = this._v || (this._v = new THREE.Vector3()), s = this._s || (this._s = new THREE.Vector3());
    v.set(x, P[i * 7 + 2] - 0.15, z);
    s.set(sc, kind === KIND.broad ? sc * (0.85 + (P[i * 7 + 6] - 0.5) * 0.4) : sc, sc);
    return m4.compose(v, q, s);
  }

  _tint(col, kind, t) {
    // a little variety: yellower, bluer, darker
    const k = 0.82 + t * 0.32;
    if (kind === KIND.palm) return col.setRGB(k * (0.95 + t * 0.1), k, k * 0.92);
    if (kind === KIND.broad) return col.setRGB(k * (0.85 + (t > 0.8 ? 0.35 : 0)), k, k * (0.9 + (t < 0.2 ? 0.2 : 0)));
    if (kind === KIND.rubber) return col.setRGB(k * 0.8, k * 0.92, k * 0.78);
    if (kind === KIND.bamboo) return col.setRGB(k * 1.02, k, k * 0.82);
    if (kind === KIND.grass) return col.setRGB(k * (0.9 + t * 0.25), k * 0.95, k * 0.7);
    return col.setRGB(k, k, k);
  }

  // refill the detailed plants from the tiles around the camera when it has moved
  update(camera, tiles) {
    const p = camera.position;
    this.U.uCam.value.copy(p);
    const vis = this.U.uFar.value + 1000;
    for (const t of tiles.values()) if (t.trees) t.trees.group.visible = Math.hypot(-(t.E0 + TILE / 2) - p.x, t.N0 + TILE / 2 - p.z) < vis;
    const ver = tiles.size + [...tiles.values()].filter((t) => t.trees).length * 1000;
    if (this._at && Math.hypot(p.x - this._at.x, p.z - this._at.z) < 45 && this._ver === ver) return;
    this._at = { x: p.x, z: p.z }; this._ver = ver;
    const R = this.U.uR.value + 70, m4 = new THREE.Matrix4(), col = new THREE.Color(), n = new Array(KINDS).fill(0);
    for (const t of tiles.values()) {
      const d = t.trees?.data;
      if (!d) continue;
      // tile-local cell range of the circle
      const e = -p.x - d.e0, nn = p.z - d.n0;
      const c0 = Math.max(0, Math.floor((e - R) / 100)), c1 = Math.min(19, Math.floor((e + R) / 100));
      const r0 = Math.max(0, Math.floor((nn - R) / 100)), r1 = Math.min(19, Math.floor((nn + R) / 100));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        for (const i of d.cells.get(c + r * 64) || []) {
          const x = -(d.e0 + d.P[i * 7]), z = d.n0 + d.P[i * 7 + 1];
          if ((x - p.x) ** 2 + (z - p.z) ** 2 > R * R) continue;
          const k = d.P[i * 7 + 3], mesh = this.hi[k];
          if (n[k] >= mesh.instanceMatrix.count) continue;
          mesh.setMatrixAt(n[k], this._matrix(m4, d.P, i, x, z));
          mesh.setColorAt(n[k]++, this._tint(col, k, d.P[i * 7 + 6]));
        }
      }
    }
    this.hi.forEach((m, k) => { m.count = n[k]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
  }
}
