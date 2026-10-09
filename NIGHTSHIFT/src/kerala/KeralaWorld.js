// KeralaWorld: the real Kerala, all 14 districts, streamed in 2 km tiles built from OpenStreetMap and SRTM
// elevation (tools/kerala/build_tiles.py -> public/assets/world/kerala). Implements the parts of the
// WorldManager interface the game relies on (layout.groundHeight, collision, districtAt, update, ...).
// Coordinates: x = -east, z = north (metres) from Marine Drive, Kochi.
import * as THREE from 'three';
import { IS_MOBILE } from '../core/QualityManager.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from '../physics/Collision.js';
import { KeralaTile, TILE, C, ROAD_HALF, decodeBinary } from './KeralaTile.js';
import * as TX from '../renderer/Textures.js';
import { KERALA_FACADE, KERALA_SHOP } from '../renderer/Textures.js';
import { keralaRoadMaterial } from '../renderer/Materials.js';
import { KeralaLaneGraph } from './KeralaLanes.js';
import { KeralaRouter } from './KeralaRouter.js';
import { KeralaTrees } from './KeralaTrees.js';
import { KeralaTea } from './KeralaTea.js';

const BASE = '/assets/world/kerala/';
// tiles loaded around the player (5 x 5 = 10 x 10 km; on a phone 3 x 3, which keeps the browser's memory in
// bounds: iOS closes a page that takes too much), and unloaded beyond KEEP
const RADIUS = IS_MOBILE ? 1 : 2;
function dropArray() { this.array = null; }
const KEEP = IS_MOBILE ? 2 : 3;

export class KeralaWorld {
  constructor() {
    this.kerala = true;
    this.tiles = new Map();          // key -> KeralaTile (loaded data, maybe not built)
    this.pending = new Map();        // key -> Promise
    this.collision = new CollisionWorld();
    this.lanes = new KeralaLaneGraph();
    this.state = { time: 0, hour: 23, weather: 'clear' };
    this.focus = { x: 0, z: 0 };
    const W = this;
    // the gameplay-facing "layout" (Port Halvern systems read these; Kerala has no grid city)
    const router = this.router = new KeralaRouter(this.lanes);
    this.layout = {
      get nodes() { return router.nodes; },
      nearestNode: (x, z) => router.nearestNode(x, z),
      route: (a, b) => router.route(a, b),
      edgeBetween: () => null,
      edges: [], blocks: [], ringSamples: [], nodeMap: new Map(),
      groundHeight: (x, z, y) => W.groundHeight(x, z, y),
      inTunnel: () => false,
      roadAt: () => null,
      offRoad: (x, z) => W.offRoad(x, z),
      pedSegment: (focus, R) => W.pedSegment(focus, R),
      standSpots: (x, z, r) => W.standSpots(x, z, r),
    };
    this.planner = { colliders: [], props: [], parked: [], buildings: [] };
    this.chunks = {
      nearKeys: [], nearPos: new THREE.Vector3(),
      preload: (pos, r, cb) => this.preload(pos, cb),
      stats: () => ({ loaded: this.tiles.size, detailed: [...this.tiles.values()].filter((t) => t.ready).length, buildMs: this.buildMs || 0, pending: this.queue?.length || 0 }),
      update: () => {}, setPreset: () => {},
    };
    this.props = { rebuild() {}, defs: {}, count: 0, hide() {}, updateSignals() {}, preset: null };
    this.lights = { rebuild() {}, update() {}, setDynamicCount() {}, addReflection() {}, flushReflections() {}, dyn: [] }; // (the real one once there is a scene)
  }

  async loadIndex() {
    if (this.index) return this.index;
    this.index = await (await fetch(BASE + 'index.json')).json();
    this.tileSet = new Map(this.index.tiles.map((t) => [`${t[0]},${t[1]}`, t]));
    return this.index;
  }

