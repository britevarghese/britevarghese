// Working mirrors in the first-person view: the rear-view mirror at the top of the windscreen and both door
// mirrors show what is behind, like a real car's. Each is a small camera on the car body looking back from the
// mirror (rear window through the cabin for the centre one, along the flanks for the door mirrors), rendered to
// a texture shown flipped on the mirror glass. Drawn only while driving in first person; the door mirrors
// refresh on alternate frames.
import * as THREE from 'three';
import { interactionProfile } from './Interaction.js';

const SPEC = {
  centre: { w: 0.25, h: 0.07, px: [384, 108], fov: 14 },
  left: { w: 0.16, h: 0.1, px: [192, 120], fov: 24 },
  right: { w: 0.16, h: 0.1, px: [192, 120], fov: 24 },
};

export class Mirrors {
  constructor(rm) {
    this.rm = rm;
    this.v = null;
    this.frame = 0;
    this.on = false;
  }

  _target(w, h) {
    const T = this.rm.backend === 'webgl2' ? THREE.WebGLRenderTarget : THREE.RenderTarget;
    const t = new T(w, h, { depthBuffer: true });
    t.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // a mirror shows the world reversed left to right
    t.texture.wrapS = THREE.RepeatWrapping; t.texture.repeat.x = -1; t.texture.offset.x = 1;
    return t;
  }

  // build the mirrors for a vehicle (cars only: bikes have no cabin mirrors here)
  attach(v) {
    if (this.v === v) return;
    this.detach();
    const r = v?.renderer;
    if (!r || r.bike || v.physics?.p?.bike) return;
    const eye = r.cockpitEye?.();
    if (!eye) return;
    const P = interactionProfile(v);
    const halfW = P?.halfW ?? 0.9, rearZ = P?.box?.min.z ?? -2.2;
    // how far ahead the windscreen is at the mirror's height (the centre mirror hangs just in front of the driver's
    // line of sight, under the header)
    let ws = r._probe?.(0, eye.y + 0.12, eye.z, 0, 0, 1);
    if (ws == null || ws < 0.3 || ws > 1.2) ws = 0.62;
    const pos = {
      // hung from the roof just behind the windscreen's top edge (or ahead of the eyes when the cabin wasn't measured)
      centre: r._cabin ? new THREE.Vector3(0, Math.min(eye.y + 0.06, r._cabin.roof - 0.13), Math.min(r._cabin.zFront - 0.14, eye.z + 0.85)) : new THREE.Vector3(0, eye.y + 0.06, eye.z + Math.min(0.8, ws * 0.9)),
      left: new THREE.Vector3(halfW + 0.06, eye.y - 0.2, eye.z + 0.85),
      right: new THREE.Vector3(-(halfW + 0.06), eye.y - 0.2, eye.z + 0.85),
    };
    const look = {
      centre: new THREE.Vector3(0, eye.y - 0.05, rearZ - 12),
      left: new THREE.Vector3(halfW + 1.1, eye.y - 0.5, rearZ - 18),
      right: new THREE.Vector3(-(halfW + 1.1), eye.y - 0.5, rearZ - 18),
    };
    this.items = [];
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    for (const [k, S] of Object.entries(SPEC)) {
      const rt = this._target(S.px[0], S.px[1]);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.h), new THREE.MeshBasicMaterial({ map: rt.texture }));
      const frame = new THREE.Mesh(new THREE.BoxGeometry(S.w + 0.03, S.h + 0.03, 0.025).translate(0, 0, -0.016), frameMat);
      const m = new THREE.Group(); m.add(frame, glass);
      m.position.copy(pos[k]);
      const cam = new THREE.PerspectiveCamera(S.fov, S.px[0] / S.px[1], k === 'centre' ? 0.08 : 0.15, 180);
      cam.position.copy(pos[k]);
      r.body.add(m, cam);
      r.body.updateWorldMatrix(true, true);
      // the glass faces the driver's eyes; the camera looks back along the car
      m.lookAt(r.body.localToWorld(eye.clone()));
      cam.lookAt(r.body.localToWorld(look[k].clone()));
      m.visible = false;
      this.items.push({ k, rt, mesh: m, cam });
    }
    this.v = v;
  }

  detach() {
    for (const it of this.items || []) { it.mesh.removeFromParent(); it.cam.removeFromParent(); it.rt.dispose(); it.mesh.traverse((o) => { o.geometry?.dispose?.(); }); }
    this.items = []; this.v = null; this._sprites = null;
  }

  // active: driving in first person, looking ahead
  update(scene, v, active) {
    if (active) this.attach(v);
    const on = active && this.v === v && !!this.items?.length;
    for (const it of this.items || []) it.mesh.visible = on;
    if (!on) return;
    const R = this.rm.renderer, rt0 = R.getRenderTarget?.(), auto = R.shadowMap?.autoUpdate;
    if (R.shadowMap) R.shadowMap.autoUpdate = false;  // reuse this frame's shadows
    this.frame++;
    // the mirror glass can't see itself
    for (const it of this.items) it.mesh.visible = false;
    for (const it of this.items) {
      if (it.k !== 'centre' && (this.frame + (it.k === 'left' ? 0 : 1)) % 2) continue;
      // keep the camera's orientation with the body (it is a child of it)
      // the centre mirror looks out of the rear window: the cabin and its occupants aren't in its way (closed-in
      // or simplified interiors would otherwise fill it); the door mirrors show the car's own flank
      if (!this._sprites) { this._sprites = []; v.renderer.group.traverse((o) => { if (o.isSprite || o.isPoints) this._sprites.push(o); }); }
      const hide = it.k === 'centre' ? [v.renderer.lod0, v.renderer.lod1, ...this._sprites, ...(this.hideAlso || [])].filter((o) => o && o.visible) : [];
      for (const o of hide) o.visible = false;
      R.setRenderTarget(it.rt);
      R.render(scene, it.cam);
      for (const o of hide) o.visible = true;
    }
    R.setRenderTarget(rt0 ?? null);
    if (R.shadowMap) R.shadowMap.autoUpdate = auto;
    for (const it of this.items) it.mesh.visible = true;
  }
}
