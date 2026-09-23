// ChunkBuilder: generates merged meshes for one CITY_CHUNK_X_Z (160 m square aligned with
// road center lines). Base level = roads, sidewalks, buildings; detail level = markings,
// storefronts, neon signs, roof equipment, railings. Buildings are assembled from modules
// (podium / shaft / crown / parapet / storefront band) so memory stays low.
import * as THREE from 'three';
import { MeshBatch } from './GeoBuilder.js';
import { markUV, MARK, FACADE_DEF, SIGN_WORDS } from '../renderer/Textures.js';
import {
  GRID, HALF_LINES, EDGE, RING, RIVER, CURB_H, SIDEWALK_W, ROAD_TYPES, TUNNEL, lineHalfWidth, lineType,
} from './CityLayout.js';
import { FACADE } from './CityPlanner.js';
import { rng, clamp } from '../core/util.js';

export const CHUNK = 160;
const EDGE_HW = lineHalfWidth(HALF_LINES);

export class ChunkBuilder {
  constructor(layout, planner, materials) {
    this.L = layout; this.P = planner; this.M = materials;
    this.buildingsByChunk = new Map();
    for (const b of planner.buildings) {
      const k = `${Math.floor(((b.x0 + b.x1) / 2) / CHUNK)},${Math.floor(((b.z0 + b.z1) / 2) / CHUNK)}`;
      if (!this.buildingsByChunk.has(k)) this.buildingsByChunk.set(k, []);
      this.buildingsByChunk.get(k).push(b);
    }
    this.blocksByChunk = new Map();
    for (const b of layout.blocks) {
      const k = `${Math.floor(b.cx / CHUNK)},${Math.floor(b.cz / CHUNK)}`;
      if (!this.blocksByChunk.has(k)) this.blocksByChunk.set(k, []);
      this.blocksByChunk.get(k).push(b);
    }
    this.ringByChunk = new Map();
    const pts = layout.ringSamples;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const k = `${Math.floor(((a[0] + b[0]) / 2) / CHUNK)},${Math.floor(((a[1] + b[1]) / 2) / CHUNK)}`;
      if (!this.ringByChunk.has(k)) this.ringByChunk.set(k, []);
      this.ringByChunk.get(k).push([a, b, pts[(i - 1 + pts.length) % pts.length], pts[(i + 2) % pts.length]]);
    }
    this.propsByChunk = new Map();
    for (const p of planner.props) {
      const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      if (!this.propsByChunk.has(k)) this.propsByChunk.set(k, []);
      this.propsByChunk.get(k).push(p);
    }
  }

  // ------------------------------------------------------------------ base level
  buildBase(ci, cj) {
    const group = new THREE.Group();
    group.name = `CITY_CHUNK_${ci}_${cj}`;
    const B = new MeshBatch();
    const x0 = ci * CHUNK, x1 = x0 + CHUNK, z0 = cj * CHUNK, z1 = z0 + CHUNK;
    const M = this.M;
    const inGrid = (k) => Math.abs(k) <= HALF_LINES;
    const zLo = -EDGE - EDGE_HW, zHi = EDGE + EDGE_HW;

    // ground (outside the dense grid)
    const outer = ci < -HALF_LINES || ci >= HALF_LINES || cj < -HALF_LINES || cj >= HALF_LINES;
    if (outer) B.get(M.grass).flat(x0, z0, x1, z1, -0.03, 1 / 16);

    // --- grid roads (N-S strips on chunk's west & east boundary lines) ---
    const road = B.get(M.road);
    const nsStrips = [];
    for (const [X, side] of [[x0, 1], [x1, -1]]) {
      const k = Math.round(X / GRID);
      if (!inGrid(k)) continue;
      const hw = lineHalfWidth(k);
      const a = side > 0 ? X : X - hw, b = side > 0 ? X + hw : X;
      const za = Math.max(z0, zLo), zb = Math.min(z1, zHi);
      if (za < zb) { road.flat(a, za, b, zb, 0, 1 / 12); nsStrips.push({ X, k, hw, side, za, zb }); }
      // links to the highway
      if (k % 2 === 0 && Math.abs(k) < HALF_LINES) {
        const hl = ROAD_TYPES.link.width / 2, a2 = side > 0 ? X : X - hl, b2 = side > 0 ? X + hl : X;
        for (const [la, lb] of [[zHi, RING - 12], [-RING + 12, zLo]]) {
          const q0 = Math.max(z0, la), q1 = Math.min(z1, lb);
          if (q0 < q1) { road.flat(a2, q0, b2, q1, 0, 1 / 12); nsStrips.push({ X, k, hw: hl, side, za: q0, zb: q1, link: true }); }
        }
      }
    }
    const ewStrips = [];
    for (const [Z, side] of [[z0, 1], [z1, -1]]) {
      const k = Math.round(Z / GRID);
      if (!inGrid(k)) continue;
      const hw = lineHalfWidth(k);
      const a = side > 0 ? Z : Z - hw, b = side > 0 ? Z + hw : Z;
      // exclude the N-S strip areas to avoid overlap
      let xa = Math.max(x0, -EDGE - EDGE_HW), xb = Math.min(x1, EDGE + EDGE_HW);
      const west = nsStrips.find((s) => s.X === x0 && !s.link && Z >= s.za - 0.01 && Z <= s.zb + 0.01);
      const east = nsStrips.find((s) => s.X === x1 && !s.link && Z >= s.za - 0.01 && Z <= s.zb + 0.01);
      if (west) xa = Math.max(xa, x0 + west.hw);
      if (east) xb = Math.min(xb, x1 - east.hw);
      if (xa < xb) { road.flat(xa, a, xb, b, 0, 1 / 12); ewStrips.push({ Z, k, hw, side, xa, xb }); }
      if (k % 2 === 0 && Math.abs(k) < HALF_LINES) {
        const hl = ROAD_TYPES.link.width / 2, a2 = side > 0 ? Z : Z - hl, b2 = side > 0 ? Z + hl : Z;
        for (const [la, lb] of [[EDGE + EDGE_HW, RING - 12], [-RING + 12, -EDGE - EDGE_HW]]) {
          const q0 = Math.max(x0, la), q1 = Math.min(x1, lb);
          if (q0 < q1) { road.flat(q0, a2, q1, b2, 0, 1 / 12); ewStrips.push({ Z, k, hw: hl, side, xa: q0, xb: q1, link: true }); }
        }
      }
    }
    // bridge decks & fascia
    for (const s of ewStrips) {
      if (s.link) continue;
      const bx0 = Math.max(s.xa, RIVER.x0 - 2), bx1 = Math.min(s.xb, RIVER.x1 + 2);
      if (bx0 < bx1 && x0 < RIVER.x1 && x1 > RIVER.x0) {
        const za = s.side > 0 ? s.Z : s.Z - s.hw - 0.6, zb = s.side > 0 ? s.Z + s.hw + 0.6 : s.Z;
        const cw = B.get(M.concreteWall);
        cw.box(bx0, -1.3, za, bx1, -0.02, zb, 1 / 4, true);
        // side curb/parapet of the bridge
        const pz0 = s.side > 0 ? s.Z + s.hw : s.Z - s.hw - 0.6, pz1 = pz0 + 0.6;
        cw.box(bx0, 0, pz0, bx1, 0.35, pz1, 1 / 4);
      }
    }
    this.nsStrips = nsStrips; this.ewStrips = ewStrips;

    // --- highway ribbon + walls ---
    const segs = this.ringByChunk.get(`${ci},${cj}`) || [];
    const H = ROAD_TYPES.highway;
    for (const [a, b, prev, next] of segs) {
      const n0 = segNormal(prev, b), n1 = segNormal(a, next);
      const hw = H.width / 2;
      const outA = outwardSign(a, n0), outB = outwardSign(b, n1);
      void outB;
      const P = (p, n, off) => [p[0] + n[0] * off, p[1] + n[1] * off];
      const l0 = P(a, n0, -hw), r0 = P(a, n0, hw), l1 = P(b, n1, -hw), r1 = P(b, n1, hw);
      const uv = (p) => [p[0] / 12, -p[1] / 12];
      // winding: ensure up-facing
      const cross = (r0[0] - l0[0]) * (l1[1] - l0[1]) - (r0[1] - l0[1]) * (l1[0] - l0[0]);
      if (cross < 0) road.quad([l0[0], 0, l0[1]], [r0[0], 0, r0[1]], [r1[0], 0, r1[1]], [l1[0], 0, l1[1]], [0, 1, 0], [uv(l0), uv(r0), uv(r1), uv(l1)]);
      else road.quad([l1[0], 0, l1[1]], [r1[0], 0, r1[1]], [r0[0], 0, r0[1]], [l0[0], 0, l0[1]], [0, 1, 0], [uv(l1), uv(r1), uv(r0), uv(l0)]);
      // sound wall on the outside, median barrier in the middle
      const cw = B.get(M.concreteWall);
      const o = outA;
      const wa = P(a, n0, o * (hw + 0.6)), wb = P(b, n1, o * (hw + 0.6));
      const wa2 = P(a, n0, o * (hw + 1.1)), wb2 = P(b, n1, o * (hw + 1.1));
      cw.wall(...(o > 0 ? [wa[0], wa[1], wb[0], wb[1]] : [wb[0], wb[1], wa[0], wa[1]]), 0, 3.2, 1 / 4, 1 / 4);
      cw.wall(...(o > 0 ? [wb2[0], wb2[1], wa2[0], wa2[1]] : [wa2[0], wa2[1], wb2[0], wb2[1]]), 0, 3.2, 1 / 4, 1 / 4);
      cw.quad([wa[0], 3.2, wa[1]], [wa2[0], 3.2, wa2[1]], [wb2[0], 3.2, wb2[1]], [wb[0], 3.2, wb[1]], [0, 1, 0], [[0, 0], [0.1, 0], [0.1, 1], [0, 1]]);
      // median (jersey-like low wall, both faces)
      const ma = P(a, n0, -0.3), mb = P(b, n1, -0.3), ma2 = P(a, n0, 0.3), mb2 = P(b, n1, 0.3);
      cw.wall(ma[0], ma[1], mb[0], mb[1], 0, 0.9, 1 / 4, 1 / 4);
      cw.wall(mb2[0], mb2[1], ma2[0], ma2[1], 0, 0.9, 1 / 4, 1 / 4);
      cw.quad([ma[0], 0.9, ma[1]], [ma2[0], 0.9, ma2[1]], [mb2[0], 0.9, mb2[1]], [mb[0], 0.9, mb[1]], [0, 1, 0], [[0, 0], [0.1, 0], [0.1, 1], [0, 1]]);
    }

    // --- blocks: sidewalks, curbs, lots, river banks, special areas ---
    for (const b of this.blocksByChunk.get(`${ci},${cj}`) || []) this._block(B, b);

    // --- buildings (base: shells) ---
    const blds = this.buildingsByChunk.get(`${ci},${cj}`) || [];
    const R = rng(ci * 7919 + cj * 104729);
    for (const bld of blds) this._building(B, bld, R);

    // --- tunnel & hill ---
    if (TUNNEL.x >= x0 && TUNNEL.x < x1 && TUNNEL.z0 >= z0 && TUNNEL.z0 < z1) this._tunnel(B);

    const meshes = B.toMeshes(group, { castShadow: true, receiveShadow: true });
    for (const m of meshes) {
      if (m.material === M.road || m.material === M.sidewalk || m.material === M.grass || m.material === M.water) m.castShadow = false;
      const fi = M.facades.indexOf(m.material);
      if (fi >= 0) m.userData.facade = fi;
    }
    group.userData.meshes = meshes;
    return group;
  }

  _block(B, b) {
    const M = this.M;
    const sw = SIDEWALK_W;
    const curb = B.get(M.curb);
    if (b.special === 'river') {
      // land parts only, water and canal walls between
      const parts = [];
      if (b.x0 < RIVER.x0) parts.push([b.x0, Math.min(b.x1, RIVER.x0)]);
      if (b.x1 > RIVER.x1) parts.push([Math.max(b.x0, RIVER.x1), b.x1]);
      for (const [a, c] of parts) {
        B.get(M.sidewalk).flat(a, b.z0, c, b.z1, CURB_H, 1 / 8);
        curb.ring(a, b.z0, c, b.z1, 0, CURB_H, 1 / 2, 1 / 2);
      }
      B.get(M.water).flat(RIVER.x0, b.z0 - 12, RIVER.x1, b.z1 + 12, RIVER.water, 1 / 20);
      B.get(M.dirt).flat(RIVER.x0, b.z0 - 12, RIVER.x1, b.z1 + 12, RIVER.depth, 1 / 10);
      const cw = B.get(M.concreteWall);
      // canal walls (face into the channel)
      cw.wall(RIVER.x0, b.z1 + 12, RIVER.x0, b.z0 - 12, RIVER.depth, CURB_H, 1 / 4, 1 / 4); // faces +x
      cw.wall(RIVER.x1, b.z0 - 12, RIVER.x1, b.z1 + 12, RIVER.depth, CURB_H, 1 / 4, 1 / 4); // faces -x
      return;
    }
    const sp = b.special;
    const lot = sp === 'parking' || sp === 'construction' || sp === 'yard' || sp === 'parkingDeck';
    const green = b.district === 'suburban' || sp === 'park' || sp === 'hill';
    const top = B.get(M.sidewalk);
    if (lot || green) {
      // sidewalk ring
      top.flat(b.x0, b.z0, b.x1, b.z0 + sw, CURB_H, 1 / 8);
      top.flat(b.x0, b.z1 - sw, b.x1, b.z1, CURB_H, 1 / 8);
      top.flat(b.x0, b.z0 + sw, b.x0 + sw, b.z1 - sw, CURB_H, 1 / 8);
      top.flat(b.x1 - sw, b.z0 + sw, b.x1, b.z1 - sw, CURB_H, 1 / 8);
      if (lot) {
        const mat = sp === 'construction' ? M.dirt : M.road;
        B.get(mat).flat(b.x0 + sw, b.z0 + sw, b.x1 - sw, b.z1 - sw, 0.02, 1 / 12);
        // inner curb faces (inward)
        const ix0 = b.x0 + sw, ix1 = b.x1 - sw, iz0 = b.z0 + sw, iz1 = b.z1 - sw;
        curb.wall(ix0, iz0, ix1, iz0, 0.02, CURB_H, 1 / 2, 1 / 2);
        curb.wall(ix1, iz1, ix0, iz1, 0.02, CURB_H, 1 / 2, 1 / 2);
        curb.wall(ix0, iz1, ix0, iz0, 0.02, CURB_H, 1 / 2, 1 / 2);
        curb.wall(ix1, iz0, ix1, iz1, 0.02, CURB_H, 1 / 2, 1 / 2);
      } else {
        B.get(M.grass).flat(b.x0 + sw, b.z0 + sw, b.x1 - sw, b.z1 - sw, CURB_H + 0.005, 1 / 10);
      }
    } else {
      top.flat(b.x0, b.z0, b.x1, b.z1, CURB_H, 1 / 8);
      if (b.alley) B.get(M.road).flat(b.alley.x0, b.alley.z0, b.alley.x1, b.alley.z1, CURB_H + 0.01, 1 / 12);
    }
    curb.ring(b.x0, b.z0, b.x1, b.z1, 0, CURB_H, 1 / 2, 1 / 2);
    if (sp === 'hill') this._hill(B, b);
  }

  _hill(B, b) {
    // grassy mound over the tunnel blocks (non-drivable, collider in planner)
    const g = B.get(this.M.grass);
    const n = 14;
    const x0 = b.x0 + 5, x1 = b.x1 - 5, z0 = b.z0 + 5, z1 = b.z1 - 5;
    const H = (x, z) => {
      const u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
      const e = Math.min(u, 1 - u, v, 1 - v);
      return CURB_H + Math.pow(clamp(e * 3, 0, 1), 1.4) * 16 * (0.8 + 0.2 * Math.sin(x * 0.07) * Math.cos(z * 0.05));
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const xa = x0 + (x1 - x0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n;
      const za = z0 + (z1 - z0) * j / n, zb = z0 + (z1 - z0) * (j + 1) / n;
      const pa = [xa, H(xa, zb), zb], pb = [xb, H(xb, zb), zb], pc = [xb, H(xb, za), za], pd = [xa, H(xa, za), za];
      const ux = (xb - xa), uz = (za - zb);
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pd[0] - pa[0], pd[1] - pa[1], pd[2] - pa[2]];
      const nn = new THREE.Vector3(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]).normalize();
      if (nn.y < 0) nn.negate();
      void ux; void uz;
      g.quad(pa, pb, pc, pd, [nn.x, nn.y, nn.z], [[xa / 10, -zb / 10], [xb / 10, -zb / 10], [xb / 10, -za / 10], [xa / 10, -za / 10]]);
    }
  }

  _tunnel(B) {
    const T = TUNNEL, M = this.M;
    const hw = T.width / 2;
    const cw = B.get(M.concreteWall);
    // side walls (inner faces), ceiling, portals
    cw.box(T.x - hw - 1.2, 0, T.z0, T.x - hw, 7.4, T.z1);
    cw.box(T.x + hw, 0, T.z0, T.x + hw + 1.2, 7.4, T.z1);
    cw.box(T.x - hw - 1.2, 6.6, T.z0, T.x + hw + 1.2, 7.6, T.z1, 1 / 4, true);
    // portal headers
    cw.box(T.x - hw - 3, 6.2, T.z0 - 1.5, T.x + hw + 3, 9.5, T.z0 + 0.5);
    cw.box(T.x - hw - 3, 6.2, T.z1 - 0.5, T.x + hw + 3, 9.5, T.z1 + 1.5);
    // ceiling light strips
    const lamp = B.get(M.lampHead);
    for (let z = T.z0 + 4; z < T.z1 - 2; z += 10) for (const x of [-3.5, 3.5]) {
      lamp.quad([T.x + x - 0.25, 6.55, z + 1.5], [T.x + x + 0.25, 6.55, z + 1.5], [T.x + x + 0.25, 6.55, z - 1.5], [T.x + x - 0.25, 6.55, z - 1.5], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }

  _building(B, bld, R) {
    const M = this.M;
    const seedR = rng(bld.id * 977 + 13);
    const uOff = Math.floor(seedR() * 8) / 8, vOff = Math.floor(seedR() * 8) / 8;
    for (const p of bld.parts) {
      if (p.slab) { B.get(M.concreteWall).box(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, 1 / 4, true); continue; }
      const def = FACADE_DEF[p.style];
      const mat = M.facades[p.style];
      const gb = B.get(mat);
      const h = p.y1 - p.y0;
      const floors = Math.max(1, Math.round(h / def.floorH));
      const vScale = floors / 8 / h;
      const wallsOf = [
        ['n', p.x0, p.z1, p.x1, p.z1], ['e', p.x1, p.z1, p.x1, p.z0], ['s', p.x1, p.z0, p.x0, p.z0], ['w', p.x0, p.z0, p.x0, p.z1],
      ];
      for (const [side, ax, az, bx, bz] of wallsOf) {
        const len = Math.hypot(bx - ax, bz - az);
        const cols = Math.max(1, Math.round(len / def.colW));
        const uScale = cols / 8 / len;
        const store = bld.storefront && p.y0 === 0 && (bld.sides || []).includes(side) && h > 7;
        if (store) {
          // ground floor handled by the detail level (storefront band); base keeps a plain podium strip
          B.get(M.concreteWall).wall(ax, az, bx, bz, 0, 4.4, 1 / 4, 1 / 4);
          gb.wall(ax, az, bx, bz, 4.4, p.y1, uScale, floors / 8 / h, uOff, vOff + (4.4 * vScale));
        } else gb.wall(ax, az, bx, bz, p.y0, p.y1, uScale, vScale, uOff, vOff);
      }
      const isTop = !bld.parts.some((q) => q !== p && q.y0 >= p.y1 - 0.01 && q.x0 >= p.x0 - 0.1 && q.x1 <= p.x1 + 0.1 && q.z0 >= p.z0 - 0.1 && q.z1 <= p.z1 + 0.1) || true;
      if (bld.roof === 'gable') this._gable(B, bld, p);
      else if (isTop) {
        B.get(M.roof).flat(p.x0, p.z0, p.x1, p.z1, p.y1, 1 / 6);
        // parapet
        const t = 0.35, ph = bld.house ? 0 : 0.9;
        if (ph > 0) {
          const cw = B.get(M.concreteWall);
          cw.ring(p.x0, p.z0, p.x1, p.z1, p.y1, p.y1 + ph, 1 / 4, 1 / 4);
          // inner faces (reverse orientation)
          cw.wall(p.x1 - t, p.z1 - t, p.x0 + t, p.z1 - t, p.y1, p.y1 + ph, 1 / 4, 1 / 4);
          cw.wall(p.x1 - t, p.z0 + t, p.x1 - t, p.z1 - t, p.y1, p.y1 + ph, 1 / 4, 1 / 4);
          cw.wall(p.x0 + t, p.z0 + t, p.x1 - t, p.z0 + t, p.y1, p.y1 + ph, 1 / 4, 1 / 4);
          cw.wall(p.x0 + t, p.z1 - t, p.x0 + t, p.z0 + t, p.y1, p.y1 + ph, 1 / 4, 1 / 4);
          cw.flat(p.x0, p.z0, p.x1, p.z0 + t, p.y1 + ph, 1 / 4); cw.flat(p.x0, p.z1 - t, p.x1, p.z1, p.y1 + ph, 1 / 4);
          cw.flat(p.x0, p.z0 + t, p.x0 + t, p.z1 - t, p.y1 + ph, 1 / 4); cw.flat(p.x1 - t, p.z0 + t, p.x1, p.z1 - t, p.y1 + ph, 1 / 4);
        }
      }
    }
    if (bld.antenna) {
      const top = Math.max(...bld.parts.map((q) => q.y1));
      const cx = (bld.x0 + bld.x1) / 2, cz = (bld.z0 + bld.z1) / 2;
      B.get(M.metal).box(cx - 0.25, top, cz - 0.25, cx + 0.25, top + 24, cz + 0.25);
      B.get(M.signalRed).box(cx - 0.35, top + 24, cz - 0.35, cx + 0.35, top + 24.7, cz + 0.35);
    }
    void R;
  }

  _gable(B, bld, p) {
    const M = this.M;
    const mat = M.shingles[bld.color % M.shingles.length];
    const g = B.get(mat);
    const o = 0.4; // overhang
    const y = p.y1, rh = bld.roofH;
    const x0 = p.x0 - o, x1 = p.x1 + o, z0 = p.z0 - o, z1 = p.z1 + o;
    const wall = B.get(M.facades[FACADE.HOUSE]);
    if (bld.ridgeAlongX) {
      const zm = (p.z0 + p.z1) / 2;
      const n1 = new THREE.Vector3(0, (z1 - zm), rh).normalize(), n2 = new THREE.Vector3(0, (zm - z0), -rh).normalize();
      g.quad([x0, y, z1], [x1, y, z1], [x1, y + rh, zm], [x0, y + rh, zm], [0, n1.y, n1.z], [[0, 0], [(x1 - x0) / 4, 0], [(x1 - x0) / 4, 1.5], [0, 1.5]]);
      g.quad([x1, y, z0], [x0, y, z0], [x0, y + rh, zm], [x1, y + rh, zm], [0, n2.y, n2.z], [[0, 0], [(x1 - x0) / 4, 0], [(x1 - x0) / 4, 1.5], [0, 1.5]]);
      // gable triangles
      for (const [x, s] of [[p.x0, -1], [p.x1, 1]]) {
        const a = wall._v(x, y, s > 0 ? p.z1 : p.z0, s, 0, 0, 0, 0);
        const b2 = wall._v(x, y, s > 0 ? p.z0 : p.z1, s, 0, 0, 0.3, 0);
        const c = wall._v(x, y + rh, zm, s, 0, 0, 0.15, 0.1);
        wall.idx.push(a, b2, c);
      }
    } else {
      const xm = (p.x0 + p.x1) / 2;
      const n1 = new THREE.Vector3((x1 - xm), rh, 0).normalize(), n2 = new THREE.Vector3(-(xm - x0), rh, 0).normalize();
      g.quad([x1, y, z1], [x1, y, z0], [xm, y + rh, z0], [xm, y + rh, z1], [n1.x, n1.y, 0], [[0, 0], [(z1 - z0) / 4, 0], [(z1 - z0) / 4, 1.5], [0, 1.5]]);
      g.quad([x0, y, z0], [x0, y, z1], [xm, y + rh, z1], [xm, y + rh, z0], [n2.x, n2.y, 0], [[0, 0], [(z1 - z0) / 4, 0], [(z1 - z0) / 4, 1.5], [0, 1.5]]);
      for (const [z, s] of [[p.z0, -1], [p.z1, 1]]) {
        const a = wall._v(s > 0 ? p.x0 : p.x1, y, z, 0, 0, s, 0, 0);
        const b2 = wall._v(s > 0 ? p.x1 : p.x0, y, z, 0, 0, s, 0.3, 0);
        const c = wall._v(xm, y + rh, z, 0, 0, s, 0.15, 0.1);
        wall.idx.push(a, b2, c);
      }
    }
  }

  // ------------------------------------------------------------------ detail level
  buildDetail(ci, cj, preset) {
    const group = new THREE.Group();
    group.name = `CITY_CHUNK_${ci}_${cj}_detail`;
    const B = new MeshBatch();
    const M = this.M;
    const x0 = ci * CHUNK, x1 = x0 + CHUNK, z0 = cj * CHUNK, z1 = z0 + CHUNK;
    const mk = B.get(M.markings);
    const inGrid = (k) => Math.abs(k) <= HALF_LINES;

    // --- lane markings on grid roads ---
    for (const [X, side] of [[x0, 1], [x1, -1]]) {
      const k = Math.round(X / GRID);
      if (!inGrid(k)) continue;
      const l = cj; // segment between node rows cj and cj+1
      if (l < -HALF_LINES || l >= HALF_LINES) continue;
      const za = l * GRID + lineHalfWidth(l), zb = (l + 1) * GRID - lineHalfWidth(l + 1);
      this._roadMarks(mk, 'z', X, side, za, zb, lineType(k), this._signalAt(k, l), this._signalAt(k, l + 1));
    }
    for (const [Z, side] of [[z0, 1], [z1, -1]]) {
      const k = Math.round(Z / GRID);
      if (!inGrid(k)) continue;
      const l = ci;
      if (l < -HALF_LINES || l >= HALF_LINES) continue;
      const xa = l * GRID + lineHalfWidth(l), xb = (l + 1) * GRID - lineHalfWidth(l + 1);
      this._roadMarks(mk, 'x', Z, side, xa, xb, lineType(k), this._signalAt(l, k), this._signalAt(l + 1, k));
    }
    // --- highway lane markings ---
    const segs = this.ringByChunk.get(`${ci},${cj}`) || [];
    const H = ROAD_TYPES.highway;
    let dashPhase = 0;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const ang = Math.atan2(dx, dz);
      const nx = dz / len, nz = -dx / len;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      for (const s of [-1, 1]) {
        for (let i = 1; i < H.lanes; i++) {
          const off = s * (H.median / 2 + H.laneWidth * i);
          if ((Math.floor((mx + mz) / 9) + dashPhase) % 2 === 0) mk.decal(mx + nx * off, mz + nz * off, 0.08, len / 2 * 0.9, ang, 0.012, markUV(MARK.DASH));
        }
        const eo = s * (H.median / 2 + H.laneWidth * H.lanes + 0.2);
        mk.decal(mx + nx * eo, mz + nz * eo, 0.08, len / 2 + 0.05, ang, 0.012, markUV(MARK.WHITE));
        const yo = s * (H.median / 2 + 0.25);
        mk.decal(mx + nx * yo, mz + nz * yo, 0.08, len / 2 + 0.05, ang, 0.012, markUV(MARK.YELLOW));
      }
    }
    // --- parking stalls, ramps, dirt, railings, crane (chunk props) ---
    for (const p of this.propsByChunk.get(`${ci},${cj}`) || []) {
      if (p.type === 'stalls') {
        for (let x = -p.s / 2; x <= p.s / 2; x += 2.8) mk.decal(p.x + x, p.z, 0.06, 2.6, 0, 0.03, markUV(MARK.STALL));
      } else if (p.type === 'railing' || p.type === 'bridgeRail') this._railing(B, p);
      else if (p.type === 'ramp') this._ramp(B, p);
      else if (p.type === 'crane') this._crane(B, p);
    }
    // --- storefronts, neon signs, roof details ---
    const blds = this.buildingsByChunk.get(`${ci},${cj}`) || [];
    for (const bld of blds) this._buildingDetail(B, bld, preset);

    const meshes = B.toMeshes(group, { castShadow: false, receiveShadow: true });
    for (const m of meshes) if (m.material === M.markings) { m.renderOrder = 1; m.receiveShadow = true; }
    group.userData.meshes = meshes;
    return group;
  }

  _signalAt(k, l) {
    const n = this.L.nodeMap.get(`${k * GRID},${l * GRID}`);
    return !!n?.signal;
  }

  // markings for one road segment half (side: +1 = chunk holds positive offsets)
  _roadMarks(mk, axis, C, side, a, b, T, sigA, sigB) {
    const len = b - a; if (len <= 2) return;
    const along = axis === 'z';
    const put = (off, s0, s1, w, cell, angOverride) => {
      const cs = (s0 + s1) / 2, hl = (s1 - s0) / 2;
      const x = along ? C + off : cs, z = along ? cs : C + off;
      mk.decal(x, z, w / 2, hl, angOverride ?? (along ? 0 : Math.PI / 2), 0.012, markUV(cell));
    };
    const offs = (o) => (side > 0 ? o >= 0 : o < 0);
    const mH = T.median / 2;
    const cross = 3.2, stopGap = 4.2;
    const s0 = a + (sigA ? stopGap + 0.6 : 1), s1 = b - (sigB ? stopGap + 0.6 : 1);
    // center line
    if (offs(0)) {
      if (T.median > 0) put(0, s0, s1, 0.55, MARK.DOUBLE_YELLOW);
      else for (let s = s0; s < s1 - 2; s += 8) put(0, s, Math.min(s + 3, s1), 0.14, MARK.YELLOW);
    }
    for (const dir of [1, -1]) {
      // dir = +1 -> lanes on positive offset side
      for (let i = 1; i < T.lanes; i++) {
        const o = dir * (mH + T.laneWidth * i);
        if (!offs(o)) continue;
        for (let s = s0; s < s1 - 2; s += 9) put(o, s, Math.min(s + 3, s1), 0.13, MARK.DASH);
      }
      const eo = dir * (mH + T.laneWidth * T.lanes + 0.15);
      if (offs(eo)) put(eo, a + 1, b - 1, 0.13, MARK.WHITE);
    }
    // crosswalks + stop lines + arrows at signalized ends
    const roadHalf = mH + T.laneWidth * T.lanes + T.shoulder;
    for (const [end, sig] of [[a, sigA], [b, sigB]]) {
      if (!sig) continue;
      const inward = end === a ? 1 : -1;
      const band = end + inward * (cross / 2 + 0.3);
      for (let o = -roadHalf + 0.6; o < roadHalf - 0.3; o += 1.25) {
        if (!offs(o)) continue;
        put(o, band - cross / 2, band + cross / 2, 0.6, MARK.CROSS);
      }
      // traffic approaching this end travels towards it: lanes on the right side of travel.
      // travel direction = -inward along the axis. For +axis travel, right side = -offset (x) for 'z'
      // roads and +offset for 'x' roads (right of +x travel is +z).
      const travel = -inward;
      const rightSign = along ? -travel : travel;
      const stopS = end + inward * (cross + 0.9);
      for (let i = 0; i < T.lanes; i++) {
        const o = rightSign * (mH + T.laneWidth * (i + 0.5));
        if (!offs(o)) continue;
        put(o, stopS - 0.25, stopS + 0.25, T.laneWidth * 0.95, MARK.STOP, along ? 0 : Math.PI / 2);
        const cell = T.lanes > 1 && i === 0 ? MARK.ARROW_L : MARK.ARROW;
        const as = stopS + inward * 7;
        const ang = along ? (travel > 0 ? 0 : Math.PI) : (travel > 0 ? Math.PI / 2 : -Math.PI / 2);
        const x = along ? C + o : as, z = along ? as : C + o;
        mk.decal(x, z, 0.9, 2.4, ang, 0.013, markUV(cell));
      }
    }
  }

  _railing(B, p) {
    const M = this.M;
    const g = B.get(M.metal);
    const len = p.s;
    const alongX = p.type === 'bridgeRail';
    const y = p.y;
    const half = len / 2;
    for (let t = -half; t <= half; t += 2) {
      const x = alongX ? p.x + t : p.x, z = alongX ? p.z : p.z + t;
      g.box(x - 0.04, y, z - 0.04, x + 0.04, y + 1.1, z + 0.04, 1);
    }
    for (const hh of [0.55, 1.05]) {
      if (alongX) g.box(p.x - half, y + hh, p.z - 0.04, p.x + half, y + hh + 0.07, p.z + 0.04, 1);
      else g.box(p.x - 0.04, y + hh, p.z - half, p.x + 0.04, y + hh + 0.07, p.z + half, 1);
    }
  }

  _ramp(B, p) {
    const r = this.L.ramps.find((q) => Math.abs(q.x - p.x) < 0.1 && Math.abs(q.z - p.z) < 0.1);
    if (!r) return;
    const g = B.get(this.M.yellowMetal);
    const c = r.cos, s = r.sin;
    const P = (lx, lz, y) => [r.x + lx * c - lz * s, y, r.z + lx * s + lz * c];
    const L = r.len / 2, W = r.w / 2;
    // top slope
    const A = P(-L, -W, 0.02), Bp = P(-L, W, 0.02), Cp = P(L, W, r.h), D = P(L, -W, r.h);
    const nrm = new THREE.Vector3(-r.h * c, r.len, -r.h * s).normalize();
    g.quad(A, Bp, Cp, D, [nrm.x, nrm.y, nrm.z], [[0, 0], [4, 0], [4, 2], [0, 2]]);
    // back face and sides
    const E = P(L, -W, 0.02), F = P(L, W, 0.02);
    g.quad(F, E, D, Cp, [c, 0, s], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    const cw = B.get(this.M.darkMetal);
    cw.quad(E, A, D, D, [s, 0, -c], [[0, 0], [1, 0], [1, 1], [1, 1]]);
    cw.quad(Bp, F, Cp, Cp, [-s, 0, c], [[0, 0], [1, 0], [1, 1], [1, 1]]);
  }

  _crane(B, p) {
    const g = B.get(this.M.yellowMetal);
    const H = 42;
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(p.x + dx * 1.1 - 0.15, 0, p.z + dz * 1.1 - 0.15, p.x + dx * 1.1 + 0.15, H, p.z + dz * 1.1 + 0.15, 1);
    for (let y = 3; y < H; y += 3) g.box(p.x - 1.25, y, p.z - 1.25, p.x + 1.25, y + 0.15, p.z + 1.25, 1);
    g.box(p.x - 30, H, p.z - 0.8, p.x + 12, H + 1.6, p.z + 0.8, 1);
    B.get(this.M.concreteWall).box(p.x + 8, H - 2, p.z - 1.5, p.x + 12, H, p.z + 1.5);
    B.get(this.M.signalRed).box(p.x - 30.3, H + 1.6, p.z - 0.3, p.x - 29.7, H + 2.2, p.z + 0.3, 1);
  }

  _buildingDetail(B, bld, preset) {
    const M = this.M;
    const R = rng(bld.id * 31 + 7);
    const p0 = bld.parts[0];
    if (bld.storefront && p0.y1 - p0.y0 > 7) {
      const sf = B.get(M.storefront);
      const walls = { n: [p0.x0, p0.z1, p0.x1, p0.z1], e: [p0.x1, p0.z1, p0.x1, p0.z0], s: [p0.x1, p0.z0, p0.x0, p0.z0], w: [p0.x0, p0.z0, p0.x0, p0.z1] };
      for (const side of bld.sides || []) {
        const [ax, az, bx, bz] = walls[side];
        const len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        const shops = Math.max(1, Math.round(len / 7));
        sf.wall(ax + nx * 0.02, az + nz * 0.02, bx + nx * 0.02, bz + nz * 0.02, 0.15, 4.4, shops / 4 / len, 1 / 4.25, Math.floor(R() * 4) / 4, 0);
        // cornice ledge
        B.get(M.concreteWall).wall(ax + nx * 0.35, az + nz * 0.35, bx + nx * 0.35, bz + nz * 0.35, 4.4, 4.75, 1 / 4, 1 / 4);
        B.get(M.concreteWall).quad([ax + nx * 0.35, 4.75, az + nz * 0.35], [bx + nx * 0.35, 4.75, bz + nz * 0.35], [bx, 4.75, bz], [ax, 4.75, az], [0, 1, 0], [[0, 0], [1, 0], [1, 0.1], [0, 0.1]]);
      }
    }
    // neon signs
    for (const s of bld.signs || []) {
      const walls = { n: [p0.x0, p0.z1, p0.x1, p0.z1], e: [p0.x1, p0.z1, p0.x1, p0.z0], s: [p0.x1, p0.z0, p0.x0, p0.z0], w: [p0.x0, p0.z0, p0.x0, p0.z1] };
      const [ax, az, bx, bz] = walls[s.side];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const cx = ax + dx * len * s.t, cz = az + dz * len * s.t;
      const cell = s.id % SIGN_WORDS.length;
      const u0 = (cell % 4) / 4, v0 = 1 - (Math.floor(cell / 4) + 1) / 4;
      const uvH = [[u0 + 0.01, v0 + 0.07], [u0 + 0.24, v0 + 0.07], [u0 + 0.24, v0 + 0.18], [u0 + 0.01, v0 + 0.18]];
      const ng = B.get(M.neon);
      if (!s.vertical) {
        const w = 2.6, h = 1.2, off = 0.12;
        const px = cx + nx * off, pz = cz + nz * off;
        ng.quad([px - dx * w / 2, s.y, pz - dz * w / 2], [px + dx * w / 2, s.y, pz + dz * w / 2], [px + dx * w / 2, s.y + h, pz + dz * w / 2], [px - dx * w / 2, s.y + h, pz - dz * w / 2], [nx, 0, nz], uvH);
      } else {
        // blade sign perpendicular to the facade, readable from both directions
        const w = 3.2, h = 1.1, out = 0.3;
        const y = s.y + 1;
        const q0 = [cx + nx * out, y, cz + nz * out], q1 = [cx + nx * (out + w), y, cz + nz * (out + w)];
        const top = (q) => [q[0], q[1] + h, q[2]];
        ng.quad(q1, q0, top(q0), top(q1), [dx, 0, dz], uvH);
        ng.quad(q0, q1, top(q1), top(q0), [-dx, 0, -dz], uvH);
      }
    }
    // roof equipment
    if (preset.roofDetail && bld.roof === 'flat' && !bld.deck) {
      const top = bld.parts[bld.parts.length - 1];
      const w = top.x1 - top.x0, d = top.z1 - top.z0;
      const n = Math.min(5, Math.floor(w * d / 250));
      const g = B.get(M.metal);
      for (let i = 0; i < n; i++) {
        const x = top.x0 + 2 + R() * (w - 5), z = top.z0 + 2 + R() * (d - 5);
        const sx = 1.2 + R() * 1.6, sz = 1 + R() * 1.4, sh = 0.8 + R() * 1.2;
        g.box(x, top.y1, z, x + sx, top.y1 + sh, z + sz, 1 / 2);
      }
      if (w > 12 && d > 12 && R() < 0.6) {
        const x = top.x0 + w * 0.3, z = top.z0 + d * 0.3;
        B.get(M.concreteWall).box(x, top.y1, z, x + 4, top.y1 + 3, z + 3.5);
      }
    }
  }
}

function segNormal(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dz / l, -dx / l];
}
function outwardSign(p, n) { return p[0] * n[0] + p[1] * n[1] > 0 ? 1 : -1; }
