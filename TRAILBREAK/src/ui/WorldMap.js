// The full-screen map (M, or MAP on a phone), as in Forza: the whole valley to zoom (wheel, pinch, + -) and pan (drag,
// or W A S D and the arrows), its roads and trails by name, the station and the garage, the places, the event start
// lines, the survey beacons and your friends. Tap any of them, or any spot on the ground, for what it is and to set a
// route there: the satnav (game/Route.js) plots it by road and trail, and it shows here, on the minimap and as a line
// on the ground ahead. The station, the garage, the event start lines, the beacons you have found and your friends
// can be fast-travelled to (not in the middle of a run); the fast travel list (T) has your friends and every base,
// one tap each.
import { escapeHtml } from './HUD.js';
import { kindOf } from '../game/EventPlay.js';

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const fmtD = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** What the places on the maps are called and what they are for. */
export const PLACE = {
  station: { name: 'Ranger Station', desc: 'Where you start: air for the tyres, and the tow truck brings you back here.', icon: 'home', travel: true, always: true },
  garage: { name: 'Garage', desc: 'Fit parts and have the truck mended (U there).', icon: 'wrench', travel: true, always: true },
  firetower: { name: 'Fire Tower', desc: 'An old lookout tower on the ridge.', icon: 'tower' },
  mine: { name: 'Old Mine', desc: 'The mine workings at the end of the ridge road.', icon: 'pick' },
  lookout: { name: 'Lookout', desc: 'The view from the top.', icon: 'eye' },
  mast: { name: 'Radio Mast', desc: 'A relay mast on the high ground.', icon: 'mast' },
  cabin: { name: 'Cabin', desc: 'A hut in the woods.', icon: 'hut' },
  teafactory: { name: 'Tea Factory', desc: 'The estate\'s factory, where the leaf comes in.', icon: 'factory' },
  bungalow: { name: 'Planter\'s Bungalow', desc: 'The estate manager\'s house.', icon: 'hut' },
  chaistall: { name: 'Chai Stall', desc: 'Tea by the roadside.', icon: 'cup' },
  busstop: { name: 'Bus Stop', desc: 'The village bus stop.', icon: 'bus' },
  laterite: { name: 'Laterite Quarry', desc: 'Red stone cut from the hillside.', icon: 'pick' },
};

export class WorldMap {
  /**
   * world: the World; image: the HUD's map picture; hooks: { state() -> { me: {x, z, heading}, mates, events, found,
   * route, racing }, route(item), clear(), travel(item) -> string|null (why not), close() }.
   */
  constructor(world, image, hooks) {
    this.world = world; this.image = image; this.hooks = hooks;
    this.el = $('map'); this.cv = $('map-canvas'); this.g = this.cv.getContext('2d');
    this.card = $('map-card');
    this.view = { x: 0, z: 0, zoom: 0.6 };
    this.layers = { events: true, beacons: true, places: true, names: true, friends: true };
    this.sel = null;
    this.hits = [];
    this.isOpen = false;
    this.ptrs = new Map();
    this.refresh();
    this.bindInput();
    for (const [id, key] of [['map-f-events', 'events'], ['map-f-beacons', 'beacons'], ['map-f-places', 'places'], ['map-f-names', 'names'], ['map-f-friends', 'friends']]) {
      const b = $(id);
      if (!b) continue;
      b.classList.toggle('on', this.layers[key]);
      b.onclick = () => { this.layers[key] = !this.layers[key]; b.classList.toggle('on', this.layers[key]); this.dirty = true; };
    }
    $('map-zin').onclick = () => this.zoomBy(1.6);
    $('map-zout').onclick = () => this.zoomBy(1 / 1.6);
    $('map-me').onclick = () => { const s = this.hooks.state(); this.view.x = s.me.x; this.view.z = s.me.z; this.dirty = true; };
    $('map-close').onclick = () => this.hooks.close();
    this.travelEl = $('map-travel');
    $('map-travel-btn').onclick = () => this.toggleTravel();
    $('map-title').textContent = world.map.name || 'Map';
  }

