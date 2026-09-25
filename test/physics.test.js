import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { CollisionWorld, stepCharacter, findVault, MOVE, EYE_HEIGHT } from '../shared/world.js';
import { groundHeight } from '../shared/map.js';
import { WEAPONS } from '../shared/weapons.js';
import { bulletPath, zeroAngle, GRAVITY } from '../shared/ballistics.js';

const world = new CollisionWorld();
const open = { raycast: () => null };
const mkGame = () => { const g = new Game({ botsPerTeam: 0, log: () => {} }); g.clock = 1_000_000; return g; };
const advance = (g, secs) => { for (let i = 0; i < Math.round(secs * 30); i++) { g.clock += 1000 / 30; g.tick(1 / 30); } };

test('jump height and air time are real-world and frame-rate independent', () => {
  const heights = [];
  for (const fps of [24, 30, 60, 144]) {
    const s = { x: 40, z: 40, y: groundHeight(40, 40), vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
    for (let i = 0; i < fps; i++) stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / fps);
    const y0 = s.y; let peak = y0;
    stepCharacter(world, s, { fx: 0, fz: 0, jump: true }, 1 / fps);
    for (let i = 0; i < fps * 2 && !s.onGround; i++) { peak = Math.max(peak, s.y); stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / fps); }
    heights.push(peak - y0);
  }
  const ideal = (MOVE.jump * MOVE.jump) / (2 * MOVE.gravity);
  for (const h of heights) assert.ok(Math.abs(h - ideal) < 0.01, `jump height ${h.toFixed(3)} vs ${ideal.toFixed(3)}`);
  assert.equal(MOVE.gravity, 9.81);
});

test('momentum is kept in the air and chained jumps lose height', () => {
  const s = { x: 40, z: 40, y: groundHeight(40, 40), vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' };
  for (let i = 0; i < 60; i++) stepCharacter(world, s, { fx: 1, fz: 0, sprint: true }, 1 / 60);
  const v0 = s.vx;
  stepCharacter(world, s, { fx: 1, fz: 0, sprint: true, jump: true }, 1 / 60);
  for (let i = 0; i < 10; i++) stepCharacter(world, s, { fx: -1, fz: 0 }, 1 / 60); // pull back mid-air
  assert.ok(s.vx > v0 * 0.8, `air control too strong: ${s.vx.toFixed(2)} of ${v0.toFixed(2)}`);
  // bunny hop: land and immediately jump again -> lower
  const jumpPeak = () => { const y0 = s.y; let p = y0; stepCharacter(world, s, { fx: 0, fz: 0, jump: true }, 1 / 60); for (let i = 0; i < 120 && !s.onGround; i++) { p = Math.max(p, s.y); stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / 60); } for (let i = 0; i < 8; i++) stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / 60); return p - y0; };
  while (!s.onGround) stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / 60);
  for (let i = 0; i < 120; i++) stepCharacter(world, s, { fx: 0, fz: 0 }, 1 / 60);
  const h1 = jumpPeak(), h2 = jumpPeak(), h3 = jumpPeak();
  assert.ok(h2 < h1 && h3 < h2, `fatigue ${h1.toFixed(2)} ${h2.toFixed(2)} ${h3.toFixed(2)}`);
});

test('falls: 2 m is harmless, 6 m hurts, 11 m kills (server-side)', () => {
  const g = mkGame();
  const p = g.addPlayer({ name: 'P', team: 1 });
  p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0;
  const x = p.x, z = p.z, gy = groundHeight(x, z);
  const fall = (h) => {
    g.clock += 100; g.handleInput(p, { x, z, y: gy + h, og: false, st: 'stand' });
    g.clock += 100; g.handleInput(p, { x, z, y: gy, og: true, st: 'stand' });
  };
  fall(2); assert.equal(p.hp, 100);
  fall(6); assert.ok(p.hp < 100 && p.hp > 30, `hp ${p.hp}`);
  fall(11); assert.ok(!p.alive, 'lethal fall');
});

