// The open world (world/maps/world.js): every map built as it is, the stretches between them laid onto their edges
// (no step where two meet), and the roads that join them fit to drive across the joins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBigWorld, heightIn } from '../src/world/BigWorldGen.js';
import { REGIONS, regionById, seamPairs } from '../src/world/maps/world.js';
import { spline } from '../src/world/WorldGen.js';
import { OpenWorld, BEACON_STRIDE } from '../src/world/OpenWorld.js';
import { RouteGraph } from '../src/game/Route.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec, TRUCKS } from '../src/physics/trucks.js';
import { homeOf, park } from '../src/world/homes.js';
import { followPath, densify } from './drive.mjs';
import { POOLS, CREEK } from '../src/world/maps/canyon.js';

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
    for (const [side, nid] of seamPairs(R)) {
      const d = done.get(R.id), h = d.half, [cx, cz] = R.at, N = regionById(nid), nh = done.get(nid).half;
      let worst = 0, n = 0;
      for (let t = -h + 1; t <= h - 1; t += 2) {
        const [x, z] = side === 'west' ? [cx - h, cz + t] : side === 'east' ? [cx + h, cz + t] : side === 'north' ? [cx + t, cz - h] : [cx + t, cz + h];
        // (along the part of the edge it shares with that neighbour: a neighbour may share only part of it)
        if (side === 'west' || side === 'east' ? Math.abs(z - N.at[1]) > nh - 1 : Math.abs(x - N.at[0]) > nh - 1) continue;
        worst = Math.max(worst, Math.abs(heightIn(d, x - cx, z - cz) - heightIn(done.get(nid), x - N.at[0], z - N.at[1])));
        n++;
      }
      assert.ok(n > 50, `${R.id} ${side} / ${nid}: they share ${n * 2} m of edge`);
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
  for (const e of ev.filter((q) => !q.world)) assert.equal(W.regionAt(e.start.x, e.start.z)?.id, e.region, e.id);
  // and the world's own, across the maps: Coast to Snow, from the coast to Ashwood
  const cs = ev.find((e) => e.id === 'coasttosnow');
  assert.ok(cs && W.regionAt(cs.start.x, cs.start.z).id === 'coast' && W.regionAt(...cs.line.at(-1)).id === 'ashwood');
  assert.ok(cs.length > 15000, `${(cs.length / 1000).toFixed(1)} km`);
  // a tree found from the world, struck and broken by its key there
  const R = W.byId.get('kerala'), T = R.world.trees;
  const t = W.treesNear(T.x[0] + R.cx, T.z[0] + R.cz, 2, []).find((o) => o.tree);
  assert.ok(t && Math.abs(t.x - (T.x[0] + R.cx)) < 3);
  assert.ok(W.breakKey('kerala:t0', 1, 0, 5, true));
  assert.ok(W.brokenKeys().includes('kerala:t0'));
});

