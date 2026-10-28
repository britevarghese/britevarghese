// Steps and kinks in the road surface round a town: every lane and junction turn within the radius, the surface a
// wheel touches sampled every 0.5 m, flagged where its height bends sharply (the second difference: a step or a
// kink, not a plain slope; the speed breakers left out). Reports how many over 6, 12 and 20 cm, and the worst; and
// how much of the edges between built tiles has the two tiles' ground apart (a seam: a cliff in the ground).
// Waits for the tiles round the town to be built first. Rendering off.
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
    // (and their lanes: a tile's ground is ready a few frames before its lanes are in - Payyanur once read 14 lanes)
    const near = (l) => l.pts.some((q) => Math.hypot(q[0] - x0, q[1] - z0) < radius);
    for (let i = 0, last = -1, same = 0; i < 200 && same < 4; i++) { for (let k = 0; k < 60; k++) step(); await sleep(2); const n = G.traffic.graph.lanes.filter(near).length; same = n === last ? same + 1 : 0; last = n; }
    const tmp = {}, flags = [];
    let n6 = 0, n12 = 0, n20 = 0, metres = 0;
    const scan = (path, what, deck) => {
      // (asked from just over the last height, as a wheel does: from high above, a lane under a bridge read the deck.
      // A lane on a bridge or its ramp starts on its deck, any other on the ground)
      const ys = [], at = [];
      // (not counting the speed breakers: 10 cm humps a metre wide, a bend of 20 cm sampled every half metre)
      const flat = (x, z, y) => { const t = W.tileAt(x, z); return W.groundHeight(x, z, y) - (t?._bg ? t.bumpAt(x, z) : 0); };
      // (and not on a tile not built: a lane at the radius's edge starting a metre into the next tile read its ground)
      for (let s = 0; s <= path.length; s += 0.5) {
        path.sample(s, tmp);
        if (!W.tileAt(tmp.x, tmp.z)?.ready) { ys.push(NaN); at.push([tmp.x, tmp.z]); continue; }
        const yp = ys.length ? ys[ys.length - 1] : NaN, y0 = yp === yp ? yp + 0.15 : deck ? 1e4 : flat(tmp.x, tmp.z, -1e4) + 0.15;
        ys.push(flat(tmp.x, tmp.z, y0)); at.push([tmp.x, tmp.z]);
      }
      metres += path.length;
      let worst = 0, wi = -1;
      for (let i = 1; i < ys.length - 1; i++) { const d2 = ys[i + 1] - 2 * ys[i] + ys[i - 1]; if (Math.abs(d2) > Math.abs(worst)) { worst = d2; wi = i; } }   // (NaN: never more)
      const w = Math.abs(worst);
      if (w > 0.06) n6++; if (w > 0.12) n12++; if (w > 0.2) n20++;
      if (w > 0.06) flags.push({ w: +worst.toFixed(2), at: `${at[wi][0].toFixed(1)},${at[wi][1].toFixed(1)}`, what });
    };
    const lanes = G.traffic.graph.lanes.filter(near);
    for (const l of lanes) scan(l, `lane cls ${l.edge?.cls}`, l.deck);
    let nc = 0;
    // (not a dead end's turn round: it swings out over the verge as it must)
    for (const l of lanes) for (const c of l.next || []) { if (c.kind === 'connector' && !c.dead && c.turn !== 'uturn') { scan(c, `turn ${c.turn}`, l.deck); nc++; } }
    flags.sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
    // the ground along every edge two built tiles share: each tile's own height at the line, every 2 m
    let seamM = 0, seamW = 0, seamAt = '';
    for (const t of W.tiles.values()) for (const [a, b] of [[1, 0], [0, 1]]) {
      const o = W.tiles.get(W.key(t.tx + a, t.tz + b));
      if (!t.ready || !o?.ready) continue;
      for (let q = 0; q <= 2000; q += 2) {
        // (t's far edge in e is o's near one: e = 2000 / 0; in n likewise)
        const d = a ? t.heightAt(2000, q) - o.heightAt(0, q) : t.heightAt(q, 2000) - o.heightAt(q, 0);
        if (Math.abs(d) > 0.05) seamM += 2;
        if (Math.abs(d) > Math.abs(seamW)) { seamW = d; const x = a ? -(t.E0 + 2000) : -(t.E0 + q), z = a ? t.N0 + q : t.N0 + 2000; seamAt = `${x.toFixed(0)},${z.toFixed(0)}`; }
      }
    }
    return { lanes: lanes.length, turns: nc, km: +(metres / 1000).toFixed(1), n6, n12, n20, worst: flags.slice(0, 12).map((f) => `${f.w}@${f.at} (${f.what})`), seam: `${seamM} m apart by over 5 cm, worst ${seamW.toFixed(2)} m${seamAt ? ' at ' + seamAt : ''}` };
  }, [x0, z0, radius]);
  if (res.err) console.log(`== ${name}: ${res.err}`);
  else console.log(`== ${name}: ${res.lanes} lanes, ${res.turns} junction turns, ${res.km} km · kinks over 6 cm ${res.n6}, over 12 cm ${res.n12}, over 20 cm ${res.n20} · tile edges: ground ${res.seam} · errors ${errs.length}\n   worst: ${res.worst.join(' | ')}`);
  await p.close();
}
await b.close();
