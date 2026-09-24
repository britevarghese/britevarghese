// CityLayout: the deterministic, render-independent description of the fictional city
// "Port Halvern": road network, districts, blocks, lots, ground height and special zones.
// Everything here is pure data so it can later be shared with an authoritative server.
import { rng, clamp } from '../core/util.js';

export const GRID = 160;           // distance between road center lines (m)
export const HALF_LINES = 6;       // lines at k*GRID for k in [-6, 6]
export const EDGE = HALF_LINES * GRID; // 960
export const RING = 1180;          // highway ring center line
export const RING_CORNER_R = 180;  // highway corner radius
export const SIDEWALK_W = 4;
export const CURB_H = 0.15;
export const RIVER = { x0: 520, x1: 600, depth: -5.5, water: -3.2 };
export const CHUNK = 160;
export const WORLD_HALF = 1400;

export const ROAD_TYPES = {
  arterial: { lanes: 2, laneWidth: 3.5, median: 1.0, shoulder: 2.5, speed: 17, name: 'arterial' },
  street: { lanes: 1, laneWidth: 3.5, median: 0, shoulder: 2.5, speed: 13, name: 'street' },
  highway: { lanes: 3, laneWidth: 3.75, median: 2.0, shoulder: 3.0, speed: 27, name: 'highway' },
  link: { lanes: 2, laneWidth: 3.5, median: 1.0, shoulder: 2.0, speed: 20, name: 'link' },
};
for (const t of Object.values(ROAD_TYPES)) t.width = 2 * (t.median / 2 + t.lanes * t.laneWidth + t.shoulder);

export const lineType = (k) => (k % 2 === 0 ? ROAD_TYPES.arterial : ROAD_TYPES.street);
export const lineHalfWidth = (k) => lineType(k).width / 2;

export const DISTRICT_NAMES = {
  downtown: 'Downtown', commercial: 'Market District', industrial: 'Ironworks', warehouse: 'Dockside Warehouses',
  suburban: 'Elm Heights', riverside: 'Riverside', outskirts: 'Ring Highway', park: 'Halvern Park', construction: 'Construction Zone',
};

// Special blocks by (i, j) = block index where block spans [i*GRID, (i+1)*GRID] x [j*GRID, (j+1)*GRID]
const SPECIAL = {
  '-3,1': 'parking',
  '1,-2': 'parkingDeck',
  '2,2': 'construction',
  '-1,3': 'park',
  '-2,-4': 'park',
  '-5,1': 'hill', '-4,1': 'hill',
  '5,-3': 'yard',
  '4,-5': 'yard',
};
// Tunnel: the N-S arterial at x=-640 between z=160 and z=320 passes under the hill.
export const TUNNEL = { x: -640, z0: 160 + 10, z1: 320 - 10, axis: 'z', width: ROAD_TYPES.arterial.width };

export const SAFEHOUSES = [
  { id: 'home', name: 'Safehouse', x: -250, z: 96, heading: 0 },
  { id: 'east', name: 'Ironworks Garage', x: 736, z: 250, heading: Math.PI },
];
export const SHOPS = [
  { id: 'paint', name: 'Neon Body & Paint', x: -390, z: -250 },
  { id: 'perf', name: 'Redline Performance', x: 250, z: -410 },
];

export function district(x, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > EDGE + 12 || az > EDGE + 12) return 'outskirts';
  if (x > 480 && x < 640) return 'riverside';
  if (Math.max(ax, az) < 400) return 'downtown';
  if (x >= 640) return z > -160 ? 'industrial' : 'warehouse';
  if (x < -480 || z > 640 || z < -640) return 'suburban';
  return 'commercial';
}

export class CityLayout {
  constructor(seed = 20240917) {
    this.seed = seed;
    this.nodes = [];      // {id, x, z, type:'grid'|'ring'|'end', k, l, signal:boolean, edges:[]}
    this.edges = [];      // {id, a, b, type, points:[[x,z],...], length}
    this.blocks = [];     // {i, j, x0, z0, x1, z1, ix0.., district, special, lots:[]}
    this.nodeMap = new Map();
    this._buildRoads();
    this._buildBlocks();
  }

  // ------------------------------------------------------------------ roads
  _node(x, z, props) {
    const key = `${Math.round(x)},${Math.round(z)}`;
    if (this.nodeMap.has(key)) return this.nodeMap.get(key);
    const n = { id: this.nodes.length, x, z, edges: [], signal: false, ...props };
    this.nodes.push(n);
    this.nodeMap.set(key, n);
    return n;
  }

