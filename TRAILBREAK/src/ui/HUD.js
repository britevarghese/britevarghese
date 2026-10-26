// The heads-up display: dials, drivetrain chips, winch, compass with beacons and friends, the next beacon, the
// players, a rotating minimap and the full map, toasts, hints and chat.
import { micIcon } from './VoicePanel.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
// (the open world's minimap close-up: LOCAL_STEP m a pixel, LOCAL_PX pixels across, drawn again once we are a quarter of
// the way to its edge)
const LOCAL_STEP = 1.6, LOCAL_PX = 360;
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Barlow, "Segoe UI", Arial, sans-serif';

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
    // the dial's type is drawn on a canvas, so fetch its faces now (and draw the face again once they are here)
    if (document.fonts?.load) {
      Promise.all([`italic 700 15px ${DISPLAY}`, `italic 800 64px ${DISPLAY}`, `italic 900 27px ${DISPLAY}`, `600 10px ${BODY}`, `700 13px ${BODY}`].map((f) => document.fonts.load(f)))
        .then(() => { this.dialKey = null; }).catch(() => {});
    }
  }

  show(on) { this.el.classList.toggle('hidden', !on); }

  /**
   * The open world as a picture (8 m a pixel): each map drawn on it as it comes in (drawRegion), and once they all are,
   * the land past them under them (drawFar).
   */
  buildWorldImage(tr) {
    const B = this.world.mapBox, S = Math.round(B.size / 8), c = document.createElement('canvas');
    c.width = S; c.height = S;
    this.mapTr = tr;
    this.mapImage = c;
    for (const r of this.world.regions) this.drawRegion(r);
    return c;
  }

  /**
   * One map of the open world onto its picture: its ground, then its woods, roads and tracks, and buildings. A few ms
   * at a time, between frames (it comes in while the game runs); resolves when it is drawn.
   */
  async drawRegion(region) {
    // (once its renderers are there: its colours are theirs)
    if ((this.drawn ||= new Set()).has(region.id) || (this.world.view && !this.world.view.viewOf(region.id))) return;
    this.drawn.add(region.id);
    let t0 = performance.now();
    const breathe = async () => { if (performance.now() - t0 > 6) { await new Promise((r) => setTimeout(r, 0)); t0 = performance.now(); } };
    const c = this.mapImage, x = c.getContext('2d'), B = this.world.mapBox, S = c.width, step = B.size / S, tr = this.mapTr, W = region.world;
    const i0 = Math.max(0, Math.round((region.cx - region.half - B.x0) / step)), i1 = Math.min(S, Math.round((region.cx + region.half - B.x0) / step));
    const k0 = Math.max(0, Math.round((region.cz - region.half - B.z0) / step)), k1 = Math.min(S, Math.round((region.cz + region.half - B.z0) / step));
    const img = x.createImageData(i1 - i0, k1 - k0), out = [0, 0, 0];
    for (let j = k0; j < k1; j++) {
      for (let i = i0; i < i1; i++) {
        const lx = B.x0 + (i + 0.5) * step - region.cx, lz = B.z0 + (j + 0.5) * step - region.cz;
        const h = W.terrain(lx, lz), nx = -(W.terrain(lx + step, lz) - W.terrain(lx - step, lz)) / (2 * step), nz = -(W.terrain(lx, lz + step) - W.terrain(lx, lz - step)) / (2 * step);
        tr.colorAt(lx + region.cx, lz + region.cz, step, h, Math.hypot(nx, nz), out);
        const shade = Math.max(0.35, Math.min(1.35, 0.92 + (nx * -0.6 + nz * -0.5) * 1.2));
        let r = Math.sqrt(out[0]) * shade, g = Math.sqrt(out[1]) * shade, b = Math.sqrt(out[2]) * shade;
        const wl = W.water(lx, lz);
        if (wl > -1e8 && h < wl) { r = 0.22; g = 0.42; b = 0.5; }
        const o = ((j - k0) * (i1 - i0) + (i - i0)) * 4;
        img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, g * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
      }
      await breathe();
    }
    x.putImageData(img, i0, k0);
    const px = (v) => (v - B.x0) / step, pz = (v) => (v - B.z0) / step, T = W.trees;
    x.fillStyle = 'rgba(42,66,32,0.5)';
    for (let s0 = 0, n = T.base ?? T.count; s0 < n; s0 += 2000) {
      x.beginPath();
      for (let t = s0; t < Math.min(n, s0 + 2000); t++) {
        const cx = px(T.x[t] + region.cx), cy = pz(T.z[t] + region.cz), r = Math.max(0.6, (T.h[t] * 0.16) / step);
        x.moveTo(cx + r, cy);
        x.arc(cx, cy, r, 0, 6.2832);
      }
      x.fill();
      await breathe();
    }
    for (const t of this.world.data.trails) {
      if (t.region !== region.id) continue;
      x.beginPath();
      t.points.forEach(([qx, qz], k) => (k ? x.lineTo(px(qx), pz(qz)) : x.moveTo(px(qx), pz(qz))));
      x.strokeStyle = t.kind === 'road' ? 'rgba(235,225,200,0.85)' : 'rgba(120,80,45,0.9)';
      x.lineWidth = t.kind === 'road' ? 1.6 : 1;
      x.setLineDash(t.kind === 'road' ? [] : [3, 2]);
      x.stroke();
    }
    x.setLineDash([]);
    x.fillStyle = '#3a2a1e';
    for (const L of this.world.landmarks) if (L.region === region.id) x.fillRect(px(L.x) - 1.5, pz(L.z) - 1.5, 3, 3);
    if (this.world.complete && this.drawn.size === this.world.regions.length) await this.drawFar();
  }

  /**
   * The land past the maps onto the open world's picture, under them, once they are all in (they shape it): its ground
   * and woods in the far land's own colours (render/WorldView.js), hill-shaded, and the sea; 32 m a pixel. Once: its
   * promise kept (farDrawn).
   */
  drawFar() { return (this.farDrawn ||= this.paintFar()); }

  async paintFar() {
    const W = this.world, B = W.mapBox, F = 32, S = Math.ceil(B.size / F), tr = this.mapTr, out = [0, 0, 0];
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const img = c.getContext('2d').createImageData(S, S), h0 = F / 2;
    let t0 = performance.now();
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = B.x0 + (i + 0.5) * F, z = B.z0 + (j + 0.5) * F;
        // (a pixel the maps cover all of is theirs)
        if (W.regionAt(x - h0, z - h0) && W.regionAt(x + h0, z - h0) && W.regionAt(x - h0, z + h0) && W.regionAt(x + h0, z + h0)) continue;
        const h = W.farHeight(x, z), nx = -(W.farHeight(x + F, z) - h) / F, nz = -(W.farHeight(x, z + F) - h) / F;
        tr.colorAt(x, z, F, h, Math.hypot(nx, nz), out);
        const shade = Math.max(0.35, Math.min(1.35, 0.92 + (nx * -0.6 + nz * -0.5) * 1.2));
        let r = Math.sqrt(out[0]) * shade, g = Math.sqrt(out[1]) * shade, b = Math.sqrt(out[2]) * shade;
        if (h < 0) { r = 0.22; g = 0.42; b = 0.5; }
        const o = (j * S + i) * 4;
        img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, g * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
      }
      if (performance.now() - t0 > 6) { await new Promise((res) => setTimeout(res, 0)); t0 = performance.now(); }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    const x = this.mapImage.getContext('2d'), k = F / (B.size / this.mapImage.width);
    x.save();
    x.globalCompositeOperation = 'destination-over';
    x.drawImage(c, 0, 0, S * k, S * k);
    x.restore();
  }

  /** The valley as a picture: ground colours with hill shading, water, trails, buildings. */
  buildMapImage(tr) {
    if (this.world.regions) return this.buildWorldImage(tr);
    // (2 m a pixel on a 2 km map; a big map's 4 m)
    const w = this.world, HALF = w.half, S = HALF > 1024 ? Math.round(HALF / 2) : 1024, c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d');
    const img = x.createImageData(S, S);
    const step = (2 * HALF) / S;
    const out = [0, 0, 0];
    // (each pixel's middle on a grid point, two cells a pixel: read off the grids, not sampled; else sampled)
    const N = w.N, H = w.H, k = step / w.res, m1 = tr.mips.find((m) => m.step === step);
    const exact = k === 2 && !!m1;
    const put = (i, j, h, nx, nz) => {
      const shade = Math.max(0.35, Math.min(1.35, 0.92 + (nx * -0.6 + nz * -0.5) * 1.2));
      let r = Math.sqrt(out[0]) * shade, g = Math.sqrt(out[1]) * shade, b = Math.sqrt(out[2]) * shade;
      const wl = w.water(-HALF + (i + 0.5) * step, -HALF + (j + 0.5) * step);
      if (wl > -1e8 && h < wl) { r = 0.22; g = 0.42; b = 0.5; }
      const o = (j * S + i) * 4;
      img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, g * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
    };
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        if (exact) {
          const gi = 2 * i + 1, gk = 2 * j + 1, o = gk * N + gi;
          const h = H[o], hx = H[gk * N + Math.min(N - 1, gi + 2)] - H[gk * N + gi - 1 - (gi > 1 ? 1 : 0)], hz = H[Math.min(N - 1, gk + 2) * N + gi] - H[(gk - 1 - (gk > 1 ? 1 : 0)) * N + gi];
          // the colour: the mean of the four 2-cell colour cells round the pixel's middle
          const mn = m1.n, d = m1.data, a = (j * mn + i) * 3;
          for (let q = 0; q < 3; q++) { const v = (d[a + q] + d[a + 3 + q] + d[a + mn * 3 + q] + d[a + mn * 3 + 3 + q]) / 4 / 255; out[q] = v * v; }
          put(i, j, h, -hx / (2 * step), -hz / (2 * step));
          continue;
        }
        const px = -HALF + (i + 0.5) * step, pz = -HALF + (j + 0.5) * step;
        const h = w.terrain(px, pz);
        const hx = w.terrain(px + step, pz) - w.terrain(px - step, pz), hz = w.terrain(px, pz + step) - w.terrain(px, pz - step);
        const nx = -hx / (2 * step), nz = -hz / (2 * step);
        tr.colorAt(px, pz, step, h, Math.hypot(nx, nz), out);
        put(i, j, h, nx, nz);
      }
    }
    x.putImageData(img, 0, 0);
    const toPx = (v) => (v + HALF) / (2 * HALF) * S;
    // the woods: each tree's crown (all in one path: a fill a tree took seconds on a big map)
    const T = w.trees;
    x.fillStyle = 'rgba(42,66,32,0.5)';
    x.beginPath();
    for (let t = 0; t < (T.base ?? T.count); t++) {
      const cx = toPx(T.x[t]), cy = toPx(T.z[t]), r = Math.max(0.9, (T.h[t] * 0.16) / step);
      x.moveTo(cx + r, cy);
      x.arc(cx, cy, r, 0, 6.2832);
    }
    x.fill();
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
  /**
   * One dial: the revs round the rim (an orange arc up to the needle, the redline in red), the speed big in the
   * middle, the gear at the bottom. Drawn in a 260 x 230 box at whatever size the canvas is shown, so it stays sharp.
   * An electric truck's rim shows the power instead (kW; green while it regenerates).
   */
  drawGauges(v) {
    const cv = this.gauges.canvas, g = this.gauges, cw = cv.clientWidth;
    if (!cw) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), bw = Math.round(cw * dpr), bh = Math.round(bw * 230 / 260);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const e = v.dt.e, ev = !!e.electric;
    const peakKw = ev ? (e._peakKw || (e._peakKw = e.torque.reduce((m, [r, t]) => Math.max(m, t * r * Math.PI / 30000), 1))) : 0;
    const max = ev ? Math.ceil(peakKw / 100) * 100 : Math.ceil(((e.limiter || e.redline + 300) + 200) / 1000) * 1000;
    const key = `${bw}|${max}|${ev ? 'ev' : e.redline}`;
    if (this.dialKey !== key) { this.dialKey = key; this.dialFace = dialFace(bw, bh, max, ev ? Infinity : e.redline, ev); }
    const k = bw / 260, cx = 130, cy = 120, R = 104, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, bw, bh);
    g.drawImage(this.dialFace, 0, 0);
    g.setTransform(k, 0, 0, k, 0, 0);
    const d = v.dt, kw = ev ? d.engineTorque * d.wEngine / 1000 : 0, regen = ev && kw < -1;
    const rpm = !d.running ? 0 : ev ? Math.abs(kw) : d.rpm, at = (r) => a0 + (a1 - a0) * Math.max(0, Math.min(1, r / max));
    const a = at(rpm), aRed = ev ? a1 + 1 : at(e.redline);
    // the revs: orange up to the redline, red past it
    g.lineCap = 'butt'; g.lineWidth = 8;
    if (a > a0 + 0.001) {
      g.strokeStyle = regen ? '#3ddc84' : this.dialGrad || (this.dialGrad = (() => { const gr = g.createLinearGradient(30, 0, 230, 0); gr.addColorStop(0, '#ff9a3d'); gr.addColorStop(1, '#f06a0f'); return gr; })());
      g.shadowColor = regen ? 'rgba(61,220,132,0.7)' : 'rgba(255,122,26,0.7)'; g.shadowBlur = 10 * k;
      g.beginPath(); g.arc(cx, cy, R - 12, a0, Math.min(a, aRed)); g.stroke();
      if (a > aRed) { g.strokeStyle = '#ff3b45'; g.shadowColor = 'rgba(255,59,69,0.8)'; g.beginPath(); g.arc(cx, cy, R - 12, aRed, a); g.stroke(); }
      g.shadowBlur = 0;
    }
    // the needle's tip, across the band and the ticks
    const ca = Math.cos(a), sa = Math.sin(a);
    g.strokeStyle = '#fff'; g.lineWidth = 3.5; g.lineCap = 'round';
    g.shadowColor = 'rgba(255,150,60,0.9)'; g.shadowBlur = 8 * k;
    g.beginPath(); g.moveTo(cx + ca * (R - 34), cy + sa * (R - 34)); g.lineTo(cx + ca * (R - 5), cy + sa * (R - 5)); g.stroke();
    g.shadowBlur = 0;
    // the speed
    const kmh = Math.round(Math.abs(v.speed) * 3.6);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = `italic 800 64px ${DISPLAY}`;
    g.fillText(String(kmh), cx - 2, cy + 4);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.font = `700 13px ${BODY}`;
    g.fillText('KM/H', cx, cy + 40);
    // the gear: D (and which) in the automatic, the number in the manual, R, N; OFF with the engine off
    const box = (text, small, hot) => {
      const w = 46, h = 34, x = cx - w / 2, y = cy + 64;
      g.fillStyle = hot ? 'rgba(255,122,26,0.16)' : 'rgba(255,255,255,0.06)';
      g.strokeStyle = hot ? 'rgba(255,140,50,0.9)' : 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
      roundRect(g, x, y, w, h, 8); g.fill(); g.stroke();
      g.fillStyle = hot ? '#fff' : 'rgba(255,255,255,0.55)';
      g.font = `italic 900 ${text.length > 1 ? 18 : 27}px ${DISPLAY}`;
      g.fillText(text, cx - (small ? 4 : 0), y + h / 2 + 1);
      if (small) { g.font = `italic 800 14px ${DISPLAY}`; g.fillStyle = 'rgba(255,190,130,0.95)'; g.fillText(small, cx + 11, y + 11); }
    };
    if (!d.running) box('OFF', '', false);
    else if (d.gear < 0) box('R', '', true);
    else if (d.gear === 0) box('N', '', false);
    else if (d.auto) box('D', d.t.gears.length > 1 ? String(d.gear) : '', true);
    else box(String(d.gear), '', true);
  }

  drawChips(v) {
    const d = v.dt;
    const set = (id, text, cls) => { const el = $(id); if (el.textContent !== text) el.textContent = text; el.className = 'chip' + (cls ? ' ' + cls : ''); };
    set('m-range', d.low ? 'LOW' : 'HIGH', d.low ? 'on' : '');
    // (no low range, or nothing to shift: an electric truck)
    $('m-range').classList.toggle('hidden', !(d.t.low > 1));
    // which wheels drive: part-time 4WD in or out (4LO in low range), or a road car's rear or all-wheel drive (its
    // centre diff locked: AWD LOCK)
    const dl = d.drive === 'rwd' ? 'RWD' : d.drive === 'awd' ? (d.lockCentre ? 'AWD LOCK' : 'AWD') : null;
    set('m-4wd', dl || (d.fourWD ? '4WD' : '2WD'), d.fourWD ? 'on' : '');
    const badge = $('m-drive'), bc = `drive-badge ${d.fourWD ? 'four' : 'two'}`, bt = dl ? dl.split(' ')[0] : d.fourWD ? (d.low ? '4LO' : '4WD') : '2WD';
    if (badge.className !== bc) badge.className = bc;
    if ($('m-drive-t').textContent !== bt) $('m-drive-t').textContent = bt;
    const lsd = d.diffs.rear === 'lsd', mld = d.diffs.rear === 'auto';
    set('m-lock', d.lockFront && d.lockRear ? 'LOCK F+R' : d.lockRear ? 'LOCK R' : mld ? (d.autoLock ? 'MLD LOCKED' : 'MLD') : lsd ? 'LSD' : 'DIFF OPEN', d.lockRear || d.autoLock ? 'on2' : '');
    set('m-box', d.auto ? 'AUTO' : 'MANUAL', d.auto ? '' : 'on2');
    $('m-box').classList.toggle('hidden', !!d.direct);
    const psi = Math.round(v.psiAir ?? v.psi), dir = v.psiTarget < psi - 0.4 ? ' ↓' : v.psiTarget > psi + 0.4 ? ' ↑' : '';
    set('m-psi', `${psi} PSI${dir}`, psi < 25 ? 'on2' : '');
    const eng = $('m-eng');
    eng.classList.toggle('hidden', d.running);
    if (!d.running) eng.textContent = d.crankT > 0 ? 'CRANKING' : v.flooded ? 'FLOODED' : 'ENGINE OFF';
    // afloat (the U8's float mode): the chip, and once each time it starts to float, what the keys do now
    $('m-float').classList.toggle('hidden', !v.afloat);
    if (v.afloat && !this.wasAfloat) this.hint('Afloat: float mode. W / S paddle ahead and astern, A / D turn on the spot', 5);
    this.wasAfloat = !!v.afloat;
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
  drawCompass(heading, here, mates, route) {
    // heading: radians, 0 = north (-z), clockwise
    const strip = this.strip, width = strip.parentElement.clientWidth, pxPerRad = width / 2.2;
    if (!width) return;
    if (this.scaleW !== width) {
      // the scale, built once per size: N E S W and the degrees every 15, a tick every 5, from -180 to 540 so it
      // never runs out as it slides
      this.scaleW = width;
      const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }, ppd = pxPerRad * Math.PI / 180;
      let html = '';
      for (let d = -180; d <= 540; d += 5) {
        const x = (d * ppd).toFixed(1), n = ((d % 360) + 360) % 360;
        html += `<span class="tick${d % 15 === 0 ? ' big' : ''}" style="left:${x}px"></span>`;
        if (d % 15 === 0) html += names[n] ? `<span class="${n === 0 ? 'north' : ''}" style="left:${x}px">${names[n]}</span>` : `<span class="deg" style="left:${x}px">${n}</span>`;
      }
      if (!this.scaleEl) { strip.innerHTML = '<div class="cs-scale"></div><div class="cs-marks"></div>'; this.scaleEl = strip.firstChild; this.marksEl = strip.lastChild; }
      this.scaleEl.innerHTML = html;
    }
    const hd = ((heading * 180 / Math.PI) % 360 + 360) % 360;
    this.scaleEl.style.transform = `translateX(${(width / 2 - hd * pxPerRad * Math.PI / 180).toFixed(1)}px)`;
    // what moves on it: beacons, friends, the next gate, the satnav's destination
    const marks = [];
    for (const b of this.world.beacons) {
      const a = Math.atan2(b.x - here.x, -(b.z - here.z));
      marks.push({ a, text: '◆', cls: 'bcn' + (this.found.has(b.id) ? ' done' : '') });
    }
    // (a friend: always on it, at its edge when off to the side or behind, with how far)
    for (const m of mates) {
      const far = Math.hypot(m.x - here.x, m.z - here.z), d = far < 1000 ? `${Math.round(far / 10) * 10} m` : `${(far / 1000).toFixed(1)} km`;
      marks.push({ a: Math.atan2(m.x - here.x, -(m.z - here.z)), text: `${m.help ? '!' : '●'} ${d}`, cls: m.help ? 'mate help' : 'mate', color: m.help ? null : m.color, pin: true });
    }
    const next = this.eventMarks?.next;
    if (next) marks.push({ a: Math.atan2(next.x - here.x, -(next.z - here.z)), text: '▼', cls: 'gate' });
    if (route) marks.push({ a: Math.atan2(route.target.x - here.x, -(route.target.z - here.z)), text: '⬤', cls: 'route' });
    let html = '';
    for (const m of marks) {
      let d = m.a - heading;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      let text = m.text;
      if (Math.abs(d) > 1.15) {
        if (!m.pin) continue;
        text = d > 0 ? `${text} ▶` : `◀ ${text}`;
        d = Math.sign(d) * 0.9;
      }
      const x = width / 2 + d * pxPerRad;
      html += `<span class="${m.cls}" style="left:${x.toFixed(1)}px${m.color ? `;color:${m.color}` : ''}">${text}</span>`;
    }
    if (html !== this.lastStrip) { this.marksEl.innerHTML = html; this.lastStrip = html; }
  }

  /**
   * Top right: the connection (online and the ping, or offline), the driver (name, level and how far to the next,
   * from what they have earned) and how many are in the room.
   */
  drawTopRight({ name, level, net, players }) {
    const set = (id, text) => { const el = $(id); if (el && el.textContent !== text) el.textContent = text; };
    set('p-name', name);
    if (level) {
      set('p-level', `Lv. ${level.level}`);
      const w = `${Math.round(level.progress * 100)}%`, xp = $('p-xp');
      if (xp.style.width !== w) xp.style.width = w;
      const tip = `Level ${level.level}: $${level.earned.toLocaleString('en-US')} earned, $${(level.next - level.earned).toLocaleString('en-US')} to level ${level.level + 1}`;
      const pr = $('profile');
      if (pr.title !== tip) pr.title = tip;
    }
    $('profile').querySelector('.xp').classList.toggle('hidden', !level);
    $('p-level').classList.toggle('hidden', !level);
    const pill = $('net-pill');
    pill.classList.remove('hidden');
    const on = !!net?.connected;
    pill.classList.toggle('off', !on);
    set('net-text', on ? 'Online' : net ? 'Reconnecting' : 'Offline');
    set('net-ping', on && net.ping > 0 ? `${Math.round(net.ping)} ms` : '');
    const count = $('p-count');
    count.classList.toggle('hidden', !net);
    if (net) set('p-count-n', `${players}/${net.maxPlayers || players}`);
  }

  drawObjective(here, route) {
    let best = null, bd = Infinity;
    for (const b of this.world.beacons) {
      if (this.found.has(b.id)) continue;
      const d = Math.hypot(b.x - here.x, b.z - here.z);
      if (d < bd) { bd = d; best = b; }
    }
    const el = $('objective');
    const n = this.found.size, total = this.world.beacons.length;
    const dist = (m) => (m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km');
    const text = route ? `<span class="route">➤</span> Route to <b>${escapeHtml(route.target.name)}</b> ${dist(route.left)}`
      : best ? `Beacons <b>${n}/${total}</b> · nearest: <b>${best.name}</b> ${dist(bd)}` : `All <b>${total}</b> beacons surveyed. The valley is mapped!`;
    if (el.innerHTML !== text) el.innerHTML = text;
  }

  /** The balance, with what just came in or went out floating under it. */
  money(balance, delta, why) {
    const el = document.getElementById('money');
    if (!el) return;
    const fmt = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
    el.innerHTML = `<span class="bal${balance < 0 ? ' red' : ''}"><i class="coin">$</i>${balance < 0 ? '-' : ''}${Math.abs(Math.round(balance)).toLocaleString('en-US')}</span>`;
    if (delta) {
      const d = document.createElement('span');
      d.className = `delta ${delta > 0 ? 'plus' : 'minus'}`;
      d.textContent = `${delta > 0 ? '+' : ''}${fmt(delta)}${why ? ` ${why}` : ''}`;
      el.appendChild(d);
    }
  }

  drawPlayers(list) {
    const html = list.map((p) => `<div>${escapeHtml(p.name)}${p.me ? ' (you)' : ''}${p.tag ? `<span class="tag">${escapeHtml(p.tag)}</span>` : ''}${p.help ? '<span class="help">needs a tow</span>' : ''}${p.voice ? `<span class="vic ${p.voice}">${micIcon(p.voice === 'muted')}</span>` : ''}<span class="dot" style="background:${p.color}"></span></div>`).join('');
    const el = $('players');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ---------------------------------------------------------------- maps
  drawMinimap(here, heading, mates, route, mode) {
    const g = this.mini, S = 220, scale = 1.25;                 // px per metre
    const img = this.mapImage, B = this.world.mapBox, k = img.width / B.size;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.clip();
    // (the land not on the picture yet: the open world's far land until every map is in)
    g.fillStyle = '#56603f'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(-heading);
    g.save();
    g.scale(scale / k, scale / k);
    g.drawImage(img, -(here.x - B.x0) * k, -(here.z - B.z0) * k);
    g.restore();
    // (and over it, round us, the land drawn finer)
    const L = this.world.regions ? this.localMap(here) : null;
    if (L) {
      g.save();
      g.scale(scale * L.step, scale * L.step);
      g.drawImage(L.canvas, -(here.x - L.x0) / L.step, -(here.z - L.z0) / L.step);
      g.restore();
    }
    g.scale(scale / k, scale / k);
    // the satnav's route
    if (route?.points?.length > 1) {
      g.beginPath();
      route.points.forEach(([x, z], i) => { const px = (x - here.x) * k, pz = (z - here.z) * k; if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 6.5 * k / scale; g.stroke();
      g.strokeStyle = '#3fb6ff'; g.lineWidth = 3.6 * k / scale; g.stroke();
    }
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
    // a party mode: the zone (and the circle it is closing to), the hill's ring
    if (mode?.zone && mode.zone.r > 0) {
      const z = mode.zone, n = z.next;
      const at = (x, zz) => { const dx = (x - here.x) * scale, dz = (zz - here.z) * scale, c = Math.cos(-heading), s = Math.sin(-heading); return [dx * c - dz * s, dx * s + dz * c]; };
      g.save(); g.beginPath(); g.arc(0, 0, S / 2 - 1, 0, TAU); g.clip();
      const [cx, cy] = at(z.x, z.z);
      g.strokeStyle = '#3fb6ff'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, z.r * scale, 0, TAU); g.stroke();
      if (n && n.r > 0 && (n.r < z.r - 1)) { const [nx, ny] = at(n.x, n.z); g.setLineDash([5, 4]); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(nx, ny, n.r * scale, 0, TAU); g.stroke(); g.setLineDash([]); }
      g.restore();
    }
    if (mode?.hill) put(mode.hill.x, mode.hill.z, (px, py, edge) => { g.strokeStyle = '#ffc04a'; g.lineWidth = 3; g.beginPath(); g.arc(px, py, edge ? 6 : Math.max(5, mode.hill.r * scale), 0, TAU); g.stroke(); });
    // event start lines (flags), and the next gate of a run
    for (const e of this.eventMarks?.starts || []) put(e.x, e.z, (px, py, edge) => { if (!edge) flag(g, px, py, 1); });
    const next = this.eventMarks?.next;
    if (next) put(next.x, next.z, (px, py) => { g.strokeStyle = '#ffb340'; g.lineWidth = 3; g.beginPath(); g.arc(px, py, 7, 0, TAU); g.stroke(); });
    for (const m of mates) put(m.x, m.z, (px, py) => {
      if (m.help) { g.strokeStyle = '#e0563b'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, 8 + 3 * Math.sin(performance.now() / 160), 0, TAU); g.stroke(); }
      g.fillStyle = m.color; g.beginPath(); g.arc(px, py, 4.5, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    });
    // the N on the rim, where north is as the map turns
    const nEl = this.mmN || (this.mmN = document.querySelector('#minimap-wrap .mm-n'));
    if (nEl) { const L = `${(50 - 50 * Math.sin(heading)).toFixed(2)}%`, T = `${(50 - 50 * Math.cos(heading)).toFixed(2)}%`; if (nEl.style.left !== L) { nEl.style.left = L; nEl.style.top = T; } }
    // us
    g.fillStyle = '#f3ead7'; g.strokeStyle = '#1c241f'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  /**
   * The open world's picture is 8 m a pixel, a blur at the minimap's metre and a quarter a pixel: round us, the land
   * drawn finer (LOCAL_STEP m a pixel), and again as we go on (the last shown till it's done; drawn a little each
   * frame, stepLocal).
   */
  localMap(here) {
    const L = this.local || (this.local = { ready: null, job: null });
    const R = L.ready, reach = LOCAL_PX * LOCAL_STEP * 0.25;
    if (!L.job && (!R || Math.abs(here.x - R.cx) > reach || Math.abs(here.z - R.cz) > reach)) L.job = this.paintLocal(Math.round(here.x), Math.round(here.z));
    return L.ready;
  }

  /** The minimap's close-up drawn on for a millisecond and a half (each frame). */
  stepLocal() {
    const L = this.local;
    if (!L?.job) return;
    const t = performance.now();
    while (performance.now() - t < 1.5) { const r = L.job.next(); if (r.done) { L.ready = r.value; L.job = null; break; } }
  }

  /** The close-up round (cx, cz): the maps' ground, hill-shaded, their water, tracks, woods and buildings (a generator,
   * a fifth of a row a step). */
  *paintLocal(cx, cz) {
    const S = LOCAL_PX, step = LOCAL_STEP, x0 = cx - S * step / 2, z0 = cz - S * step / 2, W = this.world, tr = this.mapTr;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d'), img = x.createImageData(S, S), out = [0, 0, 0];
    const base = (w, a, b) => (w.terrainBase ? w.terrainBase(a, b) : w.terrain(a, b));
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const px = x0 + (i + 0.5) * step, pz = z0 + (j + 0.5) * step, r = W.regionAt(px, pz);
        // (the far land past the maps left to the picture under it)
        if (!r) continue;
        const w = r.world, lx = px - r.cx, lz = pz - r.cz, hb = base(w, lx, lz);
        const h = w.terrain(lx, lz), nx = -(base(w, lx + step, lz) - hb) / step, nz = -(base(w, lx, lz + step) - hb) / step;
        tr.colorAt(px, pz, step, h, Math.hypot(nx, nz), out);
        const shade = Math.max(0.35, Math.min(1.35, 0.92 + (nx * -0.6 + nz * -0.5) * 1.2));
        let cr = Math.sqrt(out[0]) * shade, cg = Math.sqrt(out[1]) * shade, cb = Math.sqrt(out[2]) * shade;
        const wl = w.water(lx, lz);
        if (wl > -1e8 && h < wl) { cr = 0.22; cg = 0.42; cb = 0.5; }
        const o = (j * S + i) * 4;
        img.data[o] = Math.min(255, cr * 255); img.data[o + 1] = Math.min(255, cg * 255); img.data[o + 2] = Math.min(255, cb * 255); img.data[o + 3] = 255;
        if (i % 72 === 71) yield;
      }
    }
    x.putImageData(img, 0, 0);
    const px = (v) => (v - x0) / step, pz = (v) => (v - z0) / step, x1 = x0 + S * step, z1 = z0 + S * step;
    // the woods, crown by crown
    x.fillStyle = 'rgba(42,66,32,0.55)';
    for (const r of W.regions) {
      if (r.cx + r.half < x0 || r.cx - r.half > x1 || r.cz + r.half < z0 || r.cz - r.half > z1) continue;
      const T = r.world.trees;
      x.beginPath();
      for (let n = 0, m = T.base ?? T.count; n < m; n++) {
        if ((n & 8191) === 8191) yield;              // (a big map has hundreds of thousands)
        const tx = T.x[n] + r.cx, tz = T.z[n] + r.cz;
        if (tx < x0 || tx > x1 || tz < z0 || tz > z1) continue;
        const cr = Math.max(0.8, (T.h[n] * 0.16) / step);
        x.moveTo(px(tx) + cr, pz(tz)); x.arc(px(tx), pz(tz), cr, 0, TAU);
      }
      x.fill();
      yield;
    }
    // the roads and tracks, as wide as they are
    for (const t of W.data.trails) {
      if (!t.points.some(([qx, qz]) => qx > x0 - 50 && qx < x1 + 50 && qz > z0 - 50 && qz < z1 + 50)) continue;
      x.beginPath();
      t.points.forEach(([qx, qz], n) => (n ? x.lineTo(px(qx), pz(qz)) : x.moveTo(px(qx), pz(qz))));
      x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = t.kind === 'road' ? 'rgba(235,225,200,0.9)' : 'rgba(120,80,45,0.95)';
      x.lineWidth = Math.max(1.5, (t.width ?? 3) / step * (t.kind === 'road' ? 1 : 0.8));
      x.setLineDash(t.kind === 'road' ? [] : [6, 3]);
      x.stroke();
      yield;
    }
    x.setLineDash([]);
    x.fillStyle = '#3a2a1e';
    for (const L of W.landmarks) if (L.x > x0 && L.x < x1 && L.z > z0 && L.z < z1) x.fillRect(px(L.x) - 4, pz(L.z) - 4, 8, 8);
    return { canvas: c, cx, cz, x0, z0, step };
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

  clearHint() { this.hintEl.classList.remove('show'); this.hintT = 0; }

  chat(name, text, color) {
    const d = document.createElement('div');
    d.innerHTML = name ? `<b${color ? ` style="color:${color}"` : ''}>${escapeHtml(name)}:</b> ${escapeHtml(text)}` : `<i>${escapeHtml(text)}</i>`;
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity 1s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 1000); }, 20000);
  }

  update(dt) {
    this.t += dt;
    this.stepLocal();
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintEl.classList.remove('show'); }
  }
}

