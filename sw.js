const CACHE_NAME = 'barber-app-v1.0.2-20260706b';
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './manifest.json',
  './reservation-favicon.ico',
  './reservation-favicon-16.png',
  './reservation-favicon-32.png',
  './reservation-icon.svg',
  './reservation-apple-touch-icon.png',
  './reservation-icon-192.png',
  './reservation-icon-512.png',
  './reservation-icon-512-maskable.png',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './icon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './js/db.js',
  './js/app.js',
];
const FULLCALENDAR_URL = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.10/index.global.min.js';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    try {
      await cache.add(FULLCALENDAR_URL);
    } catch (error) {
      console.warn('FullCalendarの事前キャッシュをスキップしました', error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && response.ok && new URL(event.request.url).protocol.startsWith('http')) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      throw error;
    }
  })());
});
