// The open world (world/maps/world.js): every map built as it is, the stretches between them laid onto their edges
// (no step where two meet), and the roads that join them fit to drive across the joins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBigWorld, heightIn } from '../src/world/BigWorldGen.js';
import { REGIONS, regionById } from '../src/world/maps/world.js';
import { spline } from '../src/world/WorldGen.js';

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
