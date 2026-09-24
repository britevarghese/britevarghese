// Geometry helpers for the car importer (glTF-Transform primitives, world space after flattening).
import { Primitive } from '@gltf-transform/core';

export function triIndices(prim) {
  const idx = prim.getIndices();
  if (idx) return Uint32Array.from(idx.getArray());
  const n = prim.getAttribute('POSITION').getCount();
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  return out;
}

export function positions(prim) { return prim.getAttribute('POSITION').getArray(); }

export function triCount(prim) {
  if (prim.getMode() !== Primitive.Mode.TRIANGLES) return 0;
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
}

// bounds of a set of triangles: {min, max, c, size, area}
export function triSetBounds(pos, tris, idx) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let area = 0;
  for (const t of tris) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) { const x = pos[v * 3 + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x; }
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { min, max, c: min.map((v, k) => (v + max[k]) / 2), size: min.map((v, k) => max[k] - v), area };
}

// Connected components of a primitive's triangles. Vertices are joined by (quantized) position so
// UV/normal seams don't split one physical part into many.
export function components(prim, eps = 1e-4) {
  const pos = positions(prim), idx = triIndices(prim);
  const nv = pos.length / 3, nt = idx.length / 3;
  const key = new Map(), rep = new Int32Array(nv);
  const q = 1 / eps;
  for (let v = 0; v < nv; v++) {
    const k = `${Math.round(pos[v * 3] * q)},${Math.round(pos[v * 3 + 1] * q)},${Math.round(pos[v * 3 + 2] * q)}`;
    let r = key.get(k);
    if (r === undefined) { r = v; key.set(k, v); }
    rep[v] = r;
  }
  const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < nt; t++) { const a = rep[idx[t * 3]], b = rep[idx[t * 3 + 1]], c = rep[idx[t * 3 + 2]]; unite(a, b); unite(b, c); }
  const groups = new Map();
  for (let t = 0; t < nt; t++) {
    const r = find(rep[idx[t * 3]]);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(t);
  }
  return [...groups.values()].map((tris) => ({ tris, ...triSetBounds(pos, tris, idx) }));
}

// New primitive holding only the given triangles (all vertex attributes compacted, same material).
export function subsetPrimitive(doc, prim, tris) {
  const idx = triIndices(prim);
  const remap = new Map();
  const order = [];
  const newIdx = new Uint32Array(tris.length * 3);
  let n = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k];
    let r = remap.get(v);
    if (r === undefined) { r = order.length; remap.set(v, r); order.push(v); }
    newIdx[n++] = r;
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const out = doc.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setMaterial(prim.getMaterial());
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem);
    const size = acc.getElementSize();
    const src = acc.getArray();
    const Ctor = src.constructor;
    const dst = new Ctor(order.length * size);
    for (let i = 0; i < order.length; i++) for (let k = 0; k < size; k++) dst[i * size + k] = src[order[i] * size + k];
    out.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(buffer));
  }
  const IdxCtor = order.length > 65535 ? Uint32Array : Uint16Array;
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(IdxCtor.from(newIdx)).setBuffer(buffer));
  return out;
}

export const vlen = (v) => Math.hypot(v[0], v[1], v[2]);
