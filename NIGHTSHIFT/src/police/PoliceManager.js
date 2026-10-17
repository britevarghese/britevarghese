// PoliceManager: patrols, detection (distance, line of sight, speed, violations, collisions,
// racing), pursuit with heat levels 1-5, backup & intercept units spawned off-screen on the road
// graph, roadblocks at road nodes ahead of the player, search/cooldown, bust & escape.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { POLICE_CAR } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { clamp, rng } from '../core/util.js';
import { bus } from '../core/EventBus.js';
import { GRID, EDGE } from '../world/CityLayout.js';

export const HEAT_RULES = {
  1: { units: 2, power: 1.0, grip: 1.0, roadblocks: false, sight: 95, cooldown: 12, name: 'Patrol units' },
  2: { units: 3, power: 1.05, grip: 1.03, roadblocks: false, sight: 105, cooldown: 15, name: 'Multiple units' },
  3: { units: 4, power: 1.12, grip: 1.06, roadblocks: false, sight: 115, cooldown: 18, name: 'Fast units' },
  4: { units: 5, power: 1.2, grip: 1.09, roadblocks: true, sight: 125, cooldown: 22, name: 'Interceptors + roadblocks' },
  5: { units: 7, power: 1.3, grip: 1.12, roadblocks: true, sight: 140, cooldown: 26, name: 'Heavy pursuit' },
};

// (a way that can't be found gives up within a few thousand junctions: four tries a unit, several units, every
// second. And a hairpin at a junction - a three-point turn - is worth a good way round: at a junction its way doubled
// back at, a unit took 11 s over one)
const POLICE_ROUTE = { maxSteps: 4000, sharp: 400 };
// a unit's top speed in a chase by the class of road it's on: two and a half times the traffic's (KeralaLanes'
// SPEED). (At twice it, units on the side streets couldn't close on a player doing 70 km/h)
const CHASE_V = [55, 42, 35, 31, 28, 24, 21, 17, 14, 10.5, 10.5];

