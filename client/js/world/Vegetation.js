// Vegetation from real scanned/modelled assets: trees (LOD0 / LOD1 meshes + runtime-baked billboard impostors),
// shrubs/ferns/rocks (distance-culled instanced chunks) and a streaming ring of instanced grass clumps with wind.
import * as THREE from 'three';
import { groundHeight, roadDistance, BUILDINGS, PROPS, MAP_HALF } from '/shared/map.js';
import { hash2 } from '/shared/util.js';

const windUniforms = { uTime: { value: 0 } };
function addWind(material, strength = 0.08, heightRef = 1) {
  const m = material.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hw = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.0);
        float ph = ip.x * 0.37 + ip.z * 0.21;
        float w = sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.4;
        transformed.x += w * ${strength.toFixed(3)} * hw * hw;
        transformed.z += cos(uTime * 1.3 + ph) * ${(strength * 0.6).toFixed(3)} * hw * hw;`);
  };
  m.customProgramCacheKey = () => `wind${strength}${heightRef}`;
  return m;
}

function meshesOf(gltf) {
  const out = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { if (o.isMesh && o.visible) out.push(o); });
  return out;
}

export class Vegetation {
  constructor(assets, world, quality, renderer) {
    this.assets = assets; this.world = world; this.quality = quality; this.renderer = renderer;
    this.group = new THREE.Group(); this.group.name = 'vegetation';
    this.q = quality === 'verylow'
      ? { lod0: 10, lod1: 40, grassR: 0, grassStep: 3, shrubR: 28 }
      : quality === 'low'
      ? { lod0: 16, lod1: 60, grassR: 20, grassStep: 2.7, shrubR: 42 }
      : quality === 'ultra'
      ? { lod0: 60, lod1: 200, grassR: 55, grassStep: 1.6, shrubR: 120 }
      : quality === 'high'
      ? { lod0: 45, lod1: 150, grassR: 44, grassStep: 1.8, shrubR: 95 }
      : { lod0: 30, lod1: 100, grassR: 34, grassStep: 2.1, shrubR: 68 };
    this.lastUpdate = -1; this.lastGrassPos = new THREE.Vector3(1e9, 0, 0);
  }

  async init() {
    const A = this.assets, V = this.world.vegetation;
    const [lod0, lod1, grass, shrub, fern, dead, r7, r9] = await Promise.all(['tree_lod0', 'tree_lod1', 'grass', 'shrub', 'fern', 'dead_tree', 'rock_07', 'rock_09'].map((k) => A.loadVegetation(k)));
    const trees = V.trees.filter((t) => !t.dead);
    this.trees = trees.map((t) => ({ ...t, y: groundHeight(t.x, t.z), m: new THREE.Matrix4().compose(new THREE.Vector3(t.x, groundHeight(t.x, t.z) - 0.05, t.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r), new THREE.Vector3(t.s, t.s * (0.9 + (t.r % 0.3)), t.s)) }));
    const mk = (gltf, n, wind) => meshesOf(gltf).map((o) => {
      let mat = o.material;
      if (wind && /leaves|leaf/i.test(mat.name)) mat = addWind(mat, 0.06, 4);
      mat.side = /leaves|leaf/i.test(mat.name) ? THREE.DoubleSide : mat.side;
      const im = new THREE.InstancedMesh(o.geometry, mat, n);
      im.userData.local = o.matrixWorld.clone();
      im.castShadow = true; im.receiveShadow = true; im.count = 0; im.frustumCulled = false;
      this.group.add(im); return im;
    });
    this.lod0 = mk(lod0, trees.length, true);
    this.lod1 = mk(lod1, trees.length, true);
    if (!['medium', 'high', 'ultra'].includes(this.quality)) this.lod1.forEach((m) => { m.castShadow = false; });
    this.impostor = this.#bakeImpostor(lod1, trees.length);
    // dead trees (static)
    const deadM = V.trees.filter((t) => t.dead).map((t) => new THREE.Matrix4().compose(new THREE.Vector3(t.x, groundHeight(t.x, t.z), t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.r, 0)), new THREE.Vector3(t.s * 1.4, t.s * 1.4, t.s * 1.4)));
    this.#staticInstances(dead, deadM, true);
    // shrubs / ferns / rocks in chunks with distance culling
    this.chunks = [];
    const chunkOf = (list, gltf, scaleFn, wind) => {
      const cells = new Map();
      for (const s of list) { const k = `${Math.floor(s.x / 64)},${Math.floor(s.z / 64)}`; (cells.get(k) || cells.set(k, []).get(k)).push(s); }
      for (const [k, arr] of cells) {
        const [cx, cz] = k.split(',').map(Number);
        const ms = arr.map((s) => new THREE.Matrix4().compose(new THREE.Vector3(s.x, groundHeight(s.x, s.z) - 0.03, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.r, 0)), new THREE.Vector3().setScalar(scaleFn(s))));
        const g = this.#staticInstances(gltf, ms, !wind, wind);
        this.chunks.push({ g, x: cx * 64 + 32, z: cz * 64 + 32 });
      }
    };
    chunkOf(V.shrubs.filter((s) => s.kind === 'shrub'), shrub, (s) => s.s * 1.3, true);
    chunkOf(V.shrubs.filter((s) => s.kind === 'fern'), fern, (s) => s.s * 0.7, true);
    chunkOf(V.rocks.filter((s) => s.kind === 'rock_07'), r7, (s) => s.s, false);
    chunkOf(V.rocks.filter((s) => s.kind === 'rock_09'), r9, (s) => s.s * 1.4, false);
    // grass clumps: individual nodes of the grass asset, recentred
    this.grassKinds = [];
    grass.scene.updateMatrixWorld(true);
    grass.scene.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().makeScale(o.matrixWorld.elements[0], o.matrixWorld.elements[5], o.matrixWorld.elements[10]));
      g.computeBoundingBox(); const c = g.boundingBox.getCenter(new THREE.Vector3()); g.translate(-c.x, -g.boundingBox.min.y, -c.z);
      const mat = addWind(o.material, 0.045, 0.35);
      mat.side = THREE.DoubleSide;
      const cap = Math.ceil((Math.PI * this.q.grassR ** 2) / (this.q.grassStep ** 2) / 4) + 64;
      const im = new THREE.InstancedMesh(g, mat, cap);
      im.count = 0; im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false;
      this.grassKinds.push(im); this.group.add(im);
    });
    this.grassKinds.sort((a, b) => a.geometry.index.count - b.geometry.index.count);
    // keep the lighter clump variants (<= ~450 triangles each); drop the rest from the scene
    const keep = this.grassKinds.filter((g) => g.geometry.index.count <= 1350).slice(0, 7);
    for (const g of this.grassKinds) if (!keep.includes(g)) g.removeFromParent();
    this.grassKinds = keep.length ? keep : this.grassKinds.slice(0, 3);
    return this;
  }

  #staticInstances(gltf, matrices, cast = true, wind = false) {
    const group = new THREE.Group();
    for (const o of meshesOf(gltf)) {
      const im = new THREE.InstancedMesh(o.geometry, wind ? addWind(o.material, 0.04, 0.6) : o.material, matrices.length);
      const tmp = new THREE.Matrix4();
      matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, o.matrixWorld)));
      im.castShadow = cast; im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    }
    this.group.add(group);
    return group;
  }

  // Render the LOD1 tree from the side into an RGBA texture once, then draw far trees as crossed billboards.
  #bakeImpostor(gltf, n) {
    const size = 256;
    const rt = new THREE.WebGLRenderTarget(size, size * 2);
    const scene = new THREE.Scene();
    const tree = gltf.scene.clone();
    scene.add(tree);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(2, 5, 3); scene.add(d);
    const box = new THREE.Box3().setFromObject(tree), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const w = Math.max(s.x, s.z) * 1.05, h = s.y * 1.02;
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, 0.1, 50);
    cam.position.set(c.x, box.min.y, c.z + 20); cam.lookAt(c.x, box.min.y, c.z);
    const r = this.renderer;
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, cam); r.setRenderTarget(null); r.setClearColor(prevClear, prevAlpha);
    const quad = new THREE.PlaneGeometry(w, h); quad.translate(0, h / 2, 0);
    const q2 = quad.clone().rotateY(Math.PI / 2);
    const geo = new THREE.BufferGeometry();
    const merged = [quad, q2];
    const pos = [], uv = [], nor = [], idx = [];
    for (const g of merged) { const base = pos.length / 3; pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); nor.push(...g.attributes.normal.array); idx.push(...Array.from(g.index.array, (i) => i + base)); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    const im = new THREE.InstancedMesh(geo, mat, n); im.count = 0; im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
    this.group.add(im);
    this.impostorOffset = new THREE.Vector3(c.x, 0, c.z);
    return im;
  }

  #treeLODs(cam) {
    const p = cam.position;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sphere = new THREE.Sphere();
    const c0 = [], c1 = [], c2 = [];
    for (const t of this.trees) {
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      sphere.center.set(t.x, t.y + 3 * t.s, t.z); sphere.radius = 3.5 * t.s;
      if (d > 12 && !frustum.intersectsSphere(sphere)) continue;
      (d < this.q.lod0 ? c0 : d < this.q.lod1 ? c1 : c2).push(t);
    }
    const tmp = new THREE.Matrix4();
    for (const [lists, meshes] of [[c0, this.lod0], [c1, this.lod1]]) {
      for (const im of meshes) {
        lists.forEach((t, i) => im.setMatrixAt(i, tmp.multiplyMatrices(t.m, im.userData.local)));
        im.count = lists.length; im.instanceMatrix.needsUpdate = true;
      }
    }
    const im = this.impostor;
    c2.forEach((t, i) => im.setMatrixAt(i, tmp.compose(new THREE.Vector3(t.x, t.y, t.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.r, 0)), new THREE.Vector3(t.s, t.s, t.s))));
    im.count = c2.length; im.instanceMatrix.needsUpdate = true;
  }

  #grass(cam) {
    if (!this.q.grassR) return;
    const p = cam.position;
    if (p.distanceTo(this.lastGrassPos) < 3) return;
    this.lastGrassPos.copy(p);
    const R = this.q.grassR, st = this.q.grassStep, kinds = this.grassKinds;
    const counts = kinds.map(() => 0);
    const tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const gx0 = Math.floor((p.x - R) / st), gx1 = Math.floor((p.x + R) / st), gz0 = Math.floor((p.z - R) / st), gz1 = Math.floor((p.z + R) / st);
    for (let i = gx0; i <= gx1; i++) for (let j = gz0; j <= gz1; j++) {
      const h = hash2(i, j, 5);
      const x = (i + hash2(i, j, 9)) * st, z = (j + hash2(i, j, 13)) * st;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > R || Math.abs(x) > MAP_HALF - 2 || Math.abs(z) > MAP_HALF - 2) continue;
      // density falls off with distance
      if (h > 1 - 0.75 * (1 - (d / R) ** 2) - 0.2) continue;
      if (roadDistance(x, z) < 1.8) continue;
      let blocked = false;
      for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 + 1 && Math.abs(z - b.z) < b.d / 2 + 1) { blocked = true; break; }
      if (blocked) continue;
      const k = Math.floor(hash2(i, j, 21) * kinds.length);
      const im = kinds[k];
      if (counts[k] >= im.instanceMatrix.count) continue;
      const sc = 0.8 + hash2(i, j, 33) * 0.9;
      tmp.compose(v.set(x, groundHeight(x, z) - 0.02, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h * 6.283), s.set(sc, sc * (0.8 + hash2(i, j, 41) * 0.6), sc));
      im.setMatrixAt(counts[k]++, tmp);
    }
    kinds.forEach((im, k) => { im.count = counts[k]; im.instanceMatrix.needsUpdate = true; });
  }

  update(dt, cam, time) {
    windUniforms.uTime.value = time;
    if (time - this.lastUpdate > 0.25) { this.lastUpdate = time; this.#treeLODs(cam); }
    this.#grass(cam);
    for (const c of this.chunks) c.g.visible = Math.hypot(c.x - cam.position.x, c.z - cam.position.z) < this.q.shrubR + 20;
  }
}
