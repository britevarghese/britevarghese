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

// Cut a primitive along planes: `regions` are convex volumes, each a list of planes [a, b, c, d]
// (inside where a*x + b*y + c*z + d <= 0); `use(t, n)` says which regions triangle t (face normal n)
// may join. Triangles crossing a boundary are clipped exactly, with every vertex attribute
// interpolated, so the two halves meet seamlessly. Returns { inside, outside } (null when empty).
export function splitPrimitive(doc, prim, regions, use = () => regions.map(() => true)) {
  const idx = triIndices(prim), nt = idx.length / 3;
  const sems = prim.listSemantics();
  const attrs = sems.map((sem) => { const acc = prim.getAttribute(sem); return { sem, acc, size: acc.getElementSize(), src: acc.getArray(), extra: [] }; });
  const P = attrs[sems.indexOf('POSITION')];
  const nv0 = P.src.length / 3;
  const pos = (v) => (v < nv0 ? [P.src[v * 3], P.src[v * 3 + 1], P.src[v * 3 + 2]] : P.extra.slice((v - nv0) * 3, (v - nv0) * 3 + 3));
  const get = (A, v) => (v < nv0 ? Array.from(A.src.subarray(v * A.size, v * A.size + A.size)) : A.extra.slice((v - nv0) * A.size, (v - nv0) * A.size + A.size));
  let nv = nv0;
  const cache = new Map();
  const lerpV = (a, b, t) => {
    const key = a < b ? `${a}|${b}|${t.toFixed(6)}` : `${b}|${a}|${(1 - t).toFixed(6)}`;
    const hit = cache.get(key); if (hit !== undefined) return hit;
    for (const A of attrs) { const va = get(A, a), vb = get(A, b); for (let k = 0; k < A.size; k++) A.extra.push(va[k] + (vb[k] - va[k]) * t); }
    cache.set(key, nv); return nv++;
  };
  const f = (pl, v) => { const p = pos(v); return pl[0] * p[0] + pl[1] * p[1] + pl[2] * p[2] + pl[3]; };
  // split a convex polygon (vertex ids) by a plane into [inside, outside]
  const split = (poly, pl) => {
    const d = poly.map((v) => f(pl, v)), inn = [], out = [];
    for (let i = 0; i < poly.length; i++) {
      const j = (i + 1) % poly.length, a = poly[i], b = poly[j], da = d[i], db = d[j];
      if (da <= 0) inn.push(a); if (da >= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const m = lerpV(a, b, da / (da - db)); inn.push(m); out.push(m); }
    }
    return [inn.length >= 3 ? inn : null, out.length >= 3 ? out : null];
  };
  const tin = [], tout = [];
  const emit = (list, poly) => { for (let i = 1; i < poly.length - 1; i++) list.push(poly[0], poly[i], poly[i + 1]); };
  for (let t = 0; t < nt; t++) {
    const tri = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const [p0, p1, p2] = tri.map(pos);
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], w = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const ok = use(t, n);
    let rest = [tri];
    for (let r = 0; r < regions.length; r++) {
      if (!ok[r]) continue;
      const next = [];
      for (const poly of rest) {
        let cur = poly;
        for (const pl of regions[r]) {
          const [a, b] = split(cur, pl);
          if (b) next.push(b);
          cur = a; if (!cur) break;
        }
        if (cur) emit(tin, cur);
      }
      rest = next;
    }
    for (const poly of rest) emit(tout, poly);
  }
  if (!tin.length) return { inside: null, outside: prim };
  // one primitive holding the original + new vertices, then compact each half out of it
  const buffer = doc.getRoot().listBuffers()[0];
  const all = doc.createPrimitive().setMode(Primitive.Mode.TRIANGLES).setMaterial(prim.getMaterial());
  for (const A of attrs) {
    const Ctor = A.src.constructor, isInt = !(A.src instanceof Float32Array);
    const dst = new Ctor(nv * A.size); dst.set(A.src);
    for (let i = 0; i < A.extra.length; i++) dst[A.src.length + i] = isInt ? Math.round(A.extra[i]) : A.extra[i];
    all.setAttribute(A.sem, doc.createAccessor().setType(A.acc.getType()).setArray(dst).setNormalized(A.acc.getNormalized()).setBuffer(buffer));
  }
  all.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from([...tin, ...tout])).setBuffer(buffer));
  const ni = tin.length / 3, no = tout.length / 3;
  const inside = subsetPrimitive(doc, all, [...Array(ni).keys()]);
  const outside = no ? subsetPrimitive(doc, all, [...Array(no).keys()].map((k) => k + ni)) : null;
  all.dispose();
  return { inside, outside };
}
