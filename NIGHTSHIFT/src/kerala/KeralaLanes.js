// KeralaLaneGraph: traffic lanes on Kerala's real roads (the streamed OpenStreetMap tiles), with the same
// interface as LaneGraph so TrafficManager drives on them unchanged. India keeps LEFT: each direction's lanes
// sit to the left of the centre line. Lanes join where roads meet (OSM way ends, and tile seams, which share
// exact coordinates); a road that just ends gets a U-turn. Lanes come and go with their tiles.
import { Path } from '../traffic/LaneGraph.js';
import { TILE, ROAD_HALF } from './KeralaTile.js';

const LANE_W = 3.2;
const C_BUILDING = 31; // class raster code (KeralaTile C.building)
// speed (m/s) by road class: Kerala's roads are slow and busy
const SPEED = [22, 16.7, 13.9, 12.5, 11.1, 9.7, 8.3, 6.9, 5.6, 4.2, 4.2];
const DRIVEN = 7;  // classes 0..7 get traffic (no service roads, tracks or pedestrian streets)

// junction key; points on a tile seam (where both tiles cut the road) match within a metre or so
const seam = (v) => { const m = ((v % TILE) + TILE) % TILE; return m < 1.5 || m > TILE - 1.5 ? Math.round(v / TILE) * TILE : null; };
const nodeKey = (x, z) => {
  const sx = seam(x), sz = seam(z);
  if (sx !== null) return `${sx},${Math.round(z / 2) * 2}`;
  if (sz !== null) return `${Math.round(x / 2) * 2},${sz}`;
  return `${Math.round(x)},${Math.round(z)}`;
};
// the tile's driven roads were simplified when built, which drops the vertex where a side road meets a
// through road: snap each dead end onto the road it touches and give that road a vertex there
function joinDeadEnds(driven) {
  const C = 25, grid = new Map(), SN = 7;
  driven.forEach(({ P }, ri) => {
    for (let i = 0; i < P.length - 1; i++) {
      const [a, b] = [P[i], P[i + 1]];
      for (let cx = Math.floor((Math.min(a[0], b[0]) - SN) / C); cx <= Math.floor((Math.max(a[0], b[0]) + SN) / C); cx++)
        for (let cz = Math.floor((Math.min(a[1], b[1]) - SN) / C); cz <= Math.floor((Math.max(a[1], b[1]) + SN) / C); cz++) {
          const k = cx * 100003 + cz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(ri, i);
        }
    }
  });
  const count = new Map();
  for (const { P } of driven) for (const q of [P[0], P[P.length - 1]]) { const k = nodeKey(...q); count.set(k, (count.get(k) || 0) + 1); }
  const inner = new Set(); for (const { P } of driven) for (let i = 1; i < P.length - 1; i++) inner.add(nodeKey(...P[i]));
  const ins = driven.map(() => []);
  driven.forEach(({ P }, ri) => {
    for (const end of [0, P.length - 1]) {
      const q = P[end], k = nodeKey(...q);
      if (count.get(k) > 1 || inner.has(k) || seam(q[0]) !== null || seam(q[1]) !== null) continue;
      const L = grid.get(Math.floor(q[0] / C) * 100003 + Math.floor(q[1] / C)) || [];
      let best = null, bd = SN;
      for (let j = 0; j < L.length; j += 2) {
        const rj = L[j], i = L[j + 1]; if (rj === ri) continue;
        const R = driven[rj].P, a = R[i], b = R[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / l2));
        const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(px - q[0], pz - q[1]);
        if (d < bd) { bd = d; best = { rj, i, t, p: [px, pz] }; }
      }
      if (!best) continue;
      const R = driven[best.rj].P;
      // land on an existing vertex when close to one, else add a vertex to the through road
      if (best.t * Math.hypot(R[best.i + 1][0] - R[best.i][0], R[best.i + 1][1] - R[best.i][1]) < 1.5) best.p = R[best.i];
      else if ((1 - best.t) * Math.hypot(R[best.i + 1][0] - R[best.i][0], R[best.i + 1][1] - R[best.i][1]) < 1.5) best.p = R[best.i + 1];
      else ins[best.rj].push(best);
      P[end] = [...best.p];
    }
  });
  driven.forEach((d, ri) => {
    if (!ins[ri].length) return;
    ins[ri].sort((a, b) => a.i - b.i || a.t - b.t);
    const out = []; let k = 0;
    for (let i = 0; i < d.P.length; i++) { out.push(d.P[i]); while (k < ins[ri].length && ins[ri][k].i === i) out.push(ins[ri][k++].p); }
    d.P = out;
  });
}
function leftOffset(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    out.push([pts[i][0] + dz / l * off, pts[i][1] - dx / l * off]); // left of travel = (dz, -dx)
  }
  return out;
}
function bezier(a, c, b, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
  return out;
}
function intersect(p, d, q, e) {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}
const norm = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
function trimStart(pts, d) {
  const out = pts.map((p) => [...p]);
  let rem = d;
  while (out.length > 2) {
    const L = Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1]);
    if (L > rem + 0.5) { out[0] = [out[0][0] + (out[1][0] - out[0][0]) / L * rem, out[0][1] + (out[1][1] - out[0][1]) / L * rem]; return out; }
    rem -= L; out.shift();
  }
  return out;
}
const trim = (pts, a, b) => trimStart(trimStart(pts, a).reverse(), b).reverse();

