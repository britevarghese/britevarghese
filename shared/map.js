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

function distToSeg(px, pz, r) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  const t = clamp(((px - r.ax) * dx + (pz - r.az) * dz) / (dx * dx + dz * dz), 0, 1);
  const x = r.ax + dx * t - px, z = r.az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}

export class GameMap {
  constructor(def) {
    this.def = def;
    this.id = def.id; this.name = def.name;
    this.MAP_HALF = def.mapHalf; this.PLAY_HALF = def.playHalf;
    this.ROADS = def.roads; this.FLAGS = def.flags; this.BASES = def.bases; this.BUILDINGS = def.buildings;
    this.terrain = { amp: 9, scale: 70, detail: 1.2, edge: 16, seed: 7, flatten: 22, baseAmp: 0, baseScale: 300, ...def.terrain };
    this.sea = def.sea || null;
    this.atmosphere = def.atmosphere || {};
    const props = def.props(def.bases);
    // debris scatter around damaged buildings (visual)
    const rnd = mulberry32(99);
    for (const b of this.BUILDINGS) {
      if (!b.damage) continue;
      const n = Math.round(4 + b.damage * 10);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, r = Math.max(b.w, b.d) * 0.5 + 1 + rnd() * 4;
        props.push({ type: 'debris', x: b.x + Math.cos(a) * r, z: b.z + Math.sin(a) * r, rot: rnd() * 6.28, s: 0.6 + rnd() * 1.2 });
      }
      for (let i = 0; i < 3; i++) props.push({ type: rnd() < 0.5 ? 'tyre' : 'jerrycan', x: b.x + (rnd() - 0.5) * (b.w + 6), z: b.z + (rnd() - 0.5) * (b.d + 6), rot: rnd() * 6.28 });
    }
    this.PROPS = props;
    this.HG = null;
    for (const k of ['roadDistance', 'featureDistance', 'terrainHeight', 'groundHeight', 'buildingBase', 'generateBuilding', 'generateVegetation', 'seaFactor']) this[k] = this[k].bind(this);
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

  buildingBase(b) { return this.groundHeight(b.x, b.z); }

  generateBuilding(b) { return generateBuildingFor(this, b); }

  generateVegetation() {
    const V = { seed: 4242, trees: 440, shrubs: 1300, rocks: 160, clusters: 5, ...this.def.vegetation };
    const rnd = mulberry32(V.seed);
    const trees = [], shrubs = [], rocks = [];
    const H = this.MAP_HALF;
    const blocked = (x, z, pad) => {
      if (this.roadDistance(x, z) < pad + 1 || this.seaFactor(x, z) > 0.01) return true;
      for (const b of this.BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return true;
      for (const f of this.FLAGS) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.8) return true;
      for (const p of this.PROPS) if (Math.hypot(x - p.x, z - p.z) < 2.5 + (p.len || 0) / 2) return true;
      for (const t of [1, 2]) if (Math.hypot(x - this.BASES[t].x, z - this.BASES[t].z) < 26) return true;
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
    for (let i = 0; i < V.shrubs; i++) {
      const x = (rnd() - 0.5) * 2 * (H - 4), z = (rnd() - 0.5) * 2 * (H - 4);
      if (!blocked(x, z, 1.5)) shrubs.push({ x, z, s: 1.4 + rnd() * 1.6, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'shrub' : 'fern' });
    }
    for (let i = 0; i < V.rocks; i++) {
      const x = (rnd() - 0.5) * 2 * (H - 4), z = (rnd() - 0.5) * 2 * (H - 4);
      if (!blocked(x, z, 2)) rocks.push({ x, z, s: 6 + rnd() * 14, r: rnd() * 6.28, kind: rnd() < 0.5 ? 'rock_07' : 'rock_09' });
    }
    return { trees, shrubs, rocks };
  }
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

