// VehicleRenderer: instantiates a GLB vehicle, rigs four wheels (spin + steer + suspension travel),
// drives head/tail/brake lights, nitro flames, police light bars, customization and damage.
import * as THREE from 'three';
import { AssetManager } from '../assets/AssetManager.js';
import { radialGlow, lightPool, vinylTexture, tireTread } from '../renderer/Textures.js';
import { clamp, lerp } from '../core/util.js';

const glowRed = () => radialGlow('rgba(255,60,50,1)', 'rgba(255,20,20,0.3)');
const glowWhite = () => radialGlow('rgba(255,250,235,1)', 'rgba(220,230,255,0.35)');

export class ModelLibrary {
  constructor(assets) { this.assets = assets; this.cars = {}; this.wheels = null; this.manifest = null; }
  async load(ids, priority) {
    if (!this.manifest) this.manifest = await this.assets.loadJSON('/assets/models/manifest.json', 1);
    const jobs = [];
    if (!this.wheels) jobs.push(this.assets.loadGLTF('/assets/models/wheels.glb', priority).then((g) => { this.wheels = g.scene; }));
    for (const id of ids) {
      if (this.cars[id]) continue;
      jobs.push(this.assets.loadGLTF(`/assets/models/${id}.glb`, priority).then((g) => { this.cars[id] = g.scene; }).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  has(id) { return !!this.cars[id]; }
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
    const lod0 = AssetManager.clone(src.getObjectByName('lod0'));
    const lod1 = src.getObjectByName('lod1') ? AssetManager.clone(src.getObjectByName('lod1')) : null;
    this.lod0 = lod0; this.lod1 = lod1;
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
    lod0.traverse((o) => { if (!o.isMesh && o.name) this.markers[o.name] = o; });
    this._rigWheels();
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

  _tuneMaterials() {
    const m = this.mats;
    if (m.paint) { m.paint.envMapIntensity = 1.25; m.paint.clearcoat = 1; m.paint.clearcoatRoughness = 0.04; }
    if (m.glass) { m.glass.envMapIntensity = 1.6; m.glass.roughness = 0.02; m.glass.metalness = 0.4; m.glass.depthWrite = false; }
    if (m.chrome) m.chrome.envMapIntensity = 1.5;
    if (m.headlight) { m.headlight.emissiveIntensity = 2.5; m.headlight.toneMapped = true; }
    if (m.taillight) m.taillight.emissiveIntensity = 1.2;
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
      const man = this.lib.manifest?.cars?.[this.carId]?.wheels?.find((w) => w.id === id) || { r: 0.34, w: 0.25 };
      const side = mk.position.x >= 0 ? 1 : -1;
      const pivot = new THREE.Group(); // steering + suspension
      pivot.position.copy(mk.position);
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
      this.wheels.push({ id, pivot, spin, rim, restY: mk.position.y, front: id[0] === 'F', r: man.r });
    }
  }

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
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(7, 18).rotateX(-Math.PI / 2).translate(0, 0.06, 11.5), beamMat);
    this.beam.renderOrder = 5;
    this.group.add(this.beam);
    // real spotlights (player only; count limited by quality)
    this.spots = [];
    const n = this.opts.headlights || 0;
    const hl = M.light_head_L?.position;
    if (n > 0 && hl) {
      const positions = n >= 2 ? [hl.clone(), hl.clone().setX(-hl.x)] : [hl.clone().setX(0)];
      for (const p of positions) {
        const s = new THREE.SpotLight(0xfff2dc, n >= 2 ? 60 : 110, 70, 0.42, 0.55, 1.6);
        s.position.copy(p);
        s.target.position.set(p.x * 1.3, -0.4, p.z + 20);
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
    const spec = this.lib.manifest?.cars?.[this.carId] || { length: 4.5, width: 1.9 };
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
      if (c.vinyl) {
        m.paint.map?.dispose();
        m.paint.map = vinylTexture(c.vinyl, c.paint, c.paint2 || '#111');
        m.paint.color.set(0xffffff);
      } else {
        if (m.paint.map) { m.paint.map.dispose(); m.paint.map = null; }
        m.paint.color.set(c.paint);
      }
      m.paint.needsUpdate = true;
    }
    if (c.tint !== undefined && m.glass) { m.glass.opacity = 0.62 + c.tint * 0.35; m.glass.color.setScalar(0.06 * (1 - c.tint)); }
    if (c.wheel !== undefined && this.wheels) {
      const W = this.lib.wheels;
      const geo = W.getObjectByName('rim_' + c.wheel)?.geometry;
      if (geo) for (const w of this.wheels) w.rim.geometry = geo;
    }
    if (c.wheelColor) this.rimMat.color.set(c.wheelColor);
    if (c.caliper) this.caliperMat.color.set(c.caliper);
    for (const [kind, list] of Object.entries(this.variants || {})) {
      const sel = c[kind] ?? 0;
      for (const { o, v } of list) o.visible = v === sel;
      // hood intake belongs to hood_1
      if (kind === 'hood') this.lod0.traverse((o) => { if (o.name === 'hood_1_intake') o.visible = sel === 1; });
    }
    this.custom = { ...(this.custom || {}), ...c };
  }

  setTrafficLook(colorHex) { if (this.mats.paint) this.mats.paint.color.set(colorHex); }

  // ------------------------------------------------------------------ damage
  enableDents() {
    if (this.dentable) return;
    this.dentable = true;
    const body = this.lod0.getObjectByName('body');
    if (body) { body.geometry = body.geometry.clone(); this.bodyMesh = body; this.origPos = body.geometry.attributes.position.array.slice(); }
  }
  // local impact point (car space) and strength 0..1
  dent(localX, localZ, strength) {
    if (!this.bodyMesh) return;
    const pos = this.bodyMesh.geometry.attributes.position;
    const R = 0.55 + strength * 0.4;
    const depth = 0.05 + strength * 0.12;
    let moved = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      const d = Math.hypot(x - localX, z - localZ);
      if (d > R || y < 0.2) continue;
      const k = (1 - d / R) ** 2 * depth;
      // push towards the car's center line / along the impact normal, clamped vs. original
      const ox = this.origPos[i * 3], oz = this.origPos[i * 3 + 2];
      const nx = x - 0, nz = z - 0;
      const l = Math.hypot(nx, nz) || 1;
      const nxN = x - nx / l * k, nzN = z - nz / l * k;
      if (Math.hypot(nxN - ox, nzN - oz) < 0.16) { pos.setX(i, nxN); pos.setZ(i, nzN); pos.setY(i, y - k * 0.3); moved = true; }
    }
    if (moved) { pos.needsUpdate = true; this.bodyMesh.geometry.computeVertexNormals(); }
    // broken lights
    if (strength > 0.45) {
      const front = localZ > 1.2, rear = localZ < -1.2;
      if (front) this.lightsBroken[localX > 0 ? 0 : 1] = true;
      void rear;
    }
  }
  repair() {
    if (this.bodyMesh && this.origPos) { this.bodyMesh.geometry.attributes.position.array.set(this.origPos); this.bodyMesh.geometry.attributes.position.needsUpdate = true; this.bodyMesh.geometry.computeVertexNormals(); }
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
    this.body.rotation.set(-s.pitch, 0, s.roll, 'YXZ');
    this.body.position.y = 0;
    // wheels
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      const idx = { FL: 0, FR: 1, RL: 2, RR: 3 }[w.id];
      // wheel follows the ground under it (suspension travel), body pitches/rolls above it
      w.pivot.position.y = w.restY + (s.wheelOff[idx] || 0);
      w.pivot.rotation.y = w.front ? (s.wheelSteer || 0) : 0;
      w.spin.rotation.x = s.wheelSpin;
    }
    // distance LOD
    if (this.lod1 && camPos) {
      const d = Math.hypot(camPos.x - s.x, camPos.z - s.z);
      const far = d > (this.opts.lodDistance || 60);
      if (far !== this.isFar) {
        this.isFar = far; this.lod0.visible = !far; this.lod1.visible = far;
        for (const w of this.wheels) w.pivot.visible = d < 250;
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
    if (m.taillight) m.taillight.emissiveIntensity = (hOn ? 1.4 : 0.25) + this.brake * 4;
    for (let i = 0; i < this.headFlares.length; i++) {
      const f = this.headFlares[i];
      f.visible = hOn && !this.lightsBroken[i];
      f.material.opacity = 0.9;
    }
    for (const f of this.tailFlares) { f.visible = hOn || this.brake > 0.1; f.scale.setScalar(0.55 + this.brake * 0.55); f.material.opacity = 0.5 + this.brake * 0.5; }
    this.beam.visible = hOn && !(this.lightsBroken[0] && this.lightsBroken[1]);
    this.beam.material.opacity = 0.35 * Math.min(1, night * 1.2) * (this.lightsBroken[0] || this.lightsBroken[1] ? 0.5 : 1);
    for (let i = 0; i < this.spots.length; i++) this.spots[i].visible = hOn && !this.lightsBroken[this.spots.length === 1 ? 0 : i];
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

  dispose() {
    this.group.removeFromParent();
    for (const m of Object.values(this.mats)) { m.map?.dispose(); m.dispose(); }
    if (this.dentable && this.bodyMesh) this.bodyMesh.geometry.dispose();
  }
}
