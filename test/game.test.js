import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CollisionWorld, stepCharacter } from '../shared/world.js';
import { groundHeight, FLAGS, BUILDINGS, generateBuilding } from '../shared/map.js';
import { hitCapsules, rayCapsule, WEAPONS } from '../shared/weapons.js';

const world = new CollisionWorld();
const mkGame = (bots = 0) => { const g = new Game({ botsPerTeam: bots, log: () => {} }); g.clock = 1_000_000; return g; };
const advance = (g, secs) => { for (let i = 0; i < secs * 30; i++) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const spawnAt = (g, p, x, z, yaw = 0) => { p.respawnAt = 0; g.spawn(p, 'base'); Object.assign(p, { x, z, y: groundHeight(x, z), yaw, spawnProtect: 0 }); };

test('buildings have walls, floors, stairs and door openings', () => {
  const b = generateBuilding(BUILDINGS.find((x) => x.id === 'b3'));
  assert.ok(b.parts.filter((p) => p.part === 'wall').length > 20);
  assert.ok(b.ramps.length >= 2, 'two-storey building should have stair flights');
  assert.ok(b.openings.some((o) => o.kind === 'door'));
  assert.ok(b.openings.some((o) => o.kind === 'window'));
});

test('character stands on terrain and cannot walk through a wall', () => {
  const b = BUILDINGS.find((x) => x.id === 'b3');
  const s = { x: b.x - 2, y: groundHeight(b.x - 2, b.z + b.d / 2 + 3), z: b.z + b.d / 2 + 3, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
  for (let i = 0; i < 120; i++) stepCharacter(world, s, { fx: 0, fz: -1, sprint: false }, 1 / 30);
  // walked north into the south wall (no door at that x) and must be stopped outside
  assert.ok(s.z > b.z + b.d / 2 - 0.05, `penetrated wall: z=${s.z}`);
  assert.ok(Math.abs(s.y - groundHeight(s.x, s.z)) < 0.6);
});

test('stairs lead to the upper floor', () => {
  const g = world.buildings.find((x) => x.id === 'b3');
  const r = g.ramps[0];
  const s = { x: (r.x0 + r.x1) / 2, y: r.y0, z: r.z0 + 0.1, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
  for (let i = 0; i < 90; i++) stepCharacter(world, s, { fx: 0, fz: 1, sprint: false }, 1 / 30);
  assert.ok(s.y > r.y0 + 2.5, `climbed only to ${s.y - r.y0}`);
});

test('ray hits walls and capsules', () => {
  const b = BUILDINGS[0];
  const o = { x: b.x, y: groundHeight(b.x, b.z) + 1.5, z: b.z - b.d / 2 - 10 };
  const hit = world.raycast(o, { x: 0, y: 0, z: 1 }, 50, true);
  assert.ok(hit && hit.t > 9 && hit.t < 11, 'hits the north wall');
  const caps = hitCapsules({ x: 0, y: 0, z: -10, yaw: 0, stance: 'stand' });
  const head = caps.find((c) => c.part === 'head');
  const t = rayCapsule({ x: 0, y: head.a[1], z: 0 }, { x: 0, y: 0, z: -1 }, head.a, head.b, head.r);
  assert.ok(t > 9.5 && t < 10);
});

test('server-authoritative hit detection, headshot multiplier, walls block shots', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  spawnAt(g, a, -60, 30); spawnAt(g, v, -60, 10);
  const eye = [a.x, a.y + 1.64, a.z];
  const headY = v.y + 1.64;
  const dz = v.z - a.z, dy = headY - eye[1];
  const L = Math.hypot(dz, dy);
  a.history = []; v.history = [];
  assert.ok(g.tryFire(a, eye, [0, dy / L, dz / L]));
  assert.ok(v.hp < 100 - WEAPONS.ar.damage * 1.5, `headshot damage too low: ${100 - v.hp}`);
  // ammo is server-tracked
  assert.equal(a.weapons[0].mag, WEAPONS.ar.mag - 1);
  // fire-rate limit
  assert.equal(g.tryFire(a, eye, [0, 0, -1]), false);
});

test('shots through a building wall do not damage', () => {
  const g = mkGame();
  const b = BUILDINGS.find((x) => x.id === 'b3');
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  spawnAt(g, a, b.x - 3, b.z + b.d / 2 + 6); spawnAt(g, v, b.x - 3, b.z - b.d / 2 - 6);
  g.clock += 1000;
  g.tryFire(a, [a.x, a.y + 1.3, a.z], [0, 0, -1]);
  assert.equal(v.hp, 100);
});

test('kill costs a ticket, respawn works, friendly fire off', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), f = g.addPlayer({ name: 'F', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  spawnAt(g, a, 100, 60); spawnAt(g, f, 100, 55); spawnAt(g, v, 100, 40);
  g.damage(f, 50, a, 'ar');
  assert.equal(f.hp, 100);
  g.damage(v, 150, a, 'ar');
  assert.equal(v.alive, false);
  assert.equal(g.tickets[2], 299);
  assert.equal(a.kills, 1);
  assert.equal(g.spawn(v, 'base'), false, 'respawn delay enforced');
  g.clock += 6000;
  assert.equal(g.spawn(v, 'base'), true);
});

test('conquest capture and ticket bleed', () => {
  const g = mkGame();
  const p = g.addPlayer({ name: 'A', team: 1 });
  const B = FLAGS.find((f) => f.id === 'B');
  spawnAt(g, p, B.x, B.z);
  advance(g, 15);
  const fb = g.flags.find((f) => f.id === 'B');
  assert.equal(fb.owner, 1);
  const before = g.tickets[2];
  advance(g, 20);
  assert.ok(g.tickets[2] < before, 'team 2 bleeds when team 1 holds more flags');
});

test('grenade explodes and damages nearby enemies behind no cover', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  spawnAt(g, a, 100, 60); spawnAt(g, v, 100, 40);
  g.throwGrenade(a, [a.x, a.y + 1.6, a.z], [0, 0.2, -1]);
  assert.equal(a.grenades, 1);
  advance(g, 4);
  assert.equal(g.grenades.length, 0);
  assert.ok(v.hp < 100);
});

test('reload refills from reserve', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 });
  spawnAt(g, a, 100, 60);
  a.weapons[0].mag = 3;
  g.reload(a);
  advance(g, 3);
  assert.equal(a.weapons[0].mag, WEAPONS.ar.mag);
  assert.equal(a.weapons[0].reserve, WEAPONS.ar.reserve - (WEAPONS.ar.mag - 3));
});

