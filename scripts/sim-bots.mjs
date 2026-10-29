// Headless bot-only Conquest matches with behaviour metrics: how the bots spend their time (modes, stances, cover
// while holding), how they fight (detection range, reaction time, hit rate, kill distances, kills from behind),
// whether bullets passing close make them react, how they spread out and whether they get stuck.
//   node scripts/sim-bots.mjs [map=outskirts] [minutes=4] [botsPerTeam=8]
import { Game } from '../server/game.js';

const [map = 'outskirts', minutes = '4', per = '8'] = process.argv.slice(2);
const g = new Game({ botsPerTeam: +per, map, log: () => {} });
g.clock = 1_000_000;
const DT = 1 / 30, ticks = Math.round(+minutes * 60 / DT);
const bots = () => [...g.players.values()].filter((p) => p.bot);
const M = { mode: {}, stance: {}, holdCovered: 0, hold: 0, shots: 0, hits: 0, kills: [], behind: 0, acquire: [], react: [], nearMiss: 0, nearMissReact: 0, spacing: [], stuck: 0, windows: 0, grenades: 0 };
const track = new Map(); // bot id -> { target, at, d, shot, win: {x, z, t, mode} }
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);
// cover within 1.5 m: a solid box at least 1 m tall beside the soldier
const covered = (p) => g.world.query(p.x - 1.5, p.z - 1.5, p.x + 1.5, p.z + 1.5, []).some((b) => b.max[1] > p.y + 1 && b.min[1] < p.y + 0.5 && b.tag !== 'tree');
const segDist = (o, e, q) => {
  const dx = e[0] - o[0], dy = e[1] - o[1], dz = e[2] - o[2], L2 = dx * dx + dy * dy + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((q.x - o[0]) * dx + (q.y + 1.2 - o[1]) * dy + (q.z - o[2]) * dz) / L2));
  return Math.hypot(o[0] + dx * t - q.x, o[1] + dy * t - q.y - 1.2, o[2] + dz * t - q.z);
};
const pending = []; // near misses waiting to see whether the bot reacts (within 1.5 s)
const t0 = Date.now();
for (let i = 0; i < ticks; i++) {
  g.clock += DT * 1000; g.tick(DT);
  const now = g.now();
  for (const { ev } of g.flushEvents()) {
    if (ev.t === 'shot') {
      M.shots++;
      const s = g.players.get(ev.id);
      for (const q of g.players.values()) {
        if (!q.bot || !q.alive || !s || !g.isEnemy(s, q)) continue;
        const d = segDist(ev.o, ev.e, q);
        if (d > 0.5 && d < 2.5 && Math.hypot(ev.e[0] - q.x, ev.e[2] - q.z) > 3) { M.nearMiss++; pending.push({ q, at: now, stance: q.stance, mode: q.brain.mode }); }
      }
    }
    if (ev.t === 'hurt' && ev.a && g.players.get(ev.a)?.bot) M.hits++;
    if (ev.t === 'throw') M.grenades++;
    if (ev.t === 'kill' && ev.k) {
      const v = g.players.get(ev.v), k = g.players.get(ev.k);
      if (v && k) {
        M.kills.push(Math.hypot(k.x - v.x, k.z - v.z));
        const toK = Math.atan2(-(k.x - v.x), -(k.z - v.z)), off = Math.abs(((toK - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (off > 1.75) M.behind++;
      }
    }
  }
  for (let j = pending.length - 1; j >= 0; j--) {
    const n = pending[j], q = n.q;
    if (q.alive && (q.stance !== n.stance || q.brain.mode === 'cover' || q.brain.mode !== n.mode)) { M.nearMissReact++; pending.splice(j, 1); }
    else if (now - n.at > 1500 || !q.alive) pending.splice(j, 1);
  }
  if (i % 6) continue; // sample the state at 5 Hz
  const B = bots().filter((p) => p.alive && !p.vehicle);
  for (const p of B) {
    const b = p.brain;
    bump(M.mode, b.mode); bump(M.stance, p.stance);
    if (b.mode === 'hold') { M.hold++; if (covered(p)) M.holdCovered++; }
    let T = track.get(p.id);
    if (!T) track.set(p.id, (T = { win: { x: p.x, z: p.z, t: now, mode: b.mode } }));
    if (b.target && b.target !== T.target) { T.target = b.target; T.at = now; T.shot = false; T.shots0 = p.shotsFired || 0; M.acquire.push(Math.hypot(b.target.x - p.x, b.target.z - p.z)); }
    if (!b.target) T.target = null;
    if (T.target && !T.shot && b.lastShotAt >= T.at) { T.shot = true; M.react.push(b.lastShotAt - T.at); }
    if (b.mode === 'patrol' || b.mode === 'hold') {
      let nd = Infinity;
      for (const q of B) if (q !== p && q.team === p.team) nd = Math.min(nd, Math.hypot(q.x - p.x, q.z - p.z));
      if (b.mode === 'patrol' && nd < Infinity) M.spacing.push(nd);
    }
    if (now - T.win.t > 20000) {
      M.windows++;
      if (T.win.mode === 'patrol' && b.mode === 'patrol' && Math.hypot(p.x - T.win.x, p.z - T.win.z) < 1.5) M.stuck++;
      T.win = { x: p.x, z: p.z, t: now, mode: b.mode };
    }
  }
}
const pct = (o) => { const s = Object.values(o).reduce((a, b) => a + b, 0) || 1; return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / s).toFixed(0)}%`).join(', '); };
const q = (a, f) => { if (!a.length) return '-'; const s = [...a].sort((x, y) => x - y); return f(s[Math.floor(s.length * 0.25)]) + ' / ' + f(s[Math.floor(s.length * 0.5)]) + ' / ' + f(s[Math.floor(s.length * 0.75)]); };
console.log(`${map}: ${minutes} min, ${per} bots/team, simulated in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  modes: ${pct(M.mode)}`);
console.log(`  stances: ${pct(M.stance)}`);
console.log(`  holding with cover within 1.5 m: ${(100 * M.holdCovered / (M.hold || 1)).toFixed(0)}%`);
console.log(`  kills ${M.kills.length} (${(M.kills.length / +minutes / (2 * +per)).toFixed(2)} per bot-minute), from behind ${(100 * M.behind / (M.kills.length || 1)).toFixed(0)}%, kill distance q1/med/q3 ${q(M.kills, (v) => v.toFixed(0) + ' m')}`);
console.log(`  shots ${M.shots}, hits ${M.hits} (${(100 * M.hits / (M.shots || 1)).toFixed(0)}%), grenades ${M.grenades}`);
console.log(`  target acquired at q1/med/q3 ${q(M.acquire, (v) => v.toFixed(0) + ' m')} (n=${M.acquire.length}); first shot after ${q(M.react, (v) => (v / 1000).toFixed(2) + ' s')}`);
console.log(`  near misses ${M.nearMiss}, reacted within 1.5 s ${(100 * M.nearMissReact / (M.nearMiss || 1)).toFixed(0)}%`);
console.log(`  nearest teammate while moving q1/med/q3 ${q(M.spacing, (v) => v.toFixed(1) + ' m')}`);
console.log(`  stuck (patrolling, < 1.5 m in 20 s): ${M.stuck} of ${M.windows} windows`);
