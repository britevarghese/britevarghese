// Room chat: Enter (or the chat button) opens the panel with everything said since you joined, a line to type in and
// quick phrases to send with one tap (handy on a phone, or mid-crossing); Enter sends, Esc closes. While it is closed
// the latest lines float up by the minimap and fade, the button counts what you haven't read, and what a friend says
// shows over their truck for a few seconds (core/Game.js).
import { escapeHtml } from './HUD.js';

const $ = (id) => document.getElementById(id);
export const QUICK = ['Hi!', 'Follow me', 'Wait for me', 'Need a tow!', 'Race?', 'On my way', 'Nice!', 'Ha ha', 'Thanks!', 'GG', 'Watch out!', 'Stuck!'];
const KEEP = 80;

export const chatIcon = () => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="11.5" r="1.2" fill="currentColor"/><circle cx="12" cy="11.5" r="1.2" fill="currentColor"/><circle cx="16" cy="11.5" r="1.2" fill="currentColor"/></svg>';

export class Chat {
  /** hooks: { send(text), onOpen(open) }; hud: for the floating lines. */
  constructor(hud, hooks) {
    this.hud = hud; this.hooks = hooks;
    this.panel = $('chat-panel'); this.history = $('chat-history'); this.input = $('chat-input');
    this.btn = $('chat-btn'); this.badge = $('chat-unread');
    this.isOpen = false;
    this.unread = 0;
    this.btn.innerHTML = `${chatIcon()}<span id="chat-unread" class="chat-unread hidden"></span>`;
    this.badge = $('chat-unread');
    this.btn.addEventListener('click', (e) => { e.preventDefault(); this.toggle(); });
    $('chat-quick').innerHTML = QUICK.map((q) => `<button data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
    $('chat-quick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      this.say(b.dataset.q);
      this.close();
    });
    $('chat-send').addEventListener('click', () => { this.say(this.input.value); this.input.value = ''; this.close(); });
    $('chat-close').addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.say(this.input.value); this.input.value = ''; this.close(); e.preventDefault(); }
      else if (e.key === 'Escape') { this.close(); e.preventDefault(); }
      e.stopPropagation();              // (the game's keys stay out of what you type)
    });
  }

  /** In a room there is someone to talk to: the button shows. */
  setAvailable(on) {
    this.available = on;
    this.btn.classList.toggle('hidden', !on);
    if (!on && this.isOpen) this.close();
  }

  say(text) {
    const t = String(text || '').trim().slice(0, 160);
    if (t) this.hooks.send(t);
  }

  open(focus = true) {
    if (!this.available || this.isOpen) return;
    this.isOpen = true;
    this.panel.classList.remove('hidden');
    document.body.classList.add('chat-open');
    this.unread = 0; this.showUnread();
    this.history.scrollTop = this.history.scrollHeight;
    // (on a phone the keyboard waits for a tap on the line: the quick phrases may be all that's wanted)
    if (focus && !document.body.classList.contains('touch')) this.input.focus();
    this.hooks.onOpen(true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.classList.add('hidden');
    document.body.classList.remove('chat-open');
    this.input.blur();
    this.hooks.onOpen(false);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  /** A line from a player (name, their colour; mine: said by us). */
  add(name, text, color, mine = false) {
    this.push(`<b style="color:${color || '#e8893a'}">${escapeHtml(name)}${mine ? ' (you)' : ''}</b> ${escapeHtml(text)}`);
    this.hud.chat(name, text, color);
    if (!this.isOpen && !mine) { this.unread++; this.showUnread(); }
  }

  /** A line from the game: someone joined, left, found a beacon. */
  system(text) {
    this.push(`<i>${escapeHtml(text)}</i>`);
    this.hud.chat(null, text);
  }

  push(html) {
    const d = document.createElement('div');
    const t = new Date();
    d.innerHTML = `<span class="ct">${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span> ${html}`;
    const atEnd = this.history.scrollTop + this.history.clientHeight >= this.history.scrollHeight - 8;
    this.history.appendChild(d);
    while (this.history.children.length > KEEP) this.history.firstChild.remove();
    if (atEnd || !this.isOpen) this.history.scrollTop = this.history.scrollHeight;
  }

  showUnread() {
    this.badge.textContent = this.unread > 9 ? '9+' : String(this.unread);
    this.badge.classList.toggle('hidden', !this.unread);
  }
}

/**
 * What a friend just said, as a speech bubble to float over their truck: a canvas just the size of the bubble (the
 * text wrapped to two lines, cut short past that), for a sprite: 50 px of it to a metre at the name tag's scale.
 */
export function bubbleCanvas(text) {
  const font = '600 34px sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (m.measureText(t).width > 440 && line) { lines.push(line); line = w; } else line = t;
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && line) lines.push(line);
  if (lines.length === 2 && words.join(' ').length > lines.join(' ').length) {
    while (m.measureText(lines[1] + '…').width > 440 && lines[1].length > 1) lines[1] = lines[1].slice(0, -1);
    lines[1] += '…';
  }
  const w = Math.ceil(Math.min(484, Math.max(...lines.map((l) => m.measureText(l).width)) + 44)), h = lines.length * 42 + 26;
  const c = document.createElement('canvas'); c.width = w + 8; c.height = h + 30;
  const g = c.getContext('2d');
  g.font = font;
  g.fillStyle = 'rgba(250,247,240,0.96)'; g.strokeStyle = 'rgba(20,25,22,0.35)'; g.lineWidth = 3;
  g.beginPath(); g.roundRect(4, 4, w, h, 24); g.fill(); g.stroke();
  const cx = c.width / 2;
  g.beginPath(); g.moveTo(cx - 16, 4 + h - 1); g.lineTo(cx, 4 + h + 22); g.lineTo(cx + 16, 4 + h - 1); g.closePath(); g.fill();
  g.fillStyle = '#1c241f'; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, cx, 4 + 13 + 21 + i * 42));
  return c;
}
