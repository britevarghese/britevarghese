// Placement realism: buildings sit on levelled pads, nothing stands inside anything else, colliders match what is drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, CONQUEST_MAPS, getMap, propFootprint, generateBuilding, BUILDINGS } from '../shared/map.js';
import { CollisionWorld, stepCharacter } from '../shared/world.js';
import { Game } from '../server/game.js';
import { VEHICLES } from '../shared/vehicles.js';

const rects = (m) => m.PROPS.map((p) => ({ p, f: propFootprint(p) })).filter((q) => q.f);
const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad;

test('every building sits on its terrain pad: no ground above the floor inside, doors level with the ground outside', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id), G = m.groundHeight;
    for (const b of m.BUILDINGS) {
      const y0 = m.buildingBase(b), floor = y0 + 0.12;
      for (let x = b.x - b.w / 2; x <= b.x + b.w / 2 + 1e-6; x += 0.5) for (let z = b.z - b.d / 2; z <= b.z + b.d / 2 + 1e-6; z += 0.5) {
        const g = G(x, z);
        assert.ok(g <= floor - 0.05, `${id}/${b.id}: terrain ${(g - floor).toFixed(2)} m above the floor at (${x}, ${z})`);
        assert.ok(g >= y0 - 0.3, `${id}/${b.id}: ${(y0 - 0.3 - g).toFixed(2)} m gap under the plinth at (${x}, ${z})`);
      }
      for (const s of b.doors) {
        const [dx, dz] = { n: [b.x, b.z - b.d / 2 - 1], s: [b.x, b.z + b.d / 2 + 1], w: [b.x - b.w / 2 - 1, b.z], e: [b.x + b.w / 2 + 1, b.z] }[s];
        const step = floor - G(dx, dz);
        assert.ok(step >= -0.05 && step <= 0.35, `${id}/${b.id}: door ${s} is ${step.toFixed(2)} m above the ground outside`);
      }
    }
  }
});

test('buildings do not overlap each other or the roads; flag poles stand in the open', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id), B = m.BUILDINGS;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], c = B[j];
      assert.ok(Math.abs(a.x - c.x) >= (a.w + c.w) / 2 || Math.abs(a.z - c.z) >= (a.d + c.d) / 2, `${id}: ${a.id} overlaps ${c.id}`);
    }
    for (const b of B) for (let x = b.x - b.w / 2; x <= b.x + b.w / 2 + 1e-6; x += 0.5) for (let z = b.z - b.d / 2; z <= b.z + b.d / 2 + 1e-6; z += 0.5) {
      assert.ok(m.roadDistance(x, z) > 0, `${id}: road runs through ${b.id} at (${x}, ${z})`);
    }
    for (const f of m.FLAGS) for (const b of B) assert.ok(!inRect(f.x, f.z, b, 1), `${id}: flag ${f.id} pole inside / against ${b.id}`);
  }
});

