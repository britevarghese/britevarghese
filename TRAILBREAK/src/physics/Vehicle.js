// Vehicle: a rigid-body chassis on two solid (beam) axles, simulated at a fixed substep (PHYS_DT).
//
// Chassis: a 6-DOF rigid body (position, orientation quaternion, linear and angular velocity, inertia tensor in
// the body frame). Gravity, springs, tyres, hull contacts, trees, other trucks, the winch rope, water and air
// push on it; it is integrated with semi-implicit Euler.
//
// Axles: each axle is an unsprung body with two degrees of freedom relative to the chassis, the travel of its left
// and right wheel along the chassis' up axis (zL, zR; 0 = full droop, + = compression). A beam axle couples them
// through its mass matrix (heave mass + roll inertia), so when one wheel climbs a rock the other is pushed down:
// that is articulation. Leaf/coil springs sit inboard of the wheels (spring track < wheel track), dampers are
// stiffer in rebound than in bump, limit straps stop the droop and progressive bump stops the compression.
// The axle is integrated in the chassis frame, so the chassis' own acceleration enters as a pseudo-force.
//
// Tyres: the wheel is a disc. Rays from the hub at several angles around the bottom of the tyre find where the
// ground (terrain, ruts and boulders) cuts into the tread, so a tyre meets a ledge on its front face and rolls up
// it. The tyre is a radial spring-damper; its friction comes from Tire.js (bristle relaxation + combined slip),
// and the wheel's spin from Drivetrain.js. Lateral tyre force goes to the chassis at the hub height of a beam axle
// (its roll centre); the rest of its moment acts on the axle and shifts load between the tyres.
//
// Soft ground: a tyre presses mud, sand and snow down to the depth its contact pressure can hold up
// (pressure-sinkage), and a spinning tyre digs itself deeper. The ground keeps the ruts. Airing the tyres down
// lengthens and widens the footprint, so it sinks less and floats over sand, and the soft carcass wraps over rock.
//
// Under the truck: the diff housings and the spring plates hang below the axles (the lowest points of a beam axle
// truck, raised only by bigger tyres), the belly (frame, transfer case) and the bumpers ride on the body, raised by
// a lift too. The air intake has to stay out of the water or the engine stops.

import { V3, Quat, clamp, smoothstep, lerp } from './math.js';
import { Damage } from './Damage.js';
import { tyreForce, corneringStiffness, slipStiffness, gripOn } from './Tire.js';
import { Drivetrain } from './Drivetrain.js';
import { surfaceById, SURFACES, SURFACE } from './Surfaces.js';

export const PHYS_DT = 1 / 480;
export const GRAVITY = 9.81;
const RHO_AIR = 1.2;
const RHO_WATER = 1000;
const RAY_ANGLES = [-1.4, -1.05, -0.7, -0.35, 0, 0.35, 0.7, 1.05, 1.4];   // rad around the bottom of the tyre (+ = forward)
const RAY_STEP = 0.35;
// how long the soil takes to give way under a tyre's load (s): it sinks under the load the tyre carries, not under each
// jolt of it
const SOIL_TAU = 0.1;
const NO_CONTROLS = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
const STEER_DAMP = 0.08;              // keys / sticks: wheel angle (rad) taken off per rad/s the yaw rate runs ahead
const TC_KP = 1, TC_KI = 10;          // electric traction control: power taken off per unit of excess spin, and how fast it settles (1/s)
const BLD_A = 1.5, BLD_K = 1500;      // brake locking: spin (rad/s) between an axle's wheels before it brakes, Nm per rad/s past that
const ESC_K = 1, ESC_OFF = 8, ESC_ON = 2;  // stability control: power off per unit of slide, how fast it comes off and back (1/s)
// keys / sticks: the share of the front tyres' grip the steering asks for at speed, the slip angle (in their best one)
// it allows them on top, the share of the pull that would lift a truck's inside wheels it asks no more than, and how far
// over to one side its weight may go (1: all of it) before the wheels turn no further in
const AS_MU = 0.9, AS_SLIP = 0.35, AS_TIP = 0.7, LTR_HOLD = 0.8;

/** Ground normal by central differences. */
export function groundNormal(ground, x, z, out, e = 0.3) {
  const hx = ground.height(x - e, z) - ground.height(x + e, z);
  const hz = ground.height(x, z - e) - ground.height(x, z + e);
  out.set(hx, 2 * e, hz).normalize();
  return out;
}

// scratch vectors
const _v = new V3(), _w = new V3(), _r = new V3(), _f = new V3(), _s = new V3(), _n = new V3(), _p = new V3();
const _q = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _tmpTyre = { fx: 0, fy: 0, s: 0, mu: 0 };

// How much a surface's texture buzzes through the tyres at speed (by surface id: grass, dirt, gravel, rock, mud, sand,
// snow, road, river bed, ice).
const TEXTURE = [0.25, 0.3, 0.65, 0.9, 0.2, 0.2, 0.12, 0.08, 0.55, 0.05];
const _hn = new V3(), _hl = new V3(), _at = new V3();

export class Vehicle {
  constructor(spec) {
    this.spec = spec;
    this.pos = new V3();
    this.quat = new Quat();
    this.vel = new V3();
    this.angVel = new V3();
    this.right = new V3(); this.left = new V3(); this.up = new V3(); this.fwd = new V3();
    this.force = new V3(); this.torque = new V3();
    this.acc = new V3(); this.angAcc = new V3();
    this.time = 0;

    const tyre = spec.tyre;
    this.mass = spec.mass;
    this.unsprung = spec.axles.reduce((s, a) => s + a.mass, 0);
    this.sprung = this.mass - this.unsprung;
    const m = this.mass;
    // body-frame inertia (x = left: pitch, y = up: yaw, z = forward: roll): from the build (Upgrades.js), or a box
    if (spec.inertia) this.I = new V3(spec.inertia[0], spec.inertia[1], spec.inertia[2]);
    else {
      const [W, H, L] = spec.inertiaBox;
      this.I = new V3(m / 12 * (H * H + L * L), m / 12 * (L * L + W * W) * 1.05, m / 12 * (W * W + H * H) * 0.95);
    }
    this.invI = new V3(1 / this.I.x, 1 / this.I.y, 1 / this.I.z);
    this.cg = new V3(0, spec.cgHeight, spec.cgZ || 0);            // design frame -> CG frame offset
    // the sideways pull (in g) that would lift its inside wheels on level ground: half its track over its CG height
    this.tipG = Math.min(...spec.axles.map((a) => a.track)) / 2 / spec.cgHeight;

    // axles (positions in the CG frame)
    const rStatic = tyre.radius - (m * GRAVITY / 4) / tyre.stiffness;
    const zMid = spec.axles.reduce((s, a) => s + a.z, 0) / spec.axles.length;
    this.axles = spec.axles.map((a) => {
      const zc = a.z - this.cg.z;
      const half = a.track / 2;
      const yStatic = rStatic - this.cg.y;                         // hub height at static ride, CG frame
      const yDroop = yStatic - a.sag;                              // hub at full droop
      const T = a.track, s = a.springTrack, ifs = !!a.ifs;
      const ax = {
        spec: a, zc, half, T, yDroop, ifs,
        // spring deflection = ka * zNear + kb * zFar (a beam: the far wheel's travel tilts it; independent: its own)
        ka: ifs ? 1 : 0.5 + s / (2 * T), kb: ifs ? 0 : 0.5 - s / (2 * T),
        zL: a.sag, zR: a.sag, vL: 0, vR: 0,
        pre: 0, mountY: yDroop + a.travel + 0.12,
        // mass matrix of the beam (heave + roll), and its inverse
        M11: 0, M12: 0, iM11: 0, iM12: 0, iM22: 0,
      };
      const ma = a.mass, Ia = a.mass * half * half * 0.8;          // roll inertia of the beam, wheels at the ends
      // (independent: each wheel, its knuckle and half the arms move alone)
      const m11 = ifs ? ma / 2 : ma / 4 + Ia / (T * T), m12 = ifs ? 0 : ma / 4 - Ia / (T * T);
      ax.M11 = m11; ax.M12 = m12;
      const det = m11 * m11 - m12 * m12;
      ax.iM11 = m11 / det; ax.iM12 = -m12 / det;
      // what hangs below the beam: the diff housing (its bottom, and its rounded front and back) and the spring
      // plates under the leaf springs; x across (+ left), drop below the axle centre, dz along
      // (portal axles carry the tube and the diff above the hubs: little hangs below the wheel centres)
      const dd = a.diffDrop ?? 0.16, dxd = a.diffX || 0, sp = s / 2, pd = a.plateDrop ?? 0.085;
      // (independent: the diff sits up on the frame, and the lower arms' outer ends hang just inboard of each wheel)
      ax.under = ifs ? [{ x: half - 0.24, drop: a.armDrop ?? 0.11, dz: 0 }, { x: -(half - 0.24), drop: a.armDrop ?? 0.11, dz: 0 }] : [
        { x: dxd, drop: dd, dz: 0 }, { x: dxd, drop: dd - 0.035, dz: 0.09 }, { x: dxd, drop: dd - 0.035, dz: -0.09 },
        { x: sp, drop: pd, dz: 0 }, { x: -sp, drop: pd, dz: 0 },
      ];
      return ax;
    });
    // spring preload so the truck sits at its design ride height: sprung weight shared by axle position
    const [fa, ra] = this.axles;
    const span = fa.zc - ra.zc;
    const shareF = (0 - ra.zc) / span;
    for (const ax of this.axles) {
      const share = ax === fa ? shareF : 1 - shareF;
      const perSpring = this.sprung * GRAVITY * share / 2;
      ax.pre = perSpring / ax.spec.rate - ax.spec.sag;
    }
    void zMid;

    // wheels: 0 FL, 1 FR, 2 RL, 3 RR
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const ax = this.axles[i < 2 ? 0 : 1];
      this.wheels.push({
        index: i, axle: ax, side: i % 2 === 0 ? 1 : -1,            // +1 left, -1 right
        omega: 0, angle: 0, steer: 0, dx: 0, dy: 0,
        inertia: tyre.inertia, torque: 0, damp: 0,
        contact: false, N: 0, pen: 0, slip: 0, slipSpeed: 0, spin: 0, surf: surfaceById(0), sink: 0, water: 0, nSoil: 0, penSoil: 0,
        cx: 0, cy: 0, cz: 0, nx: 0, ny: 1, nz: 0,                  // contact point and normal (world)
        hub: new V3(), vHub: new V3(), fx: 0, fy: 0, kappa: 0, tanA: 0, vx: 0, vy: 0,
        cxDamp: 0, cyDamp: 0, Fshape: 0, FyShape: 0, rr: 0,
      });
    }
    this.dt = new Drivetrain(spec.engine, spec.trans, spec.diffs);
    this.drivetrain = this.dt;

