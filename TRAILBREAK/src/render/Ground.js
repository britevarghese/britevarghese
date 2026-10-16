// The ground textures: photo scans of each kind of ground (CC0, Poly Haven and ambientCG: see
// public/assets/ground/CREDITS.md), packed by tools/ground.py. They are loaded into two texture arrays, one layer per
// kind of ground, that the terrain shader blends: colour with the height in alpha (where stones stand proud of the
// mud, the blend shows the stones) and the normal's x and y.
//
// A map's manifest (public/assets/ground/<map>.json) lists its layers in order. For each: the files, how many metres
// one copy covers, the roughness, the average colour (what the ground looks like from far away), and here the
// height weight (how much its relief wins the blend) and a gain for scans photographed darker than the real thing
// (a manifest can set its own, as Kerala's wet red mud does).

import * as THREE from 'three';

const BASE = 'assets/ground/';

/** Per layer: height weight, colour gain (red, green, blue). */
const TUNE = {
  grass: [0.45, [1, 1, 1]], forest: [0.4, [0.62, 0.74, 0.86]], dirt: [0.5, [1, 1, 1]], gravel: [0.6, [1, 1, 1]],
  rock: [0.7, [1.6, 1.6, 1.6]], mud: [0.15, [1, 1, 1]], sand: [0.25, [1, 1, 1]], snow: [0.2, [1.9, 1.9, 1.9]],
  pebbles: [0.8, [1, 1, 1]],
};

/** The pixels of an image at a size (a region of it with src = [x, y, w, h]). */
async function pixels(blob, w, h, src) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  if (src) x.drawImage(bmp, src[0], src[1], src[2], src[3], 0, 0, w, h); else x.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return x.getImageData(0, 0, w, h).data;
}

/**
 * Load a map's ground layers. quality 'low' halves the colour resolution (512 instead of 1024).
 * Resolves with { layers: [{ name, size, rough, avg, heightW, gain }], index: { name: layer }, color, normal }.
 */
export async function loadGround(map = 'ashwood', quality = 'high') {
  const manifest = await fetch(`${BASE}${map}.json`).then((r) => { if (!r.ok) throw new Error(`ground ${map}: ${r.status}`); return r.json(); });
  const L = manifest.layers.length;
  const CS = quality === 'low' ? 512 : 1024, DS = 512;
  const color = new Uint8Array(CS * CS * 4 * L), normal = new Uint8Array(DS * DS * 2 * L);
  await Promise.all(manifest.layers.map(async (layer, li) => {
    const [cb, db] = await Promise.all([fetch(BASE + layer.color).then((r) => r.blob()), fetch(BASE + layer.data).then((r) => r.blob())]);
    const [c, h, n] = await Promise.all([
      pixels(cb, CS, CS),
      pixels(db, CS, CS, [1024, 0, 512, 512]),           // the height panel, at the colour's size
      pixels(db, DS * 2, DS, [0, 0, 1024, 512]),          // the normal's x and y panels
    ]);
    // rows bottom-up, so texture v runs up the picture (the normal maps' +y)
    const co = li * CS * CS * 4, no = li * DS * DS * 2;
    for (let r = 0; r < CS; r++) {
      const src = (CS - 1 - r) * CS * 4, dst = co + r * CS * 4;
      for (let i = 0; i < CS; i++) {
        const s = src + i * 4, d = dst + i * 4;
        color[d] = c[s]; color[d + 1] = c[s + 1]; color[d + 2] = c[s + 2]; color[d + 3] = h[s];
      }
    }
    for (let r = 0; r < DS; r++) {
      const src = (DS - 1 - r) * DS * 2 * 4, dst = no + r * DS * 2;
      for (let i = 0; i < DS; i++) {
        normal[dst + i * 2] = n[src + i * 4];
        normal[dst + i * 2 + 1] = n[src + (DS + i) * 4];
      }
    }
  }));
  const arr = (data, size, format, srgb) => {
    const t = new THREE.DataArrayTexture(data, size, size, L);
    t.format = format;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  };
  const layers = manifest.layers.map((l) => {
    const [heightW, usual] = TUNE[l.name] || [0.4, [1, 1, 1]];
    const gain = l.gain || usual;
    return { name: l.name, size: l.size, rough: l.rough, avg: l.avg.map((v, c) => v * gain[c]), heightW, gain };
  });
  const index = {};
  layers.forEach((l, i) => { index[l.name] = i; });
  return { map, layers, index, color: arr(color, CS, THREE.RGBAFormat, true), normal: arr(normal, DS, THREE.RGFormat, false) };
}
