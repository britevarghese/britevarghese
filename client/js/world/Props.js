// Environmental props from real GLB assets, rendered with GPU instancing (one draw per mesh per prop type).
import * as THREE from 'three';
import { PROPS, groundHeight } from '/shared/map.js';
import { mulberry32 } from '/shared/util.js';
import { buildBoxGeometry } from '../render/Materials.js';

// GLB scene -> InstancedMeshes for the given world matrices
// Instances are bucketed into spatial cells so frustum culling (camera AND shadow passes) skips distant groups.
// `only`: draw just the meshes (or mesh groups) with these node names.
export function instanceGLB(gltf, matrices, { castShadow = true, receiveShadow = true, material = null, name = '', cell = 80, only = null } = {}) {
  const group = new THREE.Group(); group.name = name;
  if (!matrices.length) return group;
  gltf.scene.updateMatrixWorld(true);
  const buckets = new Map();
  const v = new THREE.Vector3();
  for (const mat of matrices) {
    v.setFromMatrixPosition(mat);
    const k = `${Math.floor(v.x / cell)},${Math.floor(v.z / cell)}`;
    (buckets.get(k) || buckets.set(k, []).get(k)).push(mat);
  }
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (only && !only.includes(o.name) && !only.includes(o.parent?.name)) return;
    const mtl = material ? material(o.material) : o.material;
    for (const list of buckets.values()) {
      const im = new THREE.InstancedMesh(o.geometry, mtl, list.length);
      const m = new THREE.Matrix4();
      list.forEach((mat, i) => im.setMatrixAt(i, m.multiplyMatrices(mat, o.matrixWorld)));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = castShadow; im.receiveShadow = receiveShadow;
      im.computeBoundingSphere();
      group.add(im);
    }
  });
  return group;
}

