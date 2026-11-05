// A ground anchor for the winch where there's no tree in reach: the spare wheel buried as a deadman, flat in a trench
// dug across the line, the strap round it and out through a slot cut toward the truck. What holds it is the soil in
// front of it, pushed up and out in a wedge (its passive resistance, as Rankine has it for a wall pushed into earth:
// half gamma Kp H squared, and twice c root Kp H for the soil's cohesion, Kp = tan squared of 45 degrees and half its
// friction angle), over the face the wheel turns to the line: as wide as the wheel is across, as tall as its tread, its
// bottom 0.76 m down (30 in, as the field pull tests buried theirs). A short anchor drags more soil than its own width
// with it, the wedges at its ends: half as much again (a shape factor of 1.5, fitted to those tests: a stock spare in
// sand 30 in down held about half what a purpose-made deadman did, some 2,300 to 2,400 lb, 10.5 kN; in firm earth a
// buried spare holds 3,000 to 5,000 lb). So it holds best in firm earth, less in loose dry sand (no cohesion), little
// in soft mud (a very soft clay: the softer, the less), and not at all where there's rock, tarmac or water over the
// ground to dig in. Pulled harder than that it ploughs toward the truck, held back by the disturbed soil at 86% of it
// (the tests' sustained against their peak), and once it has ploughed out of its trench it's out of the ground
// (physics/Vehicle.js winchStep). Pure logic: runs in Node for the tests.
import { SURFACE, SURFACES } from '../physics/Surfaces.js';

/** How deep the bottom of the buried spare is (m). */
export const BURY = 0.76;
/** The soil wedges at a short anchor's ends: its hold half as much again as its face's alone. */
const SHAPE = 1.5;
/** How far it ploughs (m) before it's out of its trench. */
export const PLOUGH_OUT = 0.6;
/** The disturbed soil's hold, ploughing, against the undisturbed's. */
export const SUSTAIN = 0.86;

// the soils it can be dug into: unit weight (kN/m3), friction angle (degrees), cohesion (kPa); typical values: sand
// loose and dry, gravel, earth a firm sandy clay (the laterite and the forest floor under grass, tea and dirt), mud a
// very soft clay (its undrained strength, no friction to count on), snow settled
const SOIL = {
  [SURFACE.DIRT]: { g: 18, phi: 28, c: 10 },
  [SURFACE.GRASS]: { g: 18, phi: 28, c: 10 },
  [SURFACE.TEA]: { g: 17, phi: 28, c: 8 },
  [SURFACE.GRAVEL]: { g: 18, phi: 38, c: 0 },
  [SURFACE.SAND]: { g: 16, phi: 32, c: 0 },
  [SURFACE.MUD]: { g: 16, phi: 0, c: 12 },
  [SURFACE.SNOW]: { g: 4, phi: 20, c: 2 },
};

// (what it's dug into, in words)
const SOIL_NAME = { [SURFACE.DIRT]: 'earth', [SURFACE.GRASS]: 'earth under the turf', [SURFACE.TEA]: 'garden soil' };

/**
 * How hard (N) a spare wheel buried at a spot holds: its soil (a surface id), the wheel's size (d across, w its tread),
 * how soft the ground is there (World.js softness: a map's deep mud, a bog) and how wet (0 dry to 1 wet through: mud
 * softer, damp sand's grains bound by the water, earth weaker). null where it can't be dug in.
 */
export function anchorHold(surfaceId, { d = 0.8, w = 0.27, softness = 1, wet = 0 } = {}) {
  const s = SOIL[surfaceId];
  if (!s) return null;
  let c = s.c;
  if (surfaceId === SURFACE.MUD) c /= Math.max(1, softness) * (1 + 0.25 * wet);
  else if (surfaceId === SURFACE.SAND) c += 3 * wet;
  else c *= 1 - 0.4 * wet;
  const Kp = Math.tan(Math.PI / 4 + s.phi * Math.PI / 360) ** 2, Hb = BURY, Ht = BURY - Math.min(w, BURY);
  const perM = 0.5 * s.g * Kp * (Hb * Hb - Ht * Ht) + 2 * c * Math.sqrt(Kp) * (Hb - Ht);
  return 1000 * SHAPE * d * perM;
}

/**
 * Where to bury it: straight out ahead of the fairlead (fx, fz along dir), within the winch's reach, on the firmest
 * ground there (walking the line out to it), the farther of two as good. null if there's nowhere to dig. ground: the
 * world (surfaceId, softness, height, terrain, water, boulderTop); tyre: the truck's ({ radius, width }).
 */
export function pickAnchor(ground, fx, fz, dx, dz, reach, tyre = {}, wet = 0) {
  const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
  let best = null;
  for (let s = 6; s <= reach - 1.5; s += 1.5) {
    const x = fx + ux * s, z = fz + uz * s, h = ground.terrain ? ground.terrain(x, z) : ground.height(x, z);
    if (ground.water && ground.water(x, z) > h - 0.05) continue;                      // under water
    if (ground.boulderTop && ground.boulderTop(x, z) > h + 0.05) continue;            // a boulder
    const id = ground.surfaceId ? ground.surfaceId(x, z) : ground.surfaceAt(x, z).id;
    const hold = anchorHold(id, { d: 2 * (tyre.radius || 0.4), w: tyre.width || 0.27, softness: ground.softness ? ground.softness(x, z) : 1, wet });
    if (hold === null) continue;
    if (!best || hold >= best.hold * 0.97) best = { x, z, y: ground.height(x, z), hold, dist: s, surface: id, name: SOIL_NAME[id] || SURFACES[id].name };
  }
  return best;
}
