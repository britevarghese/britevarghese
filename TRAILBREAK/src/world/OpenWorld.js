// The open world at run time (world/maps/world.js): its maps, each a World (world/World.js) in its own frame standing
// at its centre, joined into one ground. It answers as one World does, in world coordinates (the physics, the game,
// and what is drawn across the maps ask it), sending each question to the map whose square holds the point; and it
// gathers what the game shows of them all (beacons, buildings, roads and tracks, events) into world coordinates.
//
// The maps come in one by one as they are built (the one the trucks start on first): until a map is here its ground
// is the far land, and nobody drives onto it.
//
// Across the maps: a beacon's id is its map's place in the world's list times 100 and its own; a tree or roadside
// thing's key carries its map's id ('kerala:t123', world/World.js's key after the colon); an obstacle's index (what
// treesNear finds, for strike) its map's place times OB_STRIDE and its own.

import { SURFACES, SURFACE } from '../physics/Surfaces.js';
import { World } from './World.js';
import { WINCH_CAP } from './Breakables.js';
import { REGIONS, WORLD } from './maps/world.js';
import { gridOf } from './maps/index.js';
import { eventsFor } from '../game/Events.js';
import { racesFor } from '../game/Races.js';
import { modesFor } from '../game/Modes.js';

export const OB_STRIDE = 1 << 24;
export const BEACON_STRIDE = 100;
const FAR_FADE = 160;            // m: how far out the far land takes over from a map's own edge

/** The world's bounds (all its maps' squares): { x0, z0, x1, z1 }. */
export function worldBox() {
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (const R of REGIONS) {
    const h = gridOf(R.map).half;
    b.x0 = Math.min(b.x0, R.at[0] - h); b.x1 = Math.max(b.x1, R.at[0] + h);
    b.z0 = Math.min(b.z0, R.at[1] - h); b.z1 = Math.max(b.z1, R.at[1] + h);
  }
  return b;
}

const moveXZ = (p, cx, cz) => ({ ...p, x: p.x + cx, z: p.z + cz });
const movePts = (pts, cx, cz) => pts.map(([x, z, ...rest]) => [x + cx, z + cz, ...rest]);

/** An event of a map (game/Events.js, Races.js, Modes.js) moved into the world. */
function moveEvent(e, cx, cz) {
  const out = { ...e, start: moveXZ(e.start, cx, cz), gates: e.gates.map((g) => moveXZ(g, cx, cz)) };
  if (e.line) out.line = movePts(e.line, cx, cz);
  if (e.center) out.center = moveXZ(e.center, cx, cz);
  if (e.hill) out.hill = moveXZ(e.hill, cx, cz);
  return out;
}

export class OpenWorld {
  /** home: where this driver's truck starts ({ x, z, yaw, name }: world/homes.js), else the start map's own spawn. */
  constructor(def = WORLD, home = null) {
    this.def = def;
    this.regions = [];
    this.byId = new Map();
    this.last = null;
    this.box = worldBox();
    // a square round it all (the maps of it are drawn on one)
    const size = Math.max(this.box.x1 - this.box.x0, this.box.z1 - this.box.z0);
    this.mapBox = { x0: (this.box.x0 + this.box.x1 - size) / 2, z0: (this.box.z0 + this.box.z1 - size) / 2, size };
    this.half = size / 2;
    const S = REGIONS.find((R) => R.id === def.start), M = S.map;
    // the air over most of it: the start map's (a map with its own takes over inside it: airAt)
    this.air0 = { fog: M.atmosphere?.fog ?? 0.00038, cover: M.atmosphere?.cover ?? 0.47, sun: 1, sat: 1 };
    this.airOut = { ...this.air0 };
    // where the truck starts: its home, or the start map's own spawn and station
    this.map = {
      ...def, mudTint: M.mudTint, dust: M.dust, snowLine: M.snowLine,
      spawn: home ? { x: home.x, z: home.z, yaw: home.yaw, name: home.name } : moveXZ(M.spawn, ...S.at), station: moveXZ(M.station, ...S.at),
    };
    this.beacons = []; this.landmarks = []; this.data = { trails: [], map: this.map }; this.hubs = [];
    this.obPool = [];
    for (let k = 0; k < 64; k++) this.obPool.push({ x: 0, y: 0, z: 0, r: 0, cap: Infinity, top: 0, u: -1, i: 0, tree: false });
    this.tmpOb = [];
    this.onRegion = [];          // (called with each map as it comes in)
    this.propList = []; this.props = [];
    // the ruts pressed on each map, for its renderers (render/WorldView.js): map id -> chunk keys, or null
    this.deformGrid = {
      takeDirty: () => {
        let out = null;
        for (const r of this.regions) { const d = r.world.deformGrid.takeDirty(); if (d) (out ||= new Map()).set(r.id, d); }
        return out;
      },
    };
  }

