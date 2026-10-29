// The Kerala story missions, each started at its giver and played through with stand-ins for the driving: the player
// put near where a step wants them (on a lane there, stopped, for riders to get in or out), into a car to steal, driven
// by an AI a fair way behind a car to tail or escort, a target rammed (hits counted), a race won once the rival has
// driven most of it, a chase called off. The steps' own logic runs as in the game. Logs each mission's steps, pass or
// fail (and why), and how the AI cars drove: time off the road, the longest stop, resets (jumps back onto its way).
// --trace 1: the AI car every 5 s, what's round it when it has stood 8 s, and what it was slow for. Rendering off.
//   node tools/dev/missions.mjs --port N [--only id,id] [--limit 600] [--trace 1]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, only = args.only ? args.only.split(',') : null, limit = +(args.limit || 600), trace = !!args.trace;

const b = await launch();
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errs = [];
p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'low',detectedQuality:'low',backend:'webgl2',timeOfDay:'day',weather:'clear'}}))`);
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
await p.waitForFunction(() => window.NIGHTSHIFT.humans?.ready, null, { timeout: 180000 });
await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.save.data.story.done = { kl_prologue: true }; G.play(); });
await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
const ids = await p.evaluate(async () => {
  const G = window.NIGHTSHIFT; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
  const SD = await import('/src/story/StoryData.js');
  window.__SD = SD;
  return SD.STORY.filter((m) => !m.prologue && !m.script && !m.job).map((m) => m.id);
});
const list = only ? ids.filter((id) => only.includes(id)) : ids;
const results = [];
for (const id of list) {
  const res = await p.evaluate(async ([id, limit, trace]) => {
    const G = window.NIGHTSHIFT, W = G.world, S = G.story, SD = window.__SD, PM = G.police;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };
    G.input.update = () => Object.assign(G.input.controls, ctl, { lookX: 0, lookY: 0, lookBack: false });
    let hook = null;   // (run before each frame: the player's car driven by an AI, tailing)
    const step = (n = 1) => { for (let i = 0; i < n; i++) { hook?.(); try { G._update(1 / 30); } catch (e) { console.error(e?.stack || e); } G.input.endFrame(); if (G.state.mode !== 'drive' && G.state.mode !== 'cutscene') G.resume?.(); } };   // (an outro face to face plays out)
    const fmt = (x, z) => `${x.toFixed(0)},${z.toFixed(0)}`;
    // the tiles at a place built, and a lane there (they're built round the player: the player's car taken there)
    const load = async (x, z) => {
      const f = G.focusState;
      // (150 m off it: a car put down there meanwhile - the tail's van - saw the player on top of it)
      if (Math.hypot(f.x - x, f.z - z) > 300) { if (G.onFoot.active) G.onFoot.enter({ kind: 'own', ref: G.player }, true); G.player.place(x + 150, z, 0); G.camCtl.snap(G.player); }
      W.prioritize?.([{ x, z }]);
      for (let i = 0; i < 2500; i++) { if (W.groundKnown?.(x, z, 0) && (G.traffic.graph.nearest(x, z)?.dist ?? 1e9) < 150) return true; step(2); if (i % 5 === 0) await sleep(5); }
      return false;
    };
    const inCar = () => !G.onFoot.active;
    const intoCar = (v) => {
      if (G.onFoot.active && v === G.player) { G.onFoot.enter({ kind: 'own', ref: G.player }, true); return; }
      if (v === G.player) return;
      if (!G.onFoot.active) { G.onFoot.exit(); step(60); }
      if (G.onFoot.active) { G.onFoot.state.x = v.state.x + 2; G.onFoot.state.z = v.state.z; G.onFoot.enter({ kind: 'parked', ref: v }, true); }
    };
    // the player's car put on the lane nearest (x, z), facing along it, stopped (any lane, as the game puts a place on:
    // Varam's is on a service road 13 m off the main one)
    const tp = (x, z, yaw) => {
      if (G.onFoot.active) G.onFoot.enter({ kind: 'own', ref: G.player }, true);
      const n = G.traffic.graph.nearest(x, z, (l) => !l.ring);
      if (n && n.dist < 40) { x = n.x; z = n.z; yaw ??= Math.atan2(n.dx, n.dz); }
      G.player.place(x, z, yaw ?? 0); G.camCtl.snap(G.player);
    };
    // on a lane about d behind a car, facing its way (the lane nearest the point straight behind can be its own, by
    // it: at a junction, or with houses behind it. The tail's van saw the player 10 m off)
    const behind = (q, d) => {
      const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw);
      for (const k of [1, 1.25, 0.8, 1.5]) for (const a of [0, 0.5, -0.5, 1, -1]) {
        const bx = q.x - (fx * Math.cos(a) - fz * Math.sin(a)) * d * k, bz = q.z - (fz * Math.cos(a) + fx * Math.sin(a)) * d * k;
        const n = G.traffic.graph.nearest(bx, bz, (l) => l.edge?.cls <= 7), dd = n && Math.hypot(n.x - q.x, n.z - q.z);
        if (n && n.dist < 25 && dd > d * 0.65 && dd < d * 1.6) { tp(n.x, n.z, Math.atan2(n.dx, n.dz) + (n.dx * fx + n.dz * fz < 0 ? Math.PI : 0)); return; }
      }
      tp(q.x - fx * d, q.z - fz * d, q.yaw);
    };
    const tpNear = (x, z, d) => {
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, n = G.traffic.graph.nearest(x + Math.sin(a) * d, z + Math.cos(a) * d, (l) => l.edge?.cls <= 7); if (n && n.dist < 25) { tp(n.x, n.z); return; } }
      tp(x, z);
    };
    const m = SD.STORY.find((q) => q.id === id);
    for (const r of m.requires || []) S.done[r] = true;
    PM.clearAll(); G.traffic.clear?.();
    const sp = SD.CAST[m.giver].spot;
    await load(sp.x, sp.z);
    let gv = S._giver(m.giver);
    for (let i = 0; i < 40 && gv.provisional; i++) { tp(sp.x, sp.z); step(5); await sleep(30); gv = S._giver(m.giver); }
    tp(gv.lane.x, gv.lane.z, gv.lane.yaw); step(5);
    let failMsg = null;
    const fail0 = S.fail.bind(S); S.fail = (msg) => { failMsg = msg; return fail0(msg); };
    S.start(m, true);
    const log = [], ai = { off: 0, offAt: '', stop: 0, longest: 0, longAt: '', resets: 0, hits: 0, km: 0, slow: {} };
    let t = 0, last = -1, info = {}, lx = null, lz = null;
    const rec0 = G.recoverAI.bind(G);
    G.recoverAI = (v, a) => { const r = rec0(v, a); if (r && S.active?.st?.v === v) ai.resets++; return r; };   // (put back on its way: a jump)
    // (--trace: each traffic car knocked out of its lane, and by what: the player's car - the stand-in AI when tailing -,
    // the mission's car, or another)
    const col0 = G.traffic._col0 ||= G.traffic._collide.bind(G.traffic);
    G.traffic._collide = (v, c) => {
      const was = c.state, cv = c.v, cyaw = c.yaw, path = c.path?.kind, vs = v.state, sp = Math.hypot(vs.vx, vs.vz), r = col0(v, c);
      if (trace && was !== 'knocked' && c.state === 'knocked') {
        const fx = Math.sin(vs.yaw), fz = Math.cos(vs.yaw), dx = c.x - vs.x, dz = c.z - vs.z, A2 = S.active?.st?.ai;
        const fwd = vs.vx * fx + vs.vz * fz;
        log.push(`  ${t.toFixed(0)}s knocked ${was} ${c.type} (${cv?.toFixed(1)} m/s on a ${path}, ${Math.round(((cyaw - vs.yaw + 9 * Math.PI) % (2 * Math.PI) - Math.PI) * 57.3)} deg off) at ${fmt(c.x, c.z)} by ${v === G.player ? 'the player' : v === S.active?.st?.v ? 'the mission car' : 'another'} at ${sp.toFixed(1)} m/s ${fwd < -0.2 ? 'backing' : ''} (${r?.impact?.toFixed(1)}): it ${(dx * fx + dz * fz).toFixed(1)} ahead, ${(-dx * fz + dz * fx).toFixed(1)} right${v === S.active?.st?.v && A2 ? ` · ai ${A2.turning ? 'turning ' + A2.turning : ''}${A2.passO ? ' passing' : ''}${A2.backT > 0 ? ' backing off' : ''}${A2.reverseT > 0 ? ' unsticking' : ''}` : ''}`);
      }
      return r;
    };
    while (t < limit) {
      const A = S.active;
      if (!A) break;
      const st = A.m.steps[A.i], s = A.st;
      if (A.i !== last) { log.push(`${t.toFixed(0)}s step ${A.i} ${st?.type || 'end'}${st?.rider ? ' +' + st.rider : ''}${st?.drop ? ' -' + st.drop : ''}`); last = A.i; info = { t0: t }; lx = null; }
      if (A.i !== info.i0) { hook = null; info.i0 = A.i; }
      if (!hook) ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1 };   // (held on the handbrake: the brake at a standstill is reverse gear)
      // a car waiting on the roads round its place being built (they're built round the player): to a lane 60 m off it
      if (st && s?.pending && S.target && !info.pend) {
        const T = S.target, f = G.focusState;
        if (Math.hypot(f.x - T.x, f.z - T.z) > 400) { await load(T.x, T.z); tpNear(T.x, T.z, 60); }
        info.pend = true;
      }
      if (st && s && !s.pending) {
        const f = G.focusState;
        if (st.type === 'goto' || st.type === 'deliver') {
          if (st.type === 'deliver' && A.vehicle && G.player !== A.vehicle) intoCar(A.vehicle);
          else if (inCar() !== true && st.inVehicle) intoCar(G.player);
          const T = s.target;
          if (trace && Math.round(t * 3) % 15 === 0) log.push(`  ${t.toFixed(0)}s at ${fmt(f.x, f.z)} target ${T ? fmt(T.x, T.z) : '-'} d ${T ? Math.hypot(f.x - T.x, f.z - T.z).toFixed(0) : '-'}${s.reTarget ? ' re' : ''}${inCar() ? '' : ' on foot'}${G.player === A.vehicle ? ' (its car)' : ''} v ${Math.hypot(f.vx || 0, f.vz || 0).toFixed(1)}`);
          if (T && Math.hypot(f.x - T.x, f.z - T.z) > 8 && !info.went) {
            if (Math.hypot(f.x - T.x, f.z - T.z) > 1200) await load(T.x, T.z);
            tp(T.x, T.z); info.went = true; info.wentT = t;
          }
          if (info.went && t - info.wentT > 3 && T && Math.hypot(f.x - T.x, f.z - T.z) > 9) { info.went = false; }   // (moved on: the target was worked out again)
        } else if (st.type === 'steal') {
          if (s.v && G.player !== s.v) {
            if (Math.hypot(s.v.state.x - f.x, s.v.state.z - f.z) > 1200) await load(s.v.state.x, s.v.state.z);
            intoCar(s.v);
          }
        } else if (st.type === 'collect') {
          const q = s.points.find((q2) => !q2.got);
          if (q) { if (Math.hypot(q.x - f.x, q.z - f.z) > 1200) await load(q.x, q.z); tp(q.x, q.z); }
        } else if (st.type === 'lose') {
          if (t - info.t0 > 4 && PM.state !== 'idle') PM.endPursuit('escaped');
        } else if ((st.type === 'tail' || st.type === 'escort' || st.type === 'ram' || st.type === 'race') && s.v) {
          const v = s.v, q = v.state, fx = Math.sin(q.yaw), fz = Math.cos(q.yaw), sp2 = Math.hypot(q.vx, q.vz);
          // (a tail or a race isn't about the police: a pursuit drawn by the stand-in's own driving - a knock on a car,
          // a red light - is called off, or it's busted holding back from the van)
          if ((st.type === 'tail' || st.type === 'race') && PM.state !== 'idle') { PM.endPursuit('escaped'); log.push(`  ${t.toFixed(0)}s police called off (the stand-in's driving)`); }
          // the AI's driving
          if (trace && Math.round(t * 3) % 15 === 0) log.push(`  ${t.toFixed(0)}s ${fmt(q.x, q.z)} ${(sp2 * 3.6).toFixed(0)} km/h ${s.ai?.mode || ''} wp ${s.ai?.idx}/${s.ai?.route?.length} d ${Math.hypot(q.x - f.x, q.z - f.z).toFixed(0)}${s.countdown > 0 ? ' countdown' : ''}${s.moving ? '' : ' waiting'}`);
          // (--trace: a tail too close - each third of a second of it, with the player's car's speed and its stand-in AI)
          if (trace && st.type === 'tail' && s.close > 0 && (info.closeN = (info.closeN || 0) + 1) <= 24) log.push(`  close ${t.toFixed(1)}s d ${Math.hypot(q.x - f.x, q.z - f.z).toFixed(1)} van ${(sp2 * 3.6).toFixed(0)} km/h, us ${(Math.hypot(f.vx || 0, f.vz || 0) * 3.6).toFixed(0)} km/h at ${fmt(f.x, f.z)}${info.pai ? ` ai max ${info.pai.maxSpeed?.toFixed(1)} wp ${info.pai.idx}/${info.pai.route?.length}${info.pai.turning ? ' turning ' + info.pai.turning : ''}${info.pai.reverseT > 0 ? ' reversing' : ''}${info.pai.backT > 0 ? ' backing off' : ''} placed ${(t - (info.paiT || 0)).toFixed(1)}s ago` : ''}`);
          if (s.moving || st.type === 'race') {
            if (lx != null) ai.km += Math.hypot(q.x - lx, q.z - lz) / 1000; lx = q.x; lz = q.z;
            if (!W.onCarriageway(q.x, q.z, 0.8)) { ai.off += 1 / 3; ai.offAt ||= fmt(q.x, q.z); }
            // (--trace: each third of a second under 15 km/h, put down to what's round it)
            if (trace && sp2 < 4 && !s.stopped && !(s.countdown > 0)) {
              let why = 'other';
              for (const o of G.traffic.cars) {
                const dx = o.x - q.x, dz = o.z - q.z, a = dx * fx + dz * fz, l = -dx * fz + dz * fx;
                if (a < 1 || a > 16 || Math.abs(l) > 3.2) continue;
                const on = Math.sin(o.yaw) * fx + Math.cos(o.yaw) * fz < -0.5;
                why = on ? 'oncoming' : o.parked || o.pulled || o.state !== 'drive' ? 'kerb' : Math.abs(l) < 1.6 ? 'queue' : 'beside'; break;
              }
              if (why === 'other' && s.ai?.route) { const R = s.ai.route, i = s.ai.idx; for (let k = i + 1; k < Math.min(R.length - 1, i + 12); k++) { const h1 = Math.atan2(R[k][0] - R[k - 1][0], R[k][1] - R[k - 1][1]), h2 = Math.atan2(R[k + 1][0] - R[k][0], R[k + 1][1] - R[k][1]); let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh; if (dh > 0.6 && Math.hypot(R[k][0] - q.x, R[k][1] - q.z) < 25) { why = 'corner'; break; } } }
              ai.slow[why] = +((ai.slow[why] || 0) + 1 / 3).toFixed(1);
            }
            if (sp2 < 0.5 && !s.stopped && !(s.countdown > 0)) { ai.stop += 1 / 3; if (ai.stop > ai.longest) { ai.longest = ai.stop; ai.longAt = fmt(q.x, q.z); } } else { ai.stop = 0; info.dumping = false; }
            // (--trace: what's round it once it's stood 8 s: the traffic in front, its controls, its way on)
            if (trace && ai.stop > 8 && (info.dumped || 0) < 3 && !info.dumping) {
              info.dumped = (info.dumped || 0) + 1; info.dumping = true;
              const D = s.ai, c = v.controls, out = [`  STOPPED ${fmt(q.x, q.z)} yaw ${q.yaw.toFixed(2)} ctl t${c.throttle.toFixed(2)} b${c.brake.toFixed(2)} hb${c.handbrake} s${c.steer.toFixed(2)} mode ${D.mode} turning ${D.turning || '-'} legT ${D.legT?.toFixed?.(1)} avoid ${D.avoid?.toFixed?.(2)} needsReset ${D.needsReset} onRoad ${W.onCarriageway(q.x, q.z, 0)}`];
              out.push(`  next wps ${D.route.slice(D.idx, D.idx + 6).map((r) => fmt(r[0], r[1])).join(' ')}`);
              for (const o of G.traffic.cars) {
                const dx = o.x - q.x, dz = o.z - q.z, a = dx * fx + dz * fz, l = -dx * fz + dz * fx;
                if (Math.hypot(dx, dz) > 30) continue;
                out.push(`  car ${o.id} ${o.type} ahead ${a.toFixed(1)} lat ${l.toFixed(1)} v ${o.v.toFixed(1)} yaw ${o.yaw.toFixed(2)} ${o.state}${o.parked ? ' parked' : ''}${o.pulled ? ' pulled' : ''}${o.blockT > 0 ? ' held ' + o.blockT.toFixed(1) : ''}${o.jamHold ? ' jamHold' : ''}${o.yieldT > 0 ? ' yield' : ''} path ${o.path ? (o.path.kind === 'connector' ? 'con ' + o.path.turn : o.path.from + '->' + o.path.to) + ' s ' + o.s.toFixed(1) + '/' + o.path.length.toFixed(0) : '-'}`);
              }
              { const P = G.player.state, dx = P.x - q.x, dz = P.z - q.z; out.push(`  player ahead ${(dx * fx + dz * fz).toFixed(1)} lat ${(-dx * fz + dz * fx).toFixed(1)}`); }
              log.push(...out);
            }
          }
          if (st.type === 'race') {
            // won once the rival has most of the way behind it (or a while has gone by)
            const dEnd = Math.hypot(q.x - s.end[0], q.z - s.end[1]);
            if (!(s.countdown > 0) && (dEnd < 250 || t - info.t0 > 150)) { await load(s.end[0], s.end[1]); tp(s.end[0], s.end[1]); }
            else if (!(s.countdown > 0) && Math.hypot(q.x - f.x, q.z - f.z) > 60) tp(q.x - fx * 40, q.z - fz * 40, q.yaw);
          } else if (st.type !== 'ram' && s.moving && s.ai?.route) {
            // tailing it (the convoy: close behind): the player's car driven along its route by an AI, a fair way back -
            // through the traffic as a player would, not put down behind it every second (on top of whatever was there)
            const back = st.type === 'tail' ? 45 : 25, dq = Math.hypot(q.x - f.x, q.z - f.z);
            if (!info.pai || (dq > back + 50 && t - (info.paiT || 0) > 5)) {
              if (!window.__AIDriver) window.__AIDriver = (await import('/src/vehicles/AIDriver.js')).AIDriver;
              behind(q, back); info.paiT = t;
              info.pai = new window.__AIDriver(G.player, { skill: 0.9, maxSpeed: 17 });
              info.pai.setRoute(s.ai.route.map((r) => [r[0], r[1]]));
              hook = () => {
                const P = info.pai, sv = s.v.state, d = Math.hypot(sv.x - G.player.state.x, sv.z - G.player.state.z), vs = Math.hypot(sv.vx, sv.vz);
                P.maxSpeed = d > back + 12 ? 18 : d < back - 12 ? 0 : Math.max(2, vs + (d - back) * 0.3);   // (stopped when close, as you would)
                P.update(1 / 30, G.traffic.cars);
                if (P.needsReset) { P.needsReset = false; info.paiT = -99; }
                ctl = { ...G.player.controls };
                // (and held there, whatever the AI's at: backing up to unstick or turning round, it reversed into the van
                // it was 30 m behind, and was 'spotted')
                if (d < back - 15) ctl = { ...ctl, throttle: 0, brake: 0, handbrake: 1 };
              };
            }
          } else {
            // a fair way behind it, at its pace (the ram: close behind; a tail or convoy waiting to set off)
            const back = st.type === 'tail' ? 45 : st.type === 'escort' ? 25 : 12;
            const dq = Math.hypot(q.x - f.x, q.z - f.z);
            if (dq > back + 15 || dq < back * 0.5 || !s.moving) { behind(q, back); G.player.state.vx = q.vx; G.player.state.vz = q.vz; }
            if (st.type === 'ram' && s.moving && !s.stopped && t - (info.hitT ??= t) > 2.5) { info.hitT = t; s.hits++; ai.hits++; v.state.damage = Math.min(1, v.state.damage + 0.22); }
          }
        }
      }
      step(10); t += 1 / 3;
      if (Math.round(t * 3) % 15 === 0) await sleep(5);
    }
    G.recoverAI = rec0; S.fail = fail0; hook = null;
    const passed = !!S.done[id];
    if (S.active) { log.push(`(still on step ${S.active.i} after ${limit} s)`); S.fail?.('test over'); }
    return { id, passed, fail: failMsg, t: Math.round(t), log, ai };
  }, [id, limit, trace]);
  results.push(res);
  const a = res.ai;
  console.log(`${res.id}: ${res.passed ? 'ok' : 'FAILED' + (res.fail ? ` (${res.fail})` : '')} in ${res.t} s · ${res.log.join(' / ')}${a.km ? ` · AI: ${a.km.toFixed(2)} km, off road ${a.off.toFixed(0)} s${a.offAt ? ' from ' + a.offAt : ''}, longest stop ${a.longest.toFixed(1)} s${a.longAt ? ' at ' + a.longAt : ''}, resets ${a.resets}${Object.keys(a.slow).length ? ', under 15 km/h (s) ' + JSON.stringify(a.slow) : ''}` : ''}`);
}
console.log(`summary ${results.map((r) => `${r.id}:${r.passed ? 'ok' : 'FAIL'}`).join(' ')}`);
console.log('errors', errs.slice(0, 6));
await b.close();
