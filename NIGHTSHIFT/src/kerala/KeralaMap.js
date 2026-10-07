// KeralaMap: the minimap / map image for the streamed Kerala world. The state is far too big for one
// pre-drawn image, so this keeps a ~5 km window around the player, drawn from the loaded tiles (water,
// roads by class, buildings) and redrawn when the player has moved well away from its centre. Same
// interface as MapRenderer (canvas, px/pz, wx/wz) so the HUD needs no changes.
import { MAP_SCALE } from '../ui/MapRenderer.js';
import { TILE } from './KeralaTile.js';

const SPAN = 5200;                         // metres covered by the window
const ROAD_COL = ['#f2b33a', '#f2b33a', '#e8c85a', '#d8d0b0', '#c8c2b0', '#a8a49a', '#a8a49a', '#8e8a82', '#77736c', '#8a6a50', '#8e8a82'];
const ROAD_W = [14, 12, 9.5, 8, 7, 5.5, 5, 4.5, 3.5, 3, 4];

export class KeralaMap {
  constructor(world) {
    this.world = world;
    this.size = Math.ceil(SPAN * MAP_SCALE);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.cx = 0; this.cz = 0;               // world point at the canvas centre
    this.dirty = true;
  }
  // world -> map pixel (north up; +x, the west, is to the left)
  px(x) { return (this.cx - x) * MAP_SCALE + this.size / 2; }
  pz(z) { return (this.cz - z) * MAP_SCALE + this.size / 2; }
  wx(px) { return this.cx - (px - this.size / 2) / MAP_SCALE; }
  wz(pz) { return this.cz - (pz - this.size / 2) / MAP_SCALE; }

  // keep the window around (x, z); redraw when the player gets near its edge or new tiles have arrived
  update(x, z) {
    const n = this.world.tiles.size, ready = [...this.world.tiles.values()].filter((t) => t.ready).length;
    if (Math.hypot(x - this.cx, z - this.cz) > SPAN * 0.24) { this.cx = Math.round(x); this.cz = Math.round(z); this.dirty = true; }
    if (ready !== this._ready) { this._ready = ready; this.dirty = true; }
    if (this.dirty && (performance.now() - (this._last || 0) > 1500 || Math.hypot(x - this.cx, z - this.cz) > SPAN * 0.3)) this.draw();
    void n;
  }

