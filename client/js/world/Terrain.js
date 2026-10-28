// Chunked heightfield terrain with multi-layer PBR material blending (grass / dry soil / rock / scorched earth),
// anti-tiling (dual-scale sampling + macro variation), plus asphalt road ribbons with worn markings.
import * as THREE from 'three';
import { MAP_HALF, ROADS, BUILDINGS, FLAGS, PROPS, groundHeight, terrainHeight, ACTIVE_MAP, seaFactor } from '/shared/map.js';
import { fbm, smoothstep } from '/shared/util.js';
import { buildBoxGeometry } from '../render/Materials.js';

export function buildTerrain(assets, quality) {
  const group = new THREE.Group();
  group.name = 'terrain';
  // big (battle royale) islands: coarser vertices and more chunks, so the vertex count and culling stay sane
  const big = Math.max(1, Math.min(1.6, MAP_HALF / 280));
  const res = (quality === 'verylow' ? 2.5 : quality === 'low' ? 2 : quality === 'ultra' ? 0.9 : quality === 'high' ? 1 : 1.25) * big;
  const chunks = Math.max(8, Math.round((MAP_HALF * 2) / 90)), size = (MAP_HALF * 2) / chunks;
  const tex = ['grass', 'dirt', 'rock', 'burnt'].map((k) => assets.textureSet(k));
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, map: tex[0].map, normalMap: tex[0].normalMap, envMapIntensity: 0.55 });
  material.onBeforeCompile = (sh) => {
    sh.uniforms.tDirt = { value: tex[1].map }; sh.uniforms.tRock = { value: tex[2].map }; sh.uniforms.tBurnt = { value: tex[3].map };
    sh.uniforms.nDirt = { value: tex[1].normalMap }; sh.uniforms.nRock = { value: tex[2].normalMap };
    sh.uniforms.uGrassTint = { value: new THREE.Vector3(...(ACTIVE_MAP.atmosphere?.grass || [1, 1, 1])) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tDirt, tRock, tBurnt, nDirt, nRock;
        uniform vec3 uGrassTint;
        varying vec4 vSplat; varying vec3 vWPos;
        float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hsh(i),hsh(i+vec2(1,0)),f.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),f.x), f.y); }
        vec4 tri(sampler2D t, vec2 uv){ // dual-scale sampling breaks visible tiling
          float m = vnoise(uv*0.11);
          return mix(texture2D(t, uv), texture2D(t, uv*0.37 + vec2(0.31,0.17)), 0.35 + 0.3*m);
        }`)
      .replace('#include <map_fragment>', `
        vec2 wuv = vWPos.xz / 3.2;
        vec4 cG = tri(map, wuv);
        vec4 cD = tri(tDirt, wuv*0.8);
        cD.rgb *= vec3(0.84, 0.8, 0.74); // the dry-ground scan is near white in this light: earthier
        vec4 cR = tri(tRock, wuv*0.6);
        vec4 cB = texture2D(tBurnt, wuv*0.7);
        float macro = vnoise(vWPos.xz*0.02) * 0.6 + vnoise(vWPos.xz*0.09) * 0.4;
        float wd = clamp(vSplat.x + (macro-0.55)*0.6, 0.0, 1.0);
        float wr = clamp(vSplat.y, 0.0, 1.0);
        float wb = clamp(vSplat.z, 0.0, 1.0);
        // height-based blend sharpening using albedo luminance as a cheap height proxy
        float hG = dot(cG.rgb, vec3(0.33)) , hD = dot(cD.rgb, vec3(0.33));
        wd = smoothstep(0.0, 1.0, clamp((wd - 0.5) * 2.2 + (hD - hG) * 1.5 + 0.5, 0.0, 1.0));
        // living grass: green/olive hue variation at two scales so fields never look like one flat colour
        float hue = vnoise(vWPos.xz*0.035) * 0.65 + vnoise(vWPos.xz*0.18) * 0.35;
        cG.rgb *= mix(vec3(0.78, 0.98, 0.62), vec3(1.02, 0.98, 0.78), hue) * uGrassTint;
        vec4 col = mix(cG, cD, wd);
        col = mix(col, cR, wr);
        col = mix(col, cB, wb);
        col.rgb *= 0.86 + 0.28 * macro;
        diffuseColor *= col;
        float terrainRough = mix(0.95, 0.85, wr);
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;')
      .replace('#include <normal_fragment_maps>', `
        vec3 nG = texture2D(normalMap, wuv).xyz * 2.0 - 1.0;
        vec3 nD = texture2D(nDirt, wuv*0.8).xyz * 2.0 - 1.0;
        vec3 nR = texture2D(nRock, wuv*0.6).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(mix(mix(nG, nD, wd), nR, wr));
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );
      `);
  };
  // precomputed tangent frame for a plane rotated flat: use USE_TANGENT-free path (three computes tbn from derivatives)
  // scorched ground: around ruined buildings, the contested centre flag and under every burnt-out wreck of this map
  const burnSpots = [...BUILDINGS.filter((b) => b.damage > 0.25).map((b) => ({ x: b.x, z: b.z, r: Math.max(b.w, b.d) * 0.9 })), ...(FLAGS[1] ? [{ x: FLAGS[1].x, z: FLAGS[1].z, r: 11 }] : []), ...PROPS.filter((p) => p.burnt).map((p) => ({ x: p.x, z: p.z, r: 6 }))];
  for (let cz = 0; cz < chunks; cz++) {
    for (let cx = 0; cx < chunks; cx++) {
      const x0 = -MAP_HALF + cx * size, z0 = -MAP_HALF + cz * size;
      const seg = Math.round(size / res);
      const g = new THREE.PlaneGeometry(size, size, seg, seg);
      g.rotateX(-Math.PI / 2);
      g.translate(x0 + size / 2, 0, z0 + size / 2);
      const pos = g.attributes.position;
      const splat = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const h = groundHeight(x, z);
        pos.setY(i, h);
        const slope = Math.abs(groundHeight(x + 1, z) - groundHeight(x - 1, z)) + Math.abs(groundHeight(x, z + 1) - groundHeight(x, z - 1));
        // worn ground: a narrow, noise-broken gravel / dirt edge along roads (beyond their sidewalks) and paving, a
        // trodden strip at house walls, patchy trampled ground in flag zones — no bright rings or stripes
        const n1 = fbm(x / 6, z / 6, 2, 11), n2 = fbm(x / 2.2, z / 2.2, 2, 12);
        const rd = edgeDistance(x, z);
        let dirt = (1 - smoothstep(0, 0.5 + 1.1 * n1, rd)) * (0.35 + 0.55 * n2) + smoothstep(0.58, 0.8, fbm(x / 22, z / 22, 3, 3)) * 0.62;
        for (const b of ACTIVE_MAP.buildingsNear(x, z)) {
          const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
          dirt = Math.max(dirt, (1 - smoothstep(0.15, 0.5 + 1.2 * n1, Math.hypot(dx, dz))) * (0.3 + 0.5 * n2));
        }
        for (const f of FLAGS) { const d = Math.hypot(x - f.x, z - f.z); if (d < f.r * 0.95) dirt = Math.max(dirt, (1 - smoothstep(f.r * 0.2, f.r * 0.95, d)) * 0.55 * smoothstep(0.4, 0.68, fbm(x / 4, z / 4, 3, 17))); }
        let burnt = 0;
        for (const s of burnSpots) { const d = Math.hypot(x - s.x, z - s.z); if (d < s.r) burnt = Math.max(burnt, 1 - smoothstep(s.r * 0.3, s.r, d)); }
        if (burnt > 0) burnt *= 0.5 + 0.5 * fbm(x / 4, z / 4, 2, 9);
        const sea = seaFactor(x, z);
        if (sea > 0) dirt = 1;
        splat[i * 4] = Math.min(1, dirt);
        splat[i * 4 + 1] = smoothstep(0.9, 2.0, slope);
        splat[i * 4 + 2] = smoothstep(0.35, 0.8, burnt);
        splat[i * 4 + 3] = 0;
      }
      g.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, material);
      mesh.receiveShadow = true;
      mesh.name = `terrain_${cx}_${cz}`;
      group.add(mesh);
    }
  }
  group.add(buildRoads(assets));
  if (ROADS.some((r) => r.kind === 'rail')) group.add(buildRailway(assets));
  group.add(buildPaving(assets));
  // outer landscape continuing the terrain beyond the playable area (rolling hills rising to distant ridges): square
  // rings around the map, the innermost tucked 0.6 m under the detailed terrain's edge, so it never pokes through
  // the playable ground (a uniform grid's coarse triangles used to cut through it near the edge)
  const og = outerGeometry();
  const op = og.attributes.position;
  const osplat = new Float32Array(op.count * 4);
  for (let i = 0; i < op.count; i++) {
    const x = op.getX(i), z = op.getZ(i);
    osplat[i * 4] = 0.25 + 0.4 * fbm(x / 90, z / 90, 2, 4); osplat[i * 4 + 1] = smoothstep(40, 90, op.getY(i)) * 0.7;
  }
  og.setAttribute('splat', new THREE.BufferAttribute(osplat, 4));
  og.computeVertexNormals();
  const outer = new THREE.Mesh(og, material);
  outer.receiveShadow = true; outer.name = 'outer_terrain';
  group.add(outer);
  return group;
}

