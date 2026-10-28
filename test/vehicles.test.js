import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { VEHICLES, stepTank, stepHeli, stepGround, heliAssist, rayVehicle, vehicleLoadout, groundCrashDamage, heliCrashDamage } from '../shared/vehicles.js';
import { getMap } from '../shared/map.js';
import { CollisionWorld } from '../shared/world.js';

const quiet = () => {};
const soldier = (g, team, name = 'P') => { const p = g.addPlayer({ name, team }); p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
// an empty test world: terrain from gh(x, z), plus the given boxes [[min], [max]]
const testWorld = (gh = () => 0, boxes = []) => {
  const w = new CollisionWorld(getMap('compound'));
  w.grid = new Map(); w.boxes = []; w.ramps = []; w.dynamic = [];
  w.map = { ...w.map, groundHeight: gh, PLAY_HALF: 1e4 };
  for (const [a, b] of boxes) w.addBox(a, b);
  return w;
};
// a ground vehicle heading +x
const car = (w, type, x = 0, speed = 0) => ({ id: 7, type, x, y: w.map.groundHeight(x, 0), z: 0, yaw: -Math.PI / 2, pitch: 0, roll: 0, speed, vy: 0, steer: 0, turretYaw: -Math.PI / 2, gunPitch: 0 });
const heliAt = (y) => ({ id: 8, type: 'heli', x: 0, y, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0 });
const fly = (w, s, keys, dt = 1 / 60) => stepHeli(w, s, heliAssist(s, keys, s.y - w.supportHeight(s.x, s.z, s.y + 0.5, 1.5)), dt);

test('loadouts: big maps get tanks + helicopters, small maps and royale none', () => {
  assert.deepEqual(vehicleLoadout(getMap('airfield')), ['tank', 'heli', 'jeep', 'bike', 'bike']);
  assert.deepEqual(vehicleLoadout(getMap('compound')), ['jeep', 'bike']);
  assert.deepEqual(vehicleLoadout(getMap('firestorm')), []);
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  assert.equal(g.vehicles.list.length, 10);
  for (const v of g.vehicles.list) assert.ok(Math.abs(v.y - g.map.groundHeight(v.x, v.z)) < 3, `${v.type} spawned on the ground`);
});

test('tank drives, turns and follows terrain; helicopter lifts off, flies and lands', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const tank = { ...g.vehicles.list.find((v) => v.type === 'tank') };
  const x0 = tank.x, z0 = tank.z;
  for (let i = 0; i < 120; i++) stepTank(g.world, tank, { throttle: 1, steer: 0, aimYaw: tank.yaw + 1, aimPitch: 0.1 }, 1 / 30);
  assert.ok(Math.hypot(tank.x - x0, tank.z - z0) > 5, 'moved');
  assert.ok(Math.abs(tank.y - g.map.groundHeight(tank.x, tank.z)) < 1.5, 'on the ground');
  const heli = { ...g.vehicles.list.find((v) => v.type === 'heli') };
  const y0 = heli.y;
  for (let i = 0; i < 90; i++) stepHeli(g.world, heli, { collective: 1 }, 1 / 30);
  assert.ok(heli.y > y0 + 15, `climbed to ${(heli.y - y0).toFixed(1)} m`);
  for (let i = 0; i < 150; i++) stepHeli(g.world, heli, heliAssist(heli, { pitch: 1 }, 30), 1 / 30);
  assert.ok(Math.hypot(heli.vx, heli.vz) > 18, `forward flight ${Math.hypot(heli.vx, heli.vz).toFixed(1)} m/s`);
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

test('jeep and bike: wheeled steering limited by grip, the bike leans into turns', () => {
  // flat, empty ground: this is about the vehicle dynamics, not the map
  const flat = { supportHeight: () => 0, resolveHorizontal: () => false, ignoreOwner: null };
  for (const type of ['jeep', 'bike']) {
    const v = { id: 1, type, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, speed: 0, steer: 0 };
    for (let i = 0; i < 150; i++) stepGround(flat, v, { throttle: 1 }, 1 / 30, type);
    assert.ok(v.speed > VEHICLES[type].maxSpeed * 0.8, `${type} reaches ${v.speed.toFixed(1)} m/s`);
    const yaw0 = v.yaw, v0 = v.speed;
    let maxLat = 0;
    for (let i = 0; i < 30; i++) { const y = v.yaw; stepGround(flat, v, { throttle: 1, steer: 1 }, 1 / 30, type); maxLat = Math.max(maxLat, Math.abs((v.yaw - y) * 30 * v.speed)); }
    // at the grip limit the yaw rate is grip / speed (0.8-0.9 g: ~0.3 rad/s at top speed)
    assert.ok(v.yaw > yaw0 + 0.8 * VEHICLES[type].grip / v0, `turns left ${(v.yaw - yaw0).toFixed(2)} rad in 1 s`);
    assert.ok(v.speed < v0 - 0.5, `tyre scrub costs speed in the turn (${v0.toFixed(1)} -> ${v.speed.toFixed(1)} m/s)`);
    assert.ok(maxLat <= VEHICLES[type].grip + 0.01, `lateral accel ${maxLat.toFixed(1)} within grip`);
    if (type === 'bike') assert.ok(v.roll < -0.3, `leans left ${v.roll.toFixed(2)}`);
    // a tighter turn at walking pace than at full speed (grip limit)
    const slow = { ...v, speed: 4, yaw: 0 };
    for (let i = 0; i < 30; i++) stepGround(flat, slow, { throttle: 0.15, steer: 1 }, 1 / 30, type);
    assert.ok(slow.yaw / 1 > 0.5, 'tight turn when slow');
  }
});

test('bike riders are exposed: visible and shootable; tank crews are not', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const rider = soldier(g, 1, 'Rider'), crew = soldier(g, 1, 'Crew'), shooter = soldier(g, 2, 'Shooter');
  const bike = g.vehicles.list.find((x) => x.type === 'bike' && x.team === 1);
  const tank = g.vehicles.list.find((x) => x.type === 'tank' && x.team === 1);
  Object.assign(rider, { x: bike.x + 1, z: bike.z, y: bike.y }); g.vehicles.enter(rider, bike.id);
  Object.assign(crew, { x: tank.x + 3, z: tank.z, y: tank.y }); g.vehicles.enter(crew, tank.id);
  tank.x += 120; // (out of the line of fire)
  g.tick(1 / 30);
  const snap = g.snapshot().p;
  assert.equal(snap.find((r) => r[0] === rider.id)[7] & 128, 0, 'rider drawn');
  assert.equal(snap.find((r) => r[0] === crew.id)[7] & 128, 128, 'crew hidden');
  assert.equal(rider.stance, 'crouch');
  // shoot the rider from 20 m
  Object.assign(shooter, { x: rider.x + 20, z: rider.z, y: g.world.supportHeight(rider.x + 20, rider.z, 500) });
  shooter.history = [];
  const eye = { x: shooter.x, y: shooter.y + 1.6, z: shooter.z }, tgt = { x: rider.x, y: rider.y + 0.9, z: rider.z };
  const L = Math.hypot(tgt.x - eye.x, tgt.y - eye.y, tgt.z - eye.z);
  let t = Date.now();
  for (let i = 0; i < 8 && rider.alive; i++) { g.clock = t; shooter.nextFire = 0; g.tryFire(shooter, [eye.x, eye.y, eye.z], [(tgt.x - eye.x) / L, (tgt.y - eye.y) / L, (tgt.z - eye.z) / L]); t += 200; g.clock = t; g.tick(1 / 30); }
  assert.ok(rider.hp < 100 || !rider.alive, `rider hit (${JSON.stringify(g.flushEvents().map((e) => e.ev).filter((e) => /shot|bhit|hurt|vhurt/.test(e.t)))})`);
  delete g.clock;
});

test('off the throttle a vehicle coasts on; the brakes stop it within a realistic distance', () => {
  const w = testWorld();
  for (const type of ['jeep', 'bike', 'tank']) {
    const run = (throttle) => {
      const s = car(w, type, 0, VEHICLES[type].maxSpeed);
      let t = 0;
      while (s.speed > 0.05 && t < 60) { stepGround(w, s, { throttle }, 1 / 60, type); t += 1 / 60; }
      return { t, d: s.x, g: VEHICLES[type].maxSpeed / t / 9.81 };
    };
    const coast = run(0), brake = run(-1);
    assert.ok(coast.g < 0.35, `${type} coasting decelerates gently (${coast.g.toFixed(2)} g)`);
    assert.ok(brake.g > 0.5 && brake.g < 1.0, `${type} brakes at ${brake.g.toFixed(2)} g`);
    assert.ok(coast.d > 1.8 * brake.d, `${type} coasts ${coast.d.toFixed(0)} m vs brakes in ${brake.d.toFixed(0)} m`);
  }
  // the jeep: ~280 m of coasting from 97 km/h, ~50 m of braking (0.76 g)
  const s = car(w, 'jeep', 0, 27);
  for (let i = 0; i < 120; i++) stepGround(w, s, {}, 1 / 60, 'jeep');
  assert.ok(s.speed > 23, `still rolling at ${(s.speed * 3.6).toFixed(0)} km/h after 2 s`);
});

test('driving off a cliff: airborne on a ballistic arc, a hard landing damages the vehicle', () => {
  const w = testWorld((x) => (x < 50 ? 15 : 0));
  for (const type of ['jeep', 'bike', 'tank']) {
    const s = car(w, type, 20, VEHICLES[type].maxSpeed);
    let t = 0, tEdge = null, drop2 = null, tLand = null, imp = 0;
    while (t < 8 && tLand === null) {
      stepGround(w, s, { throttle: 1 }, 1 / 60, type); t += 1 / 60; imp = Math.max(imp, s.impact);
      if (tEdge === null && s.x >= 50) tEdge = t;
      if (drop2 === null && s.x >= 52) drop2 = 15 - s.y;
      if (tEdge !== null && s.y < 0.01) tLand = t - tEdge;
    }
    const ballistic = 0.5 * 9.81 * (2 / VEHICLES[type].maxSpeed) ** 2;
    assert.ok(drop2 < ballistic + 0.1, `${type} 2 m past the edge has dropped ${drop2.toFixed(2)} m (ballistic ${ballistic.toFixed(2)})`);
    assert.ok(tLand > 1.5 && tLand < 1.9, `${type} falls 15 m in ${tLand?.toFixed(2)} s (free fall 1.75 s)`);
    assert.ok(groundCrashDamage(imp) > 100, `${type} hard landing: ${groundCrashDamage(imp).toFixed(0)} damage`);
  }
  // a 1 m drop is soaked up by the suspension
  const low = testWorld((x) => (x < 50 ? 1 : 0)), s = car(low, 'jeep', 20, 20);
  let imp = 0;
  for (let i = 0; i < 180; i++) { stepGround(low, s, { throttle: 0.7 }, 1 / 60, 'jeep'); imp = Math.max(imp, s.impact); }
  assert.equal(groundCrashDamage(imp), 0);
});

test('slopes: the hull stays on the ground, gravity slows the climb, too steep to climb -> it slides back', () => {
  const ramp = (deg) => { const tn = Math.tan(deg * Math.PI / 180); return testWorld((x) => Math.max(0, Math.min(40, (x - 30) * tn))); };
  // a 15° climb and descent at full speed: no sinking into / floating above the slope
  for (const [deg, dir] of [[15, 1], [15, -1]]) {
    const tn = Math.tan(deg * Math.PI / 180), w = testWorld((x) => (dir > 0 ? Math.max(0, (x - 20) * tn) : Math.max(0, (200 - x) * tn)));
    const s = car(w, 'jeep', 0, 27);
    if (dir < 0) s.vy = -27 * tn;
    let dev = 0;
    for (let i = 0; i < 240; i++) { stepGround(w, s, { throttle: 1 }, 1 / 60, 'jeep'); if (s.x > 40 && s.x < 190) dev = Math.max(dev, Math.abs(w.map.groundHeight(s.x, 0) - s.y)); }
    assert.ok(dev < 0.05, `${dir > 0 ? 'uphill' : 'downhill'} hull ${dev.toFixed(2)} m off the ground`);
  }
  for (const type of ['jeep', 'tank', 'bike']) {
    // 20°: climbable from a standstill, but slower than on the flat
    let w = ramp(20), s = car(w, type, 30.5, 0);
    for (let i = 0; i < 60 * 20 && s.y < 20; i++) stepGround(w, s, { throttle: 1 }, 1 / 60, type);
    assert.ok(s.y >= 20, `${type} climbs 20° (${s.y.toFixed(1)} m)`);
    if (type !== 'tank') assert.ok(s.speed < VEHICLES[type].maxSpeed * 0.95, `${type} slowed by the climb (${(s.speed * 3.6).toFixed(0)} km/h)`);
    // 40°: beyond the slope limit -> can't climb, slides back down (hull wholly on the slope)
    w = ramp(40); s = car(w, type, 36, 0); s.y = w.map.groundHeight(36, 0);
    const y0 = s.y;
    let maxY = s.y;
    for (let i = 0; i < 60 * 4; i++) { stepGround(w, s, { throttle: 1 }, 1 / 60, type); maxY = Math.max(maxY, s.y); }
    assert.ok(maxY < y0 + 0.5 && s.y < y0, `${type} can't climb 40° (start ${y0.toFixed(1)} m, max ${maxY.toFixed(1)}, now ${s.y.toFixed(1)})`);
  }
  // parked on a 15° slope off the throttle: hill hold
  const tn = Math.tan(15 * Math.PI / 180), w = testWorld((x) => x * tn), p = car(w, 'jeep', 10, 0);
  for (let i = 0; i < 120; i++) stepGround(w, p, {}, 1 / 60, 'jeep');
  assert.ok(Math.abs(p.x - 10) < 0.05, 'held on the slope');
});

test('kerbs are driven over, jersey barriers / barrels block the jeep and bike (the tank climbs them), walls stop the whole hull', () => {
  const across = (h, x = 30) => [[x, 0, -20], [x + 0.6, h, 20]];
  const through = (type, h, speed) => {
    const w = testWorld(() => 0, [across(h)]), s = car(w, type, 0, speed);
    let imp = 0;
    for (let i = 0; i < 60 * 6 && s.x < 45; i++) { stepGround(w, s, { throttle: speed / VEHICLES[type].maxSpeed }, 1 / 60, type); imp = Math.max(imp, s.impact); }
    return { ok: s.x >= 45, imp, s };
  };
  for (const type of ['jeep', 'bike', 'tank']) assert.ok(through(type, 0.2, 10).ok, `${type} over a 0.2 m kerb`);
  for (const h of [0.82, 0.88]) {
    for (const type of ['jeep', 'bike']) {
      const r = through(type, h, VEHICLES[type].maxSpeed);
      assert.ok(!r.ok, `${type} stopped by a ${h} m obstacle`);
      assert.ok(r.imp > 20 && groundCrashDamage(r.imp) > 0, `${type} crash at ${r.imp.toFixed(0)} m/s`);
      assert.ok(r.s.speed < 6, `${type} lost its speed (${r.s.speed.toFixed(1)} m/s)`);
    }
    assert.ok(through('tank', h, 13).ok, `tank climbs a ${h} m obstacle`);
  }
  assert.ok(!through('bike', 1.05, 10).ok, 'the bike no longer climbs sandbags');
  // tank nosed into a 0.3 m wall: the front of the hull stays outside it
  const w = testWorld(() => 0, [[[30, 0, -20], [30.3, 4, 20]]]), t = car(w, 'tank', 0, 13);
  for (let i = 0; i < 300; i++) stepGround(w, t, { throttle: 1 }, 1 / 60, 'tank');
  assert.ok(t.x + VEHICLES.tank.half[2] <= 30.05, `tank hull front ${(t.x + VEHICLES.tank.half[2] - 30).toFixed(2)} m into the wall`);
  // a glancing scrape along a wall keeps most of the speed and swings the jeep along it
  const g2 = testWorld(() => 0, [[[-50, 0, -3], [200, 3, -2]]]), j = car(g2, 'jeep', 0, 25);
  j.yaw = -Math.PI / 2 - 0.25; // 14° toward the wall (at z = -2)
  for (let i = 0; i < 90; i++) stepGround(g2, j, { throttle: 1 }, 1 / 60, 'jeep');
  assert.ok(j.speed > 15 && groundCrashDamage(j.impact) === 0, `scraped along at ${(j.speed * 3.6).toFixed(0)} km/h`);
});

test('helicopter: holding descend lands gently, diagonal flight is no faster than straight, the rotor strikes walls', () => {
  const w = testWorld();
  for (const h0 of [8, 40]) {
    const s = heliAt(h0);
    let imp = 0;
    for (let i = 0; i < 60 * 30 && !s.landed; i++) { fly(w, s, { down: true }); imp = Math.max(imp, s.impact); }
    assert.ok(s.landed, 'landed');
    assert.ok(imp < 3 && heliCrashDamage(imp) === 0, `touchdown from ${h0} m at impact ${imp.toFixed(1)}`);
  }
  const top = (keys) => { const s = heliAt(300); for (let i = 0; i < 60 * 80; i++) { fly(w, s, keys); if (s.y > 800) s.y = 300; } return Math.hypot(s.vx, s.vz); };
  const straight = top({ pitch: 1 }), diag = top({ pitch: 1, roll: 1 }), climb = top({ pitch: 1, roll: 1, up: true });
  const max = VEHICLES.heli.maxSpeed;
  assert.ok(Math.abs(straight - max) < 0.06 * max, `straight ${(straight * 3.6).toFixed(0)} km/h ≈ configured ${(max * 3.6).toFixed(0)}`);
  assert.ok(diag < straight * 1.03 && climb < max * 1.05, `diagonal ${(diag * 3.6).toFixed(0)}, climbing diagonal ${(climb * 3.6).toFixed(0)} km/h`);
  // drifting at 4 m/s toward a tall wall: the rotor disc (7.3 m) hits it before the fuselage does
  const ww = testWorld(() => 0, [[[20, 0, -30], [21, 20, 30]]]), s = heliAt(5);
  s.yaw = -Math.PI / 2; s.vx = 4;
  let imp = 0, gap = 1e9;
  for (let i = 0; i < 240; i++) { fly(ww, s, {}); imp = Math.max(imp, s.impact); gap = Math.min(gap, 20 - s.x); }
  assert.ok(heliCrashDamage(imp) > 0, `rotor strike damage ${heliCrashDamage(imp).toFixed(0)}`);
  assert.ok(gap > VEHICLES.heli.rotor - 0.5 && s.vx < 0, `kicked away from the wall (closest ${gap.toFixed(1)} m)`);
});

test('getting out keeps the vehicle moving: it coasts on (server-simulated), the soldier bails out with momentum and gets hurt', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  g.world = testWorld(); // (this game only: flat and empty, so the jeep rolls out undisturbed)
  const p = soldier(g, 1);
  const v = g.vehicles.list.find((x) => x.type === 'jeep' && x.team === 1);
  Object.assign(v, { x: 0, z: 0, yaw: -Math.PI / 2, y: 0 });
  Object.assign(p, { x: v.x + 2, z: v.z, y: v.y });
  g.vehicles.enter(p, v.id);
  assert.equal(v.seats[0], p.id);
  let t = Date.now(); g.clock = t; v.lastInput = t - 33;
  g.vehicles.input(p, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, sp: 22, vy: 0 });
  const x0 = v.x, z0 = v.z;
  g.vehicles.exit(p);
  assert.equal(p.vehicle, null);
  assert.ok(Math.abs(v.speed - 22) < 1e-9, 'the vehicle keeps its speed');
  assert.ok(Math.hypot(p.vx, p.vz) > 5, `the soldier carries momentum (${Math.hypot(p.vx, p.vz).toFixed(1)} m/s)`);
  assert.ok(p.hp < 100 && p.hp > 0, `bailing out at 79 km/h hurts (hp ${p.hp})`);
  assert.ok(g.flushEvents().some((e) => e.ev.t === 'vexit' && e.ev.vx !== undefined));
  for (let i = 0; i < 30; i++) { t += 1000 / 30; g.clock = t; g.tick(1 / 30); }
  const d = Math.hypot(v.x - x0, v.z - z0);
  assert.ok(d > 15 && v.speed > 18 && v.speed < 22, `rolled ${d.toFixed(1)} m in 1 s, now ${v.speed.toFixed(1)} m/s`);
  for (let i = 0; i < 30 * 30 && !v.rest; i++) { t += 1000 / 30; g.clock = t; g.tick(1 / 30); }
  assert.ok(v.rest && v.speed === 0, 'comes to rest by itself');
  // the snapshot carries its velocity for whoever takes over
  assert.equal(g.vehicles.snapshot().find((r) => r[0] === v.id).length, 19);
  delete g.clock;
});

