import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { VEHICLES, stepTank, stepHeli, rayVehicle, vehicleLoadout } from '../shared/vehicles.js';
import { getMap } from '../shared/map.js';

const quiet = () => {};
const soldier = (g, team, name = 'P') => { const p = g.addPlayer({ name, team }); p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };

test('loadouts: big maps get tanks + helicopters, small maps and royale none', () => {
  assert.deepEqual(vehicleLoadout(getMap('airfield')), ['tank', 'heli']);
  assert.deepEqual(vehicleLoadout(getMap('compound')), []);
  assert.deepEqual(vehicleLoadout(getMap('firestorm')), []);
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  assert.equal(g.vehicles.list.length, 4);
  for (const v of g.vehicles.list) assert.ok(Math.abs(v.y - g.map.groundHeight(v.x, v.z)) < 3, `${v.type} spawned on the ground`);
});

test('tank drives, turns and follows terrain; helicopter lifts off, flies and lands', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const tank = { ...g.vehicles.list.find((v) => v.type === 'tank') };
  const x0 = tank.x, z0 = tank.z;
  for (let i = 0; i < 60; i++) stepTank(g.world, tank, { throttle: 1, steer: 0, aimYaw: tank.yaw + 1, aimPitch: 0.1 }, 1 / 30);
  assert.ok(Math.hypot(tank.x - x0, tank.z - z0) > 5, 'moved');
  assert.ok(Math.abs(tank.y - g.map.groundHeight(tank.x, tank.z)) < 1.5, 'on the ground');
  const heli = { ...g.vehicles.list.find((v) => v.type === 'heli') };
  const y0 = heli.y;
  for (let i = 0; i < 90; i++) stepHeli(g.world, heli, { collective: 1 }, 1 / 30);
  assert.ok(heli.y > y0 + 15, `climbed to ${(heli.y - y0).toFixed(1)} m`);
  for (let i = 0; i < 150; i++) stepHeli(g.world, heli, { collective: 0, pitch: 1 }, 1 / 30);
  assert.ok(Math.hypot(heli.vx, heli.vz) > 25, 'forward flight');
  for (let i = 0; i < 600 && !heli.landed; i++) stepHeli(g.world, heli, { collective: -0.3, pitch: -0.2 }, 1 / 30);
  assert.ok(heli.landed, 'landed');
});

test('enter, drive (validated), switch seat, exit', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const p = soldier(g, 1), mate = soldier(g, 1, 'Mate');
  const v = g.vehicles.list.find((x) => x.type === 'tank' && x.team === 1);
  Object.assign(p, { x: v.x + 3, z: v.z, y: v.y });
  g.vehicles.enter(p, v.id);
  assert.equal(p.vehicle, v.id); assert.equal(v.seats[0], p.id);
  Object.assign(mate, { x: v.x - 3, z: v.z, y: v.y });
  g.vehicles.enter(mate, v.id);
  assert.equal(v.seats[1], mate.id);
  // driver input moves the tank; a teleport is refused
  g.clock = Date.now(); v.lastInput = g.clock - 100;
  g.vehicles.input(p, { x: v.x + 1, y: v.y, z: v.z, yaw: v.yaw, sp: 10, ty: 0, gp: 0 });
  assert.ok(Math.abs(v.speed - 10) < 1e-9);
  const xb = v.x; g.clock += 100;
  g.vehicles.input(p, { x: v.x + 80, y: v.y, z: v.z, yaw: v.yaw });
  assert.equal(v.x, xb);
  assert.ok(g.flushEvents().some((e) => e.ev.t === 'vcorrect'));
  g.tick(1 / 30);
  assert.ok(Math.hypot(p.x - v.x, p.z - v.z) < 3, 'occupant rides along');
  assert.equal(g.snapshot().p.find((r) => r[0] === p.id)[7] & 128, 128);
  g.vehicles.exit(mate);
  assert.equal(mate.vehicle, null); assert.equal(v.seats[1], null);
  assert.ok(Math.hypot(mate.x - v.x, mate.z - v.z) > 2, 'stepped out beside the hull');
  g.vehicles.switchSeat(p, 1);
  assert.equal(v.seats[1], p.id); assert.equal(v.seats[0], null);
  delete g.clock;
});

