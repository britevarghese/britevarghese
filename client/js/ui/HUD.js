// DOM HUD: tickets & flags, capture status, minimap, kill feed, ammo, health, hit markers, damage direction,
// scoreboard, chat, deploy screen (kit + spawn selection) and round end.
import { FLAGS, BUILDINGS, ROADS, BASES, PLAY_HALF, TEAM_NAMES } from '/shared/map.js';
import { WEAPONS, CLASSES, CLASS_INFO } from '/shared/weapons.js';
import { kitCard, KIT_ICON } from './Lobby.js';
import { squadName, SQUAD_BLOCK } from '/shared/squads.js';

const $ = (id) => document.getElementById(id);
const VEHICLE_WEAPONS = { tank_cannon: 'Tank 120 mm', tank_mg: 'Tank MG', heli_rockets: 'Heli rockets', heli_cannon: 'Heli 30 mm', roadkill: 'Roadkill', vehicle: 'Vehicle explosion', crash: 'Crash' };

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
    const c = $('classes');
    if (!CLASSES[this.selectedClass]) this.selectedClass = 'assault';
    c.innerHTML = Object.entries(CLASSES).map(([id, k]) => kitCard(id, k, id === this.selectedClass)).join('');
    for (const el of c.querySelectorAll('.kit')) el.onclick = () => { this.selectedClass = el.dataset.kit; localStorage.setItem('sp_class', this.selectedClass); this.#buildClasses(); };
    // loadout summary in the deploy bar
    const k = CLASSES[this.selectedClass];
    $('dp-kit').textContent = k.name.toUpperCase();
    // (short designations: the box is narrow — 'AR-15 · P-17 · AT-84 · 4 FRAG')
    $('dp-kitw').textContent = [k.primary, k.secondary, k.gadget].filter(Boolean).map((id) => WEAPONS[id].name.split(' ')[0]).join(' · ') + ` · ${k.grenades} FRAG`;
    $('dp-wsil').setAttribute('href', `#w-${k.primary}`);
    $('dp-kicon').innerHTML = `<use href="#${KIT_ICON[this.selectedClass]}"/>`;
  }

  // heading tape: 15 degree ticks, cardinal letters, numbers every 15 degrees (north = -Z, like the minimap)
  compass(yaw) {
    const strip = $('compass-strip');
    if (!this.compassBuilt) {
      const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
      let h = '';
      for (let d = -360; d < 720; d += 15) { const a = ((d % 360) + 360) % 360; h += `<span class="${names[a] ? (a % 90 ? 'cmi' : 'cmc') : ''}${a === 0 ? ' north' : ''}">${names[a] || a}</span>`; }
      strip.innerHTML = h; this.compassBuilt = true;
    }
    const deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
    const px = 3; // pixels per degree (45 px per 15 degree cell)
    strip.style.transform = `translateX(${-(deg + 360) * px}px)`;
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
      el.className = `flag${owner === 0 ? '' : owner === this.myTeam ? ' own' : ' enemy'}${cont ? ' contested' : ''}${this.order?.f === id ? ` ordered ${this.order.kind}` : ''}`;
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
    const st = this.stbar || (this.stbar = document.querySelector('.stbar'));
    if (st && me.stamina !== undefined) {
      st.classList.toggle('on', me.stamina < 0.99);
      st.classList.toggle('winded', !!me.winded);
      st.firstChild.style.width = `${Math.round(me.stamina * 100)}%`;
    }
    $('vignette').style.boxShadow = `inset 0 0 ${140 + (100 - me.hp) * 2}px rgba(130,0,0,${Math.max(0, (60 - me.hp) / 90)})`;
    if (w) {
      const def = WEAPONS[w.id];
      $('wname').textContent = def.name;
      if (this.wsil !== w.id) { this.wsil = w.id; $('wsil').setAttribute('href', `#w-${w.id}`); }
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
    const wname = WEAPONS[weapon]?.name || VEHICLE_WEAPONS[weapon] || (weapon === 'grenade' ? 'Frag grenade' : weapon);
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
      return `<div class="${team === this.myTeam ? 'us' : 'ru'}"><h3>${TEAM_NAMES[team]}</h3><table><tr><th>Name</th><th>K</th><th>D</th><th>Score</th><th>Ping</th></tr>${rows.map((r) => `<tr class="${r.id === myId ? 'me' : ''} ${r.a ? '' : 'dead'}"><td>${esc(r.n)}</td><td>${r.k}</td><td>${r.d}</td><td>${r.s}</td><td>${r.ai ? 'AI' : r.b ? 'BOT' : r.png}</td></tr>`).join('')}</table></div>`;
    };
    sb.innerHTML = col(this.myTeam) + col(this.myTeam === 1 ? 2 : 1);
  }

  // ---------------------------------------------------------------- minimap (rotates with the player)
  minimap(me, yaw, players, myId, flagsState, royale = null, vehicles = null) {
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
      if (this.order?.f === f.id) { g.strokeStyle = this.order.kind === 'attack' ? '#f2d21b' : '#7dff8a'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.stroke(); }
      g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(f.id, 0, 0); g.restore();
    }
    royale?.drawMinimap(g, tx, tz, k);
    vehicles?.drawMinimap(g, tx, tz, k, yaw);
    for (const p of players.values()) {
      if (p.id === myId || !p.alive || (p.flags & 128)) continue; // crews show as their vehicle
      const friendly = !royale && p.team === this.myTeam;
      if (!friendly && !(p.spottedUntil > performance.now())) continue;
      g.fillStyle = friendly ? (this.squadIds?.has(p.id) ? '#7dff8a' : '#6fb0ff') : '#ff5e4d';
      g.beginPath(); g.arc(tx(p.x), tz(p.z), 3.2, 0, 7); g.fill();
    }
    // teammates down and waiting for a medic: a red cross where each one lies
    for (const d of this.downed || []) {
      g.save(); g.translate(tx(d[2]), tz(d[4])); g.rotate(-yaw);
      g.fillStyle = '#fff'; g.fillRect(-2.2, -5.2, 4.4, 10.4); g.fillRect(-5.2, -2.2, 10.4, 4.4);
      g.fillStyle = '#e8322a'; g.fillRect(-1.2, -4.2, 2.4, 8.4); g.fillRect(-4.2, -1.2, 8.4, 2.4);
      g.restore();
    }
    g.restore();
    // player arrow
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(S / 2, S / 2 - 7); g.lineTo(S / 2 + 5, S / 2 + 5); g.lineTo(S / 2 - 5, S / 2 + 5); g.closePath(); g.fill();
  }

  // ---------------------------------------------------------------- deploy screen
  deployScreen(show, { team, flagsState, onDeploy, respawnIn = 0, killer = null } = {}) {
    $('deploy').classList.toggle('hidden', !show);
    document.body.classList.toggle('deploying', show);
    if (!show) return;
    const args = { team, flagsState, onDeploy, respawnIn, killer };
    this.deployArgs = args;
    $('killcam').classList.toggle('hidden', !killer);
    if (killer) $('killcam').innerHTML = killer;
    // roster of my team: my squad on top (its leader: the first player in it), then the other squads
    const mates = (this.board || []).filter((r) => r.tm === team), mySq = this.mySquad || 0;
    const mine = mates.filter((r) => mySq && r.sq === mySq).sort((a, b) => a.b - b.b || a.id - b.id);
    const rest = mates.filter((r) => !mySq || r.sq !== mySq).sort((a, b) => (a.sq || 0) - (b.sq || 0) || b.s - a.s);
    const row = (r, lead, tag) => `<div class="mate${r.id === this.meId ? ' me' : ''}"><i class="st${r.a ? ' on' : ''}"></i>${tag ? `<b class="sqt">${squadName(r.sq)[0] || ''}</b>` : ''}<span>${esc(r.n)}</span>${lead ? '<em>Leader</em>' : r.ai ? '<em class="ai">AI</em>' : r.b ? '<em class="bot">BOT</em>' : ''}</div>`;
    $('dp-teamname').textContent = mySq ? `${squadName(mySq)} SQUAD` : `${TEAM_NAMES[team] || 'YOUR TEAM'} SQUAD`;
    $('dp-count').textContent = `${mates.length}`;
    $('dp-roster').innerHTML = (mySq ? mine.map((r, i) => row(r, i === 0, false)).join('') + (rest.length ? '<div class="sqh">OTHER SQUADS</div>' : '') : '') + rest.map((r) => row(r, false, !!mySq)).join('');
    $('dp-team').textContent = TEAM_NAMES[team] || '—';
    $('dp-teamsub').textContent = `${mates.length} soldiers · ${mates.filter((r) => !r.b).length} players`;
    // spawn points: HQ + flags we own that aren't under attack
    const st = (id) => flagsState?.find((f) => f[0] === id);
    const flags = FLAGS.map((f) => ({ id: f.id, owned: st(f.id)?.[1] === team, attacked: !!st(f.id)?.[3] })).filter((f) => f.owned);
    // ... and my squad mates who are clear to deploy on (alive, on foot, out of the fight)
    const nameOf = (id) => (this.board || []).find((r) => r.id === id)?.n || 'Soldier';
    const sqm = (this.squadSp || []).map(([id, why]) => ({ id, why, name: nameOf(id) }));
    const usable = ['base', ...flags.filter((f) => !f.attacked).map((f) => f.id), ...sqm.filter((m) => !m.why).map((m) => `@${m.id}`)];
    if (!usable.includes(this.selectedSpawn)) this.selectedSpawn = 'base';
    const sel = this.selectedSpawn, selMate = sel[0] === '@' ? sqm.find((m) => `@${m.id}` === sel) : null;
    const sp = $('spawns');
    sp.innerHTML = `<div class="sp${sel === 'base' ? ' sel' : ''}" data-sp="base"><svg class="ic"><use href="#i-house"/></svg>HQ Spawn</div>`
      + flags.map((f) => `<div class="sp${f.id === sel ? ' sel' : ''}${f.attacked ? ' off' : ''}" data-sp="${f.id}"><i class="dia">${f.id}</i>Flag ${f.id}${f.attacked ? '<small>UNDER ATTACK</small>' : ''}</div>`).join('')
      + (sqm.length ? `<div class="sph">${squadName(this.mySquad)} SQUAD</div>` : '')
      + sqm.map((m) => `<div class="sp mate${`@${m.id}` === sel ? ' sel' : ''}${m.why ? ' off' : ''}" data-sp="@${m.id}"><i class="sqd"></i>${esc(m.name)}${m.why ? `<small>${SQUAD_BLOCK[m.why] || 'UNAVAILABLE'}</small>` : ''}</div>`).join('');
    for (const el of sp.querySelectorAll('.sp:not(.off)')) el.onclick = () => { this.selectedSpawn = el.dataset.sp; this.deployScreen(true, args); };
    $('dp-spawn').textContent = sel === 'base' ? 'HQ Spawn' : selMate ? selMate.name : `Flag ${sel}`;
    $('dp-spawnsub').textContent = sel === 'base' ? 'Safe · Team spawn' : selMate ? 'Squad mate · Right behind him' : 'Front line';
    this.#tacticalMap(team, flagsState);
    const btn = $('deploybtn');
    btn.onclick = () => onDeploy(this.selectedSpawn, this.selectedClass);
    this.deployTimer(respawnIn);
  }

  // the scoreboard arrived / changed while the deploy screen is open: refresh roster + map
  refreshDeploy(flagsState) {
    if (!this.deployArgs || $('deploy').classList.contains('hidden')) return;
    this.deployScreen(true, { ...this.deployArgs, flagsState: flagsState || this.deployArgs.flagsState, respawnIn: this.lastRs ?? this.deployArgs.respawnIn });
  }

  #tacticalMap(team, flagsState) {
    const cv = $('deploymap'), c = cv.getContext('2d'), S = cv.width, k = S / (PLAY_HALF * 2.1);
    const X = (x) => S / 2 + x * k, Z = (z) => S / 2 + z * k;
    c.fillStyle = '#1b231b'; c.fillRect(0, 0, S, S);
    // subtle terrain grain + grid
    c.strokeStyle = 'rgba(255,255,255,.04)'; c.lineWidth = 1;
    for (let g = 0; g <= S; g += S / 12) { c.beginPath(); c.moveTo(g, 0); c.lineTo(g, S); c.moveTo(0, g); c.lineTo(S, g); c.stroke(); }
    c.strokeStyle = 'rgba(255,90,70,.35)'; c.setLineDash([6, 5]); c.strokeRect(X(-PLAY_HALF), Z(-PLAY_HALF), PLAY_HALF * 2 * k, PLAY_HALF * 2 * k); c.setLineDash([]);
    c.lineCap = 'round';
    for (const r of ROADS) { c.strokeStyle = 'rgba(40,40,40,.9)'; c.lineWidth = r.w * k + 2; c.beginPath(); c.moveTo(X(r.ax), Z(r.az)); c.lineTo(X(r.bx), Z(r.bz)); c.stroke(); c.strokeStyle = 'rgba(150,150,140,.75)'; c.lineWidth = r.w * k; c.stroke(); }
    c.fillStyle = 'rgba(205,205,195,.6)'; for (const b of BUILDINGS) c.fillRect(X(b.x - b.w / 2), Z(b.z - b.d / 2), Math.max(2, b.w * k), Math.max(2, b.d * k));
    const diamond = (x, y, r, fill, stroke, label, sel) => {
      c.save(); c.translate(x, y); c.rotate(Math.PI / 4);
      c.fillStyle = fill; c.strokeStyle = stroke; c.lineWidth = sel ? 3 : 2;
      c.fillRect(-r, -r, r * 2, r * 2); c.strokeRect(-r, -r, r * 2, r * 2); c.restore();
      c.fillStyle = '#fff'; c.font = `700 ${Math.round(r * 1.1)}px Rajdhani, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y + 1);
    };
    for (const f of FLAGS) {
      const st = flagsState?.find((x) => x[0] === f.id); const o = st ? st[1] : 0;
      const col = o === 0 ? ['rgba(30,30,30,.85)', '#e8e8e8'] : o === team ? ['rgba(40,90,170,.85)', '#6fb0ff'] : ['rgba(150,35,30,.85)', '#ff6b5b'];
      if (f.id === this.selectedSpawn) { c.strokeStyle = '#f2d21b'; c.lineWidth = 2; c.beginPath(); c.arc(X(f.x), Z(f.z), 17, 0, 7); c.stroke(); }
      diamond(X(f.x), Z(f.z), 9, col[0], col[1], f.id, f.id === this.selectedSpawn);
    }
    for (const t of [1, 2]) {
      const b = BASES[t], mine = t === team, x = X(b.x), y = Z(b.z);
      c.fillStyle = mine ? 'rgba(242,210,27,.9)' : 'rgba(200,50,40,.8)';
      c.beginPath(); c.arc(x, y, 12, 0, 7); c.fill();
      if (mine && this.selectedSpawn === 'base') { c.strokeStyle = '#7dff8a'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, 17, 0, 7); c.stroke(); }
      c.fillStyle = '#111'; c.font = '700 10px Rajdhani, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('HQ', x, y + 1);
    }
    // squad mates where they are now (green; the one picked to deploy on ringed)
    for (const [id, why] of this.squadSp || []) {
      const p = this.posOf?.(id);
      if (!p) continue;
      const x = X(p.x), y = Z(p.z);
      if (this.selectedSpawn === `@${id}`) { c.strokeStyle = '#7dff8a'; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 12, 0, 7); c.stroke(); }
      c.fillStyle = why ? 'rgba(125,255,138,.4)' : '#7dff8a'; c.beginPath(); c.arc(x, y, 6.5, 0, 7); c.fill();
      c.strokeStyle = '#0b0e12'; c.lineWidth = 1.5; c.stroke();
    }
    // north arrow
    c.fillStyle = 'rgba(255,255,255,.8)'; c.font = '700 12px Rajdhani, sans-serif'; c.fillText('N', S - 18, 16);
    c.beginPath(); c.moveTo(S - 18, 22); c.lineTo(S - 23, 34); c.lineTo(S - 13, 34); c.closePath(); c.fill();
  }

  deployTimer(rs) {
    this.lastRs = rs;
    const btn = $('deploybtn');
    btn.disabled = rs > 0;
    btn.textContent = rs > 0 ? `DEPLOY IN ${Math.ceil(rs / 1000)}` : 'DEPLOY →';
    $('respawn-timer').textContent = rs > 0 ? `RESPAWN IN ${Math.ceil(rs / 1000)} s` : 'READY';
    $('respawn-timer').closest('.dpb').classList.toggle('wait', rs > 0);
  }

  // in game: my squad mates, each alive / down / dead, with his kit
  squadPanel(rows, downed) {
    let el = $('squadpanel');
    if (!el) { el = document.createElement('div'); el.id = 'squadpanel'; $('hud').appendChild(el); }
    const ord = this.order ? ` · <b class="${this.order.kind}">${this.order.kind === 'attack' ? 'ATTACK' : 'DEFEND'} ${this.order.f}</b>` : '';
    const html = rows.length ? `<div class="sqn">${squadName(this.mySquad)}${ord}</div>` + rows.map((r) => {
      const st = r.a ? 'up' : downed.has(r.id) ? 'down' : 'dead';
      return `<div class="sm ${st}"><svg class="ic"><use href="#${st === 'down' ? 'i-cross' : KIT_ICON[r.c] || 'i-user'}"/></svg><span>${esc(r.n)}</span></div>`;
    }).join('') : '';
    if (el._h !== html) { el._h = html; el.innerHTML = html; }
  }

  // ---------------------------------------------------------------- score feed (by the crosshair)
  // each award slides in under the crosshair; a running total sums a streak and resets after a few quiet seconds
  scoreFeed(pts, why, { name = null, flag = null, vt = null } = {}) {
    let el = $('scorefeed');
    if (!el) { el = document.createElement('div'); el.id = 'scorefeed'; el.innerHTML = '<div class="sf-total"></div><div class="sf-list"></div>'; document.body.appendChild(el); }
    const label = {
      kill: 'ENEMY KILLED', down: 'ENEMY DOWNED', headshot: 'HEADSHOT BONUS', assist: 'KILL ASSIST', spot: 'SPOT ASSIST',
      revive: 'REVIVE', capture: `FLAG ${flag || ''} CAPTURED`, neutralize: `FLAG ${flag || ''} NEUTRALIZED`, heal: 'HEAL',
      resupply: 'RESUPPLY', squadspawn: 'SQUAD SPAWN', order: 'ATTACK ORDER BONUS', defend: 'DEFEND ORDER BONUS', suppress: 'SUPPRESSION ASSIST', vehicle: `${vt ? String(vt).toUpperCase() : 'VEHICLE'} DESTROYED`,
    }[why] || String(why).toUpperCase();
    const who = name && ['kill', 'down', 'assist', 'spot', 'revive', 'squadspawn'].includes(why) ? ` <i>${esc(name)}</i>` : '';
    const row = document.createElement('div');
    row.className = `sf-row ${['kill', 'down', 'vehicle'].includes(why) ? 'big' : ''}`;
    row.innerHTML = `<span>${label}${who}</span><b>+${pts}</b>`;
    const list = el.querySelector('.sf-list');
    list.prepend(row);
    while (list.children.length > 4) list.lastChild.remove();
    setTimeout(() => row.classList.add('out'), 2600);
    setTimeout(() => row.remove(), 3100);
    this.sfTotal = (performance.now() - (this.sfAt || 0) < 4000 ? this.sfTotal || 0 : 0) + pts;
    this.sfAt = performance.now();
    const tot = el.querySelector('.sf-total');
    tot.textContent = `+${this.sfTotal}`; tot.classList.remove('pop'); void tot.offsetWidth; tot.classList.add('pop');
    clearTimeout(this.sfT); this.sfT = setTimeout(() => { tot.textContent = ''; }, 4000);
  }

  // ---------------------------------------------------------------- end of round
  // victory / defeat, the top of both teams, the ribbons (MVP and the best at each job) and my own round
  roundSummary(r, myId, myTeam) {
    let el = $('roundsum');
    clearInterval(this.rsTimer);
    if (!r) { el?.classList.add('hidden'); return; }
    if (!el) { el = document.createElement('div'); el.id = 'roundsum'; document.body.appendChild(el); }
    const rows = r.ps.map((x) => ({ id: x[0], n: x[1], tm: x[2], s: x[3], k: x[4], d: x[5], as: x[6], rv: x[7], cp: x[8], sp: x[9], vh: x[10], hs: x[11], lg: x[12], b: x[13] }));
    const win = r.winner === myTeam, enemy = myTeam === 1 ? 2 : 1, me = rows.find((x) => x.id === myId);
    const team = (t) => {
      const list = rows.filter((x) => x.tm === t).sort((a, b) => b.s - a.s);
      const total = list.reduce((a, x) => a + x.s, 0);
      const top = list.slice(0, 5);
      if (me && me.tm === t && !top.includes(me)) top.push(me);
      return `<div class="rs-team ${t === myTeam ? 'us' : 'ru'}"><h3><span>${TEAM_NAMES[t]}</span><b>${total.toLocaleString()}</b></h3><table>
        <tr><th>#</th><th>Name</th><th>Score</th><th>K</th><th>D</th></tr>
        ${top.map((x) => `<tr class="${x.id === myId ? 'me' : ''}"><td>${list.indexOf(x) + 1}</td><td>${esc(x.n)}</td><td>${x.s}</td><td>${x.k}</td><td>${x.d}</td></tr>`).join('')}</table></div>`;
    };
    const best = (key, min = 1) => rows.reduce((a, x) => (x[key] >= min && (!a || x[key] > a[key]) ? x : a), null);
    const ribbons = [
      ['MVP', 'i-target', best('s'), (x) => `${x.s} points`],
      ['LIFESAVER', 'i-cross', best('rv'), (x) => `${x.rv} revive${x.rv > 1 ? 's' : ''}`],
      ['FLAG RUNNER', 'i-pin', best('cp'), (x) => `${x.cp} flag${x.cp > 1 ? 's' : ''}`],
      ['SPOTTER', 'i-eye', best('sp'), (x) => `${x.sp} spot assist${x.sp > 1 ? 's' : ''}`],
      ['TANK BUSTER', 'i-ammo', best('vh'), (x) => `${x.vh} vehicle${x.vh > 1 ? 's' : ''}`],
      ['MARKSMAN', 'i-binoc', best('lg', 50), (x) => `${x.lg} m kill`],
    ].filter(([, , x]) => x);
    const mine = me ? [[me.s, 'SCORE'], [me.k, 'KILLS'], [me.d, 'DEATHS'], [me.as, 'ASSISTS'], [me.rv, 'REVIVES'], [me.cp, 'FLAGS']] : [];
    const mm = Math.floor((r.dur || 0) / 60), ss = String((r.dur || 0) % 60).padStart(2, '0');
    el.innerHTML = `<div class="rs-box">
      <div class="rs-res ${win ? 'win' : 'lose'}">${win ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="rs-sub">${TEAM_NAMES[r.winner]} WINS · ${r.tk[r.winner - 1]} TICKETS LEFT · ${mm}:${ss}</div>
      <div class="rs-teams">${team(myTeam)}${team(enemy)}</div>
      ${ribbons.length ? `<div class="rs-ribbons">${ribbons.map(([t, ic, x, f]) => `<div class="rb${x.id === myId ? ' me' : ''}"><svg class="ic"><use href="#${ic}"/></svg><div><small>${t}</small><b>${esc(x.n)}</b><span>${f(x)}</span></div></div>`).join('')}</div>` : ''}
      ${me ? `<div class="rs-me"><small>YOUR ROUND</small>${mine.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}<div class="xp"><b>+${me.s}</b><span>XP</span></div></div>` : ''}
      <div class="rs-next"></div>
    </div>`;
    el.classList.remove('hidden');
    const end = performance.now() + (r.next || 15000);
    const tick = () => {
      const left = Math.ceil((end - performance.now()) / 1000);
      const n = el.querySelector('.rs-next'); if (n) n.textContent = left > 0 ? `NEXT ROUND IN ${left}` : 'NEXT ROUND';
      if (left <= -2) { clearInterval(this.rsTimer); el.classList.add('hidden'); }
    };
    tick(); this.rsTimer = setInterval(tick, 500);
  }

  roundEnd(text) { const r = $('roundend'); r.classList.toggle('hidden', !text); r.textContent = text || ''; }
  fps(v) { $('fps').textContent = v; }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
