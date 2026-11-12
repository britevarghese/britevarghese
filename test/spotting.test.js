import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SPOT_MS, SPOT_RECON_MS } from '../server/game.js';
import { EYE_HEIGHT } from '../shared/world.js';

const quiet = () => {};
const mkGame = (map = 'outskirts') => { const g = new Game({ botsPerTeam: 0, map, log: quiet }); g.clock = 1_000_000; return g; };
const advance = (g, ms) => { for (let t = 0; t < ms; t += 1000 / 30) { g.clock += 1000 / 30; g.tick(1 / 30); } };
const soldier = (g, team, cls = 'assault', name = 'P', bot = false) => { const p = g.addPlayer({ name, team, cls, bot }); if (bot) p.agent = true; p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0; return p; };
const at = (g, p, x, z) => Object.assign(p, { x, z, y: g.world.supportHeight(x, z, 500), vx: 0, vz: 0 });
// open ground with a clear sight line d metres along +x, away from both HQs
function openLine(g, d) {
  for (let k = 0; k < 4000; k++) {
    const x = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.2, z = (Math.random() - 0.5) * g.map.PLAY_HALF * 1.2;
    if (Math.abs(x + d) > g.map.PLAY_HALF - 10) continue;
    if ([1, 2].some((t) => [x, x + d].some((px) => Math.hypot(px - g.map.BASES[t].x, z - g.map.BASES[t].z) < g.restrictedHQ + 25))) continue;
    const y = g.world.supportHeight(x, z, 500), y2 = g.world.supportHeight(x + d, z, 500);
    if (Math.abs(y - y2) > 2) continue;
    if ([0.3, 0.9, 1.3, 1.6].every((h) => g.world.lineOfSight({ x, y: y + 1.6, z }, { x: x + d, y: y2 + h, z }))) return { x, z };
  }
  return null;
}
// the ray from p's eye straight at q
const ray = (p, q, dy = 1.3) => {
  const o = [p.x, p.y + EYE_HEIGHT[p.stance], p.z], d = [q.x - o[0], q.y + dy - o[1], q.z - o[2]];
  return [o, d];
};

test('Q marks the enemy under the crosshair for the whole team, for six seconds', () => {
  const g = mkGame();
  const L = openLine(g, 120); assert.ok(L, 'open ground');
  const p = at(g, soldier(g, 1), L.x, L.z), mate = soldier(g, 1, 'assault', 'Mate'), e = at(g, soldier(g, 2, 'assault', 'E'), L.x + 120, L.z);
  g.flushEvents();
  assert.equal(g.spot(p, ...ray(p, e)), e);
  assert.deepEqual(g.spottedFor(1), { p: [e.id], v: [] });
  assert.equal(g.spottedFor(2), undefined, 'not for his own side');
  assert.equal(g.flushEvents().map((x) => x.ev).find((x) => x.t === 'spot')?.ok, 1);
  advance(g, SPOT_MS - 500);
  assert.ok(g.spottedFor(1));
  advance(g, 1000);
  assert.equal(g.spottedFor(1), undefined, 'faded');
  void mate;
});

test('only what is in sight and near the crosshair; not twice a second', () => {
  const g = mkGame();
  const L = openLine(g, 100);
  const p = at(g, soldier(g, 1), L.x, L.z), e = at(g, soldier(g, 2), L.x + 100, L.z);
  // aimed 15 degrees off him: nothing
  const [o, d] = ray(p, e), a = 0.26;
  g.flushEvents();
  assert.equal(g.spot(p, o, [d[0] * Math.cos(a) - d[2] * Math.sin(a), d[1], d[0] * Math.sin(a) + d[2] * Math.cos(a)]), null);
  // (nothing spotted; a squad leader's ray that happens to fall on a flag gives an order instead — either way, nobody marked)
  assert.ok(!g.flushEvents().some((x) => x.ev.t === 'spot' && x.ev.ok), 'nothing spotted');
  assert.equal(g.spottedFor(1), undefined);
  // straight at him but too soon after the last try
  assert.equal(g.spot(p, o, d), null);
  advance(g, 800);
  assert.equal(g.spot(p, o, d), e);
  // behind a wall: no
  const g2 = mkGame('oldtown');
  let wall = null;
  for (let k = 0; k < 20000 && !wall; k++) {
    const x = (Math.random() - 0.5) * g2.map.PLAY_HALF, z = (Math.random() - 0.5) * g2.map.PLAY_HALF, y = g2.world.supportHeight(x, z, 500);
    if (Math.abs(y - g2.map.groundHeight(x, z)) > 0.1) continue;
    const h = g2.world.raycast({ x, y: y + 1.6, z }, { x: 1, y: 0, z: 0 }, 8, true);
    if (h?.box && h.t > 2 && h.box.max[1] > y + 3 && Math.abs(g2.world.supportHeight(x + h.t + 3, z, 500) - y) < 0.3) wall = { x, z, t: h.t };
  }
  assert.ok(wall, 'a wall');
  const p2 = at(g2, soldier(g2, 1), wall.x, wall.z), e2 = at(g2, soldier(g2, 2), wall.x + wall.t + 3, wall.z);
  assert.equal(g2.spot(p2, ...ray(p2, e2)), null);
});

