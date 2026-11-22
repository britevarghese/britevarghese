// Painting the maps' pictures in the game's idle time (ui/HUD.js drawRegion, paintFar): what keeps a turn of it short.

/** A turn's length (ms), and how often the clock is looked at: every SLICE + 1 pixels (a mask). */
export const SLICE_MS = 6, SLICE = 15;

/**
 * A picture's ground heights, each worked out once: fn(i, j), the height at pixel (i, j)'s middle, kept for the
 * pixels i0 .. i0 + w - 1 by j0 .. j0 + h - 1 and the ring of one pixel round them. A pixel's slope is the difference
 * of its neighbours' heights, which are those pixels' own: asked for afresh, every height was worked out three to five
 * times over, and the ground's height (the far land's above all: every map's landform, blended) is the dearest thing
 * the painting does.
 */
export function heightGrid(i0, j0, w, h, fn) {
  const W = w + 2, G = new Float64Array(W * (h + 2)).fill(NaN);
  return (i, j) => {
    const k = (j - j0 + 1) * W + (i - i0 + 1);
    let v = G[k];
    if (v !== v) v = G[k] = fn(i, j);
    return v;
  };
}

// A tree on a map's picture: dark green, half see-through (as 'rgba(42, 66, 32, 0.5)' over the ground).
const TREE = [42, 66, 32], TREE_ALPHA = 0.5;

/**
 * A tree mixed into a picture's pixels (data: RGBA bytes, w by h): a disc of radius r pixels at (cx, cy), pixels'
 * middles on the half, as a canvas draws one. A tree is smaller than a pixel on these pictures (8 m a pixel), so the
 * disc is its area shared among the four pixels round its middle, by how near each is: what an anti-aliased disc
 * that size comes to. A bigger one (r over a pixel) covers the pixels within r of it.
 */
export function splatTree(data, w, h, cx, cy, r) {
  if (r > 1) {
    const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(w - 1, Math.ceil(cx + r)), j0 = Math.max(0, Math.floor(cy - r)), j1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        // (the edge softened over a pixel)
        const a = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(i + 0.5 - cx, j + 0.5 - cy)));
        if (a > 0) mix(data, (j * w + i) * 4, TREE_ALPHA * a);
      }
    }
    return;
  }
  // its area (of a pixel's), shared out bilinearly round its middle
  const area = Math.PI * r * r, fx = cx - 0.5, fy = cy - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  for (let dj = 0; dj < 2; dj++) {
    for (let di = 0; di < 2; di++) {
      const a = (di ? u : 1 - u) * (dj ? v : 1 - v) * area, pi = i + di, pj = j + dj;
      if (a > 0.004 && pi >= 0 && pj >= 0 && pi < w && pj < h) mix(data, (pj * w + pi) * 4, TREE_ALPHA * a);
    }
  }
}

function mix(data, o, a) {
  if (a > 1) a = 1;
  data[o] += (TREE[0] - data[o]) * a; data[o + 1] += (TREE[1] - data[o + 1]) * a; data[o + 2] += (TREE[2] - data[o + 2]) * a;
}
