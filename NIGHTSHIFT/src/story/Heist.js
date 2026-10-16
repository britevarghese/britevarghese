// PROLOGUE: "The Kayal Job" - how the story begins, the GTA way: a crew, a bank, a chase.
//
// Kannur, 10:20 on a weekday morning. A black Scorpio parked down the road from Kayal Mercantile Bank: you at the
// wheel (the driver), Leena beside you (she plans it), Sajan in the back (he carries the guns). The Onam bonus
// cash came in last night. The cold open plays in the car; then you walk to the bank with them, pull on the
// Kathakali masks at the door and go in. Sajan's shot into the ceiling, everyone down; the old guard thinks about
// his twelve-bore and doesn't. You bring the manager out of his cabin to the strongroom, and the cashier with the
// second key (two keys, as in every Indian bank); the door swings; you fill the bag rack by rack. Someone presses
// the silent alarm: the bell, a clock running down. Out of the door with the bag, police jeeps coming up the road,
// Sajan splits off through the market, Leena into the car beside you: lose the police, then drive to Babu's
// workshop at Thavakkara, where the car disappears and the story proper begins (Babu's first job).
//
// Everyone in it is a real character, kept in step with the player: the crew walk with you, take up their places
// in the bank, get into the car with you and sit there through the chase talking, and the cutscenes stage them
// where the gameplay left them.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { CAST } from './StoryData.js';
import { CrewMember } from './Crew.js';
import { Cinema, titleCard } from './Cinema.js';
import { findBank, refindBank, dressBank, buildBank, setVault, BankPeople } from '../world/Bank.js';
import { INDOOR } from '../world/Interiors.js';
import { passengerProfile, interactionProfile } from '../vehicles/Interaction.js';
import { wearMask, makeBag } from './HeistProps.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const LOOT_PER_RACK = 4.2;      // seconds of holding E at a rack
const ALARM_TIME = 105;          // seconds from the alarm until the police are at the door
const TINT = 0.75;               // the Scorpio's dark windows

export class Heist {
  constructor(game, story, mission) {
    this.g = game; this.story = story; this.m = mission;
    this.phase = 'load'; this.t = 0; this.T = 0;
    this.cinema = story.cinema ||= new Cinema(game, story);
    this.cash = 0;
  }

  // ------------------------------------------------------------------ small helpers
  say(speaker, text) { this.story._say([[speaker, text]], false); }
  obj(html) { this.story._objective(html); }
  meter(label, k, danger) { this.story._meter(label, k, danger); }
  go(phase) { this.phase = phase; this.t = 0; this['_' + phase + 'Start']?.(); }
  get of() { return this.g.onFoot; }
  // a point in the car's own frame, in the world now (x left, y up, z forward)
  carPt(x, y, z, out = new THREE.Vector3()) { const b = this.car.renderer.body; b.updateMatrixWorld(true); return b.localToWorld(out.set(x, y, z)); }
  // ... as a camera path point for a shot (follows the car)
  cp(x, y, z) { return (k, out) => this.carPt(x, y, z, out); }
  // a crew member's head, for the camera to look at
  head(m, dy = 0) { return (k, out) => { const H = m.human?.B?.Head; if (H) { H.getWorldPosition(out); out.y += dy; } else out.set(m.state.x, m.state.y + 1.6 + dy, m.state.z); return out; }; }
  playerHead(dy = 0) { return (k, out) => { const H = this.of.human?.B?.Head; if (H) { H.getWorldPosition(out); out.y += dy; } else { const s = this.of.state; out.set(s.x, s.y + 1.6 + dy, s.z); } return out; }; }
  // the windows clearer while the camera looks in through them (dark glass hides the faces), and back
  seeIn(on) { const m = this.car?.renderer?.mats?.glass; if (m) m.opacity = on ? 0.28 : 0.22 + TINT * 0.6; }
  // ... and as a gaze, for someone's eyes to follow (a crew member's look, the player's seated gaze)
  headOf(m) { const f = m === 'you' ? this.playerHead(0.06) : this.head(m, 0.06); return (out) => f(0, out); }

  // ------------------------------------------------------------------ start
  start(skipIntro = false) {
    this.skipIntro = skipIntro;
    const g = this.g;
    g.lib.load(['scorpio', 'bolero'], 1);
    // a weekday morning, a clear sky
    g.env.hour = 10.33; g.env.setWeather?.('clear');
    this.go('load');
  }

  _ready() {
    const g = this.g;
    if (!g.humans?.ready || !g.lib.has('scorpio')) return false;
    if (!this.site) {
      const s = g.player?.state || g.onFoot.state;
      this.site = findBank(g, { x: s.x, z: s.z });
      if (!this.site) { if (this.T > 20) { this.story.fail('The bank could not be set up here.'); } return false; }
    }
    return true;
  }

