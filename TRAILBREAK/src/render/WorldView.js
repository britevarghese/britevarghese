// The open world drawn (world/OpenWorld.js): each of its maps by its own renderers, as it is drawn alone, in a group
// standing at the map's centre; their terrains each clipped to their own square, and one terrain for the far land all
// round them. The game drives them through the same calls it makes of one map's renderers (terrain.update(camPos),
// vegetation.update(camera, dt), ...): each map's are given the camera, the trucks and the ruts in its own frame.
import * as THREE from 'three';
import { TerrainRenderer } from './Terrain.js';
import { loadGround } from './Ground.js';
import { Vegetation } from './Vegetation.js';
import { Grass } from './Grass.js';
import { Tea } from './Tea.js';
import { Rocks } from './Rocks.js';
import { Water } from './Water.js';
import { RoadMarkings } from './RoadMarkings.js';
import { RoadWear } from './RoadWear.js';
import { Landmarks } from './Landmarks.js';
import { BreakView } from './BreakView.js';
import { BEACON_STRIDE } from '../world/OpenWorld.js';
import { REGIONS } from '../world/maps/world.js';
import { DeformGrid } from '../world/Deform.js';
import { SURFACE } from '../physics/Surfaces.js';

// how near (m) the camera must come to a map's square for each of its things to be kept up to date
const NEAR = { grass: 160, tea: 400, rocks: 700, veg: 2600, breaks: 300 };

/** The ground textures of each set, loaded once. */
const grounds = new Map();
const groundOf = (name, quality) => {
  if (!grounds.has(name)) grounds.set(name, loadGround(name, quality).catch((e) => { console.warn('ground textures', name, e); return null; }));
  return grounds.get(name);
};

/** A camera seen from a map's own frame (its position less the map's centre). */
class LocalCamera {
  constructor(cx, cz) { this.cx = cx; this.cz = cz; this.camera = new THREE.PerspectiveCamera(); }
  of(camera) {
    const c = this.camera;
    c.copy(camera, false);
    c.position.x -= this.cx; c.position.z -= this.cz;
    c.updateMatrixWorld(true);
    return c;
  }
}

/** One map of the world, drawn. */
export class RegionView {
  /** slice: how long (ms) its ground's colours may hold up a frame (the start map's, on the loading screen: all of it). */
  static async create(region, renderer, { quality = 'high', audio = null, effects = null, onProgress, slice = 6 } = {}) {
    const M = region.map, ground = await groundOf(M.ground, quality);
    // (a stretch next to a map with ground textures of another set: its own give way to those towards their seam)
    let blend = null;
    for (const [side, nid] of Object.entries(REGIONS[region.index].seams || {})) {
      const N = REGIONS.find((R) => R.id === nid).map;
      if (N.ground !== M.ground) blend = { side, ground: await groundOf(N.ground, quality), band: 160 };
    }
    const v = new RegionView(region, renderer, ground, { audio, effects, blend });
    await v.terrain.ready(onProgress, slice);
    v.vegetation = await Vegetation.create(region.world, v.host);
    v.grass = new Grass(region.world, v.terrain, v.group, ground, v.vegetation.uniforms, { centre: [region.cx, region.cz] });
    v.vegetation.setOrigin(region.cx, region.cz);
    v.breakView = new BreakView(v.group, region.world, v.vegetation, v.localEffects, audio);
    return v;
  }

  constructor(region, renderer, ground, { audio, effects, blend }) {
    this.region = region;
    const { cx, cz } = region, W = region.world;
    this.group = new THREE.Group();
    this.group.name = `map ${region.id}`;
    this.group.position.set(cx, 0, cz);
    this.group.updateMatrixWorld(true);
    renderer.scene.add(this.group);
    // (what the forest needs of the renderer: the scene it goes in, the GL context, the sun)
    this.host = { scene: this.group, renderer: renderer.renderer, get sun() { return renderer.sun; } };
    this.local = new LocalCamera(cx, cz);
    this.terrain = new TerrainRenderer(W, this.group, { ground, centre: [cx, cz], clip: true, defer: true, blend });
    this.rocks = new Rocks(W, this.group, ground);
    this.tea = region.map.tea ? new Tea(W, this.group) : null;
    this.water = new Water(W, this.group);
    new RoadMarkings(W, this.group);
    new RoadWear(W, this.group);
    this.landmarks = new Landmarks(W, this.group);
    // the effects and sounds of what breaks here, in the world
    this.localEffects = effects && {
      spawn: (x, y, z, ...rest) => effects.spawn(x + cx, y, z + cz, ...rest),
    };
    this.audio = audio;
  }

