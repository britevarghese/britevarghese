// Assembles modular buildings from shared/map.js descriptions: structural walls/slabs (PBR at the textures' real
// size, separate exterior/interior finishes, a facade colour per house, shader weathering), window frames + sills +
// surrounds / lintels + glass + shutters, door frames, canopies and steps, quoins, floor bands, plinths, parapet
// coping, balconies, pitched roofs (Roofs.js), drain pipes, stairs, wall / roof units, breaches with rebar & rubble.
// Everything is merged into one mesh per material.
import * as THREE from 'three';
import { buildBoxGeometry, MeshBuckets } from '../render/Materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '/shared/util.js';
import { buildRoof } from './Roofs.js';

const lin = (c) => c.map((v) => v ** 2.2);
// muted render colours of real town houses (sRGB): cream, ochre, pale yellow, salmon, terracotta, off-white,
// light grey, pale sage, dusty pink, sand
const PAINT = [[0.92, 0.87, 0.75], [0.85, 0.71, 0.48], [0.93, 0.86, 0.6], [0.89, 0.69, 0.57], [0.78, 0.52, 0.4], [0.93, 0.92, 0.88], [0.79, 0.79, 0.77], [0.75, 0.79, 0.69], [0.89, 0.77, 0.73], [0.84, 0.78, 0.65]];
const FRAMES = [[0.92, 0.91, 0.88], [0.92, 0.91, 0.88], [0.36, 0.24, 0.15], [0.22, 0.3, 0.24], [0.42, 0.4, 0.36]];
const SHUTTERS = [[0.26, 0.38, 0.28], [0.42, 0.27, 0.16], [0.38, 0.47, 0.55], [0.47, 0.46, 0.33], [0.55, 0.24, 0.17]];
const SIDING = [[1, 1, 1], [0.75, 0.86, 1.05], [1.15, 0.78, 0.62], [0.82, 1, 0.82], [1.12, 1.05, 0.85]];
const WORN = 0.55; // damage from which the plaster has peeled / the brick facing crumbled (the old worn scans)

// a house's finishes and colours (linear rgb, multiplied with the materials' textures / paint)
function lookOf(spec, rnd) {
  const s = spec.style, worn = (spec.damage || 0) >= WORN, pick = (A) => A[Math.floor(rnd() * A.length)];
  const jit = (c, k) => c.map((v) => v * (1 + (rnd() - 0.5) * k));
  const L = { worn, shutter: null, quoins: false, surrounds: false, lintels: false };
  const paint = jit(pick(PAINT), 0.05), lum = 0.3 * paint[0] + 0.55 * paint[1] + 0.15 * paint[2];
  if (s === 'plaster') {
    L.facade = worn ? 'plaster_worn' : 'plaster_paint'; L.fcol = lin(paint).map((v) => v * (worn ? 0.85 : 1));
    L.trim = lin(lum > 0.86 ? [0.74, 0.7, 0.62] : [0.93, 0.91, 0.86]).map((v) => v * (worn ? 0.8 : 1));
    L.surrounds = true; L.quoins = !worn && rnd() < 0.4; L.shutter = rnd() < 0.55 ? lin(pick(SHUTTERS)) : null;
  } else if (s === 'brick') {
    L.facade = worn ? 'brick_worn' : 'brick_clean'; L.fcol = jit(worn ? [1.3, 1.25, 1.2] : [1, 0.97, 0.95], 0.12); // (the crumbling-brick scan is dark)
    L.trim = lin([0.8, 0.77, 0.7]); L.lintels = !worn; L.quoins = !worn && rnd() < 0.2; L.shutter = rnd() < 0.2 ? lin(pick(SHUTTERS)) : null;
  } else if (s === 'concrete') {
    const k = 0.9 + rnd() * 0.22; L.facade = 'concrete'; L.fcol = [k, k * 0.99, k * 0.96];
    L.trim = lin([0.7, 0.7, 0.68]);
  } else if (s === 'warehouse') {
    // (painted cladding: lighter than the bare scan)
    L.facade = 'metal_siding'; L.fcol = jit(pick(SIDING), 0.06).map((v) => v * 1.5); L.trim = lin([0.6, 0.6, 0.58]);
  } else { L.facade = 'concrete_slab'; L.fcol = [1, 1, 1]; L.trim = lin([0.6, 0.6, 0.58]); }
  L.frame = s === 'concrete' ? lin(rnd() < 0.5 ? [0.9, 0.9, 0.88] : [0.5, 0.45, 0.38]) : lin(pick(FRAMES));
  L.panel = lin(pick([[0.82, 0.8, 0.74], [0.72, 0.76, 0.78], [0.86, 0.78, 0.66], [0.7, 0.68, 0.64]]));
  L.plinth = jit([1, 1, 1], 0.15);
  L.tile = jit(pick([[1, 1, 1], [1, 1, 1], [0.86, 0.8, 0.76], [1.04, 0.93, 0.88]]), 0.06);
  if (s === 'warehouse') L.tile = jit(pick([[1, 1, 1], [0.8, 0.95, 0.85], [1.1, 0.82, 0.7]]), 0.05);
  L.ridge = L.tile.map((v) => v * 0.72);
  L.soffit = lin(rnd() < 0.6 ? [0.45, 0.32, 0.21] : [0.86, 0.84, 0.79]);
  L.fascia = rnd() < 0.5 ? L.soffit : L.frame;
  L.gutter = lin([0.55, 0.56, 0.56]); L.iron = lin([0.16, 0.16, 0.17]); L.charred = lin([0.13, 0.11, 0.09]); L.vent = lin([0.3, 0.29, 0.27]);
  L.rafter = lin([0.42, 0.31, 0.2]);
  L.chimney = [0.88, 0.82, 0.78];
  return L;
}