const M = (x, y, z, ry = 0, s = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
// chainlink_fence.glb is a whole modular kit laid out around the origin: the 2 m double panel spans x -1.951..-0.039
// and a loose post stands at (-1.005, -1.0). These move each piece onto the fence line (panel scaled to the module).
const FENCE_PANEL_FIX = (L) => new THREE.Matrix4().makeScale(L / 2, 1, 1).multiply(new THREE.Matrix4().makeTranslation(0.995, 0, -0.001));
const FENCE_POST_FIX = new THREE.Matrix4().makeTranslation(1.005, 0, 1.0015);

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
      case 'crate_stack': {
        // two crates side by side along the stack's own z (so a rotated stack stays inside its collider), one on top
        const ox = 0.27 * Math.sin(ry), oz = 0.27 * Math.cos(ry);
        add('crate', M(p.x - ox, y, p.z - oz, ry)); add('crate', M(p.x + ox, y, p.z + oz, ry));
        add('crate', M(p.x, y + 0.46, p.z, ry + 0.1)); add('ammo', M(p.x + 0.2 * Math.cos(ry), y + 0.92, p.z - 0.2 * Math.sin(ry), ry + 1.2));
        break;
      }
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
        // two rows of bags either side of the line (0.9 m thick, 5 courses = 0.86 m: the collider in shared/world.js)
        const courses = 5, bagL = 0.62;
        const n = Math.max(1, Math.floor(len / bagL));
        for (let c = 0; c < courses; c++) {
          const off = (c % 2) * bagL * 0.5;
          for (let i = 0; i < n - (c % 2); i++) {
            const u = -len / 2 + off + (i + 0.5) * bagL;
            const bx = p.x + (rot90 ? 0 : u), bz = p.z + (rot90 ? u : 0);
            const gy = groundHeight(bx, bz);
            add('sandbag', M(bx + (rot90 ? -0.22 : 0) + (rnd() - 0.5) * 0.03, gy + c * 0.17, bz + (rot90 ? 0 : -0.22) + (rnd() - 0.5) * 0.03, (rot90 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.06, (rnd() - 0.5) * 0.06));
            add('sandbag', M(bx + (rot90 ? 0.22 : 0), gy + c * 0.17, bz + (rot90 ? 0 : 0.22), (rot90 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12, 1, (rnd() - 0.5) * 0.06, 0));
          }
        }
        break;
      }
      case 'fence': {
        // straight run of the modular kit's 2 m double panel between posts, tiled exactly over the collider length
        // (one collider box per panel, see shared/world.js); each panel / post stands on its own ground height
        const len = p.len, rot90 = Math.round(p.rot) % 2 === 1, n = Math.max(1, Math.round(len / 2)), L = len / n;
        const fr = rot90 ? -Math.PI / 2 : 0, at = (u) => [p.x + (rot90 ? 0 : u), p.z + (rot90 ? u : 0)];
        for (let i = 0; i < n; i++) {
          const [fx, fz] = at(-len / 2 + (i + 0.5) * L);
          add('fence_panel', M(fx, groundHeight(fx, fz), fz, fr).multiply(FENCE_PANEL_FIX(L)));
        }
        for (let i = 0; i <= n; i++) {
          const [fx, fz] = at(-len / 2 + i * L);
          add('fence_post', M(fx, groundHeight(fx, fz) - 0.05, fz, fr).multiply(FENCE_POST_FIX));
        }
        break;
      }
      case 'wall': containers.push({ kind: 'wall', p, y }); break;
      case 'lowwall': containers.push({ kind: 'lowwall', p, y }); break;
      case 'container': containers.push({ kind: 'container', p, y }); break;
    }
  }
  for (const r of extra.roofProps || []) {
    if (r.type === 'aircon') add('aircon', M(r.x, r.y + 0.35, r.z, r.rot));
    // roller shutter (model spans x -0.54..2.54, 0.3 m deep): rolled up under the lintel, exactly the door's width,
    // centred in the wall's thickness; r.x/r.z is the door's u0 end on the wall mid-plane, r.rot its direction
    if (r.type === 'rollershutter') {
      const k = r.w / 3.08, c = Math.cos(r.rot), sn = Math.sin(r.rot);
      const lx = 0.54 * k, lz = -0.149 * 0.85; // local offset that puts the model's x-min at the anchor and its depth centred
      add('rollershutter', new THREE.Matrix4().compose(new THREE.Vector3(r.x + lx * c + lz * sn, r.y - 0.4, r.z - lx * sn + lz * c), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.rot, 0)), new THREE.Vector3(k, 0.35, 0.85)));
    }
  }
  for (const rb of extra.rubble || []) for (let i = 0; i < Math.min(2, rb.n); i++) add('rubble', M(rb.x + (rnd() - 0.5) * 2.5, rb.y - 0.05, rb.z + (rnd() - 0.5) * 2.5, rnd() * 6, 3 + rnd() * 5, rnd() * 0.5, rnd() * 0.5));

  const keys = { barrier: 'barrier', barrier2: 'barrier2', crate: 'crate', ammo: 'ammo', barrel: 'barrel', barrel_rusty: 'barrel_rusty', car: 'car', car_burnt: 'car', generator: 'generator', utility: 'utility', lamp: 'lamp', trash: 'trash', tyre: 'tyre', jerrycan: 'jerrycan', cement_bag: 'cement_bag', sandbag: 'cement_bag', fence_panel: 'fence', fence_post: 'fence', aircon: 'aircon', rollershutter: 'rollershutter' };
  const onlyMeshes = { fence_panel: ['modular_chainlink_fence_double'], fence_post: ['modular_chainlink_fence_post'] };
  const burnt = new Map();
  const burntMat = (m) => { if (!burnt.has(m)) { const c = m.clone(); c.color = new THREE.Color(0x2a2522); c.roughness = 1; c.metalness = 0.2; burnt.set(m, c); } return burnt.get(m); };
  const sandMats = new Map();
  // sandbags: reuse the bag mesh + its fabric normal/roughness detail, but with woven burlap colour instead of the printed paper
  const sandMat = (m) => { if (!sandMats.has(m)) { const c = m.clone(); c.map = null; c.color = new THREE.Color(0x9c8a66); c.roughness = 1; c.metalness = 0; sandMats.set(m, c); } return sandMats.get(m); };
  await Promise.all(Object.entries(by).map(async ([k, list]) => {
    if (k === 'rubble') {
      const g = await assets.loadVegetation('rock_07');
      const cm = new Map();
      group.add(instanceGLB(g, list, { name: 'rubble', castShadow: false, material: (m) => { if (!cm.has(m)) { const c = m.clone(); c.color = new THREE.Color(0xa8a49c); cm.set(m, c); } return cm.get(m); } }));
      return;
    }
    const g = await assets.loadProp(keys[k]);
    const small = ['tyre', 'jerrycan', 'ammo', 'cement_bag', 'fence_panel', 'fence_post'].includes(k);
    group.add(instanceGLB(g, list, { name: k, material: k === 'car_burnt' ? burntMat : k === 'sandbag' ? sandMat : null, castShadow: !small, only: onlyMeshes[k] || null }));
  }));

  // shipping containers & precast walls: modular geometry textured with real corrugated steel / concrete
  const parts = [], wallParts = [], lowParts = [];
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
    } else if (c.kind === 'lowwall') {
      // garden wall: brick in 2 m bays (the collider segments of shared/world.js), each on its own ground, with a
      // slightly overhanging concrete coping (1.1 m in all: vaultable)
      const len = p.len, segs = Math.max(1, Math.round(len / 2)), t = 0.15;
      for (let s = 0; s < segs; s++) {
        const u0 = -len / 2 + (s * len) / segs, u1 = u0 + len / segs, um = (u0 + u1) / 2;
        const cx = rot90 ? p.x : p.x + um, cz = rot90 ? p.z + um : p.z, gy = groundHeight(cx, cz);
        const lo = rot90 ? [cx - t, cz + u0] : [cx + u0, cz - t], hi = rot90 ? [cx + t, cz + u1] : [cx + u1, cz + t];
        lowParts.push({ min: [lo[0], gy - 0.3, lo[1]], max: [hi[0], gy + 1.0, hi[1]], mat: 'brick', k: p.x * 0.37 + p.z * 0.11 });
        const o = 0.03;
        lowParts.push({ min: [lo[0] - (rot90 ? o : 0.005), gy + 1.0, lo[1] - (rot90 ? 0.005 : o)], max: [hi[0] + (rot90 ? o : 0.005), gy + 1.1, hi[1] + (rot90 ? 0.005 : o)], mat: 'trim' });
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
  // garden walls: per-wall tone, grime near the ground
  const lowColor = (pt, part) => { const k = (0.86 + 0.14 * Math.abs(Math.sin(part.k || 0))) * (0.8 + 0.2 * Math.min(1, Math.max(0, pt[1] - groundHeight(pt[0], pt[2]) + 0.1) / 0.9)); return [k, k * 0.97, k * 0.93]; };
  for (const [m, g] of buildBoxGeometry(lowParts, { tile: 2.4, color: lowColor })) { const mesh = new THREE.Mesh(g, mats.building(m)); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'garden_walls'; group.add(mesh); }
  return group;
}
