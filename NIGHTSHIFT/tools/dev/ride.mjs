// Ride the roads: an AI drives the player's car along random routes from a place (lanes, keep left; no traffic, no
// police) and logs what a driver would feel: the car leaving the ground, hard landings, jolts (sudden vertical
// speed), a bang into something solid, stopping dead where the road goes on, leaving the road, resets. Rendering off.
//   node tools/dev/ride.mjs --port N --at x,z [--minutes 4] [--seed 1] [--car id | --steal type]
// (--steal: a traffic vehicle taken as the player would - a scooter, a Bullet, an auto, a bus - and ridden instead)
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, minutes = +(args.minutes || 4), seed = +(args.seed || 1), car = args.car || '', steal = args.steal || '', start = (args.at || '98200,211600').split(',').map(Number);
const b = await launch(); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = []; p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
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
    if (G.traffic.enabled || G.traffic.cars.length) { G.traffic.enabled = false; G.traffic.clear(); }
    ai.update(1 / 30, []);
    if (ai.needsReset) { ai.needsReset = false; add('reset (stuck)', 0); G.resetPlayer(); ai.route = []; }
    const c = { ...v.controls };
    G.input.update = () => Object.assign(G.input.controls, c, { lookX: 0, lookY: 0, lookBack: false });
    caught.length = 0;
    step();
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
  return { km: +(dist / 1000).toFixed(1), routes, car: v.carId, ev };
}, [minutes, seed, start, steal, car]);
const by = {};
for (const e of res.ev) (by[e.kind] ||= []).push(e);
console.log(`ride from ${start.join(',')}: car ${res.car}, ${res.km} km, ${res.routes} routes`);
for (const [k, list] of Object.entries(by)) {
  list.sort((a, b) => Math.abs(b.val) - Math.abs(a.val));
  console.log(`  ${k}: ${list.length}  worst: ${list.slice(0, 6).map((e) => `${e.val}@${e.at} ${e.kmh}km/h${e.extra ? ' [' + e.extra + ']' : ''}`).join('  ')}`);
}
if (errs.length) console.log('errors', errs.slice(0, 5));
await b.close();
