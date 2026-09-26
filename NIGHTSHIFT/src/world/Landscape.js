// Landscape: draws the countryside described by Terrain.js: detailed terrain tiles around the city, a
// coarse horizon ring out to 15 km, the sea, forests, country roads with markings and guard rails, and
// the landmarks (observatory and masts, the PORT HALVERN sign, pier with Ferris wheel, lighthouse,
// farm, diner, wind farm). Terrain and trees use a long aerial-perspective haze instead of the city's
// short fog, so mountains stay visible as bluish silhouettes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrain, ringEdgeDist, bearing, seaMask, mountainMask, shoreDist, SEA, NEAR, FAR, LANDMARKS, DECKS, fbm } from './Terrain.js';
import { RING, RING_CORNER_R } from './CityLayout.js';
import * as TX from '../renderer/Textures.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const C = (hex) => new THREE.Color(hex);
const PAL = {
  lush: C(0x4a6a2a), dry: C(0x8c8646), forest: C(0x2a3f1f), rock: C(0x6e675d), rockDark: C(0x4b4640), snow: C(0xeef1f5),
  sand: C(0xd9c9a0), wetSand: C(0x9c8c6c), seabed: C(0x5a6a5a), verge: C(0x3e5a2a),
  fields: [C(0xa89a52), C(0x6a8a34), C(0x735a3c), C(0x8fa04a), C(0xb8a060)],
};
const TREE_TILE = 400;

// long-range haze + world-space detail for terrain / trees / landmarks
function hazeMaterial(mat, uniforms, detail = null) {
  mat.fog = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFogK = uniforms.uFogK;
    if (detail) sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#ifdef USE_INSTANCING\n  vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    let f = 'varying vec3 vWPos;\nuniform float uFogK;\n' + (detail ? 'uniform sampler2D uDetail;\n' : '') + sh.fragmentShader;
    if (detail) f = f.replace('#include <color_fragment>', `#include <color_fragment>
  {
    float dd = length(vWPos - cameraPosition);
    float g1 = texture2D(uDetail, vWPos.xz / 9.0).g, g2 = texture2D(uDetail, vWPos.xz / 57.0).g;
    float k = mix(0.72 + 0.62 * g1, 1.0, smoothstep(250.0, 900.0, dd));
    diffuseColor.rgb *= k * mix(0.9 + 0.25 * g2, 1.0, smoothstep(1500.0, 4000.0, dd));
  }`);
    f = f.replace('#include <fog_fragment>', `#ifdef USE_FOG
  {
    float fdist = length(vWPos - cameraPosition);
    float ff = 1.0 - exp(-fdist * uFogK);
    // haze thins with altitude: peaks stay clearer than the valley floor
    ff *= mix(1.0, 0.72, smoothstep(100.0, 900.0, vWPos.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(ff, 0.0, 1.0));
  }
#endif`);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'haze' + (detail ? 'D' : '');
  return mat;
}

