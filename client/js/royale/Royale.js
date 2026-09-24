// Battle royale client: warm-up / plane / live / result phases, flight camera and jump, loot on the ground
// (real GLB models, distance-streamed), pickup prompt, inventory HUD, ring of fire, supply drops, parachutes,
// full-island map and spectating after death.
import * as THREE from 'three';
import { ROYALE, LOOT, ringAt } from '/shared/royale.js';
import { WEAPONS } from '/shared/weapons.js';
import { BUILDINGS, ROADS, PLAY_HALF, ACTIVE_MAP } from '/shared/map.js';
import { WeaponModel } from '../weapons/WeaponModel.js';
import { buildCanopy, buildRingWall, glowTexture } from './RoyaleModels.js';
import { buildTransportPlane } from './TransportPlane.js';

const $ = (id) => document.getElementById(id);
const PH = ['lobby', 'plane', 'live', 'over'];
const COLORS = { weapon: 0xffa53d, ammo: 0xe0c36a, armor: 0x49a6ff, med: 0x5fe07a, nade: 0xff5a4a };
const SIZE = { ammo_box: 0.42, medical_box: 0.46, armor: 0.62, grenade: 0.3 };
const PROP_KEY = { ammo_box: 'ammo', medical_box: 'medkit', armor: 'old_crate' };
const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _v = new THREE.Vector3(), _box = new THREE.Box3();

export class RoyaleClient {
  constructor(game) {
    this.g = game;
    this.scene = game.world.scene;
    this.loot = new Map();
    this.pools = {};
    this.protos = {};
    this.phase = 'lobby'; this.ring = null; this.plane = null; this.alive = 0; this.total = 0; this.cd = 0;
    this.me = {};
    this.planeMesh = buildTransportPlane(); this.planeMesh.visible = false; this.scene.add(this.planeMesh);
    this.ringWall = buildRingWall(); this.ringWall.visible = false; this.scene.add(this.ringWall);
    this.canopies = new Map();
    this.drops = [];
    this.spectate = null;
    this.lootR = { verylow: 26, low: 34, medium: 45, high: 60, ultra: 75 }[game.qualityName] || 45;
    this.#ui();
    this.ready = this.#loadProtos();
  }

  get inPlane() { return !!this.me.ip && this.phase === 'plane' && !this.g.me.alive; }
  get healing() { return this.me.hl > 0; }

