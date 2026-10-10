// Pedestrians: sidewalk life walking loops around blocks, waiting at corners and dodging cars.
// The ones nearest the camera (preset.people: 4-16) are realistic rigged characters (player/Human.js,
// drawn from a pool and handed back when they walk away); the rest are low-poly figures rendered
// with a handful of InstancedMeshes (torso/head, legs, arms). Distance LOD: limbs only near the camera.
import { Ragdoll } from './Ragdoll.js';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp } from '../core/util.js';
import { CURB_H } from './CityLayout.js';
import { bus } from '../core/EventBus.js';

const _u0 = new THREE.Vector3(), _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3(), _u3 = new THREE.Vector3();
const G = 9.81;
const _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _ax = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _off = new THREE.Vector3();

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
const SHIRTS = [0x2a3a5a, 0x5a2a2a, 0x2a4a3a, 0x6a6a6a, 0x1a1a1a, 0x8a6a3a, 0x3a2a4a, 0xa0a0a0, 0x7a2a4a];
const PANTS = [0x1a1c22, 0x2a2e3a, 0x3a3228, 0x101010, 0x4a4a52];
const SKIN = [0xe0b090, 0xc08a60, 0x8a5a3a, 0x5a3a28, 0xf0c8a8];
const KL_TOPS = [0xf4f2ec, 0xd8e4f0, 0xf0e0b0, 0x8ab0d8, 0xe8b0c0, 0xa0c8a0, 0xd04a5a, 0x2a6a9a, 0xe0a040, 0x6a3a8a];
const KL_LOWER = [0x1a1c22, 0x2a2e3a, 0xb0304a, 0x2a5a8a, 0xd8a030, 0x3a6a3a];
const KL_SKIN = [0xb07a50, 0x9a6a42, 0x8a5a3a, 0x6a4430, 0xc08a60];
const HAIR = [0x1a1410, 0x2a1c12, 0x3a2616, 0x0e0e10, 0x6a4a2a, 0x8a7a5a, 0x9a9a9a, 0x2a1c12];
const SHOES = [0x111111, 0x1a1a1a, 0xe8e8e8, 0x4a3020, 0x2a2a35];

function clean(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; }

