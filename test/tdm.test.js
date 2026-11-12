import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { RoomManager } from '../server/rooms.js';

const quiet = () => {};
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };

test('Team Deathmatch: no flags, no HQ no-go zones, 100 tickets, a death costs one and the first side to 0 loses', () => {
  const g = new Game({ botsPerTeam: 0, map: 'compound', mode: 'tdm', log: quiet }); g.clock = 1_000_000;
  assert.equal(g.mode, 'tdm');
  assert.deepEqual(g.flags, []);
  assert.equal(g.restrictedHQ, 0);
  assert.deepEqual(g.tickets, { 1: 100, 2: 100 });
  const a = g.addPlayer({ name: 'A', team: 1 }), b = g.addPlayer({ name: 'B', team: 2 });
  for (const p of [a, b]) { p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; }
  g.damage(b, 200, a, 'ar', true);
  assert.equal(g.tickets[2], 99);
  advance(g, 5000);
  assert.equal(g.tickets[2], 99, 'no bleed without flags');
  g.tickets[2] = 1;
  b.respawnAt = 0; g.spawn(b, 'base'); b.spawnProtect = 0;
  g.flushEvents();
  g.damage(b, 200, a, 'ar', true);
  advance(g, 100);
  const r = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'round');
  assert.equal(r?.winner, 1);
});

test('TDM spawns go to the sector furthest from the enemy, near friends', () => {
  const g = new Game({ botsPerTeam: 0, map: 'compound', mode: 'tdm', log: quiet }); g.clock = 1_000_000;
  const foes = [1, 2, 3].map((i) => { const p = g.addPlayer({ name: `E${i}`, team: 2 }); p.respawnAt = 0; g.spawn(p, 'base'); return p; });
  // the enemy camps the first sector
  const s0 = g.map.FLAGS[0];
  for (const f of foes) Object.assign(f, { x: s0.x + Math.random() * 6, z: s0.z + Math.random() * 6 });
  for (let i = 0; i < 10; i++) {
    const p = g.addPlayer({ name: `P${i}`, team: 1 }); p.respawnAt = 0;
    assert.ok(g.spawn(p, 'base'));
    const d = Math.min(...foes.map((f) => Math.hypot(f.x - p.x, f.z - p.z)));
    assert.ok(d > 40, `spawned ${d.toFixed(0)} m from the enemy`);
    g.removePlayer(p.id);
  }
});

test('TDM bots hunt the enemy across the sectors (no flags to take)', () => {
  const g = new Game({ botsPerTeam: 3, map: 'compound', mode: 'tdm', log: quiet }); g.clock = 1_000_000;
  advance(g, 8000);
  const bots = [...g.players.values()].filter((p) => p.bot && p.alive && !p.vehicle);
  assert.ok(bots.length >= 4);
  assert.ok(bots.every((b) => b.brain.goal && b.brain.goal.flag === null), 'goals without flags');
  // they meet and fight: kills happen within a couple of minutes
  advance(g, 120000);
  assert.ok(g.tickets[1] + g.tickets[2] < 200, `tickets ${g.tickets[1]} / ${g.tickets[2]}`);
});

test('a room made as Team Deathmatch says so, keeps the mode through map rotation, and is offered by default', () => {
  const rm = new RoomManager({ log: quiet });
  const r = rm.create({ name: 'tdm', map: 'outskirts', mode: 'tdm', botsPerTeam: 0 });
  assert.equal(r.mode, 'tdm'); assert.equal(r.info().mode, 'tdm'); assert.equal(r.game.mode, 'tdm');
  // a royale map can't be TDM
  assert.equal(rm.create({ name: 'x', map: 'firestorm', mode: 'tdm', botsPerTeam: 0 }).mode, 'royale');
  assert.equal(rm.create({ name: 'c', map: 'valley', botsPerTeam: 0 }).mode, 'conquest');
});