  // the scene: the bank's front, the getaway car parked down the road with all three in it
  _setup() {
    const g = this.g, site = this.site;
    this.front = dressBank(g, site);
    // the car: at the kerb on the bank's side, 14 m short of the door, facing on along the road
    const n = g.traffic.graph.nearest(site.road.x, site.road.z, (l) => l.edge?.cls <= 7) || { x: site.road.x, z: site.road.z, dx: 1, dz: 0 };
    const tmp = {};
    let px = n.x, pz = n.z, dx = n.dx, dz = n.dz;
    if (n.lane) { n.lane.sample(Math.max(0, n.s - 14), tmp); px = tmp.x; pz = tmp.z; dx = tmp.dx; dz = tmp.dz; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // (the kerb is on the left in Kerala: out to the left until the carriageway's edge is near)
    let off = 0;
    for (let k = 0.4; k <= 2.0; k += 0.4) { if (g.world.onCarriageway(px + dz * (k + 1.1), pz - dx * (k + 1.1))) off = k; else break; }
    const spot = { x: px + dz * off, z: pz - dx * off, yaw: Math.atan2(dx, dz) };
    const v = this.story._spawnVehicle('scorpio', spot, '#121418');
    if (!v) return false;
    v.renderer.applyCustom?.({ paint: '#121418', finish: 'gloss', tint: TINT });
    this.car = v; this.carSpot = spot;
    // the player at its wheel (their own car put away until the end)
    const of = this.of, old = g.player;
    of.inter.release(); of.inter._detach(); of.body.group.quaternion.identity();
    of.seq = null; of.active = false;
    of.parked.splice(0, of.parked.length, ...of.parked.filter((q) => q !== v));
    g.player = v; v.keep = false;
    if (old && old !== v && !old.gone) { old.dispose(); }
    of.inter.seatInstant(v);
    of.body.group.visible = true;
    g.camCtl.snap(v); g.camBlend = null;
    document.getElementById('hud')?.classList.remove('onfoot');
    // the crew: Leena beside you, Sajan behind her
    this.leena = new CrewMember(g, { id: 'leena', name: 'Leena', model: 'kl_modern', slot: [0.95, -0.55] });
    this.sajan = new CrewMember(g, { id: 'sajan', name: 'Sajan', model: 'jake', outfit: { top: 0x26262a, bottom: 0x1f2430 }, slot: [-0.95, -0.85] });
    this.crew = [this.leena, this.sajan].filter((c) => c.ok);
    for (const c of this.crew) c.mates = this.crew.filter((o) => o !== c);
    const PP = passengerProfile(v);
    this.pp = PP;
    if (PP) this.leena.seatIn(v, PP);
    if (PP) { const RP = { ...PP, seat: PP.seat.clone().add(new THREE.Vector3(0, 0.03, -0.86)), pedals: { L: PP.pedals.L.clone().add(new THREE.Vector3(0, 0, -0.86)), R: PP.pedals.R.clone().add(new THREE.Vector3(0, 0, -0.86)) }, door: { ...PP.door, real: false } }; this.rp = RP; this.sajan.seatIn(v, RP); }
    // (the police follow the player's car: parked outside while the crew are in the bank, it is not to be 'busted')
    g.police.bustHold = true;
    // the bank's door: walked into with its own layout
    g.interiors.custom ||= new Map();
    g.interiors.custom.set(site.c, { builder: (I, c, door) => this._buildInside(I, c, door), side: site.side, t: 0, word: 'go into the bank' });
    return true;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, input) {
    const g = this.g;
    this.t += dt; this.T += dt;
    if (this.cinema.active) { this.cinema.update(dt, input); this._crew(dt); this._people(dt); this._alarm(dt); return; }
    // failure: the player dead, the car wrecked
    if (this.of.dead) { this.story.fail('WASTED'); return; }
    if (this.car && this.car.state.damage >= 1 && this.phase !== 'outro') { this.story.fail('The getaway car is wrecked.'); return; }
    const f = this['_' + this.phase];
    f?.call(this, dt, input);
    this._crew(dt);
    this._people(dt);
    this._alarm(dt);
    this._marker();
  }

  _crew(dt) {
    const L = this.of.active ? this.of.state : null;
    for (const c of this.crew || []) c.update(dt, L);
    // the bag in the player's left hand
    if (this.bag) {
      const H = this.of.human?.B?.LeftHand, on = !!H && this.of.active && this.of.body.group.visible;
      this.bag.visible = on;
      if (on) { H.getWorldPosition(this.bag.position); this.bag.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.of.state.yaw + Math.PI / 2); this.bag.updateMatrixWorld(true); }
    }
  }
  _people(dt) { if (this.people && this.g.interiors.active?.type === 'bank') this.people.update(dt); }

  _marker() {
    const S = this.story;
    const tgt = this.target;
    S.dest.visible = !!tgt;
    if (tgt) {
      S.dest.position.set(tgt.x, tgt.y ?? 0, tgt.z);
      S.dest.children[1].material.opacity = 0.6 + Math.sin(performance.now() / 250) * 0.25;
      if (tgt.gps && (!this.gpsT || (this.gpsT -= 1 / 60) <= 0)) { this.g.setGPS(tgt.x, tgt.z); this.gpsT = 2.5; }
    }
    S.target = tgt ? { x: tgt.x, z: tgt.z } : null;
  }

  // ------------------------------------------------------------------ phases
  _load() {
    if (!this._ready()) return;
    if (!this._setup()) return;
    if (this.skipIntro) { this._outOfCar(); this.go('approach'); }
    else this.go('intro');
  }

