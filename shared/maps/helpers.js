// Shared building blocks for map definitions.
import { mulberry32 } from '../util.js';

export function propList() {
  const P = [];
  const add = (type, x, z, rot = 0, extra = {}) => P.push({ type, x, z, rot, ...extra });
  return { P, add };
}

// Fortified spawn (HQ): sandbag lines, barriers, supplies, a precast wall behind. `dir` is the direction the base
// faces toward the objectives: 'n' (-z), 's' (+z), 'e' (+x), 'w' (-x).
export function baseProps(add, b, dir) {
  const f = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
  const r = [-f[1], f[0]]; // right-hand side
  const at = (fw, rt) => [b.x + f[0] * fw + r[0] * rt, b.z + f[1] * fw + r[1] * rt];
  const across = f[0] === 0 ? 0 : 1; // prop rotation for lines perpendicular to the facing direction
  const along = 1 - across;
  const p = (type, fw, rt, rot, extra) => { const [x, z] = at(fw, rt); add(type, x, z, rot, extra); };
  p('sandbags', 10, -12, across, { len: 8 }); p('sandbags', 10, 12, across, { len: 8 });
  p('barrier', 14, -5, across); p('barrier', 14, 5, across);
  p('crate_stack', -4, -9, 0); p('crate_stack', -4, 10, 1); p('generator', -1, 15, 0);
  p('container', -6, 22, along); p('container', 2, -22, along);
  p('wall', -20, 0, across, { len: 56 });
}

// A cluster of small houses on a loose grid (deterministic).
// `avoid` (optional): also keep clear of already existing buildings and of these roads.
export function village(buildings, { id, cx, cz, n, seed, spread = 30, styles = ['plaster', 'brick', 'concrete'], damage = 0.25, avoid = null }) {
  const rnd = mulberry32(seed);
  const placed = [];
  const others = avoid ? [...buildings] : [];
  for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    const w = 8 + Math.round(rnd() * 4), d = 8 + Math.round(rnd() * 4);
    const x = cx + (rnd() - 0.5) * spread * 2, z = cz + (rnd() - 0.5) * spread * 2;
    if (placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 5 && Math.abs(q.z - z) < (q.d + d) / 2 + 5)) continue;
    if (others.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 5 && Math.abs(q.z - z) < (q.d + d) / 2 + 5)) continue;
    if (avoid?.roads?.some((r) => segDist(x, z, r) < r.w / 2 + Math.max(w, d) / 2 + 2)) continue;
    const doors = [['n', 's', 'e', 'w'][Math.floor(rnd() * 4)]];
    const b = { id: `${id}${i}`, x: Math.round(x), z: Math.round(z), w, d, floors: 1 + Math.floor(rnd() * 2), style: styles[Math.floor(rnd() * styles.length)], damage: rnd() < 0.5 ? +(rnd() * damage * 2).toFixed(2) : 0, doors };
    placed.push(b); buildings.push(b); i++;
  }
  return placed;
}

function segDist(px, pz, r) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  const t = Math.max(0, Math.min(1, ((px - r.ax) * dx + (pz - r.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(r.ax + dx * t - px, r.az + dz * t - pz);
}
