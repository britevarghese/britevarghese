// CPU hitch finder: drives a scripted 50 s session at a fixed 60 Hz step (rendering disabled) and
// reports the slowest steps with the subsystem that dominated each one.
//   node tools/dev/hitch-test.mjs --port 3000 [--quality ultra]
import { launch } from './pw.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const q = args.quality || 'ultra', port = args.port || 3000;
const b = await launch();
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'${q}',detectedQuality:'${q}',backend:'webgl2',timeOfDay:'night'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 180000 });
const r = await p.evaluate(() => {
  const G = window.NIGHTSHIFT; G.play(); G.player.place(-5.75, 300, Math.PI); G.camCtl.snap(G.player);
  let ctl = {};
  G.input.update = function () { Object.assign(this.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false }, ctl); };
  G.rm.render = () => {};
  const cur = {};
  const wrap = (obj, name, label) => { if (!obj?.[name]) return; const o = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const r = o(...a); cur[label] = (cur[label] || 0) + performance.now() - t0; return r; }; };
  wrap(G.traffic, 'update', 'traffic'); wrap(G.trafficRenderer, 'update', 'trafficRender'); wrap(G.world.chunks, 'update', 'chunks');
  wrap(G.world.lights, 'update', 'lights'); wrap(G.world.props, 'rebuild', 'propsRebuild'); wrap(G.world.lights, 'rebuild', 'lightsRebuild');
  wrap(G.peds, 'update', 'peds'); wrap(G.fx, 'update', 'fx'); wrap(G.env, 'update', 'env'); wrap(G.camCtl, 'update', 'camera');
  wrap(G.player, 'update', 'player'); wrap(G.police, 'update', 'police'); wrap(G.hud, 'update', 'hud'); wrap(G.races, 'update', 'races');
  wrap(G, '_audio', 'audio'); wrap(G.save, 'update', 'save'); wrap(G.debris, 'update', 'debris'); wrap(G, '_interactions', 'interactions');
  const script = (t) => {
    if (t < 6) return { throttle: 1 };
    if (t < 9) return { throttle: 1, nitro: true };
    if (t < 9.4) return { throttle: 1, steer: 1, handbrake: 1 };
    if (t < 11) return { throttle: 0.8, steer: -0.3 };
    if (t < 20) return { throttle: 1, steer: Math.sin(t * 0.7) * 0.6 };
    if (t < 22) return { brake: 1 };
    if (t < 50) return { throttle: 1, steer: Math.sin(t * 0.4) * 0.8, nitro: t % 8 < 2 };
    return {};
  };
  const steps = [];
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    ctl = script(t);
    for (const k in cur) cur[k] = 0;
    const t0 = performance.now();
    G.last = performance.now(); G._update(1 / 60); G.input.endFrame();
    const ms = performance.now() - t0;
    const top = Object.entries(cur).sort((a, b) => b[1] - a[1])[0] || ['?', 0];
    steps.push({ i, t: +t.toFixed(2), ms: +ms.toFixed(1), top: top[0], topMs: +top[1].toFixed(1) });
    t += 1 / 60;
    if (i === 900 && G.police.state === 'idle') G.police.startPursuit(2, 'test');
  }
  const sorted = [...steps].sort((a, b) => b.ms - a.ms);
  const avg = steps.reduce((a, s) => a + s.ms, 0) / steps.length;
  return { avg: +avg.toFixed(2), over16: steps.filter((s) => s.ms > 16).length, worst: sorted.slice(0, 12), police: G.police.state, units: G.police.units.length, cars: G.traffic.cars.length };
});
console.log(JSON.stringify(r, null, 1));
console.log('errors', errors.slice(0, 5));
await b.close();
