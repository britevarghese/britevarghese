// Effects: pooled GPU-friendly particles (instanced camera-facing quads) for tire smoke, dust,
// sparks, rain splashes, engine smoke; plus a ring-buffer tire-mark mesh. No per-particle objects.
import * as THREE from 'three';
import { smokePuff, radialGlow, skidTex } from './Textures.js';
import { clamp } from '../core/util.js';

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

// Smoke uses age buckets (4 materials with decreasing opacity) so every particle fades without
// custom shaders — keeps the system compatible with both WebGL2 and WebGPU renderers.
class SmokePool {
  constructor(scene, max, color, blending = THREE.NormalBlending) {
    this.max = max;
    this.parts = [];
    this.buckets = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const ops = [0.3, 0.2, 0.12, 0.05];
    this.baseColor = new THREE.Color(color);
    this.mats = [];
    for (const o of ops) {
      const mat = new THREE.MeshBasicMaterial({ map: smokePuff(), color, transparent: true, opacity: o, depthWrite: false, blending, fog: true });
      this.mats.push(mat);
      const mesh = new THREE.InstancedMesh(geo, mat, max);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = 6;
      scene.add(mesh);
      this.buckets.push(mesh);
    }
  }
  emit(x, y, z, vx, vy, vz, size, life, grow = 2.5, tint = 1) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, size, life, age: 0, grow, rot: Math.random() * 6.28, tint });
  }
  update(dt, camera) {
    const counts = [0, 0, 0, 0];
    const q = camera.quaternion;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5; p.vy = p.vy * (1 - dt) + dt * 0.4;
      const t = p.age / p.life;
      const b = Math.min(3, Math.floor(t * 4));
      const mesh = this.buckets[b];
      if (counts[b] >= this.max) continue;
      const s = p.size * (1 + t * p.grow);
      _m.compose(_p.set(p.x, p.y, p.z), q, _s.set(s, s, s));
      mesh.setMatrixAt(counts[b], _m);
      mesh.setColorAt(counts[b], _c.setScalar(p.tint));
      counts[b]++;
    }
    this.buckets.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
  }
  get count() { return this.parts.length; }
  // unlit particles: match the scene's light level (bright grey smoke glowing at night looks fake)
  setLight(k) { for (const m of this.mats) m.color.copy(this.baseColor).multiplyScalar(k); }
}

