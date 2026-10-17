// The garage: choose the parts for a truck, see on the truck and in the numbers what they change, and fit them.
// Opens from the start screen, and in the valley with U or from the pause menu (parts are fitted at the station).
// Each part is a row with a list of what fits and what it changes against the factory part; the truck turns in the
// middle; under it, a grade for the build off-road and the numbers that matter there.
import {
  CATEGORIES, presetsFor, optionsFor, tyreFor, normalizeBuild, presetBuild, encodeBuild, decodeBuild, buildStats, maxTyre,
  stockBuild, LIFTS, TYRE_SIZES, partPrice, optionAllowed,
} from '../physics/Upgrades.js';
import { money } from '../game/Career.js';
import { truckBase, truckSpec } from '../physics/trucks.js';
import { GaragePreview } from './GaragePreview.js';
import { loadTruckAsset, truckAsset, MODEL_BODIES } from '../render/TruckAssets.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ic = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;
const mm = (v) => `${Math.round(v * 1000).toLocaleString('en-US')} mm`;

/** Each part's row: its icon, what it is, and the number it changes most (a stat; +1 more is better, -1 less). */
const ROWS = {
  lift: ['spring', 'Suspension lift', 'belly', 'Belly height', 1],
  tyre: ['tyre', 'Tyre diameter', 'clearance', 'Clearance', 1],
  tread: ['tread', 'Tyre tread'],
  wheels: ['wheel', 'Wheels and tyre air', 'minPsi', 'Air down', -1],
  gears: ['gear', 'Final drive ratio', 'crawl', 'Crawl ratio', 1],
  tcase: ['tcase', 'High / low range', 'crawl', 'Crawl ratio', 1],
  diffs: ['axle', 'Open, limited-slip or locked'],
  trans: ['shift', 'Transmission', 'crawl', 'Crawl ratio', 1],
  engine: ['engine', 'Engine', 'powerKw', 'Power', 1],
  intake: ['snorkel', 'Air intake', 'wading', 'Wading', 1],
  winch: ['winch', 'Winch capacity', 'pull', 'Pull', 1],
  armor: ['shield', 'Body protection', 'mass', 'Weight', -1],
  lights: ['lightbar', 'Light bar and auxiliaries'],
  rack: ['rack', 'Roof rack and storage', 'mass', 'Weight', -1],
};

/** The numbers under the truck: key, label, icon, format, which way is better. */
const PERF = [
  ['powerKw', 'Power', 'bolt', (v) => `${Math.round(v * 1.341)} hp`, 1],
  ['peakTorque', 'Torque', 'gear', (v) => `${Math.round(v).toLocaleString('en-US')} Nm`, 1],
  ['mass', 'Weight', 'weight', (v) => `${Math.round(v).toLocaleString('en-US')} kg`, -1],
];
const KEYS = [
  ['clearance', 'Clearance', 'ground', mm, 1, 'Ground clearance under the diffs'],
  ['approach', 'Approach', 'angle', (v) => `${v.toFixed(0)}°`, 1, 'Approach angle'],
  ['departure', 'Departure', 'angle', (v) => `${v.toFixed(0)}°`, 1, 'Departure angle'],
  ['breakover', 'Breakover', 'angle', (v) => `${v.toFixed(0)}°`, 1, 'Breakover angle'],
  ['travel', 'Travel', 'spring', mm, 1, 'Wheel travel'],
  ['wading', 'Wading', 'water', mm, 1, 'Wading depth'],
  ['crawl', 'Crawl ratio', 'gear', (v) => `${v.toFixed(0)}:1`, 1, 'Crawl ratio: first gear, low range and the axles'],
  ['tip', 'Stability', 'stable', (v) => (v >= 45 ? 'High' : v >= 39 ? 'Medium' : 'Low'), 1, 'How far it leans before it tips'],
];
const MORE = [
  ['tip', 'Tips over at', (v) => `${v.toFixed(0)}°`],
  ['belly', 'Under the belly', (v) => `${(v * 100).toFixed(0)} cm`],
  ['idleCrawl', 'Crawl at idle', (v) => `${v.toFixed(1)} km/h`],
  ['topSpeed', 'Top speed', (v) => `${v.toFixed(0)} km/h`],
  ['cgHeight', 'Centre of gravity', (v) => `${(v * 100).toFixed(0)} cm`],
];
/** The views of the truck: [yaw, pitch]. */
const ANGLES = { front: [0.35, 0.12], side: [Math.PI / 2, 0.08], rear: [Math.PI - 0.45, 0.14], threeq: [0.8, 0.2], top: [0.6, 0.85] };

