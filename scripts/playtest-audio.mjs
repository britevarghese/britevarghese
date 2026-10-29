// Audio check (no ears needed): renders every sound path of client/js/audio/Audio.js through an OfflineAudioContext
// (the real graph: samples, HRTF panner, filters, reverb, soft-clip bus) and measures level, onset and transient times,
// then plays the real game headless and checks that firing, reloading, switching, walking and a grenade trigger
// their recorded sounds, with no decode / console errors.
//   BASE=http://localhost:3000 node scripts/playtest-audio.mjs [outdir]   (outdir: WAVs of some renders; SKIP_GAME=1: renders only)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.argv[2];
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (p) => {
  p.on('console', (m) => { if ((m.type() === 'error' || /\[audio\]/.test(m.text())) && !/404|Pointer Lock/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errors.push(`pageerror ${e.message}`); });
};

// ---------------------------------------------------------------- A: offline renders
const P = await browser.newPage(); watch(P);
await P.goto(`${BASE}/assets/audio/sounds.json`);
const man = await P.evaluate(() => JSON.parse(document.body.innerText));
const renders = await P.evaluate(async ({ keep }) => {
  const { GameAudio } = await import('/js/audio/Audio.js');
  const SR = 48000;
  let cur = null;
  window.AudioContext = function () { return cur; }; // GameAudio.unlock() builds its graph on the offline context
  cur = new OfflineAudioContext(2, SR, SR);
  const loader = new GameAudio(); loader.unlock();
  const t0 = performance.now();
  while (!loader.loaded && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
  const lib = loader.lib, out = { loadMs: Math.round(performance.now() - t0), sets: {} };
  for (const [k, v] of Object.entries(lib)) out.sets[k] = v.map((t) => { const d = t.b.getChannelData(0); let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i])); return +p.toFixed(3); });
  const render = async (name, dur, fn, timed = null) => {
    cur = new OfflineAudioContext(2, Math.round(SR * dur), SR);
    const a = new GameAudio(); a.lib = lib; a.loaded = true; a.volume = 1; a.unlock();
    a.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
    let maxVoices = 0;
    if (timed) {
      // one suspend per render quantum (128 frames): calls landing in the same quantum run together
      const q = new Map();
      for (const [t, f] of timed) { const k = Math.round(t * SR / 128) + 1; (q.get(k) || q.set(k, []).get(k)).push(f); }
      for (const [k, fs] of q) cur.suspend((k * 128) / SR).then(() => { for (const f of fs) f(a); maxVoices = Math.max(maxVoices, a.voices); cur.resume(); });
    }
    fn(a);
    const buf = await cur.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let peak = 0, sum = 0, nan = 0;
    for (let i = 0; i < L.length; i++) { const v = Math.max(Math.abs(L[i]), Math.abs(R[i])); if (!Number.isFinite(L[i] + R[i])) nan++; else { peak = Math.max(peak, v); sum += L[i] * L[i]; } }
    // transients: 5 ms envelope maxima above 15 % of the peak, 60 ms apart
    const W = SR * 0.005, env = [];
    for (let i = 0; i + W <= L.length; i += W) { let m = 0; for (let j = i; j < i + W; j++) m = Math.max(m, Math.abs(L[j]), Math.abs(R[j])); env.push(m); }
    const hits = []; let last = -1;
    for (let i = 1; i < env.length - 1; i++) if (env[i] > 0.15 * peak && env[i] >= env[i - 1] && env[i] > env[i + 1] && (last < 0 || i - last > 12)) { hits.push(+(i * 0.005).toFixed(3)); last = i; }
    const onset = (env.findIndex((v) => v > 0.1 * peak) * 0.005);
    // loudness as heard: the loudest 50 ms (RMS, dBFS)
    const n50 = SR * 0.05; let acc = 0, best = 0;
    for (let i = 0; i < L.length; i++) { acc += L[i] * L[i]; if (i >= n50) acc -= L[i - n50] * L[i - n50]; best = Math.max(best, acc); }
    const r = { name, peak: +peak.toFixed(3), st: +(10 * Math.log10(best / n50 + 1e-12)).toFixed(1), onset: +onset.toFixed(3), hits: hits.slice(0, 12), nan, stats: a.stats, maxVoices };
    if (keep.includes(name)) r.data = Array.from(L);
    return r;
  };
  const res = [], at = [0, 1.6, 0];
  const pos = (d) => [0, 1.6, -d];
  for (const w of ['ar', 'sniper', 'pistol', 'jeep_mg', 'tank_mg', 'heli_cannon']) res.push(await render(`${w} local`, 2.5, (a) => a.gunshot(null, w, true)));
  for (const [w, d] of [['ar', 10], ['ar', 60], ['ar', 300], ['sniper', 120], ['pistol', 40], ['jeep_mg', 80], ['heli_cannon', 150]]) res.push(await render(`${w} ${d} m`, 3, (a) => a.gunshot(pos(d), w)));
  res.push(await render('cannon local', 4, (a) => a.cannon(at, true)));
  res.push(await render('cannon 200 m', 4, (a) => a.cannon(pos(200))));
  res.push(await render('explosion 15 m', 4, (a) => a.explosion(pos(15))));
  res.push(await render('explosion 300 m', 5, (a) => a.explosion(pos(300))));
  res.push(await render('reload ar', 3, (a) => a.reload('ar', 2.3, false)));
  res.push(await render('reload ar empty', 3.5, (a) => a.reload('ar', 2.9, true)));
  res.push(await render('reload pistol empty', 2.5, (a) => a.reload('pistol', 1.9, true)));
  res.push(await render('reload sniper', 3.6, (a) => a.reload('sniper', 3.1, true)));
  res.push(await render('reload ar, soldier 8 m', 3, (a) => a.reload('ar', 2.3, false, pos(8))));
  res.push(await render('bolt cycle', 2, (a) => a.boltCycle(1.05, null, 'concrete')));
  for (const s of ['concrete', 'grass', 'dirt', 'sand', 'wood', 'metal']) res.push(await render(`step ${s}`, 0.8, (a) => a.footstep(null, s, true, 0.8)));
  res.push(await render('step concrete, soldier 6 m', 0.8, (a) => a.footstep(pos(6), 'concrete', false, 1.1)));
  for (const s of ['concrete', 'metal', 'dirt', 'wood', 'glass', 'flesh']) res.push(await render(`impact ${s} 6 m`, 1, (a) => a.impact(pos(6), s)));
  for (const s of ['concrete', 'wood', 'dirt', 'grass']) res.push(await render(`brass ${s}`, 2, (a) => a.brass(s, null, 0.5, 'ar')));
  res.push(await render('crack ar 1.5 m', 0.5, (a) => a.crack(pos(1.5), 'ar', 1.5)));
  res.push(await render('whizz pistol 1.5 m', 0.5, (a) => a.crack(pos(1.5), 'pistol', 1.5)));
  res.push(await render('grenade throw', 1.5, (a) => a.throwNade()));
  res.push(await render('grenade bounce 5 m', 1, (a) => a.nadeBounce(pos(5))));
  res.push(await render('dry pistol', 0.6, (a) => a.dry('pistol')));
  res.push(await render('dry rifle', 0.6, (a) => a.dry('ar')));
  res.push(await render('draw rifle', 1.2, (a) => a.draw('ar')));
  res.push(await render('glass 10 m', 1.5, (a) => a.glass(pos(10))));
  // stress: own full-auto (12 rounds/s) while 24 soldiers around fire 600 rpm bursts
  const timed = [];
  for (let i = 0; i < 36; i++) timed.push([i / 12, (a) => { a.gunshot(null, 'ar', true); a.brass('concrete', null, 0.5, 'ar'); }]);
  for (let i = 0; i < 24 * 8; i++) timed.push([0.01 + (i % 30) * 0.1 + Math.floor(i / 30) * 0.003, (a) => a.gunshot([Math.sin(i) * 40, 1.6, Math.cos(i) * 40], 'ar')]);
  res.push(await render('stress: full-auto + 24 soldiers', 4.5, () => {}, timed));
  return { ...out, res };
}, { keep: OUT ? ['ar local', 'ar 300 m', 'sniper local', 'pistol local', 'jeep_mg local', 'tank_mg local', 'heli_cannon local', 'explosion 15 m', 'reload ar empty', 'reload sniper', 'bolt cycle', 'step concrete', 'step grass', 'crack ar 1.5 m'] : [] });

