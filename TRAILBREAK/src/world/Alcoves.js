// Alcoves: where a canyon's wall comes down to its floor, water seeping out at the foot of a porous bed over a tighter
// one wears the softer rock back under the harder into an alcove, an arched hollow under an overhanging brow of rock
// (Mesa Verde's cliff dwellings stand in them; the National Park Service). The ground's grid can't hold an overhang,
// so an alcove is two things: its floor and back wall cut into the ground by the map's shaping (world/maps/canyon.js),
// and its roof built over them (render/Alcoves.js): a dome of rock whose underside comes down to a bank round the
// floor's edge. Here its shape, which both go by. Pure JS (the tests run it in Node).
//
// An alcove: { x, z (the middle of its opening, at the wall's foot), nx, nz (out of the wall), tx, tz (along it), W (half
// the opening's width), D (how deep it goes into the wall), H (the roof's height over the floor at the opening's
// middle), T (its thickness above that), S (how steep the wall is above it), base (the floor's height) }.

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How far past the dome's edge the ground is cut, across the opening and in (m): the ground's grid, a couple of
 * metres, would draw the step up to the wall in under the dome; past it, the roof (a flat ring out to there, its
 * top over it) hides it. */
export const ALCOVE_CUT = [2.5, 3];
/** How far out in front of its opening an alcove's floor is ramped into the ground before it (m). */
export const ALCOVE_RAMP = 6.5;

/**
 * Where (x, z) is in one of the alcoves (its cut and the ramp up to it, reach 1; farther out, more): { A, u (along
 * its opening), v (in from it), r (out to its dome's edge: 1), rc (out to its cut's) }, or null.
 */
export function alcoveAt(sites, x, z, reach = 1) {
  for (const A of sites) {
    const dx = x - A.x, dz = z - A.z, m = (A.W + A.D + 6) * reach + 4;
    if (Math.abs(dx) > m || Math.abs(dz) > m) continue;
    const u = dx * A.tx + dz * A.tz, v = -(dx * A.nx + dz * A.nz), vv = Math.max(0, v);
    const r = Math.hypot(u / A.W, vv / A.D), rc = Math.hypot(u / (A.W + ALCOVE_CUT[0]), vv / (A.D + ALCOVE_CUT[1]));
    if (rc < reach && v > -ALCOVE_RAMP * reach) return { A, u, v, r, rc };
  }
  return null;
}

/** The bank round an alcove's floor, up to its roof's edge (m over the floor), r out to its edge. */
export const alcoveBank = (r) => 5 * smoothstep(0.7, 1, r);

/** The underside of an alcove's roof over its floor (m), r out to its dome's edge: a dome, down to the top of the bank
 * (and on out flat over the cut past it). */
export const alcoveRoof = (A, r) => Math.max(A.H * Math.sqrt(Math.max(0, 1 - r * r)), alcoveBank(r) + 0.5);
