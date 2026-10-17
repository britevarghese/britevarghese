// Reflections on the player's truck (graphics 'high'): a small cube map of the world round it, drawn again a face a
// frame (all six in a tenth of a second), so the paint, the glass and the chrome show the road, the trees and the sky
// going by, not the sky alone. three.js prefilters it for rough and shiny surfaces (PMREM) when a turn is complete.
// It is the environment of the truck's own materials only: what other trucks share (and the garage's preview, which
// draws with its own renderer) keeps the sky's.
import * as THREE from 'three';

export class Probe {
  constructor(size = 128) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    this.cam = new THREE.CubeCamera(0.4, 900, this.rt);
    this.face = 0;
    this.turns = 0;                      // complete turns of the six faces
    this.model = null;
    this.subject = null;
    this.meshes = [];
    this.shown = [];
    this.mats = [];
  }

  /**
   * Give a truck model the probe's reflections: its own materials take the map, and the ones it shares with other
   * trucks are copied for it first (each shared one once, so its parts still share their copy).
   */
  attach(model, intensity = 1) {
    this.model = model;
    this.subject = model.root;
    this.meshes = [];
    this.mats = [];
    this.intensity = intensity;
    const own = new Set([model.paint, model.top, model.screen, model.lightMat, model.barMat, model.brakeMat, model.revMat, ...(model.lampMats || [])]);
    const copies = new Map();
    const give = (m) => {
      if (!m || !m.isMeshStandardMaterial) return m;
      if (own.has(m)) { this.mats.push(m); return m; }
      let c = copies.get(m);
      if (!c) {
        c = m.clone();
        c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
        copies.set(m, c); this.mats.push(c);
      }
      return c;
    };
    model.root.traverse((o) => {
      if (!o.isMesh) return;
      this.meshes.push(o);
      o.material = Array.isArray(o.material) ? o.material.map(give) : give(o.material);
    });
    // (the map goes on once a first turn is drawn: until then the sky's)
    if (this.turns > 0) this.give();
  }

  give() { for (const m of this.mats) { m.envMap = this.rt.texture; m.envMapIntensity = this.intensity; m.needsUpdate = true; } }

  /** One face of the world round the truck (the truck itself left out), from a little above its middle. */
  update(gl, scene) {
    const s = this.subject;
    if (!s || !s.parent) return;
    if (this.cam.coordinateSystem !== gl.coordinateSystem) { this.cam.coordinateSystem = gl.coordinateSystem; this.cam.updateCoordinateSystem(); }
    s.getWorldPosition(this.cam.position);
    this.cam.position.y += 0.9;
    this.cam.updateMatrixWorld(true);
    const shown = this.shown;
    for (let i = 0; i < this.meshes.length; i++) { const m = this.meshes[i]; shown[i] = m.visible; m.visible = false; }
    const target = gl.getRenderTarget(), shadows = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;           // (the last frame's shadows serve)
    gl.setRenderTarget(this.rt, this.face);
    gl.render(scene, this.cam.children[this.face]);
    gl.setRenderTarget(target);
    gl.shadowMap.autoUpdate = shadows;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].visible = shown[i];
    this.face = (this.face + 1) % 6;
    if (this.face === 0) {
      this.rt.texture.needsPMREMUpdate = true;
      if (this.turns++ === 0) this.give();
    }
  }

  /** Back to the sky's light (graphics turned down). */
  detach() {
    for (const m of this.mats) if (m.envMap === this.rt.texture) { m.envMap = null; m.needsUpdate = true; }
    this.model = null; this.subject = null; this.meshes = []; this.mats = []; this.turns = 0; this.face = 0;
  }

  dispose() { this.detach(); this.rt.dispose(); }
}
