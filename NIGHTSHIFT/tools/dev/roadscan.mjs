// Steps and kinks in the road surface round a town: every lane and junction turn within the radius, the surface a
// wheel touches sampled every 0.5 m, flagged where its height bends sharply (the second difference: a step or a
// kink, not a plain slope). Reports how many over 6, 12 and 20 cm, and the worst. Waits for the tiles round the
// town to be built first. Rendering off.
//   node tools/dev/roadscan.mjs --port N [--at x,z | --at all] [--radius 700]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, radius = +(args.radius || 700);
const TOWNS = { kannur: [98200, 211600], thalassery: [85603, 195435], mattannur: [75300, 215450], taliparamba: [99979, 227312], payyanur: [116603, 234899], iritty: [65523, 221833] };
const list = !args.at || args.at === 'all' ? Object.entries(TOWNS) : [[args.at, args.at.split(',').map(Number)]];

const b = await launch();
for (const [name, [x0, z0]] of list) {
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
  await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
  const res = await p.evaluate(async ([x0, z0, radius]) => {
    const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.police.enabled = false; G.traffic.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    // every tile the radius reaches built
    const need = () => { for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) if (!W.groundKnown(x0 + dx, z0 + dz, 0)) return false; return true; };
    for (let i = 0; i < 20000 && !need(); i++) { step(); if (i % 10 === 0) await sleep(2); }
    if (!need()) return { err: 'tiles not built' };
    const tmp = {}, flags = [];
    let n6 = 0, n12 = 0, n20 = 0, metres = 0;
    const scan = (path, what, deck) => {
      // (asked from just over the last height, as a wheel does: from high above, a lane under a bridge read the deck.
      // A lane on a bridge or its ramp starts on its deck, any other on the ground)
      const ys = [], at = [];
      for (let s = 0; s <= path.length; s += 0.5) { path.sample(s, tmp); const y0 = ys.length ? ys[ys.length - 1] + 1 : deck ? 1e4 : W.groundHeight(tmp.x, tmp.z, -1e4) + 1; ys.push(W.groundHeight(tmp.x, tmp.z, y0)); at.push([tmp.x, tmp.z]); }
      metres += path.length;
      let worst = 0, wi = -1;
      for (let i = 1; i < ys.length - 1; i++) { const d2 = ys[i + 1] - 2 * ys[i] + ys[i - 1]; if (Math.abs(d2) > Math.abs(worst)) { worst = d2; wi = i; } }
      const w = Math.abs(worst);
      if (w > 0.06) n6++; if (w > 0.12) n12++; if (w > 0.2) n20++;
      if (w > 0.06) flags.push({ w: +worst.toFixed(2), at: `${at[wi][0].toFixed(1)},${at[wi][1].toFixed(1)}`, what });
    };
    const near = (l) => l.pts.some((q) => Math.hypot(q[0] - x0, q[1] - z0) < radius);
    const lanes = G.traffic.graph.lanes.filter(near);
    for (const l of lanes) scan(l, `lane cls ${l.edge?.cls}`, l.deck);
    let nc = 0;
    // (not a dead end's turn round: it swings out over the verge as it must)
    for (const l of lanes) for (const c of l.next || []) { if (c.kind === 'connector' && !c.dead && c.turn !== 'uturn') { scan(c, `turn ${c.turn}`, l.deck); nc++; } }
    flags.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    return { lanes: lanes.length, turns: nc, km: +(metres / 1000).toFixed(1), n6, n12, n20, worst: flags.slice(0, 12).map((f) => `${f.w}@${f.at} (${f.what})`) };
  }, [x0, z0, radius]);
  if (res.err) console.log(`== ${name}: ${res.err}`);
  else console.log(`== ${name}: ${res.lanes} lanes, ${res.turns} junction turns, ${res.km} km · kinks over 6 cm ${res.n6}, over 12 cm ${res.n12}, over 20 cm ${res.n20} · errors ${errs.length}\n   worst: ${res.worst.join(' | ')}`);
  await p.close();
}
await b.close();
