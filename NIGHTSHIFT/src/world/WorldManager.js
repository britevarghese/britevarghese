// WorldManager: owns the city layout/planner (gameplay data), the collision world and the
// streamed visual representation (chunks, props, lights, distant terrain), plus traffic signals.
import * as THREE from 'three';
import { CityLayout, district, DISTRICT_NAMES, RING, RING_CORNER_R } from './CityLayout.js';
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
    this.lights.setDynamicCount(preset.streetLights || 0);
    this.preset = preset;
    bus.on('chunks:near', (keys) => { this.nearKeys = keys; this.props.rebuild(keys, this.preset.props); this.lights.rebuild(keys); });
    bus.on('prop:break', ({ p }) => { if (!p) return; this.props.hide(p); if (p.type === 'lamp') this.lights.rebuild(this.nearKeys || []); });
    bus.on('prop:restore', () => { if (this.nearKeys) { this.props.rebuild(this.nearKeys, this.preset.props); this.lights.rebuild(this.nearKeys); } });
    this._buildTerrain(scene, materials);
  }

  setPreset(p) {
    this.preset = p; this.chunks.setPreset(p); this.props.preset = p;
    if (this.lights && this.lights.dyn.length !== (p.streetLights || 0)) this.lights.setDynamicCount(p.streetLights || 0);
  }

  _buildTerrain(scene, M) {
    // distant hills ring for depth/silhouettes + a big ground plane beyond the highway. The hole
    // follows the ring's rounded-square outer edge (a circular hole would cover the highway's
    // straights and the city's corner districts with grass).
    const outer = new THREE.Shape();
    outer.absarc(0, 0, 5200, 0, Math.PI * 2, false);
    const H = RING + 18, Rc = RING_CORNER_R + 18, C = H - Rc;
    const hole = new THREE.Path();
    hole.moveTo(H, -C); hole.lineTo(H, C); hole.absarc(C, C, Rc, 0, Math.PI / 2, false);
    hole.lineTo(-C, H); hole.absarc(-C, C, Rc, Math.PI / 2, Math.PI, false);
    hole.lineTo(-H, -C); hole.absarc(-C, -C, Rc, Math.PI, Math.PI * 1.5, false);
    hole.lineTo(C, -H); hole.absarc(C, -C, Rc, Math.PI * 1.5, Math.PI * 2, false);
    outer.holes.push(hole);
    const gg = new THREE.ShapeGeometry(outer, 24).rotateX(-Math.PI / 2);
    // world-scaled UVs like the chunk grass
    const uvA = gg.attributes.uv, pA = gg.attributes.position;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, pA.getX(i) / 16, -pA.getZ(i) / 16);
    const ground = new THREE.Mesh(gg, M.grass);
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

  // called by VehiclePhysics when a breakable prop is knocked over
  breakCollider(c, vx, vz, speed) {
    c.broken = true;
    c.brokenAt = this.state.time;
    if (c.prop) c.prop.broken = true;
    (this.broken ||= []).push(c);
    bus.emit('prop:break', { c, p: c.prop, vx, vz, speed });
  }

  // broken props quietly come back once they've been out of the player's way for a while
  _restoreBroken(pos) {
    if (!this.broken?.length) return;
    const keep = [];
    const restored = [];
    for (const c of this.broken) {
      const far = !pos || Math.hypot(c.cx - pos.x, c.cz - pos.z) > 140;
      if (this.state.time - c.brokenAt > 75 && far) { c.broken = false; if (c.prop) c.prop.broken = false; restored.push(c); } else keep.push(c);
    }
    this.broken = keep;
    if (restored.length) bus.emit('prop:restore', restored);
  }

  districtAt(x, z) { const d = district(x, z); return { id: d, name: DISTRICT_NAMES[d] }; }

  update(dt, camera, envState) {
    this.state.time += dt;
    if ((this._restoreT = (this._restoreT || 0) - dt) <= 0) { this._restoreT = 3; this._restoreBroken(camera?.position); }
    if (!this.chunks) return;
    this.chunks.update(camera.position, dt);
    this.lights.update(camera, envState, dt);
    this.props.updateSignals((id, axis) => this.signalState(id, axis), envState.night);
    // aviation beacons: slow synchronized blink, dim steady red by day
    const ph = (this.state.time * 0.75) % 1;
    const on = ph < 0.18 ? 1 : ph < 0.3 ? 1 - (ph - 0.18) / 0.12 : 0;
    this.M.beacon.color.setRGB(envState.night > 0.3 ? 0.25 + on * 3.5 : 0.35 + on * 0.5, 0.02, 0.01);
  }
}
