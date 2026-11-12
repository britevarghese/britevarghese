// Side jobs in Kerala, taken on the phone (JOBS app), GTA taxi-mission style:
//   TAXI FARES  a passenger waits at the roadside a few hundred metres away; pull up beside them, they get in and name
//               a place a few km off. Get there before the meter's patience runs out; a smooth, quick ride tips well.
//   PARCELS     collect a parcel from a shop, deliver it against a tighter clock. Bash the car about and it arrives
//               broken (a fraction of the pay).
// Jobs run back to back: finish one and the next is offered a few seconds later, the pay rising with the streak. The
// phone stops them; so does getting busted, a story job, or leaving the car too long.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';
import { formatMoney, clamp } from '../core/util.js';
import { buildCharacter } from '../player/OnFoot.js';
import { markerBeam } from './MarkerBeam.js';
import { TILE } from '../kerala/KeralaTile.js';

const NAMES = ['Anil', 'Suresh chettan', 'Fathima', 'Joseph', 'Lakshmi amma', 'Rahul', 'Shabana', 'Babu', 'Thomas', 'Divya', 'Unni', 'Ammini', 'Ashraf', 'Reshma', 'Gopalan', 'Neethu', 'Shaji', 'Mariam'];
const ASKS = [
  (p) => `${p}, fast please, I'm late for a wedding!`,
  (p) => `${p}. My bus broke down at the junction.`,
  (p) => `Take me to ${p}. And no shortcuts through the paddy fields!`,
  (p) => `${p}, quickly, the match starts in twenty minutes.`,
  (p) => `${p}. My daughter's exam results are out today!`,
  (p) => `To ${p}, mone. Gently, I have fish in this bag.`,
  (p) => `${p}. I'll tip if we beat my brother's auto.`,
];
const SHOPS = ['a bakery', 'a textile shop', 'a pharmacy', 'a mobile shop', 'a hardware store', 'a banana-chips stall', 'a spice merchant', 'a jeweller'];
const GOODS = ['a wedding cake', 'a box of saris', 'medicines', 'a new phone', 'paint tins', 'banana chips', 'pepper and cardamom', 'a gold necklace'];
const COLOR = { taxi: '#ffd23d', parcel: '#ff8a3d' };
const SMALL = new Set(['village', 'neighbourhood', 'quarter', 'suburb']);
const DEST = new Set(['town', 'suburb', 'village', 'neighbourhood', 'city']);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

export class KeralaJobs {
  constructor(game) {
    this.game = game;
    this.job = null;
    this.kind = null;       // working: the kind of job offered next
    this.streak = 0;
    this.nextT = 0;
    this.root = document.createElement('div');
    this.root.className = 'job-hud';
    this.root.innerHTML = '<div class="story-obj job-obj"></div><div class="story-meter job-meter hidden"><span></span><div class="bar"><i></i></div></div>';
    (document.getElementById('hud') || document.body).appendChild(this.root);
    this.el = { obj: this.root.querySelector('.job-obj'), meter: this.root.querySelector('.job-meter') };
    bus.on('police:busted', () => { if (this.job || this.kind) this.stop('Busted: the job is off'); });
  }

  get stats() { return (this.game.save.data.jobs ??= { fares: 0, parcels: 0, earned: 0, best: 0 }); }
  get active() { return !!this.job; }
  get working() { return !!this.kind; }

  // ------------------------------------------------------------------ places
  _built(x, z) { const w = this.game.world; return !w.tileSet || w.tileSet.has(w.key(Math.floor(-x / TILE), Math.floor(z / TILE))); }
  _places(kinds, x, z, d0, d1) {
    return (this.game.world.index?.places || []).filter((p) => kinds.has(p[0]))
      .map((p) => ({ name: String(p[1]).split(';')[0], kind: p[0], x: -p[3], z: p[4] }))
      .filter((o) => { const d = Math.hypot(o.x - x, o.z - z); return d > d0 && d < d1 && this._built(o.x, o.z); });
  }

