// The map builder's props in the world (game/Props.js): plank ramps and kickers, a mound of dirt, shipping
// containers, crates, logs and log piles, rocks, barrels, tyre stacks, concrete barriers, fences, mud pits, and the
// start line and checkpoints as the races' arches. Each stands where World.setProps settled it (y0), its skirt reaching
// down so it never floats where the ground falls away under it. In the builder: a see-through ghost of what is being
// put down, and the picked one lit.
import * as THREE from 'three';
import { PROP_TYPES } from '../game/Props.js';
import { makeArch, archMaterials } from './EventCourse.js';

const SKIRT = 1.6;

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4;
  return t;
}
const rnd = (s) => { const x = Math.sin(s * 127.1) * 43758.5453; return x - Math.floor(x); };

/** The textures, made once: planks, corrugated steel, bark, crate, concrete, wet mud. */
function textures() {
  const planks = canvasTex(256, 256, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      const y = i * 32, k = 0.85 + rnd(i) * 0.3;
      g.fillStyle = `rgb(${Math.round(150 * k)},${Math.round(112 * k)},${Math.round(72 * k)})`; g.fillRect(0, y, w, 32);
      for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(60,38,20,${0.08 + rnd(i * 50 + n) * 0.12})`; g.fillRect(rnd(n + i * 7) * w, y + rnd(n * 3 + i) * 30, 30 + rnd(n) * 90, 1.5); }
      g.fillStyle = 'rgba(30,18,8,0.8)'; g.fillRect(0, y, w, 2.5);
    }
  }, [1, 2]);
  const steel = (base) => canvasTex(128, 128, (g, w, h) => {
    for (let x = 0; x < w; x += 8) { g.fillStyle = base; g.fillRect(x, 0, 8, h); g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x + 5, 0, 3, h); }
    for (let n = 0; n < 60; n++) { g.fillStyle = `rgba(90,50,20,${rnd(n) * 0.25})`; g.fillRect(rnd(n * 3) * w, rnd(n * 5) * h, 3 + rnd(n) * 10, 2 + rnd(n * 2) * 14); }
  }, [6, 1]);
  const bark = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#5a3d27'; g.fillRect(0, 0, w, h);
    for (let n = 0; n < 160; n++) { g.fillStyle = `rgba(${rnd(n) > 0.5 ? '25,15,8' : '120,90,60'},${0.2 + rnd(n * 9) * 0.3})`; g.fillRect(rnd(n * 2) * w, 0, 1 + rnd(n * 4) * 3, h); }
  }, [3, 1]);
  const crate = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a88a5c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#6e5634'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.beginPath(); g.moveTo(8, 8); g.lineTo(w - 8, h - 8); g.stroke();
  });
  const concrete = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#bdb8ad'; g.fillRect(0, 0, w, h);
    for (let n = 0; n < 400; n++) { g.fillStyle = `rgba(${rnd(n) > 0.5 ? '255,255,255' : '60,60,55'},${rnd(n * 3) * 0.12})`; g.fillRect(rnd(n * 5) * w, rnd(n * 7) * h, 2, 2); }
    g.fillStyle = '#c8452f'; g.fillRect(0, 10, w, 10); g.fillStyle = '#f2eee4'; for (let x = 0; x < w; x += 32) g.fillRect(x, 10, 16, 10);
  });
  const mud = canvasTex(256, 256, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(46,32,20,0.98)'); r.addColorStop(0.72, 'rgba(56,40,26,0.92)'); r.addColorStop(1, 'rgba(70,52,34,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
    for (let n = 0; n < 90; n++) { const x = w / 2 + (rnd(n) - 0.5) * w * 0.7, y = h / 2 + (rnd(n * 3) - 0.5) * h * 0.7; g.fillStyle = `rgba(${rnd(n * 7) > 0.6 ? '150,140,120' : '20,12,6'},${0.1 + rnd(n * 2) * 0.2})`; g.beginPath(); g.ellipse(x, y, 3 + rnd(n * 5) * 14, 2 + rnd(n * 6) * 6, rnd(n) * 3, 0, 6.3); g.fill(); }
  });
  return { planks, steel: [steel('#a63a26'), steel('#2a5d8f'), steel('#3f6b3a'), steel('#c58a23')], bark, crate, concrete, mud };
}

/** A shape's side profile (along its length v, height y) extruded across its width (u): wedges, kickers, barriers. */
function extruded(profile, width) {
  const s = new THREE.Shape(profile.map(([v, y]) => new THREE.Vector2(v, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  // shape (x: v, y: y), extruded along +z: turn it so v runs along +z and the width along x, centred
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

export class PropView {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tex = textures();
    const M = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
    this.mat = {
      planks: M({ map: this.tex.planks }), wood: M({ color: 0x6e5236 }), dirt: M({ color: 0x6f5236, roughness: 1 }),
      steel: this.tex.steel.map((map) => M({ map, roughness: 0.6, metalness: 0.3 })), crate: M({ map: this.tex.crate }), bark: M({ map: this.tex.bark }),
      end: M({ color: 0xb08a5a }), rock: M({ color: 0x7d7a72, flatShading: true, roughness: 0.95 }), barrel: [M({ color: 0x2f6fa8, metalness: 0.4, roughness: 0.5 }), M({ color: 0xb8352a, metalness: 0.4, roughness: 0.5 })],
      tyre: M({ color: 0x1c1c1c, roughness: 0.9 }), concrete: M({ map: this.tex.concrete }),
      mud: new THREE.MeshStandardMaterial({ map: this.tex.mud, transparent: true, roughness: 0.25, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    this.arches = archMaterials();
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x3fb6ff, transparent: true, opacity: 0.4, depthWrite: false });
    this.ghostMesh = null; this.ghostType = null;
    this.meshes = [];
    this.markersOn = true;
  }

  /** Rebuild every prop's mesh (props: World.props, settled). */
  set(props) {
    for (const m of this.meshes) { this.group.remove(m); dispose(m); }
    this.meshes = [];
    let cp = 0;
    const cps = props.filter((p) => p.type === 'checkpoint').length;
    props.forEach((p, i) => {
      const n = p.type === 'checkpoint' ? ++cp : 0;
      const m = this.make(p, i, n, n === cps);
      m.userData.index = i;
      this.meshes.push(m);
      this.group.add(m);
    });
    this.setMarkersVisible(this.markersOn);
  }

  /** One prop's mesh, in place. */
  make(p, i, cpNo = 0, last = false) {
    const T = PROP_TYPES[p.type], W = this.world, y0 = p.y0 ?? W.terrain(p.x, p.z);
    if (T.shape === 'marker') {
      const dx = Math.sin(p.yaw), dz = Math.cos(p.yaw);
      const g = p.type === 'start'
        ? makeArch((x, z) => W.height(x, z), this.arches, p.x, p.z, dx, dz, T.hx, 'START', '', true)
        : makeArch((x, z) => W.height(x, z), this.arches, p.x, p.z, dx, dz, T.hx, last ? 'FINISH' : String(cpNo), last ? '' : 'CHECKPOINT', last);
      g.userData.marker = true;
      return g;
    }
    if (T.shape === 'paint') return this.mudPatch(p, T);
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
    switch (p.type) {
      case 'ramp': case 'bigramp':
        add(extruded([[-T.hz, 0], [T.hz, T.h], [T.hz, -SKIRT], [-T.hz, -SKIRT]], T.hx * 2), this.mat.planks);
        break;
      case 'kicker': {
        const prof = [];
        for (let k = 0; k <= 12; k++) { const t = k / 12; prof.push([-T.hz + 2 * T.hz * t, T.h * Math.pow(t, 1.7)]); }
        prof.push([T.hz, -SKIRT], [-T.hz, -SKIRT]);
        add(extruded(prof, T.hx * 2), this.mat.planks);
        break;
      }
      case 'logpile': {
        // three, two and one logs stacked along the pile, lying across its width
        const r = 0.28, geo = new THREE.CylinderGeometry(r, r, T.hx * 2, 12).rotateZ(Math.PI / 2);
        [[-0.56, 0], [0, 0], [0.56, 0], [-0.28, 1], [0.28, 1], [0, 2]].forEach(([v, row]) => add(geo, this.mat.bark, 0, r + row * 0.485, v));
        break;
      }
      case 'dirtmound': case 'rock': case 'bigrock': {
        const geo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        if (p.type !== 'dirtmound') {
          const P = geo.attributes.position;
          for (let k = 0; k < P.count; k++) { const s = 0.82 + 0.3 * rnd(k * 3.7 + i); P.setXYZ(k, P.getX(k) * s, P.getY(k) * (0.85 + 0.25 * rnd(k + i)), P.getZ(k) * s); }
          geo.computeVertexNormals();
        }
        const m = add(geo, p.type === 'dirtmound' ? this.mat.dirt : this.mat.rock);
        m.scale.set(T.rx, T.ry, T.rz);
        if (p.type === 'dirtmound') m.position.y = -0.15;
        break;
      }
      case 'container': add(new THREE.BoxGeometry(T.hx * 2, T.h + SKIRT, T.hz * 2).translate(0, (T.h - SKIRT) / 2, 0), this.mat.steel[Math.floor(rnd(p.x * 0.37 + p.z) * 4)]); break;
      case 'crate': add(new THREE.BoxGeometry(T.hx * 2, T.h + SKIRT, T.hz * 2).translate(0, (T.h - SKIRT) / 2, 0), this.mat.crate); break;
      case 'log': {
        add(new THREE.CylinderGeometry(T.r, T.r * 1.05, T.hx * 2, 14).rotateZ(Math.PI / 2), this.mat.bark, 0, T.r, 0);
        break;
      }
      case 'barrel': add(new THREE.CylinderGeometry(T.r, T.r, T.h + SKIRT * 0.3, 16).translate(0, (T.h - SKIRT * 0.3) / 2, 0), this.mat.barrel[Math.floor(rnd(p.x + p.z * 0.71) * 2)]); break;
      case 'tyres': {
        const geo = new THREE.TorusGeometry(T.r - 0.16, 0.16, 8, 18).rotateX(Math.PI / 2);
        for (let k = 0; k < 3; k++) add(geo, this.mat.tyre, 0, 0.16 + k * 0.3, 0);
        break;
      }
      case 'barrier': add(extruded([[-T.hz, -SKIRT * 0.4], [T.hz, -SKIRT * 0.4], [T.hz * 0.95, 0.12], [T.hz * 0.4, 0.3], [T.hz * 0.3, T.h], [-T.hz * 0.3, T.h], [-T.hz * 0.4, 0.3], [-T.hz * 0.95, 0.12]], T.hx * 2), this.mat.concrete); break;
      case 'fence': {
        const post = new THREE.BoxGeometry(0.12, T.h + 0.5, 0.12).translate(0, (T.h - 0.5) / 2, 0);
        for (const u of [-T.hx, 0, T.hx]) add(post, this.mat.wood, u, 0, 0);
        const rail = new THREE.BoxGeometry(T.hx * 2, 0.1, 0.05);
        add(rail, this.mat.wood, 0, T.h * 0.45, 0); add(rail, this.mat.wood, 0, T.h * 0.9, 0);
        break;
      }
      default: break;
    }
    g.position.set(p.x, y0, p.z);
    g.rotation.y = p.yaw;
    return g;
  }

  /** A mud pit: a wet patch lying on the ground (in the world's frame: it follows the ground's rises and falls). */
  mudPatch(p, T) {
    const rings = 8, segs = 28, pos = [], uv = [], idx = [];
    for (let r = 0; r <= rings; r++) {
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2, d = (r / rings) * T.r, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        pos.push(x, this.world.terrain(x, z) + 0.05, z);
        uv.push(0.5 + Math.cos(a) * d / T.r / 2, 0.5 + Math.sin(a) * d / T.r / 2);
      }
    }
    for (let r = 0; r < rings; r++) for (let k = 0; k < segs; k++) { const a = r * (segs + 1) + k, b = a + segs + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.mat.mud);
    m.receiveShadow = true;
    m.renderOrder = 1;
    return m;
  }

  /** The see-through preview of a prop about to be put down (type null: none). */
  ghost(type, x, z, yaw) {
    if (!type) { if (this.ghostMesh) this.ghostMesh.visible = false; return; }
    if (type !== this.ghostType) {
      if (this.ghostMesh) { this.scene.remove(this.ghostMesh); dispose(this.ghostMesh); }
      const p = { type, x: 0, z: 0, yaw: 0, y0: 0 };
      this.ghostMesh = PROP_TYPES[type].shape === 'marker' || PROP_TYPES[type].shape === 'paint' ? this.markerGhost(type) : this.make(p, 0);
      this.ghostMesh.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
      this.ghostMesh.position.set(0, 0, 0);
      this.scene.add(this.ghostMesh);
      this.ghostType = type;
    }
    const T = PROP_TYPES[type];
    this.ghostMesh.visible = true;
    this.ghostMesh.position.set(x, this.world.height(x, z) + (T.shape === 'paint' ? 0.06 : 0), z);
    this.ghostMesh.rotation.y = yaw;
  }

  /** A flat outline for the things that are drawn on the ground or across it: an arch's footprint, a pit's disc. */
  markerGhost(type) {
    const T = PROP_TYPES[type];
    if (T.shape === 'paint') return new THREE.Mesh(new THREE.CircleGeometry(T.r, 32).rotateX(-Math.PI / 2), this.ghostMat);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(T.hx * 2, 4.4, 0.5).translate(0, 2.2, 0), this.ghostMat));
    g.add(new THREE.Mesh(new THREE.ConeGeometry(0.8, 2, 4).rotateX(Math.PI / 2).translate(0, 0.5, 2), this.ghostMat));
    return g;
  }

  /** Light up the picked prop (index, or -1). */
  select(index) {
    this.meshes.forEach((m, i) => m.traverse((o) => {
      if (!o.isMesh || !o.material?.emissive) return;
      if (i === index) { o.userData.was ??= o.material; o.material = o.userData.was.clone(); o.material.emissive.set(0x1f6fa0); o.material.emissiveIntensity = 0.7; }
      else if (o.userData.was) { o.material.dispose(); o.material = o.userData.was; delete o.userData.was; }
    }));
  }

  /** The start line and checkpoints (off while their race is run: the race's own arches show then). */
  setMarkersVisible(on) {
    this.markersOn = on;
    for (const m of this.meshes) if (m.userData.marker) m.visible = on;
  }
}

function dispose(o) {
  o.traverse((m) => { if (m.isMesh) { m.geometry?.dispose(); if (m.userData.board || m.material?.userData?.own) m.material.dispose(); } });
}
