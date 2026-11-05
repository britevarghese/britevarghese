// The prologue, "The Kayal Job", played through as a new player would: the cold open in the car, out and to the bank's
// door (masks), in, the hold-up, the manager grabbed (E), the two keys, the racks emptied (E held), out, into the
// car with Leena, the police lost (called off here: the chase itself is chase.mjs's), to Babu's workshop and stopped
// there, the outro. Each phase's time, a phase that never ends, the crew and the bank people where they should be,
// errors. Rendering off.  node tools/dev/prologue.mjs --port N [--skip 1 (the cutscenes skipped)] [--side passenger]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, skip = !!args.skip, pside = args.side === 'passenger';

const b = await launch();
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2',timeOfDay:'day',weather:'clear'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
await p.waitForFunction(() => window.NIGHTSHIFT.humans?.ready, null, { timeout: 180000 });
// a new game: the prologue starts by itself
await p.evaluate(() => window.NIGHTSHIFT.play());
await p.waitForFunction(() => ['drive', 'cutscene'].includes(window.NIGHTSHIFT.state.mode), null, { timeout: 180000 });
const res = await p.evaluate(async ([skip, pside]) => {
  const G = window.NIGHTSHIFT, W = G.world, S = G.story, F = G.onFoot, I = G.interiors;
  G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1, use: false };
  G.input.update = () => Object.assign(G.input.controls, ctl, { lookX: 0, lookY: 0, lookBack: false });
  const step = (n = 1) => { for (let i = 0; i < n; i++) { try { G._update(1 / 30); } catch (e) { console.error(e.stack?.slice(0, 400)); } G.input.endFrame(); } };
  const press = (a) => G.input.pressed.add(a);
  const fmt = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
  const log = [], probs = [];
  let t = 0, H = null, last = null, t0 = 0;
  const tick = async (n = 10) => { step(n); t += n / 30; if (Math.round(t * 3) % 30 === 0) await sleep(5); };
  // wait for the director
  for (let i = 0; i < 600 && !(S.active?.script); i++) await tick(10);
  H = S.active?.script;
  if (!H) return { err: `no prologue running (story active: ${S.active?.m?.id || 'none'})` };
  const lim = { load: 120, intro: 120, approach: 60, holdup: 90, manager: 40, keys: 60, loot: 90, exit: 40, escape: 60, chase: 90, drive: 400, outro: 120 };
  const to = (x, z, yaw) => { const s = F.state; s.x = x; s.z = z; s.y = I.active ? I.active.floor : W.groundHeight(x, z, s.y + 2); if (yaw !== undefined) s.yaw = yaw; s.vx = s.vz = 0; };
  for (let guard = 0; guard < 20000; guard++) {
    if (!S.active || S.active.script !== H) break;
    const ph = H.phase;
    if (ph !== last) { if (last) log.push(`${last} ${(t - t0).toFixed(0)} s`); last = ph; t0 = t; }
    if (t - t0 > (lim[ph] || 120)) { probs.push(`'${ph}' never ended (${(t - t0).toFixed(0)} s)${H.target ? ` · target ${fmt(H.target.x, H.target.z)}, player ${fmt(F.state.x, F.state.z)}${F.active ? '' : ' (in the car)'}` : ''}`); break; }
    if (skip && (H.cinema?.active || S.cinema?.active)) { press('back'); await tick(2); continue; }
    if (ph === 'approach' && F.active && !I.active) {
      // up to the door, facing in, and F (the door is what the bank is built behind)
      const site = H.site, d = Math.hypot(F.state.x - site.door.x, F.state.z - site.door.z);
      if (d > 4) to(site.door.x + (site.front.x - site.door.x) * 0.6 / Math.max(0.01, Math.hypot(site.front.x - site.door.x, site.front.z - site.door.z)), site.door.z + (site.front.z - site.door.z) * 0.6 / Math.max(0.01, Math.hypot(site.front.x - site.door.x, site.front.z - site.door.z)));
      F.state.yaw = Math.atan2(site.front.x - F.state.x, site.front.z - F.state.z);   // (facing the wall: the door's in it)
      if (I.doorAt(F.state.x, F.state.z, F.state.yaw)) press('enter');
      await tick(10); continue;
    }
    if (ph === 'approach' && !F.active) { press('enter'); await tick(10); continue; }   // out of the car first
    if (ph === 'manager' && H.people?.manager) {
      const m = H.people.manager; if (Math.hypot(m.x - F.state.x, m.z - F.state.z) > 1.4) to(m.x + 1.0, m.z, Math.atan2(-1, 0));
      press('event'); await tick(10); continue;
    }
    if (ph === 'loot') {
      const R = H.racks.filter((r) => r.k < 1);
      if (R.length) { const r = R[0]; if (Math.hypot(r.x - F.state.x, r.z - F.state.z) > 1.2) to(r.x + Math.sin(r.yaw) * 0.75, r.z + Math.cos(r.yaw) * 0.75); ctl = { ...ctl, use: true }; }
      await tick(10); continue;
    }
    ctl = { ...ctl, use: false };
    if (ph === 'exit' && I.active) {
      const A = I.active, ex = A.exit, x = A.c.cx + ex[0] * A.c.cos + ex[1] * A.c.sin, z = A.c.cz - ex[0] * A.c.sin + ex[1] * A.c.cos;
      to(x, z); press('enter'); await tick(10); continue;
    }
    // (the manager and the cashier on their way to the strongroom's two keys: every 3 s)
    if (ph === 'keys' && H.people && Math.round((t - t0) * 3) % 9 === 0 && (H._kt ?? -1) !== Math.round(t - t0)) {
      H._kt = Math.round(t - t0); const P = H.people, M = H.layout.marks;
      const d = (q, m) => (q ? `${q.state} ${Math.hypot(q.x - m.x, q.z - m.z).toFixed(1)} m off at ${fmt(q.x, q.z)}` : 'none');
      log.push(`  keys ${H._kt}s: manager ${d(P.manager, M.vaultKey)}, cashier ${d(P.cashier, M.vaultKey2)}`);
    }
    // (Leena on her way to the car meanwhile: every 5 s, how far and what she's doing)
    if (ph === 'escape' && Math.round((t - t0) * 3) % 15 === 0 && (H._lt ?? -1) !== Math.round(t - t0)) { H._lt = Math.round(t - t0); const L = H.leena, c = H.car.state; log.push(`  escape ${H._lt}s: Leena ${L.mode}${L.seated ? ' seated' : ''} ${Math.hypot(L.state.x - c.x, L.state.z - c.z).toFixed(1)} m from the car, you ${F.active ? 'on foot' : 'in'}`); }
    if (ph === 'escape' && F.active) {
      const c = H.car.state, d = Math.hypot(c.x - F.state.x, c.z - F.state.z);
      // (walked up to it on the driver's side - not mid-way through getting in: moved then, it lost its way round the car)
      // (--side passenger: up to the side Leena gets in by instead)
      if (d > 3 && !F.inter?.busy) { const k = pside ? -1 : 1; to(c.x - Math.cos(c.yaw) * 2.2 * k, c.z + Math.sin(c.yaw) * 2.2 * k); F.state.yaw = Math.atan2(c.x - F.state.x, c.z - F.state.z); }
      const nv = F.nearestVehicle();
      if (!F.inter?.busy && !F.seq) press('enter');   // (once, as a player does: pressed again mid-way it starts over)
      await tick(10);
      if ((H._et ?? -1) !== Math.round(t - t0) && Math.round(t - t0) % 5 === 0) { H._et = Math.round(t - t0); log.push(`  F at ${(t - t0).toFixed(0)}s: nearest ${nv ? nv.kind + (nv.ref === H.car ? ' (the car)' : '') : 'none'}, seq ${F.seq?.kind || '-'}, inter ${F.inter?.busy ? 'busy' : '-'}, ${d.toFixed(1)} m from it, side ${(((F.state.x - c.x) * Math.cos(c.yaw) - (F.state.z - c.z) * Math.sin(c.yaw)) > 0 ? '+x' : '-x')}`); }
      continue;
    }
    if (ph === 'chase') {
      // off, as a player would, a few seconds, then the pursuit called off
      ctl = { throttle: 0.6, brake: 0, steer: 0, handbrake: 0 };
      if (t - t0 > 4 && G.police.state !== 'idle') G.police.endPursuit('escaped');
      await tick(10); continue;
    }
    if (ph === 'drive') {
      // to Babu's: put down on his lane 60 m short, driven in by an AI, stopped there
      const gv = H.babu?.lane || S._giver('babu').lane;
      if (!H._h) {
        H._h = true; W.prioritize?.([{ x: gv.x, z: gv.z }]);
        for (let i = 0; i < 300 && !W.groundKnown(gv.x, gv.z, 30); i++) await tick(10);
        G.player.place(gv.x - Math.sin(gv.yaw) * 30, gv.z - Math.cos(gv.yaw) * 30, gv.yaw); await tick(5);
      }
      const v = G.player.state, d = Math.hypot(v.x - gv.x, v.z - gv.z);
      ctl = d > 9 ? { throttle: 0.35, brake: 0, steer: 0, handbrake: 0 } : { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
      if (Math.hypot(v.vx, v.vz) < 0.3 && d < 11) ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
      if (d > 40 && t - t0 > 20) { G.player.place(gv.x - Math.sin(gv.yaw) * 8, gv.z - Math.cos(gv.yaw) * 8, gv.yaw); }
      await tick(10); continue;
    }
    ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1, use: false };
    await tick(10);
    // the crew in the bank with the player, not left outside or in a wall
    if (I.active?.type === 'bank' && ['manager', 'keys', 'loot'].includes(ph) && !H._crewChecked) {
      H._crewChecked = true;
      for (const c of [H.leena, H.sajan]) { const s = c.state, A = I.active, lx = (s.x - A.c.cx) * A.c.cos - (s.z - A.c.cz) * A.c.sin, lz = (s.x - A.c.cx) * A.c.sin + (s.z - A.c.cz) * A.c.cos; if (Math.abs(lx) > A.c.hx || Math.abs(lz) > A.c.hz) probs.push(`${c.id || 'crew'} outside the bank's walls during '${ph}' at ${fmt(s.x, s.z)}`); }
    }
  }
  if (last) log.push(`${last} ${(t - t0).toFixed(0)} s`);
  const done = !!G.save.data.story.done.kl_prologue;
  return { log, probs, done, t: Math.round(t), active: S.active?.m?.id || null, mode: G.state.mode, cash: Math.round(H.cash * 10) / 10 };
}, [skip, pside]);
if (res.err) console.log('prologue: ' + res.err);
else {
  console.log(`prologue: ${res.done ? 'COMPLETE' : 'NOT complete'} in ${res.t} s · ${res.log.join(' / ')} · bag ₹${res.cash} lakh · mode ${res.mode}${res.active ? ' · still active: ' + res.active : ''}`);
  for (const m of res.probs) console.log('   ' + m);
}
console.log(`errors ${errs.length}${errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''}`);
await b.close();
