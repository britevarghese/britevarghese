// Empire (GTA-style): properties for sale around Port Halvern and repeatable odd jobs.
// - Safehouses: rest there (saves, skips a few hours) and you respawn at the nearest one you own.
// - Businesses: pay their income into your account every few minutes of play; some also pay extra for
//   the matching odd job (Halvern Cabs: taxi fares, Ironworks Freight: courier runs, Pier 7: exports).
// - Odd jobs: taxi fares, courier runs and car exports, started at their stands. They run through the
//   story mission engine (Story.js) as generated, repeatable missions.
// Walk or drive up to a marker: FOR SALE signs show the price; press E to buy / rest / start a job.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { formatMoney } from '../core/util.js';
import { CARS } from '../vehicles/VehicleCatalog.js';
import { EDGE, DISTRICT_NAMES, district } from './CityLayout.js';

export const INCOME_PERIOD = 240; // seconds of play between business payouts

export const PROPERTIES = [
  // safehouses
  { id: 'market_flat', kind: 'safehouse', name: 'Market Street Apartment', x: -320, z: -480, price: 25000, blurb: 'A one-room walk-up above a noodle bar. Home.' },
  { id: 'elm_house', kind: 'safehouse', name: 'Elm Heights House', x: -720, z: 560, price: 60000, blurb: 'Lawn, driveway, nosy neighbours.' },
  { id: 'skyline_penthouse', kind: 'safehouse', name: 'Skyline Penthouse', x: 80, z: 160, price: 250000, blurb: 'Forty floors above downtown. Private lift.' },
  { id: 'hill_villa', kind: 'safehouse', name: 'Hillside Villa', x: -720, z: 160, price: 450000, blurb: 'Glass, concrete and a view of the whole city.' },
  // businesses
  { id: 'car_wash', kind: 'business', name: 'Sparkle Car Wash', x: -560, z: -160, price: 55000, income: 1200, blurb: 'Cash business. Very cash.' },
  { id: 'taxi_co', kind: 'business', name: 'Halvern Cabs', x: 160, z: 480, price: 90000, income: 2000, boost: 'taxi', blurb: 'Twelve cabs, one dispatcher. Taxi fares pay 50% more.' },
  { id: 'club_neon', kind: 'business', name: 'Club Neon', x: -160, z: 240, price: 150000, income: 3500, blurb: 'The loudest room in Port Halvern.' },
  { id: 'freight', kind: 'business', name: 'Ironworks Freight', x: 880, z: 80, price: 180000, income: 4000, boost: 'courier', blurb: 'Trucks, forklifts, no questions. Courier runs pay 50% more.' },
  { id: 'pier7', kind: 'business', name: 'Pier 7 Export', x: 800, z: -720, price: 260000, income: 5500, boost: 'export', blurb: 'Containers leave every night. Car exports pay 50% more.' },
  { id: 'grand_hotel', kind: 'business', name: 'Grand Halvern Hotel', x: -80, z: -160, price: 600000, income: 12000, blurb: 'Two hundred rooms and a rooftop bar.' },
];
export const PROPERTY_BY_ID = Object.fromEntries(PROPERTIES.map((p) => [p.id, p]));

// odd-job stands (free, always open)
export const JOBS = [
  { id: 'taxi', name: 'Cab Rank', label: 'TAXI FARES', x: 240, z: 480, color: '#ffd23d', desc: 'Pick up passengers and drive them across town against the clock.' },
  { id: 'courier', name: 'Freight Depot', label: 'COURIER RUNS', x: 880, z: 240, color: '#3dffc8', desc: 'Collect three parcels around the city and bring them back in time.' },
  { id: 'export', name: 'Export Yard', label: 'CAR EXPORTS', x: 800, z: -560, color: '#ff7a3d', desc: 'Find the car on the list, steal it and deliver it in good condition.' },
];

const PASSENGERS = [
  ['A banker', "Financial district, and step on it. I'm late for a very boring meeting."],
  ['A tourist', 'Hi! Take me somewhere nice? I have this address on a napkin.'],
  ['A nurse', 'Double shift. Please just get me home in one piece.'],
  ['A club kid', "Yo! The party's across town, let's GO."],
  ['A lawyer', "Don't talk. Drive. I bill by the minute, you don't."],
  ['A chef', "The restaurant's on fire. Metaphorically. Hurry."],
  ['A student', 'Exam in twenty minutes. I have not studied. Floor it.'],
  ['A musician', "Careful with the guitar. It's older than you."],
];

const COL = { sale: 0x3dff9a, owned: 0x37e2ff };

