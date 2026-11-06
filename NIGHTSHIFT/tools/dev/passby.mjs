// A mission's AI car (the van you tail, by default) sent past cars parked at the kerb in a town, one at a time: from
// 25 m behind each along its lane to 45 m past it. Whether it gets by in 45 s, its longest stand, how close it came
// to the parked car's side (under 0: touched), whether it knocked it. Rendering off.
//   node tools/dev/passby.mjs --port N [--at 'spice kannur thalassery taliparamba'] [--n 10] [--type minitruck] [--trace 1]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const SPOTS = { spice: [102700, 214760], kannur: [98200, 211600], thalassery: [85603, 195435], taliparamba: [99979, 227312] };
const list = args.at ? args.at.split(' ') : Object.keys(SPOTS);
const N = +(args.n || 10), type = args.type || 'minitruck';
const b = await launch();
for (const name of list) {
  const [x0, z0] = SPOTS[name];
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2',timeOfDay:'day',weather:'clear'}}))`);
  await p.goto(`http://localhost:${args.port || 3311}/`);
  await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
  await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
  const res = await p.evaluate(async ([x0, z0, N, type]) => {
    const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const { AIDriver } = await import('/src/vehicles/AIDriver.js');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 1, lookX: 0, lookY: 0, lookBack: false });
    G.police.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    let placed = false;
    for (let i = 0; i < 900 && !placed; i++) { for (let k = 0; k < 3; k++) step(); await sleep(30); if (i < 60 || i % 15) continue; const n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 7); if (n && n.dist < 300 && W.tileAt(n.x, n.z)?.ready) { G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz)); placed = true; } }
    for (let i = 0; i < 300; i++) { step(); if (i % 10 === 0) await sleep(5); }
    const P = G.player.state, out = [], tried = new Set(), q = {};
    const vehOrig = G.story.vehicles.bind(G.story);
    for (let round = 0; round < 40 && out.length < N; round++) {
      const c = G.traffic.cars.find((c) => !tried.has(c) && c.parked && c.state === 'parked' && !c.spec.bike && c.path?.kind === 'lane' && c.s > 30 && c.path.length - c.s > 30 && Math.hypot(c.x - P.x, c.z - P.z) > 40 && Math.hypot(c.x - P.x, c.z - P.z) < 260);
      if (!c) { for (let i = 0; i < 150; i++) step(); await sleep(5); continue; }
      tried.add(c);
      const path = c.path, s0 = c.s;
      path.sample(s0, q); const latC = -(c.x - q.x) * q.dz + (c.z - q.z) * q.dx;   // + : right of the lane's line
      const route = []; for (let s = s0 - 25; s <= Math.min(path.length, s0 + 45); s += 3) { path.sample(s, q); route.push([q.x, q.z]); }
      path.sample(s0 - 25, q);
      const van = G.story._spawnVehicle(type, { x: q.x, z: q.z, yaw: Math.atan2(q.dx, q.dz) }, '#e8e8e2');
      const ai = new AIDriver(van, { skill: 0.82, maxSpeed: 15 }); ai.setRoute(route);
      G.story.vehicles = () => [van];
      const cx0 = c.x, cz0 = c.z;
      const tr = []; let t = 0, stop = 0, longest = 0, minClr = 9, passed = false, revs = 0, wasRev = false, sawPass = false, resets = 0, stopInfo = '';
      while (t < 45) {
        step(); ai.alsoAvoid = [P]; ai.update(1 / 30, G.traffic.cars); if (ai.needsReset) { resets++; ai.needsReset = false; } van.update(1 / 30); t += 1 / 30;
        if (Math.floor(t * 30) % 30 === 0) await sleep(1);
        const s = van.state, sp = Math.hypot(s.vx, s.vz), fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        const a = (c.x - s.x) * fx + (c.z - s.z) * fz, l = -(c.x - s.x) * fz + (c.z - s.z) * fx;
        if (Math.abs(a) < (van.p.length + c.spec.l) / 2) minClr = Math.min(minClr, Math.abs(l) - (van.p.width + c.spec.w) / 2);
        if (ai.passO === c) sawPass = true;
        if (ai.reverseT > 0 && !wasRev) revs++; wasRev = ai.reverseT > 0;
        if (Math.floor(t * 30) % 15 === 0) tr.push(`${t.toFixed(1)} a${a.toFixed(1)} l${l.toFixed(2)} eR${(ai._routeLat?.(s.x, s.z) ?? 0).toFixed(2)} cR${(ai._routeLat?.(c.x, c.z) ?? NaN).toFixed(2)} pass${ai.passO ? (ai.passLat ?? 0).toFixed(2) : '-'} v${sp.toFixed(1)} st${van.controls.steer.toFixed(2)} th${van.controls.throttle.toFixed(2)} br${van.controls.brake.toFixed(1)}${ai.passO === c ? ' P' : ai.passO ? ' P*' : ''}${ai.backT > 0 ? ' back' : ''}${ai.reverseT > 0 ? ' rev' : ''}${ai.turning ? ' turn' + ai.turning : ''} yr${(((s.yaw - c.yaw) + 9 * Math.PI) % (2 * Math.PI) - Math.PI).toFixed(2)} idx${ai.idx}`);
        if (sp < 0.3) { stop += 1 / 30; if (stop > longest) { longest = stop; stopInfo = `a ${a.toFixed(1)} l ${l.toFixed(1)} ctl t${van.controls.throttle.toFixed(2)} s${van.controls.steer.toFixed(2)}${ai.passO ? ' passing' : ''}${ai.passWait ? ' passWait ' + ai.passWait.toFixed(0) : ''}${ai.turning ? ' turning ' + ai.turning : ''} pass ${(ai.passLat ?? 0).toFixed(2)} blockT ${ai.blockT?.toFixed(1)} yawRel ${(((s.yaw - c.yaw) + 9 * Math.PI) % (2 * Math.PI) - Math.PI).toFixed(2)} onRd ${W.onCarriageway(s.x, s.z, 0)} near ${G.traffic.cars.filter((o) => o !== c && Math.hypot(o.x - s.x, o.z - s.z) < 12).map((o) => o.type + ' ' + o.state + ' a' + ((o.x - s.x) * fx + (o.z - s.z) * fz).toFixed(1) + ' l' + (-(o.x - s.x) * fz + (o.z - s.z) * fx).toFixed(1)).join('; ')}`; } } else stop = 0;
        if (a < -(van.p.length + c.spec.l) / 2 - 8) { passed = true; break; }
      }
      out.push({ id: c.id, type: c.type, at: `${Math.round(c.x)},${Math.round(c.z)}`, latC: +latC.toFixed(2), hw: path.edge?.hw, t: +t.toFixed(1), passed, longest: +longest.toFixed(1), stopInfo, minClr: +minClr.toFixed(2), moved: +Math.hypot(c.x - cx0, c.z - cz0).toFixed(2), state: c.state, sawPass, revs, resets, tr: (!passed || longest > 5) ? tr : undefined });
      G.scene.remove(van.renderer.group); van.dispose?.(); G.story.vehicles = vehOrig;
    }
    return out;
  }, [x0, z0, N, type]);
  console.log(`== ${name}`);
  for (const r of res) { const tr = r.tr; delete r.tr; console.log(JSON.stringify(r)); if (tr && args.trace) console.log('   ' + tr.join('\n   ')); }
  const ok = res.filter((r) => r.passed).length;
  console.log(`${name}: passed ${ok}/${res.length}, touched ${res.filter((r) => r.minClr < 0).length}, stood >5s ${res.filter((r) => r.longest > 5).length}`);
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await p.close();
}
await b.close();
