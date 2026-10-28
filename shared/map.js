// Map system: every map is plain data (shared/maps/*.js) turned into a GameMap with deterministic generators,
// so the server (collision, bots, hit detection) and the client (rendering) build exactly the same world.
// The server keeps one GameMap per room; the browser activates one map and uses the live bindings below.
import { mulberry32, fbm, smoothstep, clamp } from './util.js';
import outskirts from './maps/outskirts.js';
import harbor from './maps/harbor.js';
import valley from './maps/valley.js';
import compound from './maps/compound.js';
import firestorm from './maps/firestorm.js';
import airfield from './maps/airfield.js';
import oldtown from './maps/oldtown.js';
import ridge from './maps/ridge.js';

export const FLOOR_H = 3.2;
export const WALL_T = 0.3;
export const TEAMS = { US: 1, RU: 2 };
export const TEAM_NAMES = { 1: 'US', 2: 'RU' };

export const MAP_DEFS = { outskirts, harbor, valley, compound, airfield, oldtown, ridge, firestorm };
export const MAP_IDS = Object.keys(MAP_DEFS);
export const modeOf = (id) => MAP_DEFS[id]?.mode || 'conquest';
// maps a Conquest room rotates through (battle royale maps have no flags)
export const CONQUEST_MAPS = MAP_IDS.filter((id) => modeOf(id) === 'conquest');
export const mapList = () => MAP_IDS.map((id) => { const d = MAP_DEFS[id]; return { id, name: d.name, description: d.description, size: d.playHalf * 2, flags: d.flags.length, mode: modeOf(id) }; });

// Collider half-extents are measured from the optimized GLB bounds (see scripts/build-assets.mjs).
export const PROP_TYPES = {
  barrier: { half: [0.77, 0.41, 0.31], oy: 0.41, surface: 'concrete' },
  barrier2: { half: [0.78, 0.55, 0.22], oy: 0.55, surface: 'concrete' },
  crate: { half: [0.62, 0.23, 0.26], oy: 0.23, surface: 'wood' },
  // two crates side by side (±0.27 m along the stack's local z) + one on top: 0.92 m tall (vaultable)
  crate_stack: { half: [0.62, 0.465, 0.53], oy: 0.465, surface: 'wood' },
  barrel: { half: [0.28, 0.44, 0.28], oy: 0.44, surface: 'metal' },
  car: { half: [0.9, 0.7, 2.2], oy: 0.7, surface: 'metal' },
  generator: { half: [0.41, 0.29, 0.28], oy: 0.29, surface: 'metal' },
  utility: { half: [0.26, 0.56, 0.22], oy: 0.56, surface: 'metal' },
  lamp: { half: [0.12, 1.9, 0.12], oy: 1.9, surface: 'metal' },
  container: { half: [3.03, 1.3, 1.22], oy: 1.3, surface: 'metal' },
  sandbags: { half: null, surface: 'sand' },     // length-driven
  fence: { half: null, surface: 'metal', bullets: false },
  wall: { half: null, surface: 'concrete' },     // perimeter concrete wall, length-driven
  lowwall: { half: null, surface: 'concrete' },  // garden / yard wall (brick, coping), length-driven
  pole: { half: [0.18, 3.5, 0.18], oy: 3.5, surface: 'wood' },
  trash: { half: [0.9, 0.46, 0.28], oy: 0.46, surface: 'metal' },
  debris: { half: null, surface: 'concrete' },   // visual only
  tyre: { half: null, surface: 'rubber' },
  jerrycan: { half: null, surface: 'metal' },
  ammo: { half: null, surface: 'wood' },
};
// length-driven props: collider half-thickness across the line and height (sandbags: 5 courses of 0.17 m bags in
// two rows = 0.86 m tall, 0.9 m thick; T-wall 2.6 m; chain-link fence 2.5 m; garden wall 1.1 m: vaultable)
export const LINE_PROPS = { sandbags: { th: 0.45, h: 0.86 }, wall: { th: 0.25, h: 2.6 }, fence: { th: 0.06, h: 2.5 }, lowwall: { th: 0.15, h: 1.1 } };
// harbour water surface (World.js draws the sea plane here; moored ships float on it)
export const SEA_LEVEL = -1.4;

// Axis-aligned footprint of a prop's collider: { hx, hz, h } (null for visual-only props)
export function propFootprint(p) {
  const rot90 = Math.round(p.rot) % 2 === 1, L = LINE_PROPS[p.type];
  if (L) return { hx: rot90 ? L.th : p.len / 2, hz: rot90 ? p.len / 2 : L.th, h: L.h };
  const t = PROP_TYPES[p.type];
  if (!t?.half) return null;
  const [a, b, c] = t.half;
  return { hx: rot90 ? c : a, hz: rot90 ? a : c, h: b * 2 };
}

// Vegetation shapes measured from the GLBs (scripts in the audit: vertex height profiles), so the server can build
// colliders that match what the client draws. Local model space, before the per-instance scale.
// rocks: footprint x range, and slabs along the long (z) axis with their typical top height.
export const ROCK_SHAPES = {
  rock_07: { scale: 1, x: [-0.08, 0.073], segs: [[-0.177, -0.017, 0.131], [-0.017, 0.142, 0.097]], top: 0.142 },
  rock_09: { scale: 1.4, x: [-0.033, 0.033], segs: [[-0.061, -0.025, 0.021], [-0.025, 0.029, 0.027], [0.029, 0.083, 0.016]], top: 0.032 },
};
// fallen dead tree (dead_tree_trunk.glb, drawn at 1.4 x tree scale): a log lying along local x
export const LOG_SHAPE = {
  scale: 1.4, x: [-1.539, 1.511],
  bands: [[-1.539, -0.93, 0.04, 0.26, -0.17, 0.08], [-0.93, -0.32, -0.01, 0.23, -0.16, 0.09], [-0.32, 0.29, -0.03, 0.19, -0.14, 0.11], [0.29, 0.9, -0.01, 0.19, -0.12, 0.1], [0.9, 1.511, 0.01, 0.23, -0.11, 0.09]],
};

function distToSeg(px, pz, r) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  const t = clamp(((px - r.ax) * dx + (pz - r.az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = r.ax + dx * t - px, z = r.az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}

// distance between a road's centre segment and an axis-aligned rectangle (0 if the segment crosses it)
function segRectDist(r, cx, cz, hx, hz) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  let t0 = 0, t1 = 1, hit = true;
  for (const [p, q] of [[-dx, r.ax - (cx - hx)], [dx, cx + hx - r.ax], [-dz, r.az - (cz - hz)], [dz, cz + hz - r.az]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) { hit = false; break; } continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) { hit = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { hit = false; break; } if (t < t1) t1 = t; }
  }
  if (hit) return 0;
  let d = Infinity;
  for (const [x, z] of [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]]) d = Math.min(d, distToSeg(x, z, r));
  for (const [x, z] of [[r.ax, r.az], [r.bx, r.bz]]) d = Math.min(d, Math.hypot(Math.max(Math.abs(x - cx) - hx, 0), Math.max(Math.abs(z - cz) - hz, 0)));
  return d;
}

// smallest move that takes a rectangle `need` metres clear of a road's centre line: sideways, or past an end
function roadPush(r, cx, cz, hx, hz, need) {
  const dx = r.bx - r.ax, dz = r.bz - r.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const cu = (cx - r.ax) * ux + (cz - r.az) * uz, cn = (cx - r.ax) * nx + (cz - r.az) * nz;
  const eu = hx * Math.abs(ux) + hz * Math.abs(uz), en = hx * Math.abs(nx) + hz * Math.abs(nz);
  const side = cn >= 0 ? 1 : -1, a = need + en - Math.abs(cn);
  let best = [nx * side * a, nz * side * a], amt = a;
  if (cu > L) { const b = need + eu - (cu - L); if (b < amt) { best = [ux * b, uz * b]; amt = b; } }
  else if (cu < 0) { const b = need + eu + cu; if (b < amt) best = [-ux * b, -uz * b]; }
  return best;
}

// overlap of two rectangles (centre + half extents) grown by `gap`: the minimal push of A out of B, or null
function rectPush(ax, az, ahx, ahz, bx, bz, bhx, bhz, gap = 0) {
  const ox = ahx + bhx + gap - Math.abs(ax - bx), oz = ahz + bhz + gap - Math.abs(az - bz);
  if (ox <= 0 || oz <= 0) return null;
  return ox < oz ? [(ax >= bx ? 1 : -1) * (ox + 1e-3), 0] : [0, (az >= bz ? 1 : -1) * (oz + 1e-3)];
}

// Map definitions are hand-made data: buildings can end up on a road or overlapping a neighbour. Nudge them
// (deterministically, smaller building moves) until every footprint is 1 m clear of the roadways and 1.5 m from
// other buildings — terraced houses of one street row (same `row`) may share a party wall instead.
function settleBuildings(B, roads) {
  const clr = 1, gap = 1.5, live = roads.filter((r) => r.kind !== 'path');
  for (let it = 0; it < 10; it++) {
    let moved = false;
    for (const b of B) {
      let worst = null, depth = 0.01;
      for (const r of live) { const d = r.w / 2 + clr - segRectDist(r, b.x, b.z, b.w / 2, b.d / 2); if (d > depth) { depth = d; worst = r; } }
      if (worst) { const [mx, mz] = roadPush(worst, b.x, b.z, b.w / 2, b.d / 2, worst.w / 2 + clr + 0.05); b.x += mx; b.z += mz; moved = true; }
      for (const o of B) {
        if (o === b) continue;
        const small = b.w * b.d <= o.w * o.d ? b : o, big = small === b ? o : b;
        const m = rectPush(small.x, small.z, small.w / 2, small.d / 2, big.x, big.z, big.w / 2, big.d / 2, b.row && b.row === o.row ? -0.01 : gap);
        if (m) { small.x += m[0]; small.z += m[1]; moved = true; }
      }
    }
    if (!moved) break;
  }
  for (const b of B) { b.x = Math.round(b.x * 100) / 100; b.z = Math.round(b.z * 100) / 100; }
}

