// The phone (T, d-pad up, or PHONE in the pause menu): GTA-style, for the Kerala map, which is over 30 km across.
//   AUTO-RICKSHAW  a ride to any town around Kannur, paid by the km (the screen fades while the town streams in)
//   MECHANIC       Raju brings your car to the nearest road when you've left it behind, or fixes it where it stands
//   MASKS          Theyyam mask progress; set the GPS to the town where the nearest one is hidden
//   RADIO          pick a station
//   CAMERA         photo mode
// The game is paused while the phone is open (mode 'paused', ui.current 'phone'); a ride runs in mode 'travel'.
import { STATIONS } from '../audio/RadioSongs.js';
import { formatMoney } from '../core/util.js';
import { Collectibles } from '../world/Collectibles.js';
import { KeralaJobs } from '../world/KeralaJobs.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const RANK = { city: 0, town: 1, suburb: 2 };
const FARE_BASE = 30, FARE_KM = 12, TOW = 150, TRIP_MAX = 45000; // (ms of real time: tiles stream in real time, and slow frames clamp dt)

export class Phone {
  constructor(game) { this.game = game; this.trip = null; this.tow = null; }

  get available() { return !!this.game.world.kerala; }

  // why a ride (or the mechanic) can't come now, or null
  _busy() {
    const g = this.game;
    if (g.police?.inPursuit) return 'Not with the police on your tail';
    if (g.story?.active) return 'Not in the middle of a job';
    if (g.races?.active) return 'Not during a race';
    if (g.onFoot?.inter?.busy || g.onFoot?.seq) return 'Wait a moment';
    if (g.interiors?.active) return 'Step outside first';
    if (g.boatRide?.active) return 'Go ashore first';
    return null;
  }

