// Story missions (GTA-style): mission givers stand in the city with a marker and a minimap blip; walk or
// drive up and press E. A letterboxed cutscene with subtitles plays, then objectives run one after the
// other (see StoryData.js for the step types). Fail -> MISSION FAILED with retry; pass -> MISSION PASSED,
// cash + XP, and the next mission unlocks. Progress is saved.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { clamp, formatMoney } from '../core/util.js';
import { CAST, STORY, STORY_CHAPTERS } from './StoryData.js';
import { buildCharacter } from '../player/OnFoot.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { CARS, tunedParams, TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { GRID } from '../world/CityLayout.js';

const YELLOW = 0xffc53d;
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Story {
  constructor(game) {
    this.game = game;
    game.save.data.story ??= { done: {} };
    this.active = null;
    this.givers = {};
    this.promptHtml = null;
    this._buildUI();
    this._buildMarkers();
    bus.on('police:busted', () => { if (this.active) this.fail('BUSTED'); });
  }

  get done() { return this.game.save.data.story.done; }
  // the next mission each giver offers (in story order, requirements met)
  available() {
    const out = {};
    for (const m of STORY) {
      if (this.done[m.id] || out[m.giver]) continue;
      if ((m.requires || []).every((r) => this.done[r])) out[m.giver] = m;
    }
    return out;
  }
  get finished() { return STORY.every((m) => this.done[m.id]); }

  // ------------------------------------------------------------------ world objects
  _buildMarkers() {
    const g = this.game;
    const mk = (color, r0, r1, beamR) => {
      const grp = new THREE.Group();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(beamR, beamR, 60, 16, 1, true).translate(0, 30, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      ring.position.y = 0.06;
      grp.add(beam, ring); grp.visible = false; g.scene.add(grp);
      return grp;
    };
    this.dest = mk(YELLOW, 4.2, 5.4, 1.6);
    // floating arrow over target vehicles / people
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: YELLOW, toneMapped: false }));
    this.arrow.visible = false; g.scene.add(this.arrow);
  }

  _giver(id) {
    if (this.givers[id]) return this.givers[id];
    const c = CAST[id], g = this.game;
    // stand on the pavement beside the nearest traffic lane
    const lane = g._laneSpot(c.spot.x, c.spot.z);
    const rx = -Math.cos(lane.yaw), rz = Math.sin(lane.yaw);
    let x = lane.x, z = lane.z;
    for (let d = 3; d < 12; d += 0.5) {
      const px = lane.x + rx * d, pz = lane.z + rz * d;
      if (!g.onFoot._free(px, pz)) break;
      x = px; z = pz;
      if (g.world.layout.groundHeight(px, pz) > 0.05 && d > 5) break;
    }
    const body = buildCharacter(c.look);
    const y = g.world.layout.groundHeight(x, z);
    body.group.position.set(x, y, z);
    body.group.rotation.y = Math.atan2(-rx, -rz); // face the road
    g.scene.add(body.group);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.set(x, y + 0.05, z); g.scene.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 12, 1, true).translate(0, 20, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color), transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.set(x, y, z); g.scene.add(beam);
    // where the player's car goes on retry
    return (this.givers[id] = { id, x, y, z, body, ring, beam, lane });
  }

  _resolve(loc, m) {
    if (loc === 'giver') { const gv = this._giver(m.giver); return { x: gv.lane.x, z: gv.lane.z, yaw: gv.lane.yaw }; }
    if (Array.isArray(loc)) return this.game._laneSpot(loc[0] * GRID, loc[1] * GRID);
    return this.game._laneSpot(loc.x, loc.z);
  }

  _spawnVehicle(type, spot, paint) {
    const g = this.game;
    const car = CARS[type], tv = TRAFFIC_VEHICLES[type];
    if (!g.lib.has(type)) return null;
    const params = car ? tunedParams(type, {}) : { ...tv.params };
    const v = new Vehicle({ carId: type, params, world: g.world, lib: g.lib, role: 'player', carType: (car || tv).carType, renderOpts: { headlights: g.preset.headlightSpots, shadow: g.preset.shadows !== 'off', lodDistance: 1e9 } });
    if (car?.real && !paint) v.renderer.applyCustom({ paint: 'factory', finish: 'metallic', tint: 0.5, ...car.look });
    else v.renderer.applyCustom({ paint: paint || '#888888', finish: car ? 'metallic' : 'gloss', tint: car ? 0.5 : 0.2, ...(car?.look || {}) });
    v.renderer.enableDents?.();
    g.scene.add(v.renderer.group);
    v.place(spot.x, spot.z, spot.yaw);
    v.mission = true;
    return v;
  }

  _route(points, m) {
    const wps = points.map((p) => { const s = this._resolve(p, m); return { x: s.x, z: s.z }; });
    return this.game.races.prepare({ type: 'sprint', waypoints: wps }).route;
  }

  // ------------------------------------------------------------------ UI
  _buildUI() {
    const root = h('div', 'story-ui');
    root.innerHTML = '<div class="lb top"></div><div class="lb bottom"></div><div class="story-sub"></div><div class="story-obj"></div><div class="story-meter hidden"><span></span><div class="bar"><i></i></div></div>';
    document.getElementById('app')?.appendChild(root) ?? document.body.appendChild(root);
    this.el = { root, sub: root.querySelector('.story-sub'), obj: root.querySelector('.story-obj'), meter: root.querySelector('.story-meter') };
  }
  _subtitle(speaker, text, phone = false) {
    if (!speaker) { this.el.sub.classList.remove('on'); return; }
    const c = CAST[speaker] || { name: speaker, color: '#fff' };
    this.el.sub.innerHTML = `${phone ? '<span class="phone">&#9742;</span> ' : ''}<b style="color:${c.color}">${c.name}:</b> ${text}`;
    this.el.sub.classList.add('on');
  }
  _objective(html) {
    this.el.obj.innerHTML = html || '';
    this.el.obj.classList.toggle('on', !!html);
    if (html) { this.el.obj.classList.remove('flash'); void this.el.obj.offsetWidth; this.el.obj.classList.add('flash'); }
  }
  _meter(label, frac, danger) {
    const m = this.el.meter;
    if (label == null) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.firstChild.textContent = label;
    const i = m.querySelector('i'); i.style.width = `${clamp(frac, 0, 1) * 100}%`; i.className = danger ? 'danger' : '';
  }
  // non-blocking lines (phone calls, outros)
  _say(lines, phone = true) { this.queue = [...(this.queue || []), ...lines.map(([s, t]) => ({ s, t, phone }))]; }
  _updateSubs(dt) {
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this._subtitle(null); }
    if ((!this.subT || this.subT <= 0) && this.queue?.length) {
      const q = this.queue.shift();
      this._subtitle(q.s, q.t, q.phone);
      this.subT = Math.max(2.6, q.t.length * 0.06);
    }
  }

  // ------------------------------------------------------------------ flow
  start(m, skipIntro = false) {
    const g = this.game;
    const ids = [...new Set(m.steps.flatMap((s) => [s.vehicle, s.car]).filter(Boolean))];
    g.lib.load(ids, 2);
    this.active = { m, i: -1, spawned: [], vehicle: null };
    g.gps = null;
    if (skipIntro || !m.intro?.length) this._next();
    else this._cutscene(m, () => this._next());
    bus.emit('story:start', { id: m.id });
  }

  _cutscene(m, done) {
    const g = this.game, gv = this._giver(m.giver);
    this.cs = { lines: m.intro, i: 0, t: 0, done, gv, prev: g.state.mode };
    g.state.mode = 'cutscene';
    document.getElementById('hud').classList.add('hidden');
    this.el.root.classList.add('cine');
    this.el.obj.classList.remove('on');
    this._subtitle(m.intro[0][0], m.intro[0][1]);
    this._titleCard(m);
  }
  _titleCard(m) {
    const t = h('div', 'story-title', `<small>${CAST[m.giver].name.toUpperCase()}</small>${m.title}`);
    this.el.root.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  updateCutscene(dt, input) {
    const cs = this.cs, g = this.game;
    if (!cs) return;
    cs.t += dt; cs.lt = (cs.lt || 0) + dt;
    const line = cs.lines[cs.i];
    const skipAll = input.consume('pause');
    const next = input.consume('confirm') || input.consume('event') || input.consume('jump') || cs.lt > Math.max(3.4, line[1].length * 0.065);
    if (skipAll || next) {
      cs.i = skipAll ? cs.lines.length : cs.i + 1; cs.lt = 0;
      if (cs.i >= cs.lines.length) { this._endCutscene(); return; }
      this._subtitle(cs.lines[cs.i][0], cs.lines[cs.i][1]);
    }
    // camera: alternate a wide two-shot and an over-the-shoulder on whoever is talking
    const f = g.focusState, gv = cs.gv, cam = g.camera;
    const dx = gv.x - f.x, dz = gv.z - f.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    gv.body.group.rotation.y = Math.atan2(-ux, -uz);
    const speaker = cs.lines[cs.i][0];
    const drift = cs.t * 0.08;
    if (cs.i % 2 === 0) {
      _a.set((gv.x + f.x) / 2 - uz * (5 + d * 0.4) + ux * drift, gv.y + 2.1, (gv.z + f.z) / 2 + ux * (5 + d * 0.4) + uz * drift);
      _b.set((gv.x + f.x) / 2, gv.y + 1.3, (gv.z + f.z) / 2);
    } else if (speaker === 'you') {
      _a.set(gv.x + ux * 1.6 - uz * 0.7, gv.y + 1.75, gv.z + uz * 1.6 + ux * 0.7);
      _b.set(f.x, (f.y || 0) + 1.3, f.z);
    } else {
      _a.set(f.x - ux * 1.8 + uz * 0.8 + ux * drift * 0.3, (f.y || 0) + 1.75, f.z - uz * 1.8 - ux * 0.8 + uz * drift * 0.3);
      _b.set(gv.x, gv.y + 1.6, gv.z);
    }
    if (!cs.camInit) { cam.position.copy(_a); cs.camInit = true; } else cam.position.lerp(_a, 1 - Math.exp(-dt * 3));
    cam.lookAt(_b); cam.fov = 45; cam.near = 0.1; cam.updateProjectionMatrix();
  }

  _endCutscene() {
    const cs = this.cs, g = this.game;
    this.cs = null;
    this._subtitle(null);
    this.el.root.classList.remove('cine');
    g.state.mode = 'drive';
    document.getElementById('hud').classList.remove('hidden');
    if (g.onFoot.active) g.onFoot.camPos.copy(g.camera.position); else g.camCtl.snap(g.player);
    cs.done();
  }

  _next() {
    const A = this.active;
    if (!A) return;
    A.i++;
    const st = A.m.steps[A.i];
    if (!st) { this.pass(); return; }
    A.last = A.st?.v || A.last;   // the previous step's vehicle (e.g. steal the car you just tailed)
    if (A.st?.ai && A.st.v !== this.game.player && !this.game.onFoot.parked.includes(A.st.v)) {
      const v = A.st.v; v.controls.throttle = 0; v.controls.brake = 0; v.controls.steer = 0; v.controls.handbrake = 1; v.keep = true;
      this.game.onFoot.parked.push(v); // finished AI cars stay in the world as parked, solid cars
    }
    A.st = { t: 0 };
    const g = this.game, s = A.st, m = A.m;
    this._meter(null);
    switch (st.type) {
      case 'goto': case 'deliver': {
        s.target = this._resolve(st.to, m);
        if (st.type === 'deliver') A.vehicle ||= g.player;
        break;
      }
      case 'steal': {
        if (st.reuse && A.last) {
          const v = A.last;
          v.controls.throttle = 0; v.controls.brake = 0; v.controls.steer = 0; v.controls.handbrake = 1;
          v.keep = true; if (!g.onFoot.parked.includes(v)) g.onFoot.parked.push(v);
          s.v = v;
          break;
        }
        const spot = this._resolve(st.at, m);
        s.spot = spot;
        s.pending = true; // spawned when the model is ready
        break;
      }
      case 'collect': {
        s.points = st.points.map((p) => ({ ...this._resolve(p, m), got: false }));
        s.timeLeft = st.time || 120;
        break;
      }
      case 'escort': {
        s.pending = true;
        break;
      }
      case 'lose': {
        if (g.police.state === 'idle') g.police.startPursuit(st.heat || 2, 'story');
        s.seen = true;
        break;
      }
      case 'tail': case 'ram': case 'race': {
        s.pending = true;
        break;
      }
      case 'call': {
        this._say(st.lines, true);
        this._next();
        return;
      }
    }
    this._objective(st.text);
  }

  _spawnPending(st, s) {
    const g = this.game, A = this.active, m = A.m;
    const type = st.vehicle || st.car;
    if (!g.lib.has(type)) { g.lib.load([type], 1); return false; }
    if (st.type === 'steal') {
      const v = this._spawnVehicle(type, s.spot, st.paint);
      if (!v) return false;
      v.keep = true; g.onFoot.parked.push(v); A.spawned.push(v);
      s.v = v;
    } else {
      const route = this._route(st.route || [st.from || 'giver', st.to], m);
      let spot;
      if (st.type === 'race') {
        // line up beside the player, facing the first leg
        const p = g.player.state, a = route[0], b = route[1] || route[0];
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        g.player.place(a[0] - Math.cos(yaw) * 1.8, a[1] + Math.sin(yaw) * 1.8, yaw);
        g.camCtl.snap(g.player);
        spot = { x: a[0] + Math.cos(yaw) * 1.8, z: a[1] - Math.sin(yaw) * 1.8, yaw };
        s.countdown = 3.5; void p;
      } else {
        const a = route[0], b = route[1] || route[0];
        spot = { x: a[0], z: a[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
      }
      const v = this._spawnVehicle(type, spot, st.paint);
      if (!v) return false;
      const speed = st.type === 'tail' ? 15 : st.type === 'escort' ? (st.speed || 17) : st.type === 'ram' ? (st.speed || 26) : v.p.maxSpeed;
      const ai = new AIDriver(v, { skill: st.type === 'race' ? 0.96 : 0.82, maxSpeed: speed });
      ai.setRoute(route.map((p) => [p[0], p[1]]));
      ai.useNitro = st.type === 'race';
      s.v = v; s.ai = ai; s.route = route; s.end = route[route.length - 1];
      A.spawned.push(v);
      if (st.type === 'ram') s.hits = 0;
    }
    return true;
  }

  vehicles() {
    const A = this.active;
    return A?.st?.ai ? [A.st.v] : [];
  }

  // before the player vehicle is simulated
  update(dt, input, driving) {
    const g = this.game;
    this._updateSubs(dt);
    this.promptHtml = null;
    this._animGivers(dt);
    if (!driving) return;
    if (!this.active) { this._offer(input); return; }
    const A = this.active, st = A.m.steps[A.i], s = A.st;
    if (!st || !s) return;
    s.t += dt;
    if (s.pending) { if (this._spawnPending(st, s)) s.pending = false; else return; }
    const f = g.focusState;
    const inCar = !g.onFoot.active;
    const P = g.player;
    let target = null, arrowOn = null;
    switch (st.type) {
      case 'goto': case 'deliver': {
        target = s.target;
        if (st.type === 'deliver' && A.vehicle) {
          if (A.vehicle.state.damage > (st.maxDamage ?? 1)) { this.fail('The car is wrecked.'); return; }
          if (P !== A.vehicle || !inCar) { this._objective(`Get back in the <b>car</b>.`); arrowOn = A.vehicle; target = null; s.away = true; break; }
          if (s.away) { s.away = false; this._objective(st.text); }
          this._meter('CAR CONDITION', 1 - A.vehicle.state.damage / (st.maxDamage || 1), A.vehicle.state.damage > (st.maxDamage || 1) * 0.7);
        }
        if (st.inVehicle && !inCar) { this._objective('Get in a <b>car</b>.'); s.needCar = true; target = null; break; }
        if (s.needCar && inCar) { s.needCar = false; this._objective(st.text); }
        const d = Math.hypot(f.x - s.target.x, f.z - s.target.z), sp = Math.hypot(f.vx || 0, f.vz || 0);
        if (d < 9 && (!st.stop || sp < 3)) { s.hold = (s.hold || 0) + dt; if (s.hold > (st.stop ? 1.2 : 0)) { this._next(); return; } }
        else s.hold = 0;
        if (st.stop && d < 25 && sp > 3) this._meter('STOP HERE', 1 - d / 25, false);
        break;
      }
      case 'steal': {
        arrowOn = s.v;
        if (P === s.v && inCar) {
          A.vehicle = s.v;
          if (st.heat) g.police.startPursuit(st.heat, 'stolen car');
          this._next(); return;
        }
        target = { x: s.v.state.x, z: s.v.state.z };
        break;
      }
      case 'lose': {
        if (g.police.state === 'idle') { this._next(); return; }
        this._meter(`HEAT ${g.police.heat || st.heat}`, 1 - (g.police.evade || 0), true);
        break;
      }
      case 'collect': {
        s.timeLeft -= dt;
        const left = s.points.filter((q) => !q.got);
        for (const q of left) if (Math.hypot(q.x - f.x, q.z - f.z) < 9) { q.got = true; g.audio.playEvent('checkpoint'); g.hud.message(`${s.points.length - left.length + 1}/${s.points.length}`, '', 0.9, true); }
        const rem = s.points.filter((q) => !q.got);
        if (!rem.length) { this._next(); return; }
        if (s.timeLeft <= 0) { this.fail("You ran out of time."); return; }
        this._meter(`${st.label || 'PICKUPS'} ${s.points.length - rem.length}/${s.points.length} · ${Math.ceil(s.timeLeft)}s`, s.timeLeft / (st.time || 120), s.timeLeft < 20);
        // point the marker / GPS at the nearest remaining pickup
        let best = rem[0], bd = Infinity;
        for (const q of rem) { const d = Math.hypot(q.x - f.x, q.z - f.z); if (d < bd) { bd = d; best = q; } }
        target = best;
        break;
      }
      case 'tail': case 'ram': case 'race': case 'escort': {
        const v = s.v, ai = s.ai;
        if (st.type === 'race' && s.countdown > 0) {
          const n = Math.ceil(s.countdown);
          s.countdown -= dt;
          if (n !== s.lastN) { s.lastN = n; g.hud.message(n > 3 ? '' : String(n), '', 0.8); g.audio.playEvent('countdown', { final: false }); }
          P.controls.throttle = Math.min(P.controls.throttle, 1); P.controls.handbrake = 1;
          v.controls.handbrake = 1; v.controls.throttle = 0.5; v.update(dt); v.sync(dt, g.camera.position, g.env.state);
          if (s.countdown <= 0) { g.hud.message('GO!', '', 1); g.audio.playEvent('countdown', { final: true }); }
          target = { x: s.end[0], z: s.end[1] };
          break;
        }
        // AI
        if (st.type === 'race') {
          const dp = Math.hypot(f.x - s.end[0], f.z - s.end[1]), da = Math.hypot(v.state.x - s.end[0], v.state.z - s.end[1]);
          ai.powerScale = clamp(1 + (da - dp) / 900, 0.85, 1.12);
          v.physics.p.powerW = v.physics.p.enginePower * 1000 * ai.powerScale;
          if (dp < 14) { this._next(); return; }
          if (da < 14) { this.fail(`${CAST[st.rival]?.name || 'Your rival'} won the race.`); return; }
          target = { x: s.end[0], z: s.end[1] };
        }
        const dStart = Math.hypot(v.state.x - f.x, v.state.z - f.z);
        // tail / ram targets wait (loading up) until you arrive, then set off
        if (st.type !== 'race' && !s.moving) {
          if (dStart < (st.type === 'ram' ? 90 : st.type === 'escort' ? 45 : 70)) {
            s.moving = true;
            if (st.type === 'ram') g.hud.message('HE SPOTTED YOU', '', 1.4, true);
            if (st.type === 'escort' && st.heat) g.police.startPursuit(st.heat, 'convoy');
          } else this._meter(st.waitText || (st.type === 'tail' ? 'GET CLOSE TO THE VAN' : st.type === 'escort' ? 'MEET THE CONVOY' : 'FIND THE TARGET'), 0, false);
        }
        if (!s.stopped && (s.moving || st.type === 'race')) ai.update(dt, g.traffic ? g.traffic.cars : []);
        else { v.controls.throttle = 0; v.controls.brake = 1; v.controls.steer = 0; v.controls.handbrake = s.moving ? 0 : 1; }
        if (ai.needsReset) g.recoverAI(v, ai);
        v.update(dt);
        if (inCar) {
          const hit = VehiclePhysics.resolvePair(P.physics, v.physics);
          if (hit && st.type === 'ram' && hit.impact > 3.2 && (s.hitCd || 0) <= 0) {
            s.hits++; s.hitCd = 0.6;
            v.state.damage = Math.min(1, v.state.damage + 0.22);
            g.audio.playEvent('collision', { intensity: clamp(hit.impact / 18, 0.3, 1), type: 'heavy', position: { x: hit.x, y: 0.5, z: hit.z } });
            g.camCtl.addShake(0.5);
          }
        }
        s.hitCd = (s.hitCd || 0) - dt;
        v.sync(dt, g.camera.position, g.env.state);
        arrowOn = v;
        const d = Math.hypot(v.state.x - f.x, v.state.z - f.z);
        const atEnd = Math.hypot(v.state.x - s.end[0], v.state.z - s.end[1]) < 18 && ai.idx >= s.route.length - 3;
        if (st.type !== 'race' && !s.moving) { /* waiting */ }
        else if (st.type === 'tail') {
          const close = d < 16, far = d > 170;
          s.close = close ? (s.close || 0) + dt : Math.max(0, (s.close || 0) - dt);
          s.far = far ? (s.far || 0) + dt : 0;
          this._meter(close ? 'TOO CLOSE' : far ? 'LOSING HIM' : `DISTANCE ${Math.round(d)} m`, 1 - clamp((d - 16) / 154, 0, 1), close || d > 130);
          if (s.close > 2.5) { this.fail('The courier spotted you.'); return; }
          if (s.far > 5) { this.fail('You lost the van.'); return; }
          if (atEnd) { this._next(); return; }
        } else if (st.type === 'escort') {
          const far = d > (st.maxDist || 110);
          s.far = far ? (s.far || 0) + dt : 0;
          const hp = 1 - v.state.damage;
          this._meter(far ? 'STAY WITH THE CONVOY' : `${st.label || 'TRUCK'} ${Math.round(hp * 100)}%`, hp, far || hp < 0.35);
          if (v.state.damage >= 1) { this.fail(`The ${(st.label || 'truck').toLowerCase()} was destroyed.`); return; }
          if (s.far > 6) { this.fail('You left the convoy behind.'); return; }
          if (atEnd) { this._next(); return; }
        } else if (st.type === 'ram') {
          this._meter(`DAMAGE ${s.hits}/${st.hits}`, s.hits / st.hits, false);
          if (s.hits >= st.hits && !s.stopped) { s.stopped = true; g.hud.message('TARGET DOWN', '', 1.6, true); s.doneT = 1.2; }
          if (s.stopped) { s.doneT -= dt; if (s.doneT <= 0) { this._next(); return; } }
          else if (atEnd) { this.fail('It got away.'); return; }
          else if (d > 420) { this.fail('It got away.'); return; }
        }
        break;
      }
    }
    // markers / GPS
    this.dest.visible = !!target && !arrowOn;
    if (target) {
      this.dest.position.set(target.x, 0, target.z);
      this.dest.children[1].material.opacity = 0.6 + Math.sin(performance.now() / 250) * 0.25;
      if (!s.gpsT || s.gpsT <= 0 || s.gpsTo !== target) { g.setGPS(target.x, target.z); s.gpsT = 2.5; s.gpsTo = target; }
      s.gpsT -= dt;
    }
    this.arrow.visible = !!arrowOn;
    if (arrowOn) this.arrow.position.set(arrowOn.state.x, arrowOn.state.y + 2.6 + Math.sin(performance.now() / 220) * 0.15, arrowOn.state.z);
    this.target = arrowOn ? { x: arrowOn.state.x, z: arrowOn.state.z } : target;
  }

  // mission givers: offer the mission when the player is close
  _offer(input) {
    const g = this.game;
    if (g.police.inPursuit || g.races.active) return;
    const f = g.focusState, sp = Math.hypot(f.vx || 0, f.vz || 0);
    for (const [gid, m] of Object.entries(this.available())) {
      const gv = this._giver(gid);
      const d = Math.hypot(gv.x - f.x, gv.z - f.z);
      if (d < (g.onFoot.active ? 4 : 10) && sp < 4) {
        const c = CAST[gid];
        this.promptHtml = `<b style="color:${c.color}">${c.name}</b> · MISSION: ${m.title} · press <span class="key">E</span> / <span class="key">A</span>`;
        if (input.consume('event')) this.start(m);
        return;
      }
    }
  }

  _animGivers(dt) {
    const av = this.available(), t = performance.now() / 1000;
    for (const id of Object.keys(CAST)) {
      if (!CAST[id].spot) continue;
      const on = !!av[id] && !this.active;
      if (!on && !this.givers[id]) continue;
      const gv = this._giver(id);
      const busy = this.cs?.gv === gv;
      gv.body.group.visible = on || busy;
      gv.ring.visible = gv.beam.visible = on && !this.cs;
      gv.ring.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
      if (!gv.human && this.game.humans?.ready) this._humanize(gv, id);
      if (gv.human) {
        // idle (breathing, weight on both feet) while the camera is close enough to see it
        const cp = this.game.camera.position;
        if (gv.body.group.visible && Math.hypot(cp.x - gv.x, cp.z - gv.z) < 90) { gv.body.group.updateMatrixWorld(true); gv.human.animate(0, dt); }
      } else { gv.body.armL.rotation.x = Math.sin(t * 1.3) * 0.05; gv.body.armR.rotation.x = -Math.sin(t * 1.1) * 0.05; }
    }
  }

  // mission contacts become realistic characters once the people models are loaded
  _humanize(gv, id) {
    const h = this.game.humans.create(CAST[id]?.model || id.length, { shadow: this.game.preset.shadows !== 'off' });
    if (!h) return;
    for (const c of gv.body.group.children) c.visible = false;
    gv.body.group.add(h.group);
    gv.human = h;
  }

  // after the rest of the frame's interactions, so the mission prompt wins
  late() { if (this.promptHtml) this.game.hud.setPrompt(this.promptHtml); }

  blips() {
    const out = [];
    if (!this.active) for (const gid of Object.keys(this.available())) { const gv = this._giver(gid); out.push({ x: gv.x, z: gv.z, color: CAST[gid].color, r: 6 }); }
    if (this.target) out.push({ x: this.target.x, z: this.target.z, color: '#ffc53d', r: 5 });
    const st = this.active?.st;
    if (st?.points) for (const q of st.points) if (!q.got) out.push({ x: q.x, z: q.z, color: '#ffc53d', r: 4 });
    return out;
  }

  // ------------------------------------------------------------------ end states
  _cleanup(keepCar) {
    const g = this.game, A = this.active;
    if (!A) return;
    for (const v of A.spawned) {
      if (keepCar && g.player === v) { v.keep = false; v.mission = false; continue; }
      if (g.player === v) continue; // never delete the car you're sitting in
      const i = g.onFoot.parked.indexOf(v); if (i >= 0) g.onFoot.parked.splice(i, 1);
      v.dispose();
    }
    this.active = null;
    this.dest.visible = false; this.arrow.visible = false; this.target = null;
    this._objective(null); this._meter(null);
    g.gps = null;
  }

  pass() {
    const g = this.game, m = this.active.m;
    this._cleanup(true);
    this.done[m.id] = true;
    const r = m.reward || {};
    if (r.cash) g.save.addCash(Math.round(r.cash * (g.progress?.rewardMult || 1)), 'story');
    if (r.xp) g.progress?.addXp(r.xp, 'story');
    g.save.save();
    g.hud.message('MISSION PASSED', `${m.title.toUpperCase()} · ${formatMoney(r.cash || 0)} · +${(r.xp || 0).toLocaleString()} XP`, 4.5);
    g.audio.playEvent('raceFinish');
    if (m.outro?.length) this._say(m.outro, true);
    if (m.chapterEnd) { const nc = STORY_CHAPTERS.find((c) => c.id === m.chapterEnd + 1); setTimeout(() => g.hud.message(`CHAPTER ${m.chapterEnd} COMPLETE`, nc ? `NEXT: ${nc.name.toUpperCase()}` : '', 4), 5000); }
    if (m.finale) setTimeout(() => g.ui.toast('STORY COMPLETE — Port Halvern is yours. The city is still open for business.', 'cash', 8), 4800);
    else { const nx = STORY.find((x) => !this.done[x.id] && (x.requires || []).every((q) => this.done[q])); if (nx) setTimeout(() => g.ui.toast(`New mission from ${CAST[nx.giver].name}: ${nx.title} (see the minimap)`, '', 6), 4800); }
    bus.emit('story:pass', { id: m.id });
  }

  fail(reason) {
    const g = this.game, m = this.active?.m;
    if (!m) return;
    this._cleanup(false);
    g.hud.message('MISSION FAILED', reason, 4);
    g.audio.playEvent('busted');
    this.lastFailed = m;
    setTimeout(() => { if (g.state.mode === 'drive' && !this.active) g.ui.showStoryFail(m, reason); }, reason === 'BUSTED' ? 5200 : 2200);
    bus.emit('story:fail', { id: m.id, reason });
  }

  retry(m) {
    const g = this.game, gv = this._giver(m.giver);
    if (g.onFoot.active) g.onFoot.enter({ kind: 'own', ref: g.player });
    g.police.clearAll();
    g.player.state.damage = 0; g.player.renderer.repair?.();
    g.player.place(gv.lane.x, gv.lane.z, gv.lane.yaw);
    g.camCtl.snap(g.player);
    this.start(m, true);
  }

  abort() { if (this.active) this._cleanup(false); if (this.cs) { this.cs = null; this.el.root.classList.remove('cine'); this._subtitle(null); } }
}