// flag poles stand in the open: out of building footprints (+1.5 m)
// Party walls: where another building's outer face touches a side (within 5 cm), that stretch of wall is shared
// with the neighbour: `touch[side]` lists the stretches (x along n / s, z along w / e) — the generator builds no
// window or balcony there. A side at least half covered is a party wall outright (`party`, added to the sides a map
// declares: terraces meeting at a block corner touch without being one street row): blind, the roof ends in a
// gable there, no trim runs past it.
function markPartyWalls(B) {
  for (const b of B) {
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2, set = new Set(b.party || []);
    const touch = { n: [], s: [], w: [], e: [] };
    for (const o of B) {
      if (o === b) continue;
      const ox0 = o.x - o.w / 2, ox1 = o.x + o.w / 2, oz0 = o.z - o.d / 2, oz1 = o.z + o.d / 2;
      const xa = Math.max(x0, ox0), xb = Math.min(x1, ox1), za = Math.max(z0, oz0), zb = Math.min(z1, oz1);
      if (xb - xa > 0.3 && Math.abs(z0 - oz1) < 0.05) touch.n.push([xa, xb]);
      if (xb - xa > 0.3 && Math.abs(z1 - oz0) < 0.05) touch.s.push([xa, xb]);
      if (zb - za > 0.3 && Math.abs(x0 - ox1) < 0.05) touch.w.push([za, zb]);
      if (zb - za > 0.3 && Math.abs(x1 - ox0) < 0.05) touch.e.push([za, zb]);
    }
    for (const [sd, list] of Object.entries(touch)) {
      if (list.reduce((t, [a, c]) => t + c - a, 0) >= 0.5 * (sd === 'n' || sd === 's' ? b.w : b.d)) set.add(sd);
      if (!list.length) delete touch[sd];
    }
    if (set.size) b.party = ['n', 's', 'w', 'e'].filter((q) => set.has(q));
    if (Object.keys(touch).length) b.touch = touch;
  }
}

function settleFlags(F, B) {
  for (const f of F) for (let it = 0; it < 4; it++) {
    let moved = false;
    for (const b of B) { const m = rectPush(f.x, f.z, 0, 0, b.x, b.z, b.w / 2, b.d / 2, 1.5); if (m) { f.x += m[0]; f.z += m[1]; moved = true; } }
    if (!moved) break;
  }
}

// Props are placed by hand around buildings, roads and each other. Push every solid prop out of building footprints,
// flag poles, the railway and other props; street furniture (lamps, utility boxes, poles) moves to the kerb.
// Lower-priority props move; what can't be fixed in a few passes is dropped (small) or kept (structures).
const PROP_PRIORITY = { wall: 6, lowwall: 5.5, fence: 5, container: 4, car: 3, sandbags: 2.5, barrier: 2, barrier2: 2, trash: 1.6, crate_stack: 1.5 };
const KERB_PROPS = new Set(['lamp', 'utility', 'pole']);
function settleProps(P, B, roads, flags, feet = []) {
  const rails = roads.filter((r) => r.kind === 'rail'), streets = roads.filter((r) => !r.kind);
  const info = P.map((p, i) => ({ p, i, f: propFootprint(p), pr: PROP_PRIORITY[p.type] || 1 }));
  const solid = info.filter((q) => q.f);
  const y0 = (q) => q.p.y || 0;
  const conflict = (q) => {
    const { p, f } = q;
    for (const b of B) { const m = rectPush(p.x, p.z, f.hx, f.hz, b.x, b.z, b.w / 2, b.d / 2, 0.12); if (m) return m; }
    for (const o of feet) { const m = rectPush(p.x, p.z, f.hx, f.hz, o.x, o.z, o.hx, o.hz, 0.12); if (m) return m; }
    for (const fl of flags) { const m = rectPush(p.x, p.z, f.hx, f.hz, fl.x, fl.z, 0.35, 0.35, 0.3); if (m) return m; }
    for (const r of rails) { const need = r.w / 2 + 0.4; if (segRectDist(r, p.x, p.z, f.hx, f.hz) < need - 0.01) return roadPush(r, p.x, p.z, f.hx, f.hz, need + 0.02); }
    if (KERB_PROPS.has(p.type)) for (const r of streets) { const need = r.w / 2 + 0.3; if (segRectDist(r, p.x, p.z, f.hx, f.hz) < need - 0.01) return roadPush(r, p.x, p.z, f.hx, f.hz, need + 0.02); }
    for (const o of solid) {
      if (o === q || o.pr < q.pr || (o.pr === q.pr && o.i > q.i)) continue; // the lower-priority (or later) prop moves
      if (Math.min(y0(q) + f.h, y0(o) + o.f.h) - Math.max(y0(q), y0(o)) <= 0.02) continue; // stacked
      const m = rectPush(p.x, p.z, f.hx, f.hz, o.p.x, o.p.z, o.f.hx, o.f.hz, 0.04);
      if (m) return m;
    }
    return null;
  };
  for (let it = 0; it < 12; it++) {
    let moved = false;
    for (const q of solid) { const m = conflict(q); if (m) { q.p.x += m[0]; q.p.z += m[1]; moved = true; } }
    if (!moved) break;
  }
  const drop = new Set(solid.filter((q) => q.pr < 2.5 && conflict(q)).map((q) => q.p));
  // visual clutter (rubble, tyres, jerry cans) inside a building: rubble goes, the rest lies on the floor slab
  for (const p of P) {
    if (propFootprint(p) || drop.has(p)) continue;
    const b = B.find((q) => Math.abs(p.x - q.x) < q.w / 2 + 0.3 && Math.abs(p.z - q.z) < q.d / 2 + 0.3);
    if (!b) continue;
    const deep = Math.abs(p.x - b.x) < b.w / 2 - 0.8 && Math.abs(p.z - b.z) < b.d / 2 - 0.8; // clear of the walls
    if (p.type === 'debris' || !deep) drop.add(p); else if (p.type === 'tyre' || p.type === 'jerrycan') p.y = 0.12;
  }
  return P.filter((p) => !drop.has(p));
}

// Motor pool around each HQ: where the vehicles park ([side, back] metres in the base's frame: tank right, helicopter
// pad left, jeep beside the tank, bikes behind the HQ) and the footprint radius levelled for each. Shared with
// server/vehicles.js, which parks them here; the ground under every slot is a level pad and trees keep clear of it
// (the helicopter's rotor disc included).
export const MOTOR_POOL = { tank: [[16, 4]], heli: [[-20, 4]], jeep: [[25, 2]], bike: [[6, 10], [9.6, 10]] };
const POOL_R = { tank: 4.4, heli: 6.4, jeep: 2.9, bike: 1.4 }, POOL_CLEAR = { tank: 6, heli: 9.5, jeep: 4.5, bike: 3 };
export function motorPool(base) {
  const fx = -Math.sin(base.yaw), fz = -Math.cos(base.yaw), rx = Math.cos(base.yaw), rz = -Math.sin(base.yaw);
  const out = [];
  for (const [type, spots] of Object.entries(MOTOR_POOL)) for (const [side, back] of spots) {
    out.push({ type, x: base.x + rx * side - fx * back, z: base.z + rz * side - fz * back, r: POOL_R[type], clear: POOL_CLEAR[type] });
  }
  return out;
}

