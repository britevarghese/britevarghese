// Street furniture geometry library + PropSystem that renders every prop type with a few
// global InstancedMeshes (one per type/material part) refilled when the streamed chunk set changes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { markUV, MARK } from '../renderer/Textures.js';
import { rng } from '../core/util.js';

const clean = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; };
const merge = (list) => mergeGeometries(list.map(clean));
const cyl = (rt, rb, h, seg = 8, y = h / 2) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(0, y, 0);

function decalQuad(cell, w, l) {
  const g = new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2);
  const [u0, v0, u1, v1] = markUV(cell);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

function treeCanopy(seed) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.IcosahedronGeometry(1.3 + R() * 0.6, 1);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const s = 0.8 + R() * 0.45; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s * 0.8, p.getZ(k) * s); }
    g.computeVertexNormals();
    const a = (i / 4) * Math.PI * 2;
    g.translate(Math.cos(a) * (i ? 1.1 : 0), 4.3 + (i ? R() * 0.9 : 1.2), Math.sin(a) * (i ? 1.1 : 0));
    parts.push(g);
  }
  // crossed leaf cards for a fuller silhouette
  for (let i = 0; i < 3; i++) parts.push(new THREE.PlaneGeometry(4.2, 3.4).rotateY((i / 3) * Math.PI).translate(0, 4.9, 0));
  return merge(parts);
}

