// Boulder shapes: fractured blocks of rock, shared by the physics and the renderer so a tyre climbs the faces you
// see. Each shape is a radius along every direction from its centre, inside the unit sphere: a ball cut by a handful
// of flat fracture planes (soft-edged where they meet, as weathered rock is) and roughened with noise. A boulder is a
// shape stretched to its size (rx, ry, rz) and turned by its yaw; its index picks the shape.
//
// The physics needs the top of the rock under a point: each shape keeps a grid of its top surface over its footprint.
//
// Pure JS (the tests run it in Node).

import { vnoise } from './Noise.js';

export const ROCK_SHAPES = 8;
const TOP_N = 41;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth minimum (a rounded edge where two faces meet). */
function smin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

function makeShape(k) {
  const R = rng(9176 + k * 7919);
  const planes = [];
  const n = 7 + Math.floor(R() * 5);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, y = Math.min(0.97, -0.45 + R() * 1.5), h = Math.sqrt(1 - y * y);
    planes.push([Math.cos(a) * h, y, Math.sin(a) * h, 0.68 + R() * 0.24]);
  }
  // most blocks split along a flat-ish top
  if (R() < 0.7) { const a = R() * Math.PI * 2, t = 0.25 * R(); planes.push([Math.cos(a) * t, Math.sqrt(1 - t * t), Math.sin(a) * t, 0.74 + R() * 0.14]); }
  const seed = 31 + k * 17;
  const sx = R() * 10, sz = R() * 10;
  /** Distance from the centre to the surface along the unit direction (x, y, z). */
  const radius = (x, y, z) => {
    let r = 1;
    for (const [nx, ny, nz, c] of planes) {
      const d = x * nx + y * ny + z * nz;
      if (d > 0.02) r = smin(r, c / d, 0.045);
    }
    // weathered, lumpy faces
    const n1 = vnoise(x * 2.1 + y * 1.3 + sx, z * 2.1 - y * 1.1 + sz, seed);
    const n2 = vnoise(x * 5.3 - y * 2.9 + sz, z * 5.3 + y * 3.7 + sx, seed + 1);
    return r * (0.98 - 0.045 * n1 - 0.02 * n2);
  };
  // the top surface over the footprint, in units of the shape (u = x, v = z, both -1..1)
  const top = new Float32Array(TOP_N * TOP_N);
  for (let j = 0; j < TOP_N; j++) {
    for (let i = 0; i < TOP_N; i++) {
      const u = (i / (TOP_N - 1)) * 2 - 1, v = (j / (TOP_N - 1)) * 2 - 1;
      top[j * TOP_N + i] = u * u + v * v >= 1 ? -1 : topAt(radius, u, v);
    }
  }
  return { radius, top };
}

/** Highest y with (u, y, v) inside the rock, or -1. */
function topAt(radius, u, v) {
  const inside = (y) => { const l = Math.hypot(u, y, v); return l < 1e-6 || l <= radius(u / l, y / l, v / l); };
  let hi = 1;
  for (let y = 1; y >= -1; y -= 0.025) {
    if (inside(y)) {
      let lo = y;
      for (let it = 0; it < 12; it++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
      return lo;
    }
    hi = y;
  }
  return -1;
}

const SHAPES = [];
/** Shape k (made once, then kept). */
export function rockShape(k) {
  k = ((k % ROCK_SHAPES) + ROCK_SHAPES) % ROCK_SHAPES;
  return SHAPES[k] || (SHAPES[k] = makeShape(k));
}

/** Top of shape k above the point (u, v) of its footprint (both in -1..1), in units of its height; -1 off the rock. */
export function rockTop(k, u, v) {
  const t = rockShape(k).top;
  const fx = (u + 1) * 0.5 * (TOP_N - 1), fz = (v + 1) * 0.5 * (TOP_N - 1);
  if (fx < 0 || fz < 0 || fx > TOP_N - 1 || fz > TOP_N - 1) return -1;
  const i = Math.min(TOP_N - 2, Math.floor(fx)), j = Math.min(TOP_N - 2, Math.floor(fz)), tx = fx - i, tz = fz - j;
  const o = j * TOP_N + i;
  return (t[o] * (1 - tx) + t[o + 1] * tx) * (1 - tz) + (t[o + TOP_N] * (1 - tx) + t[o + TOP_N + 1] * tx) * tz;
}

/** Which shape a boulder is. */
export const shapeOf = (index) => index % ROCK_SHAPES;
