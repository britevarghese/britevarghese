// The open world built in the browser (world/maps/world.js): each map in a worker of its own, a few at once, a stretch
// as soon as the maps either side of it are in; each kept in the browser's storage once built, so the next visit takes
// it from there. The map the trucks start on comes first: the game starts on it, and the rest join the world as they
// come in (world/OpenWorld.js, render/WorldView.js), with no loading screen between them.
import { REGIONS, regionById } from './maps/world.js';
import { seamsFor, needs } from './BigWorldGen.js';
import { landform } from './WorldGen.js';

const DB = 'trailbreak-world', STORE = 'maps';

// ---------------------------------------------------------------- what the maps are built by
/**
 * A fingerprint of everything a map is built from: the generator's modules (found by following their imports from
 * world/BigWorldGen.js) and the real terrain's data. A change to any of them builds the maps afresh.
 */
async function buildVersion() {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const eat = (bytes) => {
    for (let i = 0; i < bytes.length; i++) {
      h1 = Math.imul(h1 ^ bytes[i], 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ bytes[i], 0x5bd1e995) >>> 0;
    }
  };
  const seen = new Set(), queue = [new URL('./BigWorldGen.js', import.meta.url).href];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const text = await fetch(url).then((r) => r.text());
    eat(new TextEncoder().encode(text));
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) queue.push(new URL(m[1], url).href);
  }
  for (const name of ['height', 'far', 'cover']) eat(new Uint8Array(await fetch(`/assets/maps/coast/${name}.bin`).then((r) => r.arrayBuffer())));
  return `${h1.toString(36)}${h2.toString(36)}`;
}

// ---------------------------------------------------------------- the browser's storage
const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

/** What earlier versions of the generator built goes from storage (the worker keeps what this one builds). */
async function sweep(version) {
  if (typeof indexedDB === 'undefined') return;
  const o = indexedDB.open(DB, 1);
  o.onupgradeneeded = () => o.result.createObjectStore(STORE);
  const db = await req(o);
  const keys = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
  const old = keys.filter((k) => !String(k).endsWith(`@${version}`));
  if (old.length) { const t = db.transaction(STORE, 'readwrite'); for (const k of old) t.objectStore(STORE).delete(k); await new Promise((ok) => { t.oncomplete = ok; t.onerror = ok; }); }
  db.close();
}

/** Builds the open world's maps (or takes them from storage). */
export class WorldLoader {
  /** onProgress(id, fraction, label): a map's progress. */
  constructor({ onProgress = () => {} } = {}) {
    this.onProgress = onProgress;
    const cores = navigator.hardwareConcurrency || 2, mem = navigator.deviceMemory || 8;
    this.slots = mem <= 4 ? 1 : Math.max(1, Math.min(3, cores - 1));
    this.waiting = [];
    this.chain = Promise.resolve();
    this.from = {};               // id -> 'stored' | 'built'
  }

  /** A worker slot (at most `slots` maps at once; the start map's first). */
  async slot(first) {
    if (this.slots > 0) { this.slots--; return; }
    await new Promise((r) => (first ? this.waiting.unshift(r) : this.waiting.push(r)));
  }
  free() { const next = this.waiting.shift(); if (next) next(); else this.slots++; }

  /** One map in a worker: from storage under `key`, else built there (and kept). */
  async inWorker(id, seams, key, first = false) {
    await this.slot(first);
    try {
      return await new Promise((resolve, reject) => {
        const w = new Worker(new URL('./worldWorker.js', import.meta.url), { type: 'module' });
        w.onmessage = ({ data: m }) => {
          if (m.progress !== undefined) { this.onProgress(id, m.progress, m.label); return; }
          w.terminate();
          if (m.error) reject(new Error(`${id}: ${m.error}`)); else { this.from[id] = m.stored ? 'stored' : 'built'; resolve(m.data); }
        };
        w.onerror = (e) => { w.terminate(); reject(new Error(`${id}: ${e.message || 'the worker failed'}`)); };
        w.postMessage({ id, seams, key });
      });
    } finally { this.free(); }
  }

  /**
   * Build (or fetch) every map, the start one first: onRegion(id, data) for each as it is ready, one at a time, in the
   * order they come in. Resolves when they are all in.
   */
  async load(start, onRegion) {
    const version = await buildVersion().catch((e) => { console.warn('world version', e); return null; });
    if (version) await sweep(version).catch(() => {});
    const done = new Map(), jobs = new Map();
    let first = null;
    const job = (id) => {
      if (!jobs.has(id)) jobs.set(id, (async () => {
        for (const n of needs(id)) await job(n);
        const data = await this.inWorker(id, seamsFor(id, done), version && `${id}@${version}`, id === start);
        const R = regionById(id);
        await R.map.load?.();
        data.map = R.map; data.farHeight = landform(R.map).farHeight;
        done.set(id, data);
        // (the start map's turn comes first, whichever is ready first)
        if (id !== start) await first;
        this.chain = this.chain.then(() => onRegion(id, data));
        await this.chain;
        return data;
      })());
      return jobs.get(id);
    };
    // the start map first; the rest as there are workers free (each stretch after the maps either side)
    first = job(start);
    await Promise.all([first, ...REGIONS.filter((R) => R.id !== start).map((R) => job(R.id))]);
  }
}
