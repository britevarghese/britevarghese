// The open world's seams (world/maps/world.js): a stretch's ground laid onto the maps beside it, and its roads on graded
// ground. Each stretch's generator hooks come from here (graded), whichever file the stretch is in.
import { vnoise } from '../Noise.js';
import { SURFACE } from '../../physics/Surfaces.js';
import { spline, limitGrade } from '../WorldGen.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (a, b) => Math.sqrt(a * a + b * b);

// ---------------------------------------------------------------- seams, and roads on graded ground
/**
 * A stretch's ground laid onto the maps either side of it (seams: each { side, at0, step, h, g }: the neighbour's
 * heights along the shared edge every `step` m from `at0` (in the stretch's frame), and how steeply its ground runs up
 * towards the edge). Within `band` m of an edge the stretch's own ground gives way to the neighbour's carried on past
 * its edge, its slope fading over a few tens of metres: on the edge itself the two are the same height. What is
 * carried in is the neighbour's edge averaged along it over more of it the further in (half as far either way as it is
 * in, up to 80 m): its hills and valleys run on into the stretch, but not its every hummock and rill, drawn out
 * straight across the band into furrows.
 */
export function onSeams(seams, half, x, z, h) {
  // (each neighbour's ground carried in, and how strongly; where two edges' bands meet, at a corner, the ground is the
  // two carried in together, each by how near its edge is: laid on one after the other, the second one's took over,
  // and its edge was pulled back to the first's in a crease a few metres in)
  let reach = 0, sum = 0, wsum = 0, keep = 1;
  for (const sm of seams) {
    const B = sm.band ?? 220, D0 = 28;
    const dist = sm.side === 'west' ? x + half : sm.side === 'east' ? half - x : sm.side === 'north' ? z + half : half - z;
    if (dist >= B) continue;
    // (a neighbour along part of the edge only: past the end of what it shares, its edge's last stretch carried on
    // and fading out, so the stretch's own ground comes back gradually there, with no step where the neighbour ends)
    const n = sm.h.length, qr = alongOf(sm, x, z);
    const past = Math.max(0, -qr, qr - (n - 1)) * sm.step;
    if (past >= SEAM_FADE) continue;
    // (but not where another neighbour on the same side takes over from it)
    if (past > 0 && seams.some((o) => o !== sm && o.side === sm.side && (() => { const qo = alongOf(o, x, z); return qo >= 0 && qo <= o.h.length - 1; })())) continue;
    const q = clamp(qr, 0, n - 1), q0 = Math.min(Math.floor(q), n - 2);
    const f = q - q0, w = Math.min(80, Math.max(0, dist) * 0.5) / sm.step;
    const eh = edgeMean(sm, 'h', q0, w) * (1 - f) + edgeMean(sm, 'h', q0 + 1, w) * f;
    const eg = edgeMean(sm, 'g', q0, w) * (1 - f) + edgeMean(sm, 'g', q0 + 1, w) * f;
    const a = smoothstep(B, 0, dist) * smoothstep(SEAM_FADE, 0, past), k = a / (Math.max(0, dist) + 4) ** 2;
    sum += (eh + eg * D0 * (1 - Math.exp(-dist / D0))) * k; wsum += k; keep *= 1 - a;
    reach++;
  }
  return reach ? lerp(h, sum / wsum, 1 - keep) : h;
}

// (m past the end of a neighbour that shares only part of an edge over which its ground's hold fades out)
const SEAM_FADE = 260;
/** Where (x, z) is along a seam: the index of its point there (fractional; outside 0..n-1 past its ends). */
const alongOf = (sm, x, z) => ((sm.side === 'west' || sm.side === 'east' ? z : x) - sm.at0) / sm.step;

/** A region's neighbours: [side, id] for each (a side's value: a neighbour's id, or a list where several share it). */
export const seamPairs = (R) => Object.entries(R.seams || {}).flatMap(([side, ids]) => [].concat(ids).map((id) => [side, id]));

