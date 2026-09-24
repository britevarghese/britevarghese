// Gameplay smoke test: loads the game headless, AI-drives the player through the city, runs a
// sprint race and a heat-3 pursuit with rendering disabled (fast), and reports errors.
//   node tools/dev/smoke.mjs --port 3000 [--seconds 180]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000, seconds = +(args.seconds || 180);
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => (window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu') || !document.getElementById('fatal').classList.contains('hidden'), null, { timeout: 120000 });
const result = await p.evaluate(async (seconds) => {
  const G = window.NIGHTSHIFT;
  if (!G) return { fatal: document.getElementById('fatal-msg').textContent };
  const { AIDriver } = await import('/src/vehicles/AIDriver.js');
  const { bus } = await import('/src/core/EventBus.js');
  const events = [];
  for (const n of ['race:finished', 'race:checkpoint', 'police:pursuit', 'police:busted', 'police:escaped', 'police:roadblock']) bus.on(n, () => events.push(n));
  G.play();
  G.rm.render = () => {}; G.rm.renderer.setAnimationLoop(null);
  const L = G.world.layout;
  const drive = (ai, n, loopRoute) => {
    let dist = 0, lx = G.player.state.x, lz = G.player.state.z;
    for (let i = 0; i < n; i++) {
      if (loopRoute && (!ai.route.length || ai.idx >= ai.route.length - 2)) { const s = G.player.state; const to = L.nodes[(i * 7919) % 169]; ai.setRoute(L.route(L.nearestNode(s.x, s.z), to).map((id) => [L.nodes[id].x, L.nodes[id].z])); }
      ai.update(1 / 30, G.traffic.cars);
      if (ai.needsReset) { ai.needsReset = false; G.resetPlayer(); if (loopRoute) ai.route = []; }
      const c = { ...G.player.controls };
      G.input.update = () => Object.assign(G.input.controls, c, { lookX: 0, lookY: 0, lookBack: false });
      G._update(1 / 30);
      if (G.state.mode !== 'drive' && G.state.mode !== 'busted') G.resume();
      const s = G.player.state; dist += Math.hypot(s.x - lx, s.z - lz); lx = s.x; lz = s.z;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.z)) return { dist, nan: true };
    }
    return { dist: Math.round(dist) };
  };
  const out = {};
  const ai = new AIDriver(G.player, { skill: 0.95, maxSpeed: 50 });
  out.freeRoam = drive(ai, seconds * 30, true);
  // race
  G.police.enabled = false;
  const ev = G.races.events.find((e) => e.def.id === 'sprint_river');
  G.startEvent(ev);
  const rai = new AIDriver(G.player, { skill: 1, maxSpeed: 70 }); rai.setRoute(ev.route.map((q) => [q[0], q[1]]), false, 3);
  out.race = drive(rai, 30 * 240, false);
  out.raceFinished = events.includes('race:finished');
  // pursuit
  G.police.enabled = true; G.races.abort();
  G.police.startPursuit(3, 'smoke');
  out.pursuit = drive(new AIDriver(G.player, { skill: 0.95, maxSpeed: 55 }), 30 * 90, true);
  out.events = events;
  out.traffic = G.traffic.count(); out.chunks = G.world.chunks.stats;
  return out;
}, seconds);
console.log(JSON.stringify({ ...result, errors: errors.slice(0, 10) }, null, 1));
await b.close();
process.exit(errors.length || result.fatal ? 1 : 0);