  // -------------------------------------------------------------------------------------- visuals
  initVisuals(scene, M, preset) {
    this.scene = scene; this.M = M; this.preset = preset;
    this.lights = new KeralaLights(scene, this);
    this.lights.setDynamicCount(preset?.streetLights || 0);
    this.root = new THREE.Group(); this.root.name = 'kerala';
    scene.add(this.root);
    // materials the tiles share
    M.klRoad = keralaRoadMaterial(M.road);
    for (const f of M.facades || []) if (f.userData.gradeUv) f.userData.gradeUv.value = 1; // weathering from the base up
    M.terrainDetail = TX.grass().map;
    M.klRoofTile = new THREE.MeshStandardMaterial({ name: 'klRoofTile', color: 0xffffff, map: mangaloreTiles(), roughness: 0.85 });
    M.klPole = new THREE.MeshLambertMaterial({ name: 'klPole', color: 0x9a968c });
    M.klWire = new THREE.LineBasicMaterial({ name: 'klWire', color: 0x1a1a1a, transparent: true, opacity: 0.75 });
    this.poleGeo = poleGeometry();
    Object.assign(this, lampGeometries());
    // sodium / LED streetlamps: the head glows and throws a pool of light on the road after dark
    M.klLamp = new THREE.MeshStandardMaterial({ name: 'klLamp', color: 0x9a9a90, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4 });
    // festival bulbs on temples, churches and mosques: glowing points, faded in after dark (KeralaLights.update)
    M.klFestive = new THREE.PointsMaterial({ name: 'klFestive', size: 0.32, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    M.klLampPool = new THREE.MeshBasicMaterial({ name: 'klLampPool', color: 0xffc070, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.stopGeo = busStopGeometry();
    [this.teaGeo, this.teaSignGeo] = teaStallGeometry();
    M.klTeaSign = new THREE.MeshLambertMaterial({ name: 'klTeaSign', map: teaSignTexture() });
    M.klStop = new THREE.MeshLambertMaterial({ name: 'klStop', vertexColors: true });
    M.klLedge = new THREE.MeshStandardMaterial({ name: 'klLedge', color: 0xd6d0c4, roughness: 0.95, side: THREE.DoubleSide });
    M.klRoofFlat = new THREE.MeshStandardMaterial({ name: 'klRoofFlat', color: 0x8d8a82, roughness: 0.95 });
    M.klLineWhite = new THREE.MeshStandardMaterial({ name: 'klLineW', color: 0xe8e8e0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.klLineYellow = new THREE.MeshStandardMaterial({ name: 'klLineY', color: 0xe0b020, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.klKerb = new THREE.MeshStandardMaterial({ name: 'klKerb', vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
    M.klManhole = new THREE.MeshStandardMaterial({ name: 'klManhole', color: 0x34302c, roughness: 0.5, metalness: 0.55, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.manholeGeo = manholeGeometry();
    Object.assign(this, detailGeometries());
    M.klAO = new THREE.MeshBasicMaterial({ name: 'klAO', vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    M.klBridge = new THREE.MeshStandardMaterial({ name: 'klBridge', color: 0x8f8c84, roughness: 0.92, side: THREE.DoubleSide });
    M.klShoulder = new THREE.MeshStandardMaterial({ name: 'klShoulder', color: 0xffffff, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    M.klDirtRoad = new THREE.MeshStandardMaterial({ name: 'klDirt', color: 0x7a5c46, roughness: 1 });
    M.klWater = new THREE.MeshStandardMaterial({ name: 'klWater', color: 0x1d4048, roughness: 0.1, metalness: 0.25, normalMap: TX.waterNormal?.(), transparent: true, opacity: 0.92 });
    this.palmGeo = palmGeometry();
    M.klTank = new THREE.MeshStandardMaterial({ name: 'klTank', color: 0x1a1c1e, roughness: 0.6 });
    this.tankGeo = (() => { const g = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 10).translate(0, 0.62 + 0.25, 0); g.deleteAttribute('uv'); return g.toNonIndexed(); })();
    this.palmMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.trees = new KeralaTrees(scene, preset);
    this.teaBushes = new KeralaTea(scene);
    this.queue = [];
  }

  setPreset(p) { this.preset = p; this.trees?.setPreset(p); if (this.lights.dyn.length !== (p.streetLights || 0)) this.lights.setDynamicCount(p.streetLights || 0); }

  _opts() {
    const p = this.preset || {};
    return { trees: this.trees, shadows: p.shadows && p.shadows !== 'off', palms: p.trees ?? 1, palmGeo: this.palmGeo, palmMat: this.palmMat, tankGeo: this.tankGeo, poleGeo: this.poleGeo, lampGeo: this.lampGeo, lampHeadGeo: this.lampHeadGeo, lampPoolGeo: this.lampPoolGeo, trafoGeo: this.trafoGeo, manholeGeo: this.manholeGeo, acGeo: this.acGeo, pipeGeo: this.pipeGeo, balconyGeo: this.balconyGeo, gateGeo: this.gateGeo, awningGeo: this.awningGeo, signGeo: this.signGeo, crateGeo: this.crateGeo, chairGeo: this.chairGeo, scooterGeo: this.scooterGeo, realScooter: !!this.scooterParts, ledges: !IS_MOBILE && (p.trees ?? 1) >= 0.7, details: (p.trees ?? 1) >= 0.7, keralaFacade: KERALA_FACADE, keralaShop: KERALA_SHOP, maxBuildings: IS_MOBILE ? 2500 : p.textureSize >= 1024 ? 9000 : 4500 };   // (a phone: no window sunshades, fewer buildings: memory; walls, gates and props stay)
  }

  key(tx, tz) { return `${tx},${tz}`; }

  // fetch the data of one tile (no meshes yet)
  fetchTile(tx, tz) {
    const k = this.key(tx, tz);
    if (this.tiles.has(k)) return Promise.resolve(this.tiles.get(k));
    if (this.pending.has(k)) return this.pending.get(k);
    if (this.tileSet && !this.tileSet.has(k)) return Promise.resolve(null); // the sea / outside Kerala
    const bin = this.index?.format === 'bin';
    const p = fetch(`${BASE}t/${tx}_${tz}.${bin ? 'bin' : 'json'}`).then((r) => (r.ok ? (bin ? r.arrayBuffer() : r.json()) : null)).then((d) => {
      if (d && bin) d = decodeBinary(d);
      this.pending.delete(k);
      if (!d) return null;
      const t = new KeralaTile(tx, tz, d);
      this.tiles.set(k, t);
      return t;
    }).catch(() => { this.pending.delete(k); return null; });
    this.pending.set(k, p);
    return p;
  }

  // _setBack a few milliseconds at a time
  *_setBackSteps(t, spots, hx, hz) {
    if (!spots?.length) return spots;
    const out = [];
    for (const b of spots) {
      if (t._due()) { yield 'world:setback'; t._ys = performance.now(); }
      out.push(...this._setBack([b], hx, hz));
    }
    return out;
  }

  _setBack(spots, hx, hz) {
    if (!spots?.length) return spots;
    const onRd = (x, z) => { const o = this.tileAt(x, z); return !!o?.ready && o.onRoad(-x - o.E0, z - o.N0, 0.4, -1, 7); };
    let lanes = [];
    const nearLane = (x, z) => {
      for (const l of lanes) for (let i = 1; i < l.pts.length; i++) {
        const [ax, az] = l.pts[i - 1], [bx, bz] = l.pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        if (Math.abs(x - ax) > 60 && Math.abs(x - bx) > 60) continue;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(ax + dx * u - x, az + dz * u - z) < 2.2) return true;
      }
      return false;
    };
    const blocked = (b) => {
      const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      for (let a = -1; a <= 1; a += 0.5) for (let f = -1; f <= 1; f += 0.5) {
        const lx = hx * a, lz = hz * f, x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
        if (onRd(x, z) || nearLane(x, z)) return true;
      }
      return false;
    };
    return spots.filter((b) => {
      lanes = this.lanes.lanesNear(b.x, b.z, 0, 20).filter((l) => l.edge.cls <= 7);
      // the spot faces the road: step back, away from it
      const bx = -Math.sin(b.yaw) * 0.5, bz = -Math.cos(b.yaw) * 0.5;
      for (let k = 0; k <= 12; k++) { if (!blocked(b)) return true; b.x += bx; b.z += bz; }
      return false;
    });
  }

  _clearLanes(t, list) {
    const onRd = (x, z) => { const o = this.tileAt(x, z); return !!o?.ready && o.onRoad(-x - o.E0, z - o.N0, -0.5, -1, 6); };
    for (const c of list) {
      let hit = false;
      for (let a = -1; a <= 1 && !hit; a += 0.5) for (let b = -1; b <= 1 && !hit; b += 0.5) {
        const lx = c.hx * a, lz = c.hz * b;
        hit = onRd(c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos);
      }
      if (hit) { this.collision.remove(c); const i = t.colliders.indexOf(c); if (i >= 0) t.colliders.splice(i, 1); }
    }
    // and nothing on a traffic lane's line (lanes joining dead ends can run just off the drawn road)
    const left = list.filter((c) => t.colliders.includes(c));
    if (!left.length) return;
    const grid = new Map(), G = 20;
    for (const l of this.lanes.lanesNear(-(t.E0 + TILE / 2), t.N0 + TILE / 2, 0, TILE)) {
      if (l.edge.cls > 6) continue;
      for (let i = 1; i < l.pts.length; i++) {
        const [ax, az] = l.pts[i - 1], [bx, bz] = l.pts[i], L = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d <= L; d += 1.5) { const x = ax + (bx - ax) * Math.min(1, d / L), z = az + (bz - az) * Math.min(1, d / L), k = Math.floor(x / G) * 100003 + Math.floor(z / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(x, z); }
      }
    }
    for (const c of left) {
      const r = Math.hypot(c.hx, c.hz) + 1;
      let hit = false;
      for (let gx = Math.floor((c.cx - r) / G); gx <= Math.floor((c.cx + r) / G) && !hit; gx++) for (let gz = Math.floor((c.cz - r) / G); gz <= Math.floor((c.cz + r) / G) && !hit; gz++) {
        const P = grid.get(gx * 100003 + gz); if (!P) continue;
        for (let j = 0; j < P.length && !hit; j += 2) { const dx = P[j] - c.cx, dz = P[j + 1] - c.cz, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; hit = Math.abs(lx) < c.hx + 0.85 && Math.abs(lz) < c.hz + 0.85; }
      }
      if (hit) { this.collision.remove(c); t.colliders.splice(t.colliders.indexOf(c), 1); }
    }
  }

  // parked scooters outside the shops use the real two-wheeler model (its low-detail level, instanced per part)
  setPropModels(lib) {
    if (this.scooterParts || !lib?.cars?.scooter) return;
    const root = lib.cars.scooter, lod = root.getObjectByName('lod1') || root.getObjectByName('lod0');
    if (!lod) return;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), parts = new Map();
    lod.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      for (const k of Object.keys(g.attributes)) { const a = g.attributes[k]; if (!(a.array instanceof Float32Array) || a.normalized) { const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j); g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); } }
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (g.index) g = g.toNonIndexed();
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(g);
    });
    this.scooterParts = [...parts].map(([mat, gs]) => {
      const m = mat.clone();
      // paint: tinted per instance (white-ish base so the instance colour shows)
      const paint = /paint|body/i.test(mat.name || '') || (!mat.map && mat.color && Math.max(mat.color.r, mat.color.g, mat.color.b) > 0.25);
      if (paint) m.color.set(0xffffff);
      return { geo: mergeGeometries(gs), mat: m, paint };
    });
    for (const t of this.tiles.values()) if (t.ready) this._scooters(t);
  }

  _scooters(t) {
    const _m4 = new THREE.Matrix4(), _lift = new THREE.Matrix4().makeTranslation(0, -0.15, 0); // the model stands on its tyres
    if (!this.scooterParts || !t.scooterSpots?.length) return;
    for (const m of t.scooterMeshes || []) { m.removeFromParent(); m.dispose(); }
    // the box stand-ins built before the model arrived
    for (const c of [...t.group.children]) if (c.name === 'detail_scooter') { c.removeFromParent(); c.dispose(); }
    t.scooterMeshes = [];
    const PAL = SCOOTER_PAL;
    const col = new THREE.Color();
    for (let c = 0; c < 16; c++) {
      const L = t.scooterSpots.filter((q) => q[1] === c);
      if (!L.length) continue;
      for (const part of this.scooterParts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, L.length);
        L.forEach(([m4, , tint], i) => { im.setMatrixAt(i, _m4.copy(m4).premultiply(_lift)); if (part.paint) im.setColorAt(i, col.set(PAL[Math.floor((tint || 0) * PAL.length)])); });
        im.computeBoundingSphere(); im.name = 'detail_scooterReal'; im.castShadow = false;
        im.userData.spots = L; im.userData.paint = part.paint; im.frustumCulled = false;
        im.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250]; im.userData.far = 300; im.userData.near = 130;
        im.matrixAutoUpdate = false; im.updateMatrix();
        t.group.add(im); t.scooterMeshes.push(im);
      }
    }
  }

  // build the tiles under these points next (a race about to start needs its roads)
  prioritize(points) { this.prio = new Set(points.map((p) => this.key(Math.floor(-p.x / TILE), Math.floor(p.z / TILE)))); }

  _buildTile(t) { const it = this._buildSteps(t); while (!it.next().done); }

  // a tile's build in stages: the tile's own (terrain, roads, streets, buildings, trees...), then its place in the
  // world (lanes, stalls and shelters, clearing the lanes of anything solid)
  *_buildSteps(t) {
    if (t.ready || !this.root) return;
    const t0 = performance.now();
    const g = yield* t.buildSteps(this.M, this._opts());
    // a phone: once a tile's static meshes (ground, roads, buildings, walls) are on the GPU, the copies of their
    // vertices in the page's own memory are dropped (iOS closes a page that holds too much). Instanced meshes
    // (trees, props) keep theirs: they are rewritten as you move
    if (IS_MOBILE) g.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      const G = o.geometry; G.computeBoundingSphere(); G.computeBoundingBox();
      for (const a of [...Object.values(G.attributes), G.index]) if (a) a.onUpload(dropArray);
    });
    this.root.add(g);
    yield 'world:add';
    this._scooters(t);
    for (const c of t.colliders) this.collision.add(c);
    this.lanes.addTile(t);
    yield 'world:lanes';
    const n0 = t.colliders.length;
    // tea stalls and bus shelters stand clear of every carriageway (a junction's other road, a wide highway): set back
    // from the road until the whole footprint, bench included, is off it, or dropped
    t.teaShops = yield* this._setBackSteps(t, t.teaShops, 1.4, 1.9);
    t.busStops = yield* this._setBackSteps(t, t.busStops, 1.9, 0.9);
    // tea stalls
    if (t.teaShops?.length && this.teaGeo) {
      const im = new THREE.InstancedMesh(this.teaGeo, this.M.klStop, t.teaShops.length), sg = new THREE.InstancedMesh(this.teaSignGeo, this.M.klTeaSign, t.teaShops.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      t.teaShops.forEach((b, i) => { m4.compose(v.set(b.x, this.groundHeight(b.x, b.z), b.z), q.setFromAxisAngle(up, b.yaw), one); im.setMatrixAt(i, m4); sg.setMatrixAt(i, m4); });
      for (const m of [im, sg]) { m.computeBoundingSphere(); m.castShadow = m === im; this.root.add(m); }
      im.name = 'teaShops'; t.teaMeshes = [im, sg];
      for (const b of t.teaShops) {
        // the kiosk is solid; the bench in front is not
        const c = { cx: b.x - Math.sin(b.yaw) * 0.6, cz: b.z - Math.cos(b.yaw) * 0.6, hx: 1.3, hz: 0.95, cos: Math.cos(b.yaw), sin: Math.sin(b.yaw), angle: b.yaw, h: 99, kind: 'building' };
        t.colliders.push(c); this.collision.add(c);
      }
    }
    // bus shelters at the stops the lane graph placed
    if (t.busStops?.length && this.stopGeo) {
      const im = new THREE.InstancedMesh(this.stopGeo, this.M.klStop, t.busStops.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
      t.busStops.forEach((b, i) => { im.setMatrixAt(i, m4.compose(v.set(b.x, this.groundHeight(b.x, b.z), b.z), q.setFromAxisAngle(up, b.yaw), one)); });
      im.computeBoundingSphere(); im.name = 'busStops'; im.castShadow = true;
      this.root.add(im); t.stopMesh = im;
      for (const b of t.busStops) { const c = { cx: b.x, cz: b.z, hx: 1.8, hz: 0.6, cos: Math.cos(b.yaw), sin: Math.sin(b.yaw), angle: b.yaw, h: 99, kind: 'building' }; t.colliders.push(c); this.collision.add(c); }
    }
    // nothing solid in a lane, across tile borders too (a road on the next tile can run past this tile's walls):
    // this tile's colliders against every loaded road, and the neighbours' border colliders against this tile's roads
    yield 'world:extras';
    const own = [...t.colliders];
    for (let i = 0; i < own.length; i += 300) { this._clearLanes(t, own.slice(i, i + 300)); yield 'world:clear+'; }
    for (const o of this.tiles.values()) {
      if (o === t || !o.ready || Math.abs(o.tx - t.tx) > 1 || Math.abs(o.tz - t.tz) > 1) continue;
      this._clearLanes(o, o.colliders.filter((c) => { const e = -c.cx - o.E0, n = c.cz - o.N0; return e < 40 || n < 40 || e > TILE - 40 || n > TILE - 40; }));
      yield 'world:clear+';
    }
    void n0;
    this.buildMs = performance.now() - t0;
  }

  _unloadTile(k, t) {
    this.lanes.removeTile(t);
    if (t.stopMesh) { t.stopMesh.removeFromParent(); t.stopMesh.dispose(); t.stopMesh = null; }
    for (const m of t.teaMeshes || []) { m.removeFromParent(); m.dispose(); }
    t.teaMeshes = null;
    for (const c of t.colliders) this.collision.remove(c);
    t.colliders = [];
    t.dispose();
    this.tiles.delete(k);
  }

  // load and build the tiles around a point (before play starts)
  async preload(pos, cb) {
    await this.loadIndex();
    const tx = Math.floor(-pos.x / TILE), tz = Math.floor(pos.z / TILE);
    const want = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) want.push([tx + dx, tz + dz]);
    let n = 0;
    await Promise.all(want.map(([a, b]) => this.fetchTile(a, b).then((t) => { if (t) this._buildTile(t); cb?.(++n / want.length); })));
    this.chunks.nearPos.copy(pos);
  }

  // -------------------------------------------------------------------------------------- queries
  tileAt(x, z) {
    const E = -x, N = z;
    return this.tiles.get(this.key(Math.floor(E / TILE), Math.floor(N / TILE)));
  }

  // y: the height of whatever asks (a car under a flyover drives on the road below, not on the deck above it)
  groundHeight(x, z, y) {
    const t = this.tileAt(x, z);
    if (!t) return this._lastH ?? 0;
    const e = -x - t.E0, n = z - t.N0;
    let h = t.heightAt(e, n);
    if (t.ready) h = Math.max(h, t.roadSurface(e, n, y));
    this._lastH = h;
    return t._bg ? h + t.bumpAt(x, z) : h;
  }

  // distance to a speed breaker ahead of (x, z) along (fx, fz), or -1
  bumpAhead(x, z, fx, fz, range = 30) {
    const t = this.tileAt(x, z);
    return t?._bg ? t.bumpAhead(x, z, fx, fz, range) : -1;
  }

  // open country (paddy, groves, forest, sand) rather than a road or a town street
  offRoad(x, z) {
    const t = this.tileAt(x, z);
    if (!t?.cls) return false;
    const c = t.classAt(-x - t.E0, z - t.N0);
    return c !== C.road && c !== C.town && c !== C.commercial && c !== C.industrial;
  }

  inWater(x, z) {
    const t = this.tileAt(x, z);
    if (!t?.cls) return false;
    const c = t.classAt(-x - t.E0, z - t.N0);
    return c === C.water || c === C.sea;
  }

  // nearest road point (for spawning on a road): { x, z, yaw, name }
  roadSpot(x, z, maxCls = 6) {
    let best = null, bd = Infinity;
    for (const t of this.tiles.values()) {
      for (const r of t.roads) {
        if (r.cls > maxCls || r.pts.length < 2) continue;
        // (the middle of a piece of road at least 16 m long: not on a junction, its speed breakers or a bend)
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [e, n] = r.pts[i], [e2, n2] = r.pts[i + 1];
          if (Math.hypot(e2 - e, n2 - n) < 16 && r.pts.length > 2) continue;
          const gx = -(t.E0 + (e + e2) / 2), gz = t.N0 + (n + n2) / 2, d = Math.hypot(gx - x, gz - z);
          if (d < bd) { bd = d; best = { x: gx, z: gz, yaw: Math.atan2(-(e2 - e), n2 - n), name: r.name || r.ref }; }
        }
      }
    }
    return best;
  }

  districtAt(x, z) {
    const t = this.tileAt(x, z);
    const name = t && t.district >= 0 ? this.index?.districts[t.district] : 'Kerala';
    // the nearest town or neighbourhood gives the local name
    let place = null, bd = 2500;
    for (const p of this.index?.places || []) {
      const px = -p[3], pz = p[4], d = Math.hypot(px - x, pz - z) / (p[0] === 'city' ? 3 : p[0] === 'town' ? 2 : 1);
      if (d < bd) { bd = d; place = p[1]; }
    }
    return { id: name || 'kerala', name: place ? `${place}, ${name}` : name };
  }

  // a stretch of roadside for a pedestrian to walk: along a town road, just off the kerb-side lane
  pedSegment(focus, R) {
    const lanes = this.lanes.lanesNear(focus.x, focus.z, 30, 200).filter((l) => l.edge.cls >= 3 && l.edge.cls <= 7 && l.laneIndex === 0 && l.pts.length >= 2);
    if (!lanes.length) return null;
    for (let tries = 0; tries < 6; tries++) {
      const g = this._pedSeg(lanes[Math.floor(R() * lanes.length)], R);
      // the walk must stay off every carriageway (near junctions the verge of one road runs across another)
      if (g && [0, 0.25, 0.5, 0.75, 1].every((k) => !this.onCarriageway(g.ax + (g.bx - g.ax) * k, g.az + (g.bz - g.az) * k, -0.3))) return g;
    }
    return null;
  }

  onCarriageway(x, z, margin = 0) {
    const t = this.tileAt(x, z);
    return !!t?.ready && t.onRoad(-x - t.E0, z - t.N0, margin, -1, 7);
  }

  _pedSeg(l, R) {
    const i = Math.floor(R() * (l.pts.length - 1)), a = l.pts[i], b = l.pts[i + 1];
    // off the carriageway: 1.3 m beyond the road's edge (the kerb-side lane's centre is (lanes - 0.5) lanes in)
    const hw = ROAD_HALF[l.edge.cls] ?? 3, laneOff = ((l.lanes || 1) - 0.5) * 3.2, off = Math.max(2.6, hw + 1.3 - laneOff);
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, ox = dz / L * off, oz = -dx / L * off;
    // the way across the road (to the same spot on the far side), for crossing
    const across = 2 * (off + laneOff);
    return { ax: a[0] + ox, az: a[1] + oz, bx: b[0] + ox, bz: b[1] + oz, kerala: true, cross: { nx: -ox / off, nz: -oz / off, len: across } };
  }

  // where people stand about near (x, z): tea stalls (chatting) and bus stops (waiting)
  standSpots(x, z, r) {
    const out = [];
    for (const t of this.tiles.values()) {
      if (Math.abs(-(t.E0 + TILE / 2) - x) > TILE / 2 + r || Math.abs(t.N0 + TILE / 2 - z) > TILE / 2 + r) continue;
      for (const b of t.teaShops || []) if (Math.hypot(b.x - x, b.z - z) < r) out.push({ kind: 'tea', ...b, key: `t${Math.round(b.x)},${Math.round(b.z)}` });
      for (const b of t.busStops || []) if (Math.hypot(b.x - x, b.z - z) < r) out.push({ kind: 'bus', x: b.x, z: b.z, yaw: b.yaw, key: `b${Math.round(b.x)},${Math.round(b.z)}` });
    }
    return out;
  }

  // Tree trunks are solid near the player: a small set of colliders refreshed as the player moves (the whole
  // state's trees as colliders would be millions)
  _treeColliders(f) {
    if (!this.trees || !f) return;
    if (this._tcAt && Math.hypot(f.x - this._tcAt.x, f.z - this._tcAt.z) < 20 && this._tcVer === this.tiles.size) return;
    this._tcAt = { x: f.x, z: f.z }; this._tcVer = this.tiles.size;
    for (const c of this._tc || []) this.collision.remove(c);
    this._tc = [];
    const R = 90, TRUNK = { 0: 0.24, 1: 0.32, 4: 0.13, 5: 0.2, 6: 0.45 }; // palm, broadleaf, areca, rubber, bamboo clump
    for (const t of this.tiles.values()) {
      const d = t.trees?.data;
      if (!d) continue;
      const e = -f.x - d.e0, nn = f.z - d.n0;
      if (e < -R || nn < -R || e > TILE + R || nn > TILE + R) continue;
      for (let r = Math.max(0, Math.floor((nn - R) / 100)); r <= Math.min(19, Math.floor((nn + R) / 100)); r++) {
        for (let c = Math.max(0, Math.floor((e - R) / 100)); c <= Math.min(19, Math.floor((e + R) / 100)); c++) {
          for (const i of d.cells.get(c + r * 64) || []) {
            const k = d.P[i * 7 + 3], rad = TRUNK[k];
            if (rad === undefined) continue;
            const x = -(d.e0 + d.P[i * 7]), z = d.n0 + d.P[i * 7 + 1];
            if ((x - f.x) ** 2 + (z - f.z) ** 2 > R * R) continue;
            const hr = rad * Math.max(0.7, d.P[i * 7 + 4]);
            const col = { cx: x, cz: z, hx: hr, hz: hr, cos: 1, sin: 0, angle: 0, h: d.P[i * 7 + 2] + 6, kind: 'tree' };
            this.collision.add(col); this._tc.push(col);
          }
        }
      }
    }
  }

  // F8: what the environment is drawing round the camera
  envStats(env = {}) {
    const n = {}, add = (k, v) => { n[k] = (n[k] || 0) + v; };
    let tiles = 0, smooth = 0;
    for (const t of this.tiles.values()) {
      if (!t.group) continue;
      tiles++; smooth += t.smoothed || 0;
      add('bumps', t.bumps?.length || 0); add('zebras', t.crossings?.length || 0); add('colliders', t.colliders.length);
      for (const c of t.group.children) {
        if (!c.visible) continue;
        const k = c.name.startsWith('detail_') ? c.name.slice(7) : c.name;
        if (c.isInstancedMesh) add(k, c.count); else if (['kerbs', 'compound', 'ao'].includes(k)) add(k + ' tris', c.geometry.attributes.position.count / 3);
      }
    }
    const tr = this.trees?.hi?.map((m) => m.count) || [];
    return [
      `env · tiles ${tiles}  detail ${this.detailOff ? 'OFF' : 'on'}  wet ${(this.wet || 0).toFixed(2)}  night ${(this.night || 0).toFixed(2)}  rain ${(env.rain || 0).toFixed(2)}`,
      `env · kerbs ${((n['kerbs tris'] || 0) / 1000).toFixed(0)}k tris  walls ${((n['compound tris'] || 0) / 1000).toFixed(0)}k  ao ${((n['ao tris'] || 0) / 1000).toFixed(0)}k  breakers ${n.bumps || 0}  zebras ${n.zebras || 0}  colliders ${n.colliders || 0}`,
      `env · ac ${n.ac || 0}  awnings ${n.awning || 0}  signs ${n.sign || 0}  scooters ${n.scooter || 0}  gates ${n.gate || 0}  lamps ${n.lampHeads || 0}  transformers ${n.transformers || 0}`,
      `env · near plants: palm ${tr[0] || 0} broad ${tr[1] || 0} banana ${tr[2] || 0} bush ${tr[3] || 0} areca ${tr[4] || 0} rubber ${tr[5] || 0} bamboo ${tr[6] || 0} grass ${tr[7] || 0}  smoothed pts ${smooth}`,
    ];
  }

  // the signal at a junction for the approaches on one axis: a 44 s cycle, green 18 s, amber 3 s, then red
  signalState(node, axis) {
    const S = this.lanes?.signals?.get(node);
    if (!S) return 'green';
    const t = ((this.state.time || 0) + S.off) % 44, a = axis === 'x' ? t : (t + 22) % 44;
    return a < 18 ? 'green' : a < 21 ? 'yellow' : 'red';
  }

  // the signal poles and heads near the camera, lamps lit by their phase (instanced; refreshed a few times a second)
  _signals(dt, p) {
    if (!this.root || !this.lanes?.signals) return;
    if (!this.sigMeshes) {
      const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; this.root.add(m); return m; };
      const N = 160;
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.6, metalness: 0.3 });
      const lamp = new THREE.MeshBasicMaterial({ color: 0xffffff });
      this.sigMeshes = {
        pole: mk(new THREE.CylinderGeometry(0.07, 0.08, 3.6, 8).translate(0, 1.8, 0), new THREE.MeshStandardMaterial({ color: 0x9a9a92, roughness: 0.7 }), N),
        head: mk(new THREE.BoxGeometry(0.34, 1.0, 0.26).translate(0, 3.4, 0), dark, N),
        lamps: [0, 1, 2].map((k) => mk(new THREE.SphereGeometry(0.1, 10, 8).translate(0, 3.72 - k * 0.32, 0.14), lamp, N)),
      };
      for (const m of this.sigMeshes.lamps) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      this._sigT = 0;
    }
    if ((this._sigT -= dt) > 0) return;
    this._sigT = 0.2;
    const M = this.sigMeshes, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), c = new THREE.Color();
    const ON = [0xff2a1a, 0xffb020, 0x30ff70], OFF = [0x2a0806, 0x2a1c06, 0x062a10];
    let n = 0;
    for (const [node, S] of this.lanes.signals) {
      if (Math.abs(S.x - p.x) > 500 || Math.abs(S.z - p.z) > 500) continue;
      for (const H of S.heads) {
        if (n >= M.pole.instanceMatrix.count) break;
        m4.compose(v.set(H.x, this.groundHeight(H.x, H.z), H.z), q.setFromAxisAngle(up, H.yaw), one);
        M.pole.setMatrixAt(n, m4); M.head.setMatrixAt(n, m4);
        const st = this.signalState(node, H.axis), k = st === 'red' ? 0 : st === 'yellow' ? 1 : 2;
        M.lamps.forEach((L, i) => { L.setMatrixAt(n, m4); L.setColorAt(n, c.setHex(i === k ? ON[i] : OFF[i])); });
        n++;
      }
    }
    for (const m of [M.pole, M.head, ...M.lamps]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  breakCollider(c) { c.broken = true; }

  // -------------------------------------------------------------------------------------- streaming
  update(dt, camera, envState) {
    this.state.time += dt;
    if (!this.index || !camera) return;
    this.lights.update(camera, envState || { night: this.night || 0 }, dt);
    const p = camera.position, tx = Math.floor(-p.x / TILE), tz = Math.floor(p.z / TILE);
    this._signals(dt, p);
    if (tx !== this._ctx || tz !== this._ctz) {
      this._ctx = tx; this._ctz = tz;
      // queue what's missing, nearest first; drop what's far away
      const want = [];
      for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) want.push([tx + dx, tz + dz, dx * dx + dz * dz]);
      want.sort((a, b) => a[2] - b[2]);
      for (const [a, b] of want) if (!this.tiles.get(this.key(a, b))?.ready) this.fetchTile(a, b);
      for (const [k, t] of this.tiles) if (Math.max(Math.abs(t.tx - tx), Math.abs(t.tz - tz)) > KEEP) this._unloadTile(k, t);
    }
    // build at most one loaded tile per frame (the nearest)
    let best = null, bd = Infinity;
    for (const t of this.tiles.values()) {
      if (t.ready) continue;
      const d = this.prio?.has(this.key(t.tx, t.tz)) ? -1 : Math.max(Math.abs(t.tx - tx), Math.abs(t.tz - tz));
      if (d <= RADIUS && d < bd) { bd = d; best = t; }
    }
    // build in stages, a few milliseconds a frame (a whole tile at once stalled the game for a moment)
    if (this.job && !this.tiles.has(this.key(this.job.t.tx, this.job.t.tz))) this.job = null;
    if (!this.job && best) this.job = { t: best, it: this._buildSteps(best) };
    if (this.job) {
      const t0 = performance.now();
      while (performance.now() - t0 < 6) {
        this.job.t._ys = performance.now();   // (the tile's own ~3 ms pauses count from here)
        const a = performance.now(), r = this.job.it.next(), d = performance.now() - a;
        if (this.stepLog) this.stepLog.push([this.job?.last || 'start', d]);
        if (r.done) { this.job = null; break; }
        this.job.last = r.value;
      }
    }
    this.trees?.update(camera, this.tiles);
    this.teaBushes?.update(dt, camera, this);
    this._treeColliders(this.focus || p);
    // the Kerala road follows the shared road's wet / dry look
    const R = this.M?.klRoad, B = this.M?.road;
    if (R && B) { R.userData.u.uWet.value = this.wet || 0; R.roughness = B.roughness; R.color.copy(B.color); R.envMapIntensity = B.envMapIntensity; if (R.roughnessMap !== B.roughnessMap) { R.roughnessMap = B.roughnessMap; R.needsUpdate = true; } }
    // streetlights come on at dusk
    if (this.M?.klLamp) { const nt = this.night || 0, on = Math.max(0, Math.min(1, (nt - 0.3) / 0.4)); this.M.klLamp.emissiveIntensity = on * 3.2; this.M.klLampPool.opacity = on * 0.85; this.M.klLampPool.visible = on > 0.01; }
    if (this.M?.klKerb) this.M.klKerb.roughness = 0.92 - 0.55 * (this.wet || 0);
    // road markings only on the tiles near the camera (sub-pixel further out)
    if (!this._mkT || (this._mkT += dt) > 0.5) {
      this._mkT = 1e-6;
      for (const t of this.tiles.values()) {
        if (!t.group) continue;
        const ex = Math.max(0, Math.abs(-p.x - (t.E0 + TILE / 2)) - TILE / 2), ez = Math.max(0, Math.abs(p.z - (t.N0 + TILE / 2)) - TILE / 2);
        const near = Math.hypot(ex, ez) < 600;
        // the ground: full detail (graded roads) round the camera, coarser further out
        const T = t.terrain?.userData;
        if (T?.lods) { const dd = Math.hypot(ex, ez), l = Math.min(T.lods.length - 1, dd < 900 ? 0 : dd < 2600 ? 1 : 2); if (l !== T.lod) { T.lod = l; t.terrain.geometry.setDrawRange(T.lods[l][0], T.lods[l][1]); } }
        // roadside kiosks and shelters are small: only on the tiles round the camera
        for (const m of t.teaMeshes || []) m.visible = Math.hypot(ex, ez) < 350;
        if (t.stopMesh) t.stopMesh.visible = Math.hypot(ex, ez) < 450;
        for (const c of t.group.children) {
          if (this.detailOff && DETAIL.test(c.name)) c.visible = false;
          else if (c.name === 'lines' || c.name === 'linesY') c.visible = near;
          else if (c.userData.near) {
            const ex2 = Math.max(0, Math.abs(-(t.E0 + c.userData.cc[0]) - p.x) - 250), ez2 = Math.max(0, Math.abs(t.N0 + c.userData.cc[1] - p.z) - 250);
            c.visible = near && Math.hypot(ex2, ez2) < c.userData.near;
            // only the parked scooters within 60 m are drawn: packed at the front of the instance list
            if (c.visible && c.userData.spots) {
              const L = c.userData.spots, gx = -t.E0 - p.x, gz = t.N0 - p.z; let k = 0;
              for (const [m4, , tint] of L) {
                const lx = m4.elements[12], lz = m4.elements[14];
                if (k >= 28 || (lx + gx) ** 2 + (lz + gz) ** 2 > 3600) continue;
                c.setMatrixAt(k, _sm.copy(m4).premultiply(_lift)); if (c.userData.paint) c.setColorAt(k, _sc.set(SCOOTER_PAL[Math.floor((tint || 0) * SCOOTER_PAL.length)])); k++;
              }
              c.count = k; c.instanceMatrix.needsUpdate = true; if (c.instanceColor) c.instanceColor.needsUpdate = true;
              if (!k) c.visible = false;
            }
          }
          else if (c.userData.cc) c.visible = near && Math.hypot(-(t.E0 + c.userData.cc[0]) - p.x, t.N0 + c.userData.cc[1] - p.z) < (c.userData.far || 650);
        }
      }
    }
    this.chunks.nearPos.copy(p);
  }
}

// wall details, vertex-coloured, local +z out of the wall, origin on the wall face (instanced per tile chunk)
function detailGeometries() {
  const kit = () => { const parts = []; return { parts, add(g, hex) { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); }, done() { const g = mergeGeometries(parts); g.computeVertexNormals(); return g; } }; };
  // split AC outdoor unit on two brackets: white casing, the dark fan grille, a pipe running into the wall
  let k = kit();
  k.add(new THREE.BoxGeometry(0.8, 0.55, 0.28).translate(0, 0, 0.16), 0xe4e2dc);
  k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12).rotateX(Math.PI / 2).translate(-0.12, 0, 0.305), 0x2a2a2a);
  for (const x of [-0.3, 0.3]) k.add(new THREE.BoxGeometry(0.04, 0.04, 0.34).translate(x, -0.3, 0.15), 0x5a5a58);
  k.add(new THREE.BoxGeometry(0.05, 0.05, 0.12).translate(0.36, 0.1, 0.0), 0xd8d4c8);
  const acGeo = k.done();
  // PVC downpipe, 1 m tall (scaled to the wall), with a shoe at the foot
  k = kit();
  k.add(new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0.06), 0x707470);
  k.add(new THREE.BoxGeometry(0.12, 0.08, 0.2).translate(0, 0.04, 0.12), 0x606460);
  const pipeGeo = k.done();
  // balcony: a slab 1 m wide (scaled along the wall) jutting out 1.1 m, with a parapet and a steel rail
  k = kit();
  k.add(new THREE.BoxGeometry(1, 0.14, 1.1).translate(0, 0, 0.55), 0xc8c2b4);
  k.add(new THREE.BoxGeometry(1, 0.5, 0.1).translate(0, 0.32, 1.06), 0xd2ccbe);
  for (const x of [-0.5, 0.5]) k.add(new THREE.BoxGeometry(0.08, 0.5, 1.0).translate(x, 0.32, 0.55), 0xd2ccbe);
  k.add(new THREE.BoxGeometry(1, 0.04, 0.05).translate(0, 0.95, 1.06), 0x3a3a3a);
  for (let i = 0; i < 5; i++) k.add(new THREE.BoxGeometry(0.025, 0.4, 0.025).translate(-0.4 + i * 0.2, 0.76, 1.06), 0x3a3a3a);
  const balconyGeo = k.done();
  // house gate in a compound wall: two plastered pillars with caps, a painted steel gate between them
  k = kit();
  for (const x of [-1.5, 1.5]) { k.add(new THREE.BoxGeometry(0.42, 1.75, 0.42).translate(x, 0.88, 0), 0xd6d0c2); k.add(new THREE.BoxGeometry(0.52, 0.12, 0.52).translate(x, 1.81, 0), 0x9a6040); }
  k.add(new THREE.BoxGeometry(2.6, 0.06, 0.05).translate(0, 1.35, 0), 0x2a4a6a);
  k.add(new THREE.BoxGeometry(2.6, 0.06, 0.05).translate(0, 0.25, 0), 0x2a4a6a);
  for (let i = 0; i < 6; i++) k.add(new THREE.BoxGeometry(0.035, 1.1, 0.035).translate(-1.15 + i * 0.46, 0.8, 0), 0x2a4a6a);
  const gateGeo = k.done();
  // shop awning: a sloping sheet 1 m wide (scaled to the bay), 1.3 m deep, on two thin poles at the front
  // (white so the instance colour paints it)
  k = kit();
  k.add(new THREE.BoxGeometry(1, 0.03, 1.35).rotateX(0.22).translate(0, 0, 0.66), 0xffffff);
  k.add(new THREE.BoxGeometry(1, 0.22, 0.02).translate(0, -0.25, 1.32), 0xdddddd);
  const awningGeo = k.done();
  // projecting signboard on a bracket, lit-box style: coloured panel with a pale inner face
  k = kit();
  k.add(new THREE.BoxGeometry(0.05, 0.05, 0.4).translate(0, 0.42, 0.2), 0x4a4a4a);
  k.add(new THREE.BoxGeometry(0.12, 0.75, 0.9).translate(0, 0, 0.75), 0xffffff);
  for (const x of [-0.065, 0.065]) k.add(new THREE.BoxGeometry(0.01, 0.42, 0.66).translate(x, 0, 0.75), 0xf4ecd8);
  const signGeo = k.done();
  // stack of produce crates (bananas / vegetables) out front
  k = kit();
  for (const [x, y, c] of [[-0.3, 0, 0x8a6a3a], [0.3, 0, 0x2a7a3a], [0, 0.32, 0x9a4a2a]]) { k.add(new THREE.BoxGeometry(0.55, 0.3, 0.4).translate(x, y + 0.15, 0), c); k.add(new THREE.BoxGeometry(0.5, 0.08, 0.36).translate(x, y + 0.31, 0), [0xd8c040, 0x5a9a3a, 0xc85a2a][(x > 0) + (y > 0) * 2] ?? 0xd8c040); }
  const crateGeo = k.done();
  // a pair of moulded plastic chairs
  k = kit();
  for (const [x, c] of [[-0.35, 0xe8e8e0], [0.35, 0x2a4a8a]]) {
    k.add(new THREE.BoxGeometry(0.44, 0.04, 0.42).translate(x, 0.45, 0), c);
    k.add(new THREE.BoxGeometry(0.44, 0.45, 0.04).rotateX(-0.12).translate(x, 0.7, -0.2), c);
    for (const dx of [-0.19, 0.19]) for (const dz of [-0.18, 0.18]) k.add(new THREE.BoxGeometry(0.03, 0.45, 0.03).translate(x + dx, 0.22, dz), c);
  }
  const chairGeo = k.done();
  // a parked scooter on its stand, length along local z (painted panels are white, tinted per instance)
  k = kit();
  for (const z of [-0.62, 0.6]) k.add(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 10).rotateZ(Math.PI / 2).translate(0, 0.1, z), 0x111111);
  k.add(new THREE.BoxGeometry(0.34, 0.32, 0.8).translate(0, 0.38, -0.25), 0xffffff);      // rear body
  k.add(new THREE.BoxGeometry(0.3, 0.1, 0.62).translate(0, 0.6, -0.28), 0x1a1a1a);       // seat
  k.add(new THREE.BoxGeometry(0.3, 0.1, 0.5).translate(0, 0.18, 0.18), 0x9a9a9a);        // floorboard
  k.add(new THREE.BoxGeometry(0.32, 0.62, 0.14).rotateX(-0.3).translate(0, 0.5, 0.5), 0xffffff); // front apron
  k.add(new THREE.BoxGeometry(0.62, 0.04, 0.04).translate(0, 0.92, 0.46), 0x2a2a2a);     // handlebar
  k.add(new THREE.BoxGeometry(0.18, 0.12, 0.08).translate(0, 0.86, 0.56), 0xe8e8e0);     // headlamp cowl
  const scooterGeo = k.done();
  return { acGeo, pipeGeo, balconyGeo, gateGeo, awningGeo, signGeo, crateGeo, chairGeo, scooterGeo };
}