test('no solid prop stands inside a building, a flag pole, the railway or another prop; lamps stand on the kerb', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id), R = rects(m);
    for (const { p, f } of R) {
      for (const b of m.BUILDINGS) {
        const ox = f.hx + b.w / 2 - Math.abs(p.x - b.x), oz = f.hz + b.d / 2 - Math.abs(p.z - b.z);
        assert.ok(ox <= 0.01 || oz <= 0.01, `${id}: ${p.type} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) inside ${b.id}`);
      }
      for (const fl of m.FLAGS) assert.ok(Math.abs(p.x - fl.x) >= f.hx + 0.3 || Math.abs(p.z - fl.z) >= f.hz + 0.3, `${id}: ${p.type} on flag ${fl.id}`);
      if (p.type === 'lamp' || p.type === 'utility') assert.ok(m.roadDistance(p.x, p.z) > f.hx, `${id}: ${p.type} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) in the roadway`);
      for (const r of m.ROADS.filter((r) => r.kind === 'rail')) {
        const t = Math.max(0, Math.min(1, ((p.x - r.ax) * (r.bx - r.ax) + (p.z - r.az) * (r.bz - r.az)) / ((r.bx - r.ax) ** 2 + (r.bz - r.az) ** 2)));
        const d = Math.hypot(r.ax + (r.bx - r.ax) * t - p.x, r.az + (r.bz - r.az) * t - p.z);
        assert.ok(d > r.w / 2 + Math.min(f.hx, f.hz), `${id}: ${p.type} on the railway`);
      }
    }
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], c = R[j], ya = a.p.y || 0, yc = c.p.y || 0;
      if (Math.min(ya + a.f.h, yc + c.f.h) - Math.max(ya, yc) <= 0.02) continue; // stacked
      const ox = a.f.hx + c.f.hx - Math.abs(a.p.x - c.p.x), oz = a.f.hz + c.f.hz - Math.abs(a.p.z - c.p.z);
      assert.ok(ox <= 0.02 || oz <= 0.02, `${id}: ${a.p.type} (${a.p.x.toFixed(1)}, ${a.p.z.toFixed(1)}) overlaps ${c.p.type} (${c.p.x.toFixed(1)}, ${c.p.z.toFixed(1)})`);
    }
  }
});

test('large props stand level: the ground under a container / car is flat within 0.12 m', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id), G = m.groundHeight;
    for (const { p, f } of rects(m)) {
      if (!['container', 'car', 'crate_stack', 'trash'].includes(p.type) || p.y) continue;
      const y = G(p.x, p.z);
      for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
        const d = G(p.x + u * f.hx, p.z + v * f.hz) - y;
        assert.ok(Math.abs(d) < 0.12, `${id}: ${p.type} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${d > 0 ? 'buried' : 'floating'} ${Math.abs(d).toFixed(2)} m at a corner`);
      }
    }
  }
});

test('vegetation: fallen logs and rocks have colliders where they are drawn; no tree grows out of a prop', () => {
  for (const id of ['outskirts', 'ridge', 'valley']) {
    const m = getMap(id), V = m.generateVegetation(), R = rects(m);
    const logs = V.trees.filter((t) => t.dead);
    assert.ok(logs.length > 0 && logs.every((t) => t.boxes.length >= 5 && Math.abs(t.tilt) < 0.43), `${id}: logs laid out`);
    for (const t of logs) {
      // the log's ends rest on the ground (no log bridging a hollow in mid-air)
      const k = 1.4 * t.s, ux = Math.cos(t.r), uz = -Math.sin(t.r);
      for (const e of [-1.4, 1.4]) {
        const x = t.x + ux * e * k * Math.cos(t.tilt), z = t.z + uz * e * k * Math.cos(t.tilt), bottom = t.y + e * k * Math.sin(t.tilt);
        assert.ok(bottom - m.groundHeight(x, z) < 0.3, `${id}: log end floating ${(bottom - m.groundHeight(x, z)).toFixed(2)} m`);
      }
    }
    for (const r of V.rocks) {
      const top = Math.max(...r.boxes.map((b) => b.max[1] - r.y));
      const visTop = (r.kind === 'rock_07' ? 0.142 : 0.032 * 1.4) * r.s;
      assert.ok(r.boxes.length && visTop - top < 0.3, `${id}: rock collider ${top.toFixed(2)} m vs drawn ${visTop.toFixed(2)} m`);
    }
    for (const t of V.trees.filter((q) => !q.dead)) for (const { p, f } of R) assert.ok(Math.abs(t.x - p.x) > f.hx || Math.abs(t.z - p.z) > f.hz, `${id}: tree inside ${p.type}`);
  }
});

test('vehicles spawn apart from each other', () => {
  for (const id of CONQUEST_MAPS) {
    const g = new Game({ botsPerTeam: 0, map: id, log: () => {} }), L = g.vehicles.list;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], ra = Math.hypot(VEHICLES[a.type].half[0], VEHICLES[a.type].half[2]), rb = Math.hypot(VEHICLES[b.type].half[0], VEHICLES[b.type].half[2]);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > ra + rb, `${id}: ${a.type} and ${b.type} spawn inside each other`);
    }
  }
});

