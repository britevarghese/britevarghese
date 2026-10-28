// Map realism: Old Town is a town (terraced street fronts, open squares), doors lead into rooms, paving and
// sidewalks stay clear of houses and vegetation, the harbour cranes stand where they collide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, getMap, propFootprint, SEA_LEVEL } from '../shared/map.js';
import { CollisionWorld } from '../shared/world.js';
import { NavGrid } from '../server/nav.js';

const segDist = (x, z, r) => {
  const dx = r.bx - r.ax, dz = r.bz - r.az, t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(r.ax + dx * t - x, r.az + dz * t - z);
};
const outside = (b, s, k = 1) => ({ n: [b.x, b.z - b.d / 2 - k], s: [b.x, b.z + b.d / 2 + k], w: [b.x - b.w / 2 - k, b.z], e: [b.x + b.w / 2 + k, b.z] }[s]);

test('Old Town is a dense town: terraced street fronts on sidewalks, open squares and flag zones', () => {
  const m = getMap('oldtown'), B = m.BUILDINGS, houses = B.filter((b) => b.row);
  assert.ok(B.length >= 90 && B.length <= 130, `${B.length} buildings`);
  for (const id of MAP_IDS) { const ids = getMap(id).BUILDINGS.map((b) => b.id); assert.equal(new Set(ids).size, ids.length, `${id}: building ids unique`); }
  assert.ok(houses.length / B.length > 0.9, 'nearly every building stands in a street row');
  const touching = (a, c) => (Math.abs(Math.abs(a.x - c.x) - (a.w + c.w) / 2) < 1e-6 && Math.abs(a.z - c.z) < (a.d + c.d) / 2) || (Math.abs(Math.abs(a.z - c.z) - (a.d + c.d) / 2) < 1e-6 && Math.abs(a.x - c.x) < (a.w + c.w) / 2);
  const terraced = houses.filter((h) => houses.some((o) => o !== h && o.row === h.row && touching(h, o)));
  assert.ok(terraced.length / houses.length > 0.6, `${terraced.length} / ${houses.length} houses share a party wall`);
  // front doors open onto a sidewalk, a square or the street; party walls have no doors
  for (const h of houses) {
    const [x, z] = outside(h, h.doors[0], 1.2);
    assert.ok(m.pavedAt(x, z) || m.roadDistance(x, z) < 0.5, `${h.id}: front door (${h.doors[0]}) opens onto (${x}, ${z}), not a street`);
    for (const s of h.doors) assert.ok(!h.party.includes(s), `${h.id}: door on a party wall`);
  }
  // squares and flag zones are open ground: no house within 6 m of a pole
  for (const f of m.FLAGS) for (const b of B) {
    const d = Math.hypot(Math.max(Math.abs(f.x - b.x) - b.w / 2, 0), Math.max(Math.abs(f.z - b.z) - b.d / 2, 0));
    assert.ok(d > 6, `flag ${f.id} hemmed in by ${b.id} (${d.toFixed(1)} m)`);
  }
  // alleys: every inner block's terraces are broken into at least 4 runs (gaps lead into the courtyard)
  for (const row of ['oa', 'ob', 'oc', 'od']) {
    const H = houses.filter((h) => h.row === row), seen = new Set();
    let runs = 0;
    for (const h of H) {
      if (seen.has(h)) continue;
      runs++;
      const stack = [h]; seen.add(h);
      while (stack.length) { const a = stack.pop(); for (const o of H) if (!seen.has(o) && touching(a, o)) { seen.add(o); stack.push(o); } }
    }
    assert.ok(runs >= 4, `block ${row}: ${runs} runs of houses`);
  }
  // garden walls divide the back yards
  assert.ok(m.PROPS.filter((p) => p.type === 'lowwall').length >= 20, 'garden walls');
  // bots can walk in through every door (the nav grid opens doorways that fall between its cells)
  const w = new CollisionWorld(m), nav = new NavGrid(w);
  for (const g of w.buildings) for (const o of g.openings) {
    if (o.kind !== 'door') continue;
    const sd = o.sd, u = (o.u0 + o.u1) / 2, x = sd.dir[0] ? sd.ax + u : sd.ax + g.T / 2, z = sd.dir[0] ? sd.az + g.T / 2 : sd.az + u;
    assert.ok(nav.free(nav.ix(x), nav.iz(z)), `${g.id}: door ${o.side} closed to the bots`);
  }
});

