import test from 'node:test';
import assert from 'node:assert/strict';
import { RoyaleGame } from '../server/royale.js';
import { getMap, CONQUEST_MAPS, modeOf } from '../shared/map.js';
import { CollisionWorld } from '../shared/world.js';
import { stepAir, ringAt, ROYALE } from '../shared/royale.js';

const mk = (bots = 0) => { const g = new RoyaleGame({ bots, log: () => {}, lobbyTime: 2 }); g.clock = 1_000_000; return g; };
const advance = (g, secs, each) => { for (let i = 0; i < secs * 30; i++) { g.clock += 1000 / 30; g.tick(1 / 30); each?.(); } };
const toPlaneWindow = (g) => { while (g.planeK(g.clock) < g.plane.jumpFrom + 0.05) advance(g, 0.5); };
const ground = (g, p, x, z) => Object.assign(p, { x, z, y: g.world.supportHeight(x, z, 500), air: 0, onGround: true, vx: 0, vy: 0, vz: 0 });

test('firestorm is a battle royale map and is excluded from conquest rotation', () => {
  assert.equal(modeOf('firestorm'), 'royale');
  assert.ok(!CONQUEST_MAPS.includes('firestorm'));
  assert.ok(getMap('firestorm').BUILDINGS.length > 50);
});

test('freefall -> parachute -> landing on the ground', () => {
  const world = new CollisionWorld(getMap('firestorm'));
  const s = { x: 100, z: 100, y: 220, vx: 0, vy: 0, vz: 0, air: 1, stance: 'stand' };
  let maxFall = 0, opened = false;
  for (let i = 0; i < 30 * 90 && s.air; i++) {
    stepAir(world, s, { fx: 1, fz: 0, dive: 0, deploy: false }, 1 / 30);
    maxFall = Math.max(maxFall, -s.vy);
    if (s.air === 2) opened = true;
  }
  assert.equal(s.air, 0, 'landed');
  assert.ok(opened, 'canopy auto-opened before the ground');
  assert.ok(maxFall > 35, `terminal velocity reached (${maxFall.toFixed(1)} m/s)`);
  assert.ok(Math.abs(s.y - world.supportHeight(s.x, s.z, s.y + 1)) < 0.05);
  assert.ok(s.x > 130, 'glided in the steering direction');
});

test('match flow: lobby -> plane -> jump -> loot -> ring -> last one standing', () => {
  const g = mk(0);
  const a = g.addPlayer({ name: 'A' }), b = g.addPlayer({ name: 'B' });
  assert.equal(g.phase, 'lobby');
  advance(g, 3);
  assert.equal(g.phase, 'plane');
  assert.ok(a.inPlane && b.inPlane && !a.alive);
  assert.ok(g.loot.size > 150, `loot generated (${g.loot.size})`);
  g.jump(a); assert.ok(!a.alive, 'cannot jump before the plane is over the island');
  toPlaneWindow(g);
  g.jump(a);
  assert.ok(a.alive && a.air === 1 && !a.inPlane);
  assert.deepEqual(a.weapons.map((w) => w?.id ?? null), [null, 'pistol']);
  // B never jumps: forced out at the end of the flight
  advance(g, 40);
  assert.ok(b.alive && !b.inPlane, 'forced exit');
  assert.equal(g.phase, 'live');
  // pick up a rifle: server checks distance and fills the primary slot
  ground(g, a, 0, 0);
  const rifle = [...g.loot.values()].find((it) => it.type === 'ar' || it.type === 'sniper');
  assert.equal(g.pickup(a, rifle.id), false, 'too far away');
  Object.assign(a, { x: rifle.x + 0.5, z: rifle.z, y: rifle.y });
  assert.equal(g.pickup(a, rifle.id), true);
  assert.equal(a.weapons[0].id, rifle.type); assert.equal(a.slot, 0);
  assert.ok(!g.loot.has(rifle.id));
  // armor soaks damage, med kit heals
  const armor = [...g.loot.values()].find((it) => it.type === 'armor');
  Object.assign(a, { x: armor.x, z: armor.z, y: armor.y });
  g.pickup(a, armor.id);
  assert.equal(a.armor, 50);
  g.damage(a, 40, b, 'ar');
  assert.equal(Math.round(a.hp), 84); assert.equal(Math.round(a.armor), 26);
  a.meds = 1; g.heal(a); advance(g, ROYALE.healTime + 0.2);
  assert.equal(a.meds, 0); assert.ok(a.hp > 99);
  // the ring hurts outside of it
  const rg = ringAt(g.ring, g.clock);
  ground(g, b, Math.max(-400, Math.min(400, rg.x + rg.r + 5)), rg.z);
  const hp0 = b.hp; g.ring.dmg = 5; advance(g, 2);
  if (Math.hypot(b.x - rg.x, b.z - rg.z) > ringAt(g.ring, g.clock).r) assert.ok(b.hp < hp0, 'ring damage');
  // B dies -> loot spills, A wins
  g.damage(b, 500, a, 'ar');
  assert.ok(!b.alive); assert.equal(b.place, 2);
  assert.ok([...g.loot.values()].some((it) => Math.hypot(it.x - b.x, it.z - b.z) < 3), 'death drop');
  advance(g, 0.2);
  assert.equal(g.phase, 'over'); assert.equal(g.roundOver.winner, a.id); assert.equal(a.place, 1);
  advance(g, ROYALE.endScreen + 1);
  assert.equal(g.phase, 'lobby', 'next match');
  assert.ok(!a.alive && a.weapons.every((w) => !w));
});

test('bots jump, land, loot and fight until one soldier is left', () => {
  const g = mk(10);
  g.addPlayer({ name: 'spectator' });
  let over = false;
  const human = [...g.players.values()].find((p) => !p.bot);
  advance(g, 3);
  toPlaneWindow(g); g.jump(human); human.alive = false; // human leaves the fight at once
  for (let t = 0; t < 900 && !over; t += 5) { advance(g, 5); over = g.phase === 'over'; }
  assert.ok(over, `match finished (phase ${g.phase}, alive ${g.aliveCount()})`);
  const bots = [...g.players.values()].filter((p) => p.bot);
  assert.ok(bots.some((p) => p.kills > 0), 'bots fought');
  const picks = bots.reduce((n, p) => n + (p.pickups || 0), 0);
  assert.ok(picks >= 2, `bots looted (${picks} pickups)`);
});
