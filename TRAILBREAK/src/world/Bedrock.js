// Bedrock: the relief of bare rock (a map's rockRelief), as a rocky hill's rock is built. It lies in beds a metre or so
// thick (their planes wavering over the hill), and where the beds come out on a slope each one stands out as a ledge
// over the recess at the foot of the one above, so a steep face goes up in steps and a gentler one in low stair steps
// across it, and every few beds a bench stands out farther; and it is cut by joints, two sets of near-vertical cracks
// running through a few beds at a time, each run with its own spacing, wandering, into blocks.
// (Rock's outline is set by its joints, its steps by its bedding: e.g. Migoń et al. on the tors of central Europe.)
//
// Too fine for the ground's grid, so it is reckoned at each point, the same here (the physics, world/World.js; the
// ground's vertices, render/Terrain.js) as in the terrain's shader (BEDROCK_GLSL), whose noise this copies exactly: a
// face is lit by the same ledges its vertices are moved by. Reckoned in the map's own frame, from the ground's height
// before it (its base).
import { HASH21 } from '../render/ShaderHash.js';

/** The shader's hash (render/ShaderHash.js), bit for bit: a lattice point to [0, 1). */
export function hash21(x, z) {
  let a = Math.floor(x * 64) | 0, b = Math.floor(z * 64) | 0;
  a = (Math.imul(a, 1664525) + 1013904223) | 0; b = (Math.imul(b, 1664525) + 1013904223) | 0;
  a = (a + Math.imul(b, 1664525)) | 0; b = (b + Math.imul(a, 1664525)) | 0;
  a ^= a >>> 16; b ^= b >>> 16;
  a = (a + Math.imul(b, 1664525)) | 0; b = (b + Math.imul(a, 1664525)) | 0;
  a ^= a >>> 16; b ^= b >>> 16;
  return ((a ^ b) >>> 8) / 16777216;
}

/** The shader's value noise tn (smoothstep between the lattice's hashes). */
export function tn(x, z) {
  const i = Math.floor(x), k = Math.floor(z), fx = x - i, fz = z - k;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash21(i, k), b = hash21(i + 1, k), c = hash21(i, k + 1), d = hash21(i + 1, k + 1);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);

/** Which bed (its index, and how far up it: 0 to 1) the rock at (x, y, z) is in. */
export function bedAt(x, y, z) {
  return y / 1.3 + tn(y / 3.7, 5) * 1.2 + tn(y / 1.9, 9) * 0.3 + tn(x / 9, z / 9) * 1.6 + tn(x / 3.1, z / 3.1) * 0.35;
}

/** Which run of beds a joint runs through (three beds; the joints of a massive rock cut through several). */
export const jointUnit = (bed) => Math.floor((bed + 0.5) / 3);

/**
 * A joint set's crack across `along` in joint unit `unit` (jointUnit): 1 in the crack, 0 in the block (w: how much
 * wider it is drawn).
 */
export function joint(along, unit, w = 0) {
  return sstep(0.42 - w * 0.2, 0.5, Math.abs(fract(along / (2 + hash21(unit, 7) * 2.5) + hash21(unit, 3)) - 0.5));
}

/** A bench (every four beds, about five metres): how far it stands out at bed coordinate s (as bedAt's), on a face. */
export function bench(s) {
  const sb = s / 4 + 0.37, b = Math.floor(sb), f = sb - b;
  return sstep(0, 0.45, f) * (1 - 0.5 * f) * (1 - sstep(0.55, 1, f)) * (0.5 + 0.8 * hash21(b, 17)) * 0.5;
}

/**
 * How far the rock at (x, y, z) stands out of its face (m) and how it is shaded: each bed a ledge, jutting out over the
 * recess at its foot and leaning back to a shelf under the bed above, and on a face its benches; its blocks between
 * the joints standing a little proud or sunk, the cracks between them open, and rough. ax: how far the face runs along
 * x and along z (weights). slab: how gentle the ground is (0 a face, 1 a slab: there the blocks show more than the
 * ledges). w: as joint's.
 */
