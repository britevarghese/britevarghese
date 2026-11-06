// The game on a phone (Playwright's device emulation, held sideways): the main menu, driving with the touch controls,
// the pause menu and the garage opened from it. Screenshots <out>-menu/-drive/-pause/-garage.png, and what's on screen.
//   node tools/dev/phone.mjs [--port N] [--device 'Pixel 7'] [--out DIR/name]
import { PW, launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const dev = args.device || 'Pixel 7', out = args.out || './phone', port = args.port || 3311;
const b = await launch();
const D = PW.devices[dev]; const vp = D.viewport.width < D.viewport.height ? { width: D.viewport.height, height: D.viewport.width } : D.viewport;
const ctx = await b.newContext({ ...D, viewport: vp, screen: { width: vp.width, height: vp.height } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await p.addInitScript(`localStorage.clear()`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 400000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: out + '-menu.png' });
const q = await p.evaluate(() => ({ quality: window.NIGHTSHIFT.settings?.graphics?.quality, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, touch: !!document.querySelector('[class*=touch], #touch, .tc') }));
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 300000 });
await p.waitForTimeout(8000);
await p.screenshot({ path: out + '-drive.png' });
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.input.pressed.add('pause'); });
await p.waitForTimeout(1500);
await p.screenshot({ path: out + '-pause.png' });
console.log('pause items: ' + await p.evaluate(() => [...document.querySelectorAll('.pause-box .menu-item')].map((b) => b.textContent).join(', ')));
await p.evaluate(() => { const b = [...document.querySelectorAll('.pause-box .menu-item')].find((x) => x.textContent === 'GARAGE'); b?.click(); });
await p.waitForTimeout(5000);
console.log('after GARAGE: mode ' + await p.evaluate(() => window.NIGHTSHIFT.state.mode));
await p.screenshot({ path: out + '-garage.png' });
// the touch layer: what's on screen
const t = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 20 && r.height > 20 && s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && (e.id || e.className) && r.right > 0 && r.bottom > 0; }).map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ').slice(0, 2).join('.') : ''} ${r.x | 0},${r.y | 0} ${r.width | 0}x${r.height | 0}`; }).slice(0, 60));
console.log(JSON.stringify({ dev, vp, ...q }));
console.log(t.join('\n'));
if (errs.length) console.log('errors: ' + errs.slice(0, 5).join(' | '));
await b.close();