  // --- the cold open, in the car
  _introStart() {
    const g = this.g, site = this.site, car = this.car, L = this.leena, S = this.sajan;
    const fr = site.front, rd = site.road;
    const ux = rd.x - fr.x, uz = rd.z - fr.z, ul = Math.hypot(ux, uz) || 1, ox = ux / ul, oz = uz / ul;   // out from the bank
    const ax = -oz, az = ox;                                                                              // along the road
    const P = interactionProfile(car), dS = P.seat, pS = this.pp?.seat || new THREE.Vector3(-dS.x, dS.y, dS.z);
    const y0 = site.floor;
    const shots = [
      // 1. down the street at the rooftops, easing down toward the bank (it began 46 m up and came down out of the sky:
      // the game seemed to open with the car falling from above)
      { dur: 6, cam: { pos: (k, o) => o.set(fr.x + ox * (30 - 8 * k) + ax * (38 - 14 * k), y0 + 11 - 5 * k, fr.z + oz * (30 - 8 * k) + az * (38 - 14 * k)), look: (k, o) => o.set(fr.x + ox * 8, y0 + 2, fr.z + oz * 8), fov: 52 },
        on: [[0.4, () => titleCard(this.story, 'NIGHTSHIFT', 'Kannur, Kerala &nbsp;·&nbsp; 10:20 AM', 5.4)]] },
      // 2. across the road at the bank's board, the Scorpio waiting down the road
      { dur: 4.2, cam: { pos: (k, o) => o.set(fr.x + ox * 11.5 + ax * (5 - 3 * k), y0 + 1.5, fr.z + oz * 11.5 + az * (5 - 3 * k)), look: (k, o) => o.set(fr.x + ax * (1.5 - 3 * k), y0 + 2.4 - 0.9 * k, fr.z + az * (1.5 - 3 * k)), fov: 46 } },
      // 3. through the windscreen on a long lens: the two of them in front, Sajan in the dark behind
      { dur: 6.4, cam: { pos: (k, o) => this.carPt(-dS.x * 0.6 - 0.06 * k, dS.y + 0.8, P.box.max.z - 0.1 - 0.35 * k, o), look: this.cp(dS.x * 0.05, dS.y + 0.6, dS.z - 0.2), fov: 34 },
        enter: () => this.seeIn(true), exit: () => this.seeIn(false),
        on: [[0.3, () => { this.of.inter.gaze = this.headOf(L); }], [3.4, () => { L.look = this.headOf(S); this.of.inter.gaze = null; }]],
        lines: [[0.2, 'leena', 'Kayal Mercantile Bank. Opens at ten. The Onam bonus cash came in from Ernakulam last night.'], [3.6, 'sajan', 'One guard. Sixty-two, ex-army. Asleep after his tea.']] },
      // 4. on Leena, from the middle of the dash (off her eyeline: she's looking at you)
      { dur: 6.2, cam: { pos: this.cp(dS.x * 0.05, dS.y + 0.63, dS.z + 0.5), look: this.head(L, 0.03), fov: 50 },
        enter: () => { L.look = this.headOf('you'); S.look = this.headOf(L); },
        on: [[3.2, () => { this.of.inter.gaze = this.headOf(L); }]],
        lines: [[0.2, 'leena', 'Nobody gets hurt. In, strongroom, out. Four minutes.'], [3.4, 'you', "I'm the driver. I stay in the car."]] },
      // ... on you, from hers
      { dur: 4.4, cam: { pos: this.cp(-dS.x * 0.38, dS.y + 0.64, dS.z + 0.42), look: this.playerHead(0.04), fov: 40 },
        enter: () => { this.of.inter.gaze = this.headOf(L); },
        lines: [[0.2, 'leena', 'Not today. Today we need three pairs of hands.']] },
      // 5. Sajan in the back with the masks, between the front seats
      { dur: 6, cam: { pos: this.cp(0, dS.y + 0.6, dS.z + 0.07), look: this.head(S, 0.02), fov: 46 },
        enter: () => { S.look = this.headOf('you'); L.look = this.headOf(S); this.of.inter.gaze = this.headOf(S); },
        on: [[3.5, () => { S.look = this.headOf(L); }]],
        exit: () => { L.look = null; S.look = null; this.of.inter.gaze = null; },
        lines: [[0.2, 'sajan', 'Kathakali masks. Two hundred rupees each at Payyambalam beach.'], [3.6, 'leena', "Masks on at the door, not before. Let's go."]] },
      // 6. out of the car (a cut): the three on the pavement, the bank ahead
      { dur: 4, enter: () => this._outOfCar(), cam: { pos: (k, o) => { const s = this.of.state; return o.set(s.x - Math.sin(s.yaw) * (4.2 - k * 1.2) + Math.cos(s.yaw) * 0.8, s.y + 1.7, s.z - Math.cos(s.yaw) * (4.2 - k * 1.2) - Math.sin(s.yaw) * 0.8); }, look: (k, o) => o.set(site.door.x, y0 + 1.6, site.door.z), fov: 55 } },
    ];
    void car; void g;
    this.cinema.play(shots, () => this.go('approach'));
  }

  // everyone out of the car onto the pavement beside it (between cuts): you at the driver's door, Leena and Sajan
  // on the kerb side, all facing the bank
  _outOfCar() {
    const g = this.g, car = this.car, site = this.site;
    const yawTo = (x, z) => Math.atan2(site.door.x - x, site.door.z - z);
    const P = interactionProfile(car);
    const dp = this.carPt(P.exit.x, 0, P.exit.z - 0.3), lp = this.carPt(-P.exit.x * 0.9, 0, P.exit.z + 0.6), sp = this.carPt(-P.exit.x * 0.9, 0, P.exit.z - 1.1);
    // (the driver's side is the road side: step round to the pavement, by the back of the car)
    const back = this.carPt(-P.exit.x * 0.2, 0, P.box.min.z - 0.9);
    const pxz = g.world.onCarriageway(dp.x, dp.z) ? back : dp;
    this.of.inter.gaze = null;
    this.of.bail(pxz.x, pxz.z, yawTo(pxz.x, pxz.z));
    this.of.human?.clearAction(0);
    for (const v of [car]) { v.controls.throttle = 0; v.controls.handbrake = 1; }
    if (!this.of.parked.includes(car)) this.of.parked.push(car);
    car.keep = true;
    for (const d of [1, -1]) car.renderer?.setDoor?.(d, false);
    this.leena._out(); this.leena.place(lp.x, lp.z, yawTo(lp.x, lp.z));
    this.sajan._out(); this.sajan.place(sp.x, sp.z, yawTo(sp.x, sp.z));
    for (const c of this.crew) { c.stand(yawTo(c.state.x, c.state.z)); c.human?.clearAction(0); }
  }

  // --- to the bank with the crew
  _approachStart() {
    const site = this.site;
    for (const c of this.crew) c.follow();
    this.obj('Go into the <b>bank</b> with Leena and Sajan.');
    this.target = { x: site.door.x, z: site.door.z, y: site.floor, gps: false };
    this.masked = false;
  }
  _approach() {
    const g = this.g, s = this.of.state, site = this.site;
    // back in the car: the crew waits
    if (!this.of.active) { this.obj('Not yet. Get out and go into the <b>bank</b>.'); for (const c of this.crew) if (c.mode === 'follow') c.stand(); return; }
    if (this.crew.some((c) => c.mode === 'stand')) for (const c of this.crew) if (c.mode === 'stand') c.follow();
    // masks at the door
    const d = Math.hypot(s.x - site.door.x, s.z - site.door.z);
    if (!this.masked && d < 5) {
      this.masked = true;
      this.say('leena', 'Masks.');
      if (this.of.human) this.playerMask = wearMask(this.of.human, 'pacha');
      this.leena.setMask('minukku'); this.sajan.setMask('kathi');
      this.leena.setGun(true); this.sajan.setGun(true);
    }
    // inside (the player walked through the door: Interiors built the branch with our layout)
    const A = g.interiors.active;
    if (A?.type === 'bank') { this.layout = A; this.go('holdup'); }
  }

