// The party modes in the world: the elimination zone's wall (a glowing curtain round the circle, brightest at its
// foot, its bands drifting up; red when you are outside it) and the king of the hill's ring (a band of light on the
// ground round the rise, and a beam up from it to find it by: gold free, green while you hold it, red contested).
import * as THREE from 'three';

const curtainVert = /* glsl */`
varying vec2 vUv;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const curtainFrag = /* glsl */`
uniform float uTime;
uniform vec3 uColor;
uniform float uFoot;      // the curtain's foot (world y), its glow strongest there
uniform float uAlpha;
varying vec2 vUv;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  // an even curtain the height of the hills: bands rising up it and fine streaks down it, brightest low down, fading
  // out at its top
  float up = vWorld.y - uFoot;
  float low = exp(-max(0.0, up) / 30.0);
  float hb = 0.5 + 0.5 * sin(up * 0.5 - uTime * 2.5);
  float lines = smoothstep(0.9, 1.0, fract(vUv.x * 420.0));
  float a = uAlpha * (0.42 + 0.3 * hb + 0.35 * lines) * (0.6 + 0.4 * low) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  gl_FragColor = vec4(uColor * (1.15 + 0.6 * low + 0.4 * lines), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class ModeView {
  constructor(scene, world) {
    this.world = world;
    this.t = 0;
    const mat = (color, alpha) => {
      const m = new THREE.ShaderMaterial({
        vertexShader: curtainVert, fragmentShader: curtainFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uFoot: { value: 0 }, uAlpha: { value: alpha } }]),
      });
      return m;
    };
    // the zone: an open cylinder of unit radius, 160 m tall
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 160, 128, 1, true), mat(0x2a9dff, 0.6));
    this.wall.frustumCulled = false;
    this.wall.renderOrder = 4;
    this.wall.visible = false;
    scene.add(this.wall);
    // the hill: a band on the ground (rebuilt round the rise's ground when shown) and a beam
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 90, 48, 1, true), mat(0xffc04a, 0.35));
    this.beam.frustumCulled = false;
    this.beam.renderOrder = 4;
    this.beam.visible = false;
    scene.add(this.beam);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.85, depthWrite: false });
    this.ring = null;
    this.scene = scene;
    this.hillFor = null;
  }

  /** run: the run in progress (a ZoneRun or a HillRun, else nothing to show); me: our truck's position. */
  update(run, me, dt) {
    this.t += dt;
    const zone = run?.event.kind === 'zone' && run.zone, hill = run?.event.kind === 'hill' && run.event.hill;
    this.wall.visible = !!zone && zone.r > 0.5;
    if (this.wall.visible) {
      const u = this.wall.material.uniforms, foot = this.world.terrain(zone.x, zone.z);
      this.wall.position.set(zone.x, foot + 50, zone.z);
      this.wall.scale.set(zone.r, 1, zone.r);
      u.uTime.value = this.t;
      u.uFoot.value = Math.min(foot, me.y) - 6;
      u.uColor.value.set(run.outside ? 0xff4a2a : 0x2a9dff);
      u.uAlpha.value = run.outside ? 0.8 : 0.6;
    }
    this.beam.visible = !!hill;
    if (this.ring) this.ring.visible = !!hill;
    if (hill) {
      if (this.hillFor !== hill) this.buildRing(hill);
      const color = run.contested ? 0xff5a3a : run.inside ? 0x7cc36a : 0xffc04a;
      this.ringMat.color.set(color);
      this.ringMat.opacity = 0.65 + 0.25 * Math.sin(this.t * 4);
      const u = this.beam.material.uniforms;
      this.beam.position.set(hill.x, hill.y + 40, hill.z);
      this.beam.scale.set(hill.r, 1, hill.r);
      u.uTime.value = this.t; u.uFoot.value = hill.y - 2; u.uColor.value.set(color);
    }
  }

  /** The hill's ring: a tube round it on the ground. */
  buildRing(hill) {
    if (this.ring) { this.scene.remove(this.ring); this.ring.geometry.dispose(); }
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2, x = hill.x + Math.cos(a) * hill.r, z = hill.z + Math.sin(a) * hill.r;
      pts.push(new THREE.Vector3(x, this.world.height(x, z) + 0.25, z));
    }
    this.ring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 128, 0.22, 6, true), this.ringMat);
    this.ring.renderOrder = 4;
    this.scene.add(this.ring);
    this.hillFor = hill;
  }
}
