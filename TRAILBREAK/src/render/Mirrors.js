// The player's car's mirrors, seen from the driver's seat: the rear-view mirror and the door mirrors show what is behind.
// Each is a flat glass whose picture a camera draws: from where the driver's eye would be reflected behind the glass,
// through the glass's own rectangle (an off-axis frustum fitted to it, so the whole picture lands on the glass, and its
// near plane on the glass: nothing behind the mirror shows in it). The pictures are small and drawn one mirror a frame
// in turn (a mirror's view changes slowly), and only while they can be seen.
import * as THREE from 'three';

const _e = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

export class Mirror {
  /** w, h: the glass's size (m); res: its picture's [width, height] in pixels. */
  constructor(w, h, res) {
    this.w = w; this.h = h;
    this.rt = new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType });
    this.cam = new THREE.PerspectiveCamera();
    // (seen from behind the glass, the camera's left is the glass's right: the picture goes on turned round)
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    // (dark glass until its first picture is drawn: on low graphics, for good)
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x1c2228 }));
    this.mesh.userData.mirror = this;
    this.drawn = false;
  }

  /**
   * Place it in its parent's frame: the glass's middle at c, facing between the eye and the way it should look
   * (`look`: the direction it shows, from the glass), as a driver sets a mirror.
   */
  aim(c, eye, look) {
    const toEye = _e.subVectors(eye, c).normalize(), n = _n.copy(look).normalize().add(toEye).normalize();
    _x.crossVectors(UP, n).normalize(); _y.crossVectors(n, _x);
    this.mesh.position.copy(c).addScaledVector(n, 0.012);
    this.mesh.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, n));
  }

  /** Draw its picture for an eye at (world) eyePos. */
  draw(renderer, scene, eyePos) {
    const m = this.mesh;
    m.updateWorldMatrix(true, false);
    const W = m.matrixWorld;
    _c.setFromMatrixPosition(W);
    _x.setFromMatrixColumn(W, 0).normalize(); _y.setFromMatrixColumn(W, 1).normalize(); _n.setFromMatrixColumn(W, 2).normalize();
    const d0 = _e.copy(eyePos).sub(_c).dot(_n);
    if (d0 <= 0.01) return false;                                       // (the eye behind the glass: it shows nothing)
    // the eye reflected behind the glass, and the glass's corners as it sees them (its left is the glass's right)
    const pe = _e.copy(eyePos).addScaledVector(_n, -2 * d0);
    const hw = this.w / 2, hh = this.h / 2;
    _pa.copy(_c).addScaledVector(_x, hw).addScaledVector(_y, -hh);
    _pb.copy(_c).addScaledVector(_x, -hw).addScaledVector(_y, -hh);
    _pc.copy(_c).addScaledVector(_x, hw).addScaledVector(_y, hh);
    const vr = _x.clone().negate(), vu = _y, vn = _n.clone().negate();      // (vn: from the glass toward that eye)
    const va = _pa.sub(pe), vb = _pb.sub(pe), vc = _pc.sub(pe);
    const d = -va.dot(vn), near = Math.max(0.01, d), far = 800, k = near / d;
    const cam = this.cam;
    cam.position.copy(pe);
    cam.quaternion.setFromRotationMatrix(_m.makeBasis(vr, vu, vn));
    cam.updateMatrixWorld(true);
    cam.projectionMatrix.makePerspective(vr.dot(va) * k, vr.dot(vb) * k, vu.dot(vc) * k, vu.dot(va) * k, near, far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    const target = renderer.getRenderTarget(), shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    m.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(target);
    renderer.shadowMap.autoUpdate = shadows;
    m.visible = true;
    if (!this.drawn) { m.material.map = this.rt.texture; m.material.color.set(0xd2d4d6); m.material.needsUpdate = true; }
    this.drawn = true;
    return true;
  }

  dispose() { this.rt.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

/** A car's mirrors, drawn in turn: one a frame (every frame on high graphics, every other on medium). */
export class Mirrors {
  constructor(list) { this.list = list; this.k = 0; this.t = 0; }

  /** hide: things left out of the mirrors' pictures while they are drawn (the grass: too small to see in them). */
  update(renderer, scene, eyePos, every = 1, hide = []) {
    if (!this.list.length || ++this.t % every) return;
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    // (the first time round, all of them: none shows the clear colour)
    const n = this.list.some((m) => !m.drawn) ? this.list.length : 1;
    for (let i = 0; i < n; i++) { this.list[this.k].draw(renderer, scene, eyePos); this.k = (this.k + 1) % this.list.length; }
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  dispose() { for (const m of this.list) { m.mesh.removeFromParent(); m.dispose(); } this.list = []; }
}