test('bullets drop and slow down; zeroed sights cross the line of sight at the zero distance', () => {
  for (const id of ['ar', 'sniper', 'pistol']) {
    const def = WEAPONS[id], z = def.zero[0], a = zeroAngle(def, z);
    const { pts } = bulletPath(open, { x: 0, y: 0, z: 0 }, { x: Math.cos(a), y: Math.sin(a), z: 0 }, def);
    const yAt = (D) => { for (let i = 1; i < pts.length; i++) if (pts[i].x >= D) { const p = pts[i - 1], q = pts[i], k = (D - p.x) / (q.x - p.x); return p.y + (q.y - p.y) * k; } return null; };
    assert.ok(Math.abs(yAt(z)) < 0.02, `${id}: ${yAt(z)} m off at the ${z} m zero`);
    const far = Math.min(def.maxRange * 0.8, 300);
    assert.ok(yAt(far) < -0.1, `${id} drops at ${far} m`);
    // slower than vacuum because of drag, and max range respected
    const last = pts[pts.length - 1];
    assert.ok(last.d <= def.maxRange + 60);
    const t300 = pts.find((p) => p.x >= Math.min(300, def.maxRange * 0.9)).t;
    assert.ok(t300 > Math.min(300, def.maxRange * 0.9) / def.velocity);
  }
  // drop matches free fall for a fast, low-drag bullet over a short time
  const def = { ...WEAPONS.sniper, drag: 0 };
  const { pts } = bulletPath(open, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, def);
  const p = pts[6];
  assert.ok(Math.abs(p.y + 0.5 * GRAVITY * p.t * p.t) < 1e-6);
});

test('bullets take time to fly: a far target is hit only after the travel time', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  a.respawnAt = v.respawnAt = 0; g.spawn(a, 'base'); g.spawn(v, 'base');
  // find a clear 140 m line on the map
  let found = null;
  for (let x = -150; x <= 150 && !found; x += 6) for (let z = -150; z <= 10 && !found; z += 6) {
    const e = { x, y: groundHeight(x, z) + 1.64, z }, t = { x, y: groundHeight(x, z + 140) + 1.3, z: z + 140 };
    if (Math.abs(groundHeight(x, z) - groundHeight(x, z + 140)) < 3 && [-0.5, 0, 0.5].every((o) => world.lineOfSight({ ...e, y: e.y + o }, { ...t, y: t.y + o }))) found = { x, z };
  }
  assert.ok(found, 'no clear line found');
  Object.assign(a, { x: found.x, z: found.z, y: groundHeight(found.x, found.z), spawnProtect: 0, history: [] });
  Object.assign(v, { x: found.x, z: found.z + 140, y: groundHeight(found.x, found.z + 140), spawnProtect: 0, history: [] });
  a.weapons[0] = { id: 'sniper', mag: 5, reserve: 10 };
  const eye = [a.x, a.y + EYE_HEIGHT.stand, a.z];
  const tgt = [v.x, v.y + 1.1, v.z];
  const d = tgt.map((c, i) => c - eye[i]), L = Math.hypot(...d);
  const up = zeroAngle(WEAPONS.sniper, 100);
  const dir = [d[0] / L, d[1] / L + up, d[2] / L];
  g.tryFire(a, eye, dir);
  assert.equal(v.hp, 100, 'not hit instantly at 140 m');
  advance(g, 0.3);
  assert.ok(v.hp < 100, `hit after the flight (${v.hp})`);
});

test('hit markers go only to the human shooter (never broadcast for bots)', () => {
  const g = mkGame();
  const bot = g.addPlayer({ name: 'B', team: 1, bot: true }), v = g.addPlayer({ name: 'V', team: 2 });
  bot.respawnAt = v.respawnAt = 0; g.spawn(bot, 'base'); g.spawn(v, 'base');
  Object.assign(bot, { x: -60, z: 30, y: groundHeight(-60, 30), spawnProtect: 0 });
  Object.assign(v, { x: -60, z: 10, y: groundHeight(-60, 10), spawnProtect: 0 });
  g.flushEvents();
  const eye = [bot.x, bot.y + EYE_HEIGHT.stand, bot.z], t = [v.x, v.y + 1.1, v.z];
  const d = t.map((c, i) => c - eye[i]), L = Math.hypot(...d);
  g.tryFire(bot, eye, d.map((c) => c / L));
  const evs = g.flushEvents();
  assert.ok(v.hp < 100, 'bot hit the target');
  assert.ok(!evs.some((e) => e.ev.t === 'hitmark'), 'no hit marker event for a bot shooter');
});

