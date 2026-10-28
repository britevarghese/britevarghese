// Concealment by vegetation for bot perception. Bushes, ferns and tree crowns don't stop bullets (so they are not in
// the collision world), but a soldier lying in a bush or crouched behind a fern is hard to see. Sizes are measured
// from the vegetation models as the client places them (shrub: 0.58 x 0.22 m model at 1.3 s, fern: 1.97 x 0.43 m at
// 0.7 s, tree crown: ~2.2-4.6 m up at scale s, ~1.4 s across).
const CELL = 8;

export class Foliage {
  constructor(world) {
    const map = world.map, veg = world.vegetation || map.generateVegetation();
    this.map = map;
    this.grid = new Map();
    for (const s of veg.shrubs) {
      const shrub = s.kind === 'shrub', k = shrub ? s.s * 1.3 : s.s * 0.7;
      // the models grow out to one side of their origin: centre the blob on the visible mass
      const ox = (shrub ? 0.27 : 0.46) * k, oz = (shrub ? 0 : 0.44) * k, c = Math.cos(s.r), sn = Math.sin(s.r);
      this.#add({ x: s.x + ox * c + oz * sn, z: s.z - ox * sn + oz * c, r: (shrub ? 0.32 : 0.9) * k, lo: -0.1, hi: (shrub ? 0.21 : 0.4) * k, dens: shrub ? 1.6 : 1.1 });
    }
    for (const t of veg.trees) if (!t.dead) this.#add({ x: t.x, z: t.z, r: 1.5 * t.s, lo: 2.2 * t.s, hi: 4.4 * t.s, dens: 0.55 });
  }

  #add(b) {
    b.y = this.map.groundHeight(b.x, b.z);
    const x0 = Math.floor((b.x - b.r) / CELL), x1 = Math.floor((b.x + b.r) / CELL), z0 = Math.floor((b.z - b.r) / CELL), z1 = Math.floor((b.z + b.r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = `${i},${j}`;
      (this.grid.get(k) || this.grid.set(k, []).get(k)).push(b);
    }
  }

  // 0 = in plain view .. 1 = fully hidden: foliage the sight line a -> b passes through, summed by density x metres
  // inside (only the last 25 m before the target count: a bush right in front of the viewer is easy to look past)
  cover(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz);
    if (len < 1e-3) return 0;
    const span = Math.min(len, 25), step = 0.4;
    let acc = 0;
    for (let d = len - 0.15; d > len - span; d -= step) {
      const t = d / len, x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
      const cell = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!cell) continue;
      for (const f of cell) {
        const ex = x - f.x, ez = z - f.z;
        if (ex * ex + ez * ez > f.r * f.r) continue;
        const h = y - f.y;
        if (h >= f.lo && h <= f.hi) acc += f.dens * step;
      }
      if (acc >= 1) return 1;
    }
    return acc;
  }
}
