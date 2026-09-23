// Lofted car-body surface generator.
// A body is described by keyframed profiles along its length (t: 0 = rear, 1 = front)
// and a cross-section that morphs between "hood/deck" and "cabin" shapes.
// The result is a smooth, continuous surface S(t, v) that can be meshed at any
// resolution (used for LODs) and sampled for surface patches (lights, grille...).
import * as THREE from 'three';

export function key(frames) {
  // frames: [[t, value], ...] sorted; smooth (cosine) interpolation between keys
  return (t) => {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      const [t1, v1] = frames[i];
      if (t <= t1) {
        const [t0, v0] = frames[i - 1];
        const k = (t - t0) / (t1 - t0);
        const s = k * k * (3 - 2 * k);
        return v0 + (v1 - v0) * s;
      }
    }
    return frames[frames.length - 1][1];
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (e0, e1, x) => { const k = clamp01((x - e0) / (e1 - e0)); return k * k * (3 - 2 * k); };

export class CarSurface {
  constructor(spec) {
    this.spec = spec;
    const s = spec;
    this.L = s.length;
    this.W = s.width;
    this.plan = key(s.planWidth);          // fraction of half width
    this.floor = key(s.floor);             // y of underbody
    this.sill = key(s.sill);               // y of rocker panel bottom
    this.belt = key(s.belt);               // y of beltline/hood/deck top edge
    this.shoulder = key(s.shoulder || [[0, 1], [1, 1]]); // width factor at shoulder
    this.green = key(s.greenhouse);        // 0 = no cabin, 1 = full cabin height
    this.roof = key(s.roof);               // roof height where greenhouse = 1
    this.crown = s.hoodCrown ?? 0.04;
    this.tumble = s.tumblehome ?? 0.78;
    this.wheels = s.wheels;                // [{z, r, w}]
    this.archClear = s.archClear ?? 0.045;
  }

  z(t) { return (t - 0.5) * this.L; }

  // wheel-arch factor (0..1) at longitudinal position z for the side panel
  arch(z) {
    let best = 0, archY = 0;
    for (const w of this.wheels) {
      const R = w.r + this.archClear + 0.02;
      const d = Math.abs(z - w.z);
      if (d < R) {
        const y = w.y + Math.sqrt(R * R - d * d); // top of arch circle at this z
        const f = 1;
        if (y > archY) { archY = y; best = f; }
      }
    }
    return { f: best, y: archY };
  }

  // Cross-section control points (right side, x >= 0) at parameter t.
  section(t) {
    const W2 = this.W / 2;
    const pw = this.plan(t) * W2;
    const z = this.z(t);
    const yF = this.floor(t);
    let yS = this.sill(t);
    const yB = this.belt(t);
    const g = clamp01(this.green(t));
    const yR = this.roof(t);
    const sh = this.shoulder(t);
    const a = this.arch(z);
    const pts = [];
    const archY = a.f ? Math.max(yS, Math.min(a.y, yB - 0.08)) : yS;
    const tireInner = this.wheels.length ? this.wheels[0].w + 0.06 : 0.3;
    // 0 floor center, 1 floor edge
    pts.push([0, yF]);
    pts.push([a.f ? Math.max(0.05, pw - tireInner) : pw * 0.9, a.f ? archY : yF]);
    // 2 rocker bottom / arch lip
    pts.push([pw * (a.f ? 1.0 : 0.965), a.f ? archY : yS]);
    // 3 lower body bulge
    const yLow = Math.max(a.f ? archY + 0.02 : yS + 0.1, lerp(yS, yB, 0.25));
    pts.push([pw, Math.min(yLow, yB - 0.06)]);
    // 4 mid side
    pts.push([pw * 1.0, lerp(Math.max(yLow, yS), yB, 0.62)]);
    // 5 shoulder
    pts.push([pw * 0.985 * sh, yB - 0.035]);
    // 6 beltline edge
    pts.push([pw * 0.94 * sh, yB]);
    // greenhouse / hood top morph
    const hoodW = pw * 0.9;
    const cabH = (yR - yB) * g;
    const wBase = lerp(hoodW, pw * 0.88, g);
    const wTop = lerp(pw * 0.62, pw * this.tumble, g);
    // 7 window base
    pts.push([wBase, yB + lerp(0.012, 0.03, g)]);
    // 8 window top
    pts.push([wTop, yB + lerp(this.crown * 0.55, cabH - 0.05, g)]);
    // 9 roof edge
    pts.push([lerp(pw * 0.33, pw * this.tumble * 0.86, g), yB + lerp(this.crown * 0.9, cabH - 0.008, g)]);
    // 10 roof / hood center
    pts.push([0, yB + lerp(this.crown, cabH + 0.012, g)]);
    return pts;
  }

  // Sample a point on the (right-hand, x>=0) surface. v in [0, 10] (control index, fractional).
  // Catmull-Rom interpolation through control points for a smooth cross-section.
  point(t, v, sec) {
    const P = sec || this.section(t);
    const n = P.length - 1;
    v = Math.max(0, Math.min(n, v));
    const i = Math.min(n - 1, Math.floor(v));
    const k = v - i;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
    const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * k + (2 * a - 5 * b + 4 * c - d) * k * k + (-a + 3 * b - 3 * c + d) * k * k * k);
    const x = cr(p0[0], p1[0], p2[0], p3[0]);
    const y = cr(p0[1], p1[1], p2[1], p3[1]);
    return new THREE.Vector3(Math.max(0, x), y, this.z(t));
  }

  normal(t, v, side = 1) {
    const e = 0.002;
    const p = this.point(t, v);
    const pt = this.point(Math.min(1, t + e), v).sub(this.point(Math.max(0, t - e), v));
    const pv = this.point(t, Math.min(10, v + 0.02)).sub(this.point(t, Math.max(0, v - 0.02)));
    const n = new THREE.Vector3().crossVectors(pv, pt).normalize();
    if (side < 0) n.x = -n.x;
    return { p: side < 0 ? p.clone().setX(-p.x) : p, n };
  }
}

