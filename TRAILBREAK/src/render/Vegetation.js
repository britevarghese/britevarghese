// Trees: each map's own species (game models, CC BY 4.0: see public/assets/trees/CREDITS.md). Near the camera each
// tree is the full model, instanced, swaying in the wind and casting leaf-shaped shadows. Beyond that it is an
// impostor: a picture of the same tree, rendered from the model when the game starts (colour and normals), on a card
// that turns to face the camera and is lit by the sun like the real thing.

import * as THREE from 'three';

/**
 * The species of each map's trees: kinds (one model each; `derived` ones are made from another), how the world's tree
 * types map onto them (with the tree's height and a random number), how wide each grows for its height, where its
 * crown is (for the leaves' rounded lighting), and how close (as a fraction of the full-model range) the heavy models
 * are drawn in full.
 */
export const TREE_SETS = {
  // Ashwood: pine, fir and spruce (the tall firs), birch by the water, and dead trees (the spruce without its needles)
  ashwood: {
    kinds: ['pine', 'fir', 'spruce', 'birch', 'snag'],
    kindOf: (t, h, r) => (t === 0 ? 0 : t === 1 ? (h > 17 || r < 0.45 ? 2 : 1) : t === 2 ? 3 : 4),
    derived: { snag: (a) => ({ name: 'snag', radius: a.spruce.radius * 0.8, groups: a.spruce.groups.filter((g) => g.kind === 'bark') }) },
  },
  // Kerala: coconut palms, the rainforest's giants, mango and jack trees, rubber (and the estates' shade trees),
  // banana and bamboo; the tree types are the kinds
  kerala: {
    kinds: ['coconut', 'jungle', 'mango', 'rubber', 'banana', 'bamboo'],
    kindOf: (t) => t,
    width: { rubber: 0.62, bamboo: 0.85, coconut: 0.95 },
    crown: { coconut: 0.86, banana: 0.62, bamboo: 0.6 },
    // (the rainforest's giants and the mango trees are the heaviest models, and the shola stands thick with them)
    near: { jungle: 0.5, mango: 0.75 },
    // the giants' hanging moss left off: near-white wisps that blur into pale grey sheets a little way off (hung over
    // the roads like ghosts of trees) and thin to nothing as you come up to them. Its own materials, and in the two
    // leaf atlases the strip of it across their tops (the cards drawn wholly from above v = 0.295)
    skip: { jungle: [1, 5, 7] },
    cut: { jungle: { 4: 0.295, 6: 0.295 } },
  },
};
const FAR = 2400;
const TILE_W = 256, TILE_H = 512;
// a tree changes from its model to its picture across a band short of its near range (its share of each pixel
// dithered between the two, so neither pops); the lists it is in are kept wide of the band by the refill step
const BAND = 0.25, MARGIN = 14;
const CELL = 32;               // the grid the trees are found in round the camera (m)
// a stable per-pixel threshold for the dither (interleaved gradient noise)
const IGN = 'float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }';

let NEAR = 80;
// a tree shorter than NEAR_H (m) has its model drawn only out to that share of the range (no less than NEAR_MIN)
const NEAR_H = 8, NEAR_MIN = 0.35;
const nearShare = (h) => Math.min(1, Math.max(NEAR_MIN, h / NEAR_H));

