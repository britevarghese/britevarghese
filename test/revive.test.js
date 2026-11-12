import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, BLEED_MS, REVIVE_MS, REVIVE_HP } from '../server/game.js';
import { groundHeight } from '../shared/map.js';

const mkGame = () => { const g = new Game({ botsPerTeam: 0, log: () => {} }); g.clock = 1_000_000; return g; };
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const soldier = (g, team, cls, x, z, name = 'P') => {
  const p = g.addPlayer({ name, team, cls }); p.respawnAt = 0; g.spawn(p, 'base');
  Object.assign(p, { x, z, y: groundHeight(x, z), spawnProtect: 0 });
  return p;
};
const events = (g, t) => g.flushEvents().map((e) => e.ev).filter((e) => e.t === t);

test('body hits down a soldier instead of killing him; he bleeds out after 15 s and only then the ticket goes', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60, 'A'), v = soldier(g, 2, 'assault', 100, 40, 'V');
  const t0 = g.tickets[2];
  g.flushEvents();
  g.damage(v, 130, a, 'ar', false);
  assert.equal(v.alive, false);
  assert.ok(v.downed, 'downed');
  assert.equal(g.tickets[2], t0, 'no ticket yet');
  const k = events(g, 'kill')[0];
  assert.equal(k.dn, 1); assert.equal(k.k, a.id);
  assert.equal(a.kills, 1, 'the kill counts for the shooter');
  // in the snapshot as a casualty where he fell
  const dn = g.snapshot().dn;
  assert.ok(dn && dn[0][0] === v.id && Math.abs(dn[0][2] - 100) < 0.01 && dn[0][5] <= 15);
  advance(g, BLEED_MS + 200);
  assert.equal(v.downed, null);
  assert.equal(g.tickets[2], t0 - 1, 'bled out: ticket gone');
  assert.equal(events(g, 'bledout').length, 1);
});

test('a head shot, an explosion that blows him apart, a fall or a run-over kill outright', () => {
  for (const [dmg, head, weapon] of [[200, true, 'ar'], [200, false, 'grenade'], [120, false, 'fall'], [100, false, 'roadkill']]) {
    const g = mkGame();
    const a = soldier(g, 1, 'assault', 100, 60), v = soldier(g, 2, 'assault', 100, 40);
    const t0 = g.tickets[2];
    g.damage(v, dmg, weapon === 'fall' ? null : a, weapon, head);
    assert.equal(v.alive, false);
    assert.equal(v.downed ?? null, null, `${weapon}${head ? ' (head)' : ''}: no revive`);
    assert.equal(g.tickets[2], t0 - 1);
  }
});

test('a medic beside him brings him round in 2.5 s: up where he fell with 30 hp and his kit, no ticket lost', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60), v = soldier(g, 2, 'assault', 100, 40, 'V'), m = soldier(g, 2, 'medic', 101.2, 40.5, 'Medic');
  v.weapons[0].mag = 7;
  g.damage(v, 130, a, 'ar');
  const t0 = g.tickets[2], d0 = v.deaths, s0 = m.score;
  g.flushEvents();
  g.reviveHold(m, v.id, true);
  advance(g, REVIVE_MS - 300);
  assert.equal(v.alive, false, 'not yet');
  advance(g, 500);
  assert.equal(v.alive, true, 'revived');
  assert.equal(v.hp, REVIVE_HP);
  assert.ok(Math.hypot(v.x - 100, v.z - 40) < 0.01, 'where he fell');
  assert.equal(v.weapons[0].mag, 7, 'kit as it was');
  assert.equal(g.tickets[2], t0);
  assert.equal(v.deaths, d0 - 1);
  assert.equal(m.score, s0 + 50);
  assert.equal(events(g, 'revive')[0]?.by, m.id);
  assert.ok(!g.snapshot().dn, 'no longer a casualty');
});

test('only a medic, within reach, staying with him, before he bleeds out', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60), v = soldier(g, 2, 'assault', 100, 40), r = soldier(g, 2, 'assault', 101, 40), m = soldier(g, 2, 'medic', 106, 40);
  g.damage(v, 130, a, 'ar');
  g.reviveHold(r, v.id, true);          // not a medic
  g.reviveHold(m, v.id, true);          // too far
  advance(g, REVIVE_MS + 500);
  assert.equal(v.alive, false);
  // the medic gets there, starts, then walks off half way
  Object.assign(m, { x: 101.5, z: 40 });
  g.reviveHold(m, v.id, true);
  advance(g, 1200);
  Object.assign(m, { x: 108, z: 40 });
  advance(g, 2000);
  assert.equal(v.alive, false, 'interrupted');
  // an enemy medic can't
  const em = soldier(g, 1, 'medic', 100.8, 40.4);
  g.reviveHold(em, v.id, true);
  advance(g, REVIVE_MS + 300);
  assert.equal(v.alive, false);
});

