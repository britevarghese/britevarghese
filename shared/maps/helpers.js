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

// Can a door on `side` of a w x d house open into a room? The building generator (shared/map.js) splits houses 10 m
// or wider with a partition 1.5 m east of the centre, and runs the stair flight up the inside of the west wall from
// 0.9 m behind the north wall (4.74 m long, houses deeper than 6.84 m): a west door must open where the flight is
// already overhead. Doors sit in the middle wall bay. (Warehouses and bunkers have neither.)
const STAIR_RUN = 3.2 / Math.tan((34 * Math.PI) / 180);
const bayCentre = (L) => { const nb = Math.max(1, Math.round(L / 3.2)); return (Math.floor(nb / 2) + 0.5) * (L / nb); };
export function doorFits(w, d, side, style = 'plaster') {
  if (style === 'warehouse' || style === 'bunker') return true;
  if (side === 'n' || side === 's') return w < 10 || Math.abs(bayCentre(w) - w / 2 - 1.575) > 0.75;
  if (side === 'e') return true;
  return d - 0.6 <= STAIR_RUN + 1.5 || 0.3 + bayCentre(d - 0.6) >= 5.0;
}

const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const overlaps = (a, b, gap = 0) => a.x0 < b.x1 + gap && a.x1 > b.x0 - gap && a.z0 < b.z1 + gap && a.z1 > b.z0 - gap;
const rectOf = (b) => ({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 });
const q4 = (v) => Math.round(v * 4) / 4; // quarter metres: exact in binary, so neighbours touch exactly

// Terraced street frontage: houses shoulder to shoulder on a building line (party walls, front door on the street, a
// back door into the yard where one fits), broken by 2.5-3.5 m alleys every 2-4 houses. `face` is the street side
// of the houses ('n' street to the north: the run goes along x; 'w' / 'e': along z), `at` the building line (the street
// facade), `from`..`to` the run. `avoid`: rects { x0, z0, x1, z1 } kept clear (squares, landmarks, flag zones); other
// buildings keep 1.5 m unless they share the `row` (same block: party walls allowed). `detached`: single houses with
// gardens between (village fringe). Each house lists its shared sides in `party` (no doors there; the building
// generator may build them blind). Returns the houses (also pushed to `buildings`); deterministic (seed).
export function streetFront(buildings, o) {
  const { id, row = id, face, at, from, to, seed, width = [6, 11], depth = [8, 11], floors = [2, 3], every = [2, 4], alley = [2.5, 3.5],
    styles = ['plaster', 'brick', 'concrete'], damage = 0.3, ruin = 0.06, avoid = [], backDoor = 0.6, detached = false } = o;
  const rnd = mulberry32(seed), ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const alongX = face === 'n' || face === 's', inward = face === 'n' || face === 'w' ? 1 : -1;
  const out = [];
  let u = from, left = ri(...every), prev = null, n = 0;
  for (let guard = 0; u < to - width[0] + 1e-6 && guard < 200; guard++) {
    const dd = ri(depth[0], depth[1]);
    let fw = 0;
    for (let k = 0; k < 10 && !fw; k++) {
      const f = Math.min(ri(width[0], width[1]), Math.floor(to - u));
      if (f >= width[0] && doorFits(alongX ? f : dd, alongX ? dd : f, face)) fw = f;
    }
    if (!fw) { u = q4(u + 1); prev = null; continue; }
    const [w, d] = alongX ? [fw, dd] : [dd, fw];
    const b = alongX ? { x: u + w / 2, z: at + (inward * d) / 2, w, d } : { x: at + (inward * w) / 2, z: u + d / 2, w, d };
    const r = rectOf(b);
    const hit = avoid.find((a) => overlaps(r, a, 1.5)) || buildings.find((q) => overlaps(r, rectOf(q), q.row && q.row === row ? -0.01 : 1.5));
    if (hit) {
      const past = alongX ? (hit.x1 ?? hit.x + hit.w / 2) : (hit.z1 ?? hit.z + hit.d / 2);
      u = q4(Math.max(u + 1, past + 1.5)); prev = null; left = ri(...every);
      continue;
    }
    const rr = rnd();
    Object.assign(b, {
      id: `${id}${n++}`, row, floors: ri(...floors), style: styles[Math.floor(rnd() * styles.length)],
      damage: rr < ruin ? +(0.45 + rnd() * 0.3).toFixed(2) : rr < 0.25 ? +(rnd() * damage).toFixed(2) : 0,
      doors: [face], party: [],
    });
    if (rnd() < backDoor && doorFits(w, d, OPP[face])) b.doors.push(OPP[face]);
    // touching the previous house: a shared party wall (no door may open onto it)
    if (prev && Math.abs((alongX ? prev.x + prev.w / 2 : prev.z + prev.d / 2) - u) < 1e-6) { prev.party.push(alongX ? 'e' : 's'); b.party.push(alongX ? 'w' : 'n'); }
    buildings.push(b); out.push(b); prev = b;
    u += fw;
    if (detached || --left <= 0) { u = q4(u + alley[0] + rnd() * (alley[1] - alley[0])); left = ri(...every); prev = null; }
  }
  return out;
}

