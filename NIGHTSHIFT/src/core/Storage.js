// localStorage wrapper that never throws (private mode, quota, disabled storage).
const PREFIX = 'nightshift.';
export const Storage = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { console.warn('[Storage] load failed', key, e); return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch (e) { console.warn('[Storage] save failed', key, e); return false; }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } },
};
