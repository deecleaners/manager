/**
 * Dee Cleaners — service worker (PWA)
 * Static assets: cache-first. API calls: always network (Google Sheets is
 * the single source of truth, so business data is never cached here).
 */
const CACHE = 'dee-cleaners-v4';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './config.js',
  './manifest.json', './icons/logo.png', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png', './favicon.png', './favicon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.includes('/api')) return; // API: network only
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
