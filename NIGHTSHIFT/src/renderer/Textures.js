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

function cached(key, fn) {
  const k = key + '@' + SIZE;
  if (!cache.has(k)) cache.set(k, fn());
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
      const base = 44 + v * 22 + speck - (g < 0.12 ? 10 : 0);
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
      cc.fillStyle = `rgba(${R() < 0.5 ? 20 : 70},${R() < 0.5 ? 20 : 70},${R() < 0.5 ? 22 : 72},0.28)`;
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
      ctx.fillStyle = `rgba(${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},${R() < 0.5 ? 0 : 255},${0.03 + R() * 0.04})`;
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
        if (R() < def.lit) {
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

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const f = amt / 255;
  return '#' + new THREE.Color(Math.min(1, Math.max(0, c.r + f)), Math.min(1, Math.max(0, c.g + f)), Math.min(1, Math.max(0, c.b + f))).getHexString();
}

// ------------------------------------------------------------------ storefronts (ground floor band)
export function storefront() {
  return cached('storefront', () => {
    const n = SIZE, h = n / 4;
    const R = rng(555);
    const color = canvas(n, h), emis = canvas(n, h);
    const cc = color.getContext('2d'), ec = emis.getContext('2d');
    cc.fillStyle = '#26221f'; cc.fillRect(0, 0, n, h);
    ec.fillStyle = '#000'; ec.fillRect(0, 0, n, h);
    const shops = 4, sw = n / shops;
    const awnings = ['#8c1d1d', '#1d4f8c', '#2d6b3a', '#6b4a1d', '#333', '#6b1d5b'];
    for (let i = 0; i < shops; i++) {
      const x = i * sw;
      // pilasters
      cc.fillStyle = '#4a4540'; cc.fillRect(x, 0, sw * 0.06, h); cc.fillRect(x + sw * 0.94, 0, sw * 0.06, h);
      // big window
      const wx = x + sw * 0.1, wy = h * 0.3, ww = sw * 0.55, wh = h * 0.62;
      const glow = R.pick(['#ffe2b0', '#fff8e8', '#ffd0a0', '#d0f0ff', '#ffc8e8']);
      const lit = R() < 0.8;
      const g = ec.createLinearGradient(0, wy, 0, wy + wh);
      g.addColorStop(0, lit ? glow : '#111'); g.addColorStop(1, lit ? shade(glow, -90) : '#000');
      ec.fillStyle = g; ec.fillRect(wx, wy, ww, wh);
      cc.fillStyle = lit ? shade(glow, -100) : '#15181b'; cc.fillRect(wx, wy, ww, wh);
      // shelves / products silhouettes
      ec.fillStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 3; k++) ec.fillRect(wx + ww * 0.05, wy + wh * (0.35 + k * 0.22), ww * 0.9, wh * 0.04);
      for (let k = 0; k < 8; k++) { ec.fillStyle = `rgba(${R() * 255 | 0},${R() * 255 | 0},${R() * 255 | 0},0.5)`; ec.fillRect(wx + ww * R() * 0.9, wy + wh * (0.2 + 0.22 * R.int(0, 2)), ww * 0.06, wh * 0.12); }
      // door
      const dx = x + sw * 0.7, dw = sw * 0.18;
      cc.fillStyle = '#101214'; cc.fillRect(dx, h * 0.25, dw, h * 0.75);
      ec.fillStyle = lit ? shade(glow, -60) : '#000'; ec.fillRect(dx + dw * 0.12, h * 0.3, dw * 0.76, h * 0.62);
      // awning
      const ac = R.pick(awnings);
      cc.fillStyle = ac; cc.fillRect(x + sw * 0.07, h * 0.12, sw * 0.86, h * 0.13);
      for (let k = 0; k < 10; k++) { cc.fillStyle = 'rgba(255,255,255,0.18)'; cc.fillRect(x + sw * 0.07 + k * sw * 0.086, h * 0.12, sw * 0.043, h * 0.13); }
      // lit sign band above
      ec.fillStyle = shade(glow, -40); ec.globalAlpha = 0.5; ec.fillRect(x + sw * 0.1, h * 0.02, sw * 0.8, h * 0.08); ec.globalAlpha = 1;
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
    const W = '#e8e6df', Y = '#e0b830';
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
    const t = tex(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
export const MARK = { WHITE: 0, YELLOW: 1, DASH: 2, CROSS: 3, STOP: 4, ARROW: 5, ARROW_L: 6, ARROW_R: 7, MANHOLE: 8, DRAIN: 9, STALL: 10, DOUBLE_YELLOW: 11 };
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
export function leaves() {
  return cached('leaves', () => {
    const n = 256, c = canvas(n), ctx = c.getContext('2d');
    const R = rng(12);
    ctx.clearRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * n * 0.46;
      const x = n / 2 + Math.cos(a) * r, y = n / 2 + Math.sin(a) * r;
      const g = 50 + R() * 70;
      ctx.fillStyle = `rgb(${g * 0.45 | 0},${g | 0},${g * 0.35 | 0})`;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + R() * 4, 1.5 + R() * 2, R() * 3, 0, 7); ctx.fill();
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
    for (let x = 0; x < w; x++) { const a = 0.5 + 0.5 * Math.sin(x * 1.3) * Math.random(); ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x, 0, 1, h); }
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
