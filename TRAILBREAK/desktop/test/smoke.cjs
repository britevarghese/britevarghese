// The installed TRAILBREAK for Windows, started as a player starts it: its window loads the game from its own server
// (127.0.0.1), the lobby comes up, a drive alone gets the truck moving, the menu and the page's bridge are there, and the
// updater reads this repository's latest release. The build workflow (.github/workflows/trailbreak-windows.yml) runs it
// on a Windows runner against the freshly installed game, and publishes the release only if it passes.
//
//   node test/smoke.cjs <path to the installed TRAILBREAK.exe> <folder for the screenshots>
//
// (SMOKE_NO_UPDATES=1 leaves out the updater's check, for a build on another system: it updates only on Windows.)
//
// (playwright-core, installed by the workflow for this alone, drives the app; the runner has no graphics card, so the
// game draws in software: SwiftShader, which Chromium only uses for WebGL when asked to.)
'use strict';
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const [exe, shots = 'smoke'] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);
const check = (ok, what) => { if (!ok) throw new Error(what); log('ok:', what); };

(async () => {
  if (!exe || !fs.existsSync(exe)) throw new Error(`no TRAILBREAK.exe at ${exe}`);
  fs.mkdirSync(shots, { recursive: true });
  const app = await _electron.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], timeout: 180000 });
  const errors = [];
  try {
    const win = await app.firstWindow({ timeout: 180000 });
    win.on('pageerror', (e) => errors.push(e.message));
    win.on('console', (m) => { if (m.type() === 'error') log('console error:', m.text().slice(0, 300)); });

    // the game, from the app's own server
    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180000 });
    log('loaded', win.url());
    const info = await app.evaluate(({ app, Menu }) => ({
      version: app.getVersion(), packaged: app.isPackaged, gpuSwitch: app.commandLine.hasSwitch('force_high_performance_gpu'),
      menu: Menu.getApplicationMenu().items.map((m) => [m.label, m.submenu.items.filter((i) => i.type !== 'separator').map((i) => [i.label, i.enabled])]),
    }));
    log('app', JSON.stringify(info));
    check(info.packaged, 'runs as the installed app');
    check(info.gpuSwitch, 'asks for the faster graphics chip');
    const help = info.menu.find(([label]) => label === 'Help');
    check(help && help[1].some(([label, on]) => label === 'Check for updates' && on), 'the updater is loaded (Help > Check for updates)');
    const bridge = await win.evaluate(() => window.trailbreakDesktop && Object.keys(window.trailbreakDesktop));
    check(bridge && ['inviteBase', 'onUpdate', 'answerJoin'].every((k) => bridge.includes(k)), `the page's desktop bridge (${bridge})`);

    // the updater reads the latest release (latest.yml) as the installed game does
    if (!process.env.SMOKE_NO_UPDATES) {
      const upd = await app.evaluate(async () => {
        const { autoUpdater } = process.mainModule.require('electron-updater');
        autoUpdater.autoDownload = false;
        const r = await autoUpdater.checkForUpdates();
        return { current: String(autoUpdater.currentVersion), latest: r?.updateInfo?.version, available: r?.isUpdateAvailable };
      });
      log('updates', JSON.stringify(upd));
      check(/^\d+\.\d+\.\d+$/.test(upd.latest || ''), `reads the latest release (${upd.latest})`);
    }

    // the lobby, then a drive alone (low graphics: it draws in software here)
    await win.evaluate(() => localStorage.setItem('trailbreak.settings', JSON.stringify({ name: 'Smoke test', map: 'world', truck: 'thar', hour: 15, weather: 'clear', fullscreen: false, quality: 'low', autoQuality: false, sound: false })));
    await win.reload();
    await win.waitForSelector('#solo', { state: 'visible', timeout: 180000 });
    await win.screenshot({ path: path.join(shots, 'lobby.png') });
    log('lobby up');
    await win.click('#solo');
    await win.waitForFunction(() => window.__ready === true, null, { timeout: 25 * 60000, polling: 1000 });
    log('driving: the world is built and drawn');
    const from = await win.evaluate(() => ({ x: window.game.vehicle.pos.x, z: window.game.vehicle.pos.z }));
    await win.evaluate(async () => { const g = window.game; g.input.touch.throttle = 0.6; await new Promise((r) => setTimeout(r, 15000)); g.input.touch.throttle = 0; });
    const to = await win.evaluate(() => ({ x: window.game.vehicle.pos.x, z: window.game.vehicle.pos.z, kmh: window.game.vehicle.speed * 3.6 }));
    const moved = Math.hypot(to.x - from.x, to.z - from.z);
    await win.screenshot({ path: path.join(shots, 'driving.png') });
    check(moved > 1, `the truck drives (${moved.toFixed(1)} m, ${to.kmh.toFixed(0)} km/h)`);
    check(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await app.close().catch(() => {});
  }
  log('passed');
})().catch((e) => { console.error(`FAILED after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${e.message}`); process.exit(1); });
