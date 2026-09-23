// Map definition: the single source of truth for gameplay collision AND the visual layout.
// Everything here is plain data + deterministic generators so server & client build the same world.
import { mulberry32, fbm, smoothstep, clamp } from './util.js';

export const MAP_HALF = 190;      // terrain extent (m)
export const PLAY_HALF = 168;     // playable boundary
export const FLOOR_H = 3.2;
export const WALL_T = 0.3;

export const TEAMS = { US: 1, RU: 2 };
export const TEAM_NAMES = { 1: 'US', 2: 'RU' };

// ---------------------------------------------------------------- roads
export const ROADS = [
  { ax: 8, az: -186, bx: 8, bz: 186, w: 9, name: 'main' },
  { ax: -186, az: 0, bx: 186, bz: 0, w: 8, name: 'cross' },
  { ax: -186, az: 78, bx: 60, bz: 78, w: 7, name: 'north-a' },
  { ax: -60, az: -78, bx: 186, bz: -78, w: 7, name: 'south-c' },
  { ax: -40, az: 78, bx: -40, bz: 130, w: 6, name: 'a-spur' },
  { ax: 40, az: -78, bx: 40, bz: -130, w: 6, name: 'c-spur' },
];

// ---------------------------------------------------------------- flags / bases
export const FLAGS = [
  { id: 'A', x: -40, z: 70, r: 13 },
  { id: 'B', x: 6, z: -4, r: 15 },
  { id: 'C', x: 40, z: -70, r: 13 },
];

export const BASES = {
  1: { x: 8, z: 152, yaw: 0 },         // US spawns in the south, facing north (-z)
  2: { x: 8, z: -152, yaw: Math.PI },  // RU spawns in the north, facing south (+z)
};

// ---------------------------------------------------------------- buildings
// style: concrete | plaster | brick | warehouse | bunker ; damage 0..1 ; doors: sides with a ground-floor door
export const BUILDINGS = [
  // Town centre (B) – partially ruined
  { id: 'b1', x: -20, z: -18, w: 12, d: 10, floors: 2, style: 'plaster', damage: 0.55, doors: ['s', 'e'] },
  { id: 'b2', x: 27, z: -17, w: 10, d: 12, floors: 3, style: 'concrete', damage: 0.3, doors: ['w', 's'] },
  { id: 'b3', x: -22, z: 19, w: 14, d: 9, floors: 2, style: 'brick', damage: 0, doors: ['n', 'e'] },
  { id: 'b4', x: 28, z: 20, w: 10, d: 10, floors: 1, style: 'plaster', damage: 0.85, doors: ['w', 'n'] },
  { id: 'b5', x: -46, z: -16, w: 9, d: 12, floors: 2, style: 'concrete', damage: 0.15, doors: ['e'] },
  { id: 'b6', x: 52, z: 13, w: 12, d: 10, floors: 2, style: 'brick', damage: 0.4, doors: ['w'] },
  { id: 'b7', x: -44, z: 22, w: 10, d: 9, floors: 1, style: 'plaster', damage: 0.2, doors: ['s'] },
  // A – industrial yard
  { id: 'w1', x: -64, z: 58, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.1, doors: ['e', 'w'] },
  { id: 'a2', x: -28, z: 95, w: 10, d: 10, floors: 2, style: 'concrete', damage: 0, doors: ['s', 'w'] },
  { id: 'a3', x: -18, z: 55, w: 8, d: 12, floors: 1, style: 'plaster', damage: 0.3, doors: ['w'] },
  { id: 'a4', x: -78, z: 98, w: 12, d: 9, floors: 2, style: 'brick', damage: 0, doors: ['e'] },
  // C – depot
  { id: 'w2', x: 64, z: -58, w: 24, d: 16, floors: 1, style: 'warehouse', damage: 0.25, doors: ['e', 'w'] },
  { id: 'c2', x: 28, z: -95, w: 10, d: 10, floors: 2, style: 'concrete', damage: 0.35, doors: ['n', 'e'] },
  { id: 'c3', x: 20, z: -55, w: 8, d: 12, floors: 1, style: 'plaster', damage: 0.2, doors: ['e'] },
  { id: 'c4', x: 80, z: -98, w: 12, d: 9, floors: 2, style: 'brick', damage: 0.1, doors: ['w'] },
  // Bases
  { id: 'us1', x: -12, z: 146, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['n', 'e'] },
  { id: 'ru1', x: 28, z: -146, w: 8, d: 8, floors: 1, style: 'bunker', damage: 0, doors: ['s', 'w'] },
  // Outskirts (background / flanks)
  { id: 'o1', x: 110, z: 40, w: 10, d: 10, floors: 2, style: 'plaster', damage: 0.2, doors: ['w'] },
  { id: 'o2', x: -110, z: -40, w: 10, d: 10, floors: 2, style: 'plaster', damage: 0.1, doors: ['e'] },
  { id: 'o3', x: 96, z: 112, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0.5, doors: ['w'] },
  { id: 'o4', x: -96, z: -112, w: 12, d: 10, floors: 3, style: 'concrete', damage: 0.5, doors: ['e'] },
  { id: 'o5', x: 130, z: -30, w: 9, d: 12, floors: 2, style: 'brick', damage: 0, doors: ['w'] },
  { id: 'o6', x: -130, z: 30, w: 9, d: 12, floors: 2, style: 'brick', damage: 0, doors: ['e'] },
];