test('the open world: each kind of car starts at a home suited to it, with a bay for each of the room at every home and station', async () => {
  const W = await opened;
  // the kinds apart: a sports car on the highway's tarmac, the U8 on the beach by the sea, the UAZ at the logging camp
  const at = (id) => { const h = homeOf(id); return [h, W.surfaceAt(h.x, h.z).name]; };
  assert.deepEqual([at('supra')[0].region, at('supra')[1]], ['korlai', 'road']);
  assert.deepEqual([at('u8')[0].name, at('u8')[1]], ['Kashid Beach', 'sand']);
  assert.equal(at('ranger')[0].name, 'Bearwood Timber Camp');
  assert.equal(at('wrangler')[0].region, 'canyon');
  assert.ok(new Set(Object.keys(TRUCKS).map((id) => homeOf(id).name)).size >= 10, 'ten homes or more');
  // every home and every station's yard (towed back, fast travel): six bays apart, each dry, level and clear
  const spots = Object.keys(TRUCKS).map(homeOf);
  for (const R of REGIONS) spots.push({ x: R.map.spawn.x + R.at[0], z: R.map.spawn.z + R.at[1], yaw: R.map.spawn.yaw, name: R.map.station.name });
  for (const h of spots) {
    const bays = [0, 1, 2, 3, 4, 5].map((n) => park(W, h, n));
    assert.equal(new Set(bays.map((b) => `${b.x},${b.z}`)).size, 6, `${h.name}: six bays`);
    for (const b of bays) {
      assert.ok(Math.hypot(b.x - h.x, b.z - h.z) < 30, `${h.name}: a bay near it`);
      assert.ok(W.water(b.x, b.z) < W.height(b.x, b.z) - 0.05 && !W.treesNear(b.x, b.z, 3.5, []).length, `${h.name}: a dry, clear bay`);
    }
  }
  // the others' trucks are left their bays
  const h = homeOf('thar'), first = park(W, h, 0), next = park(W, h, 0, [[first.x, first.z]]);
  assert.ok(Math.hypot(next.x - first.x, next.z - first.z) >= 5);
});