  _edge(a, b, type, points) {
    points = points || [[a.x, a.z], [b.x, b.z]];
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const e = { id: this.edges.length, a: a.id, b: b.id, type, points, length, bridge: false, tunnel: false };
    this.edges.push(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
    return e;
  }

  _buildRoads() {
    const N = HALF_LINES;
    for (let k = -N; k <= N; k++) for (let l = -N; l <= N; l++) this._node(k * GRID, l * GRID, { type: 'grid', k, l });
    for (let k = -N; k <= N; k++) {
      for (let l = -N; l < N; l++) {
        // N-S edge along x = k*GRID (type of line k)
        const a = this.nodeMap.get(`${k * GRID},${l * GRID}`), b = this.nodeMap.get(`${k * GRID},${(l + 1) * GRID}`);
        const e = this._edge(a, b, lineType(k));
        e.axis = 'z'; e.line = k;
        if (k * GRID === TUNNEL.x && l * GRID === 160) e.tunnel = true;
        // E-W edge along z = k*GRID
        const c = this.nodeMap.get(`${l * GRID},${k * GRID}`), d = this.nodeMap.get(`${(l + 1) * GRID},${k * GRID}`);
        const f = this._edge(c, d, lineType(k));
        f.axis = 'x'; f.line = k;
        if (l * GRID === 480) f.bridge = true;
      }
    }
    // Highway ring: junctions where arterials link out, plus arcs at the corners.
    const junction = (x, z) => this._node(x, z, { type: 'ring' });
    const linkKs = [-4, -2, 0, 2, 4];
    const ringNodes = { n: [], s: [], e: [], w: [] };
    for (const k of linkKs) {
      const x = k * GRID;
      ringNodes.n.push(junction(x, RING)); ringNodes.s.push(junction(x, -RING));
      ringNodes.e.push(junction(RING, x)); ringNodes.w.push(junction(-RING, x));
      // links
      const le = (from, to, axis) => { const e = this._edge(from, to, ROAD_TYPES.link); e.axis = axis; e.line = k; };
      le(this.nodeMap.get(`${x},${EDGE}`), this.nodeMap.get(`${x},${RING}`), 'z');
      le(this.nodeMap.get(`${x},${-EDGE}`), this.nodeMap.get(`${x},${-RING}`), 'z');
      le(this.nodeMap.get(`${EDGE},${x}`), this.nodeMap.get(`${RING},${x}`), 'x');
      le(this.nodeMap.get(`${-EDGE},${x}`), this.nodeMap.get(`${-RING},${x}`), 'x');
    }
    const H = ROAD_TYPES.highway;
    const straight = (list) => { for (let i = 0; i < list.length - 1; i++) { const e = this._edge(list[i], list[i + 1], H); e.ring = true; } };
    straight(ringNodes.n); straight(ringNodes.s); straight(ringNodes.e); straight(ringNodes.w);
    // corners: connect last junction of one side to first of the next through a quarter arc
    const C = RING - RING_CORNER_R;
    const corner = (from, to, cx, cz, a0, a1) => {
      const pts = [[from.x, from.z]];
      const sx = cx + Math.cos(a0) * RING_CORNER_R, sz = cz + Math.sin(a0) * RING_CORNER_R;
      pts.push([sx, sz]);
      for (let i = 1; i < 12; i++) { const a = a0 + (a1 - a0) * (i / 12); pts.push([cx + Math.cos(a) * RING_CORNER_R, cz + Math.sin(a) * RING_CORNER_R]); }
      pts.push([cx + Math.cos(a1) * RING_CORNER_R, cz + Math.sin(a1) * RING_CORNER_R]);
      pts.push([to.x, to.z]);
      const e = this._edge(from, to, H, pts); e.ring = true;
    };
    const last = (a) => a[a.length - 1];
    corner(last(ringNodes.n), last(ringNodes.e), C, C, Math.PI / 2, 0);            // NE
    corner(ringNodes.e[0], last(ringNodes.s), C, -C, 0, -Math.PI / 2);            // SE
    corner(ringNodes.s[0], ringNodes.w[0], -C, -C, -Math.PI / 2, -Math.PI);       // SW
    corner(last(ringNodes.w), ringNodes.n[0], -C, C, Math.PI, Math.PI / 2);        // NW
    this.ringSamples = this._sampleRing();

    // Signals at grid intersections of degree 4 where an arterial is involved.
    for (const n of this.nodes) {
      if (n.type !== 'grid') continue;
      const inner = Math.abs(n.k) < HALF_LINES && Math.abs(n.l) < HALF_LINES;
      n.signal = inner && (n.k % 2 === 0 || n.l % 2 === 0);
      n.phaseOffset = ((n.k * 3 + n.l * 5) % 7 + 7) % 7 * 2.1;
    }
  }

  // ordered loop of points along the ring center line (counter-clockwise), ~10 m apart
  _sampleRing() {
    const C = RING - RING_CORNER_R, pts = [];
    const line = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 10); for (let i = 0; i < n; i++) pts.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]); };
    const arc = (cx, cz, a0, a1) => { const n = 14; for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * RING_CORNER_R, cz + Math.sin(a) * RING_CORNER_R]); } };
    line(RING, -C, RING, C); arc(C, C, 0, Math.PI / 2);
    line(C, RING, -C, RING); arc(-C, C, Math.PI / 2, Math.PI);
    line(-RING, C, -RING, -C); arc(-C, -C, Math.PI, Math.PI * 1.5);
    line(-C, -RING, C, -RING); arc(C, -C, Math.PI * 1.5, Math.PI * 2);
    return pts;
  }

  // true near a link junction on the ring (median barrier has a crossover gap there)
  nearRingJunction(x, z, r = 40) {
    for (const k of [-4, -2, 0, 2, 4]) {
      const c = k * GRID;
      if ((Math.abs(x - c) < r && Math.abs(Math.abs(z) - RING) < 20) || (Math.abs(z - c) < r && Math.abs(Math.abs(x) - RING) < 20)) return true;
    }
    return false;
  }

  // distance to the highway ring center line (analytic rounded square)
  ringDistance(x, z) {
    const C = RING - RING_CORNER_R;
    const ax = Math.abs(x), az = Math.abs(z);
    if (ax > C && az > C) return Math.abs(Math.hypot(ax - C, az - C) - RING_CORNER_R);
    if (ax > C && az <= C) return Math.abs(ax - RING);
    if (az > C && ax <= C) return Math.abs(az - RING);
    return Math.min(Math.abs(ax - RING), Math.abs(az - RING));
  }

  // ------------------------------------------------------------------ road queries
  // Returns road info at a point or null: {type, axis, line, dist}
  roadAt(x, z) {
    // highway
    const rd = this.ringDistance(x, z);
    if (rd < ROAD_TYPES.highway.width / 2) return { type: ROAD_TYPES.highway, ring: true, dist: rd };
    const kx = Math.round(x / GRID), kz = Math.round(z / GRID);
    const dx = Math.abs(x - kx * GRID), dz = Math.abs(z - kz * GRID);
    const inGridX = Math.abs(kx) <= HALF_LINES, inGridZ = Math.abs(kz) <= HALF_LINES;
    // N-S road along x = kx*GRID
    if (inGridX) {
      const hw = lineHalfWidth(kx);
      const zLim = EDGE + (kz !== 0 && Math.abs(kz) >= HALF_LINES ? lineHalfWidth(kz) : 0);
      if (dx < hw && Math.abs(z) <= Math.max(zLim, EDGE + hw)) return { type: lineType(kx), axis: 'z', line: kx, dist: dx };
      // links out to the ring
      if (kx % 2 === 0 && Math.abs(kx) < HALF_LINES && dx < ROAD_TYPES.link.width / 2 && Math.abs(z) > EDGE && Math.abs(z) < RING) return { type: ROAD_TYPES.link, axis: 'z', line: kx, dist: dx };
    }
    if (inGridZ) {
      const hw = lineHalfWidth(kz);
      if (dz < hw && Math.abs(x) <= EDGE + hw) return { type: lineType(kz), axis: 'x', line: kz, dist: dz };
      if (kz % 2 === 0 && Math.abs(kz) < HALF_LINES && dz < ROAD_TYPES.link.width / 2 && Math.abs(x) > EDGE && Math.abs(x) < RING) return { type: ROAD_TYPES.link, axis: 'x', line: kz, dist: dz };
    }
    return null;
  }

  // ------------------------------------------------------------------ blocks & lots
  _buildBlocks() {
    const N = HALF_LINES;
    const R = rng(this.seed);
    for (let i = -N; i < N; i++) {
      for (let j = -N; j < N; j++) {
        const x0 = i * GRID + lineHalfWidth(i), x1 = (i + 1) * GRID - lineHalfWidth(i + 1);
        const z0 = j * GRID + lineHalfWidth(j), z1 = (j + 1) * GRID - lineHalfWidth(j + 1);
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const b = { i, j, x0, z0, x1, z1, cx, cz, district: district(cx, cz), special: SPECIAL[`${i},${j}`] || null, lots: [], seed: Math.floor(R() * 1e9) };
        if (b.district === 'riverside') b.special = 'river';
        this.blocks.push(b);
      }
    }
    // Outer band blocks between grid edge and highway (four sides), split at the link roads.
    const outer = [];
    const lo = EDGE + lineHalfWidth(HALF_LINES), hi = RING - ROAD_TYPES.highway.width / 2 - 6;
    const cuts = [-EDGE, -640, -320, 0, 320, 640, EDGE];
    for (let c = 0; c < cuts.length - 1; c++) {
      const a0 = cuts[c] + (c === 0 ? 0 : ROAD_TYPES.link.width / 2), a1 = cuts[c + 1] - (c === cuts.length - 2 ? 0 : ROAD_TYPES.link.width / 2);
      outer.push({ x0: a0, x1: a1, z0: lo, z1: hi, side: 'n' });
      outer.push({ x0: a0, x1: a1, z0: -hi, z1: -lo, side: 's' });
      outer.push({ x0: lo, x1: hi, z0: a0, z1: a1, side: 'e' });
      outer.push({ x0: -hi, x1: -lo, z0: a0, z1: a1, side: 'w' });
    }
    for (const o of outer) {
      const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
      const d = o.side === 'e' ? (cz < -160 ? 'warehouse' : 'industrial') : o.side === 's' ? 'warehouse' : 'suburban';
      this.blocks.push({ i: 'o', j: o.side, ...o, cx, cz, district: d, outer: true, special: (o.side === 'e' && Math.abs(cx - 560) < 100) ? 'river' : null, lots: [], seed: Math.floor(R() * 1e9) });
    }
    for (const b of this.blocks) this._subdivide(b);
    // quick lookup grid for blocks
    this.blockGrid = new Map();
    for (const b of this.blocks) {
      for (let x = Math.floor(b.x0 / 40); x <= Math.floor(b.x1 / 40); x++) for (let z = Math.floor(b.z0 / 40); z <= Math.floor(b.z1 / 40); z++) {
        const key = x + ',' + z;
        if (!this.blockGrid.has(key)) this.blockGrid.set(key, []);
        this.blockGrid.get(key).push(b);
      }
    }
  }

  blockAt(x, z) {
    const list = this.blockGrid.get(Math.floor(x / 40) + ',' + Math.floor(z / 40));
    if (!list) return null;
    for (const b of list) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    return null;
  }

  // Split a block's buildable interior into lots (recursive BSP). Lots touching the
  // perimeter get buildings; inner leftovers become courtyards/parking.
  _subdivide(b) {
    const R = rng(b.seed);
    const sw = SIDEWALK_W;
    const ix0 = b.x0 + sw, ix1 = b.x1 - sw, iz0 = b.z0 + sw, iz1 = b.z1 - sw;
    b.ix0 = ix0; b.ix1 = ix1; b.iz0 = iz0; b.iz1 = iz1;
    if (b.special === 'river') {
      // river banks: promenade only (water in between)
      return;
    }
    if (['parking', 'construction', 'park', 'hill', 'yard'].includes(b.special)) return;
    const d = b.district;
    const minSize = { downtown: 38, commercial: 18, industrial: 34, warehouse: 40, suburban: 20, outskirts: 30 }[d] || 24;
    const lots = [];
    const split = (x0, z0, x1, z1, depth) => {
      const w = x1 - x0, h = z1 - z0;
      if ((w < minSize * 2 && h < minSize * 2) || depth > 6) { lots.push({ x0, z0, x1, z1 }); return; }
      const alongX = w > h ? true : w < h ? false : R() < 0.5;
      const total = alongX ? w : h;
      if (total < minSize * 2) { lots.push({ x0, z0, x1, z1 }); return; }
      const t = R.range(0.35, 0.65);
      const cut = (alongX ? x0 : z0) + total * t;
      // occasional alley between lots in dense districts
      const gap = (d === 'downtown' || d === 'commercial') && depth === 0 && R() < 0.5 ? 7 : 0;
      if (alongX) { split(x0, z0, cut - gap / 2, z1, depth + 1); split(cut + gap / 2, z0, x1, z1, depth + 1); if (gap) b.alley = { x0: cut - gap / 2, x1: cut + gap / 2, z0, z1 }; }
      else { split(x0, z0, x1, cut - gap / 2, depth + 1); split(x0, cut + gap / 2, x1, z1, depth + 1); if (gap) b.alley = { x0, x1, z0: cut - gap / 2, z1: cut + gap / 2 }; }
    };
    split(ix0, iz0, ix1, iz1, 0);
    for (const l of lots) {
      const touches = l.x0 <= ix0 + 0.1 || l.x1 >= ix1 - 0.1 || l.z0 <= iz0 + 0.1 || l.z1 >= iz1 - 0.1;
      l.edge = touches;
      l.w = l.x1 - l.x0; l.d = l.z1 - l.z0;
      if (!touches && d !== 'downtown') l.courtyard = true;
      if (d === 'suburban' && R() < 0.12) l.empty = true;
    }
    b.lots = lots;
  }

  // ------------------------------------------------------------------ ground height
  // Height of the drivable surface. Roads are at 0, sidewalks/plazas at CURB_H,
  // the river channel is sunk, ramps in the construction zone lift the ground.
  groundHeight(x, z) {
    const road = this.roadAt(x, z);
    let h;
    if (road) h = 0;
    else if (x > RIVER.x0 && x < RIVER.x1 && Math.abs(z) < RING - 20) {
      // canal walls are vertical; depth grows quickly from the edge
      h = RIVER.depth;
    } else if (Math.abs(x) > RING + 18 || Math.abs(z) > RING + 18) h = 0.3;
    else {
      const b = this.blockAt(x, z);
      if (!b) h = 0.02;
      else if (b.special === 'parking' || b.special === 'construction' || b.special === 'yard' || b.special === 'parkingDeck') {
        const inner = x > b.x0 + SIDEWALK_W && x < b.x1 - SIDEWALK_W && z > b.z0 + SIDEWALK_W && z < b.z1 - SIDEWALK_W;
        h = inner ? 0.02 : CURB_H;
      } else if (b.alley && x > b.alley.x0 && x < b.alley.x1 && z > b.alley.z0 && z < b.alley.z1) h = 0.02;
      else h = CURB_H;
    }
    // ramps
    for (const r of this.ramps) {
      const lx = (x - r.x) * r.cos + (z - r.z) * r.sin; // along ramp
      const lz = -(x - r.x) * r.sin + (z - r.z) * r.cos;
      if (Math.abs(lz) < r.w / 2 && lx > -r.len / 2 && lx < r.len / 2) {
        const t = (lx + r.len / 2) / r.len;
        h = Math.max(h, r.h * clamp(t, 0, 1));
      }
    }
    return h;
  }

  get ramps() {
    if (!this._ramps) {
      // construction zone jumps (dir: heading along +x) and one on the dock side
      this._ramps = [
        { x: 380, z: 400, len: 14, w: 6, h: 2.2, angle: 0 },
        { x: 430, z: 360, len: 12, w: 5, h: 1.6, angle: Math.PI },
        { x: 820, z: -700, len: 16, w: 7, h: 2.6, angle: Math.PI / 2 },
      ].map((r) => ({ ...r, cos: Math.cos(r.angle), sin: Math.sin(r.angle) }));
    }
    return this._ramps;
  }

  // Nearest road node (for spawns, roadblocks, GPS)
  nearestNode(x, z, filter) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // A* over the road graph; returns list of node ids
  route(fromNode, toNode) {
    const open = new Map([[fromNode.id, 0]]);
    const g = new Map([[fromNode.id, 0]]);
    const came = new Map();
    const h = (n) => Math.hypot(n.x - toNode.x, n.z - toNode.z);
    const closed = new Set();
    while (open.size) {
      let cur = null, cf = Infinity;
      for (const [id, f] of open) if (f < cf) { cf = f; cur = id; }
      if (cur === toNode.id) break;
      open.delete(cur); closed.add(cur);
      const n = this.nodes[cur];
      for (const eid of n.edges) {
        const e = this.edges[eid];
        const nb = e.a === cur ? e.b : e.a;
        if (closed.has(nb)) continue;
        const cost = g.get(cur) + e.length / (e.type.speed || 15);
        if (cost < (g.get(nb) ?? Infinity)) {
          g.set(nb, cost); came.set(nb, cur);
          open.set(nb, cost + h(this.nodes[nb]) / 30);
        }
      }
    }
    const path = [toNode.id];
    let c = toNode.id;
    while (came.has(c)) { c = came.get(c); path.unshift(c); }
    return path[0] === fromNode.id ? path : [fromNode.id, toNode.id];
  }

  edgeBetween(a, b) {
    for (const eid of this.nodes[a].edges) { const e = this.edges[eid]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e; }
    return null;
  }
}
