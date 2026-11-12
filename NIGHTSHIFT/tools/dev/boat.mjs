// Driving a boat: finds a bank near the start (land beside open water), walks there, takes a boat (E), drives it about
// (throttle, a turn, full speed), heads for the bank and goes ashore. Logs where the boat went, whether it ever left the
// water, and the prompts; screenshot <out>.png aboard.
//   node tools/dev/boat.mjs --port 3000 [--out DIR/name] [--at x,z]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000, out = args.out || './boat';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2',timeOfDay:'day'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 180000 });
const res = await p.evaluate(async (at) => {
  const G = window.NIGHTSHIFT, W = G.world, R = {}, log = [];
  G.save.data.story.prologueOffered = true; await G.play(); window._r = G.rm.render.bind(G.rm); G.rm.render = () => {}; G.rm.renderer.setAnimationLoop(null);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (n, ctl) => { for (let i = 0; i < n; i++) { if (ctl) G.input.update = () => Object.assign(G.input.controls, { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false, lookX: 0, lookY: 0 }, ctl); G._update(1 / 30); } };
  // a bank: land with open water 5 m off, searched outward from the start (or --at)
  let s0 = G.player.state, cx = at ? at[0] : s0.x, cz = at ? at[1] : s0.z, bank = null;
  for (let tries = 0; tries < 30 && !bank; tries++) {
    for (let r = 50; r < 2500 && !bank; r += 25) for (let k = 0; k < Math.max(8, r / 6); k++) {
      const a = k / Math.max(8, r / 6) * Math.PI * 2, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!W.groundKnown(x, z, 20) || W.inWater(x, z) || !G.onFoot._free(x, z)) continue;
      if (G.boatRide._launch(x, z)) { bank = { x, z }; break; }
    }
    if (!bank) { G.player.place(cx + 300 * tries % 1500, cz, 0); step(30); await sleep(300); }
  }
  if (!bank) return { log: ['no bank found'] };
  R.bank = `${bank.x.toFixed(0)},${bank.z.toFixed(0)} ${Math.hypot(bank.x - s0.x, bank.z - s0.z).toFixed(0)} m from the start`;
  G.player.controls.handbrake = 1; G.onFoot.exit(); step(60);
  const F = G.onFoot; F.state.x = bank.x; F.state.z = bank.z; F.state.y = F._ground(bank.x, bank.z); step(30);
  R.prompt = document.querySelector('#hud .prompt, #prompt, .hud-prompt')?.textContent || G.hud.promptHtml || null;
  const cash0 = G.save.data.cash;
  G.input.pressed.add('event'); step(2);
  R.boarded = G.boatRide.active; R.paid = cash0 - G.save.data.cash;
  if (!R.boarded) return { ...R, log };
  const B = G.boatRide.boat; let dry = 0, maxV = 0, dist = 0, lx = B.x, lz = B.z;
  const drive = (n, ctl, label) => { for (let i = 0; i < n; i++) { step(1, ctl); if (!W.inWater(B.x, B.z)) dry++; maxV = Math.max(maxV, Math.abs(B.v)); dist += Math.hypot(B.x - lx, B.z - lz); lx = B.x; lz = B.z; } log.push(`${label}: at ${B.x.toFixed(0)},${B.z.toFixed(0)} v ${B.v.toFixed(1)} m/s yaw ${(B.yaw * 57.3).toFixed(0)}`); };
  drive(150, { throttle: 1 }, 'throttle 5 s');
  drive(90, { throttle: 1, steer: 1 }, 'right turn 3 s');
  drive(150, { throttle: 1, nitro: true }, 'full 5 s');
  drive(60, { brake: 1 }, 'brake 2 s');
  // head for the bank we left from and go ashore
  for (let i = 0; i < 30 * 40 && !G.boatRide._shore(); i++) {
    const want = Math.atan2(bank.x - B.x, bank.z - B.z); let d = want - B.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    step(1, { throttle: Math.abs(d) < 0.6 ? 0.6 : 0.25, steer: clampS(-d * 2) }); if (!W.inWater(B.x, B.z)) dry++; maxV = Math.max(maxV, Math.abs(B.v));
  }
  function clampS(v) { return Math.max(-1, Math.min(1, v)); }
  drive(60, { brake: 1 }, 'at the bank');
  R.shore = !!G.boatRide._shore();
  G.rm.render = window._r; for (let i = 0; i < 3; i++) G._update(1 / 30);
  return { ...R, log, dry, maxV: +maxV.toFixed(1), dist: Math.round(dist) };
}, args.at ? args.at.split(',').map(Number) : null);
await p.screenshot({ path: out + '.png' });
const after = await p.evaluate(() => { const G = window.NIGHTSHIFT; G.rm.render = () => {}; G.input.pressed.add('event'); G._update(1 / 30); for (let i = 0; i < 30; i++) G._update(1 / 30); const s = G.onFoot.state; return { aboard: G.boatRide.active, moored: !!G.boatRide.moored, onLand: !G.world.inWater(s.x, s.z), y: +s.y.toFixed(2), ground: +G.world.groundHeight(s.x, s.z, s.y + 2).toFixed(2) }; });
console.log(JSON.stringify({ ...res, ashore: after, errors }, null, 1));
await b.close();