test('every door leads into a room: no stair flight or partition right behind it, no neighbour in front of it', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id);
    for (const b of m.BUILDINGS) {
      const g = m.generateBuilding(b), boxes = g.parts.filter((p) => p.collide), floor = g.y0 + 0.12;
      for (const s of b.doors) {
        const o = g.openings.find((q) => q.side === s && (q.kind === 'door' || q.kind === 'bigdoor'));
        const [ox, oz] = outside(b, s);
        assert.ok(!m.BUILDINGS.some((q) => q !== b && Math.abs(ox - q.x) < q.w / 2 && Math.abs(oz - q.z) < q.d / 2), `${id}/${b.id}: door ${s} opens into a neighbour`);
        if (!o) continue; // the door bay was blown out (a breach)
        const sd = o.sd, alongX = sd.dir[0] !== 0, u = (o.u0 + o.u1) / 2;
        const cx = alongX ? sd.ax + u : sd.ax + g.T / 2, cz = alongX ? sd.az + g.T / 2 : sd.az + u;
        for (const depth of [0.6, 1.3]) {
          const x = cx - sd.out[0] * depth, z = cz - sd.out[1] * depth, r = 0.3;
          const hit = boxes.find((q) => x + r > q.min[0] && x - r < q.max[0] && z + r > q.min[2] && z - r < q.max[2] && q.max[1] > floor + 0.45 && q.min[1] < floor + 1.75);
          assert.ok(!hit, `${id}/${b.id}: ${hit?.part} ${depth} m behind door ${s}`);
        }
      }
    }
  }
});

test('paving: sidewalks run clear of houses, nothing grows on paving, flag poles stay in the open', () => {
  for (const id of MAP_IDS) {
    const m = getMap(id);
    for (const r of m.SIDEWALKS) for (const b of m.BUILDINGS) {
      for (const [x, z] of [[b.x - b.w / 2, b.z - b.d / 2], [b.x + b.w / 2, b.z - b.d / 2], [b.x - b.w / 2, b.z + b.d / 2], [b.x + b.w / 2, b.z + b.d / 2], [b.x, b.z - b.d / 2], [b.x, b.z + b.d / 2], [b.x - b.w / 2, b.z], [b.x + b.w / 2, b.z]]) {
        const d = segDist(x, z, r) - r.w / 2;
        assert.ok(d > r.sidewalk - 0.01 || segDist(b.x, b.z, r) - r.w / 2 < 0, `${id}/${b.id} stands on the ${r.name} sidewalk (${d.toFixed(2)} m)`);
      }
    }
    for (const p of m.PAVED) assert.ok(p.x1 > p.x0 && p.z1 > p.z0 && m.seaFactor((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2) === 0, `${id}: paved rect`);
  }
  for (const id of ['oldtown', 'harbor']) {
    const m = getMap(id), V = m.generateVegetation();
    for (const t of [...V.trees, ...V.shrubs, ...V.rocks]) assert.ok(!m.pavedAt(t.x, t.z), `${id}: vegetation on paving at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`);
    assert.ok(m.PAVED.length >= 2, `${id}: paved areas`);
  }
});

test('harbour: gantry cranes straddle the quay road with solid legs, the ship floats alongside', () => {
  const m = getMap('harbor'), w = new CollisionWorld(m);
  const cranes = m.STRUCTURES.filter((s) => s.type === 'crane');
  assert.equal(cranes.length, 2);
  const solid = w.boxes.filter((b) => b.tag === 'structure');
  for (const c of cranes) {
    const legs = c.parts.filter((p) => p.collide && p.min[1] - p.max[1] < -20);
    assert.equal(legs.length, 4, 'four legs');
    for (const l of legs) {
      // collider identical to the drawn leg, standing on the ground, clear of every roadway (trucks drive between)
      assert.ok(solid.some((b) => b.min.every((v, i) => Math.abs(v - l.min[i]) < 1e-9) && b.max.every((v, i) => Math.abs(v - l.max[i]) < 1e-9)), 'leg collider');
      const cx = (l.min[0] + l.max[0]) / 2, cz = (l.min[2] + l.max[2]) / 2;
      assert.ok(Math.abs(l.min[1] - 1.4 - m.groundHeight(cx, cz)) < 0.3, 'leg on its bogie on the ground');
      assert.ok(m.roadDistance(cx, cz) > 0.8, 'leg clear of the quay road');
      // a shot along the quay at chest height hits the leg
      const hit = w.raycast({ x: cx, y: m.groundHeight(cx, cz) + 1.6, z: cz + 1.5 }, { x: 0, y: 0, z: -1 }, 4);
      assert.ok(hit && hit.box?.tag === 'structure' && hit.t < 0.9, 'leg blocks bullets');
    }
    // the quay road between the waterside and landside rails
    const q = m.ROADS.find((r) => r.name === 'quay');
    assert.ok(Math.min(c.zw, c.zl) < q.az - q.w / 2 && Math.max(c.zw, c.zl) > q.az + q.w / 2, 'portal spans the quay road');
  }
  // no prop stands in a crane's footings
  for (const p of m.PROPS) {
    const f = propFootprint(p); if (!f) continue;
    for (const o of m.FOOTINGS) assert.ok(Math.abs(p.x - o.x) >= f.hx + o.hx || Math.abs(p.z - o.z) >= f.hz + o.hz, `${p.type} inside a crane / ship footing`);
  }
  const ship = m.STRUCTURES.find((s) => s.type === 'ship');
  assert.ok(ship.hull && ship.hull.keel < SEA_LEVEL && ship.hull.deck > SEA_LEVEL + 4 && ship.hull.zhi <= m.sea.at - 1, 'hull floats beyond the quay wall');
  assert.ok(ship.parts.some((p) => p.collide && p.max[1] > ship.hull.deck), 'deck cargo / superstructure collide');
});
