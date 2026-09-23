// Environmental props from real GLB assets, rendered with GPU instancing (one draw per mesh per prop type).
import * as THREE from 'three';
import { PROPS, groundHeight } from '/shared/map.js';
import { mulberry32 } from '/shared/util.js';
import { buildBoxGeometry } from '../render/Materials.js';

// GLB scene -> InstancedMeshes for the given world matrices
export function instanceGLB(gltf, matrices, { castShadow = true, receiveShadow = true, material = null, name = '' } = {}) {
  const group = new THREE.Group(); group.name = name;
  if (!matrices.length) return group;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const im = new THREE.InstancedMesh(o.geometry, material ? material(o.material) : o.material, matrices.length);
    const m = new THREE.Matrix4();
    matrices.forEach((mat, i) => im.setMatrixAt(i, m.multiplyMatrices(mat, o.matrixWorld)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = castShadow; im.receiveShadow = receiveShadow;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

const M = (x, y, z, ry = 0, s = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

export async function buildProps(assets, mats, extra = { roofProps: [], rubble: [] }) {
  const group = new THREE.Group(); group.name = 'props';
  const by = {};
  const add = (k, m) => (by[k] = by[k] || []).push(m);
  const rnd = mulberry32(777);
  const containers = [];
  for (const p of PROPS) {
    const y = groundHeight(p.x, p.z) + (p.y || 0);
    const ry = (p.rot || 0) * (Math.PI / 2);
    switch (p.type) {
      case 'barrier': add('barrier', M(p.x, y, p.z, ry)); break;
      case 'barrier2': add('barrier2', M(p.x, y, p.z, ry)); break;
      case 'crate': add('crate', M(p.x, y, p.z, ry + (rnd() - 0.5) * 0.2)); break;
      case 'crate_stack':
        add('crate', M(p.x, y, p.z - 0.27, ry)); add('crate', M(p.x, y, p.z + 0.27, ry));
        add('crate', M(p.x, y + 0.46, p.z, ry + 0.1)); add('ammo', M(p.x + 0.2, y + 0.92, p.z, ry + 1.2));
        break;
      case 'barrel': add(rnd() < 0.5 ? 'barrel' : 'barrel_rusty', M(p.x, y, p.z, rnd() * 6)); break;
      case 'car': add(p.burnt ? 'car_burnt' : 'car', M(p.x, y, p.z, ry)); if (p.burnt) { add('tyre', M(p.x + 1.2, y + 0.08, p.z + 1, rnd() * 6, 1, Math.PI / 2)); } break;
      case 'generator': add('generator', M(p.x, y, p.z, ry)); break;
      case 'utility': add('utility', M(p.x, y, p.z, ry)); break;
      case 'lamp': add('lamp', M(p.x, y, p.z, ry)); break;
      case 'trash': add('trash', M(p.x, y, p.z, ry)); break;
      case 'tyre': add('tyre', M(p.x, y + 0.08, p.z, p.rot, 1, Math.PI / 2)); break;
      case 'jerrycan': add('jerrycan', M(p.x, y, p.z, p.rot)); break;
      case 'ammo': add('ammo', M(p.x, y, p.z, p.rot)); break;
      case 'debris': {
        // concrete rubble chunks: rocks recoloured as concrete + scattered cement bags
        const s = p.s || 1;
        add('rubble', M(p.x, y - 0.05, p.z, p.rot, 3.5 * s, rnd() * 0.4, rnd() * 0.4));
        if (rnd() < 0.4) add('cement_bag', M(p.x + 0.6, y, p.z + 0.3, p.rot + 1));
        break;
      }
      case 'sandbags': {
        // realistic stacked bags: staggered courses, slight irregularity
        const len = p.len, rot90 = Math.round(p.rot) % 2 === 1;
        const courses = 5, bagL = 0.62;
        const n = Math.max(1, Math.floor(len / bagL));
        for (let c = 0; c < courses; c++) {
          const off = (c % 2) * bagL * 0.5, inset = c * 0.035;
          for (let i = 0; i < n - (c % 2); i++) {
            const u = -len / 2 + off + (i + 0.5) * bagL;
            const bx = p.x + (rot90 ? inset * 0 : u), bz = p.z + (rot90 ? u : 0);
            const gy = groundHeight(bx, bz);
            add('sandbag', M(bx + (rnd() - 0.5) * 0.03, gy + c * 0.17, bz + (rnd() - 0.5) * 0.03, (rot90 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06));
            // double thickness
            add('sandbag', M(bx + (rot90 ? 0.44 : 0), gy + c * 0.17, bz + (rot90 ? 0 : 0.44), (rot90 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.06, 0));
          }
        }
        break;
      }
      case 'fence': {
        const len = p.len, rot90 = Math.round(p.rot) % 2 === 1, seg = 8.1;
        for (let u = -len / 2; u < len / 2 - 1; u += seg) {
          const fx = p.x + (rot90 ? 0 : u + 6.04), fz = p.z + (rot90 ? u + 6.04 : 0);
          add('fence', M(fx, groundHeight(fx, fz), fz, rot90 ? -Math.PI / 2 : 0));
        }
        break;
      }
      case 'wall': containers.push({ kind: 'wall', p, y }); break;
      case 'container': containers.push({ kind: 'container', p, y }); break;
    }
  }
  for (const r of extra.roofProps || []) {
    if (r.type === 'aircon') add('aircon', M(r.x, r.y + 0.35, r.z, r.rot));
    if (r.type === 'rollershutter') add('rollershutter', new THREE.Matrix4().compose(new THREE.Vector3(r.x, r.y - 0.4, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.rot, 0)), new THREE.Vector3(r.w / 3.1, 0.35, 1)));
  }
  for (const rb of extra.rubble || []) for (let i = 0; i < rb.n; i++) add('rubble', M(rb.x + (rnd() - 0.5) * 2.5, rb.y - 0.05, rb.z + (rnd() - 0.5) * 2.5, rnd() * 6, 3 + rnd() * 5, rnd() * 0.5, rnd() * 0.5));

  const keys = { barrier: 'barrier', barrier2: 'barrier2', crate: 'crate', ammo: 'ammo', barrel: 'barrel', barrel_rusty: 'barrel_rusty', car: 'car', car_burnt: 'car', generator: 'generator', utility: 'utility', lamp: 'lamp', trash: 'trash', tyre: 'tyre', jerrycan: 'jerrycan', cement_bag: 'cement_bag', sandbag: 'cement_bag', fence: 'fence', aircon: 'aircon', rollershutter: 'rollershutter' };
  const burnt = new Map();
  const burntMat = (m) => { if (!burnt.has(m)) { const c = m.clone(); c.color = new THREE.Color(0x2a2522); c.roughness = 1; c.metalness = 0.2; burnt.set(m, c); } return burnt.get(m); };
  const sandMats = new Map();
  const sandMat = (m) => { if (!sandMats.has(m)) { const c = m.clone(); c.color = new THREE.Color(0xc9b48c); sandMats.set(m, c); } return sandMats.get(m); };
  await Promise.all(Object.entries(by).map(async ([k, list]) => {
    if (k === 'rubble') {
      const g = await assets.loadVegetation('rock_07');
      const cm = new Map();
      group.add(instanceGLB(g, list, { name: 'rubble', material: (m) => { if (!cm.has(m)) { const c = m.clone(); c.color = new THREE.Color(0xa8a49c); cm.set(m, c); } return cm.get(m); } }));
      return;
    }
    const g = await assets.loadProp(keys[k]);
    group.add(instanceGLB(g, list, { name: k, material: k === 'car_burnt' ? burntMat : k === 'sandbag' ? sandMat : null, castShadow: k !== 'fence' }));
  }));

  // shipping containers & precast walls: modular geometry textured with real corrugated steel / concrete
  const parts = [], wallParts = [];
  const tints = [[0.62, 0.22, 0.16], [0.2, 0.33, 0.45], [0.28, 0.36, 0.25], [0.55, 0.5, 0.42], [0.6, 0.42, 0.2]];
  const colorFor = new Map();
  for (const c of containers) {
    const { p, y } = c;
    const rot90 = Math.round(p.rot) % 2 === 1;
    if (c.kind === 'container') {
      const hx = rot90 ? 1.22 : 3.03, hz = rot90 ? 3.03 : 1.22;
      const part = { min: [p.x - hx, y, p.z - hz], max: [p.x + hx, y + 2.59, p.z + hz], mat: 'container' };
      colorFor.set(part, tints[Math.floor(Math.abs(p.x * 7 + p.z * 3)) % tints.length]);
      parts.push(part);
      // corner castings + door bars
      const ex = rot90 ? 0 : hx, ez = rot90 ? hz : 0;
      for (const s of [-1, 1]) {
        parts.push({ min: [p.x + s * ex - (rot90 ? 1.25 : 0.05), y + 0.05, p.z + s * ez - (rot90 ? 0.05 : 1.25)], max: [p.x + s * ex + (rot90 ? 1.25 : 0.05), y + 2.54, p.z + s * ez + (rot90 ? 0.05 : 1.25)], mat: 'frame' });
      }
    } else {
      const len = p.len, hx = rot90 ? 0.25 : len / 2, hz = rot90 ? len / 2 : 0.25;
      const segs = Math.round(len / 3);
      for (let s = 0; s < segs; s++) {
        const u0 = -len / 2 + s * (len / segs) + 0.02, u1 = u0 + len / segs - 0.04;
        const x0 = rot90 ? p.x - hx : p.x + u0, x1 = rot90 ? p.x + hx : p.x + u1, z0 = rot90 ? p.z + u0 : p.z - hz, z1 = rot90 ? p.z + u1 : p.z + hz;
        const gy = groundHeight((x0 + x1) / 2, (z0 + z1) / 2);
        wallParts.push({ min: [x0, gy - 0.3, z0], max: [x1, gy + 2.6, z1], mat: 'concrete_slab' });
        // T-wall foot
        wallParts.push({ min: [x0, gy - 0.3, rot90 ? z0 : z0 - 0.45], max: [x1, gy + 0.35, rot90 ? z1 : z1 + 0.45], mat: 'concrete_slab' });
      }
    }
  }
  const color = (pt, part) => { const t = colorFor.get(part); return t ? [t[0] * 1.6, t[1] * 1.6, t[2] * 1.6] : [0.8, 0.8, 0.8]; };
  for (const [m, g] of buildBoxGeometry(parts, { tile: 2.2, color })) { const mesh = new THREE.Mesh(g, mats.building(m)); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
  for (const [m, g] of buildBoxGeometry(wallParts, { tile: 2.6, color: (pt) => [0.8 + 0.2 * Math.min(1, (pt[1] - groundHeight(pt[0], pt[2])) / 1.5), 0.8, 0.78] })) { const mesh = new THREE.Mesh(g, mats.building(m)); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); }
  return group;
}
