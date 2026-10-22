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
    // And their lianas (material 3, nothing else): 370 dark strands hanging from the crown's edge to a few metres off
    // the ground, a few metres out from the trunk, that over a road read from a little way off as thin trunks standing
    // in it.
    skip: { jungle: [1, 3, 5, 7] },
    cut: { jungle: { 4: 0.295, 6: 0.295 } },
  },
};
/**
 * A tree's colour (its model's, its card's and its falling self's alike, from its two random numbers): lighter or
 * darker, and a little warmer (yellow-green) or cooler (blue-green), as a stand's trees are. With the lightness alone
 * a hillside of one species read as one green quilt.
 */
export function treeColor(r1, r2) {
  const t = 0.84 + r2 * 0.3, w = (r1 * 7.13 + r2 * 3.71) % 1;
  return [t * (0.93 + 0.14 * w), t, t * (1.04 - 0.16 * w)];
}
const TREE_COLOR_GLSL = `vec3 treeColor(float r1, float r2) {
  float t = 0.84 + r2 * 0.3, w = fract(r1 * 7.13 + r2 * 3.71);
  return t * vec3(0.93 + 0.14 * w, 1.0, 1.04 - 0.16 * w);
}`;
const FAR = 2400;
// each species is pictured from VIEWS bearings round it, and a far tree's card shows the picture from the bearing the
// camera has on it, turned as its model is (so the card is the model as it stands, not one side of it for every tree)
const VIEWS = 8;
// the pictures taken, for each renderer and set of trees (Vegetation.bakeImpostors); and the models, for each set
const BAKED = new WeakMap(), LOADED = new Map();
// a tree changes from its model to its picture across a band short of its near range (its share of each pixel
// dithered between the two, so neither pops: a narrow band, a few metres, so a tree is seen dotted only as it crosses
// it, not the whole ring of trees from 45 m out); the lists it is in are kept wide of the band by the refill step
const BAND = 0.07, MARGIN = 14;
// the near range is measured from a point ahead of the camera, this share of the range out along the way it looks: the
// trees you drive toward have their models that much sooner (and the ones behind give them up as much sooner); the
// point swings round with the view over half a second, so looking about doesn't flick trees between the two
const AHEAD = 0.35;
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
  // (leaves or bark, baked or fading, are written into its shader; each species' crown is a uniform, so every species
  // on every map shares the few programs these make)
  mat.customProgramCacheKey = () => `tree ${leaf ? 1 : 0}${impostorBake ? 1 : 0}${fade ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uSunDirW = uniforms.uSunDirW;
    sh.uniforms.uSunColor = uniforms.uSunColor;
    sh.uniforms.uRadius = { value: radius };
    sh.uniforms.uCrownY = { value: crownY };
    sh.uniforms.uLod = uniforms.uLod;
    if (fade) sh.uniforms.uFade = fade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uRadius;
uniform float uCrownY;
uniform vec2 uFade;
uniform vec2 uLod;
varying float vAO;
varying float vFade;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
${leaf ? `{
  // leaves lit as a rounded crown, not as the flat cards they are
  vec3 radial = normalize(vec3(position.x, (position.y - uCrownY) * 0.55, position.z) + vec3(0.0, 0.06, 0.0));
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
  vFade = ${fade ? '1.0 - smoothstep(uFade.x * nearK, uFade.y * nearK, length(ip.xz - uLod))' : '1.0'};
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

/**
 * Colours for the impostor pictures: the model's own shade baked in, as the card can't cast it on itself: its inner crown
 * and low branches (vAO, as treeMaterial), and the trunk under the crown in the crown's shadow (a model there has it
 * from the shadow map; a picture without it showed every trunk pale against the dark of the woods).
 */
function bakeColorMaterial(group, asset) {
  const leaf = group.kind === 'leaf';
  const mat = new THREE.MeshBasicMaterial({ map: group.map, alphaTest: leaf ? Math.max(0.3, group.alphaCutoff) : 0, side: leaf ? THREE.DoubleSide : THREE.FrontSide });
  mat.customProgramCacheKey = () => `treebake ${leaf ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRadius = { value: asset.radius };
    sh.uniforms.uCrownB = { value: crownBottom(asset) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uRadius;
uniform float uCrownB;
varying float vAO;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vAO = ${leaf ? 'clamp(0.5 + 0.75 * length(position.xz) / uRadius, 0.5, 1.0) * mix(0.78, 1.0, clamp(position.y * 1.4 - 0.2, 0.0, 1.0))'
    : 'mix(0.7, 1.0, clamp(position.y * 3.0, 0.0, 1.0)) * mix(0.5, 1.0, smoothstep(uCrownB - 0.12, uCrownB + 0.06, position.y))'};`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vAO;');
  };
  return mat;
}

