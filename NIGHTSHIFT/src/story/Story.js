// Story missions (GTA-style): mission givers stand in the city with a marker and a minimap blip; walk or
// drive up and press E. A letterboxed cutscene with subtitles plays, then objectives run one after the
// other (see StoryData.js for the step types). Fail -> MISSION FAILED with retry; pass -> MISSION PASSED,
// cash + XP, and the next mission unlocks. Progress is saved.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { markerBeam } from '../world/MarkerBeam.js';
import { clamp, formatMoney } from '../core/util.js';
import { CAST, STORY, STORY_CHAPTERS } from './StoryData.js';
import { buildCharacter } from '../player/OnFoot.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { CARS, tunedParams, TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { GRID } from '../world/CityLayout.js';
import { PROPERTY_BY_ID } from '../world/Empire.js';
import { Heist } from './Heist.js';
import { CrewMember } from './Crew.js';
import { passengerProfile, BodyIK } from '../vehicles/Interaction.js';

const YELLOW = 0xffc53d;
// where a route turns right round: the way it comes in over the last 8 m and goes on over the next 8 m more than 150
// degrees apart (a lane's hook into a junction's centre is no turn round). The index, or -1
function uTurnAt(R) {
  const n = R.length;
  if (n < 3) return -1;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
  const at = (s) => {
    s = Math.max(0, Math.min(cum[n - 1], s));
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const k = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
    return [R[lo][0] + (R[hi][0] - R[lo][0]) * k, R[lo][1] + (R[hi][1] - R[lo][1]) * k];
  };
  for (let i = 1; i < n - 1; i++) {
    const a = at(cum[i] - 8), b = R[i], c = at(cum[i] + 8);
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu > 3 && lv > 3 && (ux * vx + uz * vz) / (lu * lv) < -0.87) return i;
  }
  return -1;
}
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
      const beam = markerBeam(new THREE.CylinderGeometry(beamR, beamR, 60, 16, 1, true).translate(0, 30, 0), color, 0.22);
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
    // Kerala: not until the roads round them have loaded (until then just the spot, for the map)
    if (g.world.kerala) {
      const n = g.traffic.graph.nearest(c.spot.x, c.spot.z, (l) => l.edge?.cls <= 7);
      if (!n || n.dist > 150) return { id, x: c.spot.x, z: c.spot.z, provisional: true, lane: { x: c.spot.x, z: c.spot.z, yaw: 0 } };
    }
    // stand on the pavement beside the nearest traffic lane
    const lane = g._laneSpot(c.spot.x, c.spot.z);
    const rx = -Math.cos(lane.yaw), rz = Math.sin(lane.yaw);
    let x = lane.x, z = lane.z, face = Math.atan2(-rx, -rz);
    for (let d = 3; d < 12; d += 0.5) {
      const px = lane.x + rx * d, pz = lane.z + rz * d;
      if (!g.onFoot._free(px, pz)) break;
      x = px; z = pz;
      if (g.world.layout.groundHeight(px, pz) > 0.05 && d > 5) break;
    }
    // (Kerala, traffic keeping left: that's across the road, and 5.5 m was still the tarmac on a wide street. Just past
    // the far edge instead; but a dual carriageway's median (more road just beyond it: Leena stood on one) or no edge
    // within reach, the lane's own kerb, back from the road)
    const W = g.world;
    if (W.kerala) {
      let far = null, last = null, wall = false;
      const roadOn = (px, pz) => [1.5, 3].some((e) => W.onCarriageway(px + rx * e, pz + rz * e));
      for (let d = 2; d < 14; d += 0.25) {
        const px = lane.x + rx * d, pz = lane.z + rz * d;
        // (a wall at the far edge: up against it, a workshop's door; one with more road beyond is a median's barrier)
        if (!g.onFoot._free(px, pz)) { if (last && d > 3 && !roadOn(px, pz)) { far = last; wall = true; } break; }
        last = { x: px, z: pz };
        if (W.onCarriageway(px, pz)) continue;
        let bx = px, bz = pz;
        for (let e = 0.25; e <= 1; e += 0.25) { if (!g.onFoot._free(px + rx * e, pz + rz * e)) break; bx = px + rx * e; bz = pz + rz * e; }
        if (![1, 2, 3].some((e) => W.onCarriageway(bx + rx * e, bz + rz * e))) far = { x: bx, z: bz };
        break;
      }
      ({ x, z, face } = far ? { ...far, face } : this._kerb(c.spot.x, c.spot.z, 2.2));
      // (still on the road: a place right at a big junction. The nearest pavement round it)
      if (!wall && W.onCarriageway(x, z)) { const o = this._pavement(lane.x, lane.z); if (o) ({ x, z, face } = o); }
    }
    const body = buildCharacter(c.look);
    const y = g.world.layout.groundHeight(x, z, (g.world.layout.groundHeight(lane.x, lane.z) || 0) + 1);
    body.group.position.set(x, y, z);
    body.group.rotation.y = face; // face the road
    g.scene.add(body.group);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.set(x, y + 0.05, z); g.scene.add(ring);
    const beam = markerBeam(new THREE.CylinderGeometry(0.5, 0.5, 40, 12, 1, true).translate(0, 20, 0), new THREE.Color(c.color), 0.18, { near: 4, far: 20 });
    beam.position.set(x, y, z); g.scene.add(beam);
    // where the player's car goes on retry
    return (this.givers[id] = { id, x, y, z, body, ring, beam, lane });
  }

  _resolve(loc, m) {
    if (loc === 'giver') { const gv = this._giver(m.giver); return { x: gv.lane.x, z: gv.lane.z, yaw: gv.lane.yaw }; }
    if (Array.isArray(loc)) return this.game._laneSpot(loc[0] * GRID, loc[1] * GRID);
    if (typeof loc === 'string') { const p = this.placeAt?.(loc) || { x: 0, z: 0 }; return this.game._laneSpot(p.x, p.z); }   // a Kerala place
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

  _route(points, m, big = false) {
    const wps = points.map((p) => { const s = this._resolve(p, m); return { x: s.x, z: s.z }; });
    let P = this.game.races.prepare({ type: 'sprint', waypoints: wps, big }), route = P.route;
    // a waypoint the route has to turn round at (a place up a dead end, a junction it goes past and comes back to):
    // dropped, the route on from the one before (an AI car can't turn round in a lane: the truck you were tailing
    // stood there for good)
    for (let k = 0; k < 3 && wps.length > 2; k++) {
      const u = uTurnAt(route);
      if (u < 0) break;
      let bi = -1, bd = 150;
      for (let i = 1; i < wps.length - 1; i++) { const d = Math.hypot(wps[i].x - route[u][0], wps[i].z - route[u][1]); if (d < bd) { bd = d; bi = i; } }
      if (bi < 0) break;
      wps.splice(bi, 1);
      P = this.game.races.prepare({ type: 'sprint', waypoints: wps, big }); route = P.route;
    }
    route.broken = P.broken;   // (a leg with no way through the roads built so far)
    return route;
  }

  // ------------------------------------------------------------------ riders
  // GTA's pickups: a crew member waits at the kerb, turns to watch your car come, walks to the passenger door when you
  // stop and gets in (the car held still until the door shuts). He rides along, looking at you when he talks and back at
  // the police in a chase; if you get out and walk off he gets out and follows, and gets back in when you stop for him.
  // At the drop-off he gets out and walks over to the contact. (A step's rider: 'id' picks him up, drop: 'id' sets him
  // down.) No rider if the people models never loaded: the pickup is then just a stop, as before.
  _riderFor(st, s, d) {
    const g = this.game;
    if (st.drop) { const r = this.riders?.[st.drop]; return r?.job === 'aboard' ? r : null; }
    if (!st.rider) return null;
    let r = this.riders?.[st.rider];
    if (!r && d < 250 && g.humans?.ready && !s.noRider) {
      // (placed once the place has loaded round you: the spot is worked out again from the roads now there)
      s.target = this._resolve(st.to, this.active.m);
      const c = CAST[st.rider] || {}, look = c.crew || {};
      r = new CrewMember(g, { id: st.rider, name: c.name || st.rider, model: look.model || c.model || 'jake', outfit: look.outfit || null });
      if (!r.ok) { r.dispose(); s.noRider = true; return null; }
      const k = this._kerb(s.target.x, s.target.z);
      r.place(k.x, k.z, k.face); r.stand(k.face);
      r.job = 'wait';
      (this.riders ||= {})[st.rider] = r;
    }
    return r || null;
  }

  // the kerb beside the lane nearest (x, z), on the lane's own side (Kerala keeps left), facing the road; `back`: how
  // far past the road's edge (as far as there's room)
  _kerb(x, z, back = 0.75) {
    const g = this.game, W = g.world;
    if (!W.kerala) { const k = g.empire.sidewalk(x, z); return { x: k.x, z: k.z, face: k.face }; }
    const lane = g._laneSpot(x, z), lx = Math.cos(lane.yaw), lz = -Math.sin(lane.yaw);
    let px = lane.x, pz = lane.z, off = null;
    for (let d = 0.5; d < 16; d += 0.25) {
      const qx = lane.x + lx * d, qz = lane.z + lz * d;
      if (!g.onFoot._free(qx, qz)) break;
      px = qx; pz = qz;
      if (off === null && !W.onCarriageway(qx, qz)) off = d;
      if (off !== null && d >= off + back) break;
    }
    return { x: px, z: pz, face: Math.atan2(-lx, -lz) };
  }

  // Kerala: the nearest spot round (x, z) a person can stand at the roadside: off the road by most of a metre, clear of
  // walls, and not a median (road on both sides of it); facing the road
  _pavement(x, z) {
    const g = this.game, W = g.world, on = (px, pz) => W.onCarriageway(px, pz);
    for (let r = 3; r <= 30; r += 1.5) {
      let best = null, bd = Infinity;
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (on(px, pz) || !g.onFoot._free(px, pz)) continue;
        if ([[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]].some(([dx, dz]) => on(px + dx, pz + dz))) continue;
        if ([[3, 0], [0, 3], [2.1, 2.1], [2.1, -2.1]].some(([dx, dz]) => on(px + dx, pz + dz) && on(px - dx, pz - dz))) continue;
        const d = Math.hypot(px - x, pz - z);
        if (d < bd) { bd = d; best = { x: px, z: pz, face: Math.atan2(x - px, z - pz) }; }
      }
      if (best) return best;
    }
    return null;
  }

  // the pickup / drop-off itself; true when he's in (or out and on his way)
  _riderStop(r, st, s, d, sp, dt) {
    const g = this.game, P = g.player, name = CAST[r.id]?.name || r.id;
    const hold = () => this._holdCar(P);
    if (!s.boarding && !s.dropping) {
      if (st.rider && d < 45) r.face = { x: P.state.x, z: P.state.z };      // (watching the car come)
      s.hold = d < 9 && sp < 2.5 ? (s.hold || 0) + dt : 0;
      if (st.stop && d < 25 && sp > 2.5) this._meter('STOP HERE', 1 - d / 25, false); else this._meter(null);
      if (s.hold < 0.6) return false;
      if (st.rider) {
        const PP = passengerProfile(P);
        if (!PP) { if (!s.noRoom) this._objective(`No room for ${name} on that. Come back in a <b>car</b>.`); s.noRoom = true; return false; }
        if (s.noRoom) { s.noRoom = false; }
        r.board(P, PP); s.boarding = true; s.bt = 0;
        this._objective(`Wait for <b>${name}</b>.`);
      } else {
        if (sp > 0.8) return false;
        const ok = r.alight();
        if (ok !== true) { r._out(); r.inter.release(); const k = this._kerb(P.state.x, P.state.z); r.place(k.x, k.z, k.face); r.stand(); }
        s.dropping = true; s.bt = 0;
      }
      this._meter(null);
    }
    s.bt += dt;
    if (s.boarding) {
      hold();
      // (couldn't reach the door, or too long about it: straight into the seat)
      if ((r.mode === 'stand' || s.bt > 10) && !r.seated) { const PP = passengerProfile(P); if (PP) r.seatIn(P, PP); }
      if (r.mode === 'car' && r.seated === P) { r.job = 'aboard'; s.boarding = false; return true; }
      return false;
    }
    // dropping off: out of the car, then over to the contact
    hold();
    if (r.mode === 'alight' && s.bt < 6) return false;
    if (r.mode !== 'stand' && r.mode !== 'goto') { r._out(); r.inter.release(); }
    r.job = 'leave'; r.leaveT = 0; r.look = null;
    const gv = this._giver(this.active.m.giver);
    if (!gv.provisional) {
      const a = Math.atan2(r.state.x - gv.x, r.state.z - gv.z);
      r.goTo(gv.x + Math.sin(a + 0.6) * 1.3, gv.z + Math.cos(a + 0.6) * 1.3, { face: { x: gv.x, z: gv.z } });
    } else r.stand();
    return true;
  }

  // a rider who should be with you and isn't: the mission waits while you go back for him (failed if you drive off)
  _riderLost(s) {
    const g = this.game;
    let lost = null;
    const f = g.focusState, at = (r) => r.seated?.state || r.state, dist = (r) => Math.hypot(at(r).x - f.x, at(r).z - f.z);
    for (const r of Object.values(this.riders || {})) {
      if (r.job !== 'aboard' || s.dropping) continue;
      // with you: in your car, getting in or out of it, beside you on foot, or close by coming to the car
      if (r.seated === g.player || r.inter.st?.v === g.player || dist(r) < (g.onFoot.active ? 15 : 9)) continue;
      lost = r; break;
    }
    if (!lost) { if (s.lostR) { s.lostR = null; this._objective(this.active.m.steps[this.active.i]?.text); } return null; }
    const d = dist(lost);
    if (d > 260) { s.lostR = lost; return 'left'; }
    if (s.lostR !== lost) { s.lostR = lost; this._objective(`Go back for <b>${CAST[lost.id]?.name || lost.id}</b>.`); }
    this._meter(null);
    return lost;
  }

  // per frame: the riders' own lives (getting out after you, following you on foot, boarding the car you stop in)
  _updateRiders(dt) {
    const g = this.game, P = g.player, onFoot = g.onFoot.active;
    for (const [id, r] of Object.entries(this.riders || {})) {
      if (r.job === 'aboard' && !r.busy) {
        const v = r.seated;
        if (v && (v.gone || v.state.damage >= 1)) { r._out(); r.inter.release(); r.stand(); }
        else if (v) {
          // in your car: stays while you're nearby; out and after you if you walk off, or took another car
          const L = onFoot ? g.onFoot.state : P.state, far = Math.hypot(L.x - v.state.x, L.z - v.state.z) > 7;
          if ((onFoot && far) || (!onFoot && v !== P)) { if (r.alight() !== true) { r._out(); r.inter.release(); r.stand(); } }
        } else if (onFoot) { if (r.mode !== 'follow') r.follow([0.9, -0.8]); }
        else {
          // you're in a car again: he comes to it, and gets in when it's stopped beside him
          const d = Math.hypot(P.state.x - r.state.x, P.state.z - r.state.z), PP = passengerProfile(P);
          if (PP && d < 9 && Math.abs(P.state.speed || 0) < 1) r.board(P, PP);
          else if (d < 40) { if (r.mode !== 'goto' || Math.hypot(r.dest.x - P.state.x, r.dest.z - P.state.z) > 2) r.goTo(P.state.x, P.state.z, { run: true, near: 2.5 }); }
          else if (r.mode !== 'stand') r.stand();
        }
      }
      if (r.job === 'aboard' && r.mode === 'car') r.look = this._riderLook(r);
      // (your car held still while he gets in, as in GTA)
      if (r.mode === 'board' && r.inter.st?.v === P && !onFoot) this._holdCar(P);
      if (r.job === 'leave') {
        r.leaveT += dt;
        const c = g.camera.position;
        if (r.leaveT > 40 || (r.leaveT > 6 && Math.hypot(c.x - r.state.x, c.z - r.state.z) > 90)) { r.dispose(); delete this.riders[id]; continue; }
      }
      r.update(dt, onFoot ? g.onFoot.state : null);
    }
  }

  // the car held still: the handbrake, the footbrake only while it still rolls forward (at a standstill the brake pedal
  // is reverse)
  _holdCar(v) { const c = v.controls; c.throttle = 0; c.nitro = false; c.handbrake = 1; c.brake = (v.state.speed || 0) > 0.6 ? 1 : 0; }

  // seated beside you: at you while he talks, back at the nearest police car now and then in a chase, else the road
  _riderLook(r) {
    const g = this.game;
    if (this.subSpeaker === r.id) return (out) => { const H = g.onFoot.human?.B?.Head; if (H) { H.getWorldPosition(out); out.y += 0.06; } else { const s = g.player.state; out.set(s.x, s.y + 1.2, s.z); } return out; };
    const s = r.seated?.state;
    let best = null, bd = 70;
    if (s && (performance.now() / 1000) % 7 < 3.2) for (const u of g.police.units || []) { const v = u.vehicle?.state; if (!v) continue; const d = Math.hypot(v.x - s.x, v.z - s.z); if (d < bd) { bd = d; best = v; } }
    return best ? (out) => out.set(best.x, (best.y || 0) + 1.2, best.z) : null;
  }

  // ------------------------------------------------------------------ UI
  _buildUI() {
    const root = h('div', 'story-ui');
    root.innerHTML = '<div class="lb top"></div><div class="lb bottom"></div><div class="story-sub"></div><div class="story-obj"></div><div class="story-meter hidden"><span></span><div class="bar"><i></i></div></div>';
    document.getElementById('app')?.appendChild(root) ?? document.body.appendChild(root);
    this.el = { root, sub: root.querySelector('.story-sub'), obj: root.querySelector('.story-obj'), meter: root.querySelector('.story-meter') };
  }
  _subtitle(speaker, text, phone = false) {
    this.subSpeaker = speaker || null;
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
  _say(lines, phone = true) { this.queue = [...(this.queue || []), ...lines.map(([s, t, ph]) => ({ s, t, phone: ph ?? phone }))]; }
  // someone here in person (no phone): you, a rider near you, a contact you're standing by
  _here(who) {
    if (who === 'you') return true;
    const f = this.game.focusState, r = this.riders?.[who], gv = this.givers[who];
    const near = (o, d) => o && Math.hypot((o.seated?.state || o.state || o).x - f.x, (o.seated?.state || o.state || o).z - f.z) < d;
    return !!(near(r, 20) || (gv && !gv.provisional && near(gv, 30)));
  }
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
    // a scripted mission (the prologue): its own director runs it
    if (m.script === 'heist') { this.active.script = new Heist(g, this, m); this.active.script.start(skipIntro); bus.emit('story:start', { id: m.id }); return; }
    if (m.job) { this.active.job = true; this._next(); return; }
    if (skipIntro || !m.intro?.length) this._next();
    else this._cutscene(m, () => this._next());
    bus.emit('story:start', { id: m.id });
  }

  _cutscene(m, done, { guest = null, title = true } = {}) {
    const g = this.game, gv = this._giver(m.giver);
    this.cs = { lines: m.intro, i: 0, t: 0, done, gv, guest, prev: g.state.mode };
    // GTA's briefings: out of the car and face to face with the contact (one not in the world yet: the old shots)
    if (!gv.provisional && gv.human) this._stage(this.cs);
    g.state.mode = 'cutscene';
    this._meter(null);
    for (const id of ['hud', 'toasts']) document.getElementById(id)?.classList.add('hidden');
    this.el.root.classList.add('cine');
    this.el.obj.classList.remove('on');
    this._subtitle(m.intro[0][0], m.intro[0][1]);
    if (title) this._titleCard(m);
  }

  // a job that ends with the contact (you've brought them the car, or him): the last words face to face as the
  // briefing was, then MISSION PASSED. One more person speaking (Leena at the end, Sajan just dropped off) stands with
  // the contact. A job that ends elsewhere: the lines after it, on the phone, as before
  _outroScene() {
    const A = this.active, m = A?.m, g = this.game;
    if (!m?.outro?.length || m.job || m.script || !g.humans?.ready || !g.onFoot.human) return false;
    if (m.steps[m.steps.length - 1]?.to !== 'giver') return false;
    const gv = this._giver(m.giver), f = g.focusState;
    if (gv.provisional || !gv.human || Math.hypot(gv.x - f.x, gv.z - f.z) > 25) return false;
    const others = [...new Set(m.outro.map((l) => l[0]).filter((w) => w !== m.giver && w !== 'you'))];
    if (others.length > 1) return false;
    let guest = null;
    if (others.length) {
      const id = others[0], c = CAST[id] || {}, look = c.crew || {};
      guest = this.riders?.[id] || null;
      if (!guest) {
        if (!(look.model || c.model)) return false;
        guest = new CrewMember(g, { id, name: c.name || id, model: look.model || c.model, outfit: look.outfit || null });
        if (!guest.ok) { guest.dispose(); return false; }
        (this.riders ||= {})[id] = guest;
      }
      guest._out(); guest.inter.release(); guest.look = null;
      guest.job = 'scene';
    }
    A.outroDone = true;
    this._cutscene({ ...m, intro: m.outro }, () => { if (guest) { guest.job = 'leave'; guest.leaveT = 0; } this.pass(); }, { guest, title: false });
    return true;
  }
  // the briefing staged: you out of the car (it stays where it stopped) and standing 1.7 m from the contact, the first
  // clear spot from them toward you, the two of you facing each other
  _stage(cs) {
    const g = this.game, gv = cs.gv, of = g.onFoot, P = g.player, f = g.focusState;
    if (!of.human) return;
    const inCar = (x, z, m) => { const v = P.state, c = Math.cos(v.yaw), sn = Math.sin(v.yaw), lx = (x - v.x) * c - (z - v.z) * sn, lz = (x - v.x) * sn + (z - v.z) * c; return Math.abs(lx) < (P.p.width || 1.9) / 2 + m && Math.abs(lz) < (P.p.length || 4.5) / 2 + m; };
    const a0 = Math.atan2(f.x - gv.x, f.z - gv.z);
    let spot = null;
    for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.1, -2.1, 2.7, -2.7, Math.PI]) {
      const a = a0 + da, x = gv.x + Math.sin(a) * 1.7, z = gv.z + Math.cos(a) * 1.7;
      if (of._free(x, z) && !inCar(x, z, 0.45)) { spot = { x, z }; break; }
    }
    if (!spot) return;
    const yaw = Math.atan2(gv.x - spot.x, gv.z - spot.z);
    if (!of.active) {
      P.controls.throttle = 0; P.controls.brake = 0; P.controls.steer = 0; P.controls.handbrake = 1; P.controls.nitro = false;
      of.inter.release(); of.inter._detach(); of.inter.gaze = null;
      of.bail(spot.x, spot.z, yaw); of.human.clearAction(0);
    } else {
      const s = of.state; s.x = spot.x; s.z = spot.z; s.y = of._ground(spot.x, spot.z); s.yaw = yaw; s.speed = 0; s.vx = s.vz = 0;
    }
    cs.staged = true; cs.inCar = inCar;
    // (a contact is hidden while their job runs: back for the scene, without the marker)
    gv.body.group.visible = true; gv.ring.visible = gv.beam.visible = false;
    cs.pIK = new BodyIK(of.human); cs.gIK = new BodyIK(gv.human);
    gv.body.group.rotation.y = Math.atan2(spot.x - gv.x, spot.z - gv.z);
    // (the camera's side of the two of them, kept for every shot: the side the shots are clear on)
    const dx = gv.x - spot.x, dz = gv.z - spot.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    const ok = (k) => this._shots(cs, k).slice(0, 5).every((c) => of._camFree(c.p.x, c.p.z, c.p.y) && !inCar(c.p.x, c.p.z, 0.3));
    cs.side = ok(1) ? 1 : ok(-1) ? -1 : 1;
    // a third: beside the contact, on the far side of the line from the camera (in every shot, behind no one), facing you
    const G = cs.guest;
    if (G) {
      let gs = null;
      for (const k of [-cs.side, cs.side]) {
        const sx = -uz * k, sz = ux * k, x = gv.x + sx * 1.25 - ux * 0.35, z = gv.z + sz * 1.25 - uz * 0.35;
        if (of._free(x, z) && !inCar(x, z, 0.4)) { gs = { x, z }; break; }
      }
      gs ||= { x: gv.x - uz * -cs.side * 1.25, z: gv.z + ux * -cs.side * 1.25 };
      G.place(gs.x, gs.z, Math.atan2(spot.x - gs.x, spot.z - gs.z)); G.stand({ x: spot.x, z: spot.z });
    }
    this._talk(cs);
  }
  // the shots for the staged briefing: [wide two-shot from the side, over your shoulder onto the contact, over theirs
  // onto you], the camera all on one side of the line between them (k: which side)
  _shots(cs, k) {
    const g = this.game, gv = cs.gv, s = g.onFoot.state;
    const dx = gv.x - s.x, dz = gv.z - s.z, d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d, sx = -uz * k, sz = ux * k;
    const mx = (s.x + gv.x) / 2, mz = (s.z + gv.z) / 2, my = (s.y + gv.y) / 2;
    return [
      { p: new THREE.Vector3(mx + sx * 3.3 - ux * 0.4, my + 1.5, mz + sz * 3.3 - uz * 0.4), at: new THREE.Vector3(mx, my + 1.3, mz), fov: 42 },
      { p: new THREE.Vector3(s.x - ux * 0.95 + sx * 0.42, s.y + 1.68, s.z - uz * 0.95 + sz * 0.42), at: new THREE.Vector3(gv.x, gv.y + 1.5, gv.z), fov: 38 },
      { p: new THREE.Vector3(gv.x + ux * 0.95 + sx * 0.42, gv.y + 1.66, gv.z + uz * 0.95 + sz * 0.42), at: new THREE.Vector3(s.x, s.y + 1.52, s.z), fov: 38 },
      // a single on each: in front of them, off the line by the camera's side, head and shoulders
      { p: new THREE.Vector3(gv.x - ux * 1.45 + sx * 0.75, gv.y + 1.55, gv.z - uz * 1.45 + sz * 0.75), at: new THREE.Vector3(gv.x, gv.y + 1.5, gv.z), fov: 34 },
      { p: new THREE.Vector3(s.x + ux * 1.45 + sx * 0.75, s.y + 1.57, s.z + uz * 1.45 + sz * 0.75), at: new THREE.Vector3(s.x, s.y + 1.52, s.z), fov: 34 },
      ...(cs.guest ? ((G) => {
        // the third: over your shoulder onto them, and a single
        const gx = G.state.x - s.x, gz = G.state.z - s.z, gd = Math.hypot(gx, gz) || 1, vx = gx / gd, vz = gz / gd;
        return [
          { p: new THREE.Vector3(s.x - vx * 0.95 + sx * 0.42, s.y + 1.68, s.z - vz * 0.95 + sz * 0.42), at: new THREE.Vector3(G.state.x, G.state.y + 1.5, G.state.z), fov: 38 },
          { p: new THREE.Vector3(G.state.x - vx * 1.45 + sx * 0.75, G.state.y + 1.55, G.state.z - vz * 1.45 + sz * 0.75), at: new THREE.Vector3(G.state.x, G.state.y + 1.5, G.state.z), fov: 34 },
        ];
      })(cs.guest) : []),
    ];
  }
  // which shot a line gets: the wide one to open; then over the listener's shoulder onto whoever speaks, and when the
  // same one goes on talking, a single on them (and back), so every line is a cut
  _shotFor(cs) {
    if (cs.i === 0) return 0;
    const L = cs.lines, who = (i) => (L[i][0] === 'you' ? 'you' : cs.guest && L[i][0] === cs.guest.id ? 'guest' : 'giver');
    let run = 0;
    for (let i = cs.i; i > 0 && who(i) === who(cs.i); i--) run++;
    const [ots, single] = { you: [2, 4], giver: [1, 3], guest: [5, 6] }[who(cs.i)];
    return run % 2 === 1 ? ots : single;
  }
  // whoever is speaking talks (the gestures), the other listens
  _talk(cs) {
    const g = this.game, who = cs.lines[cs.i]?.[0], gh = cs.gv.human, ph = g.onFoot.human, G = cs.guest;
    const say = (h, on) => { if (!h) return; if (on && h.acts?.talk) h.play('talk', { hold: true, fade: 0.35 }); else h.clearAction(0.35); };
    const guestTalks = !!G && who === G.id;
    say(gh, who !== 'you' && !guestTalks); say(ph, who === 'you'); if (G) say(G.human, guestTalks);
  }
  // per frame: the two posed (idle, talking, heads turned to each other), the camera on the shot for this line
  _stagedShot(cs, dt) {
    const g = this.game, gv = cs.gv, of = g.onFoot, s = of.state, cam = g.camera, G = cs.guest;
    // (everyone looks at whoever speaks; whoever speaks, at you, or you at the contact)
    const who = cs.lines[cs.i][0], gt = !!G && who === G.id;
    const head = (o, y) => new THREE.Vector3(o.x, o.y + y, o.z);
    const pH = head(s, 1.6), gH = head(gv, 1.58), qH = G ? head(G.state, 1.58) : null;
    const spk = who === 'you' ? pH : gt ? qH : gH;
    gv.body.group.rotation.y = Math.atan2(s.x - gv.x, s.z - gv.z);
    gv.body.group.updateMatrixWorld(true); gv.human.animate(0, dt);
    cs.gIK.look(who === 'you' || !gt ? pH : qH, 0.8);
    s.yaw = Math.atan2(gv.x - s.x, gv.z - s.z);
    of._pose(dt);
    cs.pIK.look(who === 'you' ? gH : spk, 0.8);
    if (G) { G.face = { x: s.x, z: s.z }; G.look = gt ? pH : spk; G.update(dt, null); }
    // the shot: the wide one to open, then over the shoulder of whoever listens onto whoever speaks (every third line
    // the wide one again), a slow drift within it
    const sh = this._shots(cs, cs.side)[this._shotFor(cs)];
    const drift = cs.lt * 0.06;
    cam.position.copy(sh.p).addScaledVector(_a.subVectors(sh.at, sh.p).normalize(), drift);
    cam.lookAt(sh.at); cam.fov = sh.fov; cam.near = 0.1; cam.updateProjectionMatrix();
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
      if (cs.staged) this._talk(cs);
    }
    if (cs.staged) { this._stagedShot(cs, dt); return; }
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
    // (the contact stays where they stood while you're about, not gone the moment the talking stops)
    if (cs.staged) {
      cs.gv.human?.clearAction(0.35); g.onFoot.human?.clearAction(0.35); cs.guest?.human?.clearAction(0.35); cs.gv.stayT = 40;
      // (the walking camera behind you, looking the way you face: toward the contact)
      g.onFoot.camYaw = g.onFoot.state.yaw; g.onFoot.camPitch = 0.12;
    }
    this._subtitle(null);
    this.el.root.classList.remove('cine');
    g.state.mode = 'drive';
    for (const id of ['hud', 'toasts']) document.getElementById(id)?.classList.remove('hidden');
    if (g.onFoot.active) g.onFoot.camPos.copy(g.camera.position); else g.camCtl.snap(g.player);
    cs.done();
  }

  _next() {
    const A = this.active;
    if (!A) return;
    A.i++;
    const st = A.m.steps[A.i];
    if (!st) { if (!this._outroScene()) this.pass(); return; }
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
        if (st.time) s.timeLeft = st.time;
        if (st.ped === 'pickup') s.ped = this._ped(s.target, false);
        break;
      }
      case 'own': {
        const p = g.empire.markers[st.property] || g.empire._marker(PROPERTY_BY_ID[st.property], false);
        s.target = { x: p.spot.x, z: p.spot.z };
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
        // (on the phone, unless everyone talking is in the car with you)
        this._say(st.lines, !st.lines.every(([who]) => this.riders?.[who]?.seated === g.player));
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
      // (Kerala: on a lane by the place, so not until the roads there are built: those first, then try again)
      if (g.world.kerala && typeof st.at === 'string') {
        if ((s.nextTry || 0) > s.t) return false;
        const p = this.placeAt?.(st.at), n = p && g.traffic.graph.nearest(p.x, p.z, (l) => l.edge?.cls <= 7);
        if (!n || n.dist > 120) { s.nextTry = s.t + 1; if (p) g.world.prioritize?.([p]); return false; }
        s.spot = { x: n.x, z: n.z, yaw: Math.atan2(n.dx, n.dz) };
      }
      const v = this._spawnVehicle(type, s.spot, st.paint);
      if (!v) return false;
      v.keep = true; g.onFoot.parked.push(v); A.spawned.push(v);
      s.v = v;
    } else {
      // (Kerala: the AI's route needs the roads along it built; until they are, build those first and try again)
      if (g.world.kerala && (s.nextTry || 0) > s.t) return false;
      const pts = st.route || [st.from || 'giver', st.to];
      if (g.world.kerala && s.t < 15) {
        const need = pts.filter((q) => typeof q === 'string').map((q) => this.placeAt?.(q)).filter((p) => p && !(g.traffic.graph.nearest(p.x, p.z)?.dist < 150));
        if (need.length) { s.nextTry = s.t + 1; g.world.prioritize?.(need); return false; }
      }
      const route = this._route(pts, m, (TRAFFIC_VEHICLES[type]?.params?.length || 0) > 6);
      // (and from its first place, the whole way: with the roads between not built yet a leg was left out, and the
      // route began wherever roads had been - a lorry put down 1.5 km along its way, by a corner it couldn't take
      // from a standstill, and stuck there)
      const p0 = typeof pts[0] === 'string' ? this.placeAt?.(pts[0]) : null;
      const short = route.length < 4 || (s.t < 60 && p0 && Math.hypot(route[0][0] - p0.x, route[0][1] - p0.z) > 150) || (s.t < 15 && route.broken);
      // (the places' own tiles first: the nearest lane to a place not built yet is wherever roads are)
      if (g.world.kerala && short) { s.nextTry = s.t + 1; g.world.prioritize?.(pts.map((q) => (typeof q === 'string' && this.placeAt?.(q)) || this._resolve(q, m))); return false; }
      let spot;
      if (st.type === 'race') {
        // line up beside the player, facing the first leg (Kerala: the rival in the lane, you beside him in the other
        // one: 1.8 m either side of a narrow lane's centre had him half on the verge)
        const p = g.player.state, a = route[0], b = route[1] || route[0];
        const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]), [oL, oR] = g.world.kerala ? [0, 3] : [1.8, 1.8];
        g.player.place(a[0] - Math.cos(yaw) * oR, a[1] + Math.sin(yaw) * oR, yaw);
        g.camCtl.snap(g.player);
        spot = { x: a[0] + Math.cos(yaw) * oL, z: a[1] - Math.sin(yaw) * oL, yaw };
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

  // the marker on the ground (Kerala's isn't at sea level: a ring at 0 was under the road), kept for the spot
  _groundY(x, z) {
    const c = this._gy;
    if (c && c.x === x && c.z === z && c.y) return c.y;
    const y = this.game.world.layout.groundHeight?.(x, z) || 0;
    this._gy = { x, z, y };
    return y;
  }

  // a step still waiting for its car (Kerala: not put there until the roads round the place are built, which is when
  // you're a few kilometres off): the marker and the GPS on the place meanwhile, so you know where to go
  _pendingWay(st, s, dt) {
    const g = this.game, name = st.at || st.from || st.route?.[0];
    const p = typeof name === 'string' ? this.placeAt?.(name) : null;
    if (!p) return;
    this.dest.visible = true; this.arrow.visible = false;
    this.dest.position.set(p.x, this._groundY(p.x, p.z), p.z);
    if (!s.gpsT || s.gpsT <= 0) { g.setGPS(p.x, p.z); s.gpsT = 2.5; }
    s.gpsT -= dt;
    this.target = { x: p.x, z: p.z };
  }

  // taxi passengers: one waits on the pavement at the pickup; the one you drop off walks away
  _ped(at, walker) {
    const g = this.game;
    if (!g.humans?.ready) return null;
    const sw = g.empire.sidewalk(at.x, at.z);
    const h = g.humans.create(Math.floor(Math.random() * 8), { shadow: g.preset.shadows !== 'off', idle: walker ? 'idle' : 'talk' });
    if (!h) return null;
    h.group.position.set(sw.x, sw.y, sw.z);
    h.group.rotation.y = walker ? sw.face + Math.PI / 2 : sw.face;
    g.scene.add(h.group);
    const p = { h, walker, t: 0, dispose: () => { h.dispose(); this.peds = this.peds.filter((q) => q !== p); } };
    (this.peds ||= []).push(p);
    return p;
  }
  _updatePeds(dt) {
    for (const p of [...(this.peds || [])]) {
      p.t += dt;
      const gr = p.h.group;
      if (p.walker) {
        gr.position.x += Math.sin(gr.rotation.y) * 1.4 * dt; gr.position.z += Math.cos(gr.rotation.y) * 1.4 * dt;
        if (p.t > 7) { p.dispose(); continue; }
      }
      gr.updateMatrixWorld(true);
      p.h.animate(p.walker ? 1.4 : 0, dt);
    }
  }

  vehicles() {
    const A = this.active;
    if (A?.script) return A.script.vehicles();
    return A?.st?.ai ? [A.st.v] : [];
  }

  // before the player vehicle is simulated
  update(dt, input, driving) {
    const g = this.game;
    this._updateSubs(dt);
    this._updatePeds(dt);
    this._updateRiders(dt);
    this.promptHtml = null;
    this._animGivers(dt);
    if (!driving) return;
    if (!this.active) { this._offer(input); return; }
    if (this.active.script) { this.active.script.update(dt, input); return; }
    const A = this.active, st = A.m.steps[A.i], s = A.st;
    if (!st || !s) return;
    s.t += dt;
    if (s.pending) { if (this._spawnPending(st, s)) s.pending = false; else { this._pendingWay(st, s, dt); return; } }
    const f = g.focusState;
    const inCar = !g.onFoot.active;
    const P = g.player;
    let target = null, arrowOn = null;
    const lost = this._riderLost(s);
    if (lost === 'left') { this.fail(`You left ${CAST[s.lostR.id]?.name || 'him'} behind.`); return; }
    if (lost) arrowOn = lost;
    else switch (st.type) {
      case 'goto': case 'deliver': {
        target = s.target;
        if (st.type === 'deliver' && A.vehicle) {
          if (A.vehicle.state.damage > (st.maxDamage ?? 1)) { this.fail('The car is wrecked.'); return; }
          if (P !== A.vehicle || !inCar) { this._objective(`Get back in the <b>car</b>.`); arrowOn = A.vehicle; target = null; s.away = true; break; }
          if (s.away) { s.away = false; this._objective(st.text); }
          this._meter('CAR CONDITION', 1 - A.vehicle.state.damage / (st.maxDamage || 1), A.vehicle.state.damage > (st.maxDamage || 1) * 0.7);
        }
        if (st.inVehicle && !inCar) {
          // odd jobs: walking away from the car ends the shift
          if (A.m.job) { s.outT = (s.outT || 0) + dt; if (s.outT > 4) { this.endJob('You stopped working.'); return; } }
          this._objective('Get in a <b>car</b>.'); s.needCar = true; target = null; break;
        }
        s.outT = 0;
        if (st.time) {
          s.timeLeft -= dt;
          if (s.timeLeft <= 0) { this.fail(A.m.job?.kind === 'taxi' ? 'The passenger got out and walked.' : 'You ran out of time.'); return; }
        }
        if (s.needCar && inCar) { s.needCar = false; this._objective(st.text); }
        let d = Math.hypot(f.x - s.target.x, f.z - s.target.z);
        // (a place kilometres off is put on the nearest road loaded when the step starts, maybe not its own: worked out
        // again once its roads are in. Chirakkal's spot was left 60 m from any road, the step never done)
        if (typeof st.to === 'string' && st.to !== 'giver' && !s.reTarget && d < 400) {
          s.reTarget = true; s.target = target = this._resolve(st.to, A.m); d = Math.hypot(f.x - s.target.x, f.z - s.target.z);
        }
        const sp = Math.hypot(f.vx || 0, f.vz || 0);
        // someone to pick up or drop off here: he comes to the car (or gets out) before the step is done
        const R = this._riderFor(st, s, d);
        if (R) { if (this._riderStop(R, st, s, d, sp, dt)) { this._next(); return; } if (s.boarding || s.dropping) target = null; break; }
        if (d < 9 && (!st.stop || sp < 3)) {
          s.hold = (s.hold || 0) + dt;
          if (s.hold > (st.stop ? 1.2 : 0)) {
            if (s.ped) { s.ped.dispose(); s.ped = null; g.audio.playEvent('doorShut', { position: { x: f.x, y: 0.9, z: f.z } }); }
            if (st.ped === 'drop') this._ped({ x: f.x, z: f.z }, true);
            this._next(); return;
          }
        } else s.hold = 0;
        if (st.stop && d < 25 && sp > 3) this._meter('STOP HERE', 1 - d / 25, false);
        else if (st.time) this._meter(`TIME ${Math.ceil(s.timeLeft)}s · ${Math.round(d)} m`, s.timeLeft / st.time, s.timeLeft < 15);
        break;
      }
      case 'own': {
        if (g.empire.owns(st.property)) { this._next(); return; }
        target = s.target;
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
        const atEnd = Math.hypot(v.state.x - s.end[0], v.state.z - s.end[1]) < 18 && ai.idx >= ai.route.length - 3;
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
      this.dest.position.set(target.x, this._groundY(target.x, target.z), target.z);
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
      if (gv.provisional) continue;
      const busy = this.cs?.gv === gv || this.active?.script?.giverOn === id;
      // (a contact you've just finished a job with stays for the last words, until you've gone)
      if (gv.stayT > 0) { const c = this.game.camera.position; gv.stayT = Math.hypot(c.x - gv.x, c.z - gv.z) > 80 ? 0 : gv.stayT - dt; }
      gv.body.group.visible = on || busy || gv.stayT > 0;
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
  late() {
    // (a contact's offer cleared once you've moved off or taken the job: nothing else clears a prompt while driving,
    // and 'press E' stayed up all through the mission)
    if (this._prompted && !this.promptHtml) this.game.hud.setPrompt(null);
    this._prompted = !!this.promptHtml;
    this.active?.script?.late();
    if (this.promptHtml) this.game.hud.setPrompt(this.promptHtml);
  }

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
    A.script?._dispose(keepCar);
    for (const v of A.spawned) {
      if (keepCar && g.player === v) { v.keep = false; v.mission = false; continue; }
      if (g.player === v) continue; // never delete the car you're sitting in
      const i = g.onFoot.parked.indexOf(v); if (i >= 0) g.onFoot.parked.splice(i, 1);
      v.dispose();
    }
    if (A.st?.ped) { A.st.ped.dispose(); A.st.ped = null; }
    // riders: gone with the mission, unless dropped off and walking away (they go on their own)
    for (const [id, r] of Object.entries(this.riders || {})) if (r.job !== 'leave') { r.dispose(); delete this.riders[id]; }
    this.active = null;
    this.dest.visible = false; this.arrow.visible = false; this.target = null;
    this._objective(null); this._meter(null);
    g.gps = null;
  }

  pass() {
    const g = this.game, m = this.active.m, said = this.active.outroDone;
    if (m.job) {
      const pay = m.pay ? m.pay(this) : 0;
      this._cleanup(true);
      g.save.addCash(pay, 'job');
      g.progress?.addXp(Math.round(pay / 12), 'job');
      g.hud.message('JOB COMPLETE', `${m.title} · ${formatMoney(pay)}`, 3.5);
      g.audio.playEvent('checkpoint');
      g.empire.jobDone(m, true);
      bus.emit('job:pass', { kind: m.job.kind, pay });
      return;
    }
    this._cleanup(true);
    this.done[m.id] = true;
    const gv = this.givers[m.giver];
    if (gv && !gv.provisional && this._here(m.giver)) gv.stayT = 30;
    const r = m.reward || {};
    if (r.cash) g.save.addCash(Math.round(r.cash * (g.progress?.rewardMult || 1)), 'story');
    if (r.xp) g.progress?.addXp(r.xp, 'story');
    g.save.save();
    g.hud.message('MISSION PASSED', `${m.title.toUpperCase()} · ${formatMoney(r.cash || 0)} · +${(r.xp || 0).toLocaleString()} XP`, 4.5);
    g.audio.playEvent('raceFinish');
    if (m.outro?.length && !said) this._say(m.outro.map(([w, t]) => [w, t, !this._here(w)]), true);
    if (m.chapterEnd) { const nc = STORY_CHAPTERS.find((c) => c.id === m.chapterEnd + 1); setTimeout(() => g.hud.message(`CHAPTER ${m.chapterEnd} COMPLETE`, nc ? `NEXT: ${nc.name.toUpperCase()}` : '', 4), 5000); }
    if (m.finale) setTimeout(() => g.ui.toast(`STORY COMPLETE — ${g.world.kerala ? 'Kannur' : 'Port Halvern'} is yours. The city is still open for business.`, 'cash', 8), 4800);
    else { const nx = STORY.find((x) => !this.done[x.id] && (x.requires || []).every((q) => this.done[q])); if (nx) setTimeout(() => g.ui.toast(`New mission from ${CAST[nx.giver].name}: ${nx.title} (see the minimap)`, '', 6), 4800); }
    bus.emit('story:pass', { id: m.id });
  }

  fail(reason) {
    const g = this.game, m = this.active?.m;
    if (!m) return;
    if (m.job) { this._cleanup(true); g.hud.message('JOB FAILED', reason, 3.5); g.audio.playEvent('busted'); g.empire.jobDone(m, false); return; }
    this._cleanup(false);
    g.hud.message('MISSION FAILED', reason, 4);
    g.audio.playEvent('busted');
    this.lastFailed = m;
    setTimeout(() => { if (g.state.mode === 'drive' && !this.active) g.ui.showStoryFail(m, reason); }, reason === 'BUSTED' ? 5200 : 2200);
    bus.emit('story:fail', { id: m.id, reason });
  }

  retry(m) {
    const g = this.game;
    if (m.script) { g.police.clearAll(); if (g.onFoot.dead) g.onFoot.heal(); this.start(m, true); return; }
    const gv = this._giver(m.giver);
    if (g.onFoot.active) g.onFoot.enter({ kind: 'own', ref: g.player });
    g.police.clearAll();
    g.player.state.damage = 0; g.player.renderer.repair?.();
    g.player.place(gv.lane.x, gv.lane.z, gv.lane.yaw);
    g.camCtl.snap(g.player);
    this.start(m, true);
  }

  // quit an odd job without a penalty
  endJob(reason) {
    const g = this.game, m = this.active?.m;
    if (!m?.job) return;
    this._cleanup(true);
    g.hud.message('JOB ENDED', reason, 2.5);
    g.empire.jobDone(m, false);
  }

  abort() { if (this.active) this._cleanup(false); if (this.cs) { this.cs = null; this.el.root.classList.remove('cine'); this._subtitle(null); } }

  // the prologue (Kerala): played at the start of a new story, or from the pause menu
  get prologue() { return STORY.find((m) => m.prologue); }
  startPrologue(skipIntro = false) {
    const m = this.prologue;
    if (!m || this.active) return false;
    this.game.save.data.story.prologueOffered = true;
    this.start(m, skipIntro);
    return true;
  }
  // skipped (from the pause menu): done, no reward, the story goes on from Babu's first job
  skipPrologue() {
    const m = this.active?.m;
    if (!m?.prologue) return;
    this._cleanup(false);
    this.done[m.id] = true; this.game.save.save();
    this.game.spawnPlayer();
    this.game.applyTime?.();
    this.game.ui.toast(`Prologue skipped. Babu has work for you (see the minimap).`, '', 5);
  }
}