let EDGE_ID = 1;

export class KeralaLaneGraph {
  constructor() {
    this.lanes = [];
    this.connectors = [];
    this.byTile = new Map();      // tile key -> lanes
    this.ins = new Map();         // node -> lanes ending there
    this.outs = new Map();        // node -> lanes starting there
    this.version = 0;
    this.signals = new Map();     // node -> { x, z, off, heads: [{ x, z, yaw, axis }] }
  }

  // Traffic signals where three or more roads meet and at least two of them are main roads: every lane coming in
  // stops on its phase (two phases, by the approach's direction), a signal head on the kerb (left) facing it
  _signalize(nodes) {
    for (const node of nodes) {
      const ins = this.ins.get(node) || [], outs = this.outs.get(node) || [];
      const edges = new Map();
      for (const l of [...ins, ...outs]) edges.set(l.edge.id, l.edge);
      const E = [...edges.values()], big = E.filter((e) => e.cls <= 2).length, main = E.filter((e) => e.cls <= 3).length;
      if (!ins.length || edges.size < 3 || !(big >= 2 || (edges.size >= 4 && main >= 3))) continue;
      let th0 = null, sx = 0, sz = 0;
      const heads = [];
      for (const l of ins) {
        const P = l.pts, a = P[P.length - 2], b = P[P.length - 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
        const th = Math.atan2(dx, dz);
        if (th0 === null) th0 = th;
        l.signal = true; l.axis = Math.abs(Math.sin(th - th0)) < 0.7 ? 'x' : 'z';
        // the stop line: just short of the widest crossing road's carriageway (the lane itself ends 2.5 m from the node)
        l.stopBack = Math.max(1, Math.max(4, ...E.filter((e) => e !== l.edge).map((e) => e.hw || 4)) + 2 - 2.5);
        sx += b[0]; sz += b[1];
        // one head per approach: on the footpath at the left kerb (we keep left), at the stop line, which is just
        // short of the crossing road's carriageway (never out in the junction or in a lane)
        if (l.laneIndex === 0) {
          const ux = dx / L, uz = dz / L, lx = dz / L, lz = -dx / L, per = l.edge.type.lanes;
          const off0 = l.edge.one ? -(per - 1) / 2 * LANE_W : (per - 0.5) * LANE_W;
          const nx = b[0] + ux * 2.5 - lx * off0, nz = b[1] + uz * 2.5 - lz * off0;   // the junction, on this road's centre line
          const cross = Math.max(4, ...E.filter((e) => e !== l.edge).map((e) => e.hw || 4)), side = (l.edge.hw || 4) + 0.9;
          // (the first spot off every carriageway: a twin carriageway, a slip road or a lane may run right beside)
          let hx = null, hz = null;
          for (const back of [cross + 2, cross + 4, cross + 7]) for (const sd of [side, side + 0.8, side + 1.8, side + 3]) {
            if (hx !== null) break;
            const x = nx - ux * back + lx * sd, z = nz - uz * back + lz * sd;
            if (!this.onAnyRoad?.(x, z)) { hx = x; hz = z; }
          }
          if (hx !== null) heads.push({ x: hx, z: hz, yaw: Math.atan2(-dx, -dz), axis: l.axis });
        }
      }
      const h = [...node].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7), X = sx / ins.length, Z = sz / ins.length;
      // (one junction's signals: a node 80 m from another signalled one is the same crossroads, or too close)
      if ([...this.signals].some(([k, S]) => k !== node && Math.abs(S.x - X) < 80 && Math.abs(S.z - Z) < 80)) { for (const l of ins) l.signal = false; continue; }
      this.signals.set(node, { x: X, z: Z, off: h % 44, heads });
    }
  }

