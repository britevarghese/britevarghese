// TrafficManager: lightweight civilian traffic AI on the lane graph. Intelligent-driver-model
// car following, traffic lights, turns, lane changes, reaction to the player (brake, honk,
// get knocked), distance-based spawning/despawning and simplified far-traffic updates.
import * as THREE from 'three';
import { LaneGraph } from './LaneGraph.js';
import { clamp, lerp, rng } from '../core/util.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { obbOverlap } from '../physics/Collision.js';
import { bus } from '../core/EventBus.js';

const TYPE_SPECS = {
  sedan: { w: 1.84, l: 4.7, mass: 1450, weight: 44 },
  suv: { w: 1.95, l: 4.8, mass: 1900, weight: 24 },
  van: { w: 2.02, l: 5.3, mass: 2300, weight: 13 },
  truck: { w: 2.3, l: 7.4, mass: 7500, weight: 10, bigRoads: true },
  bus: { w: 2.55, l: 11.5, mass: 11000, weight: 7, bigRoads: true },
};
export const TRAFFIC_COLORS = [0x9aa0a8, 0x2a2d33, 0xe8e8e6, 0x5a1a1a, 0x1c2e4a, 0x3a3f36, 0xb8b0a0, 0x6a6e74, 0x0e0f11, 0x8a2a1a, 0x2a4a6a, 0xd8d0c0];
const BUS_COLORS = [0xd8b020, 0x2a6ab0, 0xe0e0e0];

const tmp = {};

class TrafficCar {
  constructor(id, type, color) {
    this.id = id; this.type = type;
    const sp = TYPE_SPECS[type];
    this.spec = sp;
    this.color = new THREE.Color(color);
    this.path = null; this.s = 0; this.v = 0; this.brake = 0; this.spin = 0;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.lat = 0;          // lateral offset (lane change blend)
    this.state = 'drive';  // drive | knocked | wreck
    this.next = null;
    this.speedFactor = 0.85 + Math.random() * 0.25;
    this.honk = 0; this.laneChangeCD = 3 + Math.random() * 5;
    this.knockT = 0; this.nearMissDone = false;
    // proxy for impulse resolution with VehiclePhysics.resolvePair
    this.s2 = { x: 0, z: 0, vx: 0, vz: 0, yawRate: 0, damage: 0, yaw: 0 };
    this.p = { mass: sp.mass, inertia: sp.mass * (sp.l * sp.l + sp.w * sp.w) / 12, hx: sp.w / 2, hz: sp.l / 2 };
  }
  get s_() { return this.s2; }
  obb() { return { cx: this.x, cz: this.z, hx: this.p.hx * 0.95, hz: this.p.hz * 0.97, cos: Math.cos(this.yaw), sin: Math.sin(this.yaw) }; }
}

export class TrafficManager {
  constructor(world, preset, renderer) {
    this.world = world;
    this.graph = new LaneGraph(world.layout);
    this.cars = [];
    this.preset = preset;
    this.renderer = renderer; // TrafficRenderer (optional)
    this.R = rng(777);
    this.nextId = 1;
    this.frame = 0;
    this.enabled = true;
    this.density = 1;
    this.renderList = [];
  }

  setRenderer(r) { this.renderer = r; }
  get maxCars() { return Math.round(this.preset.traffic * this.density); }

  pickType(lane) {
    const R = this.R;
    let total = 0;
    const types = Object.entries(TYPE_SPECS).filter(([, s]) => !s.bigRoads || lane.edge.type.lanes > 1);
    for (const [, s] of types) total += s.weight;
    let r = R() * total;
    for (const [t, s] of types) { r -= s.weight; if (r <= 0) return t; }
    return 'sedan';
  }

