// KeralaHighways: long-distance GPS routing across the whole state on its main road network (national and state
// highways, main roads: index.json `majors`, always loaded), for destinations beyond the streamed tiles. Points
// shared by two roads are junctions; dead ends left by the simplified data are joined to the nearest other road
// within 60 m. A* with highways slightly preferred. Game coordinates: x = -east, z = north.
export class KeralaHighways {
  constructor(majors) { this.majors = majors; this.built = false; }

  _build() {
    if (this.built) return;
    this.built = true;
    const key = new Map(), X = [], Z = [], adj = [];
    const node = (e, n) => {
      const k = Math.round(e) * 1e6 + Math.round(n);
      let i = key.get(k);
      if (i === undefined) { i = X.length; key.set(k, i); X.push(-e); Z.push(n); adj.push([]); }
      return i;
    };
    for (const m of this.majors) {
      const w = 1 + (m[0] || 0) * 0.12;    // highways (class 0-1) slightly preferred
      let prev = -1;
      for (let k = 2; k + 1 < m.length; k += 2) {
        const i = node(m[k], m[k + 1]);
        if (prev >= 0 && prev !== i) { const d = Math.hypot(X[i] - X[prev], Z[i] - Z[prev]) * w; adj[prev].push(i, d); adj[i].push(prev, d); }
        prev = i;
      }
    }
    this.X = X; this.Z = Z; this.adj = adj;
    // spatial grid (500 m) for nearest-node lookups
    const G = this.G = 500, grid = this.grid = new Map();
    for (let i = 0; i < X.length; i++) { const k = Math.floor(X[i] / G) * 100003 + Math.floor(Z[i] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    // join dead ends to the nearest node of another road within 60 m
    for (let i = 0; i < X.length; i++) {
      if (adj[i].length !== 2) continue;
      let best = -1, bd = 60;
      for (const j of this._near(X[i], Z[i], 60)) {
        if (j === i || adj[i].includes(j)) continue;
        const d = Math.hypot(X[j] - X[i], Z[j] - Z[i]);
        if (d < bd && d > 0.5) { bd = d; best = j; }
      }
      if (best >= 0) { adj[i].push(best, bd * 1.2); adj[best].push(i, bd * 1.2); }
    }
  }

  _near(x, z, r) {
    const G = this.G, out = [];
    for (let a = Math.floor((x - r) / G); a <= Math.floor((x + r) / G); a++) for (let b = Math.floor((z - r) / G); b <= Math.floor((z + r) / G); b++) for (const i of this.grid.get(a * 100003 + b) || []) out.push(i);
    return out;
  }

  nearest(x, z) {
    this._build();
    for (let r = 500; r <= 16000; r *= 2) {
      let best = -1, bd = Infinity;
      for (const i of this._near(x, z, r)) { const d = (this.X[i] - x) ** 2 + (this.Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      if (best >= 0) return best;
    }
    return -1;
  }

  // [[x, z], ...] along main roads from node a to node b ([] when unreachable)
  route(a, b) {
    this._build();
    if (a < 0 || b < 0) return [];
    if (a === b) return [[this.X[a], this.Z[a]]];
    const X = this.X, Z = this.Z, adj = this.adj, h = (i) => Math.hypot(X[i] - X[b], Z[i] - Z[b]);
    const g = new Map([[a, 0]]), prev = new Map(), heap = [[h(a), a]], done = new Set();
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let found = false, steps = 0;
    while (heap.length && steps++ < 400000) {
      const [, u] = pop();
      if (done.has(u)) continue;
      done.add(u);
      if (u === b) { found = true; break; }
      const gu = g.get(u), A = adj[u];
      for (let k = 0; k < A.length; k += 2) {
        const v = A[k], gv = gu + A[k + 1];
        if (gv < (g.get(v) ?? Infinity)) { g.set(v, gv); prev.set(v, u); push([gv + h(v), v]); }
      }
    }
    if (!found) return [];
    const out = [];
    for (let v = b; v !== undefined; v = prev.get(v)) out.push([X[v], Z[v]]);
    return out.reverse();
  }
}
