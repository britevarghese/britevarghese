// On foot (GTA-style): leave the car with F, walk/sprint around the city, get back in, or take any car
// on the street, including the ones other players left parked (multiplayer). Carjacking a traffic car
// throws the driver out and turns the car into a drivable vehicle; your previous car stays parked
// where you left it (and returns to your garage if you wander far away). The police can chase and arrest you on foot.
import * as THREE from 'three';
import { clamp, damp } from '../core/util.js';
import { Vehicle, FIXED_DT } from '../vehicles/Vehicle.js';
import { CARS, TRAFFIC_VEHICLES, POLICE_CAR, tunedParams } from '../vehicles/VehicleCatalog.js';
import { bus } from '../core/EventBus.js';

// turn an angle toward a target by at most k (radians, shortest way)
const turn = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + clamp(d, -k, k); };
const vehicleWord = (id) => (CARS[id]?.bike ? 'bike' : 'car');
const WALK = 1.7, RUN = 6.2, RADIUS = 0.34, ENTER_DIST = 3.4;
const _v = new THREE.Vector3();

export function buildCharacter(look = {}) {
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: look.jacket ?? 0x1d2330, roughness: 0.75 });
  const jeans = new THREE.MeshStandardMaterial({ color: look.jeans ?? 0x2b3547, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: look.skin ?? 0xb58868, roughness: 0.7 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: look.hair ?? 0x1a1410, roughness: 0.9 });
  const box = (w, h, d, m, y = 0) => { const geo = new THREE.BoxGeometry(w, h, d); geo.translate(0, y, 0); const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; return mesh; };
  const limb = (w, len, d, m, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); p.add(box(w, len, d, m, -len / 2)); g.add(p); return p; };
  const torso = box(0.44, 0.6, 0.24, jacket, 1.2); g.add(torso);
  const neck = box(0.1, 0.08, 0.1, skin, 1.54); g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), skin); head.scale.set(1, 1.18, 1.08); head.position.y = 1.7; head.castShadow = true; g.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair); cap.position.y = 1.73; g.add(cap);
  const hips = box(0.4, 0.14, 0.22, jeans, 0.86); g.add(hips);
  const legL = limb(0.15, 0.84, 0.17, jeans, 0.11, 0.86), legR = limb(0.15, 0.84, 0.17, jeans, -0.11, 0.86);
  for (const l of [legL, legR]) { const s = box(0.15, 0.08, 0.27, shoe, -0.84); s.position.z = 0.05; l.add(s); }
  const armL = limb(0.11, 0.56, 0.12, jacket, 0.29, 1.47), armR = limb(0.11, 0.56, 0.12, jacket, -0.29, 1.47);
  for (const a of [armL, armR]) a.add(box(0.09, 0.1, 0.09, skin, -0.61));
  return { group: g, legL, legR, armL, armR, torso, head };
}

