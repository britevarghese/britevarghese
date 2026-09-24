// Navigation grid + A* for server-side bots.

export class NavGrid {
  constructor(world, cell = 0.75) {
    this.world = world;
    const { PLAY_HALF, groundHeight } = world.map;
    this.half = PLAY_HALF;
    this.cell = cell;
    this.n = Math.ceil((PLAY_HALF * 2) / cell);
    this.blocked = new Uint8Array(this.n * this.n);
    const r = 0.32, q = [];
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const x = this.cx(i), z = this.cz(j);
        const g = world.supportHeight(x, z, groundHeight(x, z) + 0.2, 0.05);
        let bl = 0;
        for (const b of world.query(x - r, z - r, x + r, z + r, q)) {
          if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && b.max[1] > g + 0.45 && b.min[1] < g + 1.75) { bl = 1; break; }
        }
        // steep terrain
        if (!bl) {
          const s = Math.abs(groundHeight(x + 1, z) - groundHeight(x - 1, z)) + Math.abs(groundHeight(x, z + 1) - groundHeight(x, z - 1));
          if (s > 1.6) bl = 1;
        }
        this.blocked[j * this.n + i] = bl;
      }
    }
  }
  cx(i) { return -this.half + (i + 0.5) * this.cell; }
  cz(j) { return -this.half + (j + 0.5) * this.cell; }
  ix(x) { return Math.max(0, Math.min(this.n - 1, Math.floor((x + this.half) / this.cell))); }
  iz(z) { return Math.max(0, Math.min(this.n - 1, Math.floor((z + this.half) / this.cell))); }
  free(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && !this.blocked[j * this.n + i]; }

  nearestFree(i, j) {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.free(i + di, j + dj)) return [i + di, j + dj];
    }
    return null;
  }

  // Returns array of {x,z} waypoints (string-pulled) or null.
  findPath(sx, sz, tx, tz, maxExpand = 60000) {
    const s = this.nearestFree(this.ix(sx), this.iz(sz)), t = this.nearestFree(this.ix(tx), this.iz(tz));
    if (!s || !t) return null;
    const N = this.n, start = s[1] * N + s[0], goal = t[1] * N + t[0];
    const g = new Map([[start, 0]]), came = new Map();
    const heap = [[0, start]];
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (k) => { const dx = Math.abs((k % N) - t[0]), dz = Math.abs(((k / N) | 0) - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const closed = new Set();
    let expanded = 0, found = false;
    while (heap.length && expanded < maxExpand) {
      const [, k] = pop();
      if (k === goal) { found = true; break; }
      if (closed.has(k)) continue;
      closed.add(k); expanded++;
      const ci = k % N, cj = (k / N) | 0, gk = g.get(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const nk = nj * N + ni, ng = gk + (di && dj ? 1.414 : 1);
        if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); came.set(nk, k); push(ng + h(nk), nk); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== undefined; k = came.get(k)) { cells.push(k); if (k === start) break; }
    cells.reverse();
    // string pulling on grid
    const pts = [];
    let anchor = 0;
    pts.push(cells[0]);
    for (let i = 2; i < cells.length; i++) {
      if (!this.gridLOS(cells[anchor], cells[i])) { anchor = i - 1; pts.push(cells[anchor]); }
    }
    pts.push(cells[cells.length - 1]);
    return pts.map((k) => ({ x: this.cx(k % N), z: this.cz((k / N) | 0) }));
  }

  gridLOS(a, b) {
    const N = this.n;
    let x0 = a % N, y0 = (a / N) | 0; const x1 = b % N, y1 = (b / N) | 0;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!this.free(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
      // diagonal corner cutting guard
      if (!this.free(x0, y0)) return false;
    }
  }
}
