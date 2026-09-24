// Server-side bot AI that plays like a person: objective selection, A* navigation with smooth steering, perception
// with line-of-sight, human-like aim (reaction time, converging error, bursts), and a small behaviour state machine:
//   patrol  - walk/sprint the path, glance around, slow down near danger
//   engage  - enemy in sight: stop to aim at range (one stance per fight), short strafes up close
//   cover   - hurt while exposed: run to a spot the shooter can't see, crouch, reload/heal, then peek
//   search  - lost sight: crouch-walk toward where the enemy was last seen, aiming there, then give up
//   hold    - at the objective: watch the likely approach directions, turning slowly between them
import { EYE_HEIGHT } from '../shared/world.js';
import { WEAPONS } from '../shared/weapons.js';
import { angleDiff, clamp } from '../shared/util.js';
import { zeroAngle } from '../shared/ballistics.js';

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
    this.yawVel = 0; this.pitchVel = 0; this.moveDir = { x: 0, z: 0 };
    this.mode = 'patrol'; this.cover = null; this.coverUntil = 0; this.peekUntil = 0; this.engageStance = null;
    this.watch = null; this.watchUntil = 0; this.lastThreatAt = -1e9; this.unstick = null;
    this.pickGoal();
  }

  // smooth, human-like turning: angular velocity with acceleration limits (no instant snaps, slight overshoot)
  turn(wantYaw, wantPitch, dt, speed = 1) {
    const p = this.p;
    const maxV = (2.6 + this.skill * 3.2) * speed;
    const dy = angleDiff(p.yaw, wantYaw);
    this.yawVel += (clamp(dy * 9, -maxV, maxV) - this.yawVel) * Math.min(1, dt * 10);
    p.yaw += this.yawVel * dt;
    if (wantPitch !== undefined) {
      this.pitchVel += (clamp((wantPitch - p.pitch) * 9, -maxV, maxV) - this.pitchVel) * Math.min(1, dt * 10);
      p.pitch = clamp(p.pitch + this.pitchVel * dt, -1.3, 1.3);
    }
  }

  // a spot within ~12 m that the threat cannot see (crouched), reachable in a straight line
  findCover(threat) {
    const g = this.g, p = this.p, w = g.world;
    const te = { x: threat.x, y: threat.y + 1.5, z: threat.z };
    let best = null, bestD = Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const r of [3, 6, 9, 12]) {
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const gy = w.supportHeight(x, z, p.y + 1);
        if (Math.abs(gy - p.y) > 1.2) continue;
        if (!g.nav.free(g.nav.ix(x), g.nav.iz(z))) continue;
        if (w.lineOfSight(te, { x, y: gy + 0.95, z })) continue;              // still visible crouched
        if (!w.lineOfSight({ x: p.x, y: p.y + 0.5, z: p.z }, { x, y: gy + 0.5, z })) continue; // can't get there directly
        const d = r + Math.hypot(x - threat.x, z - threat.z) * -0.05;
        if (d < bestD) { bestD = d; best = { x, z }; }
      }
    }
    return best;
  }

  // steer along the path with a smoothed direction (rounds corners instead of zig-zagging between waypoints)
  steer(tx, tz, dt, input, run) {
    const p = this.p, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) return 0;
    const k = Math.min(1, dt * 6);
    this.moveDir.x += (dx / d - this.moveDir.x) * k; this.moveDir.z += (dz / d - this.moveDir.z) * k;
    const m = Math.hypot(this.moveDir.x, this.moveDir.z) || 1;
    input.fx = this.moveDir.x / m; input.fz = this.moveDir.z / m;
    input.sprint = run; p.sprint = run;
    return d;
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
      // freshly deployed soldiers are protected (and not yet a threat): don't pre-aim the spawn
      if (now < (q.spawnProtect || 0)) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > bestD) continue;
      // armour: rifle rounds do almost nothing to a tank / helicopter; only engage crews up close
      if (q.vehicle && d > 40) continue;
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
    if (this.target && !this.target.alive) { this.target = null; this.engageStance = null; }
    const input = { fx: 0, fz: 0, sprint: false, jump: false, ads: false };
    const w = p.weapons[p.slot], def = w && WEAPONS[w.id];
    p.sprint = false;

    // ---------------------------------------------------------------- taking cover (hurt while exposed)
    if (this.mode === 'cover' && this.cover) {
      const threat = this.target || this.lastSeen;
      const d = this.steer(this.cover.x, this.cover.z, dt, input, true);
      if (threat) this.turn(Math.atan2(-(threat.x - p.x), -(threat.z - p.z)), 0, dt, 0.8);
      if (d < 0.8) {
        input.fx = input.fz = 0; input.sprint = p.sprint = false;
        p.stance = 'crouch';
        if (def && w.mag < def.mag && w.reserve > 0 && !p.reloadUntil) g.reload(p);
        if (!this.coverUntil) this.coverUntil = now + rand(1500, 3200);
        if (now > this.coverUntil && now >= p.reloadUntil) { this.mode = 'engage'; this.cover = null; this.coverUntil = 0; this.peekUntil = now + rand(1500, 3000); }
      }
      if (now - (this.coverStart || now) > 6000) { this.mode = 'patrol'; this.cover = null; }
      return input;
    }

    // ---------------------------------------------------------------- engage a visible enemy
    if (this.target && this.visible && def) {
      this.mode = 'engage'; this.lastThreatAt = now;
      const t = this.target;
      const eye = { x: p.x, y: p.y + EYE_HEIGHT[p.stance], z: p.z };
      const aimY = t.y + (t.stance === 'prone' ? 0.3 : t.stance === 'crouch' ? 0.95 : 1.4) + (Math.random() < 0.18 * this.skill ? 0.25 : 0);
      // lead moving targets by the bullet's flight time and hold over for the drop (skilled bots judge it better)
      const rough = Math.hypot(t.x - eye.x, t.z - eye.z), flight = rough / def.velocity;
      const lead = flight * (0.5 + this.skill * 0.5) + 0.05;
      const dx = t.x + (t.vx || 0) * lead - eye.x, dy = aimY - eye.y, dz = t.z + (t.vz || 0) * lead - eye.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz) + this.aimErr.yaw;
      const wantPitch = Math.atan2(dy, dist) + this.aimErr.pitch + zeroAngle(def, clamp(Math.round(dist / 10) * 10, 10, def.maxRange * 0.9)) * (0.7 + this.skill * 0.3);
      const conv = Math.exp(-dt * (1.2 + this.skill * 2.2));
      this.aimErr.yaw *= conv; this.aimErr.pitch *= conv;
      this.turn(wantYaw, wantPitch, dt, 1.4);
      p.ads = dist > 15 || def.scoped;
      input.ads = p.ads;
      // one stance per fight, like a person settling into a firing position
      if (!this.engageStance) {
        const r = Math.random();
        this.engageStance = dist > 70 && r < 0.3 ? 'prone' : dist > 20 && r < 0.55 ? 'crouch' : 'stand';
      }
      p.stance = this.engageStance;
      // movement: out of the weapon's effective range -> close the distance (like a player with a carbine would);
      // otherwise stand still to shoot at range, short committed strafes up close
      const effective = def.scoped ? 400 : def.id === 'pistol' ? 30 : 75;
      // nobody hits anything with a pistol at 100 m: beyond a weapon's practical range, hold fire and close in
      const inRange = dist <= (def.engage || 150) * (0.8 + this.skill * 0.3);
      if (dist > effective && now - (p.lastHit || 0) > 2000) {
        const d = Math.hypot(t.x - p.x, t.z - p.z) || 1;
        input.fx = (t.x - p.x) / d; input.fz = (t.z - p.z) / d;
        p.stance = 'stand'; this.engageStance = null;
      } else if (dist < 16 && p.stance === 'stand') {
        if (now > this.strafeUntil) { this.strafe = Math.random() < 0.45 ? 0 : Math.random() < 0.5 ? -1 : 1; this.strafeUntil = now + rand(700, 1900); }
        const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
        input.fx = rx * this.strafe * 0.8; input.fz = rz * this.strafe * 0.8;
      }
      // fire
      const aimed = Math.abs(angleDiff(p.yaw, wantYaw - this.aimErr.yaw)) < 0.09 + 0.6 / Math.max(dist, 3);
      if (!inRange && now - (p.lastHit || 0) > 2000) { p.stance = 'stand'; this.engageStance = null; }
      if (inRange && now > this.reactUntil && aimed && now > this.burstPauseUntil && now >= p.reloadUntil) {
        if (w.mag <= 0) g.reload(p);
        else {
          // trigger discipline: long bursts only up close, short bursts / taps at range
          if (this.burstLeft <= 0) this.burstLeft = def.auto ? (dist > 60 ? Math.round(rand(1, 2)) : dist > 30 ? Math.round(rand(2, 4)) : Math.round(rand(4, 8))) : 1;
          const moving = Math.hypot(p.vx || 0, p.vz || 0) > 1;
          // real dispersion: the weapon's own cone (degrees) + a person's hold (a handgun wobbles far more than a
          // shouldered rifle) + follow-up shots fired before the sights settle
          const hold = def.id === 'pistol' ? 0.9 : def.scoped ? 0.05 : 0.25;
          const cone = (p.ads ? def.spreadAds : def.spreadHip * 0.5) + hold + (this.lastShotAt && now - this.lastShotAt < 350 ? (def.id === 'pistol' ? 0.8 : 0.3) : 0);
          const spread = (cone * Math.PI / 180) * (1.5 - this.skill * 0.7) * (moving ? 1.8 : 1) * (p.stance === 'prone' ? 0.6 : p.stance === 'crouch' ? 0.8 : 1);
          const cp = Math.cos(p.pitch);
          const d = [-Math.sin(p.yaw) * cp + rand(-spread, spread), Math.sin(p.pitch) + rand(-spread, spread), -Math.cos(p.yaw) * cp + rand(-spread, spread)];
          if (g.tryFire(p, [eye.x, eye.y, eye.z], d)) {
            this.burstLeft--; this.lastShotAt = now;
            p.pitch += def.recoil.pitch * 0.004 * (1.2 - this.skill);
            if (this.burstLeft <= 0) this.burstPauseUntil = now + (def.auto ? (dist > 60 ? rand(350, 800) : rand(200, 550)) : rand(900, 1800));
          }
        }
      }
      // losing the fight in the open: break line of sight
      if (p.hp < 55 && now - (p.lastHit || 0) < 1500 && p.stance !== 'prone' && now > (this.nextCoverTry || 0)) {
        this.nextCoverTry = now + 4000;
        const c = this.findCover(t);
        if (c) { this.mode = 'cover'; this.cover = c; this.coverStart = now; this.coverUntil = 0; }
      }
      return input;
    }

    // no visible target
    p.ads = false;
    this.engageStance = null;
    if (def && w.mag < def.mag * 0.5 && w.reserve > 0 && !p.reloadUntil) g.reload(p);

    // grenade at last known position behind cover
    if (this.target && this.lastSeen && p.grenades > 0 && now - this.lastSeen.t < 2500 && Math.random() < 0.008) {
      const dx = this.lastSeen.x - p.x, dz = this.lastSeen.z - p.z, d = Math.hypot(dx, dz);
      if (d > 10 && d < 32) {
        const up = 0.35 + d * 0.004;
        g.throwGrenade(p, [p.x, p.y + 1.6, p.z], [dx / d, up, dz / d]);
      }
    }

    // ---------------------------------------------------------------- search where the enemy was last seen
    if (this.lastSeen && now - this.lastSeen.t < 6000 && (this.target || now - this.lastSeen.t < 4000)) {
      this.mode = 'search';
      const ls = this.lastSeen;
      p.stance = this.skill > 0.6 && now - ls.t < 3000 ? 'crouch' : 'stand';
      const d = this.steer(ls.x, ls.z, dt, input, false);
      if (d < 2) { input.fx = input.fz = 0; }
      p.ads = input.ads = true;
      this.turn(Math.atan2(-(ls.x - p.x), -(ls.z - p.z)) + Math.sin(now / 700) * 0.25, 0, dt, 0.7);
      return input;
    }
    if (this.mode === 'search') { this.mode = 'patrol'; this.target = null; this.pickGoal(); }
    if (p.stance !== 'stand' && now > this.stanceUntil) p.stance = 'stand';

    // flag captured / reached goal -> choose next
    const goalFlag = g.flags.find((f) => f.id === this.goal?.flag);
    const atGoal = this.goal && Math.hypot(this.goal.x - p.x, this.goal.z - p.z) < 2.5;
    if (!this.goal || now > this.repathAt || (goalFlag && goalFlag.owner === p.team && !goalFlag.contested && Math.abs(goalFlag.progress) >= 1 && atGoal)) this.pickGoal();

    // ---------------------------------------------------------------- hold the objective: watch approach directions
    if (!this.path || this.pathIdx >= this.path.length) {
      this.mode = 'hold';
      if (now > this.watchUntil) {
        const enemyBase = g.map.BASES?.[p.team === 1 ? 2 : 1];
        const toward = enemyBase ? Math.atan2(-(enemyBase.x - p.x), -(enemyBase.z - p.z)) : p.yaw;
        this.watch = toward + rand(-1.1, 1.1);
        this.watchUntil = now + rand(2500, 6000);
        if (Math.random() < 0.35) { p.stance = 'crouch'; this.stanceUntil = now + rand(3000, 8000); }
      }
      this.turn(this.watch, rand(-0.05, 0.05), dt, 0.35);
      if (!this.path && Math.random() < 0.02) this.pickGoal();
      return input;
    }

    // ---------------------------------------------------------------- patrol: follow the path
    this.mode = 'patrol';
    let wp = this.path[this.pathIdx];
    // advance early, and skip a waypoint when the next one is already in direct view (smoother lines)
    if (Math.hypot(wp.x - p.x, wp.z - p.z) < 2 && this.pathIdx < this.path.length - 1) wp = this.path[++this.pathIdx];
    else if (Math.hypot(wp.x - p.x, wp.z - p.z) < 1) this.pathIdx++;
    let remaining = Math.hypot(wp.x - p.x, wp.z - p.z);
    for (let i = this.pathIdx; i < this.path.length - 1; i++) remaining += Math.hypot(this.path[i + 1].x - this.path[i].x, this.path[i + 1].z - this.path[i].z);
    const recentThreat = now - this.lastThreatAt < 8000;
    const run = remaining > 18 && !recentThreat;
    this.steer(wp.x, wp.z, dt, input, run);
    // look where you go; while walking also glance left/right
    const moveYaw = Math.atan2(-input.fx, -input.fz);
    const glance = run ? 0 : Math.sin(now / 1300 + p.id * 1.7) * 0.5;
    this.turn(moveYaw + glance, recentThreat ? 0 : -0.05, dt, run ? 1 : 0.6);

    // stuck: step sideways and repath (an occasional hop over something low, never bunny-hopping)
    const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
    this.stuckT = moved < 0.4 * dt * 3 ? this.stuckT + dt : 0;
    this.lastPos = { x: p.x, z: p.z };
    if (this.unstick && now < this.unstick.until) { input.fx = this.unstick.x; input.fz = this.unstick.z; input.sprint = false; }
    if (this.stuckT > 0.8) {
      const side = Math.random() < 0.5 ? 1 : -1;
      this.unstick = { x: -input.fz * side, z: input.fx * side, until: now + 600 };
      if (now > (this.nextJump || 0)) { input.jump = true; this.nextJump = now + 8000; }
    }
    if (this.stuckT > 2.5) { this.stuckT = 0; this.path = this.g.nav.findPath(p.x, p.z, this.goal.x, this.goal.z); this.pathIdx = 1; if (!this.path) this.pickGoal(); }
    return input;
  }
}