  /** The station yard nearest a point, of the maps in: { x, z, yaw, name } (where a truck is towed back to). */
  spawnNear(p) {
    let best = null, bd = Infinity;
    for (const r of this.regions) {
      const M = r.map;
      if (!M.spawn || !M.station) continue;
      const d = Math.hypot(M.station.x + r.cx - p.x, M.station.z + r.cz - p.z);
      if (d < bd) { bd = d; best = { x: M.spawn.x + r.cx, z: M.spawn.z + r.cz, yaw: M.spawn.yaw, name: M.station.name }; }
    }
    return best;
  }

  /** A map's station yard, in the world: { x, z, yaw, name } (null while that map isn't in). */
  spawnOf(id) {
    const r = this.byId.get(id), M = r?.map;
    return M?.spawn && M.station ? { x: M.spawn.x + r.cx, z: M.spawn.z + r.cz, yaw: M.spawn.yaw, name: M.station.name } : null;
  }

  /** Every map's station, in the world, whether its map is in yet or not: { region, name, mapName, x, z }. */
  stations() {
    return REGIONS.filter((R) => R.map.station).map((R) => ({ region: R.id, name: R.map.station.name, mapName: R.map.name, x: R.map.station.x + R.at[0], z: R.map.station.z + R.at[1] }));
  }

  /**
   * The tors on the maps that are in (their rocky hills, world/WorldGen.js): the stacks of jointed blocks on their
   * most prominent crests, bare rock round them. { region, mapName, n (its number on its map), x, z, r }.
   */
  tors() {
    return this.regions.flatMap((r) => (r.world.data.tors || []).map(([x, z, tr], i) => ({ region: r.id, mapName: r.map.name, n: i + 1, x: x + r.cx, z: z + r.cz, r: tr })));
  }

  /** The map whose square (x, z) is in, whether it is in yet or not (its definition), or null. */
  regionDefAt(x, z) {
    return REGIONS.find((R) => { const h = gridOf(R.map).half; return Math.abs(x - R.at[0]) <= h && Math.abs(z - R.at[1]) <= h; }) || null;
  }

  /** A map of the world's definition (world/maps/world.js), by id. */
  regionDef(id) { return REGIONS.find((R) => R.id === id); }

  /** A map built (its generated data, world/WorldGen.js, in its own frame): it joins the world. */
  add(id, data) {
    const R = REGIONS.find((q) => q.id === id), index = REGIONS.indexOf(R), [cx, cz] = R.at;
    const world = data instanceof World ? data : new World(data);
    const region = { id, index, cx, cz, half: world.half, world, map: world.map };
    this.regions.push(region);
    this.regions.sort((a, b) => a.index - b.index);
    this.byId.set(id, region);
    this.beacons.push(...world.beacons.map((b) => ({ ...moveXZ(b, cx, cz), id: index * BEACON_STRIDE + b.id, local: b.id, region: id })));
    this.landmarks.push(...world.landmarks.map((L) => ({ ...moveXZ(L, cx, cz), region: id })));
    this.data.trails.push(...(world.data.trails || []).map((t) => ({ ...t, points: movePts(t.points, cx, cz), region: id })));
    this.boulderList = null;
    if (this.propList.length) this.setProps(this.propList);
    if (world.map.station) this.hubs.push({ x: world.map.station.x + cx, z: world.map.station.z + cz, r: 90 });
    for (const fn of this.onRegion) fn(region);
    return region;
  }

  /** The map whose square holds (x, z) (on a seam, either), or null. */
  regionAt(x, z) {
    const r = this.last;
    if (r && Math.abs(x - r.cx) <= r.half && Math.abs(z - r.cz) <= r.half) return r;
    for (const q of this.regions) if (Math.abs(x - q.cx) <= q.half && Math.abs(z - q.cz) <= q.half) return (this.last = q);
    return null;
  }

  /** Is every map built? */
  get complete() { return this.regions.length === REGIONS.length; }