function sign(lines, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(8,10,14,0.82)'; x.fillRect(0, 0, 512, 160);
  x.fillStyle = color; x.fillRect(0, 0, 512, 10);
  x.textAlign = 'center';
  x.fillStyle = color; x.font = '700 44px Segoe UI, Arial'; x.fillText(lines[0], 256, 68);
  x.fillStyle = '#fff'; x.font = '600 36px Segoe UI, Arial'; x.fillText(lines[1] || '', 256, 122);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set(3.6, 1.125, 1);
  return s;
}

export class Empire {
  constructor(game) {
    this.game = game;
    const d = game.save.data;
    d.empire ??= { owned: {}, incomeT: 0, earned: 0, jobs: {} };
    this.markers = {};
    this.promptHtml = null;
    this.streak = 0;
  }
  get data() { return this.game.save.data.empire; }
  owns(id) { return !!this.data.owned[id]; }
  owned(kind) { return PROPERTIES.filter((p) => this.owns(p.id) && (!kind || p.kind === kind)); }
  boost(job) { return PROPERTIES.some((p) => p.boost === job && this.owns(p.id)) ? 1.5 : 1; }

  // a pavement spot beside the nearest traffic lane (like the story contacts stand on)
  sidewalk(x, z) {
    const g = this.game, lane = g._laneSpot(x, z);
    const rx = -Math.cos(lane.yaw), rz = Math.sin(lane.yaw);
    let px = lane.x, pz = lane.z;
    for (let d = 3; d < 12; d += 0.5) {
      const qx = lane.x + rx * d, qz = lane.z + rz * d;
      if (!g.onFoot._free(qx, qz)) break;
      px = qx; pz = qz;
      if (g.world.layout.groundHeight(qx, qz) > 0.05 && d > 5) break;
    }
    return { x: px, z: pz, y: g.world.layout.groundHeight(px, pz), lane, face: Math.atan2(-rx, -rz) };
  }

