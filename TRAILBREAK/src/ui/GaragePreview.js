// The garage's 3D view: one truck on a concrete floor under workshop lights, in its own small renderer. Drag to turn
// it around (or it turns slowly on its own). Renders only when something changed.
import * as THREE from 'three';
import { TruckModel } from '../render/TruckModel.js';

/** A soft studio environment for reflections: a grey room with a few bright panels, prefiltered. */
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x5b5d5a, side: THREE.BackSide }));
  room.position.y = 4;
  scene.add(room);
  const panel = (w, h, x, y, z, ry, rx, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 0.96) }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  panel(8, 2, 0, 8.9, 0, 0, Math.PI / 2, 6);
  panel(4, 3, -9.9, 4, 2, Math.PI / 2, 0, 3);
  panel(4, 3, 9.9, 4, -3, -Math.PI / 2, 0, 2.2);
  panel(10, 1.2, 0, 2, -9.9, 0, 0, 1.6);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(scene, 0.04).texture;
  pm.dispose();
  scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}

export class GaragePreview {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x161a1f);
    s.environment = studioEnvironment(r);
    s.environmentIntensity = 0.35;
    s.fog = new THREE.Fog(0x161a1f, 13, 28);
    s.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a3226, 0.9));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 1, far: 30 });
    sun.shadow.bias = -0.0005;
    s.add(sun);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.9);
    rim.position.set(-6, 4, -7);
    s.add(rim);
    // floor: stained concrete with painted bay lines
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), new THREE.MeshStandardMaterial({ color: 0x5a5852, roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    for (const x of [-1.6, 1.6]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 7), new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.8 }));
      l.rotation.x = -Math.PI / 2; l.position.set(x, 0.002, 0);
      s.add(l);
    }
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
    this.yaw = 0.75; this.pitch = 0.16; this.dist = 8.5; this.spin = true;
    this.model = null;
    this.dirty = true;
    // drag to turn, wheel to zoom
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; this.spin = false; canvas.setPointerCapture?.(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw -= (e.clientX - drag[0]) * 0.008;
      this.pitch = Math.max(-0.02, Math.min(0.9, this.pitch + (e.clientY - drag[1]) * 0.005));
      drag = [e.clientX, e.clientY];
      this.dirty = true;
    });
    const up = () => { drag = null; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { this.fitR = 0; this.dist = Math.max(4.5, Math.min(14, this.dist * (e.deltaY > 0 ? 1.08 : 0.93))); this.dirty = true; e.preventDefault(); }, { passive: false });
  }

  /** Show a truck (physics spec with a build) in a paint colour. */
  show(spec, paint) {
    let m;
    try { m = new TruckModel(spec, paint); } catch (e) { console.error('garage model:', e); return; }   // (keep the last one)
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = m;
    if (m.driver) m.driver.group.visible = this.showDriver === true;       // (an empty seat in the garage)
    this.scene.add(m.root);
    m.root.position.set(0, spec.cgHeight, spec.cgZ || 0);
    m.updateWheels(spec.axles.flatMap((a, i) => [[a.sag, 0.3, i === 0 ? 0.28 : 0], [a.sag, 0.3, i === 0 ? 0.28 : 0]]));
    m.setLights(true);
    this.focusY = 0.25 + spec.cgHeight * 0.6;
    this.dist = Math.max(this.dist, 2.2 * (spec.hull[0].h[2] + 0.2) + 1.5);
    this.dirty = true;
  }

  /** Frame the whole truck, whatever the shape of the view: its bounding sphere in the narrower field of view. */
  fit() {
    const box = new THREE.Box3().setFromObject(this.model.root);
    this.fitR = box.getSize(new THREE.Vector3()).length() / 2;
    this.focusY = box.getCenter(new THREE.Vector3()).y;
    this.dirty = true;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
  }

  /** Call every animation frame while the garage is open. */
  frame(dt) {
    this.resize();
    if (this.spin) { this.yaw += dt * 0.25; this.dirty = true; }
    if (!this.dirty || !this.model) return;
    this.dirty = false;
    if (this.fitR) {
      const v = THREE.MathUtils.degToRad(this.camera.fov), h = 2 * Math.atan(Math.tan(v / 2) * this.camera.aspect);
      this.dist = this.fitR / Math.sin(Math.min(v, h) / 2) * 0.7;
    }
    const c = this.camera, y = this.focusY || 0.8;
    c.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist, y + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist);
    c.lookAt(0, y, 0);
    this.renderer.render(this.scene, c);
  }

  dispose() {
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); this.model = null; }
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
