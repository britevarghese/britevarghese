// What the tyres and the hull throw up. A spinning tread flings clods and wet drops of mud along its tangent as it
// lifts off the ground (a rolling one in mud sheds some too), sand goes up in a spray of grains, dust rolls up behind
// a truck on dry ground. In water the tyres throw rooster tails off the tread and sheets out to the sides, a tyre
// driving in splashes, the nose pushes a bow wave up and out, and foam and ripple rings spread on the surface behind.
// Steam, smoke and broken glass go through here too.
//
// One pool of quads, drawn in one call: most face the camera, drops and spray are stretched along their motion,
// rings and foam lie flat on the water (on its surface as drawn: World.waterSurface). Lit by the sun and the sky:
// clods shaded as lumps (wet mud glints), spray and dust as soft volumes that glow when the sun is behind them.
import * as THREE from 'three';
import { HASH21 } from './ShaderHash.js';
import { SURFACE } from '../physics/Surfaces.js';

const MAX = 4000;
export const KIND = { PUFF: 0, CHUNK: 1, DROP: 2, MIST: 3, RING: 4, FOAM: 5, SHARD: 6, SPRAY: 7, FLAME: 8 };

const vert = /* glsl */`
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iCol;
attribute vec4 iMisc;
uniform float uStretch;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vSeed;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  float size = iMisc.x, kind = iMisc.y, rot = iMisc.z;
  vUv = corner; vCol = iCol; vKind = kind; vSeed = iMisc.w;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 wp;
  if (kind > 3.5 && kind < 5.5) {
    // rings and foam lie flat on the water
    float c = cos(rot), s = sin(rot);
    wp = iPos + (vec3(c, 0.0, s) * corner.x + vec3(s, 0.0, -c) * corner.y) * size;
  } else if ((kind > 1.5 && kind < 2.5) || kind > 6.5) {
    // a drop (or a clump of spray) streaks along its motion, as the camera sees it
    vec3 v = iVel - dot(iVel, camFwd) * camFwd;
    float sp = length(v);
    vec3 dir = sp > 0.05 ? v / sp : camUp;
    vec3 side = normalize(cross(camFwd, dir));
    float st = kind > 6.5 ? uStretch * 0.5 : uStretch;
    wp = iPos + side * corner.x * size + dir * corner.y * size * (1.0 + sp * st);
  } else {
    float c = cos(rot), s = sin(rot);
    vec2 q = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y);
    wp = iPos + (camRight * q.x + camUp * q.y) * size;
  }
  vWorld = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const frag = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec3 uGround;
varying vec2 vUv;
varying vec4 vCol;
varying float vKind;
varying float vSeed;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
${HASH21}
float h21(vec2 p) { return hash21(p); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUv;
  float r = length(p);
  vec3 col = vCol.rgb;
  float a = vCol.a;
  vec3 amb = mix(uGround, uSky, 0.62);
  vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vec3 viewDir = normalize(vWorld - cameraPosition);
  float behind = max(0.0, dot(viewDir, uSunDir));
  if (vKind > 0.5 && vKind < 1.5) {
    // a lump: an uneven outline (no one lobe stands out: three lobes read as a clover leaf), rough at its edge,
    // shaded as a rounded clod lit from the sun and grainy, as earth is; wet (dark) mud glints
    float ang = atan(p.y, p.x);
    float edge = 0.76 + 0.07 * sin(ang * 2.0 + vSeed * 6.3) + 0.05 * sin(ang * 3.0 + vSeed * 11.0) + 0.04 * sin(ang * 5.0 + vSeed * 17.0)
      + 0.03 * sin(ang * 7.0 + vSeed * 23.0) + (vnoise(p * 5.0 + vSeed * 13.0) - 0.5) * 0.12;
    if (r > edge) discard;
    vec2 q = p / edge;
    vec3 n = normalize(vec3(q * 0.95 + (vec2(vnoise(p * 6.0 + vSeed * 3.0), vnoise(p * 6.0 + vSeed * 5.0 + 9.0)) - 0.5) * 0.5, sqrt(max(0.04, 1.0 - dot(q, q)))));
    float dif = max(0.0, dot(n, sunV));
    float wet = 1.0 - smoothstep(0.12, 0.35, dot(col, vec3(0.333)));
    float spec = pow(max(0.0, dot(reflect(-sunV, n), vec3(0.0, 0.0, 1.0))), 22.0) * wet;
    col *= 0.78 + 0.44 * vnoise(p * 4.0 + vSeed * 7.0);
    col = col * (amb * 0.6 + uSunCol * dif * 0.6) + uSunCol * spec * 0.35;
    a *= smoothstep(edge, edge - 0.1, r);
  } else if (vKind > 1.5 && vKind < 2.5) {
    // a drop: soft across, rounded at the ends, a glint down its middle
    float across = abs(p.x), along = abs(p.y);
    float m = (1.0 - smoothstep(0.35, 1.0, across)) * (1.0 - smoothstep(0.5, 1.0, along));
    if (m < 0.02) discard;
    float g = (1.0 - across) * (1.0 - across);
    col = col * (amb * 0.8 + uSunCol * 0.42) + uSunCol * (0.2 * g + 0.25 * pow(behind, 6.0));
    a *= m;
  } else if (vKind < 0.5 || (vKind > 2.5 && vKind < 3.5)) {
    // dust, steam, smoke and spray mist: a soft volume, lit by the sky, the sun through it when it is behind
    // (thinning from the middle out, so that many seen one behind another, down a dusty track, still have soft edges)
    if (r > 1.0) discard;
    float m = 1.3 * exp(-r * r * 3.2) * (1.0 - smoothstep(0.45, 1.0, r));
    m *= 0.75 + 0.5 * vnoise(p * 2.2 + vSeed * 9.0);
    float mist = step(2.5, vKind);
    col = col * (amb * 0.85 + uSunCol * 0.3) + uSunCol * pow(behind, 5.0) * (0.18 + 0.3 * mist);
    a *= m;
  } else if (vKind > 3.5 && vKind < 4.5) {
    // a ripple ring spreading on the water: a thin rim catching a little more of the sky than the water round it,
    // broken (a bold white rim read as a ring painted on the water)
    if (r > 1.0) discard;
    float m = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.86))) * smoothstep(0.25, 0.6, vnoise(p * 5.0 + vSeed * 5.0));
    if (m < 0.02) discard;
    col = mix(col, uSky, 0.7) * 0.9 + uSunCol * 0.05;
    a *= m * 0.45;
  } else if (vKind > 4.5 && vKind < 5.5) {
    // foam: white, broken up into patches and bubbles, thinning at its edge
    if (r > 1.0) discard;
    float n = vnoise(p * 3.1 + vSeed * 7.0) * 0.6 + vnoise(p * 8.3 + vSeed * 3.0) * 0.4;
    float m = smoothstep(0.5, 0.7, n + (0.3 - r * 0.45)) * (1.0 - smoothstep(0.6, 1.0, r));
    if (m < 0.02) discard;
    col = col * (amb * 0.9 + uSunCol * 0.5);
    a *= m;
  } else if (vKind > 7.5) {
    // a flash of flame from the exhaust: alight by itself, white-hot at the core, orange out to a ragged edge
    if (r > 1.0) discard;
    float m = 1.0 - smoothstep(0.25 + 0.35 * vnoise(p * 3.0 + vSeed * 13.0), 1.0, r);
    if (m < 0.02) discard;
    col = mix(col, vec3(1.0, 0.92, 0.75), 0.8 * (1.0 - smoothstep(0.0, 0.45, r))) * 2.4;
    a *= m;
  } else if (vKind > 6.5) {
    // a clump of spray: a dense core breaking up at its edge, bright where the sun catches it
    if (r > 1.0) discard;
    float n = vnoise(p * 2.7 + vSeed * 11.0);
    float m = (1.0 - smoothstep(0.2 + 0.4 * n, 1.0, r)) * (0.8 + 0.4 * vnoise(p * 6.0 - vSeed * 5.0));
    if (m < 0.02) discard;
    col = col * (amb * 0.9 + uSunCol * 0.55) + uSunCol * pow(behind, 4.0) * 0.4;
    a *= min(1.0, m);
  } else {
    // broken glass: little cubes that catch the light
    float m = 1.0 - smoothstep(0.35, 0.9, max(abs(p.x), abs(p.y)));
    if (m < 0.02) discard;
    float glint = step(0.82, fract(sin(vSeed * 91.7 + vWorld.y * 3.0) * 43758.5));
    col = col * amb * 0.8 + uSunCol * (0.25 + 0.8 * glint);
    a *= m;
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const COLORS = {
  [SURFACE.MUD]: [0.15, 0.11, 0.075], [SURFACE.DIRT]: [0.3, 0.22, 0.14], [SURFACE.SAND]: [0.62, 0.52, 0.36],
  [SURFACE.GRAVEL]: [0.4, 0.37, 0.33], [SURFACE.GRASS]: [0.24, 0.3, 0.12], [SURFACE.SNOW]: [0.92, 0.94, 0.97],
  [SURFACE.RIVERBED]: [0.3, 0.27, 0.2], [SURFACE.ROCK]: [0.45, 0.43, 0.4], [SURFACE.ROAD]: [0.4, 0.37, 0.33],
  [SURFACE.TEA]: [0.14, 0.2, 0.07],
};
// what a spinning tread throws, per ground: clods a second per m/s of wheelspin (and per m/s of tread a rolling
// tyre sheds), the share that goes as wet drops, clod sizes (m) and the odd big one, a spray of grains, a haze
const LOOSE = {
  [SURFACE.MUD]: { clod: 55, roll: 5, drop: 0.35, size: [0.035, 0.09], big: 0.14, grain: 0, haze: 0, spray: 0.2 },
  [SURFACE.RIVERBED]: { clod: 18, roll: 0.6, drop: 0.35, size: [0.018, 0.04], big: 0, grain: 0, haze: 0 },
  [SURFACE.DIRT]: { clod: 18, roll: 0, drop: 0, size: [0.022, 0.05], big: 0.05, grain: 10, haze: 2.4 },
  [SURFACE.GRASS]: { clod: 14, roll: 0, drop: 0, size: [0.022, 0.05], big: 0.05, grain: 0, haze: 0 },
  [SURFACE.TEA]: { clod: 12, roll: 0, drop: 0, size: [0.022, 0.045], big: 0.03, grain: 0, haze: 0 },
  [SURFACE.GRAVEL]: { clod: 16, roll: 0, drop: 0, size: [0.014, 0.032], big: 0, grain: 8, haze: 1.6 },
  [SURFACE.SAND]: { clod: 1.5, roll: 0, drop: 0, size: [0.008, 0.016], big: 0, grain: 34, haze: 3 },   // (dry sand: grains, hardly a lump)
  [SURFACE.SNOW]: { clod: 16, roll: 1, drop: 0, size: [0.05, 0.11], big: 0.1, grain: 14, haze: 2.4 },
};
// how much spray a tyre lifts off each ground wet with rain at speed: most off a road's film of water, least off grass,
// whose blades hold it (none off mud, which throws its own, nor snow and sand, which soak it up)
const SPRAYS = {
  [SURFACE.ROAD]: 1, [SURFACE.ROCK]: 0.6, [SURFACE.GRAVEL]: 0.5, [SURFACE.DIRT]: 0.55, [SURFACE.RIVERBED]: 0.5,
  [SURFACE.ICE]: 0.5, [SURFACE.GRASS]: 0.3, [SURFACE.TEA]: 0.3,
};
const WATER = [0.8, 0.86, 0.9], MUDDY_WATER = [0.3, 0.23, 0.15];
const SPRAY = [0.86, 0.9, 0.93], MUDDY_SPRAY = [0.4, 0.33, 0.24];
const FOAM = [0.95, 0.96, 0.97], MUDDY_FOAM = [0.6, 0.52, 0.41];
const rnd = (a = 1) => (Math.random() * 2 - 1) * a;
const FLAME = [1.0, 0.48, 0.1], EXHAUST_SMOKE = [0.3, 0.3, 0.31];
const lerp = (a, b, t) => a + (b - a) * t;

export class Effects {
  constructor(scene) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));     // (unused: three wants one)
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.misc = new Float32Array(MAX * 4);           // size, kind, rotation, seed
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grow = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.spin = new Float32Array(MAX);
    this.a0 = new Float32Array(MAX);
    this.attr = {
      iPos: new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage),
      iVel: new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage),
      iCol: new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage),
      iMisc: new THREE.InstancedBufferAttribute(this.misc, 4).setUsage(THREE.DynamicDrawUsage),
    };
    for (const [k, a] of Object.entries(this.attr)) g.setAttribute(k, a);
    g.instanceCount = MAX;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.uniforms = {
      uStretch: { value: 0.09 },
      uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.75, 0.82, 0.92) },
      uGround: { value: new THREE.Color(0.32, 0.3, 0.24) },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    });
    Object.assign(mat.uniforms, this.uniforms);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.next = 0;
    this.live = 0;
    this.acc = new Map();
    this.hulls = new Map();
    this.colors = { ...COLORS };
    this.dustiness = 1;            // how much dust the map's dry ground raises (a wet map's little)
    this.wet = 0;                  // how wet the ground is with rain (core/Game.js wetK): the spray off the tyres
    this.ground = null;
  }

  /** A map's own colours of dust and mud thrown up from each ground (Kerala's red laterite; by surface id, the rest
   * the defaults). */
  setPalette(p = {}) { this.colors = { ...COLORS, ...p }; }

  /** The sun and the sky to light the particles by (render/Renderer.js). */
  setLight(sunDir, sunColor, sunIntensity, sky, ground, hemiIntensity) {
    const u = this.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.copy(sunColor).multiplyScalar(Math.min(1.1, sunIntensity / 2.8));
    u.uSky.value.copy(sky).multiplyScalar(Math.min(1.2, hemiIntensity * 1.15));
    u.uGround.value.copy(ground).multiplyScalar(Math.min(1.2, hemiIntensity * 1.15));
  }

  spawn(x, y, z, vx, vy, vz, size, life, color, alpha = 1, grow = 0, drag = 0.6, grav = 9.81, kind = grav > 1 ? KIND.CHUNK : KIND.PUFF) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = color[0]; this.col[i * 4 + 1] = color[1]; this.col[i * 4 + 2] = color[2]; this.col[i * 4 + 3] = alpha;
    this.misc[i * 4] = size; this.misc[i * 4 + 1] = kind; this.misc[i * 4 + 2] = Math.random() * 6.283; this.misc[i * 4 + 3] = Math.random();
    this.life[i] = life; this.maxLife[i] = life; this.grow[i] = grow; this.drag[i] = drag; this.grav[i] = grav;
    this.spin[i] = kind === KIND.CHUNK || kind === KIND.SHARD ? rnd(9) : kind === KIND.PUFF || kind === KIND.MIST ? rnd(0.6) : 0;
    this.a0[i] = alpha;
    return i;
  }

  /**
   * The water's surface at (x, z) as it is drawn (or the rain's in a hole in a rough track or in a track's ruts), or
   * -Infinity.
   */
  surface(x, z) {
    const g = this.ground;
    const w = !g ? -Infinity : g.waterSurface ? g.waterSurface(x, z) : g.water ? g.water(x, z) : -Infinity;
    return Math.max(w, g?.holeWater ? g.holeWater(x, z) : -Infinity, g?.rainWater ? g.rainWater(x, z) : -Infinity);
  }

  /** Something flat on the water at (x, z): a ripple ring or a patch of foam, spreading as it fades. */
  ring(x, z, size, grow, life, alpha = 0.5, foam = false, color = FOAM) {
    const wy = this.surface(x, z);
    if (!(wy > -1e8)) return -1;
    return this.spawn(x, wy + 0.02, z, 0, 0, 0, size, life, color, alpha, grow, 0, 0, foam ? KIND.FOAM : KIND.RING);
  }

  /** A drop of water (or of muddy water), streaking as it flies. */
  drop(x, y, z, vx, vy, vz, muddy, big = 1) {
    return this.spawn(x, y, z, vx, vy, vz, (0.022 + Math.random() * 0.03) * big, 0.8 + Math.random() * 0.6, muddy ? MUDDY_WATER : WATER, muddy ? 0.92 : 0.78, 0, 0.35, 9.81, KIND.DROP);
  }

  /** A clump of spray: the body of a splash, falling back with the drops. */
  spray(x, y, z, vx, vy, vz, muddy, size = 0.16) {
    return this.spawn(x, y, z, vx, vy, vz, size * (0.7 + Math.random() * 0.6), 0.7 + Math.random() * 0.5, muddy ? MUDDY_SPRAY : SPRAY, muddy ? 0.5 : 0.34, size * 0.8, 1.1, 7.5, KIND.SPRAY);
  }

  /** Fine spray hanging in the air after a splash. */
  mist(x, y, z, vx, vy, vz, muddy, size = 0.4) {
    return this.spawn(x, y, z, vx, vy, vz, size * (0.7 + Math.random() * 0.6), 0.6 + Math.random() * 0.5, muddy ? [0.45, 0.38, 0.3] : [0.88, 0.92, 0.95], muddy ? 0.28 : 0.22, 1.6, 1.5, 0.4, KIND.MIST);
  }

  /**
   * Emit for one wheel of a truck this frame. w: physics wheel (or a remote's estimate): contact, surf, slipSpeed,
   * omega, water (depth over the tyre's bottom). speed: the truck's speed along its heading (headX, headZ). r: tyre
   * radius.
   */
  wheel(key, w, dt, speed, hubX, hubY, hubZ, headX, headZ, r = 0.4) {
    let st = this.acc.get(key);
    if (!st) { st = { clod: 0, grain: 0, dust: 0, tail: 0, sheet: 0, wet: 0, plough: 0, mist: 0, fling: 0 }; this.acc.set(key, st); }
    if (!w.contact) { st.wet = 0; return; }
    const s = w.surf?.id ?? SURFACE.GRASS;
    const col = this.colors[s] || this.colors[SURFACE.DIRT];
    const slip = w.slipSpeed || 0;
    const tread = Math.abs((w.omega || 0) * r);                        // the tread's speed round the hub
    const dir = Math.sign(w.omega || speed || 1);
    const sideX = headZ, sideZ = -headX;
    const fx = headX * speed, fz = headZ * speed;                       // the hub's own motion
    const water = w.water || 0, inWater = water > 0.05, sp = Math.abs(speed);
    const L = LOOSE[s];
    // off the back of the tread as it lifts: clods (and from wet mud, drops) along its tangent, at its speed round
    // the hub on top of the truck's own. In water the tread throws water instead (below)
    if (L && water < 0.08) {
      const rate = slip > 0.5 ? slip * L.clod : 0;
      st.clod += dt * Math.min(240, rate + Math.max(0, tread - 2.5) * L.roll);
      while (st.clod > 1) {
        st.clod -= 1;
        const th = (slip > 0.5 ? 0.2 : 0.6) + Math.random() * 0.95;        // where it leaves: up the back of the tyre
        const v = Math.min(20, tread) * (0.6 + Math.random() * 0.45);
        const bx = hubX - headX * r * Math.sin(th) * dir + rnd(0.1), by = hubY - r * Math.cos(th), bz = hubZ - headZ * r * Math.sin(th) * dir + rnd(0.1);
        const ux = -headX * Math.cos(th) * dir, uy = Math.sin(th) * 0.9 + 0.2, uz = -headZ * Math.cos(th) * dir;
        const out = rnd(0.22) * v;
        if (L.spray && slip > 1.5 && Math.random() < L.spray) {
          // wet mud flung off in a sheet
          this.spawn(bx, by, bz, fx + ux * v + sideX * out, uy * v, fz + uz * v + sideZ * out, 0.07 + Math.random() * 0.08, 0.6 + Math.random() * 0.4,
            [col[0] * 1.2, col[1] * 1.15, col[2] * 1.1], 0.6, 0.12, 1.2, 8.5, KIND.SPRAY);
        } else if (Math.random() < L.drop) {
          const c = [col[0] * 0.75, col[1] * 0.72, col[2] * 0.7];
          this.spawn(bx, by, bz, fx + ux * v * 1.08 + sideX * out, uy * v * 1.08, fz + uz * v * 1.08 + sideZ * out,
            0.018 + Math.random() * 0.022, 0.8 + Math.random() * 0.5, c, 0.95, 0, 0.3, 9.81, KIND.DROP);
        } else {
          const big = Math.random() < L.big;
          const sz = big ? L.size[1] * (1.3 + Math.random() * 0.7) : lerp(L.size[0], L.size[1], Math.random() ** 1.6);
          // (off grass and tea, torn turf: the soil under it, the map's earth and damp, some of it with the grass still
          // on it; not lumps of green)
          const turf = s === SURFACE.GRASS || s === SURFACE.TEA, soil = this.colors[SURFACE.DIRT];
          const b = !turf ? col : Math.random() < 0.3 ? [lerp(soil[0], col[0], 0.35) * 0.6, lerp(soil[1], col[1], 0.35) * 0.6, lerp(soil[2], col[2], 0.35) * 0.6] : [soil[0] * 0.7, soil[1] * 0.68, soil[2] * 0.66];
          const k = 0.85 + Math.random() * 0.3, c = [b[0] * k, b[1] * k, b[2] * k];
          this.spawn(bx, by, bz, fx + ux * v * (big ? 0.8 : 1) + sideX * out, uy * v * (big ? 0.8 : 1), fz + uz * v * (big ? 0.8 : 1) + sideZ * out,
            sz, 1 + Math.random() * 0.8, c, 1, 0, 0.25, 9.81, KIND.CHUNK);
        }
      }
      // sand, dry dirt, gravel and snow: a spray of grains with the clods, and a haze where the tyre digs
      if (L.grain && slip > 0.8) {
        st.grain += dt * Math.min(200, slip * L.grain);
        const c = [col[0] * 1.1, col[1] * 1.1, col[2] * 1.1];
        while (st.grain > 1) {
          st.grain -= 1;
          const th = 0.15 + Math.random() * 0.8, v = Math.min(20, tread) * (0.5 + Math.random() * 0.6);
          this.spawn(hubX - headX * r * Math.sin(th) * dir + rnd(0.12), hubY - r * Math.cos(th), hubZ - headZ * r * Math.sin(th) * dir + rnd(0.12),
            fx - headX * Math.cos(th) * dir * v + sideX * rnd(0.3) * v, (Math.sin(th) * 0.8 + 0.25) * v, fz - headZ * Math.cos(th) * dir * v + sideZ * rnd(0.3) * v,
            0.01 + Math.random() * 0.012, 0.6 + Math.random() * 0.4, c, 0.85, 0, 0.5, 9.81, KIND.DROP);
        }
      }
      if (L.haze && slip > 0.8 && Math.random() < dt * slip * L.haze) {
        const c = s === SURFACE.SNOW ? [0.95, 0.96, 0.98] : [col[0] * 1.3 + 0.1, col[1] * 1.3 + 0.08, col[2] * 1.3 + 0.06];
        this.spawn(hubX - headX * r * dir, hubY - r * 0.6, hubZ - headZ * r * dir, fx * 0.3 - headX * dir * 2 + rnd(0.8), 0.6 + Math.random(), fz * 0.3 - headZ * dir * 2 + rnd(0.8),
          0.3 + Math.random() * 0.35, 1.5 + Math.random(), c, s === SURFACE.SNOW ? 0.3 : 0.18, 1, 1.1, -0.2, KIND.PUFF);
      }
    }
    // a tyre sunk deep in mud: the mud it ploughs into shoved out ahead of it and to the sides in lumps, and the muddy
    // water standing in its rut (render/Terrain.js wetAt: in any rut deeper than 5 cm) splashed out sideways and ahead
    const sink = w.sink || 0;
    if (s === SURFACE.MUD && !inWater && sink > 0.06 && sp > 1) {
      const deep = Math.min(1, (sink - 0.05) / 0.15), gy = hubY - r + sink * 0.6;
      st.plough += dt * Math.min(60, sp * deep * 14);
      while (st.plough > 1) {
        st.plough -= 1;
        const out = Math.random() < 0.5 ? -1 : 1, v = sp * (0.25 + Math.random() * 0.3);
        const k = 0.85 + Math.random() * 0.3, c = [col[0] * k, col[1] * k, col[2] * k];
        this.spawn(hubX + headX * r * 0.7 * dir + sideX * out * 0.12 + rnd(0.06), gy, hubZ + headZ * r * 0.7 * dir + sideZ * out * 0.12 + rnd(0.06),
          fx * 0.55 + sideX * out * v * 0.6 + rnd(0.3), 0.6 + Math.random() * 1.2 * deep, fz * 0.55 + sideZ * out * v * 0.6 + rnd(0.3),
          lerp(L.size[0], L.size[1], Math.random()) * 1.2, 0.8 + Math.random() * 0.6, c, 1, 0, 0.3, 9.81, KIND.CHUNK);
      }
      st.sheet += dt * Math.min(80, sp * sp * deep * 2.2);
      while (st.sheet > 1) {
        st.sheet -= 1;
        const out = Math.random() < 0.5 ? -1 : 1, v = Math.min(8, sp * 0.6) * (0.4 + Math.random() * 0.6);
        const x = hubX + sideX * out * 0.15 + headX * r * 0.5 * dir + rnd(0.08), z = hubZ + sideZ * out * 0.15 + headZ * r * 0.5 * dir + rnd(0.08);
        const vx = fx * 0.6 + sideX * out * v + rnd(0.4), vy = v * (0.45 + Math.random() * 0.6), vz = fz * 0.6 + sideZ * out * v + rnd(0.4);
        // (the colour of this mud's water, the map's: the taiga's dark peat, the coast's red; brown, not lit to grey)
        if (Math.random() < 0.15) this.spawn(x, gy, z, vx, vy * 0.9, vz, (0.1 + deep * 0.12) * (0.7 + Math.random() * 0.6), 0.7 + Math.random() * 0.5, [col[0] * 1.3, col[1] * 1.2, col[2] * 1.1], 0.5, 0.1, 1.1, 7.5, KIND.SPRAY);
        else this.spawn(x, gy, z, vx, vy, vz, 0.022 + Math.random() * 0.03, 0.8 + Math.random() * 0.6, [col[0] * 1.5, col[1] * 1.5, col[2] * 1.5], 0.92, 0, 0.35, 9.81, KIND.DROP);
      }
    }
    // dust rolling up behind on dry ground at speed: a plume that thickens the faster the truck goes, billowing up
    // and hanging in the air behind it for seconds (most from the rear wheels, which drive through the front's; a wet
    // map's earth, the taiga's, raises little: dustiness). It used to be a few faint puffs, gone at a glance.
    const dry = s === SURFACE.DIRT || s === SURFACE.GRAVEL || s === SURFACE.SAND || s === SURFACE.ROAD;
    if (dry && sp > 3 && !inWater && this.dustiness > 0) {
      const thick = Math.min(1, (sp - 3) / 14) * this.dustiness * (s === SURFACE.ROAD ? 0.35 : s === SURFACE.GRAVEL ? 0.7 : 1);
      const rear = (w.index ?? 2) >= 2 ? 1 : 0.45;
      st.dust += dt * 30 * thick * rear;
      while (st.dust > 1) {
        st.dust -= 1;
        const c = [col[0] * 1.4 + 0.12, col[1] * 1.4 + 0.1, col[2] * 1.4 + 0.08];
        const out = rnd(1.4);                                             // (drifting out over the verges)
        this.spawn(hubX + rnd(0.45) - headX * r, hubY - r * 0.6, hubZ + rnd(0.45) - headZ * r,
          fx * 0.3 + sideX * out + rnd(0.5), 0.4 + Math.random() * 1.1, fz * 0.3 + sideZ * out + rnd(0.5),
          0.7 + Math.random() * 0.6, 2.6 + Math.random() * 2.4, c, 0.07 + 0.08 * thick, 1.25, 1.1, -0.18, KIND.PUFF);
      }
    }
    // wet ground at speed (this.wet: how wet it is, core/Game.js wetK): the tread lifts the water off it, a fine spray
    // hanging low behind each tyre, thickest off a road's film of water and brown off bare earth; and drops of it flung
    // off the tread as it lifts (not in mud, which throws its own)
    const sprays = SPRAYS[s] || 0;
    if (this.wet > 0.05 && sprays > 0 && !inWater && sp > 5) {
      const k = this.wet * sprays * Math.min(1, (sp - 5) / 15), muddy = s === SURFACE.DIRT || s === SURFACE.RIVERBED;
      const rear = (w.index ?? 2) >= 2 ? 1 : 0.6;
      st.mist += dt * 30 * k * rear;
      while (st.mist > 1) {
        st.mist -= 1;
        // (carried along in the truck's wake a moment, then hanging where it was lifted, low over the ground and rising
        // as it spreads, so that it is never cut off flat where it would reach down into the road)
        const c = Math.random() * 0.25 + 0.6;
        this.spawn(hubX - headX * r * dir + rnd(0.15), hubY - r * (0.35 + Math.random() * 0.15), hubZ - headZ * r * dir + rnd(0.15),
          fx * c + sideX * rnd(0.6), 0.5 + Math.random() * 0.5, fz * c + sideZ * rnd(0.6), 0.12 + Math.random() * 0.1, 0.4 + Math.random() * 0.35,
          muddy ? [0.45, 0.38, 0.3] : [0.88, 0.92, 0.95], muddy ? 0.09 : 0.07, 1, 2, -0.2, KIND.MIST);
      }
      // (the drops leave the tread low at the back of the contact patch, most of them caught by the wheel arch)
      st.fling += dt * Math.min(12, Math.max(0, tread - 3) * k);
      while (st.fling > 1) {
        st.fling -= 1;
        const th = 0.1 + Math.random() * 0.35, v = Math.min(12, tread) * (0.3 + Math.random() * 0.3);
        this.drop(hubX - headX * r * Math.sin(th) * dir + rnd(0.1), hubY - r * Math.cos(th), hubZ - headZ * r * Math.sin(th) * dir + rnd(0.1),
          fx - headX * Math.cos(th) * dir * v + sideX * rnd(0.25) * v, (Math.sin(th) * 0.9 + 0.2) * v, fz - headZ * Math.cos(th) * dir * v + sideZ * rnd(0.25) * v, muddy, 0.5);
      }
    }
    if (inWater) {
      // (water over mud is brown, and the rain in a hole in a track or in its ruts, stirred up with the earth under it)
      const muddy = s === SURFACE.MUD || this.ground?.holeWater?.(hubX, hubZ) > -1e8 || this.ground?.rainWater?.(hubX, hubZ) > -1e8;
      // (a puddle, not a lake or a river: its rings and foam no wider than it, a rut's or a hole's)
      const pool = !(this.ground?.water?.(hubX, hubZ) > -1e8) ? 0.3 : 1;
      const depth = Math.min(water, r * 1.2);
      const wy = hubY - r + water;                                         // the water's surface here
      // driving into the water: the tyre splashes it up round itself
      if (st.wet < 0.05 && sp > 1.8) {
        const n = Math.min(90, Math.round(sp * sp * (0.8 + depth * 4)));
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, out = sp * (0.2 + Math.random() * 0.45);
          this.drop(hubX + rnd(0.25), wy, hubZ + rnd(0.25), fx * 0.5 + Math.cos(a) * out, sp * (0.35 + Math.random() * 0.7), fz * 0.5 + Math.sin(a) * out, muddy, 1.2);
        }
        for (let k = 0; k < n / 6; k++) this.spray(hubX + rnd(0.3), wy + 0.05, hubZ + rnd(0.3), fx * 0.5 + rnd(sp * 0.3), sp * (0.3 + Math.random() * 0.5), fz * 0.5 + rnd(sp * 0.3), muddy, 0.18);
        this.ring(hubX, hubZ, 0.3 * pool, 1.8 * pool, 1.4 * pool, 0.45, false);
      }
      // rooster tail: off the back of the tread where it comes up out of the water
      if (water < r * 1.8 && tread > 1.2) {
        st.tail += dt * Math.min(170, tread * (8 + 36 * depth) + slip * 12);
        const th0 = Math.acos(Math.max(-1, Math.min(1, (r - water) / r)));
        while (st.tail > 1) {
          st.tail -= 1;
          const th = Math.max(0.2, th0) + Math.random() * 0.5;
          const v = Math.min(16, tread) * (0.55 + Math.random() * 0.5);
          const x = hubX - headX * r * Math.sin(th) * dir + rnd(0.1), z = hubZ - headZ * r * Math.sin(th) * dir + rnd(0.1), y = Math.max(wy, hubY - r * Math.cos(th));
          const vx = fx - headX * Math.cos(th) * dir * v + sideX * rnd(0.3) * v, vy = (Math.sin(th) * 0.8 + 0.3) * v, vz = fz - headZ * Math.cos(th) * dir * v + sideZ * rnd(0.3) * v;
          if (Math.random() < 0.14) this.spray(x, y, z, vx * 0.9, vy * 0.9, vz * 0.9, muddy, 0.1 + depth * 0.15);
          else this.drop(x, y, z, vx, vy, vz, muddy);
        }
      }
      // sheets thrown out sideways (and ahead) from where the tyre ploughs through
      if (sp > 1) {
        st.sheet += dt * Math.min(170, sp * sp * depth * 12);
        while (st.sheet > 1) {
          st.sheet -= 1;
          const out = Math.random() < 0.5 ? -1 : 1, v = Math.min(10, sp * 0.7) * (0.5 + Math.random() * 0.6);
          const x = hubX + sideX * out * 0.15 + headX * r * 0.6 + rnd(0.1), z = hubZ + sideZ * out * 0.15 + headZ * r * 0.6 + rnd(0.1);
          const vx = fx * 0.7 + sideX * out * v + rnd(0.5), vy = v * (0.5 + Math.random() * 0.6), vz = fz * 0.7 + sideZ * out * v + rnd(0.5);
          if (Math.random() < 0.18) this.spray(x, wy, z, vx, vy * 0.9, vz, muddy, 0.12 + depth * 0.2);
          else this.drop(x, wy, z, vx, vy, vz, muddy);
        }
        if (Math.random() < dt * sp * 0.8) this.mist(hubX, wy + 0.15, hubZ, fx * 0.5 + rnd(0.6), 0.6 + Math.random() * 0.6, fz * 0.5 + rnd(0.6), muddy, 0.3 + depth * 0.4);
      }
      // foam where the tyre stirs the surface
      if ((sp > 0.3 || tread > 0.8) && Math.random() < dt * (1 + sp * 0.9 + tread * 0.3)) {
        this.ring(hubX + rnd(0.25 * pool), hubZ + rnd(0.25 * pool), (0.18 + Math.random() * 0.14) * pool, (0.3 + sp * 0.08) * pool, (1.2 + Math.random() * 0.8) * (0.5 + 0.5 * pool), 0.5, true, muddy ? MUDDY_FOAM : FOAM);
      }
    }
    st.wet = water;
  }

  /**
   * Emit for a truck's hull in water this frame: the bow wave where it pushes in, the wake and ripples spreading
   * behind, and a big splash when it drives in fast. (x, z): the truck's position; (vx, vz) its velocity; (fx, fz)
   * its heading; halfW, nose: half its width and how far ahead its nose is; depth: water over the bottom of its body;
   * wy: the water's surface there (or -Infinity dry).
   */
  hull(key, dt, x, y, z, vx, vz, fx, fz, halfW, nose, depth, wy) {
    let st = this.hulls.get(key);
    if (!st) { st = { depth: 0, wake: 0, bow: 0, spray: 0 }; this.hulls.set(key, st); }
    const wet = wy > -1e8 && depth > 0.06;
    const sp = Math.hypot(vx, vz);
    if (wet) {
      const muddy = this.ground?.surfaceAt?.(x, z)?.id === SURFACE.MUD;
      const d = Math.min(depth, 1.2);
      // the end that pushes into the water (the tail, backing up) and the truck's right
      const lead = vx * fx + vz * fz >= 0 ? 1 : -1;
      const bx = fx * lead, bz = fz * lead, sx = bz, sz = -bx;
      const reach = nose * (lead > 0 ? 1 : 0.95);
      // driving in fast: the water bursts up round the front
      if (st.depth < 0.06 && sp > 2.5) {
        const n = Math.min(320, Math.round(sp * sp * (0.6 + d) * 7));
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, out = sp * (0.25 + Math.random() * 0.5);
          this.drop(x + bx * reach * 0.7 + rnd(halfW), wy, z + bz * reach * 0.7 + rnd(halfW),
            vx * 0.5 + Math.cos(a) * out, sp * (0.4 + Math.random() * 0.9) * Math.min(1, 0.4 + d), vz * 0.5 + Math.sin(a) * out, muddy, 1.3);
        }
        for (let k = 0; k < Math.min(70, n / 4); k++) {
          const a = Math.random() * Math.PI * 2, out = sp * (0.15 + Math.random() * 0.4);
          this.spray(x + bx * reach * 0.6 + rnd(halfW * 1.1), wy + 0.1, z + bz * reach * 0.6 + rnd(halfW * 1.1),
            vx * 0.4 + Math.cos(a) * out, sp * (0.3 + Math.random() * 0.7) * Math.min(1, 0.4 + d), vz * 0.4 + Math.sin(a) * out, muddy, 0.22 + d * 0.15);
        }
        for (let k = 0; k < Math.min(24, n / 10); k++) this.mist(x + bx * reach * 0.5 + rnd(halfW * 1.2), wy + 0.3, z + bz * reach * 0.5 + rnd(halfW * 1.2), vx * 0.3 + rnd(2), 1 + Math.random() * 2, vz * 0.3 + rnd(2), muddy, 0.6);
        for (let k = 0; k < 8; k++) this.ring(x + rnd(halfW * 1.5), z + rnd(halfW * 1.5), k % 3 === 0 ? 0.4 : 0.6, k % 3 === 0 ? 1.2 : 2.6, 1.8, 0.45, k % 3 === 0, muddy ? MUDDY_FOAM : FOAM);
      }
      if (sp > 0.5) {
        // the bow wave: water heaped up at the front, thrown up and out to both sides
        st.bow += dt * Math.min(300, sp * sp * d * 22);
        st.spray += dt * Math.min(80, sp * sp * d * 5);
        const up = Math.min(1, d * 1.6 + 0.3);
        while (st.bow > 1 || st.spray > 1) {
          const isSpray = st.spray > 1 && (st.bow <= 1 || Math.random() < 0.25);
          if (isSpray) st.spray -= 1; else st.bow -= 1;
          const out = Math.random() < 0.5 ? -1 : 1, along = Math.random() ** 0.7;
          const v = sp * (0.3 + Math.random() * 0.5);
          const px = x + bx * reach + sx * out * halfW * along, pz = z + bz * reach + sz * out * halfW * along;
          const ovx = vx * 0.8 + sx * out * v * (0.3 + along) + rnd(0.3), ovy = v * (0.6 + Math.random() * 0.7) * up, ovz = vz * 0.8 + sz * out * v * (0.3 + along) + rnd(0.3);
          if (isSpray) this.spray(px, wy + 0.04, pz, ovx, ovy, ovz, muddy, 0.14 + d * 0.16);
          else this.drop(px, wy + 0.02, pz, ovx, ovy, ovz, muddy);
        }
        if (Math.random() < dt * sp * d * 4) this.mist(x + bx * reach + rnd(halfW), wy + 0.2, z + bz * reach + rnd(halfW), vx * 0.6 + rnd(1), 0.5 + Math.random(), vz * 0.6 + rnd(1), muddy, 0.45);
        // the wake: foam peeling off both sides of the bow and down the flanks, rings spreading out behind
        st.wake -= dt;
        if (st.wake <= 0) {
          st.wake = Math.max(0.07, 0.2 - sp * 0.015);
          const fc = muddy ? MUDDY_FOAM : FOAM;
          for (const out of [-1, 1]) {
            this.ring(x + bx * reach * 0.8 + sx * out * halfW * 1.05, z + bz * reach * 0.8 + sz * out * halfW * 1.05, 0.26, 0.35 + sp * 0.15, 1.6 + d, 0.55, true, fc);
            if (Math.random() < 0.5) this.ring(x - bx * reach * 0.3 + sx * out * halfW * 1.15, z - bz * reach * 0.3 + sz * out * halfW * 1.15, 0.26, 0.3 + sp * 0.18, 2 + d, 0.42, true, fc);
            this.ring(x - bx * reach * 0.5 + sx * out * halfW * 1.1, z - bz * reach * 0.5 + sz * out * halfW * 1.1, 0.4, 0.6 + sp * 0.35, 2.6, 0.4, false);
          }
          if (Math.random() < 0.5) this.ring(x - bx * reach + rnd(halfW * 0.7), z - bz * reach + rnd(halfW * 0.7), 0.3, 0.3 + sp * 0.12, 2.2, 0.45, true, fc);
        }
      } else if (Math.random() < dt * 1.4) {
        // standing in the water: ripples lapping out now and then
        this.ring(x + rnd(halfW), z + rnd(halfW), 0.45, 0.7, 2.4, 0.35, false);
      }
    }
    st.depth = wet ? depth : 0;
  }

  /** A burst (a hard landing in water, a crash). */
  /**
   * An exhaust pop at the tailpipe (x, y, z), blowing out along (dx, dz) from a truck moving at (vx, vz): a flash of
   * flame in a few tongues and a puff of grey smoke drifting up. k: how big (0..1).
   */
  exhaust(x, y, z, dx, dz, vx, vz, k) {
    for (let i = 0, n = 2 + Math.round(2 * k); i < n; i++) {
      const s = 2 + 3 * Math.random();
      this.spawn(x, y, z, vx + dx * s + rnd(0.5), 0.2 + rnd(0.3), vz + dz * s + rnd(0.5), (0.08 + 0.08 * k) * (0.7 + 0.6 * Math.random()),
        0.05 + 0.06 * Math.random(), FLAME, 0.95, 3, 3, 0, KIND.FLAME);
    }
    for (let i = 0; i < 2; i++) {
      this.spawn(x, y, z, vx + dx * 1.2 + rnd(0.3), 0.3, vz + dz * 1.2 + rnd(0.3), 0.12 + 0.1 * k, 0.7 + 0.4 * Math.random(), EXHAUST_SMOKE, 0.2, 1.2, 1.6, -0.25, KIND.PUFF);
    }
  }

  burst(x, y, z, n, color, speed = 4, size = 0.12) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, z, Math.cos(a) * v, speed * (0.5 + Math.random()), Math.sin(a) * v, size * (0.4 + Math.random() * 0.6), 0.6 + Math.random() * 0.6, color, 0.85, 0, 0.35, 9.81, KIND.DROP);
    }
  }

  update(dt, ground, camera) {
    this.ground = ground;
    const P = this.pos, Vv = this.vel, M = this.misc, C = this.col;
    const hasWater = !!ground?.water;
    let live = 0;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) { C[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      live++;
      const kind = M[i * 4 + 1];
      const k = Math.max(0, 1 - this.drag[i] * dt);
      Vv[i * 3] *= k; Vv[i * 3 + 1] = Vv[i * 3 + 1] * k - this.grav[i] * dt; Vv[i * 3 + 2] *= k;
      P[i * 3] += Vv[i * 3] * dt; P[i * 3 + 1] += Vv[i * 3 + 1] * dt; P[i * 3 + 2] += Vv[i * 3 + 2] * dt;
      M[i * 4] += this.grow[i] * dt;
      M[i * 4 + 2] += this.spin[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // flat things fade as they spread; the rest fade out at the end of their life (and in at the start, softly)
      C[i * 4 + 3] = this.a0[i] * (kind === KIND.RING || kind === KIND.FOAM ? t * Math.min(1, (1 - t) * 12) : Math.min(1, t * 2.5));
      // what falls stops on the ground or in the water (checked every other frame, by halves of the pool)
      if (this.grav[i] > 1 && ground && ((i + this._tick) & 1) === 0) {
        const x = P[i * 3], z = P[i * 3 + 2], y = P[i * 3 + 1];
        const wl = hasWater ? ground.water(x, z) : -1e9;
        if (wl > -1e8 && y < wl && Vv[i * 3 + 1] < 0) {
          // back into the water: a little ring where a drop lands, a patch of foam where spray does
          if (kind === KIND.DROP && Math.random() < 0.1) this.ring(x, z, 0.06 + Math.random() * 0.05, 0.55, 0.7, 0.4, false);
          else if (kind === KIND.SPRAY && Math.random() < 0.12) this.ring(x, z, M[i * 4] * 0.7, 0.3, 1, 0.4, true, C[i * 4] < 0.5 ? MUDDY_FOAM : FOAM);
          this.life[i] = 0; C[i * 4 + 3] = 0; continue;
        }
        const h = ground.height(x, z);
        if (y < h) {
          if (kind === KIND.CHUNK) {
            // a clod lands and stays a moment, squashed flat; a big one leaves a splat of mud on the ground (onLand:
            // render/TrackMap.js), which stays when it is gone
            if (Vv[i * 3 + 1] < -0.5) {
              if (this.onLand && M[i * 4] > 0.04 && C[i * 4] + C[i * 4 + 1] < 0.5) this.onLand(x, z, M[i * 4]);
              this.life[i] = Math.min(this.life[i], 0.8); this.maxLife[i] = Math.max(this.life[i], 0.01); this.grow[i] = 0; this.spin[i] = 0;
            }
            P[i * 3 + 1] = h + 0.015; Vv[i * 3] = Vv[i * 3 + 1] = Vv[i * 3 + 2] = 0; this.grav[i] = 0;
          } else if (kind === KIND.SHARD) {
            P[i * 3 + 1] = h + 0.01; Vv[i * 3] = Vv[i * 3 + 1] = Vv[i * 3 + 2] = 0; this.grav[i] = 0; this.spin[i] = 0;
          } else { this.life[i] = 0; C[i * 4 + 3] = 0; }
        }
      }
    }
    this._tick = (this._tick || 0) + 1;
    // (nothing to draw and nothing that was: no upload)
    if (live || this.live) for (const a of Object.values(this.attr)) a.needsUpdate = true;
    this.live = live;
    void camera;
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