/** The dial's face (the disc, the band, the ticks and numbers, the redline) for a dial w x h pixels, revs to max
 *  (an electric truck's: kilowatts to max, no redline). */
function dialFace(w, h, max, redline, ev = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), k = w / 260, cx = 130, cy = 120, R = 104, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.setTransform(k, 0, 0, k, 0, 0);
  const at = (r) => a0 + (a1 - a0) * r / max;
  const bg = g.createRadialGradient(cx, cy - 30, 8, cx, cy, R);
  bg.addColorStop(0, 'rgba(30,37,47,0.92)'); bg.addColorStop(1, 'rgba(8,11,15,0.9)');
  g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5; g.stroke();
  // the band the revs fill, and the red past the redline
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(cx, cy, R - 12, a0, a1); g.stroke();
  if (Number.isFinite(redline)) { g.strokeStyle = 'rgba(239,59,69,0.45)'; g.beginPath(); g.arc(cx, cy, R - 12, at(redline), a1); g.stroke(); }
  // ticks every 250 rpm (every 1000 long, with the number); electric: every 25 kW (every 100 long)
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const unit = ev ? 100 : 1000, stepT = unit / 4;
  for (let r = 0; r <= max + 1; r += stepT) {
    const a = at(r), big = r % unit === 0, half = r % (unit / 2) === 0, ca = Math.cos(a), sa = Math.sin(a), red = r >= redline;
    const r0 = R - 21, r1 = R - (big ? 31 : half ? 27 : 25);
    g.strokeStyle = red ? 'rgba(255,90,90,0.95)' : big ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)';
    g.lineWidth = big ? 2.5 : 1.3; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(cx + ca * r0, cy + sa * r0); g.lineTo(cx + ca * r1, cy + sa * r1); g.stroke();
    if (big) {
      g.fillStyle = red ? '#ff6a6a' : 'rgba(255,255,255,0.85)';
      g.font = `italic 700 15px ${DISPLAY}`;
      g.fillText(String(r / unit), cx + ca * (R - 43), cy + sa * (R - 43));
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = `600 10px ${BODY}`;
  g.fillText(ev ? 'kW x100' : 'RPM x1000', cx, cy - 38);
  return c;
}

/** A rounded rectangle path (ctx.roundRect is missing from older Safari). */
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A little chequered flag on a pole at (x, y) (the event start lines on the maps). */
function flag(g, x, y, k) {
  g.save(); g.translate(x, y); g.scale(k, k);
  g.strokeStyle = '#1c241f'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-3, 6); g.lineTo(-3, -8); g.stroke();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#1c241f' : '#f3ead7'; g.fillRect(-3 + i * 3, -8 + j * 3, 3, 3); }
  g.restore();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

