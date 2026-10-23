// Building the open world (world/maps/world.js): each of its maps by the generator as it always is, in its own frame;
// the stretches between them last, from their neighbours' edges. Pure JS (Node for the tests, a worker in the game).

import { generateWorld } from './WorldGen.js';
import { gridOf } from './maps/index.js';
import { REGIONS, regionById, seamPairs } from './maps/world.js';

// each side of a square: the neighbour's edge facing it, which way is into the stretch, and along which axis it runs
const FACING = { west: 'east', east: 'west', north: 'south', south: 'north' };

/** Bilinear height in a generated map's own frame (clamped to its grid). */
export function heightIn(d, x, z) {
  const N = d.N, fx = Math.min(N - 1.001, Math.max(0, (x - d.origin) / d.res)), fz = Math.min(N - 1.001, Math.max(0, (z - d.origin) / d.res));
  const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k, o = k * N + i, H = d.heights;
  return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + N] * (1 - tx) + H[o + N + 1] * tx) * tz;
}

/**
 * A neighbour's ground along the edge it shares with a stretch: { side, id, at0, step, h, g } in the stretch's frame (see
 * maps/world.js layOnSeams). side: the stretch's side; n: the neighbour's region and its generated data.
 */
export function seamOf(stretch, side, n, nd) {
  const M = stretch.map, half = M.half, step = M.res;
  const [cx, cz] = stretch.at, [nx, nz] = n.at, nh = nd.half, r = nd.res;
  // (the part of the edge the neighbour shares: all of it, or where a bigger or smaller one stands beside it, part)
  const ns = side === 'west' || side === 'east';
  const lo = Math.max(-half, (ns ? nz - cz : nx - cx) - nh), hi = Math.min(half, (ns ? nz - cz : nx - cx) + nh);
  if (hi - lo < step) throw new Error(`${stretch.id} ${side}: ${n.id} shares none of its edge`);
  const at0 = Math.ceil(lo / step) * step;
  const count = Math.floor((hi - at0) / step) + 1, h = new Float32Array(count), g = new Float32Array(count);
  const edge = FACING[side];
  for (let t = 0; t < count; t++) {
    const along = at0 + t * step;
    // the point on the shared edge, in the neighbour's frame, and one cell in from it
    let x, z, ix, iz;
    if (side === 'west' || side === 'east') { z = cz + along - nz; x = edge === 'east' ? nh : -nh; ix = edge === 'east' ? x - r : x + r; iz = z; }
    else { x = cx + along - nx; z = edge === 'south' ? nh : -nh; iz = edge === 'south' ? z - r : z + r; ix = x; }
    const e = heightIn(nd, x, z);
    h[t] = e;
    g[t] = (e - heightIn(nd, ix, iz)) / r;            // (rising towards the edge, per metre: carried on past it)
  }
  return { side, id: n.id, at0, step, h, g };
}

/** A stretch's neighbours' edges (done: id -> generated data), or null for a map of its own. */
export function seamsFor(id, done) {
  const R = regionById(id);
  if (!R.seams) return null;
  return seamPairs(R).map(([side, nid]) => {
    const nd = done.get(nid);
    if (!nd) throw new Error(`${id}: ${nid} must be built first`);
    return seamOf(R, side, regionById(nid), nd);
  });
}

/** A region's definition, ready to generate: a stretch's with its neighbours' edges. */
export function regionMap(id, done) {
  const seams = seamsFor(id, done);
  return seams ? { ...regionById(id).map, seams } : regionById(id).map;
}

/** What a region needs built before it (its neighbours, for a stretch). */
export const needs = (id) => seamPairs(regionById(id)).map(([, nid]) => nid);

/** The regions in an order each can be built in: every one after those it is laid onto. */
export function buildOrder() {
  const out = [], seen = new Set();
  const visit = (id) => { if (seen.has(id)) return; seen.add(id); needs(id).forEach(visit); out.push(id); };
  for (const R of REGIONS) visit(R.id);
  return out;
}

/** Build one region, given its seams (seamsFor; in a worker: world/worldWorker.js). */
export async function generateRegionWith(id, seams, opts = {}) {
  const R = regionById(id), evenEdges = coarserEdges(id);
  return generateWorld({ ...opts, map: seams || evenEdges.length ? { ...R.map, ...(seams && { seams }), ...(evenEdges.length && { evenEdges }) } : R.map });
}

/**
 * The edges of a region that a coarser stretch is laid onto (its points every k of this one's, from `phase`): each
 * { side, lo, hi (m along it, in its frame), k, phase }. Those edges are made straight between that one's points
 * (world/WorldGen.js), where a finer map's own ground would stand off the coarser one's between them.
 */
export function coarserEdges(id) {
  const R = regionById(id), r = gridOf(R.map), out = [];
  for (const Q of REGIONS) {
    const q = gridOf(Q.map);
    if (q.res <= r.res || !seamPairs(Q).some(([, nid]) => nid === id)) continue;
    for (const side of Object.keys(FACING)) {
      const ns = side === 'west' || side === 'east', i = ns ? 0 : 1, sg = side === 'west' || side === 'north' ? -1 : 1;
      if (Math.abs(R.at[i] + sg * r.half - (Q.at[i] - sg * q.half)) > 0.01) continue;
      const c = R.at[1 - i], qc = Q.at[1 - i];
      const lo = Math.max(-r.half, qc - q.half - c), hi = Math.min(r.half, qc + q.half - c);
      if (hi <= lo) continue;
      const k = Math.round(q.res / r.res), phase = ((((qc - q.half) - (c - r.half)) / r.res) % k + k) % k;
      out.push({ side, lo, hi, k, phase });
    }
  }
  return out;
}

/** Build one region (done: the regions built so far). */
export async function generateRegion(id, done, opts = {}) {
  return generateRegionWith(id, seamsFor(id, done), opts);
}

/** Build the whole world in order (Node): Map id -> data, each in its own frame. */
export async function generateBigWorld(opts = {}) {
  const done = new Map();
  for (const id of buildOrder()) done.set(id, await generateRegion(id, done, opts));
  return done;
}
