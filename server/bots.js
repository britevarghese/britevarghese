// Server-side bot AI: objective selection, A* navigation, perception with line-of-sight, human-like aim.
import { EYE_HEIGHT } from '../shared/world.js';
import { WEAPONS } from '../shared/weapons.js';
import { angleDiff, clamp } from '../shared/util.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class BotBrain {
  constructor(game, p) {
    this.g = game; this.p = p;
    this.skill = rand(0.45, 0.9);
    this.onSpawn();
  }

  onSpawn() {
    this.path = null; this.pathIdx = 0; this.goal = null; this.repathAt = 0;
    this.target = null; this.lastSeen = null; this.seeAt = 0; this.reactUntil = 0;
    this.burstLeft = 0; this.burstPauseUntil = 0; this.nextPerceive = 0;
    this.stuckT = 0; this.lastPos = { x: this.p.x, z: this.p.z }; this.strafe = 0; this.strafeUntil = 0;
    this.aimErr = { yaw: 0, pitch: 0 }; this.wantStance = 'stand'; this.stanceUntil = 0;
    this.pickGoal();
  }

  onDamaged(attacker) {
    if (!attacker || !attacker.alive || !this.g.isEnemy(this.p, attacker)) return;
    if (!this.target) { this.target = attacker; this.reactUntil = this.g.now() + rand(250, 600) * (1.3 - this.skill); this.aimErr = { yaw: rand(-0.12, 0.12), pitch: rand(-0.06, 0.06) }; }
    this.lastSeen = { x: attacker.x, y: attacker.y, z: attacker.z, t: this.g.now() };
  }

  pickGoal() {
    const flags = this.g.flags, p = this.p;
    const scored = flags.map((f) => {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      let s = -d * 0.02;
      if (f.owner !== p.team) s += 3; else if (f.contested) s += 2.5; else s -= 1.5;
      if (f.owner === 0) s += 0.8;
      return { f, s: s + rand(0, 2.2) };
    }).sort((a, b) => b.s - a.s);
    const f = scored[0].f;
    const a = rand(0, Math.PI * 2), r = rand(1, f.r * 0.8);
    this.goal = { x: f.x + Math.cos(a) * r, z: f.z + Math.sin(a) * r, flag: f.id };
    this.path = this.g.nav.findPath(p.x, p.z, this.goal.x, this.goal.z);
    this.pathIdx = 1;
    this.repathAt = this.g.now() + rand(9000, 16000);
  }

  perceive(now) {
    const p = this.p, eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
    let best = null, bestD = 130 * (0.7 + this.skill * 0.4);
    const fwdYaw = p.yaw;
    for (const q of this.g.players.values()) {
      if (!q.alive || q.air || !this.g.isEnemy(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > bestD) continue;
      const yawTo = Math.atan2(-(q.x - p.x), -(q.z - p.z));
      const inFov = Math.abs(angleDiff(fwdYaw, yawTo)) < 1.25 || d < 12 || q === this.target;
      if (!inFov) continue;
      // prone targets far away are hard to spot
      if (q.stance === 'prone' && d > 45) continue;
      const tgt = { x: q.x, y: q.y + (q.stance === 'prone' ? 0.3 : q.stance === 'crouch' ? 0.9 : 1.35), z: q.z };
      if (!this.g.world.lineOfSight(eye, tgt)) continue;
      best = q; bestD = d;
    }
    if (best && best !== this.target) {
      this.target = best;
      this.reactUntil = now + rand(200, 650) * (1.35 - this.skill);
      const spread = 0.05 + (1 - this.skill) * 0.12;
      this.aimErr = { yaw: rand(-spread, spread) * 2, pitch: rand(-spread, spread) };
      this.burstLeft = 0;
    }
    if (best) this.lastSeen = { x: best.x, y: best.y, z: best.z, t: now };
    else if (this.target && (!this.target.alive || now - (this.lastSeen?.t || 0) > 1500)) this.target = null;
    this.visible = !!best && best === this.target;
  }

  think(dt) {
    const g = this.g, p = this.p, now = g.now();
    if (now >= this.nextPerceive) { this.perceive(now); this.nextPerceive = now + 220; }
    if (this.target && !this.target.alive) this.target = null;
    const input = { fx: 0, fz: 0, sprint: false, jump: false, ads: false };
    const w = p.weapons[p.slot], def = w && WEAPONS[w.id];

    if (this.target && this.visible && def) {
      const t = this.target;
      const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
      const aimY = t.y + (t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.95 : 1.4) + (Math.random() < 0.18 * this.skill ? 0.25 : 0);
      const dx = t.x + (t.vx || 0) * 0.08 - eye.x, dy = aimY - eye.y, dz = t.z + (t.vz || 0) * 0.08 - eye.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz) + this.aimErr.yaw;
      const wantPitch = Math.atan2(dy, dist) + this.aimErr.pitch;
      // aim error converges as the bot tracks the target
      const conv = Math.exp(-dt * (1.2 + this.skill * 2.2));
      this.aimErr.yaw *= conv; this.aimErr.pitch *= conv;
      const turn = (3 + this.skill * 5) * dt;
      p.yaw += clamp(angleDiff(p.yaw, wantYaw), -turn, turn);
      p.pitch += clamp(wantPitch - p.pitch, -turn, turn);
      p.ads = dist > 18 || def.scoped;
      input.ads = p.ads;
      // stance choice
      if (now > this.stanceUntil) {
        const r = Math.random();
        this.wantStance = dist > 50 && r < 0.3 ? 'prone' : r < 0.35 ? 'crouch' : 'stand';
        this.stanceUntil = now + rand(1500, 4000);
      }
      p.stance = this.wantStance;
      // strafe
      if (now > this.strafeUntil) { this.strafe = p.stance === 'stand' ? (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.7 ? 1 : 0) : 0; this.strafeUntil = now + rand(400, 1400); }
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      input.fx = rx * this.strafe; input.fz = rz * this.strafe;
      // fire
      const aimed = Math.abs(angleDiff(p.yaw, wantYaw - this.aimErr.yaw)) < 0.09 + 0.6 / Math.max(dist, 3);
      if (now > this.reactUntil && aimed && now > this.burstPauseUntil && now >= p.reloadUntil) {
        if (w.mag <= 0) g.reload(p);
        else {
          if (this.burstLeft <= 0) this.burstLeft = def.auto ? Math.round(rand(3, dist > 40 ? 4 : 8)) : 1;
          const spread = (def.auto ? (p.ads ? 0.012 : 0.03) : 0.004) * (1.6 - this.skill) + (dist > 60 ? 0.004 : 0);
          const cp = Math.cos(p.pitch);
          const d = [-Math.sin(p.yaw) * cp + rand(-spread, spread), Math.sin(p.pitch) + rand(-spread, spread), -Math.cos(p.yaw) * cp + rand(-spread, spread)];
          if (g.tryFire(p, [eye.x, eye.y, eye.z], d)) {
            this.burstLeft--;
            p.pitch += def.recoil.pitch * 0.004 * (1.2 - this.skill);
            if (this.burstLeft <= 0) this.burstPauseUntil = now + (def.auto ? rand(250, 700) : rand(900, 1800));
          }
        }
      }
      return input;
    }

    // no visible target
    p.ads = false;
    if (p.stance !== 'stand' && now > this.stanceUntil) p.stance = 'stand';
    if (def && w.mag < def.mag * 0.5 && w.reserve > 0 && !p.reloadUntil) g.reload(p);

    // grenade at last known position behind cover
    if (this.target && this.lastSeen && p.grenades > 0 && now - this.lastSeen.t < 2500 && Math.random() < 0.008) {
      const dx = this.lastSeen.x - p.x, dz = this.lastSeen.z - p.z, d = Math.hypot(dx, dz);
      if (d > 10 && d < 32) {
        const up = 0.35 + d * 0.004;
        g.throwGrenade(p, [p.x, p.y + 1.6, p.z], [dx / d, up, dz / d]);
      }
    }

    // flag captured / reached goal -> choose next
    const goalFlag = g.flags.find((f) => f.id === this.goal?.flag);
    const atGoal = this.goal && Math.hypot(this.goal.x - p.x, this.goal.z - p.z) < 2.5;
    if (!this.goal || now > this.repathAt || (goalFlag && goalFlag.owner === p.team && !goalFlag.contested && Math.abs(goalFlag.progress) >= 1 && atGoal)) this.pickGoal();

    // chase last seen briefly
    let tx, tz;
    if (this.target && this.lastSeen && now - this.lastSeen.t < 4000) { tx = this.lastSeen.x; tz = this.lastSeen.z; }
    else if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[this.pathIdx];
      if (Math.hypot(wp.x - p.x, wp.z - p.z) < 1.2) this.pathIdx++;
      tx = wp.x; tz = wp.z;
    } else if (atGoal || !this.path) {
      // hold the objective: slowly look around
      p.yaw += Math.sin(now / 900 + p.id) * 0.6 * dt;
      if (!this.path && Math.random() < 0.02) this.pickGoal();
      return input;
    }
    if (tx !== undefined) {
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.3) {
        input.fx = dx / d; input.fz = dz / d;
        const wantYaw = Math.atan2(-dx, -dz);
        p.yaw += clamp(angleDiff(p.yaw, wantYaw), -4 * dt, 4 * dt);
        p.pitch *= 0.9;
        input.sprint = d > 6 && !this.target;
        p.sprint = input.sprint;
      }
    }
    // stuck detection
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.stuckT = moved < 0.4 * dt * 3 ? this.stuckT + dt : 0;
    this.lastPos = { x: p.x, z: p.z };
    if (this.stuckT > 0.6 && now > (this.nextJump || 0)) { input.jump = true; this.nextJump = now + 2500; }
    if (this.stuckT > 2) { this.stuckT = 0; this.path = this.g.nav.findPath(p.x, p.z, this.goal.x, this.goal.z); this.pathIdx = 1; if (!this.path) this.pickGoal(); }
    return input;
  }
}
