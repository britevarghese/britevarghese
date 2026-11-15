// Every Kerala business board and Theyyam mask: the car is set down at each one's town in turn, its ground left to
// build, and whether its marker found a place is logged (one that can't be placed can never be bought / collected).
//   node tools/dev/placements.mjs --port 3000 [--only biz|masks] [--ids mask7,bizresort]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000;
const b = await launch(); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 180000 });
await p.evaluate(async () => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; await G.play(); G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {}; G.police.enabled = false; for (let i = 0; i < 30; i++) G._update(1 / 30); });
const list = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.phone._biz(); G.phone._masks(); return [...G.biz.list.map((b) => ({ k: 'biz', id: b.id, name: b.name, x: b.c.x, z: b.c.z })), ...G.masks.places.map((m) => ({ k: 'mask', id: m.id, name: m.name, x: m.x, z: m.z }))]; });
const bad = []; let ok = 0;
for (const it of list) {
  if (args.only && !it.k.startsWith(args.only.replace(/s$/, ''))) continue;
  if (args.ids && !args.ids.split(',').includes(`${it.k}${it.id}`)) continue;
  const r = await p.evaluate(async (it) => {
    const G = window.NIGHTSHIFT, W = G.world, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 1, nitro: false, lookX: 0, lookY: 0 });
    // (60 m off: on the spot itself a mask put down within reach is collected at once)
    G.player.place(it.x + 60, it.z, 0);
    if (it.k === 'mask') delete G.masks.found[it.id];
    const got = () => (it.k === 'biz' ? G.biz.marks.get(it.id)?.spot : G.masks.spots.get(it.id) || (G.masks.found[it.id] && { x: G.player.state.x, z: G.player.state.z, collected: true }));
    if (it.k === 'biz') G.biz.tries = {}; else G.masks._tries = {};
    let t = 0;
    for (; t < 400 && !got(); t++) { for (let i = 0; i < 4; i++) G._update(1 / 30); await sleep(120); if (W.groundKnown(it.x, it.z, 30) && t % 10 === 9) { if (it.k === 'biz') G.biz.tries = {}; else G.masks._tries = {}; } }
    const s = got(), road = W.roadSpot(it.x, it.z, 7);
    return s?.collected ? { ok: true, d: 60, onRoad: false, water: false, collected: true } : s ? { ok: true, d: Math.round(Math.hypot(s.x - it.x, s.z - it.z)), onRoad: W.onCarriageway(s.x, s.z), water: W.inWater(s.x, s.z) } : { ok: false, known: W.groundKnown(it.x, it.z, 30), road: road ? Math.round(Math.hypot(road.x - it.x, road.z - it.z)) : null, water: W.inWater(it.x, it.z) };
  }, it);
  if (r.ok && !r.onRoad && !r.water) ok++; else bad.push(`${it.k} ${it.id} ${it.name}: ${JSON.stringify(r)}`);
  process.stdout.write(r.ok ? '.' : 'X');
}
console.log(`\n${ok} placed fine, ${bad.length} not:`); for (const l of bad) console.log('  ' + l);
console.log('errors', errors.length, errors.slice(0, 3));
await b.close();
