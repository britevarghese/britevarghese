// Tyre tracks: where the tyres have just rolled, the ground they pressed (render/Terrain.js draws it: soil and grass
// pressed darker, mud smoothed and wet, sand and snow with each lug of the tread printed in them). A picture of the
// ground round the player's truck, a few centimetres a pixel, that the tyres are stamped into as they roll: each wheel
// a strip from where it was last frame to where it is now, as wide as its tread. A pixel holds how hard the ground was
// pressed there (0: not at all), where across the tread it lies, and which way the tyre was rolling (the shader prints
// the lugs across that way, and a spinning tyre leaves them smeared). All premultiplied by how hard (so a pixel at a
// track's edge, filtered with the bare ground beside it, still reads the track's own way and place across).
//
// The picture is tiles of the world, TILE m square, a 3 by 3 block of them round the truck, laid in it by where they
// are (a tile's place in it is its index mod 3; the shader finds a point's pixel from its world position alone, the
// picture wrapping round): as the truck moves into the next tile, the row or column of tiles left behind is wiped and
// becomes the one ahead. So the tracks reach at least a tile, 32 m, every way round the truck; farther behind it they
// are wiped.
// Drawn on the GPU (a few quads a frame, into a render target; wiping a tile is a scissored clear): nothing is read or
// uploaded from here.
import * as THREE from 'three';

const TILE = 32;              // m
const K = 3;                  // tiles a side
const SPAN = TILE * K;        // m the picture spans (its uv wraps every SPAN)
const MAX = 96;               // strips a frame

const vert = /* glsl */`
attribute vec2 corner;        // (-1..1 across, 0..1 along)
attribute vec4 iSeg;          // the strip, in the picture's uv: from (x, y) to (z, w)
attribute vec4 iMisc;         // half its width, half the tyre's footprint long (uv), how hard, how clean (1: rolling)
attribute vec2 iDir;          // the way the tyre rolls
varying float vAcross;
varying vec3 vData;           // how hard, how clean, the way
varying vec2 vDir;
void main() {
  vec2 a = iSeg.xy, b = iSeg.zw, d = iDir;
  vec2 s = vec2(-d.y, d.x);
  vec2 p = mix(a - d * iMisc.y, b + d * iMisc.y, corner.y) + s * corner.x * iMisc.x;
  vAcross = corner.x;
  vData = vec3(iMisc.z, iMisc.w, 0.0);
  vDir = d;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const frag = /* glsl */`
