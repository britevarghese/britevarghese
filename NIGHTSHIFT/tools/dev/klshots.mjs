// Kerala screenshots for a visual check: the chase camera behind the player's car on a town's street, by day, in the
// evening, at night and in the rain, with the traffic and people about. Writes <out>/<town>-<look>.png.
//   node tools/dev/klshots.mjs --port N [--at x,z | --at all] [--looks day,evening,night,rain] [--out DIR] [--quality medium]
import fs from 'node:fs';
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, out = args.out || '.', quality = args.quality || 'medium';
const LOOKS = { day: { timeOfDay: 'day', weather: 'clear' }, evening: { timeOfDay: 'evening', weather: 'cloudy' }, night: { timeOfDay: 'night', weather: 'clear' }, rain: { timeOfDay: 'day', weather: 'rain' } };
const looks = (args.looks || 'day,night,rain').split(',');
const TOWNS = { kannur: [98200, 211600], thalassery: [85603, 195435], mattannur: [75300, 215450], taliparamba: [99979, 227312], payyanur: [116603, 234899], iritty: [65523, 221833] };
const list = !args.at || args.at === 'all' ? Object.entries(TOWNS) : [[args.at.replace(',', '_'), args.at.split(',').map(Number)]];
fs.mkdirSync(out, { recursive: true });

const b = await launch();
for (const [name, [x0, z0]] of list) for (const look of looks) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'${quality}',detectedQuality:'${quality}',backend:'webgl2',timeOfDay:'${LOOKS[look].timeOfDay}',weather:'${LOOKS[look].weather}',postProcessing:'off',motionBlur:false}}))`);
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
  await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
  const info = await p.evaluate(async ([x0, z0]) => {
    const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null);
    const real = G.rm.render.bind(G.rm); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 1, lookX: 0, lookY: 0, lookBack: false });
    G.police.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    let n = null;
    for (let i = 0; i < 900; i++) { for (let k = 0; k < 3; k++) step(); await sleep(20); if (i < 60 || i % 15) continue; n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 6); if (n && n.dist < 300 && W.groundKnown(n.x, n.z, 60)) break; }
    G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz));
    for (let i = 0; i < 450; i++) { step(); if (i % 15 === 0) await sleep(5); }   // (traffic and people about)
    G.camCtl.snap(G.player);
    for (let i = 0; i < 3; i++) step();
    real(G.scene, G.camera, 1 / 30);
    return { at: `${G.player.state.x.toFixed(0)},${G.player.state.z.toFixed(0)}`, cars: G.traffic.cars.length, people: G.peds.peds.length, hour: G.env?.state?.hour?.toFixed?.(1) };
  }, [x0, z0]);
  const file = `${out}/${name}-${look}.png`;
  await p.screenshot({ path: file });
  console.log(`${file}: ${JSON.stringify(info)}${errs.length ? ' errors: ' + errs.slice(0, 2).join(' | ') : ''}`);
  await p.close();
}
await b.close();
