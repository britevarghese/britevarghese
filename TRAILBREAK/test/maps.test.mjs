// The maps: the registry, the Kerala Ghats (drivable trails, its courses, beacons a truck can reach), and Ashwood
// generated exactly as before (a second map must not move a stone of the first).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, MAP_IDS, DEFAULT_MAP, MAP_HALF, mapById } from '../src/world/maps/index.js';
import { generateWorld, spline } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';
import { eventsFor, gridFor, EventRun } from '../src/game/Events.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACE } from '../src/physics/Surfaces.js';

/** Steepest pitch (degrees, over 8 m) and tightest bend (m) of a trail. */
function trailShape(world, p) {
  let maxG = 0, minR = Infinity;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i], [cx, cz] = p[i + 1];
    const a = Math.hypot(bx - ax, bz - az), b = Math.hypot(cx - bx, cz - bz), c = Math.hypot(cx - ax, cz - az);
    const area = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / 2;
    if (area > 1e-6) minR = Math.min(minR, (a * b * c) / (4 * area));
    const dx = (cx - ax) / (a + b), dz = (cz - az) / (a + b);
    const g = Math.abs(world.terrain(bx + dx * 4, bz + dz * 4) - world.terrain(bx - dx * 4, bz - dz * 4)) / 8;
    maxG = Math.max(maxG, Math.atan(g) * 180 / Math.PI);
  }
  return { maxG, minR };
}
/** Where two trails cross other than at an end of either (each graded on its own: a cliff between their beds). */
function crossings(trails) {
  const X = (a, b, c, e) => {
    const d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = e[0] - c[0], d2z = e[1] - c[1], den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c[0] - a[0]) * d2z - (c[1] - a[1]) * d2x) / den, u = ((c[0] - a[0]) * d1z - (c[1] - a[1]) * d1x) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + d1x * t, a[1] + d1z * t] : null;
  };
  const nearEnd = (P, [x, z]) => Math.min(Math.hypot(x - P[0][0], z - P[0][1]), Math.hypot(x - P.at(-1)[0], z - P.at(-1)[1])) < 8;
  const out = [];
  for (let i = 0; i < trails.length; i++) for (let j = i + 1; j < trails.length; j++) {
    const A = trails[i].points, B = trails[j].points;
    for (let p = 1; p < A.length; p++) for (let q = 1; q < B.length; q++) {
      const c = X(A[p - 1], A[p], B[q - 1], B[q]);
      if (c && !nearEnd(A, c) && !nearEnd(B, c)) out.push(`${trails[i].name} x ${trails[j].name} at ${c.map(Math.round)}`);
    }
  }
  return out;
}
/** How deep the water is at a point (0 on dry ground). */
const depth = (world, x, z) => Math.max(0, world.water(x, z) - world.terrain(x, z));

test('the maps: every one complete, unknown ids fall back to Ashwood', () => {
  assert.deepEqual(MAP_IDS, ['ashwood', 'kerala', 'coast']);
  assert.equal(DEFAULT_MAP, 'ashwood');
  assert.equal(mapById('nowhere').id, 'ashwood');
  assert.equal(mapById(undefined).id, 'ashwood');
  for (const id of MAP_IDS) {
    const M = MAPS[id];
    assert.equal(M.id, id);
    for (const k of ['name', 'short', 'blurb', 'tagline', 'dealer', 'ground', 'trees']) assert.equal(typeof M[k], 'string', `${id}.${k}`);
    for (const k of ['seed', 'station', 'spawn', 'river', 'trails', 'beacons', 'landmarks', 'events']) assert.ok(M[k] !== undefined, `${id}.${k}`);
    assert.deepEqual(M.beacons.map((b) => b.id), M.beacons.map((_, i) => i), `${id}: beacon ids in order`);
    assert.equal(new Set(M.events.map((e) => e.id)).size, M.events.length, `${id}: event ids unique`);
    for (const e of M.events) assert.ok(e.par.gold < e.par.silver && e.par.silver < e.par.bronze, `${id}/${e.id}: par times in order`);
    // trails meet at their ends, never cross part way
    assert.deepEqual(crossings(M.trails.map((t) => ({ name: t.name, points: spline(t.points, 6) }))), [], `${id}: trails crossing`);
  }
});