// Additive sparks: color fades to black = invisible, single draw call.
class SparkPool {
  constructor(scene, max) {
    this.max = max; this.parts = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: radialGlow('rgba(255,240,200,1)', 'rgba(255,160,60,0.6)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life = 0.5, size = 0.12, color = 0xffc070) {
    if (this.parts.length >= this.max) this.parts.shift();
    this.parts.push({ x, y, z, vx, vy, vz, life, age: 0, size, color });
  }
  update(dt, camera) {
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }
      const k = 1 - p.age / p.life;
      _m.compose(_p.set(p.x, p.y, p.z), camera.quaternion, _s.set(p.size * (0.6 + k), p.size * (0.6 + k), 1));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c.setHex(p.color).multiplyScalar(k * 2.2));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Tire marks: a ring buffer of quads, extended while a wheel is sliding.
class SkidMarks {
  constructor(scene, maxQuads = 3000) {
    this.max = maxQuads;
    const pos = new Float32Array(maxQuads * 4 * 3);
    const uv = new Float32Array(maxQuads * 4 * 2);
    const col = new Float32Array(maxQuads * 4 * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let i = 0; i < maxQuads; i++) {
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshBasicMaterial({ map: skidTex(), vertexColors: true, transparent: true, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    mat.color.setRGB(0.02, 0.02, 0.02);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.next = 0;
    this.last = new Map(); // wheelKey -> {l:[x,y,z], r:[x,y,z]}
  }
  add(key, x, y, z, dirX, dirZ, width, intensity) {
    const nx = -dirZ * width / 2, nz = dirX * width / 2;
    const l = [x + nx, y, z + nz], r = [x - nx, y, z - nz];
    const prev = this.last.get(key);
    if (prev && Math.hypot(prev.l[0] - l[0], prev.l[2] - l[2]) < 4) {
      if (Math.hypot(prev.l[0] - l[0], prev.l[2] - l[2]) < 0.35) return;
      const i = this.next;
      const pos = this.mesh.geometry.attributes.position, col = this.mesh.geometry.attributes.color;
      pos.array.set([...prev.l, ...prev.r, ...l, ...r], i * 12);
      const a0 = prev.a, a1 = clamp(intensity, 0, 1) * 0.85;
      col.array.set([1, 1, 1, a0, 1, 1, 1, a0, 1, 1, 1, a1, 1, 1, 1, a1], i * 16);
      pos.needsUpdate = true; col.needsUpdate = true;
      pos.clearUpdateRanges?.(); col.clearUpdateRanges?.();
      this.next = (this.next + 1) % this.max;
      this.last.set(key, { l, r, a: a1 });
    } else this.last.set(key, { l, r, a: clamp(intensity, 0, 1) * 0.85 });
  }
  lift(key) { this.last.delete(key); }
}

export class Effects {
  constructor(scene, preset) {
    this.preset = preset;
    const k = preset.particles;
    this.smoke = new SmokePool(scene, Math.floor(260 * k) + 40, 0xd8dce0);
    this.dust = new SmokePool(scene, Math.floor(120 * k) + 20, 0x8a7a66);
    this.dark = new SmokePool(scene, Math.floor(80 * k) + 20, 0x202020);
    this.sparks = new SparkPool(scene, Math.floor(220 * k) + 30);
    this.splash = new SparkPool(scene, Math.floor(160 * k) + 20);
    this.skids = new SkidMarks(scene, Math.floor(2500 * Math.max(0.5, k)));
    this.scale = k;
  }

  // tire smoke / marks for a vehicle this frame
  vehicle(v, dt, env) {
    const s = v.state, p = v.p;
    const slide = s.drifting || (s.handbrake > 0 && Math.abs(s.speed) > 5) || v.physics.lastWheelspin > 0.25 || (s.brake > 0.8 && Math.abs(s.speed) > 20 && s.onGround);
    const intensity = s.drifting ? clamp(s.slip * 2, 0.3, 1) : v.physics.lastWheelspin > 0.25 ? v.physics.lastWheelspin : 0.5;
    const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
    const wet = env?.wetness || 0;
    const speed = Math.hypot(s.vx, s.vz);
    for (let i = 2; i < 4; i++) {
      const key = v.id + ':' + i;
      const [wx, wz] = v.physics.corners[i];
      if (slide && s.onGround && speed > 3) {
        const onRoad = s.y < 0.1;
        this.skids.add(key, wx, (v.physics.groundH[i] || 0) + 0.02, wz, sn, cs, 0.26, intensity * (1 - wet * 0.6));
        if (Math.random() < dt * 30 * this.scale) {
          const pool = onRoad ? this.smoke : this.dust;
          pool.emit(wx + (Math.random() - 0.5) * 0.3, 0.3, wz + (Math.random() - 0.5) * 0.3, -s.vx * 0.12 + (Math.random() - 0.5), 0.5 + Math.random() * 0.5, -s.vz * 0.12 + (Math.random() - 0.5), 0.7 + intensity * 0.6, 1.3 + intensity * 1.0, 2.3, wet > 0.5 ? 0.8 : 1);
        }
      } else this.skids.lift(key);
      // rain spray behind tires
      if (wet > 0.4 && speed > 12 && s.onGround && Math.random() < dt * 30 * this.scale) {
        this.smoke.emit(wx, 0.3, wz, -s.vx * 0.2, 0.8, -s.vz * 0.2, 0.6, 0.6, 3, 0.9);
      }
    }
    // damaged engine smoke
    if (s.damage > 0.55 && Math.random() < dt * 12 * this.scale) {
      this.dark.emit(s.x + sn * p.length * 0.35, s.y + 1.0, s.z + cs * p.length * 0.35, s.vx * 0.5, 1.5, s.vz * 0.5, 0.6, 2, 3, 1);
    }
  }

  impact(x, y, z, nx, nz, strength, vx = 0, vz = 0) {
    const n = Math.floor((6 + strength * 30) * this.scale) + 2;
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 8 * strength;
      this.sparks.emit(x, y, z, nx * sp + (Math.random() - 0.5) * 6 + vx * 0.3, 1 + Math.random() * 4, nz * sp + (Math.random() - 0.5) * 6 + vz * 0.3, 0.3 + Math.random() * 0.5);
    }
    if (strength > 0.3) this.dust.emit(x, y, z, nx, 0.6, nz, 1.2, 1.2, 2);
  }

  landing(x, y, z, strength) {
    for (let i = 0; i < 6 * this.scale + 2; i++) this.dust.emit(x + (Math.random() - 0.5) * 2, y + 0.2, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3, 1 + strength, 1.4, 2.5);
  }

  rainSplashes(dt, camPos, rain) {
    if (rain < 0.2) return;
    const n = Math.floor(dt * 160 * rain * this.scale);
    for (let i = 0; i < n; i++) {
      const x = camPos.x + (Math.random() - 0.5) * 30, z = camPos.z + (Math.random() - 0.5) * 30;
      this.splash.emit(x, 0.05, z, (Math.random() - 0.5) * 0.6, 0.8 + Math.random(), (Math.random() - 0.5) * 0.6, 0.18, 0.05, 0x8090a0);
    }
  }

  setLight(night) {
    const k = 1 - night * 0.62;
    this.smoke.setLight(k); this.dust.setLight(k); this.dark.setLight(1);
  }

  update(dt, camera) {
    this.smoke.update(dt, camera); this.dust.update(dt, camera); this.dark.update(dt, camera);
    this.sparks.update(dt, camera); this.splash.update(dt, camera);
  }
  get particleCount() { return this.smoke.count + this.dust.count + this.dark.count + this.sparks.parts.length + this.splash.parts.length; }
}