test('a spotted vehicle is marked with its crew; recon spots further and longer', () => {
  const g = mkGame();
  const L = openLine(g, 140);
  const p = at(g, soldier(g, 1, 'recon'), L.x, L.z);
  const jeep = g.vehicles.list.find((v) => v.type === 'jeep' && v.team === 2);
  const drv = at(g, soldier(g, 2, 'assault', 'Driver'), jeep.x + 2, jeep.z); g.vehicles.enter(drv, jeep.id);
  Object.assign(jeep, { x: L.x + 140, z: L.z, y: g.world.supportHeight(L.x + 140, L.z, 500) });
  assert.equal(g.spot(p, [p.x, p.y + 1.6, p.z], [jeep.x - p.x, jeep.y + 1 - p.y - 1.6, jeep.z - p.z]), drv);
  const s = g.spottedFor(1);
  assert.deepEqual(s.v, [jeep.id]); assert.ok(s.p.includes(drv.id));
  assert.equal(jeep.spottedUntil, g.now() + SPOT_RECON_MS);
  // a rifleman's spot doesn't reach 400 m, a recon's does
  const g2 = mkGame('airfield');
  const L2 = openLine(g2, 400);
  if (L2) {
    const r = at(g2, soldier(g2, 1, 'assault'), L2.x, L2.z), rc = at(g2, soldier(g2, 1, 'recon', 'R'), L2.x, L2.z + 0.8), e = at(g2, soldier(g2, 2), L2.x + 400, L2.z);
    assert.equal(g2.spot(r, ...ray(r, e)), null);
    assert.equal(g2.spot(rc, ...ray(rc, e)), e);
  }
});

test('a kill on an enemy someone else spotted is a spot assist for the spotter', () => {
  const g = mkGame();
  const L = openLine(g, 80);
  const p = at(g, soldier(g, 1, 'assault', 'Spotter'), L.x, L.z), k = soldier(g, 1, 'assault', 'Killer'), e = at(g, soldier(g, 2), L.x + 80, L.z);
  g.spot(p, ...ray(p, e));
  const s0 = p.score;
  g.flushEvents();
  g.damage(e, 200, k, 'ar', true);
  assert.equal(p.score, s0 + 25);
  assert.equal(g.flushEvents().map((x) => x.ev).find((x) => x.t === 'score' && x.why === 'spot')?.pts, 25);
  assert.equal(g.spottedFor(1), undefined, 'the dead are no longer marked');
});

test('bots call out what they see', () => {
  const g = mkGame();
  const L = openLine(g, 60);
  const b = at(g, soldier(g, 1, 'assault', 'Bot', true), L.x, L.z); b.yaw = -Math.PI / 2; b.brain.skill = 1;
  const e = at(g, soldier(g, 2, 'assault', 'E'), L.x + 60, L.z);
  const r = Math.random; Math.random = () => 0.1;
  // (he gives himself away firing: the bot turns to the sound, sees him, and calls him out)
  try { for (let i = 0; i < 30 * 5 && !g.spottedFor(1); i++) { e.lastFireFlag = g.now(); g.clock += 1000 / 30; g.tick(1 / 30); e.hp = 100; at(g, e, L.x + 60, L.z); } } finally { Math.random = r; }
  assert.deepEqual(g.spottedFor(1)?.p, [e.id]);
});

test('battle royale has no spotting', async () => {
  const { RoyaleGame } = await import('../server/royale.js');
  const g = new RoyaleGame({ botsPerTeam: 0, log: quiet });
  const p = g.addPlayer({ name: 'P' });
  assert.equal(g.spottedFor(p.team), undefined);
});
