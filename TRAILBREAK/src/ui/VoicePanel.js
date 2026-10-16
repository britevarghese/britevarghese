// The voice chat's controls (net/Voice.js): the microphone button by the players list (join; then mute and unmute,
// or hold to talk), and the pause menu's panel: join or leave, open mic or push-to-talk, mute yourself, mute
// everyone, the voices' volume, and each player's mute and volume with whether they are talking.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A microphone (slashed when off). */
export function micIcon(off = false) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14.5a3 3 0 0 0 3-3V5.5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5.2-3a5.2 5.2 0 0 1-10.4 0H5a7 7 0 0 0 6 6.9V21h2v-2.6a7 7 0 0 0 6-6.9h-1.8z"/>${off ? '<path d="M4 3.5l16 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' : ''}</svg>`;
}

const LINK = { direct: 'connected', relay: 'through the server', connecting: 'connecting…', off: '' };

export class VoicePanel {
  /** voice: the Voice; settings: the saved settings (voice: { mode, volume, auto }); hint(text): a HUD hint. */
  constructor(voice, settings, save, hint) {
    this.v = voice; this.s = settings; this.save = save; this.hint = hint;
    const vs = settings.voice || (settings.voice = {});
    voice.setMode(vs.mode || 'open');
    voice.setVolume(Number.isFinite(vs.volume) ? vs.volume : 1);
    $('voice-box').classList.remove('hidden');
    // the button by the players list: join; then a tap mutes or unmutes (push-to-talk: hold it)
    const btn = this.btn = $('voice-btn');
    btn.classList.remove('hidden');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (!voice.joined) { this.join(); return; }
      if (voice.mode === 'ptt') { btn.setPointerCapture?.(e.pointerId); this.btnHeld = true; voice.setPtt(true); } else this.toggleMute();
    });
    const up = () => { if (this.btnHeld) { this.btnHeld = false; voice.setPtt(false); } };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
    // the pause menu's panel
    $('v-join').onclick = () => (voice.joined ? this.leave() : this.join());
    $('v-mode').value = voice.mode;
    $('v-mode').onchange = () => { voice.setMode($('v-mode').value); vs.mode = voice.mode; save(); };
    $('v-mute').onchange = () => voice.setSelfMuted($('v-mute').checked);
    $('v-deaf').onchange = () => voice.setDeaf($('v-deaf').checked);
    $('v-vol').value = voice.volume;
    $('v-vol').oninput = () => { voice.setVolume(Number($('v-vol').value)); vs.volume = voice.volume; save(); this.volText(); };
    $('v-peers').addEventListener('change', (e) => { const id = Number(e.target.closest('[data-id]')?.dataset.id); if (e.target.matches('[data-mute]')) voice.setPeerMuted(id, e.target.checked); });
    $('v-peers').addEventListener('input', (e) => { const id = Number(e.target.closest('[data-id]')?.dataset.id); if (e.target.matches('[data-vol]')) voice.setPeerVolume(id, Number(e.target.value)); });
    voice.onChange = () => this.render();
    this.render();
    if (vs.auto) this.join(true);
  }

  async join(quiet = false) {
    await this.v.join();
    this.s.voice.auto = true; this.save();
    if (!quiet || this.v.micNote) this.hint(this.v.micNote || (this.v.mode === 'ptt' ? 'Voice chat: hold V (or the mic button) to talk' : 'Voice chat on: V mutes your microphone'), 4);
  }

  leave() { this.v.leave(); this.s.voice.auto = false; this.save(); this.hint('Left the voice chat', 2); }

  toggleMute() {
    const v = this.v;
    v.setSelfMuted(!v.selfMuted);
    $('v-mute').checked = v.selfMuted;
    this.hint(v.selfMuted ? 'Microphone muted (V)' : 'Microphone on', 1.5);
  }

  /** The V key: join, then mute and unmute (push-to-talk: the game holds it down through setPtt). */
  key() { if (!this.v.joined) this.join(); else if (this.v.mode === 'open') this.toggleMute(); }

  /** Each player's voice state for the players list: 'talking', 'on', 'muted' or '' (not in voice). */
  stateOf(p) {
    const v = this.v;
    if (!p) return !v.joined ? '' : !v.track || !v.talking ? 'muted' : v.speaking() ? 'talking' : 'on';
    if (!v.joined || !p.voice) return '';
    return v.speaking(p) ? 'talking' : !p.mic || p.mute || p.muted ? 'muted' : 'on';
  }

  render() {
    const v = this.v, joined = v.joined;
    $('v-join').textContent = joined ? 'Leave voice' : 'Join voice';
    $('v-join').className = joined ? 'ghost small' : 'primary small';
    $('v-controls').classList.toggle('hidden', !joined);
    $('v-note').textContent = joined ? (v.micNote || (v.mode === 'ptt' ? 'hold V to talk' : v.selfMuted ? 'your mic is muted' : 'your mic is on (V mutes it)'))
      : 'talk to the others in this room';
    $('v-mute').checked = v.selfMuted; $('v-deaf').checked = v.deaf; $('v-mode').value = v.mode;
    this.volText();
    const list = v.others;
    const html = list.length ? list.map((p) => {
      const state = !p.voice ? 'not in voice chat' : [LINK[p.link], !p.mic ? 'no microphone' : p.mute ? 'mic muted' : ''].filter(Boolean).join(' · ');
      return `<div class="v-peer" data-id="${p.id}"><span class="vic">${micIcon(!p.voice || !p.mic || p.mute)}</span><b>${esc(p.name)}</b><span class="dim">${esc(state)}</span>
        <label><input type="checkbox" data-mute ${p.muted ? 'checked' : ''}> Mute</label><input type="range" data-vol min="0" max="2" step="0.05" value="${p.vol}" aria-label="${esc(p.name)}'s volume"></div>`;
    }).join('') : '<div class="v-alone"><svg class="ic"><use href="#i-people"/></svg>You\'re the only driver in this room.</div>';
    // (rebuilt only when it changes: not under a slider being dragged)
    const key = list.map((p) => `${p.id}${p.name}${p.voice}${p.mic}${p.mute}${p.muted}${p.link}`).join('|') + joined;
    if (key !== this.key) { this.key = key; $('v-peers').innerHTML = html; }
    this.tick();
  }

  volText() { const el = $('v-vol-n'); if (el) el.textContent = `${Math.round(this.v.volume * 100)}%`; }

  /** The talking lights (a few times a second). */
  tick() {
    const v = this.v, me = this.stateOf(null);
    this.btn.innerHTML = micIcon(v.joined && me === 'muted');
    this.btn.className = `voice-btn ${v.joined ? me : 'off'}`;
    this.btn.title = !v.joined ? 'Join the voice chat (V)' : v.mode === 'ptt' ? 'Hold to talk (V)' : v.selfMuted ? 'Unmute (V)' : 'Mute (V)';
    for (const row of $('v-peers').children) {
      const p = v.peers.get(Number(row.dataset.id));
      row.classList.toggle('talking', !!p && v.joined && v.speaking(p));
    }
  }
}
