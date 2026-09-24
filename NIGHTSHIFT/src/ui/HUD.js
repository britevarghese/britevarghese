// HUD: analog/digital hybrid speedometer (canvas), circular minimap cropped from the 2D map,
// heat level, pursuit/bust meters, race info, cash, prompts and center messages.
import { clamp, lerp, formatTime, formatMoney } from '../core/util.js';
import { MAP_SCALE } from './MapRenderer.js';
import { WORLD_HALF } from '../world/CityLayout.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class HUD {
  constructor(root, mapRenderer, settings) {
    this.root = root;
    this.map = mapRenderer;
    this.settings = settings;
    root.innerHTML = '';
    // minimap + heat
    const mm = h('div', 'minimap-wrap');
    this.mmCanvas = h('canvas'); this.mmCanvas.id = 'minimap';
    this.heatEl = h('div', 'heat', '<i></i><i></i><i></i><i></i><i></i>');
    this.districtEl = h('div', 'district', '');
    mm.append(this.mmCanvas, this.heatEl, this.districtEl);
    // speedo
    const sp = h('div', 'speedo');
    this.spCanvas = h('canvas'); this.spCanvas.id = 'speedo-canvas';
    this.speedEl = h('div', 'speed-digits', '0');
    this.unitEl = h('div', 'speed-unit', 'KM/H');
    this.gearEl = h('div', 'gear', 'N');
    this.nosEl = h('div', 'nos-label', 'NOS');
    sp.append(this.spCanvas, this.speedEl, this.unitEl, this.gearEl, this.nosEl);
    // top
    this.topCenter = h('div', 'top-center');
    this.topRight = h('div', 'top-right', '<div class="cash">$0</div><div class="clock">--:--</div><div class="lvl"><span class="lv">LV 1</span><span class="xpbar"><i></i></span></div>');
    this.raceBoard = h('div', 'race-board panel hidden');
    this.centerMsg = h('div', 'center-msg hidden');
    this.pursuit = h('div', 'pursuit hidden', '<div class="lbl">PURSUIT</div><div class="bar"><div class="fill"></div></div><div class="info"></div>');
    this.prompt = h('div', 'prompt hidden');
    this.combo = h('div', 'combo hidden', '<div class="cl"></div><div class="cp"></div><div class="ct"><i></i></div>');
    root.append(mm, sp, this.topCenter, this.topRight, this.raceBoard, this.centerMsg, this.pursuit, this.prompt, this.combo);
    this.disp = { speed: 0, rpm: 0, nitro: 1 };
    this.msgT = 0;
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [this.spCanvas, this.mmCanvas]) {
      const r = c.getBoundingClientRect();
      c.width = Math.max(64, Math.round(r.width * dpr)); c.height = Math.max(64, Math.round(r.height * dpr));
    }
  }

  message(text, sub = '', time = 2, small = false) {
    this.centerMsg.className = 'center-msg pop' + (small ? ' small' : '');
    this.centerMsg.innerHTML = `${text}${sub ? `<span class="sub">${sub}</span>` : ''}`;
    this.msgT = time;
  }

  setPrompt(html) {
    if (!html) { this.prompt.classList.add('hidden'); return; }
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.remove('hidden');
  }

  update(dt, g) {
    const player = g.player;
    if (!player) return;
    const s = player.state;
    const mph = this.settings.gameplay.units === 'mph';
    const kmh = Math.abs(s.speed) * 3.6;
    this.disp.speed = lerp(this.disp.speed, mph ? kmh * 0.621 : kmh, 1 - Math.exp(-dt * 12));
    this.disp.rpm = lerp(this.disp.rpm, s.rpm, 1 - Math.exp(-dt * 14));
    this.disp.nitro = lerp(this.disp.nitro, s.nitro, 1 - Math.exp(-dt * 8));
    this.speedEl.textContent = Math.round(this.disp.speed);
    this.unitEl.textContent = mph ? 'MPH' : 'KM/H';
    this.gearEl.textContent = player.physics.reverse ? 'R' : Math.abs(s.speed) < 0.3 && s.throttle < 0.05 ? 'N' : String(s.gear);
    this._drawSpeedo(player);
    this._drawMinimap(g);
    // heat
    const heat = g.police?.heat || 0;
    const stars = this.heatEl.children;
    for (let i = 0; i < 5; i++) stars[i].classList.toggle('on', i < heat && g.police.inPursuit);
    this.heatEl.style.visibility = heat > 0 && g.police.inPursuit ? 'visible' : 'hidden';
    const dist = g.world.districtAt(s.x, s.z).name;
    if (this.districtEl.textContent !== dist) this.districtEl.textContent = dist;
    // cash
    const cash = formatMoney(g.save.data.cash);
    const cashEl = this.topRight.firstChild;
    if (cashEl.textContent !== cash) cashEl.textContent = cash;
    // in-game clock
    const hr = g.env?.hour ?? 0, hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const clockEl = this.topRight.children[1];
    if (clockEl.textContent !== clock) clockEl.textContent = clock;
    // style chain
    const ch = g.progress?.chain;
    if (ch?.active) {
      this.combo.classList.remove('hidden');
      const [cl, cp, ct] = this.combo.children;
      const lbl = `${ch.last} <b>x${ch.mult}</b>`;
      if (cl.innerHTML !== lbl) cl.innerHTML = lbl;
      cp.textContent = Math.round(ch.points * ch.mult).toLocaleString();
      ct.firstChild.style.width = `${Math.max(0, ch.timer / 3.2) * 100}%`;
    } else this.combo.classList.add('hidden');
    // driver level + progress to the next level
    if (g.progress) {
      const L = g.progress.info;
      const lv = `LV ${L.level}`;
      const lvEl = this.topRight.querySelector('.lv');
      if (lvEl.textContent !== lv) lvEl.textContent = lv;
      const w = `${L.need ? Math.round((L.into / L.need) * 100) : 100}%`;
      const bar = this.topRight.querySelector('.xpbar i');
      if (bar.style.width !== w) bar.style.width = w;
    }
    // pursuit bar
    const P = g.police;
    if (P && P.inPursuit) {
      this.pursuit.classList.remove('hidden');
      const lbl = this.pursuit.firstChild, fill = this.pursuit.querySelector('.fill'), info = this.pursuit.lastChild;
      if (P.bust > 0.02) { lbl.textContent = 'BUSTED'; lbl.style.color = '#ff3d5a'; fill.className = 'fill bust'; fill.style.width = `${P.bust * 100}%`; }
      else if (P.state === 'cooldown') { lbl.textContent = 'COOLDOWN'; lbl.style.color = '#37e2ff'; fill.className = 'fill'; fill.style.width = `${P.cooldown * 100}%`; }
      else { lbl.textContent = 'EVADE'; lbl.style.color = '#ffc53d'; fill.className = 'fill'; fill.style.width = `${P.evade * 100}%`; }
      info.textContent = `HEAT ${P.heat} · UNITS ${P.units.filter((u) => !u.disabled && u.role !== 'patrol').length} · BOUNTY ${formatMoney(P.bounty + Math.round(P.pursuitTime * 12))}`;
    } else this.pursuit.classList.add('hidden');
    // race info
    const R = g.races?.active;
    if (R && R.state !== 'countdown') {
      const parts = [];
      const def = R.def;
      if (def.type === 'sprint' || def.type === 'circuit') parts.push(['POSITION', `${R.position || 1}/${R.opponents.length + 1}`]);
      if (def.type === 'circuit') parts.push(['LAP', `${R.lap}/${R.laps}`]);
      if (R.ev.gates.length) parts.push(['CHECKPOINT', `${Math.min(R.gate + 1, R.ev.gates.length)}/${R.ev.gates.length}`]);
      if (def.type === 'checkpoint' || def.type === 'escape') parts.push(['TIME LEFT', formatTime(Math.max(0, R.timeLeft))]);
      else parts.push(['TIME', formatTime(R.time)]);
      if (def.type === 'speedrun') parts.push(['SPEED TOTAL', Math.round(R.speeds.reduce((a, b) => a + b, 0))]);
      const html = parts.map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
      if (this.topCenter.innerHTML !== html) this.topCenter.innerHTML = html;
      if (R.standings && R.opponents.length) {
        this.raceBoard.classList.remove('hidden');
        const bh = R.standings.map((e, i) => `<div class="${e.me ? 'me' : ''}"><span>${i + 1}. ${e.name}</span></div>`).join('');
        if (this.raceBoard.innerHTML !== bh) this.raceBoard.innerHTML = bh;
      } else this.raceBoard.classList.add('hidden');
    } else {
      if (this.topCenter.innerHTML) this.topCenter.innerHTML = '';
      this.raceBoard.classList.add('hidden');
    }
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.centerMsg.classList.add('hidden'); }
  }

  _drawSpeedo(player) {
    const c = this.spCanvas, g = c.getContext('2d');
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = W * 0.44;
    g.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const p = player.p, s = player.state;
    const rpmMax = Math.ceil(p.redline / 1000 + 1) * 1000;
    const rpmK = clamp(this.disp.rpm / rpmMax, 0, 1);
    // backdrop
    const bg = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.05);
    bg.addColorStop(0, 'rgba(6,9,14,0.75)'); bg.addColorStop(1, 'rgba(6,9,14,0.15)');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R * 1.05, 0, Math.PI * 2); g.fill();
    // track
    g.lineCap = 'butt';
    g.lineWidth = R * 0.07;
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
    // redline zone
    const rl = p.redline / rpmMax;
    g.strokeStyle = 'rgba(255,61,90,0.55)';
    g.beginPath(); g.arc(cx, cy, R, a0 + (a1 - a0) * rl, a1); g.stroke();
    // rpm fill
    const grad = g.createLinearGradient(0, H, W, 0);
    grad.addColorStop(0, '#37e2ff'); grad.addColorStop(0.7, '#e8f6ff'); grad.addColorStop(1, '#ff3d5a');
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R, a0, a0 + (a1 - a0) * rpmK); g.stroke();
    // ticks + labels
    g.fillStyle = '#c8d0dc'; g.font = `600 ${Math.round(R * 0.11)}px Segoe UI, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= rpmMax; r += 500) {
      const k = r / rpmMax, a = a0 + (a1 - a0) * k;
      const major = r % 1000 === 0;
      g.strokeStyle = r >= p.redline ? '#ff3d5a' : 'rgba(255,255,255,0.7)';
      g.lineWidth = major ? R * 0.025 : R * 0.012;
      const r0 = R * (major ? 0.8 : 0.85), r1 = R * 0.9;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
      if (major) g.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.68, cy + Math.sin(a) * R * 0.68);
    }
    // needle
    const na = a0 + (a1 - a0) * rpmK;
    g.strokeStyle = '#ff3d5a'; g.lineWidth = R * 0.03; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + Math.cos(na) * R * 0.25, cy + Math.sin(na) * R * 0.25); g.lineTo(cx + Math.cos(na) * R * 0.95, cy + Math.sin(na) * R * 0.95); g.stroke();
    // nitro arc (bottom)
    const n0 = Math.PI * 0.62, n1 = Math.PI * 0.38;
    g.lineWidth = R * 0.05; g.lineCap = 'butt';
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.arc(cx, cy, R * 0.78, n0, n1, true); g.stroke();
    g.strokeStyle = s.nitroActive ? '#9af3ff' : '#37e2ff';
    g.beginPath(); g.arc(cx, cy, R * 0.78, n0, n0 - (n0 - n1) * this.disp.nitro, true); g.stroke();
    // damage indicator
    if (s.damage > 0.05) {
      g.fillStyle = `rgba(255,${Math.round(200 - s.damage * 160)},60,0.9)`;
      g.font = `700 ${Math.round(R * 0.09)}px Segoe UI, Arial`;
      g.fillText(`DMG ${Math.round(s.damage * 100)}%`, cx, cy + R * 0.95);
    }
  }

  _drawMinimap(game) {
    const c = this.mmCanvas, g = c.getContext('2d');
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2;
    const s = game.focusState;
    const speed = Math.hypot(s.vx, s.vz);
    const viewR = lerp(170, 320, clamp(speed / 60, 0, 1)); // meters radius
    this.zoom = lerp(this.zoom || viewR, viewR, 0.05);
    const scale = (W / 2) / this.zoom; // canvas px per meter
    const M = this.map;
    g.clearRect(0, 0, W, H);
    g.save();
    g.beginPath(); g.arc(cx, cy, W / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0a0e12'; g.fillRect(0, 0, W, H);
    g.translate(cx, cy);
    g.rotate(-s.yaw + Math.PI * 0);
    // map image: world point (x,z) -> map px ((x+WH)*S, (WH-z)*S); we want player at origin
    const k = scale / MAP_SCALE;
    g.scale(k, k);
    g.translate(-M.px(s.x), -M.pz(s.z));
    g.globalAlpha = 0.95;
    g.drawImage(M.canvas, 0, 0);
    g.globalAlpha = 1;
    const W2 = (x, z) => [M.px(x), M.pz(z)];
    const dot = (x, z, r, col) => { const [a, b] = W2(x, z); g.fillStyle = col; g.beginPath(); g.arc(a, b, r / k, 0, Math.PI * 2); g.fill(); };
    // route (race or GPS)
    const route = game.races?.active?.ev.route || game.gps?.route;
    if (route && route.length > 1) {
      g.strokeStyle = game.races?.active ? 'rgba(255,197,61,0.9)' : 'rgba(55,226,255,0.85)';
      g.lineWidth = 5 / k; g.lineJoin = 'round';
      g.beginPath(); route.forEach(([x, z], i) => { const [a, b] = W2(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
    }
    // events & safehouses (only when free roaming)
    if (!game.races?.active) {
      for (const ev of game.races?.events || []) dot(ev.start.x, ev.start.z, 5, ev.def.type === 'escape' ? '#3d7bff' : '#ffc53d');
      for (const sh of game.safehouses || []) dot(sh.x, sh.z, 5, '#3dff9a');
    }
    // next checkpoint
    const gate = game.races?.nextGate();
    if (gate) { const [a, b] = W2(gate.x, gate.z); g.strokeStyle = '#ff3d5a'; g.lineWidth = 3 / k; g.beginPath(); g.arc(a, b, 9 / k, 0, Math.PI * 2); g.stroke(); }
    // traffic
    for (const t of game.traffic?.cars || []) if (t.dist < this.zoom * 1.1) dot(t.x, t.z, 2.2, 'rgba(200,210,220,0.55)');
    // racers
    for (const v of game.races?.vehicles() || []) dot(v.state.x, v.state.z, 3.6, '#ffc53d');
    for (const r of game.rivals?.rivals || []) dot(r.v.state.x, r.v.state.z, 4.2, r.crew.color);
    // police
    const blink = Math.floor(performance.now() / 180) % 2;
    for (const u of game.police?.units || []) dot(u.vehicle.state.x, u.vehicle.state.z, 4, u.disabled ? '#555' : u.vehicle.renderer.sirenOn ? (blink ? '#ff3040' : '#3060ff') : '#9aa8ff');
    // multiplayer ghosts
    for (const r of game.net?.remotes?.values() || []) dot(r.x, r.z, 3.6, '#b967ff');
    g.restore();
    // player arrow (always up)
    g.save(); g.translate(cx, cy);
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -W * 0.045); g.lineTo(W * 0.03, W * 0.035); g.lineTo(0, W * 0.02); g.lineTo(-W * 0.03, W * 0.035); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // ring
    g.strokeStyle = game.police?.inPursuit ? (blink ? 'rgba(255,61,90,0.8)' : 'rgba(60,100,255,0.8)') : 'rgba(255,255,255,0.15)';
    g.lineWidth = W * 0.02; g.beginPath(); g.arc(cx, cy, W / 2 - W * 0.01, 0, Math.PI * 2); g.stroke();
    // N marker
    const na = -s.yaw - Math.PI / 2;
    g.fillStyle = '#ff3d5a'; g.font = `700 ${Math.round(W * 0.07)}px Segoe UI, Arial`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', cx + Math.cos(na) * W * 0.42, cy + Math.sin(na) * W * 0.42);
    void WORLD_HALF; void formatTime;
  }
}
