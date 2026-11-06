import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { vehicleRoute } from '../server/botvehicles.js';
import { VEHICLES } from '../shared/vehicles.js';

const quiet = () => {};
const mkGame = (map = 'outskirts') => { const g = new Game({ botsPerTeam: 0, map, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, secs, until = () => false) => { for (let i = 0; i < Math.round(secs * 30); i++) { g.clock += 1000 / 30; g.tick(1 / 30); if (until()) return true; } return false; };
// (agent: kept out of the bot balancing, which would remove extra bots from a game set to none)
const bot = (g, team, name) => { const p = g.addPlayer({ name, team, bot: true, cls: 'assault' }); p.agent = true; p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
const human = (g, team, name) => { const p = g.addPlayer({ name, team }); p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
const place = (g, p, x, z) => Object.assign(p, { x, z, y: g.world.supportHeight(x, z, 500), vx: 0, vz: 0 });
// a bot that decides now to take vehicle v (the dice that make only some bots go for vehicles: loaded)
const sendFor = (g, p, v) => {
  v.idleSince = g.now() - 60000; p.brain.nextVehicleTry = 0;
  const r = Math.random; Math.random = () => 0.05;
  try { p.brain.pickGoal(); } finally { Math.random = r; }
  assert.equal(p.brain.goal?.vehicle, v.id, 'bot heads for the vehicle');
};
// an open stretch: a spot where the hull fits and a clear sight line `d` metres away (several sight lines, so a
// small settle of the hull doesn't close it)
function lane(g, d) {
  for (let k = 0; k < 2000; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.4, z = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.4, a = Math.random() * 6.28;
    const x2 = x + Math.sin(a) * d, z2 = z + Math.cos(a) * d;
    if (Math.abs(x2) > g.map.PLAY_HALF - 10 || Math.abs(z2) > g.map.PLAY_HALF - 10) continue;
    const gy = g.map.groundHeight(x, z);
    if (g.world.query(x - 4.5, z - 4.5, x + 4.5, z + 4.5, []).some((b) => b.max[1] > gy + 0.4 && b.min[1] < gy + 3.5)) continue;
    const y = g.world.supportHeight(x, z, 500), y2 = g.world.supportHeight(x2, z2, 500);
    const sees = (ox, oz) => g.world.lineOfSight({ x: x + ox, y: y + 3.1, z: z + oz }, { x: x2, y: y2 + 1.2, z: z2 }) && g.world.lineOfSight({ x: x + ox, y: y + 3.1, z: z + oz }, { x: x2, y: y2 + 0.5, z: z2 });
    if (sees(0, 0) && sees(1.5, 0) && sees(-1.5, 0) && sees(0, 1.5) && sees(0, -1.5)) return { x, z, x2, z2 };
  }
  return null;
}

test('vehicle routes: every motor-pool tank / jeep reaches every flag on a route wide enough for its hull', () => {
  for (const map of ['outskirts', 'oldtown', 'ridge']) {
    const g = mkGame(map);
    for (const v of g.vehicles.list.filter((x) => x.type === 'tank' || x.type === 'jeep')) {
      for (const f of g.flags) {
        const r = vehicleRoute(g, v.type, v.x, v.z, f.x, f.z);
        assert.ok(r && r.length >= 2, `${map}: ${v.type} ${v.team} -> ${f.id}`);
        assert.ok(Math.hypot(r.at(-1).x - f.x, r.at(-1).z - f.z) < 16, `${map}: ends at the flag`);
        // along every leg nothing solid within the hull's half-width (walls, props, trees at body height)
        const hw = VEHICLES[v.type].half[0];
        for (let i = 1; i < r.length; i++) {
          const a = r[i - 1], b = r[i], L = Math.hypot(b.x - a.x, b.z - a.z);
          for (let s = 0; s <= L; s += 1) {
            const x = a.x + ((b.x - a.x) * s) / (L || 1), z = a.z + ((b.z - a.z) * s) / (L || 1), gy = g.map.groundHeight(x, z);
            const hit = g.world.query(x - hw, z - hw, x + hw, z + hw, []).find((bx) => bx.max[0] > x - hw && bx.min[0] < x + hw && bx.max[2] > z - hw && bx.min[2] < z + hw && bx.max[1] > gy + 1 && bx.min[1] < gy + 1.8);
            assert.ok(!hit, `${map}: ${v.type} route clips ${hit?.tag || 'a box'} at ${x.toFixed(0)}, ${z.toFixed(0)}`);
          }
        }
      }
    }
  }
});

test('a bot takes a tank left standing in the motor pool and drives it to an objective', () => {
  const g = mkGame('outskirts');
  const tank = g.vehicles.list.find((v) => v.type === 'tank' && v.team === 1);
  const p = bot(g, 1, 'Crew');
  place(g, p, tank.x + 8, tank.z);
  sendFor(g, p, tank);
  assert.ok(advance(g, 20, () => p.vehicle === tank.id), 'got in');
  assert.equal(p.seat, 0);
  const start = { x: tank.x, z: tank.z };
  advance(g, 45);
  const c = p.brain.crew;
  assert.ok(c?.goal && c.route, 'has an objective and a route');
  assert.ok(Math.hypot(tank.x - start.x, tank.z - start.z) > 60, `drove ${Math.hypot(tank.x - start.x, tank.z - start.z).toFixed(0)} m`);
  assert.ok(c.stuck.length <= 1, `got stuck ${c.stuck.length} times`);
  assert.ok(tank.hp > VEHICLES.tank.hp * 0.95, 'no crashes on the way');
});

test('a players\' vehicle is left alone at first: bots only take one that has stood unused for a while', () => {
  const g = mkGame('outskirts');
  const tank = g.vehicles.list.find((v) => v.type === 'tank' && v.team === 1);
  const p = bot(g, 1, 'Crew');
  place(g, p, tank.x + 8, tank.z);
  advance(g, 1);
  p.brain.nextVehicleTry = 0;
  const r = Math.random; Math.random = () => 0.05;
  try { p.brain.pickGoal(); } finally { Math.random = r; }
  assert.notEqual(p.brain.goal?.vehicle, tank.id);
  // nor while a player on the team is standing by it
  const h = human(g, 1, 'Player');
  place(g, h, tank.x - 10, tank.z);
  tank.idleSince = g.now() - 60000; p.brain.nextVehicleTry = 0;
  Math.random = () => 0.05;
  try { p.brain.pickGoal(); } finally { Math.random = r; }
  assert.notEqual(p.brain.goal?.vehicle, tank.id, 'left to the player next to it');
  place(g, h, tank.x - 80, tank.z);
  sendFor(g, p, tank);
});

test('the tank crew spots an enemy in the open, lays the gun and fires; enemy infantry gets out of its sight', () => {
  const g = mkGame('outskirts');
  const tank = g.vehicles.list.find((v) => v.type === 'tank' && v.team === 1);
  const p = bot(g, 1, 'Crew');
  place(g, p, tank.x + 8, tank.z);
  sendFor(g, p, tank);
  assert.ok(advance(g, 20, () => p.vehicle === tank.id));
  const L = lane(g, 110);
  assert.ok(L, 'found an open lane');
  Object.assign(tank, { x: L.x, z: L.z, y: g.world.supportHeight(L.x, L.z, 500), speed: 0, yaw: Math.atan2(-(L.x2 - L.x), -(L.z2 - L.z)) });
  tank.turretYaw = tank.yaw;
  p.brain.crew.goal = { x: L.x, z: L.z, flag: g.flags[0].id }; p.brain.crew.route = null; p.brain.crew.repathAt = g.now() + 1e6; p.brain.crew.retryAt = g.now() + 1e6;
  const e = human(g, 2, 'Target');
  place(g, e, L.x2, L.z2);
  let fired = false;
  const keep = () => { place(g, e, L.x2, L.z2); e.hp = Math.max(e.hp, 1); for (const { ev } of g.flushEvents()) if (ev.t === 'shot' && ev.w === 'tank_cannon') fired = true; return fired; };
  assert.ok(advance(g, 15, keep), 'the tank fired at the soldier');
  // an enemy bot in the same spot, turret on him: he goes for cover (or flat on the ground)
  const s = bot(g, 2, 'Rifleman');
  place(g, s, L.x2, L.z2); s.yaw = Math.atan2(-(L.x - L.x2), -(L.z - L.z2)); s.brain.mode = 'patrol';
  tank.turretYaw = tank.yaw;
  const hid = advance(g, 3, () => s.brain.mode === 'cover' || s.stance === 'prone' || !s.alive);
  assert.ok(hid, `rifleman ${s.brain.mode} / ${s.stance}`);
});

test('crews bail out of a vehicle about to brew up and carry on on foot', () => {
  const g = mkGame('outskirts');
  const tank = g.vehicles.list.find((v) => v.type === 'tank' && v.team === 1);
  const p = bot(g, 1, 'Crew');
  place(g, p, tank.x + 8, tank.z);
  sendFor(g, p, tank);
  assert.ok(advance(g, 20, () => p.vehicle === tank.id));
  tank.hp = VEHICLES.tank.hp * 0.2;
  assert.ok(advance(g, 1, () => !p.vehicle), 'got out');
  assert.ok(p.alive);
  advance(g, 2);
  assert.ok(p.brain.goal && !p.brain.goal.vehicle, 'heads for an objective on foot, not back into the wreck');
  // and nobody else climbs into it
  const q = bot(g, 1, 'Other');
  place(g, q, tank.x + 6, tank.z + 2);
  tank.idleSince = g.now() - 60000; q.brain.nextVehicleTry = 0;
  const r = Math.random; Math.random = () => 0.05;
  try { q.brain.pickGoal(); } finally { Math.random = r; }
  assert.notEqual(q.brain.goal?.vehicle, tank.id);
});

test('a jeep driver calls a teammate up to the .50 cal and waits for him', () => {
  const g = mkGame('outskirts');
  const jeep = g.vehicles.list.find((v) => v.type === 'jeep' && v.team === 1);
  const d = bot(g, 1, 'Driver'), m = bot(g, 1, 'Gunner');
  place(g, d, jeep.x + 6, jeep.z); place(g, m, jeep.x - 12, jeep.z + 6);
  sendFor(g, d, jeep);
  assert.ok(advance(g, 20, () => d.vehicle === jeep.id), 'driver got in');
  assert.equal(m.brain.goal?.vehicle, jeep.id, 'teammate called to the gun');
  assert.ok(advance(g, 15, () => m.vehicle === jeep.id), 'gunner got in');
  assert.equal(m.seat, 1);
  const at = { x: jeep.x, z: jeep.z };
  advance(g, 20);
  assert.ok(Math.hypot(jeep.x - at.x, jeep.z - at.z) > 40, 'then they drive off');
});

test('a bot rides a dirt bike to a far objective and gets off at its edge to go in on foot', () => {
  const g = mkGame('outskirts');
  const bike = g.vehicles.list.find((v) => v.type === 'bike' && v.team === 1);
  const p = bot(g, 1, 'Rider');
  place(g, p, bike.x + 5, bike.z);
  sendFor(g, p, bike);
  assert.ok(advance(g, 20, () => p.vehicle === bike.id), 'got on');
  const start = { x: bike.x, z: bike.z };
  assert.ok(advance(g, 70, () => !p.vehicle), 'got off again');
  assert.ok(p.alive);
  assert.ok(Math.hypot(bike.x - start.x, bike.z - start.z) > 80, `rode ${Math.hypot(bike.x - start.x, bike.z - start.z).toFixed(0)} m`);
  const f = g.flags.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a));
  assert.ok(Math.hypot(f.x - p.x, f.z - p.z) < f.r + 30, `off ${Math.hypot(f.x - p.x, f.z - p.z).toFixed(0)} m from flag ${f.id}`);
  assert.ok(p.brain.goal && !p.brain.goal.vehicle, 'heading in on foot');
});

// a skilled bot at the controls of its team's helicopter on Kestrel, airborne
function pilot(seconds = 15) {
  const g = mkGame('airfield');
  const heli = g.vehicles.list.find((v) => v.type === 'heli' && v.team === 1);
  const p = bot(g, 1, 'Pilot');
  p.brain.skill = 0.85;
  place(g, p, heli.x + 7, heli.z);
  sendFor(g, p, heli);
  assert.ok(advance(g, 20, () => p.vehicle === heli.id), 'got in');
  advance(g, seconds);
  return { g, heli, p };
}
const agl = (g, v) => v.y - g.world.supportHeight(v.x, v.z, v.y + 0.5, 1.5);

test('a bot pilot takes off, flies to the objective at a safe height and holds it there', () => {
  const { g, heli, p } = pilot(8);
  assert.ok(agl(g, heli) > 15, `climbed out (${agl(g, heli).toFixed(0)} m)`);
  const c = p.brain.crew, d0 = Math.hypot(c.goal.x - heli.x, c.goal.z - heli.z);
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 30 * 30; i++) { g.clock += 1000 / 30; g.tick(1 / 30); const h = agl(g, heli); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  assert.ok(Math.hypot(c.goal.x - heli.x, c.goal.z - heli.z) < Math.max(140, d0 - 100), 'got to the objective');
  assert.ok(lo > 18 && hi < 90, `height ${lo.toFixed(0)}-${hi.toFixed(0)} m above what is below`);
  assert.equal(heli.hp, VEHICLES.heli.hp, 'no strikes / crashes');
  // never over the enemy HQ
  const eb = g.map.BASES[2];
  assert.ok(Math.hypot(heli.x - eb.x, heli.z - eb.z) > g.restrictedHQ);
});

test('a badly hit helicopter is flown home and landed on its pad; the pilot gets out unhurt', () => {
  const { g, heli, p } = pilot(25);
  heli.hp = VEHICLES.heli.hp * 0.3;
  const hp = heli.hp;
  assert.ok(advance(g, 90, () => !p.vehicle), 'landed and got out');
  assert.ok(p.alive && !heli.dead);
  assert.ok(Math.hypot(heli.home.x - heli.x, heli.home.z - heli.z) < 4, 'on the pad');
  assert.equal(heli.hp, hp, 'a soft landing');
});

test('the helicopter makes rocket runs on an enemy tank in the open', () => {
  const { g, heli, p } = pilot(12);
  const tank = g.vehicles.list.find((v) => v.type === 'tank' && v.team === 2);
  const crew = human(g, 2, 'Crew');
  place(g, crew, tank.x + 3, tank.z); g.vehicles.enter(crew, tank.id);
  const eb = g.map.BASES[2];
  let spot = null;
  for (let k = 0; k < 3000 && !spot; k++) {
    const a = heli.yaw + (Math.random() - 0.5) * 1.6, d = 200 + Math.random() * 140;
    const x = heli.x - Math.sin(a) * d, z = heli.z - Math.cos(a) * d;
    if (Math.abs(x) > g.map.PLAY_HALF - 30 || Math.abs(z) > g.map.PLAY_HALF - 30 || Math.hypot(x - eb.x, z - eb.z) < g.restrictedHQ + 40) continue;
    const y = g.world.supportHeight(x, z, 500);
    if (Math.abs(y - g.map.groundHeight(x, z)) > 0.3 || !g.world.lineOfSight({ x: heli.x, y: heli.y + 1.6, z: heli.z }, { x, y: y + 1.5, z })) continue;
    spot = { x, z, y };
  }
  assert.ok(spot, 'found open ground ahead');
  Object.assign(tank, spot, { speed: 0 });
  let rockets = 0;
  const hp0 = tank.hp;
  for (let i = 0; i < 30 * 45 && !tank.dead; i++) {
    g.clock += 1000 / 30; g.tick(1 / 30); tank.lastInput = g.now();
    for (const { ev } of g.flushEvents()) if (ev.t === 'shot' && ev.w === 'heli_rockets' && ev.id === p.id) rockets++;
  }
  assert.ok(rockets >= 4, `${rockets} rockets`);
  assert.ok(tank.hp < hp0, `tank hit (hp ${tank.hp.toFixed(0)})`);
  assert.ok(!heli.dead && heli.hp > VEHICLES.heli.hp * 0.9, 'no self-inflicted damage');
});
