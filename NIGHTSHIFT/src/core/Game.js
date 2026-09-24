// Game: orchestrates every system. Gameplay state (GameState / VehicleState / WorldState) is
// kept separate from rendering so a server-authoritative multiplayer mode can be added later.
import * as THREE from 'three';
import { bus } from './EventBus.js';
import { InputManager } from './Input.js';
import { clamp, lerp, damp, formatMoney } from './util.js';
import { Materials } from '../renderer/Materials.js';
import { Environment } from '../renderer/Environment.js';
import { Effects } from '../renderer/Effects.js';
import { WorldManager } from '../world/WorldManager.js';
import { SAFEHOUSES, SHOPS, lineHalfWidth } from '../world/CityLayout.js';
import { Pedestrians } from '../world/Pedestrians.js';
import { Debris } from '../world/Debris.js';
import { Progression } from '../progression/Progression.js';
import { Vehicle } from '../vehicles/Vehicle.js';
import { CARS, tunedParams } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { CameraController, CAMERA_MODES } from '../camera/CameraController.js';
import { PhotoMode } from '../camera/PhotoMode.js';
import { Replay } from '../replay/Replay.js';
import { TrafficManager } from '../traffic/TrafficManager.js';
import { TrafficRenderer } from '../traffic/TrafficRenderer.js';
import { PoliceManager } from '../police/PoliceManager.js';
import { RaceManager } from '../races/RaceManager.js';
import { StreetRivals } from '../races/StreetRivals.js';
import { AudioManager } from '../audio/AudioManager.js';
import { engineSoundFor } from '../audio/EngineSynth.js';
import { MapRenderer } from '../ui/MapRenderer.js';
import { HUD } from '../ui/HUD.js';
import { UIManager } from '../ui/UIManager.js';
import { Garage } from '../ui/Garage.js';
import { NetworkClient } from '../networking/NetworkClient.js';
import { QUALITY_LABELS, QUALITY_LEVELS } from './QualityManager.js';

export class GameState {
  constructor() { this.mode = 'loading'; this.time = 0; this.distance = 0; }
}

const KIND_SOUND = { building: 'wall', wall: 'wall', barrier: 'barrier', rail: 'barrier', container: 'heavy', pillar: 'wall', pole: 'light', tree: 'light' };

export class Game {
  constructor({ settings, save, quality, rm, assets, lib, preset }) {
    Object.assign(this, { settings, save, quality, rm, assets, lib, preset });
    this.state = new GameState();
    this.safehouses = SAFEHOUSES;
    this.gps = null;
    this.fps = 0; this.frameMs = 16; this.frames = 0; this.fpsT = 0;
    this.showDev = false;
    this.fx2 = { speed: 0, nitro: 0, damageFlash: 0, busted: 0, bloomScale: 1 };
    this.weatherT = 120 + Math.random() * 200;
    this.signalMemo = new Set();
  }