const segDist = (x, z, r) => {
  const dx = r.bx - r.ax, dz = r.bz - r.az, t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(r.ax + dx * t - x, r.az + dz * t - z);
};
// distance from the edge of the hard ground: roads (+ their sidewalks) and paved areas; negative on them
function edgeDistance(x, z) {
  let d = Infinity;
  for (const r of ROADS) d = Math.min(d, segDist(x, z, r) - r.w / 2 - (r.kind ? 0 : r.sidewalk || 0));
  for (const p of ACTIVE_MAP.PAVED) {
    const ox = Math.max(p.x0 - x, x - p.x1), oz = Math.max(p.z0 - z, z - p.z1);
    d = Math.min(d, ox > 0 || oz > 0 ? Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) : Math.max(ox, oz));
  }
  return d;
}

function outerGeometry() {
  const H = MAP_HALF, side = Math.max(60, Math.ceil((2 * H) / 6)); // vertices per ring side (~6 m at the seam)
  const rings = [-1.5, 3, 8, 15, 25, 40, 60, 90, 130, 180, 250, 340, 450, 600, 800, 1100].map((d) => H + d).filter((r) => r < 1300);
  rings.push(1300);
  const P = [], I = [], per = side * 4;
  for (const [k, r] of rings.entries()) {
    for (let i = 0; i < per; i++) {
      // walk the square's perimeter: 4 sides of `side` steps each
      const s = Math.floor(i / side), t = (i % side) / side * 2 - 1;
      const [x, z] = s === 0 ? [t * r, -r] : s === 1 ? [r, t * r] : s === 2 ? [-t * r, r] : [-r, -t * r];
      P.push(x, k === 0 ? groundHeight(x, z) - 0.6 : outerHeight(x, z), z);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < per; i++) {
    const a = k * per + i, b = k * per + ((i + 1) % per), c = a + per, d = b + per;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((P.length / 3) * 2), 2));
  g.setIndex(I);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(per) < 0) { const idx = g.index.array; for (let q = 0; q < idx.length; q += 3) { const tmp = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = tmp; } }
  return g;
}

