// Businesses for sale round Kannur (Kerala's answer to Port Halvern's properties): a FOR SALE board by the road near
// each town's centre, E to buy. Each pays into your account every few minutes of play; two of them also lift the
// phone jobs' pay (the auto stand: taxi fares, the courier office: parcels). The phone's BUSINESS app lists them and
// sets the GPS; Career counts them.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { formatMoney } from '../core/util.js';
import { markerBeam } from '../world/MarkerBeam.js';
import { START } from './KeralaWorld.js';

export const BIZ_PERIOD = 300; // seconds of play between payouts

export const BUSINESSES = [
  { id: 'thattukada', place: 'Kannur', name: 'Kannur Thattukada', price: 15000, income: 400, blurb: 'A night food cart: porotta, beef fry and omelettes till 2 am.' },
  { id: 'auto_stand', place: 'Talap', name: 'Talap Auto Stand', price: 60000, income: 1100, boost: 'taxi', blurb: 'Twenty autos and one very loud union. Taxi fares pay 50% more.' },
  { id: 'courier', place: 'Thavakkara', name: 'Thavakkara Couriers', price: 70000, income: 1200, boost: 'parcel', blurb: 'Vans, bikes and a ledger nobody reads. Parcel runs pay 50% more.' },
  { id: 'tea_shop', place: 'Chirakkal', name: 'Chirakkal Tea Shop', price: 25000, income: 600, blurb: 'Chaya, pazhampori and the morning\'s gossip.' },
  { id: 'toddy', place: 'Pappinisseri', name: 'Pappinisseri Toddy Shop', price: 45000, income: 950, blurb: 'Fresh toddy, kappa and fish curry hot enough to cry over.' },
  { id: 'fish', place: 'Azhikode', name: 'Azhikode Fish Market', price: 35000, income: 800, blurb: 'The boats come in at dawn. So does the money.' },
  { id: 'drive_in', place: 'Muzhappilangad', name: 'Muzhappilangad Beach Café', price: 80000, income: 1500, blurb: 'Beside Kerala\'s drive-in beach: four kilometres of sand you can drive on.' },
  { id: 'textiles', place: 'Taliparamba', name: 'Taliparamba Textiles', price: 120000, income: 2300, blurb: 'Kasavu saris and wedding silks, three floors of them.' },
  { id: 'biryani', place: 'Thalassery', name: 'Thalassery Biryani House', price: 180000, income: 3300, blurb: 'The famous one. Queues round the block on Fridays.' },
  { id: 'resort', place: 'Thottada', name: 'Thottada Beach Resort', price: 350000, income: 6500, blurb: 'Cottages on the cliff above Thottada beach. Sunsets included.' },
];
const COL = { sale: 0x3dff9a, owned: 0x37e2ff };

