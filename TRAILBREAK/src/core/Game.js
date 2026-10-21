// The game loop: input -> physics (fixed 480 Hz substeps) -> models, camera, effects, sound -> network -> HUD -> frame.
import * as THREE from 'three';
import { Vehicle, simulate } from '../physics/Vehicle.js';
import { truckSpec, TRUCKS } from '../physics/trucks.js';
import { money, TRUCK_PRICES } from '../game/Career.js';
import { buildSummary } from '../physics/Upgrades.js';
import { SURFACES } from '../physics/Surfaces.js';
import { TruckModel } from '../render/TruckModel.js';
import { showroomFor } from '../ui/Showroom.js';
import { loadTruckAsset, truckAsset, truckAssetProgress, MODEL_BODIES } from '../render/TruckAssets.js';
import { CameraRig } from './CameraRig.js';
import { BEACON_RADIUS, MAP_HALF } from '../world/maps/index.js';
import { EventPlay } from '../game/EventPlay.js';
import { EventCourse } from '../render/EventCourse.js';
import { BreakView } from '../render/BreakView.js';
import { KIND } from '../render/Effects.js';
import { RouteGraph, along } from '../game/Route.js';
import { RouteLine } from '../render/RouteLine.js';
import { WorldMap, keyOf } from '../ui/WorldMap.js';
import { Chat, bubbleCanvas } from '../ui/Chat.js';
import { ModeView } from '../render/ModeView.js';
import { windowGlow } from '../render/KeralaBuildings.js';
import { Builder } from '../ui/Builder.js';
import { encodeLayout, decodeLayout } from '../game/Props.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const MATE_COLORS = ['#4fb3a9', '#e0b33b', '#c46bd6', '#6aa8e8', '#e0563b', '#7cc36a', '#e88fb0', '#c9c06a'];

/** A truck's model; if its parts can't be drawn (a fault in a model's layout), the stock truck rather than none. */
function modelFor(spec, truckId, paint, opts = {}) {
  try { return new TruckModel(spec, paint, opts); } catch (e) {
    console.error(`truck model ${truckId} ${spec.buildCode}:`, e);
    return new TruckModel(truckSpec(truckId), paint, opts);
  }
}

