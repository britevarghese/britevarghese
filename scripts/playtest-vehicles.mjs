// Vehicles playtest: a real browser client boards a tank (E), drives it with W, fires the cannon, switches to the
// roof MG, gets out, flies a helicopter (SPACE climbs, W noses forward), while a second network client crashes an
// enemy helicopter so the wreck / explosion path is exercised.
// Server: DEV_TELEPORT=1 node server/index.js      then: node scripts/playtest-vehicles.mjs
import { chromium } from 'playwright-core';
import WebSocket from 'ws';
import fs from 'node:fs';

const BASE = process.env.PT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = 'docs/screenshots'; fs.mkdirSync(out, { recursive: true });

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'vehicles', map: 'airfield', bots: 0, private: true, rotation: false }) })).json();
console.log('room', room.id, room.map);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const A = await browser.newPage({ viewport: { width: 800, height: 450 } });
A.on('console', (m) => { if (m.type() === 'error' && !/404|Pointer Lock|pointer lock/.test(m.text())) errors.push(m.text()); });
A.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`pageerror ${e.message} @ ${(e.stack || '').split('\n').slice(1, 4).join(' | ')}`); });
await A.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Alpha', quality: 'low', fov: 78 })));
await A.goto(`${BASE}/?room=${room.id}&autojoin=1&autodeploy=1&q=low&team=1`);
await A.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000 });
const g = (fn, arg) => A.evaluate(fn, arg);
const until = (fn, arg, timeout = 60000) => A.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);
// the headless browser runs at a few fps: after placing the soldier, wait until the server has the new position
const synced = () => until(() => { const r = __game.lastSnap?.p.find((x) => x[0] === __game.myId), s = __game.me.s; return r && Math.hypot(r[1] - s.x, r[3] - s.z) < 1.5; }, null, 30000);
const frames = (n) => g((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

check('vehicles streamed + modelled (tanks, helicopters, jeeps, bikes)', await until(() => __game.vehicles.map.size === 10), await g(() => [...__game.vehicles.map.values()].map((v) => `${v.type}${v.team}`).join(' ')));
// walk up to our tank
const tank = await g(() => { const v = [...__game.vehicles.map.values()].find((x) => x.type === 'tank' && x.team === __game.myTeam); Object.assign(__game.me.s, { x: v.x + 3.4, y: v.y, z: v.z, vx: 0, vz: 0 }); __game.me.yaw = Math.PI / 2; return { id: v.id, x: v.x, z: v.z }; });
await synced();
check('enter prompt shown next to the tank', await until(() => !document.getElementById('vprompt').classList.contains('hidden')), await g(() => document.getElementById('vprompt').textContent));
await A.screenshot({ path: `${out}/vehicle_tank_outside.jpg`, quality: 80 });
await A.keyboard.press('KeyE');
check('E boards the tank as driver (server-authoritative)', await until((id) => __game.vehicles.mine?.id === id && __game.vehicles.mine.seat === 0 && __game.lastSnap?.me?.vid === id, tank.id), await g(() => JSON.stringify(__game.vehicles.mine)));
check('soldier hidden inside, vehicle HUD shown', await g(() => document.body.classList.contains('invehicle') && !document.getElementById('vhud').classList.contains('hidden')));
await A.keyboard.down('KeyW');
await frames(30);
await A.keyboard.up('KeyW');
await sleep(800);
const moved = await g((t) => { const r = __game.lastSnap.veh.find((x) => x[0] === t.id); return Math.hypot(r[3] - t.x, r[5] - t.z); }, tank);
check('W drives the tank (server accepted the predicted movement)', moved > 1, `${moved.toFixed(1)} m`);
check('engine sound running', await g((id) => !!__game.vehicles.map.get(id).loop || !__game.audio.ctx, tank.id));
await A.screenshot({ path: `${out}/vehicle_tank_drive.jpg`, quality: 80 });
// fire the cannon (headless: no pointer lock, so press the trigger through the input state)
await g(() => { window.__vshots = []; const on = __game.vehicles.onShot.bind(__game.vehicles); __game.vehicles.onShot = (e) => { window.__vshots.push(e.w); on(e); }; __game.me.mouse.l = true; });
check('LMB fires the 120 mm gun', await until(() => window.__vshots.includes('tank_cannon'), null, 30000));
await g(() => { __game.me.mouse.l = false; });
check('reload reported after the shot', await until((id) => (__game.vehicles.ammo.get(id)?.rl?.[0] || 0) > performance.now(), tank.id, 10000) || await g(() => /RELOADING/.test(document.getElementById('vh-weap').textContent)), await g(() => document.getElementById('vh-weap').textContent));
await A.screenshot({ path: `${out}/vehicle_tank_fire.jpg`, quality: 80 });
await A.keyboard.press('Digit2');
check('2 switches to the roof machine gun', await until((id) => __game.vehicles.mine?.seat === 1, tank.id, 20000));
await g(() => { __game.me.mouse.l = true; });
check('MG fires from the gunner seat', await until(() => window.__vshots.includes('tank_mg'), null, 30000));
await g(() => { __game.me.mouse.l = false; });
await A.keyboard.press('KeyE');
check('E gets out beside the tank', await until(() => !__game.vehicles.mine && !__game.lastSnap?.me?.vid, null, 20000), await g(() => `${__game.me.s.x.toFixed(1)},${__game.me.s.z.toFixed(1)}`));
check('soldier visible again', await until(() => !document.body.classList.contains('invehicle')));

// ---------------------------------------------------------------- motorbike + jeep
await sleep(2000); // (let the exit event land before placing the soldier)
let bike = await g(() => { const v = [...__game.vehicles.map.values()].find((x) => x.type === 'bike' && x.team === __game.myTeam && !x.dead); Object.assign(__game.me.s, { x: v.x + 1.6, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0, onGround: true, air: 0 }); return { id: v.id, x: v.x, z: v.z }; });
await synced();
await A.keyboard.press('KeyE');
check('E gets on the motorbike', await until(() => __game.vehicles.map.get(__game.vehicles.mine?.id)?.type === 'bike', null, 20000));
// (two bikes are parked side by side: E takes the nearest one)
Object.assign(bike, await g(() => { const v = __game.vehicles.map.get(__game.vehicles.mine?.id); return v ? { id: v.id, x: v.x, z: v.z } : {}; }));
check('rider visible on the bike (exposed seat)', await until(() => { const p = __game.players.map.get(__game.myId); return !!p?.rig?.root.visible && __game.me.s.stance === 'crouch'; }, null, 40000));
await A.keyboard.down('KeyW'); await frames(30); await A.keyboard.up('KeyW'); await sleep(800);
const bm = await g((b) => { const r = __game.lastSnap.veh.find((x) => x[0] === b.id); return Math.hypot(r[3] - b.x, r[5] - b.z); }, bike);
check('W rides the bike', bm > 2, `${bm.toFixed(1)} m`);
await A.screenshot({ path: `${out}/vehicle_bike.jpg`, quality: 80 });
await A.keyboard.press('KeyE');
await until(() => !__game.vehicles.mine, null, 20000);
const jeep = await g(() => { const v = [...__game.vehicles.map.values()].find((x) => x.type === 'jeep' && x.team === __game.myTeam); Object.assign(__game.me.s, { x: v.x + 2.6, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0 }); return { id: v.id }; });
await synced();
await A.keyboard.press('KeyE');
check('E gets in the jeep', await until((id) => __game.vehicles.mine?.id === id, jeep.id, 20000));
await A.keyboard.press('Digit2');
check('2 moves to the roof .50 cal', await until(() => __game.vehicles.mine?.seat === 1, null, 20000));
await g(() => { __game.me.mouse.l = true; });
check('.50 cal fires', await until(() => window.__vshots.includes('jeep_mg'), null, 30000));
await g(() => { __game.me.mouse.l = false; });
await A.keyboard.press('KeyV');
await frames(4);
await A.screenshot({ path: `${out}/vehicle_jeep.jpg`, quality: 80 });
await A.keyboard.press('KeyE');
check('E gets out of the jeep', await until(() => !__game.vehicles.mine, null, 20000));

// ---------------------------------------------------------------- helicopter
await sleep(2000); // (let the exit event land before placing the soldier)
const heli = await g(() => { const v = [...__game.vehicles.map.values()].find((x) => x.type === 'heli' && x.team === __game.myTeam); Object.assign(__game.me.s, { x: v.x + 4.5, y: v.y, z: v.z, vx: 0, vz: 0 }); return { id: v.id, y: v.y }; });
// model close-ups (free camera)
await g(() => { const vs = [...__game.vehicles.map.values()], h = vs.find((x) => x.type === 'heli' && x.team === __game.myTeam), t = vs.find((x) => x.type === 'tank' && x.team === __game.myTeam); window.__freecam = { pos: [h.x - 9, h.y + 4, h.z - 10], look: [h.x, h.y + 1.5, h.z] }; window.__t = t; });
await frames(3); await A.screenshot({ path: `${out}/vehicle_heli_model.jpg`, quality: 85 });
await g(() => { const t = window.__t; window.__freecam = { pos: [t.x - 7, t.y + 3.5, t.z - 8], look: [t.x, t.y + 1.2, t.z] }; });
await frames(3); await A.screenshot({ path: `${out}/vehicle_tank_model.jpg`, quality: 85 });
await g(() => { window.__freecam = null; });
await until(() => !document.getElementById('vprompt').classList.contains('hidden'));
await synced();
await A.keyboard.press('KeyE');
check('E boards the helicopter as pilot', await until((id) => __game.vehicles.mine?.id === id && __game.vehicles.mine.seat === 0, heli.id, 20000));
await A.keyboard.down('Space');
await frames(40);
await A.keyboard.up('Space');
await sleep(800);
const alt = await g((h) => __game.lastSnap.veh.find((x) => x[0] === h.id)[4] - h.y, heli);
check('SPACE climbs (collective)', alt > 3, `${alt.toFixed(1)} m`);
check('rotor spinning (blur disc)', await g((id) => __game.vehicles.map.get(id).model.userData.disc.visible, heli.id));
await A.keyboard.down('KeyW');
await frames(30);
await A.keyboard.up('KeyW');
const hs = await g(() => Math.hypot(__game.vehicles.drive.s.vx, __game.vehicles.drive.s.vz));
check('W noses down and flies forward', hs > 4, `${hs.toFixed(1)} m/s`);
await A.screenshot({ path: `${out}/vehicle_heli_flight.jpg`, quality: 80 });
await g(() => { __game.me.mouse.l = true; });
check('LMB fires rockets', await until(() => window.__vshots.includes('heli_rockets'), null, 30000));
await g(() => { __game.me.mouse.l = false; });
await A.screenshot({ path: `${out}/vehicle_heli_rockets.jpg`, quality: 80 });

await A.keyboard.press('KeyE');
check('E gets out of the helicopter', await until(() => !__game.vehicles.mine, null, 20000));
// (bailing out in the air is a long fall: wait for the soldier to be down / redeployed)
await until(() => __game.me.alive && __game.me.s.onGround && !__game.me.s.air, null, 90000);
await sleep(2500);
await until(() => __game.me.alive, null, 60000);

// ---------------------------------------------------------------- enemy helicopter crash (network client)
const B = { events: [] };
const bws = new WebSocket(`${BASE.replace('http', 'ws')}/ws?room=${room.id}`);
bws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'welcome') B.id = m.id; if (m.t === 'snap') B.snap = m; if (m.t === 'ev') B.events.push(m.e); if (m.t === 'ping') bws.send(JSON.stringify({ t: 'pong', s: m.s })); });
await new Promise((r) => bws.on('open', r));
bws.send(JSON.stringify({ t: 'join', room: room.id, name: 'Bravo', team: 2, cls: 'assault' }));
await sleep(600);
bws.send(JSON.stringify({ t: 'spawn', p: 'base' }));
await sleep(1200);
const eh = B.snap.veh.find((r) => r[1] === 1 && r[2] === 2);
bws.send(JSON.stringify({ t: 'in', x: eh[3] + 4.5, y: eh[4], z: eh[5], yaw: 0, pitch: 0, st: 'stand', ads: false, sp: false, vx: 0, vz: 0, og: true, sl: 0 }));
await sleep(300);
bws.send(JSON.stringify({ t: 'venter', id: eh[0] }));
await sleep(500);
// climb to 60 m, then bail out: the pilotless helicopter falls and crashes
for (let i = 1; i <= 12; i++) { bws.send(JSON.stringify({ t: 'vin', x: eh[3], y: eh[4] + i * 5, z: eh[5], yaw: eh[6], pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0 })); await sleep(120); }
bws.send(JSON.stringify({ t: 'vexit' }));
check('enemy helicopter crashes and is destroyed', await until((id) => __game.vehicles.map.get(id)?.dead, eh[0], 30000));
check('wreck charred + burning', await g((id) => { const v = __game.vehicles.map.get(id); return v.wrecked && !!v.smoke; }, eh[0]));
check('server reported the explosion', B.events.some((e) => e.t === 'vboom' && e.v === eh[0]));

console.log('\nbrowser console errors:', errors.length ? `\n  ${[...new Set(errors)].slice(0, 20).join('\n  ')}` : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
bws.close();
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