precision highp float;
varying float vAcross;
varying vec3 vData;
varying vec2 vDir;
void main() {
  float k = vData.x, c = vData.y;
  gl_FragColor = vec4(k, k * (0.5 + 0.5 * vAcross), k * (0.5 + 0.5 * c * vDir.x), k * (0.5 + 0.5 * c * vDir.y));
}`;

/** The uniforms each terrain's material shares (render/Terrain.js): the picture, the window of the world it holds. */
export const TRACK_UNIFORMS = {
  uTrkMap: { value: null },
  uTrkWin: { value: new THREE.Vector4(0, 0, 0, 0) },
  uTrkSpan: { value: SPAN },
};

// how hard each ground takes a tyre's print (by its physics name: the shader shows it as the kind of ground drawn)
const PRESS = { mud: 1, dirt: 0.85, grass: 0.75, sand: 0.9, snow: 1, gravel: 0.5, riverbed: 0.8, tea: 0.7 };

export class TrackMap {
  /** res: pixels a tile (512: 6 cm a pixel). */
  constructor(res = 512) {
    this.res = res;
    const N = res * K;
    this.rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    TRACK_UNIFORMS.uTrkMap.value = this.rt.texture;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.seg = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.misc = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.dir = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iSeg', this.seg); g.setAttribute('iMisc', this.misc); g.setAttribute('iDir', this.dir);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, depthTest: false, depthWrite: false, blending: THREE.NoBlending, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.Camera();
    this.n = 0;
    this.last = new Map();      // wheel key -> where it was last stamped, and whether it is printing { x, z, on }
    this.tx = NaN; this.tz = NaN; // the middle tile
    this.wipe = [];             // tiles' places in the picture to wipe before the next strips are drawn
    this.fresh = true;          // (the whole picture, at first and after a jump)
  }

  /** Keep the window round (x, z): moving into another tile wipes the tiles that come into it. */
  follow(x, z) {
    const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
    if (tx === this.tx && tz === this.tz) return;
    if (Math.abs(tx - this.tx) > 1 || Math.abs(tz - this.tz) > 1 || Number.isNaN(this.tx)) { this.fresh = true; this.last.clear(); }
    else {
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const ax = tx + i, az = tz + j;
        if (Math.abs(ax - this.tx) > 1 || Math.abs(az - this.tz) > 1) this.wipe.push((((ax % K) + K) % K), (((az % K) + K) % K));
      }
    }
    this.tx = tx; this.tz = tz;
    const w = TRACK_UNIFORMS.uTrkWin.value;
    w.set((tx - 1) * TILE, (tz - 1) * TILE, (tx + 2) * TILE, (tz + 2) * TILE);
  }

  /**
   * Stamp one wheel this frame. key: whose wheel; (x, z): its contact point; (hx, hz): the way it heads; width: its
   * tread (m); surf: the ground's physics surface (none or a hard one: no print, and the strip breaks); slip: how fast
   * the tread slides over the ground (m/s); sink: how deep the wheel is in (m); carry: how much mud the tyre carries
   * (0 to 1: out of a mud hole it prints dark muddy treads on firm ground, even on rock and road, fading as it sheds it).
   */
  wheel(key, x, z, hx, hz, width, surf, slip = 0, sink = 0, carry = 0) {
    const dirty = surf && surf.name !== 'mud' && surf.name !== 'ice' ? Math.max(0, carry - 0.15) * 1.1 : 0;
    const press = surf ? Math.max(PRESS[surf.name] || 0, dirty) : 0;
    const last = this.last.get(key);
    if (!press) { if (last) last.on = false; return; }
    const W = TRACK_UNIFORMS.uTrkWin.value;
    if (x < W.x + 1 || z < W.y + 1 || x > W.z - 1 || z > W.w - 1) { if (last) last.on = false; return; }
    if (!last) { this.last.set(key, { x, z, on: true }); return; }
    const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
    if (!last.on || d > 3) { last.x = x; last.z = z; last.on = true; return; }
    // (still, and not spinning: nothing new)
    if (d < 0.02 && slip < 1) return;
    if (this.n >= MAX - 4) return;
    let ux = hx, uz = hz;
    const hl = Math.hypot(ux, uz) || 1; ux /= hl; uz /= hl;
    // how hard: the ground's own give, harder the deeper the tyre sank; how clean: smeared by a spinning or sliding tread
    const k = Math.min(1, Math.max(press * (0.75 + Math.min(0.25, sink * 2)), dirty));
    const clean = Math.max(0.15, 1 - Math.max(0, slip - 0.4) * 0.35);
    this.add(last.x, last.z, x, z, ux, uz, width * 0.5, 0.06, k, clean);
    last.x = x; last.z = z;
  }

  /** A splat of mud thrown on the ground at (x, z), about r across (m). */
  splat(x, z, r) {
    const W = TRACK_UNIFORMS.uTrkWin.value;
    if (x < W.x + 1 || z < W.y + 1 || x > W.z - 1 || z > W.w - 1 || this.n >= MAX - 8) return;
    const a = Math.random() * 6.283;
    this.add(x, z, x, z, Math.cos(a), Math.sin(a), r * (0.9 + Math.random() * 0.8), r * (0.6 + Math.random() * 0.6), 0.65 + Math.random() * 0.3, 0);
  }

  add(x0, z0, x1, z1, ux, uz, hw, hl, k, clean) {
    // in the picture's uv (its own wrap): and again a span over where the strip crosses its edge
    const bx = Math.floor(x0 / SPAN) * SPAN, bz = Math.floor(z0 / SPAN) * SPAN;
    const a0 = (x0 - bx) / SPAN, b0 = (z0 - bz) / SPAN, a1 = (x1 - bx) / SPAN, b1 = (z1 - bz) / SPAN;
    const r = (hw + hl + 0.05) / SPAN;
    const lo = Math.min(a0, a1) - r < 0, hi = Math.max(a0, a1) + r > 1, loZ = Math.min(b0, b1) - r < 0, hiZ = Math.max(b0, b1) + r > 1;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if ((ox === 1 && !lo) || (ox === -1 && !hi) || (oz === 1 && !loZ) || (oz === -1 && !hiZ)) continue;
      if (this.n >= MAX) return;
      const i = this.n++;
      const S = this.seg.array, M = this.misc.array, D = this.dir.array;
      S[i * 4] = a0 + ox; S[i * 4 + 1] = b0 + oz; S[i * 4 + 2] = a1 + ox; S[i * 4 + 3] = b1 + oz;
      M[i * 4] = hw / SPAN; M[i * 4 + 1] = hl / SPAN; M[i * 4 + 2] = k; M[i * 4 + 3] = clean;
      D[i * 2] = ux; D[i * 2 + 1] = uz;
    }
  }

  /** Draw this frame's strips into the picture (after wiping what came into the window). */
  draw(renderer) {
    if (!this.fresh && !this.wipe.length && !this.n) return;
    const prev = renderer.getRenderTarget(), auto = renderer.autoClear;
    renderer.getClearColor(this._cc ||= new THREE.Color()); const ca = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    if (this.fresh) { renderer.clear(true, false, false); this.fresh = false; this.wipe.length = 0; }
    if (this.wipe.length) {
      const R = this.res;
      this.rt.scissorTest = true;
      for (let i = 0; i < this.wipe.length; i += 2) {
        this.rt.scissor.set(this.wipe[i] * R, this.wipe[i + 1] * R, R, R);
        renderer.setRenderTarget(this.rt);
        renderer.clear(true, false, false);
      }
      this.rt.scissorTest = false;
      renderer.setRenderTarget(this.rt);
      this.wipe.length = 0;
    }
    if (this.n) {
      const g = this.mesh.geometry;
      g.instanceCount = this.n;
      this.seg.addUpdateRange(0, this.n * 4); this.seg.needsUpdate = true;
      this.misc.addUpdateRange(0, this.n * 4); this.misc.needsUpdate = true;
      this.dir.addUpdateRange(0, this.n * 2); this.dir.needsUpdate = true;
      renderer.autoClear = false;
      renderer.render(this.scene, this.cam);
      this.n = 0;
    }
    renderer.setClearColor(this._cc, ca);
    renderer.autoClear = auto;
    renderer.setRenderTarget(prev);
  }

  dispose() { this.rt.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); TRACK_UNIFORMS.uTrkMap.value = null; }
}
