// Small allocation-free vector and quaternion helpers for the physics (no three.js, so the physics also runs in
// Node for the tests). Vectors are {x, y, z}; quaternions {x, y, z, w}.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { const l = this.length(); if (l > 1e-12) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  /** Remove the component along unit vector n. */
  projectOnPlane(n) { const d = this.dot(n); this.x -= n.x * d; this.y -= n.y * d; this.z -= n.z * d; return this; }
  applyQuat(q) {
    // v' = q v q*, the fast form
    const x = this.x, y = this.y, z = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  applyQuatInv(q) {
    const x = this.x, y = this.y, z = this.z, qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  normalize() {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    this.x /= l; this.y /= l; this.z /= l; this.w /= l; return this;
  }
  setFromAxisAngle(ax, ay, az, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = ax * s; this.y = ay * s; this.z = az * s; this.w = Math.cos(h); return this;
  }
  /** this = a * b */
  multiplyQuats(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  /** Integrate a world-frame angular velocity w over dt: q += 0.5 * (w, 0) * q * dt. */
  integrate(w, dt) {
    const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
    const x = this.x, y = this.y, z = this.z, qw = this.w;
    this.x += hx * qw + hy * z - hz * y;
    this.y += hy * qw + hz * x - hx * z;
    this.z += hz * qw + hx * y - hy * x;
    this.w += -hx * x - hy * y - hz * z;
    return this.normalize();
  }
  /** From an orthonormal basis: the images of the local x, y and z axes (the matrix columns). */
  setFromBasis(xa, ya, za) {
    const m00 = xa.x, m10 = xa.y, m20 = xa.z, m01 = ya.x, m11 = ya.y, m21 = ya.z, m02 = za.x, m12 = za.y, m22 = za.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      this.w = 0.25 / s; this.x = (m21 - m12) * s; this.y = (m02 - m20) * s; this.z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      this.w = (m21 - m12) / s; this.x = 0.25 * s; this.y = (m01 + m10) / s; this.z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      this.w = (m02 - m20) / s; this.x = (m01 + m10) / s; this.y = 0.25 * s; this.z = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      this.w = (m10 - m01) / s; this.x = (m02 + m20) / s; this.y = (m12 + m21) / s; this.z = 0.25 * s;
    }
    return this.normalize();
  }
  /** Rotation about world Y by yaw (radians); +yaw turns +Z (forward) toward +X. */
  setFromYaw(yaw) { return this.setFromAxisAngle(0, 1, 0, yaw); }
}

/** Solve A x = b in place for a small dense system (n x n, row-major Float64Array), Gaussian elimination with
 * partial pivoting. Returns false when singular. */
export function solveDense(A, b, n, x) {
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > best) { best = v; p = r; } }
    if (best < 1e-14) return false;
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    const inv = 1 / A[c * n + c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] * inv;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k];
    x[r] = s / A[r * n + r];
  }
  return true;
}