export function buildPropDefs(M) {
  const lampPole = merge([
    cyl(0.07, 0.13, 8.2, 8), cyl(0.2, 0.24, 0.6, 8),
    new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 7.9, 0), new THREE.Vector3(0, 8.6, 1.0), new THREE.Vector3(0, 8.45, 2.3)), 8, 0.055, 6),
    new THREE.BoxGeometry(0.42, 0.16, 0.95).translate(0, 8.42, 2.6),
  ]);
  const lampLens = new THREE.PlaneGeometry(0.34, 0.8).rotateX(Math.PI / 2).translate(0, 8.33, 2.6);
  const hwPole = merge([
    cyl(0.12, 0.2, 12, 8), new THREE.BoxGeometry(11, 0.12, 0.12).translate(0, 11.8, 0),
    new THREE.BoxGeometry(0.5, 0.18, 1.0).translate(5.4, 11.7, 0), new THREE.BoxGeometry(0.5, 0.18, 1.0).translate(-5.4, 11.7, 0),
  ]);
  const hwLens = merge([new THREE.PlaneGeometry(0.42, 0.85).rotateX(Math.PI / 2).translate(5.4, 11.6, 0), new THREE.PlaneGeometry(0.42, 0.85).rotateX(Math.PI / 2).translate(-5.4, 11.6, 0)]);
  // signal: pole + arm along +X (length 6 at scale 1), head hangs at x = 4.5, faces -Z
  const signalPole = merge([cyl(0.1, 0.14, 6.2, 8), new THREE.BoxGeometry(6, 0.14, 0.14).translate(3, 6.0, 0), new THREE.BoxGeometry(0.34, 1.0, 0.3).translate(4.5, 5.4, 0), new THREE.BoxGeometry(0.3, 0.9, 0.26).translate(0.25, 3.2, 0)]);
  const signalLens = new THREE.CircleGeometry(0.1, 10).rotateY(Math.PI); // faces -Z
  const trunk = merge([cyl(0.1, 0.2, 3.6, 7), cyl(0.05, 0.08, 1.4, 5, 3.9).rotateZ(0.5), cyl(0.05, 0.08, 1.4, 5, 3.9).rotateZ(-0.6)]);
  const canopy = treeCanopy(3);
  const meter = merge([cyl(0.04, 0.04, 1.1, 6), new THREE.BoxGeometry(0.22, 0.34, 0.18).translate(0, 1.25, 0)]);
  const bin = merge([cyl(0.28, 0.25, 0.95, 10), cyl(0.3, 0.3, 0.06, 10, 0.97)]);
  const bench = merge([new THREE.BoxGeometry(1.8, 0.06, 0.45).translate(0, 0.45, 0), new THREE.BoxGeometry(1.8, 0.4, 0.05).translate(0, 0.7, -0.22).rotateX(-0.1), new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(-0.8, 0.22, 0), new THREE.BoxGeometry(0.06, 0.45, 0.4).translate(0.8, 0.22, 0)]);
  const hydrant = merge([new THREE.LatheGeometry([[0.001, 0], [0.16, 0], [0.13, 0.08], [0.12, 0.55], [0.14, 0.6], [0.1, 0.72], [0.001, 0.76]].map(([x, y]) => new THREE.Vector2(x, y)), 10), cyl(0.05, 0.05, 0.36, 6, 0.45).rotateZ(Math.PI / 2)]);
  const bollard = merge([cyl(0.09, 0.1, 0.95, 10), cyl(0.11, 0.11, 0.1, 10, 0.75)]);
  const tank = merge([cyl(3, 3, 9, 20), new THREE.SphereGeometry(3, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 9, 0)]);
  const chimney = merge([cyl(0.9, 1.3, 22, 14), cyl(1.05, 1.05, 0.8, 14, 21.5)]);
  const container = new THREE.BoxGeometry(6.06, 2.59, 2.44).translate(0, 1.3, 0);
  // swap so the long side is along X (texture corrugation vertical)
  const cone = merge([new THREE.LatheGeometry([[0.001, 0.03], [0.2, 0.03], [0.2, 0], [0.22, 0], [0.22, 0.04], [0.14, 0.05], [0.03, 0.72], [0.001, 0.73]].map(([x, y]) => new THREE.Vector2(x, y)), 12)]);
  const coneBand = cyl(0.085, 0.105, 0.12, 12, 0.42);
  const jerseyShape = new THREE.Shape([[-0.3, 0], [0.3, 0], [0.26, 0.08], [0.1, 0.32], [0.08, 0.81], [-0.08, 0.81], [-0.1, 0.32], [-0.26, 0.08]].map(([x, y]) => new THREE.Vector2(x, y)));
  const jersey = new THREE.ExtrudeGeometry(jerseyShape, { depth: 4, bevelEnabled: false }).translate(0, 0, -2).rotateY(Math.PI / 2);
  const pillar = new THREE.BoxGeometry(0.9, 5.2, 0.9).translate(0, 2.6, 0);
  const flood = merge([cyl(0.1, 0.16, 9, 8), new THREE.BoxGeometry(1.4, 0.8, 0.2).translate(0, 9, 0.2)]);
  const floodLens = new THREE.PlaneGeometry(1.2, 0.6).translate(0, 9, 0.31);
  const manhole = decalQuad(MARK.MANHOLE, 0.9, 0.9);
  const drain = decalQuad(MARK.DRAIN, 1.0, 0.5);

  const defs = {
    lamp: [{ geo: lampPole, mat: M.darkMetal, shadow: true }, { geo: lampLens, mat: M.lampHead, emissive: true }],
    highwayLamp: [{ geo: hwPole, mat: M.metal, shadow: true }, { geo: hwLens, mat: M.lampHead, emissive: true }],
    signal: [{ geo: signalPole, mat: M.paintedMetal, shadow: true, scaleX: true }],
    tree: [{ geo: trunk, mat: M.bark, shadow: true }, { geo: canopy, mat: M.leaves, shadow: true }],
    meter: [{ geo: meter, mat: M.metal }],
    bin: [{ geo: bin, mat: M.paintedMetal }],
    bench: [{ geo: bench, mat: M.darkMetal }],
    hydrant: [{ geo: hydrant, mat: new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.5, metalness: 0.3 }) }],
    bollard: [{ geo: bollard, mat: M.darkMetal }],
    tank: [{ geo: tank, mat: M.metal, shadow: true }],
    chimney: [{ geo: chimney, mat: M.concreteWall, shadow: true }],
    container: [{ geo: container, mat: M.container, shadow: true, colors: [0x8c2a1c, 0x1c4a8c, 0x2a6a3a, 0xb07a18] }],
    cone: [{ geo: cone, mat: M.orange }, { geo: coneBand, mat: M.white }],
    jersey: [{ geo: jersey, mat: M.concreteWall }],
    pillar: [{ geo: pillar, mat: M.concreteWall, shadow: true }],
    floodlight: [{ geo: flood, mat: M.darkMetal }, { geo: floodLens, mat: M.lampHeadCool, emissive: true }],
    manhole: [{ geo: manhole, mat: M.markings }],
    drain: [{ geo: drain, mat: M.markings }],
  };
  return { defs, signalLens };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