test('redeploying while down gives up on a medic: the ticket goes then', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60), v = soldier(g, 2, 'assault', 100, 40);
  g.damage(v, 130, a, 'ar');
  const t0 = g.tickets[2];
  advance(g, 5200); // respawn delay
  assert.ok(v.downed);
  assert.ok(g.spawn(v, 'base'));
  assert.equal(v.downed, null);
  assert.equal(g.tickets[2], t0 - 1);
});

test('a downed bot holds on while a medic of his side is near, and redeploys when none is', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60);
  const b = g.addPlayer({ name: 'Bot', team: 2, bot: true, cls: 'assault' }); b.agent = true; b.respawnAt = 0; g.spawn(b, 'base');
  Object.assign(b, { x: 100, z: 40, y: groundHeight(100, 40), spawnProtect: 0 });
  const m = soldier(g, 2, 'medic', 120, 40, 'Medic');
  g.damage(b, 130, a, 'ar');
  advance(g, 7000);
  assert.equal(b.alive, false, 'waited for the medic');
  assert.ok(b.downed);
  m.cls = 'assault'; // no medic any more
  advance(g, 1500);
  assert.equal(b.alive, true, 'redeployed');
});

test('a bot medic runs to a teammate who is down close by and brings him round', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 80);
  const v = soldier(g, 2, 'assault', 100, 40, 'V');
  const m = g.addPlayer({ name: 'Medic', team: 2, bot: true, cls: 'medic' }); m.agent = true; m.respawnAt = 0; g.spawn(m, 'base');
  Object.assign(m, { x: 118, z: 40, y: groundHeight(118, 40), spawnProtect: 0 });
  g.damage(v, 130, a, 'ar');
  a.alive = false; // (the shooter out of the way: nothing to fight)
  g.flushEvents();
  let revived = null;
  for (let t = 0; t < 14000 && !revived; t += 1000 / 30) {
    g.clock += 1000 / 30; g.tick(1 / 30);
    revived = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'revive');
  }
  assert.ok(revived, 'revived');
  assert.equal(revived.by, m.id);
  assert.ok(v.alive && v.hp === REVIVE_HP);
});

test('giving up from the downed screen: the ticket goes at once and medics stop seeing a casualty', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 60), v = soldier(g, 2, 'assault', 100, 40), m = soldier(g, 2, 'medic', 101.2, 40);
  g.damage(v, 130, a, 'ar');
  const t0 = g.tickets[2];
  g.reviveHold(m, v.id, true);
  g.flushEvents();
  g.giveUp(v);
  assert.equal(v.downed, null);
  assert.equal(g.tickets[2], t0 - 1);
  assert.equal(events(g, 'bledout').length, 1);
  assert.ok(!g.snapshot().dn);
  advance(g, REVIVE_MS + 300);
  assert.equal(v.alive, false, 'the medic has nothing to work on');
  g.giveUp(v); // (a second one changes nothing)
  assert.equal(g.tickets[2], t0 - 1);
  // the scoreboard carries each soldier's kit (the downed screen finds the medics)
  assert.equal(g.scoreboard().rows.find((r) => r.id === m.id).c, 'medic');
});

test('switching sides while down gives up on a medic: the old team loses the ticket, no downed body changes sides', async () => {
  const { Room } = await import('../server/rooms.js');
  const room = new Room({ id: 'T', name: 'T', map: 'outskirts', botsPerTeam: 0 });
  const g = room.game; g.clock = 1_000_000;
  const ws = { readyState: 1, send() {} };
  room.join(ws, { name: 'H', team: 1, cls: 'assault' });
  const h = room.clients.get(ws); h.respawnAt = 0; g.spawn(h, 'base'); h.spawnProtect = 0;
  const e = soldier(g, 2, 'assault', h.x + 20, h.z, 'E');
  g.damage(h, 130, e, 'ar', false);
  assert.ok(h.downed, 'down, waiting for a medic');
  const t1 = g.tickets[1], t2 = g.tickets[2];
  room.message(ws, { t: 'team', team: 2 });
  assert.equal(h.team, 2);
  assert.equal(h.downed, null, 'given up');
  assert.equal(g.tickets[1], t1 - 1, 'his old team paid the ticket');
  assert.equal(g.tickets[2], t2);
});
