// Ledges: a canyon wall's sandstone as it stands, in three dimensions (a map's `ledges`). Bedded sandstone weathers in
// steps: each bed of harder rock juts out as a ledge over the softer rock under it, which wears back into a shadowed
// recess (where water seeps out at the foot of a porous bed over a tighter one, the recess an alcove); and the beds
// are cut by joints into blocks that stand out a little more or less than the next (Navajo and Zion sandstone, the
// National Park Service). The ground's grid can't hold a ledge that overhangs, so they are built over it: along each
// wall, at the height of each bed's lip (the contour of the map's bed coordinate over the ground), a slab whose lip
// juts out past the face below, broken into blocks at the joints.
//
// Here only where they are: the strips of ledge in a square of the map, as points along the wall (on its face, at the
// lip's height), which way is out from the face, and each block's jut and thickness. render/Ledges.js builds them.
// Pure JS (the tests run it in Node).
import { hash2, vnoise } from './Noise.js';
import { spline } from './WorldGen.js';

const STEP = 2;                 // the grid the walls are traced on (m: the ground's own)
const SPACING = 1.2;            // points along a strip (m)

const TRACKS = new WeakMap();
/** A world's tracks, as they are laid (every 2 m along them), each with its half-width: made once a world. */
export function tracksOf(world) {
  let T = TRACKS.get(world);
  if (!T) TRACKS.set(world, (T = (world.map.trails || []).map((t) => ({ pts: spline(t.points, 2), hw: (t.width ?? 3) / 2 }))));
  return T;
}

/**
 * The strips of ledge in the square [x0, x0 + size] x [z0, z0 + size] of the world's frame. spec: the map's `ledges`:
 * { bed(x, z, h): the bed coordinate (it rises one a bed), levels: [{ at (where in a bed: its fraction), out: [lo, hi]
 * (how far the lip juts past the face, m), thick: [lo, hi] (m), block: [lo, hi] (a block's length along the wall, m), cover (the share of the blocks there: 1, all) }],
 * minSlope (the faces steep enough for them), clear (m its lips are kept clear of a track's edge), skip(x, z) (true
 * where there are none), seed }.
 * Each strip: { level, pts: [x, y, z, ...], out: [nx, nz, ...] (out from the face), sl: [slope, ...], jut, thick }.
 */
export function ledgeStrips(world, x0, z0, size, spec) {
  const it = ledgeSteps(world, x0, z0, size, spec);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}

/**
 * ledgeStrips a step at a time (a generator: each next() a line's worth of the work, a millisecond or so, the strips its
 * return value), for a renderer to spread over its frames.
 */
export function* ledgeSteps(world, x0, z0, size, spec) {
  // (the ground's grid heights: the rock's fine relief over them is no matter to where a bed's lip runs)
  const n = Math.round(size / STEP) + 1, H = new Float32Array(n * n), U = new Float32Array(n * n), G = new Float32Array(n * n);
  const base = (world.terrainBase || world.terrain).bind(world);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) H[k * n + i] = base(x0 + i * STEP, z0 + k * STEP);
    if ((k & 7) === 7) yield;
  }
  let steep = 0;
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
    const a = H[k * n + Math.max(0, i - 1)], b = H[k * n + Math.min(n - 1, i + 1)], c = H[Math.max(0, k - 1) * n + i], d = H[Math.min(n - 1, k + 1) * n + i];
    steep = Math.max(steep, G[k * n + i] = Math.hypot((b - a) / (STEP * (i > 0 && i < n - 1 ? 2 : 1)), (d - c) / (STEP * (k > 0 && k < n - 1 ? 2 : 1))));
  }
  if (steep < spec.minSlope) return [];                       // (no wall in it)
  yield;
  // (the beds: only those the steep ground in it crosses)
  let umin = Infinity, umax = -Infinity;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const o = k * n + i, u = U[o] = spec.bed(x0 + i * STEP, z0 + k * STEP, H[o]);
      if (G[o] >= spec.minSlope * 0.8) { umin = Math.min(umin, u); umax = Math.max(umax, u); }
    }
    if ((k & 7) === 7) yield;
  }
  // (the points of the tracks near the square, and whether a point is within spec.clear and a few metres of one's edge)
  const reach = (spec.clear ?? 8) + 8, near = [];
  for (const { pts, hw } of tracksOf(world)) {
    for (const [x, z] of pts) if (x > x0 - reach && x < x0 + size + reach && z > z0 - reach && z < z0 + size + reach) near.push(x, z, hw);
  }
  const keep = (spec.clear ?? 8) + 3.6;
  const nearTrack = (x, z) => {
    for (let j = 0; j < near.length; j += 3) {
      const dx = x - near[j], dz = z - near[j + 1], r = keep + near[j + 2];
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  const strips = [];
  for (let li = 0; li < spec.levels.length; li++) {
    const lv = spec.levels[li];
    for (let bed = Math.floor(umin - lv.at); bed + lv.at <= umax; bed++) {
      const L = bed + lv.at;
      yield;
      for (const line of contour(U, G, n, L, spec.minSlope)) {
        const pts = line.map(([gi, gk]) => [x0 + gi * STEP, z0 + gk * STEP]);
        strips.push(...blocks(world, pts, lv, li, bed, spec, nearTrack));
        yield;
      }
    }
  }
  return strips;
}

/**
 * Marching squares: the lines where the field U crosses L, through cells steep enough (as grid coordinates), chained.
 * (Each crossing is known by the grid edge it is on, which the two cells either side of it share.)
 */
function contour(U, G, n, L, minSlope) {
  const at = (i, k) => U[k * n + i] - L;
  // the edges: (i, k) to (i + 1, k) is 2 (k n + i), (i, k) to (i, k + 1) the next
  const point = (e) => {
    const c = e >> 1, i = c % n, k = (c - i) / n, i1 = e & 1 ? i : i + 1, k1 = e & 1 ? k + 1 : k, a = at(i, k), t = a / (a - at(i1, k1));
    return [i + (i1 - i) * t, k + (k1 - k) * t];
  };
  const segs = [], ends = new Map();
  const seg = (e0, e1) => {
    const j = segs.length;
    segs.push(e0, e1);
    for (const e of [e0, e1]) { const l = ends.get(e); if (l) l.push(j >> 1); else ends.set(e, [j >> 1]); }
  };
  for (let k = 0; k < n - 1; k++) for (let i = 0; i < n - 1; i++) {
    const o = k * n + i;
    if (G[o] < minSlope && G[o + 1] < minSlope && G[o + n] < minSlope && G[o + n + 1] < minSlope) continue;
    const a = at(i, k) > 0, b = at(i + 1, k) > 0, c = at(i + 1, k + 1) > 0, d = at(i, k + 1) > 0;
    if (a === b && b === c && c === d) continue;
    // the crossings on the cell's four edges (bottom, right, top, left), paired up
    const E = [a !== b ? 2 * o : -1, b !== c ? 2 * (o + 1) + 1 : -1, c !== d ? 2 * (o + n) : -1, d !== a ? 2 * o + 1 : -1];
    const on = E.filter((e) => e >= 0);
    if (on.length === 2) seg(on[0], on[1]);
    else if (on.length === 4) { seg(E[0], E[1]); seg(E[2], E[3]); }
  }
  const used = new Uint8Array(segs.length >> 1), lines = [];
  for (let j = 0; j < used.length; j++) {
    if (used[j]) continue;
    used[j] = 1;
    const line = [segs[2 * j], segs[2 * j + 1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1] : line[0], next = (ends.get(tip) || []).find((q) => !used[q]);
        if (next === undefined) break;
        used[next] = 1;
        const p = segs[2 * next] === tip ? segs[2 * next + 1] : segs[2 * next];
        if (dir) line.push(p); else line.unshift(p);
      }
    }
    if (line.length >= 3) lines.push(line.map(point));
  }
  return lines;
}

