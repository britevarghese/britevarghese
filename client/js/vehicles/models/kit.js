// Shared kit for the procedural vehicle models: team paint (canvas camouflage), common materials, geometry helpers
// and the weathering pass every model gets (finishVehicle). Local frame of every vehicle: nose toward -Z, +Y up,
// origin on the ground under the hull / fuselage centre, metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const cache = {};

function camoTexture(team) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const pal = team === 1 ? ['#4b5234', '#3a3f28', '#5c5a3c', '#26281d'] : ['#a8956b', '#8f7a52', '#b9a67c', '#6f5e40'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
  // disruptive blotches (wrapping so the texture tiles)
  for (let i = 0; i < 46; i++) {
    g.fillStyle = pal[1 + (i % 3)];
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 55;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath();
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rr = r * (0.55 + Math.random() * 0.6); g.lineTo(x + ox + Math.cos(a) * rr * 1.5, y + oy + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
  }
  // dust / grime + panel lines + scratches
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,28,20' : '190,180,150'},${Math.random() * 0.08})`; g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 6, 2 + Math.random() * 6); }
  g.strokeStyle = 'rgba(15,15,10,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const y = (i + 0.5) * (S / 6); g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  for (let i = 0; i < 5; i++) { const x = (i + 0.3) * (S / 5); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function trackTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2a27'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#4a4740'; g.fillRect(i * 16, 0, 9, 64); g.fillStyle = '#171614'; g.fillRect(i * 16 + 10, 0, 2, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blurTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(30,30,30,0.0)'); gr.addColorStop(0.1, 'rgba(30,30,30,0.28)'); gr.addColorStop(0.85, 'rgba(30,30,30,0.2)'); gr.addColorStop(0.97, 'rgba(60,60,60,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function materials(team) {
  const key = `m${team}`;
  if (cache[key]) return cache[key];
  const camo = camoTexture(team);
  const paint = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.82, metalness: 0.25 });
  // extruded geometry has UVs in metres: one camo tile every 3.5 m
  const paintX = paint.clone(); paintX.map = camo.clone(); paintX.map.repeat.set(1 / 3.5, 1 / 3.5); paintX.map.needsUpdate = true;
  const m = cache[key] = {
    paint, paintX,
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2b27, roughness: 0.75, metalness: 0.45 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.5, metalness: 0.75 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1b19, roughness: 0.95, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.9, metalness: 0.3 }),
    burnt: new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 1, metalness: 0.1 }),
    lightRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    lightGreen: new THREE.MeshBasicMaterial({ color: 0x2aff4a }),
  };
  const tt = trackTexture(); tt.repeat.set(3, 1);
  m.track = new THREE.MeshStandardMaterial({ map: tt, roughness: 0.9, metalness: 0.5 });
  return m;
}

export const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = null) => {
  const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
};

// side profile [z, y] (z forward = negative) extruded across the width, centred on x = 0
export function sideExtrude(pts, width, bevel = 0.04) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// top outline [x, z] extruded upwards by h
export function topExtrude(pts, h, bevel = 0.05) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

export function stadium(path, z0, z1, y0, y1) {
  const r = (y1 - y0) / 2, cy = y0 + r;
  path.moveTo(-(z0 + r), y0);
  path.lineTo(-(z1 - r), y0);
  path.absarc(-(z1 - r), cy, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(-(z0 + r), y1);
  path.absarc(-(z0 + r), cy, r, Math.PI / 2, Math.PI * 1.5, false);
  return path;
}

// tube between two points (frames, struts, pipes)
export function tube(parent, a, b, r, mat, seg = 8) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), L = va.distanceTo(vb);
  const m = mesh(new THREE.CylinderGeometry(r, r, L, seg), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, parent);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
  return m;
}

// Weathering baked into vertex colours (vehicle frame): mud / road dust toward the ground (strongest on the
// running gear and lower hull, fading out by ~1.3 m), underside shading on faces that point down, and a little
// per-part variation so flat panels don't all read the same. Every mesh gets its own geometry copy (shared
// geometries sit at different heights). Materials switch on vertexColors (shared: done once).
const MUD = new THREE.Color(0x5a4a36), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
export function finishVehicle(root, { mudTop = 1.3 } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noWeather) return;
    const mats = [o.material].flat();
    if (mats.some((m) => m.transparent || m.isMeshBasicMaterial || m.userData.noWeather)) return;
    o.geometry = o.geometry.clone();
    const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal;
    const toRoot = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    _m3.getNormalMatrix(toRoot);
    const col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const tint = 0.94 + ((o.id * 2654435761) % 1000) / 1000 * 0.1; // per-part shade variation (deterministic)
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
      const ny = nor ? _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize().y : 0;
      const mud = Math.max(0, Math.min(1, 1 - _p.y / mudTop)) ** 1.6 * 0.75;
      const under = ny < -0.3 ? 0.72 : ny < 0.2 ? 0.92 : 1;
      c.setRGB(1, 1, 1).lerp(MUD, mud).multiplyScalar(under * tint);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const m of mats) if (!m.vertexColors) { m.vertexColors = true; m.needsUpdate = true; }
  });
  mergeStatic(root);
  return root;
}

