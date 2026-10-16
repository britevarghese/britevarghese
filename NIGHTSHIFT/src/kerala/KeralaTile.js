// One 2 km tile of Kerala (tools/kerala/build_tiles.py): decoded data, the ground under it, and the meshes
// built from it — terrain coloured by land use, roads draped on the ground with markings, buildings with
// Kerala roofs, water, coconut palms — plus the building colliders.
//
// Frames: tile data is in metres east (e) / north (n) of the tile's south-west corner. The game's +X is west,
// so a tile's group sits at (x = -E0, z = N0) and its local vertices are (x = -e, z = n). Every mesh stays in
// local coordinates (small floats) wherever the tile is in the state.
import * as THREE from 'three';
import { mergeFast as mergeGeometries } from '../core/MergeFast.js';   // (three's, with a fast path: see there)

export const TILE = 2000;
export const GRID = 33;
const STEP = TILE / (GRID - 1);
const TEA_MIN = 900;                       // ground (m) above which open land is a tea estate
const INLAND = 4;                         // ground (m) above which water is a hill river or pond, not sea level
const NO_CANAL = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat); NO_CANAL.needsUpdate = true;
const RASTER = 256;                       // land-use raster per tile (7.8 m per pixel)
const PX = RASTER / TILE;

// road classes (build_tiles.py ROAD_CLS): half widths (m) and draw order
export const ROAD_HALF = [7, 6, 4.6, 4, 3.5, 2.8, 2.6, 2.2, 1.9, 1.6, 2];
// land-use / class raster codes (R channel of the class canvas)
const VALID = new Uint8Array(256);
export const C = { land: 0, paddy: 1, grove: 2, forest: 3, town: 4, commercial: 5, industrial: 6, grass: 7, sand: 8, rock: 9, religious: 10, scrub: 11, wetland: 12, water: 20, sea: 21, road: 30, building: 31 };
for (const v of Object.values(C)) VALID[v] = 1;
const LU_COLOR = {
  0: '#55703a', 1: '#7da23c', 2: '#3f5f2a', 3: '#2c4522', 4: '#66694a', 5: '#7a7466', 6: '#77746a', 7: '#5c8238',
  8: '#d2bf8e', 9: '#7d7264', 10: '#686c44', 11: '#6a7040', 12: '#4a6644',
};