// A perimeter block between streets: terraced rows along the fronted sides (`sides`: { n, s, w, e } -> true or
// streetFront overrides; n / s rows run the full width, w / e rows fit between them) plus `extra` rows ({ face, at,
// from, to, ...overrides }: e.g. facing a square inside the block), garden walls dividing the back yards, the middle
// left open as a shared courtyard reached through the alleys (`clutter`: a few cars, skips, crates in it). x0..x1 /
// z0..z1 is the buildable rect (behind the sidewalks). Returns { houses, court } (court: the open middle).
export function townBlock(buildings, add, { id, x0, z0, x1, z1, sides, seed, avoid = [], yard = 7, extra = [], clutter = 0, ...opts }) {
  const houses = [];
  const run = (face, extra, i) => {
    const o = { ...opts, ...(extra === true ? {} : extra), id: `${id}${face}`, row: id, face, seed: seed * 7 + i, avoid };
    const dmax = (o.depth || [8, 11])[1];
    // rows on the e / w sides start behind the n / s corner houses they would otherwise run into
    const reach = (sd) => Math.max(0, ...houses.filter((h) => h.face === sd && (face === 'w' ? h.x - h.w / 2 < x0 + dmax + 0.01 : h.x + h.w / 2 > x1 - dmax - 0.01)).map((h) => h.d));
    const line = { n: z0, s: z1, w: x0, e: x1 }[face];
    const span = face === 'n' || face === 's' ? [x0, x1] : [z0 + reach('n'), z1 - reach('s')];
    for (const h of streetFront(buildings, { ...o, at: line, from: q4(span[0]), to: span[1] })) { h.face = face; houses.push(h); }
  };
  ['n', 's', 'w', 'e'].forEach((f, i) => { if (sides[f]) run(f, sides[f], i); });
  extra.forEach(({ face, ...e }, k) => {
    for (const h of streetFront(buildings, { ...opts, ...e, id: `${id}x${k}`, row: id, face, seed: seed * 7 + 4 + k, avoid })) houses.push(Object.assign(h, { face, extra: true }));
  });
  // a back door that would open into the next row's corner house is bricked up
  for (const h of houses) h.doors = h.doors.filter((sd, i) => {
    const [dx, dz] = { n: [h.x, h.z - h.d / 2 - 1], s: [h.x, h.z + h.d / 2 + 1], w: [h.x - h.w / 2 - 1, h.z], e: [h.x + h.w / 2 + 1, h.z] }[sd];
    return i === 0 || !buildings.some((q) => q !== h && Math.abs(dx - q.x) < q.w / 2 + 0.4 && Math.abs(dz - q.z) < q.d / 2 + 0.4);
  });
  // the open middle: inside the deepest house of each fronted side
  const deep = (f) => Math.max(0, ...houses.filter((h) => h.face === f && !h.extra).map((h) => (f === 'n' || f === 's' ? h.d : h.w)));
  const court = { x0: x0 + deep('w'), x1: x1 - deep('e'), z0: z0 + deep('n'), z1: z1 - deep('s') };
  // garden walls between neighbouring back yards (from behind the houses into the courtyard), none across alleys
  const rects = buildings.map(rectOf);
  for (const h of houses) {
    if (!h.party.length) continue;
    const alongX = h.face === 'n' || h.face === 's', inward = h.face === 'n' || h.face === 'w' ? 1 : -1;
    for (const sd of h.party) {
      if (sd !== (alongX ? 'e' : 's')) continue; // each shared wall once (from the house before it)
      const nb = houses.find((q) => q !== h && q.row === h.row && q.face === h.face && q.party.includes(OPP[sd]) && Math.abs(alongX ? q.x - q.w / 2 - (h.x + h.w / 2) : q.z - q.d / 2 - (h.z + h.d / 2)) < 1e-6);
      if (!nb) continue;
      const backOf = (q) => (alongX ? q.z + (inward * q.d) / 2 : q.x + (inward * q.w) / 2);
      const start = inward > 0 ? Math.max(backOf(h), backOf(nb)) + 0.2 : Math.min(backOf(h), backOf(nb)) - 0.2;
      const room = alongX ? (inward > 0 ? (court.z0 + court.z1) / 2 - start : start - (court.z0 + court.z1) / 2) : (inward > 0 ? (court.x0 + court.x1) / 2 - start : start - (court.x0 + court.x1) / 2);
      let len = Math.min(yard, room - 1.5);
      const c = alongX ? h.x + h.w / 2 : h.z + h.d / 2;
      // shorten until the wall is clear of every building (corner rows)
      const wallRect = (L) => (alongX ? { x0: c - 0.2, x1: c + 0.2, z0: Math.min(start, start + inward * L), z1: Math.max(start, start + inward * L) } : { z0: c - 0.2, z1: c + 0.2, x0: Math.min(start, start + inward * L), x1: Math.max(start, start + inward * L) });
      while (len >= 2 && rects.some((r) => overlaps(wallRect(len), r, 0.15))) len -= 1;
      if (len < 2) continue;
      len = Math.round(len);
      const m = start + (inward * len) / 2;
      if (alongX) add('lowwall', c, m, 1, { len }); else add('lowwall', m, c, 0, { len });
    }
  }
  const rnd = mulberry32(seed * 13 + 5), cw = court.x1 - court.x0, cd = court.z1 - court.z0;
  if (cw > 12 && cd > 12) for (let k = 0; k < clutter; k++) {
    const kind = ['car', 'crate_stack', 'trash', 'car', 'barrel'][Math.floor(rnd() * 5)];
    add(kind, q4(court.x0 + 5 + rnd() * (cw - 10)), q4(court.z0 + 5 + rnd() * (cd - 10)), Math.floor(rnd() * 2), kind === 'car' && rnd() < 0.4 ? { burnt: true } : {});
  }
  return { houses, court };
}