/** A seam's heights or slopes (key 'h' or 'g') at point i, averaged over w points either way (w fractional). */
function edgeMean(sm, key, i, w) {
  // (running sums along the edge, made once a seam)
  const sums = (sm.sums ||= {})[key] ||= (() => {
    const a = sm[key], c = new Float64Array(a.length + 1);
    for (let k = 0; k < a.length; k++) c[k + 1] = c[k] + a[k];
    return c;
  })();
  const n = sm[key].length, box = (W) => {
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W);
    return (sums[hi + 1] - sums[lo]) / (hi - lo + 1);
  };
  const W0 = Math.floor(w), t = w - W0;
  return t ? box(W0) * (1 - t) + box(W0 + 1) * t : box(W0);
}
export const seamDist = (seams, half, x, z) => {
  let d = Infinity;
  for (const sm of seams) d = Math.min(d, sm.side === 'west' ? x + half : sm.side === 'east' ? half - x : sm.side === 'north' ? z + half : half - z);
  return d;
};

/**
 * A stretch's edges made its neighbours' exactly, once everything is cut into it (its roads' and its river's own cuts
 * went over the ground the neighbour had already cut its own into): what is left between the two shifted out of the
 * ground over the last few metres in from the edge.
 */
function closeSeams(ctx) {
  const { M, H, N, res, origin } = ctx, B = 30, nB = Math.ceil(B / res);
  for (const sm of M.seams || []) {
    for (let t = 0; t < N; t++) {
      const q = (origin + t * res - sm.at0) / sm.step, q0 = Math.min(Math.floor(q), sm.h.length - 2);
      if (q < 0 || q > sm.h.length - 1) continue;
      const cell = (d) => (sm.side === 'west' ? t * N + d : sm.side === 'east' ? t * N + N - 1 - d : sm.side === 'north' ? d * N + t : (N - 1 - d) * N + t);
      const off = sm.h[q0] + (sm.h[q0 + 1] - sm.h[q0]) * (q - q0) - H[cell(0)];
      for (let d = 0; d <= nB; d++) H[cell(d)] += off * smoothstep(B, 0, d * res);
    }
  }
}

/**
 * Roads on graded ground: the ground along each (its trail in M.trails, by name), smoothed and kept within its grade,
 * cut into the rises and built up over the dips as deep as that takes, its ends held where they must be ('ground': on
 * the ground there, which on a seam is the neighbour's road; { road }: on that road); and the ground along it laid onto
 * that line, banked either side. A map's prepare, fine and surface hooks (its own run first); on a stretch, its seams
 * too.
 */
