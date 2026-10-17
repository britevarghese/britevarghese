// Water: the river, Mirror Lake, the bog's pools and the trail puddles, as one surface over the world's water grid
// (every 2 m point that has a water level; the physics wades in the same water). Each point knows how deep the water
// is there (the level over the ground), which way it flows (down the river's slope) and whether it is muddy.
//
// Light goes into water and is absorbed, red first: shallow water is clear and shows the stones of its bed, deep
// water is dark green-blue, a pool of mud is opaque a few centimetres down, and the edge fades to nothing at the
// shore. The surface reflects the sky (the scene's environment map) as glass does, more at grazing angles, with the
// sun glinting in it. Ripples drift with the current (two phases of a flowing normal map, so they never stretch),
// and the river froths a little over its shallow riffles.
import * as THREE from 'three';
import { SURFACE } from '../physics/Surfaces.js';

/** A tileable picture of ripples: the normal's x and y, and the height. */
function rippleTexture(size = 256) {
  const h = new Float32Array(size * size);
  let s = 5;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // sum of waves on the tile's lattice (whole cycles across it, so it tiles), many directions
  const waves = [];
  for (let i = 0; i < 26; i++) {
    const a = R() * Math.PI * 2, f = Math.round(3 + R() * R() * 26);
    const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
    if (!kx && !ky) continue;
    waves.push([kx, ky, 1 / Math.hypot(kx, ky) ** 1.15, R() * Math.PI * 2]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, amp, ph] of waves) v += amp * Math.sin((kx * x + ky * y) / size * Math.PI * 2 + ph);
    h[y * size + x] = v;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) / (hi - lo) * 9, dy = (at(x, y + 1) - at(x, y - 1)) / (hi - lo) * 9;
    const l = Math.hypot(dx, dy, 1), o = (y * size + x) * 4;
    data[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    data[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round((h[y * size + x] - lo) / (hi - lo) * 255);
    data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function waterMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false });
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aDepth;
attribute vec2 aFlow;
attribute float aMud;
attribute float aFall;
varying float vDepth;
varying vec2 vFlow;
varying float vMud;
varying float vFall;
varying vec3 vWPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDepth = aDepth; vFlow = aFlow; vMud = aMud; vFall = aFall;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform sampler2D uRipple;
varying float vDepth;
varying vec2 vFlow;
varying float vMud;
varying float vFall;
varying vec3 vWPos;
float wA;
vec3 wN;
vec2 ripple(vec2 uv) { return texture2D(uRipple, uv).rg * 2.0 - 1.0; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float depth = max(vDepth, 0.0);
  float dist = length(vWPos - cameraPosition);
  // ripples carried by the current: two phases half a cycle apart, each faded out as it resets
  float t = uTime;
  float ph0 = fract(t * 0.3), ph1 = fract(t * 0.3 + 0.5);
  float wb = abs(ph0 - 0.5) * 2.0;
  vec2 drift = vec2(t * 0.012, t * 0.007);
  vec2 p0 = vWPos.xz - vFlow * ph0 * 3.0, p1 = vWPos.xz - vFlow * ph1 * 3.0 + vec2(3.7, 1.9);
  vec2 r0 = ripple(p0 * 0.11 + drift) + ripple(p0 * 0.37 - drift * 1.7) * 0.6;
  vec2 r1 = ripple(p1 * 0.11 + drift) + ripple(p1 * 0.37 - drift * 1.7) * 0.6;
  vec2 r = mix(r0, r1, wb);
  float calm = mix(0.35, 1.0, clamp(length(vFlow) * 0.7, 0.0, 1.0));
  float k = calm * clamp(1.0 - dist / 700.0, 0.2, 1.0) * (vMud > 0.5 ? 0.35 : 1.0);
  wN = normalize(vec3(-r.x * k * 0.55, 1.0, -r.y * k * 0.55));
  // light absorbed on the way down and back: clear in the shallows, dark green-blue deep, mud opaque
  vec3 absorb = mix(vec3(0.5, 0.14, 0.11), vec3(9.0, 11.0, 13.0), vMud);
  vec3 T = exp(-absorb * depth * 1.8);
  wA = clamp(1.0 - dot(T, vec3(0.3333)), 0.0, 1.0) * smoothstep(0.0, 0.06, depth);
  diffuseColor.rgb = mix(vec3(0.012, 0.05, 0.05), vec3(0.11, 0.08, 0.05), vMud);
  // froth over the shallow riffles of the river
  float speed = length(vFlow);
  float froth = smoothstep(0.32, 0.08, depth) * smoothstep(0.6, 1.6, speed) * smoothstep(0.55, 0.85, texture2D(uRipple, p0 * 0.5).b * 0.6 + texture2D(uRipple, p1 * 1.3).b * 0.4) * (1.0 - vMud);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85), froth);
  wA = max(wA, froth * 0.9 * smoothstep(0.0, 0.04, depth));
  // white water where the river falls steeply (a cascade): streaks racing down it, and between the foam, tongues of
  // glassy green water slipping over the rocks
  if (vFall > 0.0) {
    vec2 q = vWPos.xz - vFlow * fract(t * 0.9) * 4.0;
    float streak = texture2D(uRipple, q * 0.21).b * 0.6 + texture2D(uRipple, q * 0.63 + 0.37).b * 0.4;
    float tongue = smoothstep(0.35, 0.65, texture2D(uRipple, vWPos.xz * 0.043 + 0.21).b);
    float white = vFall * clamp(0.2 + smoothstep(0.25, 0.75, streak) * (0.45 + 0.55 * tongue), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.95), white);
    wA = max(wA, white * 0.96);
    wN = normalize(wN + vec3(r.x, 0.0, r.y) * vFall * 0.6);
  }
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', `
{
  // what is behind shows through what the water lets past; the reflection adds on top
  vec3 V = normalize(vViewPosition);
  float R = 0.02 + 0.98 * pow(1.0 - clamp(dot(normal, V), 0.0, 1.0), 5.0);
  vec3 diff = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 spec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  float a = 1.0 - (1.0 - wA) * (1.0 - R);
  gl_FragColor = vec4(diff * wA * (1.0 - R) + spec, a);
}`)
      .replace('#include <fog_fragment>', `#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogAmount());
