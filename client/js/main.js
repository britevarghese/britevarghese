// STRIKEPOINT client entry: loads assets, builds the world, connects to the authoritative server and runs the frame loop.
import * as THREE from 'three';
import { createRenderer, Lighting, QUALITY, DynamicResolution } from './render/Renderer.js';
import { AssetManager, describeGLTF } from './core/AssetManager.js';
import { GameWorld } from './world/World.js';
import { Viewmodel } from './player/Viewmodel.js';
import { LocalPlayer } from './player/LocalPlayer.js';
import { Players } from './game/Players.js';
import { HUD } from './ui/HUD.js';
import { Effects } from './fx/Effects.js';
import { GameAudio } from './audio/Audio.js';
import { Net } from './net/Net.js';
import { WEAPONS } from '/shared/weapons.js';
import { PROPS, groundHeight, roadDistance, BUILDINGS, FLAGS, setActiveMap, ACTIVE_MAP } from '/shared/map.js';
import { Lobby, inviteLink, Stats, mapArt } from './ui/Lobby.js';
import { TouchControls, isTouchDevice } from './ui/TouchControls.js';
import { EYE_HEIGHT } from '/shared/world.js';
import { bulletPath } from '/shared/ballistics.js';
import { hitCapsules, rayCapsule } from '/shared/weapons.js';
import { RoyaleClient } from './royale/Royale.js';
import { ScopeOverlay } from './ui/ScopeOverlay.js';
import { detectGPU, adviceFor } from './render/GPU.js';
import { VehiclesClient } from './vehicles/Vehicles.js';

const $ = (id) => document.getElementById(id);
const AUTO = new URLSearchParams(location.search);
const showError = (m) => { $('errors').textContent += `${m}\n`; };
addEventListener('error', (e) => showError(`JS error: ${e.message}`));

