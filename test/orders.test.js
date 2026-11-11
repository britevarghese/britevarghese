import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, ORDER_DEFEND_MS } from '../server/game.js';
import { EYE_HEIGHT } from '../shared/world.js';

const quiet = () => {};
const mkGame = () => { const g = new Game({ botsPerTeam: 0, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const soldier = (g, team, opts = {}) => { const p = g.addPlayer({ name: opts.name || 'P', team, cls: 'assault', bot: !!opts.bot }); if (opts.bot) p.agent = true; p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
// Q pressed looking straight at a flag
const qAt = (g, p, f) => { const o = [p.x, p.y + EYE_HEIGHT[p.stance], p.z]; return g.spot(p, o, [f.x - o[0], g.map.groundHeight(f.x, f.z) + 2 - o[1], f.z - o[2]]); };

test('the squad leader points at a flag and presses Q: attack it (or defend it if it is ours); only the leader', () => {
  const g = mkGame();
  const lead = soldier(g, 1, { name: 'Lead' }), mate = soldier(g, 1, { name: 'Mate' });
  assert.equal(lead.squad, mate.squad);
  assert.equal(g.squadLeader(1, lead.squad), lead);
  const enemyFlag = g.flags.find((f) => f.owner !== 1) || g.flags[0];
  enemyFlag.owner = 2;
  g.flushEvents();
  qAt(g, lead, enemyFlag);
  const o = g.squadOrder(mate);
  assert.deepEqual([o.flag, o.kind, o.by], [enemyFlag.id, 'attack', lead.id]);
  const ev = g.flushEvents().filter((e) => e.ev.t === 'order');
  assert.deepEqual(ev.map((e) => e.only).sort(), [lead.id, mate.id].sort(), 'the squad hears it');
  // a squad member who isn't the leader can't
  advance(g, 800);
  const own = g.flags.find((f) => f !== enemyFlag); own.owner = 1;
  qAt(g, mate, own);
  assert.equal(g.squadOrder(lead).flag, enemyFlag.id);
  const ev2 = g.flushEvents().filter((e) => e.only === mate.id);
  assert.ok(!ev2.some((e) => e.ev.t === 'order'), 'no order from him');
  assert.equal(ev2.find((e) => e.ev.t === 'spot')?.ev.ok, 0, '(just nothing spotted)');
  assert.equal(g.order(mate, own.id), false);
  // the leader on his own flag: defend
  advance(g, 800);
  qAt(g, lead, own);
  assert.deepEqual([g.squadOrder(mate).flag, g.squadOrder(mate).kind], [own.id, 'defend']);
  // ... for three minutes
  advance(g, ORDER_DEFEND_MS + 1000);
  assert.equal(g.squadOrder(mate), null);
});

test('bots in the squad head for the ordered flag', () => {
  const g = mkGame();
  const lead = soldier(g, 1, { name: 'Lead' });
  const bots = [1, 2].map((i) => soldier(g, 1, { name: `B${i}`, bot: true }));
  assert.ok(bots.every((b) => b.squad === lead.squad));
  // the flag furthest from them, which they wouldn't pick on their own
  const far = g.flags.reduce((a, f) => (Math.hypot(f.x - bots[0].x, f.z - bots[0].z) > Math.hypot(a.x - bots[0].x, a.z - bots[0].z) ? f : a));
  far.owner = 2;
  advance(g, 300);
  assert.ok(g.order(lead, far.id));
  advance(g, 1500);
  for (const b of bots) assert.equal(b.brain.goal?.flag, far.id, `${b.name} heads for ${far.id}`);
});

test('taking the flag as ordered pays a bonus and completes the order; killing while defending it pays too', () => {
  const g = mkGame();
  const lead = soldier(g, 1, { name: 'Lead' }), mate = soldier(g, 1, { name: 'Mate' });
  const f = g.flags[0];
  f.owner = 0; f.progress = 0.97;
  g.order(lead, f.id);
  for (const p of [lead, mate]) Object.assign(p, { x: f.x + (p === mate ? 2 : 0), z: f.z, y: g.map.groundHeight(f.x, f.z) });
  g.flushEvents();
  advance(g, 1500);
  const of = (p) => g.events.length, ev = g.flushEvents();
  void of;
  for (const p of [lead, mate]) {
    const mine = ev.filter((e) => e.only === p.id && e.ev.t === 'score').map((e) => e.ev.why);
    assert.ok(mine.includes('capture') && mine.includes('order'), `${p.name}: ${mine}`);
  }
  assert.equal(g.squadOrder(lead), null, 'done');
  // now defend it: a kill near it scores the defend bonus
  g.order(lead, f.id);
  assert.equal(g.squadOrder(lead).kind, 'defend');
  const e = soldier(g, 2, { name: 'E' });
  Object.assign(e, { x: f.x + 6, z: f.z, y: g.map.groundHeight(f.x + 6, f.z) });
  g.flushEvents();
  g.damage(e, 200, mate, 'ar', true);
  assert.ok(g.flushEvents().some((x) => x.only === mate.id && x.ev.t === 'score' && x.ev.why === 'defend'));
});

test('the order reaches the squad in its snapshots, and a lost defend flag becomes an attack order', () => {
  const g = mkGame();
  const lead = soldier(g, 1, { name: 'Lead' });
  const f = g.flags[0]; f.owner = 1; f.progress = 1;
  g.order(lead, f.id);
  assert.equal(g.squadOrder(lead).kind, 'defend');
  // the enemy takes it
  const e = soldier(g, 2, { name: 'E' }); e.spawnProtect = g.now() + 1e9;
  Object.assign(e, { x: f.x, z: f.z, y: g.map.groundHeight(f.x, f.z) });
  Object.assign(lead, { x: g.map.BASES[1].x, z: g.map.BASES[1].z });
  for (let i = 0; i < 40 && f.owner === 1; i++) advance(g, 1000);
  assert.notEqual(f.owner, 1);
  assert.equal(g.squadOrder(lead).kind, 'attack');
});
