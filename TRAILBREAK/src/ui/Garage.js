// The garage: choose the parts for a truck, see on the truck and in the numbers what they change, and fit them.
// Opens from the start screen, and in the valley with U or from the pause menu (parts are fitted at the station).
import {
  CATEGORIES, PRESETS, optionsFor, normalizeBuild, presetBuild, encodeBuild, decodeBuild, buildStats, maxTyre,
  LIFTS, TYRE_SIZES, TYRES, partPrice,
} from '../physics/Upgrades.js';
import { money } from '../game/Career.js';
import { truckBase, truckSpec } from '../physics/trucks.js';
import { GaragePreview } from './GaragePreview.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Numbers the garage shows: key, label, unit, format, which way is better (+1 higher, -1 lower). */
const STATS = [
  ['clearance', 'Under the diffs', 'cm', (v) => (v * 100).toFixed(0), 1],
  ['belly', 'Under the belly', 'cm', (v) => (v * 100).toFixed(0), 1],
  ['approach', 'Approach angle', '°', (v) => v.toFixed(0), 1],
  ['departure', 'Departure angle', '°', (v) => v.toFixed(0), 1],
  ['breakover', 'Breakover angle', '°', (v) => v.toFixed(0), 1],
  ['travel', 'Wheel travel', 'cm', (v) => (v * 100).toFixed(0), 1],
  ['wading', 'Wading depth', 'cm', (v) => (v * 100).toFixed(0), 1],
  ['tip', 'Tips over at', '°', (v) => v.toFixed(0), 1],
  ['crawl', 'Crawl ratio', ':1', (v) => v.toFixed(0), 1],
  ['idleCrawl', 'Crawl at idle', 'km/h', (v) => v.toFixed(1), -1],
  ['peakTorque', 'Torque', 'Nm', (v) => v.toFixed(0), 1],
  ['powerKw', 'Power', 'kW', (v) => v.toFixed(0), 1],
  ['topSpeed', 'Top speed', 'km/h', (v) => v.toFixed(0), 1],
  ['mass', 'Weight', 'kg', (v) => v.toFixed(0), -1],
  ['cgHeight', 'Centre of gravity', 'cm', (v) => (v * 100).toFixed(0), -1],
];

