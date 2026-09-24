// TrafficRenderer: draws all civilian vehicles with InstancedMeshes — per vehicle type and LOD,
// one draw call per material (paint uses per-instance color), plus instanced wheels and
// instanced light glows / headlight ground beams. Never hundreds of individual car objects.
import * as THREE from 'three';
import { radialGlow, lightPool, carPaintTexture, headlightTextures, taillightTextures } from '../renderer/Textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const _w = new THREE.Matrix4(), _wq = new THREE.Quaternion();

function splitGroups(geo) {
  if (!geo.groups.length) return [{ materialIndex: 0, geo }];
  return geo.groups.map((g) => {
    const n = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(geo.attributes)) n.setAttribute(k, v);
    n.setIndex(new THREE.BufferAttribute(geo.index.array.slice(g.start, g.start + g.count), 1));
    return { materialIndex: g.materialIndex, geo: n };
  });
}

export class TrafficRenderer {
  constructor(scene, lib, types, maxPerType = 40) {
    this.scene = scene;
    this.types = {};
    this.max = maxPerType;
    const W = lib.wheels;
    const tireGeo = W.getObjectByName('tire_lod1')?.geometry || W.getObjectByName('tire').geometry;
    const rimGeo = W.getObjectByName('rim_4').geometry;
    const tireMat = W.getObjectByName('tire').material;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, metalness: 0.9, roughness: 0.35 });
    this.shared = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1, vertexColors: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0a0e12, metalness: 0.5, roughness: 0.05, envMapIntensity: 1.5 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.15 }),
      head: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, map: headlightTextures().emissiveMap }),
      tail: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, map: taillightTextures().emissiveMap }),
    };
    for (const type of types) {
      const src = lib.cars[type];
      if (!src) continue;
      const entry = { lods: [], wheels: [] };
      for (const lodName of ['lod0', 'lod1']) {
        const root = src.getObjectByName(lodName);
        if (!root) continue;
        const parts = { paint: [], glass: [], dark: [], chrome: [], head: [], tail: [] };
        root.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const { materialIndex, geo } of splitGroups(o.geometry)) {
            const name = mats[materialIndex]?.name || mats[0].name;
            const key = { paint: 'paint', glass: 'glass', trim: 'dark', under: 'dark', chrome: 'chrome', headlight: 'head', taillight: 'tail', interior: 'dark', carbon: 'dark' }[name] || 'dark';
            parts[key].push(geo);
          }
        });
        const meshes = {};
        if (!entry.paintMat) {
          entry.paintMat = this.shared.paint.clone();
          const t = carPaintTexture(0, '#ffffff', '#111111', lib.manifest?.cars?.[type]?.panels);
          entry.paintMat.map = t.map; entry.paintMat.normalMap = t.normalMap; entry.paintMat.normalScale = new THREE.Vector2(0.35, 0.35);
        }
        for (const [k, list] of Object.entries(parts)) {
          if (!list.length) continue;
          const geo = list.length === 1 ? list[0] : mergeIndexed(list);
          const mesh = new THREE.InstancedMesh(geo, k === 'paint' ? entry.paintMat : this.shared[k], maxPerType);
          mesh.count = 0; mesh.frustumCulled = false;
          mesh.castShadow = k === 'paint' && lodName === 'lod0'; mesh.receiveShadow = false;
          if (k === 'paint' || k === 'head' || k === 'tail') mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxPerType * 3), 3);
          scene.add(mesh);
          meshes[k] = mesh;
        }
        entry.lods.push(meshes);
      }
      // wheel positions from markers
      const lod0 = src.getObjectByName('lod0');
      for (const id of ['FL', 'FR', 'RL', 'RR']) {
        const mk = lod0.getObjectByName('wheel_' + id);
        if (mk) entry.wheels.push({ id, pos: mk.position.clone(), side: mk.position.x >= 0 ? 1 : -1 });
      }
      const man = lib.manifest?.cars?.[type];
      entry.wheelR = man?.wheels?.[0]?.r || 0.34; entry.wheelW = man?.wheels?.[0]?.w || 0.25;
      const hl = lod0.getObjectByName('light_head_L')?.position, tl = lod0.getObjectByName('light_tail_L')?.position;
      entry.head = hl ? hl.clone() : new THREE.Vector3(0.7, 0.7, 2.2);
      entry.tail = tl ? tl.clone() : new THREE.Vector3(0.7, 0.8, -2.2);
      entry.length = man?.length || 4.6;
      this.types[type] = entry;
    }
    const cap = maxPerType * types.length * 4;
    this.tires = new THREE.InstancedMesh(tireGeo, tireMat, cap);
    this.rims = new THREE.InstancedMesh(rimGeo, rimMat, cap);
    for (const m of [this.tires, this.rims]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    const gcap = maxPerType * types.length * 2;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.headGlow = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: radialGlow('rgba(255,250,235,1)', 'rgba(220,230,255,0.3)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), gcap);
    this.tailGlow = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: radialGlow('rgba(255,60,50,1)', 'rgba(255,20,20,0.3)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), gcap);
    this.tailGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gcap * 3), 3);
    const beamGeo = new THREE.PlaneGeometry(6, 15).rotateX(-Math.PI / 2).translate(0, 0.07, 10);
    this.beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ map: lightPool(), color: 0xfff0d8, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6 }), maxPerType * types.length);
    for (const m of [this.headGlow, this.tailGlow, this.beams]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 5; scene.add(m); }
  }

  // cars: [{type, x, y, z, yaw, pitch, roll, color(THREE.Color), brake, spin, lod}]
  update(cars, camera, night) {
    const counts = {};
    let wi = 0, gi = 0, ti = 0, bi = 0;
    const lightsOn = night > 0.35;
    const cq = camera.quaternion;
    for (const c of cars) {
      const T = this.types[c.type];
      if (!T) continue;
      const lod = c.lod === 0 || T.lods.length < 2 ? 0 : 1;
      const key = c.type + lod;
      const n = counts[key] || 0;
      if (n >= this.max) continue;
      counts[key] = n + 1;
      _e.set(-(c.pitch || 0), c.yaw, c.roll || 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1));
      const meshes = T.lods[lod];
      for (const [k, mesh] of Object.entries(meshes)) {
        mesh.setMatrixAt(n, _m);
        if (k === 'paint') mesh.setColorAt(n, c.color);
        else if (k === 'head') mesh.setColorAt(n, _c.setScalar(lightsOn ? 2.2 : 0.6));
        else if (k === 'tail') mesh.setColorAt(n, _c.setRGB(lightsOn ? 1.2 + c.brake * 3 : 0.35 + c.brake * 3, 0.05, 0.04));
      }
      // wheels
      if (c.dist < 160) {
        _e.set(0, c.yaw, 0); _wq.setFromEuler(_e);
        for (const w of T.wheels) {
          _p.copy(w.pos).applyQuaternion(_q).add(_s.set(c.x, c.y, c.z));
          const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), c.spin);
          const q = new THREE.Quaternion().copy(_wq).multiply(spin);
          const sc = T.wheelR / 0.34;
          _w.compose(_p, q, _s.set((T.wheelW / 0.25) * w.side, sc, sc));
          if (wi < this.tires.instanceMatrix.count) { this.tires.setMatrixAt(wi, _w); this.rims.setMatrixAt(wi, _w); wi++; }
        }
      }
      // light glows (billboards) and headlight beam on the ground
      if ((lightsOn || c.brake > 0.1) && c.dist < 350) {
        for (const sx of [1, -1]) {
          if (lightsOn) {
            _p.set(T.head.x * sx, T.head.y, T.head.z + 0.05).applyQuaternion(_q).add(_s.set(c.x, c.y, c.z));
            const hs = 0.9 + c.dist * 0.004;
            this.headGlow.setMatrixAt(gi++, _w.compose(_p, cq, _s.set(hs, hs, hs)));
          }
          _p.set(T.tail.x * sx, T.tail.y, T.tail.z - 0.05).applyQuaternion(_q).add(_s.set(c.x, c.y, c.z));
          const ts = 0.55 + c.brake * 0.5 + c.dist * 0.003;
          this.tailGlow.setMatrixAt(ti, _w.compose(_p, cq, _s.set(ts, ts, ts)));
          this.tailGlow.setColorAt(ti++, _c.setScalar(lightsOn ? 0.7 + c.brake * 0.6 : c.brake));
        }
        if (lightsOn && c.dist < 140) { _m.compose(_p.set(c.x, c.y, c.z), _wq.setFromEuler(_e.set(0, c.yaw, 0)), _s.set(1, 1, 1)); this.beams.setMatrixAt(bi++, _m); }
      }
    }
    for (const [type, T] of Object.entries(this.types)) {
      T.lods.forEach((meshes, lod) => {
        const n = counts[type + lod] || 0;
        for (const mesh of Object.values(meshes)) {
          mesh.count = n;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      });
    }
    this.tires.count = wi; this.rims.count = wi;
    this.tires.instanceMatrix.needsUpdate = true; this.rims.instanceMatrix.needsUpdate = true;
    this.headGlow.count = gi; this.tailGlow.count = ti; this.beams.count = bi;
    this.headGlow.instanceMatrix.needsUpdate = true; this.tailGlow.instanceMatrix.needsUpdate = true; this.beams.instanceMatrix.needsUpdate = true;
    if (this.tailGlow.instanceColor) this.tailGlow.instanceColor.needsUpdate = true;
  }
}