/** A traced line of wall cut into blocks at its joints: each a strip of points along the face, with its jut. */
function blocks(world, pts, lv, li, bed, spec, nearTrack) {
  const base = (world.terrainBase || world.terrain).bind(world);
  // resampled evenly along the line
  const even = [pts[0]];
  let carry = 0;
  for (let j = 1; j < pts.length; j++) {
    const [ax, az] = pts[j - 1], [bx, bz] = pts[j], l = Math.hypot(bx - ax, bz - az);
    let t = SPACING - carry;
    while (t <= l) { even.push([ax + (bx - ax) * t / l, az + (bz - az) * t / l]); t += SPACING; }
    carry = l - (t - SPACING);
  }
  const out = [], seed = spec.seed + li * 131 + bed * 17;
  // (each joint and block by where it is along the wall)
  const at = (x, z, k) => hash2(Math.floor(x * 2), Math.floor(z * 2), seed + k);
  const nextJoint = (x, z) => lv.block[0] + (lv.block[1] - lv.block[0]) * at(x, z, 0);
  let cur = null, arc = 0, jointAt = nextJoint(...even[0]) * at(...even[0], 3);
  const close = () => { if (cur && !cur.skip && cur.pts.length >= 9) { delete cur.skip; out.push(cur); } cur = null; };
  const add = (x, z, gx, gz, sl) => { cur.pts.push(x, world.terrain(x, z), z); cur.out.push(-gx / sl, -gz / sl); cur.sl.push(sl); };
  for (let j = 0; j < even.length; j++) {
    const [x, z] = even[j];
    if (j) arc += SPACING;
    // (off the tracks: a ledge's face no nearer a track's edge than spec.clear and a few metres, so its lip, jutting
    // out a few metres at most, stays spec.clear off)
    const e = 0.5, gx = (base(x + e, z) - base(x - e, z)) / (2 * e), gz = (base(x, z + e) - base(x, z - e)) / (2 * e);
    const sl = Math.hypot(gx, gz);
    if (sl < spec.minSlope * 0.5 || nearTrack(x, z) || spec.skip?.(x, z)) { close(); continue; }
    // (at a joint one block ends and the next begins: render/Ledges.js leaves the crack between them)
    if (arc >= jointAt) {
      jointAt = arc + nextJoint(x, z);
      if (cur) { add(x, z, gx, gz, sl); close(); }
    }
    if (!cur) {
      // (a bed's ledge much the same along a wall: its jut wandering along it, a block a little more or less; its
      // thickness the bed's, a block a little thicker or thinner; a thinner bed's ledge only here and there)
      const jut = lv.out[0] + (lv.out[1] - lv.out[0]) * (0.6 * vnoise(x / 24, z / 24, seed + 7) + 0.4 * at(x, z, 11));
      const thick = (lv.thick[0] + (lv.thick[1] - lv.thick[0]) * hash2(bed, li, seed + 5)) * (0.88 + 0.24 * at(x, z, 13));
      cur = { level: li, pts: [], out: [], sl: [], jut, thick, skip: at(x, z, 17) > (lv.cover ?? 1) };
    }
    // (out from the face: down the slope)
    add(x, z, gx, gz, sl);
  }
  close();
  // (a block's jut wavers a little along it)
  for (const s of out) s.wave = 0.25 * (vnoise(s.pts[0] / 3, s.pts[2] / 3, seed + 21) - 0.5);
  return out;
}