  /** How far (m) a point (world) is from this map's square. */
  away(x, z) {
    const r = this.region;
    return Math.hypot(Math.max(0, Math.abs(x - r.cx) - r.half), Math.max(0, Math.abs(z - r.cz) - r.half));
  }
}

/**
 * The open world's views, as the game drives one map's: { terrain, vegetation, grass, tea, rocks, water, landmarks,
 * breakView } each answering the calls the game makes of that renderer. Maps join as they come in (add).
 */
export class WorldView {
  /** The world's views, with the far land's ground (the start map's textures) loaded. */
  static async create(world, renderer, opts = {}) {
    const S = REGIONS.find((R) => R.id === world.def.start).map;
    return new WorldView(world, renderer, await groundOf(S.ground, opts.quality || 'high'), opts);
  }

  constructor(world, renderer, ground, { quality = 'high', audio = null, effects = null } = {}) {
    this.world = world; this.renderer = renderer; this.quality = quality; this.audio = audio; this.effects = effects;
    this.views = [];
    this.settings = { quality, shadows: true, detail: null };
    // the far land all round the maps (each map's square left to it once it is in)
    this.far = new TerrainRenderer(farGround(world), renderer.scene, { far: true, ground, holes: REGIONS.map(() => [0, 0, 0, 0]) });
    const V = this.views, each = (fn) => { for (const v of V) fn(v); };
    const self = this;
    this.terrain = {
      get budget() { return self.far.budget; },
      set budget(b) { self.far.budget = b; each((v) => { v.terrain.budget = b; }); },
      get split() { return self.far.split; },
      set split(s) { self.far.split = s; each((v) => { v.terrain.split = s; }); },
      get shadows() { return self.far.shadows; },
      set shadows(on) { each((v) => { v.terrain.shadows = on; }); },
      setQuality: (q) => { self.settings.quality = q; self.far.setQuality(q); each((v) => v.terrain.setQuality(q)); },
      update: (camPos) => {
        self.far.update(camPos);
        each((v) => v.terrain.update(_p.set(camPos.x - v.region.cx, camPos.y, camPos.z - v.region.cz)));
      },
      markDirty: (perMap) => { for (const [id, keys] of perMap) self.viewOf(id)?.terrain.markDirty(keys); },
      // (the colour of the land, for the maps: whichever map holds the point, else the far land's)
      colorAt: (x, z, spacing, h, slope, out) => { const v = self.viewAt(x, z); return v ? v.terrain.colorAt(x - v.region.cx, z - v.region.cz, spacing, h, slope, out) : self.far.colorAt(x, z, spacing, h, slope, out); },
    };
    const cam = (v, camera) => v.local.of(camera);
    const near = (v, camera, d) => v.away(camera.position.x, camera.position.z) < d;
    this.vegetation = {
      update: (camera, dt) => each((v) => { if (near(v, camera, NEAR.veg)) v.vegetation.update(cam(v, camera), dt); }),
      setDetailRange: (m) => { self.settings.detail = m; each((v) => v.vegetation.setDetailRange(m)); },
      setShadows: (on) => { self.settings.shadows = on; each((v) => v.vegetation.setShadows(on)); },
    };
    this.grass = {
      update: (camera, dt, push = []) => each((v) => {
        if (!near(v, camera, NEAR.grass)) { v.grass.mesh.visible = false; return; }
        v.grass.mesh.visible = true;
        v.grass.update(cam(v, camera), dt, push.map((w) => ({ ...w, x: w.x - v.region.cx, z: w.z - v.region.cz })));
      }),
      markDirty: (perMap) => { for (const [id, keys] of perMap) self.viewOf(id)?.grass.markDirty(keys); },
      setQuality: (q) => each((v) => v.grass.setQuality(q)),
      get meshes() { return V.map((v) => v.grass.mesh); },
      get mesh() { return null; },
    };
    this.tea = {
      update: (camera) => each((v) => { if (v.tea && near(v, camera, NEAR.tea)) v.tea.update(cam(v, camera)); }),
      markDirty: (perMap) => { for (const [id, keys] of perMap) self.viewOf(id)?.tea?.markDirty(keys); },
      setQuality: (q) => each((v) => v.tea?.setQuality(q)),
      setShadows: (on) => each((v) => v.tea?.setShadows(on)),
      prime: (camera) => each((v) => { if (v.tea && near(v, camera, NEAR.tea)) v.tea.prime(cam(v, camera)); }),
      get mesh() { return null; },
    };
    this.rocks = {
      update: (camera) => each((v) => { if (near(v, camera, NEAR.rocks)) v.rocks.update(cam(v, camera)); }),
      setShadows: (on) => each((v) => v.rocks.setShadows(on)),
    };
    this.water = { update: (camera, dt, horizon) => each((v) => v.water.update(cam(v, camera), dt, horizon)) };
    this.landmarks = {
      update: (camera, dt) => each((v) => v.landmarks.update(cam(v, camera), dt)),
      setFound: (id, on) => {
        const R = REGIONS[Math.floor(id / BEACON_STRIDE)];
        self.found.set(id, on);
        if (R) self.viewOf(R.id)?.landmarks.setFound(id % BEACON_STRIDE, on);
      },
    };
    this.found = new Map();
    this.breakView = {
      // what broke on each map: drawn there, and the local ones, in the world, for the room
      take: (camPos) => {
        const out = [];
        for (const v of V) {
          const r = v.region;
          for (const e of v.breakView.take(_p.set(camPos.x - r.cx, camPos.y, camPos.z - r.cz))) out.push({ ...e, key: `${r.id}:${e.key}`, x: e.x + r.cx, z: e.z + r.cz });
        }
        return out;
      },
      update: (dt, trucks = []) => each((v) => {
        const r = v.region, here = trucks.filter((t) => v.away(t.pos.x, t.pos.z) < NEAR.breaks);
        v.breakView.update(dt, here.map((t) => ({ pos: { x: t.pos.x - r.cx, y: t.pos.y, z: t.pos.z - r.cz }, vel: t.vel })));
      }),
    };
  }