  _marker(item, isJob) {
    if (this.markers[item.id]) return this.markers[item.id];
    const g = this.game, spot = this.sidewalk(item.x, item.z);
    const grp = new THREE.Group();
    grp.position.set(spot.x, spot.y, spot.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.0, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.06;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 30, 12, 1, true).translate(0, 15, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    grp.add(ring, beam);
    g.scene.add(grp);
    const m = { item, isJob, spot, grp, ring, beam, sign: null, signKey: '' };
    this.markers[item.id] = m;
    return m;
  }

  _refreshSign(m) {
    const it = m.item, own = !m.isJob && this.owns(it.id);
    const key = m.isJob ? 'job' : own ? 'own' : 'sale';
    if (m.signKey === key) return;
    m.signKey = key;
    if (m.sign) { m.grp.remove(m.sign); m.sign.material.map.dispose(); m.sign.material.dispose(); }
    const color = m.isJob ? it.color : own ? '#37e2ff' : '#3dff9a';
    m.sign = sign(m.isJob ? [it.label, it.name] : own ? [it.name, it.kind === 'safehouse' ? 'SAFEHOUSE' : 'YOUR BUSINESS'] : ['FOR SALE', `${it.name} · ${formatMoney(it.price)}`], color);
    m.sign.position.y = 3.2;
    m.grp.add(m.sign);
    const c = new THREE.Color(m.isJob ? it.color : own ? COL.owned : COL.sale);
    m.ring.material.color.copy(c); m.beam.material.color.copy(c);
    m.beam.visible = !own;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, input, driving) {
    const g = this.game;
    this.promptHtml = null;
    if (!g.traffic?.graph) return;
    const f = g.focusState, t = performance.now() / 1000;
    for (const p of PROPERTIES) this._marker(p, false);
    for (const j of JOBS) this._marker(j, true);
    const busy = g.story?.active || g.races?.active || g.police?.inPursuit;
    for (const m of Object.values(this.markers)) {
      this._refreshSign(m);
      const d = Math.hypot(m.spot.x - f.x, m.spot.z - f.z);
      m.grp.visible = d < 700;
      m.ring.material.opacity = 0.55 + Math.sin(t * 3) * 0.25;
      if (m.sign) m.sign.visible = d < 120;
    }
    // business income, paid while you play
    if (driving && this.owned('business').length) {
      this.data.incomeT = (this.data.incomeT || 0) + dt;
      if (this.data.incomeT >= INCOME_PERIOD) {
        this.data.incomeT = 0;
        const total = this.owned('business').reduce((a, p) => a + p.income, 0);
        this.data.earned = (this.data.earned || 0) + total;
        g.save.addCash(total, 'business');
        g.ui.toast(`Business income: <b>${formatMoney(total)}</b> from ${this.owned('business').length} business${this.owned('business').length > 1 ? 'es' : ''}`, 'cash', 5);
        g.audio?.playEvent('purchase');
      }
    }
    if (!driving || busy) return;
    const sp = Math.hypot(f.vx || 0, f.vz || 0), onFoot = g.onFoot.active;
    for (const m of Object.values(this.markers)) {
      const d = Math.hypot(m.spot.x - f.x, m.spot.z - f.z);
      if (d > (onFoot ? 3.2 : 9) || sp > 4) continue;
      const it = m.item, key = '<span class="key">E</span> / <span class="key">A</span>';
      if (m.isJob) {
        const boost = this.boost(it.id) > 1 ? ' · <span style="color:#3dff9a">+50% (you own the business)</span>' : '';
        this.promptHtml = `<b style="color:${it.color}">${it.label}</b> · ${it.desc}${boost} · press ${key}`;
        if (input.consume('event')) this.startJob(it.id);
      } else if (this.owns(it.id)) {
        if (it.kind === 'safehouse') {
          this.promptHtml = `<b style="color:#37e2ff">${it.name}</b> · press ${key} to rest (saves the game, passes 6 hours)`;
          if (input.consume('event')) this.rest(it);
        } else this.promptHtml = `<b style="color:#37e2ff">${it.name}</b> · yours · ${formatMoney(it.income)} every ${INCOME_PERIOD / 60} min`;
      } else {
        const cash = g.save.data.cash, afford = cash >= it.price;
        const what = it.kind === 'safehouse' ? 'safehouse · respawn point, rest & save' : `business · ${formatMoney(it.income)} every ${INCOME_PERIOD / 60} min`;
        this.promptHtml = `<b style="color:#3dff9a">FOR SALE · ${it.name}</b> · ${what} · <b>${formatMoney(it.price)}</b> · ${afford ? `press ${key} to buy` : `<span style="color:#ff5d5d">you have ${formatMoney(cash)}</span>`}`;
        if (afford && input.consume('event')) this.buy(it.id);
      }
      break;
    }
  }
  late() { if (this.promptHtml) this.game.hud.setPrompt(this.promptHtml); }

  buy(id) {
    const g = this.game, p = PROPERTY_BY_ID[id];
    if (!p || this.owns(id) || g.save.data.cash < p.price) return false;
    g.save.data.cash -= p.price;
    this.data.owned[id] = { at: Date.now() };
    g.save.addCash(0, 'property');
    g.save.save();
    g.hud.message('PROPERTY PURCHASED', `${p.name.toUpperCase()} · ${formatMoney(p.price)}`, 4);
    g.audio?.playEvent('purchase');
    g.ui.toast(p.kind === 'safehouse' ? `${p.name} is yours. You'll wake up here after a bust; rest here to save.` : `${p.name} is yours: ${formatMoney(p.income)} lands in your account every ${INCOME_PERIOD / 60} minutes.${p.boost ? ` ${p.blurb.split('. ').pop()}` : ''}`, 'cash', 7);
    bus.emit('empire:buy', { id });
    return true;
  }

  rest(p) {
    const g = this.game, env = g.env;
    if (env.mode === 'cycle') env.hour = (env.hour + 6) % 24;
    g.player.state.damage = 0; g.player.renderer.repair?.();
    g.save.save();
    g.hud.message('GAME SAVED', `${p.name.toUpperCase()} · RESTED 6 HOURS`, 3);
  }

  // respawn point after a bust: the nearest safehouse you own
  respawnSpot(x, z) {
    const own = this.owned('safehouse');
    if (!own.length) return null;
    own.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    return { x: own[0].x, z: own[0].z, name: own[0].name };
  }

  blips() {
    const out = [];
    for (const p of PROPERTIES) out.push({ x: p.x, z: p.z, color: this.owns(p.id) ? '#37e2ff' : '#3dff9a', r: this.owns(p.id) ? 4 : 3.5, label: this.owns(p.id) ? p.name : `${p.name} $${p.price >= 1e6 ? (p.price / 1e6).toFixed(1) + 'M' : Math.round(p.price / 1000) + 'k'}` });
    for (const j of JOBS) out.push({ x: j.x, z: j.z, color: j.color, r: 4, label: j.label.split(' ')[0] });
    return out;
  }

  // ------------------------------------------------------------------ odd jobs
  _randomSpot(fromX, fromZ, dMin, dMax) {
    const nodes = this.game.world.layout.nodes.filter((n) => n.type === 'grid' && Math.abs(n.x) <= EDGE && Math.abs(n.z) <= EDGE);
    for (let i = 0; i < 60; i++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      // somewhere along a block, not in the middle of the junction
      const ax = Math.random() < 0.5;
      const x = n.x + (ax ? (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60) : 0), z = n.z + (ax ? 0 : (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 60));
      if (Math.abs(x) > EDGE || Math.abs(z) > EDGE) continue;
      const d = Math.hypot(x - fromX, z - fromZ);
      if (d >= dMin && d <= dMax) return { x, z };
    }
    return { x: fromX + dMin, z: fromZ };
  }
  where(x, z) { return DISTRICT_NAMES[district(x, z)] || 'town'; }

  startJob(kind) {
    const g = this.game, f = g.focusState;
    const job = JOBS.find((j) => j.id === kind);
    const m = { id: `job_${kind}`, title: job.label, job: { kind }, steps: [] };
    if (kind === 'taxi') {
      const a = this._randomSpot(f.x, f.z, 120, 520), b = this._randomSpot(a.x, a.z, 450, 1200);
      const [who, line] = PASSENGERS[Math.floor(Math.random() * PASSENGERS.length)];
      const dist = Math.hypot(b.x - a.x, b.z - a.z) * 1.3;
      const time = Math.round(dist / 13 + 30);
      m.steps = [
        { type: 'goto', to: a, stop: true, inVehicle: true, ped: 'pickup', text: `Pick up the <b>passenger</b> in ${this.where(a.x, a.z)}.` },
        { type: 'call', lines: [[who, line]] },
        { type: 'goto', to: b, stop: true, inVehicle: true, ped: 'drop', time, text: `Drive the passenger to <b>${this.where(b.x, b.z)}</b>.` },
      ];
      m.pay = () => Math.round((180 + dist * 1.2) * this.boost('taxi') * (1 + Math.min(this.streak, 10) * 0.05));
    } else if (kind === 'courier') {
      const home = this.sidewalk(job.x, job.z).lane;
      const pts = [];
      let last = f;
      for (let i = 0; i < 3; i++) { const p = this._randomSpot(last.x, last.z, 250, 700); pts.push(p); last = p; }
      m.steps = [
        { type: 'collect', label: 'PARCELS', time: 210, points: pts, inVehicle: true, text: 'Collect the <b>three parcels</b> before the depot closes.' },
        { type: 'goto', to: { x: home.x, z: home.z }, stop: true, inVehicle: true, time: 120, text: 'Bring the parcels back to the <b>Freight Depot</b>.' },
      ];
      m.pay = () => Math.round(2600 * this.boost('courier'));
    } else {
      const pool = Object.values(CARS).filter((c) => c.real && !c.bike);
      const car = pool[Math.floor(Math.random() * pool.length)];
      const at = this._randomSpot(f.x, f.z, 250, 800);
      const yard = this.sidewalk(job.x, job.z).lane;
      const heat = Math.random() < 0.4 ? 0 : Math.random() < 0.7 ? 1 : 2;
      m.steps = [
        { type: 'steal', vehicle: car.id, at, heat, text: `The buyer wants a <b>${car.name}</b>. One is parked in ${this.where(at.x, at.z)}.` },
        { type: 'deliver', to: { x: yard.x, z: yard.z }, maxDamage: 0.6, text: `Deliver the <b>${car.name}</b> to the <b>Export Yard</b>. Damage cuts the price.` },
      ];
      m.pay = (story) => Math.round(Math.max(3000, car.price * 0.09 * (1 - (story.active?.vehicle?.state.damage || 0))) * this.boost('export'));
    }
    g.story.start(m);
    if (kind !== 'export' || !this.streak) g.hud.message(job.label, kind === 'taxi' && this.streak ? `FARE ${this.streak + 1}` : '', 2);
    return m;
  }

  // called by Story when a job ends
  jobDone(m, ok) {
    const kind = m.job.kind;
    this.data.jobs[kind] = (this.data.jobs[kind] || 0) + (ok ? 1 : 0);
    if (!ok) { this.streak = 0; return; }
    this.streak++;
    const g = this.game;
    // taxi and courier work keeps coming while you stay in the car
    if (kind === 'taxi' || kind === 'courier') {
      setTimeout(() => {
        if (g.state.mode !== 'drive' || g.story.active || g.onFoot.active || g.police.inPursuit) { this.streak = 0; return; }
        g.ui.toast(kind === 'taxi' ? 'Next fare incoming. Get out of the car to stop working.' : 'Another run is ready. Get out of the car to stop working.', '', 4);
        this.startJob(kind);
      }, 3500);
    } else this.streak = 0;
  }
}