export class OnFoot {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.state = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, speed: 0, rpm: 0, onGround: true, pitch: 0, roll: 0 };
    // body.group is a container: the realistic character once the people models have loaded
    // (useHuman), the simple built-in figure until then
    this.box = buildCharacter();
    this.body = { group: new THREE.Group() };
    this.body.group.add(this.box.group);
    this.body.group.visible = false;
    game.scene.add(this.body.group);
    this.camYaw = 0; this.camPitch = 0.18; this.camDist = 4.2;
    this.phase = 0; this.vy = 0;
    this.camPos = new THREE.Vector3();
    this.parked = [];        // cars left behind (still physical, drawn, collidable)
  }

  // swap the built-in figure for the realistic character (people models loaded)
  useHuman() {
    const h = this.game.humans?.create('pmariano', { shadow: this.game.preset.shadows !== 'off' });
    if (!h || this.human) return;
    this.human = h;
    this.box.group.visible = false;
    this.body.group.add(h.group);
  }

  // ------------------------------------------------------------------ get out / get in
  exit() {
    const g = this.game, v = g.player, s = v.state;
    if (Math.hypot(s.vx, s.vz) > 8) { g.ui.toast('Slow down to get out', '', 1.5); return false; }
    const L = (v.p.width || 1.9) / 2 + 0.55;
    const side = [1, -1].find((k) => this._free(s.x + Math.cos(s.yaw) * L * k, s.z - Math.sin(s.yaw) * L * k)) ?? 1;
    this.state.x = s.x + Math.cos(s.yaw) * L * side; this.state.z = s.z - Math.sin(s.yaw) * L * side;
    this.state.y = this._ground(this.state.x, this.state.z);
    this.state.yaw = s.yaw; this.state.vx = this.state.vz = 0;
    this.camYaw = s.yaw; this.vy = 0;
    this.active = true;
    this.body.group.visible = true;
    this.car = v;                     // the car we just left: parked
    v.renderer?.setRider?.(false);    // a bike keeps no rider on it
    v.controls.throttle = 0; v.controls.brake = 0; v.controls.handbrake = 1; v.controls.steer = 0; v.controls.nitro = false;
    this.camPos.copy(g.camera.position);
    g.audio?.setEngineOn?.(false);
    document.getElementById('hud')?.classList.add('onfoot');
    bus.emit('player:onfoot', { on: true });
    // getting out of a car: seated behind the wheel, open the door, swing the legs out, stand up,
    // step clear and push the door shut
    if (this.human && !v.p.bike) {
      const G = this._doorGeo(v, side);
      this.seq = { kind: 'exit', v, side, G, i: -1, t: 0, steps: [
        { dur: 0.4, face: 'fwd', clip: ['sitIdle', { hold: true, fade: 0 }], at: 0.08, door: true },
        { dur: 0.35, face: 'out', to: [G.hx - 0.22, G.seatZ] },
        { dur: 0.95, face: 'out', to: G.entry, clip: ['sitExit', { rate: 1.15, fade: 0.1 }], ease: true },
        { dur: 0.6, face: 'move', to: G.handle, walk: true, skip: true },
        { dur: 0.75, face: 'in', clip: ['interact', { rate: 1.9 }], at: 0.3, door: false, skip: true },
      ] };
      this._place(G.seat[0], G.seat[1]);
      this.state.yaw = s.yaw;
      this._nextStep();
    }
    return true;
  }

  // nearest enterable vehicle: our car, a parked car, or a traffic car
  nearestVehicle() {
    const g = this.game, s = this.state;
    let best = null, bd = ENTER_DIST;
    const consider = (kind, ref, x, z, extra = 0) => { const d = Math.hypot(x - s.x, z - s.z) - extra; if (d < bd) { bd = d; best = { kind, ref }; } };
    if (g.player && !g.player.gone) consider('own', g.player, g.player.state.x, g.player.state.z, 0.9);
    for (const v of this.parked) consider('parked', v, v.state.x, v.state.z, 0.9);
    for (const px of g.net?.proxies() || []) if (px.k) consider('remote', px, px.s.x, px.s.z, 0.9);
    // stopped police cruisers and street-rival cars can be taken too
    for (const u of g.police?.units || []) { const vs = u.vehicle.state; if (Math.hypot(vs.vx, vs.vz) < 2) consider('police', u, vs.x, vs.z, 0.9); }
    if (!g.story?.active) for (const r of g.rivals?.rivals || []) { const vs = r.v.state; if (Math.hypot(vs.vx, vs.vz) < 2) consider('rival', r, vs.x, vs.z, 0.9); }
    for (const c of g.traffic?.cars || []) if (TRAFFIC_VEHICLES[c.type]) consider('traffic', c, c.x, c.z, c.spec?.w ? c.spec.w * 0.5 : 0.9);
    return best;
  }

  enter(target) {
    const g = this.game;
    if (target.kind === 'remote') { g.net.requestTake(target.ref); return false; } // the server hands it over (enterTaken)
    let v;
    if (target.kind === 'own') v = g.player;
    else if (target.kind === 'parked') {
      v = target.ref;
      this.parked.splice(this.parked.indexOf(v), 1);
      if (g.player !== v) this._park(g.player);
    } else if (target.kind === 'police' || target.kind === 'rival') {
      v = target.kind === 'police' ? g.police.release(target.ref) : g.rivals.release(target.ref);
      if (!v) return false;
      v.role = 'player'; v.fixedDt = FIXED_DT; v.stolen = true;
      v.controls.throttle = v.controls.brake = v.controls.steer = 0; v.controls.nitro = false;
      if (target.kind === 'police') { g.police?.reportInfraction('carjack', 3); g.ui.toast('Stole a police cruiser', '', 2); }
      else g.ui.toast(`Took ${target.ref.crew?.name || 'the rival'}'s ${CARS[v.carId]?.name || 'car'}`, '', 2);
      this._park(g.player);
    } else {
      v = this._jack(target.ref);
      if (!v) return false;
      this._park(g.player);
    }
    if (this.human) { this._startEnter(v); return true; }
    this._board(v);
    return true;
  }

  // walk up to the driver's door (on the side we're standing), open it, step into the opening and sit in
  _startEnter(v) {
    const s = this.state, vs = v.state;
    const lx = Math.cos(vs.yaw), lz = -Math.sin(vs.yaw);
    const side = Math.sign((s.x - vs.x) * lx + (s.z - vs.z) * lz) || 1;
    if (v !== this.game.player && !this.parked.includes(v)) this.parked.push(v); // keep it simulated and drawn meanwhile
    v.keep = true;
    const G = this._doorGeo(v, side);
    this.seq = { kind: 'enter', v, side, G, i: -1, t: 0, steps: v.p.bike ? [] : [
      { dur: 0.9, face: 'in', clip: ['interact', { rate: 1.8 }], at: 0.32, door: true },
      { dur: 0.5, face: 'out', to: G.entry, walk: true },
      { dur: 0.95, face: 'out', to: [G.hx - 0.05, G.seatZ], clip: ['sitEnter', { rate: 1.35, hold: true }], ease: true },
      { dur: 0.45, face: 'fwd', to: G.seat, ease: true },
    ] };
    this.seq.walkTo = v.p.bike ? [0.6, -0.1] : G.handle;
    this.game.hud.setPrompt(null);
  }

  // where the door, the seat and the door handle are, in the car's frame: [out from the centre line
  // towards this side, forward]. Imported cars carry their real hinge; others get a typical layout.
  _doorGeo(v, side) {
    const d = v.renderer?.doors?.[side], half = (v.p.width || 1.9) / 2;
    const hx = d ? Math.abs(d.hinge.x) : half, hz = d ? d.hinge.z : (v.p.length || 4.5) * 0.06 + 0.6, len = d?.len || 1.1;
    const seatZ = hz - len * 0.62;
    return { hx, hz, len, seatZ, door: !!d, seat: [hx - 0.45, seatZ], entry: [hx + 0.3, seatZ], handle: [hx + 0.5, hz - len - 0.14] };
  }

  // car-frame point -> world
  _local(v, side, out, fwd) {
    const vs = v.state, c = Math.cos(vs.yaw), sn = Math.sin(vs.yaw);
    return [vs.x + c * side * out + sn * fwd, vs.z - sn * side * out + c * fwd];
  }
  _place(out, fwd) { const q = this.seq, [x, z] = this._local(q.v, q.side, out, fwd); this.state.x = x; this.state.z = z; }

  _nextStep() {
    const q = this.seq;
    q.i++; q.t = 0; q.fired = false;
    const st = q.steps[q.i];
    if (!st) return false;
    q.from = [this.state.x, this.state.z];
    if (st.clip) this.human.play(st.clip[0], st.clip[1]);
    return true;
  }

  _door(q, open) {
    const v = q.v, g = this.game;
    if (!v.renderer?.setDoor?.(q.side, open)) return;
    const [x, z] = this._local(v, q.side, q.G.hx, q.G.hz - q.G.len / 2);
    const position = { x, y: 0.9, z };
    if (open) g.audio?.playEvent('doorOpen', { position });
    else v.renderer.onDoorShut = () => { v.renderer.onDoorShut = null; g.audio?.playEvent('doorShut', { position }); };
  }

  // take the wheel: the car becomes the player's vehicle
  _board(v) {
    const g = this.game;
    const i = this.parked.indexOf(v); if (i >= 0 && v !== g.player) this.parked.splice(i, 1);
    if (v !== g.player && g.player && !this.parked.includes(g.player) && !g.player.gone) this._park(g.player);
    v.keep = false;
    g.player = v;
    v.controls.handbrake = 0;
    v.renderer?.setRider?.(true);
    this.active = false;
    this.body.group.visible = false;
    this.human?.clearAction(0);
    g.camCtl.snap(v);
    g.audio?.setEngineOn?.(true);
    document.getElementById('hud')?.classList.remove('onfoot');
    bus.emit('player:onfoot', { on: false, vehicle: v });
  }

  // scripted get-in / get-out moves (the player has no control meanwhile, except to skip the last,
  // walking-away part of getting out)
  _updateSeq(dt, input) {
    const q = this.seq, s = this.state, v = q.v, vs = v.state;
    let speed = 0;
    const face = (dir, k = 9) => {
      const c = Math.cos(vs.yaw), sn = Math.sin(vs.yaw);
      const out = [c * q.side, -sn * q.side], fwd = [sn, c];
      const d = dir === 'out' ? out : dir === 'in' ? [-out[0], -out[1]] : fwd;
      s.yaw = turn(s.yaw, Math.atan2(d[0], d[1]), dt * k);
    };
    if (q.walkTo) {
      // walk up to the door handle
      const [tx, tz] = this._local(v, q.side, q.walkTo[0], q.walkTo[1]);
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
      q.t += dt;
      if (d > 0.12 && q.t < 6) {
        speed = Math.min(d > 3 ? 3.2 : 1.6, d / dt);
        s.x += dx / d * speed * dt; s.z += dz / d * speed * dt;
        s.yaw = turn(s.yaw, Math.atan2(dx, dz), dt * 10);
      } else { q.walkTo = null; if (!this._nextStep()) { this.seq = null; this._board(v); return; } }
    } else {
      const st = q.steps[q.i];
      q.t += dt;
      const ic = input?.controls;
      if (st.skip && ic && Math.hypot((ic.throttle || 0) - (ic.brake || 0), ic.steer || 0) > 0.3) {
        // the player wants to go: let go of the door (it swings shut on its own)
        if (q.G.door) this._door(q, false);
        this.human.clearAction(0.15); this.seq = null; return;
      }
      if (st.at !== undefined && !q.fired && q.t >= st.at) { q.fired = true; this._door(q, st.door); }
      if (st.to) {
        const k = Math.min(1, q.t / st.dur), e = st.ease ? k * k * (3 - 2 * k) : k;
        const [tx, tz] = this._local(v, q.side, st.to[0], st.to[1]);
        const nx = q.from[0] + (tx - q.from[0]) * e, nz = q.from[1] + (tz - q.from[1]) * e;
        if (st.walk) speed = Math.hypot(tx - q.from[0], tz - q.from[1]) / st.dur;
        if (st.face === 'move' && Math.hypot(nx - s.x, nz - s.z) > 1e-4) s.yaw = turn(s.yaw, Math.atan2(nx - s.x, nz - s.z), dt * 10);
        s.x = nx; s.z = nz;
      }
      if (st.face !== 'move') face(st.face);
      if (q.t >= st.dur && !this._nextStep()) {
        const done = this.seq; this.seq = null;
        if (done.kind === 'enter') { this._board(v); setTimeout(() => this._door(done, false), 200); }
        return;
      }
    }
    // low cars sit you lower: sink as the hips pass the sill
    const o = (s.x - vs.x) * Math.cos(vs.yaw) * q.side - (s.z - vs.z) * Math.sin(vs.yaw) * q.side;
    const drop = clamp((1.42 - (CARS[v.carId]?.spec?.hgt || 1.42)) * 0.7, 0, 0.2);
    s.y = this._ground(s.x, s.z) - drop * clamp((q.G.hx + 0.1 - o) / 0.45, 0, 1);
    s.vx = s.vz = 0; s.speed = speed;
    this._pose(dt);
  }

  // another player's parked car, handed over by the server: it appears here, we get in
  enterTaken(c, ownerName) {
    const g = this.game;
    if (!this.active) return false;
    const car = CARS[c.car], tv = TRAFFIC_VEHICLES[c.car];
    const def = car || tv || (c.car === 'interceptor' ? POLICE_CAR : TRAFFIC_VEHICLES.sedan);
    const id = car || tv || c.car === 'interceptor' ? c.car : 'sedan';
    if (!g.lib.has(id)) { g.lib.load([id], 1).then(() => this.enterTaken({ ...c, car: id }, ownerName)); return false; }
    const params = car ? tunedParams(id, {}) : { ...def.params };
    const v = new Vehicle({ carId: id, params, world: g.world, lib: g.lib, role: 'player', carType: def.carType, renderOpts: { headlights: g.preset.headlightSpots, shadow: g.preset.shadows !== 'off', lodDistance: 1e9 } });
    v.renderer.applyCustom({ paint: c.paint || '#888888', finish: 'metallic', tint: 0.4, ...(car?.real ? car.look : {}) });
    v.renderer.enableDents?.();
    g.scene.add(v.renderer.group);
    v.place(c.p[0], c.p[2], c.yaw);
    v.stolen = true;
    this._park(g.player);
    g.player = v;
    this.active = false;
    this.body.group.visible = false;
    g.camCtl.snap(v);
    g.audio?.setEngineOn?.(true);
    document.getElementById('hud')?.classList.remove('onfoot');
    g.ui.toast(`Took ${ownerName ? ownerName + "'s" : 'a'} ${def.name || car?.name || 'car'}`, '', 2.5);
    bus.emit('player:onfoot', { on: false, vehicle: v });
    return true;
  }

  _park(v) {
    if (!v || v.gone || this.parked.includes(v)) return;
    v.controls.throttle = 0; v.controls.brake = 0; v.controls.handbrake = 1; v.controls.steer = 0; v.controls.nitro = false;
    this.parked.push(v);
  }

  // turn a traffic car into a drivable vehicle at the same spot; the driver bails out and runs
  _jack(c) {
    const g = this.game, def = TRAFFIC_VEHICLES[c.type];
    if (!def || !g.lib.has(c.type)) return null;
    const v = new Vehicle({ carId: c.type, params: { ...def.params }, world: g.world, lib: g.lib, role: 'player', carType: def.carType, renderOpts: { headlights: g.preset.headlightSpots, shadow: g.preset.shadows !== 'off', lodDistance: 1e9 } });
    const col = '#' + new THREE.Color(c.color ?? 0x888888).getHexString();
    v.renderer.applyCustom({ paint: col, finish: 'gloss', wheel: 0, tint: 0.2 });
    v.renderer.enableDents?.();
    g.scene.add(v.renderer.group);
    v.place(c.x, c.z, c.yaw);
    v.stolen = true;
    g.traffic.remove(c);
    g.peds?.spawnFleeing?.(c.x + Math.cos(c.yaw) * 1.6, c.z - Math.sin(c.yaw) * 1.6, this.state.x, this.state.z);
    g.audio?.playEvent('collision', { intensity: 0.15, type: 'light', position: { x: c.x, y: 0.5, z: c.z } });
    g.police?.reportInfraction('carjack', 1, 35); // only if a cop is watching
    g.ui.toast(`Stole a ${def.name}`, '', 2);
    bus.emit('player:carjack', { type: c.type });
    return v;
  }

  // ------------------------------------------------------------------ movement
  _ground(x, z) { return this.game.world.layout.groundHeight(x, z); }

  _free(x, z) {
    const tmp = this._tmp || (this._tmp = []);
    this.game.world.collision.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6, tmp);
    for (const c of tmp) {
      if (c.h < this.state.y + 0.5) continue;
      const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin, lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos;
      if (Math.abs(lx) < c.hx + RADIUS && Math.abs(lz) < c.hz + RADIUS) return false;
    }
    return true;
  }

  // push the character out of static colliders and vehicles (oriented boxes)
  _resolve() {
    const s = this.state, g = this.game;
    const tmp = this._tmp || (this._tmp = []);
    g.world.collision.query(s.x - 1, s.z - 1, s.x + 1, s.z + 1, tmp);
    const push = (cx, cz, cos, sin, hx, hz) => {
      const lx = (s.x - cx) * cos - (s.z - cz) * sin, lz = (s.x - cx) * sin + (s.z - cz) * cos;
      const ox = hx + RADIUS - Math.abs(lx), oz = hz + RADIUS - Math.abs(lz);
      if (ox <= 0 || oz <= 0) return;
      let nx = 0, nz = 0;
      if (ox < oz) nx = Math.sign(lx) * ox; else nz = Math.sign(lz) * oz;
      // back to world space (inverse rotation)
      s.x += nx * cos + nz * sin; s.z += -nx * sin + nz * cos;
    };
    for (const c of tmp) if (c.h > s.y + 0.4) push(c.cx, c.cz, c.cos, c.sin, c.hx, c.hz);
    const car = (x, z, yaw, w, l) => push(x, z, Math.cos(yaw), Math.sin(yaw), w / 2, l / 2);
    for (const v of [g.player, ...this.parked, ...(g.police?.vehicles() || []), ...(g.races?.vehicles() || []), ...(g.rivals?.vehicles() || []), ...(g.net?.proxies() || [])]) {
      if (!v || v.gone) continue; const vs = v.state; if (Math.abs(vs.x - s.x) > 8 || Math.abs(vs.z - s.z) > 8) continue;
      car(vs.x, vs.z, vs.yaw, v.p.width || 1.9, v.p.length || 4.5);
    }
    for (const c of g.traffic?.cars || []) {
      if (Math.abs(c.x - s.x) > 10 || Math.abs(c.z - s.z) > 10) continue;
      const w = c.spec?.w || 1.9, l = c.spec?.l || 4.6;
      // moving traffic knocks you aside
      const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
      const lx = (s.x - c.x) * cos - (s.z - c.z) * sin, lz = (s.x - c.x) * sin + (s.z - c.z) * cos;
      if (Math.abs(lx) < w / 2 + RADIUS && Math.abs(lz) < l / 2 + RADIUS && (c.v || 0) > 4 && !this.knockT) {
        this.knockT = 1.2; this.vy = 3.5;
        const dir = Math.sign(lx) || 1; s.vx = Math.cos(c.yaw) * dir * 6; s.vz = -Math.sin(c.yaw) * dir * 6;
        g.audio?.playEvent('collision', { intensity: 0.35, type: 'light', position: { x: s.x, y: 0.8, z: s.z } });
        g.camCtl.addShake(0.6);
      }
      car(c.x, c.z, c.yaw, w, l);
    }
  }

  update(dt, input) {
    if (this.seq) { this._updateSeq(dt, input); return; }
    const s = this.state, g = this.game, ic = input.controls;
    // camera-relative movement
    const fwdIn = (ic.throttle || 0) - (ic.brake || 0), sideIn = -(ic.steer || 0);
    const mag = Math.min(1, Math.hypot(fwdIn, sideIn));
    const run = ic.nitro;
    let tx = 0, tz = 0;
    if (mag > 0.05 && !this.knockT) {
      const cy = this.camYaw;
      const dx = Math.sin(cy) * fwdIn + Math.cos(cy) * sideIn, dz = Math.cos(cy) * fwdIn - Math.sin(cy) * sideIn;
      const l = Math.hypot(dx, dz) || 1, sp = (run ? RUN : WALK) * mag;
      tx = dx / l * sp; tz = dz / l * sp;
      let d = Math.atan2(dx, dz) - s.yaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      s.yaw += d * Math.min(1, dt * 12);
    }
    const acc = this.knockT ? 1.5 : 10;
    const wasGround = s.onGround !== false;
    s.vx = damp(s.vx, tx, acc, dt); s.vz = damp(s.vz, tz, acc, dt);
    s.x += s.vx * dt; s.z += s.vz * dt;
    // gravity / jump (space)
    const gy = this._ground(s.x, s.z);
    if (input.consume('jump') && s.y <= gy + 0.02) this.vy = 4.2;
    this.vy -= 9.81 * dt; s.y += this.vy * dt;
    if (s.y <= gy) { s.y = gy; this.vy = 0; }
    s.onGround = s.y <= gy + 0.02;
    this._resolve();
    if (this.knockT) { this.knockT = Math.max(0, this.knockT - dt); if (!this.knockT) this.knockT = 0; }
    s.speed = Math.hypot(s.vx, s.vz);
    if (this.human) {
      if (!wasGround && s.onGround) this.human.play('jumpLand', { rate: 2, fade: 0.08 });
      if (this.knockT > 1.1 && !this.human.busy) this.human.play('hit', { rate: 0.8 });
    }
    this._pose(dt);
    // footsteps
    const v = s.speed;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && v > 0.6 && s.onGround) { this.lastStep = step; g.audio?.playFootstep?.(v > 3, { x: s.x, y: s.y, z: s.z }); }
    // enter a vehicle
    const near = this.nearestVehicle();
    const what = { traffic: 'steal this car', police: 'steal the police car', rival: 'take their car', remote: `take ${g.net?.names.get(near?.ref.owner) || 'their'}'s ${vehicleWord(near?.ref.carId)}` }[near?.kind] || 'get in';
    g.hud.setPrompt(near ? `press <span class="key">F</span> / <span class="key">Y</span> to ${g.net?.pendingTake && near.kind === 'remote' ? 'wait...' : what}` : null);
    if (near && input.consume('enter')) this.enter(near);
  }

  // place and animate the body for this frame
  _pose(dt) {
    const s = this.state, b = this.box, v = s.speed;
    this.phase += dt * (v > 3 ? 1.6 + v * 0.95 : 2.2 + v * 2.6);
    const body = this.body.group;
    if (this.human) {
      body.position.set(s.x, s.y, s.z);
      body.rotation.set(0, s.yaw, 0);
      body.updateMatrixWorld(true);
      this.human.animate(v, dt, s.onGround === false);
    } else {
      const sw = Math.min(1, v / 2) * (v > 3 ? 0.95 : 0.55);
      b.legL.rotation.x = Math.sin(this.phase) * sw; b.legR.rotation.x = -Math.sin(this.phase) * sw;
      b.armL.rotation.x = -Math.sin(this.phase) * sw * 0.8; b.armR.rotation.x = Math.sin(this.phase) * sw * 0.8;
      body.position.set(s.x, s.y + Math.abs(Math.sin(this.phase)) * 0.04 * Math.min(1, v / 2), s.z);
      body.rotation.set(v > 3 ? 0.12 : 0, s.yaw, this.knockT ? Math.sin(this.knockT * 6) * 0.4 : 0);
    }
  }

  // third-person camera: mouse / right stick orbit, eases in behind while walking
  updateCamera(dt, input, cam) {
    const s = this.state, ic = input.controls;
    if (ic.mouseLook || Math.abs(ic.lookX) > 0.01 || Math.abs(ic.lookY) > 0.01) {
      this.camYaw -= ic.lookX * (ic.mouseLook ? 1 : dt * 3);
      this.camPitch = clamp(this.camPitch + ic.lookY * (ic.mouseLook ? 1 : dt * 2), -0.35, 1.1);
      this.lookIdle = 0;
    } else {
      this.lookIdle = (this.lookIdle || 0) + dt;
      if (this.lookIdle > 1.2 && s.speed > 0.8) { let d = s.yaw - this.camYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; this.camYaw += d * Math.min(1, dt * 1.6); }
    }
    const dist = this.camDist * (s.speed > 3 ? 1.15 : 1);
    const cp = Math.cos(this.camPitch);
    const tx = s.x - Math.sin(this.camYaw) * dist * cp, tz = s.z - Math.cos(this.camYaw) * dist * cp, ty = s.y + 1.55 + Math.sin(this.camPitch) * dist;
    _v.set(tx, Math.max(ty, s.y + 0.4), tz);
    // don't put the camera inside buildings: pull in toward the character
    let k = 1;
    for (let i = 1; i <= 6; i++) {
      const f = i / 6, px = s.x + (tx - s.x) * f, pz = s.z + (tz - s.z) * f;
      if (!this._free(px, pz)) { k = Math.max(0.25, (i - 1) / 6); break; }
    }
    _v.set(s.x + (tx - s.x) * k, s.y + 1.4 + (_v.y - s.y - 1.4) * k, s.z + (tz - s.z) * k);
    this.camPos.lerp(_v, 1 - Math.exp(-dt * 10));
    cam.position.copy(this.camPos);
    cam.lookAt(s.x, s.y + 1.45, s.z);
    cam.fov = damp(cam.fov, s.speed > 3 ? 62 : 58, 3, dt); cam.near = 0.1;
    cam.updateProjectionMatrix();
  }

  // parked cars: physics (handbrake), visuals; ones far away go back to the garage
  updateParked(dt, camPos, env) {
    const g = this.game, f = g.focusState;
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (!v.keep && Math.hypot(v.state.x - f.x, v.state.z - f.z) > 450) { v.dispose(); this.parked.splice(i, 1); continue; }
      v.update(dt);
      v.sync(dt, camPos, env);
    }
  }

  clearParked() { for (const v of this.parked) v.dispose(); this.parked.length = 0; }
}