test('driver updates: bursty arrival is accepted (no rubber-banding), teleports are refused', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const p = soldier(g, 1);
  const v = g.vehicles.list.find((x) => x.type === 'heli' && x.team === 1);
  Object.assign(p, { x: v.x + 2, z: v.z, y: v.y });
  g.vehicles.enter(p, v.id);
  g.flushEvents();
  // 62 m/s, sent every 33 ms but arriving in pairs (2 ms / 64 ms gaps) plus a 250 ms stall and its burst
  let t = Date.now(), x = v.x;
  g.clock = t; v.lastInput = t;
  for (let i = 0; i < 120; i++) {
    t += i % 40 === 20 ? 250 : i % 40 > 20 && i % 40 < 28 ? 1 : i % 2 ? 2 : 64; g.clock = t;
    x += 62 / 30;
    g.vehicles.input(p, { x, y: v.y, z: v.z, yaw: v.yaw, vx: 62, vy: 0, vz: 0 });
  }
  assert.ok(!g.flushEvents().some((e) => e.ev.t === 'vcorrect'), 'no corrections');
  assert.ok(Math.abs(v.x - x) < 1e-6, 'followed the driver');
  t += 33; g.clock = t;
  g.vehicles.input(p, { x: x + 200, y: v.y, z: v.z, yaw: v.yaw });
  assert.ok(g.flushEvents().some((e) => e.ev.t === 'vcorrect'), 'teleport refused');
  delete g.clock;
});