console.log(`samples decoded in ${renders.loadMs} ms`);
for (const [set, [, takes]] of Object.entries(man)) {
  const got = renders.sets[set];
  check(`set ${set}: ${takes.length} takes decoded, none silent`, got?.length === takes.length && got.every((p) => p > 0.05), got ? `peaks ${got.join(' ')}` : 'missing');
}
console.log('\nrender                              peak  50ms dB  onset  transients (s)');
for (const r of renders.res) console.log(`${r.name.padEnd(34)} ${String(r.peak).padStart(6)} ${String(r.st).padStart(7)} ${String(r.onset).padStart(6)}  ${r.hits.join(' ')}${r.maxVoices ? `  max voices ${r.maxVoices}` : ''}`);
const R = Object.fromEntries(renders.res.map((r) => [r.name, r]));
check('no NaN / Infinity in any render', renders.res.every((r) => !r.nan));
check('every sound path audible (except brass on grass)', renders.res.every((r) => (r.name === 'brass grass' ? r.peak < 1e-4 : r.st > -75)), renders.res.filter((r) => r.st <= -75).map((r) => r.name).join(', '));
check('nothing clips at the output (soft-clipped bus)', renders.res.every((r) => r.peak < 1.0), renders.res.filter((r) => r.peak >= 1).map((r) => `${r.name} ${r.peak}`).join(', '));
// (4 ms pre-roll in the takes + the compressor's 6 ms look-ahead)
check('own shot starts immediately (<= 15 ms)', ['ar local', 'sniper local', 'pistol local'].every((n) => R[n].onset <= 0.015), ['ar local', 'sniper local', 'pistol local'].map((n) => R[n].onset).join(' '));
check('300 m shot arrives after ~0.87 s (speed of sound)', Math.abs(R['ar 300 m'].onset - 300 / 343) < 0.03, `${R['ar 300 m'].onset} s`);
check('300 m explosion arrives after ~0.87 s', Math.abs(R['explosion 300 m'].onset - 300 / 343) < 0.05, `${R['explosion 300 m'].onset} s`);
check('sniper louder than carbine, carbine louder than pistol (own shots)', R['sniper local'].st > R['ar local'].st && R['ar local'].st > R['pistol local'].st, `${R['sniper local'].st} / ${R['ar local'].st} / ${R['pistol local'].st} dB`);
check('mix: own shot >= 10 dB over own reload / bolt / draw foley', ['reload ar', 'reload ar empty', 'bolt cycle', 'draw rifle', 'grenade throw'].every((n) => R['ar local'].st - R[n].st >= 10), ['reload ar', 'bolt cycle', 'draw rifle'].map((n) => `${n} ${(R['ar local'].st - R[n].st).toFixed(1)} dB under`).join(', '));
check('mix: own footsteps >= 14 dB under the own shot', ['step concrete', 'step grass', 'step metal'].every((n) => R['ar local'].st - R[n].st >= 14), ['step concrete', 'step grass', 'step metal'].map((n) => (R['ar local'].st - R[n].st).toFixed(1)).join(' / '));
check('mix: own brass well under the shot (>= 18 dB)', R['ar local'].st - R['brass concrete'].st >= 18, `${(R['ar local'].st - R['brass concrete'].st).toFixed(1)} dB`);
const near = (hits, t, tol = 0.035) => hits.some((h) => Math.abs(h - t) <= tol);
check('AR reload: mag out at 0.20, mag in at 0.70', near(R['reload ar'].hits, 0.2 * 2.3) && near(R['reload ar'].hits, 0.7 * 2.3), R['reload ar'].hits.join(' '));
check('AR empty reload: bolt release at 0.88', near(R['reload ar empty'].hits, 0.88 * 2.9), R['reload ar empty'].hits.join(' '));
check('pistol empty reload: slide release at 0.88', near(R['reload pistol empty'].hits, 0.88 * 1.9), R['reload pistol empty'].hits.join(' '));
check('bolt rifle reload: clip in 0.70, bolt closed 0.88', near(R['reload sniper'].hits, 0.7 * 3.1) && near(R['reload sniper'].hits, 0.88 * 3.1), R['reload sniper'].hits.join(' '));
check('bolt cycle: up/back/forward/down on 0.10/0.30/0.55/0.70 of 1.05 s after 0.15 s', [0.1, 0.3, 0.55, 0.7].filter((f) => near(R['bolt cycle'].hits, 0.15 + f * 1.05)).length >= 3, R['bolt cycle'].hits.join(' '));
check('brass lands ~0.5 s after the shot', R['brass concrete'].onset > 0.45 && R['brass concrete'].onset < 0.7, `${R['brass concrete'].onset} s`);
const S = R['stress: full-auto + 24 soldiers'];
check('voice cap holds under a firefight', S.maxVoices <= 32 && !S.nan, `max ${S.maxVoices} spatial voices`);

