// The open world (world/maps/world.js): every map built as it is, the stretches between them laid onto their edges
// (no step where two meet), and the roads that join them fit to drive across the joins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBigWorld, heightIn } from '../src/world/BigWorldGen.js';
import { REGIONS, regionById, seamPairs, KUNDALIKA_ROCKS } from '../src/world/maps/world.js';
import { spline } from '../src/world/WorldGen.js';
import { OpenWorld, BEACON_STRIDE } from '../src/world/OpenWorld.js';
import { RouteGraph } from '../src/game/Route.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec, TRUCKS } from '../src/physics/trucks.js';
import { homeOf, park } from '../src/world/homes.js';
import { followPath, densify } from './drive.mjs';
import { POOLS, CREEK } from '../src/world/maps/canyon.js';
import { ledgeStrips } from '../src/world/Ledges.js';
import { alcoveRoof } from '../src/world/Alcoves.js';
import { GAUGE } from '../src/world/Worn.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { mapById } from '../src/world/maps/index.js';

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
  // the walls' beds in three dimensions: ledges along them, their lips out over the faces below, none near a track
  const strips = [];
  for (const [x0, z0] of [[512, 128], [320, 128], [-576, 640], [384, 384]]) strips.push(...ledgeStrips(w, x0, z0, 64, w.map.ledges));
  assert.ok(strips.length > 20, `${strips.length} ledges`);
  for (const s of strips) {
    assert.ok(s.jut > 0 && s.thick > 0 && s.pts.length >= 9);
    for (let j = 0; j < s.pts.length; j += 3) {
      const t = w.worn.nearest(s.pts[j], s.pts[j + 2]);
      assert.ok(!t, `a ledge on a track at ${s.pts[j].toFixed(0)}, ${s.pts[j + 2].toFixed(0)}`);
    }
  }
  // its shores: stones in the shallows and at the water's edge, and slabs of bedrock stepping down into the water
  const shore = w.boulders.filter((b) => Math.abs(w.water(b.x, b.z) - w.height(b.x, b.z)) < 0.7);
  assert.ok(shore.filter((b) => b.block === undefined && b.rx < 0.8).length > 600, 'stones at the water\'s edge');
  assert.ok(shore.filter((b) => b.block !== undefined).length > 40, 'slabs into the water');
  // its alcoves: a floor cut level into the foot of the wall, room for a truck under the roof over it and the ground
  // nowhere up through the roof; off the tracks, and a way in
  const alcoves = w.map.alcoves();
  assert.ok(alcoves.length >= 8, `${alcoves.length} alcoves`);
  for (const A of alcoves) {
    const at = (u, v) => [A.x + A.tx * u - A.nx * v, A.z + A.tz * u - A.nz * v], where = `the alcove at ${A.x.toFixed(0)}, ${A.z.toFixed(0)}`;
    assert.ok(Math.abs(w.height(...at(0, A.D * 0.4)) - A.base) < 0.4, `${where}: its floor`);
    for (let r = 0; r < 0.98; r += 0.07) for (let ph = 0.05; ph < Math.PI; ph += 0.15) {
      const [x, z] = at(A.W * r * Math.cos(ph), A.D * r * Math.sin(ph)), room = A.base + alcoveRoof(A, r) - w.height(x, z);
      assert.ok(room > -0.3, `${where}: the ground ${(-room).toFixed(2)} m up through its roof`);
      if (r < 0.6) assert.ok(room > 4.5, `${where}: ${room.toFixed(1)} m under its roof`);
    }
    assert.ok(!w.worn.nearest(A.x, A.z), `${where} on a track`);
    // (and a truck drives in under it off the canyon's floor)
    const path = densify([at(0, -24), at(0, -12), at(0, A.D * 0.55)]), v = new Vehicle(truckSpec('thar'));
    v.place(w, path[0][0], path[0][1], Math.atan2(path[4][0] - path[0][0], path[4][1] - path[0][1]));
    v.dt.setFourWD(true, 0);
    assert.ok(followPath(v, w, path, { seconds: 60, vmax: 8 }).reached, `${where}: no way in`);
  }
  // its hoodoos: columns of rock 8 m and more high
  const pillars = new Map();
  for (const b of w.boulders) if (b.pillar !== undefined) pillars.set(b.pillar, Math.max(pillars.get(b.pillar) ?? 0, b.y + b.ry - w.terrain(b.x, b.z)));
  assert.ok(pillars.size >= 6 && [...pillars.values()].every((h) => h > 8), `hoodoos: ${[...pillars.values()].map((h) => h.toFixed(0))}`);
  // the Bearwood carried on out of the taiga at its level
  assert.ok(Math.abs(tg.water(-1022, 300) - w.water(1022, 300)) < 0.3, `the river at the seam: ${tg.water(-1022, 300).toFixed(2)}, ${w.water(1022, 300).toFixed(2)}`);
  // red rock most of it, drifts of red sand, red mud on the floor
  let n = 0, rock = 0, sand = 0, mud = 0;
  for (let x = -1000; x <= 1000; x += 16) for (let z = -1000; z <= 1000; z += 16) { n++; const s = w.surfaceAt(x, z).name; rock += s === 'rock'; sand += s === 'sand'; mud += s === 'mud'; }
  assert.ok(rock / n > 0.3 && sand / n > 0.08 && mud / n > 0.04, `rock ${(rock / n * 100).toFixed(0)}%, sand ${(sand / n * 100).toFixed(0)}%, mud ${(mud / n * 100).toFixed(0)}%`);
});

