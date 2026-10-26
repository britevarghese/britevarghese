// Boulders: fractured blocks of rock (world/RockShapes.js, the same shapes the physics drives on), instanced, in
// three levels of detail by distance. They wear the scanned rock of the ground textures (render/Ground.js), mapped
// from the three axes in world space so no face stretches, with its relief in the lighting, moss and lichen on the
// faces that look up, and darker undersides where they sit in the ground.
import * as THREE from 'three';
import { HASH21 } from './ShaderHash.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rockShape, shapeOf, ROCK_SHAPES, BLOCK_SHAPES } from '../world/RockShapes.js';

const LODS = [4, 2, 1];                  // icosphere subdivisions: near, middle, far
const LOD_Q = [22, 80];                  // switch at distance / size
const FAR = 1800;

function rockGeometry(k, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const { radius } = rockShape(k);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    v.multiplyScalar(radius(v.x, v.y, v.z));
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.5;                // flatter underside
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * The rock's material. ledge: for a canyon's ledges (render/Ledges.js): coloured by their vertices (their bed's band),
 * darkened by aAO under their lips, streaked with desert varnish down their faces, and no moss.
 */
export function rockMaterial(ground, { ledge = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: ground ? 0xffffff : 0x8a857d, roughness: 0.82, metalness: 0, vertexColors: ledge });
  if (!ground) return mat;
  // (the two kinds compiled apart: their shaders differ, the function that makes them doesn't)
  mat.customProgramCacheKey = () => (ledge ? 'rock ledge' : 'rock');
  const L = ground.index.rock, grass = ground.index.grass ?? L, lay = ground.layers[L];
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uGC: { value: ground.color }, uGN: { value: ground.normal },
      uRock: { value: L }, uMossL: { value: grass }, uScale: { value: 1 / (lay.size * 0.6) }, uGain: { value: new THREE.Vector3(...lay.gain) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vRPos;
varying vec3 vRNor;
varying float vRY;
${ledge ? 'attribute float aAO;\nvarying float vAO;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
{
  mat4 im = mat4(1.0);
#ifdef USE_INSTANCING
  im = instanceMatrix;
#endif
  mat3 r = mat3(im);
  vec3 n = objectNormal / vec3(dot(r[0], r[0]), dot(r[1], r[1]), dot(r[2], r[2]));
  vRNor = normalize(mat3(modelMatrix) * (r * n));
  vRPos = (modelMatrix * im * vec4(transformed, 1.0)).xyz;
  vRY = position.y;
  ${ledge ? 'vAO = aAO;' : ''}
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform highp sampler2DArray uGC;
uniform highp sampler2DArray uGN;
uniform float uRock;
uniform float uMossL;
uniform float uScale;
uniform vec3 uGain;
varying vec3 vRPos;
varying vec3 vRNor;
varying float vRY;
${ledge ? 'varying float vAO;' : ''}
${HASH21}
float rh(vec2 p) { return hash21(p); }
float rn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1, 0)), u.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), u.x), u.y); }
vec3 gRockN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 n = normalize(vRNor);
  vec3 w = pow(abs(n), vec3(4.0));
  w /= w.x + w.y + w.z;
  float sx = n.x >= 0.0 ? 1.0 : -1.0, sy = n.y >= 0.0 ? 1.0 : -1.0, sz = n.z >= 0.0 ? 1.0 : -1.0;
  vec2 uX = vec2(-vRPos.z * sx, vRPos.y) * uScale, uY = vec2(vRPos.x, -vRPos.z * sy) * uScale, uZ = vec2(vRPos.x * sz, vRPos.y) * uScale;
  vec3 c = texture(uGC, vec3(uX, uRock)).rgb * w.x + texture(uGC, vec3(uY, uRock)).rgb * w.y + texture(uGC, vec3(uZ, uRock)).rgb * w.z;
  vec2 tX = texture(uGN, vec3(uX, uRock)).rg * 2.0 - 1.0, tY = texture(uGN, vec3(uY, uRock)).rg * 2.0 - 1.0, tZ = texture(uGN, vec3(uZ, uRock)).rg * 2.0 - 1.0;
  vec3 tilt = vec3(0.0, tX.y, -sx * tX.x) * w.x + vec3(tY.x, 0.0, -sy * tY.y) * w.y + vec3(sz * tZ.x, tZ.y, 0.0) * w.z;
  gRockN = normalize(n + tilt);
  c *= uGain;