// ---------------------------------------------------------------- props
// Collider half-extents are measured from the optimized GLB bounds (see scripts/build-assets.mjs).
export const PROP_TYPES = {
  barrier: { half: [0.77, 0.41, 0.31], oy: 0.41, surface: 'concrete' },
  barrier2: { half: [0.78, 0.55, 0.22], oy: 0.55, surface: 'concrete' },
  crate: { half: [0.62, 0.23, 0.26], oy: 0.23, surface: 'wood' },
  crate_stack: { half: [0.62, 0.69, 0.55], oy: 0.69, surface: 'wood' },
  barrel: { half: [0.28, 0.44, 0.28], oy: 0.44, surface: 'metal' },
  car: { half: [0.9, 0.7, 2.2], oy: 0.7, surface: 'metal' },
  generator: { half: [0.41, 0.29, 0.28], oy: 0.29, surface: 'metal' },
  utility: { half: [0.26, 0.56, 0.22], oy: 0.56, surface: 'metal' },
  lamp: { half: [0.12, 1.9, 0.12], oy: 1.9, surface: 'metal' },
  container: { half: [3.03, 1.3, 1.22], oy: 1.3, surface: 'metal' },
  sandbags: { half: null, surface: 'sand' },     // length-driven
  fence: { half: null, surface: 'metal', bullets: false },
  wall: { half: null, surface: 'concrete' },     // perimeter concrete wall, length-driven
  pole: { half: [0.18, 3.5, 0.18], oy: 3.5, surface: 'wood' },
  trash: { half: [0.9, 0.46, 0.28], oy: 0.46, surface: 'metal' },
  debris: { half: null, surface: 'concrete' },   // visual only
  tyre: { half: null, surface: 'rubber' },
  jerrycan: { half: null, surface: 'metal' },
  ammo: { half: null, surface: 'wood' },
};

