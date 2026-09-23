// VehiclePhysics: arcade-realistic single-track (bicycle) tire model with weight transfer,
// friction circle, handbrake drifting with assists, automatic gearbox, nitrous, a 3-DOF
// sprung body (heave/pitch/roll) for visible suspension, airborne flight and collisions.
//
// Frame: yaw θ, forward f = (sinθ, 0, cosθ), left l = (cosθ, 0, -sinθ).
// Positive steer input = right; positive δ (wheel angle) = left (ISO convention).
import { clamp, lerp, sign, approach } from '../core/util.js';
import { obbOverlap, contactPoint } from './Collision.js';

const G = 9.81;
const TMP = [];

export const DEFAULT_PARAMS = {
  mass: 1450, enginePower: 300, maxSpeed: 78, acceleration: 1, brakingForce: 16000, steeringAngle: 0.56,
  grip: 1.25, driftGrip: 0.42, drag: 0, downforce: 1.4, suspensionStrength: 2.1, suspensionDamping: 0.45,
  wheelRadius: 0.34, wheelBase: 2.62, trackWidth: 1.6, cgHeight: 0.48, frontWeight: 0.53,
  gears: [3.2, 2.2, 1.65, 1.3, 1.05, 0.86], finalDrive: 3.7, redline: 7600, idle: 850, drive: 'RWD',
  nitroPower: 0.6, nitroCapacity: 5, length: 4.45, width: 1.9, driftAssist: 1, powerOversteer: 1,
};

export class VehicleState {
  constructor() {
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;        // world velocity
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0;                // visual body angles (rad)
    this.rpm = 850; this.gear = 1; this.speed = 0; // speed m/s (signed forward)
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.nitro = 1; this.nitroActive = false;
    this.damage = 0; this.onGround = true; this.drifting = false; this.slip = 0;
    this.wheelAngle = [0, 0, 0, 0]; this.wheelComp = [0, 0, 0, 0]; this.wheelOff = [0, 0, 0, 0]; this.wheelSpin = 0; this.groundY = 0;
  }
  toJSON() { return { p: [this.x, this.y, this.z], yaw: this.yaw, v: [this.vx, this.vy, this.vz], r: this.yawRate, rpm: this.rpm, g: this.gear, s: this.steer, n: this.nitroActive, d: this.damage }; }
}

