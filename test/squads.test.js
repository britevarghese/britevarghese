import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { SQUAD_SIZE } from '../shared/squads.js';

const quiet = () => {};
const mkGame = (bots = 0) => { const g = new Game({ botsPerTeam: bots, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const spawnAt = (g, p, x, z, yaw = 0) => {
  p.respawnAt = 0; g.spawn(p, 'base');
  Object.assign(p, { x, z, y: g.world.supportHeight(x, z, 500), yaw, spawnProtect: 0, lastHit: 0, onGround: true });
  return p;
};
// an open spot well away from both HQs
function openSpot(g) {
  for (let k = 0; k < 5000; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF, z = (Math.random() - 0.5) * g.map.PLAY_HALF, y = g.world.supportHeight(x, z, 500);
    if (Math.abs(y - g.map.groundHeight(x, z)) > 0.05) continue;
    if (g.world.query(x - 4, z - 4, x + 4, z + 4, []).some((b) => b.max[1] > y + 0.3)) continue;
    if ([1, 2].some((t) => Math.hypot(x - g.map.BASES[t].x, z - g.map.BASES[t].z) < 60)) continue;
    return { x, z };
  }
  return null;
}

test('each team is organised in squads of four; players are put together and the bots top their squad up', () => {
  const g = mkGame(8);
  g.balanceBots();
  for (const t of [1, 2]) {
    const sizes = new Map();
    for (const p of g.players.values()) if (p.team === t) { assert.ok(p.squad > 0, 'everyone in a squad'); sizes.set(p.squad, (sizes.get(p.squad) || 0) + 1); }
    assert.ok([...sizes.values()].every((n) => n <= SQUAD_SIZE), `squads ${JSON.stringify([...sizes])}`);
    assert.equal(sizes.size, 2, 'eight bots: two squads');
  }
  // two players join team 1: same squad, filled up to four with bots, and the bot count stays right
  const a = g.addPlayer({ name: 'A', team: 1 }), b = g.addPlayer({ name: 'B', team: 1 });
  g.balanceBots();
  assert.equal(a.squad, b.squad);
  const mine = [...g.players.values()].filter((p) => p.team === 1 && p.squad === a.squad);
  assert.equal(mine.length, SQUAD_SIZE);
  assert.equal([...g.players.values()].filter((p) => p.team === 1).length, 8);
  // the board says who is in which squad
  assert.equal(g.scoreboard().rows.find((r) => r.id === a.id).sq, a.squad);
  // a squad never takes a fifth player: four players, then the next starts another squad
  const more = [1, 2, 3].map((i) => g.addPlayer({ name: `P${i}`, team: 1 }));
  g.balanceBots();
  const counts = new Map();
  for (const p of [a, b, ...more]) counts.set(p.squad, (counts.get(p.squad) || 0) + 1);
  assert.deepEqual([...counts.values()].sort(), [1, 4]);
});

test('deploying on a squad mate puts you right behind him, facing his way', () => {
  const g = mkGame();
  const at = openSpot(g);
  assert.ok(at, 'open ground');
  const m = spawnAt(g, g.addPlayer({ name: 'Mate', team: 1 }), at.x, at.z, 0.7);
  const p = g.addPlayer({ name: 'P', team: 1 });
  assert.equal(p.squad, m.squad);
  p.respawnAt = 0;
  assert.deepEqual(g.squadSpawns(p), [[m.id, '']]);
  g.flushEvents();
  assert.ok(g.spawn(p, `@${m.id}`));
  const d = Math.hypot(p.x - m.x, p.z - m.z);
  assert.ok(d > 0.8 && d < 3, `${d.toFixed(2)} m from him`);
  // behind: the offset points against his forward (-sin yaw, -cos yaw)
  assert.ok((p.x - m.x) * -Math.sin(m.yaw) + (p.z - m.z) * -Math.cos(m.yaw) < 0, 'behind him');
  assert.ok(Math.abs(p.y - m.y) < 0.6);
  assert.equal(p.yaw, m.yaw);
  assert.equal(p.spawnPoint, 'squad');
  const ev = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'spawn' && e.id === p.id);
  assert.equal(ev.on, m.id);
});

test('not while he is under fire, has enemies close by, rides in a vehicle, or is not in your squad', () => {
  const g = mkGame();
  const at = openSpot(g);
  const m = spawnAt(g, g.addPlayer({ name: 'Mate', team: 1 }), at.x, at.z);
  const p = g.addPlayer({ name: 'P', team: 1 }); p.respawnAt = 0;
  const why = () => g.squadSpawns(p)[0][1];
  m.lastHit = g.now() - 1000;
  assert.equal(why(), 'c', 'hit a second ago');
  g.flushEvents();
  assert.equal(g.spawn(p, `@${m.id}`), false);
  assert.equal(p.alive, false);
  assert.equal(g.flushEvents().map((e) => e.ev).find((e) => e.t === 'spawnfail')?.why, 'c');
  m.lastHit = 0;
  assert.equal(why(), '');
  const e = spawnAt(g, g.addPlayer({ name: 'E', team: 2 }), at.x + 12, at.z);
  assert.equal(why(), 'c', 'enemy 12 m away');
  e.alive = false;
  m.vehicle = 99;
  assert.equal(why(), 'v');
  m.vehicle = null;
  // someone on the team but in another squad is not a spawn point
  const other = g.addPlayer({ name: 'O', team: 1 }); other.squad = m.squad + 1;
  other.respawnAt = 0;
  assert.equal(g.spawn(other, `@${m.id}`), false);
  assert.equal(other.alive, false);
  // dead squad mates aren't offered at all
  m.alive = false;
  assert.deepEqual(g.squadSpawns(p), []);
});

test('bots spawn on their squad mates too', () => {
  const g = mkGame();
  const at = openSpot(g);
  const m = spawnAt(g, g.addPlayer({ name: 'Mate', team: 1 }), at.x, at.z);
  const b = g.addPlayer({ name: 'Bot', team: 1, bot: true }); b.agent = true; // (kept by balanceBots)
  assert.equal(b.squad, m.squad);
  let onMate = 0;
  for (let i = 0; i < 12; i++) {
    b.alive = false; b.respawnAt = 0; b.downed = null;
    Object.assign(m, { lastHit: 0, x: at.x, z: at.z, y: g.world.supportHeight(at.x, at.z, 500), alive: true });
    advance(g, 100);
    if (b.alive && b.spawnPoint === 'squad') onMate++;
  }
  assert.ok(onMate >= 2, `${onMate} of 12 respawns on the squad mate`);
});

test('battle royale has no squads', async () => {
  const { RoyaleGame } = await import('../server/royale.js');
  const g = new RoyaleGame({ botsPerTeam: 0, log: quiet });
  const p = g.addPlayer({ name: 'P' });
  assert.equal(g.squadSpawns(p), undefined);
});
