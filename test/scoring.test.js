import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';

const quiet = () => {};
const mkGame = () => { const g = new Game({ botsPerTeam: 0, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const soldier = (g, team, cls = 'assault', name = 'P') => { const p = g.addPlayer({ name, team, cls }); p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
const scores = (g, p) => g.flushEvents().filter((e) => e.only === p.id && e.ev.t === 'score').map((e) => [e.ev.why, e.ev.pts]);

test('a kill scores 100 (a head shot 20 more) and the player sees it in his score feed', () => {
  const g = mkGame();
  const a = soldier(g, 1), b = soldier(g, 2), c = soldier(g, 2);
  g.flushEvents();
  g.damage(b, 130, a, 'ar', false);
  assert.deepEqual(scores(g, a), [['down', 100]], 'a body hit leaves him down: the kill counts');
  g.damage(c, 200, a, 'ar', true);
  assert.deepEqual(scores(g, a), [['kill', 100], ['headshot', 20]]);
  assert.equal(a.score, 220);
  assert.equal(a.stats.headshot, 1);
});

test('whoever did real damage to a soldier someone else finished gets an assist worth the damage', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 'A'), k = soldier(g, 1, 'assault', 'K'), small = soldier(g, 1, 'assault', 'S'), v = soldier(g, 2);
  g.damage(v, 60, a, 'ar');
  g.damage(v, 10, small, 'ar');
  g.flushEvents();
  g.damage(v, 60, k, 'ar');
  const ev = g.flushEvents();
  const of = (p) => ev.filter((e) => e.only === p.id && e.ev.t === 'score').map((e) => [e.ev.why, e.ev.pts]);
  assert.deepEqual(of(a), [['assist', 60]]);
  assert.deepEqual(of(small), [], 'a scratch is no assist');
  assert.deepEqual(of(k), [['down', 100]]);
  // the tally starts afresh when he redeploys
  v.respawnAt = 0; g.spawn(v, 'base'); v.spawnProtect = 0;
  assert.equal(v.dmgBy, null);
});

test('capturing a flag scores for everyone in it; a medic scores for healing teammates', () => {
  const g = mkGame();
  const f = g.flags[0];
  const p = soldier(g, 1);
  Object.assign(p, { x: f.x, z: f.z, y: g.map.groundHeight(f.x, f.z) });
  f.owner = 0; f.progress = 0.95;
  g.flushEvents();
  advance(g, 2000);
  assert.ok(scores(g, p).some(([why, pts]) => why === 'capture' && pts === 200));
  const m = soldier(g, 1, 'medic', 'M'), hurt = soldier(g, 1, 'assault', 'H');
  Object.assign(hurt, { x: m.x + 2, z: m.z, hp: 20, lastHit: 0 });
  g.flushEvents();
  advance(g, 6500);
  assert.ok(scores(g, m).filter(([why]) => why === 'heal').length >= 1, 'heal points');
});

test('the end of the round carries a summary of every soldier round', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 'A'), b = soldier(g, 2, 'assault', 'B');
  g.damage(b, 200, a, 'ar', true);
  g.flushEvents();
  g.tickets[2] = 0;
  advance(g, 100);
  const r = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'round');
  assert.equal(r.winner, 1);
  assert.equal(r.tk[1], 0);
  const row = r.ps.find((x) => x[0] === a.id);
  assert.equal(row[1], 'A'); assert.equal(row[3], 120); assert.equal(row[4], 1); assert.equal(row[11], 1, 'head shots');
  assert.equal(r.ps.find((x) => x[0] === b.id)[5], 1, 'deaths');
  // the next round starts with clean sheets
  advance(g, 15500);
  assert.equal(a.score, 0); assert.deepEqual(a.stats, {});
});

test('rounds cracking past a soldier pin him down: if a teammate kills him soon after, the shooter gets a suppression assist', () => {
  const g = mkGame();
  // open, level ground
  let L = null;
  for (let k = 0; k < 4000 && !L; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF, z = (Math.random() - 0.5) * g.map.PLAY_HALF, y = g.world.supportHeight(x, z, 500), y2 = g.world.supportHeight(x + 40, z, 500);
    if (Math.abs(y - g.map.groundHeight(x, z)) > 0.05 || Math.abs(y - y2) > 0.3) continue;
    // (the shot's line, plus one 10 cm under it: room for the bullet's drop — it mustn't graze the top of a car)
    if ([0, 1.5, -1.5].every((oz) => g.world.lineOfSight({ x, y: y + 1.6, z }, { x: x + 44, y: y2 + 1.3, z: z + oz })) && g.world.lineOfSight({ x, y: y + 1.5, z }, { x: x + 44, y: y2 + 1.2, z: z + 1.5 })) L = { x, z, y, y2 };
  }
  assert.ok(L, 'open ground');
  const a = soldier(g, 1, 'assault', 'A'), k = soldier(g, 1, 'assault', 'K'), v = soldier(g, 2, 'assault', 'V');
  Object.assign(a, { x: L.x, z: L.z, y: L.y }); Object.assign(v, { x: L.x + 40, z: L.z, y: L.y2 });
  // a round ~1.4 m past his chest (along one of the lines checked clear above)
  a.slot = 0; a.nextFire = 0; a.reloadUntil = 0; a.weapons[0].mag = 30;
  const eye = [a.x, a.y + 1.6, a.z], tgt = [v.x + 4, v.y + 1.3, v.z + 1.5];
  const d = tgt.map((c, i) => c - eye[i]), n = Math.hypot(...d);
  assert.ok(g.tryFire(a, eye, d.map((c) => c / n)));
  assert.equal(v.suppressedBy?.id, a.id, 'pinned down');
  g.flushEvents();
  g.damage(v, 200, k, 'ar', true);
  assert.deepEqual(scores(g, a), [['suppress', 15]]);
});
