// The events on the ground: a start banner at each event's start line (always there: it is where you press J), and for
// the run in progress its gates: on the courses and the races, numbered checkpoint arches (inflatable, striped, the
// next one glowing, the finish chequered); in the trials, a pair of striped marker poles with flags each, the next
// pair lit. An arrow turns over the next one.
import * as THREE from 'three';

const POLE_H = 3.2, ARCH_H = 4.4;

function stripes() {
  const c = document.createElement('canvas'); c.width = 8; c.height = 64;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f2eee4' : '#e8642a'; x.fillRect(0, i * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bands round an arch's tube (along it: u), orange and white, or the finish's chequer. */
function archTexture(chequer) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) {
    if (chequer) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#141414' : '#f2eee4'; x.fillRect(i * 8, j * 8, 8, 8); }
    else { x.fillStyle = i % 2 ? '#f2eee4' : '#e8642a'; x.fillRect(i * 8, 0, 8, 16); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(chequer ? 10 : 6, 1);
  return t;
}

/** The board under an arch's span: its number, or FINISH. */
function boardTexture(big, small) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1f2a24'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#e8893a'; x.fillRect(0, 0, 256, 8); x.fillRect(0, 120, 256, 8);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#f3ead7';
  x.font = '700 22px sans-serif'; x.fillText(small, 128, 30);
  x.font = `800 ${big.length > 3 ? 46 : 64}px sans-serif`; x.fillText(big, 128, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The materials of the checkpoint arches (shared: one set per user). */
export function archMaterials() {
  return {
    arch: new THREE.MeshStandardMaterial({ map: archTexture(false), roughness: 0.45, metalness: 0 }),
    next: new THREE.MeshStandardMaterial({ map: archTexture(false), roughness: 0.45, emissive: 0xff8a1a, emissiveIntensity: 0.9 }),
    finish: new THREE.MeshStandardMaterial({ map: archTexture(true), roughness: 0.5 }),
    finishNext: new THREE.MeshStandardMaterial({ map: archTexture(true), roughness: 0.5, emissive: 0xffd28a, emissiveIntensity: 0.55 }),
  };
}

/**
 * An inflatable arch across (dx, dz) at (x, z) on the ground (`height`): a tube over from one foot to the other and a
 * board under its span (big: its number or FINISH; small: a line above). Returns a group (userData.tube, .finish).
 */
export function makeArch(height, mats, x, z, dx, dz, half, big, small, finish) {
  const g = new THREE.Group(), ax = dz, az = -dx;
  const yL = height(x - ax * half, z - az * half), yR = height(x + ax * half, z + az * half), top = Math.max(yL, yR) + ARCH_H;
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (1 - i / 16), u = Math.cos(a) * half, base = i < 8 ? yL : yR;
    pts.push(new THREE.Vector3(x + ax * u, base - 0.25 + (top - base + 0.25) * Math.pow(Math.sin(a), 0.32), z + az * u));
  }
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.34, 10, false), finish ? mats.finish : mats.arch);
  tube.castShadow = true;
  g.add(tube);
  const board = twoFaced(new THREE.PlaneGeometry(2.3, 1.15), new THREE.MeshStandardMaterial({ map: boardTexture(big, small), roughness: 0.8 }));
  board.children[0].userData.board = true;                            // (the faces share it: freed once)
  board.position.set(x, top - 1.05, z);
  board.rotation.y = Math.atan2(dx, dz) + Math.PI;                    // its face to the trucks coming up to it
  g.add(board);
  g.userData.tube = tube; g.userData.finish = finish;
  return g;
}

/** A sign printed on both faces, reading the right way round from either side: two planes back to back (one plane
 *  drawn on both sides reads backwards from behind). */
function twoFaced(geo, mat) {
  const g = new THREE.Group();
  for (const r of [0, Math.PI]) { const m = new THREE.Mesh(geo, mat); m.rotation.y = r; g.add(m); }
  return g;
}

