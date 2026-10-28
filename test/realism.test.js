import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { Foliage } from '../server/foliage.js';
import { CollisionWorld, stepCharacter, MOVE, STAMINA } from '../shared/world.js';
import { groundHeight } from '../shared/map.js';
import { WEAPONS, GRENADE } from '../shared/weapons.js';

const world = new CollisionWorld();
const mkGame = () => { const g = new Game({ botsPerTeam: 0, log: () => {} }); g.clock = 1_000_000; return g; };
const advance = (g, secs) => { for (let i = 0; i < Math.round(secs * 30); i++) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const spawnAt = (g, p, x, z, yaw = 0) => { p.respawnAt = 0; g.spawn(p, 'base'); Object.assign(p, { x, z, y: groundHeight(x, z), yaw, spawnProtect: 0, vx: 0, vz: 0 }); };
const flatSoldier = () => ({ x: 100, y: groundHeight(100, 60), z: 60, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand', groundT: 1 });

test('soldiers take a moment to get up to speed and sprint only as long as their stamina lasts', () => {
  const s = flatSoldier();
  let t = 0;
  while (Math.hypot(s.vx, s.vz) < MOVE.walk * 0.95 && t < 2) { stepCharacter(world, s, { fx: 1, fz: 0 }, 1 / 60); t += 1 / 60; }
  assert.ok(t > 0.2 && t < 0.45, `0 -> jog in ${t.toFixed(2)} s`);
  // flat-out sprint: full speed at first, back to a jog once winded, sprinting again only after a breather
  Object.assign(s, flatSoldier());
  let sprintT = 0;
  // (kept on the same spot so the run never reaches a wall or a hill)
  for (let i = 0; i < 60 * 20; i++) { stepCharacter(world, s, { fx: 0, fz: 1, sprint: true }, 1 / 60); s.x = 100; s.z = 60; if (!s.sprinting) break; sprintT += 1 / 60; }
  assert.ok(Math.abs(sprintT - STAMINA.sprintSecs) < 1.5, `sprinted ${sprintT.toFixed(1)} s`);
  assert.equal(s.winded, true);
  stepCharacter(world, s, { fx: 0, fz: 1, sprint: true }, 1 / 60);
  assert.equal(s.sprinting, false, 'no sprint while winded');
  for (let i = 0; i < 60 * STAMINA.recoverSecs; i++) stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / 60);
  assert.equal(s.winded, false);
});

test('jump height is a loaded soldier\'s (~0.45 m)', () => {
  const h = (MOVE.jump * MOVE.jump) / (2 * MOVE.gravity);
  assert.ok(h > 0.4 && h < 0.5, `${h.toFixed(2)} m`);
});

test('hit zones: legs take less than the torso, a rifle round to the head is lethal', () => {
  const shoot = (aimY) => {
    const g = mkGame();
    const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
    spawnAt(g, a, 100, 60); spawnAt(g, v, 100, 50);
    advance(g, 0.5);
    const eye = [a.x, a.y + 1.64, a.z], d = [0, v.y + aimY - eye[1], v.z - a.z], l = Math.hypot(...d);
    a.lastFire = 0; a.reloadUntil = 0;
    g.tryFire(a, eye, d.map((x) => x / l), g.now(), g.now());
    advance(g, 0.3);
    return 100 - (v.alive ? v.hp : 0);
  };
  const legs = shoot(0.5), body = shoot(1.1), head = shoot(1.64);
  assert.ok(legs > 0 && legs < body, `legs ${legs} < body ${body}`);
  assert.ok(Math.abs(body - WEAPONS.ar.damage) < 1, `body ${body}`);
  assert.equal(head, 100, 'headshot kills');
});

test('grenades: real gravity and fuse, and a malformed throw is ignored (no NaN health)', () => {
  assert.equal(GRENADE.gravity, 9.81);
  assert.ok(GRENADE.fuse >= 4);
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  spawnAt(g, a, 100, 60); spawnAt(g, v, 100, 54);
  const n = a.grenades;
  g.throwGrenade(a, [a.x, a.y + 1.6, a.z], ['x', 0, 0]);
  g.throwGrenade(a, [a.x, a.y + 1.6, a.z], [NaN, 0, 1]);
  assert.equal(a.grenades, n);
  g.damage(v, NaN, a, 'ar');
  assert.equal(v.hp, 100);
  // a 45° lob lands well short of 40 m (it was ~30+ m with the old 14 m/s² arcade arc and a 17 m/s throw)
  g.throwGrenade(a, [a.x, a.y + 1.6, a.z], [0, 0.71, 0.71]);
  const gr = g.grenades[0];
  let landed = null;
  for (let i = 0; i < 30 * 3 && !landed; i++) { g.clock += 1000 / 30; g.stepGrenades(1 / 30); if (gr.y < groundHeight(gr.x, gr.z) + 0.2) landed = Math.hypot(gr.x - a.x, gr.z - a.z); }
  assert.ok(landed > 18 && landed < 32, `landed ${landed?.toFixed(1)} m out`);
});

test('a soldier lying in a bush is hidden from bots; the same soldier in the open is seen', () => {
  const g = mkGame();
  const f = new Foliage(g.world);
  const bot = g.addPlayer({ name: '[BOT] B', bot: true, team: 1 }), prey = g.addPlayer({ name: 'P', team: 2 });
  // a big fern with a clear view onto it from 25 m (nothing solid in between, also once the soldier steps out)
  const centre = (fn) => { const k = fn.s * 0.7; return { x: fn.x + 0.46 * k * Math.cos(fn.r) + 0.44 * k * Math.sin(fn.r), z: fn.z - 0.46 * k * Math.sin(fn.r) + 0.44 * k * Math.cos(fn.r) }; };
  const pick = g.world.vegetation.shrubs.filter((s) => s.kind === 'fern' && s.s > 2.4 && Math.abs(s.x) < 150 && Math.abs(s.z) < 150).map(centre).find((c) => {
    const eye = { x: c.x + 25, y: groundHeight(c.x + 25, c.z) + 1.64, z: c.z };
    return g.world.lineOfSight(eye, { x: c.x, y: groundHeight(c.x, c.z) + 0.3, z: c.z }) && g.world.lineOfSight(eye, { x: c.x + 6, y: groundHeight(c.x + 6, c.z) + 1.35, z: c.z }) && f.cover(eye, { x: c.x + 6, y: groundHeight(c.x + 6, c.z) + 1.35, z: c.z }) < 0.3;
  });
  assert.ok(pick, 'a fern to hide in');
  const cx = pick.x, cz = pick.z;
  spawnAt(g, bot, cx + 25, cz, Math.PI / 2); // facing -x, toward the fern
  spawnAt(g, prey, cx, cz);
  prey.stance = 'prone'; prey.spawnedAt = 0;
  const eye = { x: bot.x, y: bot.y + 1.64, z: bot.z }, tgt = { x: prey.x, y: prey.y + 0.3, z: prey.z };
  assert.ok(f.cover(eye, tgt) > 0.5, 'fern hides a prone soldier');
  bot.brain.perceive(g.now());
  assert.equal(bot.brain.target, null, 'not spotted in the fern');
  // step out of the fern and stand up
  Object.assign(prey, { x: cx + 6, y: groundHeight(cx + 6, cz), stance: 'stand' });
  bot.brain.perceive(g.now());
  assert.equal(bot.brain.target, prey, 'spotted in the open');
});

test('soldiers are solid: a bot is pushed out of another soldier', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), b = g.addPlayer({ name: '[BOT] B', bot: true, team: 1 });
  spawnAt(g, a, 100, 60); spawnAt(g, b, 100.2, 60);
  g.separate(b);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.6);
});
