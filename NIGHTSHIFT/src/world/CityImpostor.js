// CityImpostor: the whole city as a handful of cheap merged meshes (building shells with the far facade
// materials, flat roofs, and a painted ground plate) for the chunks that aren't streamed in. Seen from
// the hills, the coast or the air, Port Halvern keeps its skyline instead of vanishing into fog. Every
// vertex carries its chunk; a tiny "loaded chunks" texture hides the impostor wherever the real chunk
// is drawn, so the two never overlap.
import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder.js';
import { FACADE_DEF } from '../renderer/Textures.js';
import { ROAD_TYPES, RIVER, RING, lineHalfWidth } from './CityLayout.js';
import { rng } from '../core/util.js';

const CH = 160, MIN = -9, N = 18; // chunk grid as in ChunkManager (MIN..MIN+N-1)
const SPAN = 1320;               // ground plate half size

function masked(base, tex) {
  const m = base.clone();
  const orig = base.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    orig?.call(base, sh, r);
    sh.uniforms.uLoaded = { value: tex };
    sh.vertexShader = 'attribute vec2 chunk;\nuniform sampler2D uLoaded;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  if (texture2D(uLoaded, chunk).r > 0.5) gl_Position = vec4(0.0, 0.0, -3.0, 1.0);`);
  };
  const key = base.customProgramCacheKey?.() || '';
  m.customProgramCacheKey = () => 'impostor' + key;
  return m;
}

export class CityImpostor {
  constructor(scene, layout, planner, M) {
    this.data = new Uint8Array(N * N);
    this.tex = new THREE.DataTexture(this.data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.unpackAlignment = 1;
    this.tex.needsUpdate = true;
    this.group = new THREE.Group(); this.group.name = 'city-impostor';
    scene.add(this.group);
    const buckets = new Map();
    const bucket = (mat) => { let b = buckets.get(mat); if (!b) buckets.set(mat, (b = { gb: new GeoBuilder(), ch: [] })); return b; };
    const tag = (b, n0, ci, cj) => { const u = (ci - MIN + 0.5) / N, v = (cj - MIN + 0.5) / N; for (let i = n0; i < b.gb.pos.length / 3; i++) b.ch.push(u, v); };
    for (const bld of planner.buildings) {
      const ci = Math.floor(((bld.x0 + bld.x1) / 2) / CH), cj = Math.floor(((bld.z0 + bld.z1) / 2) / CH);
      const seedR = rng(bld.id * 977 + 13);
      const uOff = Math.floor(seedR() * 8) / 8, vOff = Math.floor(seedR() * 8) / 8;
      for (const p of bld.parts) {
        if (p.slab) continue;
        const def = FACADE_DEF[p.style], h = p.y1 - p.y0;
        const floors = Math.max(1, Math.round(h / def.floorH)), vScale = floors / 8 / h;
        const b = bucket(M.facadesFar[p.style]), n0 = b.gb.pos.length / 3;
        for (const [ax, az, bx, bz] of [[p.x0, p.z1, p.x1, p.z1], [p.x1, p.z1, p.x1, p.z0], [p.x1, p.z0, p.x0, p.z0], [p.x0, p.z0, p.x0, p.z1]]) {
          const len = Math.hypot(bx - ax, bz - az), cols = Math.max(1, Math.round(len / def.colW));
          b.gb.wall(ax, az, bx, bz, p.y0, p.y1, cols / 8 / len, vScale, uOff, vOff);
        }
        tag(b, n0, ci, cj);
        const r = bucket(M.roof), r0 = r.gb.pos.length / 3;
        r.gb.flat(p.x0, p.z0, p.x1, p.z1, bld.roof === 'gable' ? p.y1 + (bld.roofH || 2) * 0.5 : p.y1, 1 / 6);
        tag(r, r0, ci, cj);
      }
    }
    // ground plate: one quad per chunk (so it hides chunk by chunk too), painted from the layout
    const groundMat = new THREE.MeshLambertMaterial({ map: this._groundTexture(layout, planner) });
    const g = bucket(groundMat);
    for (let ci = MIN; ci < MIN + N; ci++) for (let cj = MIN; cj < MIN + N; cj++) {
      const x0 = ci * CH, z0 = cj * CH, x1 = x0 + CH, z1 = z0 + CH;
      if (Math.max(Math.abs(x0 + 80), Math.abs(z0 + 80)) > SPAN) continue;
      const n0 = g.gb.pos.length / 3;
      const uv = (x, z) => [(SPAN - x) / (2 * SPAN), (SPAN + z) / (2 * SPAN)];
      g.gb.quad([x0, 0.01, z1], [x1, 0.01, z1], [x1, 0.01, z0], [x0, 0.01, z0], [0, 1, 0], [uv(x0, z1), uv(x1, z1), uv(x1, z0), uv(x0, z0)]);
      tag(g, n0, ci, cj);
    }
    for (const [mat, b] of buckets) {
      if (b.gb.empty) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.gb.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.gb.nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.gb.uv, 2));
      geo.setAttribute('chunk', new THREE.Float32BufferAttribute(b.ch, 2));
      geo.setIndex(b.gb.idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, masked(mat, this.tex));
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  // top-down painting of the city floor: lawns, pavements, roads, the river, the ring highway
  _groundTexture(layout, planner) {
    const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), k = S / (2 * SPAN);
    // texture u runs west (+x) to the left edge, v north (+z) to the top (flipY)
    const px = (x) => (SPAN - x) * k, pz = (z) => (SPAN - z) * k;
    g.fillStyle = '#3f5232'; g.fillRect(0, 0, S, S);
    const DIST = { downtown: '#8c8a86', commercial: '#86837c', industrial: '#7c776e', warehouse: '#76746f', suburban: '#5a6a44', riverside: '#7a7c78', outskirts: '#4a5a38' };
    for (const b of layout.blocks) {
      g.fillStyle = b.special === 'park' || b.special === 'hill' ? '#3d5e30' : b.special === 'construction' ? '#8a7a5c' : b.special === 'parking' || b.special === 'parkingDeck' || b.special === 'yard' ? '#4a4c50' : DIST[b.district] || '#80807c';
      g.fillRect(px(b.x1), pz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
    g.fillStyle = 'rgba(40,42,46,0.55)';
    for (const b of planner.buildings) g.fillRect(px(b.x1), pz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    g.fillStyle = '#1a3a48'; g.fillRect(px(RIVER.x1), pz(RING), (RIVER.x1 - RIVER.x0) * k, RING * 2 * k);
    g.lineCap = 'square';
    for (const T of [ROAD_TYPES.street, ROAD_TYPES.link, ROAD_TYPES.arterial, ROAD_TYPES.highway]) {
      g.strokeStyle = '#3a3c40'; g.lineWidth = Math.max(1, T.width * k);
      for (const e of layout.edges) {
        if (e.type !== T) continue;
        g.beginPath(); e.points.forEach(([x, z], i) => (i ? g.lineTo(px(x), pz(z)) : g.moveTo(px(x), pz(z)))); g.stroke();
      }
    }
    void lineHalfWidth;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }

  // chunk (ci, cj) is drawn for real: hide its impostor
  setLoaded(ci, cj, on) {
    const i = (cj - MIN) * N + (ci - MIN);
    if (i < 0 || i >= this.data.length || ci < MIN || ci >= MIN + N) return;
    const v = on ? 255 : 0;
    if (this.data[i] !== v) { this.data[i] = v; this.tex.needsUpdate = true; }
  }
}