test('the open world: its tracks worn into the ground, two ruts either side of a hump (none on the roads, nor on the maps on their own)', async () => {
  const W = await opened, A = W.byId.get('ashwood').world, G = A.worn;
  assert.ok(G, 'Ashwood\'s tracks are worn');
  // along each of Ashwood's tracks where it runs over earth: the ruts sunk below the hump between them, 5 to 40 cm
  let n = 0, rutted = 0;
  for (const tr of A.map.trails.filter((t) => t.kind === 'trail')) {
    for (const [x, z] of spline(tr.points, 10)) {
      const h = G.nearest(x, z);
      if (!h || A.surfaceId(x, z) !== 1 || A.wear(x, z) < 0.99) continue;      // (on earth: SURFACE.DIRT)
      const q = G.shape(h, x, z, 1), mx = x - h.ax * q.u, mz = z - h.az * q.u;
      const hump = A.terrain(mx, mz), ruts = (A.terrain(mx + h.ax * GAUGE, mz + h.az * GAUGE) + A.terrain(mx - h.ax * GAUGE, mz - h.az * GAUGE)) / 2;
      n++;
      if (hump - ruts > 0.05 && hump - ruts < 0.4) rutted++;
    }
  }
  assert.ok(n > 100 && rutted > 0.9 * n, `${rutted} of ${n} points on earth rutted`);
  // the coast's roads are not: only its tracks wear
  const C = W.byId.get('coast').world;
  assert.equal(C.worn.lines.length, C.map.trails.filter((t) => t.kind === 'trail').length);
  for (const tr of C.map.trails.filter((t) => t.kind === 'road').slice(0, 6)) {
    for (const [x, z] of spline(tr.points, 25)) if (!C.worn.nearest(x, z)) assert.equal(C.terrain(x, z), C.terrainBase(x, z));
  }
  // and a map on its own (Ashwood, Kerala as their own maps) is as it was
  assert.ok(!mapById('ashwood').wornTracks && !mapById('kerala').wornTracks);
});

