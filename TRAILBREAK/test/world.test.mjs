// The open world (world/maps/world.js): every map built as it is, the stretches between them laid onto their edges
// (no step where two meet), and the roads that join them fit to drive across the joins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBigWorld, heightIn } from '../src/world/BigWorldGen.js';
import { REGIONS, regionById } from '../src/world/maps/world.js';
import { spline } from '../src/world/WorldGen.js';
import { OpenWorld, BEACON_STRIDE } from '../src/world/OpenWorld.js';
import { RouteGraph } from '../src/game/Route.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { followPath, densify } from './drive.mjs';

const built = generateBigWorld({ yieldEvery: 1e9 });

/** Ground height in the world: the region whose square holds the point (the first that does). */
const groundIn = (done) => (x, z) => {
  for (const R of REGIONS) {
    const d = done.get(R.id), lx = x - R.at[0], lz = z - R.at[1];
    if (Math.abs(lx) <= d.half && Math.abs(lz) <= d.half) return heightIn(d, lx, lz);
  }
  return NaN;
};

test('the open world: the stretches meet their neighbours edge to edge', async () => {
  const done = await built;
  for (const R of REGIONS.filter((r) => r.seams)) {
    for (const [side, nid] of Object.entries(R.seams)) {
      const d = done.get(R.id), h = d.half, [cx, cz] = R.at, N = regionById(nid);
      let worst = 0;
      for (let t = -h + 1; t <= h - 1; t += 2) {
        const [x, z] = side === 'west' ? [cx - h, cz + t] : side === 'east' ? [cx + h, cz + t] : side === 'north' ? [cx + t, cz - h] : [cx + t, cz + h];
        worst = Math.max(worst, Math.abs(heightIn(d, x - cx, z - cz) - heightIn(done.get(nid), x - N.at[0], z - N.at[1])));
      }
      // (on the grid lines they share none; between, a finer neighbour's own points stand a few cm off the line)
      assert.ok(worst < 0.1, `${R.id} ${side} / ${nid}: a step of ${worst.toFixed(2)} m`);
    }
  }
});

test('the open world: the roads between the maps are fit to drive, across the joins too', async () => {
  const done = await built, H = groundIn(done);
  // (the stretches' own roads and tracks, and the spurs the maps either side send out to meet them)
  const joins = [['coast', 'Kashid Ghat East'], ['kerala', 'Konkan Road'], ['kerala', 'Pass Road'], ['ashwood', 'Pass Road']];
  const roads = [...REGIONS.filter((r) => r.seams).flatMap((R) => R.map.trails.map((t) => [R.id, t.name])), ...joins];
  for (const [id, name] of roads) {
    const R = regionById(id), tr = R.map.trails.find((t) => t.name === name);
    const pts = spline(tr.points, 2).map(([x, z]) => [x + R.at[0], z + R.at[1]]);
    // steepest over 10 m, against the grade it was laid to (a little over it where it eases onto the road it joins)
    let worst = 0, at = null;
    for (let i = 5; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 5][0], pts[i][1] - pts[i - 5][1]), g = Math.abs(H(...pts[i]) - H(...pts[i - 5])) / l;
      if (g > worst) { worst = g; at = pts[i].map(Math.round); }
    }
    const grade = tr.grade ?? (tr.kind === 'road' ? 0.14 : 0.34);
    assert.ok(worst < grade + 0.08, `${id}: ${name} pitches ${(worst * 100).toFixed(0)}% at (${at}) (laid to ${grade * 100}%)`);
  }
});

