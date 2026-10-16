// Checkpoint races (game/Races.js): each map's circuits and rallies are on its trails, their checkpoints are passed
// in order by driving the course (a circuit's laps too), the grid is on dry ground, and the par times make sense.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';
import { racesFor } from '../src/game/Races.js';
import { EventRun, gridFor } from '../src/game/Events.js';

const EVENT_RX = /^[a-z]{2,16}$/;           // (server/rooms.js: what a race's id may be)

for (const [map, ids] of [['ashwood', ['bogcircuit', 'eastford', 'pinecrest', 'meadows', 'mirrorlake', 'gorgerun']], ['kerala', ['estaterally', 'paddyrally', 'anapara']]]) {
  test(`${map}: the checkpoint races`, async () => {
    const world = new World(await generateWorld({ map }));
    const races = racesFor(world);
    assert.deepEqual(races.map((r) => r.id), ids);
    const trailPts = world.data.trails.flatMap((t) => t.points);
    for (const r of races) {
      assert.match(r.id, EVENT_RX);
      assert.ok(r.par.gold < r.par.silver && r.par.silver < r.par.bronze, `${r.id}: par times in order`);
      assert.equal(r.gates.length, r.laps * (r.cps + 1), `${r.id}: checkpoints and finish, each lap`);
      assert.ok(r.gates.every((g) => Number.isFinite(g.y) && g.dir && g.near), `${r.id}: gates on the ground`);
      assert.ok(r.gates.at(-1).finish, `${r.id}: ends at a finish`);
      // the course keeps to the trails (a via circuit's closing cut aside)
      const off = r.line.filter(([x, z]) => Math.min(...trailPts.map(([a, b]) => Math.hypot(a - x, b - z))) > 9).length;
      assert.ok(off <= 4, `${r.id}: ${off} points of its line off the trails`);
      // driven along its line, every checkpoint in order, to the finish
      const run = new EventRun(r, 0);
      let t = 0.01;
      const L = r.line;
      for (let k = 1; k < L.length && run.phase !== 'finished'; k++) {
        for (let u = 0; u <= 1; u += 0.25) {
          const x = L[k - 1][0] + (L[k][0] - L[k - 1][0]) * u, z = L[k - 1][1] + (L[k][1] - L[k - 1][1]) * u;
          t += 0.1;
          run.update(t, { x, y: world.terrain(x, z) + 0.8, z }, 0);
        }
      }
      assert.equal(run.phase, 'finished', `${r.id}: finished (${run.gate}/${r.gates.length})`);
      // the grid: four slots on dry, open ground
      const grid = gridFor(world, r);
      assert.equal(grid.length, 4);
      for (const s of grid) assert.ok(world.water(s.x, s.z) - world.terrain(s.x, s.z) < 0.3, `${r.id}: a grid slot in water`);
    }
  });
}