export class Landscape {
  constructor(scene, M, preset) {
    this.scene = scene; this.M = M; this.preset = preset;
    this.T = terrain();
    this.group = new THREE.Group(); this.group.name = 'landscape';
    scene.add(this.group);
    this.uniforms = { uFogK: { value: 1 / 7000 } };
    this.t = 0;
    const detail = TX.grass().map;
    this.terrainMat = hazeMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), this.uniforms, detail);
    this.farMat = hazeMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), this.uniforms);
    this._near();
    this._far();
    this._sea();
    this._roads();
    this._trees();
    this._landmarks();
  }

  // ------------------------------------------------------------------ terrain colour
  _color(x, z, h, ny, out) {
    const T = this.T, d = ringEdgeDist(x, z), a = bearing(x, z);
    out.copy(PAL.lush).lerp(PAL.dry, smooth(0.35, 0.7, fbm(x / 1100, z / 1100, 3, 5)) * (1 - mountainMask(a) * 0.5));
    const fr = T.forest(x, z);
    out.lerp(PAL.forest, fr * 0.75);
    const fm = T.fieldMask(x, z);
    if (fm > 0.01) {
      // fields: rotated rectangular plots, each its own crop colour, with darker hedgerows
      const u = x * 0.8 + z * 0.6, v = -x * 0.6 + z * 0.8;
      const cu = Math.floor(u / 140), cv = Math.floor(v / 95);
      const k = Math.abs((cu * 7349 + cv * 1597) % PAL.fields.length);
      const edge = Math.min(u / 140 - cu, 1 - (u / 140 - cu), v / 95 - cv, 1 - (v / 95 - cv));
      const fc = _t.copy(PAL.fields[k]);
      if (edge < 0.04) fc.lerp(PAL.forest, 0.7);
      out.lerp(fc, fm);
    }
    if (d < 40) out.lerp(PAL.verge, 1 - smooth(10, 40, d));
    // coast: sand above the water line, wet sand and sea bed below
    const sm = seaMask(a);
    if (sm > 0.01) {
      const sh = shoreDist(a);
      const beach = sm * smooth(sh - 170, sh - 90, d);
      out.lerp(PAL.sand, beach);
      if (h < SEA + 0.4) out.copy(h < SEA - 2 ? PAL.seabed : PAL.wetSand);
    }
    if (h < SEA + 0.3 && sm < 0.5) out.lerp(PAL.wetSand, 0.8); // lake shores
    // rock on steep ground and high up, snow on the peaks
    const steep = smooth(0.62, 0.82, 1 - ny) + smooth(260, 520, h) * 0.5;
    if (steep > 0) out.lerp(fbm(x / 60, z / 60, 2, 8) > 0.5 ? PAL.rock : PAL.rockDark, clamp(steep, 0, 1));
    const snowLine = 470 + (fbm(x / 400, z / 400, 3, 9) - 0.5) * 160;
    const snow = smooth(snowLine, snowLine + 60, h) * smooth(0.45, 0.7, ny);
    if (snow > 0) out.lerp(PAL.snow, snow);
    return out;
  }

  // ------------------------------------------------------------------ detailed terrain (tiles)
  _near() {
    const q = this.preset;
    const S = q.textureSize >= 2048 ? 12 : q.textureSize >= 1024 ? 16 : q.textureSize >= 512 ? 24 : 32;
    const N = Math.round((NEAR * 2) / S), T = this.T;
    const H = new Float32Array((N + 1) * (N + 1));
    const Dm = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = -NEAR + i * S, z = -NEAR + j * S, k = j * (N + 1) + i;
      const d = ringEdgeDist(x, z);
      Dm[k] = d;
      H[k] = d < -2 ? -3.5 : T.height(x, z);
    }
    const hAt = (i, j) => H[clamp(j, 0, N) * (N + 1) + clamp(i, 0, N)];
    const CG = new Uint8Array((N + 1) * (N + 1) * 3);
    this.grid = { N, S, H, C: CG, Dm };
    const TILE = 48, col = new THREE.Color();
    for (let tj = 0; tj < N; tj += TILE) for (let ti = 0; ti < N; ti += TILE) {
      const i1 = Math.min(N, ti + TILE), j1 = Math.min(N, tj + TILE);
      // skip tiles entirely inside the city
      let any = false;
      for (let j = tj; j <= j1 && !any; j += 4) for (let i = ti; i <= i1; i += 4) if (Dm[j * (N + 1) + i] > -30) { any = true; break; }
      if (!any) continue;
      const w = i1 - ti + 1, hgt = j1 - tj + 1;
      const pos = new Float32Array(w * hgt * 3), nor = new Float32Array(w * hgt * 3), cols = new Float32Array(w * hgt * 3);
      const idx = [];
      for (let j = tj; j <= j1; j++) for (let i = ti; i <= i1; i++) {
        const v = (j - tj) * w + (i - ti), x = -NEAR + i * S, z = -NEAR + j * S, y = hAt(i, j);
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const nx = hAt(i - 1, j) - hAt(i + 1, j), nz = hAt(i, j - 1) - hAt(i, j + 1), ny = 2 * S;
        const l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        this._color(x, z, y, ny / l, col);
        cols[v * 3] = col.r; cols[v * 3 + 1] = col.g; cols[v * 3 + 2] = col.b;
        const gk = (j * (N + 1) + i) * 3; CG[gk] = col.r * 255; CG[gk + 1] = col.g * 255; CG[gk + 2] = col.b * 255;
      }
      for (let j = 0; j < hgt - 1; j++) for (let i = 0; i < w - 1; i++) {
        const k = Dm[(tj + j) * (N + 1) + ti + i];
        const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
        // quads well inside the city are dropped (the city draws its own ground)
        if (k < -40 && Dm[(tj + j + 1) * (N + 1) + ti + i + 1] < -40) continue;
        idx.push(a, c, b, b, c, d);
      }
      if (!idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.terrainMat);
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  // ------------------------------------------------------------------ horizon ring (coarse)
  _far() {
    const T = this.T, AS = 320, RS = 46, r0 = NEAR * 0.9;
    const pos = [], cols = [], idx = [], col = new THREE.Color();
    for (let r = 0; r <= RS; r++) {
      const rad = r0 * Math.pow(FAR / r0, r / RS);
      for (let s = 0; s <= AS; s++) {
        const a = (s / AS) * Math.PI * 2, x = Math.sin(a) * rad, z = Math.cos(a) * rad;
        let y = T.height(x, z);
        const inside = Math.abs(x) < NEAR - 30 && Math.abs(z) < NEAR - 30;
        if (inside) y -= 60;
        // slope from neighbours for the colour
        const e = rad * 0.02, ny = 1 / Math.hypot((T.height(x + e, z) - y - (inside ? -60 : 0)) / e, 1);
        pos.push(x, y, z);
        this._color(x, z, y, clamp(ny, 0, 1), col);
        cols.push(col.r, col.g, col.b);
      }
    }
    for (let r = 0; r < RS; r++) for (let s = 0; s < AS; s++) {
      const a = r * (AS + 1) + s, b = a + AS + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.farMat);
    m.frustumCulled = false;
    this.group.add(m);
  }

  // ------------------------------------------------------------------ sea (and lakes: any ground below SEA)
  _sea() {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, FAR, 0, Math.PI * 2, false);
    const Hh = RING + 18, Rc = RING_CORNER_R + 18, Cc = Hh - Rc;
    const hole = new THREE.Path();
    hole.moveTo(Hh, -Cc); hole.lineTo(Hh, Cc); hole.absarc(Cc, Cc, Rc, 0, Math.PI / 2, false);
    hole.lineTo(-Cc, Hh); hole.absarc(-Cc, Cc, Rc, Math.PI / 2, Math.PI, false);
    hole.lineTo(-Hh, -Cc); hole.absarc(-Cc, -Cc, Rc, Math.PI, Math.PI * 1.5, false);
    hole.lineTo(Cc, -Hh); hole.absarc(Cc, -Cc, Rc, Math.PI * 1.5, Math.PI * 2, false);
    shape.holes.push(hole);
    const g = new THREE.ShapeGeometry(shape, 48).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 40, -p.getZ(i) / 40);
    const nm = TX.waterNormal();
    this.seaNormal = nm;
    this.seaMat = hazeMaterial(new THREE.MeshStandardMaterial({ color: 0x0e3a4a, roughness: 0.12, metalness: 0.15, normalMap: nm, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3, transparent: true, opacity: 0.93 }), this.uniforms);
    const sea = new THREE.Mesh(g, this.seaMat);
    sea.position.y = SEA; sea.renderOrder = 1; sea.frustumCulled = false;
    this.group.add(sea);
  }

  // ------------------------------------------------------------------ country roads
  _roads() {
    const T = this.T, pos = [], uv = [], idx = [], lines = { y: [], w: [] }, rails = [];
    for (const rd of T.roads) {
      const s = rd.s, hw = rd.hw, base = pos.length / 3;
      let along = 0;
      for (let i = 0; i < s.length; i++) {
        const p = s[i], q0 = s[Math.max(0, i - 1)], q1 = s[Math.min(s.length - 1, i + 1)];
        const dx = q1.x - q0.x, dz = q1.z - q0.z, l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        if (i) along += Math.hypot(p.x - s[i - 1].x, p.z - s[i - 1].z);
        const y = p.h + 0.035;
        pos.push(p.x + nx * hw, y, p.z + nz * hw, p.x - nx * hw, y, p.z - nz * hw);
        uv.push(0, along / 12, hw * 2 / 12, along / 12);
        if (i < s.length - 1) { const a = base + i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        p.nx = nx; p.nz = nz; p.along = along;
      }
      // markings: dashed yellow centre line, solid white edges (as thin strips)
      const strip = (list, off, wdt, dash) => {
        for (let i = 0; i < s.length - 1; i++) {
          const a = s[i], b = s[i + 1];
          if (dash && Math.floor(a.along / 6) % 2) continue;
          const y0 = a.h + 0.05, y1 = b.h + 0.05, o0 = off - wdt / 2, o1 = off + wdt / 2;
          list.push([a.x + a.nx * o0, y0, a.z + a.nz * o0], [a.x + a.nx * o1, y0, a.z + a.nz * o1], [b.x + b.nx * o1, y1, b.z + b.nz * o1], [b.x + b.nx * o0, y1, b.z + b.nz * o0]);
        }
      };
      strip(lines.y, 0, 0.15, true);
      strip(lines.w, hw - 0.35, 0.14, false); strip(lines.w, -hw + 0.35, 0.14, false);
      // guard rails where the ground falls away beside the road
      for (let i = 0; i < s.length - 1; i += 1) {
        const a = s[i], b = s[i + 1];
        for (const side of [1, -1]) {
          const off = hw + 1.2, px = a.x + a.nx * off * side, pz = a.z + a.nz * off * side;
          const drop = a.h - T.height(a.x + a.nx * (hw + 9) * side, a.z + a.nz * (hw + 9) * side);
          if (drop > 2.2) rails.push({ a, b, side, off });
          void px; void pz;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const road = new THREE.Mesh(g, this.M.road);
    road.receiveShadow = true;
    this.group.add(road);
    const quadsMesh = (list, color) => {
      const p = [], ix = [];
      // one upward face per strip; normals set explicitly (a double-sided quad sharing vertices would
      // average them to zero, which shades as NaN and blacks out the bloom)
      for (let i = 0; i < list.length; i += 4) {
        const b = p.length / 3; p.push(...list[i], ...list[i + 1], ...list[i + 2], ...list[i + 3]);
        const [a0, a1, a2] = [list[i], list[i + 1], list[i + 2]];
        const cy = (a1[2] - a0[2]) * (a2[0] - a0[0]) - (a1[0] - a0[0]) * (a2[2] - a0[2]);
        ix.push(...(cy > 0 ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]));
      }
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); gg.setIndex(ix);
      gg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(p.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
      const m = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
      this.group.add(m);
    };
    quadsMesh(lines.y, 0xd8a820); quadsMesh(lines.w, 0xe8e8e0);
    // guard rails: galvanised steel beam on posts
    const railGeo = [], postGeo = [];
    for (const r of rails) {
      const { a, b, side, off } = r;
      const ax = a.x + a.nx * off * side, az = a.z + a.nz * off * side, bx = b.x + b.nx * off * side, bz = b.z + b.nz * off * side;
      const len = Math.hypot(bx - ax, bz - az);
      const beam = new THREE.BoxGeometry(0.08, 0.32, len + 0.05);
      beam.lookAt(new THREE.Vector3(bx - ax, b.h - a.h, bz - az));
      beam.translate((ax + bx) / 2, (a.h + b.h) / 2 + 0.62, (az + bz) / 2);
      railGeo.push(beam);
      if (Math.floor(a.along / 4) !== Math.floor(b.along / 4)) postGeo.push(new THREE.BoxGeometry(0.12, 0.8, 0.12).translate(ax, a.h + 0.4, az));
    }
    this.rails = rails;
    if (railGeo.length) this.group.add(new THREE.Mesh(mergeGeometries(railGeo), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.7, roughness: 0.35 })));
    if (postGeo.length) this.group.add(new THREE.Mesh(mergeGeometries(postGeo), new THREE.MeshStandardMaterial({ color: 0x8a8e92, metalness: 0.5, roughness: 0.5 })));
  }

  // ------------------------------------------------------------------ forests (instanced, in tiles)
  _treeGeos() {
    const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.toNonIndexed ? g : g; };
    const trunk = (h, r) => paint(new THREE.CylinderGeometry(r * 0.7, r, h, 6).translate(0, h / 2, 0), 0x4a3526);
    const conifer = mergeGeometries([trunk(2.6, 0.28), paint(new THREE.ConeGeometry(2.6, 5.5, 7).translate(0, 4.6, 0), 0x2c4a26), paint(new THREE.ConeGeometry(2.0, 4.6, 7).translate(0, 7.4, 0), 0x325428), paint(new THREE.ConeGeometry(1.3, 3.4, 7).translate(0, 9.9, 0), 0x3a5e2c)].map((g) => g.index ? g.toNonIndexed() : g));
    const leafy = mergeGeometries([trunk(3.4, 0.32), paint(new THREE.IcosahedronGeometry(3.1, 1).scale(1, 0.85, 1).translate(0, 5.6, 0), 0x46652c), paint(new THREE.IcosahedronGeometry(2.2, 1).translate(1.4, 6.9, 0.6), 0x4f7032), paint(new THREE.IcosahedronGeometry(2.0, 1).translate(-1.3, 6.4, -0.9), 0x3f5c28)].map((g) => g.index ? g.toNonIndexed() : g));
    const fronds = [];
    for (let i = 0; i < 7; i++) fronds.push(paint(new THREE.BoxGeometry(0.9, 0.08, 3.8).translate(0, 0, 1.9).rotateX(0.45).rotateY((i / 7) * Math.PI * 2).translate(0.5, 9.4, 0), 0x4c7a2e));
    const palm = mergeGeometries([paint(new THREE.CylinderGeometry(0.22, 0.34, 9.6, 6).translate(0, 4.8, 0).rotateZ(0.05), 0x7a6448), ...fronds].map((g) => g.index ? g.toNonIndexed() : g));
    return [conifer, leafy, palm];
  }
  _trees() {
    const trees = this.T.trees(), geos = this._treeGeos();
    const k = this.preset.trees ?? 1;
    this.treeMat = hazeMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), this.uniforms);
    const tiles = new Map();
    trees.forEach((t, i) => {
      if (!t.drive && (i % 10) / 10 > k) return; // lower presets thin out only the trees you can't reach
      const key = `${Math.floor(t.x / TREE_TILE)},${Math.floor(t.z / TREE_TILE)}`;
      let tl = tiles.get(key); if (!tl) tiles.set(key, (tl = { cx: (Math.floor(t.x / TREE_TILE) + 0.5) * TREE_TILE, cz: (Math.floor(t.z / TREE_TILE) + 0.5) * TREE_TILE, list: [[], [], []] }));
      tl.list[t.type].push(t);
    });
    this.treeTiles = [];
    const m4 = new THREE.Matrix4(), qn = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
    for (const tl of tiles.values()) {
      const meshes = [];
      tl.list.forEach((list, type) => {
        if (!list.length) return;
        const im = new THREE.InstancedMesh(geos[type], this.treeMat, list.length);
        list.forEach((t, j) => {
          qn.setFromAxisAngle(up, t.rot); sc.setScalar(t.s); ps.set(t.x, t.y - 0.2, t.z);
          im.setMatrixAt(j, m4.compose(ps, qn, sc));
          tint.setHSL(0.25 + (t.rot % 0.3) * 0.1, 0.3 + (t.s - 0.75) * 0.3, 0.4 + (t.rot % 1) * 0.2);
          im.setColorAt(j, tint.lerp(new THREE.Color(1, 1, 1), 0.55));
        });
        im.computeBoundingSphere();
        im.castShadow = false; im.receiveShadow = false;
        this.group.add(im);
        meshes.push(im);
      });
      this.treeTiles.push({ cx: tl.cx, cz: tl.cz, meshes });
    }
  }

  // ------------------------------------------------------------------ landmarks
  _mat(color, o = {}) { return hazeMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o }), this.uniforms); }
  _add(geos, mat, cast = true) {
    const g = mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x)));
    const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true;
    this.group.add(m);
    return m;
  }
  _landmarks() {
    const T = this.T, L = LANDMARKS, H = (x, z) => T.height(x, z);
    const white = this._mat(0xe8e8e4, { roughness: 0.5 }), grey = this._mat(0x9aa0a6, { metalness: 0.4, roughness: 0.4 }), dark = this._mat(0x2a2c30);
    const red = this._mat(0xb02820), wood = this._mat(0x7a5a3c, { roughness: 0.9 }), glass = this._mat(0x6a8aa0, { metalness: 0.6, roughness: 0.1 });

    // --- observatory on the summit, radio masts on the neighbouring peaks
    {
      const o = L.observatory, y = H(o.x, o.z);
      this._add([new THREE.BoxGeometry(34, 11, 20).translate(o.x, y + 5.5, o.z), new THREE.BoxGeometry(14, 16, 14).translate(o.x + 22, y + 8, o.z)], white);
      this._add([new THREE.SphereGeometry(8.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(o.x + 22, y + 16, o.z), new THREE.SphereGeometry(6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(o.x - 10, y + 11, o.z)], grey);
      this._add([new THREE.BoxGeometry(1.6, 6, 12).translate(o.x + 22, y + 21, o.z)], dark);
      this._add([new THREE.BoxGeometry(30, 0.3, 4).translate(o.x, y + 3.2, o.z + 12)], glass);
      for (const [mx, mz] of L.masts) {
        const my = H(mx, mz), hh = 70 + ((mx * 7) % 20);
        const parts = [];
        for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; parts.push(new THREE.CylinderGeometry(0.18, 0.45, hh, 4).translate(Math.cos(a) * 1.6, my + hh / 2, Math.sin(a) * 1.6 + 0).translate(mx, 0, mz)); }
        for (let k2 = 6; k2 < hh; k2 += 7) parts.push(new THREE.TorusGeometry(1.7, 0.1, 3, 8).rotateX(Math.PI / 2).translate(mx, my + k2, mz));
        this._add(parts, this._mat(0xc8ccd0, { metalness: 0.6, roughness: 0.4 }), false);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), this.M.beacon); b.position.set(mx, my + hh + 0.5, mz); this.group.add(b);
      }
    }
    // --- the PORT HALVERN sign on the hillside, facing the city
    {
      const s = L.sign, n = s.text.length, sp = 16;
      const fx = -s.x / Math.hypot(s.x, s.z), fz = -s.z / Math.hypot(s.x, s.z);
      const lx = -fz, lz = fx; // viewer's left when looking at the sign from the city
      const letterMat = this._mat(0xf4f4ee, { roughness: 0.6, side: THREE.DoubleSide, alphaTest: 0.5 });
      const scaffold = [];
      for (let i = 0; i < n; i++) {
        const ch = s.text[i];
        if (ch === ' ') continue;
        const off = ((n - 1) / 2 - i) * sp;
        const x = s.x + lx * off, z = s.z + lz * off, y = H(x, z);
        const c = document.createElement('canvas'); c.width = 128; c.height = 160;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = '900 150px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 64, 88);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), letterMat.clone());
        m.material.map = t; m.material.onBeforeCompile = letterMat.onBeforeCompile; m.material.customProgramCacheKey = letterMat.customProgramCacheKey;
        m.position.set(x, y + 10, z); m.rotation.y = Math.atan2(fx, fz); m.rotation.x = -0.12;
        this.group.add(m);
        for (const dx of [-3, 3]) scaffold.push(new THREE.BoxGeometry(0.3, 12, 0.3).translate(x + lx * dx * 1.3 - fx * 1.4, y + 5.5, z + lz * dx * 1.3 - fz * 1.4));
      }
      this._add(scaffold, this._mat(0x5a5a58, { metalness: 0.5 }), false);
    }
    // --- the pier with a Ferris wheel, lifeguard towers on the beach
    {
      const d = DECKS[0], y = d.h;
      const parts = [new THREE.BoxGeometry(d.x1 - d.x0, 0.4, d.z1 - d.z0).translate((d.x0 + d.x1) / 2, y - 0.2, (d.z0 + d.z1) / 2)];
      for (let z = d.z0 + 4; z < d.z1; z += 8) for (const x of [d.x0 + 1, d.x1 - 1]) parts.push(new THREE.CylinderGeometry(0.3, 0.3, y + 8, 6).translate(x, y - (y + 8) / 2, z));
      this._add(parts, wood);
      const rail = [];
      for (const x of [d.x0 + 0.2, d.x1 - 0.2]) rail.push(new THREE.BoxGeometry(0.12, 0.1, d.z1 - d.z0).translate(x, y + 1.0, (d.z0 + d.z1) / 2));
      for (let z = d.z0; z < d.z1; z += 3) for (const x of [d.x0 + 0.2, d.x1 - 0.2]) rail.push(new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(x, y + 0.5, z));
      this._add(rail, white, false);
      // Ferris wheel
      const f = L.ferris, R = 22, cy = y + R + 3;
      const wheel = new THREE.Group(); wheel.position.set(f.x, cy, f.z); wheel.rotation.y = Math.PI / 2;
      const rim = [new THREE.TorusGeometry(R, 0.35, 6, 64), new THREE.TorusGeometry(R - 1.2, 0.2, 6, 64)];
      for (let i = 0; i < 16; i++) rim.push(new THREE.BoxGeometry(0.2, R, 0.2).translate(0, R / 2, 0).rotateZ((i / 16) * Math.PI * 2));
      const rimMesh = new THREE.Mesh(mergeGeometries(rim.map((g) => g.index ? g.toNonIndexed() : g)), this._mat(0xf0f0f0, { metalness: 0.3, emissive: 0x000000 }));
      wheel.add(rimMesh);
      this.gondolas = [];
      for (let i = 0; i < 16; i++) {
        const gm = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.6), this._mat([0xd83a30, 0xf0c030, 0x3080d0, 0x40b060][i % 4]));
        wheel.add(gm); this.gondolas.push({ m: gm, a: (i / 16) * Math.PI * 2 });
      }
      this.group.add(wheel); this.wheel = wheel; this.wheelR = R;
      const legs = [];
      for (const s2 of [-1, 1]) for (const k2 of [-1, 1]) legs.push(new THREE.CylinderGeometry(0.35, 0.5, cy - y, 6).rotateX(s2 * 0.22).translate(f.x + k2 * 2, (cy + y) / 2, f.z + s2 * 5));
      this._add(legs, white);
      // wheel lights at night
      this.wheelLights = new THREE.Mesh(new THREE.TorusGeometry(R + 0.1, 0.25, 4, 96), new THREE.MeshBasicMaterial({ color: 0xff60c0, toneMapped: false }));
      wheel.add(this.wheelLights);
      for (const [x, z] of L.lifeguards) {
        const yy = Math.max(H(x, z), 0.5);
        this._add([new THREE.BoxGeometry(3.4, 2.6, 3.4).translate(x, yy + 3.6, z), ...[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([a, b]) => new THREE.BoxGeometry(0.2, 2.4, 0.2).translate(x + a, yy + 1.2, z + b))], this._mat(0x5aa0c8));
        this._add([new THREE.ConeGeometry(2.8, 1.4, 4).rotateY(Math.PI / 4).translate(x, yy + 5.6, z)], red, false);
      }
    }
    // --- lighthouse with a turning beam
    {
      const o = L.lighthouse, y = H(o.x, o.z);
      const c = document.createElement('canvas'); c.width = 8; c.height = 64; const g = c.getContext('2d');
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#c82a22' : '#f2f2ee'; g.fillRect(0, i * 8, 8, 8); }
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      const tm = this._mat(0xffffff, { map: tx });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, 30, 20), tm); tower.position.set(o.x, y + 15, o.z); tower.castShadow = true; this.group.add(tower);
      this._add([new THREE.CylinderGeometry(4.2, 4.2, 0.5, 20).translate(o.x, y + 30.2, o.z), new THREE.ConeGeometry(3, 3, 16).translate(o.x, y + 35.5, o.z), new THREE.BoxGeometry(12, 4, 8).translate(o.x + 7, y + 2, o.z)], this._mat(0x30343a));
      this._add([new THREE.CylinderGeometry(2.4, 2.4, 3.4, 16).translate(o.x, y + 32.2, o.z)], glass, false);
      this.lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false }));
      this.lamp.position.set(o.x, y + 32.2, o.z); this.group.add(this.lamp);
      const beamGeo = new THREE.ConeGeometry(9, 120, 16, 1, true).translate(0, 60, 0).rotateZ(-Math.PI / 2);
      this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      this.beam.position.copy(this.lamp.position); this.group.add(this.beam);
    }
    // --- farm: barn, farmhouse, silos, hay bales
    {
      const o = L.farm, y = H(o.x, o.z);
      const gable = (w, d, h, x, z) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath(); return new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2).translate(x, 0, z); };
      this._add([new THREE.BoxGeometry(16, 8, 26).translate(o.x, y + 4, o.z)], this._mat(0x9a2a22));
      this._add([gable(17, 27, 6, o.x, o.z).translate(0, y + 8, 0)], this._mat(0x3a3a3c));
      this._add([new THREE.BoxGeometry(12, 6, 10).translate(o.x - 28, y + 3, o.z + 6)], white);
      this._add([gable(13, 11, 4, o.x - 28, o.z + 6).translate(0, y + 6, 0)], this._mat(0x4a2e22));
      this._add([new THREE.CylinderGeometry(3.6, 3.6, 18, 16).translate(o.x + 14, y + 9, o.z - 10), new THREE.CylinderGeometry(3.2, 3.2, 15, 16).translate(o.x + 22, y + 7.5, o.z - 10)], grey);
      this._add([new THREE.SphereGeometry(3.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(o.x + 14, y + 18, o.z - 10), new THREE.SphereGeometry(3.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(o.x + 22, y + 15, o.z - 10)], grey);
      const bales = [];
      for (let i = 0; i < 14; i++) { const bx = o.x + 60 + (i % 5) * 18 + (i * 13 % 7), bz = o.z - 70 + Math.floor(i / 5) * 26; bales.push(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 12).rotateZ(Math.PI / 2).translate(bx, H(bx, bz) + 0.8, bz)); }
      this._add(bales, this._mat(0xc8a858), false);
    }
    // --- roadside diner + gas station
    {
      const o = L.diner, y = H(o.x, o.z);
      this._add([new THREE.BoxGeometry(22, 5, 12).translate(o.x, y + 2.5, o.z + 8)], this._mat(0xd8d2c0));
      this._add([new THREE.BoxGeometry(22.6, 0.6, 12.6).translate(o.x, y + 5.3, o.z + 8)], red);
      this._add([new THREE.BoxGeometry(21, 1.6, 0.2).translate(o.x, y + 2.6, o.z + 1.9)], glass, false);
      this._add([new THREE.BoxGeometry(18, 0.6, 12).translate(o.x, y + 5.6, o.z - 14), ...[[-7, -4], [7, -4], [-7, 4], [7, 4]].map(([a, b]) => new THREE.BoxGeometry(0.4, 5.4, 0.4).translate(o.x + a, y + 2.7, o.z - 14 + b))], white);
      this._add([new THREE.BoxGeometry(1.2, 1.8, 0.8).translate(o.x - 3, y + 0.9, o.z - 14), new THREE.BoxGeometry(1.2, 1.8, 0.8).translate(o.x + 3, y + 0.9, o.z - 14)], red, false);
      const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
      g.fillStyle = '#100808'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#ff4a6a'; g.font = '900 64px Arial Black, Arial'; g.textAlign = 'center'; g.fillText('DINER', 128, 72);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this.neon = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1, toneMapped: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.4), this.neon); sign.position.set(o.x, y + 11, o.z - 3); sign.rotation.y = Math.PI; this.group.add(sign);
      const sign2 = sign.clone(); sign2.rotation.y = 0; sign2.position.z += 0.05; this.group.add(sign2);
      this._add([new THREE.BoxGeometry(0.5, 9, 0.5).translate(o.x, y + 4.5, o.z - 3)], grey, false);
    }
    // --- wind farm (rotors turn)
    {
      this.rotors = [];
      const towerMat = this._mat(0xf2f4f5, { roughness: 0.5 });
      for (const [x, z] of L.turbines) {
        const y = H(x, z), hh = 78;
        this._add([new THREE.CylinderGeometry(1.4, 2.6, hh, 12).translate(x, y + hh / 2, z), new THREE.BoxGeometry(3, 3, 9).translate(x, y + hh + 1.2, z + 1.5)], towerMat);
        const rotor = new THREE.Group(); rotor.position.set(x, y + hh + 1.2, z - 3.4);
        const blades = [];
        for (let i = 0; i < 3; i++) blades.push(new THREE.BoxGeometry(1.6, 34, 0.3).translate(0, 17, 0).rotateZ((i / 3) * Math.PI * 2));
        blades.push(new THREE.SphereGeometry(1.5, 10, 8));
        rotor.add(new THREE.Mesh(mergeGeometries(blades.map((g) => g.index ? g.toNonIndexed() : g)), towerMat));
        // face the prevailing wind (from the south-west)
        const holder = new THREE.Group(); holder.add(rotor); this.group.add(holder);
        rotor.userData.speed = 0.9 + ((x * 13 + z) % 7) * 0.06;
        this.rotors.push(rotor);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 4), this.M.beacon); b.position.set(x, y + hh + 3, z + 1.5); this.group.add(b);
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(camera, env, dt) {
    this.t += dt;
    const e = env || {}, night = e.night ?? 0, rain = e.rain ?? 0, cloud = e.cloud ?? 0;
    // haze: clear days see the whole range; rain and night close in
    this.uniforms.uFogK.value = (1 / 7500) * (1 + rain * 3.5 + cloud * 0.6) * (night > 0.5 ? 1.4 : 1);
    if (this.seaNormal) { this.seaNormal.offset.x = this.t * 0.004; this.seaNormal.offset.y = this.t * 0.0025; }
    const cp = camera.position;
    for (const tl of this.treeTiles) {
      const on = Math.hypot(tl.cx - cp.x, tl.cz - cp.z) < 1500 + Math.max(0, cp.y - 40) * 2;
      for (const m of tl.meshes) m.visible = on;
    }
    if (this.wheel) {
      const a = this.t * 0.05;
      this.wheel.children[0].rotation.z = a;
      for (const g of this.gondolas) { const ang = g.a + a; g.m.position.set(Math.cos(ang) * this.wheelR, Math.sin(ang) * this.wheelR - 1.6, 0); }
      this.wheelLights.visible = night > 0.4;
      this.wheelLights.material.color.setHSL((this.t * 0.05) % 1, 0.9, 0.6);
    }
    if (this.beam) {
      this.beam.visible = night > 0.35;
      this.beam.rotation.y = this.t * 0.9;
      this.lamp.material.color.setScalar(night > 0.35 ? 1 : 0.6);
    }
    if (this.neon) this.neon.emissiveIntensity = 0.4 + night * 1.6;
    for (const r of this.rotors) r.rotation.z -= dt * r.userData.speed;
  }
}
const _t = new THREE.Color();
