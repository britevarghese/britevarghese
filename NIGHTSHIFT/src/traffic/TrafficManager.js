// TrafficManager: lightweight civilian traffic AI on the lane graph. Intelligent-driver-model
// car following, traffic lights, turns, lane changes, reaction to the player (brake, honk,
// get knocked), distance-based spawning/despawning and simplified far-traffic updates.
import * as THREE from 'three';
import { LaneGraph } from './LaneGraph.js';
import { clamp, lerp, rng } from '../core/util.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { obbOverlap } from '../physics/Collision.js';
import { bus } from '../core/EventBus.js';
import { TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';

export const TYPE_SPECS = {
  sedan: { w: 1.84, l: 4.88, mass: 1500, weight: 30 },
  hatch: { w: 1.75, l: 4.05, mass: 1150, weight: 20, needs: 'hatch' },
  suv: { w: 1.93, l: 4.82, mass: 2400, weight: 22 },
  van: { w: 1.99, l: 5.9, mass: 2500, weight: 13 },
  truck: { w: 2.1, l: 7.0, mass: 7500, weight: 10, bigRoads: true },
  bus: { w: 2.55, l: 11.5, mass: 11000, weight: 7, bigRoads: true },
  // Kerala (kl): autorickshaws everywhere, Marutis, SUVs, Tata Aces, lorries, KSRTC and private buses
  auto: { w: 1.3, l: 2.64, mass: 450, weight: 30, kl: true, livery: true },
  m800: { w: 1.44, l: 3.34, mass: 700, weight: 9, kl: true },
  dzire: { w: 1.735, l: 3.995, mass: 1000, weight: 16, kl: true },
  brezza: { w: 1.79, l: 3.995, mass: 1250, weight: 10, kl: true },
  ertiga: { w: 1.735, l: 4.395, mass: 1200, weight: 8, kl: true },
  scorpio: { w: 1.92, l: 4.66, mass: 1900, weight: 7, kl: true },
  thar: { w: 1.82, l: 3.985, mass: 1700, weight: 4, kl: true },
  minitruck: { w: 1.5, l: 3.8, mass: 1100, weight: 7, kl: true },
  bolero: { w: 1.745, l: 3.995, mass: 1615, weight: 7, kl: true },
  // two-wheelers: ride by the kerb, filter past slow traffic, lean into the bends
  scooter: { w: 0.75, l: 1.85, mass: 190, weight: 24, kl: true, bike: true, livery: true },
  commuter: { w: 0.78, l: 2.04, mass: 210, weight: 20, kl: true, bike: true, colors: [0x1a1a1a, 0xb01818, 0x1a3a8a, 0x6a6a6a, 0xe8e8e8] },
  bullet: { w: 0.8, l: 2.15, mass: 195, weight: 8, kl: true, bike: true, livery: true },
  streetbike: { w: 0.78, l: 2.0, mass: 210, weight: 10, kl: true, bike: true, colors: [0x1a1a1a, 0x2a4a8a, 0xb01818, 0x3a6a3a] },
  lorry: { w: 2.5, l: 8.6, mass: 9000, weight: 5, kl: true, bigRoads: true, colors: [0xffffff] },   // (its own hand-painted colours)
  ksrtc: { bus: true, w: 2.5, l: 10.8, mass: 11000, weight: 5, kl: true, bigRoads: true, livery: true },
  pvtbus: { bus: true, w: 2.4, l: 9.5, mass: 10000, weight: 7, kl: true, bigRoads: true, colors: [0xffffff] },
  pvtbus2: { bus: true, w: 2.5, l: 10.6, mass: 10500, weight: 0, kl: true, bigRoads: true, colors: [0x1f6fd0, 0xc81e1e, 0x1a9a4a, 0xf0f0f0, 0xe07a10, 0x7a2ab0, 0xe8c020] },   // (its model's front end is broken: kept out of the traffic)
};
export const TRAFFIC_COLORS = [0x9aa0a8, 0x2a2d33, 0xe8e8e6, 0x5a1a1a, 0x1c2e4a, 0x3a3f36, 0xb8b0a0, 0x6a6e74, 0x0e0f11, 0x8a2a1a, 0x2a4a6a, 0xd8d0c0];
const _dir = new THREE.Vector3(), _pa = { x: 0, z: 0 }, _pb = { x: 0, z: 0 };
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
    this.speedFactor = (sp.bike ? 1.0 : 0.85) + Math.random() * 0.25;
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
    this.graph = world.kerala ? world.lanes : new LaneGraph(world.layout); // Kerala: lanes stream with the map tiles
    this.cars = [];
    this.preset = preset;
    this.renderer = renderer; // TrafficRenderer (optional)
    this.R = rng(777);
    this.nextId = 1;
    this.frame = 0;
    this.enabled = true;
    this.density = 1;
    this.renderList = [];
    // multiplayer: other players whose traffic we simulate too ({x, z}), and, when another player's game
    // runs the shared traffic, a source of their cars (then we only render them)
    this.foci = [];
    this.remote = null;
  }

  setRenderer(r) { this.renderer = r; }
  get maxCars() { return Math.round(this.preset.traffic * this.density * Math.min(1.8, 1 + 0.45 * this.foci.length)); }

  pickType(lane) {
    const R = this.R;
    let total = 0;
    const kl = !!this.world.kerala;
    const big = lane.edge.cls !== undefined ? lane.edge.cls <= 4 : lane.edge.type.lanes > 1;
    const types = Object.entries(TYPE_SPECS).filter(([t, s]) => !!s.kl === kl && (!s.bigRoads || big) && (!(s.needs || s.kl) || this.renderer?.types?.[t]));
    for (const [, s] of types) total += s.weight;
    let r = R() * total;
    for (const [t, s] of types) { r -= s.weight; if (r <= 0) return t; }
    return this.world.kerala ? 'auto' : 'sedan';
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
      const sp = TYPE_SPECS[type], color = sp.livery ? 0xffffff : sp.colors ? sp.colors[Math.floor(R() * sp.colors.length)] : type === 'bus' ? BUS_COLORS[Math.floor(R() * 3)] : TRAFFIC_COLORS[Math.floor(R() * TRAFFIC_COLORS.length)];
      const car = new TrafficCar(this.nextId++, type, color);
      car.path = lane; car.s = s; car.v = lane.speed * 0.7;
      lane.cars.push(car);
      this._place(car);
      this.cars.push(car);
      return car;
    }
    return null;
  }

  _spawnParked(focus) {
    const R = this.R;
    const lanes = this.graph.lanesNear(focus.x, focus.z, 60, 220).filter((l) => l.kind === 'lane' && l.laneIndex === 0 && (l.edge.cls ?? 0) >= 4 && l.length > 25);
    if (!lanes.length) return;
    const lane = lanes[Math.floor(R() * lanes.length)], s = 6 + R() * (lane.length - 12);
    if (lane.cars.some((o) => Math.abs(o.s - s) < 10)) return;
    const pool = ['m800', 'dzire', 'brezza', 'ertiga', 'scorpio', 'thar', 'bolero', 'minitruck', 'auto', 'scooter', 'commuter'].filter((t) => this.renderer?.types?.[t]);
    if (!pool.length) return;
    const type = pool[Math.floor(R() * pool.length)], sp = TYPE_SPECS[type];
    const color = sp.livery ? 0xffffff : sp.colors ? sp.colors[Math.floor(R() * sp.colors.length)] : TRAFFIC_COLORS[Math.floor(R() * TRAFFIC_COLORS.length)];
    const car = new TrafficCar(this.nextId++, type, color);
    car.path = lane; car.s = s; car.v = 0; car.state = 'parked'; car.parked = true; car.brake = 0;
    car.lat = -(1.15 + R() * 0.5) - (sp.bike ? 0.4 : 0); // half up on the verge
    lane.cars.push(car);
    this._place(car);
    car.yaw += (R() - 0.5) * 0.12;
    this.cars.push(car);
  }

  _place(car) {
    car.path.sample(car.s, tmp);
    const rx = -tmp.dz, rz = tmp.dx;
    car.x = tmp.x + rx * car.lat; car.z = tmp.z + rz * car.lat;
    car.yaw = Math.atan2(tmp.dx, tmp.dz);
    if (this.world.kerala) {
      // the streamed terrain has hills: ride on it, nose up / down with the slope
      const L = car.spec.l * 0.45, fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), y0 = car.placed ? car.y : undefined, gh = (x, z) => this.world.layout.groundHeight(x, z, y0);
      const hf = gh(car.x + fx * L, car.z + fz * L), hr = gh(car.x - fx * L, car.z - fz * L);
      car.y = (hf + hr) / 2 + 0.01; // (ground height already includes the road surface)
      car.slope = Math.atan2(hf - hr, 2 * L);
      car.placed = true;
    } else car.y = 0; // Port Halvern: traffic stays on the flat road surface
  }

  _inView(c) {
    const cam = this.camera;
    if (!cam) return false;
    const dx = c.x - cam.position.x, dz = c.z - cam.position.z, d = Math.hypot(dx, dz) || 1;
    cam.getWorldDirection(_dir);
    return d < 60 || (dx * _dir.x + dz * _dir.z) / d > 0.55;
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
    if (this.remote) { this._follow(focus); return; }
    const R = this.R;
    // spawn / despawn (around us and around the other players whose traffic we run)
    const max = this.maxCars, foci = this.foci;
    for (let k = 0; k < 3 && this.cars.length < max; k++) {
      const f = foci.length && (this.frame + k) % (foci.length + 1) ? foci[(this.frame + k) % (foci.length + 1) - 1] : focus;
      this.spawnNear(f.x, f.z, this.cars.length < max * 0.5 ? 45 : 80, 240, f === focus ? forward : null);
    }
    // cars parked half on the road along town and village streets (Kerala has few car parks)
    if (this.world.kerala && this.frame % 20 === 0 && this.cars.filter((c) => c.state === 'parked').length < (this.preset.traffic > 20 ? 10 : 5)) this._spawnParked(focus);
    for (const c of [...this.cars]) {
      const d = Math.hypot(c.x - focus.x, c.z - focus.z);
      c.dist = d;
      let dm = d;
      for (const f of foci) dm = Math.min(dm, Math.hypot(c.x - f.x, c.z - f.z));
      // cars left well behind are recycled so the budget stays around (and ahead of) the player
      const behind = forward && dm === d && d > 150 && ((c.x - focus.x) * forward.x + (c.z - focus.z) * forward.z) / d < -0.4 && this.cars.length >= max * 0.8;
      if (c.incident) continue; // an accident scene stays until it is cleared
      // gridlock relief: a car stuck for a long while out of the player's sight quietly goes (another spawns)
      if (c.state === 'drive') { c.stuckT = c.v < 0.3 && !c.dwell ? (c.stuckT || 0) + dt : 0; if (c.stuckT > 25 && dm > 45 && !this._inView(c)) { this.remove(c); continue; } }
      if (c.path?.dead || dm > 310 || behind || (c.state === 'wreck' && dm > 120) || this.cars.length > max + 4 && dm > 200 || (this.cars.length > max + 2 && dm > 110 && c.state === 'drive' && !this._inView(c))) this.remove(c);  // (the roads empty out as night falls)
    }
    // sort occupancy
    for (const c of this.cars) if (c.path) c.path._sorted = false;
    for (const c of this.cars) if (c.path && !c.path._sorted) { c.path.cars.sort((a, b) => a.s - b.s); c.path._sorted = true; }

    for (const c of this.cars) {
      if (c.state === 'parked') continue;
      if (c.state !== 'drive') { this._knocked(c, dt); continue; }
      // far cars update at lower rate
      const far = c.dist > 150;
      if (far && (this.frame + c.id) % 3 !== 0) { this._advance(c, c.v * dt); continue; }
      const step = far ? dt * 3 : dt;
      this._drive(c, step, dynamic);
    }
    // physics-driven traffic doesn't pass through itself either
    const PH = this.cars.filter((c) => c.phys && c.state === 'drive');
    for (let i = 0; i < PH.length; i++) for (let j = i + 1; j < PH.length; j++) {
      const a = PH[i], b = PH[j];
      const r = (a.spec.l + b.spec.l) / 2 + 1;   // (a bus and a car can touch with their centres 8 m and more apart)
      if (Math.abs(a.x - b.x) > r || Math.abs(a.z - b.z) > r) continue;
      if (VehiclePhysics.resolvePair(a.phys, b.phys)) for (const c of [a, b]) { c.x = c.phys.s.x; c.z = c.phys.s.z; c.yaw = c.phys.s.yaw; }
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
    // only the nearest few cars get the full-detail model (the rest would cost tens of thousands of triangles each)
    const cap = this.preset.carLod0Max ?? 6;
    if (list.length > cap) {
      let n = 0;
      for (const c of [...list].sort((a, b) => a.dist - b.dist)) if (c.lod === 0 && ++n > cap) c.lod = 1;
    }
  }

  _advance(c, ds, place = true) {
    c.s += ds;
    while (c.s > c.path.length) {
      c.s -= c.path.length;
      if (c.next?.dead) c.next = null;
      const nxt = c.next || this._chooseNext(c.path);
      c.next = null;
      if (!nxt) { c.s = c.path.length; c.v = 0; break; }
      const i = c.path.cars.indexOf(c); if (i >= 0) c.path.cars.splice(i, 1);
      c.path = nxt; nxt.cars.push(c);
      c.nearMissDone = false;
    }
    if (place) this._place(c);
  }

  // A point `ahead` metres further along the car's way (into the next path when this one ends), with its lane offset
  _pointAhead(c, ahead, out) {
    let path = c.path, s = c.s + ahead;
    if (s > path.length) {
      if (!c.next) c.next = this._chooseNext(path);
      if (c.next) { s -= path.length; path = c.next; if (s > path.length && path.next?.[0]) { s -= path.length; path = path.next[0]; } }
      s = Math.min(s, path.length);
    }
    path.sample(s, tmp);
    out.x = tmp.x - tmp.dz * c.lat; out.z = tmp.z + tmp.dx * c.lat;
    return out;
  }

  // Near the player, a car drives on the same vehicle physics as the player's (suspension, weight transfer, body
  // roll, tyre grip, the ground and walls), steered by a driver aiming at a point ahead on its lane; the traffic
  // logic still decides how fast it should go and still tracks its progress along the lane.
  _physDrive(c, dt, vDes) {
    const TV = TRAFFIC_VEHICLES[c.type];
    if (!c.phys) {
      const P = new VehiclePhysics({ ...TV.params }, this.world);
      P.place(c.x, c.z, c.yaw, c.y);
      P.s.vx = Math.sin(c.yaw) * c.v; P.s.vz = Math.cos(c.yaw) * c.v;
      c.phys = P; c.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false }; c.pacc = 0;
    }
    const P = c.phys, s = P.s, k = c.ctl;
    // progress along the lane: the forward part of the real velocity
    c.path.sample(c.s, tmp);
    const along = s.vx * tmp.dx + s.vz * tmp.dz;
    this._advance(c, Math.max(0, along) * dt, false);
    // steer at a point ahead (further at speed), like a driver looking down the road
    const sp = Math.hypot(s.vx, s.vz), T = this._pointAhead(c, 3.2 + sp * 0.55, _pa);
    let diff = Math.atan2(T.x - s.x, T.z - s.z) - s.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    k.steer = clamp(-diff * 2.4, -1, 1);
    // speed: the acceleration the traffic logic asks for (computed from the real speed), by throttle and brake
    const acc = c.acc || 0;
    k.throttle = acc > 0.05 ? clamp(0.2 + acc / 2.2 * 0.8, 0, 1) : 0;
    k.brake = acc < -0.3 ? clamp(-acc / 7, 0.12, 1) : 0;
    if (c.gapNow < 0.6) { k.throttle = 0; k.brake = 1; }
    k.handbrake = 0;
    if (vDes < 0.3 && sp < 0.8 && acc <= 0.05) { k.throttle = 0; k.brake = 0; k.handbrake = 1; }  // held at a stop (braking there would reverse)
    c.pacc = Math.min(c.pacc + dt, 0.1);
    while (c.pacc >= 1 / 60) { P.step(1 / 60, k); c.pacc -= 1 / 60; }
    P.events.length = 0;
    c.x = s.x; c.z = s.z; c.y = s.y; c.yaw = s.yaw; c.pitch = s.pitch; c.roll = s.roll;
    c.steer = s.wheelSteer ?? k.steer * 0.5;
    c.brake = k.brake > 0.1 || k.handbrake ? 1 : 0;
    c.v = sp;
    // leash: a car pushed far off its lane (by a crash) goes back to the traffic model there
    c.path.sample(c.s, tmp);
    if (Math.hypot(tmp.x - tmp.dz * c.lat - s.x, tmp.z + tmp.dx * c.lat - s.z) > 4.5) c.phys = null;
  }

  // A two-wheeler near the player rides like one: it steers (pure pursuit) at a point ahead on its line, its turn
  // rate limited by how far it can lean, so it takes corners in smooth arcs and leans with the real turn
  // (tan(lean) = v * yawRate / g), sways upright as it slows, and puts a foot down (tipped onto it) when stopped.
  _bikeDrive(c, dt) {
    if (!c.bk) { this._place(c); c.bk = { x: c.x, z: c.z, yaw: c.yaw, yr: 0 }; }
    const B = c.bk, v = c.v;
    const Ld = 2.2 + v * 0.45, T = this._pointAhead(c, Ld, _pa);
    let diff = Math.atan2(T.x - B.x, T.z - B.z) - B.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    const dist = Math.hypot(T.x - B.x, T.z - B.z) || Ld;
    const maxYr = Math.min(1.8, 9.81 * Math.tan(0.7) / Math.max(v, 0.5));
    const want = clamp(2 * v * Math.sin(diff) / dist, -maxYr, maxYr) + (v < 0.5 ? diff * 0.6 : 0);
    B.yr += (want - B.yr) * (1 - Math.exp(-dt * 7));       // the lean (and so the turn) takes a moment to build
    B.yaw += B.yr * dt;
    B.x += Math.sin(B.yaw) * v * dt; B.z += Math.cos(B.yaw) * v * dt;
    // its place on the lane follows the bike: up to where the rider now is along it (a lane position integrated
    // from the speed drifted ahead of or behind the bike, which then snapped), and always a little forward when
    // moving (so a rider sideways to a very short lane piece can't circle its own aiming point)
    c.path.sample(c.s, tmp);
    const ahead = (B.x - (tmp.x - tmp.dz * c.lat)) * tmp.dx + (B.z - (tmp.z + tmp.dx * c.lat)) * tmp.dz;
    this._advance(c, clamp(ahead, v > 1 ? 0.2 * v * dt : 0, v * dt * 2 + 0.3), false);
    // pushed far off its line (a shunt, a lane change into a gap): rejoin it
    this._place(c);
    if (Math.hypot(c.x - B.x, c.z - B.z) > 4.5) { B.x = c.x; B.z = c.z; B.yaw = c.yaw; B.yr = 0; }
    c.x = B.x; c.z = B.z; c.yaw = B.yaw;
    if (this.world.kerala) c.y = this.world.layout.groundHeight(c.x, c.z, c.y) + 0.01;
    c.pitch = lerp(c.pitch, c.slope || 0, 0.15);
    const lean = v < 0.6 ? -0.07 : -Math.atan(clamp(v * B.yr / 9.81, -0.9, 0.9));   // stopped: on the left foot
    c.roll = lerp(c.roll || 0, lean, 1 - Math.exp(-dt * (v < 0.6 ? 3 : 6)));
    c.footDown = v < 0.6;
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
    // stopped at the kerb (a bus at its stop, an auto dropping someone off): wait, then pull out
    if (c.dwell > 0) {
      c.dwell -= dt; c.v = Math.max(0, c.v - 6 * dt); c.brake = 1;
      c.lat = lerp(c.lat, c.latT || 0, 1 - Math.exp(-dt * 1.5));
      this._advance(c, c.v * dt);
      if (c.dwell <= 0) { c.pulled = false; c.latT = 0; c.dwell = 0; }
      return;
    }
    if (!c.next && path.kind === 'lane' && path.length - c.s < 40) c.next = this._chooseNext(path);
    // --- leader search ---
    let gap = 1e9, leadV = 0;
    const cars = path.cars;
    // two-wheelers keep to the kerb (left) and filter out past slower traffic, the way Kerala rides
    const bike = c.spec.bike;
    if (bike) {
      const lw = (path.edge?.type?.lanes ?? 1) > 0 ? 1 : 1;
      if (c.filterT > 0) c.filterT -= dt;
      c.latT = c.filterT > 0 ? 1.45 * lw : -0.85;
    }
    for (const o of cars) {
      if (o === c || o.s <= c.s || o.s - c.s >= gap) continue;
      // a bike filtering out (or riding by the kerb) slips past cars that leave it room
      if (bike && !o.spec.bike && o.state === 'drive') {
        const g0 = o.s - c.s - (o.spec.l + c.spec.l) / 2;
        if (c.filterT > 0 && g0 > -o.spec.l) continue;
        if (g0 < 18 && o.v < c.v + 0.5 && path.speed > 6) { c.filterT = 3 + this.R() * 2; continue; }
      }
      // pulled over at the kerb (a bus at its stop, an auto, a parked car): swing out round it
      if ((o.pulled || o.state === 'parked') && !c.pulled) {
        const g0 = o.s - c.s - (o.spec.l + c.spec.l) / 2;
        const need = o.spec.w / 2 + c.spec.w / 2 + 0.3 + (o.lat ?? 0);
        if (need < 2.4 && g0 < 25) { c.passT = 2; c.passLat = Math.max(c.passLat || 0, need); continue; }
      }
      // cars ease out round a bike riding by the kerb instead of queueing behind it
      if (!bike && o.spec.bike && (o.lat ?? 0) < -0.5 && o.state === 'drive') {
        const g0 = o.s - c.s - (o.spec.l + c.spec.l) / 2;
        if (g0 < 20) { c.passT = 1.5; continue; }
      }
      gap = o.s - c.s - (o.spec.l + c.spec.l) / 2; leadV = o.state === 'drive' ? o.v : 0;
    }
    if (c.passT > 0) c.passT -= dt; else c.passLat = 0;
    if (!bike && !c.pullAt && !(c.spec.bus && c.latT < 0 && path.stops)) c.latT = c.passT > 0 ? Math.max(0.6, c.passLat || 0) : 0;
    if (bike && c.passT > 0) c.latT = Math.max(c.latT, (c.passLat || 0) - 0.3);
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
    // any other traffic in front, whatever path it is on: cars crossing the junction from another road, merging,
    // turning across. Of two cars that see each other (nose to nose across a junction) only one gives way.
    const reach = 4 + c.v * 1.4 + c.spec.l / 2;
    for (const o of this.cars) {
      if (o === c || o.state !== 'drive' || o.path === path || o.path === c.next) continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      if (Math.abs(dx) > reach + 6 || Math.abs(dz) > reach + 6) continue;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > reach + o.spec.l / 2) continue;
      // how far across our line its body reaches (its own width and length, turned however it faces)
      const ofx = Math.sin(o.yaw), ofz = Math.cos(o.yaw), cosA = Math.abs(ofx * fx + ofz * fz);
      const half = (o.spec.w * cosA + o.spec.l * Math.sqrt(Math.max(0, 1 - cosA * cosA))) / 2;
      if (Math.abs(-dx * fz + dz * fx) > half + c.spec.w / 2 + 0.35) continue;
      if (ofx * fx + ofz * fz < -0.5) continue;          // oncoming traffic in its own lane
      // does it see us in front of it too? then the one further from the conflict (or the later id) waits
      const bAhead = -dx * ofx - dz * ofz;
      if (bAhead > 0 && bAhead < 4 + o.v * 1.4 + o.spec.l / 2 && Math.abs(dx * ofz - dz * ofx) < c.spec.w / 2 + o.spec.w / 2 + 1.5 && (bAhead > ahead || (Math.abs(bAhead - ahead) < 1 && c.id < o.id))) continue;
      const g = ahead - (c.spec.l / 2 + half);
      if (g < gap) { gap = Math.max(0.1, g); leadV = o.v * Math.max(0, ofx * fx + ofz * fz); }
    }
    for (const o of this.cars) {
      // cars knocked into our lane / wrecks
      if (o === c || o.state === 'drive' || o.state === 'parked') continue;
      const dx = o.x - c.x, dz = o.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 30) continue;
      if (Math.abs(-dx * fz + dz * fx) > 2.4) continue;
      const g = ahead - (c.spec.l + o.spec.l) / 2;
      if (g < gap) { gap = g; leadV = 0; }
    }
    c.honk -= dt;
    // --- buses call at the stops on their lane; autos pull over now and then in town ---
    if (c.spec.bus && path.stops && c.lastStop !== path) {
      for (const st of path.stops) {
        const d = st - c.s;
        if (d < -1 || d > 80) continue;
        if (d + 2 < gap) { gap = Math.max(0.1, d + 2); leadV = 0; c.latT = -1.1; }
        if (d < 3.2 && c.v < 1.2) { c.dwell = 8 + this.R() * 10; c.pulled = true; c.lastStop = path; bus.emit('traffic:busStop', { car: c, x: c.x, z: c.z }); }
      }
    }
    if (c.type === 'auto' && !c.pullAt && path.kind === 'lane' && (path.edge?.cls ?? 9) >= 2 && this.R() < dt * 0.03 && path.length - c.s > 40) c.pullAt = c.s + 18 + this.R() * 15;
    if (c.pullAt) {
      if (c.path !== c.pullPath && c.pullPath) c.pullAt = 0;
      c.pullPath = path;
      const d = c.pullAt - c.s;
      c.latT = -1.4;
      if (d + 2 < gap) { gap = Math.max(0.1, d + 2); leadV = 0; }
      if (d < 3.2 && c.v < 1.2) { c.dwell = 5 + this.R() * 14; c.pulled = true; c.pullAt = 0; c.pullPath = null; }
    }
    // --- people crossing in front ---
    for (const q of this.crossing || []) {
      const dx = q.x - c.x, dz = q.z - c.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0 || ahead > 30) continue;
      if (Math.abs(-dx * fz + dz * fx) > 2.6) continue;
      const g2 = ahead - c.spec.l / 2 - 2.2;
      if (g2 < gap) { gap = g2; leadV = 0; }
      if (g2 < 10 && c.honk <= 0 && this.R() < 0.3) { c.honk = 8; bus.emit('traffic:honk', { x: c.x, z: c.z }); }
    }
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
    // two-wheelers ease off for the bends and junction turns ahead (Kerala's lanes meet at the junction with a
    // kink, no connector): the path's heading every 4 m over the next ~45 m gives each bend's radius; a rider
    // leans into it at a comfortable ~2.8 m/s² and brakes for it in time
    if (bike && c.dist < 160) {
      let px = 0, pz = 0, ph = null;
      for (let i = 0, d = 0; d <= 44; i++, d += 4) {
        const P = this._pointAhead(c, d, _pb);
        if (i) {
          const sx = P.x - px, sz = P.z - pz, seg = Math.hypot(sx, sz);
          if (seg > 0.8) {
            const h = Math.atan2(sx, sz);
            if (ph !== null) {
              let dh = h - ph; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
              if (Math.abs(dh) > 0.06) {
                const vc = Math.max(3.6, Math.sqrt(2.8 * seg / Math.abs(dh)));
                v0 = Math.min(v0, Math.sqrt(vc * vc + 2 * 2.6 * Math.max(0, d - 6)));
              }
            }
            ph = h;
          }
        }
        px = P.x; pz = P.z;
      }
    }
    // heavy rain: everyone slows down and leaves more room
    const rain = this.rain || 0;
    v0 *= 1 - 0.3 * rain;
    // speed breakers: everyone crawls over them (bikes a little quicker)
    if (this.world.bumpAhead) {
      const bd = this.world.bumpAhead(c.x, c.z, Math.sin(c.yaw), Math.cos(c.yaw), 35);
      if (bd >= 0) v0 = Math.min(v0, Math.sqrt((c.spec.bike ? 4.5 : 3.2) ** 2 + 2 * 2.2 * bd));
    }
    const a = 2.2, b = 3.5, s0 = 2.2 + rain, T = 1.3 + rain * 0.7;
    const dv = c.v - leadV;
    const sStar = s0 + Math.max(0, c.v * T + c.v * dv / (2 * Math.sqrt(a * b)));
    const g = Math.max(0.1, gap);
    let acc = a * (1 - Math.pow(c.v / Math.max(v0, 0.1), 4) - (sStar / g) ** 2);
    acc = clamp(acc, -9, a);
    c.acc = acc; c.gapNow = gap;
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
    c.lat = lerp(c.lat, c.latT || 0, 1 - Math.exp(-dt * (c.spec.bike ? 2.2 : 1.3)));
    if (this.world.kerala && !c.spec.bike && c.dist < 70 && TRAFFIC_VEHICLES[c.type]?.params) { this._physDrive(c, dt, c.v); c.prevYaw = c.yaw; return; }
    if (c.phys) { c.phys = null; }            // left the player's surroundings: back on the lane
    if (c.spec.bike && c.dist < 160) { this._bikeDrive(c, dt); c.prevYaw = c.yaw; return; }
    c.bk = null;
    this._advance(c, c.v * dt);
    // gentle body pitch on braking
    c.pitch = lerp(c.pitch, (c.brake && c.v > 2 ? -0.02 : 0) + (c.slope || 0), 0.15);
    if (c.spec.bike) {
      // lean into the bend: tan(lean) = v * yawRate / g (yaw grows turning left; leaning left is -roll)
      let dy = c.yaw - (c.prevYaw ?? c.yaw); while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      const lean = -Math.atan(clamp(c.v * (dy / Math.max(dt, 1e-3)) / 9.81, -0.9, 0.9));
      c.roll = lerp(c.roll || 0, lean, 1 - Math.exp(-dt * 6));
    }
    c.prevYaw = c.yaw;
  }

  _collide(v, c) {
    const A = v.physics;
    if (c.phys && c.state === 'drive') {
      const res = VehiclePhysics.resolvePair(A, c.phys);
      if (!res || !res.impact) return null;
      const s = c.phys.s; c.x = s.x; c.z = s.z; c.yaw = s.yaw;
      if (res.impact > 3) { c.s2.vx = s.vx; c.s2.vz = s.vz; c.s2.yawRate = s.yawRate; this.knock(c, s.vx, s.vz, s.yawRate); c.phys = null; }
      return res;
    }
    // sync proxy state from traffic car
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    if (c.state === 'drive') { c.s2.vx = fx * c.v; c.s2.vz = fz * c.v; c.s2.yawRate = 0; }
    c.s2.x = c.x; c.s2.z = c.z;
    const proxy = { s: c.s2, p: c.p, obb: () => c.obb() };
    const res = VehiclePhysics.resolvePair(A, proxy);
    if (!res || !res.impact) return null;
    c.x = c.s2.x; c.z = c.s2.z;
    if (res.impact > 1.5 || c.state !== 'drive') {
      if (c.state === 'drive' || c.state === 'parked') { const i = c.path.cars.indexOf(c); if (i >= 0) c.path.cars.splice(i, 1); }
      c.state = 'knocked'; c.knockT = 0; c.brake = 1;
      this._unseat(c, c.s2.vx, c.s2.vz);
    }
    return res;
  }

  // something (an incident) shunts this car: off its lane, sliding with this velocity and spin
  knock(c, vx, vz, yawRate = 0) {
    if (c.state === 'drive' || c.state === 'parked') { const i = c.path?.cars.indexOf(c) ?? -1; if (i >= 0) c.path.cars.splice(i, 1); }
    c.state = 'knocked'; c.knockT = 0; c.brake = 1;
    c.s2.x = c.x; c.s2.z = c.z; c.s2.vx = vx; c.s2.vz = vz; c.s2.yawRate = yawRate;
    this._unseat(c, vx, vz);
    c.v = 0;
  }

  // a two-wheeler struck: the rider is thrown off (a tumbling body, as a struck pedestrian) and the bike goes down
  // on its side, falling away from the blow
  _unseat(c, vx, vz) {
    if (!c.spec.bike || c.riderOff) return;
    c.riderOff = true;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), own = c.v || 0;
    const lat = (vx - fx * own) * fz - (vz - fz * own) * fx;      // the blow across the bike (+: toward its right)
    c.fall = lat >= 0 ? 1 : -1;
    if (!c.parked) bus.emit('traffic:riderThrown', { x: c.x, y: c.y, z: c.z, vx: fx * own * 0.8 + vx * 0.6, vz: fz * own * 0.8 + vz * 0.6, yaw: c.yaw });
  }

  _knocked(c, dt) {
    const s = c.s2;
    c.knockT += dt;
    s.x = c.x; s.z = c.z;
    c.x += s.vx * dt; c.z += s.vz * dt;
    c.yaw += s.yawRate * dt;
    // a bike down on its side scrapes to a stop sooner
    const f = Math.exp(-dt * (c.riderOff ? 2.6 : 1.6));
    s.vx *= f; s.vz *= f; s.yawRate *= Math.exp(-dt * 2);
    // a shunted car settles back onto the road (the impact could leave it mid-bounce) and levels out
    if (!c.spec.bike && this.world.kerala) {
      const gy = this.world.layout.groundHeight(c.x, c.z, c.y);
      c.y = c.y > gy ? Math.max(gy, c.y - 9.81 * dt * Math.min(3, c.knockT + 0.3)) : gy;
      c.pitch = lerp(c.pitch || 0, c.slope || 0, 1 - Math.exp(-dt * 5)); c.roll = lerp(c.roll || 0, 0, 1 - Math.exp(-dt * 5));
    }
    if (c.riderOff) {
      c.roll = lerp(c.roll || 0, c.fall * 1.38, 1 - Math.exp(-dt * 5));
      c.pitch = lerp(c.pitch || 0, 0, 0.1);
      if (this.world.kerala) c.y = this.world.layout.groundHeight(c.x, c.z, c.y) + 0.16 * Math.abs(Math.sin(c.roll));
    }
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
    if (c.state === 'wreck' && c.knockT > 14 && !c.incident && !c.riderOff) {
      // try to rejoin traffic if the car is still near a lane and roughly aligned
      const near = this.graph.nearest(c.x, c.z);
      if (near && near.dist < 2 && !near.lane.cars.some((o) => Math.abs(o.s - near.s) < 10)) {
        c.path = near.lane; c.s = near.s; c.v = 0; c.state = 'drive'; c.lat = 0; near.lane.cars.push(c);
      }
    }
  }

  // another player's game runs the traffic here: drop ours and draw theirs
  _follow(focus) {
    if (this.cars.length) this.clear();
    const list = this.renderList;
    list.length = 0;
    for (const c of this.remote()) {
      c.dist = Math.hypot(c.x - focus.x, c.z - focus.z);
      c.lod = c.dist < this.preset.carLod1Distance ? 0 : 1;
      list.push(c);
    }
  }

  count() { return this.remote ? this.renderList.length : this.cars.length; }
}
