// Phone jobs (taxi fares, parcels): takes a job of each kind and has an AI drive the player's car along the GPS to the
// pickup and on to the drop, logging each stage (where the pickup and drop were, the kerb found, time left, pay).
//   node tools/dev/jobs.mjs --port 3000 [--kinds taxi,parcel] [--limit 600] [--trace 1] [--hop 1: no driving, the car set down beside each target]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000, kinds = (args.kinds || 'taxi,parcel').split(','), limit = +(args.limit || 600);
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => (window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu') || !document.getElementById('fatal').classList.contains('hidden'), null, { timeout: 180000 });
await p.evaluate(async () => {
  const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; await G.play(); G.rm.render = () => {}; G.rm.renderer.setAnimationLoop(null);
  G.police.enabled = false;
  const { AIDriver } = await import('/src/vehicles/AIDriver.js');
  window._AI = AIDriver;
  for (let i = 0; i < 150; i++) G._update(1 / 30);
});
const out = [];
for (const kind of kinds) {
  const r = await p.evaluate(async ({ kind, limit, args_trace, args_hop }) => {
    const G = window.NIGHTSHIFT, log = [], fmt = (x, z) => `${x.toFixed(0)},${z.toFixed(0)}`;
    G.resume();
    const ok = G.phone._jobs().begin(kind), J = G.jobs;
    if (!ok) return { kind, log: ['no job offered'] };
    const j0 = J.job; log.push(`offer: pickup near ${j0.place.name} at ${fmt(j0.pick.x, j0.pick.z)} (${Math.hypot(j0.pick.x - G.player.state.x, j0.pick.z - G.player.state.z).toFixed(0)} m), on road: ${G.world.onCarriageway(j0.pick.x, j0.pick.z)}`);
    const ai = new window._AI(G.player, { skill: 0.9, maxSpeed: 22 });
    let stage = 'pickup', t = 0, routeT = 0, pay = null, failed = null;
    const { bus } = await import('/src/core/EventBus.js');
    const off = bus.on?.('job:done', (e) => { pay = e.pay; });
    const st0 = J.stats.earned;
    while (t < limit) {
      const job = J.job;
      if (!job) break;
      if (job.stage !== stage) { stage = job.stage; log.push(`${t.toFixed(0)}s boarded/collected → ${job.drop.name} ${(job.dist / 1000).toFixed(1)} km, ${job.limit} s on the clock`); ai.route = []; }
      if (job.drop?.spot && !job.spotLogged) { job.spotLogged = true; log.push(`${t.toFixed(0)}s drop kerb at ${fmt(job.drop.spot.x, job.drop.spot.z)}, ${Math.hypot(job.drop.spot.x - job.drop.x, job.drop.spot.z - job.drop.z).toFixed(0)} m from the centre`); }
      if ((routeT -= 1 / 30) <= 0 || ai.idx >= ai.route.length - 1) { routeT = 6; if (G.gps?.route?.length) ai.setRoute(G.gps.route.map((q) => [q[0], q[1]]), false, 0); }
      const T = job.stage === 'pickup' ? job.pick : (job.drop.spot || job.drop), s = G.player.state, d = Math.hypot(T.x - s.x, T.z - s.z);
      if (args_hop) { // set the car down on the road beside the target, stopped (hops are a few seconds apart, so tiles can load)
        if ((job.hopT = (job.hopT ?? 0) - 1 / 30) <= 0 && d > 11) {
          job.hopT = 3;
          const r = G.world.roadSpot(T.x, T.z, 7);
          if (r && Math.hypot(r.x - T.x, r.z - T.z) < 40) { G.player.place(r.x, r.z, r.yaw); G.camCtl.snap(G.player); log.push(`  ${t.toFixed(0)}s hop to the road ${Math.hypot(r.x - T.x, r.z - T.z).toFixed(1)} m from the ${job.stage === 'pickup' ? 'pickup' : job.drop.spot ? 'drop kerb' : 'drop centre'}`); }
          else if (!job.drop?.spot && job.stage === 'drop') { G.player.place(T.x, T.z, 0); }
        }
        G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 1, nitro: false, lookX: 0, lookY: 0, lookBack: false });
        await new Promise((res) => setTimeout(res, 2));
        G._update(1 / 30); t += 1 / 30;
        if (G.state.mode !== 'drive') G.resume();
        if (!J.job && J.nextT > 0) break;
        continue;
      }
      ai.update(1 / 30, G.traffic.cars);
      if (ai.needsReset) { ai.needsReset = false; G.resetPlayer(); ai.route = []; }
      const c = { ...G.player.controls };
      if (d < 22) { c.throttle = d > 7 ? 0.25 : 0; c.brake = d < 10 ? 1 : 0; c.handbrake = 0; if (Math.hypot(s.vx, s.vz) < 0.5 && d < 10) c.brake = 0, c.handbrake = 1; }
      G.input.update = () => Object.assign(G.input.controls, c, { lookX: 0, lookY: 0, lookBack: false });
      G._update(1 / 30); t += 1 / 30;
      if (args_trace && Math.round(t * 30) % 600 === 0) log.push(`  ${t.toFixed(0)}s at ${fmt(s.x, s.z)} ${(Math.hypot(s.vx, s.vz) * 3.6).toFixed(0)} km/h, ${d.toFixed(0)} m to go, ai wp ${ai.idx}/${ai.route.length}, gps pts ${G.gps?.route?.length}, thr ${c.throttle?.toFixed(2)} brk ${c.brake?.toFixed(2)}`);
      if (G.state.mode !== 'drive') G.resume();
      if (!J.job && J.nextT > 0) break;
    }
    const last = J.job;
    if (last) log.push(`unfinished at ${t.toFixed(0)}s: stage ${last.stage}, time left ${last.time?.toFixed(0)}, ${Math.hypot((last.drop?.spot || last.drop || last.pick).x - G.player.state.x, (last.drop?.spot || last.drop || last.pick).z - G.player.state.z).toFixed(0)} m to go`);
    else log.push(`${t.toFixed(0)}s done: paid ${J.stats.earned - st0}`);
    const msg = document.querySelector('.job-obj')?.textContent;
    J.stop(null);
    return { kind, log, msg };
  }, { kind, limit, args_trace: !!args.trace, args_hop: !!args.hop });
  out.push(r);
}
console.log(JSON.stringify({ out, errors }, null, 1));
await b.close();
