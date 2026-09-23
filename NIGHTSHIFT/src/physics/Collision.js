// Static collision world (2.5D): oriented boxes in the XZ plane with a height,
// stored in a uniform spatial hash. Vehicles are tested as oriented boxes too (SAT).

const CELL = 24;

export class CollisionWorld {
  constructor() {
    this.grid = new Map();
    this.count = 0;
    this._stamp = 0;
  }

  add(c) {
    // world-space AABB of the oriented box
    const ex = Math.abs(c.cos) * c.hx + Math.abs(c.sin) * c.hz;
    const ez = Math.abs(c.sin) * c.hx + Math.abs(c.cos) * c.hz;
    c.minX = c.cx - ex; c.maxX = c.cx + ex; c.minZ = c.cz - ez; c.maxZ = c.cz + ez;
    c._q = 0;
    for (let x = Math.floor(c.minX / CELL); x <= Math.floor(c.maxX / CELL); x++) {
      for (let z = Math.floor(c.minZ / CELL); z <= Math.floor(c.maxZ / CELL); z++) {
        const k = x * 73856093 ^ z * 19349663;
        let list = this.grid.get(k);
        if (!list) { list = []; this.grid.set(k, list); }
        list.push(c);
      }
    }
    this.count++;
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const stamp = ++this._stamp;
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++) {
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const list = this.grid.get(x * 73856093 ^ z * 19349663);
        if (!list) continue;
        for (const c of list) {
          if (c._q === stamp) continue;
          c._q = stamp;
          if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  // Ray march along XZ for line-of-sight checks (police detection). Returns true if blocked.
  blocked(x0, z0, x1, z1, minHeight = 2) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / 6);
    const tmp = [];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      this.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5, tmp);
      for (const c of tmp) {
        if (c.h < minHeight || c.kind === 'pole' || c.kind === 'tree') continue;
        const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin;
        const lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos;
        if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) return true;
      }
    }
    return false;
  }
}

// Separating-axis test between two oriented boxes in XZ.
// Box: {cx, cz, hx, hz, cos, sin} where local x axis = (cos, -sin), local z axis = (sin, cos)
// (matches a rotation by `angle` about +Y). Returns {nx, nz, depth} pushing A out of B, or null.
export function obbOverlap(a, b) {
  const axes = [
    [a.cos, -a.sin], [a.sin, a.cos],
    [b.cos, -b.sin], [b.sin, b.cos],
  ];
  const dx = a.cx - b.cx, dz = a.cz - b.cz;
  let best = Infinity, bnx = 0, bnz = 0;
  for (const [ax, az] of axes) {
    const ra = a.hx * Math.abs(a.cos * ax - a.sin * az) + a.hz * Math.abs(a.sin * ax + a.cos * az);
    const rb = b.hx * Math.abs(b.cos * ax - b.sin * az) + b.hz * Math.abs(b.sin * ax + b.cos * az);
    const dist = dx * ax + dz * az;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < best) { best = overlap; const s = dist < 0 ? -1 : 1; bnx = ax * s; bnz = az * s; }
  }
  return { nx: bnx, nz: bnz, depth: best };
}

// Approximate contact point: the vertex of A deepest along -n (used for torque).
export function contactPoint(a, nx, nz) {
  let best = -Infinity, px = a.cx, pz = a.cz;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = a.cx + a.cos * a.hx * sx + a.sin * a.hz * sz;
    const z = a.cz - a.sin * a.hx * sx + a.cos * a.hz * sz;
    const d = -((x - a.cx) * nx + (z - a.cz) * nz);
    if (d > best) { best = d; px = x; pz = z; }
  }
  return [px, pz];
}
