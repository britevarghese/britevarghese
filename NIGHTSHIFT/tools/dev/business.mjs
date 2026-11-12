// Kerala businesses: the FOR SALE boards round the start (where each was put, beside the road), buying one with E,
// a payout, the auto stand's boost on taxi fares, the phone's Business app. Screenshot <out>.png at a board.
//   node tools/dev/business.mjs --port 3000 [--out DIR/name]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3000, out = args.out || './business';
const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2',timeOfDay:'day'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 180000 });
const res = await p.evaluate(async () => {
  const G = window.NIGHTSHIFT, W = G.world, R = {};
  G.save.data.story.prologueOffered = true; G.save.data.cash = 200000; await G.play(); G.rm.renderer.setAnimationLoop(null); window._r = G.rm.render.bind(G.rm); G.rm.render = () => {};
  const step = (n) => { for (let i = 0; i < n; i++) G._update(1 / 30); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) { step(10); await sleep(150); }
  const B = G.biz;
  R.boards = B.list.map((b) => { const m = B.marks.get(b.id); return `${b.id}: ${m ? `board ${Math.hypot(m.spot.x - b.c.x, m.spot.z - b.c.z).toFixed(0)} m from ${b.place}, on road ${W.onCarriageway(m.spot.x, m.spot.z)}` : `not yet (${(Math.hypot(b.c.x - G.player.state.x, b.c.z - G.player.state.z) / 1000).toFixed(1)} km)`}`; });
  // walk to the thattukada and buy it
  const m = B.marks.get('thattukada');
  if (!m) return R;
  G.player.controls.handbrake = 1; G.onFoot.exit(); step(60);
  const F = G.onFoot.state; F.x = m.spot.x + 2; F.z = m.spot.z; F.y = G.onFoot._ground(F.x, F.z); step(5);
  R.prompt = B.promptHtml?.replace(/<[^>]+>/g, '');
  const c0 = G.save.data.cash; G.input.pressed.add('event'); step(3);
  R.bought = B.owns('thattukada'); R.paid = c0 - G.save.data.cash;
  step(3); R.rebuilt = B.marks.get('thattukada')?.owned;
  // a payout
  B.data.clock = 299.9; const c1 = G.save.data.cash; step(10); R.payout = G.save.data.cash - c1;
  // the auto stand's boost
  R.boostBefore = B.boost('taxi'); B.data.owned.auto_stand = 1; R.boostAfter = B.boost('taxi');
  G.phone.open(); G.phone.business(); R.app = [...document.querySelectorAll('.phone-item')].slice(0, 3).map((e) => e.textContent); R.title = document.querySelector('.phone-title').textContent; G.resume();
  // a look at the board
  F.x = m.spot.x + Math.sin(m.spot.face) * 7; F.z = m.spot.z + Math.cos(m.spot.face) * 7; F.yaw = m.spot.face + Math.PI; G.onFoot.camYaw = F.yaw; step(30);
  G.rm.render = window._r; G._update(1 / 30); G.rm.render = () => {};
  return R;
});
await p.screenshot({ path: out + '.png' });
console.log(JSON.stringify({ ...res, errors }, null, 1));
await b.close();
