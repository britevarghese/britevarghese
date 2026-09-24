// Main menu: home (mode cards, quick stats, battlefields, server browser), multiplayer rooms + join by code,
// battle royale lobbies, create room, AI Zone, settings and profile (local service record + default kit).
// Every "play" action records an intent and presses #play, whose handler (main.js) saves settings and starts.
import { CLASSES, CLASS_INFO, WEAPONS } from '/shared/weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VIEWS = ['home', 'multiplayer', 'royale', 'create', 'ai', 'settings', 'profile'];
const RANKS = [[0, 'Recruit'], [500, 'Private'], [1500, 'Corporal'], [4000, 'Sergeant'], [9000, 'Lieutenant'], [18000, 'Captain'], [35000, 'Major'], [60000, 'Colonel']];
export const KIT_ICON = { assault: 'i-chevrons', recon: 'i-binoc', support: 'i-ammo', medic: 'i-cross' };
export const mapArt = (id) => `/assets/ui/map_${id}.jpg`;

// ---------------------------------------------------------------- local service record
export const Stats = {
  get() { try { return { matches: 0, kills: 0, deaths: 0, xp: 0, ...JSON.parse(localStorage.getItem('sp_stats') || '{}') }; } catch { return { matches: 0, kills: 0, deaths: 0, xp: 0 }; } },
  add(d) { const s = this.get(); for (const [k, v] of Object.entries(d)) s[k] = (s[k] || 0) + v; try { localStorage.setItem('sp_stats', JSON.stringify(s)); } catch {} return s; },
  rank(xp) {
    let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
    const [a, name] = RANKS[i], b = RANKS[i + 1]?.[0];
    return { name, progress: b ? (xp - a) / (b - a) : 1 };
  },
};