// ------------------------------------------------------------------------------------------- decoding
function decodeLine(a, from, out = []) {
  let x = 0, z = 0;
  for (let i = from; i + 1 < a.length; i += 2) {
    if (i === from) { x = a[i]; z = a[i + 1]; } else { x += a[i]; z += a[i + 1]; }
    out.push([x / 10, z / 10]);
  }
  return out;
}
// vertex colours as bytes (a quarter of the memory of floats: kerbs, walls and shading run to millions of vertices)
function byteColors(c, n) {
  const a = new Uint8Array(c.length);
  for (let i = 0; i < c.length; i++) a[i] = Math.max(0, Math.min(255, Math.round(c[i] * 255)));
  return new THREE.BufferAttribute(a, n, true);
}
// make every triangle of a (mostly horizontal) surface face up: the mirrored x axis makes winding easy to get wrong
export function faceUp(g) {
  const P = g.attributes.position.array, I = g.index.array;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vz = P[c + 2] - P[a + 2];
    if (uz * vx - ux * vz < 0) { const k = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = k; }
  }
  g.index.needsUpdate = true;
  return g;
}
// vertex normals as three's computeVertexNormals makes them (each face's (C - B) x (A - B) added to its corners, then
// normalised), in typed arrays: three's goes through accessor calls per corner, a tile's slowest part of a few steps
// mergeGeometries in steps: the parts copied into the merged arrays a few at a time, a pause between when the build's
// slice of the frame is up (`due`). One merge of ~40k vertices of a tile's walls took up to an eighth of a second.
// Interleaved or mixed parts: the library's own merge, at once
export function* mergeSteps(geos, due) {
  if (!geos.length) return null;
  const names = Object.keys(geos[0].attributes), indexed = !!geos[0].index;
  for (const g of geos) {
    if (!!g.index !== indexed || Object.keys(g.attributes).length !== names.length) return mergeGeometries(geos);
    for (const n of names) { const a = g.attributes[n], a0 = geos[0].attributes[n]; if (!a || a.isInterleavedBufferAttribute || a.itemSize !== a0.itemSize || a.array.constructor !== a0.array.constructor || a.normalized !== a0.normalized) return mergeGeometries(geos); }
  }
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; if (indexed) ni += g.index.count; }
  const arrs = {};
  for (const n of names) { const a = geos[0].attributes[n]; arrs[n] = new a.array.constructor(nv * a.itemSize); }
  const idx = indexed ? (nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)) : null;
  let vo = 0, io = 0;
  for (let k = 0; k < geos.length; k++) {
    const g = geos[k], c = g.attributes.position.count;
    for (const n of names) { const a = g.attributes[n]; arrs[n].set(a.array.length === c * a.itemSize ? a.array : a.array.subarray(0, c * a.itemSize), vo * a.itemSize); }
    if (indexed) { const I = g.index.array, m = g.index.count; for (let i = 0; i < m; i++) idx[io + i] = I[i] + vo; io += m; }
    vo += c;
    if ((k & 7) === 7 && due()) yield 'merge+';
  }
  const out = new THREE.BufferGeometry();
  for (const n of names) { const a = geos[0].attributes[n]; out.setAttribute(n, new THREE.BufferAttribute(arrs[n], a.itemSize, a.normalized)); }
  if (idx) out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export function fastNormals(g) {
  const P = g.attributes.position.array, I = g.index ? g.index.array : null, n = I ? I.length : P.length / 3, N = new Float32Array(P.length);
  for (let t = 0; t + 2 < n; t += 3) {
    const a = (I ? I[t] : t) * 3, b = (I ? I[t + 1] : t + 1) * 3, c = (I ? I[t + 2] : t + 2) * 3;
    const cx = P[c] - P[b], cy = P[c + 1] - P[b + 1], cz = P[c + 2] - P[b + 2], ax = P[a] - P[b], ay = P[a + 1] - P[b + 1], az = P[a + 2] - P[b + 2];
    const nx = cy * az - cz * ay, ny = cz * ax - cx * az, nz = cx * ay - cy * ax;
    if (I) { N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz; }
    else { N[a] = N[b] = N[c] = nx; N[a + 1] = N[b + 1] = N[c + 1] = ny; N[a + 2] = N[b + 2] = N[c + 2] = nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  return g;
}
// KLT1 binary tile (tools/kerala/build_tiles.py encode_tile) -> the same arrays as the JSON form (decimetres)
export function decodeBinary(buf) {
  const u8 = new Uint8Array(buf);
  let o = 0;
  const uv = () => { let v = 0, sh = 0, b; do { b = u8[o++]; v += (b & 0x7f) * 2 ** sh; sh += 7; } while (b & 0x80); return v; };
  const sv = () => { const v = uv(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== 'KLT1') throw new Error('not a KLT1 tile');
  o = 4;
  const tx = sv(), tz = sv(), d = sv();
  const h = new Int16Array(GRID * GRID);
  const dv = new DataView(buf, o, GRID * GRID * 2);
  for (let i = 0; i < h.length; i++) h[i] = dv.getInt16(i * 2, true);
  o += GRID * GRID * 2;
  const td = new TextDecoder();
  const n = []; for (let i = uv(); i > 0; i--) { const L = uv(); n.push(td.decode(u8.subarray(o, o + L))); o += L; }
  const line = (out) => { const c = uv(); for (let i = 0; i < c; i++) { out.push(sv() * 2, sv() * 2); } return out; };
  const r = []; for (let i = uv(); i > 0; i--) { const a = [sv(), sv(), sv(), sv(), sv(), sv(), sv()]; r.push(line(a)); }
  const b = []; for (let i = uv(); i > 0; i--) { const a = [uv(), uv()]; b.push(line(a)); }
  const polys = () => { const out = []; for (let i = uv(); i > 0; i--) { const k = uv(), rings = []; for (let j = uv(); j > 0; j--) rings.push(line([])); out.push([k, rings]); } return out; };
  const w = polys(), lu = polys();
  const wl = []; for (let i = uv(); i > 0; i--) { const a = [uv(), uv()]; wl.push(line(a)); }
  const rl = []; for (let i = uv(); i > 0; i--) { const a = [uv()]; rl.push(line(a)); }
  const p = []; for (let i = uv(); i > 0; i--) p.push([uv(), sv() * 2, sv() * 2, sv()]);
  return { k: [tx, tz], d, h, n, r, b, w, wl, lu, rl, p };
}
function b64ToInt16(s) {
  const bin = atob(s), n = bin.length >> 1, out = new Int16Array(n);
  for (let i = 0; i < n; i++) { const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1); out[i] = (hi << 8 | lo) << 16 >> 16; }
  return out;
}

// height on a square grid of N x N vertices S apart, split into triangles a-c-b / b-c-d (as the terrain is indexed)
function gridAt(H, N, S, e, n) {
  const gx = Math.min(N - 1.0001, Math.max(0, e / S)), gz = Math.min(N - 1.0001, Math.max(0, n / S));
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

const _cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
const _smooth = (x) => x * x * (3 - 2 * x);

// the 62.5 m survey grid, resampled smoothly (Catmull-Rom) to N x N
function _resample(H, N) {
  const S = TILE / (N - 1), F = new Float32Array(N * N), r = [0, 0, 0, 0];
  const at = (i, j) => H[Math.min(GRID - 1, Math.max(0, j)) * GRID + Math.min(GRID - 1, Math.max(0, i))];
  for (let j = 0; j < N; j++) {
    const gz = j * S / STEP, j0 = Math.min(GRID - 2, Math.floor(gz)), fz = gz - j0;
    for (let i = 0; i < N; i++) {
      const gx = i * S / STEP, i0 = Math.min(GRID - 2, Math.floor(gx)), fx = gx - i0;
      for (let b = -1; b <= 2; b++) r[b + 1] = _cr(at(i0 - 1, j0 + b), at(i0, j0 + b), at(i0 + 1, j0 + b), at(i0 + 2, j0 + b), fx);
      F[j * N + i] = _cr(r[0], r[1], r[2], r[3], fz);
    }
  }
  return F;
}

export class KeralaTile {
  constructor(tx, tz, data) {
    this.tx = tx; this.tz = tz;
    this.E0 = tx * TILE; this.N0 = tz * TILE;
    this.data = data;
    this.district = data.d;
    this.names = data.n || [];
    const hq = typeof data.h === 'string' ? b64ToInt16(data.h) : data.h;
    this.h = new Float32Array(GRID * GRID);
    for (let i = 0; i < hq.length; i++) this.h[i] = hq[i] / 4;
    this.roads = (data.r || []).map((r) => ({ cls: r[0], lanes: r[1], flags: r[2], layer: r[3], name: this.names[r[4]] || '', ref: this.names[r[5]] || '', dirt: r[6] === 1, pts: decodeLine(r, 7) }));
    this._roundCorners();
    this.colliders = [];
    this.ready = false;
  }

  // ground height (game y) at tile-local (e, n): the triangles exactly as drawn (the fine, graded grid once built)
  heightAt(e, n) { return gridAt(this.h, this.gn || GRID, this.gs || STEP, e, n); }

  classAt(e, n) {
    if (!this.cls) return 0;
    const px = Math.min(RASTER - 1, Math.max(0, Math.floor(e * PX))), py = Math.min(RASTER - 1, Math.max(0, Math.floor((TILE - n) * PX)));
    const c = this.cls[(py * RASTER + px) * 4];
    return VALID[c] ? c : c < 15 ? C.land : C.road;  // anti-aliased edges blend codes: mostly-land or mostly-road
  }

  // ------------------------------------------------------------------------------------------ build
  build(M, opts) {
    const it = this.buildSteps(M, opts);
    let r;
    while (!(r = it.next()).done);
    return r.value;
  }

  // inside a build step: has ~3 ms of work gone by since the last pause? (resumed steps reset _ys)
  _due() { return performance.now() - (this._ys ?? (this._ys = performance.now())) > 3; }

  // the build in stages (a generator), so the world can spread a tile over several frames instead of stalling one
  *buildSteps(M, opts) {
    this._ys = performance.now();
    const d = this.data;
    const g = new THREE.Group();
    g.name = `kl_${this.tx}_${this.tz}`;
    g.position.set(-this.E0, 0, this.N0);
    this.group = g;
    yield* this._rasters(d, opts);
    this._smoothTowns();
    this._sinkWater();
    yield 'tile:rasters';
    this._refine(opts.terrainN || 129);
    yield* this._gradeRoads();
    this.h0r = null;
    yield 'tile:carve';
    yield* this._carveSteps();
    yield 'tile:grade';
    g.add(this._terrain(M));
    yield 'tile:water';
    const water = this._water(M, d);
    if (water) g.add(water);
    yield 'tile:terrain';
    for (const m of yield* this._roads(M)) g.add(m);
    yield 'tile:roads';
    for (const m of yield* this._street(M, opts)) g.add(m);
    yield 'tile:street';
    for (const m of yield* this._buildings(M, d, opts)) g.add(m);   // (walls, houses and poles keep off junction corners)
    yield 'tile:buildings';
    for (const m of this._poles(M, opts)) g.add(m);
    this._nearJunction = null;
    yield 'tile:poles';
    if (opts.trees) { this.trees = yield* opts.trees.plantSteps(this); g.add(this.trees.group); yield 'tile:trees'; }
    else { const palms = this._palms(opts); if (palms) g.add(palms); }
    yield* this._clearRoadsSteps(this.colliders);
    g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    g.updateMatrixWorld(true);
    this.ready = true;
    return g;
  }

  // class canvas (what is where: water / land use / roads / buildings) + the visible ground colours
  // (a generator: it pauses every few milliseconds, the world spreading it over frames)
  *_rasters(d, opts = {}) {
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = RASTER; return c; };
    const vis = mk(), cl = mk(), V = vis.getContext('2d'), K = cl.getContext('2d', { willReadFrequently: true }); // read back below: keep it on the CPU
    V.fillStyle = LU_COLOR[0]; V.fillRect(0, 0, RASTER, RASTER);
    K.fillStyle = 'rgb(0,0,0)'; K.fillRect(0, 0, RASTER, RASTER);
    const path = (ctx, rings) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath();
      }
    };
    const rings = (arr) => arr.map((r) => decodeLine(r, 0));
    for (const [k, rr] of d.lu || []) {
      if (this._due()) { yield 'raster:landuse+'; this._ys = performance.now(); }
      const R = rings(rr);
      path(V, R); V.fillStyle = LU_COLOR[k] || LU_COLOR[0]; V.fill('evenodd');
      path(K, R); K.fillStyle = `rgb(${k},0,0)`; K.fill('evenodd');
    }
    for (const [k, rr] of d.w || []) {
      const R = rings(rr), code = k === 9 ? C.sea : C.water;
      path(V, R); V.fillStyle = '#2a4e52'; V.fill('evenodd');
      path(K, R); K.fillStyle = `rgb(${code},0,0)`; K.fill('evenodd');
    }
    // rivers and canals drawn as lines
    for (const w of d.wl || []) {
      const pts = decodeLine(w, 2), wd = w[1] / 10;
      K.strokeStyle = `rgb(${C.water},0,0)`;   // (not painted on the ground: the channel is cut and drawn)
      for (const ctx of [K]) { ctx.lineWidth = Math.max(1, wd * PX); ctx.beginPath(); pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }
    }
    yield 'raster:mottle';
    // laterite earth under the trees, a little texture so nothing is a flat colour
    V.globalAlpha = 0.18;
    let s = (this.tx * 73856093 ^ this.tz * 19349663) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const MOTTLE = ['#2f4a20', '#3c5a26', '#6b5a3a', '#8a5a3c', '#7a7048'];
    for (let i = 0; i < 2600; i++) { V.fillStyle = MOTTLE[Math.floor(rnd() * MOTTLE.length)]; const r = 0.8 + rnd() * rnd() * 7; V.beginPath(); V.ellipse(rnd() * RASTER, rnd() * RASTER, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 6.283); V.fill(); }
    V.globalAlpha = 1;
    yield 'raster:infill';
    // the houses and shops the map hasn't got (see _infill), before anything is drawn from the building list
    if (!d._infill) { yield* this._infill(d, K.getImageData(0, 0, RASTER, RASTER).data, opts.maxBuildings ?? 6000); d._infill = true; }
    // swept earth yards round the houses (Kerala compounds), a little wider than the footprint
    V.fillStyle = 'rgba(132,96,66,0.55)'; V.strokeStyle = 'rgba(132,96,66,0.45)'; V.lineJoin = 'round';
    V.lineWidth = Math.max(1, 7 * PX);
    yield 'raster:yards';
    for (let i = 0; i < (d.b || []).length; i++) {
      if ((i & 63) === 63) if (this._due()) { yield 'raster:yards+'; this._ys = performance.now(); }
      path(V, [decodeLine(d.b[i], 2)]); V.fill(); V.stroke();
    }
    // red laterite earth along the road edges (Kerala's verges)
    V.lineCap = 'round'; V.lineJoin = 'round'; V.globalAlpha = 0.55; V.strokeStyle = '#8a563a';
    for (const r of this.roads) {
      if (r.cls > 7) continue;
      V.lineWidth = Math.max(1.5, (ROAD_HALF[r.cls] * 2 + 3.5) * PX);
      V.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) V.lineTo(x, y); else V.moveTo(x, y); }); V.stroke();
    }
    V.globalAlpha = 1;
    // roads and buildings into the class map (palms keep off them)
    yield 'raster:roads';
    K.lineCap = 'round';
    for (const r of this.roads) {
      if (this._due()) { yield 'raster:roads+'; this._ys = performance.now(); }
      K.strokeStyle = `rgb(${C.road},0,0)`; K.lineWidth = Math.max(0.9, (ROAD_HALF[r.cls] * 2 + 2) * PX);
      K.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) K.lineTo(x, y); else K.moveTo(x, y); }); K.stroke();
      if (r.dirt) { V.strokeStyle = '#8c5a3a'; V.lineWidth = Math.max(1, ROAD_HALF[r.cls] * 2 * PX); V.lineCap = 'round'; V.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) V.lineTo(x, y); else V.moveTo(x, y); }); V.stroke(); }
    }
    yield 'raster:buildings';
    K.fillStyle = `rgb(${C.building},0,0)`;
    for (let i = 0; i < (d.b || []).length; i++) {
      if ((i & 63) === 63) if (this._due()) { yield 'raster:buildings+'; this._ys = performance.now(); }
      path(K, [decodeLine(d.b[i], 2)]); K.fill();
    }
    yield 'raster:read';
    this.cls = K.getImageData(0, 0, RASTER, RASTER).data;
    // tea: the open slopes of the high ranges (Munnar, Vagamon, Peermade) are tea estates. Marked in the ground
    // texture's alpha; the terrain shader draws the bushes in rows along the contours there
    if (Math.max(...this.h) >= TEA_MIN) {
      const img = V.getImageData(0, 0, RASTER, RASTER), A = img.data;
      for (let py = 0; py < RASTER; py++) for (let px = 0; px < RASTER; px++) {
        const e = (px + 0.5) / PX, n = TILE - (py + 0.5) / PX;
        if (this.isTea(e, n)) A[(py * RASTER + px) * 4 + 3] = 128;
      }
      V.putImageData(img, 0, 0);
    }
    this.visCanvas = vis;
  }

  // ground under lakes, rivers and the sea sits below the water surface
  // SRTM is a 30 m radar surface with creases and roof-top bumps; the ground under a town has been levelled.
  // Relax the height grid toward its neighbours in proportion to how built-up each point is (tile borders stay
  // fixed so neighbouring tiles still meet).
  _smoothTowns() {
    const H = this.h, W = new Float32Array(GRID * GRID), BUILT = new Set([C.town, C.commercial, C.industrial, C.building, C.road]);
    const r = STEP * 0.35;
    for (let j = 1; j < GRID - 1; j++) for (let i = 1; i < GRID - 1; i++) {
      let k = 0;
      for (const [a, b] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]]) if (BUILT.has(this.classAt(i * STEP + a, j * STEP + b))) k++;
      W[j * GRID + i] = Math.min(1, k / 5);
    }
    for (let pass = 0; pass < 3; pass++) {
      const S = H.slice();
      for (let j = 1; j < GRID - 1; j++) for (let i = 1; i < GRID - 1; i++) {
        const w = W[j * GRID + i];
        if (!w) continue;
        let sum = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += S[(j + b) * GRID + i + a];
        H[j * GRID + i] = S[j * GRID + i] + (sum / 9 - S[j * GRID + i]) * w * 0.7;
      }
    }
    this.smoothed = W.reduce((a, b) => a + (b > 0), 0);
  }

  // Water beds: the coast, backwaters and lowland rivers lie at sea level; a river, pond or reservoir up in the hills
  // lies at its own height (sinking it to sea level dug pits a kilometre and more deep beside the hill roads)
  _sinkWater() {
    const H = this.h;
    this.waterLevel = 0.25;
    this.h0 = H.slice();
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const c = this.classAt(i * STEP, j * STEP);
      // (under a road too: roads over water are carried on bridge decks)
      if (c === C.water || c === C.sea) {
        const h = H[j * GRID + i];
        H[j * GRID + i] = (h < INLAND ? Math.min(h, 0) : h) - 2.2;
      }
    }
  }

  // Canals, rivers and streams the map draws as lines: a channel with stone walls and the water well below its banks
  // (they were a flat sheet of water lying on the ground, roads and all, that people walked and drove on). Kept clear
  // of the roads (a road crosses on its own graded level: a culvert or a bridge with its parapets).
  _carveWaterways() { const it = this._carveSteps(); while (!it.next().done); }
  *_carveSteps() {
    this._hPre = this.h.slice();
    yield* this._canalsSteps();
  }

  // the open stretches of every canal, river and stream line (broken where a road crosses), and from them: a 2 m mask
  // that cuts the channel out of the terrain (the ground grid is far too coarse to show a 10 m channel), and a lookup
  // for the ground in it (the bed, under the water)
  _canals() {
    if (this._cn) return this._cn;
    const it = this._canalsSteps();
    let r;
    while (!(r = it.next()).done);
    return r.value;
  }
  // (in steps, a pause when the build's slice of the frame is up: the lines, the mask drawn, read back and turned
  // over, all at once, took up to a seventh of a second)
  *_canalsSteps() {
    if (this._cn) return this._cn;
    const out = this._cn = [];
    for (const w of this.data.wl || []) {
      if (this._due()) { yield 'tile:canals+'; this._ys = performance.now(); }
      if (w[0] === 3) continue;
      const pts = decodeLine(w, 2), hw = Math.max(1.5, w[1] / 20);
      let cur = [];
      const flush = () => { if (cur.length > 1) out.push({ kind: w[0], hw, run: cur }); cur = []; };
      for (let i = 0; i < pts.length; i++) {
        const [ae, an] = pts[Math.max(0, i - 1)], [be, bn] = pts[i], k = i ? Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an) / 3)) : 1;
        for (let s2 = i ? 1 : 0; s2 <= k; s2++) {
          const q = i ? [ae + (be - ae) * s2 / k, an + (bn - an) * s2 / k] : pts[0];
          // over a road: where it crosses (a culvert), a break; where it runs along it (the map's line lies on the road),
          // beside it, as Kerala's canals run
          const r = this._roadNear(q[0], q[1], hw + 0.8);
          if (!r) { cur.push(q); continue; }
          const [ue, un] = [pts[Math.min(pts.length - 1, Math.max(1, i))][0] - pts[Math.max(0, Math.min(pts.length - 2, i - 1))][0], pts[Math.min(pts.length - 1, Math.max(1, i))][1] - pts[Math.max(0, Math.min(pts.length - 2, i - 1))][1]];
          const ul = Math.hypot(ue, un) || 1;
          if (Math.abs((ue * r.ue + un * r.un) / ul) < 0.8) { flush(); continue; }
          const side = r.d > 0.05 ? 1 : (cur.length ? Math.sign((cur[cur.length - 1][0] - r.ce) * r.ne + (cur[cur.length - 1][1] - r.cn) * r.nn) || 1 : 1);
          const sg = Math.sign((q[0] - r.ce) * r.ne + (q[1] - r.cn) * r.nn) || side, off = r.hw + hw + 1.4;
          const p2 = [r.ce + r.ne * off * sg, r.cn + r.nn * off * sg];
          if (this._roadNear(p2[0], p2[1], hw + 0.5)) { flush(); continue; }   // (no room: another road there too)
          cur.push(p2);
        }
      }
      flush();
    }
    // physics lookup (20 m cells): [e0, n0, e1, n1, hw, kind]
    this._cnG = new Map();
    for (const c of out) for (let i = 1; i < c.run.length; i++) {
      const [a, b] = [c.run[i - 1], c.run[i]], key = Math.floor((a[0] + b[0]) / 40) * 1000 + Math.floor((a[1] + b[1]) / 40);
      if (!this._cnG.has(key)) this._cnG.set(key, []);
      this._cnG.get(key).push(a[0], a[1], b[0], b[1], c.hw, c.kind);
    }
    // water mapped as areas: the narrow ones (canals, rivers, ponds; mean width under ~70 m) treated the same way:
    // cut out of the ground, walled, a bed under them (the wide backwaters and the sea lie on the sunken ground)
    const polys = this._wpolys = [];
    for (const [k, rr] of this.data.w || []) {
      if (k === 9) continue;
      const ring = decodeLine(rr[0], 0); if (ring.length < 3) continue;
      let area = 0, per = 0;
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += a[0] * b[1] - b[0] * a[1]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      area = Math.abs(area) / 2;
      if (!per || area / per * 2 > 70) continue;
      const holes = rr.slice(1).map((h) => decodeLine(h, 0));
      let lo = Infinity; for (const [e, n] of ring) lo = Math.min(lo, this._h0At(e, n));
      const y = lo >= INLAND ? lo - 0.4 : this.waterLevel;   // (as _water lays it)
      let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity; for (const [e, n] of ring) { e0 = Math.min(e0, e); n0 = Math.min(n0, n); e1 = Math.max(e1, e); n1 = Math.max(n1, n); }
      polys.push({ ring, holes, y, box: [e0, n0, e1, n1] });
    }
    // the mask (1024 px, rows from the south, as the terrain's uv runs)
    if ((out.length || polys.length) && typeof document !== 'undefined') {
      yield 'tile:canals+'; this._ys = performance.now();
      const R = 1024, k = R / TILE, cv = document.createElement('canvas'); cv.width = cv.height = R;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.strokeStyle = '#fff'; g.lineCap = 'butt'; g.lineJoin = 'round';
      for (const c of out) { g.lineWidth = c.hw * 2 * k; g.beginPath(); c.run.forEach(([e, n], i) => { const x = e * k, y = (TILE - n) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
      g.fillStyle = '#fff';
      for (const P of polys) { g.beginPath(); for (const R of [P.ring, ...P.holes]) R.forEach(([e, n], i) => { const x = e * k, y = (TILE - n) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.fill('evenodd'); }
      // (but never under a road: a road over the water is a bridge or a culvert, drawn on its own)
      g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round';
      for (const r of this.roads) { if (r.flags & 4 || r.cls > 8 || r.deck) continue; g.lineWidth = (ROAD_HALF[r.cls] * 2 + 1) * k; g.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * k, y = (TILE - n) * k; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
      yield 'tile:canals+'; this._ys = performance.now();
      const src = g.getImageData(0, 0, R, R).data, a = new Uint8Array(R * R);
      for (let y = 0; y < R; y++) {
        if ((y & 63) === 63 && this._due()) { yield 'tile:canals+'; this._ys = performance.now(); }
        for (let x = 0; x < R; x++) a[(R - 1 - y) * R + x] = src[(y * R + x) * 4];
      }
      const t = this.canalMask = new THREE.DataTexture(a, R, R, THREE.RedFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
    }
    return out;
  }

  // the nearest drivable road strip within margin of (e, n): its centreline point, unit direction, normal, half width,
  // and how far off its centre (e, n) is; or null
  _roadNear(e, n, margin) {
    if (!this._rg) this.nearRoad(e, n, 1);
    let best = null;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._rg.get((Math.floor(e / 25) + a) * 1000 + Math.floor(n / 25) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const cls = L[j + 4], r = this.roads[L[j + 5]]; if (cls > 8 || r.flags & 4) continue;
        const hw = cls <= 2 && r.lanes ? Math.max(ROAD_HALF[cls], r.lanes * 1.75) : ROAD_HALF[cls];
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1, l = Math.sqrt(l2);
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2)), ce = ax + dx * t, cn = az + dz * t, d = Math.hypot(e - ce, n - cn);
        if (d > hw + margin || (best && d - hw > best.d - best.hw)) continue;
        best = { ce, cn, ue: dx / l, un: dz / l, ne: -dz / l, nn: dx / l, hw, d };
      }
    }
    return best;
  }

  // the bed of a channel at (e, n) (water 0.9 m deep below the surface), or -Infinity outside every one
  canalBedAt(e, n) {
    for (const P of this._wpolys || []) {
      const [e0, n0, e1, n1] = P.box; if (e < e0 || e > e1 || n < n0 || n > n1) continue;
      let inside = false;
      for (const R of [P.ring, ...P.holes]) for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > n) !== (yj > n) && e < (xj - xi) * (n - yi) / (yj - yi || 1e-9) + xi) inside = !inside; }
      if (inside) return P.y - 0.9;
    }
    if (!this._cnG) return -Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._cnG.get((Math.floor(e / 20) + a) * 1000 + Math.floor(n / 20) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < (L[j + 4] - 0.2) ** 2) return this._wwY(e, n, L[j + 5]) - (L[j + 5] === 2 ? 0.5 : 0.9);
      }
    }
    return -Infinity;
  }

  // a waterway's surface at (e, n): sea level on the lowland (never above the bank), otherwise 0.7 m (a stream: 0.4 m)
  // under the ground it runs through (as it was before the channel was cut)
  _wwY(e, n, kind) {
    const g = this._hPre ? gridAt(this._hPre, this.gn, this.gs, e, n) : this.heightAt(e, n);
    return Math.min(this._waterY(e, n), g - (kind === 2 ? 0.4 : 0.7));
  }

  // the water surface at (e, n): sea level on the lowland, otherwise just under the ground it runs through
  _waterY(e, n) {
    const g0 = this._h0At(e, n);
    return g0 < INLAND ? this.waterLevel : Math.max(this.heightAt(e, n) + 0.12, g0 - 0.6);
  }

  // The map draws a road as straight pieces with a corner wherever it changes direction; a real road turns in a
  // curve. Every corner is rounded into an arc (wider for the bigger roads, as tight as the pieces either side
  // allow); the points where roads meet stay where they are, so junctions still join.
  _roundCorners() {
    const key = ([e, n]) => `${Math.round(e * 10)},${Math.round(n * 10)}`, uses = new Map();
    for (const r of this.roads) for (const p of r.pts) { const k = key(p); uses.set(k, (uses.get(k) || 0) + 1); }
    for (const r of this.roads) {
      const P = r.pts; if (P.length < 3) continue;
      const R = r.cls <= 1 ? 90 : r.cls <= 3 ? 50 : r.cls <= 5 ? 28 : 14, out = [P[0]];
      for (let i = 1; i < P.length - 1; i++) {
        const A = P[i - 1], B = P[i], Cn = P[i + 1];
        const l1 = Math.hypot(B[0] - A[0], B[1] - A[1]), l2 = Math.hypot(Cn[0] - B[0], Cn[1] - B[1]);
        if (uses.get(key(B)) > 1 || l1 < 0.5 || l2 < 0.5) { out.push(B); continue; }
        const u1 = [(B[0] - A[0]) / l1, (B[1] - A[1]) / l1], u2 = [(Cn[0] - B[0]) / l2, (Cn[1] - B[1]) / l2];
        const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
        if (th < 0.05) { out.push(B); continue; }
        // tangent length for radius R, at most a little under half of each piece (the next corner needs the rest)
        const t = Math.min(R * Math.tan(Math.min(th, 2.8) / 2), l1 * 0.48, l2 * 0.48);
        if (t < 1.5) { out.push(B); continue; }   // (too short to matter)
        const S0 = [B[0] - u1[0] * t, B[1] - u1[1] * t], S1 = [B[0] + u2[0] * t, B[1] + u2[1] * t];
        // (a quadratic curve through the corner: close to a circular arc, a point every ~8 degrees, at least ~1.5 m apart)
        const k = Math.max(2, Math.min(Math.ceil(th / 0.14), Math.floor(t * 2 / 1.5)));
        for (let j = 0; j <= k; j++) {
          const q = j / k, a = (1 - q) * (1 - q), b = 2 * q * (1 - q), c = q * q;
          out.push([a * S0[0] + b * B[0] + c * S1[0], a * S0[1] + b * B[1] + c * S1[1]]);
        }
      }
      out.push(P[P.length - 1]);
      r.pts = out;
    }
  }

  // Kerala's lowlands and midlands are built along nearly every road: a house in its compound every plot or so, and
  // in town a run of shops at the road's edge. OSM has only some of them mapped; the rest are filled in here, on
  // plots along the roads where the land is buildable (not paddy, water, forest, open grass or rock) and nothing is
  // mapped: shops set at the footpath in town, houses set back behind a yard elsewhere.
  *_infill(d, L, maxB) {
    const list = d.b || (d.b = []);
    if (list.length >= maxB) return;
    let s = (this.tx * 7919 ^ this.tz * 104729 ^ 0x2f6a) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const lu = (e, n) => { const px = Math.min(RASTER - 1, Math.max(0, Math.floor(e * PX))), py = Math.min(RASTER - 1, Math.max(0, Math.floor((TILE - n) * PX))); return L[(py * RASTER + px) * 4]; };
    const OK = new Set([C.land, C.grove, C.town, C.commercial, C.scrub]), TOWN = new Set([C.town, C.commercial]);
    // what's taken: the mapped buildings (their box and a margin), then each new one
    const G = 2, occ = new Set(), mark = (e0, n0, e1, n1, m) => { for (let x = Math.floor((e0 - m) / G); x <= Math.floor((e1 + m) / G); x++) for (let z = Math.floor((n0 - m) / G); z <= Math.floor((n1 + m) / G); z++) occ.add(x * 10000 + z); };
    const free = (e0, n0, e1, n1) => { for (let x = Math.floor(e0 / G); x <= Math.floor(e1 / G); x++) for (let z = Math.floor(n0 / G); z <= Math.floor(n1 / G); z++) if (occ.has(x * 10000 + z)) return false; return true; };
    for (const b of list) { const R = decodeLine(b, 2); let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const [e, n] of R) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); } mark(e0, n0, e1, n1, 1.5); }
    const add = [];
    for (const r of this.roads) {
      if (this._due()) { yield 'raster:infill+'; this._ys = performance.now(); }
      if (r.cls > 7 || r.flags & 6 || r.pts.length < 2) continue;
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : ROAD_HALF[r.cls];
      // walk the road: a plot every so often on each side
      const P = r.pts, D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const len = D[D.length - 1]; if (len < 30) continue;
      const at = (d0) => { let i = 1; while (i < P.length - 1 && D[i] < d0) i++; const u = (d0 - D[i - 1]) / ((D[i] - D[i - 1]) || 1), a = P[i - 1], b = P[i], l = (D[i] - D[i - 1]) || 1; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      for (const side of [1, -1]) {
        for (let d0 = 12 + rnd() * 8; d0 < len - 12;) {
          const [e, n, te, tn] = at(d0), ne = -tn * side, nn = te * side;
          if (gridAt(this.h, GRID, STEP, e, n) > 450) { d0 += 25; continue; }   // (not up in the high ranges)
          const c0 = lu(e + ne * (hw + 6), n + nn * (hw + 6)), town = TOWN.has(c0);
          const w = town ? 6 + rnd() * 4 : 8 + rnd() * 5;
          if (!OK.has(c0) || rnd() > (town ? 0.9 : 0.5)) { d0 += w + 2 + rnd() * 6; continue; }
          const back = town ? hw + 2.4 + rnd() * 0.8 : hw + 5 + rnd() * 6, dep = town ? 9 + rnd() * 5 : 7 + rnd() * 4;
          const c = [e + ne * (back + dep / 2), n + nn * (back + dep / 2)];
          const ring = [[-w / 2, -dep / 2], [w / 2, -dep / 2], [w / 2, dep / 2], [-w / 2, dep / 2]].map(([a, b]) => [c[0] + te * a + ne * b, c[1] + tn * a + nn * b]);
          let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity; for (const [x, z] of ring) { e0 = Math.min(e0, x); e1 = Math.max(e1, x); n0 = Math.min(n0, z); n1 = Math.max(n1, z); }
          const good = e0 > 2 && n0 > 2 && e1 < TILE - 2 && n1 < TILE - 2 && free(e0, n0, e1, n1) && !this._islands().some((I) => Math.hypot(c[0] - I.ce, c[1] - I.cn) < I.rin + 6)
            && [...ring, c].every(([x, z]) => OK.has(lu(x, z)) && !this.onRoad(x, z, 1.2))
            && !this.onRoad(c[0] - ne * dep * 0.25, c[1] - nn * dep * 0.25, 1.2);
          if (good) {
            mark(e0, n0, e1, n1, town ? 0.3 : 2.5);
            const H = town ? 6.2 + Math.floor(rnd() * 3) * 3.1 : rnd() < 0.55 ? 3.6 : 6.4;
            const out = [town ? 4 : 1, Math.round(H * 10)];
            let px = 0, pz = 0;
            ring.forEach(([x, z], i) => { const X = Math.round(x * 10), Z = Math.round(z * 10); if (i) out.push(X - px, Z - pz); else out.push(X, Z); px = X; pz = Z; });
            add.push([(town ? 0 : 10) + r.cls + rnd(), out]);
          }
          d0 += w + (town ? 0.2 + rnd() * 1.5 : 4 + rnd() * 10);
        }
      }
    }
    // (a budget: town shop rows first, then the houses along the bigger roads)
    const keep = add.sort((a, b) => a[0] - b[0]).slice(0, Math.max(0, Math.min(maxB - list.length, Math.round(maxB * 0.2)))).map((a) => a[1]);
    list.push(...keep);
    this.infilled = keep.length;
  }

  // roundabout islands: OSM maps the ring in pieces (flag 8); its points chained together, centred, the island as
  // big as fits inside the carriageway. [{ ce, cn, rin, grp: [[e, n, road]] }], worked out once
  _islands() {
    if (this._isl) return this._isl;
    const pts = [];
    for (const r of this.roads) if (r.flags & 8 && !(r.flags & 4)) for (const p of r.pts) pts.push([p[0], p[1], r]);
    const used = new Uint8Array(pts.length), out = [];
    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      const grp = [pts[i]]; used[i] = 1;
      for (let q = 0; q < grp.length; q++) for (let j = 0; j < pts.length; j++) if (!used[j] && Math.hypot(pts[j][0] - grp[q][0], pts[j][1] - grp[q][1]) < 40) { used[j] = 1; grp.push(pts[j]); }
      if (grp.length < 5) continue;
      let ce = 0, cn = 0; for (const [e, n] of grp) { ce += e; cn += n; } ce /= grp.length; cn /= grp.length;
      // (only a ring all round its centre: the points spread over every direction)
      const sect = new Set(grp.map(([e, n]) => Math.floor((Math.atan2(n - cn, e - ce) + Math.PI) / (Math.PI / 4))));
      if (sect.size < 6) continue;
      let rin = Infinity;
      for (const [e, n, r] of grp) { const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : ROAD_HALF[r.cls]; rin = Math.min(rin, Math.hypot(e - ce, n - cn) - hw - 0.6); }
      if (!(rin >= 2.5 && rin <= 45) || this.onRoad(ce, cn, 0, -1, 8)) continue;
      out.push({ ce, cn, rin, grp });
    }
    return (this._isl = out);
  }

  // inside (or within m of) a building's footprint: a 10 m grid of the footprints' boxes, built once
  inBuilding(e, n, m = 0) {
    if (!this._bx) {
      this._bx = new Map();
      for (const b of this.data?.b || []) {
        const R = decodeLine(b, 2); let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
        for (const [x, z] of R) { e0 = Math.min(e0, x); e1 = Math.max(e1, x); n0 = Math.min(n0, z); n1 = Math.max(n1, z); }
        const box = [e0, n0, e1, n1, R];
        for (let x = Math.floor((e0 - 4) / 10); x <= Math.floor((e1 + 4) / 10); x++) for (let z = Math.floor((n0 - 4) / 10); z <= Math.floor((n1 + 4) / 10); z++) { const k = x * 10000 + z; if (!this._bx.has(k)) this._bx.set(k, []); this._bx.get(k).push(box); }
      }
    }
    for (const [e0, n0, e1, n1, R] of this._bx.get(Math.floor(e / 10) * 10000 + Math.floor(n / 10)) || []) {
      if (e < e0 - m || e > e1 + m || n < n0 - m || n > n1 + m) continue;
      // inside the outline, or within m of one of its walls
      let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) c = !c; }
      if (c) return true;
      if (m > 0) for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [ax, az] = R[j], [bx, bz] = R[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2)); if (Math.hypot(ax + dx * u - e, az + dz * u - n) < m) return true; }
    }
    return false;
  }

  // a tea garden at (e, n): open land high in the hills (not forest, grassland, water, roads or buildings)
  isTea(e, n) {
    const c = this.classAt(e, n);
    return (c === C.land || c === C.grove || c === C.scrub || c === C.paddy) && this.heightAt(e, n) >= TEA_MIN;   // (farmland up there is tea, not paddy)
  }

  _h0At(e, n) { return this.h0 ? gridAt(this.h0, GRID, STEP, e, n) : this.heightAt(e, n); }

  // The 62.5 m survey grid, resampled smoothly (Catmull-Rom) to N x N: no 60 m facets for roads to sit across, and
  // fine enough for the ground to be graded along each road. The tile's edge rows depend only on the edge rows of
  // the survey grid, so neighbouring tiles still meet exactly.
  // (the survey before the water beds were sunk too, resampled alike: the ground a road beside a pond keeps)
  _refine(N) {
    const S = TILE / (N - 1);
    this.h0r = this.h0 ? _resample(this.h0, N) : null;
    this.h = _resample(this.h, N); this.gn = N; this.gs = S;
  }

  // Roads are built into the hillside as real ones are: along each road the ground takes a smoothed profile of
  // itself, level across the road and a few metres either side, then cut into the slope above and filled below,
  // the cut or fill running out over a distance that grows with its height. Where roads meet or run close, the
  // nearest road shapes the ground. Not at the tile's edge rows (so tiles meet), and the profile runs into the
  // natural ground over the last 40 m before a tile edge.
  // a road tagged as a bridge on dry land is a flyover only where another road passes beneath it (crosses it in plan
  // without meeting it); otherwise it's a culvert or a mistagged way, and stays at road level
  // (returns where they cross: the flyover is raised over those points and ramps down from them)
  _roadBeneath(r) {
    const cross = [];
    const seg = (a, b, c, d) => {
      const o = (p, q, s2) => (q[0] - p[0]) * (s2[1] - p[1]) - (q[1] - p[1]) * (s2[0] - p[0]);
      const d1 = o(a, b, c), d2 = o(a, b, d);
      if (!(d1 * d2 < 0 && o(c, d, a) * o(c, d, b) < 0)) return false;
      const u = d1 / (d1 - d2); cross.push([c[0] + (d[0] - c[0]) * u, c[1] + (d[1] - c[1]) * u]); return true;
    };
    const mine = new Set(r.pts.map(([e, n]) => `${Math.round(e)},${Math.round(n)}`));
    for (const o of this.roads) {
      // (not a road in a tunnel: an underpass runs below ground, not drawn; a bridge over it is a crossing at ground
      // level, which was lifted 5 m on steep ramps as if over a road in the open)
      if (o === r || o.flags & 2 || o.flags & 4 || o.cls > 8 || o.pts.length < 2) continue;
      if (o.pts.some(([e, n]) => mine.has(`${Math.round(e)},${Math.round(n)}`))) continue;
      for (let i = 1; i < r.pts.length; i++) for (let j = 1; j < o.pts.length; j++) seg(r.pts[i - 1], r.pts[i], o.pts[j - 1], o.pts[j]);
    }
    return cross;
  }

  // (a generator: it pauses every few milliseconds, the world spreading it over frames)
  *_gradeRoads() {
    const N = this.gn, S = this.gs, pre = this.h.slice(), H = this.h, h0r = this.h0r;
    const Ws = new Float32Array(N * N), Ys = new Float32Array(N * N), Am = new Float32Array(N * N), Cap = new Float32Array(N * N).fill(Infinity);
    // each road's own smoothed profile first; then where roads meet they share one height, each road easing to it
    // over its last 30 m (else two roads would meet a step apart on a hillside)
    // (a point is known by where it is to the metre, and points within 0.6 m of one another are one: a link road's end
    // and the highway's point it starts from lay 0.31 m apart across a metre's boundary, and no junction was found -
    // the side road chained onto the link met the highway's edge 0.46 m below it)
    const reg = new Map(), key = ([e, n]) => {
      const re = Math.round(e), rn = Math.round(n);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const q of reg.get((re + a) * 100000 + rn + b) || []) if ((q[0] - e) ** 2 + (q[1] - n) ** 2 < 0.36) return q[2];
      const k = `${re},${rn}`, g = re * 100000 + rn; if (!reg.has(g)) reg.set(g, []); reg.get(g).push([e, n, k]); return k;
    };
    const roads = [], node = new Map(), nodeW = new Map();
    const isW = (e, n) => { const c = this.classAt(e, n); return c === C.water || c === C.sea; };
    // 1. each road sampled every ~4 m: points, ground under them, water under them
    const E = [];
    for (const r of this.roads) {
      if (this._due()) { yield 'grade:sample+'; this._ys = performance.now(); }
      if (r.flags & 4 || r.cls > 8 || r.pts.length < 2) continue;
      const lanes = r.lanes || (r.cls <= 1 ? 4 : r.cls <= 3 ? 2 : r.cls <= 6 ? 2 : 1);
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], lanes * 1.75) : ROAD_HALF[r.cls];
      const P = [], at = [];
      for (let i = 1; i < r.pts.length; i++) {
        const [ae, an] = r.pts[i - 1], [be, bn] = r.pts[i], k = Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an) / 4));
        for (let s = i === 1 ? 0 : 1; s <= k; s++) { P.push([ae + (be - ae) * s / k, an + (bn - an) * s / k]); at.push(s === k ? i : s === 0 ? i - 1 : -1); }
      }
      if (P.length < 2) continue;
      // (the road's own pixels read as road: over water means water on both sides of it)
      // (and whether the water is on both sides, as under a crossing: a road along a canal bank, the canal's line
      // drawn over its centre, has it on one side only)
      const across = P.map(([e, n], i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1, o = hw + 5;
        return isW(e - dn / l * o, n + de / l * o) && isW(e + dn / l * o, n - de / l * o);
      });
      const water = P.map(([e, n], i) => across[i] || isW(e, n));
      // (in the lowlands, the ground before the water beds were sunk, at most half a metre lower: a road beside a
      // creek doesn't dip into its bed; h0 is shared along the tile edges, so neighbours agree. Not in the hills:
      // the coarse survey grid stands far above a valley floor there)
      // (at the tile's edge: the survey before the water was sunk, which both tiles share. The sunk ground can differ
      // there, one tile reading water at the edge and the other not: a road met its other half 0.5 m higher or lower)
      // (and anywhere, the same ground resampled before the beds were sunk: up in the hills a road beside a pond or a
      // reservoir dipped 2 m and more into its bed, a hump either side where it met the roads above)
      // (by the edge, the survey resampled smoothly: its edge row is the neighbour's too. Straight lines between the
      // survey's points 62.5 m apart made a sharp crest every 62.5 m on a road along the edge, 15 % up onto the flat)
      const rawAt = (e, n) => {
        const g = gridAt(pre, N, S, e, n), h0 = this._h0At(e, n), he = h0r ? gridAt(h0r, N, S, e, n) : h0;
        const y = Math.max(g, he - 0.5, h0 < 25 ? h0 - 0.5 : g), dE = Math.min(e, n, TILE - e, TILE - n);
        return dE < 20 ? he + (y - he) * _smooth(dE / 20) : y;
      };
      const cross = (r.flags & 2) && !water.some(Boolean) ? this._roadBeneath(r) : [];
      E.push({ r, hw, P, at, raw: P.map(([e, n]) => rawAt(e, n)), water, across, over: cross.length > 0, cross });
    }
    yield 'grade:cross';
    // two roads crossing in the map without a shared point (neither a bridge): a junction all the same, one level
    {
      const SG = new Map(), gk = (e, n) => Math.floor(e / 40) * 100000 + Math.floor(n / 40);
      E.forEach((x, xi) => { if (x.over || x.r.flags & 2) return; for (let i = 1; i < x.P.length; i++) { const k = gk(...x.P[i]); if (!SG.has(k)) SG.set(k, []); SG.get(k).push(xi, i); } });
      const o = (p, q, s2) => (q[0] - p[0]) * (s2[1] - p[1]) - (q[1] - p[1]) * (s2[0] - p[0]), seen = new Set();
      for (let xi = 0; xi < E.length; xi++) {
        if (this._due()) { yield 'grade:cross+'; this._ys = performance.now(); }
        const x = E[xi];
        if (x.over || x.r.flags & 2) continue;
        for (let i = 1; i < x.P.length; i++) {
          const a = x.P[i - 1], b = x.P[i], ge = Math.floor(b[0] / 40), gn = Math.floor(b[1] / 40);
          for (let A = -1; A <= 1; A++) for (let B = -1; B <= 1; B++) {
            const L = SG.get((ge + A) * 100000 + gn + B); if (!L) continue;
            for (let q = 0; q < L.length; q += 2) {
              const yi = L[q]; if (yi <= xi) continue;
              const y = E[yi], j = L[q + 1], c = y.P[j - 1], d = y.P[j], d1 = o(a, b, c), d2 = o(a, b, d);
              if (!(d1 * d2 < 0 && o(c, d, a) * o(c, d, b) < 0)) continue;
              const u = d1 / (d1 - d2), pe = c[0] + (d[0] - c[0]) * u, pn = c[1] + (d[1] - c[1]) * u, k = `x${Math.round(pe)},${Math.round(pn)}`;
              // (not where they already meet at a shared point close by)
              if (seen.has(xi + k) || x.r.pts.some((p2) => Math.hypot(p2[0] - pe, p2[1] - pn) < 6 && y.r.pts.some((p3) => Math.abs(p3[0] - p2[0]) < 0.5 && Math.abs(p3[1] - p2[1]) < 0.5))) continue;
              seen.add(xi + k);
              const near = (P, pi) => (Math.hypot(P[pi - 1][0] - pe, P[pi - 1][1] - pn) < Math.hypot(P[pi][0] - pe, P[pi][1] - pn) ? pi - 1 : pi);
              (x.xj ||= []).push([near(x.P, i), k, y, pe, pn]); (y.xj ||= []).push([near(y.P, j), k, x, pe, pn]);
            }
          }
        }
      }
      // a road ending on another's carriageway without a shared point (a T in the map's pieces, the shared point
      // dropped from the other's line or its end just short of it): a junction too. Its end kept a level of its own: a
      // culvert's deck ended 0.27 m over the main road it joins
      E.forEach((x, xi) => {
        if (x.over || x.r.flags & 2) return;
        for (const i of [0, x.P.length - 1]) {
          const [e0, n0] = x.P[i], ge = Math.floor(e0 / 40), gn = Math.floor(n0 / 40);
          let best = null;
          for (let A = -1; A <= 1; A++) for (let B = -1; B <= 1; B++) {
            const L = SG.get((ge + A) * 100000 + gn + B); if (!L) continue;
            for (let q = 0; q < L.length; q += 2) {
              if (L[q] === xi) continue;
              const y = E[L[q]], j = L[q + 1], c = y.P[j - 1], d = y.P[j], se = d[0] - c[0], sn = d[1] - c[1];
              const u = Math.max(0, Math.min(1, ((e0 - c[0]) * se + (n0 - c[1]) * sn) / (se * se + sn * sn || 1)));
              const pe = c[0] + se * u, pn = c[1] + sn * u, dd = Math.hypot(pe - e0, pn - n0);
              if (dd < y.hw + 1 && (!best || dd < best.dd)) best = { dd, y, j, u };
            }
          }
          if (!best) continue;
          // (not where the two share a point: that junction is in already)
          const shared = x.r.pts.some((p2) => Math.hypot(p2[0] - e0, p2[1] - n0) < 6 && best.y.r.pts.some((p3) => Math.abs(p3[0] - p2[0]) < 0.5 && Math.abs(p3[1] - p2[1]) < 0.5));
          if (shared) continue;
          // (nor where its end runs on over the other's line: that crossing is the junction. Both, each road was
          // brought to the other's level there, and the two missed each other by 0.3 m)
          if (x.xj?.some((c) => c[2] === best.y && Math.hypot(c[3] - e0, c[4] - n0) < 6)) continue;
          // (the ending road is brought to the other's level there once that is settled: see the junctions below)
          const t = { i, y: best.y, j: best.j, u: best.u, x };
          (x.tj ||= []).push(t); (best.y.tjOn ||= []).push(t);
        }
      });
    }
    // a dual carriageway's other half: a bridge piece beside a flyover (within 30 m) is a flyover too (the check for
    // a road beneath can miss one half)
    for (const x of E) {
      if (!(x.r.flags & 2) || x.over || x.water.some(Boolean)) continue;
      const m = x.P[x.P.length >> 1];
      const twin = E.find((o) => o !== x && o.over && o.P.some(([e, n]) => Math.hypot(e - m[0], n - m[1]) < 30));
      if (twin) { x.over = true; x.cross = twin.cross; }
    }
    // a roundabout is one level all round: OSM maps its ring in pieces, and each arm pulled the ring to its own height
    // where it joined (0.74 m up and down between two arms, 8 m apart). The ring at its ground's mean; the arms ease
    // onto it (its junctions take the ring's level, below)
    yield 'grade:rings';
    const ringY = new Map();
    for (const isl of this._islands()) {
      const rs = new Set(isl.grp.map((g) => g[2])), xs = E.filter((x) => rs.has(x.r) && !x.water.some(Boolean)), all = xs.flatMap((x) => x.raw);
      if (all.length) { const y = all.reduce((a, b) => a + b, 0) / all.length; for (const x of xs) ringY.set(x, y); }
    }
    // (every road's points, by where they are: the roads meeting at a junction)
    const vtx = new Map();
    for (const x of E) { const ri = this.roads.indexOf(x.r); for (const pt of x.r.pts) { const k = key(pt); if (!vtx.has(k)) vtx.set(k, new Set()); vtx.get(k).add(ri); } }
    // 2. chains: where exactly two road ends meet (and nothing else passes), it is one road in OSM's pieces (a bridge
    //    is usually its own short way): graded as one, so a bridge's ramps run on into its approaches
    const ends = new Map(), through = new Set();
    E.forEach((x, i) => {
      x.r.pts.forEach((pt, k) => { if (k > 0 && k < x.r.pts.length - 1) through.add(key(pt)); });
      for (const [end, pt] of [[0, x.r.pts[0]], [1, x.r.pts[x.r.pts.length - 1]]]) { const k = key(pt); if (!ends.has(k)) ends.set(k, []); ends.get(k).push([i, end]); }
    });
    const link = new Map();   // `${i},${end}` -> [j, endJ]
    // at a junction the road carries straight on: of the ends meeting there, the pair heading most nearly opposite
    // ways (within ~35 degrees of straight, similar classes) is one road; the rest are side roads
    const dirOut = ([i, end]) => { const p = E[i].r.pts, a = end ? p[p.length - 1] : p[0], b = end ? p[p.length - 2] : p[1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    for (const [k, L] of ends) {
      if (L.length < 2) continue;
      if (L.length === 2 && !through.has(k)) { if (L[0][0] !== L[1][0]) { link.set(L[0].join(','), L[1]); link.set(L[1].join(','), L[0]); } continue; }
      const cand = [];
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        if (L[a][0] === L[b][0] || Math.abs(E[L[a][0]].r.cls - E[L[b][0]].r.cls) > 2) continue;
        const [ax, ay] = dirOut(L[a]), [bx, by] = dirOut(L[b]), dot = ax * bx + ay * by;
        if (dot < -0.82) cand.push([dot, a, b]);
      }
      cand.sort((x, y) => x[0] - y[0]);
      const taken = new Set();
      for (const [, a, b] of cand) { if (taken.has(a) || taken.has(b)) continue; taken.add(a); taken.add(b); link.set(L[a].join(','), L[b]); link.set(L[b].join(','), L[a]); }
    }
    yield 'grade:chains';
    const used = new Uint8Array(E.length), chains = [];
    for (let i = 0; i < E.length; i++) {
      if (used[i]) continue;
      // walk back to the chain's first piece, then forward
      let cur = i, fwd = true, guard = 0;
      for (;;) { const prev = link.get(`${cur},${fwd ? 0 : 1}`); if (!prev || prev[0] === i || guard++ > E.length) break; fwd = prev[1] === 1; cur = prev[0]; }
      const C2 = []; guard = 0;
      for (;;) { if (used[cur]) break; used[cur] = 1; C2.push([cur, fwd]); const nx = link.get(`${cur},${fwd ? 1 : 0}`); if (!nx || guard++ > E.length) break; cur = nx[0]; fwd = nx[1] === 0; }
      chains.push(C2);
    }
    // 3. each chain's profile: the ground smoothed along it (SRTM in town is rooftops and trees: a long window), the raw
    //    ground kept at the tile's edge (the neighbour sees the same) and eased into over 80 m; decks where it crosses
    //    water or runs over another road
    yield 'grade:profiles';
    for (const ch of chains) {
      if (this._due()) { yield 'grade:profiles+'; this._ys = performance.now(); }
      const P = [], raw = [], water = [], across = [], over = [], own = [], brg = [], ring = [];
      for (const [ei, fwd] of ch) {
        const x = E[ei], n = x.P.length;
        for (let q = 0; q < n; q++) {
          const i = fwd ? q : n - 1 - q;
          if (P.length && q === 0) { own.push([ei, i, P.length - 1]); continue; }   // the shared joint
          // (raised only over the road beneath: within ~22 m of where it crosses; the ramps do the rest)
          own.push([ei, i, P.length]); P.push(x.P[i]); raw.push(x.raw[i]); water.push(x.water[i]); across.push(x.across[i]); ring.push(ringY.get(x)); over.push(x.over && x.cross.some(([ce, cn]) => Math.hypot(ce - x.P[i][0], cn - x.P[i][1]) < 22));
          brg.push(x.r.flags & 2 ? x.r.cls : 0);
        }
      }
      const D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      // (near a chain's end the window is cut short: a straight line fitted to what it holds, not their mean. The
      // mean of a road climbing to its end lies below the end: a side road met the road at the top of a hill 2 m
      // under it, a 4 m hump between that junction and the next one 7 m on)
      let sm = raw;
      for (let pass = 0; pass < 4; pass++) {
        const o = new Array(sm.length);
        for (let i = 0; i < sm.length; i++) {
          const lo = Math.max(0, i - 8), hi = Math.min(sm.length - 1, i + 8);
          let s2 = 0, sx = 0, sxx = 0, sxy = 0, c = 0;
          for (let k = lo; k <= hi; k++) { const x2 = k - i; s2 += sm[k]; sx += x2; sxx += x2 * x2; sxy += x2 * sm[k]; c++; }
          const det = c * sxx - sx * sx;
          o[i] = hi - i === i - lo || det < 1e-6 ? s2 / c : (sxx * s2 - sx * sxy) / det;
        }
        sm = o;
      }
      // (but not far off the ground: round a hairpin the average would cut metres into the hill or float over it)
      const prof = P.map(([e, n], i) => raw[i] + 5 * Math.tanh((sm[i] - raw[i]) / 5) * _smooth(Math.min(1, Math.max(0, Math.min(e, n, TILE - e, TILE - n) / 80))));
      // (a roundabout's ring level; a road carrying straight on from it, in the same chain, eases off it over 30 m)
      if (ring.some((y) => y !== undefined)) {
        const at = P.map((_, i) => i).filter((i) => ring[i] !== undefined);
        for (let i = 0; i < P.length; i++) {
          if (ring[i] !== undefined) { prof[i] = ring[i]; continue; }
          const a = at.reduce((b, j) => (Math.abs(D[j] - D[i]) < Math.abs(D[b] - D[i]) ? j : b), at[0]), d = Math.abs(D[a] - D[i]);
          if (d < 30) prof[i] = ring[a] + (prof[i] - ring[a]) * _smooth(d / 30);
        }
      }
      // a flyover cut by the tile's edge: the road beneath may be in the neighbour only, so where a dry bridge meets
      // the edge both tiles hold it clear at the edge (the shared ground there plus a flyover's height) and ramp
      // down from it: the two halves meet in the air. Every other raised piece is back on the ground at the edge.
      const edge = P.map(([e, n]) => Math.min(e, n, TILE - e, TILE - n)), atEdge = [];
      for (const i of [0, P.length - 1]) if (edge[i] < 1.5 && brg[i] && !water[i]) { over[i] = true; atEdge.push(i); }
      // (the water under a road comes and goes where the road's own strip is painted over it: a river crossing
      // read as a string of little culverts. Gaps under 40 m between wet stretches are the same water, where the
      // whole is a river's width (80 m or more): drains and ditches near each other stay culverts)
      if (Math.min(...ch.map(([ei]) => E[ei].r.cls)) <= 5) {   // (main and district roads: the river bridges)
        const w2 = water.slice();
        for (let i = 0, last = -1; i < P.length; i++) if (water[i]) { if (last >= 0 && i > last + 1 && D[i] - D[last] < 40) for (let k = last + 1; k < i; k++) w2[k] = true; last = i; }
        for (let i = 0; i < P.length;) {
          if (!w2[i]) { i++; continue; }
          let j = i; while (j + 1 < P.length && w2[j + 1]) j++;
          // (and mostly water: a string of drains through a town with dry road between them is not a river)
          let wl = 0; for (let k = i + 1; k <= j; k++) if (water[k] || water[k - 1]) wl += D[k] - D[k - 1];
          if (D[j] - D[i] >= 80 && wl >= (D[j] - D[i]) * 0.4) for (let k = i; k <= j; k++) water[k] = true;
          i = j + 1;
        }
      }
      // (water along the road, not across it: a road on a canal's bank, the canal drawn over its centre, was raised
      // on a deck all along the bank with steep ramps at each end. A crossing has the water on both sides of the
      // road for a good part of the way over; a culvert's few metres change nothing either way)
      for (let i = 0; i < P.length;) {
        if (!water[i] || over[i]) { i++; continue; }
        let j = i; while (j + 1 < P.length && water[j + 1] && !over[j + 1]) j++;
        let both = 0; for (let k = i; k <= j; k++) both += across[k] ? 1 : 0;
        if (D[j] - D[i] + 4 >= 14 && both < (j - i + 1) * 0.3) for (let k = i; k <= j; k++) water[k] = false;
        i = j + 1;
      }
      const wet = water.map((w, i) => w || over[i]);
      const cls = Math.min(...ch.map(([ei]) => E[ei].r.cls)), raised = new Uint8Array(P.length);
      if (wet.some(Boolean)) {
        const want = new Array(P.length).fill(-Infinity);
        let bigSpan = false;
        for (let i = 0; i < P.length;) {
          if (!wet[i]) { i++; continue; }
          let j = i; while (j + 1 < P.length && wet[j + 1]) j++;
          const span = D[j] - D[i] + 4, bank = Math.max(i > 0 ? prof[i - 1] : -Infinity, j + 1 < P.length ? prof[j + 1] : -Infinity);
          // a drain or ditch (a culvert under the road) changes nothing; a canal bridge rises a little; rivers and
          // backwaters get a deck
          if (span < 14 && !over[i]) {
            // (straight across from bank to bank: under it the ground is the sunk water bed)
            // (a drain running off the tile's edge: to the level both tiles agree on there. Held at the bank's level
            // to the edge, the road met its other half 0.8 m lower: the neighbour may not see the drain at all)
            const a0 = i > 0 ? prof[i - 1] : edge[0] < 1.5 ? prof[0] : null, b0 = j + 1 < P.length ? prof[j + 1] : edge[P.length - 1] < 1.5 ? prof[P.length - 1] : null;
            // (with the bank on one side only, where the road ends over a drain (the main road's, at a junction's
            // mouth): it carries on at its grade. Held level at the bank, a lane coming down a hill at 14 % met the
            // main road flat, a knee)
            const grade = (k0, k1) => (k0 >= 0 && k1 < P.length && D[k1] > D[k0] ? Math.max(-0.15, Math.min(0.15, (prof[k1] - prof[k0]) / (D[k1] - D[k0]))) : 0);
            for (let k = i; k <= j; k++) {
              const u = (D[k] - D[Math.max(0, i - 1)]) / ((D[Math.min(P.length - 1, j + 1)] - D[Math.max(0, i - 1)]) || 1);
              const y = a0 !== null && b0 !== null ? a0 + (b0 - a0) * u
                : a0 !== null ? a0 + grade(i - 2, i - 1) * (D[k] - D[i - 1]) : b0 !== null ? b0 - grade(j + 1, j + 2) * (D[j + 1] - D[k]) : prof[k];
              if (y > prof[k]) prof[k] = y;
            }
            i = j + 1; continue;
          }
          // (an overpass with no room for its ramps: the road it rides meets other roads too close to either end to
          // climb a lorry's height at a grade a car can drive, 15 %. A short service bridge was lifted 5 m on ramps of
          // 27 % between two junctions 18 m off: it crosses at the ground instead. A ramp cut by the tile's edge runs
          // on in the neighbour. (Over a road, not mostly water: a drain beside the street is no river)
          if (over.slice(i, j + 1).some(Boolean) && water.slice(i, j + 1).filter(Boolean).length * 2 < j - i + 1) {
            const need = cls <= 3 ? 6.5 : 5.2, room = (k, end) => (edge[end] < 1.5 ? Infinity : Math.abs(D[k] - D[end]));
            if (Math.min(room(i, 0), room(j, P.length - 1)) * 0.15 < need) { for (let k = i; k <= j; k++) { wet[k] = false; over[k] = false; } i = j + 1; continue; }
          }
          // (a main road's bridge over a river clears the water by a boat's height)
          const lift = span < 32 ? 0.3 : cls <= 3 ? 2.5 : cls <= 5 ? 2 : 1.5, clear = span < 32 ? 0.6 : span >= 80 && cls <= 3 ? 6 : 2;
          if (span >= 32 || over[i]) bigSpan = true;
          // (a hill stream or pond lies below its banks: the coarse survey can put its level well above them)
          // (but a river 60 m and more across is drawn at its surveyed level: the bridge clears that)
          const wy = (k) => { const y = this._waterY(P[k][0], P[k][1]); return Number.isFinite(bank) && span < 60 && this._h0At(P[k][0], P[k][1]) >= INLAND ? Math.min(y, bank - 0.3) : y; };
          // (from bank to bank: a long bridge between banks at different heights slopes between them)
          const b0 = i > 0 ? prof[i - 1] : bank, b1 = j + 1 < P.length ? prof[j + 1] : bank;
          const bankAt = (k) => (span < 60 || !Number.isFinite(b0) || !Number.isFinite(b1) ? bank : b0 + (b1 - b0) * (D[k] - D[i]) / ((D[j] - D[i]) || 1));
          for (let k = i; k <= j; k++) want[k] = water[k] ? Math.max(Number.isFinite(bank) ? bankAt(k) + lift : -Infinity, wy(k) + clear)
            : raw[k] + ((atEdge.includes(k) ? brg[k] : cls) <= 3 ? 6.5 : 5.2);   // a flyover: clear of the road (and traffic) beneath
          i = j + 1;
        }
        // ramps: 7 % up and down (4 % for a little canal bridge), running on along the chain into the approaches
        // two decks whose ramps would meet are one: level between them, no dip in a V. Further apart the road comes
        // back down to the ground between them (held up the whole way it was a bridge over dry land, from nowhere)
        const rk0 = bigSpan ? 0.07 : 0.04;
        for (let a = -1, i = 0; i < P.length; i++) {
          if (!Number.isFinite(want[i])) continue;
          const reach = a >= 0 ? (Math.max(0, want[a] - prof[a]) + Math.max(0, want[i] - prof[i])) / rk0 + 10 : 0;
          if (a >= 0 && i > a + 1 && D[i] - D[a] < Math.min(250, reach)) for (let k = a + 1; k < i; k++) want[k] = Math.max(want[k], want[a] + (want[i] - want[a]) * (D[k] - D[a]) / (D[i] - D[a]));
          a = i;
        }
        // (the height above the road's own profile eases off, not the absolute height: down a hillside steeper than
        // the ramp, a fixed-slope ramp would never meet the ground again)
        const ex = want.map((w, i) => w - prof[i]), rk = bigSpan ? 0.07 : 0.04;
        for (let i = 1; i < P.length; i++) ex[i] = Math.max(ex[i], ex[i - 1] - (D[i] - D[i - 1]) * rk);
        for (let i = P.length - 2; i >= 0; i--) ex[i] = Math.max(ex[i], ex[i + 1] - (D[i + 1] - D[i]) * rk);
        // (a bridge over water running off the edge: the neighbour sees the water too)
        const held = [...atEdge, ...[0, P.length - 1].filter((i) => edge[i] < 1.5 && water[i])];
        for (let i = 0; i < P.length; i++) if (!held.some((a) => Math.abs(D[a] - D[i]) < 200)) ex[i] = Math.min(ex[i], edge[i] * rk);
        // a ramp is back on the ground where it crosses another road's carriageway (held up, it was a slab across the
        // street from nowhere); from there it may climb more steeply (12 %) to the span. The span itself as it is
        {
          const mine = new Set(ch.map(([ei]) => this.roads.indexOf(E[ei].r)));
          // (not at a junction it shares with the road there, by the water: the head of a canal bridge right at a
          // junction stays up, the side road climbing to meet it (a junction on a ramp, below). Brought down there, it
          // dipped 1.5 m in a V. A flyover's ramp still comes down to the junction at its foot)
          const atJ = (i) => { const J = vtx.get(key(P[i])); return J && wet.some((w, k) => w && Math.abs(D[k] - D[i]) < 12) ? new Set([...mine, ...J]) : mine; };
          let any = false;
          for (let i = 0; i < P.length; i++) if (!wet[i] && ex[i] > 0.05 && this.onRoad(P[i][0], P[i][1], 0.5, atJ(i), 8)) { ex[i] = 0; any = true; }
          if (any) {
            for (let i = 1; i < P.length; i++) if (!wet[i]) ex[i] = Math.min(ex[i], ex[i - 1] + (D[i] - D[i - 1]) * 0.12);
            for (let i = P.length - 2; i >= 0; i--) if (!wet[i]) ex[i] = Math.min(ex[i], ex[i + 1] + (D[i + 1] - D[i]) * 0.12);
          }
        }
        for (let i = 0; i < P.length; i++) if (ex[i] > 0) { if (ex[i] > 0.3) raised[i] = 1; prof[i] += ex[i]; }
      }
      // back to the pieces
      const per = new Map();
      for (const [ei, i, ci] of own) { if (!per.has(ei)) per.set(ei, new Array(E[ei].P.length)); per.get(ei)[i] = ci; }
      for (const [ei, map] of per) {
        const x = E[ei], yy = map.map((ci) => prof[ci]), ww = map.map((ci) => wet[ci]);
        // a deck where the road is lifted clear (water spans, flyovers and their ramps)
        if (map.some((ci) => raised[ci])) x.r.deck = { P: x.P, y: yy, wet: ww, hw: x.hw }; else delete x.r.deck;
        const joins = [];
        x.at.forEach((pi, i) => {
          if (pi < 0) return;
          // a junction takes the height of its most important road (side roads meet the main road where it is; the
          // main road doesn't dip or rise to meet them); roads of the same class share the average
          const k = key(x.r.pts[pi]); joins.push([i, k]);
          if (!nodeW.has(k)) nodeW.set(k, []); nodeW.get(k).push(x.r.flags & 8 ? -1 : x.r.cls, x.hw, x);
          // (a roundabout's ring first; a link road after the roads of its class it links: a highway's two
          // carriageways each met the link across the median at the link's own level there, 0.95 m apart)
          const o = node.get(k); const c = x.r.flags & 8 ? -1 : x.r.cls + (x.r.flags & 16 ? 0.5 : 0);
          if (!o || c < o[2]) node.set(k, [yy[i], 1, c, (o?.[3] || 0) + 1, raised[map[i]], o?.[5], o?.[6]]); else if (c === o[2]) { o[0] += yy[i]; o[1]++; o[3]++; o[4] |= raised[map[i]]; } else o[3]++;
          const q = node.get(k); if (raised[map[i]] && !(q[5] >= yy[i])) { q[5] = yy[i]; q[6] = c; }
        });
        for (const [i, k] of x.xj || []) {
          if (raised[map[i]]) continue;   // (a bridge ramp passing over: no junction there)
          joins.push([i, k]);
          if (!nodeW.has(k)) nodeW.set(k, []); nodeW.get(k).push(x.r.flags & 8 ? -1 : x.r.cls, x.hw, x);
          const o = node.get(k), c = x.r.flags & 8 ? -1 : x.r.cls + (x.r.flags & 16 ? 0.5 : 0);
          if (!o || c < o[2]) node.set(k, [yy[i], 1, c, (o?.[3] || 0) + 1, raised[map[i]]]); else if (c === o[2]) { o[0] += yy[i]; o[1]++; o[3]++; o[4] |= raised[map[i]]; } else o[3]++;
        }
        roads.push((x.R = { hw: x.hw, P: x.P, prof: yy, joins, wet: ww, cls: x.r.cls, up: map.map((ci) => raised[ci]), tj: x.tj, tjOn: x.tjOn, src: x }));
        x.r.surf = { P: x.P, y: yy, hw: x.hw };   // the road's own surface (drawn and driven on): see _surfAt
      }
    }
    // roads running side by side (a highway and its service road, two carriageways, a lane along a main road) are
    // levelled together: the ground between them can't hold two levels a few metres apart, it would leave a wall.
    // Not decks or their ramps (a flyover beside its service road is meant to stand above it), not crossing roads,
    // and eased off at the tile's edge (the neighbour sees the raw level there)
    yield 'grade:side';
    {
      const G = new Map(), gk = (e, n) => Math.floor(e / 16) * 100000 + Math.floor(n / 16);
      roads.forEach((R, ri) => R.P.forEach(([e, n], i) => { if (R.up[i] || R.wet[i]) return; const k = gk(e, n); if (!G.has(k)) G.set(k, []); G.get(k).push(ri, i); }));
      const dir = (R, i) => { const a = R.P[Math.max(0, i - 1)], b = R.P[Math.min(R.P.length - 1, i + 1)], de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1; return [de / l, dn / l]; };
      for (let pass = 0; pass < 2; pass++) {
        const shift = (R) => {
          const dl = new Float32Array(R.P.length);
          R.P.forEach(([e, n], i) => {
            if (R.up[i] || R.wet[i]) return;
            const [ux, uy] = dir(R, i);
            // (each neighbouring road counts once, by its closest point; roads more than ~3 m apart in height are
            // terraced one above the other, not side by side)
            const best = new Map();
            const ge = Math.floor(e / 16), gn = Math.floor(n / 16);
            for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
              const L = G.get((ge + a) * 100000 + gn + b); if (!L) continue;
              for (let q = 0; q < L.length; q += 2) {
                const o = roads[L[q]]; if (o === R) continue;
                // (a highway's two carriageways: one road, level with each other. Tied as loosely as the rest, two
                // 11 m apart stayed 0.95 m apart, and the link across the median between them a 16 % ramp)
                const dual = R.cls <= 3 && o.cls === R.cls && (R.src.r.flags & o.src.r.flags & 1);
                const j = L[q + 1], [oe, on] = o.P[j], d = Math.hypot(oe - e, on - n), gap = R.hw + o.hw + (dual ? 14 : 6);
                if (d > gap || Math.abs(o.prof[j] - R.prof[i]) > 3) continue;
                const [vx, vy] = dir(o, j); if (Math.abs(ux * vx + uy * vy) < 0.8) continue;
                const w = dual ? 1 - (d / gap) ** 2 : (1 - d / gap) * 0.5, c = best.get(L[q]); if (!c || w > c[0]) best.set(L[q], [w, o.prof[j]]);
              }
            }
            let sw = 1, sy = R.prof[i];
            for (const [w, y] of best.values()) { sw += w; sy += y * w; }
            dl[i] = (sy / sw - R.prof[i]) * _smooth(Math.min(1, Math.max(0, Math.min(e, n, TILE - e, TILE - n) / 80)));
          });
          // (smoothed along the road: no kink where the neighbour starts or ends)
          const Dd = [0]; for (let i = 1; i < R.P.length; i++) Dd.push(Dd[i - 1] + Math.hypot(R.P[i][0] - R.P[i - 1][0], R.P[i][1] - R.P[i - 1][1]));
          // (and still nothing at the tile's edge: the average reached it from the road's last 16 m)
          const eg = (i) => { const [e, n] = R.P[i]; return _smooth(Math.min(1, Math.min(e, n, TILE - e, TILE - n) / 16)); };
          return dl.map((_, i) => { let s2 = 0, c = 0; for (let k = i; k >= 0 && Dd[i] - Dd[k] <= 16; k--) { s2 += dl[k]; c++; } for (let k = i + 1; k < dl.length && Dd[k] - Dd[i] <= 16; k++) { s2 += dl[k]; c++; } return s2 / c * eg(i); });
        };
        const deltas = [];
        for (const R of roads) { if (this._due()) { yield 'grade:side+'; this._ys = performance.now(); } deltas.push(shift(R)); }
        roads.forEach((R, ri) => { for (let i = 0; i < R.P.length; i++) R.prof[i] += deltas[ri][i]; });
        // (and the junctions' levels with them: taken before, they pulled each road back where it was - a highway's
        // two carriageways, levelled together, went back to 1 m apart at the junctions along them)
        roads.forEach((R, ri) => {
          const c = R.src.r.flags & 8 ? -1 : R.cls + (R.src.r.flags & 16 ? 0.5 : 0);
          for (const [i, k] of R.joins) { const o = node.get(k); if (o && o[2] === c) o[0] += deltas[ri][i]; }
        });
      }
    }
    // (the most important roads first: a side road ending on one without a shared point meets it at its final level)
    yield 'grade:junctions';
    // (along each chain, not piece by piece: the road eases to a junction across the joint into its next piece as
    // well. Each piece on its own, the joint held the correction to nothing there: a junction 3.6 m from a joint was
    // a 1 m step up a 29 % slope)
    const runs = chains.map((ch) => {
      const parts = [], C = [], joints = new Set();   // C: the piece and its sample at each point along the chain
      for (const [ei, fwd] of ch) {
        const R = E[ei].R, n = R.P.length, at = new Array(n);
        for (let q = 0; q < n; q++) {
          const i = fwd ? q : n - 1 - q;
          if (q === 0 && C.length) { at[i] = C.length - 1; joints.add(key(R.P[i])); continue; }   // (the shared joint)
          at[i] = C.length; C.push([R, i]);
        }
        parts.push([R, at]);
      }
      return { parts, C, joints, cls: Math.min(...parts.map(([R]) => R.cls)) };
    });
    // two junctions close together on a road (OSM maps a staggered crossing so): each took the level of the roads
    // meeting there, and on a hillside those were a metre and more apart a few metres from each other (a 27 % pitch
    // between junctions 4.6 m apart). Brought within the grade the hillside has there (8 % at least); the less
    // important junction gives way, two alike meet halfway
    {
      const lvl = (o) => o[0] / o[1], fixed = (o) => o[4] || o[5] !== undefined, pairs = [];
      for (const { parts, C, joints } of runs) {
        const D = [0]; for (let i = 1; i < C.length; i++) { const a = C[i - 1][0].P[C[i - 1][1]], b = C[i][0].P[C[i][1]]; D.push(D[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
        const js = [];
        for (const [R, at] of parts) for (const [j, k] of R.joins) { const o = node.get(k); if (o && o[3] >= 2 && !(o[3] === 2 && joints.has(k))) js.push([D[at[j]], k]); }
        js.sort((a, b) => a[0] - b[0]);
        for (let q = 1; q < js.length; q++) { const d = js[q][0] - js[q - 1][0]; if (d > 0.5 && d < 25 && js[q][1] !== js[q - 1][1]) pairs.push([js[q - 1][1], js[q][1], d]); }
      }
      // (a crossing without a shared point is keyed 'x' + where they cross)
      const g0 = (k) => { const [e, n] = k.replace(/^x/, '').split(',').map(Number); return h0r ? gridAt(h0r, N, S, e, n) : this._h0At(e, n); };
      for (let pass = 0; pass < 8 && pairs.length; pass++) for (const [ka, kb, d] of pairs) {
        const a = node.get(ka), b = node.get(kb), dy = lvl(b) - lvl(a), ex = Math.abs(dy) - Math.max(0.08 * d, Math.abs(g0(kb) - g0(ka)) + 0.04 * d);
        if (!(ex > 0) || (fixed(a) && fixed(b))) continue;
        const wa = fixed(a) || a[2] < b[2] ? 0 : fixed(b) || b[2] < a[2] ? 1 : 0.5, m = Math.sign(dy) * ex;
        a[0] += m * wa * a[1]; b[0] -= m * (1 - wa) * b[1];
      }
    }
    for (const { parts, C, joints } of runs.sort((a, b) => a.cls - b.cls)) {
      if (this._due()) { yield 'grade:junctions+'; this._ys = performance.now(); }
      const P = C.map(([R, i]) => R.P[i]), prof = C.map(([R, i]) => R.prof[i]), up = C.map(([R, i]) => R.up[i]), runX = new Set(parts.map(([R]) => R.src));
      // distance along the road
      const D = [0]; for (let i = 1; i < P.length; i++) D.push(D[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      const J = [], had = new Set(), fade = (dy) => Math.min(150, Math.max(45, Math.abs(dy) / 0.08, Math.sqrt(1300 * Math.abs(dy))));
      // (a side road is at the junction's level right across the more important road's carriageway, not only at its
      // centre line: coming down a hillside it met the main road's edge half a metre up, a step off the kerb there.
      // Held level over the other road's half-width either side of the junction, eased into beyond that)
      // (at the other road's own level where the edge is reached, not the junction point's: a side road meeting a
      // highway at a slant, the highway falling 6 % past the junction, met its edge 0.26 m above it)
      const atD = (d, A = prof) => { let k = 1; while (k < D.length - 1 && D[k] < d) k++; const t = Math.max(0, Math.min(1, (d - D[k - 1]) / ((D[k] - D[k - 1]) || 1))); return Array.isArray(A[0]) ? [A[k - 1][0] + (A[k][0] - A[k - 1][0]) * t, A[k - 1][1] + (A[k][1] - A[k - 1][1]) * t] : A[k - 1] + (A[k] - A[k - 1]) * t; };
      const levelOn = (Y, [e, n]) => {
        let bd = Infinity, y = null;
        for (let k = 1; k < Y.P.length; k++) {
          const a = Y.P[k - 1], b = Y.P[k], de = b[0] - a[0], dn = b[1] - a[1], u = Math.max(0, Math.min(1, ((e - a[0]) * de + (n - a[1]) * dn) / (de * de + dn * dn || 1)));
          const dd = Math.hypot(a[0] + de * u - e, a[1] + dn * u - n); if (dd < bd) { bd = dd; y = Y.prof[k - 1] + (Y.prof[k] - Y.prof[k - 1]) * u; }
        }
        return bd < Y.hw + 1.5 ? y : null;
      };
      // (a road passing through a junction of its own kind: only so far towards the next junction along that the
      // climb between them is no more than 2 % steeper for it. Two T junctions 7 m apart and 0.64 m different, a
      // plateau at each, left a 15 % ramp between them, 0.3 m below the road forking off it there. The junctions are
      // J's first nj entries. Not a side road meeting a main road: its edge is what matters there)
      const flats = [];
      let nj = 0;
      // (along a fork - another road leaving the junction close beside this one - as far as the two overlap, and flat
      // there: the other branch is held level over the same stretch. Each on its own grade, two branches 30 degrees
      // apart were 0.17 m different where their carriageways still overlapped 8 m out)
      const flat = (d0, yJ, w, Y, lim, fk) => {
        for (const sg of [-1, 1]) {
          const f = fk?.[sg > 0 ? 1 : 0] || 0, fork = f > w;
          // (a short link between two carriageways isn't all plateau and cliff)
          let dd = Math.min(fork ? f : w, D[D.length - 1] / 4);
          if (lim) for (let q = 0; q < nj; q++) {
            const g = (J[q][0] - d0) * sg; if (g < 0.5) continue;
            const dy = Math.abs(atD(J[q][0]) + J[q][1] - yJ); dd = Math.min(dd, (g - dy / (dy / g + 0.02)) / 2);
          }
          const d = d0 + sg * dd; if (dd < 0.5 || d <= 0.5 || d >= D[D.length - 1] - 0.5) continue;
          // (the other road's slope there, from the junction's level: its own correction to that level is the same
          // a few metres either side, whether it is graded yet or not)
          const y1 = Y && !fork ? levelOn(Y, atD(d, P)) : null, y0 = Y && !fork ? levelOn(Y, atD(d0, P)) : null;
          const yE = y1 != null && y0 != null ? yJ + y1 - y0 : null, dy = (yE ?? yJ) - atD(d); J.push([d, dy, fade(dy)]);
        }
      };
      for (const [R, at] of parts) {
        for (const t of R.tj || []) {
          const { i, y, j, u } = t, Y = y.R, ci = at[i];
          if (!Y || up[ci] || y.r.cls > R.cls + 1) continue;   // (a main road ending on a lane: no)
          const dy = Y.prof[j - 1] + (Y.prof[j] - Y.prof[j - 1]) * u - prof[ci];
          // (passing under or beside a ramp: its own level)
          if ((Y.up[j - 1] || Y.up[j]) && Math.abs(dy) > 1.5) continue;
          if (!had.has(ci)) { had.add(ci); J.push([D[ci], dy, fade(dy)]); t.lvl = prof[ci] + dy; if (y.r.cls <= R.cls) flats.push([D[ci], t.lvl, Y.hw + 0.5, Y]); }
        }
        // and a road ending on this one that way, graded already (a more important one, or one of its own kind): this
        // one stays at the level it met it at there, and level across its width, as at a shared point. Graded after
        // it, this one's own junctions moved it: a main road ending on a lane met it 0.3 m above it
        for (const t of R.tjOn || []) {
          const c0 = at[t.j - 1], c1 = at[t.j], X = t.x;
          if (t.lvl == null || c0 == null || c1 == null || up[c0] || up[c1]) continue;
          const d = D[c0] + (D[c1] - D[c0]) * t.u;
          if (J.some((q) => Math.abs(q[0] - d) < 1)) continue;
          const dy = t.lvl - atD(d); J.push([d, dy, fade(dy)]);
          if (X.r.cls < R.cls || (X.r.cls === R.cls && !(X.r.flags & 16))) flats.push([d, t.lvl, X.hw + 0.5, X.R, X.r.cls === R.cls]);
        }
        for (const [j, k] of R.joins) {
          const o = node.get(k), ci = at[j];
          if (!o || o[3] < 2 || had.has(ci)) continue;
          if (o[3] === 2 && joints.has(k)) continue;   // (the joint between two of its own pieces and nothing else)
          // a junction on a bridge's or flyover's ramp is at the ramp's height (a side road of about the same
          // importance climbs to meet it, the ramp doesn't dip to the road below)
          const onRamp = o[5] !== undefined && o[6] <= o[2] + 2;
          const dy = (onRamp ? o[5] : o[0] / o[1]) - prof[ci];
          // (a lane joined in the map to a flyover's or bridge's ramp passes under or beside it: it keeps its own level)
          if ((o[4] || onRamp) && Math.abs(dy) > 1.5 && R.cls > Math.min(o[2], onRamp ? o[6] : 99) + 2) continue;
          // (long enough for no more than 8 % extra grade, and for the dip or rise to be a gentle curve: under
          // 0.3 m of bend over 16 m at its middle)
          had.add(ci); J.push([D[ci], dy, fade(dy)]);
          // (a road ending here, one passing through a more important road's junction, or through a junction of its
          // own kind - OSM splits every piece at a crossroads and the straight ones are graded as one: a fork's two lanes
          // overlapped there at different grades. Not a main road passing a link road: that isn't flattened to it)
          if (!onRamp && !o[4] && o[2] <= R.cls) {
            const end = ci === 0 || ci === C.length - 1, W = nodeW.get(k) || []; let w = 0, Y = null;
            for (let q = 0; q < W.length; q += 3) {
              const X = W[q + 2]; if (W[q] > R.cls || X === R.src || W[q + 1] <= w) continue;
              if (!end && W[q] === R.cls && (X.r.flags & 16)) continue;
              w = W[q + 1]; Y = X.R;
            }
            // (not a dual carriageway's two halves parting: the two are levelled side by side already, and a 16 m
            // plateau on one of them stood 0.35 m over the other)
            let fk = null;
            if (!(R.src.r.flags & 1)) for (let q = 0; q < W.length; q += 3) {
              const X = W[q + 2]; if (W[q] > R.cls || runX.has(X) || (X.r.flags & 17)) continue;
              const p = X.R?.joins.find((jk) => jk[1] === k)?.[0]; if (p == null) continue;
              for (const sg of [-1, 1]) {
                const a = P[ci + sg]; if (!a) continue;
                const ux = a[0] - P[ci][0], uz = a[1] - P[ci][1], ul = Math.hypot(ux, uz) || 1;
                for (const xs of [-1, 1]) {
                  const b = X.P[p + xs]; if (!b) continue;
                  const vx = b[0] - X.P[p][0], vz = b[1] - X.P[p][1], c = (ux * vx + uz * vz) / ul / (Math.hypot(vx, vz) || 1);
                  if (c < 0.5) continue;   // (more than 60 degrees apart)
                  const L = Math.min(16, (R.hw + X.hw) / Math.sqrt(Math.max(1e-4, 1 - c * c))), side = sg > 0 ? 1 : 0;
                  (fk ||= [0, 0])[side] = Math.max(fk[side], L);
                }
              }
            }
            if (w) flats.push([D[ci], prof[ci] + dy, w + 0.5, Y, !end && o[2] === R.cls, fk]);
          }
        }
      }
      nj = J.length;
      for (const [d0, yJ, w, Y, lim, fk] of flats) flat(d0, yJ, w, Y, lim, fk);
      // (where the road runs out over the tile's edge it stays at the level both tiles agree on: a junction near the
      // edge, which the neighbour doesn't know of, pulled its end up or down, the road meeting its other half there
      // a step of up to a metre higher or lower)
      // (a junction right on the edge too: it is at that level, not the average of the roads this tile has there)
      if (J.length) for (const i of [0, P.length - 1]) {
        const [e, n] = P[i];
        if (Math.min(e, n, TILE - e, TILE - n) >= 0.01 || up[i]) continue;
        const on = J.filter(([d]) => Math.abs(d - D[i]) < 1);
        if (on.length) for (const q of on) q[1] = 0; else J.push([D[i], 0, 80]);
      }
      // each junction's correction fades out over 45 m (longer for a big one: no more than 8 % extra grade); where two
      // overlap they blend (each weighted by how far the other has faded), exact at each junction and with no jump
      // between them
      if (!J.length) continue;
      for (let i = 0; i < P.length; i++) {
        const act = [], s = [];
        for (let q = 0; q < J.length; q++) { const v = _smooth(Math.max(0, 1 - Math.abs(D[i] - J[q][0]) / J[q][2])); if (v > 0) { act.push(q); s.push(v); } }
        if (!act.length) continue;
        let a = 0, tot = 0, full = 0, fq = 0;
        for (let q = 0; q < act.length; q++) {
          let w = s[q]; for (let r = 0; r < act.length; r++) if (r !== q) w *= 1 - s[r];
          a += J[act[q]][1] * w; tot += w; if (s[q] > full) { full = s[q]; fq = act[q]; }
        }
        // (two junctions closer than the fade share it: normalised so the road still meets both)
        prof[i] += (tot > 1e-6 ? a / tot : J[fq][1]) * full;
      }
      for (const [R, at] of parts) for (let i = 0; i < at.length; i++) R.prof[i] = prof[at[i]];
    }
    yield 'grade:stamp';
    for (const { hw, P, prof, wet } of roads) {
      if (this._due()) { yield 'grade:stamp+'; this._ys = performance.now(); }
      const inner = hw + S * 0.75;          // every terrain triangle the road crosses is levelled to it
      const capAt = new Map();
      for (let i = 1; i < P.length; i++) {
        if (wet[i - 1] || wet[i]) continue;  // a bridge span: the water stays under it
        const [ae, an] = P[i - 1], [be, bn] = P[i], ya = prof[i - 1], yb = prof[i];
        const de = be - ae, dn = bn - an, l2 = de * de + dn * dn || 1, R = inner + 40;
        const i0 = Math.max(0, Math.ceil((Math.min(ae, be) - R) / S)), i1 = Math.min(N - 1, Math.floor((Math.max(ae, be) + R) / S));
        const j0 = Math.max(0, Math.ceil((Math.min(an, bn) - R) / S)), j1 = Math.min(N - 1, Math.floor((Math.max(an, bn) + R) / S));
        for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
          const e = ii * S, n = j * S, u = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / l2));
          const d = Math.hypot(ae + de * u - e, an + dn * u - n), y = ya + (yb - ya) * u, k = j * N + ii;
          const B = Math.min(40, Math.max(8, Math.abs(y - pre[k]) * 1.6));
          if (d >= inner + B) continue;
          const w = d <= inner ? 1 : _smooth(1 - (d - inner) / B), q = w / ((0.5 + d) * (0.5 + d));
          Ws[k] += q; Ys[k] += q * y; if (w > Am[k]) Am[k] = w;
          // under and beside the road the ground stays below its surface (a neighbour's grading or a hillside can't
          // push up through it), rising gently away from the edge
          // (from the nearest point of the road: from any point within reach, a road climbing at 15 % held the ground
          // under it at its level 13 m further down the hill, 2 to 3 m below its surface)
          if (d <= inner) { const c = y - 0.05 + Math.max(0, d - hw) * 0.03, o = capAt.get(k); if (!o || d < o[0]) capAt.set(k, [d, c]); }
        }
      }
      for (const [k, [, c]] of capAt) if (c < Cap[k]) Cap[k] = c;
    }
    yield 'grade:ground';
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (!Ws[k]) continue;
      const edge = Math.min(1, Math.min(i, j, N - 1 - i, N - 1 - j) / 1.5);
      H[k] = pre[k] + (Ys[k] / Ws[k] - pre[k]) * Am[k] * edge;
      // (the row next to the tile's edge too: left uncapped, the ground poked up through a road in a cutting there)
      if (H[k] > Cap[k]) H[k] = Cap[k];
    }
    // the edge row is the neighbour's as well: capped only from what both tiles agree on, the survey under each road
    // where it crosses the edge (its level there, rawAt above), so both cap their shared vertices alike
    for (const { hw, P, wet } of roads) for (const i of [0, P.length - 1]) {
      const [e, n] = P[i];
      if (wet[i] || Math.min(e, n, TILE - e, TILE - n) > 0.01) continue;
      const y = h0r ? gridAt(h0r, N, S, e, n) : this._h0At(e, n), inner = hw + S * 0.75, row = n < 0.01 ? 0 : n > TILE - 0.01 ? N - 1 : -1, col = e < 0.01 ? 0 : e > TILE - 0.01 ? N - 1 : -1;
      const along = []; for (let q = 0; q < N; q++) { if (row >= 0) along.push([q, row]); if (col >= 0) along.push([col, q]); }
      for (const [ii, jj] of along) {
        const d = Math.hypot(ii * S - e, jj * S - n), k = jj * N + ii, c = y - 0.05 + Math.max(0, d - hw) * 0.03;
        if (d <= inner && H[k] > c) H[k] = c;
      }
    }
    // the ground between a cell's corners stays under the road too: a road through a cell's near side has the far
    // corner up to S*1.4 away, past the band capped above, and on a hillside that corner held the cell's surface up
    // over the road itself (0.45 m above a main road in Iritty, every cell along it: a jolt at each one at speed). Over
    // the carriageway (every 2 m, five points across) the surface of the ground's triangle is kept under the road,
    // the corners holding it up lowered by just enough, the highest the most (not the near ones, beside the road)
    yield 'grade:cells';
    for (const { hw, P, prof, wet } of roads) {
      if (this._due()) { yield 'grade:cells+'; this._ys = performance.now(); }
      for (let i = 1; i < P.length; i++) {
        if (wet[i - 1] || wet[i]) continue;
        const [ae, an] = P[i - 1], [be, bn] = P[i], ya = prof[i - 1], yb = prof[i];
        const L = Math.hypot(be - ae, bn - an) || 1, ne = -(bn - an) / L, nn = (be - ae) / L, steps = Math.max(1, Math.ceil(L / 2));
        for (let s2 = 0; s2 <= steps; s2++) {
          const u = s2 / steps, ce = ae + (be - ae) * u, cn = an + (bn - an) * u, y = ya + (yb - ya) * u - 0.05;
          for (const o of [-hw, -hw / 2, 0, hw / 2, hw]) {
            const gx = (ce + ne * o) / S, gz = (cn + nn * o) / S;
            if (gx < 1 || gz < 1 || gx >= N - 2 || gz >= N - 2) continue;   // (not cells on the edge rows: the neighbour's too)
            const i0 = Math.floor(gx), j0 = Math.floor(gz), fx = gx - i0, fz = gz - j0, A = j0 * N + i0, B = A + 1, Cc = A + N, D = Cc + 1;
            // (the triangle the point is in, as gridAt and the mesh split the cell)
            const k0 = fx + fz <= 1 ? A : D, w0 = fx + fz <= 1 ? 1 - fx - fz : fx + fz - 1, w1 = fx + fz <= 1 ? fx : 1 - fz, w2 = fx + fz <= 1 ? fz : 1 - fx;
            const v = H[k0] * w0 + H[B] * w1 + H[Cc] * w2;
            if (v <= y) continue;
            const x0 = Math.max(0, H[k0] - y) * w0, x1 = Math.max(0, H[B] - y) * w1, x2 = Math.max(0, H[Cc] - y) * w2, q = x0 * w0 + x1 * w1 + x2 * w2;
            if (q <= 1e-9) continue;
            const ex = (v - y) / q;
            H[k0] -= ex * x0; H[B] -= ex * x1; H[Cc] -= ex * x2;
          }
        }
      }
    }
  }

  _terrain(M) {
    const n = this.gn || GRID, S = this.gs || STEP;
    // the edge vertices again, 4 m lower: a skirt round the tile hides cracks against a neighbour drawn coarser
    const edge = [];
    for (let i = 0; i < n; i++) edge.push([i, 0]); for (let j = 0; j < n; j++) edge.push([n - 1, j]);
    for (let i = n - 1; i >= 0; i--) edge.push([i, n - 1]); for (let j = n - 1; j >= 0; j--) edge.push([0, j]);
    const nv = n * n, pos = new Float32Array((nv + edge.length) * 3), uv = new Float32Array((nv + edge.length) * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = -i * S; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = j * S;
      uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / (n - 1);
    }
    edge.forEach(([i, j], q) => { const k = j * n + i, s = nv + q; pos.set([pos[k * 3], pos[k * 3 + 1] - 4, pos[k * 3 + 2]], s * 3); uv.set([uv[k * 2], uv[k * 2 + 1]], s * 2); });
    // index buffers at full, half and quarter detail (the grid is 2^k + 1 vertices a side); the tile picks one by distance
    // (written straight into one typed array. The grid's triangles face up as laid out, x mirrored and all: faceUp
    // found nothing to turn; built as JS lists and copied about, this was a tile's slowest single step)
    const sts = [1, 2, 4].filter((st) => (n - 1) % st === 0), lods = [];
    let total = 0, fullGrid = 0;
    for (const st of sts) total += ((n - 1) / st) ** 2 * 6 + 4 * ((n - 1) / st) * 12;
    const all = new Uint32Array(total);
    let o = 0;
    for (const st of sts) {
      const o0 = o;
      for (let j = 0; j < n - 1; j += st) for (let i = 0; i < n - 1; i += st) {
        const a = j * n + i, b = a + st, c = a + n * st, d = c + st;
        all[o++] = a; all[o++] = b; all[o++] = c; all[o++] = b; all[o++] = d; all[o++] = c;
      }
      if (st === 1) fullGrid = o;
      for (let e = 0; e < 4; e++) for (let q = 0; q < n - 1; q += st) {
        const a = e * n + q, b = a + st, [ia, ja] = edge[a], [ib, jb] = edge[b], A = ja * n + ia, B = jb * n + ib;
        all[o++] = A; all[o++] = B; all[o++] = nv + a; all[o++] = B; all[o++] = nv + b; all[o++] = nv + a;   // both sides
        all[o++] = A; all[o++] = nv + a; all[o++] = B; all[o++] = B; all[o++] = nv + a; all[o++] = nv + b;
      }
      lods.push([o0, o - o0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(all.subarray(0, fullGrid), 1)); fastNormals(g);   // (normals from the full grid)
    const N3 = g.attributes.normal.array;
    edge.forEach(([i, j], q) => { const k = (j * n + i) * 3; N3.set([N3[k], N3[k + 1], N3[k + 2]], (nv + q) * 3); });
    // (one index buffer holding every level; the draw range picks the level)
    g.setIndex(new THREE.BufferAttribute(all, 1));
    g.setDrawRange(lods[0][0], lods[0][1]);
    const tex = new THREE.CanvasTexture(this.visCanvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    if (M.terrainDetail) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uDet = { value: M.terrainDetail };
        sh.uniforms.uCanal = { value: this.canalMask || NO_CANAL };
        sh.vertexShader = 'varying vec3 vWp;\nvarying float vUp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz; vUp = normalize(mat3(modelMatrix) * objectNormal).y;');
        sh.fragmentShader = 'varying vec3 vWp;\nvarying float vUp;\nuniform sampler2D uDet;\nuniform sampler2D uCanal;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n if (texture2D(uCanal, vMapUv).r > 0.5) discard;   // (a canal: cut out of the ground)\n { float g1 = texture2D(uDet, vWp.xz / 7.0).g, g2 = texture2D(uDet, vWp.xz / 41.0).g; diffuseColor.rgb *= (0.7 + 0.6 * g1) * (0.88 + 0.24 * g2);'
          // tea (texture alpha): rounded hedges in rows along the contours, a dark path between, fading to their
          // average colour where the rows get finer than a pixel; on near-level ground no rows show
          + ' float tea = clamp((1.0 - sampledDiffuseColor.a) * 2.2 - 0.05, 0.0, 1.0); diffuseColor.a = 1.0;'
          + ' if (tea > 0.0) { float u = vWp.y / 0.4 + 0.4 * (sin(vWp.x * 0.071) + sin(vWp.z * 0.053 + 1.7)), w = fwidth(u), p = fract(u);'
          + '   float up = clamp(vUp, 0.2, 1.0), sl = sqrt(1.0 - up * up) / up;'
          + '   float dome = clamp(sin(3.14159 * (p - 0.12) / 0.76), 0.0, 1.0), rows = smoothstep(0.06, 0.18, sl);'
          + '   float shade = mix(mix(0.15, 1.0, sqrt(dome)), 0.78, smoothstep(0.15, 0.45, w));'
          + '   vec3 bush = mix(vec3(0.045, 0.1, 0.02), vec3(0.11, 0.17, 0.035), g1 * dome) * mix(0.82, shade, rows), soil = vec3(0.06, 0.045, 0.03);'
          + '   vec3 teaC = mix(soil, bush, mix(0.92, smoothstep(0.0, 0.15, dome) * 0.85 + 0.15, rows * (1.0 - smoothstep(0.15, 0.45, w))));'
          + '   diffuseColor.rgb = mix(diffuseColor.rgb, teaC, tea); } }');
      };
      mat.customProgramCacheKey = () => 'klTerrain';
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = 'terrain';
    m.userData.lods = lods; m.userData.lod = 0;
    this.terrain = m;
    return m;
  }

  _water(M, d) {
    const geos = [];
    const ring = (r) => decodeLine(r, 0).map(([e, n]) => new THREE.Vector2(-e, n));
    for (const [k, rr] of d.w || []) {
      const contour = ring(rr[0]), holes = rr.slice(1).map(ring);
      if (contour.length < 3) continue;
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = [contour, ...holes].flat();
      // a hill pond or reservoir: level with its lowest shore
      let y = k === 9 ? 0 : this.waterLevel;
      if (k !== 9) { const lo = Math.min(...contour.map((p) => this._h0At(-p.x, p.y))); if (lo >= INLAND) y = lo - 0.4; }
      const pos = new Float32Array(all.length * 3);
      all.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = p.y; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      geos.push(faceUp(g));
    }
    // rivers / canals as ribbons
    // (in runs, broken where a road crosses: the road carries over it)
    for (const c of this._canals()) {
      const g = this._ribbon(c.run, c.hw + 0.3, (e, n) => this._wwY(e, n, c.kind), 1e9);
      if (g) { g.deleteAttribute('uv'); geos.push(faceUp(g)); }
    }
    if (!geos.length) return null;
    for (const g of geos) if (!g.attributes.normal) fastNormals(g);
    const merged = mergeGeometries(geos.map((g) => { g.deleteAttribute('normal'); fastNormals(g); return g; }));
    if (!merged) return null;
    const m = new THREE.Mesh(merged, M.klWater || M.water);
    m.name = 'water';
    return m;
  }

  // a flat strip of half width hw along pts (tile-local e/n), at height yOf(e, n); uv: u across, v along (m / vScale)
  // rows: if given, gets each row of the strip as drawn ([e, n, unit normal e, n, left y, right y]), for drawnAt()
  _ribbon(pts, hw, yOf, vScale = 8, rows = null) {
    // densify so the strip follows the ground
    const P = [];
    for (let i = 0; i < pts.length; i++) {
      if (i) {
        const [ae, an] = pts[i - 1], [be, bn] = pts[i], L = Math.hypot(be - ae, bn - an), k = Math.ceil(L / 8);
        for (let s = 1; s < k; s++) P.push([ae + (be - ae) * s / k, an + (bn - an) * s / k]);
      }
      P.push(pts[i]);
    }
    if (P.length < 2) return null;
    const pos = new Float32Array(P.length * 6), uv = new Float32Array(P.length * 4), idx = [];
    let along = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1;
      const ne = -dn / l * hw, nn = de / l * hw;  // left of travel (in e/n)
      if (i) along += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const [e, n] = P[i];
      // the ground between vertices is creased (noisy SRTM): sit each vertex on the highest ground around it so
      // no ridge pokes through the strip
      const pe = P[Math.max(0, i - 1)], qe = P[Math.min(P.length - 1, i + 1)];
      // (not on a road's own graded surface: that is smooth and is exactly what the wheels drive on; lifted to the higher
      // ground ahead or behind, a ramp's strip would stand 0.1-0.3 m above them and the tyres sink into it)
      const hi = (oe, on) => yOf.exact?.(e + oe, n + on) ? yOf(e + oe, n + on) : Math.max(yOf(e + oe, n + on), yOf((e + pe[0]) / 2 + oe, (n + pe[1]) / 2 + on), yOf((e + qe[0]) / 2 + oe, (n + qe[1]) / 2 + on));
      const yc = hi(0, 0);
      let yl = Math.max(hi(ne, nn), yc - 0.25), yr = Math.max(hi(-ne, -nn), yc - 0.25);
      if ((yl + yr) / 2 < yc) { const up = yc - (yl + yr) / 2; yl += up; yr += up; }  // a ridge along the middle
      pos.set([-(e + ne), yl, n + nn, -(e - ne), yr, n - nn], i * 6);
      if (rows) rows.push(e, n, ne / hw, nn / hw, yl, yr);
      uv.set([0, along / vScale, 1, along / vScale], i * 4);
      if (i) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return faceUp(g);
  }

  // The earth shoulder each side of a road strip: from the strip's edge, 1.6 m out and down (or up) to the ground,
  // so a road on a low embankment has a slope, not a ledge (roadSurface() gives the physics the same slope).
  // Not where it would reach into a junction or onto another road (ri: this road's index): the raw ground there
  // can stand above the other road's graded surface, and the slope showed as a brown wedge across its lanes.
  _shoulder(g, ri = -1) {
    const P = g.attributes.position.array, n = P.length / 6;
    if (n < 2) return null;
    const pos = [], idx = [], W = 1.6, clash = [];
    for (const side of [0, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const o = i * 6 + side * 3, q = i * 6 + (1 - side) * 3;
        const ex = P[o], ey = P[o + 1], ez = P[o + 2];
        let dx = ex - P[q], dz = ez - P[q + 2]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const ox = ex + dx * W, oz = ez + dz * W, gy = this.heightAt(-ox, oz) + 0.03;
        pos.push(ex, ey - 0.005, ez, ox, Math.min(gy, ey - 0.02) + (gy > ey ? (gy - ey) : 0), oz);
        clash.push(this._nearJunction?.(-ox, oz) || this.onRoad(-ox, oz, 0.3, ri) || this.onRoad(-(ex + dx * 0.5), ez + dz * 0.5, 0.1, ri));
      }
      // only where the road and the ground beside it part (a level road needs no slope drawn)
      const drop = (k) => Math.abs(pos[(k * 2) * 3 + 1] - pos[(k * 2 + 1) * 3 + 1]);
      for (let i = 0; i < n - 1; i++) {
        if (drop(base / 2 + i) < 0.12 && drop(base / 2 + i + 1) < 0.12) continue;
        if (clash[side * n + i] || clash[side * n + i + 1]) continue;
        const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    if (!idx.length) return null;
    // a low bank is bare earth; a tall cut into the hill shows its rock and red earth, a tall fill is held by a grey
    // rubble retaining wall, as on the ghat roads
    const col = new Float32Array(pos.length), E = new THREE.Color(0x5f5644).toArray(), R = new THREE.Color(0x67635a).toArray(), X = new THREE.Color(0x6a5040).toArray();
    for (let k = 0; k < pos.length / 6; k++) {
      const d = pos[k * 6 + 4] - pos[k * 6 + 1], w = Math.min(1, Math.max(0, (Math.abs(d) - 0.8) / 0.6)), T = d > 0 ? X : R;
      for (let c = 0; c < 3; c++) col[k * 6 + c] = col[k * 6 + 3 + c] = E[c] + (T[c] - E[c]) * w;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    sg.setIndex(idx); faceUp(sg); fastNormals(sg);
    return sg;
  }

  // (a generator: yields every ~3 ms of work, see _due)
  *_roads(M) {
    const paved = [], dirt = [], white = [], yellow = [], shoulders = [];
    const y = (lift) => (e, n) => this.heightAt(e, n) + lift;
    // junctions (points shared by roads): markings stop short of them, as painted lines do
    const seen = new Map();
    for (const r of this.roads) {
      if (r.flags & 4 || r.cls > 8) continue;
      const hw = ROAD_HALF[r.cls];
      const last = r.pts.length - 1;
      for (const [k, mid] of new Map(r.pts.map(([e, n], i) => [`${Math.round(e)},${Math.round(n)}`, i > 0 && i < last]))) { const o = seen.get(k); seen.set(k, o ? [o[0] + 1, Math.max(o[1], hw), o[2] || mid] : [1, hw, mid]); }
    }
    // (and a road ending part-way along another, on no point of it - a T junction drawn that way, or its shared point
    // simplified out of the through road: nothing kept clear of it, and a canal's parapet ran up to the side road's
    // mouth, where a car turning in caught it)
    for (const [ri, r] of this.roads.entries()) {
      if (r.flags & 4 || r.cls > 8) continue;
      for (const q of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const k = `${Math.round(q[0])},${Math.round(q[1])}`, o = seen.get(k);
        if (!o || o[0] > 1) continue;
        const hwO = this._roadHwAt(q[0], q[1], ri);
        if (hwO > 0) seen.set(k, [2, Math.max(o[1], hwO), true]);
      }
    }
    const JG = new Map();
    for (const [k, [c0, hw, through]] of seen) {
      if (c0 < 2) continue;
      const c = c0 >= 3 || through ? Math.max(3, c0) : c0;   // (a side road ending on a road passing through: a T junction)
      const [e, n] = k.split(',').map(Number), gk = Math.floor(e / 16) * 1000 + Math.floor(n / 16);
      if (!JG.has(gk)) JG.set(gk, []); JG.get(gk).push(e, n, hw + 2.5, c);
    }
    // (extra: a wider margin; minC: only where that many road ends meet, a real junction rather than one road's
    // two pieces meeting)
    const nearJ = this._nearJunction = (e, n, extra = 0, minC = 2) => {
      const ge = Math.floor(e / 16), gn = Math.floor(n / 16);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const L = JG.get((ge + a) * 1000 + gn + b); if (!L) continue;
        for (let j = 0; j < L.length; j += 4) if (L[j + 3] >= minC && (L[j] - e) ** 2 + (L[j + 1] - n) ** 2 < (L[j + 2] + extra) ** 2) return true;
      }
      return false;
    };
    // the gap between a dual carriageway's halves by a junction: paved over, level with them (it was bare earth
    // running into the junction past the median's end)
    for (const m of this._medians()) {
      if (!m.fill) continue;
      const c0 = [m.e + m.ne * m.w / 2 - m.ue * 2.1, m.n + m.nn * m.w / 2 - m.un * 2.1], c1 = [m.e + m.ne * m.w / 2 + m.ue * 2.1, m.n + m.nn * m.w / 2 + m.un * 2.1];
      const y = (m.y0 + m.y1) / 2 + 0.07 + (10 - m.cls) * 0.004 - 0.005;
      const gq = this._ribbon([c0, c1], m.w / 2 + 0.25, () => y, 7);
      if (gq) { fastNormals(gq); const n0 = gq.attributes.position.count; gq.setAttribute('junc', new THREE.BufferAttribute(new Float32Array(n0).fill(1), 1)); paved.push(gq); }
    }
    // wider classes sit a hair higher so junctions don't flicker
    for (const r of this.roads) {
      if (this._due()) { yield 'tile:roads+'; this._ys = performance.now(); }
      if (r.flags & 4) continue; // tunnels: not drawn on the surface
      const lanes = r.lanes || (r.cls <= 1 ? 4 : r.cls <= 3 ? 2 : r.cls <= 6 ? 2 : 1);
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], lanes * 1.75) : ROAD_HALF[r.cls];
      const lift = r.dirt ? 0.06 : 0.07 + (10 - r.cls) * 0.004;   // (a dirt track always under a paved road it meets)
      // ends cut at the tile border run on a little, so a road crossing the seam at an angle leaves no wedge
      const onEdge = ([e, n]) => e < 0.6 || n < 0.6 || e > TILE - 0.6 || n > TILE - 0.6;
      const run = (a, b) => { const de = a[0] - b[0], dn = a[1] - b[1], l = Math.hypot(de, dn) || 1; return [a[0] + de / l * (hw + 1), a[1] + dn / l * (hw + 1)]; };
      const P = r.pts.length > 1 && (onEdge(r.pts[0]) || onEdge(r.pts[r.pts.length - 1])) ? [...r.pts] : r.pts;
      if (P !== r.pts) { if (onEdge(P[0])) P.unshift(run(P[0], P[1])); if (onEdge(P[P.length - 1])) P.push(run(P[P.length - 1], P[P.length - 2])); }
      // the road's own graded surface (its deck on a bridge), the ground where it has none (beyond a tile-edge cut)
      // (inside a more important road's strip, just under its surface: one continuous top where two roads overlap away
      // from their shared point, instead of the lesser road's slab and edge standing on the main road)
      const ri = this.roads.indexOf(r);
      const ys = (extra) => Object.assign((e, n) => {
        const v = this._surfAt(r, e, n), y = (v > -1e9 ? v : this.heightAt(e, n)) + lift + extra, cov = r.deck ? -Infinity : this._coverY(e, n, ri);
        return cov > -1e9 && y > cov - 0.02 ? cov - 0.02 : y;
      }, { exact: (e, n) => this._surfAt(r, e, n) > -1e9 });
      // (a point every 2.5 m within 12 m of its junctions and ends, 8 m elsewhere: a side road is held level across
      // the road it joins, then eases into its grade, and drawn straight from the junction to a point 8 m off the strip
      // ran through that bend 0.28 m above it - the wheels dropped off it at the main road's edge)
      const jn = (q) => (seen.get(`${Math.round(q[0])},${Math.round(q[1])}`)?.[0] || 0) >= 2, Q = [P[0]];
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ja = i === 1 || jn(a), jb = i === P.length - 1 || jn(b);
        if ((ja || jb) && L > 3) { const k = Math.ceil(L / 2.5); for (let q = 1; q < k; q++) { const d = L * q / k; if ((ja && d <= 12) || (jb && L - d <= 12)) Q.push([a[0] + (b[0] - a[0]) * q / k, a[1] + (b[1] - a[1]) * q / k]); } }
        Q.push(b);
      }
      const rows = [];
      const g = this._ribbon(Q, hw, ys(0), 7, rows);
      if (!g) continue;
      r.drawn = { rows, hw };   // (what the wheels drive on: see _drawnAt)
      fastNormals(g);
      if (!r.dirt) {
        // in a junction the strips overlap: no ragged edge or verge dust there (it would show on the other road)
        const Pp = g.attributes.position, J = new Float32Array(Pp.count);
        for (let i = 0; i < Pp.count; i++) J[i] = nearJ(-Pp.getX(i), Pp.getZ(i)) ? 1 : 0;   // (its own copy: the tile's may be cleared meanwhile)
        g.setAttribute('junc', new THREE.BufferAttribute(J, 1));
      }
      (r.dirt ? dirt : paved).push(g);
      if (this._due()) { yield 'tile:roads+'; this._ys = performance.now(); }
      const sk = r.deck ? null : this._shoulder(g, this.roads.indexOf(r));  // (a road with a bridge: its approaches are banked up instead)
      if (sk) shoulders.push(sk);
      if (r.dirt || r.cls > 4) continue;  // village and town lanes carry no paint
      // markings: dashed white centre line (Indian roads), solid edge lines on the main roads
      const cl = this._dashes(r.pts, 0, 0.08, 3, 6, ys(0.012));
      if (cl) white.push(cl);
      if (r.cls <= 3) for (const side of [1, -1]) { const e = this._dashes(r.pts, side * (hw - 0.35), 0.08, 0, 0, ys(0.012)); if (e) (r.cls <= 1 ? yellow : white).push(e); }
    }
    this._junctions = [...seen].filter(([, [c]]) => c >= 3).map(([k, [c, hw]]) => { const [e, n] = k.split(',').map(Number); return { e, n, c, r: hw + 2.5 }; });
    // (each kind merged in steps: the whole tile's roads in one merge took up to a ninth of a second)
    const out = [], due = () => { if (!this._due()) return false; this._ys = performance.now(); return true; };
    const kinds = [[paved, M.klRoad || M.road, 'roads'], [dirt, M.klDirtRoad || M.dirt, 'tracks'], [shoulders, M.klShoulder || M.klDirtRoad || M.dirt, 'shoulders'], 'bridges', [white, M.klLineWhite, 'lines'], [yellow, M.klLineYellow, 'linesY']];
    for (const k of kinds) {
      if (this._due()) { yield 'tile:roads+'; this._ys = performance.now(); }
      if (k === 'bridges') { const br = this._bridges(); if (br) { const m = new THREE.Mesh(br, M.klBridge || M.klKerb); m.name = 'bridges'; m.castShadow = true; m.receiveShadow = true; out.push(m); } continue; }
      const [list, mat, name] = k;
      if (!list.length) continue;
      const gg = yield* mergeSteps(list, due);
      if (!gg) continue;
      const m = new THREE.Mesh(gg, mat); m.receiveShadow = true; m.name = name; out.push(m);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ street edge
  // Town streets: a concrete kerb with the open roadside drain behind it (slab-covered in stretches) and, on the
  // commercial stretches, a raised footpath; zebra crossings at the busy junctions, painted speed breakers (which
  // vehicles feel: bumpAt / bumpAhead), and iron manhole covers in the carriageway.
  // (generators: they yield partway through, so a tile's build can be spread over frames)
  *_street(M, opts) {
    this._medians();   // (the medians are ground for the physics too)
    if (!M.klKerb) return [];
    let s = (this.tx * 3571 ^ this.tz * 7919 ^ 0x5bd1) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const TOWN = new Set([C.town, C.commercial, C.industrial, C.building]);
    const nj = this._nearJunction || (() => false);
    const builtUp = (e, n, ne, nn, hw) => [1, -1].some((sd) => { const c = this.classAt(e + ne * (hw + 1.3) * sd, n + nn * (hw + 1.3) * sd); return TOWN.has(c) || [3, 9, 16].some((o) => this.classAt(e + ne * (hw + o) * sd, n + nn * (hw + o) * sd) === C.building); });
    const chunkOf = (e, n) => Math.min(3, Math.max(0, Math.floor(e / 500))) + 4 * Math.min(3, Math.max(0, Math.floor(n / 500)));
    const inTileM = ([e, n]) => e > 0 && n > 0 && e < TILE && n < TILE;
    const kerb = [], zebra = [], bumps = [], holes = [];
    for (let c = 0; c < 16; c++) kerb.push({ p: [], c: [] });
    const quad = (K, a, b, c2, d, col, col2 = col) => {
      // a-b at the start of the segment, d-c at the end (a/d inner, b/c outer)
      K.p.push(...a, ...b, ...c2, ...a, ...c2, ...d);
      K.c.push(...col, ...col2, ...col2, ...col, ...col2, ...col);
    };
    this.bumps = [];
    for (const [ri, r] of this.roads.entries()) {
      if (this._due()) { yield 'tile:street+'; this._ys = performance.now(); }
      // (the highways get only their bridge parapets here)
      if ((r.cls < 2 && !r.deck) || r.cls > 7 || r.dirt || r.flags & 4 || r.pts.length < 2) continue;
      const bridge = !!(r.flags & 2), deckOnly = r.cls < 2;
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : ROAD_HALF[r.cls];
      const lift = 0.07 + (10 - r.cls) * 0.004;
      // the line, every ~3 m
      const P = [];
      for (let i = 0; i < r.pts.length; i++) {
        if (i) { const [ae, an] = r.pts[i - 1], [be, bn] = r.pts[i], k = Math.ceil(Math.hypot(be - ae, bn - an) / 3); for (let j = 1; j < k; j++) P.push([ae + (be - ae) * j / k, an + (bn - an) * j / k]); }
        P.push(r.pts[i]);
      }
      const N = P.map((_, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1; return [-dn / l, de / l, de / l, dn / l]; });
      const inTile = ([e, n]) => e > 0.5 && n > 0.5 && e < TILE - 0.5 && n < TILE - 0.5;
      // --- kerb, drain, footpath on both sides
      const striped = r.cls <= 3;
      for (const side of [1, -1]) {
        let cover = rnd() < 0.7, runLeft = 6 + rnd() * 20;
        const prof = (i) => {
          const [e, n] = P[i], [ne, nn] = N[i];
          const at = (o) => [e + ne * o * side, n + nn * o * side];
          const c0 = this.classAt(...at(hw + 1.3));
          // built-up: tagged town land, or buildings close beside the road (most of Kerala's streets are untagged)
          const town = c0 !== C.water && c0 !== C.sea && (TOWN.has(c0) || [3, 8, 14, 20].some((o) => [-5, 5].some((t) => this.classAt(at(hw + o)[0] + N[i][2] * t, at(hw + o)[1] + N[i][3] * t) === C.building)));
          const shop = town && (this.classAt(...at(hw + 2.6)) === C.building || this.classAt(...at(hw + 1.3)) === C.commercial);
          // beside a canal, backwater or river (or on a bridge): a side wall with a parapet instead
          const wet = [2.5, 5, 8].some((o) => { const c = this.classAt(...at(hw + o)); return c === C.water || c === C.sea; }), water = bridge || wet;
          const sf = this._surfAt(r, e, n);   // (the road's own surface where it has one: the kerb sits on its edge)
          let y0 = (sf > -1e9 ? sf : Math.max(this.heightAt(...at(hw)), this.heightAt(...at(hw + 0.9)))) + lift;
          if (water) y0 = Math.max(this.roadSurface(...at(hw - 0.3)), bridge ? -Infinity : y0);
          // (the median side of a dual carriageway: the median is drawn there instead)
          if (this._medianAt(...at(hw + 0.6)) > -1e9) return { at, y0, town: false, shop: false, water: false, wet: false, med: true };
          return { at, y0, town: town && !water && r.cls <= 6, shop: shop && r.cls <= 5, water, wet };
        };
        let A = prof(0);
        for (let i = 1; i < P.length; i++) {
          // (a pause every few points when it's time: one long road's two sides in one go took up to a sixth of a second)
          if ((i & 15) === 0 && this._due()) { yield 'tile:street+'; this._ys = performance.now(); }
          const B = prof(i);
          const mid = [(P[i][0] + P[i - 1][0]) / 2, (P[i][1] + P[i - 1][1]) / 2];
          if ((runLeft -= 3) < 0) { cover = !cover; runLeft = cover ? 12 + rnd() * 30 : 3 + rnd() * 8; }   // (mostly slabbed over in town)
          if (deckOnly && !(A.water && B.water)) { A = B; continue; }
          if (A.town && B.town && inTile(mid) && !nj(mid[0], mid[1]) && !nj(...A.at(hw + 0.5)) && !nj(...B.at(hw + 0.5))
            && !this.onRoad(...A.at(hw + 0.4), 0.2, ri) && !this.onRoad(...B.at(hw + 0.4), 0.2, ri)) {
            const K = kerb[chunkOf(...mid)];
            const v = (Q, o, h) => { const [e, n] = Q.at(o - 0.25); return [-e, Q.y0 + h, n]; };
            const j = 0.9 + rnd() * 0.12, seg = (i & 1) === 0;
            const conc = [0.3 * j, 0.29 * j, 0.26 * j], grime = [0.16 * j, 0.16 * j, 0.13 * j];
            const face = striped && B.shop ? (seg ? [0.62, 0.62, 0.58] : [0.025, 0.025, 0.025]) : conc;
            const edge = (o0, h0, o1, h1, c0, c1) => quad(K, v(A, o0, h0), v(A, o1, h1), v(B, o1, h1), v(B, o0, h0), c0, c1 || c0);
            edge(hw - 0.02, -0.06, hw - 0.02, 0.16, grime, face);               // kerb face
            edge(hw - 0.02, 0.16, hw + 0.2, 0.16, conc);                        // kerb top
            if (cover) edge(hw + 0.2, 0.16, hw + 0.75, 0.17, [0.24 * j, 0.235 * j, 0.21 * j]); // slabs over the drain
            else {
              edge(hw + 0.2, 0.16, hw + 0.2, -0.04, conc, [0.07, 0.08, 0.06]);  // drain: inner wall
              edge(hw + 0.2, -0.04, hw + 0.75, -0.04, [0.05, 0.06, 0.045]);       // water / silt
              edge(hw + 0.75, -0.04, hw + 0.75, 0.17, [0.07, 0.08, 0.06], conc); // outer wall
            }
            if (B.shop && A.shop) {
              edge(hw + 0.75, 0.17, hw + 2.2, 0.2, [0.26 * j, 0.25 * j, 0.22 * j]); // footpath slabs
              edge(hw + 2.2, 0.2, hw + 2.2, -0.35, conc, grime);
            } else edge(hw + 0.75, 0.17, hw + 0.95, -0.35, conc, grime);
          } else if (A.water && B.water && inTile(mid) && ![mid, A.at(hw), B.at(hw)].some((q) => nj(q[0], q[1], 4.5)) && Number.isFinite(A.y0) && Number.isFinite(B.y0)
            && [A.at(hw), B.at(hw), [(A.at(hw)[0] + B.at(hw)[0]) / 2, (A.at(hw)[1] + B.at(hw)[1]) / 2]].every((q) => !this.onRoad(q[0], q[1], 0.6, ri))) {
            // canal side / bridge: a whitewashed parapet on a granite side wall going down to the water; solid (it stops
            // short of a junction's corner: room for a car to turn)
            const K = kerb[chunkOf(...mid)];
            const v = (Q, o, h) => { const [e, n] = Q.at(o); return [-e, Q.y0 + h, n]; };
            const j = 0.9 + rnd() * 0.12, band = bridge && (i & 1) === 0;
            const white = [0.5 * j, 0.5 * j, 0.47 * j], grime = [0.2 * j, 0.21 * j, 0.18 * j], stone = [0.17 * j, 0.15 * j, 0.12 * j];
            const edge = (o0, h0, o1, h1, c0, c1) => quad(K, v(A, o0, h0), v(A, o1, h1), v(B, o1, h1), v(B, o0, h0), c0, c1 || c0);
            // (standing just off the carriageway's edge: its road face on the edge, not on the road)
            edge(hw, -0.08, hw, 0.62, grime, band ? [0.03, 0.03, 0.03] : white);                 // parapet, road face
            edge(hw, 0.62, hw + 0.28, 0.62, white);                                             // coping
            edge(hw + 0.28, 0.62, hw + 0.28, -0.1, white, grime);                               // outer face
            if (A.wet || B.wet || !bridge) edge(hw + 0.28, -0.1, hw + 0.42, -2.6, stone, [0.08, 0.09, 0.07]); // side wall down to the water
            const a = A.at(hw + 0.14), b = B.at(hw + 0.14), de = b[0] - a[0], dn = b[1] - a[1], L = Math.hypot(de, dn) || 1, ang = Math.atan2(-de / L, dn / L);
            this.colliders.push({ cx: -(this.E0 + (a[0] + b[0]) / 2), cz: this.N0 + (a[1] + b[1]) / 2, hx: 0.16, hz: Math.max(0.2, L / 2 - 0.05), cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: Math.max(A.y0, B.y0) + 0.62, kind: 'barrier' });
          } else if (!A.med && !B.med && !A.town && !B.town && !A.water && !B.water && !bridge && r.cls <= 7 && inTile(mid) && !nj(mid[0], mid[1])
            && !this.onRoad(...A.at(hw + 0.5), 0.2, ri) && !this.onRoad(...B.at(hw + 0.5), 0.2, ri)) {
            // country road: a dusty earth shoulder along the edge, easing down into a grassy verge (broken where
            // gates and lanes cross)
            const K = kerb[chunkOf(...mid)];
            const v = (Q, o, h) => { const [e, n] = Q.at(o); return [-e, Q.y0 + h, n]; };
            const j = 0.9 + rnd() * 0.12, grav = [0.17 * j, 0.125 * j, 0.085 * j], gravD = [0.14 * j, 0.11 * j, 0.08 * j], grass = [0.11 * j, 0.15 * j, 0.06 * j];   // (dusty laterite, as the tar's edge breaks into the verge)
            const edge = (o0, h0, o1, h1, c0, c1) => quad(K, v(A, o0, h0), v(A, o1, h1), v(B, o1, h1), v(B, o0, h0), c0, c1 || c0);
            edge(hw - 0.06, -0.02, hw + 0.7, -0.05, gravD, grav);                // earth shoulder
            edge(hw + 0.7, -0.05, hw + 1.25, -0.22, grav, grass);                // down into the grass verge
            // up in the hills, above a drop: a guard post every ~6 m, banded black and white
            if ((i & 1) === 0 && A.y0 > 150 && this.heightAt(...A.at(hw + 3.5)) < A.y0 - 1.6) {
              const [pe, pn] = A.at(hw + 0.95), y = A.y0 - 0.1, w = 0.08, bands = [[0, 0.2, 1], [0.2, 0.4, 0], [0.4, 0.6, 1], [0.6, 0.8, 0]];
              for (const [h0, h1, wh] of bands) {
                const c = wh ? [0.62, 0.62, 0.6] : [0.03, 0.03, 0.03];
                for (const [a, b] of [[[-w, -w], [w, -w]], [[w, -w], [w, w]], [[w, w], [-w, w]], [[-w, w], [-w, -w]]])
                  quad(K, [-(pe + a[0]), y + h0, pn + a[1]], [-(pe + a[0]), y + h1, pn + a[1]], [-(pe + b[0]), y + h1, pn + b[1]], [-(pe + b[0]), y + h0, pn + b[1]], c);
              }
              quad(K, [-(pe - w), y + 0.8, pn - w], [-(pe - w), y + 0.8, pn + w], [-(pe + w), y + 0.8, pn + w], [-(pe + w), y + 0.8, pn - w], [0.62, 0.62, 0.6]);
            }
          }
          A = B;
        }
      }
      if (bridge || deckOnly || r.cls > 6) continue;
      // --- zebra crossings just short of the busy junctions (main roads in town)
      if (r.cls <= 4) for (const J of this._junctions || []) {
        if (J.c < 3) continue;
        const i = r.pts.findIndex(([e, n]) => Math.abs(e - J.e) < 1 && Math.abs(n - J.n) < 1);
        if (i < 0) continue;
        for (const dir of [-1, 1]) {
          const k = i + dir;
          if (k < 0 || k >= r.pts.length || rnd() < 0.35) continue;
          const [je, jn] = r.pts[i], [ke, kn] = r.pts[k], L = Math.hypot(ke - je, kn - jn);
          const D = J.r + 2.2;
          if (L < D + 3) continue;
          const ue = (ke - je) / L, un = (kn - jn) / L, ce = je + ue * D, cn = jn + un * D;
          if (!inTile([ce, cn]) || !builtUp(ce, cn, -un, ue, hw)) continue;
          const y = (e, n) => this.heightAt(e, n) + lift + 0.012;
          for (let o = -hw + 0.6; o <= hw - 0.5; o += 1.1) {
            const se = ce - un * o, sn = cn + ue * o;
            const g = this._ribbon([[se - ue * 1.6, sn - un * 1.6], [se + ue * 1.6, sn + un * 1.6]], 0.28, y, 1e9);
            if (g) { fastNormals(g); zebra.push(g); }
          }
          (this.crossings || (this.crossings = [])).push({ x: -(this.E0 + ce), z: this.N0 + cn, fx: -ue, fz: un, hw });
        }
      }
      // --- speed breakers in town, and manholes
      let acc = 60 + rnd() * 250, accM = 20 + rnd() * 80;
      for (let i = 1; i < r.pts.length; i++) {
        const [ae, an] = r.pts[i - 1], [be, bn] = r.pts[i], L = Math.hypot(be - ae, bn - an);
        if (L < 0.01) continue;
        const ue = (be - ae) / L, un = (bn - an) / L;
        for (; accM < L; accM += 50 + rnd() * 90) {
          const o = (rnd() < 0.5 ? -1 : 1) * hw * (0.25 + rnd() * 0.3), e = ae + ue * accM - un * o, n = an + un * accM + ue * o;
          if (inTile([e, n]) && builtUp(e, n, -un, ue, hw)) holes.push([-e, this.heightAt(e, n) + lift + 0.008, n, rnd() * 6]);
        }
        accM -= L;
        if (r.cls < 3) continue;
        for (; acc < L; acc += 180 + rnd() * 320) {
          const e = ae + ue * acc, n = an + un * acc;
          if (!inTile([e, n]) || nj(e, n) || !builtUp(e, n, -un, ue, hw)) continue;
          bumps.push(this._breaker(e, n, ue, un, hw, lift));
          this.bumps.push({ x: -(this.E0 + e), z: this.N0 + n, fx: -ue, fz: un, hw });
        }
        acc -= L;
      }
    }
    // --- canals and streams: laterite-and-granite walls down from each bank into the water, a coping along the top,
    // a muddy bed; closed off where a road crosses (the culvert)
    yield 'street:canals';
    for (const c of this._canals()) {
      if (this._due()) { yield 'street:canals+'; this._ys = performance.now(); }
      const P = c.run, hw = c.hw + 0.3, stone = [0.33, 0.29, 0.24], cope = [0.55, 0.53, 0.49], mud = [0.08, 0.07, 0.05];
      const nrm = (i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1; return [-dn / l, de / l]; };
      const at = (i, sd, o) => { const [ne, nn] = nrm(i); return [P[i][0] + ne * o * sd, P[i][1] + nn * o * sd]; };
      const V = ([e, n], y) => [-e, y, n];
      for (let i = 1; i < P.length; i++) {
        const mid = [(P[i][0] + P[i - 1][0]) / 2, (P[i][1] + P[i - 1][1]) / 2];
        if (!inTileM(mid)) continue;
        const K = kerb[chunkOf(...mid)], wa = this._wwY(...P[i - 1], c.kind), wb = this._wwY(...P[i], c.kind);
        for (const sd of [1, -1]) {
          const A = at(i - 1, sd, hw), B = at(i, sd, hw), A2 = at(i - 1, sd, hw + 0.35), B2 = at(i, sd, hw + 0.35);
          const ta = Math.max(this.heightAt(...A2), wa + 0.4) + 0.12, tb = Math.max(this.heightAt(...B2), wb + 0.4) + 0.12;
          quad(K, V(A, wa - 0.95), V(A, ta), V(B, tb), V(B, wb - 0.95), [0.2, 0.18, 0.15], stone);   // the wall
          quad(K, V(B, wb - 0.95), V(B, tb), V(A, ta), V(A, wa - 0.95), [0.2, 0.18, 0.15], stone);   // (both faces)
          quad(K, V(A, ta), V(A2, ta), V(B2, tb), V(B, tb), cope);                                    // coping
          quad(K, V(B, tb), V(B2, tb), V(A2, ta), V(A, ta), cope);
        }
        const L0 = at(i - 1, 1, hw), L1 = at(i, 1, hw), R0 = at(i - 1, -1, hw), R1 = at(i, -1, hw);
        quad(K, V(L0, wa - 0.9), V(R0, wa - 0.9), V(R1, wb - 0.9), V(L1, wb - 0.9), mud);             // the bed
        quad(K, V(L1, wb - 0.9), V(R1, wb - 0.9), V(R0, wa - 0.9), V(L0, wa - 0.9), mud);
      }
      // the ends (at a road: the culvert's headwall)
      for (const i of [0, P.length - 1]) {
        if (!inTileM(P[i])) continue;
        const K = kerb[chunkOf(...P[i])], w = this._wwY(...P[i], c.kind), L = at(i, 1, hw), R = at(i, -1, hw), t = Math.max(this.heightAt(...P[i]), w + 0.4) + 0.12;
        quad(K, V(L, w - 0.95), V(L, t), V(R, t), V(R, w - 0.95), stone); quad(K, V(R, w - 0.95), V(R, t), V(L, t), V(L, w - 0.95), stone);
      }
    }
    // --- the narrow water areas: a stone wall down from the bank all round (open where a road crosses), a muddy bed
    for (const P of this._wpolys || []) {
      if (this._due()) { yield 'street:pools+'; this._ys = performance.now(); }
      const stone = [0.33, 0.29, 0.24], cope = [0.55, 0.53, 0.49], mud = [0.08, 0.07, 0.05], V = ([e, n], y) => [-e, y, n];
      for (const R of [P.ring, ...P.holes]) for (let i = 0; i < R.length; i++) {
        const a = R[i], b = R[(i + 1) % R.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue;
        const k = Math.max(1, Math.ceil(L / 4));
        for (let q = 0; q < k; q++) {
          const A = [a[0] + (b[0] - a[0]) * q / k, a[1] + (b[1] - a[1]) * q / k], B = [a[0] + (b[0] - a[0]) * (q + 1) / k, a[1] + (b[1] - a[1]) * (q + 1) / k];
          const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
          if (!inTileM(mid) || this.onRoad(mid[0], mid[1], 1.2)) continue;
          // (open water on both sides: a channel mapped inside a wider river or backwater, no wall in the middle of it)
          const ux = (B[1] - A[1]) / (L / k), uz = -(B[0] - A[0]) / (L / k), wtr = (o) => { const c = this.classAt(mid[0] + ux * o, mid[1] + uz * o); return c === C.water || c === C.sea; };
          if (wtr(8) && wtr(-8)) continue;
          const K = kerb[chunkOf(...mid)], ta = Math.max(this.heightAt(...A), P.y + 0.4) + 0.12, tb = Math.max(this.heightAt(...B), P.y + 0.4) + 0.12;
          quad(K, V(A, P.y - 0.95), V(A, ta), V(B, tb), V(B, P.y - 0.95), [0.2, 0.18, 0.15], stone);
          quad(K, V(B, P.y - 0.95), V(B, tb), V(A, ta), V(A, P.y - 0.95), [0.2, 0.18, 0.15], stone);
          quad(K, V(A, ta), V(A, ta + 0.04), V(B, tb + 0.04), V(B, tb), cope);
        }
      }
      // the bed: the outline triangulated, 0.9 m under the water
      const tris = THREE.ShapeUtils.triangulateShape(P.ring.map(([e, n]) => new THREE.Vector2(e, n)), P.holes.map((h) => h.map(([e, n]) => new THREE.Vector2(e, n))));
      const all = [P.ring, ...P.holes].flat(), c0 = [(P.box[0] + P.box[2]) / 2, (P.box[1] + P.box[3]) / 2];
      if (!inTileM(c0)) continue;
      const K = kerb[chunkOf(...c0)];
      for (const [i0, i1, i2] of tris) { for (const ii of [i0, i2, i1, i0, i1, i2]) { K.p.push(...V(all[ii], P.y - 0.9)); K.c.push(...mud); } }
    }
    // --- dual carriageway medians: a kerb painted in black and yellow bands each side, soil on top
    for (const m of this._medians()) {
      if (m.fill) continue;   // (paved: drawn with the roads)
      const mid = [m.e + m.ne * m.w / 2, m.n + m.nn * m.w / 2];
      if (!inTileM(mid)) continue;
      const K = kerb[chunkOf(...mid)], h = 0.22;
      const P = (s2, x, dy) => { const e = m.e + m.ue * s2 + m.ne * x, n = m.n + m.un * s2 + m.nn * x, u = Math.max(0, Math.min(1, x / m.w)); return [-e, m.y0 + (m.y1 - m.y0) * u + 0.07 + dy, n]; };
      const band = ((m.i * 7 + Math.floor(m.a / 4)) & 1) ? [0.55, 0.45, 0.06] : [0.04, 0.04, 0.04];
      const soil = [0.17, 0.13, 0.08], grass = [0.11, 0.17, 0.06];
      const s0 = -2.05, s1 = 2.05, w = m.w;
      quad(K, P(s0, 0, -0.08), P(s0, 0, h), P(s1, 0, h), P(s1, 0, -0.08), band);                 // kerb face, this side
      quad(K, P(s1, w, -0.08), P(s1, w, h), P(s0, w, h), P(s0, w, -0.08), band);                 // and the other
      const kw = Math.min(0.3, w / 4);
      // (the across direction is to either side of the road: face the tops up whichever way it runs)
      const up = (a, b2, c, d, c1, c2) => { const A = P(...a), B = P(...b2), D = P(...d), cr = (B[0] - A[0]) * (D[2] - A[2]) - (B[2] - A[2]) * (D[0] - A[0]);
        if (cr < 0) quad(K, A, B, P(...c), D, c1, c2); else quad(K, B, A, D, P(...c), c2, c1); };
      up([s0, 0, h], [s0, kw, h], [s1, kw, h], [s1, 0, h], band, band);                       // kerb tops, painted
      up([s0, w - kw, h], [s0, w, h], [s1, w, h], [s1, w - kw, h], band, band);
      up([s0, kw, h - 0.02], [s0, w - kw, h - 0.02], [s1, w - kw, h - 0.02], [s1, kw, h - 0.02], soil, grass); // soil and grass between
    }
    // --- roundabouts: the island in the middle (OSM maps the ring in pieces, flag 8): a kerb painted in black and
    // white bands, grass on top, and on the bigger ones a clock tower; solid to cars
    {
      for (const { ce, cn, rin, grp } of this._islands()) {
        if (!(ce > 0.5 && cn > 0.5 && ce < TILE - 0.5 && cn < TILE - 0.5)) continue;   // (its own tile draws it)
        let ysum = 0, yn = 0;
        for (const [e, n, r] of grp) { const y = this._surfAt(r, e, n); if (y > -1e9) { ysum += y; yn++; } }
        const y0 = (yn ? ysum / yn : this.heightAt(ce, cn)) + 0.08, top = y0 + 0.3, K = kerb[chunkOf(ce, cn)], N = Math.max(16, Math.round(rin * 2.5));
        const at = (a, rr, h) => [-(ce + Math.cos(a) * rr), h, cn + Math.sin(a) * rr];
        const grass = [0.1, 0.19, 0.06], soil = [0.12, 0.09, 0.06];
        for (let k = 0; k < N; k++) {
          const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2, band = (k & 1) ? [0.62, 0.62, 0.58] : [0.04, 0.04, 0.04];
          quad(K, at(a0, rin, y0 - 0.8), at(a0, rin, top), at(a1, rin, top), at(a1, rin, y0 - 0.8), band);          // kerb face
          quad(K, at(a0, rin, top), at(a0, rin - 0.3, top), at(a1, rin - 0.3, top), at(a1, rin, top), band);        // kerb top
          quad(K, at(a0, rin - 0.3, top), at(a0, 0, top + 0.05), at(a1, 0, top + 0.05), at(a1, rin - 0.3, top), grass, soil); // lawn
        }
        // a clock tower on the bigger islands (the town's landmark), a short pillar on the small ones
        const box = (x0, x1, y1, y2, col) => {
          const c = [[-x0, -x0], [x0, -x0], [x0, x0], [-x0, x0]];
          for (let q = 0; q < 4; q++) { const [ax, az] = c[q], [bx, bz] = c[(q + 1) % 4], s1 = x1 / x0; quad(K, [-(ce + ax), y1, cn + az], [-(ce + ax * s1), y2, cn + az * s1], [-(ce + bx * s1), y2, cn + bz * s1], [-(ce + bx), y1, cn + bz], col); }
          quad(K, [-(ce - x1), y2, cn - x1], [-(ce + x1), y2, cn - x1], [-(ce + x1), y2, cn + x1], [-(ce - x1), y2, cn + x1], col);
        };
        if (rin >= 7) {
          const cream = [0.68, 0.64, 0.55], face = [0.85, 0.84, 0.78], roof = [0.45, 0.18, 0.1];
          box(1.6, 1.6, top, top + 0.6, [0.45, 0.43, 0.4]); box(1.0, 0.85, top + 0.6, top + 7, cream); box(1.05, 1.05, top + 7, top + 8.4, face); box(1.15, 0.05, top + 8.4, top + 9.6, roof);
        } else box(0.5, 0.35, top, top + 2.2, [0.68, 0.64, 0.55]);
        // solid: an octagon of two crossed boxes inside the kerb
        for (const ang of [0, Math.PI / 4]) this.colliders.push({ cx: -(this.E0 + ce), cz: this.N0 + cn, hx: rin * 0.86, hz: rin * 0.86, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: top, kind: 'barrier' });
        (this.roundabouts ||= []).push({ x: -(this.E0 + ce), z: this.N0 + cn, r: rin });
      }
    }
    yield 'street:mesh';
    // bump lookup grid (50 m cells, game coords)
    this._bg = new Map();
    for (const b of this.bumps) {
      const R = Math.ceil((b.hw + 1) / 50);
      for (let a = -R; a <= R; a++) for (let c = -R; c <= R; c++) { const k = (Math.floor(b.x / 50) + a) * 100003 + Math.floor(b.z / 50) + c; if (!this._bg.has(k)) this._bg.set(k, []); this._bg.get(k).push(b); }
    }
    const out = [];
    for (let c = 0; c < kerb.length; c++) {
      const K = kerb[c];
      if (!K.p.length) continue;
      if (this._due()) { yield 'street:mesh+'; this._ys = performance.now(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(K.p, 3));
      g.setAttribute('color', byteColors(K.c, 3));
      fastNormals(g);
      const m = new THREE.Mesh(g, M.klKerb); m.name = 'kerbs'; m.receiveShadow = true;
      m.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250]; m.userData.far = 450;
      out.push(m);
    }
    yield 'street:marks';
    if (zebra.length) { const m = new THREE.Mesh(mergeGeometries(zebra), M.klLineWhite); m.name = 'lines'; out.push(m); }
    if (bumps.length) { const m = new THREE.Mesh(mergeGeometries(bumps), M.klKerb); m.name = 'lines'; m.receiveShadow = true; out.push(m); }
    if (holes.length && opts.manholeGeo) {
      const im = new THREE.InstancedMesh(opts.manholeGeo, M.klManhole, holes.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      holes.forEach(([x, y, z, a], i) => im.setMatrixAt(i, m4.compose(v.set(x, y, z), q.setFromAxisAngle(up, a), one)));
      im.computeBoundingSphere(); im.name = 'lines'; out.push(im);
    }
    return out;
  }

  // a hump across the road, painted in yellow and black bands (~0.1 m high, ~1 m long)
  _breaker(e, n, ue, un, hw, lift) {
    const p = [], c = [], prof = [-0.5, -0.3, -0.12, 0.12, 0.3, 0.5].map((d) => [d, 0.1 * Math.cos(Math.PI * d) ** 2]);
    const bands = Math.max(4, Math.round(hw * 2 / 0.6));
    for (let b = 0; b < bands; b++) {
      const o0 = -hw + (2 * hw * b) / bands, o1 = -hw + (2 * hw * (b + 1)) / bands, col = b & 1 ? [0.02, 0.02, 0.02] : [0.7, 0.42, 0.02];
      for (let k = 0; k < prof.length - 1; k++) {
        const V = (o, [d, h]) => { const pe = e + ue * d - un * o, pn = n + un * d + ue * o; return [-pe, this.heightAt(pe, pn) + lift + h + 0.01, pn]; };
        const a = V(o0, prof[k]), bb = V(o1, prof[k]), cc = V(o1, prof[k + 1]), d = V(o0, prof[k + 1]);
        p.push(...a, ...cc, ...bb, ...a, ...d, ...cc);
        for (let q = 0; q < 6; q++) c.push(...col);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    fastNormals(g);
    if (g.attributes.normal.getY(0) < 0) { const P = g.attributes.position.array; for (let i = 0; i < P.length; i += 9) for (let q = 0; q < 3; q++) { const t = P[i + 3 + q]; P[i + 3 + q] = P[i + 6 + q]; P[i + 6 + q] = t; } fastNormals(g); }
    return g;
  }

  // extra ground height (game coords) from a speed breaker under (x, z)
  bumpAt(x, z) {
    const L = this._bg?.get(Math.floor(x / 50) * 100003 + Math.floor(z / 50));
    if (!L) return 0;
    for (const b of L) {
      const dx = x - b.x, dz = z - b.z, a = dx * b.fx + dz * b.fz;
      if (Math.abs(a) < 0.5 && Math.abs(dx * b.fz - dz * b.fx) < b.hw) return 0.1 * Math.cos(Math.PI * a) ** 2;
    }
    return 0;
  }

  // distance to the next breaker ahead along (fx, fz) within range, or -1
  bumpAhead(x, z, fx, fz, range) {
    let best = -1;
    for (const k of [0, 1]) {
      const L = this._bg?.get(Math.floor((x + fx * range * k) / 50) * 100003 + Math.floor((z + fz * range * k) / 50));
      if (!L) continue;
      for (const b of L) {
        const dx = b.x - x, dz = b.z - z, a = dx * fx + dz * fz;
        if (a > -0.5 && a < range && Math.abs(dx * fz - dz * fx) < b.hw && Math.abs(fx * b.fx + fz * b.fz) > 0.7 && (best < 0 || a < best)) best = Math.max(0, a);
      }
    }
    return best;
  }

  // KSEB electric poles along the town roads, ~38 m apart on one side, strung with sagging wires
  _poles(M, opts) {
    if (!opts.poleGeo) return [];
    let s = (this.tx * 7919 ^ this.tz * 104729) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const mats = [], lamps = [], trafos = [], wire = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const SP = 38;
    for (const r of this.roads) {
      if (r.cls < 2 || r.cls > 7 || r.dirt || r.flags & 4 || r.pts.length < 2) continue;
      const side = rnd() < 0.5 ? 1 : -1, off = ROAD_HALF[r.cls] + 1.3;
      let prev = null, acc = SP * rnd();
      for (let i = 1; i < r.pts.length; i++) {
        const [ae, an] = r.pts[i - 1], [be, bn] = r.pts[i], L = Math.hypot(be - ae, bn - an);
        if (L < 0.01) continue;
        const ue = (be - ae) / L, un = (bn - an) / L;
        for (; acc < L; acc += SP) {
          const e = ae + ue * acc - un * off * side, n = an + un * acc + ue * off * side;
          const c = this.classAt(e, n);
          if (e < 1 || n < 1 || e > TILE - 1 || n > TILE - 1 || c === C.water || c === C.sea || c === C.building || this.nearRoad(e, n, Math.min(4.5, off - 0.4)) || this.onRoad(e, n, 0.4) || this._nearJunction?.(e, n, 2.5, 3)) { prev = null; continue; }
          // crossarm across the road: local x -> the road's normal in game space
          const nx = un * side, nz = ue * side, th = Math.atan2(-nz, nx), y = this.heightAt(e, n);
          q.setFromAxisAngle(up, th + (rnd() - 0.5) * 0.08);
          const ch = Math.min(3, Math.floor(e / 500)) + 4 * Math.min(3, Math.floor(n / 500));
          mats.push([m4.compose(v.set(-e, y - 0.05, n), q, one).clone(), ch]);
          // built-up stretches: a streetlight on most poles, now and then a transformer on a two-pole platform
          const town = [[8, 0], [-8, 0], [0, 8], [0, -8], [14, 0], [-14, 0], [0, 14], [0, -14]].some(([a, b]) => { const c2 = this.classAt(e + a, n + b); return c2 === C.building || c2 === C.commercial || c2 === C.town; });
          // streetlights: most poles in town and along the main roads, many on residential streets (KSEB fits a
          // lamp on the poles in front of houses), a few out in the country
          const homes = !town && [[20, 0], [-20, 0], [0, 20], [0, -20], [30, 10], [-30, -10]].some(([a, b]) => this.classAt(e + a, n + b) === C.building);
          if (rnd() < (town ? 0.95 : r.cls <= 4 ? 0.85 : homes ? 0.75 : 0.2)) {
            lamps.push([mats[mats.length - 1][0], ch]);
            const M4 = mats[mats.length - 1][0], hp = new THREE.Vector3(-2.15, 7.1, 0).applyMatrix4(M4);
            (this.lampHeads ||= []).push(hp.x - this.E0, hp.y, hp.z + this.N0);
          }
          else if (rnd() < (town ? 0.25 : 0.05) && r.cls <= 6 && !this.onRoad(e + ue * 2.2, n + un * 2.2, 0.4)) {
            trafos.push([mats[mats.length - 1][0], ch]);
            const de = ue * 2.2, dn = un * 2.2; // the second pole stands 2.2 m along the road
            this.colliders.push({ cx: -(this.E0 + e + de), cz: this.N0 + n + dn, hx: 0.18, hz: 0.18, cos: 1, sin: 0, angle: 0, h: y + 9, kind: 'pole' });
          }
          this.colliders.push({ cx: -(this.E0 + e), cz: this.N0 + n, hx: 0.18, hz: 0.18, cos: 1, sin: 0, angle: 0, h: y + 9, kind: 'pole' });
          const tops = [[-0.7, 8.05], [0.7, 8.05], [0, 8.75]].map(([dx, dy]) => [-e + Math.cos(th) * dx, y + dy, n - Math.sin(th) * dx]);
          if (prev && Math.hypot(tops[0][0] - prev[0][0], tops[0][2] - prev[0][2]) < SP * 1.6) {
            for (let k = 0; k < 3; k++) {
              const A = prev[k], B = tops[k], sag = 0.55 + k * 0.1;
              for (let t = 0; t < 4; t++) {
                const t0 = t / 4, t1 = (t + 1) / 4, s0 = 4 * t0 * (1 - t0) * sag, s1 = 4 * t1 * (1 - t1) * sag;
                (wire[ch] || (wire[ch] = [])).push(A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0 - s0, A[2] + (B[2] - A[2]) * t0,
                  A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1 - s1, A[2] + (B[2] - A[2]) * t1);
              }
            }
          }
          prev = tops;
        }
        acc -= L;
      }
    }
    // one instanced mesh and one wire set per 500 m chunk, drawn near the camera only
    const out = [];
    for (let c = 0; c < 16; c++) {
      const L = mats.filter((m) => m[1] === c), cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250];
      if (L.length) {
        const im = new THREE.InstancedMesh(opts.poleGeo, M.klPole, L.length);
        L.forEach(([m], i) => im.setMatrixAt(i, m));
        im.computeBoundingSphere(); im.name = 'poles'; im.castShadow = !!opts.shadows; im.userData.cc = cc;
        out.push(im);
      }
      for (const [list, geo, mat, name] of [[lamps, opts.lampGeo, M.klPole, 'lampArms'], [lamps, opts.lampHeadGeo, M.klLamp, 'lampHeads'], [lamps, opts.lampPoolGeo, M.klLampPool, 'lampPools'], [trafos, opts.trafoGeo, M.klStop, 'transformers']]) {
        if (!geo || !mat) continue;
        const L2 = list.filter((m) => m[1] === c);
        if (!L2.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, L2.length);
        L2.forEach(([m], i) => im.setMatrixAt(i, m));
        im.computeBoundingSphere(); im.name = name; im.userData.cc = cc; im.castShadow = name === 'transformers' && !!opts.shadows;
        if (name === 'lampPools') { im.renderOrder = 2; im.userData.night = true; }
        out.push(im);
      }
      if (wire[c]) {
        const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire[c], 3));
        const w = new THREE.LineSegments(wg, M.klWire); w.name = 'wires'; w.userData.cc = cc; out.push(w);
      }
    }
    return out;
  }

  // a line offset sideways from the centre: solid (dash = 0) or dashed (dash m on, gap m off)
  _dashes(pts, off, hw, dash, gap, yOf) {
    const P = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1;
      P.push([pts[i][0] - dn / l * off, pts[i][1] + de / l * off]);
    }
    // split into the runs clear of junctions (sampled every 1.5 m)
    if (this._nearJunction) {
      const runs = []; let cur = [];
      for (let i = 0; i < P.length; i++) {
        if (i) {
          const [ae, an] = P[i - 1], [be, bn] = P[i], k = Math.max(1, Math.ceil(Math.hypot(be - ae, bn - an) / 1.5));
          for (let j = 1; j < k; j++) { const q = [ae + (be - ae) * j / k, an + (bn - an) * j / k]; if (this._nearJunction(q[0], q[1])) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(q); }
        }
        if (this._nearJunction(P[i][0], P[i][1])) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(P[i]);
      }
      if (cur.length > 1) runs.push(cur);
      if (runs.length !== 1 || runs[0].length !== P.length) {
        const nj = this._nearJunction; this._nearJunction = null;
        const parts = runs.map((r) => this._dashes(r, 0, hw, dash, gap, yOf)).filter(Boolean);
        this._nearJunction = nj;
        return parts.length ? mergeGeometries(parts) : null;
      }
    }
    if (!dash) return (() => { const g = this._ribbon(P, hw, yOf, 1e9); if (g) fastNormals(g); return g; })();
    const geos = [];
    let acc = 0, on = true, seg = [P[0]];
    for (let i = 1; i < P.length; i++) {
      let [ae, an] = P[i - 1];
      const [be, bn] = P[i];
      let L = Math.hypot(be - ae, bn - an);
      while (L > 0) {
        const left = (on ? dash : gap) - acc, step = Math.min(left, L);
        const t = step / L, me = ae + (be - ae) * t, mn = an + (bn - an) * t;
        if (on) seg.push([me, mn]);
        acc += step; L -= step; ae = me; an = mn;
        if (acc >= (on ? dash : gap) - 1e-6) {
          if (on && seg.length > 1) { const g = this._ribbon(seg, hw, yOf, 1e9); if (g) { fastNormals(g); geos.push(g); } }
          on = !on; acc = 0; seg = [[ae, an]];
        }
      }
    }
    if (!geos.length) return null;
    return mergeGeometries(geos);
  }

  // ------------------------------------------------------------------------------------------ buildings
  // Footprints extruded to their height. Houses get Mangalore-tile hip roofs (terracotta), bigger buildings
  // flat concrete terraces; walls use the facade textures, painted in the colours Kerala houses come in.
  // distance test to the tile's roads up to class maxCls (grid of segments, built on first use)
  // Dual carriageways: OSM draws each half as its own one-way road, a few metres apart. Between them is the median:
  // a low concrete kerb with soil on top, level with the road, not the ground (each half's shoulder sloped down into
  // the gap and left a trench a wheel dropped into). Samples every 4 m along the lower-numbered half, across the gap
  // to the other: { e, n (on this half's edge), ne, nn (unit, across), ue, un (along), w (gap width), y0, y1 (the two
  // road edges' heights) }. Not at junctions or where another road crosses the gap (an opening there).
  _medians() {
    if (this._med) return this._med;
    const out = this._med = [];
    if (!this._rg) this.nearRoad(0, 0, 1);
    const hwOf = (r) => (r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : ROAD_HALF[r.cls]);
    const nj = this._nearJunction || (() => false);
    // the road (index) whose strip covers (e, n), besides ri, and its direction there
    const roadAt = (e, n, ri) => {
      const L = this._rg.get(Math.floor(e / 25) * 1000 + Math.floor(n / 25)); if (!L) return null;
      for (let j = 0; j < L.length; j += 6) {
        const oi = L[j + 5]; if (oi === ri) continue;
        const o = this.roads[oi]; if (o.flags & 4 || o.cls > 8) continue;
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < hwOf(o) ** 2) { const l = Math.sqrt(l2); return { oi, o, ux: dx / l, uz: dz / l }; }
      }
      return null;
    };
    this.roads.forEach((r, ri) => {
      if (!(r.flags & 1) || r.flags & 4 || r.cls > 3 || r.pts.length < 2) return;
      const hw = hwOf(r);
      for (let i = 1; i < r.pts.length; i++) {
        const [ae, an] = r.pts[i - 1], [be, bn] = r.pts[i], L = Math.hypot(be - ae, bn - an); if (L < 1) continue;
        const ue = (be - ae) / L, un = (bn - an) / L;
        for (let a = 2; a < L; a += 4) {
          const e = ae + ue * a, n = an + un * a;
          const atJ = nj(e, n);   // (by a junction: the gap is paved, not a median)
          for (const sd of [1, -1]) {
            const ne = -un * sd, nn = ue * sd;
            let hit = null, g = 0;
            for (g = 0.25; g <= 8; g += 0.25) { hit = roadAt(e + ne * (hw + g), n + nn * (hw + g), ri); if (hit) break; }
            // the other half: one-way, alongside (not a road crossing the gap), and drawn once (by the lower index)
            if (!hit || g < 0.5 || !(hit.o.flags & 1) || hit.o.cls > 3 || Math.abs(hit.ux * ue + hit.uz * un) < 0.9 || hit.oi < ri) continue;
            const pe = e + ne * hw, pn = n + nn * hw, qe = pe + ne * g, qn = pn + nn * g;
            const fill = atJ || nj(qe, qn) || nj(pe + ne * g / 2, pn + nn * g / 2);
            const y0 = this._surfAt(r, e, n), y1 = this._surfAt(hit.o, qe + ne * 0.5, qn + nn * 0.5);
            if (!(y0 > -1e9) || !(y1 > -1e9) || Math.abs(y0 - y1) > 0.6) continue;
            out.push({ e: pe, n: pn, ne, nn, ue, un, w: g, y0, y1, ri, i, a, fill, cls: r.cls });
          }
        }
      }
    });
    // lookup grid (10 m cells)
    this._medG = new Map();
    out.forEach((m, k) => { const c = Math.floor(m.e / 10) * 1000 + Math.floor(m.n / 10); if (!this._medG.has(c)) this._medG.set(c, []); this._medG.get(c).push(k); });
    return out;
  }

  // the median's surface at (e, n) (a kerb 0.15 m high, eased up over its first 0.3 m so a wheel rolls over it), or
  // -Infinity outside every median
  _medianAt(e, n) {
    if (!this._medG) return -Infinity;
    let best = -Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._medG.get((Math.floor(e / 10) + a) * 1000 + Math.floor(n / 10) + b); if (!L) continue;
      for (const k of L) {
        const m = this._med[k], de = e - m.e, dn = n - m.n, along = de * m.ue + dn * m.un, across = de * m.ne + dn * m.nn;
        if (Math.abs(along) > 2.05 || across < -0.05 || across > m.w + 0.05) continue;
        const u = Math.max(0, Math.min(1, across / m.w)), y = m.y0 + (m.y1 - m.y0) * u;
        const ramp = m.fill ? 0 : Math.min(1, Math.max(0, Math.min(across, m.w - across) / 0.3));
        best = Math.max(best, y + 0.07 + (m.fill ? (10 - m.cls) * 0.004 - 0.005 : 0.15 * ramp));
      }
    }
    return best;
  }

  nearRoad(e, n, dist, maxCls = 10) {
    if (!this._rg) {
      const RG = this._rg = new Map(), G = 25;
      this.roads.forEach((r, ri) => { for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++)
          for (let gz = Math.floor(Math.min(a[1], b[1]) / G); gz <= Math.floor(Math.max(a[1], b[1]) / G); gz++) {
            const k = gx * 1000 + gz; if (!RG.has(k)) RG.set(k, []); RG.get(k).push(a[0], a[1], b[0], b[1], r.cls, ri);
          }
      } });
    }
    const G = 25, R = Math.ceil(dist / G);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        if (L[j + 4] > maxCls) continue;
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < dist * dist) return true;
      }
    }
    return false;
  }

  // Nothing solid stands in a lane: a collider whose box reaches 0.5 m onto a carriageway (map outlines and our road
  // widths don't always agree) is removed, so the worst case is driving through the edge of a wall, never an invisible
  // wall in the road. Returns the colliders kept (filters the array in place).
  // clearRoads, a few milliseconds at a time (a tile has thousands of colliders)
  *_clearRoadsSteps(list) {
    const keep = [];
    for (let i = 0; i < list.length; i++) {
      if ((i & 63) === 63 && this._due()) { yield 'tile:clear+'; this._ys = performance.now(); }
      if (!this._onRoadBox(list[i])) keep.push(list[i]);
    }
    this.removedColliders = list.length - keep.length;
    list.length = 0; list.push(...keep);
    return list;
  }

  _onRoadBox(c) {
    for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
      const lx = c.hx * a, lz = c.hz * b, x = c.cx + lx * c.cos + lz * c.sin, z = c.cz - lx * c.sin + lz * c.cos;
      if (this.onRoad(-x - this.E0, z - this.N0, -0.5, -1, 6)) return true;
    }
    return false;
  }

  clearRoads(list) {
    const keep = list.filter((c) => {
      for (let a = -1; a <= 1; a += 0.5) for (let b = -1; b <= 1; b += 0.5) {
        const lx = c.hx * a, lz = c.hz * b, x = c.cx + lx * c.cos + lz * c.sin, z = c.cz - lx * c.sin + lz * c.cos;
        if (this.onRoad(-x - this.E0, z - this.N0, -0.5, -1, 6)) return false;
      }
      return true;
    });
    this.removedColliders = list.length - keep.length;
    list.length = 0; list.push(...keep);
    return list;
  }

  // the bridge deck (or ramp) of road r at (e, n): its profile at the nearest point of its line, or -Infinity when
  // (e, n) is beyond the deck's edge
  _deckAt(r, e, n) { return r.deck ? this._profileAt(r.deck, e, n, 0.5) : -Infinity; }

  // the road's own surface height at (e, n) (its graded profile), or -Infinity when not on it
  _surfAt(r, e, n) { return r.surf ? this._profileAt(r.surf, e, n, 3) : -Infinity; }

  // a road's strip exactly as drawn at (e, n), or -Infinity off it: each row is a straight line across the road from
  // its left edge's height to its right's, the rows joined by flat pieces. (Its centre-line profile is not what is
  // drawn: an edge tucked under another road at a junction tilts the strip, and cars rode up to 0.7 m above it.)
  _drawnAt(r, e, n, margin = 0) {
    const D = r.drawn; if (!D) return -Infinity;
    const R = D.rows, m = R.length / 6;
    if (!D.grid) {
      D.grid = new Map();
      for (let i = 0; i < m; i++) { const k = Math.floor(R[i * 6] / 8) * 100000 + Math.floor(R[i * 6 + 1] / 8); if (!D.grid.has(k)) D.grid.set(k, []); D.grid.get(k).push(i); }
    }
    const ge = Math.floor(e / 8), gn = Math.floor(n / 8);
    let bd = Infinity, by = -Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const L = D.grid.get((ge + a) * 100000 + gn + b); if (!L) continue;
      for (const i of L) {
        if (i === 0) continue;
        const j = (i - 1) * 6, k = i * 6, ae = R[j], an = R[j + 1], de = R[k] - ae, dn = R[k + 1] - an, l2 = de * de + dn * dn || 1;
        const t = ((e - ae) * de + (n - an) * dn) / l2, sl = Math.sqrt(l2);
        if ((i === 1 && t * sl < -0.1) || (i === m - 1 && (t - 1) * sl > 0.1)) continue;   // (beyond the strip's end)
        const u = Math.max(0, Math.min(1, t)), ce = ae + de * u, cn = an + dn * u;
        const d = Math.hypot(ce - e, cn - n);
        if (d >= bd) continue;
        // across the road: the signed distance along the rows' normal, each row's line from its right edge to its left
        const ue = R[j + 2] + (R[k + 2] - R[j + 2]) * u, un = R[j + 3] + (R[k + 3] - R[j + 3]) * u;
        const x = Math.max(-1, Math.min(1, ((e - ce) * ue + (n - cn) * un) / D.hw));
        const y0 = (R[j + 4] + R[j + 5]) / 2 + (R[j + 4] - R[j + 5]) / 2 * x, y1 = (R[k + 4] + R[k + 5]) / 2 + (R[k + 4] - R[k + 5]) / 2 * x;
        bd = d; by = y0 + (y1 - y0) * u;
      }
    }
    return bd <= D.hw + margin ? by : -Infinity;
  }

  _profileAt(D, e, n, margin) {
    if (!D.grid) {
      D.grid = new Map();
      D.P.forEach(([pe, pn], i) => { const k = Math.floor(pe / 8) * 100000 + Math.floor(pn / 8); if (!D.grid.has(k)) D.grid.set(k, []); D.grid.get(k).push(i); });
    }
    const ge = Math.floor(e / 8), gn = Math.floor(n / 8);
    let bd = Infinity, by = -Infinity;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const L = D.grid.get((ge + a) * 100000 + gn + b); if (!L) continue;
      for (const i of L) {
        if (i === 0) continue;
        const [ae, an] = D.P[i - 1], [be, bn] = D.P[i], de = be - ae, dn = bn - an, l2 = de * de + dn * dn || 1;
        const u = Math.max(0, Math.min(1, ((e - ae) * de + (n - an) * dn) / l2)), d = Math.hypot(ae + de * u - e, an + dn * u - n);
        if (d < bd) { bd = d; by = D.y[i - 1] + (D.y[i] - D.y[i - 1]) * u; }
      }
    }
    return bd <= D.hw + margin ? by : -Infinity;
  }

  // under the bridge decks: the concrete girder (sides and soffit) and piers down to the river bed, every ~24 m
  _bridges() {
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const box = (e, n, y0, y1, s) => {
      const v = (x, y, z) => [-(e + x), y, n + z];
      const c = [[-s, -s], [s, -s], [s, s], [-s, s]];
      for (let k = 0; k < 4; k++) { const [x0, z0] = c[k], [x1, z1] = c[(k + 1) % 4]; quad(v(x0, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z0)); }
    };
    for (const r of this.roads) {
      const D = r.deck; if (!D) continue;
      const { P, y, hw } = D, w = hw + 0.25, N = P.length;
      const nrm = (i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)], de = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(de, dn) || 1; return [-dn / l, de / l]; };
      const high = (i) => y[i] - this.heightAt(P[i][0], P[i][1]) > 1.1;
      for (let i = 1; i < N; i++) {
        if (!high(i - 1) && !high(i)) continue;
        const [n0e, n0n] = nrm(i - 1), [n1e, n1n] = nrm(i);
        const p = (j, ne, nn, o, dy) => [-(P[j][0] + ne * o), y[j] + dy, P[j][1] + nn * o];
        for (const sd of [1, -1]) quad(p(i - 1, n0e, n0n, w * sd, 0), p(i, n1e, n1n, w * sd, 0), p(i, n1e, n1n, w * sd, -1.0), p(i - 1, n0e, n0n, w * sd, -1.0));
        quad(p(i - 1, n0e, n0n, w, -1.0), p(i, n1e, n1n, w, -1.0), p(i, n1e, n1n, -w, -1.0), p(i - 1, n0e, n0n, -w, -1.0));
        // piers: one in the middle of a narrow deck, a pair under a wide one
        if (i % 6 === 0 && high(i) && D.wet[i]) {
          const g = this.heightAt(P[i][0], P[i][1]) - 0.5;
          for (const o of hw > 3.5 ? [hw * 0.55, -hw * 0.55] : [0]) box(P[i][0] + n1e * o, P[i][1] + n1n * o, g, y[i] - 1.0, 0.45);
        }
      }
    }
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fastNormals(g);
    return g;
  }

  // the top of the more important roads' strips covering (e, n) (lower class, or the same class drawn earlier),
  // other than road ri; -Infinity where none covers it. Decks (bridges) aren't covers: what passes under stays under
  _coverY(e, n, ri) {
    if (!this._rg) this.nearRoad(e, n, 1);
    const me = this.roads[ri], G = 25;
    let best = -Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
    for (let j = 0; j < L.length; j += 6) {
      const oi = L[j + 5]; if (oi === ri) continue;
      const cls = L[j + 4], o = this.roads[oi];
      if (o.flags & 4 || o.deck || o.dirt || !(cls < me.cls || (cls === me.cls && oi < ri))) continue;
      const hw = cls <= 2 && o.lanes ? Math.max(ROAD_HALF[cls], o.lanes * 1.75) : ROAD_HALF[cls];
      const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
      if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 > (hw - 0.3) ** 2) continue;
      const sf = this._surfAt(o, e, n); if (!(sf > -1e9)) continue;
      best = Math.max(best, sf + 0.07 + (10 - cls) * 0.004);
    }
    }
    return best;
  }

  // the height of the drawn road surface at (e, n), or -Infinity off the roads. Matches how _ribbon lays the strip:
  // lifted by class, each vertex on the highest ground around it, so wheels sit on the asphalt rather than in it
  roadSurface(e, n, yRef) {
    if (!this._rg) this.nearRoad(e, n, 1);
    const G = 25;
    let best = -Infinity, off = -Infinity, mainCls = 99, mainY = -Infinity;
    const on = this._rsOn || (this._rsOn = []);
    on.length = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const cls = L[j + 4], r = this.roads[L[j + 5]];
        if (r.flags & 4) continue;
        const hw = (cls <= 2 && r.lanes ? Math.max(ROAD_HALF[cls], r.lanes * 1.75) : ROAD_HALF[cls]) + 0.15;
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        const ce = ax + dx * t, cn = az + dz * t, dist = Math.hypot(ce - e, cn - n);
        if (dist > hw + 1.6) continue;
        // on a bridge (or its ramps): the deck, and nothing beyond its edge
        if (r.deck) {
          const yd = this._deckAt(r, e, n);
          if (yd > this.heightAt(e, n) + 0.3) {
            if (dist <= hw && !(yRef < yd - 1.2)) {
              // (a lesser road's culvert deck where it joins a main road: under the main road's strip, as drawn; a flyover
              // well above it stays a flyover)
              // (the deck's strip as drawn, where there is one: the profile alone left wheels 0.3 m into some decks)
              const dd = this._drawnAt(r, e, n, 0.3);
              if (r.drawn && dd === -Infinity) continue;   // (its strip isn't drawn here)
              let v = dd > -1e9 ? dd : yd + 0.07 + (10 - cls) * 0.004; const cov = dd === -Infinity && v > best ? this._coverY(e, n, L[j + 5]) : -Infinity;
              if (cov > -1e9 && v > cov - 0.02 && v < cov + 1.2) v = cov - 0.02;
              best = Math.max(best, v);
            }
            continue;
          }
        }
        // its strip as drawn (at the edge, for the shoulder beyond it): exactly what the wheels should touch
        const dr = r.drawn ? this._drawnAt(r, dist <= hw ? e : ce + (e - ce) * (hw - 0.15) / dist, dist <= hw ? n : cn + (n - cn) * (hw - 0.15) / dist, 0.3) : -Infinity;
        if (r.drawn && dr === -Infinity) continue;   // (its strip isn't drawn here: nothing to stand on)
        const l = Math.sqrt(l2), ue = dx / l * 4, un = dz / l * 4, sf = dr > -1e9 ? -Infinity : this._surfAt(r, ce, cn);
        // (else its own graded surface; the ground only where it has none)
        const y = dr > -1e9 ? dr : (sf > -1e9 ? sf : Math.max(this.heightAt(e, n), this.heightAt(ce, cn), this.heightAt(ce + ue, cn + un), this.heightAt(ce - ue, cn - un))) + 0.07 + (10 - cls) * 0.004;
        // beyond the edge: down the shoulder to the ground (as drawn); under a more important road's strip, as drawn too
        let yy = dist <= hw ? y : y + (this.heightAt(e, n) - y) * ((dist - hw) / 1.6);
        if (dr === -Infinity && yy > (dist <= hw ? best : off)) { const cov = this._coverY(e, n, L[j + 5]); if (cov > -1e9 && yy > cov - 0.02) yy = cov - 0.02; }
        if (dist <= hw) { on.push(cls, yy); if (cls < mainCls || (cls === mainCls && yy > mainY)) { if (cls < mainCls) mainY = -Infinity; mainCls = cls; mainY = Math.max(mainY, yy); } } else if (yy > off) off = yy;
      }
    }
    // on a road's carriageway its surface rules: a lesser road whose strip runs into it no higher than just above it
    // (a side road climbing away from a junction overlapped a main road's lane 0.36 m up, a step on the main road)
    for (let i = 0; i < on.length; i += 2) { const y = on[i] > mainCls ? Math.min(on[i + 1], mainY + 0.03) : on[i + 1]; if (y > best) best = y; }
    // a road's own carriageway is what is drawn there: a neighbour's shoulder never lifts a car above it (a road a
    // metre higher alongside a culvert ramp or a junction mouth held autos and cars half a metre in the air)
    if (best === -Infinity) best = off;
    // between the two halves of a dual carriageway: the median
    if (this._medG) { const ym = this._medianAt(e, n); if (ym > best && !(yRef < ym - 1.2)) best = ym; }
    return best;
  }

  // the widest other road (not `skip`) whose strip, plus margin, holds (e, n): its half-width, or 0
  _roadHwAt(e, n, skip = -1, margin = 0.5, maxCls = 8) {
    if (!this._rg) this.nearRoad(e, n, 1);
    const G = 25;
    let best = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const cls = L[j + 4]; if (cls > maxCls || L[j + 5] === skip || (this.roads[L[j + 5]].flags & 4)) continue;
        const hw = ROAD_HALF[cls], ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < (hw + margin) ** 2) best = Math.max(best, hw);
      }
    }
    return best;
  }

  // the road centre-line pieces (cls up to maxCls, not under a deck) whose strip, half-width plus margin, may reach into
  // the box: [ae, an, be, bn, half-width + margin] each, flat
  _segsNear(e0, n0, e1, n1, maxCls = 7, margin = 0) {
    if (!this._rg) this.nearRoad(e0, n0, 1);
    const G = 25, out = [];
    for (let gx = Math.floor((e0 - 8) / G); gx <= Math.floor((e1 + 8) / G); gx++) for (let gz = Math.floor((n0 - 8) / G); gz <= Math.floor((n1 + 8) / G); gz++) {
      const L = this._rg.get(gx * 1000 + gz); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const cls = L[j + 4]; if (cls > maxCls) continue;
        const r = this.roads[L[j + 5]]; if (r.flags & 4) continue;
        const hw = (cls <= 2 && r.lanes ? Math.max(ROAD_HALF[cls], r.lanes * 1.75) : ROAD_HALF[cls]) + margin;
        const ax = L[j], az = L[j + 1], bx = L[j + 2], bz = L[j + 3];
        if (Math.max(ax, bx) < e0 - hw || Math.min(ax, bx) > e1 + hw || Math.max(az, bz) < n0 - hw || Math.min(az, bz) > n1 + hw) continue;
        let dup = false; for (let k = 0; k < out.length && !dup; k += 5) dup = out[k] === ax && out[k + 1] === az && out[k + 2] === bx && out[k + 3] === bz;
        if (!dup) out.push(ax, az, bx, bz, hw);
      }
    }
    return out;
  }

  // on a drawn road's surface (its own half-width plus margin), optionally ignoring one road (by index)
  onRoad(e, n, margin = 0, skip = -1, maxCls = 8) {
    if (!this._rg) this.nearRoad(e, n, 1);
    const G = 25;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 6) {
        const cls = L[j + 4];
        if (cls > maxCls || (skip instanceof Set ? skip.has(L[j + 5]) : L[j + 5] === skip)) continue;
        const r = this.roads[L[j + 5]];
        if (r.flags & 4) continue;
        const hw = (cls <= 2 && r.lanes ? Math.max(ROAD_HALF[cls], r.lanes * 1.75) : ROAD_HALF[cls]) + margin;
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < hw * hw) return true;
      }
    }
    return false;
  }

  *_buildings(M, d, opts) {
    const byMat = new Map(), roofsTile = [], roofsFlat = [], tanks = [], ledges = [], bulbs = { p: [], c: [] };
    const D = { props: { ac: [], pipe: [], balc: [], gate: [], awning: [], sign: [], crate: [], chair: [], scooter: [] }, tint: { awning: [], scooter: [], sign: [] }, walls: [], ao: [] };
    for (let c = 0; c < 16; c++) { D.walls.push({ p: [], c: [] }); D.ao.push({ p: [], c: [] }); }
    const push = (key, g) => { let l = byMat.get(key); if (!l) byMat.set(key, (l = [])); l.push(g); };
    let s = (this.tx * 2654435761 ^ this.tz * 40503) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const maxB = opts.maxBuildings ?? 6000;
    const list = d.b || [];
    // OSM often maps a building twice (an outline plus parts, or overlapping traces): a footprint whose middle
    // lies inside a bigger one is dropped, or its walls and shopfront would poke through the bigger building
    const pre = [], N = Math.min(list.length, maxB);
    for (let bi = 0; bi < N; bi++) {
      if ((bi & 63) === 63 && this._due()) { yield 'tile:buildings+'; this._ys = performance.now(); }
      const ring = decodeLine(list[bi], 2);
      let a = 0, ce = 0, cn = 0;
      for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += x1 * y2 - x2 * y1; ce += x1; cn += y1; }
      if (a < 0) ring.reverse();
      pre.push({ ring, area: Math.abs(a) / 2, ce: ce / (ring.length || 1), cn: cn / (ring.length || 1) });
    }
    const inside = (R, e, n) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const BG = new Map(), hidden = new Uint8Array(N);
    for (const bi of [...pre.keys()].sort((a, b) => pre[b].area - pre[a].area)) {
      if (this._due()) { yield 'tile:buildings+'; this._ys = performance.now(); }
      const P = pre[bi];
      if (P.ring.length < 3) { hidden[bi] = 1; continue; }
      let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
      for (const [e, n] of P.ring) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
      // the bigger buildings near it; this one goes if its middle or most of its corners (pulled in a little) are inside them
      const near = new Set();
      for (let x = Math.floor(e0 / 40); x <= Math.floor(e1 / 40); x++) for (let z = Math.floor(n0 / 40); z <= Math.floor(n1 / 40); z++) for (const o of BG.get(x * 100 + z) || []) near.add(o);
      // OSM building outlines and our road widths don't always agree: a house standing on the carriageway goes
      {
        const pts = [[P.ce, P.cn], ...P.ring.map(([e, n]) => [e + (P.ce - e) * 0.15, n + (P.cn - n) * 0.15])];
        const onRd = pts.filter(([e, n]) => this.onRoad(e, n, -0.4, -1, 7)).length;
        // (any corner more than ~1 m into a carriageway with traffic on it also goes: it would stand in a lane)
        // (and a long building lying across a road: points every ~3 m along its walls, pulled in a little)
        const along = [];
        for (let i = 0; i < P.ring.length; i++) { const [e1, n1] = P.ring[i], [e2, n2] = P.ring[(i + 1) % P.ring.length], k = Math.floor(Math.hypot(e2 - e1, n2 - n1) / 3); for (let j = 1; j < k; j++) { const e = e1 + (e2 - e1) * j / k, n = n1 + (n2 - n1) * j / k; along.push([e + (P.ce - e) * 0.1, n + (P.cn - n) * 0.1]); } }
        if (this.onRoad(P.ce, P.cn, -0.4, -1, 7) || onRd >= pts.length * 0.34 || P.ring.some(([e, n]) => this.onRoad(e, n, -1.0, -1, 7)) || along.some(([e, n]) => this.onRoad(e, n, -1.0, -1, 7))
          || P.ring.some(([e, n]) => this._nearJunction?.(e, n, -0.5, 3))) { hidden[bi] = 1; continue; }   // (nor a corner in a junction's mouth)
      }
      // (and one only a little into a carriageway moved back off it, up to 2 m, to stand 0.3 m clear: a car keeping its
      // lane on a narrow road ran into the corner of a house standing 0.3 m into the road. One it can't clear - on a
      // corner between two roads - goes too)
      {
        const segs = this._segsNear(e0 - 2.5, n0 - 2.5, e1 + 2.5, n1 + 2.5, 7, 0.3), R = P.ring;
        if (segs.length) {
          let se = 0, sn = 0, deep = 0;
          for (let it = 0; it < 4; it++) {
            let pe = 0, pn = 0; deep = 0;
            // (the walls every 1.5 m)
            for (let i = 0; i < R.length; i++) {
              const ea = R[i][0], na = R[i][1], eb = R[(i + 1) % R.length][0], nb = R[(i + 1) % R.length][1], k = Math.max(1, Math.ceil(Math.hypot(eb - ea, nb - na) / 1.5));
              for (let q = 0; q < k; q++) {
                const e = ea + (eb - ea) * q / k + se, n = na + (nb - na) * q / k + sn;
                for (let j = 0; j < segs.length; j += 5) {
                  const ax = segs[j], az = segs[j + 1], dx = segs[j + 2] - ax, dz = segs[j + 3] - az, hw = segs[j + 4], l2 = dx * dx + dz * dz || 1;
                  const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2)), ce = ax + dx * t, cn = az + dz * t, dd = Math.hypot(e - ce, n - cn);
                  if (dd >= hw || hw - dd <= deep) continue;
                  const l = Math.sqrt(l2);
                  deep = hw - dd; pe = (dd > 0.05 ? (e - ce) / dd : -dz / l) * deep; pn = (dd > 0.05 ? (n - cn) / dd : dx / l) * deep;
                }
              }
            }
            if (deep < 0.02) break;
            se += pe; sn += pn;
          }
          if (deep > 0.3 || Math.hypot(se, sn) > 2) { hidden[bi] = 1; continue; }
          if (se || sn) { P.ring = R.map(([e, n]) => [e + se, n + sn]); P.ce += se; P.cn += sn; e0 += se; e1 += se; n0 += sn; n1 += sn; }
        }
      }
      if (near.size) {
        const pts = [[P.ce, P.cn], ...P.ring.map(([e, n]) => [e + (P.ce - e) * 0.15, n + (P.cn - n) * 0.15])];
        const inAny = ([e, n]) => { for (const o of near) if (inside(pre[o].ring, e, n)) return true; return false; };
        if (inAny(pts[0]) || pts.filter(inAny).length >= pts.length * 0.5) { hidden[bi] = 1; continue; }
      }
      for (let x = Math.floor(e0 / 40); x <= Math.floor(e1 / 40); x++) for (let z = Math.floor(n0 / 40); z <= Math.floor(n1 / 40); z++) { const k = x * 100 + z; if (!BG.has(k)) BG.set(k, []); BG.get(k).push(bi); }
    }
    for (let bi = 0; bi < N; bi++) {
      if (this._due()) { yield 'tile:buildings+'; this._ys = performance.now(); }
      if (hidden[bi]) continue;
      const b = list[bi];
      const kind = b[0], H = b[1] / 10;
      const ring = pre[bi].ring;
      if (ring.length < 3) continue;
      const area = pre[bi].area;
      let base = Infinity;
      for (const [e, n] of ring) base = Math.min(base, this.heightAt(e, n));
      const g0 = base;   // ground floor level: the texture's floors start here
      base -= 0.4;
      // whole floors, so the roof never slices through a row of windows
      const colW = 3.2, floorH = 3.1, floors = Math.max(1, Math.round(H / floorH));
      const top = g0 + floors * floorH;
      const house = kind === 1 || kind === 2 || (kind === 0 && H < 8.5);
      const tiled = house && area < 320 && rnd() < 0.62;
      // flat roofs have a parapet round the terrace (below the next row's window sills)
      const wallTop = tiled ? top : top + 0.8;
      // walls: each side starts at a bay boundary and holds a whole number of window bays (the texture is
      // 8 bays x 8 floors), so windows are never cut at the corners; sides too short for a window get plain wall
      const n = ring.length, pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), idx = [], bays = [];
      const vb = (base - g0) / (floorH * 8), vt = (wallTop - g0) / (floorH * 8);
      for (let i = 0; i < n; i++) {
        const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n];
        const L = Math.hypot(e2 - e1, n2 - n1), sp = L / colW;
        let u0, u1, nb = 0;
        if (sp < 0.62) { const k = 1 + Math.floor(rnd() * 6); u0 = (k - sp / 2) / 8; u1 = (k + sp / 2) / 8; } // between two windows
        else { nb = Math.max(1, Math.round(sp)); const k = Math.floor(rnd() * 8); u0 = k / 8; u1 = (k + nb) / 8; }
        bays.push(nb);
        const q = i * 4;
        pos.set([-e1, base, n1, -e2, base, n2, -e1, wallTop, n1, -e2, wallTop, n2], q * 3);
        uv.set([u0, vb, u1, vb, u0, vt, u1, vt], q * 2);
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); // outward: the x axis is mirrored
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      wg.setIndex(idx); fastNormals(wg);
      // facade: houses in Kerala's paint colours, shops / flats / offices concrete, places of worship white
      // Kerala plaster in a painted tint for homes and most shops / flats; churches, temples and mosques white;
      // industrial sheds corrugated metal; a few concrete office blocks
      const KF = opts.keralaFacade ?? 6;
      let ce = 0, cn = 0; for (const [e, nn] of ring) { ce += e; cn += nn; } ce /= n; cn /= n;
      // town blocks fronting a road: shops on the ground floor
      const shop = opts.keralaShop !== undefined && H >= 5 && (kind === 4 || kind === 0 || kind === 3) && (kind === 4 || rnd() < 0.8)
        && this.nearRoad(ce, cn, Math.sqrt(area) * 0.6 + 8, kind === 4 ? 8 : 5);
      const fac = kind === 5 ? 3 : kind === 6 || kind === 7 || kind === 8 ? KF + 6 : shop ? opts.keralaShop + (rnd() < 0.5 ? 0 : 1) : kind === 4 && H > 12 ? (rnd() < 0.5 ? 6 : 1) : KF + 1 + Math.floor(rnd() * 8);
      push(fac, wg);
      if (!tiled) {
        // the parapet's inner face, in plain wall from the texture
        const ip = [], iu = [], ii = [];
        let u2 = 0;
        for (let i = 0; i < n; i++) {
          const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1), q = i * 4;
          ip.push(-e1, top, n1, -e2, top, n2, -e1, wallTop, n1, -e2, wallTop, n2);
          iu.push(u2 / (colW * 8), 0.505, (u2 + L) / (colW * 8), 0.505, u2 / (colW * 8), 0.53, (u2 + L) / (colW * 8), 0.53);
          u2 += L;
          ii.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.Float32BufferAttribute(ip, 3));
        pg.setAttribute('uv', new THREE.Float32BufferAttribute(iu, 2));
        pg.setIndex(ii); fastNormals(pg);
        push(fac, pg);
      }
      // a concrete sunshade (chajja) over every window, exactly where the texture paints it: 2.58-2.69 m above
      // each floor, the window's width plus a hand each side, 0.55 m deep; drawn near the camera only
      if (kind !== 5 && kind < 6 && opts.ledges) {
        for (let i = 0; i < n; i++) {
          const nb = bays[i];
          if (!nb) continue;
          const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1);
          const ue = (e2 - e1) / L, un = (n2 - n1) / L, oe = un * 0.55, on = -ue * 0.55; // outward (ring is CCW in e/n)
          const bw = L / nb, hw = 0.3 * bw;
          for (let f = shop ? 1 : 0; f < Math.min(floors, 8); f++) {
            const y = g0 + f * floorH + 2.69;
            for (let j = 0; j < nb; j++) {
              const c = (j + 0.5) * bw, a0 = [e1 + ue * (c - hw), n1 + un * (c - hw)], a1 = [e1 + ue * (c + hw), n1 + un * (c + hw)];
              const P = (pt, o, yy) => [-(pt[0] + oe * o), yy, pt[1] + on * o];
              const v = [P(a0, 0, y), P(a1, 0, y), P(a0, 1, y), P(a1, 1, y), P(a0, 1, y - 0.11), P(a1, 1, y - 0.11), P(a0, 0, y - 0.11), P(a1, 0, y - 0.11)];
              ledges.push([v, Math.min(3, Math.floor(e1 / 500)) + 4 * Math.min(3, Math.floor(n1 / 500))]);
            }
          }
        }
      }
      // roof
      const contour = ring.map(([e, nn]) => new THREE.Vector2(-e, nn));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      if (tiled) {
        // hip roof: eaves ring, ridge ring pulled in toward the centre and raised; tile courses run along the
        // eaves (u: metres round the eaves, v: metres up the slope)
        const rise = Math.min(2.6, 0.9 + Math.sqrt(area) * 0.12), k = 0.42, ov = 0.45;
        const rp = [], ri = [], ru = [];
        const eaves = ring.map(([e, nn]) => { const de = e - ce, dn = nn - cn, l = Math.hypot(de, dn) || 1; return [e + de / l * ov, nn + dn / l * ov]; });
        let per = 0;
        for (let i = 0; i <= n; i++) {
          const [e, nn] = eaves[i % n], re = ce + (ring[i % n][0] - ce) * k, rn = cn + (ring[i % n][1] - cn) * k;
          if (i) per += Math.hypot(e - eaves[i - 1][0], nn - eaves[i - 1][1]);
          const slope = Math.hypot(Math.hypot(e - re, nn - rn), rise + 0.15);
          rp.push(-e, top - 0.15, nn, -re, top + rise, rn);
          ru.push(per / 3.2, 0, per / 3.2, slope / 2.4);
        }
        for (let i = 0; i < n; i++) { const a = i * 2, b2 = (i + 1) * 2, c2 = a + 1, d2 = b2 + 1; ri.push(a, c2, b2, b2, c2, d2); }
        for (const t of tris) ri.push(t[0] * 2 + 1, t[2] * 2 + 1, t[1] * 2 + 1);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
        rg.setIndex(ri); faceUp(rg); fastNormals(rg);
        roofsTile.push(rg);
      } else {
        // flat concrete terrace; most homes keep a black water tank up there
        if (house && rnd() < 0.55 && opts.tankGeo) {
          tanks.push(opts.tankGeo.clone().translate(-ce + (rnd() - 0.5) * 2, top, cn + (rnd() - 0.5) * 2));
        }
        const rp = []; ring.forEach(([e, nn]) => rp.push(-e, top, nn));
        const ri = []; for (const t of tris) ri.push(t[0], t[2], t[1]);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rg.setIndex(ri); faceUp(rg); fastNormals(rg);
        roofsFlat.push(rg);
      }
      // collider: the footprint's oriented box (principal axes)
      if (area > 12) {
        // a rectangle-ish footprint gets its oriented box; an L, a wedge or a curved terrace gets a thin solid
        // slab along each wall instead (its box would cover the yard and the road beside it)
        const box = this._obb(ring, top), fill = area / (4 * box.hx * box.hz / 0.9216);
        if (fill > 0.86 && ring.length <= 6) {
          // a plain box of a building can be walked into: Interiors builds its ground floor on demand
          if (kind !== 5 && kind < 6 && area > 24) {
            let fl = g0; for (const [e, nn] of ring) fl = Math.max(fl, this.heightAt(e, nn));
            fl = Math.max(fl, this.heightAt(ce, cn)) + 0.06;
            const ceil = Math.min(fl + 3.0, top - 0.12);
            if (ceil - fl > 2.45) box.bld = { floor: fl, ceil, kind, house, shop, seed: (bi * 2654435761 ^ this.tx * 97 ^ this.tz * 31) >>> 0 };
          }
          this.colliders.push(box);
        }
        else for (let i = 0; i < n; i++) {
          const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1);
          if (L < 0.3) continue;
          const ue = (e2 - e1) / L, un = (n2 - n1) / L, me = (e1 + e2) / 2 - un * 0.3, mn = (n1 + n2) / 2 + ue * 0.3; // 0.3 m inside
          const ang = Math.atan2(-ue, un);
          this.colliders.push({ cx: -(this.E0 + me), cz: this.N0 + mn, hx: 0.3, hz: L / 2 + 0.15, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: top, kind: 'building' });
        }
      }
      if (opts.details ?? opts.ledges) this._details(D, { ring, n, base, g0, top, wallTop, H, area, house, tiled, shop, kind, ce, cn, floorH, floors, bays }, rnd);
      // festival lights: strings of bulbs along the eaves (and a second row lower down on the bigger ones) of every
      // church (warm white), temple (orange and yellow chains) and mosque (green and white), lit after dark
      if (kind >= 6 && kind <= 8 && opts.festive !== false) {
        const PAL = kind === 6 ? [[1, 0.9, 0.7]] : kind === 7 ? [[1, 0.55, 0.12], [1, 0.85, 0.2], [1, 0.3, 0.1]] : [[0.25, 1, 0.35], [1, 1, 0.9]];
        const rows = [wallTop + 0.08, ...(wallTop - g0 > 6 ? [g0 + (wallTop - g0) * 0.55] : [])];
        for (const [ri, y] of rows.entries()) for (let i = 0; i < n; i++) {
          const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1);
          if (L < 0.5) continue;
          const ue = (e2 - e1) / L, un = (n2 - n1) / L, oe = un * 0.25, on = -ue * 0.25;   // a hand's width out from the wall
          for (let d = 0; d < L; d += 0.55) {
            const sag = ri ? 0 : Math.sin((d / L) * Math.PI) * Math.min(0.35, L * 0.02);   // the string droops between the corners
            bulbs.p.push(-(e1 + ue * d + oe), y - sag, n1 + un * d + on);
            const c = PAL[Math.floor(d / 0.55) % PAL.length]; bulbs.c.push(...c);
          }
        }
      }
    }
    yield 'tile:bmerge';
    const out = [];
    // (merged in batches of ~40k vertices, a pause between: one merge of a whole tile's walls of a kind took a tenth of
    // a second, the game stalling with it)
    const batches = (geos) => { const B = [[]]; let nv = 0; for (const g of geos) { const c = g.attributes.position.count; if (nv + c > 40000 && B[B.length - 1].length) { B.push([]); nv = 0; } B[B.length - 1].push(g); nv += c; } return B; };
    const due = () => { if (!this._due()) return false; this._ys = performance.now(); return true; };
    for (const [fac, geos] of byMat) for (const part of batches(geos)) { if (this._due()) { yield 'tile:bmerge+'; this._ys = performance.now(); } const g = yield* mergeSteps(part, due); if (g) { const m = new THREE.Mesh(g, M.facades[fac] || M.facades[6]); m.castShadow = !!opts.shadows; m.receiveShadow = true; out.push(m); } }
    const strip = (gs) => gs.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; });
    for (const part of roofsTile.length ? batches(roofsTile) : []) { if (this._due()) { yield 'tile:bmerge+'; this._ys = performance.now(); } const g = yield* mergeSteps(part, due); if (g) { const m = new THREE.Mesh(g, M.klRoofTile); m.castShadow = !!opts.shadows; m.name = 'roofsTile'; out.push(m); } }
    // ledges in 500 m chunks, so only the ones near the camera are drawn (3 quads each: top, front, underside)
    // (straight into typed arrays: built as JS lists, with three's normals, a chunk took up to a tenth of a second)
    const byChunk = Array.from({ length: 16 }, () => []), Q = [0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7];
    for (const l of ledges) byChunk[l[1]]?.push(l[0]);   // (a ledge just past the tile's edge has no chunk: not drawn, as before)
    for (let c = 0; c < 16; c++) {
      if (this._due()) { yield 'tile:bmerge+'; this._ys = performance.now(); }
      const L = byChunk[c];
      if (!L.length) continue;
      const pos = new Float32Array(L.length * 24), idx = new Uint32Array(L.length * 18);
      for (let i = 0; i < L.length; i++) {
        const v = L[i];
        for (let j = 0; j < 8; j++) { const p = v[j], o = (i * 8 + j) * 3; pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2]; }
        for (let k = 0; k < 18; k++) idx[i * 18 + k] = i * 8 + Q[k];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1)); fastNormals(g);
      const m = new THREE.Mesh(g, M.klLedge || M.klRoofFlat); m.name = 'ledges'; m.castShadow = !!opts.shadows; m.receiveShadow = true;
      m.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250]; m.userData.far = 230;
      out.push(m);
    }
    if (roofsFlat.length) { const g = mergeGeometries(strip(roofsFlat)); if (g) out.push(new THREE.Mesh(g, M.klRoofFlat)); }
    if (tanks.length) { const g = mergeGeometries(tanks); if (g) out.push(new THREE.Mesh(g, M.klTank)); }
    if (bulbs.p.length && M.klFestive) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bulbs.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(bulbs.c, 3));
      const pts = new THREE.Points(g, M.klFestive); pts.name = 'festive'; pts.renderOrder = 2; out.push(pts);
    }
    yield 'tile:bdetail';
    if (opts.details ?? opts.ledges) out.push(...(yield* this._detailMeshes(D, M, opts)));
    return out;
  }

  // Building details, near the camera only: split AC units on the walls of shops and flats, PVC downpipes off the
  // terraces, balconies on two-storey houses, the compound wall round a house plot with its gate toward the road
  // (walls are solid), and a soft dark skirt where every wall meets the ground.
  _details(D, B, rnd) {
    const { ring, n, base, g0, top, wallTop, area, house, tiled, shop, ce, cn, floorH, floors, bays } = B;
    const ch = (e, nn) => Math.min(3, Math.max(0, Math.floor(e / 500))) + 4 * Math.min(3, Math.max(0, Math.floor(nn / 500)));
    const C0 = ch(ce, cn);
    const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
    // a prop standing on edge i at fraction t, `out` metres off the wall, facing outward
    const place = (list, i, t, y, out, sx = 1, sy = 1) => {
      const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1), ue = (e2 - e1) / L, un = (n2 - n1) / L;
      const e = e1 + (e2 - e1) * t + un * out, nn = n1 + (n2 - n1) * t - ue * out;
      Z.set(-un, 0, -ue); X.crossVectors(Y, Z);
      m4.makeBasis(X.multiplyScalar(sx), Y.clone().multiplyScalar(sy), Z).setPosition(-e, y, nn);
      list.push([m4.clone(), C0]);
    };
    const edges = []; for (let i = 0; i < n; i++) { const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n]; edges.push([i, Math.hypot(e2 - e1, n2 - n1)]); }
    // AC units (flats, shops, offices; the odd better-off house), on the pier between two windows
    if ((!house && rnd() < 0.6) || (house && floors >= 2 && rnd() < 0.2)) {
      const k = 1 + Math.floor(rnd() * Math.min(4, floors));
      for (let j = 0; j < k; j++) {
        const i = Math.floor(rnd() * n), nb = bays[i];
        if (nb < 2) continue;
        const f = shop ? 1 + Math.floor(rnd() * Math.max(1, floors - 1)) : Math.floor(rnd() * floors);
        if (f >= floors) continue;
        place(D.props.ac, i, (1 + Math.floor(rnd() * (nb - 1))) / nb, g0 + f * floorH + 1.2, 0.2);
      }
    }
    // downpipe from the terrace at a corner
    if (!tiled && rnd() < 0.6) {
      const [i, L] = edges[Math.floor(rnd() * n)];
      if (L > 1.5) place(D.props.pipe, i, 0.3 / L, base, 0.08, 1, wallTop - base);
    }
    // balcony on the long side of a two-storey house
    if (house && floors >= 2 && rnd() < 0.55) {
      const [i, L] = edges.reduce((a, b) => (b[1] > a[1] ? b : a)), nb = bays[i];
      if (L > 4 && nb) { const j = Math.floor(nb / 2); place(D.props.balc, i, (j + 0.5) / nb, g0 + floorH - 0.05, 0, Math.min(3.6, (L / nb) * 0.95)); }
    }
    // ground contact: a dark skirt round the footprint, fading out over ~1.2 m
    {
      const A = D.ao[C0];
      for (let i = 0; i < n; i++) {
        const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1);
        if (L < 0.3) continue;
        const oe = (n2 - n1) / L * 1.2, on = -(e2 - e1) / L * 1.2;
        const y1 = this.heightAt(e1, n1) + 0.05, y2 = this.heightAt(e2, n2) + 0.05, y3 = this.heightAt(e2 + oe, n2 + on) + 0.05, y4 = this.heightAt(e1 + oe, n1 + on) + 0.05;
        const a = [-e1, y1, n1], b = [-e2, y2, n2], c = [-(e2 + oe), y3, n2 + on], d = [-(e1 + oe), y4, n1 + on];
        A.p.push(...a, ...c, ...b, ...a, ...d, ...c);
        A.c.push(0, 0, 0, 0.42, 0, 0, 0, 0, 0, 0, 0, 0.42, 0, 0, 0, 0.42, 0, 0, 0, 0, 0, 0, 0, 0);
      }
    }
    // shopfronts on the sides facing a road: a sloping awning per bay, a projecting sign, and the clutter out
    // front (crates of produce, plastic chairs, a scooter or two parked on the footpath)
    if (shop) for (const [i, L] of edges) {
      if (L < 3.5 || !bays[i]) continue;
      const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], ue = (e2 - e1) / L, un = (n2 - n1) / L;
      if (!this.nearRoad((e1 + e2) / 2 + un * 7, (n1 + n2) / 2 - ue * 7, 7, 9)) continue;
      const nbays = bays[i] || 1, bw = L / nbays, yb = g0;
      for (let b = 0; b < nbays; b++) {
        const t = (b + 0.5) / nbays;
        // the texture paints the signboard from 2.36 m up: the awning hangs just under it
        // (not out over the carriageway, where it would hang at a car's roof; and clear of the ground in front, a street
        // higher than the shop floor included)
        if (rnd() < 0.7) {
          const ae = e1 + (e2 - e1) * t + un * 1.4, an = n1 + (n2 - n1) * t - ue * 1.4;
          if (!this.onRoad(ae, an, 0.3, -1, 9)) {
            const front = Math.max(this.heightAt(ae, an), this.roadSurface?.(ae, an, yb + 3) ?? -Infinity);
            place(D.props.awning, i, t, Math.max(yb, front) + 2.3, 0, bw * 0.96); D.tint.awning.push(rnd());
          }
        }
        if (b > 0 && floors >= 2 && rnd() < 0.3) { place(D.props.sign, i, b / nbays, yb + 3.5, 0); D.tint.sign.push(rnd()); }
        const r = rnd();
        const fe = e1 + (e2 - e1) * t + un * 1.2, fn = n1 + (n2 - n1) * t - ue * 1.2;
        if (r < 0.4 && this.onRoad(fe, fn, 0.4, -1, 9)) continue;
        if (r < 0.25) place(D.props.crate, i, t + (rnd() - 0.5) * 0.5 / nbays, this.heightAt(e1 + (e2 - e1) * t + un, n1 + (n2 - n1) * t - ue) + 0.01, 0.9 + rnd() * 0.5);
        else if (r < 0.4) place(D.props.chair, i, t + (rnd() - 0.5) * 0.5 / nbays, this.heightAt(e1 + (e2 - e1) * t + un, n1 + (n2 - n1) * t - ue) + 0.01, 1.2 + rnd() * 0.6);
        else if (r < 0.48) {
          // scooters park nose-in to the shop, at right angles to the wall
          const e = e1 + (e2 - e1) * t + un * 2.4, nn = n1 + (n2 - n1) * t - ue * 2.4;
          if (!this.onRoad(e, nn, 0.5, -1, 9)) {
            Z.set(-un, 0, -ue); X.crossVectors(Y, Z);
            m4.makeBasis(X, Y, Z).setPosition(-e, this.heightAt(e, nn) + 0.15, nn);
            D.props.scooter.push([m4.clone(), C0]); D.tint.scooter.push(rnd());
          }
        }
      }
    }
    // Compound wall round the house plot. Kerala homes nearly all stand in a walled compound: a 1.2-1.8 m wall of
    // plastered brick or laterite along the plot line, pillars and a steel gate to the road, the house set back
    // ~3 m (the building rules' front yard). The plot is the house's own rectangle grown by a yard on each side
    // (a deeper one toward the road); where it would run onto a road the wall steps back to the road edge,
    // neighbouring plots share a wall, and it is solid.
    if (!house || area > 650 || shop || rnd() > 0.92) return;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [e, nn] of ring) { const a = e - ce, b = nn - cn; sxx += a * a; syy += b * b; sxy += a * b; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [e, nn] of ring) { const a = (e - ce) * ux + (nn - cn) * uy, b = -(e - ce) * uy + (nn - cn) * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const W2 = (a, b) => [ce + ux * a - uy * b, cn + uy * a + ux * b];
    // which side faces the nearest road (that is the front, with the gate)
    const sides = [[a1, 0, 1, 0], [a0, 0, -1, 0], [0, b1, 0, 1], [0, b0, 0, -1]];
    let front = -1, fd = Infinity;
    sides.forEach(([sa, sb, da, db], k) => { for (let d = 2; d <= 16; d += 2) { const p = W2(sa + da * d, sb + db * d); if (this.onRoad(p[0], p[1], 0.5, -1, 9)) { if (d < fd) { fd = d; front = k; } break; } } });
    const yard = [1.4 + rnd() * 1.2, 1.4 + rnd() * 1.2, 1.6 + rnd() * 1.4, 1.6 + rnd() * 1.4].map((m, k) => (k === front ? 3 + rnd() * 3 : m));
    const A0 = a0 - yard[1], A1 = a1 + yard[0], B0 = b0 - yard[3], B1 = b1 + yard[2];
    const corners = [[A1, B0], [A1, B1], [A0, B1], [A0, B0]];      // sides: +a, +b, -a, -b
    const sideOf = [0, 2, 1, 3];                                  // corner edge i -> index in `sides`
    const laterite = rnd() < 0.35, j = 0.85 + rnd() * 0.2;
    const top0 = laterite ? [0.24 * j, 0.09 * j, 0.045 * j] : [0.36 * j, 0.35 * j, 0.32 * j], low = laterite ? [0.12, 0.05, 0.03] : [0.08, 0.09, 0.05];
    const W = D.walls[C0], HW = 1.25 + rnd() * 0.4, T = 0.1;
    if (!D.wallCells) D.wallCells = new Set();
    const cell = (e, nn) => Math.round(e * 2) * 100003 + Math.round(nn * 2);
    const piece = (a, b) => {
      const de = b[0] - a[0], dn = b[1] - a[1], L = Math.hypot(de, dn);
      if (L < 0.5) return;
      const ne = -dn / L * T, nn = de / L * T, ya = this.heightAt(...a) - 0.1, yb = this.heightAt(...b) - 0.1;
      const V = (p, o, y) => [-(p[0] + ne * o), y, p[1] + nn * o];
      const q = (p1, p2, p3, p4, c1, c2) => { W.p.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4); W.c.push(...c1, ...c1, ...c2, ...c1, ...c2, ...c2); };
      for (const o of [1, -1]) q(V(a, o, ya), V(b, o, yb), V(b, o, yb + HW), V(a, o, ya + HW), low, top0);
      q(V(a, 1, ya + HW), V(b, 1, yb + HW), V(b, -1, yb + HW), V(a, -1, ya + HW), top0, top0);
      const ang = Math.atan2(-de / L, dn / L);
      this.colliders.push({ cx: -(this.E0 + (a[0] + b[0]) / 2), cz: this.N0 + (a[1] + b[1]) / 2, hx: 0.15, hz: L / 2, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: Math.max(ya, yb) + HW, kind: 'barrier' });
    };
    const blocked = (e, nn) => e < 0.5 || nn < 0.5 || e > TILE - 0.5 || nn > TILE - 0.5 || this.classAt(e, nn) === C.building || this.classAt(e, nn) === C.water || this.classAt(e, nn) === C.sea;
    for (let i = 0; i < 4; i++) {
      const [pa, pb] = corners[i], [qa, qb] = corners[(i + 1) % 4], L = Math.hypot(qa - pa, qb - pb), isFront = sideOf[i] === front;
      const gate = isFront && L > 5 ? L / 2 : -1;
      let run = null, last = null, kRun = 0;
      for (let d = 0; d <= L + 1e-6; d += 1) {
        const t = Math.min(1, d / L);
        let a = pa + (qa - pa) * t, b = pb + (qb - pb) * t, p = W2(a, b), k = 0;
        // onto a road: step back toward the house until it is off the carriageway (the wall runs along the road edge)
        for (; k < 16 && this.onRoad(p[0], p[1], 0.7, -1, 9); k++) { a *= 0.93; b *= 0.93; p = W2(a, b); }
        // (a piece is drawn straight from its first point to its last: where the step back changes, the points are
        // no longer in line, so the piece ends there; a straight run would cut across the road)
        if (run && k !== kRun) { if (last !== run) piece(run, last); run = null; }
        kRun = k;
        const inHouse = a > a0 - 0.6 && a < a1 + 0.6 && b > b0 - 0.6 && b < b1 + 0.6;
        const shared = D.wallCells.has(cell(...p));
        // (and clear of a junction's corners: the corner plot's wall is set back there, so a car turning into the
        // side road has room to swing round)
        const ok = !inHouse && !shared && !blocked(...p) && !this.onRoad(p[0], p[1], 0.7, -1, 9) && !(gate >= 0 && Math.abs(d - gate) < 1.6) && !this._nearJunction?.(p[0], p[1], 3, 3);
        if (ok) { D.wallCells.add(cell(...p)); if (!run) run = p; last = p; }
        else { if (run && last !== run) piece(run, last); run = null; }
      }
      if (run && last !== run) piece(run, last);
      if (gate >= 0) {
        const t = gate / L, ga = pa + (qa - pa) * t, gb = pb + (qb - pb) * t;
        let k = 1, g = W2(ga, gb);
        for (let s2 = 0; s2 < 16 && this.onRoad(g[0], g[1], 0.7, -1, 9); s2++) { k *= 0.93; g = W2(ga * k, gb * k); }
        if (!blocked(...g) && !this.onRoad(g[0], g[1], 0.7, -1, 9) && !this._nearJunction?.(g[0], g[1], 3, 3)) {
          const de = (qa - pa) * ux - (qb - pb) * uy, dn = (qa - pa) * uy + (qb - pb) * ux, l = Math.hypot(de, dn) || 1, ue = de / l, un = dn / l;
          Z.set(-un, 0, -ue); X.crossVectors(Y, Z);
          m4.makeBasis(X, Y, Z).setPosition(-g[0], this.heightAt(...g) - 0.05, g[1]);
          D.props.gate.push([m4.clone(), C0]);
          const ang = Math.atan2(-ue, un);  // collider local z runs along the wall
          this.colliders.push({ cx: -(this.E0 + g[0]), cz: this.N0 + g[1], hx: 0.12, hz: 1.5, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: this.heightAt(...g) + 1.6, kind: 'barrier' });
        }
      }
    }
  }

  *_detailMeshes(D, M, opts) {
    const out = [], cc = (c) => [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250];
    const geo = { ac: opts.acGeo, pipe: opts.pipeGeo, balc: opts.balconyGeo, gate: opts.gateGeo, awning: opts.awningGeo, sign: opts.signGeo, crate: opts.crateGeo, chair: opts.chairGeo, scooter: opts.scooterGeo };
    // awnings in faded tarpaulin blues, greens, reds and tin; scooters in the usual paints
    const PAL = { awning: [0x2d5f8a, 0x2f7a4a, 0x9a3a2a, 0x8a8e94, 0xc89a2a, 0x3a4a9a, 0x8a8e94], scooter: [0xe8e8e8, 0x1a1a1a, 0x8a1a1a, 0x2a3a6a, 0x9a9a9a, 0x5a6a5a], sign: [0xc81e1e, 0x1e5ac8, 0xe8c020, 0x1e8a3a, 0xe8e8e8, 0xd85a1a] };
    const col = new THREE.Color();
    this.scooterSpots = D.props.scooter.map(([m, c], i) => [m, c, D.tint.scooter[i]]);
    for (const [k, list] of Object.entries(D.props)) {
      if (!geo[k] || (k === 'scooter' && opts.realScooter)) continue;
      for (let c = 0; c < 16; c++) {
        if (this._due()) { yield 'tile:bdetail+'; this._ys = performance.now(); }
        const idx = []; list.forEach((q, i) => { if (q[1] === c) idx.push(i); });
        const L = idx.map((i) => list[i]);
        if (!L.length) continue;
        const im = new THREE.InstancedMesh(geo[k], M.klStop, L.length);
        L.forEach(([m], i) => im.setMatrixAt(i, m));
        if (D.tint[k]) idx.forEach((j, i) => { const P = PAL[k]; im.setColorAt(i, col.set(P[Math.floor(D.tint[k][j] * P.length)])); });
        im.computeBoundingSphere(); im.name = 'detail_' + k; im.castShadow = !!opts.shadows && k !== 'pipe';
        im.userData.cc = cc(c); im.userData.far = 350;
        out.push(im);
      }
    }
    const mk = (A, mat, name, far, cols = 3) => {
      if (!A.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
      g.setAttribute('color', byteColors(A.c, cols));
      fastNormals(g);
      const m = new THREE.Mesh(g, mat); m.name = name; m.userData.far = far; return m;
    };
    for (const [c, A] of D.walls.entries()) {
      if (this._due()) { yield 'tile:bdetail+'; this._ys = performance.now(); }
      const m = mk(A, M.klKerb, 'compound', 400); if (m) { m.userData.cc = cc(c); m.castShadow = !!opts.shadows; m.receiveShadow = true; out.push(m); }
    }
    if (M.klAO) for (const [c, A] of D.ao.entries()) {
      if (this._due()) { yield 'tile:bdetail+'; this._ys = performance.now(); }
      const m = mk(A, M.klAO, 'ao', 400, 4); if (m) { m.userData.cc = cc(c); m.renderOrder = 1; out.push(m); }
    }
    return out;
  }

  _obb(ring, top) {
    let ce = 0, cn = 0; for (const [e, n] of ring) { ce += e; cn += n; } ce /= ring.length; cn /= ring.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [e, n] of ring) { const a = e - ce, b = n - cn; sxx += a * a; syy += b * b; sxy += a * b; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(th), uy = Math.sin(th);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [e, n] of ring) { const a = (e - ce) * ux + (n - cn) * uy, b = -(e - ce) * uy + (n - cn) * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const mA = (a0 + a1) / 2, mB = (b0 + b1) / 2;
    const cE = ce + ux * mA - uy * mB, cN = cn + uy * mA + ux * mB;
    // to game space: x = -E, z = N. Axis u (e,n) = (ux, uy) -> (x, z) = (-ux, uy)
    const gx = -(this.E0 + cE), gz = this.N0 + cN;
    const ax = -ux, az = uy;            // game-space direction of the 'a' axis
    const ang = Math.atan2(ax, az);     // collider frame: local z along 'a'
    return { cx: gx, cz: gz, hx: Math.max(0.5, (b1 - b0) / 2 * 0.96), hz: Math.max(0.5, (a1 - a0) / 2 * 0.96), cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: top, kind: 'building' };
  }

  // ------------------------------------------------------------------------------------------ coconut palms
  _palms(opts) {
    const geo = opts.palmGeo;
    if (!geo || !(opts.palms > 0)) return null;
    const P = [];
    let s = (this.tx * 97 + this.tz * 131071) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const DENS = { [C.land]: 0.28, [C.grove]: 0.85, [C.town]: 0.32, [C.religious]: 0.3, [C.grass]: 0.12, [C.paddy]: 0.015, [C.scrub]: 0.1, [C.sand]: 0.35, [C.wetland]: 0.2, [C.commercial]: 0.05 };
    const step = 15, max = Math.round(1400 * opts.palms);
    for (let n = step / 2; n < TILE && P.length < max; n += step) for (let e = step / 2; e < TILE && P.length < max; e += step) {
      const je = e + (rnd() - 0.5) * step * 0.9, jn = n + (rnd() - 0.5) * step * 0.9;
      const c = this.classAt(je, jn), p = DENS[c] || 0;
      if (rnd() > p) continue;
      const h = this.heightAt(je, jn);
      if (h > 900) continue; // no coconut palms high in the Ghats
      P.push([je, jn, h]);
    }
    if (!P.length) return null;
    const im = new THREE.InstancedMesh(geo, opts.palmMat, P.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), lean = new THREE.Quaternion(), ax = new THREE.Vector3();
    P.forEach(([e, n, h], i) => {
      q.setFromAxisAngle(up, rnd() * 6.283);
      ax.set(rnd() - 0.5, 0, rnd() - 0.5).normalize(); lean.setFromAxisAngle(ax, rnd() * 0.16); q.premultiply(lean); // palms lean
      sc.setScalar(0.8 + rnd() * 0.5);
      ps.set(-e, h - 0.1, n);
      im.setMatrixAt(i, m4.compose(ps, q, sc));
    });
    im.computeBoundingSphere();
    im.name = 'palms';
    im.castShadow = !!opts.shadows;
    return im;
  }

  dispose() {
    this.group?.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && o.name !== 'treesFar' && o.name !== 'palmsFar' && o.name !== 'detail_scooterReal') o.geometry.dispose();
      if (o.material && o.name === 'terrain') { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.group?.removeFromParent();
    this.cls = null; this.visCanvas = null; this.trees = null; this._rg = null; this._bg = null; this.bumps = [];
  }
}