  // ---------------------------------------------------------------- DOM
  #ui() {
    document.body.classList.add('royale');
    const hud = $('hud');
    const d = document.createElement('div'); d.id = 'br';
    d.innerHTML = `<div id="br-top"></div><div id="br-sub"></div>
      <div id="br-alive"><span><b id="br-al">0</b> ALIVE</span><span><b id="br-k">0</b> KILLS</span></div>
      <div id="br-armor"><span class="ico">⛨</span><div class="bar"><i></i></div><b id="br-ar">0</b></div>
      <div id="br-inv"></div><div id="br-prompt" class="hidden"></div><div id="br-heal" class="hidden"><div>HEALING</div><div class="bar"><i></i></div></div>
      <div id="br-fire"></div><canvas id="br-map" width="360" height="360" class="hidden"></canvas><div id="br-result" class="hidden"></div>`;
    hud.appendChild(d);
    const r = document.createElement('div'); r.id = 'br-ready'; r.className = 'hidden';
    const step = (n, t, img, txt) => `<div class="brr-step"><div class="sh"><i>${n}</i><b>${t}</b></div><div class="si" style="background-image:url(/assets/ui/${img})"></div><p>${txt}</p></div>`;
    r.innerHTML = `<div class="brr">
      <div class="brr-head"><svg class="ic"><use href="#i-target"/></svg><div><h2>BATTLE ROYALE</h2><small>${esc(ACTIVE_MAP.name.toUpperCase())} &nbsp;•&nbsp; SOLO</small></div></div>
      <div class="brr-steps">${step(1, 'DROP', 'step_drop.jpg', 'Board the transport plane and choose your landing point. <kbd>SPACE</kbd> jumps, again opens the parachute.')}<span class="arr">»</span>
        ${step(2, 'LOOT', 'step_loot.jpg', 'Find weapons, armor and medical supplies. <kbd>E</kbd> picks up, <kbd>H</kbd> heals.')}<span class="arr">»</span>
        ${step(3, 'SURVIVE', 'step_survive.jpg', 'Stay inside the safe zone — the ring of fire closes in. Last soldier standing wins.')}</div>
      <div class="brr-foot"><span class="rdy"><i></i>IN LOBBY · <b id="brr-count">1</b></span><button id="br-go">READY</button><a href="/" class="leave"><svg class="ic"><use href="#i-exit"/></svg>LEAVE ROOM</a></div>
    </div>
    <aside class="brr-info"><h4>MATCH INFO</h4>
      <div><svg class="ic"><use href="#i-users"/></svg><b id="brr-players">—</b>&nbsp;PLAYERS</div><div><svg class="ic"><use href="#i-user"/></svg>SOLO</div>
      <div><svg class="ic"><use href="#i-skull"/></svg>NO RESPAWNS</div><div class="g"><svg class="ic"><use href="#i-target"/></svg>SAFE ZONE ACTIVE</div></aside>
    <div class="brr-keys"><span><kbd>SPACE</kbd>Jump / Deploy parachute</span><span><kbd>E</kbd>Pick up</span><span><kbd>H</kbd>Heal</span><span><kbd>M</kbd>Map</span></div>`;
    document.body.appendChild(r);
    $('br-go').onclick = () => { r.classList.add('hidden'); this.g.onRoyaleReady(); };
  }

  showReady(v) { $('br-ready').classList.toggle('hidden', !v); }

  // ---------------------------------------------------------------- loot models
  async #loadProtos() {
    const A = this.g.assets;
    for (const w of ['ar', 'sniper', 'pistol']) this.protos[w] = { weapon: await A.loadWeapon(WEAPONS[w].visual, { tps: true }), key: WEAPONS[w].visual };
    for (const [model, key] of Object.entries(PROP_KEY)) {
      try { this.protos[model] = { gltf: await A.loadProp(key) }; } catch (e) { console.warn('[royale] loot model', key, e); }
    }
    this.protos.grenade = { gltf: this.g.grenadeAsset };
    try { this.protos.crate = await A.loadProp('crate'); } catch {}
    const beam = document.createElement('canvas'); beam.width = 8; beam.height = 64;
    const bg = beam.getContext('2d'), gr = bg.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); bg.fillStyle = gr; bg.fillRect(0, 0, 8, 64);
    this.beamTex = new THREE.CanvasTexture(beam);
    this.markMats = {};
    for (const [k, c] of Object.entries(COLORS)) {
      this.markMats[k] = {
        disc: new THREE.MeshBasicMaterial({ map: glowTexture(), color: c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
        beam: new THREE.SpriteMaterial({ map: this.beamTex, color: c, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      };
    }
    this.discGeo = new THREE.PlaneGeometry(1.2, 1.2).rotateX(-Math.PI / 2);
  }

  #make(type) {
    const L = LOOT[type], P = this.protos[L.model];
    const holder = new THREE.Group(); holder.name = `loot_${type}`;
    let model;
    if (L.kind === 'weapon') {
      const wm = new WeaponModel(this.g.assets, P.weapon, { key: P.key });
      model = wm.root; model.rotation.set(0, 0, Math.PI / 2); // lying on its side
    } else if (P?.gltf) {
      model = this.g.assets.clone(P.gltf);
      model.updateMatrixWorld(true);
      const s = SIZE[L.model] / Math.max(0.01, _box.setFromObject(model).getSize(_v).x, _v.z);
      model.scale.multiplyScalar(s);
    } else model = new THREE.Group();
    const inner = new THREE.Group(); inner.add(model); holder.add(inner);
    holder.updateMatrixWorld(true);
    _box.setFromObject(model);
    const c = _box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -_box.min.y + 0.01, -c.z);
    model.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    const mm = this.markMats[L.kind];
    const disc = new THREE.Mesh(this.discGeo, mm.disc); disc.position.y = 0.03; disc.renderOrder = 2; holder.add(disc);
    const beam = new THREE.Sprite(mm.beam); beam.center.set(0.5, 0); beam.scale.set(0.16, 1.5, 1); holder.add(beam);
    return holder;
  }

  #acquire(type) {
    const pool = this.pools[type] || (this.pools[type] = []);
    const o = pool.pop() || this.#make(type);
    o.visible = true; this.scene.add(o);
    return o;
  }

  #release(it) {
    if (!it.obj) return;
    it.obj.removeFromParent();
    (this.pools[it.type] || (this.pools[it.type] = [])).push(it.obj);
    it.obj = null;
  }

  #addRows(rows) {
    for (const [id, type, x, y, z] of rows) if (LOOT[type]) this.loot.set(id, { id, type, x, y, z, rot: (id * 2.39996) % (Math.PI * 2), obj: null });
    this.lootDirty = true;
  }

  #streamLoot(cam) {
    const R2 = this.lootR * this.lootR;
    const near = [];
    for (const it of this.loot.values()) {
      const d2 = (it.x - cam.x) ** 2 + (it.z - cam.z) ** 2;
      if (d2 < R2 && Math.abs(it.y - cam.y) < 40) near.push([d2, it]); else if (it.obj) this.#release(it);
    }
    near.sort((a, b) => a[0] - b[0]);
    near.forEach(([, it], i) => {
      if (i >= 70) { this.#release(it); return; }
      if (!it.obj) { it.obj = this.#acquire(it.type); it.obj.position.set(it.x, it.y, it.z); it.obj.rotation.y = it.rot; }
    });
  }

  // ---------------------------------------------------------------- network
  onSnap(m) {
    this.phase = PH[m.ph] || 'lobby';
    this.cd = m.cd || 0;
    this.alive = m.al || 0; this.total = m.tk?.[1] || 0;
    if (m.rg) { const [cx, cz, r, nx, nz, nr, t0, t1, stage, dmg] = m.rg; this.ring = { cx, cz, r, nx, nz, nr, t0: t0 || Infinity, t1: t1 || Infinity, stage, dmg }; } else this.ring = null;
    if (m.pl) { const [x, z, y, dx, dz, ok, k, until] = m.pl; this.plane = { x, z, y, dx, dz, ok, k, until, at: performance.now() }; } else this.plane = null;
    this.me = m.me || {};
    if (this.phase !== 'plane' && this.planeLoop) { this.planeLoop.stop(); this.planeLoop = null; }
  }

  onEvent(e) {
    const g = this.g;
    switch (e.t) {
      case 'loot': for (const it of this.loot.values()) this.#release(it); this.loot.clear(); this.#addRows(e.all); break;
      case 'lootadd': this.#addRows(e.it); break;
      case 'lootdel': { const it = this.loot.get(e.id); if (it) { this.#release(it); this.loot.delete(e.id); } if (e.by === g.myId) g.audio.ui('switch'); break; }
      case 'inv': g.me.applyInventory(e); this.me.ar = e.ar; this.me.md = e.md; break;
      case 'match':
        this.spectate = null; this.placed = null; $('br-result').classList.add('hidden');
        for (const c of this.canopies.values()) c.removeFromParent(); this.canopies.clear();
        g.hud.notice('THE TRANSPORT IS TAKING OFF — GET READY TO JUMP', 4000);
        break;
      case 'ring': g.hud.notice(e.stage >= 1 ? 'THE RING OF FIRE IS CLOSING IN' : '', 3500); break;
      case 'supply': this.#supply(e); g.hud.notice('SUPPLY DROP INBOUND', 3000); break;
      case 'spawn': if (e.id === g.myId) { this.spectate = null; $('br-result').classList.add('hidden'); } break;
      case 'kill':
        if (e.v === g.myId) {
          this.placed = e.place;
          this.spectate = e.k && e.k !== g.myId ? e.k : null;
          this.#result(`YOU PLACED <b>#${e.place}</b>`, e.k && e.k !== g.myId ? `eliminated by ${esc(g.board.get(e.k)?.n || 'enemy')}` : 'eliminated');
        }
        if (e.left > 1) g.hud.notice(`${e.left} SOLDIERS LEFT`, 1800);
        break;
      case 'round': {
        const me = e.winner === g.myId;
        this.#result(me ? '<b>#1 VICTORY</b>' : `<b>${esc(e.name)}</b> WINS`, me ? 'last one standing' : this.placed ? `you placed #${this.placed}` : '');
        if (me) g.audio.ui('capture');
        break;
      }
    }
  }

  #result(title, sub) {
    const r = $('br-result');
    r.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div><div class="n" id="br-next"></div>`;
    r.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- supply drops
  #supply(e) {
    const crate = this.protos.crate ? this.g.assets.clone(this.protos.crate) : new THREE.Group();
    const grp = new THREE.Group(); grp.add(crate);
    const chute = buildCanopy(0xb04a36); chute.scale.setScalar(0.7); chute.position.y = 0.6; grp.add(chute);
    this.scene.add(grp);
    this.drops.push({ ...e, grp, chute, sT: performance.now(), dur: e.land - e.t0 });
  }

  #stepDrops() {
    const now = performance.now();
    for (const d of this.drops) {
      const k = Math.min(1, (now - d.sT) / d.dur);
      d.grp.position.set(d.x, d.y0 + (d.gy - d.y0) * k, d.z);
      d.grp.rotation.y = Math.sin(now / 1400) * 0.2;
      if (k >= 1 && !d.landed) {
        d.landed = true; d.chute.visible = false;
        d.smoke = this.g.effects.addAmbientSmoke(d.x + 1.2, d.gy, d.z, { color: 0xb3261e, rate: 6, rise: 2.4, size: 1.6, alpha: 0.6 });
      }
      if (d.landed && now - d.sT > d.dur + 90000) { d.grp.removeFromParent(); this.g.effects.removeAmbientSmoke(d.smoke); d.gone = true; }
    }
    this.drops = this.drops.filter((d) => !d.gone);
  }

  // ---------------------------------------------------------------- actions
  nearestLoot() {
    const s = this.g.me.s;
    let best = null, bd = ROYALE.pickRange - 0.2;
    for (const it of this.loot.values()) {
      if (!it.obj) continue;
      const d = Math.hypot(it.x - s.x, it.z - s.z);
      if (d < bd && Math.abs(it.y - s.y) < 2) { bd = d; best = it; }
    }
    return best;
  }

  pickup() { const it = this.nearestLoot(); if (it && this.g.me.alive && !this.g.me.s.air) this.g.net.send({ t: 'pick', id: it.id }); }
  heal() { if (this.g.me.alive && (this.me.md || 0) > 0) this.g.net.send({ t: 'heal' }); }
  jump() { if (this.inPlane && this.plane?.ok) this.g.net.send({ t: 'jump' }); }

  planePos() {
    const P = this.plane; if (!P) return null;
    const dt = (performance.now() - P.at) / 1000;
    return _v.set(P.x + P.dx * ROYALE.planeSpeed * dt, P.y, P.z + P.dz * ROYALE.planeSpeed * dt).clone();
  }

  // ---------------------------------------------------------------- camera (returns true when handled)
  updateCamera(cam, dt) {
    const me = this.g.me;
    if (this.inPlane && this.plane) {
      // chase camera orbiting the transport plane (mouse / drag to look around)
      const p = this.planePos(), yaw = me.yaw, pitch = Math.max(-1.2, Math.min(0.35, me.pitch - 0.25));
      const back = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch) + 0.15, Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(48);
      cam.position.copy(p).add(back);
      cam.lookAt(p.x, p.y + 2, p.z);
      return true;
    }
    if (me.alive || this.phase === 'lobby') return false;
    // spectate: the killer first, then whoever is still alive
    const P = this.g.players;
    let t = this.spectate && P.info(this.spectate);
    if (!t || !t.alive) {
      t = [...P.map.values()].find((q) => q.alive && q.id !== this.g.myId);
      this.spectate = t ? t.id : null;
    }
    if (!t) return false;
    const yaw = t.yaw ?? 0;
    const target = new THREE.Vector3(t.x + Math.sin(yaw) * 3.4 + Math.cos(yaw) * 0.7, t.y + 2.1, t.z + Math.cos(yaw) * 3.4 - Math.sin(yaw) * 0.7);
    cam.position.lerp(target, 1 - Math.exp(-6 * dt));
    cam.lookAt(t.x - Math.sin(yaw) * 20, t.y + 1.2, t.z - Math.cos(yaw) * 20);
    this.specName = t.name;
    return true;
  }

  // ---------------------------------------------------------------- per frame
  update(dt, cam) {
    const g = this.g, now = g.net.serverNow();
    // ring of fire
    const rg = this.ring && ringAt(this.ring, now);
    this.ringWall.visible = !!rg && this.phase !== 'lobby';
    if (rg) {
      this.ringWall.position.set(rg.x, -40, rg.z); this.ringWall.scale.set(rg.r, 210, rg.r);
      const u = this.ringWall.material.uniforms; u.uTime.value += dt; u.uRadius.value = rg.r; u.uHeight.value = 210;
    }
    const s = g.me.s;
    const outside = rg && this.phase !== 'lobby' && (g.me.alive ? Math.hypot(s.x - rg.x, s.z - rg.z) > rg.r : false);
    $('br-fire').style.opacity = outside ? 1 : 0;
    // plane
    const pp = this.phase === 'plane' && this.plane ? this.planePos() : null;
    this.planeMesh.visible = !!pp;
    if (pp) {
      this.planeMesh.position.copy(pp);
      this.planeMesh.rotation.set(0, Math.atan2(-this.plane.dx, -this.plane.dz), 0);
      this.planeMesh.userData.update?.(dt);
      if (!this.planeLoop) this.planeLoop = g.audio.loop('engine');
      const d = cam.position.distanceTo(pp);
      this.planeLoop?.set(this.inPlane ? 0.55 : Math.max(0, 0.5 - d / 900), 240);
    }
    // wind while falling
    const air = g.me.alive ? s.air || 0 : 0;
    if (air && !this.wind) this.wind = g.audio.loop('wind');
    if (this.wind) {
      const sp = Math.hypot(s.vx, s.vy, s.vz);
      this.wind.set(air ? Math.min(0.5, sp / 110) : 0, air === 1 ? 500 + sp * 12 : 380);
      if (!air) { this.wind.stop(); this.wind = null; }
    }
    // extend the view while high up (otherwise the island is hidden in fog from the plane)
    const alt = cam.position.y;
    const fog = this.g.world.scene.fog, baseFar = this.baseFogFar ?? (this.baseFogFar = fog.far);
    const wantFar = alt > 40 ? Math.min(900, baseFar + alt * 1.6) : baseFar;
    if (Math.abs(fog.far - wantFar) > 2) { fog.far += (wantFar - fog.far) * Math.min(1, dt * 2); g.camera.far = fog.far + 60; g.camera.updateProjectionMatrix(); }
    // parachutes (everyone, including the local third-person body)
    for (const p of g.players.map.values()) {
      const chute = p.alive && (p.flags & 64) && p.rig?.root.visible;
      let c = this.canopies.get(p.id);
      if (chute) {
        if (!c) { c = buildCanopy(); this.scene.add(c); this.canopies.set(p.id, c); c.scale.setScalar(0.05); }
        c.scale.setScalar(Math.min(1, c.scale.x + dt * 2.2));
        c.position.set(p.x, p.y + 1.45, p.z);
        c.rotation.set(Math.sin(performance.now() / 900 + p.id) * 0.05, p.yaw, Math.sin(performance.now() / 1300 + p.id) * 0.06);
      } else if (c) { c.removeFromParent(); this.canopies.delete(p.id); }
    }
    this.#stepDrops();
    // loot streaming (4 Hz) + pickup prompt
    this.lootT = (this.lootT || 0) + dt;
    if (this.lootT > 0.25 || this.lootDirty) { this.lootT = 0; this.lootDirty = false; if (this.discGeo) this.#streamLoot(cam.position); }
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.#hud(rg, now); }
  }

  #hud(rg, now) {
    const g = this.g, me = this.me;
    let top = '', sub = '';
    if (this.phase === 'lobby') {
      top = this.cd ? `MATCH STARTS IN ${fmt(this.cd)}` : 'WAITING FOR PLAYERS'; sub = `${g.board.size} SOLDIERS IN LOBBY`;
      const pc = $('brr-count'); if (pc) { pc.textContent = g.board.size; $('brr-players').textContent = `${g.board.size}/${g.room.max || 24}`; }
    }
    else if (this.phase === 'plane' && this.inPlane) {
      top = this.plane?.ok ? `PRESS ${g.isTouch ? 'JUMP' : 'SPACE'} TO JUMP` : 'APPROACHING THE ISLAND';
      sub = this.plane?.ok ? `forced exit in ${fmt((this.plane.until - this.plane.k) * this.totalPlaneMs())}` : 'look around — pick your landing spot on the map';
    }
    else if (g.me.alive && g.me.s.air === 1) { top = 'FREEFALL'; sub = 'SPACE / JUMP: open parachute · look down to dive'; }
    else if (g.me.alive && g.me.s.air === 2) { top = 'PARACHUTE'; sub = 'steer with WASD / stick'; }
    else if (this.ring && this.phase !== 'over') {
      if (now < this.ring.t0) { top = `RING CLOSES IN ${fmt(this.ring.t0 - now)}`; }
      else if (now < this.ring.t1) { top = `RING CLOSING ${fmt(this.ring.t1 - now)}`; }
      else top = 'FINAL RING';
      if (!g.me.alive && this.specName) sub = `SPECTATING ${esc(this.specName)}`;
    }
    if (this.phase === 'over') { const n = $('br-next'); if (n) n.textContent = `next match in ${fmt(this.cd)}`; }
    $('br-top').textContent = top; $('br-sub').innerHTML = sub;
    document.body.classList.toggle('br-lobby', this.phase === 'lobby');
    document.body.classList.toggle('br-out', !g.me.alive);
    $('br-al').textContent = this.alive;
    $('br-k').textContent = g.board.get(g.myId)?.k ?? 0;
    const ar = me.ar || 0;
    $('br-ar').textContent = ar; document.querySelector('#br-armor .bar i').style.width = `${ar}%`;
    $('br-inv').innerHTML = `<span class="${me.md ? '' : 'none'}">✚ MED ×${me.md || 0} <kbd>H</kbd></span><span class="${g.me.grenades ? '' : 'none'}">FRAG ×${g.me.grenades || 0} <kbd>G</kbd></span>`;
    const heal = $('br-heal');
    heal.classList.toggle('hidden', !(me.hl > 0));
    if (me.hl > 0) heal.querySelector('i').style.width = `${(1 - me.hl / (ROYALE.healTime * 1000)) * 100}%`;
    const it = g.me.alive && !g.me.s.air ? this.nearestLoot() : null;
    const pr = $('br-prompt');
    pr.classList.toggle('hidden', !it);
    if (it) pr.innerHTML = `<kbd>${g.isTouch ? 'PICK' : 'E'}</kbd> ${esc(LOOT[it.type].name)}`;
    this.promptItem = it;
    const showMap = this.mapHeld || this.inPlane || this.phase === 'lobby';
    $('br-map').classList.toggle('hidden', !showMap);
    if (showMap) this.#drawMap(rg);
  }

  // flight path length is 2.5 x PLAY_HALF (shared/royale.js planeLine)
  totalPlaneMs() { return ((PLAY_HALF * 2.5) / ROYALE.planeSpeed) * 1000; }

  // ---------------------------------------------------------------- maps
  drawMinimap(c, tx, tz, k) {
    const now = this.g.net.serverNow(), rg = this.ring && ringAt(this.ring, now);
    if (rg) {
      c.lineWidth = 3; c.strokeStyle = 'rgba(255,110,40,.85)'; c.beginPath(); c.arc(tx(rg.x), tz(rg.z), rg.r * k, 0, 7); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(tx(this.ring.nx), tz(this.ring.nz), this.ring.nr * k, 0, 7); c.stroke();
    }
    c.fillStyle = 'rgba(255,90,70,.9)';
    for (const d of this.drops) { c.beginPath(); c.arc(tx(d.x), tz(d.z), 4, 0, 7); c.fill(); }
  }

  #drawMap(rg) {
    const c = $('br-map').getContext('2d'), S = 360, H = PLAY_HALF * 1.05, k = S / (H * 2);
    const X = (x) => (x + H) * k, Z = (z) => (z + H) * k;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(52,60,44,.82)'; c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(190,185,170,.7)';
    for (const r of ROADS) { c.lineWidth = Math.max(1, r.w * k); c.beginPath(); c.moveTo(X(r.ax), Z(r.az)); c.lineTo(X(r.bx), Z(r.bz)); c.stroke(); }
    c.fillStyle = 'rgba(225,220,205,.8)';
    for (const b of BUILDINGS) c.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), Math.max(1.5, b.w * k), Math.max(1.5, b.d * k));
    if (rg && this.phase !== 'lobby') {
      c.save(); c.beginPath(); c.rect(0, 0, S, S); c.moveTo(X(rg.x) + rg.r * k, Z(rg.z)); c.arc(X(rg.x), Z(rg.z), rg.r * k, 0, Math.PI * 2, true); c.fillStyle = 'rgba(255,70,20,.28)'; c.fill('evenodd'); c.restore();
      c.lineWidth = 2; c.strokeStyle = '#ff7a2e'; c.beginPath(); c.arc(X(rg.x), Z(rg.z), rg.r * k, 0, 7); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.setLineDash([5, 4]); c.beginPath(); c.arc(X(this.ring.nx), Z(this.ring.nz), this.ring.nr * k, 0, 7); c.stroke(); c.setLineDash([]);
    }
    if (this.phase === 'plane' && this.plane) {
      const p = this.planePos(), L = PLAY_HALF * 1.3;
      c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.5; c.setLineDash([8, 6]);
      c.beginPath(); c.moveTo(X(p.x - this.plane.dx * L * 2), Z(p.z - this.plane.dz * L * 2)); c.lineTo(X(p.x + this.plane.dx * L * 2), Z(p.z + this.plane.dz * L * 2)); c.stroke(); c.setLineDash([]);
      c.save(); c.translate(X(p.x), Z(p.z)); c.rotate(Math.atan2(this.plane.dz, this.plane.dx) + Math.PI / 2);
      c.fillStyle = '#ffd24a'; c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(-6, 7); c.closePath(); c.fill(); c.restore();
    }
    c.fillStyle = '#ff4a3a';
    for (const d of this.drops) { c.beginPath(); c.arc(X(d.x), Z(d.z), 4, 0, 7); c.fill(); }
    const me = this.g.me;
    if (me.alive) {
      c.save(); c.translate(X(me.s.x), Z(me.s.z)); c.rotate(-me.yaw);
      c.fillStyle = '#4de0ff'; c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill(); c.restore();
    }
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.strokeRect(X(-PLAY_HALF), Z(-PLAY_HALF), PLAY_HALF * 2 * k, PLAY_HALF * 2 * k);
  }
}
