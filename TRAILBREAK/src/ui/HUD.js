// The heads-up display: dials, drivetrain chips, winch, compass with beacons and friends, the next beacon, the
// players, a rotating minimap and the full map, toasts, hints and chat.
import { MAP_HALF } from '../world/MapData.js';
import { BEACONS, BEACON_RADIUS } from '../world/MapData.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;

export class HUD {
  constructor(world, terrainRenderer) {
    this.world = world;
    this.el = $('hud');
    this.gauges = $('gauges').getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.toastsEl = $('toasts');
    this.hintEl = $('hint');
    this.chatLog = $('chat-log');
    this.strip = $('compass-strip');
    this.mapImage = this.buildMapImage(terrainRenderer);
    this.found = new Set();
    this.t = 0;
    this.hintT = 0;
    this.compassMarks = [];
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  /** The valley as a picture: ground colours with hill shading, water, trails, buildings. */
  buildMapImage(tr) {
    const S = 1024, c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const w = this.world, step = (2 * MAP_HALF) / S;
    const out = [0, 0, 0];
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const px = -MAP_HALF + (i + 0.5) * step, pz = -MAP_HALF + (j + 0.5) * step;
        const h = w.terrain(px, pz);
        const hx = w.terrain(px + step, pz) - w.terrain(px - step, pz), hz = w.terrain(px, pz + step) - w.terrain(px, pz - step);
        const nx = -hx / (2 * step), nz = -hz / (2 * step);
        const shade = Math.max(0.35, Math.min(1.35, 0.92 + (nx * -0.6 + nz * -0.5) * 1.2));
        tr.colorAt(px, pz, step, h, Math.hypot(nx, nz), out);
        let r = Math.sqrt(out[0]) * shade, g = Math.sqrt(out[1]) * shade, b = Math.sqrt(out[2]) * shade;
        const wl = w.water(px, pz);
        if (wl > -1e8 && h < wl) { r = 0.22; g = 0.42; b = 0.5; }
        const o = (j * S + i) * 4;
        img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, g * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const toPx = (v) => (v + MAP_HALF) / (2 * MAP_HALF) * S;
    // the woods: each tree's crown
    const T = w.trees;
    x.fillStyle = 'rgba(42,66,32,0.5)';
    for (let t = 0; t < T.count; t++) {
      x.beginPath();
      x.arc(toPx(T.x[t]), toPx(T.z[t]), Math.max(0.9, (T.h[t] * 0.16) / step), 0, 6.2832);
      x.fill();
    }
    // trails
    for (const t of w.data.trails) {
      x.beginPath();
      t.points.forEach(([px, pz], k) => (k ? x.lineTo(toPx(px), toPx(pz)) : x.moveTo(toPx(px), toPx(pz))));
      x.strokeStyle = t.kind === 'road' ? 'rgba(235,225,200,0.85)' : 'rgba(120,80,45,0.9)';
      x.lineWidth = t.kind === 'road' ? 2.6 : 1.6;
      x.setLineDash(t.kind === 'road' ? [] : [5, 3]);
      x.stroke();
    }
    x.setLineDash([]);
    for (const L of w.landmarks) {
      x.fillStyle = '#3a2a1e';
      x.fillRect(toPx(L.x) - 2.5, toPx(L.z) - 2.5, 5, 5);
    }
    return c;
  }

  // ---------------------------------------------------------------- dials
  drawGauges(v) {
    const g = this.gauges, W = 360, H = 170;
    g.clearRect(0, 0, W, H);
    const dial = (cx, cy, r, value, max, label, unit, red) => {
      g.save();
      g.translate(cx, cy);
      g.fillStyle = 'rgba(20,25,22,0.72)';
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(243,234,215,0.16)'; g.lineWidth = 1.5; g.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      if (red) {
        g.strokeStyle = 'rgba(224,86,59,0.8)'; g.lineWidth = 5;
        g.beginPath(); g.arc(0, 0, r - 9, a0 + (a1 - a0) * red, a1); g.stroke();
      }
      const ticks = 10;
      for (let i = 0; i <= ticks * 2; i++) {
        const a = a0 + (a1 - a0) * i / (ticks * 2), big = i % 2 === 0;
        g.strokeStyle = big ? '#f3ead7' : 'rgba(243,234,215,0.45)'; g.lineWidth = big ? 2 : 1;
        g.beginPath(); g.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6)); g.lineTo(Math.cos(a) * (r - (big ? 15 : 11)), Math.sin(a) * (r - (big ? 15 : 11))); g.stroke();
        if (big && i % 4 === 0) {
          g.fillStyle = 'rgba(243,234,215,0.8)'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(Math.round(max * i / (ticks * 2) / (unit === 'rpm' ? 1000 : 1))), Math.cos(a) * (r - 26), Math.sin(a) * (r - 26));
        }
      }
      const a = a0 + (a1 - a0) * Math.max(0, Math.min(1.02, value / max));
      g.strokeStyle = '#e8893a'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-Math.cos(a) * 8, -Math.sin(a) * 8); g.lineTo(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12)); g.stroke();
      g.fillStyle = '#e8893a'; g.beginPath(); g.arc(0, 0, 4, 0, TAU); g.fill();
      g.fillStyle = '#f3ead7'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center';
      g.fillText(label, 0, r * 0.5);
      g.fillStyle = 'rgba(243,234,215,0.6)'; g.font = '10px sans-serif';
      g.fillText(unit === 'rpm' ? 'x1000 rpm' : 'km/h', 0, r * 0.5 + 16);
      g.restore();
    };
    const kmh = Math.abs(v.speed) * 3.6;
    const e = v.dt.e;
    dial(268, 86, 80, kmh, 140, String(Math.round(kmh)), 'kmh');
    dial(92, 96, 70, v.dt.rpm, 5000, v.dt.running ? v.dt.gearLabel : 'OFF', 'rpm', e.redline / 5000);
  }

  drawChips(v) {
    const d = v.dt;
    const set = (id, text, cls) => { const el = $(id); if (el.textContent !== text) el.textContent = text; el.className = 'chip' + (cls ? ' ' + cls : ''); };
    set('m-range', d.low ? 'LOW' : 'HIGH', d.low ? 'on' : '');
    set('m-4wd', d.fourWD ? '4WD' : '2WD', d.fourWD ? 'on' : '');
    const lsd = d.diffs.rear === 'lsd';
    set('m-lock', d.lockFront && d.lockRear ? 'LOCK F+R' : d.lockRear ? 'LOCK R' : lsd ? 'LSD' : 'OPEN', d.lockRear ? 'on2' : '');
    set('m-box', `${d.manual ? 'STICK' : 'AUTO'} ${d.auto ? '' : 'M'}${d.gearLabel}`, d.auto ? '' : 'on2');
    const psi = Math.round(v.psiAir ?? v.psi), dir = v.psiTarget < psi - 0.4 ? ' ↓' : v.psiTarget > psi + 0.4 ? ' ↑' : '';
    set('m-psi', `${psi} PSI${dir}`, psi < 25 ? 'on2' : '');
    const eng = $('m-eng');
    eng.classList.toggle('hidden', d.running);
    if (!d.running) eng.textContent = d.crankT > 0 ? 'CRANKING' : v.flooded ? 'FLOODED' : 'ENGINE OFF';
    const sway = $('m-sway');
    sway.classList.toggle('hidden', !v.swayDisconnected);
    // damage: the coolant temperature once the radiator leaks or it runs hot, and what is broken
    const D = v.damage, temp = $('m-temp'), hot = D.radiator > 0 || D.temp > 100;
    temp.classList.toggle('hidden', !hot);
    if (hot) set('m-temp', `${Math.round(D.temp)}°C${D.radiator > 0 ? ` · coolant ${Math.round(D.coolant * 100)}%` : ''}`, D.temp > 112 ? 'warn' : 'on2');
    const bad = [];
    D.flat.forEach((f, i) => { if (f) bad.push(`FLAT ${['FL', 'FR', 'RL', 'RR'][i]}`); });
    if (D.shafts.some(Boolean)) bad.push(`AXLE ${D.shafts[0] || D.shafts[1] ? 'F' : ''}${D.shafts[2] || D.shafts[3] ? 'R' : ''}`);
    if (Math.abs(D.toe) > 0.012) bad.push('STEERING');
    if (D.springs.some((x) => x >= 1)) bad.push('SPRING');
    if (D.engine < 0.95) bad.push(D.engine <= 0 ? 'ENGINE SEIZED' : `ENGINE ${Math.round(D.engine * 100)}%`);
    const dmg = $('m-dmg'), text = bad.join(' · ');
    dmg.classList.toggle('hidden', !text);
    if (text && dmg.textContent !== text) dmg.textContent = text;
  }

  drawWinch(v, targetName) {
    const W = v.winch, el = $('winch');
    el.classList.toggle('hidden', !W.attached);
    if (!W.attached) return;
    $('winch-target').textContent = targetName || '';
    $('winch-len').textContent = `${W.len.toFixed(1)} m  ${(W.tension / 1000).toFixed(1)} kN`;
    $('winch-ten').style.width = `${Math.min(100, W.tension / v.spec.winch.stallPull * 100)}%`;
  }

  // ---------------------------------------------------------------- compass, objective, players
  drawCompass(heading, here, mates) {
    // heading: radians, 0 = north (-z), clockwise
    const strip = this.strip, width = strip.parentElement.clientWidth, pxPerRad = width / 2.2;
    const marks = [];
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = 0; d < 360; d += 15) marks.push({ a: d * Math.PI / 180, text: names[d] || '·', cls: names[d] ? '' : 'minor' });
    for (const b of this.world.beacons) {
      const a = Math.atan2(b.x - here.x, -(b.z - here.z));
      marks.push({ a, text: '◆', cls: 'bcn' + (this.found.has(b.id) ? ' done' : '') });
    }
    for (const m of mates) marks.push({ a: Math.atan2(m.x - here.x, -(m.z - here.z)), text: m.help ? '!' : '●', cls: m.help ? 'mate help' : 'mate', color: m.help ? null : m.color });
    let html = '';
    for (const m of marks) {
      let d = m.a - heading;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      if (Math.abs(d) > 1.15) continue;
      const x = width / 2 + d * pxPerRad;
      html += `<span class="${m.cls}" style="left:${x.toFixed(1)}px${m.color ? `;color:${m.color}` : ''}">${m.text}</span>`;
    }
    if (html !== this.lastStrip) { strip.innerHTML = html; this.lastStrip = html; }
  }

  drawObjective(here) {
    let best = null, bd = Infinity;
    for (const b of this.world.beacons) {
      if (this.found.has(b.id)) continue;
      const d = Math.hypot(b.x - here.x, b.z - here.z);
      if (d < bd) { bd = d; best = b; }
    }
    const el = $('objective');
    const n = this.found.size, total = this.world.beacons.length;
    const text = best ? `Beacons <b>${n}/${total}</b> · nearest: <b>${best.name}</b> ${bd < 1000 ? Math.round(bd) + ' m' : (bd / 1000).toFixed(1) + ' km'}` : `All <b>${total}</b> beacons surveyed. The valley is mapped!`;
    if (el.innerHTML !== text) el.innerHTML = text;
  }

  drawPlayers(list) {
    const html = list.map((p) => `<div>${escapeHtml(p.name)}${p.me ? ' (you)' : ''}${p.help ? '<span class="help">needs a tow</span>' : ''}<span class="dot" style="background:${p.color}"></span></div>`).join('');
    const el = $('players');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ---------------------------------------------------------------- maps
  drawMinimap(here, heading, mates) {
    const g = this.mini, S = 220, scale = 1.25;                 // px per metre
    const img = this.mapImage, k = img.width / (2 * MAP_HALF);
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.clip();
    g.translate(S / 2, S / 2);
    g.rotate(-heading);
    g.scale(scale / k, scale / k);
    g.drawImage(img, -(here.x + MAP_HALF) * k, -(here.z + MAP_HALF) * k);
    g.restore();
    g.save();
    g.translate(S / 2, S / 2);
    const put = (x, z, fn) => {
      const dx = (x - here.x) * scale, dz = (z - here.z) * scale;
      const c = Math.cos(-heading), s = Math.sin(-heading);
      let px = dx * c - dz * s, py = dx * s + dz * c;
      const r = Math.hypot(px, py), lim = S / 2 - 8;
      if (r > lim) { px *= lim / r; py *= lim / r; }
      fn(px, py, r > lim);
    };
    for (const b of this.world.beacons) put(b.x, b.z, (px, py, edge) => {
      g.fillStyle = this.found.has(b.id) ? '#7cc36a' : '#e8893a';
      g.beginPath(); g.moveTo(px, py - 5); g.lineTo(px + 4, py); g.lineTo(px, py + 5); g.lineTo(px - 4, py); g.closePath(); g.fill();
      if (edge) { g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke(); }
    });
    for (const m of mates) put(m.x, m.z, (px, py) => {
      if (m.help) { g.strokeStyle = '#e0563b'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, 8 + 3 * Math.sin(performance.now() / 160), 0, TAU); g.stroke(); }
      g.fillStyle = m.color; g.beginPath(); g.arc(px, py, 4.5, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    });
    // us
    g.fillStyle = '#f3ead7'; g.strokeStyle = '#1c241f'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  drawMap(here, heading, mates) {
    const cv = $('map-canvas'), g = cv.getContext('2d'), S = cv.width;
    g.drawImage(this.mapImage, 0, 0, S, S);
    const toPx = (v) => (v + MAP_HALF) / (2 * MAP_HALF) * S;
    g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
    for (const b of this.world.beacons) {
      const x = toPx(b.x), y = toPx(b.z), done = this.found.has(b.id);
      g.fillStyle = done ? '#7cc36a' : '#e8893a';
      g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 6, y); g.lineTo(x, y + 8); g.lineTo(x - 6, y); g.closePath(); g.fill();
      g.strokeStyle = '#1c241f'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = 'rgba(20,25,22,0.8)'; g.fillText(b.name, x + 1, y - 11);
      g.fillStyle = '#f3ead7'; g.fillText(b.name, x, y - 12);
    }
    for (const m of mates) {
      if (m.help) { g.strokeStyle = '#e0563b'; g.lineWidth = 3; g.beginPath(); g.arc(toPx(m.x), toPx(m.z), 13, 0, TAU); g.stroke(); }
      g.fillStyle = m.color; g.beginPath(); g.arc(toPx(m.x), toPx(m.z), 6, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#fff'; g.fillText(m.help ? `${m.name}: needs a tow` : m.name, toPx(m.x), toPx(m.z) + 20);
    }
    g.save(); g.translate(toPx(here.x), toPx(here.z)); g.rotate(heading);
    g.fillStyle = '#f3ead7'; g.strokeStyle = '#1c241f'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    $('map-legend').textContent = `◆ survey beacons (${this.found.size}/${this.world.beacons.length} found) · trails dashed · M to close`;
  }

  // ---------------------------------------------------------------- messages
  toast(text, big = false, time = 4) {
    const d = document.createElement('div');
    d.className = 'toast' + (big ? ' big' : '');
    d.textContent = text;
    this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, time * 1000);
  }

  hint(text, time = 2.5) {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    this.hintT = time;
  }

  chat(name, text) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}` : `<i>${escapeHtml(text)}</i>`;
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity 1s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 1000); }, 20000);
  }

  update(dt) {
    this.t += dt;
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { BEACONS, BEACON_RADIUS };