function buildProps() {
  const P = [];
  const add = (type, x, z, rot = 0, extra = {}) => P.push({ type, x, z, rot, ...extra });
  // --- B (intersection): barricades, burnt cars, sandbags
  add('car', -3, 8, 1, { burnt: true }); add('car', 18, -9, 0, { burnt: true });
  add('barrier', 0, -12, 0); add('barrier', 1.6, -12.2, 0); add('barrier2', 14, 6, 1); add('barrier2', 14, 7.7, 1);
  add('sandbags', 6, 10, 0, { len: 5 }); add('sandbags', -6, -6, 1, { len: 4 }); add('sandbags', 18, 4, 1, { len: 4 });
  add('crate_stack', -8, 3, 0); add('crate', -8.2, 5, 1); add('barrel', 20, -3); add('barrel', 20.7, -2.4);
  add('container', -14, -3, 0); add('container', 36, 3, 1);
  add('trash', -12, 11, 0); add('utility', 13.5, -13, 0); add('generator', -2, -15, 0);
  add('lamp', 13.8, -8, 0); add('lamp', 2.2, 12, 0); add('lamp', 13.8, 24, 0); add('lamp', 2.2, -26, 0);
  // --- A (industrial yard)
  add('container', -44, 60, 1); add('container', -44, 60, 1, { stackOn: true, y: 2.6 });
  add('container', -52, 84, 0); add('container', -30, 66, 0);
  add('crate_stack', -38, 64, 0); add('crate', -36.5, 63.6, 1); add('barrel', -34, 74); add('barrel', -33.4, 74.6); add('barrel', -48, 73);
  add('sandbags', -40, 82, 0, { len: 6 }); add('sandbags', -50, 70, 1, { len: 4 }); add('barrier', -26, 74, 1); add('barrier', -26, 72.4, 1);
  add('car', -58, 76, 0); add('generator', -52, 66, 1); add('utility', -76, 68, 0);
  add('fence', -90, 46, 0, { len: 36 }); add('fence', -90, 46, 1, { len: 26 });
  add('lamp', -20, 81.5, 0); add('lamp', -60, 81.5, 0);
  // --- C (depot) mirrored
  add('container', 44, -60, 1); add('container', 44, -60, 1, { stackOn: true, y: 2.6 });
  add('container', 52, -84, 0); add('container', 30, -66, 0);
  add('crate_stack', 38, -64, 0); add('crate', 36.5, -63.6, 1); add('barrel', 34, -74); add('barrel', 33.4, -74.6); add('barrel', 48, -73);
  add('sandbags', 40, -82, 0, { len: 6 }); add('sandbags', 50, -70, 1, { len: 4 }); add('barrier', 26, -74, 1); add('barrier', 26, -72.4, 1);
  add('car', 58, -76, 0, { burnt: true }); add('generator', 52, -66, 1); add('utility', 76, -68, 0);
  add('fence', 54, -46, 0, { len: 36 }); add('fence', 90, -46, 1, { len: 26 });
  add('lamp', 20, -81.5, 0); add('lamp', 60, -81.5, 0);
  // --- open fields between objectives: scattered cover
  add('sandbags', -18, 38, 0, { len: 5 }); add('sandbags', 22, -38, 0, { len: 5 });
  add('barrier', -30, 40, 0); add('barrier', 30, -40, 0); add('barrier2', 40, 44, 0); add('barrier2', -40, -44, 0);
  add('car', 60, 40, 1); add('car', -60, -40, 1, { burnt: true }); add('crate_stack', 70, 30, 0); add('crate_stack', -70, -30, 0);
  add('container', 90, 60, 1); add('container', -90, -60, 1); add('container', 110, -70, 0); add('container', -110, 70, 0);
  // --- bases
  for (const [t, s] of [[1, 1], [2, -1]]) {
    const bz = BASES[t].z;
    add('sandbags', -6, bz - s * 10, 0, { len: 8 }); add('sandbags', 22, bz - s * 10, 0, { len: 8 });
    add('barrier', 2.5, bz - s * 14, 0); add('barrier', 13.5, bz - s * 14, 0);
    add('crate_stack', -2, bz + s * 4, 0); add('crate_stack', 20, bz + s * 4, 1); add('generator', 24, bz + s * 1, 0);
    add('container', 32, bz + s * 6, 1); add('container', -24, bz - s * 2, 1);
    add('wall', 8, bz + s * 20, 0, { len: 60 });
    add('fence', -24, bz - s * 16, 1, { len: 30 }); add('fence', 40, bz - s * 16, 1, { len: 30 });
  }
  // street lamps along the main road
  for (let z = -140; z <= 140; z += 35) if (Math.abs(z) > 30) add('lamp', 13.8, z + 5, 0);
  // debris scatter around damaged buildings (visual)
  const rnd = mulberry32(99);
  for (const b of BUILDINGS) {
    if (!b.damage) continue;
    const n = Math.round(4 + b.damage * 10);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, r = Math.max(b.w, b.d) * 0.5 + 1 + rnd() * 4;
      add('debris', b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, rnd() * 6.28, { s: 0.6 + rnd() * 1.2 });
    }
    for (let i = 0; i < 3; i++) add(rnd() < 0.5 ? 'tyre' : 'jerrycan', b.x + (rnd() - 0.5) * (b.w + 6), b.z + (rnd() - 0.5) * (b.d + 6), rnd() * 6.28);
  }
  return P;
}
export const PROPS = buildProps();

