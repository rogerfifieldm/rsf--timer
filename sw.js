const CACHE_NAME = 'rsf-timer-v25-clean-cinematic';
const ASSETS = [
  './', './index.html', './timer.js', './rsf-cinematic-bg.jpg',
  './athlete-kickbox.png', './athlete-boxing.png', './athlete-hiit.png',
  './athlete-tabata.png', './athlete-run.png', './athlete-strength.png', './athlete-custom.png',
  './manifest.json', './qr-code.png',
  './icon-64.png', './icon-180.png', './icon-192.png', './icon-512.png', './icon-1024.png',
  './icon-maskable-192.png', './icon-maskable-512.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith(fetch(req).then(res => {
    if (req.url.startsWith(self.location.origin) && res.ok) {
      const copy = res.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req)));
});
