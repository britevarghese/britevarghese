// The showroom: where a car is chosen, in the lobby and at the dealer. The car in 3D on a showroom's turntable (drag to
// turn it, wheel or pinch to come closer), beside it its maker and model, how rare it is, its price and the maker's
// figures, and the button that takes it; under them every car on a rail of cards (all, the sports cars, the 4x4s).
import { TruckView } from './TruckView.js';
import { TRUCKS, truckSpec } from '../physics/trucks.js';
import { buildStats } from '../physics/Upgrades.js';
import { TRUCK_PRICES, DEALER_ORDER } from '../game/Career.js';

const MAKERS = ['BYD Yangwang', 'Mercedes-AMG', 'Mercedes-Benz', 'Land Rover', 'Lamborghini', 'McLaren', 'Porsche', 'Chevrolet', 'Mitsubishi', 'Mahindra',
  'Nissan', 'Toyota', 'Mazda', 'Subaru', 'Honda', 'Audi', 'BMW', 'Ford', 'Jeep', 'Hummer', 'GMC', 'Ram', 'Lada', 'UAZ', 'Willys'];

/** The maker's badge: its initials where its name is long. */
const BADGE = { 'BYD Yangwang': 'YW', 'Mercedes-AMG': 'AMG', 'Mercedes-Benz': 'MB', 'Land Rover': 'LR', Lamborghini: 'LAMBO', Chevrolet: 'CHEVY', Mitsubishi: 'MMC', Mahindra: 'M&M', McLaren: 'McL' };

/** The showroom on a screen: one for it, the lobby's and the dealer's both (each key goes to one of them). */
export const showroomFor = (el) => (el.showroom ||= new Showroom(el));

/** A car's maker and model, from its name ("BMW M4 CSL": BMW, M4 CSL). */
export function makeAndModel(name) {
  const m = MAKERS.find((k) => name.startsWith(k + ' '));
  return m ? [m, name.slice(m.length + 1)] : ['', name];
}

/** The cars shown first on the rail, with a ribbon: what's new and worth a look (the U8 floats). */
export const FEATURED = ['u8'];

/** How rare a car is, by what it costs: legendary, epic, rare or common. */
export function rarity(price) {
  return price >= 130000 ? 'legendary' : price >= 60000 ? 'epic' : price >= 20000 ? 'rare' : 'common';
}

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const icon = (name) => `<svg class="ic"><use href="#i-${name}"/></svg>`;

export class Showroom {
  /** el: the screen to draw it in (an empty section). */
  constructor(el) {
    this.el = el;
    el.innerHTML = `<div class="sr-card">
      <header class="sr-head"><svg class="sr-mark"><use href="#i-peaks"/></svg>
        <div class="sr-title"><h2></h2><p>Premium vehicles <i>·</i> Off-road ready <i>·</i> Your next adventure</p></div>
        <button class="sr-close ghost icon" aria-label="Close">${icon('close')}</button></header>
      <div class="sr-main">
        <div class="sr-stage"><canvas></canvas>
          <div class="sr-hints"><span>${icon('360')}Drag to rotate</span><span>${icon('zoomin')}Zoom in / out</span></div></div>
        <aside class="sr-panel">
          <div class="sr-make"><span class="sr-badge"></span><div><small class="sr-maker"></small><b class="sr-model"></b><i class="sr-rarity"></i></div></div>
          <div class="sr-price">${icon('cash')}<b></b><em></em></div>
          <dl class="sr-stats"></dl>
          <button class="sr-go primary"><svg class="ic"><use href="#i-wheel"/></svg><span></span>${icon('chev')}</button>
          <p class="sr-note"></p>
        </aside>
      </div>
      <div class="sr-tabs"><button data-k="all">All</button><button data-k="road">Sports cars</button><button data-k="4x4">Off-road</button><span class="sr-count"></span></div>
      <div class="sr-rail"><button class="sr-arrow" data-d="-1" aria-label="Previous">${icon('chevl')}</button><div class="sr-cards"></div><button class="sr-arrow" data-d="1" aria-label="Next">${icon('chev')}</button></div>
    </div>`;
    this.$ = (s) => el.querySelector(s);
    this.view = new TruckView(this.$('.sr-stage canvas'), { showroom: true });
    this.kind = 'all';
    this.$('.sr-close').onclick = () => this.close();
    el.querySelectorAll('.sr-tabs button').forEach((b) => { b.onclick = () => { this.kind = b.dataset.k; this.rail(); }; });
    el.querySelectorAll('.sr-arrow').forEach((b) => { b.onclick = () => this.step(+b.dataset.d); });
    this.keys = (e) => {
      if (this.el.classList.contains('hidden')) return;
      if (e.key === 'ArrowRight') { this.step(1); e.preventDefault(); } else if (e.key === 'ArrowLeft') { this.step(-1); e.preventDefault(); } else if (e.key === 'Escape') { this.close(); e.preventDefault(); e.stopPropagation(); }
    };
    addEventListener('keydown', this.keys, true);
  }