test('lag compensation uses the moment the shooter was looking at', () => {
  const g = mkGame();
  const a = g.addPlayer({ name: 'A', team: 1 }), v = g.addPlayer({ name: 'V', team: 2 });
  a.respawnAt = v.respawnAt = 0; g.spawn(a, 'base'); g.spawn(v, 'base');
  Object.assign(a, { x: -60, z: 30, y: groundHeight(-60, 30), spawnProtect: 0 });
  // V ran across A's line of fire: 300 ms ago V was right in front, now V is 3 m to the side
  const now = g.clock, vy = groundHeight(-60, 10);
  v.history = [{ t: now - 300, x: -60, y: vy, z: 10, yaw: 0, stance: 'stand' }, { t: now - 250, x: -60, y: vy, z: 10, yaw: 0, stance: 'stand' }, { t: now, x: -57, y: vy, z: 10, yaw: 0, stance: 'stand' }];
  Object.assign(v, { x: -57, z: 10, y: vy, spawnProtect: 0 });
  const eye = [a.x, a.y + EYE_HEIGHT.stand, a.z], t = [-60, vy + 1.1, 10];
  const d = t.map((c, i) => c - eye[i]), L = Math.hypot(...d);
  g.tryFire(a, eye, d.map((c) => c / L), now, now - 280);
  assert.ok(v.hp < 100, 'hit where the shooter saw the target');
});

// a pane on an upper floor and the unit vector pointing out of the building through it
function upperWindow(w, minFloor = 1) {
  for (const p of w.glass) {
    const b = w.buildings.find((g) => p.id.startsWith(`${g.id}:`));
    if (!b || b.spec.style !== 'concrete' && b.spec.style !== 'plaster' && b.spec.style !== 'brick') continue;
    const floor = Math.floor((p.min[1] - b.y0) / b.FH);
    if (floor < minFloor) continue;
    const out = p.n[0] ? [Math.sign(p.c[0] - b.spec.x), 0] : [0, Math.sign(p.c[2] - b.spec.z)];
    // clear ground outside (no neighbouring building right under the window)
    const gx = p.c[0] + out[0] * 3, gz = p.c[2] + out[1] * 3;
    if (w.supportHeight(gx, gz, p.min[1]) > groundHeight(gx, gz) + 0.3) continue;
    return { p, b, out, floor };
  }
}