// Non-uniform longitudinal station distribution: dense at the ends for rounded nose/tail.
export function stations(n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    // ease that concentrates samples near 0 and 1
    const t = 0.5 - 0.5 * Math.cos(Math.PI * u);
    out.push(lerp(u, t, 0.55));
  }
  return out;
}

// Build a mirrored mesh of the surface. `classify(t, vSeg)` returns a material index per quad.
// Produces a BufferGeometry with groups (one per material index), UV u = t, v = v/10.
export function buildSurface(surface, { nT = 48, vSub = 3, classify, tRange = [0, 1], vRange = [0, 10], offset = 0 }) {
  const ts = stations(nT).map((t) => lerp(tRange[0], tRange[1], t));
  const nV = Math.round((vRange[1] - vRange[0]) * vSub);
  const vs = [];
  for (let j = 0; j <= nV; j++) vs.push(lerp(vRange[0], vRange[1], j / nV));
  const cols = vs.length;
  const pos = [], uv = [];
  const grid = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    grid.push(base);
    for (const t of ts) {
      const sec = surface.section(t);
      for (const v of vs) {
        const p = surface.point(t, v, sec);
        if (offset) {
          const { n } = surface.normal(t, v, 1);
          p.addScaledVector(n, offset);
        }
        pos.push(p.x * side, p.y, p.z);
        uv.push(t, v / 10);
      }
    }
  }
  const byMat = new Map();
  for (let s = 0; s < 2; s++) {
    const base = grid[s];
    for (let i = 0; i < ts.length - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const tm = (ts[i] + ts[i + 1]) / 2, vm = (vs[j] + vs[j + 1]) / 2;
        const m = classify ? classify(tm, vm) : 0;
        if (m < 0) continue;
        const a = base + i * cols + j, b = base + (i + 1) * cols + j;
        const c = base + (i + 1) * cols + j + 1, d = base + i * cols + j + 1;
        if (!byMat.has(m)) byMat.set(m, []);
        const idx = byMat.get(m);
        if (s === 0) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const index = [];
  const mats = [...byMat.keys()].sort((a, b) => a - b);
  for (const m of mats) {
    const arr = byMat.get(m);
    geo.addGroup(index.length, arr.length, m);
    for (const x of arr) index.push(x);
  }
  geo.setIndex(index);
  geo.computeVertexNormals();
  // weld normals across the mirror seam (x = 0)
  fixSeamNormals(geo);
  return { geo, mats };
}

function fixSeamNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i)) < 1e-4) { n.setX(i, 0); const y = n.getY(i), z = n.getZ(i); const l = Math.hypot(y, z) || 1; n.setY(i, y / l); n.setZ(i, z / l); }
  }
}

// A patch of the surface (e.g. headlight lens) lifted slightly off the body.
export function buildPatch(surface, { t0, t1, v0, v1, nT = 8, nV = 6, lift = 0.004, side = 'both', shape }) {
  const pos = [], uv = [], index = [];
  const sides = side === 'both' ? [1, -1] : [side === 'right' ? 1 : -1];
  for (const s of sides) {
    const base = pos.length / 3;
    for (let i = 0; i <= nT; i++) {
      const t = lerp(t0, t1, i / nT);
      for (let j = 0; j <= nV; j++) {
        let v = lerp(v0, v1, j / nV);
        if (shape) v = shape(i / nT, j / nV, v);
        const { p, n } = surface.normal(t, v, 1);
        p.addScaledVector(n, lift);
        pos.push(p.x * s, p.y, p.z);
        uv.push(i / nT, j / nV);
      }
    }
    const cols = nV + 1;
    for (let i = 0; i < nT; i++) for (let j = 0; j < nV; j++) {
      const a = base + i * cols + j, b = base + (i + 1) * cols + j, c = b + 1, d = a + 1;
      if (s === 1) index.push(a, d, b, b, d, c); else index.push(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

export { lerp, clamp01, smooth };
