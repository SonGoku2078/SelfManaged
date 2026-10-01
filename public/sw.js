// App-shell cache so the app (web + desktop thin client) also STARTS without a
// connection. Data is not cached here — that is the job of the tm-cache
// snapshot + tm-outbox in localStorage. API calls (other origin on Appwrite,
// /api + /health on the Express server) are never intercepted.
//
// Navigation: network first (fresh deploys win), cached shell when offline.
// Hashed /assets/*: cache first (immutable). After each fresh index.html, assets
// it no longer references are pruned so the cache does not grow per deploy.
const CACHE = 'sm-shell-v1';
const SHELL = '/';
const NAV_TIMEOUT_MS = 4000;

// Precache the shell + the assets it references: the very first page load
// happens BEFORE the worker controls the page, so nothing would be cached yet.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const res = await fetch(SHELL, { cache: 'reload' });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put(SHELL, res);
        const assets = [...new Set([...html.matchAll(/\/assets\/[^"'\s)]+/g)].map((m) => m[0]))];
        await cache.addAll(assets);
      }
    } catch {
      /* offline during install — navigations will fill the cache later */
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function pruneAssets(cache, html) {
  const keep = new Set([...html.matchAll(/\/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !keep.has(path)) await cache.delete(req);
  }
}

async function handleNavigate(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]);
    if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
      const copy = res.clone();
      const html = await copy.clone().text();
      const prev = await cache.match(SHELL);
      const changed = !prev || (await prev.text()) !== html;
      await cache.put(SHELL, copy);
      // Only after a new deploy — lazily loaded chunks stay cached otherwise.
      if (changed) await pruneAssets(cache, html);
    }
    return res;
  } catch {
    const cached = await cache.match(SHELL);
    if (cached) return cached;
    throw new Error('offline and no cached shell');
  }
}

async function handleStatic(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
  } else if (url.pathname.startsWith('/assets/') || /\.(svg|png|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(handleStatic(request));
  }
});
