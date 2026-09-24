import { chromium } from 'playwright-core';
// Screenshots of every menu / HUD screen (home, loading, deploy, in-game HUD, pause, battle royale lobby).
// Server: DEV_TELEPORT=1 node server/index.js      then: node scripts/capture-ui-screens.mjs
const OUT = 'docs/screenshots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const mk = async (w = 1536, h = 900) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(400000); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/404|Pointer/.test(m.text()) && errs.push(m.text())); await p.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Viper', quality: 'low', fov: 78 }))); return p; };
const p = await mk();
await p.goto('http://localhost:3000/'); await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/ui_home.jpg`, type: 'jpeg', quality: 80 });
// join a conquest room from the server browser
await p.click('#roomlist [data-join]');
await p.waitForFunction(() => !document.getElementById('loadscreen').classList.contains('hidden'));
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/ui_loading.jpg`, type: 'jpeg', quality: 80 });
await p.waitForFunction(() => !document.getElementById('deploy').classList.contains('hidden'), null, { polling: 500 });
await p.waitForTimeout(2500);
await p.screenshot({ path: `${OUT}/ui_deploy.jpg`, type: 'jpeg', quality: 80 });
await p.click('#deploybtn');
await p.waitForFunction(() => __game.me.alive, null, { polling: 500 });
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/ui_hud.jpg`, type: 'jpeg', quality: 80 });
await p.evaluate(() => document.getElementById('pause').classList.remove('hidden'));
await p.waitForTimeout(1000);
await p.screenshot({ path: `${OUT}/ui_pause.jpg`, type: 'jpeg', quality: 80 });
await p.close();
const r = await (await fetch('http://localhost:3000/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ui', map: 'firestorm', bots: 5, private: true }) })).json();
const q = await mk();
await q.goto(`http://localhost:3000/?room=${r.id}&autojoin=1&q=verylow`);
await q.waitForFunction(() => document.getElementById('br-ready') && !document.getElementById('br-ready').classList.contains('hidden') && document.getElementById('loadscreen').classList.contains('hidden'), null, { polling: 500 });
await q.waitForTimeout(2500);
await q.screenshot({ path: `${OUT}/ui_royale.jpg`, type: 'jpeg', quality: 80 });
console.log('errors:', errs.join('\n') || 'none');
await b.close();
