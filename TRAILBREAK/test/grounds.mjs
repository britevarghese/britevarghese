// Synthetic grounds for the physics tests: the same interface the game world provides (height, surfaceAt,
// optional deform / water / treesNear).
import { SURFACES, SURFACE, WET_SURFACES, WET_MUD } from '../src/physics/Surfaces.js';
import { DeformGrid } from '../src/world/Deform.js';
import { WornTracks, wearOf } from '../src/world/Worn.js';

export function flat(surface = SURFACE.DIRT, h = 0) {
  return { height: () => h, surfaceAt: () => SURFACES[surface] };
}

/** A plane rising toward +z (uphill) at `deg` degrees; with `side`, rising toward +x instead. */
export function slope(deg, surface = SURFACE.DIRT, side = false) {
  const t = Math.tan(deg * Math.PI / 180);
  return {
    height: (x, z) => (side ? x : z) * t,
    surfaceAt: () => SURFACES[surface],
  };
}

// the ruts pressed into a grid at the points across a tyre (world/World.js rutsAcross)
const across = (grid) => (x, z, ax, az, n, step, out) => {
  for (let k = -n; k <= n; k++) out[k + n] = grid.get(x + ax * k * step, z + az * k * step);
  return out;
};

/** Soft ground that keeps ruts (or firm ground a spinning tyre digs into); softness: a map's deep mud (world/World.js
 * softness), so much softer than its kind; wet: in the rain (World.js setRain). */
export function soft(surface = SURFACE.MUD, h = 0, softness = 1, wet = false) {
  const grid = new DeformGrid();
  const s = (wet ? WET_SURFACES : SURFACES)[surface];
  if (wet && surface === SURFACE.MUD) softness *= WET_MUD;
  return {
    grid,
    height: (x, z) => h - grid.get(x, z),
    surfaceAt: () => s,
    softness: () => softness,
    deform: (x, z, fx, fz, hw, hl, press, dig) => grid.stamp(x, z, fx, fz, hw, hl, press, dig, () => Math.max(s.maxSink * Math.sqrt(softness), s.loose || 0)),
    rutsAcross: across(grid),
  };
}

/** Soft ground that keeps ruts, rising toward +z at `deg` degrees. */
export function softSlope(deg, surface = SURFACE.SAND) {
  const grid = new DeformGrid();
  const s = SURFACES[surface], t = Math.tan(deg * Math.PI / 180);
  return {
    grid,
    height: (x, z) => z * t - grid.get(x, z),
    surfaceAt: () => s,
    deform: (x, z, fx, fz, hw, hl, press, dig) => grid.stamp(x, z, fx, fz, hw, hl, press, dig, () => Math.max(s.maxSink, s.loose || 0)),
    rutsAcross: across(grid),
  };
}

/** A worn track down z on firm ground: its two ruts (world/Worn.js), `depth` deep, either side of x = 0. */
export function worn(depth, surface = SURFACE.DIRT) {
  const s = SURFACES[surface];
  return {
    height: (x) => -WornTracks.profile(x, depth),
    surfaceAt: () => s,
    rutsAcross: (x, z, ax, az, n, step, out) => {
      for (let k = -n; k <= n; k++) out[k + n] = WornTracks.profile(x + ax * k * step, depth);
      return out;
    },
  };
}

/** A slope with pits (holes) at the given [x0, z0, x1, z1] rectangles. */
export function slopeWithPits(deg, pits, depth = 0.8, surface = SURFACE.DIRT) {
  const t = Math.tan(deg * Math.PI / 180);
  return {
    height: (x, z) => {
      let h = z * t;
      for (const [x0, z0, x1, z1] of pits) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return h - depth;
      return h;
    },
    surfaceAt: () => SURFACES[surface],
  };
}

/** Flat ground with a step (ledge) of height h starting at z = z0. */
export function ledge(z0, h, surface = SURFACE.ROCK) {
  return { height: (x, z) => (z >= z0 ? h : 0), surfaceAt: () => SURFACES[surface] };
}

/** A slope with ice on the given [x0, z0, x1, z1] rectangles (split friction). */
export function slopeWithIce(deg, patches, surface = SURFACE.DIRT) {
  const t = Math.tan(deg * Math.PI / 180);
  return {
    height: (x, z) => z * t,
    surfaceAt: (x, z) => {
      for (const [x0, z0, x1, z1] of patches) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return SURFACES[SURFACE.ICE];
      return SURFACES[surface];
    },
  };
}

/** Flat ground with a block of rock (x0..x1, z0..z1, h high) on it: a boulder between the wheels. */
export function block(x0, x1, z0, z1, h, surface = SURFACE.DIRT) {
  return {
    height: (x, z) => (x >= x0 && x <= x1 && z >= z0 && z <= z1 ? h : 0),
    surfaceAt: (x, z) => SURFACES[x >= x0 && x <= x1 && z >= z0 && z <= z1 ? SURFACE.ROCK : surface],
  };
}

/** Any ground under water at `level` (water(x, z) as the game world gives it). */
export function flooded(ground, level) {
  return { ...ground, water: () => level };
}

/**
 * A rough track (world/Worn.js rough: an old logging trail) straight down z through x = 0, worn into `surface`; rain:
 * with the rain standing in its holes (holeWater, as the game world gives it).
 */
export function rough(surface = SURFACE.DIRT, roughness = 1, rain = false) {
  const s = SURFACES[surface], wearAt = () => wearOf(surface);
  const G = new WornTracks({ trails: [{ name: 'rough', kind: 'trail', rough: roughness, points: [[0, -40], [0, 200], [0, 440]] }] }, 1000);
  const g = {
    worn: G,
    height: (x, z) => -G.depth(x, z, wearAt),
    surfaceAt: () => s,
    rutsAcross: (x, z, ax, az, n, step, out) => G.across(x, z, ax, az, n, step, out.fill(0), wearAt),
  };
  if (rain) g.holeWater = (x, z) => { const d = G.holeWater(x, z, wearAt); return d > 0 ? g.height(x, z) + d : -Infinity; };
  return g;
}
