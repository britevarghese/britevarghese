// A car model's own steering wheel. The imported models have their meshes merged, so the wheel can't be picked
// by name: it is found in the geometry instead, as the ring 14-27 cm in radius in front of the driver's eyes,
// facing him (RANSAC circle fits over the vertices there). Then its triangles can be lifted out of the car into a
// part of their own that turns with the steering, the driver's hands with it.
// All in the car body's space: +Z forward, +X left, y up.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4();

// the model's triangles in front of the driver, split into connected parts (vertices welded at 2 mm: the rim is a
// part of its own, or a few), each a flat array of its vertices; and all their vertices together
function parts(root, body, keep) {
  const inv = new THREE.Matrix4().copy(body.matrixWorld).invert(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const id = new Map(), pos = [], parent = [];
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const node = (p) => { const k = Math.round(p.x * 500) + ',' + Math.round(p.y * 500) + ',' + Math.round(p.z * 500); let i = id.get(k); if (i === undefined) { i = parent.length; id.set(k, i); parent.push(i); pos.push(p.x, p.y, p.z); } return i; };
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes.position) return;
    _m.multiplyMatrices(inv, o.matrixWorld);
    const P = o.geometry.attributes.position, I = o.geometry.index, tris = (I ? I.count : P.count) / 3;
    for (let t = 0; t < tris; t++) {
      A.fromBufferAttribute(P, I ? I.getX(t * 3) : t * 3).applyMatrix4(_m); if (!keep(A)) continue;
      B.fromBufferAttribute(P, I ? I.getX(t * 3 + 1) : t * 3 + 1).applyMatrix4(_m); if (!keep(B)) continue;
      C.fromBufferAttribute(P, I ? I.getX(t * 3 + 2) : t * 3 + 2).applyMatrix4(_m); if (!keep(C)) continue;
      const a = find(node(A)), b = find(node(B)), c = find(node(C));
      parent[b] = a; parent[find(c)] = a;
    }
  });
  const groups = new Map();
  for (let i = 0; i < parent.length; i++) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
  return { all: pos, parts: [...groups.values()].filter((g) => g.length >= 60 * 3) };
}