/** Label of option i in a category. */
function optLabel(cat, o, base) {
  if (cat.id === 'tcase' && !o.low) return base.stock.low > 1 ? `${base.stock.low.toFixed(2)}` : 'none';
  return o.short || o.name;
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
   *   truckId, code: current build; paint: hex; fitLabel: the fit button's text; note: a line under the parts
   */
  open({ truckId, code, paint = '#b5532c', fitLabel = 'Fit these parts', note = '', career = null }) {
    if (this.isOpen) return Promise.resolve(null);
    this.isOpen = true;
    this.base = truckBase(truckId);
    this.truckId = this.base.id;
    this.paint = paint;
    this.build = decodeBuild(this.base, code || '');
    this.career = career;
    this.fitLabel = fitLabel;
    this.stockStats = buildStats(truckSpec(this.truckId));
    this.focus = null;
    this.el.classList.remove('hidden');
    $('g-truck').textContent = this.base.name;
    $('g-fit').textContent = fitLabel;
    $('g-note').textContent = note;
    if (!this.preview) {
      try { this.preview = new GaragePreview($('g-view')); } catch (e) { console.warn('garage preview', e); }
    }
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
      const done = (val) => {
        this.isOpen = false;
        cancelAnimationFrame(this.raf);
        this.el.classList.add('hidden');
        removeEventListener('keydown', onKey, true);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
      addEventListener('keydown', onKey, true);
      $('g-fit').onclick = () => {
        // the parts not yet owned are bought now
        if (this.career && !this.career.buyBuild(this.truckId, this.build)) { $('g-note').textContent = 'Not enough money for those parts.'; return; }
        done(encodeBuild(this.build));
      };
      $('g-cancel').onclick = () => done(null);
      $('g-close').onclick = () => done(null);
    });
  }

  renderPresets() {
    const el = $('g-presets');
    el.innerHTML = '';
    for (const p of PRESETS) {
      const b = document.createElement('button');
      b.className = 'g-preset';
      b.textContent = p.name;
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
    for (const cat of CATEGORIES) {
      if (cat.group !== group) {
        group = cat.group;
        const h = document.createElement('h3');
        h.textContent = group;
        el.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'g-row';
      row.innerHTML = `<span class="g-cat">${esc(cat.name)}</span><div class="g-opts"></div>`;
      const opts = row.querySelector('.g-opts');
      // a truck without a low range (its gearbox crawls on its own) shows that for its transfer case
      const single = (o, i) => (cat.id === 'tcase' && i === 0 && this.base.stock.low <= 1
        ? { ...o, name: 'Single-speed transfer case', desc: 'No low range: the gearbox\'s own crawler first does that job.' } : o);
      optionsFor(cat, this.truckId).map(single).forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'g-opt';
        b.dataset.cat = cat.id; b.dataset.i = i;
        b.textContent = optLabel(cat, o, this.base);
        b.title = o.name;
        if (this.career) {
          const v = cat.id === 'tyre' ? TYRE_SIZES[i] : i, price = partPrice(this.base, cat.id, v);
          if (price > 0) {
            const tag = document.createElement('span');
            tag.className = 'price';
            tag.textContent = money(price);
            b.appendChild(tag);
            b.classList.toggle('owned', this.career.ownsPart(this.truckId, cat.id, v));
          }
        }
        b.onclick = () => this.pick(cat, i, o);
        b.onmouseenter = () => this.describe(cat, o);
        b.onmouseleave = () => this.describe(null);
        opts.appendChild(b);
      });
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
    $('g-note').textContent = note;
    this.update();
  }

  /** Selected states, stats, the description and the 3D view. */
  update() {
    const b = this.build, code = encodeBuild(b);
    for (const btn of $('g-parts').querySelectorAll('.g-opt')) {
      const id = btn.dataset.cat, i = Number(btn.dataset.i);
      const on = id === 'tyre' ? TYRE_SIZES[i] === b.tyre : b[id] === i;
      btn.classList.toggle('sel', on);
      if (id === 'tyre') {
        const d = TYRE_SIZES[i];
        btn.classList.toggle('need', d > maxTyre(this.base, b.lift));
        btn.classList.toggle('hide', d < this.base.stock.tyre || d > maxTyre(this.base, LIFTS.length - 1));   // smaller than stock, or too big for any lift
      }
    }
    for (const btn of $('g-presets').children) btn.classList.toggle('sel', encodeBuild(presetBuild(this.base, btn.dataset.id)) === code);
    const spec = truckSpec(this.truckId, b);
    const st = buildStats(spec), s0 = this.stockStats;
    const rows = STATS.map(([k, label, unit, fmt, better]) => {
      const v = st[k], v0 = s0[k], dv = Number(fmt(v)) - Number(fmt(v0));
      let delta = '';
      if (Math.abs(dv) > 1e-9) {
        const good = Math.sign(dv) === better;
        delta = `<span class="d ${good ? 'good' : 'bad'}">${dv > 0 ? '▲' : '▼'} ${Math.abs(dv) % 1 ? Math.abs(dv).toFixed(1) : Math.abs(dv)}</span>`;
      }
      return `<div class="g-stat"><span>${label}</span><b>${fmt(v)}<small>${unit}</small></b>${delta}</div>`;
    });
    const t = TYRES[b.tyre];
    const warn = st.rub > 0 ? `<p class="g-warn">The ${t.d}" tyres rub at full bump: the bump stops are extended ${(st.bumpLoss * 100).toFixed(0)} cm.</p>` : '';
    $('g-stats').innerHTML = `<div class="g-tyre">${esc(st.tyre)} · ${esc(t.label)} · down to ${st.minPsi} psi</div>${rows.join('')}${warn}`;
    this.describe(null);
    if (this.preview && code !== this.shown) { this.preview.show(spec, this.paint); this.shown = code; }
    // the bill: parts in this build not yet owned
    const bill = $('g-bill'), fit = $('g-fit');
    if (this.career) {
      const q = this.career.quote(this.truckId, b), ok = this.career.canAfford(q.total);
      bill.innerHTML = q.total ? `Parts to buy <b>${money(q.total)}</b> · you have ${money(this.career.money)}` : `You have ${money(this.career.money)}`;
      bill.classList.toggle('short', !ok);
      fit.disabled = !ok;
      fit.textContent = q.total ? `${this.fitLabel} (${money(q.total)})` : this.fitLabel;
    } else { bill.textContent = ''; fit.disabled = false; fit.textContent = this.fitLabel; }
  }

  describe(cat, o) {
    const f = cat ? { name: o.name, desc: o.desc } : this.focus?.o ? { name: this.focus.o.name, desc: this.focus.o.desc } : this.focus;
    $('g-desc').innerHTML = f ? `<b>${esc(f.name)}</b>${f.desc ? ` ${esc(f.desc)}` : ''}` : '<span class="dim">Pick the parts. Drag the truck to turn it.</span>';
  }
}
