// The Modes & races cards' pictures (src/game/ModePics.js): a truck just past each event's start banner, seen from the
// front, and at home for free roam; taken in the game, in the open world, on high graphics. Needs playwright (or
// playwright-core and a Chromium) and the game served (node server.js):
//   node tools/modepics.cjs <baseUrl> [chromium] [name...]     -> public/assets/ui/modes/<map>-<event>.webp
// With no names: the open world's cards that have no picture yet. A name is a picture's (coast-konkanloop, world-free).
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('playwright')); }

const W = 600, H = 250, PAINT = '#b5532c';
// (the ground's detail, the grass and the trees' models round a new place: the ground built as fast as on the loading
// screen, then a few frames for the rest)
const SETTLE_MS = 6000, SETTLE_FRAMES = 12, BUDGET = 400;

(async () => {
  const [base = 'http://127.0.0.1:3000/', a2, ...rest] = process.argv.slice(2);
  const exe = a2 && fs.existsSync(a2) ? a2 : undefined, only = (exe ? rest : [a2, ...rest]).filter(Boolean);
  const out = path.join(__dirname, '..', 'public', 'assets', 'ui', 'modes');
  const have = new Set(fs.readdirSync(out).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)));
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base);
  await page.evaluate((paint) => localStorage.setItem('trailbreak.settings', JSON.stringify({
    name: 'Pictures', map: 'world', truck: 'thar', paint, hour: 16.5, weather: 'clear', fullscreen: false, quality: 'high', autoQuality: false, sound: false,
  })), PAINT);
  await page.reload();
  await page.waitForSelector('#solo', { state: 'visible', timeout: 180000 });
  await page.evaluate(() => document.getElementById('solo').click());
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30 * 60000, polling: 1000 });
  if (only.length) {
    // (named pictures: as soon as their events are on the list)
    console.log('the game is up; waiting for', only.join(', '));
    await page.evaluate(async () => { window.__modePic = (await import('/src/game/ModePics.js')).modePic; });
    // (a plain test: one that returns a promise is taken as true at once)
    await page.waitForFunction((names) => {
      const g = window.game, known = new Set(['free', ...g.events.events].map((e) => window.__modePic(g.world.map.id, e)));
      return names.every((n) => known.has(n));
    }, only, { timeout: 60 * 60000, polling: 3000 });
  } else {
    console.log('the game is up; waiting for every map');
    // (every map in and drawn: the world's own races join the list with the last of them)
    await page.waitForFunction(() => { const g = window.game; return g.world.complete && (g.world.view?.views.length ?? 0) >= (g.world.total || 0); }, null, { timeout: 60 * 60000, polling: 2000 });
    await page.waitForTimeout(3000);
  }
  const cards = await page.evaluate(async () => {
    const { modePic } = await import('/src/game/ModePics.js');
    const g = window.game, mapId = g.world.map.id;
    // the frames counted, the truck held where it is put, the camera in front of it and a little to its left, low
    window.__frames = 0; window.__grab = null;
    const frame = g.frame.bind(g);
    g.frame = (dt) => {
      frame(dt);
      window.__frames++;
      // (in the frame's own turn: the picture is still on the canvas)
      if (window.__grab) { const done = window.__grab; window.__grab = null; done(g.renderer.renderer.domElement.toDataURL('image/webp', 0.86)); }
    };
    const input = g.input.update.bind(g.input);
    // (the handbrake alone: a stopped truck takes the brake pedal for reverse, and backed away from the start line)
    g.input.update = (dt) => { const c = input(dt); c.throttle = 0; c.brake = 0; c.handbrake = 1; c.steer = 0; return c; };
    const cam = g.cam.update.bind(g.cam);
    g.cam.mode = 'front';
    g.cam.update = (dt, truck, controls) => { g.cam.yaw = -0.5; g.cam.pitch = 0.07; return cam(dt, truck, { ...controls, lookX: 0, lookY: 0, looking: true }); };
    for (const id of ['hud', 'toasts', 'hint']) { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; }
    return [{ id: 'free', name: modePic(mapId, 'free'), title: 'Free roam' }, ...g.events.events.filter((e) => e.id !== 'custom').map((e) => ({ id: e.id, name: modePic(mapId, e), title: e.name }))];
  });
  const todo = cards.filter((c) => (only.length ? only.includes(c.name) : !have.has(c.name)));
  console.log(`${cards.length} cards, ${cards.filter((c) => have.has(c.name)).length} with a picture; taking ${todo.length}`);
  for (const c of todo) {
    const where = await page.evaluate(([id, budget]) => {
      const g = window.game, v = g.vehicle;
      if (id !== 'free') {
        const e = g.events.byId.get(id);
        if (!e) return null;
        // (7 m down the course from its start line: the banner behind the truck, the truck's face to the camera)
        const s = e.start, yaw = s.yaw ?? 0, d = 7;
        if (v.winch.attached) v.detachWinch();
        v.place(g.world, s.x + Math.sin(yaw) * d, s.z + Math.cos(yaw) * d, yaw);
      }
      g.cam.heading = null;
      g.terrain.budget = budget;                     // (each time: a map that came in since has its own)
      window.__f0 = window.__frames;
      // (where it stands, and the ground and any water there: a start line in a ford shows the truck in the water)
      const ground = g.world.height(v.pos.x, v.pos.z), water = g.world.water?.(v.pos.x, v.pos.z) ?? -1e9;
      window.__at = [v.pos.x, v.pos.z];
      return [Math.round(v.pos.x), Math.round(v.pos.z), water > ground ? `in ${(water - ground).toFixed(1)} m of water` : 'dry'];
    }, [c.id, BUDGET]);
    if (!where) { console.log(c.name, 'no such event'); continue; }
    await page.waitForTimeout(SETTLE_MS);
    await page.waitForFunction((n) => window.__frames - window.__f0 >= n && !window.game.pendingTravel, SETTLE_FRAMES, { timeout: 30 * 60000, polling: 1000 });
    const url = await page.evaluate(() => new Promise((done) => { window.__grab = done; }));
    // (and how far it rolled while the place settled: it should stand where it was put)
    const moved = await page.evaluate(() => Math.hypot(window.game.vehicle.pos.x - window.__at[0], window.game.vehicle.pos.z - window.__at[1]).toFixed(1));
    if (moved > 1.5) console.log(`  ${c.name}: the truck rolled ${moved} m while the place settled`);
    fs.writeFileSync(path.join(out, `${c.name}.webp`), Buffer.from(url.split(',')[1], 'base64'));
    console.log(c.name, `(${c.title})`, 'at', where.join(', '), Math.round(url.length * 0.75 / 1024), 'KB');
  }
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
  process.exit(0);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
