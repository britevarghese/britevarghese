// The events on the ground: a start banner at each event's start line (always there: it is where you press J), and for
// the run in progress its gates, a pair of striped marker poles with flags each, the next pair lit and an arrow over it.
import * as THREE from 'three';

const POLE_H = 3.2;

function stripes() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 64;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f2eee4' : '#e8642a'; x.fillRect(0, i * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTexture(text, chequer = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1f2a24'; x.fillRect(0, 0, 1024, 128);
  if (chequer) {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f2eee4'; x.fillRect(i * 32, j * 32, 32, 32); }
  } else {
    x.fillStyle = '#e8893a'; x.fillRect(0, 0, 1024, 10); x.fillRect(0, 118, 1024, 10);
    x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#f3ead7'; x.fillText(text.toUpperCase(), 512, 66);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class EventCourse {
  constructor(scene, world, events) {
    this.scene = scene;
    this.world = world;
    this.t = 0;
    this.poleMat = new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.6 });
    this.poleGeo = new THREE.CylinderGeometry(0.06, 0.07, POLE_H, 8).translate(0, POLE_H / 2, 0);
    this.flagGeo = new THREE.PlaneGeometry(0.9, 0.55, 6, 2).translate(0.45, 0, 0);
    this.flagMat = new THREE.MeshStandardMaterial({ color: 0xe8642a, emissive: 0x000000, side: THREE.DoubleSide, roughness: 0.8 });
    this.nextMat = new THREE.MeshStandardMaterial({ color: 0xffb340, emissive: 0xff8a1a, emissiveIntensity: 1.6, side: THREE.DoubleSide, roughness: 0.6 });
    this.postMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    // the start banners
    this.starts = new THREE.Group();
    for (const e of events) this.starts.add(this.banner(e.start.x, e.start.z, e.start.yaw, 5.2, e.name));
    scene.add(this.starts);
    // the active course
    this.gates = new THREE.Group();
    scene.add(this.gates);
    this.flags = [];
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.5, 4).rotateX(Math.PI), this.nextMat);
    this.arrow.visible = false;
    scene.add(this.arrow);
    this.event = null; this.next = -1;
  }

  /** Two posts and a banner across a line at (x, z), facing along yaw. */
  banner(x, z, yaw, half, text, chequer = false) {
    const g = new THREE.Group(), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const yL = this.world.terrain(x - rx * half, z - rz * half), yR = this.world.terrain(x + rx * half, z + rz * half), top = Math.max(yL, yR) + 3.6;
    for (const [s, y0] of [[-1, yL], [1, yR]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, top - y0 + 0.4, 8), this.postMat);
      post.position.set(x + rx * half * s, (top + y0 - 0.4) / 2 + 0.2, z + rz * half * s);
      post.castShadow = true;
      g.add(post);
    }
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.0), new THREE.MeshStandardMaterial({ map: bannerTexture(text, chequer), side: THREE.DoubleSide, roughness: 0.9 }));
    cloth.position.set(x, top - 0.35, z);
    cloth.rotation.y = yaw + Math.PI;                                  // its face to the trucks coming up to it
    cloth.castShadow = true;
    g.add(cloth);
    return g;
  }

  /** Show an event's gates (from gate `next` on), or nothing (event null). */
  setActive(event, next = 0) {
    if (event === this.event && next === this.next) return;
    if (event !== this.event) this.build(event);
    this.event = event; this.next = next;
    this.gates.children.forEach((g, i) => {
      g.visible = i >= next;
      for (const f of g.userData.flags || []) f.material = i === next ? this.nextMat : this.flagMat;
    });
    const g = event?.gates[next];
    this.arrow.visible = !!g;
    if (g) this.arrowAt = [g.x, (g.y ?? this.world.terrain(g.x, g.z)) + POLE_H + 2.6, g.z];
  }

  build(event) {
    for (const c of [...this.gates.children]) { this.gates.remove(c); c.traverse((o) => { if (o.geometry && o.geometry !== this.poleGeo && o.geometry !== this.flagGeo) o.geometry.dispose(); }); }
    this.flags = [];
    if (!event) return;
    let px = event.start.x, pz = event.start.z;
    event.gates.forEach((gate, i) => {
      // across the course at this gate: its line, or square to the way from the last one
      let dx, dz;
      if (gate.dir) [dx, dz] = gate.dir; else { dx = gate.x - px; dz = gate.z - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      px = gate.x; pz = gate.z;
      const half = gate.dir ? Math.min(gate.r, 12) : Math.min(gate.r - 1, 6), ax = dz, az = -dx;
      const last = i === event.gates.length - 1;
      const grp = new THREE.Group();
      if (last) grp.add(this.banner(gate.x, gate.z, Math.atan2(dx, dz), half, '', true));
      grp.userData.flags = [];
      for (const s of [-1, 1]) {
        const x = gate.x + ax * half * s, z = gate.z + az * half * s, y = this.world.terrain(x, z);
        const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
        pole.position.set(x, y, z);
        pole.castShadow = true;
        const flag = new THREE.Mesh(this.flagGeo.clone(), this.flagMat);
        flag.position.set(x, y + POLE_H - 0.35, z);
        flag.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
        flag.userData.base = flag.geometry.attributes.position.array.slice();
        grp.add(pole, flag);
        grp.userData.flags.push(flag);
        this.flags.push(flag);
      }
      this.gates.add(grp);
    });
  }

  update(dt) {
    this.t += dt;
    for (const f of this.flags) {
      if (!f.parent?.visible) continue;
      const p = f.geometry.attributes.position, base = f.userData.base;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3]; p.array[i * 3 + 2] = Math.sin(x * 4 - this.t * 6) * 0.08 * x; }
      p.needsUpdate = true;
    }
    if (this.arrow.visible && this.arrowAt) {
      const [x, y, z] = this.arrowAt;
      this.arrow.position.set(x, y + Math.sin(this.t * 3) * 0.4, z);
      this.arrow.rotation.y = this.t * 1.5;
    }
  }
}