  /**
   * Open it. o: { title, current (the car in use), paint (#hex), builds ({ id: code }), owns(id), action(id) ->
   * { label, enabled, run, note } (what the button does for that car), onClose }.
   */
  open(o) {
    this.o = o;
    this.$('.sr-title h2').textContent = o.title;
    this.el.classList.remove('hidden');
    this.kind = TRUCKS[o.current]?.road ? 'road' : 'all';
    delete this.$('.sr-cards').dataset.kind;            // (the cards again: which car is in use may have changed)
    this.look(o.current, true);
  }

  close() {
    if (this.el.classList.contains('hidden')) return;
    this.el.classList.add('hidden');
    this.view.stop();
    this.o?.onClose?.();
  }

  /** The cars on the rail now: by kind, the sports cars after the 4x4s, each cheapest first. */
  ids() {
    return DEALER_ORDER.filter((id) => TRUCKS[id] && (this.kind === 'all' || (this.kind === 'road') === !!TRUCKS[id].road))
      .sort((a, b) => FEATURED.includes(b) - FEATURED.includes(a) || !!TRUCKS[a].road - !!TRUCKS[b].road);
  }

  step(d) {
    const ids = this.ids(), i = ids.indexOf(this.id);
    this.look(ids[(i + d + ids.length) % ids.length] || ids[0]);
  }

  /** Show car id: in 3D, its details, the button for it, and it picked on the rail. */
  look(id, scroll = false) {
    const o = this.o, t = TRUCKS[id];
    if (!t) return;
    this.id = id;
    this.view.show(id, o.builds?.[id] || '', o.paint);
    const [maker, model] = makeAndModel(t.name), price = TRUCK_PRICES[id] ?? 0, r = rarity(price);
    const badge = this.$('.sr-badge'), bt = BADGE[maker] || (maker || model.split(' ')[0]).toUpperCase();
    badge.textContent = bt;
    badge.style.fontSize = `${bt.length <= 3 ? 13 : bt.length <= 5 ? 11 : 9}px`;
    this.$('.sr-maker').textContent = maker;
    this.$('.sr-model').textContent = model;
    const rt = this.$('.sr-rarity'); rt.textContent = r; rt.className = 'sr-rarity ' + r;
    this.$('.sr-price b').textContent = money(price);
    this.$('.sr-price em').textContent = o.owns(id) ? 'Yours' : '';
    // the maker's figures: power and torque, and for a road car its sprint and its top speed; for a 4x4 how high it
    // clears and how deep it wades (the game's own measures of the stock truck)
    const st = buildStats(truckSpec(id)), hp = Math.round(st.powerKw * 1.341);
    const rows = [['engine', 'Horsepower', `${hp} HP`], ['bolt', 'Torque', `${Math.round(st.peakTorque)} Nm`]];
    if (t.road && t.real) rows.push(['timer', '0 – 100 km/h', `${t.real.t100} s`], ['target', 'Top speed', `${t.real.vmax} km/h`]);
    else rows.push(['ground', 'Ground clearance', `${Math.round(st.clearance * 100)} cm`], t.float ? ['water', 'Deep water', `Floats, ${Math.round(t.float.speed * 3.6)} km/h`] : ['water', 'Wading depth', `${Math.round(st.wading * 100)} cm`]);
    rows.push(['axle', 'Drivetrain', (t.trans?.drive || '4wd').toUpperCase()]);
    this.$('.sr-stats').innerHTML = rows.map(([i, k, v]) => `<div>${icon(i)}<dt>${k}</dt><dd>${v}</dd></div>`).join('');
    const a = o.action(id), go = this.$('.sr-go');
    go.querySelector('span').textContent = a.label;
    go.disabled = !a.enabled;
    go.onclick = () => { if (a.enabled) a.run(); };
    this.$('.sr-note').textContent = a.note || t.blurb;
    this.rail(scroll);
  }

  /** The rail of cards: every car of the kind picked, the one shown marked. */
  rail(scroll = true) {
    const box = this.$('.sr-cards'), ids = this.ids();
    this.el.querySelectorAll('.sr-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === this.kind));
    this.$('.sr-count').textContent = `${ids.length} vehicles`;
    if (box.dataset.kind !== this.kind) {
      box.dataset.kind = this.kind;
      box.innerHTML = ids.map((id) => {
        const t = TRUCKS[id], r = rarity(TRUCK_PRICES[id] ?? 0);
        return `<button class="sr-c" data-id="${id}"><span class="sr-thumb" style="background-image:url(/assets/thumbs/${id}.webp)"></span>
          <b>${t.name}</b><i class="sr-rarity ${r}">${r}</i>${id === this.o.current ? '<em>Driving</em>' : ''}${FEATURED.includes(id) ? '<u class="sr-feat">Featured</u>' : ''}</button>`;
      }).join('');
      box.querySelectorAll('.sr-c').forEach((c) => { c.onclick = () => this.look(c.dataset.id); });
    }
    let on = null;
    box.querySelectorAll('.sr-c').forEach((c) => { c.classList.toggle('on', c.dataset.id === this.id); if (c.dataset.id === this.id) on = c; });
    if (on && scroll) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  /** Mark another car as the one in use (its card says so). */
  setCurrent(id) { this.o.current = id; delete this.$('.sr-cards').dataset.kind; this.look(this.id); }
}