// A cluster of small houses (deterministic). With `avoid.roads` most houses line the nearby roads, set back a few
// metres with the front door (and the long side) toward the road; the rest scatter loosely. `avoid` also keeps them
// clear of already existing buildings, of these roads and of the middle of these `flags` (capture zones stay open).
export function village(buildings, { id, cx, cz, n, seed, spread = 30, styles = ['plaster', 'brick', 'concrete'], damage = 0.25, avoid = null }) {
  const rnd = mulberry32(seed);
  const placed = [];
  const others = avoid ? [...buildings] : [];
  const near = (avoid?.roads || []).filter((r) => !r.kind && segDist(cx, cz, r) < spread);
  for (let i = 0, tries = 0; i < n && tries < n * 60; tries++) {
    let w = 8 + Math.round(rnd() * 4), d = 8 + Math.round(rnd() * 4);
    let x = cx + (rnd() - 0.5) * spread * 2, z = cz + (rnd() - 0.5) * spread * 2;
    if (near.length && rnd() < 0.8) {
      // along a road: a point on it near the centre, then off to one side by half the road + a 3-6 m front garden
      const r = near[Math.floor(rnd() * near.length)], L = Math.hypot(r.bx - r.ax, r.bz - r.az), ux = (r.bx - r.ax) / L, uz = (r.bz - r.az) / L;
      const t0 = (cx - r.ax) * ux + (cz - r.az) * uz, t = Math.max(0, Math.min(L, t0 + (rnd() - 0.5) * spread * 2)), side = rnd() < 0.5 ? -1 : 1;
      if (Math.abs(ux) > Math.abs(uz) ? w < d : d < w) [w, d] = [d, w]; // long side to the road
      const off = r.w / 2 + 3 + rnd() * 3 + (w / 2) * Math.abs(uz) + (d / 2) * Math.abs(ux);
      x = r.ax + ux * t - uz * side * off; z = r.az + uz * t + ux * side * off;
    }
    // front door toward the nearest road (or a random side out in the fields)
    let door = ['n', 's', 'e', 'w'][Math.floor(rnd() * 4)];
    const rn = (avoid?.roads || []).filter((r) => !r.kind).sort((a, c) => segDist(x, z, a) - segDist(x, z, c))[0];
    if (rn && segDist(x, z, rn) < 30) {
      const [px, pz] = segPoint(x, z, rn), dx = px - x, dz = pz - z;
      door = Math.abs(dx) / w > Math.abs(dz) / d ? (dx > 0 ? 'e' : 'w') : dz > 0 ? 's' : 'n';
    }
    if (!doorFits(w, d, door)) { if (door === 'w') d = 12; else w = 11; }
    if (placed.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 4 && Math.abs(q.z - z) < (q.d + d) / 2 + 4)) continue;
    if (others.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 5 && Math.abs(q.z - z) < (q.d + d) / 2 + 5)) continue;
    if (avoid?.roads?.some((r) => rectSegDist(x, z, w / 2, d / 2, r) < r.w / 2 + 2)) continue;
    if (avoid?.flags?.some((f) => Math.hypot(Math.max(Math.abs(f.x - x) - w / 2, 0), Math.max(Math.abs(f.z - z) - d / 2, 0)) < Math.max(6, f.r * 0.55))) continue;
    const b ={ id: `${id}${i}`, x: Math.round(x), z: Math.round(z), w, d, floors: 1 + Math.floor(rnd() * 2), style: styles[Math.floor(rnd() * styles.length)], damage: rnd() < 0.5 ? +(rnd() * damage * 2).toFixed(2) : 0, doors: [door] };
    placed.push(b); buildings.push(b); i++;
  }
  return placed;
}

function segPoint(px, pz, r) {
  const dx = r.bx - r.ax, dz = r.bz - r.az;
  const t = Math.max(0, Math.min(1, ((px - r.ax) * dx + (pz - r.az) * dz) / (dx * dx + dz * dz)));
  return [r.ax + dx * t, r.az + dz * t];
}
function segDist(px, pz, r) { const [x, z] = segPoint(px, pz, r); return Math.hypot(x - px, z - pz); }
// distance between a road's centre segment and a rectangle (0 when the segment runs through it)
function rectSegDist(cx, cz, hx, hz, r) {
  const [mx, mz] = segPoint(cx, cz, r);
  if (Math.abs(mx - cx) <= hx && Math.abs(mz - cz) <= hz) return 0;
  let d = Infinity;
  for (const [x, z] of [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]]) d = Math.min(d, segDist(x, z, r));
  for (const [x, z] of [[r.ax, r.az], [r.bx, r.bz]]) d = Math.min(d, Math.hypot(Math.max(Math.abs(x - cx) - hx, 0), Math.max(Math.abs(z - cz) - hz, 0)));
  return d;
}