function nameTag(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(250, x.measureText(text).width + 30);
  x.fillStyle = 'rgba(20,25,22,0.75)';
  x.beginPath(); x.roundRect(128 - w / 2, 8, w, 48, 22); x.fill();
  x.fillStyle = color; x.fillRect(128 - w / 2 + 14, 28, 8, 8);
  x.fillStyle = '#f3ead7'; x.fillText(text, 136, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  s.scale.set(3.2, 0.8, 1);
  return s;
}

const BOUNTY = 600, BOUNTY_SHARE = 150, RESCUE_FEE = 300, TOW_FEE = 250;
/** Where the beacons found driving alone on a map are kept (Ashwood keeps its original key). */
export const soloBeaconsKey = (M) => (M.id === 'ashwood' ? 'trailbreak.solo.beacons' : `trailbreak.solo.beacons.${M.id}`);

export class Game {
  constructor(o) {
    Object.assign(this, o);          // world, renderer, terrain, vegetation, grass, tea, rocks, water, landmarks, effects, rope, audio, net, hud, input, settings, garage, career, build
    this.scene = this.renderer.scene;
    this.spec = truckSpec(this.truckId, this.build);
    this.build = this.spec.buildCode;
    this.vehicle = new Vehicle(this.spec);
    this.vehicle.damage.setLevel(this.settings.damage);
    this.model = modelFor(this.spec, this.truckId, this.paint, { mirrors: true });
    this.scene.add(this.model.root);
    this.renderer.subject = this.model;
    this.garageSpot = this.world.landmarks.find((L) => L.type === 'garage');
    this.stationSpot = this.world.landmarks.find((L) => L.type === 'station');
    this.cam = new CameraRig(this.renderer.camera, this.world);
    if (this.career) {
      this.career.onChange = (amount, why) => this.hud.money(this.career.money, amount, why);
      this.hud.money(this.career.money);
    }
    this.remotes = new Map();
    this.sphereCache = new Map();
    this.carry = 0;
    this.found = this.hud.found;
    this.dirt = 0;
    this.lightsOn = false;
    this.safe = null; this.safeT = 0;
    this.paused = false;
    this.mapOpen = false;
    this.chatOpen = false;
    this.hudT = 0; this.miniT = 0;
    this.color = this.paint;
    this.tmpTrees = [];
    this.stamps = new Map();
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._v2 = new THREE.Vector3();
    this.attachLights();
    this.rope.mat.color.set(this.spec.winch.synthetic ? 0xd0571e : 0x2b2b28);
    // getting unstuck: the last places the truck drove on firm, dry ground; the stuck panel; calling friends
    this.drySpots = [];
    this.dryT = 0; this.stuckT = 0; this.boggedT = 0; this.helpOn = false; this.helpMoveT = 0; this.towHintT = 0;
    this.stuckEl = document.getElementById('stuck');
    if (this.stuckEl) {
      const btn = (id, fn) => { document.getElementById(id).onclick = (e) => { e.currentTarget.blur(); fn(); this.renderer.renderer.domElement.focus(); }; };
      btn('st-flip', () => this.recover('flip'));
      btn('st-dry', () => this.recover('dry'));
      btn('st-call', () => this.callHelp());
      btn('st-station', () => this.towHome());
    }
    this.spawn(true);
    this.applySettings();
    // events: the start lines, runs and races (game/EventPlay.js), their banners and gates on the ground
    this.events = new EventPlay(this);
    this.course = new EventCourse(this.scene, this.world, this.events.events);
    this.modeView = new ModeView(this.scene, this.world);
    // what breaks: the roadside things standing, and the trees and things knocked down (render/BreakView.js)
    // (the open world's: each map's own, render/WorldView.js)
    this.breakView ||= new BreakView(this.scene, this.world, this.vegetation, this.effects, this.audio);
    // the map builder (ui/Builder.js): this map's own layout of props, on the ground at once
    this.building = false;
    this.builder = new Builder(this);
    // the satnav and the full map (ui/WorldMap.js): a route by road and trail, and its line on the ground ahead
    // (the trails that run into a town's yard are joined across it)
    const st = this.world.map.station;
    this.satnav = new RouteGraph(this.world.data.trails, { hubs: this.world.hubs || (st ? [{ x: st.x, z: st.z, r: 90 }] : []) });
    this.routeLine = new RouteLine(this.scene);
    this.route = null;
    this.worldMap = new WorldMap(this.world, this.hud.mapImage, {
      state: () => this.mapState(),
      route: (item) => this.setRoute(item),
      clear: () => this.clearRoute(),
      travel: (item) => this.fastTravel(item),
      close: () => { if (this.mapOpen) this.toggleMap(); },
    });
    // room chat (ui/Chat.js)
    this.chat = new Chat(this.hud, {
      send: (text) => this.net?.send({ t: 'chat', text }),
      onOpen: (open) => {
        this.chatOpen = open;
        this.input.enabled = !this.paused && !open && !this.mapOpen;
        if (!open) this.renderer.renderer.domElement.focus();
      },
    });
    this.chat.setAvailable(!!this.net?.connected);
    const mini = document.getElementById('minimap');
    if (mini) mini.onclick = () => { if (!this.mapOpen && !this.paused) this.toggleMap(); };
    // (the open world's maps in it already: those that come in later, regionIn)
    this.knownRegions = new Set((this.world.regions || []).map((r) => r.id));
    for (const r of this.world.regions || []) this.hud.drawRegion(r);
  }

  /**
   * The open world (world/OpenWorld.js): a map has come in and is drawn (render/WorldView.js). Its events, its roads
   * for the satnav, its part of the maps.
   */
  regionIn(region) {
    if (this.knownRegions.has(region.id)) return;
    this.knownRegions.add(region.id);
    const ev = this.world.eventsOf(region);
    this.events.add(ev);
    this.course.addStarts(ev);
    this.satnav = new RouteGraph(this.world.data.trails, { hubs: this.world.hubs });
    if (this.route) this.replan();
    this.hud.drawRegion?.(region);
    this.worldMap.refresh();
  }

  // ---------------------------------------------------------------- the map and the satnav
  /** The party mode in play, for the maps: the zone (and where it is going) or the hill. */
  modeMarks() {
    const run = this.events.run;
    if (!run || run.phase === 'finished') return null;
    if (run.event.kind === 'zone') return { zone: run.zone };
    if (run.event.kind === 'hill') return { hill: run.event.hill };
    return null;
  }

  /** What the full map shows. */
  mapState() {
    const v = this.vehicle;
    return {
      me: { x: v.pos.x, z: v.pos.z, heading: Math.atan2(v.fwd.x, -v.fwd.z) },
      mates: [...this.remotes.values()].filter((r) => r.state).map((r) => ({ kind: 'friend', id: r.id, name: r.name, color: r.color, help: !!r.help, x: r.model.root.position.x, z: r.model.root.position.z })),
      events: this.events.events.map((e) => ({ kind: 'event', event: e, name: e.name, x: e.start.x, z: e.start.z, best: this.career?.best(e.id)?.time })),
      beacons: this.world.beacons.map((b) => ({ kind: 'beacon', id: b.id, name: b.name, x: b.x, z: b.z, found: this.found.has(b.id) })),
      route: this.route,
      racing: this.events.racing,
      mode: this.modeMarks(),
    };
  }

  /** Set the satnav's waypoint to a thing on the map (a friend: their truck, wherever it goes). */
  setRoute(item, quiet = false) {
    this.route = { target: { kind: item.kind, key: keyOf(item), name: item.name, x: item.x, z: item.z, friend: item.kind === 'friend' ? item.id : null }, points: null, left: 0, hint: 0, t: 0 };
    this.replan();
    if (!quiet) this.hud.toast(`Route set: ${item.name}, ${fmtDist(this.route.left)}`, false, 3);
  }

  replan() {
    const R = this.route, p = this.vehicle.pos;
    const r = this.satnav.route(p.x, p.z, R.target.x, R.target.z);
    R.points = r.points; R.left = r.length; R.hint = 0; R.t = 0; R.stale = false;
  }

  clearRoute() { this.route = null; }

  /** Follow the route: how far is left, arriving, and plotting it again when we leave it. */
  updateRoute(dt) {
    const R = this.route;
    if (!R) return;
    const p = this.vehicle.pos;
    if (R.target.friend != null) {
      const rv = this.remotes.get(R.target.friend);
      if (!rv?.state) { this.hud.toast(`${R.target.name} has left: route cleared`); this.route = null; return; }
      const q = rv.model.root.position;
      if (Math.hypot(q.x - R.target.x, q.z - R.target.z) > 25) { R.target.x = q.x; R.target.z = q.z; R.stale = true; }
    }
    const a = along(R.points, p.x, p.z, R.hint);
    R.hint = a.seg; R.left = a.left + a.off;
    R.t += dt;
    if (Math.hypot(R.target.x - p.x, R.target.z - p.z) < (R.target.friend != null ? 12 : 18)) {
      this.hud.toast(`Arrived: ${R.target.name}`, false, 3);
      this.route = null;
      return;
    }
    // off the route (or the friend moved on): plot it again, not too often
    if ((a.off > 28 || R.stale) && R.t > 2) this.replan();
  }

  /** Fast travel to a thing on the map; null when done, else why not. */
  fastTravel(item) {
    if (this.events.racing) return 'No fast travel in the middle of a run';
    const v = this.vehicle;
    if (item.kind === 'event') { this.toggleMap(); this.events.goTo(item.event.id); this.arrivedAt(item); return null; }
    if (item.kind === 'place' && item.type === 'station') { this.toggleMap(); this.spawn(); this.arrivedAt(item); return null; }
    let spot;
    if (item.kind === 'place' && item.type === 'garage') {
      this.toggleMap(); this.placeAtGarage();
    } else {
      spot = this.spotNear(item.x, item.z, item.kind === 'friend' ? 7 : 9);
      if (!spot) return 'Nowhere clear to stop there';
      this.toggleMap();
      if (item.kind === 'friend') { const rv = this.remotes.get(item.id); if (rv) { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(rv.model.root.quaternion); spot.yaw = Math.atan2(f.x, f.z); } }
      v.place(this.world, spot.x, spot.z, spot.yaw);
    }
    if (v.winch.attached) v.detachWinch();
    if (this.helpOn) this.setHelp(false);
    this.carry = 0; this.stuckT = 0; this.boggedT = 0;
    if (this.net) this.net.warp++;
    this.cam.heading = null;
    this.hud.toast(`Fast travel: ${item.name}`, false, 3);
    this.arrivedAt(item);
    return null;
  }

  /** (the route to where we just fast-travelled to is done with) */
  arrivedAt(item) { if (this.route && this.route.target.key === keyOf(item)) this.route = null; }

  /** A clear, dry, level spot to put the truck down near (x, z), facing it; or null. */
  spotNear(x, z, r0 = 8) {
    const W = this.world;
    for (let r = r0; r < 90; r += 4) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r * 0.37, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!W.inBounds(px, pz, 20)) continue;
        if (W.water(px, pz) > W.height(px, pz) - 0.1) continue;
        const sl = Math.max(Math.abs(W.height(px + 2, pz) - W.height(px - 2, pz)), Math.abs(W.height(px, pz + 2) - W.height(px, pz - 2))) / 4;
        if (sl > 0.22) continue;
        if (W.boulderTop(px, pz) > W.terrain(px, pz) - 0.02) continue;
        if (W.treesNear(px, pz, 3.2, this.tmpTrees).length) continue;
        return { x: px, z: pz, yaw: Math.atan2(x - px, z - pz) };
      }
    }
    return null;
  }

  /** Modes & races (N, or the pause menu): a card for each mode, race and event, with a way to its start line. */
  openEvents() {
    const el = document.getElementById('events'), list = document.getElementById('ev-list');
    if (this.paused) this.togglePause(false);
    this.input.enabled = false;
    this.audio.setMuted('menu', true);
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const close = () => {
      el.classList.add('hidden'); window.removeEventListener('keydown', onKey, true);
      this.audio.setMuted('menu', false); this.input.enabled = !this.paused && !this.chatOpen; this.renderer.renderer.domElement.focus();
    };
    list.innerHTML = this.events.listHtml(this.builderPicture());
    list.onclick = (e) => {
      const go = e.target.closest('[data-go]'), start = e.target.closest('[data-start]'), free = e.target.closest('[data-free]'), build = e.target.closest('[data-build]');
      if (!go && !start && !free && !build) return;
      close();
      if (go) this.events.goTo(go.dataset.go);
      else if (start) this.events.startNow(start.dataset.start);
      else if (build) this.builder.open();
    };
    // the side: a section of the list, or the garage, or the settings (the pause menu)
    for (const b of el.querySelectorAll('.nav-i')) {
      b.onclick = () => {
        if (b.dataset.nav === 'garage') { close(); this.openGarage(); return; }
        if (b.dataset.nav === 'settings') { close(); this.togglePause(true); return; }
        for (const o of el.querySelectorAll('.nav-i')) o.classList.toggle('sel', o === b);
        list.dataset.sec = b.dataset.sec;
        list.scrollTop = 0;
      };
      b.classList.toggle('sel', b.dataset.sec === 'all');
    }
    list.dataset.sec = 'all';
    document.getElementById('ev-close').onclick = close;
    window.addEventListener('keydown', onKey, true);
    el.classList.remove('hidden');
    list.scrollTop = 0;
  }

  /** The map builder's card: this map, from above, round the station (made once). */
  builderPicture() {
    if (this.builderPic !== undefined) return this.builderPic;
    try {
      const img = this.hud.mapImage, c = document.createElement('canvas'), W = 480, H = 200;
      c.width = W; c.height = H;
      const B = this.world.mapBox, g = c.getContext('2d'), k = img.width / B.size, S = this.stationSpot || { x: 0, z: 0 }, span = 900 * k;
      g.drawImage(img, (S.x - B.x0) * k - span / 2, (S.z - B.z0) * k - span * H / W / 2, span, span * H / W, 0, 0, W, H);
      this.builderPic = c.toDataURL('image/jpeg', 0.82);
    } catch { this.builderPic = ''; }
    return this.builderPic;
  }

  /** Headlights (and the light bar's driving lamps) on the local truck's model. */
  attachLights() {
    const spec = this.spec, head = this.model.layout.heads[0], raise = spec.raise || 0;
    const y = head[1] + raise - spec.cgHeight, z = head[2] - (spec.cgZ || 0);
    this.heads = [1, -1].map((s) => {
      const l = new THREE.SpotLight(0xfff1d0, 0, 90, 0.5, 0.45, 1.4);
      l.position.set(s * head[0], y, z);
      l.target.position.set(s * 0.8, y - 0.9, z + 20);
      this.model.root.add(l, l.target);
      return l;
    });
    this.barLight = null;
    if (spec.lightBar) {
      const l = new THREE.SpotLight(0xfff6e0, 0, 160, 0.62, 0.5, 1.2);
      const ry = this.model.layout.roofY + 0.2 + raise - spec.cgHeight, rz = this.model.layout.roofZ[1] - (spec.cgZ || 0);
      l.position.set(0, ry, rz);
      l.target.position.set(0, ry - 2.5, rz + 30);
      this.model.root.add(l, l.target);
      this.barLight = l;
    }
  }

  /** Fit a build (a 14-character code): a new truck in the same place, or at the station garage. */
  applyBuild(code, toGarage = false) {
    const old = this.vehicle;
    const pose = { x: old.pos.x, z: old.pos.z, yaw: Math.atan2(old.fwd.x, old.fwd.z) };
    this.spec = truckSpec(this.truckId, code);
    this.build = this.spec.buildCode;
    const v = this.vehicle = new Vehicle(this.spec);
    v.damage.setLevel(this.settings.damage);
    // (the range and the front axle as they were, when both trucks shift them: a road car drives as it's built)
    if (v.dt.t.low > 1 && old.dt.t.low > 1) v.dt.low = old.dt.low;
    if (v.dt.drive === '4wd' && old.dt.drive === '4wd') v.dt.fourWD = old.dt.fourWD;
    this.scene.remove(this.model.root); this.model.dispose();
    this.model = modelFor(this.spec, this.truckId, this.paint, { mirrors: true });
    this.model.setDirt(this.dirt);
    this.scene.add(this.model.root);
    this.renderer.subject = this.model;
    this.attachLights();
    this.rope.mat.color.set(this.spec.winch.synthetic ? 0xd0571e : 0x2b2b28);
    if (toGarage) this.placeAtGarage(); else v.place(this.world, pose.x, pose.z, pose.yaw);
    this.carry = 0;
    if (this.net) this.net.warp++;
    this.audio.setLocalEngine(this.spec).catch(() => {});
    this.onBuild?.(this.truckId, this.build);
    this.hud.toast(`${this.spec.name}: ${buildSummary(this.spec, this.spec.build)}`, false, 5);
  }

  placeAtGarage() {
    const L = this.garageSpot;
    if (!L) { this.spawn(); return; }
    const c = Math.cos(L.yaw), s = Math.sin(L.yaw), lz = 14 + (this.net?.id ? ((this.net.id - 1) % 3) * 6 : 0);
    this.vehicle.place(this.world, L.x + lz * s, L.z + lz * c, L.yaw);
    this.cam.heading = null;
  }

  /** Close enough to the station's garage to have parts fitted there. */
  nearGarage(r = 24) {
    const L = this.garageSpot, p = this.vehicle.pos;
    return !!L && Math.hypot(p.x - L.x, p.z - L.z) < r;
  }

  async openGarage() {
    if (!this.garage || this.garage.isOpen) return;
    if (this.paused) this.togglePause(false);
    if (this.mapOpen) this.toggleMap();
    const here = this.nearGarage();
    if (here && this.repairAtGarage()) return;
    // broken down at the station: the workshop's mechanics come out and bring it in
    const S = this.stationSpot, p = this.vehicle.pos;
    if (!here && this.brokenDown && S && Math.hypot(p.x - S.x, p.z - S.z) < 200) { this.towToWorkshop(); return; }
    this.garageOpen = true;
    this.input.enabled = false;
    this.audio.setMuted('menu', true);
    const code = await this.garage.open({
      truckId: this.truckId, code: this.build, paint: this.myColor, career: this.career, nav: true,
      players: this.net?.connected ? { n: this.remotes.size + 1, max: this.net.maxPlayers || this.remotes.size + 1 } : null,
      fitLabel: here ? 'Fit these parts' : 'Fit at station',
      note: here ? '' : 'Fitting parts will take the truck back to the station garage.',
    });
    this.garageOpen = false;
    this.audio.setMuted('menu', false);
    this.input.enabled = !this.paused && !this.chatOpen;
    this.renderer.renderer.domElement.focus();
    if (code && code !== this.build) this.applyBuild(code, !here);
    // the side bar: another screen
    const go = this.garage.navTo;
    if (go === 'races') this.openEvents();
    else if (go === 'map') { if (!this.mapOpen) this.toggleMap(); }
    else if (go === 'dealer') this.openDealer();
    else if (go === 'settings') this.togglePause(true);
  }

  get myColor() { return '#' + new THREE.Color(this.paint).getHexString(); }

  /** The dealer: the showroom (ui/Showroom.js); buy a car, or swap to one you own (delivered to the station garage). */
  openDealer() {
    if (!this.career) return;
    const C = this.career;
    if (this.paused) this.togglePause(false);
    this.dealerOpen = true;
    this.input.enabled = false;
    this.audio.setMuted('menu', true);
    const S = showroomFor(document.getElementById('showroom'));
    S.open({
      title: this.dealerName || `${(this.mapName || 'Offroad').split(' ')[0]} Motors`,
      current: this.truckId, paint: this.myColor, builds: this.settings.builds || {},
      owns: (id) => C.ownsTruck(id),
      action: (id) => {
        const price = TRUCK_PRICES[id] ?? 0, name = TRUCKS[id].name;
        if (id === this.truckId) return { label: 'Driving it', enabled: false, note: `You have ${money(C.money)}.` };
        if (C.ownsTruck(id)) return { label: 'Drive this one', enabled: true, run: () => { S.close(); this.switchTruck(id); }, note: 'Yours: it waits at the station garage.' };
        if (!C.canAfford(price)) return { label: `Need ${money(price)}`, enabled: false, note: `You have ${money(C.money)}: survey beacons, win events and tow friends out to earn it.` };
        return { label: `Buy for ${money(price)}`, enabled: true, run: () => { if (C.buyTruck(id)) { this.hud.toast(`You bought the ${name}: it waits at the station garage`, false, 5); S.look(id); } }, note: `You have ${money(C.money)}.` };
      },
      onClose: () => { this.dealerOpen = false; this.audio.setMuted('menu', false); this.input.enabled = !this.paused && !this.chatOpen; this.renderer.renderer.domElement.focus(); },
    });
  }

  /** Drive another of your trucks: it is waiting at the station garage, with its last build. */
  async switchTruck(id) {
    if (!this.career?.ownsTruck(id) || id === this.truckId) return;
    this.switchingTo = id;
    if (!truckAsset(id) && MODEL_BODIES.has(id)) {
      // its model body first: megabytes, some seconds on a slow line, so say how far it has got
      const name = TRUCKS[id]?.name || 'truck';
      const say = () => { const p = truckAssetProgress(id); this.hud.hint(`Bringing the ${name} round${p != null ? `: ${Math.round(p * 100)}%` : '…'}`, 1); };
      say();
      const timer = setInterval(say, 300);
      await loadTruckAsset(id).finally(() => clearInterval(timer));
    }
    if (this.switchingTo !== id) return;               // (another was picked meanwhile)
    this.switchingTo = null;
    this.truckId = id;
    this.applyBuild(this.settings.builds?.[id] || '', true);
  }

  spawnPoint() {
    const slot = this.net?.id ? (this.net.id - 1) % 6 : 0;
    const side = (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 5.5;
    const SP = this.world.map.spawn, c = Math.cos(SP.yaw), s = Math.sin(SP.yaw);
    return { x: SP.x + c * side, z: SP.z - s * side, yaw: SP.yaw };
  }

  spawn(first = false) {
    const p = this.spawnPoint();
    this.vehicle.place(this.world, p.x, p.z, p.yaw);
    this.drySpots = [{ x: p.x, z: p.z, yaw: p.yaw }];
    this.stuckT = 0; this.boggedT = 0;
    if (this.helpOn) this.setHelp(false);
    this.vehicle.psiTarget = this.spec.tyre.psiStock || 30;      // the station's air line
    this.vehicle.setPressure(this.vehicle.psiTarget);
    this.carry = 0;
    if (this.net) this.net.warp++;
    if (!first) this.hud.toast(`Back at ${this.world.map.station.name}`);
    this.cam.heading = null;
  }

  /**
   * R: back on the wheels where it lies ('flip'), or back to the last firm, dry ground it drove on ('dry'). With no
   * mode: flip when it is over on dry land, dry ground when it is in deep water or stuck.
   */
  recover(mode) {
    const v = this.vehicle;
    const over = v.up.y < 0.5, wet = v.flooded || v.waterDepth > 0.6;
    if (!mode) mode = over && !wet ? 'flip' : wet || this.isStuck ? 'dry' : 'flip';
    if (mode === 'flip') {
      if (v.vel.length() > 4 && v.up.y > 0.3) { this.hud.hint('Slow down to recover'); return; }
      v.rightSideUp(this.world);
      this.hud.hint('Back on your wheels');
    } else {
      const spot = this.lastDry();
      if (!spot) { this.spawn(); return; }
      v.place(this.world, spot.x, spot.z, spot.yaw);
      this.cam.heading = null;
      this.hud.hint('Back on dry ground', 2.5);
    }
    if (this.net) this.net.warp++;
    this.carry = 0;
    this.stuckT = 0; this.boggedT = 0;
    if (this.helpOn) this.setHelp(false);
  }

  /** The newest firm, dry place the truck drove that is clear of where it is now. */
  lastDry() {
    const p = this.vehicle.pos;
    for (let i = this.drySpots.length - 1; i >= 0; i--) {
      const sp = this.drySpots[i];
      if (Math.hypot(sp.x - p.x, sp.z - p.z) > 12) return sp;
    }
    return this.drySpots[0] || null;
  }

  /** Remember where the truck drives on firm, dry ground (for 'back to dry ground'). */
  trackDry(dt) {
    const v = this.vehicle;
    this.dryT += dt;
    if (this.dryT < 1 || !v.settled || v.up.y < 0.92 || Math.abs(v.speed) < 1.2 || v.waterDepth > 0.02 || v.flooded) return;
    for (const w of v.wheels) if (w.water > 0.05 || (w.surf.sink > 0 && w.sink > 0.12)) return;
    this.dryT = 0;
    const last = this.drySpots[this.drySpots.length - 1];
    if (last && Math.hypot(last.x - v.pos.x, last.z - v.pos.z) < 6) return;
    this.drySpots.push({ x: v.pos.x, z: v.pos.z, yaw: Math.atan2(v.fwd.x, v.fwd.z) });
    if (this.drySpots.length > 40) this.drySpots.shift();
  }

  /** In trouble? Upside down, drowned, or wheels turning and going nowhere: show what helps. */
  checkStuck(dt, ctrl) {
    const v = this.vehicle;
    const over = v.up.y < 0.5, wet = v.flooded || v.waterDepth > 0.9;
    const D = v.damage, d = v.dt, sh = D.shafts;
    const drives = (l, r, locked) => (!sh[l] && !sh[r]) || (locked && !(sh[l] && sh[r]));
    const dead = D.seized || (!drives(2, 3, d.lockRear || d.autoLock) && !(d.fourWD && drives(0, 1, d.lockFront)));
    const pushing = (ctrl.throttle > 0.3 || ctrl.brake > 0.3) && Math.abs(v.speed) < 0.5;
    this.boggedT = pushing ? this.boggedT + dt : Math.max(0, this.boggedT - dt * 2);
    this.stuckT = over || wet || dead ? this.stuckT + dt : 0;
    this.isStuck = this.stuckT > 1.5 || this.boggedT > 7;
    this.stuckWhy = over ? 'over' : v.flooded ? 'flooded' : wet ? 'water' : dead ? 'broken' : this.boggedT > 7 ? 'bogged' : '';
    if (this.helpOn) {
      this.helpMoveT = Math.abs(v.speed) > 3 ? this.helpMoveT + dt : 0;
      if (this.helpMoveT > 3) this.setHelp(false, 'Rolling again: tow call over');
    }
  }

  /** T: ask the friends in the room for a tow (they see where you are), or stop asking. */
  callHelp() {
    if (this.helpOn) { this.setHelp(false, 'Tow call cancelled'); return; }
    const friends = [...this.remotes.values()].some((r) => r.state);
    if (!this.net?.connected || !friends) {
      this.hud.hint(this.net?.connected
        ? 'Nobody else in this room yet: send your friends the invite link (Esc). Meanwhile R gets you to dry ground, F winches to a tree'
        : 'Driving alone: R gets you back to dry ground, F winches to a tree, Backspace goes back to the station', 6);
      return;
    }
    this.setHelp(true);
  }

  setHelp(on, msg) {
    if (this.helpOn === on) return;
    this.helpOn = on; this.helpMoveT = 0;
    if (on) this.hud.toast('Tow called: your friends see where you are. They hook you with F and winch you out with E', false, 7);
    else if (msg) this.hud.hint(msg, 2.5);
  }

  /** The stuck panel: shown while in trouble or waiting for a tow. */
  updateStuckPanel() {
    const el = this.stuckEl;
    if (!el) return;
    // (not in a run: there R puts you back at the last checkpoint, and the run's panel says so)
    const show = (this.isStuck || this.helpOn) && !this.paused && !this.garageOpen && !this.mapOpen && !this.events?.racing;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const v = this.vehicle, W = v.winch, $ = (id) => document.getElementById(id);
    const titles = { over: 'Upside down', flooded: 'Engine flooded', water: 'In deep water', broken: 'Broken down', bogged: 'Stuck?' };
    const title = this.helpOn ? 'Waiting for a tow' : titles[this.stuckWhy] || 'Stuck?';
    if ($('st-title').textContent !== title) $('st-title').textContent = title;
    $('st-flip').classList.toggle('hidden', !(v.up.y < 0.5));
    $('st-dry').classList.toggle('hidden', this.stuckWhy === 'broken');             // (moving it won't mend it)
    // R does whichever suits: flip where it lies on dry land, otherwise back to dry ground
    const rFlips = v.up.y < 0.5 && !(v.flooded || v.waterDepth > 0.6);
    const flipHtml = `${rFlips ? '<b>R</b> ' : ''}Flip upright here`, dryHtml = `${rFlips ? '' : '<b>R</b> '}Back to dry ground`;
    if ($('st-flip').innerHTML !== flipHtml) $('st-flip').innerHTML = flipHtml;
    if ($('st-dry').innerHTML !== dryHtml) $('st-dry').innerHTML = dryHtml;
    const friends = [...this.remotes.values()].some((r) => r.state);
    $('st-call').classList.toggle('hidden', !(this.net?.connected && friends));
    const call = this.helpOn ? '<b>T</b> Cancel the tow call' : '<b>T</b> Call friends for a tow';
    if ($('st-call').innerHTML !== call) $('st-call').innerHTML = call;
    const D = v.damage;
    const puller = v.pulls.find((p) => !p.anchorMe);
    const tip = W.attached ? 'Hold E to winch in (and give it a little throttle)'
      : puller ? `${puller.by} is winching you out: stay off the pedals and steer, or give it a little throttle to help`
      : v.flooded ? 'Once the intake is out of the water the engine starts again'
      : this.stuckWhy === 'broken' ? (D.seized ? 'The engine is seized: it won\'t turn over. Backspace calls the tow truck, which takes it into the station workshop to be mended (you pay the bill). Or friends can tow you there (F to hook)' : 'A broken axle shaft: try 4WD (4) or the lockers (X). Backspace: the tow truck takes it to the station workshop to be mended')
        : 'Or winch out: point the bumper at a tree or a friend, F to hook, hold E';
    if ($('st-tip').textContent !== tip) $('st-tip').textContent = tip;
    const home = `<b>&#9003;</b> ${this.stuckWhy === 'broken' ? 'Tow to the workshop' : 'Back to the station'}`;
    if ($('st-station').innerHTML !== home) $('st-station').innerHTML = home;
  }

  applySettings() {
    const s = this.settings;
    this.renderer.setTime(s.hour);
    this.renderer.setShadows(s.shadows);
    this.terrain.shadows = s.shadows;
    this.vegetation.setShadows(s.shadows);
    this.tea?.setShadows(s.shadows);
    this.rocks.setShadows(s.shadows);
    this.audio.setEnabled(s.sound);
    this.applyQuality();
  }

  // ---------------------------------------------------------------- actions
  actions() {
    const I = this.input, v = this.vehicle, d = v.dt, sp = v.speed;
    // (the builder has its keys to itself: ui/Builder.js)
    if (this.building) { I.pressed.clear(); return; }
    // voice chat: V joins it, then mutes and unmutes (push-to-talk: talk while it's held), paused or not
    if (this.voicePanel) {
      const V = this.voice;
      if (V.joined && V.mode === 'ptt') { V.setPtt(!this.chatOpen && I.any('KeyV') || this.voicePanel.btnHeld); I.consume('voice'); }
      else if (I.consume('voice') && !this.chatOpen) this.voicePanel.key();
    }
    if (I.consume('pause')) { if (this.chatOpen) this.closeChat(); else if (this.mapOpen) this.toggleMap(); else this.togglePause(); }
    if (this.paused) return;
    // a controller steering as a gamepad might be a wheel the browser took for an Xbox pad: say how to make it one
    if (I.device === 'gamepad' && !this.padHinted) { this.padHinted = true; this.hud.hint('Using a steering wheel? Calibrate it in the pause menu (Esc): its whole turn becomes the whole lock', 6); }
    if (this.mapOpen) { if (I.consume('map')) this.toggleMap(); return; }
    if (I.consume('chat') && this.net?.connected) this.openChat();
    if (I.consume('map')) this.toggleMap();
    if (I.consume('modes')) this.openEvents();
    if (I.consume('help')) this.onHelp?.();
    if (I.consume('camera')) this.hud.hint(`Camera: ${this.cam.next()}`, 1.2);
    if (I.consume('lights')) { this.lightsOn = !this.lightsOn; this.hud.hint(this.lightsOn ? 'Headlights on' : 'Headlights off', 1.2); }
    if (I.consume('range')) {
      if (!(d.t.low > 1)) this.hud.hint(d.electric ? 'No low range: the motors crawl as slowly as you like' : 'No low range on this transfer case');
      else if (d.setRange(!d.low, sp)) this.hud.hint(d.low ? 'Transfer case: LOW range' : 'Transfer case: HIGH range');
      else this.hud.hint('Stop (or nearly) to change range');
    }
    if (I.consume('4wd')) {
      if (d.drive === 'rwd') this.hud.hint('Rear-wheel drive: no front axle to engage');
      else if (d.drive === 'awd') {
        // an all-wheel drive: always on; a lockable centre diff locks and frees instead
        if (!d.t.centreLock) this.hud.hint('All-wheel drive: always on, the centre diff shares the drive by itself');
        else if (d.setCentreLock(!d.lockCentre, sp)) this.hud.hint(d.lockCentre ? 'Centre diff locked' : 'Centre diff free');
        else this.hud.hint('Too fast to lock the centre diff');
      } else if (d.setFourWD(!d.fourWD, sp)) this.hud.hint(d.fourWD ? '4WD engaged' : '2WD (rear)');
      else this.hud.hint('Too fast to engage 4WD');
    }
    if (I.consume('locks')) {
      // cycle through what is fitted: open -> rear -> front + rear -> open
      const F = d.diffs.front === 'locker', Rr = d.diffs.rear === 'locker';
      if (!F && !Rr) this.hud.hint(d.diffs.rear === 'auto' ? 'Mechanical locking rear diff: it locks by itself when a wheel spins' : d.diffs.rear === 'lsd' ? 'Limited-slip rear diff: it works by itself. Lockers: see the garage (U)' : 'No lockers fitted: open diffs. See the garage (U)', 3);
      else {
        const next = !d.lockRear ? [false, true] : !d.lockFront && F ? [true, true] : [false, false];
        if (next[1] && Math.abs(sp) > 8) this.hud.hint('Too fast to lock the diffs');
        else {
          d.setLocker('front', next[0], sp); d.setLocker('rear', next[1], sp);
          this.hud.hint(next[0] ? 'Front and rear lockers in' : next[1] ? 'Rear locker in' : 'Lockers out: diffs open');
        }
      }
    }
    if (I.consume('air')) this.cyclePressure();
    if (I.consume('garage')) this.openGarage();
    if (I.consume('sway')) { v.swayDisconnected = !v.swayDisconnected; this.hud.hint(v.swayDisconnected ? 'Front anti-roll bar disconnected: more articulation, more lean' : 'Anti-roll bar connected'); }
    if (I.consume('gearMode')) {
      if (d.direct) this.hud.hint('One gear: nothing to shift');
      else { d.auto = !d.auto; if (!d.auto && d.gear <= 0) d.selectGear(1, sp); this.hud.hint(d.auto ? 'Automatic' : 'Manual: Shift up, Ctrl down (or the wheel\'s paddles)'); }
    }
    // a steering wheel's paddles shift (an automatic box goes to manual for them, as a paddle-shift automatic does), and
    // its H-pattern shifter puts the box in the gear its stick is in
    const paddle = I.consume('paddleUp') ? 1 : I.consume('paddleDown') ? -1 : 0, gate = I.consume('gate');
    if ((paddle || gate) && d.direct) this.hud.hint('One gear: nothing to shift');
    else if ((paddle || gate) && d.auto) { d.auto = false; this.hud.hint(gate ? 'Manual: the shifter picks the gear (G for automatic)' : 'Manual: the paddles shift (G for automatic)', 2.5); }
    if (!d.auto) {
      if (I.consume('shiftUp') || paddle > 0) d.selectGear(d.gear + 1 > d.t.gears.length ? d.gear : d.gear + 1, sp);
      if (I.consume('shiftDown') || paddle < 0) { if (!d.selectGear(d.gear - 1, sp)) this.hud.hint('Stop to select reverse'); }
      if (gate) {
        const want = I.gate < 0 ? -1 : Math.min(I.gate, d.t.gears.length);
        if (!d.selectGear(want, sp)) this.hud.hint(want < 0 ? 'Stop to select reverse' : 'Stop before you take it out of reverse');
      }
    }
    if (I.consume('spare')) this.fitSpare();
    if (I.consume('event')) this.events.press();
    if (I.consume('hook')) this.toggleHook();
    // (in a run: R back to the last checkpoint, Backspace restarts it)
    if (I.consume('recover')) { if (!this.events.resetToCheckpoint()) this.recover(); }
    if (I.consume('tow')) this.callHelp();
    if (I.consume('respawn')) { if (!(this.events.racing && this.events.restart())) this.towHome(); }
  }

  /** P: next tyre pressure. Down any time (stopped); up only with onboard air or at the station. */
  cyclePressure() {
    const v = this.vehicle, t = this.spec.tyre, top = t.psiStock || 30, min = t.minPsi || 14;
    // road pressure, two thirds (trail), two fifths (rock and sand), as low as the wheels allow
    const steps = [...new Set([top, Math.round(top * 2 / 3), Math.max(min, Math.round(top * 0.4)), min])];
    const cur = v.psiTarget;
    let next = steps.find((p) => p < cur - 0.5);
    if (next === undefined) next = top;
    if (next > v.psi && !t.compressor && !v.airSupply) {
      this.hud.hint(`No compressor: air back up at the station (Backspace), or fit onboard air in the garage. ${Math.round(v.psi)} psi`, 4);
      return;
    }
    if (next < v.psi && Math.abs(v.speed) > 2.5) { this.hud.hint('Stop to air down'); return; }
    v.psiTarget = next;
    this.hud.hint(next < v.psi ? `Airing down to ${next} psi` : `Airing up to ${next} psi`, 2.5);
  }

  togglePause(force) {
    this.paused = force ?? !this.paused;
    document.getElementById('menu').classList.toggle('hidden', !this.paused);
    this.input.enabled = !this.paused && !this.chatOpen;
    this.audio.setMuted('pause', this.paused);           // paused, all quiet
    this.onPause?.(this.paused);
  }

  toggleMap() {
    this.mapOpen = !this.mapOpen;
    if (this.mapOpen) this.worldMap.open(); else this.worldMap.close();
    this.input.enabled = !this.paused && !this.chatOpen && !this.mapOpen;
    this.touch?.show(!this.mapOpen);
    if (!this.mapOpen) this.renderer.renderer.domElement.focus();
  }

  openChat() { this.chat.open(); }

  closeChat() { this.chat.close(); }

  /** The layout changed here: the room gets it (a moment after the last change: building is many small steps). */
  shareLayout(L) {
    if (!this.net?.connected) return;
    clearTimeout(this.layoutT);
    this.layoutT = setTimeout(() => this.net?.send({ t: 'layout', code: encodeLayout({ ...L, map: this.world.map.id }) }), 700);
  }

  /**
   * The connection to the server lost: back into the room by itself, tried again and again further apart (a server
   * restart drops everyone; the room is made again by its code), the truck going on where it is meanwhile.
   */
  async reconnect() {
    if (this.reconnecting || !this.net) return;
    this.reconnecting = true;
    this.hud.toast('Lost the connection to the server: reconnecting...', true, 6);
    for (let k = 0; ; k++) {
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** k)));
      try {
        const w = await this.net.reconnect();
        for (const id of w.beacons || []) if (!this.found.has(id)) { this.found.add(id); this.landmarks.setFound(id, true); }
        for (const k2 of w.broken || []) this.world.breakKey(k2, 0, 1, 0, true);
        // (a race the room had is gone with the old connection: a run under way goes on as our own)
        this.events.race = null;
        this.events.welcome(w.race);
        if (w.layout) this.takeLayout(w.layout, null);
        else if (this.builder?.layout?.props?.length) this.shareLayout(this.builder.layout);
        this.voice?.rejoined();
        this.hud.toast(`Back in room ${this.net.room}`, false, 4);
        this.chat.system(`Reconnected to room ${this.net.room}`);
        break;
      } catch {
        if (k === 4) this.hud.toast('Still no connection to the server: trying again (or reload the page to rejoin)', true, 8);
      }
    }
    this.reconnecting = false;
  }

  /** A friend's layout (or the room's, joining): the same props here. */
  takeLayout(code, by) {
    const L = decodeLayout(code);
    if (!L || (L.map && L.map !== this.world.map.id)) return;
    this.builder.load(L, false);
    if (by) this.hud.hint(`${by} is building: the map changed`, 2.5);
  }

  /** What a friend said, in a bubble over their truck for a few seconds. */
  showBubble(rv, text) {
    this.dropBubble(rv);
    const c = bubbleCanvas(text);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    b.renderOrder = 6;
    b.userData.w = c.width / 50; b.userData.h = c.height / 50;         // (m, at the name tag's scale)
    rv.model.root.add(b);
    rv.bubble = b; rv.bubbleT = Math.min(10, 4 + text.length * 0.08);
  }

  dropBubble(rv) {
    if (!rv.bubble) return;
    rv.model.root.remove(rv.bubble); rv.bubble.material.map.dispose(); rv.bubble.material.dispose();
    rv.bubble = null;
  }

  // ---------------------------------------------------------------- winch
  fairleadWorld(out) {
    const f = this.vehicle.winch.fairlead, v = this.vehicle;
    return out.set(f.x, f.y, f.z).applyQuaternion(this._q.set(v.quat.x, v.quat.y, v.quat.z, v.quat.w)).add(this._v2.set(v.pos.x, v.pos.y, v.pos.z));
  }

  toggleHook() {
    const v = this.vehicle, W = v.winch;
    if (W.attached) { v.detachWinch(); this.hud.hint('Winch unhooked'); return; }
    const F = this.fairleadWorld(this._v.clone()), f = v.fwd;
    let best = null, bd = Infinity;
    const consider = (x, y, z, cand) => {
      const dx = x - F.x, dz = z - F.z, d = Math.hypot(dx, dz);
      if (d < 1 || d > W.maxLen - 1) return;
      const cos = (dx * f.x + dz * f.z) / (d * Math.hypot(f.x, f.z));
      if (cos < (cand.kind === 'truck' ? 0.1 : 0.35)) return;        // ahead of the bumper (a tree ~70, a truck ~85 degrees)
      // prefer what the bumper points at, then what is near; a friend's truck over a tree beside it
      const score = d * (1 + 2.5 * (1 - cos)) * (cand.kind === 'truck' ? 0.6 : 1);
      if (score < bd) { bd = score; best = cand; }
    };
    for (const t of this.world.treesNear(F.x, F.z, W.maxLen, this.tmpTrees)) {
      if (!t.tree) continue;                                           // a wall post
      consider(t.x, t.y, t.z, { kind: 'tree', x: t.x, y: t.y + 0.9, z: t.z, name: 'a tree' });
    }
    for (const r of this.remotes.values()) {
      if (!r.state) continue;
      // their nearer recovery point, front or rear
      let hook = null, p = null, pd = Infinity;
      for (const h of this.hookPoints(r.spec)) {
        const q = h.clone().applyQuaternion(r.model.root.quaternion).add(r.model.root.position), d = q.distanceTo(F);
        if (d < pd) { pd = d; hook = h; p = q; }
      }
      consider(p.x, p.y, p.z, { kind: 'truck', id: r.id, local: hook, x: p.x, y: p.y, z: p.z, name: `${r.name}'s ${r.spec.name}` });
    }
    if (!best) { this.hud.hint(`Nothing to hook within ${W.maxLen} m ahead: point the bumper at a tree or a friend`); return; }
    const ok = best.kind === 'tree'
      ? v.attachWinch('tree', new THREE.Vector3(best.x, best.y, best.z))
      : v.attachWinch('truck', new THREE.Vector3(best.x, best.y, best.z), best.id, best.local);
    if (ok) { this.hookName = best.name; this.hud.hint(`Hooked to ${best.name}. Hold E to winch in, Q to pay out, F to unhook`, 4); }
  }

  /** A truck's recovery points, front and rear, in its CG frame. */
  hookPoints(spec) {
    const b = spec.hull[0], y = b.c[1] - b.h[1] + 0.12 - spec.cgHeight, z0 = spec.cgZ || 0;
    return [new THREE.Vector3(0, y, b.c[2] + b.h[2] + 0.05 - z0), new THREE.Vector3(0, y, b.c[2] - b.h[2] - 0.05 - z0)];
  }

  // ---------------------------------------------------------------- remote players
  remoteView(r) {
    let rv = this.remotes.get(r.id);
    const s = r.view;
    // (a truck with a model body: the built-in one stands in while it loads, then the truck is built again)
    const style = truckSpec(s.truck).style, modelReady = !!truckAsset(style);
    if (MODEL_BODIES.has(style) && !modelReady) loadTruckAsset(style);
    if (!rv || rv.truckId !== s.truck || rv.cfg !== s.cfg || rv.model.modelBody !== modelReady) {
      if (rv) { this.scene.remove(rv.model.root); rv.model.dispose(); }
      const spec = truckSpec(s.truck, s.cfg || undefined);
      const color = MATE_COLORS[r.id % MATE_COLORS.length];
      rv = { id: r.id, name: r.name, truckId: s.truck, cfg: s.cfg, spec, model: modelFor(spec, s.truck, s.paint), color, paint: s.paint };
      rv.tag = nameTag(r.name, color);
      rv.model.root.add(rv.tag);
      rv.tag.position.set(0, spec.roofY + spec.raise - spec.cgHeight + 0.5, 0);
      this.scene.add(rv.model.root);
      const key = `${spec.id}:${spec.buildCode}`;
      if (!this.sphereCache.has(key)) this.sphereCache.set(key, new Vehicle(spec).hullSpheres);
      rv.spheres = this.sphereCache.get(key);
      this.remotes.set(r.id, rv);
    }
    if (rv.paint !== s.paint) { rv.model.setPaint(s.paint); rv.paint = s.paint; }
    rv.name = r.name;
    return rv;
  }

  /**
   * The ground in your hands: the gamepad rumbles (the heavy motor with the shake of the ground, mud judder and hits,
   * the light one with the buzz of the surface and the steering's kick), an Android phone buzzes over rough ground and
   * on hits, and the camera trembles (most from the seat). Browsers can't drive a wheel's force feedback motor, so a
   * steering wheel only shows the kick in the cab.
   */
  feelGround(dt) {
    const f = this.vehicle.feel, on = this.settings.rumble !== false;
    const hit = Math.max(f.bump, Math.min(1, this.vehicle.impact / 4));
    const seat = this.cam.mode !== 'chase' && this.cam.mode !== 'far';            // (a camera on the body)
    this.cam.jitter = on ? (f.texture * 0.0035 + Math.min(1, f.rough) * 0.012 + f.judder * 0.006) * (seat ? 1 : 0.4) : 0;
    if (!on) return;
    this.rumbleIn = (this.rumbleIn || 0) - dt;
    const strong = clamp(Math.min(1, f.rough) * 0.55 + f.judder * 0.5 + hit, 0, 1);
    const weak = clamp(f.texture * 0.55 + Math.abs(f.kick) / 12, 0, 1);
    if (this.rumbleIn <= 0 && (strong > 0.05 || weak > 0.06)) {
      this.input.rumble(strong, weak, 110);
      this.rumbleIn = 0.08;
    }
    // phones (Android: on/off only): short buzzes, closer together the rougher it gets, and a long one on a hit
    if (this.input.device === 'touch' && navigator.vibrate) {
      this.buzzIn = (this.buzzIn || 0) - dt;
      const amt = Math.min(1, f.rough) * 0.7 + f.judder * 0.5 + f.texture * 0.25;
      if (hit > 0.35 && this.buzzIn < 0.1) { navigator.vibrate(Math.round(30 + hit * 50)); this.buzzIn = 0.25; }
      else if (amt > 0.25 && this.buzzIn <= 0) { navigator.vibrate(Math.round(8 + amt * 14)); this.buzzIn = 0.45 - amt * 0.3; }
    }
  }

  // ---------------------------------------------------------------- damage (physics/Damage.js)
  /** What broke this frame: messages, dents, glass, lamps, flat tyres; steam from the radiator, smoke from the engine. */
  damageFrame(dt) {
    const v = this.vehicle, D = v.damage, m = this.model;
    for (const msg of D.messages) this.hud.toast(msg.text, msg.kind === 'bad', msg.kind === 'bad' ? 7 : 4);
    D.messages.length = 0;
    if (D.newDents.length) { m.applyDents(D.newDents); D.newDents.length = 0; }
    if (D.version !== this.dmgSeen) {
      if (D.glass >= 2 && !this.glassGone) this.shatter(m.root, this.spec);
      this.glassGone = D.glass >= 2;
      m.setDamage(D.glass, D.lights, D.flat, D.toe);
      this.dmgSeen = D.version;
    }
    const steam = D.radiator > 0 && D.coolant > 0.02 ? (D.temp > 112 ? 2 : 1) : D.temp > 112 ? 2 : 0;
    this.damageFx(dt, m.root, this.spec, steam, 1 - D.engine, 'me');
    // tell the room (rarely: when something changes, and now and then for anyone who joined since)
    if (this.net?.connected) {
      this.dmgSendT = (this.dmgSendT || 0) - dt;
      if (D !== this.dmgSentObj || D.version !== this.dmgSentV) {
        this.net.send({ t: 'damage', d: D.summary() });
        this.dmgSentObj = D; this.dmgSentV = D.version;
      }
    }
  }

  /** Steam (1 leaking, 2 boiling) from the grille, smoke (engine wear 0..1) from under the bonnet. */
  damageFx(dt, root, spec, steam, smoke, key) {
    const fx = this.fxT || (this.fxT = {});
    fx[key] = (fx[key] || 0) - dt;
    if (fx[key] > 0 || (!steam && smoke < 0.3)) return;
    const raise = spec.raise || 0, p = this._fxP || (this._fxP = new THREE.Vector3());
    p.set((Math.random() - 0.5) * 0.5, raise - spec.cgHeight + 1.12, spec.noseZ - (spec.cgZ || 0) - 0.3).applyQuaternion(root.quaternion).add(root.position);
    const r = () => (Math.random() - 0.5) * 0.4;
    if (steam) this.effects.spawn(p.x, p.y, p.z, r(), 0.9 + Math.random() * 0.6, r(), steam > 1 ? 0.5 : 0.32, 1.8, [0.9, 0.92, 0.94], steam > 1 ? 0.5 : 0.28, 1.4, 0.9, -0.5);
    if (smoke >= 0.3) this.effects.spawn(p.x, p.y + 0.1, p.z - 0.3, r(), 0.7 + Math.random() * 0.4, r(), 0.4, 2.4, [0.16, 0.16, 0.16], 0.3 + smoke * 0.3, 1.2, 0.9, -0.3);
    fx[key] = steam > 1 ? 0.035 : steam ? 0.09 : 0.12;
  }

  /** The side and back windows go: a shower of little cubes of toughened glass. */
  shatter(root, spec) {
    const p = new THREE.Vector3(0, (spec.raise || 0) - spec.cgHeight + spec.roofY - 0.35, spec.cabZ - (spec.cgZ || 0) - 0.4).applyQuaternion(root.quaternion).add(root.position);
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
      this.effects.spawn(p.x + (Math.random() - 0.5) * 1.4, p.y + (Math.random() - 0.5) * 0.4, p.z + (Math.random() - 0.5) * 1.6,
        Math.cos(a) * sp, 0.5 + Math.random() * 1.5, Math.sin(a) * sp, 0.012 + Math.random() * 0.012, 1.6 + Math.random() * 1.2, [0.7, 0.82, 0.84], 0.9, 0, 0.3, 9.81, KIND.SHARD);
    }
  }

  /** Backspace: the tow truck takes us back to the station (a fee when it has a long way to come). */
  /** Broken down: a seized engine, or no wheel left that drives. It won't go anywhere under its own power. */
  get brokenDown() { return this.vehicle.damage.seized || this.stuckWhy === 'broken'; }

  /** The tow truck takes a broken-down truck into the station workshop, and the mechanics mend it (for the bill). */
  towToWorkshop() {
    const G = this.garageSpot, p = this.vehicle.pos, v = this.vehicle;
    const far = G && Math.hypot(p.x - G.x, p.z - G.z) > 150;
    if (v.winch.attached) v.detachWinch();
    if (this.helpOn) this.setHelp(false);
    this.placeAtGarage();
    if (this.net) this.net.warp++;
    this.carry = 0; this.stuckT = 0; this.boggedT = 0;
    const fee = far && this.career ? this.career.charge(TOW_FEE, 'Tow truck to the station workshop') : 0;
    this.hud.toast(`Towed into the station workshop${fee ? `: ${money(fee)}` : ''}`, false, 4);
    this.repairAtGarage();
  }

  towHome() {
    if (this.events?.racing) this.events.giveUp('Towed off the course: the run is over');
    if (this.brokenDown) { this.towToWorkshop(); return; }
    const S = this.stationSpot, p = this.vehicle.pos;
    const far = S && Math.hypot(p.x - S.x, p.z - S.z) > 250;
    this.spawn();
    if (far && this.career) this.hud.toast(`Tow truck to the station: ${money(this.career.charge(TOW_FEE, 'Tow truck to the station'))}`, false, 4);
  }

  /** Y: fit the spare in place of a flat tyre (stopped). */
  fitSpare() {
    const v = this.vehicle, D = v.damage, i = D.flat.findIndex(Boolean);
    if (i < 0) { this.hud.hint(D.spare ? 'No flat tyre: the spare stays on its carrier' : 'No flat tyre (and the spare is used)'); return; }
    if (!D.spare) { this.hud.hint('No spare left: drive gently to the station garage, or call a tow (T)', 4); return; }
    if (Math.abs(v.speed) > 0.5) { this.hud.hint('Stop to change the tyre'); return; }
    D.fitSpare(i);
  }

  /** At the station garage: everything mended (dents, glass, radiator, engine, springs, shafts, tyres, the spare). */
  repairAtGarage() {
    const D = this.vehicle.damage;
    if (!D.any) return false;
    const bill = D.cost;
    const paid = this.career ? this.career.charge(bill, 'Workshop repairs') : 0;
    this.applyBuild(this.build, false);
    this.hud.toast(this.career
      ? `Repaired at the station workshop: ${money(paid)}${this.career.money < 0 ? ' (on credit: you owe the workshop)' : ''}`
      : `Repaired at the station workshop (parts and labour about ${money(bill)})`, false, 6);
    return true;
  }

  /** What presses the grass flat: our wheels on the ground and our friends' trucks. */
  grassPush() {
    const out = this._push || (this._push = []);
    out.length = 0;
    const v = this.vehicle, r = v.spec.tyre.radius;
    for (const w of v.wheels) if (w.contact) out.push({ x: w.hub.x, z: w.hub.z, r: r * 1.4 });
    for (const rv of this.remotes.values()) {
      if (out.length >= 6) break;
      if (rv.state) out.push({ x: rv.model.root.position.x, z: rv.model.root.position.z, r: 2.2 });
    }
    return out;
  }

  /** A friend's dents, glass, lamps, flat tyres, steam and smoke (their summary, physics/Damage.js). */
  remoteDamage(rv, dm, dt) {
    if (!dm) return;
    if (dm.v !== rv.dmgV || dm.n !== rv.dentN) {
      if (rv.dentN !== undefined && dm.n < rv.dentN) { rv.cfg = null; rv.dmgV = undefined; rv.dentN = undefined; return; }  // repaired: a fresh truck
      const fresh = Math.min(dm.d.length, dm.n - (rv.dentN || 0));
      if (fresh > 0) rv.model.applyDents(dm.d.slice(-fresh).map((a) => ({ p: a.slice(0, 3), d: a.slice(3, 6), depth: a[6], r: a[7] })));
      if (dm.g >= 2 && !rv.glassGone) this.shatter(rv.model.root, rv.spec);
      rv.glassGone = dm.g >= 2;
      rv.model.setDamage(dm.g, [dm.l & 1, (dm.l >> 1) & 1], [0, 1, 2, 3].map((i) => (dm.f >> i) & 1), dm.t);
      rv.dmgV = dm.v; rv.dentN = dm.n;
    }
    this.damageFx(dt, rv.model.root, rv.spec, dm.s, dm.k, `r${rv.id}`);
  }

  updateRemotes(dt) {
    const others = [], pulls = [], W0 = this.vehicle.winch;
    const live = new Set();
    if (this.net) {
      for (const r of this.net.remotes.values()) {
        const s = this.net.sample(r);
        if (!s) continue;
        live.add(r.id);
        const rv = this.remoteView(r);
        rv.state = s;
        const root = rv.model.root;
        root.position.set(s.pos[0], s.pos[1], s.pos[2]);
        root.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
        rv.model.updateWheels(s.wh, dt);
        rv.model.setLights(!!s.lights);
        rv.model.setBrake(!!s.brk);
        rv.model.setReverse(s.vel[0] * (2 * (s.quat[0] * s.quat[2] + s.quat[3] * s.quat[1])) + s.vel[2] * (1 - 2 * (s.quat[0] * s.quat[0] + s.quat[1] * s.quat[1])) < -0.3);
        const dist = root.position.distanceTo(this.renderer.camera.position);
        rv.tag.visible = dist < 450;
        if (rv.model.driver) rv.model.driver.group.visible = dist < 90;      // (too small to see further off: not posed)
        rv.tag.scale.set(3.2 * Math.max(1, dist / 30), 0.8 * Math.max(1, dist / 30), 1);
        if (rv.bubble) {
          const k = Math.max(1, dist / 24), B = rv.bubble.userData;
          rv.bubbleT -= dt;
          rv.bubble.scale.set(B.w * k, B.h * k, 1);
          rv.bubble.position.set(0, rv.tag.position.y + (0.45 + B.h * 0.5) * k, 0);
          rv.bubble.material.opacity = clamp(rv.bubbleT / 0.6, 0, 1);
          rv.bubble.visible = rv.tag.visible;
          if (rv.bubbleT <= 0) this.dropBubble(rv);
        }
        others.push({ pos: root.position, quat: root.quaternion, vel: this._v.set(s.vel[0], s.vel[1], s.vel[2]).clone(), spheres: rv.spheres });
        // their winch on us: pulled toward their fairlead (if they called for a tow, we are their anchor). We see their
        // truck and their rope a moment late (net.lead): both brought on to now, as they go, the rope's pull is worked
        // out here from where our truck is (physics/Vehicle.js)
        const w = s.winch;
        if (w && w.to === this.net.id) {
          const lead = this.net.lead, vel = new THREE.Vector3(...s.vel);
          const target = new THREE.Vector3(...w.f).applyQuaternion(root.quaternion).add(root.position).addScaledVector(vel, lead);
          const len = Math.max(0.6, (s.winchLen || w.len) + (s.winchRate || 0) * lead);
          pulls.push({ local: new THREE.Vector3(...w.a), target, targetVel: vel, len, rope: rv.spec.winch, tension: w.ten, anchorMe: !!s.help, by: rv.name });
        }
        // a friend calling for a tow
        if (s.help && !rv.help) {
          const d = root.position.distanceTo(this.vehicle.pos), dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
          const a = Math.atan2(root.position.x - this.vehicle.pos.x, -(root.position.z - this.vehicle.pos.z));
          const dir = dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
          this.hud.toast(`${r.name} needs a tow! ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'} ${dir} (red ! on the compass)`, true, 8);
          this.audio.chirp?.();
        }
        if (rv.help && W0.attached && W0.kind === 'truck' && W0.target === rv.id) rv.towedAt = performance.now();
        if (rv.help && !s.help && rv.towedAt && performance.now() - rv.towedAt < 20000 && this.career
          && performance.now() - (rv.rewardAt || -1e9) > 180000) {
          rv.rewardAt = performance.now();
          this.career.add(RESCUE_FEE, `Towed ${rv.name} out`);
          this.hud.toast(`You towed ${rv.name} out: ${money(RESCUE_FEE)} recovery fee`, false, 5);
        }
        rv.help = !!s.help;
        this.remoteDamage(rv, r.dmg, dt);
        this.remoteRuts(rv, s);
        this.remoteEffects(rv, s, dt);
      }
    }
    for (const [id, rv] of this.remotes) {
      if (live.has(id)) continue;
      this.dropBubble(rv); this.scene.remove(rv.model.root); rv.model.dispose(); this.remotes.delete(id);
      if (this.vehicle.winch.target === id) { this.vehicle.detachWinch(); this.hud.hint('Winch line dropped'); }
    }
    this.vehicle.others = others;
    this.vehicle.pulls = pulls;
  }

  /** Press other players' tyre tracks into soft ground here too, so ruts are shared. */
  remoteRuts(rv, s) {
    const root = rv.model.root, spec = rv.spec, R = spec.tyre.radius;
    if (root.position.distanceToSquared(this.renderer.camera.position) > 200 * 200) return;
    const fwd = this._v.set(0, 0, 1).applyQuaternion(root.quaternion);
    for (let i = 0; i < 4; i++) {
      const ax = spec.axles[i < 2 ? 0 : 1], side = i % 2 === 0 ? 1 : -1;
      const p = new THREE.Vector3(side * ax.track / 2, -spec.cgHeight + 0.05, ax.z - (spec.cgZ || 0)).applyQuaternion(root.quaternion).add(root.position);
      const key = rv.id * 4 + i, last = this.stamps.get(key);
      if (last && Math.hypot(p.x - last.x, p.z - last.z) < 0.15) continue;
      this.stamps.set(key, { x: p.x, z: p.z });
      const surf = this.world.surfaceAt(p.x, p.z);
      if (!surf.sink) continue;
      const pKPa = spec.mass * 9.81 / 4 / (spec.tyre.width * 0.25) / 1000;
      this.world.deform(p.x, p.z, fwd.x, fwd.z, spec.tyre.width * 0.5, 0.12, Math.min(surf.maxSink, pKPa / surf.sink), 0);
    }
    void R;
  }

  remoteEffects(rv, s, dt) {
    const root = rv.model.root;
    if (root.position.distanceToSquared(this.renderer.camera.position) > 150 * 150) return;
    const fwd = this._v.set(0, 0, 1).applyQuaternion(root.quaternion);
    const speed = s.vel[0] * fwd.x + s.vel[2] * fwd.z, R = rv.spec.tyre.radius;
    for (let i = 0; i < 4; i++) {
      const ax = rv.spec.axles[i < 2 ? 0 : 1], side = i % 2 === 0 ? 1 : -1;
      const hub = new THREE.Vector3(side * ax.track / 2, R - rv.spec.cgHeight, ax.z - (rv.spec.cgZ || 0)).applyQuaternion(root.quaternion).add(root.position);
      const surf = this.world.surfaceAt(hub.x, hub.z), wl = this.world.water(hub.x, hub.z);
      // (we don't hear how fast their wheels turn: spinning when they floor it and hardly move on soft ground)
      const slip = s.thr > 0.6 && Math.abs(speed) < 3 && surf.sink ? 4 : 0;
      const w = { contact: true, surf, slipSpeed: slip, omega: (speed + slip * (speed < -0.3 ? -1 : 1)) / R, water: Math.max(0, wl - (hub.y - R)) };
      this.effects.wheel(`r${rv.id}-${i}`, w, dt, speed, hub.x, hub.y, hub.z, fwd.x, fwd.z, R);
    }
    const p = root.position, b = rv.spec.hull[0], cgZ = rv.spec.cgZ || 0;
    const wl = this.world.water(p.x, p.z), bottom = p.y + b.c[1] - b.h[1] - rv.spec.cgHeight;
    this.effects.hull(`r${rv.id}`, dt, p.x, p.y, p.z, s.vel[0], s.vel[2], fwd.x, fwd.z, b.h[0], b.c[2] + b.h[2] - cgZ, wl > -1e8 ? Math.max(0, wl - bottom) : 0, wl);
  }

  // ---------------------------------------------------------------- beacons
  markFound(id, by) {
    if (this.found.has(id)) return;
    this.found.add(id);
    this.landmarks.setFound(id, true);
    const b = this.world.beacons.find((x) => x.id === id);
    const n = this.found.size, total = this.world.beacons.length;
    if (b) this.hud.toast(by ? `${by} surveyed ${b.name} (${n}/${total})` : `Surveyed ${b.name} (${n}/${total})`, true, 5);
    if (b && this.career) {
      const paid = this.career.d.bounties || (this.career.d.bounties = []), key = `${this.world.map.id}:${id}`;
      if (!paid.includes(key)) {
        paid.push(key);
        this.career.add(by ? BOUNTY_SHARE : BOUNTY, by ? `Share of ${by}'s survey bounty (${b.name})` : `Survey bounty: ${b.name}`);
      }
    }
    if (n === total) this.hud.toast(`Every beacon in ${this.world.map.name} is surveyed. Great work!`, true, 8);
    if (!this.net?.connected) {
      try { localStorage.setItem(soloBeaconsKey(this.world.map), JSON.stringify([...this.found])); } catch { /* storage blocked */ }
    }
  }

  checkBeacons() {
    const p = this.vehicle.pos;
    for (const b of this.world.beacons) {
      if (this.found.has(b.id)) continue;
      if (Math.hypot(b.x - p.x, b.z - p.z) < BEACON_RADIUS && Math.abs(b.y - p.y) < 8) {
        if (this.net?.connected) this.net.send({ t: 'beacon', id: b.id });
        this.markFound(b.id, null);
        this.audio.chirp?.();
      }
    }
  }

  onNet(m) {
    if (m.t === 'beacon') this.markFound(m.id, m.by === this.name ? null : m.by);
    else if (m.t === 'join') { this.hud.toast(`${m.name} joined`); this.chat.system(`${m.name} joined the room`); }
    else if (m.t === 'leave') { this.hud.toast(`${m.name} left`); this.chat.system(`${m.name} left`); this.events.onLeave(m.id); }
    else if (m.t === 'layout') { if (m.id !== this.net?.id) this.takeLayout(m.code, m.name); }
    else if (m.t === 'chat') {
      const mine = m.id === this.net?.id, rv = this.remotes.get(m.id);
      this.chat.add(m.name, m.text, mine ? this.myColor : rv?.color, mine);
      if (rv && !mine) this.showBubble(rv, m.text);
    }
    else if (m.t === 'disconnected') this.reconnect();
    else if (m.t === 'correction') this.net.warp++;
    else if (m.t === 'ev') this.events.onNet(m);
    else if (m.t === 'brk') this.world.breakKey(m.k, m.d?.[0] ?? 0, m.d?.[1] ?? 1, m.v ?? 0);
    if (this.voice && (m.t === 'voice' || m.t === 'rtc' || m.t === 'join' || m.t === 'leave')) this.voice.onNet(m);
    if (m.t === 'join' && this.voice && !this.voice.joined && !this.voiceHinted) { this.voiceHinted = true; this.hud.hint(`${m.name} is here: press V to join the voice chat`, 5); }
  }

  // ---------------------------------------------------------------- frame
  frame(dt) {
    const I = this.input, v = this.vehicle, W = v.winch;
    const ctrl = I.update(dt);
    this.actions();
    // paused: the whole game stops where it is (our truck, its sound, the camera, the clocks); only friends' trucks
    // in an online room go on (their games aren't paused), and they see ours standing still
    if (this.paused) { this.pausedFrame(dt); I.endFrame(); return; }
    const c = { ...ctrl };
    if (this.chatOpen) { c.throttle = 0; c.brake = 0; c.handbrake = 1; c.steer = 0; c.winch = 0; }
    // a steering wheel with the assist on gets it as the keys and sticks do (its whole travel is the whole lock at walking
    // pace, at speed as far as the tyres grip, with stability control: raw, a nudge at speed turned the front wheels hard
    // over and spun the car), answering as quickly as the hands turn it; with the assist off, everything is raw
    c.wheelAssist = this.settings.assist && c.analogSteer;
    if (c.wheelAssist) c.analogSteer = false;
    if (!this.settings.assist) c.analogSteer = true;
    if (this.garageOpen || this.mapOpen || this.building) { c.throttle = 0; c.brake = 0; c.handbrake = 1; c.steer = 0; c.winch = 0; }
    W.motor = W.attached ? c.winch : 0;

    this.updateRemotes(dt);
    this.voice?.update();
    // winching a friend out: hold our own truck on the brakes (as you'd put it in park); winching to a tree, or
    // winching ourselves out of trouble on a friend's truck, roll free. A friend in trouble winching on us: hold still.
    const inTrouble = this.helpOn || v.flooded || v.waterDepth > 0.6 || v.up.y < 0.5;
    c.hold = W.attached && W.kind === 'truck' && W.motor !== 0 && c.throttle < 0.05 && !inTrouble ? 0.8 : 0;
    if (!c.hold && v.pulls.some((p) => p.anchorMe) && c.throttle < 0.05 && c.brake < 0.05) c.hold = 1;
    // a friend winching us out, and we're off the pedals: the drive out (an automatic in neutral, as a manual's clutch
    // already is at idle), so the truck rolls to the rope. In gear an automatic crept off against it at idle, and as each
    // of us moves only our own truck, the creep dragged the friend's truck along on its brakes instead
    if (!c.hold && v.pulls.length && c.throttle < 0.05 && c.brake < 0.05) c.neutral = 1;
    // a truck we're winching toward moves: follow its tow point (brought on to now: we see it a moment late)
    if (W.attached && W.kind === 'truck') {
      const rv = this.remotes.get(W.target);
      if (rv?.state) {
        W.anchorVel = new THREE.Vector3(...rv.state.vel);
        W.anchor.copy(new THREE.Vector3().copy(W.anchorLocal).applyQuaternion(rv.model.root.quaternion).add(rv.model.root.position).addScaledVector(W.anchorVel, this.net.lead));
      }
    } else W.anchorVel = null;

    // the station's air line: air up for free there
    v.airSupply = this.nearGarage(26) || (this.stationSpot && Math.hypot(v.pos.x - this.stationSpot.x, v.pos.z - this.stationSpot.z) < 22);
    const wasFlooded = v.flooded, wasRunning = v.dt.running;
    if (!v.dt.running && !v.flooded && v.dt.crankT <= 0 && c.throttle > 0.5) {
      if (v.damage.seized) { if ((this.seizedHintT = (this.seizedHintT || 0) - dt) <= 0) { this.hud.hint('The engine is seized: it needs a tow to the station', 3); this.seizedHintT = 3; } } else { v.dt.start(); this.hud.hint(v.dt.electric ? 'Ready to drive' : 'Starting the engine', 1.2); }
    }
    this.events.control(c);
    this.carry = simulate(v, c, this.world, dt, this.carry);
    // what broke: drawn and heard here, and told to the room (its direction and speed: friends see it go the same way)
    for (const e of this.breakView.take(this.renderer.camera.position)) {
      this.net?.send({ t: 'brk', k: e.key, d: [Math.round(e.dx * 100) / 100, Math.round(e.dz * 100) / 100], v: Math.round(e.v * 10) / 10 });
    }
    this.events.update(dt);
    if (v.flooded && !wasFlooded) {
      this.hud.toast(this.spec.snorkel ? 'Water over the snorkel: the engine has stopped' : 'Water in the air intake: the engine has stopped. Get it out of the water (winch!)', true, 6);
      this.audio.stall?.();
    }
    if (v.dt.running && !wasRunning) this.hud.hint(v.dt.electric ? 'Drive on again' : 'Engine running again', 2);
    // an electric truck in deeper than it is sealed for: its battery management cuts the power back
    if (v.dt.electric && v.intakeWet && (this.evWetT = (this.evWetT || 0) - dt) <= 0) { this.hud.hint('Deeper than the battery is sealed for: power cut back', 3); this.evWetT = 6; }
    this.trackDry(dt);
    this.checkStuck(dt, c);
    // a friend who called for a tow, within reach of our winch
    this.towHintT -= dt;
    if (!W.attached && this.towHintT <= 0) {
      for (const r of this.remotes.values()) {
        if (!r.help || !r.state) continue;
        const d = r.model.root.position.distanceTo(v.pos);
        if (d < W.maxLen + 2) { this.hud.hint(`${r.name} needs a tow: point your bumper at the truck, F to hook, hold E to pull`, 5); this.towHintT = 9; break; }
      }
    }

    // keep inside the valley
    if (!this.world.inBounds(v.pos.x, v.pos.z, 14) || v.pos.y < -50 || !Number.isFinite(v.pos.x)) {
      if (this.safe) { v.place(this.world, this.safe.x, this.safe.z, this.safe.yaw); if (this.net) this.net.warp++; } else this.spawn();
      this.hud.toast('That is as far as the valley goes');
    }
    this.safeT += dt;
    if (this.safeT > 2 && v.settled && v.vel.length() < 15) {
      this.safeT = 0;
      this.safe = { x: v.pos.x, z: v.pos.z, yaw: Math.atan2(v.fwd.x, v.fwd.z) };
    }

    // ruts -> terrain
    const dirty = this.world.deformGrid.takeDirty();
    if (dirty) { this.terrain.markDirty(dirty); this.grass.markDirty(dirty); this.tea?.markDirty(dirty); }

    // the truck
    const m = this.model;
    m.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    m.root.quaternion.set(v.quat.x, v.quat.y, v.quat.z, v.quat.w);
    m.setSeatView(this.cam.mode === 'cab');
    if (m.gauges && this.cam.mode === 'cab') m.updateGauges(v.dt.rpm, Math.abs(v.speed) * 3.6, v.dt.gear < 0 ? 'R' : v.dt.gear === 0 ? 'N' : String(v.dt.gear));
    m.handWheel = this.input.enabled ? ctrl.wheelTurn ?? null : null;
    m.updateWheels([0, 1, 2, 3].map((i) => v.wheelState(i)), dt);
    const night = this.renderer.night;
    windowGlow(this.renderer.dark || 0);                             // (the villages' lit windows)
    const lights = this.lightsOn || night;
    m.setLights(lights);
    m.setBrake(v.pedalBrake > 0.1);
    m.setReverse(v.dt.gear < 0);
    this.heads.forEach((h, i) => { h.intensity = lights && v.damage.lights[i] ? 60 : 0; });
    if (this.barLight) this.barLight.intensity = lights ? 160 : 0;
    // mud on the paint: picked up in mud and wet ground, washed off in water
    let mud = 0;
    for (const w of v.wheels) if (w.contact && (w.surf.name === 'mud' || w.surf.name === 'riverbed' || w.surf.name === 'snow')) mud += (Math.abs(v.speed) * 0.02 + w.slipSpeed * 0.03);
    this.dirt = clamp(this.dirt + mud * dt * 0.25 - (v.waterDepth > 0.2 ? v.waterDepth * dt * 0.25 : 0), 0, 1);
    m.setDirt(this.dirt);
    this.damageFrame(dt);

    // effects from our tyres
    const speed = v.speed;
    const R = v.spec.tyre.radius;
    for (const w of v.wheels) this.effects.wheel(`me-${w.index}`, w, dt, speed, w.hub.x, w.hub.y, w.hub.z, w.headX, w.headZ, R);
    // ... and from the hull pushing through water
    const hb = v.spec.hull[0];
    this.effects.hull('me', dt, v.pos.x, v.pos.y, v.pos.z, v.vel.x, v.vel.z, v.fwd.x, v.fwd.z, hb.h[0], hb.c[2] + hb.h[2] - (v.spec.cgZ || 0), v.waterDepth, this.world.water(v.pos.x, v.pos.z));
    if (v.hullContact > 0.8) this.cam.shake = Math.max(this.cam.shake, Math.min(0.12, v.hullContact * 0.04));
    if (v.impact > 0.5) this.cam.shake = Math.max(this.cam.shake, Math.min(0.2, v.impact * 0.05));
    this.feelGround(dt);
    // king of the hill: the satnav finds the way to the hill
    const mrun = this.events.run;
    if (mrun?.event.kind === 'hill' && mrun.phase !== 'finished' && !this.route) {
      const H = mrun.event.hill;
      if (Math.hypot(H.x - v.pos.x, H.z - v.pos.z) > 30) this.setRoute({ kind: 'point', name: H.name, x: H.x, z: H.z }, true);
    }
    this.updateRoute(dt);
    // the line on the ground: a run's course while it is on, else the satnav's route
    const runLine = this.events.run && this.events.run.phase !== 'finished' ? this.events.run.event.line : null;
    this.routeLine.update(runLine || this.route?.points, v.pos, this.world, dt);

    // camera and world
    if (this.building) this.builder.update(dt); else this.cam.update(dt, m, ctrl);
    // (a custom race's own arches show while it is run: the builder's markers step aside)
    this.builder.view.setMarkersVisible(!(this.events.run?.event.custom && this.events.run.phase !== 'finished'));
    const camPos = this.renderer.camera.position;
    this.terrain.update(camPos);
    this.vegetation.update(this.renderer.camera, dt);
    this.rocks.update(this.renderer.camera);
    this.grass.update(this.renderer.camera, dt, this.grassPush());
    this.tea?.update(this.renderer.camera);
    this.water.update(this.renderer.camera, dt, this.renderer.sky.state.horizon);
    this.landmarks.update(this.renderer.camera, dt);
    this.course.update(dt);
    this.modeView.update(this.events.run, v.pos, dt);
    this.breakView.update(dt, [{ pos: v.pos, vel: v.vel }, ...[...this.remotes.values()].filter((r) => r.state?.vel).map((r) => ({ pos: r.model.root.position, vel: { x: r.state.vel[0], y: r.state.vel[1], z: r.state.vel[2] } }))]);
    const Rn = this.renderer;
    this.effects.setLight(Rn.sky.sunDir, Rn.sun.color, Rn.sun.intensity, Rn.hemi.color, Rn.hemi.groundColor, Rn.hemi.intensity);
    this.effects.update(dt, this.world, Rn.camera);
    if (W.attached) {
      const a = this.fairleadWorld(new THREE.Vector3());
      const b = new THREE.Vector3(W.anchor.x, W.anchor.y, W.anchor.z);
      // (on a friend's truck: to its hook as it is drawn, not where the winch reckons it is by now)
      const rv = W.kind === 'truck' ? this.remotes.get(W.target) : null;
      if (rv) b.copy(W.anchorLocal).applyQuaternion(rv.model.root.quaternion).add(rv.model.root.position);
      this.rope.update(a, b, W.len - a.distanceTo(b));
    } else this.rope.update(null);
    // friends' winch lines
    this.updateRemoteRopes();
    this.renderer.updateSun(m.root.position);

    this.checkBeacons();

    // sound
    const remotes = [...this.remotes.values()].filter((r) => r.state).map((r) => ({ id: r.id, spec: r.spec, pos: r.model.root.position, rpm: r.state.rpm, thr: r.state.thr }));
    this.audio.update(dt, v, this.renderer.camera, remotes);
    v.impact = 0;
    // an exhaust pop (a hard upshift, or lifting off from high revs): a flash and a puff at the tailpipe, low on the
    // right at the back of the hull
    const pop = this.audio.takePop();
    if (pop > 0) {
      const hb = v.boxes[0], lx = -(hb.h.x - 0.28), ly = hb.c.y - hb.h.y + 0.12, lz = hb.c.z - hb.h.z - 0.05;   // (+x: left)
      const px = v.pos.x + v.left.x * lx + v.up.x * ly + v.fwd.x * lz, py = v.pos.y + v.left.y * lx + v.up.y * ly + v.fwd.y * lz;
      const pz = v.pos.z + v.left.z * lx + v.up.z * ly + v.fwd.z * lz;
      this.effects.exhaust(px, py, pz, -v.fwd.x, -v.fwd.z, v.vel.x, v.vel.z, pop);
    }

    // network
    if (this.net) this.net.sendState(dt, v, this.netExtra(lights));

    // HUD
    this.hud.update(dt);
    this.hudT += dt; this.miniT += dt;
    const heading = Math.atan2(v.fwd.x, -v.fwd.z);
    const mates = [...this.remotes.values()].filter((r) => r.state).map((r) => ({ id: r.id, x: r.model.root.position.x, z: r.model.root.position.z, color: r.color, name: r.name, help: !!r.help }));
    if (this.hudT > 1 / 30) {
      this.hudT = 0;
      this.hud.drawGauges(v);
      this.hud.drawChips(v);
      this.garageHintT = (this.garageHintT || 0) + 1 / 30;
      if (this.nearGarage(14) && Math.abs(v.speed) < 1 && this.garageHintT > 8) { this.garageHintT = 0; this.hud.hint('Station garage: press U to fit parts', 4); }
      this.hud.drawWinch(v, this.hookName);
      this.updateStuckPanel();
      this.hud.drawCompass(heading, v.pos, mates, this.route);
    }
    if (this.miniT > 1 / 12) {
      this.miniT = 0;
      if (this.chat.available !== !!this.net?.connected) this.chat.setAvailable(!!this.net?.connected);
      const run = this.events.run, courseLine = run && run.phase !== 'finished' && run.event.line;
      this.hud.drawMinimap(v.pos, heading, mates, courseLine ? { points: courseLine } : this.route, this.modeMarks());
      this.hud.drawObjective(v.pos, this.route);
      const vp = this.voicePanel;
      const list = [{ name: this.name, color: this.myColor, me: true, help: this.helpOn, tag: this.events.tagFor(this.net?.id), voice: vp?.stateOf(null) },
        ...mates.map((r) => ({ name: r.name, color: r.color, help: r.help, tag: this.events.tagFor(r.id), voice: vp?.stateOf(this.voice.peers.get(r.id)) }))];
      vp?.tick();
      this.hud.drawPlayers(this.net ? list : []);          // (alone: no list of one)
      this.hud.drawTopRight({ name: this.name, level: this.career?.level, net: this.net, players: list.length });
    }
    if (this.mapOpen) this.worldMap.draw();

    this.touch?.update(this);
    // the mirrors, while they can be seen (from the driver's seat): one drawn a frame (every other on medium graphics)
    const q = this.settings.quality || 'high';
    if (m.mirrors && this.cam.mode === 'cab' && q !== 'low' && !this.noRender) {
      m.mirrors.update(this.renderer.renderer, this.scene, this.renderer.camera.position, q === 'high' ? 1 : 2, [...(this.grass.meshes || [this.grass.mesh]), this.tea?.mesh].filter(Boolean));
    }
    if (!this.noRender) this.renderer.render();
    this.perf(dt);
    I.endFrame();
  }

  /** What the room hears about us beside the truck's motion: which truck, its build, paint, lights and winch line. */
  netExtra(lights) {
    const W = this.vehicle.winch;
    let winch = null;
    if (W.attached) {
      winch = W.kind === 'tree'
        ? { to: 'tree', a: [W.anchor.x, W.anchor.y, W.anchor.z], f: [W.fairlead.x, W.fairlead.y, W.fairlead.z], len: W.len, ten: W.tension }
        : { to: W.target, a: [W.anchorLocal.x, W.anchorLocal.y, W.anchorLocal.z], f: [W.fairlead.x, W.fairlead.y, W.fairlead.z], len: W.len, ten: W.tension, rate: W.rate || 0 };
    }
    return { truck: this.truckId, cfg: this.build, help: this.helpOn, paint: this.myColor, lights, winch };
  }

  /** A frame while paused: friends' trucks (and voice) go on, ours stands still for them, and the picture holds. */
  pausedFrame(dt) {
    this.updateRemotes(dt);
    this.voice?.update();
    this.updateRemoteRopes();
    if (this.net) {
      // our truck as it stands, told as still (it keeps its speed for when the game goes on)
      const v = this.vehicle;
      this._still = this._still || { vel: new THREE.Vector3(), angVel: new THREE.Vector3() };
      this.net.sendState(dt, Object.create(v, { vel: { value: this._still.vel }, angVel: { value: this._still.angVel } }), this.netExtra(this.lightsOn || this.renderer.night));
    }
    if (!this.noRender) this.renderer.render();
  }

  /** Watch the frame rate; step the graphics down if it can't keep up. */
  perf(dt) {
    const p = this.perfState || (this.perfState = { t: 0, n: 0, sum: 0, fps: 60, grace: 6 });
    p.t += dt; p.n++; p.sum += dt;
    if (p.t < 4) return;
    p.fps = p.n / p.sum;
    p.t = 0; p.n = 0; p.sum = 0;
    if (p.grace > 0) { p.grace -= 4; return; }
    if (this.settings.autoQuality !== false && p.fps < 32 && this.settings.quality !== 'low' && !this.noRender) {
      this.settings.quality = this.settings.quality === 'high' ? 'medium' : 'low';
      this.applyQuality();
      this.hud.toast(`Graphics set to ${this.settings.quality} to keep it smooth (Esc to change)`, false, 5);
      this.onSettingsChanged?.();
      p.grace = 8;
    }
  }

  applyQuality() {
    const q = this.settings.quality || 'high';
    this.renderer.setQuality(q);
    this.vegetation.setDetailRange(q === 'high' ? 340 : q === 'medium' ? 240 : 150);
    this.terrain.split = q === 'high' ? 2.1 : q === 'medium' ? 1.8 : 1.5;
    this.terrain.setQuality(q);
    this.grass.setQuality(q);
    this.tea?.setQuality(q);
  }

  updateRemoteRopes() {
    this.remoteRopes = this.remoteRopes || new Map();
    const used = new Set();
    for (const rv of this.remotes.values()) {
      const w = rv.state?.winch;
      if (!w) continue;
      used.add(rv.id);
      let rope = this.remoteRopes.get(rv.id);
      if (!rope) { rope = new this.rope.constructor(this.scene); this.remoteRopes.set(rv.id, rope); }
      const root = rv.model.root;
      const a = new THREE.Vector3(...w.f).applyQuaternion(root.quaternion).add(root.position);
      let b;
      if (w.to === 'tree') b = new THREE.Vector3(...w.a);
      else if (w.to === this.net.id) b = new THREE.Vector3(...w.a).applyQuaternion(this.model.root.quaternion).add(this.model.root.position);
      else { const t = this.remotes.get(w.to); if (!t) { rope.update(null); continue; } b = new THREE.Vector3(...w.a).applyQuaternion(t.model.root.quaternion).add(t.model.root.position); }
      rope.update(a, b, w.len - a.distanceTo(b));
    }
    for (const [id, rope] of this.remoteRopes) if (!used.has(id)) rope.update(null);
  }
}

export { MAP_HALF, SURFACES };