  // ---------------------------------------------------------------- the ground
  terrain(x, z) { const r = this.regionAt(x, z); return r ? r.world.terrain(x - r.cx, z - r.cz) : this.farHeight(x, z); }
  height(x, z) { const r = this.regionAt(x, z); return r ? r.world.height(x - r.cx, z - r.cz) : this.farHeight(x, z); }
  surfaceId(x, z) { const r = this.regionAt(x, z); return r ? r.world.surfaceId(x - r.cx, z - r.cz) : SURFACE.ROCK; }
  surfaceAt(x, z) { const r = this.regionAt(x, z); return r ? r.world.surfaceAt(x - r.cx, z - r.cz) : SURFACES[SURFACE.ROCK]; }
  water(x, z) { const r = this.regionAt(x, z); return r ? r.world.water(x - r.cx, z - r.cz) : -Infinity; }
  waterSurface(x, z) { const r = this.regionAt(x, z); return r ? r.world.waterSurface(x - r.cx, z - r.cz) : -Infinity; }
  boulderTop(x, z) { const r = this.regionAt(x, z); return r ? r.world.boulderTop(x - r.cx, z - r.cz) : -Infinity; }
  maxSinkAt(x, z) { const r = this.regionAt(x, z); return r ? r.world.maxSinkAt(x - r.cx, z - r.cz) : 0; }
  deform(x, z, fx, fz, hw, hl, press, dig) { const r = this.regionAt(x, z); return r ? r.world.deform(x - r.cx, z - r.cz, fx, fz, hw, hl, press, dig) : 0; }

  /**
   * The land beyond the maps: the nearest map's own far land (each map's landform carried on past its edge), lifted
   * or lowered near its edge to meet the ground drawn there; between two maps' far lands, a blend, each weighted as
   * the inverse square of how far off its square is, so at a map's edge the land is that map's own and nothing steps
   * there (a blend that gave a map 200 m off nearly the weight of the one at hand stood the far land metres above or
   * below a map's edge, and as the far land isn't drawn over a map, a gap showed under it). Maps much further off than
   * the nearest fade out of it smoothly.
   */
  farHeight(x, z) {
    if (this.farD?.length !== this.regions.length) this.farD = new Float64Array(this.regions.length);
    const D = this.farD;
    let dmin = Infinity;
    this.regions.forEach((r, i) => {
      const ex = Math.max(0, Math.abs(x - r.cx) - r.half), ez = Math.max(0, Math.abs(z - r.cz) - r.half);
      D[i] = Math.hypot(ex, ez); dmin = Math.min(dmin, D[i]);
    });
    let h = 0, wsum = 0;
    this.regions.forEach((r, i) => {
      const d = D[i], t = Math.min(1, Math.max(0, (d - dmin - 1500) / 1500)), w = (1 - t * t * (3 - 2 * t)) / (1 + d * d);
      if (w <= 0) return;
      const lx = x - r.cx, lz = z - r.cz, W = r.world, ox = Math.max(-r.half, Math.min(r.half, lx)), oz = Math.max(-r.half, Math.min(r.half, lz));
      const f = W.farHeight(lx, lz) + (W.terrain(ox, oz) - W.farHeight(ox, oz)) * Math.exp(-d / FAR_FADE);
      h += f * w; wsum += w;
    });
    return wsum > 0 ? h / wsum : 0;
  }

  /**
   * The air at (x, z): the world's own, or inside a map with its own (map.air: the taiga's fog, overcast and flat
   * light) that map's, coming on from a hundred metres outside its edge to `fade` metres in. (One object, reused.)
   */
  airAt(x, z) {
    const a = this.airOut, b = this.air0;
    a.fog = b.fog; a.cover = b.cover; a.sun = b.sun; a.sat = b.sat;
    for (const r of this.regions) {
      const m = r.world.map.air;
      if (!m) continue;
      const inside = r.half - Math.max(Math.abs(x - r.cx), Math.abs(z - r.cz)), t = Math.min(1, Math.max(0, (inside + 100) / (m.fade + 100)));
      const k = t * t * (3 - 2 * t);
      if (k <= 0) continue;
      a.fog += (m.fog - a.fog) * k; a.cover += (m.cover - a.cover) * k; a.sun += (m.sun - a.sun) * k; a.sat += (m.sat - a.sat) * k;
    }
    return a;
  }

  /** How wooded the far land is at (x, z) (0 to 1): the nearest maps' (their farWoods), weighted as farHeight. */
  farWoods(x, z) {
    if (this.woodD?.length !== this.regions.length) this.woodD = new Float64Array(this.regions.length);
    const D = this.woodD;
    let dmin = Infinity;
    this.regions.forEach((r, i) => { D[i] = Math.hypot(Math.max(0, Math.abs(x - r.cx) - r.half), Math.max(0, Math.abs(z - r.cz) - r.half)); dmin = Math.min(dmin, D[i]); });
    let s = 0, wsum = 0;
    this.regions.forEach((r, i) => {
      const t = Math.min(1, Math.max(0, (D[i] - dmin - 1500) / 1500)), w = (1 - t * t * (3 - 2 * t)) / (1 + D[i] * D[i]);
      s += (r.world.map.farWoods ?? 0.65) * w; wsum += w;
    });
    return wsum > 0 ? s / wsum : 0.65;
  }

