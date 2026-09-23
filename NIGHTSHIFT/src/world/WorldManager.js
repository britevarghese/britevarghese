// WorldManager: owns the city layout/planner (gameplay data), the collision world and the
// streamed visual representation (chunks, props, lights, distant terrain), plus traffic signals.
import * as THREE from 'three';
import { CityLayout, district, DISTRICT_NAMES, RING } from './CityLayout.js';
import { CityPlanner } from './CityPlanner.js';
import { CollisionWorld } from '../physics/Collision.js';
import { ChunkBuilder } from './ChunkBuilder.js';
import { ChunkManager } from './ChunkManager.js';
import { PropSystem } from './Props.js';
import { LightSystem } from './LightSystem.js';
import { bus } from '../core/EventBus.js';
import { rng } from '../core/util.js';

export const SIGNAL_CYCLE = 34;

export class WorldState {
  constructor() { this.time = 0; this.hour = 23; this.weather = 'clear'; }
}

export class WorldManager {
  constructor() {
    this.layout = new CityLayout();
    this.planner = new CityPlanner(this.layout);
    this.collision = new CollisionWorld();
    for (const c of this.planner.colliders) this.collision.add(c);
    this.state = new WorldState();
  }

  // visual side (not needed on a headless server)
  initVisuals(scene, materials, preset) {
    this.scene = scene;
    this.M = materials;
    this.builder = new ChunkBuilder(this.layout, this.planner, materials);
    this.chunks = new ChunkManager(scene, this.builder, materials, preset);
    this.props = new PropSystem(scene, materials, this.planner, preset);
    this.lights = new LightSystem(scene, materials, this.planner, this.layout);
    this.preset = preset;
    bus.on('chunks:near', (keys) => { this.props.rebuild(keys, preset.props); this.lights.rebuild(keys); });
    this._buildTerrain(scene, materials);
  }

  setPreset(p) { this.preset = p; this.chunks.setPreset(p); this.props.preset = p; }

  _buildTerrain(scene, M) {
    // distant hills ring for depth/silhouettes + a big ground plane beyond the highway
    const ground = new THREE.Mesh(new THREE.RingGeometry(RING + 20, 5200, 64, 1).rotateX(-Math.PI / 2), M.grass);
    ground.position.y = 0.25; ground.receiveShadow = false;
    scene.add(ground);
    const R = rng(99);
    const seg = 160, rings = 6;
    const pos = [], idx = [];
    for (let r = 0; r <= rings; r++) {
      const rad = 1900 + r * 420;
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2;
        const h = r === 0 ? 0 : (Math.sin(a * 3 + 1) * 0.5 + 0.5) * 120 * (r / rings) + Math.sin(a * 11) * 30 * (r / rings) + R() * 25 + (r === rings ? 160 : 0);
        pos.push(Math.cos(a) * rad, h, Math.sin(a) * rad);
      }
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s, b = a + seg + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.hills = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x1a2418 }));
    scene.add(this.hills);
  }

  // Traffic signal state for approach axis 'x' | 'z' at node
  signalState(nodeId, axis) {
    const n = this.layout.nodes[nodeId];
    if (!n?.signal) return 'green';
    const t = ((this.state.time + n.phaseOffset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
    // z (N-S) green 0-13, yellow 13-16, all-red 16-17; x (E-W) green 17-30, yellow 30-33, red 33-34
    if (axis === 'z') return t < 13 ? 'green' : t < 16 ? 'yellow' : 'red';
    return t >= 17 && t < 30 ? 'green' : t >= 30 && t < 33 ? 'yellow' : 'red';
  }

  districtAt(x, z) { const d = district(x, z); return { id: d, name: DISTRICT_NAMES[d] }; }

  update(dt, camera, envState) {
    this.state.time += dt;
    if (!this.chunks) return;
    this.chunks.update(camera.position, dt);
    this.lights.update(camera, envState);
    this.props.updateSignals((id, axis) => this.signalState(id, axis), envState.night);
  }
}
