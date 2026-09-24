// Mobile playtest: emulated phone (landscape, touch, mobile UA) driven with real multi-touch events (CDP).
//   node scripts/playtest-mobile.mjs [map]     (server running with DEV_TELEPORT=1)
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:3000';
const map = process.argv[2] || 'outskirts';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 844, H = 390;

const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mobile', map, bots: 0, private: true, rotation: false }) })).json();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|Pointer Lock|fullscreen|orientation/i.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => { if (!/Pointer Lock|fullscreen|orientation/i.test(e.message)) errors.push(`pageerror ${e.message}`); });
const out = process.env.SHOTS || '/tmp';

// lobby at phone size
await page.goto(`${BASE}/`);
await sleep(2500);
await page.screenshot({ path: `${out}/mobile_lobby.png` });
check('lobby usable at phone size (join button on screen)', await page.evaluate(() => { const r = document.getElementById('play').getBoundingClientRect(); return r.bottom <= innerHeight + 400 && r.width > 100; }));
check('quality defaults to VERY LOW on touch devices', (await page.evaluate(() => document.getElementById('quality').value)) === 'verylow');

await page.goto(`${BASE}/?room=${room.id}&autojoin=1&autodeploy=1&q=low`);
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000 });
const g = (fn, arg) => page.evaluate(fn, arg);
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 })) });
const frames = (n) => g((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
await g(() => { __game.viewmodel.switchT = 5; });

check('touch controls shown', await g(() => !!document.getElementById('touch') && document.body.classList.contains('touch')));
check('fire button visible', await g(() => { const r = document.getElementById('t-fire').getBoundingClientRect(); return r.width > 50 && getComputedStyle(document.getElementById('t-fire')).display !== 'none'; }));
await page.screenshot({ path: `${out}/mobile_hud.png` });

// joystick: push up (forward) and hold
const p0 = await g(() => ({ ...__game.me.s, yaw: __game.me.yaw }));
await touch('touchStart', [[150, 290, 1]]);
for (let i = 1; i <= 6; i++) { await touch('touchMove', [[150, 290 - i * 8, 1]]); }
await frames(25);
const pm = await g(() => ({ ...__game.me.s }));
await touch('touchEnd', []);
const fwd = [-Math.sin(p0.yaw), -Math.cos(p0.yaw)];
const d = [(pm.x - p0.x), (pm.z - p0.z)];
const along = d[0] * fwd[0] + d[1] * fwd[1];
check('joystick up walks forward', along > 0.5, `${along.toFixed(2)} m forward`);
await frames(3);
check('releasing the stick stops input', await g(() => __game.me.touch.mx === 0 && __game.me.touch.mz === 0));

// look drag on the right half
const yaw0 = await g(() => __game.me.yaw);
await touch('touchStart', [[560, 250, 2]]);
for (let i = 1; i <= 5; i++) await touch('touchMove', [[560 + i * 20, 250, 2]]);
await touch('touchEnd', []);
const yaw1 = await g(() => __game.me.yaw);
check('dragging right half turns the view', Math.abs(yaw1 - yaw0) > 0.2, `${(yaw1 - yaw0).toFixed(2)} rad`);

// buttons (tap = touchStart+End at element centre)
const tapEl = async (id) => { const r = await g((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }, id); await touch('touchStart', [[r[0], r[1], 9]]); await sleep(120); await touch('touchEnd', []); await frames(2); };
await tapEl('t-crouch'); check('CRCH button crouches', (await g(() => __game.me.s.stance)) === 'crouch');
await tapEl('t-prone'); check('PRONE button goes prone', (await g(() => __game.me.s.stance)) === 'prone');
await tapEl('t-prone'); check('PRONE again stands', (await g(() => __game.me.s.stance)) === 'stand');
await tapEl('t-jump'); await frames(3); check('JUMP button jumps', (await g(() => __game.me.s.vy > 0.1 || !__game.me.s.onGround)));
await frames(20);
await tapEl('t-ads'); check('AIM button toggles ADS on', await g(() => __game.me.mouse.r));
await tapEl('t-ads'); check('AIM button toggles ADS off', await g(() => !__game.me.mouse.r));

// multi-touch: move with the stick while holding FIRE and dragging it to aim
const fireAt = await g(() => { const b = document.getElementById('t-fire').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
const mag0 = await g(() => __game.me.weapons[0].mag), yawF0 = await g(() => __game.me.yaw), pos0 = await g(() => ({ ...__game.me.s }));
await touch('touchStart', [[150, 290, 1]]);
await touch('touchMove', [[150, 240, 1]]);
await touch('touchStart', [[150, 240, 1], [fireAt[0], fireAt[1], 3]]);
for (let i = 1; i <= 4; i++) await touch('touchMove', [[150, 240, 1], [fireAt[0] - i * 10, fireAt[1], 3]]);
await frames(12);
await touch('touchEnd', []);
await frames(2);
const mag1 = await g(() => __game.me.weapons[0].mag), yawF1 = await g(() => __game.me.yaw), pos1 = await g(() => ({ ...__game.me.s }));
check('holding FIRE shoots', mag1 < mag0, `${mag0} -> ${mag1}`);
check('dragging the FIRE button aims while shooting', Math.abs(yawF1 - yawF0) > 0.05, `${(yawF1 - yawF0).toFixed(2)} rad`);
check('moving and shooting at the same time (multi-touch)', Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) > 0.3);
check('releasing FIRE stops shooting', await g(() => !__game.me.mouse.l));

await tapEl('t-reload'); await sleep(4000); await frames(3);
check('R button reloads', (await g(() => __game.me.weapons[0].mag)) === 30);
await tapEl('t-swap'); await sleep(1500);
check('⇄ button swaps to pistol', (await g(() => __game.me.weaponId())) === 'pistol');
await tapEl('t-swap'); await sleep(1500);
const n0 = await g(() => __game.me.grenades);
await tapEl('t-nade'); await sleep(1500);
check('G button throws a grenade', (await g(() => __game.me.grenades)) === n0 - 1);
await tapEl('t-view'); await frames(3);
check('👁 button toggles third person', await g(() => __game.me.thirdPerson));
await page.screenshot({ path: `${out}/mobile_tps.png` });
await tapEl('t-view');
await tapEl('t-pause'); await frames(2);
check('❚❚ opens the pause menu', await g(() => !document.getElementById('pause').classList.contains('hidden')));
check('gameplay buttons hidden while paused', await g(() => getComputedStyle(document.getElementById('t-fire')).display === 'none'));
await page.screenshot({ path: `${out}/mobile_pause.png` });
await page.tap('#p-resume'); await frames(2);
check('RESUME closes pause', await g(() => document.getElementById('pause').classList.contains('hidden')));

console.log('\nbrowser console errors:', errors.length ? `\n  ${[...new Set(errors)].join('\n  ')}` : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
