// VehicleRenderer: instantiates a GLB vehicle, rigs four wheels (spin + steer + suspension travel),
// drives head/tail/brake lights, nitro flames, police light bars, customization and damage.
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';
import { radialGlow, lightPool, carPaintTexture, headlightTextures, taillightTextures, tireTread } from '../renderer/Textures.js';
import { clamp, lerp } from '../core/util.js';
import { CARS } from './VehicleCatalog.js';
import { Rider, SkinnedRider } from './Rider.js';

const glowRed = () => radialGlow('rgba(255,60,50,1)', 'rgba(255,20,20,0.3)');
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _pv = new THREE.Vector3(), _pp = new THREE.Vector3(), _ax = new THREE.Vector3(1, 0, 0), _az = new THREE.Vector3(0, 0, 1);
const WHEEL_IDX = { FL: 0, FR: 1, RL: 2, RR: 3, F: 0, R: 2 };
const glowWhite = () => radialGlow('rgba(255,250,235,1)', 'rgba(220,230,255,0.35)');

export class ModelLibrary {
  constructor(assets) { this.assets = assets; this.cars = {}; this.wheels = null; this.manifest = null; this.modelOf = {}; }
  // Which model backs a car: its imported real model (tools/import-cars.mjs), else — for a real car not
  // imported yet — its stand-in original model scaled to the real dimensions, else the car's own GLB.
  resolve(id) {
    const m = this.manifest?.cars?.[id];
    if (m?.imported) return { key: id, file: m.file, imported: true };
    const c = CARS[id];
    if (c?.standIn) return { key: c.standIn, file: `${c.standIn}.glb`, standIn: c.standIn };
    return { key: id, file: `${id}.glb` };
  }
  async load(ids, priority) {
    if (!this.manifest) this.manifest = await this.assets.loadJSON('/assets/models/manifest.json', 1);
    const jobs = [];
    if (!this.wheels) jobs.push(this.assets.loadGLTF('/assets/models/wheels.glb', priority).then((g) => { this.wheels = g.scene; }));
    // bikes need the rigged rider (tools/import-rider.mjs); without it they get the built-in figure
    if (!this.rider && !this._riderJob && this.manifest?.rider && ids.some((id) => CARS[id]?.bike)) {
      this._riderJob = this.assets.loadGLTF(`/assets/models/${this.manifest.rider.file}`, priority).then((g) => { this.rider = g.scene; }).catch(() => {});
    }
    if (this._riderJob && !this.rider) jobs.push(this._riderJob);
    for (const id of ids) {
      if (this.cars[id]) continue;
      const r = this.resolve(id);
      this.modelOf[id] = r;
      jobs.push(this.assets.loadGLTF(`/assets/models/${r.file}`, priority).then((g) => { this.cars[id] = g.scene; }).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  has(id) { return !!this.cars[id]; }
  isImported(id) { return !!this.manifest?.cars?.[id]?.imported; }
}

export class VehicleRenderer {
  // opts: {lod: 'full'|'auto', headlights: 0..2 spotlights, police: bool, shadow: bool}
  constructor(lib, carId, opts = {}) {
    this.lib = lib; this.carId = carId; this.opts = opts;
    this.group = new THREE.Group();
    this.group.name = 'vehicle_' + carId;
    this.body = new THREE.Group(); // sprung mass (pitch/roll/heave)
    this.group.add(this.body);
    const src = lib.cars[carId];
    if (!src) throw new Error(`ASSET LOAD ERROR: ${carId}.glb`);
    const res = lib.modelOf[carId] || lib.resolve(carId);
    this.modelId = res.key; this.imported = !!res.imported; this.standIn = res.standIn || null;
    this.bike = !!CARS[carId]?.bike;
    const lod0 = AssetManager.clone(src.getObjectByName('lod0'));
    const lod1 = src.getObjectByName('lod1') ? AssetManager.clone(src.getObjectByName('lod1')) : null;
    this.lod0 = lod0; this.lod1 = lod1;
    // stand-in: stretch the original model to the real car's length/width/height
    this.scaleV = new THREE.Vector3(1, 1, 1);
    const spec = CARS[carId]?.spec;
    if (this.standIn && spec) {
      // measure the body only: wing / scoop variants must not skew the scale
      const size = new THREE.Box3().setFromObject(lod0.getObjectByName('body') || lod0).getSize(new THREE.Vector3());
      this.scaleV.set(spec.wid / size.x, spec.hgt / size.y, spec.len / size.z);
      lod0.scale.copy(this.scaleV); lod1?.scale.copy(this.scaleV);
    }
    // per-vehicle materials (so paint/lights can differ)
    this.mats = {};
    const cloneMat = (m) => {
      if (!this.mats[m.name]) {
        const c = m.clone();
        this.mats[m.name] = c;
      }
      return this.mats[m.name];
    };
    for (const root of [lod0, lod1]) {
      if (!root) continue;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
        o.castShadow = !!opts.shadow; o.receiveShadow = false;
      });
    }
    this._tuneMaterials();
    this.body.add(lod0);
    if (lod1) { lod1.visible = false; this.body.add(lod1); }
    this.markers = {};
    // marker positions in body space (stand-ins are scaled, so store scaled copies)
    lod0.traverse((o) => { if (!o.isMesh && o.name && !this.markers[o.name]) this.markers[o.name] = this.standIn ? { name: o.name, position: o.position.clone().multiply(this.scaleV) } : o; });
    if (this.imported) this._rigImportedWheels(); else this._rigWheels();
    if (this.bike) this._rider();
    this._lights();
    this._shadowBlob();
    if (opts.police) this._policeLights();
    this.variants = {};
    lod0.traverse((o) => { const m = /^(spoiler|hood|bumper)_(\d)/.exec(o.name); if (m) (this.variants[m[1]] ||= []).push({ o, v: +m[2] }); });
    this.applyCustom({ spoiler: 0, hood: 0, bumper: 0 });
    this.brake = 0; this.night = 1; this.nitro = 0; this.lightsBroken = [false, false];
    this.damageApplied = 0;
    this.dentable = false;
  }

  _swapMaterial(from, to) {
    for (const root of [this.lod0, this.lod1]) root?.traverse((o) => { if (o.isMesh && o.material === from) o.material = to; });
    for (const [k, v] of Object.entries(this.mats)) if (v === from) this.mats[k] = to;
  }

  _tuneImported() {
    const m = this.mats;
    // paint gets a clearcoat (needs MeshPhysicalMaterial); remember the factory look for 'factory' paint
    if (m.paint && !m.paint.isMeshPhysicalMaterial) {
      const pm = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(pm, m.paint);
      pm.clearcoat = 0.9; pm.clearcoatRoughness = 0.05;
      this._swapMaterial(m.paint, pm);
    }
    if (m.paint) { m.paint.envMapIntensity = 1.2; this.factory = { color: m.paint.color.clone(), map: m.paint.map, metalness: m.paint.metalness, roughness: m.paint.roughness }; }
    if (m.glass) { m.glass.envMapIntensity = 2; m.glass.depthWrite = false; this.factoryGlass = m.glass.opacity; }
    for (const k of ['headlight', 'taillight']) {
      const mm = m[k];
      if (mm && mm.emissive && mm.emissive.getHex() === 0) mm.emissive.setHex(k === 'headlight' ? 0xfff2dc : 0xff1a0a);
    }
  }

  _tuneMaterials() {
    if (this.imported) { this._tuneImported(); return; }
    const m = this.mats;
    if (m.paint) { m.paint.envMapIntensity = 1.25; m.paint.clearcoat = 1; m.paint.clearcoatRoughness = 0.04; }
    if (m.glass) { m.glass.envMapIntensity = 2.2; m.glass.roughness = 0.02; m.glass.metalness = 0.55; m.glass.depthWrite = false; }
    if (m.chrome) m.chrome.envMapIntensity = 1.5;
    if (m.headlight) {
      const t = headlightTextures();
      m.headlight.map = t.map; m.headlight.emissiveMap = t.emissiveMap; m.headlight.color.set(0xffffff);
      m.headlight.emissiveIntensity = 2.5; m.headlight.roughness = 0.08; m.headlight.metalness = 0.5; m.headlight.envMapIntensity = 1.6;
    }
    if (m.taillight) {
      const t = taillightTextures();
      m.taillight.map = t.map; m.taillight.emissiveMap = t.emissiveMap; m.taillight.color.set(0xffffff);
      m.taillight.emissiveIntensity = 1.2; m.taillight.roughness = 0.1; m.taillight.envMapIntensity = 1.4;
    }
    if (m.lightbar_red) m.lightbar_red.emissiveIntensity = 0.2;
    if (m.lightbar_blue) m.lightbar_blue.emissiveIntensity = 0.2;
  }

  _rigWheels() {
    const W = this.lib.wheels;
    this.wheels = [];
    const rubber = W.getObjectByName('tire').material.clone();
    rubber.normalMap = tireTread(); rubber.normalScale = new THREE.Vector2(0.6, 0.6);
    this.rimMat = W.getObjectByName('rim_0').material.clone();
    this.rimMat.envMapIntensity = 1.4;
    this.caliperMat = W.getObjectByName('caliper').material.clone();
    const discMat = W.getObjectByName('brake_disc').material;
    for (const id of ['FL', 'FR', 'RL', 'RR']) {
      const mk = this.markers['wheel_' + id];
      if (!mk) continue;
      const man = { ...(this.lib.manifest?.cars?.[this.modelId]?.wheels?.find((w) => w.id === id) || { r: 0.34, w: 0.25 }) };
      if (this.standIn && CARS[this.carId]?.spec) { man.r = CARS[this.carId].spec.wr; man.w *= this.scaleV.x; }
      const side = mk.position.x >= 0 ? 1 : -1;
      const pivot = new THREE.Group(); // steering + suspension
      pivot.position.copy(mk.position);
      if (this.standIn) pivot.position.y = man.r; // sit the (resized) tyre on the ground
      const spin = new THREE.Group();
      const sx = (man.w / 0.25) * side, sr = man.r / 0.34;
      spin.scale.set(sx, sr, sr);
      const tire = new THREE.Mesh(W.getObjectByName('tire').geometry, rubber);
      const rim = new THREE.Mesh(W.getObjectByName('rim_0').geometry, this.rimMat);
      tire.castShadow = !!this.opts.shadow;
      spin.add(tire, rim);
      const fixed = new THREE.Group();
      fixed.scale.copy(spin.scale);
      if (this.opts.detailWheels !== false) {
        fixed.add(new THREE.Mesh(W.getObjectByName('brake_disc').geometry, discMat));
        fixed.add(new THREE.Mesh(W.getObjectByName('caliper').geometry, this.caliperMat));
      }
      pivot.add(spin, fixed);
      this.body.parent.add(pivot); // wheels live in the unsprung group (not pitched with body)
      this.wheels.push({ id, pivot, spin, rim, restY: pivot.position.y, front: id[0] === 'F', r: man.r });
    }
  }

  // imported models carry their own wheels: wheel_XX groups (hub-centred) with 'spin' and 'fixed'
  // (calipers) parts, in both LODs. Both LODs hang off one pivot; sync() toggles them.
  _rigImportedWheels() {
    this.wheels = [];
    this.rimMat = null;
    this.caliperMat = this.mats.caliper || null;
    const man = this.lib.manifest?.cars?.[this.carId];
    const move = (src, dst) => { if (src) for (const c of [...src.children]) dst.add(c); };
    for (const id of this.bike ? ['F', 'R'] : ['FL', 'FR', 'RL', 'RR']) {
      const n0 = this.lod0.getObjectByName('wheel_' + id);
      if (!n0) continue;
      const n1 = this.lod1?.children.find((c) => c.name === 'wheel_' + id || c.name.startsWith(`wheel_${id}_`));
      const pivot = new THREE.Group();
      pivot.position.copy(n0.position);
      const spin = new THREE.Group(), fixed = new THREE.Group();
      const s0 = new THREE.Group(), s1 = new THREE.Group(), f0 = new THREE.Group(), f1 = new THREE.Group();
      // GLTFLoader de-duplicates node names (spin, spin_1, ...): match the wheel's own children by prefix
      const part = (n, kind) => n.children.find((c) => c.name === kind || c.name.startsWith(kind + '_'));
      move(part(n0, 'spin'), s0); move(part(n0, 'fixed'), f0);
      if (n1) { move(part(n1, 'spin'), s1); move(part(n1, 'fixed'), f1); n1.removeFromParent(); }
      s1.visible = f1.visible = false;
      spin.add(s0, s1); fixed.add(f0, f1);
      n0.removeFromParent();
      pivot.add(spin, fixed);
      for (const g of [s0, f0]) g.traverse((o) => { if (o.isMesh) o.castShadow = !!this.opts.shadow; });
      (this.bike ? this.body : this.body.parent).add(pivot); // bike wheels lean and wheelie with the bike
      const r = man?.wheels?.find((w) => w.id === id)?.r || n0.position.y;
      this.wheels.push({ id, pivot, spin, rim: null, restY: n0.position.y, front: id[0] === 'F', r, lods: [[s0, f0], [s1, f1]] });
    }
  }

  // motorcycles carry a rider, posed onto this bike's seat / bars / pegs
  _rider() {
    const car = CARS[this.carId];
    const zF = this.wheels.find((w) => w.id === 'F')?.pivot.position.z ?? car.spec.wb / 2;
    const zR = this.wheels.find((w) => w.id === 'R')?.pivot.position.z ?? -car.spec.wb / 2;
    const bike = { zF, zR, seat: car.spec.seat ?? 0.82, style: car.style, rider: car.rider, accent: car.factoryColor };
    this.rider = this.lib.rider ? new SkinnedRider(bike, !!this.opts.shadow, this.lib.rider) : new Rider(bike, !!this.opts.shadow);
    this.body.add(this.rider.group);
    // the onboard camera sits in the rider's helmet
    this.markers.eye_cockpit = { name: 'eye_cockpit', position: this.rider.eye.clone() };
    this.riderOn = true;
  }
  setRider(on) { this.riderOn = on; if (this.rider) this.rider.group.visible = on; }

  _lights() {
    const M = this.markers;
    this.flares = [];
    const addFlare = (mk, tex, scale, color) => {
      if (!mk) return null;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.position.copy(mk.position); s.scale.setScalar(scale);
      this.body.add(s);
      return s;
    };
    this.headFlares = [addFlare(M.light_head_L, glowWhite(), 1.2, 0xfff4e0), addFlare(M.light_head_R, glowWhite(), 1.2, 0xfff4e0)].filter(Boolean);
    this.tailFlares = [addFlare(M.light_tail_L, glowRed(), 0.7, 0xff3020), addFlare(M.light_tail_R, glowRed(), 0.7, 0xff3020)].filter(Boolean);
    for (const f of this.tailFlares) f.position.z -= 0.05;
    for (const f of this.headFlares) f.position.z += 0.05;
    // fake headlight beam on the ground (cheap, works on every quality level)
    const beamMat = new THREE.MeshBasicMaterial({ map: lightPool(), color: 0xfff0d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.5, polygonOffset: true, polygonOffsetFactor: -6 });
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 30).rotateX(-Math.PI / 2).translate(0, 0.06, 17), beamMat);
    this.beam.renderOrder = 5;
    this.group.add(this.beam);
    // real spotlights (player only; count limited by quality)
    this.spots = [];
    const n = this.opts.headlights || 0;
    const hl = M.light_head_L?.position;
    if (n > 0 && hl) {
      const positions = n >= 2 ? [hl.clone(), hl.clone().setX(-hl.x)] : [hl.clone().setX(0)];
      for (const p of positions) {
        // physically based intensity (candela). Mounted a little higher with a narrow cone aimed down
        // the road, so it lights 5-45 m ahead without flooding the ground right at the bumper.
        const s = new THREE.SpotLight(0xfff0dc, n >= 2 ? 1250 : 2000, 80, 0.3, 0.6, 1.5);
        s.position.set(p.x * 0.8, p.y + 0.35, p.z - 0.3);
        s.target.position.set(p.x * 1.4, -0.9, p.z + 30);
        s.castShadow = false;
        this.body.add(s, s.target);
        this.spots.push(s);
      }
    }
    // nitro flames
    this.flames = [];
    const flameGeo = new THREE.ConeGeometry(0.09, 0.9, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.45);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    for (const [name, mk] of Object.entries(M)) {
      if (!name.startsWith('exhaust_')) continue;
      if (mk.position.z > 0) continue;
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.copy(mk.position); f.position.z -= 0.02;
      const core = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      core.scale.set(0.45, 0.45, 0.6);
      f.add(core);
      f.visible = false;
      this.body.add(f);
      this.flames.push(f);
    }
  }

  _shadowBlob() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.85)'); g.addColorStop(0.6, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    const real = CARS[this.carId]?.spec;
    const spec = real ? { length: real.len, width: real.wid } : this.lib.manifest?.cars?.[this.modelId] || { length: 4.5, width: 1.9 };
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(spec.width * 1.25, spec.length * 1.12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.8 }));
    this.blob.position.y = 0.03;
    this.blob.renderOrder = 1;
    this.group.add(this.blob);
  }

  _policeLights() {
    const lb = this.markers.lightbar;
    this.police = { t: Math.random() * 10, red: [], blue: [] };
    if (!lb) return;
    for (const [side, arr, color, tex] of [[1, this.police.red, 0xff2030, glowRed()], [-1, this.police.blue, 0x3060ff, radialGlow('rgba(80,120,255,1)', 'rgba(40,80,255,0.35)')]]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      s.position.copy(lb.position).add(new THREE.Vector3(side * 0.35, 0.02, 0));
      s.scale.setScalar(2.2);
      this.body.add(s);
      arr.push(s);
    }
    this.sirenOn = false;
  }

  // ------------------------------------------------------------------ customization
  applyCustom(c) {
    const m = this.mats;
    if (c.paint && m.paint) {
      const finish = c.finish || 'metallic';
      m.paint.metalness = { metallic: 0.6, gloss: 0.1, matte: 0.25, pearl: 0.45 }[finish];
      m.paint.roughness = { metallic: 0.3, gloss: 0.18, matte: 0.62, pearl: 0.25 }[finish];
      m.paint.clearcoat = finish === 'matte' ? 0 : 1;
      m.paint.sheen = finish === 'pearl' ? 1 : 0;
      if (finish === 'pearl') m.paint.sheenColor = new THREE.Color(c.paint2 || '#ffffff');
      // paint map = vinyl livery + panel shut lines/handles/window trim; grooves in the normal map
      const panels = this.lib.manifest?.cars?.[this.modelId]?.panels;
      const key = `${c.vinyl || 0}|${c.paint}|${c.paint2}`;
      if (this.imported) {
        // real models keep their own detail maps; 'factory' restores the original colour/finish
        const f = this.factory;
        if (c.paint === 'factory' && f) { m.paint.color.copy(f.color); m.paint.map = f.map; m.paint.metalness = f.metalness; m.paint.roughness = f.roughness; }
        else { m.paint.map = null; m.paint.color.set(c.paint); }
        m.paint.needsUpdate = true;
      } else if (key !== this._paintKey) {
        this._paintKey = key;
        if (!m.paint.map?.userData.shared) { m.paint.map?.dispose(); m.paint.normalMap?.dispose(); }
        const t = carPaintTexture(c.vinyl || 0, this._paintColor(c.paint), c.paint2 || '#111', panels, this.opts.sharedPaint ? `${this.modelId}|${key}` : null);
        m.paint.map = t.map; m.paint.normalMap = t.normalMap;
        m.paint.normalScale = new THREE.Vector2(0.35, 0.35);
      }
      if (!this.imported) { m.paint.color.set(c.vinyl ? 0xffffff : this._paintColor(c.paint)); m.paint.needsUpdate = true; }
    }
    if (c.tint !== undefined && m.glass) {
      if (this.imported) m.glass.opacity = 0.22 + c.tint * 0.6; // see-through glass shows the real interior
      else { m.glass.opacity = 0.9 + c.tint * 0.09; m.glass.color.setScalar(0.035 * (1 - c.tint * 0.7)); }
    }
    if (c.wheel !== undefined && this.wheels && !this.imported) {
      const W = this.lib.wheels;
      const geo = W.getObjectByName('rim_' + c.wheel)?.geometry;
      if (geo) for (const w of this.wheels) if (w.rim) w.rim.geometry = geo;
    }
    if (c.wheelColor && this.rimMat) this.rimMat.color.set(c.wheelColor);
    if (c.caliper && this.caliperMat) this.caliperMat.color.set(c.caliper);
    for (const [kind, list] of Object.entries(this.variants || {})) {
      const sel = c[kind] ?? 0;
      for (const { o, v } of list) o.visible = v === sel;
      // hood intake belongs to hood_1
      if (kind === 'hood') this.lod0.traverse((o) => { if (o.name === 'hood_1_intake') o.visible = sel === 1; });
    }
    this.custom = { ...(this.custom || {}), ...c };
  }

  _paintColor(p) { return p === 'factory' ? CARS[this.carId]?.factoryColor || '#b3121f' : p; }

  setTrafficLook(colorHex) { if (this.mats.paint) this.mats.paint.color.set(colorHex); }

  // ------------------------------------------------------------------ damage
  enableDents() {
    if (this.dentable) return;
    this.dentable = true;
    const body = this.lod0.getObjectByName('body');
    this.bodyParts = [];
    body?.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry = o.geometry.clone();
      // give each part its own position buffer so dents are per-vehicle
      o.geometry.setAttribute('position', o.geometry.attributes.position.clone());
      this.bodyParts.push({ mesh: o, orig: o.geometry.attributes.position.array.slice() });
    });
  }
  // local impact point (car space) and strength 0..1
  dent(localX, localZ, strength) {
    const R = 0.55 + strength * 0.4;
    const depth = 0.05 + strength * 0.12;
    for (const part of this.bodyParts || []) {
      const pos = part.mesh.geometry.attributes.position;
      let moved = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
        const d = Math.hypot(x - localX, z - localZ);
        if (d > R || y < 0.2) continue;
        const k = (1 - d / R) ** 2 * depth;
        const l = Math.hypot(x, z) || 1;
        const nx = x - x / l * k, nz = z - z / l * k;
        const ox = part.orig[i * 3], oz = part.orig[i * 3 + 2];
        if (Math.hypot(nx - ox, nz - oz) < 0.16) { pos.setXYZ(i, nx, y - k * 0.3, nz); moved = true; }
      }
      if (moved) { pos.needsUpdate = true; part.mesh.geometry.computeVertexNormals(); }
    }
    if (strength > 0.45 && localZ > 1.2) this.lightsBroken[localX > 0 ? 0 : 1] = true;
  }
  repair() {
    for (const part of this.bodyParts || []) {
      const pos = part.mesh.geometry.attributes.position;
      pos.array.set(part.orig); pos.needsUpdate = true; part.mesh.geometry.computeVertexNormals();
    }
    this.lightsBroken = [false, false];
    this.setDamageLook(0);
  }
  setDamageLook(d) {
    const m = this.mats;
    if (m.paint) { m.paint.clearcoat = lerp(this.custom?.finish === 'matte' ? 0 : 1, 0.2, d); m.paint.roughness = Math.max(m.paint.roughness, lerp(0.25, 0.6, d * 0.8)); }
    if (m.glass) m.glass.color.setRGB(lerp(0.04, 0.35, clamp(d - 0.5, 0, 1) * 2), lerp(0.05, 0.36, clamp(d - 0.5, 0, 1) * 2), lerp(0.06, 0.38, clamp(d - 0.5, 0, 1) * 2));
    this.damageApplied = d;
  }

  // ------------------------------------------------------------------ per-frame sync
  sync(s, dt, camPos, env) {
    const g = this.group;
    g.position.set(s.x, s.y, s.z);
    g.rotation.set(0, s.yaw, 0);
    if (this.bike) this._bikeBody(s);
    else {
      this.body.rotation.set(-s.pitch, 0, s.roll, 'YXZ');
      this.body.position.y = 0;
    }
    // wheels
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      // wheel follows the ground under it (suspension travel), body pitches/rolls above it
      if (!this.bike) w.pivot.position.y = w.restY + (s.wheelOff[WHEEL_IDX[w.id]] || 0);
      w.pivot.rotation.y = w.front ? (s.wheelSteer || 0) * (this.bike ? 0.6 : 1) : 0;
      w.spin.rotation.x = s.wheelSpin;
    }
    // distance LOD
    if (this.lod1 && camPos) {
      const d = Math.hypot(camPos.x - s.x, camPos.z - s.z);
      const far = d > (this.opts.lodDistance || 60);
      if (far !== this.isFar) {
        this.isFar = far; this.lod0.visible = !far; this.lod1.visible = far;
        for (const w of this.wheels) {
          w.pivot.visible = d < 250;
          if (w.lods) { for (const g of w.lods[0]) g.visible = !far; for (const g of w.lods[1]) g.visible = far; }
        }
      }
    }
    // lights
    const night = env?.night ?? 1;
    this.night = night;
    const hOn = night > 0.35 || (env?.rain > 0.5);
    const braking = s.brake > 0.1 && Math.abs(s.speed) > 0.5;
    this.brake = lerp(this.brake, braking ? 1 : 0, 0.4);
    const m = this.mats;
    if (m.headlight) m.headlight.emissiveIntensity = hOn ? 3.2 : 0.4;
    if (m.taillight) m.taillight.emissiveIntensity = (hOn ? 1.4 : 0.04) + this.brake * (hOn ? 4 : 1.6);
    // lamp flares: only when the lamp faces the viewer, sized by distance (no giant blobs up close)
    let facing = 1, dist = 20;
    if (camPos) {
      const dx = camPos.x - s.x, dz = camPos.z - s.z;
      dist = Math.hypot(dx, dz) || 1;
      facing = (dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw)) / dist; // +1 = camera in front of the car
    }
    const headK = clamp((facing - 0.05) / 0.6, 0, 1), tailK = clamp((-facing - 0.05) / 0.6, 0, 1);
    const fsize = clamp(0.25 + dist * 0.018, 0.25, 1.6);
    for (let i = 0; i < this.headFlares.length; i++) {
      const f = this.headFlares[i];
      f.visible = hOn && !this.lightsBroken[i] && headK > 0.01;
      f.material.opacity = headK * 0.95;
      f.scale.setScalar(fsize * 1.2);
    }
    for (const f of this.tailFlares) {
      const on = hOn || this.brake > 0.1;
      f.visible = on && tailK > 0.01;
      // in daylight a brake lamp reads as a lit lens, not a glowing halo
      f.material.opacity = tailK * (0.45 + this.brake * 0.55) * (hOn ? 1 : 0.3);
      f.scale.setScalar(fsize * (0.55 + this.brake * 0.4) * (hOn ? 1 : 0.6));
    }
    this.beam.visible = hOn && !(this.lightsBroken[0] && this.lightsBroken[1]);
    this.beam.material.opacity = (this.spots.length ? 0.18 : 0.5) * Math.min(1, night * 1.2) * (this.lightsBroken[0] || this.lightsBroken[1] ? 0.5 : 1);
    // seen from in front, the beams' specular glare off the asphalt blows the image out (real low beams
    // are cut off to protect oncoming drivers): dim the spotlights as the camera moves ahead of the car
    const glare = 1 - 0.7 * clamp((facing - 0.2) / 0.6, 0, 1);
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i];
      sp.visible = hOn && !this.lightsBroken[this.spots.length === 1 ? 0 : i];
      sp.userData.base ??= sp.intensity;
      sp.intensity = sp.userData.base * glare;
    }
    // nitro flames
    this.nitro = lerp(this.nitro, s.nitroActive ? 1 : 0, 0.3);
    for (const f of this.flames) {
      f.visible = this.nitro > 0.05;
      const flick = 0.7 + Math.random() * 0.6;
      f.scale.set(this.nitro * flick, this.nitro * flick, this.nitro * (0.8 + Math.random() * 0.8));
    }
    // blob shadow follows ground
    this.blob.position.y = 0.03 - (s.y - (s.groundY ?? s.y));
    this.blob.material.opacity = s.onGround ? 0.8 : clamp(0.8 - (s.y - (s.groundY ?? s.y)) * 0.3, 0.1, 0.8);
    // police light bar
    if (this.police) {
      const p = this.police;
      p.t += dt;
      const on = this.sirenOn;
      const phase = Math.floor(p.t * 7) % 4;
      const redOn = on && (phase === 0 || phase === 2), blueOn = on && (phase === 1 || phase === 3);
      if (m.lightbar_red) m.lightbar_red.emissiveIntensity = redOn ? 9 : 0.2;
      if (m.lightbar_blue) m.lightbar_blue.emissiveIntensity = blueOn ? 9 : 0.2;
      for (const sp of p.red) { sp.visible = redOn; sp.scale.setScalar(2.4 + Math.random() * 0.6); }
      for (const sp of p.blue) { sp.visible = blueOn; sp.scale.setScalar(2.4 + Math.random() * 0.6); }
      p.redOn = redOn; p.blueOn = blueOn;
    }
  }

  // bike attitude: lean about the tyre contact line, wheelie about the rear contact patch (stoppie about
  // the front); a riderless bike at rest leans over onto its side stand
  _bikeBody(s) {
    const parked = !this.riderOn && Math.abs(s.speed || 0) < 0.4;
    this.stand = lerp(this.stand || 0, parked ? 1 : 0, 0.15);
    const roll = lerp(s.roll, -0.2, this.stand);
    const pitch = s.pitch;
    const pz = pitch >= 0 ? (this.wheels.find((w) => w.id === 'R')?.pivot.position.z ?? -0.7) : (this.wheels.find((w) => w.id === 'F')?.pivot.position.z ?? 0.7);
    _qa.setFromAxisAngle(_az, roll);
    _qb.setFromAxisAngle(_ax, -pitch);
    // position = Rz * (P - Rx * P), P = pitch pivot on the ground
    _pv.set(0, 0, pz).applyQuaternion(_qb).multiplyScalar(-1).add(_pp.set(0, 0, pz)).applyQuaternion(_qa);
    this.body.position.copy(_pv);
    this.body.quaternion.copy(_qa).multiply(_qb);
    this.rider?.update(Math.abs(s.speed || 0) * 3.6);
  }

  dispose() {
    this.rider?.dispose();
    this.group.removeFromParent();
    for (const m of Object.values(this.mats)) {
      if (m.map && !m.map.userData.shared) m.map.dispose();
      if (m === this.mats.paint && m.normalMap && !m.normalMap.userData.shared) m.normalMap.dispose(); // per-instance paint grooves
      m.dispose();
    }
    for (const part of this.bodyParts || []) part.mesh.geometry.dispose();
  }
}
