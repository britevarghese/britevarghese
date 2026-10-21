// Building the open world (world/maps/world.js): each of its maps by the generator as it always is, in its own frame;
// the stretches between them last, from their neighbours' edges. Pure JS (Node for the tests, a worker in the game).

import { generateWorld } from './WorldGen.js';
import { REGIONS, regionById } from './maps/world.js';

// each side of a square: the neighbour's edge facing it, which way is into the stretch, and along which axis it runs
const FACING = { west: 'east', east: 'west', north: 'south', south: 'north' };

/** Bilinear height in a generated map's own frame (clamped to its grid). */
export function heightIn(d, x, z) {
  const N = d.N, fx = Math.min(N - 1.001, Math.max(0, (x - d.origin) / d.res)), fz = Math.min(N - 1.001, Math.max(0, (z - d.origin) / d.res));
  const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k, o = k * N + i, H = d.heights;
  return (H[o] * (1 - tx) + H[o + 1] * tx) * (1 - tz) + (H[o + N] * (1 - tx) + H[o + N + 1] * tx) * tz;
}

/**
 * A neighbour's ground along the edge it shares with a stretch: { side, at0, step, h, g } in the stretch's frame (see
 * maps/world.js layOnSeams). side: the stretch's side; n: the neighbour's region and its generated data.
 */
export function seamOf(stretch, side, n, nd) {
  const M = stretch.map, half = M.half, step = M.res;
  const [cx, cz] = stretch.at, [nx, nz] = n.at, nh = nd.half, r = nd.res;
  const count = Math.round(2 * half / step) + 1, h = new Float32Array(count), g = new Float32Array(count);
  const edge = FACING[side];
  for (let t = 0; t < count; t++) {
    const along = -half + t * step;
    // the point on the shared edge, in the neighbour's frame, and one cell in from it
    let x, z, ix, iz;
    if (side === 'west' || side === 'east') { z = cz + along - nz; x = edge === 'east' ? nh : -nh; ix = edge === 'east' ? x - r : x + r; iz = z; }
    else { x = cx + along - nx; z = edge === 'south' ? nh : -nh; iz = edge === 'south' ? z - r : z + r; ix = x; }
    const e = heightIn(nd, x, z);
    h[t] = e;
    g[t] = (e - heightIn(nd, ix, iz)) / r;            // (rising towards the edge, per metre: carried on past it)
  }
  return { side, at0: -half, step, h, g };
}

/** A stretch's neighbours' edges (done: id -> generated data), or null for a map of its own. */
export function seamsFor(id, done) {
  const R = regionById(id);
  if (!R.seams) return null;
  return Object.entries(R.seams).map(([side, nid]) => {
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
export const needs = (id) => Object.values(regionById(id).seams || {});

/** Build one region, given its seams (seamsFor; in a worker: world/worldWorker.js). */
export async function generateRegionWith(id, seams, opts = {}) {
  const R = regionById(id);
  return generateWorld({ ...opts, map: seams ? { ...R.map, seams } : R.map });
}

/** Build one region (done: the regions built so far). */
export async function generateRegion(id, done, opts = {}) {
  return generateRegionWith(id, seamsFor(id, done), opts);
}

/** Build the whole world in order (Node): Map id -> data, each in its own frame. */
export async function generateBigWorld(opts = {}) {
  const done = new Map();
  const order = [...REGIONS.filter((r) => !r.seams), ...REGIONS.filter((r) => r.seams)];
  for (const R of order) done.set(R.id, await generateRegion(R.id, done, opts));
  return done;
}
