// Street life in a town's middle over a few minutes of game time, the player's car stopped in the road there (police
// off): traffic stuck for long (and what's in front of it), traffic vehicles overlapping, vehicles off the carriageway,
// traffic accidents nobody staged, people in the carriageway who aren't crossing or walking somewhere. Rendering off.
//   node tools/dev/townlife.mjs --port N [--at x,z | --at all] [--minutes 3] [--detail 1]
// (all: the six towns' middles one after another, a fresh page each)
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, minutes = +(args.minutes || 3), detail = !!args.detail;   // (--detail 1: each overlapping pair's state)
const TOWNS = { kannur: [98200, 211600], thalassery: [85603, 195435], mattannur: [75300, 215450], taliparamba: [99979, 227312], payyanur: [116603, 234899], iritty: [65523, 221833] };
const list = !args.at || args.at === 'all' ? Object.entries(TOWNS) : [[args.at, args.at.split(',').map(Number)]];

const b = await launch();
for (const [name, [x0, z0]] of list) {
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2',timeOfDay:'day',weather:'clear'}}))`);
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
  await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
  const res = await p.evaluate(async ([x0, z0, minutes, detail]) => {
    const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 1, lookX: 0, lookY: 0, lookBack: false });
    G.police.enabled = false;
    // to the nearest lane at the place, once its tiles are in
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    let placed = false;
    for (let i = 0; i < 900 && !placed; i++) { for (let k = 0; k < 3; k++) step(); await sleep(30); if (i < 60 || i % 15) continue; const n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 7); if (n && n.dist < 300 && W.tileAt(n.x, n.z)?.ready) { G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz)); placed = true; } }
    for (let i = 0; i < 300; i++) { step(); if (i % 10 === 0) await sleep(5); }
    const out = { pairs: new Map(), over: new Map(), offRoad: new Map(), crash: new Map(), staged: new Map(), pedRoad: new Map(), maxCars: 0, carSamples: 0, stopSamples: 0, pedSamples: 0, offDump: [] };
    const stopT = new Map(), seenCrash = new Set();
    const key = (x, z) => `${Math.round(x / 5) * 5},${Math.round(z / 5) * 5}`;
    const inc = (m, k, extra) => { const e = m.get(k) || { n: 0, extra }; e.n++; m.set(k, e); };
    for (let sec = 0; sec < minutes * 60; sec++) {
      for (let k = 0; k < 30; k++) step();
      if (sec % 5 === 0) await sleep(5);
      const C = G.traffic.cars.filter((c) => c.path);
      out.maxCars = Math.max(out.maxCars, C.length);
      const D = C.filter((c) => c.state === 'drive' && !c.parked);
      for (const c of D) {
        out.carSamples++;
        if (c.v < 0.3) { out.stopSamples++; stopT.set(c, (stopT.get(c) || 0) + 1); } else stopT.set(c, 0);
        // off the carriageway: its middle half a metre past the edge (not a two-wheeler: they ride the edge)
        if (!c.spec.bike && !W.onCarriageway(c.x, c.z, 0.5)) {
          inc(out.offRoad, key(c.x, c.z), `${c.type} v ${c.v.toFixed(1)}`);
          if (out.offDump.length < 4 && !out.offDump.some((q) => q.id === c.id)) out.offDump.push({ id: c.id, sec, type: c.type, at: `${c.x.toFixed(1)},${c.z.toFixed(1)}`, v: +c.v.toFixed(1), s: +c.s.toFixed(1), lat: +(c.lat || 0).toFixed(2), path: c.path ? `${c.path.from}->${c.path.to} len ${c.path.length?.toFixed(0)} cls ${c.path.edge?.cls} hw ${c.path.edge?.hw} ${c.path.kind}` : '-' });
        }
      }
      for (const c of C) if ((c.state === 'knocked' || c.state === 'wreck') && !seenCrash.has(c.id)) { seenCrash.add(c.id); inc(c.incident ? out.staged : out.crash, key(c.x, c.z), c.type); }
      // overlaps (not two-wheelers): oriented boxes, 0.3 m slack
      for (let i = 0; i < D.length; i++) for (let j = i + 1; j < D.length; j++) {
        const a = D[i], q = D[j]; if (a.spec.bike || q.spec.bike) continue;
        const dx = q.x - a.x, dz = q.z - a.z, rr = (a.spec.l + q.spec.l) / 2; if (Math.abs(dx) > rr || Math.abs(dz) > rr) continue;
        const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), lx = Math.abs(dx * fz - dz * fx), lz = Math.abs(dx * fx + dz * fz);
        const c2 = Math.abs(Math.sin(q.yaw) * fx + Math.cos(q.yaw) * fz), s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
        const ql = (q.spec.l * c2 + q.spec.w * s2) / 2, qw = (q.spec.w * c2 + q.spec.l * s2) / 2;
        if (lz < a.spec.l / 2 + ql - 0.3 && lx < a.spec.w / 2 + qw - 0.3) {
          inc(out.over, key(a.x, a.z), `${a.type}+${q.type}`);
          const pk = a.id + '-' + q.id;
          if (detail && !out.pairs.has(pk) && out.pairs.size < 8) {
            const pth = (r) => r ? (r.kind === 'connector' ? `con ${r.turn} len ${r.length.toFixed(1)}` : `${r.from}->${r.to} len ${r.length.toFixed(0)} cls ${r.edge?.cls} hw ${r.edge?.hw} lanes ${r.lanes}`) : '-';
            const d = (c) => `${c.type} ${c.x.toFixed(1)},${c.z.toFixed(1)} yaw ${c.yaw.toFixed(2)} v ${c.v.toFixed(1)} s ${c.s.toFixed(1)} lat ${(c.lat || 0).toFixed(2)}->${(c.latT || 0).toFixed(2)} ${c.phys ? 'PHYS ' : ''}${pth(c.path)}${c.pulled ? ' pulled' : ''}${c.pullAt ? ' pullAt ' + c.pullAt.toFixed(1) : ''}${c.passT > 0 ? ' passing ' + (c.passLat || 0).toFixed(2) : ''}${c.blockT > 0 ? ' held' : ''}${c.jamHold ? ' jamHold' : ''}${c.jamGo ? ' jamGo' : ''}${c.yieldT > 0 ? ' yielding' : ''}`;
            out.pairs.set(pk, `${sec}s: ${d(a)}  ||  ${d(q)}`);
          }
        }
      }
      // people walking along or standing (not crossing, fleeing, fighting, walking over to something, getting on a
      // bus) more than 0.6 m into the carriageway
      for (const pd of G.peds.peds) {
        if (!pd.x || pd.down || pd.crossing || pd.flee || pd.fight || pd.inBus || pd.walkTo || pd.board) continue;
        out.pedSamples++;
        if (W.onCarriageway(pd.x, pd.z, -0.6)) inc(out.pedRoad, key(pd.x, pd.z), pd.stand ? 'standing' : 'walking');
      }
    }
    // stuck: stopped for the last 60 s or more, and what's in front of it within 12 m on its way
    const stuck = [];
    for (const [c, t] of stopT) if (t >= 60 && G.traffic.cars.includes(c)) {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      let ahead = null;
      for (const o of G.traffic.cars) { if (o === c) continue; const dx = o.x - c.x, dz = o.z - c.z, a = dx * fx + dz * fz, l = Math.abs(-dx * fz + dz * fx); if (a > 0 && a < 12 && l < 2.5 && (!ahead || a < ahead.a)) ahead = { a, o }; }
      { const P = G.player.state, dx = P.x - c.x, dz = P.z - c.z, a = dx * fx + dz * fz, l = Math.abs(-dx * fz + dz * fx); if (a > 0 && a < 14 && l < 2.6 && (!ahead || a < ahead.a)) ahead = { a, o: { type: 'PLAYER', v: 0 } }; }
      stuck.push(`${c.type} @${c.x.toFixed(0)},${c.z.toFixed(0)} ${t}s, s ${c.s.toFixed(1)}/${(c.path?.length || 0).toFixed(0)}, ahead ${ahead ? `${ahead.o.type} ${ahead.a.toFixed(1)} m` : 'nothing'}`);
    }
    const sum = (m) => [...m.values()].reduce((s, e) => s + e.n, 0);
    const top = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([k, e]) => `${k} x${e.n} (${e.extra})`);
    return { at: `${G.player.state.x.toFixed(0)},${G.player.state.z.toFixed(0)}`, placed, maxCars: out.maxCars, stoppedPct: +(100 * out.stopSamples / Math.max(1, out.carSamples)).toFixed(1),
      stuck, overlaps: sum(out.over), overTop: top(out.over), offRoad: sum(out.offRoad), offTop: top(out.offRoad), offDump: out.offDump,
      pairs: [...out.pairs.values()], crashes: sum(out.crash), crashTop: top(out.crash), staged: sum(out.staged), pedSamples: out.pedSamples, pedRoad: sum(out.pedRoad), pedTop: top(out.pedRoad) };
  }, [x0, z0, minutes, detail]);
  console.log(`== ${name}: stopped ${res.stoppedPct}% · stuck ${res.stuck.length} · overlaps ${res.overlaps} · off road ${res.offRoad} · crashes ${res.crashes} (staged ${res.staged}) · people in the road ${res.pedRoad}/${res.pedSamples} · cars ${res.maxCars} · errors ${errs.length}`);
  for (const k of ['stuck', 'overTop', 'offTop', 'crashTop', 'pedTop']) if (res[k].length) console.log(`   ${k}: ${res[k].join(' | ')}`);
  if (res.offDump.length) console.log('   offDump: ' + JSON.stringify(res.offDump));
  for (const q of res.pairs) console.log('   pair ' + q);
  if (errs.length) console.log('   errors: ' + errs.slice(0, 4).join(' | '));
  await p.close();
}
await b.close();
