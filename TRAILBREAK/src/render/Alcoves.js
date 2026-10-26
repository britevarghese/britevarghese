// Alcoves (a map's `alcoves`, world/maps/canyon.js): the roof over each, the floor and back wall being cut into the
// ground. A dome of rock over the floor, its underside coming down to the bank round the floor's edge, darker the
// deeper in; over the opening its brow, the face of a bed of rock whose lip juts out over it, banded in the strata;
// behind that its top, the wall as it stood before the cut, its beds going on up over it. In the rock of the ground
// textures, like the ledges (render/Ledges.js).
import * as THREE from 'three';
import { vnoise } from '../world/Noise.js';
import { alcoveRoof, ALCOVE_CUT } from '../world/Alcoves.js';
import { rockMaterial } from './Rocks.js';

const NA = 28, NR = 12;        // round the dome, and out from its middle to its edge

export class Alcoves {
  constructor(world, scene, ground) {
    const M = world.map, sites = M.alcoves(), mat = rockMaterial(ground, { ledge: true });
    this.meshes = sites.map((A) => {
      const mesh = new THREE.Mesh(build(A, M), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  setShadows(on) { for (const m of this.meshes) m.castShadow = on; }
}

/** An alcove's roof: its faces, each wound to face the way it should (into the hollow, up, out). */
function build(A, M) {
  const pos = [], col = [], ao = [], idx = [], c = [1, 1, 1];
  const at = (u, v) => [A.x + A.tx * u - A.nx * v, A.z + A.tz * u - A.nz * v];
  const n = (x, z, k) => vnoise(x / 3.1, z / 3.1, 811 + k) - 0.5;
  // (each point the colour of its bed, as the wall's face beside the alcove has it; how shaded)
  const put = (x, y, z, a) => {
    c[0] = c[1] = c[2] = 1;
    M.tint?.(x + A.nx * (A.D + 6), z + A.nz * (A.D + 6), 'rock', y, c);
    pos.push(x, y, z); col.push(c[0], c[1], c[2]); ao.push(a);
    return pos.length / 3 - 1;
  };
  // a grid of points (rows x cols) as one face, its triangles turned to face want(x, y, z)
  const face = (rows, want) => {
    const R = rows.length, C = rows[0].length, ids = rows.map((r) => r.map(([x, y, z, a]) => put(x, y, z, a)));
    const tris = [];
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) tris.push([ids[i][j], ids[i + 1][j], ids[i + 1][j + 1]], [ids[i][j], ids[i + 1][j + 1], ids[i][j + 1]]);
    let vote = 0;
    for (const [a, b, d] of tris) {
      const P = (k) => [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]], p = P(a), q = P(b), r = P(d);
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      const nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], w = want(...p);
      vote += Math.sign(nn[0] * w[0] + nn[1] * w[1] + nn[2] * w[2]);
    }
    for (const [a, b, d] of tris) if (vote >= 0) idx.push(a, b, d); else idx.push(a, d, b);
  };
  const roof = (r) => A.base + alcoveRoof(A, r), [cw, cd] = ALCOVE_CUT, wide = A.W + cw;
  // its top: the wall as it stood before the alcove was cut (the map's alcoveWall), its beds and ledges going on over
  // it; but never lower than the bed the brow is, a little over the dome's crown all across, its top a little ragged
  const thick = (u) => A.T * (0.55 + 0.35 * vnoise(u / 7 + 3.3, A.x * 0.01, 812));
  const wallAt = M.alcoveWall || ((x, z) => A.base + Math.max(0, -((x - A.x) * A.nx + (z - A.z) * A.nz)) * A.S);
  const topAt = (u, v) => { const [x, z] = at(u, v); return Math.max(wallAt(x, z), A.base + A.H + thick(u)); };
  const browTop = (u) => topAt(u, 0);
  // the underside: the dome, darker deep in and down by the bank
  const under = [];
  for (let i = 0; i <= NR; i++) {
    const r = Math.sin(i / NR * Math.PI / 2), row = [];
    for (let j = 0; j <= NA; j++) {
      const ph = j / NA * Math.PI, u = A.W * r * Math.cos(ph), v = A.D * r * Math.sin(ph), [x, z] = at(u, v);
      row.push([x, roof(r) + 0.6 * n(x, z, 0) * (1 - r), z, 0.35 + 0.5 * (1 - smooth(0, A.D * 0.85, v)) * (1 - 0.4 * smooth(0.8, 1, r)), u, v]);
    }
    under.push(row);
  }
  // (and on out flat over the ground's cut past its edge)
  const ring = [];
  for (let j = 0; j <= NA; j++) {
    const ph = j / NA * Math.PI, u = wide * Math.cos(ph), v = (A.D + cd) * Math.sin(ph), [x, z] = at(u, v);
    ring.push([x, roof(1), z, 0.3, u, v]);
  }
  under.push(ring);
  face(under, (x, y, z) => [A.x - x, A.base + 1 - y, A.z - z]);
  // the top, finer (its beds), over the cut out to its edge
  const top = [];
  for (let i = 0; i <= 20; i++) {
    const q = i / 20, row = [];
    for (let j = 0; j <= 2 * NA; j++) {
      const s = j / NA - 1, u = wide * s, v = q * (A.D + cd) * Math.sqrt(Math.max(0, 1 - s * s)), [x, z] = at(u, v);
      row.push([x, topAt(u, v) + 0.25 * n(x, z, 1), z, 1, u, v]);
    }
    top.push(row);
  }
  face(top, () => [0, 1, 0]);
  // the brow over the opening: the face of the bed the arch is cut up into, its lip jutting out over the opening (a
  // step out from the dome's edge), the face leaning back a little up it to its top, and back in over that
  // (in its own thinner beds, each standing out a little more or less than the next)
  const brow = [], T = [0, 0.04, 0.18, 0.3, 0.45, 0.58, 0.72, 0.86, 1, 1];
  T.forEach((t, k) => {
    const row = [];
    for (let j = 0; j <= 2 * NA; j++) {
      const s = j / NA - 1, u = wide * s, y0 = roof(Math.min(1, Math.abs(u) / A.W)), y = y0 + (browTop(u) - y0) * t, [x, z] = at(u, 0);
      const lip = (0.8 + 0.9 * (1 - s * s)) * (0.75 + 0.5 * (n(x, z, 2) + 0.5));
      const jut = k === 0 || k === T.length - 1 ? 0 : lip * (1 - 0.45 * t) * (k % 2 ? 1 : 0.8) + 0.25 * n(x, y * 1.3, 3);
      row.push([x + A.nx * jut, y, z + A.nz * jut, 0.72 + 0.28 * t]);
    }
    brow.push(row);
  });
  face(brow, () => [A.nx, 0, A.nz]);
  // round its back and sides, from the cut's edge up to the top (in the wall, mostly)
  const curtain = [];
  for (let k = 0; k <= 3; k++) {
    curtain.push(top[20].map(([x, y, z]) => [x, roof(1) + (y - roof(1)) * k / 3, z, 0.9]));
  }
  face(curtain, (x, y, z) => [x - A.x, 0, z - A.z]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