  addTile(t) {
    const k = `${t.tx},${t.tz}`;
    if (this.byTile.has(k)) return;
    const mine = [], touched = new Set();
    // OSM ways often run straight through junctions: split every road where it shares a point with another
    const driven = t.roads.filter((r) => r.cls <= DRIVEN && r.pts.length >= 2 && !(r.flags & 4)).map((r) => ({ r, P: r.pts.map(([e, n]) => [-(t.E0 + e), t.N0 + n]) }));
    joinDeadEnds(driven);
    const uses = new Map();
    for (const { P } of driven) for (const k of new Set(P.map((q) => nodeKey(...q)))) uses.set(k, (uses.get(k) || 0) + 1);
    const pieces = [];
    for (const { r, P } of driven) {
      let a = 0;
      for (let i = 1; i < P.length; i++) if (i === P.length - 1 || uses.get(nodeKey(...P[i])) > 1) { pieces.push({ r, P: P.slice(a, i + 1) }); a = i; }
    }
    for (const { r, P } of pieces) {
      let len = 0; for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (len < 4) continue;
      const one = !!(r.flags & 1);
      const total = r.lanes || (r.cls <= 1 ? (one ? 2 : 4) : one ? 1 : 2);
      const per = one ? Math.max(1, Math.min(3, total)) : Math.max(1, Math.min(3, Math.floor(total / 2)));
      const edge = { id: EDGE_ID++, type: { lanes: per }, cls: r.cls, name: r.name, one, hw: r.cls <= 2 && r.lanes ? Math.max(ROAD_HALF[r.cls], r.lanes * 1.75) : ROAD_HALF[r.cls] };
      const a = nodeKey(...P[0]), b = nodeKey(...P[P.length - 1]);
      for (const dir of one ? [1] : [1, -1]) {
        const C = dir > 0 ? P : [...P].reverse();
        const from = dir > 0 ? a : b, to = dir > 0 ? b : a;
        for (let li = 0; li < per; li++) {
          // keep left: lane 0 is the outer (kerb) lane, further lanes towards the centre
          const off = one ? (li - (per - 1) / 2) * LANE_W : (per - li - 0.5) * LANE_W;
          let pts = leftOffset(C, off);
          pts = trim(pts, 2.5, 2.5);
          if (pts.length < 2) continue;
          const lane = new Path(pts, { kind: 'lane', edge, dir, speed: SPEED[r.cls], laneIndex: li, lanes: per, from, to, signal: false, axis: 'x', tile: k, siblings: [] });
          lane.next = [];
          mine.push(lane);
          if (!this.outs.has(from)) this.outs.set(from, []);
          this.outs.get(from).push(lane);
          if (!this.ins.has(to)) this.ins.set(to, []);
          this.ins.get(to).push(lane);
          touched.add(from); touched.add(to);
        }
      }
    }
    // bus stops: on the kerb lane of town roads, about one in five road pieces (both directions, as in Kerala)
    t.busStops = [];
    const tmpS = {};
    for (const l of mine) {
      if (l.laneIndex !== 0 || l.edge.cls > 4 || l.edge.cls < 1 || l.length < 70) continue;
      l.sample(l.length * 0.55, tmpS);
      const h = Math.abs(Math.round(tmpS.x * 0.37) * 73856093 ^ Math.round(tmpS.z * 0.37) * 19349663) % 100;
      if (h > 22) continue;
      const cl = t.classAt?.(-tmpS.x - t.E0, tmpS.z - t.N0);
      if (cl === 1 || cl === 3 || cl >= 20) continue; // not out in the paddy, the forest or on water
      const s0 = l.length * 0.55;
      l.stops = [s0];
      // the shelter: on the kerb side (left of travel), facing the road
      const ox = tmpS.dz, oz = -tmpS.dx;  // left of travel
      t.busStops.push({ x: tmpS.x + ox * 3.4, z: tmpS.z + oz * 3.4, yaw: Math.atan2(-ox, -oz), lane: l, s: s0 });
    }
    // tea stalls (chaya kada) by town and village roads, set back on the verge
    t.teaShops = [];
    for (const l of mine) {
      if (l.laneIndex !== 0 || l.edge.cls < 2 || l.edge.cls > 7 || l.length < 50 || l.stops) continue;
      l.sample(l.length * 0.4, tmpS);
      const h = Math.abs(Math.round(tmpS.x * 0.53) * 83492791 ^ Math.round(tmpS.z * 0.53) * 2971215073) % 100;
      if (h > 16) continue;
      const ox = tmpS.dz, oz = -tmpS.dx, x = tmpS.x + ox * 5.2, z = tmpS.z + oz * 5.2;
      const e = -x - t.E0, n = z - t.N0, cl = t.classAt?.(e, n);
      if (cl === C_BUILDING || cl === 1 || cl === 3 || cl >= 20) continue;
      if (t.nearRoad?.(e, n, 3.6)) continue;
      t.teaShops.push({ x, z, yaw: Math.atan2(-ox, -oz) });
    }
    this._signalize(touched);
    // siblings (same road, same direction) for lane changes
    const groups = new Map();
    for (const l of mine) { const g = `${l.edge.id}:${l.dir}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(l); }
    for (const g of groups.values()) for (const l of g) l.siblings = g.filter((q) => q !== l);
    this.byTile.set(k, mine);
    for (const l of mine) this.lanes.push(l);
    for (const n of touched) this._relink(n);
    this.version++;
  }

  removeTile(t) {
    const k = `${t.tx},${t.tz}`, mine = this.byTile.get(k);
    if (!mine) return;
    const dead = new Set(mine), touched = new Set();
    for (const l of mine) {
      l.dead = true;
      const o = this.outs.get(l.from); if (o) this.outs.set(l.from, o.filter((x) => !dead.has(x)));
      const i = this.ins.get(l.to); if (i) this.ins.set(l.to, i.filter((x) => !dead.has(x)));
      touched.add(l.from); touched.add(l.to);
    }
    this.lanes = this.lanes.filter((l) => !dead.has(l));
    this.byTile.delete(k);
    for (const n of touched) { this._relink(n); if (!this.ins.get(n)?.length) this.ins.delete(n); if (!this.outs.get(n)?.length) this.outs.delete(n); }
    this.version++;
  }

  // rebuild the connectors at a junction
  _relink(node) {
    const ins = this.ins.get(node) || [], outs = this.outs.get(node) || [];
    for (const lin of ins) {
      for (const c of lin.next) c.dead = true;
      lin.next = [];
      const end = lin.pts[lin.pts.length - 1], prev = lin.pts[lin.pts.length - 2];
      const d0 = norm(end[0] - prev[0], end[1] - prev[1]);
      const cands = [];
      for (const lout of outs) {
        if (lout.edge === lin.edge) continue;
        const st = lout.pts[0], st2 = lout.pts[1];
        const d1 = norm(st2[0] - st[0], st2[1] - st[1]);
        const cross = d0[0] * d1[1] - d0[1] * d1[0], dot = d0[0] * d1[0] + d0[1] * d1[1];
        const turn = dot > 0.7 ? 'straight' : cross > 0 ? 'right' : 'left';
        // lane discipline (keep left): left turns from the kerb lane, right turns from the centre lane
        if (lin.lanes > 1 && turn === 'left' && lin.laneIndex !== 0) continue;
        if (lin.lanes > 1 && turn === 'right' && lin.laneIndex !== lin.lanes - 1) continue;
        if (turn === 'straight' && lout.laneIndex !== Math.min(lin.laneIndex, lout.lanes - 1)) continue;
        if (turn !== 'straight' && lout.laneIndex !== (turn === 'left' ? 0 : lout.lanes - 1)) continue;
        cands.push({ lout, turn, d1, st });
      }
      // a road that just ends: turn round
      if (!cands.length) { const back = outs.find((l) => l.edge === lin.edge); if (back) cands.push({ lout: back, turn: 'uturn', d1: null, st: back.pts[0] }); }
      for (const { lout, turn, d1, st } of cands) {
        let pts;
        if (turn === 'straight' && Math.hypot(st[0] - end[0], st[1] - end[1]) < 8) pts = [end, st];
        else {
          let c = d1 ? intersect(end, d0, st, d1) : null;
          if (!c || Math.hypot(c[0] - end[0], c[1] - end[1]) > 40) c = [(end[0] + st[0]) / 2 + d0[0] * 3, (end[1] + st[1]) / 2 + d0[1] * 3];
          pts = bezier(end, c, st, 8);
        }
        const con = new Path(pts, { kind: 'connector', node, turn, from: lin, to: lout, speed: turn === 'straight' ? lin.speed : turn === 'uturn' ? 4 : 7, axis: 'x' });
        con.next = [lout];
        lin.next.push(con);
      }
    }
  }

  // lanes with a point between rMin and rMax of (x, z), for spawning
  lanesNear(x, z, rMin, rMax) {
    const out = [], tx = Math.floor(-x / TILE), tz = Math.floor(z / TILE), R = Math.ceil(rMax / TILE) + 1;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const L = this.byTile.get(`${tx + dx},${tz + dz}`);
      if (!L) continue;
      for (const l of L) {
        const m = l.pts[Math.floor(l.pts.length / 2)], d = Math.hypot(m[0] - x, m[1] - z);
        if (d > rMin - l.length / 2 && d < rMax + l.length / 2) out.push(l);
      }
    }
    return out;
  }

  nearest(x, z, filter) {
    let best = null;
    const tmp = {};
    for (const l of this.lanesNear(x, z, 0, 300)) {
      if (filter && !filter(l)) continue;
      for (let i = 1; i < l.pts.length; i++) {
        const p0 = l.pts[i - 1], p1 = l.pts[i], dx = p1[0] - p0[0], dz = p1[1] - p0[1], len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - p0[0]) * dx + (z - p0[1]) * dz) / len2));
        const px = p0[0] + dx * t, pz = p0[1] + dz * t, d = Math.hypot(px - x, pz - z);
        if (!best || d < best.dist) { const s = l.cum[i - 1] + Math.sqrt(len2) * t; l.sample(s, tmp); best = { lane: l, s, x: px, z: pz, dx: tmp.dx, dz: tmp.dz, dist: d }; }
      }
    }
    return best;
  }
}