test('Kerala: the trails a stock truck can drive, the courses, the beacons all reachable, the buildings on dry ground', async () => {
  const data = await generateWorld({ map: 'kerala' });
  const world = new World(data);
  assert.equal(world.map.id, 'kerala');
  // every trail: no pitch over 27 degrees, no bend tighter than 9 m
  for (const tr of data.trails) {
    const { maxG, minR } = trailShape(world, tr.points);
    assert.ok(maxG < 27, `${tr.name}: a ${maxG.toFixed(1)} degree pitch`);
    assert.ok(minR > 9, `${tr.name}: a ${minR.toFixed(1)} m bend`);
  }
  // the courses: gates on the ground, a grid of four, none in more than a splash of water
  const events = eventsFor(world);
  assert.deepEqual(events.map((e) => e.id), ['teaclimb', 'paddydash', 'rocktrials', 'riverrun']);
  for (const e of events) {
    assert.ok(e.gates.length >= 2 && e.gates.every((g) => Number.isFinite(g.y)), `${e.id}: gates on the ground`);
    const grid = gridFor(world, e);
    assert.equal(grid.length, 4);
    for (const s of grid) assert.ok(depth(world, s.x, s.z) < 0.3, `${e.id}: a grid slot in ${depth(world, s.x, s.z).toFixed(2)} m of water`);
  }
  // the hill climb goes up through the tea to the top; the paddy dash crosses flooded fields
  const climb = events.find((e) => e.id === 'teaclimb');
  assert.ok(climb.gates.at(-1).y - world.terrain(climb.start.x, climb.start.z) > 60, 'the hill climb climbs');
  const dash = events.find((e) => e.id === 'paddydash');
  let wet = 0;
  for (let t = 0; t <= 1; t += 0.01) {
    const x = dash.start.x + (dash.gates.at(-1).x - dash.start.x) * t, z = dash.start.z + (dash.gates.at(-1).z - dash.start.z) * t;
    if (depth(world, x, z) > 0.05 && world.surfaceId(x, z) === SURFACE.MUD) wet++;
  }
  assert.ok(wet > 30, `the paddy dash: ${wet}% of it through flooded mud`);
  // each beacon on dry ground in the map, near a trail
  const pts = data.trails.flatMap((t) => t.points);
  for (const b of data.beacons) {
    assert.ok(Math.abs(b.x) < MAP_HALF - 20 && Math.abs(b.z) < MAP_HALF - 20, `${b.name}: inside the map`);
    assert.ok(depth(world, b.x, b.z) < 0.25, `${b.name}: in water`);
    const near = Math.min(...pts.map(([x, z]) => Math.hypot(x - b.x, z - b.z)));
    assert.ok(near < 40, `${b.name}: ${near.toFixed(0)} m from the nearest trail`);
  }
  // a stock ranger, flat out, gets down the river run inside the bronze par (and the water doesn't stop it)
  const river = events.find((e) => e.id === 'riverrun');
  const v = new Vehicle(truckSpec('ranger'));
  v.place(world, river.start.x, river.start.z, river.start.yaw);
  v.dt.setFourWD(true, 0);
  const run = new EventRun(river, 0);
  let t = 0;
  while (t < 30 && run.phase !== 'finished') {
    const g = river.gates[Math.min(run.gate, river.gates.length - 1)];
    let diff = Math.atan2(g.x - v.pos.x, g.z - v.pos.z) - Math.atan2(v.fwd.x, v.fwd.z);
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    v.step({ throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, -diff * 2)), handbrake: 0 }, world);
    t += 1 / 480;
    run.update(t, v.pos, 0);
  }
  assert.equal(run.phase, 'finished');
  assert.ok(run.time < river.par.bronze, `the river run in ${run.time.toFixed(1)} s`);
  assert.ok(!v.damage.any, 'the river run breaks nothing');
  for (const L of data.landmarks) assert.equal(depth(world, L.x, L.z), 0, `${L.type} at ${L.x},${L.z}: in water`);
  // the truck starts at the station, on dry level ground
  const s = world.map.spawn;
  assert.equal(depth(world, s.x, s.z), 0);
  assert.ok(Math.hypot(s.x - world.map.station.x, s.z - world.map.station.z) < 40);
  // the ground of a tropical map: tea and paddy, laterite and granite, no snow and no ice
  const seen = new Set();
  for (let z = -1000; z <= 1000; z += 8) for (let x = -1000; x <= 1000; x += 8) seen.add(world.surfaceId(x, z));
  for (const s of [SURFACE.TEA, SURFACE.MUD, SURFACE.DIRT, SURFACE.ROCK, SURFACE.ROAD, SURFACE.GRASS]) assert.ok(seen.has(s), `surface ${s} somewhere`);
  assert.ok(!seen.has(SURFACE.SNOW) && !seen.has(SURFACE.ICE), 'no snow in Kerala');
});