export function rockOut(x, y, z, ax, az, slab = 0, w = 0) {
  // (k: how far the bed's ledge stands out; a fifth of the beds weather flush, with none, so that the beds either
  // side of one stand as a thicker unit and the steps don't come in an even rhythm)
  const s = bedAt(x, y, z), f = s - Math.floor(s), bed = Math.floor(s), k = Math.max(0, 1.7 * hash21(bed, 11) - 0.35);
  const ledge = sstep(0, 0.32 + w, f) * (1 - 0.6 * f) * (1 - sstep(0.8 - w, 1, f)) * k;
  // (the joints wander as real ones do, rather than ruling the rock into a grid, and lie closer together here and
  // farther apart there: from about half their spacing to six times it, never crossing)
  // (and run through a few beds at a time, rather than each bed's offset from the next like courses of bricks)
  const ju = jointUnit(bed);
  const wx = x + (tn(z / 4.3 + ju, 1.7) - 0.5) * 2.4 + (tn(x / 5.3 + ju * 0.7, 4.1) - 0.5) * 3;
  const wz = z + (tn(x / 4.3 + ju, 6.1) - 0.5) * 2.4 + (tn(z / 5.3 + ju * 0.7, 8.7) - 0.5) * 3;
  const jx = joint(wx, ju, w), jz = joint(wz, ju, w);
  // (on a face, the set running across it: on one lying askew to both, each shows faintly rather than crossing in
  // diamonds)
  const jt = (jx * ax + jz * az) * (0.35 + 0.65 * Math.abs(ax - az));
  // (on a slab both joint sets cut it, into blocks, each a little higher or lower than the next)
  const cut = Math.max(jx, jz) * slab + jt * (1 - slab);
  const px = 2 + hash21(ju, 7) * 2.5, block = hash21(Math.floor(wx / px + hash21(ju, 3)) + bed * 7, Math.floor(wz / px + hash21(ju, 3)) + 13);
  const out = ledge * 0.5 + tn(x * 1.7 + y, z * 1.7 + y) * 0.06 + slab * (block - 0.5) * 0.16 - cut * 0.09 + bench(s) * (1 - slab);
  const shade = (1 - 0.4 * Math.min(1, k) * (1 - sstep(0, 0.2 + w, f)) * (1 - 0.7 * slab)) * (1 - 0.25 * jt) * (1 - 0.3 * cut * slab);
  return { out, shade };
}

// (how far the rock stands out on the whole, but for its benches, and they: what is taken off, so it stands as much
// proud of the ground's line as sunk below it, and meets the ground round it without a step)
const MEAN_OUT = 0.096, MEAN_BENCH = 0.186;

/**
 * rockOut's `out` but for the benches, as fast as it can be had (the physics asks it at every wheel's every ray), and
 * as the ground's vertices, half a metre apart, can draw it: its ledges' lips and its cracks rounded off, its
 * roughness left to the lighting (drawn sharper, they stood out of the ground's outline in steps up close).
 */
function outAt(x, y, z, s, ax, slab) {
  const bed = Math.floor(s), f = s - bed, k = Math.max(0, 1.7 * hash21(bed, 11) - 0.35);
  const e0 = Math.min(1, f / 0.5), e1 = Math.max(0, (f - 0.6) / 0.4);
  const ledge = e0 * e0 * (3 - 2 * e0) * (1 - 0.6 * f) * (1 - e1 * e1 * (3 - 2 * e1)) * k;
  const ju = Math.floor((bed + 0.5) / 3), P = 2 + hash21(ju, 7) * 2.5, O = hash21(ju, 3);
  const ux = (x + (tn(z / 4.3 + ju, 1.7) - 0.5) * 2.4 + (tn(x / 5.3 + ju * 0.7, 4.1) - 0.5) * 3) / P + O;
  const uz = (z + (tn(x / 4.3 + ju, 6.1) - 0.5) * 2.4 + (tn(z / 5.3 + ju * 0.7, 8.7) - 0.5) * 3) / P + O;
  let jx = Math.min(1, Math.max(0, (Math.abs(ux - Math.floor(ux) - 0.5) - 0.34) / 0.16)), jz = Math.min(1, Math.max(0, (Math.abs(uz - Math.floor(uz) - 0.5) - 0.34) / 0.16));
  jx = jx * jx * (3 - 2 * jx); jz = jz * jz * (3 - 2 * jz);
  const cut = (jx > jz ? jx : jz) * slab + (jx * ax + jz * (1 - ax)) * (0.35 + 0.65 * Math.abs(2 * ax - 1)) * (1 - slab);
  const block = slab > 0 ? hash21(Math.floor(ux) + bed * 7, Math.floor(uz) + 13) : 0.5;
  return ledge * 0.5 + 0.03 + slab * (block - 0.5) * 0.16 - cut * 0.09;
}

/**
 * The height the rock's relief adds at (x, z) (m), for ground of base height y with slope (gx, gz) (rise over run):
 * its standing out of the face along the face's normal, so that much higher on it the steeper it is, less of it on a
 * slab (its stair steps 10 to 20 cm, a face's ledges and benches up to half a metre), as much below the ground's line
 * as above it. What the ground's vertices (half a metre apart at the finest) could not draw is left to its lighting
 * (the shader's), as drawn it was a zigzag: the ledges up a face steeper than about 35 degrees, where they come too
 * close across it, and the benches up one steeper than about 60.
 */