  // the branch itself, built when the player walks in (also called again after a retry)
  _buildInside(I, c, door) {
    const A = buildBank(I, c, door);
    this.layout = A;
    this.people?.dispose();
    this.people = new BankPeople(this.g, A);
    A.dispose = () => { this.people?.dispose(); this.people = null; };
    return A;
  }

  // --- the hold-up, in the hall
  _holdupStart() {
    const g = this.g, A = this.layout, M = A.marks, of = this.of, y0 = A.floor;
    if (!this.masked) { this.masked = true; if (of.human) this.playerMask = wearMask(of.human, 'pacha'); this.leena.setMask('minukku'); this.sajan.setMask('kathi'); this.leena.setGun(true); this.sajan.setGun(true); }
    // the crew come in behind the player
    const ins = M.inside, fwdx = Math.sin(ins.yaw), fwdz = Math.cos(ins.yaw), rx = -Math.cos(ins.yaw), rz = Math.sin(ins.yaw);
    this.sajan._out(); this.sajan.place(ins.x - rx * 0.9 - fwdx * 0.2, ins.z - rz * 0.9 - fwdz * 0.2, ins.yaw);
    this.leena._out(); this.leena.place(ins.x + rx * 0.9 + fwdx * 0.3, ins.z + rz * 0.9 + fwdz * 0.3, ins.yaw);
    for (const c of this.crew) { c.setIndoor(INDOOR, true); c.stand(ins.yaw); }
    // the player's gun in hand (seen indoors too)
    for (const o of [of.pistol.gun, of.pistol.flash, of.pistol.tracer, of.pistol.spark]) o?.traverse((q) => q.layers.enable(INDOOR));
    of.pistol.armed = true; of.pistol.mag = 12;
    const hall = M.hallMid, guard = this.people.guard, gx = guard?.x ?? M.guard.x, gz = guard?.z ?? M.guard.z;
    const ceiling = new THREE.Vector3(ins.x + fwdx * 2.5, y0 + 3.0, ins.z + fwdz * 2.5);
    const shots = [
      // 1. from behind the counter: three masks in the doorway; Sajan's shot into the ceiling
      { dur: 3.6, cam: { pos: (k, o) => o.set(M.staffMid.x, y0 + 1.75, M.staffMid.z), look: (k, o) => o.set(ins.x, y0 + 1.45, ins.z), fov: 50 },
        on: [[0.8, () => { this.sajan.aimAt = ceiling; }], [1.5, () => this._shot(this.sajan)], [1.55, () => this.people.holdUp(ins)], [2.2, () => { this.sajan.aimAt = new THREE.Vector3(hall.x, y0 + 0.8, hall.z); }]],
        lines: [[1.65, 'sajan', 'Everybody down! Hands on your heads! NOW!']] },
      // 2. the hall from high in the corner: people dropping to the floor
      { dur: 3.8, cam: { pos: (k, o) => o.set(M.nearDoor.x + (hall.x - M.nearDoor.x) * 0.2, y0 + 2.55, M.nearDoor.z + (hall.z - M.nearDoor.z) * 0.2), look: (k, o) => o.set(M.queue[0]?.x ?? hall.x, y0 + 0.7, M.queue[0]?.z ?? hall.z), fov: 62 },
        lines: [[0.3, 'customer', 'Ayyo!'], [1.4, 'leena', 'Nobody needs to be a hero today. Down. On the floor.']] },
      // 3. the old guard: his hand goes toward his gun; Leena's on him
      { dur: 4.4, enter: () => { this.leena.aimAt = new THREE.Vector3(gx, y0 + 1.2, gz); this.leena.face = { x: gx, z: gz }; },
        // (over her right shoulder, the gun arm in the picture, easing in; the left one if someone stands close
        // on the right)
        cam: { pos: (k, o) => {
          const s = this.leena.state, dx = gx - s.x, dz = gz - s.z, d = Math.hypot(dx, dz) || 1, fx = dx / d, fz = dz / d;
          if (this.ots == null) {
            const near = (sd) => Math.min(...[of.state, this.sajan.state].map((q) => Math.hypot(q.x - (s.x - fx * 0.95 - fz * 0.38 * sd), q.z - (s.z - fz * 0.95 + fx * 0.38 * sd))));
            this.ots = near(1) > 0.9 || near(1) >= near(-1) ? 1 : -1;
          }
          const sd = this.ots;
          return o.set(s.x - fx * (0.95 - 0.2 * k) - fz * 0.38 * sd, y0 + 1.68, s.z - fz * (0.95 - 0.2 * k) + fx * 0.38 * sd);
        }, look: (k, o) => o.set(gx, y0 + 1.1, gz), fov: 42 },
        lines: [[0.2, 'leena', "Uncle. Don't."], [1.8, 'guard', 'Ente Guruvayurappa...']], on: [[2.6, () => { if (guard) this.people._set(guard, 'cower'); }]] },
      // 4. Leena to you: the plan
      { dur: 5.2, cam: { pos: (k, o) => { const s = this.leena.state; return o.set(s.x - Math.sin(s.yaw) * 1.1 + Math.cos(s.yaw) * 0.45, y0 + 1.72, s.z - Math.cos(s.yaw) * 1.1 - Math.sin(s.yaw) * 0.45); }, look: this.playerHead(-0.1), fov: 46 },
        enter: () => { this.leena.face = { x: of.state.x, z: of.state.z }; this.leena.look = this.playerHead()(0, new THREE.Vector3()); },
        lines: [[0.2, 'leena', "The manager's cabin, at the back. Bring him to the strongroom."], [2.9, 'sajan', "I've got the door."]] },
    ];
    this.cinema.play(shots, () => {
      this.leena.look = null; this.leena.aimAt = new THREE.Vector3(M.staffMid.x, y0 + 0.9, M.staffMid.z);
      this.sajan.aimAt = new THREE.Vector3(hall.x, y0 + 0.8, hall.z);
      this.go('manager');
    });
  }