const SCOOTER_PAL = [0xe8e8e8, 0x1a1a1a, 0x8a1a1a, 0x2a3a6a, 0x9a9a9a, 0x5a6a5a, 0xc8a020];
const _sm = new THREE.Matrix4(), _lift = new THREE.Matrix4().makeTranslation(0, -0.15, 0), _sc = new THREE.Color();

// the optional environment detail layers (F9 turns them off for an A/B performance check)
const DETAIL = /^(detail_|kerbs$|compound$|ao$|lamp|transformers$|poles$|wires$|ledges$)/;

// a cast-iron manhole cover: a flat disc with a raised rim and a cross pattern (lies on the road)
function manholeGeometry() {
  const parts = [new THREE.CylinderGeometry(0.33, 0.35, 0.025, 14).translate(0, 0.012, 0)];
  for (const a of [0, Math.PI / 2]) parts.push(new THREE.BoxGeometry(0.5, 0.012, 0.05).rotateY(a).translate(0, 0.03, 0));
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

// a coconut palm: a tall, slightly curved trunk and a crown of drooping fronds (~90 triangles)
function palmGeometry() {
  const parts = [];
  const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  // trunk: three tapered segments bending a little
  let x = 0, y = 0;
  for (let i = 0; i < 3; i++) {
    const h = 3.6, r0 = 0.24 - i * 0.04, r1 = r0 - 0.04;
    const g = new THREE.CylinderGeometry(r1, r0, h, 6).translate(0, h / 2, 0).rotateZ(-0.05 * (i + 1)).translate(x, y, 0);
    parts.push(paint(g, i ? 0x8a7458 : 0x7a6448));
    x += Math.sin(0.05 * (i + 1)) * h; y += Math.cos(0.05 * (i + 1)) * h;
  }
  const top = new THREE.Vector3(x, y, 0);
  // fronds: two-segment drooping leaves
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (k % 2) * 0.2, len = 3.6 + (k % 3) * 0.5;
    const g = new THREE.BufferGeometry();
    const w = 0.55, p = [];
    const pts = [[0, 0], [len * 0.5, 0.45], [len, -0.9]];
    for (let s = 0; s < 2; s++) {
      const [d0, y0] = pts[s], [d1, y1] = pts[s + 1], w0 = s ? w : w * 0.6, w1 = s ? 0.05 : w;
      p.push(d0, y0, -w0, d1, y1, -w1, d1, y1, w1, d0, y0, -w0, d1, y1, w1, d0, y0, w0);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.rotateY(a).translate(top.x, top.y, top.z);
    g.computeVertexNormals();
    parts.push(paint(g, k % 2 ? 0x4f7a2a : 0x5d8a30));
  }
  // coconuts
  parts.push(paint(new THREE.IcosahedronGeometry(0.42, 0).translate(top.x, top.y - 0.35, top.z), 0x6a5a2a));
  return mergeGeometries(parts.map((g) => { g.computeVertexNormals(); return g; }));
}

// Mangalore tiles: courses of curved terracotta tiles, each a little different, darkened by monsoon and moss
function mangaloreTiles() {
  const W = 256, cv = document.createElement('canvas'); cv.width = cv.height = W;
  const g = cv.getContext('2d');
  let s = 777;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#5a2a1c'; g.fillRect(0, 0, W, W);
  const rows = 8, cols = 8, rh = W / rows, cw = W / cols;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw, y = r * rh;
    const age = rnd(), base = [152 + rnd() * 30 - age * 50, 70 + rnd() * 18 - age * 25, 44 + rnd() * 12 - age * 12];
    // the tile's curve: light down the middle, dark at the sides
    const gr = g.createLinearGradient(x, 0, x + cw, 0);
    gr.addColorStop(0, `rgb(${base[0] * 0.55},${base[1] * 0.55},${base[2] * 0.55})`);
    gr.addColorStop(0.45, `rgb(${base[0] * 1.08},${base[1] * 1.08},${base[2] * 1.08})`);
    gr.addColorStop(1, `rgb(${base[0] * 0.6},${base[1] * 0.6},${base[2] * 0.6})`);
    g.fillStyle = gr; g.fillRect(x + 1, y + 1, cw - 2, rh - 3);
    // the overlapping lower lip casts a shadow on the course below
    g.fillStyle = 'rgba(30,12,8,0.55)'; g.fillRect(x, y + rh - 4, cw, 4);
    if (age > 0.75) { g.fillStyle = `rgba(30,36,24,${0.25 + rnd() * 0.3})`; g.fillRect(x + 1, y + rh * 0.4, cw - 2, rh * 0.6 - 3); }
  }
  // black monsoon streaks down the slope
  for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(20,18,14,${0.08 + rnd() * 0.12})`; g.fillRect(rnd() * W, 0, 3 + rnd() * 10, W); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// a KSEB concrete pole: tapered square shaft, a crossarm with insulators, a small transformer-less top (~40 tris)
// a streetlight arm bolted to a KSEB pole (pole frame: local -x points over the road), its lamp head, and the
// pool of light it throws on the road; plus a pole-mounted transformer on a two-pole platform (second pole +z)
function lampGeometries() {
  const nx = (g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  const arm = mergeGeometries([
    new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5).rotateZ(Math.PI / 2 - 0.18).translate(-1.05, 7.05, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).rotateZ(-0.7).translate(-0.3, 6.75, 0),
  ].map(nx)); arm.computeVertexNormals();
  const head = nx(new THREE.BoxGeometry(0.62, 0.12, 0.26).translate(-2.15, 7.2, 0)); head.computeVertexNormals();
  const pool = nx(new THREE.CircleGeometry(7, 20).rotateX(-Math.PI / 2).translate(-3.2, 0.32, 0));
  {
    // soft edge: fade by vertex colour (additive, so dark = transparent)
    const P = pool.attributes.position, c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { const d = Math.hypot(P.getX(i) + 3.2, P.getZ(i)) / 7, k = Math.max(0, 1 - d) ** 1.3; c.set([k, k, k], i * 3); }
    pool.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const parts = [];
  const add = (g, hex) => { g = nx(g); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); };
  add(new THREE.CylinderGeometry(0.09, 0.16, 9, 4, 1, true).rotateY(Math.PI / 4).translate(0, 4.5, 2.2), 0x9a968c);
  for (const z of [0, 2.2]) add(new THREE.BoxGeometry(0.9, 0.1, 0.1).translate(0, 4.0, z), 0x6a6a64);
  add(new THREE.BoxGeometry(1.2, 0.08, 2.6).translate(0, 4.05, 1.1), 0x5a5a56);              // platform
  add(new THREE.BoxGeometry(0.9, 1.1, 0.8).translate(0, 4.65, 1.1), 0x6a7468);               // tank
  for (const x of [-0.5, 0.5]) add(new THREE.BoxGeometry(0.1, 0.9, 0.7).translate(x, 4.6, 1.1), 0x5a6458); // cooling fins
  for (const z of [0.85, 1.1, 1.35]) add(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 5).translate(0, 5.4, z), 0x8a5a3a); // bushings
  add(new THREE.BoxGeometry(0.5, 0.6, 0.25).translate(0, 1.6, 1.1), 0x8a8a84);                // fuse box low down
  const trafo = mergeGeometries(parts); trafo.computeVertexNormals();
  return { lampGeo: arm, lampHeadGeo: head, lampPoolGeo: pool, trafoGeo: trafo };
}

function poleGeometry() {
  // ~16 triangles: a tapered square shaft and a crossarm (insulators are too small to matter)
  const shaft = new THREE.CylinderGeometry(0.09, 0.16, 9, 4, 1, true).rotateY(Math.PI / 4).translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(1.7, 0.1, 0.1).translate(0, 7.95, 0);
  const parts = [shaft, arm].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; });
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}

// a roadside bus shelter: concrete posts, a sloping sheet roof, a back wall and a bench (local +z faces the road)
function busStopGeometry() {
  const parts = [];
  const add = (g, hex) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); };
  for (const x of [-1.6, 1.6]) for (const z of [-0.45, 0.45]) add(new THREE.BoxGeometry(0.12, 2.5, 0.12).translate(x, 1.25, z), 0xc8c0b0);
  add(new THREE.BoxGeometry(3.6, 0.08, 1.5).rotateX(-0.12).translate(0, 2.55, 0.05), 0x2a6a8a);       // roof sheet
  add(new THREE.BoxGeometry(3.3, 1.6, 0.08).translate(0, 1.2, -0.5), 0xd8d0c0);                       // back wall
  add(new THREE.BoxGeometry(2.6, 0.08, 0.38).translate(0, 0.46, -0.28), 0x8a6a4a);                     // bench
  add(new THREE.BoxGeometry(2.6, 0.42, 0.08).translate(0, 0.23, -0.1), 0xa09888);
  add(new THREE.BoxGeometry(1.2, 0.32, 0.04).translate(-1.1, 2.15, 0.52), 0x1d4e9e);                   // sign board
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}

// a tea stall (chaya kada): a painted kiosk open at the front, a tin roof jutting out over the counter, glass jars
// of snacks on the counter, a bench outside. Local +z faces the road. Returns [kiosk, signboard].
function teaStallGeometry() {
  const parts = [];
  const add = (g, hex) => { g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g); };
  const wall = 0x3a8a8a;
  add(new THREE.BoxGeometry(2.6, 2.3, 0.1).translate(0, 1.15, -1.0), wall);                 // back
  for (const x of [-1.25, 1.25]) add(new THREE.BoxGeometry(0.1, 2.3, 2.0).translate(x, 1.15, 0), wall); // sides
  add(new THREE.BoxGeometry(2.6, 1.0, 0.12).translate(0, 0.5, 0.95), 0x2a6a6a);              // counter front
  add(new THREE.BoxGeometry(2.7, 0.06, 0.5).translate(0, 1.03, 0.95), 0x8a6a4a);             // counter top
  add(new THREE.BoxGeometry(3.2, 0.05, 3.0).rotateX(0.12).translate(0, 2.42, 0.3), 0x8a8e94); // tin roof
  for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8).translate(-0.8 + i * 0.5, 1.18, 0.95), [0xd8c060, 0xc87a3a, 0xe8d8a0, 0xa0603a][i]); // jars
  add(new THREE.BoxGeometry(1.2, 0.5, 0.6).translate(0, 1.6, -0.7), 0xb8b0a0);               // shelf with the urn
  add(new THREE.CylinderGeometry(0.18, 0.2, 0.45, 10).translate(0.7, 1.28, 0.6), 0xc0c4c8);   // tea urn
  add(new THREE.BoxGeometry(2.0, 0.07, 0.38).translate(0, 0.45, 2.1), 0x6a4a30);             // bench outside
  for (const x of [-0.85, 0.85]) add(new THREE.BoxGeometry(0.08, 0.45, 0.32).translate(x, 0.22, 2.1), 0x5a3a24);
  const g = mergeGeometries(parts); g.computeVertexNormals();
  const sign = new THREE.PlaneGeometry(2.4, 0.5).translate(0, 2.75, 1.78);
  return [g, sign];
}

// the stall's board: ചായക്കട (tea shop) over 'TEA STALL', hand-painted
function teaSignTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#f2d23a'; g.fillRect(0, 0, 512, 112);
  g.strokeStyle = '#b01818'; g.lineWidth = 6; g.strokeRect(4, 4, 504, 104);
  g.fillStyle = '#b01818'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 50px "Nirmala UI","Noto Sans Malayalam",Kartika,sans-serif'; g.fillText('ചായക്കട', 256, 44);
  g.font = 'bold 26px Arial,sans-serif'; g.fillStyle = '#1a1a1a'; g.fillText('TEA STALL', 256, 90);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Kerala's street lighting at night: the lamp heads near the camera glow (additive halos), and a few real
// spotlights (by quality) move to the lamps nearest the camera so the road under them is actually lit
class KeralaLights {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.dyn = []; this.heads = []; this._t = 0;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,210,1)'); g.addColorStop(0.2, 'rgba(255,214,150,0.65)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this.haloMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true, color: 0xffd9a8 });
    this.halos = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.haloMat, 700);
    this.halos.frustumCulled = false; this.halos.count = 0; this.halos.renderOrder = 4;
    scene.add(this.halos);
  }
  rebuild() {}
  addReflection() {}
  flushReflections() {}
  setDynamicCount(n) {
    for (const d of this.dyn) { this.scene.remove(d.light, d.light.target); d.light.dispose(); }
    this.dyn = [];
    for (let i = 0; i < n; i++) {
      // sodium-warm, a wide cone straight down: a pool on the road under each lamp, dark gaps between
      const light = new THREE.SpotLight(0xffc98a, 0, 36, 1.1, 0.6, 1.2);   // (a gentle falloff: a wall by the pole isn't blown out)
      light.castShadow = false;
      this.scene.add(light, light.target);
      this.dyn.push({ light, lamp: null, k: 0 });
    }
  }
  update(camera, env, dt) {
    const night = env.night || 0, on = night > 0.32, p = camera.position;
    // lamp heads near the camera (gathered a few times a second)
    if ((this._t -= dt) <= 0) {
      this._t = 0.4; this.heads.length = 0;
      if (on) for (const t of this.world.tiles.values()) {
        if (!t.ready || !t.lampHeads) continue;
        const L = t.lampHeads;
        for (let i = 0; i < L.length; i += 3) { const dx = L[i] - p.x, dz = L[i + 2] - p.z; if (dx * dx + dz * dz < 300 * 300) this.heads.push([L[i], L[i + 1], L[i + 2]]); }
      }
    }
    // halos, facing the camera
    const H = this.halos, q = camera.quaternion, m = _hm, s = _hs.set(2.8, 2.8, 2.8);
    let n = 0;
    if (on) for (const h of this.heads) { if (n >= H.instanceMatrix.count) break; H.setMatrixAt(n++, m.compose(_hp.set(h[0], h[1], h[2]), q, s)); }
    H.count = n; H.instanceMatrix.needsUpdate = true;
    this.haloMat.opacity = Math.min(1, Math.max(0, night - 0.3) * 2.2);
    const F = this.world.M?.klFestive;
    if (F) { F.opacity = this.haloMat.opacity; F.visible = F.opacity > 0.01; }
    // real lights on the lamps nearest the camera (a little ahead of it preferred)
    if (!this.dyn.length) return;
    const fwd = _hp.set(0, 0, -1).applyQuaternion(q), fx = fwd.x, fz = fwd.z;
    const cand = on ? this.heads.map((h) => { const dx = h[0] - p.x, dz = h[2] - p.z, d = Math.hypot(dx, dz); return { h, s: d - 15 * ((dx * fx + dz * fz) / (d || 1)) }; }).filter((c) => c.s < 110).sort((a, b) => a.s - b.s) : [];
    const want = new Set(cand.slice(0, this.dyn.length).map((c) => c.h)), free = [];
    for (const d of this.dyn) { if (d.lamp && want.has(d.lamp)) want.delete(d.lamp); else free.push(d); }
    const rest = [...want];
    for (const d of this.dyn) {
      if (free.includes(d)) {
        d.k = Math.max(0, d.k - dt * 3);
        if (d.k === 0) { d.lamp = rest.shift() || null; if (d.lamp) { d.light.position.set(d.lamp[0], d.lamp[1] - 0.15, d.lamp[2]); d.light.target.position.set(d.lamp[0], d.lamp[1] - 8, d.lamp[2]); } }
      } else d.k = Math.min(1, d.k + dt * 2.5);
      // (always in the scene: changing the light count would recompile every shader)
      d.light.intensity = d.lamp && on ? d.k * 48 * Math.min(1, (night - 0.3) * 2) : 0;
    }
  }
}
const _hm = new THREE.Matrix4(), _hp = new THREE.Vector3(), _hs = new THREE.Vector3();