// ---------------------------------------------------------------- loading
/** Geometry and textures of a set's species (from tools/trees.py's files). */
export async function loadTrees(set = TREE_SETS.ashwood, base = 'assets/trees/') {
  const loader = new THREE.TextureLoader();
  const tex = async (file, color) => {
    const t = await loader.loadAsync(base + file);
    t.flipY = false;                                    // glTF texture coordinates
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const out = {};
  const sources = set.kinds.filter((k) => !set.derived?.[k]);
  await Promise.all(sources.map(async (name) => {
    const [info, bin] = await Promise.all([
      fetch(base + name + '.json').then((r) => r.json()),
      fetch(base + name + '.bin').then((r) => r.arrayBuffer()),
    ]);
    const skip = set.skip?.[name] || [], cut = set.cut?.[name] || {};
    const groups = await Promise.all(info.groups.map((gr, i) => [gr, i]).filter(([, i]) => !skip.includes(i)).map(async ([gr, i]) => {
      const g = new THREE.BufferGeometry();
      const uv = new Float32Array(bin, gr.uv, gr.vertices * 2);
      let index = new Uint16Array(bin, gr.index, gr.indices);
      if (cut[i] !== undefined) {
        const keep = [];
        for (let t = 0; t < index.length; t += 3) {
          if (Math.max(uv[index[t] * 2 + 1], uv[index[t + 1] * 2 + 1], uv[index[t + 2] * 2 + 1]) > cut[i]) keep.push(index[t], index[t + 1], index[t + 2]);
        }
        index = new Uint16Array(keep);
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, gr.position, gr.vertices * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(bin, gr.normal, gr.vertices * 3), 3, true));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeBoundingSphere();
      return {
        kind: gr.kind, geometry: g, alphaCutoff: gr.alphaCutoff || 0,
        map: gr.map ? await tex(gr.map, true) : null, normalMap: gr.normalMap ? await tex(gr.normalMap, false) : null,
      };
    }));
    out[name] = { name, radius: info.radius, groups };
  }));
  for (const [name, make] of Object.entries(set.derived || {})) out[name] = make(out);
  return out;
}