  _shot(m) {
    const g = this.g, hp = m.human?.B?.RightHand?.getWorldPosition(new THREE.Vector3());
    if (!hp) return;
    g.audio?.playEvent('gunshot', { position: { x: hp.x, y: hp.y, z: hp.z } });
    const P = this.of.pistol;
    P.flash.position.copy(hp).add(new THREE.Vector3(0, 0.12, 0)); P.flash.visible = true; P.flashT = 0.06;
    g.camCtl?.addShake?.(0.08);
  }

  // --- the manager out of his cabin
  _managerStart() {
    const M = this.layout.marks;
    this.obj('Bring the <b>manager</b> out of his cabin.');
    // Leena takes the staff gate, covering the counter; Sajan the hall from the door
    this.leena.goTo(M.gateStaff.x, M.gateStaff.z, { face: { x: M.staffMid.x, z: M.staffMid.z } });
    this.sajan.goTo(M.nearDoor.x, M.nearDoor.z, { face: { x: M.hallMid.x, z: M.hallMid.z } });
  }
  _manager(dt, input) {
    const M = this.layout.marks, s = this.of.state, man = this.people.manager;
    if (!man) { this.go('keys'); return; }
    this.target = { x: man.x, z: man.z, y: this.layout.floor };
    const d = Math.hypot(man.x - s.x, man.z - s.z);
    if (d < 1.7) {
      this.prompt = 'press <span class="key">E</span> to grab the <b>manager</b>';
      if (input.consume('event')) {
        this.prompt = null;
        this.say('you', 'Up. Keys. Strongroom. Now.');
        this.say('manager', 'Please, please... there are two keys! The cashier has the other one!');
        this.say('leena', 'Cashier! You heard him. Up!');
        this.people.walk(man, M.vaultKey, 'key');
        setTimeout(() => this.people && this.people.walk(this.people.cashier, M.vaultKey2, 'key'), 3200);
        this.go('keys');
      }
    } else this.prompt = null;
  }

  // --- two keys, the door swings
  _keysStart() { this.obj('Take them to the <b>strongroom</b>.'); this.target = null; this.keyT = 0; }
  _keys(dt) {
    const P = this.people, M = this.layout.marks;
    this.target = { x: M.vaultFront.x, z: M.vaultFront.z, y: this.layout.floor };
    const both = P.manager?.state === 'key' && (!P.cashier || P.cashier.state === 'key');
    if (both || this.t > 18) this.keyT += dt;
    if (this.keyT > 0 && !this.turned) {
      if (this.keyT > 1.6) { this.turned = true; this.g.audio?.playEvent('doorOpen', { position: { x: M.vaultFront.x, y: this.layout.floor + 1, z: M.vaultFront.z } }); }
    }
    if (this.turned) {
      this.open = Math.min(1, (this.open || 0) + dt / 2.6);
      setVault(this.layout, this.open);
      if (this.open >= 1) {
        // the two step back and get down
        for (const p of [P.manager, P.cashier]) if (p) { p.x += Math.sin(p.yaw + Math.PI) * 0.6; p.z += Math.cos(p.yaw + Math.PI) * 0.6; P._set(p, 'cower'); }
        this.say('leena', 'Bags. Fill them. Ninety seconds.');
        this.go('loot');
      }
    }
  }

  // --- the racks
  _lootStart() {
    const g = this.g;
    this.obj('Fill the <b>bag</b> at the cash racks (hold <span class="key">E</span>).');
    this.racks = this.layout.marks.racks.map((r) => ({ ...r, k: 0 }));
    this.bag = makeBag(0x1a2a1a); g.scene.add(this.bag); this.bag.traverse((q) => q.layers.enable(INDOOR));
    this.leena.goTo(this.layout.marks.vaultFront.x, this.layout.marks.vaultFront.z, { face: { x: this.layout.marks.staffMid.x, z: this.layout.marks.staffMid.z } });
  }
  _loot(dt, input) {
    const s = this.of.state, R = this.racks.filter((r) => r.k < 1);
    if (!R.length) { this.say('leena', 'Enough! Out, out, out!'); this.go('exit'); return; }
    let near = null, bd = 1.5;
    for (const r of R) { const d = Math.hypot(r.x - s.x, r.z - s.z); if (d < bd) { bd = d; near = r; } }
    this.target = near ? null : { x: R[0].x, z: R[0].z, y: this.layout.floor };
    if (near) {
      const hold = !!input.controls.use;
      this.prompt = hold ? null : 'hold <span class="key">E</span> to fill the bag';
      if (hold) {
        near.k = Math.min(1, near.k + dt / LOOT_PER_RACK);
        this.cash += dt / LOOT_PER_RACK * 16.2;
        if (!this.of.human?.busy) this.of.human?.play('pickUp', { rate: 0.8, fade: 0.15 });
        s.yaw = Math.atan2(near.x + Math.sin(near.yaw) * 0.75 - s.x, near.z + Math.cos(near.yaw) * 0.75 - s.z) || s.yaw;
      }
      this.meter(`FILLING THE BAG  ·  ₹${this.cash.toFixed(1)} LAKH`, near.k, false);
      // the silent alarm, once the first rack is half empty
      if (!this.alarmOn && near.k > 0.5) this._raiseAlarm();
    } else { this.prompt = null; this.meter(this.alarmOn ? null : `₹${this.cash.toFixed(1)} LAKH`, this.racks.filter((r) => r.k >= 1).length / this.racks.length, false); }
  }

  _raiseAlarm() {
    this.alarmOn = true; this.alarmT = ALARM_TIME; this.bellT = 0;
    this.say('sajan', 'Leena! Somebody pressed the alarm!');
    this.say('leena', 'Two minutes, maybe less. Finish it!');
  }
  // the bell ringing on (inside: loud; outside: from the bank), the clock to the police at the door
  _alarm(dt) {
    if (!this.alarmOn) return;
    const g = this.g, site = this.site;
    this.bellT -= dt;
    if (this.bellT <= 0 && this.phase !== 'drive' && this.phase !== 'outro') {
      this.bellT = 1.15;
      g.audio?.playEvent('alarmBell', { dur: 1.2, position: { x: site.front.x, y: site.floor + 2.6, z: site.front.z }, volume: g.interiors.active ? 0.7 : 0.9 });
    }
    if (this.phase === 'loot' || this.phase === 'exit') {
      this.alarmT -= dt;
      const t = Math.max(0, this.alarmT), mm = Math.floor(t / 60), ss = Math.floor(t % 60);
      if (this.phase === 'exit' || !this.prompt || this.alarmT < 30) this.meter(`POLICE ARRIVE  ${mm}:${String(ss).padStart(2, '0')}`, t / ALARM_TIME, t < 30);
      if (this.alarmT <= 0) this.story.fail('The police surrounded the bank.');
    }
  }

