// Sky dome and the time of day: sun direction, sky / fog / light colours.
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
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
  col = mix(col, uGround, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, uSunSize) * 6.0 + pow(s, 14.0) * 0.22 + pow(s, 3.0) * 0.07);
  // a soft band of haze along the horizon
  col = mix(col, uHorizon * 1.04, exp(-abs(h) * 18.0) * 0.35);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lerpColor = (a, b, t) => new THREE.Color().copy(a).lerp(b, t);
const C = (hex) => new THREE.Color(hex);

// key frames by sun elevation (deg): sky zenith, horizon, sun colour, sun intensity, hemisphere sky / ground
const KEYS = [
  { el: -8, zenith: C(0x0d1626), horizon: C(0x2a2f3c), sun: C(0xff6a3a), sunI: 0.0, hemiSky: C(0x3a4660), hemiGround: C(0x1b1d1a), hemiI: 0.35 },
  { el: 2, zenith: C(0x35507e), horizon: C(0xe4936a), sun: C(0xff7b3d), sunI: 1.1, hemiSky: C(0x8f8fa6), hemiGround: C(0x3a3027), hemiI: 0.5 },
  { el: 12, zenith: C(0x4a74b4), horizon: C(0xf0c38f), sun: C(0xffc58a), sunI: 2.4, hemiSky: C(0xb7c4d9), hemiGround: C(0x4a4232), hemiI: 0.7 },
  { el: 30, zenith: C(0x3f78c4), horizon: C(0xc9daea), sun: C(0xfff0d6), sunI: 3.0, hemiSky: C(0xc5d6ee), hemiGround: C(0x52503a), hemiI: 0.8 },
  { el: 70, zenith: C(0x3672c4), horizon: C(0xbfd5ec), sun: C(0xffffff), sunI: 3.2, hemiSky: C(0xcfe0f5), hemiGround: C(0x585640), hemiI: 0.85 },
];

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 900 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.scale.setScalar(5000);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.sunDir = new THREE.Vector3();
    this.state = {};
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
    return s;
  }

  follow(camera) { this.mesh.position.copy(camera.position); }
}