test('the open world: the ruts across a tyre (rutsAcross, for the ruts\' walls) as deep as the worn track point by point, but in mud', async () => {
  const W = await opened, A = W.byId.get('ashwood'), G = A.world.worn, out = new Float64Array(9);
  let n = 0, worst = 0, sum = 0, deep = 0, mud = 0;
  for (const tr of A.world.map.trails.filter((t) => t.kind === 'trail')) {
    const pts = spline(tr.points, 6);
    for (let j = 1; j < pts.length; j++) {
      const [x, z] = pts[j], dx = x - pts[j - 1][0], dz = z - pts[j - 1][1], l = Math.hypot(dx, dz) || 1;
      // (across a tyre a little off the track's middle and heading a little off its way)
      const a = 0.2 * Math.sin(j), ax = (-dz * Math.cos(a) - dx * Math.sin(a)) / l, az = (dx * Math.cos(a) - dz * Math.sin(a)) / l;
      const cx = x + ax * 0.7 * Math.cos(j * 1.7), cz = z + az * 0.7 * Math.cos(j * 1.7);
      W.rutsAcross(cx + A.cx, cz + A.cz, ax, az, 4, 0.125, out);
      // (a worn track's old ruts in mud or a river bed: slumped, none)
      const s = A.world.surfaceId(cx, cz);
      if (s === SURFACE.MUD || s === SURFACE.RIVERBED) { mud++; assert.ok(out.every((d) => d === 0)); continue; }
      for (let k = -4; k <= 4; k++) {
        const e = G.depth(cx + ax * k * 0.125, cz + az * k * 0.125, A.world.wearAt), d = Math.abs(e - out[k + 4]);
        n++; sum += d; worst = Math.max(worst, d); deep = Math.max(deep, e);
      }
    }
  }
  assert.ok(n > 1000 && deep > 0.1 && mud > 0, `${n} points, ruts to ${deep.toFixed(3)} m (${mud} tyres in mud)`);
  assert.ok(worst < 0.03 && sum / n < 0.002, `worst ${(worst * 100).toFixed(1)} cm off, mean ${(sum / n * 1000).toFixed(2)} mm`);
});

test('the open world: its rocky hills in relief (ledges and joints in the rock itself, tors on the crests, talus below the faces)', async () => {
  const W = await opened;
  for (const id of ['ashwood', 'pass', 'taiga']) {
    const w = W.byId.get(id).world, h = w.half - 20;
    assert.ok(w.rockRelief > 0, `${id}'s rock is in relief`);
    // the rock stands out of the ground's line and sinks into it, as much one way as the other, by up to half a metre
    // or so on a face; off the rock (and off any track) the ground is the grid's
    let n = 0, sum = 0, sq = 0, worst = 0, off = 0;
    for (let z = -h; z < h; z += 5.3) for (let x = -h; x < h; x += 5.3) {
      const d = w.terrain(x, z) - w.terrainBase(x, z);
      if (w.rockWeight(x, z) === 1 && !w.worn.nearest(x, z)) { n++; sum += d; sq += d * d; worst = Math.max(worst, Math.abs(d)); }
      else if (w.rockWeight(x, z) === 0 && !w.worn.nearest(x, z) && Math.abs(d) > 1e-9) off++;
    }
    const mean = sum / n, sd = Math.sqrt(sq / n - mean * mean);
    assert.ok(n > 200 && Math.abs(mean) < 0.15 && sd > 0.08 && worst < 2.5, `${id}: ${n} points of rock, relief ${mean.toFixed(2)} ± ${sd.toFixed(2)} m, at most ${worst.toFixed(2)}`);
    assert.equal(off, 0, `${id}: the ground off the rock as it was`);
    // its tors: stacks of blocks, standing a metre and more over bare rock on a crest
    const tors = w.data.tors;
    assert.ok(tors.length >= 2, `${id}: ${tors.length} tors`);
    for (const [tx, tz, tr] of tors) {
      const blocks = w.boulders.filter((b) => b.block !== undefined && Math.hypot(b.x - tx, b.z - tz) < tr);
      assert.ok(blocks.length >= 3, `${id}: a tor of ${blocks.length} blocks`);
      assert.ok(blocks.some((b) => b.y + b.ry * 0.6 > w.terrain(b.x, b.z) + 1), `${id}: the tor at ${tx.toFixed(0)}, ${tz.toFixed(0)} stands up`);
      const bare = [0, 1, 2, 3, 4, 5, 6, 7].filter((a) => w.surfaceId(tx + Math.cos(a * Math.PI / 4) * tr * 0.5, tz + Math.sin(a * Math.PI / 4) * tr * 0.5) === 3).length;
      assert.ok(bare >= 6, `${id}: the tor's rock bare round it (${bare} of 8)`);
    }
  }
  // the maps on their own are as they were
  assert.ok(!mapById('ashwood').rockRelief && !mapById('kerala').rockRelief);
  // and every map's tors are listed in the world, to fast travel to (ui/WorldMap.js)
  const T = W.tors();
  assert.ok(T.length >= 10 && T.every((q) => W.regionAt(q.x, q.z)?.id === q.region && q.mapName), `${T.length} tors listed`);
});