// per-system CPU time (ms, smoothed) — shown in the corner with ?perf=1, readable as window.__perf
class FrameProfiler {
  constructor() { this.avg = {}; window.__perf = this.avg; }
  begin() { this.t = performance.now(); this.t0 = this.t; }
  mark(name) { const n = performance.now(); this.avg[name] = (this.avg[name] ?? 0) * 0.95 + (n - this.t) * 0.05; this.t = n; }
  end() { this.avg.total = (this.avg.total ?? 0) * 0.95 + (performance.now() - this.t0) * 0.05; }
  report() { return Object.entries(this.avg).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · '); }
}

// full-screen loading art with a real progress bar (stages of Game.start) and tips
const TIPS = [
  'Keep moving! The ring of fire shrinks over time — don\'t get caught outside.',
  'A pistol is a last resort: past 40 m its rounds drop and spread. Close in or switch weapons.',
  'Flags under attack can\'t be spawned on. Deploy at HQ or a quiet flag instead.',
  'Tanks shrug off rifle fire. Use grenades, the tank gun or helicopter rockets.',
  'Motorbike riders and the jeep\'s roof gunner sit in the open — they can be shot.',
  'Medics heal faster and patch up teammates within a few metres. Stick together.',
  'Support soldiers carry double ammo and resupply the squad around them.',
  'Hold SHIFT while scoped to steady your breathing. PgUp / PgDn change sight zeroing.',
  'Bailing out of a helicopter in the air is a long fall. Land first.',
  'The enemy HQ is a restricted area — stay out or take damage.',
];
class LoadScreen {
  constructor(room) {
    const royale = room.mode === 'royale';
    this.el = $('loadscreen');
    this.el.querySelector('.ls-bg').style.backgroundImage = `url(${mapArt(room.map)})`;
    $('ls-mode').textContent = royale ? 'BATTLE ROYALE' : `CONQUEST · ${room.mapName.toUpperCase()}`;
    $('ls-tag').textContent = royale ? 'LAND / LOOT / SURVIVE / WIN' : 'DEPLOY / CAPTURE / HOLD / WIN';
    $('ls-slogan').textContent = royale ? 'LAST ONE STANDING' : 'HOLD THE LINE';
    $('ls-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.p = 0; this.set(4, 'Preparing the battlefield…');
    this.el.classList.remove('hidden');
    this.tipT = setInterval(() => ($('ls-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]), 6000);
  }
  set(p, text) { this.p = Math.max(this.p, p); $('ls-bar').style.width = `${this.p}%`; $('ls-pct').textContent = `${Math.round(this.p)}%`; if (text) $('ls-text').textContent = text; }
  step(s) {
    const P = { sky: 12, terrain: 22, buildings: 34, props: 44, vegetation: 56, 'soldiers & weapons': 70, 'battle royale': 80, 'preparing shaders': 88, connecting: 95 };
    const key = Object.keys(P).find((k) => s.startsWith(k));
    this.set(key ? P[key] : this.p + 2, `Loading ${s}…`);
  }
  done() { this.set(100, 'Ready'); clearInterval(this.tipT); setTimeout(() => this.el.classList.add('hidden'), 250); }
  fail() { clearInterval(this.tipT); this.el.classList.add('hidden'); }
}

class Game {
  async start({ name, team, quality, fov, room, password }) {
    // resolve the room's map before building anything: every map is generated from shared/maps/*.js
    const res = await fetch(`/api/rooms/${encodeURIComponent(room)}`);
    if (!res.ok) throw new Error('Room not found (it may have closed). Pick another one.');
    this.room = await res.json();
    setActiveMap(this.room.map);
    const loader = new LoadScreen(this.room);
    this.qualityName = quality;
    const { renderer, q } = createRenderer($('game'), quality);
    this.renderer = renderer; this.q = q;
    // laptops can switch GPU (or the driver resets) mid-game: rejoin the same room instead of freezing on a black screen
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showError('Graphics card switched / driver reset — reloading…');
      setTimeout(() => { location.href = `/?room=${encodeURIComponent(this.room.id)}&autojoin=1`; }, 1500);
    });
    renderer.info.autoReset = false; // count world + viewmodel + shadow passes per frame
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 1600);
    this.assets = await new AssetManager(renderer).init();
    this.assets.anisotropy = q.anisotropy;
    const progress = (s) => { $('loading').textContent = `Loading ${s}…`; loader.step(s); };
    progress('sky');
    this.world = new GameWorld(this.assets, renderer, quality);
    this.lighting = new Lighting(this.world.scene, q);
    renderer.toneMappingExposure = this.lighting.exposure;
    // nothing beyond the fog is visible, so don't draw it
    this.camera.far = this.world.scene.fog.far + 60;
    this.camera.updateProjectionMatrix();
    this.dynres = new DynamicResolution(renderer, q);
    const hd = await this.assets.loadHDRI(renderer);
    this.lighting.setEnvironment(hd.env, hd.background);
    this.env = hd.env;
    await this.world.build(progress);
    progress('soldiers & weapons');
    this.audio = new GameAudio();
    this.effects = new Effects(this.world.scene, q, this.audio);
    for (const p of PROPS) if (p.type === 'car' && p.burnt) this.effects.addAmbientSmoke(p.x, groundHeight(p.x, p.z) + 0.8, p.z);
    for (const b of BUILDINGS) if (b.damage > 0.5) this.effects.addAmbientSmoke(b.x + b.w * 0.3, groundHeight(b.x, b.z) + 1, b.z - b.d * 0.3);
    // character + weapons (source of truth: imported GLBs)
    const charLoaded = await this.assets.loadCharacter('soldier');
    describeGLTF('CHARACTER soldier', charLoaded.gltf, charLoaded.file);
    this.weaponLoads = {};
    for (const id of Object.keys(WEAPONS)) this.weaponLoads[id] = await this.assets.loadWeapon(WEAPONS[id].visual);
    this.grenadeAsset = (await this.assets.loadWeapon('grenade')).gltf;
    this.grenadeMeshes = new Map();
    for (const [id, l] of Object.entries(this.weaponLoads)) describeGLTF(`WEAPON ${id}`, l.gltf, l.file);
    this.viewmodel = new Viewmodel(this.assets, charLoaded, this.weaponLoads.ar, 'ar', renderer, { quality });
    this.hud = new HUD();
    this.scope = new ScopeOverlay();
    this.players = new Players(this);
    this.me = new LocalPlayer(this);
    this.vehicles = new VehiclesClient(this);
    this.isTouch = isTouchDevice();
    this.board = new Map();
    this.net = new Net();
    this.#bindNet();
    this.#bindUI();
    if (this.room.mode === 'royale') { progress('battle royale'); this.royale = new RoyaleClient(this); await this.royale.ready; }
    if (this.isTouch) this.touch = new TouchControls(this);
    // compile every shader now instead of stuttering the first time something appears on screen
    progress('preparing shaders');
    try {
      await renderer.compileAsync?.(this.world.scene, this.camera);
      await renderer.compileAsync?.(this.viewmodel.scene, this.viewmodel.camera);
    } catch (e) { console.warn('shader precompile', e); }
    progress('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    await this.net.connect(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room.id)}`);
    const joined = new Promise((resolve, reject) => { this._joinOk = resolve; this._joinFail = reject; });
    this.net.send({ t: 'join', room: this.room.id, password, name, team, cls: this.hud.selectedClass });
    await joined;
    loader.done();
    Stats.add({ matches: 1, xp: 25 });
    $('hud-name').textContent = name;
    history.replaceState(null, '', `/?room=${encodeURIComponent(this.room.id)}`);
    $('roomtag').textContent = `ROOM ${this.room.id} · ${ACTIVE_MAP.name.toUpperCase()}`;
    $('menu').classList.add('hidden');
    this.hud.show(true);
    addEventListener('resize', () => this.#resize());
    this.clock = new THREE.Clock();
    this.frames = 0; this.fpsT = 0;
    renderer.setAnimationLoop(() => this.#frame());
    for (const e of this.assets.errors) showError(e);
  }

  #resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
  }

  equipLocal(wid) {
    if (!wid) return;
    this.viewmodel.setWeapon(wid === 'pistol' ? 'pistol' : wid, this.weaponLoads[wid]);
    this.viewmodel.weaponId = wid;
  }

  surfaceAt(x, z) {
    const y = this.me.s.y;
    for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b.style === 'warehouse' ? 'concrete' : 'concrete';
    if (roadDistance(x, z) < 0) return 'concrete';
    return y - groundHeight(x, z) > 0.3 ? 'metal' : 'grass';
  }

  // ---------------------------------------------------------------- networking
  #bindNet() {
    const n = this.net;
    n.on('welcome', (m) => {
      this.myId = m.id; this.myTeam = m.team; this.hud.myTeam = m.team; this.hud.meId = m.id;
      if (m.room && m.room.map !== this.room.map) { location.href = `/?room=${m.room.id}&autojoin=1`; return; }
      this._joinOk?.();
      if (this.royale) this.royale.showReady(true); else this.#showDeploy();
    });
    n.on('error', (m) => { if (this._joinFail) this._joinFail(new Error(m.msg || m.code)); else showError(m.msg || m.code); });
    n.on('mapchange', (m) => {
      // the room rotated to the next map: rebuild by reloading into the same room
      this.hud.roundEnd(`NEXT MAP: ${m.map.toUpperCase()}`);
      this.mapChanging = true;
      sessionStorage.setItem('sp_rejoin', '1');
      setTimeout(() => { location.href = `/?room=${encodeURIComponent(m.room)}&autojoin=1`; }, 1500);
    });
    n.on('board', (m) => {
      this.board = new Map(m.rows.map((r) => [r.id, r]));
      this.hud.board = m.rows;
      const me = this.board.get(this.myId); if (me) { this.myTeam = me.tm; this.hud.myTeam = me.tm; }
      for (const id of [...this.players.map.keys()]) if (!this.board.has(id)) this.players.remove(id);
      for (const p of this.players.map.values()) { const r = this.board.get(p.id); if (r) p.name = r.n; }
      if (!this.royale) this.hud.refreshDeploy(this.lastSnap?.f);
    });
    n.on('snap', (m) => {
      this.lastSnap = m;
      const me = m.me;
      this.meState = me;
      if (me.alive && this.me.alive) {
        // reconcile authoritative ammo/grenades
        me.w?.forEach((w, i) => { const l = this.me.weapons[i]; if (w && l && l.id === w.id) { if (performance.now() > this.me.reloadUntil + 400 && Math.abs(l.mag - w.mag) > 3) l.mag = w.mag; l.reserve = w.reserve; } });
        this.me.grenades = me.g;
        this.me.hp = me.hp;
      }
      if (!me.alive && this.me.alive) this.#onLocalDeath();
      this.vehicles.onSnap(m);
      if (this.royale) { this.royale.onSnap(m); return; }
      this.hud.tickets(m.tk);
      for (const [id, owner, prog] of m.f) this.world.setFlagState(id, owner, prog, this.myTeam);
      if (!this.me.alive && !$('deploy').classList.contains('hidden')) this.hud.deployTimer(me.rs);
      if (!this.me.alive && AUTO.get('autodeploy') && me.rs <= 0 && !this._autoSent) { this._autoSent = true; setTimeout(() => (this._autoSent = false), 1500); this.net.send({ t: 'spawn', p: AUTO.get('spawn') || 'base', cls: AUTO.get('cls') || 'assault' }); }
    });
    n.on('ev', ({ e }) => this.#event(e));
    n.on('close', () => {
      if (this.mapChanging) return;
      showError('Disconnected from server — reconnecting…');
      setTimeout(() => { location.href = `/?room=${encodeURIComponent(this.room.id)}&autojoin=1`; }, 2500);
    });
  }

  #event(e) {
    const P = this.players;
    switch (e.t) {
      case 'spawn':
        if (e.id === this.myId) {
          this.me.spawn(e); this.hud.deployScreen(false); this.hud.roundEnd(null);
          if (!this.isTouch) this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
          this.killcam = null;
          setTimeout(() => (document.body.dataset.ready = '1'), 1500);
        }
        break;
      case 'shot': {
        if (e.v) { this.vehicles.onShot(e); break; }
        if (e.id === this.myId) {
          // own shots are predicted locally (onLocalShot); pair this server bullet with the oldest predicted impact
          const h = this.localImpacts?.shift();
          if (h) (this.pendingImpacts || (this.pendingImpacts = new Map())).set(e.b, h);
          break;
        }
        const muzzle = P.muzzleOf(e.id);
        const from = muzzle ? [muzzle.x, muzzle.y, muzzle.z] : e.o;
        const dist = Math.hypot(e.e[0] - from[0], e.e[1] - from[1], e.e[2] - from[2]);
        const tf = Math.max(0.01, e.tf ?? dist / 700);
        // tracer flies at the real (average) bullet speed; the impact appears when the bullet gets there
        this.effects.tracer(from, e.e, dist / tf);
        const dir = new THREE.Vector3(e.e[0] - from[0], e.e[1] - from[1], e.e[2] - from[2]).normalize();
        if (muzzle) this.effects.muzzleFlash(muzzle, dir);
        this.audio.gunshot(from, e.w);
        if (e.s !== 'none') this.#scheduleImpact(e.b, tf, () => this.effects.impact(e.e, e.n, e.s));
        this.#nearMiss(e.o, e.e, tf, e.w);
        const sh = P.info(e.id); if (sh) sh.spottedUntil = performance.now() + 2500;
        break;
      }
      case 'bhit': {
        // the bullet stopped in a soldier: cancel its world impact, show the hit where it landed
        this.#cancelImpact(e.b);
        // hits on me: no blood particles inside my own camera, a red flash on the screen edges instead
        if (e.v === this.myId && this.me.alive && !this.me.isTPS()) this.hud.hurtFlash();
        else this.effects.impact(e.p, null, e.vh ? 'metal' : 'flesh');
        break;
      }
      case 'hurt':
        if (e.v === this.myId) {
          if (e.w === 'fall') { this.audio.land(14, true); this.effects.shake = Math.max(this.effects.shake, 0.6); this.hud.hurtFlash(); this.hud.notice(e.d >= 60 ? 'BAD FALL' : 'FALL DAMAGE', 1200); }
          this.audio.ui('hurt');
          if (e.ax !== undefined) {
            const ang = Math.atan2(e.ax - this.me.s.x, -(e.az - this.me.s.z)) + this.me.yaw;
            this.hud.damageFrom(ang);
          }
        } else { const p = P.info(e.v); p?.rig?.hitReact(); }
        break;
      case 'hitmark': this.hud.hitmarker(e.k, e.hs, e.d, e.r); this.audio.ui(e.k ? 'kill' : e.hs ? 'headshot' : 'hit'); break;
      case 'kill': {
        if (e.k === this.myId && e.v !== this.myId) Stats.add({ kills: 1, xp: e.hs ? 120 : 100 });
        if (e.v === this.myId && e.w !== 'reset') Stats.add({ deaths: 1 });
        this.hud.killfeed(e.k, e.v, e.w, e.hs, new Map([...this.board].map(([id, r]) => [id, { name: r.n, team: r.tm }])));
        const p = P.info(e.v);
        if (p?.rig && e.v !== this.myId) p.rig.die(Math.random() < 0.5 ? 1 : -1);
        if (e.v === this.myId) {
          this.killcam = e.k && e.k !== this.myId ? { id: e.k, x: e.kx, y: e.ky, z: e.kz, name: this.board.get(e.k)?.n, w: e.w, hs: e.hs, t: performance.now() } : null;
          if (p?.rig) p.rig.die(1);
        }
        break;
      }
      case 'reload': if (e.id !== this.myId) P.onReload(e.id, e.dur); break;
      case 'ammo': if (e.w) e.w.forEach((w, i) => { const l = this.me.weapons[i]; if (l && w && l.id === w.id) { l.mag = w.mag; l.reserve = w.reserve; } }); break;
      case 'boom': this.effects.explosion([e.x, e.y, e.z], this.camera.position); this.audio.explosion([e.x, e.y, e.z]); break;
      case 'bounce': break;
      case 'flag': {
        const mine = e.owner === this.myTeam, lost = e.prev === this.myTeam;
        if (mine && this.me.alive && FLAGS.some((f) => f.id === e.id && Math.hypot(f.x - this.me.s.x, f.z - this.me.s.z) < f.r)) Stats.add({ xp: 200 });
        this.hud.notice(e.owner ? `${mine ? 'WE CAPTURED' : 'ENEMY CAPTURED'} ${e.id}` : `${e.id} ${lost ? 'LOST' : 'NEUTRALIZED'}`);
        this.audio.ui('capture');
        break;
      }
      case 'chat': this.hud.chat(e.from, e.msg, e.tm); break;
      case 'round': if (!this.royale) { this.hud.roundEnd(`${e.name} WINS`); setTimeout(() => this.hud.roundEnd(null), 14000); } break;
      case 'correct': Object.assign(this.me.s, { x: e.x, y: e.y, z: e.z }); break;
      case 'glass': { const pane = this.world.breakGlass(e.id); if (pane) { this.effects.glass(e.p || pane.c, e.d, pane.n); this.audio.glass(e.p || pane.c); } break; }
      case 'glassset': for (const id of e.ids) this.world.breakGlass(id); break;
      case 'glassreset': this.world.repairGlass(); break;
      case 'landed': this.hud.notice(`LANDED — PROTECTED FOR ${Math.round(e.prot / 1000)} s`, e.prot); break;
      case 'restricted': this.hud.notice(e.left > 0 ? `RESTRICTED AREA — ENEMY HQ · RETURN IN ${Math.ceil(e.left)}` : 'RESTRICTED AREA — RETURN TO BATTLE', 1200); break;
      case 'throw': if (e.id === this.myId) this.me.grenades = e.g; break;
    }
    this.vehicles.onEvent(e);
    this.royale?.onEvent(e);
  }

  #onLocalDeath() {
    this.me.alive = false;
    if (this.royale) return; // no respawn: the royale client switches to spectating
    document.exitPointerLock?.();
    setTimeout(() => this.#showDeploy(this.meState?.rs), 2200);
  }

  // battle royale READY click: a user gesture, so audio + mouse capture / fullscreen are allowed now
  onRoyaleReady() {
    this.audio.unlock();
    if (this.isTouch) TouchControls.enterFullscreen();
    else this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
  }

  copyInvite() {
    const link = inviteLink(this.room.id);
    navigator.clipboard?.writeText(link).then(() => this.hud.notice('INVITE LINK COPIED'), () => this.hud.notice(link, 6000));
  }

  #showDeploy(respawnIn = 0) {
    if (this.me.alive) return;
    const link = inviteLink(this.room.id);
    $('invite').innerHTML = `<span>ROOM: <b>${esc(this.room.name || this.room.id)}</b></span><span>CODE <b>${this.room.id}</b></span><span>${esc(ACTIVE_MAP.name.toUpperCase())}</span><span>MAX ${this.room.max || 16} PLAYERS</span><span class="inv">INVITE: <code>${esc(link)}</code></span><button id="copyinvite" class="copy"><svg class="ic"><use href="#i-link"/></svg>COPY</button>`;
    $('copyinvite').onclick = () => this.copyInvite();
    $('dp-invite').onclick = (e) => { e.preventDefault(); this.copyInvite(); };
    const kc = this.killcam;
    const killer = kc ? `KILLED BY <b>${kc.name || 'enemy'}</b> · ${WEAPONS[kc.w]?.name || kc.w}${kc.hs ? ' · HEADSHOT' : ''}` : null;
    this.hud.deployScreen(true, { team: this.myTeam, flagsState: this.lastSnap?.f, respawnIn, killer, onDeploy: (sp, cls) => {
      this.audio.unlock();
      // the DEPLOY click is a user gesture, so the browser allows mouse capture right now
      if (this.isTouch) TouchControls.enterFullscreen();
      else this.renderer.domElement.requestPointerLock?.()?.catch?.(() => {});
      this.net.send({ t: 'spawn', p: sp, cls });
    } });
  }

  // thrown grenades: interpolated from snapshots, tumbling in flight (real grenade GLB, pooled per id)
  #grenades(sample, dt) {
    if (!sample) return;
    const { a, b, k } = sample;
    const A = new Map((a.g || []).map((r) => [r[0], r]));
    const live = new Set();
    for (const rb of b.g || []) {
      const ra = A.get(rb[0]) || rb;
      live.add(rb[0]);
      let m = this.grenadeMeshes.get(rb[0]);
      if (!m) { m = this.assets.clone({ scene: this.grenadeAsset.scene }); m.scale.setScalar(1); this.world.scene.add(m); this.grenadeMeshes.set(rb[0], m); }
      m.position.set(ra[1] + (rb[1] - ra[1]) * k, ra[2] + (rb[2] - ra[2]) * k + 0.05, ra[3] + (rb[3] - ra[3]) * k);
      m.rotation.x += dt * 9; m.rotation.z += dt * 4;
    }
    for (const [id, m] of this.grenadeMeshes) if (!live.has(id)) { m.removeFromParent(); this.grenadeMeshes.delete(id); }
  }

