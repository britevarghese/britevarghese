// Sky dome and the time of day: sun direction, sky / fog / light colours, clouds and stars.
//
// The clouds are a layer of cumulus over the valley: a tileable noise picture, made once, stretched over a plane a
// couple of kilometres up and drifting with the wind. Each point is lit by looking a little way toward the sun through
// the same noise (thick cloud in between: a shaded belly; thin: a bright edge, silver when the sun is behind it).
// Stars come out after dusk.
//
// The sky is also rendered (without the sun's disc) into an environment map: the light from the whole sky that
// every material picks up, and what the paint, glass and water reflect.
import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const frag = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunSize;
uniform float uDisc;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uCover;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uStars;
uniform float uLandOn;
uniform vec3 uLand;
varying vec3 vDir;

float cloudAt(vec2 p) {
  float n = texture2D(uNoise, p * 0.9).r * 0.55 + texture2D(uNoise, p * 2.3 + 0.37).r * 0.28 + texture2D(uNoise, p * 5.9 + 0.71).r * 0.17;
  return smoothstep(uCover, uCover + 0.32, n);
}
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, uGround, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, uSunSize) * 6.0 * uDisc + pow(s, 14.0) * 0.22 + pow(s, 3.0) * 0.07);
  // stars, fading in as the sky darkens
  if (uStars > 0.0 && h > 0.0) {
    vec3 q = d * 380.0;
    vec3 c = floor(q);
    float st = hash3(c);
    float tw = 0.75 + 0.25 * sin(uTime * 3.0 + st * 40.0);
    col += vec3(0.9, 0.93, 1.0) * smoothstep(0.9975, 1.0, st) * smoothstep(0.45, 0.2, length(fract(q) - 0.5)) * uStars * tw * smoothstep(0.0, 0.2, h);
  }
  // clouds: a layer 2 km up, out to the horizon
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.06) * 0.11 + vec2(uTime * 0.0021, uTime * 0.0007);
    float c = cloudAt(p);
    if (c > 0.0) {
      vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.035;
      float thick = cloudAt(p + toSun) * 0.6 + cloudAt(p + toSun * 2.2) * 0.4;
      float lit = clamp(1.15 - thick * 0.95, 0.0, 1.0);
      vec3 cc = mix(uCloudShade, uCloudLit, lit);
      // light through the thin edges toward the sun
      cc += uSunColor * pow(s, 6.0) * (1.0 - c) * 1.4;
      float fade = smoothstep(0.0, 0.12, h);
      col = mix(col, cc, c * fade * 0.96);
    }
  }
  // a soft band of haze along the horizon
  col = mix(col, uHorizon * 1.04, exp(-abs(h) * 18.0) * 0.35);
  // for reflections: the ring of wooded hills and mountains around the valley, hazy with distance
  if (uLandOn > 0.5 && h > -0.2) {
    float az = atan(d.z, d.x) / 6.2832;
    float ridge = 0.03 + 0.1 * texture2D(uNoise, vec2(az * 3.0, 0.31)).r + 0.05 * texture2D(uNoise, vec2(az * 11.0, 0.73)).r;
    float land = 1.0 - smoothstep(ridge - 0.008, ridge + 0.008, h);
    vec3 lc = mix(uLand, uHorizon * 0.7, smoothstep(0.0, ridge, h) * 0.25);
    col = mix(col, lc, land);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lerpColor = (a, b, t) => new THREE.Color().copy(a).lerp(b, t);
const C = (hex) => new THREE.Color(hex);

// key frames by sun elevation (deg): sky zenith, horizon, sun colour, sun intensity, hemisphere sky / ground, clouds
const KEYS = [
  { el: -8, zenith: C(0x0d1626), horizon: C(0x2a2f3c), sun: C(0xff6a3a), sunI: 0.0, hemiSky: C(0x4f5f86), hemiGround: C(0x23251f), hemiI: 0.62, cloudLit: C(0x3a4256), cloudShade: C(0x1c2130) },
  { el: 2, zenith: C(0x35507e), horizon: C(0xe4936a), sun: C(0xff7b3d), sunI: 1.1, hemiSky: C(0x8f8fa6), hemiGround: C(0x3a3027), hemiI: 0.5, cloudLit: C(0xffb07a), cloudShade: C(0x6a5a6e) },
  { el: 12, zenith: C(0x4a74b4), horizon: C(0xf0c38f), sun: C(0xffc58a), sunI: 2.4, hemiSky: C(0xb7c4d9), hemiGround: C(0x4a4232), hemiI: 0.7, cloudLit: C(0xfff0dc), cloudShade: C(0x8b8f9f) },
  { el: 30, zenith: C(0x3f78c4), horizon: C(0xc9daea), sun: C(0xfff0d6), sunI: 3.0, hemiSky: C(0xc5d6ee), hemiGround: C(0x52503a), hemiI: 0.8, cloudLit: C(0xffffff), cloudShade: C(0x9aa3b2) },
  { el: 70, zenith: C(0x3672c4), horizon: C(0xbfd5ec), sun: C(0xffffff), sunI: 3.2, hemiSky: C(0xcfe0f5), hemiGround: C(0x585640), hemiI: 0.85, cloudLit: C(0xffffff), cloudShade: C(0xa2abba) },
];

/** A tileable noise picture (value noise over a few octaves), for the clouds. */
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (n, seed) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return g;
  };
  const octaves = [[8, 0.5, 11], [16, 0.27, 23], [32, 0.15, 37], [64, 0.08, 51]].map(([n, a, seed]) => ({ n, a, g: lattice(n, seed) }));
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = (x / size) * o.n, fy = (y / size) * o.n;
        const i = Math.floor(fx), j = Math.floor(fy), tx = smooth(fx - i), ty = smooth(fy - j);
        const g = o.g, n = o.n, i1 = (i + 1) % n, j1 = (j + 1) % n;
        v += o.a * ((g[j * n + i] * (1 - tx) + g[j * n + i1] * tx) * (1 - ty) + (g[j1 * n + i] * (1 - tx) + g[j1 * n + i1] * tx) * ty);
      }
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(Math.min(1, v) * 255); data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 900 },
      uDisc: { value: 1 }, uNoise: { value: noiseTexture() }, uTime: { value: 0 }, uCover: { value: 0.47 },
      uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() }, uStars: { value: 0 },
      uLandOn: { value: 0 }, uLand: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.scale.setScalar(5000);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.sunDir = new THREE.Vector3();
    this.state = {};
    this.envDirty = true;
  }

  /** hour 0..24 -> sun position and colours. Sun rises in the east (+x), sets in the west, south (+z) at noon. */
  setTime(hour) {
    const t = (hour - 6) / 12;                                   // 0 at 6:00, 1 at 18:00
    const el = Math.sin(t * Math.PI) * 58 - 4;                  // degrees
    const az = t * Math.PI;                                     // east (+x) -> south (+z) -> west
    const elR = el * Math.PI / 180;
    this.sunDir.set(Math.cos(az) * Math.cos(elR), Math.sin(elR), Math.sin(az) * Math.cos(elR) * 0.6 + 0.2).normalize();
    // interpolate the keys by elevation
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) if (el >= KEYS[i].el && el <= KEYS[i + 1].el) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    if (el < KEYS[0].el) b = a;
    const k = b === a ? 0 : (el - a.el) / (b.el - a.el);
    const s = this.state;
    s.el = el;
    s.zenith = lerpColor(a.zenith, b.zenith, k);
    s.horizon = lerpColor(a.horizon, b.horizon, k);
    s.sun = lerpColor(a.sun, b.sun, k);
    s.sunI = a.sunI + (b.sunI - a.sunI) * k;
    s.hemiSky = lerpColor(a.hemiSky, b.hemiSky, k);
    s.hemiGround = lerpColor(a.hemiGround, b.hemiGround, k);
    s.hemiI = a.hemiI + (b.hemiI - a.hemiI) * k;
    s.fog = lerpColor(s.horizon, s.zenith, 0.18);
    const u = this.uniforms;
    u.uZenith.value.copy(s.zenith); u.uHorizon.value.copy(s.horizon); u.uGround.value.copy(s.fog).multiplyScalar(0.9);
    u.uSunDir.value.copy(this.sunDir); u.uSunColor.value.copy(s.sun).multiplyScalar(Math.max(0.15, s.sunI / 3));
    u.uCloudLit.value.copy(lerpColor(a.cloudLit, b.cloudLit, k));
    u.uCloudShade.value.copy(lerpColor(a.cloudShade, b.cloudShade, k));
    u.uStars.value = Math.min(1, Math.max(0, (-el - 1) / 6));
    this.envDirty = true;
    return s;
  }

  follow(camera) { this.mesh.position.copy(camera.position); }

  update(dt) { this.uniforms.uTime.value += dt; }

  /**
   * The light of the whole sky as an environment map (prefiltered for rough and shiny materials): the sky without
   * the sun's disc over a ground of the hemisphere's ground colour. Made again when the time of day changes.
   */
  environment(gl) {
    if (!this.envScene) {
      this.envScene = new THREE.Scene();
      this.envMesh = new THREE.Mesh(this.mesh.geometry, this.mesh.material);
      this.envMesh.scale.setScalar(100);
      this.envMesh.frustumCulled = false;
      this.envScene.add(this.envMesh);
      this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
      this.cubeCam = new THREE.CubeCamera(0.1, 1000, this.cubeRT);
      this.pmrem = new THREE.PMREMGenerator(gl);
    }
    const u = this.uniforms, ground = u.uGround.value.clone();
    u.uDisc.value = 0;
    u.uLandOn.value = 1;
    // the far hills: dark forest green seen through the haze, lit like the rest of the land
    u.uLand.value.setRGB(0.035, 0.048, 0.03).multiplyScalar(Math.max(0.05, this.state.sunI / 3)).lerp(this.state.fog, 0.12);
    u.uGround.value.copy(this.state.hemiGround).multiplyScalar(0.55);
    const tone = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;               // the sky shader tone-maps itself: keep the map linear
    this.cubeCam.update(gl, this.envScene);
    gl.toneMapping = tone;
    u.uDisc.value = 1;
    u.uLandOn.value = 0;
    u.uGround.value.copy(ground);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.envDirty = false;
    return this.envRT.texture;
  }
}
