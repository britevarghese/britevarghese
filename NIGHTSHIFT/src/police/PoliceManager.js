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
      const l = new THREE.PointLight(i % 2 ? 0x3050ff : 0xff2030, 0, 26, 1.6);
      l.visible = false;
      this.game.scene.add(l);
      this.lights.push(l);
    }
  }

  get inPursuit() { return this.state === 'pursuit' || this.state === 'cooldown'; }

  _spawnUnit(x, z, yaw, role) {
    if (!this.game.lib.has('interceptor')) return null;
    const rules = HEAT_RULES[Math.max(1, this.heat)] || HEAT_RULES[1];
    const params = { ...POLICE_CAR.params, enginePower: POLICE_CAR.params.enginePower * rules.power, grip: POLICE_CAR.params.grip * rules.grip, maxSpeed: POLICE_CAR.params.maxSpeed * (0.95 + rules.power * 0.1) };
    const v = new Vehicle({ carId: 'interceptor', params, world: this.world, lib: this.game.lib, role: 'police', carType: 'muscle', renderOpts: { police: true, headlights: 0, shadow: false, lodDistance: this.game.preset.carLod1Distance, detailWheels: false, sharedPaint: true } });
    v.place(x, z, yaw);
    v.renderer.applyCustom({ paint: '#f2f2f2', paint2: '#0b0d12', vinyl: 3, finish: 'gloss', spoiler: 0, hood: 0, bumper: 0, tint: 0.7, wheelColor: '#2a2c30' });
    this.game.scene.add(v.renderer.group);
    const ai = new AIDriver(v, { skill: 0.9 + this.heat * 0.03, maxSpeed: params.maxSpeed });
    ai.useNitro = this.heat >= 3;
    const unit = { vehicle: v, ai, role, replanT: 0, health: 1, disabled: false, id: v.id };
    this.units.push(unit);
    return unit;
  }

  // build the livery/materials once while loading so the first backup unit doesn't hitch
  prewarm() {
    const u = this._spawnUnit(0, 0, 0, 'patrol');
    if (u) this._removeUnit(u);
  }

  _removeUnit(u) {
    u.vehicle.dispose();
    this.units.splice(this.units.indexOf(u), 1);
  }

  // a road node at distance [rMin, rMax] from the player, preferably out of view / ahead
  _spawnPoint(rMin, rMax, preferAhead) {
    const p = this.game.player.state;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const nodes = this.world.layout.nodes;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 40; i++) {
      const n = nodes[Math.floor(this.R() * nodes.length)];
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
    const p = this.game.player.state;
    const yaw = towardPlayer ? Math.atan2(p.x - n.x, p.z - n.z) : this.R() * Math.PI * 2;
    // snap heading to road axis
    const snapped = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
    return this._spawnUnit(n.x, n.z, snapped, 'pursuit');
  }

  // --------------------------------------------------------------------------- public events
  reportInfraction(kind, severity = 1) {
    if (!this.enabled) return;
    // only counts if a unit can see it
    const seen = this._anyUnitSees(80);
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
    if (was === 'idle') { this.pursuitTime = 0; this.heatTimer = 0; this.bounty = 0; this.disabledCount = 0; bus.emit('police:pursuit', { heat: this.heat, reason }); }
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
    for (const l of this.lights) l.visible = false;
  }

  _anyUnitSees(range) {
    const p = this.game.player.state;
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
    const p = this.game.player.state;
    const speed = Math.hypot(p.vx, p.vz);
    if (speed < 8) return;
    const fx = p.vx / speed, fz = p.vz / speed;
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
        const seer = this._anyUnitSees(75);
        if (seer) {
          const racing = game.races?.active?.state === 'racing' && game.races.active.def.type !== 'timetrial';
          if (pSpeed > 31 || racing) this.startPursuit(1, racing ? 'street racing' : 'speeding');
        }
      }
    } else {
      this.pursuitTime += dt;
      // heat escalation over time and with bounty
      this.heatTimer += dt;
      const needed = 45 + this.heat * 15;
      if (this.state === 'pursuit' && this.heatTimer > needed && this.heat < 5) {
        this.heat++; this.heatTimer = 0;
        bus.emit('police:heat', { heat: this.heat });
        for (const u of this.units) { const r2 = HEAT_RULES[this.heat]; u.vehicle.physics.setParams({ enginePower: POLICE_CAR.params.enginePower * r2.power, grip: POLICE_CAR.params.grip * r2.grip }); u.ai.useNitro = this.heat >= 3; }
      }
      // --- line of sight / evade / cooldown ---
      const seer = this._anyUnitSees(rules.sight);
      if (seer) {
        this.lastKnown = { x: p.x, z: p.z };
        this.evade = Math.max(0, this.evade - dt * 0.8);
        if (this.state === 'cooldown') { this.state = 'pursuit'; this.cooldown = 0; bus.emit('police:spotted', {}); }
      } else if (this.state === 'pursuit' && this.pursuitTime > 10) {
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
      if (this.state === 'pursuit' && close > 0 && pSpeed < 2.2) this.bust += dt / (close > 1 ? 2.8 : 4);
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
      if (this.state === 'idle' && u.role !== 'patrol') { this._removeUnit(u); continue; }
      if (u.disabled) {
        v.controls.throttle = 0; v.controls.brake = 1; v.controls.steer = 0;
        if (d > 260) this._removeUnit(u);
      } else if (u.role === 'patrol') {
        u.replanT -= dt;
        if (u.replanT <= 0 || u.ai.idx >= u.ai.route.length - 2) {
          u.replanT = 20;
          const L = this.world.layout;
          const from = L.nearestNode(s.x, s.z);
          const target = L.nodes[Math.floor(this.R() * L.nodes.length)];
          if (Math.hypot(target.x - p.x, target.z - p.z) < 500) u.ai.setRoute(L.route(from, target).map((id) => [L.nodes[id].x, L.nodes[id].z]));
        }
        u.ai.maxSpeed = 15;
        u.ai.update(dt, obstacles);
      } else if (u.role === 'pursuit') {
        const see = d < rules.sight && !this.world.collision.blocked(s.x, s.z, p.x, p.z, 3);
        if (see && d < 90) {
          u.ai.mode = 'pursue';
          u.ai.target = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
          u.ai.maxSpeed = v.p.maxSpeed;
        } else {
          u.replanT -= dt;
          if (u.replanT <= 0 || u.ai.mode !== 'route') {
            u.replanT = 1.5;
            const L = this.world.layout;
            const goal = this.state === 'cooldown' ? { x: this.lastKnown.x + (this.R() - 0.5) * 300, z: this.lastKnown.z + (this.R() - 0.5) * 300 } : { x: p.x + p.vx * 2, z: p.z + p.vz * 2 };
            const from = L.nearestNode(s.x, s.z), to = L.nearestNode(goal.x, goal.z);
            const pts = L.route(from, to).map((id) => [L.nodes[id].x, L.nodes[id].z]);
            if (this.state !== 'cooldown') pts.push([p.x, p.z]);
            u.ai.setRoute(pts);
            u.ai.maxSpeed = this.state === 'cooldown' ? 22 : v.p.maxSpeed;
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
      if (!e || e.d > 120) { l.visible = false; return; }
      const r = e.u.vehicle.renderer;
      const s = e.u.vehicle.state;
      const red = i % 2 === 0;
      l.visible = true;
      l.position.set(s.x, s.y + 1.8, s.z);
      l.intensity = (red ? r.police?.redOn : r.police?.blueOn) ? 40 : 0;
    });
  }

  sirenList() {
    return this.units.filter((u) => u.vehicle.renderer.sirenOn && !u.disabled).map((u) => ({ id: u.id, position: { x: u.vehicle.state.x, y: 1, z: u.vehicle.state.z }, velocity: { x: u.vehicle.state.vx, y: 0, z: u.vehicle.state.vz }, intensity: this.heat >= 3 ? 0.8 : 0.5 }));
  }
  vehicles() { return this.units.map((u) => u.vehicle); }
  count() { return this.units.length; }
}
void GRID;
