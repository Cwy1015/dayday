const CACHE = 'cc-day-shell-v26';
const ASSETS = ['./', './index.html', './style.css?v=visual-polish-1', './supabase-config.js?v=visual-2', './app.js?v=remove-summary-card-1', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
