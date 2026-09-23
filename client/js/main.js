// STRIKEPOINT client entry: loads assets, builds the world, connects to the authoritative server and runs the frame loop.
import * as THREE from 'three';
import { createRenderer, Lighting, QUALITY } from './render/Renderer.js';
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
import { PROPS, groundHeight, roadDistance, BUILDINGS, FLAGS } from '/shared/map.js';
import { EYE_HEIGHT } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const AUTO = new URLSearchParams(location.search);
const showError = (m) => { $('errors').textContent += `${m}\n`; };
addEventListener('error', (e) => showError(`JS error: ${e.message}`));

class Game {
  async start({ name, team, quality, fov }) {
    this.qualityName = quality;
    const { renderer, q } = createRenderer($('game'), quality);
    this.renderer = renderer; this.q = q;
    this.baseFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 1600);
    this.assets = await new AssetManager(renderer).init();
    this.assets.anisotropy = q.anisotropy;
    const progress = (s) => ($('loading').textContent = `Loading ${s}…`);
    progress('sky');
    this.world = new GameWorld(this.assets, renderer, quality);
    this.lighting = new Lighting(this.world.scene, q);
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
    for (const [id, l] of Object.entries(this.weaponLoads)) describeGLTF(`WEAPON ${id}`, l.gltf, l.file);
    this.viewmodel = new Viewmodel(this.assets, charLoaded, this.weaponLoads.ar, 'ar', renderer, { quality });
    this.hud = new HUD();
    this.players = new Players(this);
    this.me = new LocalPlayer(this);
    this.board = new Map();
    this.net = new Net();
    this.#bindNet();
    this.#bindUI();
    progress('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    await this.net.connect(`${proto}://${location.host}/ws`);
    this.net.send({ t: 'join', name, team, cls: this.hud.selectedClass });
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
    n.on('welcome', (m) => { this.myId = m.id; this.myTeam = m.team; this.hud.myTeam = m.team; this.#showDeploy(); });
    n.on('board', (m) => {
      this.board = new Map(m.rows.map((r) => [r.id, r]));
      this.hud.board = m.rows;
      const me = this.board.get(this.myId); if (me) { this.myTeam = me.tm; this.hud.myTeam = me.tm; }
      for (const id of [...this.players.map.keys()]) if (!this.board.has(id)) this.players.remove(id);
      for (const p of this.players.map.values()) { const r = this.board.get(p.id); if (r) p.name = r.n; }
    });
    n.on('snap', (m) => {
      this.lastSnap = m;
      const me = m.me;
      this.meState = me;
      if (me.alive && this.me.alive) {
        // reconcile authoritative ammo/grenades
        me.w?.forEach((w, i) => { const l = this.me.weapons[i]; if (l && l.id === w.id) { if (performance.now() > this.me.reloadUntil + 400 && Math.abs(l.mag - w.mag) > 3) l.mag = w.mag; l.reserve = w.reserve; } });
        this.me.grenades = me.g;
        this.me.hp = me.hp;
      }
      if (!me.alive && this.me.alive) this.#onLocalDeath();
      this.hud.tickets(m.tk);
      for (const [id, owner, prog] of m.f) this.world.setFlagState(id, owner, prog, this.myTeam);
      if (!this.me.alive && !$('deploy').classList.contains('hidden')) this.hud.deployTimer(me.rs);
      if (!this.me.alive && AUTO.get('autodeploy') && me.rs <= 0 && !this._autoSent) { this._autoSent = true; setTimeout(() => (this._autoSent = false), 1500); this.net.send({ t: 'spawn', p: AUTO.get('spawn') || 'base', cls: AUTO.get('cls') || 'assault' }); }
    });
    n.on('ev', ({ e }) => this.#event(e));
    n.on('close', () => showError('Disconnected from server.'));
  }

  #event(e) {
    const P = this.players;
    switch (e.t) {
      case 'spawn':
        if (e.id === this.myId) {
          this.me.spawn(e); this.hud.deployScreen(false); this.hud.roundEnd(null);
          this.renderer.domElement.requestPointerLock?.();
          this.killcam = null;
          setTimeout(() => (document.body.dataset.ready = '1'), 1500);
        }
        break;
      case 'shot': {
        if (e.id === this.myId) {
          if (e.s === 'flesh') this.effects.impact(e.e, null, 'flesh');
          break;
        }
        const muzzle = P.muzzleOf(e.id);
        const from = muzzle ? [muzzle.x, muzzle.y, muzzle.z] : e.o;
        this.effects.tracer(from, e.e);
        const dir = new THREE.Vector3(e.e[0] - from[0], e.e[1] - from[1], e.e[2] - from[2]).normalize();
        if (muzzle) this.effects.muzzleFlash(muzzle, dir);
        this.audio.gunshot(from, e.w);
        if (e.s !== 'none') this.effects.impact(e.e, e.n, e.s);
        const sh = P.info(e.id); if (sh) sh.spottedUntil = performance.now() + 2500;
        // bullet whizz / near-miss suppression cue
        break;
      }
      case 'hurt':
        if (e.v === this.myId) {
          this.audio.ui('hurt');
          if (e.ax !== undefined) {
            const ang = Math.atan2(e.ax - this.me.s.x, -(e.az - this.me.s.z)) + this.me.yaw;
            this.hud.damageFrom(ang);
          }
        } else { const p = P.info(e.v); p?.rig?.hitReact(); }
        break;
      case 'hitmark': this.hud.hitmarker(e.k); this.audio.ui(e.k ? 'kill' : 'hit'); break;
      case 'kill': {
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
      case 'ammo': if (e.w) e.w.forEach((w, i) => { const l = this.me.weapons[i]; if (l) { l.mag = w.mag; l.reserve = w.reserve; } }); break;
      case 'boom': this.effects.explosion([e.x, e.y, e.z], this.camera.position); this.audio.explosion([e.x, e.y, e.z]); break;
      case 'bounce': break;
      case 'flag': {
        const mine = e.owner === this.myTeam, lost = e.prev === this.myTeam;
        this.hud.notice(e.owner ? `${mine ? 'WE CAPTURED' : 'ENEMY CAPTURED'} ${e.id}` : `${e.id} ${lost ? 'LOST' : 'NEUTRALIZED'}`);
        this.audio.ui('capture');
        break;
      }
      case 'chat': this.hud.chat(e.from, e.msg, e.tm); break;
      case 'round': this.hud.roundEnd(`${e.name} WINS`); setTimeout(() => this.hud.roundEnd(null), 14000); break;
      case 'correct': Object.assign(this.me.s, { x: e.x, y: e.y, z: e.z }); break;
      case 'throw': if (e.id === this.myId) this.me.grenades = e.g; break;
    }
  }

  #onLocalDeath() {
    this.me.alive = false;
    document.exitPointerLock?.();
    setTimeout(() => this.#showDeploy(this.meState?.rs), 2200);
  }

  #showDeploy(respawnIn = 0) {
    if (this.me.alive) return;
    const kc = this.killcam;
    const killer = kc ? `KILLED BY <b>${kc.name || 'enemy'}</b> · ${WEAPONS[kc.w]?.name || kc.w}${kc.hs ? ' · HEADSHOT' : ''}` : null;
    this.hud.deployScreen(true, { team: this.myTeam, flagsState: this.lastSnap?.f, respawnIn, killer, onDeploy: (sp, cls) => { this.audio.unlock(); this.net.send({ t: 'spawn', p: sp, cls }); } });
  }

  onLocalShot(eye, dir, def) {
    // viewmodel kick + muzzle flash at the real muzzle socket, world tracer & predicted impact
    this.viewmodel.kick(def);
    this.audio.gunshot(null, def.id, true);
    const vmMuzzle = this.viewmodel.weapon.socketWorld('muzzle', new THREE.Vector3());
    // map the viewmodel-space muzzle into the world (viewmodel camera sits at the world camera)
    const worldMuzzle = vmMuzzle.applyMatrix4(this.camera.matrixWorld);
    this.effects.muzzleFlash(worldMuzzle, dir, def.id === 'sniper');
    const hit = this.world.collision.raycast(eye, dir, 600, true);
    const end = hit ? hit.point : [eye.x + dir.x * 600, eye.y + dir.y * 600, eye.z + dir.z * 600];
    if (Math.random() < 1 / def.tracer || def.tracer === 1) this.effects.tracer([worldMuzzle.x, worldMuzzle.y, worldMuzzle.z], end, 900);
    if (hit) this.effects.impact(hit.point, hit.normal, hit.surface);
  }

  #bindUI() {
    const input = $('chatinput');
    addEventListener('keydown', (e) => {
      if ((e.code === 'KeyT' || e.code === 'Enter') && !this.chatOpen && this.hud) {
        e.preventDefault(); this.chatOpen = true; input.classList.remove('hidden'); input.value = ''; input.focus(); document.exitPointerLock?.();
      } else if (e.code === 'Enter' && this.chatOpen) {
        if (input.value.trim()) this.net.send({ t: 'chat', msg: input.value });
        this.chatOpen = false; input.classList.add('hidden'); input.blur(); if (this.me.alive) this.renderer.domElement.requestPointerLock?.();
      } else if (e.code === 'Escape' && this.chatOpen) { this.chatOpen = false; input.classList.add('hidden'); }
      if (e.code === 'F3') { e.preventDefault(); window.open('/debug/character-weapon', '_blank'); }
    });
    this.renderer.domElement.addEventListener('mousedown', () => this.audio.unlock());
  }

  // ---------------------------------------------------------------- frame
  #frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    const me = this.me;
    me.update(dt);
    const cam = this.camera;
    const fc = window.__freecam;
    if (fc) { cam.position.set(...fc.pos); cam.lookAt(...fc.look); }
    else if (me.alive) me.updateCamera(cam, dt);
    else if (this.killcam && performance.now() - this.killcam.t < 2400) {
      // killcam: turn toward the killer
      const kc = this.killcam, p = this.players.info(kc.id);
      const tx = p?.x ?? kc.x, ty = (p?.y ?? kc.y) + 1.4, tz = p?.z ?? kc.z;
      const m = new THREE.Matrix4().lookAt(cam.position, new THREE.Vector3(tx, ty, tz), new THREE.Vector3(0, 1, 0));
      cam.quaternion.slerp(new THREE.Quaternion().setFromRotationMatrix(m), 1 - Math.exp(-4 * dt));
      cam.position.lerp(new THREE.Vector3(me.s.x, me.s.y + 0.6, me.s.z), 1 - Math.exp(-3 * dt));
    } else if (!me.alive) {
      // deploy screen: slow aerial orbit of the battlefield
      const a = time * 0.03;
      cam.position.set(Math.cos(a) * 120, 70, Math.sin(a) * 120); cam.lookAt(0, 0, 0);
    }
    const wdef = WEAPONS[me.weaponId()];
    // viewmodel
    const reloading = performance.now() < me.reloadUntil;
    this.viewmodel.update(dt, {
      ads: me.alive && me.ads && !reloading, moving: me.moveFactor || 0, speedFactor: me.sprinting ? 1 : 0, sprint: me.sprinting, mouseDX: me.mouse.dx, mouseDY: me.mouse.dy,
      reload: reloading ? (performance.now() - me.reloadStart) / me.reloadDur : 0, crouch: me.s.stance !== 'stand', camera: cam, baseFov: this.baseFov,
      adsFov: wdef ? (wdef.scoped && this.viewmodel.weapon.opticType === 'scope' ? 0.8 : wdef.adsFov) : 0.8, adsTime: wdef?.adsTime, sunDir: this.lighting.sunDir, shade: this.shade ?? 1, env: this.env,
    });
    me.mouse.dx = 0; me.mouse.dy = 0;
    cam.fov = this.baseFov * (me.alive && !me.thirdPerson ? this.viewmodel.fovScale : me.thirdPerson && me.ads ? 0.8 : 1);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // is the player in the shade? (for viewmodel lighting)
    this.shadeT = (this.shadeT || 0) + dt;
    if (this.shadeT > 0.2) {
      this.shadeT = 0;
      const o = cam.position.clone();
      this.shade = this.world.collision.raycast(o, this.lighting.sunDir, 120, false) ? 0.25 : 1;
    }
    // third-person aim point: whatever the camera looks at
    // remote & local third-person bodies
    const sample = this.net.sample();
    const local = me.alive ? { x: me.s.x, y: me.s.y, z: me.s.z, yaw: me.yaw, pitch: me.pitch + me.recoil.p, stance: me.s.stance, vx: me.s.vx, vz: me.s.vz, alive: true, ads: me.ads, sprint: me.sprinting, onGround: me.s.onGround, weaponId: me.weaponId() } : null;
    this.players.update(dt, sample, this.myId, cam.position, me.thirdPerson, local);
    // world
    this.lighting.follow(cam.position);
    this.world.update(dt, cam, time);
    this.effects.update(dt);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, fwd, new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion));
    // HUD
    if (this.lastSnap) {
      const w = me.weapons[me.slot];
      this.hud.vitals({ hp: me.alive ? (this.meState?.hp ?? 100) : 0 }, w, me.slot, me.grenades, me.s.stance, reloading);
      this.hud.flags(this.lastSnap.f, me.alive ? me.s : null);
      this.hud.crosshair(wdef ? me.spread(wdef) * 57.3 : 1, this.viewmodel.ads > 0.5 && !me.thirdPerson, me.alive);
      this.hud.minimap(me.s, me.yaw, this.players.map, this.myId, this.lastSnap.f);
    }
    // render: world, then first-person viewmodel on top (or world only in third person / dead)
    if (me.alive && !me.thirdPerson && !fc) this.viewmodel.render(this.renderer, this.world.scene, cam, this.baseFov * this.viewmodel.fovScale);
    else this.renderer.render(this.world.scene, cam);
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 1) { this.hud.fps(`${this.frames} fps · ${this.renderer.info.render.calls} draws · ${(this.renderer.info.render.triangles / 1000) | 0}k tris`); this.frames = 0; this.fpsT = 0; }
  }
}

// ------------------------------------------------------------------ menu
const saved = JSON.parse(localStorage.getItem('sp_settings') || '{}');
$('name').value = saved.name || `Soldier${(Math.random() * 900 + 100) | 0}`;
$('quality').value = saved.quality || (navigator.hardwareConcurrency <= 4 ? 'low' : 'medium');
$('fov').value = saved.fov || 78;
$('team').value = saved.team || '0';
const game = new Game();
window.__game = game;
$('play').onclick = async () => {
  const s = { name: $('name').value.trim() || 'Soldier', team: +$('team').value, quality: $('quality').value, fov: +$('fov').value };
  localStorage.setItem('sp_settings', JSON.stringify(s));
  $('play').disabled = true;
  try { await game.start(s); } catch (e) { console.error(e); showError(e.message); $('play').disabled = false; }
};
if (AUTO.get('autojoin')) { $('quality').value = AUTO.get('q') || $('quality').value; if (AUTO.get('team')) $('team').value = AUTO.get('team'); $('play').click(); }