  #scheduleImpact(id, tf, fn) {
    const m = this.pendingImpacts || (this.pendingImpacts = new Map());
    const h = setTimeout(() => { if (id !== undefined) m.delete(id); fn(); }, tf * 1000);
    if (id !== undefined) m.set(id, h);
    return h;
  }

  #cancelImpact(id) { const h = this.pendingImpacts?.get(id); if (h) { clearTimeout(h); this.pendingImpacts.delete(id); } }

  // supersonic crack when a bullet passes close by (it arrives before the muzzle report from far away)
  #nearMiss(o, e, tf, w) {
    if (!this.me.alive) return;
    const s = this.me.s, px = s.x, py = s.y + 1.3, pz = s.z;
    const dx = e[0] - o[0], dy = e[1] - o[1], dz = e[2] - o[2], L2 = dx * dx + dy * dy + dz * dz;
    if (L2 < 1) return;
    const k = Math.max(0, Math.min(1, ((px - o[0]) * dx + (py - o[1]) * dy + (pz - o[2]) * dz) / L2));
    const d = Math.hypot(o[0] + dx * k - px, o[1] + dy * k - py, o[2] + dz * k - pz);
    if (d > 4 || k < 0.02) return;
    setTimeout(() => this.audio.crack([o[0] + dx * k, o[1] + dy * k, o[2] + dz * k], w, d), k * tf * 1000);
  }

  // is an enemy soldier (not behind a wall, within the weapon's range) under the crosshair?
  #enemyUnderCrosshair(cam, def) {
    const o = cam.position, d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const wall = this.world.collision.raycast(o, d, def.maxRange || 600, true);
    let far = wall ? wall.t : def.maxRange || 600;
    for (const p of this.players.map.values()) {
      if (!p.alive || p.id === this.myId || (!this.royale && p.team === this.myTeam)) continue;
      const dx = p.x - o.x, dz = p.z - o.z, along = dx * d.x + dz * d.z;
      if (along < 0 || along > far + 2 || Math.abs(dx * d.z - dz * d.x) > 2) continue;
      for (const c of hitCapsules({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, stance: p.stance })) {
        const t = rayCapsule(o, d, c.a, c.b, c.r + 0.05);
        if (t !== null && t < far) return true;
      }
    }
    return false;
  }

  onLocalShot(eye, dir, def) {
    // viewmodel kick + muzzle flash at the real muzzle socket, world tracer & predicted impact
    this.viewmodel.kick(def);
    this.audio.gunshot(null, def.id, true);
    const vmMuzzle = this.viewmodel.weapon.socketWorld('muzzle', new THREE.Vector3());
    // map the viewmodel-space muzzle into the world (viewmodel camera sits at the world camera)
    const worldMuzzle = vmMuzzle.applyMatrix4(this.camera.matrixWorld);
    this.effects.muzzleFlash(worldMuzzle, dir, def.id === 'sniper');
    // same ballistic flight as the server: drop, drag, travel time
    const path = bulletPath(this.world.collision, eye, dir, def);
    const hit = path.hit, e = path.end, end = [e.x, e.y, e.z];
    const tf = Math.max(0.01, e.t);
    const from = [worldMuzzle.x, worldMuzzle.y, worldMuzzle.z];
    if (Math.random() < 1 / def.tracer || def.tracer === 1) this.effects.tracer(from, end, Math.hypot(end[0] - from[0], end[1] - from[1], end[2] - from[2]) / tf);
    const h = hit ? this.#scheduleImpact(undefined, tf, () => this.effects.impact(hit.point, hit.normal, hit.surface)) : null;
    (this.localImpacts || (this.localImpacts = [])).push(h);
    if (this.localImpacts.length > 40) this.localImpacts.shift();
  }

  openChat() {
    const input = $('chatinput');
    this.chatOpen = true; input.classList.remove('hidden'); input.value = ''; input.focus(); document.exitPointerLock?.();
  }

  closeChat(send) {
    const input = $('chatinput');
    if (send && input.value.trim()) this.net.send({ t: 'chat', msg: input.value });
    this.chatOpen = false; input.classList.add('hidden'); input.blur();
    if (this.me.alive && !this.isTouch) this.renderer.domElement.requestPointerLock?.();
  }

  #bindUI() {
    const input = $('chatinput');
    addEventListener('keydown', (e) => {
      if ((e.code === 'KeyT' || e.code === 'Enter') && !this.chatOpen && this.hud) {
        e.preventDefault(); this.openChat();
      } else if (e.code === 'Enter' && this.chatOpen) {
        this.closeChat(true);
      } else if (e.code === 'Escape' && this.chatOpen) this.closeChat(false);
      if (e.code === 'KeyI' && !this.chatOpen) this.copyInvite();
      if (e.code === 'F3') { e.preventDefault(); window.open('/debug/character-weapon', '_blank'); }
    });
    // mobile keyboards: sending happens on the "go"/enter key or when the field loses focus
    input.addEventListener('change', () => { if (this.chatOpen) this.closeChat(true); });
    input.addEventListener('blur', () => { if (this.chatOpen && this.isTouch) this.closeChat(true); });
    this.renderer.domElement.addEventListener('mousedown', () => this.audio.unlock());
    // browsers only allow sound after a user gesture: any click, key or touch anywhere starts (or resumes) it
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, () => this.audio.unlock(), { capture: true, passive: true });
    const Vol = $('p-vol');
    Vol.value = Math.round(this.audio.volume * 100);
    Vol.oninput = () => { this.audio.setVolume(+Vol.value / 100); localStorage.setItem('sp_volume', Vol.value); };
    // pause menu when the mouse is released (Esc) during play
    const pause = $('pause');
    document.addEventListener('pointerlockchange', () => {
      if (this.isTouch) return;
      const locked = document.pointerLockElement === this.renderer.domElement;
      pause.classList.toggle('hidden', locked || !this.me.canLook() || this.chatOpen);
    });
    $('p-resume').onclick = () => { pause.classList.add('hidden'); if (!this.isTouch) this.renderer.domElement.requestPointerLock?.(); };
    $('p-invite').onclick = () => this.copyInvite();
    $('p-leave').onclick = () => { location.href = '/'; };
    // one slider: mouse sensitivity on desktop, look-drag sensitivity on touch screens
    const touchSens = () => +(localStorage.getItem('sp_touch_sens') || 0.0045);
    $('p-sens').value = Math.round((this.isTouch ? touchSens() / 2 : this.me.sens) * 10000);
    $('p-sens').oninput = () => {
      const v = +$('p-sens').value / 10000;
      if (this.isTouch) { if (this.touch) this.touch.lookSens = v * 2; localStorage.setItem('sp_touch_sens', v * 2); } else { this.me.sens = v; localStorage.setItem('sp_sens', v); }
    };
    $('p-room').textContent = `${ACTIVE_MAP.name.toUpperCase()}  |  ${this.room.mode === 'royale' ? 'SOLO' : 'CONQUEST'}  |  ROOM ${this.room.id}`;
    $('p-mapname').textContent = `${ACTIVE_MAP.name} · ${this.room.name || ''}`;
    $('p-thumb').style.backgroundImage = `url(${mapArt(this.room.map)})`;
    // ---- graphics options (pause menu)
    const Q = $('p-quality');
    Q.value = this.qualityName;
    Q.onchange = () => {
      // presets rebuild the world (shadow maps, vegetation, terrain): save and rejoin the same room
      const st = JSON.parse(localStorage.getItem('sp_settings') || '{}'); st.quality = Q.value; localStorage.setItem('sp_settings', JSON.stringify(st));
      location.href = `/?room=${encodeURIComponent(this.room.id)}&autojoin=1&q=${Q.value}`;
    };
    const S = $('p-scale'), savedScale = localStorage.getItem('sp_scale') || 'auto';
    S.value = savedScale;
    const applyScale = () => this.dynres.setManual(S.value === 'auto' ? null : +S.value);
    S.onchange = applyScale;
    if (savedScale !== 'auto') applyScale();
    const V = $('p-view'), fog = this.world.scene.fog;
    const applyView = (m) => {
      fog.far = m; fog.near = Math.min(fog.near, m * 0.4);
      this.camera.far = m + 60; this.camera.updateProjectionMatrix();
      if (this.royale) this.royale.baseFogFar = m;
      $('p-view-v').textContent = `${m} m`;
    };
    V.value = Math.round(+(localStorage.getItem('sp_view') || fog.far));
    applyView(+V.value);
    V.oninput = () => { applyView(+V.value); localStorage.setItem('sp_view', V.value); };
    const F = $('p-fps');
    F.checked = localStorage.getItem('sp_showfps') !== '0';
    const applyFps = () => { $('fps').style.display = F.checked ? '' : 'none'; localStorage.setItem('sp_showfps', F.checked ? '1' : '0'); };
    F.onchange = applyFps; applyFps();
    $('p-gpu').textContent = `GPU: ${gpu.name}${gpu.dedicated ? ' (dedicated)' : gpu.kind === 'integrated' ? ' (integrated — see the main menu to switch to your graphics card)' : ''}`;
  }

  // ---------------------------------------------------------------- frame
  #frame() {
    const P = this.prof || (this.prof = new FrameProfiler());
    P.begin();
    this.renderer.info.reset();
    this.touch?.update();
    const rawDt = this.clock.getDelta();
    this.dynres?.frame(rawDt * 1000);
    const dt = Math.min(0.05, rawDt);
    const time = this.clock.elapsedTime;
    const me = this.me, V = this.vehicles;
    const seated = me.alive && !!V.mine;
    if (seated) V.updateLocal(dt); else me.update(dt);
    const cam = this.camera;
    const fc = window.__freecam;
    if (fc) { cam.position.set(...fc.pos); cam.lookAt(...fc.look); }
    else if (seated) V.updateCamera(cam, dt);
    else if (me.alive) me.updateCamera(cam, dt);
    else if (this.killcam && performance.now() - this.killcam.t < 2400) {
      // killcam: turn toward the killer
      const kc = this.killcam, p = this.players.info(kc.id);
      const tx = p?.x ?? kc.x, ty = (p?.y ?? kc.y) + 1.4, tz = p?.z ?? kc.z;
      const m = new THREE.Matrix4().lookAt(cam.position, new THREE.Vector3(tx, ty, tz), new THREE.Vector3(0, 1, 0));
      cam.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 1 - Math.exp(-4 * dt));
      cam.position.lerp(new THREE.Vector3(me.s.x, me.s.y + 0.6, me.s.z), 1 - Math.exp(-3 * dt));
    } else if (this.royale?.updateCamera(cam, dt)) {
      // battle royale: plane chase camera / spectating
    } else if (!me.alive) {
      // deploy screen: slow aerial orbit of the battlefield
      const a = time * 0.03;
      cam.position.set(Math.cos(a) * 120, 70, Math.sin(a) * 120); cam.lookAt(0, 0, 0);
    }
    P.mark('input+camera');
    const wdef = WEAPONS[me.weaponId()];
    // viewmodel
    const reloading = performance.now() < me.reloadUntil;
    this.viewmodel.update(dt, {
      ads: me.alive && me.ads && !reloading, moving: me.moveFactor || 0, speedFactor: me.sprinting ? 1 : 0, sprint: me.sprinting, mouseDX: me.mouse.dx, mouseDY: me.mouse.dy,
      reload: reloading ? (performance.now() - me.reloadStart) / me.reloadDur : 0, crouch: me.s.stance !== 'stand', camera: cam, baseFov: this.baseFov,
      adsFov: wdef ? (wdef.scoped && this.viewmodel.weapon.opticType === 'scope' ? 0.8 : wdef.adsFov) : 0.8, adsTime: wdef?.adsTime, sunDir: this.lighting.sunDir, shade: this.shade ?? 1, env: this.env,
    });
    P.mark('viewmodel');
    me.mouse.dx = 0; me.mouse.dy = 0;
    // fully aimed through a magnified scope: full-screen scope view rendered from the camera itself (reticle centre
    // = bullet direction, no picture-in-picture misalignment)
    const vw = this.viewmodel.weapon;
    const fullScope = !seated && me.alive && !me.isTPS() && !fc && !!wdef?.scoped && vw.opticType === 'scope' && this.viewmodel.ads > 0.96 && !reloading;
    // real optics: a 4x rifle scope shows ~7 degrees (PSO-1: 6 deg), independent of the player's FOV setting
    cam.fov = seated ? V.fov : fullScope ? 28 / (vw.magnification || 4) : this.baseFov * (me.alive && !me.isTPS() ? this.viewmodel.fovScale : me.thirdPerson && me.ads ? 0.8 : 1);
    this.scope.show(fullScope);
    if (fullScope) this.scope.update(wdef, me.zeroOf(), cam.fov);
    me.scoped = fullScope;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // is the player in the shade? (for viewmodel lighting)
    this.shadeT = (this.shadeT || 0) + dt;
    if (this.shadeT > 0.2) {
      this.shadeT = 0;
      const o = cam.position.clone();
      this.shade = this.world.collision.raycast(o, this.lighting.sunDir, 120, false) ? 0.25 : 1;
    }
    P.mark('camera+shade');
    // third-person aim point: whatever the camera looks at
    // remote & local third-person bodies
    const sample = this.net.sample();
    const local = me.alive ? { x: me.s.x, y: me.s.y, z: me.s.z, yaw: (seated && V.riderYaw != null) ? V.riderYaw : me.yaw, pitch: me.pitch + me.recoil.p, stance: me.s.stance, vx: me.s.vx, vz: me.s.vz, alive: true, ads: me.ads, sprint: me.sprinting, onGround: me.s.onGround, weaponId: me.weaponId(), air: me.s.air || 0, veh: seated && !V.pose } : null;
    this.players.update(dt, sample, this.myId, cam.position, me.isTPS() && !(seated && V.fpView), local, cam);
    P.mark('players');
    V.update(dt, sample);
    this.#grenades(sample, dt);
    // world
    this.lighting.follow(cam.position, this.renderer);
    this.world.update(dt, cam, time);
    this.royale?.update(dt, cam);
    P.mark('world');
    this.effects.camPos = cam.position;
    this.effects.update(dt);
    P.mark('effects');
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion));
    // HUD
    if (this.lastSnap) {
      const w = me.weapons[me.slot];
      this.hud.vitals({ hp: me.alive ? (this.meState?.hp ?? 100) : 0 }, w, me.slot, me.grenades, me.s.stance, reloading, me.zeroOf());
      if (!this.royale) this.hud.flags(this.lastSnap.f, me.alive ? me.s : null);
      if ((this.enemyCheckN = (this.enemyCheckN || 0) + 1) % 3 === 1) this.onEnemy = me.alive && wdef ? this.#enemyUnderCrosshair(cam, wdef) : false;
      this.hud.compass(seated && V.drive && !V.fpView ? cam.rotation.y : me.yaw);
      this.hud.crosshair(seated ? 0.4 : wdef ? me.spread(wdef) * 57.3 : 1, !seated && this.viewmodel.ads > 0.5 && !me.thirdPerson, me.alive && !me.s.air, this.onEnemy);
      // the minimap canvas is costly to redraw: 12 Hz is plenty
      this.mmT = (this.mmT || 0) + dt;
      if (this.mmT > 0.083) { this.mmT = 0; this.hud.minimap(me.s, me.yaw, this.players.map, this.myId, this.lastSnap.f, this.royale, V); }
    }
    P.mark('hud');
    // render: world, then first-person viewmodel on top (or world only in third person / dead)
    if (fullScope) this.renderer.render(this.world.scene, cam);
    else if (me.alive && !me.isTPS() && !fc) this.viewmodel.render(this.renderer, this.world.scene, cam, this.baseFov * this.viewmodel.fovScale);
    else this.renderer.render(this.world.scene, cam);
    P.mark('render');
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 1) { this.hud.fps(`${this.frames} fps · ${gpu.name.replace(/\(R\)|\(TM\)|NVIDIA |Laptop GPU/g, '').trim()} · ${this.qualityName.toUpperCase()} · res ${Math.round((this.dynres?.scale ?? 1) * 100)}% · ${this.renderer.info.render.calls} draws · ${(this.renderer.info.render.triangles / 1000) | 0}k tris${AUTO.has('perf') ? ` · ${P.report()}` : ''}`); this.frames = 0; this.fpsT = 0; }
    P.end();
  }
}

