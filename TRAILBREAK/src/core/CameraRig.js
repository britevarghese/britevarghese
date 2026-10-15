// Camera: chase (near / far), bonnet and driver's seat views. Drag the mouse (or the right stick) to look around;
// the chase view drifts back behind the truck when you stop. The camera keeps above the ground.
import * as THREE from 'three';

const MODES = ['chase', 'far', 'hood', 'cab'];

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.mode = 'chase';
    this.yaw = 0;          // orbit offset around the truck
    this.pitch = 0.18;
    this.heading = null;   // smoothed truck heading for the chase view
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.shake = 0;
  }

  next() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.yaw = 0;
    return this.mode;
  }

  update(dt, truck, controls) {
    const cam = this.camera;
    const p = truck.root.position, q = truck.root.quaternion;
    const fwd = this._f.set(0, 0, 1).applyQuaternion(q);
    const yawTruck = Math.atan2(fwd.x, fwd.z);
    if (this.heading === null) this.heading = yawTruck;
    // the chase view turns with the truck's heading, lagging a little (and not at all when it's upside down)
    let dh = yawTruck - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * (1 - Math.exp(-dt * 3.2));
    // look around
    if (controls) {
      this.yaw -= controls.lookX * 1.0;
      this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch + controls.lookY * 0.8));
      if (!controls.looking) {
        this.yaw *= Math.exp(-dt * 1.4);
        this.pitch += (0.18 - this.pitch) * (1 - Math.exp(-dt * 0.8));
      }
    }
    if (this.mode === 'chase' || this.mode === 'far') {
      const dist = this.mode === 'chase' ? 7.6 : 13;
      const h = this.mode === 'chase' ? 1.2 : 2.2;
      const a = this.heading + Math.PI + this.yaw;
      const pitch = this.pitch + (this.mode === 'far' ? 0.08 : 0);
      const target = this.look.set(p.x, p.y + h, p.z);
      const want = this._v.set(p.x + Math.sin(a) * Math.cos(pitch) * dist, p.y + h + Math.sin(pitch) * dist, p.z + Math.cos(a) * Math.cos(pitch) * dist);
      // keep above the ground (and look over a ridge rather than through it)
      const g = this.world.height(want.x, want.z);
      if (want.y < g + 0.9) want.y = g + 0.9;
      const k = 1 - Math.exp(-dt * 10);
      if (this.pos.distanceToSquared(want) > 400) this.pos.copy(want); else this.pos.lerp(want, k);
      cam.position.copy(this.pos);
      cam.lookAt(target);
      cam.fov = 62;
    } else {
      // seat positions in the truck's frame
      const spec = truck.spec;
      const e = (this.mode === 'hood' ? spec.hoodEye : spec.eye) || [0.36, 1.6, 0];
      const eye = this._v.set(e[0], e[1] + (spec.raise || 0) - spec.cgHeight, e[2] - (spec.cgZ || 0));
      eye.applyQuaternion(q).add(p);
      cam.position.copy(eye);
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.PI + this.yaw);
      cam.quaternion.copy(q).multiply(this._q);
      // a little pitch from looking
      this._q.setFromAxisAngle(this._v.set(1, 0, 0), -(this.pitch - 0.18) * 0.8);
      cam.quaternion.multiply(this._q);
      cam.fov = this.mode === 'cab' ? 70 : 64;
      this.pos.copy(cam.position);
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 10);
      if (this.shake < 1e-3) this.shake = 0;
    }
    cam.updateProjectionMatrix();
  }
}
