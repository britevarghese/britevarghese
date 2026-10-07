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
const ROAD_HALF = [7, 6, 4.6, 4, 3.5, 2.8, 2.6, 2.2, 1.9, 1.6, 2];
// land-use / class raster codes (R channel of the class canvas)
export const C = { land: 0, paddy: 1, grove: 2, forest: 3, town: 4, commercial: 5, industrial: 6, grass: 7, sand: 8, rock: 9, religious: 10, scrub: 11, wetland: 12, water: 20, sea: 21, road: 30, building: 31 };
const LU_COLOR = {
  0: '#4d7531', 1: '#7aa83a', 2: '#3d6528', 3: '#2a4a1f', 4: '#5f7040', 5: '#7d7a6a', 6: '#77746a', 7: '#5f9038',
  8: '#d6c493', 9: '#8a7a68', 10: '#6b7a44', 11: '#6a7838', 12: '#4d6a44',
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
    return this.cls[(py * RASTER + px) * 4];
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
    for (const m of this._buildings(M, d, opts)) g.add(m);
    const palms = this._palms(opts);
    if (palms) g.add(palms);
    g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    g.updateMatrixWorld(true);
    this.ready = true;
    return g;
  }

  // class canvas (what is where: water / land use / roads / buildings) + the visible ground colours
  _rasters(d) {
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = RASTER; return c; };
    const vis = mk(), cl = mk(), V = vis.getContext('2d'), K = cl.getContext('2d');
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
    for (let i = 0; i < 900; i++) { V.fillStyle = rnd() < 0.5 ? '#2f4a20' : '#8a7a4a'; const r = 1 + rnd() * 4; V.beginPath(); V.arc(rnd() * RASTER, rnd() * RASTER, r, 0, 6.283); V.fill(); }
    V.globalAlpha = 1;
    // roads and buildings into the class map (palms keep off them)
    K.lineCap = 'round';
    for (const r of this.roads) {
      K.strokeStyle = `rgb(${C.road},0,0)`; K.lineWidth = Math.max(1.5, (ROAD_HALF[r.cls] * 2 + 3) * PX);
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
      if (c === C.water || c === C.sea) H[j * GRID + i] = Math.min(H[j * GRID + i], 0) - 2.2;
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
        const [ae, an] = pts[i - 1], [be, bn] = pts[i], L = Math.hypot(be - ae, bn - an), k = Math.ceil(L / 9);
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
      const yl = yOf(e + ne, n + nn), yr = yOf(e - ne, n - nn);
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
    // wider classes sit a hair higher so junctions don't flicker
    for (const r of this.roads) {
      if (r.flags & 4) continue; // tunnels: not drawn on the surface
      const lanes = r.lanes || (r.cls <= 1 ? 4 : r.cls <= 3 ? 2 : r.cls <= 6 ? 2 : 1);
      const hw = r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], lanes * 1.75) : ROAD_HALF[r.cls];
      const lift = 0.07 + (10 - r.cls) * 0.004;
      const g = this._ribbon(r.pts, hw, y(lift), 7);
      if (!g) continue;
      g.computeVertexNormals();
      (r.dirt ? dirt : paved).push(g);
      if (r.dirt || r.cls > 6) continue;
      // markings: dashed white centre line (Indian roads), solid edge lines on the main roads
      const cl = this._dashes(r.pts, 0, 0.08, r.cls <= 4 ? 3 : 0, r.cls <= 4 ? 6 : 0, y(lift + 0.012));
      if (cl) white.push(cl);
      if (r.cls <= 3) for (const side of [1, -1]) { const e = this._dashes(r.pts, side * (hw - 0.35), 0.08, 0, 0, y(lift + 0.012)); if (e) (r.cls <= 1 ? yellow : white).push(e); }
    }
    const out = [];
    const add = (list, mat, name) => { if (!list.length) return; const gg = mergeGeometries(list); if (!gg) return; const m = new THREE.Mesh(gg, mat); m.receiveShadow = true; m.name = name; out.push(m); };
    add(paved, M.road, 'roads');
    add(dirt, M.klDirtRoad || M.dirt, 'tracks');
    add(white, M.klLineWhite, 'lines');
    add(yellow, M.klLineYellow, 'linesY');
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
  _buildings(M, d, opts) {
    const byMat = new Map(), roofsTile = [], roofsFlat = [], tanks = [];
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
      // walls
      const n = ring.length, pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), idx = [];
      let u = 0;
      const colW = kind === 1 || kind === 2 || kind === 0 ? 3.4 : 3.1, floorH = 3.1;
      for (let i = 0; i < n; i++) {
        const [e1, n1] = ring[i], [e2, n2] = ring[(i + 1) % n];
        const L = Math.hypot(e2 - e1, n2 - n1);
        const q = i * 4;
        pos.set([-e1, base, n1, -e2, base, n2, -e1, top, n1, -e2, top, n2], q * 3);
        uv.set([u / (colW * 8), 0, (u + L) / (colW * 8), 0, u / (colW * 8), (top - base) / (floorH * 8), (u + L) / (colW * 8), (top - base) / (floorH * 8)], q * 2);
        u += L;
        idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); // outward: the x axis is mirrored
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      wg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      wg.setIndex(idx); wg.computeVertexNormals();
      // facade: houses in Kerala's paint colours, shops / flats / offices concrete, places of worship white
      const house = kind === 1 || kind === 2 || (kind === 0 && H < 8.5);
      // Kerala plaster in a painted tint for homes and most shops / flats; churches, temples and mosques white;
      // industrial sheds corrugated metal; a few concrete office blocks
      const KF = opts.keralaFacade ?? 6;
      const fac = kind === 5 ? 3 : kind === 6 || kind === 7 || kind === 8 ? KF + 6 : kind === 4 && H > 12 ? (rnd() < 0.5 ? 6 : 1) : KF + 1 + Math.floor(rnd() * 8);
      push(fac, wg);
      // roof
      const contour = ring.map(([e, nn]) => new THREE.Vector2(-e, nn));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const tiled = house && area < 320 && rnd() < 0.62;
      if (tiled) {
        // hip roof: eaves ring, ridge ring pulled in toward the centre and raised
        let ce = 0, cn = 0; for (const [e, nn] of ring) { ce += e; cn += nn; } ce /= n; cn /= n;
        const rise = Math.min(2.6, 0.9 + Math.sqrt(area) * 0.12), k = 0.42, ov = 0.45;
        const rp = [], ri = [];
        const eaves = ring.map(([e, nn]) => { const de = e - ce, dn = nn - cn, l = Math.hypot(de, dn) || 1; return [e + de / l * ov, nn + dn / l * ov]; });
        eaves.forEach(([e, nn]) => rp.push(-e, top - 0.15, nn));
        ring.forEach(([e, nn]) => rp.push(-(ce + (e - ce) * k), top + rise, cn + (nn - cn) * k));
        for (let i = 0; i < n; i++) { const a = i, b2 = (i + 1) % n, c2 = n + i, d2 = n + (i + 1) % n; ri.push(a, c2, b2, b2, c2, d2); }
        for (const t of tris) ri.push(n + t[0], n + t[2], n + t[1]);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
        rg.setIndex(ri); faceUp(rg); rg.computeVertexNormals();
        roofsTile.push(rg);
      } else {
        // flat concrete terrace; most homes keep a black water tank up there
        if (house && rnd() < 0.55 && opts.tankGeo) {
          let ce = 0, cn = 0; for (const [e, nn] of ring) { ce += e; cn += nn; } ce /= n; cn /= n;
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
    }
    const out = [];
    for (const [fac, geos] of byMat) { const g = mergeGeometries(geos); if (g) { const m = new THREE.Mesh(g, M.facades[fac] || M.facades[6]); m.castShadow = !!opts.shadows; m.receiveShadow = true; out.push(m); } }
    const strip = (gs) => gs.map((g) => { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; });
    if (roofsTile.length) { const g = mergeGeometries(strip(roofsTile)); if (g) { const m = new THREE.Mesh(g, M.klRoofTile); m.castShadow = !!opts.shadows; out.push(m); } }
    if (roofsFlat.length) { const g = mergeGeometries(strip(roofsFlat)); if (g) out.push(new THREE.Mesh(g, M.klRoofFlat)); }
    if (tanks.length) { const g = mergeGeometries(tanks); if (g) out.push(new THREE.Mesh(g, M.klTank)); }
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
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.name === 'terrain') { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.group?.removeFromParent();
    this.cls = null; this.visCanvas = null;
  }
}
