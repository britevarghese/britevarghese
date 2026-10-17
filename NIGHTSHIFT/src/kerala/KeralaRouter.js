// KeralaRouter: road routing on the streamed Kerala lanes, behind the Port Halvern layout interface
// (nodes[id].x/z, nearestNode(x, z) -> node, route(fromNode, toNode) -> ids) so police and the GPS work unchanged.
// Nodes are the junctions of the loaded lane graph; route() follows the lanes (keep left) and returns the
// lane points as temporary waypoint nodes appended after the junctions, valid until the next route() call.
// the way a lane runs at its end (or start), over its last (first) 6 m: lanes hook into a junction's centre over the
// last metre or two, and by their last segment alone a plain turn looked like turning round
function dirAt(P, end) {
  const n = P.length, i = end ? n - 1 : 0, st = end ? -1 : 1;
  let j = i;
  for (let d = 0; d < 6 && j + st >= 0 && j + st < n; j += st) d += Math.hypot(P[j + st][0] - P[j][0], P[j + st][1] - P[j][1]);
  const dx = (P[i][0] - P[j][0]) * -st, dz = (P[i][1] - P[j][1]) * -st, l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}
// the cost of turning from lane a into lane b at a junction, in metres of road: turning right round (back the way a
// came) only when there's no other way; an acute turn (a Y-junction taken backwards) a little; and for a lorry or a
// bus a sharp turn into a side street too (a lorry on a mission route cut such a corner into a house)
function turnCost(a, b, big, sharp = 120) {
  if (a.pts.length < 2 || b.pts.length < 2) return 0;
  const [ax, az] = (a._dirE ||= dirAt(a.pts, true)), [bx, bz] = (b._dirS ||= dirAt(b.pts, false));
  const c = ax * bx + az * bz;
  if (c < -0.85) return big ? 4000 : 600;                        // (more than ~150 degrees)
  if (c < -0.34) return big ? 2500 : sharp;                       // (more than ~110: a lorry can't, short of backing up)
  if (big && c < 0.42 && b.edge?.cls > 4) return 200;            // (more than ~65, into a side street)
  return 0;
}

