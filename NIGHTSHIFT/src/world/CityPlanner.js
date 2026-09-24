// CityPlanner: deterministic placement of buildings, street furniture and colliders.
// Produces plain data consumed by both the renderer (chunk meshes) and physics (colliders).
import { rng, clamp } from '../core/util.js';
import {
  GRID, HALF_LINES, EDGE, RING, RIVER, SIDEWALK_W, CURB_H, ROAD_TYPES, TUNNEL, lineHalfWidth, lineType, RING_CORNER_R,
} from './CityLayout.js';

// Facade styles (indices into the facade material library)
export const FACADE = { GLASS: 0, OFFICE: 1, BRICK: 2, METAL: 3, DARK: 4, HOUSE: 5, CONCRETE: 6 };

// half extents of knock-away street clutter
const SMALL_PROPS = { meter: [0.15, 0.15], bin: [0.3, 0.3], bench: [0.9, 0.25], hydrant: [0.18, 0.18], bollard: [0.12, 0.12], cone: [0.2, 0.2] };

export class CityPlanner {
  constructor(layout) {
    this.layout = layout;
    this.buildings = [];   // {id, x0,z0,x1,z1, parts:[{x0,z0,x1,z1,y0,y1,style}], roof, style, block, storefront:[sides], signs:[]}
    this.props = [];       // {type, x, y, z, rot, s, v}
    this.colliders = [];   // {cx, cz, hx, hz, cos, sin, h, kind}
    this.lightPools = [];  // {x, z, r, color, i}
    this.parked = [];      // parked cars {x, z, rot, type, color}
    for (const b of layout.blocks) this._planBlock(b);
    this._planStreets();
    this._planHighway();
    this._planRiver();
    this._planTunnel();
    this._planSpecial();
    // street clutter gets tiny "knock-away" colliders so cars don't ghost through it
    for (const p of this.props) {
      const size = SMALL_PROPS[p.type];
      if (size) this.breakable(p, this.collider(p.x, p.z, size[0], size[1], p.rot, 1.1, 'small'));
    }
  }

  // link a prop and its collider: the physics can knock it over (see VehiclePhysics._tryBreak)
  breakable(p, c) { c.breakable = true; c.prop = p; p.collider = c; return p; }

  collider(cx, cz, hx, hz, angle = 0, h = 10, kind = 'building') {
    const c = { cx, cz, hx, hz, cos: Math.cos(angle), sin: Math.sin(angle), angle, h, kind };
    this.colliders.push(c);
    return c;
  }
  prop(type, x, z, rot = 0, extra = {}) {
    const y = extra.y ?? this.layout.groundHeight(x, z);
    const p = { type, x, y, z, rot, s: extra.s ?? 1, v: extra.v ?? 0 };
    this.props.push(p);
    return p;
  }

