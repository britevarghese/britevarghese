// The satnav: the quickest way from here to a waypoint by the map's roads and trails. The trails (WorldGen's smoothed
// lines, a point every 6 m) are a graph: each point a node, joined to the next along its trail and to the points of
// other trails close by (where they meet); off the trails a truck goes straight, at a cost (it is slower across
// country). A route leaves for the trails at whichever of the points near it gets there soonest, follows them, and
// leaves them where it is quickest to strike out for the waypoint, unless going straight across is quicker anyway.
//
// Pure logic (runs in Node for the tests): the map, the minimap and the line on the ground draw what it returns.

const CELL = 24;                         // spatial hash cell (m)

export class RouteGraph {
  /**
   * trails: [{ kind: 'road' | 'trail', points: [[x, z], ...] }]. Costs are seconds-like weights per metre: a road 1,
   * a trail `trail`, across country `offroad`; trails within `join` m of each other meet.
   */
  constructor(trails, { trail = 1.3, offroad = 2.8, join = 9 } = {}) {
    this.offroad = offroad;
    const X = [], Z = [], adj = [];
    const link = (a, b, w) => { adj[a].push(b, w); adj[b].push(a, w); };
    for (const t of trails || []) {
      const k = t.kind === 'road' ? 1 : trail;
      let prev = -1;
      for (const [x, z] of t.points) {
        const i = X.length;
        X.push(x); Z.push(z); adj.push([]);
        if (prev >= 0) link(prev, i, Math.hypot(x - X[prev], z - Z[prev]) * k);
        prev = i;
      }
      // (a loop's ends are one place)
      const first = X.length - t.points.length;
      if (t.points.length > 2 && Math.hypot(X[first] - X[prev], Z[first] - Z[prev]) < 1) link(first, prev, 0.5);
    }
    this.X = Float64Array.from(X); this.Z = Float64Array.from(Z); this.adj = adj;
    this.trailOf = new Int32Array(X.length);
    let n = 0, ti = 0;
    for (const t of trails || []) { for (let k = 0; k < t.points.length; k++) this.trailOf[n++] = ti; ti++; }
    // spatial hash
    this.grid = new Map();
    for (let i = 0; i < X.length; i++) {
      const key = this.key(X[i], Z[i]);
      let c = this.grid.get(key);
      if (!c) this.grid.set(key, (c = []));
      c.push(i);
    }
    // where trails meet: each point to the nearest point of every other trail within `join`
    for (let i = 0; i < X.length; i++) {
      const best = new Map();
      this.near(X[i], Z[i], join, (j, d) => {
        if (this.trailOf[j] === this.trailOf[i]) return;
        const b = best.get(this.trailOf[j]);
        if (!b || d < b.d) best.set(this.trailOf[j], { j, d });
      });
      for (const { j, d } of best.values()) if (j > i) link(i, j, Math.max(0.5, d));
    }
  }

  key(x, z) { return `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; }

  /** Calls fn(i, d) for each node within r of (x, z). */
  near(x, z, r, fn) {
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), k0 = Math.floor((z - r) / CELL), k1 = Math.floor((z + r) / CELL);
    for (let c = c0; c <= c1; c++) for (let k = k0; k <= k1; k++) {
      const cell = this.grid.get(`${c},${k}`);
      if (!cell) continue;
      for (const i of cell) { const d = Math.hypot(this.X[i] - x, this.Z[i] - z); if (d <= r) fn(i, d); }
    }
  }

  /** The nodes to join the trails at from (x, z): the closest few, searching further out until some turn up. */
  entries(x, z, n = 8) {
    const out = [];
    for (let r = 60; r <= 1600 && out.length < n; r *= 2) {
      out.length = 0;
      this.near(x, z, r, (i, d) => out.push({ i, d }));
    }
    out.sort((a, b) => a.d - b.d);
    // (the closest, and then points well apart, so a trail that runs by isn't all the choices)
    const pick = [];
    for (const e of out) {
      if (pick.length >= n) break;
      if (pick.some((p) => Math.hypot(this.X[p.i] - this.X[e.i], this.Z[p.i] - this.Z[e.i]) < 25)) continue;
      pick.push(e);
    }
    return pick;
  }

  /**
   * The quickest way from (x0, z0) to (x1, z1): { points: [[x, z], ...] from start to end, length (m), cost, onTrail
   * (m of it on roads and trails) }.
   */
  route(x0, z0, x1, z1) {
    const direct = Math.hypot(x1 - x0, z1 - z0);
    const straight = { points: [[x0, z0], [x1, z1]], length: direct, cost: direct * this.offroad, onTrail: 0 };
    const N = this.X.length;
    if (!N || direct < 40) return straight;
    const dist = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
    // (A*: the straight line to the waypoint at road cost never overestimates what is left)
    const h = (i) => Math.hypot(this.X[i] - x1, this.Z[i] - z1);
    const heapA = new Heap();
    for (const e of this.entries(x0, z0)) {
      const c = e.d * this.offroad;
      if (c < dist[e.i]) { dist[e.i] = c; from[e.i] = -2; heapA.push(e.i, c + h(e.i)); }
    }
    const exits = new Map();
    for (const e of this.entries(x1, z1)) exits.set(e.i, e.d * this.offroad);
    let best = straight.cost, bestExit = -1;
    while (heapA.size) {
      const { i, c: f } = heapA.pop();
      if (f >= best) break;
      const di = dist[i];
      if (f > di + h(i) + 1e-6) continue;          // (stale)
      const ex = exits.get(i);
      if (ex !== undefined && di + ex < best) { best = di + ex; bestExit = i; }
      const a = this.adj[i];
      for (let k = 0; k < a.length; k += 2) {
        const j = a[k], nd = di + a[k + 1];
        if (nd < dist[j]) { dist[j] = nd; from[j] = i; heapA.push(j, nd + h(j)); }
      }
    }
    if (bestExit < 0) return straight;
    const chain = [];
    for (let i = bestExit; i >= 0; i = from[i]) chain.push(i);
    chain.reverse();
    const points = [[x0, z0], ...chain.map((i) => [this.X[i], this.Z[i]]), [x1, z1]];
    let length = 0, onTrail = 0;
    for (let k = 1; k < points.length; k++) {
      const l = Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
      length += l;
      if (k > 1 && k < points.length - 1) onTrail += l;
    }
    return { points, length, cost: best, onTrail };
  }
}

/**
 * Where (x, z) is along a route: { seg (index of the segment's start point), t (0..1 along it), off (m from the
 * line), done (m of route behind), left (m ahead) }.
 */
export function along(points, x, z, hint = 0) {
  let best = { seg: 0, t: 0, off: Infinity, done: 0, left: 0 };
  const cum = [0];
  for (let k = 1; k < points.length; k++) cum.push(cum[k - 1] + Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]));
  // (search from a little behind where we were last time, so a route that doubles back is followed the right way)
  for (let k = Math.max(0, hint - 6); k < points.length - 1; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const off = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (off < best.off - 0.01) best = { seg: k, t, off, done: cum[k] + Math.sqrt(l2) * t, left: 0 };
  }
  best.left = Math.max(0, cum[cum.length - 1] - best.done);
  return best;
}

/** A min-heap of (index, cost). */
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(i, c) {
    const a = this.items;
    a.push({ i, c });
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].c <= a[k].c) break;
      [a[p], a[k]] = [a[k], a[p]]; k = p;
    }
  }
  pop() {
    const a = this.items, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && a[l].c < a[m].c) m = l;
        if (r < a.length && a[r].c < a[m].c) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]]; k = m;
      }
    }
    return top;
  }
}
