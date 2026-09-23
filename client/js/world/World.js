// Assembles the battlefield: terrain + roads, modular buildings, props, vegetation, objective flags, distant skyline.
import * as THREE from 'three';
import { CollisionWorld } from '/shared/world.js';
import { FLAGS, MAP_HALF, groundHeight } from '/shared/map.js';
import { mulberry32 } from '/shared/util.js';
import { buildTerrain } from './Terrain.js';
import { buildBuildings } from './Buildings.js';
import { buildProps } from './Props.js';
import { Vegetation } from './Vegetation.js';
import { MaterialLibrary, buildBoxGeometry } from '../render/Materials.js';

export class GameWorld {
  constructor(assets, renderer, quality) {
    this.assets = assets; this.renderer = renderer; this.quality = quality;
    this.collision = new CollisionWorld();
    this.scene = new THREE.Scene();
    this.mats = new MaterialLibrary(assets, quality);
    this.flagMeshes = {};
  }

  async build(progress = () => {}) {
    const s = this.scene;
    progress('terrain');
    s.add(buildTerrain(this.assets, this.quality));
    progress('buildings');
    const b = buildBuildings(this.collision, this.mats);
    s.add(b.group);
    progress('props');
    s.add(await buildProps(this.assets, this.mats, b));
    progress('vegetation');
    this.vegetation = await new Vegetation(this.assets, this.collision, this.quality, this.renderer).init();
    s.add(this.vegetation.group);
    this.#flags();
    this.#skyline();
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

  setFlagState(id, owner, progress, myTeam) {
    const fm = this.flagMeshes[id]; if (!fm) return;
    const col = owner === 0 ? 0xd8d8d8 : owner === myTeam ? 0x3d7fd6 : 0xd6453d;
    fm.cloth.material.color.setHex(col);
    fm.cloth.position.y = 1.2 + 7.1 * Math.abs(progress);
  }

  // distant skyline beyond the playable area: low-detail concrete blocks + ridges, dissolved by fog
  #skyline() {
    const rnd = mulberry32(31337);
    const parts = [];
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2, r = MAP_HALF + 40 + rnd() * 160;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, w = 8 + rnd() * 18, d = 8 + rnd() * 18, h = 6 + rnd() * rnd() * 38;
      const y = Math.max(0, groundHeight(Math.max(-MAP_HALF, Math.min(MAP_HALF, x)), Math.max(-MAP_HALF, Math.min(MAP_HALF, z)))) - 2;
      parts.push({ min: [x - w / 2, y, z - d / 2], max: [x + w / 2, y + h, z + d / 2], mat: rnd() < 0.5 ? 'concrete' : 'plaster' });
    }
    for (const [m, g] of buildBoxGeometry(parts, { tile: 3.2, color: (p) => [0.75, 0.76, 0.78] })) {
      const mesh = new THREE.Mesh(g, this.mats.building(m));
      mesh.name = 'skyline';
      this.scene.add(mesh);
    }
    // outer ground ring so the horizon never shows the void
    const ring = new THREE.Mesh(new THREE.RingGeometry(MAP_HALF * 0.98, 1400, 64, 1), new THREE.MeshStandardMaterial({ color: 0x5e6450, roughness: 1 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 2; this.scene.add(ring);
  }

  update(dt, camera, time) {
    this.vegetation?.update(dt, camera, time);
    if (this.flagTime) this.flagTime.value = time;
  }
}