test('bots spawn, navigate, fight and capture objectives', () => {
  const g = mkGame(6);
  let kills = 0, shots = 0;
  for (let i = 0; i < 30 * 180; i++) {
    g.clock += 1000 / 30; g.tick(1 / 30);
    for (const e of g.flushEvents()) { if (e.ev.t === 'kill') kills++; if (e.ev.t === 'shot') shots++; }
  }
  assert.ok(shots > 50, `bots fired ${shots} shots`);
  assert.ok(kills > 0, 'bots killed each other');
  const moved = [...g.players.values()].filter((p) => Math.hypot(p.x - 8, Math.abs(p.z) - 152) > 20).length;
  assert.ok(moved > 3, 'bots left their bases');
});

test('spawning avoids enemy sight lines and contested flags; bots ignore spawn-protected soldiers', async () => {
  const { Game } = await import('../server/game.js');
  const g = new Game({ botsPerTeam: 0, map: 'outskirts', log: () => {} });
  const me = g.addPlayer({ name: 'Me', team: 1 });
  const foe = g.addPlayer({ name: 'Foe', team: 2 });
  foe.respawnAt = 0; g.spawn(foe, 'base');
  // an enemy standing on a flag we own: that flag can't be picked
  const f = g.flags[0]; f.owner = 1; f.progress = 1;
  Object.assign(foe, { x: f.x + 3, z: f.z, y: g.map.groundHeight(f.x + 3, f.z) });
  assert.ok(!g.spawnOptions(1).some((o) => o.id === f.id), 'flag under attack is not a spawn point');
  me.respawnAt = 0; g.spawn(me, f.id);
  assert.equal(me.spawnPoint, 'base', 'falls back to the HQ');
  assert.ok(me.spawnProtect - g.now() >= 2900);
  // enemy HQ is restricted
  const eb = g.map.BASES[2];
  Object.assign(me, { x: eb.x, z: eb.z, y: g.map.groundHeight(eb.x, eb.z), spawnProtect: 0 });
  for (let i = 0; i < 30 * 7; i++) g.tick(1 / 30);
  assert.ok(!me.alive || me.hp < 100, 'hurt inside the enemy HQ');
  assert.ok(g.flushEvents().some((e) => e.ev.t === 'restricted'));
});
