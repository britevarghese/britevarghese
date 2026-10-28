// Terrain rendering: a quadtree of square patches, each a 32 x 32 grid of quads. Patches near the camera are small
// (16 m, 0.5 m between vertices, fine enough to show ruts), far ones are large; past the map's edge the patches
// follow the far landform out to the horizon. Patches are built on demand (a few per frame), cached, and rebuilt
// where tyres have pressed ruts into the ground. Skirts hide the cracks between patches of different sizes.
//
// Ground: close up, photo-scanned textures of each kind of ground (render/Ground.js), one layer per cell of the map
// (1 m; a big map's bigger: a texture the shader reads), blended between cells by their height maps so stones stand proud of the mud and
// grass grows over the edge of a trail; steep ground is textured from the side. Each vertex carries a tint for the
// colour of the land (lush or dry grass, alpine, wet by the water, worn ruts). Far away the textures fade into the
// vertex colour: each layer's average colour times the tint, baked once into a 2 m colour grid with mip levels so
// distant patches show the average colour of the ground they cover.
//
// Wet ground: mud is always wet (wetter in places), darker and glossy with it; the ruts pressed into it are wetter
// still, and in the deep ones water stands, filling the hollows of the ground's relief first: flat, dark and shiny,
// mirroring the sky. Where there are ruts close to the camera the patches go finer (8 m, a vertex every 25 cm, the
// ruts' own grid), so each rut has its walls and its floor.

import * as THREE from 'three';
import { HASH21 } from './ShaderHash.js';
import { SURFACE } from '../physics/Surfaces.js';
import { DeformGrid, DEFORM_SPAN } from '../world/Deform.js';
import { WornTracks, GAUGE, RUT } from '../world/Worn.js';
import { BEDROCK_GLSL } from '../world/Bedrock.js';
import { vnoise } from '../world/Noise.js';
import { TEA_ROW, TEA_RANGE } from './Tea.js';
import { TRACK_UNIFORMS } from './TrackMap.js';

const GRID = 32;
const V = GRID + 1;
// m in from an open edge of a map's square that the far land is still drawn (sunk under the map's ground: holeSink)
const HOLE_BAND = 12;
const ROOT = 8192;              // (a 2 km map's quadtree: the map and the far land round it; a big map's is wider)
const MIN = 16;
const FINE = 8;                 // (rutted ground close up)
const SPLIT_DEFAULT = 2.1;
const MAX_CACHE = 700;
// (the points round one a few metres off, to find the water's edge by: x, z pairs, made once, not at every vertex)
const SHORE = [2.5, 0, -2.5, 0, 0, 2.5, 0, -2.5, 5, 0, -5, 0, 0, 5, 0, -5];
// (and round mud: the earth beside it damp, a metre and a half and three off, the nearer the wetter)
const FRINGE = [1.5, 0, -1.5, 0, 0, 1.5, 0, -1.5, 3, 0, -3, 0, 0, 3, 0, -3];
const RUT_BUDGET = 2;           // patches with fresh ruts rebuilt a frame (the longest waiting first)
const POOL = 48;                // sets of a patch's vertex arrays kept for the next patches (arrays)

// (the patches built a frame, across every terrain drawn, by time: as many as fit in the few ms beginTerrainFrame gives,
// and at least one; a patch the ground can't be drawn without is built whatever it costs. A frame that built a patch of
// fine ground cost tens of ms each, several a frame driving fast: the game stuttered)
let buildUntil = Infinity, builtThisFrame = 0;
export function beginTerrainFrame(ms) { buildUntil = performance.now() + ms; builtThisFrame = 0; }
const mayBuild = () => builtThisFrame === 0 || performance.now() < buildUntil;
const timeLeft = () => performance.now() < buildUntil;

// Which texture layer each surface shows (grass under the trees shows the forest floor). Colours for when the
// textures could not be loaded.
const LAYER_OF = {
  [SURFACE.GRASS]: 'grass', [SURFACE.DIRT]: 'dirt', [SURFACE.GRAVEL]: 'gravel', [SURFACE.ROCK]: 'rock', [SURFACE.MUD]: 'mud',
  [SURFACE.SAND]: 'sand', [SURFACE.SNOW]: 'snow', [SURFACE.ROAD]: 'road', [SURFACE.RIVERBED]: 'pebbles', [SURFACE.ICE]: 'snow',
  [SURFACE.TEA]: 'tea',
};
// a map without a layer of its own for a ground shows another
const FALLBACK = { road: 'gravel', tea: 'forest', forest: 'grass' };
const PLAIN = {
  grass: 0x6f8c3c, forest: 0x4f4430, dirt: 0x8d7454, gravel: 0x958b7c, rock: 0x8a857d, mud: 0x5e4a33, sand: 0xc8b088,
  snow: 0xeef1f4, pebbles: 0x5f5946, tea: 0x3a6420,
};
// how a tyre's track shows in each kind of ground (render/TrackMap.js): how much darker it is pressed, how deep its
// walls and the tread's lugs are printed (m), how much smoother it is left (pressed mud shines), and how much it is
// crushed grass (browner, not just darker)
const TRACK_LOOK = {
  grass: [0.42, 0.008, 0, 1], forest: [0.4, 0.01, 0, 0.5], dirt: [0.4, 0.014, 0.15, 0], gravel: [0.2, 0.004, 0, 0],
  mud: [0.45, 0.022, 0.45, 0], sand: [0.16, 0.016, 0, 0], snow: [0.14, 0.022, 0, 0], pebbles: [0.2, 0.004, 0, 0],
  tea: [0.3, 0.008, 0, 0.5],
  // (rock and road take no print, only the mud a tyre carries out of a mud hole)
  rock: [0.3, 0.003, 0, 0], road: [0.35, 0.002, 0, 0],
};
// the mud a rut pushes up beside it (drawn only, on the finest patches: the tyres ride the pressed ground): how high,
// for how much deeper the ruts round it (35 to 50 cm away) are
const BERM = 1.1;
// how wet each ground is (0 to 1): mud always, the riverbed's silt a little
const WET = { [SURFACE.MUD]: 0.5, [SURFACE.RIVERBED]: 0.3 };
// (the open world: how far into a stretch its land's colour comes round to its neighbour's at their seam)
const SEAM_BAND = 160;
// tints of the grass: lush hollows, dry knolls, thin alpine turf
const LUSH = [0.78, 0.93, 0.8], DRY = [1.5, 1.24, 1.3], ALPINE = [1.22, 1.08, 1.15];

function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const lin = (hex) => [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];

// shared index buffer: grid + skirt
function makeIndex() {
  const idx = [];
  for (let k = 0; k < GRID; k++) for (let i = 0; i < GRID; i++) {
    const a = k * V + i, b = a + 1, c = a + V, d = c + 1;
    if ((i + k) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  // skirt: 4 edges, each V vertices, stored after the grid
  const base = V * V;
  const edge = (e, gi) => base + e * V + gi;
  const edges = [
    (t) => t,                       // top row (k = 0)
    (t) => GRID * V + t,            // bottom row
    (t) => t * V,                   // left column
    (t) => t * V + GRID,            // right column
  ];
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < GRID; t++) {
      const a = edges[e](t), b = edges[e](t + 1), a2 = edge(e, t), b2 = edge(e, t + 1);
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings: skirts seen from either side
    }
  }
  return new THREE.BufferAttribute(new Uint16Array(idx), 1);
}

