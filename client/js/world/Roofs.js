// Pitched roofs from the plan in shared/map.js (roofPlan): tiled (or corrugated) slopes with a tile thickness,
// boarded soffits and rafter tails under the eaves, fascia + gutter, barge boards on the verges, ridge / hip caps,
// gable end walls in the facade finish, a chimney. Over a collapsed part (plan.hole) the slopes are cut away and the
// broken ends of the rafters and battens stick out. Visual only: the server collides with the stepped attic boxes.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const EPS = 1e-4;

// convex polygon [[u, v]...] clipped to the half-plane a*u + b*v <= c (Sutherland–Hodgman)
function clip(poly, a, b, c) {
  const out = [], f = (p) => a * p[0] + b * p[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    if (fp <= EPS) out.push(p);
    if ((fp < -EPS && fq > EPS) || (fp > EPS && fq < -EPS)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out.length >= 3 ? out : [];
}
const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s += p[0] * q[1] - q[0] * p[1]; } return Math.abs(s) / 2; };
// convex polygon minus an axis-aligned hole { u0, u1, v0, v1 }: convex pieces
function minusHole(P, h) {
  if (!h) return [P];
  const strips = [clip(P, 1, 0, h.u0), clip(P, -1, 0, -h.u1), clip(clip(clip(P, -1, 0, -h.u0), 1, 0, h.u1), 0, 1, h.v0), clip(clip(clip(P, -1, 0, -h.u0), 1, 0, h.u1), 0, -1, -h.v1)];
  return strips.filter((q) => q.length && area(q) > 1e-3);
}
// parts of segment a..b (plan uv) outside the hole, as [t0, t1] ranges
function segOutside(a, b, h) {
  if (!h) return [[0, 1]];
  let t0 = 0, t1 = 1;
  for (const [o, d, lo, hi] of [[a[0], b[0] - a[0], h.u0, h.u1], [a[1], b[1] - a[1], h.v0, h.v1]]) {
    if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) return [[0, 1]]; continue; }
    let p = (lo - o) / d, q = (hi - o) / d; if (p > q) [p, q] = [q, p];
    t0 = Math.max(t0, p); t1 = Math.min(t1, q);
  }
  if (t0 >= t1) return [[0, 1]];
  return [[0, t0], [t1, 1]].filter(([p, q]) => q - p > 0.02);
}
const onSeg = (m, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1]], am = [m[0] - a[0], m[1] - a[1]], L2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = (am[0] * ab[0] + am[1] * ab[1]) / L2;
  return t > -EPS && t < 1 + EPS && Math.abs(am[0] * ab[1] - am[1] * ab[0]) / Math.sqrt(L2) < 2e-3;
};

