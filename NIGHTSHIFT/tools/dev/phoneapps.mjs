// The in-game phone (T): opens it, takes an auto-rickshaw ride (in the car, then on foot), has the mechanic bring the
// car and fix it, sets the GPS to a mask town, changes station. Prints where each ride ended and any errors; screenshots
// <out>-home.png and <out>-rides.png.
//   node tools/dev/phoneapps.mjs --port 3000 [--out DIR/name]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000, out = args.out || './phoneapps';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => (window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu') || !document.getElementById('fatal').classList.contains('hidden'), null, { timeout: 180000 });
const step = (n) => p.evaluate((n) => { const G = window.NIGHTSHIFT; for (let i = 0; i < n; i++) G._update(1 / 30); }, n);
await p.evaluate(async () => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.save.data.cash = 20000; await G.play(); window._render = G.rm.render.bind(G.rm); G.rm.render = () => {}; G.rm.renderer.setAnimationLoop(null); });
await step(150);
const res = {};
res.open = await p.evaluate(() => { const G = window.NIGHTSHIFT; return G.phone.open() && G.ui.current; });
await p.evaluate(() => { window.NIGHTSHIFT.rm.render = window._render; window.NIGHTSHIFT._update(1 / 30); });
await p.screenshot({ path: out + '-home.png' });
await p.evaluate(() => { window.NIGHTSHIFT.rm.render = () => {}; });
res.apps = await p.evaluate(() => [...document.querySelectorAll('.phone-item')].map((b) => b.textContent));
// a ride in the car
const ride = async (k) => {
  const t0 = Date.now();
  const pick = await p.evaluate((k) => { const G = window.NIGHTSHIFT; G.phone.travel(); const T = G.phone.towns(); const o = T[Math.min(k, T.length - 1)]; document.querySelectorAll('.phone-item')[Math.min(k, T.length - 1)].click(); return { name: o.name, x: o.x, z: o.z, km: +(o.d / 1000).toFixed(1), mode: G.state.mode, cash: G.save.data.cash }; }, k);
  let n = 0; while (n < 40 * 30 && (await p.evaluate(() => window.NIGHTSHIFT.state.mode)) === 'travel') { await step(30); n += 30; }
  await step(60);
  const at = await p.evaluate(() => { const G = window.NIGHTSHIFT, f = G.focusState, w = G.world; return { mode: G.state.mode, x: +f.x.toFixed(1), z: +f.z.toFixed(1), y: +(f.y ?? 0).toFixed(1), ground: +w.groundHeight(f.x, f.z).toFixed(1), onRoad: w.onCarriageway(f.x, f.z), cash: G.save.data.cash, foot: G.onFoot.active, veil: !!document.querySelector('.travel-veil') }; });
  return { ...pick, secs: n / 30, realSecs: +((Date.now() - t0) / 1000).toFixed(1), ...at, off: Math.round(Math.hypot(at.x - pick.x, at.z - pick.z)) };
};
res.carRide = await ride(2);
// on foot: a ride, then the mechanic brings the car
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.player.controls.handbrake = 1; G.onFoot.exit(); });
await step(120);
res.footRide = await ride(0);
res.carGap = await p.evaluate(() => { const G = window.NIGHTSHIFT, f = G.focusState; return Math.round(Math.hypot(G.player.state.x - f.x, G.player.state.z - f.z)); });
res.mech = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.phone.open(); G.phone.mechanic(); const t = [...document.querySelectorAll('.phone-item')].map((b) => b.textContent); document.querySelector('.phone-item').click(); return { items: t, mode: G.state.mode }; });
await step(30 * 8);
res.delivered = await p.evaluate(() => { const G = window.NIGHTSHIFT, f = G.focusState, s = G.player.state; return { gap: +Math.hypot(s.x - f.x, s.z - f.z).toFixed(1), onRoad: G.world.onCarriageway(s.x, s.z), y: +s.y.toFixed(1), ground: +G.world.groundHeight(s.x, s.z).toFixed(1) }; });
res.enter = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.onFoot.state.x = G.player.state.x + Math.cos(G.player.state.yaw) * 2; G.onFoot.state.z = G.player.state.z - Math.sin(G.player.state.yaw) * 2; const v = G.onFoot.nearestVehicle(); return v ? (G.onFoot.enter(v, true), v.kind) : null; });
await step(60);
res.repair = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.player.state.damage = 0.4; G.phone.open(); G.phone.mechanic(); const t = document.querySelector('.phone-item').textContent; document.querySelector('.phone-item').click(); return { item: t, dmg: G.player.state.damage, mode: G.state.mode }; });
res.masks = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.phone.open(); G.phone.masks(); const t = document.querySelector('.phone-item').textContent; document.querySelector('.phone-item').click(); return { item: t, gps: !!G.gps, mode: G.state.mode }; });
res.radio = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.phone.open(); G.phone.radio(); document.querySelectorAll('.phone-item')[2].click(); const st = G.audio.radioStation; G.ui.navigate({ consume: (a) => a === 'back' }); G.ui.navigate({ consume: (a) => a === 'back' }); return { st, mode: G.state.mode }; });
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.rm.render = window._render; G.phone.open(); G.phone.travel(); G._update(1 / 30); });
await p.screenshot({ path: out + '-rides.png' });
console.log(JSON.stringify({ ...res, errors }, null, 1));
await b.close();