export class Pedestrians {
  constructor(scene, layout, max) {
    this.layout = layout;
    this.scene = scene;
    this.max = max;
    this.people = 8;       // realistic characters near the camera (set from the quality preset)
    this.pool = new Map(); // model index -> idle Human instances
    this.humans = null;
    this.peds = [];
    this.R = rng(31337);
    // geometry: pivots at hips (legs) and shoulders (arms)
    const torso = mergeGeometries([
      clean(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 8).translate(0, 1.22, 0)),
      clean(new THREE.CylinderGeometry(0.17, 0.19, 0.2, 8).translate(0, 0.93, 0)),
      // rounded shoulders so arms don't hang off a tube
      clean(new THREE.CapsuleGeometry(0.075, 0.34, 3, 8).rotateZ(Math.PI / 2).translate(0, 1.49, 0)),
    ]);
    // hair cap (upper back of the head); scaled to zero for bald pedestrians
    const hair = clean(new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.58).scale(1, 1.12, 1.08).rotateX(-0.25).translate(0, 1.69, -0.008));
    const head = clean(new THREE.SphereGeometry(0.115, 10, 8).scale(1, 1.15, 1.05).translate(0, 1.68, 0));
    const neck = clean(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6).translate(0, 1.56, 0));
    const leg = clean(new THREE.CylinderGeometry(0.075, 0.06, 0.86, 6).translate(0, -0.43, 0));
    const arm = clean(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6).translate(0, -0.31, 0));
    // hands and shoes follow the limb transforms (same pivots), in skin / shoe colours
    const hand = clean(new THREE.SphereGeometry(0.052, 7, 5).scale(0.8, 1.15, 0.7).translate(0, -0.66, 0));
    const shoe = clean(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.85, 0.04));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, mat, max); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
    this.meshTorso = mk(torso); this.meshHead = mk(mergeGeometries([head, neck]));
    this.meshLegL = mk(leg); this.meshLegR = mk(leg); this.meshArmL = mk(arm); this.meshArmR = mk(arm);
    this.meshHair = mk(hair);
    this.meshHandL = mk(hand); this.meshHandR = mk(hand); this.meshShoeL = mk(shoe); this.meshShoeR = mk(shoe);
    this.limbMeshes = [this.meshLegL, this.meshLegR, this.meshArmL, this.meshArmR, this.meshHandL, this.meshHandR, this.meshShoeL, this.meshShoeR];
    // umbrellas for the monsoon: a ribbed canopy on a pole (most are black in Kerala)
    const canopy = new THREE.ConeGeometry(0.56, 0.26, 8, 1, true).translate(0, 0.13, 0);
    const pole = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 4).translate(0, -0.3, 0);
    const umb = mergeGeometries([clean(canopy), clean(pole)]);
    this.meshUmb = new THREE.InstancedMesh(umb, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }), max);
    this.meshUmb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.meshUmb.count = 0; this.meshUmb.frustumCulled = false; this.meshUmb.castShadow = true; scene.add(this.meshUmb);
    this.rain = 0;
  }

  _spawn(focus) {
    const R = this.R;
    // streamed worlds (Kerala) hand out stretches of road edge instead of city blocks
    if (this.layout.pedSegment) {
      const g = this.layout.pedSegment(focus, R);
      if (!g) return;
      const L = Math.hypot(g.bx - g.ax, g.bz - g.az);
      if (L < 6) return;
      const kl = !!g.kerala;
      this.peds.push({
        seg: g, segL: L, per: L * 2, t: R() * L * 2, dir: R() < 0.5 ? 1 : -1, speed: 0.95 + R() * 0.5, phase: R() * 6,
        // Kerala: light cotton shirts, white mundus and coloured sarees / churidars
        shirt: kl ? KL_TOPS[Math.floor(R() * KL_TOPS.length)] : SHIRTS[Math.floor(R() * SHIRTS.length)],
        pants: kl ? (R() < 0.45 ? 0xf2efe6 : KL_LOWER[Math.floor(R() * KL_LOWER.length)]) : PANTS[Math.floor(R() * PANTS.length)],
        skin: kl ? KL_SKIN[Math.floor(R() * KL_SKIN.length)] : SKIN[Math.floor(R() * SKIN.length)],
        hair: kl ? 0x0e0c0a : R() < 0.12 ? -1 : HAIR[Math.floor(R() * HAIR.length)],
        shoes: SHOES[Math.floor(R() * SHOES.length)], model: Math.floor(R() * 1000),
        build: 0.88 + R() * 0.3, scale: 0.9 + R() * 0.14, brave: R() * 0.8, umb: R() < 0.7 ? (R() < 0.7 ? 0x141414 : [0x1a3a8a, 0xb01818, 0x2a6a3a, 0x7a2a6a, 0xd8b020][Math.floor(R() * 5)]) : 0, wait: 0, dodge: 0, dx: 0, dz: 0, x: 0, z: 0, yaw: 0,
      });
      return;
    }
    // pick a random dense-ish block near the focus and a point on its sidewalk ring
    const blocks = this.layout.blocks.filter((b) => b.special !== 'river' && b.special !== 'hill' && Math.hypot(b.cx - focus.x, b.cz - focus.z) < 220 && Math.hypot(b.cx - focus.x, b.cz - focus.z) > 40);
    if (!blocks.length) return;
    const b = blocks[Math.floor(R() * blocks.length)];
    const inset = 2.2;
    const x0 = b.x0 + inset, x1 = b.x1 - inset, z0 = b.z0 + inset, z1 = b.z1 - inset;
    const per = 2 * (x1 - x0) + 2 * (z1 - z0);
    const weight = { downtown: 1, commercial: 1, suburban: 0.4, industrial: 0.25, warehouse: 0.15 }[b.district] ?? 0.3;
    if (R() > weight) return;
    this.peds.push({
      b, x0, x1, z0, z1, per, t: R() * per, dir: R() < 0.5 ? 1 : -1, speed: 1.1 + R() * 0.5, phase: R() * 6,
      shirt: SHIRTS[Math.floor(R() * SHIRTS.length)], pants: PANTS[Math.floor(R() * PANTS.length)], skin: SKIN[Math.floor(R() * SKIN.length)],
      hair: R() < 0.12 ? -1 : HAIR[Math.floor(R() * HAIR.length)],
      shoes: SHOES[Math.floor(R() * SHOES.length)], model: Math.floor(R() * 1000),
      build: 0.88 + R() * 0.3, // girth: slim .. heavy
      scale: 0.92 + R() * 0.16, brave: R() * 0.8, umb: R() < 0.7 ? (R() < 0.7 ? 0x141414 : [0x1a3a8a, 0xb01818, 0x2a6a3a, 0x7a2a6a, 0xd8b020][Math.floor(R() * 5)]) : 0, wait: 0, dodge: 0, dx: 0, dz: 0, x: 0, z: 0, yaw: 0,
    });
  }

  // people standing about: chatting at tea stalls, waiting at bus stops (Kerala's roadside life)
  _spawnGroups(focus) {
    const spots = this.layout.standSpots?.(focus.x, focus.z, 140);
    if (!spots?.length) return;
    this.groups ||= new Map();
    for (const sp of spots) {
      if (this.groups.has(sp.key) || this.peds.length >= this.max + 12) continue;
      const R = this.R, n = sp.kind === 'tea' ? 2 + Math.floor(R() * 3) : 1 + Math.floor(R() * 3);
      const members = [];
      // the road side of the stall / the shelter; tea drinkers stand round in a loose ring
      const fx = Math.sin(sp.yaw), fz = Math.cos(sp.yaw);
      const cx = sp.x + fx * (sp.kind === 'tea' ? 3.6 : 1.1), cz = sp.z + fz * (sp.kind === 'tea' ? 3.6 : 1.1);
      for (let i = 0; i < n; i++) {
        const n0 = this.peds.length;
        this._spawn(focus);
        if (this.peds.length === n0) { this._spawnLook(); }
        const p = this.peds[this.peds.length - 1];
        if (!p || members.includes(p)) continue;
        const a = (i / n) * Math.PI * 2 + R(), r = sp.kind === 'tea' ? 0.9 + R() * 0.4 : 0.5 + R() * 1.6;
        const x = sp.kind === 'tea' ? cx + Math.cos(a) * r : cx + (R() - 0.5) * 3, z = sp.kind === 'tea' ? cz + Math.sin(a) * r : cz + (R() - 0.5) * 1.2;
        p.seg = null; p.cross = null;
        p.stand = { x, z, yaw: sp.kind === 'tea' ? Math.atan2(cx - x, cz - z) : sp.yaw, talk: sp.kind === 'tea' || R() < 0.3, spot: sp.key, kind: sp.kind };
        p.x = x; p.z = z; p.yaw = p.stand.yaw;
        members.push(p);
      }
      this.groups.set(sp.key, { members, x: sp.x, z: sp.z });
    }
  }
  // a pedestrian look without a walking route (for standing groups)
  _spawnLook() {
    const R = this.R;
    this.peds.push({ t: 0, per: 1, dir: 1, speed: 1.1, phase: R() * 6, shirt: KL_TOPS[Math.floor(R() * KL_TOPS.length)], pants: R() < 0.45 ? 0xf2efe6 : KL_LOWER[Math.floor(R() * KL_LOWER.length)], skin: KL_SKIN[Math.floor(R() * KL_SKIN.length)], hair: 0x0e0c0a, shoes: SHOES[Math.floor(R() * SHOES.length)], model: Math.floor(R() * 1000), build: 0.88 + R() * 0.3, scale: 0.9 + R() * 0.14, brave: R() * 0.8, umb: R() < 0.7 ? 0x141414 : 0, wait: 0, dodge: 0, dx: 0, dz: 0, x: 0, z: 0, yaw: 0 });
  }

  // a bus has stopped at (x, z): the people waiting there get on
  busArrived(x, z) {
    for (const p of this.peds) if (p.stand?.kind === 'bus' && Math.hypot(p.x - x, p.z - z) < 14) { p.board = { x, z }; p.stand = null; }
  }

  // a rider knocked off a two-wheeler: a person thrown from the seat with the bike's speed, tumbling to the road
  throwRider({ x, y, z, vx, vz, yaw }) {
    const n0 = this.peds.length;
    for (let k = 0; k < 12 && this.peds.length === n0; k++) this._spawn({ x: x + 60, z });   // borrow a random look
    // (no stretch of roadside free: one at the crash itself, so the rider never just vanishes)
    if (this.peds.length === n0 && this.layout.pedSegment) {
      const ps = this.layout.pedSegment, fx = Math.sin(yaw || 0), fz = Math.cos(yaw || 0);
      this.layout.pedSegment = () => ({ ax: x - fx * 4, az: z - fz * 4, bx: x + fx * 4, bz: z + fz * 4, kerala: true });
      try { this._spawn({ x, z }); } finally { this.layout.pedSegment = ps; }
    }
    if (this.peds.length === n0) return;
    const p = this.peds[this.peds.length - 1], sp = Math.hypot(vx, vz);
    p.x = x; p.z = z; p.umb = 0; p.d = 0;
    p.down = {
      x, y: y + 0.75, z, vx, vy: 1.2 + Math.min(3, sp * 0.18), vz, t: 0, landed: false, rest: 0, yaw: Math.atan2(vx, vz) || yaw,
      axis: new THREE.Vector3(vz, 0, -vx).normalize(), ang: 0, spin: sp > 4 ? Math.min(12, sp * 0.6) : 2, heavy: sp > 9, pending: 'death',
    };
    if (!sp) p.down.axis.set(1, 0, 0);
  }

  // a driver thrown out of their car: sprints away from the player for a few seconds, then leaves
  spawnFleeing(x, z, fromX, fromZ) {
    const n0 = this.peds.length;
    for (let k = 0; k < 12 && this.peds.length === n0; k++) this._spawn({ x: x + 60, z }); // borrow a random look
    if (this.peds.length === n0) return;
    const p = this.peds[this.peds.length - 1];
    const dx = x - fromX, dz = z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.flee = { x, z, vx: dx / l * 5.2, vz: dz / l * 5.2, t: 7 };
    p.speed = 4.6;
  }

  // the ground under a pedestrian: Port Halvern's kerb, or the streamed terrain
  _gy(x, z) { return this.layout.pedSegment ? (this.layout.groundHeight?.(x, z) ?? 0) : CURB_H; }
  // ... or the floor of the room they're in
  _py(p) { return p.fy ?? this._gy(p.x, p.z); }

  // someone inside a building (a shopkeeper behind the counter): stands there on the room's floor (fy), doesn't
  // run off through the walls when frightened
  spawnIndoor(x, y, z, yaw) {
    this._spawnLook();
    const p = this.peds[this.peds.length - 1];
    p.x = x; p.z = z; p.yaw = yaw; p.fy = y; p.umb = 0; p.seg = null;
    p.home = p.stand = { x, z, yaw, talk: false, kind: 'indoor' };
    return p;
  }

  remove(p) { const i = this.peds.indexOf(p); if (i < 0) return; this._release(p); this.peds.splice(i, 1); }

  _pos(p) {
    let t = ((p.t % p.per) + p.per) % p.per;
    if (p.seg) { // there and back along a stretch of road edge
      const g = p.seg, L = p.segL, out = t < L, u = out ? t : 2 * L - t;
      const fwd = out === (p.dir > 0);
      return [g.ax + (g.bx - g.ax) * u / L, g.az + (g.bz - g.az) * u / L, Math.atan2(g.bx - g.ax, g.bz - g.az) + (fwd ? 0 : Math.PI)];
    }
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    if (t < w) return [p.x0 + t, p.z0, p.dir > 0 ? Math.PI / 2 : -Math.PI / 2];
    t -= w; if (t < d) return [p.x1, p.z0 + t, p.dir > 0 ? 0 : Math.PI];
    t -= d; if (t < w) return [p.x1 - t, p.z1, p.dir > 0 ? -Math.PI / 2 : Math.PI / 2];
    t -= w; return [p.x0, p.z1 - t, p.dir > 0 ? Math.PI : 0];
  }

  update(dt, camera, vehicles, enabled = true) {
    const focus = camera.position;
    if (!enabled || this.max === 0) { for (const p of this.peds) this._release(p); for (const m of [this.meshTorso, this.meshHead, this.meshHair, this.meshUmb, ...this.limbMeshes]) m.count = 0; return; }
    const want = this.max * (1 - this.rain * 0.5) * (this.timeK ?? 1);
    if (this.peds.length < want && this.R() < 0.6 * (1 - this.rain * 0.6)) this._spawn(focus);
    if (this.layout.standSpots && (this._grpT = (this._grpT || 0) - dt) <= 0) {
      this._grpT = 1.5;
      // groups far away break up; new ones form at the spots near the camera
      if (this.groups) for (const [k, g] of this.groups) if (Math.hypot(g.x - focus.x, g.z - focus.z) > 200) this.groups.delete(k);
      this._spawnGroups(focus);
    }
    let nu = 0;
    let n = 0, nl = 0;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d > 260 && p.x !== 0) { this._release(p); this.peds.splice(i, 1); continue; }
      if (p.down) { if (this._fallen(p, dt, d, i)) continue; n = this._drawDown(p, n, dt); continue; }
      // vehicles: struck (thrown, tumbling, down on the road) or, with a moment's warning, a quick
      // step / run out of the way at human speed
      let struck = false;
      for (const v of vehicles) {
        const s = v.physics.s, P = v.physics.p;
        const dx = p.x - s.x, dz = p.z - s.z, dd = Math.hypot(dx, dz);
        const sp = Math.hypot(s.vx, s.vz);
        if (dd < 8 && sp > 1.5) {
          const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
          const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // car frame: x left, z forward
          if (Math.abs(lx) < (P.hx || 0.95) + 0.28 && Math.abs(lz) < (P.hz || 2.3) + 0.28) { this._hit(p, v, sp, lx); struck = true; break; }
        }
        if (dd < 3 + sp * 0.35 && sp > 3 && s.y > 0.08 && !p.dodge) { // car mounted the sidewalk
          const k = 1 / (dd || 1);
          p.dodge = 0.9; p.dx = dx * k * 3.6; p.dz = dz * k * 3.6;
        }
      }
      if (struck) { n = this._drawDown(p, n, dt); continue; }
      let moving = true;
      if (p.dodge > 0) { p.dodge -= dt; p.ox = (p.ox || 0) + p.dx * dt; p.oz = (p.oz || 0) + p.dz * dt; }
      else {
        p.ox = (p.ox || 0) * (1 - dt); p.oz = (p.oz || 0) * (1 - dt);
        if (p.wait > 0) { p.wait -= dt; moving = false; } else {
          p.t += p.dir * p.speed * dt;
          if (this.R() < dt * 0.02) p.wait = 2 + this.R() * 4;
        }
      }
      // standing about (chatting, waiting for the bus) or walking over to board a bus
      if (p.stand && !p.fight && !p.flee && !p.down) {
        p.x = p.stand.x + (p.ox || 0); p.z = p.stand.z + (p.oz || 0); p.yaw = p.stand.yaw; p.d = d;
        if (p.human) {
          if (p.stand.talk && !p.human.shot && p.human.acts?.talk) p.human.play('talk', { hold: true, fade: 0.4 });
          const hg = p.human.group; hg.position.set(p.x, this._py(p), p.z); hg.rotation.set(0, p.yaw, 0); hg.updateMatrixWorld(true); p.human.animate(0, dt);
          continue;
        }
      }
      if (p.walkTo && !p.board) p.board = { x: p.walkTo.x, z: p.walkTo.z, then: p.walkTo.then }, p.walkTo = null;
      if (p.board) {
        const dx = p.board.x - p.x, dz = p.board.z - p.z, l = Math.hypot(dx, dz);
        // walking over to something: get on the bus (gone), or stand there (an onlooker)
        if (l < 1.2) {
          if (p.board.then) { p.stand = p.board.then; p.board = null; p.ox = p.oz = 0; continue; }
          this._release(p); this.peds.splice(i, 1); continue;
        }
        p.x += dx / l * 1.6 * dt; p.z += dz / l * 1.6 * dt; p.yaw = Math.atan2(dx, dz); p.d = d;
        if (p.human) { p.human.clearAction(0.2); const hg = p.human.group; hg.position.set(p.x, this._py(p), p.z); hg.rotation.set(0, p.yaw, 0); hg.updateMatrixWorld(true); p.human.animate(1.6, dt); continue; }
      }
      // crossing the road: wait for a gap, walk straight over, carry on along the far side
      if (!p.fight && !p.flee && !p.crossing && p.seg?.cross && !p.stagger && this.R() < dt * 0.0025) {
        const X = p.seg.cross, near = (this.traffic || []).some((c) => c.state === 'drive' && c.v > 2 && Math.hypot(c.x - p.x, c.z - p.z) < 14 + c.v * 1.5);
        if (!near) p.crossing = { x: p.x, z: p.z, nx: X.nx, nz: X.nz, len: X.len, t: 0 };
      }
      let yaw;
      if (p.crossing) {
        const C = p.crossing, sp = 1.7; // people hurry across
        C.t += sp * dt;
        p.x = C.x + C.nx * C.t; p.z = C.z + C.nz * C.t; p.yaw = yaw = Math.atan2(C.nx, C.nz); moving = true;
        if (C.t >= C.len) {
          // the walk now runs along the far side, heading back the other way
          const g = p.seg, ox = C.nx * C.len, oz = C.nz * C.len;
          p.seg = { ...g, ax: g.ax + ox, az: g.az + oz, bx: g.bx + ox, bz: g.bz + oz, cross: { ...g.cross, nx: -g.cross.nx, nz: -g.cross.nz } };
          p.crossing = null; p.ox = p.x - this._pos(p)[0]; p.oz = p.z - this._pos(p)[1];
        }
      } else if (p.fight) {
        // squaring up to the player: close in, circle a little, throw punches
        const r = this._fight(p, dt);
        if (r === 'gone') { this._release(p); this.peds.splice(i, 1); continue; }
        yaw = p.yaw; moving = r === 'move';
      } else if (p.flee) {
        const f = p.flee;
        f.t -= dt; if (f.t <= 0) { this._release(p); this.peds.splice(i, 1); continue; }
        f.x += f.vx * dt; f.z += f.vz * dt;
        p.x = f.x; p.z = f.z; p.yaw = yaw = Math.atan2(f.vx, f.vz); moving = true;
      } else if (p.stand || p.board) {
        yaw = p.yaw; moving = !!p.board;
      } else {
        const [x, z, y2] = this._pos(p);
        yaw = y2; p.x = x + (p.ox || 0); p.z = z + (p.oz || 0); p.yaw = yaw;
      }
      p.d = d;
      // caught in a downpour without an umbrella: hurry off indoors
      if (this.rain > 0.5 && !p.umb && !p.stand && !p.fight && !p.flee && !p.crossing && this.R() < dt * 0.3) { p.flee = { x: p.x, z: p.z, vx: Math.sin(p.yaw) * 3.4, vz: Math.cos(p.yaw) * 3.4, t: 5 }; p.speed = 3.4; }
      // (an umbrella over a simple figure only where those figures are drawn; real characters hold theirs, below)
      if (p.umb && this.rain > 0.2 && !p.human && !(this.layout.pedSegment && d < 85 && this.humans?.ready) && d <= 150 && nu < this.meshUmb.instanceMatrix.count) {
        const gy = this._py(p), c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        _e.set(0.12, p.yaw, 0.08); _q.setFromEuler(_e);
        _m.compose(_p.set(p.x + c * 0.12, gy + 1.98 * p.scale, p.z - sn * 0.12), _q, _s.setScalar(p.scale));
        this.meshUmb.setMatrixAt(nu, _m); this.meshUmb.setColorAt(nu++, _c.setHex(p.umb));
      }
      if (p.human) {
        const hg = p.human.group;
        hg.position.set(p.x, this._py(p), p.z); hg.rotation.set(0, yaw, 0);
        hg.updateMatrixWorld(true);
        p.human.animate(p.fight ? (moving ? p.fight.sp : 0) : p.dodge > 0 ? 3.6 : moving ? p.speed : 0, dt);
        // in the rain: the right arm comes up and the hand holds the umbrella's handle
        if (p.umb && this.rain > 0.2 && !p.fight && !p.down && nu < this.meshUmb.instanceMatrix.count) {
          const h = p.human, B = h.B;
          if (B.RightArm && B.RightForeArm && B.RightHand && B.LeftArm) {
            const sh = B.RightArm.getWorldPosition(_u0), side = B.LeftArm.getWorldPosition(_u1).sub(sh).setY(0).normalize(); // towards the left shoulder
            const fx = Math.sin(yaw), fz = Math.cos(yaw);
            const elbow = _u2.copy(sh).add(_u3.set(fx * 0.14 - side.x * 0.06, -0.2, fz * 0.14 - side.z * 0.06));
            h._aim(B.RightArm, B.RightForeArm, elbow);
            const hand = _u2.copy(sh).add(_u3.set(fx * 0.24 + side.x * 0.12, 0.14, fz * 0.24 + side.z * 0.12));
            h._aim(B.RightForeArm, B.RightHand, hand);
            B.RightHand.getWorldPosition(_u0);
            _e.set(0.06, yaw, 0.04); _q.setFromEuler(_e);
            _m.compose(_p.set(_u0.x, _u0.y + 0.62 * p.scale, _u0.z), _q, _s.setScalar(p.scale));
            this.meshUmb.setMatrixAt(nu, _m); this.meshUmb.setColorAt(nu++, _c.setHex(p.umb));
          }
        }
        continue;
      }
      if (d > 150) continue;
      // in Kerala everyone near enough to make out is a real character: the simple figures only stand in far off
      if (this.layout.pedSegment && d < 85 && this.humans?.ready) continue;
      p.phase += dt * (moving ? p.speed * 5.2 : 0);
      const swing = moving ? Math.sin(p.phase) * 0.5 : 0;
      const bob = moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0;
      const y = this._py(p) + bob;
      _e.set(0, yaw, 0); _q.setFromEuler(_e);
      _s.set(p.scale * p.build, p.scale, p.scale * p.build);
      _m.compose(_p.set(p.x, y, p.z), _q, _s);
      this.meshTorso.setMatrixAt(n, _m); this.meshTorso.setColorAt(n, _c.setHex(p.shirt));
      _s.setScalar(p.scale);
      _m.compose(_p.set(p.x, y, p.z), _q, _s);
      this.meshHead.setMatrixAt(n, _m); this.meshHead.setColorAt(n, _c.setHex(p.skin));
      if (p.hair < 0) _m.makeScale(0, 0, 0);
      this.meshHair.setMatrixAt(n, _m); this.meshHair.setColorAt(n, _c.setHex(p.hair < 0 ? 0 : p.hair));
      if (d < 110) {
        const limb = (meshes, ox, oy, rot, colors) => {
          _e.set(rot, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          _p.set(p.x + (ox * c) * p.scale, y + oy * p.scale, p.z + (-ox * sn) * p.scale);
          _m.compose(_p, _q, _s);
          meshes.forEach((mesh, i) => { mesh.setMatrixAt(nl, _m); mesh.setColorAt(nl, _c.setHex(colors[i])); });
        };
        const sh = 0.24 * p.build;
        limb([this.meshLegL, this.meshShoeL], 0.09, 0.88, swing, [p.pants, p.shoes]);
        limb([this.meshLegR, this.meshShoeR], -0.09, 0.88, -swing, [p.pants, p.shoes]);
        limb([this.meshArmL, this.meshHandL], sh, 1.5, -swing * 0.8, [p.shirt, p.skin]);
        limb([this.meshArmR, this.meshHandR], -sh, 1.5, swing * 0.8, [p.shirt, p.skin]);
        nl++;
      }
      n++;
    }
    this._assignPeople();
    this.meshUmb.count = nu; this.meshUmb.instanceMatrix.needsUpdate = true; if (this.meshUmb.instanceColor) this.meshUmb.instanceColor.needsUpdate = true;
    for (const m of [this.meshTorso, this.meshHead, this.meshHair]) { m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const m of this.limbMeshes) { m.count = nl; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    void clamp;
  }
  // the nearest pedestrians become realistic characters; ones that walk off hand theirs back
  _assignPeople() {
    const kl = !!this.layout.pedSegment, R = kl ? 90 : 45;
    const K = this.humans?.ready ? (kl ? Math.max(this.people, 20) : this.people) : 0;
    const near = this.peds.filter((p) => p.d !== undefined && p.d < R).sort((a, b) => a.d - b.d).slice(0, K);
    const keep = new Set(near);
    for (const p of this.peds) if (p.human && (!keep.has(p) || p.d > R + 5)) this._release(p);
    // the first model is the player's own look: the crowd is the rest (in Kerala: mundus, kurtas, sarees)
    const M = this.humans?.models?.length || 1, skip = M > 2 ? 1 : 0;
    for (const p of near) {
      if (p.human) continue;
      if (p.model % M < skip) p.model += 1;
      const list = this.pool.get(p.model % this.humans.models.length);
      const h = list?.pop() || this.humans.create(p.model, { shadow: true });
      if (!h) continue;
      p.human = h;
      h.group.visible = true;
      if (!h.group.parent) this.scene.add(h.group);
    }
  }
  _release(p) {
    const h = p.human;
    if (!h) return;
    p.human = null;
    h.clearAction?.(0);
    h.group.visible = false;
    const k = p.model % this.humans.models.length;
    if (!this.pool.has(k)) this.pool.set(k, []);
    this.pool.get(k).push(h);
  }

  // Struck by a car: thrown with (most of) the car's speed plus a push away from it, lifted a little
  // more the faster the hit, tumbling end over end on a hard hit, then down on the road.
  _hit(p, v, sp, lx) {
    const s = v.physics.s, m = v.physics.p.mass || 1500;
    const ax = Math.sin(s.yaw), az = Math.cos(s.yaw);          // car forward
    const side = Math.sign(lx) || 1, lxv = Math.cos(s.yaw), lzv = -Math.sin(s.yaw); // car left
    const k = 0.85 + Math.random() * 0.2;
    const vx = s.vx * k + lxv * side * (0.8 + sp * 0.08), vz = s.vz * k + lzv * side * (0.8 + sp * 0.08);
    const vy = sp < 5 ? 0.4 : Math.min(6, 0.8 + sp * 0.16);
    p.down = {
      x: p.x, y: this._py(p), z: p.z, vx, vy, vz, t: 0, landed: false, rest: 0, yaw: Math.atan2(vx, vz),
      // tumble about the horizontal axis across the throw
      axis: new THREE.Vector3(vz, 0, -vx).normalize(), ang: 0, spin: sp > 9 ? Math.min(14, sp * 0.55) : 0, heavy: sp > 11,
    };
    p.dodge = 0; p.flee = null;
    // the car loses a little speed (a person is ~80 kg against its mass)
    const loss = 80 / (m + 80) * 0.9;
    s.vx *= 1 - loss; s.vz *= 1 - loss;
    if (p.human) { p.human.clearAction(0.05); p.human.play(sp > 5 ? 'death' : 'hit', { hold: true, rate: sp > 5 ? 1.5 : 1, fade: 0.08 }); if (sp <= 5) p.down.pending = 'death'; }
    bus.emit('ped:hit', { x: p.x, z: p.z, speed: sp, vehicle: v });
    void ax; void az;
  }

  // flight, landing and sliding to rest; lying still afterwards (removed once far away). Returns true
  // when the pedestrian was removed.
  _fallen(p, dt, d, i) {
    const D = p.down;
    D.t += dt;
    // a rigged character falls as a ragdoll (limbs on their own), near the camera
    if (p.human && D.rag === undefined && d < 120) {
      const R = new Ragdoll(p.human, { x: D.vx, y: D.vy, z: D.vz }, D.spin, D.axis);
      D.rag = R.ok ? R : null;
      if (D.rag) { p.human.clearAction(0); D.pending = null; }
    }
    if (D.rag && D.rag.h !== p.human) D.rag = null;   // (their character went back to the pool)
    if (D.rag) {
      const R = D.rag, gh = p.fy !== undefined ? () => p.fy : (x, z) => this.layout.groundHeight?.(x, z) ?? 0, cq = this._rq || (this._rq = []);
      R.step(dt, gh, p.fy !== undefined ? () => this.indoorColliders || [] : this.collision ? (x, z) => this.collision.query(x - 2, z - 2, x + 2, z + 2, cq) : null);
      D.x = R.hips.x; D.z = R.hips.z; D.y = R.hips.y; D.landed = R.landed;
      if (!D.thud && R.landed) { D.thud = true; bus.emit('ped:land', { x: D.x, z: D.z, speed: Math.hypot(D.vx, D.vz) }); }
      if (R.still) D.rest += dt;
      p.x = D.x; p.z = D.z; p.d = d;
      if ((D.rest > 25 && d > 40) || d > 200) { this._release(p); this.peds.splice(i, 1); return true; }
      return false;
    }
    if (!D.landed) {
      D.vy -= G * dt;
      D.x += D.vx * dt; D.y += D.vy * dt; D.z += D.vz * dt;
      D.ang += D.spin * dt;
      this._bodyHit(D, D.y);
      const g = (p.fy ?? this.layout.groundHeight?.(D.x, D.z) ?? 0) + 0.02;
      if (D.y <= g && D.vy < 0) {
        D.y = g;
        if (-D.vy > 3 && !D.bounced) { D.vy = -D.vy * 0.22; D.bounced = true; D.spin *= 0.3; } // one small bounce
        else { D.landed = true; D.vy = 0; }
        if (!D.thud) { D.thud = true; bus.emit('ped:land', { x: D.x, z: D.z, speed: Math.hypot(D.vx, D.vz) }); }
      }
    } else {
      // sliding / rolling to a stop on the tarmac
      const f = Math.exp(-dt * 4.5);
      D.vx *= f; D.vz *= f; D.spin *= Math.exp(-dt * 6);
      D.x += D.vx * dt; D.z += D.vz * dt; D.ang += D.spin * dt;
      this._bodyHit(D, D.y);
      D.y = (p.fy ?? this.layout.groundHeight?.(D.x, D.z) ?? 0) + 0.02;
      if (Math.hypot(D.vx, D.vz) < 0.2) D.rest += dt;
    }
    if (D.pending && D.t > 0.3 && p.human) { p.human.play(D.pending, { hold: true, rate: 1.3, fade: 0.15 }); D.pending = null; }
    p.x = D.x; p.z = D.z; p.d = d;
    // injured / out cold: lie there; gone once the player has moved on
    if ((D.rest > 25 && d > 40) || d > 200) { this._release(p); this.peds.splice(i, 1); return true; }
    return false;
  }

  // a thrown or sliding body meets a wall, a pole, a tree or a building: it stops against it (a little rebound)
  // instead of passing through; `y` = its height (it can fly over a low wall; collider tops are heights too)
  _bodyHit(D, y) {
    if (!this.collision) return;
    const r = 0.3, list = this.collision.query(D.x - r - 1, D.z - r - 1, D.x + r + 1, D.z + r + 1, this._cq || (this._cq = []));
    for (const c of list) {
      if ((c.h ?? 99) < y + 0.2) continue;
      const dx = D.x - c.cx, dz = D.z - c.cz, lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      const px = c.hx + r - Math.abs(lx), pz = c.hz + r - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      // out along the shallower side; the velocity into the obstacle turns into a small rebound
      let nx, nz, d;
      if (px < pz) { const s = Math.sign(lx) || 1; nx = c.cos * s; nz = -c.sin * s; d = px; } else { const s = Math.sign(lz) || 1; nx = c.sin * s; nz = c.cos * s; d = pz; }
      D.x += nx * d; D.z += nz * d;
      const vn = D.vx * nx + D.vz * nz;
      if (vn < 0) { D.vx -= vn * 1.25 * nx; D.vz -= vn * 1.25 * nz; D.vx *= 0.5; D.vz *= 0.5; D.spin *= 0.4; }
    }
  }

  // the whole body follows the throw; the realistic character crumples with its fall clip, the tumble
  // turns end over end in the air and settles back to the clip's lying pose on the ground
  _drawDown(p, n, dt = 1 / 60) {
    const D = p.down;
    if (D.rag && p.human === D.rag.h) { D.rag.pose(D.yaw); return n; }
    const tumble = D.landed ? Math.round(D.ang / (Math.PI * 2)) * Math.PI * 2 : D.ang;
    if (D.landed) D.ang += (tumble - D.ang) * Math.min(1, dt * 12);
    _qy.setFromAxisAngle(_Y, D.yaw + Math.PI);                 // faces back toward the car: falls backwards
    _qa.setFromAxisAngle(_ax.copy(D.axis), D.ang);
    const q = _qa.multiply(_qy);
    // tumble about the hips (~0.9 m up)
    _off.set(0, 0.9, 0).applyQuaternion(_qa.clone().setFromAxisAngle(_ax, D.ang)).sub(new THREE.Vector3(0, 0.9, 0));
    if (p.human) {
      const hg = p.human.group;
      if (D.landed) {
        // on the ground: lie flat on the back (the fall clip has no root motion, so it can't take the
        // hips down itself), limbs relaxed
        if (D.lying === undefined) { D.lying = 0; p.human.clearAction(0.35); }
        D.lying = Math.min(1, D.lying + dt / 0.35);
        _e.set(-Math.PI / 2 * D.lying, D.yaw + Math.PI, 0, 'YXZ');
        hg.quaternion.setFromEuler(_e);
        hg.position.set(D.x, D.y + 0.14 * D.lying, D.z);
      } else {
        hg.position.set(D.x - _off.x, D.y - _off.y, D.z - _off.z);
        hg.quaternion.copy(q);
      }
      hg.updateMatrixWorld(true);
      p.human.animate(0, dt);
      return n;
    }
    // low-poly figure: lie down (pitch back) as it falls
    const lie = Math.min(1, D.t / 0.55) * (Math.PI / 2);
    _e.set(-lie, D.yaw + Math.PI, 0, 'YXZ'); _q.setFromEuler(_e);
    _q.premultiply(_qa.setFromAxisAngle(_ax.copy(D.axis), D.landed ? 0 : D.ang));
    _s.set(p.scale * p.build, p.scale, p.scale * p.build);
    _m.compose(_p.set(D.x, D.y + 0.12 * Math.sin(lie), D.z), _q, _s);
    this.meshTorso.setMatrixAt(n, _m); this.meshTorso.setColorAt(n, _c.setHex(p.shirt));
    _s.setScalar(p.scale); _m.compose(_p, _q, _s);
    this.meshHead.setMatrixAt(n, _m); this.meshHead.setColorAt(n, _c.setHex(p.skin));
    if (p.hair < 0) _m.makeScale(0, 0, 0);
    this.meshHair.setMatrixAt(n, _m); this.meshHair.setColorAt(n, _c.setHex(p.hair < 0 ? 0 : p.hair));
    return n + 1;
  }

  // ------------------------------------------------------------------------------------------ fighting
  // the pedestrian nearest to (x, z) inside a cone around yaw, standing (not down), within range
  target(x, z, yaw, range = 2.2, cone = 0.5) {
    let best = null, bs = Infinity;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    for (const p of this.peds) {
      if (p.down) continue;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.05) continue;
      const dot = (dx * fx + dz * fz) / d;
      if (dot < cone) continue;
      const score = d - dot;
      if (score < bs) { bs = score; best = p; }
    }
    return best;
  }

  // a blow from the player (or anyone at fromX/fromZ): hurts, staggers, knocks down; the victim and the
  // people around react. kind: 'jab' | 'cross' | 'kick'
  damage(p, amount, fromX, fromZ, kind = 'jab') {
    if (!p || p.down) return false;
    p.hp = (p.hp ?? 100) - amount;
    p.stand = null; p.board = null;
    const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1;
    if (p.hp <= 0) {
      // knocked out: thrown back off their feet
      const sp = kind === 'cross' ? 3.2 : 2.4;
      p.down = { x: p.x, y: this._py(p), z: p.z, vx: dx / l * sp, vy: 1.2, vz: dz / l * sp, t: 0, landed: false, rest: 0, yaw: Math.atan2(-dx, -dz), axis: new THREE.Vector3(dz, 0, -dx).normalize(), ang: 0, spin: 0, heavy: false };
      p.fight = null; p.flee = null; p.dodge = 0;
      if (p.human) { p.human.clearAction(0.05); p.human.play('death', { hold: true, rate: 1.4, fade: 0.06 }); }
      bus.emit('ped:ko', { x: p.x, z: p.z, ped: p });
      this.panic(p.x, p.z, 22, p);
      return true;
    }
    // staggered: shoved back, head snaps
    p.stagger = 0.45; p.svx = dx / l * 2.2; p.svz = dz / l * 2.2;
    if (p.human) p.human.play(kind === 'cross' || this.R() < 0.5 ? 'hitHead' : 'hit', { rate: 1.3, fade: 0.05 });
    // first blow decides it: square up, or run
    if (!p.fight && !p.angry) {
      p.angry = true;
      if (this.R() < (p.brave ?? 0.45)) this.startFight(p);
      else this._flee(p, fromX, fromZ, 5.0, 8);
    }
    this.panic(p.x, p.z, 14, p);
    bus.emit('ped:struck', { x: p.x, z: p.z, ped: p, amount });
    return false;
  }

  // shot (by the player): a head shot or a second body shot puts them down, falling away from the shot;
  // otherwise they stagger and run. Everyone within earshot scatters.
  shoot(p, dx, dz, head = false) {
    if (!p || p.down) return false;
    p.hp = (p.hp ?? 100) - (head ? 200 : 55 + this.R() * 15);
    p.stand = null; p.board = null; p.fight = null;
    if (p.hp <= 0) {
      const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      p.down = { x: p.x, y: this._py(p), z: p.z, vx: ux * 1.4, vy: 0.3, vz: uz * 1.4, t: 0, landed: false, rest: 0, yaw: Math.atan2(-ux, -uz), axis: new THREE.Vector3(uz, 0, -ux).normalize(), ang: 0, spin: 0, heavy: false };
      p.flee = null; p.dodge = 0;
      if (p.human) { p.human.clearAction(0.05); p.human.play('death', { hold: true, rate: 1.25, fade: 0.05 }); }
      bus.emit('ped:ko', { x: p.x, z: p.z, ped: p, shot: true });
    } else {
      p.stagger = 0.35; p.svx = dx * 1.5; p.svz = dz * 1.5;
      if (p.human) p.human.play('hit', { rate: 1.4, fade: 0.04 });
      p.angry = true;
      this._flee(p, p.x - dx * 10, p.z - dz * 10, 5.4, 10);
    }
    this.panic(p.x, p.z, 40, p);
    return p.hp <= 0;
  }

  // the nearest standing pedestrian a ray from (ox, oy, oz) along unit (dx, dy, dz) passes through, within maxT:
  // { p, t, head } (bodies as upright cylinders, 0.3 m round, head the top 0.3 m)
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    const h2 = dx * dx + dz * dz;
    if (h2 < 1e-6) return null;
    for (const p of this.peds) {
      if (p.down || p.x === 0) continue;
      const px = p.x - ox, pz = p.z - oz, t = (px * dx + pz * dz) / h2;
      if (t < 0.3 || t > maxT || (best && t > best.t)) continue;
      const cx = ox + dx * t - p.x, cz = oz + dz * t - p.z;
      if (cx * cx + cz * cz > 0.33 * 0.33) continue;
      const gy = this._py(p), y = oy + dy * t - gy, H = 1.72 * (p.scale || 1);
      if (y < 0 || y > H) continue;
      best = { p, t, head: y > H - 0.3 };
    }
    return best;
  }

  startFight(p) {
    p.fight = { x: p.x, z: p.z, cd: 0.5 + this.R() * 0.6, sp: 0, strafe: this.R() < 0.5 ? 1 : -1, swing: null, t: 0 };
    p.flee = null; p.wait = 0;
  }

  _flee(p, fromX, fromZ, speed = 4.6, t = 7) {
    if (p.fy !== undefined) { p.fight = null; p.stand = p.home; return; }   // indoors: nowhere to run, cowers
    const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.flee = { x: p.x, z: p.z, vx: dx / l * speed, vz: dz / l * speed, t };
    p.fight = null; p.speed = speed;
  }

  // everyone close by (not already fighting or down) runs from trouble
  panic(x, z, r, except) {
    for (const q of this.peds) {
      if (q === except || q.down || q.fight || q.flee || q.fy !== undefined) continue;
      if (Math.hypot(q.x - x, q.z - z) < r && this.R() < 0.85) { q.stand = null; q.board = null; this._flee(q, x, z, 4.2 + this.R() * 1.2, 6 + this.R() * 4); }
    }
  }

  // one frame of a pedestrian fighting the player (this.foe: { x, z, alive }). Returns 'move' | 'still' | 'gone'
  _fight(p, dt) {
    const F = p.fight, foe = this.foe;
    F.t += dt;
    if (!foe || !foe.alive || Math.hypot(foe.x - F.x, foe.z - F.z) > 30 || F.t > 60) { this._flee(p, foe?.x ?? F.x, foe?.z ?? F.z, 3.2, 6); p.x = F.x; p.z = F.z; return 'move'; }
    const dx = foe.x - F.x, dz = foe.z - F.z, d = Math.hypot(dx, dz) || 1;
    p.yaw = Math.atan2(dx, dz);
    let mv = 'still';
    if (p.stagger > 0) { p.stagger -= dt; F.x += p.svx * dt; F.z += p.svz * dt; p.svx *= 1 - dt * 5; p.svz *= 1 - dt * 5; F.sp = 0; }
    else if (F.swing) {
      // a punch on its way: lands at its moment if the player is still in reach
      F.swing.t += dt;
      if (!F.swing.done && F.swing.t >= F.swing.at) {
        F.swing.done = true;
        if (d < 1.45) this.onHitFoe?.(F.swing.dmg, F.x, F.z, F.swing.kind);
      }
      if (F.swing.t >= F.swing.len) F.swing = null;
    } else if (d > 1.15) {
      // close in (jogging when far)
      F.sp = d > 4 ? 3.6 : 1.6;
      F.x += dx / d * F.sp * dt; F.z += dz / d * F.sp * dt; mv = 'move';
    } else {
      // in range: circle a step, then swing
      F.cd -= dt;
      F.sp = 0.6;
      F.x += (dz / d) * F.strafe * 0.6 * dt; F.z += (-dx / d) * F.strafe * 0.6 * dt; mv = 'move';
      if (F.cd <= 0) {
        const kind = this.R() < 0.6 ? 'jab' : 'cross';
        F.swing = { kind, t: 0, at: kind === 'jab' ? 0.2 : 0.3, len: kind === 'jab' ? 0.55 : 0.7, dmg: kind === 'jab' ? 6 : 10, done: false };
        F.cd = 0.9 + this.R() * 1.1;
        if (this.R() < 0.3) F.strafe *= -1;
        if (p.human) p.human.play(kind, { rate: 1.25, fade: 0.06 });
      }
    }
    if (d < 0.7) { F.x -= dx / d * (0.7 - d); F.z -= dz / d * (0.7 - d); } // don't stand inside the player
    p.x = F.x; p.z = F.z;
    return mv;
  }

  count() { return this.peds.length; }
}