// a Kerala Police Bolero: a heavy, upright jeep, but tuned to keep up in a chase
const KL_POLICE_JEEP = { ...POLICE_CAR.params, mass: 1650, enginePower: 235, maxSpeed: 58, grip: 1.08, wheelBase: 2.68, trackWidth: 1.47, cgHeight: 0.78, frontWeight: 0.55, downforce: 0.5, length: 3.995, width: 1.745, wheelRadius: 0.36 };

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.units = [];          // {vehicle, ai, role:'patrol'|'pursuit'|'roadblock', replanT, lastSeen}
    this.heat = 0;
    this.state = 'idle';      // idle | pursuit | cooldown | busted
    this.evade = 0;           // 0..1 out-of-sight timer before cooldown starts
    this.cooldown = 0;        // 0..1
    this.bust = 0;            // 0..1
    this.pursuitTime = 0;
    this.heatTimer = 0;
    this.infractions = 0;
    this.bounty = 0;
    this.lastKnown = { x: 0, z: 0 };
    this.R = rng(4242);
    this.detectT = 0;
    this.roadblocks = [];
    this.lights = [];
    this.maxPatrols = 2;
    this.enabled = true;
    this.disabledCount = 0;
    this._initLights();
  }

  _initLights() {
    const n = this.game.preset.policeLights;
    for (let i = 0; i < n; i++) {
      // always in the scene at zero intensity: switching lights on/off (visible) would change the light
      // count and recompile every shader in the city the moment a pursuit starts (the freeze)
      const l = new THREE.PointLight(i % 2 ? 0x3050ff : 0xff2030, 0, 26, 1.6);
      this.game.scene.add(l);
      this.lights.push(l);
    }
  }

  get inPursuit() { return this.state === 'pursuit' || this.state === 'cooldown'; }

  _spawnUnit(x, z, yaw, role) {
    // Kerala: the police drive Mahindra Boleros (white, the Kerala Police band, a light bar on the roof)
    const jeep = !!this.world.kerala && this.game.lib.has('bolero'), id = jeep ? 'bolero' : 'interceptor';
    if (!this.game.lib.has(id)) return null;
    const rules = HEAT_RULES[Math.max(1, this.heat)] || HEAT_RULES[1];
    const P0 = jeep ? KL_POLICE_JEEP : POLICE_CAR.params;
    const params = { ...P0, enginePower: P0.enginePower * rules.power, grip: P0.grip * rules.grip, maxSpeed: P0.maxSpeed * (0.95 + rules.power * 0.1) };
    const v = new Vehicle({ carId: id, params, world: this.world, lib: this.game.lib, role: 'police', carType: 'muscle', renderOpts: { police: true, headlights: 0, shadow: false, lodDistance: this.game.preset.carLod1Distance, detailWheels: false, sharedPaint: true } });
    v.place(x, z, yaw);
    v.renderer.applyCustom(jeep ? { paint: 'factory', finish: 'gloss', tint: 0.5 } : { paint: '#f2f2f2', paint2: '#0b0d12', vinyl: 3, finish: 'gloss', spoiler: 0, hood: 0, bumper: 0, tint: 0.7, wheelColor: '#2a2c30' });
    this.game.scene.add(v.renderer.group);
    const ai = new AIDriver(v, { skill: 0.9 + this.heat * 0.03, maxSpeed: params.maxSpeed });
    ai.useNitro = this.heat >= 3;
    const unit = { vehicle: v, ai, role, replanT: 0, health: 1, disabled: false, id: v.id, base: P0 };
    this.units.push(unit);
    return unit;
  }

  // build the livery/materials once while loading so the first backup unit doesn't hitch
  prewarm() {
    const u = this._spawnUnit(0, 0, 0, 'patrol');
    if (u) this._removeUnit(u);
  }

  // hand a stopped cruiser over to the player (stolen): out of the police fleet, vehicle kept alive
  release(u) {
    const i = this.units.indexOf(u);
    if (i < 0) return null;
    this.units.splice(i, 1);
    u.vehicle.renderer.sirenOn = false;
    return u.vehicle;
  }

  _removeUnit(u) {
    u.vehicle.dispose();
    this.units.splice(this.units.indexOf(u), 1);
  }

  // a road node at distance [rMin, rMax] from the player, preferably out of view / ahead
  _spawnPoint(rMin, rMax, preferAhead) {
    const p = this.game.focusState;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    // (Kerala: from the junctions round the player - drawn from every one loaded, up to 100 square km of them, few fell
    // in the ring: in Taliparamba at heat 4, two units came of five)
    const nodes = this.world.router?.nodesNear?.(p.x, p.z, rMax) || this.world.layout.nodes;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const n = nodes[Math.floor(this.R() * nodes.length)];
      if (!n) break;   // (no road network streamed in around here yet)
      if (n.type === 'wp') continue;   // (a point of the last route asked for: no junction, no lanes out of it)
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d < rMin || d > rMax) continue;
      const dot = (dx * fx + dz * fz) / d;
      const blocked = this.world.collision.blocked(p.x, p.z, n.x, n.z, 3);
      const score = (preferAhead ? dot : -dot) + (blocked ? 0.8 : 0) + this.R() * 0.3;
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  _spawnNearNode(n, towardPlayer) {
    const p = this.game.focusState;
    // Kerala: a little way along one of the junction's lanes out, facing its way (the one heading most toward the
    // player, for a unit sent after them), clear of the traffic. (Its roads run every way, not the grid's: set in the
    // junction's middle facing one of the grid's right angles, units came in 108-177 degrees off their lane and began
    // with a three-point turn)
    const W = this.world, out = W.kerala && W.router?.adj?.[n.id];
    if (out) {
      const tmp = {}, cars = this.game.traffic?.cars || [];
      let best = null, bs = -Infinity;
      for (const { lane } of out) {
        if (!(lane.length > 16) || lane.edge?.cls > 7 || !lane.sample) continue;
        lane.sample(Math.min(14, lane.length / 2), tmp);
        if (cars.some((c) => Math.hypot(c.x - tmp.x, c.z - tmp.z) < 7) || this.units.some((u) => Math.hypot(u.vehicle.state.x - tmp.x, u.vehicle.state.z - tmp.z) < 8)) continue;
        const tx = p.x - tmp.x, tz = p.z - tmp.z, td = Math.hypot(tx, tz) || 1;
        const score = (towardPlayer ? (tmp.dx * tx + tmp.dz * tz) / td : 0) + this.R() * 0.3;
        if (score > bs) { bs = score; best = { x: tmp.x, z: tmp.z, yaw: Math.atan2(tmp.dx, tmp.dz) }; }
      }
      // (and for a chase, only where there's a way by road to the player: put down on a stretch the lanes don't join
      // to theirs, units stood there for good with nowhere to go)
      if (!best || (towardPlayer && !this._pathKL({ x: best.x, z: best.z, yaw: best.yaw }, null, true))) return null;
      return this._spawnUnit(best.x, best.z, best.yaw, 'pursuit');
    }
    const yaw = towardPlayer ? Math.atan2(p.x - n.x, p.z - n.z) : this.R() * Math.PI * 2;
    // snap heading to road axis
    const snapped = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    return this._spawnUnit(n.x, n.z, snapped, 'pursuit');
  }

  // --------------------------------------------------------------------------- public events
  // range: how close a cop must be (with line of sight) to notice; minor things need a cop right there
  reportInfraction(kind, severity = 1, range = 60) {
    if (!this.enabled) return;
    const seen = this._anyUnitSees(range);
    if (!seen && this.state === 'idle') return;
    this.infractions += severity;
    if (this.state === 'idle') this.startPursuit(1, kind);
    else if (kind === 'ramPolice') this.bounty += 250;
  }

  startPursuit(heat = 1, reason = 'speeding') {
    if (!this.enabled) return;
    const was = this.state;
    this.heat = Math.max(this.heat, heat);
    this.state = 'pursuit';
    this.evade = 0; this.cooldown = 0; this.bust = 0;
    // (where it started is where they're known to be: left at the grid city's middle - or wherever the last chase
    // lost them - a chase that went quiet before any unit had seen the player sent the units off to search there)
    if (was === 'idle') { const p = this.game.focusState; this.lastKnown = { x: p.x, z: p.z }; this.unseenT = 0; this.pursuitTime = 0; this.heatTimer = 0; this.bounty = 0; this.disabledCount = 0; bus.emit('police:pursuit', { heat: this.heat, reason }); }
    for (const u of this.units) { u.role = 'pursuit'; u.vehicle.renderer.sirenOn = true; }
  }

  endPursuit(result) {
    const heat = this.heat;
    this.state = 'idle';
    this.evade = this.cooldown = this.bust = 0;
    for (const rb of this.roadblocks) for (const u of rb.units) if (this.units.includes(u)) this._removeUnit(u);
    this.roadblocks = [];
    for (const u of [...this.units]) {
      u.vehicle.renderer.sirenOn = false;
      u.role = 'patrol';
      if (this.units.filter((q) => q.role === 'patrol').length > this.maxPatrols || u.disabled) this._removeUnit(u);
    }
    if (result === 'escaped') {
      const reward = Math.round(500 * heat + this.pursuitTime * 12 + this.bounty + this.disabledCount * 400);
      bus.emit('police:escaped', { heat, reward, time: this.pursuitTime });
    } else if (result === 'busted') {
      bus.emit('police:busted', { heat, fine: Math.round(800 + heat * 600) });
    }
    this.heat = 0;
  }

  clearAll() {
    for (const u of [...this.units]) this._removeUnit(u);
    this.roadblocks = [];
    this.state = 'idle'; this.heat = 0;
    for (const l of this.lights) l.intensity = 0;
  }

  _anyUnitSees(range) {
    const p = this.game.focusState;
    for (const u of this.units) {
      if (u.disabled) continue;
      const s = u.vehicle.state;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < range && !this.world.collision.blocked(s.x, s.z, p.x, p.z, 3)) return u;
    }
    return null;
  }

  // --------------------------------------------------------------------------- roadblocks
  _placeRoadblock() {
    const p = this.game.focusState;
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 8) return;
    const fx = p.vx / speed, fz = p.vz / speed;
    if (this.world.kerala) { this._placeRoadblockKL(p, fx, fz); return; }
    // pick the grid node ~200-320 m ahead along the travel direction on the same road line
    const L = this.world.layout;
    let best = null, bestD = Infinity;
    for (const n of L.nodes) {
      if (n.type !== 'grid' || Math.abs(n.x) > EDGE || Math.abs(n.z) > EDGE) continue;
      const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
      if (d < 180 || d > 340) continue;
      const along = dx * fx + dz * fz;
      const lat = Math.abs(-dx * fz + dz * fx);
      if (along / d < 0.92 || lat > 25) continue;
      if (this.world.collision.blocked(p.x, p.z, n.x, n.z, 3) && d < 220) continue;
      if (Math.abs(d - 250) < bestD) { bestD = Math.abs(d - 250); best = n; }
    }
    if (!best) return;
    // blockade on the approach side of the intersection, perpendicular to player's travel
    const axisX = Math.abs(fx) > Math.abs(fz);
    const dirSign = axisX ? Math.sign(fx) : Math.sign(fz);
    const back = 22;
    const cx = axisX ? best.x - dirSign * back : best.x, cz = axisX ? best.z : best.z - dirSign * back;
    const units = [];
    const offsets = [-5.2, 0, 5.2];
    for (const off of offsets) {
      const x = axisX ? cx : cx + off, z = axisX ? cz + off : cz;
      const yaw = axisX ? 0 : Math.PI / 2;
      const u = this._spawnUnit(x, z, yaw + (this.R() - 0.5) * 0.3, 'roadblock');
      if (!u) continue;
      u.ai.mode = 'park';
      u.vehicle.renderer.sirenOn = true;
      units.push(u);
    }
    this.roadblocks.push({ x: cx, z: cz, units, t: 0 });
    bus.emit('police:roadblock', { x: cx, z: cz });
  }

  // Kerala: the way by road from a unit to the player (or to where it's searching): on along its own lane to the
  // junction ahead, through the junctions, and along the player's lane to where they'll be in a moment. (It was routed
  // from the junction nearest the unit, often one behind it, to the one nearest the player and then in a straight line
  // to them)
  _pathKL(s, goal, chase) {
    const G = this.game.traffic?.graph, R = this.world.router;
    if (!G?.laneAt || !R?.pathBetween) return null;
    const a = this._laneA = G.laneAt(s.x, s.z, Math.sin(s.yaw), Math.cos(s.yaw));
    if (!a) return null;
    // (to either of the road's lanes there, whichever's the shorter way: up the player's own lane from behind them,
    // or their road's other lane, met head on)
    const p = chase ? this.game.focusState : goal, sp = chase ? Math.hypot(p.vx, p.vz) : 0;
    const fx = sp > 2 ? p.vx / sp : chase ? Math.sin(p.yaw || 0) : 0, fz = sp > 2 ? p.vz / sp : chase ? Math.cos(p.yaw || 0) : 0;
    let best = null, bl = Infinity;
    for (const k of fx || fz ? [1, -1] : [0]) {
      // (and, turning through a junction, its way half way between the lanes in and out: whichever runs its way at all)
      const b = G.laneAt(p.x, p.z, fx * k, fz * k, chase ? 15 : 60) || ((fx || fz) && G.laneAt(p.x, p.z, fx * k, fz * k, 15, 0));
      if (!b) continue;
      // (from behind: to where they'll be in a moment. And the wrong way down their lane when there's no way in at
      // its start: on a one-way street in Taliparamba's middle starting at the edge of a map tile not built yet, no
      // unit sent after the player could find a way to them, and none came)
      for (const against of [false, true]) {
        const pts = R.pathBetween(a, k > 0 && !against ? { lane: b.lane, s: Math.min(b.lane.length, b.s + sp * 1.5) } : b, POLICE_ROUTE, against);
        let len = against ? 60 : 0;   // (the wrong way only when it's well the shorter)
        for (let i = 1; pts && i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (pts && pts.length > 1 && len < bl) { bl = len; best = pts; }
      }
    }
    return best;
  }

  // how far along a way (from the point of it nearest (x, z)) its first sharp turn is: more than ~60 degrees within 12 m
  _firstTurn(pts, x, z) {
    let j = 0, bd = Infinity;
    for (let i = 0; i < Math.min(pts.length, 20); i++) { const d = Math.hypot(pts[i][0] - x, pts[i][1] - z); if (d < bd) { bd = d; j = i; } }
    const hd = (i) => Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    let along = 0;
    for (let i = j; i < pts.length - 2 && along < 200; i++) {
      along += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      // (the turn over the next 12 m or so, a junction's few points taken together)
      let k = i + 1, run = 0;
      while (k < pts.length - 2 && run < 12) { run += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); k++; }
      let t = hd(k) - hd(i);
      while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI;
      if (Math.abs(t) > 1.05) return along;
    }
    return Infinity;
  }

  // the straight line from a unit to the player, and to the point a little ahead of them it aims for, all on the road
  // (or the player off it)
  _directOK(s, p, d) {
    const W = this.world;
    if (!W.onCarriageway(p.x, p.z, 0.5)) return true;
    const lead = clamp(d / 40, 0, 1.2);
    for (const [x, z] of [[p.x, p.z], [p.x + p.vx * lead, p.z + p.vz * lead]]) {
      const n = Math.ceil(Math.hypot(x - s.x, z - s.z) / 3.5);
      for (let i = 1; i < n; i++) if (!W.onCarriageway(s.x + (x - s.x) * i / n, s.z + (z - s.z) * i / n, 0.3)) return false;
    }
    return true;
  }

  // a roadblock in Kerala: the road ahead of the player followed on, the straightest way at each junction, ~240 m (out
  // of their sight, or far enough off not to be seen coming), and two jeeps (three on a wide road) parked across it
  // there, staggered and angled in towards them, their lights going. (The grid city's way - a node ahead on the
  // same line, the jeeps squared to its axes - found nothing here: Kerala's junctions aren't the grid's, and at heat
  // 4 and 5 no roadblock was ever put up)
  _placeRoadblockKL(p, fx, fz) {
    const R = this.world.router, W = this.world, cars = this.game.traffic?.cars || [];
    R?._sync?.();   // (the junctions as the lanes are now)
    const at = this.game.traffic?.graph?.laneAt?.(p.x, p.z, fx, fz);
    if (!R?.adj || !at) return;
    const A = {}, B = {};
    let l = at.lane, s = at.s, left = 240;
    for (let k = 0; k < 14 && l.length - s < left; k++) {
      left -= l.length - s;
      let nx = null, bdot = 0.6;
      l.sample(Math.max(0, l.length - 4), A);
      for (const { lane: o } of R.adj[R.ids?.get(l.to)] || []) {
        if (o.to === l.from || o.edge?.cls > 6) continue;   // (not back the way it came, nor down a lane)
        o.sample(Math.min(4, o.length), B);
        const dot = A.dx * B.dx + A.dz * B.dz;
        if (dot > bdot) { bdot = dot; nx = o; }
      }
      if (!nx) return;   // (no way on that's straight on: the player turns somewhere before it)
      l = nx; s = 0;
    }
    if (l.length - s < left) return;
    s = clamp(s + left, Math.min(20, l.length / 2), Math.max(l.length - 20, l.length / 2));   // (not in a junction)
    l.sample(s, A);
    const d = Math.hypot(A.x - p.x, A.z - p.z);
    if (d < 170 || (d < 230 && !W.collision.blocked(p.x, p.z, A.x, A.z, 3))) return;   // (not put up in plain view)
    if (cars.some((c) => Math.hypot(c.x - A.x, c.z - A.z) < 9)) return;   // (traffic there: next time)
    // the road's edges either side of the lane there
    const rx = -A.dz, rz = A.dx;
    let lo = 0, hi = 0;
    while (lo > -9 && W.onCarriageway(A.x + rx * (lo - 0.25), A.z + rz * (lo - 0.25), 0)) lo -= 0.25;
    while (hi < 12 && W.onCarriageway(A.x + rx * (hi + 0.25), A.z + rz * (hi + 0.25), 0)) hi += 0.25;
    const span = hi - lo;
    if (span < 4) return;
    // each jeep across the road 20 degrees off square, its nose to the middle and turned toward the player coming, its
    // ends a hand inside the road's edges; the next a jeep's width on along the road. (Spread evenly a metre and a
    // half apart, they overlapped each other and the kerb, and were thrown apart at up to 25 km/h, one into a building)
    const ang = 0.35, hl = KL_POLICE_JEEP.length / 2, hw = KL_POLICE_JEEP.width / 2;
    const across = hl * Math.cos(ang) + hw * Math.sin(ang), step = 2 * (hl * Math.sin(ang) + hw * Math.cos(ang)) + 0.3;
    const yaw0 = Math.atan2(A.dx, A.dz), mid = (lo + hi) / 2, units = [];
    const slots = span >= 4 * across + 0.6 ? [[lo + 0.15 + across, -step / 2], [mid, step / 2], [hi - 0.15 - across, -step / 2]]
      : span >= 2 * across + 0.8 ? [[lo + 0.15 + across, -step / 2], [hi - 0.15 - across, step / 2]] : [[mid, 0]];
    for (const [o, along] of slots) {
      const side = o < mid - 0.1 ? 1 : o > mid + 0.1 ? -1 : this.R() < 0.5 ? 1 : -1;
      const yaw = yaw0 - side * (Math.PI / 2 + ang) + (this.R() - 0.5) * 0.1;
      const u = this._spawnUnit(A.x + rx * o + A.dx * along, A.z + rz * o + A.dz * along, yaw, 'roadblock');
      if (!u) continue;
      u.ai.mode = 'park';
      u.vehicle.renderer.sirenOn = true;
      units.push(u);
    }
    const cx = A.x + rx * (lo + hi) / 2, cz = A.z + rz * (lo + hi) / 2;
    this.roadblocks.push({ x: cx, z: cz, units, t: 0 });
    bus.emit('police:roadblock', { x: cx, z: cz });
  }

  // --------------------------------------------------------------------------- update
  update(dt, traffic) {
    const game = this.game;
    const player = game.player;
    if (!player || !this.enabled) return;
    const p = player.state;
    const pSpeed = Math.hypot(p.vx, p.vz);
    const rules = HEAT_RULES[Math.max(1, this.heat)];

    // --- patrols in free roam: keep a couple of units roaming the nearby road network ---
    if (this.state === 'idle') {
      const patrols = this.units.filter((u) => u.role === 'patrol');
      if (patrols.length < (game.races?.active ? 1 : this.maxPatrols) && this.R() < dt * 0.5) {
        const n = this._spawnPoint(160, 300, this.R() < 0.5);
        if (n) { const u = this._spawnNearNode(n, false); if (u) { u.role = 'patrol'; u.vehicle.renderer.sirenOn = false; } }
      }
      // detection
      this.detectT -= dt;
      if (this.detectT <= 0) {
        this.detectT = 0.4;
        // speeding: well over the limit (~140 km/h), held for a moment in front of a patrol car
        const seer = this._anyUnitSees(60);
        const racing = game.races?.active?.state === 'racing' && game.races.active.def.type !== 'timetrial';
        this.speedT = seer && (pSpeed > 39 || racing) ? (this.speedT || 0) + 0.4 : 0;
        if (this.speedT >= 1.2) { this.speedT = 0; this.startPursuit(1, racing ? 'street racing' : 'speeding'); }
      }
    } else {
      this.pursuitTime += dt;
      // heat escalation over time and with bounty
      this.heatTimer += dt;
      const needed = 45 + this.heat * 15;
      if (this.state === 'pursuit' && this.heatTimer > needed && this.heat < 5) {
        this.heat++; this.heatTimer = 0;
        bus.emit('police:heat', { heat: this.heat });
        // (from each unit's own make: scaled from the interceptor's, a Bolero at heat 2 got a third more power than
        // its own engine's, and more grip)
        for (const u of this.units) { const r2 = HEAT_RULES[this.heat], P0 = u.base || POLICE_CAR.params; u.vehicle.physics.setParams({ enginePower: P0.enginePower * r2.power, grip: P0.grip * r2.grip }); u.ai.useNitro = this.heat >= 3; }
      }
      // --- line of sight / evade / cooldown ---
      const seer = this._anyUnitSees(rules.sight);
      this.unseenT = seer ? 0 : (this.unseenT || 0) + dt;
      if (seer) {
        this.lastKnown = { x: p.x, z: p.z };
        this.evade = Math.max(0, this.evade - dt * 0.8);
        if (this.state === 'cooldown') { this.state = 'pursuit'; this.cooldown = 0; bus.emit('police:spotted', {}); }
      } else if (this.state === 'pursuit' && this.pursuitTime > 10 && (this.unseenT > 60 || Math.hypot(p.x - this.lastKnown.x, p.z - this.lastKnown.z) > 60)) {
        // (out of sight and away from where they were seen - or out of sight a good while: sat still in the open, the
        // units not there yet, a player got away 26 s into a chase without moving)
        this.evade += dt / 4;
        if (this.evade >= 1) { this.state = 'cooldown'; this.cooldown = 0; this.evade = 1; bus.emit('police:cooldown', {}); }
      }
      if (this.state === 'cooldown') {
        this.cooldown += dt / rules.cooldown;
        if (this.cooldown >= 1) { this.endPursuit('escaped'); return; }
      }
      // --- bust meter: slow + surrounded ---
      let close = 0;
      for (const u of this.units) if (!u.disabled && u.role !== 'patrol' && Math.hypot(u.vehicle.state.x - p.x, u.vehicle.state.z - p.z) < 11) close++;
      // (bustHold: a story holding it off a moment, e.g. a crew running out of a bank to their car)
      if (this.state === 'pursuit' && close > 0 && pSpeed < 2.2 && !this.bustHold) this.bust += dt / (close > 1 ? 2.8 : 4);
      else this.bust = Math.max(0, this.bust - dt * (pSpeed > 8 ? 1.2 : 0.5));
      if (this.bust >= 1) { this.bust = 1; this.state = 'busted'; this.endPursuit('busted'); return; }

      // --- backup: maintain unit count for current heat ---
      const active = this.units.filter((u) => u.role === 'pursuit' && !u.disabled);
      if (this.state === 'pursuit' && active.length < rules.units && this.R() < dt * (active.length < 2 ? 3 : 0.6)) {
        const intercept = this.R() < 0.45;
        const n = intercept ? this._spawnPoint(170, 280, true) : this._spawnPoint(140, 260, false);
        if (n) { const u = this._spawnNearNode(n, true); if (u) { u.vehicle.renderer.sirenOn = true; if (intercept) bus.emit('police:intercept', {}); } }
      }
      // --- roadblocks at heat 4+ ---
      if (rules.roadblocks && this.state === 'pursuit' && this.roadblocks.length < 1 && this.R() < dt * 0.15) this._placeRoadblock();
      for (const rb of [...this.roadblocks]) {
        rb.t += dt;
        const d = Math.hypot(rb.x - p.x, rb.z - p.z);
        if ((rb.t > 25 && d > 150) || rb.t > 60) {
          for (const u of rb.units) if (this.units.includes(u)) this._removeUnit(u);
          this.roadblocks.splice(this.roadblocks.indexOf(rb), 1);
        }
      }
    }

    // --- per-unit AI ---
    const obstacles = traffic ? traffic.cars : [];
    for (const u of [...this.units]) {
      const v = u.vehicle, s = v.state;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (u.role === 'patrol' && d > 420) { this._removeUnit(u); continue; }
      // (and one left far behind in a chase, out of sight: a fresh one comes in nearer instead)
      if (u.role === 'pursuit' && this.state === 'pursuit' && (d > 550 || (d > 400 && !this.game.traffic?._inView?.(s)))) { this._removeUnit(u); continue; }
      if (this.state === 'idle' && u.role !== 'patrol') { this._removeUnit(u); continue; }
      if (u.disabled) {
        v.controls.throttle = 0; v.controls.brake = 1; v.controls.steer = 0;
        if (d > 260) this._removeUnit(u);
      } else if (u.role === 'patrol') {
        u.ai.runOn = false;
        u.replanT -= dt;
        // (on from the end of the route it's on, the way it came in, before it gets there: a new route handed over at
        // the end turned the car at speed, into whatever stood beside the junction)
        const r = u.ai.route, on = u.ai.mode === 'route' && r.length > 1 && u.ai.idx < r.length - 2;
        if (!on || (u.replanT <= 0 && u.ai.remaining(90) < 90)) {
          u.replanT = 2;
          const L = this.world.layout, end = on ? r[r.length - 1] : [s.x, s.z], from = L.nearestNode(end[0], end[1]);
          for (let k = 0; k < 8; k++) {
            const target = L.nodes[Math.floor(this.R() * L.nodes.length)];
            if (!target || target.type === 'wp' || L.deadEnd?.(target.id) || Math.hypot(target.x - p.x, target.z - p.z) > 500 || Math.hypot(target.x - from.x, target.z - from.z) < 150) continue;
            const pts = L.route(from, target, on ? u.lastLane : null).map((id) => [L.nodes[id].x, L.nodes[id].z]);
            if (pts.length < 2) continue;
            u.lastLane = L.lastLane;
            if (on) u.ai.extendRoute(pts); else u.ai.setRoute(pts);
            break;
          }
        }
        u.ai.maxSpeed = 15;
        u.ai.update(dt, obstacles);
      } else if (u.role === 'pursuit') {
        u.ai.runOn = true;   // (its route ends where the player was: driven through, not pulled up at)
        u.ai.siren = true;
        // (no faster than two and a half times the traffic's pace on the road it's on: at 160 km/h through a town's
        // streets, a unit couldn't take the turn the player took)
        const vRoad = this.world.kerala && u.cls != null ? CHASE_V[u.cls] ?? 18 : Infinity;
        const see = d < rules.sight && !this.world.collision.blocked(s.x, s.z, p.x, p.z, 3), kl = this.world.kerala;
        // straight at the player when close and in sight - in Kerala only where the way there is all road, or they've
        // left the road (straight at them at 42 km/h, a unit left the road and hit a tree)
        if (see && d < 90 && (!kl || d < 12 || this._directOK(s, p, d))) {
          u.ai.mode = 'pursue';
          u.ai.target = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
          u.ai.maxSpeed = Math.min(v.p.maxSpeed, vRoad);
        } else {
          u.replanT -= dt;
          const cool = this.state === 'cooldown';
          if (u.search) u.search.t -= dt;
          if (u.replanT <= 0 || u.ai.mode !== 'route') {
            u.replanT = kl && d < 150 ? 0.8 : 1.5;
            const L = this.world.layout;
            // (searching: one place round where they were last seen at a time, driven to - given a new one every
            // replan, a unit set off one way and then another)
            if (cool && (!u.search || u.search.t <= 0 || Math.hypot(u.search.x - s.x, u.search.z - s.z) < 30)) u.search = { x: this.lastKnown.x + (this.R() - 0.5) * 300, z: this.lastKnown.z + (this.R() - 0.5) * 300, t: 20 };
            const goal = cool ? u.search : { x: p.x + p.vx * 2, z: p.z + p.vz * 2 };
            let pts = kl ? this._pathKL(s, goal, !cool) : null;
            if (kl) u.cls = this._laneA?.lane?.edge?.cls ?? u.cls;
            const sp = Math.hypot(s.vx, s.vz), has = u.ai.mode === 'route' && u.ai.route.length > 1 && u.ai.idx < u.ai.route.length - 2;
            // (Kerala: a way that turns sooner than the unit can slow for - the player turned off just ahead of it - is
            // put off till the next look, the route it's on kept)
            if (pts && has && sp > 12 && this._firstTurn(pts, s.x, s.z) < sp * sp / 12 + 8) pts = 'keep';
            if (pts === 'keep') { /* on as it is */ } else if (pts && pts.length > 1) u.ai.setRoute(pts);
            // (the junctions' way, from the nearest one, only for a unit with none: swapped in for the route a unit was
            // on at 117 km/h, it turned for a junction behind it and went into a building at 100)
            else if (!kl || !has) {
              const from = L.nearestNode(s.x, s.z), to = L.nearestNode(goal.x, goal.z);
              pts = L.route(from, to).map((id) => [L.nodes[id].x, L.nodes[id].z]);
              if (!cool) pts.push([p.x, p.z]);
              if (pts.length > 1) u.ai.setRoute(pts);
            }
            u.ai.maxSpeed = Math.min(cool ? 22 : v.p.maxSpeed, kl && u.cls != null ? CHASE_V[u.cls] ?? 18 : Infinity);
          }
        }
        u.ai.update(dt, obstacles);
        v.renderer.sirenOn = true;
      } else if (u.role === 'roadblock') {
        u.ai.update(dt, obstacles);
        // units leave the roadblock and join when the player gets past
        if (d < 30 && pSpeed > 5) { u.role = 'pursuit'; u.ai.mode = 'pursue'; }
      }
      if (u.ai.needsReset && game.recoverAI(v, u.ai)) u.replanT = 0;
      const events = v.update(dt);
      for (const e of events) if (e.type === 'collision' && e.intensity > 0.15) game.fx?.impact(e.x, 0.6, e.z, e.nx, e.nz, e.intensity * 0.5);
      if (v.state.damage >= 1 && !u.disabled) { u.disabled = true; v.renderer.sirenOn = false; this.disabledCount++; this.bounty += 500; bus.emit('police:disabled', { x: s.x, z: s.z }); }
    }
    // police vs police collisions
    for (let i = 0; i < this.units.length; i++) for (let j = i + 1; j < this.units.length; j++) {
      const a = this.units[i].vehicle, b = this.units[j].vehicle;
      if (Math.abs(a.state.x - b.state.x) < 7 && Math.abs(a.state.z - b.state.z) < 7) VehiclePhysics.resolvePair(a.physics, b.physics);
    }
    this._updateLights();
  }

  // assign the limited dynamic point lights to the nearest units with sirens on
  _updateLights() {
    const cam = this.game.camera.position;
    const lit = this.units.filter((u) => u.vehicle.renderer.sirenOn && !u.disabled)
      .map((u) => ({ u, d: Math.hypot(u.vehicle.state.x - cam.x, u.vehicle.state.z - cam.z) }))
      .sort((a, b) => a.d - b.d);
    this.lights.forEach((l, i) => {
      const e = lit[Math.floor(i / 2)] || lit[i];
      if (!e || e.d > 120) { l.intensity = 0; return; }
      const r = e.u.vehicle.renderer;
      const s = e.u.vehicle.state;
      const red = i % 2 === 0;
      l.position.set(s.x, s.y + 1.8, s.z);
      // a cruiser on your bumper would flood the view: the flash light fades in over the first ~15 m
      l.intensity = (red ? r.police?.redOn : r.police?.blueOn) ? 24 * clamp((e.d - 2) / 13, 0.1, 1) : 0;
    });
  }

  sirenList() {
    return this.units.filter((u) => u.vehicle.renderer.sirenOn && !u.disabled).map((u) => ({ id: u.id, position: { x: u.vehicle.state.x, y: 1, z: u.vehicle.state.z }, velocity: { x: u.vehicle.state.vx, y: 0, z: u.vehicle.state.vz }, intensity: this.heat >= 3 ? 0.8 : 0.5 }));
  }
  vehicles() { return this.units.map((u) => u.vehicle); }
  count() { return this.units.length; }
}
void GRID;
