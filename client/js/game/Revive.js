// Casualties and medics, client side.
//   - downed teammates: a marker over each (medics see them from much further, with the distance), a cross on the minimap
//   - a medic within reach: "HOLD E — REVIVE <name>" with the progress of the hold; the server does the timing
//   - downed myself: the world stays in view (a slow camera over the body, the mouse turns it), bleeding-out timer,
//     how far the nearest medic is, and HOLD SPACE / the button to give up and go to the deploy screen
import * as THREE from 'three';
import { CLASSES } from '/shared/weapons.js';

const REVIVE_MS = 2500, REACH = 2.4, KEEP = 2.7, BLEED_S = 15, GIVEUP_MS = 1000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _v = new THREE.Vector3();
// write to the DOM only when the value changed (these run every frame)
const put = (el, k, v) => { if (el['_' + k] === v) return; el['_' + k] = v; if (k === 'html') el.innerHTML = v; else if (k === 'text') el.textContent = v; else el.style[k] = v; };

export class Revive {
  constructor(game) {
    this.g = game;
    this.list = [];        // [id, team, x, y, z, secondsLeft] from the snapshot
    this.down = null;      // I am down: { x, y, z, left, at }
    this.target = null;    // the downed teammate within my reach (medic only)
    this.working = null;   // { id, t0 } while I hold the revive on someone
    this.hold = false;     // touch REVIVE button held
    this.orbit = { yaw: 0, el: 0.55, set: false };
    this.giveT0 = 0;
    this.marks = [];
    this.#ui();
    this.#bind();
  }

