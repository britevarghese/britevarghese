// The rain falling round the camera: one mesh of streaks, drawn in one call, every drop's place worked out in the
// vertex shader from its seed and the clock. The drops hang in the world, not on the camera (each wraps round within a
// box about it as the camera moves, so a truck drives through them), fall at a heavy shower's speed, drift with the
// wind, and streak along their motion as the camera sees it: straight down standing still, slanting past a truck at
// speed. None within two metres of the camera (none in the cab), fewer the lighter the rain (WEATHER_UNIFORMS uRain).
import * as THREE from 'three';
import { WEATHER_UNIFORMS } from './Weather.js';

const COUNT = 9000;
const BOX = new THREE.Vector3(56, 30, 56);   // m: the box round the camera they fall in (wide, tall, deep)
const FALL = 8.5;                             // m/s: a raindrop of 2 to 3 mm falls at about 7 to 9
const LEN = 0.045;                            // s of its fall a streak shows (a camera's exposure, about)

const vert = /* glsl */`
attribute vec2 corner;
attribute vec4 seed;
uniform float uRain;
uniform float uRainT;
uniform vec3 uBox;
uniform vec3 uCam;
uniform vec3 uCamVel;
uniform vec2 uWind;
uniform float uFall;
uniform float uLen;
uniform float uViewH;
uniform float uShow;
varying float vA;
varying vec2 vUv;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = corner;
  // (the lighter the rain, the fewer drops: those with a seed over it never fall)
  float on = step(seed.w, uRain);
  vec3 v = vec3(uWind.x, -uFall * (0.85 + 0.3 * seed.y), uWind.y);
  // where it is: its place in a box that repeats through the world, the one about the camera
  vec3 p = seed.xyz * uBox + v * uRainT;
  p = uCam + mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  // streaked along its motion past the camera, as the camera sees it
  vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 rel = v - uCamVel;
  vec3 m = rel - dot(rel, camFwd) * camFwd;
  float ml = length(m);
  vec3 dir = ml > 0.01 ? m / ml : vec3(0.0, -1.0, 0.0);
  vec3 side = normalize(cross(camFwd, dir));
  float d = distance(p, uCam);
  // (a drop is a few mm across, its streak blurred a little wider; drawn no thinner than a pixel, and fainter for it,
  // as a thread finer than a pixel is seen: thinner than that it would break into dots. None near, fading in from 2 m)
  float px = 2.0 * d / (uViewH * projectionMatrix[1][1]);
  float w = max(0.005, 1.2 * px);
  vec3 wp = p + side * corner.x * w + dir * corner.y * ml * uLen;
  vA = uShow * on * pow(0.005 / w, 0.6) * smoothstep(2.0, 4.0, d) * (1.0 - smoothstep(0.35, 0.5, d / uBox.x));
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  if (vA <= 0.0) discard;
  // (thin and soft-edged across, its ends faded; clamped, as across a streak thinner than a pixel the place it's
  // shaded at can lie off its edge)
  float a = vA * clamp(1.0 - abs(vUv.x) * 2.0, 0.0, 1.0) * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0) * 0.5);
  #include <fog_fragment>
}`;

/** The rain about the camera, in the scene: update(dt, camera, sky colour, wind) each frame. */
export class Rain {
  constructor(scene) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('seed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = COUNT;
    this.uniforms = {
      ...WEATHER_UNIFORMS,
      uBox: { value: BOX.clone() }, uCam: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2(0.8, 0.3) }, uFall: { value: FALL }, uLen: { value: LEN },
      uColor: { value: new THREE.Color(0.75, 0.78, 0.82) }, uViewH: { value: 1080 }, uShow: { value: 1 },
      ...THREE.UniformsLib.fog,
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, transparent: true, depthWrite: false, fog: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    // (the height of what it's drawn into, in pixels: the screen, or the target the frame is drawn into first; and
    // none in the truck's reflections, render/Probe.js, drawn from the truck, not the camera the drops are round)
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = (r) => {
      const t = r.getRenderTarget();
      this.uniforms.uViewH.value = t ? t.height : r.getDrawingBufferSize(size).y;
      this.uniforms.uShow.value = t?.isWebGLCubeRenderTarget ? 0 : 1;
    };
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.last = null;
  }

  /** Each frame: the camera (its velocity reckoned from where it was), and the colour of the light the drops catch. */
  update(dt, camera, light) {
    const U = this.uniforms, on = WEATHER_UNIFORMS.uRain.value > 0.001;
    this.mesh.visible = on;
    const p = camera.getWorldPosition(this._p || (this._p = new THREE.Vector3()));
    // (a jump faster than any truck drives is a cut, to another view or a respawn: no motion at all)
    if (this.last && dt > 0) {
      U.uCamVel.value.subVectors(p, this.last).divideScalar(dt);
      if (U.uCamVel.value.lengthSq() > 80 * 80) U.uCamVel.value.set(0, 0, 0);
    }
    (this.last ||= new THREE.Vector3()).copy(p);
    U.uCam.value.copy(p);
    if (light) U.uColor.value.copy(light);
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.parent?.remove(this.mesh); }
}