/** The stats of a spec, with the winch's pull. */
function statsOf(spec) { return { ...buildStats(spec), pull: spec.winch?.stallPull || 0, electric: !!spec.engine?.electric }; }

/** How much better (or worse) v is than v0, as a tag: '+12% Crawl ratio', green if better, red if worse. */
function delta(v, v0, better, label) {
  if (!(Math.abs(v0) > 1e-9)) return '';
  const pct = ((v - v0) / Math.abs(v0)) * 100;
  if (Math.abs(pct) < 0.5) return '';
  const good = Math.sign(pct) === better;
  return `<span class="g-delta ${good ? 'good' : 'bad'}">${pct > 0 ? '▲ +' : '▼ '}${Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%${label ? ` <em>${label}</em>` : ''}</span>`;
}

/** The build's grade off-road, from its clearance, angles, travel, wading, gearing, lockers and stability. */
export function gradeOf(st, build) {
  const n = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const lock = { 0: 0, 1: 0.3, 2: 0.65, 3: 1, 4: 0.75 }[build.diffs] ?? 0;
  const s = [n(st.clearance, 0.18, 0.42), n(st.approach, 25, 60), n(st.departure, 20, 50), n(st.breakover, 15, 34), n(st.travel, 0.15, 0.42),
    n(st.wading, 0.45, 1.3), st.electric ? 0.9 : n(st.crawl, 25, 110), lock, n(st.tip, 35, 50)];
  const score = s.reduce((a, x) => a + x, 0) / s.length;
  return { score, grade: score >= 0.8 ? 'S' : score >= 0.64 ? 'A' : score >= 0.48 ? 'B' : score >= 0.32 ? 'C' : 'D' };
}

/** Label of option i in a category. */
function optLabel(cat, o, base) {
  if (cat.id === 'tcase' && !o.low) return base.stock.low > 1 ? `Stock (${base.stock.low.toFixed(2)}:1)` : 'Single-speed';
  return o.name || o.short;
}

export class Garage {
  constructor() {
    this.el = $('garage');
    this.preview = null;
    this.isOpen = false;
    this.raf = 0;
  }

