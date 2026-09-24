// GeoBuilder: accumulates raw vertex data for merged, per-material chunk meshes.
// Much faster than creating and merging many small BufferGeometries.
import * as THREE from 'three';

export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; this.col = null; }
  get empty() { return this.idx.length === 0; }
  _v(x, y, z, nx, ny, nz, u, v) { this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); return this.pos.length / 3 - 1; }

  // generic quad from 4 corners (counter-clockwise when viewed from the normal side)
  quad(p0, p1, p2, p3, n, uvs) {
    const a = this._v(...p0, ...n, ...uvs[0]), b = this._v(...p1, ...n, ...uvs[1]);
    const c = this._v(...p2, ...n, ...uvs[2]), d = this._v(...p3, ...n, ...uvs[3]);
    this.idx.push(a, b, c, a, c, d);
  }

  // horizontal rectangle facing up; UV from world coordinates (seamless tiling)
  flat(x0, z0, x1, z1, y, scale = 1 / 8, rotUV = false) {
    const uv = (x, z) => (rotUV ? [z * scale, x * scale] : [x * scale, -z * scale]);
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [uv(x0, z1), uv(x1, z1), uv(x1, z0), uv(x0, z0)]);
  }

  // oriented rectangle in XZ facing up with explicit UV rect (decals)
  decal(cx, cz, halfW, halfL, angle, y, uvRect) {
    const c = Math.cos(angle), s = Math.sin(angle);
    // local x (width) = (c, -s), local z (length) = (s, c)
    const P = (lx, lz) => [cx + c * lx + s * lz, y, cz - s * lx + c * lz];
    const [u0, v0, u1, v1] = uvRect;
    this.quad(P(-halfW, halfL), P(halfW, halfL), P(halfW, -halfL), P(-halfW, -halfL), [0, 1, 0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
  }

  // vertical wall from (ax,az) to (bx,bz); its normal is (-dz, dx): e.g. walking +x gives a +z facing wall
  // u runs along the wall (u0 + len*uScale), v from y0..y1 mapped to v0..v0 + (y1-y0)*vScale
  wall(ax, az, bx, bz, y0, y1, uScale, vScale, u0 = 0, v0 = 0) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = -dz / len, nz = dx / len;
    const u1 = u0 + len * uScale, v1 = v0 + (y1 - y0) * vScale;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  // outward facing walls around an axis-aligned rectangle
  ring(x0, z0, x1, z1, y0, y1, uScale, vScale, u0 = 0, v0 = 0) {
    this.wall(x0, z1, x1, z1, y0, y1, uScale, vScale, u0, v0); // north (+z)
    this.wall(x1, z1, x1, z0, y0, y1, uScale, vScale, u0, v0); // east (+x)
    this.wall(x1, z0, x0, z0, y0, y1, uScale, vScale, u0, v0); // south (-z)
    this.wall(x0, z0, x0, z1, y0, y1, uScale, vScale, u0, v0); // west (-x)
  }

  // axis-aligned box with world-scaled UVs
  box(x0, y0, z0, x1, y1, z1, s = 1 / 4, bottom = false) {
    this.ring(x0, z0, x1, z1, y0, y1, s, s);
    this.flat(x0, z0, x1, z1, y1, s);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  // projecting band around a rectangle (cornice, string course): outer walls plus the top and
  // underside frames between the wall line and the projecting edge (the underside is what you
  // see from the street)
  band(x0, z0, x1, z1, y0, y1, out, s = 1 / 4) {
    const X0 = x0 - out, X1 = x1 + out, Z0 = z0 - out, Z1 = z1 + out;
    this.ring(X0, Z0, X1, Z1, y0, y1, s, s);
    const strips = [[X0, Z0, X1, z0], [X0, z1, X1, Z1], [X0, z0, x0, z1], [x1, z0, X1, z1]];
    for (const [a0, b0, a1, b1] of strips) {
      this.flat(a0, b0, a1, b1, y1, s);
      this.quad([a0, y0, b0], [a1, y0, b0], [a1, y0, b1], [a0, y0, b1], [0, -1, 0], [[a0 * s, b0 * s], [a1 * s, b0 * s], [a1 * s, b1 * s], [a0 * s, b1 * s]]);
    }
  }

  append(geo, matrix) {
    const g = geo.index ? geo : geo;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const base = this.pos.length / 3;
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix);
      nn.fromBufferAttribute(n, i); if (nm) nn.applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(nn.x, nn.y, nn.z);
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Map of material -> GeoBuilder for a chunk
export class MeshBatch {
  constructor() { this.map = new Map(); }
  get(mat) { if (!this.map.has(mat)) this.map.set(mat, new GeoBuilder()); return this.map.get(mat); }
  toMeshes(group, { castShadow = false, receiveShadow = true } = {}) {
    const out = [];
    for (const [mat, gb] of this.map) {
      if (gb.empty) continue;
      const m = new THREE.Mesh(gb.build(), mat);
      m.castShadow = castShadow && !mat.transparent; m.receiveShadow = receiveShadow;
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m); out.push(m);
    }
    return out;
  }
}