  /** The places on it (the open world's, again as its maps come in). */
  refresh() {
    const w = this.world;
    this.places = w.landmarks.filter((L) => PLACE[L.type]).map((L) => ({ kind: 'place', type: L.type, x: L.x, z: L.z, region: L.region, ...PLACE[L.type],
      name: L.type === 'station' ? (L.region ? w.regionDef(L.region).map.station?.name : w.map.station?.name) || PLACE.station.name : PLACE[L.type].name }));
    // (houses are just dots)
    this.houses = w.landmarks.filter((L) => L.type === 'house');
    this.dirty = true;
  }

  get minZoom() { return Math.min(this.w, this.h) / this.world.mapBox.size * 0.95; }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.resize();
    const s = this.hooks.state();
    this.view.x = s.me.x; this.view.z = s.me.z;
    this.view.zoom = Math.max(this.minZoom, Math.min(4, Math.min(this.w, this.h) / 900));
    this.clampView();
    this.select(null);
    this.toggleTravel(false);
    this.dirty = true;
    this.onKey = (e) => this.key(e);
    addEventListener('keydown', this.onKey);
    this.onResize = () => { this.resize(); this.dirty = true; };
    addEventListener('resize', this.onResize);
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
    removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.onResize);
    this.ptrs.clear();
  }

  resize() {
    const r = this.cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height); this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
  }

  // ---------------------------------------------------------------- view
  toScreen(x, z) { const v = this.view; return [(x - v.x) * v.zoom + this.w / 2, (z - v.z) * v.zoom + this.h / 2]; }
  toWorld(sx, sy) { const v = this.view; return [(sx - this.w / 2) / v.zoom + v.x, (sy - this.h / 2) / v.zoom + v.z]; }

  zoomBy(k, sx = this.w / 2, sy = this.h / 2) {
    const [wx, wz] = this.toWorld(sx, sy), v = this.view;
    v.zoom = Math.max(this.minZoom, Math.min(6, v.zoom * k));
    // (the spot under the pointer stays put)
    v.x = wx - (sx - this.w / 2) / v.zoom; v.z = wz - (sy - this.h / 2) / v.zoom;
    this.clampView();
    this.dirty = true;
  }

  pan(dx, dy) { this.view.x -= dx / this.view.zoom; this.view.z -= dy / this.view.zoom; this.clampView(); this.dirty = true; }

  /** Keep the valley on the screen: centred when it all fits, else no further than a little past its edges. */
  clampView() {
    const v = this.view, B = this.world.mapBox;
    const H = B.size / 2, cx = B.x0 + H, cz = B.z0 + H, lim = (half) => (half >= H ? 0 : H - half * 0.85);
    const mx = lim(this.w / 2 / v.zoom), mz = lim(this.h / 2 / v.zoom);
    v.x = Math.max(cx - mx, Math.min(cx + mx, v.x)); v.z = Math.max(cz - mz, Math.min(cz + mz, v.z));
  }

  bindInput() {
    const cv = this.cv;
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture?.(e.pointerId);
      const r = cv.getBoundingClientRect();
      this.ptrs.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top, x0: e.clientX - r.left, y0: e.clientY - r.top, t: performance.now() });
      this.moved = this.ptrs.size > 1;
      this.pinch = null;
    });
    cv.addEventListener('pointermove', (e) => {
      const p = this.ptrs.get(e.pointerId);
      if (!p) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.ptrs.size === 2) {
        const [a, b] = [...this.ptrs.values()];
        p.x = x; p.y = y;
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (this.pinch) { this.zoomBy(d / this.pinch.d, mx, my); this.pan(mx - this.pinch.mx, my - this.pinch.my); }
        this.pinch = { d, mx, my };
        this.moved = true;
        return;
      }
      if (Math.hypot(x - p.x0, y - p.y0) > 6) this.moved = true;
      if (this.moved) this.pan(x - p.x, y - p.y);
      p.x = x; p.y = y;
    });
    const up = (e) => {
      const p = this.ptrs.get(e.pointerId);
      this.ptrs.delete(e.pointerId);
      if (!p || this.moved || this.ptrs.size) { if (!this.ptrs.size) this.pinch = null; return; }
      this.tap(p.x, p.y);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { this.ptrs.delete(e.pointerId); this.pinch = null; });
    cv.addEventListener('dblclick', (e) => { const r = cv.getBoundingClientRect(); this.zoomBy(2, e.clientX - r.left, e.clientY - r.top); });
  }

  key(e) {
    if (!this.isOpen || e.target?.tagName === 'INPUT') return;
    const step = 90;
    const k = e.code;
    if (k === 'Equal' || k === 'NumpadAdd') this.zoomBy(1.5);
    else if (k === 'Minus' || k === 'NumpadSubtract') this.zoomBy(1 / 1.5);
    else if (k === 'KeyW' || k === 'ArrowUp') this.pan(0, step);
    else if (k === 'KeyS' || k === 'ArrowDown') this.pan(0, -step);
    else if (k === 'KeyA' || k === 'ArrowLeft') this.pan(step, 0);
    else if (k === 'KeyD' || k === 'ArrowRight') this.pan(-step, 0);
    else if (k === 'KeyC') $('map-me').onclick();
    else if (k === 'Delete') { this.hooks.clear(); this.select(this.sel); }
    else if (k === 'Space' && this.sel) { this.hooks.route(this.sel); this.select(this.sel); }
    else if (k === 'KeyT') this.toggleTravel();
    else return;
    e.preventDefault();
  }

  /** A tap on the map: the nearest thing drawn there, or the ground. */
  tap(sx, sy) {
    let best = null, bd = 22;
    for (const h of this.hits) { const d = Math.hypot(h.x - sx, h.y - sy) - h.r; if (d < bd) { bd = d; best = h.item; } }
    if (!best) { const [x, z] = this.toWorld(sx, sy); best = { kind: 'point', name: 'Waypoint', x, z }; }
    this.select(best);
  }

  // ---------------------------------------------------------------- the card
  select(item) {
    this.sel = item;
    this.dirty = true;
    const C = this.card;
    if (!item) { C.classList.add('hidden'); return; }
    const s = this.hooks.state(), me = s.me;
    const d = Math.hypot(item.x - me.x, item.z - me.z);
    const routed = s.route && s.route.target.kind === item.kind && s.route.target.key === keyOf(item);
    let title = item.name, sub = '', body = '';
    if (item.kind === 'event') {
      const e = item.event, best = item.best;
      sub = e.race ? 'Race' : 'Event';
      title = `${item.name}`;
      sub += ` · ${kindOf(e)}${e.race ? ` · ${e.gates.length} checkpoints` : ''}`;
      body = `${escapeHtml(e.desc || '')}<div class="mc-par"><span class="g">Gold ${fmtT(e.par.gold)}</span><span class="s">Silver ${fmtT(e.par.silver)}</span><span class="b">Bronze ${fmtT(e.par.bronze)}</span></div>${best ? `<div class="mc-best">Your best: ${fmtT(best)}</div>` : ''}<div class="mc-dim">Drive to the start line and press J (EVENT) to start.</div>`;
    } else if (item.kind === 'place') { sub = 'Place'; body = escapeHtml(item.desc || ''); }
    else if (item.kind === 'beacon') { sub = 'Survey beacon'; body = item.found ? 'Surveyed.' : 'Not found yet: drive into its orange light beam.'; }
    else if (item.kind === 'friend') { sub = 'Friend'; body = item.help ? `${escapeHtml(item.name)} needs a tow!` : 'Driving here.'; }
    else { title = 'Waypoint'; sub = `${Math.round(item.x)}, ${Math.round(item.z)}`; body = 'A spot of your own to drive to.'; }
    const why = this.travelWhy(item, s);
    C.innerHTML = `<div class="mc-head"><b>${escapeHtml(title)}</b><span>${escapeHtml(sub)} · ${fmtD(d)} away</span><button class="mc-x" aria-label="Close">✕</button></div>
      <div class="mc-body">${body}</div>
      <div class="mc-actions">
        ${routed ? '<button class="mc-clear">Clear route</button>' : '<button class="primary mc-route">Set route</button>'}
        ${why === '' ? '<button class="mc-travel">Fast travel</button>' : why ? `<span class="mc-dim">${escapeHtml(why)}</span>` : ''}
      </div>`;
    C.classList.remove('hidden');
    C.querySelector('.mc-x').onclick = () => this.select(null);
    const r = C.querySelector('.mc-route'), cl = C.querySelector('.mc-clear'), t = C.querySelector('.mc-travel');
    if (r) r.onclick = () => { this.hooks.route(item); this.select(item); };
    if (cl) cl.onclick = () => { this.hooks.clear(); this.select(item); };
    if (t) t.onclick = () => { const no = this.hooks.travel(item); if (no) this.select(item); };
  }

  // ---------------------------------------------------------------- the fast travel list
  /** The list of where to fast travel: the friends in the room, then your home and every base, nearest first. */
  toggleTravel(on = !this.travelOn) {
    this.travelOn = on;
    this.travelEl.classList.toggle('hidden', !on);
    $('map-travel-btn').classList.toggle('on', on);
    if (!on) return;
    if (this.sel) this.select(null);
    const s = this.hooks.state(), me = s.me, w = this.world, dist = (it) => Math.hypot(it.x - me.x, it.z - me.z);
    const home = w.map.spawn && { kind: 'place', type: 'station', ...PLACE.station, home: true, name: w.map.spawn.name, x: w.map.spawn.x, z: w.map.spawn.z };
    // (every map's base, its map in yet or not: one not yet in is built first, and the truck taken there when it is)
    const bases = (w.stations?.() || this.places.filter((p) => p.type === 'station'))
      .map((b) => ({ kind: 'place', type: 'station', ...PLACE.station, ...b }))
      .filter((b) => !(home && Math.hypot(b.x - home.x, b.z - home.z) < 60)).sort((a, b) => dist(a) - dist(b));
    const items = [...s.mates, ...(home ? [home] : []), ...bases];
    const where = (it) => (it.kind === 'friend' ? (it.help ? '<i class="help">needs a tow</i>' : 'driving')
      : it.home ? 'your truck\'s home' : escapeHtml(it.mapName || w.regionDef?.(it.region)?.map.name || PLACE.station.name));
    const row = (it, i) => `<div class="mt-row" data-i="${i}"><span class="mt-dot"${it.color ? ` style="background:${it.color}"` : ''}></span>
      <div class="mt-name"><b>${escapeHtml(it.name)}</b><span>${where(it)} · ${fmtD(dist(it))}</span></div>
      <button class="route">Route</button><button class="go">Travel</button></div>`;
    let i = 0;
    this.travelEl.innerHTML = `<div class="mc-head"><b>Fast travel</b><span>Jump to a friend or a base instead of driving there</span><button class="mc-x" aria-label="Close">✕</button></div>
      ${s.racing ? '<div class="mc-dim">No fast travel in the middle of a run</div>' : ''}
      ${s.mates.length ? `<div class="mt-sec">Friends</div>${s.mates.map((m) => row(m, i++)).join('')}` : ''}
      <div class="mt-sec">Bases</div>${[...(home ? [home] : []), ...bases].map((b) => row(b, i++)).join('')}
      <div class="mt-msg mc-dim"></div>`;
    this.travelEl.querySelector('.mc-x').onclick = () => this.toggleTravel(false);
    for (const el of this.travelEl.querySelectorAll('.mt-row')) {
      const it = items[+el.dataset.i];
      el.querySelector('.go').onclick = (e) => {
        e.stopPropagation();
        const no = this.hooks.travel(it);
        if (no) this.travelEl.querySelector('.mt-msg').textContent = no;
      };
      el.querySelector('.route').onclick = (e) => { e.stopPropagation(); this.hooks.route(it); this.toggleTravel(false); this.select(it); };
      // (the row itself: show it on the map)
      el.onclick = () => { this.view.x = it.x; this.view.z = it.z; this.clampView(); this.toggleTravel(false); this.select(it); };
    }
  }

  /** '' when it can be fast-travelled to, else why not (null: never). */
  travelWhy(item, s) {
    const can = item.kind === 'event' || (item.kind === 'place' && item.travel) || (item.kind === 'beacon' && item.found) || item.kind === 'friend';
    if (!can) return item.kind === 'beacon' ? 'Find it to fast travel here' : null;
    if (s.racing) return 'No fast travel in the middle of a run';
    return '';
  }

  // ---------------------------------------------------------------- drawing
  draw() {
    if (!this.isOpen) return;
    const g = this.g, s = this.hooks.state(), v = this.view, dpr = this.dpr, Z = v.zoom;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#18201b'; g.fillRect(0, 0, this.w, this.h);
    // the ground
    const B = this.world.mapBox, [ox, oy] = this.toScreen(B.x0, B.z0), size = B.size * Z;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.image, ox, oy, size, size);
    // roads and trails: a dark casing, then the road light and the trails dashed
    const lw = Math.max(1, Math.min(2.2, Z * 1.6));
    for (const pass of [0, 1]) {
      for (const t of this.world.data.trails) {
        const road = t.kind === 'road';
        g.beginPath();
        t.points.forEach(([x, z], k) => { const [sx, sy] = this.toScreen(x, z); if (k) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        if (pass === 0) { g.strokeStyle = 'rgba(20,16,12,0.55)'; g.lineWidth = (road ? 4.6 : 3.4) * lw; g.setLineDash([]); }
        else { g.strokeStyle = road ? '#efe4c6' : '#c99a62'; g.lineWidth = (road ? 2.6 : 1.7) * lw; g.setLineDash(road ? [] : [6 * lw, 4 * lw]); }
        g.lineJoin = 'round'; g.lineCap = 'round';
        g.stroke();
      }
    }
    g.setLineDash([]);
    // their names, along them
    if (this.layers.names && Z > 0.55) {
      g.font = `600 ${Math.round(11 + Math.min(3, Z))}px ${getComputedStyle(document.body).fontFamily}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const t of this.world.data.trails) this.label(g, t);
    }
    // the route
    if (s.route?.points?.length > 1) {
      for (const pass of [0, 1]) {
        g.beginPath();
        s.route.points.forEach(([x, z], k) => { const [sx, sy] = this.toScreen(x, z); if (k) g.lineTo(sx, sy); else g.moveTo(sx, sy); });
        g.strokeStyle = pass ? '#3fb6ff' : 'rgba(255,255,255,0.9)'; g.lineWidth = pass ? 4 : 7.5; g.lineJoin = 'round'; g.lineCap = 'round';
        g.stroke();
      }
    }
    // a party mode: the zone (and where it is closing to), the hill's ring
    const md = s.mode;
    if (md?.zone && md.zone.r > 0) {
      const [cx, cy] = this.toScreen(md.zone.x, md.zone.z);
      g.strokeStyle = '#3fb6ff'; g.lineWidth = 3; g.fillStyle = 'rgba(63,182,255,0.08)';
      g.beginPath(); g.arc(cx, cy, md.zone.r * Z, 0, TAU); g.fill(); g.stroke();
      const n = md.zone.next;
      if (n && n.r > 0 && n.r < md.zone.r - 1) { const [nx, ny] = this.toScreen(n.x, n.z); g.setLineDash([8, 6]); g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(nx, ny, n.r * Z, 0, TAU); g.stroke(); g.setLineDash([]); }
    }
    if (md?.hill) { const [hx, hy] = this.toScreen(md.hill.x, md.hill.z); g.strokeStyle = '#ffc04a'; g.lineWidth = 3; g.beginPath(); g.arc(hx, hy, Math.max(8, md.hill.r * Z), 0, TAU); g.stroke(); }
    this.hits.length = 0;
    const F = getComputedStyle(document.body).fontFamily;
    // houses: dots
    if (this.layers.places && Z > 0.8) for (const H of this.houses) { const [x, y] = this.toScreen(H.x, H.z); g.fillStyle = '#6b4a35'; g.fillRect(x - 2.5, y - 2.5, 5, 5); }
    const showNames = Z > 0.75;
    if (this.layers.places) for (const P of this.places) this.badge(g, P, P.icon, P.always ? '#e8893a' : '#3b4a40', P.always || showNames ? P.name : null, F);
    if (this.layers.events) for (const e of s.events) this.badge(g, e, 'flag', '#f3ead7', e.name, F, '#1c241f');
    if (this.layers.beacons) for (const b of s.beacons) this.badge(g, b, 'diamond', b.found ? '#7cc36a' : '#e8893a', showNames ? b.name : null, F);
    if (this.layers.friends) for (const m of s.mates) this.badge(g, m, 'truck', m.color, m.help ? `${m.name}: needs a tow` : m.name, F, null, m.help);
    // the waypoint pin
    if (s.route) {
      const [x, y] = this.toScreen(s.route.target.x, s.route.target.z);
      pin(g, x, y);
    }
    // the selection
    if (this.sel) {
      const [x, y] = this.toScreen(this.sel.x, this.sel.z);
      g.strokeStyle = '#3fb6ff'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 17 + Math.sin(performance.now() / 200) * 2, 0, TAU); g.stroke();
      if (this.sel.kind === 'point') pin(g, x, y, 'rgba(63,182,255,0.75)');
    }
    // us
    const [mx, my] = this.toScreen(s.me.x, s.me.z);
    g.save(); g.translate(mx, my); g.rotate(s.me.heading);
    g.fillStyle = 'rgba(63,182,255,0.25)'; g.beginPath(); g.arc(0, 0, 16, 0, TAU); g.fill();
    g.fillStyle = '#f3ead7'; g.strokeStyle = '#1c241f'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // scale bar and north
    this.scaleBar(g, F);
    const bar = $('map-sub'), info = s.route ? `Route: ${s.route.target.name} · ${fmtD(s.route.left)}` : 'Tap a place, an event or anywhere on the ground to set a route';
    if (bar.textContent !== info) bar.textContent = info;
    this.dirty = false;
  }

  /** A trail's name, set along it at its middle. */
  label(g, t) {
    const pts = t.points;
    if (pts.length < 6 || !t.name) return;
    const k = Math.floor(pts.length / 2), a = pts[k - 2], b = pts[k + 2];
    const [ax, ay] = this.toScreen(a[0], a[1]), [bx, by] = this.toScreen(b[0], b[1]);
    if ((ax < -50 && bx < -50) || (ax > this.w + 50 && bx > this.w + 50) || (ay < -50 && by < -50) || (ay > this.h + 50 && by > this.h + 50)) return;
    let ang = Math.atan2(by - ay, bx - ax);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    g.save(); g.translate((ax + bx) / 2, (ay + by) / 2); g.rotate(ang);
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(20,25,22,0.85)'; g.strokeText(t.name, 0, -9);
    g.fillStyle = t.kind === 'road' ? '#fff6dd' : '#f0d2a8'; g.fillText(t.name, 0, -9);
    g.restore();
  }

  /** An icon in a round badge at a thing's place, with its name under it; remembered for taps. */
  badge(g, item, icon, color, name, F, ink = '#fff', pulse = false) {
    const [x, y] = this.toScreen(item.x, item.z);
    if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) return;
    const r = icon === 'diamond' ? 8 : 11;
    if (pulse) { g.strokeStyle = '#e0563b'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r + 6 + 3 * Math.sin(performance.now() / 160), 0, TAU); g.stroke(); }
    if (icon === 'diamond') {
      g.fillStyle = color; g.strokeStyle = '#1c241f'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y); g.closePath(); g.fill(); g.stroke();
    } else {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 1, y + 1.5, r, 0, TAU); g.fill();
      g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; g.stroke();
      glyph(g, icon, x, y, ink || '#fff');
    }
    if (name) {
      g.font = `600 12px ${F}`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.lineWidth = 3; g.strokeStyle = 'rgba(20,25,22,0.85)'; g.strokeText(name, x, y + r + 3);
      g.fillStyle = '#f3ead7'; g.fillText(name, x, y + r + 3);
    }
    this.hits.push({ x, y, r, item });
  }

  scaleBar(g, F) {
    const Z = this.view.zoom, target = 110 / Z;
    const steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000];
    const m = steps.find((s) => s >= target * 0.6) || 2000, px = m * Z;
    // (above the layer chips where a small screen puts them along the bottom)
    const chips = document.getElementById('map-filters')?.getBoundingClientRect();
    const x = 18, y = chips && chips.height && chips.top > this.h / 2 ? Math.min(this.h - 22, chips.top - 8) : this.h - 22;
    g.strokeStyle = 'rgba(20,25,22,0.85)'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + px, y); g.stroke();
    g.strokeStyle = '#f3ead7'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y); g.lineTo(x + px, y); g.lineTo(x + px, y - 4); g.stroke();
    g.font = `600 12px ${F}`; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = '#f3ead7';
    g.fillText(fmtD(m), x + 2, y - 5);
    // north
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(20,25,22,0.7)'; g.beginPath(); g.arc(this.w - 30, this.h - 30, 15, 0, TAU); g.fill();
    g.fillStyle = '#e8893a'; g.beginPath(); g.moveTo(this.w - 30, this.h - 42); g.lineTo(this.w - 25, this.h - 30); g.lineTo(this.w - 35, this.h - 30); g.closePath(); g.fill();
    g.fillStyle = '#f3ead7'; g.font = `700 10px ${F}`; g.fillText('N', this.w - 30, this.h - 23);
  }
}

/** A stable identity for a map item, to tell whether the route goes to it. */
export function keyOf(item) {
  return item.kind === 'event' ? item.event.id : item.kind === 'beacon' ? item.id : item.kind === 'friend' ? item.id : item.kind === 'place' ? `${item.type}@${Math.round(item.x)},${Math.round(item.z)}` : `${Math.round(item.x)},${Math.round(item.z)}`;
}

/** The waypoint pin. */
function pin(g, x, y, color = '#3fb6ff') {
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(x, y + 1, 5, 2.5, 0, 0, TAU); g.fill();
  g.fillStyle = color; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - 4, y - 8, x - 10, y - 12, x - 10, y - 19); g.arc(x, y - 19, 10, Math.PI, 0); g.bezierCurveTo(x + 10, y - 12, x + 4, y - 8, x, y); g.closePath();
  g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y - 19, 3.6, 0, TAU); g.fill();
}

/** Little line drawings for the badges. */
function glyph(g, icon, x, y, ink) {
  g.save(); g.translate(x, y);
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 1.7; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (...pts) => { g.beginPath(); pts.forEach(([a, b], k) => (k ? g.lineTo(a, b) : g.moveTo(a, b))); };
  switch (icon) {
    case 'home': P([-6, 0], [0, -6], [6, 0]); g.stroke(); P([-4, -1], [-4, 6], [4, 6], [4, -1]); g.stroke(); break;
    case 'wrench': g.lineWidth = 2.4; P([-5, 5], [2, -2]); g.stroke(); g.lineWidth = 1.7; g.beginPath(); g.arc(3.2, -3.2, 3.3, -2.4, 1.6); g.stroke(); break;
    case 'tower': P([-4, 7], [-1.5, -5], [1.5, -5], [4, 7]); g.stroke(); P([-3, 2], [3, 2]); g.stroke(); P([-3.5, -7], [3.5, -7], [3.5, -4.5], [-3.5, -4.5]); g.closePath(); g.fill(); break;
    case 'pick': P([-5, 6], [4, -3]); g.stroke(); g.beginPath(); g.arc(4, -3, 5, -2.6, -0.2); g.stroke(); break;
    case 'eye': g.beginPath(); g.ellipse(0, 0, 6.5, 3.8, 0, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, 1.9, 0, TAU); g.fill(); break;
    case 'mast': P([0, 7], [0, -6]); g.stroke(); P([-4, 7], [0, -2], [4, 7]); g.stroke(); g.beginPath(); g.arc(0, -6, 3.5, -2.4, -0.7); g.stroke(); break;
    case 'hut': P([-6, 0], [0, -5], [6, 0]); g.stroke(); g.fillRect(-4, 0, 8, 6); break;
    case 'factory': P([-6, 6], [-6, -1], [-2, 1], [-2, -1], [2, 1], [2, -6], [5, -6], [5, 6]); g.closePath(); g.fill(); break;
    case 'cup': P([-4, -2], [-3, 5], [3, 5], [4, -2]); g.closePath(); g.stroke(); g.beginPath(); g.arc(5, 1, 2, -1.5, 1.5); g.stroke(); P([-1, -4], [-1, -6]); g.stroke(); P([1.5, -4], [1.5, -6]); g.stroke(); break;
    case 'bus': g.strokeRect(-5, -5, 10, 9); P([-5, 0], [5, 0]); g.stroke(); g.beginPath(); g.arc(-3, 5.5, 1.3, 0, TAU); g.arc(3, 5.5, 1.3, 0, TAU); g.fill(); break;
    case 'flag': {
      P([-4, 7], [-4, -7]); g.stroke();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? ink : 'rgba(0,0,0,0)'; g.fillRect(-4 + i * 3, -7 + j * 3, 3, 3); }
      g.strokeRect(-4, -7, 9, 6);
      break;
    }
    case 'truck': g.fillRect(-6, -2, 9, 5); g.fillRect(3, 0, 3, 3); g.beginPath(); g.arc(-3.5, 4, 1.8, 0, TAU); g.arc(3.5, 4, 1.8, 0, TAU); g.fill(); break;
    default: g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
  }
  g.restore();
}