// ---------------------------------------------------------------- terrain
function distToSeg(px, pz, r) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  const t = clamp(((px - r.ax) * dx + (pz - r.az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = r.ax + dx * t - px, z = r.az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
export function roadDistance(x, z) {
  let d = Infinity;
  for (const r of ROADS) d = Math.min(d, distToSeg(x, z, r) - r.w / 2);
  return d;
}
function featureDistance(x, z) {
  let d = roadDistance(x, z) - 2.5;
  for (const b of BUILDINGS) {
    const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
    d = Math.min(d, Math.hypot(dx, dz) - 3);
  }
  for (const f of FLAGS) d = Math.min(d, Math.hypot(x - f.x, z - f.z) - f.r);
  for (const t of [1, 2]) d = Math.min(d, Math.hypot(x - BASES[t].x, z - BASES[t].z) - 30);
  return d;
}

// Rough ground: gentle rolling hills away from built-up areas, raised berms/hills at the edges.
export function terrainHeight(x, z) {
  const n = (fbm(x / 70, z / 70, 4, 7) - 0.5) * 9 + (fbm(x / 18, z / 18, 2, 11) - 0.5) * 1.2;
  const mask = smoothstep(0, 22, featureDistance(x, z));
  const edge = smoothstep(PLAY_HALF - 25, MAP_HALF, Math.max(Math.abs(x), Math.abs(z)));
  return n * mask + edge * 16 * (0.6 + fbm(x / 30, z / 30, 2, 5) * 0.8);
}

// Precomputed height grid for fast queries (bilinear).
const HG_RES = 1; // metres per sample
const HG_N = (MAP_HALF * 2) / HG_RES + 1;
let HG = null;
function buildHeightGrid() {
  HG = new Float32Array(HG_N * HG_N);
  for (let j = 0; j < HG_N; j++) for (let i = 0; i < HG_N; i++) HG[j * HG_N + i] = terrainHeight(-MAP_HALF + i * HG_RES, -MAP_HALF + j * HG_RES);
}
export function groundHeight(x, z) {
  if (!HG) buildHeightGrid();
  const fx = clamp((x + MAP_HALF) / HG_RES, 0, HG_N - 1.001), fz = clamp((z + MAP_HALF) / HG_RES, 0, HG_N - 1.001);
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
  const a = HG[j * HG_N + i], b = HG[j * HG_N + i + 1], c = HG[(j + 1) * HG_N + i], d = HG[(j + 1) * HG_N + i + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

// Building base height: the flattened ground at its centre.
export const buildingBase = (b) => groundHeight(b.x, b.z);

// ---------------------------------------------------------------- building generator
// Produces a list of boxes { min:[x,y,z], max:[x,y,z], mat, collide, part } plus ramps (stairs) and openings.
// The server uses collide:true parts; the client renders all parts with PBR materials and adds trim details.
export function generateBuilding(b) {
  const rnd = mulberry32(b.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const y0 = buildingBase(b);
  const wh = b.style === 'warehouse';
  const bunker = b.style === 'bunker';
  const FH = wh ? 7 : bunker ? 2.8 : FLOOR_H;
  const floors = b.floors;
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const T = bunker ? 0.6 : WALL_T;
  const wallMat = { concrete: 'concrete', plaster: 'plaster', brick: 'brick', warehouse: 'metal_siding', bunker: 'concrete_slab' }[b.style];
  const parts = [], ramps = [], openings = [], details = [];
  const box = (ax, ay, az, bx, by, bz, mat, collide = true, part = 'wall') =>
    parts.push({ min: [Math.min(ax, bx), y0 + Math.min(ay, by), Math.min(az, bz)], max: [Math.max(ax, bx), y0 + Math.max(ay, by), Math.max(az, bz)], mat, collide, part });

  // Which upper-floor bays are destroyed (only for damaged buildings, top floors first, one corner)
  const destroyed = new Set();
  if (b.damage > 0 && !bunker) {
    const corner = rnd() < 0.5 ? 'ne' : 'sw';
    const sidesAtCorner = corner === 'ne' ? ['n', 'e'] : ['s', 'w'];
    for (const s of sidesAtCorner) {
      const L = s === 'n' || s === 's' ? b.w : b.d;
      const nb = Math.max(1, Math.round(L / 3.2));
      const count = Math.ceil(nb * b.damage * 0.8);
      for (let f = floors - 1; f >= Math.max(0, floors - 1 - Math.floor(b.damage * 2)); f--) {
        for (let k = 0; k < count - (floors - 1 - f); k++) {
          const i = (s === 'n' || s === 'w') === (corner === 'ne') ? nb - 1 - k : k;
          if (f > 0 || b.damage > 0.7) destroyed.add(`${s}:${f}:${i}`);
        }
      }
    }
  }

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
        if (f === 0 && i === doorBay) kind = wh ? 'bigdoor' : 'door';
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
          piece(sd, cu - ww / 2, cu + ww / 2, fy + top, fy + FH, wallMat);
          const broken = b.damage > 0 && rnd() < b.damage + 0.2;
          openings.push({ side: sd.s, kind, u0: cu - ww / 2, u1: cu + ww / 2, v0: fy + sill, v1: fy + top, sd: { ...sd }, y0, glass: !broken && kind !== 'slit' });
        }
      }
    }
    // parapet
    if (!wh) piece(sd, 0, sd.L, floors * FH, floors * FH + (bunker ? 0.5 : 0.9), wallMat, 'parapet');
  }

  // Stairwell: along the inside of the west wall, one flight per floor (last flight reaches the roof hatch).
  const stairW = 1.2;
  const run = FLOOR_H / Math.tan((34 * Math.PI) / 180);
  const hasStairs = !wh && !bunker && b.d - 2 * T > run + 1.5;
  const sx0 = x0 + T, sx1 = sx0 + stairW, sz0 = z0 + T + 0.6, sz1 = sz0 + run;
  // Slabs (ground floor, intermediate floors, roof) – with stair holes
  const slab = (y, th, mat, hole, part) => {
    const ix0 = x0 + (part === 'ground' ? 0 : T * 0), iz0 = z0, ix1 = x1, iz1 = z1;
    if (!hole) { box(ix0, y - th, iz0, ix1, y, iz1, mat, true, part); return; }
    box(ix0, y - th, iz0, ix1, y, hole.z0, mat, true, part);
    box(ix0, y - th, hole.z1, ix1, y, iz1, mat, true, part);
    box(ix0, y - th, hole.z0, hole.x0, y, hole.z1, mat, true, part);
    box(hole.x1, y - th, hole.z0, ix1, y, hole.z1, mat, true, part);
  };
  const hole = hasStairs ? { x0: sx0 - 0.01, x1: sx1 + 0.05, z0: sz0 + run * 0.15, z1: sz1 } : null;
  slab(0.12, 0.3, wh ? 'concrete_floor' : 'concrete_floor', null, 'ground');
  const damagedRoof = b.damage > 0.6;
  for (let f = 1; f <= floors; f++) {
    const isRoof = f === floors;
    if (isRoof && damagedRoof) {
      // collapsed roof: keep only the half away from the destroyed corner
      box(x0, f * FH - 0.25, b.z, x1, f * FH, z1, 'concrete_slab', true, 'roof');
      continue;
    }
    slab(f * FH, 0.25, isRoof ? (wh ? 'metal_roof' : 'roof') : 'concrete_floor', hasStairs ? hole : null, isRoof ? 'roof' : 'floor');
  }
  if (hasStairs) {
    for (let f = 0; f < floors; f++) {
      ramps.push({ x0: sx0, x1: sx1, z0: sz0, z1: sz1, y0: y0 + f * FLOOR_H + 0.12, y1: y0 + (f + 1) * FLOOR_H, axis: 'z', mat: 'concrete' });
    }
    // railing wall on the open side of the stair for upper floors
    for (let f = 1; f <= floors; f++) box(sx1 + 0.02, f * FLOOR_H, sz0 + run * 0.15, sx1 + 0.08, f * FLOOR_H + 1.0, sz1, 'metal', true, 'rail');
  }
  // interior partition on bigger houses (with a doorway)
  if (!wh && !bunker && b.w >= 10) {
    const px = b.x + 1.5;
    for (let f = 0; f < floors; f++) {
      const fy = f * FH;
      box(px, fy + 0.12, z0 + T, px + 0.15, fy + FH - 0.25, b.z - 0.6, 'plaster_int', true, 'interior');
      box(px, fy + 0.12, b.z + 0.6, px + 0.15, fy + FH - 0.25, z1 - T, 'plaster_int', true, 'interior');
      box(px, fy + 2.2, b.z - 0.6, px + 0.15, fy + FH - 0.25, b.z + 0.6, 'plaster_int', true, 'interior');
    }
  }
  return { id: b.id, spec: b, y0, FH, T, parts, ramps, openings, details, destroyed: [...destroyed] };
}

// ---------------------------------------------------------------- vegetation (deterministic placement)
export function generateVegetation() {
  const rnd = mulberry32(4242);
  const trees = [], shrubs = [], rocks = [];
  const blocked = (x, z, pad) => {
    if (roadDistance(x, z) < pad + 1) return true;
    for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
    for (const f of FLAGS) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.8) return true;
    for (const p of PROPS) if (Math.hypot(x - p.x, z - p.z) < 2.5 + (p.len || 0) / 2) return true;
    for (const t of [1, 2]) if (Math.hypot(x - BASES[t].x, z - BASES[t].z) < 26) return true;
    return false;
  };
  // tree belts/clusters
  for (let i = 0; i < 900 && trees.length < 260; i++) {
    const cx = (rnd() - 0.5) * 2 * (MAP_HALF - 6), cz = (rnd() - 0.5) * 2 * (MAP_HALF - 6);
    const n = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const x = cx + (rnd() - 0.5) * 14, z = cz + (rnd() - 0.5) * 14;
      if (Math.abs(x) > MAP_HALF - 3 || Math.abs(z) > MAP_HALF - 3 || blocked(x, z, 3)) continue;
      trees.push({ x, z, s: 1.25 + rnd() * 0.9, r: rnd() * Math.PI * 2, dead: rnd() < 0.07 });
    }
  }
  for (let i = 0; i < 700; i++) {
    const x = (rnd() - 0.5) * 2 * (MAP_HALF - 4), z = (rnd() - 0.5) * 2 * (MAP_HALF - 4);
    if (!blocked(x, z, 1.5)) shrubs.push({ x, z, s: 1.4 + rnd() * 1.6, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'shrub' : 'fern' });
  }
  for (let i = 0; i < 160; i++) {
    const x = (rnd() - 0.5) * 2 * (MAP_HALF - 4), z = (rnd() - 0.5) * 2 * (MAP_HALF - 4);
    if (!blocked(x, z, 2)) rocks.push({ x, z, s: 6 + rnd() * 14, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'rock_07' : 'rock_09' });
  }
  return { trees, shrubs, rocks };
}