// Fewer draw calls: inside every group, the plain meshes that don't move on their own are merged per material
// (a mesh stays separate when it has a name, children, is referenced from root.userData, or sets userData.keep).
// Animated parts are groups (turret, gun, wheels, rotor...) and keep moving as one.
export function mergeStatic(root) {
  const keep = new Set();
  const note = (v) => { if (v?.isObject3D) keep.add(v); else if (Array.isArray(v)) v.forEach(note); };
  for (const v of Object.values(root.userData || {})) note(v);
  const groups = [];
  root.traverse((o) => { if (!o.isMesh) groups.push(o); });
  for (const parent of groups) {
    const byMat = new Map();
    for (const o of [...parent.children]) {
      if (!o.isMesh || o.name || o.children.length || keep.has(o) || o.userData.keep || Array.isArray(o.material)) continue;
      if (!o.geometry.attributes.color || !o.material.vertexColors) continue; // (not weathered: transparent / glow)
      o.updateMatrix();
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrix);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups();
      const k = o.material.uuid;
      if (!byMat.has(k)) byMat.set(k, { mat: o.material, list: [], shadow: o.castShadow });
      byMat.get(k).list.push(g);
      parent.remove(o);
    }
    for (const { mat, list, shadow } of byMat.values()) {
      const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
      m.castShadow = shadow; m.receiveShadow = true;
      parent.add(m);
    }
  }
}

// destroyed: charred hull (the materials are swapped back when the vehicle respawns)
export function setWrecked(root, wrecked) {
  const burnt = cache.m1?.burnt || cache.m2?.burnt;
  const u = root.userData;
  root.traverse((o) => {
    if (!o.isMesh || o === u.disc) return;
    // glass (transparent) is blown out of a burnt-out wreck, and back when the vehicle respawns
    if ([o.material].flat().some((m) => m.transparent)) {
      if (wrecked) { if (o.userData.vis === undefined) o.userData.vis = o.visible; o.visible = false; }
      else if (o.userData.vis !== undefined) { o.visible = o.userData.vis; delete o.userData.vis; }
      return;
    }
    if (wrecked) { if (!o.userData.mat) o.userData.mat = o.material; o.material = burnt; }
    else if (o.userData.mat) o.material = o.userData.mat;
  });
  if (u.disc) u.disc.visible = false;
}

// ---------------------------------------------------------------- detail helpers (tank / helicopter detail pass)
// Tileable fractal value noise sampled on an n x n grid (~0..1, wraps at the edges): base = cells across the tile.
export function noiseField(n, base, octaves = 4, seed = 1) {
  const out = new Float32Array(n * n);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const p = base << o;
    const hash = (x, y) => {
      x = ((x % p) + p) % p; y = ((y % p) + p) % p;
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed * 31 + p, 2246822519);
      h = Math.imul(h ^ (h >>> 13), 3266489917);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const fx = (i / n) * p, fy = (j / n) * p, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
      out[j * n + i] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// bilinear sample of a noise field (u, v in 0..1, wrapping)
export function sampleField(f, n, u, v) {
  const x = (((u * n) % n) + n) % n, y = (((v * n) % n) + n) % n, x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
  const a = f[y0 * n + x0], b = f[y0 * n + x1], c = f[y1 * n + x0], d = f[y1 * n + x1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// Box-projected UVs in the vehicle frame (metres / tile) for every mesh using one of `mats`: a paint texture then
// keeps one scale on every part and flows across neighbouring parts (axis per triangle = dominant normal axis).
export function projectUV(root, mats, tile) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4();
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !mats.has(o.material)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    M.multiplyMatrices(inv, o.matrixWorld);
    const p = g.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i + 2 < p.count; i += 3) {
      for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, i + k).applyMatrix4(M);
      e1.subVectors(v[1], v[0]); e2.subVectors(v[2], v[0]); e1.cross(e2);
      const ax = Math.abs(e1.x), ay = Math.abs(e1.y), az = Math.abs(e1.z);
      for (let k = 0; k < 3; k++) {
        const q = v[k], [a, b] = ax >= ay && ax >= az ? [q.z, q.y] : ay >= az ? [q.x, q.z] : [q.x, q.y];
        uv[(i + k) * 2] = a / tile; uv[(i + k) * 2 + 1] = b / tile;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.geometry = g;
  });
}

// Flat-shaded solid lofted through polygon rings (arrays of [x, y, z], same count, ring order around the
// section); caps close the first / last ring. Faces are oriented away from the solid's centroid.
export function facetLoft(rings, { caps = true } = {}) {
  const P = [], n = rings[0].length, cen = new THREE.Vector3();
  let cnt = 0;
  for (const r of rings) for (const p of r) { cen.x += p[0]; cen.y += p[1]; cen.z += p[2]; cnt++; }
  cen.divideScalar(cnt);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), m = new THREE.Vector3();
  const tri = (p, q, r) => {
    a.set(...p); b.set(...q); c.set(...r);
    nn.subVectors(b, a).cross(m.subVectors(c, a));
    if (nn.lengthSq() < 1e-12) return;
    m.copy(a).add(b).add(c).divideScalar(3).sub(cen);
    if (nn.dot(m) < 0) P.push(...p, ...r, ...q); else P.push(...p, ...q, ...r);
  };
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < n; i++) {
    const A = rings[j][i], B = rings[j][(i + 1) % n], C = rings[j + 1][i], D = rings[j + 1][(i + 1) % n];
    tri(A, B, D); tri(A, D, C);
  }
  if (caps) for (const r of [rings[0], rings[rings.length - 1]]) {
    const o = [0, 1, 2].map((k) => r.reduce((t, p) => t + p[k], 0) / n);
    for (let i = 0; i < n; i++) tri(o, r[i], r[(i + 1) % n]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((P.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

// many small geometries -> one (position / normal / uv kept): repeated detail (bolts, links, slats) in one mesh
export function merged(list) {
  const out = list.map((g) => {
    const h = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    if (!h.attributes.normal) h.computeVertexNormals();
    h.clearGroups();
    return h;
  });
  return mergeGeometries(out);
}