if (OUT) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const r of renders.res) if (r.data) {
    const n = r.data.length, b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r.data[i] * 32767))), 44 + i * 2);
    fs.writeFileSync(`${OUT}/${r.name.replace(/[^a-z0-9]+/gi, '_')}.wav`, b);
  }
}

// ---------------------------------------------------------------- B: the real game
if (process.env.SKIP_GAME) { await browser.close(); const f = results.filter((r) => !r.ok).length; console.log(`\n${results.length - f}/${results.length} checks passed (offline only)`); process.exit(f ? 1 : 0); }
const room = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'audiotest', map: 'outskirts', bots: 0, private: true, rotation: false }) })).json();
const G = await browser.newPage({ viewport: { width: 640, height: 360 } }); watch(G);
await G.addInitScript(() => localStorage.setItem('sp_settings', JSON.stringify({ name: 'Audio', quality: 'low', fov: 78 })));
await G.goto(`${BASE}/?room=${room.id}&autojoin=1&autodeploy=1&q=low&team=1`);
await G.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000 });
const g = (fn, arg) => G.evaluate(fn, arg);
await G.mouse.click(320, 180); // a user gesture starts the AudioContext
await G.waitForFunction(() => __game.audio.loaded, null, { timeout: 120000 });
check('game: AudioContext running and all sets loaded', await g((n) => __game.audio.ctx.state === 'running' && Object.keys(__game.audio.lib).length === n, Object.keys(man).length));
const stats = () => g(() => ({ ...__game.audio.stats }));
// software GPU: the game may run at ~1 frame/s here, so wait for frames (conditions), not wall-clock time
const until = (fn, timeout = 180000) => G.waitForFunction(fn, null, { timeout, polling: 500 }).then(() => true, () => false);
await G.keyboard.down('KeyW');
await until(() => Object.keys(__game.audio.stats).some((k) => k.startsWith('step_')));
await G.keyboard.up('KeyW');
let st = await stats();
check('game: walking plays recorded footsteps', Object.keys(st).some((k) => k.startsWith('step_')), JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('step_')))));
await g(() => { __game.me.mouse.l = true; }); await until(() => __game.audio.stats.ar_near >= 3); await g(() => { __game.me.mouse.l = false; });
await until(() => __game.me.triggerReleased, 60000); // a frame has to see the trigger let go (semi-auto pistol next)
st = await stats();
check('game: firing the carbine plays the near-mic AR-15 takes', st.ar_near > 0, `ar_near ${st.ar_near}, surface ${await g(() => __game.surfaceAt(__game.me.s.x, __game.me.s.z))}, brass ${(st.brass_hard || 0) + (st.brass_wood || 0)}`);
await G.keyboard.press('KeyR'); await until(() => __game.audio.stats.ar_magin > 0, 60000);
st = await stats();
check('game: reload plays mag out + mag in', st.ar_magout > 0 && st.ar_magin > 0, `magout ${st.ar_magout} magin ${st.ar_magin}`);
await G.keyboard.press('Digit2'); await until(() => __game.audio.stats.draw_pistol > 0, 60000);
st = await stats();
check('game: switching to the pistol plays the draw foley', st.draw_pistol > 0, `draw_pistol ${st.draw_pistol}`);
await g(() => { __game.me.mouse.l = true; }); await until(() => __game.audio.stats.pistol_near > 0, 60000); await g(() => { __game.me.mouse.l = false; });
await until(() => __game.me.triggerReleased, 60000);
st = await stats();
check('game: pistol shot uses the 9 mm (Walther PPQ) takes', st.pistol_near > 0, `pistol_near ${st.pistol_near}`);
await until(() => __game.me.reloadUntil < performance.now(), 60000);
// (standing at the base the server keeps resupplying: empty the gun right before every update while the trigger is held)
await g(() => { const me = __game.me; me.__up = me.update; me.update = (dt) => { const w = me.weapons[me.slot]; if (w) { w.mag = 0; w.reserve = 0; } return me.__up(dt); }; me.mouse.l = true; });
await until(() => __game.audio.stats.dry_pistol > 0, 90000); await g(() => { const me = __game.me; me.mouse.l = false; me.update = me.__up; });
st = await stats();
check('game: empty pistol clicks (dry fire)', st.dry_pistol > 0, `dry_pistol ${st.dry_pistol}`);
await G.keyboard.press('KeyG'); await until(() => __game.audio.stats.explosion > 0, 120000);
st = await stats();
check('game: grenade pin + throw, bounce and explosion heard', st.nade_pin > 0 && st.nade_throw > 0 && st.explosion > 0, `pin ${st.nade_pin} throw ${st.nade_throw} bounce ${st.nade_bounce || 0} explosion ${st.explosion || 0}`);
console.log('game sound stats:', JSON.stringify(st));
check('no console / decode errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
