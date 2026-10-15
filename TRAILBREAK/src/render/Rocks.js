// Boulders: faceted rocks, instanced. Each is drawn inside the ellipsoid the physics uses for it, so a tyre on a
// rock sits on what you see.
import * as THREE from 'three';
import { vnoise } from '../world/Noise.js';

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 1.7 + seed, v.z * 1.7 - seed, seed) * 0.65 + vnoise(v.y * 3.1 + seed, v.x * 3.1, seed + 1) * 0.35;
    const k = 0.86 + n * 0.14;                                     // stay inside the collision ellipsoid
    v.multiplyScalar(k);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.5;                // flatter underside
    p.setXYZ(i, v.x, v.y, v.z);
    // lighter on top, a little moss on the upper faces
    const top = Math.max(0, v.y);
    const moss = top > 0.55 && n > 0.45 ? (n - 0.45) * 1.4 : 0;
    const base = 0.3 + top * 0.1 + n * 0.07;
    col[i * 3] = base * (1 - moss * 0.45); col[i * 3 + 1] = base * (1 + moss * 0.15); col[i * 3 + 2] = base * (0.95 - moss * 0.5);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export class Rocks {
  constructor(world, scene) {
    const B = world.boulders;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
    this.meshes = [];
    const groups = [[], [], []];
    B.forEach((b, i) => groups[i % 3].push(b));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    groups.forEach((list, gi) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(rockGeometry(gi * 7.3 + 1), mat, list.length);
      list.forEach((b, k) => {
        q.setFromAxisAngle(up, b.yaw);
        s.set(b.rx, b.ry, b.rz);
        p.set(b.x, b.y, b.z);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
        const tone = 0.85 + b.shade * 0.3;
        c.setRGB(tone * 1.02, tone, tone * 0.96);
        mesh.setColorAt(k, c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.meshes.push(mesh);
    });
  }
}

export async function preview(world, r) { return new Rocks(world, r.scene); }