export class GameMap {
  constructor(def) {
    this.def = def;
    this.id = def.id; this.name = def.name;
    this.MAP_HALF = def.mapHalf; this.PLAY_HALF = def.playHalf;
    this.ROADS = def.roads; this.BASES = def.bases;
    // working copies: the placement pass below may nudge buildings / flags / props
    this.BUILDINGS = def.buildings.map((b) => ({ ...b, doors: [...b.doors] }));
    this.FLAGS = def.flags.map((f) => ({ ...f }));
    this.terrain = { amp: 9, scale: 70, detail: 1.2, edge: 16, seed: 7, flatten: 22, baseAmp: 0, baseScale: 300, ...def.terrain };
    this.sea = def.sea || null;
    this.atmosphere = def.atmosphere || {};
    settleBuildings(this.BUILDINGS, this.ROADS);
    markPartyWalls(this.BUILDINGS);
    settleFlags(this.FLAGS, this.BUILDINGS);
    // paved ground (squares, yards, quays: drawn by the client over the terrain, vegetation keeps off) and the
    // sidewalks of roads with `sidewalk` (metres each side); painted lines (client only)
    this.PAVED = (def.paved || []).map((p) => ({ kind: 'concrete', ...p, x0: Math.min(p.x0, p.x1), x1: Math.max(p.x0, p.x1), z0: Math.min(p.z0, p.z1), z1: Math.max(p.z0, p.z1) }));
    this.SIDEWALKS = this.ROADS.filter((r) => r.sidewalk > 0 && !r.kind);
    this.MARKINGS = def.markings || [];
    // harbour structures (gantry cranes, crane rails, moored ships): their footings push props aside like buildings
    const feet = (def.structures || []).flatMap((st) => structureParts(st, () => 0).parts.filter((q) => q.collide && q.min[1] < 2.5))
      .map((q) => ({ x: (q.min[0] + q.max[0]) / 2, z: (q.min[2] + q.max[2]) / 2, hx: (q.max[0] - q.min[0]) / 2, hz: (q.max[2] - q.min[2]) / 2 }));
    this.FOOTINGS = feet;
    const props = def.props(def.bases);
    // debris scatter around damaged buildings (visual)
    const rnd = mulberry32(99);
    for (const b of this.BUILDINGS) {
      if (!b.damage) continue;
      const n = Math.round((4 + b.damage * 10) * (b.row ? 0.5 : 1)); // terraced town houses: half (a street of them)
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.max(b.w, b.d) * 0.5 + 1 + rnd() * 4;
        props.push({ type: 'debris', x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r, rot: rnd() * 6.28, s: 0.6 + rnd() * 1.2 });
      }
      for (let i = 0; i < 3; i++) props.push({ type: rnd() < 0.5 ? 'tyre' : 'jerrycan', x: b.x + (rnd() - 0.5) * (b.w + 6), z: b.z + (rnd() - 0.5) * (b.d + 6), rot: rnd() * 6.28 });
    }
    this.PROPS = settleProps(props, this.BUILDINGS, this.ROADS, this.FLAGS, feet);
    this.HG = null;
    this.POOL = this.#planMotorPool();
    this.pads = [];
    for (const k of ['roadDistance', 'featureDistance', 'terrainHeight', 'groundHeight', 'buildingBase', 'generateBuilding', 'generateVegetation', 'seaFactor', 'pavedAt', 'buildingsNear']) this[k] = this[k].bind(this);
    this.#buildPads();
    // final structure geometry stands on the levelled terrain (ships float at SEA_LEVEL)
    this.STRUCTURES = (def.structures || []).map((st) => ({ ...st, ...structureParts(st, this.terrainHeight) }));
  }

  // paving kind at (x, z) (`pad` metres around it counts too), null on open ground / the roadway itself
  pavedAt(x, z, pad = 0) {
    for (const p of this.PAVED) if (x > p.x0 - pad && x < p.x1 + pad && z > p.z0 - pad && z < p.z1 + pad) return p.kind;
    for (const r of this.SIDEWALKS) { const d = distToSeg(x, z, r) - r.w / 2; if (d > -0.01 && d < r.sidewalk + pad) return 'pavement'; }
    return null;
  }

  // buildings whose footprint comes within 4 m of the 16 m cell around (x, z) (per-vertex / per-clump loops)
  buildingsNear(x, z) {
    const C = 16, i = Math.floor(x / C), j = Math.floor(z / C), key = i * 8191 + j;
    const cache = this._bc || (this._bc = new Map());
    let c = cache.get(key);
    if (!c) {
      const x0 = i * C - 4, z0 = j * C - 4, x1 = x0 + C + 8, z1 = z0 + C + 8;
      c = this.BUILDINGS.filter((b) => b.x + b.w / 2 > x0 && b.x - b.w / 2 < x1 && b.z + b.d / 2 > z0 && b.z - b.d / 2 < z1);
      cache.set(key, c);
    }
    return c;
  }

  // Vehicle parking slots per team: the standard motor-pool position, or the nearest spot to it (3 m rings) that is
  // inside the play area, off the water, clear of buildings and props (the helicopter by its whole rotor disc), apart
  // from the other slots and not on a steep hillside — base layouts differ per map. The ground under each slot is then
  // levelled (pads) and kept free of trees; server/vehicles.js parks the vehicles here.
  #planMotorPool() {
    const out = { 1: [], 2: [] }, taken = [], H = this.PLAY_HALF;
    const rectDist = (x, z, cx, cz, hx, hz) => Math.hypot(Math.max(Math.abs(x - cx) - hx, 0), Math.max(Math.abs(z - cz) - hz, 0));
    const feet = this.PROPS.map((p) => [p, propFootprint(p)]).filter(([, f]) => f);
    const free = (m, x, z, base) => {
      if (Math.abs(x) > H - m.r - 2 || Math.abs(z) > H - m.r - 2 || this.seaFactor(x, z) > 0.01) return false;
      if (Math.hypot(x - base.x, z - base.z) < 13 + m.r) return false; // soldiers deploy within 12 m of the HQ
      if (this.BUILDINGS.some((q) => rectDist(x, z, q.x, q.z, q.w / 2, q.d / 2) < m.clear)) return false;
      if (this.FOOTINGS.some((q) => rectDist(x, z, q.x, q.z, q.hx, q.hz) < m.clear)) return false;
      if (feet.some(([p, f]) => rectDist(x, z, p.x, p.z, f.hx, f.hz) < (m.type === 'heli' ? m.clear : m.r + 0.8))) return false;
      if (taken.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + m.r + 1.2)) return false;
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI * 2, d = k === 8 ? 0 : m.r, h = this.#rawHeight(x + Math.cos(a) * d, z + Math.sin(a) * d); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      return hi - lo < 3.5;
    };
    for (const t of [1, 2]) {
      if (!this.BASES?.[t]) continue;
      for (const m of motorPool(this.BASES[t])) {
        let slot = null;
        for (let ring = 0; ring <= 14 && !slot; ring++) {
          const n = Math.max(1, ring * 8);
          for (let k = 0; k < n && !slot; k++) {
            const a = (k / n) * Math.PI * 2, x = m.x + Math.cos(a) * ring * 3, z = m.z + Math.sin(a) * ring * 3;
            if (free(m, x, z, this.BASES[t])) slot = { ...m, x, z };
          }
        }
        slot = slot || m;
        taken.push(slot); out[t].push(slot);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- building / prop pads
  // Every building (and every large prop) sits on a level pad cut into / filled onto the terrain: the whole height
  // field (relief, detail noise, edge hills) is blended to the pad height over the footprint plus a flat apron, then
  // eased back to the natural ground over a margin that grows with the height difference (no cliffs).
  #buildPads() {
    const raw = (x, z) => this.#rawHeight(x, z);
    const mean = (x, z, hx, hz, step) => {
      let s = 0, n = 0;
      const nx = Math.max(1, Math.ceil((2 * hx) / step)), nz = Math.max(1, Math.ceil((2 * hz) / step));
      for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) { s += raw(x - hx + (2 * hx * i) / nx, z - hz + (2 * hz * j) / nz); n++; }
      return s / n;
    };
    const pads = this.BUILDINGS.map((b) => ({ x: b.x, z: b.z, hx: b.w / 2, hz: b.d / 2, y: mean(b.x, b.z, b.w / 2, b.d / 2, 1), apron: 2, margin: 0, b, k: [2.6, 4, 24] }));
    // large props get small pads of their own (stacked containers share the bottom one's)
    const big = new Set(['container', 'car', 'trash', 'crate_stack', 'barrier', 'barrier2', 'generator']);
    const seen = new Set();
    for (const p of this.PROPS) {
      if (!big.has(p.type) || p.y) continue;
      const f = propFootprint(p), key = `${p.x},${p.z}`;
      if (!f || seen.has(key)) continue;
      seen.add(key);
      pads.push({ x: p.x, z: p.z, hx: f.hx, hz: f.hz, y: mean(p.x, p.z, f.hx, f.hz, 1), apron: 0.6, margin: 0, k: [3, 2, 16] });
    }
    // motor pool slots: level parking for every vehicle
    for (const t of [1, 2]) for (const m of this.POOL?.[t] || []) {
      pads.push({ x: m.x, z: m.z, hx: m.r, hz: m.r, y: mean(m.x, m.z, m.r, m.r, 1), apron: 1.5, margin: 0, k: [2.6, 3, 20], pool: m.type });
    }
    // neighbouring pads may differ by at most ~0.5 m per metre of ground between their aprons (no cliffs between
    // houses on a hillside, a car beside a bunker sits on the same level); the smaller pad gives way more
    for (let it = 0; it < 8; it++) {
      let worst = 0;
      for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
        const a = pads[i], c = pads[j];
        const gap = Math.hypot(Math.max(Math.abs(a.x - c.x) - a.hx - c.hx, 0), Math.max(Math.abs(a.z - c.z) - a.hz - c.hz, 0)) - a.apron - c.apron;
        if (gap > 24) continue;
        const allow = 0.5 * Math.max(0, gap) + 0.05, dy = a.y - c.y, ex = Math.abs(dy) - allow;
        if (ex <= 0) continue;
        const ma = a.hx * a.hz, mc = c.hx * c.hz, k = (ex * Math.sign(dy)) / (ma + mc);
        a.y -= k * mc; c.y += k * ma; worst = Math.max(worst, ex);
      }
      if (worst < 0.01) break;
    }
    for (const p of pads) p.margin = this.#padMargin(p, raw, ...p.k);
    this.pads = pads; this._pc = null; this.HG = null;
  }

  #padMargin(p, h, k, lo, hi) {
    let dev = 0;
    const ex = p.hx + p.apron + 2, ez = p.hz + p.apron + 2;
    for (let t = 0; t <= 1.0001; t += 0.125) for (const [x, z] of [[-ex + 2 * ex * t, -ez], [-ex + 2 * ex * t, ez], [-ex, -ez + 2 * ez * t], [ex, -ez + 2 * ez * t]]) dev = Math.max(dev, Math.abs(h(p.x + x, p.z + z) - p.y));
    return clamp(1.5 + k * dev, lo, hi);
  }

  // pads whose influence reaches a 32 m cell
  #padCell(x, z) {
    const C = 32, i = Math.floor(x / C), j = Math.floor(z / C), key = i * 4099 + j;
    const cache = this._pc || (this._pc = new Map());
    let c = cache.get(key);
    if (c) return c;
    const x0 = i * C, z0 = j * C;
    c = this.pads.filter((p) => { const r = p.apron + p.margin; return p.x + p.hx + r > x0 && p.x - p.hx - r < x0 + C && p.z + p.hz + r > z0 && p.z - p.hz - r < z0 + C; });
    cache.set(key, c);
    return c;
  }

  roadDistance(x, z) {
    let d = Infinity;
    for (const r of this.ROADS) d = Math.min(d, distToSeg(x, z, r) - r.w / 2);
    return d;
  }

  // Only features within the terrain's flatten range matter (farther ones are clamped away by the smoothstep in
  // terrainHeight), so each 32 m cell keeps a short candidate list — big maps would otherwise take seconds.
  #featureCell(x, z) {
    const C = 32, i = Math.floor(x / C), j = Math.floor(z / C), key = i * 4099 + j;
    const cache = this._fc || (this._fc = new Map());
    let c = cache.get(key);
    if (c) return c;
    const cx = (i + 0.5) * C, cz = (j + 0.5) * C, reach = C * 0.71 + this.terrain.flatten + 4;
    c = {
      roads: this.ROADS.filter((r) => distToSeg(cx, cz, r) - r.w / 2 - 2.5 < reach),
      buildings: this.BUILDINGS.filter((b) => Math.hypot(Math.max(Math.abs(cx - b.x) - b.w / 2, 0), Math.max(Math.abs(cz - b.z) - b.d / 2, 0)) - 3 < reach),
      flags: this.FLAGS.filter((f) => Math.hypot(cx - f.x, cz - f.z) - f.r < reach),
      bases: [1, 2].map((t) => this.BASES[t]).filter((b) => Math.hypot(cx - b.x, cz - b.z) - 30 < reach),
      far: reach - C * 0.71,
    };
    cache.set(key, c);
    return c;
  }

  featureDistance(x, z) {
    const c = this.#featureCell(x, z);
    let d = c.far;
    for (const r of c.roads) d = Math.min(d, distToSeg(x, z, r) - r.w / 2 - 2.5);
    for (const b of c.buildings) {
      const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
      d = Math.min(d, Math.hypot(dx, dz) - 3);
    }
    for (const f of c.flags) d = Math.min(d, Math.hypot(x - f.x, z - f.z) - f.r);
    for (const b of c.bases) d = Math.min(d, Math.hypot(x - b.x, z - b.z) - 30);
    return d;
  }

  featureDistanceSlow(x, z) {
    let d = this.roadDistance(x, z) - 2.5;
    for (const b of this.BUILDINGS) {
      const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
      d = Math.min(d, Math.hypot(dx, dz) - 3);
    }
    for (const f of this.FLAGS) d = Math.min(d, Math.hypot(x - f.x, z - f.z) - f.r);
    for (const t of [1, 2]) d = Math.min(d, Math.hypot(x - this.BASES[t].x, z - this.BASES[t].z) - 30);
    return d;
  }

  // 0 on land, 1 over open water (harbour maps)
  seaFactor(x, z) {
    const s = this.sea; if (!s) return 0;
    const along = s.axis === 'x' ? x : z;
    return smoothstep(0, s.shore || 10, s.dir * (along - s.at));
  }

  // Large-scale relief (never flattened, buildings sit on it) + rolling detail flattened around built-up areas
  // + raised hills at the map edges (+ optional sea).
  terrainHeight(x, z) {
    const h = this.#rawHeight(x, z);
    if (!this.pads.length) return h;
    // each pad wants the ground at h + w (pad - h): w = 1 over the footprint + apron, easing to 0 across the margin.
    // Overlapping pads are averaged with weights w / (1 - w) (-> infinite on a footprint, so a pad is exact there),
    // which spreads the hand-over between neighbouring pads over their whole margins.
    let su = 0, sd = 0;
    for (const p of this.#padCell(x, z)) {
      const dx = Math.max(Math.abs(x - p.x) - p.hx, 0), dz = Math.max(Math.abs(z - p.z) - p.hz, 0);
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= p.apron + p.margin) continue;
      const w = d <= p.apron ? 1 : 1 - smoothstep(p.apron, p.apron + p.margin, d);
      const u = w / (1.0001 - w);
      su += u; sd += u * w * (p.y - h);
    }
    return su > 0 ? h + sd / su : h;
  }

  #rawHeight(x, z) {
    const T = this.terrain;
    const base = T.baseAmp ? (fbm(x / T.baseScale, z / T.baseScale, 3, T.seed + 40) - 0.5) * T.baseAmp : 0;
    const n = (fbm(x / T.scale, z / T.scale, 4, T.seed) - 0.5) * T.amp + (fbm(x / 18, z / 18, 2, T.seed + 4) - 0.5) * T.detail;
    const mask = smoothstep(0, T.flatten, this.featureDistance(x, z));
    const sea = this.seaFactor(x, z);
    const edge = smoothstep(this.PLAY_HALF - 25, this.MAP_HALF, Math.max(Math.abs(x), Math.abs(z))) * (1 - sea);
    const land = base + n * mask + edge * T.edge * (0.6 + fbm(x / 30, z / 30, 2, 5) * 0.8);
    return sea > 0 ? land * (1 - sea) + (-(this.sea.depth || 6)) * sea : land;
  }

  groundHeight(x, z) {
    const H = this.MAP_HALF, N = H * 2 + 1;
    if (!this.HG) {
      this.HG = new Float32Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.HG[j * N + i] = this.terrainHeight(-H + i, -H + j);
    }
    const fx = clamp(x + H, 0, N - 1.001), fz = clamp(z + H, 0, N - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, G = this.HG;
    const a = G[j * N + i], b = G[j * N + i + 1], c = G[(j + 1) * N + i], d = G[(j + 1) * N + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  // floor level of a building = its pad height (the terrain under the whole footprint is levelled to it)
  buildingBase(b) {
    const p = this.pads.find((q) => q.b === b) || this.pads.find((q) => q.b && q.b.id === b.id);
    return p ? p.y : this.groundHeight(b.x, b.z);
  }

  generateBuilding(b) { return generateBuildingFor(this, b); }

  generateVegetation() {
    const V = { seed: 4242, trees: 440, shrubs: 1300, rocks: 160, clusters: 5, ...this.def.vegetation };
    const rnd = mulberry32(V.seed);
    const trees = [], shrubs = [], rocks = [];
    const H = this.MAP_HALF, G = this.groundHeight;
    // prop footprints (visual-only clutter counts as a 0.6 m square)
    const rects = this.PROPS.map((p) => { const f = propFootprint(p); return f ? [p.x, p.z, f.hx, f.hz] : [p.x, p.z, 0.6, 0.6]; });
    const blocked = (x, z, pad) => {
      if (this.roadDistance(x, z) < pad + 1 || this.seaFactor(x, z) > 0.01 || this.pavedAt(x, z, pad * 0.5)) return true;
      for (const b of this.buildingsNear(x, z)) if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
      for (const q of this.FOOTINGS) if (Math.abs(x - q.x) < q.hx + pad && Math.abs(z - q.z) < q.hz + pad) return true;
      for (const f of this.FLAGS) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.8) return true;
      const pp = Math.min(pad, 1.5);
      for (const r of rects) if (Math.abs(x - r[0]) < r[2] + pp && Math.abs(z - r[1]) < r[3] + pp) return true;
      for (const t of [1, 2]) if (Math.hypot(x - this.BASES[t].x, z - this.BASES[t].z) < 26) return true;
      for (const t of [1, 2]) for (const m of this.POOL?.[t] || []) if (Math.hypot(x - m.x, z - m.z) < m.clear + pad * 0.5) return true;
      return false;
    };
    for (let i = 0; i < V.trees * 4 && trees.length < V.trees; i++) {
      const cx = (rnd() - 0.5) * 2 * (H - 6), cz = (rnd() - 0.5) * 2 * (H - 6);
      const n = 1 + Math.floor(rnd() * V.clusters);
      for (let k = 0; k < n; k++) {
        const x = cx + (rnd() - 0.5) * 14, z = cz + (rnd() - 0.5) * 14;
        if (Math.abs(x) > H - 3 || Math.abs(z) > H - 3 || blocked(x, z, 3)) continue;
        trees.push({ x, z, s: 1.25 + rnd() * 0.9, r: rnd() * Math.PI * 2, dead: rnd() < (V.dead ?? 0.07) });
      }
    }
    // dead trees are fallen logs: lay each one along the ground (tilted with the slope, bottom slightly sunk);
    // drop logs that would bridge a bump / hollow or run into something
    const logs = new Set();
    for (const t of trees) {
      if (!t.dead) continue;
      const L = layLog(t, G);
      if (!L || L.pts.some(([x, z]) => Math.abs(x) > H - 3 || Math.abs(z) > H - 3 || blocked(x, z, 0.5))) { logs.add(t); continue; }
      Object.assign(t, { y: L.y, tilt: L.tilt, boxes: L.boxes });
    }
    if (logs.size) for (let i = trees.length - 1; i >= 0; i--) if (logs.has(trees[i])) trees.splice(i, 1);
    for (let i = 0; i < V.shrubs; i++) {
      const x = (rnd() - 0.5) * 2 * (H - 4), z = (rnd() - 0.5) * 2 * (H - 4);
      if (!blocked(x, z, 1.5)) shrubs.push({ x, z, s: 1.4 + rnd() * 1.6, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'shrub' : 'fern' });
    }
    for (let i = 0; i < V.rocks; i++) {
      const x = (rnd() - 0.5) * 2 * (H - 4), z = (rnd() - 0.5) * 2 * (H - 4);
      if (blocked(x, z, 2)) continue;
      const r = { x, z, s: 6 + rnd() * 14, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'rock_07' : 'rock_09' };
      const R = placeRock(r, G);
      if (R.corners.some(([cx, cz]) => blocked(cx, cz, 0.3))) continue; // a big rock would reach into a road / wall / prop
      rocks.push(Object.assign(r, { y: R.y, boxes: R.boxes }));
    }
    return { trees, shrubs, rocks };
  }
}

// AABB of a rotated local rectangle (centre lx,lz, half hx,hz; Y-rotation a as THREE applies it), slightly shrunk
// toward the true rotated outline
function rotBox(ox, oz, lx, lz, hx, hz, a) {
  const c = Math.cos(a), s = Math.sin(a), ac = Math.abs(c), as = Math.abs(s), k = 1 / Math.sqrt(ac + as);
  return { x: ox + lx * c + lz * s, z: oz - lx * s + lz * c, hx: (hx * ac + hz * as) * k, hz: (hx * as + hz * ac) * k };
}

// a fallen log (dead_tree_trunk, lying along its local x): least-squares fit of the ground under it -> tilt and
// height; null when the ground is too steep or too bumpy for the log to lie on it
function layLog(t, G) {
  const k = LOG_SHAPE.scale * t.s, a = t.r, ux = Math.cos(a), uz = -Math.sin(a);
  const x0 = LOG_SHAPE.x[0] * k, x1 = LOG_SHAPE.x[1] * k, N = 8, pts = [];
  let sx = 0, sh = 0, sxx = 0, sxh = 0;
  for (let i = 0; i <= N; i++) {
    const lx = x0 + ((x1 - x0) * i) / N, x = t.x + ux * lx, z = t.z + uz * lx, h = G(x, z);
    pts.push([x, z, lx, h]); sx += lx; sh += h; sxx += lx * lx; sxh += lx * h;
  }
  const n = N + 1, m = (n * sxh - sx * sh) / (n * sxx - sx * sx), c = (sh - m * sx) / n;
  const tilt = Math.atan(m);
  if (Math.abs(tilt) > 0.42) return null;
  if (pts.some(([, , lx, h]) => Math.abs(h - (c + m * lx)) > 0.1 + 0.06 * k)) return null;
  const y = c - 0.04 * k, ct = Math.cos(tilt), st = Math.sin(tilt), boxes = [];
  for (const [xa, xb, ya, yb, za, zb] of LOG_SHAPE.bands) {
    const pieces = Math.max(1, Math.ceil(((xb - xa) * k) / 0.8));
    for (let i = 0; i < pieces; i++) {
      const pa = (xa + ((xb - xa) * i) / pieces) * k, pb = (xa + ((xb - xa) * (i + 1)) / pieces) * k, lx = (pa + pb) / 2;
      const r = rotBox(t.x, t.z, lx * ct, ((za + zb) / 2) * k, ((pb - pa) / 2) * ct, ((zb - za) / 2) * k, a);
      const cy = y + lx * st, dy = Math.abs(((pb - pa) / 2) * st);
      boxes.push({ min: [r.x - r.hx, cy + ya * k - dy - 0.05, r.z - r.hz], max: [r.x + r.hx, cy + yb * k + dy * 0.5, r.z + r.hz] });
    }
  }
  return { y, tilt, boxes, pts };
}

// a rock: seated on the lowest ground under its footprint (partly buried uphill), colliders per measured slab
function placeRock(r, G) {
  const S = ROCK_SHAPES[r.kind], sc = r.s * S.scale, z0 = S.segs[0][0], z1 = S.segs[S.segs.length - 1][1];
  const c = Math.cos(r.r), s = Math.sin(r.r), w = (lx, lz) => [r.x + lx * c + lz * s, r.z - lx * s + lz * c];
  const corners = [[S.x[0], z0], [S.x[1], z0], [S.x[0], z1], [S.x[1], z1], [S.x[0], (z0 + z1) / 2], [S.x[1], (z0 + z1) / 2]].map(([lx, lz]) => w(lx * sc, lz * sc));
  const y = Math.min(G(r.x, r.z), ...corners.slice(0, 4).map(([x, z]) => G(r.x + (x - r.x) * 0.8, r.z + (z - r.z) * 0.8))) - 0.03;
  const boxes = [];
  for (const [za, zb, h] of S.segs) {
    if (h * sc < 0.22) continue;
    const b = rotBox(r.x, r.z, ((S.x[0] + S.x[1]) / 2) * sc, ((za + zb) / 2) * sc, ((S.x[1] - S.x[0]) / 2) * sc, ((zb - za) / 2) * sc, r.r);
    boxes.push({ min: [b.x - b.hx, y - 0.2, b.z - b.hz], max: [b.x + b.hx, y + h * sc, b.z + b.hz] });
  }
  return { y, boxes, corners };
}

// ---------------------------------------------------------------- harbour structures
// Plain data in a map def ({ type, ... }) expanded into boxes { min, max, mat, collide } that both the server colliders
// (shared/world.js) and the client meshes (client/js/world/Structures.js) are built from, plus thin stays / ropes
// (`lines`: [[x, y, z], [x, y, z], radius, mat], drawn only). `mat: null` boxes collide but are not drawn (the client
// draws a shaped hull there). G(x, z): terrain height.
//   crane: ship-to-shore container gantry along z: legs on the waterside (zw) and landside (zl) rails 16 m apart in x,
//          portal beams at 13-15 m, boom at 41 m reaching `out` m past the waterside rail, apex + stays, trolley over
//          the water with a spreader (optionally lifting a container)
//   rails: the crane rails let into the quay paving ({ x0, x1, z: [..] })
//   ship:  container feeder moored alongside ({ x0 (bow), x1 (stern), z (hull side at the quay), beam, dir (toward open
//          water), seed }): hull, hatch covers, deck stacks, accommodation block, bridge wings, funnel
export function structureParts(st, G) {
  const parts = [], lines = [];
  let y0 = 0, hull = null;
  const box = (ax, ay, az, bx, by, bz, mat, collide = true) => parts.push({ min: [Math.min(ax, bx), y0 + Math.min(ay, by), Math.min(az, bz)], max: [Math.max(ax, bx), y0 + Math.max(ay, by), Math.max(az, bz)], mat, collide });
  const line = (a, b, r, mat) => lines.push([[a[0], y0 + a[1], a[2]], [b[0], y0 + b[1], b[2]], r, mat]);
  if (st.type === 'crane') {
    const { x, zw, zl } = st, sea = Math.sign(zw - zl), S = 8, H = 41, zLo = Math.min(zw, zl), zHi = Math.max(zw, zl);
    y0 = Math.min(...[-S, S].flatMap((dx) => [zw, zl].map((z) => G(x + dx, z)))) - 0.05;
    for (const lx of [x - S, x + S]) {
      for (const zr of [zw, zl]) {
        box(lx - 2.8, 0, zr - 0.75, lx + 2.8, 1.4, zr + 0.75, 'crane_dark');            // travelling bogie on the rail
        box(lx - 0.65, 1.4, zr - 0.65, lx + 0.65, H, zr + 0.65, 'crane');                // leg
      }
      box(lx - 0.65, H - 2, zLo - 0.65, lx + 0.65, H, zHi + 0.65, 'crane');               // top girder across the gauge
    }
    for (const zr of [zw, zl]) {
      box(x - S, 13, zr - 0.6, x + S, 15, zr + 0.6, 'crane');                              // portal beam (trucks drive under)
      box(x - S, H, zr - 0.6, x + S, H + 1, zr + 0.6, 'crane');                            // boom seat
    }
    const tip = zw + sea * (st.out || 46), back = zl - sea * 24, zA = zw - sea * 1.2;
    for (const bx of [x - 2.8, x + 2.8]) {
      box(bx - 0.5, H + 1, Math.min(tip, back), bx + 0.5, H + 3.5, Math.max(tip, back), 'crane'); // boom girders
      box(bx - 0.6, H + 3.5, zA - 0.6, bx + 0.6, H + 21, zA + 0.6, 'crane');                // apex posts
      line([bx, H + 20.5, zA], [bx, H + 3.5, tip], 0.2, 'crane_dark');                     // forestays
      line([bx, H + 20.5, zA], [bx, H + 3.5, zw + sea * (st.out || 46) * 0.5], 0.16, 'crane_dark');
      line([bx, H + 20.5, zA], [bx, H + 3.5, back], 0.2, 'crane_dark');                     // backstay
    }
    box(x - 3.4, H + 20, zA - 0.7, x + 3.4, H + 21.5, zA + 0.7, 'crane');                    // apex head
    for (let z = Math.min(tip, back) + 3; z < Math.max(tip, back) - 2; z += 6) box(x - 2.3, H + 3.2, z - 0.15, x + 2.3, H + 3.5, z + 0.15, 'crane', false);
    box(x - 4.5, H + 3.5, zl - sea * 9, x + 4.5, H + 9.5, zl - sea * 22, 'crane_white');   // machinery house
    // trolley + operator cab over the water, hoist ropes down to the spreader
    const zT = zw + sea * (st.trolley ?? 20), yS = st.hoist ?? 17;
    box(x - 3, H - 2.5, zT - 3, x + 3, H + 1, zT + 3, 'crane_dark', false);
    box(x + 1.2, H - 5, zT - 1.3, x + 3.1, H - 2.5, zT + 1.3, 'crane_white', false);
    for (const [dx, dz] of [[-1.5, -0.8], [1.5, -0.8], [-1.5, 0.8], [1.5, 0.8]]) line([x + dx, H - 2.5, zT + dz], [x + dx * 2.6, yS, zT + dz], 0.035, 'rope');
    box(x - 6.1, yS - 0.5, zT - 1.25, x + 6.1, yS, zT + 1.25, 'crane_dark', false);
    if (st.load) box(x - 6.05, yS - 3.1, zT - 1.22, x + 6.05, yS - 0.5, zT + 1.22, 'container', false);
  } else if (st.type === 'rails') {
    // steel rails flush with the paving, laid in 6 m lengths following the ground
    for (const z of st.z) for (let a = st.x0; a < st.x1 - 1e-6; a += 6) {
      const b = Math.min(st.x1, a + 6);
      y0 = G((a + b) / 2, z);
      box(a, 0.0, z - 0.09, b, 0.07, z + 0.09, 'rail', false);
    }
  } else if (st.type === 'ship') {
    const { x0, x1, z, beam, dir } = st, zf = z + dir * beam, zc = (z + zf) / 2, rnd = mulberry32(st.seed || 7);
    const zlo = Math.min(z, zf), zhi = Math.max(z, zf), keel = -7, deck = 7.5;
    y0 = SEA_LEVEL;
    // hull colliders: the parallel body plus a stepped bow (the client draws the shaped hull)
    box(x0 + 16, keel, zlo, x1, deck, zhi, null);
    box(x0 + 6, keel + 1, zlo + 2.5, x0 + 16, deck + 2.5, zhi - 2.5, null);
    box(x0, keel + 3, zlo + 7, x0 + 6, deck + 2.5, zhi - 7, null);
    box(x0 + 8, deck, zlo + 1, x0 + 22, deck + 2.5, zhi - 1, 'hull');                        // forecastle
    line([x0 + 14, deck + 2.5, zc], [x0 + 14, deck + 16, zc], 0.25, 'crane_dark');           // foremast
    // cargo bays: hatch covers with container stacks (2.44 m rows across the beam, 2.6 m tiers)
    const rows = Math.floor((beam - 3) / 2.44), z0r = zc - (rows * 2.44) / 2, bays = [];
    for (let bx = x0 + 30; bx < x1 - 34; bx += 13.2) bays.push(bx);
    for (const bx of bays) {
      box(bx - 6.4, deck, z0r - 0.2, bx + 6.4, deck + 1.1, z0r + rows * 2.44 + 0.2, 'hatch');
      for (let r = 0; r < rows; r++) {
        const tiers = Math.max(0, Math.min(5, Math.round(1 + rnd() * 4.4 - (r === 0 || r === rows - 1 ? 1 : 0))));
        if (!tiers) continue;
        const za = z0r + r * 2.44 + 0.01, zb = za + 2.42;
        for (let t = 0; t < tiers; t++) box(bx - 6.05, deck + 1.1 + t * 2.6, za, bx + 6.05, deck + 1.1 + (t + 1) * 2.6 - 0.02, zb, 'container', false);
        box(bx - 6.05, deck + 1.1, za, bx + 6.05, deck + 1.1 + tiers * 2.6, zb, null);
      }
    }
    // accommodation block aft (five decks, a band of windows on each), the bridge with wings across the whole beam,
    // the funnel behind it
    box(x1 - 27, deck, zc - 8.5, x1 - 14, deck + 14, zc + 8.5, 'superstructure');
    for (let k = 0; k < 5; k++) box(x1 - 27.04, deck + k * 2.8 + 1.1, zc - 8.54, x1 - 13.96, deck + k * 2.8 + 2.1, zc + 8.54, 'glazing', false);
    box(x1 - 26, deck + 14, zlo + 0.5, x1 - 18, deck + 17, zhi - 0.5, 'superstructure');
    box(x1 - 26.04, deck + 15, zlo + 0.46, x1 - 17.96, deck + 16.4, zhi - 0.46, 'glazing', false);
    box(x1 - 11.5, deck, zc - 2.6, x1 - 6.5, deck + 17, zc + 2.6, 'funnel');
    box(x1 - 11.5, deck + 17, zc - 2.6, x1 - 6.5, deck + 19, zc + 2.6, 'funnel_top');
    box(x1 - 6, deck, zlo + 1, x1, deck + 1.2, zhi - 1, 'hull');                              // poop deck bulwark
    line([x1 - 20, deck + 17, zc], [x1 - 20, deck + 24, zc], 0.15, 'crane_dark');           // radar mast
    hull = { x0, x1, zlo, zhi, keel: y0 + keel, deck: y0 + deck, bow: 16 };
  }
  return { parts, lines, hull };
}

const cache = new Map();
export function getMap(id) {
  if (!MAP_DEFS[id]) id = 'outskirts';
  if (!cache.has(id)) cache.set(id, new GameMap(MAP_DEFS[id]));
  return cache.get(id);
}

// ---------------------------------------------------------------- active map (browser) — ES module live bindings
export let ACTIVE_MAP, MAP_HALF, PLAY_HALF, ROADS, FLAGS, BASES, BUILDINGS, PROPS;
export let terrainHeight, groundHeight, roadDistance, buildingBase, generateBuilding, generateVegetation, seaFactor;
export function setActiveMap(id) {
  const m = getMap(id);
  ACTIVE_MAP = m;
  ({ MAP_HALF, PLAY_HALF, ROADS, FLAGS, BASES, BUILDINGS, PROPS } = m);
  ({ terrainHeight, groundHeight, roadDistance, buildingBase, generateBuilding, generateVegetation, seaFactor } = m);
  return m;
}
setActiveMap('outskirts');

// ---------------------------------------------------------------- building generator
// [x0, z0, x1, z1] minus an axis-aligned hole { x0, z0, x1, z1 } (or null): up to four rectangles
export function rectMinus(r, h) {
  if (!h || h.x0 >= r[2] || h.x1 <= r[0] || h.z0 >= r[3] || h.z1 <= r[1]) return r[2] > r[0] && r[3] > r[1] ? [r] : [];
  const out = [], a = Math.max(r[1], h.z0), c = Math.min(r[3], h.z1);
  if (h.z0 > r[1]) out.push([r[0], r[1], r[2], h.z0]);
  if (h.z1 < r[3]) out.push([r[0], h.z1, r[2], r[3]]);
  if (h.x0 > r[0]) out.push([r[0], a, h.x0, c]);
  if (h.x1 < r[2]) out.push([h.x1, a, r[2], c]);
  return out.filter((q) => q[2] - q[0] > 0.01 && q[3] - q[1] > 0.01);
}

// Roof of a building: null = flat roof behind a parapet. Town houses (plaster / brick, up to 3 floors — 2 on battle
// royale maps, where a soldier who lands on a roof has to jump off it — and spans up to 16 m) get a clay-tile gable or
// hip roof, warehouses a shallow metal one; `b.roof` ('flat' | 'pitched' | 'gable' | 'hip') overrides. The slope runs
// through the outer wall faces at the top floor's ceiling (yw); the tiles sit t above it. A damaged house loses the
// roof over its destroyed top-floor bays (and over the collapsed half of the top slab): `hole`, in plan.
function roofPlan(map, b, { y0, x0, x1, z0, z1, T, FH, floors, wh, bunker, damagedRoof, corner, destroyed }) {
  const want = b.roof || 'auto', house = b.style === 'plaster' || b.style === 'brick';
  if (bunker || want === 'flat') return null;
  if (want === 'auto' && !wh && !(house && floors <= (map.def?.mode === 'royale' ? 2 : 3) && Math.min(b.w, b.d) <= 16)) return null;
  // terraced houses: the ridge runs along the street row, gables against the neighbours (party walls), no verge
  // overhang there. Party walls on both axes (a corner house) or a span over 16 m: flat roof
  const party = b.party || [], px = party.some((s) => s === 'w' || s === 'e'), pz = party.some((s) => s === 'n' || s === 's');
  if ((px && pz) || (px && b.d > 16) || (pz && b.w > 16)) return null;
  // own random stream: the generator's (windows, stubs) stays as it was
  const rr = mulberry32(b.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7) ^ 0x51ed27);
  const kind = wh || px || pz ? 'gable' : want === 'gable' || want === 'hip' ? want : rr() < 0.4 ? 'hip' : 'gable';
  const axis = px ? 'x' : pz ? 'z' : b.w > b.d ? 'x' : b.w < b.d ? 'z' : rr() < 0.5 ? 'x' : 'z';
  // ends of the ridge (u0, u1) that are party walls
  const pend = axis === 'x' ? [party.includes('w'), party.includes('e')] : [party.includes('n'), party.includes('s')];
  const tan = Math.tan(((wh ? 7 + rr() * 3 : 30 + rr() * 8) * Math.PI) / 180);
  const half = (axis === 'x' ? b.d : b.w) / 2, rise = half * tan, t = wh ? 0.08 : 0.14, yw = y0 + floors * FH;
  let hole = null;
  const top = [...destroyed].map((k) => k.split(':')).filter((k) => +k[1] === floors - 1).map(([s, , i]) => [s, 0, +i]);
  if (top.length || damagedRoof) {
    const h = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    const grow = (ax, az, bx, bz) => { h.x0 = Math.min(h.x0, ax); h.z0 = Math.min(h.z0, az); h.x1 = Math.max(h.x1, bx); h.z1 = Math.max(h.z1, bz); };
    for (const [s, , i] of top) {
      const L = s === 'n' || s === 's' ? b.w : b.d - 2 * T, bw = L / Math.max(1, Math.round(L / (wh ? 4 : 3.2)));
      if (s === 'n' || s === 's') grow(x0 + i * bw, s === 'n' ? z0 : z1 - T, x0 + (i + 1) * bw, s === 'n' ? z0 + T : z1);
      else grow(s === 'w' ? x0 : x1 - T, z0 + T + i * bw, s === 'w' ? x0 + T : x1, z0 + T + (i + 1) * bw);
    }
    if (damagedRoof) grow(x0, corner === 'sw' ? b.z : z0, x1, corner === 'sw' ? z1 : b.z);
    // past the eaves on the sides that are the building's edge
    hole = { x0: h.x0 < x0 + T + 0.01 ? x0 - 2 : h.x0, z0: h.z0 < z0 + T + 0.01 ? z0 - 2 : h.z0, x1: h.x1 > x1 - T - 0.01 ? x1 + 2 : h.x1, z1: h.z1 > z1 - T - 0.01 ? z1 + 2 : h.z1 };
  }
  // brick chimney through one slope near the ridge, 0.5 m above it (none on sheds, or where the roof came down)
  let chimney = null;
  if (!wh && rr() < 0.65) {
    const along = (axis === 'x' ? b.w : b.d) - (kind === 'hip' ? 2 * half + 1 : 3), side = rr() < 0.5 ? -1 : 1;
    const u = (rr() - 0.5) * Math.max(0, along), v = side * (0.6 + rr() * 0.6);
    const c = { x: axis === 'x' ? b.x + u : b.x + v, z: axis === 'x' ? b.z + v : b.z + u, hx: axis === 'x' ? 0.32 : 0.26, hz: axis === 'x' ? 0.26 : 0.32, top: yw + t + rise + 0.5 };
    if (!hole || hole.x0 >= c.x + c.hx + 0.3 || hole.x1 <= c.x - c.hx - 0.3 || hole.z0 >= c.z + c.hz + 0.3 || hole.z1 <= c.z - c.hz - 0.3) chimney = c;
  }
  return {
    kind, axis, tan, half, rise, t, yw, hole, chimney, x0, x1, z0, z1, T, pend,
    n: Math.max(2, Math.min(8, Math.ceil(rise / 0.45))), // collider steps
    ov: wh ? 0.35 : 0.45, vg: wh ? 0.25 : 0.3, // eave / verge overhang
    mat: wh ? 'metal_roof' : 'roof_tiles',
  };
}