function mergeIndexed(list) {
  // all geometries share the same attribute buffers (split from one mesh) or not; merge generically
  let total = 0, vtotal = 0;
  const shared = list.every((g) => g.attributes.position === list[0].attributes.position);
  if (shared) {
    for (const g of list) total += g.index.count;
    const idx = new Uint32Array(total);
    let o = 0;
    for (const g of list) { idx.set(g.index.array, o); o += g.index.count; }
    const n = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(list[0].attributes)) n.setAttribute(k, v);
    n.setIndex(new THREE.BufferAttribute(idx, 1));
    return n;
  }
  for (const g of list) { vtotal += g.attributes.position.count; total += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vtotal * 3), nor = new Float32Array(vtotal * 3), uv = new Float32Array(vtotal * 2), col = new Float32Array(vtotal * 3).fill(1), idx = new Uint32Array(total);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, nn = g.attributes.normal, t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (nn) { nor[(vo + i) * 3] = nn.getX(i); nor[(vo + i) * 3 + 1] = nn.getY(i); nor[(vo + i) * 3 + 2] = nn.getZ(i); }
      if (t) { uv[(vo + i) * 2] = t.getX(i); uv[(vo + i) * 2 + 1] = t.getY(i); }
      const cc = g.attributes.color;
      if (cc) { col[(vo + i) * 3] = cc.getX(i); col[(vo + i) * 3 + 1] = cc.getY(i); col[(vo + i) * 3 + 2] = cc.getZ(i); }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = i + vo;
    vo += p.count;
  }
  const n = new THREE.BufferGeometry();
  n.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  n.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  n.setIndex(new THREE.BufferAttribute(idx, 1));
  return n;
}
