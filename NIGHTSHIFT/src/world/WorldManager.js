// WorldManager: owns the city layout/planner (gameplay data), the collision world and the
// streamed visual representation (chunks, props, lights, distant terrain), plus traffic signals.
import * as THREE from 'three';
import { CityLayout, district, DISTRICT_NAMES } from './CityLayout.js';
import { CityPlanner } from './CityPlanner.js';
import { CollisionWorld } from '../physics/Collision.js';
import { ChunkBuilder } from './ChunkBuilder.js';
import { ChunkManager } from './ChunkManager.js';
import { PropSystem } from './Props.js';
import { LightSystem } from './LightSystem.js';
import { Landscape } from './Landscape.js';
import { CityImpostor } from './CityImpostor.js';
import { ringEdgeDist, bearing, seaMask, mountainMask, farmMask } from './Terrain.js';
import { bus } from '../core/EventBus.js';

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
  initVisuals(scene, materials, preset, opts = {}) {
    this.scene = scene;
    this.M = materials;
    this.builder = new ChunkBuilder(this.layout, this.planner, materials);
    this.chunks = new ChunkManager(scene, this.builder, materials, preset);
    this.props = new PropSystem(scene, materials, this.planner, preset);
    this.lights = new LightSystem(scene, materials, this.planner, this.layout);
    this.lights.setDynamicCount(preset.streetLights || 0);
    this.preset = preset;
    bus.on('chunks:near', (keys) => { this.nearKeys = keys; this.props.rebuild(keys, this.preset.props); this.lights.rebuild(keys, this.chunks.nearPos); });
    bus.on('prop:break', ({ p }) => { if (!p) return; this.props.hide(p); if (p.type === 'lamp') this.lights.rebuild(this.nearKeys || []); });
    bus.on('prop:restore', () => { if (this.nearKeys) { this.props.rebuild(this.nearKeys, this.preset.props); this.lights.rebuild(this.nearKeys); } });
    this._buildTerrain(scene, materials);
    // the far city (skyline from the hills); WebGL2 only (it relies on a vertex-shader patch)
    if (!opts.webgpu) this.chunks.impostor = new CityImpostor(scene, this.layout, this.planner, materials);
  }

  setPreset(p) {
    this.preset = p; this.chunks.setPreset(p); this.props.preset = p;
    if (this.lights && this.lights.dyn.length !== (p.streetLights || 0)) this.lights.setDynamicCount(p.streetLights || 0);
  }

  _buildTerrain(scene, M) {
    // the countryside beyond the ring highway: terrain, sea, forests, country roads, landmarks
    this.landscape = new Landscape(scene, M, this.preset);
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

  districtAt(x, z) {
    // the countryside has its own names
    const e = ringEdgeDist(x, z);
    if (e > 40) {
      const a = bearing(x, z);
      const id = seaMask(a) > 0.5 ? 'coast' : mountainMask(a) > 0.5 && e > 500 ? 'range' : farmMask(a) > 0.5 ? 'farms' : 'country';
      return { id, name: { coast: 'Halvern Coast', range: 'Halvern Range', farms: 'Harvest Valley', country: 'Halvern Hills' }[id] };
    }
    const d = district(x, z); return { id: d, name: DISTRICT_NAMES[d] };
  }

  update(dt, camera, envState) {
    this.state.time += dt;
    if ((this._restoreT = (this._restoreT || 0) - dt) <= 0) { this._restoreT = 3; this._restoreBroken(camera?.position); }
    if (!this.chunks) return;
    this.chunks.update(camera.position, dt);
    this.lights.update(camera, envState, dt);
    this.landscape?.update(camera, envState, dt);
    this.props.updateSignals((id, axis) => this.signalState(id, axis), envState.night);
    // aviation beacons: slow synchronized blink, dim steady red by day
    const ph = (this.state.time * 0.75) % 1;
    const on = ph < 0.18 ? 1 : ph < 0.3 ? 1 - (ph - 0.18) / 0.12 : 0;
    this.M.beacon.color.setRGB(envState.night > 0.3 ? 0.25 + on * 3.5 : 0.35 + on * 0.5, 0.02, 0.01);
  }
}