/** { hub, axis (towards the driver), R } of the model's steering wheel, or null if no convincing ring is found. */
export function fitSteeringWheel(root, body, eye) {
  body.updateWorldMatrix(true, true);
  const { all, parts: pieces } = parts(root, body, (p) => Math.abs(p.x - eye.x) < 0.32 && p.y - eye.y < -0.02 && p.y - eye.y > -0.8 && p.z - eye.z > 0.12 && p.z - eye.z < 1.0);
  let n = all.length / 3;
  if (n < 60 || !pieces.length) return null;
  // (a fixed sequence: the same car fits the same every time)
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const S = Math.min(n, 8000), pts = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) { const k = n > S ? (rnd() * n) | 0 : i; pts[i * 3] = all[k * 3]; pts[i * 3 + 1] = all[k * 3 + 1]; pts[i * 3 + 2] = all[k * 3 + 2]; }
  n = S;
  const P = (i, out) => out.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const ab = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), q = new THREE.Vector3();
  const BINS = 16, bins = new Uint8Array(BINS);
  let best = null;
  // inliers of a ring (centre C, normal N, radius R): within 2.2 cm of it; how far round it they reach
  const score = (R, out) => {
    e1.set(1, 0, 0).addScaledVector(N, -N.x); if (e1.lengthSq() < 0.1) e1.set(0, 1, 0).addScaledVector(N, -N.y); e1.normalize(); e2.crossVectors(N, e1);
    bins.fill(0); let cnt = 0, sr = 0, sh = 0;
    for (let i = 0; i < n; i++) {
      P(i, q).sub(C); const h = q.dot(N); q.addScaledVector(N, -h); const r = q.length();
      if (h * h + (r - R) * (r - R) > 0.022 * 0.022) continue;
      cnt++; sr += r; sh += h;
      bins[(((Math.atan2(q.dot(e2), q.dot(e1)) / (Math.PI * 2) + 1) * BINS) | 0) % BINS] = 1;
    }
    let cov = 0; for (const x of bins) cov += x;
    if (out) { out.r = cnt ? sr / cnt : R; out.h = cnt ? sh / cnt : 0; }
    return { cnt, cov: cov / BINS };
  };
  // ring hypotheses from each part's own points (three of them at a time), each scored against all the points
  const hyps = [];
  // (a budget of ~2e7 point tests: a low-poly cabin, whose rim has few points, gets many more tries)
  const per = Math.max(240, Math.min(4000, Math.round(2e7 / n / pieces.length)));
  for (const g of pieces) { const m = g.length / 3; for (let it = 0; it < Math.min(per, m * 8); it++) hyps.push([g, (rnd() * m) | 0, (rnd() * m) | 0, (rnd() * m) | 0]); }
  for (const [g, i1, i2, i3] of hyps) {
    p1.set(g[i1 * 3], g[i1 * 3 + 1], g[i1 * 3 + 2]); p2.set(g[i2 * 3], g[i2 * 3 + 1], g[i2 * 3 + 2]); p3.set(g[i3 * 3], g[i3 * 3 + 1], g[i3 * 3 + 2]);
    a.subVectors(p1, p3); b.subVectors(p2, p3); ab.crossVectors(a, b);
    const l2 = ab.lengthSq();
    if (l2 < 1e-8) continue;
    // the circle through the three points
    C.copy(b).multiplyScalar(a.lengthSq()).addScaledVector(a, -b.lengthSq()).cross(ab).divideScalar(2 * l2).add(p3);
    const R = C.distanceTo(p3);
    if (R < 0.14 || R > 0.27) continue; // (a car's wheel ~19 cm, a bus's ~25)
    if (Math.abs(C.x - eye.x) > 0.1 || C.z - eye.z < 0.25 || C.z - eye.z > 0.85 || C.y - eye.y > -0.08 || C.y - eye.y < -0.6) continue;
    N.copy(ab).normalize();
    _w.subVectors(eye, C).normalize();
    if (N.dot(_w) < 0) N.negate();
    if (N.dot(_w) < 0.5 || N.z > -0.4) continue; // facing the driver: towards the back of the car, somewhat up
    const s = score(R);
    if (s.cov < 0.6) continue;
    const val = s.cnt * s.cov * s.cov;
    if (!best || val > best.val) best = { val, C: C.clone(), N: N.clone(), R, cnt: s.cnt, cov: s.cov };
  }
  if (!best || best.cnt < 40) return null;
  // refined by least squares on the points near the ring: their plane (the least-spread direction), then the
  // circle through them in it (three random points only roughly agree with the rim)
  const hub = best.C.clone(), axis = best.N.clone(); let R = best.R;
  for (let pass = 0, tol = 0.03; pass < 4; pass++, tol *= 0.8) {
    const ins = [];
    for (let i = 0; i < n; i++) { P(i, q).sub(hub); const h = q.dot(axis); q.addScaledVector(axis, -h); const r = q.length(); if (h * h + (r - R) * (r - R) < tol * tol) ins.push(i); }
    if (ins.length < 30) break;
    const m = new THREE.Vector3(); for (const i of ins) m.add(P(i, q)); m.divideScalar(ins.length);
    const cov = [0, 0, 0, 0, 0, 0]; // xx yy zz xy xz yz
    for (const i of ins) { P(i, q).sub(m); cov[0] += q.x * q.x; cov[1] += q.y * q.y; cov[2] += q.z * q.z; cov[3] += q.x * q.y; cov[4] += q.x * q.z; cov[5] += q.y * q.z; }
    const nn = leastAxis(cov); if (nn.dot(axis) < 0) nn.negate();
    if (nn.dot(_w.subVectors(eye, m).normalize()) < 0.5) break;
    axis.copy(nn);
    e1.set(1, 0, 0).addScaledVector(axis, -axis.x); if (e1.lengthSq() < 0.1) e1.set(0, 1, 0).addScaledVector(axis, -axis.y); e1.normalize(); e2.crossVectors(axis, e1);
    // Kasa circle fit in the plane: x^2 + y^2 + D x + E y + F = 0
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, szx = 0, szy = 0;
    for (const i of ins) { P(i, q).sub(m); const x = q.dot(e1), y = q.dot(e2), z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; szx += z * x; szy += z * y; }
    const k = ins.length, A3 = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, k);
    if (Math.abs(A3.determinant()) < 1e-12) break;
    const sol = new THREE.Vector3(-szx, -szy, -sz).applyMatrix3(A3.invert());
    const cx = -sol.x / 2, cy = -sol.y / 2, R2 = cx * cx + cy * cy - sol.z;
    if (!(R2 > 0.12 * 0.12 && R2 < 0.29 * 0.29)) break;
    hub.copy(m).addScaledVector(e1, cx).addScaledVector(e2, cy); R = Math.sqrt(R2);
  }
  C.copy(hub); N.copy(axis);
  const s = score(R);
  if (s.cov >= Math.max(0.6, best.cov - 0.07)) return { hub, axis, R, cov: s.cov, cnt: s.cnt };
  // (the refinement wandered off onto something else: the ring as first found, on its centre line)
  C.copy(best.C); N.copy(best.N);
  const mm = {}; score(best.R, mm);
  return { hub: best.C.clone().addScaledVector(best.N, mm.h), axis: best.N.clone(), R: mm.r, cov: best.cov, cnt: best.cnt };
}

// the direction of least spread of a point set: the smallest eigenvector of its covariance [xx yy zz xy xz yz] (Jacobi)
function leastAxis([xx, yy, zz, xy, xz, yz]) {
  const A = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 12; sweep++) {
    for (const [p, r] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][r]) < 1e-14) continue;
      const th = 0.5 * Math.atan2(2 * A[p][r], A[r][r] - A[p][p]), c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) { const ap = A[k][p], ar = A[k][r]; A[k][p] = c * ap - s * ar; A[k][r] = s * ap + c * ar; }
      for (let k = 0; k < 3; k++) { const ap = A[p][k], ar = A[r][k]; A[p][k] = c * ap - s * ar; A[r][k] = s * ap + c * ar; }
      for (let k = 0; k < 3; k++) { const vp = V[k][p], vr = V[k][r]; V[k][p] = c * vp - s * vr; V[k][r] = s * vp + c * vr; }
    }
  }
  const i = [0, 1, 2].reduce((b, k) => (A[k][k] < A[b][b] ? k : b), 0);
  return new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize();
}