export function graded(specs, own = {}) {
  return {
    ...own,
    prepare(c) {
      own.prepare?.(c);
      const { M, K, coarseAt, res, half } = c;
      K.seams = M.seams || []; K.half = half; K.beds = [];
      const ground = (x, z) => onSeams(K.seams, half, x, z, coarseAt(x, z));
      for (const sp of specs) {
        const tr = M.trails.find((t) => t.name === sp.road);
        if (!tr) continue;                                                       // (a road not routed yet)
        const pts = spline(tr.points, res), n = pts.length;
        const arc = [0];
        for (let i = 1; i < n; i++) arc.push(arc[i - 1] + hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        let hs = pts.map(([x, z]) => ground(x, z));
        const win = Math.max(1, Math.round((sp.smooth ?? 30) / res));
        for (let pass = 0; pass < 3; pass++) {
          const out = new Array(n);
          for (let i = 0; i < n; i++) {
            let sum = 0, cnt = 0;
            for (let q = Math.max(0, i - win); q <= Math.min(n - 1, i + win); q++) { sum += hs[q]; cnt++; }
            out[i] = sum / cnt;
          }
          hs = out;
        }
        const gr = sp.grade * 0.95, step = arc.map((a, i) => (i ? (a - arc[i - 1]) * gr : 0));
        const cut = limitGrade(hs, step, Math.min), fill = limitGrade(hs, step, Math.max);
        hs = hs.map((_, i) => (cut[i] + fill[i]) / 2);
        // its ends held: everything within the grade of them
        (sp.ends || []).forEach((e, j) => {
          if (!e) return;
          const ie = j ? n - 1 : 0, [ex, ez] = pts[ie];
          let P;
          if (e === 'ground') P = ground(ex, ez);
          else {
            const o = K.beds.find((b) => b.name === e.road);
            if (!o) return;
            let bd = Infinity;
            for (let i = 0; i < o.pts.length; i++) { const d = hyp(o.pts[i][0] - ex, o.pts[i][1] - ez); if (d < bd) { bd = d; P = o.hs[i]; } }
          }
          for (let i = 0; i < n; i++) { const r = gr * Math.abs(arc[i] - arc[ie]); hs[i] = clamp(hs[i], P - r, P + r); }
        });
        // the corridor: each cell's distance from the line and the line's height there
        const bed = tr.width + 4, reach = bed + 90;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
        x0 = Math.max(-half, Math.floor((x0 - reach) / res) * res); z0 = Math.max(-half, Math.floor((z0 - reach) / res) * res);
        x1 = Math.min(half, x1 + reach); z1 = Math.min(half, z1 + reach);
        const nx = Math.round((x1 - x0) / res) + 1, nz = Math.round((z1 - z0) / res) + 1;
        const D = new Float32Array(nx * nz).fill(1e9), P = new Float32Array(nx * nz), r = Math.ceil(reach / res);
        for (let p = 0; p < n; p++) {
          const [px, pz] = pts[p], ci = Math.round((px - x0) / res), ck = Math.round((pz - z0) / res);
          for (let k = Math.max(0, ck - r); k <= Math.min(nz - 1, ck + r); k++) {
            const dz = z0 + k * res - pz;
            for (let i = Math.max(0, ci - r); i <= Math.min(nx - 1, ci + r); i++) {
              const dx = x0 + i * res - px, d = Math.sqrt(dx * dx + dz * dz), o = k * nx + i;
              if (d < D[o]) { D[o] = d; P[o] = hs[p]; }
            }
          }
        }
        K.beds.push({ name: sp.road, pts, hs, x0, z0, nx, nz, res, D, P, bed, reach });
      }
    },
    fine(x, z, h, K) {
      if (own.fine) h = own.fine(x, z, h, K);
      if (K.seams.length) h = onSeams(K.seams, K.half, x, z, h);
      for (const b of K.beds) {
        const i = Math.round((x - b.x0) / b.res), k = Math.round((z - b.z0) / b.res);
        if (i < 0 || k < 0 || i >= b.nx || k >= b.nz) continue;
        const o = k * b.nx + i, d = b.D[o];
        if (d >= b.reach) continue;
        const p = b.P[o], bank = Math.min(b.reach - b.bed, Math.max(10, 1.5 * Math.abs(h - p)));
        let w = d <= b.bed ? 1 : smoothstep(b.bed + bank, b.bed, d);
        // (on a seam the neighbour's ground stands as it is: its own road is there)
        if (K.seams.length) w *= smoothstep(0, 24, seamDist(K.seams, K.half, x, z));
        h = lerp(h, p, w);
      }
      return h;
    },
    // (towards a seam with Kerala, its forest's rule for bare rock, as on Kerala's own side: only on the sheerest
    // faces, the rest of its steep ground grown over; giving way raggedly to this map's own over M.keralaRock m. The
    // map's own hook after it: rock it lays bare stays bare)
    surface(x, z, h, sl, s, idx, ctx) {
      const { K, M } = ctx;
      if (s === SURFACE.ROCK && K.seams.length && M.keralaRock) {
        for (const sm of K.seams) {
          if (sm.id !== 'kerala') continue;
          const d = sm.side === 'west' ? x + K.half : sm.side === 'east' ? K.half - x : sm.side === 'north' ? z + K.half : K.half - z;
          const t = smoothstep(M.keralaRock, M.keralaRock * 0.5, d);
          if (t > 0 && vnoise(x / 9, z / 9, M.seed + 61) < t * 1.15 && sl < 1.25 + 0.4 * vnoise(x / 13, z / 13, M.seed + 62)) { s = SURFACE.GRASS; break; }
        }
      }
      return own.surface ? own.surface(x, z, h, sl, s, idx, ctx) : s;
    },
    finish(ctx) { own.finish?.(ctx); closeSeams(ctx); },
  };
}

