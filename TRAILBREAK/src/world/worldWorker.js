// One map of the open world off the main thread (world/WorldLoader.js): { id, seams, key } in; its data out (its arrays
// handed over, not copied), taken from the browser's storage if it was built before (under `key`), else built and kept
// there, with its progress on the way.
import { generateRegionWith } from './BigWorldGen.js';

const DB = 'trailbreak-world', STORE = 'maps';
const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  return req(r).catch(() => null);
}

/** The arrays in a map's data, to hand over. */
function buffers(d) {
  const out = new Set();
  for (const v of [d.heights, d.surface, d.water, ...Object.values(d.trees)]) if (ArrayBuffer.isView(v)) out.add(v.buffer);
  return [...out];
}

self.onmessage = async ({ data: { id, seams, key } }) => {
  try {
    const db = key ? await openDb() : null;
    let d = db ? await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(key)).catch(() => null) : null;
    const stored = !!d;
    if (!d) {
      d = await generateRegionWith(id, seams, { yieldEvery: 128, onProgress: (f, label) => self.postMessage({ id, progress: f, label }) });
      delete d.map; delete d.farHeight;
      if (db) {
        self.postMessage({ id, progress: 1, label: 'Keeping it for next time' });
        const t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).put(d, key);
        await new Promise((ok) => { t.oncomplete = ok; t.onerror = ok; t.onabort = ok; });
      }
    }
    db?.close();
    self.postMessage({ id, data: d, stored }, buffers(d));
  } catch (e) {
    self.postMessage({ id, error: e?.message || String(e) });
  }
};