/**
 * Lift the wheel (rim, spokes, boss: the triangles within its disc) out of the model's meshes into a part of its
 * own, `holder` (at the hub, local x = -right0, y = up0, z = -axis) with `spin` inside turning about its local z.
 * The meshes it came out of get their own copies of their geometry first (others of the model share them).
 */
export function detachSteeringWheel(root, body, { hub, axis, up0, right0, R }) {
  body.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const basis = new THREE.Matrix4().makeBasis(right0.clone().negate(), up0, axis.clone().negate()).setPosition(hub);
  const toLocal = basis.clone().invert();
  const holder = new THREE.Group(); holder.name = 'steering_wheel';
  holder.position.copy(hub); holder.quaternion.setFromRotationMatrix(basis);
  const spin = new THREE.Group(); holder.add(spin);
  const meshes = []; root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && o.geometry?.attributes.position) meshes.push(o); });
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cen = new THREE.Vector3();
  const inDisc = (p, slack) => { _w.subVectors(p, hub); const h = _w.dot(axis); _w.addScaledVector(axis, -h); return h > -0.09 && h < 0.06 && _w.length() < R + slack; };
  let moved = 0;
  for (const o of meshes) {
    const g = o.geometry, Pa = g.attributes.position, I = g.index, tris = (I ? I.count : Pa.count) / 3;
    const M = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), vi = (t, k) => (I ? I.getX(t * 3 + k) : t * 3 + k);
    const take = [];
    for (let t = 0; t < tris; t++) {
      a.fromBufferAttribute(Pa, vi(t, 0)).applyMatrix4(M); b.fromBufferAttribute(Pa, vi(t, 1)).applyMatrix4(M); c.fromBufferAttribute(Pa, vi(t, 2)).applyMatrix4(M);
      cen.copy(a).add(b).add(c).divideScalar(3);
      if (inDisc(cen, 0.035) && inDisc(a, 0.06) && inDisc(b, 0.06) && inDisc(c, 0.06)) take.push(t);
    }
    if (!take.length) continue;
    moved += take.length;
    // the triangles, in the holder's frame, with every attribute; material groups kept
    const L = new THREE.Matrix4().multiplyMatrices(toLocal, M), NL = new THREE.Matrix3().getNormalMatrix(L);
    const groupOf = (t) => { for (let k = 0; k < g.groups.length; k++) { const gr = g.groups[k]; if (t * 3 >= gr.start && t * 3 < gr.start + gr.count) return gr.materialIndex ?? k; } return 0; };
    const multi = Array.isArray(o.material) && g.groups.length;
    if (multi) take.sort((x, y) => groupOf(x) - groupOf(y));
    const ng = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const sz = attr.itemSize, arr = new Float32Array(take.length * 3 * sz);
      take.forEach((t, j) => { for (let k = 0; k < 3; k++) { const s = vi(t, k); for (let e = 0; e < sz; e++) arr[(j * 3 + k) * sz + e] = attr.getComponent(s, e); } });
      const na = new THREE.BufferAttribute(arr, sz);
      if (name === 'position') na.applyMatrix4(L);
      else if (name === 'normal') na.applyNormalMatrix(NL);
      else if (name === 'tangent') { for (let i = 0; i < na.count; i++) { _v.set(na.getX(i), na.getY(i), na.getZ(i)).transformDirection(L); na.setXYZ(i, _v.x, _v.y, _v.z); } }
      ng.setAttribute(name, na);
    }
    if (multi) { let s = 0; take.forEach((t, j) => { const m = groupOf(t), last = j === take.length - 1 || groupOf(take[j + 1]) !== m; if (last) { ng.addGroup(s * 3, (j + 1 - s) * 3, m); s = j + 1; } }); }
    const mesh = new THREE.Mesh(ng, o.material); mesh.name = 'steering_wheel_part'; mesh.castShadow = o.castShadow; mesh.receiveShadow = o.receiveShadow;
    spin.add(mesh);
    // out of the car: degenerate triangles in its own copy of the geometry
    if (!o.userData.ownGeometry) { o.geometry = g.clone(); o.userData.ownGeometry = true; }
    const g2 = o.geometry;
    if (g2.index) { const ix = g2.index; for (const t of take) { const v0 = ix.getX(t * 3); ix.setX(t * 3 + 1, v0); ix.setX(t * 3 + 2, v0); } ix.needsUpdate = true; }
    else { const pa = g2.attributes.position; for (const t of take) for (let k = 1; k < 3; k++) pa.setXYZ(t * 3 + k, pa.getX(t * 3), pa.getY(t * 3), pa.getZ(t * 3)); pa.needsUpdate = true; }
  }
  return moved ? { holder, spin, moved } : null;
}
