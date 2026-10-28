// A police chase through a town: the player's car driven off by an AI along random routes through the traffic (or
// left standing: --stop), a pursuit started at the given heat. Logs where units come in (on the road? facing along
// it?), how they get on (closest to the player, off the road, stuck, hits and what they hit, traffic knocked down and
// by whom), roadblocks, traffic making way for the sirens, and how it ends (busted, escaped). Rendering off.
//   node tools/dev/chase.mjs --port N [--at x,z | --at all] [--heat 2] [--seconds 120] [--stop 1]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, heat = +(args.heat || 2), secs = +(args.seconds || 120), stop = !!args.stop;
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
  const res = await p.evaluate(async ([x0, z0, heat, secs, stop]) => {
    const G = window.NIGHTSHIFT, W = G.world, PM = G.police; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
    G.input.update = () => Object.assign(G.input.controls, ctl, { lookX: 0, lookY: 0, lookBack: false });
    PM.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    let placed = false;
    for (let i = 0; i < 900 && !placed; i++) { for (let k = 0; k < 3; k++) step(); await sleep(30); if (i < 60 || i % 15) continue; const n = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 7); if (n && n.dist < 300 && W.tileAt(n.x, n.z)?.ready) { G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz)); placed = true; } }
    for (let i = 0; i < 240; i++) { step(); if (i % 10 === 0) await sleep(5); }
    const { bus } = await import('/src/core/EventBus.js');
    const { AIDriver } = await import('/src/vehicles/AIDriver.js');
    let T = 0;
    const fmt = (x, z) => `${x.toFixed(0)},${z.toFixed(0)}`, timeline = [];
    for (const k of ['police:pursuit', 'police:heat', 'police:cooldown', 'police:spotted', 'police:escaped', 'police:busted', 'police:roadblock', 'police:disabled']) bus.on(k, () => timeline.push(`${T.toFixed(1)}s ${k.slice(7)}`));
    // units as they come in, and what they hit
    const spawns = [], hits = {}, hitAt = [], info = new Map();
    const spawn0 = PM._spawnUnit.bind(PM);
    PM._spawnUnit = (x, z, yaw, role) => {
      const u = spawn0(x, z, yaw, role);
      if (!u || (x === 0 && z === 0)) return u;
      const q = u.vehicle.state, n = G.traffic.graph.nearest(q.x, q.z);
      const off = n ? Math.abs(((q.yaw - Math.atan2(n.dx, n.dz) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 57.3 : -1;
      spawns.push(`${T.toFixed(1)}s ${role} ${Math.round(Math.hypot(q.x - G.player.state.x, q.z - G.player.state.z))} m off${W.onCarriageway(q.x, q.z, 0.3) ? '' : ' OFF ROAD'} ${off.toFixed(0)} deg to its lane`);
      info.set(u, { off: 0, still: 0, minD: Infinity });
      const up = u.vehicle.update.bind(u.vehicle);
      u.vehicle.update = (dt) => { const ev = up(dt), q2 = u.vehicle.state; for (const e of ev) if (e.type === 'collision' && e.intensity > 0.15) { const k = e.kind || '?'; hits[k] = (hits[k] || 0) + 1; if (hitAt.length < 10) hitAt.push(`${T.toFixed(0)}s unit${u.id} ${k} at ${Math.round(Math.hypot(q2.vx, q2.vz) * 3.6)} km/h (${u.ai.mode})`); } return ev; };
      return u;
    };
    const knockBy = { police: 0, player: 0, other: 0 };
    const col0 = G.traffic._collide.bind(G.traffic);
    G.traffic._collide = (v, c) => { const was = c.state, r = col0(v, c); if (r && was === 'drive' && c.state !== 'drive') knockBy[v === G.player ? 'player' : PM.units.some((u) => u.vehicle === v) ? 'police' : 'other']++; return r; };
    // the player's driver
    const L = W.layout, v = G.player, s = v.state, ai = new AIDriver(v, { skill: 0.9, maxSpeed: 21 });
    let rnd = 7; const R = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
    const plan = () => {
      const a = s.yaw + (R() - 0.5) * 2.4, d = 500 + R() * 900, dest = L.nearestNode(s.x + Math.sin(a) * d, s.z + Math.cos(a) * d);
      const ids = L.deadEnd(dest.id) ? [] : L.route(L.nearestNode(s.x, s.z), dest);
      if (ids.length > 2) ai.setRoute(ids.map((id) => [L.nodes[id].x, L.nodes[id].z]), false, 0);
    };
    PM.enabled = true; PM.clearAll(); PM.startPursuit(heat, 'test');
    let ended = null, dist = 0, lx = s.x, lz = s.z, yielding = 0;
    const off = [], stuck = [], gaps = [];
    bus.on('police:busted', () => { ended ||= `busted at ${T.toFixed(0)} s`; });
    bus.on('police:escaped', () => { ended ||= `escaped at ${T.toFixed(0)} s`; });
    for (let f = 0; f < secs * 30 && !(ended && T > 3); f++) {
      T = f / 30;
      if (!stop) {
        if (!ai.route.length || ai.idx >= ai.route.length - 3) plan();
        ai.update(1 / 30, G.traffic.cars);
        if (ai.needsReset) { ai.needsReset = false; G.resetPlayer(); ai.route = []; }
        ctl = { ...v.controls };
      }
      step();
      if (G.state.mode !== 'drive') G.resume?.();
      if (f % 30) continue;
      if (f % 150 === 0) await sleep(5);
      dist += Math.hypot(s.x - lx, s.z - lz); lx = s.x; lz = s.z;
      yielding += G.traffic.cars.filter((c) => c.yieldT > 0).length;
      const ds = [];
      for (const u of PM.units) {
        const I = info.get(u); if (!I) continue;
        const q = u.vehicle.state, d = Math.hypot(q.x - s.x, q.z - s.z), sp = Math.hypot(q.vx, q.vz);
        ds.push(Math.round(d)); I.minD = Math.min(I.minD, d);
        if (u.disabled || u.role === 'roadblock') continue;
        if (!W.onCarriageway(q.x, q.z, 0.6)) { if (++I.off === 2 && off.length < 8) off.push(`${T.toFixed(0)}s unit${u.id} ${fmt(q.x, q.z)} ${Math.round(sp * 3.6)} km/h ${u.ai.mode}`); } else I.off = 0;
        if (sp < 0.5 && d > 15) { if (++I.still === 5 && stuck.length < 8) stuck.push(`${T.toFixed(0)}s unit${u.id} ${fmt(q.x, q.z)} ${u.ai.mode}${u.ai.turning ? ' turning' : ''} route ${u.ai.route.length} d ${d.toFixed(0)}`); } else I.still = 0;
      }
      if (f % 300 === 0) gaps.push(`${T.toFixed(0)}s ${PM.state} heat ${PM.heat} player ${Math.round(Math.hypot(s.vx, s.vz) * 3.6)} km/h units [${ds.join(' ')}]`);
    }
    return { ended: ended || `neither in ${secs} s`, km: +(dist / 1000).toFixed(2), units: info.size, closest: [...info.values()].map((I) => Math.round(I.minD)), spawns, off, stuck, hits, hitAt, knockBy, yielding, gaps, timeline };
  }, [x0, z0, heat, secs, stop]);
  console.log(`== ${name} heat ${heat}${stop ? ' (standing)' : ''}: ${res.ended}, player ${res.km} km · units ${res.units}, closest [${res.closest.join(' ')}] · hits ${JSON.stringify(res.hits)} · traffic knocked ${JSON.stringify(res.knockBy)} · making way ${res.yielding} car-s · errors ${errs.length}`);
  for (const k of ['spawns', 'off', 'stuck', 'hitAt', 'gaps', 'timeline']) if (res[k].length) console.log(`   ${k}: ${res[k].join(' | ')}`);
  if (errs.length) console.log('   errors: ' + errs.slice(0, 4).join(' | '));
  await p.close();
}
await b.close();
