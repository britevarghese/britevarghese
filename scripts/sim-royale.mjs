// Headless battle royale matches with a simulated human (jump, freefall, canopy, landing, then standing still):
// logs every hit / death of the human, to see what kills people after landing.   node scripts/sim-royale.mjs [runs]
import { RoyaleGame } from '../server/royale.js';
import { stepAir } from '../shared/royale.js';
import { stepCharacter } from '../shared/world.js';
const runs = +process.argv[2] || 4;
for (let run = 0; run < runs; run++) {
  const g = new RoyaleGame({ bots: 14, log: () => {}, lobbyTime: 2 }); g.clock = 1_000_000;
  const h = g.addPlayer({ name: 'Human' });
  h.rtt = 80;
  const s = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, air: 0, onGround: true, stance: 'stand' };
  let jumped = false, landedT = null, log = [], t0 = null, jumpK = 0.2 + Math.random() * 0.5;
  const step = () => { g.clock += 1000 / 30; g.tick(1 / 30); };
  for (let i = 0; i < 30 * 240 && !h.place; i++) {
    step();
    if (g.phase === 'plane' && !jumped && h.inPlane && g.planeK(g.clock) > Math.max(jumpK, g.plane.jumpFrom + 0.01)) g.jump(h);
    if (!jumped && h.alive && h.air) { jumped = true; Object.assign(s, { x: h.x, y: h.y, z: h.z, vx: h.vx, vy: h.vy, vz: h.vz, air: 1 }); t0 = g.clock; }
    if (jumped && h.alive) {
      if (s.air) stepAir(g.world, s, { fx: 0, fz: 0, dive: 0, deploy: false }, 1 / 30);
      else stepCharacter(g.world, s, { fx: 0, fz: 0 }, 1 / 30);
      if (!s.air && landedT == null) landedT = g.clock;
      g.handleInput(h, { x: s.x, y: s.y, z: s.z, yaw: 0, pitch: 0, st: 'stand', og: s.onGround, dr: s.air || 0, vx: s.vx, vz: s.vz, sl: 1 });
    }
    for (const { ev } of g.flushEvents()) {
      if ((ev.t === 'hurt' && ev.v === h.id) || (ev.t === 'kill' && ev.v === h.id)) {
        const a = g.players.get(ev.a ?? ev.k);
        log.push(`${ev.t} ${ev.d ?? ''} by ${a ? a.name : 'world'} w=${ev.w ?? ''} t+${landedT ? ((g.clock - landedT) / 1000).toFixed(1) + 's after landing' : 'in air'} dist=${a ? Math.hypot(a.x - h.x, a.z - h.z).toFixed(0) : '-'}m hp=${Math.round(h.hp)}`);
      }
      if (ev.t === 'landed') log.push('landed event');
    }
    if (landedT && g.clock - landedT > 60000) break;
  }
  console.log(`--- run ${run}: alive=${h.alive} place=${h.place} landedAfter=${landedT && t0 ? ((landedT - t0) / 1000).toFixed(0) : '-'}s`);
  console.log(log.slice(0, 12).join('\n'));
}