  // the towns a ride goes to: cities, towns and suburbs, one per name, nearest first
  towns() {
    const g = this.game, f = g.focusState, seen = new Set(), out = [];
    const P = (g.world.index?.places || []).filter((p) => RANK[p[0]] !== undefined)
      .map((p) => ({ name: String(p[1]).split(';')[0], kind: p[0], x: -p[3], z: p[4] }))
      .map((o) => ({ ...o, d: Math.hypot(o.x - f.x, o.z - f.z) }))
      .filter((o) => o.d > 1200 && o.d < 40000)
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.d - b.d);
    for (const o of P) { if (seen.has(o.name)) continue; seen.add(o.name); out.push(o); if (out.length >= 12) break; }
    return out.sort((a, b) => a.d - b.d);
  }
  fare(d) { return Math.round(FARE_BASE + FARE_KM * d / 1000); }

  // further afield, Kerala's cities by train (Kozhikode, Kochi, Thiruvananthapuram...): your car rides along
  cities() {
    const f = this.game.focusState, seen = new Set();
    return (this.game.world.index?.places || []).filter((p) => p[0] === 'city')
      .map((p) => ({ name: String(p[1]).split(';')[0], kind: 'city', x: -p[3], z: p[4], train: true }))
      .map((o) => ({ ...o, d: Math.hypot(o.x - f.x, o.z - f.z) }))
      .filter((o) => o.d >= 40000 && !seen.has(o.name) && seen.add(o.name))
      .sort((a, b) => a.d - b.d);
  }
  trainFare(d) { return Math.round(80 + 2 * d / 1000); }

  // ------------------------------------------------------------------ screens
  open() {
    const g = this.game;
    if (!this.available || g.state.mode !== 'drive' || this.trip) return false;
    g.state.mode = 'paused';
    g.audio.setPaused(true);
    g.audio?.playEvent?.('uiClick');
    this.home();
    return true;
  }
  close() { this.game.resume(); }

  _screen(title, items, onBack, foot = '') {
    const ui = this.game.ui;
    ui.clear();
    const s = h('div', 'screen phone-screen');
    const ph = h('div', 'phone');
    const now = this.game.env?.hour ?? 12, hh = Math.floor(now), mm = Math.floor((now - hh) * 60);
    ph.appendChild(h('div', 'phone-bar', `<span>${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span><span>NIGHTSHIFT</span><span>${formatMoney(this.game.save.data.cash)}</span>`));
    ph.appendChild(h('div', 'phone-title', title));
    const list = h('div', 'phone-list');
    const btns = items.map((it) => {
      const b = h('button', 'phone-item' + (it.off ? ' off' : '') + (it.on ? ' on' : ''), `<b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}`);
      if (it.icon) b.prepend(h('span', 'phone-icon', it.icon));
      if (it.color) b.style.setProperty('--app', it.color);
      b.onclick = () => { if (it.off) { ui.toast(it.off, 'err', 2); return; } it.fn(); };
      list.appendChild(b);
      return b;
    });
    ph.appendChild(list);
    ph.appendChild(h('div', 'phone-foot', foot || (document.documentElement.classList.contains('touch') ? 'tap an app' : '↑↓ choose · ENTER open · ESC hang up')));
    s.appendChild(ph);
    ui.screens.appendChild(s);
    ui.current = 'phone';
    ui._menuNav(btns, onBack);
  }

  home() {
    const g = this.game, busy = this._busy(), m = this._masks();
    const st = STATIONS[g.audio.radioStation];
    this._screen('PHONE', [
      { icon: '🛺', label: 'Travel', sub: 'auto-rickshaw to towns · trains to cities', color: '#ffd23d', off: busy, fn: () => this.travel() },
      { icon: '💼', label: 'Jobs', sub: this._jobs()?.working ? `working: ${this._jobs().kind === 'taxi' ? 'taxi fares' : 'parcels'}` : 'taxi fares · parcels', color: '#3dff9a', fn: () => this.jobs() },
      { icon: '🔧', label: 'Mechanic', sub: this._mechSub(), color: '#7fd3ff', off: busy, fn: () => this.mechanic() },
      { icon: '🎭', label: 'Theyyam masks', sub: m ? `${m.count}/${m.places.length} found` : 'not here', color: '#ff6a3d', fn: () => this.masks() },
      { icon: '📻', label: 'Radio', sub: st?.name, color: st?.color, fn: () => this.radio() },
      { icon: '📷', label: 'Camera', sub: 'photo mode', color: '#c9a0ff', off: g.races?.active ? 'Not during a race' : null, fn: () => { g.resume(); g.photo.enter(); } },
    ], () => this.close());
  }

  travel() {
    const T = this.towns(), cash = this.game.save.data.cash;
    const items = T.map((o) => {
      const fare = this.fare(o.d);
      return { label: o.name, sub: `${(o.d / 1000).toFixed(1)} km · ${formatMoney(fare)}`, off: cash < fare ? `The fare is ${formatMoney(fare)}` : null, fn: () => this.ride(o, fare) };
    });
    if (!items.length) items.push({ label: 'No towns in reach', off: 'Nowhere to go from here', fn: () => {} });
    for (const o of this.cities()) {
      const fare = this.trainFare(o.d);
      items.push({ icon: '🚆', label: o.name, sub: `train · ${Math.round(o.d / 1000)} km · ${formatMoney(fare)}${this.game.onFoot?.active ? '' : ' · car rides along'}`, color: '#7fd3ff', off: cash < fare ? `The ticket is ${formatMoney(fare)}` : null, fn: () => this.ride(o, fare) });
    }
    this._screen('TRAVEL', items, () => this.home(), 'auto-rickshaw by the km · trains to the cities · BACK');
  }

  _masks() { const g = this.game; return g.world.index ? (g.masks ||= new Collectibles(g)) : null; }

  _jobs() { const g = this.game; return g.world.index ? (g.jobs ||= new KeralaJobs(g)) : null; }

  jobs() {
    const g = this.game, J = this._jobs(), st = J?.stats || {}, items = [];
    if (J?.working) items.push({ label: 'Stop working', sub: J.streak ? `streak ${J.streak}` : 'end the shift', color: '#ff3d5a', fn: () => { J.stop(); g.resume(); } });
    const why = J?.why();
    items.push({ label: 'Taxi fares', sub: 'pick up passengers, drive them to town', color: '#ffd23d', on: J?.kind === 'taxi', off: why || (g.player?.p?.bike ? 'No room for a passenger on a bike' : null), fn: () => { g.resume(); J.begin('taxi'); } });
    items.push({ label: 'Parcel delivery', sub: 'against the clock; mind the goods', color: '#ff8a3d', on: J?.kind === 'parcel', off: why, fn: () => { g.resume(); J.begin('parcel'); } });
    items.push({ label: `${st.fares || 0} fares · ${st.parcels || 0} parcels`, sub: `earned ${formatMoney(st.earned || 0)} · best streak ${st.best || 0}`, off: 'Your record', fn: () => {} });
    this._screen('JOBS', items, () => this.home(), 'jobs run back to back · BACK to go back');
  }

  _mechSub() {
    const g = this.game, v = g.player;
    if (!v || v.gone) return 'no car';
    if (g.onFoot?.active) { const f = g.focusState, d = Math.hypot(v.state.x - f.x, v.state.z - f.z); return d > 40 ? `your car is ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'} away` : 'your car is right here'; }
    return (v.state.damage || 0) > 0.02 ? `repairs ${formatMoney(this._repairCost())}` : 'your car is fine';
  }
  _repairCost() { return Math.max(100, Math.round((this.game.player.state.damage || 0) * 2000 / 10) * 10); }

  mechanic() {
    const g = this.game, v = g.player, cash = g.save.data.cash, items = [];
    if (g.onFoot?.active && v && !v.gone) {
      const f = g.focusState, d = Math.hypot(v.state.x - f.x, v.state.z - f.z);
      items.push({ label: 'Bring my car', sub: d > 40 ? `${formatMoney(TOW)} · Raju drives it over` : 'it is right here', off: d <= 40 ? 'Your car is right here' : cash < TOW ? `It costs ${formatMoney(TOW)}` : this.tow ? 'Raju is already on his way' : null, fn: () => this.bring() });
    }
    if (v && !v.gone && !g.onFoot?.active) {
      const dmg = v.state.damage || 0, cost = this._repairCost();
      items.push({ label: 'Fix my car', sub: dmg > 0.02 ? formatMoney(cost) : 'nothing to fix', off: dmg <= 0.02 ? 'Your car is fine' : cash < cost ? `Repairs cost ${formatMoney(cost)}` : Math.hypot(v.state.vx, v.state.vz) > 2 ? 'Stop the car first' : null, fn: () => this.repair(cost) });
    }
    if (!items.length) items.push({ label: 'Nothing to do', off: 'No car to look at', fn: () => {} });
    this._screen('RAJU · MECHANIC', items, () => this.home());
  }

  masks() {
    const g = this.game, m = this._masks(), items = [];
    const hint = m?.hint();
    if (hint) items.push({ label: `Nearest: ${hint.name}`, sub: `${hint.km.toFixed(1)} km · set the GPS`, fn: () => { const p = m.places.find((q) => q.name === hint.name && !m.found[q.id]); if (p) g.setGPS(p.x, p.z); g.resume(); g.ui.toast(`GPS set to ${hint.name}: the mask is beside the road near the centre`, '', 4); } });
    else items.push({ label: m ? 'All masks found!' : 'Drive around Kannur first', off: 'Nothing to find', fn: () => {} });
    const done = m ? Object.values(m.found).slice(-5).reverse() : [];
    for (const f of done) items.push({ label: f.place, sub: 'found', on: true, off: 'Already found', fn: () => {} });
    this._screen(`MASKS · ${m?.count ?? 0}/${m?.places.length ?? 50}`, items, () => this.home(), 'one mask in each of 50 towns · BACK to go back');
  }

  radio() {
    const g = this.game, cur = g.audio.radioStation;
    const items = STATIONS.map((st, i) => ({ label: st.name, sub: st.genre || 'silence', color: st.color, on: i === cur, fn: () => {
      g.settings.audio.radio = g.audio.setRadioStation(i, false) ?? i; g.settings.save?.();
      this.radio(); g.ui.focusIdx = i; g.ui._focus();
    } }));
    this._screen('RADIO', items, () => this.home(), 'N / , change station while driving');
    g.ui.focusIdx = cur; g.ui._focus();
  }

  // ------------------------------------------------------------------ mechanic
  repair(cost) {
    const g = this.game;
    g.save.addCash(-cost, 'repair');
    g.player.state.damage = 0;
    g.player.renderer?.repair?.();
    g.audio?.playEvent?.('purchase');
    g.resume();
    g.ui.toast(`Raju fixed your car: ${formatMoney(cost)}`, 'cash', 3);
  }

  // the car arrives a few seconds later on the nearest road, a little way along from you
  bring() {
    const g = this.game;
    g.save.addCash(-TOW, 'mechanic');
    this.tow = { t: 6 };
    g.resume();
    g.ui.toast('Raju is bringing your car', '', 3);
  }
  _deliver() {
    const g = this.game, w = g.world, v = g.player, f = g.focusState;
    if (!g.onFoot?.active || !v || v.gone) return;
    const r = w.roadSpot(f.x, f.z, 6);
    if (!r) { g.ui.toast('Raju could not find a road near you', 'err', 3); g.save.addCash(TOW, 'refund'); return; }
    const fx = Math.sin(r.yaw), fz = Math.cos(r.yaw);
    let spot = null;
    for (const along of [10, -10, 16, -16, 6, -6, 22]) {
      const x = r.x + fx * along, z = r.z + fz * along;
      if (Math.hypot(x - f.x, z - f.z) > 4 && w.onCarriageway?.(x, z) !== false) { spot = { x, z }; break; }
    }
    spot ||= { x: r.x, z: r.z };
    v.place(spot.x, spot.z, r.yaw);
    g.audio?.playEvent?.('horn', { position: { x: spot.x, y: 0.5, z: spot.z } });
    g.ui.toast(`Your car is here${r.name ? ' on ' + r.name : ''}`, 'cash', 3);
  }

  // ------------------------------------------------------------------ the ride
  ride(o, fare) {
    const g = this.game;
    g.ui.clear();
    g.save.addCash(-fare, 'auto-rickshaw');
    const foot = !!g.onFoot?.active;
    this.trip = { o, foot, t: 0, fare, t0: performance.now() };
    const veil = this.veil = h('div', 'travel-veil', `<div><span>${o.train ? '🚆 TRAIN' : foot ? '🛺 AUTO-RICKSHAW' : '🛣 DRIVING'} TO</span><b>${o.name.toUpperCase()}</b><small>${(o.d / 1000).toFixed(o.train ? 0 : 1)} km · ${formatMoney(fare)}</small></div>`);
    document.body.appendChild(veil);
    requestAnimationFrame(() => veil.classList.add('in'));
    g.state.mode = 'travel';
    g.audio.setPaused(true);
    document.getElementById('hud')?.classList.add('hidden');
    // set down on the town's centre now: the world streams round you while the screen is dark
    // (a car is held where it is until its ground is built; physics doesn't run during the ride)
    this._put(o.x, o.z, 0);
  }

  _put(x, z, yaw) {
    const g = this.game;
    if (this.trip.foot) {
      const s = g.onFoot.state; s.x = x; s.z = z; s.y = g.world.groundHeight?.(x, z, s.y) ?? s.y; s.yaw = yaw; s.vx = s.vz = 0; g.onFoot.camYaw = yaw;
    } else g.player.place(x, z, yaw);
  }

  update(dt) {
    const g = this.game;
    if (this.tow && g.state.mode === 'drive' && (this.tow.t -= dt) <= 0) { this.tow = null; this._deliver(); }
    const T = this.trip;
    if (!T || g.state.mode !== 'travel') return;
    T.t += dt;
    const w = g.world, o = T.o;
    g.camera.position.set(o.x, (w.groundHeight?.(o.x, o.z) ?? 0) + 60, o.z + 40);
    g.camera.lookAt(o.x, 0, o.z);
    if (T.t < 1.2) return; // the fade
    if (!w.groundKnown(o.x, o.z, 40) && performance.now() - T.t0 < TRIP_MAX) return;
    const r = w.roadSpot(o.x, o.z, 5) || w.roadSpot(o.x, o.z, 7);
    if (r) {
      let x = r.x, z = r.z;
      if (T.foot) {
        const sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw);
        for (const off of [5, 7, 9, 4]) for (const side of [1, -1]) { const px = r.x + sx * off * side, pz = r.z + sz * off * side; if (w.offCarriageway(px, pz, 0.6) && !w.inWater(px, pz)) { x = px; z = pz; break; } }
      }
      this._put(x, z, r.yaw);
    }
    this.trip = null;
    g.state.mode = 'drive';
    g.audio.setPaused(false);
    document.getElementById('hud')?.classList.remove('hidden');
    if (!T.foot) g.camCtl.snap(g.player);
    else g.onFoot.camPos.set(g.onFoot.state.x - Math.sin(g.onFoot.state.yaw) * 4, g.onFoot.state.y + 2, g.onFoot.state.z - Math.cos(g.onFoot.state.yaw) * 4);
    g.audio?.playEvent?.('checkpoint');
    const veil = this.veil; this.veil = null;
    veil?.classList.remove('in'); setTimeout(() => veil?.remove(), 900);
    g.hud?.message?.(o.name.toUpperCase(), r?.name ? `${r.name}` : 'welcome', 3);
  }
}