  draw() {
    this.dirty = false; this._last = performance.now();
    const g = this.canvas.getContext('2d'), S = this.size, K = MAP_SCALE;
    g.fillStyle = '#1b2a1c'; g.fillRect(0, 0, S, S);
    const tiles = [...this.world.tiles.values()].filter((t) => t.ready && Math.abs(-(t.E0 + TILE / 2) - this.cx) < SPAN && Math.abs(t.N0 + TILE / 2 - this.cz) < SPAN);
    // tile-local (e, n) -> canvas
    const P = (t, e, n) => [this.px(-(t.E0 + e)), this.pz(t.N0 + n)];
    const dec = (r, from) => { const out = []; let x = 0, z = 0; for (let i = from; i + 1 < r.length; i += 2) { if (i === from) { x = r[i]; z = r[i + 1]; } else { x += r[i]; z += r[i + 1]; } out.push([x / 10, z / 10]); } return out; };
    // water
    g.fillStyle = '#16384a';
    for (const t of tiles) {
      for (const [, rings] of t.data.w || []) {
        g.beginPath();
        for (const ring of rings) dec(ring, 0).forEach(([e, n], i) => { const [a, b] = P(t, e, n); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
        g.fill('evenodd');
      }
      g.strokeStyle = '#16384a';
      for (const w of t.data.wl || []) { g.lineWidth = Math.max(1, (w[1] / 10) * K); g.beginPath(); dec(w, 2).forEach(([e, n], i) => { const [a, b] = P(t, e, n); if (i) g.lineTo(a, b); else g.moveTo(a, b); }); g.stroke(); }
    }
    // buildings (faint)
    g.fillStyle = '#2a3530';
    for (const t of tiles) for (const b of t.data.b || []) { g.beginPath(); dec(b, 2).forEach(([e, n], i) => { const [a, c] = P(t, e, n); if (i) g.lineTo(a, c); else g.moveTo(a, c); }); g.fill(); }
    // roads: minor first, main roads on top
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let cls = 10; cls >= 0; cls--) {
      g.strokeStyle = ROAD_COL[cls]; g.lineWidth = Math.max(1.2, ROAD_W[cls] * K);
      g.beginPath();
      for (const t of tiles) for (const r of t.roads) {
        if (r.cls !== cls) continue;
        r.pts.forEach(([e, n], i) => { const [a, b] = P(t, e, n); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
      }
      g.stroke();
    }
  }
}

// The whole state for the full-screen map: the sea, the 14 districts, the national / state highways and main
// roads, cities and towns. Drawn once from index.json; same px/pz/wx/wz interface (square canvas).
const DIST_FILL = ['#1d3a26', '#21402a', '#1b3624', '#1f3c28', '#22422c', '#1a3422', '#244530', '#1e3a27', '#203e29', '#1c3825', '#234430', '#1a3322', '#21402b', '#1d3926'];
export class KeralaOverview {
  constructor(index) {
    this.index = index;
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const polys of Object.values(index.outlines)) for (const poly of polys) for (const [e, n] of poly) { minE = Math.min(minE, e); maxE = Math.max(maxE, e); minN = Math.min(minN, n); maxN = Math.max(maxN, n); }
    const pad = 12000, span = Math.max(maxE - minE, maxN - minN) + pad * 2;
    this.size = 2400;
    this.s = this.size / span;
    this.e0 = (minE + maxE) / 2 - span / 2; this.n1 = (minN + maxN) / 2 + span / 2;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this.size;
    this.draw();
  }
  px(x) { return (-x - this.e0) * this.s; }
  pz(z) { return (this.n1 - z) * this.s; }
  wx(px) { return -(px / this.s + this.e0); }
  wz(pz) { return this.n1 - pz / this.s; }
  draw() {
    const g = this.canvas.getContext('2d'), I = this.index, S = this.size;
    const E = (e) => (e - this.e0) * this.s, N = (n) => (this.n1 - n) * this.s;
    g.fillStyle = '#0b1a26'; g.fillRect(0, 0, S, S);
    Object.entries(I.outlines).forEach(([name, polys], i) => {
      g.fillStyle = DIST_FILL[i % DIST_FILL.length]; g.strokeStyle = 'rgba(160,200,170,0.35)'; g.lineWidth = 1.5;
      for (const poly of polys) { g.beginPath(); poly.forEach(([e, n], j) => (j ? g.lineTo(E(e), N(n)) : g.moveTo(E(e), N(n)))); g.closePath(); g.fill(); g.stroke(); }
    });
    const col = ['#ffcf4a', '#ffcf4a', '#f0d27a', '#c8c0a0'], wid = [3, 2.6, 1.8, 1.1];
    for (let cls = 3; cls >= 0; cls--) {
      g.strokeStyle = col[cls]; g.lineWidth = wid[cls]; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      for (const m of I.majors) { if (m[0] !== cls) continue; for (let k = 2; k + 1 < m.length; k += 2) (k === 2 ? g.moveTo(E(m[k]), N(m[k + 1])) : g.lineTo(E(m[k]), N(m[k + 1]))); }
      g.stroke();
    }
    g.textAlign = 'center';
    for (const p of I.places) {
      if (p[0] !== 'city' && p[0] !== 'town') continue;
      const x = E(p[3]), y = N(p[4]), city = p[0] === 'city';
      g.fillStyle = city ? '#ffffff' : '#d8e0d8'; g.beginPath(); g.arc(x, y, city ? 4 : 2.2, 0, 7); g.fill();
      g.font = `${city ? 600 : 400} ${city ? 15 : 11}px Segoe UI, Arial`; g.fillStyle = city ? 'rgba(255,255,255,0.95)' : 'rgba(220,230,220,0.75)';
      g.fillText(p[1], x, y - (city ? 8 : 5));
    }
    // district names at their outline centres
    g.font = '700 17px Segoe UI, Arial'; g.fillStyle = 'rgba(160,230,180,0.5)';
    for (const [name, polys] of Object.entries(I.outlines)) {
      let ce = 0, cn = 0, k = 0;
      const big = polys.reduce((a, b) => (b.length > a.length ? b : a), polys[0] || []);
      for (const [e, n] of big) { ce += e; cn += n; k++; }
      if (k) g.fillText(name.toUpperCase(), E(ce / k), N(cn / k));
    }
    g.textAlign = 'start';
  }
}
