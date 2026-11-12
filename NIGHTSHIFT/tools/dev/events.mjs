// Random street events (Kerala): forces an offer while driving, takes it (E), then rams the thief - the car set down a
// few metres behind it and floored into it, until the hits count - and logs the offer, the chase and the pay.
//   node tools/dev/events.mjs --port 3000 [--kind snatch|auto]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000;
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 180000 });
const res = await p.evaluate(async (kind) => {
  const G = window.NIGHTSHIFT, R = { log: [] }, log = (t) => R.log.push(t);
  G.save.data.story.prologueOffered = true; await G.play(); G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
  G.police.enabled = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { AIDriver } = await import('/src/vehicles/AIDriver.js');
  const { EVENTS } = await import('/src/kerala/KeralaEvents.js');
  const L = G.world.layout, s = G.player.state, ai = new AIDriver(G.player, { skill: 0.9, maxSpeed: 14 });
  const drive = (n) => { for (let i = 0; i < n; i++) {
    if (!ai.route.length || ai.idx >= ai.route.length - 2) { const ids = L.route(L.nearestNode(s.x, s.z), L.nodes[(i * 7919) % L.nodes.length] ? (i * 7919) % L.nodes.length : 0); ai.setRoute(ids.map((id) => [L.nodes[id].x, L.nodes[id].z])); }
    ai.update(1 / 30, G.traffic.cars); if (ai.needsReset) { ai.needsReset = false; G.resetPlayer(); }
    const c = { ...G.player.controls }; G.input.update = () => Object.assign(G.input.controls, c, { lookX: 0, lookY: 0 }); G._update(1 / 30);
  } };
  for (let i = 0; i < 10; i++) { drive(30); await sleep(100); }
  const E = G.streetEvents;
  if (kind) EVENTS.sort((a) => (a.id === kind ? -1 : 1));
  const rnd = Math.random; Math.random = () => 0.01; E.wait = 0;
  for (let i = 0; i < 40 && !E.offer; i++) { drive(5); await sleep(50); }
  Math.random = rnd;
  if (!E.offer) { R.log.push('no offer'); return R; }
  log(`offer: ${E.offer.ev.title}, route ${E.offer.route.map((q) => Math.round(Math.hypot(q.x - s.x, q.z - s.z)) + ' m').join(' / ')}`);
  R.prompt = (E.promptHtml || '').replace(/<[^>]+>/g, '').slice(0, 120);
  G.input.pressed.add('event'); G._update(1 / 30);
  log(`story active: ${!!G.story.active}, step ${G.story.active?.m.steps[G.story.active.i]?.type}`); const msg0 = G.hud.message.bind(G.hud); G.hud.message = (a, b2, ...r) => { log(`hud: ${a} ${b2 || ''}`); return msg0(a, b2, ...r); };
  let pay = null; const { bus } = await import('/src/core/EventBus.js'); bus.on('job:pass', (e) => { pay = e.pay; });
  const c0 = G.save.data.cash;
  let t = 0, hits = 0;
  while (t < 120 && G.story.active) {
    const S = G.story.active.st, v = S?.v;
    if (v && S.moving && (S.hitCd || 0) <= 0 && !S.stopped && t - (R.lastHop || -9) > 1.5) {
      R.lastHop = t;
      // behind it, a few metres back, flat out into its tail
      const vs = v.state; G.player.place(vs.x - Math.sin(vs.yaw) * 6, vs.z - Math.cos(vs.yaw) * 6, vs.yaw);
      G.player.physics.s.vx = Math.sin(vs.yaw) * (Math.hypot(vs.vx, vs.vz) + 9); G.player.physics.s.vz = Math.cos(vs.yaw) * (Math.hypot(vs.vx, vs.vz) + 9);
    }
    G.input.update = () => Object.assign(G.input.controls, { throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: false, lookX: 0, lookY: 0 });
    G._update(1 / 30); t += 1 / 30;
    if (G.story.active?.st?.hits > hits) { hits = G.story.active.st.hits; log(`${t.toFixed(1)}s hit ${hits}`); }
    if (Math.round(t * 30) % 60 === 0) { await sleep(20); if (!S?.v) log(`${t.toFixed(0)}s waiting for the ${E.current?.vehicle} (spawned: ${!!S?.v})`); }
  }
  R.pay = pay; R.cashDelta = G.save.data.cash - c0; R.t = Math.round(t); R.events = G.save.data.events;
  await sleep(4200); R.toasts = [...document.querySelectorAll('.toast')].map((e) => e.textContent).slice(-2);
  return R;
}, args.kind || null);
console.log(JSON.stringify({ ...res, errors }, null, 1));
await b.close();