export class Lobby {
  constructor({ initialRoom = null } = {}) {
    this.view = 'home';
    this.intent = null;
    this.rooms = [];
    this.maps = [];
    this.ping = null;
    this.mapFilter = 'all';
    for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', (e) => { e.preventDefault(); this.show(b.dataset.view); });
    for (const b of document.querySelectorAll('[data-act]')) b.addEventListener('click', (e) => { e.preventDefault(); this.act(b.dataset.act); });
    for (const b of document.querySelectorAll('#map-filter button')) b.onclick = () => { this.mapFilter = b.dataset.f; for (const x of document.querySelectorAll('#map-filter button')) x.classList.toggle('on', x === b); this.#mapCards(); };
    for (const a of [$('refresh'), ...document.querySelectorAll('[data-refresh]')]) a.addEventListener('click', (e) => { e.preventDefault(); this.refresh(); });
    $('j-code').oninput = () => this.lookup();
    $('name').addEventListener('input', () => this.#syncName());
    $('fov').addEventListener('input', () => ($('fov-v').textContent = `${$('fov').value}°`));
    this.loadMaps();
    this.#bindAI();
    this.#profile();
    this.refresh();
    this.timer = setInterval(() => { if (!$('menu').classList.contains('hidden') && ['home', 'multiplayer', 'royale'].includes(this.view)) this.refresh(); }, 5000);
    this.show('home');
    if (initialRoom) { this.show('multiplayer'); $('j-code').value = initialRoom; this.lookup(); this.intent = { kind: 'code' }; }
    setTimeout(() => { this.#syncName(); $('fov-v').textContent = `${$('fov').value}°`; }, 0);
  }

  #syncName() {
    const n = $('name').value.trim() || 'Soldier';
    $('u-name').textContent = n; $('h-name').textContent = n.toUpperCase();
  }

  show(v) {
    if (!VIEWS.includes(v)) return;
    this.view = v;
    for (const id of VIEWS) $(`v-${id}`).classList.toggle('hidden', id !== v);
    for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.view === v);
    const label = { home: 'QUICK PLAY', multiplayer: 'JOIN ROOM', royale: 'PLAY BATTLE ROYALE', create: 'CREATE & JOIN', ai: 'START AI MATCH', settings: 'QUICK PLAY', profile: 'QUICK PLAY' }[v];
    $('play').textContent = `${label} →`;
    document.querySelector('#menu .views').scrollTop = 0;
    if (v === 'profile') this.#profile();
  }

  // a button asked to play something: remember what, then go through the one start path (#play)
  act(kind, arg) {
    if (kind === 'royale' && !arg) { this.show('royale'); return; }
    this.intent = { kind, arg };
    $('play').click();
  }

  async loadMaps() {
    this.maps = await (await fetch('/api/maps')).json();
    const sel = $('c-map');
    sel.innerHTML = this.maps.map((m) => `<option value="${m.id}">${esc(m.name)} — ${m.mode === 'royale' ? `BATTLE ROYALE, ${m.size} m` : `Conquest, ${m.size} m, ${m.flags} flags`}</option>`).join('');
    $('ai-map').innerHTML = this.maps.filter((m) => m.mode !== 'royale').map((m) => `<option value="${m.id}">${esc(m.name)} — ${m.size} m, ${m.flags} flags</option>`).join('');
    if (this.aiSaved?.map) $('ai-map').value = this.aiSaved.map;
    const desc = () => {
      const m = this.maps.find((x) => x.id === sel.value);
      $('c-mapdesc').textContent = m?.description || '';
      const royale = m?.mode === 'royale';
      $('c-bots').previousSibling.textContent = royale ? 'Bots (total) ' : 'Bots per team ';
      $('c-bots').max = royale ? 23 : 16;
      if (royale && +$('c-bots').value < 8) $('c-bots').value = 12;
      $('c-rotation').closest('label').style.display = royale ? 'none' : '';
    };
    sel.onchange = desc; desc();
    this.#mapCards();
  }

  #mapCards() {
    const players = (id) => this.rooms.filter((r) => r.map === id).reduce((s, r) => s + r.players, 0);
    const card = (m, i) => `<div class="mcard${i === 0 ? ' sel' : ''}" data-map="${m.id}" style="--img:url(${mapArt(m.id)})">
      <div class="mt"><svg class="ic y"><use href="#i-pin"/></svg><b>${esc(m.name.toUpperCase())}</b></div>
      <div class="ms"><svg class="ic"><use href="#i-users"/></svg>${m.mode === 'royale' ? `Battle royale · ${m.size} m` : `Conquest · ${m.flags} flags · ${m.size} m`} · ${players(m.id)} playing</div>
      <button class="btn${i === 0 ? ' y' : ''} sm">SELECT →</button></div>`;
    const list = this.maps.filter((m) => this.mapFilter === 'all' || (this.mapFilter === 'royale') === (m.mode === 'royale'));
    $('mapcards').innerHTML = list.map(card).join('');
    $('royalecards').innerHTML = this.maps.filter((m) => m.mode === 'royale').map(card).join('');
    for (const el of document.querySelectorAll('.mcard')) {
      el.onclick = () => this.act('map', el.dataset.map);
      el.onmouseenter = () => { for (const x of el.parentNode.children) { x.classList.toggle('sel', x === el); x.querySelector('.btn').classList.toggle('y', x === el); } };
    }
  }

  async refresh() {
    try {
      const t0 = performance.now();
      this.rooms = await (await fetch('/api/rooms')).json();
      const ms = performance.now() - t0;
      this.ping = this.ping == null ? ms : this.ping * 0.6 + ms * 0.4;
    } catch { for (const id of ['roomlist', 'roomlist2', 'roomlist3']) $(id).innerHTML = '<div class="empty">Cannot reach the server.</div>'; return; }
    const row = (r) => `<div class="room" data-id="${r.id}">
      <span class="rn"><i class="live"></i>${esc(r.name)}${r.locked ? ' <svg class="ic lk"><use href="#i-lock"/></svg>' : ''}</span>
      <span>${esc(r.mapName)}</span>
      <span>${r.mode === 'royale' ? 'Battle Royale' : r.ai?.length ? 'AI Zone' : 'Conquest'}</span>
      <span>${r.players}/${r.max}</span>
      <span class="ping">${Math.round(this.ping)}ms</span>
      <span><button class="btn y xs" data-join="${r.id}">JOIN</button></span></div>`;
    const fill = (id, rooms, empty) => {
      $(id).innerHTML = rooms.length ? rooms.map(row).join('') : `<div class="empty">${empty}</div>`;
      for (const b of $(id).querySelectorAll('[data-join]')) b.onclick = (e) => { e.stopPropagation(); this.act('room', b.dataset.join); };
    };
    fill('roomlist', this.rooms.slice(0, 7), 'No public rooms — create one!');
    fill('roomlist2', this.rooms, 'No public rooms — create one!');
    fill('roomlist3', this.rooms.filter((r) => r.mode === 'royale'), 'No royale lobby open — pick the island above to start one.');
    const online = this.rooms.reduce((s, r) => s + r.players, 0);
    $('roomcount').textContent = `${this.rooms.length} public rooms · ${online} players online`;
    $('qs-online').textContent = online;
    this.#mapCards();
  }

  async lookup() {
    const code = $('j-code').value.trim().toUpperCase();
    if (code.length < 4) { $('j-info').textContent = ''; return; }
    const r = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    $('j-info').textContent = r.ok ? (await r.json().then((i) => `${i.name} · ${i.mapName} · ${i.players}/${i.max} players${i.locked ? ' · password required' : ''}`)) : 'No room with that code.';
  }

  #profile() {
    const s = Stats.get(), r = Stats.rank(s.xp);
    $('qs-rank').textContent = r.name; $('qs-xp').style.width = `${Math.round(r.progress * 100)}%`; $('qs-matches').textContent = s.matches.toLocaleString();
    $('pf-rank').textContent = r.name; $('pf-xp').textContent = s.xp.toLocaleString(); $('pf-matches').textContent = s.matches;
    $('pf-kills').textContent = s.kills; $('pf-deaths').textContent = s.deaths; $('pf-kd').textContent = (s.kills / Math.max(1, s.deaths)).toFixed(2);
    const sel = localStorage.getItem('sp_class') || 'assault';
    $('pf-kits').innerHTML = Object.entries(CLASSES).map(([id, k]) => kitCard(id, k, id === sel)).join('');
    for (const el of $('pf-kits').querySelectorAll('.kit')) el.onclick = () => { localStorage.setItem('sp_class', el.dataset.kit); this.#profile(); };
  }

  // ---------------------------------------------------------------- AI Zone settings
  #bindAI() {
    const KEY = 'sp_ai';
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
    this.aiSaved = saved;
    const f = { provider: $('ai-provider'), base: $('ai-base'), model: $('ai-model'), key: $('ai-key'), name: $('ai-name'), side: $('ai-side'), interval: $('ai-interval'), bots: $('ai-bots') };
    const defaults = { anthropic: ['https://api.anthropic.com', 'claude-opus-5'], openai: ['https://api.openai.com/v1', ''] };
    for (const [k, el] of Object.entries(f)) if (saved[k] !== undefined) el.value = saved[k];
    $('ai-remember-key').checked = !!saved.key;
    const syncProvider = (reset) => {
      const [b, m] = defaults[f.provider.value];
      f.base.placeholder = b; f.model.placeholder = m || 'e.g. gpt-4o-mini, llama-3.1-70b, qwen2.5';
      if (reset) { f.base.value = ''; f.model.value = ''; }
    };
    f.provider.onchange = () => syncProvider(true); syncProvider(false);
    const rate = () => ($('ai-rate').textContent = Math.round(60 / +f.interval.value));
    f.interval.onchange = rate; rate();
    this.aiConfig = () => {
      const c = { provider: f.provider.value, baseUrl: f.base.value.trim() || f.base.placeholder, model: f.model.value.trim() || f.model.placeholder, apiKey: f.key.value.trim(), name: f.name.value.trim() || 'Claude', side: f.side.value, interval: +f.interval.value };
      const store = { provider: c.provider, base: f.base.value, model: f.model.value, name: f.name.value, side: c.side, interval: f.interval.value, bots: f.bots.value, map: $('ai-map').value };
      if ($('ai-remember-key').checked) store.key = c.apiKey;
      try { if ($('ai-remember').checked) localStorage.setItem(KEY, JSON.stringify(store)); else localStorage.removeItem(KEY); } catch {}
      return c;
    };
    $('ai-test').onclick = async (e) => {
      e.preventDefault();
      const st = $('ai-status'); st.className = 'desc'; st.textContent = 'Testing…';
      try {
        const r = await fetch('/api/ai/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.aiConfig()) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'failed');
        st.className = 'desc ok'; st.textContent = `✓ Connected to ${j.model} (${j.ms} ms)`;
      } catch (err) { st.className = 'desc bad'; st.textContent = `✗ ${err.message}`; }
    };
  }

  async #create(body) {
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || 'Could not create room');
    return { room: info.id, password: body.password || '' };
  }

  #roomPick(id) {
    const r = this.rooms.find((x) => x.id === id);
    const password = r?.locked ? prompt('Room password:') || '' : '';
    return { room: id, password };
  }

  // the busiest public room that still has space (bots fill the rest), matching a filter
  #best(filter) {
    const open = this.rooms.filter((r) => !r.locked && r.players < r.max && filter(r));
    open.sort((a, b) => b.players - a.players);
    return open[0] || null;
  }

  // Resolve the current intent (or the view's default action). Returns { room, password } or throws.
  async choose() {
    if (!this.rooms.length) await this.refresh();
    const it = this.intent || { kind: { home: 'quick', multiplayer: $('j-code').value.trim() ? 'code' : 'quick', royale: 'quickroyale', create: 'create', ai: 'ai' }[this.view] || 'quick' };
    this.intent = null;
    const callsign = $('name').value.trim() || 'Soldier';
    switch (it.kind) {
      case 'room': return this.#roomPick(it.arg);
      case 'quick': {
        const r = this.#best((x) => x.mode !== 'royale' && !x.ai?.length);
        return r ? this.#roomPick(r.id) : this.#create({ name: 'Quick match', map: 'outskirts', bots: 6, private: false, rotation: true });
      }
      case 'quickroyale': {
        const r = this.#best((x) => x.mode === 'royale');
        return r ? this.#roomPick(r.id) : this.#create({ name: 'Firestorm', map: 'firestorm', bots: 12, private: false });
      }
      case 'map': {
        const m = this.maps.find((x) => x.id === it.arg);
        const r = this.#best((x) => x.map === it.arg && !x.ai?.length);
        return r ? this.#roomPick(r.id) : this.#create({ name: `${m?.name || 'Battle'} 24/7`, map: it.arg, bots: m?.mode === 'royale' ? 12 : 6, private: false, rotation: false });
      }
      case 'practice': return this.#create({ name: `${callsign} · practice`, map: 'compound', bots: 6, private: true, rotation: true });
      case 'squad': return this.#create({ name: `${callsign}'s squad`, map: 'outskirts', bots: 4, private: true, rotation: true });
      case 'code': {
        const code = $('j-code').value.trim().toUpperCase();
        if (!code) throw new Error('Enter a room code');
        return { room: code, password: $('j-pass').value };
      }
      case 'ai': {
        const ai = this.aiConfig();
        return this.#create({ name: `AI Zone · ${ai.name}`, map: $('ai-map').value, bots: +$('ai-bots').value, maxPlayers: 12, private: true, rotation: false, ai: [ai] });
      }
      default: return this.#create({
        name: $('c-name').value.trim(), map: $('c-map').value, bots: +$('c-bots').value, maxPlayers: +$('c-max').value,
        private: $('c-private').checked, password: $('c-pass').value, rotation: $('c-rotation').checked,
      });
    }
  }
}

// kit card (profile + deploy screen)
export function kitCard(id, k, selected) {
  const info = CLASS_INFO[id] || {};
  const w = WEAPONS[k.primary];
  return `<div class="kit${selected ? ' sel' : ''}" data-kit="${id}" style="--img:url(/assets/ui/kit_${id}.jpg)">
    <div class="kh"><svg class="kic"><use href="#${KIT_ICON[id] || 'i-chevrons'}"/></svg><div><b>${esc(k.name.toUpperCase())}</b><span>${esc(info.role || '')}</span></div></div>
    <div class="kw"><svg class="wsil"><use href="#w-${k.primary}"/></svg><span>${esc(w.name)}</span></div>
    <div class="kg"><span><svg class="ic"><use href="#w-frag"/></svg>${k.grenades}<small>FRAG</small></span><span class="perk">${esc(info.perk || '')}</span></div>
    ${selected ? '<i class="tick"><svg><use href="#i-check"/></svg></i>' : ''}</div>`;
}

export function inviteLink(room) { return `${location.origin}/?room=${encodeURIComponent(room)}`; }
