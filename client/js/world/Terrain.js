// Chunked heightfield terrain with multi-layer PBR material blending (grass / dry soil / rock / scorched earth),
// anti-tiling (dual-scale sampling + macro variation), plus asphalt road ribbons with worn markings.
import * as THREE from 'three';
import { MAP_HALF, ROADS, BUILDINGS, FLAGS, groundHeight, roadDistance, terrainHeight, ACTIVE_MAP, seaFactor } from '/shared/map.js';
import { fbm, smoothstep } from '/shared/util.js';

export function buildTerrain(assets, quality) {
  const group = new THREE.Group();
  group.name = 'terrain';
  // big (battle royale) islands: coarser vertices and more chunks, so the vertex count and culling stay sane
  const big = Math.max(1, Math.min(1.6, MAP_HALF / 280));
  const res = (quality === 'verylow' ? 2.5 : quality === 'low' ? 2 : 1.25) * big;
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
  const burnSpots = [...BUILDINGS.filter((b) => b.damage > 0.25).map((b) => ({ x: b.x, z: b.z, r: Math.max(b.w, b.d) * 0.9 })), ...(FLAGS[1] ? [{ x: FLAGS[1].x, z: FLAGS[1].z, r: 11 }] : []), { x: -3, z: 8, r: 6 }, { x: 18, z: -9, r: 6 }];
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
        const rd = roadDistance(x, z);
        let dirt = Math.max(1 - smoothstep(0, 3.5, rd), 0) * 0.9 + smoothstep(0.55, 0.75, fbm(x / 22, z / 22, 3, 3)) * 0.8;
        for (const b of BUILDINGS) {
          const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
          dirt = Math.max(dirt, 1 - smoothstep(0.5, 4, Math.hypot(dx, dz)));
        }
        for (const f of FLAGS) dirt = Math.max(dirt, (1 - smoothstep(f.r * 0.4, f.r * 1.1, Math.hypot(x - f.x, z - f.z))) * 0.8);
        let burnt = 0;
        for (const s of burnSpots) burnt = Math.max(burnt, (1 - smoothstep(s.r * 0.3, s.r, Math.hypot(x - s.x, z - s.z))) * (0.5 + 0.5 * fbm(x / 4, z / 4, 2, 9)));
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
  // outer landscape continuing the terrain beyond the playable area (rolling hills rising to distant ridges)
  const og = new THREE.PlaneGeometry(2600, 2600, 90, 90);
  og.rotateX(-Math.PI / 2);
  const op = og.attributes.position;
  const osplat = new Float32Array(op.count * 4);
  for (let i = 0; i < op.count; i++) {
    const x = op.getX(i), z = op.getZ(i);
    op.setY(i, outerHeight(x, z));
    osplat[i * 4] = 0.25 + 0.4 * fbm(x / 90, z / 90, 2, 4); osplat[i * 4 + 1] = smoothstep(40, 90, outerHeight(x, z)) * 0.7;
  }
  og.setAttribute('splat', new THREE.BufferAttribute(osplat, 4));
  og.computeVertexNormals();
  const outer = new THREE.Mesh(og, material);
  outer.receiveShadow = true; outer.name = 'outer_terrain';
  group.add(outer);
  return group;
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
  for (const r of ROADS) {
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
        P.push(x, groundHeight(x, z) + 0.035, z);
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
