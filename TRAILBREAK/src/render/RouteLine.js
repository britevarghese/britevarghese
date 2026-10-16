// The satnav's line on the ground: the route (game/Route.js) for the next stretch ahead of the truck, laid over the
// ground (and the water) as a glowing band of chevrons drifting the way to go, as in Forza. It fades in a few metres
// ahead and out at its far end.
import * as THREE from 'three';
import { along } from '../game/Route.js';

const STEP = 1.5, AHEAD = 170, MAXN = Math.ceil(AHEAD / STEP) + 2, WIDTH = 1.25;

const vert = /* glsl */`
attribute float aD;
attribute float aS;
varying float vD;
varying float vS;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vD = aD; vS = aS;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const frag = /* glsl */`
uniform float uTime;
uniform float uLen;
uniform vec3 uColor;
varying float vD;
varying float vS;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // chevrons pointing the way, drifting along it
  float c = fract((vD - abs(vS) * 0.55) / 2.2 - uTime * 0.7);
  float chev = smoothstep(0.0, 0.08, c) * (1.0 - smoothstep(0.38, 0.46, c));
  float edge = 1.0 - smoothstep(0.82, 1.0, abs(vS));
  float a = (0.28 + 0.62 * chev) * edge;
  a *= smoothstep(2.0, 8.0, vD) * (1.0 - smoothstep(uLen - 35.0, uLen, vD));
  gl_FragColor = vec4(uColor * (0.85 + 0.6 * chev), a * 0.85);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class RouteLine {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXN * 2 * 3);
    this.d = new Float32Array(MAXN * 2);
    this.s = new Float32Array(MAXN * 2);
    for (let i = 0; i < MAXN; i++) { this.s[i * 2] = -1; this.s[i * 2 + 1] = 1; }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aD', new THREE.BufferAttribute(this.d, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(this.s, 1));
    const idx = [];
    for (let i = 0; i < MAXN - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = { uTime: { value: 0 }, uLen: { value: AHEAD }, uColor: { value: new THREE.Color(0x3fb6ff) } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    });
    Object.assign(this.mat.uniforms, this.uniforms);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = g;
    this.hint = 0;
    this.last = null;
  }

  /** Lay the next stretch of `points` from `here` (or hide it with no route). */
  update(points, here, world, dt) {
    this.uniforms.uTime.value += dt;
    if (!points || points.length < 2) { this.mesh.visible = false; this.last = null; return; }
    // (rebuilt as the truck moves on, or when the route changes)
    if (this.last && this.last.points === points && Math.hypot(here.x - this.last.x, here.z - this.last.z) < 1.2) return;
    this.last = { points, x: here.x, z: here.z };
    const a = along(points, here.x, here.z, this.hint);
    this.hint = a.seg;
    // walk the route from the nearest point on it
    let k = a.seg, t = a.t, n = 0, dist = 0;
    const P = this.pos, D = this.d;
    let [ax, az] = points[k], [bx, bz] = points[Math.min(points.length - 1, k + 1)];
    let segLen = Math.hypot(bx - ax, bz - az), u = t * segLen;
    while (n < MAXN) {
      const x = ax + (bx - ax) * (segLen > 0 ? u / segLen : 0), z = az + (bz - az) * (segLen > 0 ? u / segLen : 0);
      const dx = segLen > 0 ? (bx - ax) / segLen : 1, dz = segLen > 0 ? (bz - az) / segLen : 0;
      const sx = dz * WIDTH * 0.5, sz = -dx * WIDTH * 0.5;
      for (const [o, side] of [[0, -1], [1, 1]]) {
        const px = x + sx * side, pz = z + sz * side;
        const ws = world.waterSurface ? world.waterSurface(px, pz) : -Infinity;
        P[(n * 2 + o) * 3] = px; P[(n * 2 + o) * 3 + 1] = Math.max(world.height(px, pz) + 0.09, ws > -1e8 ? ws + 0.05 : -Infinity); P[(n * 2 + o) * 3 + 2] = pz;
        D[n * 2 + o] = dist;
      }
      n++;
      if (dist >= AHEAD) break;
      // the next sample, STEP on (round the corners of the route)
      u += STEP; dist += STEP;
      while (u > segLen && k < points.length - 2) { u -= segLen; k++; [ax, az] = points[k]; [bx, bz] = points[k + 1]; segLen = Math.hypot(bx - ax, bz - az); }
      if (u > segLen) { if (n > 1 && u - segLen > STEP * 0.99) break; u = segLen; }
    }
    // (the rest collapse onto the last)
    for (let i = n; i < MAXN; i++) for (let o = 0; o < 2; o++) {
      P[(i * 2 + o) * 3] = P[((n - 1) * 2 + o) * 3]; P[(i * 2 + o) * 3 + 1] = P[((n - 1) * 2 + o) * 3 + 1]; P[(i * 2 + o) * 3 + 2] = P[((n - 1) * 2 + o) * 3 + 2];
      D[i * 2 + o] = D[(n - 1) * 2 + o];
    }
    this.uniforms.uLen.value = Math.max(10, dist);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aD.needsUpdate = true;
    this.mesh.visible = n > 2;
  }
}