// ------------------------------------------------------------------ menu / lobby
const saved = JSON.parse(localStorage.getItem('sp_settings') || '{}');
$('name').value = saved.name || `Soldier${(Math.random() * 900 + 100) | 0}`;
// pick the preset from the graphics card the browser actually renders with (dedicated GPU -> HIGH / ULTRA)
const gpu = detectGPU();
const recommendedQuality = isTouchDevice() ? 'verylow' : gpu.recommended;
$('quality').value = saved.quality || recommendedQuality;
showGPUInfo();
function showGPUInfo() {
  const el = $('gpuinfo'), adv = adviceFor(gpu);
  const label = { dedicated: 'dedicated graphics card', integrated: 'integrated graphics', software: 'software rendering (no GPU)', mobile: 'mobile GPU' }[gpu.kind];
  const Q = $('quality');
  const rank = ['verylow', 'low', 'medium', 'high', 'ultra'];
  const better = rank.indexOf(recommendedQuality) > rank.indexOf(Q.value);
  el.className = adv?.level === 'bad' ? 'bad' : gpu.dedicated ? 'good' : '';
  el.innerHTML = `<div><b>GPU:</b> ${esc(gpu.name)} · <span class="k">${label}</span> · recommended <b>${recommendedQuality.toUpperCase()}</b>`
    + (better ? ` <button id="gpu-use">USE ${recommendedQuality.toUpperCase()}</button>` : '') + '</div>'
    + (adv ? `<details${adv.level === 'bad' ? ' open' : ''}><summary>${esc(adv.title)}</summary><ol>${adv.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>` : '');
  if (better) $('gpu-use').onclick = (e) => { e.preventDefault(); Q.value = recommendedQuality; showGPUInfo(); };
  Q.onchange = showGPUInfo;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
$('fov').value = saved.fov || 78;
$('team').value = saved.team || '0';
const lobby = new Lobby({ initialRoom: AUTO.get('room') });
if (sessionStorage.getItem('sp_err')) { $('loading').textContent = sessionStorage.getItem('sp_err'); sessionStorage.removeItem('sp_err'); }
const game = new Game();
window.__game = game;
$('play').onclick = async () => {
  const s = { name: $('name').value.trim() || 'Soldier', team: +$('team').value, quality: $('quality').value, fov: +$('fov').value };
  localStorage.setItem('sp_settings', JSON.stringify(s));
  $('play').disabled = true;
  try {
    const pick = AUTO.get('autojoin') && AUTO.get('room') ? { room: AUTO.get('room'), password: sessionStorage.getItem(`sp_pw_${AUTO.get('room')}`) || '' } : await lobby.choose();
    sessionStorage.setItem(`sp_pw_${pick.room}`, pick.password || '');
    await game.start({ ...s, ...pick });
  } catch (e) {
    console.error(e);
    $('loadscreen').classList.add('hidden');
    $('loading').textContent = e.message;
    // a failed start leaves a half-built renderer behind; reload keeps things simple
    if (game.renderer) { sessionStorage.setItem('sp_err', e.message); setTimeout(() => { location.href = `/?room=${encodeURIComponent(game.room?.id || AUTO.get('room') || '')}`; }, 1200); }
    else $('play').disabled = false;
  }
};
if (AUTO.get('autojoin')) {
  $('quality').value = AUTO.get('q') || $('quality').value;
  if (AUTO.get('team')) $('team').value = AUTO.get('team');
  if (!AUTO.get('room')) { lobby.refresh().then(() => $('play').click()); } else $('play').click();
}