// ---------------------------------------------------------------- shaders
/** Wind, a soft rounded crown and light through the leaves, added to a standard material. */
function treeMaterial(group, uniforms, radius, impostorBake = false, crownY = 0.62, fade = null) {
  const leaf = group.kind === 'leaf';
  const mat = new THREE.MeshStandardMaterial({
    map: group.map, normalMap: group.normalMap, roughness: leaf ? 0.8 : 0.93, metalness: 0,
    alphaTest: leaf ? Math.max(0.3, group.alphaCutoff) : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  if (leaf) mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uSunDirW = uniforms.uSunDirW;
    sh.uniforms.uSunColor = uniforms.uSunColor;
    sh.uniforms.uRadius = { value: radius };
    if (fade) sh.uniforms.uFade = fade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uRadius;
uniform vec2 uFade;
varying float vAO;
varying float vFade;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${leaf ? `{
  // leaves lit as a rounded crown, not as the flat cards they are
  vec3 radial = normalize(vec3(position.x, (position.y - ${crownY.toFixed(3)}) * 0.55, position.z) + vec3(0.0, 0.06, 0.0));
  objectNormal = normalize(mix(objectNormal, radial, 0.62));
}` : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float k = position.y * position.y;
  vec3 ip = vec3(0.0);
#ifdef USE_INSTANCING
  ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
#endif
  float sway = sin(uTime * 1.1 + ip.x * 0.11 + ip.z * 0.07) * 0.6 + sin(uTime * 2.3 + ip.z * 0.3 + ip.x * 0.05) * 0.25;
  // (out toward its near range the model gives way to the tree's picture)
  // (a small tree, young or a banana, gives way sooner: its range shrinks with its height, as its card's does)
  float nearK = 1.0;
#ifdef USE_INSTANCING
  nearK = clamp(length(instanceMatrix[1].xyz) / ${NEAR_H.toFixed(1)}, ${NEAR_MIN.toFixed(2)}, 1.0);
#endif
  vFade = ${fade ? '1.0 - smoothstep(uFade.x * nearK, uFade.y * nearK, length(ip.xz - cameraPosition.xz))' : '1.0'};
  transformed.x += sway * ${impostorBake ? '0.0' : '0.011'} * k;
  transformed.z += sway * ${impostorBake ? '0.0' : '0.007'} * k;
${leaf && !impostorBake ? '  transformed += normal * sin(uTime * 6.0 + dot(position, vec3(41.0, 23.0, 37.0)) * 4.0) * 0.003 * k;' : ''}
  // inner crown and low branches in their own shade
  vAO = ${leaf ? 'clamp(0.5 + 0.75 * length(position.xz) / uRadius, 0.5, 1.0) * mix(0.78, 1.0, clamp(position.y * 1.4 - 0.2, 0.0, 1.0))' : 'mix(0.7, 1.0, clamp(position.y * 3.0, 0.0, 1.0))'};
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
varying float vAO;
varying float vFade;
${IGN}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ign(gl_FragCoord.xy) >= vFade) discard;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vAO;`)
      // both sides of a leaf card face out of the crown (don't flip the normal on back faces)
      .replace('#include <normal_fragment_begin>', leaf ? `#include <normal_fragment_begin>
normal = normalize(vNormal);` : '#include <normal_fragment_begin>')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
${leaf ? `{
  // sunlight through the leaves when looking toward the sun
  vec3 sunV = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
  float back = pow(max(0.0, dot(normalize(vViewPosition), sunV)), 3.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * back * 0.55 * vAO;
}` : ''}`);
  };
  return mat;
}

/** Normals for the impostor pictures: the same soft crown normals, in the bake camera's view space. */
function bakeNormalMaterial(group) {
  const leaf = group.kind === 'leaf';
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: group.map }, cutoff: { value: leaf ? Math.max(0.3, group.alphaCutoff) : 0 } },
    side: leaf ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec2 vUv;
      void main() {
        vec3 n = normal;
        ${leaf ? 'vec3 radial = normalize(vec3(position.x, (position.y - 0.62) * 0.55, position.z) + vec3(0.0, 0.06, 0.0)); n = normalize(mix(n, radial, 0.62));' : ''}
        vN = normalize(normalMatrix * n);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D map; uniform float cutoff;
      varying vec3 vN; varying vec2 vUv;
      void main() {
        if (cutoff > 0.0 && texture2D(map, vUv).a < cutoff) discard;
        vec3 n = normalize(vN);
        ${leaf ? '' : 'if (!gl_FrontFacing) n = -n;'}
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- the forest
export class Vegetation {
  /** world: the generated world; renderer: render/Renderer.js (for the impostor pictures and the sun). */
  static async create(world, renderer) {
    const set = TREE_SETS[world.map.trees] || TREE_SETS.ashwood;
    const trees = await loadTrees(set);
    return new Vegetation(world, renderer, trees, set);
  }

  constructor(world, renderer, assets, set = TREE_SETS.ashwood) {
    this.world = world;
    this.set = set;
    this.kinds = set.kinds;
    this.widthOf = this.kinds.map((k) => set.width?.[k] ?? 1);
    this.nearOf = this.kinds.map((k) => set.near?.[k] ?? 1);
    this.fade = this.kinds.map(() => ({ value: new THREE.Vector2() }));
    this.setFade();
    this.renderer = renderer;
    this.trees = world.trees;
    this.assets = assets;
    this.uniforms = { uTime: { value: 0 }, uSunDirW: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) } };
    this.group = new THREE.Group();
    renderer.scene.add(this.group);
    // which species each tree in the world is
    const T = this.trees, n = T.count;
    this.hidden = new Uint8Array(n);
    this.kindOf = new Uint8Array(n);
    const perKind = new Array(this.kinds.length).fill(0);
    for (let i = 0; i < n; i++) {
      const h = Math.sin(i * 91.7) * 43758.5453, r = h - Math.floor(h);
      const k = Math.min(this.kinds.length - 1, set.kindOf(T.type[i], T.h[i], r));
      this.kindOf[i] = k; perKind[k]++;
    }
    // near: the models (one instanced mesh per species and material, sharing the species' instance matrices)
    this.near = this.kinds.map((name, k) => {
      const a = assets[name], cap = Math.max(1, Math.min(perKind[k], 2500));
      let matrix = null, color = null;
      const meshes = a.groups.map((gr) => {
        const m = new THREE.InstancedMesh(gr.geometry, treeMaterial(gr, this.uniforms, a.radius, false, set.crown?.[name] ?? 0.62, this.fade[k]), cap);
        if (!matrix) { matrix = m.instanceMatrix; matrix.setUsage(THREE.DynamicDrawUsage); color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); }
        m.instanceMatrix = matrix;
        m.instanceColor = color;
        m.count = 0;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.group.add(m);
        return m;
      });
      return { meshes, matrix, color, cap };
    });
    this.bakeImpostors(renderer.renderer);
    this.buildGrid();
    this.fillCards();
    this.lastFill = new THREE.Vector3(1e9, 0, 1e9);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._c = new THREE.Color(); this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Pictures of each species from the side (colour with alpha, and normals), and the cards that show them. */
  bakeImpostors(gl) {
    const N = this.kinds.length, W = TILE_W * N, H = TILE_H;
    const colorRT = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 0 });
    const normalRT = new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const prevTarget = gl.getRenderTarget(), prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
    const prevAuto = gl.autoClear, prevTone = gl.toneMapping;
    gl.autoClear = false;
    gl.toneMapping = THREE.NoToneMapping;
    const passes = [
      { rt: colorRT, clear: [0.11, 0.14, 0.08], mat: (gr) => new THREE.MeshBasicMaterial({ map: gr.map, alphaTest: gr.kind === 'leaf' ? Math.max(0.3, gr.alphaCutoff) : 0, side: gr.kind === 'leaf' ? THREE.DoubleSide : THREE.FrontSide }) },
      { rt: normalRT, clear: [0.5, 0.5, 1], mat: (gr) => bakeNormalMaterial(gr) },
    ];
    this.tiles = [];
    for (const pass of passes) {
      gl.setRenderTarget(pass.rt);
      gl.setClearColor(new THREE.Color(...pass.clear), 0);
      gl.clear(true, true, true);
      this.kinds.forEach((name, k) => {
        const a = this.assets[name], r = a.radius * 1.04;
        const cam = new THREE.OrthographicCamera(-r, r, 1.01, -0.01, 0.1, 10);
        cam.position.set(0, 0, 5); cam.lookAt(0, 0.5, 0); cam.position.set(0, 0, 5);
        cam.lookAt(new THREE.Vector3(0, 0, 0));
        cam.updateProjectionMatrix();
        const mats = [];
        for (const gr of a.groups) {
          const m = pass.mat(gr); mats.push(m);
          scene.add(new THREE.Mesh(gr.geometry, m));
        }
        gl.setViewport(k * TILE_W, 0, TILE_W, TILE_H);
        gl.setScissor(k * TILE_W, 0, TILE_W, TILE_H);
        gl.setScissorTest(true);
        gl.render(scene, cam);
        gl.setScissorTest(false);
        for (let i = scene.children.length - 1; i >= 0; i--) if (scene.children[i].isMesh) scene.remove(scene.children[i]);
        for (const m of mats) m.dispose();
        if (pass.rt === colorRT) this.tiles[k] = { u0: k / N, u1: (k + 1) / N, r };
      });
    }
    gl.setRenderTarget(prevTarget);
    gl.setViewport(0, 0, gl.domElement.width, gl.domElement.height);
    gl.setClearColor(prevClear, prevAlpha);
    gl.autoClear = prevAuto;
    gl.toneMapping = prevTone;
    this.impostorColor = colorRT; this.impostorNormal = normalRT;

    // one card per tree, made once (fillCards): per-instance position, size (signed width: mirrored), atlas tile, tint,
    // and the range inside which its model stands in for it (0: none does, the card stays)
    const cap = this.trees.count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.impOffset = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.impSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.impTile = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);   // u0, du, tint
    this.impNear = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aNear', this.impNear);
    g.setAttribute('aOffset', this.impOffset);
    g.setAttribute('aSize', this.impSize);
    g.setAttribute('aTile', this.impTile);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshStandardMaterial({ map: colorRT.texture, alphaTest: 0.45, roughness: 0.85, metalness: 0 });
    mat.alphaToCoverage = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNormalAtlas = { value: normalRT.texture };
      sh.uniforms.uSunDirW = this.uniforms.uSunDirW;
      sh.uniforms.uSunColor = this.uniforms.uSunColor;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 aOffset;