test('the Konkan Coast: tarmac fit for speed, the sea to the west, every place reachable, the town on dry ground', async () => {
  const data = await generateWorld({ map: 'coast' });
  const world = new World(data);
  assert.equal(world.map.id, 'coast');
  const shape = Object.fromEntries(data.trails.map((t) => [t.name, trailShape(world, t.points)]));
  // the ring and the runway: level and sweeping; the ghat road steep and tight, but within a stock truck
  assert.ok(shape['Coast Highway'].maxG < 4, `the ring's steepest pitch ${shape['Coast Highway'].maxG.toFixed(1)} degrees`);
  assert.ok(shape['Coast Highway'].minR > 90, `the ring's tightest bend ${shape['Coast Highway'].minR.toFixed(0)} m`);
  assert.ok(shape.Runway.maxG < 1, 'the runway is level');
  for (const [name, s] of Object.entries(shape)) {
    assert.ok(s.maxG < 15, `${name}: a ${s.maxG.toFixed(1)} degree pitch`);
    assert.ok(s.minR > 15, `${name}: a ${s.minR.toFixed(1)} m bend`);
  }
  // every road paved, and the lines on it known (lanes and width for the markings)
  for (const t of data.trails) {
    assert.equal(world.surfaceId(t.points[t.points.length >> 1][0], t.points[t.points.length >> 1][1]), SURFACE.ROAD, `${t.name} paved`);
    assert.ok(t.lanes !== undefined && t.width > 0, `${t.name}: its lanes`);
  }
  // the sea along the west, the beach between it and the land
  assert.ok(depth(world, -950, 0) > 3, 'deep water offshore');
  assert.equal(world.surfaceId(-690, 0), SURFACE.SAND);
  // each beacon on dry ground near a road; every building dry; the start by the station, on the main street
  const pts = data.trails.flatMap((t) => t.points);
  for (const b of data.beacons) {
    assert.ok(depth(world, b.x, b.z) < 0.25, `${b.name}: in water`);
    const near = Math.min(...pts.map(([x, z]) => Math.hypot(x - b.x, z - b.z)));
    assert.ok(near < 40, `${b.name}: ${near.toFixed(0)} m from the nearest road`);
  }
  for (const L of data.landmarks) assert.equal(depth(world, L.x, L.z), 0, `${L.type} at ${L.x},${L.z}: in water`);
  const s = world.map.spawn;
  assert.equal(depth(world, s.x, s.z), 0);
  assert.ok(Math.hypot(s.x - world.map.station.x, s.z - world.map.station.z) < 40);
  // no tree on the tarmac
  for (let i = 0; i < data.trees.count; i++) assert.notEqual(world.surfaceId(data.trees.x[i], data.trees.z[i]), SURFACE.ROAD, `a tree on the road at ${data.trees.x[i]},${data.trees.z[i]}`);
  // the events: on the ground, a grid of four; a stock Thar flat out down the runway inside the bronze par
  const events = eventsFor(world);
  assert.deepEqual(events.map((e) => e.id), ['runwaydrag', 'ghatclimb', 'beachdash']);
  for (const e of events) {
    assert.ok(e.gates.length >= 2 && e.gates.every((g) => Number.isFinite(g.y)), `${e.id}: gates on the ground`);
    assert.equal(gridFor(world, e).length, 4);
  }
  // the hill climb finishes at the top of the pass (not over it and down the far side)
  const climb = events[1], top = climb.gates.at(-1);
  assert.ok(climb.line.every(([x, z]) => world.terrain(x, z) <= world.terrain(top.x, top.z) + 0.5), 'the climb ends at the top');
  const drag = events[0], v = new Vehicle(truckSpec('thar'));
  v.place(world, drag.start.x, drag.start.z, drag.start.yaw);
  const run = new EventRun(drag, 0);
  let t = 0;
  while (t < 40 && run.phase !== 'finished') {
    v.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, world);
    t += 1 / 480;
    run.update(t, v.pos, 0);
  }
  assert.equal(run.phase, 'finished');
  assert.ok(run.time < drag.par.bronze, `the drag in ${run.time.toFixed(1)} s`);
});

test('Ashwood: generated as it always was', async () => {
  const data = await generateWorld({ map: 'ashwood' });
  assert.equal(data.map.id, 'ashwood');
  assert.equal(data.trees.count, 31831);
  assert.equal(data.boulders.length, 1087);
  // the ground at every 16th metre, to the centimetre, and its surfaces
  let sum = 0;
  const hist = new Array(11).fill(0);
  for (let k = 0; k < data.N; k += 16) for (let i = 0; i < data.N; i += 16) {
    sum += Math.round(data.heights[k * data.N + i] * 100);
    hist[data.surface[k * data.N + i]]++;
  }
  assert.equal(sum, ASHWOOD_HEIGHTS);
  assert.deepEqual(hist, ASHWOOD_SURFACES);
});
// (taken from the valley before Kerala was added: change them only for a change to Ashwood itself)
const ASHWOOD_HEIGHTS = 218147333;
const ASHWOOD_SURFACES = [10224, 1401, 46, 4029, 50, 186, 248, 0, 457, 0, 0];
