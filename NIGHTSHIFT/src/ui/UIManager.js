// UIManager: main menu, pause, settings, world map, event briefing, results, toasts and the
// F3 developer overlay. Keyboard, mouse and gamepad navigation for every menu.
import { bus } from '../core/EventBus.js';
import { QUALITY_LEVELS, QUALITY_LABELS } from '../core/QualityManager.js';
import { formatMoney, formatTime } from '../core/util.js';
import { RACE_TYPE_NAMES } from '../races/RaceEvents.js';
import { SAFEHOUSES, SHOPS } from '../world/CityLayout.js';
import { CHAPTERS, MISSIONS } from '../progression/Missions.js';
import { CARS } from '../vehicles/VehicleCatalog.js';
import { FILTERS } from '../camera/PhotoMode.js';
import { REPLAY_CAMS } from '../replay/Replay.js';

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
      ['CAREER', 'Driver level, missions and car unlocks', () => this.showCareer(() => this.showMainMenu())],
      ['GARAGE', 'Cars, paint, parts & performance', () => g.openGarage()],
      ['MAP', 'City map, events and safehouses', () => this.showMap(true)],
      ['SETTINGS', 'Graphics, gameplay, audio', () => this.showSettings(() => this.showMainMenu())],
      ['EXIT', 'Leave NIGHTSHIFT', () => this.showExit()],
    ];
    const btns = items.map(([t, sub, fn]) => { const b = h('button', 'menu-item', `${t}<small>${sub}</small>`); b.onclick = fn; list.appendChild(b); return b; });
    s.appendChild(list);
    const d = g.save.data;
    const L = g.progress?.info || { level: 1, into: 0, need: 1 };
    s.appendChild(h('div', 'menu-stats', `<div class="v">${formatMoney(d.cash)}</div><div class="l">CASH</div><div class="v" style="margin-top:.8rem">${L.level}</div><div class="l">DRIVER LEVEL</div><div class="xpline"><i style="width:${L.need ? Math.round(L.into / L.need * 100) : 100}%"></i></div><div class="v" style="margin-top:.8rem">${d.raceWins}</div><div class="l">RACE WINS</div>`));
    s.appendChild(h('div', 'menu-foot', `${g.rm.backend.toUpperCase()} · ${QUALITY_LABELS[g.quality.level]} · W/S throttle-brake · A/D steer · SPACE handbrake · SHIFT nitrous · V camera · F get in/out · M map · I replay · F2 photo · ESC pause`));
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
      ['PHOTO MODE', () => g.photo.enter()],
      ['INSTANT REPLAY', () => { if (!g.replay.enter()) this.showPause(); }],
      ['CAREER', () => this.showCareer(() => this.showPause())],
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

  // ------------------------------------------------------------------ story
  showStoryFail(m, reason) {
    this.clear();
    const g = this.game;
    g.state.mode = 'results'; g.audio.setPaused(true);
    const s = h('div', 'screen center dim-bg');
    const box = h('div', 'panel brief', `<div class="type">STORY · ${m.title.toUpperCase()}</div><h1 style="color:#ff3d5a">MISSION FAILED</h1><p>${reason}</p>`);
    const row = h('div', 'row2');
    const retry = h('button', 'btn primary', 'RETRY'); retry.onclick = () => { this.clear(); g.state.mode = 'drive'; g.audio.setPaused(false); document.getElementById('hud').classList.remove('hidden'); g.story.retry(m); };
    const quit = h('button', 'btn', 'CONTINUE'); quit.onclick = () => g.resume();
    row.append(retry, quit); box.appendChild(row);
    s.appendChild(box); this.screens.appendChild(s);
    this.current = 'results';
    this._menuNav([retry, quit], () => g.resume());
  }

  // ------------------------------------------------------------------ photo mode
  showPhoto(pm) {
    this.clear();
    const o = pm.opts;
    const s = h('div', 'photo-ui');
    const panel = h('div', 'panel photo-panel', '<h2>PHOTO MODE</h2>');
    const row = (label, key, min, max, step, fmt, onInput) => {
      const r = h('div', 'photo-row');
      const val = h('span', 'photo-val', fmt(o[key]));
      const inp = h('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = o[key];
      inp.oninput = () => { o[key] = +inp.value; val.textContent = fmt(o[key]); onInput?.(o[key]); };
      r.append(h('label', '', label), val, inp);
      panel.appendChild(r);
    };
    row('LENS', 'fov', 15, 100, 1, (v) => `${Math.round(18 / Math.tan((v * Math.PI) / 360))} mm`);
    row('EXPOSURE', 'ev', -2, 2, 0.1, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} EV`);
    row('ROLL', 'roll', -30, 30, 1, (v) => `${v}°`);
    row('MOTION BLUR', 'blur', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    row('VIGNETTE', 'vignette', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    row('TIME', 'hour', 0, 23.9, 0.1, (v) => `${String(Math.floor(v)).padStart(2, '0')}:${String(Math.floor((v % 1) * 60)).padStart(2, '0')}`, (v) => pm.setHour(v));
    const fl = h('div', 'photo-filters');
    for (const [id, f] of Object.entries(FILTERS)) {
      const b = h('button', 'photo-filter' + (o.filter === id ? ' on' : ''), f.label);
      b.onclick = () => { o.filter = id; fl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); b.blur(); };
      fl.appendChild(b);
    }
    panel.appendChild(fl);
    const shot = h('button', 'menu-item photo-shot', 'SAVE PHOTO');
    shot.onclick = () => { pm.capture(); shot.blur(); };
    const back = h('button', 'menu-item', 'EXIT');
    back.onclick = () => pm.exit();
    panel.append(shot, back);
    panel.appendChild(h('div', 'hint', 'DRAG orbit · RIGHT-DRAG pan · WHEEL zoom · WASD/QE move · ENTER save · H hide · ESC exit'));
    s.appendChild(panel);
    s.appendChild(h('div', 'photo-flash'));
    this.screens.appendChild(s);
    this.current = 'photo';
  }
  // ------------------------------------------------------------------ instant replay
  showReplay(r) {
    this.clear();
    const s = h('div', 'replay-ui');
    s.innerHTML = `<div class="replay-badge"><i></i>REPLAY</div>
      <div class="replay-bar panel"><div class="replay-row"><button class="replay-btn" data-a="play"></button><div class="replay-track"><i></i></div><span class="replay-time"></span></div>
      <div class="replay-row small"><button class="replay-btn" data-a="cam"></button><button class="replay-btn" data-a="speed"></button><button class="replay-btn" data-a="photo">PHOTO</button><button class="replay-btn" data-a="exit">EXIT</button></div>
      <div class="hint">ENTER/H play-pause · ←/→ scrub · ↑/↓ speed · V camera · F2 photo · ESC back to driving</div></div>`;
    const act = { play: () => { r.playing = !r.playing; }, cam: () => { r.cam = (r.cam + 1) % REPLAY_CAMS.length; r.track = null; }, speed: () => { r.speedIdx = (r.speedIdx + 3) % 4; }, photo: () => r.toPhoto(), exit: () => r.exit(true) };
    s.querySelectorAll('.replay-btn').forEach((b) => { b.onclick = () => { act[b.dataset.a](); b.blur(); this.updateReplay(r); }; });
    const track = s.querySelector('.replay-track');
    track.onpointerdown = (e) => { const f = (e.clientX - track.getBoundingClientRect().left) / track.clientWidth; r.t = r.t0 + Math.max(0, Math.min(0.999, f)) * (r.t1 - r.t0); r.track = null; };
    this.screens.appendChild(s);
    this.current = 'replay';
    this.updateReplay(r);
  }
  updateReplay(r) {
    const s = this.screens.querySelector('.replay-ui');
    if (!s) return;
    const f = (r.t - r.t0) / Math.max(0.01, r.t1 - r.t0);
    s.querySelector('.replay-track i').style.width = `${(f * 100).toFixed(1)}%`;
    s.querySelector('.replay-time').textContent = `${(r.t - r.t0).toFixed(1)} / ${(r.t1 - r.t0).toFixed(1)} s`;
    const cam = REPLAY_CAMS[r.cam];
    s.querySelector('[data-a=cam]').textContent = cam === 'AUTO' ? `CAM: AUTO (${r.shot || ''})` : `CAM: ${cam}`;
    s.querySelector('[data-a=speed]').textContent = `SPEED ${r.speedLabel}`;
    s.querySelector('[data-a=play]').textContent = r.playing ? '❚❚' : '▶';
  }

  togglePhotoPanel() { this.screens.querySelector('.photo-panel')?.classList.toggle('hidden'); }
  photoFlash() {
    const f = this.screens.querySelector('.photo-flash');
    if (!f) return;
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  // ------------------------------------------------------------------ career
  showCareer(onBack) {
    this.clear();
    const g = this.game, P = g.progress;
    const L = P.info;
    const s = h('div', 'screen center dim-bg');
    const box = h('div', 'panel career');
    box.appendChild(h('h1', '', 'CAREER'));
    box.appendChild(h('div', 'career-head', `<div class="lvbig">LEVEL ${L.level}</div><div class="xpline big"><i style="width:${L.need ? Math.round(L.into / L.need * 100) : 100}%"></i></div><div class="xptext">${L.need ? `${L.into.toLocaleString()} / ${L.need.toLocaleString()} XP to level ${L.level + 1}` : 'MAX LEVEL'} · race payouts x${P.rewardMult.toFixed(2)}</div>`));
    // next car unlocks by level
    const next = Object.values(CARS).filter((c) => c.unlock?.level > L.level).sort((a, b) => a.unlock.level - b.unlock.level).slice(0, 3);
    if (next.length) box.appendChild(h('div', 'career-next', `NEXT UNLOCKS · ${next.map((c) => `<b>${c.name}</b> <span>LV ${c.unlock.level}</span>`).join(' · ')}`));
    const list = h('div', 'career-list');
    const done = g.save.data.missions;
    for (const ch of CHAPTERS) {
      const open = P.chapterOpen(ch.id);
      const ms = MISSIONS.filter((m) => m.chapter === ch.id);
      const n = ms.filter((m) => done[m.id]?.done).length;
      list.appendChild(h('div', 'chapter' + (open ? '' : ' locked'), `<span>CHAPTER ${ch.id} · ${ch.name.toUpperCase()}</span><span>${open ? `${n}/${ms.length}` : `🔒 LEVEL ${ch.level} OR FINISH CHAPTER ${ch.id - 1}`}</span>`));
      if (!open) continue;
      for (const m of ms) {
        const complete = !!done[m.id]?.done;
        const prog = P.progressOf(m);
        const pct = Math.round((prog / m.target) * 100);
        const val = m.unit ? `${Math.floor(prog)}/${m.target} ${m.unit}` : `${Math.floor(prog)}/${m.target}`;
        list.appendChild(h('div', 'mission' + (complete ? ' done' : '') + (m.finale ? ' finale' : ''), `<div class="mt"><b>${complete ? '✓ ' : ''}${m.name}</b><span>${complete ? 'COMPLETE' : val}</span></div><div class="md">${m.desc}</div><div class="mbar"><i style="width:${complete ? 100 : pct}%"></i></div><div class="mr">${P.rewardText(m.reward)}</div>`));
      }
    }
    box.appendChild(list);
    const back = h('button', 'menu-item', 'BACK');
    back.onclick = () => onBack();
    box.appendChild(back);
    s.appendChild(box);
    this.screens.appendChild(s);
    this.current = 'career';
    this._menuNav([back], onBack);
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
        opt('Time of day', 'Real time follows your local clock; game clock runs a 48-minute day', 'graphics', 'timeOfDay', ['real', 'cycle', 'morning', 'day', 'evening', 'night'], ['REAL TIME', 'GAME CLOCK', 'MORNING', 'DAY', 'EVENING', 'NIGHT'], () => g.applyTime());
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
      <div>Time: ${formatTime(r.time)}<br>Cash: <span class="reward">+${formatMoney(r.reward)}</span>${g.progress && g.progress.rewardMult > 1.001 && r.reward ? ` <small style="color:var(--dim)">(level bonus x${g.progress.rewardMult.toFixed(2)})</small>` : ''}<br>XP: <span class="reward">+${(r.xp || 0).toLocaleString()}</span>${r.levelUp ? ` · <b style="color:var(--accent2)">LEVEL ${r.levelUp}!</b>` : ''}</div>`);
    if (g.progress) { const L = g.progress.info; box.appendChild(h('div', '', `<div class="xpline big"><i style="width:${L.need ? Math.round(L.into / L.need * 100) : 100}%"></i></div><small style="color:var(--dim);letter-spacing:.15em">LEVEL ${L.level} · ${L.need ? `${(L.need - L.into).toLocaleString()} XP TO NEXT` : 'MAX'}</small>`)); }
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
