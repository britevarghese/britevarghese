// Into the buildings of a town on foot: for each of a dozen houses and shops, walked up to a wall (the door found?),
// in (inside its walls, on its floor, clear of the furniture?), walking and running about inside for a while (a step
// through a wall or a piece of furniture, out through the building's own walls, the feet off the floor), then to the
// way out and out (on the ground outside, clear of the building and anything solid?). Errors too. Rendering off.
//   node tools/dev/indoors.mjs --port N [--at x,z | --at all] [--n 12] [--seconds 15]
import { launch } from './pw.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]); return acc; }, []));
const port = args.port || 3311, n = +(args.n || 12), secs = +(args.seconds || 15);
const TOWNS = { kannur: [98200, 211600], thalassery: [85603, 195435], mattannur: [75300, 215450], taliparamba: [99979, 227312], payyanur: [116603, 234899], iritty: [65523, 221833] };
const list = !args.at || args.at === 'all' ? Object.entries(TOWNS) : [[args.at, args.at.split(',').map(Number)]];

const b = await launch();
for (const [name, [x0, z0]] of list) {
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  await p.addInitScript(`localStorage.clear(); localStorage.setItem('nightshift.settings', JSON.stringify({graphics:{quality:'medium',detectedQuality:'medium',backend:'webgl2',timeOfDay:'day',weather:'clear'}}))`);
  await p.goto(`http://localhost:${port}/`);
  await p.waitForFunction(() => window.NIGHTSHIFT && window.NIGHTSHIFT.state.mode === 'menu', null, { timeout: 300000 });
  await p.evaluate(() => { const G = window.NIGHTSHIFT; G.save.data.story.prologueOffered = true; G.play(); });
  await p.waitForFunction(() => window.NIGHTSHIFT.state.mode === 'drive', null, { timeout: 180000 });
  const res = await p.evaluate(async ([x0, z0, n, secs]) => {
    const G = window.NIGHTSHIFT, W = G.world, I = G.interiors; G.rm.renderer.setAnimationLoop(null); G.rm.render = () => {};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 1, nitro: false };
    G.input.update = () => Object.assign(G.input.controls, ctl, { lookX: 0, lookY: 0, lookBack: false });
    const step = () => { try { G._update(1 / 30); } catch (e) { console.error(e.message); } G.input.endFrame(); };
    G.police.enabled = false;
    G.player.place(x0, z0, 0); W.prioritize?.([{ x: x0, z: z0 }]);
    for (let i = 0; i < 4000; i++) { step(); if (i % 10 === 0) await sleep(2); if (i > 300 && i % 30 === 0 && W.groundKnown(x0, z0, 80)) break; }
    const nn = G.traffic.graph.nearest(x0, z0, (l) => l.edge?.cls <= 7); if (nn) G.player.place(nn.x, nn.z, Math.atan2(nn.dx, nn.dz));
    for (let i = 0; i < 120; i++) step();
    const F = G.onFoot; F.exit(); for (let i = 0; i < 200 && !F.active; i++) step(); for (let i = 0; i < 60; i++) step();
    if (!F.active) return { err: 'never got out of the car' };
    const s = F.state, fmt = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
    const local = (c, x, z) => [(x - c.cx) * c.cos - (z - c.cz) * c.sin, (x - c.cx) * c.sin + (z - c.cz) * c.cos];
    const inBox = (c, x, z, m = 0) => { const [lx, lz] = local(c, x, z); return Math.abs(lx) < c.hx - m && Math.abs(lz) < c.hz - m; };
    // the step from a to b through a box's inside (its line against the box shrunk 2 cm)
    const crosses = (c, ax, az, bx, bz) => {
      const [p0, q0] = local(c, ax, az), [p1, q1] = local(c, bx, bz), hx = c.hx - 0.02, hz = c.hz - 0.02;
      let t0 = 0, t1 = 1;
      for (const [o, d, h] of [[p0, p1 - p0, hx], [q0, q1 - q0, hz]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(o) >= h) return false; continue; }
        let ta = (-h - o) / d, tb = (h - o) / d; if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return false;
      }
      return true;
    };
    const tmp = [];
    W.collision.query(x0 - 250, z0 - 250, x0 + 250, z0 + 250, tmp);
    const blds = tmp.filter((c) => c.bld && Math.min(c.hx, c.hz) > 1.6).sort((a, b) => Math.hypot(a.cx - x0, a.cz - z0) - Math.hypot(b.cx - x0, b.cz - z0));
    const out = { tried: 0, noDoor: 0, entered: 0, left: 0, problems: [] };
    const bad = (m) => { if (out.problems.length < 30) out.problems.push(m); };
    let rnd = 4242; const R = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
    for (const c of blds) {
      if (out.tried >= n) break;
      // up to the middle of a long wall, 0.6 m out, facing it (the side away from the building's middle)
      const sides = c.hx >= c.hz ? [[0, c.hz + 0.6, Math.PI], [0, -(c.hz + 0.6), 0]] : [[c.hx + 0.6, 0, -Math.PI / 2], [-(c.hx + 0.6), 0, Math.PI / 2]];
      let door = null, sx = 0, sz = 0;
      for (const [lx, lz] of sides) {
        sx = c.cx + lx * c.cos + lz * c.sin; sz = c.cz - lx * c.sin + lz * c.cos;
        const yaw = Math.atan2(c.cx - sx, c.cz - sz);
        if (!W.groundKnown(sx, sz, 2)) continue;
        s.x = sx; s.z = sz; s.y = W.groundHeight(sx, sz, s.y + 2); s.yaw = yaw; s.vx = s.vz = 0;
        door = I.doorAt(s.x, s.z, s.yaw);
        if (door?.c === c) break;
        door = null;
      }
      out.tried++;
      const tag = `${c.bld.shop ? 'shop' : c.bld.house ? 'house' : 'building'} ${(c.hx * 2).toFixed(0)}x${(c.hz * 2).toFixed(0)} at ${fmt(c.cx, c.cz)}`;
      if (!door) { out.noDoor++; bad(`${tag}: no door found at its walls`); continue; }
      I.enter(door);
      if (!I.active) { bad(`${tag}: not entered`); continue; }
      out.entered++;
      for (let i = 0; i < 10; i++) step();
      const A = I.active, fl = A.floor ?? c.bld.floor;
      if (!inBox(c, s.x, s.z, 0.1)) bad(`${tag}: put down outside its walls at ${fmt(s.x, s.z)}`);
      if (Math.abs(s.y - fl) > 0.05) bad(`${tag}: feet ${(s.y - fl).toFixed(2)} m off the floor on entering`);
      for (const k of I.colliders) if (k.h > s.y + 0.4 && inBox(k, s.x, s.z, 0.05)) { bad(`${tag}: put down inside a ${k.kind || 'piece'} ${(k.hx * 2).toFixed(1)}x${(k.hz * 2).toFixed(1)}`); break; }
      // about inside: random headings, walking and running
      let heading = R() * 6.28, legT = 0, run = false, through = 0, outside = 0, offFloor = 0;
      for (let f = 0; f < secs * 30; f++) {
        if ((legT -= 1 / 30) <= 0) { heading = R() * 6.28; legT = 1 + R() * 2.5; run = R() < 0.4; }
        F.camYaw = heading; ctl = { throttle: 1, brake: 0, steer: 0, handbrake: 0, nitro: run };
        const ax = s.x, az = s.z;
        step();
        if (!I.active) { bad(`${tag}: left the building while walking about inside`); break; }
        for (const k of I.colliders) if (k.h > s.y + 0.4 && crosses(k, ax, az, s.x, s.z) && through++ < 2) bad(`${tag}: stepped through a ${k.kind || 'piece'} ${(k.hx * 2).toFixed(1)}x${(k.hz * 2).toFixed(1)} from ${fmt(ax, az)} to ${fmt(s.x, s.z)}`);
        if (!inBox(c, s.x, s.z, -0.05) && outside++ < 1) bad(`${tag}: out through its walls to ${fmt(s.x, s.z)}`);
        if (Math.abs(s.y - fl) > 0.15 && offFloor++ < 1) bad(`${tag}: feet ${(s.y - fl).toFixed(2)} m off the floor`);
        if (f % 90 === 0) await sleep(2);
      }
      ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false };
      if (!I.active) continue;
      // to the way out, and out
      const e = I._toWorld(A.c, ...A.exit);
      s.x = e[0]; s.z = e[1]; s.vx = s.vz = 0;
      if (!I.nearExit(s.x, s.z)) bad(`${tag}: the way out not found at its own spot`);
      I.leave();
      for (let i = 0; i < 10; i++) step();
      if (I.active) { bad(`${tag}: couldn't leave`); I.dispose(); continue; }
      out.left++;
      const gy = W.groundHeight(s.x, s.z, s.y + 1);
      if (Math.abs(s.y - gy) > 0.15) bad(`${tag}: out ${(s.y - gy).toFixed(2)} m off the ground at ${fmt(s.x, s.z)}`);
      if (inBox(c, s.x, s.z, 0.05)) bad(`${tag}: out, but still inside its walls at ${fmt(s.x, s.z)}`);
      W.collision.query(s.x - 1, s.z - 1, s.x + 1, s.z + 1, tmp);
      for (const k of tmp) if (k !== c && !k.off && k.h > s.y + 0.4 && inBox(k, s.x, s.z, 0.05)) { bad(`${tag}: out into a ${k.kind || '?'} at ${fmt(s.x, s.z)}`); break; }
      for (let i = 0; i < 30; i++) step();
    }
    return out;
  }, [x0, z0, n, secs]);
  if (res.err) console.log(`== ${name}: ${res.err}`);
  else {
    console.log(`== ${name}: ${res.tried} buildings, door found at ${res.tried - res.noDoor}, in ${res.entered}, out ${res.left} · problems ${res.problems.length} · errors ${errs.length}`);
    for (const m of res.problems) console.log('   ' + m);
  }
  if (errs.length) console.log('   errors: ' + errs.slice(0, 4).join(' | '));
  await p.close();
}
await b.close();