  // --- out of the bank
  _exitStart() {
    this.prompt = null;
    this.obj('Get <b>out</b> of the bank.');
    for (const c of this.crew) c.follow();
    this.leena.aimAt = null; this.sajan.aimAt = null;
  }
  _exit() {
    const A = this.g.interiors.active;
    if (A?.type === 'bank') { const ex = A.exit; const p = [A.c.cx + ex[0] * A.c.cos + ex[1] * A.c.sin, A.c.cz - ex[0] * A.c.sin + ex[1] * A.c.cos]; this.target = { x: p[0], z: p[1], y: A.floor }; return; }
    // outside: the crew come out behind you
    const s = this.of.state;
    for (const [c, k] of [[this.leena, 0.9], [this.sajan, -0.9]]) { c.setIndoor(INDOOR, false); c._out(); c.place(s.x + Math.cos(s.yaw) * k - Math.sin(s.yaw) * 0.6, s.z - Math.sin(s.yaw) * k - Math.cos(s.yaw) * 0.6, s.yaw); }
    this.go('escape');
  }

  // --- the police coming; Sajan splits, Leena into the car with you
  _escapeStart() {
    const g = this.g, site = this.site;
    g.police.bustHold = true;
    g.police.startPursuit(3, 'bank robbery');
    g.audio?.playEvent('sirenBurst', { dur: 4, position: { x: site.road.x + 60, y: 1, z: site.road.z } });
    this.say('sajan', 'Police jeep! Split up! I\'ll go through the market!');
    this.say('leena', 'Car! Go, go!');
    this.obj('Get in the <b>car</b>.');
    // Sajan runs off, away from the car, and is gone round the first corner
    const ax = this.car.state.x - site.front.x, az = this.car.state.z - site.front.z, al = Math.hypot(ax, az) || 1;
    this.sajan.setGun(false);
    this.sajan.goTo(site.front.x - ax / al * 70, site.front.z - az / al * 70, { run: true });
    this.leena.setGun(false);
    if (this.pp) this.leena.board(this.car, this.pp); else this.leena.follow();
  }
  _escape() {
    const g = this.g, car = this.car;
    // Sajan: gone once out of sight (or far)
    if (this.sajan.mode !== 'hidden') { const d = Math.hypot(this.sajan.state.x - this.of.state.x, this.sajan.state.z - this.of.state.z); if (d > 45 || (this.sajan.mode === 'stand' && this.t > 3)) this.sajan.hide(); }
    // Leena boards; if she lost her way, straight into her seat once the player is in
    if (this.leena.mode === 'stand' && !this.leena.seated && this.pp) { if (!this.of.active) this.leena.seatIn(car, this.pp); else this.leena.board(car, this.pp); }
    this.target = this.of.active ? { x: car.state.x, z: car.state.z, y: car.state.y } : null;
    if (!this.of.active && g.player === car && this.of.inter.seated === car) {
      // hold the car until she's in (the doors, as in GTA)
      if (!this.leena.seated) { car.controls.throttle = 0; car.controls.handbrake = 1; this.obj('Wait for <b>Leena</b>.'); return; }
      this.go('chase');
    } else if (!this.of.active && g.player !== car) {
      // drove off in something else: Leena comes along anyway (she gets in beside you)
      this.car = g.player; const PP = passengerProfile(this.car); this.pp = PP;
      if (PP) this.leena.seatIn(this.car, PP);
      this.go('chase');
    }
  }

  // --- lose them
  _chaseStart() {
    const g = this.g;
    g.police.bustHold = false;
    this.obj('Lose the <b>police</b>.');
    this.target = null;
    this.lines = [[2, 'leena', 'Drive! Drive!'], [16, 'leena', "They're right behind us!"], [34, 'leena', "The small roads! The jeeps can't turn in there!"], [60, 'leena', 'Left! Go left!']];
    this.offCool = bus.on?.('police:cooldown', () => this.say('leena', "I think we lost them... Keep going, don't stop."));
  }
  _chase() {
    const g = this.g;
    for (const L of this.lines) if (!L.done && this.t > L[0]) { L.done = true; this.say(L[1], L[2]); this.lookT = this.t + 1.6; }
    this._leenaWatch();
    if (g.police.state === 'idle' && this.t > 3) {
      this.leena.look = null;
      this.say('leena', 'Okay. Okay. We lost them.');
      this.say('leena', "Babu's workshop, Thavakkara. He'll make this car disappear.");
      this.go('drive');
    }
    if (g.player !== this.car && !this.of.active) this.car = g.player;
  }

  // Leena in the passenger seat through the chase: at you while she talks, else turning to the nearest police car
  // behind (looking back over her shoulder, as far as a neck turns), else the road
  _leenaWatch() {
    const L = this.leena;
    if (!L || L.mode !== 'car') return;
    if (this.lookT && this.t < this.lookT) { L.look = this.headOf('you'); return; }
    const s = this.car?.state, units = this.g.police.units || [];
    let best = null, bd = 70;
    if (s) for (const u of units) { const v = u.vehicle?.state; if (!v) continue; const d = Math.hypot(v.x - s.x, v.z - s.z); if (d < bd) { bd = d; best = v; } }
    if (best && (this.t % 7) < 3.2) { L.look = (out) => out.set(best.x, (best.y || 0) + 1.2, best.z); return; }
    L.look = null;
  }