export function buildBuildings(world, mats) {
  const t0 = performance.now();
  const group = new THREE.Group(); group.name = 'buildings';
  const M = new MeshBuckets(null); // every building appends to the same per-material buckets (one mesh each)
  const wv = [0, 0];
  const glassGeoms = [];
  const glassIds = []; // pane id (shared with CollisionWorld.glass) per glass geometry, in merge order
  const rebarGeoms = [];
  const roofProps = [];
  const rubble = [];

  for (const b of world.buildings) {
    const spec = b.spec, rnd = mulberry32(spec.id.length * 977 + spec.x * 13 + spec.z * 7);
    const L = lookOf(spec, mulberry32(spec.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 3) ^ 0x7a3c));
    const cx = spec.x, cz = spec.z, R = b.roof, wh = spec.style === 'warehouse', bunker = spec.style === 'bunker';
    const house = spec.style === 'plaster' || spec.style === 'brick';
    const tint = 1.0 + rnd() * 0.18;
    const dirtTone = [0.93 + rnd() * 0.07, 0.9 + rnd() * 0.07, 0.86 + rnd() * 0.06];
    const y0 = b.y0, destroyed = new Set(b.destroyed);
    // colours by material (facade finishes are weathered in the shader); unpainted inner surfaces keep the old
    // vertex weathering: grime near the ground, streaks (via noise), lighter upper walls
    const colOf = { [L.facade]: L.fcol, trim: L.trim, plinth: L.plinth, frame_paint: L.frame, metal_paint: L.iron, wood_paint: L.shutter || L.frame };
    const color = (p, part, n, m) => {
      if (part.col) return part.col;
      if (part.part === 'brail') return L.panel;
      if (part.part === 'roof' && R) return [0.5, 0.47, 0.44]; // attic floor: dusty, seen only where the roof fell in
      if (colOf[m]) return colOf[m];
      const h = p[1] - y0;
      const g = 0.8 + 0.2 * Math.min(1, Math.max(0, (h - 0.1) / 1.6));
      const streak = 0.9 + 0.1 * Math.sin(p[0] * 3.1 + p[2] * 2.3);
      const k = tint * g * (n[1] > 0.5 ? 0.92 : streak);
      return [k * dirtTone[0], k * dirtTone[1], k * dirtTone[2]];
    };
    // weather attribute: height above the base, under-sill mask (into a reused pair: consumers copy it at once)
    const weather = (p, part) => { wv[0] = p[1] - y0; wv[1] = part.under ? 1 : 0; return wv; };
    M.w = (p) => { wv[0] = p[1] - y0; wv[1] = 0; return wv; };
    const finish = (m) => (m === 'plaster' || m === 'brick' ? L.facade : m);
    const faceMat = (part, n, fc) => {
      if (part.part === 'ground' || part.part === 'floor') return n[1] > 0.5 ? 'concrete_floor' : n[1] < -0.5 ? 'plaster_int' : 'trim';
      if (part.part === 'parapet' && n[1] === 0 && ((fc[0] - cx) * n[0] + (fc[2] - cz) * n[2]) < 0) return 'concrete';
      if (part.part === 'roof') return n[1] > 0.5 ? part.mat : n[1] < -0.5 ? 'plaster_int' : 'trim';
      if (part.part === 'rail') return 'frame';
      if (part.part === 'interior') return 'plaster_int';
      if (part.part === 'balcony') return n[1] > 0.5 ? 'concrete_floor' : 'trim';
      if (part.part === 'brail') return 'trim';
      // outer walls: exterior finish on the outside face, plaster inside
      const out = (fc[0] - cx) * n[0] + (fc[2] - cz) * n[2];
      const inside = Math.abs(fc[0] - cx) < spec.w / 2 - b.T * 0.9 && Math.abs(fc[2] - cz) < spec.d / 2 - b.T * 0.9;
      if (n[1] !== 0) return finish(part.mat);
      if (out < 0 || inside) return wh ? 'metal_siding' : 'plaster_int';
      return finish(part.mat);
    };
    // (stair flights are drawn as the steps below, the attic boxes as the roof, iron railings as bars)
    const drawn = b.parts.filter((p) => p.part !== 'stair' && p.part !== 'attic' && p.part !== 'chimney' && !(p.part === 'brail' && p.bullets === false));
    buildBoxGeometry(drawn, { tile: 1, faceMat, color, weather, into: M });

    // ---- trims & details (visual only)
    const trims = [];
    const T = b.T, x0 = cx - spec.w / 2, x1 = cx + spec.w / 2, z0 = cz - spec.d / 2, z1 = cz + spec.d / 2;
    const FH = b.FH, top = y0 + spec.floors * FH;
    // bays per side as the generator lays them out (u along the side from its start)
    const sideOf = {
      n: { alongX: true, base: x0, L: spec.w, face: z0, o: -1 }, s: { alongX: true, base: x0, L: spec.w, face: z1, o: 1 },
      w: { alongX: false, base: z0 + T, L: spec.d - 2 * T, face: x0, o: -1 }, e: { alongX: false, base: z0 + T, L: spec.d - 2 * T, face: x1, o: 1 },
    };
    for (const sd of Object.values(sideOf)) { sd.nb = Math.max(1, Math.round(sd.L / (wh ? 4 : 3.2))); sd.bw = sd.L / sd.nb; }
    // a box on the outer face of a side: u along it, w out of the wall, y absolute
    // (its face toward the wall is not drawn: index into the box builder's faces, -n of the side's normal)
    const onFace = (s, ua, ub, wa, wb, ya, yb, mat, col) => {
      const sd = sideOf[s], a = sd.base + ua, c = sd.base + ub, p = sd.face + sd.o * wa, q = sd.face + sd.o * wb;
      const box = sd.alongX ? { min: [a, ya, Math.min(p, q)], max: [c, yb, Math.max(p, q)] } : { min: [Math.min(p, q), ya, a], max: [Math.max(p, q), yb, c] };
      trims.push({ ...box, mat, col, hide: sd.alongX ? (sd.o < 0 ? 4 : 5) : (sd.o < 0 ? 0 : 1) });
    };
    // horizontal band around the building (floor bands, warehouse eaves), interrupted over destroyed bays of floor f
    const band = (y, h, out, mat, f = -1) => {
      for (const [s, sd] of Object.entries(sideOf)) {
        const ext = sd.alongX ? out : 0; // the long sides cover the corners
        for (let i = 0; i < sd.nb; i++) {
          if (f >= 0 && destroyed.has(`${s}:${f}:${i}`)) continue;
          const ua = i * sd.bw - (i === 0 ? ext + (sd.alongX ? 0 : T) : 0), ub = (i + 1) * sd.bw + (i === sd.nb - 1 ? ext + (sd.alongX ? 0 : T) : 0);
          onFace(s, ua, ub, -0.02, out, y, y + h, mat);
        }
      }
    };
    // the plinth stops at the doorways (only a threshold up to floor level runs across them)
    const doorGaps = { n: [], s: [], w: [], e: [] };
    for (const o of b.openings) if (o.kind === 'door' || o.kind === 'bigdoor') doorGaps[o.side].push([(o.sd.dir[0] ? o.sd.ax : o.sd.az) + o.u0, (o.sd.dir[0] ? o.sd.ax : o.sd.az) + o.u1]);
    const plinth = (y, h, out) => {
      const sides = [['n', [x0 - out, z0 - out], [x1 + out, z0 + 0.02]], ['s', [x0 - out, z1 - 0.02], [x1 + out, z1 + out]], ['w', [x0 - out, z0], [x0 + 0.02, z1]], ['e', [x1 - 0.02, z0], [x1 + out, z1]]];
      for (const [sd, mn, mx] of sides) {
        const ax = sd === 'n' || sd === 's' ? 0 : 1; // runs along x (0) or z (1)
        let from = mn[ax];
        const piece = (a, c, top2) => { if (c - a < 0.01) return; const lo = [...mn], hi = [...mx]; lo[ax] = a; hi[ax] = c; trims.push({ min: [lo[0], y, lo[1]], max: [hi[0], top2, hi[1]], mat: 'plinth' }); };
        for (const [g0, g1] of doorGaps[sd].sort((p, q) => p[0] - q[0])) { piece(from, g0, y + h); piece(g0, g1, y0 + 0.1); from = g1; }
        piece(from, mx[ax], y + h);
      }
    };
    if (!wh) {
      plinth(y0 - 0.3, 0.75, 0.04);
      for (let f = 1; f < spec.floors; f++) band(y0 + f * FH - 0.28, 0.3, 0.035, 'trim', f - 1);
    } else {
      plinth(y0 - 0.3, 0.9, 0.03);
      band(y0 + FH - 0.32, 0.25, 0.08, 'frame');
    }
    // parapet coping: a projecting cap on every parapet piece
    // (the end sides' caps 5 mm lower: no coplanar overlap where they meet the long sides' at the corners)
    for (const p of b.parts) if (p.part === 'parapet') trims.push({ min: [p.min[0] - 0.05, p.max[1], p.min[2] - 0.05], max: [p.max[0] + 0.05, p.max[1] + (p.max[0] - p.min[0] > p.max[2] - p.min[2] ? 0.07 : 0.065), p.max[2] + 0.05], mat: 'trim' });
    // quoins: alternating long / short stone blocks up the corners (not where a corner bay came down)
    if (L.quoins) {
      const corners = [[x0, z0, 'n', 0, 'w', 0], [x1, z0, 'n', sideOf.n.nb - 1, 'e', 0], [x0, z1, 's', 0, 'w', sideOf.w.nb - 1], [x1, z1, 's', sideOf.s.nb - 1, 'e', sideOf.e.nb - 1]];
      const yTop = R ? R.yw - 0.05 : top + (bunker ? 0.5 : 0.9) - 0.1;
      for (const [qx, qz, sa, ia, sb, ib] of corners) {
        const ex = qx === x0 ? -1 : 1, ez = qz === z0 ? -1 : 1;
        for (let k = 0, y = y0 + 0.5; y + 0.27 < yTop; k++, y += 0.3) {
          const f = Math.floor((y - y0) / FH);
          if (destroyed.has(`${sa}:${f}:${ia}`) || destroyed.has(`${sb}:${f}:${ib}`)) continue;
          const la = k % 2 ? 0.28 : 0.48, lb = k % 2 ? 0.48 : 0.28, col = L.trim;
          // along x on the n / s face, along z on the w / e face; both 2.5 cm proud of the wall
          trims.push({ min: [ex < 0 ? qx - 0.025 : qx - la, y, ez < 0 ? qz - 0.025 : qz - 0.001], max: [ex < 0 ? qx + la : qx + 0.025, y + 0.27, ez < 0 ? qz + 0.001 : qz + 0.025], mat: 'trim', col, hide: ez < 0 ? 4 : 5 });
          trims.push({ min: [ex < 0 ? qx - 0.025 : qx - 0.001, y, ez < 0 ? qz - 0.025 : qz - lb], max: [ex < 0 ? qx + 0.001 : qx + 0.025, y + 0.27, ez < 0 ? qz + lb : qz + 0.025], mat: 'trim', col, hide: ex < 0 ? 0 : 1 });
        }
      }
    }
    const frameMat = wh || bunker ? 'frame' : 'frame_paint';
    const balcAt = new Set(b.balconies.map((q) => `${q.side}:${q.f}`));
    // openings: frames, sills, glass, lintels, surrounds, shutters, canopies
    for (const [oi, o] of b.openings.entries()) {
      const sd = o.sd, alongX = sd.dir[0] !== 0, S = sideOf[o.side];
      const ft = 0.06, depth = T + 0.04;
      const outN = sd.out;
      const at = (u, v0, v1, w) => {
        // a frame member spanning u..u+w along the wall, v0..v1 vertical (opening heights are relative to the
        // building's base, which sits on the terrain: y0 must be added — it is metres off zero on hilly maps)
        if (alongX) return { min: [sd.ax + u, y0 + v0, sd.az - 0.02], max: [sd.ax + u + w, y0 + v1, sd.az + depth - 0.02] };
        return { min: [sd.ax - 0.02, y0 + v0, sd.az + u], max: [sd.ax + depth - 0.02, y0 + v1, sd.az + u + w] };
      };
      if (o.kind === 'breach') {
        // exposed rebar sticking out of the broken wall stub
        for (let r = 0; r < 5; r++) {
          const u = o.u0 + 0.2 + rnd() * (o.u1 - o.u0 - 0.4), len = 0.3 + rnd() * 0.7;
          const cyl = new THREE.CylinderGeometry(0.008, 0.008, len, 5);
          cyl.rotateZ((rnd() - 0.5) * 0.6); cyl.rotateX((rnd() - 0.5) * 0.6);
          const wx = alongX ? sd.ax + u : sd.ax + T / 2, wz = alongX ? sd.az + T / 2 : sd.az + u;
          cyl.translate(wx, y0 + o.v0 + len / 2, wz);
          rebarGeoms.push(cyl);
        }
        const mid = (o.u0 + o.u1) / 2;
        rubble.push({ x: alongX ? sd.ax + mid : sd.ax + outN[0] * 1.2, z: alongX ? sd.az + outN[1] * 1.2 : sd.az + mid, y: y0, n: 5 });
        continue;
      }
      const w = o.u1 - o.u0;
      if (o.kind === 'door' || o.kind === 'bigdoor') {
        trims.push({ ...at(o.u0 - ft, o.v0, o.v1 + ft, ft), mat: frameMat });
        trims.push({ ...at(o.u1, o.v0, o.v1 + ft, ft), mat: frameMat });
        trims.push({ ...at(o.u0 - ft, o.v1, o.v1 + ft, w + 2 * ft), mat: frameMat });
        // roller shutter anchored at the opening's u0 end on the wall's mid-plane, running along +u (+x or +z)
        if (o.kind === 'bigdoor') roofProps.push({ type: 'rollershutter', x: alongX ? sd.ax + o.u0 : sd.ax + T / 2, z: alongX ? sd.az + T / 2 : sd.az + o.u0, y: y0 + o.v1 - 0.1, rot: alongX ? 0 : -Math.PI / 2, w });
        else {
          const a = o.u0, c = o.u1;
          // entrance step, and a canopy on brackets unless a balcony shelters the door
          onFace(o.side, a - 0.3, c + 0.3, -0.02, 0.5, y0 - 0.3, y0 + 0.08, 'concrete_slab', L.plinth);
          if (!balcAt.has(`${o.side}:1`) || spec.floors < 2) {
            onFace(o.side, a - 0.35, c + 0.35, -0.02, 0.85, y0 + o.v1 + 0.3, y0 + o.v1 + 0.42, 'trim');
            for (const u of [a - 0.25, c + 0.17]) onFace(o.side, u, u + 0.08, -0.02, 0.6, y0 + o.v1 + 0.12, y0 + o.v1 + 0.3, 'trim');
          }
          if (L.surrounds) onFace(o.side, a - 0.14, c + 0.14, -0.02, 0.03, y0 + o.v1 + ft, y0 + o.v1 + ft + 0.14, 'trim');
        }
        continue;
      }
      // window: frame, sill (projecting), mullion, glass
      trims.push({ ...at(o.u0, o.v0, o.v1, ft), mat: frameMat });
      trims.push({ ...at(o.u1 - ft, o.v0, o.v1, ft), mat: frameMat });
      trims.push({ ...at(o.u0, o.v1 - ft, o.v1, w), mat: frameMat });
      trims.push({ ...at(o.u0, o.v0, o.v0 + ft, w), mat: frameMat });
      if (o.kind === 'window') {
        trims.push({ ...at(o.u0 + w / 2 - 0.02, o.v0, o.v1, 0.04), mat: frameMat });
        trims.push({ ...at(o.u0, o.v1 - 0.45, o.v1 - 0.41, w), mat: frameMat }); // transom
      }
      // sill projecting outward
      const sill = at(o.u0 - 0.06, o.v0 - 0.06, o.v0, w + 0.12);
      if (alongX) { if (outN[1] < 0) sill.min[2] -= 0.08; else sill.max[2] += 0.08; } else { if (outN[0] < 0) sill.min[0] -= 0.08; else sill.max[0] += 0.08; }
      trims.push({ ...sill, mat: 'trim' });
      if (o.kind === 'window') {
        const a = o.u0, c = o.u1, yb = y0 + o.v0, yt = y0 + o.v1;
        // plaster houses: a flat stucco surround; brick houses: a stone lintel
        if (L.surrounds) {
          onFace(o.side, a - 0.13, a, -0.02, 0.03, yb - 0.06, yt + 0.13, 'trim');
          onFace(o.side, c, c + 0.13, -0.02, 0.03, yb - 0.06, yt + 0.13, 'trim');
          onFace(o.side, a, c, -0.02, 0.03, yt, yt + 0.13, 'trim');
        }
        if (L.lintels) onFace(o.side, a - 0.12, c + 0.12, -0.02, 0.02, yt, yt + 0.22, 'trim');
        // open shutters folded back against the wall either side (when the bay leaves room)
        const gap = L.surrounds ? 0.15 : 0.04, sw = Math.min(w / 2, (S.bw - w) / 2 - 0.15 - (L.surrounds ? 0.13 : 0));
        if (L.shutter && sw > 0.38) for (const ua of [a - gap - sw, c + gap]) onFace(o.side, ua, ua + sw, 0.035, 0.07, yb, yt, 'wood_paint', L.shutter);
      }
      if (o.glass) {
        const g = new THREE.PlaneGeometry(w - 2 * ft, o.v1 - o.v0 - 2 * ft);
        if (!alongX) g.rotateY(Math.PI / 2);
        g.translate(alongX ? sd.ax + (o.u0 + o.u1) / 2 : sd.ax + T / 2, y0 + (o.v0 + o.v1) / 2, alongX ? sd.az + T / 2 : sd.az + (o.u0 + o.u1) / 2);
        glassGeoms.push(g);
        glassIds.push(`${b.id}:${oi}`);
      }
    }
    // balconies with wrought-iron railings: rails and bars (the solid concrete ones are drawn from their colliders)
    for (const q of b.balconies) {
      if (q.solid) continue;
      const box = (ua, ub, wa, wb, ya, yb) => {
        const p = q.face + q.o * wa, r = q.face + q.o * wb;
        trims.push(q.alongX ? { min: [ua, ya, Math.min(p, r)], max: [ub, yb, Math.max(p, r)], mat: 'metal_paint' } : { min: [Math.min(p, r), ya, ua], max: [Math.max(p, r), yb, ub], mat: 'metal_paint' });
      };
      const yt = q.top + q.rh;
      for (const [ya, yb] of [[yt - 0.05, yt], [q.top + 0.08, q.top + 0.11]]) {
        box(q.a, q.b, q.dep - 0.05, q.dep, ya, yb);
        box(q.a, q.a + 0.04, 0, q.dep, ya, yb); box(q.b - 0.04, q.b, 0, q.dep, ya, yb);
      }
      for (let u = q.a + 0.02; u < q.b - 0.02; u += 0.12) box(u, u + 0.018, q.dep - 0.035, q.dep - 0.017, q.top, yt - 0.05);
      for (let w = 0.12; w < q.dep - 0.06; w += 0.12) for (const u of [q.a + 0.011, q.b - 0.029]) box(u, u + 0.018, w, w + 0.018, q.top, yt - 0.05);
    }
    // pitched roof (tiles, eaves, gables, chimney); the rubble of a collapsed part lies on the top floor (the attic
    // floor came down with it)
    if (R) for (const r of buildRoof(R, M, L, rnd).rubble) rubble.push({ ...r, y: top - FH + (spec.floors === 1 ? 0.12 : 0) });
    // drain pipes: down from the gutters at the ends of the eaves (pitched), or at two corners (flat roof)
    if (!bunker) {
      if (R) {
        const ax = R.axis === 'x', gy = R.yw - R.ov * R.tan - 0.08;
        const spots = ax ? [[x0 + 0.25, z0, 0, -1], [x1 - 0.25, z1, 0, 1]] : [[x0, z0 + 0.25, -1, 0], [x1, z1 - 0.25, 1, 0]];
        for (const [px, pz, ox, oz] of spots) {
          const wx = px + ox * 0.09, wz = pz + oz * 0.09, bend = gy - 0.45;
          if (R.hole && wx > R.hole.x0 - 0.5 && wx < R.hole.x1 + 0.5 && wz > R.hole.z0 - 0.5 && wz < R.hole.z1 + 0.5) continue;
          rebarGeoms.push(tube([wx, y0 - 0.1, wz], [wx, bend, wz], 0.05));
          rebarGeoms.push(tube([wx, bend, wz], [px + ox * (R.ov + 0.04), gy, pz + oz * (R.ov + 0.04)], 0.05));
        }
      } else {
        const ptop = y0 + spec.floors * FH + (wh ? 0 : 0.8);
        for (const [px, pz] of [[x0 - 0.08, z0 - 0.08], [x1 + 0.08, z1 + 0.08]]) {
          const c = new THREE.CylinderGeometry(0.05, 0.05, ptop - y0, 8); c.translate(px, (ptop + y0) / 2, pz); rebarGeoms.push(c);
        }
      }
    }
    // stairs: real steps along each ramp
    for (const r of b.ramps) {
      const n = Math.round((r.y1 - r.y0) / 0.18);
      for (let i = 0; i < n; i++) {
        const t0s = i / n, t1s = (i + 1) / n;
        trims.push({ min: [r.x0, r.y0 - 0.15 + (r.y1 - r.y0) * t0s, r.z0 + (r.z1 - r.z0) * t0s], max: [r.x1, r.y0 + (r.y1 - r.y0) * t1s, r.z0 + (r.z1 - r.z0) * t1s], mat: 'concrete_floor' });
      }
    }
    // roof equipment on flat roofs; split units on house walls under an upper window, satellite dishes
    if (!R && (!spec.damage || spec.damage < 0.6)) {
      const ry = y0 + spec.floors * FH;
      if (!bunker) roofProps.push({ type: 'aircon', x: cx + (rnd() - 0.5) * (spec.w - 3), z: cz + (rnd() - 0.5) * (spec.d - 3), y: ry, rot: Math.floor(rnd() * 4) * Math.PI / 2 });
    }
    if (!wh && !bunker && (spec.damage || 0) < 0.6) {
      // split-AC units on brackets under a window (upper floors when there are some; not under a balcony)
      const wins = b.openings.filter((o) => o.kind === 'window' && (spec.floors < 2 || o.v0 > FH) && !balcAt.has(`${o.side}:${Math.floor(o.v0 / FH)}`));
      const n = spec.style === 'concrete' ? Math.floor(rnd() * 4) : rnd() < 0.45 ? 1 : 0;
      for (let k = 0; k < n && wins.length; k++) {
        const o = wins.splice(Math.floor(rnd() * wins.length), 1)[0], S = sideOf[o.side], u = (o.u0 + o.u1) / 2;
        const along = S.base + u, out = S.face + S.o * 0.24, y = y0 + o.v0 - 0.62;
        roofProps.push({ type: 'wallac', x: S.alongX ? along : out, z: S.alongX ? out : along, y, rot: S.alongX ? (S.o > 0 ? 0 : Math.PI) : (S.o > 0 ? Math.PI / 2 : -Math.PI / 2) });
        for (const du of [-0.3, 0.3]) onFace(o.side, u + du - 0.02, u + du + 0.02, 0, 0.4, y - 0.2, y - 0.16, 'metal_paint', L.iron);
      }
      if (rnd() < (house ? 0.3 : 0.5)) dish(rnd, sideOf, (R ? R.yw : top) - 0.7, M, onFace);
    }
    if (spec.damage > 0.2) rubble.push({ x: cx + (rnd() - 0.5) * spec.w * 0.5, z: cz + (rnd() - 0.5) * spec.d * 0.5, y: y0 + 0.12, n: 4 });
    buildBoxGeometry(trims, { tile: 1, color, weather, into: M });
  }

  for (const [m, geo] of M.geometries()) {
    const mesh = new THREE.Mesh(geo, mats.building(m, { weather: true }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `bld_${m}`;
    group.add(mesh);
  }
  let glass = null;
  if (glassGeoms.length) {
    const gm = new THREE.Mesh(mergeGeometries(glassGeoms), mats.glass()); gm.renderOrder = 1; gm.name = 'windows'; group.add(gm);
    // each pane is 4 vertices in merge order: breaking one collapses them (no draw-call cost, no rebuild)
    const index = new Map(glassIds.map((id, i) => [id, i * 4]));
    glass = { mesh: gm, index, original: gm.geometry.attributes.position.array.slice() };
  }
  if (rebarGeoms.length) {
    const rm = new THREE.Mesh(mergeGeometries(rebarGeoms.map((g) => g.toNonIndexed ? g.index ? g.toNonIndexed() : g : g)), mats.pbr('rusty_metal', { color: 0x8a7a6a }));
    rm.castShadow = true; rm.name = 'rebar_pipes'; group.add(rm);
  }
  group.userData.buildMs = performance.now() - t0;
  return { group, roofProps, rubble, glass };
}

// pipe between two points
function tube(a, b, r) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), l = d.length();
  const g = new THREE.CylinderGeometry(r, r, l, 8);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