  /** Inside the world (a margin m clear of its outer edges; a seam between two maps is no edge). */
  inBounds(x, z, margin = 0) {
    return !!(this.regionAt(x - margin, z - margin) && this.regionAt(x + margin, z - margin) && this.regionAt(x - margin, z + margin) && this.regionAt(x + margin, z + margin) && this.regionAt(x, z));
  }

  // ---------------------------------------------------------------- what stands on it
  /** Trunks and posts within r of (x, z), from every map they may be in (reuses its result objects, as World's). */
  treesNear(x, z, rad, out) {
    out.length = 0;
    for (const r of this.regions) {
      const lx = x - r.cx, lz = z - r.cz;
      if (Math.abs(lx) > r.half + rad + 8 || Math.abs(lz) > r.half + rad + 8) continue;
      for (const o of r.world.treesNear(lx, lz, rad, this.tmpOb)) {
        if (out.length >= this.obPool.length) break;
        const p = this.obPool[out.length];
        p.x = o.x + r.cx; p.y = o.y; p.z = o.z + r.cz; p.r = o.r; p.cap = o.cap; p.top = o.top; p.u = o.u; p.tree = o.tree;
        p.i = r.index * OB_STRIDE + o.i;
        out.push(p);
      }
    }
    return out;
  }

  strike(i, moment, vx, vz) {
    const r = this.regions.find((q) => q.index === Math.floor(i / OB_STRIDE));
    return r ? r.world.strike(i % OB_STRIDE, moment, vx, vz) : false;
  }

  /** Nearest tree within reach (for the winch), as World.nearestTree. */
  nearestTree(x, z, maxDist, filter = null) {
    let best = null, bd = Infinity;
    for (const t of this.treesNear(x, z, maxDist, [])) {
      if (!t.tree || t.cap < WINCH_CAP) continue;
      if (filter && !filter(t)) continue;
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) { bd = d; best = { ...t }; }
    }
    return best;
  }

  /** Break by key ('kerala:t123'; a friend's break, or the room's list when joining). */
  breakKey(key, dx = 0, dz = 1, v = 0, quiet = false) {
    const m = /^([a-z]{1,10}):(.+)$/.exec(String(key)), r = m && this.byId.get(m[1]);
    return r ? r.world.breakKey(m[2], dx, dz, v, quiet) : false;
  }

  brokenKeys() { return this.regions.flatMap((r) => r.world.brokenKeys().map((k) => `${r.id}:${k}`)); }

  /** A custom layout's props (game/Props.js), each on the map it stands on (they replace any there were). */
  setProps(list) {
    this.propList = list || [];
    for (const r of this.regions) {
      r.world.setProps(this.propList.filter((p) => Math.abs(p.x - r.cx) <= r.half && Math.abs(p.z - r.cz) <= r.half).map((p) => ({ ...p, x: p.x - r.cx, z: p.z - r.cz })));
    }
    this.props = this.regions.flatMap((r) => r.world.props.map((p) => ({ ...p, x: p.x + r.cx, z: p.z + r.cz })));
  }

  // ---------------------------------------------------------------- events
  /**
   * Every map's events, races and party modes (game/Events.js, Races.js, Modes.js), moved into the world (each map's
   * party modes its own: 'elimination-kerala').
   */
  eventsOf(region) {
    const W = region.world, list = [...eventsFor(W), ...racesFor(W), ...modesFor(W)];
    return list.map((e) => {
      const out = moveEvent(e, region.cx, region.cz);
      if (e.mode) { out.id = `${e.id}-${region.id}`; out.name = `${e.name} · ${region.map.short || region.map.name}`; }
      out.region = region.id;
      return out;
    });
  }

  /**
   * The world's own races, across its maps (world/maps/world.js WORLD.races): once every map is in (their courses
   * run over all of them).
   */
  worldEvents() {
    if (!this.complete) return [];
    const W = { map: { races: this.def.races || [] }, data: { trails: this.data.trails }, hubs: this.hubs, terrain: (x, z) => this.terrain(x, z) };
    return racesFor(W).map((e) => ({ ...e, region: null, world: true }));
  }

  events() { return [...this.regions.flatMap((r) => this.eventsOf(r)), ...this.worldEvents()]; }

  /** The boulders of every map, in the world (for the start grids: game/Events.js gridFor). */
  get boulders() {
    return (this.boulderList ||= this.regions.flatMap((r) => r.world.boulders.map((b) => ({ x: b.x + r.cx, z: b.z + r.cz, rx: b.rx, rz: b.rz }))));
  }
}
