// On foot round a town: out of the car, walking and running a few seconds at a time in random directions, at walls,
// houses, trees and traffic. Logs a step that passes through something solid (a wall, a house, a pole: the step's line
// crosses its box), a stand inside one, the feet off the ground (sunk under it, or held up over it), being stuck, and
// errors. Rendering off.
//   node tools/dev/onfoot.mjs --port N [--at x,z | --at all] [--seconds 120] [--seed 1]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, secs = +(args.seconds || 120), seed = +(args.seed || 1);
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
  const res = await p.evaluate(async ([x0, z0, secs, seed]) => {
    const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1, nitro: false };
    G.input.update = () => Object.assign(G.input.controls, ctl, { lookX: 0, lookY: 0, lookBack: false });
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.police.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    let placed = false;
    for (let i = 0; i < 900 && !placed; i++) { for (let k = 0; k < 3; k++) step(); await sleep(30); if (i < 60 || i % 15) continue; const n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 7); if (n && n.dist < 300 && W.tileAt(n.x, n.z)?.ready) { G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz)); placed = true; } }
    for (let i = 0; i < 200; i++) { step(); if (i % 10 === 0) await sleep(5); }
    const F = G.onFoot;
    F.exit();
    for (let i = 0; i < 120 && !F.active; i++) step();
    for (let i = 0; i < 90; i++) step();
    if (!F.active) return { err: 'never got out of the car' };
    const s = F.state, fmt = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
    let rnd = seed * 7919 + 13; const R = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
    const out = { through: [], inside: [], sunk: [], high: [], stuckAt: [], stuck: 0, dist: 0, legs: 0, walls: 0 }, tmp = [];
    // the step from (ax, az) to (bx, bz) through a box's inside (not just touching it): its line in the box's frame
    // against the box shrunk 2 cm
    const crosses = (c, ax, az, bx, bz) => {
      const L = (x, z) => [(x - c.cx) * c.cos - (z - c.cz) * c.sin, (x - c.cx) * c.sin + (z - c.cz) * c.cos];
      const [p0, q0] = L(ax, az), [p1, q1] = L(bx, bz), hx = c.hx - 0.02, hz = c.hz - 0.02;
      let t0 = 0, t1 = 1;
      for (const [o, d, h] of [[p0, p1 - p0, hx], [q0, q1 - q0, hz]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(o) >= h) return false; continue; }
        let ta = (-h - o) / d, tb = (h - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
      }
      return true;
    };
    const inBox = (c, x, z, m) => { const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin, lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos; return Math.abs(lx) < c.hx - m && Math.abs(lz) < c.hz - m; };
    let heading = R() * Math.PI * 2, legT = 0, run = false, stillT = 0, px = s.x, pz = s.z;
    for (let f = 0; f < secs * 30; f++) {
      if ((legT -= 1 / 30) <= 0 || stillT > 2.5) {
        if (stillT > 2.5) {
          out.stuck++;
          // what it's up against: the solid things within a metre ahead, and cars
          G.world.collision.query(s.x - 1.5, s.z - 1.5, s.x + 1.5, s.z + 1.5, tmp);
          const near = tmp.filter((c) => !c.off && c.h > s.y + 0.4).map((c) => { const lx = (s.x - c.cx) * c.cos - (s.z - c.cz) * c.sin, lz = (s.x - c.cx) * c.sin + (s.z - c.cz) * c.cos; return { c, gap: Math.max(Math.abs(lx) - c.hx, Math.abs(lz) - c.hz) }; }).filter((q) => q.gap < 0.6).map((q) => `${q.c.kind || '?'} ${(q.c.hx * 2).toFixed(1)}x${(q.c.hz * 2).toFixed(1)} h ${(q.c.h - s.y).toFixed(1)}`);
          const cars = [G.player, ...(G.traffic?.cars || [])].filter((v) => { const q = v.state || v; return Math.hypot((q.x ?? v.x) - s.x, (q.z ?? v.z) - s.z) < 3.5; }).length;
          if (out.stuckAt.length < 10) out.stuckAt.push(`${(f / 30).toFixed(0)}s at ${fmt(s.x, s.z)} heading ${(heading * 57.3).toFixed(0)}: ${near.join(', ') || 'nothing solid'}${cars ? ` · ${cars} car(s) by` : ''}${W.onCarriageway(s.x, s.z, 0) ? ' · on the road' : ''}`);
        }
        heading = R() * Math.PI * 2; legT = 2 + R() * 5; run = R() < 0.5; out.legs++; stillT = 0;
      }
      F.camYaw = heading; ctl = { throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: run };
      const ax = s.x, az = s.z;
      step();
      if (G.state.mode !== 'drive') G.resume?.();
      if (!F.active) { F.exit(); for (let i = 0; i < 60 && !F.active; i++) step(); continue; }   // (got into something: out again)
      const moved = Math.hypot(s.x - ax, s.z - az);
      out.dist += moved;
      stillT = moved < 0.01 ? stillT + 1 / 30 : 0;
      if (G.interiors?.active) continue;
      // through a wall or a house: the step's line crossing the inside of anything solid above the knees
      G.world.collision.query(Math.min(ax, s.x) - 1, Math.min(az, s.z) - 1, Math.max(ax, s.x) + 1, Math.max(az, s.z) + 1, tmp);
      for (const c of tmp) {
        if (c.off || c.h < s.y + 0.4) continue;
        if (out.through.length < 12 && crosses(c, ax, az, s.x, s.z)) out.through.push(`${(f / 30).toFixed(1)}s ${c.kind || '?'} ${(c.hx * 2).toFixed(2)}x${(c.hz * 2).toFixed(2)} from ${fmt(ax, az)} to ${fmt(s.x, s.z)} ${run ? 'running' : 'walking'}`);
        if (out.inside.length < 12 && inBox(c, s.x, s.z, 0.05)) out.inside.push(`${(f / 30).toFixed(1)}s in ${c.kind || '?'} ${(c.hx * 2).toFixed(2)}x${(c.hz * 2).toFixed(2)} at ${fmt(s.x, s.z)}`);
      }
      if (f % 6 === 0) {
        const gy = W.groundHeight(s.x, s.z, s.y + 2);
        if (s.onGround && s.y < gy - 0.15 && out.sunk.length < 8) out.sunk.push(`${(f / 30).toFixed(1)}s ${(gy - s.y).toFixed(2)} m under the ground at ${fmt(s.x, s.z)}`);
        if (s.onGround && s.y > gy + 0.4 && out.high.length < 8) out.high.push(`${(f / 30).toFixed(1)}s ${(s.y - gy).toFixed(2)} m over the ground at ${fmt(s.x, s.z)}`);
      }
      if (f % 150 === 0) await sleep(5);
    }
    return { start: fmt(px, pz), metres: Math.round(out.dist), legs: out.legs, stuck: out.stuck, stuckAt: out.stuckAt, through: out.through, inside: out.inside, sunk: out.sunk, high: out.high };
  }, [x0, z0, secs, seed]);
  if (res.err) { console.log(`== ${name}: ${res.err}`); await p.close(); continue; }
  console.log(`== ${name}: ${res.metres} m on foot, ${res.legs} legs, stuck ${res.stuck} · through things ${res.through.length} · inside ${res.inside.length} · under the ground ${res.sunk.length} · over it ${res.high.length} · errors ${errs.length}`);
  for (const k of ['through', 'inside', 'sunk', 'high', 'stuckAt']) if (res[k].length) console.log(`   ${k}: ${res[k].join(' | ')}`);
  if (errs.length) console.log('   errors: ' + errs.slice(0, 4).join(' | '));
  await p.close();
}
await b.close();
