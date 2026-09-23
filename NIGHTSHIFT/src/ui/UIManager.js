// UIManager: main menu, pause, settings, world map, event briefing, results, toasts and the
// F3 developer overlay. Keyboard, mouse and gamepad navigation for every menu.
import { bus } from '../core/EventBus.js';
import { QUALITY_LEVELS, QUALITY_LABELS } from '../core/QualityManager.js';
import { formatMoney, formatTime } from '../core/util.js';
import { RACE_TYPE_NAMES } from '../races/RaceEvents.js';
import { SAFEHOUSES, SHOPS } from '../world/CityLayout.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class UIManager {
  constructor(game) {
    this.game = game;
    this.screens = document.getElementById('screens');
    this.toasts = document.getElementById('toasts');
    this.dev = document.getElementById('dev');
    this.current = null;
    this.focusList = []; this.focusIdx = 0;
    bus.on('toast', (t) => this.toast(t.text, t.type, t.time));
  }

  toast(text, type = '', time = 3) {
    const e = h('div', 'toast ' + type, text);
    this.toasts.appendChild(e);
    setTimeout(() => { e.classList.add('out'); setTimeout(() => e.remove(), 450); }, time * 1000);
    while (this.toasts.children.length > 5) this.toasts.firstChild.remove();
  }

  clear() { this.screens.innerHTML = ''; this.current = null; this.focusList = []; }

  _menuNav(items, onBack) {
    this.focusList = items; this.focusIdx = 0; this.onBack = onBack;
    items.forEach((b, i) => {
      b.addEventListener('mouseenter', () => { this.focusIdx = i; this._focus(); this.game.audio?.playEvent('uiHover'); });
      b.addEventListener('click', () => this.game.audio?.playEvent('uiClick'));
    });
    this._focus();
  }
  _focus() { this.focusList.forEach((b, i) => b.classList.toggle('sel', i === this.focusIdx)); }

  // called each frame with the input manager while a menu is open
  navigate(input) {
    if (!this.focusList.length) { if (input.consume('back') && this.onBack) this.onBack(); return; }
    if (input.consume('up')) { this.focusIdx = (this.focusIdx + this.focusList.length - 1) % this.focusList.length; this._focus(); this.game.audio?.playEvent('uiHover'); }
    if (input.consume('down')) { this.focusIdx = (this.focusIdx + 1) % this.focusList.length; this._focus(); this.game.audio?.playEvent('uiHover'); }
    if (input.consume('confirm')) this.focusList[this.focusIdx]?.click();
    if (input.consume('back') && this.onBack) { this.game.audio?.playEvent('uiBack'); this.onBack(); }
  }

  // ------------------------------------------------------------------ main menu
  showMainMenu() {
    this.clear();
    const g = this.game;
    const s = h('div', 'screen menu-main');
    s.innerHTML = `<div class="logo"><span class="logo-night">NIGHT</span><span class="logo-shift">SHIFT</span></div><div class="tag">PORT HALVERN · AFTER DARK</div>`;
    const list = h('div', 'menu-list');
    const items = [
      ['PLAY', 'Free roam the city — races, pursuits, cash', () => g.play()],
      ['GARAGE', 'Cars, paint, parts & performance', () => g.openGarage()],
      ['MAP', 'City map, events and safehouses', () => this.showMap(true)],
      ['SETTINGS', 'Graphics, gameplay, audio', () => this.showSettings(() => this.showMainMenu())],
      ['EXIT', 'Leave NIGHTSHIFT', () => this.showExit()],
    ];
    const btns = items.map(([t, sub, fn]) => { const b = h('button', 'menu-item', `${t}<small>${sub}</small>`); b.onclick = fn; list.appendChild(b); return b; });
    s.appendChild(list);
    const d = g.save.data;
    s.appendChild(h('div', 'menu-stats', `<div class="v">${formatMoney(d.cash)}</div><div class="l">CASH</div><div class="v" style="margin-top:.8rem">${d.reputation}</div><div class="l">REPUTATION</div><div class="v" style="margin-top:.8rem">${d.raceWins}</div><div class="l">RACE WINS</div>`));
    s.appendChild(h('div', 'menu-foot', `${g.rm.backend.toUpperCase()} · ${QUALITY_LABELS[g.quality.level]} · W/S throttle-brake · A/D steer · SPACE handbrake · SHIFT nitrous · V camera · M map · ESC pause`));
    this.screens.appendChild(s);
    this.current = 'menu';
    this._menuNav(btns, null);
  }

  showExit() {
    this.clear();
    const s = h('div', 'screen center dim-bg');
    const box = h('div', 'panel pause-box', '<h1>EXIT</h1><p style="color:var(--dim);line-height:1.5">Progress and settings are saved automatically.<br>You can close this browser tab now.</p>');
    const back = h('button', 'menu-item', 'BACK');
    back.onclick = () => this.showMainMenu();
    const full = h('button', 'menu-item', 'EXIT FULLSCREEN');
    full.onclick = () => { document.exitFullscreen?.().catch(() => {}); this.showMainMenu(); };
    box.append(back, full);
    s.appendChild(box);
    this.screens.appendChild(s);
    this.game.save.save();
    this.current = 'exit';
    this._menuNav([back, full], () => this.showMainMenu());
  }

  // ------------------------------------------------------------------ pause
  showPause() {
    this.clear();
    const g = this.game;
    const s = h('div', 'screen center dim-bg');
    const box = h('div', 'panel pause-box', '<h1>PAUSED</h1>');
    const items = [
      ['RESUME', () => g.resume()],
      ['MAP', () => this.showMap(false)],
      ['SETTINGS', () => this.showSettings(() => this.showPause())],
      ['RESET CAR', () => { g.resetPlayer(); g.resume(); }],
    ];
    if (g.races.active) items.push(['QUIT EVENT', () => { g.races.abort(); g.resume(); }]);
    items.push(['TOGGLE FULLSCREEN', () => g.toggleFullscreen()]);
    items.push(['MAIN MENU', () => g.toMainMenu()]);
    const btns = items.map(([t, fn]) => { const b = h('button', 'menu-item', t); b.onclick = fn; box.appendChild(b); return b; });
    box.appendChild(h('div', 'hint', 'ESC resume · physics, traffic and police are frozen while paused'));
    s.appendChild(box);
    this.screens.appendChild(s);
    this.current = 'pause';
    this._menuNav(btns, () => g.resume());
  }

  // ------------------------------------------------------------------ settings
  showSettings(onBack) {
    this.clear();
    const g = this.game;
    const S = g.settings;
    const s = h('div', 'screen center dim-bg');
    const box = h('div', 'panel settings');
    box.appendChild(h('h1', '', 'SETTINGS'));
    const tabs = h('div', 'tabs');
    const body = h('div', 'set-body');
    const tabNames = ['GRAPHICS', 'GAMEPLAY', 'AUDIO', 'CONTROLS'];
    let tab = this._settingsTab || 0;
    const opt = (label, desc, section, key, values, labels, after) => {
      const row = h('div', 'row');
      row.appendChild(h('div', '', `<label>${label}</label>${desc ? `<div class="desc">${desc}</div>` : ''}`));
      const o = h('div', 'opt');
      values.forEach((v, i) => {
        const b = h('button', S.data[section][key] === v ? 'on' : '', labels ? labels[i] : String(v).toUpperCase());
        b.onclick = () => { S.set(section, key, v); after?.(v); render(); };
        o.appendChild(b);
      });
      row.appendChild(o);
      body.appendChild(row);
    };
    const slider = (label, section, key, min, max, step, after) => {
      const row = h('div', 'row');
      row.appendChild(h('label', '', label));
      const inp = h('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = S.data[section][key];
      inp.oninput = () => { S.set(section, key, +inp.value); after?.(+inp.value); };
      row.appendChild(inp);
      body.appendChild(row);
    };
    const render = () => {
      tabs.innerHTML = ''; body.innerHTML = '';
      tabNames.forEach((n, i) => { const b = h('button', 'tab' + (i === tab ? ' on' : ''), n); b.onclick = () => { tab = i; this._settingsTab = i; render(); }; tabs.appendChild(b); });
      const apply = () => g.applyGraphicsSettings();
      if (tab === 0) {
        const det = S.graphics.detectedQuality ? ` (detected: ${QUALITY_LABELS[S.graphics.detectedQuality]})` : '';
        opt('Quality preset', 'Auto picks a level from a hardware benchmark' + det, 'graphics', 'quality', ['auto', ...QUALITY_LEVELS], ['AUTO', ...QUALITY_LEVELS.map((l) => QUALITY_LABELS[l])], apply);
        slider('Resolution scale', 'graphics', 'resolutionScale', 0.5, 1, 0.05, apply);
        opt('Textures', 'Texture resolution (applies after reload)', 'graphics', 'textures', ['auto', '256', '512', '1024', '2048'], ['AUTO', '256', '512', '1024', '2048']);
        opt('Shadows', '', 'graphics', 'shadows', ['auto', 'off', 'low', 'high'], null, apply);
        opt('Reflections', 'Wet-road and paint reflections', 'graphics', 'reflections', ['auto', 'off', 'on'], null, apply);
        opt('Post processing', 'Bloom, speed blur, vignette', 'graphics', 'postProcessing', ['auto', 'off', 'low', 'high'], null, apply);
        opt('Anti aliasing', 'MSAA applies after reload', 'graphics', 'antialias', ['auto', 'off', 'fxaa', 'msaa'], null, apply);
        opt('View distance', '', 'graphics', 'viewDistance', ['auto', 'low', 'medium', 'high', 'ultra'], null, apply);
        opt('Traffic density', '', 'graphics', 'trafficDensity', ['auto', 'low', 'medium', 'high'], null, apply);
        opt('Particles', '', 'graphics', 'particles', ['auto', 'low', 'medium', 'high'], null, apply);
        opt('Weather', 'Auto = dynamic weather', 'graphics', 'weather', ['auto', 'clear', 'cloudy', 'rain'], null, () => g.applyWeather());
        opt('Time of day', '', 'graphics', 'timeOfDay', ['morning', 'day', 'evening', 'night', 'cycle'], null, () => g.applyTime());
        opt('Motion blur', '', 'graphics', 'motionBlur', [true, false], ['ON', 'OFF'], apply);
        opt('Renderer', `Current: ${g.rm.backend.toUpperCase()} (applies after reload)`, 'graphics', 'backend', ['auto', 'webgl2', 'webgpu'], ['AUTO', 'WEBGL2', 'WEBGPU']);
        opt('FPS counter', 'F3 shows full developer stats', 'graphics', 'showFps', [true, false], ['ON', 'OFF']);
      } else if (tab === 1) {
        slider('Camera sensitivity', 'gameplay', 'cameraSensitivity', 0.2, 2, 0.05);
        slider('Steering sensitivity', 'gameplay', 'steeringSensitivity', 0.4, 1.8, 0.05);
        opt('Controller vibration', '', 'gameplay', 'vibration', [true, false], ['ON', 'OFF']);
        opt('Units', '', 'gameplay', 'units', ['kmh', 'mph'], ['KM/H', 'MPH']);
        opt('Default camera', '', 'gameplay', 'defaultCamera', [0, 1, 2, 3, 4, 5], ['CLOSE', 'CHASE', 'FAR', 'BUMPER', 'HOOD', 'COCKPIT']);
      } else if (tab === 2) {
        for (const [k, l] of [['master', 'Master'], ['engine', 'Engine'], ['traffic', 'Traffic'], ['police', 'Police'], ['music', 'Music'], ['environment', 'Environment']]) slider(l, 'audio', k, 0, 1, 0.01, () => g.audio?.applySettings(S.audio));
      } else {
        body.innerHTML = `<div class="row"><label>Throttle / Brake-Reverse</label><div>W / S · RT / LT</div></div>
          <div class="row"><label>Steer</label><div>A / D · Left stick</div></div>
          <div class="row"><label>Handbrake (drift)</label><div>SPACE · A</div></div>
          <div class="row"><label>Nitrous</label><div>SHIFT · RB</div></div>
          <div class="row"><label>Camera</label><div>V · Y</div></div>
          <div class="row"><label>Look around / look back</label><div>Right mouse drag · C · Right stick / X</div></div>
          <div class="row"><label>Map</label><div>M · View</div></div>
          <div class="row"><label>Start event / enter garage</label><div>E · A (when stopped in a marker)</div></div>
          <div class="row"><label>Reset car</label><div>R · LB</div></div>
          <div class="row"><label>Horn</label><div>H · R3</div></div>
          <div class="row"><label>Pause</label><div>ESC · Start</div></div>
          <div class="row"><label>Developer stats</label><div>F3</div></div>
          <div class="row"><label>Fullscreen</label><div>F11</div></div>`;
      }
    };
    render();
    box.append(tabs, body);
    const foot = h('div', 'set-foot');
    const reset = h('button', 'btn', 'RESET DEFAULTS'); reset.onclick = () => { S.reset(); g.applyGraphicsSettings(); render(); };
    const back = h('button', 'btn primary', 'BACK'); back.onclick = () => onBack();
    foot.append(reset, back);
    box.appendChild(foot);
    s.appendChild(box);
    this.screens.appendChild(s);
    this.current = 'settings';
    this.focusList = []; this.onBack = onBack;
  }

  // ------------------------------------------------------------------ world map
  showMap(fromMenu) {
    this.clear();
    const g = this.game;
    const s = h('div', 'screen map-screen');
    const canvas = h('canvas'); canvas.id = 'worldmap';
    const legend = h('div', 'map-legend panel', '<h2>PORT HALVERN</h2>');
    legend.style.padding = '1.4rem';
    legend.innerHTML += `<div><span class="dot" style="background:#fff"></span>You</div><div><span class="dot" style="background:#ffc53d"></span>Race events</div><div><span class="dot" style="background:#3d7bff"></span>Police escape</div><div><span class="dot" style="background:#3dff9a"></span>Safehouses</div><div><span class="dot" style="background:#ff9a3d"></span>Shops</div><div><span class="dot" style="background:#ff3040"></span>Police</div>`;
    const list = h('div', 'map-events');
    for (const ev of g.races.events) {
      const d = h('div', '', `<b>${ev.def.name}</b> <span style="color:var(--dim)">${RACE_TYPE_NAMES[ev.def.type]}</span> <span style="color:var(--ok)">${formatMoney(ev.def.reward)}</span>`);
      d.onclick = () => { g.setGPS(ev.start.x, ev.start.z); this.toast(`GPS set: ${ev.def.name}`); };
      list.appendChild(d);
    }
    legend.appendChild(list);
    legend.appendChild(h('div', 'hint', 'Click an event to set GPS · M / ESC to close'));
    s.append(canvas, legend);
    this.screens.appendChild(s);
    this.current = 'map';
    const draw = () => {
      if (this.current !== 'map') return;
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, devicePixelRatio);
      if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
      const c = canvas.getContext('2d');
      const M = g.mapRenderer;
      const k = canvas.width / M.size;
      c.clearRect(0, 0, canvas.width, canvas.height);
      c.drawImage(M.canvas, 0, 0, canvas.width, canvas.height);
      const P = (x, z) => [M.px(x) * k, M.pz(z) * k];
      const dot = (x, z, r, col, label) => {
        const [a, b] = P(x, z); c.fillStyle = col; c.beginPath(); c.arc(a, b, r * dpr, 0, 7); c.fill();
        if (label) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.font = `${11 * dpr}px Segoe UI, Arial`; c.fillText(label, a + 8 * dpr, b + 4 * dpr); }
      };
      if (g.gps?.route) { c.strokeStyle = 'rgba(55,226,255,0.9)'; c.lineWidth = 3 * dpr; c.beginPath(); g.gps.route.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? c.lineTo(a, b) : c.moveTo(a, b); }); c.stroke(); }
      for (const ev of g.races.events) dot(ev.start.x, ev.start.z, 6, ev.def.type === 'escape' ? '#3d7bff' : '#ffc53d', ev.def.name);
      for (const sh of SAFEHOUSES) dot(sh.x, sh.z, 6, '#3dff9a', sh.name);
      for (const sh of SHOPS) dot(sh.x, sh.z, 5, '#ff9a3d', sh.name);
      for (const u of g.police.units) dot(u.vehicle.state.x, u.vehicle.state.z, 4, '#ff3040');
      const ps = g.player.state;
      const [px, pz] = P(ps.x, ps.z);
      c.save(); c.translate(px, pz); c.rotate(ps.yaw); c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(0, -10 * dpr); c.lineTo(7 * dpr, 8 * dpr); c.lineTo(0, 4 * dpr); c.lineTo(-7 * dpr, 8 * dpr); c.closePath(); c.fill(); c.restore();
      // district labels
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.font = `600 ${13 * dpr}px Segoe UI, Arial`; c.textAlign = 'center';
      for (const [n, x, z] of [['DOWNTOWN', 0, 0], ['MARKET DISTRICT', -560, -320], ['IRONWORKS', 820, 400], ['DOCKSIDE', 820, -560], ['ELM HEIGHTS', -800, 700], ['RIVERSIDE', 560, 820], ['RING HIGHWAY', 0, 1250]]) { const [a, b] = P(x, z); c.fillText(n, a, b); }
      c.textAlign = 'start';
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const M = g.mapRenderer;
      const mx = (e.clientX - r.left) / r.width * M.size, mz = (e.clientY - r.top) / r.height * M.size;
      const x = mx / 0.6 - 1400, z = 1400 - mz / 0.6;
      g.setGPS(x, z);
    });
    this.focusList = [];
    this.onBack = () => (fromMenu ? this.showMainMenu() : g.closeMap());
  }

  // ------------------------------------------------------------------ event briefing / results
  showBriefing(ev) {
    this.clear();
    const g = this.game;
    const d = ev.def;
    const s = h('div', 'screen center dim-bg');
    const best = g.save.data.racesCompleted[d.id];
    const box = h('div', 'panel brief', `<div class="type">${RACE_TYPE_NAMES[d.type]}</div><h1>${d.name}</h1><p>${d.desc}</p>
      <div>${d.opponents ? `Opponents: ${d.opponents}<br>` : ''}${d.laps ? `Laps: ${d.laps}<br>` : ''}${d.timeLimit ? `Time limit: ${d.timeLimit}s<br>` : ''}${d.target ? `Target: ${d.type === 'speedrun' ? d.target + ' km/h total' : d.target + ' s'}<br>` : ''}Reward: <span class="reward">${formatMoney(d.reward)}</span> · REP +${d.rep}${best ? `<br>Best: ${formatTime(best)}` : ''}</div>`);
    const row = h('div', 'row2');
    const go = h('button', 'btn primary', 'START EVENT'); go.onclick = () => g.startEvent(ev);
    const back = h('button', 'btn', 'CANCEL'); back.onclick = () => g.resume();
    row.append(go, back);
    box.appendChild(row);
    s.appendChild(box);
    this.screens.appendChild(s);
    this.current = 'brief';
    this._menuNav([go, back], () => g.resume());
  }

  showResults(r) {
    this.clear();
    const g = this.game;
    const s = h('div', 'screen center');
    const title = r.failed ? 'FAILED' : r.win ? (r.def.type === 'sprint' || r.def.type === 'circuit' ? '1ST PLACE' : 'COMPLETE') : r.position ? `${r.position}${['', 'ST', 'ND', 'RD'][r.position] || 'TH'} PLACE` : 'FINISHED';
    const box = h('div', 'panel brief', `<div class="type">${r.typeName}</div><h1>${title}</h1><p>${r.def.name}<br>${r.detail || ''}</p>
      <div>Time: ${formatTime(r.time)}<br>Cash: <span class="reward">+${formatMoney(r.reward)}</span><br>Reputation: +${r.rep}</div>`);
    const ok = h('button', 'btn primary', 'CONTINUE'); ok.onclick = () => g.resume();
    const row = h('div', 'row2'); row.appendChild(ok); box.appendChild(row);
    s.appendChild(box);
    this.screens.appendChild(s);
    this.current = 'results';
    this._menuNav([ok], () => g.resume());
  }

  // ------------------------------------------------------------------ dev overlay
  updateDev(stats, show) {
    this.dev.classList.toggle('hidden', !show);
    if (!show) return;
    this.dev.textContent = stats;
  }
}