test('vault out of an upper-floor window: climb the sill, drop outside, fall damage by height', () => {
  const g = mkGame();
  const win = upperWindow(g.world, 1);
  assert.ok(win, 'found an upper-floor window');
  const { p, out, floor } = win;
  const floorY = p.min[1] - 0.95; // sill height above the floor
  const s = { x: p.c[0] - out[0] * 0.9, z: p.c[2] - out[1] * 0.9, y: floorY, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand', groundT: 1 };
  s.y = g.world.supportHeight(s.x, s.z, floorY + 0.3);
  // jump while pushing toward the window
  let vaulted = false, peak = s.y, landed = 0;
  for (let i = 0; i < 30 * 6; i++) {
    stepCharacter(g.world, s, { fx: out[0], fz: out[1], jump: i === 0 }, 1 / 30);
    if (s.vault || s.vaulted) vaulted = true;
    peak = Math.max(peak, s.y);
    if (s.landed) landed = Math.max(landed, s.landed);
    if (s.onGround && i > 20) break;
  }
  assert.ok(vaulted, 'vaulted through the window');
  assert.ok((s.x - p.c[0]) * out[0] + (s.z - p.c[2]) * out[1] > 0.3, 'ended up outside');
  const h = peak - s.y;
  assert.ok(h > floor * 3.2 - 1, `fell about ${floor} floor(s): ${h.toFixed(1)} m`);
  assert.ok(landed > 5, `hit the ground at ${landed.toFixed(1)} m/s`);
});

test('a wall (no opening) is not vaultable, a roof parapet is', () => {
  const g = mkGame();
  const b = g.world.buildings.find((x) => x.spec.floors >= 2 && x.spec.style !== 'warehouse' && x.spec.style !== 'bunker');
  const roofY = b.y0 + b.spec.floors * b.FH;
  // standing on the roof, next to the north parapet, facing out (-z)
  const s = { x: b.spec.x, z: b.spec.z - b.spec.d / 2 + 0.3 + 0.45, y: roofY, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand', groundT: 1 };
  s.y = g.world.supportHeight(s.x, s.z, roofY + 0.3);
  const v = findVault(g.world, s, 0, -1);
  assert.ok(v, 'parapet vault found');
  // ground floor, next to a solid wall section facing it: too high
  const w = { x: b.spec.x, z: b.spec.z, y: b.y0 + 0.12, stance: 'stand' };
  w.x = b.spec.x - b.spec.w / 2 + 0.3 + 0.45;
  const hit = findVault(g.world, w, -1, 0);
  assert.ok(!hit || hit.top - w.y <= 1.3, 'never climbs a full wall');
});

test('fall damage by height: 1 floor harmless, 2 floors hurt, 3 floors kill (server-side, walking off an edge)', () => {
  for (const [floors, expect] of [[1, (hp) => hp === 100], [2, (hp) => hp > 20 && hp < 80], [3, (hp) => hp <= 0]]) {
    const g = mkGame();
    const p = g.addPlayer({ name: 'P', team: 1 });
    p.respawnAt = 0; g.spawn(p, 'base'); p.spawnProtect = 0;
    const gy = p.y, h = floors * 3.2;
    // client-predicted fall: airborne samples from the edge down to the ground
    let y = gy + h;
    g.clock += 33; g.handleInput(p, { x: p.x, y, z: p.z, yaw: 0, pitch: 0, st: 'stand', og: true, sl: 0 });
    let vy = 0;
    while (y > gy) { vy -= 9.81 / 30; y = Math.max(gy, y + vy / 30); g.clock += 33; g.handleInput(p, { x: p.x, y, z: p.z, yaw: 0, pitch: 0, st: 'stand', og: y <= gy, sl: 0 }); }
    assert.ok(expect(p.alive ? p.hp : 0), `${floors} floor(s): hp ${Math.round(p.hp)}`);
  }
});

test('window glass: bullets, bodies and blasts shatter it (once), and it is repaired for the next round', () => {
  const g = mkGame();
  const win = upperWindow(g.world, 0);
  const { p: pane, out } = win;
  const shooter = g.addPlayer({ name: 'S', team: 1 });
  shooter.respawnAt = 0; g.spawn(shooter, 'base'); shooter.spawnProtect = 0;
  // stand 15 m outside the window, shoot through it
  const o = { x: pane.c[0] + out[0] * 15, y: pane.c[1], z: pane.c[2] + out[1] * 15 };
  Object.assign(shooter, { x: o.x, z: o.z, y: o.y - 1.64, stance: 'stand' });
  g.flushEvents();
  g.tryFire(shooter, [o.x, o.y, o.z], [-out[0], 0, -out[1]]);
  for (let i = 0; i < 10; i++) { g.clock += 1000 / 30; g.tick(1 / 30); }
  const ev = g.flushEvents().map((e) => e.ev);
  assert.ok(ev.some((e) => e.t === 'glass' && e.id === pane.id), 'shot shattered the pane');
  assert.ok(g.glassBroken.has(pane.id));
  g.tryFire(shooter, [o.x, o.y, o.z], [-out[0], 0, -out[1]]);
  for (let i = 0; i < 10; i++) { g.clock += 1000 / 30; g.tick(1 / 30); }
  assert.ok(!g.flushEvents().some((e) => e.ev.t === 'glass' && e.ev.id === pane.id), 'breaks only once');
  // a grenade next to other windows breaks the panes around it
  const other = g.world.glass.find((q) => !g.glassBroken.has(q.id));
  g.grenades.push({ id: 999, owner: shooter.id, team: 1, x: other.c[0], y: other.c[1], z: other.c[2], vx: 0, vy: 0, vz: 0, fuse: 0.01 });
  g.clock += 34; g.tick(1 / 30);
  assert.ok(g.glassBroken.has(other.id), 'blast shattered a nearby pane');
  g.resetRound();
  assert.equal(g.glassBroken.size, 0, 'repaired for the next round');
});

test('climbing through a closed window smashes the glass (server sees the body cross the pane)', () => {
  const g = mkGame();
  const { p: pane, out } = upperWindow(g.world, 0);
  const pl = g.addPlayer({ name: 'P', team: 1 });
  pl.respawnAt = 0; g.spawn(pl, 'base'); pl.spawnProtect = 0;
  const floorY = pane.min[1] - 0.95;
  Object.assign(pl, { x: pane.c[0] - out[0] * 0.8, z: pane.c[2] - out[1] * 0.8, y: floorY });
  for (let k = 1; k <= 8; k++) {
    g.clock += 60;
    g.handleInput(pl, { x: pane.c[0] - out[0] * 0.8 + out[0] * 0.2 * k, y: floorY + (k > 2 ? 0.97 : 0.4 * k), z: pane.c[2] - out[1] * 0.8 + out[1] * 0.2 * k, yaw: 0, pitch: 0, st: 'crouch', og: false, sl: 0 });
  }
  assert.ok(g.glassBroken.has(pane.id), 'pane smashed');
});