  // a roadside spot near (x, z) on ground that's built: on the pavement facing the road
  _kerb(x, z) {
    const g = this.game, w = g.world;
    if (!w.groundKnown(x, z, 30)) return null;
    const r = w.roadSpot(x, z, 7);
    if (!r || Math.hypot(r.x - x, r.z - z) > 350) return null;
    const k = g.story?._kerb ? g.story._kerb(r.x, r.z, 1.2) : null;
    if (k && !w.onCarriageway(k.x, k.z) && Math.hypot(k.x - r.x, k.z - r.z) < 16) return { x: k.x, z: k.z, face: k.face, road: r };
    const sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw);
    for (const off of [5, 6.5, 8, 4]) for (const side of [1, -1]) {
      const px = r.x + sx * off * side, pz = r.z + sz * off * side;
      if (w.offCarriageway(px, pz, 0.6) && !w.inWater(px, pz)) return { x: px, z: pz, face: Math.atan2(-sx * side, -sz * side), road: r };
    }
    return { x: r.x, z: r.z, face: r.yaw, road: r };
  }

  // ------------------------------------------------------------------ start / stop
  why() {
    const g = this.game;
    if (!g.world.kerala || !g.world.index) return 'Not here';
    if (g.onFoot?.active) return 'Get in a car first';
    if (g.police?.inPursuit) return 'Lose the police first';
    if (g.story?.active) return 'Not in the middle of a story job';
    if (g.races?.active) return 'Not during a race';
    return null;
  }

  begin(kind) {
    const why = this.why();
    if (why) { this.game.ui.toast(why, 'err', 2.5); return false; }
    if (kind === 'taxi' && this.game.player?.p?.bike) { this.game.ui.toast('No room for a passenger on a bike: try parcels', 'err', 3); return false; }
    this._clear();
    this.kind = kind; this.streak = 0;
    return this._offer();
  }

  _offer() {
    const g = this.game, f = g.focusState;
    const C = this._places(SMALL, f.x, f.z, 250, 1400).sort(() => Math.random() - 0.5);
    let at = null, place = null;
    for (const o of C.slice(0, 20)) { at = this._kerb(o.x, o.z); if (at && Math.hypot(at.x - f.x, at.z - f.z) > 120) { place = o; break; } at = null; }
    if (!at) { // nowhere loaded round here: the road a few hundred metres ahead
      const s = g.player.state;
      for (const d of [400, 250, 600]) { at = this._kerb(s.x + Math.sin(s.yaw) * d, s.z + Math.cos(s.yaw) * d); if (at && Math.hypot(at.x - f.x, at.z - f.z) > 100) break; at = null; }
      place = { name: at?.road?.name || 'the road ahead' };
    }
    if (!at) { this.nextT = 4; return false; } // try again in a moment
    const kind = this.kind;
    const job = this.job = { kind, stage: 'pickup', pick: at, place, t: 0, color: COLOR[kind], marks: [] };
    if (kind === 'taxi') {
      job.who = rnd(NAMES);
      const body = buildCharacter({ jacket: new THREE.Color().setHSL(Math.random(), 0.45, 0.4).getHex(), jeans: rnd([0x2b3547, 0x3a3a3a, 0xe8e2d0, 0x5a4632]), skin: rnd([0x8a5e40, 0xb58868, 0x6a4530, 0x9a6a48]) });
      body.group.position.set(at.x, g.world.groundHeight(at.x, at.z), at.z);
      body.group.rotation.y = at.face;
      g.scene.add(body.group); job.body = body.group;
      this._mark(at.x, at.z, 0.9);
      this._say(`Pick up <b>${job.who}</b> near ${place.name}.`);
      g.hud?.message?.('TAXI FARE', `${job.who} · near ${place.name}`, 2.5);
    } else {
      job.shop = rnd(SHOPS); job.goods = GOODS[SHOPS.indexOf(job.shop)];
      this._mark(at.x, at.z, 0.9);
      this._say(`Collect <b>${job.goods}</b> from ${job.shop} near ${place.name}.`);
      g.hud?.message?.('PARCEL RUN', `${job.shop} · near ${place.name}`, 2.5);
    }
    g.setGPS(at.x, at.z);
    g.audio?.playEvent?.('uiClick');
    return true;
  }

  // the ride: a place a few km off (parcels: a little nearer, on a tighter clock)
  _depart() {
    const g = this.game, job = this.job, s = g.player.state;
    const [d0, d1] = job.kind === 'taxi' ? [1500, 6000] : [1000, 4000];
    const C = this._places(DEST, job.pick.x, job.pick.z, d0, d1);
    // prefer towns and suburbs, then any
    const big = C.filter((o) => o.kind === 'town' || o.kind === 'suburb' || o.kind === 'city');
    const o = rnd(big.length ? big : C.length ? C : [{ name: 'Kannur', x: job.pick.x + 2000, z: job.pick.z }]);
    const dist = Math.hypot(o.x - s.x, o.z - s.z);
    job.drop = { name: o.name, x: o.x, z: o.z, spot: null };
    job.dist = dist;
    job.time = job.limit = Math.round(dist * 1.45 / (job.kind === 'taxi' ? 13 : 15) + (job.kind === 'taxi' ? 40 : 25));
    job.dmg0 = s.damage || 0;
    job.stage = 'drop';
    this._unmark();
    this._mark(o.x, o.z, 1.6);
    g.setGPS(o.x, o.z);
    if (job.kind === 'taxi') {
      job.body?.removeFromParent(); job.body = null;
      g.audio?.playEvent?.('doorShut');
      this._say(`<b>${job.who}:</b> "${rnd(ASKS)(o.name)}"`);
    } else {
      g.audio?.playEvent?.('checkpoint');
      this._say(`Deliver <b>${job.goods}</b> to ${o.name}${job.goods.includes('cake') || job.goods.includes('necklace') ? ': handle with care!' : '.'}`);
    }
  }

  _arrive() {
    const g = this.game, job = this.job, s = g.player.state;
    const dmg = Math.max(0, (s.damage || 0) - job.dmg0), left = job.time / job.limit;
    const st = this.stats;
    const km = job.dist / 1000;
    const streakK = 1 + Math.min(this.streak, 5) * 0.1;
    let base, sub;
    if (job.kind === 'taxi') {
      base = 60 + 45 * km;
      const tip = Math.round(base * clamp(left, 0, 0.5) * clamp(1 - dmg * 3, 0, 1));
      base = Math.round(base * streakK) + tip;
      sub = tip > 0 ? `${job.who} tipped ${formatMoney(tip)}` : dmg > 0.15 ? `${job.who} won't ride with you again` : 'no tip';
      st.fares++;
      g.audio?.playEvent?.('doorOpen');
    } else {
      base = Math.round((80 + 55 * km) * streakK);
      if (dmg > 0.2) { base = Math.round(base * 0.3); sub = `${job.goods} arrived broken`; }
      else { const bonus = Math.round(base * clamp(left, 0, 0.4)); base += bonus; sub = bonus > 0 ? `early: +${formatMoney(bonus)}` : 'on time'; }
      st.parcels++;
    }
    this.streak++;
    st.earned += base; st.best = Math.max(st.best, this.streak);
    g.save.addCash(base, job.kind);
    g.progress?.addXp?.(job.kind === 'taxi' ? 60 : 70, 'job');
    g.audio?.playEvent?.('purchase');
    g.hud?.message?.(job.kind === 'taxi' ? 'FARE COMPLETE' : 'DELIVERED', `${formatMoney(base)} · ${sub}${this.streak > 1 ? ` · streak ${this.streak}` : ''}`, 3.5);
    g.save.save?.();
    bus.emit('job:done', { kind: job.kind, pay: base, streak: this.streak });
    this._clear();
    g.gps = null;
    this.nextT = 5;
    this._say(`Next ${this.kind === 'taxi' ? 'fare' : 'parcel'} coming up… (phone: stop working)`);
  }

  _fail(text) {
    const g = this.game;
    g.hud?.message?.('JOB FAILED', text, 3);
    g.audio?.playEvent?.('busted');
    this.streak = 0;
    this._clear();
    g.gps = null;
    this.nextT = 8;
    if (this.kind) this._say(`Another job coming up… (phone: stop working)`);
  }

  stop(text = 'You stopped working') {
    const g = this.game, was = !!(this.job || this.kind);
    if (this.job?.stage) g.gps = null;
    this._clear();
    this.kind = null; this.streak = 0;
    this._say(null); this._meter(null);
    if (was && text) g.ui?.toast?.(text, '', 2.5);
  }

  _clear() {
    const j = this.job;
    if (j) { j.body?.removeFromParent(); this._unmark(); }
    this.job = null;
    this._meter(null);
  }

  // ------------------------------------------------------------------ markers / HUD
  _mark(x, z, r) {
    const g = this.game, job = this.job, y = g.world.groundHeight(x, z), col = new THREE.Color(job.color);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.5, r * 2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    ring.position.set(x, y + 0.06, z);
    const beam = markerBeam(new THREE.CylinderGeometry(0.6, 0.6, 50, 12, 1, true).translate(0, 25, 0), col, 0.2, { near: 6, far: 26 });
    beam.position.set(x, y, z);
    g.scene.add(ring, beam);
    job.marks.push(ring, beam);
  }
  _unmark() { for (const m of this.job?.marks || []) { m.removeFromParent(); m.geometry?.dispose(); m.material?.dispose(); } if (this.job) this.job.marks = []; }

  _say(html) {
    const o = this.el.obj;
    o.innerHTML = html || '';
    o.classList.toggle('on', !!html);
    if (html) { o.classList.remove('flash'); void o.offsetWidth; o.classList.add('flash'); }
    this.sayT = html ? 7 : 0;
  }
  _meter(label, frac, danger) {
    const m = this.el.meter;
    if (label == null) { m.classList.add('hidden'); return; }
    m.classList.remove('hidden');
    m.firstChild.textContent = label;
    const i = m.querySelector('i'); i.style.width = `${clamp(frac, 0, 1) * 100}%`; i.className = danger ? 'danger' : '';
  }

  blips() {
    const j = this.job;
    if (!j) return [];
    const p = j.stage === 'pickup' ? j.pick : (j.drop.spot || j.drop);
    return [{ x: p.x, z: p.z, color: j.color, r: 6 }];
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const g = this.game;
    if (this.sayT > 0 && (this.sayT -= dt) <= 0) { this.el.obj.classList.remove('on'); }
    if (!this.kind) return;
    if (g.story?.active || g.races?.active) { this.stop('Job dropped'); return; }
    if (!this.job) { if ((this.nextT -= dt) <= 0 && !g.onFoot?.active && !g.police?.inPursuit) this._offer(); return; }
    const job = this.job, s = g.player.state, f = g.focusState;
    job.t += dt;
    const sp = Math.hypot(s.vx, s.vz);
    // left the car: a passenger (or the parcel's clock) waits 25 s
    if (g.onFoot?.active) {
      job.away = (job.away || 0) + dt;
      if (job.stage === 'drop' && job.away > 25) { this._fail(job.kind === 'taxi' ? `${job.who} got tired of waiting and walked` : 'You abandoned the parcel'); return; }
      if (job.away > 1 && !job.awayTold) { job.awayTold = true; this._say('Get back in the <b>car</b>.'); }
    } else if (job.away) { job.away = 0; job.awayTold = false; }
    if (job.body) { // the passenger turns to watch you come
      const d = Math.hypot(s.x - job.pick.x, s.z - job.pick.z);
      if (d < 40) job.body.rotation.y = Math.atan2(s.x - job.pick.x, s.z - job.pick.z);
    }
    if (job.stage === 'pickup') {
      const d = Math.hypot(s.x - job.pick.x, s.z - job.pick.z);
      if (d < 30 && sp > 3 && !g.onFoot?.active) this._meter('PULL UP', 1 - d / 30, false); else this._meter(null);
      if (d < 9 && sp < 3 && !g.onFoot?.active) { this._meter(null); this._depart(); }
      else if (job.t > 240) this._fail(job.kind === 'taxi' ? `${job.who} took a bus instead` : 'The shop gave the job to someone else');
      return;
    }
    // drop: find the kerb at the place once its ground is built
    const D = job.drop;
    if (!D.spot && (job.tryT = (job.tryT || 0) - dt) <= 0) {
      job.tryT = 1;
      if (Math.hypot(D.x - f.x, D.z - f.z) < 900) {
        const k = this._kerb(D.x, D.z);
        if (k) { D.spot = k; this._unmark(); this._mark(k.x, k.z, 1.1); g.setGPS(k.x, k.z); }
      }
    }
    if (!g.onFoot?.active) job.time -= dt;
    const T = D.spot || D, d = Math.hypot(s.x - T.x, s.z - T.z);
    const mm = Math.max(0, Math.ceil(job.time)), label = `${D.name.toUpperCase()} · ${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')} · ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}`;
    this._meter(label, job.time / job.limit, job.time < 20);
    if (job.time <= 0) { this._fail(job.kind === 'taxi' ? `${job.who}: "Stop here, I'll walk!"` : `Too late: ${D.name} didn't wait`); return; }
    if (D.spot && d < 12 && sp < 3 && !g.onFoot?.active) this._arrive();
  }
}
