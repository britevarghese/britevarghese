// DOM HUD: tickets & flags, capture status, minimap, kill feed, ammo, health, hit markers, damage direction,
// scoreboard, chat, deploy screen (kit + spawn selection) and round end.
import { FLAGS, BUILDINGS, ROADS, BASES, PLAY_HALF, TEAM_NAMES } from '/shared/map.js';
import { WEAPONS, CLASSES } from '/shared/weapons.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.flagEls = {};
    for (const f of FLAGS) { const d = document.createElement('div'); d.className = 'flag'; d.innerHTML = `<span>${f.id}</span>`; $('flags').appendChild(d); this.flagEls[f.id] = d; }
    this.mm = $('minimap').getContext('2d');
    this.board = [];
    this.myTeam = 1;
    this.selectedClass = localStorage.getItem('sp_class') || 'assault';
    this.selectedSpawn = 'base';
    this.#buildClasses();
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  #buildClasses() {
    const c = $('classes'); c.innerHTML = '';
    for (const [id, k] of Object.entries(CLASSES)) {
      const d = document.createElement('div');
      d.className = `cls${id === this.selectedClass ? ' sel' : ''}`;
      d.innerHTML = `<b>${k.name.toUpperCase()}</b><div>${WEAPONS[k.primary].name} · ${WEAPONS[k.secondary].name} · ${k.grenades}x frag</div>`;
      d.onclick = () => { this.selectedClass = id; localStorage.setItem('sp_class', id); this.#buildClasses(); };
      c.appendChild(d);
    }
  }

  tickets(t) {
    const us = this.myTeam === 1 ? t[0] : t[1], ru = this.myTeam === 1 ? t[1] : t[0];
    $('tk-us').textContent = us; $('tk-ru').textContent = ru;
    document.querySelector('.tk.us .lbl').textContent = TEAM_NAMES[this.myTeam];
    document.querySelector('.tk.ru .lbl').textContent = TEAM_NAMES[this.myTeam === 1 ? 2 : 1];
    document.querySelector('.tk.us .bar i').style.width = `${(us / 300) * 100}%`;
    document.querySelector('.tk.ru .bar i').style.width = `${(ru / 300) * 100}%`;
  }

  flags(fs, me) {
    this.flagState = fs;
    let inside = null;
    for (const [id, owner, prog, cont] of fs) {
      const el = this.flagEls[id];
      el.className = `flag${owner === 0 ? '' : owner === this.myTeam ? ' own' : ' enemy'}${cont ? ' contested' : ''}`;
      const f = FLAGS.find((x) => x.id === id);
      if (me && Math.hypot(me.x - f.x, me.z - f.z) < f.r) inside = { id, owner, prog, cont };
    }
    const cap = $('capture');
    if (inside) {
      cap.classList.remove('hidden');
      const mine = this.myTeam === 1 ? inside.prog : -inside.prog;
      const title = inside.cont ? 'CONTESTED' : inside.owner === this.myTeam && Math.abs(inside.prog) >= 1 ? 'SECURED' : mine >= 0 ? 'CAPTURING' : 'NEUTRALIZING';
      cap.querySelector('.cap-title').textContent = `${title} ${inside.id}`;
      const bar = cap.querySelector('.cap-bar i');
      bar.style.width = `${Math.abs(inside.prog) * 100}%`;
      bar.style.background = inside.prog === 0 ? '#fff' : (inside.prog > 0) === (this.myTeam === 1) ? 'var(--us)' : 'var(--ru)';
    } else cap.classList.add('hidden');
  }

  vitals(me, w, slot, grenades, stance, reloading, zero = 0) {
    $('hp').textContent = Math.max(0, Math.round(me.hp));
    document.querySelector('.hpbar i').style.width = `${Math.max(0, me.hp)}%`;
    document.querySelector('.hpbar i').style.background = me.hp < 30 ? '#ff6b5b' : '#e9ecec';
    $('vignette').style.boxShadow = `inset 0 0 ${140 + (100 - me.hp) * 2}px rgba(130,0,0,${Math.max(0, (60 - me.hp) / 90)})`;
    if (w) {
      const def = WEAPONS[w.id];
      $('wname').textContent = def.name;
      $('mag').textContent = reloading ? '—' : w.mag;
      $('reserve').textContent = w.reserve;
      $('ammo').classList.toggle('low', w.mag <= def.mag * 0.25);
      $('firemode').innerHTML = `${def.auto ? 'AUTO' : def.bolt ? 'BOLT' : 'SEMI'}${zero ? ` · <span class="zero">${zero} m</span>` : ''}`;
    }
    $('nades').textContent = `G x${grenades}`;
    $('stance').textContent = stance.toUpperCase();
  }

  crosshair(spread, ads, visible, onEnemy = false) {
    const c = $('crosshair');
    c.style.opacity = visible && !ads ? 1 : 0;
    c.classList.toggle('enemy', onEnemy);
    const g = 4 + spread * 7;
    c.querySelector('.t').style.top = `${-g - 8}px`; c.querySelector('.b').style.top = `${g}px`;
    c.querySelector('.l').style.left = `${-g - 8}px`; c.querySelector('.r').style.left = `${g}px`;
  }

  // confirmed hit (server-authoritative, arrives when the bullet actually reaches the target):
  // X marker on the crosshair + damage number (+ headshot / kill / distance)
  hitmarker(kill, hs = false, dmg = 0, dist = 0) {
    const h = $('hitmarker'); h.className = ''; void h.offsetWidth; h.className = `show${kill ? ' kill' : hs ? ' hs' : ''}`;
    if (!dmg) return;
    const d = document.createElement('div');
    d.className = `dmgpop${kill ? ' kill' : hs ? ' hs' : ''}`;
    d.innerHTML = `${kill ? 'ELIMINATED ' : hs ? 'HEADSHOT ' : ''}<b>${dmg}</b>${dist >= 40 ? `<span>${dist} m</span>` : ''}`;
    d.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}px`);
    document.getElementById('hud').appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  damageFrom(angle) {
    const i = document.createElement('i');
    i.style.transform = `rotate(${angle}rad)`;
    $('dmgdir').appendChild(i);
    setTimeout(() => i.remove(), 1600);
  }

  killfeed(killer, victim, weapon, hs, players) {
    const k = players.get(killer), v = players.get(victim);
    const solo = document.body.classList.contains('royale');
    const cls = (id, p) => (p ? (solo ? (id === this.meId ? 'us' : 'ru') : p.team === this.myTeam ? 'us' : 'ru') : '');
    const d = document.createElement('div'); d.className = 'kf';
    const wname = WEAPONS[weapon]?.name || (weapon === 'grenade' ? 'Frag grenade' : weapon);
    d.innerHTML = k && killer !== victim ? `<span class="${cls(killer, k)}">${esc(k.name)}</span><span class="w">[${esc(wname)}]</span>${hs ? '<span class="hs">HS </span>' : ''}<span class="${cls(victim, v)}">${esc(v?.name || '?')}</span>` : `<span class="${cls(victim, v)}">${esc(v?.name || '?')}</span><span class="w">[${esc(wname)}]</span>`;
    $('killfeed').prepend(d);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
    setTimeout(() => d.remove(), 6500);
  }

  hurtFlash() { const v = $('hurtflash'); v.className = ''; void v.offsetWidth; v.className = 'show'; }

  notice(msg, ms = 2200) { const n = $('notice'); n.textContent = msg; clearTimeout(this._nt); this._nt = setTimeout(() => (n.textContent = ''), ms); }

  chat(from, msg, team) {
    const d = document.createElement('div');
    d.className = from === 'SERVER' ? 'sys' : team === this.myTeam ? 'us' : 'ru';
    d.textContent = from === 'SERVER' ? msg : `${from}: ${msg}`;
    $('chatlog').appendChild(d);
    while ($('chatlog').children.length > 8) $('chatlog').firstChild.remove();
    setTimeout(() => d.remove(), 12500);
  }

  scoreboard(show, myId) {
    const sb = $('scoreboard');
    sb.classList.toggle('hidden', !show);
    if (!show) return;
    if (document.body.classList.contains('royale')) {
      // battle royale: one list, survivors first, then by placement / kills
      const rows = [...this.board].sort((a, b) => b.a - a.a || (a.pc || 99) - (b.pc || 99) || b.k - a.k);
      sb.innerHTML = `<div class="us solo"><h3>SOLDIERS · ${rows.filter((r) => r.a).length} ALIVE</h3><table><tr><th>#</th><th>Name</th><th>Kills</th><th>Ping</th></tr>${rows.map((r) => `<tr class="${r.id === myId ? 'me' : ''} ${r.a ? '' : 'dead'}"><td>${r.a ? '—' : r.pc || '—'}</td><td>${esc(r.n)}</td><td>${r.k}</td><td>${r.b ? 'BOT' : r.png}</td></tr>`).join('')}</table></div>`;
      return;
    }
    const col = (team) => {
      const rows = this.board.filter((r) => r.tm === team).sort((a, b) => b.s - a.s);
      return `<div class="${team === this.myTeam ? 'us' : 'ru'}"><h3>${TEAM_NAMES[team]}</h3><table><tr><th>Name</th><th>K</th><th>D</th><th>Score</th><th>Ping</th></tr>${rows.map((r) => `<tr class="${r.id === myId ? 'me' : ''} ${r.a ? '' : 'dead'}"><td>${esc(r.n)}</td><td>${r.k}</td><td>${r.d}</td><td>${r.s}</td><td>${r.b ? 'BOT' : r.png}</td></tr>`).join('')}</table></div>`;
    };
    sb.innerHTML = col(this.myTeam) + col(this.myTeam === 1 ? 2 : 1);
  }

  // ---------------------------------------------------------------- minimap (rotates with the player)
  minimap(me, yaw, players, myId, flagsState, royale = null) {
    const g = this.mm, S = 220, R = royale ? 150 : 90; // metres radius shown
    const k = S / 2 / R;
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(S / 2, S / 2); g.rotate(yaw);
    const tx = (x) => (x - me.x) * k, tz = (z) => (z - me.z) * k;
    g.strokeStyle = 'rgba(150,150,140,.45)';
    for (const r of ROADS) { g.lineWidth = r.w * k; g.beginPath(); g.moveTo(tx(r.ax), tz(r.az)); g.lineTo(tx(r.bx), tz(r.bz)); g.stroke(); }
    g.fillStyle = 'rgba(200,200,190,.5)';
    for (const b of BUILDINGS) g.fillRect(tx(b.x - b.w / 2), tz(b.z - b.d / 2), b.w * k, b.d * k);
    g.strokeStyle = 'rgba(255,80,60,.5)'; g.lineWidth = 1; g.strokeRect(tx(-PLAY_HALF), tz(-PLAY_HALF), PLAY_HALF * 2 * k, PLAY_HALF * 2 * k);
    for (const f of FLAGS) {
      const st = flagsState?.find((x) => x[0] === f.id);
      const owner = st ? st[1] : 0;
      g.fillStyle = owner === 0 ? '#ddd' : owner === this.myTeam ? '#4d8fe0' : '#e0574d';
      g.save(); g.translate(tx(f.x), tz(f.z)); g.rotate(-yaw); g.beginPath(); g.arc(0, 0, 8, 0, 7); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1;
      g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.id, 0, 0); g.restore();
    }
    royale?.drawMinimap(g, tx, tz, k);
    for (const p of players.values()) {
      if (p.id === myId || !p.alive) continue;
      const friendly = !royale && p.team === this.myTeam;
      if (!friendly && !(p.spottedUntil > performance.now())) continue;
      g.fillStyle = friendly ? '#6fb0ff' : '#ff5e4d';
      g.beginPath(); g.arc(tx(p.x), tz(p.z), 3.2, 0, 7); g.fill();
    }
    g.restore();
    // player arrow
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(S / 2, S / 2 - 7); g.lineTo(S / 2 + 5, S / 2 + 5); g.lineTo(S / 2 - 5, S / 2 + 5); g.closePath(); g.fill();
  }

  // ---------------------------------------------------------------- deploy screen
  deployScreen(show, { team, flagsState, onDeploy, respawnIn = 0, killer = null } = {}) {
    $('deploy').classList.toggle('hidden', !show);
    if (!show) return;
    $('killcam').classList.toggle('hidden', !killer);
    if (killer) $('killcam').innerHTML = killer;
    const owned = ['base', ...(flagsState || []).filter((f) => f[1] === team).map((f) => f[0])];
    if (!owned.includes(this.selectedSpawn)) this.selectedSpawn = 'base';
    const sp = $('spawns'); sp.innerHTML = '';
    for (const id of owned) {
      const b = document.createElement('div'); b.className = `sp${id === this.selectedSpawn ? ' sel' : ''}`; b.textContent = id === 'base' ? 'HQ' : id;
      b.onclick = () => { this.selectedSpawn = id; this.deployScreen(true, { team, flagsState, onDeploy, respawnIn, killer }); };
      sp.appendChild(b);
    }
    // map
    const c = $('deploymap').getContext('2d'), S = 300, k = S / (PLAY_HALF * 2);
    c.clearRect(0, 0, S, S);
    const X = (x) => (x + PLAY_HALF) * k, Z = (z) => (z + PLAY_HALF) * k;
    c.strokeStyle = 'rgba(160,160,150,.6)';
    for (const r of ROADS) { c.lineWidth = r.w * k; c.beginPath(); c.moveTo(X(r.ax), Z(r.az)); c.lineTo(X(r.bx), Z(r.bz)); c.stroke(); }
    c.fillStyle = 'rgba(210,210,200,.55)'; for (const b of BUILDINGS) c.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), b.w * k, b.d * k);
    for (const f of FLAGS) {
      const st = flagsState?.find((x) => x[0] === f.id); const o = st ? st[1] : 0;
      c.fillStyle = o === 0 ? '#ddd' : o === team ? '#4d8fe0' : '#e0574d';
      c.beginPath(); c.arc(X(f.x), Z(f.z), f.id === this.selectedSpawn ? 11 : 8, 0, 7); c.fill();
      c.fillStyle = '#111'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(f.id, X(f.x), Z(f.z));
    }
    const b = BASES[team]; c.fillStyle = '#4d8fe0'; c.fillRect(X(b.x) - 7, Z(b.z) - 7, 14, 14); c.fillStyle = '#fff'; c.fillText('HQ', X(b.x), Z(b.z));
    const btn = $('deploybtn');
    btn.disabled = respawnIn > 0;
    btn.textContent = respawnIn > 0 ? `DEPLOY IN ${Math.ceil(respawnIn / 1000)}` : 'DEPLOY';
    btn.onclick = () => onDeploy(this.selectedSpawn, this.selectedClass);
  }

  deployTimer(rs) {
    const btn = $('deploybtn');
    btn.disabled = rs > 0;
    btn.textContent = rs > 0 ? `DEPLOY IN ${Math.ceil(rs / 1000)}` : 'DEPLOY';
  }

  roundEnd(text) { const r = $('roundend'); r.classList.toggle('hidden', !text); r.textContent = text || ''; }
  fps(v) { $('fps').textContent = v; }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
