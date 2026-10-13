// Geometries merged into one, as three's mergeGeometries does, for the plain case (the same plain attributes on
// all, all indexed or none): the arrays copied end to end and the indices offset in a typed array. three pushes
// every index through a JS array and builds the typed one after: most of a tile's merge time, and a tile merges
// a few hundred thousand vertices of walls, roofs and kerbs. Anything else (interleaved, morphs, groups) goes to
// three's own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mergeFast(geos, useGroups = false) {
  if (!geos?.length) return null;
  const g0 = geos[0], names = Object.keys(g0.attributes), indexed = g0.index !== null;
  if (useGroups || !g0.attributes.position) return mergeGeometries(geos, useGroups);
  for (const g of geos) {
    if ((g.index !== null) !== indexed || Object.keys(g.morphAttributes).length || Object.keys(g.attributes).length !== names.length) return mergeGeometries(geos);
    for (const n of names) {
      const a = g.attributes[n], b = g0.attributes[n];
      if (!a || a.isInterleavedBufferAttribute || a.itemSize !== b.itemSize || a.normalized !== b.normalized || a.array.constructor !== b.array.constructor) return mergeGeometries(geos);
    }
  }
  const out = new THREE.BufferGeometry();
  let nv = 0;
  for (const g of geos) nv += g.attributes.position.count;
  for (const n of names) {
    const a0 = g0.attributes[n], sz = a0.itemSize, A = new a0.array.constructor(nv * sz);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[n], len = a.count * sz;
      A.set(a.array.length === len ? a.array : a.array.subarray(0, len), o);
      o += len;
    }
    out.setAttribute(n, new THREE.BufferAttribute(A, sz, a0.normalized));
  }
  if (indexed) {
    let ni = 0;
    for (const g of geos) ni += g.index.count;
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let o = 0, base = 0;
    for (const g of geos) {
      const src = g.index.array, c = g.index.count;
      for (let j = 0; j < c; j++) I[o + j] = src[j] + base;
      o += c; base += g.attributes.position.count;
    }
    out.setIndex(new THREE.BufferAttribute(I, 1));
  }
  return out;
}