// satellite dish on a wall bracket under the eaves / below the parapet, facing south-ish and up
function dish(rnd, sideOf, y, M, onFace) {
  const s = rnd() < 0.7 ? 's' : ['e', 'w', 'n'][Math.floor(rnd() * 3)], S = sideOf[s];
  const u = S.L * (0.15 + rnd() * 0.7), along = S.base + u, out = S.face + S.o * 0.45;
  // a shallow spherical cap: pole toward the wall, concave side out, tilted 26° up
  const g = new THREE.SphereGeometry(0.42, 14, 4, 0, Math.PI * 2, 0, 0.55);
  g.rotateX(-Math.PI / 2); g.scale(1, 1.1, 0.6); g.translate(0, 0, 0.24);
  g.rotateX(-0.45);
  g.rotateY(S.alongX ? (S.o > 0 ? 0 : Math.PI) : (S.o > 0 ? Math.PI / 2 : -Math.PI / 2));
  g.translate(...(S.alongX ? [along, y + 0.1, out] : [out, y + 0.1, along]));
  M.geometry('metal_paint', g, lin([0.82, 0.82, 0.8]));
  onFace(s, u - 0.025, u + 0.025, 0, 0.45, y - 0.03, y + 0.02, 'metal_paint', lin([0.5, 0.5, 0.5])); // wall arm
}