attribute vec2 aSize;
attribute vec3 aTile;
attribute float aNear;
varying float vFade;
varying vec3 vRightW;
varying vec3 vToCamW;
varying float vFlip;
varying float vTint;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vec2(aTile.x + uv.x * aTile.y, uv.y);
#endif`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 0.0, 1.0);`)
        .replace('#include <begin_vertex>', `
vec3 toCam = cameraPosition - aOffset; toCam.y = 0.0;
toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
vec3 rightW = vec3(toCam.z, 0.0, -toCam.x);
vRightW = rightW; vToCamW = toCam; vFlip = sign(aSize.x); vTint = aTile.z;
float dCam = length(aOffset.xz - cameraPosition.xz);
vFade = aNear > 0.0 ? smoothstep(aNear * ${(1 - BAND).toFixed(3)}, aNear, dCam) : 1.0;
vec3 transformed = aOffset + rightW * position.x * abs(aSize.x) * vFlip + vec3(0.0, position.y * aSize.y, 0.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uNormalAtlas;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
varying float vFade;
${IGN}
varying vec3 vRightW;
varying vec3 vToCamW;
varying float vFlip;
varying float vTint;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ign(gl_FragCoord.xy) < 1.0 - vFade) discard;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vTint;`)
        .replace('#include <normal_fragment_begin>', `
vec3 nT = texture2D(uNormalAtlas, vMapUv).xyz * 2.0 - 1.0;
vec3 nW = normalize(vRightW * nT.x * vFlip + vec3(0.0, 1.0, 0.0) * nT.y + vToCamW * nT.z);
vec3 normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;`)
        .replace('#include <normal_fragment_maps>', '')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 sunV = normalize((viewMatrix * vec4(uSunDirW, 0.0)).xyz);
  float back = pow(max(0.0, dot(normalize(vViewPosition), sunV)), 3.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunColor * back * 0.45;
}`);
      // a modelMatrix-free world position: the cards are placed in world space
      // (a card wholly given way to its model, or past the far range, is put out of view, not drawn and discarded)
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
gl_Position = projectionMatrix * mvPosition;
if (vFade <= 0.0 || dCam > ${FAR.toFixed(1)}) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);`).replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);`);
    };
    this.impostors = new THREE.Mesh(g, mat);
    this.impostors.frustumCulled = false;
    this.impostors.receiveShadow = false;
    this.impostors.castShadow = false;
    this.group.add(this.impostors);
  }

  /** The trees by 32 m cell, to find the ones round the camera without going through them all. */
  buildGrid() {
    const T = this.trees, n = T.count;
    if (!n) { this.grid = null; return; }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, T.x[i]); x1 = Math.max(x1, T.x[i]); z0 = Math.min(z0, T.z[i]); z1 = Math.max(z1, T.z[i]); }
    const nx = Math.floor((x1 - x0) / CELL) + 1, nz = Math.floor((z1 - z0) / CELL) + 1, cells = nx * nz;
    const start = new Uint32Array(cells + 1), cellOf = new Uint32Array(n), idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) { const c = Math.floor((T.z[i] - z0) / CELL) * nx + Math.floor((T.x[i] - x0) / CELL); cellOf[i] = c; start[c + 1]++; }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const at = start.slice(0, cells);
    for (let i = 0; i < n; i++) idx[at[cellOf[i]]++] = i;
    this.grid = { x0, z0, nx, nz, start, idx };
  }

  /** A tree's own random numbers (its turn, mirror and tint; its width), the same for its model and its card. */
  rand(i) {
    const h1 = Math.sin(i * 12.9898) * 43758.5453, h2 = Math.sin(i * 78.233) * 12543.123;
    return [h1 - Math.floor(h1), h2 - Math.floor(h2)];
  }

  /**
   * Every tree's card, once. Close to the camera the shader fades a card out as its model fades in (so the list never
   * changes as you drive); only a tree whose kind has run out of models keeps its card there (the overflow, fill).
   */
  fillCards() {
    const T = this.trees, n = T.count, K = this.kindOf;
    const off = this.impOffset.array, size = this.impSize.array, tile = this.impTile.array;
    for (let i = 0; i < n; i++) {
      const k = K[i], [r1, r2] = this.rand(i), t = this.tiles[k];
      const ht = T.h[i], wd = ht * (0.88 + r2 * 0.24) * this.widthOf[k];
      off[i * 3] = T.x[i]; off[i * 3 + 1] = T.y[i] - 0.12; off[i * 3 + 2] = T.z[i];
      size[i * 2] = t.r * wd * (r1 < 0.5 ? -1 : 1); size[i * 2 + 1] = ht * 1.02;
      tile[i * 3] = t.u0; tile[i * 3 + 1] = t.u1 - t.u0; tile[i * 3 + 2] = 0.84 + r2 * 0.3;
    }
    this.overflow = new Set();
    this.setCardNear();
    this.impostors.geometry.instanceCount = n;
    this.impOffset.needsUpdate = true; this.impSize.needsUpdate = true; this.impTile.needsUpdate = true;
    this.farCount = n;
  }

  /** Each card's range inside which its model stands in for it (none for the overflow). */
  setCardNear() {
    const n = this.trees.count, K = this.kindOf, a = this.impNear.array, r = this.nearOf.map((f) => NEAR * f), H = this.trees.h;
    for (let i = 0; i < n; i++) a[i] = r[K[i]] * nearShare(H[i]);
    for (const i of this.overflow) a[i] = 0;
    this.impNear.needsUpdate = true;
  }

  /** The models round the camera: each kind's nearest trees, as many as it has models for. */
  fill(cam) {
    const T = this.trees, K = this.kindOf, G = this.grid, nk = this.kinds.length;
    const counts = new Array(nk).fill(0);
    const m = this._m, q = this._q, s = this._s, p = this._p, c = this._c;
    const rOut = this.kinds.map((_, k) => (NEAR * this.nearOf[k] + MARGIN) ** 2);
    const cand = this._cand || (this._cand = this.kinds.map(() => []));
    for (const l of cand) l.length = 0;
    if (G) {
      const R = Math.sqrt(Math.max(...rOut));
      const i0 = Math.max(0, Math.floor((cam.x - R - G.x0) / CELL)), i1 = Math.min(G.nx - 1, Math.floor((cam.x + R - G.x0) / CELL));
      const k0 = Math.max(0, Math.floor((cam.z - R - G.z0) / CELL)), k1 = Math.min(G.nz - 1, Math.floor((cam.z + R - G.z0) / CELL));
      for (let kz = k0; kz <= k1; kz++) for (let ix = i0; ix <= i1; ix++) {
        const cl = kz * G.nx + ix;
        for (let e = G.start[cl]; e < G.start[cl + 1]; e++) {
          const i = G.idx[e], dx = T.x[i] - cam.x, dz = T.z[i] - cam.z, d2 = dx * dx + dz * dz, k = K[i];
          if (d2 < rOut[k] && !this.hidden[i] && (T.h[i] >= NEAR_H || d2 < (NEAR * this.nearOf[k] * nearShare(T.h[i]) + MARGIN) ** 2)) cand[k].push(d2, i);
        }
      }
    }
    const over = new Set();
    for (let k = 0; k < nk; k++) {
      const nkk = this.near[k], l = cand[k];
      let list = [];
      for (let e = 0; e < l.length; e += 2) list.push(l[e + 1]);
      if (list.length > nkk.cap) {
        // more trees of the kind about than it has models for: the nearest get them, the rest keep their cards
        const order = [];
        for (let e = 0; e < l.length; e += 2) order.push(e);
        order.sort((a, b) => l[a] - l[b]);
        list = order.map((e) => l[e + 1]);
        for (let j = nkk.cap; j < list.length; j++) over.add(list[j]);
        list.length = nkk.cap;
      }
      for (const i of list) {
        const [r1, r2] = this.rand(i), ht = T.h[i], wd = ht * (0.88 + r2 * 0.24) * this.widthOf[k], tint = 0.84 + r2 * 0.3, j = counts[k]++;
        q.setFromAxisAngle(this._up, r1 * 6.283);
        s.set(wd, ht, wd);
        p.set(T.x[i], T.y[i] - 0.12, T.z[i]);
        m.compose(p, q, s);
        m.toArray(nkk.matrix.array, j * 16);
        c.setRGB(tint * (0.96 + r1 * 0.08), tint, tint * (0.93 + r1 * 0.07));
        c.toArray(nkk.color.array, j * 3);
      }
    }
    // the overflow's cards stay up close (and the ones no longer in it fade again)
    let changed = over.size !== this.overflow.size;
    if (!changed) for (const i of over) if (!this.overflow.has(i)) { changed = true; break; }
    if (changed) {
      const a = this.impNear.array;
      for (const i of this.overflow) a[i] = NEAR * this.nearOf[K[i]] * nearShare(T.h[i]);
      for (const i of over) a[i] = 0;
      this.overflow = over;
      this.impNear.needsUpdate = true;
    }
    this.near.forEach((nkk, k) => {
      for (const mesh of nkk.meshes) mesh.count = counts[k];
      nkk.matrix.needsUpdate = true;
      nkk.color.needsUpdate = true;
    });
    this.nearCount = counts.reduce((a, b) => a + b, 0);
  }

  /** A broken tree off the map: no card, no model (it is drawn falling and fallen by render/BreakView.js). */
  hideTree(i) {
    if (this.hidden[i]) return;
    this.hidden[i] = 1;
    this.impSize.array[i * 2] = 0; this.impSize.array[i * 2 + 1] = 0;
    this.cardsDirty = true;
    this.lastFill.set(1e9, 0, 1e9);
  }

  /** How tree i stands, as its model is drawn: { kind, x, y, z, ht, wd, yaw, tint }. */
  treePose(i) {
    const T = this.trees, k = this.kindOf[i], [r1, r2] = this.rand(i), ht = T.h[i];
    return { kind: k, x: T.x[i], y: T.y[i] - 0.12, z: T.z[i], ht, wd: ht * (0.88 + r2 * 0.24) * this.widthOf[k], yaw: r1 * 6.283, tint: 0.84 + r2 * 0.3, r1 };
  }

  /** Instanced models of a species for the fallen trees (no wind, no fading out): { meshes, matrix, color, cap }. */
  fallenOf(k, cap = 24) {
    this.fallen ||= [];
    if (this.fallen[k]) return this.fallen[k];
    const a = this.assets[this.kinds[k]];
    let matrix = null, color = null;
    const meshes = a.groups.map((gr) => {
      const m = new THREE.InstancedMesh(gr.geometry, treeMaterial(gr, this.uniforms, a.radius, true, this.set.crown?.[this.kinds[k]] ?? 0.62, null), cap);
      if (!matrix) { matrix = m.instanceMatrix; matrix.setUsage(THREE.DynamicDrawUsage); color = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); }
      m.instanceMatrix = matrix; m.instanceColor = color;
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    return (this.fallen[k] = { meshes, matrix, color, cap });
  }

  update(camera, dt) {
    this.uniforms.uTime.value += dt;
    if (this.cardsDirty) { this.cardsDirty = false; this.impSize.needsUpdate = true; }
    const r = this.renderer;
    if (r.sun) {
      // the light the shadows come from: the sun, or the moon after dusk
      this.uniforms.uSunDirW.value.subVectors(r.sun.position, r.sun.target.position).normalize();
      this.uniforms.uSunColor.value.copy(r.sun.color).multiplyScalar(Math.min(1.2, r.sun.intensity * 0.35));
    }
    const cam = camera.position;
    if (Math.hypot(cam.x - this.lastFill.x, cam.z - this.lastFill.z) > 12) {
      this.fill(cam);
      this.lastFill.copy(cam);
    }
  }

  setShadows(on) { for (const nk of this.near) for (const m of nk.meshes) m.castShadow = on; }

  /** How far out trees are drawn in full ('high' 340, 'medium' 240, 'low' 150, as the game passes it). */
  setDetailRange(mid) { NEAR = mid >= 300 ? 85 : mid >= 200 ? 60 : 38; this.setFade(); this.setCardNear(); this.lastFill.set(1e9, 0, 1e9); }

  /** Each kind's band where its model gives way to its picture. */
  setFade() { this.kinds.forEach((_, k) => { const d = NEAR * this.nearOf[k]; this.fade[k].value.set(d * (1 - BAND), d); }); }
}

export async function preview(world, r) { const v = await Vegetation.create(world, r); v.update(r.camera, 0); return v; }