export function outerHeight(x, z) {
  const r = Math.max(Math.abs(x), Math.abs(z));
  if (r < MAP_HALF - 2) return terrainHeight(x, z) - 4; // hidden beneath the detailed terrain
  return terrainHeight(x, z) + smoothstep(MAP_HALF, 900, r) * (35 + 70 * fbm(x / 260, z / 260, 3, 21)) * (1 - seaFactor(x, z));
}

function buildRoads(assets) {
  const t = assets.textureSet('asphalt');
  const mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.arm, aoMap: t.arm, roughness: 1, metalness: 0, envMapIntensity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 roadUv;\nvarying vec2 vRoad;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = roadUv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vRoad;
        float rh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // worn centre dashes + edge lines, partially erased
        float u = vRoad.x, v = vRoad.y;
        float wear = step(0.35, rh(floor(vec2(v*0.5, u*8.0))));
        float centre = step(abs(u - 0.5), 0.012) * step(fract(v / 6.0), 0.5);
        float edge = step(abs(abs(u - 0.5) - 0.44), 0.01);
        float paint = max(centre, edge) * wear * 0.75;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.74, 0.62), paint);
        // dirt creeping in at the edges
        float e = smoothstep(0.38, 0.5, abs(u - 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85,0.78,0.66), e * 0.7);`);
  };
  const P = [], N = [], UV = [], RU = [], I = [];
  // every ribbon gets its own few millimetres of lift (wider roads on top, crossing lanes of one width staggered)
  // so the ribbons never share a plane at junctions
  const widths = [...new Set(ROADS.map((r) => r.w))].sort((a, b) => a - b);
  for (const [ri, r] of ROADS.entries()) {
    if (r.kind) continue;
    const lift = 0.03 + 0.007 * widths.indexOf(r.w) + 0.0025 * (ri % 3);
    const dx = r.bx - r.ax, dz = r.bz - r.az, L = Math.hypot(dx, dz);
    const fx = dx / L, fz = dz / L, sx = -fz, sz = fx;
    const steps = Math.ceil(L / 2);
    const across = 6;
    const base = P.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, cx = r.ax + dx * t, cz = r.az + dz * t;
      for (let j = 0; j <= across; j++) {
        const u = j / across, off = (u - 0.5) * r.w;
        const x = cx + sx * off, z = cz + sz * off;
        P.push(x, groundHeight(x, z) + lift, z);
        N.push(0, 1, 0);
        UV.push(x / 6, z / 6);
        RU.push(u, t * L);
      }
    }
    for (let i = 0; i < steps; i++) for (let j = 0; j < across; j++) {
      const a = base + i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1;
      I.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('roadUv', new THREE.Float32BufferAttribute(RU, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  // fix winding if normals point down
  if (g.attributes.normal.getY(0) < 0) { const idx = g.index.array; for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.name = 'roads';
  return m;
}

// railway (roads with kind 'rail'): a raised gravel ballast bed with two tracks of concrete sleepers and steel rails
// (axis-aligned lines: boxes; three draw calls in all)
function buildRailway(assets) {
  const group = new THREE.Group(); group.name = 'railway';
  const rock = assets.textureSet('rock');
  const ballast = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, color: 0x9a968e, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const P = [], I = [], UV = [], parts = [];
  for (const r of ROADS) {
    if (r.kind !== 'rail') continue;
    const dx = r.bx - r.ax, dz = r.bz - r.az, L = Math.hypot(dx, dz), fx = dx / L, fz = dz / L, sx = -fz, sz = fx;
    const steps = Math.ceil(L / 2), across = 8, base = P.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, cx = r.ax + dx * t, cz = r.az + dz * t;
      for (let j = 0; j <= across; j++) {
        const u = j / across, off = (u - 0.5) * r.w, x = cx + sx * off, z = cz + sz * off;
        // bed profile: 0.1 m crown with sloped shoulders
        P.push(x, groundHeight(x, z) + 0.02 + 0.08 * smoothstep(r.w / 2, r.w / 2 - 1.4, Math.abs(off)), z);
        UV.push(x / 2.5, z / 2.5);
      }
    }
    for (let i = 0; i < steps; i++) for (let j = 0; j < across; j++) { const a = base + i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1; I.push(a, c, b, b, c, d); }
    if (Math.abs(fx) > 1e-6 && Math.abs(fz) > 1e-6) continue; // sleepers / rails as boxes only on axis-aligned lines
    const alongX = Math.abs(fx) > 0.5;
    for (const track of r.w >= 8 ? [-2.25, 2.25] : [0]) {
      for (let u = 0.4; u < L - 0.3; u += 0.65) { // sleepers: 2.6 x 0.24 x 0.16 m
        const cx = r.ax + fx * u + sx * track, cz = r.az + fz * u + sz * track, y = groundHeight(cx, cz) + 0.1;
        parts.push(alongX ? { min: [cx - 0.12, y - 0.06, cz - 1.3], max: [cx + 0.12, y + 0.1, cz + 1.3], mat: 'sleeper' } : { min: [cx - 1.3, y - 0.06, cz - 0.12], max: [cx + 1.3, y + 0.1, cz + 0.12], mat: 'sleeper' });
      }
      for (const g of [-0.7175, 0.7175]) for (let u = 0; u < L - 1e-6; u += 4) { // rails in 4 m lengths following the ground
        const u1 = Math.min(L, u + 4), um = (u + u1) / 2, cx = r.ax + fx * um + sx * (track + g), cz = r.az + fz * um + sz * (track + g), y = groundHeight(cx, cz) + 0.2;
        const ax = r.ax + fx * u + sx * (track + g), az = r.az + fz * u + sz * (track + g), bx = r.ax + fx * u1 + sx * (track + g), bz = r.az + fz * u1 + sz * (track + g);
        parts.push({ min: [Math.min(ax, bx) - (alongX ? 0 : 0.035), y, Math.min(az, bz) - (alongX ? 0.035 : 0)], max: [Math.max(ax, bx) + (alongX ? 0 : 0.035), y + 0.15, Math.max(az, bz) + (alongX ? 0.035 : 0)], mat: 'rail' });
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const idx = g.index.array; for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; } g.computeVertexNormals(); }
  const bed = new THREE.Mesh(g, ballast); bed.receiveShadow = true; bed.name = 'ballast'; group.add(bed);
  const conc = assets.textureSet('concrete');
  const mats = { sleeper: new THREE.MeshStandardMaterial({ map: conc.map, color: 0x8f8a82, roughness: 0.95, metalness: 0 }), rail: new THREE.MeshStandardMaterial({ color: 0x6d625a, roughness: 0.42, metalness: 0.85 }) };
  for (const [m, geo] of buildBoxGeometry(parts, { tile: 1.2 })) { const mesh = new THREE.Mesh(geo, mats[m]); mesh.castShadow = m === 'rail'; mesh.receiveShadow = true; mesh.name = `rail_${m}`; group.add(mesh); }
  return group;
}

// ---------------------------------------------------------------- paving
// Map-level paved areas (squares, yards, quays), sidewalks with kerb stones along roads with `sidewalk`, and painted
// yard markings: meshes draped over the terrain a few cm up (visual only: the physics ground stays the terrain, so
// feet sink ~8 cm into a sidewalk). One mesh per material. Real texture sizes: cobble 2 m, pavers 1.8 m, concrete 3 m.
// [texture set, metres per texture tile, albedo multiplier (the worn-concrete scan is as dark as the asphalt: lifted)]
const PAVE = { cobble: ['cobble', 2.0, [0.85, 0.82, 0.78]], pavers: ['pavement', 1.8, [0.9, 0.89, 0.85]], pavement: ['pavement', 1.8, [0.94, 0.93, 0.89]], concrete: ['concrete_floor', 3.0, [1.2, 1.19, 1.15]], asphalt: ['asphalt', 3.0, [1, 1, 1]] };
const SIDEWALK_Y = 0.08, KERB_Y = 0.11, KERB_W = 0.15;
function buildPaving(assets) {
  const group = new THREE.Group(); group.name = 'paving';
  const M = ACTIVE_MAP, G = groundHeight;
  const geo = new Map(); // kind -> { P, UV, I }
  const buf = (k) => geo.get(k) || geo.set(k, { P: [], UV: [], I: [] }).get(k);
  // quad a-c (one row) / d-e (the next row); `flip` turns the winding so the face points the other way
  const quad = (b, a, c, d, e, flip = false) => (flip ? b.I.push(a, c, e, a, e, d) : b.I.push(a, e, c, a, d, e));
  // draped grid over a rect (paved areas, markings), facing up
  const drape = (b, x0, z0, x1, z1, lift, cell, uvs) => {
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), nz = Math.max(1, Math.ceil((z1 - z0) / cell)), base = b.P.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx, z = z0 + ((z1 - z0) * j) / nz;
      b.P.push(x, G(x, z) + lift, z); b.UV.push(x / uvs, -z / uvs);
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = base + j * (nx + 1) + i; quad(b, a, a + 1, a + nx + 1, a + nx + 2); }
  };
  for (const p of M.PAVED) drape(buf(p.kind), p.x0, p.z0, p.x1, p.z1, 0.02, 2, PAVE[p.kind]?.[1] || 3);
  // sidewalks: both sides of each road, cut where another roadway crosses (and, at corners, where an earlier road's
  // sidewalk already runs), at paved squares and buildings; the kerb runs along the whole roadway edge
  const onRoad = (x, z, self) => ROADS.some((r) => r !== self && segDist(x, z, r) < r.w / 2);
  const onSide = (x, z, before) => before.some((r) => { const d = segDist(x, z, r) - r.w / 2; return d >= 0 && d < r.sidewalk; });
  const inside = (x, z) => M.PAVED.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) || M.buildingsNear(x, z).some((b) => Math.abs(x - b.x) < b.w / 2 + 0.05 && Math.abs(z - b.z) < b.d / 2 + 0.05);
  const kerbs = { P: [], UV: [], I: [] };
  for (const [ri, r] of M.SIDEWALKS.entries()) {
    const L = Math.hypot(r.bx - r.ax, r.bz - r.az), fx = (r.bx - r.ax) / L, fz = (r.bz - r.az) / L, nx = -fz, nz = fx, sw = r.sidewalk, h0 = r.w / 2;
    const before = M.SIDEWALKS.slice(0, ri);
    for (const side of [-1, 1]) {
      const at = (t, off) => [r.ax + fx * t + nx * side * off, r.az + fz * t + nz * side * off];
      const step = 0.25, okW = [], okK = [];
      for (let t = 0; t <= L + 1e-6; t += step) {
        const [cx, cz] = at(t, h0 + sw / 2), [kx, kz] = at(t, h0 + 0.08), [ox, oz] = at(t, h0 + sw - 0.05);
        const kerbOk = !onRoad(kx, kz, r);
        okK.push(kerbOk);
        okW.push(kerbOk && !onRoad(cx, cz, r) && !onRoad(ox, oz, r) && !onSide(cx, cz, before) && !onSide(kx, kz, before) && !inside(cx, cz));
      }
      // runs of consecutive good samples -> profiles extruded along the road
      const runs = (ok) => {
        const out = []; let s0 = -1;
        ok.forEach((v, i) => { if (v && s0 < 0) s0 = i; if ((!v || i === ok.length - 1) && s0 >= 0) { const e = v ? i : i - 1; if (e > s0) out.push([s0 * step, Math.min(L, e * step)]); s0 = -1; } });
        return out;
      };
      // profile: [offset from the centre line, height above the ground there], walked outward over the solid
      const extrude = (b, t0, t1, prof, uvAlong, uvWorld) => {
        const n = Math.max(1, Math.ceil((t1 - t0) / 1.5)), base = b.P.length / 3, m = prof.length;
        for (let i = 0; i <= n; i++) {
          const t = t0 + ((t1 - t0) * i) / n;
          prof.forEach(([off, h], k) => {
            const [x, z] = at(t, off);
            b.P.push(x, G(x, z) + h, z);
            if (uvWorld) b.UV.push(x / uvWorld, -z / uvWorld); else b.UV.push(t / uvAlong, k * 0.06);
          });
        }
        for (let i = 0; i < n; i++) for (let k = 0; k < m - 1; k++) { const a = base + i * m + k; quad(b, a, a + 1, a + m, a + m + 1, side > 0); }
      };
      for (const [t0, t1] of runs(okK)) extrude(kerbs, t0, t1, [[h0 - 0.01, -0.06], [h0, KERB_Y], [h0 + KERB_W, KERB_Y], [h0 + KERB_W, SIDEWALK_Y - 0.01]], 1.0, 0);
      for (const [t0, t1] of runs(okW)) {
        const b = buf('pavement');
        extrude(b, t0, t1, [[h0 + KERB_W, SIDEWALK_Y], [h0 + sw, SIDEWALK_Y], [h0 + sw, -0.06]], 0, PAVE.pavement[1]);
        // end caps where the sidewalk stops (both windings: seen from either side)
        for (const t of [t0, t1]) {
          const base = b.P.length / 3;
          for (const [off, h] of [[h0 + KERB_W, SIDEWALK_Y], [h0 + sw, SIDEWALK_Y], [h0 + KERB_W, -0.06], [h0 + sw, -0.06]]) { const [x, z] = at(t, off); b.P.push(x, G(x, z) + h, z); b.UV.push(off / 1.8, h); }
          b.I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
      }
    }
  }
  // painted lines on yards (container slots, safety lines)
  const paint = { P: [], UV: [], I: [], C: [] };
  for (const mk of M.MARKINGS) {
    const before = paint.P.length / 3;
    drape(paint, mk.x0, mk.z0, mk.x1, mk.z1, 0.035, 2, 1);
    const c = new THREE.Color(mk.color ?? 0xd8d4c4);
    for (let i = before; i < paint.P.length / 3; i++) paint.C.push(c.r, c.g, c.b);
  }
  const mkMesh = (b, mat, name) => {
    if (!b.I.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.UV, 2));
    if (b.C) g.setAttribute('color', new THREE.Float32BufferAttribute(b.C, 3));
    g.setIndex(b.I);
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true; mesh.name = name;
    group.add(mesh);
  };
  // (the worn-concrete scan is a polished indoor floor, roughness ~0.54: outdoors it gets a flat, matte 0.88)
  const texMat = (key, color, opts = {}) => {
    const t = assets.textureSet(key), matte = key === 'concrete_floor';
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: matte ? null : t.arm, color: new THREE.Color().setRGB(...color, THREE.SRGBColorSpace), roughness: matte ? 0.88 : 1, metalness: 0, envMapIntensity: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...opts });
    // large paved areas: low-frequency wear / stains so a yard never reads as one flat tile
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPw;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvPw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vPw;
        float ph(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float pn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(ph(i),ph(i+vec2(1,0)),f.x), mix(ph(i+vec2(0,1)),ph(i+vec2(1,1)),f.x), f.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        float pm = pn(vPw.xz * 0.09) * 0.55 + pn(vPw.xz * 0.37) * 0.3 + pn(vPw.xz * 1.3) * 0.15;
        diffuseColor.rgb *= mix(vec3(0.74, 0.72, 0.69), vec3(1.04), pm);`);
    };
    return m;
  };
  for (const [k, b] of geo) { const [tex, , col] = PAVE[k] || PAVE.concrete; mkMesh(b, texMat(tex, col), `paving_${k}`); }
  mkMesh(kerbs, texMat('concrete_floor', [1.25, 1.24, 1.2], { polygonOffset: false }), 'kerbs');
  mkMesh(paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'markings');
  return group;
}