test('the open world: deep bogs by Kashid and the rocks at the Kundalika ford, to go off-road on', async () => {
  const W = await opened, coast = W.byId.get('coast'), c = coast.world, st = regionById('coast').map.station;
  // two deep bogs, the nearer within a few minutes' drive of the station: in their hearts as soft as the map says, at
  // their edges the field's own mud, and none of it on an event's course
  const bogs = c.data.deepBogs;
  assert.equal(bogs.length, 2);
  for (const [x, z, r, k] of bogs) {
    assert.ok(Math.hypot(x - st.x, z - st.z) < 400, `a bog ${Math.hypot(x - st.x, z - st.z).toFixed(0)} m from Kashid`);
    let heart = 0;
    for (let a = 0; a < 8; a++) heart = Math.max(heart, c.softness(x + Math.cos(a) * r * 0.3, z + Math.sin(a) * r * 0.3));
    assert.ok(heart > k * 0.9 && heart <= k + 1e-9, `the bog at ${x.toFixed(0)}, ${z.toFixed(0)}: ${heart.toFixed(2)} times as soft as mud in its heart (${k})`);
    assert.ok(c.deepAt(x + r * 1.15, z) === 1, 'its own mud at its edge');
    for (const e of W.events().filter((q) => q.line)) {
      for (const [ex, ez] of densify(e.line, 2)) {
        if (Math.hypot(ex - x - coast.cx, ez - z - coast.cz) < r * 1.3) assert.ok(W.softness(ex, ez) < 1.01, `${e.id} runs through a bog at ${ex.toFixed(0)}, ${ez.toFixed(0)}`);
      }
    }
  }
  // the ford: the Kundalika South track across the river knee deep, bare rock on its banks, boulders in the shallows
  // and up the banks, and on the track's line only stones a truck can crawl over
  const g = W.byId.get('ghat'), gw = g.world, K = KUNDALIKA_ROCKS, sp = regionById('ghat').map.trails.find((t) => t.name === 'Kundalika South');
  let deepest = 0, wet = 0;
  for (const [x, z] of spline(sp.points, 1)) {
    const wl = gw.water(x, z);
    if (wl > -1e8) { wet++; deepest = Math.max(deepest, wl - gw.terrain(x, z)); }
  }
  assert.ok(wet > 30 && deepest > 0.35 && deepest < 0.75, `the ford ${wet} m across, ${deepest.toFixed(2)} m at its deepest`);
  let rock = 0, n = 0;
  for (let a = 0; a < 64; a++) {
    for (const f of [0.3, 0.5, 0.7]) {
      const x = K.x + Math.cos(a / 64 * Math.PI * 2) * K.r * f, z = K.z + Math.sin(a / 64 * Math.PI * 2) * K.r * f, wl = gw.water(x, z), h = gw.terrain(x, z);
      if (wl > -1e8 || h > (gw.water(K.x, K.z) + 3)) continue;
      n++; if (gw.surfaceId(x, z) === SURFACE.ROCK) rock++;
    }
  }
  assert.ok(n > 20 && rock > n * 0.3, `${rock} of ${n} points on the banks by the water bare rock`);
  const near = gw.boulders.filter((b) => Math.hypot(b.x - K.x, b.z - K.z) < K.r);
  assert.ok(near.length > 600 && near.some((b) => b.block !== undefined) && near.some((b) => b.rx > 1.5), `${near.length} rocks round the ford`);
  for (const b of near) {
    const [x, z] = spline(sp.points, 1).reduce((m, q) => (Math.hypot(q[0] - b.x, q[1] - b.z) < Math.hypot(m[0] - b.x, m[1] - b.z) ? q : m));
    if (Math.hypot(x - b.x, z - b.z) < 1.5) assert.ok(b.y + b.ry - gw.terrain(b.x, b.z) < 0.32, `a stone on the line stands ${(b.y + b.ry - gw.terrain(b.x, b.z)).toFixed(2)} m`);
  }
  // a stock Thar crawls across, and through the deeper bog keeping going
  const v = new Vehicle(truckSpec('thar'));
  const across = densify(spline(sp.points, 2).filter(([, z]) => z > 878 && z < 990).map(([x, z]) => [x + g.cx, z + g.cz]), 2);
  v.place(W, ...across[0], Math.atan2(across[3][0] - across[0][0], across[3][1] - across[0][1]));
  v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  const f = followPath(v, W, across, { vmax: 3, seconds: 120 });
  assert.ok(f.reached && !v.flooded, `the Thar across the ford: ${f.reached ? 'over' : 'stuck'} in ${f.t.toFixed(0)} s`);
  const [bx, bz, br] = bogs[0], bog = densify([[bx + br * 1.2, bz - 7], [bx, bz - 7], [bx - br * 1.2, bz - 7]].map(([x, z]) => [x + coast.cx, z + coast.cz]), 2);
  const u = new Vehicle(truckSpec('thar'));
  u.place(W, ...bog[0], -Math.PI / 2);
  u.dt.setFourWD(true, 0);
  const b = followPath(u, W, bog, { vmax: 4, seconds: 120 });
  let rut = 0;
  for (let x = bx - br * 0.5; x < bx + br * 0.5; x += 0.5) for (let dz = -2; dz <= 2; dz += 0.25) rut = Math.max(rut, W.terrain(x + coast.cx, bz - 7 + dz + coast.cz) - W.height(x + coast.cx, bz - 7 + dz + coast.cz));
  assert.ok(b.reached && rut > 0.15, `the Thar through ${regionById('coast').map.deepBogs[0].name}: ${b.reached ? 'out' : 'stuck'} in ${b.t.toFixed(0)} s, its ruts ${rut.toFixed(2)} m deep`);
  // recovery boards laid in it (game/Boards.js): over one, the ground is the board's, firm and gripping; taken up, mud
  {
    const x0 = bx + coast.cx, z0 = bz + 4 + coast.cz, h0 = W.height(x0, z0), b = { x0, z0, dx: 1, dz: 0, y0: h0 - 0.2, y1: h0 + 0.1, x: x0 + 0.575, z: z0, yaw: Math.PI / 2 };
    W.setBoards([b]);
    assert.ok(Math.abs(W.height(x0 + 0.5, z0) - (h0 - 0.2 + 0.3 * 0.5 / 1.15 + 0.035)) < 1e-6 && W.surfaceAt(x0 + 0.5, z0).id === SURFACE.ROAD, 'on a board');
    assert.equal(W.surfaceAt(x0 + 0.5, z0 + 1).id, SURFACE.MUD, 'beside it');
    W.setBoards([]);
    assert.equal(W.surfaceAt(x0 + 0.5, z0).id, SURFACE.MUD, 'taken up');
  }
  // both listed to go to (ui/WorldMap.js), the rocks whether the ghat is in yet or not
  const O = W.offroad();
  assert.deepEqual(O.map((q) => q.type).sort(), ['bog', 'bog', 'rocks']);
  assert.ok(O.every((q) => W.regionDefAt(q.x, q.z)?.id === q.region && q.from), 'each where it says, and where to come to it from');
});