export class TerrainRenderer {
  /**
   * ground: the loaded textures (render/Ground.js), or null to colour the ground without them. In the open world
   * (render/WorldView.js) a map's terrain stands in a group at its centre (centre: [x, z]) and draws only its own square
   * (clip); and one more draws the far land all round them (far), leaving their squares (holes: [[x0, z0, x1, z1]]).
   */
  constructor(world, scene, { onProgress, ground = null, centre = [0, 0], clip = false, far = false, holes = [], defer = false, blend = null, beyond = null, match = [] } = {}) {
    this.world = world;
    this.scene = scene;
    this.ground = ground;
    this.half = world.half; this.res = world.res;
    this.root = far ? 65536 : world.half > 1024 ? 32768 : ROOT;
    this.centre = centre; this.clip = clip; this.far = far; this.holes = holes;
    // (the open world: the ground drawn past a map's edge, its neighbour's or the far land's, so the slope of the
    // ground at the edge, and its shading, is the same on both sides of the seam)
    this.beyond = beyond;
    // (and a stretch's colour of the land brought to its neighbours' at their seams: [{ side, toneAt(x, z, out) }], the
    // neighbour's kind of ground and tint at a point in this one's coordinates, colourFix)
    this.match = match;
    // (the open world: a stretch's ground textures giving way to its neighbour's set towards their seam, so both sides
    // of it are textured alike: { ground, side, band })
    this.blend = ground && blend?.ground ? blend : null;
    this.snowLine = world.map.snowLine ?? 1e6;                // (no snow on a tropical map)
    this.litter = world.map.litter;                            // how much each type of tree carpets the ground
    // (how far the tint over the textures goes: twice their colour, or a map's own range, its fields' yellow mustard
    // four times the grass's red)
    this.tintK = world.map.tintRange ?? 2;
    this.layers = ground ? ground.layers : Object.keys(PLAIN).map((name) => ({ name, avg: lin(PLAIN[name]), rough: 0.95 }));
    this.layerIndex = {};
    this.layers.forEach((l, i) => { this.layerIndex[l.name] = i; });
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.index = makeIndex();
    this.cache = new Map();
    this.frame = 0;
    // (a map coming into the open world while the game runs: its colours a slice at a time, `ready`)
    if (!defer) { this.buildColors(onProgress); this.material = this.makeMaterial(); }
    this.shadows = true;
    this.tmpH = new Float32Array((V + 2) * (V + 2));
    this.tmpD = new Float32Array(V * V);
    this.tmpE = new Float32Array((V + 6) * (V + 6));
    this.tmpR = new Float32Array((V + 2) * (V + 2));
    this.tmpQ = new Float32Array((V + 2) * (V + 2) * 5);
    this.tmpP = new Float32Array((V + 2) * (V + 2));
    // (the patches with no worn track on them: one attribute between them all, off any track)
    this.noTrk = new THREE.BufferAttribute(new Float32Array((V * V + 4 * V) * 4).fill(9), 4);
    this.budget = 6;
    this.split = SPLIT_DEFAULT;
    this.fine = true;
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const G = this.ground, w = this.world;
    const uniforms = {};
    if (G) {
      const splat = new THREE.DataTexture(this.splat, w.N, w.N, THREE.RedFormat, THREE.UnsignedByteType);
      splat.magFilter = splat.minFilter = THREE.NearestFilter;
      splat.generateMipmaps = false;
      splat.unpackAlignment = 1;
      splat.needsUpdate = true;
      this.splatTex = splat;
      Object.assign(uniforms, {
        uGC: { value: G.color }, uGN: { value: G.normal }, uSplat: { value: splat },
        uLay: { value: this.layers.map((l) => new THREE.Vector4(1 / l.size, l.rough, l.heightW, 0)) },
        uGain: { value: this.layers.map((l) => new THREE.Vector3(...l.gain)) },
        uSplatO: { value: new THREE.Vector2(w.origin, w.origin) }, uSplatN: { value: w.N }, uSplatRes: { value: w.res }, uMapHalf: { value: this.half },
        uCentre: { value: new THREE.Vector2(...this.centre) },
        uTexFar: { value: 320 }, uIds: { value: new THREE.Vector3(this.layerIndex.grass, this.layerIndex.rock, this.layerIndex.snow ?? this.layerIndex.rock) },
        uSnowLine: { value: this.snowLine + 40 }, uRelief: { value: 1 },
        uTea: { value: this.layerIndex.tea ?? -1 }, uTeaNear: { value: TEA_RANGE.high },
        // (a worn track's: the layers that wear, earth and mud, and the colour of the grass over its hump and verges)
        uIds2: { value: new THREE.Vector2(this.layerIndex.dirt ?? -1, this.layerIndex.mud ?? -1) }, uVerge: { value: new THREE.Vector3(...(w.map.vergeTint || [1.04, 1.03, 0.98])) },
        // how strongly its steep rock stands out in beds (the map's rockBeds: Kerala's granite hardly)
        uRockBeds: { value: w.map.rockBeds ?? 1 },
        // a map of deep mud (world/World.js softness): water standing along most of its tracks' ruts, not stretches
        uDeepMud: { value: w.map.deepMud ? 1 : 0 },
        // and how dark the desert varnish streaked down its rock faces is (the map's varnish)
        uVarnish: { value: w.map.varnish ?? 0 },
        // the tyres' tracks (render/TrackMap.js), and how each layer shows them
        ...TRACK_UNIFORMS,
        uTrkL: { value: this.layers.map((l) => new THREE.Vector4(...(TRACK_LOOK[l.name] || [0, 0, 0, 0]))) },
      });
      const B = this.blend;
      if (B) {
        // each of this ground's layers, as the neighbour's set has it (by name; -1: none, this one's own stays)
        const other = this.layers.map((l) => B.ground.layers[B.ground.index[l.name]] || null);
        const axisX = B.side === 'east' || B.side === 'west', sign = B.side === 'east' || B.side === 'south' ? 1 : -1;
        Object.assign(uniforms, {
          uGC2: { value: B.ground.color },
          uMap2: { value: this.layers.map((l) => B.ground.index[l.name] ?? -1) },
          uLay2: { value: other.map((o, i) => new THREE.Vector4(o ? 1 / o.size : 1 / this.layers[i].size, 0, 0, 0)) },
          uGain2: { value: other.map((o, i) => new THREE.Vector3(...(o || this.layers[i]).gain)) },
          uSeam: { value: new THREE.Vector4(axisX ? 1 : 0, sign, this.half, B.band ?? 160) },
        });
      }
    }
    // muddy water standing in the ruts (linear RGB): the map's mud (red in Kerala), darker
    // the woods past the map (drawn over the land's colour there: see farCover)
    uniforms.uFarForest = { value: new THREE.Vector3(...(this.farForest || [0.07, 0.11, 0.02])) };
    const mt = w.map.mudTint || [0.085, 0.06, 0.04];
    uniforms.uPuddle = { value: new THREE.Color(mt[0] * 0.35, mt[1] * 0.35, mt[2] * 0.35) };
    uniforms.uTintK = { value: this.tintK };
    // (the open world: a map's own square only, round it the far land's)
    uniforms.uClipC = { value: new THREE.Vector3(this.centre[0], this.centre[1], this.clip ? this.half + 0.02 : 0) };
    const NH = this.holes.length;
    if (NH) uniforms.uHoles = { value: this.holes.map(([x0, z0, x1, z1]) => new THREE.Vector4(x0 + 0.02, z0 + 0.02, x1 - 0.02, z1 - 0.02)) };
    this.uniforms = uniforms;
    // (three.js keys its compiled shaders by this function's text: the open world's terrains differ in what is written
    // into theirs, their layers and the far land's holes)
    mat.customProgramCacheKey = () => `terrain ${G ? this.layers.length : 0} ${NH} ${this.blend ? 1 : 0}`;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec3 tint;
attribute vec2 wet;
attribute float cover;
attribute vec4 trk;
attribute float baseY;
uniform float uTintK;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec3 vTint;
varying vec2 vWet;
varying float vCover;
varying vec4 vTrk;
varying float vBaseY;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = objectNormal;
vTint = tint * uTintK;
vWet = wet;
vCover = cover;
vTrk = trk;
vBaseY = baseY;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec3 vTint;
varying vec2 vWet;
varying float vCover;
varying vec4 vTrk;
varying float vBaseY;
uniform vec3 uFarForest;
uniform vec3 uPuddle;
uniform vec3 uClipC;
${NH ? `uniform vec4 uHoles[${NH}];` : ''}
${HASH21}
float th(vec2 p) { return hash21(p); }
float tn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1, 0)), u.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), u.x), u.y); }
${G ? `
#define NLAYERS ${this.layers.length}
uniform highp sampler2DArray uGC;
uniform highp sampler2DArray uGN;
uniform highp sampler2D uSplat;
uniform vec4 uLay[NLAYERS];
uniform vec3 uGain[NLAYERS];
${this.blend ? `#define SEAM
uniform highp sampler2DArray uGC2;
uniform float uMap2[NLAYERS];
uniform vec4 uLay2[NLAYERS];
uniform vec3 uGain2[NLAYERS];
uniform vec4 uSeam;` : ''}
float gSeamW = 0.0;
uniform vec2 uSplatO;
uniform float uSplatN;
uniform float uSplatRes;
uniform float uMapHalf;
uniform vec2 uCentre;
uniform float uTexFar;
uniform float uRockBeds;
uniform float uDeepMud;
uniform float uVarnish;
uniform vec3 uIds;
uniform float uSnowLine;
uniform float uRelief;
uniform float uTea;
uniform float uTeaNear;
uniform vec2 uIds2;
uniform vec3 uVerge;
uniform highp sampler2D uTrkMap;
uniform vec4 uTrkWin;
uniform float uTrkSpan;
uniform vec4 uTrkL[NLAYERS];
// a tea estate beyond the hedges (render/Tea.js): the rows as stripes along the contours, leaves over the soil
vec3 gTea(vec3 soil, float dist) {
  float ph = fract(vWPos.y / ${TEA_ROW.toFixed(3)});
  float band = smoothstep(0.06, 0.26, ph) * smoothstep(0.99, 0.72, ph);
  float aa = clamp(fwidth(vWPos.y / ${TEA_ROW.toFixed(3)}) * 2.0 - 0.4, 0.0, 1.0);
  band = mix(band, 0.68, aa);
  float lum = dot(soil, vec3(0.3, 0.5, 0.2));
  vec3 leaf = vec3(0.06, 0.15, 0.03) * (0.7 + 2.2 * lum);
  return mix(soil, leaf, band * smoothstep(uTeaNear * 0.8, uTeaNear, dist));
}
// the projections (top, and the two sides for steep ground), their weights and screen-space derivatives
vec2 gPT, gPX, gPZ, gDTx, gDTy, gDXx, gDXy, gDZx, gDZy;
float gwT, gwX, gwZ, gSX, gSZ;
// (how far off the pixel is for the ground's textures to be mixed with themselves over a larger tile: gColor)
float gFar;
const mat2 gTurn = mat2(0.766, 0.643, -0.643, 0.766);
float gL[4];
float gW[4];
int gn;
float gId(ivec2 c) {
  c = clamp(c, ivec2(0), ivec2(int(uSplatN) - 1));
  return floor(texelFetch(uSplat, c, 0).r * 255.0 + 0.5);
}
void gAdd(float id, float w) {
  for (int j = 0; j < 4; j++) {
    if (j >= gn) break;
    if (gL[j] == id) { gW[j] += w; return; }
  }
  gL[gn] = id; gW[gn] = w; gn++;
}
#ifdef SEAM
vec4 gColor2(float L, float sc) {
  vec4 c = vec4(0.0);
  if (gwT > 0.0) c += textureGrad(uGC2, vec3(gPT * sc, L), gDTx * sc, gDTy * sc) * gwT;
  if (gwX > 0.0) c += textureGrad(uGC2, vec3(gPX * sc, L), gDXx * sc, gDXy * sc) * gwX;
  if (gwZ > 0.0) c += textureGrad(uGC2, vec3(gPZ * sc, L), gDZx * sc, gDZy * sc) * gwZ;
  return c;
}
#endif
vec4 gColor(float L, float sc) {
  vec4 c = vec4(0.0);
  if (gwT > 0.0) c += textureGrad(uGC, vec3(gPT * sc, L), gDTx * sc, gDTy * sc) * gwT;
  if (gwX > 0.0) c += textureGrad(uGC, vec3(gPX * sc, L), gDXx * sc, gDXy * sc) * gwX;
  if (gwZ > 0.0) c += textureGrad(uGC, vec3(gPZ * sc, L), gDZx * sc, gDZy * sc) * gwZ;
  // farther off, the same ground over a tile three and a half times the size, turned and shifted, mixed in: a few
  // metres across, the tile repeats dozens of times in view out there, and its repeats lined up into a pattern (on a
  // rock face, rows of scales)
  if (gFar > 0.0) {
    float s2 = sc * 0.29;
    vec4 f = vec4(0.0);
    if (gwT > 0.0) f += textureGrad(uGC, vec3(gTurn * gPT * s2 + 0.37, L), gTurn * gDTx * s2, gTurn * gDTy * s2) * gwT;
    if (gwX > 0.0) f += textureGrad(uGC, vec3(gTurn * gPX * s2 + 0.37, L), gTurn * gDXx * s2, gTurn * gDXy * s2) * gwX;
    if (gwZ > 0.0) f += textureGrad(uGC, vec3(gTurn * gPZ * s2 + 0.37, L), gTurn * gDZx * s2, gTurn * gDZy * s2) * gwZ;
    c = mix(c, (c + f) * 0.5, gFar);
  }
  return c;
}
// bare rock's relief and shade (world/Bedrock.js: the same ledges and joints the vertices near by are moved by)
${BEDROCK_GLSL}
// the normal map's tilt as a world-space vector along the ground
vec3 gTilt(float L, float sc) {
  vec3 d = vec3(0.0);
  if (gwT > 0.0) { vec2 t = textureGrad(uGN, vec3(gPT * sc, L), gDTx * sc, gDTy * sc).rg * 2.0 - 1.0; d += vec3(t.x, 0.0, -t.y) * gwT; }
  if (gwX > 0.0) { vec2 t = textureGrad(uGN, vec3(gPX * sc, L), gDXx * sc, gDXy * sc).rg * 2.0 - 1.0; d += vec3(0.0, t.y, -gSX * t.x) * gwX; }
  if (gwZ > 0.0) { vec2 t = textureGrad(uGN, vec3(gPZ * sc, L), gDZx * sc, gDZy * sc).rg * 2.0 - 1.0; d += vec3(gSZ * t.x, t.y, 0.0) * gwZ; }
  return d;
}` : ''}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (uClipC.z > 0.0 && (abs(vWPos.x - uClipC.x) > uClipC.z || abs(vWPos.z - uClipC.y) > uClipC.z)) discard;
${NH ? `for (int i = 0; i < ${NH}; i++) {
  vec4 h = uHoles[i];
  if (vWPos.x > h.x && vWPos.x < h.z && vWPos.z > h.y && vWPos.z < h.w) {
    // (a little way in from an edge with no map beyond it the far land is kept, sunk under the map's ground: see holeSink)
    vec4 e = vec4(vWPos.x - h.x, h.z - vWPos.x, vWPos.z - h.y, h.w - vWPos.z);
    float dIn = min(min(e.x, e.y), min(e.z, e.w));
    if (dIn > ${HOLE_BAND.toFixed(1)}) discard;
    vec2 across = vWPos.xz + (dIn + 1.0) * (dIn == e.x ? vec2(-1.0, 0.0) : dIn == e.y ? vec2(1.0, 0.0) : dIn == e.z ? vec2(0.0, -1.0) : vec2(0.0, 1.0));
    for (int j = 0; j < ${NH}; j++) { vec4 o = uHoles[j]; if (j != i && across.x > o.x && across.x < o.z && across.y > o.y && across.y < o.w) discard; }
  }
}` : ''}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gNW = normalize(vWNormal);
float gRough = -1.0;
float gH = 0.5;
float gPool = 0.0;
float gWet = 0.0;
float gTrkPool = 0.0;
float gTrkWet = 0.0;
{
  float dist = length(vWPos - cameraPosition);
  float mid = clamp(1.0 - dist / 900.0, 0.0, 1.0);
  float n1 = tn(vWPos.xz * 0.31);
  float n2 = tn(vWPos.xz * 0.11);
  float n3 = tn(vWPos.xz * 0.023);
  float vary = 0.9 + 0.1 * n1 * (1.0 - smoothstep(60.0, 220.0, dist)) + 0.12 * n2 * mid + 0.08 * n3;
${G ? `
  float tex = 1.0 - smoothstep(uTexFar * 0.55, uTexFar, dist);
  gFar = smoothstep(14.0, 45.0, dist);
#ifdef SEAM
  { vec2 lp = vWPos.xz - uCentre; gSeamW = 1.0 - smoothstep(0.0, uSeam.w, uSeam.z - mix(lp.y, lp.x, uSeam.x) * uSeam.y); }
#endif
  vec3 n = gNW;
  // projections and their derivatives, taken here where every pixel runs the same code
  gSX = n.x >= 0.0 ? 1.0 : -1.0; gSZ = n.z >= 0.0 ? 1.0 : -1.0;
  gPT = vec2(vWPos.x, -vWPos.z); gPX = vec2(-vWPos.z * gSX, vWPos.y); gPZ = vec2(vWPos.x * gSZ, vWPos.y);
  vec2 qx = vec2(-vWPos.z, vWPos.y), qz = vec2(vWPos.x, vWPos.y);
  gDTx = dFdx(gPT); gDTy = dFdy(gPT);
  gDXx = dFdx(qx) * gSX; gDXy = dFdy(qx) * gSX; gDZx = dFdx(qz) * gSZ; gDZy = dFdy(qz) * gSZ;
  vec3 tw = abs(n.y) > 0.82 ? vec3(0.0, 1.0, 0.0) : pow(abs(n), vec3(6.0));
  tw /= (tw.x + tw.y + tw.z);
  gwT = tw.y > 0.03 ? tw.y : 0.0; gwX = tw.x > 0.03 ? tw.x : 0.0; gwZ = tw.z > 0.03 ? tw.z : 0.0;
  float tws = gwT + gwX + gwZ; gwT /= tws; gwX /= tws; gwZ /= tws;
  if (tex > 0.0) {
    // the layers of the four cells around this point, weighted by distance
    vec2 g = (vWPos.xz - uCentre - uSplatO) / uSplatRes;
    vec2 gi = floor(g), f = g - gi;
    ivec2 c = ivec2(gi);
    float i0, i1, i2, i3;
    if (abs(vWPos.x - uCentre.x) < uMapHalf && abs(vWPos.z - uCentre.y) < uMapHalf) {
      i0 = gId(c); i1 = gId(c + ivec2(1, 0)); i2 = gId(c + ivec2(0, 1)); i3 = gId(c + ivec2(1, 1));
    } else {
      // past the edge of the map: rock on the steeps, snow on the tops, grass below
      i0 = n.y < 0.7 ? uIds.y : vWPos.y > uSnowLine ? uIds.z : uIds.x;
      i1 = i0; i2 = i0; i3 = i0;
    }
    gn = 1; gL[0] = i0; gW[0] = (1.0 - f.x) * (1.0 - f.y);
    gAdd(i1, f.x * (1.0 - f.y)); gAdd(i2, (1.0 - f.x) * f.y); gAdd(i3, f.x * f.y);
    // blend by height: where one ground's relief stands higher it shows through
    vec4 cs[4];
    float hs[4];
    float top = -1.0;
    for (int j = 0; j < 4; j++) {
      if (j >= gn) break;
      vec4 lay = uLay[int(gL[j])];
      cs[j] = gColor(gL[j], lay.x);
#ifdef SEAM
      if (gSeamW > 0.0) { int li2 = int(gL[j]); float m = uMap2[li2]; if (m >= 0.0) cs[j] = mix(cs[j], gColor2(m, uLay2[li2].x), gSeamW); }
#endif
      if (gL[j] == uTea) cs[j].rgb = gTea(cs[j].rgb, dist);
      hs[j] = gW[j] + cs[j].a * lay.z;
      top = max(top, hs[j]);
    }
    float near = (1.0 - smoothstep(25.0, 140.0, dist)) * uRelief;
    vec3 alb = vec3(0.0), tilt = vec3(0.0);
    float rough = 0.0, sum = 0.0, hgt = 0.0;
    for (int j = 0; j < 4; j++) {
      if (j >= gn) break;
      int li = int(gL[j]);
      vec4 lay = uLay[li];
      float b = max(0.0, hs[j] - top + 0.16);
      sum += b;
#ifdef SEAM
      alb += cs[j].rgb * mix(uGain[li], uGain2[li], uMap2[li] >= 0.0 ? gSeamW : 0.0) * b;
#else
      alb += cs[j].rgb * uGain[li] * b;
#endif
      rough += lay.y * b;
      hgt += cs[j].a * b;
      if (near > 0.0) tilt += gTilt(gL[j], lay.x) * b;
    }
    alb /= sum; rough /= sum; tilt /= sum;
    // a meadow: tufts and clumps of grass in it, lighter and darker (render/Grass.js stands its blades on the near
    // part), so it isn't a flat green out past the blades; a pattern finer than a pixel evens out to its mean
    float mw = 0.0;
    for (int j = 0; j < 4; j++) { if (j >= gn) break; if (gL[j] == uIds.x) mw += max(0.0, hs[j] - top + 0.16); }
    mw /= sum;
    if (mw > 0.0) {
      float px = length(fwidth(vWPos.xz));
      float t1 = tn(vWPos.xz * 1.6 + 3.1), t2 = tn(vWPos.xz * 0.42 + 7.7);
      float m = mix(0.5, t1, 1.0 - smoothstep(0.2, 0.5, px * 1.6)) * 0.55 + mix(0.5, t2, 1.0 - smoothstep(0.2, 0.5, px * 0.42)) * 0.45;
      alb *= 1.0 + (m - 0.5) * 0.55 * mw;
    }
    // a worn track (world/Worn.js; vTrk: m off its wheel line's middle, m along it, its ruts' depth, m off the line its
    // bare earth reaches): its two ruts pressed hard and dark, the tread marks in them, water standing in them in the
    // mud; the hump between them grown over in clumps of grass; and the verge's grass reaching in to a ragged edge, not
    // a line. In earth and mud only (the rock and the gravel show as they are), out to where it is under a pixel.
    vec3 trkTilt = vec3(0.0);
    if (vTrk.x < 8.0 && vTrk.z > 0.002) {
      float wd = 0.0, wm = 0.0;
      for (int j = 0; j < 4; j++) {
        if (j >= gn) break;
        float b = max(0.0, hs[j] - top + 0.16) / sum;
        if (gL[j] == uIds2.x) wd += b; else if (gL[j] == uIds2.y) wm += b;
      }
      // (and none where a triangle reaches off the track: its vertex there has none, u and depth 9, and between it and
      // one on the track u runs back through the ruts' place, a false pair of ruts along the edge of the track's reach,
      // stepped as the vertices are; no rut is 40 cm deep, so the depth there gives it away)
      float fade = (1.0 - smoothstep(70.0, 130.0, dist)) * (1.0 - smoothstep(0.4, 0.9, vTrk.z)), soft = wd + wm;
      if (fade * soft > 0.0) {
        float u = vTrk.x, au = abs(u), s = vTrk.y, dep = vTrk.z;
        float px = max(length(fwidth(vWPos.xz)), 1e-3), aa = px * 0.5;
        // the nearer rut: how far off its middle, its floor, and the slope of the ground across the track there
        float r = abs(au - ${GAUGE.toFixed(3)});
        float inRut = 1.0 - smoothstep(${RUT.toFixed(3)} - 0.07 - aa, ${RUT.toFixed(3)} + aa, r);
        float a = ${(Math.PI / 2 / RUT).toFixed(4)};
        float dHdr = r < ${RUT.toFixed(3)} ? dep * a * sin(2.0 * a * r) : r < ${(RUT + 0.4).toFixed(3)} ? dep * 0.18 * ${(Math.PI / 0.4).toFixed(4)} * cos((r - ${RUT.toFixed(3)}) / 0.4 * 3.14159) : 0.0;
        float dHdu = dHdr * sign(au - ${GAUGE.toFixed(3)}) * sign(u);
        // (the way across the track, from how u changes over the pixel)
        vec2 dpx = dFdx(vWPos.xz), dpy = dFdy(vWPos.xz);
        float dux = dFdx(u), duy = dFdy(u), det = dpx.x * dpy.y - dpx.y * dpy.x;
        vec2 gu = abs(det) > 1e-10 ? vec2(dux * dpy.y - duy * dpx.y, duy * dpx.x - dux * dpy.x) / det : vec2(0.0);
        gu /= max(length(gu), 1e-4);
        trkTilt = -vec3(gu.x, 0.0, gu.y) * dHdu * fade * soft * (1.0 - smoothstep(0.08, 0.3, px));
        // tread marks across the ruts, a quarter of a metre apart, chevrons (gone where a pixel is coarser)
        float tread = 0.5 + 0.5 * sin(s * 26.0 + r * 11.0 + tn(vec2(s * 0.3, au)) * 6.0);
        float treadA = 1.0 - smoothstep(0.02, 0.07, px);
        float floorK = 1.0 - smoothstep(0.0, ${RUT.toFixed(3)}, r);
        // the track's bare earth: browner and darker than the dry ground (trodden, and damp in stretches)
        float verge0 = smoothstep(vTrk.w - 0.2, vTrk.w + 0.25, au);
        float damp = smoothstep(0.35, 0.75, tn(vec2(s * 0.07, 1.7)));
        float bare = (1.0 - verge0) * wd * fade;
        alb *= mix(vec3(1.0), vec3(0.8, 0.72, 0.6) * (1.0 - 0.18 * damp), bare);
        alb *= mix(vec3(1.0), vec3(0.74, 0.71, 0.68) * (1.0 - 0.14 * tread * treadA * floorK), inRut * soft * fade);
        rough = mix(rough, 0.72, inRut * soft * fade);
        // the hump's grass in clumps; the verge's to a ragged edge
        float clump = tn(vec2(s * 0.6, u * 0.9) + 4.7) * 0.6 + tn(vWPos.xz * 3.3) * 0.4;
        float hump = (1.0 - smoothstep(${(GAUGE - RUT - 0.12).toFixed(3)} - aa, ${(GAUGE - RUT).toFixed(3)} + aa, au)) * smoothstep(0.32, 0.55, clump);
        float rag = (tn(vec2(s * 0.8, au * 1.6) + 9.1) - 0.5) * 0.7 + (tn(vWPos.xz * 2.2 + 1.3) - 0.5) * 0.35;
        float verge = smoothstep(vTrk.w - 0.2 - aa, vTrk.w + 0.25 + aa, au + rag);
        float over = max(hump * 0.92, verge) * wd * fade;
        if (over > 0.0) {
          vec3 ga = gColor(uIds.x, uLay[int(uIds.x)].x).rgb * uGain[int(uIds.x)] * uVerge;
          alb = mix(alb, ga * (0.85 + 0.3 * clump), over);
          rough = mix(rough, uLay[int(uIds.x)].y, over);
        }
        // wet: in the mud its ruts, and water standing along stretches of them; on earth, damp in their floors
        float pn = tn(vec2(s * 0.16, 2.3 + sign(u) * 5.0));
        gTrkPool = smoothstep(0.08, 0.4, floorK) * smoothstep(0.4 - 0.25 * uDeepMud, 0.62 - 0.25 * uDeepMud, pn) * wm * fade;
        gTrkWet = inRut * fade * (wm * 0.75 + wd * (0.12 + 0.3 * damp));
      }
    }
    // tyre tracks (render/TrackMap.js): the ground the tyres have just rolled over, pressed darker (grass crushed browner,
    // mud smoothed and wet), the lugs of the tread printed in it across the way they rolled (smeared where they spun),
    // the track's walls and the lugs lit as relief; gone where a pixel is too coarse to show them
    vec3 tyreTilt = vec3(0.0);
    float tpx = max(length(fwidth(vWPos.xz)), 1e-3);
    if (vWPos.x > uTrkWin.x && vWPos.z > uTrkWin.y && vWPos.x < uTrkWin.z && vWPos.z < uTrkWin.w && tpx < 0.3) {
      vec2 tuv = vWPos.xz / uTrkSpan;
      vec4 tm = texture(uTrkMap, tuv);
      // (its edge crisp: the picture's pixels are 6 cm, and filtered they soften a track's edge to a blur)
      float st = smoothstep(0.06, 0.3, tm.r) * min(1.0, tm.r * 1.5) * (1.0 - smoothstep(0.1, 0.3, tpx));
      if (st > 0.02) {
        vec4 L = vec4(0.0);
        for (int j = 0; j < 4; j++) { if (j >= gn) break; L += uTrkL[int(gL[j])] * max(0.0, hs[j] - top + 0.16); }
        L /= sum;
        vec2 dv = tm.ba / tm.r * 2.0 - 1.0;
        float clean = clamp(length(dv), 0.0, 1.0);
        vec2 dir = dv / max(length(dv), 1e-3);
        float ac = clamp(tm.g / tm.r * 2.0 - 1.0, -1.0, 1.0);
        // the lugs: chevrons down the middle of the tread, 11 cm apart, staggered blocks on its shoulders
        float sh = smoothstep(0.55, 0.65, abs(ac));
        // (along the way it rolled from the window's corner, not the world's: kilometres out a sine of the distance in
        // lugs has no precision left)
        float ph = fract(dot(vWPos.xz - uTrkWin.xy, dir) / 0.11 + abs(ac) * 0.45 * (1.0 - sh) + sh * 0.5);
        float sn = sin(6.2832 * ph), lt = clamp(sn * 1.25 + 0.5, 0.0, 1.0);
        float lug = lt * lt * (3.0 - 2.0 * lt);
        float dLug = 6.0 * lt * (1.0 - lt) * 1.25 * 6.2832 * cos(6.2832 * ph) / 0.11;
        float la = (1.0 - smoothstep(0.012, 0.04, tpx)) * clean * st;
        // (the walls: how hard the ground was pressed a pixel to either side)
        float ex = 1.0 / float(textureSize(uTrkMap, 0).x);
        float gx = texture(uTrkMap, tuv + vec2(ex, 0.0)).r - texture(uTrkMap, tuv - vec2(ex, 0.0)).r;
        float gz = texture(uTrkMap, tuv + vec2(0.0, ex)).r - texture(uTrkMap, tuv - vec2(0.0, ex)).r;
        float wallK = L.y * 1.4 * (1.0 - smoothstep(0.04, 0.12, tpx));
        tyreTilt = vec3(gx, 0.0, gz) / (2.0 * ex * uTrkSpan) * wallK + vec3(dir.x, 0.0, dir.y) * dLug * L.y * 0.5 * la;
        float tl = length(tyreTilt);
        if (tl > 0.8) tyreTilt *= 0.8 / tl;
        vec3 press = mix(vec3(1.0 - L.x), vec3(1.0 - L.x * 0.55, 1.0 - L.x * 0.75, 1.0 - L.x * 1.5), L.w);
        alb *= mix(vec3(1.0), press, st) * (1.0 - 0.26 * lug * la * step(0.001, L.y));
        // turf torn up where a tyre spun or slid on it (its print smeared): the soil under it, damp and dark
        // (render/Grass.js takes the blades away there)
        float torn = L.w * st * (1.0 - smoothstep(0.25, 0.6, clean)) * smoothstep(0.35, 0.6, tm.r);
        if (torn > 0.01 && uIds2.x >= 0.0) {
          vec4 soil = gColor(uIds2.x, uLay[int(uIds2.x)].x);
          alb = mix(alb, soil.rgb * uGain[int(uIds2.x)] * 0.7, torn);
        }
        rough = mix(rough, rough * (1.0 - L.z), st);
        gTrkWet = max(gTrkWet, st * L.z);
      }
    }
    // churned mud: a mud hole or field that trucks have been through before, old ruts crossing it, each pair one
    // truck's wheels, wandering and here and there worn out; their floors darker and wet, water standing along
    // stretches, the spoil beside them, their walls lit as relief (drawn only: the ground the tyres find is as it was)
    vec3 churnTilt = vec3(0.0);
    {
      float wmud = 0.0;
      for (int j = 0; j < 4; j++) { if (j >= gn) break; if (gL[j] == uIds2.y) wmud += max(0.0, hs[j] - top + 0.16); }
      float cf = wmud / sum * (1.0 - smoothstep(55.0, 120.0, dist)) * (1.0 - smoothstep(0.12, 0.45, tpx));
      if (cf > 0.0) {
        float inAll = 0.0, poolC = 0.0;
        for (int k = 0; k < 2; k++) {
          float fk = float(k);
          vec2 dir = k == 0 ? vec2(0.809, 0.588) : vec2(-0.391, 0.921), side = vec2(-dir.y, dir.x);
          float along = dot(vWPos.xz, dir);
          float across = dot(vWPos.xz, side) + (tn(vec2(along * 0.045, fk * 9.1)) - 0.5) * 8.0 + (tn(vec2(along * 0.13, fk * 3.3)) - 0.5) * 1.4;
          // a track every 9 m across, each worn in along some stretches and gone along others, broken up
          float lane = floor(across / 9.0), c = across - (lane + 0.5) * 9.0 + (th(vec2(lane, fk)) - 0.5) * 3.0;
          float on = smoothstep(0.5, 0.68, tn(vec2(along * 0.035 + lane * 3.7, lane * 1.3 + fk * 5.0))) * smoothstep(0.25, 0.5, tn(vec2(along * 0.4, lane * 2.9 + fk)));
          if (on <= 0.0) continue;
          float w = 0.17 + 0.12 * tn(vec2(along * 0.3, lane + fk * 3.0)), aa = tpx * 0.7;
          float r = abs(abs(c) - 0.8);
          float inR = (1.0 - smoothstep(w - 0.06 - aa, w + aa, r)) * on;
          float dep = 0.06 * on * (0.5 + tn(vec2(along * 0.2, lane + fk * 7.0)));
          // (the rut's profile, cos squared, and the spoil a little proud beside it: its slope across)
          float dHdr = r < w ? dep * 1.5708 / w * sin(3.1416 * r / w) : r < w + 0.3 ? dep * 0.25 * 3.1416 / 0.3 * cos((r - w) / 0.3 * 3.1416) : 0.0;
          churnTilt -= vec3(side.x, 0.0, side.y) * dHdr * sign(abs(c) - 0.8) * sign(c);
          inAll = max(inAll, inR);
          // (water standing only in the odd hollow of one)
          poolC = max(poolC, inR * smoothstep(0.72, 0.85, tn(vec2(along * 0.25 + lane * 2.1, fk * 4.0 + lane))) * (1.0 - smoothstep(0.0, w * 0.7, r)));
        }
        churnTilt *= cf * (1.0 - smoothstep(0.03, 0.12, tpx));
        alb *= mix(vec3(1.0), vec3(0.66, 0.64, 0.62), inAll * cf);
        rough = mix(rough, rough * 0.75, inAll * cf);
        gTrkWet = max(gTrkWet, inAll * cf * 0.45);
        gTrkPool = max(gTrkPool, poolC * cf * mix(0.6, 1.0, uDeepMud));
      }
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, alb * vTint, tex);
    gRough = mix(0.95, rough, tex);
    gH = mix(0.5, hgt / sum, tex);
    gNW = normalize(gNW + tilt * near * 0.9 + trkTilt * tex + tyreTilt * tex + churnTilt * tex);
    // bare rock in relief (a hill's rock is not a smooth bank with a picture of rock on it, world/Bedrock.js): its beds
    // as ledges up a face and stair steps across a slab, its joints as cracks between blocks, darker in the recesses;
    // reckoned in the map's frame from the ground's height before it (baseY), as its vertices near by are moved; out
    // where a ledge is under a few pixels it evens out, and farther the benches go on, every few beds, each bed a
    // shade of its own while it is a few pixels thick, until they too are under a few pixels
    float rw0 = 0.0;
    for (int j = 0; j < 4; j++) { if (j >= gn) break; if (gL[j] == uIds.y) rw0 += max(0.0, hs[j] - top + 0.16); }
    float rk0 = rw0 / sum;
    vec3 n0 = normalize(vWNormal);
    // (and not where the face is seen edge on: there its ledges glinted)
    rw0 = rw0 / sum * uRockBeds * smoothstep(0.12, 0.4, abs(dot(n0, normalize(cameraPosition - vWPos))));
    float fw = length(fwidth(vWPos)), fine = 1.0 - smoothstep(0.06, 0.25, fw);
    float rw = rw0 * fine, rf = rw0 * (1.0 - fine) * (1.0 - smoothstep(0.7, 2.4, fw));
    if (rw + rf > 0.0) {
      vec3 ta = normalize(vec3(n0.z, 0.0, -n0.x) + vec3(1e-5, 0.0, 0.0)), tb = cross(n0, ta);
      float sl = min(3.0, length(n0.xz) / max(n0.y, 0.3)), slab = 1.0 - smoothstep(0.4, 1.0, sl);
      vec3 p = vec3(vWPos.x - uCentre.x, vBaseY, vWPos.z - uCentre.y);
      if (rw > 0.0) {
        vec2 ax = vec2(n0.z * n0.z, n0.x * n0.x) / max(n0.x * n0.x + n0.z * n0.z, 1e-5);
        float e = 0.1, w = clamp(fw * 2.5, 0.0, 0.45);
        vec2 r0 = brOut(p, ax, slab, w);
        float ha = brOut(p + ta * e, ax, slab, w).x, hb = brOut(p + tb * e, ax, slab, w).x;
        vec3 slope = (ta * (ha - r0.x) + tb * (hb - r0.x)) / e * (0.35 + 0.65 * (1.0 - slab));
        gNW = normalize(gNW - slope * min(1.0, 0.9 / max(length(slope), 1e-4)) * rw);
        diffuseColor.rgb *= mix(1.0, r0.y * (0.88 + 0.4 * clamp(r0.x, 0.0, 0.4)), rw);
      }
      if (rf > 0.0) {
        // (the benches lit from their slope over a pixel or more, lighter on their lips and darker in the recesses
        // under them; and each bed its own shade, a few per cent lighter or darker, out to where they're a few pixels)
        float e = clamp(fw * 1.5, 0.3, 2.0), s0 = brBed(p), q = 1.0 - slab;
        float b0 = brBench(s0) * q, ba = brBench(brBed(p + ta * e)) * q, bb = brBench(brBed(p + tb * e)) * q;
        vec3 slope = (ta * (ba - b0) + tb * (bb - b0)) / e * (0.35 + 0.65 * q);
        gNW = normalize(gNW - slope * min(1.0, 0.9 / max(length(slope), 1e-4)) * rf);
        float tone = (hash21(vec2(floor(s0), 11.0)) - 0.5) * 0.18 * (1.0 - smoothstep(0.3, 0.8, fw));
        diffuseColor.rgb *= mix(1.0, (0.84 + 0.6 * b0) * (1.0 + tone), rf);
      }
      // (matt: a ledge's top seen edge on caught the sky as a white line)
      gRough = mix(gRough, 1.0, rw + rf);
    }
    // desert varnish (a map's varnish): the dark film of clay and manganese oxides a desert cliff takes on where water
    // runs down it after rain, in streaks hanging from its ledges, a few metres to tens long and as wide as a hand to
    // a couple of metres; out where a streak is under a pixel or two, a shade darker where they run (gone as the benches go)
    float vw = uVarnish * rk0 * smoothstep(0.78, 0.45, n0.y) * (1.0 - smoothstep(0.7, 2.4, fw));
    if (vw > 0.0) {
      float wx = n0.x * n0.x / max(n0.x * n0.x + n0.z * n0.z, 1e-5), acr = mix(vWPos.x, vWPos.z, wx);
      float st = tn(vec2(acr / 1.6, vWPos.y / 16.0)) * 0.7 + tn(vec2(acr / 0.55, vWPos.y / 6.0) + 3.1) * 0.3;
      float run = smoothstep(0.32, 0.62, tn(vec2(acr / 9.0, vWPos.y / 30.0) + 7.7));
      float v = mix(0.32, smoothstep(0.5, 0.74, st), 1.0 - smoothstep(0.25, 1.2, fw)) * run;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.42, 0.4), v * vw);
    }
  }` : ''}
  {
    // steep slopes seen from afar: gullies worn down them by the rain, a few metres to tens across, running downhill,
    // lit and shaded across the slope (out there a mountain's face was a smooth bank: the ground's grid is too coarse
    // for them, and the rock's relief close up is under a pixel); finer than a pixel they even out
    vec3 nG = normalize(vWNormal);
    float gw = smoothstep(0.88, 0.62, nG.y) * smoothstep(80.0, 220.0, dist);
    if (gw > 0.0) {
      // (in the world's own frame, two ways: gullies along x on a slope facing x, along z on one facing z, blended by
      // which way it faces; a frame turned with the slope was unsteady this far from the origin, and scrambled them)
      float wx = nG.x * nG.x / max(nG.x * nG.x + nG.z * nG.z, 1e-5), wz = 1.0 - wx;
      float pxg = length(fwidth(vWPos.xz));
      float a1 = 1.0 - smoothstep(1.0, 3.0, pxg), a2 = 1.0 - smoothstep(6.0, 18.0, pxg);
      vec2 p = vWPos.xz + vec2(0.0, vWPos.y * 0.3);
      // across the gullies: z on a slope facing x, x on one facing z (q: across / 9, along / 40, and finer)
      vec2 qa = vec2(p.y / 9.0, p.x / 40.0), qb = vec2(p.x / 9.0, p.y / 40.0);
      vec2 fa = vec2(p.y / 5.5, p.x / 22.0) + 7.3, fb = vec2(p.x / 5.5, p.y / 22.0) + 7.3;
      float hA = tn(qa) * a2 + (tn(fa) - 0.5) * 0.3 * a1, hB = tn(qb) * a2 + (tn(fb) - 0.5) * 0.3 * a1;
      float dA = (tn(qa + vec2(0.06, 0.0)) - tn(qa)) / (0.06 * 9.0) * a2 + (tn(fa + vec2(0.08, 0.0)) - tn(fa)) / (0.08 * 5.5) * 0.3 * a1;
      float dB = (tn(qb + vec2(0.06, 0.0)) - tn(qb)) / (0.06 * 9.0) * a2 + (tn(fb + vec2(0.08, 0.0)) - tn(fb)) / (0.08 * 5.5) * 0.3 * a1;
      gNW = normalize(gNW - vec3(dB * wz, 0.0, dA * wx) * 4.5 * gw);
      diffuseColor.rgb *= mix(1.0, 0.7 + 0.6 * clamp(hA * wx + hB * wz, 0.0, 1.0), gw * a2);
    }
  }
  if (vCover > 0.004) {
    // the woods past the map, crown by crown: clumps of them with clearings and ragged edges, each crown a bump lit by
    // the sun, lighter and darker, yellower and bluer (a pattern finer than a pixel evens out to its mean)
    vec2 p = vWPos.xz;
    float px = length(fwidth(p));
    float a1 = 1.0 - smoothstep(2.0, 6.0, px), a2 = 1.0 - smoothstep(5.0, 16.0, px), a3 = 1.0 - smoothstep(10.0, 40.0, px);
    float clump = tn(p / 31.0 + 11.7) * 0.65 + tn(p / 11.0 + 4.1) * 0.35;
    float cov = smoothstep(0.15, 0.85, vCover * 1.6 - 0.3 + (clump - 0.5) * 1.4 * a3);
    // crowns some 8 m across: their tops in the sun, the gaps between them in shade
    float c0 = tn(p / 7.0), cx = tn((p + vec2(2.4, 0.0)) / 7.0), cz = tn((p + vec2(0.0, 2.4)) / 7.0);
    float hue = tn(p / 17.0 + 3.3);
    vec3 crown = uFarForest * mix(1.0, 0.45 + 1.1 * smoothstep(0.2, 0.8, c0), a1) * mix(vec3(1.0), mix(vec3(0.85, 0.92, 1.0), vec3(1.25, 1.18, 0.78), hue), a2);
    diffuseColor.rgb = mix(diffuseColor.rgb, crown, cov);
    gNW = normalize(gNW + vec3(c0 - cx, 0.0, c0 - cz) * 4.0 * cov * a1);
    gRough = mix(gRough < 0.0 ? 0.95 : gRough, 0.9, cov);
  }
  diffuseColor.rgb *= vary;
  // wet ground, darker and glossier; and water standing in the ruts, in the hollows first, flat and shiny
  if (vWet.x + vWet.y + gTrkWet > 0.004) {
    float pool = max(clamp((vWet.y * 1.3 - gH) * 6.0, 0.0, 1.0), gTrkPool);
    // (the water lies in the hollows of the ground's relief; its bumps stand a little drier: wet mud is wet all over,
    // not dry lumps with water in the gaps between them, a network of dark cracks)
    float wv = max(max(clamp(vWet.x * (1.3 - 0.7 * gH), 0.0, 1.0), pool), gTrkWet);
    diffuseColor.rgb *= 1.0 - 0.45 * wv;
    gRough = mix(gRough < 0.0 ? 0.95 : gRough, 0.34, wv * 0.8);
    diffuseColor.rgb = mix(diffuseColor.rgb, uPuddle, pool * 0.85);
    // (its surface lies flat before it is smooth: a half-filled hollow is not a tilted mirror catching the sun)
    gRough = mix(gRough, 0.06, pool * pool);
    gNW = normalize(mix(gNW, vec3(0.0, 1.0, 0.0), smoothstep(0.0, 0.45, pool)));
    // (and a film of water smooths its fine relief: wet mud glistens in soft lumps, not a crust lit grain by grain)
    gNW = normalize(mix(gNW, normalize(vWNormal), 0.45 * wv));
    gPool = pool; gWet = wv;
  }
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (gRough >= 0.0) roughnessFactor = gRough;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);`)
        // wet ground: a film of water, which reflects half what the material's usual surface does (water's F0 is
        // 0.02, not 0.04); it mirrors the sky, but low down it would mirror the hills and the trees, not the bright
        // sky the light comes from; and the water in the ruts is murky
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
if (gWet > 0.0) {
  vec3 gR = reflect(normalize(vWPos - cameraPosition), gNW);
  // (but standing water, flat and smooth, gives back the hazy horizon brightly at a glancing look, as wet mud's skin of
  // water does on a map of deep mud, uDeepMud: dull there, they read as dry dark earth)
  float gLow = mix(mix(0.15, 0.4, uDeepMud), 0.6, gPool);
  float gSky = mix(gLow, 1.0, smoothstep(0.0, 0.4, gR.y));
  reflectedLight.indirectSpecular *= mix(1.0, gSky, gWet) * (1.0 - 0.25 * gPool);
  reflectedLight.directSpecular *= 1.0 - 0.5 * gWet;
}`);
    };
    return mat;
  }

  /** Graphics level: how far out the ground is textured, and whether close up its relief is lit. */
  setQuality(q) {
    if (!this.uniforms.uTexFar) return;
    this.uniforms.uTexFar.value = q === 'high' ? 320 : q === 'medium' ? 240 : 150;
    this.uniforms.uRelief.value = q === 'low' ? 0 : 1;
    this.fine = q !== 'low';
    this.uniforms.uTeaNear.value = TEA_RANGE[q] || TEA_RANGE.high;
  }

  /**
   * The ground under the woods: how many trees stand over each 2 m cell (a big map's 4 m: each tree counts fully under
   * its crown and less out to the edge of the needles and leaves it drops).
   */
  canopy() {
    const HALF = this.half, CS = 2 * this.res;
    const T = this.world.trees, n = Math.ceil(HALF * 2 / CS) + 1, g = new Float32Array(n * n);
    for (let t = 0; t < (T.base ?? T.count); t++) {                 // (the map's own trees: not the young ones)
      // conifers carpet the ground with needles; birches (type 2) and dead trees much less
      const litter = this.litter ? this.litter[T.type[t]] ?? 1 : T.type[t] === 2 ? 0.35 : T.type[t] === 3 ? 0.5 : 1;
      const R = 1.5 + T.h[t] * 0.3, cx = (T.x[t] + HALF) / CS, cz = (T.z[t] + HALF) / CS, r = R / CS;
      for (let k = Math.max(0, Math.floor(cz - r)); k <= Math.min(n - 1, Math.ceil(cz + r)); k++) {
        for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(n - 1, Math.ceil(cx + r)); i++) {
          const d = Math.hypot(i - cx, k - cz) / r;
          if (d < 1) g[k * n + i] += Math.min(1, 1.6 * (1 - d)) * litter;
        }
      }
    }
    return { n, g, at: (x, z) => {
      const fx = Math.min(n - 1.001, Math.max(0, (x + HALF) / CS)), fz = Math.min(n - 1.001, Math.max(0, (z + HALF) / CS));
      const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
      return (g[k * n + i] * (1 - tx) + g[k * n + i + 1] * tx) * (1 - tz) + (g[(k + 1) * n + i] * (1 - tx) + g[(k + 1) * n + i + 1] * tx) * tz;
    } };
  }

  /** Texture layer of a cell: its surface's, or the forest floor where trees stand on grass. */
  layerAt(s, x, z, canopy) {
    let name = LAYER_OF[s] || 'grass';
    while (this.layerIndex[name] === undefined && FALLBACK[name]) name = FALLBACK[name];
    if (name === 'grass' && this.layerIndex.forest !== undefined && canopy(x, z) + 0.7 * (vnoise(x / 7, z / 7, 907) - 0.5) + 0.6 * (vnoise(x / 2.2, z / 2.2, 908) - 0.5) > 1.15) return this.layerIndex.forest;
    return this.layerIndex[name] ?? 0;
  }

  /**
   * The colour of the land over a layer's texture (multiplies it): lush or dry grass and alpine turf, a little
   * variety in everything else, darker on broken steep ground, wet by the water. Writes linear RGB into out.
   */
  tintAt(layer, x, z, h, slope, out) {
    let r = 1, g = 1, b = 1;
    if (layer === this.layerIndex.grass) {
      const n = vnoise(x / 37, z / 37, 901) * 0.6 + vnoise(x / 9, z / 9, 902) * 0.4;
      const m = n < 0.5 ? LUSH : DRY, f = Math.min(1, Math.abs(n - 0.5) * 3);
      r += (m[0] - 1) * f; g += (m[1] - 1) * f; b += (m[2] - 1) * f;
      const t = Math.min(1, Math.max(0, (h - 120) / 160));
      r += (ALPINE[0] - r) * t; g += (ALPINE[1] - g) * t; b += (ALPINE[2] - b) * t;
      // shade grass and moss among the trees
      const c = Math.min(1, this.can(x, z) * 0.7);
      r *= 1 - 0.24 * c; g *= 1 - 0.16 * c; b *= 1 - 0.26 * c;
    } else {
      const f = 0.92 + 0.16 * vnoise(x / 6, z / 6, 903);
      r = f; g = f; b = f;
    }
    // (a map's own colours over its ground: its fields' crops, say)
    const mt = this.world.map?.tint;
    if (mt) { const c = this._mt ||= [1, 1, 1]; c[0] = r; c[1] = g; c[2] = b; mt(x, z, this.layers[layer]?.name, h, c); r = c[0]; g = c[1]; b = c[2]; }
    const sd = 1 - Math.min(0.25, slope * 0.12);
    r *= sd; g *= sd; b *= sd;
    const wl = this.world.water(x, z);
    if (wl > -1e8 && h < wl + 0.45) { const f = h < wl ? 0.7 : 0.82; r *= f; g *= f; b *= f; }
    out[0] = r; out[1] = g; out[2] = b;
    return out;
  }

  /**
   * The layer of every cell (for the shader), and the colour grid and its mip levels (for far away). The colour grid
   * has a point every other cell (the colour shows only on ground far enough off to be past its textures).
   */
  buildColors(onProgress) { for (const _ of this.colorSteps(onProgress)); }   // eslint-disable-line no-unused-vars

  /** A deferred terrain's colours, a few ms at a time between frames, then its material. */
  async ready(onProgress, slice = 6) {
    let t = performance.now();
    for (const _ of this.colorSteps(onProgress)) {                              // eslint-disable-line no-unused-vars
      if (performance.now() - t > slice) { await new Promise((r) => setTimeout(r, 0)); t = performance.now(); }
    }
    this.material = this.makeMaterial();
  }

  /** buildColors, a step at a time (every few rows of the grid, every mip level). */
  *colorSteps(onProgress) {
    const w = this.world, N = w.N, O = w.origin, RES = this.res, CS = 2, CN = Math.floor((N - 1) / CS) + 1;
    const col = new Uint8Array(CN * CN * 3), splat = new Uint8Array(N * N);
    const H = w.H, S = w.S, avg = this.layers.map((l) => l.avg), t3 = [0, 0, 0];
    const can = this.can = this.canopy().at;
    for (let k = 0; k < N; k++) {
      const z = O + k * RES;
      for (let i = 0; i < N; i++) {
        const x = O + i * RES;
        const idx = k * N + i;
        const L = this.layerAt(S[idx], x, z, can);
        splat[idx] = L;
        if (k % CS || i % CS) continue;
        const h = H[idx];
        const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), k0 = Math.max(0, k - 1), k1 = Math.min(N - 1, k + 1);
        const gx = (H[k * N + i1] - H[k * N + i0]) / ((i1 - i0) * RES), gz = (H[k1 * N + i] - H[k0 * N + i]) / ((k1 - k0) * RES);
        this.tintAt(L, x, z, h, Math.sqrt(gx * gx + gz * gz), t3);
        const a = avg[L], c = ((k / CS) * CN + i / CS) * 3;
        col[c] = Math.min(255, Math.round(Math.sqrt(a[0] * t3[0]) * 255));       // stored ~gamma 2 for precision
        col[c + 1] = Math.min(255, Math.round(Math.sqrt(a[1] * t3[1]) * 255));
        col[c + 2] = Math.min(255, Math.round(Math.sqrt(a[2] * t3[2]) * 255));
      }
      if (onProgress && k % 256 === 0) onProgress(k / N);
      if (k % 16 === 15) yield;
    }
    this.splat = splat;
    if (this.match.length || this.blend) yield* this.colourFix(col, CN, RES * CS);
    // mips: level L has cells 2^L cells wide (a box filter of the level below)
    this.mips = [{ n: CN, step: RES * CS, data: col }];
    let prev = this.mips[0];
    while (prev.n > 3) {
      const n = Math.floor((prev.n - 1) / 2) + 1, data = new Uint8Array(n * n * 3);
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0, cnt = 0;
          for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
            const pi = i * 2 + di, pk = k * 2 + dk;
            if (pi < 0 || pk < 0 || pi >= prev.n || pk >= prev.n) continue;
            const wgt = (di === 0 ? 2 : 1) * (dk === 0 ? 2 : 1);
            sum += prev.data[(pk * prev.n + pi) * 3 + c] * wgt; cnt += wgt;
          }
          data[(k * n + i) * 3 + c] = Math.round(sum / cnt);
        }
      }
      prev = { n, step: prev.step * 2, data };
      this.mips.push(prev);
      yield;
    }
    const li = this.layerIndex;
    // (the far rock toward a grey of its brightness: a red-brown one read pink through the haze)
    const r = avg[li.rock], lum = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2];
    this.farRock = r.map((c) => (c * 0.45 + lum * 0.55) * 0.85); this.farGrass = avg[li.grass]; this.farSnow = avg[li.snow ?? li.rock];
    this.farForest = [avg[li.grass][0] * 0.55, avg[li.grass][1] * 0.68, avg[li.grass][2] * 0.55];
  }

  /**
   * The open world: a stretch's land coloured as its neighbours' where they meet, close up and far off alike. Along each
   * seam, the neighbour's tints against this one's over the same kinds of ground either side (gravel against gravel,
   * grass against grass: over 32 m in from the seam, smoothed along it) give a factor this one's tints take at the
   * edge, fading to none `SEAM_BAND` m in. And the colour grid near a seam shows each kind of ground as the textures
   * there do (where this ground's textures give way to the neighbour's set, blend: that set's colour, as far as they
   * have given way to it), times its tint and that factor. (A factor from the land's average colour either side would
   * take on what differs in the land: grass beside a forest floor turned the colour of a forest floor, rock mauve.)
   */
  *colourFix(col, CN, step) {
    const w = this.world, h = this.half, O = w.origin, RES = this.res, avg = this.layers.map((l) => l.avg);
    const tn = [0, 0, 0], STEP = 16, n = Math.floor(2 * h / STEP) + 1;
    // (smoothed along the seam: the colours of the land, not of each field)
    const smooth = (f, R) => {
      const sm = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) for (let c = 0; c < 3; c++) {
        let sum = 0, cnt = 0;
        for (let q = Math.max(0, j - R); q <= Math.min(n - 1, j + R); q++) { sum += f[q * 3 + c]; cnt++; }
        sm[j * 3 + c] = sum / cnt;
      }
      return sm;
    };
    this.fix = this.match.map(({ side, toneAt }) => {
      const axisX = side === 'east' || side === 'west', sign = side === 'east' || side === 'south' ? 1 : -1;
      const so = new Float32Array(n * 3), st = new Float32Array(n * 3);
      for (let j = 0; j < n; j++) {
        const s = -h + j * STEP;
        // this side's tints over 32 m along the seam and 32 m in from it, and the neighbour's as far in on its side,
        // where the ground is of one kind
        for (let a = -16; a <= 16; a += step) for (let b = 0; b <= 32; b += step) {
          const x = axisX ? sign * (h - b) : s + a, z = axisX ? s + a : sign * (h - b);
          const i = Math.round((x - O) / step), k = Math.round((z - O) / step);
          if (i < 0 || k < 0 || i >= CN || k >= CN) continue;
          const L = this.splat[Math.round((z - O) / RES) * w.N + Math.round((x - O) / RES)];
          if (toneAt(axisX ? sign * (h + b) : s + a, axisX ? s + a : sign * (h + b), tn) !== this.layers[L].name) continue;
          for (let c = 0; c < 3; c++) {
            const v = col[(k * CN + i) * 3 + c] / 255;
            so[j * 3 + c] += v * v / Math.max(1e-4, avg[L][c]); st[j * 3 + c] += tn[c];
          }
        }
      }
      // (over more of the seam: where the ground either side is of one kind is here and there)
      const ss = smooth(so, 8), ts = smooth(st, 8), f = new Float32Array(n * 3);
      for (let q = 0; q < n * 3; q++) f[q] = ss[q] > 0.2 ? Math.min(2, Math.max(0.5, ts[q] / ss[q])) : 1;
      return { axisX, sign, f, STEP, n };
    });
    // each kind of ground's colour where the textures give way to the neighbour's set: the two sets' mixed, colour and
    // gain alike, as the shader mixes them
    const B = this.blend, gain = (l, c) => l.gain?.[c] ?? 1;
    const other = B ? this.layers.map((l) => B.ground.layers[B.ground.index[l.name]] || null) : null;
    const bAxisX = B && (B.side === 'east' || B.side === 'west'), bSign = B && (B.side === 'east' || B.side === 'south') ? 1 : -1;
    const shownAt = (L, x, z, out) => {
      const l = this.layers[L], o = other?.[L];
      const u = o ? Math.min(1, Math.max(0, (h - bSign * (bAxisX ? x : z)) / B.band)) : 1, t = 1 - u * u * (3 - 2 * u);
      for (let c = 0; c < 3; c++) {
        out[c] = t ? (l.avg[c] / gain(l, c) * (1 - t) + o.avg[c] / gain(o, c) * t) * (gain(l, c) * (1 - t) + gain(o, c) * t) : l.avg[c];
      }
      return out;
    };
    const f3 = [0, 0, 0], a3 = [0, 0, 0], R = Math.ceil(Math.max(SEAM_BAND, B?.band ?? 0) / step) + 1;
    for (let k = 0; k < CN; k++) {
      const z = O + k * step;
      for (let i = 0; i < CN; i++) {
        // (a row clear of the seams' bands across the middle: only its ends)
        if (i === R && CN - R > R && h - Math.abs(z) >= R * step) { i = CN - R - 1; continue; }
        const x = O + i * step, fixed = this.fixAt(x, z, f3);
        const L = this.splat[Math.round((z - O) / RES) * w.N + Math.round((x - O) / RES)];
        shownAt(L, x, z, a3);
        if (!fixed && a3[0] === avg[L][0] && a3[1] === avg[L][1] && a3[2] === avg[L][2]) continue;
        const o = (k * CN + i) * 3;
        for (let c = 0; c < 3; c++) {
          const v = col[o + c] / 255, tint = v * v / Math.max(1e-4, avg[L][c]);
          col[o + c] = Math.min(255, Math.round(Math.sqrt(a3[c] * tint * (fixed ? f3[c] : 1)) * 255));
        }
      }
      if (k % 64 === 63) yield;
    }
  }

  /** The factor on the tints of the land at (x, z) (colourFix): false where there is none. */
  fixAt(x, z, out) {
    if (!this.fix) return false;
    out[0] = out[1] = out[2] = 1;
    let any = false;
    for (const F of this.fix) {
      const d = this.half - F.sign * (F.axisX ? x : z);
      if (d >= SEAM_BAND || d < -1) continue;
      const t = Math.max(0, d) / SEAM_BAND, w = 1 - t * t * (3 - 2 * t);
      const u = Math.min(F.n - 1.001, Math.max(0, ((F.axisX ? z : x) + this.half) / F.STEP)), j = Math.floor(u), r = u - j;
      for (let c = 0; c < 3; c++) out[c] *= 1 + ((F.f[j * 3 + c] * (1 - r) + F.f[(j + 1) * 3 + c] * r) - 1) * w;
      any = true;
    }
    return any;
  }

  /** Past the map: the layer the shader shows (rock on the steeps, snow on the tops, grass below). */
  farLayer(h, ny) {
    const li = this.layerIndex;
    return ny < 0.7 ? li.rock : h > this.snowLine + 40 ? li.snow ?? li.rock : li.grass;
  }

  /**
   * The kind of ground at (x, z) (its layer's name: null past the map), with the tint over its texture there written
   * into out (from the colour grid: for colourFix).
   */
  toneAt(x, z, out) {
    const w = this.world, m = this.mips?.[0];
    if (!m || Math.abs(x) > this.half || Math.abs(z) > this.half) return null;
    const CS = Math.round(m.step / this.res);
    const i = Math.min(m.n - 1, Math.max(0, Math.round((x - w.origin) / m.step))), k = Math.min(m.n - 1, Math.max(0, Math.round((z - w.origin) / m.step)));
    const L = this.splat[k * CS * w.N + i * CS], a = this.layers[L].avg, o = (k * m.n + i) * 3;
    for (let c = 0; c < 3; c++) { const v = m.data[o + c] / 255; out[c] = v * v / Math.max(1e-4, a[c]); }
    return this.layers[L].name;
  }

  /** Colour (linear RGB) at (x, z) for a patch with vertex spacing `spacing`. */
  colorAt(x, z, spacing, h, slope, out, woods = true) {
    const w = this.world;
    if (Math.abs(x) <= this.half && Math.abs(z) <= this.half) {
      let L = 0;
      while (L < this.mips.length - 1 && this.mips[L].step * 2 <= spacing) L++;
      const m = this.mips[L];
      const fx = Math.min(m.n - 1.001, Math.max(0, (x - w.origin) / m.step)), fz = Math.min(m.n - 1.001, Math.max(0, (z - w.origin) / m.step));
      const i = Math.floor(fx), k = Math.floor(fz), tx = fx - i, tz = fz - k;
      const o = (k * m.n + i) * 3, d = m.data, rn = m.n * 3;
      for (let c = 0; c < 3; c++) {
        const v = (d[o + c] * (1 - tx) + d[o + 3 + c] * tx) * (1 - tz) + (d[o + rn + c] * (1 - tx) + d[o + rn + 3 + c] * tx) * tz;
        out[c] = (v / 255) * (v / 255);
      }
      return out;
    }
    // past the map: grass and woods low down, rock on the steeps, snow on the tops (woods false: without the woods,
    // which the shader draws over it, crown by crown: farCover)
    const n = vnoise(x / 400, z / 400, 905);
    const f = woods ? this.farCover(x, z, h, slope) : 0;
    const rock = Math.min(1, Math.max(0, (slope - 1.15) * 2.5));
    const snow = Math.min(1, Math.max(0, (h - this.snowLine - 30 - 40 * n) / 40));
    for (let c = 0; c < 3; c++) out[c] = this.farGrass[c] + (this.farForest[c] - this.farGrass[c]) * f;
    for (let c = 0; c < 3; c++) out[c] += (this.farRock[c] - out[c]) * rock;
    for (let c = 0; c < 3; c++) out[c] += (this.farSnow[c] - out[c]) * snow;
    return out;
  }

  /**
   * Past the map: how wooded the land is (0 to 1): in broad tracts, as wooded as the map beside it has it (its
   * farWoods), thinning out on the cliffs and under the snow.
   */
  farCover(x, z, h, slope) {
    const w = this.world, d = w.woods ? w.woods(x, z) : w.map.farWoods ?? 0.65;
    const n = vnoise(x / 400, z / 400, 905) * 0.7 + vnoise(x / 110, z / 110, 906) * 0.3;
    const t = Math.min(1, Math.max(0, (n - 0.65 + 0.5 * d) / 0.2));
    const cliff = Math.min(1, Math.max(0, (slope - 1.1) * 2.5)), high = Math.min(1, Math.max(0, (h - this.snowLine + 260) / 200));
    return t * t * (3 - 2 * t) * (1 - cliff) * (1 - high);
  }

  /**
   * How wet the ground is at a vertex (0 to 1, into out[o]) and how deep the water stands in its rut (out[o + 1]):
   * mud is wet, more in places, its ruts wetter the deeper they are, and the deep ones hold water; the ground at the
   * water's edge is wet too, and the earth round mud, damp at its edge rather than dry up to it (on every patch alike:
   * only on the near ones, it ended in a straight line where they met the coarser ones). d: the rut's depth (m).
   */
  wetAt(x, z, h, d, out, o) {
    const w = this.world, s = w.surfaceId(x, z);
    let wv = 0, pv = 0;
    if (s !== SURFACE.MUD && s !== SURFACE.ROCK && s !== SURFACE.ROAD) {
      for (let j = 0; j < FRINGE.length; j += 2) {
        if (w.surfaceId(x + FRINGE[j], z + FRINGE[j + 1]) !== SURFACE.MUD) continue;
        wv = Math.max(wv, (j < 8 ? 0.42 : 0.24) * (0.7 + 0.6 * vnoise(x / 2.3, z / 2.3, 913)));
        if (j < 8) break;
      }
    }
    // (a map's deep mud, world/World.js softness, the wetter: water stands in it)
    const base = WET[s] && s === SURFACE.MUD && w.map.deepMud ? WET[s] * 1.5 : WET[s];
    if (base) {
      wv = Math.max(wv, base * (0.6 + 0.8 * vnoise(x / 13, z / 13, 911)));
      if (d > 0.004) {
        wv = Math.max(wv, Math.min(0.8, 0.3 + d * 4));
        // (the water lies in the rut's floor, more of it in the deeper ones)
        const t = Math.min(1, Math.max(0, (d - 0.05) / 0.11));
        pv = t * t * (3 - 2 * t) * (0.55 + 0.45 * vnoise(x / 3, z / 3, 912));
      }
    }
    // (and wet up the bank from the water's edge: the water's level there, or a few metres off at the shore)
    let wl = w.water(x, z);
    if (wl < -1e8) for (let j = 0; j < SHORE.length; j += 2) wl = Math.max(wl, w.water(x + SHORE[j], z + SHORE[j + 1]));
    if (wl > -1e8 && h < wl + 0.6) wv = Math.max(wv, h < wl ? 0.6 : 0.85 * (1 - (h - wl) / 0.6));
    out[o] = Math.round(wv * 255); out[o + 1] = Math.round(pv * 255);
  }

  /** The ground's height at (x, z): the map's (without a worn track's wear: base), or past it the land beyond. */
  heightAt(x, z, base = false) {
    if (Math.abs(x) <= this.half && Math.abs(z) <= this.half) return base && this.world.terrainBase ? this.world.terrainBase(x, z) : this.world.terrain(x, z);
    return (this.beyond ? this.beyond(x, z) : this.world.farHeight(x, z)) - (this.far ? this.holeSink(x, z) : 0);
  }

  /**
   * The far land under a map's square, sunk below the map's own ground (the more the further in): it is drawn a little
   * way in from the square's edge where nothing lies beyond it (HOLE_BAND, the shader), so that where the map's ground
   * and the far land each leave a pixel to the other along the edge (on a crest seen from afar, by a hair either side
   * of the line), it shows the land, not the sky.
   */
  holeSink(x, z) {
    let s = 0;
    for (let i = 0; i < this.holes.length; i++) {
      const H = this.holes[i], hx0 = H[0], hz0 = H[1], hx1 = H[2], hz1 = H[3];
      if (!(x > hx0 && x < hx1 && z > hz0 && z < hz1)) continue;
      s = Math.max(s, 0.5 + 1.5 * Math.min(x - hx0, hx1 - x, z - hz0, hz1 - z));
    }
    return s;
  }

  /**
   * A patch's vertex arrays: a set let go by a patch made again or dropped (release), or new ones. (A patch is some
   * 150 kB of them: made new for every patch, driving fast, they were garbage enough to stall the game tens of ms as it
   * was collected.)
   */
  arrays(nV) {
    const a = this.pool?.pop();
    if (a) { a.wet.fill(0); a.cover.fill(0); return a; }
    return { pos: new Float32Array(nV * 3), nor: new Int8Array(nV * 3), col: new Uint8Array(nV * 3), tint: new Uint8Array(nV * 3), wet: new Uint8Array(nV * 2), cover: new Uint8Array(nV), baseY: new Float32Array(nV), colF: new Float32Array(nV * 3) };
  }

  /** A patch's geometry let go, its arrays kept for the next patch. */
  release(g) {
    g.dispose();
    const a = g.userData.arrays;
    if (a && (this.pool ||= []).length < POOL) this.pool.push(a);
  }

  /** Build a patch, all of it now. */
  build(node) {
    if (this.job?.node === node) this.job = null;
    builtThisFrame++;
    const it = this.steps(node, false);
    while (!it.next().done);
  }

  /**
   * Build a patch as far as this frame's time for the ground allows (one at a time, on over the next frames: a coarse
   * patch of the far land, each of its vertices sampling the land of every map round it, takes longer than a frame
   * has): true once it is built. Another asked for while one is on the way waits, unless that one is no longer wanted.
   */
  grow(node) {
    const J = this.job;
    if (J && J.node !== node && J.at >= this.frame - 1) return false;
    if (!J || J.node !== node) this.job = { node, it: this.steps(node, true), at: this.frame };
    this.job.at = this.frame;
    builtThisFrame++;
    do { if (this.job.it.next().done) { this.job = null; return true; } } while (timeLeft());
    return false;
  }

  /**
   * A patch's geometry, made a row of its vertices a step (own: in the scratch arrays of the one patch being grown, its
   * steps spread over frames, not those a patch built all at once uses).
   */
  *steps(node, own) {
    const { x0, z0, size } = node;
    const sp = size / GRID;
    const near = sp <= 1;
    // heights with a one-vertex border for the normals
    const VB = V + 2, w = this.world, ruts = near && w.deformGrid.chunks.size > 0;
    const J = own ? (this.jobTmp ||= { H: new Float32Array(VB * VB), D: new Float32Array(V * V), E: new Float32Array((V + 6) * (V + 6)), R: new Float32Array(VB * VB), Q: new Float32Array(VB * VB * 5), P: new Float32Array(VB * VB) }) : null;
    const T = own ? J.H : this.tmpH, D = own ? J.D : this.tmpD;
    // (a worn track's ruts, hump and potholes, world/Worn.js: the potholes are in the heights the normals are reckoned
    // from, the ruts only in the vertices' own, the shader lighting them from their profile, which is finer than the
    // vertices out past the nearest patches; and where each vertex is on the track, trk, for the shader. So too bare
    // rock's relief, world/Bedrock.js: on the vertices of the patches near enough for it (a vertex a metre apart or
    // closer), lit by the shader from the ground's height before it, baseY, everywhere)
    const worn = !this.far && w.worn && sp <= 2 && w.worn.near(x0, z0, size, 3) ? w.worn : null;
    const rock = !this.far && w.rockRelief && sp <= 1;
    // (and a rough track's holes, P: their depth, for the water standing in them)
    const R = own ? J.R : this.tmpR, Q = own ? J.Q : this.tmpQ, P = own ? J.P : this.tmpP;
    if (worn) {
      for (let k = -1; k <= V; k++) for (let i = -1; i <= V; i++) {
        if (i === -1 && k > -1) yield;
        const x = x0 + i * sp, z = z0 + k * sp, e = (k + 1) * VB + (i + 1);
        T[e] = this.heightAt(x, z, true);
        R[e] = 0; P[e] = 0; Q[e * 5] = 9; Q[e * 5 + 1] = 0; Q[e * 5 + 2] = 9; Q[e * 5 + 3] = 9; Q[e * 5 + 4] = 0;
        const hit = Math.abs(x) <= this.half && Math.abs(z) <= this.half ? worn.nearest(x, z) : null;
        if (!hit) continue;
        const q = worn.shape(hit, x, z, w.wear(x, z));
        // (a root's bump, pot < 0, left out: render/Roots.js draws it, the root itself)
        const pot = Math.max(0, q.pot);
        T[e] -= pot; R[e] = WornTracks.profile(q.u, q.depth);
        Q[e * 5] = q.u; Q[e * 5 + 1] = q.s; Q[e * 5 + 2] = q.depth; Q[e * 5 + 3] = q.W; Q[e * 5 + 4] = pot;
        if (worn.lines[hit.t].rough) P[e] = pot;
      }
      // (a vertex past the track's reach beside one within it carries the track on, as that one has it a step further
      // out: between it and one off the track altogether u would run back through the ruts' place, and the verge's
      // grass would stop short on that side, the track's own earth showing past it in steps as the vertices are; P -1
      // marks it, so the track is carried one step only)
      for (let k = -1; k <= V; k++) for (let i = -1; i <= V; i++) {
        const e = (k + 1) * VB + (i + 1);
        if (Q[e * 5] !== 9 || Math.abs(x0 + i * sp) > this.half || Math.abs(z0 + k * sp) > this.half) continue;
        let f = -1;
        for (let j = 0; j < 4; j++) {
          const ii = i + (j === 0 ? -1 : j === 1 ? 1 : 0), kk = k + (j === 2 ? -1 : j === 3 ? 1 : 0);
          if (ii < -1 || kk < -1 || ii > V || kk > V) continue;
          const g = (kk + 1) * VB + (ii + 1);
          if (Q[g * 5] !== 9 && P[g] >= 0 && (f < 0 || Math.abs(Q[g * 5]) > Math.abs(Q[f * 5]))) f = g;
        }
        if (f < 0) continue;
        Q[e * 5] = Q[f * 5] + Math.sign(Q[f * 5]) * sp; Q[e * 5 + 1] = Q[f * 5 + 1]; Q[e * 5 + 2] = Q[f * 5 + 2]; Q[e * 5 + 3] = Q[f * 5 + 3];
        P[e] = -1;
      }
    } else {
      for (let k = -1; k <= V; k++) {
        for (let i = -1; i <= V; i++) T[(k + 1) * VB + (i + 1)] = this.heightAt(x0 + i * sp, z0 + k * sp, true);
        yield;
      }
    }
    // the ruts (kept for their colour and wetness too)
    D.fill(0);
    if (ruts) {
      // (with a wider border on the finest patches, for the ring round each point their berms are reckoned from)
      const fine = sp < 0.5, B = fine ? 3 : 1, EB = V + 2 * B, E = own ? J.E : this.tmpE;
      for (let k = -B; k < V + B; k++) for (let i = -B; i < V + B; i++) {
        const x = x0 + i * sp, z = z0 + k * sp;
        E[(k + B) * EB + i + B] = Math.abs(x) < this.half && Math.abs(z) < this.half ? w.deformGrid.get(x, z) : 0;
      }
      for (let k = -1; k <= V; k++) for (let i = -1; i <= V; i++) {
        const e = (k + B) * EB + i + B, d = E[e];
        let dh = d;
        if (fine) {
          const ring = E[e - 2] + E[e + 2] + E[e - 2 * EB] + E[e + 2 * EB] + E[e - EB - 1] + E[e - EB + 1] + E[e + EB - 1] + E[e + EB + 1];
          dh -= Math.max(0, ring / 8 - d) * BERM;
        }
        T[(k + 1) * VB + i + 1] -= dh;
        if (i >= 0 && k >= 0 && i < V && k < V) D[k * V + i] = d;
      }
    }
    const nV = V * V + 4 * V, A = this.arrays(nV);
    const { pos, nor, col, tint, wet, cover, baseY, colF } = A;
    const trk = worn ? new Float32Array(nV * 4).fill(9) : null;
    const c3 = [0, 0, 0], t3 = [0, 0, 0], f3 = [0, 0, 0];
    const inMap = (x, z) => Math.abs(x) <= this.half && Math.abs(z) <= this.half;
    let minY = Infinity, maxY = -Infinity;
    for (let k = 0; k < V; k++) for (let i = 0; i < V; i++) {
      const v = k * V + i;
      const b = T[(k + 1) * VB + (i + 1)], vx = x0 + i * sp, vz = z0 + k * sp;
      const h = b - (worn ? R[(k + 1) * VB + (i + 1)] : 0) + (rock && inMap(vx, vz) ? w.rockAt(vx, vz, b) : 0);
      baseY[v] = b;
      const gx = (T[(k + 1) * VB + i + 2] - T[(k + 1) * VB + i]) / (2 * sp), gz = (T[(k + 2) * VB + i + 1] - T[k * VB + i + 1]) / (2 * sp);
      let nx = -gx, ny = 1, nz = -gz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
      pos[v * 3] = i * sp; pos[v * 3 + 1] = h; pos[v * 3 + 2] = k * sp;
      nor[v * 3] = Math.round(nx * 127); nor[v * 3 + 1] = Math.round(ny * 127); nor[v * 3 + 2] = Math.round(nz * 127);
      const x = x0 + i * sp, z = z0 + k * sp, slope = Math.sqrt(gx * gx + gz * gz);
      const out = !inMap(x, z);
      this.colorAt(x, z, sp, h, slope, c3, !out);
      if (out) cover[v] = Math.round(this.farCover(x, z, h, slope) * 255);
      // the tint over the textures: the land's own, or past the map the far colour over the layer the shader shows
      const L = out ? -1 : this.splat[Math.round((z - w.origin) / w.res) * w.N + Math.round((x - w.origin) / w.res)];
      if (!out) this.tintAt(L, x, z, h, slope, t3);
      else { const a = this.layers[this.farLayer(h, ny)].avg; for (let c = 0; c < 3; c++) t3[c] = Math.min(2, Math.max(0.4, c3[c] / a[c])); }
      if (this.fixAt(x, z, f3)) for (let c = 0; c < 3; c++) t3[c] *= f3[c];
      const d = D[v];
      if (d > 0.004) {
        // pressed and churned ground in the ruts; where a spinning tyre has dug through the turf, the soil under it
        // (the grass drawn the colour of the map's bare earth)
        const f = 1 - Math.min(0.45, d * 2.6), soil = this.layerIndex.dirt ?? this.layerIndex.mud;
        if ((L === this.layerIndex.grass || L === this.layerIndex.forest) && soil !== undefined) {
          const k = Math.min(1, (d - 0.004) / 0.02), a = this.layers[L].avg, e = this.layers[soil].avg;
          for (let c = 0; c < 3; c++) t3[c] *= 1 + (e[c] / Math.max(1e-4, a[c]) - 1) * k;
        }
        c3[0] *= f; c3[1] *= f * 0.97; c3[2] *= f * 0.94;
        t3[0] *= f; t3[1] *= f * 0.97; t3[2] *= f * 0.94;
      }
      let pot = 0;
      if (worn) {
        const e = ((k + 1) * VB + (i + 1)) * 5;
        for (let c = 0; c < 4; c++) trk[v * 4 + c] = Q[e + c];
        pot = Q[e + 4];
      }
      // (the water in a pothole as in a rut)
      if (inMap(x, z)) this.wetAt(x, z, h, d + pot, wet, v * 2);
      // (and in a rough track's holes on any ground, world/Worn.js holeWater: most of them hold the rain, brown with
      // the earth stirred up in it, its banks wet; the odd one drained)
      const hole = worn ? P[(k + 1) * VB + (i + 1)] : 0;
      if (hole > 0.02) {
        const full = WornTracks.holds(x, z), t = Math.min(1, Math.max(0, (hole - 0.06) / 0.1));
        wet[v * 2] = Math.max(wet[v * 2], Math.round(Math.min(0.85, 0.35 + hole * 2.5) * 255));
        wet[v * 2 + 1] = Math.max(wet[v * 2 + 1], Math.round(full * t * t * (3 - 2 * t) * (0.7 + 0.3 * vnoise(x / 2, z / 2, 916)) * 255));
      }
      col[v * 3] = Math.round(Math.sqrt(c3[0]) * 255); col[v * 3 + 1] = Math.round(Math.sqrt(c3[1]) * 255); col[v * 3 + 2] = Math.round(Math.sqrt(c3[2]) * 255);
      for (let c = 0; c < 3; c++) tint[v * 3 + c] = Math.min(255, Math.round(t3[c] * 255 / this.tintK));
      if (h < minY) minY = h; if (h > maxY) maxY = h;
      if (i === V - 1) yield;
    }
    // skirts
    const drop = Math.max(1.5, sp * 2.5);
    const edgeIdx = [(t) => t, (t) => GRID * V + t, (t) => t * V, (t) => t * V + GRID];
    for (let e = 0; e < 4; e++) for (let t = 0; t < V; t++) {
      const src = edgeIdx[e](t), dst = V * V + e * V + t;
      pos[dst * 3] = pos[src * 3]; pos[dst * 3 + 1] = pos[src * 3 + 1] - drop; pos[dst * 3 + 2] = pos[src * 3 + 2];
      for (let c = 0; c < 3; c++) { nor[dst * 3 + c] = nor[src * 3 + c]; col[dst * 3 + c] = col[src * 3 + c]; tint[dst * 3 + c] = tint[src * 3 + c]; }
      wet[dst * 2] = wet[src * 2]; wet[dst * 2 + 1] = wet[src * 2 + 1]; cover[dst] = cover[src];
      if (trk) for (let c = 0; c < 4; c++) trk[dst * 4 + c] = trk[src * 4 + c];
      baseY[dst] = baseY[src];
    }
    // colours are stored gamma-2 encoded: decode in the attribute by squaring? Keep simple: convert to linear floats
    for (let n = 0; n < nV * 3; n++) { const v = col[n] / 255; colF[n] = v * v; }
    const g = new THREE.BufferGeometry();
    g.userData.arrays = A;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(colF, 3));
    g.setAttribute('tint', new THREE.BufferAttribute(tint, 3, true));
    g.setAttribute('wet', new THREE.BufferAttribute(wet, 2, true));
    g.setAttribute('cover', new THREE.BufferAttribute(cover, 1, true));
    g.setAttribute('trk', trk ? new THREE.BufferAttribute(trk, 4) : this.noTrk);
    g.setAttribute('baseY', new THREE.BufferAttribute(baseY, 1));
    g.setIndex(this.index);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(size / 2, (minY + maxY) / 2, size / 2), Math.sqrt(2 * (size / 2) ** 2 + ((maxY - minY + drop) / 2) ** 2));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY - drop, 0), new THREE.Vector3(size, maxY, size));
    if (node.mesh) { this.release(node.mesh.geometry); node.mesh.geometry = g; } else {
      node.mesh = new THREE.Mesh(g, this.material);
      node.mesh.position.set(x0, 0, z0);
      node.mesh.matrixAutoUpdate = false;
      node.mesh.updateMatrix();
      node.mesh.receiveShadow = true;
    }
    node.edge = this.clip && (x0 < -this.half || z0 < -this.half || x0 + size > this.half || z0 + size > this.half);
    node.mesh.castShadow = this.casts(node);
    node.minY = minY; node.maxY = maxY;
    node.built = true;
    node.dirty = false;
  }

  node(level, ix, iz) {
    const key = level * 1e8 + ix * 1e4 + iz;
    let n = this.cache.get(key);
    if (!n) {
      const size = this.root / (1 << level);
      n = { key, level, ix, iz, size, x0: -this.root / 2 + ix * size, z0: -this.root / 2 + iz * size, mesh: null, built: false, used: 0, minY: 0, maxY: 0 };
      this.cache.set(key, n);
    }
    return n;
  }

  /** Has a 16 m patch ruts in it? (One rut chunk exactly: both are on the same 16 m grid.) */
  rutted(n) {
    const G = this.world.deformGrid;
    return G.chunks.size > 0 && G.chunks.has(DeformGrid.key(Math.round(n.x0 / DEFORM_SPAN), Math.round(n.z0 / DEFORM_SPAN)));
  }

  /** Mark patches that show ruts in the given world rectangles as needing a rebuild. */
  markDirty(chunkKeys) {
    const taken = this.world.deformGrid.taken;
    for (const key of chunkKeys) {
      const [x0, z0, x1, z1] = DeformGrid.bounds(key), q = taken.get(key) ?? 15;
      for (const n of this.cache.values()) {
        if (!n.built || n.size / GRID > 1) continue;
        if (!(n.x0 < x1 && n.x0 + n.size > x0 && n.z0 < z1 && n.z0 + n.size > z0)) continue;
        // (a fine patch: only if its quarter of the chunk changed)
        if (n.size < DEFORM_SPAN && !(q & (1 << ((n.x0 - x0 >= n.size ? 1 : 0) + (n.z0 - z0 >= n.size ? 2 : 0))))) continue;
        if (!n.dirty) { n.dirty = true; n.dirtySince = this.frame; }
      }
    }
  }

  /**
   * The open world's far land: a map come in. Its square is left to it from now on, and the far land round it (which
   * now meets its edge) is made again, a patch at a time as the frames allow (till then the old, the shader cutting the
   * square out of it: made again all at once, it was a hitch of tens of ms as each map came in).
   */
  setHole(i, rect, margin = 1500) {
    this.holes[i] = rect;
    const [x0, z0, x1, z1] = rect;
    this.uniforms.uHoles?.value[i].set(x0 + 0.02, z0 + 0.02, x1 - 0.02, z1 - 0.02);
    for (const n of this.cache.values()) {
      if (!(n.x0 < x1 + margin && n.x0 + n.size > x0 - margin && n.z0 < z1 + margin && n.z0 + n.size > z0 - margin)) continue;
      if (n.built && !n.dirty) { n.dirty = true; n.dirtySince = this.frame; }
    }
  }

  /** The root's four patches (always drawn), built ahead a step at a time, awaiting wait() between the steps. */
  async prebuild(wait) {
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 2; ix++) {
      const n = this.node(1, ix, iz);
      if (n.built || ((this.clip || this.far) && this.skip(n))) continue;
      const it = this.steps(n, true);
      while (!it.next().done) await wait();
    }
  }

  /** The open world: a neighbour come in past a map's edge. The patches along the edge are made again on its ground. */
  remakeEdge() {
    const h = this.half;
    for (const n of this.cache.values()) {
      // (a patch whose border of samples, a vertex wide, reaches past the square)
      const sp = n.size / GRID;
      if (n.built && !n.dirty && (n.x0 - sp < -h || n.z0 - sp < -h || n.x0 + n.size + sp > h || n.z0 + n.size + sp > h)) { n.dirty = true; n.dirtySince = this.frame; }
    }
  }

  /** Does a patch cast the sun's shadow: a near one, of a map's own ground. */
  casts(n) { return this.shadows && !this.far && !n.edge && n.size / GRID <= 4; }

  /** A patch none of which is drawn: in the open world, wholly off its map's square, or (the far land) on a map's. */
  skip(n) {
    const x0 = n.x0, z0 = n.z0, x1 = x0 + n.size, z1 = z0 + n.size;
    if (this.clip) return x1 <= -this.half || x0 >= this.half || z1 <= -this.half || z0 >= this.half;
    for (const [hx0, hz0, hx1, hz1] of this.holes) if (x0 >= hx0 + HOLE_BAND && x1 <= hx1 - HOLE_BAND && z0 >= hz0 + HOLE_BAND && z1 <= hz1 - HOLE_BAND) return true;
    return false;
  }

  update(camPos, dir = null) {
    this.frame++;
    const visible = [], dirty = [];
    let budget = this.budget;
    // (behind the camera, the ground is left coarse: a patch more than 80 m off and more than about 120 degrees round
    // from the way it looks isn't split finer, nor built finer, until the view comes round to it)
    const hx = dir ? dir.x : 0, hz = dir ? dir.z : 0, hl = Math.hypot(hx, hz);
    const want = (n) => {
      const cx = n.x0 + n.size / 2, cz = n.z0 + n.size / 2;
      const dx = Math.max(0, Math.abs(camPos.x - cx) - n.size / 2), dz = Math.max(0, Math.abs(camPos.z - cz) - n.size / 2);
      const dy = n.built ? Math.max(0, camPos.y - n.maxY, n.minY - camPos.y) : 0, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (hl > 0.2 && d > 80) {
        const rx = cx - camPos.x, rz = cz - camPos.z;
        if ((rx * hx + rz * hz) / ((Math.hypot(rx, rz) || 1) * hl) < -0.5) return false;
      }
      return (n.size > MIN || (n.size > FINE && this.fine && this.rutted(n))) && d < n.size * this.split * 0.5;
    };
    const visit = (n) => {
      n.used = this.frame;
      if ((this.clip || this.far) && this.skip(n)) return;
      if (want(n)) {
        const kids = [this.node(n.level + 1, n.ix * 2, n.iz * 2), this.node(n.level + 1, n.ix * 2 + 1, n.iz * 2), this.node(n.level + 1, n.ix * 2, n.iz * 2 + 1), this.node(n.level + 1, n.ix * 2 + 1, n.iz * 2 + 1)];
        let ready = true;
        for (const k of kids) {
          if (!k.built && !((this.clip || this.far) && this.skip(k))) { if (budget > 0 && mayBuild() && this.grow(k)) budget--; else ready = false; }
        }
        if (ready || !n.built) { for (const k of kids) visit(k); return; }
      }
      if (!n.built) this.build(n);
      if (n.dirty) dirty.push(n);
      visible.push(n);
    };
    // the root's four children are always there
    for (let iz = 0; iz < 2; iz++) for (let ix = 0; ix < 2; ix++) visit(this.node(1, ix, iz));
    // fresh ruts: a truck ploughing new mud changes the ground under it every frame, so its patches are rebuilt in
    // turn, a couple a frame
    if (dirty.length) {
      dirty.sort((a, b) => a.dirtySince - b.dirtySince);
      for (let i = 0; i < dirty.length && i < RUT_BUDGET && budget > 0 && mayBuild(); i++) if (this.grow(dirty[i])) budget--; else break;
    }
    // swap the visible set into the scene
    const g = this.group;
    for (let i = g.children.length - 1; i >= 0; i--) g.remove(g.children[i]);
    for (const n of visible) { g.add(n.mesh); n.mesh.castShadow = this.casts(n); }
    this.visibleCount = visible.length;
    // evict patches unused for a while
    if (this.cache.size > MAX_CACHE) {
      const old = [...this.cache.values()].filter((n) => n.used < this.frame - 120 && n.level > 2).sort((a, b) => a.used - b.used);
      for (const n of old.slice(0, this.cache.size - MAX_CACHE + 50)) {
        if (n.mesh) this.release(n.mesh.geometry);
        this.cache.delete(n.key);
      }
    }
  }
}
