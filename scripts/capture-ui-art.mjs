// Renders the menu / loading-screen artwork from the game itself (no third-party art): an aerial view of every map,
// a soldier hero shot, kit portraits and a squad/vehicle shot. Writes JPEGs to client/assets/ui/.
// Server: DEV_TELEPORT=1 node server/index.js      then: node scripts/capture-ui-art.mjs [mapId ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = 'http://localhost:3000';
const OUT = 'client/assets/ui';
fs.mkdirSync(OUT, { recursive: true });
const maps = await (await fetch(`${BASE}/api/maps`)).json();
const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function open(map, { deploy = false, cls = 'assault', w = 1120, h = 630 } = {}) {
  const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'art', map, bots: map === 'firestorm' ? 4 : 3, private: true, rotation: false }) })).json();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.setDefaultTimeout(400000);
  page.on('pageerror', (e) => console.log('pageerror', map, e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('console', map, m.text()); });
  await page.addInitScript((c) => { localStorage.setItem('sp_settings', JSON.stringify({ name: 'Viper', quality: 'medium', fov: 70 })); localStorage.setItem('sp_class', c); localStorage.setItem('sp_showfps', '0'); }, cls);
  await page.goto(`${BASE}/?room=${room.id}&autojoin=1&q=medium&team=1&cls=${cls}${deploy ? '&autodeploy=1' : ''}`);
  await page.waitForFunction(() => window.__game?.lastSnap, null, { timeout: 600000, polling: 500 });
  // clean frame: no HUD / menus
  await page.addStyleTag({ content: '#hud,#deploy,#br-ready,#br,#touch,#vhud,#vprompt,#vret,#loadscreen,#pause{display:none!important}' });
  return page;
}
const frames = (page, n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (page, name, q = 76) => { await frames(page, 4); await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: q }); console.log('wrote', name); };

// ---------------------------------------------------------------- map aerials
for (const m of maps) {
  if (only.length && !only.includes(m.id)) continue;
  const page = await open(m.id);
  await page.evaluate(() => {
    const H = __game.world.scene.fog; H.far = Math.max(H.far, 900); __game.camera.far = 1000; __game.camera.updateProjectionMatrix();
  });
  await page.evaluate(({ royale, half }) => {
    const g = __game, P = half;
    // low three-quarter view from inside the play area, toward the middle of the battlefield (horizon in frame)
    const gh = (x, z) => g.world.collision.supportHeight(x, z, 500);
    const px = -P * (royale ? 0.62 : 0.5), pz = P * (royale ? 0.66 : 0.55);
    window.__freecam = { pos: [px, gh(px, pz) + (royale ? 150 : 42), pz], look: [P * 0.08, gh(0, 0) + (royale ? 0 : 6), -P * 0.12] };
  }, { royale: m.mode === 'royale', half: m.size / 2 });
  await shot(page, `map_${m.id}`);
  await page.close();
}

if (!only.length || only.includes('hero')) {
  // ---------------------------------------------------------------- soldier hero + kit portraits (third person)
  const page = await open('outskirts', { deploy: true });
  await page.waitForFunction(() => __game.me.alive, null, { timeout: 300000, polling: 500 });
  const pose = async (stance, cam) => page.evaluate(({ stance, cam }) => {
    const me = __game.me; me.thirdPerson = true; me.s.stance = stance;
    const s = me.s, yaw = me.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const [back, side, up, lookAhead, lookUp] = cam;
    window.__freecam = { pos: [s.x - fx * back + rx * side, s.y + up, s.z - fz * back + rz * side], look: [s.x + fx * lookAhead, s.y + lookUp, s.z + fz * lookAhead] };
  }, { stance, cam });
  // face the battlefield from HQ
  await page.evaluate(() => { __game.me.yaw = 0; __game.me.pitch = 0.05; });
  await frames(page, 6);
  await pose('stand', [1.6, -0.75, 1.75, 40, 1.2]);
  await shot(page, 'hero_soldier', 80);
  await pose('stand', [-2.6, 0.9, 1.5, -0.3, 1.25]);
  await shot(page, 'kit_assault');
  await pose('crouch', [-2.4, -1.0, 1.2, 0, 0.9]);
  await shot(page, 'kit_support');
  await pose('crouch', [-2.2, 1.3, 1.0, 0, 0.8]);
  await shot(page, 'kit_medic');
  await page.close();
  const p2 = await open('ridge', { deploy: true, cls: 'recon' });
  await p2.waitForFunction(() => __game.me.alive && __game.me.weapons[0]?.id === 'sniper', null, { timeout: 300000, polling: 500 });
  await p2.evaluate(() => { __game.me.thirdPerson = true; });
  await frames(p2, 6);
  await p2.evaluate(() => {
    const me = __game.me, s = me.s; s.stance = 'prone';
    window.__freecam = { pos: [s.x + 2.2, s.y + 1.0, s.z - 1.6], look: [s.x, s.y + 0.35, s.z] };
  });
  await shot(p2, 'kit_recon');

  await p2.close();
}
if (!only.length || only.includes('squad')) {
  // squad / vehicle shot: soldier beside the team's tank in the motor pool (flat ground at Outskirts HQ)
  const p3 = await open('outskirts', { deploy: true });
  await p3.waitForFunction(() => __game.me.alive && __game.vehicles.map.size > 0, null, { timeout: 300000, polling: 500 });
  await p3.evaluate(() => {
    const t = [...__game.vehicles.map.values()].find((v) => v.type === 'tank' && v.team === __game.myTeam);
    const me = __game.me, s = me.s; me.thirdPerson = true;
    Object.assign(s, { x: t.x - 3.5, z: t.z + 2, y: t.y, stance: 'stand' }); me.yaw = t.yaw + 0.5;
    window.__freecam = { pos: [t.x - 9, t.y + 2.2, t.z + 8], look: [t.x - 1, t.y + 1.6, t.z] };
  });
  await shot(p3, 'hero_squad', 80);
  await p3.close();
}
await browser.close();
// royale step images come from the royale playtest screenshots (plane / loot / spectating)
for (const [src, dst] of [['royale_plane', 'step_drop'], ['royale_loot', 'step_loot'], ['royale_parachute', 'step_survive']]) {
  const f = `docs/screenshots/${src}.jpg`;
  if (fs.existsSync(f) && (!only.length || only.includes('steps'))) { fs.copyFileSync(f, `${OUT}/${dst}.jpg`); console.log('copied', dst); }
}
