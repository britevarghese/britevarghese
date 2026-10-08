// KeralaWorld: the real Kerala, all 14 districts, streamed in 2 km tiles built from OpenStreetMap and SRTM
// elevation (tools/kerala/build_tiles.py -> public/assets/world/kerala). Implements the parts of the
// WorldManager interface the game relies on (layout.groundHeight, collision, districtAt, update, ...).
// Coordinates: x = -east, z = north (metres) from Marine Drive, Kochi.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CollisionWorld } from '../physics/Collision.js';
import { KeralaTile, TILE, C, decodeBinary } from './KeralaTile.js';
import * as TX from '../renderer/Textures.js';
import { KERALA_FACADE, KERALA_SHOP } from '../renderer/Textures.js';
import { keralaRoadMaterial } from '../renderer/Materials.js';
import { KeralaLaneGraph } from './KeralaLanes.js';
import { KeralaRouter } from './KeralaRouter.js';
import { KeralaTrees } from './KeralaTrees.js';

const BASE = '/assets/world/kerala/';
const RADIUS = 2;        // tiles loaded around the player (5 x 5 = 10 x 10 km)
const KEEP = 3;          // unloaded beyond this

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
      edges: [], blocks: [], ringSamples: [], nodeMap: new Map(),
      groundHeight: (x, z) => W.groundHeight(x, z),
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
    this.lights = { rebuild() {}, update() {}, setDynamicCount() {}, addReflection() {}, flushReflections() {}, dyn: [] };
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
    M.klDirtRoad = new THREE.MeshStandardMaterial({ name: 'klDirt', color: 0x8e5a3c, roughness: 1 });
    M.klWater = new THREE.MeshStandardMaterial({ name: 'klWater', color: 0x1d4048, roughness: 0.1, metalness: 0.25, normalMap: TX.waterNormal?.(), transparent: true, opacity: 0.92 });
    this.palmGeo = palmGeometry();
    M.klTank = new THREE.MeshStandardMaterial({ name: 'klTank', color: 0x1a1c1e, roughness: 0.6 });
    this.tankGeo = (() => { const g = new THREE.CylinderGeometry(0.62, 0.62, 1.25, 10).translate(0, 0.62 + 0.25, 0); g.deleteAttribute('uv'); return g.toNonIndexed(); })();
    this.palmMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.trees = new KeralaTrees(scene, preset);
    this.queue = [];
  }

  setPreset(p) { this.preset = p; this.trees?.setPreset(p); }

  _opts() {
    const p = this.preset || {};
    return { trees: this.trees, shadows: p.shadows && p.shadows !== 'off', palms: p.trees ?? 1, palmGeo: this.palmGeo, palmMat: this.palmMat, tankGeo: this.tankGeo, poleGeo: this.poleGeo, lampGeo: this.lampGeo, lampHeadGeo: this.lampHeadGeo, lampPoolGeo: this.lampPoolGeo, trafoGeo: this.trafoGeo, manholeGeo: this.manholeGeo, acGeo: this.acGeo, pipeGeo: this.pipeGeo, balconyGeo: this.balconyGeo, gateGeo: this.gateGeo, awningGeo: this.awningGeo, signGeo: this.signGeo, crateGeo: this.crateGeo, chairGeo: this.chairGeo, scooterGeo: this.scooterGeo, realScooter: !!this.scooterParts, ledges: (p.trees ?? 1) >= 0.7, keralaFacade: KERALA_FACADE, keralaShop: KERALA_SHOP, maxBuildings: p.textureSize >= 1024 ? 9000 : 4500 };
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
    const PAL = [0xe8e8e8, 0x1a1a1a, 0x8a1a1a, 0x2a3a6a, 0x9a9a9a, 0x5a6a5a, 0xc8a020];
    const col = new THREE.Color();
    for (let c = 0; c < 16; c++) {
      const L = t.scooterSpots.filter((q) => q[1] === c);
      if (!L.length) continue;
      for (const part of this.scooterParts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, L.length);
        L.forEach(([m4, , tint], i) => { im.setMatrixAt(i, _m4.copy(m4).premultiply(_lift)); if (part.paint) im.setColorAt(i, col.set(PAL[Math.floor((tint || 0) * PAL.length)])); });
        im.computeBoundingSphere(); im.name = 'detail_scooterReal'; im.castShadow = false;
        im.userData.cc = [(c % 4) * 500 + 250, Math.floor(c / 4) * 500 + 250]; im.userData.far = 300;
        im.matrixAutoUpdate = false; im.updateMatrix();
        t.group.add(im); t.scooterMeshes.push(im);
      }
    }
  }

  _buildTile(t) {
    if (t.ready || !this.root) return;
    const t0 = performance.now();
    this.root.add(t.build(this.M, this._opts()));
    this._scooters(t);
    for (const c of t.colliders) this.collision.add(c);
    this.lanes.addTile(t);
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

  groundHeight(x, z) {
    const t = this.tileAt(x, z);
    if (!t) return this._lastH ?? 0;
    const e = -x - t.E0, n = z - t.N0;
    let h = t.heightAt(e, n);
    if (t.ready) h = Math.max(h, t.roadSurface(e, n));
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
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [e, n] = r.pts[i], gx = -(t.E0 + e), gz = t.N0 + n, d = Math.hypot(gx - x, gz - z);
          if (d < bd) { const [e2, n2] = r.pts[i + 1]; bd = d; best = { x: gx, z: gz, yaw: Math.atan2(-(e2 - e), n2 - n), name: r.name || r.ref }; }
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
    const l = lanes[Math.floor(R() * lanes.length)];
    const i = Math.floor(R() * (l.pts.length - 1)), a = l.pts[i], b = l.pts[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, ox = dz / L * 2.6, oz = -dx / L * 2.6;
    // the way across the road (to the same spot on the far side), for crossing
    const across = 2 * (2.6 + ((l.lanes || 1) - 0.5) * 3.2);
    return { ax: a[0] + ox, az: a[1] + oz, bx: b[0] + ox, bz: b[1] + oz, kerala: true, cross: { nx: -ox / 2.6, nz: -oz / 2.6, len: across } };
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

  signalState() { return 'green'; }
  breakCollider(c) { c.broken = true; }

  // -------------------------------------------------------------------------------------- streaming
  update(dt, camera) {
    this.state.time += dt;
    if (!this.index || !camera) return;
    const p = camera.position, tx = Math.floor(-p.x / TILE), tz = Math.floor(p.z / TILE);
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
      const d = Math.max(Math.abs(t.tx - tx), Math.abs(t.tz - tz));
      if (d <= RADIUS && d < bd) { bd = d; best = t; }
    }
    if (best) this._buildTile(best);
    this.trees?.update(camera, this.tiles);
    // the Kerala road follows the shared road's wet / dry look
    const R = this.M?.klRoad, B = this.M?.road;
    if (R && B) { R.userData.u.uWet.value = this.wet || 0; R.roughness = B.roughness; R.color.copy(B.color); R.envMapIntensity = B.envMapIntensity; if (R.roughnessMap !== B.roughnessMap) { R.roughnessMap = B.roughnessMap; R.needsUpdate = true; } }
    // streetlights come on at dusk
    if (this.M?.klLamp) { const nt = this.night || 0, on = Math.max(0, Math.min(1, (nt - 0.3) / 0.4)); this.M.klLamp.emissiveIntensity = on * 3.2; this.M.klLampPool.opacity = on * 0.6; this.M.klLampPool.visible = on > 0.01; }
    if (this.M?.klKerb) this.M.klKerb.roughness = 0.92 - 0.55 * (this.wet || 0);
    // road markings only on the tiles near the camera (sub-pixel further out)
    if (!this._mkT || (this._mkT += dt) > 0.5) {
      this._mkT = 1e-6;
      for (const t of this.tiles.values()) {
        if (!t.group) continue;
        const ex = Math.max(0, Math.abs(-p.x - (t.E0 + TILE / 2)) - TILE / 2), ez = Math.max(0, Math.abs(p.z - (t.N0 + TILE / 2)) - TILE / 2);
        const near = Math.hypot(ex, ez) < 600;
        // roadside kiosks and shelters are small: only on the tiles round the camera
        for (const m of t.teaMeshes || []) m.visible = Math.hypot(ex, ez) < 350;
        if (t.stopMesh) t.stopMesh.visible = Math.hypot(ex, ez) < 450;
        for (const c of t.group.children) {
          if (this.detailOff && DETAIL.test(c.name)) c.visible = false;
          else if (c.name === 'lines' || c.name === 'linesY') c.visible = near;
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
  for (let i = 0; i < 12; i++) k.add(new THREE.BoxGeometry(0.03, 1.1, 0.03).translate(-1.24 + i * 0.225, 0.8, 0), 0x2a4a6a);
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
  const pool = nx(new THREE.CircleGeometry(5.5, 16).rotateX(-Math.PI / 2).translate(-3.2, 0.32, 0));
  {
    // soft edge: fade by vertex colour (additive, so dark = transparent)
    const P = pool.attributes.position, c = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) { const d = Math.hypot(P.getX(i) + 3.2, P.getZ(i)) / 5.5, k = Math.max(0, 1 - d) ** 1.5; c.set([k, k, k], i * 3); }
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
