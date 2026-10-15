// Particles thrown up by the tyres: clods of mud and dirt from spinning wheels, dust behind a truck on dry ground,
// spray in water, snow puffs. One pool of soft round points, drawn with additive-free alpha blending.
import * as THREE from 'three';
import { SURFACE } from '../physics/Surfaces.js';

const MAX = 2400;

const vert = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * (900.0 / max(0.5, -mvPosition.z));
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const frag = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c);
  if (d > 0.25) discard;
  float a = vAlpha * (1.0 - smoothstep(0.12, 0.25, d));
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const COLORS = {
  [SURFACE.MUD]: [0.16, 0.11, 0.07], [SURFACE.DIRT]: [0.3, 0.22, 0.14], [SURFACE.SAND]: [0.62, 0.52, 0.36],
  [SURFACE.GRAVEL]: [0.4, 0.37, 0.33], [SURFACE.GRASS]: [0.24, 0.3, 0.12], [SURFACE.SNOW]: [0.92, 0.94, 0.97],
  [SURFACE.RIVERBED]: [0.3, 0.27, 0.2], [SURFACE.ROCK]: [0.45, 0.43, 0.4], [SURFACE.ROAD]: [0.4, 0.37, 0.33],
};

export class Effects {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.a0 = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.next = 0;
    this.acc = new Map();
  }

  spawn(x, y, z, vx, vy, vz, size, life, color, alpha = 1, grow = 0, drag = 0.6, grav = 9.81) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
    this.color[i * 3] = color[0]; this.color[i * 3 + 1] = color[1]; this.color[i * 3 + 2] = color[2];
    this.a0[i] = alpha; this.alpha[i] = alpha;
  }

  /** Emit for one wheel of a truck this frame. w: physics wheel (or a remote's estimate). */
  wheel(key, w, dt, speed, hubX, hubY, hubZ, headX, headZ) {
    if (!w.contact) return;
    const s = w.surf?.id ?? SURFACE.GRASS;
    const col = COLORS[s] || COLORS[SURFACE.DIRT];
    const slip = w.slipSpeed || 0;
    const r = 0.4;
    let acc = this.acc.get(key) || 0;
    // thrown clods from a spinning tyre: off the back of the tread
    const loose = s === SURFACE.MUD || s === SURFACE.DIRT || s === SURFACE.SAND || s === SURFACE.SNOW || s === SURFACE.GRAVEL || s === SURFACE.GRASS || s === SURFACE.RIVERBED;
    if (loose && slip > 1.2) {
      acc += dt * Math.min(140, slip * (s === SURFACE.MUD ? 26 : 14));
      const dir = Math.sign(w.omega || 1);
      while (acc > 1) {
        acc -= 1;
        const v = Math.min(14, slip * 0.7) * (0.6 + Math.random() * 0.6);
        const sz = s === SURFACE.MUD ? 0.07 + Math.random() * 0.1 : s === SURFACE.SNOW ? 0.12 + Math.random() * 0.15 : 0.05 + Math.random() * 0.07;
        this.spawn(hubX - headX * r * 0.8 * dir + (Math.random() - 0.5) * 0.25, hubY - r * 0.6, hubZ - headZ * r * 0.8 * dir + (Math.random() - 0.5) * 0.25,
          -headX * v * dir + (Math.random() - 0.5) * 1.5, v * (0.45 + Math.random() * 0.6), -headZ * v * dir + (Math.random() - 0.5) * 1.5,
          sz, 0.6 + Math.random() * 0.6, col, 1, 0, 0.3, 9.81);
      }
    }
    // dust on dry ground at speed
    const dry = s === SURFACE.DIRT || s === SURFACE.GRAVEL || s === SURFACE.SAND || s === SURFACE.ROAD;
    if (dry && Math.abs(speed) > 4 && !(w.water > 0)) {
      acc += dt * Math.min(30, Math.abs(speed) * 0.9);
      while (acc > 1) {
        acc -= 1;
        const c = [col[0] * 1.4 + 0.12, col[1] * 1.4 + 0.1, col[2] * 1.4 + 0.08];
        this.spawn(hubX + (Math.random() - 0.5) * 0.6, hubY - r * 0.7, hubZ + (Math.random() - 0.5) * 0.6,
          (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2,
          0.5 + Math.random() * 0.5, 1.8 + Math.random() * 1.6, c, 0.22, 1.4, 1.2, -0.25);
      }
    }
    // water spray
    if (w.water > 0.05 && Math.abs(speed) > 1) {
      acc += dt * Math.min(120, Math.abs(speed) * 10);
      while (acc > 1) {
        acc -= 1;
        const v = Math.min(8, Math.abs(speed) * 0.7) * (0.5 + Math.random() * 0.7);
        this.spawn(hubX + (Math.random() - 0.5) * 0.4, hubY - r + w.water, hubZ + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * v * 0.8, v * (0.5 + Math.random() * 0.5), (Math.random() - 0.5) * v * 0.8,
          0.08 + Math.random() * 0.12, 0.7 + Math.random() * 0.5, [0.8, 0.86, 0.9], 0.75, 0.6, 0.4, 9.81);
      }
    }
    this.acc.set(key, acc);
  }

  /** A burst (a hard landing in water, a crash). */
  burst(x, y, z, n, color, speed = 4, size = 0.12) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, z, Math.cos(a) * v, speed * (0.5 + Math.random()), Math.sin(a) * v, size * (0.6 + Math.random()), 0.6 + Math.random() * 0.6, color, 0.85, 0.5, 0.4, 9.81);
    }
  }

  update(dt, ground) {
    const P = this.pos, Vv = this.vel;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      Vv[i * 3] *= k; Vv[i * 3 + 1] = Vv[i * 3 + 1] * k - this.grav[i] * dt; Vv[i * 3 + 2] *= k;
      P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5);
      // clods stop on the ground
      if (this.grav[i] > 1 && ground && (i & 3) === 0) {
        const h = ground.height(P[i * 3], P[i * 3 + 2]);
        if (P[i * 3 + 1] < h) { this.life[i] = Math.min(this.life[i], 0.25); P[i * 3 + 1] = h + 0.02; Vv[i * 3] = Vv[i * 3 + 1] = Vv[i * 3 + 2] = 0; }
      }
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
}

/** The winch line: a thin tube from the fairlead to the anchor, sagging when slack. */
export class Rope {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0x2b2b28, roughness: 0.6, metalness: 0.5 });
    this.mesh = null;
    this.scene = scene;
    this.pts = Array.from({ length: 14 }, () => new THREE.Vector3());
  }

  update(a, b, slack) {
    if (!a) { if (this.mesh) this.mesh.visible = false; return; }
    const n = this.pts.length;
    const d = a.distanceTo(b);
    const sag = Math.max(0, slack) * 0.5 + d * 0.004;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.pts[i].lerpVectors(a, b, t);
      this.pts[i].y -= sag * 4 * t * (1 - t);
    }
    const curve = new THREE.CatmullRomCurve3(this.pts);
    const g = new THREE.TubeGeometry(curve, 24, 0.012, 5, false);
    if (!this.mesh) { this.mesh = new THREE.Mesh(g, this.mat); this.mesh.castShadow = true; this.scene.add(this.mesh); } else { this.mesh.geometry.dispose(); this.mesh.geometry = g; }
    this.mesh.visible = true;
  }
}
