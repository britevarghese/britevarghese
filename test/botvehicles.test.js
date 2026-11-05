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
// an open stretch: a spot where the hull fits and a clear sight line `d` metres away
function lane(g, d) {
  for (let k = 0; k < 2000; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.4, z = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.4, a = Math.random() * 6.28;
    const x2 = x + Math.sin(a) * d, z2 = z + Math.cos(a) * d;
    if (Math.abs(x2) > g.map.PLAY_HALF - 10 || Math.abs(z2) > g.map.PLAY_HALF - 10 || !vehicleRoute(g, 'tank', x, z, x + 1, z)) continue;
    const y = g.world.supportHeight(x, z, 500), y2 = g.world.supportHeight(x2, z2, 500);
    if (g.world.lineOfSight({ x, y: y + 3.1, z }, { x: x2, y: y2 + 1.2, z: z2 }) && g.world.lineOfSight({ x, y: y + 3.1, z }, { x: x2, y: y2 + 0.5, z: z2 })) return { x, z, x2, z2 };
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