  // --- to Babu's
  _driveStart() {
    const gv = this.story._giver('babu');
    this.babu = gv;
    this.obj("Drive to <b>Babu's workshop</b> in Thavakkara.");
    this.target = { x: gv.lane.x, z: gv.lane.z, gps: true };
    this.g.setGPS(gv.lane.x, gv.lane.z);
  }
  _drive() {
    const g = this.g, gv = this.babu.provisional ? (this.babu = this.story._giver('babu')) : this.babu;
    const f = g.focusState, d = Math.hypot(f.x - gv.lane.x, f.z - gv.lane.z), sp = Math.hypot(f.vx || 0, f.vz || 0);
    this.target = { x: gv.lane.x, z: gv.lane.z, gps: true };
    if (d < 25 && sp > 3) this.meter('STOP HERE', 1 - d / 25, false);
    if (d < 11 && sp < 2.5) { this.meter(null); this.go('outro'); return; }
    if (g.police.state !== 'idle') this.obj("Lose the <b>police</b> first: you can't lead them to Babu.");
    else this.obj("Drive to <b>Babu's workshop</b> in Thavakkara.");
    if (g.police.state !== 'idle' && d < 30) this.target = null;
  }

  // --- at Babu's: the outro
  _outroStart() {
    const g = this.g, gv = this.babu.provisional ? this.story._giver('babu') : this.babu, car = g.player;
    this.babu = gv; this.giverOn = 'babu';
    this.target = null; this.meter(null); this.obj(null); this.alarmOn = false;
    g.gps = null;
    const by = gv.y, bx = gv.x, bz = gv.z, B = new THREE.Vector3(bx, by, bz);
    const babuHead = (dy = 0) => (k, out) => { const H = gv.human?.B?.Head; if (H) { H.getWorldPosition(out); out.y += dy; } else out.set(bx, by + 1.62 + dy, bz); return out; };
    const babuGaze = (out) => babuHead(0.05)(0, out);
    const C = {};   // the staging and the cameras, worked out at the first cut
    // (staged at a cut: you and Leena out of the car and standing before Babu, side by side, clear of the car)
    const stage = () => {
      // the pair 1.8 m from Babu: toward the car if there's room there, else round him until both spots are clear
      const a0 = Math.atan2(car.state.x - bx, car.state.z - bz);
      let d = null, e = null;
      for (const da of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.6, -2.6, Math.PI]) {
        const a = a0 + da, dx = Math.sin(a), dz = Math.cos(a), ex = dz, ez = -dx;
        const spots = [0.6, -0.6].map((o) => new THREE.Vector3(bx + dx * 1.8 + ex * o, by + 1.0, bz + dz * 1.8 + ez * o));
        if (spots.every((q) => !this.inCar(q, 0.55) && this.g.onFoot._free(q.x, q.z) && this.clearView(new THREE.Vector3(bx, by + 1, bz), q))) { d = { x: dx, z: dz }; e = { x: ex, z: ez }; break; }
      }
      if (!d) { const dx = Math.sin(a0), dz = Math.cos(a0); d = { x: dx, z: dz }; e = { x: dz, z: -dx }; }
      const px = bx + d.x * 1.8 + e.x * 0.6, pz = bz + d.z * 1.8 + e.z * 0.6, lx = bx + d.x * 1.8 - e.x * 0.6, lz = bz + d.z * 1.8 - e.z * 0.6;
      this.of.inter.release(); this.of.inter._detach(); this.of.inter.gaze = null;
      this.of.bail(px, pz, Math.atan2(bx - px, bz - pz)); this.of.human?.clearAction(0);
      if (this.playerMask) { this.playerMask.removeFromParent(); this.playerMask = null; }
      if (this.bag) this.bag.visible = false;
      this.leena._out(); this.leena.setMask(null); this.leena.setGun(false); this.leena.place(lx, lz, Math.atan2(bx - lx, bz - lz)); this.leena.stand({ x: bx, z: bz });
      this.leena.look = babuGaze;
      gv.body.group.rotation.y = Math.atan2(d.x, d.z);
      for (const dd of [1, -1]) car.renderer?.setDoor?.(dd, false);
      car.controls.throttle = 0; car.controls.handbrake = 1;
      if (!this.of.parked.includes(car)) this.of.parked.push(car);
      // the cameras (each the first of its candidates with a clear view: no wall, building or the car in the way)
      const at = (a, b, y) => new THREE.Vector3(bx + d.x * a + e.x * b, by + y, bz + d.z * a + e.z * b);   // a: from Babu toward the pair, b: across (+: your side)
      const Lh = new THREE.Vector3(lx, by + 1.6, lz), Ph = new THREE.Vector3(px, by + 1.6, pz), Bh = new THREE.Vector3(bx, by + 1.6, bz), Q = at(1.8, 0, 1.45);
      C.onLeena = this.pickCam([at(-0.85, -0.38, 1.7), at(-0.4, -1.5, 1.66), at(0.7, -2.4, 1.65)], Lh);
      C.onBabu = this.pickCam([at(2.65, -0.95, 1.7), at(1.9, -1.9, 1.66), at(1.2, 2.2, 1.66)], Bh);
      C.pair = this.pickCam([at(-0.3, 1.25, 1.6), at(-0.3, -1.25, 1.6), at(-1.2, 0.9, 1.75)], Q);
      C.onYou = this.pickCam([at(2.0, 1.45, 1.72), at(2.3, 0.2, 1.75), at(1.0, 2.2, 1.7)], Lh);
      C.wide = this.pickCam([at(5.2, 3.2, 2.6), at(5.2, -3.2, 2.6), at(1.0, 5.5, 2.6), at(1.0, -5.5, 2.6)], at(0.9, 0, 1.3));
      C.Q = Q;
    };
    // the first shot, before the cut: the car pulled up, Babu at his door (a wide on both, from wherever is clear)
    const cs = car.state, mx = (bx + cs.x) / 2, mz = (bz + cs.z) / 2, ul = Math.hypot(cs.x - bx, cs.z - bz) || 1, ux = (cs.x - bx) / ul, uz = (cs.z - bz) / ul;
    const M0 = new THREE.Vector3(mx, by + 1.1, mz);
    const first = this.pickCam([new THREE.Vector3(mx - uz * 6.5 - ux * 1.5, by + 2.3, mz + ux * 6.5 - uz * 1.5), new THREE.Vector3(mx + uz * 6.5 - ux * 1.5, by + 2.3, mz - ux * 6.5 - uz * 1.5), new THREE.Vector3(bx - ux * 3.5, by + 2.4, bz - uz * 3.5), new THREE.Vector3(mx, by + 7, mz)], M0);
    const still = (key, look) => ({ pos: (k, o) => o.copy(C[key]), look, fov: 44 });
    const shots = [
      { dur: 4.6, cam: { pos: (k, o) => o.copy(first).add(_w.set(0, -0.3 * k, 0)), look: (k, o) => o.copy(M0), fov: 52 },
        lines: [[0.4, 'babu', 'Police sirens all the way from Fort Road, and you bring them to my workshop?']] },
      { dur: 4.4, enter: stage, cam: still('onLeena', this.head(this.leena, 0.04)),
        lines: [[0.2, 'leena', 'Nobody followed us, Babu. Make the Scorpio disappear.']] },
      { dur: 4.2, cam: still('onBabu', babuHead(0.04)),
        lines: [[0.2, 'babu', 'By evening it will be another colour, another number. Another car.']] },
      { dur: 5, cam: { pos: (k, o) => o.copy(C.pair), look: (k, o) => o.copy(C.Q), fov: 46 },
        on: [[3.0, () => { this.leena.look = this.headOf('you'); }]],
        lines: [[0.2, 'leena', "Thirty-two lakhs. Sajan called: he's in Thalassery. His share goes to him."], [3.1, 'you', 'And mine?']] },
      { dur: 5.4, cam: still('onYou', this.head(this.leena, 0.04)),
        enter: () => { this.leena.face = { x: this.of.state.x, z: this.of.state.z }; this.leena.look = this.headOf('you'); },
        on: [[3.3, () => { this.leena.look = babuGaze; }]],
        lines: [[0.2, 'leena', 'Yours keeps. Lie low for a while. Babu has honest work for you.'], [3.4, 'leena', '...Mostly honest.']] },
      { dur: 4.8, cam: { pos: (k, o) => o.copy(C.wide).add(_w.set(0, 1.2 * k, 0)), look: (k, o) => o.copy(C.Q).lerp(B, 0.5).setY(by + 1.2), fov: 46 },
        lines: [[0.2, 'babu', 'Come tomorrow. There is a white Dzire that needs finding.']], on: [[2.2, () => titleCard(this.story, 'PROLOGUE COMPLETE', 'The Kayal Job', 4)]] },
    ];
    this.cinema.play(shots, () => this._finish());
  }

  // whether world point p is in (or within `margin` of) the getaway car's box
  inCar(p, margin = 0.2) {
    const car = this.car;
    if (!car?.renderer?.body) return false;
    const P = interactionProfile(car), b = car.renderer.body; b.updateMatrixWorld(true);
    const l = b.worldToLocal(_v.copy(p));
    return l.x > P.box.min.x - margin && l.x < P.box.max.x + margin && l.z > P.box.min.z - margin && l.z < P.box.max.z + margin && l.y < P.box.max.y + margin;
  }
  // a clear line from p to q: no building, compound wall or the car across it
  clearView(p, q) {
    const list = this.g.world.collision.query(Math.min(p.x, q.x) - 1, Math.min(p.z, q.z) - 1, Math.max(p.x, q.x) + 1, Math.max(p.z, q.z) + 1, []).filter((b) => b.bld || b.kind === 'barrier');
    for (let t = 0; t <= 0.94; t += 0.04) {
      _w.lerpVectors(p, q, t);
      for (const b of list) {
        if (b.kind === 'barrier' && _w.y > (b.h ?? 99) + 0.1) continue;   // (over a wall)
        const lx = (_w.x - b.cx) * b.cos - (_w.z - b.cz) * b.sin, lz = (_w.x - b.cx) * b.sin + (_w.z - b.cz) * b.cos;
        if (Math.abs(lx) < b.hx + 0.2 && Math.abs(lz) < b.hz + 0.2) return false;
      }
      if (this.inCar(_w, 0.12)) return false;
    }
    return true;
  }
  // the first camera spot of `cands` with a clear view of `look` (else the first)
  pickCam(cands, look) { return (cands.find((c) => this.clearView(c, look)) || cands[0]).clone(); }

  // the end: Leena goes, Babu keeps the Scorpio, your own car round the side of the workshop
  _finish() {
    const g = this.g, gv = this.babu;
    this._dispose(true);
    const spot = gv?.lane || { x: this.of.state.x, z: this.of.state.z, yaw: this.of.state.yaw };
    g.spawnPlayer({ x: spot.x, z: spot.z, yaw: spot.yaw });
    g.camCtl.snap(g.player);
    g.applyTime?.();
    this.story.pass();
  }

  // ------------------------------------------------------------------ the HUD prompt (after the frame's own)
  late() { if (this.prompt) this.g.hud.setPrompt(this.prompt); }
  vehicles() { return []; }

  // everything this mission put in the world, away (keepCar: the car the player sits in stays)
  _dispose(passed = false) {
    const g = this.g;
    if (this.disposed) return;
    this.disposed = true;
    if (this.cinema.active) { this.cinema.onDone = null; this.cinema.skip(); }
    for (const c of this.crew || []) c.dispose();
    this.crew = [];
    this.people?.dispose(); this.people = null;
    this.front?.dispose(); this.front = null;
    this.bag?.removeFromParent(); this.bag = null;
    if (this.playerMask) { this.playerMask.removeFromParent(); this.playerMask = null; }
    if (this.site && g.interiors.custom) g.interiors.custom.delete(this.site.c);
    if (g.interiors.active?.type === 'bank') { if (g.onFoot.active) g.interiors.leave(); else g.interiors.dispose(); }
    g.police.bustHold = false;
    this.offCool?.();
    this.story._meter(null); this.prompt = null; this.target = null; this.story.dest.visible = false;
    // the getaway car: Babu's now (gone) unless the player still sits in it
    const car = this.car;
    if (car && car.alive !== false && (passed || g.player !== car)) {
      const i = g.onFoot.parked.indexOf(car); if (i >= 0) g.onFoot.parked.splice(i, 1);
      if (g.player === car) { g.onFoot.inter.release(); g.onFoot.inter._detach(); }
      if (g.player !== car) car.dispose();
    }
    void passed; void refindBank; void _v; void _w; void CAST;
  }
}