  /**
   * Open the garage for a truck. Resolves with the build code to fit, or null when cancelled.
   *   truckId, code: current build; paint: hex; fitLabel: the fit button's text; note: a line by the buttons;
   *   career: the wallet; players: { n, max } in a room; nav: the side bar (in the game): picking races, map, dealer or
   *   settings there closes the garage with navTo set to it, for the game to open
   */
  open({ truckId, code, paint = '#b5532c', fitLabel = 'Fit these parts', note = '', career = null, players = null, nav = false }) {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;
    this.base = truckBase(truckId);
    this.truckId = this.base.id;
    this.paint = paint;
    this.build = decodeBuild(this.base, code || '');
    this.career = career;
    this.fitLabel = fitLabel;
    this.stock = stockBuild(this.base);
    this.stockStats = statsOf(truckSpec(this.truckId));
    this.focus = null;
    this.navTo = null;
    this.el.classList.remove('hidden');
    $('g-truck').textContent = this.base.name;
    $('g-truck2').textContent = this.base.name;
    const spec0 = truckSpec(this.truckId), axles = spec0.axles.length * 2;
    $('g-drive').textContent = `${axles}x${axles}`;
    $('g-class').textContent = spec0.mass < 1700 ? 'Light 4x4' : spec0.mass < 2300 ? 'Mid-size 4x4' : spec0.mass < 3000 ? 'Full-size 4x4' : 'Heavy off-road';
    $('g-fit-t').textContent = fitLabel;
    $('g-note').textContent = note;
    $('g-note').parentElement.classList.toggle('hidden', !note);
    $('g-money').classList.toggle('hidden', !career);
    if (career) $('g-money-t').textContent = Math.round(career.money).toLocaleString('en-US');
    $('g-online').classList.toggle('hidden', !players);
    if (players) $('g-online-n').textContent = `${players.n}/${players.max}`;
    $('g-nav').classList.toggle('hidden', !nav);
    $('g-nav').parentElement.classList.toggle('nonav', !nav);
    if (!this.preview) {
      try { this.preview = new GaragePreview($('g-view')); } catch (e) { console.warn('garage preview', e); }
    }
    this.wireView();
    this.renderPresets();
    this.renderParts();
    this.update();
    let last = performance.now();
    const loop = (now) => {
      if (!this.isOpen) return;
      this.preview?.frame(Math.min(0.1, (now - last) / 1000));
      last = now;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return new Promise((resolve) => {
      const done = (val, navTo = null) => {
        this.isOpen = false;
        this.navTo = navTo;
        cancelAnimationFrame(this.raf);
        this.el.classList.add('hidden');
        removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      addEventListener('keydown', onKey, true);
      $('g-fit').onclick = () => {
        // the parts not yet owned are bought now
        if (this.career && !this.career.buyBuild(this.truckId, this.build)) { this.say('Not enough money for those parts.'); return; }
        done(encodeBuild(this.build));
      };
      $('g-cancel').onclick = () => done(null);
      $('g-close').onclick = () => done(null);
      for (const b of $('g-nav').querySelectorAll('[data-nav]')) b.onclick = () => done(null, b.dataset.nav);
    });
  }

  /** A line by the buttons (what just happened). */
  say(text) {
    $('g-note').textContent = text;
    $('g-note').parentElement.classList.toggle('hidden', !text);
  }

  /** The view's buttons: turning by itself, zoom, a picture, and the angles. */
  wireView() {
    const P = this.preview;
    this.el.querySelector('.g-tools [data-v="spin"]').classList.toggle('sel', !!P?.spin);
    if (!P || this.viewWired) return;
    this.viewWired = true;
    const tools = this.el.querySelector('.g-tools'), angle = $('g-angle');
    const spinBtn = tools.querySelector('[data-v="spin"]');
    spinBtn.classList.toggle('sel', P.spin);
    tools.onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const v = b.dataset.v;
      if (v === 'spin') P.spin = !P.spin;
      else if (v === 'in' || v === 'out') { P.fitR = 0; P.dist = Math.max(4.5, Math.min(14, P.dist * (v === 'in' ? 0.85 : 1.18))); P.dirty = true; }
      else if (v === 'photo') this.photo();
      spinBtn.classList.toggle('sel', P.spin);
    };
    const go = (name) => { const [yaw, pitch] = ANGLES[name] || ANGLES.front; P.spin = false; P.yaw = yaw; P.pitch = pitch; P.dirty = true; spinBtn.classList.remove('sel'); };
    angle.onchange = () => go(angle.value);
    for (const b of this.el.querySelectorAll('.g-angle [data-a]')) {
      b.onclick = () => {
        const opts = [...angle.options].map((o) => o.value), i = (opts.indexOf(angle.value) + Number(b.dataset.a) + opts.length) % opts.length;
        angle.value = opts[i];
        go(angle.value);
      };
    }
    // a drag stops it turning: the button shows it
    $('g-view').addEventListener('pointerdown', () => spinBtn.classList.remove('sel'));
  }

  /** Save a picture of the truck as it is in the view. */
  photo() {
    const P = this.preview;
    if (!P?.model) return;
    P.dirty = true; P.frame(0);
    try {
      const a = document.createElement('a');
      a.href = P.canvas.toDataURL('image/png');
      a.download = `${this.base.name.replace(/[^\w]+/g, '-').toLowerCase()}-offroad-legends.png`;
      a.click();
      this.say('Picture saved to your downloads.');
    } catch { this.say('Could not save the picture.'); }
  }

  renderPresets() {
    const el = $('g-presets');
    el.innerHTML = '';
    const icons = { stock: 'gear', trail: 'mountain', crawler: 'mountain', mudder: 'water', overland: 'map', track: 'flag', safari: 'map', max: 'bolt' };
    for (const p of presetsFor(this.base)) {
      const b = document.createElement('button');
      b.className = 'g-preset';
      b.innerHTML = `${ic(icons[p.id] || 'chev')}${esc(p.name)}`;
      b.title = p.desc;
      b.dataset.id = p.id;
      b.onclick = () => { this.focus = { name: p.name, desc: p.desc }; this.setBuild(presetBuild(this.base, p.id)); };
      el.appendChild(b);
    }
  }

  renderParts() {
    const el = $('g-parts');
    el.innerHTML = '';
    let group = null;
    this.selects = new Map();
    for (const cat of CATEGORIES) {
      if (cat.group !== group) {
        group = cat.group;
        const h = document.createElement('h3');
        h.className = 'g-h';
        h.innerHTML = `${ic('chev')}${esc(group)}`;
        el.appendChild(h);
      }
      const [icon, sub] = ROWS[cat.id] || ['gear', ''];
      const row = document.createElement('div');
      row.className = 'g-row';
      row.dataset.cat = cat.id;
      row.innerHTML = `${ic(icon)}<div class="g-name"><b>${esc(cat.name)}</b><small>${esc(sub)}</small></div><div class="g-pick"><select aria-label="${esc(cat.name)}"></select></div><span class="g-eff"></span>`;
      const sel = row.querySelector('select');
      // a truck without a low range (its gearbox crawls on its own) shows that for its transfer case; a road car, how
      // its wheels are driven
      const drive = this.base.trans?.drive, road = { rwd: ['Rear-wheel drive', 'No transfer case: the engine drives the rear wheels alone.'],
        awd: ['All-wheel drive', 'A centre differential shares the drive between the axles all the time; no low range.'] }[drive];
      const single = (o, i) => (cat.id === 'tcase' && i === 0 && this.base.stock.low <= 1
        ? (road ? { ...o, name: road[0], short: drive.toUpperCase(), desc: road[1] } : { ...o, name: 'Single-speed transfer case', desc: 'No low range: the gearbox\'s own crawler first does that job.' }) : o);
      const opts = optionsFor(cat, this.truckId).map(single);
      opts.forEach((o, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        if (!optionAllowed(this.base, cat.id, i)) opt.hidden = opt.disabled = true;
        let label = optLabel(cat, o, this.base);
        if (this.career && !this.career.freeParts) {
          const v = cat.id === 'tyre' ? TYRE_SIZES[i] : i, price = partPrice(this.base, cat.id, v);
          if (price > 0) label += this.career.ownsPart(this.truckId, cat.id, v) ? ' (owned)' : ` · ${money(price)}`;
        }
        opt.textContent = label;
        sel.appendChild(opt);
      });
      sel.disabled = cat.id !== 'tyre' && opts.filter((o, i) => optionAllowed(this.base, cat.id, i)).length < 2;
      sel.onchange = () => { const i = Number(sel.value); this.pick(cat, i, opts[i]); };
      const show = () => this.describe(cat, opts[Number(sel.value)]);
      row.onmouseenter = show;
      sel.onfocus = show;
      row.onmouseleave = () => this.describe(null);
      this.selects.set(cat.id, { sel, row, opts });
      el.appendChild(row);
    }
  }

  /** Choose option i of a category; a tyre too big for the lift brings the lift it needs. */
  pick(cat, i, o) {
    const b = { ...this.build };
    let note = '';
    if (cat.id === 'tyre') {
      b.tyre = TYRE_SIZES[i];
      if (b.tyre > maxTyre(this.base, b.lift)) {
        const need = LIFTS.findIndex((l, k) => b.tyre <= maxTyre(this.base, k));
        if (need >= 0) { b.lift = need; note = `${b.tyre}" tyres need room: fitted the ${LIFTS[need].short} lift too.`; }
      }
    } else {
      b[cat.id] = i;
      if (cat.id === 'lift' && this.build.tyre > maxTyre(this.base, i)) note = `No room for ${this.build.tyre}" tyres on that lift: down to ${normalizeBuild(this.base, b).tyre}".`;
    }
    this.focus = { cat, o };
    this.setBuild(b, note);
  }

  setBuild(b, note = '') {
    this.build = normalizeBuild(this.base, b);
    this.say(note);
    this.update();
  }

  /** The lists, what each part changes, the grade and the numbers, the description and the 3D view. */
  update() {
    const b = this.build, code = encodeBuild(b), base = this.base;
    const spec = truckSpec(this.truckId, b), st = statsOf(spec), s0 = this.stockStats;
    for (const [id, { sel, row, opts }] of this.selects) {
      const i = id === 'tyre' ? TYRE_SIZES.indexOf(b.tyre) : b[id];
      if (sel.value !== String(i)) sel.value = String(i);
      if (id === 'tyre') {
        [...sel.options].forEach((opt, k) => {
          const d = TYRE_SIZES[k];
          // smaller than stock, too big for any lift, or not for this truck (a road car takes its own sizes)
          opt.hidden = d < base.stock.tyre || d > maxTyre(base, LIFTS.length - 1) || !optionAllowed(base, 'tyre', k);
          opt.disabled = opt.hidden;
        });
      }
      // what this part does against the factory one: on the number it changes most
      const [, , key, label, better] = ROWS[id] || [];
      const isStock = id === 'tyre' ? b.tyre === this.stock.tyre : b[id] === this.stock[id];
      let eff = '';
      if (isStock) eff = '<span class="g-delta stock">Factory</span>';
      else if (key) {
        const other = truckSpec(this.truckId, { ...b, [id]: this.stock[id] }), v0 = statsOf(other)[key];
        eff = key === 'minPsi' ? `<span class="g-delta good">Down to ${st.minPsi} psi</span>`
          : key === 'pull' && !v0 ? `<span class="g-delta good">${(st.pull / 1000).toFixed(0)} kN <em>pull</em></span>`
            : delta(st[key], v0, better, label) || `<span class="g-delta stock">${esc(opts[i]?.short || 'fitted')}</span>`;
      } else eff = `<span class="g-delta good">${esc(opts[i]?.short || 'fitted')}</span>`;
      const effEl = row.querySelector('.g-eff');
      if (effEl.innerHTML !== eff) effEl.innerHTML = eff;
      row.classList.toggle('changed', !isStock);
    }
    for (const btn of $('g-presets').children) btn.classList.toggle('sel', encodeBuild(presetBuild(base, btn.dataset.id)) === code);
    // the grade and the numbers, each against the factory truck
    const g = gradeOf(st, b);
    $('g-grade').textContent = g.grade;
    $('g-grade').className = `grade-${g.grade.toLowerCase()}`;
    $('g-grade').title = `Off-road score ${Math.round(g.score * 100)} of 100: clearance, angles, travel, wading, gearing, lockers and stability`;
    const cell = ([k, label, icon, fmt, better, tip]) => `<div class="g-stat"${tip ? ` title="${esc(tip)}"` : ''}>${ic(icon)}<span>${label}</span><b>${fmt(st[k])}</b>${delta(st[k], s0[k], better) || '<span class="g-delta none"></span>'}</div>`;
    $('g-key3').innerHTML = PERF.map(cell).join('');
    $('g-stats').innerHTML = KEYS.map(cell).join('');
    const t = tyreFor(base, b.tyre);
    const more = MORE.filter(([k]) => !(k === 'idleCrawl' && spec.engine.electric));
    $('g-more').innerHTML = `<span>${esc(st.tyre)} · ${esc(t.label)} · down to ${st.minPsi} psi</span>${more.map(([k, label, fmt]) => `<span>${label} <b>${fmt(st[k])}</b></span>`).join('')}`
      + (st.rub > 0 ? `<span class="g-warn">The ${t.d}" tyres rub at full bump: the bump stops are extended ${(st.bumpLoss * 100).toFixed(0)} cm.</span>` : '');
    $('g-sub').textContent = `${Math.round(st.powerKw * 1.341)} hp · ${Math.round(st.peakTorque).toLocaleString('en-US')} Nm · ${st.tyre} · ${spec.engine.electric ? 'electric' : `${spec.trans.gears.length}-speed`}`;
    this.describe(null);
    if (this.preview && code !== this.shown) {
      this.preview.show(spec, this.paint); this.shown = code;
      // a model body not loaded yet: shown again when it is
      if (MODEL_BODIES.has(spec.style) && !truckAsset(spec.style)) loadTruckAsset(spec.style).then((a) => { if (a && this.isOpen) { this.shown = null; this.update(); } });
    }
    // the bill: parts in this build not yet owned
    const bill = $('g-bill'), fit = $('g-fit');
    if (this.career?.freeParts) {
      bill.innerHTML = `${ic('gear')}<b>Free parts</b>`;
      bill.classList.remove('short'); fit.disabled = false; $('g-fit-t').textContent = this.fitLabel;
    } else if (this.career) {
      const q = this.career.quote(this.truckId, b), ok = this.career.canAfford(q.total);
      bill.innerHTML = q.total ? `Parts to buy <b>${money(q.total)}</b>` : '';
      bill.classList.toggle('short', !ok);
      fit.disabled = !ok;
      $('g-fit-t').textContent = q.total ? `${this.fitLabel} (${money(q.total)})` : this.fitLabel;
    } else { bill.textContent = ''; fit.disabled = false; $('g-fit-t').textContent = this.fitLabel; }
  }

  describe(cat, o) {
    const f = cat ? { name: o.name, desc: o.desc } : this.focus?.o ? { name: this.focus.o.name, desc: this.focus.o.desc } : this.focus;
    $('g-desc').innerHTML = f ? `<b>${esc(f.name)}</b>${f.desc ? ` ${esc(f.desc)}` : ''}` : '<span class="dim">Pick the parts. Drag the truck to turn it, scroll to zoom.</span>';
  }
}