  spawnNear(px, pz, rMin, rMax, forward) {
    const R = this.R;
    const lanes = this.graph.lanesNear(px, pz, rMin, rMax);
    if (!lanes.length) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const lane = lanes[Math.floor(R() * lanes.length)];
      const s = R() * lane.length;
      lane.sample(s, tmp);
      const d = Math.hypot(tmp.x - px, tmp.z - pz);
      if (d < rMin || d > rMax) continue;
      // avoid spawning right in front of the camera view if close
      if (forward && d < rMin + 40) { const dot = ((tmp.x - px) * forward.x + (tmp.z - pz) * forward.z) / d; if (dot > 0.5) continue; }
      if (lane.cars.some((c) => Math.abs(c.s - s) < 14)) continue;
      const type = this.pickType(lane);
      const color = type === 'bus' ? BUS_COLORS[Math.floor(R() * 3)] : TRAFFIC_COLORS[Math.floor(R() * TRAFFIC_COLORS.length)];
      const car = new TrafficCar(this.nextId++, type, color);
      car.path = lane; car.s = s; car.v = lane.speed * 0.7;
      lane.cars.push(car);
      this._place(car);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  _place(car) {
    car.path.sample(car.s, tmp);
    const rx = -tmp.dz, rz = tmp.dx;
    car.x = tmp.x + rx * car.lat; car.z = tmp.z + rz * car.lat;
    car.yaw = Math.atan2(tmp.dx, tmp.dz);
    car.y = this.world.layout.groundHeight(car.x, car.z) * 0; // traffic stays on the road surface
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    if (car.path) { const j = car.path.cars.indexOf(car); if (j >= 0) car.path.cars.splice(j, 1); }
  }

  clear() { for (const c of [...this.cars]) this.remove(c); }

  // dynamic: [{physics, id}] vehicles (player, police, racers) that traffic reacts/collides with
  update(dt, focus, forward, dynamic, playerVehicle) {
    this.frame++;
    if (!this.enabled) { this.renderList.length = 0; this.renderer?.update([], this.camera, 0); return; }
    const R = this.R;
    // spawn / despawn
    const max = this.maxCars;
    for (let k = 0; k < 3 && this.cars.length < max; k++) this.spawnNear(focus.x, focus.z, this.cars.length < max * 0.5 ? 50 : 90, 260, forward);
    for (const c of [...this.cars]) {
      const d = Math.hypot(c.x - focus.x, c.z - focus.z);
      c.dist = d;
      if (d > 330 || (c.state === 'wreck' && d > 120) || this.cars.length > max + 4 && d > 200) this.remove(c);
    }
    // sort occupancy
    for (const c of this.cars) if (c.path) c.path._sorted = false;
    for (const c of this.cars) if (c.path && !c.path._sorted) { c.path.cars.sort((a, b) => a.s - b.s); c.path._sorted = true; }

    for (const c of this.cars) {
      if (c.state !== 'drive') { this._knocked(c, dt); continue; }
      // far cars update at lower rate
      const far = c.dist > 150;
      if (far && (this.frame + c.id) % 3 !== 0) { this._advance(c, c.v * dt); continue; }
      const step = far ? dt * 3 : dt;
      this._drive(c, step, dynamic);
    }
    // collisions with dynamic vehicles
    for (const v of dynamic) {
      const vs = v.physics.s;
      for (const c of this.cars) {
        if (Math.abs(c.x - vs.x) > 9 || Math.abs(c.z - vs.z) > 9) continue;
        const hit = this._collide(v, c);
        if (hit && v === playerVehicle) bus.emit('traffic:hit', { car: c, ...hit });
        // near miss (player only)
        if (!hit && v === playerVehicle && !c.nearMissDone && c.state === 'drive') {
          const dx = c.x - vs.x, dz = c.z - vs.z, d = Math.hypot(dx, dz);
          const sp = Math.hypot(vs.vx, vs.vz);
          if (d < 3.4 + c.spec.w * 0.5 && sp > 22) { c.nearMissDone = true; bus.emit('traffic:nearMiss', { car: c, speed: sp }); }
        }
      }
    }
    // build render list
    const list = this.renderList;
    list.length = 0;
    for (const c of this.cars) {
      c.spin += (c.state === 'drive' ? c.v : Math.hypot(c.s2.vx, c.s2.vz)) * dt / 0.34;
      c.lod = c.dist < this.preset.carLod1Distance ? 0 : 1;
      list.push(c);
    }
  }

  _advance(c, ds) {
    c.s += ds;
    while (c.s > c.path.length) {
      c.s -= c.path.length;
      const nxt = c.next || this._chooseNext(c.path);
      c.next = null;
      if (!nxt) { c.s = c.path.length; c.v = 0; break; }
      const i = c.path.cars.indexOf(c); if (i >= 0) c.path.cars.splice(i, 1);
      c.path = nxt; nxt.cars.push(c);
      c.nearMissDone = false;
    }
    this._place(c);
  }

  _chooseNext(path) {
    const opts = path.next;
    if (!opts.length) return null;
    if (opts.length === 1) return opts[0];
    const R = this.R;
    let total = 0;
    const w = opts.map((o) => { const x = o.turn === 'straight' ? 3 : o.turn === 'uturn' ? 0.05 : o.kind === 'lane' ? 1 : 1; total += x; return x; });
    let r = R() * total;
    for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  }

  _drive(c, dt, dynamic) {
    const path = c.path;
    if (!c.next && path.kind === 'lane' && path.length - c.s < 40) c.next = this._chooseNext(path);
    // --- leader search ---
    let gap = 1e9, leadV = 0;
    const cars = path.cars;
    for (const o of cars) if (o !== c && o.s > c.s && o.s - c.s < gap) { gap = o.s - c.s - (o.spec.l + c.spec.l) / 2; leadV = o.state === 'drive' ? o.v : 0; }
    if (gap > 1e8 && c.next) {
      for (const o of c.next.cars) {
        const g = path.length - c.s + o.s - (o.spec.l + c.spec.l) / 2;
        if (g < gap) { gap = g; leadV = o.state === 'drive' ? o.v : 0; }
      }
      // look one more step (connector -> lane)
      if (c.next.kind === 'connector' && c.next.next[0]) for (const o of c.next.next[0].cars) {
        const g = path.length - c.s + c.next.length + o.s - (o.spec.l + c.spec.l) / 2;
        if (g < gap) { gap = g; leadV = o.state === 'drive' ? o.v : 0; }
      }
    }
    // dynamic obstacles (player/police/racers) in front
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    for (const v of dynamic) {
      const s = v.physics.s;
      const dx = s.x - c.x, dz = s.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 35) continue;
      const lat = Math.abs(-dx * fz + dz * fx);
      if (lat > 2.6) continue;
      const g = ahead - (c.spec.l / 2 + 2.4);
      if (g < gap) { gap = g; leadV = Math.max(0, s.vx * fx + s.vz * fz); }
      if (g < 8 && c.honk <= 0 && Math.hypot(s.vx, s.vz) < 3) { c.honk = 6; bus.emit('traffic:honk', { x: c.x, z: c.z }); }
    }
    for (const o of this.cars) {
      // cars knocked into our lane / wrecks
      if (o === c || o.state === 'drive') continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 30) continue;
      if (Math.abs(-dx * fz + dz * fx) > 2.4) continue;
      const g = ahead - (c.spec.l + o.spec.l) / 2;
      if (g < gap) { gap = g; leadV = 0; }
    }
    c.honk -= dt;
    // --- traffic signal ---
    if (path.kind === 'lane' && path.signal) {
      const st = this.world.signalState(path.to, path.axis);
      const distToStop = path.length - c.s - 1;
      const canStop = c.v * c.v / (2 * 4.5) < distToStop + 2;
      if ((st === 'red' || (st === 'yellow' && canStop)) && distToStop > -1) {
        if (distToStop < gap) { gap = distToStop; leadV = 0; }
      }
    }
    // --- IDM ---
    let v0 = path.speed * c.speedFactor;
    if (path.kind === 'connector' && path.turn !== 'straight') v0 = Math.min(v0, 7.5);
    if (c.next && c.next.kind === 'connector' && c.next.turn !== 'straight') {
      const d = path.length - c.s;
      v0 = Math.min(v0, Math.sqrt(7.5 * 7.5 + 2 * 3 * Math.max(0, d)));
    }
    const a = 2.2, b = 3.5, s0 = 2.2, T = 1.3;
    const dv = c.v - leadV;
    const sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(a * b)));
    const g = Math.max(0.1, gap);
    let acc = a * (1 - Math.pow(c.v / Math.max(v0, 0.1), 4) - (sStar / g) ** 2);
    acc = clamp(acc, -9, a);
    c.v = Math.max(0, c.v + acc * dt);
    if (gap < 0.3) c.v = Math.min(c.v, 0.5);
    c.brake = acc < -0.8 || c.v < 0.3 ? 1 : 0;
    // --- lane changes on multi-lane edges ---
    c.laneChangeCD -= dt;
    if (path.kind === 'lane' && path.siblings?.length && c.laneChangeCD < 0 && gap < 25 && leadV < c.v * 0.9 + 1 && path.length - c.s > 40 && c.s > 10) {
      const target = path.siblings[Math.floor(this.R() * path.siblings.length)];
      const ns = c.s * target.length / path.length;
      const free = !target.cars.some((o) => Math.abs(o.s - ns) < 16);
      if (free) {
        path.sample(c.s, tmp); const ox = tmp.x, oz = tmp.z;
        target.sample(ns, tmp);
        const rx = -tmp.dz, rz = tmp.dx;
        c.lat = (ox - tmp.x) * rx + (oz - tmp.z) * rz + c.lat;
        const i = path.cars.indexOf(c); if (i >= 0) path.cars.splice(i, 1);
        c.path = target; c.s = ns; target.cars.push(c); c.next = null;
        c.laneChangeCD = 6 + this.R() * 8;
      } else c.laneChangeCD = 1.5;
    }
    c.lat = lerp(c.lat, 0, 1 - Math.exp(-dt * 1.3));
    this._advance(c, c.v * dt);
    // gentle body pitch on braking
    c.pitch = lerp(c.pitch, c.brake && c.v > 2 ? -0.02 : 0, 0.1);
  }

  _collide(v, c) {
    const A = v.physics;
    // sync proxy state from traffic car
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    if (c.state === 'drive') { c.s2.vx = fx * c.v; c.s2.vz = fz * c.v; c.s2.yawRate = 0; }
    c.s2.x = c.x; c.s2.z = c.z;
    const proxy = { s: c.s2, p: c.p, obb: () => c.obb() };
    const res = VehiclePhysics.resolvePair(A, proxy);
    if (!res || !res.impact) return null;
    c.x = c.s2.x; c.z = c.s2.z;
    if (res.impact > 1.5 || c.state !== 'drive') {
      if (c.state === 'drive') { const i = c.path.cars.indexOf(c); if (i >= 0) c.path.cars.splice(i, 1); }
      c.state = 'knocked'; c.knockT = 0; c.brake = 1;
    }
    return res;
  }

  _knocked(c, dt) {
    const s = c.s2;
    c.knockT += dt;
    s.x = c.x; s.z = c.z;
    c.x += s.vx * dt; c.z += s.vz * dt;
    c.yaw += s.yawRate * dt;
    const f = Math.exp(-dt * 1.6);
    s.vx *= f; s.vz *= f; s.yawRate *= Math.exp(-dt * 2);
    // static collisions for knocked cars (buildings, poles)
    const col = this.world.collision.query(c.x - 6, c.z - 6, c.x + 6, c.z + 6, []);
    const box = c.obb();
    for (const k of col) {
      const h = obbOverlap(box, k);
      if (!h) continue;
      c.x += h.nx * h.depth; c.z += h.nz * h.depth;
      const vn = s.vx * h.nx + s.vz * h.nz;
      if (vn < 0) { s.vx -= 1.3 * vn * h.nx; s.vz -= 1.3 * vn * h.nz; }
      box.cx = c.x; box.cz = c.z;
    }
    if (c.knockT > 2.5 && Math.hypot(s.vx, s.vz) < 0.5) c.state = 'wreck';
    if (c.state === 'wreck' && c.knockT > 14) {
      // try to rejoin traffic if the car is still near a lane and roughly aligned
      const near = this.graph.nearest(c.x, c.z);
      if (near && near.dist < 2 && !near.lane.cars.some((o) => Math.abs(o.s - near.s) < 10)) {
        c.path = near.lane; c.s = near.s; c.v = 0; c.state = 'drive'; c.lat = 0; near.lane.cars.push(c);
      }
    }
  }

  count() { return this.cars.length; }
}
