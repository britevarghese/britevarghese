// Assembles the battlefield: terrain + roads, modular buildings, props, vegetation, objective flags, distant skyline.
import * as THREE from 'three';
import { CollisionWorld } from '/shared/world.js';
import { FLAGS, MAP_HALF, groundHeight, ACTIVE_MAP, SEA_LEVEL, seaFactor } from '/shared/map.js';
import { mulberry32 } from '/shared/util.js';
import { buildTerrain, outerHeight } from './Terrain.js';
import { buildBuildings } from './Buildings.js';
import { buildProps } from './Props.js';
import { buildStructures } from './Structures.js';
import { Vegetation } from './Vegetation.js';
import { MaterialLibrary, buildBoxGeometry } from '../render/Materials.js';

export class GameWorld {
  constructor(assets, renderer, quality) {
    this.assets = assets; this.renderer = renderer; this.quality = quality;
    const t0 = performance.now();
    this.collision = new CollisionWorld(ACTIVE_MAP);
    this.timings = { collision: Math.round(performance.now() - t0) }; // world build ms per stage (perf checks)
    this.scene = new THREE.Scene();
    this.mats = new MaterialLibrary(assets, quality);
    this.flagMeshes = {};
  }

  async build(progress = () => {}) {
    const s = this.scene;
    let t = performance.now();
    const stage = (k) => { const n = performance.now(); this.timings[k] = Math.round(n - t); t = n; };
    progress('terrain');
    s.add(buildTerrain(this.assets, this.quality));
    stage('terrain');
    progress('buildings');
    const b = buildBuildings(this.collision, this.mats);
    s.add(b.group);
    this.glass = b.glass;
    this.glassPanes = new Map(this.collision.glass.map((p) => [p.id, p]));
    stage('buildings');
    progress('props');
    s.add(await buildProps(this.assets, this.mats, b));
    s.add(buildStructures(this.mats));
    stage('props');
    progress('vegetation');
    this.vegetation = await new Vegetation(this.assets, this.collision, this.quality, this.renderer).init();
    s.add(this.vegetation.group);
    stage('vegetation');
    this.#flags();
    if (ACTIVE_MAP.sea) this.#sea(ACTIVE_MAP.sea);
    this.#skyline();
    stage('skyline');
    return this;
  }