/** Where a species' crown begins (its height's share: the lowest tenth of its leaves stand below it). */
function crownBottom(asset) {
  if (asset.crownB !== undefined) return asset.crownB;
  const ys = [];
  for (const gr of asset.groups) {
    if (gr.kind !== 'leaf') continue;
    const p = gr.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) ys.push(p.getY(i));
  }
  ys.sort((a, b) => a - b);
  return (asset.crownB = ys.length ? ys[Math.floor(ys.length * 0.1)] : 0.5);
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
    // (each set's models loaded once: the open world's maps that grow the same set share them)
    if (!LOADED.has(set)) LOADED.set(set, loadTrees(set).catch((e) => { LOADED.delete(set); throw e; }));
    const trees = await LOADED.get(set);
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
    this.uniforms = { uTime: { value: 0 }, uSunDirW: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uLod: { value: new THREE.Vector2() } };
    // (where the map stands in the open world, render/WorldView.js: the cards are placed in the world themselves)
    this.origin = { value: new THREE.Vector3() };
    this.lodAhead = new THREE.Vector2();             // (the near range's middle, from the camera: see AHEAD)
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

  /** Pictures of each species from VIEWS bearings round it (colour with alpha, and normals), and the cards. */
  bakeImpostors(gl) {
    // (taken once for each set of trees: the open world's maps that grow the same set share its pictures)
    let baked = BAKED.get(gl)?.get(this.set);
    if (!baked) {
      baked = this.bake(gl);
      if (!BAKED.has(gl)) BAKED.set(gl, new Map());
      BAKED.get(gl).set(this.set, baked);
    }
    const { colorRT, normalRT } = baked;
    this.tiles = baked.tiles;
    this.impostorColor = colorRT; this.impostorNormal = normalRT;
    this.makeCards(colorRT, normalRT);
  }

  /** The pictures: { colorRT, normalRT, tiles } (each species' column of the atlas). */
  bake(gl) {
    // (a picture 192 x 384 where the graphics card takes a texture tall enough for all the bearings, else 128 x 256)
    const TW = gl.capabilities.maxTextureSize >= 384 * VIEWS ? 192 : 128, TH = TW * 2;
    const N = this.kinds.length, W = TW * N, H = TH * VIEWS;
    const colorRT = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, samples: 0 });
    const normalRT = new THREE.WebGLRenderTarget(W, H, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1));
    const prevTarget = gl.getRenderTarget(), prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
    const prevAuto = gl.autoClear, prevTone = gl.toneMapping;
    gl.autoClear = false;
    gl.toneMapping = THREE.NoToneMapping;
    const passes = [
      { rt: colorRT, clear: [0.11, 0.14, 0.08], mat: (gr, a) => bakeColorMaterial(gr, a) },
      { rt: normalRT, clear: [0.5, 0.5, 1], mat: (gr) => bakeNormalMaterial(gr) },
    ];
    const tiles = [];
    for (const pass of passes) {
      gl.setRenderTarget(pass.rt);
      gl.setClearColor(new THREE.Color(...pass.clear), 0);
      gl.clear(true, true, true);
      this.kinds.forEach((name, k) => {
        const a = this.assets[name], r = a.radius * 1.04;
        const cam = new THREE.OrthographicCamera(-r, r, 1.01, -0.01, 0.1, 10);
        cam.updateProjectionMatrix();
        const mats = [];
        for (const gr of a.groups) {
          const m = pass.mat(gr, a); mats.push(m);
          scene.add(new THREE.Mesh(gr.geometry, m));
        }
        // (bearing v: the camera at v / VIEWS of a turn round the model, from +z toward +x; a row of the atlas each)
        for (let v = 0; v < VIEWS; v++) {
          const b = v / VIEWS * Math.PI * 2;
          cam.position.set(5 * Math.sin(b), 0, 5 * Math.cos(b));
          cam.lookAt(0, 0, 0);
          gl.setViewport(k * TW, v * TH, TW, TH);
          gl.setScissor(k * TW, v * TH, TW, TH);
          gl.setScissorTest(true);
          gl.render(scene, cam);
          gl.setScissorTest(false);
        }
        for (let i = scene.children.length - 1; i >= 0; i--) if (scene.children[i].isMesh) scene.remove(scene.children[i]);
        for (const m of mats) m.dispose();
        if (pass.rt === colorRT) tiles[k] = { u0: k / N, u1: (k + 1) / N, r };
      });
    }
    gl.setRenderTarget(prevTarget);
    gl.setViewport(0, 0, gl.domElement.width, gl.domElement.height);
    gl.setClearColor(prevClear, prevAlpha);
    gl.autoClear = prevAuto;
    gl.toneMapping = prevTone;
    return { colorRT, normalRT, tiles };
  }

  /** The cards: one per tree, showing its species' pictures. */
  makeCards(colorRT, normalRT) {
    // one card per tree, made once (fillCards): per-instance position, size, atlas tile, tint, the turn its model has,
    // and the range inside which its model stands in for it (0: none does, the card stays)
    const cap = this.trees.count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.impOffset = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.impSize = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    this.impTile = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);   // u0, du, tint
    this.impYaw = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.impNear = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aNear', this.impNear);
    g.setAttribute('aOffset', this.impOffset);
    g.setAttribute('aSize', this.impSize);
    g.setAttribute('aTile', this.impTile);
    g.setAttribute('aYaw', this.impYaw);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.MeshStandardMaterial({ map: colorRT.texture, alphaTest: 0.45, roughness: 0.85, metalness: 0 });
    mat.alphaToCoverage = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNormalAtlas = { value: normalRT.texture };
      sh.uniforms.uLod = this.uniforms.uLod;
      sh.uniforms.uOrigin = this.origin;
      sh.uniforms.uSunDirW = this.uniforms.uSunDirW;
      sh.uniforms.uSunColor = this.uniforms.uSunColor;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 aOffset;