test('the open world: the far land meets every map\'s open edge (no step for it to hang in the air over)', async () => {
  const W = await opened;
  let open = 0;
  for (const r of W.regions) {
    let n = 0, worst = 0;
    for (const [nx, nz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      for (let t = -r.half; t <= r.half; t += 16) {
        const x = r.cx + (nx ? nx * r.half : t), z = r.cz + (nz ? nz * r.half : t);
        if (W.regionAt(x + nx * 1.5, z + nz * 1.5)) continue;       // (a seam: another map beyond)
        worst = Math.max(worst, Math.abs(r.world.terrain(x - nx * 0.01 - r.cx, z - nz * 0.01 - r.cz) - W.farHeight(x + nx * 0.02, z + nz * 0.02)));
        n++;
      }
    }
    // (a map with others all round it has none)
    if (n) open++;
    assert.ok(worst < 0.5, `${r.id}: the far land ${worst.toFixed(2)} m off its edge`);
  }
  assert.ok(open >= 8, `${open} maps on the world's edge`);
});

test('the open world: the land past a map is as wooded as the map beside it (Bearwood\'s taiga forested, Lalghati\'s red rock bare)', async () => {
  const W = await opened, at = (id, dx, dz) => { const r = W.byId.get(id); return W.farWoods(r.cx + dx * (r.half + 30), r.cz + dz * (r.half + 30)); };
  for (const r of W.regions) assert.ok(r.world.map.farWoods > 0 && r.world.map.farWoods <= 1, r.id);
  assert.ok(Math.abs(at('taiga', 0, -1) - W.byId.get('taiga').world.map.farWoods) < 0.05);
  assert.ok(Math.abs(at('canyon', 0, -1) - W.byId.get('canyon').world.map.farWoods) < 0.05);
  assert.ok(at('taiga', 0, -1) > at('canyon', 0, -1) + 0.3);
});

test('the open world: Bearwood\'s going, each its own ground (gravel road, mud pit, black pools, deep ford, boulders, shallows)', async () => {
  const W = await opened, T = W.byId.get('taiga'), w = T.world;
  const depth = (x, z) => Math.max(0, w.water(x, z) - w.height(x, z)), name = (x, z) => w.surfaceAt(x, z).name;
  const share = (cx, cz, r, f) => { let n = 0, k = 0; for (let x = cx - r; x <= cx + r; x += 2) for (let z = cz - r; z <= cz + r; z += 2) if (Math.hypot(x - cx, z - cz) <= r) { n++; if (f(x, z)) k++; } return k / n; };
  const line = (road) => densify(w.map.trails.find((t) => t.name === road).points, 2);
  // the logging road in: gravel all the way (bar a mud hole or two)
  const timber = line('Timber Road');
  assert.ok(timber.filter(([x, z]) => name(x, z) === 'gravel').length > 0.95 * timber.length, 'the Timber Road is gravel');
  // the mud pit by the camp: water over deep mud; the bog's low third under black pools
  assert.equal(name(60, 345), 'mud');
  assert.ok(depth(60, 345) > 0.2 && depth(60, 345) < 0.5, `the mud pit's water ${depth(60, 345).toFixed(2)} m`);
  const bog = share(-330, -330, 110, (x, z) => depth(x, z) > 0.05);
  assert.ok(bog > 0.2 && bog < 0.6, `the bog's pools: ${(bog * 100).toFixed(0)}% of it`);
  // the deep ford: over a stock air intake (0.95 m) on the ford's bed, but not swimming
  const deep = Math.max(...line('Deep Ford Track').map(([x, z]) => depth(x, z)));
  assert.ok(deep > 0.95 && deep < 1.25, `the deep ford ${deep.toFixed(2)} m`);
  // the boulder field on bare rock; the shallows ankle deep, the river elsewhere over a truck's wheels; the sand bar
  assert.ok(w.boulders.filter((b) => Math.hypot(b.x - 560, b.z + 380) < 45).length > 200, 'the boulder field');
  assert.ok(share(560, -380, 40, (x, z) => name(x, z) === 'rock') > 0.8, 'rock underfoot in the boulder field');
  assert.ok(depth(390, 45) > 0.1 && depth(390, 45) < 0.35 && depth(60, 130) > 1, `the shallows ${depth(390, 45).toFixed(2)} m, the river ${depth(60, 130).toFixed(2)} m`);
  assert.ok(share(400, 88, 25, (x, z) => name(x, z) === 'sand') > 0.8, 'the sand bar');
  // open country: stands of trees with wide ground between (under 35,000 of them), the tracks' verges cleared, and
  // open fields of mud on the tracks, pools in them
  assert.ok(w.trees.count < 35000, `${w.trees.count} trees`);
  const verge = line('Landing Road').filter((_, i) => i % 5 === 0);
  assert.ok(verge.every(([x, z]) => !w.treesNear(x, z, 14, []).some((o) => o.tree && o.r > 0.1)), 'no grown trees within 14 m of the Landing Road (saplings by the track only)');
  const fields = w.data.mudFields;
  assert.ok(fields.length >= 6, `${fields.length} mud fields`);
  for (const [x, z] of fields) assert.equal(name(x, z), 'mud');
});

test('the open world: Lalghati Canyon, a broad canyon in red rock (an open floor, ledged walls, Hidden Creek, the shelf road, the river on from the taiga)', async () => {
  const W = await opened, w = W.byId.get('canyon').world, tg = W.byId.get('taiga').world;
  const depth = (x, z) => Math.max(0, w.water(x, z) - w.height(x, z));
  // a hundred metres and more from the floor to the rim, across it in three places, the floor open: 250 m and more of
  // it within 8 m of its lowest (the river's bed)
  for (const x of [470, 150, -380]) {
    let lo = Infinity, hi = -Infinity;
    for (let z = -400; z <= 450; z += 2) { const h = w.height(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    let floor = 0;
    for (let z = -400; z <= 450; z += 2) if (w.height(x, z) < lo + 8) floor += 2;
    assert.ok(hi - lo > 95 && floor > 250, `across the canyon at x ${x}: ${lo.toFixed(0)} to ${hi.toFixed(0)} m, its floor ${floor} m across`);
  }
  // its walls in ledges: flats between steep faces, going up the south wall
  let ledges = 0, flat = false, steep = 0, prev = w.height(150, 160);
  for (let z = 162; z <= 280; z += 2) {
    const h = w.height(150, z), g = Math.abs(h - prev) / 2;
    prev = h;
    if (g > 0.9) { steep++; flat = false; } else if (g < 0.25 && !flat && steep) { ledges++; flat = true; }
  }
  assert.ok(ledges >= 2, `${ledges} ledges`);
  // Hidden Creek: the creek in its channel down the side canyon, the track up beside it dry; the pools at the heads of
  // the side canyons
  const creek = densify(CREEK.pts, 2).slice(10, -12).map(([x, z]) => depth(x, z)).sort((a, b) => a - b), mid = creek[creek.length >> 1];
  assert.ok(mid > 0.25 && mid < 0.9, `the creek ${mid.toFixed(2)} m deep in its channel`);
  const track = densify(w.map.trails.find((t) => t.name === 'Hidden Creek Track').points, 2).map(([x, z]) => depth(x, z));
  assert.ok(track.filter((d) => d > 0.1).length < track.length * 0.15, 'the track up beside the creek dry');
  for (const [x, z] of POOLS) assert.ok(depth(x, z) > 0.7, `the pool at ${x}, ${z}: ${depth(x, z).toFixed(2)} m`);
  // the shelf road: the wall above it on one side, the drop to the floor on the other
  const L = w.map.trails.find((t) => t.name === 'Ledge Road').points, i = L.length >> 1;
  const [ax, az] = L[i], dx = L[i + 1][0] - ax, dz = L[i + 1][1] - az, l = Math.hypot(dx, dz), h = w.height(ax, az);
  const a = w.height(ax - dz / l * 20, az + dx / l * 20) - h, b = w.height(ax + dz / l * 20, az - dx / l * 20) - h;
  assert.ok(Math.max(a, b) > 15 && Math.min(a, b) < -15, `the shelf: ${a.toFixed(0)} and ${b.toFixed(0)} m either side`);
  // the Bearwood carried on out of the taiga at its level
  assert.ok(Math.abs(tg.water(-1022, 300) - w.water(1022, 300)) < 0.3, `the river at the seam: ${tg.water(-1022, 300).toFixed(2)}, ${w.water(1022, 300).toFixed(2)}`);
  // red rock most of it, drifts of red sand, red mud on the floor
  let n = 0, rock = 0, sand = 0, mud = 0;
  for (let x = -1000; x <= 1000; x += 16) for (let z = -1000; z <= 1000; z += 16) { n++; const s = w.surfaceAt(x, z).name; rock += s === 'rock'; sand += s === 'sand'; mud += s === 'mud'; }
  assert.ok(rock / n > 0.3 && sand / n > 0.08 && mud / n > 0.04, `rock ${(rock / n * 100).toFixed(0)}%, sand ${(sand / n * 100).toFixed(0)}%, mud ${(mud / n * 100).toFixed(0)}%`);
});

test('the open world: the satnav finds the way from the coast to Ashwood by road, and a truck drives across the joins', async () => {
  const W = await opened, g = new RouteGraph(W.data.trails, { hubs: W.hubs });
  const r = g.route(3940, -712, 7090, -3800);
  assert.ok(r.length > 6000 && r.onTrail > r.length * 0.97, `${(r.length / 1000).toFixed(1)} km, ${(r.onTrail / 1000).toFixed(1)} km of it on roads and tracks`);
  // each join driven: on along the road over it, into the next map
  // (each leg from a point on the road to one on the road in the next map: off it, the way to it may run into the woods)
  for (const [a, b, into] of [[[3940, -712], [4264, -604], 'ghat'], [[5900, -668], [6300, -655], 'kerala'], [[7089, -1470], [7134, -1988], 'pass'], [[7072, -3568], [7090, -3850], 'ashwood']]) {
    const path = densify(g.route(...a, ...b).points);
    const v = new Vehicle(truckSpec('thar'));
    v.place(W, path[0][0], path[0][1], Math.atan2(path[4][0] - path[0][0], path[4][1] - path[0][1]));
    v.dt.setFourWD(true, 0);
    const run = followPath(v, W, path, { seconds: 240 });
    assert.ok(run.reached, `to ${into}: stuck at (${run.at.map(Math.round)})`);
    assert.equal(run.regions.at(-1), into);
  }
});
