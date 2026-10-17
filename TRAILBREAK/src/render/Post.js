// Post-processing (graphics 'high' and 'medium'): the scene is drawn into a high-dynamic-range target (multisampled,
// for smooth edges) with its depth, then
//   motion blur: at speed, what the camera rushes past streaks along its path on the screen, the nearer the longer
//     (the verge and the road's edge at the bottom and sides, hardly the hills), and the whole picture smears as the
//     camera swings round; the player's own truck, which moves with the camera, stays sharp (and so does the cab
//     from the driver's seat). The truck is found pixel by pixel: it is drawn again on its own, its distance in a
//     mask, and only what is the truck there stays sharp: the ground beside it, and grass or dust in front of it,
//     streak as the rest of the world does
//   bloom: the brightest light (the sun, its glints on paint, chrome and water, lamps at night) glows into what is
//     around it
//   grade: a filmic tone curve (ACES), a little more contrast and colour, cool shadows and warm highlights, a soft
//     vignette, and a trace of noise so the sky's gradients don't band
import * as THREE from 'three';

const TRI = new THREE.BufferGeometry();                // (one triangle over the whole screen)
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
TRI.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const ORTHO = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const VERT = 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// interleaved gradient noise (Jimenez): a per-pixel jitter that reads as fine grain, not a pattern
const IGN = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';

const BLUR = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uFwd;        // how far the camera travels forward while the shutter is open (m)
uniform vec2 uLat;         // ... and sideways and up, times the projection's scale
uniform vec2 uPan;         // how far the picture slides (uv) as the camera turns while the shutter is open
uniform sampler2D tMask;   // the player's truck: 1 / its distance (m) where it is on the screen, 0 elsewhere
uniform float uNear;       // nearer than this (m): the truck the camera rides on (the cab, the bonnet)
uniform float uLogFar;     // log2(far + 1): the logarithmic depth buffer's scale
uniform float uAspect;
uniform float uMax;        // the longest streak (a share of the screen's height)
varying vec2 vUv;
${IGN}
float viewZ(vec2 uv) { return exp2(texture2D(tDepth, uv).r * uLogFar) - 1.0; }
float spared(vec2 uv, float z) {
  float m = texture2D(tMask, uv).r, tz = 1.0 / max(m, 1e-6);
  // the truck itself where the picture shows it (or its cab, seen through its glass): not grass or dust in front
  float onTruck = step(1e-6, m) * step(tz - 0.12 - 0.02 * tz, z) * step(z, tz + 3.0);
  return max(onTruck, step(z, uNear));
}
void main() {
  vec4 c0 = texture2D(tColor, vUv);
  float z = viewZ(vUv);
  float keep = spared(vUv, z);
  // a still world seen from a moving camera: a point at distance z slides (ndc) by (p F - L) / z as the camera moves
  // F forward and L across, plus the turn's slide
  vec2 v = (((vUv * 2.0 - 1.0) * uFwd - uLat) / (2.0 * max(z, 0.3)) + uPan) * (1.0 - keep);
  float L = length(v * vec2(uAspect, 1.0));
  if (L > uMax) v *= uMax / L;
  if (L < 0.0007) { gl_FragColor = c0; return; }
  vec3 acc = c0.rgb;
  float w = 1.0;
  float j = ign(gl_FragCoord.xy) - 0.5;
  for (int i = 0; i < SAMPLES; i++) {
    vec2 uv = vUv + v * ((float(i) + 0.5 + j) / float(SAMPLES) - 0.5);
    // (a sample on the sharp truck doesn't smear it into what's behind it)
    float ws = 1.0 - max(step(1e-6, texture2D(tMask, uv).r), uNear > 0.0 ? step(viewZ(uv), uNear) : 0.0);
    acc += texture2D(tColor, uv).rgb * ws;
    w += ws;
  }
  gl_FragColor = vec4(acc / w, 1.0);
}`;

// the player's truck drawn alone for the blur: 1 / its distance where it is (0, cleared, everywhere else)
const MASK_VERT = /* glsl */`
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying float vZ;
void main() {
  #include <batching_vertex>
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <morphinstance_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <logdepthbuf_vertex>
  vZ = -mvPosition.z;
}`;
const MASK_FRAG = /* glsl */`
#include <logdepthbuf_pars_fragment>
varying float vZ;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(1.0 / max(vZ, 0.01), 0.0, 0.0, 1.0);
}`;
/** The layer the player's truck is also on, for drawing it alone. */
const MASK_LAYER = 5;

// bloom: a chain of half-size copies (a 13-tap filter each step down, the first keeping only the bright light),
// added back up through a tent filter (Jimenez, "Next generation post processing in Call of Duty")
const DOWN = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform vec2 uKnee;        // threshold and softness of the bright pass
varying vec2 vUv;
vec3 at(vec2 o) { return texture2D(tSrc, vUv + uTexel * o).rgb; }
vec3 bright(vec3 c) {
  c = min(c, vec3(60.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uKnee.x + uKnee.y, 0.0, 2.0 * uKnee.y);
  soft = soft * soft / (4.0 * uKnee.y + 1e-4);
  return c * max(soft, br - uKnee.x) / max(br, 1e-4);
}
void main() {
  vec3 a = at(vec2(-2, 2)), b = at(vec2(0, 2)), c = at(vec2(2, 2));
  vec3 d = at(vec2(-2, 0)), e = at(vec2(0, 0)), f = at(vec2(2, 0));
  vec3 g = at(vec2(-2, -2)), h = at(vec2(0, -2)), i = at(vec2(2, -2));
  vec3 j = at(vec2(-1, 1)), k = at(vec2(1, 1)), l = at(vec2(-1, -1)), m = at(vec2(1, -1));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(uFirst > 0.5 ? bright(o) : o, 1.0);
}`;