test('run-overs kill enemies but spare teammates (no friendly fire)', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const driver = soldier(g, 1, 'Driver'), mate = soldier(g, 1, 'Mate'), enemy = soldier(g, 2, 'Enemy');
  const v = g.vehicles.list.find((x) => x.type === 'jeep' && x.team === 1);
  Object.assign(driver, { x: v.x + 2, z: v.z, y: v.y });
  g.vehicles.enter(driver, v.id);
  v.speed = 15;
  for (const q of [mate, enemy]) { Object.assign(q, { x: v.x, y: v.y, z: v.z, history: [] }); q.spawnProtect = 0; }
  g.vehicles.tick(1 / 30, g.now());
  assert.ok(mate.alive, 'teammate spared');
  assert.ok(!enemy.alive, 'enemy run over');
  assert.equal(driver.kills, 1);
});

test('a tank shell fired with the barrel poking through a wall bursts at the wall', () => {
  const g = new Game({ botsPerTeam: 0, map: 'airfield', log: quiet });
  const gunner = soldier(g, 1, 'Gunner');
  const tank = g.vehicles.list.find((x) => x.type === 'tank' && x.team === 1);
  Object.assign(gunner, { x: tank.x + 3, z: tank.z, y: tank.y }); g.vehicles.enter(gunner, tank.id);
  // a thin building wall piece (x- or z-facing) at gun height, with open, level ground in front of it; the tank's
  // hull stops 0.5 m short of it, its muzzle (7.2 m ahead of the hull centre) is 3 m beyond the wall face
  let spot = null;
  for (const b of g.world.boxes) {
    for (const a of [0, 2]) {
      const o = 2 - a, thick = b.max[a] - b.min[a], wide = b.max[o] - b.min[o];
      if (thick > 0.6 || wide < 2 || spot) continue;
      const c = (b.min[o] + b.max[o]) / 2, face = b.min[a], at = (u, w) => (a === 0 ? [u, w] : [w, u]);
      const [x, z] = at(face - 4.2, c), gy = g.map.groundHeight(x, z), [fx2, fz2] = at(face - 0.2, c);
      if (Math.abs(gy - g.map.groundHeight(fx2, fz2)) > 0.3 || b.min[1] > gy + 1.2 || b.max[1] < gy + 2.8) continue;
      const [x0, z0] = at(face - 8.5, c - 2.5), [x1, z1] = at(face - 0.05, c + 2.5);
      if (g.world.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)).some((q) => q !== b && q.max[1] > gy + 0.3 && q.min[1] < gy + 3.5 && q.max[a] < face + 0.01)) continue;
      spot = { x, z, y: gy, a, wall: face, yaw: a === 0 ? -Math.PI / 2 : Math.PI };
    }
    if (spot) break;
  }
  assert.ok(spot, 'found a wall');
  Object.assign(tank, { x: spot.x, z: spot.z, y: spot.y, yaw: spot.yaw, turretYaw: spot.yaw, gunPitch: 0 });
  g.flushEvents();
  g.vehicles.fire(gunner, {});
  const shot = g.flushEvents().map((e) => e.ev).find((e) => e.t === 'shot' && e.w === 'tank_cannon');
  assert.ok(shot, 'fired');
  assert.ok(shot.o[spot.a] < spot.wall && shot.e[spot.a] < spot.wall + 0.2, `shell from ${shot.o[spot.a].toFixed(1)} burst at ${shot.e[spot.a].toFixed(1)} (wall face ${spot.wall.toFixed(1)})`);
});