export class VehiclePhysics {
  constructor(params = {}, world = null) {
    this.p = { ...DEFAULT_PARAMS, ...params };
    this.world = world;           // {layout, collision}
    this.s = new VehicleState();
    this.derive();
    // internal
    this.vUp = 0; this.pitchDyn = 0; this.pitchVel = 0; this.rollDyn = 0; this.rollVel = 0;
    this.axPrev = 0; this.ayPrev = 0; this.delta = 0; this.shiftTimer = 0; this.airTime = 0;
    this.rearGripMul = 1; this.reverse = false; this.wheelspin = 0; this.airPitch = 0;
    this.groundPrev = 0; this.events = [];
    this.lastImpact = 0;
    this.corners = [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.groundH = [0, 0, 0, 0];
  }

  derive() {
    const p = this.p;
    p.a = p.wheelBase * (1 - p.frontWeight); // CG -> front axle
    p.b = p.wheelBase * p.frontWeight;       // CG -> rear axle
    p.inertia = p.mass * (p.length * p.length + p.width * p.width) / 12 * 1.1;
    p.powerW = p.enginePower * 1000 * p.acceleration;
    // aerodynamic drag chosen so power-limited top speed equals maxSpeed
    p.cd = p.drag > 0 ? p.drag : p.powerW * 0.93 / (p.maxSpeed ** 3);
    p.hx = p.width / 2; p.hz = p.length / 2;
    p.suspOmega = p.suspensionStrength * Math.PI * 2;
  }

  setParams(params) { Object.assign(this.p, params); this.derive(); }

  place(x, z, yaw, y) {
    const s = this.s;
    s.x = x; s.z = z; s.yaw = yaw;
    s.y = y ?? (this.world ? this.world.layout.groundHeight(x, z) : 0);
    s.vx = s.vy = s.vz = 0; s.yawRate = 0; this.vUp = 0; s.speed = 0; s.gear = 1;
    this.pitchDyn = this.rollDyn = this.pitchVel = this.rollVel = 0;
    s.onGround = true; this.airTime = 0;
  }

  // controls: {throttle, brake, steer, handbrake, nitro}
  step(dt, c) {
    const p = this.p, s = this.s;
    const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
    const fx = sinY, fz = cosY, lx = cosY, lz = -sinY;
    let vx = s.vx * fx + s.vz * fz;   // forward
    let vy = s.vx * lx + s.vz * lz;   // left
    let r = s.yawRate;
    const speed = Math.hypot(vx, vy);
    const dmg = s.damage;

    // ---------------------------------------------------------------- inputs
    let throttle = c.throttle, brake = c.brake;
    if (!this.reverse && brake > 0.1 && vx < 0.8 && throttle < 0.1) this.reverse = true;
    if (this.reverse && (throttle > 0.1 || vx > 1.5)) this.reverse = false;
    let driveIn = throttle, brakeIn = brake;
    if (this.reverse) { driveIn = -brake; brakeIn = throttle; }
    if (vx < -0.5 && throttle > 0.1) { brakeIn = throttle; driveIn = 0; }
    s.throttle = Math.abs(driveIn); s.brake = brakeIn; s.handbrake = c.handbrake;

    // speed-sensitive steering, extra lock allowed while drifting for counter-steer
    const beta = Math.atan2(vy, Math.max(Math.abs(vx), 0.5));
    const slipAngle = Math.abs(beta);
    const maxLock = p.steeringAngle * lerp(1, 0.28, clamp(speed / 62, 0, 1)) * (1 + clamp(slipAngle * 1.2, 0, 0.8));
    const targetDelta = -c.steer * maxLock;
    this.delta = approach(this.delta, targetDelta, 3.2 * dt * (1 + speed / 40));
    const delta = this.delta;
    s.steer = c.steer;

    // ---------------------------------------------------------------- nitrous
    const wantNitro = c.nitro && s.nitro > 0.02 && driveIn > 0.1 && !this.reverse;
    s.nitroActive = wantNitro;
    if (wantNitro) s.nitro = Math.max(0, s.nitro - dt / p.nitroCapacity);

    // ---------------------------------------------------------------- loads
    const L = p.wheelBase, m = p.mass;
    const down = p.downforce * speed * speed;
    const transfer = m * this.axPrev * p.cgHeight / L;
    let Fzf = m * G * p.frontWeight - transfer + down * 0.45;
    let Fzr = m * G * (1 - p.frontWeight) + transfer + down * 0.55;
    Fzf = Math.max(Fzf, 200); Fzr = Math.max(Fzr, 200);
    if (!s.onGround) { Fzf = 0; Fzr = 0; }

    // ---------------------------------------------------------------- engine & gearbox
    const R = p.wheelRadius;
    const gears = p.gears;
    const ratio = () => gears[s.gear - 1] * p.finalDrive;
    const wheelRpm = Math.abs(vx) / R * 60 / (2 * Math.PI);
    if (this.reverse) s.gear = 1;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (!this.reverse && s.onGround) {
      const rpmNow = wheelRpm * ratio();
      if (rpmNow > p.redline * 0.93 && s.gear < gears.length && driveIn > 0.2) { s.gear++; this.shiftTimer = 0.22; this.events.push({ type: 'gearUp' }); }
      else if (s.gear > 1 && wheelRpm * gears[s.gear - 2] * p.finalDrive < p.redline * 0.72) { s.gear--; this.shiftTimer = 0.12; this.events.push({ type: 'gearDown' }); }
    }
    let targetRpm = wheelRpm * ratio();
    // clutch slip at launch / wheelspin keeps revs up
    const launch = Math.max(0, 1 - Math.abs(vx) / 8) * Math.abs(driveIn);
    targetRpm = Math.max(targetRpm, p.idle + launch * p.redline * 0.55 + this.wheelspin * 1800);
    if (!s.onGround) targetRpm = lerp(s.rpm, p.idle + Math.abs(driveIn) * p.redline, 0.08);
    if (this.shiftTimer > 0.08) targetRpm *= 0.97;
    s.rpm = clamp(lerp(s.rpm, targetRpm, 1 - Math.exp(-dt * 18)), p.idle * 0.9, p.redline * 1.02);
    // torque curve shape (normalized)
    const x = s.rpm / p.redline;
    const curve = clamp(0.55 + 0.75 * x - 0.45 * x * x, 0.35, 1) * (x > 1 ? 0.2 : 1);
    let power = p.powerW * curve * (1 - dmg * 0.35) * (wantNitro ? 1 + p.nitroPower : 1);
    let Fdrive = 0;
    if (s.onGround) {
      if (driveIn > 0) Fdrive = driveIn * power / Math.max(Math.abs(vx), 9);
      else if (driveIn < 0) Fdrive = vx > -16 ? driveIn * power * 0.45 / Math.max(Math.abs(vx), 6) : 0;
      if (this.shiftTimer > 0) Fdrive *= 0.25;
    }
    // engine braking + rolling resistance + aero drag
    const moving = Math.abs(vx) > 0.05 ? sign(vx) : 0;
    let Fresist = -p.cd * vx * Math.abs(vx) - 0.013 * m * G * moving;
    if (driveIn === 0 && s.onGround) Fresist -= moving * m * 0.9 * (s.rpm / p.redline);
    // brakes
    let Fbrake = 0;
    if (s.onGround && brakeIn > 0) Fbrake = -moving * brakeIn * p.brakingForce;
    const hb = c.handbrake > 0 && s.onGround;
    if (hb) Fbrake += -moving * p.brakingForce * 0.35;
    // distribute: brake 65/35, drive by layout
    const awd = p.drive === 'AWD';
    let Fxf = Fbrake * (hb ? 0.3 : 0.65) + (awd ? Fdrive * 0.4 : 0);
    let Fxr = Fbrake * (hb ? 0.7 : 0.35) + (awd ? Fdrive * 0.6 : Fdrive);

    // ---------------------------------------------------------------- lateral tire forces
    this.rearGripMul = approach(this.rearGripMul, hb ? p.driftGrip : 1, dt * (hb ? 6 : 1.6));
    const mu = p.grip * (1 - dmg * 0.15);
    const muF = mu * 1.02, muR = mu * this.rearGripMul;
    let Fyf = 0, Fyr = 0;
    const vxa = Math.max(Math.abs(vx), 1.0);
    const af = Math.atan2(vy + p.a * r, vxa) - delta * sign(vx || 1);
    const ar = Math.atan2(vy - p.b * r, vxa);
    const tire = (alpha) => Math.sin(1.45 * Math.atan(11 * alpha));
    // friction circle on the rear: wheelspin under power (power oversteer)
    const maxR = muR * Fzr, maxF = muF * Fzf;
    this.wheelspin = 0;
    if (Math.abs(Fxr) > maxR * 0.95) { this.wheelspin = clamp((Math.abs(Fxr) - maxR * 0.95) / maxR, 0, 1); Fxr = sign(Fxr) * maxR * 0.95; }
    if (Math.abs(Fxf) > maxF * 0.95) Fxf = sign(Fxf) * maxF * 0.95;
    const latR = Math.sqrt(Math.max(0, maxR * maxR - (Fxr * p.powerOversteer) ** 2 * 0.85));
    const latF = Math.sqrt(Math.max(0, maxF * maxF - Fxf * Fxf * 0.6));
    Fyf = -tire(af) * Math.max(latF, maxF * 0.3);
    Fyr = -tire(ar) * Math.max(latR, maxR * 0.35);

    // ---------------------------------------------------------------- integrate planar dynamics
    const cosD = Math.cos(delta), sinD = Math.sin(delta);
    let ax = (Fxf * cosD - Fyf * sinD + Fxr + Fresist) / m;
    let ay = (Fxf * sinD + Fyf * cosD + Fyr) / m;
    let rdot = (p.a * (Fyf * cosD + Fxf * sinD) - p.b * Fyr) / p.inertia;

    // --- stability control (grip mode): stop over-rotation unless the driver is drifting ---
    const vAbs = Math.max(speed, 0.1);
    if (s.onGround && !this.driftMode && !hb && speed > 6) {
      const rGrip = (mu * G * 1.15) / vAbs;
      const rKin = clamp(vx * Math.tan(delta) / L, -rGrip, rGrip);
      const over = Math.abs(r) > Math.abs(rKin) && Math.sign(r) === Math.sign(rKin || r);
      if (over || slipAngle > 0.1) rdot -= (r - rKin) * 5.5 * clamp(speed / 25, 0.3, 1) / Math.max(0.6, p.powerOversteer);
    }
    const betaOld = Math.atan2(vy, Math.max(Math.abs(vx), 0.5));
    const vOld = Math.hypot(vx, vy);
    // integrate (local frame with centripetal terms)
    vx += (ax + vy * r) * dt;
    vy += (ay - vx * r) * dt;
    r += rdot * dt;
    // low-speed: blend to kinematic steering to avoid numeric jitter
    const k = clamp((Math.abs(vx) - 0.8) / 4, 0, 1);
    if (s.onGround) {
      const rKin = vx * Math.tan(delta) / L;
      r = lerp(rKin, r, k);
      vy = lerp(vy * 0.85, vy, k);
      if (Math.abs(vx) < 0.15 && driveIn === 0) { vx *= 0.9; }
    } else {
      r *= 1 - dt * 0.8; // air: keep rotation, slowly damp
    }

    // --- arcade drift controller ---
    // The physics decides where the car travels; the driver controls the slip angle (nose vs.
    // travel direction). Holding the turn deepens the angle, counter-steer straightens it.
    if (s.onGround && vx > 0) {
      const spd = Math.hypot(vx, vy);
      const betaNew = Math.atan2(vy, vx);
      if (!this.driftMode) {
        if ((hb && spd > 9 && (Math.abs(c.steer) > 0.2 || Math.abs(betaNew) > 0.06)) || (Math.abs(betaNew) > 0.28 && spd > 10)) this.driftMode = true;
      } else if ((Math.abs(betaNew) < 0.07 && !hb) || spd < 5) this.driftMode = false;
      if (this.driftMode) {
        let dir = Math.sign(betaNew) || -Math.sign(c.steer) || 1;
        if (Math.abs(betaNew) < 0.05 && Math.abs(c.steer) > 0.2) dir = Math.sign(c.steer); // handbrake flick: slide away from the turn
        const into = c.steer * dir;
        let bt = 0.36 + 0.34 * Math.max(0, into) - 0.55 * Math.max(0, -into) + 0.08 * Math.max(0, driveIn);
        if (!hb && driveIn < 0.1) bt *= 0.45;           // lift: drift fades out
        if (hb) bt = Math.max(bt, 0.5);
        bt = clamp(bt, 0.0, 0.82) * dir;
        const assist = clamp(0.8 * p.driftAssist, 0, 1);
        const rate = hb ? 3.2 : 2.2;
        const betaCtl = betaOld + (bt - betaOld) * (1 - Math.exp(-dt * rate));
        let beta = lerp(betaNew, betaCtl, assist);
        beta = clamp(beta, -0.9, 0.9);
        // travel direction from physics; nose placed at (travel - beta)
        // extra path curvature while drifting so slides can take city corners
        const turnAssist = (0.22 + 0.4 * Math.max(0, into)) * clamp(spd / 18, 0, 1) * p.driftAssist;
        const headV = s.yaw + r * dt + betaNew - dir * turnAssist * dt;
        const newYaw = headV - beta;
        r = (newYaw - s.yaw) / dt;
        // keep momentum while sliding on throttle (arcade)
        let sp2 = spd;
        const maxLoss = (driveIn > 0.1 ? 2.2 : 6) * dt;
        if (sp2 < vOld - maxLoss) sp2 = vOld - maxLoss;
        vx = sp2 * Math.cos(beta); vy = sp2 * Math.sin(beta);
      }
    } else this.driftMode = false;
    s.drifting = this.driftMode && Math.abs(Math.atan2(vy, Math.max(vx, 0.5))) > 0.12;
    this.axPrev = lerp(this.axPrev, clamp(ax, -14, 12), 0.2);
    this.ayPrev = lerp(this.ayPrev, clamp(ay, -14, 14), 0.2);

    // back to world
    s.yawRate = r;
    s.yaw += r * dt;
    const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
    s.vx = vx * sn + vy * cs;
    s.vz = vx * cs - vy * sn;
    s.x += s.vx * dt;
    s.z += s.vz * dt;
    s.speed = vx;
    s.slip = slipAngle;

    // ---------------------------------------------------------------- vertical / suspension
    this._vertical(dt, sn, cs);

    // ---------------------------------------------------------------- wheels (visual)
    const wheelSpeed = vx / R + (this.wheelspin * 25 + (hb ? -vx / R * 0.9 : 0)) * (s.onGround ? 1 : 0);
    s.wheelSpin += (s.onGround ? wheelSpeed : lerp(0, wheelSpeed, 0.98)) * dt;
    s.wheelSteer = delta;
    this.lastWheelspin = this.wheelspin;

    // ---------------------------------------------------------------- collisions
    if (this.world) this._collide(dt);
  }

  _vertical(dt, sn, cs) {
    const p = this.p, s = this.s;
    const hw = p.trackWidth / 2, a = p.a, b = p.b;
    // wheel ground heights: FL, FR, RL, RR (left = +l)
    const pts = [[a, hw], [a, -hw], [-b, hw], [-b, -hw]];
    const layout = this.world?.layout;
    let hs = 0;
    for (let i = 0; i < 4; i++) {
      const [f, l] = pts[i];
      const wx = s.x + sn * f + cs * l, wz = s.z + cs * f - sn * l;
      this.corners[i][0] = wx; this.corners[i][1] = wz;
      const h = layout ? layout.groundHeight(wx, wz) : 0;
      this.groundH[i] = h; hs += h;
    }
    const gh = this.groundH;
    const hg = Math.max(hs / 4, Math.max(gh[0], gh[1], gh[2], gh[3]) - 0.12);
    const terrainPitch = Math.atan2((gh[0] + gh[1]) / 2 - (gh[2] + gh[3]) / 2, a + b);
    const terrainRoll = Math.atan2((gh[0] + gh[2]) / 2 - (gh[1] + gh[3]) / 2, hw * 2);
    const vg = (hg - this.groundPrev) / dt;
    this.groundPrev = hg;
    const gap = s.y - hg;
    const wasGround = s.onGround;
    if (gap > 0.2 || (!wasGround && gap > 0.0)) {
      // airborne
      s.onGround = false;
      this.vUp -= G * dt;
      this.airTime += dt;
      // nose follows trajectory a little
      const vh = Math.hypot(s.vx, s.vz);
      this.airPitch = lerp(this.airPitch, clamp(Math.atan2(this.vUp, Math.max(vh, 5)) * 0.6, -0.4, 0.4), dt * 2);
    } else {
      if (!wasGround) {
        const impact = -this.vUp;
        if (impact > 2.5) this.events.push({ type: 'landing', intensity: clamp(impact / 12, 0, 1) });
        this.pitchVel += -impact * 0.25 * (this.airPitch > 0 ? -1 : 1);
        this.airTime = 0;
      }
      s.onGround = true;
      const w = p.suspOmega;
      const acc = w * w * (hg - s.y) - 2 * p.suspensionDamping * w * (this.vUp - clamp(vg, -6, 6));
      this.vUp += acc * dt;
      this.airPitch = lerp(this.airPitch, 0, dt * 8);
      if (s.y < hg - 0.25) { s.y = hg - 0.25; this.vUp = Math.max(this.vUp, 0); }
    }
    s.y += this.vUp * dt;
    // sprung body dynamics (squat/dive/roll) — second-order springs
    const kp = 90, cp = 9;
    const pitchT = clamp(this.axPrev * 0.0065, -0.07, 0.06);
    const rollT = clamp(this.ayPrev * 0.0085, -0.085, 0.085);
    this.pitchVel += (kp * (pitchT - this.pitchDyn) - cp * this.pitchVel) * dt;
    this.pitchDyn += this.pitchVel * dt;
    this.rollVel += (kp * (rollT - this.rollDyn) - cp * this.rollVel) * dt;
    this.rollDyn += this.rollVel * dt;
    s.pitch = (s.onGround ? terrainPitch : this.airPitch) + this.pitchDyn;
    s.roll = (s.onGround ? terrainRoll : 0) + this.rollDyn;
    // per-wheel suspension compression (visual) : positive = compressed
    for (let i = 0; i < 4; i++) {
      const [f, l] = pts[i];
      const bodyY = s.y + f * Math.sin(s.pitch) + l * Math.sin(s.roll) * (1);
      const comp = gh[i] - bodyY - (i < 2 ? -this.pitchDyn * 0 : 0);
      s.wheelComp[i] = clamp(s.onGround ? comp : -0.12, -0.13, 0.12);
      s.wheelOff[i] = s.onGround ? clamp(gh[i] - s.y, -0.16, 0.7) : Math.max(-0.14, s.wheelOff[i] - 0.02);
    }
    s.groundY = hg;
  }

  obb() {
    const s = this.s, p = this.p;
    return { cx: s.x, cz: s.z, hx: p.hx * 0.96, hz: p.hz * 0.97, cos: Math.cos(s.yaw), sin: Math.sin(s.yaw) };
  }

  _collide() {
    const s = this.s, p = this.p;
    const box = this.obb();
    const ext = p.hz + 1;
    const list = this.world.collision.query(s.x - ext, s.z - ext, s.x + ext, s.z + ext, TMP);
    for (const c of list) {
      if (c.kind === 'none') continue;
      if (c.h < s.y + 0.25 && c.kind !== 'pole') continue; // drove over it (e.g. low barriers when airborne)
      const hit = obbOverlap(box, c);
      if (!hit) continue;
      this.resolveStatic(hit, c.kind, box);
      box.cx = s.x; box.cz = s.z;
    }
  }

  resolveStatic(hit, kind, box) {
    const s = this.s, p = this.p;
    const { nx, nz, depth } = hit;
    s.x += nx * depth; s.z += nz * depth;
    const vn = s.vx * nx + s.vz * nz;
    if (vn >= 0) return;
    const e = kind === 'pole' || kind === 'tree' ? 0.15 : 0.28;
    // tangential friction scrubs speed on glancing hits
    const tx = -nz, tz = nx;
    const vt = s.vx * tx + s.vz * tz;
    const glance = Math.abs(vt) / (Math.abs(vn) + Math.abs(vt) + 1e-3);
    const fr = lerp(0.55, 0.9, glance);
    s.vx = tx * vt * fr - nx * vn * e;
    s.vz = tz * vt * fr - nz * vn * e;
    // spin from off-center impact
    const [cx, cz] = contactPoint(box, nx, nz);
    const rx = cx - s.x, rz = cz - s.z;
    const torque = (rx * nz - rz * nx) * -vn;
    s.yawRate += clamp(torque * p.mass / p.inertia * 0.35, -3, 3);
    const impact = -vn;
    if (impact > 1.2) {
      s.damage = clamp(s.damage + Math.max(0, impact - 4) * 0.006, 0, 1);
      this.events.push({ type: 'collision', kind, intensity: clamp(impact / 25, 0, 1), x: cx, z: cz, nx, nz, speed: impact });
    }
  }

  // Impulse exchange between two dynamic vehicles (both VehiclePhysics or kinematic proxies).
  static resolvePair(A, B) {
    const a = A.obb(), b = B.obb();
    const hit = obbOverlap(a, b);
    if (!hit) return null;
    const { nx, nz, depth } = hit;
    const ma = A.p.mass, mb = B.p.mass, tot = ma + mb;
    A.s.x += nx * depth * (mb / tot); A.s.z += nz * depth * (mb / tot);
    B.s.x -= nx * depth * (ma / tot); B.s.z -= nz * depth * (ma / tot);
    const rvx = A.s.vx - B.s.vx, rvz = A.s.vz - B.s.vz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return { impact: 0 };
    const e = 0.3;
    const j = -(1 + e) * vn / (1 / ma + 1 / mb);
    A.s.vx += (j / ma) * nx; A.s.vz += (j / ma) * nz;
    B.s.vx -= (j / mb) * nx; B.s.vz -= (j / mb) * nz;
    const [cx, cz] = contactPoint(a, nx, nz);
    const ta = ((cx - A.s.x) * nz - (cz - A.s.z) * nx) * j / A.p.inertia * 0.5;
    const tb = ((cx - B.s.x) * nz - (cz - B.s.z) * nx) * j / B.p.inertia * 0.5;
    A.s.yawRate += clamp(ta, -2.5, 2.5); B.s.yawRate -= clamp(tb, -2.5, 2.5);
    const impact = -vn;
    A.s.damage = clamp(A.s.damage + Math.max(0, impact - 5) * 0.004 * (mb / tot) * 2, 0, 1);
    B.s.damage = clamp(B.s.damage + Math.max(0, impact - 5) * 0.004 * (ma / tot) * 2, 0, 1);
    return { impact, x: cx, z: cz, nx, nz };
  }
}