export function rockLift(x, y, z, gx, gz) {
  const s2 = gx * gx + gz * gz, sl = Math.sqrt(s2);
  const c = Math.min(1, Math.max(0, (sl - 1.5) / 0.8)), benches = 1 - c * c * (3 - 2 * c);
  if (benches <= 0) return 0;
  const l = Math.min(1, Math.max(0, (sl - 0.5) / 0.4)), ledges = 1 - l * l * (3 - 2 * l);
  // (a face running along x faces z: its joints are the ones across x)
  const ax = s2 > 1e-6 ? (gz * gz) / s2 : 0.5, t = Math.min(1, Math.max(0, (sl - 0.4) / 0.6)), slab = 1 - t * t * (3 - 2 * t);
  const s = y / 1.3 + tn(y / 3.7, 5) * 1.2 + tn(y / 1.9, 9) * 0.3 + tn(x / 9, z / 9) * 1.6 + tn(x / 3.1, z / 3.1) * 0.35;
  let out = (bench(s) - MEAN_BENCH) * (1 - slab) * benches;
  if (ledges > 0) out += (outAt(x, y, z, s, ax, slab) - MEAN_OUT) * ledges;
  return out * (0.35 + 0.65 * (1 - slab)) * Math.sqrt(1 + sl * sl);
}

/** The same, in GLSL (after HASH21 and the shader's tn): rockOut(p (x, base y, z), ax, slab, w) -> vec2(out, shade). */
export const BEDROCK_GLSL = `
${HASH21}
float brBed(vec3 p) { return p.y / 1.3 + tn(vec2(p.y / 3.7, 5.0)) * 1.2 + tn(vec2(p.y / 1.9, 9.0)) * 0.3 + tn(p.xz / 9.0) * 1.6 + tn(p.xz / 3.1) * 0.35; }
float brJoint(float along, float unit, float w) {
  return smoothstep(0.42 - w * 0.2, 0.5, abs(fract(along / (2.0 + hash21(vec2(unit, 7.0)) * 2.5) + hash21(vec2(unit, 3.0))) - 0.5));
}
float brBench(float s) {
  float sb = s / 4.0 + 0.37, f = fract(sb);
  return smoothstep(0.0, 0.45, f) * (1.0 - 0.5 * f) * (1.0 - smoothstep(0.55, 1.0, f)) * (0.5 + 0.8 * hash21(vec2(floor(sb), 17.0))) * 0.5;
}
vec2 brOut(vec3 p, vec2 ax, float slab, float w) {
  float s = brBed(p), f = fract(s), bed = floor(s), k = max(0.0, 1.7 * hash21(vec2(bed, 11.0)) - 0.35);
  float ledge = smoothstep(0.0, 0.32 + w, f) * (1.0 - 0.6 * f) * (1.0 - smoothstep(0.8 - w, 1.0, f)) * k;
  float ju = floor((bed + 0.5) / 3.0);
  float wx = p.x + (tn(vec2(p.z / 4.3 + ju, 1.7)) - 0.5) * 2.4 + (tn(vec2(p.x / 5.3 + ju * 0.7, 4.1)) - 0.5) * 3.0;
  float wz = p.z + (tn(vec2(p.x / 4.3 + ju, 6.1)) - 0.5) * 2.4 + (tn(vec2(p.z / 5.3 + ju * 0.7, 8.7)) - 0.5) * 3.0;
  float jx = brJoint(wx, ju, w), jz = brJoint(wz, ju, w);
  float jt = (jx * ax.x + jz * ax.y) * (0.35 + 0.65 * abs(ax.x - ax.y));
  float cut = max(jx, jz) * slab + jt * (1.0 - slab);
  float px = 2.0 + hash21(vec2(ju, 7.0)) * 2.5, o = hash21(vec2(ju, 3.0));
  float block = hash21(vec2(floor(wx / px + o) + bed * 7.0, floor(wz / px + o) + 13.0));
  float out_ = ledge * 0.5 + tn(p.xz * 1.7 + p.y) * 0.06 + slab * (block - 0.5) * 0.16 - cut * 0.09 + brBench(s) * (1.0 - slab);
  float shade = (1.0 - 0.4 * min(1.0, k) * (1.0 - smoothstep(0.0, 0.2 + w, f)) * (1.0 - 0.7 * slab)) * (1.0 - 0.25 * jt) * (1.0 - 0.3 * cut * slab);
  return vec2(out_, shade);
}
`;
