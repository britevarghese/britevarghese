// Incidents: things that just happen on Kerala's roads, nothing scripted. Now and then two vehicles in the
// traffic somewhere ahead collide; the wrecks block the lane and traffic backs up behind them; people nearby
// gather round to look; somebody calls it in, and an ambulance and a police jeep drive there through the same
// traffic (routed on the real roads), park up with their lights going; a traffic policeman waves the traffic past;
// a recovery truck comes, lifts the wrecks onto its hook and tows them away. Crashes the player causes too.
import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';
import { bus } from '../core/EventBus.js';

const RESPONDERS = [
  { kind: 'ambulance', carId: 'ertiga', paint: '#f4f4f2' },
  { kind: 'police', carId: 'bolero', paint: 'factory' },     // (a Kerala Police jeep: white, lettered, see VehicleRenderer)
  { kind: 'crane', carId: 'lorry', paint: 'factory', speed: 13 },   // the recovery truck, a jib on its back
];
const KHAKI = { top: 0xa08a5a, bottom: 0x8c7a52 };

export class Incidents {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.t = 50 + Math.random() * 70;  // first one a minute or so in
  }

  get active() { return this.list.length > 0; }

  update(dt) {
    const g = this.game;
    if (!g.world.kerala || !g.traffic?.renderer) return;
    this.t -= dt;
    if (this.t <= 0 && this.list.length < 2) { this.t = 100 + Math.random() * 140; this.accident(); }
    for (const inc of [...this.list]) this._update(inc, dt);
  }

  // two moving vehicles, one close behind the other, 70-240 m from the player: a rear-end shunt
  accident() {
    const g = this.game, T = g.traffic, f = g.focusState;
    const cands = T.cars.filter((c) => c.state === 'drive' && c.v > 5 && !c.spec.bus && c.dist > 70 && c.dist < 240 && c.path?.kind === 'lane');
    for (const a of cands.sort(() => Math.random() - 0.5)) {
      const b = a.path.cars.find((o) => o !== a && o.state === 'drive' && o.s < a.s && a.s - o.s < 28 && o.v > 4);
      if (!b) continue;
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw), side = Math.random() < 0.5 ? 1 : -1;
      // the one in front is shoved on and spun; the one behind stops dead in the lane
      T.knock(a, fx * (a.v + 4) + fz * side * 1.5, fz * (a.v + 4) - fx * side * 1.5, side * (0.8 + Math.random()));
      T.knock(b, fx * b.v * 0.25, fz * b.v * 0.25, -side * 0.3);
      // close the gap (they did hit)
      b.x = a.x - fx * (a.spec.l + b.spec.l) / 2 * 1.02; b.z = a.z - fz * (a.spec.l + b.spec.l) / 2 * 1.02;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
      const inc = { x, z, cars: [a, b], t: 0, callAt: 6 + Math.random() * 10, called: false, responders: [], stay: 70 + Math.random() * 40, cleared: false };
      a.incident = b.incident = inc;
      this.list.push(inc);
      g.audio?.playEvent('collision', { intensity: 0.9, type: 'heavy', position: { x, y: 0.6, z } });
      g.fx?.impact(x, 0.7, z, fx, fz, 0.8, fx * 3, fz * 3);
      this._gather(inc);
      bus.emit('incident:accident', { x, z });
      return inc;
    }
    return null;
  }

  // a crash the player caused (a real smash): the wreck becomes an incident like any other
  fromCrash(c) {
    const g = this.game;
    if (!g.world.kerala || !c || c.incident || c.spec?.bike || this.list.length >= 3) return null;
    if (c.state === 'drive') g.traffic.knock(c, 0, 0, 0);   // (the driver stops where it happened)
    const inc = { x: c.x, z: c.z, cars: [c], t: 0, callAt: 4 + Math.random() * 6, called: false, responders: [], stay: 40 + Math.random() * 20, cleared: false, player: true };
    c.incident = inc;
    this.list.push(inc);
    this._gather(inc);
    return inc;
  }

  // onlookers: people nearby walk over and stand round looking; a few more turn up
  _gather(inc) {
    const P = this.game.peds;
    if (!P) return;
    const near = P.peds.filter((p) => !p.down && !p.fight && Math.hypot(p.x - inc.x, p.z - inc.z) < 60).slice(0, 6);
    // and people come out of the shops and houses to see
    for (let k = near.length; k < 4; k++) {
      P._spawnLook();
      const p = P.peds[P.peds.length - 1], a = Math.random() * Math.PI * 2;
      p.x = inc.x + Math.cos(a) * 16; p.z = inc.z + Math.sin(a) * 16;
      near.push(p);
    }
    near.forEach((p, i) => {
      const a = (i / Math.max(1, near.length)) * Math.PI * 2 + Math.random() * 0.6, r = 6 + Math.random() * 3;
      const x = inc.x + Math.cos(a) * r, z = inc.z + Math.sin(a) * r;
      p.seg = null; p.crossing = null; p.flee = null;
      p.walkTo = { x, z, then: { x, z, yaw: Math.atan2(inc.x - x, inc.z - z), talk: Math.random() < 0.4, kind: 'watch' } };
      p.stand = null;
    });
    inc.watchers = near;
  }

  _update(inc, dt) {
    const g = this.game;
    inc.t += dt;
    const f = g.focusState, d = Math.hypot(inc.x - f.x, inc.z - f.z);
    // smoke from the front car's bonnet for a while
    if (inc.t < 50 && Math.random() < dt * 6) { const c = inc.cars[0]; g.fx?.smoke?.emit(c.x + Math.sin(c.yaw) * c.spec.l * 0.35, c.y + 1, c.z + Math.cos(c.yaw) * c.spec.l * 0.35, 0.3, 1.2, 0.2, 1.2, 2.5, 3, 0.7); }
    if (!inc.called && inc.t > inc.callAt) { inc.called = true; this._dispatch(inc); bus.emit('incident:reported', { x: inc.x, z: inc.z }); }
    for (const r of inc.responders) this._drive(r, inc, dt);
    // the police on scene: an officer out in the road waving the traffic past the wrecks
    const pol = inc.responders.find((r) => r.kind === 'police' && r.arrived);
    if (pol && !inc.officer && g.humans?.ready) {
      const c = inc.cars[0], fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const h = g.humans.createMan(7, { shadow: false, outfit: KHAKI });
      if (h) {
        const x = inc.x - fx * 12, z = inc.z - fz * 12;
        h.group.position.set(x, g.world.layout.groundHeight(x, z), z); h.group.rotation.y = c.yaw + Math.PI;
        g.scene.add(h.group); h.play('talk', { hold: true, fade: 0 });
        inc.officer = h;
      }
    }
    if (inc.officer) { inc.officer.animate(0, dt); if (!inc.officer.busy) inc.officer.play('talk', { hold: true, fade: 0.2 }); }
    // the recovery truck: alongside, the wrecks lifted on its hook one after the other, then towed away
    const crane = inc.responders.find((r) => r.kind === 'crane');
    const onScene = inc.responders.length && inc.responders.every((r) => r.arrived || r.leaving);
    if (onScene) inc.sceneT = (inc.sceneT || 0) + dt;
    if (crane?.arrived && !crane.leaving && (inc.sceneT || 0) > 10) this._tow(inc, crane, dt);
    if (crane?.leaving) {
      this._hook(inc, crane);
      crane.goneT = (crane.goneT || 0) + dt;
      const cd = Math.hypot(crane.v.state.x - f.x, crane.v.state.z - f.z);
      if (crane.goneT > 45 || (crane.goneT > 8 && cd > 160)) this._clear(inc);
      else if (inc.t > 500) this._clear(inc);
      return;
    }
    if ((!crane && (inc.sceneT || 0) > inc.stay) || d > 600 || inc.t > 400) this._clear(inc);
  }

  // lift each wreck in turn (1.4 m over 3 s), then the truck drives off with them in tow
  _tow(inc, crane, dt) {
    const g = this.game, T = inc.tow ||= { t: 0 };
    T.t += dt;
    const s = crane.v.state, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    inc.cars.forEach((c, i) => {
      const k = Math.max(0, Math.min(1, (T.t - i * 3) / 3));
      if (k <= 0) return;
      if (c.state !== 'hoisted') { c.state = 'hoisted'; c.baseY = c.y; c.liftFrom = { x: c.x, z: c.z, yaw: c.yaw }; }
      // swung round behind the truck as it rises
      const tx = s.x - fx * (crane.v.physics.p.length / 2 + c.spec.l / 2 + 0.6 + i * (c.spec.l + 0.8)), tz = s.z - fz * (crane.v.physics.p.length / 2 + c.spec.l / 2 + 0.6 + i * (c.spec.l + 0.8));
      c.x = c.liftFrom.x + (tx - c.liftFrom.x) * k; c.z = c.liftFrom.z + (tz - c.liftFrom.z) * k;
      let dy = s.yaw - c.liftFrom.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw = c.liftFrom.yaw + dy * k; c.y = c.baseY + Math.sin(k * Math.PI) * 1.4 + k * 0.5; c.pitch = -0.12 * k; c.roll = 0;
    });
    if (T.t > inc.cars.length * 3 + 1) {
      // off it goes: anywhere a few hundred metres away
      const L = g.world.layout, from = L.nearestNode(s.x, s.z);
      const far = L.nodes.slice(0, g.world.router?.nj ?? L.nodes.length).filter((n) => { const dd = Math.hypot(n.x - s.x, n.z - s.z); return dd > 300 && dd < 600; });
      const to = far[Math.floor(Math.random() * far.length)], ids = from && to ? L.route(from, to) : [];
      if (ids.length > 2) crane.ai.setRoute(ids.map((id) => [L.nodes[id].x, L.nodes[id].z]).slice(1), false, 0);
      crane.ai.mode = 'route'; crane.leaving = true; crane.arrived = false;
      for (const r of inc.responders) if (r !== crane) r.leaving = true;   // (the rest pack up too)
    }
  }

  // the wrecks follow the truck on its hook
  _hook(inc, crane) {
    const s = crane.v.state, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), gh = this.game.world.layout.groundHeight;
    inc.cars.forEach((c, i) => {
      const back = crane.v.physics.p.length / 2 + c.spec.l / 2 + 0.6 + i * (c.spec.l + 0.8);
      c.x = s.x - fx * back; c.z = s.z - fz * back; c.yaw = s.yaw;
      c.y = gh(c.x, c.z, s.y + 1) + 0.5; c.pitch = -0.12;
    });
  }

  // an ambulance and a police jeep set off from a few hundred metres away, routed on the roads
  _dispatch(inc) {
    const g = this.game, L = g.world.layout, R = g.world.router;
    if (!R) return;
    const goal = L.nearestNode(inc.x, inc.z);
    if (!goal) return;
    for (const def of RESPONDERS) {
      const TV = TRAFFIC_VEHICLES[def.carId];
      if (!TV || !g.lib.has(def.carId)) continue;
      // a start node 250-450 m away with a route in
      let route = null;
      const ring = L.nodes.slice(0, R.nj).filter((n) => { const dd = Math.hypot(n.x - inc.x, n.z - inc.z); return dd > 250 && dd < 450; });
      for (let k = 0; k < 12 && !route && ring.length; k++) {
        const n = ring[Math.floor(Math.random() * ring.length)];
        const ids = L.route(n, goal);
        if (ids.length > 3) route = ids.map((id) => [L.nodes[id].x, L.nodes[id].z]);
      }
      if (!route) continue;
      const v = new Vehicle({ carId: def.carId, params: { ...TV.params, enginePower: TV.params.enginePower * 1.3 }, world: g.world, lib: g.lib, role: 'police', carType: TV.carType, renderOpts: { police: def.kind !== 'crane', headlights: 0, shadow: false, lodDistance: g.preset.carLod1Distance, sharedPaint: false } });
      v.renderer.applyCustom({ paint: def.paint, finish: 'gloss', wheel: 0, tint: 0.3 });
      if (def.kind === 'crane') this._jib(v);
      const [x0, z0] = route[0], [x1, z1] = route[Math.min(2, route.length - 1)];
      v.place(x0, z0, Math.atan2(x1 - x0, z1 - z0));
      g.scene.add(v.renderer.group);
      const ai = new AIDriver(v, { skill: 0.85, maxSpeed: def.speed || 17 });
      // stop short of the wrecks, on the kerb side
      route.push([inc.x, inc.z]);
      ai.setRoute(route.slice(1), false, 0); // (it starts on the first point)
      v.renderer.sirenOn = def.kind !== 'crane';
      inc.responders.push({ v, ai, kind: def.kind, arrived: false, id: 'resp' + Math.random().toString(36).slice(2, 8) });
    }
  }

  _drive(r, inc, dt) {
    const g = this.game, v = r.v, s = v.state;
    const d = Math.hypot(inc.x - s.x, inc.z - s.z);
    if (r.leaving && r.kind !== 'crane') { r.v.renderer.sirenOn = false; }
    if (!r.arrived && !r.leaving && d < (r.kind === 'ambulance' ? 13 : r.kind === 'crane' ? 11 : 18)) { r.arrived = true; r.ai.mode = 'park'; }
    // stuck (a jam, a wrong turn, a wall): re-route from here; still stuck, hop along the route out of sight
    if (!r.arrived && !r.leaving) {
      if (d < (r.best ?? Infinity) - 3) { r.best = d; r.stuckT = 0; } else r.stuckT = (r.stuckT || 0) + dt;
      if (r.stuckT > 10) {
        r.stuckT = 0; r.tries = (r.tries || 0) + 1;
        const L = g.world.layout, from = L.nearestNode(s.x, s.z), to = L.nearestNode(inc.x, inc.z);
        const ids = from && to ? L.route(from, to) : [];
        const pts = ids.map((id) => [L.nodes[id].x, L.nodes[id].z]);
        const f = g.focusState;
        if (r.tries >= 2 && pts.length > 4) {
          // out of the player's sight: jump ahead along the way in
          const k = pts.findIndex((q, i) => i > 2 && Math.hypot(q[0] - f.x, q[1] - f.z) > 90 && Math.hypot(q[0] - inc.x, q[1] - inc.z) < d - 60);
          if (k > 0 && Math.hypot(s.x - f.x, s.z - f.z) > 90) { const q = pts[k], q2 = pts[Math.min(k + 2, pts.length - 1)]; v.place(q[0], q[1], Math.atan2(q2[0] - q[0], q2[1] - q[1])); pts.splice(0, k); }
        }
        if (pts.length > 1) { pts.push([inc.x, inc.z]); r.ai.setRoute(pts.slice(1), false, 0); }
      }
    }
    // parked up: brake to a stop, then the handbrake (holding the brake at a standstill would reverse)
    if (r.arrived) { const sp = Math.hypot(s.vx, s.vz); v.controls.throttle = 0; v.controls.steer = 0; v.controls.brake = sp > 1 ? 1 : 0; v.controls.handbrake = sp > 1 ? 0 : 1; }
    else r.ai.update(dt, g.traffic.cars);
    if (r.ai.needsReset) { r.ai.needsReset = false; g.recoverAI?.(v, r.ai); }
    v.update(dt);
    v.sync(dt, g.camera.position, g.env.state);
  }

  _clear(inc) {
    const g = this.game;
    for (const r of inc.responders) { r.v.dispose(); }
    inc.responders = [];
    if (inc.officer) { inc.officer.group.removeFromParent(); inc.officer = null; }
    for (const c of inc.cars) { c.incident = null; g.traffic.remove(c); }   // towed away
    for (const p of inc.watchers || []) if (p.stand?.kind === 'watch' || p.walkTo) { p.stand = null; p.walkTo = null; p.flee = { x: p.x, z: p.z, vx: Math.sin(p.yaw + Math.PI) * 1.3, vz: Math.cos(p.yaw + Math.PI) * 1.3, t: 12 }; p.speed = 1.3; }
    this.list.splice(this.list.indexOf(inc), 1);
    bus.emit('incident:cleared', { x: inc.x, z: inc.z });
  }

  // the recovery truck's crane: a yellow jib and its cable over the back
  _jib(v) {
    const r = v.renderer, body = r.body; body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body), inv = new THREE.Matrix4().copy(body.matrixWorld).invert();
    box.applyMatrix4(inv);
    const yel = new THREE.MeshStandardMaterial({ color: 0xe8b818, roughness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), yel); post.position.set(0, box.max.y + 0.6, box.min.z + 1.6); g.add(post);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.6), yel); boom.position.set(0, box.max.y + 1.5, box.min.z + 0.4); boom.rotation.x = -0.35; g.add(boom);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4), dark); cable.position.set(0, box.max.y + 1.2, box.min.z - 1.1); g.add(cable);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa020 })); beacon.position.set(0, box.max.y + 0.1, box.max.z - 1.2); g.add(beacon);
    body.add(g);
  }

  // responders: other vehicles (traffic and pedestrians react to them), sirens for the audio
  vehicles() { const out = []; for (const inc of this.list) for (const r of inc.responders) out.push(r.v); return out; }
  sirenList() {
    const out = [];
    for (const inc of this.list) for (const r of inc.responders) if (!r.arrived) out.push({ id: r.id, position: { x: r.v.state.x, y: 1, z: r.v.state.z }, velocity: { x: r.v.state.vx, y: 0, z: r.v.state.vz }, intensity: 0.5 });
    return out;
  }
  clearAll() { for (const inc of [...this.list]) this._clear(inc); }
}
