// One 2 km tile of Kerala (tools/kerala/build_tiles.py): decoded data, the ground under it, and the meshes
// built from it — terrain coloured by land use, roads draped on the ground with markings, buildings with
// Kerala roofs, water, coconut palms — plus the building colliders.
//
// Frames: tile data is in metres east (e) / north (n) of the tile's south-west corner. The game's +X is west,
// so a tile's group sits at (x = -E0, z = N0) and its local vertices are (x = -e, z = n). Every mesh stays in
// local coordinates (small floats) wherever the tile is in the state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TILE = 2000;
export const GRID = 33;
const STEP = TILE / (GRID - 1);
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
    this.colliders = [];
    this.ready = false;
  }

  // ground height (game y) at tile-local (e, n): the triangles exactly as drawn
  heightAt(e, n) {
    const gx = Math.min(GRID - 1.0001, Math.max(0, e / STEP)), gz = Math.min(GRID - 1.0001, Math.max(0, n / STEP));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, H = this.h;
    const a = H[j * GRID + i], b = H[j * GRID + i + 1], c = H[(j + 1) * GRID + i], d = H[(j + 1) * GRID + i + 1];
    // split a-c-b / b-c-d (matches the index order below)
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  classAt(e, n) {
    if (!this.cls) return 0;
    const px = Math.min(RASTER - 1, Math.max(0, Math.floor(e * PX))), py = Math.min(RASTER - 1, Math.max(0, Math.floor((TILE - n) * PX)));
    const c = this.cls[(py * RASTER + px) * 4];
    return VALID[c] ? c : c < 15 ? C.land : C.road;  // anti-aliased edges blend codes: mostly-land or mostly-road
  }

  // ------------------------------------------------------------------------------------------ build
  build(M, opts) {
    const d = this.data;
    const g = new THREE.Group();
    g.name = `kl_${this.tx}_${this.tz}`;
    g.position.set(-this.E0, 0, this.N0);
    this.group = g;
    this._rasters(d);
    this._sinkWater();
    g.add(this._terrain(M));
    const water = this._water(M, d);
    if (water) g.add(water);
    for (const m of this._roads(M)) g.add(m);
    for (const m of this._street(M, opts)) g.add(m);
    this._nearJunction = null;
    for (const m of this._buildings(M, d, opts)) g.add(m);
    for (const m of this._poles(M, opts)) g.add(m);
    if (opts.trees) { this.trees = opts.trees.plant(this); g.add(this.trees.group); }
    else { const palms = this._palms(opts); if (palms) g.add(palms); }
    g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    g.updateMatrixWorld(true);
    this.ready = true;
    return g;
  }

  // class canvas (what is where: water / land use / roads / buildings) + the visible ground colours
  _rasters(d) {
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
      K.strokeStyle = `rgb(${C.water},0,0)`; V.strokeStyle = '#2a4e52';
      for (const ctx of [K, V]) { ctx.lineWidth = Math.max(1, wd * PX); ctx.beginPath(); pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke(); }
    }
    // laterite earth under the trees, a little texture so nothing is a flat colour
    V.globalAlpha = 0.18;
    let s = (this.tx * 73856093 ^ this.tz * 19349663) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const MOTTLE = ['#2f4a20', '#3c5a26', '#6b5a3a', '#8a5a3c', '#7a7048'];
    for (let i = 0; i < 2600; i++) { V.fillStyle = MOTTLE[Math.floor(rnd() * MOTTLE.length)]; const r = 0.8 + rnd() * rnd() * 7; V.beginPath(); V.ellipse(rnd() * RASTER, rnd() * RASTER, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, 6.283); V.fill(); }
    V.globalAlpha = 1;
    // swept earth yards round the houses (Kerala compounds), a little wider than the footprint
    V.fillStyle = 'rgba(132,96,66,0.55)'; V.strokeStyle = 'rgba(132,96,66,0.45)'; V.lineJoin = 'round';
    V.lineWidth = Math.max(1, 7 * PX);
    for (const b of d.b || []) { path(V, [decodeLine(b, 2)]); V.fill(); V.stroke(); }
    // red laterite earth along the road edges (Kerala's verges)
    V.lineCap = 'round'; V.lineJoin = 'round'; V.globalAlpha = 0.55; V.strokeStyle = '#8a563a';
    for (const r of this.roads) {
      if (r.cls > 7) continue;
      V.lineWidth = Math.max(1.5, (ROAD_HALF[r.cls] * 2 + 3.5) * PX);
      V.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) V.lineTo(x, y); else V.moveTo(x, y); }); V.stroke();
    }
    V.globalAlpha = 1;
    // roads and buildings into the class map (palms keep off them)
    K.lineCap = 'round';
    for (const r of this.roads) {
      K.strokeStyle = `rgb(${C.road},0,0)`; K.lineWidth = Math.max(0.9, (ROAD_HALF[r.cls] * 2 + 2) * PX);
      K.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) K.lineTo(x, y); else K.moveTo(x, y); }); K.stroke();
      if (r.dirt) { V.strokeStyle = '#8c5a3a'; V.lineWidth = Math.max(1, ROAD_HALF[r.cls] * 2 * PX); V.lineCap = 'round'; V.beginPath(); r.pts.forEach(([e, n], i) => { const x = e * PX, y = (TILE - n) * PX; if (i) V.lineTo(x, y); else V.moveTo(x, y); }); V.stroke(); }
    }
    K.fillStyle = `rgb(${C.building},0,0)`;
    for (const b of d.b || []) { path(K, [decodeLine(b, 2)]); K.fill(); }
    this.cls = K.getImageData(0, 0, RASTER, RASTER).data;
    this.visCanvas = vis;
  }

  // ground under lakes, rivers and the sea sits below the water surface
  _sinkWater() {
    const H = this.h;
    this.waterLevel = 0.25;
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const c = this.classAt(i * STEP, j * STEP);
      // (not under a road: bridges and causeways keep the ground at road level)
      if ((c === C.water || c === C.sea) && !this.nearRoad(i * STEP, j * STEP, 9, 9)) H[j * GRID + i] = Math.min(H[j * GRID + i], 0) - 2.2;
    }
  }

  _terrain(M) {
    const n = GRID, pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), idx = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      pos[k * 3] = -i * STEP; pos[k * 3 + 1] = this.h[k]; pos[k * 3 + 2] = j * STEP;
      uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / (n - 1);
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // the local x axis is mirrored (x = -e), so wind the other way round to face up
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); faceUp(g); g.computeVertexNormals();
    const tex = new THREE.CanvasTexture(this.visCanvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    if (M.terrainDetail) {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uDet = { value: M.terrainDetail };
        sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWp;\nuniform sampler2D uDet;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n { float g1 = texture2D(uDet, vWp.xz / 7.0).g, g2 = texture2D(uDet, vWp.xz / 41.0).g; diffuseColor.rgb *= (0.7 + 0.6 * g1) * (0.88 + 0.24 * g2); }');
      };
      mat.customProgramCacheKey = () => 'klTerrain';
    }
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.name = 'terrain';
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
      const y = k === 9 ? 0 : this.waterLevel;
      const pos = new Float32Array(all.length * 3);
      all.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = p.y; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(tris.flat());
      geos.push(faceUp(g));
    }
    // rivers / canals as ribbons
    for (const w of d.wl || []) {
      const pts = decodeLine(w, 2), hw = Math.max(1.5, w[1] / 20);
      const g = this._ribbon(pts, hw, () => this.waterLevel, 1e9);
      if (g) { g.deleteAttribute('uv'); geos.push(faceUp(g)); }
    }
    if (!geos.length) return null;
    for (const g of geos) if (!g.attributes.normal) g.computeVertexNormals();
    const merged = mergeGeometries(geos.map((g) => { g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }));
    if (!merged) return null;
    const m = new THREE.Mesh(merged, M.klWater || M.water);
    m.name = 'water';
    return m;
  }

  // a flat strip of half width hw along pts (tile-local e/n), at height yOf(e, n); uv: u across, v along (m / vScale)
  _ribbon(pts, hw, yOf, vScale = 8) {
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
      const hi = (oe, on) => Math.max(yOf(e + oe, n + on), yOf((e + pe[0]) / 2 + oe, (n + pe[1]) / 2 + on), yOf((e + qe[0]) / 2 + oe, (n + qe[1]) / 2 + on));
      const yc = hi(0, 0);
      let yl = Math.max(hi(ne, nn), yc - 0.25), yr = Math.max(hi(-ne, -nn), yc - 0.25);
      if ((yl + yr) / 2 < yc) { const up = yc - (yl + yr) / 2; yl += up; yr += up; }  // a ridge along the middle
      pos.set([-(e + ne), yl, n + nn, -(e - ne), yr, n - nn], i * 6);
      uv.set([0, along / vScale, 1, along / vScale], i * 4);
      if (i) { const q = (i - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return faceUp(g);
  }

  _roads(M) {
    const paved = [], dirt = [], white = [], yellow = [];
    const y = (lift) => (e, n) => this.heightAt(e, n) + lift;
    // junctions (points shared by roads): markings stop short of them, as painted lines do
    const seen = new Map();
    for (const r of this.roads) {
      if (r.flags & 4 || r.cls > 8) continue;
      const hw = ROAD_HALF[r.cls];
      for (const k of new Set(r.pts.map(([e, n]) => `${Math.round(e)},${Math.round(n)}`))) { const o = seen.get(k); seen.set(k, o ? [o[0] + 1, Math.max(o[1], hw)] : [1, hw]); }
    }
    const JG = new Map();
    for (const [k, [c, hw]] of seen) {
      if (c < 2) continue;
      const [e, n] = k.split(',').map(Number), gk = Math.floor(e / 16) * 1000 + Math.floor(n / 16);
      if (!JG.has(gk)) JG.set(gk, []); JG.get(gk).push(e, n, hw + 2.5);
    }
    this._nearJunction = (e, n) => {
      const ge = Math.floor(e / 16), gn = Math.floor(n / 16);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const L = JG.get((ge + a) * 1000 + gn + b); if (!L) continue;
        for (let j = 0; j < L.length; j += 3) if ((L[j] - e) ** 2 + (L[j + 1] - n) ** 2 < L[j + 2] * L[j + 2]) return true;
      }
      return false;
    };
    // wider classes sit a hair higher so junctions don't flicker
    for (const r of this.roads) {
      if (r.flags & 4) continue; // tunnels: not drawn on the surface
      const lanes = r.lanes || (r.cls <= 1 ? 4 : r.cls <= 3 ? 2 : r.cls <= 6 ? 2 : 1);
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], lanes * 1.75) : ROAD_HALF[r.cls];
      const lift = 0.07 + (10 - r.cls) * 0.004;
      // ends cut at the tile border run on a little, so a road crossing the seam at an angle leaves no wedge
      const onEdge = ([e, n]) => e < 0.6 || n < 0.6 || e > TILE - 0.6 || n > TILE - 0.6;
      const run = (a, b) => { const de = a[0] - b[0], dn = a[1] - b[1], l = Math.hypot(de, dn) || 1; return [a[0] + de / l * (hw + 1), a[1] + dn / l * (hw + 1)]; };
      const P = r.pts.length > 1 && (onEdge(r.pts[0]) || onEdge(r.pts[r.pts.length - 1])) ? [...r.pts] : r.pts;
      if (P !== r.pts) { if (onEdge(P[0])) P.unshift(run(P[0], P[1])); if (onEdge(P[P.length - 1])) P.push(run(P[P.length - 1], P[P.length - 2])); }
      const g = this._ribbon(P, hw, y(lift), 7);
      if (!g) continue;
      g.computeVertexNormals();
      (r.dirt ? dirt : paved).push(g);
      if (r.dirt || r.cls > 4) continue;  // village and town lanes carry no paint
      // markings: dashed white centre line (Indian roads), solid edge lines on the main roads
      const cl = this._dashes(r.pts, 0, 0.08, 3, 6, y(lift + 0.012));
      if (cl) white.push(cl);
      if (r.cls <= 3) for (const side of [1, -1]) { const e = this._dashes(r.pts, side * (hw - 0.35), 0.08, 0, 0, y(lift + 0.012)); if (e) (r.cls <= 1 ? yellow : white).push(e); }
    }
    this._junctions = [...seen].filter(([, [c]]) => c >= 3).map(([k, [c, hw]]) => { const [e, n] = k.split(',').map(Number); return { e, n, c, r: hw + 2.5 }; });
    const out = [];
    const add = (list, mat, name) => { if (!list.length) return; const gg = mergeGeometries(list); if (!gg) return; const m = new THREE.Mesh(gg, mat); m.receiveShadow = true; m.name = name; out.push(m); };
    add(paved, M.klRoad || M.road, 'roads');
    add(dirt, M.klDirtRoad || M.dirt, 'tracks');
    add(white, M.klLineWhite, 'lines');
    add(yellow, M.klLineYellow, 'linesY');
    return out;
  }

  // ------------------------------------------------------------------------------------------ street edge
  // Town streets: a concrete kerb with the open roadside drain behind it (slab-covered in stretches) and, on the
  // commercial stretches, a raised footpath; zebra crossings at the busy junctions, painted speed breakers (which
  // vehicles feel: bumpAt / bumpAhead), and iron manhole covers in the carriageway.
  _street(M, opts) {
    if (!M.klKerb) return [];
    let s = (this.tx * 3571 ^ this.tz * 7919 ^ 0x5bd1) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const TOWN = new Set([C.town, C.commercial, C.industrial, C.building]);
    const nj = this._nearJunction || (() => false);
    const builtUp = (e, n, ne, nn, hw) => [1, -1].some((sd) => { const c = this.classAt(e + ne * (hw + 1.3) * sd, n + nn * (hw + 1.3) * sd); return TOWN.has(c) || [3, 9, 16].some((o) => this.classAt(e + ne * (hw + o) * sd, n + nn * (hw + o) * sd) === C.building); });
    const chunkOf = (e, n) => Math.min(3, Math.max(0, Math.floor(e / 500))) + 4 * Math.min(3, Math.max(0, Math.floor(n / 500)));
    const kerb = [], zebra = [], bumps = [], holes = [];
    for (let c = 0; c < 16; c++) kerb.push({ p: [], c: [] });
    const quad = (K, a, b, c2, d, col, col2 = col) => {
      // a-b at the start of the segment, d-c at the end (a/d inner, b/c outer)
      K.p.push(...a, ...b, ...c2, ...a, ...c2, ...d);
      K.c.push(...col, ...col2, ...col2, ...col, ...col2, ...col);
    };
    this.bumps = [];
    for (const r of this.roads) {
      if (r.cls < 2 || r.cls > 6 || r.dirt || r.flags & 6 || r.pts.length < 2) continue;
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
        let cover = rnd() < 0.4, runLeft = 6 + rnd() * 20;
        const prof = (i) => {
          const [e, n] = P[i], [ne, nn] = N[i];
          const at = (o) => [e + ne * o * side, n + nn * o * side];
          const c0 = this.classAt(...at(hw + 1.3));
          // built-up: tagged town land, or buildings close beside the road (most of Kerala's streets are untagged)
          const town = c0 !== C.water && c0 !== C.sea && (TOWN.has(c0) || [3, 8, 14, 20].some((o) => [-5, 5].some((t) => this.classAt(at(hw + o)[0] + N[i][2] * t, at(hw + o)[1] + N[i][3] * t) === C.building)));
          const shop = town && (this.classAt(...at(hw + 2.6)) === C.building || this.classAt(...at(hw + 1.3)) === C.commercial);
          const y0 = Math.max(this.heightAt(...at(hw)), this.heightAt(...at(hw + 0.9))) + lift;
          return { at, y0, town, shop: shop && r.cls <= 5 };
        };
        let A = prof(0);
        for (let i = 1; i < P.length; i++) {
          const B = prof(i);
          const mid = [(P[i][0] + P[i - 1][0]) / 2, (P[i][1] + P[i - 1][1]) / 2];
          if ((runLeft -= 3) < 0) { cover = !cover; runLeft = cover ? 3 + rnd() * 9 : 6 + rnd() * 24; }
          if (A.town && B.town && inTile(mid) && !nj(mid[0], mid[1]) && !nj(...A.at(hw + 0.5)) && !nj(...B.at(hw + 0.5))) {
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
              edge(hw + 0.2, -0.04, hw + 0.75, -0.04, [0.012, 0.016, 0.01]);      // black water / silt
              edge(hw + 0.75, -0.04, hw + 0.75, 0.17, [0.07, 0.08, 0.06], conc); // outer wall
            }
            if (B.shop && A.shop) {
              edge(hw + 0.75, 0.17, hw + 2.2, 0.2, [0.26 * j, 0.25 * j, 0.22 * j]); // footpath slabs
              edge(hw + 2.2, 0.2, hw + 2.2, -0.35, conc, grime);
            } else edge(hw + 0.75, 0.17, hw + 0.95, -0.35, conc, grime);
          }
          A = B;
        }
      }
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
            if (g) { g.computeVertexNormals(); zebra.push(g); }
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
    // bump lookup grid (50 m cells, game coords)
    this._bg = new Map();
    for (const b of this.bumps) {
      const R = Math.ceil((b.hw + 1) / 50);
      for (let a = -R; a <= R; a++) for (let c = -R; c <= R; c++) { const k = (Math.floor(b.x / 50) + a) * 100003 + Math.floor(b.z / 50) + c; if (!this._bg.has(k)) this._bg.set(k, []); this._bg.get(k).push(b); }
    }
    const out = [];
    kerb.forEach((K, c) => {
      if (!K.p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(K.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(K.c, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, M.klKerb); m.name = 'kerbs'; m.receiveShadow = true;
      m.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250]; m.userData.far = 450;
      out.push(m);
    });
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
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const P = g.attributes.position.array; for (let i = 0; i < P.length; i += 9) for (let q = 0; q < 3; q++) { const t = P[i + 3 + q]; P[i + 3 + q] = P[i + 6 + q]; P[i + 6 + q] = t; } g.computeVertexNormals(); }
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
    const mats = [], wire = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
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
          if (e < 1 || n < 1 || e > TILE - 1 || n > TILE - 1 || c === C.water || c === C.sea || c === C.building || this.nearRoad(e, n, Math.min(4.5, off - 0.4))) { prev = null; continue; }
          // crossarm across the road: local x -> the road's normal in game space
          const nx = un * side, nz = ue * side, th = Math.atan2(-nz, nx), y = this.heightAt(e, n);
          q.setFromAxisAngle(up, th + (rnd() - 0.5) * 0.08);
          const ch = Math.min(3, Math.floor(e / 500)) + 4 * Math.min(3, Math.floor(n / 500));
          mats.push([m4.compose(v.set(-e, y - 0.05, n), q, one).clone(), ch]);
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
    if (!dash) return (() => { const g = this._ribbon(P, hw, yOf, 1e9); if (g) g.computeVertexNormals(); return g; })();
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
          if (on && seg.length > 1) { const g = this._ribbon(seg, hw, yOf, 1e9); if (g) { g.computeVertexNormals(); geos.push(g); } }
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
  nearRoad(e, n, dist, maxCls = 10) {
    if (!this._rg) {
      const RG = this._rg = new Map(), G = 25;
      for (const r of this.roads) for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++)
          for (let gz = Math.floor(Math.min(a[1], b[1]) / G); gz <= Math.floor(Math.max(a[1], b[1]) / G); gz++) {
            const k = gx * 1000 + gz; if (!RG.has(k)) RG.set(k, []); RG.get(k).push(a[0], a[1], b[0], b[1], r.cls);
          }
      }
    }
    const G = 25, R = Math.ceil(dist / G);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const L = this._rg.get((Math.floor(e / G) + a) * 1000 + Math.floor(n / G) + b); if (!L) continue;
      for (let j = 0; j < L.length; j += 5) {
        if (L[j + 4] > maxCls) continue;
        const ax = L[j], az = L[j + 1], dx = L[j + 2] - ax, dz = L[j + 3] - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - az) * dz) / l2));
        if ((ax + dx * t - e) ** 2 + (az + dz * t - n) ** 2 < dist * dist) return true;
      }
    }
    return false;
  }

  _buildings(M, d, opts) {
    const byMat = new Map(), roofsTile = [], roofsFlat = [], tanks = [], ledges = [];
    const D = { props: { ac: [], pipe: [], balc: [], gate: [] }, walls: [], ao: [] };
    for (let c = 0; c < 16; c++) { D.walls.push({ p: [], c: [] }); D.ao.push({ p: [], c: [] }); }
    const push = (key, g) => { let l = byMat.get(key); if (!l) byMat.set(key, (l = [])); l.push(g); };
    let s = (this.tx * 2654435761 ^ this.tz * 40503) >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const maxB = opts.maxBuildings ?? 6000;
    const list = d.b || [];
    for (let bi = 0; bi < list.length && bi < maxB; bi++) {
      const b = list[bi];
      const kind = b[0], H = b[1] / 10;
      const ring = decodeLine(b, 2);
      if (ring.length < 3) continue;
      // counter-clockwise in e/n
      let area = 0;
      for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; area += x1 * y2 - x2 * y1; }
      if (area < 0) ring.reverse();
      area = Math.abs(area) / 2;
      let base = Infinity;
      for (const [e, n] of ring) base = Math.min(base, this.heightAt(e, n));
      base -= 0.4;
      const top = base + 0.4 + H;
      const house = kind === 1 || kind === 2 || (kind === 0 && H < 8.5);
      const tiled = house && area < 320 && rnd() < 0.62;
      // flat roofs have a parapet round the terrace
      const wallTop = tiled ? top : top + 0.9;
      // walls
      const n = ring.length, pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), idx = [];
      let u = 0;
      const colW = kind === 1 || kind === 2 || kind === 0 ? 3.4 : 3.1, floorH = 3.1;
      for (let i = 0; i < n; i++) {
        const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n];
        const L = Math.hypot(e2 - e1, n2 - n1);
        const q = i * 4;
        pos.set([-e1, base, n1, -e2, base, n2, -e1, wallTop, n1, -e2, wallTop, n2], q * 3);
        uv.set([u / (colW * 8), 0, (u + L) / (colW * 8), 0, u / (colW * 8), (wallTop - base) / (floorH * 8), (u + L) / (colW * 8), (wallTop - base) / (floorH * 8)], q * 2);
        u += L;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); // outward: the x axis is mirrored
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      wg.setIndex(idx); wg.computeVertexNormals();
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
        pg.setIndex(ii); pg.computeVertexNormals();
        push(fac, pg);
      }
      // concrete sunshades (chajjas) over each floor's windows: real ledges, drawn near the camera only
      if (kind !== 5 && kind < 6 && opts.ledges) {
        const floors = Math.min(5, Math.floor((H + 0.4) / floorH));
        for (let f = 0; f < floors; f++) {
          const y = base + (f + 1) * floorH - 0.62;
          if (y > top - 0.3) break;
          for (let i = 0; i < n; i++) {
            const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n], L = Math.hypot(e2 - e1, n2 - n1);
            if (L < 2.2) continue;
            const ue = (e2 - e1) / L, un = (n2 - n1) / L, oe = un * 0.55, on = -ue * 0.55; // outward (ring is CCW in e/n)
            const a0 = [e1 + ue * 0.3, n1 + un * 0.3], a1 = [e2 - ue * 0.3, n2 - un * 0.3];
            const P = (pt, o, yy) => [-(pt[0] + oe * o), yy, pt[1] + on * o];
            const v = [P(a0, 0, y), P(a1, 0, y), P(a0, 1, y), P(a1, 1, y), P(a0, 1, y - 0.09), P(a1, 1, y - 0.09), P(a0, 0, y - 0.09), P(a1, 0, y - 0.09)];
            ledges.push([v, Math.min(3, Math.floor(e1 / 500)) + 4 * Math.min(3, Math.floor(n1 / 500))]);
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
        rg.setIndex(ri); faceUp(rg); rg.computeVertexNormals();
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
        rg.setIndex(ri); faceUp(rg); rg.computeVertexNormals();
        roofsFlat.push(rg);
      }
      // collider: the footprint's oriented box (principal axes)
      if (area > 12) this.colliders.push(this._obb(ring, top));
      if (opts.ledges) this._details(D, { ring, n, base, top, wallTop, H, area, house, tiled, shop, kind, ce, cn, floorH }, rnd);
    }
    const out = [];
    for (const [fac, geos] of byMat) { const g = mergeGeometries(geos); if (g) { const m = new THREE.Mesh(g, M.facades[fac] || M.facades[6]); m.castShadow = !!opts.shadows; m.receiveShadow = true; out.push(m); } }
    const strip = (gs) => gs.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; });
    if (roofsTile.length) { const g = mergeGeometries(roofsTile); if (g) { const m = new THREE.Mesh(g, M.klRoofTile); m.castShadow = !!opts.shadows; m.name = 'roofsTile'; out.push(m); } }
    // ledges in 500 m chunks, so only the ones near the camera are drawn (3 quads each: top, front, underside)
    for (let c = 0; c < 16; c++) {
      const L = ledges.filter((l) => l[1] === c);
      if (!L.length) continue;
      const pos = new Float32Array(L.length * 8 * 3), idx = [];
      L.forEach(([v], i) => {
        v.forEach((p, j) => pos.set(p, (i * 8 + j) * 3));
        const q = i * 8;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3, q + 2, q + 4, q + 3, q + 3, q + 4, q + 5, q + 4, q + 6, q + 5, q + 5, q + 6, q + 7);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, M.klLedge || M.klRoofFlat); m.name = 'ledges'; m.castShadow = !!opts.shadows; m.receiveShadow = true;
      m.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250];
      out.push(m);
    }
    if (roofsFlat.length) { const g = mergeGeometries(strip(roofsFlat)); if (g) out.push(new THREE.Mesh(g, M.klRoofFlat)); }
    if (tanks.length) { const g = mergeGeometries(tanks); if (g) out.push(new THREE.Mesh(g, M.klTank)); }
    if (opts.ledges) out.push(...this._detailMeshes(D, M, opts));
    return out;
  }

  // Building details, near the camera only: split AC units on the walls of shops and flats, PVC downpipes off the
  // terraces, balconies on two-storey houses, the compound wall round a house plot with its gate toward the road
  // (walls are solid), and a soft dark skirt where every wall meets the ground.
  _details(D, B, rnd) {
    const { ring, n, base, top, wallTop, H, area, house, tiled, shop, ce, cn, floorH } = B;
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
    const floors = Math.max(1, Math.floor((H + 0.4) / floorH));
    // AC units (flats, shops, offices; the odd better-off house)
    if ((!house && rnd() < 0.6) || (house && floors >= 2 && rnd() < 0.2)) {
      const k = 1 + Math.floor(rnd() * Math.min(4, floors));
      for (let j = 0; j < k; j++) {
        const [i, L] = edges[Math.floor(rnd() * n)];
        if (L < 3) continue;
        const f = shop ? 1 + Math.floor(rnd() * Math.max(1, floors - 1)) : Math.floor(rnd() * floors);
        const y = base + 0.4 + f * floorH + 1.0;
        if (y + 0.6 < top) place(D.props.ac, i, 0.15 + rnd() * 0.7, y, 0.2);
      }
    }
    // downpipe from the terrace at a corner
    if (!tiled && rnd() < 0.6) {
      const [i, L] = edges[Math.floor(rnd() * n)];
      if (L > 1.5) place(D.props.pipe, i, 0.3 / L, base, 0.08, 1, wallTop - base);
    }
    // balcony on the long side of a two-storey house
    if (house && floors >= 2 && rnd() < 0.55) {
      const [i, L] = edges.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (L > 4) place(D.props.balc, i, 0.5, base + 0.4 + floorH - 0.05, 0, Math.min(3.6, L * 0.55));
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
    // compound wall round a house plot, with a gate on the side facing the road
    if (!house || area > 320 || shop || rnd() > 0.7) return;
    const off = 2 + rnd() * 1.6, R = ring.map(([e, nn]) => { const de = e - ce, dn = nn - cn, l = Math.hypot(de, dn) || 1; return [e + de / l * off * 1.3, nn + dn / l * off * 1.3]; });
    const laterite = rnd() < 0.35, j = 0.85 + rnd() * 0.2;
    const top0 = laterite ? [0.24 * j, 0.09 * j, 0.045 * j] : [0.36 * j, 0.35 * j, 0.32 * j], low = laterite ? [0.12, 0.05, 0.03] : [0.08, 0.09, 0.05];
    const clear = (e, nn) => e > 0.5 && nn > 0.5 && e < TILE - 0.5 && nn < TILE - 0.5 && !this.nearRoad(e, nn, 4.2, 9) && this.classAt(e, nn) !== C.building && this.classAt(e, nn) !== C.road && this.classAt(e, nn) !== C.water;
    let gateDone = false;
    const W = D.walls[C0], HW = 1.45, T = 0.1;
    const piece = (a, b) => {
      const de = b[0] - a[0], dn = b[1] - a[1], L = Math.hypot(de, dn);
      if (L < 0.6) return;
      const ne = -dn / L * T, nn = de / L * T, ya = this.heightAt(...a) - 0.1, yb = this.heightAt(...b) - 0.1;
      const V = (p, o, y) => [-(p[0] + ne * o), y, p[1] + nn * o];
      const q = (p1, p2, p3, p4, c1, c2) => { W.p.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4); W.c.push(...c1, ...c1, ...c2, ...c1, ...c2, ...c2); };
      for (const o of [1, -1]) q(V(a, o, ya), V(b, o, yb), V(b, o, yb + HW), V(a, o, ya + HW), low, top0);
      q(V(a, 1, ya + HW), V(b, 1, yb + HW), V(b, -1, yb + HW), V(a, -1, ya + HW), top0, top0);
      const ang = Math.atan2(-de / L, dn / L);
      this.colliders.push({ cx: -(this.E0 + (a[0] + b[0]) / 2), cz: this.N0 + (a[1] + b[1]) / 2, hx: 0.15, hz: L / 2, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: Math.max(ya, yb) + HW, kind: 'barrier' });
    };
    for (let i = 0; i < n; i++) {
      const a = R[i], b = R[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1) continue;
      const ue = (b[0] - a[0]) / L, un = (b[1] - a[1]) / L;
      // the gate: the first side whose outward side reaches a road
      let gate = -1;
      if (!gateDone && L > 4.5) { const me = (a[0] + b[0]) / 2 + un * 7, mn = (a[1] + b[1]) / 2 - ue * 7; if (this.nearRoad(me, mn, 6, 9)) { gate = L / 2; gateDone = true; } }
      // runs of clear ground, sampled every 1 m, broken at the gate
      let run = null;
      for (let d = 0; d <= L + 1e-6; d = Math.min(L, d + 1) + (d >= L ? 1 : 0)) {
        const p = [a[0] + ue * d, a[1] + un * d], ok = clear(...p) && !(gate >= 0 && Math.abs(d - gate) < 1.6);
        if (ok) { if (!run) run = p; else if (d >= L) { piece(run, p); run = null; } }
        else if (run) { piece(run, [a[0] + ue * (d - 1), a[1] + un * (d - 1)]); run = null; }
        if (d >= L) { if (run) piece(run, p); break; }
      }
      if (gate >= 0) {
        const ge = a[0] + ue * gate, gn = a[1] + un * gate;
        {
          Z.set(-un, 0, -ue); X.crossVectors(Y, Z);
          m4.makeBasis(X, Y, Z).setPosition(-ge, this.heightAt(ge, gn) - 0.05, gn);
          D.props.gate.push([m4.clone(), C0]);
          const ang = Math.atan2(ue, un);
          this.colliders.push({ cx: -(this.E0 + ge), cz: this.N0 + gn, hx: 0.12, hz: 1.5, cos: Math.cos(ang), sin: Math.sin(ang), angle: ang, h: this.heightAt(ge, gn) + 1.6, kind: 'barrier' });
        }
      }
    }
  }

  _detailMeshes(D, M, opts) {
    const out = [], cc = (c) => [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250];
    const geo = { ac: opts.acGeo, pipe: opts.pipeGeo, balc: opts.balconyGeo, gate: opts.gateGeo };
    for (const [k, list] of Object.entries(D.props)) {
      if (!geo[k]) continue;
      for (let c = 0; c < 16; c++) {
        const L = list.filter((q) => q[1] === c);
        if (!L.length) continue;
        const im = new THREE.InstancedMesh(geo[k], M.klStop, L.length);
        L.forEach(([m], i) => im.setMatrixAt(i, m));
        im.computeBoundingSphere(); im.name = 'detail_' + k; im.castShadow = !!opts.shadows && k !== 'pipe';
        im.userData.cc = cc(c); im.userData.far = 350;
        out.push(im);
      }
    }
    const mk = (A, mat, name, far, cols = 3) => {
      if (!A.p.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(A.c, cols));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.name = name; m.userData.far = far; return m;
    };
    D.walls.forEach((A, c) => { const m = mk(A, M.klKerb, 'compound', 400); if (m) { m.userData.cc = cc(c); m.castShadow = !!opts.shadows; m.receiveShadow = true; out.push(m); } });
    if (M.klAO) D.ao.forEach((A, c) => { const m = mk(A, M.klAO, 'ao', 400, 4); if (m) { m.userData.cc = cc(c); m.renderOrder = 1; out.push(m); } });
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
      if (o.geometry && o.name !== 'treesFar' && o.name !== 'palmsFar') o.geometry.dispose();
      if (o.material && o.name === 'terrain') { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.group?.removeFromParent();
    this.cls = null; this.visCanvas = null; this.trees = null; this._rg = null; this._bg = null; this.bumps = [];
  }
}