const UP = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uWeight;     // (each coarser level adds less: a tight glow with a faint wide one round it)
varying vec2 vUv;
void main() {
  vec2 d = uTexel;
  vec3 s = texture2D(tSrc, vUv + vec2(-d.x, d.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, d.y)).rgb * 2.0 + texture2D(tSrc, vUv + d).rgb
    + texture2D(tSrc, vUv + vec2(-d.x, 0.0)).rgb * 2.0 + texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv + vec2(d.x, 0.0)).rgb * 2.0
    + texture2D(tSrc, vUv - d).rgb + texture2D(tSrc, vUv + vec2(0.0, -d.y)).rgb * 2.0 + texture2D(tSrc, vUv + vec2(d.x, -d.y)).rgb;
  gl_FragColor = vec4(s / 16.0 * uWeight, 1.0);
}`;

const GRADE = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uContrast;
uniform float uSat;
uniform vec3 uShadows;     // tint of the shadows ...
uniform vec3 uHighs;       // ... and of the highlights
uniform float uVignette;
uniform float uTime;
varying vec2 vUv;
${IGN}
// three.js's ACES fit (Stephen Hill), the same curve the game drew with before
vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(OUT * rrtOdt(IN * (c / 0.6)), 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec3 c = texture2D(tColor, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  c = max(c * uExposure, 0.0);
  // contrast about mid grey (before the curve, so the highlights still roll off), the tints by brightness, colour
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= pow(max(l, 1e-5) / 0.18, uContrast - 1.0);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadows, uHighs, smoothstep(0.03, 0.7, l));
  c = max(mix(vec3(l), c, uSat), 0.0);
  c = aces(c);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep(0.18, 0.75, dot(q, q) * 2.0);
  gl_FragColor = vec4(srgb(c) + (ign(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0, 1.0);
}`;

const LEVELS = 5;
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _size = new THREE.Vector2(), _clear = new THREE.Color();
const CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3());

export class Post {
  /** Whether this browser can draw into the high-dynamic-range targets post-processing needs. */
  static supported(gl) { return gl.capabilities.isWebGL2 && gl.extensions.has('EXT_color_buffer_float'); }