  #ui() {
    const m = document.createElement('div'); m.id = 'dnmarks'; document.body.appendChild(m);
    const p = document.createElement('div'); p.id = 'rprompt'; p.style.display = 'none';
    p.innerHTML = '<div class="rp-t"></div><div class="rp-bar"><i></i></div>';
    document.body.appendChild(p);
    const d = document.createElement('div'); d.id = 'downed'; d.className = 'hidden';
    d.innerHTML = `<div class="dn-box">
        <div class="dn-t"><svg class="ic"><use href="#i-cross"/></svg>YOU ARE DOWN</div>
        <div class="dn-bar"><i></i></div>
        <div class="dn-s">BLEEDING OUT IN <b>15</b> s</div>
        <div class="dn-m"></div>
        <div class="dn-k"></div>
        <button id="dn-give"><span>REDEPLOY</span><small>${this.g.isTouch ? 'TAP' : 'HOLD SPACE'}</small><i></i></button>
      </div>`;
    document.body.appendChild(d);
    $('dn-give').addEventListener('click', (e) => { e.preventDefault(); this.giveUp(); });
  }

  #bind() {
    const el = this.g.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && this.down && !this.g.chatOpen) { this.giveT0 = performance.now(); e.preventDefault(); }
    });
    addEventListener('keyup', (e) => { if (e.code === 'Space') this.giveT0 = 0; });
    // down: the mouse turns the camera round the body (and a click takes the mouse back after Esc)
    addEventListener('mousemove', (e) => {
      if (!this.down || document.pointerLockElement !== el) return;
      this.orbit.yaw -= e.movementX * 0.004;
      this.orbit.el = Math.max(0.12, Math.min(1.25, this.orbit.el + e.movementY * 0.003));
    });
    el.addEventListener('mousedown', () => { if (this.down && document.pointerLockElement !== el && !this.g.isTouch) el.requestPointerLock?.()?.catch?.(() => {}); });
  }

  isMedic() { return !!CLASSES[this.g.myCls]?.medic; }
  name(id) { return this.g.board?.get(id)?.n || 'soldier'; }
  mates() { return this.list.filter((d) => d[1] === this.g.myTeam && d[0] !== this.g.myId); }

  onSnap(m) {
    this.list = m.dn || [];
    const mine = this.list.find((d) => d[0] === this.g.myId);
    if (this.down) {
      if (mine) Object.assign(this.down, { x: mine[2], y: mine[3], z: mine[4], left: mine[5] });
      // (no longer on the list and still dead: bled out / round reset while a message was lost)
      else if (!this.g.me.alive && performance.now() - this.down.at > 1500) this.#lost();
    }
    this.g.hud.downed = this.mates();
  }

  onEvent(e) {
    const g = this.g, me = g.me;
    switch (e.t) {
      case 'kill': {
        if (e.v === g.myId && e.dn) {
          this.down = { x: me.s.x, y: me.s.y, z: me.s.z, left: BLEED_S, at: performance.now() };
          this.orbit.set = false; this.giveT0 = 0;
        } else if (e.dn && this.isMedic() && me.alive) {
          // a teammate down close by: worth telling the medic
          const v = g.players.info(e.v), r = g.board?.get(e.v);
          if (v && r?.tm === g.myTeam) {
            const d = Math.hypot(v.x - me.s.x, v.z - me.s.z);
            if (d < 60) g.hud.notice(`${this.name(e.v).toUpperCase()} IS DOWN · ${Math.round(d)} m`, 2500);
          }
        }
        break;
      }
      case 'revive': {
        const rp = g.players.info(e.id); if (rp) rp.revivedAt = performance.now();
        if (e.id === g.myId) g.onLocalRevive(e, this.name(e.by));
        if (e.by === g.myId) {
          this.working = null;
          g.hud.notice(`REVIVED ${this.name(e.id).toUpperCase()}  +50`, 2200);
          g.audio.ui('revive');
          g.statsAdd({ xp: 50, revives: 1 });
        }
        this.list = this.list.filter((d) => d[0] !== e.id);
        break;
      }
      case 'bledout':
        if (e.id === g.myId && this.down) this.#lost();
        this.list = this.list.filter((d) => d[0] !== e.id);
        break;
      case 'spawn':
        if (e.id === g.myId) this.close();
        break;
    }
  }

  // shown a moment after going down (once the killcam has turned to the killer)
  showDowned(killer) {
    if (!this.down || this.g.me.alive) return false;
    $('downed').classList.remove('hidden');
    document.body.classList.add('downed');
    $('downed').querySelector('.dn-k').innerHTML = killer || '';
    return true;
  }

  giveUp() {
    if (!this.down) return;
    this.g.net.send({ t: 'giveup' });
    this.#lost();
  }

  // down no more without a revive (gave up, bled out): on to the deploy screen
  #lost() {
    this.close();
    if (!this.g.me.alive) { document.exitPointerLock?.(); this.g.openDeploy(); }
  }

  close() {
    this.down = null; this.giveT0 = 0;
    $('downed').classList.add('hidden');
    document.body.classList.remove('downed');
  }

  // the camera while down: over the body, slowly coming round, kept out of the walls
  updateCamera(cam, dt) {
    const d = this.down;
    if (!d || this.g.me.alive) return false;
    const o = this.orbit;
    if (!o.set) {
      // start behind the way the camera faced (the killcam turned it toward the killer)
      cam.getWorldDirection(_v);
      o.yaw = Math.atan2(-_v.x, -_v.z); o.el = 0.55; o.set = true;
    }
    if (!document.pointerLockElement) o.yaw += dt * 0.07;
    const pivot = new THREE.Vector3(d.x, d.y + 0.5, d.z);
    const dir = new THREE.Vector3(Math.sin(o.yaw) * Math.cos(o.el), Math.sin(o.el), Math.cos(o.yaw) * Math.cos(o.el));
    const hit = this.g.world.collision.raycast(pivot, dir, 3.6, true);
    const R = hit ? Math.max(0.6, hit.t - 0.3) : 3.6;
    const want = pivot.clone().addScaledVector(dir, R);
    cam.position.lerp(want, 1 - Math.exp(-5 * dt));
    cam.lookAt(pivot.x, pivot.y - 0.9, pivot.z); // (the body in the upper half, clear of the text)
    return true;
  }

  update(dt, cam) {
    const g = this.g, me = g.me, now = performance.now();
    // ---- my own revive hold (medic)
    const medic = me.alive && !g.vehicles.mine && this.isMedic() && !g.royale;
    let tgt = null;
    if (medic) {
      let best = Infinity;
      for (const d of this.mates()) {
        const r = Math.hypot(d[2] - me.s.x, d[4] - me.s.z);
        const reach = this.working?.id === d[0] ? KEEP : REACH;
        if (r < reach && Math.abs(d[3] - me.s.y) < 1.4 && r < best) { best = r; tgt = d; }
      }
    }
    this.target = tgt;
    const held = !!tgt && ((me.keys.has('KeyE') && !g.chatOpen) || this.hold);
    if (held && this.working?.id !== tgt[0]) {
      if (this.working) g.net.send({ t: 'revive', id: this.working.id, on: false });
      this.working = { id: tgt[0], t0: now };
      g.net.send({ t: 'revive', id: tgt[0], on: true });
    } else if (!held && this.working) {
      g.net.send({ t: 'revive', id: this.working.id, on: false });
      this.working = null;
    } else if (held && now - this.working.t0 > REVIVE_MS + 900) {
      // (the server didn't take it — out of its reach by a hair when I started): start again
      this.working.t0 = now; g.net.send({ t: 'revive', id: tgt[0], on: true });
    }
    const pr = $('rprompt');
    put(pr, 'display', tgt ? 'block' : 'none');
    if (tgt) {
      put(pr.querySelector('.rp-t'), 'html', `<b>${g.isTouch ? 'HOLD REVIVE' : 'HOLD E'}</b> — REVIVE ${esc(this.name(tgt[0]).toUpperCase())}`);
      put(pr.querySelector('.rp-bar i'), 'width', `${this.working ? Math.round(Math.min(100, ((now - this.working.t0) / REVIVE_MS) * 100)) : 0}%`);
    }
    this.#markers(cam, medic);
    // ---- down myself
    if (this.down && !$('downed').classList.contains('hidden')) {
      const d = this.down, box = $('downed');
      put(box.querySelector('.dn-s b'), 'text', String(Math.max(0, d.left)));
      put(box.querySelector('.dn-bar i'), 'width', `${Math.round(Math.max(0, Math.min(1, d.left / BLEED_S)) * 100)}%`);
      const m = this.#nearestMedic(), dm = box.querySelector('.dn-m');
      put(dm, 'html', m ? `<b>MEDIC ${Math.round(m.d)} m AWAY</b> — HOLD ON` : 'NO MEDIC NEARBY');
      put(dm, 'color', m && m.d < 60 ? 'var(--ok)' : '');
      const k = this.giveT0 ? Math.min(1, (now - this.giveT0) / GIVEUP_MS) : 0;
      put($('dn-give').querySelector('i'), 'width', `${Math.round(k * 100)}%`);
      if (k >= 1) this.giveUp();
      // a slow heartbeat
      if (now > (this.beatAt || 0)) { this.beatAt = now + 1100; g.audio.ui('heart'); }
    }
  }

  #nearestMedic() {
    const g = this.g, d = this.down;
    let best = null;
    for (const p of g.players.map.values()) {
      if (!p.alive || p.id === g.myId || p.team !== g.myTeam || g.board?.get(p.id)?.c !== 'medic' || (p.flags & 128)) continue;
      const r = Math.hypot(p.x - d.x, p.z - d.z);
      if (!best || r < best.d) best = { p, d: r };
    }
    return best;
  }

  // markers over downed teammates (and, while I am down, over the medics coming for me)
  #markers(cam, medic) {
    const g = this.g, W = innerWidth, H = innerHeight, show = [];
    if (cam && !g.royale) {
      for (const d of this.mates()) {
        if (d === this.target) continue; // (in reach: the prompt says it)
        const r = cam.position.distanceTo(_v.set(d[2], d[3], d[4]));
        if (r > (medic ? 150 : 45)) continue;
        show.push({ x: d[2], y: d[3] + 0.7, z: d[4], cls: medic ? 'dn med' : 'dn', html: `<svg class="ic"><use href="#i-cross"/></svg><span>${medic ? `${Math.round(r)} m · ` : ''}${Math.max(0, d[5])} s</span>` });
      }
      if (this.down && !g.me.alive) {
        for (const p of g.players.map.values()) {
          if (!p.alive || p.team !== g.myTeam || g.board?.get(p.id)?.c !== 'medic' || (p.flags & 128)) continue;
          if (Math.hypot(p.x - this.down.x, p.z - this.down.z) > 80) continue;
          show.push({ x: p.x, y: p.y + 2.1, z: p.z, cls: 'mc', html: '<svg class="ic"><use href="#i-cross"/></svg><span>MEDIC</span>' });
        }
      }
    }
    const root = $('dnmarks');
    while (this.marks.length < show.length) { const e = document.createElement('div'); root.appendChild(e); this.marks.push(e); }
    this.marks.forEach((e, i) => {
      const s = show[i];
      if (!s) { e.style.display = 'none'; return; }
      _v.set(s.x, s.y, s.z).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { e.style.display = 'none'; return; }
      e.style.display = '';
      if (e.className !== s.cls) e.className = s.cls;
      if (e._h !== s.html) { e.innerHTML = s.html; e._h = s.html; }
      e.style.transform = `translate(${((_v.x + 1) / 2) * W}px, ${((1 - _v.y) / 2) * H}px) translate(-50%, -100%)`;
    });
  }
}
