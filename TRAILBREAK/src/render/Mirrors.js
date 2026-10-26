// A car's mirrors: the rear-view mirror and the door mirrors show what is behind. On the player's own car each is a flat
// glass whose picture a camera draws: from where the eye looking at it (the camera's, whichever view) would be reflected
// behind the glass, through the glass's own rectangle (an off-axis frustum fitted to it, so the whole picture lands on
// the glass, and its near plane on the glass: nothing behind the mirror shows in it). The pictures are small and drawn
// one mirror a frame in turn (a mirror's view changes slowly), and only for a glass big enough on the screen to show it.
// A glass too small for that (a car seen from farther off), or on low graphics, or on another player's car, is polished
// metal giving back the world's reflections (the sky's, or the probe's round the player's car, render/Probe.js): a
// mirror seen from a few metres off, not a dark pane.
import * as THREE from 'three';

const _e = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), _size = new THREE.Vector2();
/** How tall on the screen (px) a glass must look for its picture to be drawn. */
const PICTURE_PX = 22;
let GLASS = null;
/** The polished glass every mirror shows while it has no picture drawn (shared). */
const glass = () => (GLASS ||= new THREE.MeshStandardMaterial({ color: 0xc4c7ca, metalness: 1, roughness: 0.05, envMapIntensity: 1.1 }));

export class Mirror {
  /** w, h: the glass's size (m); res: its picture's [width, height] in pixels (none: polished glass only); round: a
   * round glass, w across. */
  constructor(w, h, res, round = false) {
    this.w = w; this.h = h;
    this.rt = res ? new THREE.WebGLRenderTarget(res[0], res[1], { type: THREE.HalfFloatType }) : null;
    this.cam = new THREE.PerspectiveCamera();
    // (seen from behind the glass, the camera's left is the glass's right: the picture goes on turned round)
    const g = round ? new THREE.CircleGeometry(w / 2, 28).scale(1, h / w, 1) : new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    this.pic = this.rt ? new THREE.MeshBasicMaterial({ color: 0xd2d4d6, map: this.rt.texture }) : null;
    this.mesh = new THREE.Mesh(g, glass());
    this.mesh.userData.mirror = this;
    this.at = -1;                        // (when its picture was last drawn, in Mirrors' frames; -1 while it shows none)
  }

  /** Show its picture, or the polished glass (the one it had: the probe gives the player's car's a copy of its own). */
  show(pic) {
    const m = this.mesh;
    if (pic && this.pic && m.material !== this.pic) { this.plain = m.material; m.material = this.pic; }
    if (!pic) { this.at = -1; if (m.material === this.pic) m.material = this.plain || glass(); }
  }

  /** How tall the glass looks from a camera on a screen h px high (px): 0 if the camera sees its back, or it is off the
   * screen. */
  seen(camera, h) {
    const W = this.mesh.matrixWorld;
    _c.setFromMatrixPosition(W); _n.setFromMatrixColumn(W, 2).normalize();
    const to = _e.copy(camera.position).sub(_c), d = to.length();
    if (to.dot(_n) <= 0.01 * d || d < 0.05) return 0;
    _x.copy(_c).project(camera);
    const px = Math.max(this.w, this.h) / d / Math.tan(camera.fov * Math.PI / 360) * h / 2, mx = 1 + px / h * 2;
    return _x.z < 1 && Math.abs(_x.x) < mx && Math.abs(_x.y) < mx ? px : 0;
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
    if (!this.rt) return false;
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
    return true;
  }

  dispose() { this.rt?.dispose(); this.mesh.geometry.dispose(); this.pic?.dispose(); }
}

/** A car's mirrors, their pictures drawn in turn: one a frame (every frame on high graphics, every other on medium). */
export class Mirrors {
  constructor(list) { this.list = list; this.k = 0; this.t = 0; this.want = []; }

  /**
   * For a camera (the eye looking at them): the glasses big enough on the screen get their pictures, the rest polished
   * glass. every: draw a picture each `every` frames (0: none, polished glass only); hide: things left out of the
   * pictures while they are drawn (the grass: too small to see in them).
   */
  update(renderer, scene, camera, every = 1, hide = []) {
    if (!this.list.length) return;
    this.t++;
    const h = renderer.getDrawingBufferSize(_size).y, want = this.want;
    want.length = 0;
    for (const m of this.list) {
      if (every > 0 && m.seen(camera, h) >= PICTURE_PX) want.push(m);
      else m.show(false);
    }
    if (!want.length) return;
    // (one come into view with no picture yet is drawn at once, so none shows the glass and then its picture; then one
    // a frame in turn)
    let draw = want.filter((m) => m.at < 0);
    if (!draw.length) draw = this.t % every ? [] : [want[this.k++ % want.length]];
    if (!draw.length) return;
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => { o.visible = false; });
    for (const m of draw) {
      if (m.draw(renderer, scene, camera.position)) { m.at = this.t; m.show(true); } else m.show(false);
    }
    hide.forEach((o, i) => { o.visible = was[i]; });
  }

  dispose() { for (const m of this.list) { m.mesh.removeFromParent(); m.dispose(); } this.list = []; }
}