  constructor(gl) {
    this.gl = gl;
    this.depth = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: this.depth });
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blurRT = rt();
    this.maskRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: true,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.maskMat = new THREE.ShaderMaterial({ vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, side: THREE.DoubleSide });
    this.mips = Array.from({ length: LEVELS }, rt);
    const quad = (frag, uniforms, defines = {}, extra = {}) => {
      const m = new THREE.Mesh(TRI, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false, ...extra }));
      m.frustumCulled = false;
      return m;
    };
    this.blur = quad(BLUR, {
      tColor: { value: this.sceneRT.texture }, tDepth: { value: this.depth }, uFwd: { value: 0 }, uLat: { value: new THREE.Vector2() },
      uPan: { value: new THREE.Vector2() }, tMask: { value: this.maskRT.texture }, uNear: { value: 0 },
      uLogFar: { value: 1 }, uAspect: { value: 1 }, uMax: { value: 0.045 },
    }, { SAMPLES: 12 });
    this.down = quad(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uKnee: { value: new THREE.Vector2(1.3, 0.6) } });
    this.up = quad(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 0.6 } },
      {}, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation });
    this.grade = quad(GRADE, {
      tColor: { value: null }, tBloom: { value: this.mips[0].texture }, uBloom: { value: 0.08 }, uExposure: { value: 1 },
      uContrast: { value: 1.08 }, uSat: { value: 1.1 }, uShadows: { value: new THREE.Vector3(0.96, 0.99, 1.06) },
      uHighs: { value: new THREE.Vector3(1.03, 1.0, 0.96) }, uVignette: { value: 0.32 }, uTime: { value: 0 },
    });
    this.size = new THREE.Vector2(1, 1);
    this.vel = new THREE.Vector3();
    this.prevPos = null;
    this.prevDir = null;
    this.shutter = 1 / 45;                   // (a slow shutter: the speed shows, as in a racing game)
    this.setQuality('high');
  }

  /** 'high': 4x multisampling and a long blur; 'medium': 2x and a shorter one. */
  setQuality(q) {
    this.quality = q;
    const samples = q === 'high' ? 4 : 2;
    if (this.sceneRT.samples !== samples) { this.sceneRT.samples = samples; this.sceneRT.dispose(); }
    this.blur.material.defines.SAMPLES = q === 'high' ? 12 : 8;
    this.blur.material.needsUpdate = true;
  }

  setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (this.size.x === w && this.size.y === h) return;
    this.size.set(w, h);
    this.sceneRT.setSize(w, h);
    this.blurRT.setSize(w, h);
    this.maskRT.setSize(w, h);
    let mw = w, mh = h;
    for (const m of this.mips) { mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1); m.setSize(mw, mh); }
  }

  /** How the world slides past the camera this frame, and where the player's truck is on the screen. */
  motion(camera, dt, subject) {
    const u = this.blur.material.uniforms, p = camera.position;
    camera.getWorldDirection(_v);
    // the camera's velocity, smoothed a little (a cut, such as a respawn, is no motion at all)
    if (this.prevPos && dt > 0) {
      const dx = p.x - this.prevPos.x, dy = p.y - this.prevPos.y, dz = p.z - this.prevPos.z;
      const cut = dx * dx + dy * dy + dz * dz > 400;
      const k = 1 - Math.exp(-dt * 25);
      if (cut) this.vel.set(0, 0, 0);
      else this.vel.x += (dx / dt - this.vel.x) * k, this.vel.y += (dy / dt - this.vel.y) * k, this.vel.z += (dz / dt - this.vel.z) * k;
    }
    (this.prevPos ||= new THREE.Vector3()).copy(p);
    // into the camera's frame, over the shutter
    _q.copy(camera.quaternion).invert();
    const T = _t.copy(this.vel).multiplyScalar(this.shutter).applyQuaternion(_q);
    const P = camera.projectionMatrix.elements;
    u.uFwd.value = -T.z;
    u.uLat.value.set(T.x * P[0], T.y * P[5]);
    // the turn: where last frame's view direction is now on the screen, per frame, over the shutter (slow turns: none)
    const pan = u.uPan.value.set(0, 0);
    if (this.prevDir && dt > 0) {
      const d = _d.copy(this.prevDir).applyQuaternion(_q);
      if (d.z < -0.94) {                                    // (a cut to another view is no turn)
        const k = Math.min(2, this.shutter / dt) * 0.5;
        pan.set((d.x / -d.z) * P[0] * k, (d.y / -d.z) * P[5] * k);
        const L = pan.length(), f = Math.min(1, Math.max(0, (L - 0.0015) / 0.005));
        pan.multiplyScalar(f);
      }
    }
    (this.prevDir ||= new THREE.Vector3()).copy(_v);
    // the player's truck (its mask is drawn in render), and with the camera in it or on it, everything as near
    u.uNear.value = 0;
    if (subject) {
      const box = subject.userData.localBox || (subject.userData.localBox = localBox(subject));
      subject.updateMatrixWorld();
      let inside = false, far = 0;
      for (let i = 0; i < 8; i++) {
        const c = CORNERS[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(subject.matrixWorld);
        far = Math.max(far, c.distanceTo(p));
        if (c.applyMatrix4(camera.matrixWorldInverse).z > -0.3) inside = true;
      }
      _m.copy(subject.matrixWorld).invert();
      if (inside || box.containsPoint(_v.copy(p).applyMatrix4(_m))) u.uNear.value = far + 0.3;
    }
    return Math.abs(u.uFwd.value) + Math.abs(u.uLat.value.x) + Math.abs(u.uLat.value.y) > 0.004 || pan.lengthSq() > 0;
  }

  render(scene, camera, dt, subject) {
    const gl = this.gl;
    gl.getDrawingBufferSize(_size);
    this.setSize(_size.x, _size.y);
    // (the counts cover the whole frame: the scene and the passes after it)
    gl.info.autoReset = false;
    gl.info.reset();
    const moving = this.motion(camera, dt, subject);
    const u = this.blur.material.uniforms;
    u.uLogFar.value = Math.log2(camera.far + 1);
    u.uAspect.value = this.size.x / this.size.y;
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);
    // (the passes below cover the screen: nothing to clear first (the bloom adds into its targets), no shadows)
    const shadowAuto = gl.shadowMap.autoUpdate, autoClear = gl.autoClear;
    gl.shadowMap.autoUpdate = false;
    gl.autoClear = false;
    let src = this.sceneRT.texture;
    if (moving) {
      this.drawMask(scene, camera, subject);
      gl.setRenderTarget(this.blurRT);
      gl.render(this.blur, ORTHO);
      src = this.blurRT.texture;
    }
    // bloom: down the chain, then back up it
    const D = this.down.material.uniforms;
    let from = src, fw = this.size.x, fh = this.size.y;
    for (let i = 0; i < LEVELS; i++) {
      D.tSrc.value = from; D.uTexel.value.set(1 / fw, 1 / fh); D.uFirst.value = i === 0 ? 1 : 0;
      gl.setRenderTarget(this.mips[i]);
      gl.render(this.down, ORTHO);
      from = this.mips[i].texture; fw = this.mips[i].width; fh = this.mips[i].height;
    }
    const U = this.up.material.uniforms;
    for (let i = LEVELS - 1; i > 0; i--) {
      U.tSrc.value = this.mips[i].texture; U.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      gl.setRenderTarget(this.mips[i - 1]);
      gl.render(this.up, ORTHO);
    }
    const G = this.grade.material.uniforms;
    G.tColor.value = src;
    G.uTime.value = (G.uTime.value + 0.618) % 1;
    gl.setRenderTarget(null);
    gl.render(this.grade, ORTHO);
    gl.shadowMap.autoUpdate = shadowAuto;
    gl.autoClear = autoClear;
    gl.info.autoReset = true;
  }

  /** The player's truck alone, its distance in the mask (none: the mask is empty). */
  drawMask(scene, camera, subject) {
    const gl = this.gl, bg = scene.background, over = scene.overrideMaterial, layers = camera.layers.mask;
    gl.getClearColor(_clear);
    const alpha = gl.getClearAlpha();
    gl.setRenderTarget(this.maskRT);
    gl.setClearColor(0x000000, 0);
    gl.clear(true, true, false);
    if (subject) {
      // (every frame: the driver and parts join the truck after it is built)
      subject.traverse((o) => { if (o.isMesh) o.layers.enable(MASK_LAYER); });
      scene.background = null;
      scene.overrideMaterial = this.maskMat;
      camera.layers.set(MASK_LAYER);
      gl.render(scene, camera);
      camera.layers.mask = layers;
      scene.overrideMaterial = over;
      scene.background = bg;
    }
    gl.setClearColor(_clear, alpha);
  }

  dispose() {
    for (const t of [this.sceneRT, this.blurRT, this.maskRT, ...this.mips]) t.dispose();
    this.maskMat.dispose();
    this.depth.dispose();
    for (const q of [this.blur, this.down, this.up, this.grade]) q.material.dispose();
  }
}

/** An object's bounding box in its own frame (computed once: the truck's body, wheels and all). */
function localBox(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), box = new THREE.Box3(), b = new THREE.Box3(), m = new THREE.Matrix4();
  obj.traverseVisible((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) { if (!o.boundingBox) o.computeBoundingBox(); b.copy(o.boundingBox); } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      b.copy(o.geometry.boundingBox);
    }
    box.union(b.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  return box.expandByScalar(0.15);
}
