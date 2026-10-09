// Life on Kerala's water: country boats (vallam, the canopied kind) and passenger ferries moving about the
// backwaters and the harbour near the camera. Each boat holds a heading, looks ahead for the shore and turns toward
// open water, bobs and rolls on the surface; boats far away are dropped and new ones put on open water nearby
// (ferries only where the channel is wide). Models: public/assets/models/props (tools/import-props.mjs).
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';

const KINDS = {
  vallam: { file: 'props/boat_vallam.glb', speed: [1.2, 2.2], clear: 14, turn: 0.35, weight: 4, bob: 0.06 },
  canopy: { file: 'props/boat_canopy.glb', speed: [1.4, 2.6], clear: 18, turn: 0.3, weight: 3, bob: 0.05 },
  ferry: { file: 'props/boat_ferry.glb', speed: [4.5, 6], clear: 45, turn: 0.07, weight: 1, bob: 0.02, max: 2 },
};
const MAX = 10, NEAR = 90, FAR = 700, DROP = 1000;

export class KeralaBoats {
  constructor(world, scene, assets) {
    this.world = world; this.scene = scene;
    this.models = {};
    this.boats = [];
    this.t = 0; this.R = Math.random;
    for (const [k, K] of Object.entries(KINDS)) {
      assets.loadGLTF('/assets/models/' + K.file, 1).then((g) => {
        // (some models ship glowing, mirror-metal or paper-white paint: real paint here, white at ~80%)
        g.scene.traverse((o) => { for (const m of [].concat(o.material || [])) { if (m.emissive) { m.emissive.setScalar(0); m.emissiveMap = null; } if (m.color) { const hi = Math.max(m.color.r, m.color.g, m.color.b); if (hi > 0.8) m.color.multiplyScalar(0.8 / hi); } if (m.metalness !== undefined) { m.metalness = Math.min(m.metalness, 0.3); m.roughness = Math.max(m.roughness ?? 1, 0.5); } } });
        this.models[k] = g.scene;
      }).catch(() => {});
    }
  }

  // open water at (x, z), clear for r metres round it
  _open(x, z, r) {
    const W = this.world;
    if (!W.inWater(x, z)) return false;
    for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; if (!W.inWater(x + Math.sin(t) * r, z + Math.cos(t) * r)) return false; }
    return true;
  }

  _surface(x, z) {
    const t = this.world.tileAt(x, z);
    return t?.ready ? t._waterY(-x - t.E0, z - t.N0) : null;
  }

  update(dt, cam) {
    this.t += dt;
    const R = this.R;
    // drop the far ones
    for (let i = this.boats.length - 1; i >= 0; i--) {
      const b = this.boats[i];
      if (Math.hypot(b.x - cam.x, b.z - cam.z) > DROP || b.y === null) { this.scene.remove(b.obj); this.boats.splice(i, 1); }
    }
    // a few tries a frame to put a new one on open water nearby
    if (this.boats.length < MAX) {
      for (let k = 0; k < 6; k++) {
        const kinds = Object.keys(KINDS).filter((n) => this.models[n] && (!KINDS[n].max || this.boats.filter((b) => b.kind === n).length < KINDS[n].max));
        if (!kinds.length) break;
        let tot = 0; for (const n of kinds) tot += KINDS[n].weight;
        let r = R() * tot, kind = kinds[0];
        for (const n of kinds) { r -= KINDS[n].weight; if (r <= 0) { kind = n; break; } }
        const K = KINDS[kind], a = R() * Math.PI * 2, d = NEAR + R() * (FAR - NEAR);
        const x = cam.x + Math.sin(a) * d, z = cam.z + Math.cos(a) * d;
        if (!this._open(x, z, K.clear)) continue;
        if (this.boats.some((b) => Math.hypot(b.x - x, b.z - z) < 60)) continue;
        const y = this._surface(x, z);
        if (y === null) continue;
        const obj = AssetManager.clone(this.models[kind]);
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = kind !== 'ferry'; o.receiveShadow = true; } });
        this.scene.add(obj);
        this.boats.push({ kind, obj, x, z, y, yaw: R() * Math.PI * 2, v: K.speed[0] + R() * (K.speed[1] - K.speed[0]), steer: 0, look: 0, ph: R() * 10 });
        break;
      }
    }
    // sail: look ahead for the shore, turn toward open water
    for (const b of this.boats) {
      const K = KINDS[b.kind];
      if ((b.look -= dt) <= 0) {
        b.look = 0.5;
        const ahead = 10 + b.v * 8 + K.clear;
        const clear = (yaw) => this._open(b.x + Math.sin(yaw) * ahead, b.z + Math.cos(yaw) * ahead, K.clear * 0.6);
        if (clear(b.yaw)) b.steer *= 0.5;
        else {
          b.steer = 0;
          for (const d of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, Math.PI]) if (clear(b.yaw + d)) { b.steer = Math.sign(d) || 1; break; }
          if (!b.steer) b.steer = 1;    // boxed in: come round
        }
      }
      b.yaw += b.steer * K.turn * dt;
      // slower while turning hard
      const v = b.v * (b.steer ? 0.6 : 1);
      const nx = b.x + Math.sin(b.yaw) * v * dt, nz = b.z + Math.cos(b.yaw) * v * dt;
      if (this.world.inWater(nx, nz)) { b.x = nx; b.z = nz; }
      const y = this._surface(b.x, b.z);
      if (y !== null) b.y = y;
      const t = this.t + b.ph;
      b.obj.position.set(b.x, b.y + Math.sin(t * 1.3) * K.bob, b.z);
      b.obj.rotation.set(Math.sin(t * 1.1) * K.bob * 0.4, b.yaw, Math.sin(t * 0.9) * K.bob * 0.6 - b.steer * v * 0.004, 'YXZ');
    }
  }
}