  #flags() {
    const poleMat = this.mats.pbr('rusty_metal', { color: 0xaaaaaa });
    for (const f of FLAGS) {
      const g = new THREE.Group();
      const y = groundHeight(f.x, f.z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 9, 10), poleMat);
      pole.position.y = 4.5; pole.castShadow = true; g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 12), this.mats.building('concrete'));
      base.position.y = 0.1; base.receiveShadow = true; g.add(base);
      // cloth: subdivided plane waved in the vertex shader
      const clothGeo = new THREE.PlaneGeometry(1.8, 1.1, 18, 10); clothGeo.translate(0.9, 0, 0);
      const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.95, side: THREE.DoubleSide }));
      cloth.material.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.flagTime || (this.flagTime = { value: 0 });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat k = position.x / 1.8; transformed.z += sin(position.x * 3.0 - uTime * 5.0) * 0.12 * k + sin(position.y * 4.0 + uTime * 3.0) * 0.03 * k; transformed.y -= k * k * 0.08;');
      };
      cloth.position.set(0.05, 8.3, 0); cloth.castShadow = true;
      g.add(cloth);
      g.position.set(f.x, y, f.z);
      this.scene.add(g);
      this.flagMeshes[f.id] = { group: g, cloth, height: 8.3 };
    }
  }

  // harbour water (animated normal ripples + sky reflections) and the concrete quay wall
  #sea(sea) {
    const size = 2600;
    const g = new THREE.PlaneGeometry(size, size, 1, 1); g.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x1d3a40, roughness: 0.08, metalness: 0.25, envMapIntensity: 1.3, transparent: true, opacity: 0.93 }));
    water.material.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.flagTime || (this.flagTime = { value: 0 });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vWp;')
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          vec2 p = vWp.xz;
          float t = uTime;
          vec3 wn = normalize(vec3(sin(p.x*0.35+t*1.1)*0.06 + sin(p.x*1.7+p.y*0.9+t*2.3)*0.03, 1.0, cos(p.y*0.31-t*0.9)*0.06 + sin(p.y*1.9-p.x*0.7+t*2.1)*0.03));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`);
    };
    const along = sea.axis === 'z';
    water.position.set(along ? 0 : sea.at + sea.dir * size / 2, SEA_LEVEL, along ? sea.at + sea.dir * size / 2 : 0);
    water.receiveShadow = true;
    water.name = 'sea';
    this.scene.add(water);
    // quay wall: concrete face down to the water + a coping edge (matches the collider in shared/world.js)
    const y = groundHeight(along ? 0 : sea.at - sea.dir, along ? sea.at - sea.dir : 0);
    const H = MAP_HALF * 3;
    const parts = along
      ? [{ min: [-H, -6, Math.min(sea.at, sea.at + sea.dir * 0.6)], max: [H, y + 1.1, Math.max(sea.at, sea.at + sea.dir * 0.6)], mat: 'concrete_slab' }]
      : [{ min: [Math.min(sea.at, sea.at + sea.dir * 0.6), -6, -H], max: [Math.max(sea.at, sea.at + sea.dir * 0.6), y + 1.1, H], mat: 'concrete_slab' }];
    for (const [m, geo] of buildBoxGeometry(parts, { tile: 1, color: (p) => { const k = p[1] < -0.5 ? 0.55 : 0.9; return [k, k, k * 0.98]; } })) {
      const mesh = new THREE.Mesh(geo, this.mats.building(m)); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'quay'; this.scene.add(mesh);
    }
  }

  // a window pane shattered: collapse its 4 vertices (returns the pane, or null if unknown / already gone)
  breakGlass(id) {
    const G = this.glass, i = G?.index.get(id);
    if (i === undefined) return null;
    const pos = G.mesh.geometry.attributes.position, a = pos.array;
    if (a[i * 3 + 1] === a[i * 3 + 10]) return null; // already broken (top-left and bottom-right corners collapsed)
    const cx = (a[i * 3] + a[i * 3 + 9]) / 2, cy = (a[i * 3 + 1] + a[i * 3 + 10]) / 2, cz = (a[i * 3 + 2] + a[i * 3 + 11]) / 2;
    for (let k = 0; k < 4; k++) { a[(i + k) * 3] = cx; a[(i + k) * 3 + 1] = cy; a[(i + k) * 3 + 2] = cz; }
    pos.needsUpdate = true;
    return this.glassPanes.get(id) || null;
  }

  repairGlass() {
    const G = this.glass; if (!G) return;
    G.mesh.geometry.attributes.position.array.set(G.original);
    G.mesh.geometry.attributes.position.needsUpdate = true;
  }

  setFlagState(id, owner, progress, myTeam) {
    const fm = this.flagMeshes[id]; if (!fm) return;
    const col = owner === 0 ? 0xd8d8d8 : owner === myTeam ? 0x3d7fd6 : 0xd6453d;
    fm.cloth.material.color.setHex(col);
    fm.cloth.position.y = 1.2 + 7.1 * Math.abs(progress);
  }

  // Distant settlements on the hills around the map: villages of small houses (light walls, darker pitched roofs,
  // ridge along the street) with a church tower here and there, seated on the outer terrain, never over the sea;
  // anchored ships out on the water on harbour maps. One merged mesh, no shadows, dissolved by the fog.
  #skyline() {
    const rnd = mulberry32(31337 + Math.round(MAP_HALF));
    const P = [], C = [];
    const tri = (a, b, c, col) => { P.push(...a, ...b, ...c); for (let i = 0; i < 3; i++) C.push(...col); };
    const quad = (a, b, c, d, col) => { tri(a, b, c, col); tri(a, c, d, col); };
    // an oriented box (centre, half sizes, yaw, base y) with an optional gable roof along its local x
    const house = (cx, cz, hx, hz, yaw, y, wall, roofH, wc, rc) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, ly, lz) => [cx + lx * c + lz * s, y + ly, cz - lx * s + lz * c];
      const k = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
      for (let i = 0; i < 4; i++) { const [ax, az] = k[i], [bx, bz] = k[(i + 1) % 4]; quad(at(ax, 0, az), at(bx, 0, bz), at(bx, wall, bz), at(ax, wall, az), wc); }
      if (!roofH) { quad(at(-hx, wall, -hz), at(-hx, wall, hz), at(hx, wall, hz), at(hx, wall, -hz), rc); return; }
      const o = 0.35; // eaves overhang
      tri(at(-hx, wall, -hz), at(-hx, wall, hz), at(-hx, wall + roofH, 0), wc); tri(at(hx, wall, hz), at(hx, wall, -hz), at(hx, wall + roofH, 0), wc);
      quad(at(-hx - o, wall - 0.25, -hz - o), at(-hx - o, wall + roofH, 0), at(hx + o, wall + roofH, 0), at(hx + o, wall - 0.25, -hz - o), rc);
      quad(at(hx + o, wall - 0.25, hz + o), at(hx + o, wall + roofH, 0), at(-hx - o, wall + roofH, 0), at(-hx - o, wall - 0.25, hz + o), rc);
    };
    const WALLS = [[0.86, 0.83, 0.76], [0.92, 0.9, 0.85], [0.8, 0.72, 0.58], [0.74, 0.74, 0.72], [0.85, 0.76, 0.7]];
    const ROOFS = [[0.48, 0.24, 0.17], [0.42, 0.2, 0.15], [0.3, 0.29, 0.29], [0.36, 0.22, 0.18], [0.24, 0.24, 0.26]];
    const H = MAP_HALF, wet = (x, z) => seaFactor(x, z) > 0 || outerHeight(x, z) < SEA_LEVEL + 1.5;
    const groundAt = (x, z, r) => { let lo = Infinity, hi = -Infinity; for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { const h = outerHeight(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h); } return [lo, hi]; };
    let villages = 0;
    for (let v = 0; v < 60 && villages < 10; v++) {
      // somewhere on a square ring 40-230 m outside the map edge
      const d = H + 40 + rnd() * 190, t = (rnd() * 2 - 1) * d, side = Math.floor(rnd() * 4);
      const [vx, vz] = [[t, -d], [d, t], [-t, d], [-d, -t]][side];
      if (wet(vx, vz) || wet(vx * 0.85, vz * 0.85)) continue;
      const [lo, hi] = groundAt(vx, vz, 30);
      if (hi - lo > 18) continue; // no villages on cliffs
      villages++;
      const yaw = rnd() * Math.PI, ux = Math.cos(yaw), uz = -Math.sin(yaw), n = 6 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) {
        // houses along a village street (both sides), a second row behind now and then
        const along = (i - n / 2) * (9 + rnd() * 4) * 0.55, off = (i % 2 ? 1 : -1) * (7 + (rnd() < 0.25 ? 12 : 0) + rnd() * 3);
        const x = vx + ux * along + uz * off, z = vz + uz * along - ux * off;
        const hx = 3 + rnd() * 2, hz = 3.5 + rnd() * 1.5, [gl, gh] = groundAt(x, z, Math.max(hx, hz));
        if (gh - gl > 3 || wet(x, z)) continue;
        const floors = rnd() < 0.6 ? 1 : 2, wall = floors * 2.9 + 0.4 + (gh - gl);
        const wc = WALLS[Math.floor(rnd() * WALLS.length)], rc = ROOFS[Math.floor(rnd() * ROOFS.length)];
        house(x, z, hx, hz, yaw + (rnd() - 0.5) * 0.15, gl - 0.4, wall, hz * 0.7 * (0.85 + rnd() * 0.3), wc, rc);
      }
      if (n > 11) { // the church: nave + tower with a spire
        const x = vx - uz * 16, z = vz + ux * 16, [gl] = groundAt(x, z, 6);
        house(x, z, 8, 4.5, yaw, gl - 0.4, 8, 3.6, WALLS[1], ROOFS[2]);
        const tx = x + ux * 9.5, tz = z + uz * 9.5;
        house(tx, tz, 2.2, 2.2, yaw, gl - 0.4, 17, 0, WALLS[1], WALLS[1]);
        const c = Math.cos(yaw), s = Math.sin(yaw), y = gl + 16.6, at = (lx, lz) => [tx + lx * c + lz * s, y, tz - lx * s + lz * c], top = [tx, y + 7, tz];
        const k = [at(-2.4, -2.4), at(2.4, -2.4), at(2.4, 2.4), at(-2.4, 2.4)];
        for (let q = 0; q < 4; q++) tri(k[q], k[(q + 1) % 4], top, ROOFS[4]);
      }
    }
    // harbour maps: ships riding at anchor out in the bay (hull, deck cargo, white superstructure aft)
    const sea = ACTIVE_MAP.sea;
    if (sea) for (let i = 0; i < 3; i++) {
      const dist = 150 + i * 70 + rnd() * 40, across = (rnd() * 2 - 1) * H * 1.3, along = sea.at + sea.dir * dist;
      const [x, z] = sea.axis === 'z' ? [across, along] : [along, across], yaw = (sea.axis === 'z' ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.5;
      const L = 60 + rnd() * 50, B = L * 0.15;
      house(x, z, L / 2, B / 2, yaw, SEA_LEVEL - 1, 7, 0, [0.18, 0.2, 0.24], [0.4, 0.38, 0.35]);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (let k = 0; k < 4; k++) { const lx = -L * 0.32 + k * L * 0.15; house(x + lx * c, z - lx * s, L * 0.06, B * 0.4, yaw, SEA_LEVEL + 6, 2.6 * (1 + (k % 3)), 0, [[0.62, 0.22, 0.16], [0.2, 0.33, 0.45], [0.55, 0.5, 0.42]][k % 3], [0.4, 0.3, 0.25]); }
      house(x + L * 0.38 * c, z - L * 0.38 * s, L * 0.07, B * 0.42, yaw, SEA_LEVEL + 6, 11, 0, [0.88, 0.88, 0.85], [0.8, 0.8, 0.78]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide }));
    mesh.name = 'skyline';
    this.scene.add(mesh);
  }

  update(dt, camera, time) {
    this.vegetation?.update(dt, camera, time);
    if (this.flagTime) this.flagTime.value = time;
  }
}
