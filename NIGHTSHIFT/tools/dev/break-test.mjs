// Breakaway props check: aims the player at the nearest street lamp and at a row of sidewalk
// clutter, simulates at 60 Hz and reports what broke, the speed kept and debris state.
//   node tools/dev/break-test.mjs --port 3000 [--out dir]
import path from 'node:path';
import { launch } from './pw.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]); return acc; }, []));
const port = args.port || 3000;
const b = await launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2',timeOfDay:'${args.time || 'night'}'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 120000 });
const res = await p.evaluate(() => {
  const G = window.NIGHTSHIFT;
  G.play();
  const inp = G.input; let ctl = {};
  inp.update = function () { Object.assign(this.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false }, ctl); };
  const r = G.rm.render; G.rm.render = () => {};
  const step = (n, c) => { ctl = c; for (let i = 0; i < n; i++) { G.last = performance.now(); G._update(1 / 60); inp.endFrame(); } };
  const out = {};
  const breaks = [];
  G.debugBreaks = breaks;
  const sub = (e) => breaks.push({ type: e.p?.type, speed: +e.speed.toFixed(1) });
  window.__bus?.on?.('prop:break', sub);
  // 1) lamp: nearest lamp to a downtown spot, approach it along the sidewalk axis at speed
  const lamps = G.world.planner.props.filter((q) => q.type === 'lamp' && q.collider && Math.abs(q.x - 153.3) < 0.5 && q.z > -300 && q.z < -180);
  const L = lamps[0];
  // approach from the road at ~25 degrees, like running wide out of a lane
  const aim = (q, back) => { const sx = q.x + 6 * Math.sign(160 - q.x || 1), sz = q.z - back; G.player.place(sx, sz, Math.atan2(q.x - sx, q.z - sz)); G.camCtl.snap(G.player); };
  aim(L, 30);
  out.start = [G.player.state.x.toFixed(1), G.player.state.z.toFixed(1), G.player.state.yaw.toFixed(2)];
  step(120, { throttle: 1 });
  const before = Math.hypot(G.player.state.vx, G.player.state.vz) * 3.6;
  let hitAt = -1;
  for (let i = 0; i < 120 && hitAt < 0; i++) { step(1, { throttle: 1 }); if (L.collider.broken) hitAt = i; }
  const after = Math.hypot(G.player.state.vx, G.player.state.vz) * 3.6;
  out.lamp = { at: [L.x.toFixed(1), L.z.toFixed(1)], broken: !!L.collider.broken, kmhBefore: before.toFixed(0), kmhAfter: after.toFixed(0), debris: G.debris.items.length };
  step(90, { throttle: 0.3 });
  const it = G.debris.items.find((d) => d.p === L);
  out.lamp.theta = it ? +it.theta.toFixed(2) : null;
  out.lamp.lightsOff = !G.world.lights.lamps.some((h) => h[4] === L);
  // 2) clutter: meters/bins along a sidewalk
  const small = G.world.planner.props.filter((q) => q.collider && ['meter', 'bin', 'hydrant'].includes(q.type) && !q.broken && Math.abs(q.x - L.x) < 1.5 && Math.abs(q.z - L.z) > 30 && Math.abs(q.z - L.z) < 140 && Math.abs(((q.z % 160) + 160) % 160 - 80) < 50);
  const S = small[0];
  aim(S, 14);
  for (let i = 0; i < 160 && !S.collider.broken; i++) step(1, { throttle: 0.8 });
  out.small = { type: S.type, broken: !!S.collider.broken, debris: G.debris.items.length, kmh: (Math.hypot(G.player.state.vx, G.player.state.vz) * 3.6).toFixed(0) };
  step(120, { throttle: 0 });
  const d2 = G.debris.items.find((d) => d.p === S);
  out.small.rest = d2?.rest ?? null;
  out.brokenTypes = (G.world.broken || []).map((c) => c.prop?.type);
  out.small.y = d2 ? +d2.g.position.y.toFixed(2) : null;
  // camera on the fallen lamp
  G.rm.render = r;
  G.camCtl.update = function () { const c = this.camera; c.position.set(L.x + 9, 5, L.z - 12); c.lookAt(L.x + 1, 0.5, L.z + 3); c.fov = 55; c.updateProjectionMatrix(); };
  return out;
});
await p.waitForTimeout(2500);
if (args.out) await p.screenshot({ path: path.join(args.out, 'break.png') });
console.log(JSON.stringify(res, null, 1));
console.log('errors', errors.slice(0, 5));
await b.close();
