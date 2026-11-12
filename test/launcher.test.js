import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { WEAPONS, CLASSES, armourAspect } from '../shared/weapons.js';
import { VEHICLES } from '../shared/vehicles.js';
import { bulletPath } from '../shared/ballistics.js';

const quiet = () => {};
const mkGame = (map = 'airfield') => { const g = new Game({ botsPerTeam: 0, map, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, secs) => { for (let i = 0; i < Math.round(secs * 30); i++) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const soldier = (g, team, cls = 'support', name = 'P') => { const p = g.addPlayer({ name, team, cls }); p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
const at = (g, o, x, z) => Object.assign(o, { x, z, y: g.world.supportHeight(x, z, 500) });
// an open spot with a clear line from (x, z) to a point d metres away along +x
function openLine(g, d) {
  for (let k = 0; k < 3000; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.2, z = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.2;
    const y = g.world.supportHeight(x, z, 500), y2 = g.world.supportHeight(x + d, z, 500);
    if (Math.abs(y - y2) > 1.5) continue;
    const ok = [0.5, 1, 1.5, 2].every((h) => g.world.lineOfSight({ x, y: y + 1.6, z }, { x: x + d, y: y2 + h, z }));
    if (ok && g.world.query(x + d - 5, z - 5, x + d + 5, z + 5, []).every((b) => b.max[1] < y2 + 0.3)) return { x, z, y };
  }
  return null;
}
// fire the launcher from p straight at a world point (aim corrected for the drop)
const fireAt = (g, p, tx, ty, tz) => {
  const eye = [p.x, p.y + 1.64, p.z], dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2], d = Math.hypot(dx, dz);
  const drop = (9.81 * (d / WEAPONS.at4.velocity) ** 2) / 2;
  const L = Math.hypot(dx, dy + drop, dz);
  p.slot = 2; p.weapons[2].mag = 1; p.nextFire = 0; p.reloadUntil = 0;
  return g.tryFire(p, eye, [dx / L, (dy + drop) / L, dz / L]);
};

test('support soldiers carry the anti-armour launcher: one round in the tube, two spare', () => {
  const g = mkGame();
  const p = soldier(g, 1, 'support');
  assert.equal(CLASSES.support.gadget, 'at4');
  assert.deepEqual(p.weapons.map((w) => w.id), ['lmg', 'pistol', 'at4']);
  assert.equal(p.weapons[2].mag, 1);
  assert.equal(p.weapons[2].reserve, 2);
  // other classes don't
  assert.equal(soldier(g, 1, 'assault').weapons.length, 2);
  // slot 3 is selectable, a slot nobody has is not
  g.handleInput(p, { x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, st: 'stand', sl: 2 });
  assert.equal(p.slot, 2);
  g.handleInput(p, { x: p.x, y: p.y, z: p.z, yaw: 0, pitch: 0, st: 'stand', sl: 5 });
  assert.equal(p.slot, 2);
});

test('the round drops like a real recoilless round: ~2.3 m at 200 m, flies ~0.7 s', () => {
  const NO = { raycast: () => null };
  const { pts } = bulletPath(NO, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, WEAPONS.at4);
  const j = pts.findIndex((q) => q.x >= 200), q = pts[j];
  assert.ok(q.y < -2 && q.y > -2.7, `drop at 200 m ${q.y.toFixed(2)} m`);
  assert.ok(q.t > 0.65 && q.t < 0.75, `${q.t.toFixed(2)} s`);
});

test('a rocket destroys a jeep in one hit; a tank takes four on the glacis, two up the back', () => {
  const g = mkGame();
  const p = soldier(g, 1);
  const L = openLine(g, 60);
  assert.ok(L, 'found an open line');
  at(g, p, L.x, L.z);
  // enemy jeep, crewed (an empty vehicle of the other side is fair game too, but crewed is the real case)
  const jeep = g.vehicles.list.find((v) => v.type === 'jeep' && v.team === 2);
  const driver = soldier(g, 2, 'assault', 'Driver');
  at(g, driver, jeep.x + 3, jeep.z); g.vehicles.enter(driver, jeep.id);
  at(g, jeep, L.x + 60, L.z); jeep.yaw = 0; jeep.speed = 0;
  advance(g, 0.1);
  assert.ok(fireAt(g, p, jeep.x, jeep.y + 1, jeep.z));
  advance(g, 1);
  assert.ok(jeep.dead, `jeep hp ${jeep.hp}`);
  // tank: nose toward the shooter (forward = -x: yaw +90°), then tail toward him
  for (const [yaw, hits] of [[Math.PI / 2, 4], [-Math.PI / 2, 2]]) {
    const g2 = mkGame();
    const s = soldier(g2, 1);
    const L2 = openLine(g2, 80);
    at(g2, s, L2.x, L2.z);
    const tank = g2.vehicles.list.find((v) => v.type === 'tank' && v.team === 2);
    const crew = soldier(g2, 2, 'assault', 'Crew');
    at(g2, crew, tank.x + 3, tank.z); g2.vehicles.enter(crew, tank.id);
    at(g2, tank, L2.x + 80, L2.z); tank.yaw = yaw; tank.speed = 0;
    let n = 0;
    while (!tank.dead && n < 8) { advance(g2, 0.1); assert.ok(fireAt(g2, s, tank.x, tank.y + 1.2, tank.z)); advance(g2, 1); n++; }
    assert.equal(n, hits, `${yaw > 0 ? 'front' : 'rear'}: ${n} rockets (hp ${tank.hp.toFixed(0)})`);
  }
  assert.equal(armourAspect({ type: 'jeep', yaw: 0 }, { x: 1, z: 0 }), 1);
});

test('the fuze arms 10 m out: a round fired into a wall at point blank does not blow up its shooter', () => {
  const g = mkGame();
  const p = soldier(g, 1);
  // a wall 3-6 m in front (looking +z) of an open spot
  let wall = null;
  for (let k = 0; k < 20000 && !wall; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.6, z = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.6, y = g.world.supportHeight(x, z, 500);
    if (Math.abs(y - g.map.groundHeight(x, z)) > 0.2) continue;
    const h = g.world.raycast({ x, y: y + 1.6, z }, { x: 0, y: 0, z: 1 }, 6, true);
    if (h && h.box && h.t > 3 && Math.abs(h.normal[2] + 1) < 0.01 && h.box.max[1] > y + 2.5) wall = { x, z, hz: h.point[2] };
  }
  assert.ok(wall, 'a wall');
  at(g, p, wall.x, wall.z);
  p.hp = 100;
  assert.ok(fireAt(g, p, wall.x, p.y + 1.6, wall.hz));
  advance(g, 1);
  assert.equal(p.hp, 100, 'unhurt');
  const booms = g.flushEvents().filter((e) => e.ev.t === 'boom');
  assert.equal(booms.length, 0, 'no blast');
});

test('a support bot takes on an enemy vehicle with the launcher', () => {
  const g = mkGame();
  const b = g.addPlayer({ name: 'AT', team: 1, bot: true, cls: 'support' }); b.agent = true; b.respawnAt = 0; g.spawn(b, 'base'); b.spawnProtect = 0;
  const L = openLine(g, 80);
  assert.ok(L, 'found an open line');
  at(g, b, L.x, L.z); b.yaw = -Math.PI / 2; b.brain.skill = 0.8;
  const jeep = g.vehicles.list.find((v) => v.type === 'jeep' && v.team === 2);
  const driver = soldier(g, 2, 'assault', 'Driver');
  at(g, driver, jeep.x + 3, jeep.z); g.vehicles.enter(driver, jeep.id);
  at(g, jeep, L.x + 80, L.z); jeep.yaw = 0; jeep.speed = 0;
  let fired = 0;
  for (let i = 0; i < 30 * 15 && !jeep.dead; i++) {
    g.clock += 1000 / 30; g.tick(1 / 30);
    jeep.lastInput = g.now(); // (the driver is idle at the wheel)
    for (const { ev } of g.flushEvents()) if (ev.t === 'shot' && ev.w === 'at4' && ev.id === b.id) fired++;
  }
  assert.ok(fired >= 1, 'fired the launcher');
  assert.ok(jeep.dead, `jeep destroyed (hp ${jeep.hp.toFixed(0)}, ${fired} rockets)`);
  // and back on the rifle once the target is gone
  advance(g, 5);
  assert.equal(b.slot, 0);
});
