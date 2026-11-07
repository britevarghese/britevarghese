// An installed TRAILBREAK for Windows updating itself, as players' copies do. The build workflow
// (.github/workflows/trailbreak-windows.yml) installs the release before the one it has just published, then:
//
//   node test/update.cjs download <installed TRAILBREAK.exe> <new version>
//     starts the old game; it must find the new release, download it (only what changed, where it can) and say so in the
//     lobby, and offer Game > Restart to update; then closes the game as a player would, which installs the update
//   (the workflow then waits for TRAILBREAK.exe to carry the new version)
//   node test/update.cjs check <installed TRAILBREAK.exe> <new version>
//     starts the updated game: it must be the new version and load the lobby
//
// (playwright-core, installed by the workflow for this alone, drives the app; the runner has no graphics card, so the
// game draws in software: SwiftShader, which Chromium only uses for WebGL when asked to.)
'use strict';
const { _electron } = require('playwright-core');
const fs = require('fs');

const [mode, exe, want] = process.argv.slice(2);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);
const check = (ok, what) => { if (!ok) throw new Error(what); log('ok:', what); };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

(async () => {
  if (!['download', 'check'].includes(mode) || !exe || !/^\d+\.\d+\.\d+$/.test(want || '')) throw new Error('usage: update.cjs download|check <TRAILBREAK.exe> <version>');
  if (!fs.existsSync(exe)) throw new Error(`no TRAILBREAK.exe at ${exe}`);
  const app = await _electron.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], timeout: 180000 });
  // (what the updater says, when the app's output reaches us: whether it downloaded only what changed)
  for (const s of [app.process().stdout, app.process().stderr]) {
    s?.on('data', (d) => { for (const line of String(d).split(/\r?\n/)) if (/update|download|block ?map|differential|sha512/i.test(line)) log('app:', line.slice(0, 300)); });
  }
  let closed = false;
  try {
    const win = await app.firstWindow({ timeout: 180000 });
    await win.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 180000 });
    const version = await app.evaluate(({ app }) => app.getVersion());
    log('running', version);

    if (mode === 'download') {
      check(newer(want, version), `the installed game (${version}) is older than the new release (${want})`);
      await win.waitForFunction((v) => (document.getElementById('lobby-msg')?.textContent || '').includes(`${v} has downloaded`), want, { timeout: 15 * 60000, polling: 1000 });
      log('lobby says:', await win.evaluate(() => document.getElementById('lobby-msg').textContent));
      check(true, `it found ${want}, downloaded it and said so in the lobby`);
      const game = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.items.map((i) => i.label));
      check(game.includes(`Restart to update to ${want}`), `Game > Restart to update to ${want}`);
      // close it as a player does: the update installs as the game quits
      await app.close();
      closed = true;
      log('closed: the update installs now');
    } else {
      check(version === want, `the updated game is ${want}`);
      await win.waitForSelector('#solo', { state: 'visible', timeout: 180000 });
      check(true, 'the lobby comes up');
    }
  } finally {
    if (!closed) await app.close().catch(() => {});
  }
  log('passed');
})().catch((e) => { console.error(`FAILED after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${e.message}`); process.exit(1); });
