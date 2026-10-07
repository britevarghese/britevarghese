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
    M.terrainDetail = TX.grass().map;
    M.klRoofTile = new THREE.MeshStandardMaterial({ name: 'klRoofTile', color: 0xffffff, map: mangaloreTiles(), roughness: 0.85 });
    M.klPole = new THREE.MeshLambertMaterial({ name: 'klPole', color: 0x9a968c });
    M.klWire = new THREE.LineBasicMaterial({ name: 'klWire', color: 0x1a1a1a, transparent: true, opacity: 0.75 });
    this.poleGeo = poleGeometry();
    M.klLedge = new THREE.MeshStandardMaterial({ name: 'klLedge', color: 0xd6d0c4, roughness: 0.95, side: THREE.DoubleSide });
    M.klRoofFlat = new THREE.MeshStandardMaterial({ name: 'klRoofFlat', color: 0x8d8a82, roughness: 0.95 });
    M.klLineWhite = new THREE.MeshStandardMaterial({ name: 'klLineW', color: 0xe8e8e0, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.klLineYellow = new THREE.MeshStandardMaterial({ name: 'klLineY', color: 0xe0b020, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
    return { trees: this.trees, shadows: p.shadows && p.shadows !== 'off', palms: p.trees ?? 1, palmGeo: this.palmGeo, palmMat: this.palmMat, tankGeo: this.tankGeo, poleGeo: this.poleGeo, ledges: (p.trees ?? 1) >= 0.7, keralaFacade: KERALA_FACADE, keralaShop: KERALA_SHOP, maxBuildings: p.textureSize >= 1024 ? 9000 : 4500 };
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

  _buildTile(t) {
    if (t.ready || !this.root) return;
    const t0 = performance.now();
    this.root.add(t.build(this.M, this._opts()));
    for (const c of t.colliders) this.collision.add(c);
    this.lanes.addTile(t);
    this.buildMs = performance.now() - t0;
  }

  _unloadTile(k, t) {
    this.lanes.removeTile(t);
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
    const h = t.heightAt(-x - t.E0, z - t.N0);
    this._lastH = h;
    return h;
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
    return { ax: a[0] + ox, az: a[1] + oz, bx: b[0] + ox, bz: b[1] + oz, kerala: true };
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
    // road markings only on the tiles near the camera (sub-pixel further out)
    if (!this._mkT || (this._mkT += dt) > 0.5) {
      this._mkT = 1e-6;
      for (const t of this.tiles.values()) {
        if (!t.group) continue;
        const ex = Math.max(0, Math.abs(-p.x - (t.E0 + TILE / 2)) - TILE / 2), ez = Math.max(0, Math.abs(p.z - (t.N0 + TILE / 2)) - TILE / 2);
        const near = Math.hypot(ex, ez) < 600;
        for (const c of t.group.children) {
          if (c.name === 'lines' || c.name === 'linesY') c.visible = near;
          else if (c.userData.cc) c.visible = near && Math.hypot(-(t.E0 + c.userData.cc[0]) - p.x, t.N0 + c.userData.cc[1] - p.z) < 650;
        }
      }
    }
    this.chunks.nearPos.copy(p);
  }
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
function poleGeometry() {
  // ~16 triangles: a tapered square shaft and a crossarm (insulators are too small to matter)
  const shaft = new THREE.CylinderGeometry(0.09, 0.16, 9, 4, 1, true).rotateY(Math.PI / 4).translate(0, 4.5, 0);
  const arm = new THREE.BoxGeometry(1.7, 0.1, 0.1).translate(0, 7.95, 0);
  const parts = [shaft, arm].map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; });
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}