test('the open world: no building\'s yard cuts a step into a track (a house\'s yard below the Anapara Track did)', async () => {
  const W = await opened, pads = { station: 11, garage: 8, mine: 10, firetower: 7, lookout: 7, cabin: 7, turbine: 7 };
  let looked = 0;
  for (const r of W.regions) {
    const P = { ...pads, ...(r.map.pads || {}) };
    for (const tr of r.map.trails.filter((q) => q.kind === 'trail')) {
      const pts = spline(tr.points, 1), gmax = tr.grade ?? 0.34;
      for (const L of r.world.landmarks.filter((q) => P[q.type])) {
        for (let k = 2; k < pts.length; k++) {
          const [x, z] = pts[k];
          if (Math.hypot(x - L.x, z - L.z) > P[L.type] + 6) continue;
          looked++;
          const g = Math.abs(r.world.terrainBase(x, z) - r.world.terrainBase(...pts[k - 2])) / Math.hypot(x - pts[k - 2][0], z - pts[k - 2][1]);
          assert.ok(g < gmax + 0.12, `${r.id}: ${tr.name} pitches ${(g * 100).toFixed(0)}% by the ${L.type} at ${L.x.toFixed(0)}, ${L.z.toFixed(0)}`);
        }
      }
    }
  }
  assert.ok(looked > 50, `${looked} points of track by a building`);
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

test('a rough track (an old logging trail): ruts deeper, holes in one rut then the other, roots across it on firm ground; in mud no roots', async () => {
  const { WornTracks, wearOf } = await import('../src/world/Worn.js');
  const map = (rough) => ({ trails: [{ name: 't', kind: 'trail', rough, points: [[0, -40], [0, 200], [0, 440]] }] });
  const G = new WornTracks(map(1), 1000), P = new WornTracks(map(0), 1000);
  const firm = () => wearOf(SURFACE.DIRT), mud = () => wearOf(SURFACE.MUD);
  let rutR = 0, rutP = 0, top = 0, topMud = 0, left = 0, right = 0;
  for (let z = 0; z < 360; z += 0.05) {
    const h = G.nearest(0, z), q = G.shape(h, 0, z, 1);
    rutR = Math.max(rutR, q.depth); rutP = Math.max(rutP, P.shape(P.nearest(0, z), 0, z, 1).depth);
    top = Math.max(top, -G.depth(0, z, firm)); topMud = Math.max(topMud, -G.depth(0, z, mud));
    // (the holes, deeper than any rut: in the left rut, in the right)
    if (G.depth(-0.85, z, firm) > 0.32) left++;
    if (G.depth(0.85, z, firm) > 0.32) right++;
  }
  assert.ok(rutR > 0.2 && rutR < 0.3 && rutP < 0.16, `ruts ${rutR.toFixed(2)} m deep, ${rutP.toFixed(2)} m on an ordinary track`);
  assert.ok(left > 40 && right > 40, `holes in both ruts: ${left}, ${right} samples`);
  // (in mud only the spoil beside the ruts stands a centimetre or so proud)
  assert.ok(top > 0.06 && topMud < 0.02, `roots ${top.toFixed(2)} m proud on firm ground, ${topMud.toFixed(2)} m in mud`);
});

test("a rough track's holes hold the rain, most of them, below their rims; none on its verges, none on an ordinary track", async () => {
  const { WornTracks, wearOf } = await import('../src/world/Worn.js');
  const map = (rough) => ({ trails: [{ name: 't', kind: 'trail', rough, points: [[0, -40], [0, 200], [0, 440]] }] });
  const G = new WornTracks(map(1), 1000), P = new WornTracks(map(0), 1000), firm = () => wearOf(SURFACE.DIRT);
  let deep = 0, wet = 0, brim = 0, verge = 0, plain = 0;
  for (let z = 0; z < 360; z += 0.1) {
    for (const x of [-0.85, 0.85]) {
      const d = G.depth(x, z, firm), w = G.holeWater(x, z, firm), pot = G.shape(G.nearest(x, z), x, z, 1).pot;
      if (pot > 0.2) { deep++; if (w > 0.05) wet++; }
      // (the water's surface a hand below the ground round the hole: the rut's floor beside it, at most)
      if (w > 0) brim = Math.max(brim, w - (d - 0.1));
      plain = Math.max(plain, P.holeWater(x, z, firm));
    }
    verge = Math.max(verge, G.holeWater(2.6, z, firm), G.holeWater(-2.6, z, firm));
  }
  assert.ok(deep > 100 && wet > deep * 0.6 && wet < deep, `${wet} of ${deep} samples down in a hole stand in water`);
  assert.ok(brim < 1e-9 && verge === 0 && plain === 0, `the water ${brim.toFixed(3)} m over its brim; on the verges ${verge}, an ordinary track ${plain}`);
});

test("washboard: ripples 0.72 m apart across a dry track's earth, gravel and sand in patches, about a centimetre high; none on grass, in mud or on a rough track", async () => {
  const { WornTracks, wearOf, rippleOf, RIPPLE, RIPPLE_H } = await import('../src/world/Worn.js');
  const map = (rough) => ({ trails: [{ name: 't', kind: 'trail', rough, points: [[0, -40], [0, 600], [0, 1240]] }] });
  const G = new WornTracks(map(0), 3000), R = new WornTracks(map(1), 3000), wear = () => wearOf(SURFACE.DIRT);
  const on = (s) => () => rippleOf(s);
  let n = 0, rippled = 0, max = 0, grass = 0, mud = 0, rough = 0, prev = 0, prevZ = 0, gravel = 0;
  const gaps = [];
  for (let z = 20; z < 1100; z += 0.02) {
    const d = G.depth(0, z, wear, on(SURFACE.DIRT)) - G.depth(0, z, wear);
    n++; if (Math.abs(d) > 0.003) rippled++;
    max = Math.max(max, Math.abs(d));
    if (Math.abs(d) > 1e-4) {
      if (prev && Math.sign(d) !== Math.sign(prev)) { if (z - prevZ < 1) gaps.push(z - prevZ); prevZ = z; }
      prev = d;
    }
    gravel = Math.max(gravel, Math.abs(G.depth(0, z, wear, on(SURFACE.GRAVEL)) - G.depth(0, z, wear)));
    grass = Math.max(grass, Math.abs(G.depth(0, z, wear, on(SURFACE.GRASS)) - G.depth(0, z, wear)));
    mud = Math.max(mud, Math.abs(G.depth(0, z, wear, on(SURFACE.MUD)) - G.depth(0, z, wear)));
    rough = Math.max(rough, Math.abs(R.depth(0, z, wear, on(SURFACE.DIRT)) - R.depth(0, z, wear)));
  }
  assert.ok(rippled > n * 0.25 && rippled < n * 0.65, `rippled along ${(rippled / n * 100).toFixed(0)}% of it`);
  assert.ok(max > RIPPLE_H * 0.8 && max <= RIPPLE_H * 1.25 && gravel > RIPPLE_H * 0.8, `${(max * 100).toFixed(2)} cm high at most (gravel ${(gravel * 100).toFixed(2)})`);
  // (the ground crossing its mean half a ripple apart)
  gaps.sort((a, b) => a - b);
  const spacing = gaps[gaps.length >> 1];
  assert.ok(Math.abs(spacing - RIPPLE / 2) < 0.04, `crossings every ${spacing.toFixed(2)} m`);
  assert.ok(grass === 0 && mud === 0 && rough === 0, `on grass ${grass}, in mud ${mud}, on a rough track ${rough}`);
});

test("after rain a worn track's ruts hold it along about half their length, deeper the fuller; none on the hump or the verges, none dry", async () => {
  const { WornTracks, wearOf, RUT } = await import('../src/world/Worn.js');
  const G = new WornTracks({ trails: [{ name: 't', kind: 'trail', points: [[0, -40], [0, 200], [0, 440]] }] }, 1000), firm = () => wearOf(SURFACE.DIRT);
  let n = 0, wet = 0, deep = 0, half = 0, edge = 0, dry = 0, over = 0;
  for (let z = 0; z < 360; z += 0.1) {
    // (in the middle of a rut, where the track has wandered: u, m off the wheel line's middle, at x = 0, and which way x
    // runs across the track)
    const u0 = G.shape(G.nearest(0, z), 0, z, 1).u, sx = Math.sign(G.nearest(1, z).u - G.nearest(0, z).u), at = (u) => sx * (u - u0);
    const x = at(GAUGE);
    const w = G.rainWater(x, z, firm, 1);
    n++;
    if (w > 0.005) { wet++; deep = Math.max(deep, w); }
    // (no fuller than the rut is deep; half as full, shallower: but for a pothole under the rut's floor, which the rain
    // fills first)
    over = Math.max(over, w - G.depth(x, z, firm));
    if (w > 0.005 && G.shape(G.nearest(x, z), x, z, 1).pot <= 0) half = Math.max(half, G.rainWater(x, z, firm, 0.5) / w);
    edge = Math.max(edge, G.rainWater(at(GAUGE + RUT + 0.05), z, firm, 1), G.rainWater(at(0), z, firm, 1), G.rainWater(at(2.4), z, firm, 1));
    dry = Math.max(dry, G.rainWater(x, z, firm, 0));
  }
  assert.ok(wet > n * 0.3 && wet < n * 0.75, `water in ${wet} of ${n} samples along the rut`);
  assert.ok(deep > 0.03 && deep < 0.15 && over < 1e-9, `the water ${(deep * 100).toFixed(1)} cm deep at most, never over the rut's brim`);
  assert.ok(half < 0.8, `half as full, at most ${(half * 100).toFixed(0)}% as deep`);
  assert.ok(edge === 0 && dry === 0, `beside the rut ${edge}, dry ${dry}`);
});