export class PropSystem {
  constructor(scene, materials, planner, preset) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);
    const { defs, signalLens } = buildPropDefs(materials);
    this.defs = defs;
    this.meshes = {};   // type -> [InstancedMesh per part]
    this.preset = preset;
    // index props by chunk
    this.byChunk = new Map();
    for (const p of planner.props) {
      if (!defs[p.type]) continue;
      const key = chunkKey(p.x, p.z);
      if (!this.byChunk.has(key)) this.byChunk.set(key, []);
      this.byChunk.get(key).push(p);
    }
    // traffic signal lenses: 3 per signal prop (red/yellow/green), colored per frame
    this.signalLensGeo = signalLens;
    this.signalLensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.signals = [];
  }

  // rebuild instance buffers from the given chunk keys
  rebuild(keys, density = 1) {
    const lists = {};
    for (const t of Object.keys(this.defs)) lists[t] = [];
    const R = rng(1);
    for (const k of keys) {
      const arr = this.byChunk.get(k);
      if (!arr) continue;
      for (const p of arr) {
        if (density < 1 && (p.type === 'tree' || p.type === 'bench' || p.type === 'bin' || p.type === 'meter' || p.type === 'bollard') && ((p.x * 13.7 + p.z * 7.3) % 1 + 1) % 1 > density) continue;
        lists[p.type].push(p);
      }
    }
    void R;
    for (const [type, parts] of Object.entries(this.defs)) {
      const list = lists[type];
      if (!this.meshes[type]) this.meshes[type] = parts.map(() => null);
      parts.forEach((part, pi) => {
        let mesh = this.meshes[type][pi];
        if (!mesh || mesh.instanceMatrix.count < list.length) {
          if (mesh) { this.group.remove(mesh); mesh.dispose(); }
          const cap = Math.max(16, Math.ceil(list.length * 1.4));
          mesh = new THREE.InstancedMesh(part.geo, part.mat, cap);
          mesh.name = `prop_${type}_${pi}`;
          mesh.castShadow = !!part.shadow; mesh.receiveShadow = !part.emissive;
          mesh.frustumCulled = false;
          if (part.colors) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          this.meshes[type][pi] = mesh;
          this.group.add(mesh);
        }
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          _e.set(0, p.rot, 0);
          _q.setFromEuler(_e);
          const s = type === 'tree' ? p.s : 1;
          _s.set(part.scaleX ? p.s : s, s, s);
          _p.set(p.x, p.y, p.z);
          _m.compose(_p, _q, _s);
          mesh.setMatrixAt(i, _m);
          if (part.colors) mesh.setColorAt(i, _c.setHex(part.colors[p.v % part.colors.length]));
        }
        mesh.count = list.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
    }
    this._rebuildSignals(lists.signal);
  }

  _rebuildSignals(list) {
    const need = list.length * 3;
    if (!this.signalMesh || this.signalMesh.instanceMatrix.count < need) {
      if (this.signalMesh) { this.group.remove(this.signalMesh); this.signalMesh.dispose(); }
      this.signalMesh = new THREE.InstancedMesh(this.signalLensGeo, this.signalLensMat, Math.max(30, Math.ceil(need * 1.4)));
      this.signalMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.signalMesh.instanceMatrix.count * 3), 3);
      this.signalMesh.frustumCulled = false;
      this.group.add(this.signalMesh);
    }
    this.signals = list;
    let i = 0;
    for (const p of list) {
      _e.set(0, p.rot, 0); _q.setFromEuler(_e);
      for (let k = 0; k < 3; k++) {
        // head at local (4.5*s, 5.4 +/- 0.3, -0.16)
        _p.set(4.5 * p.s, 5.72 - k * 0.31, -0.16).applyQuaternion(_q).add(new THREE.Vector3(p.x, p.y, p.z));
        _m.compose(_p, _q, _s.set(1, 1, 1));
        this.signalMesh.setMatrixAt(i++, _m);
      }
    }
    this.signalMesh.count = i;
    this.signalMesh.instanceMatrix.needsUpdate = true;
  }

  // lights: fn(nodeId, axis) -> 'red'|'yellow'|'green'
  updateSignals(stateFn, night) {
    if (!this.signalMesh) return;
    const on = 1.5 + night * 2.5;
    let i = 0;
    for (const p of this.signals) {
      const st = stateFn(p.node, p.axis);
      this.signalMesh.setColorAt(i++, _c.setRGB(st === 'red' ? on : 0.12, st === 'red' ? 0.05 * on : 0.01, 0.01));
      this.signalMesh.setColorAt(i++, _c.setRGB(st === 'yellow' ? on : 0.1, st === 'yellow' ? 0.6 * on : 0.07, 0.01));
      this.signalMesh.setColorAt(i++, _c.setRGB(0.01, st === 'green' ? on : 0.08, st === 'green' ? 0.55 * on : 0.04));
    }
    if (this.signalMesh.instanceColor) this.signalMesh.instanceColor.needsUpdate = true;
  }

  count() { let n = 0; for (const arr of Object.values(this.meshes)) for (const m of arr) if (m) n += m.count; return n; }
}

export const CHUNK_SIZE = 160;
export const chunkKey = (x, z) => `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