// a lane's sharpest bend: the most it turns within any 12 m of it (radians). A road can bend at a junction within one
// lane: 100 degrees in 6 m, where a lorry cut the corner and stuck
function sharpOf(P) {
  let best = 0;
  const turn = [], at = [0];
  for (let i = 1; i < P.length - 1; i++) {
    let d = Math.atan2(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) - Math.atan2(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    turn.push(d); at.push(at[at.length - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  }
  for (let i = 0; i < turn.length; i++) {
    let sum = 0;
    for (let j = i; j < turn.length && at[j + 1] - at[i + 1] <= 12; j++) { sum += turn[j]; best = Math.max(best, Math.abs(sum)); }
  }
  return best;
}

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

  // a junction node that is the end of a road (no way on but back the way it came): no place to send a car cruising
  // on, it can only turn round there
  deadEnd(id) {
    this._sync();
    if (id && typeof id === 'object') id = id.id;
    const out = this.adj[id];
    if (!out) return false;
    const to = new Set(out.map((o) => o.to));
    return to.size === 0 || (to.size === 1 && this.adj[[...to][0]].some((o) => o.to === id));
  }

  // the junctions within r of (x, z) (by the 100 m squares: some a little further)
  nodesNear(x, z, r) {
    this._sync();
    const out = [], c0 = Math.floor(x / 100), c1 = Math.floor(z / 100), k = Math.ceil(r / 100);
    for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) for (const i of this.grid.get(`${c0 + dx},${c1 + dz}`) || []) out.push(this.list[i]);
    return out;
  }

  nearestNode(x, z) {
    this._sync();
    const cx = Math.floor(x / 100), cz = Math.floor(z / 100);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 40; r++) {
      // rings of cells outwards, until no ring left can hold anything nearer than what's found: ring r is at least
      // r - 1 cells off. (Stopped at the first ring with anything in it, a car by a cell's edge was given a junction
      // 53 m off behind the houses, with one 29 m up its own road just over the edge: an AI car set off for it
      // across the verge, and the GPS showed the way from there)
      if (best >= 0 && (r - 1) * 100 > Math.sqrt(bd)) break;
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

  // the way by road from a place on one lane to a place on another (each { lane, s }), as points: on along the first
  // to its junction, through the junctions between, and along the second up to the place - or, against: to the
  // second's far end and back down it the wrong way (a police car after someone). null when there's none
  pathBetween(a, b, opts = null, against = false) {
    this._sync();
    const out = [], tmp = {};
    const add = (x, z) => { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - x, q[1] - z) > 0.5) out.push([x, z]); };
    const along = (l, s0, s1) => {
      l.sample(s0, tmp); add(tmp.x, tmp.z);
      for (let i = 1; i < l.pts.length - 1; i++) if (l.cum[i] > s0 && l.cum[i] < s1) add(l.pts[i][0], l.pts[i][1]);
      l.sample(s1, tmp); add(tmp.x, tmp.z);
    };
    if (a.lane === b.lane && b.s >= a.s) { along(a.lane, a.s, b.s); return out; }
    const from = this.ids.get(a.lane.to), to = this.ids.get(against ? b.lane.to : b.lane.from);
    if (from == null || to == null) { this.lastWhy = 'no junction'; return null; }
    const ids = from === to ? [] : this.route(from, to, a.lane, opts);
    if (from !== to && !ids.length) { this.lastWhy = `no way ${from}->${to} (${this.lastSteps} steps)`; return null; }
    along(a.lane, a.s, a.lane.length);
    for (const id of ids) add(this.list[id].x, this.list[id].z);
    if (!against) along(b.lane, 0, b.s);
    else {
      const l = b.lane;
      for (let i = l.pts.length - 2; i > 0; i--) if (l.cum[i] > b.s) add(l.pts[i][0], l.pts[i][1]);
      l.sample(b.s, tmp); add(tmp.x, tmp.z);
    }
    return out;
  }

  // A* over the junctions; returns waypoint ids (lane points), [] when unreachable. `after`: the lane the route so far
  // came into `from` by (the leg before, through a race's or a mission's waypoints: not turned round at the waypoint).
  // opts.big: a lorry or a bus, kept to the main roads where it can (the side streets' corners are too tight for it:
  // a lorry on a mission route cut a corner into a house). opts.sharp: what a turn of more than ~110 degrees costs
  // (a three-point turn); opts.maxSteps: how far to look before giving up
  route(from, to, after = null, opts = null) {
    const minorW = opts?.big ? 4 : 1;
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
    while (heap.length && steps++ < (opts?.maxSteps || 60000)) {
      const [, u] = pop();
      if (u === to) { found = true; break; }
      const gu = g.get(u), lin = prev.get(u) || (u === from ? after : null);
      for (const { to: v, lane } of this.adj[u]) {
        // (not from a road on the ground onto a deck over it, or off the deck down onto it: they meet in the map only)
        if (lin && lin.yTo != null && lane.yFrom != null && Math.abs(lin.yTo - lane.yFrom) > 1.5) continue;
        // (turning right round at a junction only when there's no other way: round the block instead, as a driver
        // would. An AI car can't turn in a lane: a truck on a story route stood facing the way it came for good)
        const gv = gu + lane.length * (lane.edge?.cls > 4 ? minorW : 1) + (lin ? turnCost(lin, lane, opts?.big, opts?.sharp) : 0) + (opts?.big && (lane._sharp ??= sharpOf(lane.pts)) > 1.5 ? 1500 : 0);
        if (gv < (g.get(v) ?? Infinity)) { g.set(v, gv); prev.set(v, lane); push([gv + Math.hypot(N[v].x - goal.x, N[v].z - goal.z), v]); }
      }
    }
    this.lastSteps = steps;
    if (!found) return [];
    const path = [];
    for (let v = to; v !== from && path.length < 5000;) { const lane = prev.get(v); path.push(lane); v = this.ids.get(lane.from); }
    path.reverse();
    this.lastLane = path[path.length - 1] || null;
    const out = [];
    for (const lane of path) {
      const P = lane.pts;
      for (let i = 0; i < P.length; i++) {
        const last = out.length ? N[out[out.length - 1]] : null;
        // (only the point two lanes share at a junction, or one on top of another: dropping every point within 6 m
        // of the last left out the start of the next lane, and the route cut across the corner, a metre off the
        // lane, into a bridge's parapet)
        // (and only those: across a narrow junction one lane ends 1.4 m from the next one's start, and dropping that
        // start ran the route from the kerb to the lane's next point 105 m on, a car's width off the lane all along,
        // into a house's wall; moving the last lane's end onto it instead skewed that lane's last 45 m, into a canal's
        // parapet. The two points kept, the AI rounds the turn between them)
        if (last && Math.hypot(P[i][0] - last.x, P[i][1] - last.z) < 0.5) continue;
        out.push(N.length); N.push({ id: N.length, x: P[i][0], z: P[i][1], type: 'wp' });
      }
    }
    return out;
  }

}