attribute vec2 aSize;
attribute vec3 aTile;
attribute float aYaw;
uniform vec3 uOrigin;
attribute float aNear;
uniform vec2 uLod;
varying float vFade;
varying vec3 vRightW;
varying vec3 vToCamW;
varying float vView;
varying vec3 vTint;
${TREE_COLOR_GLSL}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  vMapUv = vec2(aTile.x + uv.x * aTile.y, uv.y);
#endif`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 0.0, 1.0);`)
        .replace('#include <begin_vertex>', `
vec3 toCam = cameraPosition - (aOffset + uOrigin); toCam.y = 0.0;
toCam = normalize(toCam + vec3(1e-4, 0.0, 0.0));
vec3 rightW = vec3(toCam.z, 0.0, -toCam.x);
vRightW = rightW; vToCamW = toCam; vTint = treeColor(aYaw / 6.283, (aTile.z - 0.84) / 0.3);
// the camera's bearing on the tree in the model's own turn, in pictures (0 .. VIEWS)
vView = fract((atan(toCam.x, toCam.z) - aYaw) / 6.2831853) * ${VIEWS.toFixed(1)};
float dCam = length(aOffset.xz - uLod);
vFade = aNear > 0.0 ? smoothstep(aNear * ${(1 - BAND).toFixed(3)}, aNear, dCam) : 1.0;
vec3 transformed = aOffset + uOrigin + rightW * position.x * aSize.x + vec3(0.0, position.y * aSize.y, 0.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D uNormalAtlas;
uniform vec3 uSunDirW;
uniform vec3 uSunColor;
varying float vFade;
${IGN}
varying vec3 vRightW;
varying vec3 vToCamW;
varying float vView;
varying vec3 vTint;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (ign(gl_FragCoord.xy) < 1.0 - vFade) discard;
// the pictures from the two bearings either side of the camera's, blended as it turns, each by its cover (a leaf in one
// and sky in the other keeps the leaf's colour, at half its cover; picking one or the other pixel by pixel left the
// crowns dotted wherever the two differ)
float vLow = floor(vView), vW = vView - vLow;
vec2 uvA = vec2(vMapUv.x, (vLow + vMapUv.y) / ${VIEWS.toFixed(1)}), uvB = vec2(vMapUv.x, (mod(vLow + 1.0, ${VIEWS.toFixed(1)}) + vMapUv.y) / ${VIEWS.toFixed(1)});`)
        .replace('#include <map_fragment>', `vec4 tA = texture2D(map, uvA), tB = texture2D(map, uvB);
float wA = tA.a * (1.0 - vW), wB = tB.a * vW;
diffuseColor *= vec4((tA.rgb * wA + tB.rgb * wB) / max(wA + wB, 1e-4), wA + wB);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vTint;`)
        .replace('#include <normal_fragment_begin>', `
vec3 nT = normalize((texture2D(uNormalAtlas, uvA).xyz * 2.0 - 1.0) * wA + (texture2D(uNormalAtlas, uvB).xyz * 2.0 - 1.0) * wB + vec3(0.0, 0.0, 1e-4));
vec3 nW = normalize(vRightW * nT.x + vec3(0.0, 1.0, 0.0) * nT.y + vToCamW * nT.z);
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

  /** A tree's own random numbers (its turn and tint; its width), the same for its model and its card. */
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
    const off = this.impOffset.array, size = this.impSize.array, tile = this.impTile.array, yaw = this.impYaw.array;
    for (let i = 0; i < n; i++) {
      const k = K[i], [r1, r2] = this.rand(i), t = this.tiles[k];
      const ht = T.h[i], wd = ht * (0.88 + r2 * 0.24) * this.widthOf[k];
      off[i * 3] = T.x[i]; off[i * 3 + 1] = T.y[i] - 0.12; off[i * 3 + 2] = T.z[i];
      size[i * 2] = t.r * wd; size[i * 2 + 1] = ht * 1.02;
      tile[i * 3] = t.u0; tile[i * 3 + 1] = t.u1 - t.u0; tile[i * 3 + 2] = 0.84 + r2 * 0.3;
      yaw[i] = r1 * 6.283;                                             // (as its model is turned: fill)
    }
    this.overflow = new Set();
    this.setCardNear();
    this.impostors.geometry.instanceCount = n;
    this.impOffset.needsUpdate = true; this.impSize.needsUpdate = true; this.impTile.needsUpdate = true; this.impYaw.needsUpdate = true;
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
        const [r1, r2] = this.rand(i), ht = T.h[i], wd = ht * (0.88 + r2 * 0.24) * this.widthOf[k], j = counts[k]++;
        q.setFromAxisAngle(this._up, r1 * 6.283);
        s.set(wd, ht, wd);
        p.set(T.x[i], T.y[i] - 0.12, T.z[i]);
        m.compose(p, q, s);
        m.toArray(nkk.matrix.array, j * 16);
        c.setRGB(...treeColor(r1, r2));
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
    // (only what is used goes up to the GPU: a kind's whole buffer is thousands of trees, sent every 12 m)
    this.near.forEach((nkk, k) => {
      for (const mesh of nkk.meshes) mesh.count = counts[k];
      nkk.matrix.clearUpdateRanges(); nkk.matrix.addUpdateRange(0, Math.max(1, counts[k]) * 16);
      nkk.color.clearUpdateRanges(); nkk.color.addUpdateRange(0, Math.max(1, counts[k]) * 3);
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

  /** How tree i stands, as its model is drawn: { kind, x, y, z, ht, wd, yaw, tint, color }. */
  treePose(i) {
    const T = this.trees, k = this.kindOf[i], [r1, r2] = this.rand(i), ht = T.h[i];
    return { kind: k, x: T.x[i], y: T.y[i] - 0.12, z: T.z[i], ht, wd: ht * (0.88 + r2 * 0.24) * this.widthOf[k], yaw: r1 * 6.283, tint: 0.84 + r2 * 0.3, color: treeColor(r1, r2) };
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

  /**
   * Out of the camera's range (an open-world map it has driven away from: render/WorldView.js): no models, every tree
   * its card again, until update is called once more.
   */
  rest() {
    if (this.resting) return;
    this.resting = true;
    for (const nkk of this.near) for (const m of nkk.meshes) m.count = 0;
    this.nearCount = 0;
    this.uniforms.uLod.value.set(1e9, 1e9);
    this.lastFill.set(1e9, 0, 1e9);
  }

  update(camera, dt) {
    this.resting = false;
    this.uniforms.uTime.value += dt;
    if (this.cardsDirty) { this.cardsDirty = false; this.impSize.needsUpdate = true; }
    const r = this.renderer;
    if (r.sun) {
      // the light the shadows come from: the sun, or the moon after dusk
      this.uniforms.uSunDirW.value.subVectors(r.sun.position, r.sun.target.position).normalize();
      this.uniforms.uSunColor.value.copy(r.sun.color).multiplyScalar(Math.min(1.2, r.sun.intensity * 0.35));
    }
    // the near range's middle: ahead of the camera the way it looks (on the level), swinging round with the view
    const cam = camera.position, d = camera.getWorldDirection(this._dir || (this._dir = new THREE.Vector3()));
    const h = Math.hypot(d.x, d.z), k = h > 0.2 ? AHEAD * NEAR / h : 0, a = this.lodAhead;
    a.x += (d.x * k - a.x) * Math.min(1, dt * 2); a.y += (d.z * k - a.y) * Math.min(1, dt * 2);
    const c = this.uniforms.uLod.value.set(cam.x + a.x, cam.z + a.y);
    if (Math.hypot(c.x - this.lastFill.x, c.y - this.lastFill.z) > 12) {
      this.fill({ x: c.x, z: c.y });
      this.lastFill.set(c.x, 0, c.y);
    }
  }

  setShadows(on) { for (const nk of this.near) for (const m of nk.meshes) m.castShadow = on; }

  /** Where the map stands in the open world (its group is placed there; its cards are placed here). */
  setOrigin(x, z) { this.origin.value.set(x, 0, z); }

  /** How far out trees are drawn in full ('high' 340, 'medium' 240, 'low' 150, as the game passes it). */
  setDetailRange(mid) { NEAR = mid >= 300 ? 85 : mid >= 200 ? 60 : 38; this.setFade(); this.setCardNear(); this.lastFill.set(1e9, 0, 1e9); }

  /** Each kind's band where its model gives way to its picture. */
  setFade() { this.kinds.forEach((_, k) => { const d = NEAR * this.nearOf[k]; this.fade[k].value.set(d * (1 - BAND), d); }); }
}

export async function preview(world, r) { const v = await Vegetation.create(world, r); v.update(r.camera, 0); return v; }
