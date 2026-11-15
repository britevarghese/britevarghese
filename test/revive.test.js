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

// ---------------------------------------------------------------- bot medics
const botAt = (g, team, cls, x, z, name) => {
  const b = g.addPlayer({ name, team, bot: true, cls }); b.agent = true; b.respawnAt = 0; g.spawn(b, 'base');
  Object.assign(b, { x, z, y: groundHeight(x, z), spawnProtect: 0 });
  return b;
};
const run = (g, ms, until = () => false) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); if (until()) return true; } return false; };

test('bot teams are given a sensible mix of kits: from four soldiers up there is always a medic and a support', () => {
  for (let i = 0; i < 40; i++) {
    const g = new Game({ botsPerTeam: 4 + (i % 5), log: () => {} }); g.clock = 1_000_000;
    g.addPlayer({ name: 'H', team: 1, cls: ['assault', 'recon', 'support', 'medic'][i % 4] });
    g.tick(1 / 30);
    for (const t of [1, 2]) {
      const kits = [...g.players.values()].filter((p) => p.team === t).map((p) => p.cls);
      assert.ok(kits.includes('medic') && kits.includes('support') && kits.includes('assault'), `team ${t}: ${kits.join(', ')}`);
      assert.ok(kits.filter((k) => k === 'medic').length <= Math.ceil(kits.length / 3), `not all medics either: ${kits.join(', ')}`);
    }
  }
});

test('a bot medic goes for a man he can still reach in time, not only one close by; everyone is told he is coming', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 90);
  const v = soldier(g, 2, 'assault', 100, 40, 'V');
  const m = botAt(g, 2, 'medic', 142, 40, 'Medic'); // 42 m off
  g.damage(v, 130, a, 'ar');
  a.alive = false;
  assert.equal(g.snapshot().dn.find((d) => d[0] === v.id)[6], 0, 'nobody on his way yet');
  run(g, 1500);
  assert.equal(m.brain.reviveFor, v.id, 'the medic has set off');
  assert.equal(g.snapshot().dn.find((d) => d[0] === v.id)[6], m.id, 'and the snapshot says who is coming');
  g.flushEvents();
  let revived = null;
  run(g, 13000, () => (revived = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'revive')));
  assert.ok(revived && revived.by === m.id && v.alive, 'revived before he bled out');
});

test('a player who is down comes before a bot who is nearer; a man another medic is nearer to is left to that one', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 90);
  const human = soldier(g, 2, 'assault', 100, 40, 'Human');
  const bot = botAt(g, 2, 'assault', 122, 40, 'Bot');
  const m1 = botAt(g, 2, 'medic', 128, 40, 'M1'); // 6 m from the bot, 28 m from the player
  g.damage(human, 130, a, 'ar'); g.damage(bot, 130, a, 'ar');
  a.alive = false;
  run(g, 1000);
  assert.equal(m1.brain.reviveFor, human.id, 'the player first');
  const m2 = botAt(g, 2, 'medic', 124, 40, 'M2'); // (2 m from the bot; the first medic is by now nearer the player than he is)
  run(g, 1000);
  assert.equal(m2.brain.reviveFor, bot.id, 'the second medic takes the other man, not the one already being fetched');
});

test('a medic in a firefight leaves a man lying in the enemy\u2019s sights, but finishes the job when he has all but reached him', () => {
  // an enemy the medic has seen and is fighting (he can't be shot away), then a teammate goes down
  const scene = (r) => {
    const g = mkGame();
    const e = soldier(g, 1, 'assault', 100, 80, 'E'); e.hp = 1e9;
    const v = soldier(g, 2, 'assault', 100, 40, 'V');
    assert.ok(g.world.lineOfSight({ x: e.x, y: e.y + 1.5, z: e.z }, { x: v.x, y: v.y + 0.4, z: v.z }), 'the enemy has the spot covered');
    // the medic r metres from his teammate, somewhere he sees the enemy from
    let at = null;
    for (let k = 0; k < 24 && !at; k++) {
      const a = (k / 24) * Math.PI * 2, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, y = groundHeight(x, z);
      if (Math.abs(g.world.supportHeight(x, z, y + 1) - y) < 0.05 && g.world.lineOfSight({ x, y: y + 1.6, z }, { x: e.x, y: e.y + 1.35, z: e.z }) && g.world.lineOfSight({ x, y: y + 0.5, z }, { x: v.x, y: v.y + 0.5, z: v.z })) at = { x, z };
    }
    assert.ok(at, 'a spot for the medic');
    const m = botAt(g, 2, 'medic', at.x, at.z, 'Medic');
    assert.ok(run(g, 4000, () => { Object.assign(m, at); m.yaw = Math.atan2(-(e.x - m.x), -(e.z - m.z)); return m.brain.target === e && m.brain.visible; }), 'the medic is in a fight');
    g.damage(v, 130, null, 'ar');
    assert.ok(v.downed);
    return { g, e, v, m };
  };
  // 18 m from him, the man in plain view of the enemy 40 m off: the fight comes first
  let S = scene(18);
  run(S.g, 3000);
  assert.ok(S.v.downed && !S.m.reviving && S.m.brain.reviveFor == null, 'still fighting, nobody is being revived');
  // three metres from him: goes through with it
  S = scene(3);
  assert.ok(run(S.g, 6000, () => S.v.alive), 'brought round under the enemy\u2019s nose');
});

test('a downed bot holds on only while a medic could still get to him in the time left', () => {
  const g = mkGame();
  const a = soldier(g, 1, 'assault', 100, 90);
  const b = botAt(g, 2, 'assault', 100, 40, 'Bot');
  const m = soldier(g, 2, 'medic', 100, -40, 'Far'); // a player with the medic kit, 80 m away: too far to make it
  g.damage(b, 130, a, 'ar');
  a.alive = false;
  run(g, 5500);
  assert.ok(b.alive, 'nobody can reach him: redeployed as soon as he may');
  // 20 m away: worth waiting for... until even that is too far for the time left
  Object.assign(b, { x: 100, z: 40, y: groundHeight(100, 40), spawnProtect: 0 }); Object.assign(m, { x: 120, z: 40 });
  a.alive = true; g.damage(b, 130, a, 'ar'); a.alive = false;
  run(g, 6000);
  assert.ok(b.downed, 'waiting for him');
  run(g, 5000);
  assert.ok(b.alive, 'he never came: given up once he no longer could have');
});
