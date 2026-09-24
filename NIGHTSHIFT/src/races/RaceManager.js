// RaceManager: event markers in the world, race setup on the road graph, 3D checkpoint gates
// (strict sequence, no skipping), AI opponents with rubber banding, countdown, positions, timers
// and results for Sprint / Circuit / Checkpoint / Speed Run / Time Trial / Police Escape.
import * as THREE from 'three';
import { RACE_EVENTS, RACE_TYPE_NAMES } from './RaceEvents.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { CARS, tunedParams, PAINTS, PLAYER_CAR_ORDER, TIERS } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { GRID, RING } from '../world/CityLayout.js';
import { bus } from '../core/EventBus.js';
import { clamp, wrapAngle } from '../core/util.js';

const OPP_NAMES = ['Vex', 'Juno', 'Kaito', 'Rhea', 'Marlow', 'Sable', 'Dex', 'Nova'];

function gateTexture(finish) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  if (finish) {
    for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 16, y * 16, 16, 16); }
  } else {
    g.fillStyle = '#000'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#fff';
    for (let i = 0; i < 8; i++) { g.beginPath(); const x = i * 64 + 16; g.moveTo(x, 8); g.lineTo(x + 24, 32); g.lineTo(x, 56); g.lineTo(x + 12, 56); g.lineTo(x + 36, 32); g.lineTo(x + 12, 8); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class RaceManager {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.events = RACE_EVENTS.map((e) => this._prepare(e));
    this.active = null;
    this.markers = new THREE.Group();
    game.scene.add(this.markers);
    this._buildMarkers();
    this.gateGroup = new THREE.Group();
    game.scene.add(this.gateGroup);
    this.gateMatNext = new THREE.MeshBasicMaterial({ color: 0xff3d5a, toneMapped: false, transparent: true, opacity: 0.95 });
    this.gateMatLater = new THREE.MeshBasicMaterial({ color: 0x37e2ff, toneMapped: false, transparent: true, opacity: 0.35 });
    this.bannerTex = gateTexture(false); this.finishTex = gateTexture(true);
  }

  _resolve(w) {
    if (w[0] === 'ring') {
      const k = w[1] * GRID, side = w[2];
      return { N: [k, RING], S: [k, -RING], E: [RING, k], W: [-RING, k] }[side];
    }
    return [w[0] * GRID, w[1] * GRID];
  }

  _prepare(def) {
    const L = this.world.layout;
    const wps = def.waypoints.map((w) => this._resolve(w));
    const route = [];
    const gates = [];
    const nodeAt = (p) => L.nearestNode(p[0], p[1]);
    const legs = def.type === 'circuit' ? [...wps, wps[0]] : wps;
    for (let i = 0; i < legs.length - 1; i++) {
      const ids = L.route(nodeAt(legs[i]), nodeAt(legs[i + 1]));
      for (let j = i === 0 ? 0 : 1; j < ids.length; j++) {
        const n = L.nodes[ids[j]];
        // include the curved ring points when routing along highway edges
        if (j > 0) {
          const e = L.edgeBetween(ids[j - 1], ids[j]);
          if (e && e.points.length > 2) {
            const pts = e.a === ids[j - 1] ? e.points : [...e.points].reverse();
            for (let k = 1; k < pts.length - 1; k++) route.push([pts[k][0], pts[k][1]]);
          }
        }
        route.push([n.x, n.z]);
      }
    }
    if (!route.length) { const n = nodeAt(wps[0]); route.push([n.x, n.z]); }
    // start position: 30 m along the first leg, heading along it
    const a = route[0], b = route[1] || [a[0] + 1, a[1]];
    const dirx = b[0] - a[0], dirz = b[1] - a[1], dl = Math.hypot(dirx, dirz) || 1;
    const start = { x: a[0] + dirx / dl * 30, z: a[1] + dirz / dl * 30, yaw: Math.atan2(dirx, dirz) };
    // gates at waypoints (excluding the start for sprints)
    const gateWps = def.type === 'circuit' ? [...wps.slice(1), wps[0]] : wps.slice(1);
    for (const g of route.length > 1 ? gateWps : []) {
      // incoming direction: from the previous route point before this gate
      let idx = route.findIndex((p) => Math.hypot(p[0] - g[0], p[1] - g[1]) < 1);
      if (idx <= 0) idx = 1;
      if (idx >= route.length) idx = route.length - 1;
      const p0 = route[idx - 1], p1 = route[idx];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1;
      gates.push({ x: g[0], z: g[1], dx: dx / l, dz: dz / l, w: 16 });
    }
    if (def.type === 'escape') gates.length = 0;
    return { def, route, gates, start };
  }

  _buildMarkers() {
    const beamGeo = new THREE.CylinderGeometry(2.2, 2.2, 140, 16, 1, true).translate(0, 70, 0);
    const ringGeo = new THREE.RingGeometry(5.5, 7, 40).rotateX(-Math.PI / 2);
    for (const ev of this.events) {
      const color = ev.def.type === 'escape' ? 0x3d7bff : ev.def.type === 'speedrun' || ev.def.type === 'timetrial' ? 0x37e2ff : 0xffc53d;
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }));
      const g = new THREE.Group();
      g.add(beam, ring);
      g.position.set(ev.start.x, 0.08, ev.start.z);
      g.userData.ev = ev;
      ev.marker = g;
      this.markers.add(g);
    }
  }

  nearbyEvent(x, z) {
    if (this.active) return null;
    for (const ev of this.events) if (Math.hypot(ev.start.x - x, ev.start.z - z) < 9) return ev;
    return null;
  }

  // ------------------------------------------------------------------ start
  start(ev) {
    const game = this.game;
    const def = ev.def;
    this.clearRace();
    const player = game.player;
    player.place(ev.start.x, ev.start.z, ev.start.yaw);
    game.camera && game.camCtl.snap(player);
    game.traffic?.clear();
    const race = {
      ev, def, state: 'countdown', t: -3.5, time: 0, gate: 0, lap: 1, laps: def.laps || 1,
      opponents: [], results: [], speeds: [], timeLeft: def.timeLimit || 0, finished: false, lastPos: { x: player.state.x, z: player.state.z },
    };
    this.active = race;
    this.markers.visible = false;
    // opponents on the grid behind/beside the player
    if (def.opponents) {
      // rivals drive cars from the player's class (then the class above/below) — real cars included
      let pool = this.rivalPool().filter((id) => game.lib.has(id));
      if (pool.length < 2) pool = ['kestrel', 'hikari', 'brawler', 'stratos'].filter((id) => game.lib.has(id));
      const fx = Math.sin(ev.start.yaw), fz = Math.cos(ev.start.yaw), rx = -fz, rz = fx;
      const slots = [[3.2, 0], [0, -8], [3.2, -8], [0, -16], [3.2, -16]];
      const playerRating = (game.progress?.level || 1) * 40;
      for (let i = 0; i < def.opponents; i++) {
        const carId = pool[i % pool.length];
        const params = tunedParams(carId, { engine: 1 + (i % 2), tires: 1, transmission: 1 });
        const v = new Vehicle({ carId, params, world: this.world, lib: game.lib, role: 'racer', carType: CARS[carId].carType, renderOpts: { headlights: 0, shadow: false, lodDistance: game.preset.carLod1Distance, sharedPaint: true } });
        const [lat, back] = slots[i];
        v.place(ev.start.x + rx * lat + fx * back, ev.start.z + rz * lat + fz * back, ev.start.yaw);
        if (CARS[carId].real) v.renderer.applyCustom({ paint: 'factory', finish: 'metallic', tint: 0.5 });
        else v.renderer.applyCustom({ paint: PAINTS[(i * 5 + 3) % PAINTS.length], paint2: '#111', vinyl: (i % 5) + 1, finish: 'metallic', wheel: i % 4, spoiler: 1 + (i % 3), hood: i % 3, bumper: i % 2, tint: 0.6, wheelColor: '#222428' });
        game.scene.add(v.renderer.group);
        const ai = new AIDriver(v, { skill: 0.9 + i * 0.04 + Math.min(0.12, playerRating / 5000), maxSpeed: params.maxSpeed });
        ai.setRoute(ev.route.map((p) => [p[0], p[1]]), def.type === 'circuit');
        ai.useNitro = true;
        race.opponents.push({ v, ai, name: OPP_NAMES[i], gate: 0, lap: 1, finished: false, time: 0, prev: { x: v.state.x, z: v.state.z } });
      }
    }
    this._buildGates();
    if (def.type === 'escape') { game.police.clearAll(); }
    bus.emit('race:countdown', { def });
    return race;
  }

  // cars the AI rivals may drive: same class as the player's car first, then one class up/down
  rivalPool() {
    const cur = CARS[this.game.save.data.currentCar] || CARS.kestrel;
    const ti = TIERS.indexOf(cur.tier || 'D');
    const tierOf = (id) => TIERS.indexOf(CARS[id].tier || 'D');
    const others = PLAYER_CAR_ORDER.filter((id) => id !== cur.id);
    const pick = (d) => others.filter((id) => tierOf(id) === ti + d);
    const seed = Math.floor(this.game.state.time || 0);
    const shuffle = (a) => a.map((id, i) => [((i + 1) * 7919 + seed) % 97, id]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    return [...shuffle(pick(0)), ...shuffle(pick(1)), ...shuffle(pick(-1))].slice(0, 5);
  }

  _buildGates() {
    this.gateGroup.clear();
    const race = this.active;
    if (!race) return;
    const gates = race.ev.gates;
    gates.forEach((g, i) => {
      const grp = new THREE.Group();
      const isFinish = i === gates.length - 1;
      const pylonGeo = new THREE.BoxGeometry(0.6, 6, 0.6).translate(0, 3, 0);
      const left = new THREE.Mesh(pylonGeo, this.gateMatLater), right = new THREE.Mesh(pylonGeo, this.gateMatLater);
      left.position.x = -g.w / 2; right.position.x = g.w / 2;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(g.w, 1.4), new THREE.MeshBasicMaterial({ map: isFinish ? this.finishTex : this.bannerTex, side: THREE.DoubleSide, toneMapped: false, transparent: true, opacity: 0.9, color: 0xffffff }));
      banner.position.y = 6.2;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(g.w, 0.8).rotateX(-Math.PI / 2), this.gateMatLater);
      line.position.y = 0.05;
      grp.add(left, right, banner, line);
      grp.position.set(g.x, 0, g.z);
      grp.rotation.y = Math.atan2(g.dx, g.dz);
      grp.userData = { left, right, line, banner };
      this.gateGroup.add(grp);
    });
    this._refreshGates();
  }

  _refreshGates() {
    const race = this.active;
    if (!race) return;
    this.gateGroup.children.forEach((grp, i) => {
      const rel = i - race.gate;
      const vis = rel >= 0 && rel < 2;
      grp.visible = vis;
      const m = rel === 0 ? this.gateMatNext : this.gateMatLater;
      grp.userData.left.material = m; grp.userData.right.material = m; grp.userData.line.material = m;
    });
  }

  _crossed(g, prev, now) {
    // passing through the gate zone counts (players turn inside intersections)
    if (Math.hypot(now.x - g.x, now.z - g.z) < g.w / 2 + 3) return true;
    const s0 = (prev.x - g.x) * g.dx + (prev.z - g.z) * g.dz;
    const s1 = (now.x - g.x) * g.dx + (now.z - g.z) * g.dz;
    if (!(s0 < 0 && s1 >= 0)) return false;
    const lat = Math.abs(-(now.x - g.x) * g.dz + (now.z - g.z) * g.dx);
    return lat < g.w / 2 + 3;
  }

  _progress(gate, lap, x, z) {
    const gates = this.active.ev.gates;
    const g = gates[Math.min(gate, gates.length - 1)];
    const d = g ? Math.hypot(g.x - x, g.z - z) : 0;
    return (lap - 1) * gates.length * 10000 + gate * 10000 - d;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const race = this.active;
    const game = this.game;
    // markers pulse
    if (!race) {
      const t = performance.now() / 1000;
      for (const ev of this.events) {
        const d = Math.hypot(ev.start.x - game.camera.position.x, ev.start.z - game.camera.position.z);
        ev.marker.visible = d < 900;
        ev.marker.children[1].material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
      }
      return;
    }
    const def = race.def;
    const p = game.player.state;
    race.t += dt;
    if (race.state === 'countdown') {
      const n = Math.ceil(-race.t);
      if (n !== race.lastCount && n > 0 && n <= 3) { race.lastCount = n; bus.emit('race:count', { n }); }
      game.player.controls.throttle = Math.min(game.player.controls.throttle, 1);
      game.player.controls.handbrake = 1; game.player.controls.brake = 0;
      for (const o of race.opponents) { o.v.controls.handbrake = 1; o.v.controls.throttle = 0.6; o.v.update(dt); }
      if (race.t >= 0) {
        race.state = 'racing'; race.time = 0;
        bus.emit('race:go', {});
        if (def.type === 'escape') game.police.startPursuit(def.heat || 3, 'escape');
      }
      this._syncOpponents(dt);
      return;
    }
    if (race.state === 'finished') { this._syncOpponents(dt, true); return; }
    race.time += dt;
    // --- player gates ---
    const gates = race.ev.gates;
    if (gates.length && race.gate < gates.length && this._crossed(gates[race.gate], race.lastPos, p)) {
      const g = race.gate;
      race.gate++;
      const speed = Math.hypot(p.vx, p.vz) * 3.6;
      race.speeds.push(speed);
      if (def.type === 'checkpoint') race.timeLeft += def.timeBonus;
      const lastGate = race.gate >= gates.length;
      if (lastGate && def.type === 'circuit' && race.lap < race.laps) { race.lap++; race.gate = 0; bus.emit('race:lap', { lap: race.lap, laps: race.laps }); }
      else if (lastGate) { this._finishPlayer(); }
      else bus.emit('race:checkpoint', { gate: g + 1, total: gates.length, speed: def.type === 'speedrun' ? speed : null, bonus: def.type === 'checkpoint' ? def.timeBonus : null });
      this._refreshGates();
    }
    race.lastPos = { x: p.x, z: p.z };
    // --- timers ---
    if (def.type === 'checkpoint') { race.timeLeft -= dt; if (race.timeLeft <= 0) this._fail('TIME UP'); }
    if (def.type === 'escape') {
      race.timeLeft = def.timeLimit - race.time;
      if (game.police.state === 'idle' && race.time > 2) this._finishPlayer(true);
      else if (race.timeLeft <= 0) this._fail('TIME UP');
    }
    // --- opponents ---
    const playerProg = this._progress(race.gate, race.lap, p.x, p.z);
    const obstacles = game.traffic ? game.traffic.cars : [];
    for (const o of race.opponents) {
      if (!o.finished) {
        const prog = this._progress(o.gate, o.lap, o.v.state.x, o.v.state.z);
        // rubber banding: gentle, keeps races close but beatable
        const diff = (prog - playerProg) / 10000 * 160; // meters ahead (approx)
        o.ai.powerScale = clamp(1 - diff / 900, 0.82, 1.12);
        o.v.physics.p.powerW = o.v.physics.p.enginePower * 1000 * (o.v.physics.p.acceleration || 1) * o.ai.powerScale;
        o.ai.update(dt, obstacles);
        if (o.ai.needsReset && game.recoverAI(o.v, o.ai)) { const r = o.ai.route, idx = o.ai.idx; o.ai.route = r; o.ai.idx = idx; }
        if (gates.length && o.gate < gates.length && this._crossed(gates[o.gate], o.prev, o.v.state)) {
          o.gate++;
          if (o.gate >= gates.length) {
            if (def.type === 'circuit' && o.lap < race.laps) { o.lap++; o.gate = 0; } else { o.finished = true; o.time = race.time; race.results.push({ name: o.name, time: race.time }); }
          }
        }
        // opponents that fall far behind or get stuck teleport forward along the route (off-camera)
      } else { o.v.controls.throttle = 0; o.v.controls.brake = 0.6; o.v.controls.steer = 0; }
      o.prev = { x: o.v.state.x, z: o.v.state.z };
      o.v.update(dt);
      VehiclePhysics.resolvePair(game.player.physics, o.v.physics);
    }
    for (let i = 0; i < race.opponents.length; i++) for (let j = i + 1; j < race.opponents.length; j++) VehiclePhysics.resolvePair(race.opponents[i].v.physics, race.opponents[j].v.physics);
    this._syncOpponents(dt);
    // standings
    const list = [{ name: 'YOU', prog: race.finished ? 1e9 - race.finishIndex : playerProg, me: true }];
    for (const o of race.opponents) list.push({ name: o.name, prog: o.finished ? 1e9 - race.results.findIndex((r) => r.name === o.name) : this._progress(o.gate, o.lap, o.v.state.x, o.v.state.z) });
    list.sort((a, b) => b.prog - a.prog);
    race.standings = list;
    race.position = list.findIndex((e) => e.me) + 1;
  }

  _syncOpponents(dt) {
    const game = this.game;
    for (const o of this.active?.opponents || []) o.v.sync(dt, game.camera.position, game.env.state);
  }

  _finishPlayer(escaped = false) {
    const race = this.active;
    const def = race.def;
    race.state = 'finished';
    race.finishIndex = race.results.length;
    race.results.push({ name: 'YOU', time: race.time });
    let position = race.results.length;
    let win = true;
    let reward = def.reward;
    let detail = '';
    if (def.type === 'sprint' || def.type === 'circuit') {
      win = position === 1;
      reward = position === 1 ? def.reward : position === 2 ? Math.round(def.reward * 0.4) : position === 3 ? Math.round(def.reward * 0.2) : 0;
      detail = `Position ${position} / ${race.opponents.length + 1}`;
    } else if (def.type === 'speedrun') {
      const total = race.speeds.reduce((a, b) => a + b, 0);
      win = total >= def.target;
      reward = win ? def.reward : Math.round(def.reward * 0.2);
      detail = `Speedtrap total ${Math.round(total)} km/h (target ${def.target})`;
      position = win ? 1 : 2;
    } else if (def.type === 'timetrial') {
      win = race.time <= def.target;
      reward = win ? def.reward : 0;
      detail = `Target ${def.target.toFixed(1)} s`;
      position = win ? 1 : 2;
    } else if (def.type === 'checkpoint') {
      detail = `Time left ${race.timeLeft.toFixed(1)} s`;
    } else if (def.type === 'escape') {
      detail = escaped ? 'You lost them.' : '';
    }
    this.game.police?.state !== 'idle' && def.type !== 'escape';
    bus.emit('race:finished', { def, win, position, time: race.time, reward, rep: win ? def.rep : Math.round(def.rep * 0.25), detail, typeName: RACE_TYPE_NAMES[def.type] });
    this.gateGroup.clear();
    setTimeout(() => { if (this.active === race) this.clearRace(); }, 7000);
  }

  _fail(reason) {
    const race = this.active;
    if (!race || race.state === 'finished') return;
    race.state = 'finished';
    bus.emit('race:finished', { def: race.def, win: false, position: 0, time: race.time, reward: 0, rep: 0, detail: reason, typeName: RACE_TYPE_NAMES[race.def.type], failed: true });
    this.gateGroup.clear();
    setTimeout(() => { if (this.active === race) this.clearRace(); }, 5000);
  }

  abort() { if (this.active) { bus.emit('race:aborted', {}); this.clearRace(); } }

  clearRace() {
    const race = this.active;
    if (!race) return;
    for (const o of race.opponents) o.v.dispose();
    this.gateGroup.clear();
    this.active = null;
    this.markers.visible = true;
  }

  vehicles() { return this.active ? this.active.opponents.map((o) => o.v) : []; }
  nextGate() { const r = this.active; if (!r || r.state === 'finished') return null; return r.ev.gates[r.gate] || null; }
}
void wrapAngle;