test('tank shell destroys an enemy tank (crediting the gunner), rifles barely scratch armour', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const gunner = soldier(g, 1, 'Gunner'), enemy = soldier(g, 2, 'Enemy');
  const mine = g.vehicles.list.find((x) => x.type === 'tank' && x.team === 1);
  const theirs = g.vehicles.list.find((x) => x.type === 'tank' && x.team === 2);
  Object.assign(gunner, { x: mine.x + 3, z: mine.z, y: mine.y }); g.vehicles.enter(gunner, mine.id);
  Object.assign(enemy, { x: theirs.x + 3, z: theirs.z, y: theirs.y }); g.vehicles.enter(enemy, theirs.id);
  // park both tanks 120 m apart with a clear line of fire
  const at = (v, x, z) => Object.assign(v, { x, z, y: g.world.supportHeight(x, z, 500) });
  let lane = false;
  for (let k = 0; k < 400 && !lane; k++) {
    const x = (Math.random() - 0.5) * 300, z = (Math.random() - 0.5) * 300, a = Math.random() * 6.28;
    at(mine, x, z); at(theirs, x + Math.sin(a) * 120, z + Math.cos(a) * 120);
    lane = g.world.lineOfSight({ x: mine.x, y: mine.y + 2.4, z: mine.z }, { x: theirs.x, y: theirs.y + 1.2, z: theirs.z }) && g.world.lineOfSight({ x: mine.x, y: mine.y + 2.4, z: mine.z }, { x: theirs.x, y: theirs.y + 0.6, z: theirs.z });
  }
  assert.ok(lane, 'found a firing lane');
  g.tick(1 / 30);
  // rifle fire: armour takes ~nothing
  const hp0 = theirs.hp;
  g.vehicles.damage(theirs, 30, gunner, 'ak', 'bullet');
  assert.ok(hp0 - theirs.hp < 1);
  let t = Date.now(); g.clock = t;
  for (let shot = 0; shot < 6 && !theirs.dead; shot++) {
    // aim the gun straight at the enemy hull
    const dx = theirs.x - mine.x, dz = theirs.z - mine.z, dy = theirs.y + 1.2 - (mine.y + 2.3);
    mine.turretYaw = Math.atan2(-dx, -dz); mine.gunPitch = Math.atan2(dy, Math.hypot(dx, dz)) + 0.004;
    g.vehicles.fire(gunner, {});
    for (let i = 0; i < 20; i++) { t += 1000 / 30; g.clock = t; g.tick(1 / 30); }
    t += 5000; g.clock = t;
  }
  assert.ok(theirs.dead, `enemy tank destroyed (hp ${theirs.hp})`);
  assert.equal(enemy.alive, false, 'crew killed');
  assert.ok(gunner.kills >= 1 && gunner.score >= 300);
  const ev = g.flushEvents().map((e) => e.ev);
  assert.ok(ev.some((e) => e.t === 'vboom' && e.v === theirs.id));
  assert.ok(ev.some((e) => e.t === 'kill' && e.v === enemy.id && e.k === gunner.id));
  // respawns at its base later
  t += 26000; g.clock = t; g.tick(1 / 30);
  assert.equal(theirs.dead, false); assert.equal(theirs.hp, VEHICLES.tank.hp);
  delete g.clock;
});

test('ray vs rotated vehicle box', () => {
  const v = { type: 'tank', x: 0, y: 0, z: 0, yaw: Math.PI / 4, pitch: 0 };
  assert.ok(rayVehicle({ x: -20, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, v, 50) !== null);
  assert.equal(rayVehicle({ x: -20, y: 4, z: 0 }, { x: 1, y: 0, z: 0 }, v, 50), null);
  assert.equal(rayVehicle({ x: -20, y: 1, z: 6 }, { x: 1, y: 0, z: 0 }, v, 50), null);
});