function signTex(lines, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(8,10,14,0.85)'; x.fillRect(0, 0, 512, 160);
  x.fillStyle = color; x.fillRect(0, 0, 512, 10);
  x.textAlign = 'center';
  x.fillStyle = color; x.font = '700 42px Segoe UI, Arial'; x.fillText(lines[0], 256, 66);
  x.fillStyle = '#fff'; x.font = '600 32px Segoe UI, Arial'; x.fillText(lines[1] || '', 256, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class KeralaBusiness {
  constructor(game) {
    this.game = game;
    const P = game.world.index?.places || [];
    const at = (name) => { const p = P.filter((q) => q[1] === name).sort((a, b) => Math.hypot(-a[3] - START.x, a[4] - START.z) - Math.hypot(-b[3] - START.x, b[4] - START.z))[0]; return p ? { x: -p[3], z: p[4] } : null; };
    this.list = BUSINESSES.map((b) => ({ ...b, c: at(b.place) })).filter((b) => b.c);
    this.marks = new Map();   // id -> { group, spot, owned }
    this.t = 0; this.tries = {};
  }

  get data() { return (this.game.save.data.biz ??= { owned: {}, earned: 0, clock: 0 }); }
  owns(id) { return !!this.data.owned[id]; }
  owned() { return this.list.filter((b) => this.owns(b.id)); }
  income() { return this.owned().reduce((a, b) => a + b.income, 0); }
  boost(kind) { return this.list.some((b) => b.boost === kind && this.owns(b.id)) ? 1.5 : 1; }
  spot(b) { return this.marks.get(b.id)?.spot || b.c; }

  // the board: on the pavement by the road nearest the town's centre, once its ground is built
  _kerb(x, z) {
    const g = this.game, w = g.world;
    if (!w.groundKnown(x, z, 30)) return null;
    const r = w.roadSpot(x, z, 7);
    if (!r || Math.hypot(r.x - x, r.z - z) > 400) return { skip: true };
    const sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw);
    for (const off of [7, 9, 11, 6]) for (const side of [1, -1]) {
      const px = r.x + sx * off * side, pz = r.z + sz * off * side;
      if (w.offCarriageway(px, pz, 1) && !w.inWater(px, pz) && g.onFoot._free(px, pz)) return { x: px, z: pz, y: w.groundHeight(px, pz), face: Math.atan2(-sx * side, -sz * side) };
    }
    return { skip: true };
  }

  _build(b, at) {
    const g = this.game, owned = this.owns(b.id), col = owned ? COL.owned : COL.sale;
    const group = new THREE.Group();
    group.position.set(at.x, at.y, at.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.y = 0.06;
    const beam = markerBeam(new THREE.CylinderGeometry(1, 1, 60, 14, 1, true).translate(0, 30, 0), new THREE.Color(col), 0.18, { near: 8, far: 30 });
    const tex = signTex(owned ? [b.name.toUpperCase(), `OWNED · ${formatMoney(b.income)} / ${BIZ_PERIOD / 60} min`] : ['FOR SALE', `${b.name} · ${formatMoney(b.price)}`], owned ? '#37e2ff' : '#3dff9a');
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
    board.position.y = 2.6; board.rotation.y = at.face;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    post.position.y = 1.05;
    group.add(ring, beam, board, post);
    g.scene.add(group);
    this.marks.set(b.id, { group, spot: at, owned });
  }
  _drop(id) { const m = this.marks.get(id); if (!m) return; m.group.removeFromParent(); m.group.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); this.marks.delete(id); }

  update(dt, input, driving) {
    const g = this.game, f = g.focusState, now = performance.now() / 1000;
    // payouts by play time
    if (this.owned().length) {
      const D = this.data;
      D.clock = (D.clock || 0) + dt;
      if (D.clock >= BIZ_PERIOD) {
        D.clock -= BIZ_PERIOD;
        const pay = this.income();
        D.earned = (D.earned || 0) + pay;
        g.save.addCash(pay, 'business');
        g.ui?.toast?.(`Your businesses paid ${formatMoney(pay)}`, 'cash', 4);
        g.save.save?.();
      }
    }
    let prompt = null;
    for (const b of this.list) {
      const d = Math.hypot(b.c.x - f.x, b.c.z - f.z);
      let m = this.marks.get(b.id);
      if (!m && d < 700 && (!this.tries[b.id] || now - this.tries[b.id] > 3)) {
        this.tries[b.id] = now;
        const at = this._kerb(b.c.x, b.c.z);
        if (at && !at.skip) { this._build(b, at); m = this.marks.get(b.id); }
        else if (at?.skip) this.tries[b.id] = now + 60;
      }
      if (!m) continue;
      if (d > 1000) { this._drop(b.id); continue; }
      if (m.owned !== this.owns(b.id)) { this._drop(b.id); continue; } // rebuilt with the new sign next frame
      const s = m.spot, near = Math.hypot(s.x - f.x, s.z - f.z);
      if (near > 9 || !driving || g.police?.inPursuit || g.races?.active || g.story?.active) continue;
      const sp = g.onFoot?.active ? 0 : Math.hypot(g.player.state.vx, g.player.state.vz);
      if (this.owns(b.id)) { prompt = `<b>${b.name}</b> · yours · ${formatMoney(b.income)} every ${BIZ_PERIOD / 60} min`; continue; }
      const afford = g.save.data.cash >= b.price;
      prompt = `<b>${b.name}</b> · ${formatMoney(b.price)} · ${b.blurb} · ${afford ? 'press <span class="key">E</span> to buy' : '<span style="color:#ff8a8a">not enough cash</span>'}`;
      if (afford && sp < 4 && input.consume('event')) this.buy(b.id);
    }
    this.promptHtml = prompt;
  }
  late() { if (this.promptHtml) this.game.hud.setPrompt(this.promptHtml); }

  buy(id) {
    const g = this.game, b = this.list.find((q) => q.id === id);
    if (!b || this.owns(id) || g.save.data.cash < b.price) return false;
    g.save.addCash(-b.price, 'business');
    this.data.owned[id] = Date.now();
    g.audio?.playEvent?.('purchase');
    g.hud?.message?.('BUSINESS BOUGHT', `${b.name} · ${formatMoney(b.income)} every ${BIZ_PERIOD / 60} min${b.boost ? ` · ${b.boost === 'taxi' ? 'taxi fares' : 'parcel runs'} pay 50% more` : ''}`, 4);
    g.progress?.addXp?.(Math.round(b.price / 200), 'business');
    g.save.save?.();
    bus.emit('business:bought', { id });
    return true;
  }

  blips() { return this.list.filter((b) => Math.hypot(b.c.x - this.game.focusState.x, b.c.z - this.game.focusState.z) < 3000).map((b) => { const s = this.spot(b); return { x: s.x, z: s.z, color: this.owns(b.id) ? '#37e2ff' : '#3dff9a', r: 4 }; }); }
}