test('building interiors: solid stair flights, partitions closed to the floor, collapsed roof over the intact half', () => {
  const world = new CollisionWorld(getMap('outskirts'));
  const g = world.buildings.find((x) => x.id === 'b3'), r = g.ramps[0];
  // walking sideways into the middle of the flight is blocked
  const zm = (r.z0 + r.z1) / 2, s = { x: r.x1 + 0.8, y: g.y0 + 0.12, z: zm, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
  for (let i = 0; i < 60; i++) stepCharacter(world, s, { fx: -1, fz: 0 }, 1 / 30);
  assert.ok(s.x > r.x1 + 0.2, `walked into the stair flight from the side (x ${(s.x - r.x1).toFixed(2)})`);
  for (const id of MAP_IDS) for (const b of getMap(id).BUILDINGS) {
    const G = getMap(id).generateBuilding(b);
    for (const p of G.parts.filter((q) => q.part === 'interior')) {
      const rel = p.min[1] - G.y0;
      for (let f = 1; f < b.floors; f++) if (rel > f * G.FH - 0.01 && rel < f * G.FH + 0.3) assert.ok(Math.abs(rel - f * G.FH) < 1e-6, `${id}/${b.id}: ${(rel - f * G.FH).toFixed(2)} m slit under an upper-floor partition`);
    }
  }
  const b4 = generateBuilding(BUILDINGS.find((x) => x.id === 'b4'));
  const roof = b4.parts.filter((p) => p.part === 'roof');
  const gone = new Set(b4.destroyed.map((k) => k.split(':')[0]));
  if (roof.length === 1 && gone.has('s')) assert.ok(roof[0].max[2] <= b4.spec.z + 1e-6, 'roof half kept over the destroyed south side');
  if (roof.length === 1 && gone.has('n')) assert.ok(roof[0].min[2] >= b4.spec.z - 1e-6, 'roof half kept over the destroyed north side');
});

test('pitched roofs collide: a downward ray stops on the tiles, a level ray at the end wall; no stairs up to the attic', () => {
  let n = 0;
  for (const id of MAP_IDS) {
    const world = new CollisionWorld(getMap(id));
    for (const g of world.buildings) {
      const R = g.roof, s = g.spec;
      if (!R) continue;
      assert.ok(g.ramps.every((r) => r.y1 < R.yw - 1), `${id}/${g.id}: a stair flight leads up to the attic`);
      assert.ok(!g.parts.some((p) => p.part === 'rail' && p.min[1] > R.yw - 0.5), `${id}/${g.id}: stair railing in the attic`);
      if (!R.hole) assert.equal(g.parts.filter((p) => p.part === 'roof').length, 1, `${id}/${g.id}: hole in the attic floor`);
      // where the roof fell in, so did the attic floor (no slab left hanging over the destroyed bays)
      else if (s.damage <= 0.6) for (const p of g.parts.filter((q) => q.part === 'roof')) assert.ok(p.max[0] <= R.hole.x0 + 1e-6 || p.min[0] >= R.hole.x1 - 1e-6 || p.max[2] <= R.hole.z0 + 1e-6 || p.min[2] >= R.hole.z1 - 1e-6, `${id}/${g.id}: attic floor under the collapsed roof`);
      const step = R.rise / R.n, surf = (ins) => R.yw + R.t + Math.min(ins, R.half) * R.tan; // tile surface ins metres inside the eave walls
      const ax = R.axis === 'x', L = ax ? s.w : s.d, hip = R.kind === 'hip';
      // downward rays along the ridge line and half-way down a slope (not through the collapsed part or the chimney)
      for (const [u, v] of [[0, 0], [0.25, 0], [-0.25, 0], [0.2, 0.5], [-0.2, -0.5]]) {
        const along = u * L, across = v * R.half;
        const x = ax ? s.x + along : s.x + across, z = ax ? s.z + across : s.z + along;
        if (R.hole && x > R.hole.x0 - 1 && x < R.hole.x1 + 1 && z > R.hole.z0 - 1 && z < R.hole.z1 + 1) continue;
        if (R.chimney && Math.abs(x - R.chimney.x) < 1 && Math.abs(z - R.chimney.z) < 1) continue;
        const ins = Math.min(R.half - Math.abs(across), hip ? L / 2 - Math.abs(along) : Infinity);
        const hit = world.raycast({ x, y: R.yw + R.rise + 6, z }, { x: 0, y: -1, z: 0 }, 40, true);
        assert.ok(hit && Math.abs(hit.point[1] - surf(ins)) <= step / 2 + 0.02,`${id}/${g.id}: downward ray at (${x.toFixed(1)}, ${z.toFixed(1)}) stops at ${hit?.point[1].toFixed(2)}, tiles at ${surf(ins).toFixed(2)}`);
        n++;
      }
      // level ray along the ridge, a third of the way up the roof, from 5 m outside the end: the gable wall (or the
      // hip's end slope) stops it
      const y = R.yw + R.rise / 3, ins = hip ? (R.rise / 3 - R.t) / R.tan : 0;
      for (const dir of [1, -1]) {
        const o = ax ? { x: s.x - dir * (s.w / 2 + 5), y, z: s.z } : { x: s.x, y, z: s.z - dir * (s.d / 2 + 5) };
        if (R.hole && (ax ? s.z > R.hole.z0 - 1 && s.z < R.hole.z1 + 1 : s.x > R.hole.x0 - 1 && s.x < R.hole.x1 + 1)) continue;
        const hit = world.raycast(o, ax ? { x: dir, y: 0, z: 0 } : { x: 0, y: 0, z: dir }, 30, true);
        assert.ok(hit && Math.abs(hit.t - 5 - ins) < step / R.tan / 2 + 0.05, `${id}/${g.id}: level ray through the ${hip ? 'hip end' : 'gable'} went ${hit?.t.toFixed(2)} m (expected ${(5 + ins).toFixed(2)})`);
        n++;
      }
    }
  }
  assert.ok(n > 300, `probed ${n} pitched roofs`);
});

test('balconies: a slab to stand on, a railing that stops bodies (bullets pass a wrought-iron one)', () => {
  const world = new CollisionWorld(getMap('oldtown'));
  const all = world.buildings.flatMap((g) => g.balconies.map((q) => ({ g, q })));
  assert.ok(all.some(({ q }) => q.solid) && all.some(({ q }) => !q.solid), 'both kinds of balcony exist');
  for (const { g, q } of all) {
    const u = (q.a + q.b) / 2, at = (w) => (q.alongX ? { x: u, z: q.face + q.o * w } : { x: q.face + q.o * w, z: u });
    const p = at(q.dep / 2);
    assert.ok(Math.abs(world.supportHeight(p.x, p.z, q.top + 0.3) - q.top) < 1e-6, `${g.id}: no footing on the balcony`);
    // level shot from 6 m out at chest height toward the wall: the iron railing lets it through to the wall
    const o = at(6), d = q.alongX ? { x: 0, y: 0, z: -q.o } : { x: -q.o, y: 0, z: 0 };
    const hit = world.raycast({ ...o, y: q.top + 0.6 }, d, 10, true);
    assert.ok(hit, `${g.id}: shot at the balcony hit nothing`);
    if (q.solid) assert.ok(Math.abs(hit.t - (6 - q.dep)) < 0.02, `${g.id}: solid parapet not hit (${hit.t.toFixed(2)})`);
    else assert.ok(hit.t > 6 - 0.05, `${g.id}: the iron railing stopped a bullet (${hit.t.toFixed(2)})`);
    // a soldier standing on the balcony against the railing is held back
    const s = { ...at(q.dep - 0.1) };
    world.resolveHorizontal(s, q.top, 1.8);
    assert.ok((q.alongX ? (s.z - q.face) * q.o : (s.x - q.face) * q.o) < q.dep - q.rt - 0.3, `${g.id}: walked through the railing`);
  }
});
