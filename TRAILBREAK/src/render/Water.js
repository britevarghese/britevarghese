// Water: the river (a ribbon along its course at its falling level), Mirror Lake, the bog's pools and the trail
// puddles. Ripples are scrolled noise bent into the normal; the sky shows in it at grazing angles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOG } from '../world/MapData.js';

function waterMaterial(color, opacity, uniforms, flow = 0.25, reflect = 0.75) {
  const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.07, metalness: 0.0, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uSky = uniforms.uSky;
    sh.uniforms.uFlow = { value: flow };
    sh.uniforms.uReflect = { value: reflect };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWPos;
uniform float uTime;
uniform vec3 uSky;
uniform float uFlow;
uniform float uReflect;
float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh(i), wh(i + vec2(1, 0)), u.x), mix(wh(i + vec2(0, 1)), wh(i + vec2(1, 1)), u.x), u.y); }
float waves(vec2 p) {
  return wn(p * 0.42 + vec2(uTime * 0.31, uTime * 0.2) * uFlow * 4.0) * 0.6 + wn(p * 1.3 - vec2(uTime * 0.5, -uTime * 0.37)) * 0.3 + wn(p * 3.7 + vec2(uTime * 0.9, uTime * 0.6)) * 0.1;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWPos.xz;
  float e = 0.25;
  float h0 = waves(p), hx = waves(p + vec2(e, 0.0)), hz = waves(p + vec2(0.0, e));
  float dist = length(vWPos - cameraPosition);
  float k = 0.9 * clamp(1.0 - dist / 600.0, 0.15, 1.0);
  vec3 nW = normalize(vec3(-(hx - h0) / e * k, 1.0, -(hz - h0) / e * k));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 V = normalize(cameraPosition - vWPos);
  float fres = pow(1.0 - clamp(dot(normalize((inverse(viewMatrix) * vec4(normal, 0.0)).xyz), V), 0.0, 1.0), 4.0);
  reflectedLight.indirectSpecular += uSky * (0.08 + uReflect * fres);
}`);
  };
  return mat;
}

export class Water {
  constructor(world, scene) {
    this.uniforms = { uTime: { value: 0 }, uSky: { value: new THREE.Color(0xbfd5ec) } };
    this.group = new THREE.Group();
    scene.add(this.group);
    const river = world.data.river.points;
    // river ribbon
    {
      const pos = [], idx = [];
      for (let i = 0; i < river.length; i++) {
        const [x, z, level, half] = river[i];
        const [ax, az] = river[Math.max(0, i - 1)], [bx, bz] = river[Math.min(river.length - 1, i + 1)];
        let dx = bx - ax, dz = bz - az; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const w = half * 1.9 + 4;                                 // past the banks: the terrain hides the excess
        pos.push(x - dz * w, level, z + dx * w, x + dz * w, level, z - dx * w);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // make sure all normals point up
      const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
      const m = new THREE.Mesh(g, waterMaterial(0x2f5f63, 0.84, this.uniforms, 0.6));
      m.receiveShadow = true;
      m.renderOrder = 2;
      this.group.add(m);
    }
    // the lake
    {
      const L = world.lake;
      const g = new THREE.CircleGeometry(L.r * 1.32, 72).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, waterMaterial(0x2b5566, 0.86, this.uniforms, 0.05));
      m.position.set(L.x, L.level, L.z);
      m.receiveShadow = true; m.renderOrder = 2;
      this.group.add(m);
    }
    // the bog's pools and the puddles: muddy water
    const mud = waterMaterial(0x4d3f2a, 0.92, this.uniforms, 0.02, 0.25);
    {
      const g = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mud);
      m.scale.set(BOG.rx * 0.72, 1, BOG.rz * 0.72);
      m.rotation.y = -BOG.rot;
      m.position.set(BOG.x, world.data.bogFloor - 0.06, BOG.z);
      m.renderOrder = 2;
      this.group.add(m);
    }
    const discs = [];
    for (const pd of world.data.puddles) {
      if (pd.level === undefined) continue;
      discs.push(new THREE.CircleGeometry(pd.r * 0.98, 20).rotateX(-Math.PI / 2).translate(pd.x, pd.level, pd.z));
    }
    if (discs.length) {
      const m = new THREE.Mesh(mergeGeometries(discs), mud);
      m.renderOrder = 2;
      this.group.add(m);
    }
  }

  update(camera, dt, skyColor) {
    this.uniforms.uTime.value += dt;
    if (skyColor) this.uniforms.uSky.value.copy(skyColor);
  }
}

export async function preview(world, r) { const w = new Water(world, r.scene); w.update(r.camera, 0, r.sky.state.horizon); return w; }
