// Battle royale playtest: a real browser client goes through lobby -> transport plane -> jump -> freefall ->
// parachute -> landing -> loot pickup -> death / placement / spectating, against bots.
// Server: DEV_TELEPORT=1 ROYALE_LOBBY=20 node server/index.js      then: node scripts/playtest-royale.mjs
// (headless software rendering runs at ~1 fps, so the long fall is skipped by teleporting to the ground)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const out = 'docs/screenshots'; fs.mkdirSync(out, { recursive: true });

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'royale test', map: 'firestorm', bots: 5, private: true }) })).json();
console.log('room', room.id, room.map, room.mode);
check('room is a battle royale room', room.mode === 'royale');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const A = await browser.newPage({ viewport: { width: 800, height: 450 } });
A.on('console', (m) => { if (m.type() === 'error' && !/404|Pointer Lock|pointer lock/.test(m.text())) errors.push(m.text()); });
A.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`pageerror ${e.message}`); });
await A.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Alpha', quality: 'verylow', fov: 78 })));
await A.goto(`${BASE}/?room=${room.id}&autojoin=1&q=verylow`);
const g = (fn, arg) => A.evaluate(fn, arg);
const until = (fn, arg, timeout = 240000) => A.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);

check('READY screen shown after joining', await until(() => !document.getElementById('br-ready')?.classList.contains('hidden')));
await A.click('#br-go');
check('lobby countdown / waiting shown', await until(() => /MATCH STARTS|WAITING/.test(document.getElementById('br-top').textContent), null, 60000), await g(() => document.getElementById('br-top').textContent));
check('match starts: boarded the plane', await until(() => __game.royale.inPlane));
check('loot list received', await g(() => __game.royale.loot.size) > 100, `${await g(() => __game.royale.loot.size)} items`);
check('transport plane rendered', await until(() => __game.royale.planeMesh.visible, null, 30000));
check('camera follows the plane at altitude', await until(() => __game.camera.position.y > 150, null, 30000), `${(await g(() => __game.camera.position.y)).toFixed(0)} m`);
check('view distance extended in the air', await until(() => __game.world.scene.fog.far > 500, null, 60000), `${(await g(() => __game.world.scene.fog.far)).toFixed(0)} m fog`);
check('full-island map shown during the flight', await g(() => !document.getElementById('br-map').classList.contains('hidden')));
check('jump becomes available over the island', await until(() => __game.royale.plane?.ok === 1, null, 90000));
await A.screenshot({ path: `${out}/royale_plane.jpg`, quality: 80 });
await A.keyboard.press('Space');
check('SPACE jumps out of the plane (freefall)', await until(() => __game.me.alive && __game.me.s.air === 1, null, 60000));
const y0 = await g(() => __game.me.s.y);
check('falling', await until((y) => __game.me.s.y < y - 1, y0, 60000), `${y0.toFixed(1)} -> ${(await g(() => __game.me.s.y)).toFixed(1)} m`);
check('third-person camera while falling', await g(() => __game.me.isTPS()));
await A.screenshot({ path: `${out}/royale_freefall.jpg`, quality: 80 });
await A.keyboard.press('Space');
check('SPACE opens the parachute', await until(() => __game.me.s.air === 2, null, 30000));
check('canopy model attached', await until(() => __game.royale.canopies.has(__game.myId), null, 30000));
await A.waitForTimeout(2500);
await A.screenshot({ path: `${out}/royale_parachute.jpg`, quality: 80 });
// skip the rest of the descent: put the soldier on the ground next to a weapon on the ground floor
const target = await g(() => {
  const s = __game.me.s; let best = null, bd = 1e9;
  for (const it of __game.royale.loot.values()) {
    if (!['ar', 'sniper'].includes(it.type)) continue;
    const d = Math.hypot(it.x - s.x, it.z - s.z); if (d < bd) { bd = d; best = it; }
  }
  Object.assign(s, { x: best.x + 0.8, y: best.y, z: best.z, vx: 0, vy: 0, vz: 0, air: 0, onGround: true });
  return { ...best, obj: undefined };
});
check('landed (server agrees)', await until(() => __game.royale.me.air === 0 && __game.me.s.air === 0, null, 30000));
check('loot model streamed in nearby', await until((id) => !!__game.royale.loot.get(id)?.obj, target.id, 30000), target.type);
check('pickup prompt shown', await until(() => !document.getElementById('br-prompt').classList.contains('hidden'), null, 30000), await g(() => document.getElementById('br-prompt').textContent));
await A.screenshot({ path: `${out}/royale_loot.jpg`, quality: 80 });
await A.keyboard.press('KeyE');
check('E picks up the weapon (server-authoritative)', await until((w) => __game.me.weapons[0]?.id === w, target.type, 30000), await g(() => __game.me.weapons.map((w) => w?.id).join('/')));
check('picked weapon is equipped', await g((w) => __game.me.weaponId() === w, target.type));
check('item removed from the ground', await until((id) => !__game.royale.loot.has(id), target.id, 20000));
// armor
// teleporting next to an arbitrary item can land against a wall and get pushed away: try up to 4 candidates
let armor = null, near = false;
const tried = [];
for (let attempt = 0; attempt < 4 && !near; attempt++) {
  armor = await g((skip) => {
    const s = __game.me.s; let best = null, bd = 1e9;
    // (skip armor a bot could grab first: bots rate armor highly)
    const bots = [...__game.players.map.values()].filter((p) => p.alive && p.id !== __game.myId);
    for (const it of __game.royale.loot.values()) { if (it.type !== 'armor' || skip.includes(it.id) || bots.some((b) => Math.hypot(b.x - it.x, b.z - it.z) < 90)) continue; const d = Math.hypot(it.x - s.x, it.z - s.z); if (d < bd) { bd = d; best = it; } }
    Object.assign(s, { x: best.x + 0.6, y: best.y, z: best.z, vx: 0, vz: 0 });
    return { id: best.id };
  }, tried);
  tried.push(armor.id);
  near = await until((id) => !!__game.royale.loot.get(id)?.obj && __game.royale.nearestLoot()?.id === id, armor.id, 40000);
}
check('armor in pickup range', near, `${tried.length} attempt(s) · ` + await g((id) => { const it = __game.royale.loot.get(id), s = __game.me.s; return `${it ? Math.hypot(it.x - s.x, it.z - s.z).toFixed(2) + ' m, dy ' + (it.y - s.y).toFixed(2) : 'gone'} nearest=${__game.royale.nearestLoot()?.type}`; }, armor.id));
await g(() => { const send = __game.net.send.bind(__game.net); window.__sent = []; __game.net.send = (m) => { if (m.t !== 'in') window.__sent.push(JSON.stringify(m)); send(m); }; });
await A.keyboard.press('KeyE');
await A.waitForTimeout(3000);
console.log('      sent after E:', await g(() => window.__sent.join(' ') || 'nothing'), '| server pos', await g(() => JSON.stringify(__game.lastSnap.p.find((r) => r[0] === __game.myId)?.slice(1, 4))), '| client', await g(() => [__game.me.s.x, __game.me.s.y, __game.me.s.z].map((v) => v.toFixed(2)).join(',')));
check('armor plates picked up', await until(() => __game.royale.me.ar >= 50, null, 30000), `armor ${await g(() => __game.royale.me.ar)}, alive ${await g(() => __game.me.alive)}${await g(() => (__game.royale.placed ? ` (killed, placed #${__game.royale.placed})` : ''))}`);
check('armor shown in HUD', await until(() => +document.getElementById('br-ar').textContent >= 50, null, 20000));
check('ring of fire rendered', await g(() => __game.royale.ringWall.visible));
check('alive counter', await g(() => +document.getElementById('br-al').textContent) >= 2, await g(() => document.getElementById('br-al').textContent));
await A.keyboard.down('Tab');
check('scoreboard lists soldiers', await until(() => /ALIVE/.test(document.getElementById('scoreboard').textContent), null, 20000));
await A.keyboard.up('Tab');
await A.keyboard.down('KeyM');
check('M shows the island map', await until(() => !document.getElementById('br-map').classList.contains('hidden'), null, 20000));
await A.screenshot({ path: `${out}/royale_map.jpg`, quality: 80 });
await A.keyboard.up('KeyM');
await g(() => __game.net.send({ t: 'suicide' }));
check('death shows placement', await until(() => /PLACED/.test(document.getElementById('br-result').textContent), null, 30000), await g(() => document.getElementById('br-result').textContent));
check('dropped loot where the soldier died', await until(() => [...__game.royale.loot.values()].some((it) => Math.hypot(it.x - __game.me.s.x, it.z - __game.me.s.z) < 3), null, 20000));
check('no respawn: deploy screen stays hidden', await g(() => document.getElementById('deploy').classList.contains('hidden')));
check('spectating another soldier', await until(() => /SPECTATING/.test(document.getElementById('br-sub').textContent), null, 60000), await g(() => document.getElementById('br-sub').textContent));
await A.screenshot({ path: `${out}/royale_spectate.jpg`, quality: 80 });

console.log(`\nbrowser console errors: ${errors.length ? errors.join('\n') : 'none'}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