// R: roof plan; M: MeshBuckets; L: look { facade, fcol, tile, soffit, fascia, gutter, metal } (colours are linear rgb);
// rnd: the building's random stream. Returns rubble spots for the collapsed part.
export function buildRoof(R, M, L, rnd) {
  const ax = R.axis === 'x', hip = R.kind === 'hip', wh = R.mat === 'metal_roof';
  // plan frame: u along the ridge, v across it
  const [u0, u1, v0, v1] = ax ? [R.x0, R.x1, R.z0, R.z1] : [R.z0, R.z1, R.x0, R.x1];
  const W = (u, v, y) => (ax ? [u, y, v] : [v, y, u]);
  const cv = (v0 + v1) / 2, { tan, t, yw, ov, vg, half, rise } = R;
  const H = R.hole && (ax ? { u0: R.hole.x0, u1: R.hole.x1, v0: R.hole.z0, v1: R.hole.z1 } : { u0: R.hole.z0, u1: R.hole.z1, v0: R.hole.x0, v1: R.hole.x1 });
  const cosA = 1 / Math.sqrt(1 + tan * tan);
  // planes: plan polygon, outward plan normal n (u, v), wall line d (n·p at the outer wall face); slope line
  // height hb = yw + (d - n·p) tan, tiles t above it. Edge tags: e (eave), g (verge), r (ridge / hip)
  const planes = [];
  if (!hip) {
    planes.push({ n: [0, 1], d: v1, P: [[u0 - vg, cv], [u1 + vg, cv], [u1 + vg, v1 + ov], [u0 - vg, v1 + ov]], tags: ['r', 'g', 'e', 'g'] });
    planes.push({ n: [0, -1], d: -v0, P: [[u0 - vg, v0 - ov], [u1 + vg, v0 - ov], [u1 + vg, cv], [u0 - vg, cv]], tags: ['e', 'g', 'r', 'g'] });
  } else {
    const ra = u0 + half, rb = u1 - half; // ridge ends (one point on a square house: a pyramid)
    if (rb - ra > EPS) {
      planes.push({ n: [0, 1], d: v1, P: [[ra, cv], [rb, cv], [u1 + ov, v1 + ov], [u0 - ov, v1 + ov]], tags: ['r', 'r', 'e', 'r'] });
      planes.push({ n: [0, -1], d: -v0, P: [[u0 - ov, v0 - ov], [u1 + ov, v0 - ov], [rb, cv], [ra, cv]], tags: ['e', 'r', 'r', 'r'] });
    } else {
      planes.push({ n: [0, 1], d: v1, P: [[ra, cv], [u1 + ov, v1 + ov], [u0 - ov, v1 + ov]], tags: ['r', 'e', 'r'] });
      planes.push({ n: [0, -1], d: -v0, P: [[u0 - ov, v0 - ov], [u1 + ov, v0 - ov], [ra, cv]], tags: ['e', 'r', 'r'] });
    }
    planes.push({ n: [1, 0], d: u1, P: [[u1 + ov, v0 - ov], [u1 + ov, v1 + ov], [rb, cv]], tags: ['e', 'r', 'r'] });
    planes.push({ n: [-1, 0], d: -u0, P: [[u0 - ov, v1 + ov], [u0 - ov, v0 - ov], [ra, cv]], tags: ['e', 'r', 'r'] });
  }
  // an edge of a piece that lies on the hole's outline (not on a seam between two pieces)
  const onHole = (m) => H && (((Math.abs(m[0] - H.u0) < 2e-3 || Math.abs(m[0] - H.u1) < 2e-3) && m[1] > H.v0 - 2e-3 && m[1] < H.v1 + 2e-3) ||
    ((Math.abs(m[1] - H.v0) < 2e-3 || Math.abs(m[1] - H.v1) < 2e-3) && m[0] > H.u0 - 2e-3 && m[0] < H.u1 + 2e-3));
  const tileMat = R.mat, deckCol = L.tile;
  for (const pl of planes) {
    const [nu, nv] = pl.n, nd = (p) => nu * p[0] + nv * p[1];
    const hb = (p) => yw + (pl.d - nd(p)) * tan;
    const up = norm(W(nu * tan, nv * tan, 1)); // tile surface normal
    const tangent = [-nv, nu]; // along the eave
    const eaveD = pl.d + ov;
    const uv = (p) => { const q = ax ? [p[0], p[2]] : [p[2], p[0]]; return [tangent[0] * q[0] + tangent[1] * q[1], (eaveD - nd(q)) / cosA]; };
    for (const Q of minusHole(pl.P, H)) {
      M.poly(tileMat, Q.map((q) => W(q[0], q[1], hb(q) + t)), up, uv, deckCol);
      M.poly('wood_paint', Q.map((q) => W(q[0], q[1], hb(q))), up.map((x) => -x), uv, L.soffit);
      // where the roof is open, the rafters under the rest of the deck show (every 0.6 m, under the boarding)
      if (H && !wh) {
        const ts = Q.map((q) => tangent[0] * q[0] + tangent[1] * q[1]), lo = Math.min(...ts), hi = Math.max(...ts);
        for (let s = Math.ceil((lo + 0.1) / 0.6) * 0.6; s < hi - 0.1; s += 0.6) {
          const line = clip(clip(Q, tangent[0], tangent[1], s + 0.01), -tangent[0], -tangent[1], -(s - 0.01));
          if (!line.length) continue;
          const ds = line.map((q) => nd(q)), dA = Math.min(...ds), dB = Math.min(Math.max(...ds), pl.d - 0.1);
          if (dB - dA < 0.3) continue;
          const pA = [tangent[0] * s + nu * dA, tangent[1] * s + nv * dA], pB = [tangent[0] * s + nu * dB, tangent[1] * s + nv * dB];
          beam(W(pA[0], pA[1], hb(pA) - 0.07), W(pB[0], pB[1], hb(pB) - 0.07), 0.06, 0.14, L.rafter);
        }
      }
      for (let i = 0; i < Q.length; i++) {
        const a = Q[i], b = Q[(i + 1) % Q.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const k = pl.P.findIndex((p, j) => onSeg(m, p, pl.P[(j + 1) % pl.P.length]));
        const tag = k >= 0 ? pl.tags[k] : onHole(m) ? 'c' : null;
        if (tag === 'e') eave(a, b, pl, hb);
        else if (tag === 'g') verge(a, b, pl, hb);
        else if (tag === 'c') {
          // broken edge of the deck (charred boards)
          const o = [m[0] - (Q.reduce((s, q) => s + q[0], 0) / Q.length), m[1] - (Q.reduce((s, q) => s + q[1], 0) / Q.length)];
          const en = norm(W(o[0], o[1], 0));
          M.flat('wood_paint', [W(a[0], a[1], hb(a) - 0.05), W(b[0], b[1], hb(b) - 0.05), W(b[0], b[1], hb(b) + t), W(a[0], a[1], hb(a) + t)], en, norm(sub(W(b[0], b[1], 0), W(a[0], a[1], 0))), [0, 1, 0], L.charred);
        }
      }
    }
    // a collapsed part: the rafters (along the slope, every 0.6 m) and some battens survive in the hole, broken off
    if (H) {
      const P = clip(clip(clip(clip(pl.P, -1, 0, -H.u0), 1, 0, H.u1), 0, -1, -H.v0), 0, 1, H.v1);
      if (P.length) {
        const ts = P.map((q) => tangent[0] * q[0] + tangent[1] * q[1]), lo = Math.min(...ts), hi = Math.max(...ts);
        for (let s = Math.ceil(lo / 0.6) * 0.6 + 0.3; s < hi - 0.1; s += 0.6) {
          if (rnd() < 0.35) continue;
          // the rafter's plan line inside the hole piece: from the ridge side toward the eave
          const line = clip(clip(P, tangent[0], tangent[1], s + 0.04), -tangent[0], -tangent[1], -(s - 0.04));
          if (!line.length) continue;
          const ds = line.map((q) => nd(q)), dA = Math.min(...ds), dB = Math.max(...ds);
          const keep = 0.25 + rnd() * 0.75, d1 = dA + (dB - dA) * keep;
          const pA = [tangent[0] * s + nu * dA, tangent[1] * s + nv * dA], pB = [tangent[0] * s + nu * d1, tangent[1] * s + nv * d1];
          const A = W(pA[0], pA[1], hb(pA) - 0.08), B = W(pB[0], pB[1], hb(pB) - 0.08 - (keep < 0.7 ? rnd() * 0.25 : 0));
          beam(A, B, 0.04, 0.07, L.charred);
          if (rnd() < 0.5) continue;
          // battens across the next rafter (tile laths)
          for (let k = 0.3; k < (d1 - dA) - 0.2; k += 0.35) if (rnd() < 0.45) {
            const pc = [tangent[0] * s + nu * (dA + k), tangent[1] * s + nv * (dA + k)], pe = [pc[0] + tangent[0] * 0.6, pc[1] + tangent[1] * 0.6];
            beam(W(pc[0], pc[1], hb(pc) + 0.01), W(pe[0], pe[1], hb(pe) + 0.01), 0.025, 0.02, L.charred);
          }
        }
      }
    }
  }

  // timber member from A to B (width w, height h; its height in the vertical plane through it)
  function beam(A, B, w, h, col, mat = 'wood_paint') {
    const d = sub(B, A), l = len(d); if (l < 0.05) return;
    const a = norm(d), side = norm(cross(a, [0, 1, 0])), upv = cross(side, a); // right-handed: a × upv = side
    M.obox(mat, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], a, upv, side, [l / 2, h / 2, w / 2], col);
  }

  // eave: fascia board, gutter, rafter tails under the soffit
  function eave(a, b, pl, hb) {
    const [nu, nv] = pl.n, y = hb(a);
    for (const [p, q] of segOutside(a, b, H).map(([s0, s1]) => [[a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0], [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1]])) {
      const A = W(p[0], p[1], 0), B = W(q[0], q[1], 0), along = norm(sub(B, A)), out = norm(W(nu, nv, 0)), c = [(A[0] + B[0]) / 2, 0, (A[2] + B[2]) / 2], l = len(sub(B, A)) / 2;
      const at = (dOut, dy) => [c[0] + out[0] * dOut, y + dy, c[2] + out[2] * dOut];
      const frame = (x, ...r) => { const z = cross(x, [0, 1, 0]); return dot(z, out) >= 0 ? [x, [0, 1, 0], z, ...r] : [x.map((k) => -k), [0, 1, 0], z.map((k) => -k), ...r]; };
      const [fx, fy2, fz] = frame(along);
      M.obox('wood_paint', at(-0.015, (t - 0.16) / 2), fx, fy2, fz, [l + 0.01, (t + 0.16) / 2, 0.015], L.fascia);
      // half-round gutter (as a small box) hanging off the fascia, 1 cm lower than the tiles' edge
      M.obox('metal_paint', at(0.06, -0.06), fx, fy2, fz, [l + 0.02, 0.05, 0.06], L.gutter);
      if (!wh) {
        // rafter tails every 0.9 m between the wall and the fascia, not at hip corners
        const n = Math.floor((2 * l - (hip ? 2 * ov + 0.6 : 0.4)) / 0.9);
        for (let k = 0; k < n; k++) {
          const s = -((n - 1) * 0.9) / 2 + k * 0.9;
          const p0 = [c[0] + along[0] * s - out[0] * (ov + 0.05), 0, c[2] + along[2] * s - out[2] * (ov + 0.05)];
          const p1 = [c[0] + along[0] * s - out[0] * 0.03, 0, c[2] + along[2] * s - out[2] * 0.03];
          p0[1] = y + (ov + 0.05) * tan - 0.065; p1[1] = y + 0.03 * tan - 0.065;
          beam(p0, p1, 0.07, 0.12, L.soffit);
        }
      }
    }
  }
  // verge (gable end): barge board along the sloped edge, hanging below the deck
  function verge(a, b, pl, hb) {
    const A = W(a[0], a[1], hb(a)), B = W(b[0], b[1], hb(b)), d = norm(sub(B, A));
    const outU = Math.sign(a[0] - (u0 + u1) / 2), out = norm(W(outU, 0, 0));
    let side = norm(cross(d, [0, 1, 0])); if (dot(side, out) < 0) side = side.map((k) => -k);
    const upv = cross(side, d), fix = dot(upv, [0, 1, 0]) < 0;
    const c = [(A[0] + B[0]) / 2 - out[0] * 0.015, (A[1] + B[1]) / 2 + (t - 0.18) / 2, (A[2] + B[2]) / 2 - out[2] * 0.015];
    M.obox('wood_paint', c, fix ? d.map((k) => -k) : d, fix ? upv.map((k) => -k) : upv, side, [len(sub(B, A)) / 2 + 0.01, (t + 0.18) / 2, 0.015], L.fascia);
  }

  // ridge and hip caps (half-round ridge tiles as a diamond-section beam, half sunk into the slope)
  const caps = [];
  if (!hip) caps.push([[u0 - vg, cv], [u1 + vg, cv]]);
  else {
    const ra = u0 + half, rb = u1 - half;
    if (rb - ra > 0.05) caps.push([[ra, cv], [rb, cv]]);
    caps.push([[u0 - ov, v0 - ov], [ra, cv]], [[u0 - ov, v1 + ov], [ra, cv]], [[u1 + ov, v0 - ov], [rb, cv]], [[u1 + ov, v1 + ov], [rb, cv]]);
  }
  const surf = (p) => yw + t + Math.min(half - Math.abs(p[1] - cv), hip ? Math.min(p[0] - u0, u1 - p[0]) : Infinity) * tan;
  for (const [a, b] of caps) for (const [s0, s1] of segOutside(a, b, H)) {
    const p = [a[0] + (b[0] - a[0]) * s0, a[1] + (b[1] - a[1]) * s0], q = [a[0] + (b[0] - a[0]) * s1, a[1] + (b[1] - a[1]) * s1];
    const A = W(p[0], p[1], surf(p) + 0.015), B = W(q[0], q[1], surf(q) + 0.015), d = norm(sub(B, A));
    const side = norm(cross([0, 1, 0], d)), upv = cross(d, side), r = wh ? 0.1 : 0.13;
    const e1 = norm([upv[0] + side[0], upv[1] + side[1], upv[2] + side[2]]), e2 = cross(d, e1);
    M.obox(wh ? tileMat : tileMat, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], d, e1, e2, [len(sub(B, A)) / 2 + 0.03, wh ? 0.05 : r, wh ? 0.05 : r], L.ridge);
  }

  // gable end walls: triangles on the end walls in the facade finish (cut where the roof came down)
  if (!hip) {
    for (const [uf, sgn] of [[u0, -1], [u1, 1]]) {
      const ui = uf - sgn * R.T;
      let tris = [[[v0, yw], [v1, yw], [cv, yw + rise]]];
      if (H && H.u0 < Math.max(uf, ui) && H.u1 > Math.min(uf, ui)) tris = minusHole(tris[0], { u0: H.v0, u1: H.v1, v0: -Infinity, v1: Infinity });
      for (const T of tris) {
        const outer = T.map(([v, y]) => W(uf, v, y)), inner = T.map(([v, y]) => W(ui, v, y));
        const on = norm(W(sgn, 0, 0)), tv = norm(W(0, 1, 0));
        M.poly(L.facade, outer, on, (p) => [dot(p, tv) * sgn, p[1]], L.fcol);
        M.poly(L.facade, inner, on.map((k) => -k), (p) => [dot(p, tv), p[1]], L.fcol);
        // broken ends of a cut gable
        for (let i = 0; i < T.length; i++) {
          const a = T[i], b = T[(i + 1) % T.length];
          if (Math.abs(a[0] - b[0]) > 1e-3 || (Math.abs(a[0] - (H?.v0 ?? NaN)) > 2e-3 && Math.abs(a[0] - (H?.v1 ?? NaN)) > 2e-3)) continue;
          const en = norm(W(0, a[0] - (T.reduce((s, q) => s + q[0], 0) / T.length), 0));
          M.flat(L.facade, [W(uf, a[0], a[1]), W(ui, a[0], a[1]), W(ui, b[0], b[1]), W(uf, b[0], b[1])], en, W(1, 0, 0), [0, 1, 0], L.fcol);
        }
      }
      // louvred vent in the gable (houses)
      if (!wh && (!H || !(H.u0 < uf + 1 && H.u1 > uf - 1))) {
        const c = W(uf + sgn * 0.02, cv, yw + rise * 0.42), o = norm(W(sgn, 0, 0)), x = norm(W(0, 1, 0));
        M.obox('wood_paint', c, x, [0, 1, 0], cross(x, [0, 1, 0]), [0.28, 0.3, 0.03], L.vent);
        M.obox('trim', [c[0], c[1] - 0.33, c[2]].map((k, i) => k + o[i] * 0.02), x, [0, 1, 0], cross(x, [0, 1, 0]), [0.34, 0.04, 0.05], L.trim);
      }
    }
  }

  // chimney: brick stack with a concrete cap and a dark flue
  if (R.chimney) {
    const c = R.chimney, base = yw;
    M.obox('brick_clean', [c.x, (base + c.top) / 2, c.z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [c.hx, (c.top - base) / 2, c.hz], L.chimney);
    M.obox('trim', [c.x, c.top + 0.04, c.z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [c.hx + 0.06, 0.04, c.hz + 0.06], L.trim);
    M.obox('wood_paint', [c.x, c.top + 0.1, c.z], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.1, 0.06, 0.1], L.charred);
  }

  // corrugated shed roofs: translucent sheet strips down each long slope
  if (wh) {
    for (const sgn of [1, -1]) for (let s = u0 + 2; s < u1 - 2.5; s += 4) {
      if (H && s + 1.2 > H.u0 && s < H.u1) continue;
      const va = sgn > 0 ? v1 - 0.4 : v0 + 0.4, vb = cv + sgn * 0.6, h = (v) => yw + (sgn > 0 ? v1 - v : v - v0) * tan + t + 0.012;
      const P = [[s, va], [s + 1.2, va], [s + 1.2, vb], [s, vb]].map(([u, v]) => W(u, v, h(v)));
      M.poly('skylight', P, norm(W(0, sgn * tan, 1)), (p) => { const q = ax ? [p[0], p[2]] : [p[2], p[0]]; return [q[0], Math.abs(q[1] - va) / cosA]; }, [1, 1, 1]);
    }
  }

  // rubble on the attic floor where the roof fell in
  const rubble = [];
  if (H) {
    const a = [Math.max(H.u0, u0 + 1), Math.max(H.v0, v0 + 1)], b = [Math.min(H.u1, u1 - 1), Math.min(H.v1, v1 - 1)];
    if (b[0] > a[0] && b[1] > a[1]) { const u = (a[0] + b[0]) / 2, v = (a[1] + b[1]) / 2, p = W(u, v, yw); rubble.push({ x: p[0], z: p[2], y: yw, n: 3 }); }
  }
  return { rubble };
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
