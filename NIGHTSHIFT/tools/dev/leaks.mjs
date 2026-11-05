// A long session for leaks: round the towns lap after lap, at each stop (once the tiles within two of it are built) the
// GPU's textures and geometries, the characters' bone textures, the heap after a forced GC, and the geometries that
// have left the scene without being freed (by where they were). Flat from one lap to the next is good; a leak grows.
//   node tools/dev/leaks.mjs [--port N] [--stops '[[x,z],...]'] [--laps 3]
// (what's listed as gone and not freed includes the library models' shared shapes - a car or a boat taken away - which
// stay on purpose; a list that grows lap on lap is the thing to look at)
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const b = await launch(); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
p.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
const cdp = await p.context().newCDPSession(p);
await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${args.port || 3311}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.rm.renderer.setAnimationLoop(null); window.__real = G.rm.render.bind(G.rm); G.rm.render = () => {}; G.police.enabled = false;
  const M = window.__geo = new Map();
  const path = (o) => { const n = []; for (let q = o; q && q !== G.scene && n.length < 5; q = q.parent) n.push(q.name || q.type); return n.reverse().join('/'); };
  window.__scan = () => { G.scene.traverse((o) => { const g = o.geometry; if (!g || M.has(g)) return; M.set(g, path(o)); g.addEventListener('dispose', () => M.delete(g)); }); };
  const u = G._update.bind(G); let k = 0; G._update = (dt) => { u(dt); if ((++k & 7) === 0) window.__scan(); };
});
const STOPS = args.stops ? JSON.parse(args.stops) : [[98200, 211600], [85603, 195435], [75300, 215450]], LAPS = +(args.laps || 3);
for (let lap = 0; lap < LAPS; lap++) for (const [x0, z0] of STOPS) {
  const r = await p.evaluate(async ([x0, z0]) => {
    const G = window.NIGHTSHIFT, W = G.world, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    const tx = Math.floor(-x0 / 2000), tz = Math.floor(z0 / 2000), near = (t) => Math.max(Math.abs(t.tx - tx), Math.abs(t.tz - tz)) <= 2;
    let i = 0;
    for (; i < 20000; i++) { step(); if (i % 10 === 0) await sleep(1); if (i > 200 && i % 30 === 0 && !W.job && [...W.tiles.values()].filter(near).every((t) => t.ready) && [...W.tiles.values()].filter(near).length >= 20) break; }
    const n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 6); if (n) G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz));
    for (let k = 0; k < 200; k++) { step(); if (k % 10 === 0) await sleep(1); }
    window.__real(G.scene, G.camera, 1 / 30);
    const info = G.rm.renderer.info.memory; let bones = 0; const seen = new Set(); G.scene.traverse((o) => { if (o.isSkinnedMesh && o.skeleton?.boneTexture && !seen.has(o.skeleton.boneTexture)) { seen.add(o.skeleton.boneTexture); bones++; } });
    return { frames: i, tex: info.textures, geo: info.geometries, bones, tiles: W.tiles.size, ready: [...W.tiles.values()].filter((t) => t.ready).length, near: [...W.tiles.values()].filter(near).length };
  }, [x0, z0]);
  const lk = await p.evaluate(() => { const G = window.NIGHTSHIFT, now = new Set(); G.scene.traverse((o) => { if (o.geometry) now.add(o.geometry); }); const by = {}; let n = 0; for (const [g, pth] of window.__geo) if (!now.has(g)) { n++; const k = pth.replace(/\d+/g, '#'); by[k] = (by[k] || 0) + 1; } return { n, top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 14) }; });
  console.log('   gone from the scene, not freed: ' + lk.n + ' · ' + lk.top.map(([k, c]) => `${k} x${c}`).join(' | '));
  const h = await cdp.send('Runtime.getHeapUsage');
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const h2 = await cdp.send('Runtime.getHeapUsage');
  console.log(`lap ${lap} ${x0},${z0}: tiles ${r.ready}/${r.tiles} (near ${r.near}) · textures ${r.tex} (bones ${r.bones}, others ${r.tex - r.bones}) · geometries ${r.geo} · heap ${(h.usedSize / 1e6) | 0} -> after GC ${(h2.usedSize / 1e6) | 0} MB`);
}
await b.close();