    // hull: collision boxes (CG frame) and contact points on them
    this.boxes = spec.hull.map((b) => ({ c: new V3(b.c[0], b.c[1] - this.cg.y, b.c[2] - this.cg.z), h: new V3(...b.h), pts: b.pts, thin: !!b.thin }));
    this.hullPoints = [];
    this.boxes.forEach((b) => {
      const { c, h } = b;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.hullPoints.push(new V3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z));
      // bottom of the body and belly: edge midpoints and centre (bumpers, sills, skid plates, the belly that gets
      // high-centred); top of the cab: the roof, for when it goes over
      const ys = b.pts === 'bottom' ? -1 : b.pts === 'top' ? 1 : 0;
      if (ys) for (const [sx, sz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) this.hullPoints.push(new V3(c.x + sx * h.x, c.y + ys * h.y, c.z + sz * h.z));
    });
    this.hullFriction = spec.hullFriction ?? 1;
    // spheres approximating the hull, for other trucks to collide with
    this.hullSpheres = [];
    for (const b of this.boxes) {
      if (b.thin) continue;
      const r = Math.min(b.h.x, b.h.y) * 1.02;
      const nx = Math.max(1, Math.round(b.h.x / r)), nz = Math.max(1, Math.round(b.h.z / r));
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        const x = b.c.x - b.h.x + b.h.x * (2 * i + 1) / nx, z = b.c.z - b.h.z + b.h.z * (2 * k + 1) / nz;
        this.hullSpheres.push({ c: new V3(x, b.c.y, z), r });
      }
    }

    this.winch = { attached: false, kind: null, target: null, anchor: new V3(), anchorLocal: new V3(), len: 0, tension: 0, motor: 0, maxLen: spec.winch.maxLen, fairlead: new V3(spec.winch.fairlead[0], spec.winch.fairlead[1] - this.cg.y, spec.winch.fairlead[2] - this.cg.z) };
    // air intake (CG frame); flooded: water got in and stopped the engine
    const ip = spec.intake || [0, 1, (spec.axles[0].z || 1) + 0.1];
    this.intake = new V3(ip[0], ip[1] - this.cg.y, ip[2] - this.cg.z);
    this.flooded = false;
    this.floodClear = 0;
    this.intakeWet = false;
    // tyre pressure (psi): the tyres the physics uses are the spec's at this pressure
    this.psi = -1;
    this.psiTarget = tyre.psiStock || 30;
    this.airSupply = false;        // at the station's air line (the game sets it)
    this.setPressure(this.psiTarget);
    this.hullContact = 0;          // strongest hull impact this frame (for sounds)
    this.hullPeak = 0;             // the hardest since the game last read it (and zeroed it)
    this.impact = 0;
    // what the driver feels (see feelStep): the steering wheel's kick (N m at the rim, + = pulls left), the shake of
    // the ground through the tyres (0..1+), the buzz of a rough surface, the judder of tyres spinning in mud, hard hits
    this.feel = { kick: 0, rough: 0, texture: 0, judder: 0, bump: 0 };
    // what breaks (physics/Damage.js); a flat tyre runs on the rim, a little over its radius
    this.damage = new Damage(spec);
    const rimR = ((spec.tyre.rim || (spec.tyre.size >= 37 ? 17 : 15)) * 0.0254) / 2 + 0.03;
    this.flatDrop = Math.max(0.05, spec.tyre.radius - rimR - 0.05);
    // axle shaft strength (Nm): the truck's own (Upgrades.js: chromoly shafts come with a locker)
    this.shaftStrength = spec.shafts || [6000, 7500];
    this.kickAngle = 0;            // the front wheels giving a little against the driver's grip (rad)
    this._kT = 0; this._kHP = 0; this._nLP = [0, 0, 0, 0];
    this.waterDepth = 0;
    this.reverseTimer = 0;
    this.trees = [];
    this.others = [];              // other trucks: [{ pos, quat, spheres:[{c,r}], vel }]
    this.winchForce = new V3();
    this.pulls = [];               // [{ local: V3 (CG frame), target: V3 (world), tension }] from other players' winches
    this.lastSafe = null;
    this.updateBasis();
  }

  updateBasis() {
    this.left.set(1, 0, 0).applyQuat(this.quat);
    this.right.copy(this.left).scale(-1);
    this.up.set(0, 1, 0).applyQuat(this.quat);
    this.fwd.set(0, 0, 1).applyQuat(this.quat);
  }

  /** World position of a CG-frame point. */
  toWorld(local, out) { return out.copy(local).applyQuat(this.quat).add(this.pos); }

  /** Velocity of the chassis at world point p. */
  pointVel(p, out) {
    _r.subVectors(p, this.pos);
    out.crossVectors(this.angVel, _r).add(this.vel);
    return out;
  }

  get speed() { return this.vel.dot(this.fwd); }

  /** Place the truck at rest on the ground at (x, z) facing yaw, tilted to the lie of the ground. */
  place(ground, x, z, yaw = 0) {
    // the ground's slope over the truck's footprint
    groundNormal(ground, x, z, _n, 1.2);
    _f.set(Math.sin(yaw), 0, Math.cos(yaw)).projectOnPlane(_n).normalize();
    _s.crossVectors(_n, _f);                                            // left
    this.quat.setFromBasis(_s, _n, _f);
    this.updateBasis();
    // lowest point of the wheels at static ride, over the highest ground under the truck
    let h = -Infinity;
    for (const ax of this.axles) for (const sx of [-1, 1]) {
      _p.set(sx * ax.half, ax.yDroop + ax.spec.sag - this.spec.tyre.radius, ax.zc).applyQuat(this.quat);
      h = Math.max(h, ground.height(x + _p.x, z + _p.z) - _p.y);
    }
    this.pos.set(x, h + 0.03, z);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.acc.set(0, 0, 0); this.angAcc.set(0, 0, 0);
    for (const ax of this.axles) { ax.zL = ax.zR = ax.spec.sag; ax.vL = ax.vR = 0; }
    for (const w of this.wheels) { w.omega = 0; w.dx = 0; w.dy = 0; }
    this.dt.wOut = 0;
    if (!this.dt.running && !this.damage?.seized) { this.dt.running = true; this.dt.crankT = 0; this.dt.wEngine = this.dt.electric ? 0 : this.dt.e.idleRpm * Math.PI / 30; }
    this.flooded = false; this.intakeWet = false;
    this.detachWinch();
    this.updateBasis();
  }

  /** Put the truck back on its wheels where it is (after a roll-over). */
  rightSideUp(ground) {
    const yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.place(ground, this.pos.x, this.pos.z, yaw);
  }

  hubLocal(w, out) {
    const ax = w.axle;
    const z = w.side > 0 ? ax.zL : ax.zR;
    return out.set(w.side * ax.half, ax.yDroop + z, ax.zc);
  }

  /** Tyre contact by rays around the bottom of the wheel (see the header). */
  contact(w, ground, heading, u) {
    const tyre = this.spec.tyre, r = tyre.radius - (this.damage.flat[w.index] ? this.flatDrop : 0);
    const C = w.hub;
    let best = -1, bestPen = -Infinity;
    const pens = this._pens || (this._pens = new Float64Array(RAY_ANGLES.length));
    // quick reject: hub well above the ground everywhere under the tyre
    const g0 = ground.height(C.x, C.z);
    if (C.y - r * 1.05 > g0 + 0.35 && C.y - r > ground.height(C.x + heading.x * r, C.z + heading.z * r) + 0.35
      && C.y - r > ground.height(C.x - heading.x * r, C.z - heading.z * r) + 0.35) { w.contact = false; return false; }
    for (let k = 0; k < RAY_ANGLES.length; k++) {
      const th = RAY_ANGLES[k], sn = Math.sin(th), cs = Math.cos(th);
      // outward radial direction: forward * sin - up * cos
      const dx = heading.x * sn - u.x * cs, dy = heading.y * sn - u.y * cs, dz = heading.z * sn - u.z * cs;
      // f(t) = height of the ray point above the ground
      const f = (t) => (C.y + dy * t) - ground.height(C.x + dx * t, C.z + dz * t);
      const fr = f(r);
      let pen;
      if (fr >= 0) pen = -fr * Math.max(0.2, -dy);                // tread clear of the ground (rough distance)
      else {
        const f0 = f(0);
        if (f0 <= 0) pen = r;                                      // hub below ground (deep in a step): cap
        else {
          // where the ray meets the ground: regula falsi (Illinois), exact for a locally flat ground
          let lo = 0, hi = r, flo = f0, fhi = fr, side = 0, t = r;
          for (let it = 0; it < 8; it++) {
            t = (lo * fhi - hi * flo) / (fhi - flo);
            const ft = f(t);
            if (Math.abs(ft) < 1e-5) break;
            if (ft > 0) { lo = t; flo = ft; if (side === 1) fhi *= 0.5; side = 1; } else { hi = t; fhi = ft; if (side === -1) flo *= 0.5; side = -1; }
          }
          pen = r - t;
        }
      }
      pens[k] = pen;
      if (pen > bestPen) { bestPen = pen; best = k; }
    }
    if (bestPen <= 0) { w.contact = false; return false; }
    // refine the angle with a parabola through the best ray and its neighbours
    let th = RAY_ANGLES[best], pen = bestPen;
    if (best > 0 && best < RAY_ANGLES.length - 1) {
      const p0 = pens[best - 1], p1 = pens[best], p2 = pens[best + 1];
      const den = p0 - 2 * p1 + p2;
      if (den < -1e-9) {
        const off = clamp(0.5 * (p0 - p2) / den, -0.5, 0.5);
        th += off * RAY_STEP;
        pen = p1 - 0.25 * (p0 - p2) * off;
      }
    }
    pen = Math.min(pen, r * 0.6);
    const sn = Math.sin(th), cs = Math.cos(th);
    _d.set(heading.x * sn - u.x * cs, heading.y * sn - u.y * cs, heading.z * sn - u.z * cs);   // radial out
    w.nx = -_d.x; w.ny = -_d.y; w.nz = -_d.z;
    const t = r - pen;
    w.cx = C.x + _d.x * t; w.cy = C.y + _d.y * t; w.cz = C.z + _d.z * t;
    w.pen = pen;
    w.contact = true;
    w.surf = ground.surfaceAt(w.cx, w.cz);
    return true;
  }

  /**
   * Advance one substep.
   *   ctrl:   { throttle, brake, steer (-1 left .. 1 right), handbrake }
   *   ground: see the header of world/Ground.js
   */
  step(ctrl = NO_CONTROLS, ground) {
    const dt = PHYS_DT, spec = this.spec, tyre = this.tyre, r = tyre.radius;
    this.time += dt;
    if (this.psi !== this.psiTarget) this.airStep(dt);
    this.updateBasis();
    const F = this.force.set(0, -this.sprung * GRAVITY, 0), T = this.torque.set(0, 0, 0);
    const u = this.up, left = this.left, fwd = this.fwd;
    // unsprung weight across the up axis is carried by the chassis (the axles only move along u)
    const gu = -GRAVITY * u.y;                                          // gravity . u
    F.x += this.unsprung * (0 - gu * u.x); F.y += this.unsprung * (-GRAVITY - gu * u.y); F.z += this.unsprung * (0 - gu * u.z);
    const speed = this.vel.dot(fwd);
    this.hullContact = 0;

    // ---------------------------------------------------------------- driver -> pedals, gear, steering
    const dtr = this.dt;
    let throttle = ctrl.throttle, brake = ctrl.brake;
    if (dtr.auto) {
      // one pedal per direction, as in most driving games: hold brake at a stop to back up
      if (dtr.gear > 0 && speed < 0.6 && ctrl.brake > 0.1 && ctrl.throttle < 0.05) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.3) { dtr.selectGear(-1, speed); this.reverseTimer = 0; }
      } else if (dtr.gear < 0 && speed > -0.6 && ctrl.throttle > 0.1 && ctrl.brake < 0.05) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.3) { dtr.selectGear(1, speed); this.reverseTimer = 0; }
      } else this.reverseTimer = 0;
      if (dtr.gear < 0) { throttle = ctrl.brake; brake = ctrl.throttle; }
      if (dtr.gear === 0) dtr.selectGear(1, speed);
    }
    if (ctrl.hold) brake = Math.max(brake, ctrl.hold);                 // brakes on without asking for reverse
    // the handbrake (Space) stops the truck and keeps it there: the brakes on at every wheel (and the parking brake on
    // the rear ones), the drive taken off: the clutch held down (an automatic in neutral), so the throttle revs the
    // engine freely, as you would on the spot or before a launch, and letting go puts the drive back in (an electric
    // truck's motors are its drive: its throttle goes)
    const hand = ctrl.handbrake || 0;
    let declutch = false;
    if (hand > 0) { brake = Math.max(brake, hand); if (dtr.direct || hand < 0.5) throttle *= 1 - hand; else declutch = true; }
    this.pedalThrottle = throttle; this.pedalBrake = brake;
    // how far each axle's tyres are into their grip sideways (1: at the slip angle that grips best on this ground), for
    // the traction and stability control
    const ap = this.spec.tyre.alphaPeak, side = this._side || (this._side = [0, 0]);
    for (let k = 0; k < 2; k++) {
      let sa = 0, n = 0;
      for (let j = 2 * k; j < 2 * k + 2; j++) {
        const w = this.wheels[j];
        if (w.contact && w.surf) { sa += Math.abs(Math.atan2(w.vy, Math.abs(w.vx) + 0.5)) / (ap * w.surf.slip); n++; }
      }
      side[k] = n ? sa / n : 0;
    }
    // how far its weight has gone over to the wheels on one side (1: the other side's wheels are off the ground)
    let ltr = 0;
    for (let k = 0; k < 4; k += 2) {
      const nl = this.wheels[k].contact ? this.wheels[k].N : 0, nr = this.wheels[k + 1].contact ? this.wheels[k + 1].N : 0;
      if (nl + nr > 1) ltr = Math.max(ltr, Math.abs(nl - nr) / (nl + nr));
    }
    this.ltr = ltr;
    // traction control (a modern truck's): when every driven wheel spins well past the ground, the engine is throttled
    // back until they bite again (generous off the road: some wheel speed clears mud and snow from the tread). An
    // electric truck's motors answer in milliseconds and have far more torque than the ground takes: theirs cuts
    // deeper and faster. (Wheelspin only: a truck sliding round a bend is the stability control's, below)
    if (this.spec.tc && throttle > 0) {
      let slip = Infinity, give = 1;
      for (const w of this.wheels) {
        if (!w.contact || !(w.index >= 2 || dtr.fourWD)) continue;
        slip = Math.min(slip, Math.abs(w.spin ?? 0));
        give = Math.max(give, w.surf?.slip ?? 1);
      }
      // it holds the wheels near the slip that grips best (a tyre spun well past it has little left for steering), more
      // of it on loose ground, where the peak comes at far more slip, less while the tyres are also holding the truck
      // round a bend (spinning at its best grip forward, a tyre has none left to turn with); an electric truck's
      // motors, answering in milliseconds, hold it tighter. (Airborne, no driven wheel on the ground: an electric
      // truck holds its motors back, or they would be at the limiter when it lands)
      const lat = Math.min(1, Math.max(side[1], dtr.fourWD ? side[0] : 0)), turning = Math.sqrt(Math.max(0.1, 1 - lat * lat));
      const ev = dtr.electric, allow = (ev ? 0.45 + 0.1 * Math.abs(speed) : 0.9 + 0.15 * Math.abs(speed)) * give * turning;
      if (ev) {
        // (the motors' controller holds the spin there: it takes power off at once as the wheels spin up past it, and
        // settles on what the ground takes, giving it back as they find grip, instead of pulsing)
        const e = slip === Infinity ? 1 : clamp((slip - allow) / allow, -1, 2);
        this.tcI = clamp((this.tcI ?? 1) - TC_KI * dt * Math.min(1, e), 0.06, 1);
        this.tcCut = clamp(this.tcI - TC_KP * Math.max(0, e), 0.06, 1);
      } else {
        const over = slip === Infinity ? -1 : slip - allow;
        this.tcCut = clamp((this.tcCut ?? 1) + (over > 0 ? -2.5 * dt * Math.min(1, over) : 1.2 * dt), 0.35, 1);
      }
      throttle *= this.tcCut;
    } else { this.tcCut = 1; this.tcI = 1; }

    const fa = this.axles[0];
    const maxLock = fa.spec.steer;
    // keys and thumbsticks get a steering assist that keeps full lock for slow work but limits the wheel angle at speed
    // to what the front tyres grip on this ground (and the slip angle they turn the truck with), and to well short of
    // the pull that would lift a tall truck's inside wheels; a real steering wheel gets the whole range
    const wb = fa.zc - this.axles[1].zc;
    let muF = 0, nF = 0;
    for (let k = 0; k < 2; k++) { const w = this.wheels[k]; if (w.contact && w.surf) { muF += gripOn(w.surf, this.spec.tyre); nF++; } }
    const ay = Math.min(AS_MU * (nF ? muF / nF : 0.7), AS_TIP * this.tipG) * GRAVITY;
    const turnIn = AS_SLIP * this.spec.tyre.alphaPeak * (this.wheels[0].surf?.slip ?? 1);
    const lock = ctrl.analogSteer ? maxLock : Math.min(maxLock, Math.atan(ay * wb / Math.max(1, speed * speed)) + turnIn);
    let target = -ctrl.steer * lock;                                    // + = left
    let rate = 2.6 * dt;
    // keys and thumbsticks: the turn eases in more gently the faster the truck goes (the whole lock in 0.2 s crawling,
    // half a second at speed: more and it answered the keys late at speed), and a yaw damper takes a little steering
    // off while the truck swings round faster than it has been (into a turn, or rocking on its springs), so it settles
    // into the turn instead of lurching and wobbling
    const yaw = this.angVel.dot(u);                                     // + = turning left
    this.yawLP = (this.yawLP ?? yaw) + (yaw - (this.yawLP ?? yaw)) * Math.min(1, dt / 0.45);
    if (!ctrl.analogSteer) {
      const fast = smoothstep(6, 16, Math.abs(speed)), faster = smoothstep(12, 26, Math.abs(speed));
      rate = Math.max(0.08, lock / (0.2 + 0.15 * fast + 0.15 * faster)) * dt;
      // (only a swing growing: never against the truck straightening up when the steering is let go)
      const ahead = yaw - this.yawLP;
      if (ahead * yaw > 0) target -= fast * clamp(STEER_DAMP * (1 + 2 * faster) * ahead, -0.45 * lock, 0.45 * lock);
      // at speed, the wheels turn no further into a bend than the front tyres grip: past the slip angle that grips
      // best they only scrub and the nose ploughs on wide, so they are held there, and let back a little if the
      // front has gone well past it
      const at = this.steerAngle || 0;
      if (fast > 0 && side[0] > 0.95 && target * at > 0 && Math.abs(target) > Math.abs(at)) {
        const hold = Math.max(0, Math.abs(at) - Math.max(0, side[0] - 1.1) * 0.05);
        target = Math.sign(at) * (Math.abs(target) + (hold - Math.abs(target)) * fast);
      }
      // and less far in once the truck's weight has gone well over onto its outside wheels (as a modern truck's roll
      // stability control would), the more so the nearer the inside ones are to lifting: the lean smoothed and the
      // lock given back slowly, so the truck settles into a fast bend instead of pulsing in and out of it
      this.ltrF = (this.ltrF ?? ltr) + (ltr - (this.ltrF ?? ltr)) * Math.min(1, dt / 0.15);
      const roll = this.ltrF > LTR_HOLD && Math.abs(speed * yaw) > 0.25 * GRAVITY ? clamp(1 - (this.ltrF - LTR_HOLD) * 3, 0.45, 1) : 1;
      this.rollGov = (this.rollGov ?? 1) + clamp(roll - (this.rollGov ?? 1), -5 * dt, 0.7 * dt);
      if (target * at >= 0) target *= 1 - fast * (1 - this.rollGov);
    }
    this.steerAngle = (this.steerAngle || 0) + clamp(target - (this.steerAngle || 0), -rate, rate);
    // Ackermann: the inner wheel turns tighter
    const L = fa.zc - this.axles[1].zc;
    let dl = this.steerAngle, dr = this.steerAngle;
    if (Math.abs(this.steerAngle) > 1e-4) {
      const R = L / Math.tan(this.steerAngle);                         // + = turning left, centre to the left
      dl = Math.atan(L / (R - fa.half));
      dr = Math.atan(L / (R + fa.half));
    }
    const toe = this.damage.toe;
    this.wheels[0].steer = dl + this.kickAngle + toe; this.wheels[1].steer = dr + this.kickAngle + toe; this.wheels[2].steer = 0; this.wheels[3].steer = 0;
    // stability (a modern truck's ESC, and the driving assists): under power, the power comes off as soon as either end
    // slides past what its tyres hold (the nose ploughing on wide, or the tail stepping out and swinging round), and
    // is given back as they grip again: floored round a bend, the truck holds the line its tyres can hold instead of
    // ploughing wide or spinning
    if ((this.spec.tc || !ctrl.analogSteer) && throttle > 0 && speed > 3) {
      // (the tail sooner: the rear tyres nearing the slip angle that grips best, the nose past it)
      let over = Math.max((side[0] - 1.15) / 0.4, (side[1] - 0.9) / 0.3, 0);
      // (the tail swinging round: turning much faster than the wheels point)
      if (Math.abs(this.steerAngle) > 0.02 || Math.abs(yaw) > 0.3) {
        const want = Math.abs(speed * Math.tan(this.steerAngle)) / L;
        if (Math.abs(yaw) > want * 1.35 + 0.15) over = Math.max(over, 1);
      }
      // (as much off as it is past: a little slide takes a little power off, smoothly, instead of all of it in pulses)
      const aim = clamp(1 - ESC_K * over, 0.15, 1), cut = this.escCut ?? 1;
      this.escCut = cut + (aim - cut) * Math.min(1, (aim < cut ? ESC_OFF : ESC_ON) * dt);
    } else this.escCut = Math.min(1, (this.escCut ?? 1) + 1.5 * dt);
    throttle *= this.escCut;

    // ---------------------------------------------------------------- tyres: contact, load, slip
    const qx = this.quat;
    for (const w of this.wheels) {
      this.hubLocal(w, _p);
      this.toWorld(_p, w.hub);
      this.pointVel(w.hub, w.vHub);
      const zDot = w.side > 0 ? w.axle.vL : w.axle.vR;
      w.vHub.addScaled(u, zDot);
      // the wheel stands square to its beam axle, which tilts against the chassis as it articulates
      const ax = w.axle, tilt = ax.ifs ? 0 : ax.zL - ax.zR, il = 1 / Math.sqrt(ax.T * ax.T + tilt * tilt);
      _w.set(u.x * ax.T - left.x * tilt, u.y * ax.T - left.y * tilt, u.z * ax.T - left.z * tilt).scale(il);
      w.upX = _w.x; w.upY = _w.y; w.upZ = _w.z;
      // heading of the wheel (steered), in the wheel's plane
      const sn = Math.sin(w.steer), cs = Math.cos(w.steer);
      _f.set(sn, 0, cs).applyQuat(qx).projectOnPlane(_w).normalize();
      w.headX = _f.x; w.headY = _f.y; w.headZ = _f.z;
      w.water = ground.water ? Math.max(0, ground.water(w.hub.x, w.hub.z) - (w.hub.y - r)) : 0;
      if (!this.contact(w, ground, _f, _w)) {
        w.N = 0; w.fx = 0; w.fy = 0; w.slip = 0; w.slipSpeed = 0; w.spin = 0; w.sink = 0;
        w.nSoil *= 1 - Math.min(1, dt / SOIL_TAU); w.penSoil *= 1 - Math.min(1, dt / SOIL_TAU);
        // free tyre: the bristles relax as the tread leaves the ground
        w.dx *= 0.9; w.dy *= 0.9;
        w.torque = -0.6 * Math.tanh(w.omega);                          // bearing drag
        w.damp = 0;
        continue;
      }
      _n.set(w.nx, w.ny, w.nz);
      // contact frame: forward along the heading in the contact plane, lateral = n x f (left)
      _f.projectOnPlane(_n).normalize();
      _s.crossVectors(_n, _f);
      w.fX = _f.x; w.fY = _f.y; w.fZ = _f.z; w.sX = _s.x; w.sY = _s.y; w.sZ = _s.z;
      // velocity of the contact point (chassis + axle travel)
      _p.set(w.cx, w.cy, w.cz);
      this.pointVel(_p, _v).addScaled(u, zDot);
      const vx = _v.dot(_f), vy = _v.dot(_s);
      const vn = -_v.dot(_n);                                          // compression rate
      w.vx = vx; w.vy = vy;
      const flat = this.damage.flat[w.index], rw = flat ? r - this.flatDrop : r;
      let N = tyre.stiffness * (flat ? 0.35 : 1) * w.pen + tyre.damping * vn;
      // a front tyre slammed into a rock face (the contact normal tipped back against the heading) bends the tie rod;
      // soft ground gives way instead (a tyre ploughing into mud or sand meets its own rut's front wall)
      if (w.index < 2 && vn > 4.5 && !w.surf.sink && w.nx * w.headX + w.ny * w.headY + w.nz * w.headZ < -0.6) this.damage.steeringHit(w.side, vn);
      if (N < 0) N = 0;
      w.N = N;
      // bristle deflections (implicit relaxation, stable at any speed)
      const avx = Math.abs(vx);
      w.dx = (w.dx + (w.omega * rw - vx) * dt) / (1 + avx * dt / tyre.relaxX);
      w.dy = (w.dy + vy * dt) / (1 + avx * dt / tyre.relaxY);
      // keep the deflection within a few times the peak slip (the force is saturated there anyway); coming to rest no
      // more than the peak's own (a tyre slid to a stop doesn't spring the truck back a hand's width)
      const surf = w.surf, still = Math.max(avx, Math.abs(w.omega * rw)), room = still < 1 ? 1 + 5 * still : 6;
      const dxMax = tyre.kappaPeak * surf.slip * tyre.relaxX * room, dyMax = tyre.alphaPeak * surf.slip * tyre.relaxY * room;
      w.dx = clamp(w.dx, -dxMax, dxMax); w.dy = clamp(w.dy, -dyMax, dyMax);
      const kappa = w.dx / tyre.relaxX, tanA = w.dy / tyre.relaxY;
      w.kappa = kappa; w.tanA = tanA;
      tyreForce(_tmpTyre, N, kappa, tanA, surf, tyre);
      w.Fshape = _tmpTyre.fx; w.FyShape = _tmpTyre.fy; w.slip = _tmpTyre.s; w.mu = _tmpTyre.mu;
      if (flat) { w.Fshape *= 0.55; w.FyShape *= 0.55; w.mu *= 0.55; }
      // low-speed damping of the bristle springs (stops a parked truck from rocking on its tyres)
      const adh = clamp(1 - _tmpTyre.s, 0, 1);
      const low = 1 - smoothstep(1.5, 5, avx);
      const mq = this.mass / 4;
      w.cxDamp = 2 * 0.55 * Math.sqrt(slipStiffness(N, surf, tyre) / tyre.relaxX * mq) * adh * low;
      w.cyDamp = 2 * 0.6 * Math.sqrt(corneringStiffness(N, surf, tyre) / tyre.relaxY * mq) * adh * low;
      // rolling resistance (more in soft ground and in water; mud tyres and soft tyres roll harder on firm ground)
      const crr = surf.rr * (surf.sink > 0 ? tyre.rrMul || 1 : tyre.rrFirm || 1) + surf.drag * w.sink + (surf.visc || 0) * avx + (w.water > 0.15 ? 0.04 : 0) + (flat ? 0.09 : 0);
      w.rr = crr * N;
      w.torque = -rw * w.Fshape + rw * w.cxDamp * vx - crr * N * rw * Math.tanh(w.omega * 2) - 0.6 * Math.tanh(w.omega);
      w.damp = w.cxDamp * rw * rw;
    }

    // ---------------------------------------------------------------- drivetrain (wheel spin)
    const bt = this._bt || (this._bt = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      const ax = this.axles[i < 2 ? 0 : 1].spec;
      let b = brake * ax.brake;
      // load-sensing proportioning valve: the rear brakes get no more pressure than the (lightly loaded) rear tyres
      // can use, so a hard stop doesn't lock the rear and spin the truck
      if (i >= 2) {
        const w = this.wheels[i];
        b = Math.min(b, Math.max(250, 1.15 * (w.mu || 0.8) * (w.N || 0) * r));
      }
      bt[i] = b + hand * (ax.handbrake || 0);
    }
    // brake locking (the Thar's front diff; a modern truck's traction control on both axles): under power, a wheel
    // spinning away from the other on its axle is braked, so the open diff sends the torque to the wheel with grip.
    // What a turn asks of the two is left alone (the outer wheel rolls further: turning left, the right one), and the
    // brake rises with the spin, up to about what the tyre on the ground can push with
    this.bldOn = false;
    if (throttle > 0.15) {
      for (const [k, on] of [[0, this.spec.bld?.front && dtr.fourWD], [2, this.spec.bld?.rear]]) {
        if (!on) continue;
        // (+: the left wheel spinning away from the right, in the way the truck is driving)
        const wl = this.wheels[k], wr = this.wheels[k + 1];
        const dw = (dtr.gear < 0 ? -1 : 1) * (wl.omega - wr.omega + yaw * this.axles[k >> 1].T / r), a = Math.abs(dw);
        if (a > BLD_A) {
          const cap = Math.max(1400, 0.8 * Math.max((wl.mu || 0.8) * (wl.N || 0), (wr.mu || 0.8) * (wr.N || 0)) * r);
          bt[dw > 0 ? k : k + 1] += Math.min(cap, (a - BLD_A) * BLD_K); this.bldOn = true;
        }
      }
    }
    this._dtIn = this._dtIn || { throttle: 0, brakeTorque: bt };
    this._dtIn.throttle = throttle;
    this._dtIn.declutch = declutch;
    const D = this.damage;
    // (cosmetic damage: water in the intake doesn't stop the engine, it chokes it: it coughs and makes a third; an
    // electric truck in over its sealing: its battery management cuts the power)
    dtr.powerMul = D.power * (this.intakeWet && (D.k.runs || dtr.electric) ? 0.35 : 1);
    dtr.seized = D.seized;
    dtr.broken = D.shafts;
    dtr.step(dt, this._dtIn, this.wheels);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.spinAgo = w.slipSpeed > 2 ? 0 : (w.spinAgo ?? 9) + dt;
      D.shaftTorque(i, dtr.wheelT[i], this.shaftStrength[i < 2 ? 0 : 1], w.spinAgo, dt);
    }

    // ---------------------------------------------------------------- tyre forces on chassis and axles
    for (const ax of this.axles) { ax.QL = 0; ax.QR = 0; ax.rollM = 0; }
    // torque twist: a propshaft's torque rolls its axle housing against the chassis, lifting the right-hand wheel
    // under power (the classic one-wheel peel with an open diff), and the engine's reaction rolls the body the other
    // way (left side up). Engine rotation clockwise seen from the front. (An electric truck has neither: its motors sit
    // across the truck, turning the half-shafts)
    if (!dtr.electric) {
      const [axF, axR] = this.axles, tr = dtr.propRear, tf = dtr.propFront;
      axR.QL -= tr / axR.T; axR.QR += tr / axR.T;
      axF.QL -= tf / axF.T; axF.QR += tf / axF.T;
      T.x += fwd.x * (tr + tf); T.y += fwd.y * (tr + tf); T.z += fwd.z * (tr + tf);
    }
    for (const w of this.wheels) {
      w.angle += w.omega * dt;
      if (w.angle > 1e4 || w.angle < -1e4) w.angle %= Math.PI * 2;
      w.Flong = 0; w.Flat = 0;
      if (!w.contact || w.N <= 0) continue;
      const surf = w.surf;
      const rw = this.damage.flat[w.index] ? r - this.flatDrop : r;
      let fx = w.Fshape + w.cxDamp * (w.omega * rw - w.vx);
      let fy = w.FyShape - w.cyDamp * w.vy;
      // the total can't exceed what the friction circle allows
      const lim = w.mu * w.N * 1.02, mag = Math.hypot(fx, fy);
      if (mag > lim) { fx *= lim / mag; fy *= lim / mag; }
      w.fx = fx; w.fy = fy;
      const slipV = Math.hypot(w.omega * rw - w.vx, w.vy);
      w.slipSpeed = slipV;
      w.spin = w.omega * rw - w.vx;                                      // wheelspin alone (+ = turning faster than it rolls)
      // world force: normal + friction
      _a.set(w.nx * w.N + w.fX * fx + w.sX * fy, w.ny * w.N + w.fY * fx + w.sY * fy, w.nz * w.N + w.fZ * fx + w.sZ * fy);
      // along the wheel's heading (a ledge pushes back through the tilted normal) and across it (left), for the steering
      w.Flong = _a.x * w.headX + _a.y * w.headY + _a.z * w.headZ;
      w.Flat = _a.x * (w.upY * w.headZ - w.upZ * w.headY) + _a.y * (w.upZ * w.headX - w.upX * w.headZ) + _a.z * (w.upX * w.headY - w.upY * w.headX);
      this.damage.tyreLoad(w.index, w.N, w.Flat, w.vx, surf, tyre, this.psi, surf.id === 3, this.time);
      const along = _a.dot(u);
      const ax = w.axle;
      if (w.side > 0) ax.QL += along; else ax.QR += along;
      // across the up axis: lateral part at the hub (roll centre of a beam axle), the rest at the contact patch
      _b.copy(_a).addScaled(u, -along);
      const lat = _b.dot(left);
      _c.copy(left).scale(lat);                                       // lateral (chassis frame)
      _b.sub(_c);                                                     // longitudinal
      _p.set(w.cx, w.cy, w.cz);
      if (ax.ifs) {
        // double wishbones: the lateral force reaches the body through the arms at the roll centre, just above the
        // ground (no beam to roll)
        _q.copy(_p).addScaled(u, 0.12);
        this.applyForce(_c, _q);
      } else {
        this.applyForce(_c, w.hub);
        // the lateral force acts below the hub: its moment rolls the axle (load moves to the outer tyre)
        _q.subVectors(w.hub, _p);
        ax.rollM += lat * _q.dot(u);
      }
      this.applyForce(_b, _p);

      // soft ground: press it down, dig while spinning. The footprint: the chord the tyre's deflection cuts, made
      // longer and wider by a soft carcass (aired down). The soil takes its set under the load and deflection averaged
      // over SOIL_TAU: a jolt doesn't punch a hole that the tyre then drops into and hits again
      const ks = Math.min(1, dt / SOIL_TAU);
      w.nSoil += (w.N - w.nSoil) * ks; w.penSoil += (w.pen - w.penSoil) * ks;
      if (surf.sink > 0 && ground.deform) {
        const contactLen = Math.max(0.22, 2 * Math.sqrt(Math.max(0, 2 * r * Math.min(w.penSoil, r * 0.5)))) * tyre.footL;
        const pKPa = w.nSoil / (tyre.footW * contactLen) / 1000;
        const zEq = Math.min(surf.maxSink, Math.pow(pKPa / surf.sink, 1 / surf.n));
        const dig = surf.dig * Math.max(0, slipV - 0.6) * dt;
        w.sink = ground.deform(w.cx, w.cz, w.fX, w.fZ, tyre.footW * 0.5, contactLen * 0.5, zEq, dig);
      } else w.sink = 0;
    }
    this.axleContacts(ground);
    this.feelStep(dt, speed);
    this.damage.update(dt, dtr, dtr.running ? dtr.throttle * Math.min(1, dtr.rpm / dtr.e.redline) : 0, u.y, this.waterDepth);

    // ---------------------------------------------------------------- springs, dampers, limits
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], a = ax.spec;
      for (let side = 0; side < 2; side++) {
        const near = side === 0 ? ax.zL : ax.zR, far = side === 0 ? ax.zR : ax.zL;
        const vNear = side === 0 ? ax.vL : ax.vR, vFar = side === 0 ? ax.vR : ax.vL;
        const x = ax.ka * near + ax.kb * far, xv = ax.ka * vNear + ax.kb * vFar;
        // a broken main leaf carries about half, a blown damper damps a quarter
        const corner = ai * 2 + side, leaf = 1 - 0.5 * this.damage.springs[corner], damp = 1 - 0.75 * this.damage.shocks[corner];
        let Fs = Math.max(0, a.rate * leaf * (x + ax.pre));
        Fs += (xv > 0 ? a.bump * xv : a.rebound * xv) * damp;
        // generalized forces on the wheel travels, reaction on the chassis at the spring seat
        if (side === 0) { ax.QL -= ax.ka * Fs; ax.QR -= ax.kb * Fs; } else { ax.QR -= ax.ka * Fs; ax.QL -= ax.kb * Fs; }
        const sx = (side === 0 ? 1 : -1) * a.springTrack / 2;
        _p.set(sx, ax.mountY, ax.zc);
        this.toWorld(_p, _q);
        _a.copy(u).scale(Fs);
        this.applyForce(_a, _q);
        // limit strap (droop) and bump stop (compression), at the wheel
        const z = near, zv = vNear;
        let Fl = 0;
        if (z < 0) Fl = 3e5 * -z - 6000 * Math.min(0, zv);
        const bsStart = (a.bumpTravel ?? a.travel) - 0.05;
        if (z > bsStart) { const e = z - bsStart; Fl = -(4e5 * e + 2.5e7 * e * e * e) - 9000 * Math.max(0, zv); }
        this.damage.suspension(corner, Fs + Math.max(0, -Fl));
        if (Fl !== 0) {
          if (side === 0) ax.QL += Fl; else ax.QR += Fl;
          _p.set(sx * 2 * ax.half / a.springTrack, ax.mountY, ax.zc);
          this.toWorld(_p, _q);
          _a.copy(u).scale(-Fl);
          this.applyForce(_a, _q);
          this.hullContact = Math.max(this.hullContact, Fl < 0 ? -Fl / 4e4 : 0);
        }
      }
      // geometric roll moment of the beam
      ax.QL += ax.rollM / ax.T; ax.QR -= ax.rollM / ax.T;
      // anti-roll bar (unless disconnected for articulation): resists the axle rolling against the chassis
      if (a.swayBar && !this.swayDisconnected) {
        const Fb = a.swayBar * (ax.zL - ax.zR) / (ax.T * ax.T);
        ax.QL -= Fb; ax.QR += Fb;
        _p.set(ax.half, ax.mountY, ax.zc); this.toWorld(_p, _q); _a.copy(u).scale(Fb); this.applyForce(_a, _q);
        _p.set(-ax.half, ax.mountY, ax.zc); this.toWorld(_p, _q); _a.copy(u).scale(-Fb); this.applyForce(_a, _q);
      }
    }

    // ---------------------------------------------------------------- hull, trees, others, winch, water, air
    this.hullContacts(ground);
    if (ground.treesNear) this.treeContacts(ground);
    if (this.others.length) this.otherContacts();
    if (this.hullContact > this.hullPeak) this.hullPeak = this.hullContact;   // (the frame's hardest, for the game)
    this.winchStep(dt, ground);
    // other players' winch lines hooked to this truck: pulled toward their fairlead. The rope's pull is worked out here,
    // from where this truck is now and the rope's length their winch reports (the tension their side works out comes
    // from where they saw this truck a moment ago: taking it would yank the truck on and let it run on past the slack)
    for (const pl of this.pulls) {
      this.toWorld(pl.local, _p);
      _d.subVectors(pl.target, _p);
      const dist = _d.length();
      pl.felt = 0;
      if (dist < 0.3) continue;
      _d.scale(1 / dist);
      let ten;
      if (pl.rope && pl.len > 0) {
        const r = pl.rope, stretch = dist - pl.len;
        this.pointVel(_p, _v);
        const stretchRate = -(_v.dot(_d) - (pl.targetVel ? pl.targetVel.x * _d.x + pl.targetVel.y * _d.y + pl.targetVel.z * _d.z : 0));
        ten = stretch > 0 ? clamp(r.stiffness * stretch + r.damping * stretchRate, 0, r.breakLoad) : 0;
      } else ten = Math.min(pl.tension || 0, 120000);
      pl.felt = ten;
      if (!(ten > 0)) continue;
      _a.copy(_d).scale(ten);
      this.applyForce(_a, _p);
    }
    this.waterStep(ground);
    this.intakeStep(ground, dt);
    const v2 = this.vel.lengthSq();
    if (v2 > 0.01) {
      const k = -0.5 * RHO_AIR * spec.drag.cd * spec.drag.area * Math.sqrt(v2);
      F.addScaled(this.vel, k);
    }

    // ---------------------------------------------------------------- integrate the chassis
    // translational mass: whole truck across the up axis, sprung mass along it
    const Fu = F.dot(u);
    const beta = this.unsprung / (this.mass * this.sprung);
    this.acc.copy(F).scale(1 / this.mass).addScaled(u, Fu * beta);
    // angular: body frame
    _w.copy(this.angVel).applyQuatInv(qx);
    _a.copy(T).applyQuatInv(qx);
    const I = this.I;
    // tau - w x (I w)
    const Iwx = I.x * _w.x, Iwy = I.y * _w.y, Iwz = I.z * _w.z;
    _a.x -= _w.y * Iwz - _w.z * Iwy; _a.y -= _w.z * Iwx - _w.x * Iwz; _a.z -= _w.x * Iwy - _w.y * Iwx;
    _a.x *= this.invI.x; _a.y *= this.invI.y; _a.z *= this.invI.z;
    this.angAcc.copy(_a).applyQuat(qx);
    this.vel.addScaled(this.acc, dt);
    this.angVel.addScaled(this.angAcc, dt);
    // a little angular damping (air, bushings)
    this.angVel.scale(1 - 0.02 * dt);
    const wl = this.angVel.length();
    if (wl > 25) this.angVel.scale(25 / wl);

    // ---------------------------------------------------------------- integrate the axles
    for (const ax of this.axles) {
      // mount accelerations along u at the two wheels (chassis acceleration, as a pseudo-force)
      let aL = 0, aR = 0;
      for (let side = 0; side < 2; side++) {
        _p.set((side === 0 ? 1 : -1) * ax.half, ax.yDroop + (side === 0 ? ax.zL : ax.zR), ax.zc).applyQuat(qx);
        // a + alpha x r + w x (w x r)
        _c.crossVectors(this.angAcc, _p);
        _d.crossVectors(this.angVel, _p); _q.crossVectors(this.angVel, _d);
        const am = (this.acc.x + _c.x + _q.x) * u.x + (this.acc.y + _c.y + _q.y) * u.y + (this.acc.z + _c.z + _q.z) * u.z;
        if (side === 0) aL = am; else aR = am;
      }
      const m = ax.spec.mass, M11 = ax.M11, M12 = ax.M12;
      // generalized gravity and pseudo-forces
      const gL = (m / 2) * gu - (M11 * aL + M12 * aR);
      const gR = (m / 2) * gu - (M12 * aL + M11 * aR);
      const QL = ax.QL + gL, QR = ax.QR + gR;
      const accL = ax.iM11 * QL + ax.iM12 * QR, accR = ax.iM12 * QL + ax.iM11 * QR;
      ax.vL += accL * dt; ax.vR += accR * dt;
      ax.zL += ax.vL * dt; ax.zR += ax.vR * dt;
      // hard safety limits
      const lo = -0.06, hi = (ax.spec.bumpTravel ?? ax.spec.travel) + 0.04;
      if (ax.zL < lo) { ax.zL = lo; if (ax.vL < 0) ax.vL = 0; } else if (ax.zL > hi) { ax.zL = hi; if (ax.vL > 0) ax.vL = 0; }
      if (ax.zR < lo) { ax.zR = lo; if (ax.vR < 0) ax.vR = 0; } else if (ax.zR > hi) { ax.zR = hi; if (ax.vR > 0) ax.vR = 0; }
    }

    this.pos.addScaled(this.vel, dt);
    this.quat.integrate(this.angVel, dt);
  }

  /** Apply a world force f at world point p (accumulates force and torque about the CG). */
  applyForce(f, p) {
    this.force.add(f);
    const rx = p.x - this.pos.x, ry = p.y - this.pos.y, rz = p.z - this.pos.z;
    this.torque.x += ry * f.z - rz * f.y;
    this.torque.y += rz * f.x - rx * f.z;
    this.torque.z += rx * f.y - ry * f.x;
  }

  /** Penalty contact at world point p with normal n (pointing out of the obstacle) and depth pen. */
  penalty(p, n, pen, k, c, mu, level = false, at = p) {
    this.pointVel(p, _v);
    const vn = _v.dot(n);
    this.lastClose = -vn;                                              // closing speed (for damage)
    let Fn = k * pen - c * vn;
    if (Fn <= 0) return 0;
    Fn = Math.min(Fn, k * 0.5);                                         // cap a deep overlap
    _a.copy(n).scale(Fn);
    // friction (regularised Coulomb); against an upright trunk only along the ground (it rubs past, it can't be climbed)
    _b.copy(_v).addScaled(n, -vn);
    if (level) _b.y = 0;
    const vt = _b.length();
    if (vt > 1e-4) {
      const Ft = Math.min(mu * Fn, 4000 * vt);
      _a.addScaled(_b, -Ft / vt);
    }
    this.applyForce(_a, at);
    return Fn;
  }

  hullContacts(ground) {
    const kh = 4.5e5, ch = 2.4e4;
    for (let k = 0; k < this.hullPoints.length; k++) {
      const hp = this.hullPoints[k];
      this.toWorld(hp, _p);
      const h = ground.height(_p.x, _p.z);
      if (_p.y >= h) continue;
      groundNormal(ground, _p.x, _p.z, _n);
      const pen = (h - _p.y) * _n.y;
      const surf = ground.surfaceAt(_p.x, _p.z);
      const Fn = this.penalty(_p, _n, pen, kh, ch, surf.hull * this.hullFriction);
      this.hullContact = Math.max(this.hullContact, Fn / 2e4);
      // soft ground (mud, sand, snow) gives under the body: it takes a far harder landing to dent or break anything
      const close = surf.maxSink > 0.15 ? this.lastClose * 0.4 : this.lastClose;
      if (close > 2) this.hitAt(hp, _n, close, k);
    }
  }

  /** Report a hit at hull point local (CG frame) pushed along world normal n to the damage model. */
  hitAt(local, n, close, key) {
    _hn.copy(n).applyQuatInv(this.quat);
    this.damage.hit(local, _hn, close, key, this.time);
  }

  /**
   * The diffs and spring plates against the ground. The force along the chassis' up axis goes into the beam's two
   * degrees of freedom (shared by where along the beam it acts) and reaches the chassis through the springs and bump
   * stops; the rest (the scrape, the shove of a ledge) goes to the chassis there.
   */
  axleContacts(ground) {
    const u = this.up, k = 3e5, c = 6000;
    for (const ax of this.axles) {
      for (const pt of ax.under) {
        const fl = 0.5 + pt.x / ax.T, fr = 0.5 - pt.x / ax.T;
        const yA = ax.yDroop + ax.zL * fl + ax.zR * fr;
        _p.set(pt.x, yA - pt.drop, ax.zc + pt.dz);
        this.toWorld(_p, _q);
        const h = ground.height(_q.x, _q.z);
        if (_q.y >= h) continue;
        groundNormal(ground, _q.x, _q.z, _n);
        const pen = Math.min((h - _q.y) * _n.y, 0.15);
        this.pointVel(_q, _v).addScaled(u, ax.vL * fl + ax.vR * fr);
        const vn = _v.dot(_n);
        let Fn = k * pen - c * vn;
        if (Fn <= 0) continue;
        _a.copy(_n).scale(Fn);
        _b.copy(_v).addScaled(_n, -vn);
        const vt = _b.length();
        if (vt > 1e-4) {
          const mu = ground.surfaceAt(_q.x, _q.z).hull * 1.1;
          _a.addScaled(_b, -Math.min(mu * Fn, 3000 * vt) / vt);
        }
        const along = _a.dot(u);
        ax.QL += along * fl; ax.QR += along * fr;
        _a.addScaled(u, -along);
        this.applyForce(_a, _q);
        this.hullContact = Math.max(this.hullContact, Fn / 2e4);
      }
    }
  }

  // ---------------------------------------------------------------- tyre pressure
  /** Tyres at a pressure (psi): the spec's tyre (at its stock pressure) made softer or firmer. */
  setPressure(psi) {
    const s = this.spec.tyre;
    psi = clamp(psi, s.minPsi || 14, (s.psiStock || 30) + 5);
    this.psiAir = psi;
    if (psi === this.psi) return;
    this.psi = psi;
    const f = clamp(psi / (s.psiStock || 30), 0.2, 1.2), d = 1 - f;
    const t = this.tyre = { ...s };
    t.stiffness = s.stiffness * (0.32 + 0.68 * f);             // the air carries most of the load
    t.alphaPeak = s.alphaPeak * (1 + 0.45 * d);                // a soft sidewall: vague steering, slow to respond
    t.relaxY = s.relaxY * (1 + 0.5 * d);
    t.kappaPeak = s.kappaPeak * (1 + 0.25 * d);
    t.footW = s.width * (1 + 0.25 * d);                        // footprint: wider and longer
    t.footL = 1 + 0.6 * d;
    t.rrFirm = (s.rrMul || 1) * (1 + 0.9 * d);                 // flexing carcass: drags on firm ground
    const grip = s.grip || SURFACES.map(() => 1);
    t.grip = grip.map((g, id) => g * (id === SURFACE.ROCK ? 1 + 0.16 * d : SURFACES[id].C <= 1.0001 ? 1 + 0.1 * d : 1));
  }

  /** Let air out (any time, nearly stopped) or pump it in (onboard compressor, or the station's air line). */
  airStep(dt) {
    const s = this.spec.tyre;
    this.psiTarget = clamp(this.psiTarget, s.minPsi || 14, (s.psiStock || 30) + 5);
    const slow = Math.abs(this.vel.dot(this.fwd)) < 2.5;
    let p = this.psiAir;
    if (this.psiTarget < p) { if (slow) p = Math.max(this.psiTarget, p - 1.6 * dt); } else if (s.compressor || this.airSupply) p = Math.min(this.psiTarget, p + (this.airSupply ? 4 : 1) * dt);
    else this.psiTarget = p;                                   // no air to put back in
    this.psiAir = p;
    if (Math.abs(p - this.psi) >= 0.05 || p === this.psiTarget) this.setPressure(p);
  }

  // ---------------------------------------------------------------- air intake
  /**
   * The engine breathes through the intake (the air cleaner under the bonnet, or a snorkel up the pillar). Water
   * there stops it; a bow wave raises the water at the front when driving in too fast. It starts again once the
   * intake has been out of the water for a few seconds. (With cosmetic damage it only chokes: see the power above.)
   */
  intakeStep(ground, dt) {
    let wet = false;
    if (ground.water && this.waterDepth > 0.05) {
      this.toWorld(this.intake, _p);
      const level = ground.water(_p.x, _p.z);
      if (level > -1e8) {
        // the bow wave: water piles up against the front, the higher the deeper and faster the water is entered (a
        // walking-pace wave is low and steady; a puddle at speed is spray, not enough water to drown an engine)
        const sp = Math.max(0, this.vel.dot(this.fwd)), depth = Math.max(0, level - ground.height(_p.x, _p.z));
        wet = level + Math.min(0.45, depth * Math.min(2, 0.06 * sp * sp)) > _p.y;
      }
    }
    this.intakeWet = wet;
    const dtr = this.dt;
    if (wet && dtr.running && !this.damage.k.runs && !dtr.electric) { this.damage.hydrolock(dtr.rpm); dtr.stall(); this.flooded = true; this.floodClear = 0; }
    if (this.flooded) {
      if (wet) this.floodClear = 0;
      else if ((this.floodClear += dt) > 2.5) { this.flooded = false; dtr.start(); }
    }
  }

  /** Closest point on a box (CG frame) to a world point: returns penetration depth for a sphere of radius rad. */
  sphereVsBoxes(center, rad, outP, outN, upright = false) {
    // into the chassis frame
    _q.subVectors(center, this.pos).applyQuatInv(this.quat);
    let best = 0;
    for (const b of this.boxes) {
      const lx = _q.x - b.c.x, ly = _q.y - b.c.y, lz = _q.z - b.c.z;
      const cx = clamp(lx, -b.h.x, b.h.x), cy = clamp(ly, -b.h.y, b.h.y), cz = clamp(lz, -b.h.z, b.h.z);
      let dx = lx - cx, dy = ly - cy, dz = lz - cz;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let pen, deep = false;
      if (d > 1e-6) { pen = rad - d; dx /= d; dy /= d; dz /= d; } else {
        deep = true;
        // centre inside the box: push out along the shallowest face
        // (a trunk, upright: out through a side or an end, never the top or the bottom)
        const ex = b.h.x - Math.abs(lx), ey = upright ? Infinity : b.h.y - Math.abs(ly), ez = b.h.z - Math.abs(lz);
        if (ex <= ey && ex <= ez) { dx = Math.sign(lx) || 1; dy = 0; dz = 0; pen = rad + ex; } else if (ey <= ez) { dx = 0; dy = Math.sign(ly) || 1; dz = 0; pen = rad + ey; } else { dx = 0; dy = 0; dz = Math.sign(lz) || 1; pen = rad + ez; }
      }
      if (pen > best) {
        best = pen;
        // contact point on the box surface and normal (from the box toward the sphere: the push on the sphere)
        outP.set(b.c.x + cx, b.c.y + cy, b.c.z + cz).applyQuat(this.quat).add(this.pos);
        outN.set(dx, dy, dz).applyQuat(this.quat);
        this.sphereDeep = deep;
      }
    }
    return best;
  }

  treeContacts(ground) {
    const trees = ground.treesNear(this.pos.x, this.pos.z, 6, this.trees);
    if (!this.treeNormals || this.treeNormals.size > 64) this.treeNormals = new Map();      // (each trunk's last push)
    if (!trees.length) return;
    const tyreR = this.spec.tyre.radius;
    // a trunk is stiff against the whole truck (as its crumple zones are): a heavy truck stops in about as short a
    // crush as a light one, rather than sinking a metre into the tree at speed (and being shoved out of it any which way)
    const kt = this.mass * 900, ct = this.mass * 24;
    for (const t of trees) {
      // the bending at its foot: each push times its height up the trunk (world/Breakables.js: does it give way)
      const top = t.top ?? Infinity, cap = t.cap ?? Infinity;
      let moment = 0;
      for (const hgt of [0.35, 0.9, 1.5, 2.1]) {
        if (hgt > top + 0.1 && hgt > 0.35) continue;                  // (a barrel, a crate: only as high as it stands)
        _c.set(t.x, t.y + Math.min(hgt, top), t.z);
        const pen = this.sphereVsBoxes(_c, t.r, _p, _n, true);
        if (pen > 0) {
          // normal points from the box to the trunk; the chassis is pushed the other way, level (the trunk stands
          // upright). Where the box meets it nearly flat-on (its top or bottom on the trunk), straight away from the
          // trunk instead: a near-vertical normal levelled would push hard in a direction that means nothing
          _n.scale(-1);
          _n.y = 0;
          if (Math.hypot(_n.x, _n.z) < 0.35) _n.set(_p.x - t.x, 0, _p.z - t.z);
          if (_n.lengthSq() < 1e-8) continue;
          _n.normalize();
          // a trunk right inside the body: out the way it came in (the nearest face flips as it goes deeper)
          const key = t.x * 7919 + t.z;
          if (this.sphereDeep && this.treeNormals.has(key)) _n.copy(this.treeNormals.get(key));
          else this.treeNormals.set(key, _n.clone());
          // (the damping comes in over the first few cm, so the first touch is not a jolt). It bears on the truck low,
          // toward the height of its middle: a trunk meets a truck at its bumpers, frame and sills (a cab narrows to
          // its roof), so a hit spins it round or stops it, and doesn't lever it over
          _at.copy(_p); _at.y = this.pos.y + (_p.y - this.pos.y) * 0.35;
          const Fn = this.penalty(_p, _n, pen, kt, ct * Math.min(1, pen / 0.03), 0.25, true, _at);
          moment += Fn * Math.min(hgt, top);
          this.impact = Math.max(this.impact, Fn / 3e4);
          if (this.lastClose > 2 && cap > 2e4) {
            _hl.copy(_p).sub(this.pos).applyQuatInv(this.quat);
            this.hitAt(_hl, _n, this.lastClose, `t${Math.round(t.x * 10)},${Math.round(t.z * 10)},${hgt}`);
          }
        }
      }
      // tyres against the trunk
      for (const w of this.wheels) {
        const dx = w.hub.x - t.x, dz = w.hub.z - t.z, d = Math.hypot(dx, dz);
        const pen = t.r + tyreR * 0.9 - d;
        if (pen > 0 && w.hub.y > t.y - 0.5 && w.hub.y < t.y + Math.max(Math.min(top, 3), 0.3) + tyreR) {
          _n.set(dx / d, 0, dz / d);
          _p.copy(w.hub).addScaled(_n, -tyreR * 0.9);
          const Fn = this.penalty(_p, _n, pen, kt * 0.6, ct * 0.6 * Math.min(1, pen / 0.03), 0.3, true);
          moment += Fn * Math.max(0.1, Math.min(w.hub.y - t.y, top));
          if (w.index < 2 && cap > 2e4) this.damage.steeringHit(w.side, this.lastClose);
        }
      }
      // too much for it: it goes (and stops pushing back from the next step)
      if (moment > 0 && cap < Infinity && ground.strike) ground.strike(t.i, moment, this.vel.x, this.vel.z);
    }
  }

  otherContacts() {
    for (const o of this.others) {
      if (!o.spheres) continue;
      const dx = o.pos.x - this.pos.x, dy = o.pos.y - this.pos.y, dz = o.pos.z - this.pos.z;
      if (dx * dx + dy * dy + dz * dz > 100) continue;
      for (const s of o.spheres) {
        _c.copy(s.c).applyQuat(o.quat).add(o.pos);
        const pen = this.sphereVsBoxes(_c, s.r, _p, _n);
        if (pen > 0) {
          _n.scale(-1);
          // relative velocity: the other truck moves too
          _v.copy(o.vel || _q.set(0, 0, 0));
          this.pointVel(_p, _w);
          const vn = _w.sub(_v).dot(_n);
          let Fn = 3e5 * pen - 1.5e4 * vn;
          if (Fn > 0) {
            Fn = Math.min(Fn, 1.5e5);
            _a.copy(_n).scale(Fn);
            this.applyForce(_a, _p);
            this.impact = Math.max(this.impact, Fn / 3e4);
            if (-vn > 2) {
              _hl.copy(_p).sub(this.pos).applyQuatInv(this.quat);
              this.hitAt(_hl, _n, -vn, `o${o.id ?? ''}${o.spheres.indexOf(s)}`);
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- winch
  /** Hook the winch rope to a world anchor (a tree) or to another truck (target = { id, local point }). */
  attachWinch(kind, anchorWorld, target = null, anchorLocal = null) {
    const W = this.winch;
    this.toWorld(W.fairlead, _p);
    const d = _p.clone().sub(anchorWorld).length();
    if (d > W.maxLen) return false;
    W.attached = true; W.kind = kind; W.target = target;
    W.anchor.copy(anchorWorld);
    if (anchorLocal) W.anchorLocal.copy(anchorLocal);
    W.len = Math.max(1, d + 0.3);
    W.tension = 0; W.motor = 0;
    return true;
  }

  detachWinch() { const W = this.winch; W.attached = false; W.kind = null; W.target = null; W.tension = 0; W.motor = 0; W.rate = 0; }

  /** W.motor: +1 reel in, -1 pay out, 0 hold. W.anchor must be current (the caller moves it for a truck). */
  winchStep(dt) {
    const W = this.winch, spec = this.spec.winch;
    this.winchForce.set(0, 0, 0);
    if (!W.attached) return;
    this.toWorld(W.fairlead, _p);
    _d.subVectors(W.anchor, _p);
    const dist = _d.length();
    if (dist > W.maxLen + 4) { this.detachWinch(); return; }
    _d.scale(1 / Math.max(dist, 1e-6));
    this.pointVel(_p, _v);
    const anchorVel = W.anchorVel || _w.set(0, 0, 0);
    const stretchRate = -(_v.dot(_d) - anchorVel.dot(_d));               // d(dist)/dt
    const stretch = dist - W.len;
    let ten = 0;
    if (stretch > 0) ten = Math.max(0, spec.stiffness * stretch + spec.damping * stretchRate);
    ten = Math.min(ten, spec.breakLoad);
    W.tension = ten;
    // the motor: line speed falls with load and stalls at its rated pull
    const len0 = W.len;
    if (W.motor > 0) {
      const speed = spec.lineSpeed * Math.max(0, 1 - ten / spec.stallPull);
      W.len = Math.max(0.6, W.len - speed * dt);
    } else if (W.motor < 0) {
      W.len = Math.min(W.maxLen, W.len + spec.lineSpeed * 1.6 * dt);
    }
    W.rate = (W.len - len0) / dt;
    // a slack line hangs: pull it in to the distance when nobody holds the motor, so it doesn't stay loose forever
    if (ten > 0) {
      _a.copy(_d).scale(ten);
      this.applyForce(_a, _p);
      this.winchForce.copy(_a);
    }
  }

  // ---------------------------------------------------------------- water
  waterStep(ground) {
    this.waterDepth = 0;
    if (!ground.water) return;
    const b = this.boxes[0];
    const wl = ground.water(this.pos.x, this.pos.z);
    if (!(wl > -1e8)) return;
    let any = false;
    const area = (b.h.x * 2 / 3) * (b.h.z * 2 / 3), up = this.up;
    // 3 x 3 columns over the main hull box (and the cab above it)
    for (let i = -1; i <= 1; i++) for (let k = -1; k <= 1; k++) {
      _p.set(b.c.x + i * b.h.x * 0.67, b.c.y - b.h.y, b.c.z + k * b.h.z * 0.67);
      this.toWorld(_p, _q);
      const level = ground.water(_q.x, _q.z);
      const depth = clamp(level - _q.y, 0, b.h.y * 2 + 0.6);
      if (depth <= 0) continue;
      any = true;
      const vol = area * depth * this.spec.buoyancy;
      _a.set(0, RHO_WATER * GRAVITY * vol, 0);
      // the lift acts in the middle of the column's part under water, up the truck's own column: so it turns with
      // the truck, and heeled over the low side's columns, deeper in, lift it back (the lift a column's foot alone
      // would give, with the foot swinging up to the high side, rolled a floating truck over)
      _q.addScaled(up, depth / 2);
      this.applyForce(_a, _q);
      // drag through the water, on the area the flow meets: across the front going ahead, along the side going
      // sideways, under the floor bobbing (each column a ninth of the hull's)
      this.pointVel(_q, _v);
      const sp = _v.length();
      if (sp > 1e-3) {
        const fa = Math.abs(_v.dot(this.fwd)) / sp, sa = Math.abs(_v.dot(this.right)) / sp, va = Math.abs(_v.dot(up)) / sp;
        const A = depth * (fa * b.h.x * 2 + sa * b.h.z * 2) / 9 + va * area;
        _a.copy(_v).scale(-0.5 * RHO_WATER * 0.9 * A * sp);
        this.applyForce(_a, _q);
      }
      this.waterDepth = Math.max(this.waterDepth, depth);
    }
    if (any) this.angVel.scale(1 - 0.3 * PHYS_DT);
  }

  // ---------------------------------------------------------------- state for the network / renderer
  /** Wheel travel (from full droop), spin angle and steer for each wheel. */
  /**
   * What reaches the driver. A beam front axle steers through a box: a tyre shoved back at its contact patch (by a
   * rock, a ledge, a rut, its brake) turns its wheel about the kingpin by the scrub radius, and the tie rod passes it
   * to the other; side forces act behind the kingpin (caster and pneumatic trail) and centre the wheel. The steady
   * part is the self-centring the driver holds; the sudden part kicks the steering wheel and, against the driver's
   * grip, turns the road wheels a little (bump steer). The ground's shake is how far each tyre's load jumps from its
   * running average; a surface's texture (gravel and rock buzz, a road hums) grows with speed and is soaked up by soft
   * tyres; tyres spinning in mud and snow judder; a hit several times the tyre's share of the weight is a bump.
   */
  feelStep(dt, speed) {
    const [wl, wr] = this.wheels, f = this.feel;
    const SCRUB = 0.07, TRAIL = 0.05;
    const Tk = SCRUB * (wr.Flong - wl.Flong) - TRAIL * (wl.Flat + wr.Flat);
    const a = 0.08 / (0.08 + dt);
    this._kHP = a * (this._kHP + Tk - this._kT);
    this._kT = Tk;
    this.kickAngle += (clamp(this._kHP / 6000, -0.012, 0.012) - this.kickAngle) * Math.min(1, dt / 0.02);
    const rim = (this._kHP / 17.5) * 0.25;
    f.kick += (rim - f.kick) * Math.min(1, dt / 0.015);
    // the ground through the tyres
    const share = (this.mass * GRAVITY) / 4, decay = Math.exp(-dt / 0.12);
    let rough = 0, tex = 0, judder = 0, bump = 0, n = 0;
    const soft = 0.55 + 0.45 * Math.min(1, this.psi / 30), pace = Math.pow(Math.min(1, Math.abs(speed) / 9), 0.8);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const N = w.contact ? w.N : 0;
      this._nLP[i] += (N - this._nLP[i]) * Math.min(1, dt / 0.25);
      rough = Math.max(rough, Math.abs(N - this._nLP[i]) / share);
      if (N > 2.8 * share) bump = Math.max(bump, (N / share - 2.8) / 4);
      if (!w.contact) continue;
      n++;
      tex += (TEXTURE[w.surf.id] ?? 0.2) * pace * soft;
      if (w.surf.sink > 0 && w.slipSpeed > 1) judder = Math.max(judder, Math.min(1, (w.slipSpeed - 1) / 4));
    }
    f.rough = Math.max(f.rough * decay, Math.min(1.5, rough));
    f.texture += ((n ? tex / n : 0) - f.texture) * Math.min(1, dt / 0.1);
    f.judder = Math.max(f.judder * decay, judder);
    f.bump = Math.max(f.bump * Math.exp(-dt / 0.2), Math.min(1, bump));
  }

  wheelState(i) {
    const w = this.wheels[i];
    const z = w.side > 0 ? w.axle.zL : w.axle.zR;
    return [z, w.angle, w.steer];
  }

  /** Is the truck resting upright on its wheels (for the recovery point)? */
  get settled() {
    let n = 0;
    for (const w of this.wheels) if (w.contact) n++;
    return n >= 3 && this.up.y > 0.8 && this.vel.length() < 25;
  }
}

/** Advance a vehicle by frameDt with fixed substeps; returns the leftover time to carry into the next frame. */
export function simulate(vehicle, ctrl, ground, frameDt, carry = 0, maxSteps = 40) {
  let t = carry + frameDt, n = 0;
  while (t >= PHYS_DT && n < maxSteps) { vehicle.step(ctrl, ground); t -= PHYS_DT; n++; }
  if (n >= maxSteps) t = 0;
  return t;
}

export { lerp };
