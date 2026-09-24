// Procedural texture library. Every texture is generated once at the quality tier's resolution
// (256..2048) from canvases, so the game downloads zero texture bytes and scales memory with quality.
import * as THREE from 'three';
import { rng } from '../core/util.js';

const cache = new Map();
let SIZE = 1024;
let ANISO = 4;

export function setTextureQuality(size, anisotropy) { SIZE = size; ANISO = anisotropy; }
export function textureSize() { return SIZE; }

function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function tex(c, { srgb = true, repeat = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso ? ANISO : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// cached textures are shared: flag them so per-object disposal (vehicles, debris) leaves them alone
function markShared(v) {
  if (v?.isTexture) v.userData.shared = true;
  else if (v && typeof v === 'object') for (const x of Object.values(v)) if (x?.isTexture) x.userData.shared = true;
  return v;
}
function cached(key, fn) {
  const k = key + '@' + SIZE;
  if (!cache.has(k)) cache.set(k, markShared(fn()));
  return cache.get(k);
}

// ------------------------------------------------------------------ noise
function tileNoise(n, seed, cells) {
  // tileable value noise, returns Float32Array n*n in [0,1]
  const R = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = R();
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = (y / n) * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * n + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}
function fbm(n, seed, octaves = 5, base = 4) {
  const out = new Float32Array(n * n);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = tileNoise(n, seed + o * 101, base << o);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// height (grayscale canvas) -> tangent-space normal map canvas
function normalFromHeight(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function noiseCanvas(n, seed, octaves, base, lo = 0, hi = 255) {
  const c = canvas(n);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  const f = fbm(n, seed, octaves, base);
  for (let i = 0; i < f.length; i++) { const v = lo + (hi - lo) * f[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ asphalt
export function asphalt() {
  return cached('asphalt', () => {
    const n = SIZE;
    const R = rng(77);
    const color = canvas(n), height = canvas(n), rough = canvas(n);
    const cc = color.getContext('2d'), hc = height.getContext('2d'), rc = rough.getContext('2d');
    // base aggregate
    const f = fbm(n, 11, 6, 8);
    const grain = tileNoise(n, 99, Math.min(n, 512));
    const ci = cc.createImageData(n, n), hi = hc.createImageData(n, n), ri = rc.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const g = grain[i], v = f[i];
      const speck = g > 0.86 ? (g - 0.86) * 260 : 0;
      const base = 50 + v * 24 + speck - (g < 0.12 ? 10 : 0);
      ci.data[i * 4] = base; ci.data[i * 4 + 1] = base; ci.data[i * 4 + 2] = base + 2; ci.data[i * 4 + 3] = 255;
      const hgt = 120 + g * 90 + v * 40;
      hi.data[i * 4] = hi.data[i * 4 + 1] = hi.data[i * 4 + 2] = hgt; hi.data[i * 4 + 3] = 255;
      // roughness in G, metalness 0 in B
      const r = 215 + v * 30;
      ri.data[i * 4] = 0; ri.data[i * 4 + 1] = r; ri.data[i * 4 + 2] = 0; ri.data[i * 4 + 3] = 255;
    }
    cc.putImageData(ci, 0, 0); hc.putImageData(hi, 0, 0); rc.putImageData(ri, 0, 0);
    const s = n / 1024;
    // patches (repairs) — slightly different tone rectangles
    for (let i = 0; i < 5; i++) {
      const x = R() * n, y = R() * n, w = (60 + R() * 220) * s, h = (40 + R() * 160) * s;
      const tone = R() < 0.5 ? 22 : 68; // darker fresh seal or lighter aged patch (neutral gray)
      cc.fillStyle = `rgba(${tone},${tone},${tone + 2},0.28)`;
      cc.fillRect(x, y, w, h);
      cc.strokeStyle = 'rgba(15,15,15,0.5)'; cc.lineWidth = 2 * s; cc.strokeRect(x, y, w, h);
    }
    // cracks
    cc.strokeStyle = 'rgba(12,12,12,0.85)'; hc.strokeStyle = 'rgba(40,40,40,1)';
    for (let i = 0; i < 16; i++) {
      let x = R() * n, y = R() * n;
      cc.lineWidth = hc.lineWidth = (0.8 + R() * 1.8) * s;
      cc.beginPath(); hc.beginPath(); cc.moveTo(x, y); hc.moveTo(x, y);
      let a = R() * Math.PI * 2;
      for (let k = 0; k < 14; k++) { a += (R() - 0.5) * 1.2; x += Math.cos(a) * 14 * s; y += Math.sin(a) * 14 * s; cc.lineTo(x, y); hc.lineTo(x, y); }
      cc.stroke(); hc.stroke();
    }
    // oil stains & tar blobs (also lower roughness = shiny)
    for (let i = 0; i < 10; i++) {
      const x = R() * n, y = R() * n, r = (15 + R() * 60) * s;
      const g1 = cc.createRadialGradient(x, y, 0, x, y, r);
      g1.addColorStop(0, 'rgba(8,8,10,0.55)'); g1.addColorStop(1, 'rgba(8,8,10,0)');
      cc.fillStyle = g1; cc.beginPath(); cc.arc(x, y, r, 0, 7); cc.fill();
      const g2 = rc.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, 'rgba(0,120,0,0.8)'); g2.addColorStop(1, 'rgba(0,120,0,0)');
      rc.fillStyle = g2; rc.beginPath(); rc.arc(x, y, r, 0, 7); rc.fill();
    }
    // puddle regions for wet mode: stored in alpha-free separate map
    const puddle = canvas(n);
    const pc = puddle.getContext('2d');
    const pf = fbm(Math.min(n, 512), 5, 4, 4);
    const pn = Math.min(n, 512);
    const pi = pc.createImageData(pn, pn);
    for (let i = 0; i < pn * pn; i++) { const v = pf[i] > 0.58 ? Math.min(1, (pf[i] - 0.58) * 9) : 0; pi.data[i * 4] = 0; pi.data[i * 4 + 1] = 255 - v * 200; pi.data[i * 4 + 2] = 0; pi.data[i * 4 + 3] = 255; }
    const tmp = canvas(pn); tmp.getContext('2d').putImageData(pi, 0, 0);
    pc.drawImage(tmp, 0, 0, n, n);
    // combine: wet roughness = min(dry, puddle)
    const wet = canvas(n);
    const wc = wet.getContext('2d');
    wc.drawImage(rough, 0, 0);
    wc.globalAlpha = 0.6; wc.fillStyle = 'rgb(0,60,0)'; wc.fillRect(0, 0, n, n);
    wc.globalAlpha = 1; wc.globalCompositeOperation = 'darken'; wc.drawImage(puddle, 0, 0);
    return {
      map: tex(color), normalMap: tex(normalFromHeight(height, 3 * (n / 1024) + 1), { srgb: false }),
      roughnessMap: tex(rough, { srgb: false }), wetRoughnessMap: tex(wet, { srgb: false }),
    };
  });
}

// ------------------------------------------------------------------ concrete sidewalk (slabs)
export function concrete(slabs = 4, seed = 3, tone = 150) {
  return cached('concrete' + slabs + seed + tone, () => {
    const n = Math.min(SIZE, 1024);
    const R = rng(seed);
    const c = noiseCanvas(n, seed, 5, 6, tone - 25, tone + 15);
    const ctx = c.getContext('2d');
    const h = noiseCanvas(n, seed + 1, 3, 8, 150, 200);
    const hctx = h.getContext('2d');
    const step = n / slabs;
    // slab tone variation + joints
    for (let y = 0; y < slabs; y++) for (let x = 0; x < slabs; x++) {
      const tone = R() < 0.5 ? 0 : 255; // grayscale slab-to-slab variation
      ctx.fillStyle = `rgba(${tone},${tone},${tone},${0.03 + R() * 0.05})`;
      ctx.fillRect(x * step, y * step, step, step);
    }
    ctx.strokeStyle = 'rgba(40,40,40,0.8)'; hctx.strokeStyle = 'rgb(60,60,60)';
    ctx.lineWidth = hctx.lineWidth = Math.max(1, n / 300);
    for (let i = 0; i <= slabs; i++) {
      for (const g of [ctx, hctx]) { g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, n); g.moveTo(0, i * step); g.lineTo(n, i * step); g.stroke(); }
    }
    // stains / gum spots
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(20,20,20,${0.1 + R() * 0.2})`; ctx.beginPath(); ctx.arc(R() * n, R() * n, R() * 4 * n / 1024 + 1, 0, 7); ctx.fill(); }
    return { map: tex(c), normalMap: tex(normalFromHeight(h, 2), { srgb: false }) };
  });
}

// ------------------------------------------------------------------ building facades
// Each facade covers 8 window columns x 8 floors. Returns map, emissiveMap, roughness/metal (ORM), normal.
export const FACADE_DEF = [
  { name: 'glass', colW: 3.0, floorH: 3.6, frame: '#1c232b', glass: '#1a2a3a', wall: '#2a3440', winW: 0.92, winH: 0.84, lit: 0.42, litColors: ['#ffe2b0', '#dfefff', '#fff4d8', '#bfe0ff'], metal: true },
  { name: 'office', colW: 3.2, floorH: 3.6, frame: '#6e6c68', glass: '#1a2027', wall: '#8a8781', winW: 0.62, winH: 0.58, lit: 0.36, litColors: ['#fff0c8', '#e6f2ff', '#ffe0a0'] },
  { name: 'brick', colW: 3.0, floorH: 3.4, frame: '#d8d0c0', glass: '#161a20', wall: '#6d3a2c', winW: 0.46, winH: 0.56, lit: 0.45, litColors: ['#ffcf88', '#ffe2a8', '#ffb870', '#fff0d0'], brick: true },
  { name: 'metal', colW: 4.0, floorH: 4.0, frame: '#444a50', glass: '#1a1f24', wall: '#6a7178', winW: 0.3, winH: 0.22, lit: 0.25, litColors: ['#ffd9a0', '#e0f0ff'], corrugated: true },
  { name: 'dark', colW: 3.0, floorH: 3.5, frame: '#101316', glass: '#0d1318', wall: '#1c2126', winW: 0.8, winH: 0.7, lit: 0.4, litColors: ['#bfe8ff', '#ffe6c0', '#d8c8ff'], strips: true, metal: true },
  { name: 'house', colW: 3.4, floorH: 3.0, frame: '#f0ece4', glass: '#1b1f22', wall: '#b9ad97', winW: 0.4, winH: 0.45, lit: 0.5, litColors: ['#ffc070', '#ffd898'], siding: true },
  { name: 'concrete', colW: 3.2, floorH: 3.5, frame: '#5b5d5f', glass: '#171c21', wall: '#9a9894', winW: 0.55, winH: 0.5, lit: 0.33, litColors: ['#fff2cc', '#e0ecff'] },
];

export function facade(style) {
  return cached('facade' + style, () => {
    const def = FACADE_DEF[style];
    const n = SIZE;
    const R = rng(1000 + style * 31);
    const cols = 8, rows = 8;
    const cw = n / cols, rh = n / rows;
    const color = canvas(n), emis = canvas(n), orm = canvas(n), height = canvas(n);
    const cc = color.getContext('2d'), ec = emis.getContext('2d'), oc = orm.getContext('2d'), hc = height.getContext('2d');
    // wall
    cc.fillStyle = def.wall; cc.fillRect(0, 0, n, n);
    const wn = noiseCanvas(Math.min(n, 512), 40 + style, 5, 4, 0, 255);
    cc.globalAlpha = 0.18; cc.globalCompositeOperation = 'overlay'; cc.drawImage(wn, 0, 0, n, n); cc.globalAlpha = 1; cc.globalCompositeOperation = 'source-over';
    ec.fillStyle = '#000'; ec.fillRect(0, 0, n, n);
    oc.fillStyle = 'rgb(0,220,0)'; oc.fillRect(0, 0, n, n); // rough wall, non-metal
    hc.fillStyle = 'rgb(180,180,180)'; hc.fillRect(0, 0, n, n);
    if (def.brick) {
      const bh = rh / 14, bw = cw / 3.2;
      for (let y = 0; y < n; y += bh) {
        const off = (Math.floor(y / bh) % 2) * bw / 2;
        for (let x = -bw; x < n + bw; x += bw) {
          const t = R();
          cc.fillStyle = `rgba(${t < 0.3 ? 90 : 60},${t < 0.3 ? 40 : 28},${t < 0.3 ? 30 : 22},${0.25 + R() * 0.3})`;
          cc.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
        }
        cc.fillStyle = 'rgba(200,190,170,0.35)'; cc.fillRect(0, y, n, Math.max(1, bh * 0.12));
        hc.fillStyle = 'rgb(140,140,140)'; hc.fillRect(0, y, n, Math.max(1, bh * 0.12));
      }
    }
    if (def.corrugated) {
      for (let x = 0; x < n; x += Math.max(2, n / 128)) {
        const g = cc.createLinearGradient(x, 0, x + n / 128, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.5, 'rgba(0,0,0,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0.08)');
        cc.fillStyle = g; cc.fillRect(x, 0, n / 128, n);
        const gh = hc.createLinearGradient(x, 0, x + n / 128, 0);
        gh.addColorStop(0, 'rgb(220,220,220)'); gh.addColorStop(0.5, 'rgb(120,120,120)'); gh.addColorStop(1, 'rgb(220,220,220)');
        hc.fillStyle = gh; hc.fillRect(x, 0, n / 128, n);
      }
      oc.fillStyle = 'rgb(0,150,140)'; oc.fillRect(0, 0, n, n);
    }
    if (def.siding) {
      for (let y = 0; y < n; y += rh / 12) { cc.fillStyle = 'rgba(0,0,0,0.12)'; cc.fillRect(0, y, n, Math.max(1, rh / 60)); hc.fillStyle = 'rgb(120,120,120)'; hc.fillRect(0, y, n, Math.max(1, rh / 50)); }
    }
    // windows
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ww = cw * def.winW, wh = rh * def.winH;
        const x = c * cw + (cw - ww) / 2, y = r * rh + (rh - wh) * 0.45;
        // frame & reveal
        cc.fillStyle = def.frame; cc.fillRect(x - cw * 0.03, y - rh * 0.03, ww + cw * 0.06, wh + rh * 0.06);
        hc.fillStyle = 'rgb(90,90,90)'; hc.fillRect(x, y, ww, wh);
        // glass with vertical reflection gradient
        const g = cc.createLinearGradient(0, y, 0, y + wh);
        g.addColorStop(0, def.glass); g.addColorStop(1, shade(def.glass, 18));
        cc.fillStyle = g; cc.fillRect(x, y, ww, wh);
        oc.fillStyle = def.metal ? 'rgb(0,25,200)' : 'rgb(0,35,90)'; oc.fillRect(x, y, ww, wh);
        // lit window: warm interior with blinds / silhouettes (fake interiors)
        if (R() < def.lit * 0.8) {
          const col = R.pick(def.litColors);
          const bright = 0.45 + R() * 0.55;
          const eg = ec.createLinearGradient(0, y, 0, y + wh);
          eg.addColorStop(0, shade(col, -60 * (1 - bright))); eg.addColorStop(1, shade(col, -120 * (1 - bright) - 20));
          ec.fillStyle = eg; ec.fillRect(x, y, ww, wh);
          ec.globalAlpha = 0.5;
          if (R() < 0.5) { // blinds
            ec.fillStyle = '#000';
            for (let k = 0; k < wh; k += Math.max(2, wh / 10)) ec.fillRect(x, y + k, ww, Math.max(1, wh / 30));
          } else if (R() < 0.6) { // ceiling light pool / furniture silhouette
            ec.fillStyle = '#000'; ec.fillRect(x + ww * R() * 0.6, y + wh * 0.55, ww * 0.35, wh * 0.45);
          }
          ec.globalAlpha = 1;
          cc.fillStyle = shade(col, -120); cc.globalAlpha = 0.5; cc.fillRect(x, y, ww, wh); cc.globalAlpha = 1;
        } else if (R() < 0.3) {
          // dim TV-blue or curtain glow
          ec.fillStyle = R() < 0.5 ? 'rgba(40,70,120,1)' : 'rgba(60,40,20,1)'; ec.globalAlpha = 0.35; ec.fillRect(x, y, ww, wh); ec.globalAlpha = 1;
        }
        // mullions
        cc.fillStyle = def.frame;
        if (ww > cw * 0.5) cc.fillRect(x + ww / 2 - cw * 0.01, y, cw * 0.02, wh);
        ec.fillStyle = '#000'; if (ww > cw * 0.5) ec.fillRect(x + ww / 2 - cw * 0.01, y, cw * 0.02, wh);
      }
      // floor slab line
      cc.fillStyle = 'rgba(0,0,0,0.25)'; cc.fillRect(0, r * rh, n, Math.max(1, rh * 0.04));
      if (def.strips) { ec.fillStyle = 'rgba(80,200,255,0.9)'; ec.fillRect(0, r * rh, n, Math.max(1, rh * 0.02)); }
    }
    // vertical dirt streaks
    cc.globalAlpha = 0.12;
    for (let i = 0; i < 30; i++) { const x = R() * n; const g = cc.createLinearGradient(0, 0, 0, n); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)'); cc.fillStyle = g; cc.fillRect(x, R() * n * 0.5, 2 + R() * n / 100, n); }
    cc.globalAlpha = 1;
    const out = {
      map: tex(color), emissiveMap: tex(emis), ormMap: tex(orm, { srgb: false }),
      normalMap: tex(normalFromHeight(height, 2.5), { srgb: false }), def,
    };
    return out;
  });
}

// lighten/darken an sRGB hex color by `amt` (0..255 units) in display space
function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt))).toString(16).padStart(2, '0');
  return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
}

// ------------------------------------------------------------------ storefronts (ground floor band)
function mixHex(a, b, k) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((A >> sh) & 255) * (1 - k) + ((B >> sh) & 255) * k).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

export function storefront() {
  return cached('storefront', () => {
    const n = SIZE, h = n / 4;
    const R = rng(555);
    const color = canvas(n, h), emis = canvas(n, h);
    const cc = color.getContext('2d'), ec = emis.getContext('2d');
    cc.fillStyle = '#2a2622'; cc.fillRect(0, 0, n, h);
    ec.fillStyle = '#000'; ec.fillRect(0, 0, n, h);
    const shops = 4, sw = n / shops;
    // fascia boards: muted paint so the street isn't a rainbow by day
    const boards = ['#5a1f1c', '#1f3350', '#24452e', '#4a3a22', '#2a2a2c', '#3e2a40', '#6a5a3a'];
    for (let i = 0; i < shops; i++) {
      const x = i * sw;
      // pilasters
      cc.fillStyle = '#4a4540'; cc.fillRect(x, 0, sw * 0.06, h); cc.fillRect(x + sw * 0.94, 0, sw * 0.06, h);
      // stall riser under the window
      cc.fillStyle = '#35302b'; cc.fillRect(x + sw * 0.06, h * 0.9, sw * 0.88, h * 0.1);
      // big window: dark reflective glass by day (albedo), lit interior only in the emissive map
      const wx = x + sw * 0.1, wy = h * 0.3, ww = sw * 0.55, wh = h * 0.6;
      const glow = R.pick(['#ffe2b0', '#fff8e8', '#ffd0a0', '#d0f0ff', '#ffe8c8', '#c8e8ff']);
      const lit = R() < 0.8;
      const gl = cc.createLinearGradient(0, wy, 0, wy + wh);
      gl.addColorStop(0, mixHex('#1a1e22', glow, 0.14)); gl.addColorStop(1, mixHex('#101214', glow, 0.08));
      cc.fillStyle = gl; cc.fillRect(wx, wy, ww, wh);
      // faint interior shapes (shelves, displays) visible through the glass
      cc.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 0; k < 3; k++) cc.fillRect(wx + ww * 0.05, wy + wh * (0.35 + k * 0.22), ww * 0.9, wh * 0.04);
      // sky reflection sweep on the glass
      cc.save(); cc.beginPath(); cc.rect(wx, wy, ww, wh); cc.clip();
      const rf = cc.createLinearGradient(wx, wy, wx + ww, wy + wh);
      rf.addColorStop(0, 'rgba(200,215,230,0)'); rf.addColorStop(0.35, 'rgba(200,215,230,0.13)'); rf.addColorStop(0.5, 'rgba(200,215,230,0.02)'); rf.addColorStop(0.7, 'rgba(200,215,230,0.09)'); rf.addColorStop(1, 'rgba(200,215,230,0)');
      cc.fillStyle = rf; cc.fillRect(wx, wy, ww, wh); cc.restore();
      // interior: bright ceiling strip fading into a darker shop floor, products
      const g = ec.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, lit ? glow : '#0a0a0a'); g.addColorStop(0.18, lit ? shade(glow, -70) : '#050505'); g.addColorStop(1, lit ? shade(glow, -150) : '#000');
      ec.fillStyle = g; ec.fillRect(wx, wy, ww, wh);
      ec.fillStyle = 'rgba(0,0,0,0.6)';
      for (let k = 0; k < 3; k++) ec.fillRect(wx + ww * 0.05, wy + wh * (0.35 + k * 0.22), ww * 0.9, wh * 0.04);
      for (let k = 0; k < 10; k++) { ec.fillStyle = `rgba(${R() * 255 | 0},${R() * 255 | 0},${R() * 255 | 0},0.35)`; ec.fillRect(wx + ww * R() * 0.9, wy + wh * (0.2 + 0.22 * R.int(0, 2)), ww * 0.05, wh * 0.1); }
      // window frame + mullions
      cc.strokeStyle = '#141414'; cc.lineWidth = Math.max(2, sw * 0.012); cc.strokeRect(wx, wy, ww, wh);
      ec.fillStyle = '#000'; cc.fillStyle = '#161616';
      for (let k = 1; k < 3; k++) { ec.fillRect(wx + ww * k / 3 - 2, wy, 4, wh); cc.fillRect(wx + ww * k / 3 - 2, wy, 4, wh); }
      // door (glazed)
      const dx = x + sw * 0.7, dw = sw * 0.18;
      cc.fillStyle = '#121416'; cc.fillRect(dx, h * 0.25, dw, h * 0.75);
      cc.fillStyle = mixHex('#1a1e22', glow, 0.1); cc.fillRect(dx + dw * 0.12, h * 0.3, dw * 0.76, h * 0.62);
      cc.fillStyle = '#8a8a86'; cc.fillRect(dx + dw * 0.8, h * 0.58, dw * 0.06, h * 0.08);
      ec.fillStyle = lit ? shade(glow, -60) : '#000'; ec.fillRect(dx + dw * 0.12, h * 0.3, dw * 0.76, h * 0.62);
      // fascia sign board with lettering blocks (lettering is lit at night)
      const bc = R.pick(boards);
      const fy = h * 0.06, fh = h * 0.17;
      cc.fillStyle = bc; cc.fillRect(x + sw * 0.07, fy, sw * 0.86, fh);
      cc.fillStyle = 'rgba(255,255,255,0.08)'; cc.fillRect(x + sw * 0.07, fy, sw * 0.86, fh * 0.12);
      cc.fillStyle = 'rgba(0,0,0,0.3)'; cc.fillRect(x + sw * 0.07, fy + fh * 0.88, sw * 0.86, fh * 0.12);
      const letters = 4 + R.int(0, 5), lw = sw * 0.05, lgap = sw * 0.018;
      let lx = x + sw * 0.5 - (letters * (lw + lgap)) / 2;
      const ink = R() < 0.6 ? '#e8dcc0' : '#d8b25a';
      for (let k = 0; k < letters; k++, lx += lw + lgap) {
        // blocky glyphs: O, U, n, E, H, I shapes cut out of a solid block
        const ty = fy + fh * 0.28, th = fh * 0.44, kind = R.int(0, 5);
        const w = kind === 5 ? lw * 0.35 : lw;
        cc.fillStyle = ink; cc.fillRect(lx, ty, w, th);
        cc.fillStyle = bc;
        if (kind === 0) cc.fillRect(lx + lw * 0.3, ty + th * 0.25, lw * 0.4, th * 0.5);
        else if (kind === 1) cc.fillRect(lx + lw * 0.3, ty, lw * 0.4, th * 0.7);
        else if (kind === 2) cc.fillRect(lx + lw * 0.3, ty + th * 0.3, lw * 0.4, th * 0.7);
        else if (kind === 3) { cc.fillRect(lx + lw * 0.3, ty + th * 0.2, lw * 0.7, th * 0.2); cc.fillRect(lx + lw * 0.3, ty + th * 0.6, lw * 0.7, th * 0.2); }
        else if (kind === 4) { cc.fillRect(lx + lw * 0.3, ty, lw * 0.4, th * 0.38); cc.fillRect(lx + lw * 0.3, ty + th * 0.62, lw * 0.4, th * 0.38); }
        if (lit) { ec.fillStyle = shade(glow, -30); ec.fillRect(lx, ty, w, th); }
        if (kind === 5) lx -= lw * 0.65;
      }
    }
    return { map: tex(color), emissiveMap: tex(emis) };
  });
}

// ------------------------------------------------------------------ neon signs atlas (4x4) — original fictional names
export const SIGN_WORDS = ['NOODLES', 'OPEN 24H', 'MOTEL', 'GARAGE', 'PHARMACY', 'CAFE', 'LIQUOR', 'ARCADE', 'HOTEL', 'SUSHI', 'BAR', 'PAWN', 'DINER', 'TATTOO', 'KARAOKE', 'LAUNDRY'];
export function neonAtlas() {
  return cached('neon', () => {
    const n = Math.min(SIZE, 1024), cell = n / 4;
    const c = canvas(n);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, n, n);
    const colors = ['#ff2a6d', '#05d9e8', '#ffd319', '#39ff14', '#ff6c11', '#b967ff', '#ff3864', '#00f0ff'];
    SIGN_WORDS.forEach((w, i) => {
      const x = (i % 4) * cell, y = Math.floor(i / 4) * cell;
      const col = colors[i % colors.length];
      ctx.save();
      ctx.translate(x + cell / 2, y + cell / 2);
      // backing box
      ctx.fillStyle = 'rgba(10,10,14,1)';
      ctx.fillRect(-cell * 0.47, -cell * 0.2, cell * 0.94, cell * 0.4);
      ctx.strokeStyle = col; ctx.lineWidth = cell * 0.012; ctx.shadowColor = col; ctx.shadowBlur = cell * 0.05;
      ctx.strokeRect(-cell * 0.44, -cell * 0.17, cell * 0.88, cell * 0.34);
      let fs = cell * 0.2;
      ctx.font = `bold ${fs}px "Arial Narrow", Arial, sans-serif`;
      while (ctx.measureText(w).width > cell * 0.8 && fs > 8) { fs -= 2; ctx.font = `bold ${fs}px "Arial Narrow", Arial, sans-serif`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.shadowBlur = cell * 0.08;
      ctx.fillText(w, 0, cell * 0.01);
      ctx.fillStyle = col; ctx.globalAlpha = 0.6; ctx.fillText(w, 0, cell * 0.01);
      ctx.restore();
    });
    const t = tex(c, { repeat: false });
    return { map: t, emissiveMap: t };
  });
}

// ------------------------------------------------------------------ road markings atlas (8x8 cells)
// cells: 0 white solid, 1 yellow solid, 2 white dashed, 3 crosswalk bar, 4 stop line, 5 arrow straight,
// 6 arrow left, 7 arrow right, 8 manhole, 9 drain grate, 10 parking stall line, 11 double yellow
export function markingsAtlas() {
  return cached('markings', () => {
    const n = Math.min(SIZE, 1024), cell = n / 4;
    const c = canvas(n);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, n, n);
    const worn = (x, y) => {
      // wear mask: erase random speckles
      ctx.save(); ctx.globalCompositeOperation = 'destination-out';
      const R = rng(x * 7 + y);
      for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(0,0,0,${R() * 0.6})`; ctx.fillRect(x + R() * cell, y + R() * cell, 1 + R() * 3, 1 + R() * 3); }
      ctx.restore();
    };
    const cellXY = (i) => [(i % 4) * cell, Math.floor(i / 4) * cell];
    const W = '#e8e6df', Y = '#c9a232';
    let [x, y] = cellXY(0); ctx.fillStyle = W; ctx.fillRect(x + cell * 0.3, y, cell * 0.4, cell); worn(x, y);
    [x, y] = cellXY(1); ctx.fillStyle = Y; ctx.fillRect(x + cell * 0.3, y, cell * 0.4, cell); worn(x, y);
    [x, y] = cellXY(2); ctx.fillStyle = W; ctx.fillRect(x + cell * 0.3, y + cell * 0.1, cell * 0.4, cell * 0.8); worn(x, y);
    [x, y] = cellXY(3); ctx.fillStyle = W; ctx.fillRect(x + cell * 0.1, y, cell * 0.8, cell); worn(x, y);
    [x, y] = cellXY(4); ctx.fillStyle = W; ctx.fillRect(x, y + cell * 0.25, cell, cell * 0.5); worn(x, y);
    const arrow = (i, turn) => {
      const [ax, ay] = cellXY(i);
      ctx.save(); ctx.translate(ax + cell / 2, ay + cell / 2); ctx.fillStyle = W;
      ctx.beginPath();
      ctx.moveTo(-cell * 0.06, cell * 0.45); ctx.lineTo(cell * 0.06, cell * 0.45); ctx.lineTo(cell * 0.06, -cell * 0.05);
      if (turn === 0) { ctx.lineTo(cell * 0.16, -cell * 0.05); ctx.lineTo(0, -cell * 0.45); ctx.lineTo(-cell * 0.16, -cell * 0.05); ctx.lineTo(-cell * 0.06, -cell * 0.05); }
      else {
        const s = turn;
        ctx.lineTo(cell * 0.06 * s, -cell * 0.05);
        ctx.quadraticCurveTo(cell * 0.06 * s, -cell * 0.2, -cell * 0.12 * s, -cell * 0.2);
        ctx.lineTo(-cell * 0.12 * s, -cell * 0.3); ctx.lineTo(-cell * 0.36 * s, -cell * 0.14); ctx.lineTo(-cell * 0.12 * s, cell * 0.02); ctx.lineTo(-cell * 0.12 * s, -cell * 0.08);
        ctx.quadraticCurveTo(-cell * 0.06 * s, -cell * 0.08, -cell * 0.06 * s, -cell * 0.02);
      }
      ctx.closePath(); ctx.fill(); ctx.restore(); worn(ax, ay);
    };
    arrow(5, 0); arrow(6, 1); arrow(7, -1);
    // manhole
    [x, y] = cellXY(8);
    ctx.save(); ctx.translate(x + cell / 2, y + cell / 2);
    ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.arc(0, 0, cell * 0.46, 0, 7); ctx.fill();
    ctx.strokeStyle = '#555'; ctx.lineWidth = cell * 0.03; ctx.beginPath(); ctx.arc(0, 0, cell * 0.42, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#3d3d3d'; ctx.lineWidth = cell * 0.015;
    for (let k = -4; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(-cell * 0.35, k * cell * 0.08); ctx.lineTo(cell * 0.35, k * cell * 0.08); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k * cell * 0.08, -cell * 0.35); ctx.lineTo(k * cell * 0.08, cell * 0.35); ctx.stroke(); }
    ctx.restore();
    // drain grate
    [x, y] = cellXY(9);
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(x + cell * 0.1, y + cell * 0.3, cell * 0.8, cell * 0.4);
    ctx.fillStyle = '#050505'; for (let k = 0; k < 9; k++) ctx.fillRect(x + cell * (0.14 + k * 0.08), y + cell * 0.34, cell * 0.04, cell * 0.32);
    [x, y] = cellXY(10); ctx.fillStyle = W; ctx.fillRect(x + cell * 0.42, y, cell * 0.16, cell); worn(x, y);
    [x, y] = cellXY(11); ctx.fillStyle = Y; ctx.fillRect(x + cell * 0.18, y, cell * 0.24, cell); ctx.fillRect(x + cell * 0.58, y, cell * 0.24, cell); worn(x, y);
    // 12: lane wear — polished dark wheel tracks with a faint oily centre line (stretched along lanes)
    [x, y] = cellXY(12);
    {
      const g = ctx.createLinearGradient(x, 0, x + cell, 0);
      const stops = [[0, 0], [0.14, 0.0], [0.24, 0.42], [0.34, 0.0], [0.46, 0.0], [0.5, 0.18], [0.54, 0.0], [0.66, 0.0], [0.76, 0.42], [0.86, 0.0], [1, 0]];
      for (const [t, a] of stops) g.addColorStop(t, `rgba(12,12,14,${a})`);
      ctx.fillStyle = g; ctx.fillRect(x, y, cell, cell);
    }
    // 13: asphalt repair patch (darker, sealed edges)
    [x, y] = cellXY(13);
    {
      const R2 = rng(1313);
      ctx.fillStyle = 'rgba(18,18,20,0.55)'; ctx.fillRect(x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88);
      ctx.strokeStyle = 'rgba(8,8,8,0.8)'; ctx.lineWidth = cell * 0.025; ctx.strokeRect(x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88);
      for (let i = 0; i < 200; i++) { ctx.fillStyle = `rgba(255,255,255,${R2() * 0.08})`; ctx.fillRect(x + cell * (0.08 + R2() * 0.84), y + cell * (0.08 + R2() * 0.84), 2, 2); }
    }
    // 14: oil / fluid stain
    [x, y] = cellXY(14);
    {
      const R3 = rng(1414);
      for (let i = 0; i < 6; i++) {
        const cx = x + cell * (0.3 + R3() * 0.4), cy = y + cell * (0.3 + R3() * 0.4), r = cell * (0.12 + R3() * 0.2);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(5,5,8,0.55)'); g.addColorStop(1, 'rgba(5,5,8,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
    const t = tex(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
export const MARK = { WHITE: 0, YELLOW: 1, DASH: 2, CROSS: 3, STOP: 4, ARROW: 5, ARROW_L: 6, ARROW_R: 7, MANHOLE: 8, DRAIN: 9, STALL: 10, DOUBLE_YELLOW: 11, WEAR: 12, PATCH: 13, STAIN: 14 };
export function markUV(i) { const u0 = (i % 4) / 4, v0 = 1 - (Math.floor(i / 4) + 1) / 4; return [u0 + 0.002, v0 + 0.002, u0 + 0.248, v0 + 0.248]; }

// ------------------------------------------------------------------ sprites / misc
export function radialGlow(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)') {
  return cached('glow' + inner + mid, () => {
    const n = 128, c = canvas(n), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, inner); g.addColorStop(0.25, mid); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    return tex(c, { repeat: false, aniso: false });
  });
}
export function lightPool() {
  return cached('pool', () => {
    const n = 256, c = canvas(n), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.45)'); g.addColorStop(0.65, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    return tex(c, { repeat: false, aniso: false });
  });
}
// vertical streak used for wet-road light reflections
export function streak() {
  return cached('streak', () => {
    const w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    const gx = ctx.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gx; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    const gy = ctx.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.2, 'rgba(0,0,0,0.9)'); gy.addColorStop(0.45, 'rgba(0,0,0,0.5)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gy; ctx.fillRect(0, 0, w, h);
    return tex(c, { repeat: false, aniso: false });
  });
}
export function smokePuff() {
  return cached('smoke', () => {
    const n = 128, c = canvas(n), ctx = c.getContext('2d');
    const nz = noiseCanvas(n, 9, 4, 4, 120, 255);
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.6, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(nz, 0, 0);
    ctx.globalCompositeOperation = 'destination-in'; ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    return tex(c, { repeat: false, aniso: false });
  });
}
export function grass() {
  return cached('grass', () => {
    const n = Math.min(SIZE, 1024);
    const c = noiseCanvas(n, 21, 6, 8, 0, 255);
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#3d5a2a'; ctx.fillRect(0, 0, n, n);
    ctx.globalCompositeOperation = 'source-over';
    const R = rng(4);
    for (let i = 0; i < n * 6; i++) { ctx.fillStyle = `rgba(${40 + R() * 40},${70 + R() * 50},${20 + R() * 20},0.5)`; ctx.fillRect(R() * n, R() * n, 1, 2 + R() * 3); }
    return { map: tex(c) };
  });
}
export function dirt() {
  return cached('dirt', () => {
    const n = Math.min(SIZE, 1024);
    const c = noiseCanvas(n, 31, 6, 6, 0, 255);
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#6e5a44'; ctx.fillRect(0, 0, n, n);
    return { map: tex(c), normalMap: tex(normalFromHeight(noiseCanvas(n, 32, 5, 8), 3), { srgb: false }) };
  });
}
export function roofTex() {
  return cached('roof', () => {
    const n = Math.min(SIZE, 512);
    const c = noiseCanvas(n, 51, 5, 8, 50, 110);
    return { map: tex(c), normalMap: tex(normalFromHeight(noiseCanvas(n, 52, 3, 16), 2), { srgb: false }) };
  });
}
export function shingles() {
  return cached('shingles', () => {
    const n = Math.min(SIZE, 512);
    const c = canvas(n), ctx = c.getContext('2d'), h = canvas(n), hc = h.getContext('2d');
    ctx.fillStyle = '#6a6a6a'; ctx.fillRect(0, 0, n, n); hc.fillStyle = '#888'; hc.fillRect(0, 0, n, n);
    const R = rng(8);
    const rw = n / 16, rh = n / 16;
    for (let y = 0; y < n; y += rh) for (let x = -rw; x < n; x += rw) {
      const off = (Math.floor(y / rh) % 2) * rw / 2; const v = 90 + R() * 60;
      ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x + off, y, rw - 1, rh - 1);
      const g = hc.createLinearGradient(0, y, 0, y + rh); g.addColorStop(0, '#fff'); g.addColorStop(1, '#333'); hc.fillStyle = g; hc.fillRect(x + off, y, rw - 1, rh - 1);
    }
    return { map: tex(c), normalMap: tex(normalFromHeight(h, 2), { srgb: false }) };
  });
}
export function containerTex() {
  return cached('container', () => {
    const n = Math.min(SIZE, 512);
    const c = canvas(n), ctx = c.getContext('2d'), h = canvas(n), hc = h.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += n / 32) {
      const g = hc.createLinearGradient(x, 0, x + n / 32, 0); g.addColorStop(0, '#eee'); g.addColorStop(0.5, '#555'); g.addColorStop(1, '#eee'); hc.fillStyle = g; hc.fillRect(x, 0, n / 32, n);
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + n / 64, 0, n / 64, n);
    }
    const rust = noiseCanvas(n, 61, 5, 8, 0, 255);
    ctx.globalAlpha = 0.25; ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(rust, 0, 0);
    return { map: tex(c), normalMap: tex(normalFromHeight(h, 2), { srgb: false }) };
  });
}
// 2x2 atlas of leaf clusters (alpha-tested cards); cell 3 is the darker inner foliage
export function leaves() {
  return cached('leaves', () => {
    const n = 512, c = canvas(n), ctx = c.getContext('2d');
    const R = rng(12);
    ctx.clearRect(0, 0, n, n);
    const cs = n / 2;
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * cs, oy = (1 - Math.floor(cell / 2)) * cs; // canvas y is flipped vs uv
      const dark = cell === 3;
      // a few sub-clusters make an irregular outline
      const subs = [];
      for (let k = 0; k < 5; k++) subs.push([cs / 2 + (R() - 0.5) * cs * 0.4, cs / 2 + (R() - 0.5) * cs * 0.4, cs * (0.2 + R() * 0.1)]);
      // a few twigs under the leaves
      ctx.strokeStyle = 'rgba(60,45,30,0.9)'; ctx.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(ox + cs / 2, oy + cs / 2); ctx.lineTo(ox + cs / 2 + (R() - 0.5) * cs * 0.6, oy + cs / 2 + (R() - 0.5) * cs * 0.6); ctx.stroke(); }
      for (let i = 0; i < 420; i++) {
        const [sx, sy, sr] = subs[i % subs.length];
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * sr;
        const x = ox + sx + Math.cos(a) * r, y = oy + sy + Math.sin(a) * r;
        if (x < ox + 6 || x > ox + cs - 6 || y < oy + 6 || y > oy + cs - 6) continue;
        const t = R();
        const light = dark ? 0.45 + t * 0.3 : 0.7 + t * 0.5;
        const rr = (46 + R() * 34) * light, gg = (92 + R() * 40) * light, bb = (30 + R() * 14) * light;
        const ang = a + (R() - 0.5) * 1.2, L = 5 + R() * 5, W = 2.2 + R() * 1.6;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
        ctx.beginPath(); ctx.ellipse(0, 0, L, W, 0, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,255,220,${dark ? 0.04 : 0.12})`; ctx.fillRect(-L * 0.8, -0.4, L * 1.6, 0.8); // midrib sheen
        ctx.restore();
      }
    }
    const t = tex(c, { repeat: false, aniso: false });
    return t;
  });
}
export function waterNormal() {
  return cached('water', () => {
    const n = 512;
    return tex(normalFromHeight(noiseCanvas(n, 71, 5, 8), 4), { srgb: false });
  });
}
export function tireTread() {
  return cached('tread', () => {
    const w = 64, h = 512, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,255)'; ctx.fillRect(0, 0, w, h);
    const hc = canvas(w, h), hx = hc.getContext('2d');
    hx.fillStyle = '#aaa'; hx.fillRect(0, 0, w, h);
    hx.fillStyle = '#222';
    for (let y = 0; y < h; y += 16) { hx.fillRect(w * 0.2, y, w * 0.08, 10); hx.fillRect(w * 0.72, y + 8, w * 0.08, 10); }
    hx.fillRect(w * 0.47, 0, w * 0.06, h);
    return tex(normalFromHeight(hc, 3), { srgb: false });
  });
}
export function skidTex() {
  return cached('skid', () => {
    const w = 64, h = 64, c = canvas(w, h), ctx = c.getContext('2d');
    // rubber streaks: dense core with tread-groove striations and soft edges
    for (let x = 0; x < w; x++) {
      const e = Math.min(1, Math.min(x, w - 1 - x) / 6);
      const a = e * (0.72 + 0.28 * Math.sin(x * 1.3) * Math.random());
      ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, 0, 1, h);
    }
    return tex(c, { aniso: false });
  });
}
export function moonTex() {
  return cached('moon', () => {
    const n = 256, c = canvas(n), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(n / 2, n / 2, n * 0.18, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,245,1)'); g.addColorStop(0.35, 'rgba(210,220,255,0.25)'); g.addColorStop(1, 'rgba(160,180,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
    const nz = noiseCanvas(64, 81, 4, 4, 180, 255);
    ctx.save(); ctx.beginPath(); ctx.arc(n / 2, n / 2, n * 0.19, 0, 7); ctx.clip(); ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(nz, n * 0.3, n * 0.3, n * 0.4, n * 0.4); ctx.restore();
    return tex(c, { repeat: false, aniso: false });
  });
}
export function cloudTex() {
  return cached('clouds', () => {
    const n = 512;
    const f = fbm(n, 91, 6, 3);
    const c = canvas(n), ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let i = 0; i < n * n; i++) { const v = Math.max(0, (f[i] - 0.45) * 3); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = Math.min(255, v * 255); }
    ctx.putImageData(img, 0, 0);
    return tex(c, { aniso: false });
  });
}

// Vinyl livery patterns drawn over the base paint color (u = length, v = around the body).
export const VINYLS = ['None', 'Racing Stripes', 'Side Flames', 'Split Two-Tone', 'Circuit Lines', 'Shards'];
export function vinylTexture(index, base, accent) {
  const w = 512, h = 256;
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent; ctx.strokeStyle = accent;
  // v: 0 = floor center, ~0.3 = rocker, 0.6 = beltline, 1 = roof center; u: 0 rear -> 1 front
  const V = (v) => h - v * h;
  if (index === 1) { ctx.fillRect(0, V(1.0), w, h * 0.035); ctx.fillRect(0, V(0.955), w, h * 0.03); }
  else if (index === 2) {
    ctx.beginPath(); ctx.moveTo(w * 0.95, V(0.32));
    for (let i = 0; i < 7; i++) { const x = w * (0.9 - i * 0.07); ctx.lineTo(x, V(0.5 + (i % 2) * 0.1)); ctx.lineTo(x - w * 0.03, V(0.36)); }
    ctx.lineTo(w * 0.35, V(0.32)); ctx.closePath(); ctx.fill();
  } else if (index === 3) { ctx.fillRect(0, V(0.46), w, h * 0.46); }
  else if (index === 4) {
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); const y = V(0.35 + i * 0.035); ctx.moveTo(0, y); ctx.lineTo(w * (0.3 + i * 0.05), y); ctx.lineTo(w * (0.35 + i * 0.05), y - 12); ctx.lineTo(w, y - 12); ctx.stroke(); }
  } else if (index === 5) {
    const R = rng(5);
    for (let i = 0; i < 14; i++) { ctx.beginPath(); const x = R() * w, y = V(0.3 + R() * 0.3); ctx.moveTo(x, y); ctx.lineTo(x + 40 + R() * 60, y - 10 - R() * 30); ctx.lineTo(x + 20 + R() * 40, y + 5); ctx.closePath(); ctx.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = ANISO;
  return t;
}

// ------------------------------------------------------------------ car detail maps
// Paint albedo (vinyl + panel shut lines + window trim) and a matching groove normal map, drawn from
// the per-model panel layout exported by the model generator (u = along the car, v = around it).
// shareKey: AI cars with identical liveries (police, racers) share one cached texture pair, marked
// userData.shared so per-vehicle disposal leaves it alone. Player paint stays per-instance.
export function carPaintTexture(vinyl, base, accent, panels, shareKey = null) {
  if (shareKey) {
    return cached('paint:' + shareKey, () => carPaintTexture(vinyl, base, accent, panels));
  }
  const w = panels?.width || 1024, h = panels?.height || 512;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const hc = canvas(w, h), hx = hc.getContext('2d');
  if (vinyl) ctx.drawImage(vinylTexture(vinyl, base, accent).image, 0, 0, w, h);
  else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, w, h);
  const X = (u) => u * w, Y = (v) => (1 - v) * h;
  if (panels) {
    const lw = Math.max(1.5, w / 600);
    ctx.lineCap = hx.lineCap = 'round';
    for (const [u0, v0, u1, v1] of panels.lines) {
      ctx.strokeStyle = vinyl ? 'rgba(8,8,10,0.85)' : 'rgba(10,10,12,0.9)'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(X(u0), Y(v0)); ctx.lineTo(X(u1), Y(v1)); ctx.stroke();
      hx.strokeStyle = '#000'; hx.lineWidth = lw * 2.2;
      hx.beginPath(); hx.moveTo(X(u0), Y(v0)); hx.lineTo(X(u1), Y(v1)); hx.stroke();
    }
    for (const [u0, v0, u1, v1, kind] of panels.rects) {
      if (kind === 'round') {
        ctx.strokeStyle = 'rgba(10,10,12,0.8)'; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.ellipse((X(u0) + X(u1)) / 2, (Y(v0) + Y(v1)) / 2, Math.abs(X(u1) - X(u0)) / 2, Math.abs(Y(v1) - Y(v0)) / 2, 0, 0, Math.PI * 2); ctx.stroke();
        hx.strokeStyle = '#000'; hx.lineWidth = lw * 2; hx.stroke();
      } else {
        ctx.fillStyle = 'rgba(20,20,24,0.9)'; ctx.fillRect(X(u0), Y(v1), X(u1) - X(u0), Y(v0) - Y(v1));
        hx.fillStyle = '#303030'; hx.fillRect(X(u0), Y(v1), X(u1) - X(u0), Y(v0) - Y(v1));
      }
    }
    for (const [u0, v0, u1, v1] of panels.trims) {
      ctx.fillStyle = '#0c0d0f'; ctx.fillRect(X(u0), Y(v1), X(u1) - X(u0), Y(v0) - Y(v1));
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = ANISO;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(hc, 1.6));
  normalMap.anisotropy = ANISO;
  return { map, normalMap };
}

// Headlight unit: dark reflector housing, two projector lenses and an LED daytime-running strip.
export function headlightTextures() {
  return cached('headlamp', () => {
    const w = 256, h = 128;
    const c = canvas(w, h), ctx = c.getContext('2d'), e = canvas(w, h), ex = e.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2a2f36'); g.addColorStop(1, '#0d0f12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, w, h);
    for (const cx of [w * 0.3, w * 0.62]) {
      const rg = ctx.createRadialGradient(cx, h * 0.5, 2, cx, h * 0.5, h * 0.3);
      rg.addColorStop(0, '#f4f8ff'); rg.addColorStop(0.45, '#9aa6b4'); rg.addColorStop(0.5, '#3a4048'); rg.addColorStop(1, '#1a1d22');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, h * 0.5, h * 0.3, 0, 7); ctx.fill();
      const eg = ex.createRadialGradient(cx, h * 0.5, 1, cx, h * 0.5, h * 0.26);
      eg.addColorStop(0, '#ffffff'); eg.addColorStop(0.6, '#b8c4d8'); eg.addColorStop(1, '#000');
      ex.fillStyle = eg; ex.beginPath(); ex.arc(cx, h * 0.5, h * 0.26, 0, 7); ex.fill();
    }
    // LED strip along the lower edge (u runs along the car length, v up)
    ctx.fillStyle = '#e8eef8'; ctx.fillRect(w * 0.08, h * 0.84, w * 0.84, h * 0.07);
    ex.fillStyle = '#ffffff'; ex.fillRect(w * 0.08, h * 0.84, w * 0.84, h * 0.07);
    ctx.strokeStyle = '#555c66'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    const map = tex(c, { repeat: false }), emissiveMap = tex(e, { repeat: false });
    return { map, emissiveMap };
  });
}

// Tail light: smoked red lens with segmented light bars and an inner reflector pattern.
export function taillightTextures() {
  return cached('taillamp', () => {
    const w = 256, h = 128;
    const c = canvas(w, h), ctx = c.getContext('2d'), e = canvas(w, h), ex = e.getContext('2d');
    ctx.fillStyle = '#3a060a'; ctx.fillRect(0, 0, w, h);
    ex.fillStyle = '#120000'; ex.fillRect(0, 0, w, h);
    for (let i = 0; i < 3; i++) {
      const y = h * (0.2 + i * 0.26);
      ctx.fillStyle = '#9a1018'; ctx.fillRect(w * 0.06, y, w * 0.88, h * 0.12);
      ex.fillStyle = '#ffffff'; ex.fillRect(w * 0.06, y, w * 0.88, h * 0.12);
    }
    for (let x = 0; x < w; x += 10) { ex.fillStyle = 'rgba(0,0,0,0.35)'; ex.fillRect(x, 0, 3, h); }
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, 0, w, h * 0.12);
    return { map: tex(c, { repeat: false }), emissiveMap: tex(e, { repeat: false }) };
  });
}

// ------------------------------------------------------------------ storefront awnings
// 4 rows = 4 fabric schemes; u repeats every stripe pair along the awning, the lower part of each
// row is the hanging valance with a darker hem
export function awningAtlas() {
  return cached('awning', () => {
    const w = 128, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    const schemes = [['#8a1d1a', '#e4dccb'], ['#1f4a33', '#e2d8bf'], ['#1d2b4c', '#d6d6d2'], ['#5b1b22', '#6a232b']];
    const rh = h / 4;
    schemes.forEach(([a, b], r) => {
      const y0 = r * rh;
      for (let x = 0; x < w; x += w / 4) {
        ctx.fillStyle = (x / (w / 4)) % 2 ? b : a; ctx.fillRect(x, y0, w / 4, rh);
      }
      // fabric shading: folds + sun fade toward the top
      const g = ctx.createLinearGradient(0, y0, 0, y0 + rh);
      g.addColorStop(0, 'rgba(255,255,255,0.12)'); g.addColorStop(0.75, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g; ctx.fillRect(0, y0, w, rh);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, y0 + rh * 0.78, w, 2);
    });
    const t = tex(c, { aniso: false });
    return t;
  });
}

// ------------------------------------------------------------------ traffic signs (original designs)
// 256x128 atlas: left half STOP octagon, right half SPEED LIMIT 50 plate
export function signAtlas() {
  return cached('signs', () => {
    const w = 512, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.fillStyle = '#6a6e72'; ctx.fillRect(0, 0, w, h);
    // STOP octagon
    const cx = h / 2, cy = h / 2, R = h * 0.47;
    const oct = (r) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } ctx.closePath(); };
    oct(R); ctx.fillStyle = '#f2f2ee'; ctx.fill();
    oct(R * 0.92); ctx.fillStyle = '#b3141a'; ctx.fill();
    ctx.fillStyle = '#f4f4f0'; ctx.font = `bold ${h * 0.26}px Arial, Helvetica, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('STOP', cx, cy + h * 0.01);
    // SPEED LIMIT plate
    const x0 = h + 18, pw = h - 36, py = 10, ph = h - 20;
    ctx.fillStyle = '#f2f2ee'; ctx.fillRect(x0, py, pw, ph);
    ctx.strokeStyle = '#151515'; ctx.lineWidth = 7; ctx.strokeRect(x0 + 9, py + 9, pw - 18, ph - 18);
    ctx.fillStyle = '#151515'; ctx.font = `bold ${h * 0.12}px Arial, Helvetica, sans-serif`;
    ctx.fillText('SPEED', x0 + pw / 2, py + ph * 0.2); ctx.fillText('LIMIT', x0 + pw / 2, py + ph * 0.36);
    ctx.font = `bold ${h * 0.36}px Arial, Helvetica, sans-serif`; ctx.fillText('50', x0 + pw / 2, py + ph * 0.7);
    // light grime
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(40,40,40,${Math.random() * 0.06})`; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    return tex(c, { repeat: false });
  });
}
