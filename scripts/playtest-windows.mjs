// Windows / falls / glass / audio / scope-lens playtest in a real browser.
// Server: DEV_TELEPORT=1 BOTS=0 node server/index.js      then: node scripts/playtest-windows.mjs
// (DEV_TELEPORT skips fall damage on the server; the unit tests cover fall damage with it enabled.)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.PT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const out = 'docs/screenshots'; fs.mkdirSync(out, { recursive: true });
const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'windows', map: 'outskirts', bots: 0, private: true, rotation: false }) })).json();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'] });
const errors = [];
const A = await browser.newPage({ viewport: { width: 800, height: 450 } });
A.on('pageerror', (e) => errors.push(`pageerror ${e.message} @ ${(e.stack || '').split('\n').slice(1, 3).join(' | ')}`));
A.on('console', (m) => { if (m.type() === 'error' && !/404|Pointer Lock|pointer lock/.test(m.text())) errors.push(m.text()); });
await A.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Alpha', quality: 'low', fov: 78 })));
await A.goto(`${BASE}/?room=${room.id}&autojoin=1&q=low&team=1`);
const g = (fn, arg) => A.evaluate(fn, arg);
const until = (fn, arg, timeout = 60000) => A.waitForFunction(fn, arg, { timeout, polling: 250 }).then(() => true, () => false);
const frames = (n) => g((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

await A.waitForFunction(() => !document.getElementById('deploy').classList.contains('hidden'), null, { timeout: 300000, polling: 500 });
await A.click('#deploybtn', { timeout: 180000 }); // a real click: the user gesture that allows sound
check('deployed', await until(() => __game.me.alive, null, 120000));
check('audio running after the first click', await until(() => __game.audio.ctx?.state === 'running', null, 20000), await g(() => __game.audio.ctx?.state));
check('volume slider in the pause menu', await g(() => !!document.getElementById('p-vol')));

// an upper-floor window with open ground below, soldier inside facing it
const win = await g(() => {
  const W = __game.world.collision;
  for (const p of W.glass) {
    const b = W.buildings.find((x) => p.id.startsWith(`${x.id}:`));
    if (!b || !['concrete', 'plaster', 'brick'].includes(b.spec.style)) continue;
    if (Math.floor((p.min[1] - b.y0) / b.FH) !== 1) continue;
    const out = p.n[0] ? [Math.sign(p.c[0] - b.spec.x), 0] : [0, Math.sign(p.c[2] - b.spec.z)];
    const gx = p.c[0] + out[0] * 3, gz = p.c[2] + out[1] * 3;
    if (W.supportHeight(gx, gz, p.min[1]) > W.map.groundHeight(gx, gz) + 0.3) continue;
    const floorY = p.min[1] - 0.95, s = __game.me.s;
    Object.assign(s, { x: p.c[0] - out[0] * 0.8, z: p.c[2] - out[1] * 0.8, vx: 0, vy: 0, vz: 0, onGround: true, stance: 'stand' });
    s.y = W.supportHeight(s.x, s.z, floorY + 0.3);
    __game.me.yaw = Math.atan2(-out[0], -out[1]); __game.me.pitch = 0;
    return { id: p.id, c: p.c, out, y: s.y };
  }
  return null;
});
check('found an upper-floor window', !!win, win?.id);
await frames(4);
await A.screenshot({ path: `${out}/window_inside.jpg`, quality: 80 });
await g(() => { window.__glass = []; const bg = __game.world.breakGlass.bind(__game.world); __game.world.breakGlass = (id) => { const r = bg(id); if (r) window.__glass.push(id); return r; }; window.__vaulted = false; const iv = setInterval(() => { if (__game.me.s.vault) window.__vaulted = true; }, 16); });
await A.keyboard.down('KeyW');
await A.keyboard.press('Space');
check('SPACE + W at the window vaults onto the sill and through', await until(() => window.__vaulted, null, 60000));
check('ends up outside, falling to the ground', await until((w) => { const s = __game.me.s; return ((s.x - w.c[0]) * w.out[0] + (s.z - w.c[2]) * w.out[1]) > 0.3 && s.y < w.y - 2; }, win, 90000), await g(() => __game.me.s.y.toFixed(1)));
await A.keyboard.up('KeyW');
check('climbing out smashed the glass (server event, pane removed)', await until((id) => window.__glass.includes(id), win.id, 60000), await g(() => window.__glass.join(',')));
await A.screenshot({ path: `${out}/window_jump.jpg`, quality: 80 });

// scope lens: switch weapons back and forth, aim: the eyepiece must show the magnified view, never plain white
await g(() => __game.me.switchSlot(1)); await frames(6);
await g(() => __game.me.switchSlot(0)); await frames(6);
await g(() => { __game.me.mouse.r = true; });
const hasScope = await g(() => !!__game.viewmodel.weapon.scopeDisc);
if (hasScope) {
  check('scope eyepiece shows the magnified picture after a weapon switch', await until(() => __game.viewmodel.weapon.scopeDisc.visible && __game.viewmodel.weapon.scopeDisc.material.type === 'ShaderMaterial', null, 60000));
  await A.screenshot({ path: `${out}/scope_lens.jpg`, quality: 80 });
} else check('weapon has no PiP scope (red dot / irons)', true);
await g(() => { __game.me.mouse.r = false; });

console.log(`\nbrowser console errors: ${errors.length ? errors.join('\n') : 'none'}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
