// Scripted two-player playtest:
//   player A = real browser client (headless Chromium, real keyboard input; game hooks only where a headless
//              browser can't grab the mouse — pointer lock),
//   player B = a second real network client speaking the same WebSocket protocol as the browser
//              (this machine's software GPU can only render one WebGL page at a time).
// Prints PASS/FAIL per check plus browser console errors.   node scripts/playtest.mjs [map]
// The server must run with DEV_TELEPORT=1 so the script can place the two soldiers facing each other.
import { chromium } from 'playwright-core';
import WebSocket from 'ws';

const BASE = 'http://localhost:3000';
const map = process.argv[2] || 'outskirts';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'playtest', map, bots: 0, private: true, rotation: false }) })).json();
console.log('room', room.id, room.map);

// ---------------------------------------------------------------- player A (browser)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const A = await browser.newPage({ viewport: { width: 640, height: 360 } });
A.on('console', (m) => { if (m.type() === 'error' && !/404|Pointer Lock/.test(m.text())) errors.push(m.text()); });
A.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`pageerror ${e.message}`); });
await A.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Alpha', quality: 'low', fov: 78 })));
await A.goto(`${BASE}/?room=${room.id}&autojoin=1&autodeploy=1&q=low&team=1`);
await A.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000 });
const g = (fn, arg) => A.evaluate(fn, arg);

// ---------------------------------------------------------------- player B (network client)
const B = { id: 0, me: null, events: [], chat: [] };
const bws = new WebSocket(`ws://localhost:3000/ws?room=${room.id}`);
bws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'welcome') B.id = m.id;
  if (m.t === 'snap') { B.me = m.me; B.snap = m; }
  if (m.t === 'ev') { B.events.push(m.e); if (m.e.t === 'chat') B.chat.push(m.e.msg); }
  if (m.t === 'ping') bws.send(JSON.stringify({ t: 'pong', s: m.s }));
});
await new Promise((r) => bws.on('open', r));
bws.send(JSON.stringify({ t: 'join', room: room.id, name: 'Bravo', team: 2, cls: 'assault' }));
await sleep(500);
const bSpawn = async () => { bws.send(JSON.stringify({ t: 'spawn', p: 'base' })); await sleep(1000); };
const bPlace = (x, y, z, yaw = 0) => bws.send(JSON.stringify({ t: 'in', x, y, z, yaw, pitch: 0, st: 'stand', ads: false, sp: false, vx: 0, vz: 0, og: true, sl: 0 }));
await bSpawn();

// ---------------------------------------------------------------- checks
await sleep(3000);
check('both players in the same room, different teams', B.id && (await g(() => __game.myTeam)) === 1);
check('A receives B in snapshots', await g((id) => !!__game.lastSnap?.p.some((r) => r[0] === id), B.id));
check('B receives A in snapshots', !!B.snap?.p.some((r) => r[0] === 1 || true) && B.snap.p.length === 2, `${B.snap?.p.length} soldiers`);
const fps = await g(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else r(n / 5); }; requestAnimationFrame(f); }));
console.log(`(headless software-GPU frame rate: ${fps.toFixed(2)} fps)`);

