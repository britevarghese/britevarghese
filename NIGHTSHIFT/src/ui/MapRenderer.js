// MapRenderer: draws the lightweight 2D map once (the countryside's relief, the sea, the city's roads,
// districts, river and buildings, the country roads) into an offscreen canvas. The minimap and the
// full world map crop/rotate it — no second 3D render.
import { ROAD_TYPES, RIVER, RING, lineHalfWidth } from '../world/CityLayout.js';
import { terrain, SEA, NEAR } from '../world/Terrain.js';

export const MAP_SCALE = 0.45; // px per meter
export const MAP_HALF = NEAR;  // the map covers the drivable countryside, not just the city
const WORLD_HALF = MAP_HALF;
const DIST_COLORS = {
  downtown: '#1b2233', commercial: '#191f2b', industrial: '#211d19', warehouse: '#1b1b1d',
  suburban: '#152019', riverside: '#162029', outskirts: '#121813',
};

export class MapRenderer {
  constructor(layout, planner, landscape = null) {
    this.layout = layout; this.planner = planner; this.landscape = landscape;
    const size = Math.ceil(WORLD_HALF * 2 * MAP_SCALE);
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.draw();
  }
  // world -> map pixel, seen from above with north (+z) up. In this world +x is to your LEFT when you
  // face north (forward = (sin yaw, cos yaw), left = (cos yaw, -sin yaw)), so +x runs toward the map's
  // left edge; drawing it to the right would mirror the map (turns shown the wrong way).
  px(x) { return (WORLD_HALF - x) * MAP_SCALE; }
  pz(z) { return (WORLD_HALF - z) * MAP_SCALE; }
  // map pixel -> world
  wx(px) { return WORLD_HALF - px / MAP_SCALE; }
  wz(pz) { return WORLD_HALF - pz / MAP_SCALE; }

  draw() {
    const g = this.canvas.getContext('2d');
    const S = MAP_SCALE;
    g.fillStyle = '#0c110e'; g.fillRect(0, 0, this.size, this.size);
    this._relief(g);
    // blocks
    for (const b of this.layout.blocks) {
      g.fillStyle = b.special === 'park' || b.special === 'hill' ? '#16301d' : b.special === 'construction' ? '#2a2418' : DIST_COLORS[b.district] || '#161a20';
      g.fillRect(this.px(b.x1), this.pz(b.z1), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    }
    // river
    g.fillStyle = '#123247';
    g.fillRect(this.px(RIVER.x1), this.pz(RING), (RIVER.x1 - RIVER.x0) * S, RING * 2 * S);
    // buildings
    g.fillStyle = 'rgba(120,135,160,0.22)';
    for (const b of this.planner.buildings) {
      if (b.deck) continue;
      g.fillRect(this.px(b.x1), this.pz(b.z1), (b.x1 - b.x0) * S, (b.z1 - b.z0) * S);
    }
    // roads
    g.lineCap = 'square';
    const order = [ROAD_TYPES.street, ROAD_TYPES.link, ROAD_TYPES.arterial, ROAD_TYPES.highway];
    for (const T of order) {
      g.strokeStyle = T === ROAD_TYPES.highway ? '#8a93a3' : T === ROAD_TYPES.arterial ? '#5d6676' : '#444c5a';
      g.lineWidth = Math.max(1.5, T.width * S * 0.8);
      for (const e of this.layout.edges) {
        if (e.type !== T) continue;
        g.beginPath();
        e.points.forEach(([x, z], i) => (i ? g.lineTo(this.px(x), this.pz(z)) : g.moveTo(this.px(x), this.pz(z))));
        g.stroke();
      }
    }
    // country roads
    g.strokeStyle = '#6a7282'; g.lineWidth = Math.max(1.5, 9 * S * 0.8); g.lineJoin = 'round';
    for (const rd of terrain().roads) { g.beginPath(); rd.s.forEach((p, i) => (i ? g.lineTo(this.px(p.x), this.pz(p.z)) : g.moveTo(this.px(p.x), this.pz(p.z)))); g.stroke(); }
    // tunnel
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.setLineDash([4, 3]); g.lineWidth = lineHalfWidth(0) * 2 * S;
    g.beginPath(); g.moveTo(this.px(-640), this.pz(170)); g.lineTo(this.px(-640), this.pz(310)); g.stroke(); g.setLineDash([]);
  }

  // the countryside: land colours from the landscape (darkened for the map style) with hill shading,
  // the sea and lakes in blue
  _relief(g) {
    const L = this.landscape?.grid;
    if (!L) return;
    const { N, S: step, H, C, Dm } = L;
    const img = g.createImageData(N + 1, N + 1), d = img.data;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i, o = ((N - j) * (N + 1) + (N - i)) * 4; // x runs to the left, north up
      const h = H[k];
      let r, gg, b;
      if (Dm[k] < 0) { r = 18; gg = 24; b = 20; }
      else if (h < SEA) { const deep = Math.min(1, (SEA - h) / 30); r = 18 - deep * 6; gg = 52 - deep * 14; b = 72 - deep * 12; }
      else {
        const hl = H[k - 1] ?? h, hr = H[k + 1] ?? h, hd = H[k - N - 1] ?? h, hu = H[k + N + 1] ?? h;
        const shade = Math.max(0.45, Math.min(1.35, 1 + ((hr - hl) * 0.6 + (hu - hd) * 0.8) / (2 * step)));
        r = C[k * 3] * 0.62 * shade; gg = C[k * 3 + 1] * 0.62 * shade; b = C[k * 3 + 2] * 0.62 * shade;
      }
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    const c = document.createElement('canvas'); c.width = c.height = N + 1;
    c.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, this.size, this.size);
  }
}