test('the open world: the river out of Kerala runs on into the Konkan Ghat at its level', async () => {
  const done = await built, K = regionById('kerala'), G = regionById('ghat'), kd = done.get('kerala'), gd = done.get('ghat');
  const water = (d, R, x, z) => d.water[Math.round((z - R.at[1] - d.origin) / d.waterRes) * d.waterN + Math.round((x - R.at[0] - d.origin) / d.waterRes)];
  const x = K.at[0] - kd.half;
  let both = 0;
  for (let z = K.at[1] - kd.half; z <= K.at[1] + kd.half; z += 4) {
    const a = water(kd, K, x, z), b = water(gd, G, x, z);
    if (a < -1e8 || b < -1e8) continue;
    both++;
    assert.ok(Math.abs(a - b) < 0.15, `water ${a.toFixed(2)} | ${b.toFixed(2)} m at z ${z}`);
  }
  assert.ok(both >= 4, 'the river crosses the join');
});

/** The world at run time, every map in. */
const opened = built.then((done) => {
  const W = new OpenWorld();
  for (const R of REGIONS) W.add(R.id, done.get(R.id));
  return W;
});

test('the open world at run time: one ground, its places and events gathered from every map', async () => {
  const W = await opened;
  assert.ok(W.complete);
  // a seam is no edge; the world's own edges are
  const K = regionById('kerala'), G = regionById('ghat');
  assert.equal(W.regionAt(K.at[0] - 1023, K.at[1]).id, 'kerala');
  assert.equal(W.regionAt(G.at[0] + 1023, G.at[1]).id, 'ghat');
  assert.ok(W.inBounds(K.at[0] - 1024, K.at[1], 14), 'across the Kerala / Ghat seam');
  assert.ok(!W.inBounds(K.at[0] + 1020, K.at[1], 14), 'Kerala\'s east edge');
  assert.ok(Math.abs(W.terrain(K.at[0] - 1024.5, K.at[1] + 40) - W.terrain(K.at[0] - 1023.5, K.at[1] + 40)) < 0.3);
  // beacons: one id each, every map's
  const ids = W.beacons.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const R of REGIONS) assert.equal(W.beacons.filter((b) => Math.floor(b.id / BEACON_STRIDE) === REGIONS.indexOf(R)).length, R.map.beacons.length);
  // events: every map's, one id each, their starts on that map's ground
  const ev = W.events();
  assert.equal(new Set(ev.map((e) => e.id)).size, ev.length);
  for (const e of ev) assert.equal(W.regionAt(e.start.x, e.start.z)?.id, e.region, e.id);
  // a tree found from the world, struck and broken by its key there
  const R = W.byId.get('kerala'), T = R.world.trees;
  const t = W.treesNear(T.x[0] + R.cx, T.z[0] + R.cz, 2, []).find((o) => o.tree);
  assert.ok(t && Math.abs(t.x - (T.x[0] + R.cx)) < 3);
  assert.ok(W.breakKey('kerala:t0', 1, 0, 5, true));
  assert.ok(W.brokenKeys().includes('kerala:t0'));
});

test('the open world: the satnav finds the way from the coast to Ashwood by road, and a truck drives across the joins', async () => {
  const W = await opened, g = new RouteGraph(W.data.trails, { hubs: W.hubs });
  const r = g.route(3940, -712, 7090, -3800);
  assert.ok(r.length > 6000 && r.onTrail > r.length * 0.97, `${(r.length / 1000).toFixed(1)} km, ${(r.onTrail / 1000).toFixed(1)} km of it on roads and tracks`);
  // each join driven: on along the road over it, into the next map
  for (const [a, b, into] of [[[3940, -712], [4300, -650], 'ghat'], [[5900, -668], [6300, -655], 'kerala'], [[7089, -1470], [7100, -2000], 'pass'], [[7120, -3600], [7090, -3850], 'ashwood']]) {
    const path = densify(g.route(...a, ...b).points);
    const v = new Vehicle(truckSpec('thar'));
    v.place(W, path[0][0], path[0][1], Math.atan2(path[4][0] - path[0][0], path[4][1] - path[0][1]));
    v.dt.setFourWD(true, 0);
    const run = followPath(v, W, path, { seconds: 240 });
    assert.ok(run.reached, `to ${into}: stuck at (${run.at.map(Math.round)})`);
    assert.equal(run.regions.at(-1), into);
  }
});
