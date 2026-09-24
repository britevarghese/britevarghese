// Standard visual regression scenes for NIGHTSHIFT (headless Chromium, software GL).
//   node tools/dev/scenes.mjs --port 3000 --out /path/dir --prefix before [--only car_night,aerial] [--quality medium]
// Requires the server running from this checkout on --port. Writes <out>/<prefix>-<scene>.png and <out>/<prefix>-report.json
import fs from 'node:fs';
import path from 'node:path';
import { PW, launch } from './pw.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const port = args.port || 3000, out = args.out || '.', prefix = args.prefix || 'shot', quality = args.quality || 'medium';
const W = +(args.w || 960), H = +(args.h || 540);
fs.mkdirSync(out, { recursive: true });

// fixed camera helper (overrides the chase camera)
const fixedCam = (px, py, pz, tx, ty, tz, fov = 50) => `G.camCtl.update = function(){ const c=this.camera; c.position.set(${px},${py},${pz}); c.lookAt(${tx},${ty},${tz}); c.fov=${fov}; c.near=0.1; c.updateProjectionMatrix(); };`;
const drive = (x, z, yaw, cam = 1) => `G.play(); G.player.place(${x},${z},${yaw}); G.camCtl.mode=${cam}; G.camCtl.snap(G.player);`;

export const GROUPS = [
  { time: 'night', weather: 'clear', views: [
    { id: 'street_night_chase', setup: drive(157.75, -250, 0), wait: 7000 },
    { id: 'car_night_34', setup: drive(157.75, -250, 0) + fixedCam(162.5, 1.3, -244, 157.75, 0.6, -250, 45), wait: 6000 },
    { id: 'car_night_rear', setup: drive(157.75, -250, 0) + fixedCam(155, 1.1, -257.5, 157.75, 0.7, -250, 45), wait: 5000 },
    { id: 'road_night_low', setup: drive(-2.25, -60, Math.PI) + fixedCam(-6, 1.6, -40, -2, 0.2, -120, 60), wait: 5000 },
    { id: 'aerial_night', setup: drive(157.75, -250, 0) + fixedCam(350, 180, -600, 0, 0, 0, 55), wait: 8000 },
    { id: 'highway_night', setup: drive(1177, 100, 0) , wait: 7000 },
    { id: 'suburb_night', setup: drive(-798.25, 500, 0), wait: 7000 },
  ] },
  { time: 'night', weather: 'rain', views: [
    { id: 'rain_night_chase', setup: drive(-2.25, -60, Math.PI), wait: 7000 },
  ] },
  { time: 'day', weather: 'clear', views: [
    { id: 'street_day_chase', setup: drive(157.75, -250, 0), wait: 7000 },
    { id: 'car_day_34', setup: drive(157.75, -250, 0) + fixedCam(162.5, 1.3, -244, 157.75, 0.6, -250, 45), wait: 5000 },
  ] },
  { time: 'evening', weather: 'cloudy', views: [
    { id: 'industrial_evening', setup: drive(640 - 2.25, 200, Math.PI), wait: 7000 },
  ] },
];

async function main() {
  const only = args.only ? String(args.only).split(',') : null;
  const report = { quality, scenes: {} };
  const b = await launch();
  for (const g of GROUPS) {
    const views = g.views.filter((v) => !only || only.includes(v.id));
    if (!views.length) continue;
    for (const v of views) {
      const p = await b.newPage({ viewport: { width: W, height: H } });
      const logs = [];
      p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
      p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
      await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'${quality}',detectedQuality:'${quality}',backend:'webgl2',weather:'${g.weather}',timeOfDay:'${g.time}'}}))`);
      const t0 = Date.now();
      await p.goto(`http://localhost:${port}/`);
      await p.waitForFunction(() => (window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu') || !document.getElementById('fatal').classList.contains('hidden'), null, { timeout: 120000 });
      const load = Date.now() - t0;
      try { await p.evaluate(`(()=>{ const G = window.NIGHTSHIFT; ${v.setup} })()`); } catch (e) { logs.push('setup error ' + e.message); }
      await p.waitForTimeout(v.wait);
      if (v.id !== 'garage') await p.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
      const file = path.join(out, `${prefix}-${v.id}.png`);
      await p.screenshot({ path: file });
      const info = await p.evaluate(() => { const G = window.NIGHTSHIFT; return G ? { ...G.rm.info(), fps: G.fps } : null; });
      report.scenes[v.id] = { file, loadMs: load, info, errors: logs };
      console.log(v.id, JSON.stringify(info), logs.length ? logs.slice(0, 3) : '');
      await p.close();
    }
  }
  // garage
  if (!only || only.includes('garage')) {
    const p = await b.newPage({ viewport: { width: W, height: H } });
    await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'${quality}',detectedQuality:'${quality}',backend:'webgl2'}}))`);
    await p.goto(`http://localhost:${port}/`);
    await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 120000 });
    await p.evaluate(() => window.NIGHTSHIFT.openGarage());
    await p.waitForTimeout(8000);
    const file = path.join(out, `${prefix}-garage.png`);
    await p.screenshot({ path: file });
    report.scenes.garage = { file };
    await p.close();
  }
  fs.writeFileSync(path.join(out, `${prefix}-report.json`), JSON.stringify(report, null, 2));
  await b.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
void PW;
