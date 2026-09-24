// Main-menu lobby: server browser, create room, join by code / invite link.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Lobby {
  constructor({ initialRoom = null } = {}) {
    this.tab = 'browse';
    this.selected = null;
    this.rooms = [];
    for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => this.setTab(b.dataset.tab);
    $('refresh').onclick = (e) => { e.preventDefault(); this.refresh(); };
    $('j-code').oninput = () => this.lookup();
    this.loadMaps();
    this.#bindAI();
    this.refresh();
    this.timer = setInterval(() => { if (!$('menu').classList.contains('hidden') && this.tab === 'browse') this.refresh(); }, 5000);
    if (initialRoom) { this.setTab('code'); $('j-code').value = initialRoom; this.lookup(); }
  }

  setTab(t) {
    this.tab = t;
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === t);
    for (const id of ['browse', 'create', 'code', 'ai']) $(`tab-${id}`).classList.toggle('hidden', id !== t);
    $('play').textContent = t === 'create' ? 'CREATE & JOIN' : t === 'ai' ? 'START AI MATCH' : 'JOIN BATTLE';
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
      // royale: bots are a total, not per team; there is nothing to rotate to
      const royale = m?.mode === 'royale';
      $('c-bots').previousSibling.textContent = royale ? 'Bots (total) ' : 'Bots per team ';
      $('c-bots').max = royale ? 23 : 16;
      if (royale && +$('c-bots').value < 8) $('c-bots').value = 12;
      $('c-rotation').closest('label').style.display = royale ? 'none' : '';
    };
    sel.onchange = desc; desc();
  }

  async refresh() {
    try {
      this.rooms = await (await fetch('/api/rooms')).json();
    } catch { $('roomlist').innerHTML = '<div class="empty">Cannot reach the server.</div>'; return; }
    const list = $('roomlist');
    if (!this.rooms.length) { list.innerHTML = '<div class="empty">No public rooms — create one!</div>'; return; }
    if (!this.selected || !this.rooms.some((r) => r.id === this.selected)) this.selected = this.rooms[0].id;
    list.innerHTML = this.rooms.map((r) => `<div class="room${r.id === this.selected ? ' sel' : ''}" data-id="${r.id}">
      <div><b>${esc(r.name)}</b> ${r.locked ? '🔒' : ''}<div class="code">CODE ${r.id}</div></div>
      <div class="m">${r.mode === 'royale' ? '<span class="mode">BATTLE ROYALE</span> ' : ''}${r.ai?.length ? '<span class="mode ai">AI ZONE</span> ' : ''}${esc(r.mapName)}</div><div class="m">${r.bots} ${r.mode === 'royale' ? 'bots' : 'bots/team'}</div><div class="p">${r.players}/${r.max}</div></div>`).join('');
    for (const el of list.querySelectorAll('.room')) {
      el.onclick = () => { this.selected = el.dataset.id; this.refresh(); };
      el.ondblclick = () => { this.selected = el.dataset.id; $('play').click(); };
    }
    $('roomcount').textContent = `${this.rooms.length} public rooms · ${this.rooms.reduce((s, r) => s + r.players, 0)} players online`;
  }

  async lookup() {
    const code = $('j-code').value.trim().toUpperCase();
    if (code.length < 4) { $('j-info').textContent = ''; return; }
    const r = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    $('j-info').textContent = r.ok ? (await r.json().then((i) => `${i.name} · ${i.mapName} · ${i.players}/${i.max} players${i.locked ? ' · password required' : ''}`)) : 'No room with that code.';
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

  // Resolve what the JOIN button means for the current tab. Returns { room, password } or throws.
  async choose() {
    if (this.tab === 'ai') {
      const ai = this.aiConfig();
      const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `AI Zone · ${ai.name}`, map: $('ai-map').value, bots: +$('ai-bots').value, maxPlayers: 12, private: true, rotation: false, ai: [ai] }) });
      const info = await res.json();
      if (!res.ok) throw new Error(info.error || 'Could not create the AI room');
      return { room: info.id, password: '' };
    }
    if (this.tab === 'browse') {
      if (!this.selected) throw new Error('Pick a room first');
      const r = this.rooms.find((x) => x.id === this.selected);
      const password = r?.locked ? prompt('Room password:') || '' : '';
      return { room: this.selected, password };
    }
    if (this.tab === 'code') {
      const code = $('j-code').value.trim().toUpperCase();
      if (!code) throw new Error('Enter a room code');
      return { room: code, password: $('j-pass').value };
    }
    const body = {
      name: $('c-name').value.trim(), map: $('c-map').value, bots: +$('c-bots').value, maxPlayers: +$('c-max').value,
      private: $('c-private').checked, password: $('c-pass').value, rotation: $('c-rotation').checked,
    };
    const res = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || 'Could not create room');
    return { room: info.id, password: body.password };
  }
}

export function inviteLink(room) { return `${location.origin}/?room=${encodeURIComponent(room)}`; }
