// NIGHTSHIFT service worker: makes the game installable (it then opens full screen, see
// manifest.webmanifest) and keeps the heavy assets locally so later launches load fast.
//   code (html / js / css / json): network first, cached copy when offline
//   assets (models, textures, audio, vendor libs): served from the cache, refreshed in the background
const CACHE = 'nightshift-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/css/nightshift.css', '/manifest.webmanifest']).catch(() => {}))); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  if (req.headers.get('range')) return; // partial (audio seek) requests go straight to the network
  const heavy = /^\/(assets|vendor|icons)\//.test(url.pathname);
  e.respondWith(heavy ? staleWhileRevalidate(req, e) : networkFirst(req));
});
async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req)) || (await c.match('/')) || Response.error();
  }
}
async function staleWhileRevalidate(req, e) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  const refresh = fetch(req).then((res) => { if (res.ok && res.status === 200) c.put(req, res.clone()); return res; }).catch(() => null);
  if (hit) { e.waitUntil(refresh); return hit; }
  return (await refresh) || Response.error();
}