  viewOf(id) { return this.views.find((v) => v.region.id === id); }
  viewAt(x, z) { const r = this.world.regionAt(x, z); return r ? this.viewOf(r.id) : null; }

  /** A map come in: its renderers, set as the others are. */
  async add(region, opts = {}) {
    const v = await RegionView.create(region, this.renderer, { quality: this.quality, audio: this.audio, effects: this.effects, ...opts });
    const s = this.settings;
    v.terrain.setQuality(s.quality); v.grass.setQuality(s.quality); v.tea?.setQuality(s.quality);
    v.terrain.split = this.far.split; v.terrain.shadows = this.far.shadows ?? true;
    if (s.detail != null) v.vegetation.setDetailRange(s.detail);
    v.vegetation.setShadows(s.shadows); v.rocks.setShadows(s.shadows); v.tea?.setShadows(s.shadows);
    for (const [id, on] of this.found) if (Math.floor(id / BEACON_STRIDE) === region.index) v.landmarks.setFound(id % BEACON_STRIDE, on);
    this.views.push(v);
    this.far.setHole(region.index, [region.cx - region.half, region.cz - region.half, region.cx + region.half, region.cz + region.half]);
    return v;
  }
}
const _p = new THREE.Vector3();

/** The far land as the terrain renderer takes a world: no grid of its own, the open world's far land everywhere. */
function farGround(world) {
  const S = REGIONS.find((R) => R.id === world.def.start).map;
  const empty = { count: 0, x: [], y: [], z: [], h: [], r: [], type: [] };
  return {
    map: { ...S, id: 'far' }, half: 0, res: 1, N: 2, origin: 0,
    H: new Float32Array(4), S: new Uint8Array(4).fill(SURFACE.GRASS), trees: empty,
    deformGrid: new DeformGrid(),
    terrain: (x, z) => world.farHeight(x, z), farHeight: (x, z) => world.farHeight(x, z),
    water: () => -Infinity, surfaceId: () => SURFACE.GRASS,
  };
}
