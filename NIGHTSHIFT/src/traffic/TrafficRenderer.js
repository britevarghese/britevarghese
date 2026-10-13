// TrafficRenderer: draws all civilian vehicles with InstancedMeshes — per vehicle type and LOD,
// one draw call per material (paint uses per-instance color), plus instanced wheels and
// instanced light glows / headlight ground beams. Never hundreds of individual car objects.
import * as THREE from 'three';
import { radialGlow, lightPool, carPaintTexture, headlightTextures, taillightTextures } from '../renderer/Textures.js';
import { clamp } from '../core/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  constructor(scene, lib, types, maxPerType = 40, warm = null) {
    this.scene = scene; this.warm = warm;
    this.types = {};
    this.max = maxPerType;
    const W = lib.wheels;
    const tireGeo = W.getObjectByName('tire_lod1')?.geometry || W.getObjectByName('tire').geometry;
    const rimGeo = W.getObjectByName('rim_4').geometry;
    const tireMat = W.getObjectByName('tire').material;
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, metalness: 0.9, roughness: 0.35 });
    this.shared = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1, vertexColors: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0a0e12, metalness: 0.5, roughness: 0.14, envMapIntensity: 1.1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.15 }),
      head: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, map: headlightTextures().emissiveMap }),
      tail: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, map: taillightTextures().emissiveMap }),
    };
    this.lib = lib; this.maxPerType = maxPerType;
    // (the types' models are made ready a few milliseconds at a time, between frames: all seventeen at once froze the
    // game for seconds when the models finished loading mid-drive, and one big model alone for up to a second.
    // Traffic uses a type once it is ready)
    this._queue = []; this._job = null;
    for (const type of types) this.queueType(type);
    const cap = maxPerType * types.length * 4;
    this.tires = new THREE.InstancedMesh(tireGeo, tireMat, cap);
    this.rims = new THREE.InstancedMesh(rimGeo, rimMat, cap);
    for (const m of [this.tires, this.rims]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    const gcap = maxPerType * types.length * 2;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.headGlow = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: radialGlow('rgba(255,250,235,1)', 'rgba(220,230,255,0.3)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), gcap);
    this.tailGlow = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: radialGlow('rgba(255,60,50,1)', 'rgba(255,20,20,0.3)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), gcap);
    this.tailGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gcap * 3), 3);
    this.headGlow.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(gcap * 3), 3);
    const beamGeo = new THREE.PlaneGeometry(6, 15).rotateX(-Math.PI / 2).translate(0, 0.07, 10);
    this.beams = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ map: lightPool(), color: 0xfff0d8, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -6 }), maxPerType * types.length);
    for (const m of [this.headGlow, this.tailGlow, this.beams]) { m.count = 0; m.frustumCulled = false; m.renderOrder = 5; scene.add(m); }
  }

  queueType(type) {
    if (this.types[type] || this._queue.includes(type) || this._job?.type === type || this._wt?.has(type)) return;
    this._queue.push(type); this._schedule();
  }

  // (when the page is idle too: in the menu, or time to spare between frames)
  _schedule() {
    if (this._idle || (!this._queue.length && !this._job)) return;
    const go = (ms) => { this._idle = null; this._pump(ms); this._schedule(); };
    this._idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback((d) => go(Math.min(8, Math.max(3, d.timeRemaining()))), { timeout: 250 })
      : setTimeout(() => go(4), 16);
  }

  _pump(ms) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (!this._job) {
        const type = this._queue.shift(); if (!type) return;
        if (!this.types[type]) this._job = { type, it: this._typeSteps(type) };
        continue;
      }
      const r = this._job.it.next();
      if (r.done) { const t = this._job.type; this._job = null; if (r.value) this._ready(t, r.value); }
    }
  }

  // a type is used once its shaders are compiled too (in the background: see Game.warm); until then its meshes
  // stay hidden and empty
  _ready(type, entry) {
    const meshes = []; for (const L of entry.lods) for (const v of Object.values(L)) { const m = v?.mesh || v; if (m?.isMesh) meshes.push(m); }
    const done = () => { this._wt.delete(type); this.types[type] = entry; this._attachRider(type); };
    (this._wt ||= new Set()).add(type);
    this._warmAll(meshes).then(done);
  }

  _warmAll(meshes) {
    if (!this.warm || !meshes.length) return Promise.resolve();
    return Promise.resolve(this.warm({ traverse: (cb) => { for (const m of meshes) m.traverse(cb); }, traverseVisible() {} })).catch(() => {});
  }

  // a vehicle type whose model has loaded, made ready at once (types can arrive after the renderer was created)
  addType(type) {
    if (this.types[type]) return;
    const it = this._typeSteps(type);
    let r; while (!(r = it.next()).done);
    if (r.value) { this.types[type] = r.value; this._attachRider(type); }
  }

  *_typeSteps(type) {
    const lib = this.lib, maxPerType = this.maxPerType, scene = this.scene;
    const src = lib.cars[type];
    if (!src) return null;
    if (lib.modelOf?.[type]?.imported) return yield* this._importSteps(scene, src, lib.manifest?.cars?.[lib.modelOf[type].key], maxPerType);
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
    return entry;
  }

  // Riders for the two-wheelers: casual characters posed onto each bike's seat, bars and footrests (the player's
  // rider IK), wearing a helmet, baked once into static geometry and drawn instanced with the bikes.
  // (a bike type made ready after the people loaded gets its riders then: see _pump)
  attachRiders(humans, SkinnedRider, bikes) {
    if (this._riderSrc || !humans?.ready) return;
    this._riderSrc = { humans, SkinnedRider, bikes };
    this.riders ||= {};
    for (const type of Object.keys(bikes)) this._attachRider(type);
  }

  _attachRider(type) {
    const S = this._riderSrc;
    if (!S || type in this.riders || this._rw?.has(type)) return;
    const { humans, SkinnedRider, bikes } = S;
    const HELMETS = [0x1a1a1a, 0xe8e8e8, 0xb01818, 0x1a3a8a, 0xd8b020, 0x2a6a3a];   // (each rider's helmet is shaped to its own head: _helmet)
    {
      const cfg = bikes[type], T = this.types[type];
      if (!cfg || !T || !T.hubs) return;
      const zF = T.hubs.find((h) => h.id === 'F')?.pos.z ?? 0.65, zR = T.hubs.find((h) => h.id === 'R')?.pos.z ?? -0.65;
      const variants = [];
      for (let v = 0; v < 3; v++) {
        // (scooters: anyone; the motorcycles: men, in shirts)
        const h = type === 'scooter' ? humans.create(v * 2 + (type.length % 2), { shadow: false }) : humans.createMan(v * 3 + type.length, { shadow: false });
        if (!h) break;
        // the character's bones under the rider IK (same Mixamo-style names as the rider model)
        const r = new SkinnedRider({ zF, zR, seat: cfg.seat, style: 'sport', rider: cfg.pose }, false, h.root);
        // two poses: riding (feet on the pegs) and stopped (the left foot down on the road)
        const both = {};
        for (const pose of ['ride', 'stop']) {
          if (pose === 'stop') r.pose(0, { down: 1, paddle: null });
          r.model.updateMatrixWorld(true);
          both[pose] = this._bakeRider(r);
        }
        const parts = both;
        variants.push(parts);
        h.dispose?.();
      }
      // (drawn once their shaders are compiled: see _ready)
      // (the table holds only riders ready to draw: update() walks every entry)
      if (variants.length) { (this._rw ||= new Set()).add(type); this._warmAll(variants.flatMap((v) => Object.values(v).flat()).filter((m) => m?.isMesh)).then(() => { this._rw.delete(type); this.riders[type] = { variants, HELMETS }; }); }
    }
  }

  // An open-face helmet shaped to the rider's head: the shell over the top and down the back (the face open), a peak
  // over the brow and a smoked visor strip, turned with the head (the Head -> HeadTop bone gives its size and tilt)
  _helmet(r) {
    let topB = null; r.model.traverse((o) => { if (!topB && /HeadTop_End$/i.test(o.name)) topB = o; });
    const head = new THREE.Vector3(), top = new THREE.Vector3();
    r.bones.Head.getWorldPosition(head);
    if (topB) topB.getWorldPosition(top); else top.copy(head).add(new THREE.Vector3(0, 0.2, 0));
    const up = top.clone().sub(head), L = up.length(); up.normalize();
    const fwd = new THREE.Vector3(0, 0, 1).addScaledVector(up, -up.z).normalize(), right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const R = Math.min(0.15, Math.max(0.11, L * 0.62)), centre = head.clone().addScaledVector(up, L * 0.52).addScaledVector(fwd, -0.01);
    const M = new THREE.Matrix4().makeBasis(right, up, fwd).setPosition(centre);
    const tilt = new THREE.Matrix4().makeRotationX(-0.38);   // the back comes lower than the front
    const shell = new THREE.SphereGeometry(R, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 0.98, 1.1).applyMatrix4(tilt).applyMatrix4(M);
    // the peak: a short brim over the brow; the visor: a smoked band across the forehead
    const peak = new THREE.SphereGeometry(R * 1.06, 18, 2, Math.PI / 2 - 0.85, 1.7, Math.PI * 0.55, Math.PI * 0.05).applyMatrix4(tilt).applyMatrix4(M);
    const visor = new THREE.SphereGeometry(R * 1.03, 18, 3, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.6, Math.PI * 0.12).applyMatrix4(tilt).applyMatrix4(M);
    return { shell: mergeGeometries([shell, peak]), visor };
  }

  _bakeRider(r) {
    const byMat = new Map(), v3 = new THREE.Vector3();
    r.model.traverse((o) => {
      if (!o.isMesh) return;
      if (/hair/i.test(o.name) || /hair/i.test(o.material?.name || '')) return;   // (under the helmet)
      const src = o.geometry, n = src.attributes.position.count;
      const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        if (o.isSkinnedMesh) o.getVertexPosition(i, v3); else v3.fromBufferAttribute(src.attributes.position, i);
        v3.applyMatrix4(o.matrixWorld);
        pos.set([v3.x, v3.y, v3.z], i * 3);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
      if (src.index) g.setIndex(src.index);
      g.computeVertexNormals();
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(g);
    });
    const parts = [];
    for (const [m, geos] of byMat) {
      const g = geos.length === 1 ? geos[0] : mergeGeometries(geos.map((x) => { if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2)); return x; }), false);
      if (!g) continue;
      const mesh = new THREE.InstancedMesh(g, m, this.maxPerType);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false;
      this.scene.add(mesh); parts.push(mesh);
    }
    const H = this._helmet(r);
    const hm = new THREE.InstancedMesh(H.shell, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 }), this.maxPerType);
    hm.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPerType * 3), 3);
    hm.count = 0; hm.frustumCulled = false; this.scene.add(hm); parts.push(hm); hm.userData.helmet = true;
    const vm = new THREE.InstancedMesh(H.visor, new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.15, metalness: 0.3 }), this.maxPerType);
    vm.count = 0; vm.frustumCulled = false; this.scene.add(vm); parts.push(vm);
    return parts;
  }

  // cars: [{type, x, y, z, yaw, pitch, roll, color(THREE.Color), brake, spin, lod}]
  update(cars, camera, night, refl = null) {
    if (this._queue.length || this._job) this._pump(3);
    const counts = {}, rc = {};
    let wi = 0, gi = 0, ti = 0, bi = 0;
    this.tick = (this.tick || 0) + 1;     // (each car drawn is marked with it: the seated drivers go only in those)
    const lightsOnAll = night > 0.35;
    const cq = camera.quaternion;
    for (const c of cars) {
      const T = this.types[c.type];
      if (!T) continue;
      const lod = c.lod === 0 || T.lods.length < 2 ? 0 : 1;
      const key = c.type + lod;
      const n = counts[key] || 0;
      if (n >= this.max) continue;
      counts[key] = n + 1;
      c.drawn = this.tick;
      _e.set(-(c.pitch || 0), c.yaw, c.roll || 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1));
      const lightsOn = lightsOnAll && !c.parked; // parked cars sit dark
      if (T.imported) { this._placeImported(T, lod, n, _m, c, lightsOn); }
      const RD = this.riders?.[c.type];
      if (RD && !c.parked && !c.riderOff && c.dist < 220) {
        const vi = c.id % RD.variants.length, pose = c.footDown ? 'stop' : 'ride', parts = RD.variants[vi][pose], key = c.type + vi + pose, k = (rc[key] = (rc[key] || 0) + 1) - 1;
        for (const mesh of parts) {
          if (k >= mesh.instanceMatrix.count) continue;
          mesh.setMatrixAt(k, _m);
          if (mesh.userData.helmet) mesh.setColorAt(k, _c.setHex(RD.HELMETS[c.id % RD.HELMETS.length]));
        }
      }
      const meshes = T.imported ? {} : T.lods[lod];
      for (const [k, mesh] of Object.entries(meshes)) {
        mesh.setMatrixAt(n, _m);
        if (k === 'paint') mesh.setColorAt(n, c.color);
        else if (k === 'head') mesh.setColorAt(n, _c.setScalar(lightsOn ? 2.2 : 0.6));
        else if (k === 'tail') mesh.setColorAt(n, _c.setRGB(lightsOn ? 1.2 + c.brake * 3 : 0.35 + c.brake * 3, 0.05, 0.04));
      }
      // wheels
      if (!T.imported && c.dist < 160) {
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
        // which end faces the camera (for wet-road reflections)
        const facing = (camera.position.x - c.x) * Math.sin(c.yaw) + (camera.position.z - c.z) * Math.cos(c.yaw);
        const reflect = refl && c.dist < 140;
        for (const sx of T.bike ? [0] : [1, -1]) {
          // headlight halo only toward the camera, and fading as the car turns away (no glare from the side)
          const headK = clamp((facing / Math.max(c.dist, 1) - 0.05) / 0.6, 0, 1);
          if (lightsOn && headK > 0.01) {
            _p.set(T.head.x * sx, T.head.y, T.head.z + 0.05).applyQuaternion(_q).add(_s.set(c.x, c.y, c.z));
            const hs = 0.55 + c.dist * 0.003;
            this.headGlow.setMatrixAt(gi, _w.compose(_p, cq, _s.set(hs, hs, hs)));
            this.headGlow.setColorAt(gi++, _c.setScalar(0.65 * headK));
            if (reflect && facing > 0) refl.addReflection(_p.x, _p.y, _p.z, 0.8, 0.74, 0.6, 0.55);
          }
          _p.set(T.tail.x * sx, T.tail.y, T.tail.z - 0.05).applyQuaternion(_q).add(_s.set(c.x, c.y, c.z));
          if (reflect && facing < 0) refl.addReflection(_p.x, _p.y, _p.z, 0.7 * (0.45 + c.brake), 0.04, 0.025, 0.45);
          // (from behind only, and small up close: right behind a car a metre-wide red halo hid half the screen)
          const tailK = clamp((-facing / Math.max(c.dist, 1) - 0.05) / 0.5, 0, 1);
          const ts = Math.min(0.3 + c.brake * 0.2 + c.dist * 0.004, 1.1);
          this.tailGlow.setMatrixAt(ti, _w.compose(_p, cq, _s.set(ts, ts, ts)));
          this.tailGlow.setColorAt(ti++, _c.setScalar((lightsOn ? 0.55 + c.brake * 0.4 : c.brake * 0.6) * tailK));
        }
        if (lightsOn && c.dist < 140) { _m.compose(_p.set(c.x, c.y, c.z), _wq.setFromEuler(_e.set(0, c.yaw, 0)), _s.set(1, 1, 1)); this.beams.setMatrixAt(bi++, _m); }
      }
    }
    for (const [type, T] of Object.entries(this.types)) {
      if (T.imported) {
        T.lods.forEach((parts, lod) => {
          const n = counts[type + lod] || 0;
          for (const pt of parts) { pt.mesh.count = n * (pt.wheel ? 4 : 1); pt.mesh.visible = n > 0; pt.mesh.instanceMatrix.needsUpdate = true; if (pt.mesh.instanceColor) pt.mesh.instanceColor.needsUpdate = true; }
        });
        continue;
      }
      T.lods.forEach((meshes, lod) => {
        const n = counts[type + lod] || 0;
        for (const mesh of Object.values(meshes)) {
          mesh.count = n;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      });
    }
    for (const [type, RD] of Object.entries(this.riders || {})) RD.variants.forEach((poses, vi) => {
      for (const [pose, parts] of Object.entries(poses)) {
        const n = rc[type + vi + pose] || 0;
        for (const mesh of parts) { mesh.count = Math.min(n, mesh.instanceMatrix.count); mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
      }
    });
    this.tires.count = wi; this.rims.count = wi;
    this.tires.instanceMatrix.needsUpdate = true; this.rims.instanceMatrix.needsUpdate = true;
    this.headGlow.count = gi; this.tailGlow.count = ti; this.beams.count = bi;
    this.headGlow.instanceMatrix.needsUpdate = true; this.tailGlow.instanceMatrix.needsUpdate = true; this.beams.instanceMatrix.needsUpdate = true;
    if (this.tailGlow.instanceColor) this.tailGlow.instanceColor.needsUpdate = true;
    if (this.headGlow.instanceColor) this.headGlow.instanceColor.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ realistic (imported) traffic models
// An imported model has dozens of meshes; instancing each would cost hundreds of draw calls. Per LOD the
// body is regrouped into: paint (per-car colour), glass, lamps, one vertex-coloured mesh for every
// untextured material, and the few textured materials as they are. Each wheel's spinning part is
// instanced 4x per car (hub position, steer, spin).
TrafficRenderer.prototype._importSteps = function* (scene, src, man, max) {
  const entry = { imported: true, lods: [], hubs: [] };
  const root0 = src.getObjectByName('lod0');
  root0.updateMatrixWorld(true);
  const inv = new THREE.Matrix4();
  // the vertices a draw uses, each corner its own, as plain floats so parts can be merged: a model's attributes are
  // often packed (interleaved, quantized to normalized integers). Read through three's accessors a value at a time
  // (and made non-indexed first, the same again), this took seconds for the vehicle types
  const scale = (A) => (A instanceof Int8Array ? 1 / 127 : A instanceof Uint8Array ? 1 / 255 : A instanceof Int16Array ? 1 / 32767 : A instanceof Uint16Array ? 1 / 65535 : A instanceof Int32Array ? 1 / 2147483647 : A instanceof Uint32Array ? 1 / 4294967295 : 1);
  const gather = (a, idx, n, start) => {
    const sz = a.itemSize, il = a.isInterleavedBufferAttribute, A = il ? a.data.array : a.array, st = il ? a.data.stride : sz, off = il ? a.offset : 0;
    const k = a.normalized ? scale(A) : 1, f = new Float32Array(n * sz);
    for (let i = 0; i < n; i++) { const b = (idx ? idx[i] : start + i) * st + off; for (let j = 0; j < sz; j++) { const v = A[b + j] * k; f[i * sz + j] = v < -1 && k !== 1 ? -1 : v; } }
    return f;
  };
  // (placed by the matrix as it is read: positions by it, normals by its normal matrix. three's applyMatrix4 goes
  // through a vector per vertex)
  const _nm = new THREE.Matrix3();
  const norm = (g0, m) => {
    const idx = g0.index ? g0.index.array : null, pos = g0.attributes.position;
    // (a draw group of a non-indexed geometry is its draw range)
    const start = idx ? 0 : g0.drawRange.start, n = idx ? idx.length : Math.min(pos.count - start, g0.drawRange.count);
    const P = gather(pos, idx, n, start), e = m.elements;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      P[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; P[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; P[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    if (g0.attributes.normal) {
      const N = gather(g0.attributes.normal, idx, n, start), q = _nm.getNormalMatrix(m).elements;
      for (let i = 0; i < N.length; i += 3) {
        const x = N[i], y = N[i + 1], z = N[i + 2], nx = q[0] * x + q[3] * y + q[6] * z, ny = q[1] * x + q[4] * y + q[7] * z, nz = q[2] * x + q[5] * y + q[8] * z, l = Math.hypot(nx, ny, nz) || 1;
        N[i] = nx / l; N[i + 1] = ny / l; N[i + 2] = nz / l;
      }
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    } else g.computeVertexNormals();
    g.setAttribute('uv', new THREE.BufferAttribute(g0.attributes.uv ? gather(g0.attributes.uv, idx, n, start) : new Float32Array(n * 2), 2));
    return g;
  };
  // (all of one draw's parts in one geometry: they are all plain floats with the same attributes, copied end to end)
  const merge = (geos) => {
    if (geos.length === 1) return geos[0];
    const out = new THREE.BufferGeometry();
    for (const k of Object.keys(geos[0].attributes)) {
      if (!geos.every((g) => g.attributes[k])) continue;
      let len = 0; for (const g of geos) len += g.attributes[k].array.length;
      const A = new Float32Array(len); let o = 0;
      for (const g of geos) { A.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
      out.setAttribute(k, new THREE.BufferAttribute(A, geos[0].attributes[k].itemSize));
    }
    return out;
  };
  const kindOf = (mat) => {
    const n = (mat.name || '').toLowerCase();
    if (n === 'paint') return 'paint';
    if (/glass|window|windshield/.test(n) || (mat.transparent && mat.opacity < 0.9)) return 'glass';
    if (/headlight|head_light|lamp.*front/.test(n)) return 'head';
    if (/taillight|tail_light|brake|rearlight/.test(n)) return 'tail';
    return mat.map ? 'tex' : 'plain';
  };
  for (const lodName of ['lod0', 'lod1']) {
    const root = src.getObjectByName(lodName) || root0;
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    const groups = new Map(); // key -> {kind, mat, geos}
    const wheelGroups = new Map();
    // the wheel drawn at every hub: the front-left one, or the first wheel the model has (an autorickshaw has only
    // the rear pair as separate wheels)
    const hubName = (id) => { let f = null; root.traverse((o) => { if (!f && new RegExp(`^wheel_${id}(_\\d+)?$`).test(o.name)) f = o; }); return f; };
    const srcHub = ['FL', 'RL', 'FR', 'RR'].find((id) => hubName(id)) || 'FL';
    entry.wheelSide = srcHub[1] === 'R' ? -1 : 1;
    const meshes = []; root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      // which wheel (if any) this mesh spins with
      let w = o, hub = null, spin = false;
      // (the loader renames repeated node names, so the far LOD's are 'spin_1', 'wheel_RL_1', ...)
      while (w && w !== root) { if (/^spin(_\d+)?$/.test(w.name)) spin = true; if (/^wheel_(FL|FR|RL|RR)(_\d+)?$/.test(w.name)) { hub = w; break; } w = w.parent; }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const geo0 = o.geometry;
      const parts = geo0.groups?.length && mats.length > 1 ? geo0.groups.map((gr) => ({ mat: mats[gr.materialIndex], geo: sub(geo0, gr) })) : [{ mat: mats[0], geo: geo0 }];
      for (const { mat, geo } of parts) {
        yield;
        if (hub && spin) {
          // one geometry per material, taken from the front-left wheel only (all four are the same wheel)
          if (hub.name.slice(6, 8) !== srcHub) continue;
          // relative to the hub (the instance matrix puts it on each wheel)
          const g = norm(geo, new THREE.Matrix4().copy(hub.matrixWorld).invert().multiply(o.matrixWorld));
          if (!wheelGroups.has(mat.uuid)) wheelGroups.set(mat.uuid, { mat, geos: [] });
          wheelGroups.get(mat.uuid).geos.push(g);
          continue;
        }
        const g = norm(geo, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        const kind = kindOf(mat);
        const key = kind === 'tex' ? 'tex|' + mat.uuid : kind;
        if (!groups.has(key)) groups.set(key, { kind, mat, geos: [] });
        if (kind === 'plain') {
          const col = new THREE.Color().copy(mat.color || new THREE.Color(1, 1, 1));
          const n = g.attributes.position.count, ca = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
          g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
          const G = groups.get(key); G.metal = (G.metal || 0) + (mat.metalness ?? 0.2); G.rough = (G.rough || 0) + (mat.roughness ?? 0.6); G.n = (G.n || 0) + 1;
        }
        groups.get(key).geos.push(g);
      }
      yield;
    }
    // keep the biggest textured materials (four; up to sixteen on a vehicle in its own painted livery, a bus or a
    // hand-painted lorry, which is mostly texture); the rest join the vertex-coloured group
    const texd = [...groups.entries()].filter(([, G]) => G.kind === 'tex').sort((a, b) => tri(b[1]) - tri(a[1]));
    for (const [key, G] of texd.slice(groups.has('paint') ? 4 : 16)) {
      groups.delete(key);
      if (!groups.has('plain')) groups.set('plain', { kind: 'plain', mat: G.mat, geos: [], metal: 0, rough: 0, n: 0 });
      const P = groups.get('plain'), col = new THREE.Color().copy(G.mat.color || new THREE.Color(0.5, 0.5, 0.5)).multiplyScalar(0.6);
      for (const g of G.geos) {
        const n = g.attributes.position.count, ca = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
        g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        P.geos.push(g);
      }
      P.metal = (P.metal || 0) + (G.mat.metalness ?? 0.2); P.rough = (P.rough || 0) + (G.mat.roughness ?? 0.6); P.n = (P.n || 0) + 1;
    }
    const parts = [];
    const add = (geo, mat, opts = {}) => {
      const cap = max * (opts.wheel ? 4 : 1);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
      mesh.castShadow = lodName === 'lod0' && !opts.wheel && opts.kind !== 'glass'; mesh.receiveShadow = false;
      if (opts.color) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      scene.add(mesh);
      parts.push({ mesh, ...opts });
    };
    for (const G of groups.values()) {
      const geo = merge(G.geos);
      let mat;
      if (G.kind === 'paint') { mat = G.mat.clone(); mat.color = new THREE.Color(1, 1, 1); }
      else if (G.kind === 'plain') mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: G.metal / G.n, roughness: G.rough / G.n });
      else mat = G.mat;
      add(geo, mat, { kind: G.kind, color: G.kind === 'paint' || G.kind === 'head' || G.kind === 'tail' });
      yield;
    }
    for (const W of wheelGroups.values()) {
      add(merge(W.geos), W.mat, { kind: 'wheel', wheel: true });
      yield;
    }
    entry.lods.push(parts);
  }
  for (const id of ['FL', 'FR', 'RL', 'RR', 'F', 'R']) {  // (bikes: F / R on the centre line)
    const h = root0.getObjectByName('wheel_' + id);
    if (h) entry.hubs.push({ id, pos: h.position.clone(), front: id[0] === 'F', side: id[1] === 'R' ? -1 : 1 });
  }
  const hl = root0.getObjectByName('light_head_L')?.position, tl = root0.getObjectByName('light_tail_L')?.position;
  entry.bike = entry.hubs.some((h) => h.id === 'F' || h.id === 'R');
  entry.head = hl ? hl.clone() : new THREE.Vector3(0.7, 0.7, (man?.length || 4.6) / 2 - 0.1);
  entry.tail = tl ? tl.clone() : new THREE.Vector3(0.7, 0.8, -(man?.length || 4.6) / 2 + 0.1);
  if (entry.bike) { entry.head.set(0, 0.95, (man?.length || 2) / 2 - 0.1); entry.tail.set(0, 0.8, -(man?.length || 2) / 2 + 0.08); }
  entry.length = man?.length || 4.6;
  return entry;
};

const _hq = new THREE.Quaternion(), _hs = new THREE.Quaternion(), _hm = new THREE.Matrix4(), _hp = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0), _hc = new THREE.Color();
TrafficRenderer.prototype._placeImported = function (T, lod, n, carM, c, lightsOn) {
  for (const pt of T.lods[lod]) {
    if (pt.wheel) {
      T.hubs.forEach((h, k) => {
        _hq.setFromAxisAngle(_Y, h.front ? (c.steer || 0) : 0).multiply(_hs.setFromAxisAngle(_X, c.spin || 0));
        if (h.side !== (T.wheelSide || 1)) _hq.multiply(_hs.setFromAxisAngle(_Y, Math.PI)); // the other side's wheels are that one turned round
        _hm.compose(h.pos, _hq, _one).premultiply(carM);
        pt.mesh.setMatrixAt(n * 4 + k, _hm);
      });
      continue;
    }
    pt.mesh.setMatrixAt(n, carM);
    if (pt.kind === 'paint') pt.mesh.setColorAt(n, c.color);
    else if (pt.kind === 'head') pt.mesh.setColorAt(n, _hc.setScalar(lightsOn ? 1.6 : 0.8));
    else if (pt.kind === 'tail') pt.mesh.setColorAt(n, _hc.setRGB(lightsOn || c.brake ? 1 + c.brake * 2 : 0.6, lightsOn || c.brake ? 0.35 : 0.6, lightsOn || c.brake ? 0.3 : 0.6));
  }
};

const tri = (G) => G.geos.reduce((a, g) => a + g.attributes.position.count / 3, 0);

// a draw group of an indexed/non-indexed geometry as its own geometry
function sub(geo, gr) {
  const g = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(geo.attributes)) g.setAttribute(k, v);
  if (geo.index) g.setIndex(new THREE.BufferAttribute(geo.index.array.slice(gr.start, gr.start + gr.count), 1));
  else { g.setDrawRange(gr.start, gr.count); }
  return g;
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