#endif`);
  };
  return mat;
}

export class Water {
  constructor(world, scene) {
    this.uniforms = { uTime: { value: 0 }, uRipple: { value: rippleTexture() } };
    const d = world.data, N = d.waterN, res = d.waterRes, O = d.origin, W = d.water;
    const has = (i, k) => i >= 0 && k >= 0 && i < N && k < N && W[k * N + i] > -1e8;
    // vertices at the grid points with a water level, and quads where all four corners have one
    const index = new Int32Array(N * N).fill(-1);
    const pos = [], depth = [], flow = [], mud = [], fall = [], idx = [];
    const puddles = d.puddles.filter((p) => p.level !== undefined);
    // muddy water: the bog's pools and the puddles, and wherever the ground under the water is mud (paddy fields)
    const BOG = world.map.bog, cb = BOG ? Math.cos(BOG.rot) : 1, sb = BOG ? Math.sin(BOG.rot) : 0;
    const mudUnder = !BOG;
    for (let k = 0; k < N; k++) {
      for (let i = 0; i < N; i++) {
        if (!has(i, k)) continue;
        const x = O + i * res, z = O + k * res, level = W[k * N + i];
        index[k * N + i] = pos.length / 3;
        pos.push(x, level, z);
        depth.push(level - world.terrain(x, z));
        // downstream: down the slope of the water's surface, faster where it falls faster
        const lx = has(i + 1, k) && has(i - 1, k) ? (W[k * N + i + 1] - W[k * N + i - 1]) / (2 * res) : 0;
        const lz = has(i, k + 1) && has(i, k - 1) ? (W[(k + 1) * N + i] - W[(k - 1) * N + i]) / (2 * res) : 0;
        const g = Math.hypot(lx, lz), sp = g > 1e-4 ? Math.min(2.4, 0.5 + g * 220) / g : 0;
        flow.push(-lx * sp, -lz * sp);
        fall.push(Math.min(1, Math.max(0, (g - 0.06) / 0.18)));            // a steep fall: white water
        let muddy = puddles.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2);
        if (BOG) { const bx = x - BOG.x, bz = z - BOG.z, bu = (bx * cb - bz * sb) / BOG.rx, bv = (bx * sb + bz * cb) / BOG.rz; muddy ||= bu * bu + bv * bv < 0.7; }
        if (mudUnder && !muddy) muddy = world.surfaceId(x, z) === SURFACE.MUD;
        mud.push(muddy ? 1 : 0);
      }
    }
    for (let k = 0; k < N - 1; k++) {
      for (let i = 0; i < N - 1; i++) {
        const a = index[k * N + i], b = index[k * N + i + 1], c = index[(k + 1) * N + i], e = index[(k + 1) * N + i + 1];
        if (a < 0 || b < 0 || c < 0 || e < 0) continue;
        if (depth[a] < -0.3 && depth[b] < -0.3 && depth[c] < -0.3 && depth[e] < -0.3) continue;   // all on dry bank
        idx.push(a, c, b, b, c, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((v, j) => (j % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('aMud', new THREE.Float32BufferAttribute(mud, 1));
    g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    this.mesh = new THREE.Mesh(g, waterMaterial(this.uniforms));
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.group = this.mesh;
    // a map on the sea (world.map.sea): the open sea beyond the map's west edge to the horizon, and past its north and
    // south ends off the coast (the map's own water grid has it inside the map)
    if (world.map.sea) {
      const L = world.map.sea.level, E = -O, far = 9000, coast = world.map.sea.reach ?? -600;
      const sp = [], si = [];
      const quad = (x0, z0, x1, z1) => {
        const v = sp.length / 3;
        sp.push(x0, L, z0, x1, L, z0, x0, L, z1, x1, L, z1);
        si.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      };
      quad(-far, -far, -E + 2, far);
      quad(-E + 2, -far, coast, -E + 2);
      quad(-E + 2, E - 2, coast, far);
      const n = sp.length / 3, sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
      sg.setAttribute('aDepth', new THREE.Float32BufferAttribute(new Float32Array(n).fill(12), 1));
      sg.setAttribute('aFlow', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      sg.setAttribute('aMud', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      sg.setAttribute('aFall', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
      sg.setIndex(si);
      sg.computeBoundingSphere();
      this.sea = new THREE.Mesh(sg, this.mesh.material);
      this.sea.renderOrder = 2;
      this.sea.frustumCulled = false;
      scene.add(this.sea);
    }
  }

  update(camera, dt) {
    this.uniforms.uTime.value += dt;
  }
}

export async function preview(world, r) { const w = new Water(world, r.scene); w.update(r.camera, 0); return w; }
