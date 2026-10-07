// KeralaRouter: road routing on the streamed Kerala lanes, behind the Port Halvern layout interface
// (nodes[id].x/z, nearestNode(x, z) -> node, route(fromNode, toNode) -> ids) so police and the GPS work unchanged.
// Nodes are the junctions of the loaded lane graph; route() follows the lanes (keep left) and returns the
// lane points as temporary waypoint nodes appended after the junctions, valid until the next route() call.
export class KeralaRouter {
  constructor(lanes) {
    this.lanes = lanes;
    this.version = -1;
    this.list = [];        // junction nodes, then the last route's waypoints
    this.nj = 0;           // number of junction nodes
    this.adj = [];         // id -> [{ to, lane }]
    this.grid = new Map(); // 100 m cell -> ids, for nearest()
  }

  get nodes() { this._sync(); return this.list; }

  _sync() {
    const L = this.lanes;
    if (L.version === this.version) return;
    this.version = L.version;
    const ids = new Map(), list = [], adj = [], grid = new Map();
    const id = (k) => {
      let i = ids.get(k);
      if (i === undefined) {
        const [x, z] = k.split(',').map(Number);
        i = list.length; ids.set(k, i); list.push({ id: i, x, z, type: 'kl' }); adj.push([]);
        const c = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
        if (!grid.has(c)) grid.set(c, []);
        grid.get(c).push(i);
      }
      return i;
    };
    for (const l of L.lanes) adj[id(l.from)].push({ to: id(l.to), lane: l });
    this.list = list; this.nj = list.length; this.adj = adj; this.grid = grid; this.ids = ids;
  }

  nearestNode(x, z) {
    this._sync();
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 40 && best < 0; r++) {
      // rings of cells outwards until something is found (one more ring once found would be exact; close enough)
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (const i of this.grid.get(`${cx + dx},${cz + dz}`) || []) {
          const n = this.list[i], d = (n.x - x) ** 2 + (n.z - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return this.list[best < 0 ? 0 : best] || null;
  }

  // A* over the junctions; returns waypoint ids (lane points), [] when unreachable
  route(from, to) {
    this._sync();
    if (from && typeof from === 'object') from = from.id;
    if (to && typeof to === 'object') to = to.id;
    this.list.length = this.nj;  // drop the previous route's waypoints
    const N = this.list, goal = N[to];
    if (!goal || !N[from] || from === to) return [];
    const g = new Map([[from, 0]]), prev = new Map(), heap = [[Math.hypot(N[from].x - goal.x, N[from].z - goal.z), from]];
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let found = false, steps = 0;
    while (heap.length && steps++ < 60000) {
      const [, u] = pop();
      if (u === to) { found = true; break; }
      const gu = g.get(u);
      for (const { to: v, lane } of this.adj[u]) {
        const gv = gu + lane.length;
        if (gv < (g.get(v) ?? Infinity)) { g.set(v, gv); prev.set(v, lane); push([gv + Math.hypot(N[v].x - goal.x, N[v].z - goal.z), v]); }
      }
    }
    if (!found) return [];
    const path = [];
    for (let v = to; v !== from && path.length < 5000;) { const lane = prev.get(v); path.push(lane); v = this.ids.get(lane.from); }
    path.reverse();
    const out = [];
    for (const lane of path) {
      const P = lane.pts;
      for (let i = 0; i < P.length; i++) {
        const last = out.length ? N[out[out.length - 1]] : null;
        if (last && Math.hypot(P[i][0] - last.x, P[i][1] - last.z) < 6) continue;
        out.push(N.length); N.push({ id: N.length, x: P[i][0], z: P[i][1], type: 'wp' });
      }
    }
    return out;
  }

}
