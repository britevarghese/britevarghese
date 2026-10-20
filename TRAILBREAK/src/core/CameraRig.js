// Camera: chase (near / far), bonnet and driver's seat views, and cameras fixed to the body as a film crew would rig
// them: in the driver's door mirror looking back along the side, low beside a front wheel looking along the tyre and
// its suspension at work, and on the front bumper. Drag the mouse (or the right stick) to look around; the chase view
// drifts back behind the truck when you stop. The camera keeps above the ground.
import * as THREE from 'three';

const MODES = ['chase', 'far', 'hood', 'cab', 'mirror', 'wheel', 'bumper'];
const LABELS = { chase: 'chase', far: 'far', hood: 'bonnet', cab: "driver's seat", mirror: 'side mirror', wheel: 'wheel', bumper: 'bumper' };

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
    this.jitter = 0;
  }

  /** A trunk on the line from the truck out to the camera (or at the camera): the camera comes in, in front of it, as
   *  a camera crew would stand, rather than looking from inside a tree. */
  clearTrees(target, want) {
    const dx = want.x - target.x, dz = want.z - target.z, L = Math.hypot(dx, dz);
    if (L < 3.5 || !this.world.treesNear) return;
    const trees = this.world.treesNear((target.x + want.x) / 2, (target.z + want.z) / 2, L / 2 + 1.5, this.tmpTrees || (this.tmpTrees = []));
    let s = 1;
    for (const t of trees) {
      const px = t.x - target.x, pz = t.z - target.z;
      const along = (px * dx + pz * dz) / L, off = Math.abs(px * dz - pz * dx) / L, clear = t.r + 0.55;
      if (along < 2.5 || along > L + clear || off > clear) continue;          // (the trees the truck itself is against)
      if (target.y + (want.y - target.y) * Math.min(1, along / L) > t.y + 7) continue;   // (over the low trees)
      s = Math.min(s, (along - Math.sqrt(clear * clear - off * off) - 0.3) / L);
    }
    if (s < 1) {
      s = Math.max(3.2 / L, s);
      want.set(target.x + dx * s, target.y + (want.y - target.y) * s, target.z + dz * s);
    }
  }

  next() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.yaw = 0;
    this.camera.userData.cut = true;       // (a cut to another view: the motion blur takes it for no motion)
    return LABELS[this.mode];
  }

  /** Where a body-mounted camera sits, in the truck's frame (m: x left, height above the ground at rest, z forward),
   *  which way it looks (rad about the vertical, 0 ahead) and its field of view. */
  mount(spec) {
    const e = spec.eye || [0.36, 1.6, 0], side = Math.sign(e[0]) || 1, a = spec.axles[0], r = spec.tyre.radius;
    const half = Math.max(a.track / 2 + spec.tyre.width / 2, spec.hull?.[0] ? spec.hull[0].h[0] : 0);
    const raise = spec.raise || 0;
    switch (this.mode) {
      case 'hood': { const h = spec.hoodEye || e; return [h[0], h[1] + raise, h[2], 0, 64]; }
      // (the mirror ahead of the driver, out past the door, looking back past the flank and the rear wheel)
      case 'mirror': return [side * (half + 0.12), e[1] + raise - 0.12, e[2] + 0.55, Math.PI - side * 0.1, 52];
      // (out past the driver's front wheel at hub height, behind it, looking forward along the tyre)
      case 'wheel': return [side * (half + 0.3), r + 0.08, a.z - 1.05, side * 0.2, 75];
      case 'bumper': return [0, Math.min(0.75, r + 0.25), (spec.noseZ ?? a.z + 0.9) + 0.12, 0, 72];
      default: return [e[0], e[1] + raise, e[2], 0, 70];
    }
  }

  update(dt, truck, controls) {
    const cam = this.camera;
    const p = truck.root.position, q = truck.root.quaternion;
    const fwd = this._f.set(0, 0, 1).applyQuaternion(q);
    const yawTruck = Math.atan2(fwd.x, fwd.z);
    if (this.heading === null) this.heading = yawTruck;
    // the chase view turns with the truck's heading, lagging a little (and not at all when it's upside down); less at
    // speed, where trailing round a fast bend would show the truck's side as if it were sliding
    let dh = yawTruck - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const moved = this.lastP ? Math.hypot(p.x - this.lastP.x, p.z - this.lastP.z) / Math.max(dt, 1e-3) : 0;
    (this.lastP ||= new THREE.Vector3()).copy(p);
    this.speedLP = (this.speedLP || 0) + (Math.min(moved, 80) - (this.speedLP || 0)) * Math.min(1, dt * 2);
    const follow = 3.2 + 3.3 * THREE.MathUtils.smoothstep(this.speedLP, 8, 28);
    this.heading += dh * (1 - Math.exp(-dt * follow));
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
      // out of the trees (a trunk between the truck and the camera brings it in, in front of the trunk), and above the
      // ground (looking over a ridge rather than through it)
      this.clearTrees(target, want);
      const g = this.world.height(want.x, want.z);
      if (want.y < g + 0.9) want.y = g + 0.9;
      const k = 1 - Math.exp(-dt * 10);
      if (this.pos.distanceToSquared(want) > 400) this.pos.copy(want); else this.pos.lerp(want, k);
      cam.position.copy(this.pos);
      cam.lookAt(target);
      cam.fov = 62;
    } else {
      // seats and mounts in the truck's frame (heights above the ground at rest: the frame's origin is the centre of
      // gravity), moving with the body: over bumps the wheels and the ground move in the picture, not the truck
      const spec = truck.spec;
      const [x, h, z, look, fov] = this.mount(spec);
      const eye = this._v.set(x, h - spec.cgHeight, z - (spec.cgZ || 0));
      eye.applyQuaternion(q).add(p);
      cam.position.copy(eye);
      this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.PI + look + this.yaw);
      cam.quaternion.copy(q).multiply(this._q);
      // a little pitch from looking
      this._q.setFromAxisAngle(this._v.set(1, 0, 0), -(this.pitch - 0.18) * 0.8);
      cam.quaternion.multiply(this._q);
      cam.fov = fov;
      this.pos.copy(cam.position);
    }
    if (this.jitter > 0) {
      // the ground's tremble: a few fast incommensurate wobbles
      const t = performance.now() / 1000, j = this.jitter;
      cam.position.x += (Math.sin(t * 71.0) * 0.5 + Math.sin(t * 113.0) * 0.3 + Math.sin(t * 37.0) * 0.2) * j;
      cam.position.y += (Math.sin(t * 83.0) * 0.5 + Math.sin(t * 131.0) * 0.3 + Math.sin(t * 29.0) * 0.2) * j;
      cam.position.z += Math.sin(t * 97.0) * 0.4 * j;
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