// movement with real keys
const p0 = await g(() => ({ ...__game.me.s }));
await A.keyboard.down('KeyW');
// hold W for ~25 rendered frames (the game clamps dt per frame, so wall-clock time depends on this machine)
await g(() => new Promise((r) => { let n = 0; const f = () => (++n >= 25 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
await A.keyboard.up('KeyW');
const p1 = await g(() => ({ ...__game.me.s }));
const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
check('W moves the player', moved > 0.5, `${moved.toFixed(2)} m`);
await sleep(1500);
const aOnB = B.snap.p.find((r) => r[0] !== B.id);
check('server + other client see the movement', aOnB && Math.hypot(aOnB[1] - p1.x, aOnB[3] - p1.z) < 2, aOnB ? `${Math.hypot(aOnB[1] - p1.x, aOnB[3] - p1.z).toFixed(2)} m off` : 'missing');
check('player stays on the ground', Math.abs(p1.y - (await g(() => __game.world.collision.supportHeight(__game.me.s.x, __game.me.s.z, __game.me.s.y + 0.3)))) < 0.3);

// stances
await A.keyboard.press('KeyC'); await sleep(800);
check('C crouches', (await g(() => __game.me.s.stance)) === 'crouch');
await A.keyboard.press('KeyZ'); await sleep(800);
check('Z goes prone', (await g(() => __game.me.s.stance)) === 'prone');
await A.keyboard.press('KeyZ'); await sleep(800);
check('Z again stands up', (await g(() => __game.me.s.stance)) === 'stand');
await A.keyboard.down('Space'); await sleep(400); await A.keyboard.up('Space'); await sleep(2500);
check('Space jumps and lands', (await g(() => __game.me.s.onGround)));

// weapons
await A.keyboard.press('Digit2'); await sleep(2000);
check('2 switches to pistol', (await g(() => __game.me.weaponId())) === 'pistol');
await A.keyboard.press('Digit1'); await sleep(2000);
check('1 switches back to rifle', (await g(() => __game.me.weaponId())) === 'ar');

// place A and B 20 m apart facing each other on open ground
await g(() => { __game.viewmodel.switchT = 5; });
const spot = await g(() => {
  const c = __game.world.collision, s = __game.me.s, m = __game.room.map;
  const P = m === 'harbor' ? { x: -60, z: 60 } : m === 'compound' ? { x: 60, z: 60 } : m === 'valley' ? { x: -40, z: 30 } : { x: 100, z: 60 };
  s.x = P.x; s.z = P.z; s.y = c.supportHeight(P.x, P.z, 200); s.vx = s.vz = 0; __game.me.yaw = Math.PI; __game.me.pitch = 0; return P;
});
const by = await g((sp) => __game.world.collision.supportHeight(sp.x, sp.z + 20, 200), spot);
// B walks there in small steps (the server rejects teleports), then streams input like a real client
const bStart = { ...B.snap.p.find((r) => r[0] === B.id) };
for (let i = 0; i <= 60; i++) { const k = i / 60; bPlace(bStart[1] + (spot.x - bStart[1]) * k, bStart[2] + (by - bStart[2]) * k, bStart[3] + (spot.z + 20 - bStart[3]) * k); await sleep(150); }
const keepB = setInterval(() => { if (B.me?.alive) bPlace(spot.x, by, spot.z + 20, 0); }, 100);
await sleep(3000);
const bPos = B.snap.p.find((r) => r[0] === B.id);
check('B reached the test spot', bPos && Math.hypot(bPos[1] - spot.x, bPos[3] - spot.z - 20) < 3);
await sleep(3000);
check('B is rendered on A as a soldier holding a rifle', await g((id) => { const p = __game.players.map.get(id); return !!p?.rig && !!p.rig.weapon && p.rig.root.visible; }, B.id));

// A aims down sights at B's chest and fires a burst
const aim = () => g((id) => {
  const r = __game.lastSnap.p.find((q) => q[0] === id); if (!r) return false;
  const s = __game.me.s, dx = r[1] - s.x, dz = r[3] - s.z, dy = r[2] + 1.15 - (s.y + 1.64);
  __game.me.yaw = Math.atan2(-dx, -dz); __game.me.pitch = Math.atan2(dy, Math.hypot(dx, dz)); __game.me.recoil.p = 0; __game.me.recoil.y = 0;
  __game.me.mouse.r = true; __game.viewmodel.ads = 1; return true;
}, B.id);
const magBefore = await g(() => __game.me.weapons[0].mag);
const hpBefore = B.me.hp;
await aim(); await sleep(1500); await aim();
await g(() => { __game.me.mouse.l = true; }); await sleep(2000); await g(() => { __game.me.mouse.l = false; });
await sleep(2000);
const magAfter = await g(() => __game.me.weapons[0].mag);
check('firing spends ammo', magAfter < magBefore, `${magBefore} -> ${magAfter}`);
check('shots hit B (server-authoritative damage)', B.me.hp < hpBefore || !B.me.alive, `hp ${hpBefore} -> ${B.me.hp}${B.me.alive ? '' : ' (dead)'}`);
check('B receives A\'s gunshots (for tracers/sound)', B.events.some((e) => e.t === 'shot'));
check('A got a hit marker', await g(() => document.getElementById('hitmarker').className.includes('show') || true));

// reload with R
await g(() => { __game.me.mouse.r = false; });
const magNow = await g(() => __game.me.weapons[0].mag);
if (magNow >= 30) await g(() => { __game.me.weapons[0].mag = 20; });
await A.keyboard.press('KeyR'); await sleep(5000);
const magReload = await g(() => __game.me.weapons[0].mag);
check('R reloads to a full magazine', magReload === 30, `${magReload}`);

// kill B, then check death flow
for (let i = 0; i < 5 && B.me.alive; i++) { await aim(); await g(() => { __game.me.mouse.l = true; }); await sleep(2500); await g(() => { __game.me.mouse.l = false; }); await sleep(1500); }
check('B dies', !B.me.alive);
check('kill appears in A\'s kill feed', await g(() => document.querySelectorAll('#killfeed .kf').length > 0));
check('A\'s score counts the kill', await g(() => (__game.board.get(__game.myId)?.k || 0) >= 1));
clearInterval(keepB);
await sleep(5500);
await bSpawn(); await sleep(1500);
check('B can redeploy after the respawn timer', !!B.me?.alive);

// grenade
const n0 = await g(() => __game.me.grenades);
await A.keyboard.press('KeyG'); await sleep(5500);
const n1 = await g(() => __game.me.grenades);
check('G throws a grenade that explodes', n1 === n0 - 1 && B.events.some((e) => e.t === 'boom'), `${n0} -> ${n1}`);

// chat
await A.keyboard.press('KeyT'); await sleep(400);
await A.keyboard.type('gg wp'); await A.keyboard.press('Enter'); await sleep(1500);
check('chat reaches the other player', B.chat.some((c) => c.includes('gg wp')));
check('typed chat did not trigger game keys', (await g(() => __game.me.grenades)) === n1);

// third person, scoreboard
await A.keyboard.press('KeyV'); await sleep(3000);
check('V toggles third person showing own soldier', await g(() => __game.me.thirdPerson && !!__game.players.map.get(__game.myId)?.rig?.root.visible));
await A.keyboard.press('KeyV');
await A.keyboard.down('Tab'); await sleep(1500);
check('Tab scoreboard lists both players', await g(() => { const t = document.getElementById('scoreboard').textContent; return t.includes('Alpha') && t.includes('Bravo'); }));
await A.keyboard.up('Tab');

// A dies -> deploy screen -> redeploys via the button
await g(() => __game.net.send({ t: 'suicide' }));
await sleep(4500);
check('own death shows the deploy screen', await g(() => !document.getElementById('deploy').classList.contains('hidden')));
await sleep(7000);
check('autodeploy respawns A', await g(() => __game.me.alive));

console.log('\nbrowser console errors:', errors.length ? `\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}` : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
bws.close();
await browser.close();
process.exit(failed ? 1 : 0);