  // ------------------------------------------------------------------ buildings
  _planBlock(b) {
    const R = rng(b.seed ^ 0x5bd1e995);
    const d = b.district;
    for (const lot of b.lots) {
      if (lot.empty) continue;
      if (lot.courtyard) {
        if (R() < 0.5 && lot.w > 16 && lot.d > 16) this._parkingPatch(lot, R);
        continue;
      }
      const sides = [];
      if (lot.x0 <= b.ix0 + 0.1) sides.push('w');
      if (lot.x1 >= b.ix1 - 0.1) sides.push('e');
      if (lot.z0 <= b.iz0 + 0.1) sides.push('s');
      if (lot.z1 >= b.iz1 - 0.1) sides.push('n');
      let bld;
      if (d === 'downtown') bld = this._tower(lot, R);
      else if (d === 'commercial') bld = this._midrise(lot, R, sides);
      else if (d === 'industrial') bld = this._industrial(lot, R);
      else if (d === 'warehouse') bld = this._warehouse(lot, R);
      else if (d === 'suburban') bld = this._house(lot, R, sides);
      else bld = this._midrise(lot, R, sides);
      if (!bld) continue;
      bld.block = b; bld.sides = sides; bld.id = this.buildings.length; bld.district = d;
      this.buildings.push(bld);
      // collider = union footprint of ground-level parts
      for (const p of bld.parts) if (p.y0 < 3) this.collider((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, (p.x1 - p.x0) / 2, (p.z1 - p.z0) / 2, 0, p.y1, 'building');
    }
  }

  _tower(l, R) {
    const inset = R.range(0, 1.5);
    const x0 = l.x0 + inset, x1 = l.x1 - inset, z0 = l.z0 + inset, z1 = l.z1 - inset;
    const podH = R.range(9, 16);
    const style = R.pick([FACADE.GLASS, FACADE.GLASS, FACADE.OFFICE, FACADE.DARK, FACADE.CONCRETE]);
    const parts = [{ x0, z0, x1, z1, y0: 0, y1: podH, style: style === FACADE.GLASS ? FACADE.CONCRETE : style, podium: true }];
    const s1 = R.range(2.5, 7);
    const w = x1 - x0, dd = z1 - z0;
    const size = Math.min(w, dd);
    const h = R.range(45, 70) + (size > 40 ? R.range(20, 110) : R.range(0, 40));
    const tx0 = x0 + s1, tx1 = x1 - s1, tz0 = z0 + s1, tz1 = z1 - s1;
    if (tx1 - tx0 > 8 && tz1 - tz0 > 8) {
      parts.push({ x0: tx0, z0: tz0, x1: tx1, z1: tz1, y0: podH, y1: podH + h, style });
      if (R() < 0.65) {
        const s2 = R.range(3, 7);
        if (tx1 - tx0 - 2 * s2 > 8 && tz1 - tz0 - 2 * s2 > 8) {
          const top = podH + h + R.range(8, 30);
          parts.push({ x0: tx0 + s2, z0: tz0 + s2, x1: tx1 - s2, z1: tz1 - s2, y0: podH + h, y1: top, style, crown: true });
        }
      }
    }
    const top = Math.max(...parts.map((p) => p.y1));
    return { x0, z0, x1, z1, parts, style, roof: 'flat', height: top, storefront: true, tower: true, antenna: top > 120 && R() < 0.6 };
  }

  _midrise(l, R, sides) {
    const floors = R.int(3, 10);
    const h = floors * 3.4 + 1.2;
    const style = R.pick([FACADE.BRICK, FACADE.BRICK, FACADE.OFFICE, FACADE.CONCRETE, FACADE.DARK]);
    const inset = R() < 0.7 ? 0 : R.range(0.5, 2);
    const x0 = l.x0 + inset, x1 = l.x1 - inset, z0 = l.z0 + inset, z1 = l.z1 - inset;
    if (x1 - x0 < 6 || z1 - z0 < 6) return null;
    const parts = [{ x0, z0, x1, z1, y0: 0, y1: h, style }];
    const bld = { x0, z0, x1, z1, parts, style, roof: 'flat', height: h, storefront: sides.length > 0, signs: [] };
    // neon signs on street facing sides
    for (const s of sides) if (R() < 0.75) bld.signs.push({ side: s, t: R.range(0.2, 0.8), y: R.range(4.6, Math.min(h - 1.5, 9)), id: R.int(0, 15), vertical: R() < 0.35 });
    return bld;
  }

  _industrial(l, R) {
    const inset = R.range(2, 6);
    const x0 = l.x0 + inset, x1 = l.x1 - inset, z0 = l.z0 + inset, z1 = l.z1 - inset;
    if (x1 - x0 < 10 || z1 - z0 < 10) return null;
    const h = R.range(8, 15);
    const parts = [{ x0, z0, x1, z1, y0: 0, y1: h, style: FACADE.METAL }];
    if (R() < 0.4) {
      const ox = R.range(x0, x1 - 8);
      parts.push({ x0: ox, z0: z0 + 2, x1: ox + 8, z1: z0 + 10, y0: h, y1: h + R.range(4, 8), style: FACADE.CONCRETE });
    }
    const b = { x0, z0, x1, z1, parts, style: FACADE.METAL, roof: 'flat', height: h, industrial: true };
    // storage tanks / chimney
    if (R() < 0.45) this.prop('tank', x1 + Math.min(4, inset) - 1, (z0 + z1) / 2, 0, { s: R.range(0.8, 1.3), y: CURB_H });
    if (R() < 0.3) { const cx = x0 + 3, cz = z1 - 3; this.prop('chimney', cx, cz, 0, { s: R.range(0.8, 1.4), y: h }); }
    return b;
  }

  _warehouse(l, R) {
    const inset = R.range(3, 7);
    const x0 = l.x0 + inset, x1 = l.x1 - inset, z0 = l.z0 + inset, z1 = l.z1 - inset;
    if (x1 - x0 < 14 || z1 - z0 < 14) return null;
    const h = R.range(9, 13);
    const parts = [{ x0, z0, x1, z1, y0: 0, y1: h, style: R() < 0.5 ? FACADE.METAL : FACADE.CONCRETE }];
    // shipping containers around
    for (let i = 0; i < 4; i++) {
      if (R() < 0.5) continue;
      const along = R() < 0.5;
      const x = along ? R.range(l.x0 + 3, l.x1 - 8) : (R() < 0.5 ? l.x0 + 2 : l.x1 - 2);
      const z = along ? (R() < 0.5 ? l.z0 + 1.8 : l.z1 - 1.8) : R.range(l.z0 + 4, l.z1 - 4);
      if (x > x0 - 3 && x < x1 + 3 && z > z0 - 3 && z < z1 + 3) continue;
      const rot = along ? 0 : Math.PI / 2;
      this.prop('container', x, z, rot, { v: R.int(0, 3), y: CURB_H });
      this.collider(x, z, along ? 3.05 : 1.22, along ? 1.22 : 3.05, 0, 2.6, 'container');
    }
    return { x0, z0, x1, z1, parts, style: parts[0].style, roof: 'flat', height: h, warehouse: true };
  }

  _house(l, R, sides) {
    const w = Math.min(l.w - 4, R.range(8, 13)), d = Math.min(l.d - 4, R.range(8, 12));
    if (w < 6 || d < 6) return null;
    const cx = (l.x0 + l.x1) / 2 + R.range(-1, 1), cz = (l.z0 + l.z1) / 2 + R.range(-1, 1);
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const floors = R() < 0.55 ? 2 : 1;
    const h = floors * 3 + 0.4;
    const ridgeAlongX = w > d;
    const parts = [{ x0, z0, x1, z1, y0: 0, y1: h, style: FACADE.HOUSE }];
    // trees and hedges in the yard
    for (let i = 0; i < 2; i++) if (R() < 0.7) {
      const tx = R() < 0.5 ? R.range(l.x0 + 1, x0 - 1) : R.range(x1 + 1, l.x1 - 1);
      const tz = R.range(l.z0 + 1.5, l.z1 - 1.5);
      if (tx > l.x0 + 1 && tx < l.x1 - 1) { this.prop('tree', tx, tz, R() * 6.28, { s: R.range(0.7, 1.1), y: CURB_H }); this.collider(tx, tz, 0.35, 0.35, 0, 6, 'tree'); }
    }
    return { x0, z0, x1, z1, parts, style: FACADE.HOUSE, roof: 'gable', ridgeAlongX, roofH: R.range(2, 3.2), height: h, house: true, color: R.int(0, 5), sides };
  }

  _parkingPatch(lot, R) {
    // parked cars in inner courtyards
    const n = Math.floor((lot.w - 4) / 2.8);
    for (let i = 0; i < n; i++) if (R() < 0.55) this.parked.push({ x: lot.x0 + 2.5 + i * 2.8, z: lot.z0 + 3, rot: 0, type: R.pick(['sedan', 'sedan', 'suv', 'van']), color: R.int(0, 11) });
  }

  // ------------------------------------------------------------------ streets
  _planStreets() {
    const L = this.layout;
    const R = rng(L.seed ^ 0x1234);
    // sidewalk furniture around every block perimeter
    for (const b of L.blocks) {
      if (b.special === 'river') { this._riverBank(b, R); continue; }
      const dense = b.district === 'downtown' || b.district === 'commercial';
      const edges = [
        { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z0, nx: 0, nz: -1 },   // south side (road below)
        { x0: b.x0, z0: b.z1, x1: b.x1, z1: b.z1, nx: 0, nz: 1 },
        { x0: b.x0, z0: b.z0, x1: b.x0, z1: b.z1, nx: -1, nz: 0 },
        { x0: b.x1, z0: b.z0, x1: b.x1, z1: b.z1, nx: 1, nz: 0 },
      ];
      for (const e of edges) {
        const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
        const dx = (e.x1 - e.x0) / len, dz = (e.z1 - e.z0) / len;
        const rotToRoad = Math.atan2(e.nx, e.nz); // model faces +Z -> towards road
        const at = (s, off) => [e.x0 + dx * s - e.nx * off, e.z0 + dz * s - e.nz * off];
        // skip outer-block sides that don't face a road
        if (b.outer) {
          const [tx, tz] = at(len / 2, -3);
          if (!L.roadAt(tx, tz)) continue;
        }
        // street lamps
        const lampStep = b.district === 'suburban' ? 36 : 30;
        for (let s = 8; s < len - 6; s += lampStep) {
          const [x, z] = at(s, 0.7);
          const lp = this.breakable(this.prop('lamp', x, z, rotToRoad, { y: CURB_H }), this.collider(x, z, 0.18, 0.18, 0, 8, 'pole'));
          const [px, pz] = [x + e.nx * 2.6, z + e.nz * 2.6];
          this.lightPools.push({ x: px, z: pz, r: 9, color: b.district === 'industrial' || b.district === 'warehouse' ? 0xffa050 : 0xffd9a0, i: 1, lamp: lp });
        }
        // trees
        const treeChance = { suburban: 0.9, commercial: 0.55, downtown: 0.4, riverside: 1, industrial: 0.1, warehouse: 0.05, outskirts: 0.6 }[b.district] ?? 0.3;
        for (let s = 14 + R() * 4; s < len - 10; s += 13) {
          if (R() > treeChance) continue;
          const [x, z] = at(s, 1.3);
          this.prop('tree', x, z, R() * 6.28, { s: R.range(0.75, 1.15), y: CURB_H });
          this.collider(x, z, 0.3, 0.3, 0, 6, 'tree');
        }
        // small props
        if (dense) {
          for (let s = 20; s < len - 10; s += 22 + R() * 20) {
            const [x, z] = at(s, 0.55);
            const t = R.pick(['meter', 'meter', 'bin', 'bench', 'hydrant', 'bollard']);
            this.prop(t, x, z, rotToRoad, { y: CURB_H });
          }
        } else if (R() < 0.8) {
          const [x, z] = at(len * R.range(0.2, 0.8), 0.6);
          this.prop('hydrant', x, z, 0, { y: CURB_H });
        }
        // corner bollards
        if (dense) for (const s of [2, len - 2]) { const [x, z] = at(s, 0.5); this.prop('bollard', x, z, 0, { y: CURB_H }); }
        // storm drains in the gutter
        for (let s = 10; s < len - 5; s += 40) { const [x, z] = at(s, -0.35); this.prop('drain', x, z, rotToRoad, { y: 0.004 }); }
      }
      // parked cars along streets in residential/commercial
      if (b.district === 'suburban' || b.district === 'commercial') {
        for (const side of [0, 1]) {
          const z = side ? b.z1 + 1.3 : b.z0 - 1.3;
          if (!(L.roadAt((b.x0 + b.x1) / 2, z)?.type === ROAD_TYPES.street)) continue;
          for (let x = b.x0 + 12; x < b.x1 - 12; x += 6.5) if (R() < 0.22) this.parked.push({ x, z, rot: side ? Math.PI / 2 : -Math.PI / 2, type: R.pick(['sedan', 'sedan', 'suv', 'van']), color: R.int(0, 11), street: true });
        }
      }
    }
    // manholes on roads (in lanes)
    for (const e of L.edges) {
      if (e.ring) continue;
      const [ax, az] = e.points[0], [bx, bz] = e.points[e.points.length - 1];
      for (let s = 30; s < e.length - 25; s += 55) {
        if (R() < 0.4) continue;
        const t = s / e.length;
        const off = (R() < 0.5 ? -1 : 1) * R.range(1, 4);
        const x = ax + (bx - ax) * t + (e.axis === 'z' ? off : 0), z = az + (bz - az) * t + (e.axis === 'x' ? off : 0);
        this.prop('manhole', x, z, 0, { y: 0.003 });
      }
    }
    // traffic lights at signalized intersections: 4 poles on the corners
    for (const n of L.nodes) {
      if (!n.signal) continue;
      const hx = lineHalfWidth(n.k), hz = lineHalfWidth(n.l);
      // pole at each corner, arm over the road for approaching traffic
      const corners = [
        { x: n.x + hx + 0.8, z: n.z + hz + 0.8, rot: Math.PI, dir: 'z', approach: -1 },
        { x: n.x - hx - 0.8, z: n.z - hz - 0.8, rot: 0, dir: 'z', approach: 1 },
        { x: n.x - hx - 0.8, z: n.z + hz + 0.8, rot: Math.PI / 2, dir: 'x', approach: 1 },
        { x: n.x + hx + 0.8, z: n.z - hz - 0.8, rot: -Math.PI / 2, dir: 'x', approach: -1 },
      ];
      for (const c of corners) {
        const p = this.prop('signal', c.x, c.z, c.rot, { y: CURB_H, s: c.dir === 'z' ? hx / 10 : hz / 10 });
        p.node = n.id; p.axis = c.dir;
        this.collider(c.x, c.z, 0.2, 0.2, 0, 7, 'pole');
      }
    }
  }

  _riverBank(b, R) {
    // promenade trees and lamps along the canal edge
    const west = b.x0 < RIVER.x0;
    const edgeX = west ? RIVER.x0 - 1.2 : RIVER.x1 + 1.2;
    for (let z = b.z0 + 8; z < b.z1 - 6; z += 18) {
      this.prop('lamp', edgeX, z, west ? Math.PI / 2 : -Math.PI / 2, { y: CURB_H });
      this.lightPools.push({ x: edgeX + (west ? -2 : 2), z, r: 8, color: 0xcfe0ff, i: 0.8 });
      this.prop('tree', edgeX + (west ? -6 : 6), z + 9, R() * 6, { y: CURB_H, s: R.range(0.8, 1.1) });
    }
    // railing collider along the canal
    const cx = west ? RIVER.x0 - 0.25 : RIVER.x1 + 0.25;
    this.collider(cx, (b.z0 + b.z1) / 2, 0.25, (b.z1 - b.z0) / 2, 0, 1.1, 'rail');
    this.prop('railing', cx, (b.z0 + b.z1) / 2, 0, { s: b.z1 - b.z0, y: CURB_H });
    // the river walls between the bank and the adjacent road ends
    if (west) this.collider((b.x0 + RIVER.x0) / 2, (b.z0 + b.z1) / 2, 0.1, 0.1, 0, 0, 'none');
  }

  _planRiver() {
    // bridge railings on every E-W road crossing the river
    for (const e of this.layout.edges) {
      if (!e.bridge) continue;
      const z = e.points[0][1];
      const hw = lineHalfWidth(e.line);
      for (const side of [-1, 1]) {
        const cz = z + side * (hw + 0.3);
        this.collider((RIVER.x0 + RIVER.x1) / 2, cz, (RIVER.x1 - RIVER.x0) / 2 + 2, 0.3, 0, 1.2, 'rail');
        this.prop('bridgeRail', (RIVER.x0 + RIVER.x1) / 2, cz, 0, { s: RIVER.x1 - RIVER.x0 + 4, y: 0 });
      }
      for (const x of [RIVER.x0 + 8, (RIVER.x0 + RIVER.x1) / 2, RIVER.x1 - 8]) {
        for (const side of [-1, 1]) {
          const lz = z + side * (hw + 0.2);
          this.prop('lamp', x, lz, side > 0 ? Math.PI : 0, { y: 0.9 });
          this.lightPools.push({ x, z: z + side * (hw - 2.5), r: 9, color: 0xffd9a0, i: 1 });
        }
      }
    }
    // canal walls along the N-S extents where there are no bridges (keep cars out of the water at road ends)
  }

  _planHighway() {
    const L = this.layout;
    const H = ROAD_TYPES.highway;
    const pts = L.ringSamples;
    // walk the ring: median barrier, outer wall, lamps
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.1) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const nx = -dz, nz = dx;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const ang = Math.atan2(dx, dz);
      // outward normal (away from city center)
      const outSign = (mx * nx + mz * nz) > 0 ? 1 : -1;
      const ox = nx * outSign, oz = nz * outSign;
      const outer = H.width / 2 + 0.6;
      this.collider(mx + ox * outer, mz + oz * outer, 0.4, len / 2 + 0.6, ang, 3, 'wall');
      // median barrier (gaps at link junctions are not needed: links join from the inner side)
      if (!L.nearRingJunction(mx, mz)) this.collider(mx, mz, 0.35, len / 2 + 0.3, ang, 1, 'barrier');
      if (i % 5 === 0) {
        this.prop('highwayLamp', mx, mz, ang, { y: 0 });
        this.lightPools.push({ x: mx + nx * 6, z: mz + nz * 6, r: 11, color: 0xffc080, i: 1 });
        this.lightPools.push({ x: mx - nx * 6, z: mz - nz * 6, r: 11, color: 0xffc080, i: 1 });
      }
    }
    this.highwaySegments = pts;
    // inner edge guard rails except at link junctions
    for (let i = 0; i < pts.length; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.1) continue;
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const nx = -dz, nz = dx;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const inSign = (mx * nx + mz * nz) > 0 ? -1 : 1;
      const ix = mx + nx * inSign * (H.width / 2 + 0.5), iz = mz + nz * inSign * (H.width / 2 + 0.5);
      // leave gaps for link roads
      const nearLink = [-4, -2, 0, 2, 4].some((k) => {
        const c = k * GRID;
        return (Math.abs(ix - c) < 34 && Math.abs(Math.abs(iz) - RING) < 30) || (Math.abs(iz - c) < 34 && Math.abs(Math.abs(ix) - RING) < 30);
      });
      if (nearLink) continue;
      this.collider(ix, iz, 0.2, len / 2 + 0.3, Math.atan2(dx, dz), 0.8, 'rail');
    }
    void RING_CORNER_R; void clamp; void HALF_LINES; void lineType; void EDGE;
  }

  _planTunnel() {
    const T = TUNNEL;
    const hw = T.width / 2 + 0.4;
    for (const side of [-1, 1]) this.collider(T.x + side * hw, (T.z0 + T.z1) / 2, 0.4, (T.z1 - T.z0) / 2, 0, 7, 'wall');
    for (let z = T.z0 + 4; z < T.z1; z += 10) this.lightPools.push({ x: T.x, z, r: 8, color: 0xffb070, i: 0.9 });
  }

  _planSpecial() {
    const L = this.layout;
    for (const b of L.blocks) {
      const R = rng(b.seed ^ 0x777);
      if (b.special === 'parking' || b.special === 'parkingDeck') {
        // stalls with parked cars and lamps
        for (let z = b.iz0 + 6; z < b.iz1 - 4; z += 16) {
          for (let x = b.ix0 + 3; x < b.ix1 - 3; x += 2.8) {
            if (R() < 0.45) this.parked.push({ x, z, rot: 0, type: R.pick(['sedan', 'suv', 'sedan', 'van']), color: R.int(0, 11) });
            if (R() < 0.35) this.parked.push({ x, z: z + 5.6, rot: Math.PI, type: R.pick(['sedan', 'suv']), color: R.int(0, 11) });
          }
          this.prop('stalls', (b.ix0 + b.ix1) / 2, z + 2.8, 0, { s: b.ix1 - b.ix0 - 6, y: 0.025 });
        }
        for (let x = b.ix0 + 10; x < b.ix1; x += 30) for (let z = b.iz0 + 12; z < b.iz1; z += 32) {
          const lp = this.breakable(this.prop('lamp', x, z, 0, { y: 0.02 }), this.collider(x, z, 0.18, 0.18, 0, 8, 'pole'));
          this.lightPools.push({ x, z: z + 2.5, r: 10, color: 0xe8f0ff, i: 1, lamp: lp });
        }
        if (b.special === 'parkingDeck') {
          // covered deck: roof slab on pillars (drive underneath)
          const bld = { x0: b.ix0 + 4, z0: b.iz0 + 4, x1: b.ix1 - 4, z1: b.iz1 - 4, parts: [], style: FACADE.CONCRETE, roof: 'deck', height: 7.5, deck: true, block: b, sides: [], district: b.district };
          bld.parts.push({ x0: bld.x0, z0: bld.z0, x1: bld.x1, z1: bld.z1, y0: 5.2, y1: 6.2, style: FACADE.CONCRETE, slab: true });
          bld.id = this.buildings.length; this.buildings.push(bld);
          for (let x = bld.x0 + 2; x <= bld.x1 - 1; x += 16) for (let z = bld.z0 + 2; z <= bld.z1 - 1; z += 16) {
            this.prop('pillar', x, z, 0, { y: 0.02 }); this.collider(x, z, 0.45, 0.45, 0, 5.2, 'pillar');
          }
        }
      } else if (b.special === 'construction') {
        for (let i = 0; i < 26; i++) {
          const x = R.range(b.ix0 + 3, b.ix1 - 3), z = R.range(b.iz0 + 3, b.iz1 - 3);
          if (L.ramps.some((r) => Math.hypot(r.x - x, r.z - z) < 14)) continue;
          this.prop('cone', x, z, R() * 6, { y: 0.02 });
        }
        for (let x = b.ix0 + 2; x < b.ix1 - 2; x += 4.2) {
          this.prop('jersey', x, b.iz1 - 1, 0, { y: 0.02, v: 1 });
        }
        this.collider((b.ix0 + b.ix1) / 2, b.iz1 - 1, (b.ix1 - b.ix0) / 2 - 2, 0.4, 0, 1, 'barrier');
        this.prop('crane', b.ix0 + 12, b.iz1 - 14, 0.4, { y: 0.02 });
        this.collider(b.ix0 + 12, b.iz1 - 14, 2, 2, 0, 40, 'building');
        for (const r of L.ramps) if (r.x > b.x0 && r.x < b.x1 && r.z > b.z0 && r.z < b.z1) this.prop('ramp', r.x, r.z, r.angle, { y: 0.02 });
        this.prop('dirt', (b.ix0 + b.ix1) / 2, (b.iz0 + b.iz1) / 2, 0, { y: 0.03, s: Math.min(b.ix1 - b.ix0, b.iz1 - b.iz0) });
        for (let x = b.ix0 + 10; x < b.ix1; x += 40) { this.prop('floodlight', x, b.iz0 + 2, 0, { y: 0.02 }); this.lightPools.push({ x, z: b.iz0 + 10, r: 14, color: 0xfff2d0, i: 1.2 }); }
      } else if (b.special === 'park' || b.special === 'hill') {
        for (let i = 0; i < (b.special === 'park' ? 60 : 30); i++) {
          const x = R.range(b.ix0 + 2, b.ix1 - 2), z = R.range(b.iz0 + 2, b.iz1 - 2);
          if (b.special === 'hill' && Math.abs(x - TUNNEL.x) < 20) continue;
          this.prop('tree', x, z, R() * 6, { s: R.range(0.8, 1.4), y: CURB_H });
          this.collider(x, z, 0.35, 0.35, 0, 6, 'tree');
        }
        if (b.special === 'park') for (let x = b.ix0 + 15; x < b.ix1; x += 35) { this.prop('lamp', x, (b.iz0 + b.iz1) / 2, 0, { y: CURB_H }); this.lightPools.push({ x, z: (b.iz0 + b.iz1) / 2 + 2.5, r: 8, color: 0xcfe8ff, i: 0.8 }); }
      } else if (b.special === 'yard') {
        for (let i = 0; i < 14; i++) {
          const along = R() < 0.5;
          const x = R.range(b.ix0 + 6, b.ix1 - 6), z = R.range(b.iz0 + 6, b.iz1 - 6);
          const stack = R() < 0.3 ? 2 : 1;
          for (let s = 0; s < stack; s++) this.prop('container', x, z, along ? 0 : Math.PI / 2, { v: R.int(0, 3), y: 0.02 + s * 2.6 });
          this.collider(x, z, along ? 3.05 : 1.22, along ? 1.22 : 3.05, 0, 2.6 * stack, 'container');
        }
        for (let x = b.ix0 + 10; x < b.ix1; x += 40) { this.prop('floodlight', x, b.iz0 + 2, 0, { y: 0.02 }); this.lightPools.push({ x, z: b.iz0 + 10, r: 14, color: 0xffb060, i: 1 }); }
      }
    }
  }
}
