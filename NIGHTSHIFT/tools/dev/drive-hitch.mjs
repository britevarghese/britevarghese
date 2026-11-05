// Frame hitches on a Kerala drive: an AI drives the player's car along random routes from a place, traffic, people and
// the tiles' builds all running (rendering off), each frame's step timed: how many over 16 / 33 / 50 / 100 ms, and for
// each one over 33 ms the subsystems that took the most of it and the tile-build step under way.
//   node tools/dev/drive-hitch.mjs --port N [--at x,z] [--minutes 3] [--seed 1] [--car id]
// (a frame over ~100 ms with nothing standing out is usually the garbage collector: trace it with CDP to be sure)
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, minutes = +(args.minutes || 3), seed = +(args.seed || 1), car = args.car || '', steal = args.steal || '', start = (args.at || '98200,211600').split(',').map(Number);
const b = await launch(); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = []; p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
await p.evaluate((car) => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; if (car) G.save.data.currentCar = car; G.play(); }, car);
await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
const res = await p.evaluate(async ([minutes, seed, start, steal, car]) => {
  const G = window.NIGHTSHIFT, W = G.world; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // (the car is made at boot, before the menu: another one spawned in its place, its model loaded first)
  if (car && G.player.carId !== car) {
    await G.lib.load([car]); for (let i = 0; i < 100 && !G.lib.has(car); i++) await sleep(100);
    G.save.data.currentCar = car; G.save.data.cars[car] ||= structuredClone(G.save.data.cars[G.player.carId]); G.spawnPlayer();
  }
  const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
  G.police.enabled = false; G.traffic.enabled = false; G.traffic.clear();
  G.player.place(start[0], start[1], 0); W.prioritize?.([{ x: start[0], z: start[1] }]);
  let placed = false;
  for (let i = 0; i < 600 && !placed; i++) { for (let k = 0; k < 5; k++) step(); await sleep(100); if (i < 40 || i % 10) continue; const n = G.traffic.graph.nearest(start[0], start[1], (l) => l.edge?.cls <= 7); if (n && n.dist < 250) { G.player.place(n.x, n.z, Math.atan2(n.dx, n.dz)); placed = true; } }
  if (!placed) return { km: 0, routes: 0, ev: [{ kind: 'NO LANE NEAR THE START', val: 0, at: start.join(','), kmh: 0, extra: '' }] };
  for (let i = 0; i < 30; i++) step();
  if (steal) {
    // taken from the traffic as the player would: out of the car, onto it (the game's own way of making it drivable)
    const { TRAFFIC_VEHICLES } = await import('/src/vehicles/VehicleCatalog.js');
    if (!TRAFFIC_VEHICLES[steal]) return { km: 0, routes: 0, ev: [{ kind: `NO TRAFFIC VEHICLE '${steal}'`, val: 0, at: '', kmh: 0, extra: '' }] };
    await G.lib.load([steal]); for (let i = 0; i < 100 && !G.lib.has(steal); i++) await sleep(100);
    const q = G.player.state, F = G.onFoot;
    F.exit(); for (let i = 0; i < 200 && !F.active; i++) step();
    const v = F._jack({ type: steal, x: q.x, z: q.z, yaw: q.yaw, spec: {}, color: 0x3366aa });
    if (!v) return { km: 0, routes: 0, ev: [{ kind: `COULDN'T TAKE A ${steal}`, val: 0, at: '', kmh: 0, extra: '' }] };
    F._board(v); for (let i = 0; i < 30; i++) step();
  }
  const { AIDriver } = await import('/src/vehicles/AIDriver.js');
  const L = W.layout, v = G.player, ph = v.physics, s = v.state;
  const caught = []; { const up = v.update.bind(v); v.update = (dt) => { const ev = up(dt); caught.push(...ev); return ev; }; }
  const ai = new AIDriver(v, { skill: 0.85, maxSpeed: 19 });
  const cur = {}, wrap = (obj, name, label) => { if (!obj?.[name]) return; const o = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const r = o(...a); cur[label] = (cur[label] || 0) + performance.now() - t0; return r; }; };
  wrap(G.traffic, 'update', 'traffic'); wrap(G.trafficRenderer, 'update', 'trafficRender'); wrap(G.peds, 'update', 'peds'); wrap(W, 'update', 'world'); wrap(G.player, 'update', 'player'); wrap(G.police, 'update', 'police'); wrap(G.hud, 'update', 'hud'); wrap(G.camCtl, 'update', 'camera'); wrap(G.fx, 'update', 'fx'); wrap(G.env, 'update', 'env'); wrap(G.rivals, 'update', 'rivals'); wrap(G.incidents, 'update', 'incidents'); wrap(G.story, 'update', 'story'); wrap(G.mapRenderer, 'update', 'map'); wrap(G.boats, 'update', 'boats'); wrap(G.klPolice, 'update', 'klPolice'); wrap(G.onFoot, 'updateParked', 'parked'); wrap(G.replay, 'record', 'replay'); wrap(W, '_unloadTile', 'unload'); wrap(G.hud, '_drawMinimap', 'minimap'); wrap(G.hud, '_drawSpeedo', 'speedo'); wrap(G.hud, '_trackBanner', 'banner'); wrap(G.klPolice, '_makeCheck', 'mkCheck'); wrap(G.klPolice, '_placePosts', 'posts'); wrap(G.klPolice, '_findJam', 'findJam'); wrap(G.peds, '_spawn', 'pedSpawn'); wrap(G.peds, '_spawnGroups', 'pedGroups'); wrap(G.peds, '_assignPeople', 'pedAssign'); wrap(G.peds.humans, 'create', 'humanCreate'); wrap(G.peds, '_drawDown', 'pedDown'); wrap(W.trees, 'update', 'trees'); wrap(W, '_treeColliders', 'treeCol'); wrap(W.teaBushes, 'update', 'tea'); wrap(W, 'fetchTile', 'fetch'); wrap(W.lanes, 'removeTile', 'laneRm'); wrap(W.collision, 'remove', 'colRm');
  const slow = [], hist = [0, 0, 0, 0]; let steps = 0, tsum = 0;
  let rnd = seed * 9301 + 49297; const R = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  const ev = [], add = (kind, val, extra = '') => ev.push({ kind, val: +val.toFixed(2), at: `${s.x.toFixed(0)},${s.z.toFixed(0)}`, kmh: Math.round(Math.abs(s.speed) * 3.6), extra });
  let dist = 0, lx = s.x, lz = s.z, prevVy = 0, prevSp = 0, routes = 0, air = 0, off = null, lastOn = [s.x, s.z], extT = 0, lane = null;
  for (let i = 0; i < minutes * 60 * 30; i++) {
    // (the next leg on from where this one ends, the way it came in, before the car gets there)
    if (ai.route.length > 1 && ai.idx < ai.route.length - 3 && (extT -= 1 / 30) <= 0 && ai.remaining(200) < Math.max(80, Math.abs(s.speed) * 5)) {
      extT = 1;
      const r = ai.route, e = r[r.length - 1], e0 = r[r.length - 2], h = Math.atan2(e[0] - e0[0], e[1] - e0[1]);
      const a = h + (R() - 0.5) * 2.4, d = 600 + R() * 1000, dest = L.nearestNode(e[0] + Math.sin(a) * d, e[1] + Math.cos(a) * d);
      const ids = L.deadEnd(dest.id) ? [] : L.route(L.nearestNode(e[0], e[1]), dest, lane);
      if (ids.length > 2) { lane = L.lastLane; ai.extendRoute(ids.map((id) => [L.nodes[id].x, L.nodes[id].z])); routes++; }
    }
    if (!ai.route.length || (ai.idx >= ai.route.length - 3 && Math.abs(s.speed) < 2)) {
      const a = s.yaw + (R() - 0.5) * 2.4, d = 600 + R() * 1000, dest = L.nearestNode(s.x + Math.sin(a) * d, s.z + Math.cos(a) * d);
      const ids = L.deadEnd(dest.id) ? [] : L.route(L.nearestNode(s.x, s.z), dest);
      if (ids.length > 2) {
        const pts = ids.map((id) => [L.nodes[id].x, L.nodes[id].z]), k = pts.findIndex((q) => Math.hypot(q[0] - s.x, q[1] - s.z) > 12);
        const back = k >= 0 && (pts[k][0] - s.x) * Math.sin(s.yaw) + (pts[k][1] - s.z) * Math.cos(s.yaw) < 0;   // (no U-turns at speed)
        if (!back || Math.abs(s.speed) < 2) { lane = L.lastLane; ai.setRoute(pts, false, 0); routes++; }
      }
    }
    ai.update(1 / 30, []);
    if (ai.needsReset) { ai.needsReset = false; add('reset (stuck)', 0); G.resetPlayer(); ai.route = []; }
    const c = { ...v.controls };
    G.input.update = () => Object.assign(G.input.controls, c, { lookX: 0, lookY: 0, lookBack: false });
    caught.length = 0;
    for (const k in cur) cur[k] = 0;
    const t0 = performance.now(); step(); const dt = performance.now() - t0; steps++; tsum += dt;
    if (dt > 16) hist[0]++; if (dt > 33) hist[1]++; if (dt > 50) hist[2]++; if (dt > 100) hist[3]++;
    if (dt > 33) { const top = Object.entries(cur).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '); slow.push(`${dt.toFixed(0)} ms [${top}] job ${W.job?.last || '-'} cars ${G.traffic.cars.length}`); }
    if (G.state.mode !== 'drive') G.resume?.();
    for (const e of caught) {
      if (e.type === 'landing' && e.intensity > 0.15) add('hard landing', e.intensity);
      if (e.type === 'collision' && e.intensity > 0.12) add('hit ' + (e.kind || '?'), e.intensity);
    }
    if (!s.onGround && Math.abs(s.speed) > 4) air += 1 / 30; else { if (air > 0.15) add('airborne s', air); air = 0; }
    const vUp = ph.vUp ?? 0, dv = vUp - prevVy; prevVy = vUp;
    if (s.onGround && Math.abs(dv) > 1.6 && Math.abs(s.speed) > 4) add('jolt (vertical m/s in a frame)', dv);
    const sp = Math.abs(s.speed), dsp = prevSp - sp; prevSp = sp;
    if (dsp > 3) add('sudden stop (m/s lost in a frame)', dsp);
    if (!W.onCarriageway(s.x, s.z, 0.6)) { if (!off) off = { t: 0, at: `${lastOn[0].toFixed(0)},${lastOn[1].toFixed(0)}` }; off.t += 1 / 30; }
    else { lastOn = [s.x, s.z]; off = null; }
    if (off && off.t > 1.5) {
      ev.push({ kind: 'left the road', val: 0, at: off.at, kmh: Math.round(Math.abs(s.speed) * 3.6), extra: '' });
      const n = G.traffic.graph.nearest(lastOn[0], lastOn[1]);
      if (n) v.place(n.x, n.z, Math.atan2(n.dx, n.dz));
      ai.route = []; off = null; prevSp = 0;
    }
    dist += Math.hypot(s.x - lx, s.z - lz); lx = s.x; lz = s.z;
    if (i % 300 === 0) await sleep(5);
  }
  return { km: +(dist / 1000).toFixed(1), routes, car: v.carId, ev, steps, avg: +(tsum / steps).toFixed(2), hist, slow: slow.slice(0, 40), nslow: slow.length, heap: (performance.memory.usedJSHeapSize / 1e6) | 0 };
}, [minutes, seed, start, steal, car]);
const by = {};
for (const e of res.ev) (by[e.kind] ||= []).push(e);
console.log(`ride from ${start.join(',')}: car ${res.car}, ${res.km} km, ${res.routes} routes; steps ${res.steps} avg ${res.avg} ms; >16 ${res.hist[0]} >33 ${res.hist[1]} >50 ${res.hist[2]} >100 ${res.hist[3]}; heap ${res.heap} MB`); for (const l of res.slow) console.log('  ' + l);
for (const [k, list] of Object.entries(by)) {
  list.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
  console.log(`  ${k}: ${list.length}  worst: ${list.slice(0, 6).map((e) => `${e.val}@${e.at} ${e.kmh}km/h${e.extra ? ' [' + e.extra + ']' : ''}`).join('  ')}`);
}
if (errs.length) console.log('errors', errs.slice(0, 5));
await b.close();