  async init(progress) {
    const preset = this.preset;
    const r = this.rm.renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.2, 6000);
    this.rm.camera = this.camera;
    progress(0.02, 'Generating materials...');
    await tick();
    this.materials = new Materials(preset);
    progress(0.2, 'Building environment...');
    await tick();
    this.env = new Environment(this.scene, r, preset);
    this.env.onChange((st) => this.materials.applyEnvironment(st));
    this.applyTime(); this.applyWeather(true);
    this.materials.applyEnvironment(this.env.state);
    progress(0.26, 'Planning city...');
    await tick();
    this.world = new WorldManager();
    this.world.initVisuals(this.scene, this.materials, preset);
    this.mapRenderer = new MapRenderer(this.world.layout, this.world.planner);
    progress(0.32, 'Building lane graph...');
    await tick();
    this.traffic = new TrafficManager(this.world, preset, null);
    // player
    progress(0.36, 'Spawning car...');
    this.input = new InputManager(this.settings);
    this.camCtl = new CameraController(this.camera, this.settings);
    this.camCtl.world = this.world;
    this.spawnPlayer();
    // nearby roads & buildings first, then the rest streams in during play
    progress(0.4, 'Loading nearby streets...');
    const p = this.player.state;
    await this.world.chunks.preload(new THREE.Vector3(p.x, 0, p.z), Math.min(preset.viewDistance, 520), (k) => progress(0.4 + k * 0.5, 'Loading city...'));
    this.world.props.rebuild(this.world.chunks.nearKeys, preset.props);
    this.world.lights.rebuild(this.world.chunks.nearKeys, this.world.chunks.nearPos);
    progress(0.92, 'Starting systems...');
    this.fx = new Effects(this.scene, preset);
    // ~1 in 7 manholes vents steam (deterministic by position)
    this.fx.setSteamSources(this.world.planner.props.filter((q) => q.type === 'manhole' && ((Math.floor(q.x * 7.31 + q.z * 3.17) % 7) + 7) % 7 === 0));
    this.debris = new Debris(this.scene, this.world.props.defs, (x, z) => this.world.layout.groundHeight(x, z), 40);
    this.police = new PoliceManager(this);
    try { this.police.prewarm(); } catch (e) { console.warn('[Game] police prewarm failed', e); }
    this.races = new RaceManager(this);
    this.rivals = new StreetRivals(this);
    this.peds = new Pedestrians(this.scene, this.world.layout, preset.pedestrians);
    this.audio = new AudioManager(this.settings.audio);
    this.progress = new Progression(this);
    this.hud = new HUD(document.getElementById('hud'), this.mapRenderer, this.settings);
    this.ui = new UIManager(this);
    this.photo = new PhotoMode(this);
    this.replay = new Replay(this);
    this.garage = new Garage(this);
    this.net = new NetworkClient(this);
    this.net.connect().catch(() => {});
    this._wireEvents();
    this._wireAudioUnlock();
    await this.rm.setupPost(this.scene, this.camera);
    this.camCtl.snap(this.player);
    progress(1, 'Ready');
  }

  onModelsReady(promise) {
    const attach = () => {
      if (this.traffic.renderer) return;
      const types = ['sedan', 'suv', 'van', 'truck', 'bus'].filter((t) => this.lib.has(t));
      if (!types.length) return;
      this.trafficRenderer = new TrafficRenderer(this.scene, this.lib, types, Math.max(12, Math.ceil(this.preset.traffic * 0.8)));
      this.traffic.setRenderer(this.trafficRenderer);
      this.traffic.enabled = true;
    };
    if (['sedan', 'suv', 'van', 'truck', 'bus'].every((t) => this.lib.has(t))) attach();
    else promise.then(attach);
  }

  // ------------------------------------------------------------------ player
  spawnPlayer(at) {
    const id = this.save.data.currentCar;
    const car = CARS[id];
    const data = this.save.data.cars[id];
    const params = tunedParams(id, data.upgrades);
    if (this.player) this.player.dispose();
    this.player = new Vehicle({ carId: id, params, world: this.world, lib: this.lib, role: 'player', carType: car.carType, renderOpts: { headlights: this.preset.headlightSpots, shadow: this.preset.shadows !== 'off', lodDistance: 1e9 } });
    this.player.renderer.applyCustom(data.custom);
    this.player.renderer.enableDents();
    this.scene.add(this.player.renderer.group);
    const spot = at || this._laneSpot(SAFEHOUSES[0].x, SAFEHOUSES[0].z);
    this.player.place(spot.x, spot.z, spot.yaw);
    this.player.state.nitro = 1;
  }

  _laneSpot(x, z) {
    const n = this.traffic.graph.nearest(x, z, (l) => !l.ring);
    if (!n) return { x, z, yaw: 0 };
    return { x: n.x, z: n.z, yaw: Math.atan2(n.dx, n.dz) };
  }

  // put an AI vehicle back on the nearest lane (only when the camera can't see the jump)
  recoverAI(vehicle, ai) {
    ai.needsReset = false;
    const s = vehicle.state;
    if (Math.hypot(s.x - this.camera.position.x, s.z - this.camera.position.z) < 45) return false;
    const spot = this._laneSpot(s.x, s.z);
    vehicle.place(spot.x, spot.z, spot.yaw);
    return true;
  }

  resetPlayer() {
    const s = this.player.state;
    const spot = this._laneSpot(s.x, s.z);
    this.player.place(spot.x, spot.z, spot.yaw);
    this.camCtl.snap(this.player);
  }

  // ------------------------------------------------------------------ settings
  applyTime() {
    const t = this.settings.graphics.timeOfDay;
    this.env.setTimeMode(t);
  }
  applyWeather(force = false) {
    const w = this.settings.graphics.weather;
    if (w === 'auto') this.env.setWeather(this.env.targetWeather || 'clear');
    else this.env.setWeather(w);
    if (force) this.env.update(0, new THREE.Vector3(), true);
  }
  applyGraphicsSettings() {
    const level = this.quality.resolveLevel();
    const p = this.quality.apply(level);
    this.applyPreset(p);
    this.ui?.toast(`Graphics: ${QUALITY_LABELS[level]}`);
  }
  applyPreset(p, silent = false) {
    this.preset = p;
    this.rm.applyPreset(p);
    this.env.applyPreset(p);
    this.world.setPreset(p);
    this.traffic.preset = p;
    this.materials.preset = p;
    this.materials.applyEnvironment(this.env.state);
    if (this.peds) this.peds.max = Math.min(p.pedestrians, this.peds.meshTorso.instanceMatrix.count);
    void silent;
  }

  // ------------------------------------------------------------------ events
  _wireEvents() {
    bus.on('traffic:hit', (e) => {
      const s = this.player.state;
      if (e.impact > 2) {
        this.fx.impact(e.x, 0.7, e.z, e.nx, e.nz, clamp(e.impact / 20, 0, 1), s.vx, s.vz);
        this.audio.playEvent('collision', { intensity: clamp(e.impact / 20, 0, 1), type: 'traffic', position: { x: e.x, y: 0.5, z: e.z } });
        this.camCtl.addShake(clamp(e.impact / 25, 0, 0.8));
        this.input.rumble(0.8, 0.5, 200);
        this._dentPlayer(e.x, e.z, clamp(e.impact / 25, 0, 1));
        if (e.impact > 6) { this.police.reportInfraction('hitCivilian', 1); this.progress.chain.crash(); }
      }
    });
    // knocked-over street furniture (any physics vehicle can do it)
    bus.on('prop:break', (e) => {
      const p = e.p;
      if (!p) return;
      this.debris.spawn(p, e.vx, e.vz, e.speed);
      const lamp = p.type === 'lamp';
      const k = clamp(e.speed / 30, 0.2, 1), sp = e.speed || 1;
      this.fx.impact(p.x, lamp ? 0.9 : 0.4, p.z, -e.vx / sp, -e.vz / sp, lamp ? k : k * 0.25, e.vx, e.vz);
      this.audio.playEvent('collision', { intensity: k, type: lamp ? 'pole' : 'barrier', position: { x: p.x, y: 0.5, z: p.z } });
      const s = this.player.state;
      if (Math.hypot(p.x - s.x, p.z - s.z) < 7) {
        this.camCtl.addShake(lamp ? 0.3 * k : 0.04);
        this.input.rumble(lamp ? 0.6 : 0.2, 0.3, lamp ? 160 : 60);
        if (lamp) this.police.reportInfraction('vandalism', 0.5);
      }
    });
    bus.on('prop:restore', (cs) => this.debris.restore(cs.map((c) => c.prop).filter(Boolean)));
    bus.on('traffic:nearMiss', () => { this.player.state.nitro = Math.min(1, this.player.state.nitro + 0.1); });
    bus.on('traffic:honk', (e) => this.audio.playEvent('horn', { position: { x: e.x, y: 0.5, z: e.z } }));
    bus.on('police:pursuit', (e) => { this.hud.message('PURSUIT', `${e.reason?.toUpperCase?.() || ''} · HEAT ${e.heat}`, 2.2, true); this.audio.playEvent('heatUp'); });
    bus.on('police:heat', (e) => { this.hud.message(`HEAT ${e.heat}`, '', 2, true); this.audio.playEvent('heatUp'); });
    bus.on('police:roadblock', () => this.ui.toast('ROADBLOCK REPORTED AHEAD', 'err', 3));
    bus.on('police:intercept', () => this.ui.toast('Units moving to intercept', '', 2));
    bus.on('police:cooldown', () => this.ui.toast('Out of sight — COOLDOWN', '', 2));
    bus.on('police:spotted', () => this.ui.toast('SPOTTED!', 'err', 1.5));
    bus.on('police:disabled', () => { this.ui.toast('POLICE UNIT DISABLED +$500', 'cash', 2); });
    bus.on('police:escaped', (e) => {
      this.hud.message('ESCAPED', `BOUNTY ${formatMoney(e.reward)}`, 3.5);
      this.audio.playEvent('escaped');
      this.save.addCash(e.reward, 'escape');
      this.save.addRep(Math.round(e.heat * 60));
      this.save.data.escapes++;
      this.save.data.bestHeat = Math.max(this.save.data.bestHeat, e.heat);
      this.save.save();
    });
    bus.on('police:busted', (e) => this._busted(e));
    bus.on('race:countdown', () => {});
    bus.on('race:count', (e) => { this.hud.message(String(e.n), '', 0.9); this.audio.playEvent('countdown', { final: false }); });
    bus.on('race:go', () => { this.hud.message('GO!', '', 1); this.audio.playEvent('countdown', { final: true }); });
    bus.on('race:checkpoint', (e) => {
      this.audio.playEvent('checkpoint');
      if (e.speed) this.hud.message(`${Math.round(e.speed)} KM/H`, 'SPEEDTRAP', 1.2, true);
      else if (e.bonus) this.hud.message(`+${e.bonus}s`, `CHECKPOINT ${e.gate}/${e.total}`, 1.2, true);
    });
    bus.on('race:lap', (e) => this.hud.message(`LAP ${e.lap}/${e.laps}`, '', 1.5, true));
    bus.on('race:finished', (r) => {
      this.audio.playEvent('raceFinish');
      if (r.reward) { r.reward = Math.round(r.reward * this.progress.rewardMult); this.save.addCash(r.reward, 'race'); }
      if (r.rep) this.save.addRep(r.rep);
      if (r.win) this.save.data.raceWins++;
      const best = this.save.data.racesCompleted[r.def.id];
      if (!r.failed && !r.def.street && (!best || r.time < best)) this.save.data.racesCompleted[r.def.id] = r.time;
      this.save.save();
      this.hud.message(r.failed ? 'FAILED' : r.win ? 'WINNER' : 'FINISHED', r.detail || '', 2.2);
      setTimeout(() => { if (this.state.mode === 'drive') { this.state.mode = 'results'; this.ui.showResults(r); this.audio.setPaused(true); } }, 1800);
    });
    bus.on('race:aborted', () => this.ui.toast('Event abandoned'));
    // progression announcements
    bus.on('progress:level', (e) => {
      const cars = e.unlocked.map((id) => CARS[id]?.name).filter(Boolean);
      this.hud.message(`LEVEL ${e.level}`, cars.length ? `NEW CAR UNLOCKED · ${cars.join(' · ').toUpperCase()}` : 'DRIVER LEVEL UP', 3.2);
      for (const n of cars) this.ui.toast(`UNLOCKED: ${n} — buy it in the GARAGE`, 'cash', 5);
      this.audio?.playEvent('raceFinish');
    });
    bus.on('mission:complete', ({ mission, reward }) => {
      this.hud.message('MISSION COMPLETE', mission.name.toUpperCase(), 3);
      this.ui.toast(`${mission.name}: ${this.progress.rewardText(reward)}`, 'cash', 5);
      if (reward.car) this.ui.toast(reward.gift ? `${CARS[reward.car]?.name} is waiting in your garage` : `UNLOCKED: ${CARS[reward.car]?.name} — buy it in the GARAGE`, 'cash', 6);
      this.audio?.playEvent('checkpoint');
    });
    bus.on('progress:speed', (e) => this.ui.toast(`${e.kmh} KM/H CLUB +${e.xp} XP`, '', 2.5));
    bus.on('style:bank', (e) => { if (e.xp >= 5) this.ui.toast(`STYLE ${e.score.toLocaleString()} (x${e.mult}) · +${e.xp} XP${e.cash ? ` · +${formatMoney(e.cash)}` : ''}`, 'cash', 2.4); });
    bus.on('style:lost', () => this.ui.toast('CHAIN LOST', 'err', 1.4));
    bus.on('progress:cash', (e) => { if (e.delta > 0 && e.reason) this.ui?.toast(`+${formatMoney(e.delta)}`, 'cash', 2); });
    bus.on('renderer:fallback', (e) => setTimeout(() => this.ui?.toast(`WebGPU unavailable — using WebGL2 (${e.reason.slice(0, 60)})`, '', 5), 500));
    bus.on('settings:changed', (e) => { if (e.section === 'audio') this.audio?.applySettings(this.settings.audio); });
    addEventListener('keydown', (e) => { if (e.code === 'F11') { e.preventDefault(); this.toggleFullscreen(); } });
    addEventListener('beforeunload', () => { this._persistPosition(); this.save.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state.mode === 'drive') this.pause(); });
  }

  _wireAudioUnlock() {
    const unlock = async () => {
      if (this.audioReady) return;
      this.audioReady = true;
      try { await this.audio.init(); this.audio.applySettings(this.settings.audio); this.audio.setMusic(true); } catch (e) { console.warn('[Audio] init failed', e); }
    };
    addEventListener('pointerdown', unlock, { once: false });
    addEventListener('keydown', unlock, { once: false });
  }

  _dentPlayer(wx, wz, strength) {
    const s = this.player.state;
    const dx = wx - s.x, dz = wz - s.z;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c; // world -> car local (x left, z fwd)
    this.player.renderer.dent(lx, lz, strength);
    this.player.renderer.setDamageLook(s.damage);
    this.fx2.damageFlash = Math.max(this.fx2.damageFlash, strength * 0.6);
  }

  _busted(e) {
    this.state.mode = 'busted';
    this.bustT = 0;
    this.hud.message('BUSTED', `POLICE ARREST · FINE ${formatMoney(e.fine)}`, 4.5);
    this.audio.playEvent('busted');
    this.camCtl.cinematic = { t: 0, r: 9, h: 3.5 };
    this.save.addCash(-e.fine);
    this.save.data.busts++;
    if (this.races.active) this.races.abort();
    this.save.save();
  }

  // ------------------------------------------------------------------ modes
  start() {
    this.state.mode = 'menu';
    this.ui.showMainMenu();
    this.camCtl.cinematic = { t: 0, r: 8, h: 2.2 };
    this.last = performance.now();
    this.rm.renderer.setAnimationLoop(() => this._frame());
  }
  play() {
    this.ui.clear();
    this.state.mode = 'drive';
    this.camCtl.cinematic = null;
    this.camCtl.mode = this.settings.gameplay.defaultCamera ?? 1;
    this.camCtl.snap(this.player);
    document.getElementById('hud').classList.remove('hidden');
    this.audio.setPaused(false);
    this.ui.toast('Find events on the map (M). Drive into a glowing ring and press E.', '', 5);
  }
  pause() {
    if (this.state.mode !== 'drive') return;
    this.state.mode = 'paused';
    this.audio.setPaused(true);
    this.ui.showPause();
  }
  resume() {
    this.ui.clear();
    this.state.mode = 'drive';
    this.audio.setPaused(false);
    document.getElementById('hud').classList.remove('hidden');
  }
  toMainMenu() {
    this.races.abort();
    this.rivals.clear();
    this.police.clearAll();
    this.state.mode = 'menu';
    document.getElementById('hud').classList.add('hidden');
    this.camCtl.cinematic = { t: 0, r: 8, h: 2.2 };
    this.audio.setPaused(false);
    this.ui.showMainMenu();
  }
  openMap() { if (this.state.mode !== 'drive') return; this.state.mode = 'map'; this.audio.setPaused(true); this.ui.showMap(false); }
  closeMap() { this.resume(); }
  async openGarage() {
    this.prevMode = this.state.mode;
    this.state.mode = 'garage';
    document.getElementById('hud').classList.add('hidden');
    this.audio.setPaused(true);
    await this.garage.show();
  }
  closeGarage() {
    this.garage.hide();
    const prevCar = this.player.carId;
    // apply car / customization / upgrades to the driven car
    if (prevCar !== this.save.data.currentCar) {
      const s = this.player.state;
      this.spawnPlayer({ x: s.x, z: s.z, yaw: s.yaw });
      this.camCtl.snap(this.player);
    } else {
      const d = this.save.data.cars[prevCar];
      this.player.physics.setParams(tunedParams(prevCar, d.upgrades));
      this.player.renderer.applyCustom(d.custom);
      this.player.renderer.setDamageLook(this.player.state.damage);
    }
    this.ui.clear();
    if (this.prevMode === 'menu') { this.state.mode = 'menu'; this.ui.showMainMenu(); this.audio.setPaused(false); }
    else this.resume();
  }
  startEvent(ev) {
    this.ui.clear();
    this.state.mode = 'drive';
    this.audio.setPaused(false);
    this.police.clearAll();
    this.gps = null;
    this.player.state.nitro = 1;
    this.races.start(ev);
  }
  setGPS(x, z) {
    const L = this.world.layout;
    const s = this.player.state;
    const ids = L.route(L.nearestNode(s.x, s.z), L.nearestNode(x, z));
    this.gps = { x, z, route: [[s.x, s.z], ...ids.map((id) => [L.nodes[id].x, L.nodes[id].z]), [x, z]] };
  }
  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => this.ui.toast('Fullscreen blocked — press F11', 'err'));
  }

  async benchmark(frames = 40) {
    // render real frames at the spawn and time the work itself: on WebGL a 1-pixel readback waits for
    // the GPU to finish, so the result is not capped by the display's refresh rate
    const times = [];
    const gl = this.rm.backend === 'webgl2' ? this.rm.renderer.getContext() : null;
    const px = new Uint8Array(4);
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      this.camCtl.update(1 / 60, this.player, this.input.controls, {});
      this.world.update(1 / 60, this.camera, this.env.state);
      this.rm.render(this.scene, this.camera, 1 / 60);
      if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      else await new Promise((r) => requestAnimationFrame(r));
      if (i > 8) times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)] || 16;
  }

  // Auto-quality governor (graphics quality = AUTO only). Watches real frame times while driving: when
  // most frames miss ~40 fps it first lowers the render resolution, then drops a preset level (saved);
  // resolution comes back once there is headroom again.
  _governor(dt) {
    if (this.settings.graphics.quality !== 'auto' || this.state.mode !== 'drive' || document.hidden) return;
    const G = (this.gov ||= { t: 0, slow: 0, fast: 0, n: 0, cool: 3 });
    const ms = dt * 1000;
    if (ms > 250) return; // hitch / tab switch, not steady load
    G.cool -= dt; G.t += dt; G.n++;
    if (ms > 25) G.slow++;
    if (ms < 18) G.fast++;
    if (G.t < 4) return;
    const slow = G.slow / G.n, fast = G.fast / G.n;
    G.t = 0; G.n = 0; G.slow = 0; G.fast = 0;
    if (G.cool > 0) return;
    const rm = this.rm;
    if (slow > 0.6) {
      if ((rm.dynScale || 1) > 0.72) { rm.dynScale = Math.max(0.7, (rm.dynScale || 1) - 0.1); rm.resize(); G.cool = 3; return; }
      const i = QUALITY_LEVELS.indexOf(this.quality.level);
      if (i > 0) {
        const lvl = QUALITY_LEVELS[i - 1];
        this.settings.graphics.detectedQuality = lvl; this.settings.save();
        rm.dynScale = 1;
        this.applyPreset(this.quality.apply(lvl));
        this.ui.toast(`Graphics auto-adjusted to ${QUALITY_LABELS[lvl]}`, '', 3);
        G.cool = 8;
      }
    } else if (fast > 0.9 && (rm.dynScale || 1) < 1) {
      rm.dynScale = Math.min(1, rm.dynScale + 0.1); rm.resize(); G.cool = 6;
    }
  }

  _persistPosition() {
    const s = this.player?.state;
    if (s) this.save.data.lastPosition = { x: s.x, z: s.z, yaw: s.yaw };
  }

  // ------------------------------------------------------------------ main loop
  _frame() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    this._governor(dt);
    this.frameMs = lerp(this.frameMs, dt * 1000, 0.1);
    this.frames++; this.fpsT += dt;
    dt = Math.min(dt, 1 / 20); // avoid huge steps after tab switches
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    try { this._update(dt); } catch (e) { console.error('[Game] update error', e); if (this.rm.backend === 'webgpu' && /GPU|WebGPU|createView/i.test(String(e?.message) + String(e?.stack))) this.rm.failWebGPU(e.message); this._errCount = (this._errCount || 0) + 1; if (this._errCount < 4) this.ui?.toast(`Error: ${e.message}`, 'err', 5); }
    this.input.endFrame();
  }

  _update(dt) {
    const mode = this.state.mode;
    const input = this.input;
    input.update(dt);
    if (input.consume('dev')) this.showDev = !this.showDev;

    if (mode === 'garage') {
      this.ui.navigate(input);
      this.garage.update(dt);
      this.rm.renderer.render(this.garage.scene, this.garage.camera);
      this.audio?.update(dt);
      return;
    }

    const driving = mode === 'drive';
    const simulate = driving || mode === 'menu' || mode === 'busted';
    // global actions
    if (driving) {
      if (input.consume('pause')) this.pause();
      else if (input.consume('map')) this.openMap();
      else if (input.consume('photo') && !this.races.active) this.photo.enter();
      else if (input.consume('replay')) this.replay.enter();
      if (input.consume('camera')) this.ui.toast(`Camera: ${this.camCtl.next()}`, '', 1);
      if (input.consume('reset')) this.resetPlayer();
      if (input.consume('horn')) this.audio.playEvent('horn', { position: { x: this.player.state.x, y: 0.5, z: this.player.state.z } });
    } else if (mode === 'paused' || mode === 'map' || mode === 'brief' || mode === 'results' || mode === 'menu') {
      if (mode === 'map' && (input.consume('map') || input.consume('pause'))) this.closeMap();
      else if ((mode === 'paused' || mode === 'brief' || mode === 'results') && input.consume('pause')) this.resume();
      else if (mode === 'paused' && input.consume('photo')) this.photo.enter();
      else this.ui.navigate(input);
    }

    const player = this.player;
    const c = player.controls;
    if (driving && !(this.races.active?.state === 'finished')) {
      const ic = input.controls;
      c.throttle = ic.throttle; c.brake = ic.brake; c.steer = ic.steer; c.handbrake = ic.handbrake; c.nitro = ic.nitro;
    } else { c.throttle = 0; c.brake = mode === 'menu' ? 0 : 0.3; c.steer = 0; c.handbrake = mode === 'menu' ? 1 : 0; c.nitro = false; }

    if (simulate) {
      this.state.time += dt;
      // races may override controls during countdown
      this.races.update(dt);
      this.rivals.update(dt, driving);
      const events = player.update(dt);
      this._playerEvents(events, dt);
      // police + traffic
      this.police.update(dt, this.traffic);
      const dynamic = [player, ...this.police.vehicles(), ...this.races.vehicles(), ...this.rivals.vehicles()];
      const fwd = { x: Math.sin(player.state.yaw), z: Math.cos(player.state.yaw) };
      this.traffic.camera = this.camera;
      this.traffic.update(dt, player.state, fwd, dynamic, player);
      // player vs police
      for (const u of this.police.units) {
        const v = u.vehicle;
        if (Math.abs(v.state.x - player.state.x) > 8 || Math.abs(v.state.z - player.state.z) > 8) continue;
        const hit = VehiclePhysics.resolvePair(player.physics, v.physics);
        if (hit && hit.impact > 3) {
          this.fx.impact(hit.x, 0.7, hit.z, hit.nx, hit.nz, clamp(hit.impact / 20, 0, 1));
          this.audio.playEvent('collision', { intensity: clamp(hit.impact / 20, 0, 1), type: 'heavy', position: { x: hit.x, y: 0.5, z: hit.z } });
          this.camCtl.addShake(clamp(hit.impact / 25, 0, 0.7));
          this._dentPlayer(hit.x, hit.z, clamp(hit.impact / 25, 0, 1));
          if (this.police.state === 'idle') this.police.startPursuit(1, 'assaulting an officer');
          else this.police.reportInfraction('ramPolice');
        }
      }
      this._violations(dt);
      // nitro refill: drifting, air time, slowly over time
      const s = player.state;
      const sp = Math.hypot(s.vx, s.vz);
      if (!s.nitroActive) s.nitro = Math.min(1, s.nitro + dt * (0.012 + (s.drifting && sp > 12 ? 0.11 : 0) + (!s.onGround ? 0.08 : 0)));
      this.state.distance += sp * dt;
      this.save.data.distanceDriven += sp * dt;
      if (driving) this.progress.update(dt, player);
      if (mode === 'busted') this._bustedUpdate(dt);
      // world interaction prompts (events, garages)
      if (driving) this._interactions();
      if (driving) this.replay.record(dt);
      this.net.update(dt);
    }

    // environment & world streaming (always, so menus have a living background)
    if (this.settings.graphics.weather === 'auto') {
      this.weatherT -= dt;
      if (this.weatherT <= 0) { this.weatherT = 180 + Math.random() * 240; const r = Math.random(); this.env.setWeather(r < 0.55 ? 'clear' : r < 0.8 ? 'cloudy' : 'rain'); }
    }
    this.env.update(simulate ? dt : 0, player.renderer.group.position, false, this.camera.position);
    if (mode === 'photo') this.photo.applyExposure();
    this.world.update(dt, this.camera, this.env.state);
    // camera
    const nitroFx = player.state.nitroActive ? 1 : 0;
    this.fx2.nitro = damp(this.fx2.nitro, nitroFx, 5, dt);
    const speed = Math.hypot(player.state.vx, player.state.vz);
    this.fx2.speed = damp(this.fx2.speed, Math.pow(clamp((speed - 28) / 50, 0, 1), 1.5) * 0.55 + this.fx2.nitro * 0.35, 4, dt);
    this.fx2.damageFlash = damp(this.fx2.damageFlash, 0, 3, dt);
    this.fx2.busted = damp(this.fx2.busted, mode === 'busted' ? 1 : 0, 2, dt);
    // lens rain: builds up while it rains (not under cover), airflow sweeps it at speed
    const covered = this.world.layout.inTunnel?.(this.camera.position.x, this.camera.position.z);
    this.fx2.lensRain = damp(this.fx2.lensRain || 0, this.env.state.rain > 0.2 && !covered ? Math.min(1, this.env.state.rain) : 0, 0.6, dt);
    this.fx2.lensWind = clamp((speed - 15) / 45, 0, 1);
    if (simulate || mode === 'paused' || mode === 'map' || mode === 'brief' || mode === 'results') {
      if (simulate) this.camCtl.update(dt, player, driving ? input.controls : { lookX: 0, lookY: 0 }, this.fx2);
    }
    if (mode === 'photo') this.photo.update(dt, input);
    if (mode === 'replay') this.replay.update(dt, input);
    // sync visuals
    const camPos = this.camera.position;
    player.sync(dt, camPos, this.env.state);
    for (const u of this.police.units) u.vehicle.sync(dt, camPos, this.env.state);
    this.fx.vehicle(player, dt, this.env.state);
    for (const v of this.races.vehicles()) this.fx.vehicle(v, dt, this.env.state);
    for (const v of this.rivals.vehicles()) this.fx.vehicle(v, dt, this.env.state);
    for (const u of this.police.units) if (u.vehicle.state.drifting) this.fx.vehicle(u.vehicle, dt, this.env.state);
    if (simulate) this.fx.rainSplashes(dt, camPos, this.env.state.rain);
    if (simulate) this.fx.ambient(dt, camPos, this.env.state);
    this.fx.setLight(this.env.state.night);
    this.fx.update(simulate ? dt : 0, this.camera);
    this.debris.update(simulate ? dt : 0);
    if (this.trafficRenderer) this.trafficRenderer.update(this.replay.active ? this.replay.trafficList : this.traffic.renderList, this.camera, this.env.state.night, this.world.lights);
    this._wetReflections([player, ...this.police.vehicles(), ...this.races.vehicles(), ...this.rivals.vehicles()]);
    this.peds.update(simulate ? dt : 0, this.camera, [player, ...this.police.vehicles()], this.preset.pedestrians > 0);
    // audio
    this._audio(dt, mode);
    // render
    this.world.lights.flushReflections(this.camera);
    this.rm.fx = this.fx2;
    this.rm.render(this.scene, this.camera, dt);
    if (mode === 'photo') this.photo.afterRender();
    // UI
    if (mode !== 'menu' && mode !== 'photo' && mode !== 'replay') this.hud.update(dt, this);
    this.save.update(dt);
    this._dev();
  }

  // head/tail lamps and police bars of the simulated cars reflected in wet asphalt
  _wetReflections(vehicles) {
    const L = this.world.lights;
    if (!L.streaks.visible) return;
    const cam = this.camera.position, lightsOn = this.env.state.night > 0.35;
    for (const v of vehicles) {
      const s = v.state, p = v.p, r = v.renderer;
      if (!r || Math.hypot(s.x - cam.x, s.z - cam.z) > 140) continue;
      const sn = Math.sin(s.yaw), cs = Math.cos(s.yaw);
      const facing = (cam.x - s.x) * sn + (cam.z - s.z) * cs;
      const hl = p.length / 2 - 0.1, lat = p.width * 0.34;
      const at = (f, l) => [s.x + sn * f + cs * l, s.z + cs * f - sn * l];
      for (const side of [1, -1]) {
        if (facing > 0 && lightsOn && !r.lightsBroken?.[side > 0 ? 0 : 1]) { const [x, z] = at(hl, side * lat); L.addReflection(x, 0.7, z, 0.8, 0.74, 0.6, 0.55); }
        if (facing < 0 && (lightsOn || r.brake > 0.1)) { const [x, z] = at(-hl, side * lat); L.addReflection(x, 0.8, z, 0.7 * (0.45 + r.brake), 0.04, 0.025, 0.45); }
      }
      const pol = r.police;
      if (pol && (pol.redOn || pol.blueOn)) {
        const [x, z] = at(-0.2, pol.redOn ? 0.35 : -0.35);
        if (pol.redOn) L.addReflection(x, 1.6, z, 1.6, 0.1, 0.12, 1.1);
        else L.addReflection(x, 1.6, z, 0.25, 0.4, 1.8, 1.1);
      }
    }
  }

  _playerEvents(events, dt) {
    const s = this.player.state;
    for (const e of events) {
      if (e.type === 'gearUp' || e.type === 'gearDown') this.audio.playEvent(e.type);
      else if (e.type === 'landing') {
        this.audio.playEvent('landing', { intensity: e.intensity });
        this.fx.landing(s.x, s.y, s.z, e.intensity);
        this.camCtl.addShake(e.intensity * 0.6);
        this.input.rumble(e.intensity, e.intensity * 0.5, 180);
      } else if (e.type === 'collision') {
        const type = e.intensity > 0.45 ? 'heavy' : (KIND_SOUND[e.kind] || 'light');
        // light contacts while moving = grinding along the object: a continuous scrape, not a stream of thumps
        const sp = Math.hypot(s.vx, s.vz);
        const grinding = e.intensity < 0.18 && sp > 4 && e.kind !== 'pole' && e.kind !== 'tree';
        const already = this.scrapeT > 0;
        if (grinding) { this.scrapeT = 0.22; this.scrapeSpeed = sp; }
        if (!(grinding && already)) this.audio.playEvent('collision', { intensity: e.intensity, type, position: { x: e.x, y: 0.5, z: e.z } });
        this.fx.impact(e.x, 0.6, e.z, e.nx, e.nz, e.intensity, s.vx, s.vz);
        this.camCtl.addShake(e.intensity * 0.8);
        this.input.rumble(e.intensity, e.intensity, 150);
        if (e.intensity > 0.15) this._dentPlayer(e.x, e.z, e.intensity);
        if (e.intensity > 0.3) this.progress.chain.crash();
      }
    }
    void dt;
  }

  // red-light running near police
  _violations() {
    const s = this.player.state;
    const sp = Math.hypot(s.vx, s.vz);
    if (sp < 9) return;
    const L = this.world.layout;
    const k = Math.round(s.x / 160), l = Math.round(s.z / 160);
    const n = L.nodeMap.get(`${k * 160},${l * 160}`);
    if (!n || !n.signal) return;
    const inside = Math.abs(s.x - n.x) < lineHalfWidth(n.k) && Math.abs(s.z - n.z) < lineHalfWidth(n.l);
    const key = n.id;
    if (!inside) { this.signalMemo.delete(key); return; }
    if (this.signalMemo.has(key)) return;
    this.signalMemo.add(key);
    const axis = Math.abs(s.vx) > Math.abs(s.vz) ? 'x' : 'z';
    if (this.world.signalState(n.id, axis) === 'red') this.police.reportInfraction('redLight', 1);
  }

  _interactions() {
    const s = this.player.state;
    const sp = Math.hypot(s.vx, s.vz);
    let prompt = null;
    const ev = this.races.nearbyEvent(s.x, s.z);
    if (ev && !this.police.inPursuit) {
      prompt = `<b>${ev.def.name}</b> · ${ev.def.type.toUpperCase()} · press <span class="key">E</span> / <span class="key">A</span>`;
      if (sp < 6 && this.input.consume('event')) { this.state.mode = 'brief'; this.audio.setPaused(true); this.lib.load(this.races.rivalPool(), 4); this.ui.showBriefing(ev); }
    }
    const rival = !prompt && !this.police.inPursuit && !this.races.active ? this.rivals.nearest() : null;
    if (rival) {
      prompt = `<b style="color:${rival.crew.color}">${rival.crew.name.toUpperCase()}</b> · ${CARS[rival.carId].name} · press <span class="key">E</span> / <span class="key">A</span> to call them out`;
      if (this.input.consume('event')) this.rivals.challenge(rival);
    }
    if (!prompt && !this.police.inPursuit && !this.races.active) {
      for (const g of [...SAFEHOUSES, ...SHOPS]) {
        if (Math.hypot(g.x - s.x, g.z - s.z) < 18) {
          prompt = `<b>${g.name}</b> · press <span class="key">E</span> to enter the garage`;
          if (sp < 6 && this.input.consume('event')) this.openGarage();
          break;
        }
      }
    }
    if (this.input.consume('garage') && !this.police.inPursuit && !this.races.active && sp < 3) this.openGarage();
    // GPS arrival
    if (this.gps && Math.hypot(this.gps.x - s.x, this.gps.z - s.z) < 25) { this.gps = null; this.ui.toast('Destination reached'); }
    this.hud.setPrompt(prompt);
  }

  _bustedUpdate(dt) {
    this.bustT += dt;
    if (this.bustT > 4.5) {
      this.camCtl.cinematic = null;
      this.player.state.damage = 0;
      this.player.renderer.repair();
      const spot = this._laneSpot(SAFEHOUSES[0].x, SAFEHOUSES[0].z);
      this.player.place(spot.x, spot.z, spot.yaw);
      this.police.clearAll();
      this.camCtl.snap(this.player);
      this.state.mode = 'drive';
      this.ui.toast('Released from custody. Back to the streets.', '', 3);
    }
  }

  _audio(dt, mode) {
    const a = this.audio;
    if (!a || !this.audioReady) return;
    const cam = this.camera;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    a.setListener({ position: cam.position, forward: fwd, up });
    const s = this.player.state, p = this.player.p;
    this.scrapeT = (this.scrapeT || 0) - dt;
    a.setScrape?.(this.scrapeT > 0 && mode === 'drive' ? clamp(0.35 + (this.scrapeSpeed || 0) / 40, 0.35, 1) : 0, this.scrapeSpeed || 0);
    if (mode !== 'garage') {
      a.setPlayerEngine({
        rpm: s.rpm, idleRpm: p.idle, redline: p.redline, throttle: s.throttle, load: s.throttle, speed: Math.abs(s.speed), gear: s.gear,
        nitro: s.nitroActive, skid: s.drifting ? clamp(s.slip * 1.6, 0.3, 1) : this.player.physics.lastWheelspin > 0.3 ? 0.6 : (s.brake > 0.8 && Math.abs(s.speed) > 20 ? 0.5 : 0),
        onGround: s.onGround, damage: s.damage, carType: engineSoundFor(this.player.carId, this.player.carType),
      });
    }
    if (this.nitroWas !== s.nitroActive) { a.playEvent(s.nitroActive ? 'nitroStart' : 'nitroEnd'); this.nitroWas = s.nitroActive; }
    a.setSirens(this.police.sirenList());
    const near = this.traffic.cars.filter((t) => t.dist < 80).sort((x, y) => x.dist - y.dist).slice(0, 6).map((t) => ({ id: t.id, position: { x: t.x, y: 0.5, z: t.z }, speed: t.v }));
    a.setTraffic(near);
    a.setEnvironment({ rain: this.env.state.rain, speed: Math.abs(s.speed), night: this.env.state.night > 0.5, district: this.world.districtAt(s.x, s.z).id });
    a.setMusicIntensity(this.police.inPursuit ? 1 : this.races.active ? 0.7 : 0.3);
    a.update(dt);
  }

  _dev() {
    const show = this.showDev || this.settings.graphics.showFps;
    if (!show) { this.ui.updateDev('', false); return; }
    this.devT = (this.devT || 0) + 1;
    if (this.devT % 10) return;
    if (!this.showDev) { this.ui.updateDev(`${this.fps.toFixed(0)} FPS`, true); return; }
    const i = this.rm.info();
    const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB JS heap` : 'n/a';
    const ch = this.world.chunks.stats;
    const s = this.player.state;
    this.ui.updateDev([
      `NIGHTSHIFT dev · ${this.rm.backend.toUpperCase()} · ${QUALITY_LABELS[this.quality.level]} · ${this.quality.gpu.renderer}`,
      `FPS ${this.fps.toFixed(0)}  frame ${this.frameMs.toFixed(1)} ms`,
      `engine audio: ${this.audio?.engine?.useWorklet ? 'PHYSICAL MODEL' : 'oscillator (fallback)'}`,
      `draw calls ${i.calls}  triangles ${(i.triangles / 1000).toFixed(0)}k  textures ${i.textures}  geometries ${i.geometries}`,
      `memory ${mem}  est. GPU tex ${(i.textures * this.preset.textureSize * this.preset.textureSize * 4 / 1048576 * 0.3).toFixed(0)} MB`,
      `chunks loaded ${ch.loaded} detailed ${ch.detailed} pending ${ch.pending ?? 0}  props ${this.world.props.count()}`,
      `traffic ${this.traffic.count()}  police ${this.police.count()} (heat ${this.police.heat}, ${this.police.state})  peds ${this.peds.count()}  particles ${this.fx.particleCount}`,
      `pos ${s.x.toFixed(0)}, ${s.z.toFixed(0)}  speed ${(Math.abs(s.speed) * 3.6).toFixed(0)} km/h  gear ${s.gear}  rpm ${s.rpm.toFixed(0)}  slip ${s.slip.toFixed(2)}  dmg ${(s.damage * 100).toFixed(0)}%`,
      `camera ${CAMERA_MODES[this.camCtl.mode].name}  time ${this.env.hour.toFixed(1)}h  weather ${this.env.weather}`,
    ].join('\n'), true);
  }
}

function tick() { return new Promise((r) => setTimeout(r, 0)); }
