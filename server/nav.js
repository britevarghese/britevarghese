// Navigation grid + A* for server-side bots.

// Working memory for findPath, shared by every grid (searches never overlap) and sized to the largest grid searched
// so far: per cell its cost so far, the cell it was reached from, and a mark saying whether those are from the
// current search (open / closed) — so nothing needs clearing between searches.
const S = { cells: 0, g: null, came: null, mark: null, id: 0, hf: new Float64Array(4096), hk: new Int32Array(4096) };
function scratch(cells) {
  if (S.cells < cells) { S.cells = cells; S.g = new Float64Array(cells); S.came = new Int32Array(cells); S.mark = new Uint32Array(cells); S.id = 0; }
  if (++S.id > 0x7ffffff0) { S.mark.fill(0); S.id = 1; }
  return S;
}

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
    // doorways: a 1.2-1.3 m door (outer or in a partition) can fall between two cell centres, each then within the
    // 0.32 m clearance of a jamb, and a room becomes a sealed box for the bots. Under every lintel (a wall piece
    // starting 1.9-2.7 m above the floor) open the cells on its centre line that nothing stands right on: a soldier
    // squeezes past a jamb, the collision slides him through.
    const clear = (x, z, g, rr) => !world.query(x - rr, z - rr, x + rr, z + rr, q).some((bx) => x + rr > bx.min[0] && x - rr < bx.max[0] && z + rr > bx.min[2] && z - rr < bx.max[2] && bx.max[1] > g + 0.45 && bx.min[1] < g + 1.75);
    for (const L of world.boxes) {
      const sx = L.max[0] - L.min[0], sz = L.max[2] - L.min[2], along = sx > sz;
      if (L.tag === 'prop' || L.tag === 'tree' || L.tag === 'rock' || Math.min(sx, sz) > 0.7 || Math.max(sx, sz) < 0.9 || Math.max(sx, sz) > 5) continue;
      const mx = (L.min[0] + L.max[0]) / 2, mz = (L.min[2] + L.max[2]) / 2, half = Math.max(sx, sz) / 2 - 0.2;
      for (let u = -half; u <= half + 1e-6; u += cell / 2) {
        const i = this.ix(along ? mx + u : mx), j = this.iz(along ? mz : mz + u), x = this.cx(i), z = this.cz(j);
        if (!this.blocked[j * this.n + i] || (along ? Math.abs(x - mx) > half : Math.abs(z - mz) > half)) continue;
        const g = world.supportHeight(x, z, groundHeight(x, z) + 0.2, 0.05), lift = L.min[1] - g;
        // clear at the cell centre AND on the wall's own line: a cell centre can sit just outside the wall, where a
        // window's sill (under its "lintel", the wall piece over the opening) would go unnoticed and the window
        // would become a doorway for the bots
        if (lift >= 1.9 && lift <= 2.7 && clear(x, z, g, 0.12) && clear(along ? x : mx, along ? mz : z, g, 0.12)) this.blocked[j * this.n + i] = 0;
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

  // The free cell to start a path from: a soldier right against a wall stands in a blocked cell, which has free
  // neighbours on both sides of the wall — take the nearest one he can step to in a straight line (knee height,
  // `sy` = his feet), never the one behind the wall (he'd walk into it).
  nearestFreeFrom(x, z, sy) {
    const i = this.ix(x), j = this.iz(z);
    if (this.free(i, j)) return [i, j];
    const w = this.world, y = (sy ?? w.map.groundHeight(x, z)) + 0.5;
    for (let r = 1; r < 12; r++) {
      let best = null, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !this.free(i + di, j + dj)) continue;
        const cx = this.cx(i + di), cz = this.cz(j + dj), d = Math.hypot(cx - x, cz - z);
        if (d < bd && w.lineOfSight({ x, y, z }, { x: cx, y, z: cz })) { bd = d; best = [i + di, j + dj]; }
      }
      if (best) return best;
    }
    return this.nearestFree(i, j);
  }

  // Returns array of {x,z} waypoints (string-pulled) or null. sy: the start's height (see nearestFreeFrom).
  // A* over the grid (8-connected, no corner cutting). All of its state lives in flat typed arrays shared by every
  // search (see scratch()): a search on a big map expands tens of thousands of cells, and doing that with Maps,
  // Sets and a heap of little arrays took 30-100 ms — a visible hitch for every room on the server.
  findPath(sx, sz, tx, tz, maxExpand = 60000, sy) {
    const s = this.nearestFreeFrom(sx, sz, sy), t = this.nearestFree(this.ix(tx), this.iz(tz));
    if (!s || !t) return null;
    const N = this.n, start = s[1] * N + s[0], goal = t[1] * N + t[0], blocked = this.blocked, ti = t[0], tj = t[1];
    const S = scratch(N * N), g = S.g, came = S.came, mark = S.mark, open = S.id * 2, closed = open + 1;
    // binary min-heap of (f, cell), in two parallel arrays
    let hf = S.hf, hk = S.hk, hn = 0;
    const push = (f, k) => {
      if (hn === hf.length) { const nf = new Float64Array(hn * 2), nk = new Int32Array(hn * 2); nf.set(hf); nk.set(hk); S.hf = hf = nf; S.hk = hk = nk; }
      let i = hn++;
      hf[i] = f; hk[i] = k;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; const f0 = hf[p], k0 = hk[p]; hf[p] = hf[i]; hk[p] = hk[i]; hf[i] = f0; hk[i] = k0; i = p; }
    };
    const pop = () => {
      const top = hk[0];
      if (--hn > 0) {
        hf[0] = hf[hn]; hk[0] = hk[hn];
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < hn && hf[l] < hf[m]) m = l;
          if (r < hn && hf[r] < hf[m]) m = r;
          if (m === i) break;
          const f0 = hf[m], k0 = hk[m]; hf[m] = hf[i]; hk[m] = hk[i]; hf[i] = f0; hk[i] = k0; i = m;
        }
      }
      return top;
    };
    g[start] = 0; mark[start] = open;
    push(0, start);
    let expanded = 0, found = false;
    while (hn && expanded < maxExpand) {
      const k = pop();
      if (k === goal) { found = true; break; }
      if (mark[k] === closed) continue;
      mark[k] = closed; expanded++;
      const ci = k % N, cj = (k / N) | 0, gk = g[k];
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= N) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di;
          if (ni < 0 || ni >= N) continue;
          const nk = nj * N + ni;
          if (blocked[nk]) continue;
          if (di && dj && (blocked[cj * N + ni] || blocked[nj * N + ci])) continue; // (no cutting a corner)
          const ng = gk + (di && dj ? 1.414 : 1), m = mark[nk], known = m === open || m === closed;
          if (!known || ng < g[nk]) {
            g[nk] = ng; came[nk] = k;
            if (!known) mark[nk] = open;
            const dx = Math.abs(ni - ti), dz = Math.abs(nj - tj);
            push(ng + (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)), nk);
          }
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; ; k = came[k]) { cells.push(k); if (k === start) break; }
    cells.reverse();
    // string pulling on grid
    const pts = [];
    let anchor = 0;
    pts.push(cells[0]);
    for (let i = 2; i < cells.length; i++) {
      if (!this.gridLOS(cells[anchor], cells[i]) || !this.bodyClear(cells[anchor], cells[i])) { anchor = i - 1; pts.push(cells[anchor]); }
    }
    pts.push(cells[cells.length - 1]);
    return pts.map((k) => ({ x: this.cx(k % N), z: this.cz((k / N) | 0) }));
  }

  // a soldier's body (±0.3 m) fits along the straight line between two cell centres at knee height: the grid alone
  // lets a shortcut clip a door jamb at a steep angle, where the collision then holds the bot against it
  bodyClear(a, b) {
    const N = this.n, w = this.world, gh = w.map.groundHeight;
    const ax = this.cx(a % N), az = this.cz((a / N) | 0), bx = this.cx(b % N), bz = this.cz((b / N) | 0);
    const L = Math.hypot(bx - ax, bz - az) || 1, ox = -(bz - az) / L * 0.3, oz = (bx - ax) / L * 0.3;
    const ya = gh(ax, az) + 0.5, yb = gh(bx, bz) + 0.5;
    for (const k of [0, 1, -1]) if (!w.lineOfSight({ x: ax + ox * k, y: ya, z: az + oz * k }, { x: bx + ox * k, y: yb, z: bz + oz * k })) return false;
    return true;
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