${ledge ? `  // in the shadow of the recess under the lip; and desert varnish, iron and manganese, streaked dark down the faces
  // where water runs off the ledge above
  c *= vAO;
  float st = rn(vec2((vRPos.x + vRPos.z) * 0.55, vRPos.y * 0.035)) * 0.7 + rn(vec2((vRPos.x - vRPos.z) * 1.7, vRPos.y * 0.09)) * 0.3;
  c *= mix(1.0, 0.62, smoothstep(0.55, 0.85, st) * (1.0 - smoothstep(0.3, 0.7, abs(n.y))));
  c *= 0.86 + 0.14 * smoothstep(-0.6, 0.4, n.y);` : `  // moss and lichen where rain and leaves settle: the faces that look up
  float m = smoothstep(0.6, 0.95, n.y) * smoothstep(0.52, 0.78, rn(vRPos.xz * 0.8) * 0.6 + rn(vRPos.xz * 3.7) * 0.4);
  vec3 moss = texture(uGC, vec3(vec2(vRPos.x, -vRPos.z) * 0.6, uMossL)).rgb * vec3(0.55, 0.66, 0.42);
  c = mix(c, moss, m * 0.7);
  // dark and damp low down, where it sits in the soil
  c *= mix(0.55, 1.0, smoothstep(-0.45, 0.1, vRY)) * (0.82 + 0.18 * smoothstep(-0.6, 0.4, n.y));`}
  diffuseColor.rgb *= c;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(gRockN, 0.0)).xyz);`);
  };
  return mat;
}

export class Rocks {
  /** ground: the loaded ground textures (render/Ground.js), or null for plain grey rock. */
  constructor(world, scene, ground = null) {
    const B = this.boulders = world.boulders;
    const mat = rockMaterial(ground);
    // count each shape's boulders: every level of detail of a shape can hold all of them
    // (and the blocks of the tors, their own shapes)
    const per = new Array(ROCK_SHAPES + BLOCK_SHAPES).fill(0);
    // (but a pillar's blocks: render/Pillars.js draws its column)
    B.forEach((b, i) => { if (b.pillar === undefined) per[shapeOf(i, b)]++; });
    this.meshes = [];
    for (let k = 0; k < ROCK_SHAPES + BLOCK_SHAPES; k++) {
      if (k >= ROCK_SHAPES && !per[k]) { this.meshes.push([]); continue; }        // (a map without tors: no blocks)
      this.meshes.push(LODS.map((d) => {
        const mesh = new THREE.InstancedMesh(rockGeometry(k, d), mat, Math.max(1, per[k]));
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, per[k]) * 3), 3);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        scene.add(mesh);
        return mesh;
      }));
    }
    // each boulder's transform and tone, made once (in flat arrays: copied into the instances as they are sorted), and
    // its shape (a pillar's blocks: none)
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
    this.mats = new Float32Array(B.length * 16);
    B.forEach((b, i) => m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromAxisAngle(up, b.yaw), new THREE.Vector3(b.rx, b.ry, b.rz)).toArray(this.mats, i * 16));
    this.shape = Int16Array.from(B, (b, i) => (b.pillar === undefined ? shapeOf(i, b) : -1));
    // (a map's rockTint: its rock in its own colours, render/Terrain.js's tint: a block of the bedrock in its bed's, a
    // stone in that of whichever bed it fell from)
    const tint = world.map.rockTint ? world.map.tint : null, c = [1, 1, 1];
    this.tones = new Float32Array(B.length * 3);
    B.forEach((b, i) => {
      const t = 0.8 + b.shade * 0.35;
      c[0] = t * 1.02; c[1] = t; c[2] = t * 0.95;
      if (tint) { c[0] = c[1] = c[2] = t; tint(b.x, b.z, 'rock', b.block !== undefined ? b.y : b.y + b.shade * 60, c); }
      this.tones.set(c, i * 3);
    });
    this.size = B.map((b) => Math.max(b.rx, b.ry, b.rz));
    this.half = world.half ?? Infinity;
    this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.shadows = true;
  }

  /**
   * Put each boulder into the level of detail for its distance, once the camera has moved a few metres (the farther
   * it is from the map, the more: its levels change the slower). True if it did (a few milliseconds' work on a map of
   * thousands: the open world's views take turns, one a frame).
   */
  update(camera) {
    const cam = camera.position, H = this.half;
    const away = Math.hypot(Math.max(0, Math.abs(cam.x) - H), Math.max(0, Math.abs(cam.z) - H));
    if (Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < Math.max(6, away * 0.04)) return false;
    this.last.copy(cam);
    for (const lods of this.meshes) for (const m of lods) m.count = 0;
    const B = this.boulders, cx = cam.x, cz = cam.z, F2 = FAR * FAR, S = this.mats, C = this.tones;
    for (let i = 0; i < B.length; i++) {
      const b = B[i], k = this.shape[i], dx = b.x - cx, dz = b.z - cz, d2 = dx * dx + dz * dz;
      if (d2 > F2 || k < 0) continue;
      const q = Math.sqrt(d2) / this.size[i], lod = q < LOD_Q[0] ? 0 : q < LOD_Q[1] ? 1 : 2;
      const mesh = this.meshes[k][lod], n = mesh.count++, M = mesh.instanceMatrix.array, T = mesh.instanceColor.array;
      for (let j = 0, o = n * 16, s = i * 16; j < 16; j++) M[o + j] = S[s + j];
      T[n * 3] = C[i * 3]; T[n * 3 + 1] = C[i * 3 + 1]; T[n * 3 + 2] = C[i * 3 + 2];
    }
    for (const lods of this.meshes) for (const m of lods) {
      // (only the instances drawn sent to the graphics card, not the whole buffer)
      const M = m.instanceMatrix, C = m.instanceColor;
      if (m.count) {
        M.clearUpdateRanges(); M.addUpdateRange(0, m.count * 16); M.needsUpdate = true;
        if (C) { C.clearUpdateRanges(); C.addUpdateRange(0, m.count * 3); C.needsUpdate = true; }
      }
      m.castShadow = this.shadows && m !== lods[2];
    }
    return true;
  }

  setShadows(on) { this.shadows = on; this.last.set(1e9, 0, 1e9); }
}

export async function preview(world, r) {
  const { loadGround } = await import('./Ground.js');
  return new Rocks(world, r.scene, await loadGround().catch(() => null));
}
