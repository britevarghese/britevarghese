// Pillars: a hoodoo (a boulder stack whose blocks are a `pillar`, world/maps/canyon.js) drawn as the one column of rock
// it is, not the pile of blocks the physics drives against: up through its beds, a little wider where a bed is harder
// and narrower between, to the cap rock on top, flaring out over its neck. Banded in the strata colours, like the ledges
// (render/Ledges.js), in the rock of the ground textures.
import * as THREE from 'three';
import { vnoise } from '../world/Noise.js';
import { rockMaterial } from './Rocks.js';

const NA = 22;          // round the column

export class Pillars {
  constructor(world, scene, ground) {
    const M = world.map, mat = rockMaterial(ground, { ledge: true }), stacks = new Map();
    for (const b of world.boulders) if (b.pillar !== undefined) (stacks.get(b.pillar) || stacks.set(b.pillar, []).get(b.pillar)).push(b);
    this.meshes = [...stacks.values()].map((blocks) => {
      const mesh = new THREE.Mesh(build(blocks.sort((a, b) => a.y - b.y), M), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  setShadows(on) { for (const m of this.meshes) m.castShadow = on; }
}

/** A column lofted up through its blocks' outlines, closed by the cap rock's top. */
function build(B, M) {
  // the outlines up it: [y, rx, rz, yaw, x, z] (a block's faces stand at about three quarters of its half-size)
  const rings = [], cap = B[B.length - 1];
  B.forEach((b, k) => {
    const f = 0.74, last = k === B.length - 1;
    if (last) {
      // (the cap: out from the neck under it to its full width, then up its edge)
      const p = rings[rings.length - 1];
      rings.push([b.y - b.ry * 0.55, p[1] * 0.92, p[2] * 0.92, b.yaw, b.x, b.z], [b.y - b.ry * 0.3, b.rx * f, b.rz * f, b.yaw, b.x, b.z], [b.y + b.ry * 0.55, b.rx * f * 0.97, b.rz * f * 0.97, b.yaw, b.x, b.z]);
    } else {
      if (!k) rings.push([b.y - b.ry * 0.8, b.rx * f * 1.04, b.rz * f * 1.04, b.yaw, b.x, b.z]);
      // (a bed a little harder or softer than the next, standing out more or less: not every one alike)
      const bulge = 1 + 0.05 * (2 * b.shade - 1);
      rings.push([b.y - b.ry * 0.3, b.rx * f, b.rz * f, b.yaw, b.x, b.z], [b.y + b.ry * 0.05, b.rx * f * bulge, b.rz * f * bulge, b.yaw, b.x, b.z], [b.y + b.ry * 0.45, b.rx * f * 0.97, b.rz * f * 0.97, b.yaw, b.x, b.z]);
    }
  });
  const pos = [], col = [], ao = [], idx = [], c = [1, 1, 1], y0 = rings[0][0], y1 = rings[rings.length - 1][0];
  const put = (x, y, z, a) => {
    c[0] = c[1] = c[2] = 1;
    M.tint?.(x, z, 'rock', y, c);
    pos.push(x, y, z); col.push(c[0], c[1], c[2]); ao.push(a);
  };
  for (const [y, rx, rz, yaw, cx, cz] of rings) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let j = 0; j <= NA; j++) {
      const a = j / NA * Math.PI * 2, w = 1 + 0.1 * (vnoise(Math.cos(a) * 1.7 + cx, y * 0.45 + Math.sin(a) * 1.7, 433) - 0.5);
      const lx = Math.cos(a) * rx * w, lz = Math.sin(a) * rz * w;
      // (turned as the blocks are: local x out along (cos, -sin), z along (sin, cos))
      put(cx + lx * cy + lz * sy, y, cz - lx * sy + lz * cy, 0.7 + 0.3 * (y - y0) / Math.max(1, y1 - y0));
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * (NA + 1) + j, b = a + NA + 1;
      idx.push(a, b + 1, a + 1, a, b, b + 1);              // (wound to face out)
    }
  }
  // the cap's top, a little domed
  const top = pos.length / 3, last = (rings.length - 1) * (NA + 1);
  put(cap.x, cap.y + cap.ry * 0.66, cap.z, 1);
  for (let j = 0; j < NA; j++) idx.push(top, last + j + 1, last + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