// Produces a list of boxes { min:[x,y,z], max:[x,y,z], mat, collide, part } plus ramps (stairs) and openings.
// The server uses collide:true parts; the client renders all parts with PBR materials and adds trim details.
function generateBuildingFor(map, b) {
  const rnd = mulberry32(b.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const y0 = map.buildingBase(b);
  const wh = b.style === 'warehouse';
  const bunker = b.style === 'bunker';
  const FH = wh ? 7 : bunker ? 2.8 : FLOOR_H;
  const floors = b.floors;
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const T = bunker ? 0.6 : WALL_T;
  const wallMat = { concrete: 'concrete', plaster: 'plaster', brick: 'brick', warehouse: 'metal_siding', bunker: 'concrete_slab' }[b.style];
  const parts = [], ramps = [], openings = [], details = [];
  const party = new Set(b.party || []); // sides shared with the next house of a terrace: blind walls
  const box = (ax, ay, az, bx, by, bz, mat, collide = true, part = 'wall') =>
    parts.push({ min: [Math.min(ax, bx), y0 + Math.min(ay, by), Math.min(az, bz)], max: [Math.max(ax, bx), y0 + Math.max(ay, by), Math.max(az, bz)], mat, collide, part });

  // Which upper-floor bays are destroyed (only for damaged buildings, top floors first, one corner)
  const destroyed = new Set();
  let corner = null;
  if (b.damage > 0 && !bunker) {
    corner = rnd() < 0.5 ? 'ne' : 'sw';
    const sidesAtCorner = corner === 'ne' ? ['n', 'e'] : ['s', 'w'];
    for (const s of sidesAtCorner) {
      if (party.has(s)) continue;
      const L = s === 'n' || s === 's' ? b.w : b.d;
      const nb = Math.max(1, Math.round(L / 3.2));
      const count = Math.ceil(nb * b.damage * 0.8);
      for (let f = floors - 1; f >= Math.max(0, floors - 1 - Math.floor(b.damage * 2)); f--) {
        for (let k = 0; k < count - (floors - 1 - f); k++) {
          // bays counted from the corner: the east end of the north wall, the north end of the east wall, the west
          // end of the south wall, the south end of the west wall (u runs +x / +z along every side)
          const i = s === 'n' || s === 'w' ? nb - 1 - k : k;
          if (f > 0 || b.damage > 0.7) destroyed.add(`${s}:${f}:${i}`);
        }
      }
    }
  }

  const damagedRoof = b.damage > 0.6;
  const roof = roofPlan(map, b, { y0, x0, x1, z0, z1, T, FH, floors, wh, bunker, damagedRoof, corner, destroyed });
  // Balconies: a row on one long side of most concrete blocks (every other bay, every upper floor), one over the
  // entrance of some town houses (it doubles as the door canopy). The slab top sits just under the floor level, so
  // a soldier can vault out of the window onto it; the railing stops bodies (a wrought-iron one lets bullets through).
  const balc = new Set(), balconies = [], brnd = mulberry32((b.x * 73856093) ^ (b.z * 19349663) ^ 0x2f6b);
  if (!wh && !bunker && floors >= 2) {
    const long = b.w >= b.d ? ['n', 's'] : ['w', 'e'];
    if (b.style === 'concrete' && brnd() < 0.75) {
      const s = long.find((q) => !b.doors.includes(q) && !party.has(q)) || long.find((q) => !party.has(q)), par = brnd() < 0.5 ? 0 : 1;
      if (s) for (let f = 1; f < floors; f++) for (let i = 0; i < 16; i++) if (i % 2 === par) balc.add(`${s}:${f}:${i}`);
    } else if (b.style !== 'concrete' && brnd() < 0.6 && b.doors.length) balc.add(`${b.doors[0]}:1:door`);
  }
  const balcony = (sd, u0, u1, f, solid) => {
    const bw = Math.min(u1 - u0 - 0.4, solid ? 2.8 : 2.4), cu = (u0 + u1) / 2, dep = solid ? 1.15 : 0.9;
    const top = f * FH - 0.03, th = 0.18, rh = 1.0, rt = solid ? 0.1 : 0.05;
    const alongX = sd.dir[0] !== 0, o = alongX ? sd.out[1] : sd.out[0];
    const face = (alongX ? sd.az : sd.ax) + (o > 0 ? T : 0), base = alongX ? sd.ax : sd.az;
    // u along the wall, w outward from the outer face
    const ob = (ua, ub, wa, wb, ya, yb, part, mat, bullets = true) => {
      const a = base + ua, c = base + ub, p = face + o * wa, q = face + o * wb;
      if (alongX) box(a, ya, p, c, yb, q, mat, true, part); else box(p, ya, a, q, yb, c, mat, true, part);
      if (!bullets) parts[parts.length - 1].bullets = false;
    };
    const ua = cu - bw / 2, ub = cu + bw / 2, rail = solid ? 'concrete' : 'metal';
    ob(ua, ub, 0, dep, top - th, top, 'balcony', 'concrete');
    ob(ua, ub, dep - rt, dep, top, top + rh, 'brail', rail, solid);
    ob(ua, ua + rt, 0, dep - rt, top, top + rh, 'brail', rail, solid);
    ob(ub - rt, ub, 0, dep - rt, top, top + rh, 'brail', rail, solid);
    balconies.push({ side: sd.s, f, alongX, o, face, a: base + ua, b: base + ub, dep, top: y0 + top, th, rh, rt, solid });
  };

  const sides = [
    { s: 'n', ax: x0, az: z0, dir: [1, 0], L: b.w, out: [0, -1] },
    { s: 's', ax: x0, az: z1 - T, dir: [1, 0], L: b.w, out: [0, 1] },
    { s: 'w', ax: x0, az: z0 + T, dir: [0, 1], L: b.d - 2 * T, out: [-1, 0] },
    { s: 'e', ax: x1 - T, az: z0 + T, dir: [0, 1], L: b.d - 2 * T, out: [1, 0] },
  ];
  // piece along a side: from u0..u1 along the wall, v0..v1 height
  const piece = (sd, u0, u1, v0, v1, mat, part = 'wall') => {
    if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
    if (sd.dir[0]) box(sd.ax + u0, v0, sd.az, sd.ax + u1, v1, sd.az + T, mat, true, part);
    else box(sd.ax, v0, sd.az + u0, sd.ax + T, v1, sd.az + u1, mat, true, part);
  };

  for (const sd of sides) {
    const nb = Math.max(1, Math.round(sd.L / (wh ? 4 : 3.2)));
    const bw = sd.L / nb;
    const doorBay = b.doors.includes(sd.s) ? Math.floor(nb / 2) : -1;
    for (let f = 0; f < floors; f++) {
      const fy = f * FH;
      for (let i = 0; i < nb; i++) {
        const u0 = i * bw, u1 = (i + 1) * bw;
        const key = `${sd.s}:${f}:${i}`;
        if (destroyed.has(key)) {
          // jagged remains: a low broken stub of wall
          const stub = 0.3 + rnd() * 0.9;
          piece(sd, u0, u1, fy, fy + stub, wallMat, 'broken');
          openings.push({ side: sd.s, kind: 'breach', u0, u1, v0: fy + stub, v1: fy + FH, sd: { ...sd }, y0 });
          continue;
        }
        let kind = 'window';
        const at = (sd.dir[0] ? sd.ax : sd.az) + (u0 + u1) / 2; // the bay's centre along the side (world x or z)
        if (party.has(sd.s) || b.touch?.[sd.s]?.some(([a, c]) => at > a - 0.9 && at < c + 0.9)) kind = 'solid';
        else if (f === 0 && i === doorBay) kind = wh ? 'bigdoor' : 'door';
        else if (bunker) kind = i % 2 ? 'slit' : 'solid';
        else if (wh) kind = 'highwindow';
        else if (f === 0 && (i + (b.x | 0)) % 3 === 2) kind = 'solid';
        const cu = (u0 + u1) / 2;
        if (kind === 'solid') piece(sd, u0, u1, fy, fy + FH, wallMat);
        else if (kind === 'door' || kind === 'bigdoor') {
          const dw = kind === 'bigdoor' ? Math.min(4, bw - 0.4) : 1.3, dh = kind === 'bigdoor' ? 4.6 : 2.3;
          piece(sd, u0, cu - dw / 2, fy, fy + FH, wallMat);
          piece(sd, cu + dw / 2, u1, fy, fy + FH, wallMat);
          piece(sd, cu - dw / 2, cu + dw / 2, fy + dh, fy + FH, wallMat);
          openings.push({ side: sd.s, kind, u0: cu - dw / 2, u1: cu + dw / 2, v0: fy, v1: fy + dh, sd: { ...sd }, y0 });
        } else {
          const ww = kind === 'slit' ? 1.2 : kind === 'highwindow' ? bw - 1.2 : 1.3;
          const sill = kind === 'slit' ? 1.2 : kind === 'highwindow' ? 4.4 : 0.95;
          const top = kind === 'slit' ? 1.5 : kind === 'highwindow' ? 6.0 : 2.25;
          piece(sd, u0, cu - ww / 2, fy, fy + FH, wallMat);
          piece(sd, cu + ww / 2, u1, fy, fy + FH, wallMat);
          piece(sd, cu - ww / 2, cu + ww / 2, fy, fy + sill, wallMat);
          parts[parts.length - 1].under = 1; // (visual: rain streaks below the sill)
          piece(sd, cu - ww / 2, cu + ww / 2, fy + top, fy + FH, wallMat);
          const broken = b.damage > 0 && rnd() < b.damage + 0.2;
          openings.push({ side: sd.s, kind, u0: cu - ww / 2, u1: cu + ww / 2, v0: fy + sill, v1: fy + top, sd: { ...sd }, y0, glass: !broken && kind !== 'slit' });
          if (kind === 'window' && f > 0 && (balc.has(key) || (i === doorBay && balc.has(`${sd.s}:${f}:door`)))) balcony(sd, u0, u1, f, b.style === 'concrete');
        }
      }
    }
    // parapet (flat roofs; none over destroyed top-floor bays)
    if (!wh && !roof) {
      for (let i = 0, a = 0; i <= nb; i++) {
        if (i < nb && !destroyed.has(`${sd.s}:${floors - 1}:${i}`)) continue;
        piece(sd, a * bw, i * bw, floors * FH, floors * FH + (bunker ? 0.5 : 0.9), wallMat, 'parapet'); a = i + 1;
      }
    }
  }

  // Stairwell: along the inside of the west wall, one flight per floor (on a flat roof the last flight reaches the
  // roof hatch; a pitched roof has no access: the attic floor is the top floor's ceiling).
  const stairW = 1.2;
  const run = FLOOR_H / Math.tan((34 * Math.PI) / 180);
  const flights = roof ? floors - 1 : floors;
  const hasStairs = !wh && !bunker && b.d - 2 * T > run + 1.5 && flights > 0;
  const sx0 = x0 + T, sx1 = sx0 + stairW, sz0 = z0 + T + 0.6, sz1 = sz0 + run;
  // Slabs (ground floor, intermediate floors, roof) – with stair holes
  // slabs stop half a wall thickness inside the outer faces: their edges are hidden in the walls instead of being
  // coplanar with the facade (z-fighting band). A warehouse roof has no parapet on the wall tops: it stops at the
  // inner faces so its top doesn't overlap the (coplanar) wall tops either.
  const si = T / 2;
  const slab = (y, th, mat, hole, part, ins = si) => {
    const ix0 = x0 + ins, iz0 = z0 + ins, ix1 = x1 - ins, iz1 = z1 - ins;
    if (!hole) { box(ix0, y - th, iz0, ix1, y, iz1, mat, true, part); return; }
    box(ix0, y - th, iz0, ix1, y, hole.z0, mat, true, part);
    box(ix0, y - th, hole.z1, ix1, y, iz1, mat, true, part);
    box(ix0, y - th, hole.z0, hole.x0, y, hole.z1, mat, true, part);
    box(hole.x1, y - th, hole.z0, ix1, y, hole.z1, mat, true, part);
  };
  const hole = hasStairs ? { x0: sx0 - 0.01, x1: sx1 + 0.05, z0: sz0 + run * 0.15, z1: sz1 } : null;
  slab(0.12, 0.3, wh ? 'concrete_floor' : 'concrete_floor', null, 'ground');
  for (let f = 1; f <= floors; f++) {
    const isRoof = f === floors;
    if (isRoof && damagedRoof) {
      // collapsed roof: keep only the half away from the destroyed corner (north half when the south-west is gone)
      if (corner === 'sw') box(x0 + si, f * FH - 0.25, z0 + si, x1 - si, f * FH, b.z, 'concrete_slab', true, 'roof');
      else box(x0 + si, f * FH - 0.25, b.z, x1 - si, f * FH, z1 - si, 'concrete_slab', true, 'roof');
      continue;
    }
    // under a pitched roof the top slab is the attic floor: raw concrete, no stair hole, and gone with the roof over
    // destroyed top-floor bays (open to the sky there, not a slab floating over missing walls)
    if (isRoof && roof?.hole && !wh) {
      for (const r of rectMinus([x0 + si, z0 + si, x1 - si, z1 - si], roof.hole)) box(r[0], f * FH - 0.25, r[1], r[2], f * FH, r[3], 'concrete_slab', true, 'roof');
      continue;
    }
    const mat = isRoof ? (wh ? 'metal_roof' : roof ? 'concrete_slab' : 'roof') : 'concrete_floor';
    slab(f * FH, 0.25, mat, hasStairs && f <= flights ? hole : null, isRoof ? 'roof' : 'floor', isRoof && wh ? T : si);
  }
  if (hasStairs) {
    for (let f = 0; f < flights; f++) {
      const a = f * FLOOR_H + (f === 0 ? 0.12 : 0), c = (f + 1) * FLOOR_H; // from the floor's top to the next one
      ramps.push({ x0: sx0, x1: sx1, z0: sz0, z1: sz1, y0: y0 + a, y1: y0 + c, axis: 'z', mat: 'concrete' });
      // the flight itself is solid: a stepped 0.35 m concrete slab just under the walking surface (blocks bodies
      // and bullets from the side; there is still headroom under the flight above)
      const n = Math.ceil(run / 0.5);
      for (let k = 1; k < n; k++) {
        const za = sz0 + (run * k) / n, zb = sz0 + (run * (k + 1)) / n, ya = a + ((c - a) * k) / n;
        box(sx0, Math.max(a, ya - 0.35), za, sx1, ya, zb, 'concrete', true, 'stair');
      }
    }
    // railing wall on the open side of the stair for upper floors
    for (let f = 1; f <= flights; f++) box(sx1 + 0.02, f * FLOOR_H, sz0 + run * 0.15, sx1 + 0.08, f * FLOOR_H + 1.0, sz1, 'metal', true, 'rail');
  }
  // Pitched roof: the attic is solid. Stacked boxes, each narrower by one step, approximate the slopes (gable: across
  // the span only, the gable walls are the box ends; hip: on all four sides) so bullets, grenades and soldiers stop
  // on the roof; their tops follow the tiles' surface at mid-step. Nothing over the collapsed part (roof.hole).
  if (roof) {
    const { n, half, rise, t } = roof, hip = roof.kind === 'hip', ax = roof.axis === 'x';
    for (let k = 0; k < n; k++) {
      const ins = ((k + 0.5) / n) * half, ya = k ? roof.yw + t + (k * rise) / n : roof.yw, yb = roof.yw + t + ((k + 1) * rise) / n;
      const ix = ax ? (hip ? ins : 0) : ins, iz = ax ? ins : hip ? ins : 0;
      for (const r of rectMinus([x0 + ix, z0 + iz, x1 - ix, z1 - iz], roof.hole)) box(r[0], ya - y0, r[1], r[2], yb - y0, r[3], roof.mat, true, 'attic');
    }
    const c = roof.chimney;
    if (c) box(c.x - c.hx, roof.yw - y0, c.z - c.hz, c.x + c.hx, c.top - y0, c.z + c.hz, 'brick', true, 'chimney');
  }
  // interior partition on bigger houses (with a doorway)
  if (!wh && !bunker && b.w >= 10) {
    const px = b.x + 1.5;
    for (let f = 0; f < floors; f++) {
      const fy = f * FH;
      const fb = fy + (f === 0 ? 0.12 : 0); // floor top (ground slab is 0.12 m up, upper slabs end at fy)
      box(px, fb, z0 + T, px + 0.15, fy + FH - 0.25, b.z - 0.6, 'plaster_int', true, 'interior');
      box(px, fb, b.z + 0.6, px + 0.15, fy + FH - 0.25, z1 - T, 'plaster_int', true, 'interior');
      box(px, fy + 2.2, b.z - 0.6, px + 0.15, fy + FH - 0.25, b.z + 0.6, 'plaster_int', true, 'interior');
    }
  }
  return { id: b.id, spec: b, y0, FH, T, parts, ramps, openings, details, destroyed: [...destroyed], roof, balconies };
}