function bannerTexture(text, chequer = false) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1f2a24'; x.fillRect(0, 0, 1024, 128);
  if (chequer) {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f2eee4'; x.fillRect(i * 32, j * 32, 32, 32); }
  } else {
    x.fillStyle = '#e8893a'; x.fillRect(0, 0, 1024, 10); x.fillRect(0, 118, 1024, 10);
    // (events sharing a start line: their names one above the other)
    const lines = text.split('\n'), size = lines.length > 1 ? 44 : 64;
    x.font = `bold ${size}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#f3ead7';
    lines.forEach((l, i) => x.fillText(l.toUpperCase(), 512, 66 + (i - (lines.length - 1) / 2) * 50, 980));
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
    const am = archMaterials();
    this.archMat = am.arch; this.archNextMat = am.next; this.archFinishMat = am.finish; this.archFinishNextMat = am.finishNext;
    this.archMats = am;
    // the start banners
    this.starts = new THREE.Group();
    this.addStarts(events);
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

  /** Start banners for events (more of them in the open world as its maps come in): one banner for events starting
   *  at the same line, with all their names. */
  addStarts(events) {
    this.startAt ??= [];
    for (const e of events) {
      const s = e.start, same = this.startAt.find((b) => Math.hypot(b.x - s.x, b.z - s.z) < 4 && Math.cos(b.yaw - s.yaw) > 0.9);
      if (same) {
        this.starts.remove(same.g);
        same.g.traverse((o) => { o.geometry?.dispose(); if (o.material?.map) { o.material.map.dispose(); o.material.dispose(); } });
        same.names.push(e.name);
      }
      const b = same || { x: s.x, z: s.z, yaw: s.yaw, names: [e.name] };
      b.g = this.banner(b.x, b.z, b.yaw, 5.2, b.names.join('\n'));
      this.starts.add(b.g);
      if (!same) this.startAt.push(b);
    }
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
    const cloth = twoFaced(new THREE.PlaneGeometry(half * 2, 1.0), new THREE.MeshStandardMaterial({ map: bannerTexture(text, chequer), roughness: 0.9, shadowSide: THREE.DoubleSide }));
    cloth.position.set(x, top - 0.35, z);
    cloth.rotation.y = yaw + Math.PI;                                  // its face to the trucks coming up to it
    cloth.children[0].castShadow = true;
    g.add(cloth);
    return g;
  }

  /** Show an event's gates (from gate `next` on), or nothing (event null). */
  setActive(event, next = 0) {
    if (event === this.event && next === this.next) return;
    if (event !== this.event) this.build(event);
    this.event = event; this.next = next;
    // (a circuit's laps go through the same arches: all of them stay, the next one lit)
    const per = this.perLap, k = per ? next % per : next;
    this.gates.children.forEach((g, i) => {
      g.visible = per ? true : i >= next;
      for (const f of g.userData.flags || []) f.material = i === k ? this.nextMat : this.flagMat;
      if (g.userData.tube) g.userData.tube.material = g.userData.finish ? (i === k ? this.archFinishNextMat : this.archFinishMat) : i === k ? this.archNextMat : this.archMat;
    });
    const g = event?.gates[next];
    this.arrow.visible = !!g;
    if (g) this.arrowAt = [g.x, (g.y ?? this.world.terrain(g.x, g.z)) + (this.arches ? ARCH_H + 2.2 : POLE_H + 2.6), g.z];
  }

  build(event) {
    for (const c of [...this.gates.children]) {
      this.gates.remove(c);
      c.traverse((o) => {
        if (o.geometry && o.geometry !== this.poleGeo && o.geometry !== this.flagGeo) o.geometry.dispose();
        if (o.userData.board) { o.material.map.dispose(); o.material.dispose(); }
      });
    }
    this.flags = [];
    this.perLap = 0;
    this.arches = false;
    if (!event) return;
    if (event.kind !== 'slalom') { this.buildArches(event); return; }
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

  /** Checkpoint arches across the course, one at each gate (a circuit: one lap's worth). */
  buildArches(event) {
    this.arches = true;
    const circuit = event.kind === 'circuit' && event.laps > 1;
    const per = circuit ? event.cps + 1 : event.gates.length;
    this.perLap = circuit ? per : 0;
    let px = event.start.x, pz = event.start.z;
    event.gates.slice(0, per).forEach((gate, i) => {
      let dx, dz;
      if (gate.dir) [dx, dz] = gate.dir; else { dx = gate.x - px; dz = gate.z - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
      px = gate.x; pz = gate.z;
      const finish = i === per - 1;
      const half = Math.max(3.6, Math.min(gate.dir ? 6 : gate.r - 1.5, 6.5));
      const big = finish ? 'FINISH' : String(gate.cp ?? i + 1), small = finish ? (circuit ? 'START · FINISH' : '') : 'CHECKPOINT';
      this.gates.add(this.arch(gate.x, gate.z, dx, dz, half, big, small, finish));
    });
  }

  /** An inflatable arch across (dx, dz) at (x, z) (makeArch). */
  arch(x, z, dx, dz, half, big, small, finish) {
    return makeArch((px, pz) => this.world.height(px, pz), this.archMats, x, z, dx, dz, half, big, small, finish);
  }

  update(dt) {
    this.t += dt;
    this.archNextMat.emissiveIntensity = 0.7 + 0.5 * Math.sin(this.t * 5);
    this.archFinishNextMat.emissiveIntensity = 0.35 + 0.3 * Math.sin(this.t * 5);
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
