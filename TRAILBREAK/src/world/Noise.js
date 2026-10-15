// Deterministic noise for the terrain (pure math, identical on every client so everyone drives the same valley).

export function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1) with quintic smoothing. */
export function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

/** Fractal sum in [-1, 1]-ish. */
export function fbm(x, z, octaves, seed = 0, lac = 2.03, gain = 0.5) {
  let s = 0, amp = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += (vnoise(x, z, seed + i * 17) * 2 - 1) * amp;
    norm += amp; amp *= gain; x *= lac; z *= lac;
  }
  return s / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests, for mountains. */
export function ridged(x, z, octaves, seed = 0) {
  let s = 0, amp = 0.5, w = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(vnoise(x, z, seed + i * 31) * 2 - 1);
    n *= n;
    n *= w;
    w = Math.min(1, n * 2);
    s += n * amp; norm += amp;
    amp *= 0.5; x *= 2.07; z *= 2.07;
  }
  return s / norm;
}

/** Small seeded PRNG (mulberry32) for placing things. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
