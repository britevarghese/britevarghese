// LaneGraph: builds drivable lane paths from the road graph. Each road edge gets lanes per
// direction (offset to the right of travel, trimmed at intersections), and each intersection gets
// connector curves between incoming and outgoing lanes (straight / left / right).
import { lineHalfWidth, ROAD_TYPES } from '../world/CityLayout.js';

export class Path {
  constructor(points, meta) {
    this.pts = points;           // [[x,z],...]
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    this.length = this.cum[this.cum.length - 1];
    Object.assign(this, meta);
    this.next = [];              // connector or lane paths that continue this one
    this.cars = [];              // occupancy (traffic vehicles currently on it)
  }
  sample(s, out) {
    const pts = this.pts, cum = this.cum;
    if (s <= 0) { const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1], l = Math.hypot(dx, dz) || 1; out.x = pts[0][0]; out.z = pts[0][1]; out.dx = dx / l; out.dz = dz / l; return out; }
    let i = 1;
    // binary search
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
    i = lo;
    const a = pts[i - 1], b = pts[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, (s - cum[i - 1]) / seg);
    out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t;
    out.dx = (b[0] - a[0]) / seg; out.dz = (b[1] - a[1]) / seg;
    return out;
  }
}

function offsetPolyline(pts, off) {
  // offset to the RIGHT of travel direction: right = (-dz, dx) in our frame
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    out.push([pts[i][0] + (-dz / l) * off, pts[i][1] + (dx / l) * off]);
  }
  return out;
}
function trim(pts, start, end) {
  // cut `start` meters from the beginning and `end` from the end
  const cut = (p, d) => {
    const out = [...p];
    let rem = d;
    while (out.length > 1) {
      const dx = out[1][0] - out[0][0], dz = out[1][1] - out[0][1], l = Math.hypot(dx, dz);
      if (l > rem) { out[0] = [out[0][0] + dx / l * rem, out[0][1] + dz / l * rem]; break; }
      rem -= l; out.shift();
    }
    return out;
  };
  return cut(cut(pts, start).reverse(), end).reverse();
}
function bezier(a, c, b, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

export class LaneGraph {
  constructor(layout) {
    this.layout = layout;
    this.lanes = [];        // edge lanes
    this.connectors = [];
    this.byNodeIn = new Map();  // nodeId -> incoming lanes
    this.byNodeOut = new Map(); // nodeId -> outgoing lanes
    this._build();
  }

  nodeRadius(node, edge) {
    // how far lanes stop from the node center (half width of the crossing road + margin)
    if (node.type === 'ring') return edge.type === ROAD_TYPES.highway ? 22 : 17;
    if (node.type === 'grid') {
      const cross = edge.axis === 'z' ? lineHalfWidth(node.l) : lineHalfWidth(node.k);
      return cross + (node.signal ? 5 : 2.5);
    }
    return 6;
  }

  _build() {
    const L = this.layout;
    for (const e of L.edges) {
      const T = e.type;
      const A = L.nodes[e.a], B = L.nodes[e.b];
      for (const dir of [1, -1]) {
        const from = dir > 0 ? A : B, to = dir > 0 ? B : A;
        const pts = dir > 0 ? e.points : [...e.points].reverse();
        for (let i = 0; i < T.lanes; i++) {
          const off = T.median / 2 + T.laneWidth * (i + 0.5);
          let lane = offsetPolyline(pts, off);
          lane = trim(lane, this.nodeRadius(from, e), this.nodeRadius(to, e));
          if (lane.length < 2) continue;
          const path = new Path(lane, { kind: 'lane', edge: e, dir, laneIndex: i, lanes: T.lanes, from: from.id, to: to.id, speed: T.speed, axis: e.axis, ring: !!e.ring, signal: to.signal });
          path.id = this.lanes.length;
          this.lanes.push(path);
          if (!this.byNodeIn.has(to.id)) this.byNodeIn.set(to.id, []);
          this.byNodeIn.get(to.id).push(path);
          if (!this.byNodeOut.has(from.id)) this.byNodeOut.set(from.id, []);
          this.byNodeOut.get(from.id).push(path);
        }
      }
    }
    // siblings (parallel lanes on the same edge & direction) for lane changes
    const key = (p) => `${p.edge.id}:${p.dir}`;
    const groups = new Map();
    for (const p of this.lanes) { if (!groups.has(key(p))) groups.set(key(p), []); groups.get(key(p)).push(p); }
    for (const g of groups.values()) for (const p of g) p.siblings = g.filter((q) => q !== p);
    // connectors
    for (const [nodeId, ins] of this.byNodeIn) {
      const outs = this.byNodeOut.get(nodeId) || [];
      for (const lin of ins) {
        const end = lin.pts[lin.pts.length - 1];
        const endPrev = lin.pts[lin.pts.length - 2];
        const d0 = norm(end[0] - endPrev[0], end[1] - endPrev[1]);
        for (const lout of outs) {
          if (lout.edge === lin.edge) continue; // no U-turns
          const st = lout.pts[0], st2 = lout.pts[1];
          const d1 = norm(st2[0] - st[0], st2[1] - st[1]);
          const cross = d0[0] * d1[1] - d0[1] * d1[0];
          const dot = d0[0] * d1[0] + d0[1] * d1[1];
          const turn = dot > 0.7 ? 'straight' : cross > 0 ? 'right' : 'left';
          // lane discipline on multi-lane roads: right turns from curb lane, left from median lane
          if (lin.lanes > 1 && turn === 'right' && lin.laneIndex !== lin.lanes - 1) continue;
          if (lin.lanes > 1 && turn === 'left' && lin.laneIndex !== 0) continue;
          if (turn === 'straight' && lout.laneIndex !== Math.min(lin.laneIndex, lout.lanes - 1)) continue;
          if (turn !== 'straight' && lout.laneIndex !== (turn === 'right' ? lout.lanes - 1 : 0)) continue;
          // control point: intersection of the two tangent lines (fallback midpoint)
          let c = intersect(end, d0, st, d1) || [(end[0] + st[0]) / 2, (end[1] + st[1]) / 2];
          if (Math.hypot(c[0] - end[0], c[1] - end[1]) > 60) c = [(end[0] + st[0]) / 2, (end[1] + st[1]) / 2];
          const pts = turn === 'straight' ? [end, st] : bezier(end, c, st, 10);
          const con = new Path(pts, { kind: 'connector', node: nodeId, turn, from: lin, to: lout, speed: turn === 'straight' ? lin.speed : 8, axis: lin.axis });
          con.next = [lout];
          lin.next.push(con);
          this.connectors.push(con);
        }
      }
    }
    // dead ends: allow U-turn if no other way
    for (const lin of this.lanes) {
      if (lin.next.length) continue;
      const outs = (this.byNodeOut.get(lin.to) || []).filter((l) => l.edge === lin.edge);
      if (!outs.length) continue;
      const lout = outs[0];
      const end = lin.pts[lin.pts.length - 1], st = lout.pts[0];
      const node = this.layout.nodes[lin.to];
      const con = new Path(bezier(end, [node.x, node.z], st, 10), { kind: 'connector', node: lin.to, turn: 'uturn', from: lin, to: lout, speed: 6, axis: lin.axis });
      con.next = [lout];
      lin.next.push(con);
      this.connectors.push(con);
    }
  }

  // random lane near a position (for spawning)
  lanesNear(x, z, rMin, rMax) {
    const out = [];
    for (const l of this.lanes) {
      const m = l.pts[Math.floor(l.pts.length / 2)];
      const d = Math.hypot(m[0] - x, m[1] - z);
      if (d > rMin - l.length / 2 && d < rMax + l.length / 2) out.push(l);
    }
    return out;
  }

  // nearest lane position to a point: {lane, s, x, z, dx, dz, dist}
  nearest(x, z, filter) {
    let best = null;
    const tmp = {};
    for (const l of this.lanes) {
      if (filter && !filter(l)) continue;
      const a = l.pts[0], b = l.pts[l.pts.length - 1];
      // quick reject by bbox
      const minx = Math.min(a[0], b[0]) - 40, maxx = Math.max(a[0], b[0]) + 40, minz = Math.min(a[1], b[1]) - 40, maxz = Math.max(a[1], b[1]) + 40;
      if (l.pts.length === 2 && (x < minx || x > maxx || z < minz || z > maxz)) continue;
      for (let i = 1; i < l.pts.length; i++) {
        const p0 = l.pts[i - 1], p1 = l.pts[i];
        const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
        const len2 = dx * dx + dz * dz || 1;
        let t = ((x - p0[0]) * dx + (z - p0[1]) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = p0[0] + dx * t, pz = p0[1] + dz * t;
        const d = Math.hypot(px - x, pz - z);
        if (!best || d < best.dist) {
          const s = l.cum[i - 1] + Math.sqrt(len2) * t;
          l.sample(s, tmp);
          best = { lane: l, s, x: px, z: pz, dx: tmp.dx, dz: tmp.dz, dist: d };
        }
      }
    }
    return best;
  }
}

function norm(x, z) { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }
function intersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}
