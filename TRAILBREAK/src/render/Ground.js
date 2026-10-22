// The ground textures: photo scans of each kind of ground (CC0, Poly Haven and ambientCG: see
// public/assets/ground/CREDITS.md), packed by tools/ground.py. They are loaded into two texture arrays, one layer per
// kind of ground, that the terrain shader blends: colour with the height in alpha (where stones stand proud of the
// mud, the blend shows the stones) and the normal's x and y.
//
// A map's manifest (public/assets/ground/<map>.json) lists its layers in order. For each: the files, how many metres
// one copy covers, the roughness, the average colour (what the ground looks like from far away), and here the
// height weight (how much its relief wins the blend) and a gain for scans photographed darker than the real thing
// (a manifest can set its own, as Kerala's wet red mud does), or lighter: the grass scan, taken from above in bright
// sun, is lighter and yellower than a meadow seen across, its blades shading each other (and than the tufts of
// render/Grass.js standing on it).

import * as THREE from 'three';
import { packGround } from './GroundPack.js';

const BASE = 'assets/ground/';

/** Per layer: height weight, colour gain (red, green, blue). */
const TUNE = {
  grass: [0.45, [0.72, 0.8, 0.8]], forest: [0.4, [0.62, 0.74, 0.86]], dirt: [0.5, [1, 1, 1]], gravel: [0.6, [1, 1, 1]],
  rock: [0.7, [1.6, 1.6, 1.6]], mud: [0.15, [1, 0.82, 0.62]], sand: [0.25, [1, 1, 1]], snow: [0.2, [1.9, 1.9, 1.9]],
  pebbles: [0.8, [1, 1, 1]],
};

/** Packed in a worker (render/groundWorker.js), where the browser can decode and read pictures there. */
function packOffPage(base, map, quality) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.reject(new Error('no workers'));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./groundWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => { w.terminate(); if (data.error) reject(new Error(data.error)); else resolve(data); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'the worker failed')); };
    w.postMessage({ base, map, quality });
  });
}

/**
 * Load a map's ground layers. quality 'low' halves the colour resolution (512 instead of 1024).
 * Resolves with { layers: [{ name, size, rough, avg, heightW, gain }], index: { name: layer }, color, normal }.
 */
export async function loadGround(map = 'ashwood', quality = 'high') {
  const base = new URL(BASE, document.baseURI).href;
  const { manifest, CS, DS, color, normal } = await packOffPage(base, map, quality).catch(() => packGround(base, map, quality));
  const L = manifest.layers.length;
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
